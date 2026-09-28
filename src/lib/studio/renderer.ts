/**
 * Studio frame renderer.
 *
 * One pure-ish function draws the whole composition for a time `t` onto a 2D
 * context. The preview loop and the exporter both call it, so what you scrub
 * is exactly what you export — no second code path, no "preview only" effects.
 */

import type {
  StudioClip,
  StudioDoc,
  StudioGradeNode,
  StudioKeyframe,
  StudioMask,
  StudioGlassClip,
  StudioMediaClip,
  StudioOverlayClip,
  StudioStickerClip,
  StudioTextClip,
  StudioTransition,
} from '../../types/project'
import { glassPreset } from '../glass'
import { backgroundById } from './backgrounds'
import { clipProgress, clipsAt } from './doc'
import { drawCursor, drawShape, has3D, project3D } from './renderExtras'
import { cursorAt } from './cursor'
import { drawLoader } from './loaders'
import { drawKit, normaliseKit } from './homeKit'
import { paintGlass, paintGlassLens } from './glass'
import { getMedia, overlayImage, proxyMode } from './media'
import { applyPixelGrade, chromaKey } from './color'
import { bezierEase } from './curves'
import { compareDivider, deviceGeometry } from './layouts'
import { drawDuoPhone, drawPhone, type DrawMedia } from './phone'
import { kineticWord } from './textTools'
import { hasRichMarkup, parseRich, RICH_DEFAULTS, type RichStyle, type RichWord } from './richText'
import type { StudioBlendMode, StudioDevice } from '../../types/project'

export type FrameSources = {
  /** Element to draw for a media clip — supplied by the preview or exporter. */
  media: (clip: StudioMediaClip) => CanvasImageSource | null
  /** Decoded overlay images, keyed by clip id. */
  overlay: (clip: StudioOverlayClip, localSec?: number) => CanvasImageSource | null
  /**
   * The sticker's canvas wound to `localSec` (seconds into the clip).
   * Optional so headless callers can leave it out.
   */
  sticker?: (clip: StudioStickerClip, localSec: number) => CanvasImageSource | null
}

const easeOut = (p: number) => 1 - Math.pow(1 - p, 3)
const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v)

/** Transition envelope: 0 at the very edge, 1 once the clip has settled. */
function transitionAlpha(kind: StudioTransition, edgeProgress: number): number {
  if (kind === 'none') return 1
  return easeOut(clamp01(edgeProgress))
}

const TRANSITION_SEC = 0.4

function edgeProgressIn(clip: StudioClip, t: number): number {
  const span = Math.min(TRANSITION_SEC, clip.durationSec / 2)
  if (span <= 0) return 1
  return clamp01((t - clip.startSec) / span)
}

function edgeProgressOut(clip: StudioClip, t: number): number {
  const span = Math.min(TRANSITION_SEC, clip.durationSec / 2)
  if (span <= 0) return 1
  return clamp01((clip.startSec + clip.durationSec - t) / span)
}

function applyTransition(
  ctx: CanvasRenderingContext2D,
  clip: StudioClip,
  t: number,
  w: number,
  h: number,
): number {
  const inP = edgeProgressIn(clip, t)
  const outP = edgeProgressOut(clip, t)
  let alpha = clip.opacity ?? 1

  if (clip.transitionIn === 'fade') alpha *= transitionAlpha('fade', inP)
  if (clip.transitionOut === 'fade') alpha *= transitionAlpha('fade', outP)

  if (clip.transitionIn === 'zoom-in' && inP < 1) {
    const scale = 1.08 - 0.08 * easeOut(inP)
    ctx.translate(w / 2, h / 2)
    ctx.scale(scale, scale)
    ctx.translate(-w / 2, -h / 2)
    alpha *= easeOut(inP)
  }
  if (clip.transitionIn === 'wipe-left' && inP < 1) {
    ctx.beginPath()
    ctx.rect(0, 0, w * easeOut(inP), h)
    ctx.clip()
  }
  if (clip.transitionOut === 'wipe-left' && outP < 1) {
    ctx.beginPath()
    ctx.rect(w - w * easeOut(outP), 0, w * easeOut(outP), h)
    ctx.clip()
  }

  // Blur through — focus pull. ctx.filter is supported in Chromium/Electron;
  // where it is not, the clip simply fades instead of blurring.
  const blurIn = clip.transitionIn === 'blur' && inP < 1 ? (1 - easeOut(inP)) * 18 : 0
  const blurOut = clip.transitionOut === 'blur' && outP < 1 ? (1 - easeOut(outP)) * 18 : 0
  const liquidIn = clip.transitionIn === 'liquid-dissolve' && inP < 1 ? (1 - easeOut(inP)) : 0
  const liquidOut = clip.transitionOut === 'liquid-dissolve' && outP < 1 ? (1 - easeOut(outP)) : 0
  const blur = Math.max(blurIn, blurOut, liquidIn * 26, liquidOut * 26)
  if (blur > 0.2) {
    ctx.filter = `blur(${blur.toFixed(2)}px)`
    alpha *= 0.55 + 0.45 * (1 - Math.min(1, blur / 26))
  }
  if (liquidIn > 0 || liquidOut > 0) {
    // The "melt": a slight non-uniform scale that settles as it clears.
    const amount = Math.max(liquidIn, liquidOut)
    ctx.translate(w / 2, h / 2)
    ctx.scale(1 + amount * 0.06, 1 + amount * 0.12)
    ctx.translate(-w / 2, -h / 2)
  }

  // Iris — circular reveal from the centre.
  if (clip.transitionIn === 'iris' && inP < 1) {
    const radius = easeOut(inP) * Math.hypot(w, h) * 0.55
    ctx.beginPath()
    ctx.arc(w / 2, h / 2, radius, 0, Math.PI * 2)
    ctx.clip()
  }
  if (clip.transitionOut === 'iris' && outP < 1) {
    const radius = easeOut(outP) * Math.hypot(w, h) * 0.55
    ctx.beginPath()
    ctx.arc(w / 2, h / 2, radius, 0, Math.PI * 2)
    ctx.clip()
  }

  // Push up.
  if (clip.transitionIn === 'push-up' && inP < 1) {
    ctx.translate(0, (1 - easeOut(inP)) * h * 0.33)
    alpha *= easeOut(inP)
  }
  if (clip.transitionOut === 'push-up' && outP < 1) {
    ctx.translate(0, -(1 - easeOut(outP)) * h * 0.33)
    alpha *= easeOut(outP)
  }

  // Glass wipe / lens sweep clip the clip to the area the glass has passed.
  if (clip.transitionIn === 'glass-wipe' && inP < 1) {
    ctx.beginPath()
    ctx.rect(0, 0, w * easeOut(inP), h)
    ctx.clip()
  }
  if (clip.transitionIn === 'lens-sweep' && inP < 1) {
    const cx = easeOut(inP) * w
    ctx.beginPath()
    ctx.arc(cx, h / 2, Math.max(w, h) * easeOut(inP) * 0.9, 0, Math.PI * 2)
    ctx.clip()
  }
  if (clip.transitionOut === 'zoom-in' && outP < 1) {
    const scale = 1 + 0.08 * (1 - easeOut(outP))
    ctx.translate(w / 2, h / 2)
    ctx.scale(scale, scale)
    ctx.translate(-w / 2, -h / 2)
    alpha *= easeOut(outP)
  }
  return clamp01(alpha)
}

function drawFit(
  ctx: CanvasRenderingContext2D,
  source: CanvasImageSource,
  sw: number,
  sh: number,
  w: number,
  h: number,
  fit: 'cover' | 'contain',
  ox = 0,
  oy = 0,
) {
  if (!sw || !sh) return
  const scale = fit === 'cover' ? Math.max(w / sw, h / sh) : Math.min(w / sw, h / sh)
  const dw = sw * scale
  const dh = sh * scale
  ctx.drawImage(source, ox + (w - dw) / 2, oy + (h - dh) / 2, dw, dh)
}

function sourceSize(source: CanvasImageSource): [number, number] {
  if (source instanceof HTMLVideoElement) return [source.videoWidth, source.videoHeight]
  if (source instanceof HTMLImageElement) return [source.naturalWidth, source.naturalHeight]
  if (source instanceof HTMLCanvasElement) return [source.width, source.height]
  return [0, 0]
}

/* ——— text ——— */

/** Line-wrap results keyed by font + width + text. Wrapping is pure, so caching can't change a frame. */
const WRAP_CACHE = new Map<string, string[]>()
function wrapLines(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const key = `${ctx.font}|${Math.round(maxWidth * 100)}|${text}`
  const hit = WRAP_CACHE.get(key)
  if (hit) return hit
  const lines = wrapLinesUncached(ctx, text, maxWidth)
  if (WRAP_CACHE.size > 800) WRAP_CACHE.clear()
  WRAP_CACHE.set(key, lines)
  return lines
}
function wrapLinesUncached(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const out: string[] = []
  for (const paragraph of text.split('\n')) {
    let line = ''
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      const candidate = line ? `${line} ${word}` : word
      if (ctx.measureText(candidate).width > maxWidth && line) {
        out.push(line)
        line = word
      } else {
        line = candidate
      }
    }
    out.push(line)
  }
  return out.length ? out : ['']
}

function captionPreset(style: StudioTextClip['captionStyle']) {
  if (style === 'hormozi') return { uppercase: true, stroke: 6, shadow: 18, boxed: false }
  if (style === 'minimal') return { uppercase: false, stroke: 0, shadow: 0, boxed: true }
  if (style === 'standard') return { uppercase: false, stroke: 3, shadow: 10, boxed: false }
  return { uppercase: false, stroke: 0, shadow: 0, boxed: false }
}


/** Fraction of the frame kept clear of text on every edge. */
export const SAFE_MARGIN = 0.05

