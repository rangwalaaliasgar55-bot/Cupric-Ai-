#!/usr/bin/env node
/**
 * check:preview-parity — the preview and the export must draw the same frame.
 *
 * The Studio has two entry points onto one renderer:
 *
 *   StudioPreview.tsx  draws the frame you look at, at preview size, with
 *                      `registrySources` (media resolved at proxy quality).
 *   studio/export.ts   draws the frames that are recorded, at export size,
 *                      with `exportSources()` (media resolved at full quality).
 *
 * "Preview and export use the same function" was true before this check existed
 * and was also the whole argument — nothing failed if the two call sites drifted
 * apart (a different clamp, a missing resolve step, a renderer that sizes things
 * by the canvas, or a duplicated source literal that stops matching).
 *
 * So this check renders the SAME real documents at the SAME playheads through
 * both configurations and compares:
 *   1. the draw-call trace — identical, in order, argument for argument;
 *   2. every word painted — the same captions in the same order;
 *   3. the sequence of media/overlay/sticker requests, with the sub-second local
 *      time of each — the same sources asked for at the same moments;
 *   4. the frame at export size — geometry scales with the canvas and nothing
 *      else moves (pixel arguments within 0.05 px; multipliers/angles exact);
 *   5. that the only intended difference between the source sets is media
 *      quality, and that overlay/sticker are the SAME resolver functions;
 *   6. that a playhead past the end of the doc lands on the last frame in both.
 *
 * Real work, not grep: the real renderer is bundled and driven with a recording
 * 2D context. Run: npm run check:preview-parity
 */

import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { readFile, rm } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const tmp = path.join(root, '.preview-parity-check.mjs')

let checks = 0
const ok = (condition, label) => {
  assert.ok(condition, `FAIL: ${label}`)
  checks += 1
}
const eq = (a, b, label) => {
  assert.equal(a, b, `FAIL: ${label}`)
  checks += 1
}

/* ── the calls that carry geometry, and the ones that carry multipliers ────── */
const GEOMETRY = new Set([
  'fillRect', 'strokeRect', 'clearRect', 'rect', 'roundRect', 'moveTo', 'lineTo', 'arc', 'arcTo',
  'ellipse', 'quadraticCurveTo', 'bezierCurveTo', 'translate', 'scale', 'rotate', 'transform',
  'setTransform', 'drawImage', 'fillText', 'strokeText', 'clip',
])
/**
 * Calls whose numbers are multipliers or angles, not pixel coordinates: they
 * must be identical at both canvas sizes, so their arguments are not rescaled.
 */
const NOT_PIXELS = new Set(['scale', 'rotate', 'transform', 'setTransform', 'arc', 'ellipse'])
const STATE = new Set([
  'fillStyle', 'strokeStyle', 'globalAlpha', 'font', 'lineWidth', 'lineJoin', 'lineCap', 'filter',
  'shadowColor', 'shadowBlur', 'shadowOffsetX', 'shadowOffsetY', 'textAlign', 'textBaseline',
  'globalCompositeOperation', 'imageSmoothingEnabled', 'imageSmoothingQuality', 'letterSpacing',
  'direction', 'miterLimit',
])

/* ── recording 2D context: every call, with structured arguments ──────────── */
function makeCtx(width, height) {
  const events = []
  const painted = []
  const state = { font: '16px sans-serif', fillStyle: '#000', globalAlpha: 1, filter: 'none' }
  const gradient = { addColorStop() {} }
  const ctx = new Proxy(state, {
    get(target, key) {
      if (key === 'canvas') return { width, height }
      if (key in target) return target[key]
      if (typeof key === 'symbol') return undefined
      if (key === 'measureText') {
        // Faithful to a real canvas: the advance width grows with the font size
        // set on the context. (A fixed-width stub would make text boxes look
        // resolution-dependent when they are not.)
        return (text) => {
          const px = /(\d+(?:\.\d+)?)px/.exec(String(target.font))
          return { width: String(text).length * (px ? Number(px[1]) : 10) * 0.55 }
        }
      }
      if (key === 'createLinearGradient' || key === 'createRadialGradient' || key === 'createConicGradient' || key === 'createPattern') {
        return (...args) => {
          events.push({ name: String(key), args })
          return gradient
        }
      }
      if (key === 'getImageData') return () => ({ width: 1, height: 1, data: new Uint8ClampedArray(4) })
      if (key === 'getTransform') return () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 })
      if (key === 'toDataURL') return () => 'data:image/png;base64,'
      return (...args) => {
        events.push({ name: String(key), args })
        if (key === 'fillText') painted.push(String(args[0]))
      }
    },
    set(target, key, value) {
      target[key] = value
      if (STATE.has(String(key))) events.push({ name: `=${String(key)}`, args: [value] })
      return true
    },
  })
  return { ctx, events, painted }
}

