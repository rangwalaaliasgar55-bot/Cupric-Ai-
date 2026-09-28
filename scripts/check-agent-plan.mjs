#!/usr/bin/env node
/**
 * JOB 12 gate — one plan, one truth.
 *
 * Cupric and the agent tracked the same film in three places: the 5-step
 * getting-started list, the agent's own 8 job labels and the Quick Video
 * panel's 7. Ask each where you are and you could get different answers.
 *
 * This asserts the shared spine exists and behaves: eight canonical steps,
 * one owner each, status derived from saved artefacts rather than ticked by
 * hand, the agent's labels mapped onto the same eight, approvals only on
 * destructive steps, and a resume point after a crash.
 */
import assert from 'node:assert/strict'
import { readFile, rm } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import esbuild from 'esbuild'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (rel) => readFile(path.join(root, rel), 'utf8')

const out = path.join(root, '.agent-plan-check.mjs')
await esbuild.build({
  entryPoints: [path.join(root, 'src/lib/production/productionPlan.ts')],
  bundle: true, format: 'esm', platform: 'node', outfile: out, logLevel: 'silent',
})
const P = await import(`${pathToFileURL(out).href}?v=${Date.now()}`)
await rm(out, { force: true })

/* ——— 1. the spine itself ————————————————————————————————————— */
{
  const ids = P.PRODUCTION_PLAN.map((s) => s.id)
  assert.deepEqual(ids, ['intake', 'brief', 'rundown', 'lock', 'candidates', 'gate', 'timeline', 'render'],
    'the eight steps are the ones the tracker shows, in order')
  for (const step of P.PRODUCTION_PLAN) {
    assert.ok(['you', 'cupric', 'agent'].includes(step.owner), `${step.id} has exactly one owner`)
    assert.ok(step.why.length > 20, `${step.id} explains itself in plain words`)
    assert.ok(Array.isArray(step.needs), `${step.id} declares its prerequisites`)
    for (const need of step.needs) assert.ok(ids.includes(need), `${step.id} depends on a real step`)
    // Prerequisites must point backwards, or the plan could never start.
    for (const need of step.needs) assert.ok(ids.indexOf(need) < ids.indexOf(step.id), `${step.id} does not depend on a later step`)
  }
  assert.ok(P.PRODUCTION_PLAN.some((s) => s.owner === 'you'), 'some steps are yours')
  assert.ok(P.PRODUCTION_PLAN.some((s) => s.owner === 'cupric'), 'some are Cupric’s')
  assert.ok(P.PRODUCTION_PLAN.some((s) => s.owner === 'agent'), 'some are the agent’s')

  // Approval is a cost; it must be charged only where work is overwritten.
  const approvals = P.PRODUCTION_PLAN.filter((s) => s.destructive).map((s) => s.id)
  assert.deepEqual(approvals, ['lock', 'timeline'], 'only the two destructive steps ask for approval')
  for (const id of ids) assert.equal(P.needsApproval(id), approvals.includes(id), `${id} asks for approval only if destructive`)
}

/* ——— 2. status is derived from artefacts, never from a flag ——— */
{
  const blank = P.planState(null)
  assert.equal(blank.length, 8)
  assert.equal(blank[0].status, 'waiting-for-you', 'with no project, intake is yours to do')
  assert.equal(P.currentStep(blank).id, 'intake', 'and it is the one next step')
  assert.ok(blank.slice(1).every((s) => s.status === 'blocked'), 'nothing downstream pretends to be ready')
  assert.match(blank[1].detail, /Needs Intake first/, 'and each blocked step names its blocker')

  const project = {
    brief: { messages: [{ role: 'user' }], draftRundown: null, lockedRundown: null },
    studio: { clips: [] }, renderJobs: [],
  }
  const afterIntake = P.planState(project)
  assert.equal(afterIntake[0].status, 'done', 'a real user message completes intake')
  assert.equal(P.currentStep(afterIntake).id, 'brief', 'and the next step follows automatically')
  assert.equal(afterIntake[1].status, 'current', 'a Cupric-owned step is not "waiting for you"')

  project.brief.messages.push({ role: 'gemini' })
  project.brief.lockedRundown = { scenes: [] }
  const locked = P.planState(project)
  assert.ok(['brief', 'rundown', 'lock'].every((id) => locked.find((s) => s.id === id).status === 'done'),
    'locking a rundown implies the brief and rundown exist — no step can be "done" out of order')
  assert.equal(P.currentStep(locked).id, 'candidates', 'so the agent picks up at candidates')

  // The SAME state read twice must give the same answer. That is the point.
  assert.deepEqual(P.planState(project).map((s) => s.status), locked.map((s) => s.status), 'the derivation is stable')
}

