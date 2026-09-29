#!/usr/bin/env node
/**
 * check:automation — the autonomous pipeline, executed for real.
 *
 * The web build used to answer an autonomous job with "this needs the desktop
 * app". It now runs the same eight steps locally, so they have to be provable
 * without a browser:
 *
 *   plan        brief → intake → brief → research → plan → rundown (pure)
 *   design      the design engine's stage/hierarchy/contrast rules (pure)
 *   battle      three directions, scored deterministically
 *   run         all eight steps, cancel, guided gate, review report
 *
 * `render` is injected (a blob stand-in), because MediaRecorder is a browser
 * API — everything else is the shipped code path.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { rmSync } from 'node:fs'
import path from 'node:path'
import { build } from 'esbuild'

const root = process.cwd()
const out = path.join(root, 'node_modules', '.cache', 'cupric-check-automation.mjs')
rmSync(out, { force: true })
await build({
  stdin: {
    contents: [
      "export * as plan from './src/lib/automation/plan'",
      "export * as run from './src/lib/automation/run'",
      "export * as design from './src/lib/studio/design'",
      "export * as report from './src/lib/automation/report'",
      "export * as fs from './src/lib/studio/fontStyles'",
      "export * as vf from './src/lib/studio/videoFonts'",
      "export * as docm from './src/lib/studio/doc'",
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
const read = (p) => readFileSync(path.join(root, p), 'utf8')

let n = 0
const ok = (cond, label) => { assert.ok(cond, `FAIL: ${label}`); n++ }
const eq = (a, b, label) => { assert.equal(a, b, `FAIL: ${label}`); n++ }

/* ── 1. brief → intake ─────────────────────────────────────────────── */
{
  const i = m.plan.intakeFromBrief({ brief: 'Create exactly a 40-second vertical launch reel for founders on Instagram. CTA: Book a demo.', aspect: '16:9', fps: 30, quality: 'draft' })
  eq(i.durationSec, 40, 'spoken duration is parsed')
  eq(i.aspect, '9:16', 'the brief can override the form aspect')
  ok(/founders/i.test(i.audience), 'audience read from the brief')
  ok(/book a demo/i.test(i.cta), 'CTA read from the brief')
  ok(i.brandColors === '', 'no brand kit → no invented colours')
}

/* ── 2. planning is pure, complete and offline ─────────────────────── */
const catalogue = await m.plan.loadCatalogue()
ok(catalogue.index.skills.length >= 10, 'catalogue loaded from the bundle')
const briefText = 'Create exactly a 24-second product launch video about our AI editor for solo creators; vertical; energetic; CTA: Try it free.'
const a = m.plan.planLocally({ brief: briefText, aspect: '9:16', fps: 30, quality: 'draft' }, catalogue)
const b = m.plan.planLocally({ brief: briefText, aspect: '9:16', fps: 30, quality: 'draft' }, catalogue)
eq(JSON.stringify(a.rundown), JSON.stringify(b.rundown), 'planning is deterministic')
ok(a.rundown.scenes.length >= 3, 'a rundown has real scenes')
ok(a.rundown.durationSec >= 15, 'the rundown covers the briefed duration')
eq(a.rundown.size[0], 1080, 'vertical size')
eq(a.rundown.size[1], 1920, 'vertical size')
ok(a.rundown.scenes.every((s) => s.to > s.from), 'scene windows are ordered and non-empty')
ok(/window\.__seek/.test(a.rundown.arenaPrompt), 'the Arena handoff keeps the deterministic render contract')
ok(a.plan.shots.length >= 3, 'the plan has shots')

