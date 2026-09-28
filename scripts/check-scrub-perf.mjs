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

/**
 * Machine calibration. The budgets were set on a reference machine; a slower
 * CPU (or a laptop on battery) shouldn't fail the build for code that didn't
 * change. A fixed synthetic workload — string building, maths, small objects,
 * like the renderer's own per-frame work — measures this machine's speed. The
 * budget scales up by at most 4x and never below the reference.
 */
const REFERENCE_CALIBRATION_MS = 16
function calibrate() {
  const run = () => {
    const started = performance.now()
    let acc = 0
    const parts = []
    for (let i = 0; i < 60000; i += 1) {
      const o = { x: Math.sin(i) * 0.5, y: Math.cos(i * 0.7), s: `rgba(${i & 255},${(i >> 3) & 255},10,${(i % 100) / 100})` }
      acc += o.x * o.y + o.s.length
      if (i % 500 === 0) parts.push(o.s.split(',').join('|'))
    }
    if (acc === 42) console.log(parts.length)
    return performance.now() - started
  }
  for (let i = 0; i < 3; i += 1) run()
  const times = Array.from({ length: 7 }, run).sort((a, b) => a - b)
  return times[3]
}
const calibrationMs = calibrate()
const machineFactor = Math.min(4, Math.max(1, calibrationMs / REFERENCE_CALIBRATION_MS))

// Best of three passes: a stray GC or background task shouldn't decide the verdict.
const sizes = [10, 40, 120]
const rows = []
for (const size of sizes) {
  const doc = heavyDoc(size)
  const passes = [profile(doc, 400), profile(doc, 400), profile(doc, 400)]
  rows.push({ size, mean: Math.min(...passes.map((p) => p.mean)), p95: Math.min(...passes.map((p) => p.p95)), worst: Math.min(...passes.map((p) => p.worst)) })
}

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

const meanBudget = BUDGET_MEAN_MS * machineFactor
const p95Budget = BUDGET_P95_MS * machineFactor
console.log(`  machine calibration ${calibrationMs.toFixed(1)}ms (reference ${REFERENCE_CALIBRATION_MS}ms) → budgets ×${machineFactor.toFixed(2)}: mean ${meanBudget.toFixed(2)}ms, p95 ${p95Budget.toFixed(2)}ms`)
const problems = []
if (largest.mean > meanBudget) problems.push(`mean ${largest.mean.toFixed(3)}ms at ${largest.size} clips exceeds the ${meanBudget.toFixed(2)}ms budget`)
if (largest.p95 > p95Budget) problems.push(`p95 ${largest.p95.toFixed(3)}ms at ${largest.size} clips exceeds the ${p95Budget.toFixed(2)}ms budget`)
if (ratio > sizeRatio * 1.8) problems.push(`cost is growing faster than clip count (${ratio.toFixed(1)}x for ${sizeRatio}x the clips) — something is quadratic`)

if (problems.length) {
  console.error(`\nscrub profile FAILED:\n  - ${problems.join('\n  - ')}`)
  process.exit(1)
}
console.log('\nscrub profile passed')

/* ————————————————————————————————————————————————————————————————————————
 * F-4 — the frame has to stay identical, and the UI has to stay out of the way
 *
 * The speed above comes from caches (draw order, keyframe order, grade
 * strings, wrapped lines) and from React no longer re-rendering two large
 * panels per scrub frame. Caches are only allowed if a frame is still a pure
 * function of `t`, so the first block below proves that, and the second pins
 * the render-side work in source so it cannot quietly come back.
 * ———————————————————————————————————————————————————————————————————————— */

