/**
 * Voice grammar guard rails.
 *
 * The expensive failure in this product is not a missed command — it is the app
 * hearing half a sentence and autonomously spending model budget on it. So the
 * negative cases below matter more than the positive ones, and this runs as
 * part of `npm run build`.
 */
import { build } from 'esbuild'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const dir = await mkdtemp(path.join(tmpdir(), 'cupric-voice-'))
const outfile = path.join(dir, 'voice.mjs')
await build({
  entryPoints: ['src/lib/voice.ts'],
  outfile,
  bundle: true,
  format: 'esm',
  platform: 'neutral',
  logLevel: 'silent',
})
const voice = await import(pathToFileURL(outfile).href)
const { parseVoiceCommand, shouldAutoStartBrief } = voice

let failures = 0
let checks = 0
function check(label, actual, expected) {
  checks += 1
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (!ok) {
    failures += 1
    console.error(`  FAIL ${label}\n    expected ${JSON.stringify(expected)}\n    actual   ${JSON.stringify(actual)}`)
  }
}

// --- must NOT auto-start ---------------------------------------------------
const mustNotStart = [
  'make a video',                                   // the bare request itself
  'make a video',                                   // repeated: still no
  'okay so make a video about',                     // trailing preposition
  'I was thinking we should make a video and',      // trailing conjunction
  'um',                                             // filler
  'so I want a',                                    // trailing article
  'hey cupric make me a short video',               // still only a request
  'and then make a video for the',                  // mid-thought
  'create a promo,',                                // recogniser heard a comma
  'let us make a video um',                         // hesitation at the end
  'add text hello world right now',                 // an editor command, not a brief
  'play',                                           // command
  '',                                               // nothing
  '   ',                                            // whitespace
  'a new video please',                             // under the word floor
]
for (const phrase of mustNotStart) check(`no-start: "${phrase}"`, shouldAutoStartBrief(phrase), false)

// --- must auto-start -------------------------------------------------------
const mustStart = [
  'make a video about our new pricing page for small teams',
  'a thirty second promo for the Cupric AI launch with bold captions',
  'short reel showing the studio timeline and the glass effects',
  'explain how liquid glass backgrounds work in under twenty seconds',
]
for (const phrase of mustStart) check(`start: "${phrase}"`, shouldAutoStartBrief(phrase), true)

// --- grammar: specific commands still beat the make-video catch-all --------
check('parse play', parseVoiceCommand('play')?.type, 'play')
check('parse add text', parseVoiceCommand('add text hello')?.type, 'add-text')
check('parse make-video brief', parseVoiceCommand('make a video about our new pricing page'), {
  type: 'make-video',
  brief: 'our new pricing page',
})
check('bare make a video is not a command', parseVoiceCommand('make a video'), null)

/* ——— humanised errors ——— */
const errBuild = await build({
  entryPoints: ['src/lib/humanError.ts'],
  outfile: path.join(dir, 'err.mjs'),
  bundle: true,
  format: 'esm',
  platform: 'neutral',
  logLevel: 'silent',
})
void errBuild
const { humanError } = await import(pathToFileURL(path.join(dir, 'err.mjs')).href)

