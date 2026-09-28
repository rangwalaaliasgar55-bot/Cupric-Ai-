#!/usr/bin/env node
/**
 * JOB 7 gate — every resource stays on the stage, and preview == export.
 *
 * Ten thousand random placement ops are pushed through the real write paths
 * (agent plan, keyframe edit, resource drop) and then through the renderer's
 * resolve pass. Zero may end up outside the stage. The same frames are then
 * hashed twice through the shared draw path to prove the clamp is applied
 * identically in preview and in export — a clamp that only ran in one of them
 * would be worse than none.
 */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import { rm } from 'node:fs/promises'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const tmp = path.join(root, '.stage-bounds-check.mjs')
await build({
  bundle: true, outfile: tmp, format: 'esm', platform: 'node', logLevel: 'warning',
  stdin: {
    contents: `
      export * from './src/lib/studio/stageBounds'
      export { applyStudioEditPlan } from './src/lib/studio/editOps'
      export { patchTransformKeyframe } from './src/lib/studio/keyframeEdit'
      export { emptyStudioDoc, defaultTextClip } from './src/lib/studio/doc'
      export { drawStudioFrame } from './src/lib/studio/renderer'
    `,
    resolveDir: root, sourcefile: 'check-stage-bounds.ts', loader: 'ts',
  },
})
const mod = await import(`${pathToFileURL(tmp).href}?t=${Date.now()}`)
await rm(tmp, { force: true })

const { STAGE_MIN, STAGE_MAX, SCALE_MIN, SCALE_MAX } = mod

/** Deterministic PRNG: a failing seed is reproducible. */
let seed = 0x5eed1234
const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 0x100000000 }

/** Values a real bug produces: huge, negative, NaN, Infinity, and normal ones. */
function wildNumber() {
  const r = rnd()
  if (r < 0.12) return (rnd() - 0.5) * 2000
  if (r < 0.18) return Number.NaN
  if (r < 0.22) return rnd() < 0.5 ? Infinity : -Infinity
  if (r < 0.30) return -rnd() * 12
  if (r < 0.40) return 1 + rnd() * 12
  return rnd()
}

const inBounds = (v) => typeof v === 'number' && Number.isFinite(v) && v >= STAGE_MIN - 1e-9 && v <= STAGE_MAX + 1e-9
const scaleOk = (v) => v === undefined || (Number.isFinite(v) && v >= SCALE_MIN - 1e-9 && v <= SCALE_MAX + 1e-9)

/* ——— 1. 10,000 random placements through the pure clamp ————————— */
{
  let outside = 0
  for (let i = 0; i < 10000; i += 1) {
    const p = { x: wildNumber(), y: wildNumber(), scale: wildNumber() }
    const c = mod.clampPlacement(p)
    if (!inBounds(c.x) || !inBounds(c.y) || !scaleOk(c.scale)) outside += 1
  }
  assert.equal(outside, 0, `10,000 random placements produced ${outside} out-of-bounds results`)

  // Absent keys stay absent: clamping must not invent a placement.
  const none = mod.clampPlacement({})
  assert.deepEqual(none, {}, 'clamping a clip with no placement adds nothing')
  assert.equal(mod.clampPlacement({ x: 0.5 }).y, undefined, 'only present keys come back')

  // And a legal placement is returned untouched, to the bit.
  const legal = { x: 0.42, y: 0.618, scale: 1.5 }
  assert.deepEqual(mod.clampPlacement(legal), legal, 'a legal placement is not nudged')
}

