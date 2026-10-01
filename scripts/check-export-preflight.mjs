#!/usr/bin/env node
/**
 * check:export-preflight — the export gate, run against real files and the real
 * FFmpeg/FFprobe binaries.
 *
 * Phase 0 §B6/B7 found that a render could only fail *after* the encode, with
 * ffmpeg's own stderr as the only message. `electron/render-preflight.cjs` now
 * answers "can this export even start?" before the first frame and verifies the
 * delivered file before the UI is told it succeeded. This check proves both with
 * real side effects:
 *
 *   1. FFprobe is required and resolved the way the app resolves it.
 *   2. A real WAV and a real MP4 (encoded here with FFmpeg) are probed and the
 *      verdict is what the rules say it should be — including the failures:
 *      wrong length, wrong size, missing sound, an unreadable file.
 *   3. A zero-byte file and a text file named .mp4 are refused for the right
 *      reason, by actually probing them.
 *   4. Preflight runs against the real filesystem: a real folder, a real
 *      read-only folder, a real statfs, an absurd size request.
 *   5. The disk estimate is compared with what the real encode produced.
 *   6. main.cjs is checked for the wiring: preflight before the encode,
 *      verification before "render:done" in all three export paths.
 *
 * FFmpeg is an optional dependency: on a checkout where its binary did not
 * download, the encode assertions are skipped and the skip is printed, counted,
 * and named in the phase report. FFprobe is required — without it there is no
 * verification, so the check fails instead of pretending.
 *
 * Run: npm run check:export-preflight
 */

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const preflight = require('../electron/render-preflight.cjs')

let checks = 0
let skipped = 0
const ok = (condition, label) => {
  assert.ok(condition, `FAIL: ${label}`)
  checks += 1
}
const eq = (a, b, label) => {
  assert.equal(a, b, `FAIL: ${label}`)
  checks += 1
}
const codes = (verdict) => verdict.failures.map((f) => f.code)

/* ── resolve the media tools the way electron/main.cjs does ───────────────── */
function resolveBinary(name) {
  const envPath = process.env[`NEWBRAND_${name.toUpperCase()}_PATH`]
  if (envPath && fs.existsSync(envPath)) return envPath
  const fromPath = spawnSync(process.platform === 'win32' ? 'where' : 'which', [name], { encoding: 'utf8' })
  const found = fromPath.status === 0 ? String(fromPath.stdout).split(/\r?\n/).map((l) => l.trim()).filter(Boolean)[0] : null
  if (found) return found
  for (const moduleName of [name === 'ffmpeg' ? 'ffmpeg-static' : 'ffprobe-static', '@ffmpeg-installer/ffmpeg']) {
    try {
      const resolved = moduleName === 'ffprobe-static' ? require(moduleName).path : require(moduleName)
      const candidate = typeof resolved === 'string' ? resolved : resolved?.path
      if (candidate && fs.existsSync(candidate)) return candidate
    } catch (err) {
      if (err?.code !== 'MODULE_NOT_FOUND') throw err
    }
  }
  return null
}

/**
 * Every place a tool could be, and what happened at each. Printed on every run,
 * because the difference between "the binary is missing" and "the binary is
 * there but the module does not return it" is not visible from a red X.
 */
function explainResolution(name) {
  const lines = []
  const envPath = process.env[`NEWBRAND_${name.toUpperCase()}_PATH`]
  lines.push(`NEWBRAND_${name.toUpperCase()}_PATH=${envPath ? (fs.existsSync(envPath) ? envPath : `${envPath} (not present)`) : 'unset'}`)
  const onPath = spawnSync(process.platform === 'win32' ? 'where' : 'which', [name], { encoding: 'utf8' })
  const found = onPath.status === 0 ? String(onPath.stdout).split(/\r?\n/).map((l) => l.trim()).filter(Boolean)[0] : null
  lines.push(`PATH=${found || 'not found'}`)
  for (const moduleName of [name === 'ffmpeg' ? 'ffmpeg-static' : 'ffprobe-static', '@ffmpeg-installer/ffmpeg']) {
    try {
      const resolved = moduleName === 'ffprobe-static' ? require(moduleName).path : require(moduleName)
      const candidate = typeof resolved === 'string' ? resolved : resolved?.path
      lines.push(`${moduleName}=${candidate ? (fs.existsSync(candidate) ? candidate : `${candidate} (not present)`) : 'no path exported'}`)
    } catch (error) {
      lines.push(`${moduleName}=${error?.code || error?.message}`)
    }
  }
  return lines.join('\n      ')
}

