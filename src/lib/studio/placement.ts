/**
 * Where the picture is empty — measured, so a caption is not placed over a face.
 *
 * Adapted from veedstudio/open-edit's `cli/src/commands/measure-placement.ts`
 * (Apache-2.0 — see THIRD_PARTY_NOTICES.md), whose case for measuring rather
 * than eye-balling is exactly NewBrand's: placement is decided against the picture,
 * and nothing measured the picture. NewBrand had a caption default (`y` in the
 * middle of the frame) and a hand-drag, so a caption could sit across the
 * speaker's mouth in every clip of a run and nothing said so.
 *
 * Three signals, on a small grid, from three frames of the clip (early, middle,
 * late):
 *
 *   motion  the difference between the early and late frames — on a locked-off
 *           shot, only the speaker moves
 *   detail  the local gradient in the middle frame — where the picture is busy
 *   skin    Cb/Cr chroma in the middle frame — used only when motion gave no
 *           subject, because a terracotta wall passes the same test
 *
 * The subject box comes from motion when the motion is *confined* (under 1% the
 * subject held still, over 45% the camera moved and the difference outlines the
 * whole scene), otherwise from detail; where neither gives a person, a face is
 * looked for by skin. All of it is an estimate, and each measurement says which
 * signal it came from.
 *
 * Everything except `analysePlacement` is pure, so the arithmetic is tested on
 * synthetic frames with no decoder in the loop — the same split upstream uses to
 * keep `measureFrame` testable.
 */
import type { StudioDoc, StudioMediaClip, StudioTextClip } from '../../types/project'
import { getMedia, loadVideo, seekTo } from './media'
import { canvasForAspect, safeZoneFor, type Zone } from './safeZone'

export interface PlacementBox { x: number; y: number; w: number; h: number }

export interface PlacementBand {
  name: string
  /** Band edges in canvas pixels, measured inside the safe zone. */
  yPx: number
  hPx: number
  /** Mean luma of the footage behind the band: what the ink has to separate from. */
  luma: number
  /** p95 − p5 of that luma: a wide spread means no single ink colour holds across the band. */
  spread: number
  detail: number
  motion: number
  /** The band crosses the head box (the part of the subject that must stay visible). */
  overHead: boolean
  /** Fraction of the band's area the subject box covers. */
  overSubject: number
}

export interface FrameMeasure {
  subjectBox: PlacementBox | null
  headBox: PlacementBox | null
  subjectFrom: 'motion' | 'detail' | null
  /** What the head box was read from. `detail` is a guess on a busy background. */
  headFrom: 'motion' | 'skin' | 'detail' | null
  bands: PlacementBand[]
  /** The band with the least detail and motion that does not cross the head. */
  calmest: string
  width: number
  height: number
}

export const PLACEMENT_DEFAULTS = {
  /** Long side of the measuring grid; the short side follows the canvas aspect. */
  gridLong: 192,
  /** A luma change above this between the two instants counts as motion (0–255). */
  motionOn: 14,
  /** Under this fraction of the grid moving, the subject held still between the frames. */
  motionFloor: 0.01,
  /** Over this fraction, the camera moved: the difference outlines the scene. */
  motionCeiling: 0.45,
  /** Below this fraction of the grid, a component is texture rather than a person. */
  personFloor: 0.02,
  skinFloor: 0.004,
  skinCeiling: 0.2,
} as const

function percentile(sorted: number[], p: number): number {
  return sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] : 0
}

interface Component { box: PlacementBox; cells: number; members: number[] }

/** A coarse blur, so a moving mouth and a moving shoulder join into one subject rather than two specks. */
function dilate(on: Uint8Array, gw: number, gh: number, r: number): Uint8Array {
  const out = new Uint8Array(on.length)
  for (let y = 0; y < gh; y += 1) {
    for (let x = 0; x < gw; x += 1) {
      if (!on[y * gw + x]) continue
      for (let dy = -r; dy <= r; dy += 1) {
        for (let dx = -r; dx <= r; dx += 1) {
          const xx = x + dx
          const yy = y + dy
          if (xx >= 0 && xx < gw && yy >= 0 && yy < gh) out[yy * gw + xx] = 1
        }
      }
    }
  }
  return out
}

