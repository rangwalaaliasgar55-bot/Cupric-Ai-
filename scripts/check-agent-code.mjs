#!/usr/bin/env node
/**
 * JOB 4 — agent-written animation validator (pure Node, no DOM).
 * Bundles src/lib/studio/agentCode.ts and proves every rule: accepts the
 * project-original few-shots, rejects each forbidden pattern quoting the rule.
 */
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { readFile } from 'node:fs/promises'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const out = await build({ write: false, bundle: true, format: 'esm', platform: 'node', stdin: { contents: "export * from './src/lib/studio/agentCode'; export { AGENT_ANIMATION_FEWSHOTS } from './src/lib/studio/agentCodeExamples'; export { validateStudioEditPlan, applyStudioEditPlan } from './src/lib/studio/editOps'; export { emptyStudioDoc } from './src/lib/studio/doc'", resolveDir: root, loader: 'ts' } })
const m = await import('data:text/javascript;base64,' + Buffer.from(out.outputFiles[0].text).toString('base64'))
let n = 0
const ok = (cond, msg) => { assert.ok(cond, msg); n += 1 }

// Few-shots pass every rule.
for (const shot of m.AGENT_ANIMATION_FEWSHOTS) {
  const r = m.validateAgentCode(shot.answer.code, shot.answer.props)
  ok(r.ok, `few-shot “${shot.request}” validates: ${r.ok ? '' : m.describeRejections(r.rejections)}`)
}
const good = m.AGENT_ANIMATION_FEWSHOTS[1].answer
const rejectsWith = (code, rule, label) => {
  const r = m.validateAgentCode(code, { text: 'X' })
  ok(!r.ok, `${label}: rejected`)
  const hit = r.rejections.find((x) => x.rule === rule)
  ok(hit, `${label}: rule “${rule}” (got ${r.rejections.map((x) => x.rule).join(',')})`)
  ok(hit.quote === Object.values(m.AGENT_CODE_RULES).find((x) => x.id === rule).text, `${label}: rejection quotes the rule verbatim`)
  ok(m.describeRejections(r.rejections).includes(hit.quote), `${label}: message includes the quote`)
}
const wrap = (body) => `export default function Bad({ t, seed, reducedMotion, props, h, color }) {\n${body}\n}`
rejectsWith(wrap("const x = Date.now(); return h('div', { style: { opacity: reducedMotion ? t : t } })"), 'only-t', 'use Date.now')
rejectsWith(wrap("return h('div', { style: { opacity: Math.random() + (reducedMotion ? 0 : t) } })"), 'seeded', 'Math.random')
rejectsWith(wrap("fetch('https://x'); return h('div', { style: { opacity: reducedMotion ? 1 : t } })"), 'no-network', 'fetch')
rejectsWith(wrap("document.title = 'x'; return h('div', { style: { opacity: reducedMotion ? 1 : t } })"), 'no-dom', 'document')
rejectsWith("import React from 'react'\n" + good.code, 'no-imports', 'import')
rejectsWith(wrap("return h('div', { style: { color: '#ff0000', opacity: reducedMotion ? 1 : t } })"), 'no-raw-hex', 'raw hex')
rejectsWith(wrap("return h('div', { style: { color: 'rgb(255,0,0)', opacity: reducedMotion ? 1 : t } })"), 'no-raw-hex', 'rgb()')
rejectsWith(wrap("return h('div', { style: { opacity: t } })"), 'reduced-motion', 'no reduced-motion path')
rejectsWith(wrap("return h('div', { style: { opacity: t, transform: 'translateX(' + (t * 40) + 'px)' }, 'data-rm': reducedMotion ? 1 : 0 })").replace(", 'data-rm': reducedMotion ? 1 : 0", '').replace("{ opacity: t,", "{ opacity: reducedMotion ? t : t,"), 'reduced-motion', 'transform moves while reduced')
rejectsWith(good.code + '\nexport function Extra() {}', 'single', 'two exports')
rejectsWith(wrap("while (true) {} return h('div', {})") + '/* reducedMotion */', 'bounded-loops', 'while loop')
rejectsWith(wrap("return h('script', { style: { opacity: reducedMotion ? 1 : t } })"), 'allowlisted-tree', 'script tag')
rejectsWith(wrap("return h('div', { onClick: 1, style: { opacity: reducedMotion ? 1 : t } })"), 'allowlisted-tree', 'event handler attr')
rejectsWith(wrap("return h('div', { style: { backgroundImage: 'url(x)', opacity: reducedMotion ? 1 : t } })"), 'allowlisted-tree', 'url() style')
rejectsWith(wrap("const k = 'constr' + 'uctor'; const F = h[k]; return F('return 1')() ? h('div', { style: { opacity: reducedMotion ? 1 : t } }) : null"), 'must-run', 'constructor escape neutralised')
rejectsWith(wrap("const s = {}; s.n = (s.n || 0); globalCounter = 1; return h('div', { style: { opacity: reducedMotion ? 1 : t } })"), 'must-run', 'implicit global in strict mode')
rejectsWith('x'.repeat(16 * 1024), 'size', '> 15 KB')
// Runaway-code guards: nothing can hang the renderer.
rejectsWith(wrap("let s = 0; for (let i = 0; i >= 0; i++) { s += i } return h('div', { style: { opacity: reducedMotion ? 1 : t } })"), 'bounded-loops', 'endless arithmetic for-loop (guard trips)')
rejectsWith(wrap("let s = 0; for (let i = 0; i >= 0; i++) s += i; return h('div', { style: { opacity: reducedMotion ? 1 : t } })"), 'bounded-loops', 'brace-less for-loop')
rejectsWith(wrap("const f = (n) => f(n + 1); f(0); return h('div', { style: { opacity: reducedMotion ? 1 : t } })"), 'bounded-loops', 'infinite recursion (stack guard)')
rejectsWith(wrap("const a = Array.from({ length: 1e9 }); return h('div', { style: { opacity: reducedMotion ? 1 : t } })"), 'bounded-loops', 'huge Array.from')
rejectsWith(wrap("const a = Array(99999999); return h('div', { style: { opacity: reducedMotion ? 1 : t } })"), 'bounded-loops', 'Array(n)')
rejectsWith(wrap("const s = 'x'.repeat(props.n); return h('div', { style: { opacity: reducedMotion ? 1 : t } })"), 'bounded-loops', 'computed repeat count')
rejectsWith(wrap("__tick = () => {}; return h('div', { style: { opacity: reducedMotion ? 1 : t } })"), 'no-dom', 'overriding the loop guard')
{
  const loopy = wrap("const bars = []; for (let i = 0; i < 12; i++) { bars.push(h('div', { key: i, style: { opacity: reducedMotion ? t : t * (i / 12) } })) } const pts = Array.from({ length: 40 }, (_, k) => k); return h('div', { style: { opacity: reducedMotion ? 1 : t } }, bars, pts.length, ' // for (not a loop)')")
  const r = m.validateAgentCode(loopy, {})
  ok(r.ok, 'bounded braced loops + small Array.from + loop text in strings are accepted' + (r.ok ? '' : ': ' + m.describeRejections(r.rejections)))
  ok(m.instrumentLoops('for (let i = 0; i < Math.min(3, 4); i++) { x() }').code.includes('{ __tick();'), 'guard inserted after nested-paren headers')
}
{
  // Double-render identity: hidden state via a closure over props object mutation.
  const code = wrap("props.n = 1; return h('div', { style: { opacity: reducedMotion ? 1 : t } })")
  const r = m.validateAgentCode(code, { text: 'X' })
  ok(!r.ok, 'mutating frozen props is rejected (cannot hide state)')
}
// The mulberry32 is deterministic; ease table exists; slug is stable.
ok(m.mulberry32(7)() === m.mulberry32(7)(), 'mulberry32 deterministic')
ok(m.agentSlug('Glitch RGB Title') === 'gen-glitch-rgb-title', 'slug')

