/**
 * Phone Studio — an animated phone mockup with an editable, animated screen.
 *
 * Frame anatomy follows the familiar CSS "mockup-phone" pattern (coloured
 * outer border → black bezel → rounded display, camera island on top), drawn
 * on canvas so it renders identically in preview and export.
 *
 * Everything here is a pure function of (style, box, local time): parametric
 * motion, no randomness, no wall-clock — renderer purity holds.
 *
 * Screen apps never invent social proof: rating is null (hidden) unless the
 * user types one, likes are blank unless typed, and all copy starts as
 * obvious placeholders the user replaces.
 */
import type { StudioPhoneApp, StudioPhoneMotion, StudioPhoneStyle } from '../../types/project'

const FONT = "'Inter Variable', Inter, system-ui, sans-serif"
const clamp01 = (v: number) => Math.max(0, Math.min(1, v))
const easeOutCubic = (v: number) => 1 - (1 - clamp01(v)) ** 3
const easeOutBack = (v: number) => { const c = 1.70158, x = clamp01(v) - 1; return 1 + (c + 1) * x ** 3 + c * x ** 2 }
const easeInOut = (v: number) => { const x = clamp01(v); return x < 0.5 ? 4 * x ** 3 : 1 - (-2 * x + 2) ** 3 / 2 }

/* ——— presets ——— */

/** Frame colours offered in the UI — DESIGN.md tokens only. */
export const PHONE_FRAME_COLORS = [
  { id: 'graphite', label: 'Graphite', color: '#1C1C24' },
  { id: 'silver', label: 'Silver', color: '#9A9AA5' },
  { id: 'cream', label: 'Cream', color: '#F4F1EA' },
  { id: 'lime', label: 'Lime', color: '#C8F542' },
  { id: 'sky', label: 'Sky', color: '#4FB6E8' },
  { id: 'coral', label: 'Coral', color: '#E24B4A' },
] as const

export const PHONE_MOTIONS: Array<{ id: StudioPhoneMotion; label: string }> = [
  { id: 'none', label: 'Still' },
  { id: 'float', label: 'Float' },
  { id: 'tilt-in', label: 'Tilt in' },
  { id: 'spin-reveal', label: 'Spin reveal' },
  { id: 'rise', label: 'Rise up' },
  { id: 'hero-zoom', label: 'Hero zoom' },
  { id: 'swing', label: 'Swing' },
]

export const DEFAULT_PHONE: StudioPhoneStyle = { frameColor: '#1C1C24', island: 'island', buttons: true, glare: true, motion: 'float', scroll: false, app: null }

export function defaultApp(kind: StudioPhoneApp['kind']): StudioPhoneApp {
  if (kind === 'product') return { kind, title: 'Product name', subtitle: 'One line about why it matters', price: '₹0', cta: 'Buy now', badge: 'New', rating: null, accent: '#C8F542' }
  if (kind === 'lockscreen') return { kind, time: '9:41', date: 'Monday, 1 June', notifications: [{ app: 'Your app', title: 'Notification title', body: 'Write the message your customer sees.' }] }
  if (kind === 'browser') return { kind, url: 'yourproduct.com', title: 'Your SaaS launch', subtitle: 'Show the workflow your audience should remember.', cta: 'Try it free', accent: '#4FB6E8' }
  return { kind: 'social', handle: '@yourbrand', caption: 'Write your caption here', likes: '', accent: '#E24B4A' }
}

export type PhoneDesign = { id: string; label: string; detail: string; style: StudioPhoneStyle }

/** One-click designs: frame + motion + animated screen, all editable after. */
export const PHONE_DESIGNS: PhoneDesign[] = [
  { id: 'product-launch', label: 'Product launch', detail: 'Product page builds in: badge, title, price, then the Buy button is tapped.', style: { ...DEFAULT_PHONE, frameColor: '#1C1C24', motion: 'tilt-in', app: defaultApp('product') } },
  { id: 'hero-product', label: 'Hero product', detail: 'Phone zooms up hero-style with a lime frame and product card.', style: { ...DEFAULT_PHONE, frameColor: '#C8F542', motion: 'hero-zoom', app: defaultApp('product') } },
  { id: 'app-scroll', label: 'App screenshot scroll', detail: 'A tall screenshot scrolls top to bottom inside a floating phone.', style: { ...DEFAULT_PHONE, frameColor: '#9A9AA5', motion: 'float', scroll: true } },
  { id: 'notification', label: 'Lock-screen notification', detail: 'Your photo as wallpaper; notifications slide down one by one.', style: { ...DEFAULT_PHONE, frameColor: '#F4F1EA', motion: 'rise', app: defaultApp('lockscreen') } },
  { id: 'social-post', label: 'Social post', detail: 'The clip as a feed post; the heart pops when it is liked.', style: { ...DEFAULT_PHONE, frameColor: '#E24B4A', motion: 'spin-reveal', app: defaultApp('social') } },
  { id: 'minimal', label: 'Clean mockup', detail: 'Just the phone and your media, gently swinging in.', style: { ...DEFAULT_PHONE, frameColor: '#1C1C24', motion: 'swing', glare: false } },
  { id: 'iphone-duo', label: 'Duo fold', detail: 'Two editable screens open, fold around a hinge, and promote a product, browser or SaaS launch.', style: { ...DEFAULT_PHONE, formFactor: 'duo', duoFold: 'fold-out', duoScreen: 'wide', duoDepth: 0.72, duoHingeColor: '#9A9AA5', frameColor: '#F4F1EA', motion: 'float', app: null } },
]