/** Largest 4-connected component of a boolean grid. */
function largestComponent(on: Uint8Array, gw: number, gh: number): Component | null {
  const seen = new Uint8Array(on.length)
  let best: Component | null = null
  for (let i = 0; i < on.length; i += 1) {
    if (!on[i] || seen[i]) continue
    const members: number[] = []
    const stack = [i]
    seen[i] = 1
    while (stack.length) {
      const c = stack.pop() as number
      const x = c % gw
      const y = (c / gw) | 0
      members.push(c)
      const neighbours = [x > 0 ? c - 1 : -1, x < gw - 1 ? c + 1 : -1, y > 0 ? c - gw : -1, y < gh - 1 ? c + gw : -1]
      for (const n of neighbours) {
        if (n >= 0 && on[n] && !seen[n]) {
          seen[n] = 1
          stack.push(n)
        }
      }
    }
    if (!best || members.length > best.cells) best = { box: { x: 0, y: 0, w: 0, h: 0 }, cells: members.length, members }
  }
  return best
}

/**
 * The box holding the middle 90% of a component's signal on each axis. A plain
 * bounding box follows one flickering lamp to the edge of the frame; the mass of
 * the signal stays on the speaker.
 */
function massBox(members: number[], weight: Float32Array, gw: number, gh: number): PlacementBox {
  const col = new Float64Array(gw)
  const row = new Float64Array(gh)
  let total = 0
  for (const c of members) {
    const v = weight[c] + 1
    col[c % gw] += v
    row[(c / gw) | 0] += v
    total += v
  }
  const span = (acc: Float64Array): [number, number] => {
    let run = 0
    let lo = 0
    let hi = acc.length - 1
    for (let i = 0; i < acc.length; i += 1) { run += acc[i]; if (run >= total * 0.05) { lo = i; break } }
    run = 0
    for (let i = acc.length - 1; i >= 0; i -= 1) { run += acc[i]; if (run >= total * 0.05) { hi = i; break } }
    return [lo, Math.max(lo, hi)]
  }
  const [x0, x1] = span(col)
  const [y0, y1] = span(row)
  return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 }
}

/** RGBA (grid resolution) → luma grid, and the RGB the skin test reads. */
export function grayGrid(rgba: Uint8ClampedArray | Uint8Array, gw: number, gh: number): { gray: Uint8Array; rgb: Uint8Array } {
  const n = gw * gh
  const gray = new Uint8Array(n)
  const rgb = new Uint8Array(n * 3)
  for (let i = 0; i < n; i += 1) {
    const o = i * 4
    const r = rgba[o] ?? 0
    const g = rgba[o + 1] ?? 0
    const b = rgba[o + 2] ?? 0
    rgb[i * 3] = r
    rgb[i * 3 + 1] = g
    rgb[i * 3 + 2] = b
    // Rec. 601 luma: what the motion and detail signals are read on.
    gray[i] = Math.max(0, Math.min(255, Math.round(0.299 * r + 0.587 * g + 0.114 * b)))
  }
  return { gray, rgb }
}

export interface MeasureInput {
  /** Three luma grids of the same size, taken early, middle and late in the clip. */
  early: Uint8Array
  mid: Uint8Array
  late: Uint8Array
  /** Optional RGB of the middle frame (from `grayGrid`), for the skin fallback. */
  midRgb?: Uint8Array
  gw: number
  gh: number
  width: number
  height: number
  /** Safe zone to divide into bands; defaults to the aspect's own. */
  zone?: Zone
}

/**
 * Measure one clip. Pure: same frames in, same numbers out.
 */