/**
 * Pull a text block back inside the title-safe area.
 *
 * Returns the block's anchor point, honouring the clip's alignment (the anchor
 * is the left/centre/right of the box, so each case clamps a different edge).
 * If the block is simply wider than the safe area it stays centred instead of
 * being shoved to one side.
 */
export function clampToSafeArea(
  x: number,
  y: number,
  blockW: number,
  blockH: number,
  align: 'left' | 'center' | 'right',
  w: number,
  h: number,
): { x: number; y: number } {
  const mx = w * SAFE_MARGIN
  const my = h * SAFE_MARGIN
  const left = align === 'left' ? x : align === 'right' ? x - blockW : x - blockW / 2
  let nextLeft = left
  if (blockW >= w - mx * 2) nextLeft = (w - blockW) / 2
  else nextLeft = Math.min(Math.max(left, mx), w - mx - blockW)
  const dx = nextLeft - left
  const top = y - blockH / 2
  const nextTop = blockH >= h - my * 2 ? (h - blockH) / 2 : Math.min(Math.max(top, my), h - my - blockH)
  return { x: x + dx, y: nextTop + blockH / 2 }
}

/**
 * The laid-out size of a text clip as a fraction of the frame, measured with
 * exactly the font, wrapping and line height `drawTextClip` uses — so editor
 * handles hug the painted text instead of guessing from character counts.
 * Takes a context rather than creating one so this module stays DOM-free.
 */
export function measureTextBlock(ctx: CanvasRenderingContext2D, clip: StudioTextClip, w: number, h: number): { w: number; h: number } {
  const preset = captionPreset(clip.captionStyle)
  const fontPx = Math.max(12, (clip.fontSizePct / 100) * h)
  ctx.save()
  ctx.font = `${clip.weight} ${fontPx}px '${clip.fontFamily || 'Inter Variable'}', Inter, system-ui, sans-serif`
  const raw = preset.uppercase ? clip.text.toUpperCase() : clip.text
  const lines = wrapLines(ctx, raw || ' ', w * 0.86)
  const widest = lines.reduce((max, line) => Math.max(max, ctx.measureText(line).width), 0)
  ctx.restore()
  const pad = fontPx * 0.25
  return { w: Math.min(1, (widest + pad * 2) / w), h: Math.min(1, (fontPx * 1.12 * lines.length + pad * 2) / h) }
}


/* ——— legibility (2.14) ——— */

function hexToRgb(color: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color.trim())
  if (!m) return null
  const hex = m[1].length === 3 ? m[1].split('').map((c) => c + c).join('') : m[1]
  return [parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16)]
}

/** WCAG relative luminance of an sRGB colour, 0–1. */
const LINEAR = (() => {
  const t = new Float64Array(256)
  for (let v = 0; v < 256; v++) { const c = v / 255; t[v] = c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4 }
  return t
})()
const linear = (v: number) => (Number.isInteger(v) && v >= 0 && v < 256 ? LINEAR[v] : (() => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4 })())
export function relativeLuminance(r: number, g: number, b: number): number {
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b)
}

/**
 * One small luminance snapshot of the frame, shared by every auto-legibility
 * text clip until something that isn't text is drawn. Replaces one full-size
 * getImageData (a GPU readback stall) per text clip per frame with at most a
 * tiny readback per background change. Same code path in preview and export.
 */
const LUMA_W = 120
let lumaFrame: CanvasRenderingContext2D | null = null
let lumaValid = false
let lumaSnap: { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D; data: Uint8ClampedArray | null; w: number; h: number } | null = null
function lumaInvalidate() { lumaValid = false }
function lumaSnapshot(frame: CanvasRenderingContext2D) {
  if (typeof document === 'undefined') return null
  if (!lumaSnap) {
    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d', { willReadFrequently: true } as CanvasRenderingContext2DSettings) as CanvasRenderingContext2D | null
    if (!ctx) return null
    lumaSnap = { canvas, ctx, data: null, w: 0, h: 0 }
  }
  if (lumaValid && lumaSnap.data) return lumaSnap
  const src = frame.canvas
  const w = LUMA_W, h = Math.max(2, Math.round((LUMA_W * (src.height || 1)) / (src.width || 1)))
  if (lumaSnap.canvas.width !== w || lumaSnap.canvas.height !== h) { lumaSnap.canvas.width = w; lumaSnap.canvas.height = h }
  try {
    lumaSnap.ctx.clearRect(0, 0, w, h)
    lumaSnap.ctx.drawImage(src as CanvasImageSource, 0, 0, w, h)
    lumaSnap.data = lumaSnap.ctx.getImageData(0, 0, w, h).data
  } catch { return null }
  lumaSnap.w = w; lumaSnap.h = h; lumaValid = true
  return lumaSnap
}

export function contrastRatio(a: number, b: number): number {
  const hi = Math.max(a, b)
  const lo = Math.min(a, b)
  return (hi + 0.05) / (lo + 0.05)
}

/**
 * Decide whether text needs a scrim over a region with the given mean
 * luminance and spread. Pure, so the rule is testable without a canvas.
 * Returns the scrim tone to use, or null when the text already reads.
 */
export function legibilityVerdict(textLum: number, bgMean: number, bgSpread: number): 'dark' | 'light' | null {
  const busy = bgSpread > 0.2
  const lowContrast = contrastRatio(textLum, bgMean) < 4.5
  if (!busy && !lowContrast) return null
  // Light text gets a dark scrim, dark text a light one.
  return textLum > 0.4 ? 'dark' : 'light'
}

function sampleBuffer(data: Uint8ClampedArray, bw: number, bh: number, x: number, y: number, rw: number, rh: number): { mean: number; spread: number } | null {
  const x0 = Math.max(0, Math.floor(x)), y0 = Math.max(0, Math.floor(y))
  const x1 = Math.min(bw, Math.ceil(x + rw)), y1 = Math.min(bh, Math.ceil(y + rh))
  if (data.length < bw * bh * 4) return null
  const step = Math.max(1, Math.floor(Math.sqrt(((x1 - x0) * (y1 - y0)) / 240)))
  let sum = 0, sumSq = 0, n = 0
  for (let yy = y0; yy < y1; yy += step) for (let xx = x0; xx < x1; xx += step) {
    const i = (yy * bw + xx) * 4
    if (data[i + 3] === 0) continue
    const l = relativeLuminance(data[i], data[i + 1], data[i + 2])
    sum += l; sumSq += l * l; n++
  }
  if (!n) return null
  const mean = sum / n
  return { mean, spread: Math.sqrt(Math.max(0, sumSq / n - mean * mean)) }
}

function sampleRegionLuminance(ctx: CanvasRenderingContext2D, x: number, y: number, rw: number, rh: number, w: number, h: number): { mean: number; spread: number } | null {
  if (typeof ctx.getImageData !== 'function' || !ctx.canvas) return null
  if (ctx === lumaFrame) {
    const snap = lumaSnapshot(ctx)
    if (snap?.data) return sampleBuffer(snap.data, snap.w, snap.h, (x / w) * snap.w, (y / h) * snap.h, (rw / w) * snap.w, (rh / h) * snap.h)
  }
  const kx = (ctx.canvas.width || w) / w
  const ky = (ctx.canvas.height || h) / h
  const sx = Math.max(0, Math.floor(x * kx))
  const sy = Math.max(0, Math.floor(y * ky))
  const sw = Math.min((ctx.canvas.width || w) - sx, Math.ceil(rw * kx))
  const sh = Math.min((ctx.canvas.height || h) - sy, Math.ceil(rh * ky))
  if (sw < 2 || sh < 2) return null
  let data: Uint8ClampedArray
  try {
    data = ctx.getImageData(sx, sy, sw, sh).data
  } catch {
    return null // tainted canvas — say nothing rather than guess
  }
  // ~600 samples on a fixed grid: cheap and deterministic.
  const step = Math.max(1, Math.floor(Math.sqrt((sw * sh) / 600)))
  let sum = 0
  let sumSq = 0
  let n = 0
  for (let yy = 0; yy < sh; yy += step) {
    for (let xx = 0; xx < sw; xx += step) {
      const i = (yy * sw + xx) * 4
      if (data[i + 3] === 0) continue
      const l = relativeLuminance(data[i], data[i + 1], data[i + 2])
      sum += l
      sumSq += l * l
      n += 1
    }
  }
  if (!n) return null
  const mean = sum / n
  return { mean, spread: Math.sqrt(Math.max(0, sumSq / n - mean * mean)) }
}

function paintLegibilityScrim(
  ctx: CanvasRenderingContext2D,
  clip: StudioTextClip,
  cx: number,
  cy: number,
  textW: number,
  textH: number,
  fontPx: number,
  alpha: number,
  w: number,
  h: number,
) {
  const mode = clip.legibility ?? 'auto'
  if (mode === 'off' || !clip.text.trim()) return
  // Caption presets with their own plate already guarantee contrast.
  if (clip.captionStyle === 'hormozi') return
  const left = clip.align === 'left' ? cx : clip.align === 'right' ? cx - textW : cx - textW / 2
  const padX = fontPx * 0.6
  const padY = fontPx * 0.4
  const rx = left - padX
  const ry = cy - textH / 2 - padY
  const rw = textW + padX * 2
  const rh = textH + padY * 2
  const rgb = hexToRgb(clip.color) ?? [255, 255, 255]
  const textLum = relativeLuminance(rgb[0], rgb[1], rgb[2])
  let tone: 'dark' | 'light' | null
  if (mode === 'on') {
    tone = textLum > 0.4 ? 'dark' : 'light'
  } else {
    const region = sampleRegionLuminance(ctx, rx, ry, rw, rh, w, h)
    tone = region ? legibilityVerdict(textLum, region.mean, region.spread) : null
  }
  if (!tone) return
  const strength = Math.max(0, Math.min(1, clip.scrimStrength ?? 0.55))
  if (strength <= 0) return
  ctx.save()
  ctx.globalAlpha *= alpha
  const color = tone === 'dark' ? `rgba(8,8,12,${strength})` : `rgba(250,249,245,${strength})`
  // A soft-edged plate sized to the text block, never a full-frame tint.
  ctx.shadowColor = color
  ctx.shadowBlur = fontPx * 0.9
  ctx.fillStyle = color
  const r = Math.min(rh / 2, fontPx * 0.5)
  ctx.beginPath()
  if (typeof ctx.roundRect === 'function') ctx.roundRect(rx, ry, rw, rh, r)
  else ctx.rect(rx, ry, rw, rh)
  ctx.fill()
  ctx.restore()
}

