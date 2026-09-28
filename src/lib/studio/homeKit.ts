/**
 * Home_X video kit — eight native clip kinds drawn by the shared Studio
 * renderer (preview and export call the same `drawKit`).
 *
 * Rules (DESIGN.md §1 "Video palette", §Motion):
 *  - Every frame is a pure function of (clip, local seconds). Layout jitter
 *    comes from mulberry32(clip.seed); there is no clock and no Math.random.
 *  - Colours are DESIGN tokens, mirrored literally because canvas cannot read
 *    CSS variables. check:ui-audit keeps VIDEO_TOKENS equal to @theme.
 *  - Motion uses EASE_SOFT; the single spring is the pill pop (0.96 → 1).
 *  - `reducedMotion` renders the final layout with an opacity-only fade.
 *  - Nothing here invents content: empty photo slots draw "drop media here",
 *    and numbers/labels come only from the clip's fields.
 */
import type { StudioKitClip, StudioKitKind, StudioKitMedia } from '../../types/project'
import { bezierEase, type Bezier } from './curves'

/* ——— tokens ——— */

/** `--color-video-*` from @theme (styles.css). */
export const VIDEO_TOKENS = {
  orange: '#FF5A1F',
  blue: '#2F6BFF',
  cream: '#F4EFE4',
  paper: '#F7F6F2',
  ink: '#0E0E12',
  yellow: '#FFE58A',
  pink: '#FFC6DA',
  mint: '#BFF0D4',
  green: '#1FA463',
} as const

/** Core app tokens (dark @theme and the light-theme surface overrides). */
export const CORE_TOKENS = {
  bg: '#0B0B10',
  panel: '#15151B',
  panelAlt: '#1C1C24',
  text: '#F4F1EA',
  muted: '#9A9AA5',
  accent: '#C8F542',
  info: '#4FB6E8',
  danger: '#E24B4A',
  lightBg: '#F3F2ED',
  lightPanel: '#FFFFFF',
  lightPanelAlt: '#F8F7F2',
  lightText: '#191922',
  lightMuted: '#63636E',
} as const

export const KIT_ACCENTS: Array<{ id: string; label: string; color: string }> = [
  { id: 'danger', label: 'Red', color: CORE_TOKENS.danger },
  { id: 'orange', label: 'Orange', color: VIDEO_TOKENS.orange },
  { id: 'blue', label: 'Blue', color: VIDEO_TOKENS.blue },
  { id: 'green', label: 'Green', color: VIDEO_TOKENS.green },
  { id: 'accent', label: 'Lime', color: CORE_TOKENS.accent },
  { id: 'info', label: 'Sky', color: CORE_TOKENS.info },
  { id: 'yellow', label: 'Pastel yellow', color: VIDEO_TOKENS.yellow },
  { id: 'pink', label: 'Pastel pink', color: VIDEO_TOKENS.pink },
  { id: 'mint', label: 'Pastel mint', color: VIDEO_TOKENS.mint },
]
const ALLOWED_ACCENTS = new Set(KIT_ACCENTS.map((a) => a.color.toUpperCase()))

export const KIT_KINDS: Array<{ id: StudioKitKind; name: string; variants: string[]; use: string }> = [
  { id: 'cursor-zoom', name: 'Cursor zoom rig', variants: ['default'], use: 'Cursor glides to a target, clicks with a ripple; pair with a scale keyframe on the footage for the zoom.' },
  { id: 'pill-text', name: 'Pill text', variants: ['inline', 'checklist', 'chips'], use: 'Words in [brackets] become solid pills; checklist and currency-chip looks.' },
  { id: 'stat-card', name: 'Stat card', variants: ['stat', 'price'], use: 'Big number that ticks up (tabular digits) with a small label; price card look.' },
  { id: 'rating-bars', name: 'Rating bars', variants: ['default'], use: 'Labelled progress bars that fill 0 → value on enter.' },
  { id: 'image-stack', name: 'Image stack', variants: ['stack', 'single', 'landscape'], use: '1–8 of your photos overlapped and rotated within bounds, staggered entrance.' },
  { id: 'browser-mockup', name: 'Browser mockup', variants: ['agent', 'saas', 'composer'], use: 'Browser chrome with sidebar, thinking bubble and progress; SaaS home; post composer.' },
  { id: 'checkout-card', name: 'Checkout card', variants: ['default'], use: 'Browser checkout: product, price, wallet buttons, fields, Pay button, summary.' },
  { id: 'block-row-3d', name: 'Block row 3D', variants: ['default'], use: 'Perspective row of numbered blocks with glowing pins that light in sequence.' },
]
const KIND_IDS = new Set(KIT_KINDS.map((k) => k.id))
export const isKitKind = (v: unknown): v is StudioKitKind => typeof v === 'string' && KIND_IDS.has(v as StudioKitKind)

/** Box aspect (height / width) per kind and variant. */
export function kitAspect(kit: StudioKitKind, variant?: string): number {
  switch (kit) {
    case 'cursor-zoom': return 1
    case 'pill-text': return variant === 'checklist' ? 0.42 : variant === 'chips' ? 0.14 : 0.16
    case 'stat-card': return variant === 'price' ? 1.15 : 0.5
    case 'rating-bars': return 0.95
    case 'image-stack': return variant === 'landscape' ? 0.62 : variant === 'single' ? 1.1 : 0.62
    case 'browser-mockup': return variant === 'composer' ? 0.62 : 0.6
    case 'checkout-card': return 0.9
    case 'block-row-3d': return 0.45
  }
}

/* ——— pure helpers ——— */

export const EASE_SOFT_B: Bezier = [0.22, 1, 0.36, 1]
export const EASE_SPRING_B: Bezier = [0.34, 1.56, 0.64, 1]
const soft = (x: number) => bezierEase(EASE_SOFT_B, x)
/** The kit's one spring (overshoots past 1, so no clamp on the output). */
function spring(x: number): number {
  if (x <= 0) return 0
  if (x >= 1) return 1
  // Sample the CSS spring bezier directly: y may exceed 1 (that is the pop).
  const [x1, y1, x2, y2] = EASE_SPRING_B
  let lo = 0, hi = 1, u = x
  for (let i = 0; i < 24; i++) {
    u = (lo + hi) / 2
    const bx = 3 * (1 - u) * (1 - u) * u * x1 + 3 * (1 - u) * u * u * x2 + u * u * u
    if (bx < x) lo = u
    else hi = u
  }
  return 3 * (1 - u) * (1 - u) * u * y1 + 3 * (1 - u) * u * u * y2 + u * u * u
}
const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v)
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
/** Progress of a window [start, start+dur] in seconds. */
const win = (e: number, start: number, dur: number) => clamp01((e - start) / Math.max(1e-6, dur))

