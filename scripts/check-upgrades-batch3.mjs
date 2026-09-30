// Upgrades batch 3: trim tools visible, grouping, text-based editing, SRT, platform presets.
import { build } from 'esbuild'
import { readFileSync, rmSync } from 'node:fs'
import assert from 'node:assert/strict'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
const out = path.resolve('.check-upgrades-batch3.mjs')
await build({ stdin: { contents: ["export * as et from './src/lib/studio/editTools'", "export * as ae from './src/lib/studio/autoEdit'", "export * as docm from './src/lib/studio/doc'"].join('\n'), resolveDir: process.cwd(), loader: 'ts' },
  bundle: true, format: 'esm', platform: 'node', outfile: out, logLevel: 'silent' })
const m = await import(pathToFileURL(out).href)
rmSync(out, { force: true })
let n = 0
const ok = (c, msg) => { assert.ok(c, msg); n++ }
const read = (p) => readFileSync(p, 'utf8')
const T = (id, start, dur, extra = {}) => ({ ...m.docm.defaultTextClip(start, 1), id, durationSec: dur, ...extra })
const doc = { ...m.docm.emptyStudioDoc(), clips: [T('a', 0, 3), T('b', 1, 2, { track: 2 }), T('c', 5, 2), T('lock', 1, 1, { track: 3, locked: true })] }

/* grouping */
const g = m.et.groupOverlapping(doc, 'a', 'G')
ok(g.count === 2 && g.doc.clips.find((c) => c.id === 'b').groupId === 'G' && !g.doc.clips.find((c) => c.id === 'c').groupId, 'groups only clips overlapping in time')
ok(!g.doc.clips.find((c) => c.id === 'lock').groupId, 'locked clips are never pulled into a group')
const mv = m.et.moveWithGroup(g.doc, 'a', { startSec: 2, track: 3 })
ok(mv.clips.find((c) => c.id === 'a').startSec === 2 && mv.clips.find((c) => c.id === 'b').startSec === 3 && mv.clips.find((c) => c.id === 'b').track === 4, 'moving one member moves the group by the same delta')
const clampMv = m.et.moveWithGroup(g.doc, 'b', { startSec: 0 })
ok(clampMv.clips.find((c) => c.id === 'a').startSec === 0 && clampMv.clips.find((c) => c.id === 'b').startSec === 1, 'group move clamps at 0 s (nobody goes negative)')
ok(m.et.moveWithGroup(doc, 'a', { startSec: 2 }) === null && m.et.moveWithGroup(g.doc, 'a', { opacity: 0.5 }) === null, 'ungrouped or non-move patches fall through')
const u = m.et.ungroup(g.doc, 'b')
ok(u.count === 2 && u.doc.clips.every((c) => !c.groupId), 'ungroup clears the whole group')
// Phase 1.3 moved the drag path behind the timeline command layer, so the group
// move happens in the `move-group` command. Assert the whole chain: Studio hands
// the timeline's commands to the store, and the store's command layer routes a
// grouped clip through moveWithGroup.
ok(/onCommand=\{\(command\) => runTimelineCommand\(/.test(read('src/screens/Studio.tsx')), 'timeline gestures route through the command layer')
ok(/case 'move-group':[\s\S]*?moveWithGroup\(doc, clip\.id/.test(read('src/lib/studio/commands.ts')), 'a grouped drag moves the whole group')

/* text-based editing */
const words = ['So', 'um', 'this', 'is', 'basically', 'Penny'].map((w, i) => ({ word: w, start: i * 0.5, end: i * 0.5 + 0.4 }))
const cuts = m.et.wordCuts(words, new Set([1]), [0, 3])
ok(cuts.length === 1 && cuts[0][0] > 0.4 && cuts[0][1] < 1.0, 'one struck word → one cut between its neighbours')
const merged = m.et.wordCuts(words, new Set([3, 4]), [0, 3])
ok(merged.length === 1, 'adjacent struck words merge into one cut')
ok(m.et.wordCuts(words, new Set([0]), [0, 3])[0][0] === 0, 'first word cut starts at the clip start')
const vid = { id: 'v', kind: 'video', track: 0, startSec: 0, durationSec: 3, name: 'v', transitionIn: 'none', transitionOut: 'none', opacity: 1, mediaId: 'm', fileName: 'v.mp4', localPath: null, trimInSec: 0, sourceDurationSec: 3, speed: 1, volume: 1, fit: 'cover', words }
const cap = T('cap', 2.5, 0.5)
const tdoc = { ...m.docm.emptyStudioDoc(), clips: [vid, cap] }
const tr = m.ae.tightenClip(tdoc, 'v', { cuts })
ok(tr.cuts === 1 && tr.removedSec > 0.1, `explicit cuts applied (${tr.removedSec}s)`)
ok(tr.doc.clips.find((c) => c.id === 'cap').startSec < 2.5, 'later captions move with the words')
ok(m.ae.tightenClip(tdoc, 'v', { cuts: [] }).reason === 'No words selected to cut.', 'no words selected → explained')

/* SRT */
const sdoc = { ...m.docm.emptyStudioDoc(), clips: [T('x', 61.5, 2, { text: 'Hello *world*' }), T('y', 0, 1.25, { text: 'First' }), T('z', 3, 1, { text: '[hook line]' })] }
const srt = m.et.studioToSrt(sdoc)
ok(srt.cues === 2 && srt.skipped === 1, 'SRT skips placeholders and says so')
ok(srt.srt.startsWith('1\n00:00:00,000 --> 00:00:01,250\nFirst') && srt.srt.includes('00:01:01,500 --> 00:01:03,500\nHello world'), 'SRT timecodes + emphasis markers stripped')

/* presets */
const reels = m.et.PLATFORM_PRESETS.find((p) => p.id === 'reels')
ok(m.et.PLATFORM_PRESETS.length >= 5 && m.et.PLATFORM_PRESETS.every((p) => p.maxSec > 0 && p.safeBottom > 0), 'platform presets defined')
const pd = { ...m.docm.emptyStudioDoc(), aspect: '16:9', clips: [T('t', 0, 200, { y: 0.95 })] }
const issues = m.et.checkPreset(pd, reels)
ok(issues.some((i) => /Aspect/.test(i.text)) && issues.some((i) => /longer/.test(i.text)) && issues.some((i) => /UI covers/.test(i.text)), 'preset check: aspect, length, safe zone')
ok(m.et.checkPreset({ ...pd, aspect: '9:16', clips: [T('t', 0, 20, { y: 0.5 })] }, reels).length === 0, 'clean doc passes')

/* UI wiring */
const bar = read('src/screens/studio/EditToolsBar.tsx')
ok(/slipClip/.test(bar) && /slideClip/.test(bar) && /rollEdit/.test(bar) && /closeGaps/.test(bar), 'slip/slide/roll/close-gaps visible as buttons')
ok(/<EditToolsBar /.test(read('src/screens/Studio.tsx')), 'edit tools mounted in Studio')
ok(/Edit by transcript/.test(bar), 'transcript editing reachable')
const panel = read('src/screens/studio/StudioCreativePanel.tsx')
ok(/Platform export preset/.test(panel) && /Captions \(\.srt\)/.test(panel), 'preset + SRT in the Create panel')
console.log(`upgrades batch 3: ${n} assertions passed`)
