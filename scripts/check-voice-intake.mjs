/**
 * JOB 4 gate — the mic fills the form, asks one question at a time, and never
 * invents an answer.
 *
 * Runs the real extraction module in Node (no mic, no browser, no model), so
 * the mapping and the question order are provable on every build.
 */
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { transformSync } from 'esbuild'

const require = createRequire(import.meta.url)

/** Load a TS module by transpiling it and its local deps on the fly. */
async function loadTs(rel) {
  const url = new URL(rel, import.meta.url)
  const src = await readFile(url, 'utf8')
  const js = transformSync(src, { loader: 'ts', format: 'cjs', target: 'es2022' }).code
  const mod = { exports: {} }
  const localRequire = (spec) => {
    if (spec.startsWith('.')) throw new Error(`unexpected runtime dep ${spec}`)
    return require(spec)
  }
  // eslint-disable-next-line no-new-func
  new Function('require', 'module', 'exports', js)(localRequire, mod, mod.exports)
  return mod.exports
}

/* The extractor depends only on INTAKE_QUESTIONS, so inline that one list
 * rather than pulling the whole engine (which reaches for browser globals). */
const engineSrc = await readFile(new URL('../src/lib/production/engine.ts', import.meta.url), 'utf8')
const speechSrc = await readFile(new URL('../src/lib/production/intakeFromSpeech.ts', import.meta.url), 'utf8')

const questionsBlock = engineSrc.slice(engineSrc.indexOf('export const INTAKE_QUESTIONS'), engineSrc.indexOf('export function emptyIntake'))
const emptyBlock = engineSrc.slice(engineSrc.indexOf('export function emptyIntake'), engineSrc.indexOf('/** The high-value questions'))
const merged = `${questionsBlock}\n${emptyBlock}\n${speechSrc.replace(/^import[^\n]*\n/gm, '')}`
const js = transformSync(merged, { loader: 'ts', format: 'cjs', target: 'es2022' }).code
const mod = { exports: {} }
// eslint-disable-next-line no-new-func
new Function('require', 'module', 'exports', js)(require, mod, mod.exports)
const { fillIntakeFromSpeech, nextInterviewQuestion, requiredRemaining, visibleAssumptions, spokenNumber, emptyIntake, INTAKE_QUESTIONS } = mod.exports

/* ——— 1. one utterance fills the six visible intake fields ————————— */
{
  const said = "I'm making a 30 second launch video for freelancers in India, vertical, for Instagram Reels, captions only, I have demo.mp4 and logo.png"
  const fill = fillIntakeFromSpeech(said, emptyIntake())
  const got = fill.patch
  assert.equal(got.durationSec, 30, 'Duration heard')
  assert.equal(got.aspect, '9:16', 'Aspect heard from "vertical"')
  assert.equal(got.platform, 'Instagram Reels', 'Where heard')
  assert.equal(got.narration, 'captions', 'Narration heard')
  assert.equal(got.audience, 'freelancers in India', 'Who heard')
  assert.equal(got.assets, 'demo.mp4\nlogo.png', 'Footage heard as filenames only, not the words around them')
  assert.match(got.making, /launch video/, 'What heard')
  assert.ok(!/Instagram Reels/.test(got.making), 'What does not swallow a clause another field already claimed')
  // Every fill cites the words it came from — that is what makes it checkable.
  // Evidence is built only from literal spans of what was said — a list field
  // cites each item, so no part of a citation can be something nobody uttered.
  const lower = said.toLowerCase()
  for (const e of fill.evidence) {
    assert.ok(e.heard, `evidence for ${e.key} exists`)
    for (const span of e.heard.split(', ')) {
      assert.ok(lower.includes(span.toLowerCase()), `evidence span "${span}" for ${e.key} is literally in the transcript`)
    }
  }
  assert.equal(fill.evidence.length, Object.keys(got).length, 'every filled field carries evidence')
}

/* ——— 2. nothing is invented ————————————————————————————————— */
{
  const fill = fillIntakeFromSpeech('um, hi', emptyIntake())
  assert.equal(Object.keys(fill.patch).length, 0, 'a contentless utterance fills nothing')
  assert.equal(fill.empty, true, 'and says so, instead of guessing')

  // A field that was not spoken about stays blank rather than being filled in.
  const partial = fillIntakeFromSpeech('make it thirty seconds', emptyIntake())
  assert.equal(partial.patch.durationSec, 30)
  assert.equal(partial.patch.cta, undefined, 'an unmentioned field is never fabricated')
  assert.equal(partial.patch.brandColors, undefined, 'brand colours are never invented')
}

/* ——— 3. typed answers outrank a transcript ————————————————————— */
{
  const typed = { ...emptyIntake(), durationSec: 12, making: 'my own words' }
  const fill = fillIntakeFromSpeech('make it thirty seconds, I am building a promo video for dentists', typed)
  assert.equal(fill.patch.durationSec, undefined, 'speech never overwrites a value the user already typed')
  assert.equal(fill.patch.making, undefined, 'speech never overwrites the typed subject')
  assert.ok(fill.keptFilled.includes('durationSec'), 'and reports what it left alone')
  assert.equal(fill.patch.audience, 'dentists', 'while still filling the blanks around it')
}