function drawTextClip(ctx: CanvasRenderingContext2D, clip: StudioTextClip, t: number, w: number, h: number) {
  if (hasRichMarkup(clip.text)) { drawRichText(ctx, clip, t, w, h); return }
  const progress = clipProgress(clip, t)
  const preset = captionPreset(clip.captionStyle)
  const fontPx = Math.max(12, (clip.fontSizePct / 100) * h)
  const family = clip.fontFamily || 'Inter Variable'
  ctx.font = `${clip.weight} ${fontPx}px '${family}', Inter, system-ui, sans-serif`
  ctx.textBaseline = 'middle'
  ctx.textAlign = clip.align

  const raw = preset.uppercase ? clip.text.toUpperCase() : clip.text
  const maxWidth = w * 0.86
  let lines = wrapLines(ctx, raw, maxWidth)

  // Entrance animations. Every one is a pure function of progress.
  let alpha = 1
  let offsetY = 0
  let scale = 1
  const inP = clamp01(progress / 0.22)

  if (clip.anim === 'fade-up') {
    alpha = easeOut(inP)
    offsetY = (1 - easeOut(inP)) * fontPx * 0.5
  } else if (clip.anim === 'pop') {
    const p = easeOut(inP)
    alpha = p
    scale = 0.96 + 0.04 * p + Math.sin(inP * Math.PI) * 0.03
  } else if (clip.anim === 'slide-left') {
    alpha = easeOut(inP)
  } else if (clip.anim === 'typewriter') {
    const chars = Math.round(raw.length * clamp01(progress / 0.6))
    lines = wrapLines(ctx, raw.slice(0, chars), maxWidth)
  } else if (clip.anim === 'glass-rise') {
    alpha = easeOut(inP)
    offsetY = (1 - easeOut(inP)) * fontPx * 0.9
  } else if (clip.anim === 'shimmer' || clip.anim === 'liquid-wave') {
    alpha = easeOut(inP)
  }

  const lineHeight = fontPx * 1.12
  const totalH = lineHeight * lines.length
  const rawCx = clip.x * w + (clip.anim === 'slide-left' ? (1 - easeOut(inP)) * w * 0.08 : 0)
  const rawCy = clip.y * h + offsetY
  // Title-safe margin. Broadcast convention is 5%; phones crop the very edge
  // and social UI eats the bottom, so text is nudged back inside rather than
  // clipped. Measured off the real line box, not a guess.
  const widestLine = lines.reduce((max, line) => Math.max(max, ctx.measureText(line).width), 0)
  const { x: cx, y: cy } = clampToSafeArea(rawCx, rawCy, widestLine, totalH, clip.align, w, h)

  // Legibility (2.14): a soft scrim behind the text block when what is under
  // it is too close to the text colour or too busy to read against. Measured
  // from the pixels already painted this frame, so it is a pure function of
  // the frame — preview and export make the same call.
  paintLegibilityScrim(ctx, clip, cx, cy, widestLine, totalH, fontPx, alpha, w, h)

  if (clip.anim === 'glass-rise') {
    // Frosted plate rises with the text and clears as it settles.
    const widest = lines.reduce((max, line) => Math.max(max, ctx.measureText(line).width), 0)
    const padX = fontPx * 0.7
    const padY = fontPx * 0.45
    const plateW = widest + padX * 2
    const plateH = totalH + padY * 2
    ctx.save()
    ctx.globalAlpha *= easeOut(inP) * (0.35 + 0.65 * (1 - easeOut(inP)) + 0.35)
    paintGlass(
      ctx,
      { x: cx - plateW / 2, y: cy - plateH / 2, w: plateW, h: plateH, radius: Math.min(plateH / 2, fontPx * 0.5) },
      glassPreset('frost').params,
      progress,
      w / 1080,
    )
    ctx.restore()
  }

  ctx.save()
  ctx.globalAlpha *= alpha
  ctx.translate(cx, cy)
  ctx.scale(scale, scale)

  const anchorX = clip.align === 'left' ? -maxWidth / 2 : clip.align === 'right' ? maxWidth / 2 : 0

  lines.forEach((line, index) => {
    let y = -totalH / 2 + lineHeight * (index + 0.5)
    if (clip.anim === 'liquid-wave') {
      // Each line rides the same wave, offset in phase, settling to zero.
      const settle = 1 - easeOut(clamp01(progress / 0.5))
      y += Math.sin(progress * Math.PI * 4 + index * 0.9) * fontPx * 0.35 * settle
    }

    if (preset.boxed) {
      const metrics = ctx.measureText(line)
      const padX = fontPx * 0.35
      const padY = fontPx * 0.22
      const boxW = metrics.width + padX * 2
      const boxLeft = clip.align === 'center' ? -boxW / 2 : clip.align === 'left' ? anchorX - padX : anchorX - boxW + padX
      ctx.fillStyle = 'rgba(11,11,16,0.62)'
      ctx.fillRect(boxLeft, y - lineHeight / 2 - padY / 2, boxW, lineHeight + padY)
    }

    if (preset.shadow) {
      ctx.shadowColor = 'rgba(0,0,0,0.65)'
      ctx.shadowBlur = preset.shadow
      ctx.shadowOffsetY = preset.shadow * 0.25
    }
    if (clip.textGlow && !preset.shadow) {
      ctx.shadowColor = clip.color
      ctx.shadowBlur = fontPx * 0.6 * clip.textGlow
    }
    if (preset.stroke) {
      ctx.lineJoin = 'round'
      ctx.lineWidth = preset.stroke * (fontPx / 64)
      ctx.strokeStyle = '#0B0B10'
      ctx.strokeText(line, anchorX, y)
    }

    // Word-by-word reveal + optional highlight word (Hormozi-style punch).
    if (clip.anim === 'kinetic') {
      // 2.18 — each word lands on its own beat (pure function of progress).
      const words = line.split(' ')
      const widths = words.map((word) => ctx.measureText(`${word} `).width)
      const lineWidth = widths.reduce((a, b) => a + b, 0) - (widths.length ? ctx.measureText(' ').width : 0)
      let cursor = clip.align === 'center' ? -lineWidth / 2 : clip.align === 'left' ? anchorX : anchorX - lineWidth
      const prevAlign = ctx.textAlign
      ctx.textAlign = 'left'
      const totalWords = raw.split(/\s+/).filter(Boolean).length || 1
      let seen = lines.slice(0, index).join(' ').split(/\s+/).filter(Boolean).length
      for (let i = 0; i < words.length; i++) {
        const st = kineticWord(seen, totalWords, progress)
        seen += 1
        if (st.alpha > 0) {
          const isHighlight = clip.highlightWord && words[i].toLowerCase().replace(/[^a-z0-9]/g, '') === clip.highlightWord.toLowerCase()
          ctx.save()
          ctx.globalAlpha *= st.alpha
          const wx = cursor + ctx.measureText(words[i]).width / 2
          ctx.translate(wx, y + st.dy * fontPx)
          ctx.scale(st.scale, st.scale)
          ctx.fillStyle = isHighlight ? (clip.emphasisColor || '#C8F542') : clip.color
          ctx.textAlign = 'center'
          if (preset.stroke) ctx.strokeText(words[i], 0, 0)
          ctx.fillText(words[i], 0, 0)
          ctx.restore()
        }
        cursor += widths[i]
      }
      ctx.textAlign = prevAlign
    } else if (clip.anim === 'word-reveal' || clip.highlightWord) {
      const words = line.split(' ')
      const widths = words.map((word) => ctx.measureText(`${word} `).width)
      const lineWidth = widths.reduce((a, b) => a + b, 0) - (widths.length ? ctx.measureText(' ').width : 0)
      let cursor = clip.align === 'center' ? -lineWidth / 2 : clip.align === 'left' ? anchorX : anchorX - lineWidth
      const prevAlign = ctx.textAlign
      ctx.textAlign = 'left'
      const totalWords = raw.split(/\s+/).filter(Boolean).length || 1
      const shownWords = clip.anim === 'word-reveal' ? Math.ceil(clamp01(progress / 0.55) * totalWords) : totalWords
      let seen = lines.slice(0, index).join(' ').split(/\s+/).filter(Boolean).length

      for (let i = 0; i < words.length; i++) {
        seen += 1
        const visible = seen <= shownWords
        if (visible) {
          const isHighlight =
            clip.highlightWord && words[i].toLowerCase().replace(/[^a-z0-9]/g, '') === clip.highlightWord.toLowerCase()
          ctx.fillStyle = isHighlight ? (clip.emphasisColor || '#C8F542') : clip.color
          if (preset.stroke) ctx.strokeText(words[i], cursor, y)
          ctx.fillText(words[i], cursor, y)
        }
        cursor += widths[i]
      }
      ctx.textAlign = prevAlign
    } else {
      ctx.fillStyle = clip.color
      ctx.fillText(line, anchorX, y)
    }
    ctx.shadowBlur = 0
    ctx.shadowOffsetY = 0

    if (clip.anim === 'shimmer') {
      // Specular sweep: a moving gradient painted only over the glyphs.
      const metrics = ctx.measureText(line)
      const left = clip.align === 'center' ? -metrics.width / 2 : clip.align === 'left' ? anchorX : anchorX - metrics.width
      const sweepX = left - metrics.width * 0.4 + ((progress * 1.6) % 1.4) * metrics.width * 1.4
      const grad = ctx.createLinearGradient(sweepX - metrics.width * 0.25, 0, sweepX + metrics.width * 0.25, 0)
      grad.addColorStop(0, 'rgba(255,255,255,0)')
      grad.addColorStop(0.5, 'rgba(255,255,255,0.85)')
      grad.addColorStop(1, 'rgba(255,255,255,0)')
      const prevOp = ctx.globalCompositeOperation
      ctx.globalCompositeOperation = 'source-atop'
      ctx.fillStyle = grad
      ctx.fillText(line, anchorX, y)
      ctx.globalCompositeOperation = prevOp
    }
  })

  ctx.restore()
}

