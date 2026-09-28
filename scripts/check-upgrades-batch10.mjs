// Upgrades batch 10: agent next-step guidance + UI Lab components/motion in the app shell.
import { build } from 'esbuild'
import { readFileSync, rmSync } from 'node:fs'
import assert from 'node:assert/strict'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
const out = path.resolve('.check-upgrades-batch10.mjs')
await build({ stdin: { contents: ["export * as na from './src/lib/production/nextAction'", "export * as pe from './src/lib/production/engine'"].join('\n'), resolveDir: process.cwd(), loader: 'ts' }, bundle: true, format: 'esm', platform: 'node', outfile: out, logLevel: 'silent' })
const m = await import(pathToFileURL(out).href).catch((e) => { rmSync(out, { force: true }); throw e })
rmSync(out, { force: true })
let n = 0
const ok = (c, msg) => { assert.ok(c, msg); n++ }
const read = (p) => readFileSync(p, 'utf8')
const s0 = m.pe.emptySession()
ok(m.na.nextAction(s0).id === 'answer' && !m.na.nextAction(s0).runnable, 'empty intake → ask, nothing runnable')
const intake = { ...m.pe.emptyIntake(), making: 'A 40 second brand film for Cupric AI', audience: 'builders', platform: 'YouTube', assets: 'none' }
const s1 = { ...s0, intake }
ok(m.na.nextAction(s1).id === 'run-all' && m.na.nextAction(s1).runnable, 'answered → run to approval')
const index = JSON.parse(read('resources/opus55/data/index.json'))
const r = m.pe.runToApproval(index, intake)
const s2 = { ...s1, ...r, approved: false }
const a = m.na.nextAction(s2)
ok(a.id === 'approve' && !a.runnable && /manual/i.test(a.why), 'approval is next → never runnable, says manual')
ok(m.na.nextAction({ ...s2, approved: true }).id === 'finish', 'approved → build & polish')
ok(m.na.nextAction({ ...s2, approved: true, builtClipIds: ['x'], review: [{ id: 'h', label: 'Hook', status: 'fail', detail: '', fix: null }] }).id === 'fix', 'failing review → fix')
ok(m.na.nextAction({ ...s2, approved: true, builtClipIds: ['x'], review: [] }).id === 'export', 'clean → export')
const planner = read('src/screens/production/ProductionPlanner.tsx')
ok(/data-testid="agent-next-step"/.test(planner) && !/na\.id === 'approve'\) (?:approve|setApproved)/.test(planner), 'next-step card wired; approve is never auto-run')
ok(planner.includes('<ActivityTimeline'), 'checkpoints shown as the Lab activity timeline')
const top = read('src/app-shell/TopBar.tsx')
ok(top.includes('<AutosaveStatus') && top.includes('<Breadcrumbs'), 'top bar uses Lab autosave status + breadcrumbs')
ok(read('src/app-shell/AppLayout.tsx').includes('<MotionConfig reducedMotion="user">'), 'app-wide motion honours reduced-motion')
ok(read('src/screens/HomeProject.tsx').includes('<AnimatePresence'), 'project grid animates in/out')
console.log(`upgrades batch10: ${n} assertions passed`)