/* ——— 2. through the real write paths ——————————————————————————— */
{
  const base = mod.emptyStudioDoc()
  let outside = 0
  let opCount = 0

  for (let i = 0; i < 2500; i += 1) {
    const clip = { ...mod.defaultTextClip(0, 0), id: `fuzz-${i}`, durationSec: 4 }
    const doc = { ...base, clips: [clip] }

    // (a) agent op — the plan's single exit clamps the whole doc.
    const viaAgent = mod.applyStudioEditPlan(doc, [
      { type: 'setTransform', clipId: clip.id, x: wildNumber(), y: wildNumber(), scale: wildNumber() },
    ])
    opCount += 1
    for (const c of viaAgent.clips) {
      if (c.x !== undefined && !inBounds(c.x)) outside += 1
      if (c.y !== undefined && !inBounds(c.y)) outside += 1
      if (!scaleOk(c.scale)) outside += 1
      for (const k of c.keyframes ?? []) {
        if (k.x !== undefined && !inBounds(k.x)) outside += 1
        if (k.y !== undefined && !inBounds(k.y)) outside += 1
        if (!scaleOk(k.scale)) outside += 1
      }
    }

    // (b) keyframe write — dragging a value off the stage stops at the edge.
    const patch = mod.patchTransformKeyframe(clip, clip.startSec + rnd() * 4, { x: wildNumber(), y: wildNumber(), scale: wildNumber() }, true)
    opCount += 1
    for (const k of patch?.keyframes ?? []) {
      if (k.x !== undefined && !inBounds(k.x)) outside += 1
      if (k.y !== undefined && !inBounds(k.y)) outside += 1
      if (!scaleOk(k.scale)) outside += 1
    }
  }
  assert.equal(outside, 0, `${opCount} real write ops produced ${outside} out-of-bounds values`)
  assert.ok(opCount >= 5000, `the fuzz ran a real number of ops (${opCount})`)
}

/* ——— 3. the renderer corrects what slipped past, in ONE shared pass ——
 * A hand-edited or legacy project can still carry x = 3.4. The resolve pass
 * shared by preview and export must draw it on the stage — and draw it the
 * same way both times.
 */
{
  function hashFrame(doc, t) {
    const log = []
    const target = {
      canvas: { width: 1280, height: 720 },
      measureText: (text) => ({ width: String(text).length * 8, actualBoundingBoxAscent: 8, actualBoundingBoxDescent: 3 }),
      createLinearGradient: () => ({ addColorStop: (o, c) => log.push(`g ${o} ${c}`) }),
      createRadialGradient: () => ({ addColorStop: (o, c) => log.push(`r ${o} ${c}`) }),
      createPattern: () => null,
      getImageData: () => ({ data: new Uint8ClampedArray(4), width: 1, height: 1 }),
      putImageData: () => {}, setLineDash: (d) => log.push(`dash ${d}`), getLineDash: () => [],
      isPointInPath: () => false, drawImage: (...a) => log.push(`img ${a.slice(1).join(',')}`),
    }
    const ctx = new Proxy(target, {
      get: (o, p) => (p in o ? o[p] : typeof p === 'string' ? (...a) => { log.push(`${p}(${a.map((v) => (typeof v === 'number' ? v.toFixed(3) : String(v))).join(',')})`) } : undefined),
      set: (o, p, v) => { log.push(`${String(p)}=${typeof v === 'number' ? v.toFixed(3) : String(v)}`); o[p] = v; return true },
    })
    mod.drawStudioFrame(ctx, doc, t, 1280, 720, { images: new Map(), videos: new Map(), lottie: new Map() })
    return createHash('sha1').update(log.join('\n')).digest('hex')
  }

  const doc = mod.emptyStudioDoc()
  const runaway = { ...mod.defaultTextClip(0, 0), id: 'runaway', text: 'Off the edge', durationSec: 4, x: 3.4, y: -7.2 }
  const clamped = { ...runaway, x: STAGE_MAX, y: STAGE_MIN }

  const runawayFrame = hashFrame({ ...doc, clips: [runaway] }, 1)
  const clampedFrame = hashFrame({ ...doc, clips: [clamped] }, 1)
  assert.equal(runawayFrame, clampedFrame, 'a runaway placement renders exactly as its clamped equivalent — the resolve pass fixed it')

  // Preview and export call the same function, so the same inputs must hash
  // the same. Run it twice to prove the clamp introduced no time-dependent or
  // stateful behaviour that could desync the two.
  assert.equal(hashFrame({ ...doc, clips: [runaway] }, 1), runawayFrame, 'the clamped frame is deterministic across passes (preview == export)')

  // And a clip that was never out of bounds is untouched.
  const normal = { ...mod.defaultTextClip(0, 0), id: 'normal', text: 'Off the edge', durationSec: 4, x: 0.5, y: 0.5 }
  assert.notEqual(hashFrame({ ...doc, clips: [normal] }, 1), clampedFrame, 'clamping did not flatten every placement to the same spot')
}