/**
 * The moving glass used by `glass-wipe` and `lens-sweep`. Drawn *after* the
 * clip so it refracts the frame the transition has just revealed.
 */
function paintTransitionGlass(ctx: CanvasRenderingContext2D, clip: StudioClip, t: number, w: number, h: number) {
  const inP = edgeProgressIn(clip, t)
  if (inP >= 1) return
  const params = glassPreset('hero').params
  const scale = w / 1080

  if (clip.transitionIn === 'glass-wipe') {
    const x = easeOut(inP) * w
    const barWidth = Math.max(40, w * 0.09)
    paintGlass(
      ctx,
      { x: x - barWidth / 2, y: 0, w: barWidth, h, radius: barWidth * 0.2 },
      params,
      inP,
      scale,
    )
  } else if (clip.transitionIn === 'lens-sweep') {
    const radius = Math.max(w, h) * 0.22
    paintGlassLens(ctx, { x: easeOut(inP) * w, y: h / 2, r: radius }, params, inP, scale)
  }
}

/* ——— glass clips ——— */

function drawGlassClip(ctx: CanvasRenderingContext2D, clip: StudioGlassClip, t: number, w: number, h: number) {
  const progress = clipProgress(clip, t)
  const params = glassPreset(clip.presetId).params
  const scale = w / 1080

  // Motion presets are pure functions of progress.
  let cx = clip.x * w
  let cy = clip.y * h
  let sizeScale = 1
  let sweep = 0
  if (clip.motion === 'drift') {
    cx += Math.sin(progress * Math.PI * 2) * w * 0.05
    cy += Math.cos(progress * Math.PI * 2) * h * 0.025
  } else if (clip.motion === 'sweep') {
    cx = (0.15 + 0.7 * easeOut(Math.min(1, progress / 0.85))) * w
    sweep = progress
  } else if (clip.motion === 'pop') {
    const p = easeOut(Math.min(1, progress / 0.22))
    sizeScale = 0.94 + 0.06 * p + Math.sin(Math.min(1, progress / 0.22) * Math.PI) * 0.03
  }

  const boxW = clip.w * w * sizeScale
  const boxH = clip.h * h * sizeScale

  if (clip.shape === 'lens') {
    paintGlassLens(ctx, { x: cx, y: cy, r: Math.min(boxW, boxH) / 2 }, params, sweep, scale)
  } else {
    paintGlass(
      ctx,
      { x: cx - boxW / 2, y: cy - boxH / 2, w: boxW, h: boxH, radius: (clip.radiusPct / 100) * Math.min(boxW, boxH) },
      params,
      sweep,
      scale,
    )
  }

  if (clip.label.trim()) {
    ctx.save()
    // Sized to the panel, then shrunk until it fits inside the panel's width:
    // a long label used to spill past both edges of a small pill.
    let fontPx = Math.max(12, boxH * 0.26)
    ctx.font = `600 ${fontPx}px 'Inter Variable', Inter, system-ui, sans-serif`
    const labelW = ctx.measureText(clip.label).width
    if (labelW > boxW * 0.84) {
      fontPx = Math.max(10, fontPx * ((boxW * 0.84) / labelW))
      ctx.font = `600 ${fontPx}px 'Inter Variable', Inter, system-ui, sans-serif`
    }
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillStyle = clip.labelColor
    ctx.fillText(clip.label, cx, cy)
    ctx.restore()
  }
}



/* ——— keyframes ——— */

const EASES: Record<StudioKeyframe['ease'], (p: number) => number> = {
  linear: (p) => p,
  'ease-in': (p) => p * p * p,
  'ease-out': (p) => 1 - Math.pow(1 - p, 3),
  'ease-in-out': (p) => (p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2),
  // Overshoot a touch, then settle — the "designed" entrance.
  'back-out': (p) => 1 + 2.70158 * Math.pow(p - 1, 3) + 1.70158 * Math.pow(p - 1, 2),
  // Wind up slightly before leaving — a purposeful exit.
  'back-in': (p) => 2.70158 * p * p * p - 1.70158 * p * p,
  // Fast start, long glide: the premium UI / title curve.
  'expo-out': (p) => (p >= 1 ? 1 : 1 - Math.pow(2, -10 * p)),
  'expo-in-out': (p) =>
    p <= 0 ? 0 : p >= 1 ? 1 : p < 0.5 ? Math.pow(2, 20 * p - 10) / 2 : (2 - Math.pow(2, -20 * p + 10)) / 2,
  // A damped spring for stickers, icons and playful pops.
  'elastic-out': (p) => (p <= 0 ? 0 : p >= 1 ? 1 : Math.pow(2, -10 * p) * Math.sin((p * 10 - 0.75) * ((2 * Math.PI) / 3)) + 1),
  // Step: hold this value, then cut to the next key.
  hold: (p) => (p >= 1 ? 1 : 0),
  // Custom curves are resolved per keyframe (see keyframeValuesAt).
  bezier: (p) => p,
}

/** The animated properties, resolved at time `t`. */
export type KeyframeValues = { x?: number; y?: number; scale?: number; rotation?: number; opacity?: number; blur?: number; glow?: number; hue?: number; tiltX?: number; turnY?: number }

/**
 * Interpolate a clip's keyframes at document time `t`.
 *
 * Before the first keyframe the first value holds; after the last, the last
 * holds — the same convention every NLE uses, and the one that makes a single
 * keyframe mean "set this value" rather than "animate from nothing".
 */
export function keyframeValuesAt(clip: StudioClip, t: number): KeyframeValues | null {
  const keys = clip.keyframes
  if (!keys || keys.length === 0) return null
  const local = t - clip.startSec
  const sorted = keys.length > 1 ? [...keys].sort((a, b) => a.at - b.at) : keys

  if (local <= sorted[0].at) return pick(sorted[0])
  const last = sorted[sorted.length - 1]
  if (local >= last.at) return pick(last)

  for (let i = 0; i < sorted.length - 1; i += 1) {
    const a = sorted[i]
    const b = sorted[i + 1]
    if (local < a.at || local > b.at) continue
    const span = b.at - a.at
    const raw = span <= 0 ? 1 : (local - a.at) / span
    const p = a.ease === 'bezier' && a.bezier ? bezierEase(a.bezier, clamp01(raw)) : (EASES[a.ease] ?? EASES.linear)(clamp01(raw))
    return {
      x: mix(a.x, b.x, p),
      y: mix(a.y, b.y, p),
      scale: mix(a.scale, b.scale, p),
      rotation: mix(a.rotation, b.rotation, p),
      opacity: mix(a.opacity, b.opacity, p),
      blur: mix(a.blur, b.blur, p),
      glow: mix(a.glow, b.glow, p),
      hue: mix(a.hue, b.hue, p),
      tiltX: mix(a.tiltX, b.tiltX, p),
      turnY: mix(a.turnY, b.turnY, p),
    }
  }
  return pick(last)
}

function pick(key: StudioKeyframe): KeyframeValues {
  return { x: key.x, y: key.y, scale: key.scale, rotation: key.rotation, opacity: key.opacity, blur: key.blur, glow: key.glow, hue: key.hue, tiltX: key.tiltX, turnY: key.turnY }
}

/** Interpolate two optional numbers: a missing end holds the start, and vice versa. */
function mix(a: number | undefined, b: number | undefined, p: number): number | undefined {
  if (a === undefined) return b === undefined ? undefined : b
  if (b === undefined) return a
  return a + (b - a) * p
}

/**
 * A copy of the clip with its keyframed values applied.
 *
 * Returning a patched clip rather than mutating the context means every draw
 * path — text, glass, stickers, overlays — gets animation for free, without
 * each one having to know keyframes exist.
 */
function animatedClip(clip: StudioClip, t: number): StudioClip {
  const values = keyframeValuesAt(clip, t)
  if (!values) return clip
  const next = { ...clip } as StudioClip & { x?: number; y?: number; scale?: number; fontSizePct?: number }
  if (values.x !== undefined && ('x' in clip || clip.kind === 'video' || clip.kind === 'image')) next.x = values.x
  if (values.y !== undefined && ('y' in clip || clip.kind === 'video' || clip.kind === 'image')) next.y = values.y
  if (values.rotation !== undefined) next.rotation = values.rotation
  if (values.tiltX !== undefined) next.tiltX = values.tiltX
  if (values.turnY !== undefined) next.turnY = values.turnY
  if (values.opacity !== undefined) next.opacity = clip.opacity * values.opacity
  if (values.scale !== undefined) {
    // "Scale" means whatever size means for this kind of clip.
    if (clip.kind === 'overlay' || clip.kind === 'sticker' || clip.kind === 'cursor') (next as { scale?: number; size?: number }).scale = clip.kind === 'cursor' ? undefined : clip.scale * values.scale
    else if (clip.kind === 'shape') (next as unknown as { w: number }).w = clip.w * values.scale
    else if (clip.kind === 'loader') (next as unknown as { size: number }).size = clip.size * values.scale
    else if (clip.kind === 'kit') (next as unknown as { w: number }).w = clip.w * values.scale
    else if (clip.kind === 'video' || clip.kind === 'image') next.scale = (clip.scale ?? 1) * values.scale
    else if (clip.kind === 'text') next.fontSizePct = clip.fontSizePct * values.scale
    else if (clip.kind === 'glass') {
      ;(next as unknown as { w: number; h: number }).w = clip.w * values.scale
      ;(next as unknown as { w: number; h: number }).h = clip.h * values.scale
    }
  }
  return next
}

