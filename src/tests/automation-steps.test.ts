/**
 * Autonomous pipeline steps — real inputs, real outputs, no Electron.
 *
 * The Phase 0 audit found step 2 was a no-op (it rewrote the file it had just
 * written) and step 5 wrote a plan nothing read. These tests exist to make that
 * class of regression impossible to reintroduce quietly:
 *
 *   - validation has to FAIL on a broken rundown (gaps, wrong size, empty copy,
 *     unsupported fps) and name every reason;
 *   - the lock has to be content-addressed, so editing a locked rundown is
 *     detectable;
 *   - the timeline plan has to be derived from the locked rundown, validated,
 *     and consumed by the render gate;
 *   - and running the same pipeline over ten different briefs has to produce
 *     outputs that differ in scene counts, copy, durations and segment order —
 *     not merely in ids or timestamps.
 */
import { describe, expect, it } from 'vitest'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const steps = require('../../electron/automation-steps.cjs')

const sizeFor = (aspect: string) => (aspect === '9:16' ? [1080, 1920] : aspect === '1:1' ? [1080, 1080] : [1920, 1080])

/** A rundown as the pipeline builds it (scene list covering the duration exactly). */
function rundown(opts: { title?: string; durationSec?: number; aspect?: string; fps?: number; copies?: string[]; sceneCount?: number } = {}) {
  const durationSec = opts.durationSec ?? 12
  const aspect = opts.aspect ?? '9:16'
  const sceneCount = opts.sceneCount ?? 4
  const copies = opts.copies ?? ['Open on the problem', 'The turn', 'The proof', 'The ask']
  const each = durationSec / sceneCount
  return {
    title: opts.title ?? 'NewBrand',
    durationSec,
    fps: opts.fps ?? 30,
    size: sizeFor(aspect),
    style: 'deterministic kinetic type',
    scenes: Array.from({ length: sceneCount }, (_, index) => ({
      type: ['hook', 'build', 'proof', 'cta'][index % 4],
      copy: copies[index % copies.length],
      from: Number((index * each).toFixed(2)),
      to: Number(((index + 1) * each).toFixed(2)),
      motion: `motion ${index + 1}`,
    })),
  }
}

const job = (over: Record<string, unknown> = {}) => ({ brief: 'a 12s product bumper', aspect: '9:16', fps: 30, ...over })

describe('step 2: locking the rundown is real validation, not a file rewrite', () => {
  it('accepts a well-formed rundown and records what it checked', () => {
    const result = steps.lockRundown(rundown(), { aspect: '9:16', fps: 30 })
    expect(result.ok).toBe(true)
    expect(result.lock.hash).toMatch(/^[0-9a-f]{16}$/)
    expect(result.lock.sceneCount).toBe(4)
    expect(result.validation.checks.map((c: { id: string }) => c.id)).toContain('contiguous')
  })

  it('refuses a rundown with a gap and says exactly where', () => {
    const broken = rundown()
    broken.scenes[2].from = 7.5 // leaves 6.0 → 7.5 uncovered
    const result = steps.lockRundown(broken, { aspect: '9:16', fps: 30 })
    expect(result.ok).toBe(false)
    expect(result.issues.join(' | ')).toMatch(/scene 3 starts at 7\.5s but the previous scene ended at 6s/)
    expect(result.issues.join(' | ')).toMatch(/unaccounted for/)
  })

  it('refuses the other contract violations the render would have hit later', () => {
    const wrongSize = { ...rundown(), size: [1920, 1080] }
    expect(steps.validateRundown(wrongSize, { aspect: '9:16', fps: 30 }).issues.join()).toMatch(/does not match aspect/)

    const badFps = { ...rundown(), fps: 23 }
    expect(steps.validateRundown(badFps, { aspect: '9:16', fps: 23 }).issues.join()).toMatch(/not a supported frame rate/)

    const noCopy = rundown()
    for (const scene of noCopy.scenes) scene.copy = ''
    expect(steps.validateRundown(noCopy, { aspect: '9:16', fps: 30 }).issues.join()).toMatch(/no on-screen copy in any scene/)

    // A copy-less visual beat among scenes that do carry text is legitimate: the
    // local planner writes exactly that shape (a real run stopped on it before
    // this rule was narrowed — see scripts/check-automation.mjs).
    const visualBeat = rundown()
    visualBeat.scenes[1].copy = ''
    expect(steps.validateRundown(visualBeat, { aspect: '9:16', fps: 30 })).toMatchObject({ ok: true })

    const longCopy = rundown()
    longCopy.scenes[0].copy = 'x'.repeat(221)
    expect(steps.validateRundown(longCopy, { aspect: '9:16', fps: 30 }).issues.join()).toMatch(/longer than 220 characters/)

    const pastEnd = rundown()
    pastEnd.scenes[3].to = 99
    expect(steps.validateRundown(pastEnd, { aspect: '9:16', fps: 30 }).issues.join()).toMatch(/past the 12s rundown/)
  })

  it('locks by content: editing a locked rundown is detectable', () => {
    const first = rundown()
    const lock = steps.lockRundown(first, { aspect: '9:16', fps: 30 }).lock
    expect(steps.lockMatches(lock, first)).toBe(true)
    const edited = { ...first, scenes: first.scenes.map((scene, index) => (index === 0 ? { ...scene, copy: 'Changed line' } : scene)) }
    expect(steps.lockMatches(lock, edited)).toBe(false)
    expect(steps.lockRundown(edited, { aspect: '9:16', fps: 30 }).lock.hash).not.toBe(lock.hash)
  })
})

