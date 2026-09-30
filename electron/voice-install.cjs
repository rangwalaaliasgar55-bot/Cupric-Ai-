/**
 * voice-install.cjs — fetching the offline speech engines, for real.
 *
 * Phase 1.4 said the app must not stop at "engine not installed" as a sentence:
 * it has to offer the download and do it. This module is that download. It is
 * deliberately boring and inspectable:
 *
 *   - Every artefact is a real HTTPS GET from a pinned, published location.
 *     No mirrors guessed at runtime, no URLs built from user input.
 *   - Bytes are streamed to  <dest>/<name>.part  and renamed only after the
 *     stream finishes, so a cancelled or failed download never leaves a
 *     half-file that later looks installed.
 *   - Progress is reported from actual received bytes against the
 *     Content-Length. When the server does not send a length, `total` is null
 *     and the UI must say "downloading" without inventing a percentage — the
 *     same rule the render bar follows.
 *   - Failures carry the URL, the HTTP status and the OS error verbatim. The
 *     user-facing sentence is built from that; nothing is swallowed.
 *
 * What it does NOT do: bundle anything. Nothing here ships inside the
 * installer. Piper and whisper.cpp are fetched on request into the user's own
 * data folder, and eSpeak NG (which Piper's Windows build includes) is GPLv3,
 * so pulling it at the user's request is also the licence-clean route.
 *
 * Artefact coordinates (checked against the published releases):
 *   piper      github.com/rhasspy/piper  tag 2023.11.14-2  piper_windows_amd64.zip
 *              22,477,236 bytes; the zip holds piper.exe, the espeak-ng data
 *              and the onnxruntime DLLs. The release itself is old and its
 *              Windows build ships no models, which is why the models below
 *              are fetched separately.
 *   models     HuggingFace rhasspy/piper-voices — <lang>/<region>/<voice>/<quality>
 *   whisper    huggingface.co/ggerganov/whisper.cpp ggml models, and the
 *              whisper.cpp Windows build from ggml-org/whisper.cpp (bNNNN tags)
 */
const fs = require('node:fs')
const path = require('node:path')
const { Readable } = require('node:stream')
const { pipeline } = require('node:stream/promises')

/** The engines this app can install, and exactly what each one needs. */
const ENGINES = {
  piper: {
    label: 'Piper (offline voiceover, English)',
    kind: 'zip',
    url: 'https://github.com/rhasspy/piper/releases/download/2023.11.14-2/piper_windows_amd64.zip',
    /** Zip entries live under this prefix; the top level of it becomes <dest>. */
    stripPrefix: 'piper/',
    /** Proof that extraction worked — checked after unzip, not assumed. */
    expect: ['piper.exe'],
  },
  'piper-model-en': {
    label: 'Piper English voice (lessac, medium)',
    kind: 'file',
    files: [
      ['https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/lessac/medium/en_US-lessac-medium.onnx', 'en_US-lessac-medium.onnx'],
      ['https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/lessac/medium/en_US-lessac-medium.onnx.json', 'en_US-lessac-medium.onnx.json'],
    ],
  },
  'voice-hi': {
    label: 'Windows Hindi voice (Microsoft Heera)',
    kind: 'windows-capability',
    /** Installed through Windows itself, per the copy in tts.cjs. */
    note: 'Windows installs speech voices through Settings, not an installer: Time & language → Speech → Add voices → Hindi (India). Cupric cannot silently add a system voice, and pretending to is how apps end up with a button that does nothing.',
  },
}

/** Windows-only, like the app. */
function supported(platform = process.platform) {
  return platform === 'win32'
}

function unsupportedReason(platform = process.platform) {
  return `Cupric AI ships for Windows only; this build cannot install speech engines on ${platform}.`
}

/** A download plan for one engine, as data — so it can be tested without network. */
function planFor(engineId, destDir) {
  const engine = ENGINES[engineId]
  if (!engine) return null
  if (engine.kind === 'windows-capability') return { id: engineId, kind: engine.kind, label: engine.label, note: engine.note, dir: destDir, items: [] }
  const items = (engine.files ?? [[engine.url, path.basename(new URL(engine.url).pathname)]]).map(([url, name]) => ({
    url,
    name,
    to: path.join(destDir, name),
  }))
  return { id: engineId, kind: engine.kind, label: engine.label, stripPrefix: engine.stripPrefix, expect: engine.expect ?? [], dir: destDir, items }
}