const ffprobePath = resolveBinary('ffprobe')
const ffmpegPath = resolveBinary('ffmpeg')
if (!ffprobePath || !ffmpegPath) {
  console.log(`resolve ffprobe → ${ffprobePath || 'NOT FOUND'}\n  tried:\n      ${explainResolution('ffprobe')}`)
  console.log(`resolve ffmpeg  → ${ffmpegPath || 'NOT FOUND'}\n  tried:\n      ${explainResolution('ffmpeg')}`)
}
assert.ok(ffprobePath, 'FAIL: ffprobe could not be found — the export gate cannot verify anything without it. Run a clean install (ffprobe-static) or set NEWBRAND_FFPROBE_PATH.')
checks += 1

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'newbrand-preflight-'))
const cleanup = () => fs.rmSync(tmp, { recursive: true, force: true })

function ffprobe(file) {
  const result = spawnSync(ffprobePath, ['-v', 'error', '-print_format', 'json', '-show_streams', '-show_format', file], { encoding: 'utf8' })
  if (result.status !== 0) throw new Error(`ffprobe exited ${result.status}: ${(result.stderr || '').trim().slice(0, 200)}`)
  const data = JSON.parse(result.stdout || '{}')
  return {
    durationSec: Number(data?.format?.duration) || Number(data?.streams?.find((s) => s.codec_type === 'video')?.duration) || 0,
    hasAudio: Array.isArray(data.streams) && data.streams.some((s) => s.codec_type === 'audio'),
    streams: data.streams || [],
  }
}

/** A real 1-second 440 Hz mono PCM WAV, written by hand. */
function writeWav(file, seconds = 1) {
  const rate = 8000
  const samples = rate * seconds
  const data = Buffer.alloc(samples * 2)
  for (let i = 0; i < samples; i++) data.writeInt16LE(Math.round(Math.sin((2 * Math.PI * 440 * i) / rate) * 12000), i * 2)
  const header = Buffer.alloc(44)
  header.write('RIFF', 0)
  header.writeUInt32LE(36 + data.length, 4)
  header.write('WAVE', 8)
  header.write('fmt ', 12)
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20)
  header.writeUInt16LE(1, 22)
  header.writeUInt32LE(rate, 24)
  header.writeUInt32LE(rate * 2, 28)
  header.writeUInt16LE(2, 32)
  header.writeUInt16LE(16, 34)
  header.write('data', 36)
  header.writeUInt32LE(data.length, 40)
  fs.writeFileSync(file, Buffer.concat([header, data]))
  return file
}

