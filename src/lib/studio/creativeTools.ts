/**
 * Creative tools — speed ramping, one-click repurpose (reframe), Brand Kit,
 * batch variants. All pure: StudioDoc in, StudioDoc out; the caller commits
 * one labelled undo step (or previews first). Nothing here reads the clock
 * or randomness, so preview and export stay identical.
 */
import type { StudioAspect, StudioClip, StudioDoc, StudioMediaClip, StudioTextClip } from '../../types/project'
import { sizeForAspect } from './doc'
import { localTextVariants } from './textTools'
import { uid } from '../utils'

const r3 = (v: number) => Math.round(v * 1000) / 1000
export type ToolResult = { doc: StudioDoc; changed: boolean; reason?: string; notes?: string[] }

export type SocialMetadata = { title: string; caption: string; hashtags: string[] }

/** Derive honest share copy from existing project text; never invents results or testimonials. */
export function socialMetadata(doc: StudioDoc, projectName = 'Untitled video'): SocialMetadata {
  const text = doc.clips.filter((clip): clip is StudioTextClip => clip.kind === 'text' && Boolean(clip.text.trim())).sort((a, b) => a.startSec - b.startSec).map((clip) => clip.text.trim())
  const title = (text[0] || projectName).replace(/\\s+/g, ' ').slice(0, 80)
  const words = `${projectName} ${text.join(' ')}`.toLowerCase().match(/[a-z0-9]{4,}/g) || []
  const hashtags = [...new Set(['video', ...words.filter((word) => !['this', 'that', 'with', 'from', 'your', 'have'].includes(word)).slice(0, 6)])].map((word) => `#${word}`)
  return { title, caption: text.length > 1 ? text.slice(0, 3).join(' · ') : title, hashtags }
}

/* ─────────────────────────── Speed ramping ─────────────────────────── */

export const SPEED_RAMPS = {
  'hero-moment': { label: 'Hero moment (fast → slow-mo → fast)', speeds: [1.6, 1, 0.35, 1, 1.6] },
  'ease-in': { label: 'Build up (slow → fast)', speeds: [0.5, 0.75, 1, 1.5, 2.2] },
  'ease-out': { label: 'Land it (fast → slow)', speeds: [2.2, 1.5, 1, 0.75, 0.5] },
  'bullet-time': { label: 'Bullet time (normal → freeze-slow → normal)', speeds: [1, 0.6, 0.2, 0.6, 1] },
  'montage-rush': { label: 'Montage rush (2× with a beat)', speeds: [2, 2, 0.8, 2, 2] },
} as const
export type SpeedRampId = keyof typeof SPEED_RAMPS
export const MIN_SPEED = 0.1
export const MAX_SPEED = 4

/**
 * Split a video clip into equal SOURCE chunks, each played at its ramp speed.
 * Source continuity is exact (each chunk's in-point is where the last ended);
 * the clip's timeline length changes, and later clips on the same track ripple
 * so nothing overlaps.
 */