/** A context that writes down every call instead of drawing. */
function recordingCtx(width, height, log) {
  const note = (name) => (...args) => {
    log.push(`${name}(${args.map((a) => (typeof a === 'number' ? a.toFixed(4) : typeof a === 'object' && a ? '#' : String(a))).join(',')})`)
  }
  const gradient = { addColorStop: note('stop') }
  const ctx = {
    canvas: { width, height },
    save: note('save'),
    restore: note('restore'),
    measureText: (text) => ({ width: String(text).length * 8 }),
    createLinearGradient: (...a) => { note('linear')(...a); return gradient },
    createRadialGradient: (...a) => { note('radial')(...a); return gradient },
    getImageData: () => ({ data: new Uint8ClampedArray(4), width: 1, height: 1 }),
    putImageData: note('putImageData'),
    drawImage: note('drawImage'),
  }
  for (const name of [
    'fillRect', 'strokeRect', 'clearRect', 'beginPath', 'closePath', 'moveTo', 'lineTo',
    'arc', 'ellipse', 'quadraticCurveTo', 'bezierCurveTo', 'rect', 'roundRect', 'clip',
    'fill', 'stroke', 'fillText', 'strokeText', 'translate', 'scale', 'rotate', 'setTransform',
    'resetTransform', 'transform', 'setLineDash',
  ]) ctx[name] = note(name)
  // Style writes matter as much as draw calls: a stale cached filter string
  // would show up here and nowhere else.
  for (const prop of [
    'globalAlpha', 'globalCompositeOperation', 'filter', 'fillStyle', 'strokeStyle', 'lineWidth',
    'lineJoin', 'font', 'textAlign', 'textBaseline', 'shadowColor', 'shadowBlur', 'shadowOffsetY',
    'imageSmoothingEnabled', 'imageSmoothingQuality',
  ]) {
    let value = null
    Object.defineProperty(ctx, prop, {
      get: () => value,
      set: (next) => { value = next; log.push(`${prop}=${typeof next === 'number' ? next.toFixed(4) : String(next)}`) },
    })
  }
  return ctx
}

const pureDoc = heavyDoc(40)
const pureDuration = pureDoc.clips.reduce((m, c) => Math.max(m, c.startSec + c.durationSec), 0)
const pureSources = { media: () => null, overlay: () => null, sticker: () => null }
const frameAt = (t) => {
  const log = []
  mod.drawStudioFrame(recordingCtx(1080, 1920, log), pureDoc, t, 1080, 1920, pureSources)
  return log.join('\n')
}

const times = Array.from({ length: 24 }, (_, i) => (i / 24) * pureDuration)
// Cold: nothing is cached yet. Warm: every cache is full. Shuffled: the caches
// are being read for times they were not filled in.
const cold = new Map(times.map((t) => [t, frameAt(t)]))
const warm = new Map(times.map((t) => [t, frameAt(t)]))
const shuffled = new Map([...times].sort(() => Math.random() - 0.5).map((t) => [t, frameAt(t)]))

const pureProblems = []
for (const t of times) {
  if (cold.get(t) !== warm.get(t)) pureProblems.push(`frame at ${t.toFixed(3)}s differs between a cold and a warm cache`)
  else if (cold.get(t) !== shuffled.get(t)) pureProblems.push(`frame at ${t.toFixed(3)}s differs when frames are drawn out of order`)
}
if (new Set(cold.values()).size < 2) pureProblems.push('every frame recorded the same calls — the harness is not exercising the renderer')

if (pureProblems.length) {
  console.error(`\nF-4 determinism FAILED:\n  - ${pureProblems.join('\n  - ')}`)
  process.exit(1)
}
console.log(`  frame output is identical cold, warm and out of order across ${times.length} sampled times`)

