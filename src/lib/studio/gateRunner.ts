/**
 * Delivery gates, run on the user's own document.
 *
 * `gates.ts` judges frames; something has to render them. The Studio already
 * knows how (it is the same `drawStudioFrame` the preview and the export use),
 * so a check here measures the real composition rather than a model of it:
 *
 *   render   a handful of frames across the timeline at audit size
 *   measure  the box each text block occupies, from the renderer's own layout
 *   judge    lint → safe zones → contrast → delivery, stopping at the first error
 *
 * Frames are sampled at `DEFAULT_AUDIT_FPS` and capped, because contrast that
 * fails for a second is contrast that failed — there is nothing to learn from
 * the third hundred frame of a static caption.
 */

import type { StudioAspect, StudioDoc, StudioTextClip } from '../../types/project'
import { docDuration } from './doc'
import { applyGateFixes, DEFAULT_AUDIT_FPS, runGates, type DeliveryFindings, type GateFinding, type GateName, type GateReport, type Level } from './gates'
import { drawableElement, drawStudioFrame } from './renderer'
import { textBox } from './textLayout'

/** Audit at half preview size: the ring sampler needs a few hundred pixels, not 4K. */
export const AUDIT_SHORT_SIDE = 540
/** More frames than this tells the same story for a longer wait. */
export const AUDIT_MAX_FRAMES = 24

export interface AuditOptions {
  level?: Level
  fps?: number
  maxFrames?: number
  shortSide?: number
  skip?: GateName[]
  delivery?: DeliveryFindings
  hasMedia?: (mediaId: string) => boolean
  budgetMs?: number
}

/** Frame size for an aspect at a given short side, always even. */
export function auditSize(aspect: StudioAspect, shortSide = AUDIT_SHORT_SIDE): [number, number] {
  const even = (n: number) => {
    const r = Math.max(2, Math.round(n))
    return r % 2 === 0 ? r : r + 1
  }
  const ratio = aspect === '9:16' ? 9 / 16 : aspect === '4:5' ? 4 / 5 : aspect === '16:9' ? 16 / 9 : 1
  return ratio >= 1 ? [even(shortSide * ratio), even(shortSide)] : [even(shortSide), even(shortSide / ratio)]
}

/** Even stride over a sorted list, keeping the first and the last. */
function evenStride(list: number[], count: number): number[] {
  if (list.length <= count) return [...list]
  const stride = list.length / count
  return Array.from({ length: count }, (_, i) => list[Math.min(list.length - 1, Math.floor(i * stride))])
}

/**
 * The times to look at.
 *
 * The edit points come first, and this is deliberate — upstream's
 * `cut-frames.ts` earned it: a run that sampled its deliverable on an even grid
 * (1.2, 3.8, 9.5, 15.0, 21.5 s) called the composite clean while its defect
 * lived only at the cuts (1.83, 5.29, 8.58, 10.75 s), where the previous shot
 * showed through for a few frames. Evenly spaced frames are the wrong frames.
 *
 * So the audit keeps: the start and end of every clip, the midpoint of every
 * text block, and every timed block's first and last reveal — the moments where
 * something changes — and then fills whatever room is left with an even sweep,
 * so a fault in the quiet middle of a long shot still has a chance of being seen.
 * Deduplicated, sorted, and capped.
 */
export function auditTimes(doc: StudioDoc, opts: { fps?: number; maxFrames?: number } = {}): number[] {
  const duration = docDuration(doc)
  if (duration <= 0) return []
  const fps = Math.max(1, opts.fps ?? DEFAULT_AUDIT_FPS)
  const cap = Math.max(2, opts.maxFrames ?? AUDIT_MAX_FRAMES)
  const at = (t: number) => Math.round(Math.min(duration, Math.max(0, t)) * 1000) / 1000

  const priority = new Set<number>([0, at(duration)])
  for (const clip of doc.clips) {
    priority.add(at(clip.startSec))
    priority.add(at(clip.startSec + clip.durationSec))
    if (clip.kind !== 'text') continue
    priority.add(at(clip.startSec + clip.durationSec / 2))
    const delays = (clip.wordDelaysMs ?? []).filter((d) => Number.isFinite(d))
    if (delays.length) {
      priority.add(at(clip.startSec + Math.min(...delays) / 1000))
      priority.add(at(clip.startSec + Math.max(...delays) / 1000))
    }
  }
  const wanted = [...priority].sort((a, b) => a - b)
  if (wanted.length >= cap) return evenStride(wanted, cap)

  const chosen = new Set<number>(wanted)
  const room = cap - chosen.size
  const sweep: number[] = []
  for (let t = 0; t < duration; t += 1 / fps) sweep.push(at(t))
  for (const t of (sweep.length <= room ? sweep : evenStride(sweep, room))) chosen.add(t)
  return [...chosen].sort((a, b) => a - b)
}

export type AuditFrames = Array<{
  tSec: number
  width: number
  height: number
  rgba: Uint8ClampedArray
  boxes: Array<ReturnType<typeof textBox>>
}>

/**
 * Render the document's own frames. Browser-only by nature (`document`), so the
 * caller supplies the canvas element when it has one — the desktop renderer
 * passes its hidden canvas, tests pass a stub.
 */