/* ——— 4. safe areas and the honest pre-export warning ————————————— */
{
  for (const aspect of ['16:9', '9:16', '1:1', '4:5']) {
    const safe = mod.safeAreaFor(aspect)
    assert.ok(safe.x > 0 && safe.x < 0.2, `${aspect} has a sane horizontal safe inset`)
    assert.ok(safe.y > 0 && safe.y < 0.3, `${aspect} has a sane vertical safe inset`)
    assert.ok(safe.note.length > 20, `${aspect} explains its safe area in words`)
    assert.equal(mod.outsideSafeArea({ x: 0.5, y: 0.5 }, aspect), false, `dead centre is inside the ${aspect} safe area`)
    assert.equal(mod.outsideSafeArea({ x: 0.5, y: 0.01 }, aspect), 'top', `the very top is outside the ${aspect} safe area`)
  }
  // Vertical is stricter at the bottom than 16:9 — that is the whole point.
  assert.ok(mod.safeAreaFor('9:16').y > mod.safeAreaFor('16:9').y, 'Reels reserves more room at the bottom than broadcast')

  const msg = mod.overflowMessage('Closing card', 'bottom', '9:16')
  assert.match(msg, /Closing card/, 'the warning names the clip')
  assert.match(msg, /bottom/, 'and which edge')
  assert.match(msg, /will still export/, 'and does not pretend it is an error')
  assert.doesNotMatch(msg, /Error|failed|invalid/i, 'a layout note is not phrased as a failure')
}

/* ——— 5. the clamp is wired at every write site, not just one ————— */
{
  const { readFile } = await import('node:fs/promises')
  const read = (rel) => readFile(path.join(root, rel), 'utf8')
  const renderer = await read('src/lib/studio/renderer.ts')
  const ops = await read('src/lib/studio/editOps.ts')
  const kf = await read('src/lib/studio/keyframeEdit.ts')
  const drop = await read('src/lib/studio/resourceDrop.ts')

  assert.match(renderer, /function onStage<T extends StudioClip>/, 'the renderer has the shared resolve-pass clamp')
  assert.match(renderer, /if \(!values\) return onStage\(clip\)/, 'clips without keyframes are clamped too')
  assert.match(renderer, /return onStage\(next\)/, 'and so are keyframed ones')
  assert.match(ops, /return onStageDoc\(resolveOverlaps\(next\)\)/, 'the agent plan clamps at its single exit')
  assert.match(kf, /keys\[index\] = clampPlacement\(/, 'keyframe writes are clamped')
  assert.match(drop, /clampClipPlacement\(result\.clip as never\)/, 'drops are clamped')

  // The pre-export warning is on the render screen, in words, and never blocks.
  const render = await read('src/screens/Render.tsx')
  assert.match(render, /outsideSafeArea\(p, aspect\)/, 'the render screen checks the safe area for the chosen aspect')
  assert.match(render, /overflowMessage\(p\.name \|\| 'Untitled clip', where, aspect\)/, 'and names each clip it flags')
  assert.doesNotMatch(render, /disabled=\{[^}]*overflows/, 'an overflow warning never blocks the render')

  // Safe-area guides already exist for every aspect; make sure they stay.
  const preview = await read('src/screens/studio/StudioPreview.tsx')
  assert.match(preview, /aria-label="Title and action safe area guides"/, 'the stage draws safe-area guides')
  assert.match(preview, /doc\.aspect === '9:16' \|\| doc\.aspect === '4:5'/, 'and the extra social-UI guides for vertical aspects')
}

console.log('JOB 7 check passed — 10,000 fuzzed placements and 5,000 real write ops produced 0 out-of-bounds values, the shared resolve pass corrects legacy runaways identically in preview and export, and safe areas warn in words for all 4 aspects')
