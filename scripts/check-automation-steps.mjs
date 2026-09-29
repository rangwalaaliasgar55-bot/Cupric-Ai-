#!/usr/bin/env node
/**
 * check:automation-steps — the Autonomous pipeline's eight steps are real.
 *
 * Phase 0 §B2 found two of the eight steps did not do what they claimed (step 2
 * rewrote the file it had just written; step 5 wrote a plan nothing read) and
 * that all of the logic was unreachable outside a running Electron app. This
 * check enforces the shape of the fix:
 *
 *   1. the step list is declared once, in order, with a description each;
 *   2. the renderer's labels and the main process's step indices agree with it;
 *   3. the pipeline locks with a content hash, refuses an invalid rundown, and
 *      writes a plan BEFORE the render, which the render then follows;
 *   4. the artifacts written to disk (timeline.json / editing-plan.json) are
 *      derived from that plan and are internally consistent;
 *   5. the mechanical render gate fails what it should fail and only offers a
 *      retry where a retry can help.
 *
 * Real work happens here rather than grep alone: briefs are turned into locked
 * rundowns, plans and artifacts on disk under the OS temp directory.
 */
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const steps = require('../electron/automation-steps.cjs')

const [main, runTs, autonomousTs] = await Promise.all([
  readFile(path.join(root, 'electron/main.cjs'), 'utf8'),
  readFile(path.join(root, 'src/lib/automation/run.ts'), 'utf8'),
  readFile(path.join(root, 'src/screens/Autonomous.tsx'), 'utf8'),
])

/* ——— 1. the step list ——— */
assert.equal(steps.STEP_DEFINITIONS.length, 8, 'there are eight steps')
assert.equal(new Set(steps.STEP_DEFINITIONS.map((s) => s.id)).size, 8, 'step ids are unique')
assert.deepEqual(
  steps.STEP_DEFINITIONS.map((s) => s.id),
  ['workspace', 'rundown', 'lock', 'candidates', 'footage', 'timeline', 'render', 'review'],
  'step order is workspace → rundown → lock → candidates → footage → timeline → render → review',
)
for (const definition of steps.STEP_DEFINITIONS) {
  assert.ok(definition.title.trim().length > 3, `${definition.id} has a title`)
  assert.ok(definition.description.trim().length > 20, `${definition.id} explains what it does`)
}

/* ——— 2. renderer labels and main-process indices agree ——— */
const labelsMatch = runTs.match(/export const RUN_STEP_LABELS = \[([^\]]+)\]/)
assert.ok(labelsMatch, 'the renderer declares its step labels')
const labels = [...labelsMatch[1].matchAll(/'([^']+)'/g)].map((m) => m[1])
assert.equal(labels.length, 8, `the renderer shows eight step labels (found ${labels.length})`)
// Order matters, wording may drift; assert the intent of each position.
const EXPECTED_LABEL_WORDS = [
  ['project', 'create'],
  ['rundown'],
  ['lock'],
  ['candidate', 'generate'],
  ['footage', 'ingest'],
  ['timeline'],
  ['render'],
  ['review'],
]
EXPECTED_LABEL_WORDS.forEach((words, index) => {
  const label = labels[index].toLowerCase()
  assert.ok(words.some((word) => label.includes(word)), `step ${index + 1} label "${labels[index]}" matches "${words.join('|')}"`)
})
for (const definition of steps.STEP_DEFINITIONS) {
  assert.match(main, new RegExp(`AUTOMATION_STEP\\.${definition.id}\\b`), `main.cjs refers to step '${definition.id}' by name`)
}
const numericStepReads = [...main.matchAll(/automationStep\(\s*job\s*,\s*(\d)\s*\)/g)].map((m) => m[1])
assert.deepEqual(numericStepReads, [], `no step is addressed by an unexplained number (found ${numericStepReads.join(', ') || 'none'})`)