export function mulberry32(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Local time state of a kit clip at timeline time `t` — the only clock the kit reads. */
export function cycleAt(clip: Pick<StudioKitClip, 'startSec' | 'durationSec'>, t: number): { e: number; p: number } {
  const e = clamp(t - clip.startSec, 0, clip.durationSec)
  return { e, p: clip.durationSec > 0 ? e / clip.durationSec : 1 }
}

const HEX = /^#[0-9a-f]{6}$/i
function rgba(hex: string, a: number): string {
  const h = HEX.test(hex) ? hex.slice(1) : '000000'
  return `rgba(${parseInt(h.slice(0, 2), 16)}, ${parseInt(h.slice(2, 4), 16)}, ${parseInt(h.slice(4, 6), 16)}, ${clamp01(a)})`
}
function mix(a: string, b: string, k: number): string {
  const pa = HEX.test(a) ? a.slice(1) : '000000'
  const pb = HEX.test(b) ? b.slice(1) : '000000'
  const c = (i: number) => Math.round(parseInt(pa.slice(i, i + 2), 16) * (1 - k) + parseInt(pb.slice(i, i + 2), 16) * k)
  return `#${[c(0), c(2), c(4)].map((v) => v.toString(16).padStart(2, '0')).join('')}`
}

type Surf = { bg: string; panel: string; panelAlt: string; text: string; muted: string; line: string }
function surfaces(theme: 'light' | 'dark'): Surf {
  return theme === 'light'
    ? { bg: CORE_TOKENS.lightBg, panel: CORE_TOKENS.lightPanel, panelAlt: CORE_TOKENS.lightPanelAlt, text: CORE_TOKENS.lightText, muted: CORE_TOKENS.lightMuted, line: rgba(CORE_TOKENS.lightText, 0.1) }
    : { bg: CORE_TOKENS.bg, panel: CORE_TOKENS.panel, panelAlt: CORE_TOKENS.panelAlt, text: CORE_TOKENS.text, muted: CORE_TOKENS.muted, line: rgba('#FFFFFF', 0.08) }
}

const SANS = '"Inter Variable", Inter, system-ui, sans-serif'
const MONO = '"JetBrains Mono Variable", "JetBrains Mono", ui-monospace, monospace'
const font = (px: number, weight = 500, family = SANS) => `${weight} ${Math.max(1, Math.round(px))}px ${family}`

function rr(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const k = Math.max(0, Math.min(r, w / 2, h / 2))
  ctx.beginPath()
  ctx.moveTo(x + k, y)
  ctx.lineTo(x + w - k, y)
  ctx.quadraticCurveTo(x + w, y, x + w, y + k)
  ctx.lineTo(x + w, y + h - k)
  ctx.quadraticCurveTo(x + w, y + h, x + w - k, y + h)
  ctx.lineTo(x + k, y + h)
  ctx.quadraticCurveTo(x, y + h, x, y + h - k)
  ctx.lineTo(x, y + k)
  ctx.quadraticCurveTo(x, y, x + k, y)
  ctx.closePath()
}
function fillRR(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number, fill: string) {
  ctx.fillStyle = fill
  rr(ctx, x, y, w, h, r)
  ctx.fill()
}
function text(ctx: CanvasRenderingContext2D, s: string, x: number, y: number, px: number, color: string, weight = 500, align: CanvasTextAlign = 'left', family = SANS, maxW?: number) {
  ctx.font = font(px, weight, family)
  ctx.fillStyle = color
  ctx.textAlign = align
  ctx.textBaseline = 'middle'
  if (maxW && maxW > 0) ctx.fillText(fitText(ctx, s, maxW), x, y)
  else ctx.fillText(s, x, y)
}
/** Ellipsize to fit — never lets copy spill outside its box. */
function fitText(ctx: CanvasRenderingContext2D, s: string, maxW: number): string {
  if (ctx.measureText(s).width <= maxW) return s
  let lo = 0, hi = s.length
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (ctx.measureText(s.slice(0, mid) + '…').width <= maxW) lo = mid
    else hi = mid - 1
  }
  return s.slice(0, lo) + '…'
}
/** Largest font size ≤ `px` at which `s` fits `maxW` (fonts sized to fit). */
export function fitFontPx(ctx: CanvasRenderingContext2D, s: string, px: number, maxW: number, weight = 700, family = SANS): number {
  ctx.font = font(px, weight, family)
  const w = ctx.measureText(s).width
  return w <= maxW || w <= 0 ? px : Math.max(8, px * (maxW / w))
}
/**
 * Tabular digits: every digit gets the advance of "0", so a number that ticks
 * up does not jitter sideways (canvas has no font-variant-numeric).
 */
function tabular(ctx: CanvasRenderingContext2D, s: string, x: number, y: number, px: number, color: string, weight = 700, align: 'left' | 'center' = 'left') {
  ctx.font = font(px, weight)
  ctx.fillStyle = color
  ctx.textBaseline = 'middle'
  ctx.textAlign = 'left'
  const adv = ctx.measureText('0').width
  const widths = [...s].map((ch) => (/[0-9]/.test(ch) ? adv : ctx.measureText(ch).width))
  const total = widths.reduce((a, b) => a + b, 0)
  let cx = align === 'center' ? x - total / 2 : x
  ;[...s].forEach((ch, i) => {
    const off = /[0-9]/.test(ch) ? (adv - ctx.measureText(ch).width) / 2 : 0
    ctx.fillText(ch, cx + off, y)
    cx += widths[i]
  })
}

/**
 * Tick a number string up to its value, keeping prefix/suffix and separators:
 * "$400M" → "$0M" … "$400M"; "¥22,800" keeps the comma. Non-numeric strings
 * are returned unchanged (never invents a number).
 */
export function tickNumber(value: string, k: number): string {
  const m = /^(\D*?)([\d,]*\.?\d+)(.*)$/.exec(value)
  if (!m) return value
  const raw = m[2].replace(/,/g, '')
  const target = Number(raw)
  if (!Number.isFinite(target)) return value
  const decimals = raw.includes('.') ? raw.split('.')[1].length : 0
  const cur = target * clamp01(k)
  let body = decimals ? cur.toFixed(decimals) : String(Math.round(cur))
  if (m[2].includes(',')) body = body.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  return m[1] + body + m[3]
}

/* ——— scrim (2.14 for kit text over photos) ——— */

function scrim(ctx: CanvasRenderingContext2D, clip: StudioKitClip, x: number, y: number, w: number, h: number, hasPhoto: boolean) {
  const strength = clip.scrim === null || clip.scrim === undefined ? (hasPhoto ? 0.55 : 0) : clamp01(clip.scrim)
  if (strength <= 0) return
  const g = ctx.createLinearGradient(0, y, 0, y + h)
  g.addColorStop(0, rgba(VIDEO_TOKENS.ink, 0))
  g.addColorStop(1, rgba(VIDEO_TOKENS.ink, strength))
  ctx.fillStyle = g
  ctx.fillRect(x, y, w, h)
}

/* ——— media ——— */

export type KitMediaLookup = (media: NonNullable<StudioKitMedia>) => CanvasImageSource | null

