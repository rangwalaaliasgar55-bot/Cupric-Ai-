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

/**
 * Run `fn`, assert it added exactly one undo step, undo restores, redo re-applies.
 * `pick` selects the slice of the project being audited (the Studio doc by
 * default, the timeline strip for the timeline ops).
 */
async function oneStep(label, fn, pick = () => doc()) {
  await wait(750) // outside the coalescing window
  const before = JSON.stringify(pick())
  const n = steps()
  fn()
  const after = JSON.stringify(pick())
  assert.notEqual(after, before, `${label}: changed something`)
  assert.equal(steps(), n + 1, `${label}: exactly one undo step`)
  S().undo()
  assert.equal(JSON.stringify(pick()), before, `${label}: undo restores`)
  S().redo()
  assert.equal(JSON.stringify(pick()), after, `${label}: redo re-applies`)
}

/** A mutation that changes nothing must add NO undo step and keep the redo branch. */
async function noStep(label, fn, pick = () => doc()) {
  await wait(750)
  const before = JSON.stringify(pick())
  const n = steps()
  const future = S().future.length
  fn()
  assert.equal(JSON.stringify(pick()), before, `${label}: changed nothing`)
  assert.equal(steps(), n, `${label}: no undo step for a no-op`)
  assert.equal(S().future.length, future, `${label}: the redo branch survives a no-op`)
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

// The timeline strip is the same project, a different model: same undo rules.
const project = () => S().projects.find((p) => p.id === pid)
const timeline = () => project().timeline

// No-op mutations are not edits: settling an already settled clip, deleting an
// id that is not there, a trim that snaps back to the same length.
await noStep('settle an already settled clip', () => S().settleStudioClip(pid, 'c1'))
await noStep('delete a clip id that does not exist', () => S().removeStudioClip(pid, 'nope'))
await noStep('resize a clip to the length it already has', () => S().setClipDuration(pid, 'c1'), () => project().timeline)
await oneStep('settle a clip moved off its neighbours (2.31)', () => {
  S().updateStudioClip(pid, 'c1', { startSec: 0.37 })
  S().settleStudioClip(pid, 'c1')
}, () => doc())

assert.equal(timeline().length, 0, 'the timeline starts empty in this project')
await oneStep('add a timeline clip', () => S().addTimelineClip(pid, { sourceType: 'footage', sourceId: 'f1', durationSec: 4 }), timeline)
assert.equal(timeline().length, 1, 'the clip is on the strip')
await oneStep('change a timeline clip duration', () => S().setClipDuration(pid, timeline()[0].id, 6), timeline)
assert.equal(timeline()[0].durationSec, 6, 'the duration changed')
await oneStep('remove a timeline clip', () => S().removeTimelineClip(pid, timeline()[0].id), timeline)
assert.equal(timeline().length, 0, 'the strip is empty again')

// Two clips, then reorder: the strip is ordered by the project, not by start times.
S().addTimelineClip(pid, { sourceType: 'footage', sourceId: 'f1', durationSec: 2 })
S().addTimelineClip(pid, { sourceType: 'arena', sourceId: 'a1', durationSec: 2 })
await oneStep('reorder timeline clips', () => S().moveTimelineClip(pid, 0, 1), timeline)
assert.equal(timeline()[0].sourceType, 'arena', 'reorder moved the second clip first')

// Production sessions (the Autonomous hand-off) are one step, like any edit.
await oneStep('commit a production session', () => S().commitProduction(pid, { step: 'review', briefs: 1 }, 'Autonomous run'), () => project().production)

console.log('undo audit passed — 16 mutations each exactly one undo step, 3 no-ops add none, recordings never hijack Undo, shelf/legibility/timeline/production covered')
process.exit(0)
