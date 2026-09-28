/**
 * Keyframe value graph: pure helpers behind the inspector's graph editor.
 * The curve is sampled from the renderer's own `keyframeValuesAt`, so what
 * the graph shows is exactly what preview and export draw.
 */
import type { StudioClip, StudioKeyframe } from '../../types/project'
import { keyframeValuesAt } from './renderer'

export type GraphProp = 'x' | 'y' | 'scale' | 'rotation' | 'opacity' | 'blur' | 'glow' | 'hue' | 'tiltX' | 'turnY'
export const GRAPH_PROPS: Array<{ id: GraphProp; label: string; min: number; max: number; rest: number; step: number }> = [
  { id: 'opacity', label: 'Opacity', min: 0, max: 1, rest: 1, step: 0.01 },
  { id: 'scale', label: 'Scale', min: 0, max: 3, rest: 1, step: 0.01 },
  { id: 'x', label: 'Position X', min: -0.5, max: 1.5, rest: 0.5, step: 0.005 },
  { id: 'y', label: 'Position Y', min: -0.5, max: 1.5, rest: 0.5, step: 0.005 },
  { id: 'rotation', label: 'Rotation', min: -360, max: 360, rest: 0, step: 1 },
  { id: 'blur', label: 'Blur', min: 0, max: 40, rest: 0, step: 0.5 },
  { id: 'glow', label: 'Glow', min: 0, max: 1, rest: 0, step: 0.01 },
  { id: 'hue', label: 'Hue shift', min: -180, max: 180, rest: 0, step: 1 },
  { id: 'tiltX', label: '3D tilt', min: -80, max: 80, rest: 0, step: 1 },
  { id: 'turnY', label: '3D turn', min: -80, max: 80, rest: 0, step: 1 },
]
export const propInfo = (id: GraphProp) => GRAPH_PROPS.find((p) => p.id === id)!

/** The property's resting value on this clip (used where no key sets it). */
export function restValue(clip: StudioClip, prop: GraphProp): number {
  const v = (clip as unknown as Record<string, unknown>)[prop]
  return typeof v === 'number' ? v : propInfo(prop).rest
}

/** Properties that at least one key animates. */
export function animatedProps(keys: StudioKeyframe[] | null | undefined): GraphProp[] {
  return GRAPH_PROPS.filter((p) => (keys ?? []).some((k) => typeof k[p.id] === 'number')).map((p) => p.id)
}

/** `n + 1` samples of the property across the clip, clip-local seconds. */
export function sampleProp(clip: StudioClip, prop: GraphProp, n = 80): Array<[number, number]> {
  const rest = restValue(clip, prop)
  return Array.from({ length: n + 1 }, (_, i) => {
    const t = (clip.durationSec * i) / n
    const v = keyframeValuesAt(clip, clip.startSec + t)?.[prop]
    return [t, typeof v === 'number' ? v : rest] as [number, number]
  })
}

/** Value range to draw: the prop's natural range, widened to fit overshoot. */
export function graphRange(samples: Array<[number, number]>, prop: GraphProp): [number, number] {
  const info = propInfo(prop)
  const vs = samples.map((s) => s[1])
  let lo = Math.min(...vs)
  let hi = Math.max(...vs)
  if (hi - lo < (info.max - info.min) * 0.1) { const mid = (hi + lo) / 2; const half = (info.max - info.min) * 0.1; lo = mid - half; hi = mid + half }
  const pad = (hi - lo) * 0.12
  return [lo - pad, hi + pad]
}

const r2 = (v: number) => Math.round(v * 100) / 100
const snapTo = (v: number, step: number) => Math.round(v / step) * step

/** Move key `index` to (at, value) for `prop`. Clamped, rounded, re-sorted. */
export function moveKey(keys: StudioKeyframe[], index: number, at: number, value: number, prop: GraphProp, durationSec: number): StudioKeyframe[] {
  const info = propInfo(prop)
  const clampedAt = Math.min(durationSec, Math.max(0, r2(at)))
  // Never land exactly on another key (that makes a zero-length segment).
  const taken = new Set(keys.filter((_, i) => i !== index).map((k) => k.at))
  let finalAt = clampedAt
  while (taken.has(finalAt) && finalAt < durationSec) finalAt = r2(finalAt + 0.01)
  const v = Math.min(info.max, Math.max(info.min, snapTo(value, info.step)))
  return keys.map((k, i) => (i === index ? { ...k, at: finalAt, [prop]: Number(v.toFixed(4)) } : k)).sort((a, b) => a.at - b.at)
}

/** Add a key on `prop` at clip-local `at`, valued from the current curve. */
export function addKeyAt(clip: StudioClip, prop: GraphProp, at: number): StudioKeyframe[] {
  const keys = clip.keyframes ?? []
  const t = Math.min(clip.durationSec, Math.max(0, r2(at)))
  const v = keyframeValuesAt(clip, clip.startSec + t)?.[prop] ?? restValue(clip, prop)
  const existing = keys.findIndex((k) => Math.abs(k.at - t) < 0.005)
  if (existing >= 0) return keys.map((k, i) => (i === existing ? { ...k, [prop]: v } : k))
  return [...keys, { at: t, ease: 'ease-in-out', [prop]: v } as StudioKeyframe].sort((a, b) => a.at - b.at)
}

/* ——— copy / paste (relative timing) ——— */
export type KeyClipboard = { keys: StudioKeyframe[]; spanSec: number }

export function copyKeys(keys: StudioKeyframe[]): KeyClipboard | null {
  if (!keys.length) return null
  const first = Math.min(...keys.map((k) => k.at))
  const rel = keys.map((k) => ({ ...k, at: r2(k.at - first) })).sort((a, b) => a.at - b.at)
  return { keys: rel, spanSec: rel[rel.length - 1].at }
}

/**
 * Paste at clip-local `at`. Keys past the clip end are dropped. With
 * `fit`, timing is scaled to fill from `at` to the end, so a 2 s move pasted
 * on a 1 s clip still completes.
 */
export function pasteKeys(target: StudioKeyframe[], clip: KeyClipboard, at: number, durationSec: number, fit = false): { keys: StudioKeyframe[]; dropped: number } {
  const room = Math.max(0, durationSec - at)
  const k = fit && clip.spanSec > 0 ? room / clip.spanSec : 1
  const placed = clip.keys.map((key) => ({ ...key, at: r2(at + key.at * k) }))
  const kept = placed.filter((key) => key.at <= durationSec + 1e-6)
  const times = new Set(kept.map((key) => key.at))
  const merged = [...target.filter((key) => !times.has(key.at)), ...kept].sort((a, b) => a.at - b.at)
  return { keys: merged, dropped: placed.length - kept.length }
}

/** One ease for every segment (quick "make it all smooth / snappy"). */
export function setAllEases(keys: StudioKeyframe[], ease: StudioKeyframe['ease']): StudioKeyframe[] {
  return keys.map((k) => ({ ...k, ease, bezier: ease === 'bezier' ? k.bezier : undefined }))
}