export function speedRamp(doc: StudioDoc, clipId: string, rampId: SpeedRampId): ToolResult {
  const clip = doc.clips.find((c) => c.id === clipId)
  if (!clip || clip.kind !== 'video') return { doc, changed: false, reason: 'Speed ramps work on video clips — select one first.' }
  const ramp = SPEED_RAMPS[rampId]
  if (!ramp) return { doc, changed: false, reason: 'Unknown speed ramp.' }
  const base = clip.speed > 0 ? clip.speed : 1
  const sourceSpan = clip.durationSec * base
  if (sourceSpan < 1) return { doc, changed: false, reason: 'The clip is too short to ramp — make it at least 1 second.' }
  const chunk = sourceSpan / ramp.speeds.length
  const segs: StudioMediaClip[] = []
  let t = clip.startSec
  let src = clip.trimInSec
  ramp.speeds.forEach((raw, i) => {
    const speed = Math.min(MAX_SPEED, Math.max(MIN_SPEED, raw))
    const dur = r3(chunk / speed)
    segs.push({
      ...clip,
      id: i === 0 ? clip.id : uid(),
      name: `${clip.name ?? 'Clip'} · ${speed}×`,
      startSec: r3(t),
      durationSec: dur,
      trimInSec: r3(src),
      speed,
      transitionIn: i === 0 ? clip.transitionIn : 'none',
      transitionOut: i === ramp.speeds.length - 1 ? clip.transitionOut : 'none',
      keyframes: i === 0 ? clip.keyframes?.filter((k) => k.at <= dur) : undefined,
    })
    t += dur
    src += chunk
  })
  const oldEnd = clip.startSec + clip.durationSec
  const delta = t - oldEnd
  const clips: StudioClip[] = []
  for (const c of doc.clips) {
    if (c.id === clip.id) { clips.push(...segs); continue }
    if (c.track === clip.track && c.startSec >= oldEnd - 1e-6) clips.push({ ...c, startSec: r3(c.startSec + delta) })
    else clips.push(c)
  }
  const notes = clip.keyframes?.length ? ['Keyframes stay on the first segment only.'] : []
  return { doc: { ...doc, clips }, changed: true, notes }
}

/* ─────────────────────── One-click repurpose ─────────────────────── */

/**
 * Reframe the edit for another aspect: text keeps its size relative to the
 * SHORTER frame side (so a 16:9 headline doesn't balloon in 9:16) and is
 * pulled inside the title-safe area. Media, overlays and stickers are
 * already sized against the frame and are left alone.
 */
export function reframeForAspect(doc: StudioDoc, aspect: StudioAspect): StudioDoc {
  if (aspect === doc.aspect) return doc
  const [ow, oh] = sizeForAspect(doc.aspect)
  const [nw, nh] = sizeForAspect(aspect)
  const k = (oh / Math.min(ow, oh)) / (nh / Math.min(nw, nh))
  const vertical = nh > nw
  const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
  const clips = doc.clips.map((c) => {
    if (c.kind !== 'text') return c
    const t: StudioTextClip = { ...c, fontSizePct: r3(Math.max(1.2, c.fontSizePct * k)) }
    t.x = r3(clamp(c.x, 0.1, 0.9))
    t.y = r3(clamp(c.y, vertical ? 0.12 : 0.1, vertical ? 0.8 : 0.9)) // keep clear of vertical-app UI at the bottom
    return t
  })
  return { ...doc, aspect, clips }
}

/* ───────────────────────────── Brand Kit ───────────────────────────── */

export type BrandKit = { colors: string[]; font: string; logoDataUrl: string | null }
const HEX = /^#[0-9a-f]{6}$/i

function luminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16)
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4 })
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2]
}

/** Pick the brand colour with the best contrast against `bg` (fallback white/black). */
export function readableOn(bg: string, palette: string[]): string {
  const lb = luminance(HEX.test(bg) ? bg : '#000000')
  const ratio = (c: string) => { const l = luminance(c); return (Math.max(l, lb) + 0.05) / (Math.min(l, lb) + 0.05) }
  const best = palette.filter((c) => HEX.test(c)).sort((a, b) => ratio(b) - ratio(a))[0]
  return best && ratio(best) >= 4.5 ? best : lb > 0.4 ? '#0b0b10' : '#f4f1ea'
}

/**
 * Apply the kit to the whole edit: brand font on every text clip, headline
 * colour chosen for contrast against the brand background, and the logo
 * as a small corner overlay for the full length (added once, not duplicated).
 */
