/**
 * Scrub performance profile.
 *
 * What this measures: the JavaScript the renderer runs per frame — clip
 * selection, transition maths, keyframe interpolation, grade strings, layout.
 * What it does NOT measure: GPU rasterisation, which needs a real canvas.
 *
 * That split is the point. Rasterising is the browser's job and is fast; the
 * way a scrub goes bad is our own per-frame work growing quietly until a
 * 60-clip document cannot hold 60fps. So this budgets the part we control and
 * fails the build if a change makes it worse.
 *
 * Run: npm run check:perf
 */
import { build } from 'esbuild'
import { rm } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const tmp = path.join(root, '.scrub-perf.mjs')

/** A no-op 2D context. Drawing costs nothing, so what is left is our own work. */
function nullCtx(width, height) {
  const gradient = { addColorStop() {} }
  const ctx = {
    canvas: { width, height },
    globalAlpha: 1,
    globalCompositeOperation: 'source-over',
    filter: 'none',
    fillStyle: '#000',
    strokeStyle: '#000',
    lineWidth: 1,
    lineJoin: 'miter',
    font: '16px sans-serif',
    textAlign: 'center',
    textBaseline: 'middle',
    shadowColor: 'transparent',
    shadowBlur: 0,
    shadowOffsetY: 0,
    imageSmoothingEnabled: true,
    imageSmoothingQuality: 'high',
    save() {},
    restore() {},
    measureText: (text) => ({ width: String(text).length * 8 }),
    createLinearGradient: () => gradient,
    createRadialGradient: () => gradient,
    getImageData: () => ({ data: new Uint8ClampedArray(4), width: 1, height: 1 }),
    putImageData() {},
    drawImage() {},
  }
  for (const name of [
    'fillRect', 'strokeRect', 'clearRect', 'beginPath', 'closePath', 'moveTo', 'lineTo',
    'arc', 'ellipse', 'quadraticCurveTo', 'bezierCurveTo', 'rect', 'roundRect', 'clip',
    'fill', 'stroke', 'fillText', 'strokeText', 'translate', 'scale', 'rotate', 'setTransform',
    'resetTransform', 'transform', 'setLineDash',
  ]) {
    ctx[name] = () => {}
  }
  return ctx
}

globalThis.window = globalThis
if (!globalThis.navigator) Object.defineProperty(globalThis, 'navigator', { value: { onLine: true, userAgent: 'node' }, configurable: true })
globalThis.requestAnimationFrame = (cb) => setTimeout(() => cb(Date.now()), 16)
globalThis.cancelAnimationFrame = clearTimeout
globalThis.CSS = { supports: () => false }
globalThis.document = {
  createElement: (tag) => {
    if (tag !== 'canvas') return { style: {}, setAttribute() {}, appendChild() {} }
    const el = { width: 0, height: 0, style: {} }
    el.getContext = () => nullCtx(el.width || 1, el.height || 1)
    el.toDataURL = () => 'data:image/png;base64,'
    return el
  },
}

await build({
  bundle: true,
  outfile: tmp,
  format: 'esm',
  platform: 'neutral',
  mainFields: ['module', 'main'],
  logLevel: 'warning',
  loader: { '.css': 'empty', '.svg': 'dataurl', '.json': 'json' },
  stdin: {
    contents: `
      export { drawStudioFrame } from './src/lib/studio/renderer'
      export { emptyStudioDoc, defaultTextClip, defaultGlassClip } from './src/lib/studio/doc'
      export { STUDIO_BACKGROUNDS } from './src/lib/studio/backgrounds'
    `,
    resolveDir: root,
    sourcefile: 'perf.ts',
    loader: 'ts',
  },
})
const mod = await import(`${pathToFileURL(tmp).href}?t=${Date.now()}`)
await rm(tmp, { force: true })

/**
 * A document heavier than anything a user is likely to build by hand.
 *
 * Every clip overlaps every other one, on purpose: what costs time is the
 * number of clips *on screen at once*, not the number in the project, and a
 * document where clips are spread along the timeline would flatter the
 * numbers by only ever drawing two or three of them.
 */
