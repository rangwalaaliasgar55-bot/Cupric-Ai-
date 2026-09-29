/**
 * Autonomous run — the local pipeline.
 *
 * The desktop app runs its pipeline in the main process (FFmpeg, hidden
 * capture windows, Arena handoff). That pipeline needs a desktop: in the web
 * build the job used to stop at step one with "Autonomous runs need the
 * desktop app". This runner executes the same eight steps where the app is
 * actually running — plan → lock → candidate battle → timeline → render →
 * review — using the shared Studio renderer (`exportStudio`), so the file that
 * comes out is exactly the edit Studio would export.
 *
 * Guarantees it keeps, matching the desktop pipeline:
 *  - a rundown exists immediately (never a spinner waiting on a model);
 *  - candidates are genuinely different directions, scored deterministically;
 *  - every step writes a real artefact (rundown, candidates, timeline, render,
 *    report) and reports machine-checked facts, never a fabricated pass;
 *  - cancel is honoured at every await point, including inside the render.
 */
import type { AutomationJob, AutomationStep, SceneRundown, StudioClip, StudioDoc } from '../../types/project'
import type { ExportResult, ExportOptions } from '../studio/export'
import { uid } from '../utils'
import { emptyStudioDoc } from '../studio/doc'
import { designScenes, directionById, DESIGN_DIRECTIONS, type DesignDirectionId, type DesignReport } from '../studio/design'
import { directProduction, planToDoc, polishEdit, reviewEdit, reviewScore } from '../production/engine'
import { loadCatalogue, planLocally, type AutonomyBrief, type LocalPlan } from './plan'
import { lockSummary, validateRundown } from './lock'
import { buildReport, type RunArtefacts } from './report'

export type CandidateResult = { id: DesignDirectionId; name: string; score: number; reasons: string[]; design: DesignReport }

export type RunHooks = {
  /** Patch the job (status, rundown, warnings, outputs…). */
  patch: (patch: Partial<AutomationJob>) => void
  /** Patch one step by index. */
  step: (index: number, patch: Partial<AutomationStep>) => void
  /** Add a warning without duplicating it. */
  warn: (message: string) => void
  /** Replace/append the built edit in the project as ONE undo step. */
  commit: (doc: StudioDoc, label: string) => void
  /** True once the user cancelled from outside the runner. */
  cancelled: () => boolean
  /** Brand kit colours/fonts, so the plan can use them. */
  brand?: { colors?: string[]; fonts?: string[] }
  /** Optional project media count, so the footage step can be honest. */
  projectMediaCount?: () => number
  /**
   * The project's media clips themselves, so the design can use the footage and
   * photos the user actually imported (matched by file name) rather than
   * planning placeholders for every shot.
   */
  projectMedia?: () => StudioClip[]
}

export type RunOutput = { fileName: string; url: string | null; bytes: number; mimeType: string; durationSec: number }

export type RunResult = {
  plan: LocalPlan
  rundown: SceneRundown
  candidates: CandidateResult[]
  winner: CandidateResult
  doc: StudioDoc
  review: ReturnType<typeof reviewEdit>
  reviewScorePct: number
  design: DesignReport
  placeholders: number
  leftForYou: string[]
  output?: RunOutput
  warnings: string[]
}

export const RUN_STEP_LABELS = ['Create project', 'Generate AI rundown', 'Lock rundown', 'Generate candidates', 'Ingest footage', 'Build timeline', 'Render video', 'Review report']

/** One run per job; a map keeps cancel visible from anywhere. */
const live = new Map<string, { cancelled: boolean }>()

export function cancelLocalRun(jobId: string): void {
  const state = live.get(jobId)
  if (state) state.cancelled = true
}

