/**
 * JOB 12 — one plan, one truth.
 *
 * Cupric and the autonomous agent were tracking the same film in three
 * different places: `gettingStartedSteps` (5 steps derived from the project),
 * `AutomationJob.steps` (8 labels the agent writes as it goes) and the Quick
 * Video panel's own 7. Ask Cupric where you are and ask the agent where you
 * are and you could get two different answers. That is two brains.
 *
 * This module is the single spine both of them stand on: eight canonical
 * steps, each with an owner, each derived from real saved state rather than
 * ticked by hand, and the agent's own labels mapped onto the same eight. There
 * is now exactly one answer to "where are we".
 */
import type { AutomationJob, Project } from '../../types/project'

export type PlanStepId = 'intake' | 'brief' | 'rundown' | 'lock' | 'candidates' | 'gate' | 'timeline' | 'render'

/**
 * Who does this step.
 *
 * `you` means a human decision Cupric will not make on your behalf. `cupric`
 * is the conversational side. `agent` is the autonomous runner. Every step has
 * exactly one owner so nothing is silently done twice.
 */
export type StepOwner = 'you' | 'cupric' | 'agent'

export type PlanStep = {
  id: PlanStepId
  label: string
  owner: StepOwner
  /** Plain reason this step exists, shown under the badge. */
  why: string
  /**
   * Destructive steps overwrite work you could not get back by clicking again
   * — those, and only those, ask for approval. Everything else just runs.
   */
  destructive: boolean
  /** Snapshot after this step, so a crash resumes here instead of at zero. */
  checkpoint: boolean
  /** Steps that must finish first. Anything not listed can run in parallel. */
  needs: PlanStepId[]
}

export const PRODUCTION_PLAN: readonly PlanStep[] = [
  { id: 'intake', label: 'Intake', owner: 'you', why: 'What you are making, who it is for and where it goes. Every later choice is made from this.', destructive: false, checkpoint: true, needs: [] },
  { id: 'brief', label: 'Brief', owner: 'cupric', why: 'Cupric turns the intake into a written brief you can correct.', destructive: false, checkpoint: true, needs: ['intake'] },
  { id: 'rundown', label: 'Rundown', owner: 'cupric', why: 'The brief becomes scenes with timings.', destructive: false, checkpoint: true, needs: ['brief'] },
  { id: 'lock', label: 'Lock', owner: 'you', why: 'Locking fixes the running order everything downstream is built from.', destructive: true, checkpoint: true, needs: ['rundown'] },
  { id: 'candidates', label: 'Candidates', owner: 'agent', why: 'Several takes of the locked rundown so there is something to choose between.', destructive: false, checkpoint: true, needs: ['lock'] },
  { id: 'gate', label: 'Review gate', owner: 'you', why: 'You pick the take. Cupric never picks on your behalf.', destructive: false, checkpoint: false, needs: ['candidates'] },
  { id: 'timeline', label: 'Timeline', owner: 'agent', why: 'The chosen take becomes editable Studio clips in one undo step.', destructive: true, checkpoint: true, needs: ['gate'] },
  { id: 'render', label: 'Render', owner: 'you', why: 'Export uses the same renderer as the preview, so what you saw is what you get.', destructive: false, checkpoint: false, needs: ['timeline'] },
] as const

export type StepStatus = 'done' | 'current' | 'blocked' | 'waiting-for-you'
export type PlanStepState = PlanStep & { status: StepStatus; detail: string }

/**
 * The agent writes its own step labels. Map them onto the canonical eight so
 * the agent's progress and Cupric's progress are the same progress.
 */
export function stepIdForAutomationLabel(label: string): PlanStepId | null {
  const l = label.toLowerCase()
  if (l.includes('create project')) return 'intake'
  if (l.includes('rundown') && l.includes('lock')) return 'lock'
  if (l.includes('rundown')) return 'rundown'
  if (l.includes('candidate')) return 'candidates'
  if (l.includes('footage') || l.includes('ingest')) return 'candidates'
  if (l.includes('timeline')) return 'timeline'
  if (l.includes('render')) return 'render'
  if (l.includes('review')) return 'gate'
  if (l.includes('brief')) return 'brief'
  return null
}

const truthy = (v: unknown) => typeof v === 'string' && v.trim().length > 0

/**
 * Derive where the production actually is, from saved state only.
 *
 * Nothing here is set by a button: if a step reads "done" it is because the
 * artefact it produces exists. That is what stops the two trackers drifting.
 */
export function planState(project: Project | null | undefined, job?: AutomationJob | null): PlanStepState[] {
  const brief = project?.brief
  const done: Record<PlanStepId, boolean> = {
    intake: !!project && (brief?.messages?.some((m) => m.role === 'user') ?? false),
    brief: !!project && (brief?.messages?.some((m) => m.role === 'gemini') ?? false),
    rundown: !!brief?.draftRundown || !!brief?.lockedRundown,
    lock: !!brief?.lockedRundown,
    candidates: !!job?.winnerPath || (job?.steps ?? []).some((s) => stepIdForAutomationLabel(s.label) === 'candidates' && s.status === 'done'),
    gate: truthy(job?.winnerPath),
    timeline: (project?.studio?.clips?.length ?? 0) > 0,
    render: !!project?.renderJobs?.some((r) => r.status === 'done'),
  }

  // The first step that is not done is current; later ones are blocked by it.
  let foundCurrent = false
  return PRODUCTION_PLAN.map((step) => {
    let status: StepStatus
    let detail: string
    if (done[step.id]) {
      status = 'done'
      detail = 'Done'
    } else if (!foundCurrent) {
      foundCurrent = true
      status = step.owner === 'you' ? 'waiting-for-you' : 'current'
      detail = step.owner === 'you' ? 'Waiting for you' : `${step.owner === 'cupric' ? 'Cupric' : 'The agent'} can do this now`
    } else {
      status = 'blocked'
      const blocker = step.needs.map((n) => PRODUCTION_PLAN.find((s) => s.id === n)?.label).filter(Boolean)
      detail = blocker.length ? `Needs ${blocker.join(' and ')} first` : 'Not yet'
    }
    return { ...step, status, detail }
  })
}

/** The one step to do next — the same answer for Cupric and for the agent. */
export function currentStep(state: PlanStepState[]): PlanStepState | null {
  return state.find((s) => s.status === 'current' || s.status === 'waiting-for-you') ?? null
}

/**
 * Steps that can start right now alongside the current one.
 *
 * Anything whose prerequisites are all done is fair game — the runner does not
 * have to walk the list one at a time when two legs are independent.
 */
export function readySteps(state: PlanStepState[]): PlanStepState[] {
  const doneIds = new Set(state.filter((s) => s.status === 'done').map((s) => s.id))
  return state.filter((s) => s.status !== 'done' && s.needs.every((n) => doneIds.has(n)))
}

/** Approval is asked for destructive steps and nowhere else. */
export function needsApproval(id: PlanStepId): boolean {
  return PRODUCTION_PLAN.find((s) => s.id === id)?.destructive ?? false
}

/** Where a crashed session should resume: the last checkpoint that completed. */
export function resumePoint(state: PlanStepState[]): PlanStepId {
  const lastDone = [...state].reverse().find((s) => s.status === 'done' && s.checkpoint)
  return lastDone ? (state[state.indexOf(lastDone) + 1]?.id ?? lastDone.id) : 'intake'
}

export const OWNER_LABEL: Record<StepOwner, string> = { you: 'YOU', cupric: 'CUPRIC', agent: 'AGENT' }
