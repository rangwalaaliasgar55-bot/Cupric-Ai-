/**
 * StudioDoc helpers — pure functions over the edit document.
 * Anything that mutates an edit lives here so the store, the renderer and the
 * exporter all agree on what a clip means.
 */

import type {
  StudioAspect,
  StudioAudioClip,
  StudioClip,
  StudioDoc,
  StudioGlassClip,
  StudioMediaClip,
  StudioStickerClip,
  StudioTextClip,
} from '../../types/project'
import { clamp, uid } from '../utils'

export const MIN_CLIP_SEC = 0.2
export const DEFAULT_TRACKS = 3

export function emptyStudioDoc(): StudioDoc {
  return {
    aspect: '9:16',
    fps: 30,
    backgroundId: 'lime-void',
    clips: [],
    trackCount: DEFAULT_TRACKS,
  }
}

/** Projects created before the Studio shipped have no `studio` key. */
export function studioOf(project: { studio?: StudioDoc } | null | undefined): StudioDoc {
  return project?.studio ?? emptyStudioDoc()
}

export function sizeForAspect(aspect: StudioAspect): [number, number] {
  if (aspect === '9:16') return [1080, 1920]
  if (aspect === '1:1') return [1080, 1080]
  return [1920, 1080]
}

/** Preview size keeps the export aspect but stays cheap to draw every frame. */
export function previewSizeForAspect(aspect: StudioAspect): [number, number] {
  const [w, h] = sizeForAspect(aspect)
  const scale = 720 / Math.max(w, h)
  return [Math.round(w * scale), Math.round(h * scale)]
}

export function clipEnd(clip: StudioClip): number {
  return clip.startSec + clip.durationSec
}

export function docDuration(doc: StudioDoc): number {
  return doc.clips.reduce((max, clip) => Math.max(max, clipEnd(clip)), 0)
}

/** Clips visible at time t, bottom track first (draw order). */
export function clipsAt(doc: StudioDoc, t: number): StudioClip[] {
  return doc.clips
    .filter((clip) => t >= clip.startSec && t < clipEnd(clip))
    .sort((a, b) => a.track - b.track || a.startSec - b.startSec)
}

/** 0→1 progress through a clip, used by every animation. */
export function clipProgress(clip: StudioClip, t: number): number {
  if (clip.durationSec <= 0) return 0
  return clamp((t - clip.startSec) / clip.durationSec, 0, 1)
}

/** Source time inside a media file for a given timeline time. */
export function sourceTimeFor(clip: StudioMediaClip | StudioAudioClip, t: number): number {
  const local = Math.max(0, t - clip.startSec)
  // Audio clips have no speed control (pitch-shifting music is never what the
  // user meant), so they always play at 1×.
  const speed = 'speed' in clip && clip.speed > 0 ? clip.speed : 1
  const raw = clip.trimInSec + local * speed
  if (clip.sourceDurationSec > 0) return Math.min(raw, Math.max(0, clip.sourceDurationSec - 0.001))
  return raw
}

/**
 * First slot on `track` at or after `from` with room for `needSec` seconds.
 * Gaps are reused when they are big enough; otherwise the clip lands after the
 * last one, so importing media never silently stacks two clips on one track.
 */
export function nextFreeStart(doc: StudioDoc, track: number, from = 0, needSec = 0): number {
  const onTrack = doc.clips.filter((c) => c.track === track).sort((a, b) => a.startSec - b.startSec)
  let cursor = from
  for (const clip of onTrack) {
    if (clipEnd(clip) <= cursor) continue
    const gap = clip.startSec - cursor
    if (gap >= needSec && gap > 0) break
    cursor = clipEnd(clip)
  }
  return Math.round(cursor * 100) / 100
}

/**
 * Split a clip at absolute time t. Returns the replacement clips, or null when
 * the cut falls outside the clip (nothing to split).
 */
export function splitClipAt(clip: StudioClip, t: number): [StudioClip, StudioClip] | null {
  const offset = t - clip.startSec
  if (offset <= MIN_CLIP_SEC || offset >= clip.durationSec - MIN_CLIP_SEC) return null

  const left: StudioClip = { ...clip, durationSec: offset }
  const right: StudioClip = {
    ...clip,
    id: uid(),
    startSec: clip.startSec + offset,
    durationSec: clip.durationSec - offset,
    transitionIn: 'none',
  }
  left.transitionOut = 'none'

  if (right.kind === 'video' || right.kind === 'audio') {
    // Audio has no speed control, so it always advances 1:1 with the timeline.
    const speed = right.kind === 'video' && right.speed > 0 ? right.speed : 1
    ;(right as StudioMediaClip).trimInSec = (clip as StudioMediaClip).trimInSec + offset * speed
  }
  return [left, right]
}

/**
 * Gain for an audio clip at absolute time t: master volume shaped by its fades.
 * One function, used by the preview and by the exporter, so what you hear while
 * editing is what lands in the file.
 */
