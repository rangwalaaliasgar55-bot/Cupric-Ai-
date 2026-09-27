/**
 * Motion kit — the agent/UI entry points for shapes and cursors.
 * Pure doc → doc; callers commit one labelled undo step.
 */
import type { StudioClip, StudioCursorClip, StudioDoc, StudioShapeAnim, StudioShapeClip } from '../../types/project'
import { shapeById } from './shapes'
import { cursorForTarget, cursorNeeded, type CursorVerdict } from './cursor'
import { findComponent } from './components'
import { uid } from '../utils'

export type KitResult = { doc: StudioDoc; changed: boolean; reason?: string; clipId?: string }

export function makeShape(shapeId: string, at: number, opts: Partial<StudioShapeClip> = {}): StudioShapeClip | null {
  const def = shapeById(shapeId)
  if (!def) return null
  const strokeOnly = !!def.strokeOnly
  return {
    id: uid(), kind: 'shape', shape: def.id, name: def.name,
    x: 0.5, y: 0.5, w: def.category === 'line' || def.id === 'underline' || def.id === 'strike' ? 0.4 : def.category === 'callout' || def.category === 'ui' ? 0.32 : 0.2,
    aspect: def.aspect,
    fill: strokeOnly ? null : '#C8F542',
    stroke: strokeOnly ? '#FFFFFF' : null,
    strokeWidth: strokeOnly ? 8 : 0,
    anim: (strokeOnly ? 'draw-on' : 'pop') as StudioShapeAnim,
    track: 0, startSec: Math.max(0, at), durationSec: 3,
    transitionIn: 'none', transitionOut: 'fade', opacity: 1,
    ...opts,
  }
}

export function addShape(doc: StudioDoc, shapeId: string, at: number, opts: Partial<StudioShapeClip> = {}): KitResult {
  const clip = makeShape(shapeId, at, opts)
  if (!clip) return { doc, changed: false, reason: `There is no shape called “${shapeId}”.` }
  const track = opts.track ?? Math.max(0, ...doc.clips.map((c) => c.track)) + 1
  clip.track = track
  return { doc: { ...doc, clips: [...doc.clips, clip], trackCount: Math.max(doc.trackCount, track + 1) }, changed: true, clipId: clip.id }
}

/** Verdict for any clip: uses the component registry when it is a recorded component. */
export function cursorVerdictFor(clip: StudioClip): CursorVerdict {
  if (clip.kind === 'overlay' && clip.component) {
    const entry = findComponent(clip.component.slug)
    return cursorNeeded({ name: `${entry?.name ?? ''} ${clip.name ?? ''} ${clip.component.slug}`, category: entry?.category ?? null, description: entry?.description ?? '', tags: entry?.keywords ? String(entry.keywords).split(/\s+/) : [] })
  }
  if (clip.kind === 'shape') return cursorNeeded({ name: clip.shape, category: shapeById(clip.shape)?.category ?? null, tags: shapeById(clip.shape)?.tags })
  return cursorNeeded({ name: clip.name, category: clip.kind })
}

/**
 * Add a cursor that clicks (or hovers/drags) the target. Refuses — with the
 * reason — when a cursor is not needed, unless `force`. A recorded component
 * is also switched to "interact" so it genuinely reacts in its recording.
 */
export function addCursorTo(doc: StudioDoc, targetId: string, opts: { force?: boolean; action?: StudioCursorClip['action']; style?: StudioCursorClip['style'] } = {}): KitResult & { verdict?: CursorVerdict } {
  const target = doc.clips.find((c) => c.id === targetId) as (StudioClip & { x?: number; y?: number }) | undefined
  if (!target) return { doc, changed: false, reason: 'Select the clip the cursor should click.' }
  if (target.kind === 'cursor') return { doc, changed: false, reason: 'That is already a cursor.' }
  const verdict = cursorVerdictFor(target)
  if (!verdict.needed && !opts.force) return { doc, changed: false, reason: verdict.reason, verdict }
  const cur = cursorForTarget({ id: target.id, x: typeof target.x === 'number' ? target.x : 0.5, y: typeof target.y === 'number' ? target.y : 0.5, startSec: target.startSec, durationSec: target.durationSec, track: target.track }, opts.action ?? verdict.action, uid())
  if (opts.style) cur.style = opts.style
  const clips = doc.clips.map((c) => (c.id === target.id && c.kind === 'overlay' && c.component && !c.component.interact ? { ...c, component: { ...c.component, interact: true, status: c.component.status === 'ready' ? 'pending' as const : c.component.status } } : c))
  return { doc: { ...doc, clips: [...clips, cur], trackCount: Math.max(doc.trackCount, cur.track + 1) }, changed: true, clipId: cur.id, verdict }
}