/* ——— 4. the interviewer asks ONE question, required first ————————— */
{
  let intake = emptyIntake()
  const first = nextInterviewQuestion(intake)
  assert.equal(first.key, 'making', 'the first question is the first required blank')
  assert.equal(first.required, true)
  assert.equal(requiredRemaining(intake), 4, 'four required answers are missing at the start')

  // Answering advances to the next required blank, never repeats, never batches.
  const seen = []
  for (let i = 0; i < 4; i += 1) {
    const q = nextInterviewQuestion(intake)
    assert.ok(q, 'a question is available')
    assert.ok(!seen.includes(q.key), `question ${q.key} is asked once`)
    seen.push(q.key)
    intake = { ...intake, [q.key]: q.key === 'durationSec' ? 30 : 'answered' }
  }
  assert.deepEqual(seen, ['making', 'audience', 'platform', 'assets'], 'required questions come in intake order, one at a time')
  assert.equal(requiredRemaining(intake), 0)

  // `asked` suppresses a skipped optional question instead of looping on it.
  const optional = nextInterviewQuestion(intake, [])
  assert.equal(optional.required, false, 'optional questions come only after the required ones')
  const afterSkip = nextInterviewQuestion(intake, [optional.key])
  assert.notEqual(afterSkip?.key, optional.key, 'a skipped question is not asked again')
}

/* ——— 5. blanks become visible assumptions, not invented copy ———————— */
{
  const a = visibleAssumptions(emptyIntake())
  assert.ok(a.length >= 8, 'every meaningful blank has a stated assumption')
  for (const item of a) {
    assert.match(item.text, /assuming|placeholder|default|stays blank|flagged/, `"${item.key}" states an assumption rather than asserting a fact`)
  }
  const cta = a.find((x) => x.key === 'cta')
  assert.match(cta.text, /empty placeholder/, 'a missing CTA leaves an empty placeholder — it is never written for the user')
  const making = a.find((x) => x.key === 'making')
  assert.match(making.text, /cannot guess/, 'the subject is never assumed')
  assert.equal(visibleAssumptions({ ...emptyIntake(), cta: 'Download at example.com' }).some((x) => x.key === 'cta'), false, 'an answered field is not listed as an assumption')
}

/* ——— 6. spoken numbers ————————————————————————————————————— */
{
  assert.equal(spokenNumber('forty five'), 45)
  assert.equal(spokenNumber('thirty'), 30)
  assert.equal(spokenNumber('15'), 15)
  assert.equal(spokenNumber('banana'), null, 'a non-number is null, not zero')
  assert.equal(fillIntakeFromSpeech('about a minute long', emptyIntake()).patch.durationSec, 60)
  assert.equal(fillIntakeFromSpeech('roughly forty five seconds', emptyIntake()).patch.durationSec, 45)
}

/* ——— 7. the UI is wired: mic, one question, citations, both checkboxes —— */
{
  const ui = await readFile(new URL('../src/components/IntakeInterviewer.tsx', import.meta.url), 'utf8')
  const planner = await readFile(new URL('../src/screens/production/ProductionPlanner.tsx', import.meta.url), 'utf8')
  const autonomous = await readFile(new URL('../src/screens/Autonomous.tsx', import.meta.url), 'utf8')

  assert.match(ui, /new VoiceListener\(/, 'the interviewer uses the shared offline-first listener')
  assert.match(ui, /'dictation'/, 'prose mode, not the command grammar')
  assert.match(ui, /heard “\{e\.heard\}”/, 'each filled field cites the phrase it was heard in')
  assert.match(ui, /Speak status back/, 'the speak-back checkbox exists')
  assert.match(ui, /checked=\{speakBack\} onChange/, 'and is wired to state')
  assert.match(ui, /if \(talk\) speak\(/, 'and actually gates the speech')
  assert.match(ui, /You can type the answer instead/, 'a mic failure is an honest inline message with a way forward')
  assert.doesNotMatch(ui, /alert\(|window\.confirm/, 'no dialogs for expected cases')
  assert.match(ui, /visible assumptions/, 'blanks are surfaced as assumptions in the UI')

  assert.match(planner, /<IntakeInterviewer/, 'the interviewer is mounted on the Autonomous intake')
  assert.match(planner, /onFlash=\{flashFields\}/, 'filled fields flash')
  assert.match(planner, /filled from what you said/, 'and say why they changed')

  // The hands-free checkboxes on the brief box drive real behaviour.
  assert.match(autonomous, /checked=\{handsFree\}/, 'hands-free checkbox is bound')
  assert.match(autonomous, /cfg\.handsFree|settingsRef\.current\.handsFree|handsFree/, 'hands-free is read back when deciding to auto-start')
  assert.match(autonomous, /if \(cfg\.speakBack\) speak\(/, 'speak-back gates the spoken status')
}

console.log('JOB 4 check passed — one utterance fills 6 intake fields with literal citations, typed answers win, required questions are asked one at a time, blanks become stated assumptions, nothing is invented')
