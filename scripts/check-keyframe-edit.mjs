#!/usr/bin/env node
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { rm } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const tmp = path.join(root, '.keyframe-edit-check.mjs')
await build({
  bundle: true,
  outfile: tmp,
  format: 'esm',
  platform: 'node',
  logLevel: 'warning',
  stdin: {
    contents: `
      export { patchTransformKeyframe, moveKeyframeTime, nearestKeyframeIndex } from './src/lib/studio/keyframeEdit'
      export { defaultTextClip } from './src/lib/studio/doc'
    `,
    resolveDir: root,
    sourcefile: 'check-keyframe-edit.ts',
    loader: 'ts',
  },
})
const mod = await import(`${pathToFileURL(tmp).href}?t=${Date.now()}`)
await rm(tmp, { force: true })

const clip = {
  ...mod.defaultTextClip(10, 1),
  durationSec: 4,
  x: 0.5,
  y: 0.5,
  keyframes: [
    { at: 1, x: 0.2, y: 0.3, scale: 1, rotation: 0, opacity: 1, ease: 'linear' },
    { at: 3, x: 0.8, y: 0.7, scale: 1, rotation: 0, opacity: 1, ease: 'ease-out' },
  ],
}
const original = JSON.stringify(clip)
const nearby = mod.patchTransformKeyframe(clip, 11.04, { x: 0.35, y: 0.4 }, false)
assert.ok(nearby, 'canvas drag near a keyframe must edit that keyframe')
assert.equal(nearby.keyframes[0].x, 0.35)
assert.equal(nearby.keyframes[1].x, 0.8)
assert.equal(JSON.stringify(clip), original, 'keyframe edits must be immutable')
assert.equal(mod.patchTransformKeyframe(clip, 12, { x: 0.4 }, false), null, 'static transforms remain static away from a keyframe')
const recorded = mod.patchTransformKeyframe(clip, 12, { rotation: 45 }, true)
assert.equal(recorded.keyframes.length, 3)
assert.equal(recorded.keyframes[1].at, 2)
assert.equal(recorded.keyframes[1].rotation, 45)

const left = mod.moveKeyframeTime(clip.keyframes, 1, 0.2, clip.durationSec, 30)
assert.ok(left[1].at > left[0].at, 'dragged keyframes cannot cross the previous keyframe')
const right = mod.moveKeyframeTime(clip.keyframes, 0, 3.8, clip.durationSec, 30)
assert.ok(right[0].at < right[1].at, 'dragged keyframes cannot cross the next keyframe')

console.log('keyframe edit check passed — canvas routing, record mode and timeline retiming are deterministic')
