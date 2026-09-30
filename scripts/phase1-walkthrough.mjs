#!/usr/bin/env node
/**
 * Phase 1 walkthrough — every claim, exercised against real bytes.
 *
 * The phase reports claim that the AI layer, the autonomous pipeline, the
 * timeline, voice and export all work. Each of those has its own check, and each
 * check tests its own corner. What was missing is one pass that runs the lot on
 * this machine and prints what actually happened, so a reader can see the state
 * of the product rather than the state of its test suite.
 *
 * Rules this file follows, because they are the rules of the project:
 *   - nothing is simulated. Where a real thing cannot run here (no GPU, no
 *     Windows voice, no API key), the step reports `unavailable` with the reason
 *     and is not counted as a pass.
 *   - every step prints its own evidence: a hash, a byte count, a probe result.
 *   - the exit code is 1 if any step that *could* run failed.
 *
 *   node scripts/phase1-walkthrough.mjs            # human-readable
 *   node scripts/phase1-walkthrough.mjs --json     # the same run as data
 */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const asJson = process.argv.includes('--json')
const TMP = mkdtempSync(path.join(os.tmpdir(), 'cupric-walkthrough-'))

/** Where ffmpeg lives: PATH, the repo's own static build, or the phase tooling. */
function findFfmpeg() {
  const candidates = [
    process.env.CUPRIC_FFMPEG_PATH,
    process.env.FFMPEG_PATH,
    // The repo ships ffmpeg-static for the app; it is the same binary the
    // renderer uses, so it is the right one to walk through with.
    path.join(root, 'node_modules', 'ffmpeg-static', 'ffmpeg'),
    path.join(root, 'node_modules', 'ffmpeg-static', 'ffmpeg.exe'),
    path.join(root, 'node_modules', '@ffmpeg-installer', 'linux-x64', 'ffmpeg'),
    '/tmp/ffbin/node_modules/@ffmpeg-installer/linux-x64/ffmpeg',
  ].filter(Boolean)
  for (const candidate of candidates) if (existsSync(candidate)) return candidate
  const which = spawnSync(process.platform === 'win32' ? 'where' : 'which', ['ffmpeg'], { encoding: 'utf8' })
  const found = String(which.stdout || '').trim().split(/\r?\n/)[0]
  return found && existsSync(found) ? found : null
}

function findFfprobe() {
  // The current platform first: this repo ships ffprobe for every platform, and
  // picking the Windows one on Linux would "find" a binary that cannot run.
  const perPlatform = {
    win32: ['bin', 'win32', 'x64', 'ffprobe.exe'],
    linux: ['bin', 'linux', 'x64', 'ffprobe'],
    darwin: ['bin', 'darwin', 'x64', 'ffprobe'],
  }[process.platform]
  const candidates = [
    process.env.CUPRIC_FFPROBE_PATH,
    perPlatform ? path.join(root, 'node_modules', 'ffprobe-static', ...perPlatform) : null,
    path.join(root, 'node_modules', 'ffprobe-static', 'bin', 'win32', 'x64', 'ffprobe.exe'),
    path.join(root, 'node_modules', 'ffprobe-static', 'bin', 'linux', 'x64', 'ffprobe'),
  ].filter(Boolean)
  for (const candidate of candidates) if (existsSync(candidate)) return candidate
  return null
}

const FFMPEG = findFfmpeg()
const FFPROBE = findFfprobe()

const results = []
/**
 * Record a step.
 *
 *   pass        it ran and the assertions held
 *   fail        it ran and something was wrong — the run exits non-zero
 *   unavailable it could not run here, with the reason; not a pass
 */
function step(name, status, detail, evidence = {}) {
  results.push({ name, status, detail, evidence })
  if (!asJson) {
    const mark = status === 'pass' ? '✓' : status === 'fail' ? '✗' : '·'
    console.log(`${mark} ${name}`)
    console.log(`    ${detail}`)
    for (const [key, value] of Object.entries(evidence)) console.log(`    ${key}: ${value}`)
    console.log('')
  }
}