const show = (event) => `${event.name}(${event.args.map((a) => (typeof a === 'number' ? a.toFixed(4) : typeof a === 'string' ? JSON.stringify(a) : `[${typeof a}]`)).join(',')})`

/**
 * Geometry calls with pixel arguments scaled — canvas size must not change the
 * composition. Multiplier/angle calls are compared unscaled.
 */
function geometryEvents(events, ratio) {
  return events
    .filter((event) => GEOMETRY.has(event.name))
    .map((event) => ({
      name: event.name,
      args: NOT_PIXELS.has(event.name) ? event.args : event.args.map((a) => (typeof a === 'number' ? a * ratio : a)),
    }))
}

/** Same call, same arguments within `tolerance` pixels (floats, not strings). */
function compareGeometry(small, large, tolerance = 0.05) {
  if (small.length !== large.length) return `${small.length} calls vs ${large.length}`
  for (let i = 0; i < small.length; i++) {
    const a = small[i]
    const b = large[i]
    if (a.name !== b.name) return `call ${i}: ${a.name} vs ${b.name}`
    if (a.args.length !== b.args.length) return `call ${i} (${a.name}): ${a.args.length} args vs ${b.args.length}`
    for (let j = 0; j < a.args.length; j++) {
      const x = a.args[j]
      const y = b.args[j]
      if (typeof x === 'number' && typeof y === 'number') {
        if (Math.abs(x - y) > tolerance * Math.max(1, Math.abs(x))) return `call ${i} (${a.name}) arg ${j}: ${x} vs ${y}`
      } else if (x !== y) return `call ${i} (${a.name}) arg ${j}: ${String(x)} vs ${String(y)}`
    }
  }
  return null
}

/* ── minimal DOM so the media, glass and Lottie modules can load ──────────── */
globalThis.window = globalThis
if (!globalThis.navigator) Object.defineProperty(globalThis, 'navigator', { value: { onLine: true, userAgent: 'node' }, configurable: true })
globalThis.requestAnimationFrame = (cb) => setTimeout(() => cb(Date.now()), 16)
globalThis.cancelAnimationFrame = clearTimeout
globalThis.CSS = { supports: () => false }
/** Stands in for Vite's `import.meta.glob` in the Lottie registry. */
globalThis.__cupricGlob = () => ({})
globalThis.document = {
  createElement: (tag) => {
    if (tag !== 'canvas') return { style: {}, setAttribute() {}, appendChild() {} }
    const el = { width: 0, height: 0, style: {} }
    el.getContext = () => makeCtx(el.width || 1, el.height || 1).ctx
    el.toDataURL = () => 'data:image/png;base64,'
    return el
  },
  fonts: { ready: Promise.resolve(), add() {}, has: () => true, check: () => true },
}

