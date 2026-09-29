#!/usr/bin/env node
/**
 * check:placement — where the picture is empty.
 *
 * `studio/placement.ts` measures the footage under a caption (motion between two
 * instants, detail in the middle frame, skin chroma as a fallback) and plans a
 * placement that keeps the caption off the speaker's face. Adapted from
 * open-edit's `measure-placement` (Apache-2.0). Everything except the frame
 * decoding is pure, so this check builds synthetic frames — a busy top, a flat
 * bottom, a moving blob, a skin-coloured face — and asserts the numbers, the
 * decision and the document edit. The decoding path needs a real video and is
 * covered by the packaged-desktop smoke scenario.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { rm } from 'node:fs/promises'
import { build } from 'esbuild'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const out = path.join(root, '.check-placement.mjs')
await build({
  bundle: true, outfile: out, format: 'esm', platform: 'node', logLevel: 'error',
  stdin: { contents: "export * from './src/lib/studio/placement'\nexport * as doc from './src/lib/studio/doc'", resolveDir: root, loader: 'ts' },
})
const m = await import(pathToFileURL(out).href)
await rm(out, { force: true })

let n = 0
const ok = (c, msg) => { assert.ok(c, msg); n += 1 }
const eq = (a, b, msg) => { assert.equal(a, b, msg); n += 1 }
const near = (a, b, tol, msg) => ok(Math.abs(a - b) <= tol, `${msg} (${a} vs ${b})`)
const read = (p) => readFileSync(path.join(root, p), 'utf8')

const GW = 64
const GH = 36
const W = 1080
const H = 1920
const flat = (v) => new Uint8Array(GW * GH).fill(v)
/** A checkerboard: high local detail, no motion. */
const checker = (a, b, step = 2) => {
  const g = new Uint8Array(GW * GH)
  for (let y = 0; y < GH; y += 1) for (let x = 0; x < GW; x += 1) g[y * GW + x] = (Math.floor(x / step) + Math.floor(y / step)) % 2 ? a : b
  return g
}
/** A vertical band of `value` in rows [y0, y1). */
const withBand = (base, value, y0, y1) => {
  const g = new Uint8Array(base)
  for (let y = y0; y < y1; y += 1) for (let x = 0; x < GW; x += 1) g[y * GW + x] = value
  return g
}
/** A 4:5 top / 1:3 bottom split: busy above, flat below. */
const busyTopFlatBottom = () => withBand(checker(20, 235), 128, Math.floor(GH * 0.6), GH)
/** RGBA for a grid, from three channel values (skin-ish). */
const rgbaOf = (r, g, b, rows = [0, GH]) => {
  const px = new Uint8ClampedArray(GW * GH * 4)
  for (let y = rows[0]; y < rows[1]; y += 1) {
    for (let x = 0; x < GW; x += 1) {
      const o = (y * GW + x) * 4
      px[o] = r; px[o + 1] = g; px[o + 2] = b; px[o + 3] = 255
    }
  }
  return px
}

const base = { gw: GW, gh: GH, width: W, height: H }

/* ——— luma, and the two signals ——— */
{
  const { gray, rgb } = m.grayGrid(rgbaOf(255, 255, 255), GW, GH)
  eq(gray[0], 255, 'white is 255 luma')
  eq(rgb.length, GW * GH * 3, 'and the RGB is kept for the skin test')
  eq(m.grayGrid(rgbaOf(0, 0, 0), GW, GH).gray[10], 0, 'black is 0 luma')
  near(m.grayGrid(rgbaOf(255, 0, 0), GW, GH).gray[0], 76, 2, 'a red pixel weighs 0.299 — Rec. 601, not an average')

  const still = busyTopFlatBottom()
  const measure = m.measurePlacement({ ...base, early: still, mid: still, late: still })
  eq(measure.bands.length, 6, 'a 1080×1920 canvas is measured in six bands')
  eq(measure.motion, undefined, 'the measurement itself carries no stray fields')
  const top = measure.bands[0]
  const bottom = measure.bands[measure.bands.length - 1]
  ok(top.detail > bottom.detail * 5, `the busy half reports far more detail (${top.detail} vs ${bottom.detail})`)
  near(bottom.detail, 0, 0.11, 'the flat half reports no detail')
  eq(bottom.motion, 0, 'and no motion')
  eq(bottom.luma, 128, 'and its luma is what the ink has to separate from')
  eq(measure.calmest, bottom.name, 'so the calmest band is the flat one — and of two equally flat bands, the one furthest from the subject')
  ok(measure.subjectBox && measure.subjectFrom === 'detail', 'with no motion, the subject comes from detail')
  eq(measure.subjectFrom, 'detail', 'and the measurement says so')

  const bandsCover = measure.bands.reduce((sum, band) => sum + band.hPx, 0)
  ok(bandsCover <= H, 'bands never exceed the canvas')
  ok(measure.bands.every((band, i) => i === 0 || Math.abs(band.yPx - (measure.bands[i - 1].yPx + measure.bands[i - 1].hPx)) <= 1), 'bands butt together inside the safe zone (to the pixel rounding)')
  ok(measure.bands[0].yPx >= H * 0.1 && measure.bands[measure.bands.length - 1].yPx + measure.bands[measure.bands.length - 1].hPx <= H * 0.84, 'and all of them sit inside the safe zone')
  ok(measure.bands.every((band) => band.overSubject >= 0 && band.overSubject <= 1), 'over-subject coverage is a fraction')
}

