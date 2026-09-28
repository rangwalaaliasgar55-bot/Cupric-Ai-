#!/usr/bin/env node
/**
 * JOB 13 gate — the target-look pack.
 *
 * Four looks, one rule: nothing is ever fabricated. Empty slots render
 * visibly empty and a highlight that is not literally in your own words does
 * not appear at all.
 *
 *   1. kinetic captions highlight RUNS (phrases), coloured or chipped,
 *   2. collage auto-layout covers 2–8 photos without overlap or overflow,
 *   3. the testimonial wall imports text only — it never writes a quote,
 *   4. before/after animates, deterministically.
 */
import assert from 'node:assert/strict'
import { readFile, rm } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import esbuild from 'esbuild'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (rel) => readFile(path.join(root, rel), 'utf8')

async function load(rel, name) {
  const out = path.join(root, `.look-pack-${name}.mjs`)
  await esbuild.build({ entryPoints: [path.join(root, rel)], bundle: true, format: 'esm', platform: 'node', outfile: out, logLevel: 'silent' })
  const mod = await import(`${pathToFileURL(out).href}?v=${Date.now()}`)
  await rm(out, { force: true })
  return mod
}

const H = await load('src/lib/studio/highlightRuns.ts', 'highlight')
const L = await load('src/lib/studio/layouts.ts', 'layouts')

/* ——— 1. highlight runs ———————————————————————————————————————— */
{
  const words = 'Lost twenty kilos in six weeks with no gym'.split(' ')

  const single = H.markRuns(words, 'weeks')
  assert.equal(single.filter((m) => m.run !== -1).length, 1, 'one word still works')

  const phrase = H.markRuns(words, 'six weeks')
  const hit = phrase.filter((m) => m.run !== -1).map((m) => m.word)
  assert.deepEqual(hit, ['six', 'weeks'], 'a phrase highlights as a run, not word by word')
  assert.equal(phrase[phrase.findIndex((m) => m.word === 'six')].runStart, true, 'the run knows where it starts')
  assert.equal(phrase[phrase.findIndex((m) => m.word === 'weeks')].runEnd, true, 'and where it ends — so a chip is ONE box')

  const two = H.markRuns(words, 'six weeks, no gym')
  assert.equal(two.reduce((max, m) => Math.max(max, m.run + 1), 0), 2, 'commas separate runs')

  // Longest-first: "six weeks" must beat a bare "six".
  const greedy = H.markRuns(words, 'six, six weeks')
  const sixIdx = words.indexOf('six')
  assert.equal(greedy[sixIdx].run, greedy[sixIdx + 1].run, 'the longer phrase wins over one of its own words')
  assert.notEqual(greedy[sixIdx].run, -1)

  // THE RULE: words that are not in the caption never highlight.
  const invented = H.markRuns(words, 'guaranteed results')
  assert.ok(invented.every((m) => m.run === -1), 'a phrase that is not in the text highlights nothing — never fabricated')
  assert.ok(H.markRuns(words, '').every((m) => m.run === -1), 'an empty spec highlights nothing')
  assert.ok(H.markRuns(words, null).every((m) => m.run === -1), 'and neither does null')
  assert.ok(H.markRuns(words, '   ,  ,').every((m) => m.run === -1), 'nor does punctuation with no words')

  // Punctuation and case must not stop a real match.
  assert.ok(H.markRuns('Six WEEKS, flat.'.split(' '), 'six weeks').some((m) => m.run !== -1), 'matching ignores case and punctuation')

  // Old projects keep working without migration.
  assert.equal(H.runSpec(null, 'free'), 'free', 'a legacy highlightWord still highlights')
  assert.equal(H.runSpec('six weeks', null), 'six weeks')
  assert.equal(H.runSpec(null, null), null)

  // Determinism: preview and export call this with the same t and must agree.
  for (const p of [0, 0.13, 0.5, 0.87, 1]) {
    assert.equal(H.chipReveal(p, 0, 2), H.chipReveal(p, 0, 2), 'chipReveal is pure in p')
  }
  assert.equal(H.chipReveal(0, 0, 2), 0, 'the chip starts closed')
  assert.equal(H.chipReveal(1, 0, 2), 1, 'and ends fully open')
  let prev = -1
  for (let i = 0; i <= 20; i += 1) {
    const v = H.chipReveal(i / 20, 0, 1)
    assert.ok(v >= prev - 1e-9, 'the chip only ever grows — it never flickers')
    assert.ok(v >= 0 && v <= 1, 'and stays in range')
    prev = v
  }
}