export function audioGainAt(clip: StudioAudioClip, t: number): number {
  if (t < clip.startSec || t >= clipEnd(clip)) return 0
  const into = t - clip.startSec
  const left = clipEnd(clip) - t
  const fadeIn = clip.fadeInSec > 0 ? clamp(into / clip.fadeInSec, 0, 1) : 1
  const fadeOut = clip.fadeOutSec > 0 ? clamp(left / clip.fadeOutSec, 0, 1) : 1
  return clamp(clip.volume, 0, 1) * fadeIn * fadeOut
}

export function defaultAudioClip(
  start: number,
  track: number,
  media: { id: string; fileName: string; localPath: string | null; durationSec: number },
): StudioAudioClip {
  const durationSec = Math.max(MIN_CLIP_SEC, media.durationSec || 8)
  return {
    id: uid(),
    kind: 'audio',
    track,
    startSec: start,
    durationSec,
    name: media.fileName.replace(/\.[^.]+$/, '').slice(0, 28) || 'Audio',
    transitionIn: 'none',
    transitionOut: 'none',
    opacity: 1,
    mediaId: media.id,
    fileName: media.fileName,
    localPath: media.localPath,
    trimInSec: 0,
    sourceDurationSec: media.durationSec,
    volume: 0.8,
    fadeInSec: 0.5,
    fadeOutSec: 1,
  }
}

export function defaultTextClip(start: number, track: number): StudioTextClip {
  return {
    id: uid(),
    kind: 'text',
    track,
    startSec: start,
    durationSec: 3,
    name: 'Text',
    transitionIn: 'none',
    transitionOut: 'none',
    opacity: 1,
    text: 'Your headline',
    fontSizePct: 9,
    color: '#F4F1EA',
    weight: 800,
    align: 'center',
    x: 0.5,
    y: 0.5,
    anim: 'fade-up',
    captionStyle: null,
    highlightWord: null,
  }
}

export function defaultStickerClip(start: number, track: number, stickerId = 'pulse-ring'): StudioStickerClip {
  return {
    id: uid(),
    kind: 'sticker',
    track,
    startSec: start,
    durationSec: 2,
    name: 'Sticker',
    transitionIn: 'none',
    transitionOut: 'none',
    opacity: 1,
    stickerId,
    json: null,
    x: 0.5,
    y: 0.5,
    scale: 1,
    loop: true,
    speed: 1,
  }
}

export function defaultGlassClip(
  start: number,
  track: number,
  presetId = 'hero',
  shape: 'panel' | 'lens' = 'panel',
): StudioGlassClip {
  return {
    id: uid(),
    kind: 'glass',
    track,
    startSec: start,
    durationSec: 3,
    name: shape === 'lens' ? 'Glass lens' : 'Glass panel',
    transitionIn: 'fade',
    transitionOut: 'fade',
    opacity: 1,
    presetId,
    shape,
    x: 0.5,
    y: 0.5,
    w: shape === 'lens' ? 0.26 : 0.56,
    h: shape === 'lens' ? 0.26 : 0.3,
    radiusPct: shape === 'lens' ? 50 : 22,
    motion: shape === 'lens' ? 'drift' : 'sweep',
    label: '',
    labelColor: '#F4F1EA',
  }
}

/** Keep clips inside the document: no negative starts, no sub-frame durations. */
export function normaliseClip(clip: StudioClip, trackCount: number): StudioClip {
  return {
    ...clip,
    track: clamp(Math.round(clip.track), 0, Math.max(0, trackCount - 1)),
    startSec: Math.max(0, Math.round(clip.startSec * 100) / 100),
    durationSec: Math.max(MIN_CLIP_SEC, Math.round(clip.durationSec * 100) / 100),
    opacity: clamp(clip.opacity ?? 1, 0, 1),
  }
}

/**
 * Swap two track layers without changing clip timing. Track numbers are the
 * compositing z-order (0 is the bottom), so this one pure operation is shared
 * by preview and export and can be recorded as one undo step.
 */
export function reorderTracks(doc: StudioDoc, from: number, to: number): StudioDoc {
  const a = clamp(Math.round(from), 0, Math.max(0, doc.trackCount - 1))
  const b = clamp(Math.round(to), 0, Math.max(0, doc.trackCount - 1))
  if (a === b) return doc
  return {
    ...doc,
    clips: doc.clips.map((clip) =>
      clip.track === a ? { ...clip, track: b } : clip.track === b ? { ...clip, track: a } : clip,
    ),
  }
}

/** Snap a time to clip edges and the playhead when within `tolerance`. */
export function snapTime(doc: StudioDoc, time: number, ignoreId: string, extra: number[], tolerance: number): number {
  const candidates = [0, ...extra]
  for (const clip of doc.clips) {
    if (clip.id === ignoreId) continue
    candidates.push(clip.startSec, clipEnd(clip))
  }
  let best = time
  let bestDelta = tolerance
  for (const candidate of candidates) {
    const delta = Math.abs(candidate - time)
    if (delta < bestDelta) {
      best = candidate
      bestDelta = delta
    }
  }
  return Math.max(0, Math.round(best * 100) / 100)
}
