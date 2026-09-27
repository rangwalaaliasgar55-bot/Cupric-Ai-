/**
 * The single pre-pass between the edited doc and anything that OUTPUTS it
 * (preview canvas, exporter, stills). Pure, so preview and export agree:
 *
 *  - hidden clips are removed (not drawn, not heard);
 *  - muted clips keep drawing with volume 0;
 *  - `{{name}}` in text resolves from doc.variables (unknown names stay
 *    visible as typed, so a typo is seen, not silently blanked).
 */
import type { StudioClip, StudioDoc } from '../../types/project'

const VAR_RE = /\{\{\s*([a-zA-Z][\w-]{0,39})\s*\}\}/g

export function substituteVariables(text: string, vars: Map<string, string>): string {
  return text.replace(VAR_RE, (m, name: string) => (vars.has(name.toLowerCase()) ? (vars.get(name.toLowerCase()) as string) : m))
}

export function variablesUsed(doc: StudioDoc): string[] {
  const names = new Set<string>()
  for (const c of doc.clips) if (c.kind === 'text') for (const m of c.text.matchAll(VAR_RE)) names.add(m[1].toLowerCase())
  return [...names].sort()
}

export function isValidVariableName(name: string): boolean {
  return /^[a-zA-Z][\w-]{0,39}$/.test(name)
}

const cache = new WeakMap<StudioDoc, StudioDoc>()

export function resolveForOutput(doc: StudioDoc): StudioDoc {
  const hit = cache.get(doc)
  if (hit) return hit
  const vars = new Map((doc.variables ?? []).filter((v) => isValidVariableName(v.name)).map((v) => [v.name.toLowerCase(), v.value]))
  let changed = false
  const clips: StudioClip[] = []
  for (const c of doc.clips) {
    if (c.hidden) { changed = true; continue }
    let next = c
    if (c.muted && (c.kind === 'video' || c.kind === 'audio') && c.volume > 0) next = { ...next, volume: 0 } as StudioClip
    if (next.kind === 'text' && vars.size && next.text.includes('{{')) {
      const text = substituteVariables(next.text, vars)
      if (text !== next.text) next = { ...next, text }
    }
    if (next !== c) changed = true
    clips.push(next)
  }
  const out = changed ? { ...doc, clips } : doc
  cache.set(doc, out)
  return out
}