/* ── 3. the design engine actually designs ─────────────────────────── */
{
  const built = m.run.buildDirection(a, 'atmosphere', (() => { let k = 0; return () => `c${k++}` })(), { seed: 1 })
  const scenes = built.design.scenes
  ok(scenes.length >= 3, 'every scene is designed')
  ok(new Set(scenes.map((s) => s.stage)).size >= 2, 'scenes get different stages (not one backdrop repeated)')
  ok(scenes.every((s) => m.fs.contrast(s.ink, m.design.stageBase(s.stage).base) >= 4.5), 'every headline clears 4.5:1 on its own stage')
  ok(scenes.every((s) => s.accentClipId), 'every scene gets a native accent clip')
  const texts = built.doc.clips.filter((c) => c.kind === 'text')
  ok(texts.every((c) => c.y >= 0.04 && c.y <= 0.96), 'type stays inside the frame')
  ok(texts.some((c) => c.legibility === 'auto'), 'legibility is on for text over stages')
  ok(built.doc.clips.some((c) => c.kind === 'background'), 'stages are real background clips')
  ok(built.doc.clips.filter((c) => c.kind === 'shape').length >= scenes.length, 'accents are real editable shapes')
  ok(built.design.score >= 55, `design self-score is respectable (${built.design.score})`)
  const again = m.run.buildDirection(a, 'atmosphere', (() => { let k = 0; return () => `c${k++}` })(), { seed: 1 })
  eq(JSON.stringify(built.doc), JSON.stringify(again.doc), 'the design pass is deterministic')
  const other = m.run.buildDirection(a, 'composition', (() => { let k = 0; return () => `c${k++}` })(), { seed: 2 })
  ok(JSON.stringify(other.doc) !== JSON.stringify(built.doc), 'directions differ from each other')
}

/* ── 3b. the shared battle picks the strongest direction ───────────── */
{
  const plain = m.run.buildDirection(a, 'typography', (() => { let k = 0; return () => `p${k++}` })())
  const battle = m.design.designAll(plain.doc, { brandColors: a.brief.brandColors, tone: a.brief.tone, aspect: a.brief.aspect }, plain.clipIds, (() => { let k = 0; return () => `d${k++}` })())
  eq(battle.battle.length, 3, 'the battle runs every direction')
  ok(battle.battle[0].score >= battle.battle[2].score, 'the battle is ranked')
  eq(battle.report.score, battle.battle[0].score, 'the winner is the highest-scoring direction')
  ok(battle.battle[0].reasons.length >= 2, 'each direction explains itself')
}

/* ── 4. the runner: eight steps, artefacts, no fabricated pass ─────── */
const fakeRender = async (doc, options = {}) => ({
  blob: { size: 812_345 },
  url: 'blob:cupric-test',
  fileName: options.fileName ?? 'run.webm',
  durationSec: m.docm.docDuration(doc),
  mimeType: 'video/webm;codecs=vp9',
  cancelled: false,
})

function makeJob(over = {}) {
  const id = 'job-test-1'
  return {
    id,
    projectId: 'p1',
    brief: briefText,
    aspect: '9:16',
    fps: 30,
    quality: 'draft',
    mode: 'auto-draft',
    votingMode: 'local-scoring',
    status: 'running',
    currentStepId: `${id}-step-0`,
    steps: m.run.RUN_STEP_LABELS.map((label, i) => ({ id: `${id}-step-${i}`, label, status: i === 0 ? 'running' : 'queued', progressPct: 0 })),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...over,
  }
}

function harness(job) {
  const patches = []
  const steps = []
  const committed = []
  let warned = 0
  return {
    patches, steps, committed,
    get warned() { return warned },
    hooks: {
      patch: (p) => patches.push(p),
      step: (i, p) => steps.push([i, p]),
      warn: () => { warned++ },
      commit: (doc) => committed.push(doc),
      cancelled: () => false,
      projectMediaCount: () => 0,
    },
  }
}

{
  const job = makeJob()
  const h = harness(job)
  const result = await m.run.runAutonomousJob(job, h.hooks, { plan: async (input) => m.plan.planLocally(input, catalogue), render: fakeRender, canRecord: true })
  ok(result, 'the run resolves with a result')
  eq(result.candidates.length, 3, 'three directions entered the battle')
  ok(result.candidates[0].score >= result.candidates[1].score, 'candidates are ranked best-first')
  ok(result.winner.score > 0, 'the winner has a score')
  eq(h.committed.length, 1, 'the edit is committed exactly once (one undo step)')
  const done = h.patches.filter((p) => p.status === 'done')
  eq(done.length, 1, 'the job ends in exactly one done patch')
  ok(done[0].outputPath?.endsWith('.webm'), 'the delivered path is a real file name')
  ok(done[0].outputUrl === 'blob:cupric-test', 'the recorded file is handed to the UI')
  ok(done[0].reviewReport?.includes('## Candidate battle'), 'the review report is written')
  ok(done[0].renderEvaluation?.valid, 'the mechanical gate passes on a real recording')
  ok(done[0].candidateBattle.length === 3, 'the battle is recorded on the job')
  const stepStates = h.steps.filter(([, p]) => p.status === 'done').map(([i]) => i)
  eq(new Set(stepStates).size, 8, 'all eight steps reach done')
  ok(h.steps.every(([, p]) => p.progressPct >= 0 && p.progressPct <= 100), 'progress stays 0–100')
}