/* ——— rotation, grade and matte ———
 *
 * These three apply to any clip, so they live outside the per-kind draw code:
 * the frame loop rotates, filters and mattes whatever the clip happens to be.
 */

/** Where a clip pivots. Positioned clips turn about themselves, full-frame ones about the frame. */
function clipCentre(clip: StudioClip, w: number, h: number): { cx: number; cy: number } {
  if (clip.kind === 'text' || clip.kind === 'overlay' || clip.kind === 'glass' || clip.kind === 'sticker' || clip.kind === 'shape' || clip.kind === 'cursor' || clip.kind === 'loader' || clip.kind === 'kit') {
    return { cx: clip.x * w, cy: clip.y * h }
  }
  if (clip.kind === 'video' || clip.kind === 'image') {
    return { cx: (clip.x ?? 0.5) * w, cy: (clip.y ?? 0.5) * h }
  }
  return { cx: w / 2, cy: h / 2 }
}

/**
 * CSS filter string for a grade chain.
 *
 * Canvas filters are the same primitives CSS has, so the grade is expressed in
 * them and costs nothing extra — the GPU applies it during the draw. Two
 * approximations are deliberate and documented rather than hidden:
 * temperature is a sepia/hue-rotate pair (there is no white-balance
 * primitive), and `fade` lifts the blacks by trading contrast for brightness.
 */
export function gradeFilter(nodes: StudioGradeNode[] | null | undefined): string {
  if (!nodes || !nodes.length) return ''
  const parts: string[] = []
  for (const node of nodes) {
    if (!node.enabled) continue
    if (node.id === 'balance') {
      if (node.exposure) parts.push(`brightness(${(1 + node.exposure / 100).toFixed(4)})`)
      if (node.temperature) {
        const k = Math.min(Math.abs(node.temperature), 100) / 100
        parts.push(`sepia(${(k * 0.55).toFixed(4)})`)
        // Cool is the same tint rotated to the other side of the wheel.
        parts.push(`hue-rotate(${node.temperature >= 0 ? 0 : 175}deg)`)
        parts.push(`saturate(${(1 + k * 0.25).toFixed(4)})`)
      }
    } else if (node.id === 'contrast') {
      if (node.contrast) parts.push(`contrast(${(1 + node.contrast / 100).toFixed(4)})`)
      if (node.fade > 0) {
        parts.push(`contrast(${(1 - node.fade / 250).toFixed(4)})`)
        parts.push(`brightness(${(1 + node.fade / 400).toFixed(4)})`)
      }
    } else if (node.id === 'look') {
      if (node.saturation) parts.push(`saturate(${(1 + node.saturation / 100).toFixed(4)})`)
      if (node.hue) parts.push(`hue-rotate(${Math.round(node.hue * 1.8)}deg)`)
    }
  }
  return parts.join(' ')
}

/** Keyframed focus / bloom / colour drift as CSS filter primitives (scaled to frame height). */
export function keyframeFilter(clip: StudioClip, t: number, height: number): string {
  const v = keyframeValuesAt(clip, t)
  if (!v) return ''
  const parts: string[] = []
  if (v.blur !== undefined && v.blur > 0.01) parts.push(`blur(${((v.blur * height) / 1080).toFixed(2)}px)`)
  if (v.glow !== undefined && v.glow > 0.001) parts.push(`brightness(${(1 + v.glow * 0.6).toFixed(3)}) saturate(${(1 + v.glow * 0.25).toFixed(3)})`, `drop-shadow(0 0 ${((v.glow * 24 * height) / 1080).toFixed(1)}px rgba(255,255,255,${(v.glow * 0.55).toFixed(2)}))`)
  if (v.hue !== undefined && Math.abs(v.hue) > 0.05) parts.push(`hue-rotate(${v.hue.toFixed(1)}deg)`)
  return parts.join(' ')
}

/**
 * A mask that follows its tracked path. `track` points are clip-local seconds
 * holding the box centre (and optionally size); between points it glides
 * linearly, outside the path it holds — pure in `local`.
 */
export function trackedMask(mask: StudioMask | null | undefined, local: number): StudioMask | null {
  if (!mask) return null
  const tr = mask.track
  if (!tr || !tr.length || mask.shape === 'chroma' || mask.shape === 'luma' || mask.shape === 'matte') return mask
  let a = tr[0], b = tr[0]
  if (local >= tr[tr.length - 1].at) a = b = tr[tr.length - 1]
  else if (local > tr[0].at) for (let i = 0; i < tr.length - 1; i += 1) if (local >= tr[i].at && local <= tr[i + 1].at) { a = tr[i]; b = tr[i + 1]; break }
  const p = b.at > a.at ? (local - a.at) / (b.at - a.at) : 0
  const lerp = (u: number, v: number) => u + (v - u) * p
  const w = a.w !== undefined && b.w !== undefined ? lerp(a.w, b.w) : mask.w
  const h = a.h !== undefined && b.h !== undefined ? lerp(a.h, b.h) : mask.h
  return { ...mask, x: lerp(a.x, b.x) - w / 2, y: lerp(a.y, b.y) - h / 2, w, h }
}

/** Compose a new filter onto whatever the context already has. */
function composeFilter(existing: string, extra: string): string {
  if (!extra) return existing || 'none'
  if (!existing || existing === 'none') return extra
  return `${existing} ${extra}`
}

/** Scratch canvas for matted clips. One per size, reused across frames. */
let maskScratch: { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } | null = null
let layer3d: { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D; temp: { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } } | null = null
/** Two full-frame layers for 3D clips (content + turn pass). Null outside the DOM. */
function layer3dFor(w: number, h: number) {
  if (typeof document === 'undefined') return null
  if (!layer3d) {
    const a = document.createElement('canvas'), b = document.createElement('canvas')
    const actx = a.getContext('2d'), bctx = b.getContext('2d')
    if (!actx || !bctx) return null
    layer3d = { canvas: a, ctx: actx, temp: { canvas: b, ctx: bctx } }
  }
  for (const c of [layer3d.canvas, layer3d.temp.canvas]) if (c.width !== w || c.height !== h) { c.width = w; c.height = h }
  const l = layer3d.ctx
  l.setTransform(1, 0, 0, 1, 0, 0)
  l.filter = 'none'
  l.globalAlpha = 1
  l.globalCompositeOperation = 'source-over'
  l.clearRect(0, 0, w, h)
  return layer3d
}

function scratchFor(w: number, h: number) {
  if (typeof document === 'undefined') return null
  if (!maskScratch) {
    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    maskScratch = { canvas, ctx }
  }
  if (maskScratch.canvas.width !== w || maskScratch.canvas.height !== h) {
    maskScratch.canvas.width = w
    maskScratch.canvas.height = h
  }
  maskScratch.ctx.setTransform(1, 0, 0, 1, 0, 0)
  maskScratch.ctx.filter = 'none'
  maskScratch.ctx.globalAlpha = 1
  maskScratch.ctx.globalCompositeOperation = 'source-over'
  maskScratch.ctx.clearRect(0, 0, w, h)
  return maskScratch
}

/**
 * Punch the matte out of an already-drawn scratch layer.
 *
 * Everything is done with compositing rather than per-pixel work, except the
 * luma key, which genuinely needs the pixels. Feathering is a blur on the
 * shape fill — the same edge the eye expects from a feathered mask in a real
 * NLE, and free on the GPU.
 */
function applyMask(ctx: CanvasRenderingContext2D, mask: StudioMask, w: number, h: number) {
  const feather = (mask.featherPct / 100) * Math.min(w, h)

  if (mask.shape === 'chroma') {
    const image = ctx.getImageData(0, 0, w, h)
    chromaKey(image.data, mask.keyColor || '#00ff00', mask.threshold, mask.softness, mask.spill ?? 0.5, mask.invert)
    ctx.putImageData(image, 0, 0)
    return
  }

  if (mask.shape === 'luma') {
    const image = ctx.getImageData(0, 0, w, h)
    const data = image.data
    const lo = Math.max(0, mask.threshold - mask.softness / 2)
    const hi = Math.min(1, mask.threshold + mask.softness / 2)
    const span = Math.max(0.0001, hi - lo)
    for (let i = 0; i < data.length; i += 4) {
      // Rec. 709 luma, so colour weighting matches what the eye reads as bright.
      const luma = (0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]) / 255
      let keep = (luma - lo) / span
      keep = keep < 0 ? 0 : keep > 1 ? 1 : keep
      if (mask.invert) keep = 1 - keep
      data[i + 3] = Math.round(data[i + 3] * keep)
    }
    ctx.putImageData(image, 0, 0)
    return
  }

  if (mask.shape === 'matte') {
    const matte = mask.matteDataUrl ? overlayImage(`matte-${mask.matteDataUrl.slice(-32)}`, mask.matteDataUrl) : null
    if (!matte) return
    ctx.save()
    ctx.globalCompositeOperation = mask.invert ? 'destination-out' : 'destination-in'
    if (feather > 0) ctx.filter = `blur(${feather.toFixed(2)}px)`
    ctx.drawImage(matte, 0, 0, w, h)
    ctx.restore()
    return
  }

  ctx.save()
  ctx.globalCompositeOperation = mask.invert ? 'destination-out' : 'destination-in'
  if (feather > 0) ctx.filter = `blur(${feather.toFixed(2)}px)`
  ctx.fillStyle = '#fff'
  const bx = mask.x * w
  const by = mask.y * h
  const bw = mask.w * w
  const bh = mask.h * h
  if (mask.shape === 'ellipse') {
    ctx.beginPath()
    ctx.ellipse(bx + bw / 2, by + bh / 2, Math.abs(bw) / 2, Math.abs(bh) / 2, 0, 0, Math.PI * 2)
    ctx.fill()
  } else {
    ctx.fillRect(bx, by, bw, bh)
  }
  ctx.restore()
}

