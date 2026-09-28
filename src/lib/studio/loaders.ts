/**
 * Loader clips — Transitions.dev "Thinking states" and "Matrix dot loader"
 * rebuilt as Cupric-native, deterministic Studio primitives.
 *
 * Upstream: https://transitions.dev (patterns p28 "Thinking states" and p33
 * "Matrix dot loader"; see resources/transitions-dev/ATTRIBUTION.md). The CSS
 * originals animate on the wall clock (CSS transitions, setTimeout,
 * `animation: … infinite`). None of that can run in the Studio: preview and
 * export sample ONE pure frame function (`drawStudioFrame`). So each CSS rule
 * is translated into a function of clip-local time:
 *
 *   thinking: hold → exit (translateY −distance, blur, fade) while the next
 *             line waits `gap` at +distance, then eases in over `swap`;
 *             shimmer = a 400%-wide gradient sweeping right→left each
 *             `shimmer` ms (same geometry as the CSS background-position).
 *   matrix:   4×4 cells, each pulsing base → active (15%) → base (45%) with a
 *             per-variant delay, exactly the upstream keyframes and delays.
 *
 * DOM-free, no Date.now, no Math.random. The same input always paints the
 * same pixels, so the Library preview, the Studio preview and the exported
 * video agree frame for frame.
 */
import type { StudioLoaderClip, StudioLoaderEase, StudioLoaderVariant } from '../../types/project'
import { bezierEase, type Bezier } from './curves'

/* ——— tokens (DESIGN.md values; canvas cannot read CSS variables) ——— */
export const LOADER_TOKENS = {
  muted: '#9A9AA5',
  text: '#F4F1EA',
  panelAlt: '#1C1C24',
  line: '#2A2A33',
  accent: '#C8F542',
  bg: '#0B0B10',
} as const

export const LOADER_EASES: Record<StudioLoaderEase, { label: string; bezier: Bezier }> = {
  'ease-in-out': { label: 'Ease in-out (upstream)', bezier: [0.42, 0, 0.58, 1] },
  ease: { label: 'Ease', bezier: [0.25, 0.1, 0.25, 1] },
  'ease-out': { label: 'Ease out', bezier: [0, 0, 0.58, 1] },
  'ease-in': { label: 'Ease in', bezier: [0.42, 0, 1, 1] },
  linear: { label: 'Linear', bezier: [0, 0, 1, 1] },
  soft: { label: 'Cupric soft', bezier: [0.22, 1, 0.36, 1] },
}

export const MATRIX_VARIANTS: StudioLoaderVariant[] = ['scan', 'twinkle', 'orbit', 'pulse']
export const DEFAULT_THINKING_STATES = ['Setting up a workplace', 'Running a command', 'Browsing files']

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
const num = (v: unknown, fallback: number, lo: number, hi: number) => (typeof v === 'number' && Number.isFinite(v) ? clamp(v, lo, hi) : fallback)
const HEX = /^#[0-9a-f]{6}$/i
const color = (v: unknown, fallback: string) => (typeof v === 'string' && HEX.test(v) ? v : fallback)

