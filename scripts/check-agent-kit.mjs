// Agent kit: ObsidianUI-inspired components (licence, frame purity), the
// universal component font prop, intent-based component picks, the
// setComponentProps op, smooth defaults and the agent prompt playbooks.
import { build } from 'esbuild'
import { readFileSync, rmSync, existsSync } from 'node:fs'
import assert from 'node:assert/strict'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const read = (p) => readFileSync(p, 'utf8')
let n = 0
const ok = (c, msg) => { assert.ok(c, msg); n++ }
const throws = (fn, re, msg) => { assert.throws(fn, re, msg); n++ }

/* licence + provenance */
const lic = read('src/lab/obsidian/LICENSE')
ok(lic.includes('MIT License') && lic.includes('Copyright (c) 2026 ObsidianUI'), 'ObsidianUI MIT notice kept')
const obSrc = (read('src/lab/obsidian/index.tsx') + read('src/lab/obsidian/board.tsx')).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
ok(!/requestAnimationFrame|Math\.random|Date\.now|performance\.now|addEventListener|gsap/.test(obSrc), 'ob components: no wall clock, randomness or events')
ok(obSrc.includes('useTimingInfo'), 'ob components read the stage clock')

const entry = [
  "import { renderToString } from 'react-dom/server'",
  "import { createElement } from 'react'",
  "import { StageClock } from './src/lab/framecn/editframe-shim'",
  "import { fontOverrideCss } from './src/lab/framecn/stage'",
  "export * as ob from './src/lab/obsidian'",
  "export { OBSIDIAN_CONFIGS } from './src/lab/obsidian/configs'",
  "export { OBSIDIAN_ENTRIES } from './src/lab/obsidian/entries'",
  "export { PROP_CONFIGS } from './src/lab/propConfigs'",
  "export { lab } from './src/lab/registry'",
  'export { renderToString, createElement, StageClock, fontOverrideCss }',
  "export * as comps from './src/lib/studio/components'",
  "export * as ops from './src/lib/studio/editOps'",
  "export * as docm from './src/lib/studio/doc'",
].join('\n')
const out = path.resolve('.check-agent-kit.mjs')
await build({ stdin: { contents: entry, resolveDir: process.cwd(), loader: 'tsx' }, bundle: true, format: 'esm', platform: 'node', outfile: out, logLevel: 'silent', jsx: 'automatic', packages: 'external', loader: { '.json': 'json' }, define: { 'import.meta.glob': 'undefined' } })
globalThis.window ??= undefined
const m = await import(pathToFileURL(out).href)
rmSync(out, { force: true })

/* ob components: registered, configured, deterministic, animated */
for (const e of m.OBSIDIAN_ENTRIES) {
  ok(existsSync(`src/lab/components/${e.slug}.tsx`), `${e.slug} demo file`)
  ok(m.lab.some((l) => l.slug === e.slug), `${e.slug} in the lab registry`)
  ok(m.comps.findComponent(e.slug), `${e.slug} placeable`)
  const cfg = m.OBSIDIAN_CONFIGS[e.slug]
  ok(cfg && typeof m.ob[e.component] === 'function', `${e.slug} config + component`)
  const defaults = Object.fromEntries(Object.entries(cfg.controls).map(([k, c]) => [k, c.default]))
  const at = (ms, extra = {}) => m.renderToString(m.createElement(m.StageClock.Provider, { value: ms }, m.createElement(m.ob[e.component], { ...defaults, ...extra })))
  ok(at(1234) === at(1234), `${e.slug} same time → same frame`)
  const frames = new Set([0, 180, 400, 900, 1700, 2600].map((t) => at(t)))
  ok(frames.size > 1, `${e.slug} actually moves over time`)
}
ok(m.renderToString(m.createElement(m.StageClock.Provider, { value: 500 }, m.createElement(m.ob.FlipText, { text: 'Hi', fontFamily: 'Satoshi' }))).includes('Satoshi'), 'ob components take fontFamily directly')

