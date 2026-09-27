/**
 * Studio event bus — subscribe to editor changes for dynamic interaction
 * (plugins, automation, the scripting API on window.cupric.studio).
 *
 * Events are derived by diffing successive docs, so every path that edits
 * the project (UI, agent, undo, voice) emits them without extra wiring.
 */
import type { StudioClip, StudioDoc } from '../../types/project'

export type StudioEventMap = {
  'selection:change': { clipId: string | null }
  'time:change': { time: number }
  'doc:change': { doc: StudioDoc }
  'clip:add': { clip: StudioClip }
  'clip:remove': { clip: StudioClip }
  'clip:change': { clip: StudioClip; before: StudioClip }
  'timeline:change': { durationSec: number; trackCount: number }
  'scene:save': { id: string; name: string }
  'scene:load': { id: string; name: string }
}
export type StudioEvent = keyof StudioEventMap
type Handler<E extends StudioEvent> = (payload: StudioEventMap[E]) => void

const handlers = new Map<StudioEvent, Set<Handler<StudioEvent>>>()

export function onStudio<E extends StudioEvent>(event: E, fn: Handler<E>): () => void {
  if (!handlers.has(event)) handlers.set(event, new Set())
  handlers.get(event)!.add(fn as Handler<StudioEvent>)
  return () => handlers.get(event)?.delete(fn as Handler<StudioEvent>)
}

export function emitStudio<E extends StudioEvent>(event: E, payload: StudioEventMap[E]) {
  for (const fn of handlers.get(event) ?? []) {
    try {
      ;(fn as Handler<E>)(payload)
    } catch (err) {
      // A broken subscriber never breaks the editor.
      console.error(`[studio events] ${event} handler failed`, err)
    }
  }
}

/** Events implied by going from `prev` to `next` (pure; exported for tests). */
export function diffDocs(prev: StudioDoc | null, next: StudioDoc): Array<{ [E in StudioEvent]: { event: E; payload: StudioEventMap[E] } }[StudioEvent]> {
  if (prev === next) return []
  const out: Array<{ [E in StudioEvent]: { event: E; payload: StudioEventMap[E] } }[StudioEvent]> = [{ event: 'doc:change', payload: { doc: next } }]
  const before = new Map((prev?.clips ?? []).map((c) => [c.id, c]))
  const after = new Map(next.clips.map((c) => [c.id, c]))
  for (const [id, c] of after) {
    const b = before.get(id)
    if (!b) out.push({ event: 'clip:add', payload: { clip: c } })
    else if (b !== c) out.push({ event: 'clip:change', payload: { clip: c, before: b } })
  }
  for (const [id, c] of before) if (!after.has(id)) out.push({ event: 'clip:remove', payload: { clip: c } })
  const dur = (d: StudioDoc | null) => (d ? d.clips.reduce((m, c) => Math.max(m, c.startSec + c.durationSec), 0) : 0)
  if (!prev || dur(prev) !== dur(next) || prev.trackCount !== next.trackCount) out.push({ event: 'timeline:change', payload: { durationSec: dur(next), trackCount: next.trackCount } })
  return out
}

export function emitDiff(prev: StudioDoc | null, next: StudioDoc) {
  for (const e of diffDocs(prev, next)) emitStudio(e.event, e.payload as never)
}