/* ——— 3. lock before plan before render ——— */
// Execution order, not file order: slice the pipeline function itself.
const pipelineStart = main.indexOf('async function runAutomationPipeline(jobId)')
const pipelineEnd = main.indexOf('\nasync function ', pipelineStart + 10)
const pipeline = main.slice(pipelineStart, pipelineEnd > pipelineStart ? pipelineEnd : undefined)
assert.ok(pipelineStart > 0 && pipeline.length > 1000, 'the pipeline function was found')
const lockIndex = pipeline.indexOf('automationSteps.lockRundown(')
const planIndex = pipeline.indexOf('automationSteps.buildTimelinePlan(')
const renderIndex = pipeline.indexOf('await renderAutomationMp4(job, root, rundown, job.winnerPath, footageMeta, warnings, state, timelinePlan)')
assert.ok(lockIndex > 0 && planIndex > lockIndex && renderIndex > planIndex, 'inside the pipeline: lock, then plan, then render')
assert.match(main, /throw new Error\(`The rundown did not pass the render contract/, 'an invalid rundown stops the pipeline at the lock step')
assert.match(main, /throw new Error\(`The timeline plan is not renderable/, 'an unrenderable plan stops the pipeline before the render')
assert.match(main, /writeJson\(path\.join\(root, 'rundown\.lock\.json'\), locked\.lock\)/, 'the lock record is persisted')
assert.match(main, /automationSteps\.lockMatches\(job\.rundownLock, rundown\)/, 'a changed rundown is detected against the lock')
assert.match(main, /evaluateAutomationRender\(job\.outputPath, job, rundown, timelinePlan\)/, 'the render gate receives the plan it verifies against')
assert.match(main, /automationSteps\.evaluateMechanicalRender\(probe, job, rundown, plan\)/, 'the gate rules live in the tested module')
assert.match(main, /for \(const \[index, planned\] of plannedSegments\.entries\(\)\)/, 'the render iterates the planned segments')
assert.match(main, /plannedSegments = Array\.isArray\(plan\?\.segments\) && plan\.segments\.length/, 'the render refuses to invent a plan when one is missing')
// The old stub: a five-key object written to timeline-plan.json and never read.
assert.doesNotMatch(main, /timeline-plan\.json'\), \{ winnerPath: job\.winnerPath, footage: footageMeta, aspect: job\.aspect/, 'the unread five-key timeline stub is gone')
// The render must not re-derive the timeline artifacts it was given.
const renderBody = main.slice(main.indexOf('async function renderAutomationMp4'), main.indexOf('async function evaluateAutomationRender'))
assert.doesNotMatch(renderBody, /writeJson\(path\.join\(root, 'timeline\.json'\)/, 'the render no longer rewrites the plan artifacts')
assert.match(renderBody, /const sameFile = /, 'footage metadata is only applied to the file it was measured on')

/* ——— 4. the artifacts on disk are consistent with the plan ——— */
const spec = { brief: 'a 16s launch film for a hardware startup', durationSec: 16, aspect: '16:9', fps: 30, sceneCount: 4, copies: ['Meet the box', 'It runs silent', 'It ships in May', 'Pre-order now'] }
const sceneEach = spec.durationSec / spec.sceneCount
const draft = {
  title: 'Hardware launch',
  durationSec: spec.durationSec,
  fps: spec.fps,
  size: [1920, 1080],
  style: 'deterministic kinetic type',
  scenes: spec.copies.map((copy, index) => ({ type: ['hook', 'build', 'proof', 'cta'][index], copy, from: Number((index * sceneEach).toFixed(2)), to: Number(((index + 1) * sceneEach).toFixed(2)), motion: `motion ${index + 1}` })),
}
const locked = steps.lockRundown(draft, { aspect: spec.aspect, fps: spec.fps })
assert.equal(locked.ok, true, `the sample rundown locks (${locked.issues.join('; ')})`)

const plan = steps.buildTimelinePlan({ rundown: draft, winnerPath: 'C:/job/candidate-1.html', footage: null, aspect: spec.aspect, fps: spec.fps, quality: 'final' })
assert.equal(plan.valid, true, `the sample plan is valid (${plan.issues.join('; ')})`)

const dir = mkdtempSync(path.join(tmpdir(), 'cupric-steps-'))
const { timeline, editingPlan } = steps.timelineArtifacts(plan)
for (const [name, payload] of [['rundown.lock.json', locked.lock], ['timeline-plan.json', plan], ['timeline.json', timeline], ['editing-plan.json', editingPlan]]) {
  const file = path.join(dir, name)
  const { writeFileSync } = await import('node:fs')
  writeFileSync(file, JSON.stringify(payload, null, 2), 'utf8')
  const reread = JSON.parse(readFileSync(file, 'utf8'))
  assert.ok(reread, `${name} round-trips through disk`)
}

// timeline.json: contiguous clips whose durations match the plan, in order.
let cursor = 0
timeline.forEach((clip, index) => {
  assert.equal(clip.startSec, cursor, `clip ${index + 1} starts where the previous one ended`)
  assert.equal(clip.source, plan.segments[index].source, `clip ${index + 1} uses the planned source`)
  assert.equal(clip.durationSec, plan.segments[index].durationSec, `clip ${index + 1} uses the planned duration`)
  cursor = Math.round((cursor + clip.durationSec) * 100) / 100
})
assert.equal(cursor, plan.totalDurationSec, 'the clips add up to the plan total')

// editing-plan.json: the shipped schema, carrying the plan's captions.
assert.equal(editingPlan.schema_version, '1.0')
assert.equal(editingPlan.sections[0].clips.length, plan.segments.length)
assert.equal(editingPlan.sections[0].clips[0].captions.length, plan.captions.windows.length)
assert.equal(editingPlan.project.target_duration_s, spec.durationSec)
assert.equal(editingPlan.project.aspect_ratio, spec.aspect)

/* ——— 5. the gate: fails what it should, retries only what a retry can fix ——— */
const goodProbe = { exists: true, bytes: 800_000, durationSec: plan.totalDurationSec, width: 1920, height: 1080, videoCodec: 'h264', audioCodec: 'aac', playable: true }
assert.equal(steps.evaluateMechanicalRender(goodProbe, { fps: 30 }, draft, plan).valid, true, 'a matching file passes')
const missing = steps.evaluateMechanicalRender({ ...goodProbe, exists: false, bytes: 0 }, { fps: 30 }, draft, plan)
assert.equal(missing.valid, false)
assert.equal(missing.retryable, true, 'a missing file is worth one retry')
const wrongSize = steps.evaluateMechanicalRender({ ...goodProbe, width: 1080, height: 1920 }, { fps: 30 }, draft, plan)
assert.equal(wrongSize.valid, false)
assert.equal(wrongSize.retryable, false, 'a wrong frame size is a fix, not a retry loop')
assert.ok(wrongSize.failures.some((failure) => failure.startsWith('width') || failure.startsWith('height')), 'the failure names the dimension check')

/* ——— 6. varying the brief really varies the output ——— */
const briefs = [
  ['6s logo sting for a bakery', 6, 2],
  ['11s payments explainer', 11, 3],
  ['17s product trailer', 17, 4],
  ['23s podcast teaser', 23, 5],
  ['31s onboarding walkthrough', 31, 6],
]
const shapes = briefs.map(([brief, durationSec, sceneCount]) => {
  const each = durationSec / sceneCount
  const localDraft = {
    title: String(brief).slice(0, 30),
    durationSec,
    fps: 30,
    size: [1080, 1920],
    style: 'kinetic',
    scenes: Array.from({ length: sceneCount }, (_, index) => ({ type: index === 0 ? 'hook' : index === sceneCount - 1 ? 'cta' : 'proof', copy: `${brief} line ${index + 1}`, from: Number((index * each).toFixed(2)), to: Number(((index + 1) * each).toFixed(2)), motion: `motion ${index + 1}` })),
  }
  const localPlan = steps.buildTimelinePlan({ rundown: localDraft, winnerPath: `C:/job/${sceneCount}.html`, aspect: '9:16', fps: 30 })
  return { brief, segments: localPlan.segments.length, duration: localPlan.totalDurationSec, captions: localPlan.captions.windows.length, hash: localPlan.rundownHash }
})
assert.equal(new Set(shapes.map((shape) => shape.duration)).size, briefs.length, 'each brief produced its own duration')
assert.ok(new Set(shapes.map((shape) => shape.captions)).size > 1, 'each brief produced its own scene count')
assert.equal(new Set(shapes.map((shape) => shape.hash)).size, briefs.length, 'each brief locked a different rundown hash')

/* ——— 7. the screen shows per-step state, not one spinner ——— */
assert.match(autonomousTs, /job\.steps\.map\(/, 'the Autonomous screen renders every step')
assert.match(autonomousTs, /step\.status/, 'the screen reads each step status')
assert.match(autonomousTs, /step\.progressPct/, 'the screen reads each step progress')
// The channel is a parameter of patchAutomationStep: 'automation:step' when a
// step starts, 'automation:waiting' at a gate, 'automation:progress' otherwise.
assert.match(main, /channel = 'automation:progress'/, 'patchAutomationStep defaults to the per-run channel')
assert.match(main, /'automation:step'\)/, 'a starting step is emitted on its own channel')
assert.match(main, /sendAutomation\(channel, current\)/, 'the channel is actually emitted')
const [preloadSrc] = await Promise.all([readFile(path.join(root, 'electron/preload.cjs'), 'utf8')])
for (const channel of ['automation:step', 'automation:progress', 'automation:waiting', 'automation:done', 'automation:error']) {
  assert.ok(preloadSrc.includes(`'${channel}'`), `${channel} reaches the renderer`)
}

console.log(`automation steps check passed — 8 named steps, ${shapes.length} varied briefs locked and planned, artifacts consistent on disk, gate rules enforced`)