/* motion-board set */
ok(m.OBSIDIAN_ENTRIES.filter((e) => e.slug.startsWith('mb-')).length >= 5, 'motion-board components registered')
const cy = (t) => m.ob.cycleAt(t)
ok(cy(0).p === 0 && cy(2.3).phase === 'hold' && cy(3).p === 1 && cy(7.5).phase === 'ret' && Math.abs(cy(8).p) < 1e-9, 'forward → hold → return cycle is pure and loops at 8 s')
ok(m.ob.cycleAt(20, 2.2, 4.4, 1.4, false).p === 1, 'no-loop holds the end state')
ok(m.comps.componentCatalogFor('show our growth chart', 18).map((c) => c.slug).includes('mb-chart-morph') && m.comps.componentCatalogFor('app demo walkthrough', 18).map((c) => c.slug).includes('mb-search-results'), 'intents surface motion-board pieces')

/* universal font prop */
const withFont = Object.entries(m.PROP_CONFIGS).filter(([, c]) => c.controls.fontFamily)
ok(withFont.length >= 90, `fontFamily on every DOM-text component (${withFont.length})`)
ok(!m.PROP_CONFIGS['fc-shader-water']?.controls.fontFamily, 'shaders (WebGL) get no font prop')
ok(m.comps.validateComponentProps('fc-blur-reveal', { fontFamily: 'Geist Variable', text: 'Ship it' }).fontFamily === 'Geist Variable', 'fontFamily accepted')
throws(() => m.comps.validateComponentProps('fc-blur-reveal', { fontFamily: "x}body{color:red" }), /font family/, 'CSS injection in fontFamily rejected')
ok(m.fontOverrideCss('s1', "x'}*{") === '', 'override refuses unsafe names')
const css = m.fontOverrideCss('s1', 'Clash Display')
ok(css.includes("'Clash Display'") && css.includes('[data-cu-font="s1"]') && css.includes(':not([style*="ono"] *)'), 'override scoped, keeps mono text mono')
ok(m.comps.componentPropsSummary('fc-blur-reveal').includes('fontFamily:font family'), 'agent sees fontFamily in props summary')

/* intent picks */
for (const intent of m.comps.INTENT_PICKS) for (const slug of intent.slugs) ok(m.comps.findComponent(slug), `intent ${intent.id}: ${slug} exists`)
const cat = (q, extra) => m.comps.componentCatalogFor(q, 18, extra).map((c) => c.slug)
ok(cat('make it look premium and cinematic').some((s) => s.startsWith('fc-shader') || s.includes('gradient')), 'premium → a shader/gradient background')
ok(cat('polish this').includes('fc-zoom-through-transition') && cat('polish this').some((s) => s.startsWith('fc-caption')), 'polish → transition + caption on offer')
ok(cat('animate it', 'Revenue grew 40% this year').includes('odometer'), 'edit text about numbers → stat components')
ok(cat('add a click effect').includes('ob-click-spark'), 'click → click spark')
ok(m.comps.componentCatalogFor('make it better').every((c) => c.slug && c.name) && m.comps.componentCatalogFor('add a background').find((c) => c.category === 'shaders')?.use?.includes('track 0'), 'catalogue lines carry placement guidance')
ok(cat('hook title launch').length <= 18, 'catalogue stays compact')