// addAnimation op: validated in the edit plan, one clip, user seconds, agent-generated.
const doc = m.emptyStudioDoc ? m.emptyStudioDoc() : { clips: [], shelf: [], trackCount: 3, aspect: '9:16', fps: 30 }
const plan = m.validateStudioEditPlan({ summary: 'glitch', ops: [{ type: 'addAnimation', startSec: 0, ...good, durationSec: 2 }] }, doc)
ok(plan.ops[0].type === 'addAnimation' && plan.ops[0].durationSec === 2, 'addAnimation validates with the user seconds')
const next = m.applyStudioEditPlan(doc, plan.ops)
const clip = next.clips.at(-1)
ok(clip.kind === 'overlay' && clip.component.slug === 'gen-glitch-rgb-title' && clip.component.recordSec === 2 && clip.durationSec === 2, 'one pending 2s component clip')
ok(clip.component.generated?.source === 'agent-generated' && clip.component.generated.code === good.code, 'code travels on the clip (undo + re-record)')
ok(next.clips.length === doc.clips.length + 1, 'exactly one clip added (one undo step)')
let threw = ''
try { m.validateStudioEditPlan({ summary: 'bad', ops: [{ type: 'addAnimation', startSec: 0, ...good, code: good.code.replace('mulberry32(seed + Math.floor(t * 24))', 'Date.now()') }] }, doc) } catch (e) { threw = e.message }
ok(/rule “only-t”: Motion must be a pure function of t/.test(threw), '“use Date.now” is rejected quoting the rule')

// Wiring.
const [ops, main, host, preload] = await Promise.all(['src/lib/studio/editOps.ts', 'electron/main.cjs', 'src/screens/studio/ComponentRecorderHost.tsx', 'electron/preload.cjs'].map((f) => readFile(resolve(root, f), 'utf8')))
ok(/type: 'addAnimation'/.test(ops), 'editOps knows addAnimation')
ok(/agent:generateAnimation/.test(main) && /agent:generateAnimation/.test(preload), 'codegen IPC is allowlisted')
ok(/AGENT_ANIMATION_FEWSHOTS|fewShots/.test(main), 'codegen prompt uses few-shots')
ok(/GeneratedFrame/.test(host), 'recorder records generated components through the same pipeline')
console.log(`agent code check passed — ${n} assertions (rules quoted, sandbox, identity, reduced motion, addAnimation op)`)
