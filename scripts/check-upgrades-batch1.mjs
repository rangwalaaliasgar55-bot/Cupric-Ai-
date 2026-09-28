// Upgrades batch 1: run-to-approval, auto-finish loop (build → polish rounds,
// beat snap), Hindi fonts, command palette ranking + wiring.
import { build } from 'esbuild'
import { readFileSync, rmSync, existsSync } from 'node:fs'
import assert from 'node:assert/strict'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
const out = path.resolve('.check-upgrades-batch1.mjs')
await build({ stdin: { contents: ["export * as pe from './src/lib/production/engine'", "export * as docm from './src/lib/studio/doc'", "export * as vf from './src/lib/studio/videoFonts'", "export { rankCommands } from './src/lib/commandRank'"].join('\n'), resolveDir: process.cwd(), loader: 'tsx' },
  bundle: true, format: 'esm', platform: 'node', outfile: out, logLevel: 'silent', jsx: 'automatic', external: ['react', 'react/jsx-runtime', 'lucide-react', 'zustand', 'zustand/*'] })
const m = await import(pathToFileURL(out).href).catch((e) => { rmSync(out, { force: true }); throw e })
rmSync(out, { force: true })
let n = 0
const ok = (c, msg) => { assert.ok(c, msg); n++ }
const read = (p) => readFileSync(p, 'utf8')
const index = JSON.parse(read('resources/opus55/data/index.json'))

const intake = { ...m.pe.emptyIntake(), making: 'Launch reel for Penny budgeting app', platform: 'Reels', durationSec: 20, cta: 'Download Penny', mustKeep: 'Save smarter' }
const r = m.pe.runToApproval(index, intake)
ok(r.brief && r.research && r.plan && r.plan.shots.length > 0, 'run to approval: brief + research + plan')
ok(JSON.stringify(r) === JSON.stringify(m.pe.runToApproval(index, intake)), 'run to approval deterministic')
ok(!('approved' in r), 'run to approval never approves')

let k = 0
const doc = m.docm.emptyStudioDoc()
const f = m.pe.autoFinish(doc, r.plan, r.brief, { makeId: () => `a${k++}`, snapToBeats: true })
ok(f.rounds.length >= 2 && f.rounds.length <= 4, `auto-finish ran ${f.rounds.length - 1} polish round(s)`)
ok(f.rounds.every((x, i, a) => i === 0 || x.score >= a[i - 1].score), 'scores never go down across rounds')
ok(f.beatNote && /Beats|music/.test(f.beatNote) && f.beatsSnapped === 0, 'no analysed music → honest beat note, no fake snapping')
ok(f.leftForYou.some((l) => /placeholder|bracketed/.test(l)), 'auto-finish lists what still needs you')
// With analysed music: cuts roll onto beats.
const withMusic = { ...doc, clips: [{ id: 'mus', kind: 'audio', track: 5, startSec: 0, durationSec: 30, name: 'music', transitionIn: 'none', transitionOut: 'none', opacity: 1, mediaId: 'm', fileName: 'm.mp3', localPath: null, trimInSec: 0, sourceDurationSec: 30, speed: 1, volume: 0.8, beats: { bpm: 120, times: Array.from({ length: 60 }, (_, i) => i * 0.5 + 0.13) } }] }
k = 0
const g = m.pe.autoFinish(withMusic, r.plan, r.brief, { makeId: () => `b${k++}`, snapToBeats: true })
ok(/Rolled \d+ cut/.test(g.beatNote), `beat snap reported: ${g.beatNote}`)
ok(m.pe.autoFinish(withMusic, r.plan, r.brief, { makeId: (i) => `c${i}`, snapToBeats: true }).doc.clips.length === m.pe.autoFinish(withMusic, r.plan, r.brief, { makeId: (i) => `c${i}`, snapToBeats: true }).doc.clips.length, 'auto-finish deterministic')
assert.throws(() => m.pe.autoFinish(withMusic, r.plan, r.brief, { makeId: () => 'x', replace: true }), /approv/i); n++

/* Hindi fonts */
ok(m.vf.suggestFont('नमस्ते दोस्तों') === 'Noto Sans Devanagari', 'Devanagari text → Noto Sans Devanagari')
ok(m.vf.VIDEO_FONT_FAMILIES.has('Noto Sans Devanagari') && m.vf.VIDEO_FONT_FAMILIES.has('Hind'), 'Hindi fonts in the video font list')
ok(/noto-sans-devanagari\/700\.css/.test(read('src/styles.css')) && existsSync('node_modules/@fontsource/noto-sans-devanagari/700.css'), 'Hindi font bundled locally (no network at export)')
const hi = m.pe.runToApproval(index, { ...intake, making: 'पेनी ऐप लॉन्च वीडियो', mustKeep: 'स्मार्ट बचत', cta: 'अभी डाउनलोड करें', language: 'hi' })
k = 0
const hb = m.pe.planToDoc(doc, hi.plan, hi.brief, { makeId: () => `h${k++}` })
ok(hb.doc.clips.filter((c) => c.kind === 'text').every((c) => c.fontFamily === 'Noto Sans Devanagari'), 'Hindi build uses the Devanagari font')

/* palette */
const items = [{ label: 'Go to Studio' }, { label: 'Go to Library', keywords: 'resources packs' }, { label: 'Undo' }, { label: 'Ask Cupric AI', keywords: 'keyframes' }]
ok(m.rankCommands(items, 'und')[0].label === 'Undo', 'palette: prefix wins')
ok(m.rankCommands(items, 'packs')[0].label === 'Go to Library', 'palette: keywords searchable')
ok(m.rankCommands(items, 'gtst')[0].label === 'Go to Studio', 'palette: subsequence fallback')
ok(m.rankCommands(items, 'zzz').length === 0 && m.rankCommands(items, '').length === 4, 'palette: no match / empty query')
ok(/<CommandPalette \/>/.test(read('src/app-shell/AppLayout.tsx')), 'palette mounted app-wide')
const ui = read('src/screens/production/ProductionPlanner.tsx')
ok(/Run to approval/.test(ui) && /Build \+ Cupric AI polish/.test(ui) && /Cut on music beats/.test(ui), 'planner UI exposes run-to-approval, auto-finish and beat cut')
console.log(`upgrades batch 1: ${n} assertions passed`)
