#!/usr/bin/env node
/**
 * check:home-videos — the six Home_X styles and the nine kit clip kinds.
 *
 * Bundles the REAL planner, kit and Studio renderer (esbuild) and proves:
 *  1. all 6 styles plan offline with placeholder data, in 16:9 and 9:16;
 *  2. every frame renders through drawStudioFrame without throwing, issues
 *     paint calls and keeps save/restore balanced (zero "Uncaught");
 *  3. determinism: the same frame drawn twice issues byte-identical calls;
 *  4. every kit kind × variant draws, including reduced motion;
 *  5. no invented figures: with no user stats/prices/ratings the plan holds
 *     no digits in stat/price/rating fields (placeholders only);
 *  6. no network fonts in the kit, no Math.random/Date.now/performance.now;
 *  7. export dims are even for 16:9 and 9:16 (electron targetSizeForAspect);
 *  8. agent ops: addKit/buildHomeVideo validate strictly, unknown op names
 *     and unknown kits are rejected, the plan applies atomically;
 *  9. optional real MP4 encode when NEWBRAND_FFMPEG_PATH and @napi-rs/canvas
 *     are available (skipped with a message otherwise — never faked).
 */
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { readFile, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const tmp = path.join(root, '.home-videos-check.mjs')

function makeCtx(width, height) {
  const calls = []
  let depth = 0
  let paints = 0
  const gradient = { addColorStop: (...a) => calls.push(['stop', ...a]) }
  const state = {}
  const ctx = new Proxy({}, {
    get(_, k) {
      if (k === 'canvas') return { width, height }
      if (k === 'save') return () => { depth++; calls.push(['save']) }
      if (k === 'restore') return () => { depth--; if (depth < 0) throw new Error('restore without save'); calls.push(['restore']) }
      if (k === 'measureText') return (s) => ({ width: String(s).length * 8, actualBoundingBoxAscent: 8, actualBoundingBoxDescent: 2 })
      if (k === 'createLinearGradient' || k === 'createRadialGradient' || k === 'createConicGradient') return (...a) => { calls.push([k, ...a.map((v) => Math.round(v * 1000) / 1000)]); return gradient }
      if (k === 'createPattern') return () => null
      if (k === 'getImageData') return (x, y, w, h) => ({ data: new Uint8ClampedArray(Math.max(1, w * h * 4)), width: w, height: h })
      if (k === 'getTransform') return () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 })
      if (k === 'isPointInPath') return () => false
      if (k in state) return state[k]
      if (['globalAlpha'].includes(k)) return 1
      if (typeof k === 'string' && /^[a-z]/.test(k) && !['fillStyle', 'strokeStyle', 'font', 'filter', 'lineWidth', 'textAlign', 'textBaseline', 'globalCompositeOperation', 'shadowColor', 'shadowBlur', 'lineJoin', 'lineCap', 'direction', 'letterSpacing', 'imageSmoothingEnabled', 'imageSmoothingQuality', 'miterLimit', 'lineDashOffset', 'shadowOffsetX', 'shadowOffsetY', 'fontKerning', 'wordSpacing'].includes(k)) {
        return (...a) => {
          if (/^(fill|stroke|drawImage|fillRect|strokeRect|fillText|strokeText|clearRect|putImageData)/.test(k)) paints++
          calls.push([k, ...a.map((v) => (typeof v === 'number' ? Math.round(v * 1000) / 1000 : typeof v === 'string' ? v : typeof v))])
        }
      }
      return undefined
    },
    set(_, k, v) { state[k] = v; calls.push(['set', k, typeof v === 'number' ? Math.round(v * 1000) / 1000 : typeof v === 'string' ? v : 'obj']); return true },
  })
  return { ctx, calls, get depth() { return depth }, get paints() { return paints } }
}

// Minimal DOM so shared renderer modules load headlessly.
globalThis.window = globalThis
if (!globalThis.navigator) Object.defineProperty(globalThis, 'navigator', { value: { onLine: true, userAgent: 'node' }, configurable: true })
globalThis.requestAnimationFrame = (cb) => setTimeout(() => cb(0), 16)
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

let uncaught = 0
process.on('uncaughtException', (e) => { uncaught++; process.exitCode = 1; console.error('Uncaught', e) })

await build({
  bundle: true,
  outfile: tmp,
  format: 'esm',
  platform: 'neutral',
  mainFields: ['module', 'main'],
  logLevel: 'warning',
  loader: { '.css': 'empty', '.svg': 'dataurl', '.json': 'json', '.png': 'dataurl', '.woff2': 'empty', '.woff': 'empty' },
  stdin: {
    contents: `
      export { drawStudioFrame } from './src/lib/studio/renderer'
      export { HOME_STYLES, planHomeVideo, acceptBroll } from './src/lib/studio/homeVideos'
      export { KIT_KINDS, drawKit, normaliseKit, tickNumber, pillRuns, stackLayout, VIDEO_TOKENS } from './src/lib/studio/homeKit'
      export { validateStudioEditPlan, applyStudioEditPlan, localStudioEditPlan } from './src/lib/studio/editOps'
    `,
    resolveDir: root,
    sourcefile: 'home-videos-entry.ts',
    loader: 'ts',
  },
})