/* ——— geometry & motion ——— */

export type Box = { x: number; y: number; w: number; h: number }

/** Phone body (~9:19.5) centred in `box`, with bezel and display rects. */
export function phoneGeometry(box: Box) {
  const ph = Math.min(box.h, (box.w * 19.5) / 9)
  const pw = (ph * 9) / 19.5
  const x = box.x + (box.w - pw) / 2
  const y = box.y + (box.h - ph) / 2
  const border = pw * 0.028
  const bezel = pw * 0.024
  return {
    body: { x, y, w: pw, h: ph, r: pw * 0.16 },
    bezel: { x: x + border, y: y + border, w: pw - border * 2, h: ph - border * 2, r: pw * 0.14 },
    screen: { x: x + border + bezel, y: y + border + bezel, w: pw - (border + bezel) * 2, h: ph - (border + bezel) * 2, r: pw * 0.115 },
  }
}

export type PhonePose = { dx: number; dy: number; scale: number; rotDeg: number; squashX: number; skewY: number }

/** Where the phone is at local time `sec` (pure). Offsets are in box units. */
export function phonePose(motion: StudioPhoneMotion, sec: number, dur: number): PhonePose {
  const pose: PhonePose = { dx: 0, dy: 0, scale: 1, rotDeg: 0, squashX: 1, skewY: 0 }
  const floatY = Math.sin(sec * 1.6) * 0.012
  const floatR = Math.sin(sec * 1.1) * 1.2
  switch (motion) {
    case 'float':
      pose.dy = floatY; pose.rotDeg = floatR; break
    case 'tilt-in': {
      const e = easeOutBack(sec / 0.9)
      pose.dx = (1 - e) * 0.35; pose.rotDeg = -14 + 10 * e + floatR * clamp01(sec - 0.9); pose.dy = floatY * clamp01(sec - 0.9); break
    }
    case 'spin-reveal': {
      const e = easeOutCubic(sec / 1.1)
      const ang = (1 - e) * (Math.PI / 2) * 0.96
      pose.squashX = Math.max(0.04, Math.cos(ang)); pose.skewY = Math.sin(ang) * 0.18; pose.scale = 0.9 + 0.1 * e; break
    }
    case 'rise': {
      const e = easeOutCubic(sec / 0.8)
      pose.dy = (1 - e) * 0.7 + floatY * clamp01(sec - 0.8); pose.scale = 0.92 + 0.08 * e; break
    }
    case 'hero-zoom': {
      const inE = easeOutCubic(sec / Math.max(0.6, dur * 0.35))
      const push = clamp01((sec - dur * 0.35) / Math.max(0.1, dur * 0.65))
      pose.scale = 0.72 + 0.28 * inE + 0.06 * push; pose.dy = (1 - inE) * 0.12; break
    }
    case 'swing':
      pose.rotDeg = 18 * Math.exp(-sec * 2.2) * Math.cos(sec * 7); pose.dy = floatY * 0.6; break
    default:
      break
  }
  return pose
}

/** Screenshot scroll position 0..1: hold, glide, hold. */
export function scrollAt(sec: number, dur: number): number {
  return easeInOut((sec / Math.max(0.1, dur) - 0.15) / 0.7)
}

/* ——— drawing ——— */

function rr(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const q = Math.max(0, Math.min(r, w / 2, h / 2))
  ctx.beginPath()
  ctx.moveTo(x + q, y)
  ctx.arcTo(x + w, y, x + w, y + h, q)
  ctx.arcTo(x + w, y + h, x, y + h, q)
  ctx.arcTo(x, y + h, x, y, q)
  ctx.arcTo(x, y, x + w, y, q)
  ctx.closePath()
}

function shade(hex: string, k: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex)
  if (!m) return hex
  const n = parseInt(m[1], 16)
  const f = (v: number) => Math.max(0, Math.min(255, Math.round(v * k)))
  return `rgb(${f((n >> 16) & 255)},${f((n >> 8) & 255)},${f(n & 255)})`
}

function fitText(ctx: CanvasRenderingContext2D, text: string, maxW: number): string {
  if (ctx.measureText(text).width <= maxW) return text
  let s = text
  while (s.length > 1 && ctx.measureText(`${s}…`).width > maxW) s = s.slice(0, -1)
  return `${s}…`
}

function wrap(ctx: CanvasRenderingContext2D, text: string, maxW: number, maxLines: number): string[] {
  const words = text.split(/\s+/).filter(Boolean)
  const lines: string[] = []
  let cur = ''
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w
    if (ctx.measureText(next).width > maxW && cur) { lines.push(cur); cur = w } else cur = next
    if (lines.length === maxLines) break
  }
  if (cur && lines.length < maxLines) lines.push(cur)
  if (lines.length === maxLines && words.join(' ') !== lines.join(' ')) lines[maxLines - 1] = fitText(ctx, `${lines[maxLines - 1]}…`, maxW)
  return lines
}

/** Animated in-element: returns [alpha, dy] for an element appearing at `at`. */
const enter = (sec: number, at: number, dur = 0.45): [number, number] => { const e = easeOutCubic((sec - at) / dur); return [e, (1 - e)] }

