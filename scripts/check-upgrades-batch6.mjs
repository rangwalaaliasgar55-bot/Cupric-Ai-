// Upgrades batch 6: format starters (fill blanks only) + all-text list / find & replace.
import { build } from 'esbuild'
import { readFileSync, rmSync } from 'node:fs'
import assert from 'node:assert/strict'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
const out = path.resolve('.check-upgrades-batch6.mjs')
await build({ stdin: { contents: ["export * as st from './src/lib/production/starters'", "export * as tl from './src/lib/studio/textList'", "export * as pe from './src/lib/production/engine'", "export * as docm from './src/lib/studio/doc'"].join('\n'), resolveDir: process.cwd(), loader: 'ts' },
  bundle: true, format: 'esm', platform: 'node', outfile: out, logLevel: 'silent' })
const m = await import(pathToFileURL(out).href).catch((e) => { rmSync(out, { force: true }); throw e })
rmSync(out, { force: true })
let n = 0
const ok = (c, msg) => { assert.ok(c, msg); n++ }
const read = (p) => readFileSync(p, 'utf8')

const empty = m.pe.emptyIntake()
const r = m.st.applyStarter(empty, 'brand-film')
ok(r.filled.includes('making') && r.patch.durationSec === 40, 'starter fills blanks')
const typed = { ...empty, making: 'My own words', durationSec: 30 }
const r2 = m.st.applyStarter(typed, 'brand-film')
ok(!('making' in r2.patch) && !('durationSec' in r2.patch), 'starter never overwrites user answers')
ok(m.st.applyStarter(empty, 'nope').filled.length === 0, 'unknown starter is a no-op')
ok(m.st.FORMAT_STARTERS.every((f) => !/\d+%|\d+x|best|#1|guarantee/i.test(JSON.stringify(f.fill))), 'starters contain no claims')
const index = JSON.parse(read('resources/opus55/data/index.json'))
const plan = m.pe.runToApproval(index, { ...empty, ...r.patch, making: r.patch.making.replace('[Your brand]', 'Cupric AI'), audience: 'builders' }).plan
ok(plan.skillId === 'kinetic-brand-film', 'brand-film starter routes to the kinetic brand film recipe')

const T = (id, start, text, extra = {}) => ({ ...m.docm.defaultTextClip(start, 1), id, startSec: start, text, ...extra })
const doc = { ...m.docm.emptyStudioDoc(), clips: [T('b', 3, 'Smart art'), T('a', 1, 'ART first. art.'), T('L', 2, 'art locked', { locked: true })] }
ok(m.tl.listTextClips(doc).map((c) => c.id).join() === 'a,L,b', 'text list sorted by time')
const fr = m.tl.findReplaceText(doc, 'art', 'craft', { wholeWord: true })
ok(fr.hits === 3 && fr.clips === 2, `whole-word, case-insensitive replace (${fr.hits}/${fr.clips})`)
ok(fr.doc.clips.find((c) => c.id === 'b').text === 'Smart craft', '"Smart" untouched by whole-word')
ok(fr.doc.clips.find((c) => c.id === 'L').text === 'art locked', 'locked clips untouched')
ok(doc.clips.find((c) => c.id === 'a').text === 'ART first. art.', 'input not mutated')
ok(m.tl.findReplaceText(doc, 'zzz', 'y').doc === doc, 'no match → same doc (no empty undo step)')
ok(m.tl.findReplaceText(doc, 'क', 'x', { wholeWord: true }).hits === 0, 'Unicode-safe regex')
ok(m.tl.setClipText(doc, 'L', 'x').clips.find((c) => c.id === 'L').text === 'art locked', 'setClipText respects lock')

ok(read('src/screens/Studio.tsx').includes('<TextListPanel'), 'text list mounted in Studio')
ok(read('src/screens/production/ProductionPlanner.tsx').includes('FORMAT_STARTERS.map'), 'starters shown in the intake')
console.log(`upgrades batch6: ${n} assertions passed`)