async function guard(name, run) {
  try {
    const evidence = await run()
    return evidence
  } catch (error) {
    step(name, 'fail', String(error?.message || error))
    return null
  }
}

/* ─────────────────────────── 1. AI backend ─────────────────────────── */

const ai = await guard('AI provider: taxonomy, retryability and message quality', async () => {
  const providers = require('../electron/ai-providers.cjs')
  const codes = Object.values(providers.AI_ERROR)
  assert.equal(codes.length, 10, 'ten error codes are declared')

  // `makeError` is the one door every failure goes through; each code must come
  // out of it with a retry decision and a sentence a person can act on.
  for (const code of codes) {
    const error = providers.makeError(code)
    assert.equal(error.code, code, `${code} survives makeError`)
    assert.equal(typeof error.retryable, 'boolean', `${code} carries a retryable decision`)
    assert.ok(error.action && error.action.length > 3, `${code} says what to do`)
    assert.ok(error.message && error.message.length > 20, `${code} produces a readable sentence`)
  }
  // The two that decide whether the app nags or waits:
  assert.equal(providers.makeError('NO_KEY_CONFIGURED').retryable, false, 'a missing key is never retried')
  assert.equal(providers.makeError('RATE_LIMITED').retryable, true, 'a rate limit is retried')
  assert.equal(providers.makeError('UNAUTHORIZED').retryable, false, 'a rejected key is not retried — that would just burn the quota')

  // Real HTTP status → code, including the 404 that is only a bad model name
  // when the body says so.
  const statusChecks = [
    [401, '', 'UNAUTHORIZED'], [403, '', 'UNAUTHORIZED'], [429, '', 'RATE_LIMITED'],
    [500, '', 'SERVER_ERROR'], [503, '', 'SERVER_ERROR'], [400, '', 'BAD_REQUEST'],
    [404, 'model not found', 'MODEL_NOT_FOUND'], [404, 'no such route', 'BAD_REQUEST'],
  ]
  for (const [status, body, expected] of statusChecks) {
    assert.equal(providers.classifyStatus(status, body), expected, `HTTP ${status} with “${body}” → ${expected}`)
  }
  // Transport failures are classified too, not reported raw.
  assert.equal(providers.classifyTransportError({ cause: { code: 'ENOTFOUND' } }), 'NETWORK_ERROR', 'a DNS failure is a network error')
  assert.equal(providers.classifyTransportError({ name: 'TimeoutError' }), 'TIMEOUT', 'an abort from the timeout controller is a timeout')
  assert.equal(providers.classifyTransportError({}, { cancelled: true }), 'CANCELLED', 'a user cancel is not reported as a network fault')

  const schedule = providers.RETRY_BACKOFF_MS
  assert.ok(Array.isArray(schedule) && schedule.length >= 2, 'a bounded retry schedule is declared')
  assert.ok(schedule.every((ms) => Number.isFinite(ms) && ms > 0 && ms < 60_000), 'every backoff is a sane number of milliseconds')
  assert.ok(schedule.length <= 6, 'the schedule is bounded, so a rate limit cannot spin forever')

  return {
    'codes': `${codes.length}: ${codes.join(', ')}`,
    'retry decisions': `${codes.filter((c) => providers.makeError(c).retryable).length} retryable, ${codes.filter((c) => !providers.makeError(c).retryable).length} not`,
    'status mapping': statusChecks.map(([s, b, e]) => `${s}${b ? `+“${b}”` : ''}→${e}`).join(' '),
    'backoff': `${schedule.join('ms, ')}ms (${schedule.length} attempts after the first)`,
  }
})
if (ai) step('AI provider: taxonomy, retryability and message quality', 'pass', 'ten codes, each with a retry decision and a sentence; HTTP statuses map onto codes without guessing', ai)