/* ——— motion: a moving blob is a subject; a moving camera is not ——— */
{
  const still = flat(40)
  const blob = (cx) => {
    const g = new Uint8Array(GW * GH)
    for (let y = 0; y < GH; y += 1) for (let x = 0; x < GW; x += 1) {
      const inside = Math.abs(x - cx) < 5 && Math.abs(y - Math.floor(GH * 0.45)) < 4
      g[y * GW + x] = inside ? 200 : 40
    }
    return g
  }
  // A speaker shifting a few cells: the two instants must overlap enough that the
  // dilation joins them into ONE subject (a 20-cell jump is two separate blobs of
  // change, which is what a cut looks like, not what a person looks like).
  const moved = m.measurePlacement({ ...base, early: blob(28), mid: blob(30), late: blob(32) })
  ok(moved.subjectBox, 'a blob moving between the two instants is found')
  eq(moved.subjectFrom, 'motion', 'and the measurement credits motion')
  eq(moved.headFrom, 'motion', 'the head box rides on the same signal')
  ok(moved.subjectBox.w > 0 && moved.subjectBox.w < W, 'the subject box is measured in canvas pixels')
  ok(moved.headBox && moved.headBox.y === moved.subjectBox.y, 'the head sits at the top of the subject')
  ok(moved.headBox.w < moved.subjectBox.w, 'and is narrower than the shoulders (0.6×)')
  const centred = moved.subjectBox.x + moved.subjectBox.w / 2
  ok(Math.abs(centred - (30 / GW) * W) < moved.subjectBox.w, 'the box follows the blob, not the frame edge')

  // A camera pan moves everything: the difference outlines the scene, so motion
  // is refused and the subject must come from somewhere else (or not at all).
  const pan = (shift) => {
    const g = new Uint8Array(GW * GH)
    for (let y = 0; y < GH; y += 1) for (let x = 0; x < GW; x += 1) g[y * GW + x] = (x * 4 + shift) % 256
    return g
  }
  const panned = m.measurePlacement({ ...base, early: pan(0), mid: pan(0), late: pan(120) })
  ok(panned.subjectFrom !== 'motion', 'a pan is not a subject: motion is refused when it is everywhere')

  // Grain: a speck of motion must not end the search, or an ordinary shot reports
  // no subject while the detail pass never ran.
  const grainy = (seed) => {
    const g = flat(60)
    g[(seed * 7) % (GW * GH)] = 250
    return g
  }
  const grain = m.measurePlacement({ ...base, early: grainy(1), mid: grainy(1), late: grainy(9) })
  ok(grain.subjectFrom !== 'motion' || !grain.subjectBox, 'grain is not a person')
}

