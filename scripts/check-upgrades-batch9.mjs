// Upgrades batch 9: text style presets (save / parse / apply).
import { build } from 'esbuild'
import { readFileSync, rmSync } from 'node:fs'
import assert from 'node:assert/strict'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
const out = path.resolve('.check-upgrades-batch9.mjs')
await build({ stdin: { contents: ["export * as tl from './src/lib/studio/textList'", "export * as docm from './src/lib/studio/doc'"].join('\n'), resolveDir: process.cwd(), loader: 'ts' }, bundle: true, format: 'esm', platform: 'node', outfile: out, logLevel: 'silent' })
const m = await import(pathToFileURL(out).href).catch((e) => { rmSync(out, { force: true }); throw e })
rmSync(out, { force: true })
let n = 0
const ok = (c, msg) => { assert.ok(c, msg); n++ }
const T = (id, size, extra = {}) => ({ ...m.docm.defaultTextClip(0, 1), id, text: id, fontSizePct: size, ...extra })
const src = T('s', 12, { fontFamily: 'Geist Variable', color: '#C8F542', weight: 800, anim: 'pop' })
const p = m.tl.presetFromClip(src, '  Lime hook  ')
ok(p.name === 'Lime hook' && p.look.color === '#C8F542' && !('text' in p.look) && !('fontSizePct' in p.look), 'preset keeps look only')
const round = m.tl.parsePresets(JSON.stringify([p]))
ok(round.length === 1 && round[0].look.fontFamily === 'Geist Variable', 'round-trips through storage')
ok(m.tl.parsePresets('{bad').length === 0 && m.tl.parsePresets(null).length === 0 && m.tl.parsePresets('[{"name":1}]').length === 0, 'malformed storage → empty, never throws')
ok(m.tl.parsePresets(JSON.stringify([{ name: 'x', look: { color: 'javascript:1', weight: 5 } }]))[0].look.color === undefined, 'invalid values dropped')
ok(m.tl.upsertPreset([p], { ...p, look: { color: '#FFFFFF' } }).length === 1, 'same name replaces')
const doc = { ...m.docm.emptyStudioDoc(), clips: [T('h', 10), T('b', 4), T('lock', 10, { locked: true })] }
const r = m.tl.applyPreset(doc, round[0], 'headline')
ok(r.count === 1 && r.doc.clips[0].color === '#C8F542' && r.doc.clips[0].fontSizePct === 10 && r.doc.clips[2].color !== '#C8F542', 'applies to role, keeps size, skips locked')
ok(readFileSync('src/screens/studio/TextListPanel.tsx', 'utf8').includes('applyPreset(doc, p, role)'), 'presets wired in the panel')
console.log(`upgrades batch9: ${n} assertions passed`)
