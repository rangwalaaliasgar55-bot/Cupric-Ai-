/**
 * NewBrand's shader renderer — 18 effects, drawn by our own code.
 *
 * The Lab's `fc-shader-*` components previously rendered through
 * `@paper-design/shaders-react` (PolyForm Shield 1.0.0, commercial-use
 * restricted). Phase 5 replaced that dependency with this module: the same 18
 * effects, implemented here as pure per-pixel functions.
 *
 * `renderShaderPixels` is deterministic — the same (kind, params, size) always
 * produces the same bytes — and returns RGBA data the React wrapper paints
 * straight onto a canvas. Because it needs no GPU and no DOM, every effect is
 * tested for being non-uniform, moving over time, responding to its colour
 * props, and differing from its neighbours (`src/tests/shaders.test.ts`,
 * `scripts/check-shaders.mjs`).
 *
 * Coordinates are 0–1 across the frame with `y` downward; `t` is seconds.
 */
import {
  addRgb,
  billow,
  centred,
  clamp01,
  clamp255,
  fbm01,
  metaballField,
  mixRgb,
  noise01,
  orbitDot,
  paletteOf,
  ramp,
  rampStepped,
  scaleRgb,
  smoothstep,
  toRgb,
  voronoi,
  warpPoint,
  type Rgb,
} from './fields'

/** The 18 effects the Lab exposes as `fc-shader-*` components. */
export const SHADER_KINDS = [
  'perlin-noise',
  'simplex-noise',
  'dithering',
  'dot-orbit',
  'god-rays',
  'grain-gradient',
  'liquid-metal',
  'mesh-gradient',
  'metaballs',
  'neuro-noise',
  'pulsing-border',
  'smoke-ring',
  'spiral',
  'swirl',
  'voronoi',
  'warp',
  'water',
  'color-panels',
] as const

export type ShaderKind = (typeof SHADER_KINDS)[number]

export type ShaderParams = {
  /** Seconds. Never read from a clock inside this module — the caller passes it. */
  time?: number
  colors?: string[]
  colorBack?: string
  colorFront?: string
  colorMid?: string
  colorTint?: string
  colorBloom?: string
  colorGap?: string
  colorHighlight?: string
  /** Effect-specific knobs; each effect reads only the ones it documents. */
  proportion?: number
  softness?: number
  density?: number
  size?: number
  radius?: number
  thickness?: number
  scale?: number
  intensity?: number
  noise?: number
  contrast?: number
  brightness?: number
  bloom?: number
  swirl?: number
  distortion?: number
  repetition?: number
  contour?: number
  count?: number
  roundness?: number
  spreading?: number
  bandCount?: number
  twist?: number
  stepsPerColor?: number
  gap?: number
  glow?: number
  strokeWidth?: number
  length?: number
  waves?: number
  highlights?: number
  caustic?: number
  shape?: string
  type?: string
}

/** What a sampler is allowed to read: its position, the clock, and the props. */
export type SampleContext = {
  t: number
  aspect: number
  params: ShaderParams
  /** The `colors` prop, or the effect's own default when none were given. */
  palette: (fallback: string[]) => Rgb[]
}

export type ShaderSample = (u: number, v: number, ctx: SampleContext) => Rgb

const num = (value: unknown, fallback: number) => (typeof value === 'number' && Number.isFinite(value) ? value : fallback)

/** 4×4 Bayer matrix, 0–15, used by the dithering effect. */
const BAYER4 = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
]

/**
 * One sampler per effect. Each returns the colour of a single pixel; the
 * renderer loops over pixels and writes RGBA.
 */
