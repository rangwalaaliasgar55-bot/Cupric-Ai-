/**
 * Text tools (2.5 presets/captions/safe area, 2.12 variants, 2.18 kinetic runs).
 * Pure: no clock, no randomness — preview and export draw identical text.
 */

import type { StudioAspect, StudioTextClip } from '../../types/project'
import { defaultTextClip } from './doc'

/* ——— presets ——— */

export type TextPreset = { id: string; label: string; patch: Partial<StudioTextClip> }

/** Positions stay inside the title-safe box (see SAFE_AREAS). */
export const TEXT_PRESETS: TextPreset[] = [
  { id: 'title', label: 'Title', patch: { fontSizePct: 9, weight: 800, align: 'center', x: 0.5, y: 0.42, anim: 'fade-up', captionStyle: null } },
  { id: 'subtitle', label: 'Subtitle', patch: { fontSizePct: 4.2, weight: 600, align: 'center', x: 0.5, y: 0.56, anim: 'fade-up', captionStyle: null } },
  { id: 'lower-third', label: 'Lower third', patch: { fontSizePct: 3.6, weight: 600, align: 'left', x: 0.5, y: 0.8, anim: 'slide-left', captionStyle: 'standard' } },
  { id: 'caption', label: 'Caption', patch: { fontSizePct: 5.4, weight: 800, align: 'center', x: 0.5, y: 0.72, anim: 'word-reveal', captionStyle: 'hormozi' } },
  { id: 'quote', label: 'Quote', patch: { fontSizePct: 5, weight: 400, align: 'center', x: 0.5, y: 0.5, anim: 'fade-up', captionStyle: 'minimal', legibility: 'on' } },
  { id: 'cta', label: 'Call to action', patch: { fontSizePct: 6.5, weight: 800, align: 'center', x: 0.5, y: 0.66, anim: 'pop', captionStyle: null, highlightWord: null } },
  { id: 'kinetic', label: 'Kinetic words', patch: { fontSizePct: 8, weight: 800, align: 'center', x: 0.5, y: 0.5, anim: 'kinetic', captionStyle: null } },
]

export function applyTextPreset(clip: StudioTextClip, id: string): StudioTextClip {
  const preset = TEXT_PRESETS.find((p) => p.id === id)
  return preset ? { ...clip, ...preset.patch } : clip
}

/* ——— safe areas ——— */

/**
 * Normalised safe boxes: action-safe (5%), title-safe (10%) and, for 9:16, the
 * region social apps leave clear of their UI (top bar, right rail, caption).
 */
export function safeAreas(aspect: StudioAspect): Array<{ id: string; label: string; x: number; y: number; w: number; h: number }> {
  const boxes = [
    { id: 'action', label: 'Action safe', x: 0.05, y: 0.05, w: 0.9, h: 0.9 },
    { id: 'title', label: 'Title safe', x: 0.1, y: 0.1, w: 0.8, h: 0.8 },
  ]
  if (aspect === '4:5') boxes.push({ id: 'grid', label: 'Profile-grid crop (3:4)', x: 0.0625, y: 0, w: 0.875, h: 1 })
  if (aspect === '9:16') boxes.push({ id: 'social', label: 'Social UI clear', x: 0.06, y: 0.12, w: 0.76, h: 0.66 })
  return boxes
}

/* ——— captions from a transcript ——— */

/**
 * Split a transcript into caption clips. Timing is weighted by syllable-ish
 * length so long words stay up longer. `words` lets real word timestamps
 * (from Whisper) override the estimate.
 */
