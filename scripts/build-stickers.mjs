/**
 * Author the built-in Lottie stickers.
 *
 * Writing Lottie JSON by hand is miserable and unreviewable, so the stickers
 * are described here in ordinary terms and the file is generated. Every
 * sticker is pure shape data — no images, no fonts, no expressions — which is
 * what keeps a sticker deterministic: `goToAndStop(frame)` gives the same
 * pixels every time, so the preview and the exported file agree.
 *
 * Run: npm run stickers:build
 */
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

const OUT = 'resources/lottie'
const FR = 60

const white = [1, 1, 1, 1]
const rgb = (r, g, b) => [r / 255, g / 255, b / 255, 1]

const still = (k) => ({ a: 0, k })
const anim = (frames) => ({
  a: 1,
  k: frames.map((f, i) => ({
    t: f.t,
    s: f.s,
    ...(i === frames.length - 1 ? {} : { i: { x: [0.32], y: [1] }, o: { x: [0.32], y: [0] } }),
  })),
})

/** Transform block shared by every shape group. */
const tr = (extra = {}) => ({
  ty: 'tr',
  p: still([0, 0]),
  a: still([0, 0]),
  s: still([100, 100]),
  r: still(0),
  o: still(100),
  ...extra,
})

const stroke = (color, width) => ({
  ty: 'st',
  c: still(color),
  o: still(100),
  w: still(width),
  lc: 2,
  lj: 2,
})

const fill = (color) => ({ ty: 'fl', c: still(color), o: still(100), r: 1 })

const layer = (name, index, shapes, ks, op) => ({
  ddd: 0,
  ind: index,
  ty: 4,
  nm: name,
  sr: 1,
  ks: { o: still(100), r: still(0), p: still([100, 100, 0]), a: still([0, 0, 0]), s: still([100, 100, 100]), ...ks },
  ao: 0,
  shapes,
  ip: 0,
  op,
  st: 0,
  bm: 0,
})

const doc = (name, op, layers) => ({
  v: '5.7.4',
  fr: FR,
  ip: 0,
  op,
  w: 200,
  h: 200,
  nm: name,
  ddd: 0,
  assets: [],
  layers,
})

/* ——— the stickers ——— */

// A ring that pulses outwards and fades, twice a second-and-a-half. The thing
// you put over a tap, a product, or the moment a number changes.
const pulse = (() => {
  const op = 90
  const ring = (delay) =>
    layer(
      `ring-${delay}`,
      delay === 0 ? 1 : 2,
      [
        {
          ty: 'gr',
          it: [{ ty: 'el', p: still([0, 0]), s: still([60, 60]) }, stroke(white, 7), tr()],
        },
      ],
      {
        s: anim([
          { t: delay, s: [40, 40, 100] },
          { t: delay + 55, s: [175, 175, 100] },
        ]),
        o: anim([
          { t: delay, s: [0] },
          { t: delay + 8, s: [100] },
          { t: delay + 55, s: [0] },
        ]),
      },
      op,
    )
  return doc('Pulse ring', op, [ring(0), ring(28)])
})()

// A tick that draws itself on, inside a circle that pops. End-of-step marker.
const check = (() => {
  const op = 75
  const tick = {
    ty: 'gr',
    it: [
      {
        ty: 'sh',
        ks: still({
          c: false,
          v: [
            [-34, 2],
            [-10, 28],
            [36, -26],
          ],
          i: [
            [0, 0],
            [0, 0],
            [0, 0],
          ],
          o: [
            [0, 0],
            [0, 0],
            [0, 0],
          ],
        }),
      },
      stroke(white, 14),
      // Trim path is what makes the stroke draw on rather than appear.
      { ty: 'tm', s: still(0), e: anim([{ t: 12, s: [0] }, { t: 48, s: [100] }]), o: still(0), m: 1 },
      tr(),
    ],
  }
  const disc = {
    ty: 'gr',
    it: [{ ty: 'el', p: still([0, 0]), s: still([150, 150]) }, fill(rgb(61, 214, 140)), tr()],
  }
  return doc('Check pop', op, [
    layer('tick', 1, [tick], {}, op),
    layer(
      'disc',
      2,
      [disc],
      {
        s: anim([
          { t: 0, s: [0, 0, 100] },
          { t: 16, s: [112, 112, 100] },
          { t: 26, s: [100, 100, 100] },
        ]),
      },
      op,
    ),
  ])
})()