/** Everything a single clip paints, on whatever context it is given. */
function drawClipContent(
  ctx: CanvasRenderingContext2D,
  clip: StudioClip,
  t: number,
  width: number,
  height: number,
  sources: FrameSources,
) {
  if (clip.kind === 'shape') {
    drawShape(ctx, clip, t, width, height)
    return
  }
  if (clip.kind === 'cursor') {
    drawCursor(ctx, clip, t, width, height)
    return
  }
  if (clip.kind === 'loader') {
    drawLoader(ctx, clip, t, width, height)
    return
  }
  if (clip.kind === 'kit') {
    // Photo slots resolve through the same media registry as footage clips.
    drawKit(ctx, normaliseKit(clip), t, width, height, (m) => sources.media({ kind: 'image', mediaId: m.mediaId, fileName: m.fileName, id: `${clip.id}:${m.mediaId}` } as unknown as StudioMediaClip))
    return
  }
  if (clip.kind === 'background') {
    const bg = backgroundById(clip.backgroundId)
    bg.paint(ctx, width, height, bg.local ? Math.max(0, t - clip.startSec) : t)
  } else if (clip.kind === 'video' || clip.kind === 'image') {
    const source = sources.media(clip)
    const scale = Math.max(0.05, clip.scale ?? 1)
    const targetW = width * scale
    const targetH = height * scale
    const targetX = (clip.x ?? 0.5) * width - targetW / 2
    const targetY = (clip.y ?? 0.5) * height - targetH / 2
    ctx.save()
    ctx.translate(targetX, targetY)
    const device = clip.device && clip.device !== 'none' ? clip.device : null
    if (device === 'phone' && clip.phone) {
      const draw = clip.phone.formFactor === 'duo' ? drawDuoPhone : drawPhone
      draw(ctx, clip.phone, { x: 0, y: 0, w: targetW, h: targetH }, Math.max(0, t - clip.startSec), clip.durationSec, phoneMedia(ctx, source))
    } else if (source && device) {
      drawInDevice(ctx, device, 0, 0, targetW, targetH, (x, y, sw2, sh2) => {
        const [sw, sh] = sourceSize(source)
        drawFit(ctx, source, sw, sh, sw2, sh2, 'cover', x, y)
      })
    } else if (source && clip.compare) {
      const before = sources.media({ ...clip, mediaId: clip.compare.beforeMediaId, compare: null })
      const [sw, sh] = sourceSize(source)
      drawFit(ctx, source, sw, sh, targetW, targetH, clip.fit)
      const split = compareDivider(clip.compare.mode, clip.compare.position, clipProgress(clip, t)) * targetW
      if (before) {
        ctx.save()
        ctx.beginPath()
        ctx.rect(0, 0, split, targetH)
        ctx.clip()
        const [bw, bh] = sourceSize(before)
        drawFit(ctx, before, bw, bh, targetW, targetH, clip.fit)
        ctx.restore()
      }
      // Divider + labels. Labels are fixed words, never claims about results.
      ctx.fillStyle = '#F4F1EA'
      ctx.fillRect(split - Math.max(1.5, width * 0.002), 0, Math.max(3, width * 0.004), targetH)
      const fs = Math.round(height * 0.024)
      ctx.font = `700 ${fs}px 'Inter Variable', Inter, system-ui, sans-serif`
      ctx.textBaseline = 'top'
      ctx.fillStyle = 'rgba(11,11,16,0.6)'
      ctx.fillRect(fs * 0.6, fs * 0.6, ctx.measureText('BEFORE').width + fs, fs * 1.6)
      ctx.fillRect(targetW - ctx.measureText('AFTER').width - fs * 1.6, fs * 0.6, ctx.measureText('AFTER').width + fs, fs * 1.6)
      ctx.fillStyle = '#F4F1EA'
      ctx.textAlign = 'left'
      ctx.fillText('BEFORE', fs * 1.1, fs * 0.9)
      ctx.fillText('AFTER', targetW - ctx.measureText('AFTER').width - fs * 1.1, fs * 0.9)
      if (!before) {
        ctx.fillStyle = 'rgba(244,241,234,0.72)'
        ctx.textAlign = 'center'
        ctx.fillText(`Relink “${clip.compare.beforeFileName}”`, split / 2, targetH / 2)
      }
    } else if (source) {
      const [sw, sh] = sourceSize(source)
      drawFit(ctx, source, sw, sh, targetW, targetH, clip.fit)
    } else {
      // Honest placeholder: the clip exists, its media handle does not.
      ctx.fillStyle = 'rgba(226,75,74,0.10)'
      ctx.fillRect(0, 0, targetW, targetH)
      ctx.fillStyle = 'rgba(244,241,234,0.72)'
      ctx.font = `600 ${Math.round(height * 0.028)}px 'Inter Variable', Inter, system-ui, sans-serif`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(clip.mediaId ? `Relink “${clip.fileName}”` : 'Add your media here', targetW / 2, targetH / 2)
    }
    ctx.restore()
  } else if (clip.kind === 'text') {
    drawTextClip(ctx, clip, t, width, height)
  } else if (clip.kind === 'glass') {
    drawGlassClip(ctx, clip, t, width, height)
  } else if (clip.kind === 'sticker') {
    const source = sources.sticker?.(clip, Math.max(0, t - clip.startSec)) ?? null
    if (source) {
      const [sw, sh] = sourceSize(source)
      if (sw && sh) {
        // Scale 1 means "a quarter of the shorter edge", which is a sticker,
        // not a background element.
        const base = (Math.min(width, height) * 0.25) / Math.max(sw, sh)
        const dw = sw * base * clip.scale
        const dh = sh * base * clip.scale
        ctx.drawImage(source, clip.x * width - dw / 2, clip.y * height - dh / 2, dw, dh)
      }
    }
  } else if (clip.kind === 'overlay') {
    const source = sources.overlay(clip, Math.max(0, t - clip.startSec))
    if (source) {
      const [sw, sh] = sourceSize(source)
      if (sw && sh) {
        const base = Math.min(width / sw, height / sh)
        const dw = sw * base * clip.scale
        const dh = sh * base * clip.scale
        if (clip.device === 'phone' && clip.phone) {
          const draw = clip.phone.formFactor === 'duo' ? drawDuoPhone : drawPhone
          draw(ctx, clip.phone, { x: clip.x * width - dw / 2, y: clip.y * height - dh / 2, w: dw, h: dh }, Math.max(0, t - clip.startSec), clip.durationSec, phoneMedia(ctx, source))
        } else if (clip.device && clip.device !== 'none') {
          drawInDevice(ctx, clip.device, clip.x * width - dw / 2, clip.y * height - dh / 2, dw, dh, (x, y, w2, h2) => {
            drawFit(ctx, source, sw, sh, w2, h2, 'cover', x, y)
          })
        } else {
          ctx.drawImage(source, clip.x * width - dw / 2, clip.y * height - dh / 2, dw, dh)
        }
      }
    } else if (clip.component) {
      drawComponentPlaceholder(ctx, clip, t, width, height)
    }
  }
}

/**
 * A component clip whose frames are not recorded yet (just added, queued by
 * the agent, or failed): a labelled card instead of an empty frame, so the
 * timeline never shows "nothing happened".
 */
function drawComponentPlaceholder(ctx: CanvasRenderingContext2D, clip: Extract<StudioClip, { kind: 'overlay' }>, t: number, width: number, height: number) {
  const status = clip.component?.status ?? 'pending'
  const w = Math.min(width * 0.62, height * 0.9)
  const h = Math.min(height * 0.3, w * 0.45)
  const x = clip.x * width - w / 2
  const y = clip.y * height - h / 2
  const r = Math.min(h * 0.18, 28)
  ctx.save()
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
  ctx.fillStyle = 'rgba(20, 22, 28, 0.86)'
  ctx.fill()
  ctx.lineWidth = Math.max(1.5, h * 0.012)
  ctx.strokeStyle = status === 'failed' ? 'rgba(255, 120, 110, 0.7)' : 'rgba(200, 245, 66, 0.55)'
  ctx.stroke()
  // A sweeping highlight says "working on it" while recording is pending.
  if (status !== 'failed') {
    const sweep = ((t * 0.6) % 1) * (w + h) - h
    const grad = ctx.createLinearGradient(x + sweep, y, x + sweep + h, y + h)
    grad.addColorStop(0, 'rgba(255,255,255,0)')
    grad.addColorStop(0.5, 'rgba(255,255,255,0.07)')
    grad.addColorStop(1, 'rgba(255,255,255,0)')
    ctx.fillStyle = grad
    ctx.fill()
  }
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillStyle = '#F4F1EA'
  let size = h * 0.2
  ctx.font = `700 ${size}px 'Inter Variable', Inter, system-ui, sans-serif`
  const label = clip.name || 'Component'
  const measured = ctx.measureText(label).width
  if (measured > w * 0.86) {
    size *= (w * 0.86) / measured
    ctx.font = `700 ${size}px 'Inter Variable', Inter, system-ui, sans-serif`
  }
  ctx.fillText(label, x + w / 2, y + h * 0.42)
  ctx.font = `500 ${h * 0.11}px 'Inter Variable', Inter, system-ui, sans-serif`
  ctx.fillStyle = status === 'failed' ? 'rgba(255, 150, 140, 0.95)' : 'rgba(200, 245, 66, 0.9)'
  ctx.fillText(status === 'failed' ? 'Recording failed · select to retry' : 'Recording its animation…', x + w / 2, y + h * 0.68)
  ctx.restore()
}

