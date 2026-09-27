#!/usr/bin/env node
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { readFile, rm } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const tmp = path.join(root, '.agent-edits-check.mjs')
await build({ bundle: true, outfile: tmp, format: 'esm', platform: 'node', logLevel: 'warning', stdin: {
  contents: `
    export { validateStudioEditPlan, applyStudioEditPlan, localStudioEditPlan } from './src/lib/studio/editOps'
    export { emptyStudioDoc, defaultTextClip } from './src/lib/studio/doc'
    export { COMPONENTS, componentCatalogFor, componentFromInstruction, fitComponentScale, isPendingComponent } from './src/lib/studio/components'
  `,
  resolveDir: root, sourcefile: 'check-agent-edits.ts', loader: 'ts',
} })
const mod = await import(`${pathToFileURL(tmp).href}?t=${Date.now()}`)
await rm(tmp, { force: true })

const title = { ...mod.defaultTextClip(0, 1), id: 'title', text: 'Launch now', name: 'Title' }
const doc = { ...mod.emptyStudioDoc(), clips: [title] }
const before = JSON.stringify(doc)
const raw = { summary: 'Professional title motion', source: 'live', ops: [
  { type: 'patchClip', clipId: 'title', patch: { fontFamily: 'Playfair Display Variable', color: '#C8F542', anim: 'pop' } },
  { type: 'setKeyframe', clipId: 'title', at: 0, values: { y: 0.7, opacity: 0 } },
  { type: 'setKeyframe', clipId: 'title', at: 1, values: { y: 0.45, opacity: 1 }, ease: 'ease-out' },
  { type: 'moveClip', clipId: 'title', track: 2 },
] }
const plan = mod.validateStudioEditPlan(raw, doc)
const next = mod.applyStudioEditPlan(doc, plan.ops)
assert.equal(JSON.stringify(doc), before, 'preview/apply engine must not mutate the original document')
assert.equal(next.clips[0].fontFamily, 'Playfair Display Variable')
assert.equal(next.clips[0].color, '#C8F542')
assert.equal(next.clips[0].track, 2)
assert.equal(next.clips[0].keyframes.length, 2)
assert.throws(() => mod.validateStudioEditPlan({ ops: [{ type: 'patchClip', clipId: 'title', patch: { arbitraryCode: 'no' } }] }, doc), /not editable/)
assert.throws(() => mod.validateStudioEditPlan({ ops: [{ type: 'deleteClip', clipId: 'invented' }] }, doc), /unknown clip/)
assert.throws(() => mod.validateStudioEditPlan({ ops: [{ type: 'patchClip', clipId: 'title', patch: { highlightWord: 'invented' } }] }, doc), /not present/, 'agent may only highlight words that really exist')
const local = mod.localStudioEditPlan('move it up and use Playfair in lime', doc, 'title')
const localNext = mod.applyStudioEditPlan(doc, local.ops)
assert.ok(localNext.clips[0].y < title.y)
assert.equal(localNext.clips[0].fontFamily, 'Playfair Display Variable')
assert.equal(localNext.clips[0].color, '#C8F542')
const highlight = mod.localStudioEditPlan('highlight Launch and use word reveal', doc, 'title')
const highlightNext = mod.applyStudioEditPlan(doc, highlight.ops)
assert.equal(highlightNext.clips[0].highlightWord, 'Launch')
assert.equal(highlightNext.clips[0].anim, 'word-reveal')
const keyed = mod.localStudioEditPlan('add two keyframes with subtle motion', doc, 'title')
assert.equal(keyed.ops.filter((op) => op.type === 'setKeyframe').length, 2, 'local agent must create real editable keyframes')

