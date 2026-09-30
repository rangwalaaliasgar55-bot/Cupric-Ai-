#!/usr/bin/env node
/**
 * The exported file must be the length of the edit, and the app must know it.
 *
 * The desktop export records the compositor in real time (`src/lib/studio/
 * export.ts`), so the recording can run past the end of the timeline — measured
 * on the Windows runner: a 3.0s edit produced a 3.97s file on one run and ~3.0s
 * on the next, with no code change in between. `electron/studio-trim.cjs` cuts
 * the MP4 back to the timeline; this check runs the vector the app would run,
 * with the real FFmpeg, and measures the file that comes out.
 *
 * What is asserted:
 *
 *   1. `mp4Args` — the exact argv `electron/main.cjs` passes to FFmpeg — carries
 *      the trim, and `plan` asks for the timeline's length, not the take's.
 *   2. An over-long recording really is cut: 4.4s of recording for a 3.0s edit
 *      produces a file at 3.0s, not 4.4s.
 *   3. A recording that is SHORT is left alone (FFmpeg cannot invent frames) and
 *      the plan tells verification to expect the timeline — which is how the
 *      export reports a truncated capture instead of announcing it.
 *   4. A recording inside tolerance still gets cut and still passes verification.
 *
 * Nothing here is simulated: every number comes from probing a real file written
 * by the real FFmpeg. Without FFmpeg the check says so and exits 0 with the
 * reason stated, which is how the rest of the chain treats an optional tool —
 * and `npm run media:ensure` is what makes sure CI never runs in that state.
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
const studioTrim = require(path.join(root, 'electron', 'studio-trim.cjs'))
const renderPreflight = require(path.join(root, 'electron', 'render-preflight.cjs'))

let checks = 0
const ok = (condition, label) => {
  assert.ok(condition, `FAIL: ${label}`)
  checks += 1
}

// ── ffmpeg / ffprobe, resolved the same way the app resolves them ────────────
const isWindows = process.platform === 'win32'
function resolveTool(kind) {
  const envName = kind === 'ffmpeg' ? 'CUPRIC_FFMPEG_PATH' : 'CUPRIC_FFPROBE_PATH'
  const fromEnv = process.env[envName]
  // A relative path in the environment is relative to the shell that set it, not
  // to this file, so it is resolved here before it is trusted.
  if (fromEnv) {
    const resolved = path.isAbsolute(fromEnv) ? fromEnv : path.resolve(process.cwd(), fromEnv)
    if (fs.existsSync(resolved)) return resolved
  }
  try {
    const mod = kind === 'ffmpeg' ? require('ffmpeg-static') : require('ffprobe-static').path
    if (typeof mod === 'string' && fs.existsSync(mod)) return mod
  } catch (error) {
    void error
  }
  const which = spawnSync(isWindows ? 'where' : 'which', [kind], { encoding: 'utf8' })
  const hit = which.status === 0 ? String(which.stdout).split(/\r?\n/).map((l) => l.trim()).filter(Boolean)[0] : null
  return hit && fs.existsSync(hit) ? hit : null
}

const ffmpeg = resolveTool('ffmpeg')
const ffprobe = resolveTool('ffprobe')
assert.ok(ffprobe, 'FAIL: ffprobe is required to measure the exported file (npm run media:ensure).')
checks += 1

// ── the pure half: the plan and the argv ─────────────────────────────────────
const overLong = studioTrim.plan({ docDurationSec: 3, recordingDurationSec: 4.4 })
ok(overLong.apply === true, 'a recording that runs 1.4s past a 3s edit must be cut')
ok(overLong.targetSec === 3, 'the cut is to the timeline, not to the take')
ok(overLong.expectedDurationSec === 3, 'verification is told the timeline length, so "Saved" cannot disagree with the file')
ok(/ran 1\.40s past/.test(overLong.reason), 'the reason names the overrun')

const short = studioTrim.plan({ docDurationSec: 3, recordingDurationSec: 2.2 })
ok(short.targetSec === 3, 'a short recording still has the timeline as its target')
ok(short.expectedDurationSec === 3, 'a short recording is verified against the timeline, so truncation is reported rather than announced')

const exact = studioTrim.plan({ docDurationSec: 3, recordingDurationSec: 3.05 })
ok(exact.expectedDurationSec === 3, 'a recording within tolerance is verified against the timeline')
ok(studioTrim.trimArgs(overLong).join(' ') === '-t 3.000', `the trim argument is "-t 3.000" (got "${studioTrim.trimArgs(overLong).join(' ')}")`)
ok(studioTrim.trimArgs({ targetSec: null }).length === 0, 'no target, no trim argument')

const args = studioTrim.mp4Args({
  source: 'C:\\tmp\\recording.webm',
  outputPath: 'C:\\tmp\\out.mp4',
  fps: 30,
  targetSec: 3,
  videoArgs: ['-c:v', 'libx264'],
  audioArgs: [],
})
ok(args.lastIndexOf('-t') > 0 && args[args.lastIndexOf('-t') + 1] === '3.000', 'the real MP4 argv carries the trim')
ok(args[args.length - 1] === 'C:\\tmp\\out.mp4', 'the output path is still the last argument, where FFmpeg expects it')

// ── the real half: an actual encode, measured ────────────────────────────────
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'cupric-trim-'))
const probe = (file) => {
  const result = spawnSync(ffprobe, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', file], { encoding: 'utf8' })
  const value = Number(String(result.stdout).trim())
  return Number.isFinite(value) ? value : null
}

/** A real WebM recording, the way MediaRecorder would hand one over. */
function makeRecording(name, seconds) {
  const file = path.join(work, name)
  const result = spawnSync(ffmpeg, [
    '-hide_banner', '-y', '-v', 'error',
    '-f', 'lavfi', '-i', `testsrc2=size=320x180:rate=30:duration=${seconds}`,
    '-f', 'lavfi', '-i', `sine=frequency=440:duration=${seconds}`,
    '-c:v', 'libvpx', '-b:v', '400k', '-deadline', 'realtime', '-cpu-used', '8',
    '-c:a', 'libvorbis', '-shortest',
    file,
  ], { encoding: 'utf8', timeout: 180_000 })
  assert.equal(result.status, 0, `FAIL: could not build the recording fixture: ${`${result.stdout}${result.stderr}`.trim().slice(-400)}`)
  checks += 1
  return file
}

