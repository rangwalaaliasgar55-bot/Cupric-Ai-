#!/usr/bin/env node
/**
 * JOB 11 gate — Auto polish and Auto effects ask before they generate.
 *
 * Both buttons used to fire one hard-coded paragraph at the planner regardless
 * of what was on the timeline: output before input, and a plan that could not
 * possibly know your film. This runs the real chooser against real documents
 * and asserts three things:
 *
 *   1. it reads the live doc — the wording and the options change with it,
 *   2. it asks exactly ONE question and offers named choices, never a blank,
 *   3. nothing generates until a choice is clicked.
 */
import assert from 'node:assert/strict'
import { readFile, rm } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import esbuild from 'esbuild'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (rel) => readFile(path.join(root, rel), 'utf8')

const out = path.join(root, '.auto-ask-check.mjs')
await esbuild.build({
  entryPoints: [path.join(root, 'src/lib/studio/autoPolishPlan.ts')],
  bundle: true, format: 'esm', platform: 'node', outfile: out, logLevel: 'silent',
})
const M = await import(`${pathToFileURL(out).href}?v=${Date.now()}`)
await rm(out, { force: true })

const clip = (over) => ({ id: Math.random().toString(36).slice(2), kind: 'text', track: 0, startSec: 0, durationSec: 2, ...over })
const doc = (clips, over = {}) => ({ aspect: '16:9', fps: 30, backgroundId: 'b', clips, trackCount: 3, ...over })

/* ——— 1. empty and unusable timelines never generate ————————————— */
{
  const empty = M.polishAsk(doc([]), 'polish')
  assert.ok(M.isBlocked(empty), 'an empty timeline cannot be polished')
  assert.match(empty.blocked, /nothing on the timeline yet/i, 'and it says so plainly')
  assert.match(empty.blocked, /Add a clip/i, 'with the next step spelled out')
  assert.doesNotMatch(empty.blocked, /error|failed|invalid/i, 'an empty timeline is not an error')

  const soundOnly = M.polishAsk(doc([clip({ kind: 'audio' }), clip({ kind: 'audio' })]), 'polish')
  assert.ok(M.isBlocked(soundOnly), 'audio with no picture has nothing to polish')
  assert.match(soundOnly.blocked, /no text or footage/i, 'and it names what is missing')
}

/* ——— 2. the question is built from the real document ——————————— */
{
  const small = M.polishAsk(doc([clip({ text: 'Hello' }), clip({ kind: 'image', startSec: 2 })]), 'polish')
  assert.ok(!M.isBlocked(small))
  assert.match(small.headline, /1 text clip/, 'the headline counts the real clips')
  assert.match(small.headline, /1 video or photo/, 'including the visual ones')
  assert.match(small.headline, /16:9/, 'and names the real aspect')
  assert.equal(small.question.split('?').length - 1, 1, 'exactly ONE question is asked')
  assert.ok(small.choices.length >= 2 && small.choices.length <= 4, 'between 2 and 4 options, never a blank box')
  for (const c of small.choices) {
    assert.ok(c.label.trim().length > 3, 'every option is named')
    assert.ok(c.hint.trim().length > 3, 'and explains itself')
    assert.ok(c.instruction.includes('2 clips'), `the instruction "${c.id}" carries the real clip count`)
    assert.match(c.instruction, /never invent facts/i, 'and forbids invention')
    assert.match(c.instruction, /safe area/i, 'and keeps elements on screen')
  }
  const labels = new Set(small.choices.map((c) => c.label))
  assert.equal(labels.size, small.choices.length, 'no two options share a name')

  // A different timeline must produce a different question.
  const big = M.polishAsk(doc(Array.from({ length: 9 }, (_, i) => clip({ startSec: i, text: 'x' }))), 'polish')
  assert.notEqual(big.headline, small.headline, 'a different timeline reads differently')
  assert.match(big.headline, /9 text clips/, 'and the count follows the doc')
}

/* ——— 3. effects options reflect what is MISSING, not boilerplate —— */
{
  const bare = M.polishAsk(doc([clip({ text: 'a' }), clip({ kind: 'video', startSec: 2 })]), 'effects')
  const ids = bare.choices.map((c) => c.id)
  assert.ok(ids.includes('transitions') && ids.includes('captions') && ids.includes('motion'), 'a bare timeline is offered all three passes')

  const done = M.polishAsk(doc([
    clip({ text: 'a', highlightWord: 'a', transitionIn: 'fade' }),
    clip({ kind: 'video', startSec: 2, transitionIn: 'fade', transitionOut: 'fade', keyframes: [{ t: 0 }, { t: 1 }] }),
  ]), 'effects')
  assert.ok(M.isBlocked(done), 'a timeline that already has everything is told so, not given busywork')
  assert.match(done.blocked, /Tell Cupric what you want changed/i, 'and is pointed at the instruction box')

  const noCaptions = M.polishAsk(doc([clip({ kind: 'image' }), clip({ kind: 'image', startSec: 2 })]), 'effects')
  assert.ok(!noCaptions.choices.some((c) => c.id === 'captions'), 'a timeline with no captions is not offered a caption pass')
}

/* ——— 4. the UI generates only after the click ————————————————— */
{
  const studio = await read('src/screens/Studio.tsx')
  assert.match(studio, /setAutoAsk\(polishAsk\(doc, 'polish'\)\)/, 'Auto polish opens the question')
  assert.match(studio, /setAutoAsk\(polishAsk\(doc, 'effects'\)\)/, 'Auto effects opens the question')

  // The old fire-and-hope prompts must be gone from the buttons.
  assert.doesNotMatch(studio, /onClick=\{\(\) => void planAgentEdit\('Create a cohesive automatic effects pass/, 'Auto effects no longer generates on click')
  assert.doesNotMatch(studio, /planAgentEdit\(agentInstruction\.trim\(\) \|\| 'Auto edit and polish/, 'Auto polish no longer falls back to a generic prompt')

  // planAgentEdit may only be reached from a choice, a typed instruction or a revision.
  const card = studio.slice(studio.indexOf('{autoAsk && !agentPlan'), studio.indexOf('{polishOffer && !agentPlan'))
  assert.match(card, /void planAgentEdit\(choice\.instruction\)/, 'the choice is what launches the planner')
  assert.match(card, /setAutoPlanName\(choice\.label\)/, 'and the plan takes the name you picked')
  assert.match(card, /Cancel/, 'the question can be dismissed without generating anything')
  assert.match(studio, /autoPlanName \? `\$\{autoPlanName\} — \$\{agentPlan\.summary\}`/, 'the preview header shows the named diff')
}

/* ——— 5. the Ask panel can be expanded, and remembers ——————————— */
{
  const ask = await read('src/app-shell/AskPanel.tsx')
  assert.match(ask, /expanded \? 'w-\[min\(980px,100vw\)\]' : 'w-\[min\(420px,100vw\)\]'/, 'the panel widens when expanded')
  assert.match(ask, /localStorage\.setItem\('cupric\.ask\.expanded'/, 'and the choice persists')
  assert.match(ask, /aria-label=\{expanded \? 'Shrink the panel back to the side' : 'Expand the panel for long answers'\}/, 'the toggle says which way it goes')
}

console.log('JOB 11 check passed — Auto polish and Auto effects read the live timeline, ask one named question and generate only after you pick; a finished timeline is told so instead of given busywork; the Ask panel expands and remembers')