export type DrawMedia = (x: number, y: number, w: number, h: number, scroll: number | null) => void

/**
 * Draw the whole phone into `box` at local time `sec` (of `dur`).
 * `drawMedia` paints the clip's picture into a rect (renderer-owned, so it
 * knows the source); `scroll` is 0..1 when the screenshot should scroll.
 */
export function drawPhone(ctx: CanvasRenderingContext2D, style: StudioPhoneStyle, box: Box, sec: number, dur: number, drawMedia: DrawMedia) {
  const pose = phonePose(style.motion, sec, dur)
  const cx = box.x + box.w / 2, cy = box.y + box.h / 2
  ctx.save()
  ctx.translate(cx + pose.dx * box.w, cy + pose.dy * box.h)
  ctx.rotate((pose.rotDeg * Math.PI) / 180)
  ctx.transform(pose.squashX * pose.scale, pose.skewY, 0, pose.scale, 0, 0)
  ctx.translate(-cx, -cy)
  const g = phoneGeometry(box)
  const u = g.body.w

  // Shadow + coloured outer frame.
  ctx.save()
  ctx.shadowColor = 'rgba(0,0,0,0.5)'
  ctx.shadowBlur = u * 0.12
  ctx.shadowOffsetY = u * 0.05
  rr(ctx, g.body.x, g.body.y, g.body.w, g.body.h, g.body.r)
  ctx.fillStyle = style.frameColor
  ctx.fill()
  ctx.restore()
  // Metallic rim highlight.
  const rim = ctx.createLinearGradient(g.body.x, g.body.y, g.body.x + g.body.w, g.body.y + g.body.h)
  rim.addColorStop(0, 'rgba(255,255,255,0.28)')
  rim.addColorStop(0.5, 'rgba(255,255,255,0)')
  rim.addColorStop(1, 'rgba(0,0,0,0.25)')
  ctx.lineWidth = Math.max(1, u * 0.006)
  ctx.strokeStyle = rim
  rr(ctx, g.body.x, g.body.y, g.body.w, g.body.h, g.body.r)
  ctx.stroke()
  if (style.buttons) {
    ctx.fillStyle = shade(style.frameColor, 0.8)
    const bw = u * 0.018
    rr(ctx, g.body.x - bw * 0.7, g.body.y + g.body.h * 0.18, bw, g.body.h * 0.05, bw / 2); ctx.fill()
    rr(ctx, g.body.x - bw * 0.7, g.body.y + g.body.h * 0.26, bw, g.body.h * 0.09, bw / 2); ctx.fill()
    rr(ctx, g.body.x - bw * 0.7, g.body.y + g.body.h * 0.37, bw, g.body.h * 0.09, bw / 2); ctx.fill()
    rr(ctx, g.body.x + g.body.w - bw * 0.3, g.body.y + g.body.h * 0.28, bw, g.body.h * 0.13, bw / 2); ctx.fill()
  }
  // Black bezel, then the display.
  rr(ctx, g.bezel.x, g.bezel.y, g.bezel.w, g.bezel.h, g.bezel.r)
  ctx.fillStyle = '#0B0B10'
  ctx.fill()
  const s = g.screen
  ctx.save()
  rr(ctx, s.x, s.y, s.w, s.h, s.r)
  ctx.clip()
  ctx.fillStyle = '#0B0B10'
  ctx.fillRect(s.x, s.y, s.w, s.h)
  if (style.app) drawApp(ctx, style.app, s, sec, dur, drawMedia)
  else drawMedia(s.x, s.y, s.w, s.h, style.scroll ? scrollAt(sec, dur) : null)
  drawStatusBar(ctx, s, style.app?.kind === 'product' || style.app?.kind === 'social' ? '#F4F1EA' : '#F4F1EA')
  if (style.glare) {
    const gl = ctx.createLinearGradient(s.x, s.y, s.x + s.w, s.y + s.h * 0.6)
    gl.addColorStop(0, 'rgba(255,255,255,0.16)')
    gl.addColorStop(0.38, 'rgba(255,255,255,0.04)')
    gl.addColorStop(0.39, 'rgba(255,255,255,0)')
    ctx.fillStyle = gl
    ctx.fillRect(s.x, s.y, s.w, s.h)
  }
  ctx.restore()
  // Camera: dynamic island or notch.
  ctx.fillStyle = '#000'
  if (style.island === 'island') {
    rr(ctx, s.x + s.w * 0.34, s.y + s.w * 0.035, s.w * 0.32, s.w * 0.095, s.w * 0.0475)
    ctx.fill()
    ctx.fillStyle = '#15151B'
    ctx.beginPath()
    ctx.arc(s.x + s.w * 0.6, s.y + s.w * 0.0825, s.w * 0.022, 0, Math.PI * 2)
    ctx.fill()
  } else if (style.island === 'notch') {
    rr(ctx, s.x + s.w * 0.28, s.y - s.w * 0.04, s.w * 0.44, s.w * 0.11, s.w * 0.05)
    ctx.fill()
  }
  ctx.restore()
}


/**
 * iPhone Duo-inspired two-panel product treatment.
 *
 * The upstream reference uses a Three.js/USD model and Apple-only assets. The
 * Studio version deliberately uses the same useful interaction idea — fixed
 * rear-camera panel, cover panel rotating around a hinge, front-projected
 * screen content, progressive edge darkening — as a pure Canvas projection.
 * That keeps preview/export identical, editable, and free of Apple assets.
 */
