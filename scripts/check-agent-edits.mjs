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
const local = mod.localStudioEditPlan('move it up and use Playfair in lime', doc, 'title')
const localNext = mod.applyStudioEditPlan(doc, local.ops)
assert.ok(localNext.clips[0].y < title.y)
assert.equal(localNext.clips[0].fontFamily, 'Playfair Display Variable')
assert.equal(localNext.clips[0].color, '#C8F542')

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
assert.match(studio, />\s*Auto edit\s*</, 'Studio must offer content-directed automatic editing')
assert.match(studio, /motionReferences:[\s\S]*reactBits[\s\S]*skiperUi[\s\S]*remotionPackages/, 'agent context must expose the attributed motion libraries')
assert.match(main, /translate every idea into only the native operations/, 'third-party references must resolve to safe editable operations')
assert.match(main, /withTimeout\(generateStudioEditPlan[\s\S]*20_000/, 'Studio planning must fail over instead of hanging forever')
assert.match(studio, /const relevantNames[\s\S]*slice\(0, limit\)/, 'model context must rank and cap resource names')
const autoLocal = mod.localStudioEditPlan('Analyze the timeline and make an automatic edit', doc, null)
assert.equal(autoLocal.ops[0].type, 'applyStylePreset', 'Auto edit must have a deterministic provider-free fallback')

console.log('agent edit check passed — strict allowlist, local/live planning, preview and atomic apply are wired')
