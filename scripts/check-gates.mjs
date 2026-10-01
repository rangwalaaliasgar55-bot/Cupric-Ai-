#!/usr/bin/env node
/**
 * check:gates — the delivery gates, executed for real.
 *
 * The gates are the part of the pipeline that must not be optimistic: they
 * decide whether a render is good enough to hand over, and a gate that passes
 * everything is worse than no gate at all. This check runs the whole chain
 * against frames and PCM built here, so each rule has a failing case and a
 * passing one:
 *
 *   wcag       the contrast maths and the large-text thresholds
 *   sample     the colour behind a block, read from a rendered frame
 *   verdict    sliding-window policy: one bad second fails the element
 *   fixes      recolor and scrim, and which one is least visible
 *   textLayout the box a clip occupies, which the gates measure
 *   timing     when things are drawn: reveals past the end, short delay lists,
 *              out-of-order delays, long holds, late reveals, overlapping blocks
 *   runGates   lint → timing → safezones → contrast → deliver, stopping at the first error
 */
import assert from 'node:assert/strict'
import { readFileSync, rmSync } from 'node:fs'
import path from 'node:path'
import { build } from 'esbuild'

// Minimal DOM: `gateRunner` renders through the real `drawStudioFrame`, which
// touches a canvas element and a couple of browser globals even when every draw
// lands on a stub.
globalThis.window = globalThis
if (!globalThis.navigator) Object.defineProperty(globalThis, 'navigator', { value: { onLine: true, userAgent: 'node' }, configurable: true })
globalThis.requestAnimationFrame = (cb) => setTimeout(() => cb(Date.now()), 16)
globalThis.cancelAnimationFrame = clearTimeout
globalThis.CSS = { supports: () => false }
const CANVAS_FILL = { r: 255, g: 255, b: 255, a: 255 }
/**
 * A canvas that records nothing and paints one solid colour, so the audit's
 * pixel path can be driven end to end without a browser.
 */
function auditCanvas(width, height, fill = CANVAS_FILL) {
  const px = new Uint8ClampedArray(width * height * 4)
  for (let i = 0; i < px.length; i += 4) { px[i] = fill.r; px[i + 1] = fill.g; px[i + 2] = fill.b; px[i + 3] = fill.a }
  const store = {
    canvas: { width, height, style: {} },
    getImageData: () => ({ data: px, width, height }),
    measureText: (text) => ({ width: String(text).length * 8 }),
    createLinearGradient: () => ({ addColorStop() {} }),
    createRadialGradient: () => ({ addColorStop() {} }),
    createPattern: () => null,
  }
  const ctx = new Proxy(store, {
    get: (target, key) => {
      if (key in target) return target[key]
      const noop = () => ({ addColorStop() {} })
      target[key] = noop
      return noop
    },
    set: (target, key, value) => {
      target[key] = value
      return true
    },
  })
  return { width, height, style: {}, getContext: () => ctx, toDataURL: () => 'data:image/png;base64,' }
}
globalThis.document = {
  createElement: (tag) => (tag !== 'canvas' ? { style: {}, setAttribute() {}, appendChild() {} } : auditCanvas(1, 1)),
}

const root = process.cwd()
const out = path.join(root, 'node_modules', '.cache', 'newbrand-check-gates.mjs')
rmSync(out, { force: true })
await build({
  stdin: {
    contents: [
      "export * as g from './src/lib/studio/gates'",
      "export * as sz from './src/lib/studio/safeZone'",
      "export * as tl from './src/lib/studio/textLayout'",
      "export * as doc from './src/lib/studio/doc'",
      "export * as gr from './src/lib/studio/gateRunner'",
    ].join('\n'),
    resolveDir: root,
    loader: 'ts',
  },
  bundle: true,
  format: 'esm',
  platform: 'neutral',
  mainFields: ['module', 'main'],
  loader: { '.css': 'empty', '.svg': 'dataurl', '.json': 'json' },
  outfile: out,
  logLevel: 'silent',
})
const m = await import(`file://${out}`)

let n = 0
const ok = (cond, label) => { assert.ok(cond, `FAIL: ${label}`); n++ }
const eq = (a, b, label) => { assert.equal(a, b, `FAIL: ${label}`); n++ }
const near = (a, b, tol, label) => { assert.ok(Math.abs(a - b) <= tol, `FAIL: ${label} (${a} vs ${b})`); n++ }
const deep = (a, b, label) => { assert.deepEqual(a, b, `FAIL: ${label}`); n++ }

