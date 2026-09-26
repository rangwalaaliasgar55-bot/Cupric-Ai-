/**
 * Headless smoke test for the Studio renderer.
 *
 * No browser can be installed in CI here, so this bundles the real renderer
 * with esbuild and drives it against a recording stub of CanvasRenderingContext2D.
 * It proves three things that unit-less UI code usually hides:
 *   1. every clip kind, transition and text animation renders without throwing
 *   2. each one actually issues paint calls (no silently empty branch)
 *   3. save/restore stay balanced, so one clip cannot corrupt the next
 *
 * Run: npm run check:renderer
 */

import { build } from 'esbuild'
import { rm } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const tmp = path.join(root, '.renderer-check.mjs')

function makeCtx(width, height) {
  const calls = []
  let depth = 0
  let maxDepth = 0
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
    save() {
      depth += 1
      maxDepth = Math.max(maxDepth, depth)
      calls.push('save')
    },
    restore() {
      depth -= 1
      if (depth < 0) throw new Error('restore() without a matching save()')
      calls.push('restore')
    },
    measureText: (text) => ({ width: String(text).length * 8 }),
    createLinearGradient: () => gradient,
    createRadialGradient: () => gradient,
    getImageData: () => ({ data: new Uint8ClampedArray(4), width: 1, height: 1 }),
    putImageData() {},
    drawImage() {
      calls.push('drawImage')
    },
  }
  for (const name of [
    'fillRect', 'strokeRect', 'clearRect', 'beginPath', 'closePath', 'moveTo', 'lineTo',
    'arc', 'ellipse', 'quadraticCurveTo', 'bezierCurveTo', 'rect', 'roundRect', 'clip',
    'fill', 'stroke', 'fillText', 'strokeText', 'translate', 'scale', 'rotate', 'setTransform',
    'resetTransform', 'transform', 'setLineDash',
  ]) {
    ctx[name] = (...args) => {
      calls.push(name)
      void args
    }
  }
  return {
    ctx,
    calls,
    get depth() {
      return depth
    },
    get maxDepth() {
      return maxDepth
    },
  }
}