export const SHADER_SAMPLERS: Record<ShaderKind, ShaderSample> = {
  /** Vertical noise bands: the front colour fades in where the noise passes `proportion`. */
  'perlin-noise': (u, v, { t, aspect, params }) => {
    const [x, y] = centred(u, v, aspect)
    const back = toRgb(params.colorBack ?? '#12121a')
    const front = toRgb(params.colorFront ?? '#6a6a85')
    const n = noise01(x * 3.2, y * 3.2, t * 0.35)
    const p = num(params.proportion, 0.35)
    const soft = Math.max(0.02, num(params.softness, 0.1))
    const k = smoothstep(p - soft, p + soft, n)
    return mixRgb(back, front, k)
  },

  /** Posterised fractal noise: the palette is stepped, not blended. */
  'simplex-noise': (u, v, { t, aspect, params, palette }) => {
    const [x, y] = centred(u, v, aspect)
    const colors = palette(['#1b1b2f', '#3f3f6b', '#a9a9d4', '#f2f2ff'])
    const n = fbm01(x * 2.4, y * 2.4, t * 0.25, 5)
    const soft = num(params.softness, 0.5)
    const shaped = clamp01((n - 0.5) * (0.4 + soft) + 0.5)
    return rampStepped(colors, shaped, num(params.stepsPerColor, 4) + 1)
  },

  /** Ordered dithering of a moving gradient, banded at `size`. */
  dithering: (u, v, { t, params }) => {
    const back = toRgb(params.colorBack ?? '#0d0d12')
    const front = toRgb(params.colorFront ?? '#e8e8f0')
    const size = Math.max(1, Math.round(num(params.size, 4)))
    const cell = Math.floor((u * 96) / size)
    const row = Math.floor((v * 54) / size)
    const threshold = (BAYER4[row & 3][cell & 3] + 0.5) / 16
    // The gradient itself travels: dithering a moving image is what makes the
    // effect read as animated rather than as a static halftone.
    const gradient = clamp01(u * 0.6 + v * 0.4 - t * 0.22 + Math.sin(t * 0.4) * 0.06)
    const quantised = params.type === 'random'
      ? clamp01(Math.floor(gradient * 4) / 3 + (noise01(cell * 0.3, row * 0.3, t * 0.1) - 0.5) * 0.25)
      : gradient
    return quantised > threshold ? front : back
  },

  /** `count` soft dots orbiting the centre. */
  'dot-orbit': (u, v, { t, aspect, params, palette }) => {
    const [x, y] = centred(u, v, aspect)
    const back = toRgb(params.colorBack ?? '#0a0a12')
    const colors = palette(['#7dd3fc', '#f0abfc', '#fde68a'])
    const count = Math.max(1, Math.min(12, Math.round(num(params.count, 5))))
    const size = Math.max(0.004, num(params.size, 0.05))
    let color = back
    for (let i = 0; i < count; i++) {
      const [cx, cy] = orbitDot(i, count, num(params.spreading, 0.6), t * 0.6)
      const d = Math.hypot(x - cx, y - cy)
      const glow = 1 - smoothstep(size, size * 3.2, d)
      if (glow > 0) color = mixRgb(color, colors[i % colors.length], glow)
    }
    return color
  },

  /** Radial rays from the centre with a bloom tint. */
  'god-rays': (u, v, { t, aspect, params, palette }) => {
    const [x, y] = centred(u, v, aspect)
    const back = toRgb(params.colorBack ?? '#0b0b16')
    const bloomColor = toRgb(params.colorBloom ?? '#fef3c7')
    const colors = palette(['#fef3c7', '#fca5a5', '#c4b5fd'])
    const angle = Math.atan2(y, x)
    const dist = Math.hypot(x, y) + 1e-4
    const density = Math.max(1, num(params.density, 6))
    const turbulence = noise01(angle * 2.5, dist * 2.2, t * 0.3) * 0.5
    const rays = 0.5 + 0.5 * Math.sin(angle * density + turbulence * 3 + t * 0.5)
    const falloff = 1 / (1 + dist * dist * 6)
    const shaft = Math.pow(rays, 2.2) * falloff * (0.5 + num(params.intensity, 0.8))
    const core = Math.pow(Math.max(0, 0.16 - dist) / 0.16, 2) * num(params.bloom, 0.5)
    return addRgb(mixRgb(back, ramp(colors, rays), clamp01(shaft)), scaleRgb(bloomColor, core))
  },

  /** A gradient with film grain over it. */
  'grain-gradient': (u, v, { t, params, palette }) => {
    const back = toRgb(params.colorBack ?? '#0a0a12')
    const colors = palette(['#0a0a12', '#6d28d9', '#22d3ee'])
    const softness = num(params.softness, 0.5)
    const base = ramp(colors, clamp01(u * (0.4 + softness) + v * (0.6 - softness * 0.4)))
    const scale = Math.max(1, num(params.noise, 24))
    const grain = (noise01(u * scale, v * scale, t * 12) - 0.5) * 2
    const amount = num(params.intensity, 0.25) * 90
    const tinted = mixRgb(base, back, 0.12)
    return [clamp255(tinted[0] + grain * amount), clamp255(tinted[1] + grain * amount), clamp255(tinted[2] + grain * amount)]
  },

  /** Fractal contour bands over a metallic palette. */
  'liquid-metal': (u, v, { t, aspect, params }) => {
    const [x, y] = centred(u, v, aspect)
    const tint = toRgb(params.colorTint ?? '#cbd5f5')
    const back = toRgb(params.colorBack ?? '#05060a')
    const distortion = num(params.distortion, 0.5)
    const [wx, wy] = warpPoint(x * 2.4, y * 2.4, t * 0.3, distortion * 1.6)
    const field = fbm01(wx, wy, t * 0.25, 4)
    const repetition = Math.max(1, num(params.repetition, 6))
    const band = Math.abs(((field * repetition) % 1) - 0.5) * 2
    const contour = num(params.contour, 0.5)
    const lines = smoothstep(1 - contour * 0.6, 1, band)
    const softness = num(params.softness, 0.35)
    const shade = mixRgb(back, scaleRgb(tint, 0.35 + field * 0.9), clamp01(0.35 + field * softness + band * 0.4))
    return mixRgb(shade, scaleRgb(tint, 1.25), lines * 0.55)
  },

  /** Moving colour blobs blended by inverse distance. */
  'mesh-gradient': (u, v, { t, aspect, params, palette }) => {
    const [x, y] = centred(u, v, aspect)
    const colors = palette(['#f472b6', '#38bdf8', '#facc15', '#a78bfa', '#34d399'])
    const swirl = num(params.swirl, 0.5)
    const distortion = num(params.distortion, 0.3)
    const [wx, wy] = warpPoint(x, y, t * 0.2, distortion)
    const points = colors.length + 1
    let weightSum = 0
    const acc: Rgb = [0, 0, 0]
    for (let i = 0; i < points; i++) {
      const phase = (i / points) * Math.PI * 2
      const px = Math.cos(t * 0.25 + phase) * (0.34 + swirl * 0.06)
      const py = Math.sin(t * 0.21 + phase * 1.4) * 0.32
      const d = Math.hypot(wx - px, wy - py)
      const w = 1 / Math.pow(d + 0.06, 2.4)
      weightSum += w
      const color = colors[i % colors.length]
      acc[0] += color[0] * w
      acc[1] += color[1] * w
      acc[2] += color[2] * w
    }
    return [acc[0] / weightSum, acc[1] / weightSum, acc[2] / weightSum]
  },

  /** Fused metaballs, palette by field strength. */
  metaballs: (u, v, { t, aspect, params, palette }) => {
    const [x, y] = centred(u, v, aspect)
    const back = toRgb(params.colorBack ?? '#080810')
    const colors = palette(['#22d3ee', '#a855f7', '#f97316'])
    const field = metaballField(x, y, t * 0.5, num(params.count, 5), num(params.size, 0.22))
    const k = clamp01((field - 0.6) * 1.4)
    if (k <= 0.001) return back
    return mixRgb(back, ramp(colors, field * 0.35), k)
  },

  /** Three-colour noise with a contrast crush, the "neuro" look. */
  'neuro-noise': (u, v, { t, aspect, params }) => {
    const [x, y] = centred(u, v, aspect)
    const back = toRgb(params.colorBack ?? '#050510')
    const mid = toRgb(params.colorMid ?? '#3b82f6')
    const front = toRgb(params.colorFront ?? '#f8fafc')
    const n = fbm01(x * 3 + t * 0.15, y * 3 - t * 0.1, t * 0.2, 4)
    const contrast = Math.max(0.05, num(params.contrast, 0.9))
    const brightness = num(params.brightness, 0.5)
    const shaped = clamp01((n - brightness) * (1 + contrast * 3) + 0.5)
    return shaped < 0.5 ? mixRgb(back, mid, shaped * 2) : mixRgb(mid, front, (shaped - 0.5) * 2)
  },

  /** A rounded frame whose light travels around the perimeter and pulses. */
  'pulsing-border': (u, v, { t, aspect, params, palette }) => {
    const [x, y] = centred(u, v, aspect)
    const back = toRgb(params.colorBack ?? '#0a0a12')
    const colors = palette(['#22d3ee', '#8b5cf6', '#f472b6'])
    const roundness = num(params.roundness, 0.35)
    const thickness = Math.max(0.002, num(params.thickness, 0.06))
    // Rounded-rectangle signed distance in the same -0.5…0.5 space.
    const halfW = 0.45
    const halfH = 0.32
    const radius = roundness * Math.min(halfW, halfH)
    const qx = Math.abs(x) - (halfW - radius)
    const qy = Math.abs(y) - (halfH - radius)
    const outside = Math.hypot(Math.max(qx, 0), Math.max(qy, 0))
    const inside = Math.min(Math.max(qx, qy), 0)
    const distance = outside + inside - radius
    const band = 1 - smoothstep(thickness, thickness * 2.1, Math.abs(distance))
    const perimeter = Math.atan2(y / halfH, x / halfW) / (Math.PI * 2) + 0.5
    const intensity = num(params.intensity, 0.8)
    const pulse = 0.55 + 0.45 * Math.sin(t * 2.2)
    const travel = ramp(colors, perimeter * 2 - t * 0.18)
    const glow = (1 - smoothstep(0, thickness * 5, Math.abs(distance))) * num(params.bloom, 0.4)
    return addRgb(mixRgb(back, scaleRgb(travel, 1.1), clamp01(band * intensity * pulse)), scaleRgb(travel, glow * 0.35))
  },

  /** A turbulent ring of smoke around a radius. */
  'smoke-ring': (u, v, { t, aspect, params, palette }) => {
    const [x, y] = centred(u, v, aspect)
    const back = toRgb(params.colorBack ?? '#050508')
    const colors = palette(['#1f2937', '#6b7280', '#e5e7eb'])
    const radius = num(params.radius, 0.28)
    const thickness = Math.max(0.01, num(params.thickness, 0.12))
    const scale = Math.max(0.5, num(params.scale, 1.4))
    const angle = Math.atan2(y, x)
    const dist = Math.hypot(x, y)
    const turbulence = billow(Math.cos(angle) * scale + t * 0.2, Math.sin(angle) * scale, dist * 2 + t * 0.15)
    const ring = smoothstep(thickness, 0, Math.abs(dist - radius * (1 + turbulence * 0.25)))
    if (ring <= 0.002) return back
    const density = clamp01(0.35 + turbulence * 0.75)
    return addRgb(mixRgb(back, ramp(colors, density), ring), scaleRgb(ramp(colors, density), ring * density * 0.25))
  },

  /** Logarithmic spiral arms. */
  spiral: (u, v, { t, aspect, params }) => {
    const [x, y] = centred(u, v, aspect)
    const back = toRgb(params.colorBack ?? '#07070f')
    const front = toRgb(params.colorFront ?? '#e2e8ff')
    const angle = Math.atan2(y, x)
    const dist = Math.hypot(x, y) + 1e-3
    const density = Math.max(0.5, num(params.density, 5))
    const arms = Math.sin(angle * 2 + Math.log(dist) * density - t * 1.2)
    const strokeWidth = Math.max(0.02, num(params.strokeWidth, 0.25))
    const softness = num(params.softness, 0.4)
    const k = Math.pow(0.5 + 0.5 * arms, 1 + (1 - strokeWidth) * 6) * (1 / (1 + dist * 2.2))
    return mixRgb(back, front, clamp01(k * (0.6 + softness)))
  },

  /** Polar bands twisted by radius, in the palette's colours. */
  swirl: (u, v, { t, aspect, params, palette }) => {
    const [x, y] = centred(u, v, aspect)
    const back = toRgb(params.colorBack ?? '#0b0b14')
    const colors = palette(['#f97316', '#ec4899', '#8b5cf6', '#22d3ee'])
    const angle = Math.atan2(y, x)
    const dist = Math.hypot(x, y) + 1e-3
    const twist = num(params.twist, 1.2)
    const bands = Math.max(1, num(params.bandCount, 5))
    const k = 0.5 + 0.5 * Math.sin(angle * bands + twist / (dist + 0.25) + t * 0.8)
    const softness = num(params.softness, 0.4)
    const shaped = smoothstep(0.5 - softness * 0.5, 0.5 + softness * 0.5, k)
    return mixRgb(back, ramp(colors, angle / (Math.PI * 2) + 0.5 + t * 0.05), shaped)
  },

  /** Cellular noise: palette-coloured cells, dark moving edges. */
  voronoi: (u, v, { t, aspect, params, palette }) => {
    const [x, y] = centred(u, v, aspect)
    const gapColor = toRgb(params.colorGap ?? '#05050a')
    const colors = palette(['#f97316', '#38bdf8', '#a3e635'])
    const distortion = num(params.distortion, 0.25)
    const [wx, wy] = warpPoint(x + 0.5, y + 0.5, t * 0.2, distortion * 0.4)
    const { f1, f2, id } = voronoi(wx, wy, 5, 0.9, Math.floor(t * 0.5))
    const edge = f2 - f1
    const gap = Math.max(0.001, num(params.gap, 0.05))
    const glow = num(params.glow, 0.3)
    // Cell colour from the stable cell id, so neighbouring cells differ; the
    // edge is a soft dark line whose width is `gap`.
    const cellColor = ramp(colors, ((Math.abs(id) % 997) / 997) * 0.999)
    const fill = mixRgb(scaleRgb(cellColor, 0.9 + glow * 0.4), gapColor, 0.12)
    const edgeMix = 1 - smoothstep(gap * 0.5, gap * 2 + 0.02, edge)
    return mixRgb(fill, gapColor, edgeMix)
  },

  /** Warped stripes and blobs; `proportion` sets the stripe pitch. */
  warp: (u, v, { t, aspect, params, palette }) => {
    const [x, y] = centred(u, v, aspect)
    const colors = palette(['#111827', '#22d3ee', '#f0abfc'])
    const proportion = Math.max(0.5, num(params.proportion, 3))
    const distortion = num(params.distortion, 0.6)
    const swirl = num(params.swirl, 0.4)
    const [wx, wy] = warpPoint(x * proportion, y * proportion, t * 0.3, distortion, 4)
    const field = Math.sin(wx * 1.6 + Math.cos(wy * 1.2 + t * 0.3) * swirl * 2) * 0.5 + 0.5
    const softness = num(params.softness, 0.35)
    const k = smoothstep(0.5 - softness * 0.6, 0.5 + softness * 0.6, field)
    return ramp(colors, Math.min(k, 0.999))
  },

  /** Caustics on water, with highlight sparkle. */
  water: (u, v, { t, aspect, params, palette }) => {
    const [x, y] = centred(u, v, aspect)
    const back = toRgb(params.colorBack ?? '#03121f')
    const highlight = toRgb(params.colorHighlight ?? '#e0f2fe')
    const colors = palette(['#0c4a6e', '#0891b2', '#67e8f9'])
    const waves = Math.max(1, num(params.waves, 5))
    const caustic = num(params.caustic, 0.7)
    const a = Math.sin(x * waves * 3 + t * 0.9) + Math.sin(y * waves * 2.6 - t * 0.7)
    const b = billow(x * 2 + t * 0.2, y * 2, t * 0.15, 7)
    const field = clamp01(0.5 + a * 0.18 + (b - 0.5) * caustic)
    const base = mixRgb(back, ramp(colors, field), clamp01(field * 1.2))
    const sparkle = Math.pow(clamp01((b - 0.62) / 0.38), 2.2) * num(params.highlights, 0.6)
    return addRgb(base, scaleRgb(highlight, sparkle))
  },

  /** Diagonal colour panels sweeping across the frame. */
  'color-panels': (u, v, { t, params, palette }) => {
    const colors = palette(['#22d3ee', '#f472b6', '#facc15', '#4ade80'])
    const density = Math.max(0.5, num(params.density, 4))
    const length = Math.max(0.05, num(params.length, 0.6))
    const sweep = (u + v) * density - t * 0.4
    const cell = Math.floor(sweep)
    const phase = sweep - cell
    const half = length * 0.5
    const inside = smoothstep(0.5 - half - 0.05, 0.5 - half + 0.02, phase) * (1 - smoothstep(0.5 + half - 0.02, 0.5 + half + 0.05, phase))
    const back = toRgb(params.colorBack ?? '#0a0a12')
    const color = ramp(colors, Math.abs(cell % colors.length) / colors.length)
    return mixRgb(back, color, inside)
  },
}

