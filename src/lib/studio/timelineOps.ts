/**
 * Pro timeline edits (2.1) and markers (2.7).
 *
 * Every function is pure: StudioDoc in, StudioDoc out (or the same object
 * when nothing applies, so callers can explain the no-op instead of pushing an
 * empty undo step). The store wraps each call in one labelled undo step.
 */

import type { StudioClip, StudioDoc, StudioMarker } from '../../types/project'
import { MIN_CLIP_SEC, clipEnd } from './doc'
import { uid } from '../utils'

const r2 = (v: number) => Math.round(v * 100) / 100
const hasSource = (c: StudioClip): c is Extract<StudioClip, { sourceDurationSec: number }> => c.kind === 'video' || c.kind === 'audio'
const speedOf = (c: StudioClip) => (c.kind === 'video' && c.speed > 0 ? c.speed : 1)

export type EditResult = { doc: StudioDoc; changed: boolean; reason?: string }
const same = (doc: StudioDoc, reason: string): EditResult => ({ doc, changed: false, reason })

/** Delete a clip and pull everything after it on the same track left to close the hole. */
export function rippleDelete(doc: StudioDoc, clipId: string): EditResult {
  const clip = doc.clips.find((c) => c.id === clipId)
  if (!clip) return same(doc, 'Select a clip first.')
  const gap = clip.durationSec
  const clips = doc.clips
    .filter((c) => c.id !== clipId)
    .map((c) => (c.track === clip.track && c.startSec >= clipEnd(clip) - 0.001 ? { ...c, startSec: r2(Math.max(0, c.startSec - gap)) } : c))
  const markers = (doc.markers ?? []).map((m) => (m.at >= clipEnd(clip) ? { ...m, at: r2(m.at - gap) } : m))
  return { doc: { ...doc, clips, markers }, changed: true }
}

/** Q — trim the clip's head to the playhead (source in-point moves with it). */
export function trimStartTo(doc: StudioDoc, clipId: string, t: number): EditResult {
  const clip = doc.clips.find((c) => c.id === clipId)
  if (!clip) return same(doc, 'Select a clip first.')
  const cut = t - clip.startSec
  if (cut <= 0 || cut >= clip.durationSec - MIN_CLIP_SEC) return same(doc, 'Move the playhead inside the clip to trim its start.')
  const next = { ...clip, startSec: r2(t), durationSec: r2(clip.durationSec - cut) } as StudioClip
  if (hasSource(next)) (next as { trimInSec: number }).trimInSec = r2((clip as { trimInSec: number }).trimInSec + cut * speedOf(clip))
  if (next.keyframes?.length) next.keyframes = next.keyframes.map((k) => ({ ...k, at: r2(k.at - cut) })).filter((k) => k.at >= -0.001)
  return { doc: { ...doc, clips: doc.clips.map((c) => (c.id === clipId ? next : c)) }, changed: true }
}

/** W — trim the clip's tail to the playhead. */
export function trimEndTo(doc: StudioDoc, clipId: string, t: number): EditResult {
  const clip = doc.clips.find((c) => c.id === clipId)
  if (!clip) return same(doc, 'Select a clip first.')
  const dur = t - clip.startSec
  if (dur < MIN_CLIP_SEC || dur >= clip.durationSec) return same(doc, 'Move the playhead inside the clip to trim its end.')
  const next = { ...clip, durationSec: r2(dur) } as StudioClip
  return { doc: { ...doc, clips: doc.clips.map((c) => (c.id === clipId ? next : c)) }, changed: true }
}

/** Slip — move the source window under a fixed clip (video/audio only). */
export function slipClip(doc: StudioDoc, clipId: string, deltaSec: number): EditResult {
  const clip = doc.clips.find((c) => c.id === clipId)
  if (!clip || !hasSource(clip)) return same(doc, 'Slip works on video and audio clips.')
  const src = clip.sourceDurationSec
  const used = clip.durationSec * speedOf(clip)
  const max = src > 0 ? Math.max(0, src - used) : Number.POSITIVE_INFINITY
  const nextIn = r2(Math.min(max, Math.max(0, clip.trimInSec + deltaSec)))
  if (nextIn === clip.trimInSec) return same(doc, 'No more source media to slip into.')
  return { doc: { ...doc, clips: doc.clips.map((c) => (c.id === clipId ? ({ ...c, trimInSec: nextIn } as StudioClip) : c)) }, changed: true }
}

/**
 * Roll — move the cut between two touching clips on one track. The left clip
 * grows by delta and the right one shrinks (its in-point follows), so the
 * total length of the edit never changes.
 */
export function rollEdit(doc: StudioDoc, leftId: string, deltaSec: number): EditResult {
  const left = doc.clips.find((c) => c.id === leftId)
  if (!left) return same(doc, 'Select the clip before the cut.')
  const right = doc.clips.find((c) => c.id !== leftId && c.track === left.track && Math.abs(c.startSec - clipEnd(left)) < 0.02)
  if (!right) return same(doc, 'Roll needs a clip directly after this one on the same track.')
  const d = Math.max(-(left.durationSec - MIN_CLIP_SEC), Math.min(right.durationSec - MIN_CLIP_SEC, deltaSec))
  if (Math.abs(d) < 0.005) return same(doc, 'Nothing left to roll.')
  const nl = { ...left, durationSec: r2(left.durationSec + d) } as StudioClip
  const nr = { ...right, startSec: r2(right.startSec + d), durationSec: r2(right.durationSec - d) } as StudioClip
  if (hasSource(nr)) (nr as { trimInSec: number }).trimInSec = r2(Math.max(0, (right as { trimInSec: number }).trimInSec + d * speedOf(right)))
  return { doc: { ...doc, clips: doc.clips.map((c) => (c.id === left.id ? nl : c.id === right.id ? nr : c)) }, changed: true }
}

