#!/usr/bin/env node
/** Automation reaches every registered resource; motion follows the beat; scenes are layered; primitives + UI libraries are live. */
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(import.meta.url)
const { automationResourceContext, classifyBeat } = require('../electron/resource-context.cjs')
let n = 0
const ok = (c, msg) => { assert.ok(c, msg); n += 1 }
const dir = path.join(root, 'resources/packs')
const index = JSON.parse(readFileSync(path.join(dir, 'index.json'), 'utf8'))

const rundown = { style: 'premium saas launch', scenes: [
  { type: 'hook', copy: 'Editing takes forever', motion: 'dramatic' },
  { type: 'feature', copy: 'Auto-edit cuts on the beat' },
  { type: 'stat', copy: '10x faster edits for 5,000 creators' },
  { type: 'testimonial', copy: 'Loved by teams' },
  { type: 'gallery', copy: 'Every product shot, one infinite scroll', motion: 'scroll' },
  { type: 'cta', copy: 'Start free today' },
] }
const c = automationResourceContext('Launch video for Cupric AI editor', rundown, dir)

// 1. Full surface.
const expected = index.packs.reduce((sum, p) => sum + JSON.parse(readFileSync(path.join(dir, `${p.id}.json`), 'utf8')).items.filter((i) => i.kind !== 'font' && i.kind !== 'voice').length, 0)
ok(c.searched.total === expected && expected > 1600, `searches every non-font resource (${c.searched.total}/${expected})`)
for (const id of ['components', 'panelui', 'react-bits', 'skiper-ui', 'external-ui', 'ui-libraries', 'backgrounds', 'saas-video', 'templates', 'sources']) ok(c.searched.packs[id] > 0, `pack ${id} is in the selection pass`)
ok(c.searched.packs.components >= 192, 'all UI Lab components (incl. new primitives) searched')
ok(c.prompt.startsWith(`Searched ${expected} registered resources across ${index.packs.length} packs`), 'prompt states the searched surface')

// 2. Beat → motion.
ok(c.scenes.map((s) => s.beat).join() === 'opener,feature,proof,social-proof,gallery,cta', `beats classified (${c.scenes.map((s) => s.beat)})`)
const by = Object.fromEntries(c.scenes.map((s) => [s.beat, s]))
ok(by.opener.layers.background?.id === 'mesh-gradient', 'opener: drifting mesh gradient behind the headline')
ok(by.proof.layers.main?.id === 'stat-counter' && /count up/.test(by.proof.motion), 'proof: build-in + number count-up')
ok(/marquee|testimonial/.test(by['social-proof'].layers.main?.id) && /marquee/.test(by['social-proof'].motion), 'social proof: marquee / staggered cards, not a static drop')
ok(by.gallery.layers.main?.id === 'sora-ui-infinite-scrolling-images' && /native scroll-driven/.test(by.gallery.motion), 'gallery: Soralabs infinite scroll with its native motion')
ok(by.cta.layers.main?.id === 'magnetic-button' && /spotlight/.test(by.cta.layers.accent?.id ?? '') , 'CTA: magnetic button + cursor spotlight')
ok(by.feature.layers.main?.id === 'bento-grid', 'feature: bento build-in')
ok(!c.scenes.slice(1).some((s) => /mesh|particle|aurora|liquid/.test(s.layers.background?.id ?? '')), 'hero backgrounds reserved for the opener')

// 3. Layering.
ok(by.cta.layers.background && by.cta.layers.main && by.cta.layers.accent, 'CTA scene composes three layers')
ok(c.scenes.filter((s) => Object.keys(s.layers).length >= 2).length >= 4, 'most scenes are layered, not one resource each')
const ids = c.scenes.flatMap((s) => Object.values(s.layers).map((v) => v.id))
ok(new Set(ids).size === ids.length, 'no resource reused across scenes')
ok(JSON.stringify(automationResourceContext('Launch video for Cupric AI editor', rundown, dir).scenes.map((s) => Object.values(s.layers).map((v) => v.id))) === JSON.stringify(c.scenes.map((s) => Object.values(s.layers).map((v) => v.id))), 'deterministic')

// Classifier edge cases.
ok(classifyBeat({ copy: 'Download now' }, 2, 5) === 'cta' && classifyBeat({ copy: 'Our logo' }, 4, 5) === 'social-proof' && classifyBeat({ copy: 'Thanks' }, 4, 5) === 'close', 'classifier')

// 4. Primitives are live Lab components (recordable) and indexed.
const reg = readFileSync(path.join(root, 'src/lab/registry.ts'), 'utf8')
for (const slug of ['scroll-reveal', 'magnetic-button', 'spotlight-card', 'mesh-gradient', 'marquee', 'bento-grid', 'stat-counter', 'tilt-card']) {
  ok(reg.includes(`slug: "${slug}"`) && existsSync(path.join(root, `src/lab/components/${slug}.tsx`)), `primitive ${slug} is a live Lab component`)
}
for (const slug of ['mesh-gradient', 'bento-grid']) ok(/useDrivenSeconds/.test(readFileSync(path.join(root, `src/lab/components/${slug}.tsx`), 'utf8')), `${slug} follows the recorder clock (deterministic)`)

// 5. Main process uses it.
const main = readFileSync(path.join(root, 'electron/main.cjs'), 'utf8')
ok(main.includes("require('./resource-context.cjs')") && main.includes('scenePlan:'), 'main process uses the full-surface selector and records the scene plan')
console.log(`resource reach check passed — ${n} assertions, ${c.searched.total} resources searched`)