/** The measurement calls the layout makes, and nothing else. */
function stubCtx() {
  const ctx = {
    font: '400 16px Inter',
    save() {}, restore() {},
    measureText(text) {
      const px = Number(/(\d+(?:\.\d+)?)px/.exec(ctx.font)?.[1] ?? 16)
      return { width: px * 0.55 * text.length }
    },
  }
  return ctx
}

/** A solid frame, so the ring sampler has something to read. */
function fillFrame(width, height, rgb, alpha = 255) {
  const rgba = new Uint8ClampedArray(width * height * 4)
  for (let i = 0; i < rgba.length; i += 4) {
    rgba[i] = rgb[0]; rgba[i + 1] = rgb[1]; rgba[i + 2] = rgb[2]; rgba[i + 3] = alpha
  }
  return rgba
}

/* ── 1. WCAG maths and thresholds ─────────────────────────────────── */
{
  const white = m.g.parseHex('#FFFFFF')
  const black = m.g.parseHex('#000000')
  eq(m.g.contrastRatio(white, black), 21, 'white on black is 21:1')
  eq(m.g.contrastRatio(black, white), 21, 'contrast is symmetric')
  eq(m.g.contrastRatio(white, white), 1, 'a colour against itself is 1:1')
  eq(m.g.parseHex('not a colour'), null, 'a nonsense colour is rejected, not guessed')
  eq(m.g.toHex({ r: 255, g: 0, b: 0 }), '#FF0000', 'rgb → hex round-trips')
  near(m.g.relativeLuminance({ r: 128, g: 128, b: 128 }), 0.2158, 0.001, 'mid grey luminance matches WCAG')

  eq(m.g.isLargeText(24, 400), true, '24px is large text')
  eq(m.g.isLargeText(18.66, 700), true, '18.66px bold is large text')
  eq(m.g.isLargeText(18.66, 400), false, '18.66px regular is not')
  eq(m.g.thresholdFor('AA', 24, 400), 3, 'AA large text needs 3:1')
  eq(m.g.thresholdFor('AA', 16, 400), 4.5, 'AA body text needs 4.5:1')
  eq(m.g.thresholdFor('AAA', 16, 400), 7, 'AAA body text needs 7:1')
  eq(m.g.thresholdFor('AAA', 30, 800), 4.5, 'AAA large text needs 4.5:1')

  // Compositing is how a scrim is judged: a plate over footage, not a colour swap.
  const half = m.g.composite(m.g.parseHex('#000000'), 0.5, m.g.parseHex('#FFFFFF'))
  near(half.r, 128, 1, 'a 50% black plate over white is mid grey')
  const ink = m.g.composite(m.g.parseHex('#FFFFFF'), 0.5, m.g.parseHex('#000000'))
  near(ink.r, 128, 1, 'a 50% white ink over black is mid grey')
  const hsl = m.g.rgbToHsl(m.g.parseHex('#C8F542'))
  eq(m.g.toHex(m.g.hslToRgb(hsl)), '#C8F542', 'hsl → rgb round-trips (which is how recolor keeps the hue)')
}

/* ── 2. the colour behind a block ─────────────────────────────────── */
{
  const width = 200
  const height = 200
  const rgba = fillFrame(width, height, [255, 255, 255])
  // A black band down the middle, the way a lower-third plate would sit.
  for (let y = 0; y < height; y++) {
    for (let x = 80; x < 120; x++) {
      const i = (y * width + x) * 4
      rgba[i] = 0; rgba[i + 1] = 0; rgba[i + 2] = 0
    }
  }
  const overBand = m.g.sampleBackground(rgba, width, height, { x: 100, y: 100, w: 30, h: 20 })
  const darkest = overBand.reduce((a, b) => (a.color.r <= b.color.r ? a : b))
  ok(darkest.color.r < 20, 'the ring sampler sees the dark band behind the box')
  ok(overBand.reduce((sum, c) => sum + c.weight, 0) > 0.99, 'cluster weights are normalised')

  const overWhite = m.g.sampleBackground(rgba, width, height, { x: 30, y: 30, w: 20, h: 20 })
  ok(overWhite[0].color.r > 235, 'a block over plain white samples white')
  ok(overWhite.length <= 6, 'no more than six clusters survive — a report cannot list 400 colours')

  const transparent = fillFrame(width, height, [255, 255, 255], 0)
  const empty = m.g.sampleBackground(transparent, width, height, { x: 100, y: 100, w: 20, h: 20 })
  eq(empty.length, 1, 'a fully transparent frame yields one placeholder cluster rather than nothing')
}

