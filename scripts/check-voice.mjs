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

await rm(dir, { recursive: true, force: true })

if (failures) {
  console.error(`\nvoice check FAILED — ${failures} of ${checks} assertions`)
  process.exit(1)
}
console.log(`voice check passed — ${checks} assertions (${mustNotStart.length} false-positive guards)`)