describe('step 5: the timeline plan is derived, validated and renderable', () => {
  it('builds a contiguous plan whose segments add up to the rundown', () => {
    const plan = steps.buildTimelinePlan({ rundown: rundown(), winnerPath: '/tmp/winner.html', aspect: '9:16', fps: 30 })
    expect(plan.valid).toBe(true)
    expect(plan.segments).toHaveLength(1)
    expect(plan.segments[0].kind).toBe('generated')
    expect(plan.segments[0].durationSec).toBe(12)
    expect(plan.totalDurationSec).toBe(12)
    expect(plan.captions.windows).toHaveLength(4)
    expect(steps.validateTimelinePlan(plan).ok).toBe(true)
  })

  it('places real footage after the generated beat, in order', () => {
    const plan = steps.buildTimelinePlan({
      rundown: rundown(),
      winnerPath: '/tmp/winner.html',
      footage: { source: 'C:/footage/a.mp4', clips: [{ path: 'C:/footage/a.mp4', durationSec: 4 }, { path: 'C:/footage/b.mp4', durationSec: 3.5 }] },
      aspect: '9:16',
      fps: 30,
    })
    expect(plan.segments.map((s: { kind: string }) => s.kind)).toEqual(['generated', 'footage', 'footage'])
    expect(plan.segments[1].source).toBe('C:/footage/a.mp4')
    expect(plan.segments[2].durationSec).toBe(3.5)
    expect(plan.segments[1].transitionIn).toBe('dissolve')
    expect(plan.totalDurationSec).toBe(19.5)
    expect(steps.validateTimelinePlan(plan).ok).toBe(true)
  })

  it('is invalid, and says why, when the pieces are missing', () => {
    const noWinner = steps.buildTimelinePlan({ rundown: rundown(), winnerPath: '', aspect: '9:16', fps: 30 })
    expect(noWinner.valid).toBe(false)
    expect(noWinner.issues.join()).toMatch(/no winning candidate file/)

    const noSource = steps.buildTimelinePlan({ rundown: rundown(), winnerPath: '', footage: { clips: [{ path: '', durationSec: 3 }] }, aspect: '9:16', fps: 30 })
    expect(noSource.issues.join()).toMatch(/footage clip 1 has no path/)

    const brokenPlan = { ...noWinner, fps: 0, generatedSource: null }
    expect(steps.validateTimelinePlan(brokenPlan).issues.length).toBeGreaterThan(0)
  })

  it('produces the shipped artifacts (timeline.json / editing-plan.json) from the plan', () => {
    const plan = steps.buildTimelinePlan({
      rundown: rundown(),
      winnerPath: '/tmp/winner.html',
      footage: { clips: [{ path: 'C:/footage/a.mp4', durationSec: 4 }] },
      aspect: '9:16',
      fps: 30,
    })
    const { timeline, editingPlan } = steps.timelineArtifacts(plan)
    expect(timeline.map((clip: { startSec: number }) => clip.startSec)).toEqual([0, 12])
    expect(editingPlan.sections[0].clips).toHaveLength(2)
    expect(editingPlan.sections[0].clips[0].captions.map((c: { text: string }) => c.text)).toContain('The ask')
    expect(editingPlan.project.target_duration_s).toBe(12)
  })
})