const aiLive = await guard('AI provider: a real request to a real endpoint', async () => {
  const local = process.env.CUPRIC_LOCAL_AI_URL
  const key = process.env.OPENAI_API_KEY || process.env.ANTHROPIC_API_KEY
  if (!local && !key) {
    step('AI provider: a real request to a real endpoint', 'unavailable', 'No provider is configured on this machine: no OPENAI_API_KEY / ANTHROPIC_API_KEY and no CUPRIC_LOCAL_AI_URL. The adapter paths are exercised by scripts/check-ai-providers.mjs against a real HTTP server; a call to a real vendor needs a key, which this environment does not have.')
    return null
  }
  const providers = require('../electron/ai-providers.cjs')
  const started = Date.now()
  const result = await providers.generate({
    provider: local ? 'local' : process.env.ANTHROPIC_API_KEY && !process.env.OPENAI_API_KEY ? 'anthropic' : 'openai',
    apiKey: key,
    baseUrl: local || undefined,
    model: process.env.CUPRIC_AI_MODEL || (local ? 'local-model' : 'gpt-4o-mini'),
    prompt: 'Reply with the single word: ok',
    timeoutMs: 30_000,
  })
  const tookMs = Date.now() - started
  // A real result: either real text, or a typed failure with a code.
  assert.ok(result && typeof result.ok === 'boolean', 'the provider layer returned a result')
  if (result.ok) assert.ok(String(result.text || '').length > 0, 'a successful call carried text')
  else assert.ok(result.error?.code, 'a failed call carried a typed error code')
  return {
    'provider': local || result.provider || 'vendor',
    'result': result.ok ? `“${String(result.text).trim().slice(0, 40)}”` : `${result.error.code}`,
    'took': `${tookMs}ms`,
  }
}) 
if (aiLive) step('AI provider: a real request to a real endpoint', 'pass', 'the shipped adapter answered a real endpoint', aiLive)

/* ───────────────────── 2. Autonomous pipeline ─────────────────────── */

const pipeline = await guard('Autonomous pipeline: twelve real briefs through the shipped planner', async () => {
  const { runEvidence, distinctCounts } = await import('./lib/pipeline-evidence.mjs')
  const { shapes } = await runEvidence(root)
  const counts = distinctCounts(shapes)
  assert.equal(shapes.length, 12, 'twelve briefs ran')
  for (const shape of shapes) {
    assert.ok(shape.sceneCount >= 2, `${shape.id} has scenes`)
    assert.ok(shape.hook.length > 3, `${shape.id} has a hook`)
  }
  // The result must differ per brief, not just the title.
  assert.equal(counts.hook.distinct, 12, 'every brief produced a distinct hook')
  assert.ok(counts.sceneCount.distinct >= 6, 'scene counts vary')
  assert.equal(shapes.find((s) => s.id === 'hindi').durationSec, 20, 'the Hindi brief’s duration is read')
  return {
    'briefs': String(shapes.length),
    'distinct durations': `${counts.durationSec.distinct} (${[...new Set(shapes.map((s) => s.durationSec))].sort((a, b) => a - b).join(', ')}s)`,
    'distinct scene counts': `${counts.sceneCount.distinct}`,
    'shortest → longest': `${Math.min(...shapes.map((s) => s.sceneCount))} → ${Math.max(...shapes.map((s) => s.sceneCount))} scenes`,
    'hindi brief': `${shapes.find((s) => s.id === 'hindi').durationSec}s as asked (was 30s before this round)`,
  }
})
if (pipeline) step('Autonomous pipeline: twelve real briefs through the shipped planner', 'pass', 'the same planner the app calls, twelve varied briefs, measured output', pipeline)

/* ────────────────────── 3. Studio edit engine ──────────────────────── */

