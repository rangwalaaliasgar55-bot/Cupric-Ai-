#!/usr/bin/env node
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { readFile, rm } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const tmp = path.join(root, '.template-fill-check.mjs')
await build({
  bundle: true,
  outfile: tmp,
  format: 'esm',
  platform: 'node',
  logLevel: 'warning',
  stdin: {
    contents: `
      export { planTemplateFill, templateSlots } from './src/lib/studio/templateFill'
      export { emptyStudioDoc, defaultTextClip } from './src/lib/studio/doc'
    `,
    resolveDir: root,
    sourcefile: 'check-template-fill.ts',
    loader: 'ts',
  },
})
const mod = await import(`${pathToFileURL(tmp).href}?t=${Date.now()}`)
await rm(tmp, { force: true })

const source = {
  ...mod.defaultTextClip(1, 0),
  id: 'footage',
  kind: 'image',
  name: 'Product screenshot',
  mediaId: 'media-1',
  fileName: 'product.png',
  localPath: null,
  trimInSec: 0,
  sourceDurationSec: 0,
  speed: 1,
  volume: 1,
  fit: 'cover',
  durationSec: 10,
  keyframes: [{ at: 5, ease: 'linear', scale: 1.5 }],
}
const doc = { ...mod.emptyStudioDoc(), clips: [source] }
const before = JSON.stringify(doc)
const data = {
  scenes: [
    ['YOUR PRODUCT', 2, 'pop', 'text'],
    ['Product screen', 4, 'fade-up', 'media'],
  ],
}

// No footage in the project: the media slot is never a blocker — it gets a
// designed placeholder panel and is reported so the dialog can say so.
const bare = { ...mod.emptyStudioDoc(), clips: [] }
const placeholder = mod.planTemplateFill(bare, data, { 'slot-1': { text: 'NewBrand' } }, 'Demo')
assert.deepEqual(placeholder.missing.map((slot) => slot.id), ['slot-2'])
assert.ok(placeholder.clips.some((clip) => clip.kind === 'glass' && /drop your media/i.test(clip.label ?? '')), 'missing media becomes a placeholder panel, not a refusal')
assert.ok(placeholder.clips.some((clip) => clip.kind === 'background'), 'templates bring a stage under the piece')

// Footage in the project auto-fills the slot without being asked.
const auto = mod.planTemplateFill(doc, data, { 'slot-1': { text: 'NewBrand' } }, 'Demo')
assert.equal(auto.missing.length, 0, 'project footage auto-fills media slots')
assert.ok(auto.clips.some((clip) => clip.kind === 'image' && clip.id !== source.id), 'auto-fill clones the project footage')

const plan = mod.planTemplateFill(doc, data, {
  'slot-1': { text: 'NewBrand' },
  'slot-2': { clipId: 'footage' },
}, 'Demo')
assert.equal(JSON.stringify(doc), before, 'planning must not mutate the current edit')
assert.equal(plan.missing.length, 0)
const title = plan.clips.find((clip) => clip.kind === 'text' && clip.text === 'NewBrand')
const media = plan.clips.find((clip) => clip.kind === 'image')
assert.ok(title && media, 'title and media clips are planned')
assert.equal(plan.startSec, 11, 'template must append after the current edit')
assert.equal(title.startSec, 11)
assert.equal(media.startSec, 11 + title.durationSec, 'media follows the title')
assert.equal(media.durationSec, 4)
assert.equal(media.keyframes[0].at, 2, 'source keyframes must be retimed to the slot')
assert.notEqual(media.id, source.id, 'auto-fill must clone source media non-destructively')
assert.ok(title.keyframes?.length >= 2, 'titles arrive directed with keyframed motion')
// Never collides with the existing edit: every planned clip sits on a track
// that is free for its span.
for (const clip of plan.clips) {
  for (const other of doc.clips) {
    const overlap = clip.track === other.track && clip.startSec < other.startSec + other.durationSec && other.startSec < clip.startSec + clip.durationSec
    assert.ok(!overlap, `${clip.name} overlaps ${other.name}`)
  }
}
assert.equal(plan.doc.clips.length, doc.clips.length + plan.clips.length, 'plan.doc is the complete next edit')

const resourceDrop = await readFile(new URL('../src/lib/studio/resourceDrop.ts', import.meta.url), 'utf8')
assert.match(resourceDrop, /case 'saas-template'[\s\S]*?planTemplateFill[\s\S]*?docPatch/, 'dragging a resource template must add editable clips instead of refusing')
assert.doesNotMatch(resourceDrop, /needs media assignments/, 'templates with media slots must never refuse a drop')

console.log('template fill check passed — preview is pure, missing media gets a placeholder, footage auto-fills, media is cloned and retimed')
