// Upgrades batch 2: keyframe value graph, status centre, Auto run → editable timeline.
import { build } from 'esbuild'
import { readFileSync, rmSync } from 'node:fs'
import assert from 'node:assert/strict'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
const out = path.resolve('.check-upgrades-batch2.mjs')
await build({ stdin: { contents: ["export * as kg from './src/lib/studio/keyframeGraph'", "export * as sc from './src/lib/statusCenter'", "export * as fr from './src/lib/production/fromRundown'", "export * as docm from './src/lib/studio/doc'", "export { keyframeValuesAt } from './src/lib/studio/renderer'"].join('\n'), resolveDir: process.cwd(), loader: 'ts' },
  bundle: true, format: 'esm', platform: 'node', outfile: out, logLevel: 'silent' })
const m = await import(pathToFileURL(out).href)
rmSync(out, { force: true })
let n = 0
const ok = (c, msg) => { assert.ok(c, msg); n++ }
const read = (p) => readFileSync(p, 'utf8')

/* keyframe graph */
const clip = { ...m.docm.defaultTextClip(2, 0), id: 't', durationSec: 4, keyframes: [{ at: 0, opacity: 0, ease: 'ease-out' }, { at: 1, opacity: 1, ease: 'linear' }, { at: 3, opacity: 1, scale: 1.2, ease: 'linear' }] }
const s = m.kg.sampleProp(clip, 'opacity', 40)
ok(s.length === 41 && s[0][1] === 0 && Math.abs(s[40][1] - 1) < 1e-9, 'graph samples start/end values')
ok(s.every(([t, v]) => { const r = m.keyframeValuesAt(clip, clip.startSec + t); return Math.abs((r?.opacity ?? 1) - v) < 1e-9 }), 'graph == renderer interpolation (preview/export parity)')
ok(JSON.stringify(m.kg.animatedProps(clip.keyframes)) === JSON.stringify(['opacity', 'scale']), 'animated props detected')
const moved = m.kg.moveKey(clip.keyframes, 1, 9, 5, 'opacity', 4)
ok(moved[moved.length - 1].at <= 4 && moved.every((k) => (k.opacity ?? 0) <= 1), 'moveKey clamps time and value')
ok(moved.every((k, i, a) => i === 0 || k.at > a[i - 1].at), 'moveKey keeps keys sorted and never stacks two at one time')
const added = m.kg.addKeyAt(clip, 'opacity', 0.5)
ok(added.length === 4 && Math.abs(added.find((k) => k.at === 0.5).opacity - m.keyframeValuesAt(clip, 2.5).opacity) < 1e-9, 'addKeyAt keeps the curve shape')
const cb = m.kg.copyKeys(clip.keyframes)
ok(cb.spanSec === 3 && cb.keys[0].at === 0, 'copy stores relative timing')
const p1 = m.kg.pasteKeys([], cb, 2, 4)
ok(p1.dropped === 1 && p1.keys.length === 2, 'paste past the clip end drops (and reports) overflow')
const p2 = m.kg.pasteKeys([], cb, 2, 4, true)
ok(p2.dropped === 0 && p2.keys[p2.keys.length - 1].at === 4, 'paste-to-fit scales timing to finish at the end')
ok(m.kg.setAllEases(clip.keyframes, 'back-out').every((k) => k.ease === 'back-out'), 'set every ease')
ok(/<KeyframeGraph /.test(read('src/screens/studio/StudioInspector.tsx')), 'graph mounted in the inspector')

/* status centre */
const jobs = [
  { id: 'a', projectId: 'p', brief: 'Launch', status: 'running', currentStepId: 's2', steps: [{ id: 's1', label: 'One', status: 'done', progressPct: 100 }, { id: 's2', label: 'Two', status: 'running', progressPct: 50 }], createdAt: '2026-01-01', updatedAt: '2026-01-02' },
  { id: 'b', projectId: 'p', brief: 'Old', status: 'done', currentStepId: null, steps: [], createdAt: '2026-01-01', updatedAt: '2026-01-01' },
  { id: 'c', projectId: 'p', brief: 'Gate', status: 'waiting-for-user', currentStepId: null, steps: [{ id: 'x', label: 'Arena', status: 'waiting-for-user', progressPct: 100 }], createdAt: '2026-01-01', updatedAt: '2026-01-03' },
]
const items = m.sc.collectStatus(jobs, [{ id: 'p', name: 'Proj', renderJobs: [{ id: 'r', aspect: '9:16', fps: 30, quality: 'final', status: 'rendering', progressPct: 40, outputName: null, createdAt: '2026-01-04' }] }])
ok(items.length === 4 && items[0].state === 'active' && items.at(-1).state === 'done', 'active first, done last')
ok(items.find((i) => i.id === 'a').pct === 75, 'Auto progress = finished steps + current step share')
ok(items.find((i) => i.id === 'c').detail.includes('review'), 'manual gate shows as needing you')
ok(m.sc.activeCount(items) === 3, 'badge counts active + waiting')
ok(/<StatusCenter \/>/.test(read('src/app-shell/TopBar.tsx')), 'status centre in the top bar')

/* Auto run → editable timeline */
const rundown = { title: 'Penny', durationSec: 8, fps: 30, size: [1080, 1920], style: 'bold kinetic', scenes: [{ id: '1', from: 0, to: 3, type: 'hook', copy: 'Save smarter', motion: 'pop' }, { id: '2', from: 3, to: 8, type: 'cta', copy: '', motion: 'fade' }, { id: 'bad', from: 5, to: 4, type: 'x', copy: 'x', motion: '' }] }
const base = { ...m.docm.emptyStudioDoc(), clips: [{ ...m.docm.defaultTextClip(0, 0), id: 'mine', durationSec: 2 }] }
let k = 0
const r = m.fr.rundownToDoc(base, rundown, () => `r${k++}`)
ok(r.clipIds.length === 2, 'invalid scenes skipped')
ok(r.doc.clips.find((c) => c.id === 'mine') && r.doc.clips.filter((c) => r.clipIds.includes(c.id)).every((c) => c.startSec >= 2), 'appended after the current timeline, your clips untouched')
ok(r.placeholders === 1 && r.doc.clips.some((c) => c.text === '[cta line]'), 'empty scene → labelled placeholder, no invented copy')
ok(r.doc.clips.filter((c) => r.clipIds.includes(c.id)).every((c) => c.keyframes?.length >= 2), 'scene clips get Cupric AI keyframes')
k = 0
ok(JSON.stringify(m.fr.rundownToDoc(base, rundown, () => `r${k++}`)) === JSON.stringify(r), 'deterministic')
ok(/Edit in Studio/.test(read('src/screens/Autonomous.tsx')), 'Auto job card offers Edit in Studio')
console.log(`upgrades batch 2: ${n} assertions passed`)
