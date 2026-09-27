/**
 * Renderer extras: native shapes, animated cursor, and the 3D projection used
 * for Tilt X / Turn Y on any clip. All pure functions of (clip, time, size).
 */
import type { StudioCursorClip, StudioShapeClip } from '../../types/project'
import { partialPath, shapeById, shapeGeometry, type Pt } from './shapes'
import { cursorAt } from './cursor'

const clamp01 = (v: number) => Math.min(1, Math.max(0, v))
const easeOut = (t: number) => 1 - (1 - t) ** 3
const backOut = (t: number) => { const c = 1.70158; return 1 + (c + 1) * (t - 1) ** 3 + c * (t - 1) ** 2 }

/* ─────────────────────────────── shapes ─────────────────────────────── */

export function shapeBox(clip: StudioShapeClip, w: number) {
  const pw = Math.max(2, clip.w * w)
  const ph = pw * Math.max(0.01, clip.aspect)
  return { pw, ph }
}

export function drawShape(ctx: CanvasRenderingContext2D, clip: StudioShapeClip, t: number, w: number, h: number) {
  const local = Math.max(0, t - clip.startSec)
  const def = shapeById(clip.shape)
  const geom = shapeGeometry(clip.shape, { sides: clip.sides, radius: clip.radius, aspect: clip.aspect })
  const { pw, ph } = shapeBox(clip, w)
  const inDur = Math.min(0.9, clip.durationSec * 0.45)
  const p = clamp01(local / Math.max(0.05, inDur))
  let scale = 1, rot = 0, draw = 1, fillAlpha = 1, alpha = 1
  switch (clip.anim) {
    case 'draw-on': draw = easeOut(p); break
    case 'draw-then-fill': draw = easeOut(clamp01(p / 0.7)); fillAlpha = clamp01((p - 0.6) / 0.4); break
    case 'pop': scale = Math.max(0, backOut(p)); alpha = clamp01(p * 3); break
    case 'grow': scale = 1; break
    case 'spin-in': scale = easeOut(p); rot = (1 - easeOut(p)) * -Math.PI; alpha = clamp01(p * 2); break
    case 'pulse': scale = 1 + 0.06 * Math.sin(local * Math.PI * 2 * 1.2); break
    case 'wiggle': rot = Math.sin(local * Math.PI * 2 * 2.2) * 0.07 * Math.exp(-local * 0.6); break
  }
  const growX = clip.anim === 'grow' ? easeOut(p) : 1
  const sw = Math.max(0.5, clip.strokeWidth * (h / 1080))
  const strokeOnly = def?.strokeOnly || !clip.fill
  ctx.save()
  ctx.globalAlpha *= alpha
  ctx.translate(clip.x * w, clip.y * h)
  if (rot) ctx.rotate(rot)
  if (scale !== 1) ctx.scale(scale, scale)
  const map = ([x, y]: Pt): Pt => [(clip.anim === 'grow' ? (x + 0.5) * growX - 0.5 : x) * pw, y * ph]
  if (clip.glow) {
    ctx.shadowColor = clip.stroke ?? clip.fill ?? '#ffffff'
    ctx.shadowBlur = Math.max(4, pw * 0.08) * clip.glow
  }
  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'
  // Fill (whole geometry, even-odd so rings/holes work).
  if (!strokeOnly && clip.fill && fillAlpha > 0 && (clip.anim !== 'draw-on' || draw >= 1)) {
    ctx.save()
    ctx.globalAlpha *= fillAlpha
    ctx.beginPath()
    for (const sp of geom) {
      if (!sp.closed) continue
      sp.pts.forEach((pt, i) => { const [x, y] = map(pt); if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y) })
      ctx.closePath()
    }
    ctx.fillStyle = clip.fill
    ctx.fill('evenodd')
    ctx.restore()
  }
  // Stroke (with draw-on across all subpaths in order, by length).
  const stroke = clip.stroke ?? (strokeOnly ? clip.fill ?? '#ffffff' : null)
  if (stroke && sw > 0) {
    ctx.strokeStyle = stroke
    ctx.lineWidth = sw
    const n = geom.length
    geom.forEach((sp, i) => {
      // Subpaths draw in sequence: each gets an equal slice of the draw.
      const k = n > 1 ? clamp01(draw * n - i) : draw
      if (k <= 0) return
      const pts = partialPath(sp, k)
      if (pts.length < 2) return
      ctx.beginPath()
      pts.forEach((pt, j) => { const [x, y] = map(pt); if (j) ctx.lineTo(x, y); else ctx.moveTo(x, y) })
      if (sp.closed && k >= 1) ctx.closePath()
      ctx.stroke()
    })
  }
  ctx.shadowBlur = 0
  if (clip.label) {
    const fontPx = Math.max(10, ph * 0.42)
    ctx.font = `700 ${fontPx}px 'Geist Variable', Inter, system-ui, sans-serif`
    ctx.fillStyle = clip.labelColor ?? '#0b0b10'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.globalAlpha *= clamp01(draw * 1.5 - 0.3)
    ctx.fillText(clip.label, 0, ph * 0.02, pw * 0.9)
  }
  ctx.restore()
}