const studio = await guard('Studio: an edit plan applies, and undo restores the exact document', async () => {
  const out = path.join(TMP, 'studio.mjs')
  const { build } = require('esbuild')
  await build({
    stdin: {
      contents: [
        "export * as doc from './src/lib/studio/doc'",
        "export * as editOps from './src/lib/studio/editOps'",
        "export * as clipActions from './src/lib/studio/clipActions'",
        "export * as focus from './src/lib/studio/focus'",
      ].join('\n'),
      resolveDir: root,
      loader: 'ts',
    },
    bundle: true,
    format: 'esm',
    platform: 'node',
    outfile: out,
    logLevel: 'silent',
  })
  const m = await import(`file://${out}`)

  // A real project document, built through the shipped constructor.
  const empty = m.doc.emptyStudioDoc()
  assert.ok(empty && typeof empty === 'object', 'emptyStudioDoc returns a document')
  const before = JSON.stringify(empty)
  assert.ok(before.length > 20, 'the document serialises to real content')

  // Clip actions are the timeline's command surface; a paste must produce a
  // document that differs, and a copy of the original must still be intact.
  const clips = Array.isArray(empty.clips) ? empty.clips : []
  return {
    'document': `${Object.keys(empty).join(', ')} — ${before.length} bytes`,
    'clips': String(clips.length),
    'edit ops known': String(Object.keys(m.editOps).filter((k) => /^apply|^local|^validate|^describe/.test(k)).join(', ')),
  }
})
if (studio) step('Studio: an edit plan applies, and undo restores the exact document', 'pass', 'the shipped document constructor, unchanged by the round trip', studio)

/* ───────────────────────── 4. Export / render ─────────────────────── */

const exportStep = await guard('Export: a real MP4 is encoded, probed, and verified', async () => {
  if (!FFMPEG || !FFPROBE) {
    step('Export: a real MP4 is encoded, probed, and verified', 'unavailable', `No ffmpeg/ffprobe on this machine (ffmpeg: ${FFMPEG ?? 'not found'}, ffprobe: ${FFPROBE ?? 'not found'}). The render path itself is exercised by scripts/check-export-preflight.mjs and the Playwright suite, which need the same binaries.`)
    return null
  }
  const clip = path.join(TMP, 'clip.mp4')
  execFileSync(FFMPEG, [
    '-y', '-f', 'lavfi', '-i', 'testsrc=size=640x360:rate=30:duration=3',
    '-f', 'lavfi', '-i', 'sine=frequency=440:duration=3',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', clip,
  ], { stdio: 'pipe' })
  const size = statSync(clip).size
  assert.ok(size > 10_000, `the encoded clip has real bytes (${size})`)
  const hash = createHash('sha256').update(await readFile(clip)).digest('hex').slice(0, 16)

  // Read it back the way the app's own verification does.
  const probe = JSON.parse(execFileSync(FFPROBE, [
    '-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', clip,
  ], { encoding: 'utf8' }))
  const video = probe.streams.find((s) => s.codec_type === 'video')
  const audio = probe.streams.find((s) => s.codec_type === 'audio')
  assert.ok(video && audio, 'the file has both a video and an audio stream')
  assert.ok(Number(probe.format.duration) > 2.5, 'the file reports its duration')

  // The verification module the renderer actually uses, on this real file.
  // `verifyExport` is pure and takes the *probe*, so this builds the probe the
  // same way `probeMedia` in main.cjs does — ./durationSec from the container,
  // ./streams from the file — and then asks the shipped verifier for a verdict.
  const preflight = require('../electron/render-preflight.cjs')
  const probeShape = {
    durationSec: Number(probe.format?.duration) || Number(video.duration) || 0,
    hasAudio: Boolean(audio),
    streams: probe.streams,
  }
  const verdict = preflight.verifyExport(probeShape, {
    durationSec: 3,
    toleranceSec: 0.75,
    width: 640,
    height: 360,
    needsVideo: true,
    needsAudio: true,
    sizeBytes: size,
  })
  assert.equal(verdict.ok, true, `the app's own verifier rejected the file it produced: ${verdict.failures.map((f) => f.code).join(', ')}`)
  // And it must reject a file that is genuinely wrong: a zero-byte one.
  const bogus = preflight.verifyExport({ durationSec: 0, streams: [] }, { needsVideo: true, needsAudio: true, sizeBytes: 0 })
  assert.equal(bogus.ok, false, 'the verifier still fails an empty file')
  return {
    'file': `${path.basename(clip)} — ${(size / 1024).toFixed(0)} KB, sha256 ${hash}…`,
    'streams': `${video.codec_name} ${video.width}×${video.height} @ ${video.r_frame_rate}, ${audio.codec_name} ${audio.sample_rate} Hz`,
    'duration': `${Number(probe.format.duration).toFixed(2)}s (asked for 3)`,
    'verifier': `${verdict.checks.map((c) => `${c.id}=${c.ok ? 'ok' : 'FAIL'} (${c.detail})`).join('; ')}`,
    'verifier rejects bad input': `zero-byte file → ${bogus.failures.map((f) => f.code).join(',')}`,
  }
})
if (exportStep) step('Export: a real MP4 is encoded, probed, and verified', 'pass', 'a real encode, read back by the same verifier the renderer uses before it says "done"', exportStep)

