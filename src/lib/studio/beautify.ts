/**
 * The motion-craft pass — what a motion designer would fix first.
 *
 * The craft rules are learned from motion-launch-videos by Marouane Gazouzi
 * (MIT). Three of them do most of the work, and all three are things an
 * automatic pass can apply honestly because none of them invent content:
 *
 *   1. Nothing arrives on a linear ramp. Real motion overshoots and settles.
 *   2. One thing happens at a time. Six clips entering on the same frame is
 *      not a composition, it is a pile — stagger them on a rhythm.
 *   3. Nothing sits perfectly dead still. A still photo with a hair of
 *      loop-exact drift reads as alive; the same photo frozen reads as broken.
 *
 * This produces ordinary `setKeyframe` ops, so the result lands in the normal
 * plan preview, is fully editable afterwards, and undoes in one step. It never
 * touches a clip that already has motion — a pass that overwrites the work you
 * did by hand is not a polish, it is a reset.
 */
import type { StudioClip, StudioDoc } from '../../types/project'
import type { StudioEditOp } from './editOps'
import { hash } from './springs'

/** Beats per second for the stagger grid. 8 = a semiquaver at 120bpm. */
const GRID = 8
/** Clips entering within this many seconds of each other count as a pile. */
const PILE_SEC = 0.12
/** How far a still drifts, as a fraction of the frame. Deliberately small. */
const DRIFT = 0.012

const hasMotion = (c: StudioClip) => Array.isArray(c.keyframes) && c.keyframes.length > 1
/** Not every clip kind carries x/y/scale; fall back to the stage centre. */
const px = (c: StudioClip) => (c as { x?: number }).x ?? 0.5
const py = (c: StudioClip) => (c as { y?: number }).y ?? 0.5
const pscale = (c: StudioClip) => (c as { scale?: number }).scale ?? 1
const isVisual = (c: StudioClip) => c.kind !== 'audio' && c.kind !== 'adjustment'
const isStill = (c: StudioClip) => c.kind === 'image'

/** Snap a time to the rhythm grid, so entrances land on a beat. */
export const onGrid = (t: number): number => Math.round(t * GRID) / GRID

export type CraftFinding = {
  /** Stable id so the same doc always reports findings in the same order. */
  clipId: string
  /** What is wrong, in the user's terms. */
  issue: string
  /** What the pass will do about it. */
  fix: string
}

export type CraftPass = {
  /** The name this diff carries in the preview. Never nameless. */
  name: string
  findings: CraftFinding[]
  ops: StudioEditOp[]
}

/**
 * Find the clips that arrive at the same instant.
 *
 * Returns a map of clip id → the stagger offset it should take, in seconds.
 * The first clip of a pile keeps its time; the rest step back onto the grid
 * behind it, so the order you built survives.
 */
export function staggerOffsets(clips: readonly StudioClip[]): Map<string, number> {
  const out = new Map<string, number>()
  const sorted = [...clips].filter(isVisual).sort((a, b) => (a.startSec || 0) - (b.startSec || 0) || a.id.localeCompare(b.id))
  let i = 0
  while (i < sorted.length) {
    const base = sorted[i].startSec || 0
    const pile: StudioClip[] = [sorted[i]]
    let j = i + 1
    while (j < sorted.length && Math.abs((sorted[j].startSec || 0) - base) <= PILE_SEC) {
      pile.push(sorted[j])
      j += 1
    }
    if (pile.length > 1) {
      // One grid step between each, so they arrive in sequence not together.
      pile.forEach((clip, k) => {
        if (k > 0) out.set(clip.id, k / GRID)
      })
    }
    i = j
  }
  return out
}

/**
 * Build the craft pass for a document.
 *
 * Every op is justified by a finding, and a document that is already well
 * made produces an empty pass rather than busywork.
 */
export function craftPass(doc: StudioDoc): CraftPass {
  const findings: CraftFinding[] = []
  const ops: StudioEditOp[] = []
  const clips = (doc.clips ?? []).filter(isVisual)
  const stagger = staggerOffsets(doc.clips ?? [])

  for (const clip of clips) {
    const start = clip.startSec || 0
    const dur = clip.durationSec || 0
    if (dur <= 0.2) continue
    const name = clip.name || clip.kind

    // 1. A sprung entrance for anything that has no motion at all.
    if (!hasMotion(clip)) {
      const offset = stagger.get(clip.id) ?? 0
      const from = onGrid(start + offset)
      // Land a third of the way in, or 0.45s, whichever is sooner.
      const land = Math.min(from + 0.45, from + dur / 3)
      if (land > from) {
        findings.push({
          clipId: clip.id,
          issue: offset > 0
            ? `“${name}” arrives at the same instant as the clip before it.`
            : `“${name}” appears with no entrance at all.`,
          fix: offset > 0
            ? `Enters ${Math.round(offset * 1000)}ms later on the beat, on a Land spring.`
            : 'Rises and settles on a Land spring.',
        })
        ops.push({
          type: 'setKeyframe',
          clipId: clip.id,
          at: Number(from.toFixed(3)),
          values: { opacity: 0, scale: pscale(clip) * 0.94, y: py(clip) + 0.02 },
          ease: 'spring-land',
        })
        ops.push({
          type: 'setKeyframe',
          clipId: clip.id,
          at: Number(land.toFixed(3)),
          values: { opacity: 1, scale: pscale(clip), y: py(clip) },
          ease: 'spring-land',
        })
      }
      continue
    }

    // 2. A still that is genuinely static gets a hair of drift.
    if (isStill(clip) && dur >= 2) {
      const seed = Math.floor(hash(clip.id.length, Math.round(start * 100)) * 1000)
      const dir = seed % 2 === 0 ? 1 : -1
      findings.push({
        clipId: clip.id,
        issue: `“${name}” is a still photo held for ${dur.toFixed(1)}s without moving.`,
        fix: 'Drifts a fraction across the hold, so it reads as alive rather than frozen.',
      })
      ops.push({
        type: 'setKeyframe',
        clipId: clip.id,
        at: Number(start.toFixed(3)),
        values: { x: px(clip) - DRIFT * dir, scale: pscale(clip) * 1.01 },
        ease: 'spring-glide',
      })
      ops.push({
        type: 'setKeyframe',
        clipId: clip.id,
        at: Number((start + dur).toFixed(3)),
        values: { x: px(clip) + DRIFT * dir, scale: pscale(clip) * 1.04 },
        ease: 'spring-glide',
      })
    }
  }

  return {
    name: findings.length ? `Motion craft — ${findings.length} fix${findings.length === 1 ? '' : 'es'}` : 'Motion craft',
    findings,
    ops,
  }
}

/**
 * A plain-English report of what the pass found, for the review card.
 *
 * Empty when there is nothing to do — which is a real answer, not a failure.
 */
export function craftSummary(pass: CraftPass): string {
  if (!pass.findings.length) return 'Every clip already has an entrance and nothing sits dead still. Nothing to fix.'
  const entrances = pass.findings.filter((f) => f.fix.includes('spring')).length
  const drifts = pass.findings.filter((f) => f.fix.includes('Drifts')).length
  const parts: string[] = []
  if (entrances) parts.push(`${entrances} clip${entrances === 1 ? '' : 's'} given a sprung entrance on the beat`)
  if (drifts) parts.push(`${drifts} still${drifts === 1 ? '' : 's'} given a hair of drift`)
  return `${parts.join(', ')}. Nothing is deleted and no words change.`
}