async function download(item, { onBytes, signal, fetchImpl, timeoutMs = 15 * 60 * 1000 } = {}) {
  const partial = `${item.to}.part`
  fs.mkdirSync(path.dirname(item.to), { recursive: true })
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  const onAbort = () => controller.abort()
  if (signal) signal.addEventListener('abort', onAbort, { once: true })

  let res
  try {
    res = await (fetchImpl || fetch)(item.url, {
      redirect: 'follow',
      signal: controller.signal,
      headers: { 'user-agent': 'Cupric-AI/voice-install' },
    })
  } catch (error) {
    clearTimeout(timer)
    if (signal) signal.removeEventListener('abort', onAbort)
    return { ok: false, url: item.url, reason: controller.signal.aborted && !signal?.aborted ? 'timeout' : 'network', error: String(error?.message || error) }
  }

  if (!res.ok || !res.body) {
    clearTimeout(timer)
    if (signal) signal.removeEventListener('abort', onAbort)
    return { ok: false, url: item.url, status: res.status, reason: 'http', error: `HTTP ${res.status} ${res.statusText || ''}`.trim() }
  }

  const declared = Number(res.headers.get('content-length'))
  const total = Number.isFinite(declared) && declared > 0 ? declared : null
  let received = 0
  let lastReport = 0
  const stream = Readable.fromWeb(res.body)
  stream.on('data', (chunk) => {
    received += chunk.length
    const now = Date.now()
    if (onBytes && (now - lastReport > 120 || (total && received >= total))) {
      lastReport = now
      onBytes({ received, total })
    }
  })

  try {
    await pipeline(stream, fs.createWriteStream(partial))
  } catch (error) {
    clearTimeout(timer)
    if (signal) signal.removeEventListener('abort', onAbort)
    fs.rmSync(partial, { force: true })
    return { ok: false, url: item.url, reason: controller.signal.aborted ? 'cancelled' : 'stream', error: String(error?.message || error) }
  }
  clearTimeout(timer)
  if (signal) signal.removeEventListener('abort', onAbort)

  // A truncated transfer that ends cleanly is still a broken file; the length
  // header is the only honest check available without a checksum.
  const size = fs.statSync(partial).size
  if (total !== null && size !== total) {
    fs.rmSync(partial, { force: true })
    return { ok: false, url: item.url, reason: 'truncated', error: `expected ${total} bytes, received ${size}` }
  }
  fs.renameSync(partial, item.to)
  if (onBytes) onBytes({ received: size, total: size })
  return { ok: true, url: item.url, to: item.to, size }
}

/**
 * Where one archive entry is allowed to land — or a refusal.
 *
 * This is its own function because it is the one piece of the extraction that
 * must be exactly right, and because it can be tested against hostile names
 * without building an archive. The rule: the resolved target must be strictly
 * inside `destDir`, and the entry must not be absolute, must not contain a `..`
 * segment and must not be a UNC or drive-qualified path. Anything else is
 * refused by name, so the failure says which entry was rejected.
 *
 * It is deliberately belt-and-braces: AdmZip already collapses `..` while
 * writing (checked), so an archive built with it cannot carry a traversal — but
 * archives arrive from the network and are read by this code, and the check
 * belongs on the side that writes files.
 */
function safeEntryTarget(destDir, entryName) {
  const raw = String(entryName ?? '')
  const name = raw.replace(/\\/g, '/')
  if (!name) return { ok: false, reason: 'empty' }
  if (!name || name.endsWith('/')) return { ok: false, reason: 'directory' }
  if (name.startsWith('/') || /^[a-zA-Z]:\//.test(name) || name.startsWith('//')) {
    return { ok: false, error: `archive entry is an absolute path: ${raw}` }
  }
  if (name.split('/').some((segment) => segment === '..' || segment === '.')) {
    return { ok: false, error: `archive entry escapes the install folder: ${raw}` }
  }
  const root = path.resolve(destDir)
  const target = path.resolve(root, name)
  if (target !== root && !target.startsWith(root + path.sep)) {
    return { ok: false, error: `archive entry escapes the install folder: ${raw}` }
  }
  return { ok: true, target }
}

