/**
 * Shot detection — where does the picture change?
 *
 * Breaking a clip apart on speech alone leaves footage without speech in one
 * piece: a montage cut to music, a screen recording, drone footage. This finds
 * the cuts the edit already has, by comparing sampled frames.
 *
 * Deliberately not a model: sample the clip a few times a second at thumbnail
 * size, measure the mean absolute luma difference between consecutive samples,
 * and call it a cut when a sample stands out from this clip's own distribution
 * of differences (median + k × MAD) and above a floor. That adaptivity is the
 * important part: a handheld shot has a high, noisy baseline and a locked-off
 * interview has almost none, so a fixed threshold would either shred the first
 * or miss every cut in the second.
 *
 * Everything except `analyseShots` is pure, so the detector is covered headlessly
 * by `scripts/check-decompose.mjs`.
 */
import type { StudioMediaClip } from '../../types/project'
import { getMedia, loadVideo, seekTo } from './media'

/** One sampled frame: its time in source seconds and its difference to the previous sample (0–1). */
export interface FrameSample {
  t: number
  diff: number
}

export interface ShotOptions {
  /** Samples per second of source footage. 4 finds real cuts; higher costs decodes. */
  fps?: number
  /** Two cuts closer together than this are one shot; the strongest wins. */
  minShotSec?: number
  /** Sensitivity multiplier on the adaptive threshold (higher = fewer, surer cuts). */
  sensitivity?: number
  /** Sample width in pixels; the frame is drawn at this width and its own aspect. */
  width?: number
}

export const SHOT_DEFAULTS = { fps: 4, minShotSec: 1.2, sensitivity: 5, width: 64 } as const

/** Below this the picture barely changed at all, whatever the clip's own spread says. */
export const SHOT_FLOOR = 0.06

/**
 * A change this large between two sampled frames is a hard cut in any footage,
 * so it is used as a fallback when the adaptive threshold finds nothing at all:
 * a very short clip (or a cut in every sample) can make the clip's own spread
 * look like the baseline, and reporting "no cuts" for an obvious montage would
 * be worse than reporting the biggest changes.
 */
export const SHOT_STRONG = 0.2

/**
 * Mean absolute luma difference between two RGBA frames, 0 (identical) – 1.
 * Luma (not raw RGB) because a cut is a change of picture, and a colour-fade is
 * not: `0.299/0.587/0.114` is the same weighting the renderer uses for contrast.
 */
export function frameDifference(a: Uint8ClampedArray, b: Uint8ClampedArray): number {
  const n = Math.min(a.length, b.length)
  if (!n) return 0
  let sum = 0
  let counted = 0
  // Walk pixels; ignore a trailing partial pixel in a malformed buffer.
  for (let i = 0; i + 3 < n; i += 4) {
    const la = 0.299 * a[i] + 0.587 * a[i + 1] + 0.114 * a[i + 2]
    const lb = 0.299 * b[i] + 0.587 * b[i + 1] + 0.114 * b[i + 2]
    sum += Math.abs(la - lb)
    counted += 1
  }
  return counted ? sum / counted / 255 : 0
}

