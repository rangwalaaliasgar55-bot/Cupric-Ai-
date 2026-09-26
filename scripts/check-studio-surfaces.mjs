#!/usr/bin/env node
/** Reachability audit: renderer capabilities must have an actual Studio control. */
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const [inspector, preview, app, main, css] = await Promise.all([
  readFile(new URL('../src/screens/studio/StudioInspector.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/screens/studio/StudioPreview.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/App.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../electron/main.cjs', import.meta.url), 'utf8'),
  readFile(new URL('../src/styles.css', import.meta.url), 'utf8'),
])

for (const [label, pattern] of [
  ['rotation slider', /label="Rotation"[\s\S]*?onPatch\(\{ rotation:/],
  ['keyframe disclosure', /<Disclosure[\s\S]*?label="Keyframes"/],
  ['three-node grade', /<GradeFields[\s\S]*?<MaskFields/],
  ['balance grade node', /id: 'balance'/],
  ['contrast grade node', /id: 'contrast'/],
  ['look grade node', /id: 'look'/],
  ['mask disclosure', /<Disclosure label="Mask"/],
]) {
  assert.match(inspector, pattern, `${label} is not reachable from StudioInspector`)
}
assert.match(preview, /mode: 'move' \| 'scale' \| 'rotate'/, 'canvas transform handles must expose rotation')
assert.match(preview, /title="Drag to rotate/, 'rotation handle needs a visible affordance')
assert.match(main, /vibrancy: 'under-window'/, 'macOS BrowserWindow must request native vibrancy')
assert.match(main, /transparent: true/, 'macOS vibrancy window must be transparent')
assert.match(app, /dataset\.vibrancy = 'on'/, 'renderer must enable the vibrancy CSS surface on macOS')
assert.match(css, /html\[data-vibrancy='on'\]/, 'vibrancy CSS must let the native material show through')

console.log('studio surface audit passed — rotation, keyframes, 3-node grade, masks and macOS vibrancy are UI-reachable')
