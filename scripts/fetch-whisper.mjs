#!/usr/bin/env node
/**
 * Download offline speech recognition for the desktop app (1.10):
 * a whisper.cpp CLI build for this OS plus a small quantized English model,
 * into vendor/whisper/ — which electron-builder ships as resources/whisper.
 *
 *   npm run whisper:fetch                 # base.en, quantized (~57 MB)
 *   npm run whisper:fetch -- --model tiny.en-q5_1   # smaller, less accurate
 *
 * Users of an installed build can instead drop whisper-cli(.exe) and a
 * ggml-*.bin model into  <userData>/whisper/  (on Windows:
 * %APPDATA%\Cupric AI\whisper\).
 *
 * whisper.cpp is MIT licensed; the ggml Whisper models are MIT (OpenAI).
 */
import AdmZip from 'adm-zip'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream, existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync } from 'node:fs'
import path from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const dest = path.join(root, 'vendor', 'whisper')
const modelArg = process.argv.includes('--model') ? process.argv[process.argv.indexOf('--model') + 1] : 'base.en-q5_1'
const modelName = `ggml-${modelArg}.bin`

const ASSET = {
  win32: { x64: 'whisper-bin-x64.zip', ia32: 'whisper-bin-Win32.zip', arm64: 'whisper-bin-win-cpu-arm64.zip' },
  linux: { x64: 'whisper-bin-ubuntu-x64.tar.gz', arm64: 'whisper-bin-ubuntu-arm64.tar.gz' },
}[process.platform]?.[process.arch]

async function sha256(file) {
  const h = createHash('sha256')
  await pipeline(createReadStream(file), h)
  return h.digest('hex')
}

/**
 * Download to `<file>.part`, check the SHA-256 against the publisher's digest when one is
 * known, and only then move it into place. A mismatch deletes the file and fails — an
 * unverified engine never lands in vendor/. With no published digest the hash is printed
 * as UNVERIFIED so the gap is visible instead of silent.
 */
async function download(url, file, expected = null) {
  const res = await fetch(url, { redirect: 'follow', headers: { 'user-agent': 'cupric-ai-fetch-whisper' } })
  if (!res.ok || !res.body) throw new Error(`${url} → HTTP ${res.status}`)
  const tmp = `${file}.part`
  await pipeline(Readable.fromWeb(res.body), createWriteStream(tmp))
  const got = await sha256(tmp)
  if (expected && got !== expected.toLowerCase()) {
    rmSync(tmp, { force: true })
    throw new Error(`${path.basename(file)}: SHA-256 mismatch — expected ${expected}, got ${got}. Deleted.`)
  }
  console.log(`  sha256 ${got} ${expected ? '(verified against publisher digest)' : 'UNVERIFIED (publisher gave no digest)'}`)
  renameSync(tmp, file)
  return statSync(file).size
}

/** HuggingFace serves LFS files with their SHA-256 in `x-linked-etag` on the un-followed resolve. */
async function huggingFaceSha256(url) {
  try {
    const res = await fetch(url, { method: 'HEAD', redirect: 'manual', headers: { 'user-agent': 'cupric-ai-fetch-whisper' } })
    const tag = (res.headers.get('x-linked-etag') || '').replace(/^W\//, '').replace(/"/g, '')
    return /^[0-9a-f]{64}$/i.test(tag) ? tag : null
  } catch { return null }
}

mkdirSync(dest, { recursive: true })

// 1. Model.
const modelPath = path.join(dest, modelName)
if (existsSync(modelPath)) console.log(`model: ${modelName} already present`)
else {
  const url = `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/${modelName}`
  const size = await download(url, modelPath, await huggingFaceSha256(url))
  console.log(`model: ${modelName} (${(size / 1e6).toFixed(0)} MB)`)
}

// 2. Binary. Tagged releases are sometimes published without assets; the
//    numbered builds (bNNNN) carry them, so take the newest one that has ours.
if (!ASSET) {
  console.log(`binary: no prebuilt whisper.cpp for ${process.platform}/${process.arch}. Build it (https://github.com/ggml-org/whisper.cpp) and copy whisper-cli into ${dest}, or set CUPRIC_WHISPER_PATH.`)
  process.exit(0)
}
const hasBinary = readdirSync(dest, { recursive: true }).some((f) => /(^|[\\/])whisper-cli(\.exe)?$/.test(String(f)))
if (hasBinary) {
  console.log('binary: whisper-cli already present')
} else {
  const releases = await (await fetch('https://api.github.com/repos/ggml-org/whisper.cpp/releases?per_page=20', { headers: { 'user-agent': 'cupric-ai-fetch-whisper' } })).json()
  const release = Array.isArray(releases) ? releases.find((r) => r.assets?.some((a) => a.name === ASSET)) : null
  if (!release) throw new Error(`No whisper.cpp release with ${ASSET} found.`)
  const asset = release.assets.find((a) => a.name === ASSET)
  const archive = path.join(dest, ASSET)
  // GitHub publishes `digest: "sha256:…"` for release assets; verify against it.
  const digest = /^sha256:([0-9a-f]{64})$/i.exec(String(asset.digest || ''))?.[1] || null
  await download(asset.browser_download_url, archive, digest)
  if (ASSET.endsWith('.zip')) new AdmZip(archive).extractAllTo(dest, true)
  else execFileSync('tar', ['-xzf', archive, '-C', dest])
  rmSync(archive, { force: true })
  console.log(`binary: whisper.cpp ${release.tag_name} (${ASSET})`)
}
console.log(`done — Cupric will find Whisper in ${path.relative(root, dest)} (dev) and resources/whisper (packaged).`)
