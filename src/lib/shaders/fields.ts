/**
 * Shader field math — the pure half of NewBrand's own shader kit.
 *
 * Why this exists: the Lab's 18 `fc-shader-*` components used to render through
 * `@paper-design/shaders-react`, which is licensed PolyForm Shield 1.0.0 — a
 * licence that restricts commercial use and redistribution. Phase 5
 * (`docs/PHASE1_LICENSING.md`) replaced that dependency with these functions
 * rather than shipping the restriction.
 *
 * Everything here is a pure function of its arguments: no clock, no random
 * source, no canvas. `src/tests/shaders.test.ts` and
 * `scripts/check-shaders.mjs` call them directly and assert determinism, motion
 * and non-uniformity for every effect, which is what stops an effect from
 * quietly becoming a flat fill.
 *
 * Coordinates: `u`, `v` are 0–1 across the frame; `t` is seconds.
 */


export type Rgb = [number, number, number]

/** sRGB hex or `rgb()`/`rgba()` → 0–255 components. Unknown strings → black. */
export function toRgb(color: string | undefined): Rgb {
  const value = String(color ?? '').trim()
  if (value.startsWith('#')) {
    let hex = value.slice(1)
    if (hex.length === 3 || hex.length === 4) hex = hex.split('').map((c) => c + c).join('')
    const int = Number.parseInt(hex.slice(0, 6), 16)
    if (Number.isFinite(int)) return [(int >> 16) & 255, (int >> 8) & 255, int & 255]
    return [0, 0, 0]
  }
  const match = /rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/i.exec(value)
  if (match) return [Number(match[1]), Number(match[2]), Number(match[3])]
  return [0, 0, 0]
}

export function mixRgb(a: Rgb, b: Rgb, k: number): Rgb {
  const amount = k < 0 ? 0 : k > 1 ? 1 : k
  return [a[0] + (b[0] - a[0]) * amount, a[1] + (b[1] - a[1]) * amount, a[2] + (b[2] - a[2]) * amount]
}

export function scaleRgb(color: Rgb, k: number): Rgb {
  return [color[0] * k, color[1] * k, color[2] * k]
}

export function addRgb(a: Rgb, b: Rgb): Rgb {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
}

export const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x)
export const clamp255 = (x: number) => (x < 0 ? 0 : x > 255 ? 255 : x)
export const smoothstep = (edge0: number, edge1: number, x: number) => {
  const span = edge1 - edge0 || 1e-6
  const k = clamp01((x - edge0) / span)
  return k * k * (3 - 2 * k)
}

/** A palette that always answers: empty input → the given fallback. */
export function paletteOf(colors: unknown, fallback: Rgb[]): Rgb[] {
  const list = Array.isArray(colors) ? colors.filter((c): c is string => typeof c === 'string' && c.trim().length > 0) : []
  const parsed = list.map(toRgb)
  return parsed.length ? parsed : fallback
}

/** Position on a colour ramp, wrapping so `k > 1` and `k < 0` still answer. */
export function ramp(colors: Rgb[], k: number): Rgb {
  if (colors.length === 0) return [0, 0, 0]
  if (colors.length === 1) return colors[0]
  const wrapped = k - Math.floor(k)
  const scaled = wrapped * (colors.length - 1)
  const index = Math.floor(scaled)
  const next = Math.min(colors.length - 1, index + 1)
  return mixRgb(colors[index], colors[next], scaled - index)
}

/**
 * Posterised ramp: `steps` bands including both ends.
 *
 * `ramp` wraps at 1 (which is what a circular effect wants), so the top band is
 * asked for slightly below the wrap point — otherwise the brightest band of a
 * stepped palette would resolve back to the first colour. Caught by
 * `src/tests/shaders.test.ts`.
 */
export function rampStepped(colors: Rgb[], k: number, steps: number): Rgb {
  const bands = Math.max(2, Math.round(steps) || 2)
  const band = Math.min(1, Math.max(0, Math.round(clamp01(k) * (bands - 1)) / (bands - 1)))
  return ramp(colors, band >= 1 ? 0.999 : band)
}

/**
 * Aspect-corrected centred coordinates: x and y are roughly -0.5…0.5 (the
 * longer axis can exceed that, which is what keeps circles round).
 */
export function centred(u: number, v: number, aspect: number): [number, number] {
  return [(u - 0.5) * aspect, v - 0.5]
}

/* ── noise ──────────────────────────────────────────────────────────────── */

/**
 * Integer hash → 0–1.
 *
 * The shared `noise3` in `src/core/math.ts` hashes with `Math.sin`, which is
 * fine for a handful of samples and far too slow for a shader that evaluates
 * noise once or twice per pixel over a whole frame (measured: 55 ms/frame for
 * the kit's 18 effects at 240×135, versus 6 ms with this hash). Bit-mixing with
 * `Math.imul` gives the same kind of value noise for a fraction of the cost.
 */
function hash3(x: number, y: number, z: number, seed: number): number {
  let h = Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1) ^ Math.imul(z | 0, 0x9e3779b1) ^ Math.imul(seed | 0, 0x85ebca6b)
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d)
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39)
  h ^= h >>> 15
  return (h >>> 0) / 4294967296
}