export function measurePlacement(input: MeasureInput): FrameMeasure {
  const { early, mid, late, gw, gh, width, height } = input
  const n = gw * gh
  const cfg = PLACEMENT_DEFAULTS
  const detail = new Float32Array(n)
  const motion = new Float32Array(n)
  for (let y = 0; y < gh; y += 1) {
    for (let x = 0; x < gw; x += 1) {
      const i = y * gw + x
      const dx = x < gw - 1 ? Math.abs(mid[i] - mid[i + 1]) : 0
      const dy = y < gh - 1 ? Math.abs(mid[i] - mid[i + gw]) : 0
      detail[i] = dx + dy
      motion[i] = Math.abs(early[i] - late[i])
    }
  }

  const moving = new Uint8Array(n)
  let movingCells = 0
  for (let i = 0; i < n; i += 1) if (motion[i] > cfg.motionOn) { moving[i] = 1; movingCells += 1 }
  const movingFrac = movingCells / n

  let subjectFrom: FrameMeasure['subjectFrom'] = null
  let comp: Component | null = null
  let signal: Float32Array = motion
  // Checked per signal: a speck of motion (grain, foliage, codec flicker) must
  // not end the search, or the detail pass never runs and an ordinary shot
  // reports no subject at all.
  const person = (c: Component | null) => (c && c.cells >= n * cfg.personFloor ? c : null)
  if (movingFrac >= cfg.motionFloor && movingFrac <= cfg.motionCeiling) {
    comp = person(largestComponent(dilate(moving, gw, gh, 3), gw, gh))
    if (comp) subjectFrom = 'motion'
  }
  if (!comp) {
    const sorted = Array.from(detail).sort((a, b) => a - b)
    const cut = Math.max(12, percentile(sorted, 0.8))
    const busy = new Uint8Array(n)
    for (let i = 0; i < n; i += 1) if (detail[i] >= cut) busy[i] = 1
    comp = person(largestComponent(dilate(busy, gw, gh, 2), gw, gh))
    if (comp) {
      subjectFrom = 'detail'
      signal = detail
    }
  }
  if (comp) comp.box = massBox(comp.members, signal, gw, gh)

  const sx = width / gw
  const sy = height / gh
  const toCanvas = (b: PlacementBox): PlacementBox => ({ x: Math.round(b.x * sx), y: Math.round(b.y * sy), w: Math.round(b.w * sx), h: Math.round(b.h * sy) })
  const subjectBox = comp ? toCanvas(comp.box) : null

  // The head is the top of the subject's box: three quarters as tall as the box
  // is wide, capped at 40% of its height and 60% of its width (shoulders are
  // wider than a face), centred on where the signal actually sits in those top
  // rows — a speaker who leans is not under the middle of their own shoulders.
  let headBox: PlacementBox | null = null
  let headFrom: FrameMeasure['headFrom'] = null
  if (comp && subjectBox) {
    const hh = Math.round(Math.min(subjectBox.h * 0.4, subjectBox.w * 0.75))
    const hw = Math.round(subjectBox.w * 0.6)
    const topRows = comp.box.y + Math.max(1, Math.round(hh / sy))
    let mass = 0
    let mx = 0
    for (const c of comp.members) {
      const y = (c / gw) | 0
      if (y < comp.box.y || y >= topRows) continue
      const v = signal[c] + 1
      mass += v
      mx += v * (c % gw)
    }
    const cx = mass ? (mx / mass) * sx : subjectBox.x + subjectBox.w / 2
    const x = Math.round(Math.min(Math.max(cx - hw / 2, subjectBox.x), subjectBox.x + subjectBox.w - hw))
    headBox = { x, y: subjectBox.y, w: hw, h: hh }
    headFrom = subjectFrom
  }

  // Detail cannot tell a speaker from a street behind them, so where motion gave
  // no subject a face is looked for by its chroma: the classic Cb/Cr skin range
  // holds across skin tones because it drops luminance. Grown upward for hair or
  // a hat. A terracotta wall also passes this test, which is why motion is asked
  // first.
  if (subjectFrom !== 'motion' && input.midRgb && input.midRgb.length >= n * 3) {
    const skin = new Uint8Array(n)
    for (let i = 0; i < n; i += 1) {
      const r = input.midRgb[i * 3]
      const g = input.midRgb[i * 3 + 1]
      const b = input.midRgb[i * 3 + 2]
      const cb = 128 - 0.169 * r - 0.331 * g + 0.5 * b
      const cr = 128 + 0.5 * r - 0.419 * g - 0.081 * b
      if (cb >= 77 && cb <= 127 && cr >= 135 && cr <= 173 && ((i / gw) | 0) < gh * 0.75) skin[i] = 1
    }
    const face = largestComponent(skin, gw, gh)
    if (face && face.cells >= n * cfg.skinFloor && face.cells <= n * cfg.skinCeiling) {
      const ones = new Float32Array(n)
      const fb = toCanvas(massBox(face.members, ones, gw, gh))
      const grow = Math.round(fb.h * 0.35)
      const y = Math.max(0, fb.y - grow)
      headBox = { x: fb.x, y, w: fb.w, h: fb.y + fb.h - y }
      headFrom = 'skin'
    }
  }

  const zone = input.zone ?? safeZoneFor(width > height * 1.2 ? '16:9' : width === height ? '1:1' : '9:16')
  const bandCount = height > width ? 6 : 4
  const gx0 = Math.floor(zone.x0 * gw)
  const gx1 = Math.ceil(zone.x1 * gw)
  const bands: PlacementBand[] = []
  for (let b = 0; b < bandCount; b += 1) {
    const f0 = zone.y0 + ((zone.y1 - zone.y0) * b) / bandCount
    const f1 = zone.y0 + ((zone.y1 - zone.y0) * (b + 1)) / bandCount
    const gy0 = Math.floor(f0 * gh)
    const gy1 = Math.max(gy0 + 1, Math.floor(f1 * gh))
    const lum: number[] = []
    let d = 0
    let m = 0
    for (let y = gy0; y < gy1; y += 1) {
      for (let x = gx0; x < gx1; x += 1) {
        const i = y * gw + x
        lum.push(mid[i])
        d += detail[i]
        m += motion[i]
      }
    }
    lum.sort((a, c) => a - c)
    const cells = Math.max(1, lum.length)
    const yPx = Math.round(f0 * height)
    const hPx = Math.round((f1 - f0) * height)
    const crosses = (box: PlacementBox | null) => Boolean(box && box.y < yPx + hPx && box.y + box.h > yPx)
    let overSubject = 0
    if (subjectBox && crosses(subjectBox)) {
      const zx0 = zone.x0 * width
      const zx1 = zone.x1 * width
      const ix = Math.max(0, Math.min(subjectBox.x + subjectBox.w, zx1) - Math.max(subjectBox.x, zx0))
      const iy = Math.max(0, Math.min(subjectBox.y + subjectBox.h, yPx + hPx) - Math.max(subjectBox.y, yPx))
      overSubject = Math.round((ix * iy) / ((zx1 - zx0) * hPx) * 100) / 100
    }
    bands.push({
      name: `band-${b + 1}`,
      yPx,
      hPx,
      luma: Math.round(lum.reduce((s, v) => s + v, 0) / cells),
      spread: percentile(lum, 0.95) - percentile(lum, 0.05),
      detail: Math.round((d / cells) * 10) / 10,
      motion: Math.round((m / cells) * 10) / 10,
      overHead: crosses(headBox),
      overSubject,
    })
  }
  // Calmest among the bands that do not cross the head; if every band does, the
  // least busy one overall — saying "nowhere is clear" is the caller's job.
  //
  // Among bands that are about as calm as each other, the one farthest from the
  // head wins: a caption at the bottom of the frame is further from a speaker's
  // face than one just under their chin, and on a flat background every band ties
  // on busyness. Deterministic, and checked.
  const open = bands.filter((b) => !b.overHead)
  const pool = open.length ? open : bands
  const min = Math.min(...pool.map(busyness))
  const calmPool = pool.filter((b) => busyness(b) <= min + 0.4)
  const headCentre = headBox ? headBox.y + headBox.h / 2 : null
  const distanceFromHead = (b: PlacementBand) => (headCentre === null
    ? b.yPx + b.hPx / 2
    : Math.abs(b.yPx + b.hPx / 2 - headCentre))
  const calmest = calmPool.reduce((a, b) => (distanceFromHead(b) > distanceFromHead(a) + 1 ? b : a)).name
  return { subjectBox, headBox, subjectFrom, headFrom, bands, calmest, width, height }
}

