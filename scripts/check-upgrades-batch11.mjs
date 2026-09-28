// Upgrades batch 11: Quick Video pipeline (after MoneyPrinterTurbo, MIT) + React Bits–style app effects.
import { build } from 'esbuild'
import { readFileSync, rmSync } from 'node:fs'
import assert from 'node:assert/strict'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
const out = path.resolve('.check-upgrades-batch11.mjs')
await build({ stdin: { contents: "export * from './src/lib/production/quickVideo'", resolveDir: process.cwd(), loader: 'ts' }, bundle: true, format: 'esm', platform: 'node', outfile: out, logLevel: 'silent' })
const q = await import(pathToFileURL(out).href).catch((e) => { rmSync(out, { force: true }); throw e })
rmSync(out, { force: true })
let n = 0
const ok = (c, msg) => { assert.ok(c, msg); n++ }
const read = (p) => readFileSync(p, 'utf8')
const s = { ...q.DEFAULT_QUICK_SETTINGS, topic: 'Morning routines', variants: 3, seed: 7 }
const bad = q.sanitizeSettings({ ...s, apiKey: 'sk-secret', clipMaxSec: 999, aspect: 'weird', subtitleColor: 'red' })
ok(!('apiKey' in bad) && bad.clipMaxSec === 10 && bad.aspect === '9:16' && bad.subtitleColor === '#FFFFFF', 'settings allowlisted + clamped, secrets dropped')
ok(JSON.stringify(q.importSettings(q.exportSettings(s))) === JSON.stringify(q.sanitizeSettings(s)), 'settings export/import round-trips')
assert.throws(() => q.importSettings('{"kind":"other"}')); n++
const script = q.draftScript(s)
ok(script.includes('Morning routines') && !/\d+%/.test(script), 'offline draft uses the topic, invents no stats')
ok(/video subject: Morning routines/.test(q.scriptPrompt(s)) && /Never invent statistics/.test(q.scriptPrompt(s)), 'live prompt carries subject + honesty rule')
ok(q.cleanScript('```\n**Scene 1:** Hello there.\n```') === 'Hello there.', 'model reply cleaned to narration')
const terms = q.searchTerms('Morning routines', 'Coffee first. Then stretching. Coffee again and journaling.', 4, true)
ok(terms.length <= 4 && terms.every((t) => t.split(' ').length <= 3) && terms[0] === 'morning routines', 'search terms 1–3 words, subject first')
const lines = q.splitSubtitles('This is a fairly long sentence that must wrap. Short one!', 20)
ok(lines.every((l) => l.length <= 20) && lines.length >= 3, 'subtitles wrap at max chars')
const timed = q.timeSubtitles(lines, 10)
ok(Math.abs(timed.at(-1).startSec + timed.at(-1).durationSec - 10) < 0.05, 'subtitle timing covers narration')
const media = [0, 1, 2].map((i) => ({ mediaId: `m${i}`, fileName: `f${i}.jpg`, localPath: null, kind: 'image', durationSec: 0, term: `t${i}` }))
const plan = q.planFootage(media, 11, 3, 'random', 7)
ok(Math.abs(plan.reduce((a, p) => a + p.durationSec, 0) - 11) < 0.05 && plan.every((p) => p.durationSec <= 3), 'footage covers narration, each ≤ max clip length')
ok(JSON.stringify(plan) === JSON.stringify(q.planFootage(media, 11, 3, 'random', 7)), 'seeded shuffle is deterministic')
ok(JSON.stringify(q.planFootage(media, 11, 3, 'sequential', 7).map((p) => p.media.mediaId).slice(0, 3)) === '["m0","m1","m2"]', 'sequential keeps order')
const base = { aspect: '16:9', fps: 30, backgroundId: 'lime-void', clips: [], trackCount: 3 }
const voice = { mediaId: 'v', fileName: 'v.wav', localPath: null, durationSec: 9 }
const music = { mediaId: 'b', fileName: 'b.mp3', localPath: null, durationSec: 60 }
const doc = q.buildQuickVariants(base, s, script, media, { voice, music })
ok(doc.aspect === '9:16' && doc.scenes.length === 3, 'aspect preset applied; 3 variants saved as scenes')
ok(doc.clips.some((c) => c.kind === 'audio' && c.role === 'voice') && doc.clips.find((c) => c.role === 'music').volume === 0.2 && doc.ducking?.enabled, 'voice + music with own volume, ducking on')
ok(doc.clips.filter((c) => c.kind === 'text').every((c) => c.captionStyle === 'standard' && c.y === 0.84), 'subtitles styled + positioned')
ok(doc.credits.some((c) => c.sourceLicense === 'MIT' && /harry0703/.test(c.url)), 'MIT attribution recorded')
ok(JSON.stringify(q.buildQuickVariants(base, s, script, media, { voice, music })) === JSON.stringify(doc), 'build is deterministic')
const src = read('src/lib/production/quickVideo.ts')
ok(!/Math\.random|Date\.now|performance\.now/.test(src), 'no randomness or clock in the pipeline')
const panel = read('src/screens/production/QuickVideoPanel.tsx')
ok(panel.includes("'stock:search'") && panel.includes('synthesizeVoiceover') && panel.includes('buildQuickVariants') && panel.includes('patchStudio'), 'panel wired to stock IPC, offline voice, Studio doc')
ok(!/publish|upload_post|approve\(/i.test(panel.replace(/published automatically/g, '')), 'no auto-publish or approval')
ok(read('src/screens/production/ProductionPlanner.tsx').includes('<QuickVideoPanel />'), 'panel mounted in the production planner')
const fx = read('src/components/fx/index.tsx')
ok(fx.includes('useReducedMotion') && /no React Bits source is copied/.test(fx), 'effects respect reduced motion and are original code')
ok(!/components\/fx/.test(read('src/lib/studio/renderer.ts') + ''), 'effects never enter the Studio renderer')
console.log(`upgrades batch 11 OK (${n} assertions)`)
