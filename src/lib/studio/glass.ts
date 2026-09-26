/**
 * Canvas liquid glass.
 *
 * `backdrop-filter` cannot be recorded into a video, so the Studio reproduces
 * the material with 2D canvas operations against the frame already painted
 * underneath: blur + a magnifying bulge for refraction, a chromatic fringe at
 * the rim, then the rim light and a specular sweep.
 *
 * Everything here is a pure function of (rect, params, progress).
 */

import type { GlassParams } from '../glass'

type Rect = { x: number; y: number; w: number; h: number; radius: number }

/** One scratch canvas per session — glass clips are small and frequent. */
let scratch: HTMLCanvasElement | null = null
function scratchCanvas(w: number, h: number): HTMLCanvasElement | null {
  if (typeof document === 'undefined') return null
  if (!scratch) scratch = document.createElement('canvas')
  if (scratch.width !== w || scratch.height !== h) {
    scratch.width = w
    scratch.height = h
  }
  return scratch
}

function roundedPath(ctx: CanvasRenderingContext2D, rect: Rect) {
  const r = Math.max(0, Math.min(rect.radius, Math.min(rect.w, rect.h) / 2))
  ctx.beginPath()
  ctx.moveTo(rect.x + r, rect.y)
  ctx.lineTo(rect.x + rect.w - r, rect.y)
  ctx.quadraticCurveTo(rect.x + rect.w, rect.y, rect.x + rect.w, rect.y + r)
  ctx.lineTo(rect.x + rect.w, rect.y + rect.h - r)
  ctx.quadraticCurveTo(rect.x + rect.w, rect.y + rect.h, rect.x + rect.w - r, rect.y + rect.h)
  ctx.lineTo(rect.x + r, rect.y + rect.h)
  ctx.quadraticCurveTo(rect.x, rect.y + rect.h, rect.x, rect.y + rect.h - r)
  ctx.lineTo(rect.x, rect.y + r)
  ctx.quadraticCurveTo(rect.x, rect.y, rect.x + r, rect.y)
  ctx.closePath()
}

/**
 * Paint a glass panel over whatever is currently on `ctx`.
 * `progress` (0–1) drives the specular sweep so the highlight travels.
 */
export function paintGlass(
  ctx: CanvasRenderingContext2D,
  rect: Rect,
  params: GlassParams,
  progress = 0,
  scale = 1,
) {
  const { canvas } = ctx
  const sx = Math.max(0, Math.floor(rect.x))
  const sy = Math.max(0, Math.floor(rect.y))
  const sw = Math.max(1, Math.min(Math.ceil(rect.w), canvas.width - sx))
  const sh = Math.max(1, Math.min(Math.ceil(rect.h), canvas.height - sy))
  if (sw <= 0 || sh <= 0) return

  const behind = scratchCanvas(sw, sh)
  const behindCtx = behind?.getContext('2d')
  if (!behind || !behindCtx) return

  // 1. Grab the backdrop.
  behindCtx.clearRect(0, 0, sw, sh)
  behindCtx.drawImage(canvas, sx, sy, sw, sh, 0, 0, sw, sh)

  ctx.save()
  roundedPath(ctx, rect)
  ctx.clip()

  // 2. Frost: blur + saturate, drawn slightly magnified so the edge bends.
  const bulge = 1 + params.strength * 0.14
  const dw = sw * bulge
  const dh = sh * bulge
  const dx = rect.x - (dw - sw) / 2
  const dy = rect.y - (dh - sh) / 2
  const blurPx = (params.blur * scale) / 1
  ctx.filter = `blur(${blurPx.toFixed(2)}px) saturate(${params.saturate})`
  ctx.drawImage(behind, dx, dy, dw, dh)
  ctx.filter = 'none'

  // 3. Chromatic fringe: two extra copies offset in opposite directions,
  //    additive and faint, so colour separates only near the bezel.
  if (params.chroma > 0.02) {
    const shift = params.chroma * 6 * scale
    ctx.globalCompositeOperation = 'lighter'
    ctx.globalAlpha = 0.16 * params.chroma
    ctx.filter = `blur(${(blurPx * 0.6).toFixed(2)}px) hue-rotate(-18deg)`
    ctx.drawImage(behind, dx - shift, dy, dw, dh)
    ctx.filter = `blur(${(blurPx * 0.6).toFixed(2)}px) hue-rotate(18deg)`
    ctx.drawImage(behind, dx + shift, dy, dw, dh)
    ctx.filter = 'none'
    ctx.globalAlpha = 1
    ctx.globalCompositeOperation = 'source-over'
  }

  // 4. Tint.
  ctx.fillStyle = params.tint
  ctx.fillRect(rect.x, rect.y, rect.w, rect.h)

  // 5. Inner glow.
  if (params.glow > 0.01) {
    const glow = ctx.createLinearGradient(rect.x, rect.y, rect.x, rect.y + rect.h)
    glow.addColorStop(0, `rgba(255,255,255,${0.22 * params.glow})`)
    glow.addColorStop(0.5, 'rgba(255,255,255,0)')
    glow.addColorStop(1, `rgba(255,255,255,${0.1 * params.glow})`)
    ctx.fillStyle = glow
    ctx.fillRect(rect.x, rect.y, rect.w, rect.h)
  }

  // 6. Specular sweep — a narrow band travelling along the specular angle.
  if (params.edge > 0.01) {
    const angle = ((params.specularAngle + progress * 360) * Math.PI) / 180
    const cx = rect.x + rect.w / 2
    const cy = rect.y + rect.h / 2
    const reach = Math.hypot(rect.w, rect.h) / 2
    const sweep = ctx.createLinearGradient(
      cx - Math.cos(angle) * reach,
      cy - Math.sin(angle) * reach,
      cx + Math.cos(angle) * reach,
      cy + Math.sin(angle) * reach,
    )
    sweep.addColorStop(0, 'rgba(255,255,255,0)')
    sweep.addColorStop(0.42, `rgba(255,255,255,${0.16 * params.edge})`)
    sweep.addColorStop(0.5, `rgba(255,255,255,${0.34 * params.edge})`)
    sweep.addColorStop(0.58, `rgba(255,255,255,${0.16 * params.edge})`)
    sweep.addColorStop(1, 'rgba(255,255,255,0)')
    ctx.fillStyle = sweep
    ctx.fillRect(rect.x, rect.y, rect.w, rect.h)
  }

  ctx.restore()

  // 7. Rim: a bright hairline plus a soft outer shadow to seat the panel.
  ctx.save()
  roundedPath(ctx, rect)
  ctx.lineWidth = Math.max(1, 1.5 * scale)
  ctx.strokeStyle = `rgba(255,255,255,${0.45 * params.edge})`
  ctx.stroke()
  ctx.restore()
}

/** Circular variant used by the lens clip. */
export function paintGlassLens(
  ctx: CanvasRenderingContext2D,
  centre: { x: number; y: number; r: number },
  params: GlassParams,
  progress = 0,
  scale = 1,
) {
  paintGlass(
    ctx,
    { x: centre.x - centre.r, y: centre.y - centre.r, w: centre.r * 2, h: centre.r * 2, radius: centre.r },
    params,
    progress,
    scale,
  )
}
