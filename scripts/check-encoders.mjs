#!/usr/bin/env node
/**
 * Hardware-accelerated export (2.24): encoder selection and arguments.
 * Selection logic runs against a fake FFmpeg; when a real FFmpeg is available
 * (CUPRIC_FFMPEG_PATH or ffmpeg-static) it also really detects and encodes.
 */
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { execFile } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync, statSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const require = createRequire(import.meta.url)
const enc = require('../electron/encoders.cjs')

const LIST = ` V....D libx264  x
 V....D h264_nvenc  NVIDIA NVENC
 V..... h264_qsv  Intel QSV
 V..... h264_amf  AMD AMF
 V..... h264_videotoolbox  VT`

function fake({ listed = LIST, works = [] } = {}) {
  const calls = []
  const run = async (args) => {
    calls.push(args)
    if (args.includes('-encoders')) return { stdout: listed, stderr: '' }
    const name = args[args.indexOf('-c:v') + 1]
    if (works.includes(name)) return { stdout: '', stderr: '' }
    throw new Error(`Cannot load ${name}`)
  }
  return { run, calls }
}

// Listed-but-broken NVENC (no Nvidia GPU) must fall through to Quick Sync.
{
  const f = fake({ works: ['h264_qsv'] })
  const r = await enc.detect(f.run, 'win32')
  assert.equal(r.name, 'h264_qsv')
  assert.equal(r.hardware, true)
  assert.deepEqual(r.tried, ['h264_nvenc', 'h264_qsv'])
}
// Nothing works → libx264, never a throw.
{
  const r = await enc.detect(fake().run, 'win32')
  assert.equal(r.name, 'libx264')
  assert.equal(r.hardware, false)
}
// macOS → VideoToolbox only.
{
  const r = await enc.detect(fake({ works: ['h264_videotoolbox', 'h264_nvenc'] }).run, 'darwin')
  assert.equal(r.name, 'h264_videotoolbox')
}
// Setting off → software without even probing.
{
  const f = fake({ works: ['h264_nvenc'] })
  const r = await enc.detect(f.run, 'win32', 'off')
  assert.equal(r.name, 'libx264')
  assert.equal(f.calls.length, 0)
}
// Listing failure → software.
{
  const r = await enc.detect(async () => { throw new Error('spawn ENOENT') }, 'linux')
  assert.equal(r.name, 'libx264')
}
// Not listed → never probed.
{
  const f = fake({ listed: ' V....D libx264 x', works: ['h264_nvenc'] })
  const r = await enc.detect(f.run, 'win32')
  assert.equal(r.name, 'libx264')
  assert.equal(f.calls.length, 1)
}
// Every encoder: 4:2:0 8-bit output, High profile, codec named after -c:v.
for (const name of ['libx264', 'h264_nvenc', 'h264_qsv', 'h264_amf', 'h264_videotoolbox']) {
  for (const q of ['draft', 'final']) {
    const a = enc.videoArgs(name, q)
    assert.equal(a[a.indexOf('-c:v') + 1], name)
    assert.ok(['yuv420p', 'nv12'].includes(a[a.indexOf('-pix_fmt') + 1]), `${name} pix_fmt`)
    assert.equal(a[a.indexOf('-profile:v') + 1], 'high', `${name} profile`)
    assert.ok(a.every((x) => typeof x === 'string'), `${name} args are strings`)
  }
}
assert.deepEqual(enc.videoArgs('libx264', 'final').slice(0, 6), ['-c:v', 'libx264', '-preset', 'slow', '-crf', '18'])
assert.deepEqual(enc.videoArgs('libx264', 'draft').slice(0, 6), ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '28'])

// main.cjs must not hard-code libx264 at any encode site any more.
const { readFileSync } = await import('node:fs')
const main = readFileSync(new URL('../electron/main.cjs', import.meta.url), 'utf8')
assert.ok(!/'-c:v',\s*'libx264',\s*'-preset',\s*presetForQuality/.test(main), 'render segments still hard-code libx264')
assert.ok((main.match(/runEncode\(/g) || []).length >= 4, 'encode sites go through runEncode')

// Real FFmpeg, when present.
const ffmpeg = process.env.CUPRIC_FFMPEG_PATH || (() => { try { return require('ffmpeg-static') } catch { return null } })()
if (ffmpeg && existsSync(ffmpeg)) {
  const run = (args) => new Promise((resolve, reject) => execFile(ffmpeg, args, { maxBuffer: 16 << 20 }, (err, stdout, stderr) => (err ? reject(Object.assign(err, { stderr })) : resolve({ stdout, stderr }))))
  const r = await enc.detect(run, process.platform)
  const dir = mkdtempSync(path.join(os.tmpdir(), 'cupric-enc-'))
  try {
    for (const q of ['draft', 'final']) {
      const out = path.join(dir, `${q}.mp4`)
      await run(['-y', '-hide_banner', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc=s=642x362:r=30:d=0.5', '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2', ...enc.videoArgs(r.name, q), out])
      assert.ok(statSync(out).size > 1000, `${r.name} ${q} produced a real file`)
      await run(['-y', '-hide_banner', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc=s=320x240:r=30:d=0.3', ...enc.videoArgs('libx264', q), path.join(dir, `sw-${q}.mp4`)])
    }
    console.log(`encoders check: real FFmpeg picked ${r.name} (${r.reason}) and encoded draft + final`)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
} else {
  console.log('encoders check: no FFmpeg binary here — selection logic only (set CUPRIC_FFMPEG_PATH to also encode for real)')
}
console.log('encoders check passed')
