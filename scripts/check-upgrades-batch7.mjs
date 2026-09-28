// Upgrades batch 7: restyle all text by role, shift all text timing.
import { build } from 'esbuild'
import { readFileSync, rmSync } from 'node:fs'
import assert from 'node:assert/strict'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
const out = path.resolve('.check-upgrades-batch7.mjs')
await build({ stdin: { contents: ["export * as tl from './src/lib/studio/textList'", "export * as docm from './src/lib/studio/doc'"].join('\n'), resolveDir: process.cwd(), loader: 'ts' }, bundle: true, format: 'esm', platform: 'node', outfile: out, logLevel: 'silent' })
const m = await import(pathToFileURL(out).href).catch((e) => { rmSync(out, { force: true }); throw e })
rmSync(out, { force: true })
let n = 0
const ok = (c, msg) => { assert.ok(c, msg); n++ }
const T = (id, start, size, extra = {}) => ({ ...m.docm.defaultTextClip(start, 1), id, startSec: start, text: id, fontSizePct: size, ...extra })
const doc = { ...m.docm.emptyStudioDoc(), clips: [T('h', 1, 12), T('b', 2, 4), T('l', 3, 1.8), T('mono', 4, 5, { fontFamily: 'JetBrains Mono' }), T('lock', 5, 12, { locked: true })] }
ok(['h', 'b', 'l', 'mono'].map((id) => m.tl.roleOf(doc.clips.find((c) => c.id === id))).join() === 'headline,body,label,label', 'roles by size/font')
const r = m.tl.restyleText(doc, { role: 'headline', fontFamily: 'Geist Variable', color: '#C8F542' })
ok(r.count === 1 && r.doc.clips.find((c) => c.id === 'h').fontFamily === 'Geist Variable' && r.doc.clips.find((c) => c.id === 'lock').fontFamily !== 'Geist Variable', 'restyle one role, skip locked')
ok(r.doc.clips.find((c) => c.id === 'h').text === 'h', 'words untouched')
ok(m.tl.restyleText(doc, { role: 'all', color: 'red' }).doc.clips.every((c, i) => c.color === doc.clips[i].color), 'invalid colour ignored')
ok(m.tl.restyleText(doc, { role: 'all', scale: 10 }).doc.clips.find((c) => c.id === 'h').fontSizePct === 40, 'scale clamped')
const s = m.tl.shiftAllText(doc, -5)
ok(s.doc.clips.find((c) => c.id === 'h').startSec === 0 && s.doc.clips.find((c) => c.id === 'lock').startSec === 5, 'shift clamps at 0 and skips locked')
ok(m.tl.shiftAllText(doc, 0).doc === doc, 'zero shift is a no-op')
ok(doc.clips[0].startSec === 1, 'input not mutated')
ok(readFileSync('src/screens/studio/TextListPanel.tsx', 'utf8').includes('restyleText(doc'), 'restyle wired in the panel')
console.log(`upgrades batch7: ${n} assertions passed`)
