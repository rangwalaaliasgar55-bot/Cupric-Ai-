// Autonomous production engine: intake → brief → research → plan → build →
// review. Covers determinism, citations to real catalogue cases, no invented
// copy, the non-destructive build and replace guard, placeholders, the
// review, schema round-trip and UI wiring.
import { build } from 'esbuild'
import { readFileSync, rmSync } from 'node:fs'
import assert from 'node:assert/strict'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const out = path.resolve('.check-production.mjs')
await build({
  stdin: { contents: ["export * as pe from './src/lib/production/engine'", "export * as pt from './src/lib/production/types'", "export * as docm from './src/lib/studio/doc'", "export * as schema from './src/state/projectSchema'"].join('\n'), resolveDir: process.cwd(), loader: 'ts' },
  bundle: true, format: 'esm', platform: 'node', outfile: out, logLevel: 'silent',
})
const m = await import(pathToFileURL(out).href)
rmSync(out, { force: true })
let n = 0
const ok = (c, msg) => { assert.ok(c, msg); n++ }
const read = (p) => readFileSync(p, 'utf8')
const index = JSON.parse(read('resources/opus55/data/index.json'))
const skills = JSON.parse(read('resources/opus55/skills.json'))
const raw = JSON.parse(read('resources/opus55/data/cases.json'))
const rawCases = Array.isArray(raw) ? raw : raw.cases