export function renderAuditFrames(
  doc: StudioDoc,
  opts: AuditOptions & { canvas?: HTMLCanvasElement } = {},
): AuditFrames {
  if (typeof document === 'undefined' && !opts.canvas) return []
  const [width, height] = auditSize(doc.aspect, opts.shortSide)
  const canvas = opts.canvas ?? document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D | null
  if (!ctx) return []
  const frames: AuditFrames = []
  for (const tSec of auditTimes(doc, opts)) {
    ctx.clearRect(0, 0, width, height)
    drawStudioFrame(ctx, doc, tSec, width, height, {
      media: (clip) => drawableElement(clip.mediaId),
      overlay: () => null,
    })
    const boxes = doc.clips
      .filter((clip): clip is StudioTextClip => clip.kind === 'text' && !clip.hidden)
      .filter((clip) => tSec >= clip.startSec && tSec <= clip.startSec + clip.durationSec)
      .map((clip) => textBox(ctx, clip, width, height))
    frames.push({ tSec, width, height, rgba: ctx.getImageData(0, 0, width, height).data, boxes })
  }
  return frames
}

/**
 * The whole audit: render, then run the chain. Returns the report and the frames
 * it judged, so a caller can show the failing second rather than asserting it.
 */
export function runStudioAudit(doc: StudioDoc, opts: AuditOptions & { canvas?: HTMLCanvasElement } = {}): { report: GateReport; frames: AuditFrames } {
  const frames = renderAuditFrames(doc, opts)
  const report = runGates({
    doc,
    frames,
    ...(opts.level ? { level: opts.level } : {}),
    ...(opts.skip ? { skip: opts.skip } : {}),
    ...(opts.delivery ? { delivery: opts.delivery } : {}),
    ...(opts.budgetMs !== undefined ? { budgetMs: opts.budgetMs } : {}),
    ...(opts.hasMedia ? { hasMedia: opts.hasMedia } : {}),
  })
  return { report, frames }
}

/**
 * Apply every one-click fix a report proposed. One document edit, so it is one
 * undo step: "Fix all" that takes five presses of Ctrl+Z is not a fix.
 */
export function applyAuditFixes(doc: StudioDoc, report: GateReport): { doc: StudioDoc; applied: number } {
  return applyGateFixes(doc, report.findings)
}

/**
 * Did the fix actually fix it?
 *
 * Adapted from open-edit's `cli/src/wcag/verify-applied.ts` (Apache-2.0 — see
 * THIRD_PARTY_NOTICES.md), whose argument is the reason this exists: a fix is
 * *scored* analytically against the samples that were already taken, so a patch
 * that targeted the wrong element, wrote the wrong value, or never landed would
 * still be reported as an improvement. The proof has to come from re-measuring,
 * not from the fix's own arithmetic.
 *
 * So after "Fix all" this renders the patched document again, runs the same
 * chain over it, and compares the two reports:
 *
 *   cleared     a proposed fix whose finding is gone — the fix did what it said
 *   unresolved  a proposed fix whose finding is still there — it did not
 *   appeared    an error that was NOT in the first report — the fix broke
 *               something else, which is exactly what nobody checks
 *
 * A finding is matched by gate + id + clip, so two blocks with the same problem
 * cannot stand in for each other.
 */
export interface FixVerification {
  before: GateReport
  after: GateReport
  /** How many fixes the previous report proposed. */
  proposed: number
  cleared: GateFinding[]
  unresolved: GateFinding[]
  appeared: GateFinding[]
  ok: boolean
  summary: string
}

const findingKey = (f: GateFinding) => `${f.gate}:${f.id}:${f.clipId ?? ''}`

/** The findings a report proposed a one-click fix for — the ones `applyAuditFixes` patches. */
export function proposedFixes(report: GateReport): GateFinding[] {
  return report.findings.filter((f) => Boolean(f.fix && f.clipId))
}

/**
 * Re-run the chain on the document a fix produced and say what it achieved.
 * Costs one more render pass, which is why the caller asks for it when a fix is
 * applied rather than on every audit.
 */
export function verifyAppliedFixes(
  before: GateReport,
  fixed: StudioDoc,
  opts: AuditOptions & { canvas?: HTMLCanvasElement } = {},
): FixVerification {
  const { report: after } = runStudioAudit(fixed, opts)
  const afterKeys = new Set(after.findings.map(findingKey))
  const beforeKeys = new Set(before.findings.map(findingKey))
  const proposed = proposedFixes(before)
  const cleared = proposed.filter((f) => !afterKeys.has(findingKey(f)))
  const unresolved = proposed.filter((f) => afterKeys.has(findingKey(f)))
  const appeared = after.findings.filter((f) => f.severity === 'error' && !beforeKeys.has(findingKey(f)))
  const ok = unresolved.length === 0 && appeared.length === 0
  const summary = !proposed.length
    ? 'No fix was proposed, so there was nothing to verify.'
    : ok
      ? `Re-checked the result: ${cleared.length}/${proposed.length} proposed fix(es) held${appeared.length ? '' : ' and no new error appeared'}.`
      : `Re-checked the result: ${cleared.length}/${proposed.length} proposed fix(es) held${unresolved.length ? `, ${unresolved.length} did not` : ''}${appeared.length ? `, and ${appeared.length} new error appeared` : ''}.`
  return { before, after, proposed: proposed.length, cleared, unresolved, appeared, ok, summary }
}

/** One line for the UI: what the audit found, in the language of the gates. */
export function describeAudit(report: GateReport): string {
  const worst = report.contrast.elements.length
    ? Math.min(...report.contrast.elements.map((e) => e.worstRatio))
    : null
  const bits = [report.summary]
  if (worst !== null) bits.push(`worst contrast ${worst}:1`)
  if (report.contrast.sampled) bits.push(`${report.contrast.sampled} text sample(s) over ${report.ran.length} gate(s)`)
  if (report.timing?.blocks) bits.push(`${report.timing.blocks} timed block(s) judged for when they appear`)
  return bits.join(' · ')
}
