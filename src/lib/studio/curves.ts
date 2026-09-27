/**
 * 2.2 — cubic-bezier easing for the keyframe curve editor. Same maths as CSS
 * `cubic-bezier()`: x is time, y is progress; y may overshoot (−1…2) for
 * anticipation and spring-like moves. Pure and deterministic.
 */
export type Bezier = [number, number, number, number]

export const CURVE_PRESETS: Array<{ id: string; label: string; bezier: Bezier }> = [
  { id: 'smooth', label: 'Smooth', bezier: [0.45, 0, 0.55, 1] },
  { id: 'snappy', label: 'Snappy', bezier: [0.2, 0.9, 0.1, 1] },
  { id: 'anticipate', label: 'Anticipate', bezier: [0.6, -0.4, 0.4, 1] },
  { id: 'overshoot', label: 'Overshoot', bezier: [0.3, 1.5, 0.6, 1] },
  { id: 'slow-in', label: 'Slow in', bezier: [0.7, 0, 1, 1] },
]

export function clampBezier(b: Bezier): Bezier {
  const c = (v: number, lo: number, hi: number) => (Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : 0)
  return [c(b[0], 0, 1), c(b[1], -1, 2), c(b[2], 0, 1), c(b[3], -1, 2)]
}

/** y at time x for a cubic bezier from (0,0) to (1,1). Newton + bisection fallback. */
export function bezierEase(b: Bezier, x: number): number {
  if (x <= 0) return 0
  if (x >= 1) return 1
  const [x1, y1, x2, y2] = clampBezier(b)
  const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx
  const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by
  const sx = (t: number) => ((ax * t + bx) * t + cx) * t
  const dx = (t: number) => (3 * ax * t + 2 * bx) * t + cx
  let t = x
  for (let i = 0; i < 8; i += 1) {
    const err = sx(t) - x
    if (Math.abs(err) < 1e-6) break
    const d = dx(t)
    if (Math.abs(d) < 1e-6) break
    t -= err / d
  }
  if (t < 0 || t > 1 || Math.abs(sx(t) - x) > 1e-4) {
    let lo = 0, hi = 1
    t = x
    for (let i = 0; i < 40; i += 1) {
      const v = sx(t)
      if (Math.abs(v - x) < 1e-6) break
      if (v < x) lo = t
      else hi = t
      t = (lo + hi) / 2
    }
  }
  return ((ay * t + by) * t + cy) * t
}