/** Median of a numeric list (0 for an empty one). */
export function median(values: number[]): number {
  if (!values.length) return 0
  const sorted = [...values].sort((x, y) => x - y)
  const mid = sorted.length >> 1
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

/**
 * The cut times (source seconds) in a clip's own differences.
 *
 * `minShotSec` is enforced on the *result*, not the input: a fast-cut montage
 * sampled at 4 fps still yields its strongest cuts rather than every sample.
 */
export function shotCutTimes(samples: FrameSample[], opts: ShotOptions = {}): number[] {
  const minShotSec = Math.max(0.2, opts.minShotSec ?? SHOT_DEFAULTS.minShotSec)
  const sensitivity = Math.max(1, opts.sensitivity ?? SHOT_DEFAULTS.sensitivity)
  const diffs = samples.map((s) => s.diff)
  if (diffs.length < 2) return []
  const centre = median(diffs)
  const mad = median(diffs.map((d) => Math.abs(d - centre)))
  const threshold = Math.max(SHOT_FLOOR, centre + sensitivity * mad)
  // A cut is a spike: the samples either side of it must not reach as high.
  const peaks: Array<{ t: number; diff: number }> = []
  for (let i = 0; i < samples.length; i += 1) {
    const d = samples[i].diff
    const before = i > 0 ? samples[i - 1].diff : -1
    const after = i + 1 < samples.length ? samples[i + 1].diff : -1
    if (d < before || d < after) continue
    peaks.push({ t: samples[i].t, diff: d })
  }
  let spikes = peaks.filter((p) => p.diff >= threshold)
  if (!spikes.length) spikes = peaks.filter((p) => p.diff >= SHOT_STRONG)
  spikes.sort((a, b) => a.t - b.t)
  const kept: Array<{ t: number; diff: number }> = []
  for (const spike of spikes) {
    const last = kept[kept.length - 1]
    if (last && spike.t - last.t < minShotSec) {
      // Too close together to be two shots: keep whichever change is stronger.
      if (spike.diff > last.diff) kept[kept.length - 1] = spike
      continue
    }
    kept.push(spike)
  }
  return kept.map((s) => s.t)
}

/**
 * Map a source-second time onto the timeline a set of cut ranges would leave
 * behind — the arithmetic `tightenClip` applies to every other clip, exposed so
 * a caller can place boundaries it worked out *before* the cuts were made.
 * A time inside a removed range lands on the start of that range (where the
 * material that used to be there now begins); a time before any cut is unchanged.
 */
export function remapSourceTime(
  sourceSec: number,
  clip: Pick<StudioMediaClip, 'startSec' | 'durationSec' | 'trimInSec' | 'speed'>,
  cuts: Array<[number, number]>,
): number {
  const speed = clip.speed > 0 ? clip.speed : 1
  const rangeEnd = clip.trimInSec + clip.durationSec * speed
  const s = Math.min(rangeEnd, Math.max(clip.trimInSec, sourceSec))
  const inside = cuts.find(([a, b]) => s > a && s < b)
  const kept = inside ? inside[0] : s
  const removed = cuts.reduce((acc, [a, b]) => acc + Math.max(0, Math.min(kept, b) - a), 0)
  return clip.startSec + Math.max(0, kept - clip.trimInSec - removed) / speed
}

/**
 * Sample the clip's own frames and find its cuts. Needs the file on this machine
 * (a browser decode), exactly like `analyseSubject`; a clip that cannot be read
 * throws with a readable reason rather than returning no cuts.
 */
export async function analyseShots(
  clip: StudioMediaClip,
  onProgress?: (pct: number) => void,
  opts: ShotOptions = {},
): Promise<{ shots: number[]; samples: FrameSample[]; srcW: number; srcH: number }> {
  const handle = getMedia(clip.mediaId)
  if (!handle || handle.kind !== 'video') throw new Error('The video file is not loaded — relink it first.')
  const fps = Math.max(1, Math.min(12, opts.fps ?? SHOT_DEFAULTS.fps))
  const W = Math.max(16, Math.min(160, opts.width ?? SHOT_DEFAULTS.width))
  const video = await loadVideo(handle.url)
  const H = Math.max(9, Math.round((W * (video.videoHeight || handle.height || 9)) / Math.max(1, video.videoWidth || handle.width || 16)))
  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('Canvas is unavailable.')
  const speed = clip.kind === 'video' && clip.speed > 0 ? clip.speed : 1
  const from = clip.trimInSec
  const to = Math.min(video.duration || from + clip.durationSec * speed, from + clip.durationSec * speed)
  const steps = Math.max(1, Math.ceil((to - from) * fps))
  const samples: FrameSample[] = []
  let prev: Uint8ClampedArray | null = null
  for (let i = 0; i <= steps; i += 1) {
    const t = from + ((to - from) * i) / steps
    await seekTo(video, Math.min(t, Math.max(0, (video.duration || t) - 0.05)))
    ctx.drawImage(video, 0, 0, W, H)
    const px = ctx.getImageData(0, 0, W, H).data
    samples.push({ t, diff: prev ? frameDifference(prev, px) : 0 })
    prev = px
    onProgress?.(Math.round((i / steps) * 100))
  }
  video.removeAttribute('src')
  video.load()
  return { shots: shotCutTimes(samples, opts), samples, srcW: handle.width, srcH: handle.height }
}