/* ─────────────────────────────── cursor ─────────────────────────────── */

type PointerStyle = Exclude<StudioCursorClip['style'], 'auto'>

function drawPointer(ctx: CanvasRenderingContext2D, style: PointerStyle, size: number, color: string) {
  ctx.shadowColor = 'rgba(0,0,0,0.45)'
  ctx.shadowBlur = size * 0.35
  ctx.shadowOffsetY = size * 0.08
  ctx.lineJoin = 'round'
  if (style === 'ibeam') {
    // Text I-beam, centred on the insertion point.
    const s = size / 24
    ctx.beginPath()
    ctx.moveTo(-4 * s, -11 * s); ctx.quadraticCurveTo(0, -11 * s, 0, -8 * s); ctx.quadraticCurveTo(0, -11 * s, 4 * s, -11 * s)
    ctx.moveTo(0, -8 * s); ctx.lineTo(0, 8 * s)
    ctx.moveTo(-4 * s, 11 * s); ctx.quadraticCurveTo(0, 11 * s, 0, 8 * s); ctx.quadraticCurveTo(0, 11 * s, 4 * s, 11 * s)
    ctx.lineCap = 'round'
    ctx.lineWidth = Math.max(2.5, s * 4.2); ctx.strokeStyle = '#0b0b10'; ctx.stroke()
    ctx.shadowBlur = 0
    ctx.lineWidth = Math.max(1.2, s * 2); ctx.strokeStyle = color; ctx.stroke()
    return
  }
  if (style === 'dot' || style === 'touch') {
    ctx.beginPath()
    ctx.arc(0, 0, size * (style === 'touch' ? 0.55 : 0.32), 0, Math.PI * 2)
    ctx.fillStyle = style === 'touch' ? 'rgba(255,255,255,0.55)' : color
    ctx.fill()
    ctx.lineWidth = size * 0.06
    ctx.strokeStyle = 'rgba(0,0,0,0.35)'
    ctx.stroke()
  } else if (style === 'ring') {
    ctx.beginPath()
    ctx.arc(0, 0, size * 0.45, 0, Math.PI * 2)
    ctx.lineWidth = size * 0.1
    ctx.strokeStyle = color
    ctx.stroke()
  } else if (style === 'hand') {
    // Pointing hand: rounded finger + palm silhouette, tip at (0,0).
    const s = size / 24
    ctx.beginPath()
    ctx.moveTo(0, 0)
    ctx.quadraticCurveTo(2.5 * s, 0, 2.5 * s, 3 * s)
    ctx.lineTo(2.5 * s, 10 * s)
    ctx.quadraticCurveTo(6 * s, 8 * s, 8 * s, 11 * s)
    ctx.quadraticCurveTo(12 * s, 10 * s, 13 * s, 13 * s)
    ctx.quadraticCurveTo(17 * s, 13 * s, 17 * s, 17 * s)
    ctx.lineTo(17 * s, 22 * s)
    ctx.quadraticCurveTo(16 * s, 30 * s, 8 * s, 30 * s)
    ctx.quadraticCurveTo(0, 30 * s, -3 * s, 22 * s)
    ctx.lineTo(-7 * s, 14 * s)
    ctx.quadraticCurveTo(-7 * s, 11 * s, -3 * s, 13 * s)
    ctx.lineTo(-2.5 * s, 14 * s)
    ctx.lineTo(-2.5 * s, 3 * s)
    ctx.quadraticCurveTo(-2.5 * s, 0, 0, 0)
    ctx.closePath()
    ctx.fillStyle = color
    ctx.fill()
    ctx.shadowBlur = 0
    ctx.lineWidth = Math.max(1, s * 1.4)
    ctx.strokeStyle = '#0b0b10'
    ctx.stroke()
  } else {
    // Classic arrow pointer, tip at (0,0).
    const s = size / 24
    ctx.beginPath()
    ctx.moveTo(0, 0)
    ctx.lineTo(0, 22 * s)
    ctx.lineTo(5.5 * s, 16.5 * s)
    ctx.lineTo(9.5 * s, 25 * s)
    ctx.lineTo(13 * s, 23.5 * s)
    ctx.lineTo(9 * s, 15.5 * s)
    ctx.lineTo(16.5 * s, 15.5 * s)
    ctx.closePath()
    ctx.fillStyle = color
    ctx.fill()
    ctx.shadowBlur = 0
    ctx.lineWidth = Math.max(1, s * 1.5)
    ctx.strokeStyle = '#0b0b10'
    ctx.stroke()
  }
}