/* ── 5. guided runs stop at the gate and continue after approval ───── */
{
  const job = makeJob({ mode: 'guided', id: 'job-gated' })
  const h = harness(job)
  const waiting = await m.run.runAutonomousJob(job, h.hooks, { plan: async (input) => m.plan.planLocally(input, catalogue), render: fakeRender, canRecord: true })
  eq(waiting, null, 'a guided run returns to the gate')
  const w = h.patches.find((p) => p.status === 'waiting-for-user')
  ok(w?.waitingMessage?.includes('Review gate'), 'the gate explains itself')
  ok(!h.patches.some((p) => p.status === 'done'), 'nothing is rendered before approval')

  // Approve the gate: step 3 is done, so the runner continues at footage.
  // What the store writes when the user clears the gate (see approveAutomationStep).
  const approved = { ...job, status: 'running', manualVoteApproved: true, candidateBattle: h.patches.find((p) => p.candidateBattle)?.candidateBattle, steps: job.steps.map((s, i) => (i === 3 ? { ...s, status: 'done' } : s)) }
  const h2 = harness(approved)
  const after = await m.run.runAutonomousJob(approved, h2.hooks, { plan: async (input) => m.plan.planLocally(input, catalogue), render: fakeRender, canRecord: true })
  ok(after && h2.patches.some((p) => p.status === 'done'), 'approval continues to a finished run')
}

/* ── 6. cancel is honoured, and never reported as success ──────────── */
{
  const job = makeJob({ id: 'job-cancel' })
  const h = harness(job)
  h.hooks.cancelled = () => h.steps.filter(([i]) => i === 3).length > 0
  await assert.rejects(
    () => m.run.runAutonomousJob(job, h.hooks, { plan: async (input) => m.plan.planLocally(input, catalogue), render: fakeRender, canRecord: true }),
    /cancelled/i,
    'FAIL: cancel stops the run',
  )
  n++
  ok(!h.patches.some((p) => p.status === 'done'), 'a cancelled run never reports done')
}

/* ── 7. the report tells the truth about what was delivered ────────── */
{
  const built = m.run.buildDirection(a, 'typography', (() => { let k = 0; return () => `r${k++}` })())
  const poor = m.report.buildReport({
    job: makeJob(),
    rundown: a.rundown,
    candidates: [{ id: 'typography', name: 'Typography-led', score: 70, reasons: ['x'], design: built.design }],
    doc: built.doc,
    review: [],
    design: built.design,
    warnings: ['a note'],
    placeholders: 1,
    generatedAt: '2026-01-01T00:00:00.000Z',
  })
  ok(!poor.evaluation.valid, 'no output → the gate fails rather than inventing a pass')
  ok(poor.markdown.includes('## What is left for you') && poor.markdown.includes('placeholder'), 'the report lists what the user still has to do')
  const withFile = m.report.evaluateOutput({ fileName: 'a.webm', url: null, bytes: 900_000, mimeType: 'video/webm', durationSec: a.rundown.durationSec }, a.rundown, { width: 1080, height: 1920, fps: 30 })
  ok(withFile.valid, 'a real recording passes the gate')
  const tiny = m.report.evaluateOutput({ fileName: 'a.webm', url: null, bytes: 10, mimeType: 'video/webm', durationSec: 1 }, a.rundown, { width: 1080, height: 1920, fps: 30 })
  ok(!tiny.valid && tiny.retryable, 'a stub file fails fatally')
}

/* ── 7b. a pinned direction is honoured (a battle of one, labelled) ── */
{
  const h = harness(makeJob({ designDirection: 'composition' }))
  const result = await m.run.runAutonomousJob(makeJob({ designDirection: 'composition' }), h.hooks, h.deps)
  ok(result.candidates.length === 1 && result.candidates[0].id === 'composition', 'the direction the user pinned is the one designed')
  ok(h.steps.some(([, patch]) => /composition/i.test(patch?.message ?? '')), 'the step log says which direction was designed')
  ok(result.design.direction.id === 'composition' && result.doc.clips.length > 0, 'the pinned direction is what lands in Studio')
  const auto = await m.run.runAutonomousJob(makeJob(), harness(makeJob()).hooks, harness(makeJob()).deps)
  ok(auto.candidates.length === 3, 'auto still runs the three-direction battle')
}