const readable = (label, input) => {
  checks += 1
  const out = humanError(input, 'Export')
  const bad =
    !out ||
    out.length > 200 ||
    !/[.!?…]$/.test(out) ||
    /\bundefined\b|\bnull\b|\[object|Error:|at .*\(/.test(out) ||
    /^[a-z]/.test(out)
  if (bad) {
    failures += 1
    console.error(`  FAIL humanError ${label} → "${out}"`)
  }
}
readable('empty error', new Error(''))
readable('null', null)
readable('an object', {})
readable('a stack-looking string', 'TypeError: x is not a function\n    at foo (bundle.js:1:2)')
readable('ENOENT', new Error("ENOENT: no such file or directory, open '/tmp/x.mp4'"))
readable('a rate limit', new Error('429 RESOURCE_EXHAUSTED: quota exceeded for model'))
readable('a network failure', new Error('fetch failed'))
readable('a very long message', new Error('x'.repeat(600)))
readable('an already-human message', new Error('This file lives on disk — open the desktop app to use it in the Studio'))

// The specific cases must not fall through to the generic wording.
checks += 1
if (!/disk is full/i.test(humanError(new Error('ENOSPC: no space left on device')))) {
  failures += 1
  console.error('  FAIL humanError: ENOSPC should mention the disk being full')
}
checks += 1
if (!/API key/i.test(humanError(new Error('401 Unauthorized')))) {
  failures += 1
  console.error('  FAIL humanError: a 401 should point at the API key')
}

// --- listener: an unrecoverable error is reported once and never loops ------
{
  const { VoiceListener, voiceErrorMessage } = voice
  let instances = 0
  class FakeRecognition {
    constructor() { instances += 1; this.starts = 0 }
    start() {
      this.starts += 1
      if (this.starts > 20) throw new Error('runaway restart')
      // Chromium in Electron: every session fails with `network`, then ends.
      queueMicrotask(() => { this.onerror?.({ error: 'network' }); queueMicrotask(() => this.onend?.()) })
    }
    stop() {}
  }
  globalThis.window = { SpeechRecognition: FakeRecognition }
  const errors = []
  let ended = 0
  const listener = new VoiceListener({ onTranscript() {}, onCommand() {}, onError: (m) => errors.push(m), onEnd: () => { ended += 1 } })
  listener.start()
  await new Promise((r) => setTimeout(r, 30))
  check('network error reported exactly once', errors.length, 1)
  check('network error does not restart the session', listener.active, false)
  check('listener ends cleanly', ended, 1)
  check('network message is human, not a raw code', /type your brief/i.test(errors[0] ?? '') && !/error: network/i.test(errors[0] ?? ''), true)
  for (const code of ['network', 'not-allowed', 'audio-capture', 'restart-loop', 'weird-new-code']) {
    const msg = voiceErrorMessage(code)
    check(`voice message for ${code} is short and code-free`, msg.length > 20 && msg.length <= 200 && !msg.includes(code), true)
  }

  // A transient error that keeps ending the session must also stop, once.
  class FlakyRecognition {
    start() { queueMicrotask(() => { this.onerror?.({ error: 'no-speech' }); queueMicrotask(() => this.onend?.()) }) }
    stop() {}
  }
  globalThis.window = { SpeechRecognition: FlakyRecognition }
  const flakyErrors = []
  const flaky = new VoiceListener({ onTranscript() {}, onCommand() {}, onError: (m) => flakyErrors.push(m) })
  flaky.start()
  await new Promise((r) => setTimeout(r, 30))
  check('restart loop is detected and stopped', flaky.active, false)
  check('restart loop is reported once', flakyErrors.length, 1)
  delete globalThis.window
}

{
  // A spoken brief must wait for confirmation before an autonomous job starts.
  const { readFileSync } = await import('node:fs')
  const studio = readFileSync('src/screens/Studio.tsx', 'utf8')
  const caseBody = studio.slice(studio.indexOf("case 'make-video'"), studio.indexOf("case 'undo'"))
  check('make-video does not start a job directly', caseBody.includes('startAutomationJob('), false)
  check('make-video asks for confirmation', caseBody.includes('setPendingBrief(command.brief)'), true)
  check('confirmation banner offers Start/Cancel', /Confirm voice brief[\s\S]{0,600}Start job[\s\S]{0,200}Cancel/.test(studio), true)
  check('spoken yes/cancel answer the pending brief', /answerPending\(transcript\)\) return/.test(studio), true)
}

await rm(dir, { recursive: true, force: true })

if (failures) {
  console.error(`\nvoice check FAILED — ${failures} of ${checks} assertions`)
  process.exit(1)
}
console.log(`voice and error-copy check passed — ${checks} assertions (${mustNotStart.length} false-positive guards)`)