export function captionsFromTranscript(
  transcript: string,
  opts: { startSec: number; durationSec: number; track: number; maxWords?: number; words?: Array<{ word: string; start: number; end: number }> },
): StudioTextClip[] {
  const maxWords = Math.max(1, opts.maxWords ?? 4)
  const tokens = opts.words?.length ? opts.words.map((w) => w.word.trim()).filter(Boolean) : transcript.split(/\s+/).filter(Boolean)
  if (!tokens.length) return []
  const chunks: string[][] = []
  let cur: string[] = []
  for (const tok of tokens) {
    cur.push(tok)
    if (cur.length >= maxWords || /[.!?,;:]$/.test(tok)) { chunks.push(cur); cur = [] }
  }
  if (cur.length) chunks.push(cur)
  const weight = (w: string) => Math.max(1, w.replace(/[^a-z0-9]/gi, '').length / 3)
  const total = tokens.reduce((a, w) => a + weight(w), 0)
  let cursor = opts.startSec
  let wi = 0
  return chunks.map((chunk, i) => {
    let start = cursor
    let dur: number
    if (opts.words?.length) {
      start = opts.startSec + opts.words[wi].start
      dur = Math.max(0.3, opts.words[wi + chunk.length - 1].end - opts.words[wi].start)
    } else {
      dur = (chunk.reduce((a, w) => a + weight(w), 0) / total) * opts.durationSec
    }
    wi += chunk.length
    cursor = start + dur
    const clip = defaultTextClip(Math.round(start * 100) / 100, opts.track)
    return {
      ...clip,
      id: `cap-${i}-${clip.id}`,
      name: `Caption ${i + 1}`,
      text: chunk.join(' '),
      durationSec: Math.max(0.3, Math.round(dur * 100) / 100),
      ...TEXT_PRESETS.find((p) => p.id === 'caption')!.patch,
    }
  })
}

/* ——— 2.18 kinetic runs ——— */

/**
 * Per-word state for the kinetic anim. Words land one after another across
 * the first `span` of the clip; each overshoots a touch then settles.
 */
export function kineticWord(index: number, count: number, progress: number, span = 0.6): { alpha: number; dy: number; scale: number } {
  const slot = span / Math.max(1, count)
  const local = (progress - index * slot) / Math.max(0.0001, slot * 1.6)
  const p = local <= 0 ? 0 : local >= 1 ? 1 : local
  const back = p >= 1 ? 1 : 1 + 2.70158 * Math.pow(p - 1, 3) + 1.70158 * Math.pow(p - 1, 2)
  return { alpha: Math.min(1, p * 2), dy: (1 - back) * 0.6, scale: 0.7 + 0.3 * back }
}

/* ——— 2.12 text variants (deterministic fallback) ——— */

export type VariantTone = 'punchy' | 'friendly' | 'formal' | 'shorter'

const FILLER = /\b(really|very|just|actually|basically|that|in order to|simply)\b\s*/gi

/**
 * Rule-based rewrites used when no live model is connected (clearly labelled
 * in the UI). They never invent claims — only restructure the user's words.
 */
export function localTextVariants(text: string): Array<{ tone: VariantTone; text: string }> {
  const clean = text.replace(/\s+/g, ' ').trim()
  if (!clean) return []
  const shorter = clean.replace(FILLER, '').replace(/\s+/g, ' ').trim()
  const words = shorter.split(' ')
  const title = (s: string) => s.replace(/\b\w/g, (c) => c.toUpperCase())
  const punchy = (words.length > 6 ? words.slice(0, 6).join(' ') : shorter).replace(/[.,;:]+$/, '') + '.'
  const friendly = /[!?]$/.test(clean) ? clean : `${clean.replace(/[.]+$/, '')}!`
  const formal = title(clean.replace(/!+/g, '.'))
  return (
    [
      { tone: 'punchy', text: punchy.toUpperCase() === punchy ? punchy : punchy.charAt(0).toUpperCase() + punchy.slice(1) },
      { tone: 'friendly', text: friendly },
      { tone: 'formal', text: formal },
      { tone: 'shorter', text: shorter.length < clean.length ? shorter : words.slice(0, Math.max(2, Math.ceil(words.length / 2))).join(' ') },
    ] as Array<{ tone: VariantTone; text: string }>
  ).filter((v, i, all) => v.text && v.text !== clean && all.findIndex((o) => o.text === v.text) === i)
}

/** Parse a model reply ("1. …\n2. …") into at most `max` distinct lines. */
export function parseVariantReply(reply: string, original: string, max = 4): string[] {
  return reply
    .split(/\r?\n/)
    .map((l) => l.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '').replace(/^["“]|["”]$/g, '').trim())
    .filter((l) => l && l.length <= 160 && l.toLowerCase() !== original.toLowerCase().trim())
    .filter((l, i, all) => all.indexOf(l) === i)
    .slice(0, max)
}