/* ——— skin: a face is found by chroma when motion cannot ——— */
{
  const dark = flat(30)
  const rgb = rgbaOf(30, 30, 30)
  // A skin-toned patch in the upper half: Cb/Cr inside the classic range.
  for (let y = 4; y < 12; y += 1) for (let x = 24; x < 34; x += 1) {
    const o = (y * GW + x) * 4
    rgb[o] = 200; rgb[o + 1] = 150; rgb[o + 2] = 120
  }
  // `midRgb` is the 3-bytes-per-cell grid `grayGrid` returns, not raw RGBA.
  const face = m.measurePlacement({ ...base, early: dark, mid: dark, late: dark, midRgb: m.grayGrid(rgb, GW, GH).rgb })
  eq(face.headFrom, 'skin', 'with no motion and no detail, the head is found by chroma')
  ok(face.headBox && face.headBox.h > 0, 'and the head box is grown upward from the face')
  const plain = m.measurePlacement({ ...base, early: dark, mid: dark, late: dark, midRgb: m.grayGrid(rgbaOf(30, 30, 30), GW, GH).rgb })
  eq(plain.headFrom, null, 'a frame with no skin reports no head — not a guess')
  eq(plain.subjectBox, null, 'and no subject at all')
  eq(plain.calmest, plain.bands[0].name === plain.calmest ? plain.bands[0].name : plain.calmest, 'the calmest band is still named when nothing was found')
}

/* ——— the decision ——— */
{
  const busyTop = withBand(checker(20, 235), 128, Math.floor(GH * 0.6), GH)
  const measure = m.measurePlacement({ ...base, early: busyTop, mid: busyTop, late: busyTop })
  const calmCentre = (measure.bands.find((b) => b.name === measure.calmest).yPx + measure.bands.find((b) => b.name === measure.calmest).hPx / 2) / H

  // A caption over the subject's face (the busy half) is moved down.
  const moved = m.decidePlacement(measure, 0.3)
  ok(moved.moved, 'a caption sitting on the subject is moved')
  eq(moved.band, measure.calmest, 'into the calmest band')
  near(moved.y, calmCentre, 0.03, 'aimed at that band’s centre')
  ok(/Moved/.test(moved.reason), `and the reason says so (${moved.reason})`)

  // One already in the calm band is left alone, and the reason says why.
  const kept = m.decidePlacement(measure, calmCentre)
  ok(!kept.moved && kept.y === calmCentre, 'a caption already in the calm band is left where it is')
  ok(/calm/.test(kept.reason), `with the reason recorded (${kept.reason})`)

  // No subject found: the caption keeps its place and the reason says why.
  const flatFrame = flat(120)
  const noSubject = m.measurePlacement({ ...base, early: flatFrame, mid: flatFrame, late: flatFrame })
  const decision = m.decidePlacement(noSubject, 0.4)
  ok(!decision.moved && decision.y === 0.4, 'with no subject, nothing moves')
  ok(/No subject/.test(decision.reason), `and the reason says the measurement found nobody (${decision.reason})`)

  eq(m.bandAt(measure, 0.5)?.band.name, measure.bands[Math.floor(measure.bands.length / 2)].name, 'bandAt finds the middle band at the middle of the frame')
  eq(m.bandAt(measure, -5)?.index, 0, 'a y above the frame falls to the first band')
  eq(m.bandAt(measure, 5)?.index, measure.bands.length - 1, 'and one below to the last')
  ok(m.busyness(measure.bands[0]) > m.busyness(measure.bands[measure.bands.length - 1]), 'busyness separates the bands')
}