/** Which band a normalised y sits in. A y outside the zone falls to the nearest band. */
export function bandAt(measure: FrameMeasure, yNorm: number): { band: PlacementBand; index: number } | null {
  if (!measure.bands.length) return null
  const yPx = yNorm * measure.height
  let index = measure.bands.findIndex((band) => yPx >= band.yPx && yPx <= band.yPx + band.hPx)
  if (index < 0) index = yPx < measure.bands[0].yPx ? 0 : measure.bands.length - 1
  return { band: measure.bands[index], index }
}

/** How busy a band is: the motion and detail the text would have to sit on. */
export const busyness = (band: PlacementBand): number => band.detail + band.motion

export interface PlacementDecision {
  /** Where the block's centre should sit, normalised 0–1. */
  y: number
  band: string
  moved: boolean
  reason: string
}

/**
 * Where to put one block.
 *
 * Keep it where it is when it already sits in a band that does not cross the
 * head and is about as calm as the calmest band — moving a caption that is
 * already fine is churn, and the reason says which case it was. Otherwise aim its
 * centre at the calmest band that does not cross the head. A clip where no
 * subject was found is left alone *and said so*: a busy background is not a
 * person, and a decision made on no evidence is worse than none.
 */
export function decidePlacement(measure: FrameMeasure, currentY: number): PlacementDecision {
  if (!measure.bands.length) return { y: currentY, band: '', moved: false, reason: 'The clip has no measurable bands.' }
  const here = bandAt(measure, currentY)
  if (!measure.subjectBox) {
    return {
      y: currentY,
      band: here?.band.name ?? '',
      moved: false,
      reason: 'No subject was found in this clip’s frames, so the caption keeps its place — a busy background is not a person.',
    }
  }
  const target = measure.bands.find((band) => band.name === measure.calmest) ?? measure.bands[measure.bands.length - 1]
  const threshold = busyness(target) * 1.25 + 0.5
  if (here && !here.band.overHead && busyness(here.band) <= threshold) {
    return {
      y: currentY,
      band: here.band.name,
      moved: false,
      reason: `Already in ${here.band.name}, clear of the head and about as calm as the calmest band (${busyness(here.band).toFixed(1)} against ${busyness(target).toFixed(1)}).`,
    }
  }
  const y = Math.round(Math.min(0.98, Math.max(0.02, (target.yPx + target.hPx / 2) / measure.height)) * 1000) / 1000
  if (Math.abs(y - currentY) < 0.01) {
    return { y: currentY, band: target.name, moved: false, reason: `Already in the calmest band (${target.name}).` }
  }
  const why = target.overSubject > 0.25
    ? `every band crosses the subject, so ${target.name} is the least busy (${Math.round(target.overSubject * 100)}% covered — worth a look)`
    : here?.band.overHead
      ? `${here.band.name} crosses the ${measure.headFrom ?? 'subject'}, and ${target.name} does not`
      : `${target.name} is the calmest band (detail ${target.detail}, motion ${target.motion})`
  return { y, band: target.name, moved: true, reason: `Moved: ${why}.` }
}