let m
try {
  m = await import(`${pathToFileURL(tmp).href}?v=1`)
} finally {
  await rm(tmp, { force: true })
}

const emptyDoc = (aspect) => ({ aspect, fps: 30, backgroundId: 'lime-void', clips: [], trackCount: 3 })
const sources = { media: () => null, overlay: () => null }
let frames = 0

function renderAll(doc, W, H, label) {
  const end = doc.clips.reduce((a, c) => Math.max(a, c.startSec + c.durationSec), 0)
  const steps = 24
  for (let i = 0; i <= steps; i++) {
    const t = (end * i) / steps
    const rec = makeCtx(W, H)
    try {
      m.drawStudioFrame(rec.ctx, doc, t, W, H, sources)
    } catch (err) {
      throw new Error(`${label} @${t.toFixed(2)}s threw: ${err?.stack || err}`)
    }
    assert.equal(rec.depth, 0, `${label} @${t.toFixed(2)}s leaves save/restore unbalanced`)
    assert.ok(rec.paints > 0, `${label} @${t.toFixed(2)}s painted nothing`)
    frames++
  }
  // Determinism: same frame twice → identical call streams.
  const t = end * 0.37
  const a = makeCtx(W, H), b = makeCtx(W, H)
  m.drawStudioFrame(a.ctx, doc, t, W, H, sources)
  m.drawStudioFrame(b.ctx, doc, t, W, H, sources)
  assert.equal(JSON.stringify(a.calls), JSON.stringify(b.calls), `${label}: frame is not deterministic`)
}

// 1–3. Six styles, two aspects, placeholder data only.
assert.equal(m.HOME_STYLES.length, 6)
for (const style of m.HOME_STYLES) {
  for (const [aspect, W, H] of [['16:9', 640, 360], ['9:16', 360, 640]]) {
    const plan = m.planHomeVideo(emptyDoc(aspect), style.id, {})
    assert.ok(plan.clips.length >= 4, `${style.id} ${aspect}: too few clips`)
    const end = plan.clips.reduce((a, c) => Math.max(a, c.startSec + c.durationSec), 0)
    assert.ok(Math.abs(end - style.durationSec) < 0.05, `${style.id}: runs ${end}s, expected ${style.durationSec}s`)
    assert.ok(plan.doc.trackCount <= 24)
    assert.equal(new Set(plan.clips.map((c) => c.id)).size, plan.clips.length, `${style.id}: duplicate ids`)
    // Planner is pure: same input → same output.
    assert.equal(JSON.stringify(m.planHomeVideo(emptyDoc(aspect), style.id, {}).clips), JSON.stringify(plan.clips), `${style.id}: planner not deterministic`)
    // 5. No invented figures without user data.
    for (const c of plan.clips.filter((c) => c.kind === 'kit')) {
      if (c.kit === 'stat-card') assert.ok(!/\d/.test(c.title ?? '') && !/\d/.test(c.items?.[0] ?? ''), `${style.id}: stat/price card invented a number (${c.title} ${c.items?.[0]})`)
      if (c.kit === 'rating-bars') assert.ok((c.values ?? []).every((v) => v === 0), `${style.id}: rating bars invented scores`)
      if (c.kit === 'checkout-card') assert.ok(!(c.items ?? []).some((s) => /\d/.test(s)), `${style.id}: checkout invented a price`)
    }
    renderAll(plan.doc, W, H, `${style.id} ${aspect}`)
  }
}
// Plans append after existing work and never overlap it.
{
  const base = m.planHomeVideo(emptyDoc('16:9'), 'red-pill', {}).doc
  const next = m.planHomeVideo(base, 'dark-3d', {})
  assert.ok(next.startSec >= 25 - 0.01, 'second style starts after the first ends')
  assert.equal(next.doc.clips.length, base.clips.length + next.clips.length)
}
// User data flows through (and only then do digits appear).
{
  const plan = m.planHomeVideo(emptyDoc('16:9'), 'launch-stats', { stats: [{ value: '$400M', label: 'Raised' }, { value: '12', label: 'Retailers' }] })
  const cards = plan.clips.filter((c) => c.kind === 'kit' && c.kit === 'stat-card')
  assert.equal(cards[0].title, '$400M')
  assert.equal(cards[1].title, '12')
  assert.equal(cards[2].title, '—', 'missing stats stay placeholders')
}
// Footage fills photo slots in timeline order; the rest stay empty slots.
{
  const doc = { ...emptyDoc('16:9'), clips: [{ id: 'v1', kind: 'image', track: 0, startSec: 0, durationSec: 2, name: 'a', transitionIn: 'none', transitionOut: 'none', opacity: 1, mediaId: 'm1', fileName: 'desk.jpg', localPath: null, trimInSec: 0, sourceDurationSec: 2, speed: 1, volume: 1, fit: 'cover' }] }
  const plan = m.planHomeVideo(doc, 'launch-stats', {})
  const stack = plan.clips.find((c) => c.kind === 'kit' && c.kit === 'image-stack')
  assert.equal(stack.media[0]?.fileName, 'desk.jpg')
  assert.equal(stack.media[1], null)
  assert.ok(plan.emptySlots >= 1)
  const withB = m.acceptBroll(plan.doc, plan.broll[0])
  assert.equal(withB.clips.length, plan.doc.clips.length + 1, 'accepting one suggestion adds exactly one slot')
}