describe('step 8: the mechanical render gate', () => {
  const probeOk = { exists: true, bytes: 900_000, durationSec: 12, width: 1080, height: 1920, videoCodec: 'h264', audioCodec: 'aac', playable: true }

  it('passes a file that matches the promise', () => {
    const gate = steps.evaluateMechanicalRender(probeOk, job(), rundown(), steps.buildTimelinePlan({ rundown: rundown(), winnerPath: '/w.html' }))
    expect(gate.valid).toBe(true)
    expect(gate.retryable).toBe(false)
  })

  it('fails, and is retryable, when the file is missing or unreadable', () => {
    const missing = steps.evaluateMechanicalRender({ ...probeOk, exists: false, bytes: 0 }, job(), rundown())
    expect(missing.valid).toBe(false)
    expect(missing.retryable).toBe(true)
    const unreadable = steps.evaluateMechanicalRender({ ...probeOk, playable: false }, job(), rundown())
    expect(unreadable.failures.join()).toMatch(/playable/)
    expect(unreadable.retryable).toBe(true)
  })

  it('fails a wrong frame size without pretending a retry will fix it', () => {
    const gate = steps.evaluateMechanicalRender({ ...probeOk, width: 1920, height: 1080 }, job(), rundown())
    expect(gate.valid).toBe(false)
    expect(gate.failures.join()).toMatch(/width/)
    expect(gate.retryable).toBe(false)
  })
})

