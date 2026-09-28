/**
 * Cursor pack v2 — the pointer as a first-class animated element.
 *
 * Completes the last open item of JOB 11. There was no cursor pack to extend,
 * so this is the whole thing: eight pointer variants drawn from paths (never
 * bitmaps, so they stay sharp at any export size), a click ripple, and a
 * press state.
 *
 * The motion rules are adapted from the motion-ui engine in
 * motion-launch-videos by Marouane Gazouzi (MIT), which gets one thing very
 * right: a pointer that teleports reads as a glitch, and a pointer parked on
 * the thing you are meant to read is just a blob in the way. So travel is
 * sprung and takes real time, and the pack knows when to lift out.
 *
 * Everything here is a pure function of the clip's own progress, so a cursor
 * demo exports exactly as it previewed.
 */
import { settle, SPRINGS, springAt, springLand, type SpringName } from './springs'

export type CursorKind =
  | 'arrow'
  | 'hand'
  | 'finger'
  | 'text'
  | 'crosshair'
  | 'grab'
  | 'zoom'
  | 'dot'

export type CursorVariant = {
  kind: CursorKind
  label: string
  /** What this pointer is for, so the picker is not eight nameless icons. */
  hint: string
  /** Natural size in px at 1080p; scaled with the frame. */
  size: number
  /** A finger is a translucent disc; the rest are outlined shapes. */
  soft: boolean
}

export const CURSOR_VARIANTS: readonly CursorVariant[] = [
  { kind: 'arrow', label: 'Arrow', hint: 'The standard desktop pointer. Use for anything shot on a computer.', size: 34, soft: false },
  { kind: 'hand', label: 'Hand', hint: 'The link pointer — reads as “this is clickable”.', size: 36, soft: false },
  { kind: 'finger', label: 'Finger', hint: 'A soft touch disc for phone and tablet demos.', size: 56, soft: true },
  { kind: 'text', label: 'Text beam', hint: 'Shows a field being focused before typing starts.', size: 30, soft: false },
  { kind: 'crosshair', label: 'Crosshair', hint: 'Precision picking — canvases, maps, colour pickers.', size: 32, soft: false },
  { kind: 'grab', label: 'Grab', hint: 'Dragging and panning. Closes into a fist while held.', size: 36, soft: false },
  { kind: 'zoom', label: 'Zoom', hint: 'A magnifier for “look closer” moments.', size: 34, soft: false },
  { kind: 'dot', label: 'Dot', hint: 'A minimal tracking dot when the pointer must not distract.', size: 20, soft: true },
] as const

export const cursorVariant = (kind: CursorKind): CursorVariant =>
  CURSOR_VARIANTS.find((v) => v.kind === kind) ?? CURSOR_VARIANTS[0]

/**
 * Outline of each pointer in a 0–1 box, drawn from its own tip.
 *
 * Path units are fractions of `size`, so one set of numbers renders correctly
 * at 320px in the preview and 4K in the export.
 */
export function cursorPath(kind: CursorKind): Array<[number, number]> {
  switch (kind) {
    case 'arrow':
      return [[0, 0], [0, 1.0], [0.26, 0.76], [0.42, 1.08], [0.58, 1.0], [0.42, 0.7], [0.72, 0.68]]
    case 'hand':
      return [[0.30, 0.00], [0.44, 0.00], [0.44, 0.40], [0.52, 0.34], [0.66, 0.38], [0.74, 0.52],
              [0.74, 0.86], [0.62, 1.04], [0.34, 1.04], [0.20, 0.86], [0.20, 0.52]]
    case 'text':
      return [[0.18, 0], [0.62, 0], [0.62, 0.10], [0.46, 0.10], [0.46, 0.90], [0.62, 0.90],
              [0.62, 1.0], [0.18, 1.0], [0.18, 0.90], [0.34, 0.90], [0.34, 0.10], [0.18, 0.10]]
    case 'crosshair':
      return [[0.40, 0], [0.48, 0], [0.48, 0.40], [0.88, 0.40], [0.88, 0.48], [0.48, 0.48],
              [0.48, 0.88], [0.40, 0.88], [0.40, 0.48], [0, 0.48], [0, 0.40], [0.40, 0.40]]
    case 'grab':
      return [[0.22, 0.30], [0.34, 0.22], [0.46, 0.26], [0.58, 0.22], [0.70, 0.30], [0.76, 0.48],
              [0.72, 0.84], [0.56, 1.00], [0.32, 1.00], [0.18, 0.82], [0.16, 0.48]]
    case 'zoom':
      return [[0.62, 0.62], [0.95, 0.95]]
    case 'finger':
    case 'dot':
    default:
      return []
  }
}

/** Pointers drawn as a circle rather than a path. */
export const isDisc = (kind: CursorKind) => kind === 'finger' || kind === 'dot'

/**
 * Where the pointer is at progress `p`, travelling from `from` to `to`.
 *
 * The move is sprung, so it accelerates away and eases into the target the way
 * a hand does. Coordinates are normalised 0–1 across the stage.
 */
export function cursorPosition(
  p: number,
  from: readonly [number, number],
  to: readonly [number, number],
  sp: SpringName = 'focus',
): [number, number] {
  // The segment is the spring's full settle time, not its landing time: a
  // pointer that stops 5% short of the button it is about to press is worse
  // than one that arrives a beat early.
  const span = settle(SPRINGS[sp])
  const k = springAt(Math.max(0, Math.min(1, p)) * span, sp)
  return [from[0] + (to[0] - from[0]) * k, from[1] + (to[1] - from[1]) * k]
}