/**
 * Render one frame of an effect into RGBA bytes.
 *
 * Deterministic: identical arguments produce byte-identical output. `time` is
 * the animation driver, so the caller decides what "now" means — the Lab drives
 * it from the composition clock, the tests from a literal.
 */
export function renderShaderPixels(
  kind: ShaderKind,
  options: { width: number; height: number; params?: ShaderParams } = { width: 4, height: 4 },
): Uint8ClampedArray {
  const width = Math.max(1, Math.round(options.width))
  const height = Math.max(1, Math.round(options.height))
  const sampler = SHADER_SAMPLERS[kind]
  if (!sampler) throw new Error(`Unknown shader effect: ${kind}`)
  const params = options.params ?? {}
  const palette = (fallback: string[]) => paletteOf(params.colors, fallback.map(toRgb))
  const ctx: SampleContext = { t: num(params.time, 0), aspect: width / height, params, palette }
  const out = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y++) {
    const v = (y + 0.5) / height
    for (let x = 0; x < width; x++) {
      const u = (x + 0.5) / width
      const [r, g, b] = sampler(u, v, ctx)
      const index = (y * width + x) * 4
      out[index] = clamp255(r)
      out[index + 1] = clamp255(g)
      out[index + 2] = clamp255(b)
      out[index + 3] = 255
    }
  }
  return out
}

/** True when a value is one of the effects this module implements. */
export function isShaderKind(value: unknown): value is ShaderKind {
  return typeof value === 'string' && (SHADER_KINDS as readonly string[]).includes(value)
}
