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
  StudioMediaClip,
  StudioOverlayClip,
  StudioTextClip,
  StudioTransition,
} from '../../types/project'
import { backgroundById } from './backgrounds'
import { clipProgress, clipsAt } from './doc'
import { getMedia, overlayImage } from './media'

export type FrameSources = {
  /** Element to draw for a media clip — supplied by the preview or exporter. */
  media: (clip: StudioMediaClip) => CanvasImageSource | null
  /** Decoded overlay images, keyed by clip id. */
  overlay: (clip: StudioOverlayClip) => CanvasImageSource | null
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
  }

  const lineHeight = fontPx * 1.12
  const totalH = lineHeight * lines.length
  const cx = clip.x * w + (clip.anim === 'slide-left' ? (1 - easeOut(inP)) * w * 0.08 : 0)
  const cy = clip.y * h + offsetY

  ctx.save()
  ctx.globalAlpha *= alpha
  ctx.translate(cx, cy)
  ctx.scale(scale, scale)

  const anchorX = clip.align === 'left' ? -maxWidth / 2 : clip.align === 'right' ? maxWidth / 2 : 0

  lines.forEach((line, index) => {
    const y = -totalH / 2 + lineHeight * (index + 0.5)

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
  })

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

  // 1. Document background, then any background clip active right now.
  backgroundById(doc.backgroundId).paint(ctx, width, height, t)

  for (const clip of clipsAt(doc, t)) {
    ctx.save()
    const alpha = applyTransition(ctx, clip, t, width, height)
    ctx.globalAlpha = alpha

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
    ctx.restore()
  }

  ctx.restore()
}

/** Preview convenience: resolve media straight from the runtime registry. */
export const registrySources: FrameSources = {
  media: (clip) => {
    const handle = getMedia(clip.mediaId)
    if (!handle) return null
    if (handle.element instanceof HTMLVideoElement && handle.element.readyState < 2) return null
    return handle.element
  },
  overlay: (clip) => overlayImage(clip.id, clip.dataUrl),
}