// Minimal DOM so the glass scratch canvas and the media registry can load.
globalThis.window = globalThis
if (!globalThis.navigator) Object.defineProperty(globalThis, 'navigator', { value: { onLine: true, userAgent: 'node' }, configurable: true })
globalThis.requestAnimationFrame = (cb) => setTimeout(() => cb(Date.now()), 16)
globalThis.cancelAnimationFrame = clearTimeout
globalThis.CSS = { supports: () => false }
globalThis.document = {
  createElement: (tag) => {
    if (tag !== 'canvas') return { style: {}, setAttribute() {}, appendChild() {} }
    const el = { width: 0, height: 0, style: {} }
    el.getContext = () => makeCtx(el.width || 1, el.height || 1).ctx
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
      export { emptyStudioDoc, defaultGlassClip, defaultTextClip } from './src/lib/studio/doc'
      export { TRANSITIONS, TEXT_ANIMATIONS } from './src/lib/studio/transitions'
      export { STUDIO_BACKGROUNDS } from './src/lib/studio/backgrounds'
      export { GLASS_PRESETS } from './src/lib/glass'
      export { parseVoiceCommand } from './src/lib/voice'
    `,
    resolveDir: root,
    sourcefile: 'check.ts',
    loader: 'ts',
  },
})

const mod = await import(`file://${tmp}?t=${Date.now()}`)
await rm(tmp, { force: true })

const W = 480
const H = 270
const failures = []
let checks = 0

function render(label, clips, times = [0, 0.25, 0.5, 0.9]) {
  const doc = { ...mod.emptyStudioDoc(), clips }
  for (const t of times) {
    const rec = makeCtx(W, H)
    checks += 1
    try {
      mod.drawStudioFrame(rec.ctx, doc, t, W, H, { media: () => null, overlay: () => null })
    } catch (err) {
      failures.push(`${label} @${t}s threw: ${err.message}`)
      continue
    }
    if (rec.depth !== 0) failures.push(`${label} @${t}s left ${rec.depth} unbalanced save()`)
    if (rec.calls.length < 3) failures.push(`${label} @${t}s painted almost nothing (${rec.calls.length} calls)`)
  }
}

// 1. Backgrounds — every preset must paint on the canvas.
for (const bg of mod.STUDIO_BACKGROUNDS) {
  render(`background:${bg.id}`, [
    {
      id: `bg-${bg.id}`, kind: 'background', track: 0, startSec: 0, durationSec: 2,
      name: bg.name, transitionIn: 'none', transitionOut: 'none', opacity: 1, backgroundId: bg.id,
    },
  ], [0, 1.2])
}

// 2. Transitions — on a text clip so there is always something to blend.
for (const transition of mod.TRANSITIONS) {
  const text = { ...mod.defaultTextClip(0, 1), transitionIn: transition.id, transitionOut: transition.id === 'none' ? 'none' : 'fade' }
  render(`transition:${transition.id}`, [text], [0, 0.1, 1, 2.9])
}

// 3. Text animations.
for (const anim of mod.TEXT_ANIMATIONS) {
  render(`anim:${anim.id}`, [{ ...mod.defaultTextClip(0, 1), anim: anim.id }], [0, 0.15, 1.5, 2.8])
}

// 4. Glass clips — every preset, both shapes, every motion.
for (const preset of mod.GLASS_PRESETS) {
  for (const shape of ['panel', 'lens']) {
    for (const motion of ['static', 'sweep', 'drift', 'pop']) {
      const clip = { ...mod.defaultGlassClip(0, 1, preset.id, shape), motion, label: 'Cupric' }
      render(`glass:${preset.id}/${shape}/${motion}`, [clip], [0, 0.4, 2.2])
    }
  }
}

// 5. A stacked composition: background + video-less media clip + text + glass.
render('stack', [
  { id: 'b', kind: 'background', track: 0, startSec: 0, durationSec: 4, name: 'bg', transitionIn: 'fade', transitionOut: 'fade', opacity: 1, backgroundId: 'mesh-lagoon' },
  { ...mod.defaultTextClip(0.5, 1), transitionIn: 'glass-wipe' },
  { ...mod.defaultGlassClip(1, 2, 'liquid', 'lens'), motion: 'sweep' },
], [0, 0.6, 1.4, 3.2])

// 6. Voice grammar — the parser is pure, so assert the contract directly.
const voiceCases = [
  ['play', 'play'],
  ['hey cupric, pause', 'pause'],
  ['go to 12 seconds', 'seek-to'],
  ['forward five', 'nudge'],
  ['back 2 secs', 'nudge'],
  ['cut here', 'split'],
  ['add text hello world', 'add-text'],
  ['add background aurora', 'add-background'],
  ['add glass lens', 'add-glass'],
  ['transition liquid dissolve', 'set-transition'],
  ['zoom out', 'zoom'],
  ['unmute', 'mute'],
  ['export', 'export'],
  ['make me a sandwich', null],
]
for (const [phrase, expected] of voiceCases) {
  checks += 1
  const got = mod.parseVoiceCommand(phrase)
  const type = got?.type ?? null
  if (type !== expected) failures.push(`voice: "${phrase}" → ${type}, expected ${expected}`)
}
// The seconds must survive parsing, not just the command type.
if (mod.parseVoiceCommand('go to 12 seconds')?.seconds !== 12) failures.push('voice: "go to 12 seconds" lost its number')
if (mod.parseVoiceCommand('back 2 secs')?.seconds !== -2) failures.push('voice: "back 2 secs" should be negative')
if (mod.parseVoiceCommand('add text hello world')?.text !== 'hello world') failures.push('voice: add-text lost its wording')

if (failures.length) {
  console.error(`\n${failures.length} failure(s) out of ${checks} checks:`)
  for (const f of failures) console.error(`  ✗ ${f}`)
  process.exit(1)
}
console.log(`renderer check passed — ${checks} frames/assertions, ${mod.STUDIO_BACKGROUNDS.length} backgrounds, ${mod.TRANSITIONS.length} transitions, ${mod.TEXT_ANIMATIONS.length} animations, ${mod.GLASS_PRESETS.length} glass presets`)
