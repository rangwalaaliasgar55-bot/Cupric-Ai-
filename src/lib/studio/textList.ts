/** All on-screen text in a doc, and find & replace across it (one undo step). */
import type { StudioDoc, StudioTextClip } from '../../types/project'

export function listTextClips(doc: StudioDoc): StudioTextClip[] {
  return doc.clips.filter((c): c is StudioTextClip => c.kind === 'text').sort((a, b) => a.startSec - b.startSec || a.track - b.track)
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Replace in every unlocked text clip. `wholeWord` avoids "art" → "smart". */
export function findReplaceText(doc: StudioDoc, find: string, replace: string, opts: { caseSensitive?: boolean; wholeWord?: boolean } = {}): { doc: StudioDoc; clips: number; hits: number } {
  if (!find) return { doc, clips: 0, hits: 0 }
  const re = new RegExp(opts.wholeWord ? `(?<![\\p{L}\\p{N}])${esc(find)}(?![\\p{L}\\p{N}])` : esc(find), `g${opts.caseSensitive ? '' : 'i'}u`)
  let clips = 0
  let hits = 0
  const next = doc.clips.map((c) => {
    if (c.kind !== 'text' || c.locked) return c
    const n = (c.text.match(re) ?? []).length
    if (!n) return c
    clips += 1; hits += n
    return { ...c, text: c.text.replace(re, () => replace) }
  })
  return { doc: hits ? { ...doc, clips: next } : doc, clips, hits }
}

export function setClipText(doc: StudioDoc, id: string, text: string): StudioDoc {
  return { ...doc, clips: doc.clips.map((c) => (c.id === id && c.kind === 'text' && !c.locked ? { ...c, text } : c)) }
}

/* ——— batch 7: restyle + retime all text ——— */

export type TextRole = 'headline' | 'label' | 'body'

/** Big → headline, tiny or mono → label, the rest body (same split the film import uses). */
export function roleOf(c: StudioTextClip): TextRole {
  if (/mono|code/i.test(c.fontFamily ?? '') || c.fontSizePct < 2.6) return 'label'
  return c.fontSizePct >= 7 ? 'headline' : 'body'
}

export type RestyleOpts = { role?: TextRole | 'all'; fontFamily?: string; color?: string; weight?: 400 | 600 | 800; scale?: number }

/** Restyle unlocked text clips of one role (or all). Never touches the words. */
export function restyleText(doc: StudioDoc, o: RestyleOpts): { doc: StudioDoc; count: number } {
  let count = 0
  const clips = doc.clips.map((c) => {
    if (c.kind !== 'text' || c.locked) return c
    if (o.role && o.role !== 'all' && roleOf(c) !== o.role) return c
    count += 1
    return {
      ...c,
      ...(o.fontFamily ? { fontFamily: o.fontFamily } : {}),
      ...(o.color && /^#[0-9a-f]{6}$/i.test(o.color) ? { color: o.color } : {}),
      ...(o.weight ? { weight: o.weight } : {}),
      ...(o.scale && o.scale > 0 ? { fontSizePct: Math.round(Math.min(40, Math.max(1, c.fontSizePct * o.scale)) * 10) / 10 } : {}),
    }
  })
  return { doc: count ? { ...doc, clips } : doc, count }
}

/**
 * Shift every unlocked text clip by `dt` seconds (e.g. to sit the whole
 * typography over a new intro). Clamped so nothing starts before 0.
 */
export function shiftAllText(doc: StudioDoc, dt: number): { doc: StudioDoc; count: number } {
  const t = doc.clips.filter((c) => c.kind === 'text' && !c.locked)
  if (!t.length || !dt) return { doc, count: 0 }
  const d = Math.max(dt, -Math.min(...t.map((c) => c.startSec)))
  if (!d) return { doc, count: 0 }
  return { doc: { ...doc, clips: doc.clips.map((c) => (c.kind === 'text' && !c.locked ? { ...c, startSec: Math.round((c.startSec + d) * 1000) / 1000 } : c)) }, count: t.length }
}

/* ——— batch 8: match style from a clip, apply the project brand kit ——— */

const STYLE_KEYS = ['fontFamily', 'color', 'weight', 'fontSizePct', 'anim', 'textGlow', 'emphasisColor', 'accentColor', 'legibility'] as const

/** Copy the look (not the words, position or timing) of `sourceId` onto every text of `role`. */
export function matchStyleFrom(doc: StudioDoc, sourceId: string, role: TextRole | 'all', opts: { size?: boolean } = {}): { doc: StudioDoc; count: number } {
  const src = doc.clips.find((c): c is StudioTextClip => c.id === sourceId && c.kind === 'text')
  if (!src) return { doc, count: 0 }
  const look: Partial<StudioTextClip> = {}
  for (const k of STYLE_KEYS) if (k !== 'fontSizePct' || opts.size) (look as Record<string, unknown>)[k] = src[k]
  let count = 0
  const clips = doc.clips.map((c) => {
    if (c.kind !== 'text' || c.locked || c.id === src.id) return c
    if (role !== 'all' && roleOf(c) !== role) return c
    count += 1
    return { ...c, ...look }
  })
  return { doc: count ? { ...doc, clips } : doc, count }
}

/**
 * Brand kit → text: the brand font on headlines and lines, the lightest
 * brand colour on body text, the most saturated one on headlines. Labels keep
 * their mono font. Missing kit parts are skipped, not invented.
 */
export function applyBrandKit(doc: StudioDoc, kit: { colors: string[]; font: string }): { doc: StudioDoc; count: number; used: string[] } {
  const hex = kit.colors.filter((c) => /^#[0-9a-f]{6}$/i.test(c))
  const rgb = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255)
  const lum = (h: string) => { const [r, g, b] = rgb(h); return 0.2126 * r + 0.7152 * g + 0.0722 * b }
  const sat = (h: string) => { const v = rgb(h); return Math.max(...v) - Math.min(...v) }
  const light = hex.length ? [...hex].sort((a, b) => lum(b) - lum(a))[0] : null
  const accent = hex.length ? [...hex].sort((a, b) => sat(b) - sat(a))[0] : null
  const font = kit.font?.trim() || null
  const used = [font && `font ${font}`, light && `text ${light}`, accent && accent !== light && `accent ${accent}`].filter(Boolean) as string[]
  if (!used.length) return { doc, count: 0, used }
  let count = 0
  const clips = doc.clips.map((c) => {
    if (c.kind !== 'text' || c.locked) return c
    const r = roleOf(c)
    const next = { ...c }
    if (font && r !== 'label') next.fontFamily = font
    if (r === 'headline' && accent && sat(accent) > 0.25 && lum(accent) > 0.35) next.color = accent
    else if (r !== 'label' && light && lum(light) > 0.5) next.color = light
    if (JSON.stringify(next) === JSON.stringify(c)) return c
    count += 1
    return next
  })
  return { doc: count ? { ...doc, clips } : doc, count, used }
}

/* ——— batch 9: reusable text style presets (saved on this device) ——— */

export type TextStylePreset = { name: string; look: Partial<Pick<StudioTextClip, 'fontFamily' | 'color' | 'weight' | 'anim' | 'textGlow' | 'emphasisColor' | 'accentColor' | 'legibility'>> }

export function presetFromClip(c: StudioTextClip, name: string): TextStylePreset {
  return { name: name.trim().slice(0, 40) || 'Untitled style', look: { fontFamily: c.fontFamily, color: c.color, weight: c.weight, anim: c.anim, textGlow: c.textGlow, emphasisColor: c.emphasisColor, accentColor: c.accentColor, legibility: c.legibility } }
}

/** Parse stored presets defensively: anything malformed is dropped, never thrown. */
export function parsePresets(raw: string | null): TextStylePreset[] {
  try {
    const v = JSON.parse(raw ?? '[]') as unknown
    if (!Array.isArray(v)) return []
    return v.filter((p): p is TextStylePreset => !!p && typeof p === 'object' && typeof (p as TextStylePreset).name === 'string' && !!(p as TextStylePreset).look && typeof (p as TextStylePreset).look === 'object')
      .map((p) => ({ name: p.name.slice(0, 40), look: {
        ...(typeof p.look.fontFamily === 'string' ? { fontFamily: p.look.fontFamily } : {}),
        ...(typeof p.look.color === 'string' && /^#[0-9a-f]{6}$/i.test(p.look.color) ? { color: p.look.color } : {}),
        ...([400, 600, 800].includes(p.look.weight as number) ? { weight: p.look.weight } : {}),
        ...(typeof p.look.anim === 'string' ? { anim: p.look.anim } : {}),
        ...(typeof p.look.textGlow === 'number' ? { textGlow: Math.min(1, Math.max(0, p.look.textGlow)) } : {}),
      } }))
      .slice(0, 24)
  } catch { return [] }
}

export function upsertPreset(list: TextStylePreset[], p: TextStylePreset): TextStylePreset[] {
  return [p, ...list.filter((x) => x.name !== p.name)].slice(0, 24)
}

export function applyPreset(doc: StudioDoc, p: TextStylePreset, role: TextRole | 'all'): { doc: StudioDoc; count: number } {
  let count = 0
  const clips = doc.clips.map((c) => {
    if (c.kind !== 'text' || c.locked || (role !== 'all' && roleOf(c) !== role)) return c
    count += 1
    return { ...c, ...Object.fromEntries(Object.entries(p.look).filter(([, v]) => v !== undefined)) }
  })
  return { doc: count ? { ...doc, clips } : doc, count }
}
