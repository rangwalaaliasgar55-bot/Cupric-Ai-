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