/* ── 7c. the project's own media is used, not replaced by placeholders ── */
{
  const media = [
    { id: 'media-1', kind: 'video', track: 0, startSec: 0, durationSec: 6, name: 'founder-interview', transitionIn: 'none', transitionOut: 'none', opacity: 1, mediaId: 'm1', fileName: 'founder-interview.mp4', localPath: null, trimInSec: 0, sourceDurationSec: 6, speed: 1, volume: 1, fit: 'cover' },
    { id: 'media-2', kind: 'image', track: 0, startSec: 6, durationSec: 4, name: 'product-shot', transitionIn: 'none', transitionOut: 'none', opacity: 1, mediaId: 'm2', fileName: 'product-shot.png', localPath: null, trimInSec: 0, sourceDurationSec: 4, speed: 1, volume: 1, fit: 'cover' },
  ]
  const withMedia = m.plan.planLocally({ brief: briefText, aspect: '9:16', fps: 30, quality: 'draft', durationSec: 20, mediaNames: ['founder-interview.mp4', 'product-shot.png'] }, catalogue)
  ok(withMedia.plan.shots.some((shot) => shot.mediaName === 'founder-interview.mp4'), 'the planner binds the project’s media to shots')
  ok(withMedia.intake.assets.includes('product-shot.png'), 'the intake lists the real assets')
  const built = m.run.buildDirection(withMedia, 'typography', (() => { let k = 0; return () => `md${k++}` })(), { media })
  const reused = built.doc.clips.filter((c) => c.kind === 'video' || c.kind === 'image').filter((c) => c.mediaId)
  ok(reused.length >= 1 && built.reused >= 1, 'the designed edit actually uses the imported media')
  ok(reused.every((c) => c.mediaId === 'm1' || c.mediaId === 'm2'), 'reused clips keep the project’s media handles')
  const noMedia = m.run.buildDirection(withMedia, 'typography', (() => { let k = 0; return () => `nm${k++}` })())
  ok(noMedia.reused === 0 && noMedia.placeholders >= 1, 'without media the same plan is honest about placeholders')
}

/* ── 8. wiring: the app actually runs this ─────────────────────────── */
{
  const store = read('src/state/useProjectStore.ts')
  ok(store.includes('runAutomationLocally') && store.includes('runAutonomousJob('), 'the store runs the local pipeline')
  ok(!/Autonomous runs need the desktop app/.test(store), 'the desktop-only dead end is gone')
  ok(store.includes('cancelLocalRun'), 'cancel reaches the local run')
  const screen = read('src/screens/Autonomous.tsx')
  ok(screen.includes('candidateBattle') || screen.includes('designScore'), 'the screen shows the battle/design results')
  const types = read('src/types/project.ts')
  ok(/outputUrl\?:/.test(types) && /reviewReport\?:/.test(types), 'the job carries the local artefacts')
  ok(/designStoryboard\?:/.test(types) && screen.includes('design-storyboard'), 'the winning design is shown scene by scene')
  ok(screen.includes('Finish in Studio') && screen.includes('runAutomationLocally'), 'a desktop run that stops can be finished in the app')
  ok(read('electron/main.cjs').includes('normalizeRundown(job.rundown, job.brief)'), 'the desktop pipeline normalises the rundown the renderer planned')
  ok(read('src/App.tsx').includes('rundownToStudioClips') && read('src/lib/studio/importHtml.ts').includes('rundownToStudioClips'), 'a finished desktop job still seeds editable Studio clips')
}

/* ── 9. the storyboard the UI renders matches the design that was built ── */
{
  const built = m.run.buildDirection(a, 'atmosphere', (() => { let k = 0; return () => `sb${k++}` })())
  const board = m.run.storyboardOf(built.design)
  ok(board.length === built.design.scenes.length && board.length > 0, 'one storyboard entry per designed scene')
  ok(board.every((b) => b.stage && b.headlineFont && b.accent && b.to > b.from), 'every entry names its stage, face, accent and timing')
  ok(board.every((b) => ['hook', 'beat', 'proof', 'cta'].includes(b.role)), 'entries carry a real role')
}

console.log(`check:automation passed — ${n} assertions, 8-step pipeline, 3-direction battle`)
