#!/usr/bin/env node
/**
 * check:frame-accurate — Phase 1.3. Timeline drag, trim and split already existed; they
 * landed on a 0.01 s grid, which sits between frames at 24/30/60 fps. Every edit path now
 * lands on a frame boundary of the document's fps, and the paused preview shows the frame
 * under the playhead (half-frame tolerance, mid-frame seek).
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import { rm } from 'node:fs/promises'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const out = path.join(root, '.check-frame-accurate.mjs')
await build({
  bundle: true, outfile: out, format: 'esm', platform: 'node', logLevel: 'error',
  stdin: { contents: "export * from './src/lib/studio/doc'\nexport * as actions from './src/lib/studio/clipActions'", resolveDir: root, loader: 'ts' },
})
const m = await import(pathToFileURL(out).href)
await rm(out, { force: true })

let n = 0
const near = (a, b, msg) => { assert.ok(Math.abs(a - b) < 1e-6, `${msg}: ${a} vs ${b}`); n += 1 }
const onGrid = (t, fps, msg) => { assert.ok(Math.abs(t * fps - Math.round(t * fps)) < 1e-4, `${msg}: ${t}`); n += 1 }

near(m.snapToFrame(1.01, 30), 1, '1.01 s at 30 fps is frame 30')
near(m.snapToFrame(1.02, 30), 31 / 30, '1.02 s at 30 fps is frame 31')
near(m.snapToFrame(0.509, 60), 31 / 60, '60 fps grid')
near(m.snapToFrame(0.5, 24), 0.5, '24 fps grid')
near(m.snapToFrame(2, 0), 2, 'a bad fps falls back to 30, not NaN')

const doc = { ...m.emptyStudioDoc(), fps: 30 }
onGrid(m.snapTime(doc, 1.02, '', [], 0), 30, 'snapTime lands on the frame grid')

const clip = { id: 'a', kind: 'video', name: 'a', track: 0, startSec: 0, durationSec: 4, trimInSec: 1, speed: 1, transitionIn: 'none', transitionOut: 'none' }
const halves = m.splitClipAt(clip, 1.01, 30)
near(halves[0].durationSec, 1, 'split cuts on the frame')
near(halves[1].startSec, 1, 'right half starts on the frame')
near(halves[1].trimInSec, 2, 'right half source in-point follows the snapped cut')
near(halves[0].durationSec + halves[1].durationSec, 4, 'split loses no time')
assert.ok(m.splitClipAt(clip, 1.01) !== null); n += 1 // no fps: legacy behaviour preserved

const withClip = { ...doc, clips: [clip] }
const r = m.actions.applyClipAction(withClip, 'a', 'split', { time: 2.345, clipboard: null })
onGrid(r.doc.clips[1].startSec, 30, 'menu split is frame-accurate')
const mv = m.actions.applyClipAction(withClip, 'a', 'to-playhead', { time: 1.017, clipboard: null })
onGrid(mv.doc.clips[0].startSec, 30, 'move-to-playhead is frame-accurate')

const src = (p) => readFileSync(path.join(root, p), 'utf8')
assert.match(src('src/state/useProjectStore.ts'), /splitClipAt\(clip, atSec, doc\.fps\)/); n += 1
assert.match(src('src/screens/studio/StudioPreview.tsx'), /0\.5 \/ fps/); n += 1
assert.match(src('src/screens/studio/StudioTimeline.tsx'), /snapToFrame\(time [-+]/); n += 1

console.log(`frame-accurate check passed — ${n} assertions`)