function heavyDoc(clipCount) {
  const doc = mod.emptyStudioDoc('9:16')
  doc.trackCount = 4
  doc.clips = []
  for (let i = 0; i < clipCount; i += 1) {
    // A small stagger, but every clip is live for the whole 6s window.
    const start = (i % 5) * 0.2
    if (i % 3 === 0) {
      doc.clips.push({
        ...mod.defaultGlassClip(start, i % 4, 'hero', i % 2 ? 'lens' : 'panel'),
        durationSec: 6,
        transitionIn: 'glass-wipe',
        transitionOut: 'fade',
        rotation: (i % 7) * 5,
        grade: [{ id: 'look', enabled: true, saturation: 20, hue: 5 }],
        keyframes: [
          { at: 0, scale: 0.8, opacity: 0, ease: 'ease-out' },
          { at: 1.5, scale: 1.1, opacity: 1, ease: 'ease-in-out' },
        ],
      })
    } else {
      doc.clips.push({
        ...mod.defaultTextClip(start, i % 4),
        text: 'A headline of a realistic length for a short-form video',
        durationSec: 6,
        anim: ['fade-up', 'pop', 'typewriter', 'liquid-wave', 'glass-rise'][i % 5],
        transitionIn: 'zoom-in',
        transitionOut: 'blur',
        captionStyle: i % 2 ? 'hormozi' : 'minimal',
        rotation: i % 5 ? 0 : 8,
        mask: i % 9 === 0 ? { shape: 'ellipse', x: 0.1, y: 0.1, w: 0.8, h: 0.8, featherPct: 5, invert: false, threshold: 0.5, softness: 0.2 } : null,
        keyframes: [
          { at: 0, y: 0.6, opacity: 0, ease: 'ease-out' },
          { at: 1, y: 0.5, opacity: 1, ease: 'linear' },
        ],
      })
    }
  }
  return doc
}

function profile(doc, frames) {
  const ctx = nullCtx(1080, 1920)
  const sources = { media: () => null, overlay: () => null, sticker: () => null }
  const duration = doc.clips.reduce((m, c) => Math.max(m, c.startSec + c.durationSec), 0)
  // Warm up, so the first pass through the JIT is not counted as the result.
  for (let i = 0; i < 40; i += 1) mod.drawStudioFrame(ctx, doc, (i / 40) * duration, 1080, 1920, sources)

  const samples = new Float64Array(frames)
  for (let i = 0; i < frames; i += 1) {
    const t = (i / frames) * duration
    const started = performance.now()
    mod.drawStudioFrame(ctx, doc, t, 1080, 1920, sources)
    samples[i] = performance.now() - started
  }
  const sorted = Array.from(samples).sort((a, b) => a - b)
  const mean = sorted.reduce((n, v) => n + v, 0) / sorted.length
  return { mean, p95: sorted[Math.floor(sorted.length * 0.95)], worst: sorted[sorted.length - 1] }
}

// 16.6ms is one frame at 60fps. Our own work gets a tenth of it; the rest
// belongs to rasterising, compositing and the rest of the browser.
const BUDGET_MEAN_MS = 3
const BUDGET_P95_MS = 6

const sizes = [10, 40, 120]
const rows = []
for (const size of sizes) rows.push({ size, ...profile(heavyDoc(size), 400) })

console.log('scrub profile — renderer JS only, 1080x1920, 400 frames each, all clips overlapping\n')
console.log('  clips    mean      p95     worst')
for (const row of rows) {
  console.log(
    `  ${String(row.size).padStart(5)}  ${row.mean.toFixed(3)}ms  ${row.p95.toFixed(3)}ms  ${row.worst.toFixed(3)}ms`,
  )
}

// Growth should be roughly linear in the number of clips on screen; anything
// quadratic shows up here long before a user notices it.
const smallest = rows[0]
const largest = rows[rows.length - 1]
const ratio = largest.mean / Math.max(smallest.mean, 0.0001)
const sizeRatio = largest.size / smallest.size
console.log(`\n  ${sizeRatio}x the clips costs ${ratio.toFixed(1)}x the time`)

const problems = []
if (largest.mean > BUDGET_MEAN_MS) problems.push(`mean ${largest.mean.toFixed(3)}ms at ${largest.size} clips exceeds the ${BUDGET_MEAN_MS}ms budget`)
if (largest.p95 > BUDGET_P95_MS) problems.push(`p95 ${largest.p95.toFixed(3)}ms at ${largest.size} clips exceeds the ${BUDGET_P95_MS}ms budget`)
if (ratio > sizeRatio * 1.8) problems.push(`cost is growing faster than clip count (${ratio.toFixed(1)}x for ${sizeRatio}x the clips) — something is quadratic`)

if (problems.length) {
  console.error(`\nscrub profile FAILED:\n  - ${problems.join('\n  - ')}`)
  process.exit(1)
}
console.log('\nscrub profile passed')