export function duoFoldAt(motion: NonNullable<StudioPhoneStyle['duoFold']>, sec: number, dur: number): number {
  const t = Math.max(0, sec)
  const d = Math.max(0.1, dur)
  const ease = (v: number) => easeInOut(clamp01(v))
  if (motion === 'fold-in') return 180 * (1 - ease(t / Math.min(1.4, d * 0.34)))
  if (motion === 'fold-out') return 180 * ease(t / Math.min(1.6, d * 0.42))
  if (motion === 'peek') return 92 + Math.sin(Math.min(t, d) * 1.15) * 30
  return 180
}

type DuoPanel = { body: Box & { r: number }; bezel: Box & { r: number }; screen: Box & { r: number } }

function duoPanel(x: number, y: number, w: number, h: number): DuoPanel {
  const border = w * 0.038
  const bezel = w * 0.028
  return {
    body: { x, y, w, h, r: w * 0.14 },
    bezel: { x: x + border, y: y + border, w: w - border * 2, h: h - border * 2, r: w * 0.12 },
    screen: { x: x + border + bezel, y: y + border + bezel, w: w - (border + bezel) * 2, h: h - (border + bezel) * 2, r: w * 0.09 },
  }
}

function drawDuoPanel(
  ctx: CanvasRenderingContext2D,
  style: StudioPhoneStyle,
  panel: DuoPanel,
  sec: number,
  dur: number,
  drawMedia: DrawMedia,
  panelIndex: 0 | 1,
  screenMode: NonNullable<StudioPhoneStyle['duoScreen']>,
  fold: number,
  wideSpan = panel.screen.w,
) {
  const { body, bezel, screen } = panel
  const u = body.w
  ctx.save()
  ctx.shadowColor = 'rgba(0,0,0,0.46)'
  ctx.shadowBlur = u * 0.12
  ctx.shadowOffsetY = u * 0.05
  rr(ctx, body.x, body.y, body.w, body.h, body.r)
  ctx.fillStyle = style.frameColor
  ctx.fill()
  ctx.restore()

  const rim = ctx.createLinearGradient(body.x, body.y, body.x + body.w, body.y + body.h)
  rim.addColorStop(0, 'rgba(255,255,255,0.34)')
  rim.addColorStop(0.5, 'rgba(255,255,255,0)')
  rim.addColorStop(1, 'rgba(0,0,0,0.3)')
  ctx.lineWidth = Math.max(1, u * 0.007)
  ctx.strokeStyle = rim
  rr(ctx, body.x, body.y, body.w, body.h, body.r)
  ctx.stroke()

  ctx.fillStyle = '#0B0B10'
  rr(ctx, bezel.x, bezel.y, bezel.w, bezel.h, bezel.r)
  ctx.fill()
  ctx.save()
  rr(ctx, screen.x, screen.y, screen.w, screen.h, screen.r)
  ctx.clip()
  ctx.fillStyle = '#0B0B10'
  ctx.fillRect(screen.x, screen.y, screen.w, screen.h)
  const showMedia = screenMode === 'outer-right' ? panelIndex === 1 : true
  if (showMedia) {
    const scroll = style.scroll ? scrollAt(sec, dur) : null
    if (style.app) drawApp(ctx, style.app, screen, sec, dur, drawMedia)
    else if (screenMode === 'wide') {
      // Treat the two screens as one content plane, then let each clipped
      // panel reveal its half. Mirror mode intentionally paints a full copy on
      // each panel; this distinction is useful for product art versus UI.
      const sourceX = screen.x - (panelIndex === 0 ? 0 : wideSpan)
      drawMedia(sourceX, screen.y, wideSpan * 2, screen.h, scroll)
    } else drawMedia(screen.x, screen.y, screen.w, screen.h, scroll)
  } else {
    ctx.fillStyle = 'rgba(11,11,16,0.92)'
    ctx.fillRect(screen.x, screen.y, screen.w, screen.h)
  }
  drawStatusBar(ctx, screen, '#F4F1EA')
  // The same edge-aware effect as the reference: folding reduces visible
  // coverage and darkens the receding panel, never the fixed panel.
  if (panelIndex === 0 && fold < 180) {
    const effect = 1 - Math.sin((fold * Math.PI) / 360)
    const shadeLayer = ctx.createLinearGradient(screen.x, screen.y, screen.x + screen.w, screen.y)
    shadeLayer.addColorStop(0, `rgba(0,0,0,${Math.min(0.86, effect * 0.86)})`)
    shadeLayer.addColorStop(1, 'rgba(0,0,0,0)')
    ctx.fillStyle = shadeLayer
    ctx.fillRect(screen.x, screen.y, screen.w, screen.h)
  }
  if (style.glare) {
    const gl = ctx.createLinearGradient(screen.x, screen.y, screen.x + screen.w, screen.y + screen.h * 0.6)
    gl.addColorStop(0, 'rgba(255,255,255,0.18)')
    gl.addColorStop(0.38, 'rgba(255,255,255,0.035)')
    gl.addColorStop(0.39, 'rgba(255,255,255,0)')
    ctx.fillStyle = gl
    ctx.fillRect(screen.x, screen.y, screen.w, screen.h)
  }
  ctx.restore()

  // Dynamic-island camera, kept as an editable frame option rather than an
  // Apple asset. Use a slightly different island on the cover for depth.
  if (style.island !== 'none') {
    ctx.fillStyle = '#000'
    if (style.island === 'island') {
      rr(ctx, screen.x + screen.w * 0.34, screen.y + screen.w * 0.035, screen.w * 0.32, screen.w * 0.095, screen.w * 0.0475)
    } else {
      rr(ctx, screen.x + screen.w * 0.28, screen.y - screen.w * 0.04, screen.w * 0.44, screen.w * 0.11, screen.w * 0.05)
    }
    ctx.fill()
  }

  if (style.buttons && panelIndex === 1) {
    ctx.fillStyle = shade(style.frameColor, 0.8)
    const bw = u * 0.018
    rr(ctx, body.x + body.w - bw * 0.3, body.y + body.h * 0.28, bw, body.h * 0.13, bw / 2)
    ctx.fill()
  }
}