export interface PlacementOutcome {
  doc: StudioDoc
  moved: Array<{ id: string; name: string; from: number; to: number; band: string }>
  kept: Array<{ id: string; name: string; band: string; reason: string }>
  /** Blocks whose chosen band is (partly) over the subject: reported, never hidden. */
  risky: Array<{ id: string; name: string; overSubject: number }>
  notes: string[]
}

/**
 * Plan the placement for every caption with a measurement. Pure and
 * document-shaped: the caller commits the result as ONE undo step, so moving a
 * dozen captions is one action.
 */
export function planCaptionPlacement(
  doc: StudioDoc,
  measures: Map<string, FrameMeasure>,
  opts: { only?: string[] } = {},
): PlacementOutcome {
  const moved: PlacementOutcome['moved'] = []
  const kept: PlacementOutcome['kept'] = []
  const risky: PlacementOutcome['risky'] = []
  const patches = new Map<string, number>()
  const targets = doc.clips.filter((clip): clip is StudioTextClip => clip.kind === 'text' && !clip.hidden && (!opts.only?.length || opts.only.includes(clip.id)))
  for (const clip of targets) {
    const measure = measures.get(clip.id)
    if (!measure) continue
    const decision = decidePlacement(measure, clip.y)
    if (decision.moved) {
      patches.set(clip.id, decision.y)
      moved.push({ id: clip.id, name: clip.name, from: clip.y, to: decision.y, band: decision.band })
    } else {
      kept.push({ id: clip.id, name: clip.name, band: decision.band, reason: decision.reason })
    }
    const band = decision.band ? measure.bands.find((b) => b.name === decision.band) : undefined
    if (band && band.overSubject > 0.25) risky.push({ id: clip.id, name: clip.name, overSubject: band.overSubject })
  }
  const notes: string[] = []
  if (!targets.length) notes.push('There is no caption to place — add captions (auto-captions) or select a text clip first.')
  if (targets.length && !measures.size) notes.push('No clip could be measured, so nothing was moved.')
  if (moved.length) notes.push(`Moved ${moved.length} block(s) clear of the subject.`)
  if (kept.length) notes.push(`Left ${kept.length} where they were: ${kept[0].reason}`)
  if (risky.length) notes.push(`${risky.length} block(s) still sit over the subject in their calmest band (worst ${Math.round(risky[0].overSubject * 100)}% covered) — check those by eye.`)
  const doc2 = patches.size
    ? { ...doc, clips: doc.clips.map((clip) => (patches.has(clip.id) ? ({ ...clip, y: patches.get(clip.id)! } as typeof clip) : clip)) }
    : doc
  return { doc: doc2, moved, kept, risky, notes }
}