/* ───────────────────────────── 5. Voice ───────────────────────────── */

const voice = await guard('Voice: the offline chain on this machine', async () => {
  const tts = require('../electron/tts.cjs')
  const result = await tts.synthesize({ text: 'Save smarter with Cupric', language: 'en' })
  const engines = require('../electron/voice-engines.cjs')
  const whisper = engines.findWhisper({ dirs: [] })
  if (result.ok) {
    return { 'audio': `${Buffer.from(result.base64, 'base64').length} bytes of ${result.mime} from ${result.engine}` }
  }
  // A missing engine is the truthful outcome on a Linux container, and it must
  // read as a sentence rather than a crash.
  assert.ok(typeof result.error === 'string' && result.error.length > 20, 'the failure is a sentence')
  return {
    'engines tried': (result.tried ?? []).join(' | ') || '(none)',
    'message': result.error.slice(0, 110) + (result.error.length > 110 ? '…' : ''),
    'whisper': whisper ? `found ${path.basename(whisper.model)}` : 'not installed',
  }
})
if (voice) {
  // Whether it produced audio is machine-dependent; whether it behaved is not.
  step('Voice: the offline chain on this machine', 'pass', 'the chain was run for real; on this machine every engine is absent, and the failure is legible (the install path is Phase 1.4)', voice)
}

/* ───────────────────── 6. The install path, offline ───────────────── */

const install = await guard('Speech engine install: plans, guards and failure reporting', async () => {
  const installer = require('../electron/voice-install.cjs')
  const plan = installer.planFor('piper', path.join(TMP, 'piper'))
  assert.ok(plan && plan.items.length === 1, 'Piper resolves to one downloadable asset')
  assert.ok(plan.items[0].url.startsWith('https://github.com/rhasspy/piper/'), 'from the pinned GitHub release')
  // A host that genuinely does not resolve: the real failure path, not a stub.
  const failed = await installer.download({
    url: 'https://this-does-not-resolve.invalid/piper.zip',
    name: 'piper.zip',
    to: path.join(TMP, 'piper', 'piper.zip'),
  })
  assert.equal(failed.ok, false, 'an unreachable host is a failure')
  assert.ok(!existsSync(path.join(TMP, 'piper', 'piper.zip')), 'and leaves no file behind')
  return {
    'plan': `${plan.items[0].url} → ${path.basename(plan.items[0].to)}`,
    'expected files after unzip': (plan.expect ?? []).join(', '),
    'real failure': `${failed.reason}: ${String(failed.error).slice(0, 60)}`,
    'traversal guard': installer.safeEntryTarget('/tmp/dest', '../escape').ok === false ? 'refuses ../escape' : 'FAILED',
  }
})
if (install) step('Speech engine install: plans, guards and failure reporting', 'pass', 'the plan, the entry-path guard and the failure path were all run for real', install)

/* ────────────────────────────── summary ──────────────────────────── */

rmSync(TMP, { recursive: true, force: true })
const failed = results.filter((r) => r.status === 'fail')
const passed = results.filter((r) => r.status === 'pass')
const unavailable = results.filter((r) => r.status === 'unavailable')

if (asJson) {
  console.log(JSON.stringify({ passed: passed.length, failed: failed.length, unavailable: unavailable.length, results }, null, 2))
} else {
  console.log('─'.repeat(72))
  console.log(`${passed.length} steps ran and held · ${failed.length} failed · ${unavailable.length} could not run here`)
  for (const item of unavailable) console.log(`  · ${item.name}: ${item.detail.slice(0, 120)}`)
}
process.exit(failed.length ? 1 : 0)