function sourceSize(src: CanvasImageSource): [number, number] {
  const s = src as { videoWidth?: number; videoHeight?: number; naturalWidth?: number; naturalHeight?: number; width?: number | { baseVal?: { value: number } }; height?: number | { baseVal?: { value: number } } }
  const w = s.videoWidth || s.naturalWidth || (typeof s.width === 'number' ? s.width : 0) || 1
  const h = s.videoHeight || s.naturalHeight || (typeof s.height === 'number' ? s.height : 0) || 1
  return [w, h]
}
function drawCover(ctx: CanvasRenderingContext2D, src: CanvasImageSource, x: number, y: number, w: number, h: number, zoom = 1) {
  const [sw, sh] = sourceSize(src)
  const k = Math.max(w / sw, h / sh) * zoom
  const dw = sw * k, dh = sh * k
  ctx.drawImage(src, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh)
}
function dropSlot(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number, s: Surf) {
  fillRR(ctx, x, y, w, h, r, s.panelAlt)
  ctx.save()
  ctx.strokeStyle = s.muted
  ctx.setLineDash([Math.max(2, w * 0.02), Math.max(2, w * 0.015)])
  ctx.lineWidth = Math.max(1, w * 0.006)
  rr(ctx, x + 1, y + 1, w - 2, h - 2, r)
  ctx.stroke()
  ctx.setLineDash([])
  ctx.restore()
  text(ctx, 'drop media here', x + w / 2, y + h / 2, Math.max(8, Math.min(w, h) * 0.08), s.muted, 600, 'center', SANS, w * 0.9)
}

/* ——— normalise ——— */

const str = (v: unknown, fb: string, max = 160) => (typeof v === 'string' ? v.slice(0, max) : fb)
const num = (v: unknown, fb: number, lo: number, hi: number) => (typeof v === 'number' && Number.isFinite(v) ? clamp(v, lo, hi) : fb)

/** Fill every missing/invalid field so partial, agent-made or hand-edited kit clips still draw. */
export function normaliseKit(clip: Partial<StudioKitClip> & { id?: string }): StudioKitClip {
  const kit: StudioKitKind = isKitKind(clip.kit) ? clip.kit : 'stat-card'
  const accent = typeof clip.accent === 'string' && ALLOWED_ACCENTS.has(clip.accent.toUpperCase()) ? clip.accent.toUpperCase() : CORE_TOKENS.danger
  const variants = KIT_KINDS.find((k) => k.id === kit)!.variants
  return {
    id: String(clip.id ?? `kit-${kit}`),
    kind: 'kit',
    kit,
    variant: typeof clip.variant === 'string' && variants.includes(clip.variant) ? clip.variant : variants[0],
    track: num(clip.track, 1, 0, 99),
    startSec: num(clip.startSec, 0, 0, 36000),
    durationSec: num(clip.durationSec, 4, 0.1, 36000),
    name: str(clip.name, KIT_KINDS.find((k) => k.id === kit)!.name, 80),
    transitionIn: clip.transitionIn ?? 'none',
    transitionOut: clip.transitionOut ?? 'none',
    opacity: num(clip.opacity, 1, 0, 1),
    rotation: clip.rotation,
    keyframes: clip.keyframes ?? null,
    groupId: clip.groupId,
    x: num(clip.x, 0.5, -1, 2),
    y: num(clip.y, 0.5, -1, 2),
    w: num(clip.w, 0.4, 0.02, 3),
    seed: Math.round(num(clip.seed, 1, 0, 2 ** 31)),
    reducedMotion: clip.reducedMotion === true,
    scrim: clip.scrim === null || clip.scrim === undefined ? null : num(clip.scrim, 0.55, 0, 1),
    theme: clip.theme === 'dark' ? 'dark' : 'light',
    accent,
    title: clip.title === undefined ? undefined : str(clip.title, ''),
    subtitle: clip.subtitle === undefined ? undefined : str(clip.subtitle, ''),
    eyebrow: clip.eyebrow === undefined ? undefined : str(clip.eyebrow, ''),
    url: clip.url === undefined ? undefined : str(clip.url, ''),
    items: Array.isArray(clip.items) ? clip.items.slice(0, 16).map((s) => str(s, '', 120)) : undefined,
    values: Array.isArray(clip.values) ? clip.values.slice(0, 16).map((v) => num(v, 0, -1e9, 1e9)) : undefined,
    media: Array.isArray(clip.media) ? clip.media.slice(0, 8).map((m) => (m && typeof m === 'object' && typeof m.mediaId === 'string' ? { mediaId: m.mediaId, fileName: str(m.fileName, '', 200) } : null)) : undefined,
    active: clip.active === undefined ? undefined : Math.round(num(clip.active, 0, -1, 15)),
    fromX: clip.fromX === undefined ? undefined : num(clip.fromX, 0.2, -1, 2),
    fromY: clip.fromY === undefined ? undefined : num(clip.fromY, 0.8, -1, 2),
    clickAt: clip.clickAt === undefined ? undefined : num(clip.clickAt, 0.6, 0, 1),
  }
}

/* ——— draw ——— */

/**
 * Draw one kit clip at timeline time `t`. Pure: same inputs → same calls.
 * The caller (renderer) has already applied clip opacity, rotation and
 * keyframes (position/scale/rotation/opacity animate like every other clip).
 */
export function drawKit(ctx: CanvasRenderingContext2D, clip: StudioKitClip, t: number, width: number, height: number, media?: KitMediaLookup) {
  const { e, p } = cycleAt(clip, t)
  const W = clip.w * width
  const H = W * kitAspect(clip.kit, clip.variant)
  const x0 = clip.x * width - W / 2
  const y0 = clip.y * height - H / 2
  const s = surfaces(clip.theme)
  // Reduced motion: final layout, opacity-only fade over the first 200 ms.
  const rm = clip.reducedMotion
  const E = rm ? Math.max(e, 1e3) : e
  ctx.save()
  if (rm) ctx.globalAlpha *= soft(win(e, 0, 0.2))
  const box = { x0, y0, W, H, e: E, p: rm ? 1 : p, s, media, width, height }
  switch (clip.kit) {
    case 'cursor-zoom': drawCursorZoom(ctx, clip, box); break
    case 'pill-text': drawPillText(ctx, clip, box); break
    case 'stat-card': drawStatCard(ctx, clip, box); break
    case 'rating-bars': drawRatingBars(ctx, clip, box); break
    case 'image-stack': drawImageStack(ctx, clip, box); break
    case 'browser-mockup': drawBrowser(ctx, clip, box); break
    case 'checkout-card': drawCheckout(ctx, clip, box); break
    case 'block-row-3d': drawBlockRow(ctx, clip, box); break
  }
  ctx.restore()
}

type Box = { x0: number; y0: number; W: number; H: number; e: number; p: number; s: Surf; media?: KitMediaLookup; width: number; height: number }