// 4. Every kit kind × variant, normal and reduced motion.
for (const k of m.KIT_KINDS) {
  for (const variant of k.variants) {
    for (const reducedMotion of [false, true]) {
      const clip = m.normaliseKit({ id: 'k', kit: k.id, variant, startSec: 0, durationSec: 3, reducedMotion, title: 'connect [with] over [+]', items: ['A', 'B', 'C'], values: [50, 80, 14], media: [null, null] })
      for (const t of [0, 0.1, 1, 2.9]) {
        const rec = makeCtx(640, 360)
        m.drawKit(rec.ctx, clip, t, 640, 360, () => null)
        assert.equal(rec.depth, 0, `${k.id}/${variant} unbalanced`)
        assert.ok(rec.paints > 0, `${k.id}/${variant} painted nothing at ${t}s`)
      }
    }
  }
}
assert.equal(m.KIT_KINDS.length, 9)
assert.deepEqual(m.pillRuns('connect [with] over [+]').map((r) => r.pill), [false, true, false, true])
assert.equal(m.tickNumber('$400M', 0.5), '$200M')
assert.equal(m.tickNumber('¥22,800', 1), '¥22,800')
assert.equal(m.tickNumber('Add your number', 0.5), 'Add your number')
for (let n = 1; n <= 8; n++) for (const cell of m.stackLayout(n, 7, 800, 500)) {
  assert.ok(cell.x - cell.w / 2 >= -0.5 && cell.x + cell.w / 2 <= 800.5, `stack of ${n} leaves bounds`)
  assert.ok(Math.abs(cell.rot) <= 5, 'rotation within bounds')
}

