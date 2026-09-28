#!/usr/bin/env node
/**
 * Motion craft gate — springs, cursor pack v2 and the film-style router.
 *
 * Techniques adapted from motion-launch-videos by Marouane Gazouzi (MIT).
 * The three things borrowed all have to hold up under the same rule Cupric
 * already lives by: a frame is a pure function of t, so preview equals export.
 *
 *   1. closed-form springs really are springs, and really are pure,
 *   2. the cursor pack travels rather than teleports, and previews itself,
 *   3. the style router refuses to guess when the brief does not say.
 */
import assert from 'node:assert/strict'
import { readFile, rm } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import esbuild from 'esbuild'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (rel) => readFile(path.join(root, rel), 'utf8')

async function load(rel, name) {
  const out = path.join(root, `.motion-craft-${name}.mjs`)
  await esbuild.build({ entryPoints: [path.join(root, rel)], bundle: true, format: 'esm', platform: 'node', outfile: out, logLevel: 'silent' })
  const mod = await import(`${out}?v=${Date.now()}`)
  await rm(out, { force: true })
  return mod
}

const S = await load('src/lib/studio/springs.ts', 'springs')
const C = await load('src/lib/studio/cursorPack.ts', 'cursor')
const F = await load('src/lib/studio/filmStyles.ts', 'styles')

/* ——— 1. springs ————————————————————————————————————————————— */
{
  for (const [name, sp] of Object.entries(S.SPRINGS)) {
    assert.equal(S.springAt(0, sp), 0, `${name} starts at rest`)
    assert.equal(S.springAt(-1, sp), 0, `${name} is 0 before it is kicked`)
    assert.equal(S.springAt(S.settle(sp), sp), 1, `${name} snaps to EXACTLY 1 once settled — loops stay bit-exact`)
    assert.equal(S.springAt(1e6, sp), 1, `${name} stays at 1 forever after`)
    assert.equal(S.springVelocity(0, sp), 0, `${name} starts still`)
    assert.ok(S.springLand(sp) > 0 && S.springLand(sp) < S.settle(sp), `${name} lands before it finishes ringing`)
  }

  // Underdamped springs must actually overshoot — that is the whole point.
  for (const name of ['slam', 'land', 'punch', 'sway']) {
    const sp = S.SPRINGS[name]
    let peak = 0
    for (let i = 0; i <= 2000; i += 1) peak = Math.max(peak, S.springAt((i / 2000) * S.settle(sp), sp))
    assert.ok(peak > 1.001, `${name} overshoots (peak ${peak.toFixed(4)}) — a real spring, not a polynomial`)
  }
  // Critically damped ones must NOT.
  for (const name of ['glide', 'focus']) {
    const sp = S.SPRINGS[name]
    for (let i = 0; i <= 2000; i += 1) {
      assert.ok(S.springAt((i / 2000) * S.settle(sp), sp) <= 1 + 1e-9, `${name} never overshoots, as documented`)
    }
  }

  // Purity: the same t must give the same value, forwards or backwards.
  const fwd = [], back = []
  for (let i = 0; i <= 500; i += 1) fwd.push(S.springAt(i / 100, 'land'))
  for (let i = 500; i >= 0; i -= 1) back.unshift(S.springAt(i / 100, 'land'))
  assert.deepEqual(fwd, back, 'scrubbing backwards gives the identical frame — no hidden state')

  // As a keyframe ease it must respect the 0→1 contract the renderer assumes.
  for (const name of Object.keys(S.SPRINGS)) {
    const ease = S.springEase(name)
    assert.equal(ease(0), 0, `${name} ease starts at 0`)
    assert.equal(ease(1), 1, `${name} ease ends at exactly 1`)
    assert.ok(Number.isFinite(ease(0.5)), `${name} ease is finite mid-way`)
  }

  // Loop-exact noise: value AND slope must match across the seam.
  const DUR = 4
  for (const seed of [1, 7, 99]) {
    const a = S.loopNoise(0, 2, seed, DUR)
    const b = S.loopNoise(DUR, 2, seed, DUR)
    assert.ok(Math.abs(a - b) < 1e-9, `loopNoise seed ${seed} returns to its start value`)
    const da = S.loopNoise(1e-4, 2, seed, DUR) - a
    const db = b - S.loopNoise(DUR - 1e-4, 2, seed, DUR)
    assert.ok(Math.abs(da - db) < 1e-6, `loopNoise seed ${seed} matches slope too — no tick at the wrap`)
    for (let i = 0; i <= 400; i += 1) {
      const v = S.loopNoise((i / 400) * DUR, 3, seed, DUR)
      assert.ok(v >= -1.0001 && v <= 1.0001, 'loopNoise stays in [-1, 1]')
    }
  }
  assert.equal(S.loopNoise(1, 2, 5, 0), 0, 'a zero-length loop is 0, not NaN')

  // Seeded shuffle is reproducible across machines.
  assert.deepEqual(S.shuffled([1, 2, 3, 4, 5, 6], 42), S.shuffled([1, 2, 3, 4, 5, 6], 42), 'same seed, same order')
  assert.equal(S.shuffled([1, 2, 3, 4, 5, 6], 42).length, 6, 'and nothing is lost')

  // Wired into the real ease table.
  const renderer = await read('src/lib/studio/renderer.ts')
  for (const k of ['spring-slam', 'spring-land', 'spring-punch', 'spring-glide']) {
    assert.ok(renderer.includes(`'${k}': springEase(`), `${k} is a real ease in the renderer`)
  }
  const editOps = await read('src/lib/studio/editOps.ts')
  for (const k of ['spring-slam', 'spring-land', 'spring-punch', 'spring-glide']) {
    assert.ok(editOps.includes(`'${k}'`), `${k} passes agent plan validation, so the agent can use it too`)
  }
  const inspector = await read('src/screens/studio/StudioInspector.tsx')
  assert.match(inspector, /<optgroup label="Real springs">/, 'and you can pick one by hand')
}

