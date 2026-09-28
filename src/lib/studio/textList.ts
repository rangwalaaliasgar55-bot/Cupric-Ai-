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
