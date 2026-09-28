// Upgrades batch 8: match style from selected text, apply project brand kit.
import { build } from 'esbuild'
import { readFileSync, rmSync } from 'node:fs'
import assert from 'node:assert/strict'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
const out = path.resolve('.check-upgrades-batch8.mjs')
await build({ stdin: { contents: ["export * as tl from './src/lib/studio/textList'", "export * as docm from './src/lib/studio/doc'"].join('\n'), resolveDir: process.cwd(), loader: 'ts' }, bundle: true, format: 'esm', platform: 'node', outfile: out, logLevel: 'silent' })
const m = await import(pathToFileURL(out).href).catch((e) => { rmSync(out, { force: true }); throw e })
rmSync(out, { force: true })
let n = 0
const ok = (c, msg) => { assert.ok(c, msg); n++ }
const T = (id, size, extra = {}) => ({ ...m.docm.defaultTextClip(0, 1), id, text: `t-${id}`, fontSizePct: size, x: 0.3, ...extra })
const doc = { ...m.docm.emptyStudioDoc(), clips: [T('src', 12, { fontFamily: 'Geist Variable', color: '#C8F542', anim: 'pop' }), T('h2', 10), T('b', 4), T('l', 1.8, { fontFamily: 'JetBrains Mono' }), T('lock', 12, { locked: true })] }
const r = m.tl.matchStyleFrom(doc, 'src', 'headline')
const h2 = r.doc.clips.find((c) => c.id === 'h2')
ok(r.count === 1 && h2.fontFamily === 'Geist Variable' && h2.color === '#C8F542' && h2.anim === 'pop', 'headline takes the selected look')
ok(h2.fontSizePct === 10 && h2.text === 't-h2' && h2.x === 0.3, 'size, words, position untouched')
ok(r.doc.clips.find((c) => c.id === 'lock').fontFamily !== 'Geist Variable', 'locked skipped')
ok(m.tl.matchStyleFrom(doc, 'nope', 'all').count === 0, 'missing source → no-op')
const k = m.tl.applyBrandKit(doc, { colors: ['#0B0B10', '#F4F1EA', '#C8F542'], font: 'Outfit Variable' })
ok(k.doc.clips.find((c) => c.id === 'h2').color === '#C8F542' && k.doc.clips.find((c) => c.id === 'b').color === '#F4F1EA', 'accent on headlines, light on lines')
ok(k.doc.clips.find((c) => c.id === 'b').fontFamily === 'Outfit Variable' && k.doc.clips.find((c) => c.id === 'l').fontFamily === 'JetBrains Mono', 'brand font except mono labels')
ok(m.tl.applyBrandKit(doc, { colors: [], font: '' }).count === 0, 'empty kit invents nothing')
ok(doc.clips[1].fontFamily !== 'Geist Variable' && doc.clips[2].fontFamily !== 'Outfit Variable', 'input not mutated')
ok(readFileSync('src/screens/Studio.tsx', 'utf8').includes('brandKit={project?.brandKit}'), 'brand kit passed to the panel')
console.log(`upgrades batch8: ${n} assertions passed`)
