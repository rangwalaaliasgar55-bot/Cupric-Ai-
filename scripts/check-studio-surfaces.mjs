#!/usr/bin/env node
/** Reachability audit: renderer capabilities must have an actual Studio control. */
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const [inspector, preview, timeline, studio, app, main, css, generatedPackage, lab, sources, projectTypes, strip] = await Promise.all([
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
  readFile(new URL('../src/screens/Timeline.tsx', import.meta.url), 'utf8'),
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
// S still splits the selected clip; since Phase 1.3 it goes through the command
// layer so a split that cannot happen (playhead outside the clip, too close to
// an edge) says why instead of doing nothing. Assert the routing, not just the
// keypress: the shortcut has to reach a split command, not merely call a
// function whose name contains "split".
assert.match(studio, /key === 's'[\s\S]*?splitAtPlayhead\(/, 'S must split the selected clip')
assert.match(studio, /const splitAtPlayhead = useCallback\([\s\S]*?kind: 'split'[\s\S]*?runTimelineCommand\(/, 'the split shortcut must issue a split command through the timeline command layer')
{
  const accept = (studio.match(/accept="(video\/\*[^"]*)"/) || [])[1] || ''
  for (const t of ['video/*', 'image/*', 'audio/*', '.zip', '.html', '.htm', '.heic']) assert.ok(accept.split(',').includes(t), `Studio import must accept ${t} (generated HTML/zip packages, HEIC photos)`)
}
assert.match(generatedPackage, /mediaReferences[\s\S]*?entry\.async\('blob'\)/, 'zip import must extract referenced package media without executing HTML')
assert.match(studio, /generated\.assets[\s\S]*?registerFile\(asset\.file\)[\s\S]*?StudioMediaClip/, 'package media must become editable native Studio clips')
const resourceDrop = await readFile(new URL('../src/lib/studio/resourceDrop.ts', import.meta.url), 'utf8')
assert.match(projectTypes, /frames\?: string\[\][\s\S]*?frameFps\?: number/, 'Studio overlays must retain deterministic React animation frames')
const recorder = await readFile(new URL('../src/lib/studio/componentRecorder.ts', import.meta.url), 'utf8')
const recorderHost = await readFile(new URL('../src/screens/studio/ComponentRecorderHost.tsx', import.meta.url), 'utf8')
const componentsPanel = await readFile(new URL('../src/screens/studio/ComponentsPanel.tsx', import.meta.url), 'utf8')
assert.match(recorder, /captureElement\([\s\S]*?resampleShots\(/, 'components must be recorded in real time and resampled, not frozen to a still')
assert.match(recorder, /trimFrames\(/, 'component recordings must be cropped to the component, not the whole stage')
assert.match(recorderHost, /isPendingComponent[\s\S]*?recordComponent\([\s\S]*?status: 'ready'/, 'pending component clips must be recorded by the Studio host')
assert.match(recorderHost, /forceMotion/, 'recordings must animate even when the OS asks for reduced motion')
assert.match(componentsPanel, /Add at playhead/, 'Studio must offer every component from its own Components panel')
assert.match(studio, /<ComponentRecorderHost/, 'Studio must mount the component recorder')
assert.match(studio, /isPendingComponent\)[\s\S]*?still recording/, 'export must wait for components that are still recording')
assert.match(lab, /withComponent\(/, 'Lab → Studio must use the same recorded-component pipeline')
assert.match(lab, /focusStudioClip\(clip\.id\)/, 'Studio must open on a visible moment of the clip Lab just added')
const capture = await readFile(new URL('../src/lib/capture.ts', import.meta.url), 'utf8')
assert.match(capture, /flattenModernColours/, 'the html2canvas fallback must survive oklch/color-mix colours')
assert.match(capture, /margin: '0'/, 'html-to-image clones must not inherit the root margin (shifted captures)')
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
// Windows-only, and the window chrome has to stay that way: no macOS vibrancy,
// no platform conditionals around the BrowserWindow.
assert.doesNotMatch(main, /darwin/, 'the main process must not carry macOS code paths')
assert.doesNotMatch(main, /vibrancy|titleBarStyle|trafficLightPosition/, 'the window must not request macOS-only chrome')
assert.doesNotMatch(main, /process\.platform === 'linux'/, 'the main process must not carry Linux code paths')
assert.doesNotMatch(app, /vibrancy/, 'the renderer must not carry a macOS-only surface flag')
assert.doesNotMatch(css, /data-vibrancy/, 'the stylesheet must not carry macOS-only rules')

// The Timeline screen is the project-level strip of Arena pieces and footage:
// its playhead must show the real source it points at, and say so when there is
// nothing it can honestly show.
assert.match(strip, /useLocalMediaUrl/, 'the Timeline preview must resolve local files the same way every other player does')
assert.match(strip, /const activeClip = clips\.find\(/, 'the Timeline must know which clip the playhead is inside')
assert.match(strip, /<video[\s\S]*?currentTime/, 'the Timeline preview must seek the real file')
assert.match(strip, /No clip under the playhead/, 'an empty playhead state must exist')
assert.match(strip, /Render it from Arena Desk/, 'Arena HTML pieces must explain why there is no video still')
assert.match(strip, /Open Footage Desk/, 'a footage clip with no file must offer the screen that fixes it')
assert.match(strip, /could not be decoded/, 'a file that fails to decode must say so, not show black')

console.log('studio surface audit passed — rotation, keyframes, 3-node grade, masks, Timeline preview and the Windows-only window are enforced')
