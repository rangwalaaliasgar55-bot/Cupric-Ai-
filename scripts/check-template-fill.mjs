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

const missing = mod.planTemplateFill(doc, data, { 'slot-1': { text: 'Cupric' } }, 'Demo')
assert.deepEqual(missing.missing.map((slot) => slot.id), ['slot-2'])
assert.equal(missing.clips.length, 1, 'missing media must not create a fake placeholder clip')

const plan = mod.planTemplateFill(doc, data, {
  'slot-1': { text: 'Cupric' },
  'slot-2': { clipId: 'footage' },
}, 'Demo')
assert.equal(JSON.stringify(doc), before, 'planning must not mutate the current edit')
assert.equal(plan.missing.length, 0)
assert.equal(plan.clips.length, 2)
assert.equal(plan.clips[0].startSec, 11, 'template must append after the current edit')
assert.equal(plan.clips[1].startSec, 13)
assert.equal(plan.clips[1].durationSec, 4)
assert.equal(plan.clips[1].keyframes[0].at, 2, 'source keyframes must be retimed to the slot')
assert.notEqual(plan.clips[1].id, source.id, 'auto-fill must clone source media non-destructively')

const resourceDrop = await readFile(new URL('../src/lib/studio/resourceDrop.ts', import.meta.url), 'utf8')
assert.match(resourceDrop, /case 'saas-template'[\s\S]*?planTemplateFill[\s\S]*?docPatch/, 'dragging an all-text resource template must add editable clips instead of refusing')

console.log('template fill check passed — preview is pure, missing slots block, media is cloned and retimed')
