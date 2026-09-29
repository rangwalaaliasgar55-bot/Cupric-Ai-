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
import { applyGateFixes, DEFAULT_AUDIT_FPS, runGates, type DeliveryFindings, type GateName, type GateReport, type Level } from './gates'
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

/**
 * The times to look at: the midpoint of every text block (where the block is
 * fully composed) plus an even sweep of the timeline for everything else.
 * Deduplicated and sorted, so the report's second numbers mean something.
 */
export function auditTimes(doc: StudioDoc, opts: { fps?: number; maxFrames?: number } = {}): number[] {
  const duration = docDuration(doc)
  if (duration <= 0) return []
  const fps = Math.max(1, opts.fps ?? DEFAULT_AUDIT_FPS)
  const cap = Math.max(2, opts.maxFrames ?? AUDIT_MAX_FRAMES)
  const times = new Set<number>()
  for (let t = 0; t < duration; t += 1 / fps) times.add(Math.round(t * 1000) / 1000)
  for (const clip of doc.clips) {
    if (clip.kind !== 'text') continue
    const mid = clip.startSec + clip.durationSec / 2
    if (mid <= duration) times.add(Math.round(mid * 1000) / 1000)
  }
  const sorted = [...times].sort((a, b) => a - b)
  if (sorted.length <= cap) return sorted
  // Even stride, keeping the first and last: a shorter audit, not a different one.
  const stride = sorted.length / cap
  return Array.from({ length: cap }, (_, i) => sorted[Math.min(sorted.length - 1, Math.floor(i * stride))])
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

/** One line for the UI: what the audit found, in the language of the gates. */
export function describeAudit(report: GateReport): string {
  const worst = report.contrast.elements.length
    ? Math.min(...report.contrast.elements.map((e) => e.worstRatio))
    : null
  const bits = [report.summary]
  if (worst !== null) bits.push(`worst contrast ${worst}:1`)
  if (report.contrast.sampled) bits.push(`${report.contrast.sampled} text sample(s) over ${report.ran.length} gate(s)`)
  return bits.join(' · ')
}