/* ——— source rules: the work that keeps a scrub cheap ——— */
const { readFileSync } = await import('node:fs')
const read = (rel) => readFileSync(path.join(root, rel), 'utf8')
const rules = [
  ['src/lib/studio/doc.ts', /export function orderedClips/, 'draw order must be cached per clip-list identity, not re-sorted every frame'],
  ['src/lib/studio/doc.ts', /clipOrderCache = new WeakMap/, 'the draw-order cache must be a WeakMap keyed on the clip array'],
  ['src/lib/studio/renderer.ts', /orderedKeys\(/, 'keyframes must not be copied and sorted on every lookup'],
  ['src/lib/studio/renderer.ts', /memoClip/, 'the keyframe solve must be memoised: it is asked for twice per clip per frame'],
  ['src/lib/studio/renderer.ts', /gradeFilterCache = new WeakMap/, 'grade filter strings must be cached per grade chain'],
  ['src/lib/studio/renderer.ts', /HEX_CACHE = new Map/, 'hex colour parsing must be memoised'],
  ['src/lib/studio/renderer.ts', /const WRAP_CACHE = new Map<string, Map<number, Map<string, string\[\]>>>/, 'line wrapping must key on font/width/text without building a composite key string'],
  ['src/lib/studio/renderer.ts', /const order = orderedClips\(doc\.clips\)/, 'drawStudioFrame must walk the cached draw order'],
  ['src/lib/studio/glass.ts', /scratch\.width < w \|\| scratch\.height < h/, 'the glass backdrop canvas must grow rather than be resized every frame'],
  ['src/screens/Studio.tsx', /const scrubTime = useDeferredValue\(time\)/, 'the playhead must be deferred for the heavy side panels'],
  ['src/screens/Studio.tsx', /<StudioInspector[\s\S]{0,120}time=\{scrubTime\}/, 'the inspector must read the deferred playhead'],
  ['src/screens/Studio.tsx', /<StudioProPanel[\s\S]{0,120}time=\{scrubTime\}/, 'the pro panel must read the deferred playhead'],
  ['src/screens/Studio.tsx', /onPatch=\{inspectorPatch\}/, 'inspector callbacks must be stable, or memo cannot hold'],
  ['src/screens/Studio.tsx', /onImportFiles=\{proImportFiles\}/, 'pro panel callbacks must be stable, or memo cannot hold'],
  ['src/screens/studio/StudioInspector.tsx', /export const StudioInspector = memo\(/, 'the inspector must be memoised'],
  ['src/screens/studio/StudioProPanel.tsx', /export const StudioProPanel = memo\(/, 'the pro panel must be memoised'],
  ['src/screens/studio/StudioTimeline.tsx', /const ClipBlock = memo\(/, 'studio clip rows must be memoised'],
  ['src/screens/Timeline.tsx', /const TimelineClipBlock = memo\(/, 'timeline clip rows must be memoised'],
  ['src/screens/library/PackBrowser.tsx', /const PackCard = memo\(/, 'pack cards must be memoised'],
  ['src/screens/library/PackBrowser.tsx', /useDeferredValue\(query\)/, 'pack search must be deferred'],
  ['src/app-shell/AppLayout.tsx', /AskPanelHost/, 'the Ask panel must mount on first open, not at first paint'],
  ['src/components/MotionCompositionPlayer.tsx', /lazy\(\(\) => import\('\.\/MotionCompositionPlayer\.impl'\)\)/, 'the Remotion player must be lazy'],
  ['src/main.tsx', /await import\('\.\/lib\/studio\/backgroundExportHost'\)/, 'the export compositor must be fetched on the first export job'],
]
const sourceProblems = []
for (const [file, pattern, why] of rules) {
  if (!pattern.test(read(file))) sourceProblems.push(`${file}: ${why}`)
}

// Nothing heavy may be imported statically anywhere in src/.
const heavyStatic = [
  ["import 'heic2any'", /^\s*import\s+[^\n]*from\s+'heic2any'/m],
  ['@dimforge/rapier3d-compat', /^\s*import\s+[^\n]*from\s+'@dimforge\/rapier3d-compat'/m],
  ['html2canvas', /^\s*import\s+[^\n]*from\s+'html2canvas'/m],
  ['@remotion/player', /^\s*import\s+[^\n]*from\s+'@remotion\/player'/m],
]
const { readdirSync } = await import('node:fs')
const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
  const full = path.join(dir, e.name)
  if (e.isDirectory()) return walk(full)
  return /\.(ts|tsx)$/.test(e.name) ? [full] : []
})
for (const file of walk(path.join(root, 'src'))) {
  // `*.impl.tsx` is the far side of a `lazy(() => import(...))` — the whole
  // point of the file is that nothing reaches it until it is needed, so a
  // plain import inside one is correct. The rule list above pins the wrapper.
  if (/\.impl\.tsx?$/.test(file)) continue
  const text = readFileSync(file, 'utf8')
  for (const [label, pattern] of heavyStatic) {
    if (pattern.test(text)) {
      sourceProblems.push(`${path.relative(root, file)} imports ${label} statically — it must be a dynamic import`)
    }
  }
}

// Every screen behind React.lazy, so first paint is the shell plus Home.
const layout = read('src/app-shell/AppLayout.tsx')
for (const screen of ['ArenaDesk', 'Brief', 'FootageDesk', 'Library', 'Render', 'ReviewRoom', 'Timeline', 'Studio', 'Lab', 'Autonomous', 'MotionEngine']) {
  if (!new RegExp(`const ${screen} = lazy\\(`).test(layout)) {
    sourceProblems.push(`AppLayout.tsx: ${screen} must be a React.lazy screen`)
  }
}

if (sourceProblems.length) {
  console.error(`\nF-4 render budget FAILED:\n  - ${sourceProblems.join('\n  - ')}`)
  process.exit(1)
}
console.log(`  ${rules.length} render-cost rules hold; every screen and every WASM dependency is split out`)
console.log('\nF-4 check passed — cached frame work, memoised panels, deferred scrub, split bundle')