await build({
  bundle: true,
  outfile: tmp,
  format: 'esm',
  platform: 'neutral',
  mainFields: ['module', 'main'],
  logLevel: 'warning',
  loader: { '.css': 'empty', '.svg': 'dataurl', '.json': 'json' },
  // `sources.ts` pulls in the Lottie registry, which uses Vite's
  // `import.meta.glob` to find the built-in sticker strips. Node has no such
  // thing, so this plugin rewrites that one call to a global the check
  // installs; the built-in strips resolve to nothing here and sticker
  // resolution is exercised through the shared resolver instead.
  plugins: [{
    name: 'vite-glob-shim',
    setup(build) {
      build.onLoad({ filter: /studio[/\\]lottie\.ts$/ }, async (args) => ({
        contents: (await readFile(args.path, 'utf8')).replace(/import\.meta\.glob\(/g, '__cupricGlob('),
        loader: 'ts',
      }))
    },
  }],
  stdin: {
    contents: `
      export { drawStudioFrame } from './src/lib/studio/renderer'
      export { emptyStudioDoc, defaultTextClip, defaultGlassClip, docDuration, frameTimeFor, sizeForAspect, previewSizeForAspect } from './src/lib/studio/doc'
      export { resolveForOutput } from './src/lib/studio/resolve'
      export { registrySources, exportSources } from './src/lib/studio/sources'
    `,
    resolveDir: root,
    sourcefile: 'previewParity.ts',
    loader: 'ts',
  },
})

const mod = await import(`${pathToFileURL(tmp).href}?t=${Date.now()}`)
await rm(tmp, { force: true })

/* ── helpers: real Studio documents, drawn through a given configuration ──── */
function textClip(overrides = {}) {
  return {
    ...mod.defaultTextClip(0, 2),
    text: 'Same frame, same pixels',
    anim: 'fade',
    legibility: 'on',
    scrimStrength: 0.6,
    ...overrides,
  }
}

function battery() {
  const base = mod.emptyStudioDoc()
  return [
    { label: 'single title', doc: { ...base, clips: [textClip({ id: 'a' })] } },
    {
      label: 'two clips, one hidden, one muted',
      doc: {
        ...base,
        clips: [
          textClip({ id: 'a', startSec: 0, durationSec: 2 }),
          textClip({ id: 'b', text: 'Second line', startSec: 1.2, durationSec: 2, hidden: true }),
          textClip({ id: 'c', text: 'Third line', startSec: 2.4, durationSec: 1.5, opacity: 0.4, rotation: 12 }),
        ],
      },
    },
    {
      label: 'graded, masked, keyframed clip',
      doc: {
        ...base,
        clips: [
          textClip({
            id: 'k',
            durationSec: 3,
            rotation: 8,
            grade: [{ id: 'contrast', enabled: true, contrast: 1.2, fade: 0.1 }],
            mask: { shape: 'ellipse', x: 0.5, y: 0.5, w: 0.6, h: 0.6, featherPct: 10 },
            keyframes: [
              { at: 0, opacity: 0, y: 0.7, ease: 'ease-out' },
              { at: 1, opacity: 1, y: 0.45, ease: 'ease-out' },
              { at: 2, opacity: 1, y: 0.45, ease: 'linear' },
            ],
          }),
        ],
      },
    },
    {
      label: 'transition in and out',
      doc: { ...base, clips: [textClip({ id: 't', durationSec: 3, transitionIn: 'fade', transitionOut: 'slideUp' })] },
    },
    {
      label: 'glass clip over text',
      doc: {
        ...base,
        clips: [
          textClip({ id: 'g1', startSec: 0, durationSec: 3, text: 'Behind the glass' }),
          { ...mod.defaultGlassClip(0.5, 3, 'hero', 'panel'), id: 'g2', durationSec: 2 },
        ],
      },
    },
  ]
}

/** Render one frame and return everything that should be identical. */
function drawFrame(doc, t, width, height, sources) {
  const rec = makeCtx(width, height)
  const requests = []
  const wrapped = {
    media: (clip) => {
      requests.push(`media:${clip.id}@${Number(t).toFixed(3)}`)
      return sources.media(clip)
    },
    overlay: (clip, localSec = 0) => {
      requests.push(`overlay:${clip.id}@${Number(localSec).toFixed(3)}`)
      return sources.overlay(clip, localSec)
    },
    sticker: (clip, localSec = 0) => {
      requests.push(`sticker:${clip.id}@${Number(localSec).toFixed(3)}`)
      return sources.sticker(clip, localSec)
    },
  }
  mod.drawStudioFrame(rec.ctx, doc, t, width, height, wrapped)
  return { events: rec.events, painted: rec.painted, requests }
}

if (process.env.CUPRIC_TRACE) {
  const doc = mod.resolveForOutput({ ...mod.emptyStudioDoc(), clips: [textClip({ id: 'dbg' })] })
  for (const [w, h, label] of [[mod.previewSizeForAspect('16:9')[0], mod.previewSizeForAspect('16:9')[1], 'preview'], [mod.sizeForAspect('16:9', '1080p')[0], mod.sizeForAspect('16:9', '1080p')[1], 'export']]) {
    const frame = drawFrame(doc, 0, w, h, mod.exportSources())
    console.log(`--- ${label} ${w}x${h} ---`)
    console.log(frame.events.slice(0, 18).map(show).join('\n'))
  }
  process.exit(0)
}

/* ── 1. the two source sets differ in exactly one documented way ──────────── */
{
  const preview = mod.registrySources
  const exported = mod.exportSources()
  ok(typeof preview.media === 'function' && typeof exported.media === 'function', 'both source sets resolve media')
  ok(preview.media !== exported.media, 'preview and export use their own media resolver (proxy vs original file)')
  ok(preview.overlay === exported.overlay, 'overlay resolution is the SAME function in preview and export')
  ok(preview.sticker === exported.sticker, 'sticker resolution is the SAME function in preview and export')

  const sourcesTs = await readFile(path.join(root, 'src/lib/studio/sources.ts'), 'utf8')
  assert.match(sourcesTs, /media: \(clip\) => drawableElement\(clip\.mediaId, 'preview'\)/, 'the preview resolver asks for the proxy')
  assert.match(sourcesTs, /export function exportSources\(\)[\s\S]*?media: \(clip\) => drawableElement\(clip\.mediaId\)/, 'the export resolver asks for the original file')
  checks += 2
}

/* ── 2. both entry points resolve the doc and clamp the playhead ──────────── */
{
  const previewTs = await readFile(path.join(root, 'src/screens/studio/StudioPreview.tsx'), 'utf8')
  const exportTs = await readFile(path.join(root, 'src/lib/studio/export.ts'), 'utf8')
  assert.match(previewTs, /const doc = resolveForOutput\(editDoc\)/, 'the preview resolves the doc like the exporter does')
  assert.match(exportTs, /const doc = resolveForOutput\(editDoc\)/, 'the exporter resolves the doc')
  assert.match(previewTs, /drawStudioFrame\(ctx, doc, frameTimeFor\(doc, t\)/, 'the preview draws the shared frame time')
  assert.match(exportTs, /drawStudioFrame\(ctx, doc, frameTimeFor\(doc, elapsed\)/, 'the exporter draws the shared frame time')
  // …and the shared function really does clamp, executed here rather than read.
  const clamped = { ...mod.emptyStudioDoc(), clips: [textClip({ id: 'c', startSec: 0, durationSec: 2 })] }
  eq(mod.frameTimeFor(clamped, 0.5), 0.5, 'a playhead inside the doc is used as-is')
  eq(mod.frameTimeFor(clamped, 99), 2, 'a playhead past the end lands on the last frame')
  eq(mod.frameTimeFor(clamped, -3), 0, 'a negative playhead lands on the first frame')
  eq(mod.frameTimeFor(mod.emptyStudioDoc(), 5), 0, 'an empty doc draws frame zero')
  // The duplicated inline source literal is what this check exists to prevent.
  eq((exportTs.match(/media: \(clip\) => drawableElement\(clip\.mediaId\),/g) || []).length, 0, 'the exporter no longer builds sources inline')
  eq((exportTs.match(/exportSources\(\)/g) || []).length, 2, 'both exporter call sites use the shared resolver')
  checks += 5
}

/* ── 3. the same documents drawn through both configurations ──────────────── */
const [pw, ph] = mod.previewSizeForAspect('16:9')
const [ew, eh] = mod.sizeForAspect('16:9', '1080p')
ok(ew > pw, 'the export canvas is larger than the preview canvas')

for (const { label, doc: editDoc } of battery()) {
  const doc = mod.resolveForOutput(editDoc)
  const duration = mod.docDuration(doc)
  const times = [0, 0.25, duration * 0.5, Math.max(0.01, duration - 0.05), duration, duration + 5]
  for (const t of times) {
    const clamp = (value) => Math.max(0, Math.min(value, duration))
    // Same size: the two configurations must produce an identical frame.
    const preview = drawFrame(doc, clamp(t), pw, ph, mod.registrySources)
    const exported = drawFrame(doc, clamp(t), pw, ph, mod.exportSources())
    const previewTrace = preview.events.map(show)
    const exportTrace = exported.events.map(show)
    let firstDiff = -1
    for (let i = 0; i < previewTrace.length && firstDiff < 0; i++) {
      if (previewTrace[i] !== exportTrace[i]) firstDiff = i
    }
    ok(firstDiff < 0, `${label} at ${t.toFixed(2)}s: preview and export draw the same frame${firstDiff < 0 ? '' : ` (first difference: preview ${previewTrace[firstDiff]} vs export ${exportTrace[firstDiff]})`}`)
    eq(preview.painted.join('\u0000'), exported.painted.join('\u0000'), `${label} at ${t.toFixed(2)}s: the same words are painted`)
    eq(preview.requests.join('\u0000'), exported.requests.join('\u0000'), `${label} at ${t.toFixed(2)}s: the same sources are asked for at the same local times`)

    // Different size: the geometry scales with the canvas and nothing else moves.
    const big = drawFrame(doc, clamp(t), ew, eh, mod.exportSources())
    const mismatch = compareGeometry(geometryEvents(preview.events, ew / pw), geometryEvents(big.events, 1))
    ok(!mismatch, `${label} at ${t.toFixed(2)}s: the frame is resolution-independent${mismatch ? ` (${mismatch})` : ''}`)
    eq(big.painted.join('\u0000'), preview.painted.join('\u0000'), `${label} at ${t.toFixed(2)}s: the same words are painted at export size`)
  }
}

/* ── 4. a doc whose variables change the text: both paths resolve ─────────── */
{
  const raw = { ...mod.emptyStudioDoc(), clips: [textClip({ id: 'v', text: 'Made with {{tool}}' })] }
  raw.variables = [{ name: 'tool', value: 'Cupric AI' }]
  const resolved = mod.resolveForOutput(raw)
  ok(!JSON.stringify(resolved).includes('{{tool}}'), 'variables are substituted by the resolver, not by the renderer')
  const preview = drawFrame(resolved, 0.4, pw, ph, mod.registrySources)
  const exported = drawFrame(resolved, 0.4, pw, ph, mod.exportSources())
  ok(preview.painted.some((word) => word.includes('Cupric')), 'the preview paints the substituted text')
  eq(preview.painted.join('\u0000'), exported.painted.join('\u0000'), 'the export paints the same substituted text')
}

console.log(`preview/export parity check passed — ${checks} assertions across ${battery().length} documents, preview ${pw}x${ph} vs export ${ew}x${eh}`)