export function isLocalRunActive(jobId: string): boolean {
  return live.has(jobId)
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/** What the environment can actually do — never assumed, always reported. */
export type RunCapabilities = { canRender: boolean; renderScale: number }

export function capabilitiesFor(quality: AutomationJob['quality'], canRecord = typeof MediaRecorder !== 'undefined'): RunCapabilities {
  return { canRender: canRecord, renderScale: quality === 'final' ? 1 : 0.5 }
}

/**
 * Injectable seams so the whole pipeline is testable without a DOM.
 *
 * `render` is loaded on demand: the Studio canvas recorder is by far the
 * heaviest thing an autonomous run can touch, and a job that only plans (or a
 * guided run waiting at its gate) should never pay for it.
 */
export type RunDeps = {
  plan: (input: AutonomyBrief, brand?: { colors?: string[]; fonts?: string[] }) => Promise<LocalPlan>
  render?: (doc: StudioDoc, options?: ExportOptions) => Promise<ExportResult>
  /** Override MediaRecorder detection (tests, and hosts that know better). */
  canRecord?: boolean
}

export function makeDeps(brand?: { colors?: string[]; fonts?: string[] }): RunDeps {
  return { plan: async (input) => planLocally(input, await loadCatalogue(), brand) }
}

const renderWith = async (deps: RunDeps) => deps.render ?? (await import('../studio/export')).exportStudio

/**
 * Plan a rundown without running anything — used by the desktop path so the
 * main-process pipeline starts from a designed plan instead of a placeholder.
 */
export async function planLocalRundown(
  input: AutonomyBrief,
  brand?: { colors?: string[]; fonts?: string[] },
  deps: Pick<RunDeps, 'plan'> = makeDeps(),
): Promise<SceneRundown> {
  return (await deps.plan(input, brand)).rundown
}

/** The winning design, flattened for the UI (scenes are already ordered). */
export function storyboardOf(design: DesignReport): NonNullable<AutomationJob['designStoryboard']> {
  return design.scenes.map((scene) => ({
    index: scene.index,
    role: scene.role,
    stage: scene.stage,
    layout: scene.layout,
    headlineFont: scene.headlineFont,
    accent: scene.accent,
    from: scene.from,
    to: scene.to,
  }))
}

/** Rough target duration from the brief ("exactly a 30-second video"). */
export const durationFromBrief = (brief: string, fallback = 30): number => {
  const n = Number(/\b(\d{1,3})\s*(?:-|\s)?\s*(?:second|sec|s\b)/i.exec(brief)?.[1])
  return Number.isFinite(n) && n > 0 ? Math.min(180, Math.max(8, Math.round(n))) : fallback
}

/**
 * Run the whole pipeline for `job`. Resolves with everything it produced (or
 * null when a guided run is waiting at a review gate); the caller owns state.
 */
export async function runAutonomousJob(
  job: AutomationJob,
  hooks: RunHooks,
  deps: RunDeps = makeDeps(),
): Promise<RunResult | null> {
  const state = live.get(job.id) ?? { cancelled: false }
  live.set(job.id, state)
  const warnings: string[] = [...(job.warnings ?? [])]
  const warn = (message: string) => {
    if (!warnings.includes(message)) warnings.push(message)
    hooks.warn(message)
  }
  const guard = () => {
    if (state.cancelled || hooks.cancelled()) throw new Error('Automation cancelled')
  }
  const stepDone = (i: number) => job.steps[i]?.status === 'done'

  try {
    // — 0. workspace —————————————————————————————————————————————
    if (!stepDone(0)) {
      hooks.step(0, { status: 'running', progressPct: 25, message: 'Preparing the project workspace' })
      guard()
      hooks.step(0, { status: 'done', progressPct: 100, message: 'Workspace ready — projects, media and fonts are local to this machine' })
    }

    // — 1. rundown (instant, offline) ————————————————————————————
    hooks.step(1, { status: stepDone(1) ? 'done' : 'running', progressPct: 10, message: 'Drafting the rundown offline — no model required' })
    guard()
    const mediaClips = hooks.projectMedia?.() ?? []
    const mediaNames = mediaClips.map((c) => (c.kind === 'video' || c.kind === 'image' ? c.fileName : '')).filter((n): n is string => Boolean(n))
    const plan = await deps.plan({
      brief: job.brief,
      aspect: job.aspect,
      fps: job.fps,
      quality: job.quality,
      durationSec: durationFromBrief(job.brief),
      mediaNames,
    })
    const rundown = job.rundown ?? plan.rundown
    if (!stepDone(1)) {
      hooks.patch({ rundown, warnings })
      hooks.step(1, { status: 'done', progressPct: 100, message: `${rundown.scenes.length} scenes · ${rundown.durationSec}s · planned from the bundled catalogue` })
    }

    // — 2. lock ———————————————————————————————————————————————————
    // The same contract the desktop lock enforces (electron/automation-steps.cjs,
    // mirrored in ./lock and kept in step by src/tests/automation-lock-parity).
    // A rundown that cannot be rendered stops the run here rather than at export.
    if (!stepDone(2)) {
      hooks.step(2, { status: 'running', progressPct: 60, message: 'Checking the rundown against the render contract' })
      guard()
      const verdict = validateRundown(rundown, { aspect: job.aspect, fps: job.fps })
      if (!verdict.ok) {
        const reason = `The rundown did not pass the render contract, so the run stopped before building scenes: ${verdict.issues.join('; ')}`
        warn(reason)
        hooks.step(2, { status: 'error', progressPct: 100, message: reason })
        hooks.patch({ status: 'error', errorMessage: reason, rundown, warnings })
        return null
      }
      hooks.patch({ rundown, warnings })
      hooks.step(2, { status: 'done', progressPct: 100, message: lockSummary(rundown, { aspect: job.aspect, fps: job.fps }) })
    }

    // — 3. the candidate battle ———————————————————————————————————
    let candidates: CandidateResult[] = (job.candidateBattle ?? []).map((c) => ({
      id: c.id as DesignDirectionId,
      name: c.name,
      score: c.score,
      reasons: c.reasons,
      design: { direction: directionById(c.id as DesignDirectionId), scenes: [], notes: [], score: c.designScore },
    }))
    const pinned = job.designDirection && job.designDirection !== 'auto'
      ? DESIGN_DIRECTIONS.filter((d) => d.id === job.designDirection)
      : DESIGN_DIRECTIONS
    if (!stepDone(3) || !candidates.length) {
      candidates = []
      hooks.step(3, { status: 'running', progressPct: 5, message: pinned.length === 1 ? `Designing the ${pinned[0].name} direction you asked for` : `Designing ${pinned.length} directions and scoring them locally` })
      for (let i = 0; i < pinned.length; i++) {
        guard()
        const direction = pinned[i]
        const built = buildDirection(plan, direction.id, uid, { media: mediaClips })
        const review = reviewEdit(built.doc, plan.brief, plan.plan, built.clipIds)
        const craft = reviewScore(review)
        candidates.push({
          id: direction.id,
          name: direction.name,
          score: Math.round((craft + built.design.score) / 2),
          reasons: [
            direction.why,
            `${built.design.scenes.length} scenes · ${new Set(built.design.scenes.map((s) => s.stage)).size} stage(s) · headline ${built.design.scenes[0]?.headlineFont ?? 'n/a'}`,
            ...review.filter((c) => c.status !== 'pass').slice(0, 2).map((c) => `${c.label}: ${c.detail}`),
          ],
          design: built.design,
        })
        hooks.step(3, { progressPct: Math.round(((i + 1) / pinned.length) * 95), message: `${direction.name}: craft ${craft}/100 · design ${built.design.score}/100` })
        await sleep(0)
      }
      candidates.sort((a, b) => b.score - a.score)
      hooks.patch({
        warnings,
        candidates: candidates.map((c) => ({ file: c.id, score: c.score, reasons: c.reasons })),
        candidateBattle: candidates.map((c) => ({ id: c.id, name: c.name, score: c.score, designScore: c.design.score, reasons: c.reasons })),
        designStoryboard: storyboardOf(candidates[0].design),
      })
      hooks.step(3, {
        status: 'done',
        progressPct: 100,
        message: pinned.length === 1 ? `${candidates[0].name} designed and scored (${candidates[0].score}/100)` : `Winner: ${candidates[0].name} (${candidates[0].score}/100)`,
      })
    }
    // A guided run stops *once*, at the battle gate — the same manual-approval
    // rule the desktop pipeline uses. `manualVoteApproved` (or a step beyond the
    // gate being done) is what proves the user cleared it, so a resumed run can
    // never bounce back into the same gate.
    const gateCleared = job.manualVoteApproved === true || stepDone(4)
    if (job.mode === 'guided' && !gateCleared) {
      hooks.patch({
        status: 'waiting-for-user',
        waitingMessage: `Review gate: “${candidates[0].name}” leads the battle with ${candidates[0].score}/100. Approve to build and render it, or edit the rundown first.`,
      })
      return null
    }
    const winner = candidates[0]

    // — 4. footage ————————————————————————————————————————————————
    if (!stepDone(4)) {
      const media = hooks.projectMediaCount?.() ?? 0
      hooks.step(4, { status: 'running', progressPct: 40, message: job.footageFolder ? 'Checking footage' : 'No footage needed — type-led design' })
      guard()
      if (job.footageFolder) {
        warn('Footage folders are read by the desktop app only. This run used the media already imported into the project — import the clips in Studio and run again to include them.')
      } else if (media > 0) {
        hooks.step(4, { progressPct: 80, message: `${media} imported clip(s) stay available in Studio` })
      }
      hooks.step(4, { status: 'done', progressPct: 100, message: media > 0 ? `Kept ${media} project clip(s)` : 'Skipped (type-led)' })
    }

    // — 5. timeline ———————————————————————————————————————————————
    hooks.step(5, { status: 'running', progressPct: 20, message: 'Building designed, editable scenes' })
    guard()
    const built = buildDirection(plan, winner.id, uid, { media: mediaClips })
    hooks.commit(built.doc, `Autonomous run → ${winner.name} scenes`)
    hooks.step(5, {
      status: 'done',
      progressPct: 100,
      message: `${built.clipIds.length} clips · ${built.doc.trackCount} tracks · design ${built.design.score}/100 · ${built.reused ? `${built.reused} using your media · ` : ''}${built.placeholders} placeholder(s)`,
    })
    if (built.placeholders) warn(`${built.placeholders} scene(s) are placeholders — the brief did not say what to show there, so they are labelled for you to fill rather than invented.`)

    const doc = built.doc
    const review = reviewEdit(doc, plan.brief, plan.plan, built.clipIds)
    const reviewScorePct = reviewScore(review)

    // — 6. render —————————————————————————————————————————————————
    let output: RunOutput | undefined
    if (!stepDone(6) || !job.outputPath) {
      const caps = capabilitiesFor(job.quality, deps.canRecord ?? typeof MediaRecorder !== 'undefined')
      guard()
      if (!caps.canRender) {
        warn('This browser cannot record video (MediaRecorder is unavailable), so the run stopped at a reviewed preview: the scenes are in Studio and can be exported from there.')
        hooks.step(6, { status: 'done', progressPct: 100, message: 'Preview ready — export from Studio' })
      } else {
        hooks.step(6, { status: 'running', progressPct: 2, message: `Recording the ${Math.round(rundown.durationSec)}s edit at ${caps.renderScale === 1 ? 'full' : 'draft'} scale` })
        const result = await (await renderWith(deps))(doc, {
          fileName: `${slug(rundown.title)}-${job.id.slice(0, 6)}.webm`,
          scale: caps.renderScale,
          signal: state,
          onProgress: (pct) => hooks.step(6, { progressPct: Math.max(2, Math.min(99, Math.round(pct))), message: `Rendering ${Math.round(pct)}% · ${Math.round((pct / 100) * rundown.durationSec)}s of ${Math.round(rundown.durationSec)}s` }),
        })
        if (result.cancelled) throw new Error('Automation cancelled')
        output = { fileName: result.fileName, url: result.url, bytes: result.blob.size, mimeType: result.mimeType, durationSec: result.durationSec }
        hooks.patch({ outputPath: `cupric-runs/${job.id}/${output.fileName}`, outputUrl: output.url, warnings })
        hooks.step(6, { status: 'done', progressPct: 100, message: `${output.fileName} · ${(output.bytes / 1_048_576).toFixed(1)} MB · ${output.durationSec.toFixed(1)}s · ${output.mimeType.replace('video/', '')}` })
      }
    }

    // — 7. review ————————————————————————————————————————————————
    const leftForYou = [
      ...review.filter((c) => c.status !== 'pass').map((c) => `${c.label}: ${c.fix ?? c.detail}`),
      ...(built.placeholders ? [`${built.placeholders} placeholder scene(s) need real copy.`] : []),
    ]
    const artefacts: RunArtefacts = {
      job,
      rundown,
      candidates,
      doc,
      review,
      design: built.design,
      output,
      warnings,
      placeholders: built.placeholders,
      generatedAt: new Date().toISOString(),
    }
    const report = buildReport(artefacts)
    if (!stepDone(7)) {
      hooks.step(7, { status: 'running', progressPct: 40, message: 'Checking the delivered edit and writing the report' })
      hooks.step(7, { status: 'done', progressPct: 100, message: `Craft ${reviewScorePct}/100 · design ${built.design.score}/100 · ${warnings.length} note(s)` })
    }
    hooks.patch({
      status: 'done',
      waitingMessage: null,
      warnings,
      ...(output ? { outputPath: `cupric-runs/${job.id}/${output.fileName}` } : {}),
      reviewReportPath: `cupric-runs/${job.id}/review-report.md`,
      reviewReport: report.markdown,
      renderEvaluation: report.evaluation,
      designScore: built.design.score,
      renderEngine: 'studio-canvas',
      // The terminal patch is the whole truth about the run: the UI (and a
      // reload of a persisted job) can render the battle without replaying the
      // earlier progress patches.
      candidates: candidates.map((c) => ({ file: c.id, score: c.score, reasons: c.reasons })),
      candidateBattle: candidates.map((c) => ({ id: c.id, name: c.name, score: c.score, designScore: c.design.score, reasons: c.reasons })),
      designStoryboard: storyboardOf(built.design),
      outputUrl: output?.url ?? job.outputUrl ?? null,
    })
    return { plan, rundown, candidates, winner, doc, review, reviewScorePct, design: built.design, placeholders: built.placeholders, leftForYou, output, warnings }
  } finally {
    live.delete(job.id)
  }
}

/**
 * One direction, built from the same plan: `planToDoc` → motion direction →
 * design engine → polish. Only the direction (and its seed) changes between
 * candidates, which is what makes them genuinely different pieces rather than
 * three colour swaps of one layout.
 */
export function buildDirection(
  plan: LocalPlan,
  directionId: DesignDirectionId,
  makeId: () => string = uid,
  opts: { seed?: number; media?: StudioClip[] } = {},
): { doc: StudioDoc; clipIds: string[]; placeholders: number; design: DesignReport; reused: number } {
  const direction = directionById(directionId)
  // The project's own media is the base document `planToDoc` matches shot
  // asset names against — that is how a planned shot becomes a real clip.
  const base: StudioDoc = { ...emptyStudioDoc(), clips: opts.media ?? [], trackCount: 1 }
  const built = planToDoc(base, plan.plan, plan.brief, { makeId, replace: true, replaceApproved: true, motion: false })
  const moved = directProduction(built.doc, built.clipIds, plan.brief)
  const designed = designScenes(moved, {
    brandColors: plan.brief.brandColors,
    tone: plan.brief.tone,
    aspect: plan.brief.aspect,
    referenceStyle: plan.brief.referenceStyle,
    language: plan.brief.language,
  }, built.clipIds, { direction, makeId, seed: opts.seed ?? direction.lookOrder[0] })
  const polished = polishEdit(designed.doc, plan.brief, plan.plan, built.clipIds)
  return { doc: polished.doc, clipIds: built.clipIds, placeholders: built.placeholders, design: designed.report, reused: built.reused }
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48) || 'cupric-run'