/** Fill every missing/invalid field so partial or hand-edited saves still draw. */
export function normaliseLoader(clip: Partial<StudioLoaderClip>): StudioLoaderClip {
  const loader = clip.loader === 'matrix' ? 'matrix' : 'thinking'
  const states = Array.isArray(clip.states) ? clip.states.map((s) => String(s).slice(0, 80)).filter((s) => s.trim()) : []
  return {
    id: String(clip.id ?? 'loader'),
    kind: 'loader',
    track: num(clip.track, 1, 0, 99),
    startSec: num(clip.startSec, 0, 0, 1e6),
    durationSec: num(clip.durationSec, 4, 0.1, 1e5),
    name: typeof clip.name === 'string' ? clip.name : loader === 'matrix' ? 'Matrix loader' : 'Thinking states',
    transitionIn: clip.transitionIn ?? 'fade',
    transitionOut: clip.transitionOut ?? 'fade',
    opacity: num(clip.opacity, 1, 0, 1),
    ...clip,
    loader,
    x: num(clip.x, 0.5, -1, 2),
    y: num(clip.y, 0.5, -1, 2),
    size: num(clip.size, loader === 'matrix' ? 0.012 : 0.045, 0.002, 0.5),
    states: states.length ? states : [...DEFAULT_THINKING_STATES],
    holdMs: num(clip.holdMs, 2000, 100, 60000),
    swapMs: num(clip.swapMs, 150, 0, 5000),
    gapMs: num(clip.gapMs, 50, 0, 5000),
    distancePx: num(clip.distancePx, 8, 0, 200),
    blurPx: num(clip.blurPx, 2, 0, 40),
    shimmerMs: num(clip.shimmerMs, 2000, 200, 60000),
    shimmer: clip.shimmer !== false,
    baseColor: color(clip.baseColor, LOADER_TOKENS.muted),
    highlightColor: color(clip.highlightColor, LOADER_TOKENS.text),
    activeColor: color(clip.activeColor, loader === 'matrix' ? '#B8B8C2' : LOADER_TOKENS.text),
    ease: clip.ease && clip.ease in LOADER_EASES ? clip.ease : 'ease-in-out',
    variant: clip.variant && MATRIX_VARIANTS.includes(clip.variant) ? clip.variant : 'scan',
    rounded: clip.rounded === true,
    cycleMs: num(clip.cycleMs, 1200, 100, 20000),
    speed: num(clip.speed, 1, 0.1, 8),
    loop: clip.loop !== false,
    reducedMotion: clip.reducedMotion === true,
    label: typeof clip.label === 'string' && clip.label.trim() ? clip.label : 'Loading',
    backdrop: clip.backdrop === true,
  } as StudioLoaderClip
}

/* ——— Thinking states ——————————————————————————————————————————— */

export type ThinkingLine = { text: string; dy: number; blur: number; alpha: number }
export type ThinkingFrame = {
  lines: ThinkingLine[]
  /** Index of the live (current) state. */
  current: number
  /** Text of the longest state (the sizer). */
  longest: string
  /** Shimmer band centre in text-width units (−1 … 2), or null when off. */
  shimmerCentre: number | null
}

/**
 * The thinking-states frame at clip-local time `localSec`.
 * Mirrors the upstream component: state k is visible for `hold`, then the
 * next one mounts at +distance/blurred for `gap`, then both transition for
 * `swap` (the old line leaves upward).
 */
export function thinkingFrameAt(input: Partial<StudioLoaderClip>, localSec: number): ThinkingFrame {
  const c = normaliseLoader(input)
  const t = Math.max(0, localSec) * 1000 * c.speed
  const n = c.states.length
  const longest = c.states.reduce((a, b) => (b.length > a.length ? b : a), '')
  const ease = LOADER_EASES[c.ease].bezier
  if (c.reducedMotion || n === 1) {
    // Reduced motion: swaps are instant, no blur/translate, no shimmer.
    const seg = c.holdMs
    const k = n === 1 ? 0 : c.loop ? Math.floor(t / seg) % n : Math.min(n - 1, Math.floor(t / seg))
    return { lines: [{ text: c.states[k], dy: 0, blur: 0, alpha: 1 }], current: k, longest, shimmerCentre: c.reducedMotion || !c.shimmer ? null : shimmerAt(c, t) }
  }
  const seg = c.holdMs + c.gapMs + c.swapMs
  let k = Math.floor(t / seg)
  let p = t - k * seg
  if (!c.loop && k >= n - 1) { k = n - 1; p = seg }
  const current = k % n
  const lines: ThinkingLine[] = []
  // A transition happens at the start of every segment except the very first.
  if (k > 0 && p < c.gapMs + c.swapMs) {
    const prev = (current - 1 + n) % n
    const e = c.swapMs > 0 ? bezierEase(ease, clamp(p / c.swapMs, 0, 1)) : 1
    if (e < 1) lines.push({ text: c.states[prev], dy: -c.distancePx * e, blur: c.blurPx * e, alpha: 1 - e })
    const q = p < c.gapMs ? 0 : c.swapMs > 0 ? bezierEase(ease, clamp((p - c.gapMs) / c.swapMs, 0, 1)) : 1
    lines.push({ text: c.states[current], dy: c.distancePx * (1 - q), blur: c.blurPx * (1 - q), alpha: q })
  } else {
    lines.push({ text: c.states[current], dy: 0, blur: 0, alpha: 1 })
  }
  return { lines, current, longest, shimmerCentre: c.shimmer ? shimmerAt(c, t) : null }
}