/** The grid the frames are measured on: a 192-long side, aspect respected. */
export function measureGrid(width: number, height: number, long = PLACEMENT_DEFAULTS.gridLong): [number, number] {
  const scale = long / Math.max(1, Math.max(width, height))
  const gw = Math.max(16, Math.round(width * scale))
  const gh = Math.max(9, Math.round(height * scale))
  return [gw, gh]
}

/**
 * Measure the footage under one caption: three frames around the caption's
 * midpoint, decoded from the clip's own file.
 *
 * Needs the file on this machine (a browser decode), exactly like
 * `analyseSubject`. A clip that cannot be decoded throws with a readable reason
 * rather than reporting "no subject" — which would be a placement decision made
 * on no evidence.
 */
export async function analyseCaptionPlacement(
  doc: StudioDoc,
  caption: StudioTextClip,
  onProgress?: (pct: number) => void,
  opts: { zone?: Zone } = {},
): Promise<FrameMeasure> {
  const mid = caption.startSec + caption.durationSec / 2
  const under = doc.clips.find((clip) => clip.kind === 'video'
    && mid >= clip.startSec && mid <= clip.startSec + clip.durationSec) as StudioMediaClip | undefined
  if (!under) throw new Error('No video under this caption — place it where there is footage to measure.')
  const handle = getMedia(under.mediaId)
  if (!handle || handle.kind !== 'video') throw new Error('That clip’s video file is not loaded — relink it first.')
  const speed = under.speed > 0 ? under.speed : 1
  const toSource = (timelineSec: number) => under.trimInSec + (timelineSec - under.startSec) * speed
  const [width, height] = canvasForAspect(doc.aspect)
  const [gw, gh] = measureGrid(width, height)
  const canvas = document.createElement('canvas')
  canvas.width = gw
  canvas.height = gh
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('Canvas is unavailable.')
  const video = await loadVideo(handle.url)
  const sourceEnd = under.trimInSec + under.durationSec * speed
  const at = (offset: number) => Math.max(under.trimInSec, Math.min(sourceEnd - 0.04, toSource(mid + offset)))
  const times = [at(-0.4), at(0), at(0.4)]
  const grids: Array<{ gray: Uint8Array; rgb: Uint8Array }> = []
  for (let i = 0; i < times.length; i += 1) {
    await seekTo(video, times[i])
    ctx.drawImage(video, 0, 0, gw, gh)
    grids.push(grayGrid(ctx.getImageData(0, 0, gw, gh).data, gw, gh))
    onProgress?.(Math.round(((i + 1) / times.length) * 100))
  }
  video.removeAttribute('src')
  video.load()
  return measurePlacement({
    early: grids[0].gray,
    mid: grids[1].gray,
    late: grids[2].gray,
    midRgb: grids[1].rgb,
    gw,
    gh,
    width,
    height,
    ...(opts.zone ? { zone: opts.zone } : {}),
  })
}

/**
 * Measure every caption and plan the placement. One document out, so the caller
 * commits it as one undo step; a caption that could not be measured is reported
 * with its reason instead of being quietly skipped (which is how "it did
 * nothing" becomes a mystery).
 */
export async function placeCaptions(
  doc: StudioDoc,
  opts: { only?: string[]; onProgress?: (pct: number, label: string) => void } = {},
): Promise<{ outcome: PlacementOutcome; measured: number; failed: Array<{ id: string; name: string; reason: string }> }> {
  const targets = doc.clips.filter((clip): clip is StudioTextClip =>
    clip.kind === 'text' && !clip.hidden && (!opts.only?.length || opts.only.includes(clip.id)))
  const measures = new Map<string, FrameMeasure>()
  const failed: Array<{ id: string; name: string; reason: string }> = []
  for (let i = 0; i < targets.length; i += 1) {
    const caption = targets[i]
    opts.onProgress?.(Math.round((i / Math.max(1, targets.length)) * 100), `Measuring under “${caption.name}”…`)
    try {
      measures.set(caption.id, await analyseCaptionPlacement(doc, caption, undefined, {}))
    } catch (err) {
      failed.push({ id: caption.id, name: caption.name, reason: err instanceof Error ? err.message : String(err) })
    }
  }
  const outcome = planCaptionPlacement(doc, measures, opts.only?.length ? { only: opts.only } : {})
  if (failed.length) outcome.notes.push(`${failed.length} caption(s) could not be measured: “${failed[0].name}” — ${failed[0].reason}`)
  return { outcome, measured: measures.size, failed }
}