/* ops: setComponentProps, component fonts, smooth defaults */
const base = { ...m.docm.emptyStudioDoc(), trackCount: 3 }
const placed = m.ops.applyStudioEditPlan(base, m.ops.validateStudioEditPlan({ summary: 's', ops: [{ type: 'addComponent', slug: 'fc-shader-mesh-gradient', startSec: 0, durationSec: 5, track: 0 }] }, base).ops)
const shader = placed.clips.find((c) => c.component?.slug === 'fc-shader-mesh-gradient')
ok(shader && shader.track === 0, 'addComponent honours track 0 for backgrounds')
ok(!(shader.keyframes ?? []).some((k) => typeof k.y === 'number' && Math.abs(k.y - shader.y) > 0.001), 'shader default motion does not rise')
ok(m.ops.defaultComponentMotion('fc-caption-highlight').entrance === 'fade-in' && m.ops.defaultComponentMotion('toggle-switch').entrance === 'rise-in', 'default motion by category')
const title = placed.clips.length
const withTitle = m.ops.applyStudioEditPlan(placed, m.ops.validateStudioEditPlan({ summary: 's', ops: [{ type: 'addComponent', slug: 'fc-blur-reveal', startSec: 0.5, durationSec: 3, props: { text: 'Old' } }] }, placed).ops)
ok(withTitle.clips.length === title + 1, 'component added')
const comp = withTitle.clips.find((c) => c.component?.slug === 'fc-blur-reveal')
const plan = m.ops.validateStudioEditPlan({ summary: 's', ops: [{ type: 'setComponentProps', clipId: comp.id, props: { text: 'Launch day', color: '#c8f542', fontFamily: 'Geist Variable' } }] }, withTitle)
const edited = m.ops.applyStudioEditPlan(withTitle, plan.ops).clips.find((c) => c.id === comp.id)
ok(edited.component.props.text === 'Launch day' && edited.component.props.fontFamily === 'Geist Variable' && edited.component.status === 'pending', 'setComponentProps merges + re-records')
ok(edited.component.props.color === '#c8f542', 'colour set inside the component')
throws(() => m.ops.validateStudioEditPlan({ summary: 's', ops: [{ type: 'setComponentProps', clipId: comp.id, props: { fontFamily: 'Satoshi' } }] }, withTitle), /Fontshare/, 'fonts the user has not added are refused honestly')
throws(() => m.ops.validateStudioEditPlan({ summary: 's', ops: [{ type: 'setComponentProps', clipId: comp.id, props: { nope: 1 } }] }, withTitle), /no prop/, 'unknown prop refused with the allowed list')
const textDoc = m.ops.applyStudioEditPlan(base, m.ops.validateStudioEditPlan({ summary: 's', ops: [{ type: 'addText', text: 'Hello there', track: 1, startSec: 0, durationSec: 3 }] }, base).ops)
ok((textDoc.clips.find((c) => c.kind === 'text').keyframes ?? []).length >= 2, 'addText without motion eases on and off')

/* prompt */
const main = read('electron/main.cjs')
for (const s of ['setComponentProps', 'COMPONENT PLAYBOOK', 'SMOOTHNESS', 'TYPOGRAPHY & COLOUR', 'props.fontFamily', 'ob-marquee-band', '"track"?:number']) ok(main.includes(s), `prompt mentions ${s}`)
ok(main.includes('ADVANCED_VIDEO_PLAYBOOK_PROMPT') && main.includes('evaluateAutomationRender'), 'autonomous planner includes the advanced craft playbook and delivered-render QA')
const opusPlaybook = read('electron/opus-playbook.cjs')
ok(opusPlaybook.includes('not model training') && opusPlaybook.includes('shared timeline clock'), 'Opus guidance stays deterministic and does not claim model retraining')
ok(opusPlaybook.includes('Never fabricate testimonials') && opusPlaybook.includes('rear-camera panel fixed'), 'Opus, dashi-motion, and foldable-promotion guidance preserve the agent rules')
ok(read('src/screens/Autonomous.tsx').includes('Render QA:'), 'autonomous UI exposes mechanical render QA')
ok(read('src/lib/studio/phone.ts').includes('drawDuoPhone') && read('src/lib/studio/resourceApply.ts').includes("nativeAction === 'phoneDesign'"), 'iPhone Duo is a native editable Studio action')
ok(read('src/screens/Studio.tsx').includes('componentProps: clip.component.props'), 'agent sees current component props')

console.log(`check-agent-kit passed (${n} assertions)`)