// 6. Static source rules.
for (const file of ['src/lib/studio/homeKit.ts', 'src/lib/studio/homeVideos.ts']) {
  const src = await readFile(path.join(root, file), 'utf8')
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
  assert.ok(!/Math\.random|Date\.now|performance\.now|new Date\(/.test(code), `${file} uses a clock or unseeded RNG`)
  assert.ok(!/https?:\/\/|url\(|@import|fonts\.googleapis/.test(code), `${file} references a network font/resource`)
}
// Tokens mirror @theme.
{
  const css = await readFile(path.join(root, 'src/styles.css'), 'utf8')
  for (const [name, hex] of Object.entries(m.VIDEO_TOKENS)) {
    const re = new RegExp(`--color-video-${name}:\\s*(#[0-9a-f]{6})`, 'i')
    assert.equal(css.match(re)?.[1]?.toUpperCase(), hex, `--color-video-${name} drifted from VIDEO_TOKENS`)
  }
}

// 7. Even export dims.
{
  const src = await readFile(path.join(root, 'electron/main.cjs'), 'utf8')
  const evenInt = src.match(/function evenInt\([\s\S]*?\n}/)?.[0]
  const target = src.match(/function targetSizeForAspect\([\s\S]*?\n}/)?.[0]
  const ctx = {}
  vm.runInNewContext(`${evenInt}\n${target}\nthis.f = targetSizeForAspect`, ctx)
  for (const a of ['16:9', '9:16']) {
    const s = ctx.f(a)
    assert.ok(s.width % 2 === 0 && s.height % 2 === 0, `${a} export dims must be even (${s.width}x${s.height})`)
  }
}

// 8. Agent ops.
{
  const doc = emptyDoc('16:9')
  assert.throws(() => m.validateStudioEditPlan({ ops: [{ type: 'teleportClip' }] }, doc), /unsupported type/)
  assert.throws(() => m.validateStudioEditPlan({ ops: [{ type: 'addKit', kit: 'hologram', startSec: 0, durationSec: 2 }] }, doc), /Unknown kit/)
  assert.throws(() => m.validateStudioEditPlan({ ops: [{ type: 'addKit', kit: 'pill-text', variant: 'wavy', startSec: 0, durationSec: 2 }] }, doc), /no look/)
  assert.throws(() => m.validateStudioEditPlan({ ops: [{ type: 'addKit', kit: 'pill-text', startSec: 0, durationSec: 2, accent: '#123456' }] }, doc), /token/)
  assert.throws(() => m.validateStudioEditPlan({ ops: [{ type: 'buildHomeVideo', style: 'vaporwave' }] }, doc), /Unknown style/)
  const plan = m.validateStudioEditPlan({ summary: 's', ops: [
    { type: 'buildHomeVideo', style: 'red-pill', fill: { headline: 'connect with anyone', pillWords: ['with'], stats: [{ value: '999', label: 'fake' }] } },
    { type: 'addKit', kit: 'stat-card', startSec: 1, durationSec: 2, title: 'Add your number' },
    { type: 'bogus' },
  ] }, doc)
  assert.equal(plan.ops.length, 2, 'unknown op dropped, valid ops kept')
  assert.match(plan.warning ?? '', /Skipped 1/)
  assert.ok(!('stats' in plan.ops[0].fill), 'model-supplied numbers are stripped')
  const before = JSON.stringify(doc)
  const next = m.applyStudioEditPlan(doc, plan.ops)
  assert.equal(JSON.stringify(doc), before, 'apply is pure (atomic: the caller commits one undo step)')
  assert.ok(next.clips.some((c) => c.kind === 'kit' && c.kit === 'pill-text' && /\[with\]/.test(c.title)), 'pill words wrapped')
  // Local "emphasize … as pills" plan.
  const t = { id: 't1', kind: 'text', track: 1, startSec: 0, durationSec: 3, name: 'T', transitionIn: 'none', transitionOut: 'none', opacity: 1, text: 'connect with anyone over chat', fontSizePct: 8, fontFamily: 'Inter Variable', color: '#F4F1EA', weight: 800, align: 'center', x: 0.5, y: 0.5, anim: 'none', captionStyle: null, highlightWord: null }
  const withText = { ...doc, clips: [t] }
  const local = m.localStudioEditPlan('emphasize with, chat as pills', withText, 't1')
  const applied = m.applyStudioEditPlan(withText, m.validateStudioEditPlan(local, withText).ops)
  const pill = applied.clips.find((c) => c.kind === 'kit')
  assert.equal(pill.title, 'connect [with] anyone over [chat]')
  assert.ok(!applied.clips.some((c) => c.id === 't1'), 'original text replaced in the same plan')
  const built = m.localStudioEditPlan('build the dark 3d explainer', doc, null)
  assert.equal(built.ops[0].style, 'dark-3d')
}

// 9. Optional real MP4 encode.
{
  const ffmpeg = process.env.NEWBRAND_FFMPEG_PATH
  let Canvas = null
  try { Canvas = createRequire(import.meta.url)('@napi-rs/canvas') } catch { /* optional */ }
  if (ffmpeg && existsSync(ffmpeg) && Canvas) {
    for (const [aspect, W, H] of [['16:9', 640, 360], ['9:16', 360, 640]]) {
      const plan = m.planHomeVideo(emptyDoc(aspect), 'red-pill', {})
      const fps = 30, n = 30
      const buf = Buffer.alloc(W * H * 4 * n)
      const canvas = Canvas.createCanvas(W, H)
      const ctx = canvas.getContext('2d')
      for (let i = 0; i < n; i++) {
        ctx.clearRect(0, 0, W, H)
        m.drawStudioFrame(ctx, plan.doc, i / fps, W, H, sources)
        Buffer.from(ctx.getImageData(0, 0, W, H).data.buffer).copy(buf, i * W * H * 4)
      }
      const out = path.join(root, `.home-video-${aspect.replace(':', 'x')}.mp4`)
      const r = spawnSync(ffmpeg, ['-y', '-v', 'error', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${W}x${H}`, '-r', String(fps), '-i', '-', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', out], { input: buf })
      assert.equal(r.status, 0, `ffmpeg failed: ${r.stderr}`)
      const probe = spawnSync(ffmpeg, ['-v', 'error', '-i', out, '-f', 'null', '-'])
      assert.equal(probe.status, 0, `MP4 does not decode: ${probe.stderr}`)
      await rm(out, { force: true })
    }
    console.log('  real MP4 encode: 16:9 + 9:16 valid')
  } else {
    console.log('  real MP4 encode skipped — set NEWBRAND_FFMPEG_PATH and install @napi-rs/canvas to encode for real')
  }
}

assert.equal(uncaught, 0, 'zero Uncaught')
console.log(`home-videos check passed — 6 styles × 2 aspects, ${frames} frames, 9 kit kinds, agent ops strict`)
