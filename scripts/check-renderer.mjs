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
import { fileURLToPath, pathToFileURL } from 'node:url'

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
      export { drawStudioFrame, clampToSafeArea, SAFE_MARGIN, gradeFilter } from './src/lib/studio/renderer'
      export { audioGainAt } from './src/lib/studio/doc'
      export { lintStudioDoc } from './src/lib/studio/lint'
      export { validateEditingPlan } from './src/lib/editingPlan'
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

// pathToFileURL, not a `file://` concat: a Windows path like C:\a\b.mjs is
// not a valid URL and the release build runs on windows-latest.
const mod = await import(`${pathToFileURL(tmp).href}?t=${Date.now()}`)
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

// 7. Title-safe margin — text must never render into the outer 5% of frame.
{
  const W = 1080
  const H = 1920
  const m = mod.SAFE_MARGIN
  const cases = [
    { label: 'centre, far left', x: 0, y: H / 2, bw: 400, bh: 120, align: 'center' },
    { label: 'centre, far right', x: W, y: H / 2, bw: 400, bh: 120, align: 'center' },
    { label: 'above the top', x: W / 2, y: -50, bw: 400, bh: 120, align: 'center' },
    { label: 'below the bottom', x: W / 2, y: H + 200, bw: 400, bh: 120, align: 'center' },
    { label: 'left-aligned at the edge', x: 0, y: H / 2, bw: 500, bh: 100, align: 'left' },
    { label: 'right-aligned at the edge', x: W, y: H / 2, bw: 500, bh: 100, align: 'right' },
    { label: 'already safe stays put', x: W / 2, y: H / 2, bw: 300, bh: 80, align: 'center' },
  ]
  for (const c of cases) {
    checks += 1
    const out = mod.clampToSafeArea(c.x, c.y, c.bw, c.bh, c.align, W, H)
    const left = c.align === 'left' ? out.x : c.align === 'right' ? out.x - c.bw : out.x - c.bw / 2
    const top = out.y - c.bh / 2
    const eps = 0.001
    if (left < W * m - eps || left + c.bw > W * (1 - m) + eps) failures.push(`safe-area: ${c.label} → x ${left.toFixed(1)}..${(left + c.bw).toFixed(1)} escapes the margin`)
    if (top < H * m - eps || top + c.bh > H * (1 - m) + eps) failures.push(`safe-area: ${c.label} → y ${top.toFixed(1)}..${(top + c.bh).toFixed(1)} escapes the margin`)
  }
  // A block wider than the safe area centres rather than jamming one edge.
  checks += 1
  const wide = mod.clampToSafeArea(50, H / 2, W, 100, 'center', W, H)
  if (Math.abs(wide.x - W / 2) > 0.001) failures.push('safe-area: an over-wide block should centre')
}

// 8. Audio gain envelope — the number the export loop feeds the gain node.
{
  const clip = { kind: 'audio', startSec: 2, durationSec: 8, volume: 0.8, fadeInSec: 1, fadeOutSec: 2 }
  const at = (t) => mod.audioGainAt(clip, t)
  const near = (label, got, want) => {
    checks += 1
    if (Math.abs(got - want) > 0.0005) failures.push(`audio gain: ${label} → ${got}, expected ${want}`)
  }
  near('before the clip', at(1.99), 0)
  near('at the very start', at(2), 0)
  near('half way through the fade in', at(2.5), 0.4)
  near('fade in complete', at(3), 0.8)
  near('steady middle', at(6), 0.8)
  near('half way through the fade out', at(9), 0.4)
  near('at the last instant', at(10), 0)
  near('after the clip', at(10.5), 0)
  // A muted clip stays muted through the whole envelope.
  checks += 1
  const muted = { ...clip, volume: 0 }
  if ([2.5, 6, 9].some((t) => mod.audioGainAt(muted, t) !== 0)) failures.push('audio gain: a muted clip leaked signal')
  // Overlapping fades on a short clip must never exceed the clip volume.
  checks += 1
  const short = { kind: 'audio', startSec: 0, durationSec: 1, volume: 1, fadeInSec: 2, fadeOutSec: 2 }
  for (let t = 0; t < 1; t += 0.05) {
    if (mod.audioGainAt(short, t) > 1.0001) { failures.push('audio gain: overlapping fades exceeded unity'); break }
  }
}