/* cursor-zoom — the ripple and arrow; the zoom itself is a scale keyframe on the target clip (see homeVideos.ts). */
function drawCursorZoom(ctx: CanvasRenderingContext2D, clip: StudioKitClip, b: Box) {
  const clickAt = clip.clickAt ?? 0.6
  const fx = (clip.fromX ?? 0.2) * b.width, fy = (clip.fromY ?? 0.8) * b.height
  const tx = clip.x * b.width, ty = clip.y * b.height
  const move = soft(clamp01(b.p / Math.max(0.05, clickAt - 0.04)))
  const cx = fx + (tx - fx) * move, cy = fy + (ty - fy) * move
  const size = b.W * 0.12
  const rip = b.p - clickAt
  if (rip >= 0 && rip < 0.25) {
    const k = soft(rip / 0.25)
    ctx.beginPath()
    ctx.arc(tx, ty, size * (0.3 + 1.4 * k), 0, Math.PI * 2)
    ctx.fillStyle = rgba(clip.accent, 0.35 * (1 - k))
    ctx.fill()
  }
  const press = rip >= 0 && rip < 0.06 ? 0.9 : 1
  ctx.save()
  ctx.translate(cx, cy)
  ctx.scale(press, press)
  ctx.beginPath()
  ctx.moveTo(0, 0)
  ctx.lineTo(0, size)
  ctx.lineTo(size * 0.27, size * 0.76)
  ctx.lineTo(size * 0.47, size * 1.12)
  ctx.lineTo(size * 0.62, size * 1.04)
  ctx.lineTo(size * 0.43, size * 0.7)
  ctx.lineTo(size * 0.74, size * 0.7)
  ctx.closePath()
  ctx.fillStyle = VIDEO_TOKENS.ink
  ctx.fill()
  ctx.lineWidth = Math.max(1, size * 0.07)
  ctx.strokeStyle = CORE_TOKENS.lightPanel
  ctx.stroke()
  ctx.restore()
}

/** Split "connect [with] over [+]" into plain and pill runs. */
export function pillRuns(s: string): Array<{ text: string; pill: boolean }> {
  const out: Array<{ text: string; pill: boolean }> = []
  const re = /\[([^\]]*)\]/g
  let last = 0, m: RegExpExecArray | null
  while ((m = re.exec(s))) {
    if (m.index > last) out.push({ text: s.slice(last, m.index), pill: false })
    out.push({ text: m[1], pill: true })
    last = m.index + m[0].length
  }
  if (last < s.length) out.push({ text: s.slice(last), pill: false })
  return out.filter((r) => r.text.length)
}

function shareIcon(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, color: string) {
  const pts: Array<[number, number]> = [[cx - r * 0.45, cy], [cx + r * 0.4, cy - r * 0.45], [cx + r * 0.4, cy + r * 0.45]]
  ctx.strokeStyle = color
  ctx.lineWidth = Math.max(1, r * 0.14)
  ctx.beginPath()
  ctx.moveTo(pts[1][0], pts[1][1]); ctx.lineTo(pts[0][0], pts[0][1]); ctx.lineTo(pts[2][0], pts[2][1])
  ctx.stroke()
  ctx.fillStyle = color
  for (const [px, py] of pts) { ctx.beginPath(); ctx.arc(px, py, r * 0.2, 0, Math.PI * 2); ctx.fill() }
}

function drawPillText(ctx: CanvasRenderingContext2D, clip: StudioKitClip, b: Box) {
  const v = clip.variant
  if (v === 'checklist') return drawChecklist(ctx, clip, b)
  if (v === 'chips') return drawChips(ctx, clip, b)
  const runs = pillRuns(clip.title ?? 'connect [with] over [+]')
  const px0 = b.H * 0.5
  // Fit the whole line to the box.
  const measure = (px: number) => {
    ctx.font = font(px, 600)
    return runs.reduce((a, r) => a + (r.pill ? (r.text === '+' ? px * 1.3 : ctx.measureText(r.text).width + px * 0.9) + px * 0.25 : ctx.measureText(r.text).width), 0)
  }
  let px = px0
  const total0 = measure(px)
  if (total0 > b.W) px = px0 * (b.W / total0)
  const total = measure(px)
  let cx = b.x0 + (b.W - total) / 2
  const cy = b.y0 + b.H / 2
  let pillIndex = 0
  for (const r of runs) {
    ctx.font = font(px, 600)
    if (!r.pill) {
      const k = soft(win(b.e, 0, 0.35))
      text(ctx, r.text, cx, cy + (1 - k) * px * 0.3, px, b.s.text, 600)
      cx += ctx.measureText(r.text).width
      continue
    }
    const isIcon = r.text === '+'
    const pw = isIcon ? px * 1.3 : ctx.measureText(r.text).width + px * 0.9
    const ph = px * 1.3
    const k = win(b.e, 0.2 + pillIndex * 0.12, 0.35)
    const scale = 0.96 + 0.04 * spring(k) // the one allowed spring
    ctx.save()
    ctx.globalAlpha *= clamp01(k * 3)
    ctx.translate(cx + px * 0.125 + pw / 2, cy)
    ctx.scale(scale, scale)
    fillRR(ctx, -pw / 2, -ph / 2, pw, ph, ph / 2, clip.accent)
    if (isIcon) shareIcon(ctx, 0, 0, ph * 0.32, CORE_TOKENS.lightPanel)
    else text(ctx, r.text, 0, 0, px, CORE_TOKENS.lightPanel, 600, 'center')
    ctx.restore()
    cx += pw + px * 0.25
    pillIndex++
  }
}

function drawChecklist(ctx: CanvasRenderingContext2D, clip: StudioKitClip, b: Box) {
  const items = clip.items?.length ? clip.items : ['Add your first task', 'Add your second task', 'Add your third task', 'Your active task']
  const active = clip.active ?? items.length - 1
  const rowH = b.H / items.length
  const px = rowH * 0.42
  items.forEach((it, i) => {
    const y = b.y0 + rowH * (i + 0.5)
    const k = soft(win(b.e, i * 0.08, 0.3))
    const isActive = i === active
    const heat = isActive ? soft(win(b.e, 0.6, 0.4)) : 0 // crossfade gray → red
    ctx.save()
    ctx.globalAlpha *= k
    const color = mix(b.s.muted, clip.accent, heat)
    text(ctx, it, b.x0 + (1 - k) * -b.W * 0.04, y, px, color, isActive ? 700 : 500, 'left', SANS, b.W)
    if (isActive && heat > 0) {
      ctx.font = font(px, 700)
      const tw = Math.min(b.W, ctx.measureText(it).width)
      ctx.fillStyle = clip.accent
      ctx.fillRect(b.x0, y + px * 0.7, tw * heat, Math.max(1, px * 0.08))
    }
    ctx.restore()
  })
}

function drawChips(ctx: CanvasRenderingContext2D, clip: StudioKitClip, b: Box) {
  const items = clip.items?.length ? clip.items : ['USD', 'EUR', 'GBP', 'JPY']
  const active = clip.active ?? items.length - 1
  const gap = b.W * 0.03
  const cw = (b.W - gap * (items.length - 1)) / items.length
  const px = b.H * 0.4
  items.forEach((it, i) => {
    const x = b.x0 + i * (cw + gap)
    const k = soft(win(b.e, i * 0.06, 0.3))
    const isActive = i === active
    const pop = isActive ? win(b.e, 0.5, 0.35) : 1
    const scale = isActive ? 0.96 + 0.04 * spring(pop) : 1
    ctx.save()
    ctx.globalAlpha *= k
    ctx.translate(x + cw / 2, b.y0 + b.H / 2)
    ctx.scale(scale, scale)
    const on = isActive && pop > 0
    fillRR(ctx, -cw / 2, -b.H / 2, cw, b.H, b.H / 2, on ? clip.accent : b.s.panel)
    if (!on) { ctx.strokeStyle = b.s.line; ctx.lineWidth = 1; rr(ctx, -cw / 2, -b.H / 2, cw, b.H, b.H / 2); ctx.stroke() }
    text(ctx, it, 0, 0, px, on ? CORE_TOKENS.lightPanel : b.s.text, 600, 'center', SANS, cw * 0.9)
    ctx.restore()
  })
}

