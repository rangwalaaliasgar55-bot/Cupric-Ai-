#!/usr/bin/env node
/**
 * Undo/redo re-audit (2.31), against the real store — re-run whenever a new
 * mutation-producing feature lands. Asserts every Studio mutation is exactly
 * one undo step, and that background results (component recordings) never
 * hijack Undo.
 */
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { rm } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const tmp = path.join(root, '.undo-audit-check.mjs')
await build({
  bundle: true, outfile: tmp, format: 'esm', platform: 'node', logLevel: 'error',
  loader: { '.css': 'empty', '.svg': 'empty', '.png': 'empty' },
  define: { __APP_VERSION__: '"audit"' },
  stdin: {
    contents: `export { useProjectStore } from './src/state/useProjectStore'
      export { defaultTextClip } from './src/lib/studio/doc'
      export { componentClip, shelfComponent, placeShelfItem } from './src/lib/studio/components'`,
    resolveDir: root, loader: 'ts',
  },
})
const mem = new Map()
globalThis.window = { localStorage: { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v), removeItem: (k) => mem.delete(k) }, location: {} }
globalThis.localStorage = globalThis.window.localStorage
const m = await import(`${pathToFileURL(tmp).href}?t=${Date.now()}`)
await rm(tmp, { force: true })
const store = m.useProjectStore
const S = () => store.getState()
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const pid = S().createProject('Undo audit')
const doc = () => S().projects.find((p) => p.id === pid).studio
const steps = () => S().past.length
const clip = (id) => doc().clips.find((c) => c.id === id)

/** Run `fn`, assert it added exactly one undo step, undo restores, redo re-applies. */
async function oneStep(label, fn) {
  await wait(750) // outside the slider-coalescing window
  const before = JSON.stringify(doc())
  const n = steps()
  fn()
  const after = JSON.stringify(doc())
  assert.notEqual(after, before, `${label}: changed something`)
  assert.equal(steps(), n + 1, `${label}: exactly one undo step`)
  S().undo()
  assert.equal(JSON.stringify(doc()), before, `${label}: undo restores`)
  S().redo()
  assert.equal(JSON.stringify(doc()), after, `${label}: redo re-applies`)
}

const text = { ...m.defaultTextClip(0, 0), id: 't1' }
await oneStep('add text clip', () => S().addStudioClip(pid, text))
await oneStep('text legibility (2.14)', () => S().updateStudioClip(pid, 't1', { legibility: 'on', scrimStrength: 0.8 }))
await oneStep('split', () => S().splitStudioClip(pid, 't1', 1))
await oneStep('duplicate', () => S().duplicateStudioClip(pid, 't1'))
await oneStep('add track', () => S().addStudioTrack(pid))
await oneStep('reorder tracks', () => S().reorderStudioTracks(pid, 0, 1))
await oneStep('delete', () => S().removeStudioClip(pid, 't1'))

// Record-to-shelf, place, remove (2.13): one step each.
const shelfItem = { ...m.shelfComponent('like-button', { recordSec: 12 }), id: 'sh1' }
await oneStep('record to shelf', () => S().patchStudio(pid, { shelf: [shelfItem] }, 'Record component to shelf'))
assert.equal(doc().shelf[0].component.recordSec, 12, 'custom length beyond the old 8 s cap is kept')

// A recording landing is NOT an undo step and survives Undo of the user's own edit.
const comp = { ...m.componentClip('like-button', { startSec: 0, recordSec: 20 }), id: 'c1' }
await wait(750)
S().addStudioClip(pid, comp)
await wait(750)
S().updateStudioClip(pid, 'c1', { opacity: 0.5 }) // the user's edit while it records
const n = steps()
S().landComponentRecording(pid, 'c1', { dataUrl: 'data:image/webp;base64,AA', frames: ['a', 'b'], frameFps: 12, component: { ...comp.component, status: 'ready' } })
S().landComponentRecording(pid, 'sh1', { dataUrl: 'data:image/webp;base64,BB', frames: ['x'], component: { ...shelfItem.component, status: 'ready' } })
assert.equal(steps(), n, 'recording results add no undo step')
S().undo() // undoes the opacity edit…
assert.equal(clip('c1').opacity, 1, 'undo reverted the user edit')
assert.equal(clip('c1').component.status, 'ready', '…and the recording is still there (not re-queued)')
assert.deepEqual(clip('c1').frames, ['a', 'b'])
S().undo() // undo the add → the clip is gone
assert.equal(clip('c1'), undefined)
S().redo()
assert.equal(clip('c1').component.status, 'ready', 'redo brings the clip back already recorded')
assert.equal(doc().shelf[0].component.status, 'ready', 'shelf recording survived the history walk')

const placed = m.placeShelfItem(doc(), doc().shelf[0], 3)
await oneStep('place recorded component', () => S().patchStudio(pid, { trackCount: placed.doc.trackCount, clips: placed.doc.clips }, 'Place recorded component'))
await oneStep('remove from shelf', () => S().patchStudio(pid, { shelf: [] }, 'Remove recorded component'))

// Slider drags coalesce into one step.
await wait(750)
const k = steps()
for (let i = 1; i <= 5; i += 1) S().updateStudioClip(pid, 'c1', { opacity: 1 - i * 0.1 })
assert.equal(steps(), k + 1, 'a drag is one undo step')
console.log('undo audit passed — every Studio mutation is one undo step; recordings never hijack Undo; shelf + legibility covered')
process.exit(0)
