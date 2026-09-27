#!/usr/bin/env node
/** Smart component insertion: when / which / how / where, deterministic, one op path. */
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { rm } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const tmp = path.join(root, '.component-director-check.mjs')
await build({ bundle: true, outfile: tmp, format: 'esm', platform: 'node', logLevel: 'error', jsx: 'automatic', loader: { '.tsx': 'tsx', '.css': 'empty', '.svg': 'dataurl', '.png': 'dataurl', '.jpg': 'dataurl' },
  stdin: { contents: "export * from './src/lib/studio/componentDirector'; export { applyStudioEditPlan, validateStudioEditPlan } from './src/lib/studio/editOps'; export { suggestEdits } from './src/lib/studio/suggestions'; export { findComponent } from './src/lib/studio/components'", resolveDir: root, loader: 'ts' } })
const m = await import(`${pathToFileURL(tmp).href}?t=${Date.now()}`)
await rm(tmp, { force: true })
let n = 0
const ok = (c, msg) => { assert.ok(c, msg); n += 1 }

const text = (id, t, startSec, durationSec, y = 0.3) => ({ id, kind: 'text', text: t, track: 1, startSec, durationSec, y, x: 0.5 })
const video = { id: 'v', kind: 'video', mediaId: 'm', track: 0, startSec: 0, durationSec: 40, trimInSec: 0, speed: 1, volume: 1 }
const doc = { aspect: '16:9', trackCount: 2, clips: [video,
  text('a', 'Meet Nova, your money app', 0, 3),
  text('b', 'Trusted by 10,000 users', 4, 3.5, 0.75),
  text('c', 'Get notified before every bill', 9, 3),
  text('d', 'The weather is nice', 14, 3),
  text('e', 'Only ₹499/month', 19, 3),
  text('f', 'Sign up free today', 30, 4),
  text('g', 'Sign up free', 33, 3),
] }
const moments = m.directComponents(doc)
console.log(moments.map((x) => `${x.startSec}s ${x.cue} → ${x.slug} [${x.motion.entrance}/${x.motion.emphasis ?? '-'}/${x.motion.exit}] y=${x.y} interact=${x.interact}`).join('\n'))
ok(moments.length >= 3 && moments.length <= Math.floor(40 / 7), 'density budget: at most one per ~7 s')
ok(!moments.some((x) => x.lineId === 'a' || x.lineId === 'd'), 'lines with nothing to show get nothing')
const byLine = Object.fromEntries(moments.map((x) => [x.lineId, x]))
ok(byLine.b?.cue === 'stat' && m.findComponent(byLine.b.slug), 'a number gets a real data component')
ok(byLine.b.y < 0.5, 'line low in frame → component above it')
ok(byLine.c?.cue === 'notify' && /slide-in/.test(byLine.c.motion.entrance), 'notification slides in from the side')
ok(byLine.e?.cue === 'price', 'price gets a pricing component')
ok(byLine.f?.cue === 'cta' && byLine.f.interact && byLine.f.motion.emphasis && byLine.f.motion.emphasis !== 'none', 'CTA is pressed by the recorder and pulses')
ok(!byLine.g, 'the same CTA idea 3 s later is not repeated')
ok(new Set(moments.map((x) => x.slug)).size === moments.length, 'no component reused in one edit')
for (const x of moments) {
  const line = doc.clips.find((c) => c.id === x.lineId)
  ok(x.startSec > line.startSec && x.startSec < line.startSec + line.durationSec, `${x.lineId}: lands after the words start`)
}
for (let i = 1; i < moments.length; i += 1) ok(moments[i].startSec >= moments[i - 1].startSec + moments[i - 1].durationSec + 0.75, 'components never overlap')
ok(JSON.stringify(m.directComponents(doc)) === JSON.stringify(moments), 'deterministic')

// Style changes motion, not choice.
const bold = { ...doc, clips: doc.clips.map((c) => (c.id === 'a' ? { ...c, text: 'WOW! 50% OFF NOW!' } : c)) }
const boldCta = m.directComponents(bold).find((x) => x.cue === 'cta')
ok(boldCta && boldCta.motion.intensity > byLine.f.motion.intensity, 'bold-social edit → punchier motion')

// Existing components are respected.
const ops = m.componentOps(moments)
const applied = m.applyStudioEditPlan(doc, ops)
const added = applied.clips.filter((c) => c.component)
ok(added.length === moments.length && added.every((c) => c.component.status === 'pending' && c.keyframes?.length), 'ops add pending components with choreographed keyframes (one recorder path)')
ok(m.directComponents(applied).length === 0, 'running again on the result adds nothing')
const validated = m.validateStudioEditPlan({ summary: 's', ops }, doc)
ok(validated.ops.length === ops.length, 'the plan passes the agent validator')
ok(m.suggestEdits(doc).some((s) => s.id === 'smart-components'), 'surfaced as an auto-edit suggestion (preview → accept)')
ok(m.directComponents({ ...doc, clips: [video] }).length === 0, 'no text → no components')
console.log(`component director check passed — ${n} assertions`)
