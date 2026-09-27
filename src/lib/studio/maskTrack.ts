/**
 * Object-tracked masks.
 *
 * Pure tracker: given greyscale frames and the mask's starting box, follow
 * that patch frame-to-frame with zero-mean block matching (brightness
 * changes don't break it), a small scale search (subject moving toward/away
 * from camera), and a slowly refreshed template (appearance drift without
 * sliding onto the background). When the match gets poor the box holds its
 * last good position and the point is flagged, rather than wandering.
 *
 * Output is a list of clip-local points the renderer interpolates
 * (`trackedMask`), so preview and export follow the same path.
 */
import type { StudioMask, StudioMaskTrackPoint, StudioMediaClip } from '../../types/project'

export type LumaFrame = { t: number; w: number; h: number; data: Uint8Array | Uint8ClampedArray | Float32Array }
export type Box = { x: number; y: number; w: number; h: number } // normalised, top-left

const GRID = 20 // template samples per side

function samplePatch(f: LumaFrame, cx: number, cy: number, bw: number, bh: number, out: Float32Array): number {
  // Bilinear samples of the box (pixel coords), zero-mean; returns energy.
  let sum = 0
  for (let j = 0; j < GRID; j += 1) {
    const y = cy - bh / 2 + ((j + 0.5) * bh) / GRID
    for (let i = 0; i < GRID; i += 1) {
      const x = cx - bw / 2 + ((i + 0.5) * bw) / GRID
      const x0 = Math.max(0, Math.min(f.w - 1, Math.floor(x))), y0 = Math.max(0, Math.min(f.h - 1, Math.floor(y)))
      const x1 = Math.min(f.w - 1, x0 + 1), y1 = Math.min(f.h - 1, y0 + 1)
      const fx = Math.max(0, Math.min(1, x - x0)), fy = Math.max(0, Math.min(1, y - y0))
      const a = f.data[y0 * f.w + x0], b = f.data[y0 * f.w + x1], c = f.data[y1 * f.w + x0], d = f.data[y1 * f.w + x1]
      const v = (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy
      out[j * GRID + i] = v
      sum += v
    }
  }
  const mean = sum / (GRID * GRID)
  let energy = 0
  for (let k = 0; k < out.length; k += 1) { out[k] -= mean; energy += out[k] * out[k] }
  return energy
}

/** Normalised cross-correlation of two zero-mean patches (−1..1). */
function ncc(a: Float32Array, ea: number, b: Float32Array, eb: number): number {
  if (ea < 1e-6 || eb < 1e-6) return 0
  let dot = 0
  for (let k = 0; k < a.length; k += 1) dot += a[k] * b[k]
  return dot / Math.sqrt(ea * eb)
}

export type TrackOptions = { searchPct?: number; scales?: number[]; minConfidence?: number; adapt?: number }

/** Track `box` (normalised) through `frames`. Returns centre/size per frame with confidence. */
export function trackBox(frames: LumaFrame[], box: Box, opts: TrackOptions = {}): StudioMaskTrackPoint[] {
  if (!frames.length) return []
  const search = opts.searchPct ?? 0.12
  const scales = opts.scales ?? [0.94, 1, 1.06]
  const minConf = opts.minConfidence ?? 0.35
  const adapt = opts.adapt ?? 0.12
  const f0 = frames[0]
  let cx = (box.x + box.w / 2) * f0.w, cy = (box.y + box.h / 2) * f0.h
  let bw = Math.max(4, box.w * f0.w), bh = Math.max(4, box.h * f0.h)
  const tmpl = new Float32Array(GRID * GRID)
  const cand = new Float32Array(GRID * GRID)
  let eT = samplePatch(f0, cx, cy, bw, bh, tmpl)
  const out: StudioMaskTrackPoint[] = [{ at: f0.t, x: cx / f0.w, y: cy / f0.h, w: bw / f0.w, h: bh / f0.h, confidence: 1 }]
  let vx = 0, vy = 0
  let avg = 0.9 // running mean of good match scores

  for (let n = 1; n < frames.length; n += 1) {
    const f = frames[n]
    const r = Math.max(3, search * Math.max(f.w, f.h))
    // Predict with the last velocity, then coarse → fine search around it.
    const px = cx + vx, py = cy + vy
    let best = { s: -2, x: px, y: py, k: 1 }
    const tryAt = (x: number, y: number, k: number) => {
      const e = samplePatch(f, x, y, bw * k, bh * k, cand)
      const s = ncc(tmpl, eT, cand, e) - Math.abs(k - 1) * 0.02 // mild preference for no scale change
      if (s > best.s) best = { s, x, y, k }
    }
    const coarse = Math.max(1, r / 6)
    for (let dy = -r; dy <= r; dy += coarse) for (let dx = -r; dx <= r; dx += coarse) tryAt(px + dx, py + dy, 1)
    for (let step = coarse / 2; step >= 0.5; step /= 2) {
      const bx = best.x, by = best.y
      for (let dy = -1; dy <= 1; dy += 1) for (let dx = -1; dx <= 1; dx += 1) if (dx || dy) tryAt(bx + dx * step, by + dy * step, 1)
    }
    for (const k of scales) if (k !== 1) tryAt(best.x, best.y, k)
    const conf = Math.max(0, best.s)
    // Lost = absolutely poor OR a sharp drop versus how well it usually matches.
    const good = conf >= minConf && conf >= avg * 0.7
    if (good) avg = avg * 0.8 + conf * 0.2
    if (good) {
      vx = (best.x - cx) * 0.6 + vx * 0.4
      vy = (best.y - cy) * 0.6 + vy * 0.4
      cx = best.x; cy = best.y; bw *= best.k; bh *= best.k
      // Refresh the template slowly so appearance changes are absorbed.
      const e = samplePatch(f, cx, cy, bw, bh, cand)
      if (e > 1e-6) {
        let energy = 0
        for (let k = 0; k < tmpl.length; k += 1) { tmpl[k] = tmpl[k] * (1 - adapt) + cand[k] * adapt; energy += tmpl[k] * tmpl[k] }
        eT = energy
      }
    } else {
      vx *= 0.5; vy *= 0.5 // lost: hold, don't drift
    }
    out.push({ at: f.t, x: cx / f.w, y: cy / f.h, w: bw / f.w, h: bh / f.h, confidence: good ? Math.round(conf * 100) / 100 : Math.min(0.34, Math.round(conf * 100) / 100) })
  }
  return out
}

/** Drop points a straight line between neighbours already explains (keeps the path editable). */
export function simplifyTrack(points: StudioMaskTrackPoint[], tol = 0.003): StudioMaskTrackPoint[] {
  if (points.length <= 2) return points
  const keep = [points[0]]
  for (let i = 1; i < points.length - 1; i += 1) {
    const a = keep[keep.length - 1], b = points[i + 1], p = points[i]
    const u = b.at > a.at ? (p.at - a.at) / (b.at - a.at) : 0
    const err = Math.max(Math.abs(a.x + (b.x - a.x) * u - p.x), Math.abs(a.y + (b.y - a.y) * u - p.y), Math.abs((a.w ?? 0) + ((b.w ?? 0) - (a.w ?? 0)) * u - (p.w ?? 0)))
    if (err > tol || (p.confidence ?? 1) < 0.35) keep.push(p)
  }
  keep.push(points[points.length - 1])
  return keep
}

/**
 * Where a media clip's source pixels land in the frame (normalised), so the
 * mask box (frame space) and the tracker (source space) agree.
 */
export function sourceFrameMap(clip: Pick<StudioMediaClip, 'fit' | 'x' | 'y' | 'scale'>, srcW: number, srcH: number, frameW: number, frameH: number) {
  const srcA = srcW / Math.max(1, srcH), frA = frameW / Math.max(1, frameH)
  const s = clip.scale ?? 1
  // Displayed size in frame-normalised units.
  let dw: number, dh: number
  if ((clip.fit === 'cover') === (srcA > frA)) { dh = 1; dw = srcA / frA } else { dw = 1; dh = frA / srcA }
  dw *= s; dh *= s
  const ox = (clip.x ?? 0.5) - dw / 2, oy = (clip.y ?? 0.5) - dh / 2
  return {
    toFrame: (p: { x: number; y: number; w?: number; h?: number }) => ({ x: ox + p.x * dw, y: oy + p.y * dh, w: p.w !== undefined ? p.w * dw : undefined, h: p.h !== undefined ? p.h * dh : undefined }),
    toSource: (b: Box): Box => ({ x: (b.x - ox) / dw, y: (b.y - oy) / dh, w: b.w / dw, h: b.h / dh }),
  }
}

/** Build the tracked mask from a finished track (source space → frame space, clip-local times). */
export function applyTrack(mask: StudioMask, points: StudioMaskTrackPoint[], map: ReturnType<typeof sourceFrameMap>, trimInSec: number, speed: number): StudioMask {
  const track = simplifyTrack(points).map((p) => {
    const f = map.toFrame(p)
    const r = (v: number) => Math.round(v * 10000) / 10000
    return { at: r(Math.max(0, (p.at - trimInSec) / (speed || 1))), x: r(f.x), y: r(f.y), w: f.w !== undefined ? r(f.w) : undefined, h: f.h !== undefined ? r(f.h) : undefined, confidence: p.confidence }
  })
  return { ...mask, track }
}

export function trackSummary(points: StudioMaskTrackPoint[]): string {
  const lost = points.filter((p) => (p.confidence ?? 1) < 0.35).length
  const span = points.length ? points[points.length - 1].at - points[0].at : 0
  return `Tracked ${points.length} frames over ${span.toFixed(1)}s${lost ? ` — lost the subject on ${lost} frame${lost === 1 ? '' : 's'} (held position; adjust the box and track again)` : ''}.`
}