function drawStatCard(ctx: CanvasRenderingContext2D, clip: StudioKitClip, b: Box) {
  const k = soft(win(b.e, 0, 0.4))
  const r = b.W * 0.06
  ctx.save()
  ctx.globalAlpha *= k
  ctx.translate(0, (1 - k) * b.H * 0.12)
  if (clip.variant === 'price') {
    const fill = clip.accent
    fillRR(ctx, b.x0, b.y0, b.W, b.H, r, fill)
    const pad = b.W * 0.09
    text(ctx, clip.eyebrow ?? '// item 01', b.x0 + pad, b.y0 + pad + b.W * 0.04, b.W * 0.07, rgba(VIDEO_TOKENS.ink, 0.6), 500, 'left', MONO, b.W - pad * 2)
    // Simple line-art icon slot (laptop/books/camera are chosen by `subtitle`).
    drawGlyph(ctx, clip.subtitle ?? '', b.x0 + b.W / 2, b.y0 + b.H * 0.42, b.W * 0.22, VIDEO_TOKENS.ink)
    text(ctx, clip.title ?? 'Item', b.x0 + pad, b.y0 + b.H * 0.74, b.W * 0.1, VIDEO_TOKENS.ink, 700, 'left', SANS, b.W - pad * 2)
    const price = tickNumber(clip.items?.[0] ?? '', soft(win(b.e, 0.3, 0.8)))
    if (price) tabular(ctx, price, b.x0 + pad, b.y0 + b.H * 0.87, b.W * 0.12, VIDEO_TOKENS.ink, 800)
    ctx.restore()
    return
  }
  const active = (clip.active ?? 0) === 1
  const base = active ? mix(b.s.panel, VIDEO_TOKENS.green, 0.14) : b.s.panel
  fillRR(ctx, b.x0, b.y0, b.W, b.H, r, base)
  ctx.strokeStyle = active ? rgba(VIDEO_TOKENS.green, 0.5) : b.s.line
  ctx.lineWidth = Math.max(1, b.W * 0.004)
  rr(ctx, b.x0, b.y0, b.W, b.H, r)
  ctx.stroke()
  const pad = b.W * 0.07
  const value = clip.title ?? ''
  const shown = tickNumber(value, soft(win(b.e, 0.15, 0.9)))
  const px = fitFontPx(ctx, value || '0', b.H * 0.42, b.W - pad * 2, 800)
  if (shown) tabular(ctx, shown, b.x0 + pad, b.y0 + b.H * 0.4, px, active ? VIDEO_TOKENS.green : b.s.text, 800)
  text(ctx, clip.subtitle ?? '', b.x0 + pad, b.y0 + b.H * 0.76, b.H * 0.14, b.s.muted, 500, 'left', SANS, b.W - pad * 2)
  ctx.restore()
}

/** Minimal line icons for price cards; unknown names draw a neutral square. */
function drawGlyph(ctx: CanvasRenderingContext2D, name: string, cx: number, cy: number, sz: number, color: string) {
  ctx.save()
  ctx.strokeStyle = color
  ctx.lineWidth = Math.max(1, sz * 0.07)
  ctx.lineJoin = 'round'
  const n = name.toLowerCase()
  ctx.beginPath()
  if (n.includes('laptop')) {
    rr(ctx, cx - sz * 0.4, cy - sz * 0.35, sz * 0.8, sz * 0.5, sz * 0.05)
    ctx.moveTo(cx - sz * 0.55, cy + sz * 0.25); ctx.lineTo(cx + sz * 0.55, cy + sz * 0.25)
  } else if (n.includes('book')) {
    ctx.rect(cx - sz * 0.45, cy - sz * 0.35, sz * 0.25, sz * 0.7)
    ctx.rect(cx - sz * 0.15, cy - sz * 0.35, sz * 0.25, sz * 0.7)
    ctx.moveTo(cx + sz * 0.2, cy - sz * 0.3); ctx.lineTo(cx + sz * 0.45, cy + sz * 0.35)
  } else if (n.includes('camera')) {
    rr(ctx, cx - sz * 0.45, cy - sz * 0.25, sz * 0.9, sz * 0.6, sz * 0.08)
    ctx.moveTo(cx + sz * 0.15, cy + sz * 0.05); ctx.arc(cx, cy + sz * 0.05, sz * 0.15, 0, Math.PI * 2)
  } else {
    rr(ctx, cx - sz * 0.35, cy - sz * 0.35, sz * 0.7, sz * 0.7, sz * 0.1)
  }
  ctx.stroke()
  ctx.restore()
}

function drawRatingBars(ctx: CanvasRenderingContext2D, clip: StudioKitClip, b: Box) {
  const labels = clip.items?.length ? clip.items : ['Hook', 'Clarity', 'Voice', 'Timing', 'Reach']
  const values = labels.map((_, i) => clamp(clip.values?.[i] ?? 0, 0, 100))
  const r = b.W * 0.05
  const k = soft(win(b.e, 0, 0.4))
  ctx.save()
  ctx.globalAlpha *= k
  ctx.translate(0, (1 - k) * b.H * 0.1) // panel slides up
  fillRR(ctx, b.x0, b.y0, b.W, b.H, r, b.s.panel)
  const pad = b.W * 0.08
  text(ctx, clip.title ?? 'RATING', b.x0 + pad, b.y0 + pad + b.H * 0.03, b.H * 0.06, b.s.muted, 700, 'left', MONO, b.W - pad * 2)
  const top = b.y0 + b.H * 0.2
  const rowH = (b.H * 0.75) / labels.length
  labels.forEach((label, i) => {
    const y = top + rowH * i
    const fill = soft(win(b.e, 0.3 + i * 0.08, 0.9))
    text(ctx, label, b.x0 + pad, y + rowH * 0.3, rowH * 0.26, b.s.text, 600, 'left', SANS, b.W * 0.6)
    tabular(ctx, `${Math.round(values[i] * fill)}%`, b.x0 + b.W - pad - b.W * 0.14, y + rowH * 0.3, rowH * 0.26, b.s.text, 700)
    const bw = b.W - pad * 2, bh = rowH * 0.16
    fillRR(ctx, b.x0 + pad, y + rowH * 0.62, bw, bh, bh / 2, b.s.panelAlt)
    if (values[i] > 0) fillRR(ctx, b.x0 + pad, y + rowH * 0.62, Math.max(bh, bw * (values[i] / 100) * fill), bh, bh / 2, clip.accent)
  })
  ctx.restore()
}

