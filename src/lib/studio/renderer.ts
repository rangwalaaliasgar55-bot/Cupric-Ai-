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
import { paintGlass, paintGlassLens } from './glass'
import { getMedia, overlayImage } from './media'

export type FrameSources = {
  /** Element to draw for a media clip — supplied by the preview or exporter. */
  media: (clip: StudioMediaClip) => CanvasImageSource | null
  /** Decoded overlay images, keyed by clip id. */
  overlay: (clip: StudioOverlayClip) => CanvasImageSource | null
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
) {
  if (!sw || !sh) return
  const scale = fit === 'cover' ? Math.max(w / sw, h / sh) : Math.min(w / sw, h / sh)
  const dw = sw * scale
  const dh = sh * scale
  ctx.drawImage(source, (w - dw) / 2, (h - dh) / 2, dw, dh)
}

function sourceSize(source: CanvasImageSource): [number, number] {
  if (source instanceof HTMLVideoElement) return [source.videoWidth, source.videoHeight]
  if (source instanceof HTMLImageElement) return [source.naturalWidth, source.naturalHeight]
  if (source instanceof HTMLCanvasElement) return [source.width, source.height]
  return [0, 0]
}

/* ——— text ——— */

function wrapLines(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
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

function drawTextClip(ctx: CanvasRenderingContext2D, clip: StudioTextClip, t: number, w: number, h: number) {
  const progress = clipProgress(clip, t)
  const preset = captionPreset(clip.captionStyle)
  const fontPx = Math.max(12, (clip.fontSizePct / 100) * h)
  ctx.font = `${clip.weight} ${fontPx}px 'Inter Variable', Inter, system-ui, sans-serif`
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
    if (preset.stroke) {
      ctx.lineJoin = 'round'
      ctx.lineWidth = preset.stroke * (fontPx / 64)
      ctx.strokeStyle = '#0B0B10'
      ctx.strokeText(line, anchorX, y)
    }

    // Word-by-word reveal + optional highlight word (Hormozi-style punch).
    if (clip.anim === 'word-reveal' || clip.highlightWord) {
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
          ctx.fillStyle = isHighlight ? '#C8F542' : clip.color
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
    const fontPx = Math.max(12, boxH * 0.22)
    ctx.font = `600 ${fontPx}px 'Inter Variable', Inter, system-ui, sans-serif`
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
}

/** The animated properties, resolved at time `t`. */
export type KeyframeValues = { x?: number; y?: number; scale?: number; rotation?: number; opacity?: number }

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
    const p = (EASES[a.ease] ?? EASES.linear)(clamp01(raw))
    return {
      x: mix(a.x, b.x, p),
      y: mix(a.y, b.y, p),
      scale: mix(a.scale, b.scale, p),
      rotation: mix(a.rotation, b.rotation, p),
      opacity: mix(a.opacity, b.opacity, p),
    }
  }
  return pick(last)
}

function pick(key: StudioKeyframe): KeyframeValues {
  return { x: key.x, y: key.y, scale: key.scale, rotation: key.rotation, opacity: key.opacity }
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
  if (values.x !== undefined && 'x' in clip) next.x = values.x
  if (values.y !== undefined && 'y' in clip) next.y = values.y
  if (values.rotation !== undefined) next.rotation = values.rotation
  if (values.opacity !== undefined) next.opacity = clip.opacity * values.opacity
  if (values.scale !== undefined) {
    // "Scale" means whatever size means for this kind of clip.
    if (clip.kind === 'overlay' || clip.kind === 'sticker') next.scale = clip.scale * values.scale
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
  if (clip.kind === 'text' || clip.kind === 'overlay' || clip.kind === 'glass' || clip.kind === 'sticker') {
    return { cx: clip.x * w, cy: clip.y * h }
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

/** Compose a new filter onto whatever the context already has. */
function composeFilter(existing: string, extra: string): string {
  if (!extra) return existing || 'none'
  if (!existing || existing === 'none') return extra
  return `${existing} ${extra}`
}

/** Scratch canvas for matted clips. One per size, reused across frames. */
let maskScratch: { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } | null = null
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
  if (clip.kind === 'background') {
    backgroundById(clip.backgroundId).paint(ctx, width, height, t)
  } else if (clip.kind === 'video' || clip.kind === 'image') {
    const source = sources.media(clip)
    if (source) {
      const [sw, sh] = sourceSize(source)
      drawFit(ctx, source, sw, sh, width, height, clip.fit)
    } else {
      // Honest placeholder: the clip exists, its media handle does not.
      ctx.fillStyle = 'rgba(226,75,74,0.10)'
      ctx.fillRect(0, 0, width, height)
      ctx.fillStyle = 'rgba(244,241,234,0.72)'
      ctx.font = `600 ${Math.round(height * 0.028)}px 'Inter Variable', Inter, system-ui, sans-serif`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(`Relink “${clip.fileName}”`, width / 2, height / 2)
    }
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
    const source = sources.overlay(clip)
    if (source) {
      const [sw, sh] = sourceSize(source)
      if (sw && sh) {
        const base = Math.min(width / sw, height / sh)
        const dw = sw * base * clip.scale
        const dh = sh * base * clip.scale
        ctx.drawImage(source, clip.x * width - dw / 2, clip.y * height - dh / 2, dw, dh)
      }
    }
  }
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

  for (const raw of clipsAt(doc, t)) {
    // Keyframes are resolved once, up front, so everything below — transitions,
    // rotation, the matte, the draw itself — sees the animated clip.
    const clip = animatedClip(raw, t)
    ctx.save()
    const alpha = applyTransition(ctx, clip, t, width, height)
    ctx.globalAlpha = alpha

    // Rotation is about the clip's own centre, so a rotated title still sits
    // where the user put it rather than swinging off round the frame origin.
    const rotation = clip.rotation ?? 0
    if (rotation) {
      const { cx, cy } = clipCentre(clip, width, height)
      ctx.translate(cx, cy)
      ctx.rotate((rotation * Math.PI) / 180)
      ctx.translate(-cx, -cy)
    }

    const grade = gradeFilter(clip.grade)
    const mask = clip.mask
    const scratch = mask ? scratchFor(width, height) : null

    if (mask && scratch) {
      // Matted clips are drawn to a scratch layer first: the matte has to cut
      // the clip alone, not everything already on the frame.
      scratch.ctx.filter = grade || 'none'
      drawClipContent(scratch.ctx, clip, t, width, height, sources)
      scratch.ctx.filter = 'none'
      applyMask(scratch.ctx, mask, width, height)
      ctx.drawImage(scratch.canvas, 0, 0, width, height)
    } else {
      ctx.filter = composeFilter(ctx.filter, grade)
      drawClipContent(ctx, clip, t, width, height, sources)
    }

    ctx.filter = 'none'
    paintTransitionGlass(ctx, clip, t, width, height)
    ctx.restore()
  }

  ctx.filter = 'none'
  ctx.restore()
}

/** Canvas-drawable element for a media clip, or null. Audio is never drawable. */
export function drawableElement(mediaId: string): CanvasImageSource | null {
  const handle = getMedia(mediaId)
  if (!handle) return null
  const el = handle.element
  if (el instanceof HTMLAudioElement) return null
  if (el instanceof HTMLVideoElement && el.readyState < 2) return null
  return el
}