const [main, preload, studio] = await Promise.all([
  readFile(path.join(root, 'electron/main.cjs'), 'utf8'),
  readFile(path.join(root, 'electron/preload.cjs'), 'utf8'),
  readFile(path.join(root, 'src/screens/Studio.tsx'), 'utf8'),
])
assert.match(main, /ipcMain\.handle\('studio:planEdits'/, 'desktop must expose AI edit planning')
assert.match(main, /Return STRICT JSON only[\s\S]*?Never invent clip IDs/, 'model prompt must enforce a closed JSON contract')
assert.match(preload, /'studio:planEdits'/, 'edit planner IPC must be allowlisted')
assert.match(studio, /preview only until accepted/, 'Studio must show a non-destructive preview')
assert.match(studio, /Accept all/, 'agent batch must require explicit acceptance')
assert.match(studio, />\s*Auto polish\s*</, 'Studio must offer content-directed automatic editing')
assert.match(studio, />\s*Auto effects\s*</, 'Studio must offer an automatic native effects pass')
assert.match(studio, /motionReferences:[\s\S]*reactBits[\s\S]*skiperUi[\s\S]*remotionPackages/, 'agent context must expose the attributed motion libraries')
assert.match(main, /translate every idea into only the native operations/, 'third-party references must resolve to safe editable operations')
{
  // The deadline may be a literal or a named constant, but it must exist and
  // stay short: the renderer has a deterministic local plan to fall back to.
  const call = main.match(/withTimeout\(generateStudioEditPlan\([^)]*\)[^,]*,\s*([A-Z_0-9]+|[\d_]+)/)
  assert.ok(call, 'Studio planning must fail over quickly instead of hanging forever')
  const raw = /^[\d_]+$/.test(call[1]) ? call[1] : main.match(new RegExp(`const ${call[1]} = ([\\d_]+)`))?.[1]
  const ms = Number(String(raw || '').replace(/_/g, ''))
  assert.ok(ms > 0 && ms <= 30_000, `Studio planning deadline must be at most 30s (got ${ms}ms)`)
}
assert.match(studio, /const relevantNames[\s\S]*slice\(0, limit\)/, 'model context must rank and cap resource names')
assert.match(studio, /Reading timeline and selected clips[\s\S]*Validating a safe edit plan/, 'Auto edit must show meaningful planning progress')
const autoLocal = mod.localStudioEditPlan('Analyze the timeline and make an automatic edit', doc, null)
assert.equal(autoLocal.ops[0].type, 'applyStylePreset', 'Auto edit must have a deterministic provider-free fallback')
assert.ok(autoLocal.ops.length > 1, 'local Auto edit must propose real per-clip effects, not only a generic preset')
const autoNext = mod.applyStudioEditPlan(doc, autoLocal.ops)
assert.equal(autoNext.clips[0].highlightWord, 'Launch', 'local Auto edit must highlight a meaningful existing keyword')
assert.notEqual(autoNext.clips[0].anim, 'none', 'local Auto edit must automatically apply native text motion')
assert.match(studio, /live response was unsafe or incomplete[\s\S]*?rebuilt it locally/, 'malformed provider output must visibly fail over to a local plan')

// UI components: the agent can place any of them; they arrive pending and are recorded live.
const comp = mod.COMPONENTS.find((entry) => entry.name.length > 5 && !/\b(text|title|fade|glass|pop)\b/i.test(entry.name))
assert.ok(mod.COMPONENTS.length >= 150, 'the whole component library must be available to the agent')
const compPlan = mod.validateStudioEditPlan({ ops: [{ type: 'addComponent', slug: comp.slug, startSec: 0.5, durationSec: 4 }] }, doc)
const compNext = mod.applyStudioEditPlan(doc, compPlan.ops)
const placed = compNext.clips.find((c) => c.component?.slug === comp.slug)
assert.ok(placed && placed.kind === 'overlay' && placed.component.status === 'pending', 'addComponent must place a pending component clip for the recorder')
assert.ok(mod.isPendingComponent(placed), 'pending component clips must be picked up by the recorder')
assert.ok(placed.keyframes?.length >= 2, 'agent-placed components must get purposeful entrance/exit motion')
assert.equal(new Set(compNext.clips.map((c) => c.track)).size >= 1, true)
assert.throws(() => mod.validateStudioEditPlan({ ops: [{ type: 'addComponent', slug: 'invented-widget', startSec: 0 }] }, doc), /component/i, 'agent may only place components that exist')
const byName = mod.localStudioEditPlan(`add the ${comp.name} at the start`, doc, null)
assert.ok(byName.ops.some((op) => op.type === 'addComponent' && op.slug === comp.slug), 'local planner must place a component named in the prompt')
assert.ok(mod.componentCatalogFor('add a pricing card', 14).length > 0, 'the live agent must be shown a component catalog')
const fitted = mod.fitComponentScale(640, 400, 2, '16:9')
assert.ok(fitted > 0.15 && fitted <= 1, 'recorded components must be sized to read well in the frame')

console.log('agent edit check passed — strict allowlist, local/live planning, preview and atomic apply are wired')