/** 0–1 trilinear value noise. */
export function noise01(x: number, y: number, z: number, seed = 0): number {
  const xi = Math.floor(x)
  const yi = Math.floor(y)
  const zi = Math.floor(z)
  const xf = x - xi
  const yf = y - yi
  const zf = z - zi
  const u = xf * xf * (3 - 2 * xf)
  const v = yf * yf * (3 - 2 * yf)
  const w = zf * zf * (3 - 2 * zf)
  const x00 = hash3(xi, yi, zi, seed) + (hash3(xi + 1, yi, zi, seed) - hash3(xi, yi, zi, seed)) * u
  const x10 = hash3(xi, yi + 1, zi, seed) + (hash3(xi + 1, yi + 1, zi, seed) - hash3(xi, yi + 1, zi, seed)) * u
  const x01 = hash3(xi, yi, zi + 1, seed) + (hash3(xi + 1, yi, zi + 1, seed) - hash3(xi, yi, zi + 1, seed)) * u
  const x11 = hash3(xi, yi + 1, zi + 1, seed) + (hash3(xi + 1, yi + 1, zi + 1, seed) - hash3(xi, yi + 1, zi + 1, seed)) * u
  const y0 = x00 + (x10 - x00) * v
  const y1 = x01 + (x11 - x01) * v
  return y0 + (y1 - y0) * w
}

/** 0–1 fractal noise (four octaves by default). */
export function fbm01(x: number, y: number, z: number, octaves = 4, seed = 0): number {
  let frequency = 1
  let amplitude = 0.5
  let sum = 0
  let norm = 0
  for (let i = 0; i < octaves; i++) {
    sum += amplitude * noise01(x * frequency, y * frequency, z * frequency, seed + i * 17)
    norm += amplitude
    frequency *= 2
    amplitude *= 0.5
  }
  return clamp01(sum / norm)
}

/** Two-octave billow used by the smoke and water looks. */
export function billow(x: number, y: number, z: number, seed = 0): number {
  const a = Math.abs(noise01(x, y, z, seed) * 2 - 1)
  const b = Math.abs(noise01(x * 2.1 + 5.2, y * 2.1 - 1.7, z * 1.7, seed + 3) * 2 - 1) * 0.5
  return clamp01(a + b)
}

/* ── domain warping ─────────────────────────────────────────────────────── */

/** Push a point around with noise, the way the swirl/warp shaders do. */
export function warpPoint(x: number, y: number, t: number, amount: number, seed = 0): [number, number] {
  if (amount <= 0) return [x, y]
  const dx = noise01(x * 1.7 + t * 0.3, y * 1.7, t * 0.2, seed) * 2 - 1
  const dy = noise01(x * 1.7, y * 1.7 + t * 0.3, t * 0.2, seed + 9) * 2 - 1
  return [x + dx * amount, y + dy * amount]
}

/* ── features ───────────────────────────────────────────────────────────── */

/** Nearest and second-nearest cell distances, plus a stable per-cell id. */
export function voronoi(x: number, y: number, cells: number, jitter = 0.85, seed = 0): { f1: number; f2: number; id: number } {
  const gx = Math.floor(x * cells)
  const gy = Math.floor(y * cells)
  let f1 = Infinity
  let f2 = Infinity
  let id = 0
  for (let oy = -1; oy <= 1; oy++) {
    for (let ox = -1; ox <= 1; ox++) {
      const cx = gx + ox
      const cy = gy + oy
      // Deterministic per-cell jitter: a hash of the cell indices.
      const hx = noise01(cx, cy, 0, seed + 1)
      const hy = noise01(cx, cy, 0, seed + 2)
      const px = (cx + 0.5 + (hx - 0.5) * jitter) / cells
      const py = (cy + 0.5 + (hy - 0.5) * jitter) / cells
      const d = Math.hypot(x - px, y - py)
      if (d < f1) {
        f2 = f1
        f1 = d
        id = (Math.abs(cx) * 73856093) ^ (Math.abs(cy) * 19349663)
      } else if (d < f2) {
        f2 = d
      }
    }
  }
  return { f1, f2, id }
}

/** Sum of `count` moving metaball influences at a point. */
export function metaballField(x: number, y: number, t: number, count: number, radius: number): number {
  const balls = Math.max(1, Math.min(12, Math.round(count) || 1))
  let sum = 0
  for (let i = 0; i < balls; i++) {
    const phase = (i / balls) * Math.PI * 2
    const speed = 0.25 + (i % 3) * 0.09
    const cx = Math.cos(t * speed + phase) * 0.3
    const cy = Math.sin(t * speed * 0.8 + phase * 1.7) * 0.3
    const d2 = (x - cx) * (x - cx) + (y - cy) * (y - cy) + 1e-4
    sum += (radius * radius) / d2
  }
  return sum
}

/** One orbit dot: centre and radius of the i-th dot at time t. */
export function orbitDot(index: number, count: number, spreading: number, t: number): [number, number] {
  const total = Math.max(1, Math.round(count) || 1)
  const spread = clamp01(spreading === undefined ? 0.6 : spreading)
  const lane = index / total
  const angle = t * (0.4 + lane * 0.5) + lane * Math.PI * 2
  const radius = 0.08 + lane * 0.34 * (0.4 + spread)
  return [Math.cos(angle) * radius, Math.sin(angle) * radius * 0.85]
}