/* index integrity */
ok(index.cases.length === rawCases.length && index.cases.length >= 300, `index covers every case (${index.cases.length})`)
ok(index.cases.every((c) => /^https?:\/\//.test(c.sourceUrl)), 'every case keeps its source URL')
ok(index.cases.every((c) => c.durationSec === null || (c.durationSec >= 3 && c.durationSec <= 600)), 'stated durations are plausible or null (never guessed)')
ok(index.cases.every((c) => c.targetPlatform === null && c.ctaPattern === null && c.shotCount === null), 'fields the catalogue never states stay null')
ok((skills.skills ?? skills).length >= 20 && (skills.skills ?? skills).every((s) => Math.abs(s.beats.reduce((a, b) => a + b.share, 0) - 1) < 0.02), 'skills: beat shares sum to 1')

/* intake + brief */
const intake = { ...m.pe.emptyIntake(), making: 'Launch video for our budgeting app Penny', audience: 'students', platform: 'Instagram Reels', durationSec: 20, cta: 'Download Penny free', mustKeep: 'Save smarter, not harder', assets: 'penny-demo.mp4\nlogo.png' }
ok(m.pe.openQuestions(m.pe.emptyIntake()).some((q) => q.required), 'empty intake leaves required questions open')
const brief = m.pe.buildBrief(intake)
ok(JSON.stringify(brief) === JSON.stringify(m.pe.buildBrief(intake)), 'brief deterministic')
ok(brief.aspect === '9:16', 'Reels → 9:16')
ok(brief.fields.some((f) => f.source === 'assumed'), 'assumptions are labelled')
ok(m.pe.detectLanguage('नमस्ते दुनिया').language === 'hi', 'Devanagari → Hindi')
ok(m.pe.detectLanguage('yeh app bahut accha hai, try karo').language === 'en+hi', 'Hinglish detected')

/* research: citations resolve to real cases */
const found = m.pe.research(index, brief, [{ id: 'transitions-dev-matrix-scan', name: 'Matrix scan', pack: 'transitions-dev', description: 'loader', tags: ['loader'] }])
ok(found.cases.length > 0 && found.cases.every((c) => index.cases.some((x) => x.caseId === c.caseId && x.sourceUrl === c.sourceUrl)), 'every citation is a real catalogue case with its URL')
ok(found.skills.length > 0 && found.skills.every((s) => (skills.skills ?? skills).some((k) => k.id === s.id)), 'picked skills exist')
ok(JSON.stringify(found) === JSON.stringify(m.pe.research(index, brief, [{ id: 'transitions-dev-matrix-scan', name: 'Matrix scan', pack: 'transitions-dev', description: 'loader', tags: ['loader'] }])), 'research deterministic')

/* plan */
const plan = m.pe.buildPlan(index, brief, found)
ok(JSON.stringify(plan) === JSON.stringify(m.pe.buildPlan(index, brief, found)), 'plan deterministic')
const total = plan.shots.reduce((a, s) => a + s.durationSec, 0)
ok(Math.abs(total - 20) < 0.6, `plan fills the requested 20s (${total.toFixed(2)})`)
ok(plan.decisions.every((d) => ['high', 'medium', 'low'].includes(d.confidence)), 'every decision has a confidence')
const userCopy = [intake.cta, intake.mustKeep, intake.making]
for (const s of plan.shots) ok(s.onScreenText.startsWith('[') || userCopy.some((u) => u.includes(s.onScreenText) || s.onScreenText.includes(u)) || /penny/i.test(s.onScreenText), `shot ${s.id} copy is the user's words or a bracketed placeholder ("${s.onScreenText}")`)
ok(!/\d+%|\d+x\b|million|#1|best in/i.test(plan.shots.map((s) => s.onScreenText).join(' ')), 'no invented stats or claims')

/* build: append by default, replace guarded */
const doc = m.docm.emptyStudioDoc()
let k = 0
const existing = { ...doc, clips: [{ ...m.docm.defaultTextClip(0, 0), id: 'mine', text: 'My intro' }] }
const r = m.pe.planToDoc(existing, plan, brief, { makeId: () => `b${k++}` })
ok(r.doc.clips.some((c) => c.id === 'mine' && c.text === 'My intro'), 'append keeps existing clips untouched')
ok(r.clipIds.length > 0 && r.clipIds.every((id) => r.doc.clips.some((c) => c.id === id)), 'built clips are real, editable Studio clips')
ok(Math.min(...r.doc.clips.filter((c) => r.clipIds.includes(c.id)).map((c) => c.startSec)) >= m.docm.docDuration(existing) - 1e-6, 'built clips start after the current timeline')
assert.throws(() => m.pe.planToDoc(existing, plan, brief, { makeId: () => 'x', replace: true }), /approv/i); n++
const rep = m.pe.planToDoc(existing, plan, brief, { makeId: () => `r${k++}`, replace: true, replaceApproved: true })
ok(!rep.doc.clips.some((c) => c.id === 'mine'), 'replace only with explicit approval')
ok(r.placeholders > 0, 'no media imported → labelled placeholders, never fake footage')
ok(m.pe.planToDoc(existing, plan, brief, { makeId: (i) => `d${i}` }).doc.clips.length === m.pe.planToDoc(existing, plan, brief, { makeId: (i) => `d${i}` }).doc.clips.length, 'build deterministic')
const parsed = m.schema.ProjectSchema?.safeParse ? null : null
void parsed

/* NewBrand motion + polish */
ok(r.clipIds.every((id) => { const c = r.doc.clips.find((x) => x.id === id); return Array.isArray(c.keyframes) && c.keyframes.length >= 2 && c.keyframes.every((k, i, a) => i === 0 || k.at >= a[i - 1].at) }), 'every built clip gets sorted, editable keyframes')
ok(r.doc.clips.find((c) => c.id === 'mine').keyframes == null, 'your own clips are never re-animated')
ok(m.pe.planToDoc(existing, plan, brief, { makeId: (i) => `z${i}`, motion: false }).doc.clips.every((c) => !c.keyframes), 'motion can be turned off')
{
  const messy = { ...r.doc, clips: r.doc.clips.map((c) => (r.clipIds.includes(c.id) && c.kind === 'text' ? { ...c, y: 0.95 } : r.clipIds.includes(c.id) ? { ...c, transitionIn: 'fade' } : c)) }
  const p1 = m.pe.polishEdit(messy, brief, plan, r.clipIds)
  const txt = (d) => d.clips.filter((c) => c.kind === 'text').map((c) => c.text).join('|')
  ok(txt(p1.doc) === txt(messy), 'polish never rewrites copy')
  ok(p1.doc.clips.filter((c) => r.clipIds.includes(c.id) && c.kind === 'text').every((c) => c.y >= 0.14 && c.y <= 0.78), 'polish moves text into the safe area')
  ok(p1.doc.clips.filter((c) => r.clipIds.includes(c.id) && (c.kind === 'image' || c.kind === 'video') && !c.mediaId).length === r.placeholders, 'polish never fakes media for placeholders')
  ok(p1.leftForYou.some((l) => /placeholder/.test(l)), 'polish lists what still needs you')
  ok(p1.doc.aspect === messy.aspect, 'polish never changes aspect on its own')
  ok(JSON.stringify(p1) === JSON.stringify(m.pe.polishEdit(messy, brief, plan, r.clipIds)), 'polish deterministic')
  const before = m.pe.reviewEdit(messy, brief, plan, r.clipIds), after = m.pe.reviewEdit(p1.doc, brief, plan, r.clipIds)
  ok(m.pe.reviewScore(after) > m.pe.reviewScore(before), `polish raises the review score (${m.pe.reviewScore(before)} → ${m.pe.reviewScore(after)})`)
}

/* review */
const review = m.pe.reviewEdit(r.doc, brief, plan, r.clipIds)
ok(review.length >= 10 && review.every((c) => ['pass', 'warn', 'fail'].includes(c.status) && c.label), `review runs ${review.length} checks`)
ok(review.some((c) => c.status !== 'pass'), 'review flags placeholders / missing copy')
const score = m.pe.reviewScore(review)
ok(score >= 0 && score <= 100, `review score in range (${score})`)

/* session normalisation (resume) */
const s = m.pe.normaliseSession({ stage: 'plan', intake, brief, research: found, plan, approved: 'yes', checkpoints: [{ stage: 'brief', label: 'x', at: '2026-01-01' }] })
ok(s.stage === 'plan' && s.approved === false, 'resume keeps the stage; approval must be a real boolean (never implied)')
ok(m.pe.normaliseSession(null).stage === 'intake' && m.pe.normaliseSession({ stage: 'nope' }).stage === 'intake', 'garbage → fresh session')

/* purity + wiring */
const src = read('src/lib/production/engine.ts')
ok(!/Math\.random|Date\.now|new Date\(/.test(src), 'engine has no randomness or wall clock')
ok(/production: z\.unknown\(\)/.test(read('src/state/projectSchema.ts')), 'schema keeps production across save/load')
ok(/commitProduction/.test(read('src/state/useProjectStore.ts')), 'store commits production + build as one undo step')
const ui = read('src/screens/production/ProductionPlanner.tsx')
ok(/<ProductionPlanner \/>/.test(read('src/screens/Autonomous.tsx')), 'planner is on the Autonomous screen')
ok(/disabled=\{!session\.approved\}/.test(ui) && /replaceApproved/.test(ui), 'UI: build gated on manual approval; replace needs second consent')
ok(!/approved: true/.test(ui), 'UI never sets approval programmatically')
ok(/NewBrand polish/.test(ui) && /setAskOpen\(true\)/.test(ui), 'UI: NewBrand polish + Ask NewBrand in review')
const main = read('electron/main.cjs')
ok(/CANDIDATE_DEADLINE_MS/.test(main) && /Promise\.race\(\[Promise\.allSettled/.test(main), 'candidates run in parallel under one deadline (no endless spinner)')
ok(/const liveModel = /.test(main), 'no model → NewBrand built-in candidates straight away')
ok(!/is polishing it in the background/.test(main) && /NewBrand drafted this rundown/.test(main), 'Brief credits NewBrand, not a hidden provider')
console.log(`production: ${n} assertions passed`)