/** Draw a deterministic, editable two-screen foldable phone. */
export function drawDuoPhone(ctx: CanvasRenderingContext2D, style: StudioPhoneStyle, box: Box, sec: number, dur: number, drawMedia: DrawMedia) {
  const fold = duoFoldAt(style.duoFold ?? 'open', sec, dur)
  const depth = Math.max(0, Math.min(1, style.duoDepth ?? 0.62))
  const panelH = Math.min(box.h * 0.88, box.w * 0.82)
  const panelW = Math.min(box.w * 0.29, (panelH * 9) / 19.5)
  const hingeX = box.x + box.w * 0.52
  const y = box.y + (box.h - panelH) / 2
  const visible = Math.max(0.035, Math.sin((fold * Math.PI) / 360))
  const coverW = panelW * visible
  const leftShear = (1 - visible) * depth * panelW * 0.18
  const leftX = hingeX - coverW - leftShear
  const right = duoPanel(hingeX, y, panelW, panelH)
  const left = duoPanel(leftX, y, Math.max(2, coverW), panelH)

  // Ambient ground shadow makes the fold read as depth without an unseeded
  // lighting clock or a non-deterministic WebGL capture.
  ctx.save()
  ctx.fillStyle = `rgba(0,0,0,${0.16 + (1 - visible) * 0.1})`
  ctx.filter = `blur(${Math.max(2, panelW * 0.08)}px)`
  ctx.beginPath()
  ctx.ellipse(hingeX - panelW * 0.15, y + panelH * 1.01, panelW * (0.88 + visible * 0.6), panelW * 0.13, 0, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()

  // Rear-camera half stays fixed; the cover half is projected toward the
  // hinge, mirroring the useful motion from the Three.js reference.
  drawDuoPanel(ctx, style, left, sec, dur, drawMedia, 0, style.duoScreen ?? 'wide', fold, right.screen.w)
  drawDuoPanel(ctx, style, right, sec, dur, drawMedia, 1, style.duoScreen ?? 'wide', fold, right.screen.w)
  ctx.save()
  const hinge = style.duoHingeColor ?? style.frameColor
  ctx.fillStyle = hinge
  ctx.shadowColor = 'rgba(0,0,0,0.35)'
  ctx.shadowBlur = panelW * 0.06
  rr(ctx, hingeX - panelW * 0.018, y + panelH * 0.035, panelW * 0.036, panelH * 0.93, panelW * 0.018)
  ctx.fill()
  ctx.restore()
}

function drawStatusBar(ctx: CanvasRenderingContext2D, s: Box, color: string) {
  const fs = s.w * 0.045
  ctx.save()
  ctx.fillStyle = color
  ctx.shadowColor = 'rgba(0,0,0,0.35)'
  ctx.shadowBlur = fs * 0.4
  ctx.font = `600 ${fs}px ${FONT}`
  ctx.textBaseline = 'middle'
  ctx.textAlign = 'left'
  ctx.fillText('9:41', s.x + s.w * 0.09, s.y + s.w * 0.083)
  // Battery.
  const bx = s.x + s.w * 0.8, by = s.y + s.w * 0.066, bw = s.w * 0.075, bh = s.w * 0.036
  ctx.lineWidth = Math.max(1, s.w * 0.005)
  ctx.strokeStyle = color
  rr(ctx, bx, by, bw, bh, bh * 0.3); ctx.stroke()
  rr(ctx, bx + bh * 0.18, by + bh * 0.18, (bw - bh * 0.36) * 0.8, bh * 0.64, bh * 0.2); ctx.fill()
  ctx.restore()
}

function drawApp(ctx: CanvasRenderingContext2D, app: StudioPhoneApp, s: Box, sec: number, dur: number, drawMedia: DrawMedia) {
  const u = s.w
  const pad = u * 0.07
  if (app.kind === 'product') {
    const imgH = s.h * 0.56
    drawMedia(s.x, s.y, s.w, imgH, null)
    ctx.fillStyle = '#15151B'
    rr(ctx, s.x, s.y + imgH - u * 0.06, s.w, s.h - imgH + u * 0.06, u * 0.06)
    ctx.fill()
    let y = s.y + imgH + u * 0.03
    ctx.textAlign = 'left'
    ctx.textBaseline = 'top'
    if (app.badge.trim()) {
      const [a, d] = enter(sec, 0.3)
      ctx.globalAlpha = a
      ctx.font = `700 ${u * 0.04}px ${FONT}`
      const tw = ctx.measureText(app.badge).width
      ctx.fillStyle = app.accent
      rr(ctx, s.x + pad, s.y + u * 0.2 + d * u * 0.05, tw + u * 0.05, u * 0.065, u * 0.0325)
      ctx.fill()
      ctx.fillStyle = '#0B0B10'
      ctx.fillText(app.badge, s.x + pad + u * 0.025, s.y + u * 0.212 + d * u * 0.05)
      ctx.globalAlpha = 1
    }
    {
      const [a, d] = enter(sec, 0.45)
      ctx.globalAlpha = a
      ctx.fillStyle = '#F4F1EA'
      ctx.font = `800 ${u * 0.075}px ${FONT}`
      for (const line of wrap(ctx, app.title, s.w - pad * 2, 2)) { ctx.fillText(line, s.x + pad, y + d * u * 0.06); y += u * 0.088 }
    }
    {
      const [a, d] = enter(sec, 0.6)
      ctx.globalAlpha = a
      ctx.fillStyle = '#9A9AA5'
      ctx.font = `500 ${u * 0.045}px ${FONT}`
      for (const line of wrap(ctx, app.subtitle, s.w - pad * 2, 2)) { ctx.fillText(line, s.x + pad, y + u * 0.01 + d * u * 0.05); y += u * 0.058 }
      y += u * 0.02
    }
    if (app.rating !== null && Number.isFinite(app.rating)) {
      const r = Math.max(0, Math.min(5, app.rating))
      ctx.globalAlpha = clamp01((sec - 0.75) / 0.3)
      const sz = u * 0.05
      for (let i = 0; i < 5; i += 1) {
        const fill = clamp01(Math.min(r - i, (sec - 0.75 - i * 0.08) / 0.15))
        star(ctx, s.x + pad + sz / 2 + i * sz * 1.2, y + sz / 2, sz / 2, '#3a3a44')
        if (fill > 0) { ctx.save(); ctx.beginPath(); ctx.rect(s.x + pad + i * sz * 1.2, y, sz * fill, sz); ctx.clip(); star(ctx, s.x + pad + sz / 2 + i * sz * 1.2, y + sz / 2, sz / 2, app.accent); ctx.restore() }
      }
      ctx.fillStyle = '#9A9AA5'
      ctx.font = `600 ${u * 0.04}px ${FONT}`
      ctx.fillText(r.toFixed(1), s.x + pad + sz * 6.2, y + sz * 0.1)
      y += sz * 1.5
    }
    {
      const [a, d] = enter(sec, 0.9)
      ctx.globalAlpha = a
      ctx.fillStyle = app.accent
      ctx.font = `800 ${u * 0.085}px ${FONT}`
      ctx.fillText(fitText(ctx, countUp(app.price, clamp01((sec - 0.9) / 0.8)), s.w - pad * 2), s.x + pad, y + d * u * 0.05)
    }
    // CTA: pops in, then gets tapped (press + ripple) at 70% of the clip.
    const bh = u * 0.13
    const by = s.y + s.h - bh - u * 0.1
    const tapAt = Math.max(1.8, dur * 0.7)
    const pop = easeOutBack((sec - 1.1) / 0.45)
    const press = sec > tapAt && sec < tapAt + 0.25 ? 1 - 0.05 * Math.sin(((sec - tapAt) / 0.25) * Math.PI) : 1
    if (pop > 0) {
      ctx.globalAlpha = clamp01(pop)
      const bw = (s.w - pad * 2) * press
      const bx = s.x + s.w / 2 - bw / 2
      ctx.save()
      ctx.translate(s.x + s.w / 2, by + bh / 2)
      ctx.scale(pop, pop)
      ctx.translate(-(s.x + s.w / 2), -(by + bh / 2))
      ctx.fillStyle = app.accent
      rr(ctx, bx, by, bw, bh * press, bh / 2)
      ctx.fill()
      ctx.fillStyle = '#0B0B10'
      ctx.font = `800 ${u * 0.05}px ${FONT}`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(fitText(ctx, app.cta, bw - u * 0.08), s.x + s.w / 2, by + bh / 2)
      ctx.restore()
      if (sec > tapAt && sec < tapAt + 0.6) {
        const k = (sec - tapAt) / 0.6
        ctx.globalAlpha = 0.45 * (1 - k)
        ctx.fillStyle = '#F4F1EA'
        ctx.beginPath()
        ctx.arc(s.x + s.w * 0.62, by + bh * 0.55, u * 0.04 + k * u * 0.3, 0, Math.PI * 2)
        ctx.fill()
      }
    }
    ctx.globalAlpha = 1
    return
  }
  if (app.kind === 'lockscreen') {
    drawMedia(s.x, s.y, s.w, s.h, null)
    const dim = ctx.createLinearGradient(0, s.y, 0, s.y + s.h)
    dim.addColorStop(0, 'rgba(0,0,0,0.35)'); dim.addColorStop(0.5, 'rgba(0,0,0,0.05)'); dim.addColorStop(1, 'rgba(0,0,0,0.3)')
    ctx.fillStyle = dim
    ctx.fillRect(s.x, s.y, s.w, s.h)
    ctx.textAlign = 'center'
    ctx.textBaseline = 'top'
    ctx.fillStyle = '#F4F1EA'
    ctx.font = `500 ${u * 0.048}px ${FONT}`
    ctx.fillText(fitText(ctx, app.date, s.w - pad * 2), s.x + s.w / 2, s.y + u * 0.2)
    ctx.font = `700 ${u * 0.24}px ${FONT}`
    ctx.fillText(fitText(ctx, app.time, s.w - pad), s.x + s.w / 2, s.y + u * 0.26)
    let y = s.y + u * 0.62
    app.notifications.slice(0, 4).forEach((n, i) => {
      const at = 0.8 + i * 0.6
      const e = easeOutBack((sec - at) / 0.5)
      if (e <= 0) return
      const h = u * 0.2
      ctx.globalAlpha = clamp01(e)
      const yy = y - (1 - e) * u * 0.25
      ctx.fillStyle = 'rgba(28,28,36,0.78)'
      rr(ctx, s.x + pad * 0.6, yy, s.w - pad * 1.2, h, u * 0.05)
      ctx.fill()
      ctx.fillStyle = '#C8F542'
      rr(ctx, s.x + pad * 1.1, yy + u * 0.035, u * 0.07, u * 0.07, u * 0.018)
      ctx.fill()
      ctx.textAlign = 'left'
      ctx.fillStyle = '#9A9AA5'
      ctx.font = `600 ${u * 0.034}px ${FONT}`
      ctx.fillText(fitText(ctx, n.app.toUpperCase(), s.w * 0.5), s.x + pad * 1.1 + u * 0.09, yy + u * 0.05)
      ctx.fillStyle = '#F4F1EA'
      ctx.font = `700 ${u * 0.042}px ${FONT}`
      ctx.fillText(fitText(ctx, n.title, s.w - pad * 3), s.x + pad * 1.1, yy + u * 0.115)
      ctx.font = `400 ${u * 0.038}px ${FONT}`
      ctx.fillStyle = 'rgba(244,241,234,0.85)'
      ctx.fillText(fitText(ctx, n.body, s.w - pad * 3), s.x + pad * 1.1, yy + u * 0.16)
      y += h + u * 0.03
    })
    ctx.globalAlpha = 1
    return
  }
  if (app.kind === 'browser') {
    ctx.fillStyle = '#F4F1EA'
    ctx.fillRect(s.x, s.y, s.w, s.h)
    const barH = u * 0.16
    ctx.fillStyle = '#1C1C24'
    ctx.fillRect(s.x, s.y, s.w, barH)
    ctx.fillStyle = '#9A9AA5'
    for (let i = 0; i < 3; i += 1) { ctx.beginPath(); ctx.arc(s.x + pad * 0.7 + i * u * 0.045, s.y + barH * 0.5, u * 0.014, 0, Math.PI * 2); ctx.fill() }
    ctx.fillStyle = '#F4F1EA'
    rr(ctx, s.x + u * 0.22, s.y + barH * 0.25, s.w - u * 0.3, barH * 0.5, barH * 0.25); ctx.fill()
    ctx.fillStyle = '#9A9AA5'
    ctx.font = `500 ${u * 0.034}px ${FONT}`
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle'
    ctx.fillText(fitText(ctx, app.url, s.w - u * 0.42), s.x + u * 0.26, s.y + barH * 0.5)
    const [a, d] = enter(sec, 0.35)
    ctx.globalAlpha = a
    ctx.fillStyle = '#15151B'
    ctx.textBaseline = 'top'
    ctx.font = `800 ${u * 0.09}px ${FONT}`
    for (const line of wrap(ctx, app.title, s.w - pad * 2, 2)) { ctx.fillText(line, s.x + pad, s.y + barH + u * 0.1 + d * u * 0.08); }
    ctx.fillStyle = '#6D6C67'
    ctx.font = `500 ${u * 0.044}px ${FONT}`
    const subtitleY = s.y + barH + u * 0.3 + d * u * 0.08
    for (const line of wrap(ctx, app.subtitle, s.w - pad * 2, 3)) { ctx.fillText(line, s.x + pad, subtitleY); }
    ctx.globalAlpha = 1
    // A staged SaaS result card and CTA make browser promotion useful even
    // before the user supplies a screen capture; all copy remains editable.
    const cardY = s.y + s.h * 0.52
    ctx.fillStyle = '#F4F1EA'
    ctx.shadowColor = 'rgba(0,0,0,0.12)'; ctx.shadowBlur = u * 0.05
    rr(ctx, s.x + pad, cardY, s.w - pad * 2, s.h * 0.2, u * 0.05); ctx.fill(); ctx.shadowBlur = 0
    ctx.fillStyle = app.accent
    const bars = [0.45, 0.68, 0.54, 0.82]
    bars.forEach((value, i) => { const e = easeOutCubic((sec - 0.8 - i * 0.1) / 0.45); ctx.globalAlpha = clamp01(e); rr(ctx, s.x + pad * 1.5 + i * (s.w - pad * 3) / 4, cardY + u * 0.13 - u * 0.08 * value * e, u * 0.045, u * 0.08 * value * e, u * 0.02); ctx.fill() })
    ctx.globalAlpha = 1
    const bh = u * 0.12
    const by = s.y + s.h - bh - u * 0.1
    const pop = easeOutBack((sec - 1.15) / 0.4)
    if (pop > 0) { ctx.save(); ctx.globalAlpha = clamp01(pop); ctx.fillStyle = app.accent; rr(ctx, s.x + pad, by, s.w - pad * 2, bh, bh / 2); ctx.fillStyle = '#0B0B10'; ctx.font = `800 ${u * 0.045}px ${FONT}`; ctx.textAlign = 'center'; ctx.fillText(app.cta, s.x + s.w / 2, by + bh * 0.56); ctx.restore() }
    return
  }
  // social
  ctx.fillStyle = '#0B0B10'
  ctx.fillRect(s.x, s.y, s.w, s.h)
  const top = s.y + u * 0.2
  ctx.fillStyle = app.accent
  ctx.beginPath()
  ctx.arc(s.x + pad + u * 0.04, top + u * 0.04, u * 0.04, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = '#F4F1EA'
  ctx.font = `700 ${u * 0.045}px ${FONT}`
  ctx.textAlign = 'left'
  ctx.textBaseline = 'middle'
  ctx.fillText(fitText(ctx, app.handle, s.w * 0.7), s.x + pad + u * 0.11, top + u * 0.04)
  const mediaY = top + u * 0.12
  drawMedia(s.x, mediaY, s.w, s.w, null)
  // Like: heart pops at 55%, with a deterministic burst.
  const likeAt = Math.max(1, dur * 0.55)
  const liked = sec >= likeAt
  const pop = liked ? easeOutBack((sec - likeAt) / 0.35) : 0
  const hx = s.x + pad + u * 0.04, hy = mediaY + s.w + u * 0.08
  heart(ctx, hx, hy, u * 0.04 * (liked ? 0.8 + 0.2 * pop : 1), liked ? app.accent : 'transparent', '#F4F1EA')
  if (liked && sec - likeAt < 0.5) {
    const k = (sec - likeAt) / 0.5
    ctx.globalAlpha = 1 - k
    ctx.fillStyle = app.accent
    for (let i = 0; i < 8; i += 1) {
      const a = (i / 8) * Math.PI * 2
      ctx.beginPath()
      ctx.arc(hx + Math.cos(a) * u * (0.05 + k * 0.06), hy + Math.sin(a) * u * (0.05 + k * 0.06), u * 0.008, 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.globalAlpha = 1
  }
  // Big heart over the photo on like (the double-tap moment).
  if (liked && sec - likeAt < 0.9) {
    const k = (sec - likeAt) / 0.9
    ctx.globalAlpha = k < 0.7 ? 0.9 : 0.9 * (1 - (k - 0.7) / 0.3)
    heart(ctx, s.x + s.w / 2, mediaY + s.w / 2, u * 0.16 * easeOutBack(k / 0.4), '#F4F1EA', null)
    ctx.globalAlpha = 1
  }
  ctx.textBaseline = 'top'
  let y = hy + u * 0.07
  if (app.likes.trim()) {
    ctx.fillStyle = '#F4F1EA'
    ctx.font = `700 ${u * 0.04}px ${FONT}`
    ctx.fillText(fitText(ctx, app.likes, s.w - pad * 2), s.x + pad, y)
    y += u * 0.06
  }
  const [a] = enter(sec, 0.5)
  ctx.globalAlpha = a
  ctx.fillStyle = 'rgba(244,241,234,0.9)'
  ctx.font = `400 ${u * 0.04}px ${FONT}`
  for (const line of wrap(ctx, app.caption, s.w - pad * 2, 3)) { ctx.fillText(line, s.x + pad, y); y += u * 0.052 }
  ctx.globalAlpha = 1
}

/** "₹1,499" counts up from 0 as `k` goes 0→1; non-numeric prices show as typed. */
export function countUp(price: string, k: number): string {
  const m = /^(\D*)([\d,]+(?:\.\d+)?)(.*)$/.exec(price.trim())
  if (!m || k >= 1) return price
  const target = Number(m[2].replace(/,/g, ''))
  if (!Number.isFinite(target)) return price
  const decimals = (m[2].split('.')[1] ?? '').length
  const v = target * easeOutCubic(k)
  const txt = m[2].includes(',') ? v.toLocaleString('en-IN', { minimumFractionDigits: decimals, maximumFractionDigits: decimals }) : v.toFixed(decimals)
  return `${m[1]}${txt}${m[3]}`
}

function star(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, color: string) {
  ctx.beginPath()
  for (let i = 0; i < 10; i += 1) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5
    const rad = i % 2 ? r * 0.45 : r
    ctx.lineTo(cx + Math.cos(a) * rad, cy + Math.sin(a) * rad)
  }
  ctx.closePath()
  ctx.fillStyle = color
  ctx.fill()
}

function heart(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, fill: string, stroke: string | null) {
  ctx.beginPath()
  ctx.moveTo(cx, cy + r * 0.9)
  ctx.bezierCurveTo(cx - r * 1.6, cy - r * 0.1, cx - r * 0.7, cy - r * 1.3, cx, cy - r * 0.45)
  ctx.bezierCurveTo(cx + r * 0.7, cy - r * 1.3, cx + r * 1.6, cy - r * 0.1, cx, cy + r * 0.9)
  ctx.closePath()
  if (fill !== 'transparent') { ctx.fillStyle = fill; ctx.fill() }
  if (stroke) { ctx.lineWidth = Math.max(1, r * 0.14); ctx.strokeStyle = stroke; ctx.stroke() }
}