// 9. Colour grade — the filter string handed to the canvas.
{
  const eq = (label, got, want) => {
    checks += 1
    if (got !== want) failures.push(`grade: ${label} → "${got}", expected "${want}"`)
  }
  eq('no nodes', mod.gradeFilter(null), '')
  eq('empty chain', mod.gradeFilter([]), '')
  eq('untouched nodes cost nothing', mod.gradeFilter([
    { id: 'balance', enabled: true, exposure: 0, temperature: 0 },
    { id: 'contrast', enabled: true, contrast: 0, fade: 0 },
    { id: 'look', enabled: true, saturation: 0, hue: 0 },
  ]), '')
  eq('a disabled node is skipped', mod.gradeFilter([{ id: 'look', enabled: false, saturation: 80, hue: 0 }]), '')
  eq('exposure', mod.gradeFilter([{ id: 'balance', enabled: true, exposure: 20, temperature: 0 }]), 'brightness(1.2000)')
  eq('contrast', mod.gradeFilter([{ id: 'contrast', enabled: true, contrast: 50, fade: 0 }]), 'contrast(1.5000)')
  eq('saturation', mod.gradeFilter([{ id: 'look', enabled: true, saturation: -100, hue: 0 }]), 'saturate(0.0000)')
  checks += 1
  const warm = mod.gradeFilter([{ id: 'balance', enabled: true, exposure: 0, temperature: 60 }])
  const cool = mod.gradeFilter([{ id: 'balance', enabled: true, exposure: 0, temperature: -60 }])
  if (warm === cool || !warm.includes('sepia') || !cool.includes('hue-rotate(175deg)')) failures.push('grade: warm and cool must differ')
  // Node order is the chain order: balance, then contrast, then look.
  checks += 1
  const chain = mod.gradeFilter([
    { id: 'balance', enabled: true, exposure: 10, temperature: 0 },
    { id: 'contrast', enabled: true, contrast: 10, fade: 0 },
    { id: 'look', enabled: true, saturation: 10, hue: 0 },
  ])
  if (!/^brightness.*contrast.*saturate/.test(chain)) failures.push(`grade: chain out of order → ${chain}`)
}

// 10. Rotation and masks must not leak transform or composite state.
{
  const doc = mod.emptyStudioDoc('9:16')
  const text = mod.defaultTextClip(0, 1)
  doc.clips = [
    { ...text, rotation: 30 },
    { ...mod.defaultTextClip(0, 2), mask: { shape: 'ellipse', x: 0.1, y: 0.1, w: 0.8, h: 0.8, featherPct: 4, invert: false, threshold: 0.5, softness: 0.2 } },
    { ...mod.defaultTextClip(0, 0), mask: { shape: 'luma', x: 0, y: 0, w: 1, h: 1, featherPct: 0, invert: true, threshold: 0.4, softness: 0.3 } },
    { ...mod.defaultGlassClip(0, 1), rotation: -15, grade: [{ id: 'look', enabled: true, saturation: 40, hue: 10 }] },
  ]
  for (const t of [0, 0.5, 1.2]) {
    checks += 1
    const probe = makeCtx(1080, 1920)
    mod.drawStudioFrame(probe.ctx, doc, t, 1080, 1920, { media: () => null, overlay: () => null })
    if (probe.depth !== 0) failures.push(`rotation/mask: unbalanced save/restore at t=${t} (depth ${probe.depth})`)
    if (probe.ctx.globalCompositeOperation !== 'source-over') failures.push(`rotation/mask: composite op left as ${probe.ctx.globalCompositeOperation} at t=${t}`)
    if (probe.ctx.filter !== 'none') failures.push(`rotation/mask: filter left as ${probe.ctx.filter} at t=${t}`)
  }
}