/** How long a pointer move should be given, in seconds, before it is due. */
export const CURSOR_TRAVEL_SEC = Math.round(springLand('focus') * 100) / 100

/**
 * Press depth at progress `p` through a click, 0 → 1 → 0.
 *
 * A click is a dip and a release, not a step: the pointer shrinks slightly on
 * the way down and springs back. Peaks at exactly p = 0.5 so the ripple and
 * the UI's own reaction can be timed against it.
 */
export function clickPress(p: number): number {
  const q = Math.max(0, Math.min(1, p))
  // Critically damped on purpose: an overshooting spring would put the
  // deepest point of the press somewhere other than the middle of the click,
  // and the ripple is timed against that middle.
  const span = settle(SPRINGS.glide)
  return q < 0.5 ? springAt(q * 2 * span, 'glide') : springAt((1 - q) * 2 * span, 'glide')
}

/** Expanding ring behind a click: `{ radius, alpha }` in px, at 1080p. */
export function clickRipple(p: number, size: number): { radius: number; alpha: number } {
  const q = Math.max(0, Math.min(1, p))
  const grow = springAt(q * settle(SPRINGS.glide), 'glide')
  return { radius: size * 0.3 + size * 1.5 * grow, alpha: 0.45 * (1 - q) * (1 - q) }
}

/**
 * Opacity while the pointer enters or leaves.
 *
 * `in` fades up as it flies in; `out` lifts it away between beats so it is not
 * sitting on top of the thing the viewer is supposed to be reading.
 */
export function cursorFade(p: number, dir: 'in' | 'out'): number {
  const k = springAt(Math.max(0, Math.min(1, p)) * settle(SPRINGS.glide), 'glide')
  return dir === 'in' ? k : 1 - k
}

/**
 * Draw a pointer. Pure in its inputs — the same call draws the same pixels in
 * the preview and in the export.
 *
 * `x`/`y` are the tip in px. `press` 0–1 dips it, `ripplePhase` >= 0 draws the
 * click ring.
 */
export function drawCursor(
  ctx: CanvasRenderingContext2D,
  kind: CursorKind,
  x: number,
  y: number,
  opts: { size?: number; fill?: string; stroke?: string; alpha?: number; press?: number; ripplePhase?: number } = {},
): void {
  const variant = cursorVariant(kind)
  const size = opts.size ?? variant.size
  const fill = opts.fill ?? (variant.soft ? 'rgba(255,255,255,0.55)' : '#FFFFFF')
  const stroke = opts.stroke ?? '#0B0B10'
  const alpha = opts.alpha ?? 1
  const press = opts.press ?? 0
  if (alpha <= 0.002) return

  if (opts.ripplePhase !== undefined && opts.ripplePhase >= 0 && opts.ripplePhase <= 1) {
    const { radius, alpha: ra } = clickRipple(opts.ripplePhase, size)
    if (ra > 0.003) {
      ctx.save()
      ctx.globalAlpha = alpha * ra
      ctx.strokeStyle = stroke
      ctx.lineWidth = Math.max(1.5, size * 0.07)
      ctx.beginPath()
      ctx.arc(x, y, radius, 0, Math.PI * 2)
      ctx.stroke()
      ctx.restore()
    }
  }

  const scale = 1 - press * 0.12
  ctx.save()
  ctx.globalAlpha = alpha
  ctx.translate(x, y)
  ctx.scale(scale, scale)
  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'

  if (isDisc(kind)) {
    const r = size / 2
    ctx.fillStyle = fill
    ctx.beginPath()
    ctx.arc(0, 0, r, 0, Math.PI * 2)
    ctx.fill()
    ctx.strokeStyle = stroke
    ctx.lineWidth = Math.max(1.5, size * 0.04)
    ctx.globalAlpha = alpha * 0.7
    ctx.beginPath()
    ctx.arc(0, 0, r - ctx.lineWidth / 2, 0, Math.PI * 2)
    ctx.stroke()
  } else {
    const pts = cursorPath(kind)
    ctx.lineWidth = Math.max(1.5, size * 0.055)
    if (kind === 'zoom') {
      // A magnifier is a circle plus a handle, not a polygon.
      ctx.strokeStyle = stroke
      ctx.fillStyle = fill
      ctx.beginPath()
      ctx.arc(size * 0.38, size * 0.38, size * 0.3, 0, Math.PI * 2)
      ctx.fill()
      ctx.stroke()
      ctx.beginPath()
      ctx.moveTo(pts[0][0] * size, pts[0][1] * size)
      ctx.lineTo(pts[1][0] * size, pts[1][1] * size)
      ctx.stroke()
    } else {
      ctx.beginPath()
      pts.forEach(([px, py], i) => {
        const dx = px * size
        const dy = py * size
        if (i === 0) ctx.moveTo(dx, dy)
        else ctx.lineTo(dx, dy)
      })
      ctx.closePath()
      ctx.fillStyle = fill
      ctx.fill()
      ctx.strokeStyle = stroke
      ctx.stroke()
    }
  }
  ctx.restore()
}
