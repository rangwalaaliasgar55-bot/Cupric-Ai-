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

/**
 * Flatten nested sequences into plain clips (recursive, cycle-safe, depth ≤ 4).
 * Each inner clip is clipped to the sequence's window, retimed to the outer
 * timeline, placed by the sequence's x/y/scale, faded by its opacity, and
 * stacked at the sequence's layer (fractional track keeps draw order).
 */
export function flattenSequences(doc: StudioDoc, depth = 0, seen: Set<string> = new Set()): StudioClip[] {
  const out: StudioClip[] = []
  for (const c of doc.clips) {
    if (c.kind !== 'sequence') { out.push(c); continue }
    if (c.hidden) continue
    const scene = doc.scenes?.find((s) => s.id === c.sceneId)
    if (!scene || depth >= 4 || seen.has(c.sceneId)) continue
    const inner = flattenSequences({ ...scene.doc, scenes: doc.scenes } as StudioDoc, depth + 1, new Set([...seen, c.sceneId]))
    const w0 = c.trimInSec, w1 = c.trimInSec + c.durationSec
    const tracks = Math.max(1, ...inner.map((k) => k.track + 1))
    for (const k of inner) {
      const a = Math.max(k.startSec, w0), b = Math.min(k.startSec + k.durationSec, w1)
      if (b - a < 0.01 || k.hidden) continue
      const cut = a - k.startSec
      const next = { ...k, id: `${c.id}~${k.id}`, startSec: c.startSec + (a - w0), durationSec: b - a, track: c.track + (k.track + 0.5) / (tracks + 1), opacity: k.opacity * c.opacity } as StudioClip & Record<string, unknown>
      if ((k.kind === 'video' || k.kind === 'audio') && cut > 0) next.trimInSec = k.trimInSec + cut * (k.kind === 'video' && k.speed > 0 ? k.speed : 1)
      if (c.muted && (k.kind === 'video' || k.kind === 'audio')) next.volume = 0
      if (k.keyframes?.length && cut > 0) next.keyframes = k.keyframes.map((kf) => ({ ...kf, at: kf.at - cut }))
      if (c.scale !== 1 || c.x !== 0.5 || c.y !== 0.5) {
        const px = (v: number | undefined) => c.x + ((v ?? 0.5) - 0.5) * c.scale
        const py = (v: number | undefined) => c.y + ((v ?? 0.5) - 0.5) * c.scale
        if (k.kind === 'text') Object.assign(next, { x: px(k.x), y: py(k.y), fontSizePct: k.fontSizePct * c.scale })
        else if (k.kind === 'video' || k.kind === 'image') Object.assign(next, { x: px(k.x), y: py(k.y), scale: (k.scale ?? 1) * c.scale })
        else if (k.kind === 'overlay' || k.kind === 'sticker') Object.assign(next, { x: px(k.x), y: py(k.y), scale: k.scale * c.scale })
        else if (k.kind === 'glass') Object.assign(next, { x: px(k.x), y: py(k.y), w: k.w * c.scale, h: k.h * c.scale })
      }
      out.push(next)
    }
  }
  return out
}

const cache = new WeakMap<StudioDoc, StudioDoc>()

export function resolveForOutput(doc: StudioDoc): StudioDoc {
  const hit = cache.get(doc)
  if (hit) return hit
  const vars = new Map((doc.variables ?? []).filter((v) => isValidVariableName(v.name)).map((v) => [v.name.toLowerCase(), v.value]))
  const hasSeq = doc.clips.some((c) => c.kind === 'sequence')
  let changed = hasSeq
  const clips: StudioClip[] = []
  for (const c of hasSeq ? flattenSequences(doc) : doc.clips) {
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