/* ——— 2. cursor pack v2 —————————————————————————————————————— */
{
  assert.equal(C.CURSOR_VARIANTS.length, 8, 'eight pointer variants')
  const kinds = new Set()
  for (const v of C.CURSOR_VARIANTS) {
    assert.ok(!kinds.has(v.kind), `${v.kind} appears once`)
    kinds.add(v.kind)
    assert.ok(v.label.trim(), `${v.kind} is named`)
    assert.ok(v.hint.length > 20, `${v.kind} explains what it is for — not a nameless icon`)
    assert.ok(v.size > 0, `${v.kind} has a size`)
    if (!C.isDisc(v.kind)) {
      assert.ok(C.cursorPath(v.kind).length >= 2, `${v.kind} is drawn from a path, so it stays sharp at any export size`)
    }
  }

  // Travel is sprung and monotonic — a pointer must never teleport or reverse.
  const from = [0.1, 0.9], to = [0.8, 0.3]
  let prevX = -Infinity
  for (let i = 0; i <= 200; i += 1) {
    const [x] = C.cursorPosition(i / 200, from, to)
    assert.ok(x >= prevX - 1e-9, 'the pointer only moves forwards along its path')
    prevX = x
  }
  assert.deepEqual(C.cursorPosition(0, from, to), [0.1, 0.9], 'it starts where it started')
  const end = C.cursorPosition(1, from, to)
  assert.ok(Math.abs(end[0] - 0.8) < 1e-9 && Math.abs(end[1] - 0.3) < 1e-9, 'and arrives exactly on target')
  assert.ok(C.CURSOR_TRAVEL_SEC > 0.15, 'travel takes real time, so the move is readable')

  // A click is a dip and a release, peaking in the middle.
  assert.equal(C.clickPress(0), 0, 'the press starts at rest')
  assert.equal(C.clickPress(1), 0, 'and returns to rest')
  assert.ok(C.clickPress(0.5) > C.clickPress(0.1), 'dipping deepest mid-click')
  assert.ok(C.clickPress(0.5) > C.clickPress(0.9), 'then springing back')

  // The ripple grows and fades — never the other way round.
  let pr = -1, pa = Infinity
  for (let i = 0; i <= 100; i += 1) {
    const r = C.clickRipple(i / 100, 40)
    assert.ok(r.radius >= pr - 1e-9, 'the ripple only expands')
    assert.ok(r.alpha <= pa + 1e-9, 'and only fades')
    pr = r.radius; pa = r.alpha
  }
  assert.ok(C.clickRipple(1, 40).alpha < 0.001, 'and is gone by the end')

  assert.equal(C.cursorFade(0, 'in'), 0, 'fading in starts invisible')
  assert.equal(C.cursorFade(1, 'in'), 1, 'and ends solid')
  assert.equal(C.cursorFade(1, 'out'), 0, 'fading out ends invisible — the pointer lifts off what you must read')

  // Previewed, and reachable in the UI.
  const picker = await read('src/screens/studio/CursorPicker.tsx')
  assert.match(picker, /CURSOR_VARIANTS\.map/, 'every variant gets a card')
  assert.match(picker, /drawCursor\(ctx, kind/, 'previewed by the SAME draw call the export uses')
  assert.match(picker, /if \(reduced\)/, 'and holds a still frame under reduced motion')
  const kit = await read('src/screens/studio/KitFields.tsx')
  assert.match(kit, /<CursorPicker value=\{clip\.cursor \?\? 'arrow'\}/, 'the picker is wired into the cursor-zoom rig')
  const homeKit = await read('src/lib/studio/homeKit.ts')
  assert.match(homeKit, /drawCursor\(ctx, clip\.cursor \?\? 'arrow'/, 'and the renderer honours the choice')
  assert.match(homeKit, /cursorPosition\(travel/, 'with sprung travel rather than a constant slide')
}

/* ——— 3. the film-style router refuses to guess ——————————————— */
{
  assert.equal(F.FILM_STYLES.length, 8, 'eight film styles')
  for (const s of F.FILM_STYLES) {
    assert.ok(s.useFor.length >= 5, `${s.id} says what it is for`)
    assert.ok(s.notFor.length >= 3, `${s.id} says what it is NOT for — without this a router guesses`)
    assert.ok(s.needs.length >= 2, `${s.id} lists what it needs from the user`)
    assert.ok(s.builtFrom.length >= 2, `${s.id} names the Studio pieces it is assembled from`)
    assert.ok(s.durationSec[0] > 0 && s.durationSec[1] > s.durationSec[0], `${s.id} has a sane duration range`)
  }

  const uiPick = F.pickFilmStyle('a short app demo showing the dashboard and onboarding')
  assert.equal(uiPick?.style.id, 'ui-demo', 'an app demo routes to the UI style')
  assert.ok(uiPick.because.length >= 2, 'and quotes the words that decided it')
  for (const word of uiPick.because) assert.ok('a short app demo showing the dashboard and onboarding'.includes(word), `"${word}" really is in the brief`)

  assert.equal(F.pickFilmStyle('animate our growth metrics and kpi for the year in review')?.style.id, 'charts', 'numbers route to the data story')
  assert.equal(F.pickFilmStyle('a retro 8-bit arcade game teaser')?.style.id, 'pixel', 'retro games route to pixel art')

  // notFor must be disqualifying, not a penalty.
  const blocked = F.rankFilmStyles('a launch bumper made from a screen recording')
  assert.equal(blocked.find((r) => r.style.id === 'kinetic-type').confidence, 0,
    '"screen recording" rules kinetic type out however many other words matched')

  // The important behaviour: when the brief does not say, ASK.
  assert.equal(F.pickFilmStyle('make me a video'), null, 'a vague brief picks nothing')
  assert.equal(F.pickFilmStyle(''), null, 'and an empty one certainly does not')
  const q = F.styleQuestion('make me a video')
  assert.equal(q.question.split('?').length - 1, 1, 'it asks exactly one question')
  assert.ok(q.options.length >= 2 && q.options.length <= 4, 'with a short shortlist')
  for (const o of q.options) assert.ok(o.hint.length > 10, 'each option explains itself')

  assert.deepEqual(F.missingFor(F.filmStyle('charts'), {}), F.filmStyle('charts').needs,
    'nothing supplied means everything is still a question — no invented figures')
}

console.log('Motion craft check passed — springs overshoot, settle to exactly 1 and scrub identically in both directions; loop noise matches value and slope across the seam; the cursor pack travels on a spring, previews itself with the export code path and never teleports; the style router disqualifies on notFor and returns null rather than guessing')