/** Deterministic overlap/rotation layout for 1–8 slots, kept inside the box. */
export function stackLayout(count: number, seed: number, W: number, H: number): Array<{ x: number; y: number; w: number; h: number; rot: number; depth: number }> {
  const n = clamp(Math.round(count), 1, 8)
  const rnd = mulberry32(seed)
  const cw = n === 1 ? W : W / Math.min(n, 4) * 1.15
  const ch = n === 1 ? H : cw * 0.75
  const rows = n > 4 ? 2 : 1
  const out: Array<{ x: number; y: number; w: number; h: number; rot: number; depth: number }> = []
  for (let i = 0; i < n; i++) {
    const row = rows === 2 ? (i < Math.ceil(n / 2) ? 0 : 1) : 0
    const inRow = rows === 2 ? (row === 0 ? Math.ceil(n / 2) : n - Math.ceil(n / 2)) : n
    const col = rows === 2 && row === 1 ? i - Math.ceil(n / 2) : i
    const span = W - Math.min(W, cw)
    const x = inRow === 1 ? W / 2 : Math.min(W, cw) / 2 + (span * col) / (inRow - 1)
    const y = rows === 2 ? (row === 0 ? H * 0.32 : H * 0.68) : H / 2
    const rot = n === 1 ? 0 : (rnd() - 0.5) * 10 // degrees, within bounds
    const jitterY = n === 1 ? 0 : (rnd() - 0.5) * H * 0.06
    const w = Math.min(cw, W), h = Math.min(ch, H * (rows === 2 ? 0.55 : 0.9))
    out.push({ x: clamp(x, w / 2, W - w / 2), y: clamp(y + jitterY, h / 2, H - h / 2), w, h, rot, depth: rnd() })
  }
  return out
}

function drawImageStack(ctx: CanvasRenderingContext2D, clip: StudioKitClip, b: Box) {
  const slots: StudioKitMedia[] = clip.media?.length ? clip.media : clip.variant === 'stack' ? [null, null, null] : [null]
  const n = clip.variant === 'stack' ? clamp(slots.length, 2, 8) : 1
  const layout = stackLayout(n, clip.seed, b.W, b.H)
  const r = b.W * 0.025
  layout.forEach((cell, i) => {
    const m = slots[i] ?? null
    const k = soft(win(b.e, i * 0.06, 0.6)) // 60 ms stagger
    const src = m && b.media ? b.media(m) : null
    ctx.save()
    ctx.globalAlpha *= k
    ctx.translate(b.x0 + cell.x, b.y0 + cell.y - (1 - k) * b.H * 0.35)
    ctx.rotate(((cell.rot + (1 - k) * 8) * Math.PI) / 180)
    // Depth blur for the back cards of a stack (subtle; never on single/landscape).
    if (clip.variant === 'stack' && cell.depth < 0.35 && !clip.reducedMotion) ctx.filter = `blur(${Math.round(b.W * 0.004)}px)`
    ctx.save()
    rr(ctx, -cell.w / 2, -cell.h / 2, cell.w, cell.h, r)
    ctx.clip()
    if (src) {
      // Parallax push-in (subtle): 1 → 1.06 over the clip.
      const zoom = clip.variant === 'landscape' ? 1 + 0.06 * soft(b.p) : 1
      drawCover(ctx, src, -cell.w / 2, -cell.h / 2, cell.w, cell.h, zoom)
    } else {
      dropSlot(ctx, -cell.w / 2, -cell.h / 2, cell.w, cell.h, r, b.s)
    }
    if (clip.title && (clip.variant !== 'stack' || i === n - 1)) {
      scrim(ctx, clip, -cell.w / 2, 0, cell.w, cell.h / 2, !!src)
      const px = fitFontPx(ctx, clip.title, cell.h * 0.09, cell.w * 0.84, 700)
      text(ctx, clip.title, -cell.w / 2 + cell.w * 0.08, cell.h * 0.34, px, src ? CORE_TOKENS.lightPanel : b.s.text, 700, 'left', SANS, cell.w * 0.84)
    }
    ctx.restore()
    ctx.filter = 'none'
    ctx.restore()
  })
}

function chrome(ctx: CanvasRenderingContext2D, b: Box, url: string, r: number): number {
  const barH = b.H * 0.075
  fillRR(ctx, b.x0, b.y0, b.W, b.H, r, b.s.panel)
  ctx.save()
  rr(ctx, b.x0, b.y0, b.W, b.H, r)
  ctx.clip()
  ctx.fillStyle = b.s.panelAlt
  ctx.fillRect(b.x0, b.y0, b.W, barH)
  ctx.restore()
  const dot = barH * 0.16
  ;[CORE_TOKENS.danger, CORE_TOKENS.muted, CORE_TOKENS.accent].forEach((c, i) => {
    ctx.beginPath()
    ctx.arc(b.x0 + barH * 0.5 + i * dot * 3, b.y0 + barH / 2, dot, 0, Math.PI * 2)
    ctx.fillStyle = c
    ctx.fill()
  })
  const uw = b.W * 0.4
  fillRR(ctx, b.x0 + (b.W - uw) / 2, b.y0 + barH * 0.2, uw, barH * 0.6, barH * 0.3, b.s.panel)
  text(ctx, url, b.x0 + b.W / 2, b.y0 + barH / 2, barH * 0.32, b.s.muted, 500, 'center', SANS, uw * 0.9)
  return barH
}

function drawBrowser(ctx: CanvasRenderingContext2D, clip: StudioKitClip, b: Box) {
  const r = b.W * 0.02
  const k = soft(win(b.e, 0, 0.2))
  ctx.save()
  ctx.globalAlpha *= k
  if (clip.variant === 'saas') { drawSaasHome(ctx, clip, b, r); ctx.restore(); return }
  if (clip.variant === 'composer') { drawComposer(ctx, clip, b, r); ctx.restore(); return }
  const barH = chrome(ctx, b, clip.url ?? 'app.example.com', r)
  const top = b.y0 + barH
  const sideW = b.W * 0.2
  ctx.fillStyle = b.s.panelAlt
  ctx.fillRect(b.x0, top, sideW, b.H - barH - r)
  const nav = clip.items?.length ? clip.items : ['New task', 'Search', 'Plugins', 'Scheduled', 'Assets', 'Connect mobile', 'Settings', 'Usage']
  const rowH = Math.min(b.H * 0.07, (b.H - barH) / (nav.length + 1))
  nav.forEach((n, i) => {
    const y = top + rowH * (i + 1)
    if (i === (clip.active ?? 0)) fillRR(ctx, b.x0 + sideW * 0.06, y - rowH * 0.4, sideW * 0.88, rowH * 0.8, rowH * 0.2, b.s.panel)
    text(ctx, n, b.x0 + sideW * 0.14, y, rowH * 0.36, i === (clip.active ?? 0) ? b.s.text : b.s.muted, 500, 'left', SANS, sideW * 0.8)
  })
  // Centre: "Thinking…" bubble with three dots cycling (pure of time).
  const cx = b.x0 + sideW + (b.W * 0.55) / 2
  const bw = b.W * 0.26, bh = b.H * 0.09
  const by = top + (b.H - barH) * 0.35
  const bk = soft(win(b.e, 0.25, 0.3))
  ctx.save()
  ctx.globalAlpha *= bk
  fillRR(ctx, cx - bw / 2, by, bw, bh, bh / 2, b.s.panelAlt)
  const label = clip.title ?? 'Thinking'
  text(ctx, label, cx - bw * 0.1, by + bh / 2, bh * 0.36, b.s.text, 500, 'center', SANS, bw * 0.6)
  for (let i = 0; i < 3; i++) {
    const phase = (b.e * 1.6 - i * 0.2) % 1
    const a = 0.3 + 0.7 * Math.max(0, Math.sin(Math.PI * clamp01(phase)))
    ctx.beginPath()
    ctx.arc(cx + bw * 0.25 + i * bh * 0.22, by + bh / 2, bh * 0.07, 0, Math.PI * 2)
    ctx.fillStyle = rgba(b.s.text === CORE_TOKENS.text ? CORE_TOKENS.text : CORE_TOKENS.lightText, clip.reducedMotion ? 0.8 : a)
    ctx.fill()
  }
  ctx.restore()
  // Right: Progress panel.
  const px0 = b.x0 + b.W * 0.77, pw = b.W * 0.2
  const py0 = top + b.H * 0.04
  fillRR(ctx, px0, py0, pw, b.H * 0.4, r, b.s.panelAlt)
  text(ctx, clip.subtitle ?? 'Progress', px0 + pw * 0.08, py0 + b.H * 0.04, b.H * 0.03, b.s.text, 700, 'left', SANS, pw * 0.8)
  const steps = clip.values?.length ?? 3
  for (let i = 0; i < steps; i++) {
    const y = py0 + b.H * (0.1 + i * 0.08)
    const f = soft(win(b.e, 0.5 + i * 0.5, 0.8))
    fillRR(ctx, px0 + pw * 0.08, y, pw * 0.84, b.H * 0.018, b.H * 0.009, b.s.panel)
    fillRR(ctx, px0 + pw * 0.08, y, Math.max(b.H * 0.018, pw * 0.84 * f), b.H * 0.018, b.H * 0.009, clip.accent)
  }
  ctx.restore()
}

