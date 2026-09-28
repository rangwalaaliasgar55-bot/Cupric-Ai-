// Upgrades batch 4: multi-select clip ops + getting-started checklist from real state.
import { build } from 'esbuild'
import { readFileSync, rmSync } from 'node:fs'
import assert from 'node:assert/strict'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
const out = path.resolve('.check-upgrades-batch4.mjs')
await build({ stdin: { contents: ["export * as et from './src/lib/studio/editTools'", "export * as docm from './src/lib/studio/doc'", "export * as gs from './src/lib/gettingStarted'"].join('\n'), resolveDir: process.cwd(), loader: 'ts' },
  bundle: true, format: 'esm', platform: 'node', outfile: out, logLevel: 'silent' })
const m = await import(pathToFileURL(out).href)
rmSync(out, { force: true })
let n = 0
const ok = (c, msg) => { assert.ok(c, msg); n++ }
const read = (p) => readFileSync(p, 'utf8')
const T = (id, start, dur, extra = {}) => ({ ...m.docm.defaultTextClip(start, 1), id, startSec: start, durationSec: dur, ...extra })
const doc = { ...m.docm.emptyStudioDoc(), clips: [T('a', 1, 2), T('b', 3, 2), T('c', 6, 1), T('L', 2, 1, { locked: true })] }
const sel = new Set(['a', 'b', 'L'])
let s = m.et.toggleInSelection(new Set(), 'a', 'b')
ok(s.has('a') && s.has('b'), 'first toggle includes primary')
s = m.et.toggleInSelection(s, 'a', 'b'); ok(!s.has('b'), 'toggle removes')
const g = m.et.groupClips(doc, sel, 'G'); ok(g.count === 2 && !g.doc.clips.find((c) => c.id === 'L').groupId, 'group skips locked')
const d = m.et.deleteClips(doc, sel); ok(d.count === 2 && d.doc.clips.some((c) => c.id === 'L') && d.doc.clips.length === 2, 'delete skips locked')
const nd = m.et.nudgeClips(doc, sel, 0.5); ok(nd.doc.clips.find((c) => c.id === 'a').startSec === 1.5 && nd.doc.clips.find((c) => c.id === 'L').startSec === 2, 'nudge moves unlocked only')
const al = m.et.alignStarts(doc, new Set(['b', 'c'])); ok(al.doc.clips.find((c) => c.id === 'c').startSec === 3, 'align to earliest')
ok(doc.clips.find((c) => c.id === 'a').startSec === 1, 'input not mutated')
const p0 = { id: 'p', name: 'x', createdAt: '', updatedAt: '', brief: { messages: [], draftRundown: null, lockedRundown: null }, arenaAssets: [], footageAssets: [], timeline: [], renderJobs: [], brandKit: { colors: [], font: '', logoDataUrl: null } }
ok(m.gs.progressOf(m.gs.gettingStartedSteps(p0)).done === 0, 'empty project: nothing done')
const p1 = { ...p0, brief: { ...p0.brief, messages: [{ role: 'user', text: 'hi', at: '' }] }, studio: doc, renderJobs: [{ status: 'done' }] }
const st = m.gs.gettingStartedSteps(p1)
ok(st.find((x) => x.id === 'brief').done && st.find((x) => x.id === 'edit').done && st.find((x) => x.id === 'render').done && !st.find((x) => x.id === 'lock').done, 'steps reflect state')
ok(read('src/screens/Studio.tsx').includes('onToggleMulti'), 'Studio wires multi-select')
ok(read('src/screens/studio/StudioTimeline.tsx').includes('onToggleMulti'), 'timeline shift-click')
ok(read('src/screens/studio/EditToolsBar.tsx').includes('clips selected'), 'multi toolbar')
ok(read('src/screens/HomeProject.tsx').includes('<GettingStarted'), 'checklist mounted')
console.log(`upgrades batch4: ${n} assertions passed`)