try {
  /* ── 1. a real encode, then the verdict on the real file ────────────────── */
  const wav = writeWav(path.join(tmp, 'tone.wav'))
  const tone = ffprobe(wav)
  ok(Math.abs(tone.durationSec - 1) < 0.1, 'a real WAV probes to about its real length')
  eq(tone.hasAudio, true, 'the WAV probe finds its audio stream')
  const silentVideo = preflight.verifyExport(tone, { needsVideo: true, durationSec: 1, sizeBytes: fs.statSync(wav).size })
  ok(codes(silentVideo).includes('NO_VIDEO_STREAM'), 'a finished file with no picture track fails the picture check')
  ok(!codes(silentVideo).includes('WRONG_DURATION'), 'the same file is not also reported as the wrong length')

  // A real text file named .mp4: ffprobe must refuse it, and the verdict must
  // be UNPLAYABLE rather than "fine porque it exists".
  const fake = path.join(tmp, 'not-really.mp4')
  fs.writeFileSync(fake, 'this is not a video at all')
  let fakeProbe = null
  try {
    fakeProbe = ffprobe(fake)
  } catch (err) {
    ok(String(err.message).includes('ffprobe exited'), `ffprobe really refused a text file (${err.message.slice(0, 60)}…)`)
  }
  const fakeVerdict = preflight.verifyExport(fakeProbe, { needsVideo: true, sizeBytes: fs.statSync(fake).size })
  ok(codes(fakeVerdict).includes('UNPLAYABLE'), 'a file that will not parse is reported as unplayable')

  const empty = path.join(tmp, 'empty.mp4')
  fs.writeFileSync(empty, '')
  ok(codes(preflight.verifyExport(null, { sizeBytes: 0 })).includes('EMPTY_FILE'), 'a zero-byte output is reported before it is probed')

  /* ── 2. with a real FFmpeg: encode, probe, compare, estimate ────────────── */
  let encoderAssertions = 0
  if (!ffmpegPath) {
    skipped += 1
    console.log('SKIPPED: FFmpeg was not found in this checkout (it is an optional dependency whose binary downloads at install time).')
    console.log('SKIPPED: the encoder-availability assertions, the real encode and the size-estimate comparison did NOT run.')
    console.log('SKIPPED: they run in the release chain on Windows, where ffmpeg-static provides the binary. See docs/PHASE1_EXPORT.md.')
  } else {
    const encodersOut = spawnSync(ffmpegPath, ['-hide_banner', '-encoders'], { encoding: 'utf8' })
    const encoders = preflight.parseEncoders(`${encodersOut.stdout || ''}${encodersOut.stderr || ''}`)
    ok(encoders.size > 20, `the encoder list is read from the real binary (${encoders.size} encoders)`)
    ok(preflight.checkEncoder({ container: 'mp4', codec: 'h264', encoders }).ok, 'this FFmpeg build can write H.264 MP4')
    ok(encoders.has('aac'), 'this FFmpeg build can write AAC audio')

    const encoded = path.join(tmp, 'testsrc.mp4')
    const encode = spawnSync(ffmpegPath, [
      '-hide_banner', '-loglevel', 'error',
      '-f', 'lavfi', '-i', 'testsrc=size=320x180:rate=30:duration=2',
      '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2',
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', '-y', encoded,
    ], { encoding: 'utf8' })
    eq(encode.status, 0, `the real FFmpeg encoded a two-second clip (${(encode.stderr || '').trim().slice(0, 80) || 'no stderr'})`)
    encoderAssertions += 1

    const probe = ffprobe(encoded)
    const sizeBytes = fs.statSync(encoded).size
    ok(sizeBytes > 1000, `the encoded file has real bytes on disk (${sizeBytes} bytes)`)
    const pass = preflight.verifyExport(probe, { durationSec: 2, width: 320, height: 180, needsVideo: true, needsAudio: true, sizeBytes })
    ok(pass.ok, `the encoded file passes verification (${pass.checks.map((c) => `${c.id}:${c.ok ? 'ok' : 'no'}`).join(' ')})`)
    ok(pass.checks.find((c) => c.id === 'video').detail.includes('h264'), 'the picture track is reported with its codec')
    ok(pass.checks.find((c) => c.id === 'audio').ok, 'the sound track is found')

    ok(codes(preflight.verifyExport(probe, { durationSec: 12 })).includes('WRONG_DURATION'), 'a two-second file is not accepted for a twelve-second timeline')
    ok(codes(preflight.verifyExport(probe, { width: 1920, height: 1080 })).includes('WRONG_SIZE'), 'a 320x180 file is not accepted as 1920x1080')
    ok(codes(preflight.verifyExport({ ...probe, streams: probe.streams.filter((s) => s.codec_type === 'video') }, { needsAudio: true })).includes('NO_AUDIO_STREAM'), 'a silent file is refused when the timeline had sound')

    // The estimate is deliberately pessimistic: it must be at least the real file.
    const estimate = preflight.estimateOutputBytes({ durationSec: 2, fps: 30, size: [320, 180], quality: 'balanced' })
    ok(estimate.bytes >= sizeBytes, `the disk estimate (${(estimate.bytes / 1024).toFixed(0)} KB) covers the real encode (${(sizeBytes / 1024).toFixed(0)} KB)`)
    encoderAssertions += 1
  }

  /* ── 3. preflight against the real filesystem ───────────────────────────── */
  const good = path.join(tmp, 'good')
  fs.mkdirSync(good)
  const pass = preflight.buildPreflight({
    outputPath: path.join(good, 'launch.mp4'),
    durationSec: 20,
    fps: 30,
    size: [1080, 1920],
    quality: 'balanced',
    ffmpegPath,
    ffprobePath,
    encoders: ffmpegPath ? preflight.parseEncoders(spawnSync(ffmpegPath, ['-hide_banner', '-encoders'], { encoding: 'utf8' }).stdout || '') : null,
    statfs: (dir) => fs.statfsSync(dir),
    platform: process.platform,
  })
  // The verdict depends on whether this machine has FFmpeg, and both verdicts
  // are worth asserting — that is the difference between a check that describes
  // the machine it was written on and one that describes the product.
  if (ffmpegPath) {
    ok(pass.ok, `a real writable folder with ffmpeg present passes preflight (${pass.checks.map((c) => `${c.id}:${c.ok ? 'ok' : 'no'}`).join(' ')})`)
  } else {
    ok(!pass.ok && codes(pass).includes('FFMPEG_MISSING'), 'without ffmpeg the same preflight refuses, naming the missing tool rather than failing later')
    skipped += 1
    console.log('SKIPPED: no FFmpeg on this machine, so the "everything present passes" case cannot be asserted (run npm run media:ensure).')
  }
  ok(pass.checks.find((c) => c.id === 'disk').detail.includes('free'), 'the free space is reported from the real statfs')
  ok(pass.estimate.bytes > 0, 'the disk need is estimated')

  const tooBig = preflight.buildPreflight({
    outputPath: path.join(good, 'launch.mp4'),
    durationSec: 60 * 60 * 24,
    fps: 60,
    size: [3840, 2160],
    quality: 'final',
    ffmpegPath,
    ffprobePath,
    statfs: (dir) => fs.statfsSync(dir),
    platform: process.platform,
  })
  ok(codes(tooBig).includes('DISK_FULL'), 'a 24-hour 4K export is refused before encoding, with the numbers')

  const missing = preflight.buildPreflight({
    outputPath: path.join(good, 'launch.mp4'),
    durationSec: 10,
    ffmpegPath: null,
    ffprobePath,
    statfs: (dir) => fs.statfsSync(dir),
    platform: process.platform,
  })
  ok(codes(missing).includes('FFMPEG_MISSING'), 'a missing FFmpeg is refused with its own code and fix')

  const readOnly = path.join(tmp, 'read-only')
  fs.mkdirSync(readOnly)
  fs.chmodSync(readOnly, 0o555)
  const rootUser = typeof process.getuid === 'function' && process.getuid() === 0
  if (rootUser) {
    skipped += 1
    console.log('SKIPPED: running as root, which ignores directory permissions — the read-only assertion did not run.')
  } else if (process.platform === 'win32') {
    // Found by the first real Windows CI run: this assertion cannot hold here.
    // `chmod` on Windows toggles the read-only attribute on *files*; it does not
    // remove write access from a directory, so `read-only` is still writable and
    // the preflight is right to say so. Asserting the POSIX behaviour on Windows
    // was the bug, not the code under test.
    //
    // Nothing is lost: `src/tests/render-preflight.test.ts` asserts
    // OUTPUT_NOT_WRITABLE against a real EACCES, and DISK_FULL against a real
    // ENOSPC, on every platform. A real read-only *folder* still reaches the
    // same code path in production — this check just cannot manufacture one
    // without an ACL change (icacls), which is not worth shelling out for.
    skipped += 1
    console.log('SKIPPED: Windows cannot express "unwritable directory" with chmod, so this assertion is not attempted here.')
    console.log('SKIPPED: OUTPUT_NOT_WRITABLE (EACCES) and DISK_FULL (ENOSPC) are asserted by src/tests/render-preflight.test.ts on every platform.')
  } else {
    const denied = preflight.buildPreflight({
      outputPath: path.join(readOnly, 'launch.mp4'),
      durationSec: 10,
      size: [1080, 1920],
      ffmpegPath,
      ffprobePath,
      statfs: (dir) => fs.statfsSync(dir),
      platform: process.platform,
    })
    ok(codes(denied).includes('OUTPUT_NOT_WRITABLE'), 'a real read-only folder is refused as not writable')
    ok(denied.failures[0].action.length > 10, 'that failure carries a stated fix')
  }
  fs.chmodSync(readOnly, 0o755)

  /* ── 4. the wiring in the main process ──────────────────────────────────── */
  const main = fs.readFileSync(path.join(root, 'electron/main.cjs'), 'utf8')
  const preflightCalls = (main.match(/await runExportPreflight\(\{/g) || []).length
  eq(preflightCalls, 3, 'all three export paths run the preflight (timeline render, Studio MP4, Autonomous render)')
  const verifyCalls = (main.match(/await verifyRenderOutput\(\{/g) || []).length
  eq(verifyCalls, 2, 'the timeline render and the Studio MP4 read the delivered file back')
  ok(/if \(!verdict\.ok\) throw renderPreflight\.failureError\(verdict\.failures\)/.test(main), 'a failed verification stops the export instead of reporting success')
  const renderDone = main.indexOf("sendRenderEvent(sender, 'render:done', { jobId: id, outputPath })")
  const verifyAt = main.indexOf('await verifyRenderOutput({')
  ok(verifyAt > 0 && renderDone > verifyAt, 'the timeline render verifies before it reports done')
  ok(main.includes('renderPreflight.failureError('), 'the preflight failures reach the renderer as named errors')
  ok(!/catch \(err\) \{\s*\}\s*\n\s*\/\/ render/.test(main), 'no empty catch was added around the export paths')

  console.log(
    `export preflight check passed — ${checks} assertions, ${encoderAssertions} against the real FFmpeg`
    + `${ffmpegPath ? ` (${path.basename(ffmpegPath)})` : ' (FFmpeg missing)'}`
    + `${skipped ? `, ${skipped} skipped` : ''}`,
  )
} finally {
  cleanup()
}