function drawSaasHome(ctx: CanvasRenderingContext2D, clip: StudioKitClip, b: Box, r: number) {
  fillRR(ctx, b.x0, b.y0, b.W, b.H, r, b.s.panel)
  const main = b.W * 0.68
  const title = clip.title ?? 'makes your work easier'
  const px = fitFontPx(ctx, title, b.H * 0.09, main * 0.9, 700)
  const tk = soft(win(b.e, 0.1, 0.35))
  ctx.save(); ctx.globalAlpha *= tk
  text(ctx, title, b.x0 + main / 2, b.y0 + b.H * 0.26 + (1 - tk) * b.H * 0.03, px, b.s.text, 700, 'center')
  ctx.restore()
  const iw = main * 0.8, ih = b.H * 0.13
  const ix = b.x0 + (main - iw) / 2, iy = b.y0 + b.H * 0.4
  fillRR(ctx, ix, iy, iw, ih, ih / 2, b.s.panelAlt)
  text(ctx, clip.subtitle ?? 'Enter message…', ix + ih * 0.5, iy + ih / 2, ih * 0.3, b.s.muted, 500, 'left', SANS, iw * 0.6)
  const dw = iw * 0.22
  fillRR(ctx, ix + iw - dw - ih * 0.15, iy + ih * 0.18, dw, ih * 0.64, ih * 0.32, b.s.panel)
  text(ctx, clip.eyebrow ?? 'Model', ix + iw - dw / 2 - ih * 0.15, iy + ih / 2, ih * 0.26, b.s.text, 600, 'center', SANS, dw * 0.9)
  const chips = clip.items?.length ? clip.items : ['Video generation', 'Document', 'Website']
  ctx.font = font(ih * 0.26, 500)
  const cws = chips.map((c) => ctx.measureText(c).width + ih * 0.6)
  const totalW = cws.reduce((a, c) => a + c, 0) + ih * 0.2 * (chips.length - 1)
  let cx = b.x0 + (main - Math.min(totalW, iw)) / 2
  chips.forEach((c, i) => {
    const k = soft(win(b.e, 0.3 + i * 0.06, 0.3))
    ctx.save(); ctx.globalAlpha *= k
    fillRR(ctx, cx, iy + ih * 1.35, cws[i], ih * 0.6, ih * 0.3, b.s.panelAlt)
    text(ctx, c, cx + cws[i] / 2, iy + ih * 1.65, ih * 0.26, b.s.text, 500, 'center')
    ctx.restore()
    cx += cws[i] + ih * 0.2
  })
  // Side card: app icon + Download button.
  const sx = b.x0 + main + b.W * 0.02, sw = b.W - main - b.W * 0.05
  const sy = b.y0 + b.H * 0.3, sh = b.H * 0.4
  const sk = soft(win(b.e, 0.45, 0.35))
  ctx.save(); ctx.globalAlpha *= sk; ctx.translate((1 - sk) * b.W * 0.03, 0)
  fillRR(ctx, sx, sy, sw, sh, r, b.s.panelAlt)
  fillRR(ctx, sx + sw / 2 - sh * 0.15, sy + sh * 0.14, sh * 0.3, sh * 0.3, sh * 0.08, clip.accent)
  text(ctx, clip.url ?? 'Desktop app', sx + sw / 2, sy + sh * 0.58, sh * 0.08, b.s.text, 600, 'center', SANS, sw * 0.9)
  fillRR(ctx, sx + sw * 0.15, sy + sh * 0.7, sw * 0.7, sh * 0.16, sh * 0.08, b.s.text)
  text(ctx, 'Download', sx + sw / 2, sy + sh * 0.78, sh * 0.07, b.s.panel, 600, 'center', SANS, sw * 0.6)
  ctx.restore()
}

function drawComposer(ctx: CanvasRenderingContext2D, clip: StudioKitClip, b: Box, r: number) {
  const k = soft(win(b.e, 0, 0.4))
  ctx.translate(0, (1 - k) * b.H * 0.08)
  fillRR(ctx, b.x0, b.y0, b.W, b.H, r * 2, b.s.panel)
  const pad = b.W * 0.06
  ctx.beginPath()
  ctx.arc(b.x0 + pad + b.H * 0.05, b.y0 + pad + b.H * 0.05, b.H * 0.05, 0, Math.PI * 2)
  ctx.fillStyle = clip.accent
  ctx.fill()
  text(ctx, clip.title ?? 'Your name', b.x0 + pad + b.H * 0.14, b.y0 + pad + b.H * 0.05, b.H * 0.045, b.s.text, 700, 'left', SANS, b.W * 0.5)
  const lines = clip.items?.length ? clip.items : ['Write your post here.', 'Cupric fills this from your brief.', '']
  lines.slice(0, 3).forEach((l, i) => {
    const lk = soft(win(b.e, 0.2 + i * 0.1, 0.35))
    ctx.save(); ctx.globalAlpha *= lk
    text(ctx, l, b.x0 + pad, b.y0 + b.H * (0.34 + i * 0.1), b.H * 0.05, b.s.text, 500, 'left', SANS, b.W - pad * 2)
    ctx.restore()
  })
  const ready = clip.subtitle ?? 'Ready to post'
  const rk = soft(win(b.e, 0.8, 0.3))
  ctx.save(); ctx.globalAlpha *= rk
  ctx.font = font(b.H * 0.04, 600)
  const rw = ctx.measureText(ready).width + b.H * 0.08
  fillRR(ctx, b.x0 + pad, b.y0 + b.H * 0.66, rw, b.H * 0.075, b.H * 0.0375, VIDEO_TOKENS.mint)
  text(ctx, ready, b.x0 + pad + rw / 2, b.y0 + b.H * 0.6975, b.H * 0.04, VIDEO_TOKENS.green, 600, 'center')
  ctx.restore()
  const buttons = ['Save', 'Posted', 'Schedule', 'Post']
  const bw = (b.W - pad * 2 - b.W * 0.03 * 3) / 4
  buttons.forEach((label, i) => {
    const x = b.x0 + pad + i * (bw + b.W * 0.03)
    const primary = i === buttons.length - 1
    fillRR(ctx, x, b.y0 + b.H * 0.82, bw, b.H * 0.1, b.H * 0.05, primary ? clip.accent : b.s.panelAlt)
    text(ctx, label, x + bw / 2, b.y0 + b.H * 0.87, b.H * 0.042, primary ? CORE_TOKENS.lightPanel : b.s.text, 600, 'center', SANS, bw * 0.9)
  })
}