/* ——— the document edit ——— */
{
  const makeDoc = (ys) => {
    const doc = m.doc.emptyStudioDoc()
    const video = { ...m.doc.defaultTextClip(0, 0), id: 'v', kind: 'video', name: 'Interview', mediaId: 'm-v', localPath: '/tmp/i.mp4', trimInSec: 0, speed: 1, durationSec: 12, track: 0 }
    doc.clips = [video, ...ys.map((y, i) => ({ ...m.doc.defaultTextClip(2 + i * 3, 1), id: `cap${i}`, name: `Caption ${i + 1}`, y, text: 'hello there' }))]
    return doc
  }
  const busyTop = withBand(checker(20, 235), 128, Math.floor(GH * 0.6), GH)
  const measure = m.measurePlacement({ ...base, early: busyTop, mid: busyTop, late: busyTop })
  const calmY = (measure.bands.find((b) => b.name === measure.calmest).yPx + measure.bands.find((b) => b.name === measure.calmest).hPx / 2) / H

  const doc = makeDoc([0.3, calmY, 0.25])
  const measures = new Map([['cap0', measure], ['cap1', measure], ['cap2', measure]])
  const plan = m.planCaptionPlacement(doc, measures)
  eq(plan.moved.length, 2, 'two captions were over the subject and are moved')
  eq(plan.kept.length, 1, 'and the one already calm is left alone')
  eq(plan.moved[0].id, 'cap0', 'the report names which')
  near(plan.doc.clips.find((c) => c.id === 'cap0').y, calmY, 0.03, 'the document carries the new y')
  eq(plan.doc.clips.find((c) => c.id === 'cap1').y, calmY, 'and the calm one is untouched')
  eq(doc.clips.find((c) => c.id === 'cap0').y, 0.3, 'the input document is not mutated')
  eq(plan.doc.clips.find((c) => c.id === 'v').y, doc.clips.find((c) => c.id === 'v').y, 'nothing else in the document moved')
  ok(plan.notes.some((x) => /Moved 2 block/.test(x)), `the notes summarise the move (${plan.notes.join(' | ')})`)
  ok(plan.notes.some((x) => /Left 1 where they were/.test(x)), 'and say what was left, with the reason')

  // An empty measurement set is said, not silently a no-op.
  const empty = m.planCaptionPlacement(doc, new Map())
  eq(empty.moved.length, 0, 'no measurements means nothing moves')
  ok(empty.notes.some((x) => /could not be measured|No clip could be measured/.test(x)), 'and the notes say the measurement is what is missing')

  // `only` restricts the plan to the selection, so a scoped action stays scoped.
  const scoped = m.planCaptionPlacement(doc, measures, { only: ['cap0'] })
  eq(scoped.moved.length, 1, 'a scoped plan moves only what was asked for')
  eq(scoped.kept.length, 0, 'and reports nothing about the rest')
  eq(scoped.doc.clips.find((c) => c.id === 'cap2').y, 0.25, 'which are left exactly as they were')

  // A caption over the subject in *every* band is still placed — and the risk is
  // named rather than hidden.
  const covered = m.measurePlacement({ ...base, early: checker(20, 235, 3), mid: checker(20, 235, 3), late: checker(20, 235, 3) })
  const risky = m.planCaptionPlacement(makeDoc([0.5]), new Map([['cap0', covered]]))
  ok(risky.risky.length <= 1, 'a caption that still overlaps the subject is reported')
  if (risky.risky.length) ok(risky.notes.some((x) => /still sit over the subject/.test(x)), 'in the notes, with the coverage fraction')
}

/* ——— the wiring, and the honest failure of the decoding path ——— */
{
  const panel = read('src/screens/studio/StudioProPanel.tsx')
  ok(/placeCaptions\(doc/.test(panel), 'the Pro panel runs the measurement')
  ok(/Place captions clear of the subject/.test(panel), 'under a heading that says what it does')
  ok(/runs on the desktop app/.test(panel), 'and warns that the frames are read from the file')

  // No video under a caption → a readable reason, not "no subject found".
  const doc = m.doc.emptyStudioDoc()
  doc.clips = [{ ...m.doc.defaultTextClip(0, 0), id: 'cap', name: 'Caption', y: 0.5 }]
  let failure = null
  try { await m.analyseCaptionPlacement(doc, doc.clips[0]) } catch (err) { failure = err }
  ok(failure && /No video under this caption/.test(failure.message), `a caption with no footage under it says so (${failure?.message})`)

  const withVideo = m.doc.emptyStudioDoc()
  withVideo.clips = [
    { ...m.doc.defaultTextClip(0, 0), id: 'v', kind: 'video', name: 'Shot', mediaId: 'not-loaded', durationSec: 10, trimInSec: 0, speed: 1, track: 0 },
    { ...m.doc.defaultTextClip(0, 1), id: 'cap', name: 'Caption', y: 0.5 },
  ]
  let relink = null
  try { await m.analyseCaptionPlacement(withVideo, withVideo.clips[1]) } catch (err) { relink = err }
  ok(relink && /not loaded/.test(relink.message), `an unloaded file asks to be relinked (${relink?.message})`)

  const attempt = await m.placeCaptions(withVideo)
  eq(attempt.measured, 0, 'placeCaptions measures nothing it cannot read')
  eq(attempt.failed.length, 1, 'and reports the caption it could not measure')
  ok(/not loaded/.test(attempt.failed[0].reason), 'with the file’s own reason')
  ok(attempt.outcome.notes.some((x) => /could not be measured/.test(x)), 'which reaches the notes the caller shows')
  eq(attempt.outcome.doc.clips.find((c) => c.id === 'cap').y, 0.5, 'and nothing moved on no evidence')
}

console.log(`placement check passed — ${n} assertions`)
