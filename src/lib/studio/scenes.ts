/**
 * Scene management — named snapshots of the whole edit kept inside the
 * project. Pure: each function returns the next doc; the caller commits it
 * as one undo step. Loading a scene replaces the edit but keeps the scene
 * list (and variables), so switching scenes never loses the others.
 */
import type { StudioDoc } from '../../types/project'
import { uid } from '../utils'

export type StudioScene = NonNullable<StudioDoc['scenes']>[number]
export const MAX_SCENES = 24

const snapshot = (doc: StudioDoc): StudioScene['doc'] => {
  const { scenes: _scenes, ...rest } = doc
  return structuredClone(rest)
}

export function saveScene(doc: StudioDoc, name: string, now = new Date().toISOString()): { doc: StudioDoc; scene: StudioScene } {
  const scenes = doc.scenes ?? []
  const clean = name.trim().slice(0, 60) || `Scene ${scenes.length + 1}`
  if (scenes.length >= MAX_SCENES) throw new Error(`A project keeps up to ${MAX_SCENES} scenes — delete one first.`)
  const scene: StudioScene = { id: uid(), name: clean, savedAt: now, doc: snapshot(doc) }
  return { doc: { ...doc, scenes: [...scenes, scene] }, scene }
}

/** Overwrite an existing scene with the current edit. */
export function updateScene(doc: StudioDoc, id: string, now = new Date().toISOString()): StudioDoc {
  const scenes = doc.scenes ?? []
  if (!scenes.some((s) => s.id === id)) throw new Error('That scene no longer exists.')
  return { ...doc, scenes: scenes.map((s) => (s.id === id ? { ...s, savedAt: now, doc: snapshot(doc) } : s)) }
}

export function loadScene(doc: StudioDoc, id: string): StudioDoc {
  const scene = (doc.scenes ?? []).find((s) => s.id === id)
  if (!scene) throw new Error('That scene no longer exists.')
  return { ...structuredClone(scene.doc), scenes: doc.scenes, variables: doc.variables ?? scene.doc.variables }
}

export function renameScene(doc: StudioDoc, id: string, name: string): StudioDoc {
  return { ...doc, scenes: (doc.scenes ?? []).map((s) => (s.id === id ? { ...s, name: name.trim().slice(0, 60) || s.name } : s)) }
}

export function duplicateScene(doc: StudioDoc, id: string, now = new Date().toISOString()): StudioDoc {
  const src = (doc.scenes ?? []).find((s) => s.id === id)
  if (!src) throw new Error('That scene no longer exists.')
  if ((doc.scenes ?? []).length >= MAX_SCENES) throw new Error(`A project keeps up to ${MAX_SCENES} scenes — delete one first.`)
  return { ...doc, scenes: [...(doc.scenes ?? []), { ...structuredClone(src), id: uid(), name: `${src.name} copy`.slice(0, 60), savedAt: now }] }
}

export function deleteScene(doc: StudioDoc, id: string): StudioDoc {
  return { ...doc, scenes: (doc.scenes ?? []).filter((s) => s.id !== id) }
}

/* ——— variables ——— */

export function setVariable(doc: StudioDoc, name: string, value: string): StudioDoc {
  const n = name.trim()
  if (!/^[a-zA-Z][\w-]{0,39}$/.test(n)) throw new Error('Variable names start with a letter and use letters, numbers, - or _ (max 40).')
  const vars = doc.variables ?? []
  const i = vars.findIndex((v) => v.name.toLowerCase() === n.toLowerCase())
  const next = i >= 0 ? vars.map((v, j) => (j === i ? { name: v.name, value } : v)) : [...vars, { name: n, value }]
  return { ...doc, variables: next }
}

export function removeVariable(doc: StudioDoc, name: string): StudioDoc {
  return { ...doc, variables: (doc.variables ?? []).filter((v) => v.name.toLowerCase() !== name.toLowerCase()) }
}