function drawCheckout(ctx: CanvasRenderingContext2D, clip: StudioKitClip, b: Box) {
  const r = b.W * 0.025
  const k = soft(win(b.e, 0, 0.4))
  ctx.save()
  ctx.globalAlpha *= k
  ctx.translate((1 - k) * b.W * 0.06, 0) // panel slide
  const barH = chrome(ctx, b, clip.url ?? 'store.example.com', r)
  const pad = b.W * 0.06
  const colW = (b.W - pad * 3) / 2
  const lx = b.x0 + pad, rx = lx + colW + pad
  let y = b.y0 + barH + b.H * 0.07
  // Left: product + summary. Values are the user's (no invented prices).
  text(ctx, clip.title ?? 'Product', lx, y, b.H * 0.04, b.s.muted, 500, 'left', SANS, colW)
  const price = clip.items?.[0] ?? ''
  if (price) tabular(ctx, tickNumber(price, soft(win(b.e, 0.3, 0.7))), lx, y + b.H * 0.07, b.H * 0.07, b.s.text, 800)
  const summary = clip.items?.slice(2) ?? []
  summary.forEach((line, i) => {
    const [label, value] = line.split('|')
    const ly = y + b.H * (0.2 + i * 0.07)
    text(ctx, label ?? '', lx, ly, b.H * 0.034, b.s.muted, 500, 'left', SANS, colW * 0.6)
    if (value) tabular(ctx, value, lx + colW * 0.62, ly, b.H * 0.034, b.s.text, 600)
  })
  // Right: wallets, fields, Pay button.
  const bh = b.H * 0.08
  const wallets = ['Apple Pay', 'PayPal']
  wallets.forEach((w, i) => {
    const wy = y - bh * 0.4 + i * (bh * 1.2)
    fillRR(ctx, rx, wy, colW, bh, bh * 0.25, i === 0 ? VIDEO_TOKENS.ink : b.s.panelAlt)
    text(ctx, w, rx + colW / 2, wy + bh / 2, bh * 0.36, i === 0 ? CORE_TOKENS.lightPanel : b.s.text, 600, 'center')
  })
  y += bh * 2.2
  const fields = ['Email', 'Card number', 'MM / YY', 'Country']
  fields.forEach((f, i) => {
    const fy = y + i * (bh * 1.05)
    const fw = i === 2 ? colW * 0.48 : colW
    ctx.strokeStyle = b.s.line
    ctx.lineWidth = Math.max(1, b.W * 0.002)
    rr(ctx, rx, fy, fw, bh * 0.85, bh * 0.2)
    ctx.stroke()
    text(ctx, f, rx + bh * 0.3, fy + bh * 0.425, bh * 0.3, b.s.muted, 500, 'left', SANS, fw * 0.85)
  })
  const payY = y + fields.length * bh * 1.05 + bh * 0.2
  const pay = clip.items?.[1] ? `Pay ${clip.items[1]}` : 'Pay'
  fillRR(ctx, rx, payY, colW, bh, bh * 0.25, clip.accent)
  text(ctx, pay, rx + colW / 2, payY + bh / 2, bh * 0.38, CORE_TOKENS.lightPanel, 700, 'center', SANS, colW * 0.9)
  ctx.restore()
}

function drawBlockRow(ctx: CanvasRenderingContext2D, clip: StudioKitClip, b: Box) {
  const n = clamp(Math.round(clip.values?.[0] ?? 14), 2, 24)
  // 2.5D projection: blocks recede along z; camera pushes in over the clip.
  const push = clip.reducedMotion ? 0 : soft(b.p) * 0.18
  const horizonY = b.y0 + b.H * 0.25
  const focal = b.W * 0.9
  const blocks: Array<{ i: number; sx: number; sy: number; sw: number; sh: number; z: number }> = []
  for (let i = 0; i < n; i++) {
    const z = 1 + i * 0.55 - push * 4
    const k = focal / (focal * Math.max(0.35, z))
    const worldX = -1.4 + i * 0.22
    const sx = b.x0 + b.W * 0.5 + worldX * b.W * 0.35 * k
    const sy = horizonY + b.H * 0.6 * k
    blocks.push({ i, sx, sy, sw: b.W * 0.1 * k, sh: b.H * 0.28 * k, z })
  }
  blocks.sort((a, c) => c.z - a.z) // far → near
  for (const bl of blocks) {
    const litAt = 0.15 + (bl.i / n) * 0.6
    const lit = soft(win(b.p, litAt, 0.08))
    const pulse = clip.reducedMotion ? 1 : 0.6 + 0.4 * (0.5 + 0.5 * Math.sin(b.e * 2.4 + bl.i * 0.7))
    const top = bl.sy - bl.sh
    // Translucent block with a soft rim of the accent.
    ctx.fillStyle = rgba(CORE_TOKENS.panelAlt, 0.85)
    rr(ctx, bl.sx - bl.sw / 2, top, bl.sw, bl.sh, bl.sw * 0.08)
    ctx.fill()
    ctx.strokeStyle = rgba(clip.accent, 0.15 + 0.6 * lit)
    ctx.lineWidth = Math.max(1, bl.sw * 0.03)
    ctx.stroke()
    // Pin + glow.
    const pr = bl.sw * 0.12
    const glow = ctx.createRadialGradient(bl.sx, top - pr * 2, 0, bl.sx, top - pr * 2, pr * 5)
    glow.addColorStop(0, rgba(clip.accent, 0.5 * lit * pulse))
    glow.addColorStop(1, rgba(clip.accent, 0))
    ctx.fillStyle = glow
    ctx.fillRect(bl.sx - pr * 5, top - pr * 7, pr * 10, pr * 10)
    ctx.beginPath()
    ctx.arc(bl.sx, top - pr * 2, pr, 0, Math.PI * 2)
    ctx.fillStyle = lit > 0.01 ? mix(CORE_TOKENS.muted, clip.accent, lit) : CORE_TOKENS.muted
    ctx.fill()
    text(ctx, String(bl.i + 1), bl.sx, top + bl.sh * 0.45, bl.sw * 0.38, mix(CORE_TOKENS.muted, CORE_TOKENS.text, lit), 700, 'center', MONO)
  }
}