/* ——— main entry ——— */

export function drawStudioFrame(
  ctx: CanvasRenderingContext2D,
  doc: StudioDoc,
  t: number,
  width: number,
  height: number,
  sources: FrameSources,
) {
  ctx.save()
  ctx.clearRect(0, 0, width, height)
  lumaFrame = ctx
  lumaInvalidate()

  // 1. Document background, then any background clip active right now.
  // A custom background overrides the preset, and is deliberately checked
  // before anything else so it is independent of the current selection.
  const custom = doc.customBackground
  if (custom?.type === 'solid') {
    ctx.fillStyle = custom.color
    ctx.fillRect(0, 0, width, height)
  } else if (custom?.type === 'image') {
    const image = overlayImage(`doc-bg-${custom.dataUrl.slice(-24)}`, custom.dataUrl)
    if (image) {
      const [sw, sh] = sourceSize(image)
      drawFit(ctx, image, sw, sh, width, height, custom.fit)
    }
  } else if (custom?.type !== 'transparent') {
    backgroundById(doc.backgroundId).paint(ctx, width, height, t)
  }

  // Cursor → target reactions: a linked clip presses in on each click (or
  // lifts on hover). Computed once per frame from the active cursor clips.
  const press = new Map<string, number>()
  for (const c of doc.clips) {
    if (c.kind !== 'cursor' || !c.targetClipId || t < c.startSec || t > c.startSec + c.durationSec) continue
    const f = cursorAt(c, t - c.startSec)
    if (f.targetPress) press.set(c.targetClipId, f.targetPress)
  }

  for (const raw of clipsAt(doc, t)) {
    if (raw.kind === 'adjustment') {
      // An adjustment layer is a full-frame, non-destructive pass: snapshot the
      // composite below it, grade that snapshot, then continue drawing layers
      // above. Preview and export therefore apply the same ordered layer stack.
      const grade = gradeFilter(raw.grade)
      if (grade) {
        const snapshot = scratchFor(width, height)
        if (snapshot) {
          snapshot.ctx.clearRect(0, 0, width, height)
          snapshot.ctx.drawImage(ctx.canvas, 0, 0, width, height)
          ctx.save()
          ctx.clearRect(0, 0, width, height)
          ctx.filter = grade
          ctx.drawImage(snapshot.canvas, 0, 0, width, height)
          ctx.restore()
        }
      }
      lumaInvalidate()
      continue
    }
    // Keyframes are resolved once, up front, so everything below — transitions,
    // rotation, the matte, the draw itself — sees the animated clip.
    const clip = animatedClip(raw, t)
    ctx.save()
    const alpha = applyTransition(ctx, clip, t, width, height)
    ctx.globalAlpha = alpha

    // Rotation is about the clip's own centre, so a rotated title still sits
    // where the user put it rather than swinging off round the frame origin.
    // 3D clips draw into their own layer, then get projected (see below).
    const layer3d = has3D(clip) ? layer3dFor(width, height) : null
    const target = layer3d ? layer3d.ctx : ctx
    const rotation = clip.rotation ?? 0
    if (rotation) {
      const { cx, cy } = clipCentre(clip, width, height)
      target.translate(cx, cy)
      target.rotate((rotation * Math.PI) / 180)
      target.translate(-cx, -cy)
    }
    if (clip.flipX || clip.flipY) {
      const { cx, cy } = clipCentre(clip, width, height)
      target.translate(cx, cy)
      target.scale(clip.flipX ? -1 : 1, clip.flipY ? -1 : 1)
      target.translate(-cx, -cy)
    }
    const pressed = press.get(raw.id)
    if (pressed) {
      // Press-in (click) shrinks 5%; hover (negative) lifts 3%.
      const k = pressed > 0 ? 1 - 0.05 * pressed : 1 + 0.03 * -pressed
      const { cx, cy } = clipCentre(clip, width, height)
      target.translate(cx, cy)
      target.scale(k, k)
      target.translate(-cx, -cy)
    }

    const grade = [gradeFilter(clip.grade), keyframeFilter(raw, t, height)].filter(Boolean).join(' ')
    const mask = trackedMask(clip.mask, t - clip.startSec)
    const pixelGrade = needsPixelGrade(clip)
    const scratch = mask || pixelGrade ? scratchFor(width, height) : null
    ctx.globalCompositeOperation = compositeFor(clip.blendMode)
    if (layer3d) layer3d.ctx.globalCompositeOperation = 'source-over'

    if (scratch) {
      // Matted / wheel-graded / LUT clips are drawn to a scratch layer first:
      // the pixel work has to touch the clip alone, not the frame below.
      scratch.ctx.filter = grade || 'none'
      drawClipContent(scratch.ctx, clip, t, width, height, sources)
      scratch.ctx.filter = 'none'
      if (pixelGrade) {
        const image = scratch.ctx.getImageData(0, 0, width, height)
        if (applyPixelGrade(image.data, clip.grade, clip.lut)) scratch.ctx.putImageData(image, 0, 0)
      }
      if (mask) applyMask(scratch.ctx, mask, width, height)
      target.drawImage(scratch.canvas, 0, 0, width, height)
    } else {
      target.filter = composeFilter(target.filter, grade)
      drawClipContent(target, clip, t, width, height, sources)
    }
    if (layer3d) {
      layer3d.ctx.filter = 'none'
      const { cx, cy } = clipCentre(clip, width, height)
      project3D(ctx, layer3d.canvas, layer3d.temp, cx, cy, clip.tiltX ?? 0, clip.turnY ?? 0, (clip.perspective ?? 1600) * (height / 1080), width, height)
    }

    ctx.filter = 'none'
    ctx.globalCompositeOperation = 'source-over'
    paintTransitionGlass(ctx, clip, t, width, height)
    ctx.restore()
    // Text over text doesn't change the backdrop a scrim decision reads.
    if (clip.kind !== 'text') lumaInvalidate()
  }

  ctx.filter = 'none'
  ctx.restore()
  lumaFrame = null
}

/** Canvas-drawable element for a media clip, or null. Audio is never drawable. */
export function drawableElement(mediaId: string, quality: 'full' | 'preview' = 'full'): CanvasImageSource | null {
  const handle = getMedia(mediaId)
  if (!handle) return null
  // Photo proxies (2.25): preview and scrubbing draw the downscaled copy;
  // export asks for 'full' and always gets the original.
  if (quality === 'preview' && handle.preview) return handle.preview
  // Video proxies (2.7): the preview draws the proxy once it has a frame.
  if (quality === 'preview' && handle.previewVideo && handle.previewVideo.readyState >= 2 && proxyMode() !== 'off') return handle.previewVideo
  const el = handle.element
  if (el instanceof HTMLAudioElement) return null
  if (el instanceof HTMLVideoElement && el.readyState < 2) return null
  return el
}



/* ——— 2.3 / 2.6 / 2.15 helpers ——— */

const BLEND: Record<StudioBlendMode, GlobalCompositeOperation> = {
  normal: 'source-over',
  multiply: 'multiply',
  screen: 'screen',
  overlay: 'overlay',
  darken: 'darken',
  lighten: 'lighten',
  'color-dodge': 'color-dodge',
  'soft-light': 'soft-light',
  difference: 'difference',
  add: 'lighter',
}

export function compositeFor(mode: StudioBlendMode | undefined): GlobalCompositeOperation {
  return (mode && BLEND[mode]) || 'source-over'
}

/** Wheels or a LUT need the pixels; the CSS-filter grade nodes do not. */
export function needsPixelGrade(clip: StudioClip): boolean {
  if (clip.lut && clip.lut.strength > 0) return true
  return !!clip.grade?.some((n) => n.id === 'wheels' && n.enabled && [...n.lift, ...n.gamma, ...n.gain].some((v) => v !== 0))
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2))
  ctx.beginPath()
  ctx.moveTo(x + rr, y)
  ctx.arcTo(x + w, y, x + w, y + h, rr)
  ctx.arcTo(x + w, y + h, x, y + h, rr)
  ctx.arcTo(x, y + h, x, y, rr)
  ctx.arcTo(x, y, x + w, y, rr)
  ctx.closePath()
}

/** Phone screen painter: cover-fit, or a top→bottom scroll for tall screenshots. */
function phoneMedia(ctx: CanvasRenderingContext2D, source: CanvasImageSource | null): DrawMedia {
  return (x, y, w, h, scroll) => {
    if (!source) {
      // Empty screen slot: a clear, deterministic "your media goes here" panel
      // instead of a black hole, identical in preview and export.
      const g = ctx.createLinearGradient(x, y, x + w, y + h)
      g.addColorStop(0, '#1A1D24'); g.addColorStop(1, '#0E1014')
      ctx.save()
      ctx.fillStyle = g
      ctx.fillRect(x, y, w, h)
      ctx.strokeStyle = 'rgba(200,245,66,0.55)'
      ctx.setLineDash([Math.max(4, w * 0.03), Math.max(3, w * 0.02)])
      ctx.lineWidth = Math.max(1, w * 0.008)
      ctx.strokeRect(x + w * 0.08, y + h * 0.08, w * 0.84, h * 0.84)
      ctx.setLineDash([])
      ctx.fillStyle = 'rgba(244,241,234,0.78)'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.font = `600 ${Math.max(9, Math.round(w * 0.075))}px 'Inter Variable', Inter, system-ui, sans-serif`
      ctx.fillText('Add your media', x + w / 2, y + h / 2 - w * 0.05)
      ctx.fillStyle = 'rgba(244,241,234,0.45)'
      ctx.font = `500 ${Math.max(8, Math.round(w * 0.05))}px 'Inter Variable', Inter, system-ui, sans-serif`
      ctx.fillText('screen · product · campaign', x + w / 2, y + h / 2 + w * 0.06)
      ctx.restore()
      return
    }
    const [sw, sh] = sourceSize(source)
    if (!sw || !sh) return
    if (scroll !== null && sh / sw > h / w) {
      const dh = (w * sh) / sw
      ctx.drawImage(source, x, y - (dh - h) * scroll, w, dh)
    } else drawFit(ctx, source, sw, sh, w, h, 'cover', x, y)
  }
}