/* ── 3. the sliding-window verdict ────────────────────────────────── */
{
  // A grey whose contrast against white ink is the ratio we asked for, so the
  // samples in this test are defined by the number the gate judges.
  const srgb = (l) => (l <= 0.0031308 ? l * 12.92 : 1.055 * Math.pow(l, 1 / 2.4) - 0.055)
  const greyFor = (ratio) => {
    const v = Math.round(255 * srgb(Math.max(0, Math.min(1, 1.05 / ratio - 0.05))))
    return { r: v, g: v, b: v }
  }
  const at = (tSec, ratio, over = {}) => ({
    clipId: 'title',
    tSec,
    coverage: 1,
    inks: [{ hex: '#FFFFFF', alpha: 1 }],
    fontSizePx: 16,
    fontWeight: 400,
    clusters: [{ color: greyFor(ratio), weight: 1 }],
    ...over,
  })

  const clean = m.g.judgeElement([at(0, 21), at(0.2, 21), at(0.4, 6)])
  eq(clean.passes, true, 'a block that clears the bar in every window passes')
  near(clean.worstRatio, 6, 0.2, 'the verdict reports the worst ratio, not the average')

  // One second of failure in four: the element fails, because a caption a viewer
  // cannot read for a second is a caption they did not read.
  const brief = m.g.judgeElement([at(0, 12), at(0.2, 12), at(2, 12), at(2.2, 1.2), at(2.4, 1.2), at(4, 12), at(4.2, 12)])
  eq(brief.passes, false, 'one bad second fails the whole element')
  ok(brief.windows.some((w) => !w.passes), 'and the report names which window failed')
  eq(brief.threshold, 4.5, 'the threshold comes from the font size, not from a constant')

  eq(m.g.judgeElement([at(0, 3.4)]).passes, false, '3.4:1 fails body text')
  eq(m.g.judgeElement([at(0, 3.4, { fontSizePx: 32 })]).passes, true, 'the same ratio passes at large text — the rule is the size, not the colour')
  eq(m.g.judgeElement([]), null, 'no samples is no verdict')
}

/* ── 4. the fixes, and which one is least visible ─────────────────── */
{
  const white = [{ color: { r: 255, g: 255, b: 255 }, weight: 1 }]
  const recolor = m.g.recolorFix(white, '#FFFFFF', 4.5)
  ok(recolor !== null, 'white ink on white gets a recolor')
  eq(recolor.kind, 'recolor', 'the fix names its kind')
  ok(recolor.guaranteedRatio >= 4.5, 'the recolour is measured against every cluster, not assumed')
  const inkAfter = m.g.parseHex(recolor.color)
  ok(m.g.contrastRatio(inkAfter, { r: 255, g: 255, b: 255 }) >= 4.5, 'and it really does pass')
  const hslBefore = m.g.rgbToHsl(m.g.parseHex('#3B82F6'))
  const preserved = m.g.recolorFix([{ color: { r: 0, g: 0, b: 0 }, weight: 1 }], '#3B82F6', 4.5)
  near(abs(m.g.rgbToHsl(m.g.parseHex(preserved.color)).h - hslBefore.h), 0, 6, 'the hue survives the recolour')

  const scrim = m.g.scrimFix(white, '#FFFFFF', 4.5)
  ok(scrim !== null && scrim.kind === 'scrim', 'a plate is available when a recolour cannot work')
  ok(scrim.plateAlpha > 0 && scrim.plateAlpha <= 1, 'the plate alpha is a real alpha')
  const behind = m.g.composite(m.g.parseHex(scrim.color), scrim.plateAlpha, { r: 255, g: 255, b: 255 })
  ok(m.g.contrastRatio({ r: 255, g: 255, b: 255 }, behind) >= 4.5, 'the plate really lifts the ink over the bar')

  const impossible = m.g.recolorFix([], '#FFFFFF', 4.5)
  eq(impossible, null, 'no clusters means no fix promised')

  const samples = [
    { clipId: 't', tSec: 0, coverage: 1, inks: [{ hex: '#DDDDDD', alpha: 1 }], fontSizePx: 16, fontWeight: 400, clusters: [{ color: { r: 250, g: 250, b: 250 }, weight: 1 }] },
  ]
  const chosen = m.g.recommendFix(samples, 'AA')
  eq(chosen.kind, 'recolor', 'the least visible fix that passes wins: a small ink change beats a plate over the footage')
  ok(m.g.recommendFix([], 'AA') === null, 'nothing to fix is null, never a guess')

  function abs(n) { return Math.abs(n) }
}