/* ——— 2. collage auto-layout, 2–8 photos ——————————————————————— */
{
  for (const aspect of ['16:9', '9:16', '1:1']) {
    for (let n = 2; n <= 8; n += 1) {
      const cells = L.collageCells(n, aspect)
      assert.equal(cells.length, n, `${n} photos get ${n} cells in ${aspect}`)
      for (const c of cells) {
        assert.ok(c.w > 0.02 && c.h > 0.02, `no cell collapses (${n}/${aspect})`)
        assert.ok(c.x >= -1e-6 && c.y >= -1e-6, `no cell starts off-frame (${n}/${aspect})`)
        assert.ok(c.x + c.w <= 1 + 1e-6, `no cell runs off the right edge (${n}/${aspect})`)
        assert.ok(c.y + c.h <= 1 + 1e-6, `no cell runs off the bottom (${n}/${aspect})`)
      }
      // No two photos may sit on top of each other.
      for (let i = 0; i < cells.length; i += 1) {
        for (let j = i + 1; j < cells.length; j += 1) {
          const a = cells[i], b = cells[j]
          const overlap = a.x < b.x + b.w - 1e-6 && b.x < a.x + a.w - 1e-6 && a.y < b.y + b.h - 1e-6 && b.y < a.y + a.h - 1e-6
          assert.ok(!overlap, `photos ${i} and ${j} overlap at ${n} in ${aspect}`)
        }
      }
    }
  }
  assert.deepEqual(L.buildCollage({ aspect: '16:9', clips: [], trackCount: 3 }, [], 0).clips, [],
    'no photos means no collage — nothing is invented to fill it')
}

/* ——— 3. testimonial wall: imported text only ——————————————————— */
{
  const doc = { aspect: '16:9', fps: 30, backgroundId: 'b', clips: [], trackCount: 6 }
  const built = L.buildTestimonialGrid(doc, 3, 0)
  assert.ok(built.clips.length >= 3, 'three cards are laid out')
  const text = built.clips.filter((c) => c.kind === 'text')
  assert.ok(text.length > 0, 'the cards carry text slots')
  for (const c of text) {
    const t = (c.text || '').toLowerCase()
    // A placeholder may say "quote here"; it may never contain a fake quote.
    assert.ok(!/"[^"]{12,}"/.test(c.text || ''), `no fabricated quote in "${c.text}"`)
    assert.ok(!/\b(amazing|life[- ]changing|best|lost \d+|\d+\s*(kg|lbs|kilos|pounds))\b/.test(t), `no invented claim in "${c.text}"`)
    assert.ok(!/\b(sarah|john|emma|mike|jessica)\b/.test(t), `no invented person in "${c.text}"`)
  }
  const unfilled = L.unfilledPlaceholders({ ...doc, clips: built.clips })
  assert.ok(unfilled.length > 0, 'the empty slots are reported as unfilled, so they stay visibly empty')
}

/* ——— 4. before / after ————————————————————————————————————— */
{
  const before = { mediaId: 'a', fileName: 'before.jpg', kind: 'image' }
  const after = { mediaId: 'b', fileName: 'after.jpg', kind: 'image' }
  const clip = L.buildBeforeAfter(before, after, 0, 1, 4, 'sweep')
  assert.equal(clip.compare.beforeMediaId, 'a', 'the pair keeps both images')
  assert.equal(clip.compare.mode, 'sweep')

  let last = -1, moved = 0
  for (let i = 0; i <= 40; i += 1) {
    const d = L.compareDivider('sweep', 0.5, i / 40)
    assert.ok(d >= 0 && d <= 1, 'the divider stays on screen')
    if (last >= 0 && Math.abs(d - last) > 1e-6) moved += 1
    last = d
  }
  assert.ok(moved > 10, 'the sweep actually animates rather than sitting still')
  assert.equal(L.compareDivider('static', 0.5, 0), L.compareDivider('static', 0.5, 1), 'static mode holds, as named')
}

/* ——— 5. wired into the renderer and editable in the inspector ——— */
{
  const renderer = await read('src/lib/studio/renderer.ts')
  assert.match(renderer, /markRuns\(words, runSpec\(clip\.highlightRuns, clip\.highlightWord\)\)/, 'the renderer marks runs, legacy word included')
  assert.match(renderer, /clip\.highlightStyle === 'chip' && runCount > 0/, 'and draws chips when asked')
  assert.match(renderer, /ctx\.roundRect\(runFrom - padX/, 'one rounded box per run, measured across the whole run')
  assert.match(renderer, /chipReveal\(progress, marks\[i\]\.run, runCount\)/, 'the chip animates from clip progress only — preview equals export')

  const inspector = await read('src/screens/studio/StudioInspector.tsx')
  assert.match(inspector, /label="Highlight words"/, 'the phrase field is editable by hand')
  assert.match(inspector, /placeholder="e\.g\. six weeks, no gym"/, 'and shows how to write a phrase')
  assert.match(inspector, /label="Highlight style"/, 'the chip is a real choice, not a hidden flag')
  assert.match(inspector, /Only words actually in the text can highlight/, 'and the honest rule is stated in the UI')
}

console.log('JOB 13 check passed — highlight runs match phrases (longest first, case and punctuation tolerant) and never invent words, chips draw one box per run and grow purely from progress, collage places 2–8 photos with no overlap or overflow in all three aspects, testimonial cards import text only, and before/after really sweeps')
