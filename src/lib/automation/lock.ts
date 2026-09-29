/**
 * Locking a rundown, in the browser build.
 *
 * The desktop pipeline validates the rundown in `electron/automation-steps.cjs`
 * (step 2) and refuses to continue if it does not satisfy the render contract.
 * The web build runs the same eight steps locally (`run.ts`), and until now its
 * step 2 only said "Locking the rundown for review and render" without checking
 * anything — a claim with nothing behind it.
 *
 * This module is the browser-side half of the same rule set. It mirrors
 * `electron/automation-steps.cjs` deliberately (the renderer cannot require a
 * main-process CommonJS file), and
 * `src/tests/automation-lock-parity.test.ts` runs both implementations over the
 * same fixtures and fails if their verdicts ever disagree — so the duplication
 * cannot drift unnoticed.
 *
 * No crypto here: the browser build has no synchronous hash, and the *verdict*
 * is what the web runner acts on. The desktop lock additionally records a
 * content hash so a later edit is detectable; that path keeps its own hash in
 * `electron/automation-steps.cjs`.
 */
import type { SceneRundown } from '../../types/project'

export const MIN_SCENE_SEC = 0.3
export const MAX_SCENE_SEC = 60
export // Kept identical to electron/automation-steps.cjs (see the parity test).
const REQUIRED_SCENE_FIELDS = ['type', 'from', 'to'] as const
const COVERAGE_TOLERANCE_SEC = 0.05
export const SUPPORTED_FPS = [24, 25, 30, 60] as const

export type RundownVerdict = {
  ok: boolean
  issues: string[]
  checks: { id: string; detail: string }[]
}

const round2 = (value: number) => Math.round((Number(value) || 0) * 100) / 100

export function expectedSizeFor(aspect: string): [number, number] {
  return aspect === '9:16' ? [1080, 1920] : aspect === '1:1' ? [1080, 1080] : [1920, 1080]
}

/**
 * The same questions the desktop lock asks, in the same order, with the same
 * wording where the answer is negative — so a user sees one vocabulary for one
 * problem whichever build they are in.
 */
export function validateRundown(rundown: Partial<SceneRundown> | null | undefined, options: { aspect?: string; fps?: number } = {}): RundownVerdict {
  const aspect = options.aspect ?? '9:16'
  const fps = Number(options.fps ?? rundown?.fps ?? 30)
  const issues: string[] = []
  const scenes = Array.isArray(rundown?.scenes) ? rundown!.scenes : []
  const durationSec = Number(rundown?.durationSec)

  if (!rundown) issues.push('the rundown is missing entirely')
  if (!Number.isFinite(durationSec) || durationSec <= 0) issues.push('durationSec must be a positive number')
  if (!(SUPPORTED_FPS as readonly number[]).includes(fps)) issues.push(`fps ${fps} is not a supported frame rate`)
  if (!scenes.length) issues.push('the rundown has no scenes')
  if (String(rundown?.title ?? '').trim().length < 2) issues.push('the rundown has no title')

  const expected = expectedSizeFor(aspect)
  const size = Array.isArray(rundown?.size) ? (rundown!.size as number[]).map(Number) : []
  if (size.length !== 2 || size[0] !== expected[0] || size[1] !== expected[1]) {
    issues.push(`size ${JSON.stringify(size)} does not match aspect ${aspect} (${expected.join('x')})`)
  }

  let covered = 0
  let withCopy = 0
  let previousTo = 0
  scenes.forEach((scene, index) => {
    const label = `scene ${index + 1}`
    for (const field of REQUIRED_SCENE_FIELDS) {
      const value = scene?.[field]
      if (value === undefined || value === null || value === '') issues.push(`${label} has no ${field}`)
    }
    const from = Number(scene?.from)
    const to = Number(scene?.to)
    if (!Number.isFinite(from) || !Number.isFinite(to)) {
      issues.push(`${label} has non-numeric times`)
      return
    }
    const length = to - from
    if (length < MIN_SCENE_SEC) issues.push(`${label} is ${round2(length)}s long (minimum ${MIN_SCENE_SEC}s)`)
    if (length > MAX_SCENE_SEC) issues.push(`${label} is ${round2(length)}s long (maximum ${MAX_SCENE_SEC}s)`)
    if (Math.abs(from - previousTo) > COVERAGE_TOLERANCE_SEC) issues.push(`${label} starts at ${round2(from)}s but the previous scene ended at ${round2(previousTo)}s`)
    if (Number.isFinite(durationSec) && to > durationSec + COVERAGE_TOLERANCE_SEC) issues.push(`${label} ends at ${round2(to)}s, past the ${round2(durationSec)}s rundown`)
    if (String(scene?.copy ?? '').length > 220) issues.push(`${label} copy is longer than 220 characters`)
    if (String(scene?.copy ?? '').trim()) withCopy += 1
    previousTo = to
    covered += Math.max(0, length)
  })

  if (scenes.length > 0 && withCopy === 0) issues.push('the rundown has no on-screen copy in any scene')

  if (Number.isFinite(durationSec) && durationSec > 0) {
    const gap = Math.abs(durationSec - covered)
    if (gap > COVERAGE_TOLERANCE_SEC) issues.push(`the scenes cover ${round2(covered)}s of a ${round2(durationSec)}s rundown (${round2(gap)}s unaccounted for)`)
  }

  return {
    ok: issues.length === 0,
    issues,
    checks: [
      { id: 'duration', detail: `${round2(durationSec)}s` },
      { id: 'fps', detail: `${fps}fps` },
      { id: 'size', detail: size.join('x') },
      { id: 'scenes', detail: `${scenes.length} scenes covering ${round2(covered)}s` },
      { id: 'contiguous', detail: issues.some((issue) => /starts at/.test(issue)) ? 'gaps found' : 'no gaps or overlaps' },
    ],
  }
}

/** What the runner puts in the step message when the lock passes. */
export function lockSummary(rundown: SceneRundown, options: { aspect?: string; fps?: number } = {}): string {
  const verdict = validateRundown(rundown, options)
  if (!verdict.ok) return `Not locked: ${verdict.issues.join('; ')}`
  const scenes = rundown.scenes.length
  return `Locked · ${scenes} scene${scenes === 1 ? '' : 's'} · ${round2(rundown.durationSec)}s · ${expectedSizeFor(options.aspect ?? '9:16').join('x')}`
}