/**
 * Slide — move a clip between its touching neighbours. The clip keeps its
 * length and source frames; the left neighbour's out-point and the right
 * neighbour's in-point absorb the move, so the edit's total length is
 * unchanged. Works with either neighbour missing (that side is then free
 * space, which must not overlap anything).
 */
export function slideClip(doc: StudioDoc, clipId: string, deltaSec: number): EditResult {
  const clip = doc.clips.find((c) => c.id === clipId)
  if (!clip) return same(doc, 'Select a clip to slide.')
  const left = doc.clips.find((c) => c.id !== clipId && c.track === clip.track && Math.abs(clipEnd(c) - clip.startSec) < 0.02)
  const right = doc.clips.find((c) => c.id !== clipId && c.track === clip.track && Math.abs(c.startSec - clipEnd(clip)) < 0.02)
  if (!left && !right) return same(doc, 'Slide needs a clip touching this one on the same track — use Move otherwise.')
  let lo = left ? -(left.durationSec - MIN_CLIP_SEC) : -clip.startSec
  let hi = right ? right.durationSec - MIN_CLIP_SEC : Number.POSITIVE_INFINITY
  // A free side must not run into another clip.
  const others = doc.clips.filter((c) => c.track === clip.track && c.id !== clipId && c !== left && c !== right)
  if (!left) for (const o of others) if (clipEnd(o) <= clip.startSec + 1e-6) lo = Math.max(lo, clipEnd(o) - clip.startSec)
  if (!right) for (const o of others) if (o.startSec >= clipEnd(clip) - 1e-6) hi = Math.min(hi, o.startSec - clipEnd(clip))
  // A source-backed right neighbour can't be pulled before its first frame.
  if (right && hasSource(right)) lo = Math.max(lo, -(right as { trimInSec: number }).trimInSec / speedOf(right))
  if (left && hasSource(left) && left.sourceDurationSec > 0) hi = Math.min(hi, (left.sourceDurationSec - left.trimInSec) / speedOf(left) - left.durationSec)
  const d = Math.max(lo, Math.min(hi, deltaSec))
  if (Math.abs(d) < 0.005) return same(doc, 'No room to slide further.')
  const moved = { ...clip, startSec: r2(clip.startSec + d) } as StudioClip
  const nl = left ? ({ ...left, durationSec: r2(left.durationSec + d) } as StudioClip) : null
  let nr: StudioClip | null = null
  if (right) {
    nr = { ...right, startSec: r2(right.startSec + d), durationSec: r2(right.durationSec - d) } as StudioClip
    if (hasSource(nr)) (nr as { trimInSec: number }).trimInSec = r2(Math.max(0, (right as { trimInSec: number }).trimInSec + d * speedOf(right)))
  }
  return { doc: { ...doc, clips: doc.clips.map((c) => (c.id === clip.id ? moved : nl && c.id === nl.id ? nl : nr && c.id === nr.id ? nr : c)) }, changed: true }
}

/** Close every gap on a track (or all tracks), keeping clip order. */
export function closeGaps(doc: StudioDoc, track?: number): EditResult {
  const tracks = track === undefined ? [...new Set(doc.clips.map((c) => c.track))] : [track]
  const moved = new Map<string, number>()
  for (const tr of tracks) {
    let cursor = 0
    for (const c of doc.clips.filter((x) => x.track === tr).sort((a, b) => a.startSec - b.startSec)) {
      if (c.startSec > cursor + 0.005) moved.set(c.id, r2(cursor))
      cursor = (moved.get(c.id) ?? c.startSec) + c.durationSec
    }
  }
  if (!moved.size) return same(doc, 'There are no gaps to close.')
  return { doc: { ...doc, clips: doc.clips.map((c) => (moved.has(c.id) ? { ...c, startSec: moved.get(c.id)! } : c)) }, changed: true }
}

/* ——— markers ——— */

export function addMarker(doc: StudioDoc, at: number, label = ''): EditResult {
  const markers = doc.markers ?? []
  if (markers.some((m) => Math.abs(m.at - at) < 0.05)) return same(doc, 'There is already a marker here.')
  const marker: StudioMarker = { id: uid(), at: r2(Math.max(0, at)), label: label || `Marker ${markers.length + 1}`, color: 'lime' }
  return { doc: { ...doc, markers: [...markers, marker].sort((a, b) => a.at - b.at) }, changed: true }
}

export function removeMarker(doc: StudioDoc, id: string): EditResult {
  const markers = doc.markers ?? []
  if (!markers.some((m) => m.id === id)) return same(doc, 'That marker is already gone.')
  return { doc: { ...doc, markers: markers.filter((m) => m.id !== id) }, changed: true }
}

/** Marker times, for snapTime's `extra` list. */
export function markerTimes(doc: StudioDoc): number[] {
  return (doc.markers ?? []).map((m) => m.at)
}

/** The next / previous marker from t (for , and . navigation). */
export function jumpMarker(doc: StudioDoc, t: number, dir: 1 | -1): number | null {
  const times = markerTimes(doc).sort((a, b) => a - b)
  if (dir > 0) return times.find((m) => m > t + 0.01) ?? null
  return [...times].reverse().find((m) => m < t - 0.01) ?? null
}