/** CSS: background-size 400%, position 100% → 0% linear. Centre = 2 − 3·pos (text widths). */
function shimmerAt(c: StudioLoaderClip, tMs: number): number {
  const phase = (tMs % c.shimmerMs) / c.shimmerMs
  const pos = 1 - phase
  return 2 - 3 * pos
}

/* ——— Matrix dot loader ————————————————————————————————————————— */

const CORNERS = [0, 3, 12, 15]
const RING = [1, 2, 7, 11, 14, 13, 8, 4]
const INNER = [5, 6, 9, 10]
const TWINKLE = [7, 2, 11, 5, 14, 9, 0, 12, 3, 15, 6, 10, 13, 1, 8, 4]

/** Upstream `delayFor`, unchanged: ms of animation delay, or null = no animation. */
export function matrixDelay(variant: StudioLoaderVariant, idx: number, cycle: number): number | null {
  const col = idx % 4
  if (variant === 'scan') return Math.round(col * (cycle / 10))
  if (variant === 'twinkle') return Math.round(TWINKLE[idx] * (cycle / 16))
  if (variant === 'orbit') {
    const k = RING.indexOf(idx)
    return k === -1 ? null : Math.round(k * (cycle / 8))
  }
  if (variant === 'pulse') return Math.round((INNER.includes(idx) ? 0 : 1) * (cycle * 0.16))
  return 0
}

export type MatrixCell = { idx: number; gap: boolean; level: number }

/**
 * 0 = base colour, 1 = active colour, for each of the 16 cells.
 * Keyframes: 0%/45%/100% base, 15% active; the timing function applies to
 * each keyframe segment, as CSS does. Before its delay a cell shows base.
 */
export function matrixFrameAt(input: Partial<StudioLoaderClip>, localSec: number): MatrixCell[] {
  const c = normaliseLoader({ ...input, loader: 'matrix' })
  const tMs = Math.max(0, localSec) * 1000 * c.speed
  const ease = LOADER_EASES[c.ease].bezier
  const cells: MatrixCell[] = []
  for (let idx = 0; idx < 16; idx++) {
    if (c.rounded && CORNERS.includes(idx)) { cells.push({ idx, gap: true, level: 0 }); continue }
    const d = matrixDelay(c.variant, idx, c.cycleMs)
    if (c.reducedMotion || d === null || tMs < d) { cells.push({ idx, gap: false, level: 0 }); continue }
    const elapsed = tMs - d
    if (!c.loop && elapsed >= c.cycleMs) { cells.push({ idx, gap: false, level: 0 }); continue }
    const phase = (elapsed % c.cycleMs) / c.cycleMs
    let level = 0
    if (phase < 0.15) level = bezierEase(ease, phase / 0.15)
    else if (phase < 0.45) level = 1 - bezierEase(ease, (phase - 0.15) / 0.3)
    cells.push({ idx, gap: false, level: clamp(level, 0, 1) })
  }
  return cells
}

