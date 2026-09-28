/**
 * V-2 background polish pass. While the user pauses, Cupric quietly plans an
 * auto-polish of the whole timeline with the same local planner the agent uses.
 * It never touches the doc: the result is only *offered*, then goes through the
 * normal preview diff → Accept/Reject → one atomic undo step.
 */
import type { StudioDoc } from '../../types/project'
import { localStudioEditPlan, validateStudioEditPlan, type StudioEditPlan } from './editOps'

/** How long the timeline must sit unchanged before the pass runs (ms). */
export const POLISH_IDLE_MS = 4000
const ENABLED_KEY = 'cupric.studio.backgroundPolish'

/** Cheap, order-stable fingerprint so an offer is tied to one exact timeline. */
export function docSignature(doc: StudioDoc): string {
  let h = 2166136261
  const s = JSON.stringify(doc.clips.map((c) => [c.id, c.kind, c.startSec, c.durationSec, c.track, (c as { text?: string }).text ?? '', (c as { motion?: unknown }).motion ?? null, (c as { keyframes?: unknown[] }).keyframes?.length ?? 0]))
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return `${doc.clips.length}:${(h >>> 0).toString(36)}`
}

export type PolishOffer = { signature: string; plan: StudioEditPlan }

/** Plan a polish pass for `doc`, or null when there is nothing honest to offer. */
export function backgroundPolishOffer(doc: StudioDoc): PolishOffer | null {
  const visual = doc.clips.filter((c) => c.kind !== 'audio')
  if (visual.length < 2) return null
  try {
    const raw = localStudioEditPlan('auto polish the whole timeline', doc, null)
    const plan = validateStudioEditPlan(raw, doc)
    if (!plan.ops.length) return null
    return { signature: docSignature(doc), plan: { ...plan, summary: `Background polish ready · ${plan.summary}` } }
  } catch {
    return null
  }
}

export function backgroundPolishEnabled(): boolean {
  try {
    return typeof localStorage === 'undefined' ? true : localStorage.getItem(ENABLED_KEY) !== 'off'
  } catch {
    return true
  }
}

export function setBackgroundPolishEnabled(on: boolean): void {
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(ENABLED_KEY, on ? 'on' : 'off')
  } catch {
    /* not remembered */
  }
}