// 11. Document checks — the warnings shown next to Export.
{
  const has = (issues, prefix) => issues.some((i) => i.id.startsWith(prefix))
  const doc = mod.emptyStudioDoc('9:16')
  const clean = { ...mod.defaultTextClip(0, 1), text: 'Readable headline', x: 0.5, y: 0.5, fontSizePct: 8 }
  doc.clips = [clean]
  checks += 1
  if (mod.lintStudioDoc(doc).length) failures.push(`lint: a clean document should be silent, got ${JSON.stringify(mod.lintStudioDoc(doc))}`)

  checks += 1
  doc.clips = [{ ...clean, x: 0.02 }]
  if (!has(mod.lintStudioDoc(doc), 'safe:')) failures.push('lint: text in the outer margin was not flagged')

  checks += 1
  doc.clips = [{ ...clean, fontSizePct: 2 }]
  if (!has(mod.lintStudioDoc(doc), 'tiny:')) failures.push('lint: unreadable text size was not flagged')

  checks += 1
  doc.clips = [clean, { ...mod.defaultTextClip(0, 1), id: 'second', text: 'Readable headline', x: 0.5, y: 0.5, fontSizePct: 8 }]
  if (!has(mod.lintStudioDoc(doc), 'collide:')) failures.push('lint: two overlapping captions were not flagged')

  checks += 1
  doc.clips = [clean, { ...mod.defaultTextClip(0, 2), id: 'other-track', text: 'Readable headline', x: 0.5, y: 0.5, fontSizePct: 8 }]
  if (has(mod.lintStudioDoc(doc), 'collide:')) failures.push('lint: clips on different tracks must not count as a collision')

  checks += 1
  doc.clips = [{ ...clean, startSec: 3 }]
  if (!has(mod.lintStudioDoc(doc), 'gap:')) failures.push('lint: a hole at the head of the timeline was not flagged')

  checks += 1
  doc.clips = [{ ...clean, mask: { shape: 'rect', x: 0.5, y: 0.5, w: 0.001, h: 0.001, featherPct: 0, invert: false, threshold: 0.5, softness: 0.2 } }]
  if (!has(mod.lintStudioDoc(doc), 'mask-empty:')) failures.push('lint: an all-but-empty mask was not flagged')

  checks += 1
  doc.clips = [{ ...clean, kind: 'sticker', stickerId: 'custom', json: 'not json', x: 0.5, y: 0.5, scale: 1, loop: true, speed: 1 }]
  if (!has(mod.lintStudioDoc(doc), 'sticker:')) failures.push('lint: an unreadable imported sticker was not flagged')

  // Every message reads as a sentence, because these are shown to a person.
  checks += 1
  doc.clips = [{ ...clean, x: 0.02, fontSizePct: 2 }]
  for (const issue of mod.lintStudioDoc(doc)) {
    if (!/[.!?]$/.test(issue.message) || /undefined|NaN|\[object/.test(issue.message)) {
      failures.push(`lint: unhelpful message "${issue.message}"`)
    }
  }
}

// 12. Editing plan validator — captions share a layer, so overlap is an error.
{
  const plan = (captions) => ({
    schemaVersion: '1.0',
    targetDurationSec: 20,
    aspect: '9:16',
    fps: 30,
    captions: { enabled: true, mode: 'phrase', maxWords: 6 },
    sections: [{ id: 's1', role: 'hook', clips: [{ id: 'c1', sourceFile: 'a.mp4', inSec: 0, outSec: 5, purpose: 'hook', transition: 'hard_cut', captions }] }],
  })
  checks += 1
  if (mod.validateEditingPlan(plan([{ text: 'one', start: 0, end: 2 }, { text: 'two', start: 2, end: 4 }])).length) {
    failures.push('plan: sequential captions should validate')
  }
  checks += 1
  if (!mod.validateEditingPlan(plan([{ text: 'one', start: 0, end: 3 }, { text: 'two', start: 2, end: 4 }])).some((i) => /overlap/i.test(i.message))) {
    failures.push('plan: overlapping captions were not caught')
  }
  checks += 1
  if (!mod.validateEditingPlan(plan([{ text: 'one', start: 0, end: 9 }])).some((i) => /past the end/.test(i.message))) {
    failures.push('plan: a caption outliving its clip was not caught')
  }
}

if (failures.length) {
  console.error(`\n${failures.length} failure(s) out of ${checks} checks:`)
  for (const f of failures) console.error(`  ✗ ${f}`)
  process.exit(1)
}
console.log(`renderer check passed — ${checks} frames/assertions, ${mod.STUDIO_BACKGROUNDS.length} backgrounds, ${mod.TRANSITIONS.length} transitions, ${mod.TEXT_ANIMATIONS.length} animations, ${mod.GLASS_PRESETS.length} glass presets`)