export function drawCursor(ctx: CanvasRenderingContext2D, clip: StudioCursorClip, t: number, w: number, h: number) {
  const local = Math.max(0, t - clip.startSec)
  const f = cursorAt(clip, local)
  if (f.alpha <= 0) return
  const size = Math.max(10, h * 0.032 * (clip.size || 1))
  const style: PointerStyle = clip.style === 'auto' || !clip.style ? (f.toTarget < 0.035 && clip.action !== 'drag' ? 'hand' : 'arrow') : clip.style
  // Velocity (px/s) from a frame earlier — drives the lean and the trail.
  const prev = cursorAt(clip, Math.max(0, local - 1 / 60))
  const vx = (f.x - prev.x) * w * 60, vy = (f.y - prev.y) * h * 60
  const speed = Math.hypot(vx, vy)
  ctx.save()
  ctx.globalAlpha *= f.alpha
  const base = ctx.globalAlpha
  // Ripples (under the pointer): outer ring + soft fill.
  for (const r of f.ripples) {
    ctx.beginPath()
    ctx.arc(r.x * w, r.y * h, size * (0.4 + r.p * 1.7), 0, Math.PI * 2)
    ctx.strokeStyle = clip.rippleColor
    ctx.globalAlpha = base * r.alpha * 0.9
    ctx.lineWidth = Math.max(1.5, size * 0.12 * (1 - r.p * 0.6))
    ctx.stroke()
    ctx.globalAlpha = base * r.alpha * 0.18
    ctx.fillStyle = clip.rippleColor
    ctx.fill()
  }
  const px = f.x * w, py = f.y * h
  if (f.flash > 0) {
    const g = ctx.createRadialGradient(px, py, 0, px, py, size * 1.3)
    g.addColorStop(0, clip.rippleColor)
    g.addColorStop(1, 'rgba(0,0,0,0)')
    ctx.globalAlpha = base * f.flash * 0.45
    ctx.fillStyle = g
    ctx.beginPath(); ctx.arc(px, py, size * 1.3, 0, Math.PI * 2); ctx.fill()
  }
  const lean = Math.max(-0.16, Math.min(0.16, vx / (size * 90)))
  // Motion-blur trail: fading ghosts along the recent path when moving fast.
  if (clip.trail !== false && speed > size * 6) {
    for (let i = 3; i >= 1; i--) {
      const g = cursorAt(clip, Math.max(0, local - i * 0.016))
      ctx.save()
      ctx.globalAlpha = base * Math.min(0.28, speed / (size * 120)) / i
      ctx.translate(g.x * w, g.y * h)
      ctx.rotate(lean)
      drawPointer(ctx, style, size, clip.color)
      ctx.restore()
    }
  }
  ctx.globalAlpha = base
  ctx.translate(px, py)
  ctx.rotate(lean)
  ctx.scale(f.press, f.press)
  drawPointer(ctx, style, size, clip.color)
  ctx.restore()
}