/** Paint a device body and draw `content` clipped into its screen. */
function drawInDevice(
  ctx: CanvasRenderingContext2D,
  device: StudioDevice,
  x: number,
  y: number,
  w: number,
  h: number,
  content: (x: number, y: number, w: number, h: number) => void,
) {
  const g = deviceGeometry(device, x, y, w, h) as ReturnType<typeof deviceGeometry> & {
    notch?: { x: number; y: number; w: number; h: number }
    base?: { x: number; y: number; w: number; h: number; r: number }
    bar?: { x: number; y: number; w: number; h: number }
  }
  ctx.save()
  ctx.shadowColor = 'rgba(0,0,0,0.45)'
  ctx.shadowBlur = Math.min(w, h) * 0.05
  ctx.shadowOffsetY = Math.min(w, h) * 0.02
  roundRect(ctx, g.body.x, g.body.y, g.body.w, g.body.h, g.body.r)
  ctx.fillStyle = device === 'browser' ? '#1C1C24' : '#0B0B10'
  ctx.fill()
  ctx.restore()
  if (g.base) {
    ctx.fillStyle = '#15151B'
    roundRect(ctx, g.base.x, g.base.y, g.base.w, g.base.h, g.base.r)
    ctx.fill()
  }
  if (g.bar) {
    const dot = g.bar.h * 0.22
    ;['#E24B4A', '#9A9AA5', '#C8F542'].forEach((c, i) => {
      ctx.fillStyle = c
      ctx.beginPath()
      ctx.arc(g.bar!.x + g.bar!.h * 0.6 + i * dot * 3, g.bar!.y + g.bar!.h / 2, dot, 0, Math.PI * 2)
      ctx.fill()
    })
    ctx.fillStyle = 'rgba(244,241,234,0.08)'
    roundRect(ctx, g.bar.x + g.bar.w * 0.25, g.bar.y + g.bar.h * 0.22, g.bar.w * 0.5, g.bar.h * 0.56, g.bar.h * 0.28)
    ctx.fill()
  }
  ctx.save()
  roundRect(ctx, g.screen.x, g.screen.y, g.screen.w, g.screen.h, g.screen.r)
  ctx.clip()
  ctx.fillStyle = '#000'
  ctx.fillRect(g.screen.x, g.screen.y, g.screen.w, g.screen.h)
  content(g.screen.x, g.screen.y, g.screen.w, g.screen.h)
  ctx.restore()
  if (g.notch) {
    ctx.fillStyle = '#0B0B10'
    roundRect(ctx, g.notch.x, g.notch.y, g.notch.w, g.notch.h, g.notch.h / 2)
    ctx.fill()
  }
}

/**
 * Rich caption: per-word fonts/colours/boxes from markup (richText.ts), wrapped
 * and aligned as one block, animated per word. Pure function of progress.
 */
function drawRichText(ctx: CanvasRenderingContext2D, clip: StudioTextClip, t: number, w: number, h: number) {
  const progress = clipProgress(clip, t)
  const preset = captionPreset(clip.captionStyle)
  const base = Math.max(12, (clip.fontSizePct / 100) * h)
  const family = clip.fontFamily || 'Inter Variable'
  const emFont = clip.emphasisFont || RICH_DEFAULTS.emphasisFont
  const emColor = clip.emphasisColor || RICH_DEFAULTS.emphasisColor
  const boxColor = clip.boxColor || RICH_DEFAULTS.boxColor
  const accent = clip.accentColor || RICH_DEFAULTS.accentColor
  const words = parseRich(preset.uppercase ? clip.text.toUpperCase() : clip.text)
  if (!words.length) return
  const fontFor = (s: RichStyle) => {
    const px = base * (s.big ? 1.5 : 1) * (s.em ? 1.12 : 1)
    const weight = s.em ? 400 : s.big ? Math.max(800, clip.weight) : clip.weight
    const fam = s.em ? emFont : family
    return { px, css: `${s.em ? 'italic ' : ''}${weight} ${px}px '${fam}', ${s.em ? "'Playfair Display Variable', Georgia, serif" : 'Inter, system-ui, sans-serif'}` }
  }
  // Layout: wrap into lines, respecting explicit line breaks.
  type Placed = { word: RichWord; px: number; css: string; width: number; x: number; line: number }
  const maxWidth = w * 0.86
  const placed: Placed[] = []
  ctx.save()
  ctx.font = fontFor({ em: false, box: false, accent: false, big: false }).css
  const space = ctx.measureText(' ').width
  let line = 0, lineW = 0, srcLine = 0
  for (const word of words) {
    const f = fontFor(word.style)
    ctx.font = f.css
    const width = ctx.measureText(word.text).width
    if (word.line !== srcLine) { line++; lineW = 0; srcLine = word.line }
    else if (lineW > 0 && lineW + space + width > maxWidth) { line++; lineW = 0 }
    const x = lineW > 0 ? lineW + space : 0
    placed.push({ word, px: f.px, css: f.css, width, x, line })
    lineW = x + width
  }
  const lines = line + 1
  const lineWidths = Array.from({ length: lines }, (_, i) => placed.filter((p) => p.line === i).reduce((m, p) => Math.max(m, p.x + p.width), 0))
  const lineHeights = Array.from({ length: lines }, (_, i) => Math.max(base, ...placed.filter((p) => p.line === i).map((p) => p.px)) * 1.08)
  const totalH = lineHeights.reduce((a, b) => a + b, 0)
  const widest = Math.max(...lineWidths)
  const inP = clamp01(progress / 0.22)
  let alpha = 1, offsetY = 0, scale = 1
  if (clip.anim === 'fade-up' || clip.anim === 'glass-rise') { alpha = easeOut(inP); offsetY = (1 - easeOut(inP)) * base * 0.5 }
  else if (clip.anim === 'pop') { alpha = easeOut(inP); scale = 0.94 + 0.06 * easeOut(inP) + Math.sin(inP * Math.PI) * 0.03 }
  else if (clip.anim !== 'kinetic' && clip.anim !== 'word-reveal' && clip.anim !== 'none') alpha = easeOut(inP)
  const { x: cx, y: cy } = clampToSafeArea(clip.x * w, clip.y * h + offsetY, widest, totalH, clip.align, w, h)
  paintLegibilityScrim(ctx, clip, cx, cy, widest, totalH, base, alpha, w, h)
  ctx.globalAlpha *= alpha
  ctx.translate(cx, cy)
  ctx.scale(scale, scale)
  ctx.textBaseline = 'middle'
  ctx.textAlign = 'left'
  const total = placed.length
  const shown = clip.anim === 'word-reveal' ? Math.ceil(clamp01(progress / 0.55) * total) : total
  let top = -totalH / 2
  const lineTop: number[] = []
  for (let i = 0; i < lines; i++) { lineTop.push(top); top += lineHeights[i] }
  const left = (i: number) => (clip.align === 'left' ? -widest / 2 : clip.align === 'right' ? widest / 2 - lineWidths[i] : -lineWidths[i] / 2)
  placed.forEach((p, idx) => {
    if (idx >= shown) return
    const st = clip.anim === 'kinetic' ? kineticWord(idx, total, progress) : { alpha: 1, dy: 0, scale: 1 }
    if (st.alpha <= 0) return
    const y = lineTop[p.line] + lineHeights[p.line] / 2
    const x = left(p.line) + p.x
    ctx.save()
    ctx.globalAlpha *= st.alpha
    ctx.translate(x + p.width / 2, y + st.dy * base)
    ctx.scale(st.scale, st.scale)
    ctx.font = p.css
    if (p.word.style.box) {
      // Box spans to the next boxed word on the same line (one continuous bar).
      const next = placed[idx + 1]
      const joins = next && next.line === p.line && next.word.style.box
      const padX = base * 0.22, padY = base * 0.16
      const bw = p.width + padX * 2 + (joins ? next.x - (p.x + p.width) : 0)
      ctx.fillStyle = boxColor
      ctx.globalAlpha *= 0.88
      ctx.fillRect(-p.width / 2 - padX, -p.px * 0.5 - padY, bw, p.px + padY * 2)
      ctx.globalAlpha /= 0.88
    }
    const color = p.word.style.accent ? accent : p.word.style.em ? emColor : clip.color
    if (clip.textGlow || p.word.style.em) {
      ctx.shadowColor = color
      ctx.shadowBlur = base * 0.55 * Math.max(clip.textGlow ?? 0, p.word.style.em ? 0.45 : 0)
    }
    if (preset.stroke) {
      ctx.lineJoin = 'round'
      ctx.lineWidth = preset.stroke * (p.px / 64)
      ctx.strokeStyle = '#0B0B10'
      ctx.strokeText(p.word.text, -p.width / 2, 0)
    }
    ctx.fillStyle = color
    ctx.fillText(p.word.text, -p.width / 2, 0)
    ctx.restore()
  })
  ctx.restore()
}