/* ——— 3. the agent's own labels land on the same eight steps ——— */
{
  const agentLabels = ['Create project', 'Generate AI rundown', 'Lock rundown', 'Generate candidates', 'Ingest footage', 'Build timeline', 'Render MP4', 'Review report']
  const mapped = agentLabels.map((l) => P.stepIdForAutomationLabel(l))
  assert.ok(mapped.every(Boolean), 'every label the agent writes maps onto the shared plan')
  const ids = new Set(P.PRODUCTION_PLAN.map((s) => s.id))
  for (const m of mapped) assert.ok(ids.has(m), `${m} is a real step`)
  assert.equal(P.stepIdForAutomationLabel('Lock rundown'), 'lock', 'lock beats the plain rundown match')
  assert.equal(P.stepIdForAutomationLabel('Generate AI rundown'), 'rundown', 'and the plain one still maps')
  assert.equal(P.stepIdForAutomationLabel('Something unrelated'), null, 'an unknown label is null, not a wrong guess')

  // The store must still emit the labels this mapping was built against.
  const store = await read('src/state/useProjectStore.ts')
  for (const label of agentLabels) assert.ok(store.includes(label), `the store still emits "${label}" — mapping stays honest`)
}

/* ——— 4. parallel legs and crash resume ——————————————————————— */
{
  const project = { brief: { messages: [{ role: 'user' }, { role: 'gemini' }], lockedRundown: { scenes: [] } }, studio: { clips: [] }, renderJobs: [] }
  const state = P.planState(project)
  const ready = P.readySteps(state).map((s) => s.id)
  assert.ok(ready.includes('candidates'), 'work whose prerequisites are met is ready')
  assert.ok(!ready.includes('timeline'), 'work that is still blocked is not')

  assert.equal(P.resumePoint(P.planState(null)), 'intake', 'a fresh session resumes at the start')
  assert.equal(P.resumePoint(state), 'candidates', 'a crash resumes after the last checkpoint, not at zero')
  for (const id of ['intake', 'brief', 'rundown', 'lock']) {
    assert.equal(P.PRODUCTION_PLAN.find((s) => s.id === id).checkpoint, true, `${id} checkpoints, so it is never redone`)
  }
}

/* ——— 5. the UI shows the shared owner, not its own idea ———————— */
{
  const auto = await read('src/screens/Autonomous.tsx')
  assert.match(auto, /stepIdForAutomationLabel\(step\.label\)/, 'the agent view resolves each row through the shared plan')
  assert.match(auto, /OWNER_LABEL\[shared\.owner\]/, 'and renders the shared owner badge')
  assert.match(auto, /shared\?\.destructive &&/, 'destructive steps are marked in the list')
  assert.match(auto, /title=\{`\$\{OWNER_LABEL\[shared\.owner\]\} does this step/, 'the badge explains itself on hover')
}

console.log('JOB 12 check passed — eight canonical steps with one owner each, status derived from saved artefacts, the agent’s labels mapped onto the same spine, approval only on the two destructive steps, and crash resume at the last checkpoint')