/* ── 5. safe zones and the box the gates measure ──────────────────── */
{
  const zone = m.sz.safeZoneFor('9:16')
  near(zone.x0, 0.06, 1e-9, '9:16 keeps 6% on the left')
  near(zone.y0, 0.11, 1e-9, '9:16 keeps 11% at the top for platform chrome')
  near(zone.y1, 0.83, 1e-9, 'and 17% at the bottom')
  near(m.sz.safeZoneFor('16:9').x0, 0.06, 1e-9, 'a landscape frame is a plain inset')
  near(m.sz.safeZoneFor('1:1').x0, 0.05, 1e-9, 'a square keeps a touch less')
  const [cw, ch] = m.sz.canvasForAspect('9:16')
  eq(cw, 1080, 'the vertical canvas is 1080 wide')
  eq(ch, 1920, 'and 1920 tall')

  ok(m.sz.insideZone({ x: 0.5, y: 0.5, w: 0.2, h: 0.1 }, zone), 'a centred block is inside the zone')
  ok(!m.sz.insideZone({ x: 0.5, y: 0.95, w: 0.2, h: 0.06 }, zone), 'a block at the very bottom is not')
  const over = m.sz.overflowOf({ x: 0.5, y: 0.95, w: 0.2, h: 0.06 }, zone)
  near(over.bottom, 0.15, 0.001, 'the overflow says how far under the bottom it reaches')
  eq(over.left, 0, 'and says nothing about edges that are fine')
  eq(m.sz.overflowOf({ x: 0.5, y: 0.5, w: 0.2, h: 0.1 }, zone).bottom, 0, 'a block inside reports no overflow')
  eq(m.sz.insetsOf(zone).bottom.toFixed(2), '0.17', 'insets are the zone flipped, for the design engine')

  const ctx = stubCtx()
  const clip = { ...m.doc.defaultTextClip(0, 0), id: 'title', text: 'STOP SCROLLING', fontSizePct: 6, x: 0.5, y: 0.5 }
  const centred = m.tl.textBox(ctx, clip, 1080, 1920)
  near(centred.x, 540, 1, 'a centred block measures from the centre of the frame')
  near(centred.y, 960, 1, 'vertically too')
  eq(centred.fontSizePx, (6 / 100) * 1920, 'the measured size is the painted size')
  eq(centred.rich, false, 'plain text is not rich text')
  ok(centred.w > 0 && centred.h > 0, 'the box has a real size')
  deep(m.tl.captionPreset(null), { uppercase: false, stroke: 0, shadow: 0, boxed: false }, 'no preset means no decoration')
  eq(m.tl.captionPreset('hormozi').uppercase, true, 'the hormozi preset uppercases')

  // Off-centre: the measured box is where the renderer would paint it, clamped.
  const off = m.tl.textBox(ctx, { ...clip, x: 0.01, y: 0.98 }, 1080, 1920)
  ok(off.x - off.w / 2 >= 1080 * m.tl.SAFE_MARGIN - 0.001, 'the box is pulled inside the title-safe margin, as painted')
  ok(off.y + off.h / 2 <= 1920 * (1 - m.tl.SAFE_MARGIN) + 0.001, 'and off the bottom edge')

  const rich = m.tl.textBox(ctx, { ...clip, text: 'Stop ==scrolling==', emphasisColor: '#C8F542' }, 1080, 1920)
  eq(rich.rich, true, 'markup is detected')
  ok(rich.colors.includes('#C8F542'), 'the gate is told about the emphasis colour too, not just the base ink')
}