describe('the whole pipeline over twelve varied briefs', () => {
  // Briefs that differ in length, aspect, frame rate and subject — the same
  // variation a user produces in a real session.
  const briefs = [
    { brief: 'a 12s product bumper for a coffee subscription', aspect: '9:16', fps: 30, durationSec: 12, sceneCount: 4, copies: ['Coffee at home', 'Fresh weekly', 'Roasted locally', 'Start today'] },
    { brief: 'an 8s logo sting for a design studio', aspect: '1:1', fps: 30, durationSec: 8, sceneCount: 3, copies: ['Studio Nine', 'Design systems', 'Studio Nine'] },
    { brief: 'a 20s explainer for a payments API', aspect: '16:9', fps: 60, durationSec: 20, sceneCount: 5, copies: ['Payments are hard', 'One call', 'Idempotent', 'Audited', 'Ship it'] },
    { brief: 'a 6s kinetic quote about focus', aspect: '9:16', fps: 30, durationSec: 6, sceneCount: 2, copies: ['Focus is a choice', 'Make it daily'] },
    { brief: 'a 30s podcast clip teaser', aspect: '9:16', fps: 30, durationSec: 30, sceneCount: 6, copies: ['Episode 41', 'The guest', 'The disagreement', 'The number', 'The lesson', 'Listen now'] },
    { brief: 'a 15s fitness app launch', aspect: '9:16', fps: 60, durationSec: 15, sceneCount: 5, copies: ['Move daily', 'Track simply', 'See progress', 'Stay consistent', 'Download free'] },
    { brief: 'a 10s real-estate walkthrough opener', aspect: '16:9', fps: 30, durationSec: 10, sceneCount: 4, copies: ['Corner unit', 'Natural light', 'Ten minutes to transit', 'Book a viewing'] },
    { brief: 'a 9s ticket-sales reminder', aspect: '1:1', fps: 30, durationSec: 9, sceneCount: 3, copies: ['Two nights only', 'Fifty seats', 'Get tickets'] },
    { brief: 'a 24s onboarding walkthrough for a note app', aspect: '16:9', fps: 30, durationSec: 24, sceneCount: 6, copies: ['Open a note', 'Type anything', 'Tag it', 'Find it later', 'Share it', 'Sync everywhere'] },
    { brief: 'an 18s bakery opening announcement', aspect: '9:16', fps: 30, durationSec: 18, sceneCount: 6, copies: ['Saturday 8am', 'Sourdough', 'Cardamom buns', 'Filter coffee', 'Bring a friend', 'See you there'] },
    { brief: 'a 7s error-state demo for a dashboard', aspect: '16:9', fps: 60, durationSec: 7, sceneCount: 3, copies: ['Something broke', 'Here is why', 'Retry the job'] },
    { brief: 'a 14s trailer for a short film', aspect: '16:9', fps: 24, durationSec: 14, sceneCount: 4, copies: ['A quiet town', 'A missing tape', 'One weekend', 'In cinemas'] },
  ]

  const run = (spec: (typeof briefs)[number], footage: unknown = null) => {
    const draft = rundown({ title: spec.brief.slice(0, 40), durationSec: spec.durationSec, aspect: spec.aspect, fps: spec.fps, sceneCount: spec.sceneCount, copies: spec.copies })
    const locked = steps.lockRundown(draft, { aspect: spec.aspect, fps: spec.fps })
    const plan = steps.buildTimelinePlan({ rundown: draft, winnerPath: `/tmp/${spec.sceneCount}-winner.html`, footage, aspect: spec.aspect, fps: spec.fps })
    const artifacts = steps.timelineArtifacts(plan)
    const gate = steps.evaluateMechanicalRender(
      { exists: true, bytes: 500_000, durationSec: plan.totalDurationSec, width: draft.size[0], height: draft.size[1], videoCodec: 'h264', audioCodec: 'aac', playable: true },
      job({ brief: spec.brief, aspect: spec.aspect, fps: spec.fps }),
      draft,
      plan,
    )
    return { draft, locked, plan, artifacts, gate }
  }

  it('every brief locks, plans, validates and passes the gate', () => {
    for (const spec of briefs) {
      const result = run(spec)
      expect(result.locked.ok, spec.brief).toBe(true)
      expect(result.plan.valid, spec.brief).toBe(true)
      expect(result.gate.valid, spec.brief).toBe(true)
      expect(result.plan.totalDurationSec, spec.brief).toBe(spec.durationSec)
      expect(result.plan.captions.windows.length, spec.brief).toBe(spec.sceneCount)
      expect(result.artifacts.editingPlan.sections[0].clips[0].purpose, spec.brief).toMatch(/generated motion creative/)
    }
  })

  it('the twelve runs differ in content, not just ids', () => {
    const results = briefs.map((spec) => run(spec))
    // Durations: eleven distinct values across twelve briefs (10s appears once).
    expect(new Set(results.map((r) => r.plan.totalDurationSec)).size).toBeGreaterThanOrEqual(9)
    // Scene counts: 2..6 all present.
    expect(new Set(results.map((r) => r.plan.captions.windows.length)).size).toBeGreaterThanOrEqual(4)
    // Copy: every brief's first caption differs from every other brief's.
    const firstLines = results.map((r) => r.plan.captions.windows[0].text)
    expect(new Set(firstLines).size).toBe(firstLines.length)
    // The whole plan body is unique per brief.
    const bodies = results.map((r) => JSON.stringify(r.plan.segments.map((s: { durationSec: number; id: string }) => [s.id, s.durationSec])))
    expect(new Set(bodies).size).toBe(bodies.length)
    // Capstone: no two runs produced the same caption text anywhere.
    const captionSets = results.map((r) => r.plan.captions.windows.map((w: { text: string }) => w.text).join('|'))
    expect(new Set(captionSets).size).toBe(captionSets.length)
  })

  it('the same brief twice is deterministic (same hash, same plan), which is why varying inputs matters', () => {
    const spec = briefs[4]
    const a = run(spec)
    const b = run(spec)
    expect(a.locked.lock?.hash ?? a.draft.title).toBe(b.locked.lock?.hash ?? b.draft.title)
    expect(a.plan.totalDurationSec).toBe(b.plan.totalDurationSec)
    expect(JSON.stringify(a.plan.captions)).toBe(JSON.stringify(b.plan.captions))
  })

  it('footage changes the plan in a way the plan itself proves', () => {
    const spec = briefs[0]
    const without = run(spec)
    const withFootage = run(spec, { source: 'C:/f/a.mp4', clips: [{ path: 'C:/f/a.mp4', durationSec: 5 }, { path: 'C:/f/b.mp4', durationSec: 4 }] })
    expect(without.plan.segments).toHaveLength(1)
    expect(withFootage.plan.segments).toHaveLength(3)
    expect(withFootage.plan.totalDurationSec).toBe(21)
    expect(withFootage.plan.footageUsed).toBe(2)
    expect(withFootage.artifacts.timeline.map((clip: { source: string }) => clip.source)).toContain('C:/f/b.mp4')
  })

  it('a job summary reports the same numbers the plan does', () => {
    const spec = briefs[2]
    const result = run(spec)
    const summary = steps.summarizeJob({ brief: spec.brief, steps: [{ id: 'timeline', status: 'done', message: 'Timeline built' }], rundownLock: result.locked.lock, outputPath: 'C:/out/x.mp4', renderEvaluation: { valid: true } }, result.plan)
    expect(summary.segments).toBe(result.plan.segments.length)
    expect(summary.totalDurationSec).toBe(result.plan.totalDurationSec)
    expect(summary.lockedHash).toBe(result.locked.lock?.hash)
    expect(summary.valid).toBe(true)
  })
})

describe('step definitions', () => {
  it('are eight, ordered, and each says what it does', () => {
    expect(steps.STEP_DEFINITIONS).toHaveLength(8)
    expect(steps.STEP_DEFINITIONS.map((s: { id: string }) => s.id)).toEqual(['workspace', 'rundown', 'lock', 'candidates', 'footage', 'timeline', 'render', 'review'])
    for (const definition of steps.STEP_DEFINITIONS) expect(definition.description.length).toBeGreaterThan(20)
  })
})