if (!ffmpeg) {
  console.log('SKIPPED: FFmpeg was not found in this checkout (optional dependency, downloaded at install time).')
  console.log('SKIPPED: the plan assertions above ran; the real encode and the trim did NOT.')
  console.log('SKIPPED: run `npm run media:ensure`, or set CUPRIC_FFMPEG_PATH, to run them.')
  console.log(`studio trim check passed — ${checks} assertions, encode skipped (no FFmpeg)`)
  process.exit(0)
}

function exportWith(args) {
  const result = spawnSync(ffmpeg, args, { encoding: 'utf8', timeout: 240_000 })
  const output = args[args.length - 1]
  assert.equal(result.status, 0, `FAIL: FFmpeg refused the export: ${`${result.stdout}${result.stderr}`.trim().slice(-500)}`)
  assert.ok(fs.existsSync(output) && fs.statSync(output).size > 1000, 'FAIL: FFmpeg reported success but the file is missing or empty')
  checks += 2
  return output
}

const videoArgs = ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '28', '-pix_fmt', 'yuv420p']

// 1. over-long recording → the file is the timeline's length
{
  const recording = makeRecording('over-long.webm', 4.4)
  const recordedSec = probe(recording)
  ok(recordedSec !== null && recordedSec > 4.0, `the fixture really is over-long (${recordedSec}s)`)

  const plan = studioTrim.plan({ docDurationSec: 3, recordingDurationSec: recordedSec })
  ok(plan.apply === true, 'a 4.4s recording for a 3s edit is planned for a cut')

  const output = path.join(work, 'over-long.mp4')
  exportWith(studioTrim.mp4Args({ source: recording, outputPath: output, fps: 30, targetSec: plan.targetSec, videoArgs, audioArgs: [] }))
  const actualSec = probe(output)
  ok(actualSec !== null, 'the exported file has a measurable duration')
  ok(actualSec < 3.2, `the export was cut to the timeline (${actualSec.toFixed(2)}s, was ${recordedSec.toFixed(2)}s)`)
  ok(actualSec > 2.9, `the export was not over-cut (${actualSec.toFixed(2)}s)`)

  const verdict = renderPreflight.verifyExport(
    { durationSec: actualSec, hasAudio: true, streams: [{ codec_type: 'video', codec_name: 'h264' }, { codec_type: 'audio', codec_name: 'aac' }] },
    { durationSec: plan.expectedDurationSec, toleranceSec: plan.toleranceSec, needsVideo: true, needsAudio: true, sizeBytes: fs.statSync(output).size },
  )
  ok(verdict.ok === true, `the cut file passes the app's own verification (${JSON.stringify(verdict.checks)})`)
}

// 2. a recording shorter than the edit → left alone, and verification says so
{
  const recording = makeRecording('short.webm', 2.2)
  const recordedSec = probe(recording)
  const plan = studioTrim.plan({ docDurationSec: 3, recordingDurationSec: recordedSec })
  const output = path.join(work, 'short.mp4')
  exportWith(studioTrim.mp4Args({ source: recording, outputPath: output, fps: 30, targetSec: plan.targetSec, videoArgs, audioArgs: [] }))
  const actualSec = probe(output)
  ok(actualSec < 2.6, `a short capture cannot be extended (${actualSec.toFixed(2)}s from a ${recordedSec.toFixed(2)}s recording)`)

  const verdict = renderPreflight.verifyExport(
    { durationSec: actualSec, hasAudio: true, streams: [{ codec_type: 'video' }, { codec_type: 'audio' }] },
    { durationSec: plan.expectedDurationSec, toleranceSec: plan.toleranceSec, needsVideo: true, needsAudio: false, sizeBytes: fs.statSync(output).size },
  )
  ok(verdict.ok === false, 'a truncated capture fails verification')
  ok(verdict.failures.some((failure) => failure.code === 'WRONG_DURATION'), `and it fails with WRONG_DURATION (got ${verdict.failures.map((f) => f.code).join(',')})`)
  ok(/timeline is 3\.0s/.test(verdict.failures.find((f) => f.code === 'WRONG_DURATION').message), 'the message names the timeline, which is what the user edited')
}

// 3. a recording inside tolerance → still cut, still passes
{
  const recording = makeRecording('exact.webm', 3.05)
  const recordedSec = probe(recording)
  const plan = studioTrim.plan({ docDurationSec: 3, recordingDurationSec: recordedSec })
  const output = path.join(work, 'exact.mp4')
  exportWith(studioTrim.mp4Args({ source: recording, outputPath: output, fps: 30, targetSec: plan.targetSec, videoArgs, audioArgs: [] }))
  const actualSec = probe(output)
  ok(actualSec !== null && Math.abs(actualSec - 3) <= plan.toleranceSec, `an in-tolerance recording lands on the timeline (${actualSec.toFixed(2)}s)`)
}

fs.rmSync(work, { recursive: true, force: true })
console.log(`studio trim check passed — ${checks} assertions, 3 against the real FFmpeg (${path.basename(ffmpeg)})`)
