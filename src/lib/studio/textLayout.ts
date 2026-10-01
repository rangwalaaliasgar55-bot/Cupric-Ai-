/**
 * Where text actually lands on the canvas.
 *
 * The renderer decides a text block's box while drawing it; the gates need the
 * same numbers to judge contrast and safe areas. This module is that one
 * measurement: `drawRichText` and the gate both call `layoutRich`, so a gate can
 * never measure against a box the author was never shown.
 *
 * Ported layout maths from `src/lib/studio/renderer.ts` (NewBrand's own), with the
 * WCAG gate from veedstudio/open-edit as the reason to lift it out — see
 * THIRD_PARTY_NOTICES.md.
 */
import type { StudioTextClip } from '../../types/project'
import { parseRich, hasRichMarkup, RICH_DEFAULTS as RICH_DEFAULTS_UPSTREAM, type RichStyle, type RichWord } from './richText'

/**
 * Caption presets, title-safe margin and the safe-area clamp live here because
 * the renderer and the gates must agree on them — the renderer imports them from
 * this module rather than owning a second copy.
 */
export const RICH_DEFAULTS = {
  emphasisFont: RICH_DEFAULTS_UPSTREAM.emphasisFont,
  emphasisColor: RICH_DEFAULTS_UPSTREAM.emphasisColor,
  boxColor: RICH_DEFAULTS_UPSTREAM.boxColor,
  accentColor: RICH_DEFAULTS_UPSTREAM.accentColor,
}

export function captionPreset(style: StudioTextClip['captionStyle']) {
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

export type PlacedWord = { word: RichWord; px: number; css: string; width: number; x: number; line: number }

export type TextBox = {
  clipId: string
  /** Centre + size in canvas pixels, after the renderer's safe-area nudge. */
  x: number
  y: number
  w: number
  h: number
  /** Pixels of the type actually rendered — the size and weight WCAG thresholds read. */
  fontSizePx: number
  fontWeight: number
  /** Colours the block is painted in this frame. */
  colors: string[]
  /** True when the block carries markup, so the gate knows the box is a multi-word layout. */
  rich: boolean
}

/** The exact CSS `font` the rich path builds for one style run. */
export function richFontCss(clip: StudioTextClip, style: RichStyle, base: number): { px: number; css: string } {
  const family = clip.fontFamily || 'Inter Variable'
  const emFont = clip.emphasisFont || RICH_DEFAULTS.emphasisFont
  const px = base * (style.big ? 1.5 : 1) * (style.em ? 1.12 : 1)
  const weight = style.em ? 400 : style.big ? Math.max(800, clip.weight) : clip.weight
  const fam = style.em ? emFont : family
  // Only slant when the emphasis face really has an italic cut.
  const slant = style.em && clip.emphasisItalic !== false
  return {
    px,
    css: `${slant ? 'italic ' : ''}${weight} ${px}px '${fam}', ${slant ? "'Playfair Display Variable', Georgia, serif" : 'Inter, system-ui, sans-serif'}`,
  }
}

/** Rich-text layout: wrapping, per-word fonts, line heights. Mirrors `drawRichText`. */
export function layoutRich(ctx: CanvasRenderingContext2D, clip: StudioTextClip, w: number, _h: number) {
  const preset = captionPreset(clip.captionStyle)
  const base = Math.max(12, (clip.fontSizePct / 100) * _h)
  const words = parseRich(preset.uppercase ? clip.text.toUpperCase() : clip.text)
  const placed: PlacedWord[] = []
  ctx.save()
  ctx.font = richFontCss(clip, { em: false, box: false, accent: false, big: false }, base).css
  const space = ctx.measureText(' ').width
  const maxWidth = w * 0.86
  let line = 0
  let lineW = 0
  let srcLine = 0
  for (const word of words) {
    const f = richFontCss(clip, word.style, base)
    ctx.font = f.css
    const width = ctx.measureText(word.text).width
    if (word.line !== srcLine) { line++; lineW = 0; srcLine = word.line }
    else if (lineW > 0 && lineW + space + width > maxWidth) { line++; lineW = 0 }
    const x = lineW > 0 ? lineW + space : 0
    placed.push({ word, px: f.px, css: f.css, width, x, line })
    lineW = x + width
  }
  ctx.restore()
  const lines = line + 1
  const lineWidths = Array.from({ length: lines }, (_, i) => placed.filter((p) => p.line === i).reduce((m, p) => Math.max(m, p.x + p.width), 0))
  const lineHeights = Array.from({ length: lines }, (_, i) => Math.max(base, ...placed.filter((p) => p.line === i).map((p) => p.px)) * 1.08)
  const totalH = lineHeights.reduce((a, b) => a + b, 0)
  const widest = Math.max(...lineWidths, 0)
  return { placed, lines, lineWidths, lineHeights, widest, totalH, base, space }
}

/** Plain-text (no markup) layout: the box the simple path paints. Mirrors `drawTextClip`. */
export function layoutPlain(ctx: CanvasRenderingContext2D, clip: StudioTextClip, w: number, h: number) {
  const preset = captionPreset(clip.captionStyle)
  const fontPx = Math.max(12, (clip.fontSizePct / 100) * h)
  const family = clip.fontFamily || 'Inter Variable'
  ctx.save()
  ctx.font = `${clip.weight} ${fontPx}px '${family}', Inter, system-ui, sans-serif`
  const raw = preset.uppercase ? clip.text.toUpperCase() : clip.text
  const maxWidth = w * 0.86
  const lines: string[] = []
  for (const paragraph of raw.split('\n')) {
    let acc = ''
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      const candidate = acc ? `${acc} ${word}` : word
      if (ctx.measureText(candidate).width > maxWidth && acc) { lines.push(acc); acc = word } else acc = candidate
    }
    lines.push(acc)
  }
  if (!lines.length) lines.push('')
  const lineHeight = fontPx * 1.12
  const widest = lines.reduce((max, line) => Math.max(max, ctx.measureText(line).width), 0)
  ctx.restore()
  return { lines, widest, totalH: lineHeight * lines.length, fontPx }
}

/**
 * The box a text clip occupies at any time, in canvas pixels — centre-based and
 * already nudged inside the renderer's safe margin, exactly as painted.
 */
export function textBox(ctx: CanvasRenderingContext2D, clip: StudioTextClip, w: number, h: number): TextBox {
  const rich = hasRichMarkup(clip.text)
  if (rich) {
    const l = layoutRich(ctx, clip, w, h)
    const { x, y } = clampToSafeArea(clip.x * w, clip.y * h, l.widest, l.totalH, clip.align, w, h)
    const colors = [clip.color]
    if (clip.emphasisColor) colors.push(clip.emphasisColor)
    if (clip.accentColor) colors.push(clip.accentColor)
    return { clipId: clip.id, x, y, w: l.widest, h: l.totalH, fontSizePx: l.base, fontWeight: clip.weight, colors, rich }
  }
  const l = layoutPlain(ctx, clip, w, h)
  const { x, y } = clampToSafeArea(clip.x * w, clip.y * h, l.widest, l.totalH, clip.align, w, h)
  return {
    clipId: clip.id,
    x,
    y,
    w: l.widest,
    h: l.totalH,
    fontSizePx: l.fontPx,
    fontWeight: clip.weight,
    colors: [clip.color],
    rich,
  }
}