/* ───────────────────────────── 3D projection ───────────────────────────── */

export function has3D(c: { tiltX?: number; turnY?: number }): boolean {
  return Math.abs(c.tiltX ?? 0) > 0.05 || Math.abs(c.turnY ?? 0) > 0.05
}

/**
 * Draw `src` (a full-frame layer) onto `ctx`, rotated in 3D about (cx, cy)
 * with perspective `persp` (px at the layer's scale). Implemented as two
 * strip passes (turn about Y, then tilt about X) — exact per strip, so text
 * and edges stay sharp; strips are 1/`strips` of the frame.
 */
export function project3D(
  ctx: CanvasRenderingContext2D,
  src: HTMLCanvasElement,
  temp: { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D },
  cx: number,
  cy: number,
  tiltXDeg: number,
  turnYDeg: number,
  perspPx: number,
  w: number,
  h: number,
  strips = 160,
) {
  const P = Math.max(200, perspPx)
  const ty = (turnYDeg * Math.PI) / 180
  const tx = (tiltXDeg * Math.PI) / 180
  const sx = src.width / w, sy = src.height / h
  // Pass 1 — turn about the vertical axis through cx: vertical strips.
  let stage: HTMLCanvasElement = src
  if (Math.abs(ty) > 0.0009) {
    temp.ctx.setTransform(1, 0, 0, 1, 0, 0)
    temp.ctx.clearRect(0, 0, temp.canvas.width, temp.canvas.height)
    const cos = Math.cos(ty), sin = Math.sin(ty)
    const step = w / strips
    for (let i = 0; i < strips; i++) {
      const u0 = i * step - cx, u1 = (i + 1) * step - cx
      const z0 = u0 * sin, z1 = u1 * sin
      const s0 = P / (P + z0), s1 = P / (P + z1)
      if (s0 <= 0 || s1 <= 0) continue
      const x0 = cx + u0 * cos * s0, x1 = cx + u1 * cos * s1
      const sm = (s0 + s1) / 2
      const dw = x1 - x0
      if (Math.abs(dw) < 0.01) continue
      const left = Math.min(x0, x1)
      temp.ctx.save()
      if (dw < 0) { temp.ctx.translate(left + Math.abs(dw), 0); temp.ctx.scale(-1, 1); temp.ctx.translate(-left, 0) }
      temp.ctx.drawImage(src, i * step * sx, 0, step * sx + 1, src.height, left * sx, (cy - cy * sm) * sy, (Math.abs(dw) + 0.6) * sx, h * sm * sy)
      temp.ctx.restore()
    }
    stage = temp.canvas
  }
  // Pass 2 — tilt about the horizontal axis through cy: horizontal strips.
  if (Math.abs(tx) > 0.0009) {
    const cos = Math.cos(tx), sin = Math.sin(tx)
    const step = h / strips
    for (let i = 0; i < strips; i++) {
      const v0 = i * step - cy, v1 = (i + 1) * step - cy
      const z0 = -v0 * sin, z1 = -v1 * sin
      const s0 = P / (P + z0), s1 = P / (P + z1)
      if (s0 <= 0 || s1 <= 0) continue
      const y0 = cy + v0 * cos * s0, y1 = cy + v1 * cos * s1
      const sm = (s0 + s1) / 2
      const dh = y1 - y0
      if (Math.abs(dh) < 0.01) continue
      ctx.drawImage(stage, 0, i * step * sy, stage.width, step * sy + 1, cx - cx * sm, Math.min(y0, y1), w * sm, Math.abs(dh) + 0.6)
    }
  } else {
    ctx.drawImage(stage, 0, 0, w, h)
  }
}
