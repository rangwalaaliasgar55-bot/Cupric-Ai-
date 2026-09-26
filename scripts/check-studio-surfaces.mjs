#!/usr/bin/env node
/** Reachability audit: renderer capabilities must have an actual Studio control. */
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const [inspector, preview, timeline, studio, app, main, css, generatedPackage, lab, sources, projectTypes] = await Promise.all([
  readFile(new URL('../src/screens/studio/StudioInspector.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/screens/studio/StudioPreview.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/screens/studio/StudioTimeline.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/screens/Studio.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/App.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../electron/main.cjs', import.meta.url), 'utf8'),
  readFile(new URL('../src/styles.css', import.meta.url), 'utf8'),
  readFile(new URL('../src/lib/studio/generatedPackage.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/screens/Lab.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/lib/studio/sources.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/types/project.ts', import.meta.url), 'utf8'),
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
assert.match(preview, /patchTransformKeyframe/, 'canvas handles must route transforms into keyframes')
assert.match(timeline, /drag to retime/, 'timeline must expose draggable keyframe diamonds')
assert.match(studio, /Keyframe record/, 'Studio must expose canvas keyframe record mode')
assert.match(inspector, /Import a Lottie/, 'Lottie import must be reachable from the inspector')
assert.match(studio, /addSticker/, 'built-in Lottie stickers must be addable from Studio')
for (const key of ['j', 'k', 'l', 's']) assert.match(studio, new RegExp(`key === '${key}'`), `${key.toUpperCase()} shortcut must stay wired`)
assert.match(studio, /key === 'k'[\s\S]*?patchTransformKeyframe/, 'K must create a keyframe on the selected clip')
assert.match(studio, /key === 's'[\s\S]*?splitStudioClip/, 'S must split the selected clip')
assert.match(studio, /accept="video\/\*,image\/\*,audio\/\*,\.zip,\.html,\.htm"/, 'Studio import must accept generated HTML and zip packages')
assert.match(generatedPackage, /mediaReferences[\s\S]*?entry\.async\('blob'\)/, 'zip import must extract referenced package media without executing HTML')
assert.match(studio, /generated\.assets[\s\S]*?registerFile\(asset\.file\)[\s\S]*?StudioMediaClip/, 'package media must become editable native Studio clips')
const resourceDrop = await readFile(new URL('../src/lib/studio/resourceDrop.ts', import.meta.url), 'utf8')
assert.match(projectTypes, /frames\?: string\[\][\s\S]*?frameFps\?: number/, 'Studio overlays must retain deterministic React animation frames')
assert.match(lab, /frameCount = frameFps \* durationSec[\s\S]*?frames\.push\(canvas\.toDataURL\('image\/webp'/, 'Lab must render React motion rather than capture only a still')
assert.match(sources, /frames\.forEach[\s\S]*?Math\.floor\(localSec \* \(clip\.frameFps/, 'preview and export must choose component frames from clip progress')
for (const effect of ['bg-soft-grid', 'bg-dot-field', 'bg-lime-haze', 'bg-noise-paper', 'tr-mask-wipe', 'tr-scale-overshoot', 'cap-hormozi', 'cap-minimal', 'mo-word-reveal', 'mo-counter-tick']) {
  assert.match(resourceDrop, new RegExp(effect), `${effect} must perform a native editable Studio action`)
}
assert.match(preview, /clip\.kind === 'video' \|\| clip\.kind === 'image'[\s\S]*?media\.scale/, 'video and image clips must expose canvas resize handles')
assert.match(inspector, /label="Scale" value=\{clip\.scale \?\? 1\}/, 'media scale must be editable in the inspector')
assert.match(studio, /key === 'i' \|\| key === 'o'/, 'I/O shortcuts must stay wired')
assert.match(studio, /if \(mod && key === 'z'\)/, 'undo/redo must be reachable from Studio')
assert.match(main, /critiqueAndRepair/, 'generated candidates must retain critique-and-repair')
assert.match(main, /perspective: 1200px[\s\S]*?preserve-3d/, 'generated HTML prompt must retain deterministic CSS 3D guidance')
assert.match(main, /vibrancy: 'under-window'/, 'macOS BrowserWindow must request native vibrancy')
assert.match(main, /transparent: true/, 'macOS vibrancy window must be transparent')
assert.match(app, /dataset\.vibrancy = 'on'/, 'renderer must enable the vibrancy CSS surface on macOS')
assert.match(css, /html\[data-vibrancy='on'\]/, 'vibrancy CSS must let the native material show through')

console.log('studio surface audit passed — rotation, keyframes, 3-node grade, masks and macOS vibrancy are UI-reachable')