export function mixHex(a: string, b: string, k: number): string {
  const pa = parseInt(a.slice(1), 16)
  const pb = parseInt(b.slice(1), 16)
  const ch = (shift: number) => Math.round(((pa >> shift) & 255) + ((((pb >> shift) & 255) - ((pa >> shift) & 255)) * k))
  return `#${[16, 8, 0].map((s) => ch(s).toString(16).padStart(2, '0')).join('')}`
}

/* ——— Canvas drawing (shared by preview, export and Library cards) ——— */

type Ctx = Pick<CanvasRenderingContext2D, 'save' | 'restore' | 'fillText' | 'measureText' | 'fillRect' | 'createLinearGradient' | 'beginPath' | 'arc' | 'fill'> & {
  font: string
  fillStyle: string | CanvasGradient | CanvasPattern
  globalAlpha: number
  filter: string
  textAlign: CanvasTextAlign
  textBaseline: CanvasTextBaseline
}

/** Paint a loader clip. `t` is timeline time; the clip's own clock starts at startSec. */
export function drawLoader(ctx: Ctx, input: StudioLoaderClip, t: number, width: number, height: number): void {
  const c = normaliseLoader(input)
  const local = Math.max(0, t - c.startSec)
  const px = height / 1080
  ctx.save()
  if (c.backdrop) {
    ctx.fillStyle = LOADER_TOKENS.bg
    ctx.fillRect(0, 0, width, height)
  }
  if (c.loader === 'matrix') {
    const cell = Math.max(1, c.size * height)
    const gapPx = cell
    const grid = cell * 4 + gapPx * 3
    const ox = c.x * width - grid / 2
    const oy = c.y * height - grid / 2
    for (const m of matrixFrameAt(c, local)) {
      if (m.gap) continue
      ctx.fillStyle = mixHex(c.baseColor, c.activeColor, m.level)
      ctx.fillRect(ox + (m.idx % 4) * (cell + gapPx), oy + Math.floor(m.idx / 4) * (cell + gapPx), cell, cell)
    }
    ctx.restore()
    return
  }
  const frame = thinkingFrameAt(c, local)
  const fontPx = Math.max(6, c.size * height)
  ctx.font = `500 ${fontPx.toFixed(1)}px "Inter Variable", Inter, system-ui, sans-serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  const cx = c.x * width
  const cy = c.y * height
  for (const line of frame.lines) {
    if (line.alpha <= 0.001) continue
    const w = Math.max(1, ctx.measureText(line.text).width)
    let fill: string | CanvasGradient = c.baseColor
    if (frame.shimmerCentre !== null) {
      // Same composite as the CSS ::before overlay: highlight band (40%–60% of a
      // 400%-wide gradient = ±0.4 text widths) over the base colour.
      const left = cx - w / 2
      const g = ctx.createLinearGradient(left + (frame.shimmerCentre - 0.4) * w, 0, left + (frame.shimmerCentre + 0.4) * w, 0)
      g.addColorStop(0, c.baseColor)
      g.addColorStop(0.5, c.highlightColor)
      g.addColorStop(1, c.baseColor)
      fill = g
    }
    ctx.save()
    ctx.globalAlpha *= line.alpha
    ctx.filter = line.blur > 0.05 ? `blur(${(line.blur * px).toFixed(2)}px)` : 'none'
    ctx.fillStyle = fill
    ctx.fillText(line.text, cx, cy + line.dy * px * (fontPx / 16))
    ctx.restore()
  }
  ctx.restore()
}

/* ——— Presets (Library + Studio insert) ——————————————————————————— */

export type LoaderPreset = {
  id: string
  name: string
  description: string
  upstream: 'p28' | 'p33'
  patch: Partial<StudioLoaderClip>
}

const M = (id: string, name: string, description: string, patch: Partial<StudioLoaderClip>): LoaderPreset => ({ id: `matrix-${id}`, name: `Matrix loader · ${name}`, description, upstream: 'p33', patch: { loader: 'matrix', ...patch } })

export const LOADER_PRESETS: LoaderPreset[] = [
  { id: 'thinking-states', name: 'Thinking states', description: 'Rotating status lines with a blur-slide swap and a travelling shimmer. Editable text, timing, colours and easing.', upstream: 'p28', patch: { loader: 'thinking' } },
  { id: 'thinking-states-agent', name: 'Thinking states · agent steps', description: 'Agent-style status copy (planning, searching, writing) on a lime shimmer. Replace the lines with the real steps of your video.', upstream: 'p28', patch: { loader: 'thinking', states: ['Planning the edit', 'Searching references', 'Writing captions'], highlightColor: LOADER_TOKENS.accent } },
  M('scan', 'scan', 'Columns light up left to right.', { variant: 'scan' }),
  M('twinkle', 'twinkle', 'Cells twinkle in a fixed scattered order.', { variant: 'twinkle' }),
  M('orbit', 'orbit', 'A light runs around the outer ring; the centre stays still.', { variant: 'orbit' }),
  M('pulse', 'pulse', 'The inner square pulses, then the outer cells answer.', { variant: 'pulse' }),
  M('rounded', 'rounded', 'Scan with the four corners removed for a softer silhouette.', { variant: 'scan', rounded: true }),
  M('monochrome', 'monochrome', 'Neutral greys from the Cupric palette.', { variant: 'twinkle', baseColor: LOADER_TOKENS.panelAlt, activeColor: LOADER_TOKENS.text }),
  M('lime', 'lime accent', 'Cupric lime active cells — use once per frame.', { variant: 'orbit', baseColor: LOADER_TOKENS.line, activeColor: LOADER_TOKENS.accent }),
  M('reduced', 'reduced motion', 'Static grid: the honest still state for reduced-motion exports or disabled UI.', { variant: 'scan', reducedMotion: true }),
  M('compact', 'compact', 'Small, for a corner status or a lower third.', { variant: 'scan', size: 0.006 }),
  M('large', 'large', 'A hero-sized grid for a loading beat.', { variant: 'pulse', size: 0.03 }),
  M('inline', 'inline', 'Text-height grid to sit next to a caption.', { variant: 'twinkle', size: 0.008, x: 0.3 }),
  M('fullscreen', 'full-screen', 'Full-frame loading beat on the app background colour.', { variant: 'orbit', size: 0.035, backdrop: true }),
]

export function loaderPreset(id: string): LoaderPreset | null {
  return LOADER_PRESETS.find((p) => p.id === id) ?? null
}

/** A new loader clip from a preset (not placed; callers pick track/time). */
export function makeLoaderClip(presetId: string, at: number, id: string, opts: Partial<StudioLoaderClip> = {}): StudioLoaderClip | null {
  const preset = loaderPreset(presetId)
  if (!preset) return null
  return normaliseLoader({
    id,
    name: preset.name,
    startSec: Math.max(0, at),
    durationSec: preset.patch.loader === 'matrix' ? 3 : 6.6,
    track: 1,
    transitionIn: 'fade',
    transitionOut: 'fade',
    opacity: 1,
    presetId: preset.id,
    ...preset.patch,
    ...opts,
  })
}

/** Seconds one full pass of the loader takes (for "fit duration to one loop"). */
export function loaderLoopSec(input: Partial<StudioLoaderClip>): number {
  const c = normaliseLoader(input)
  if (c.loader === 'matrix') return c.cycleMs / 1000 / c.speed + (Math.max(...Array.from({ length: 16 }, (_, i) => matrixDelay(c.variant, i, c.cycleMs) ?? 0)) / 1000) / c.speed
  const seg = c.reducedMotion ? c.holdMs : c.holdMs + c.gapMs + c.swapMs
  return (seg * c.states.length) / 1000 / c.speed
}
