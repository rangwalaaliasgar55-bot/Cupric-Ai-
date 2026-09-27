/**
 * Programmatic Studio API — scene, block, asset and variable management plus
 * event subscription, for scripts, plugins and automation. Exposed in the
 * renderer as `window.__cupricStudio` while the Studio is open. (Before
 * 0.10.1 it was grafted onto `window.cupric.studio`, but `window.cupric` is the
 * read-only contextBridge object — writing to it blanked the Studio.)
 *
 * Every mutation goes through the same validated edit-op path the AI agent
 * uses (validateStudioEditPlan → applyStudioEditPlan) or a pure helper, and
 * commits as ONE undo step — scripts cannot write an invalid document.
 */
import type { StudioClip, StudioDoc } from '../../types/project'
import { applyStudioEditPlan, validateStudioEditPlan, type StudioEditOp } from './editOps'
import { CHANNEL_PRESETS } from './formats'
import { listMedia, registerUrl } from './media'
import { deleteScene, loadScene, removeVariable, saveScene, setVariable, updateScene } from './scenes'
import { emitStudio, onStudio, type StudioEvent, type StudioEventMap } from './studioEvents'
import { resolveForOutput } from './resolve'

export type StudioBridge = {
  getDoc: () => StudioDoc
  commit: (doc: StudioDoc, label: string) => void
  getSelected: () => string | null
  select: (id: string | null) => void
  getTime: () => number
  seek: (t: number) => void
}

/** Fields a script may patch directly; structure (id, kind, track) goes through ops. */
const BLOCKED_PATCH = new Set(['id', 'kind', 'mediaId', 'component'])

export function createStudioApi(b: StudioBridge) {
  const commit = (doc: StudioDoc, label: string) => {
    b.commit(doc, label)
    return doc
  }
  return {
    version: 1,
    /* scenes */
    scenes: {
      list: () => (b.getDoc().scenes ?? []).map((s) => ({ id: s.id, name: s.name, savedAt: s.savedAt, clips: s.doc.clips.length })),
      save: (name: string) => {
        const r = saveScene(b.getDoc(), name)
        commit(r.doc, `Save scene “${r.scene.name}”`)
        emitStudio('scene:save', { id: r.scene.id, name: r.scene.name })
        return r.scene.id
      },
      update: (id: string) => void commit(updateScene(b.getDoc(), id), 'Update scene'),
      load: (id: string) => {
        const doc = b.getDoc()
        const scene = (doc.scenes ?? []).find((s) => s.id === id)
        commit(loadScene(doc, id), `Load scene “${scene?.name ?? id}”`)
        if (scene) emitStudio('scene:load', { id, name: scene.name })
      },
      remove: (id: string) => void commit(deleteScene(b.getDoc(), id), 'Delete scene'),
      /** The current edit as JSON (what export sees: hidden removed, variables filled). */
      export: () => JSON.parse(JSON.stringify(resolveForOutput(b.getDoc()))) as StudioDoc,
    },
    /* blocks = clips on the timeline */
    blocks: {
      list: (kind?: StudioClip['kind']) => b.getDoc().clips.filter((c) => !kind || c.kind === kind).map((c) => ({ id: c.id, kind: c.kind, name: c.name, track: c.track, startSec: c.startSec, durationSec: c.durationSec })),
      get: (id: string) => structuredClone(b.getDoc().clips.find((c) => c.id === id) ?? null),
      /** Run agent edit ops (addText, addComponent, moveClip, …) — validated, one undo step. */
      apply: (ops: unknown[], label = 'Script edit') => {
        const doc = b.getDoc()
        const plan = validateStudioEditPlan({ summary: label, ops }, doc)
        return commit(applyStudioEditPlan(doc, plan.ops as StudioEditOp[]), label).clips.length
      },
      update: (id: string, patch: Record<string, unknown>) => {
        const doc = b.getDoc()
        const clip = doc.clips.find((c) => c.id === id)
        if (!clip) throw new Error(`No block ${id}`)
        const bad = Object.keys(patch).filter((k) => BLOCKED_PATCH.has(k))
        if (bad.length) throw new Error(`Cannot patch ${bad.join(', ')} — use blocks.apply with an edit op.`)
        if (clip.locked && !('locked' in patch)) throw new Error(`“${clip.name}” is locked.`)
        commit({ ...doc, clips: doc.clips.map((c) => (c.id === id ? ({ ...c, ...patch } as StudioClip) : c)) }, `Script: edit ${clip.name}`)
      },
      remove: (id: string) => {
        const doc = b.getDoc()
        const clip = doc.clips.find((c) => c.id === id)
        if (!clip) throw new Error(`No block ${id}`)
        if (clip.locked) throw new Error(`“${clip.name}” is locked.`)
        commit({ ...doc, clips: doc.clips.filter((c) => c.id !== id) }, `Script: delete ${clip.name}`)
      },
      select: (id: string | null) => b.select(id),
      selected: () => b.getSelected(),
    },
    /* assets */
    assets: {
      list: () => listMedia().map((m) => ({ id: m.id, kind: m.kind, fileName: m.fileName, durationSec: m.durationSec, width: m.width, height: m.height })),
      importUrl: async (url: string, kind: 'video' | 'image' | 'audio', fileName = url.split('/').pop() || 'asset') => (await registerUrl(url, fileName, kind, null)).id,
    },
    /* variables */
    variables: {
      list: () => [...(b.getDoc().variables ?? [])],
      set: (name: string, value: string) => void commit(setVariable(b.getDoc(), name, String(value)), `Set {{${name}}}`),
      remove: (name: string) => void commit(removeVariable(b.getDoc(), name), `Remove {{${name}}}`),
    },
    /* formats */
    formats: {
      presets: () => CHANNEL_PRESETS.map((p) => ({ ...p })),
      apply: (id: string) => {
        const p = CHANNEL_PRESETS.find((x) => x.id === id)
        if (!p) throw new Error(`Unknown preset ${id}`)
        commit({ ...b.getDoc(), aspect: p.aspect, resolution: p.resolution, fps: p.fps }, `Format: ${p.label}`)
      },
    },
    /* playback */
    time: () => b.getTime(),
    seek: (t: number) => b.seek(t),
    /* events */
    on: <E extends StudioEvent>(event: E, fn: (payload: StudioEventMap[E]) => void) => onStudio(event, fn),
  }
}

/** The object published as `window.__cupricStudio` while the Studio is mounted. */
export type StudioApi = ReturnType<typeof createStudioApi>