/* ── 6. the chain, end to end ─────────────────────────────────────── */
{
  const ctx = stubCtx()
  const width = 1080
  const height = 1920
  const makeDoc = (over = {}) => {
    const doc = m.doc.emptyStudioDoc()
    doc.clips = [{ ...m.doc.defaultTextClip(0, 0), id: 'title', name: 'Title card', text: 'STOP SCROLLING', fontSizePct: 6, x: 0.5, y: 0.5, color: '#000000', ...over }]
    return doc
  }
  const framesWith = (doc, rgba) => [{ tSec: 0, width, height, rgba, boxes: [m.tl.textBox(ctx, doc.clips[0], width, height)] }]

  const white = fillFrame(width, height, [255, 255, 255])
  const black = fillFrame(width, height, [0, 0, 0])

  // Pass: black ink on white, inside the zone, no delivery facts to argue about.
  const good = makeDoc()
  const pass = m.g.runGates({ doc: good, frames: framesWith(good, white) })
  eq(pass.ok, true, 'a clean composition passes the chain')
  eq(pass.stoppedAt, null, 'and nothing stopped it')
  eq(pass.ran.map((r) => r.gate).join(','), 'lint,timing,safezones,contrast,deliver', 'every gate ran, in order')
  eq(pass.contrast.elements.length, 1, 'the contrast gate judged the one text block')
  ok(pass.summary.includes('Passed'), 'the summary says so in words')

  // Fail: white ink on white. This is the check that must never pass silently.
  const bad = makeDoc({ color: '#FFFFFF' })
  const fail = m.g.runGates({ doc: bad, frames: framesWith(bad, white) })
  eq(fail.ok, false, 'white on white fails')
  eq(fail.stoppedAt, 'contrast', 'and the chain stops AT the gate that failed')
  ok(!fail.ran.some((r) => r.gate === 'deliver'), 'later gates do not run after an error — a report names one cause, not five symptoms')
  const finding = fail.findings.find((f) => f.gate === 'contrast')
  ok(finding && finding.severity === 'error', 'the finding is an error, not a warning')
  ok(finding.message.includes(`required ${fail.contrast.elements[0].threshold}:1`), 'the message carries the threshold the reader needs')
  eq(fail.contrast.elements[0].threshold, 3, 'large type is held to the large-text bar, and the report says which')
  ok(finding.fix && finding.fix.patch.color, 'and a one-click fix')
  ok(/Use #/.test(finding.fix.label), 'whose label says what it will do')

  // The fix actually fixes: apply it and re-run the chain.
  const fixed = m.g.applyGateFixes(bad, fail.findings)
  eq(fixed.applied, 1, 'one clip was patched')
  ok(fixed.doc.clips[0].color !== '#FFFFFF', 'the clip ink changed')
  const after = m.g.runGates({ doc: fixed.doc, frames: framesWith(fixed.doc, white) })
  eq(after.ok, true, 'the reported fix really does clear the gate')
  eq(m.g.applyGateFixes(bad, []).applied, 0, 'a report with no fixes changes nothing')

  // A block dragged over the platform chrome is a warning, not a stop.
  const low = makeDoc({ y: 0.97 })
  const dragged = m.g.runGates({ doc: low, frames: framesWith(low, white) })
  const zoneFinding = dragged.findings.find((f) => f.gate === 'safezones')
  ok(zoneFinding !== undefined, 'a block under the bottom chrome is reported')
  eq(zoneFinding.severity, 'warning', 'as a warning: it is legible, just covered')
  ok(zoneFinding.fix.patch.y < 0.9, 'and the fix moves it up')

  // Delivery: the numbers only the encoder knows.
  const dark = makeDoc({ color: '#FFFFFF' }) // white on black: passes contrast, so the chain reaches delivery
  const deliver = m.g.runGates({
    doc: dark,
    frames: framesWith(dark, black),
    delivery: {
      file: 'out.mp4', durationSec: 12, width, height, fps: 30, hasAudio: true,
      loudness: { integratedLufs: -9.4, truePeakDb: 0.4, rangeLu: 9 },
      sync: [{ tSec: 0, offsetFrames: 0 }, { tSec: 4, offsetFrames: 3 }],
      findings: ['HandBrake re-encoded the intermediate'],
    },
  })
  eq(deliver.ok, false, 'a clipped true peak and three frames of drift fail delivery')
  ok(deliver.findings.some((f) => f.id === 'deliver:loudness'), 'loudness off target is reported')
  ok(deliver.findings.some((f) => f.id === 'deliver:truepeak' && f.severity === 'error'), 'a true peak over the ceiling is an error')
  ok(deliver.findings.some((f) => f.id === 'deliver:sync'), 'picture slip is reported')
  ok(deliver.findings.some((f) => f.id.startsWith('deliver:HandBrake')), 'the encoder’s own notes ride along')

  const silent = m.g.runGates({
    doc: good,
    frames: framesWith(good, white),
    delivery: { file: 'out.mp4', durationSec: 5, width, height, fps: 30, hasAudio: false, loudness: null, sync: [], findings: [] },
  })
  ok(silent.findings.some((f) => f.id === 'deliver:silent' && f.severity === 'warning'), 'a silent file warns instead of failing a type-led piece')

  // Skipping and budgeting are both explicit.
  const skipped = m.g.runGates({ doc: bad, frames: framesWith(bad, white), skip: ['contrast'] })
  ok(!skipped.ran.some((r) => r.gate === 'contrast'), 'a skipped gate does not run')
  eq(skipped.ok, true, 'so the failure it would have found is not invented')

  const rushed = m.g.runGates({ doc: good, frames: framesWith(good, white), budgetMs: 0 })
  eq(rushed.stoppedAt, 'lint', 'a budget of zero gives the chain no time and it stops at the first gate')
  ok(rushed.findings.some((f) => f.id === 'lint:budget'), 'and says the budget, not the composition, was the problem')
  eq(rushed.ran.length, 0, 'no gate is half-run when the budget is gone')

  // The correction ledger: two cycles, then the third failure is reported.
  const ledger = {}
  eq(m.g.recordFailure(ledger, 'contrast'), 1, 'the first failure is counted')
  eq(m.g.recordFailure(ledger, 'contrast'), 2, 'the second too')
  eq(m.g.budgetLine('contrast', 2), null, 'two corrections are within budget')
  eq(m.g.recordFailure(ledger, 'contrast'), 3, 'the third is counted as well')
  ok(m.g.budgetLine('contrast', 3) !== null, 'and the budget line says to stop correcting')
  ok(/failure 3/.test(m.g.budgetLine('contrast', 3)), 'naming the count')
  m.g.clearGate(ledger, 'contrast')
  eq(ledger.contrast, undefined, 'a clean pass clears the count')
}

/* ── 7. the audit the Studio button runs ──────────────────────────── */
{
  eq(m.gr.auditSize('9:16', 540).join('x'), '540x960', 'a vertical audit frame is half preview size')
  eq(m.gr.auditSize('16:9', 540).join('x'), '960x540', 'and a landscape one is the same size the other way up')
  ok(m.gr.auditSize('9:16', 541).every((d) => d % 2 === 0), 'audit dimensions are always even (encoders insist)')

  const doc = m.doc.emptyStudioDoc()
  doc.clips = [
    { ...m.doc.defaultTextClip(0, 0), id: 'cap', name: 'Caption', durationSec: 2, color: '#FFFFFF', fontSizePct: 5 },
    { ...m.doc.defaultTextClip(5, 0), id: 'cta', name: 'CTA', durationSec: 2, color: '#FFFFFF', fontSizePct: 5 },
  ]
  const times = m.gr.auditTimes(doc, { fps: 1, maxFrames: 24 })
  ok(times.includes(0), 'the audit looks at the start of the edit')
  ok(times.includes(1), 'and at each second of it')
  ok(times.includes(6), 'it looks at the midpoint of every text block, wherever the block sits')
  ok(times.length <= 24, 'and it never exceeds the frame cap')
  ok(times.every((t, i) => i === 0 || t > times[i - 1]), 'times are sorted and deduplicated')
  eq(m.gr.auditTimes(m.doc.emptyStudioDoc()).length, 0, 'an empty document has no times to audit')

  // White ink over the stub's white frame: the whole chain must run and fail at
  // contrast, with a fix that clears it.
  const canvas = auditCanvas(540, 960)
  const { report, frames } = m.gr.runStudioAudit(doc, { canvas, fps: 1, maxFrames: 12, hasMedia: () => true })
  ok(frames.length > 1, 'the audit rendered a spread of frames')
  eq(frames[0].width, 540, 'the frame carries its own size, so the report can be checked against it')
  ok(frames.every((f) => f.rgba.length === f.width * f.height * 4), 'every frame carries pixels')
  ok(frames.some((f) => f.boxes.length > 0), 'the audit measured the box each text block occupies')
  eq(report.ok, false, 'white on white cannot pass an audit')
  eq(report.stoppedAt, 'contrast', 'and the report says which gate stopped it')
  const fixIt = report.findings.find((f) => f.gate === 'contrast' && f.clipId === 'cap')
  ok(fixIt && fixIt.fix, 'the audit proposes a measured fix')
  const { doc: fixed, applied } = m.gr.applyAuditFixes(doc, report)
  eq(applied, 2, 'fix all patches every failing block in one edit')
  ok(fixed.clips.every((c) => c.color !== '#FFFFFF'), 'and the document really changed')
  eq(m.gr.applyAuditFixes(fixed, report).applied, 2, 'applying again is idempotent for the same findings')
  ok(/contrast/.test(m.gr.describeAudit(report)), 'the one-line summary names what it measured')

  // Without a DOM at all (a headless caller), the chain still runs and is honest
  // about having seen nothing rather than inventing a pass.
  const saved = globalThis.document
  delete globalThis.document
  const blind = m.gr.runStudioAudit(doc, { hasMedia: () => true })
  eq(blind.frames.length, 0, 'no canvas, no frames')
  eq(blind.report.contrast.sampled, 0, 'and no contrast samples, so nothing is claimed')
  globalThis.document = saved
}

/* ── 8. timing: the gate for what is drawn at the wrong time ──────── */
{
  const width = 1080
  const height = 1920
  const ctx = stubCtx()
  const makeTimed = (over = {}) => {
    const doc = m.doc.emptyStudioDoc()
    doc.clips = [{ ...m.doc.defaultTextClip(0, 0), id: 'cap', name: 'Caption', text: 'one two three', durationSec: 2, color: '#000000', wordDelaysMs: [0, 400, 800], ...over }]
    return doc
  }
  const frameFor = (doc, t = 0) => [{ tSec: t, width, height, rgba: fillFrame(width, height, [255, 255, 255]), boxes: [m.tl.textBox(ctx, doc.clips[0], width, height)] }]

  const clean = makeTimed()
  eq(m.g.timingGate(clean).length, 0, 'a caption whose words fit inside it raises nothing')
  const cleanReport = m.g.runGates({ doc: clean, frames: frameFor(clean) })
  ok(cleanReport.ran.some((r) => r.gate === 'timing' && r.ok), 'the chain runs the timing gate')
  eq(cleanReport.timing.blocks, 1, 'and reports how many timed blocks it judged')
  eq(cleanReport.timing.passes, true, 'with the verdict in the report')

  // A word revealed after the block ends is never seen: an error, with a fix.
  const past = makeTimed({ durationSec: 0.5, wordDelaysMs: [0, 200, 900] })
  const pastFindings = m.g.timingGate(past)
  const reveal = pastFindings.find((f) => f.id === 'timing:reveal-past-end')
  ok(reveal && reveal.severity === 'error', 'a word revealed after the block ends is an error')
  ok(/never seen/.test(reveal.message), 'and the message says what the viewer loses')
  ok(pastFindings.every((f) => f.clipId === 'cap'), 'the finding names the block to change')
  const patched = m.g.applyGateFixes(past, pastFindings)
  ok(patched.applied >= 1, 'the fix applies as a document edit')
  eq(m.g.timingGate(patched.doc).some((f) => f.id === 'timing:reveal-past-end'), false, 'and clears the error it proposed')

  // Fewer delays than words: the renderer stops revealing at the list's end.
  const missing = m.g.timingGate(makeTimed({ text: 'one two three four', wordDelaysMs: [0, 200, 400] })).find((f) => f.id === 'timing:missing-delays')
  ok(missing && missing.severity === 'error', 'a short delay list is an error: the trailing words never appear')
  eq(missing.detail.words, 4, 'the finding carries the word count it compared against')
  ok(m.g.timingGate(makeTimed({ wordDelaysMs: [0, 700, 300] })).some((f) => f.id === 'timing:delay-order'), 'out-of-order delays are reported')

  const held = m.g.timingGate(makeTimed({ durationSec: 8, wordDelaysMs: [0, 200, 400] })).find((f) => f.id === 'timing:hold')
  ok(held && held.severity === 'warning' && held.fix, 'a long hold is a warning with a trim')
  const late = m.g.timingGate(makeTimed({ durationSec: 6, wordDelaysMs: [3000, 3400, 3800] })).find((f) => f.id === 'timing:late-reveal')
  ok(late, 'a block that sits up for three seconds before its first word is reported')
  eq(late.fix, undefined, 'and it proposes no fix: shortening a lead-in is a decision')

  // Two blocks on one track sharing screen time.
  const clash = m.doc.emptyStudioDoc()
  clash.clips = [
    { ...m.doc.defaultTextClip(0, 0), id: 'a', name: 'First', text: 'hello', durationSec: 3, color: '#000000', wordDelaysMs: [0, 300] },
    { ...m.doc.defaultTextClip(2, 0), id: 'b', name: 'Second', text: 'world', durationSec: 2, color: '#000000' },
  ]
  const overlap = m.g.timingGate(clash).find((f) => f.id === 'timing:overlap')
  ok(overlap && overlap.clipId === 'a', 'overlapping blocks are reported against the earlier one')
  eq(overlap.detail.other, 'Second', 'and name the block it clashes with')
  const trimmed = m.g.applyGateFixes(clash, m.g.timingGate(clash))
  eq(trimmed.doc.clips.find((c) => c.id === 'a').durationSec, 2, 'the fix trims the earlier block to where the later one starts')

  // An untimed block is left to the other gates, and the gate can be skipped.
  eq(m.g.timingGate(makeTimed({ wordDelaysMs: null })).length, 0, 'a block with no word timings is not judged here')
  eq(m.g.runGates({ doc: makeTimed(), frames: frameFor(makeTimed()), skip: ['timing'] }).ran.some((r) => r.gate === 'timing'), false, 'and it can be skipped like any other gate')

  // The audit looks at the moments things change — clip edges and word reveals —
  // because a fault that only exists at a seam survives an even sweep.
  const timedDoc = makeTimed({ durationSec: 4, wordDelaysMs: [0, 2500] })
  const times = m.gr.auditTimes(timedDoc, { fps: 1, maxFrames: 24 })
  ok(times.includes(0), 'the audit keeps the start of the edit')
  ok(times.includes(2.5), 'it looks at the moment a word is revealed')
  ok(times.includes(4), 'and at the clip’s own end, where a fault has nowhere to hide')
}

/* ── 9. the fix proves itself: re-measure, do not trust the arithmetic ─ */
{
  const width = 1080
  const height = 1920
  const ctx = stubCtx()
  const canvas = auditCanvas(540, 960)
  const makeDoc = (over = {}) => {
    const doc = m.doc.emptyStudioDoc()
    doc.clips = [{ ...m.doc.defaultTextClip(0, 0), id: 'cap', name: 'Caption', text: 'STOP SCROLLING', fontSizePct: 6, color: '#FFFFFF', ...over }]
    return doc
  }
  const opts = { canvas, fps: 1, maxFrames: 8, hasMedia: () => true }

  // White ink on the stub's white frame: the chain stops at contrast, with a fix.
  const bad = makeDoc()
  const first = m.gr.runStudioAudit(bad, opts).report
  eq(first.ok, false, 'the first audit fails')
  const proposed = m.gr.proposedFixes(first)
  ok(proposed.length >= 1, 'and it proposes at least one fix')
  ok(proposed.every((f) => f.clipId && f.fix), 'every proposed fix names a clip and a patch')

  const { doc: fixed } = m.gr.applyAuditFixes(bad, first)
  const check = m.gr.verifyAppliedFixes(first, fixed, opts)
  eq(check.proposed, proposed.length, 'the verification counts the same proposals')
  eq(check.unresolved.length, 0, 'the fix holds: nothing it proposed is still failing')
  eq(check.appeared.length, 0, 'and it introduced no new error')
  ok(check.ok, 'so the verification passes')
  ok(/held/.test(check.summary), `and the summary says so in words (${check.summary})`)
  eq(check.cleared.length, proposed.length, 'and counts each cleared finding')
  eq(check.after.ok, true, 'the second report is clean')

  // A patch that does not actually fix anything must NOT be reported as an
  // improvement — that is the whole point (upstream's `after` describes the
  // treatments, and says nothing about what landed).
  const pretend = {
    ...first,
    findings: first.findings.map((f) => (f.fix ? { ...f, fix: { ...f.fix, patch: { color: '#FFFFFE' } } } : f)),
  }
  const { doc: barely } = m.gr.applyAuditFixes(bad, pretend)
  const honest = m.gr.verifyAppliedFixes(pretend, barely, opts)
  ok(!honest.ok, 'a fix that does not clear its finding is not called a success')
  ok(honest.unresolved.length >= 1, 'the finding it failed to clear is named')
  ok(/did not/.test(honest.summary), `and the summary says how many did not (${honest.summary})`)
  ok(honest.unresolved[0].clipId === 'cap', 'against the clip that is still failing')

  // A report with no fix proposals has nothing to verify, and says that.
  const clean = m.gr.runStudioAudit(makeDoc({ color: '#000000' }), opts).report
  const none = m.gr.verifyAppliedFixes(clean, makeDoc({ color: '#000000' }), opts)
  eq(none.proposed, 0, 'a clean report proposes nothing')
  ok(/nothing to verify/.test(none.summary), 'and the verification says there was nothing to check')

  // Studio asks for this after every "Fix all", and reports honestly when the
  // recheck itself cannot run.
  const studio = readFileSync(path.join(root, 'src/screens/Studio.tsx'), 'utf8')
  ok(/verifyAppliedFixes\(audit\.report, fixed/.test(studio), 'Studio re-measures the document it just patched')
  ok(/could not be re-checked/.test(studio), 'and admits it when the recheck could not run, instead of claiming a pass')
  ok(/did not hold/.test(studio), 'the log line names the case where an applied fix did not hold')
}

console.log(`gates check passed — ${n} assertions`)