export function applyBrandKit(doc: StudioDoc, kit: BrandKit, opts: { logo?: boolean; background?: string; stage?: boolean } = {}): ToolResult {
  const palette = kit.colors.filter((c) => HEX.test(c))
  if (!palette.length && !kit.font && !kit.logoDataUrl) return { doc, changed: false, reason: 'The Brand Kit is empty — add a colour, font or logo first.' }
  const bg = opts.background ?? palette[0] ?? '#0b0b10'
  const text = readableOn(bg, palette.slice(1).length ? palette.slice(1) : palette)
  const accent = palette.find((c) => c !== bg && c !== text) ?? text
  const end = doc.clips.reduce((m, c) => Math.max(m, c.startSec + c.durationSec), 0)
  let clips: StudioClip[] = doc.clips.map((c) => {
    if (c.kind !== 'text') return c
    const next = { ...c, color: text } as StudioTextClip & Record<string, unknown>
    if (kit.font) next.fontFamily = kit.font
    return next
  })
  const notes: string[] = []
  const hadLogo = clips.some((c) => c.kind === 'overlay' && c.source === 'brand-logo')
  if (opts.logo !== false && kit.logoDataUrl && end > 0) {
    if (hadLogo) clips = clips.map((c) => (c.kind === 'overlay' && c.source === 'brand-logo' ? { ...c, dataUrl: kit.logoDataUrl as string, durationSec: end } : c))
    else {
      const track = Math.max(0, ...doc.clips.map((c) => c.track)) + 1
      clips = [...clips, { id: uid(), kind: 'overlay', name: 'Brand logo', source: 'brand-logo', dataUrl: kit.logoDataUrl, x: 0.9, y: 0.1, scale: 0.12, track, startSec: 0, durationSec: end, opacity: 0.92, transitionIn: 'fade', transitionOut: 'none' } as StudioClip]
      notes.push('Logo added top-right for the whole video.')
    }
  } else if (opts.logo !== false && !kit.logoDataUrl) notes.push('No logo in the kit — upload one to stamp it on the video.')
  const trackCount = Math.max(doc.trackCount ?? 1, ...clips.map((c) => c.track + 1))
  // Stage colour only when asked — the user's chosen background is respected by default.
  const custom = opts.stage && HEX.test(bg) ? { ...doc, customBackground: { type: 'solid' as const, color: bg } } : doc
  void accent
  return { doc: { ...custom, clips, trackCount }, changed: true, notes }
}

/* ─────────────────────────── Batch variants ─────────────────────────── */

/**
 * Build N variants of the edit as saved scenes: each rewrites the headline
 * (first/largest text) with a different tone and rotates the accent colour
 * through the brand palette. Scenes can be exported in one batch.
 */
export function buildVariants(doc: StudioDoc, count: number, kit?: BrandKit): ToolResult {
  const texts = doc.clips.filter((c): c is StudioTextClip => c.kind === 'text' && !!c.text.trim())
  if (!texts.length) return { doc, changed: false, reason: 'Variants rewrite the headline — add a text clip first.' }
  const headline = [...texts].sort((a, b) => b.fontSizePct - a.fontSizePct || a.startSec - b.startSec)[0]
  const tones = localTextVariants(headline.text)
  const palette = (kit?.colors ?? []).filter((c) => HEX.test(c))
  const n = Math.max(1, Math.min(6, count))
  const scenes = [...(doc.scenes ?? [])]
  const { scenes: _drop, ...snapshotBase } = doc
  for (let i = 0; i < n; i++) {
    const tone = tones[i % Math.max(1, tones.length)]
    const color = palette.length ? palette[(i + 1) % palette.length] : null
    const clips = snapshotBase.clips.map((c) => {
      if (c.id === headline.id) return { ...c, text: tone?.text ?? (c as StudioTextClip).text, ...(color ? { color: readableOn(palette[0] ?? '#0b0b10', [color, ...palette]) } : {}) } as StudioClip
      return c
    })
    scenes.push({ id: uid(), name: `Variant ${i + 1}${tone ? ` · ${tone.tone}` : ''}`, savedAt: new Date(0).toISOString(), doc: { ...snapshotBase, clips } } as NonNullable<StudioDoc['scenes']>[number])
  }
  return { doc: { ...doc, scenes }, changed: true, notes: [`${n} variants saved as scenes — use “Export every scene” to render them all.`] }
}