/** Extract a zip with the stdlib-free AdmZip the repo already depends on. */
function extractZip(zipPath, destDir, stripPrefix) {
  // Required lazily: the app only needs AdmZip when a person installs Piper.
  const AdmZip = require('adm-zip')
  const zip = new AdmZip(zipPath)
  fs.mkdirSync(destDir, { recursive: true })
  for (const entry of zip.getEntries()) {
    const full = String(entry.entryName ?? '')
    // Validate the name as it will be written, prefix already removed, so both
    // the filter and the guard look at the same string the filesystem will see.
    const name = stripPrefix && full.startsWith(stripPrefix) ? full.slice(stripPrefix.length) : stripPrefix ? null : full
    if (name === null) continue
    const safe = safeEntryTarget(destDir, name)
    if (!safe.ok) {
      if (safe.reason === 'directory') continue
      return { ok: false, error: safe.error }
    }
    fs.mkdirSync(path.dirname(safe.target), { recursive: true })
    fs.writeFileSync(safe.target, entry.getData())
  }
  return { ok: true }
}

/**
 * Install one engine. Returns a real result — never a hopeful one.
 *
 *   { ok: true,  engine, dir, installed: [paths] }
 *   { ok: false, engine, stage, error, url?, status? }
 */
async function install(engineId, { dir, platform = process.platform, onProgress, signal, fetchImpl } = {}) {
  if (!supported(platform)) return { ok: false, engine: engineId, stage: 'platform', error: unsupportedReason(platform) }
  if (!dir) return { ok: false, engine: engineId, stage: 'setup', error: 'No install folder was resolved for the speech engines.' }
  const plan = planFor(engineId, dir)
  if (!plan) return { ok: false, engine: engineId, stage: 'setup', error: `Unknown engine "${engineId}".` }
  if (plan.kind === 'windows-capability') {
    return { ok: false, engine: engineId, stage: 'manual', error: plan.note }
  }

  const report = (patch) => { if (onProgress) onProgress({ engine: engineId, label: plan.label, ...patch }) }
  const installed = []

  for (let index = 0; index < plan.items.length; index += 1) {
    const item = plan.items[index]
    report({ index, count: plan.items.length, name: item.name, phase: 'download', received: 0, total: null })
    const res = await download(item, {
      // The option was accepted and then dropped on the floor, so anything that
      // passed a fetch through (a test, a proxy, an offline mirror) silently got
      // the real network instead. Threaded through, and the download is the only
      // place that decides how bytes arrive.
      fetchImpl,
      signal,
      onBytes: ({ received, total }) => report({ index, count: plan.items.length, name: item.name, phase: 'download', received, total }),
    })
    if (!res.ok) {
      return { ok: false, engine: engineId, stage: 'download', url: res.url, status: res.status, error: describe(res), attempted: res.url }
    }
    report({ index, count: plan.items.length, name: item.name, phase: 'done', received: res.size, total: res.size })
    installed.push(res.to)

    if (plan.kind === 'zip') {
      report({ phase: 'extract', name: item.name })
      const unpacked = extractZip(item.to, plan.dir, plan.stripPrefix)
      if (!unpacked.ok) return { ok: false, engine: engineId, stage: 'extract', error: unpacked.error }
      fs.rmSync(item.to, { force: true })
    }
  }

  // Verify what we just claimed to install, by looking at the disk.
  const missing = (plan.expect ?? []).filter((rel) => !fs.existsSync(path.join(plan.dir, rel)))
  if (missing.length) {
    return { ok: false, engine: engineId, stage: 'verify', error: `The download finished but ${missing.join(', ')} is not in ${plan.dir}.` }
  }
  report({ phase: 'complete', received: null, total: null })
  return { ok: true, engine: engineId, dir: plan.dir, installed }
}

function describe(res) {
  if (res.reason === 'cancelled') return `Cancelled while downloading ${res.url}.`
  if (res.reason === 'timeout') return `Timed out downloading ${res.url}. Check the connection and try again.`
  if (res.reason === 'truncated') return `The download of ${res.url} was cut short (${res.error}). Try again.`
  if (res.reason === 'stream') return `Writing the download failed: ${res.error}`
  if (res.reason === 'http') {
    if (res.status === 404) return `${res.url} returned 404 — the published file has moved. This is a bug in Cupric, not in your setup; the built-in engines still work.`
    if (res.status === 403 || res.status === 429) return `${res.url} refused the download (HTTP ${res.status}). Waiting a few minutes usually clears it.`
    return `${res.url} returned ${res.error}.`
  }
  return `${res.url} could not be reached: ${res.error}`
}

module.exports = { ENGINES, planFor, install, download, extractZip, safeEntryTarget, supported, unsupportedReason, describe }