// An arrow that nudges down twice — for "look here", "swipe up", "read this".
const arrow = (() => {
  const op = 80
  const head = {
    ty: 'gr',
    it: [
      {
        ty: 'sh',
        ks: still({
          c: false,
          v: [
            [-28, -10],
            [0, 20],
            [28, -10],
          ],
          i: [[0, 0], [0, 0], [0, 0]],
          o: [[0, 0], [0, 0], [0, 0]],
        }),
      },
      stroke(white, 13),
      tr(),
    ],
  }
  const shaft = {
    ty: 'gr',
    it: [
      {
        ty: 'sh',
        ks: still({ c: false, v: [[0, -48], [0, 12]], i: [[0, 0], [0, 0]], o: [[0, 0], [0, 0]] }),
      },
      stroke(white, 13),
      tr(),
    ],
  }
  return doc('Arrow nudge', op, [
    layer(
      'arrow',
      1,
      [head, shaft],
      {
        p: anim([
          { t: 0, s: [100, 86, 0] },
          { t: 18, s: [100, 114, 0] },
          { t: 36, s: [100, 86, 0] },
          { t: 54, s: [100, 110, 0] },
          { t: 72, s: [100, 86, 0] },
        ]),
      },
      op,
    ),
  ])
})()

// A live dot: the recording/streaming indicator, breathing on a halo.
const live = (() => {
  const op = 72
  const dot = {
    ty: 'gr',
    it: [{ ty: 'el', p: still([0, 0]), s: still([46, 46]) }, fill(rgb(226, 75, 74)), tr()],
  }
  const halo = {
    ty: 'gr',
    it: [{ ty: 'el', p: still([0, 0]), s: still([46, 46]) }, fill(rgb(226, 75, 74)), tr()],
  }
  return doc('Live dot', op, [
    layer('dot', 1, [dot], {
      s: anim([
        { t: 0, s: [100, 100, 100] },
        { t: 36, s: [118, 118, 100] },
        { t: 71, s: [100, 100, 100] },
      ]),
    }, op),
    layer(
      'halo',
      2,
      [halo],
      {
        s: anim([
          { t: 0, s: [100, 100, 100] },
          { t: 71, s: [280, 280, 100] },
        ]),
        o: anim([
          { t: 0, s: [55] },
          { t: 71, s: [0] },
        ]),
      },
      op,
    ),
  ])
})()

const stickers = [
  { id: 'pulse-ring', json: pulse },
  { id: 'check-pop', json: check },
  { id: 'arrow-nudge', json: arrow },
  { id: 'live-dot', json: live },
]

/** Reject anything the player would silently render as an empty frame. */
function validate(id, json) {
  const problems = []
  if (!json.layers?.length) problems.push('no layers')
  if (!(json.op > json.ip)) problems.push('out point is not after the in point')
  if (!json.fr) problems.push('no frame rate')
  for (const l of json.layers ?? []) {
    if (l.ty !== 4) problems.push(`layer ${l.nm} is not a shape layer`)
    if (!l.shapes?.length) problems.push(`layer ${l.nm} has no shapes`)
    for (const group of l.shapes ?? []) {
      if (group.ty !== 'gr') problems.push(`layer ${l.nm} has a bare shape outside a group`)
      const kinds = (group.it ?? []).map((it) => it.ty)
      if (!kinds.includes('tr')) problems.push(`a group in ${l.nm} has no transform`)
      if (!kinds.some((k) => k === 'st' || k === 'fl')) problems.push(`a group in ${l.nm} paints nothing`)
    }
    if (l.op > json.op) problems.push(`layer ${l.nm} outlives the composition`)
  }
  if (problems.length) {
    console.error(`sticker "${id}" is invalid:\n  - ${problems.join('\n  - ')}`)
    process.exitCode = 1
  }
}

await mkdir(OUT, { recursive: true })
const index = []
for (const { id, json } of stickers) {
  validate(id, json)
  await writeFile(path.join(OUT, `${id}.json`), `${JSON.stringify(json)}\n`)
  index.push({ id, name: json.nm, durationSec: Number((json.op / json.fr).toFixed(3)), w: json.w, h: json.h })
}
await writeFile(path.join(OUT, 'index.json'), `${JSON.stringify({ stickers: index }, null, 2)}\n`)
console.log(`wrote ${index.length} stickers to ${OUT}`)
