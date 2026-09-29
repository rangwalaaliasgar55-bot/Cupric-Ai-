#!/usr/bin/env node
/**
 * Pro feature check (Part 2 remaining items + 1.8 backoff + Part 4).
 * Runs the real modules — timeline ops, colour, audio, text, layouts, curves,
 * suggestions, link licensing, agent ops — and statically checks the wiring.
 */
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { readFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const tmp = path.join(root, '.pro-features-check.mjs')
await build({
  bundle: true,
  outfile: tmp,
  format: 'esm',
  platform: 'node',
  logLevel: 'error',
  loader: { '.css': 'empty' },
  stdin: {
    contents: `
      export * as tl from './src/lib/studio/timelineOps'
      export * as color from './src/lib/studio/color'
      export * as audio from './src/lib/studio/audioMix'
      export * as text from './src/lib/studio/textTools'
      export * as layouts from './src/lib/studio/layouts'
      export * as curves from './src/lib/studio/curves'
      export * as sugg from './src/lib/studio/suggestions'
      export * as links from './src/lib/resourceLinks'
      export * as ops from './src/lib/studio/editOps'
      export * as lint from './src/lib/studio/lint'
      export { compositeFor, needsPixelGrade, keyframeValuesAt } from './src/lib/studio/renderer'
      export { defaultTextClip, defaultAudioClip, emptyStudioDoc } from './src/lib/studio/doc'
    `,
    resolveDir: root,
    sourcefile: 'check-pro-features.ts',
    loader: 'ts',
  },
})
const m = await import(`${pathToFileURL(tmp).href}?t=${Date.now()}`)
await rm(tmp, { force: true })
let n = 0
const ok = (cond, msg) => { assert.ok(cond, msg); n += 1 }
const eq = (a, b, msg) => { assert.deepEqual(a, b, msg); n += 1 }
const near = (a, b, eps, msg) => { assert.ok(Math.abs(a - b) <= eps, `${msg} (got ${a}, want ${b}±${eps})`); n += 1 }
const deepFreeze = (o) => { Object.freeze(o); for (const v of Object.values(o)) if (v && typeof v === 'object' && !Object.isFrozen(v)) deepFreeze(v); return o }

const ref = (id, kind = 'image', dur = 0) => ({ mediaId: id, fileName: `${id}.jpg`, localPath: null, kind, durationSec: dur })
const vid = (id, start, dur, track = 0, trimIn = 0, src = 20) => ({ ...m.layouts.mediaClip(ref(id, 'video', src), start, dur, track), id, trimInSec: trimIn })

/* ——— 2.1 timeline ops ——— */
{
  const doc = deepFreeze({ ...m.emptyStudioDoc(), clips: [vid('a', 0, 3), vid('b', 3, 2), vid('c', 5, 4), vid('x', 1, 2, 1)], markers: [{ id: 'm', at: 6, label: 'M', color: 'lime' }] })
  const r = m.tl.rippleDelete(doc, 'b')
  ok(r.changed && !r.doc.clips.some((c) => c.id === 'b'), 'ripple delete removes the clip')
  eq(r.doc.clips.find((c) => c.id === 'c').startSec, 3, 'ripple pulls later clips on the same track left')
  eq(r.doc.clips.find((c) => c.id === 'x').startSec, 1, 'ripple leaves other tracks alone')
  eq(r.doc.markers[0].at, 4, 'ripple moves later markers too')

  const q = m.tl.trimStartTo(doc, 'c', 6)
  eq([q.doc.clips.find((c) => c.id === 'c').startSec, q.doc.clips.find((c) => c.id === 'c').durationSec, q.doc.clips.find((c) => c.id === 'c').trimInSec], [6, 3, 1], 'Q trims the head and moves the source in-point')
  ok(!m.tl.trimStartTo(doc, 'c', 1).changed && m.tl.trimStartTo(doc, 'c', 1).reason, 'Q outside the clip explains itself (no silent no-op)')
  eq(m.tl.trimEndTo(doc, 'c', 7).doc.clips.find((c) => c.id === 'c').durationSec, 2, 'W trims the tail')

  const s1 = m.tl.slipClip(doc, 'a', 2)
  eq(s1.doc.clips.find((c) => c.id === 'a').trimInSec, 2, 'slip moves the source window')
  eq(m.tl.slipClip(doc, 'a', 999).doc.clips.find((c) => c.id === 'a').trimInSec, 17, 'slip clamps to the source length')
  ok(!m.tl.slipClip({ ...doc, clips: [{ ...m.defaultTextClip(0, 0), id: 't' }] }, 't', 1).changed, 'slip refuses non-media with a reason')

  const roll = m.tl.rollEdit(doc, 'a', 0.5)
  const ra = roll.doc.clips.find((c) => c.id === 'a'), rb = roll.doc.clips.find((c) => c.id === 'b')
  eq([ra.durationSec, rb.startSec, rb.durationSec, rb.trimInSec], [3.5, 3.5, 1.5, 0.5], 'roll moves the cut, right in-point follows')
  eq(ra.durationSec + rb.durationSec, 5, 'roll keeps total length')

  const gaps = m.tl.closeGaps({ ...doc, clips: [vid('a', 0, 2), vid('b', 4, 2)] })
  eq(gaps.doc.clips[1].startSec, 2, 'close gaps')
  ok(!m.tl.closeGaps(gaps.doc).changed, 'close gaps is idempotent and says so')

  const mk = m.tl.addMarker(doc, 2)
  ok(mk.changed && mk.doc.markers.length === 2 && mk.doc.markers[0].at === 2, 'M adds a sorted marker')
  ok(!m.tl.addMarker(mk.doc, 2.01).changed, 'no duplicate markers')
  eq(m.tl.jumpMarker(mk.doc, 3, 1), 6, 'jump to next marker')
  eq(m.tl.jumpMarker(mk.doc, 3, -1), 2, 'jump to previous marker')
}

/* ——— 2.2 curves ——— */
{
  near(m.curves.bezierEase([0, 0, 1, 1], 0.37), 0.37, 1e-3, 'linear bezier is identity')
  eq([m.curves.bezierEase([0.3, 1.5, 0.6, 1], 0), m.curves.bezierEase([0.3, 1.5, 0.6, 1], 1)], [0, 1], 'bezier endpoints')
  ok(Math.max(...Array.from({ length: 50 }, (_, i) => m.curves.bezierEase([0.3, 1.5, 0.6, 1], i / 49))) > 1, 'overshoot curve overshoots')
  const clip = { ...m.defaultTextClip(0, 0), keyframes: [{ at: 0, x: 0, ease: 'bezier', bezier: [0.7, 0, 1, 1] }, { at: 1, x: 1, ease: 'linear' }] }
  ok(m.keyframeValuesAt(clip, 0.5).x < 0.3, 'renderer uses the custom curve (slow-in is behind linear at 50%)')
}

/* ——— 2.3 / 2.17 colour ——— */
{
  const id = m.color.identityLut(5)
  const cubeText = ['TITLE "Id"', 'LUT_3D_SIZE 5', ...Array.from({ length: id.data.length / 3 }, (_, i) => id.data.slice(i * 3, i * 3 + 3).join(' '))].join('\n')
  const parsed = m.color.parseCube(cubeText)
  eq([parsed.name, parsed.size], ['Id', 5], '.cube parses title and size')
  const out = m.color.lookupLut(parsed, 0.3, 0.6, 0.9)
  near(out[0], 0.3, 1e-6, 'identity LUT R'); near(out[2], 0.9, 1e-6, 'identity LUT B')
  assert.throws(() => m.color.parseCube('LUT_1D_SIZE 4\n0 0 0'), /1D/); n += 1
  assert.throws(() => m.color.parseCube('LUT_3D_SIZE 64\n'), /supports up to/); n += 1
  assert.throws(() => m.color.parseCube('LUT_3D_SIZE 2\n0 0 0'), /entries/); n += 1

  const px = new Uint8ClampedArray([200, 100, 50, 255, 10, 20, 30, 255])
  const copy = px.slice()
  ok(!m.color.applyPixelGrade(copy, [m.color.neutralWheels()], null), 'neutral wheels are skipped')
  eq(Array.from(copy), Array.from(px), 'neutral wheels change nothing')
  const warm = px.slice()
  m.color.applyPixelGrade(warm, [{ ...m.color.neutralWheels(), gain: [40, 0, -40] }], null)
  ok(warm[0] > px[0] && warm[2] < px[2], 'gain wheels push channels')
  const inverted = { ...m.color.identityLut(2), data: [1, 1, 1, 0, 1, 1, 1, 0, 1, 0, 0, 1, 1, 1, 0, 0, 1, 0, 1, 0, 0, 0, 0, 0] }
  const inv = px.slice(); m.color.applyPixelGrade(inv, null, { ...inverted, strength: 1 })
  near(inv[0], 55, 1, 'LUT applies (invert)')

  const dark = new Uint8ClampedArray(64 * 64 * 4).map((_, i) => (i % 4 === 3 ? 255 : 30 + (i % 7)))
  const sc = m.color.computeScopes(dark, 64, 64)
  ok(sc.histogram.luma.length === 256 && sc.vectorscope.length === 4096 && sc.waveform.data.length === 64 * 64, 'scopes have the right shape')
  ok(sc.stats.meanLuma < 0.2, 'scope stats read a dark frame')
  const g = m.color.autoGrade(sc.stats)
  ok(g.nodes.find((x) => x.id === 'balance').exposure > 0, 'auto grade brightens a dark photo')
  ok(g.notes.length > 0, 'auto grade explains itself')
  eq(JSON.stringify(m.color.autoGrade(sc.stats)), JSON.stringify(g), 'auto grade is deterministic')

  const green = new Uint8ClampedArray([0, 255, 0, 255, 255, 0, 0, 255])
  m.color.chromaKey(green, '#00ff00', 0.2, 0.1)
  eq([green[3], green[7]], [0, 255], 'chroma key removes green, keeps red')
}

/* ——— 2.4 audio ——— */
{
  const music = { ...m.defaultAudioClip(0, 2, { id: 'mu', fileName: 'm.mp3', localPath: null, durationSec: 20 }), id: 'mu', fadeInSec: 0, fadeOutSec: 0, volume: 1 }
  const voice = { ...m.defaultAudioClip(5, 3, { id: 'vo', fileName: 'v.wav', localPath: null, durationSec: 5 }), id: 'vo', role: 'voice' }
  const doc = { ...m.emptyStudioDoc(), clips: [music, voice], ducking: { enabled: true, amountDb: -12, fadeSec: 0.5 } }
  near(m.audio.mixGainAt(doc, music, 2), 1, 1e-9, 'no ducking away from speech')
  near(m.audio.mixGainAt(doc, music, 7), Math.pow(10, -12 / 20), 1e-9, 'ducks by amountDb under speech')
  const ramp = m.audio.mixGainAt(doc, music, 4.75)
  ok(ramp < 1 && ramp > Math.pow(10, -12 / 20), 'ducking ramps in before speech (no click)')
  near(m.audio.mixGainAt(doc, voice, 7), m.audio.mixGainAt({ ...doc, ducking: null }, voice, 7), 1e-9, 'voice is never ducked')
  near(m.audio.mixGainAt({ ...doc, ducking: { ...doc.ducking, enabled: false } }, music, 7), 1, 1e-9, 'ducking off = untouched')

  const sr = 48000
  const sine = new Float32Array(sr * 3).map((_, i) => 0.1 * Math.sin((2 * Math.PI * 997 * i) / sr))
  near(m.audio.measureLufs([sine, sine], sr), -20.0, 0.3, 'BS.1770: stereo 997 Hz at −20 dBFS peak ≈ −20 LUFS')
  eq(m.audio.measureLufs([new Float32Array(sr)], sr), -Infinity, 'silence is −∞ LUFS')
  near(m.audio.normaliseGain(-20, -14), Math.pow(10, 6 / 20), 1e-9, 'normalise +6 dB')
  near(m.audio.normaliseGain(-60, -14), Math.pow(10, 12 / 20), 1e-9, 'normalise caps at +12 dB')
  const peaks = m.audio.computePeaks([sine], sr, 100)
  ok(peaks.length === 300 && Math.max(...peaks) <= 0.1001, 'waveform peaks')
  const enc = createRequire(import.meta.url)(path.join(root, 'electron/encoders.cjs'))
  eq(enc.loudnormArgs(-14), ['-af', 'loudnorm=I=-14:TP=-1.5:LRA=11'], 'export loudnorm args')
  eq(enc.loudnormArgs(0), [], 'invalid loudness target ignored')
}

/* ——— 2.5 / 2.12 / 2.18 text ——— */
{
  const caps = m.text.captionsFromTranscript('We build tools. They help small teams ship faster every single week', { startSec: 2, durationSec: 6, track: 3, maxWords: 4 })
  ok(caps.length >= 3, 'captions are chunked')
  near(caps[0].startSec, 2, 1e-9, 'captions start at the requested time')
  near(caps.reduce((a, c) => a + c.durationSec, 0), 6, 0.1, 'captions span the requested duration')
  eq(caps.map((c) => c.text).join(' '), 'We build tools. They help small teams ship faster every single week', 'captions contain exactly the transcript')
  const timed = m.text.captionsFromTranscript('', { startSec: 0, durationSec: 0, track: 0, words: [{ word: 'hi', start: 1, end: 1.4 }, { word: 'there.', start: 1.5, end: 2 }] })
  eq([timed[0].startSec, timed[0].text], [1, 'hi there.'], 'word timestamps override the estimate')
  const w0 = m.text.kineticWord(0, 4, 0), wEnd = m.text.kineticWord(3, 4, 1)
  eq([w0.alpha, wEnd.alpha, wEnd.scale, wEnd.dy], [0, 1, 1, 0], 'kinetic words start hidden and settle exactly')
  ok(m.text.kineticWord(3, 4, 0.2).alpha === 0 && m.text.kineticWord(0, 4, 0.2).alpha > 0, 'kinetic words land in order')
  const original = 'We really just make it very simple to ship video'
  const vs = m.text.localTextVariants(original)
  ok(vs.length >= 2, 'local variants exist')
  const vocab = new Set(original.toLowerCase().match(/[a-z]+/g))
  ok(vs.every((v) => (v.text.toLowerCase().match(/[a-z]+/g) ?? []).every((w) => vocab.has(w))), 'local variants never add words (no invented claims)')
  eq(m.text.parseVariantReply('1. Ship video fast\n- "Ship video fast"\n2) Make video simple\nWe really just make it very simple to ship video', original), ['Ship video fast', 'Make video simple'], 'model reply parsing dedupes and drops the original')
  ok(m.text.safeAreas('9:16').some((b) => b.id === 'social') && !m.text.safeAreas('16:9').some((b) => b.id === 'social'), 'social safe area only for 9:16')
  for (const p of m.text.TEXT_PRESETS) ok(p.patch.x === undefined || (p.patch.x >= 0.1 && p.patch.x <= 0.9 && p.patch.y >= 0.1 && p.patch.y <= 0.9), `preset ${p.id} sits in title-safe`)
}

/* ——— 2.15 / 2.16 / 2.19–2.23 layouts ——— */
{
  for (const d of ['phone', 'laptop', 'browser']) {
    const g = m.layouts.deviceGeometry(d, 0, 0, 1000, 800)
    ok(g.screen.x >= g.body.x && g.screen.y >= g.body.y && g.screen.x + g.screen.w <= g.body.x + g.body.w + 0.01 && g.screen.w > 0, `${d} screen sits inside its body`)
  }
  for (const p of m.layouts.PRODUCT_PRESETS) {
    const a = m.layouts.productPresetKeyframes(p, 3)
    eq(JSON.stringify(a), JSON.stringify(m.layouts.productPresetKeyframes(p, 3)), `${p} is deterministic`)
    ok(a.every((k) => k.at >= 0 && k.at <= 3), `${p} keys stay inside the clip`)
  }
  eq(m.layouts.productPresetKeyframes('hero-reveal', 3)[0].opacity, 0, 'hero-reveal starts hidden')
  for (const r of m.layouts.LOGO_REVEALS) ok(m.layouts.logoRevealKeyframes(r, 2).at(-1).opacity !== 0, `${r} ends visible`)

  for (const count of [1, 2, 3, 4, 5, 7, 9]) {
    for (const aspect of ['9:16', '1:1', '16:9']) {
      const cells = m.layouts.collageCells(count, aspect)
      ok(cells.length === count && cells.every((c) => c.x >= 0 && c.y >= 0 && c.x + c.w <= 1.0001 && c.y + c.h <= 1.0001), `collage ${count} @ ${aspect} fits the frame`)
      const overlap = cells.some((a, i) => cells.some((b, j) => i < j && a.x < b.x + b.w - 1e-6 && b.x < a.x + a.w - 1e-6 && a.y < b.y + b.h - 1e-6 && b.y < a.y + a.h - 1e-6))
      ok(!overlap, `collage ${count} @ ${aspect} cells never overlap`)
    }
  }
  const base = { ...m.emptyStudioDoc(), aspect: '1:1' }
  const col = m.layouts.buildCollage(base, [ref('p1'), ref('p2'), ref('p3')], 1)
  ok(col.clips.length === 3 && col.clips.every((c) => c.mask?.shape === 'rect'), 'collage clips are matted into cells')

  const grid = m.layouts.buildTestimonialGrid(base, 3, 0)
  const texts = grid.clips.filter((c) => c.kind === 'text').map((c) => c.text)
  ok(texts.length === 6 && texts.every((t) => t === m.layouts.TESTIMONIAL_PLACEHOLDER || t === m.layouts.ATTRIBUTION_PLACEHOLDER), 'testimonials are placeholders only — never written')
  ok(m.lint.lintStudioDoc(grid.doc).some((i) => i.id.startsWith('placeholder:')), 'export checks flag unfilled testimonials')

  const ba = m.layouts.buildBeforeAfter(ref('before'), ref('after'), 0, 0)
  eq([ba.mediaId, ba.compare.beforeMediaId], ['after', 'before'], 'before/after uses the user’s two images')
  eq(m.layouts.compareDivider('sweep', 0.5, 0), 0.98, 'sweep starts on BEFORE')
  near(m.layouts.compareDivider('sweep', 0.5, 1), 0.5, 1e-9, 'sweep settles on the split')
  eq(m.layouts.compareDivider('static', 0.3, 0.7), 0.3, 'static split holds')

  for (const kind of ['startup', 'business', 'product']) {
    const built = m.layouts.buildFromAssets(base, kind, { name: 'Acme', photos: [ref('a'), ref('b')], clips: [], logo: ref('logo'), tagline: 'Make it simple', cta: 'Try it' })
    const txt = built.doc.clips.filter((c) => c.kind === 'text').map((c) => c.text)
    const allowed = new Set(['Acme', 'Make it simple', 'Try it', m.layouts.TESTIMONIAL_PLACEHOLDER, m.layouts.ATTRIBUTION_PLACEHOLDER])
    ok(txt.every((t) => allowed.has(t)), `${kind} intake only uses the user’s words or placeholders`)
    ok(built.doc.clips.some((c) => c.mediaId === 'logo' && c.keyframes?.length), `${kind} intake opens on a logo reveal`)
    ok(built.doc.clips.every((a, i) => built.doc.clips.every((b, j) => i >= j || a.track !== b.track || a.startSec + a.durationSec <= b.startSec + 0.006 || b.startSec + b.durationSec <= a.startSec + 0.006)), `${kind} intake has no overlapping clips`)
  }
  const bare = m.layouts.buildFromAssets(base, 'business', { name: '', photos: [], clips: [] })
  ok(bare.notes.some((x) => /logo/i.test(x)) && bare.notes.some((x) => /call-to-action/i.test(x)), 'missing assets are called out, not invented')
}

/* ——— 2.9 suggestions: preview never mutates ——— */
{
  const doc = deepFreeze({ ...m.emptyStudioDoc(), clips: [vid('a', 0, 2), vid('b', 3, 2), { ...m.layouts.mediaClip(ref('p'), 5, 4, 0), id: 'p' }, { ...m.defaultTextClip(0, 1), id: 't', text: 'one two three four five six', durationSec: 0.5 }] })
  const list = m.sugg.suggestEdits(doc)
  const ids = list.map((s) => s.id)
  ok(ids.includes('close-gaps') && ids.includes('photo-motion') && ids.includes('read-time'), 'suggestions find gaps, still photos, fast text')
  for (const s of list) {
    const next = s.apply(doc) // throws if it mutated the frozen doc
    ok(next !== doc, `suggestion ${s.id} returns a new doc`)
  }
  ok(!m.sugg.suggestEdits(m.sugg.suggestEdits(doc).find((s) => s.id === 'close-gaps').apply(doc)).some((s) => s.id === 'close-gaps'), 'accepting a suggestion resolves it')
}

/* ——— Part 4 link licensing ——— */
{
  const v = (u) => m.links.checkResourceLink(u)
  eq(v('https://www.capcut.com/templates/123').status, 'blocked', 'CapCut is refused')
  eq(v('https://www.dafont.com/foo.font').status, 'blocked', 'DaFont is refused')
  eq(v('https://elements.envato.com/x').status, 'blocked', 'paid marketplaces are refused')
  eq(v('https://www.tiktok.com/@a/video/1').status, 'blocked', 'social posts are refused')
  const un = v('https://unsplash.com/photos/abc-123')
  ok(un.status === 'allowed' && un.sourceLicense && un.attribution, 'Unsplash allowed with licence + attribution')
  const unknown = v('https://example.org/pic.png')
  ok(unknown.status === 'unverified' && unknown.requiresConfirmation && unknown.kind === 'image', 'unknown sources need a rights confirmation')
  eq(v('ftp://x.org/a').status, 'blocked', 'non-http refused'); eq(v('not a url').status, 'blocked', 'garbage refused')
  const gh = v('https://github.com/lottie/anim')
  eq(m.links.githubRepoOf(gh.url), 'lottie/anim', 'repo id for licence lookup')
  eq(m.links.withRepoLicense(gh, 'MIT').status, 'allowed', 'MIT repo allowed')
  ok(m.links.withRepoLicense(gh, 'GPL-3.0').requiresConfirmation, 'copyleft repo needs confirmation')
  ok(m.links.withRepoLicense(gh, null).requiresConfirmation, 'unlicensed repo = all rights reserved')
}

/* ——— 2.11 agent ops ——— */
{
  const pic = { ...m.layouts.mediaClip(ref('p'), 0, 3, 0), id: 'pic' }
  const t = { ...m.defaultTextClip(0, 1), id: 'txt' }
  const au = { ...m.defaultAudioClip(0, 2, { id: 'au', fileName: 'a.mp3', localPath: null, durationSec: 10 }), id: 'au' }
  const doc = { ...m.emptyStudioDoc(), clips: [pic, t, au] }
  const plan = m.ops.validateStudioEditPlan({ summary: 's', ops: [
    { type: 'productMotion', clipId: 'pic', preset: 'orbit' },
    { type: 'setDevice', clipId: 'pic', device: 'phone' },
    { type: 'setBlend', clipId: 'txt', mode: 'screen' },
    { type: 'textPreset', clipId: 'txt', preset: 'lower-third' },
    { type: 'setAudioRole', clipId: 'au', role: 'music' },
    { type: 'setDucking', enabled: true, amountDb: -99 },
    { type: 'addMarker', at: 1.5, label: 'Beat' },
    { type: 'addTestimonialGrid', count: 2, startSec: 3 },
    { type: 'addCaptions', transcript: 'hello world', startSec: 0, durationSec: 2 },
    { type: 'setDevice', clipId: 'txt', device: 'phone' },
    { type: 'deleteEverything' },
    { type: 'setBlend', clipId: 'nope', mode: 'screen' },
  ] }, doc)
  eq(plan.ops.length, 9, 'valid new ops pass; invented / wrong-kind ops are dropped')
  ok(/Skipped 3/.test(plan.warning ?? ''), 'dropped ops are reported')
  eq(plan.ops.find((o) => o.type === 'setDucking').amountDb, -30, 'agent values are clamped')
  const out = m.ops.applyStudioEditPlan(doc, plan.ops)
  const p2 = out.clips.find((c) => c.id === 'pic')
  ok(p2.device === 'phone' && p2.motionPreset === 'orbit' && p2.keyframes.length === 3, 'agent can frame and move photos')
  ok(out.clips.find((c) => c.id === 'txt').blendMode === 'screen', 'agent can set blend')
  ok(out.ducking.enabled && out.markers.length === 1, 'agent can duck and mark')
  ok(out.clips.filter((c) => c.kind === 'text' && c.text === m.layouts.TESTIMONIAL_PLACEHOLDER).length === 2, 'agent testimonial cards are placeholders')
  const comp = m.ops.validateStudioEditPlan({ summary: 's', ops: [{ type: 'addComponent', slug: 'like-button', startSec: 0, durationSec: 12 }] }, doc)
  const withComp = m.ops.applyStudioEditPlan(doc, comp.ops)
  eq(withComp.clips.find((c) => c.kind === 'overlay').component.recordSec, 12, 'agent components record their full length (old 6 s cap removed)')
}

/* ——— renderer helpers ——— */
eq([m.compositeFor('add'), m.compositeFor(undefined), m.compositeFor('multiply')], ['lighter', 'source-over', 'multiply'], 'blend modes map to canvas ops'); 
ok(m.needsPixelGrade({ grade: [{ ...m.color.neutralWheels(), lift: [5, 0, 0] }] }) && !m.needsPixelGrade({ grade: [m.color.neutralWheels()] }), 'only real wheel/LUT work takes the pixel path')

/* ——— wiring (static) ——— */
const read = (p) => readFileSync(path.join(root, p), 'utf8')
const studio = read('src/screens/Studio.tsx')
for (const k of ["key === 'q'", "key === 'w'", "key === 'm'", 'rippleDelete(doc', 'slipClip(doc', 'rollEdit(doc', 'runExportQueue(', 'unfilledPlaceholders(doc)', 'onDropAt={onTimelineDrop}', '<StudioProPanel', 'previewDoc?.doc ?? doc']) ok(studio.includes(k), `Studio wires ${k}`)
ok(/patchStudio\(pid, \{[^}]*\}, label\)/.test(studio), 'timeline keys commit one labelled undo step')
ok(read('src/screens/studio/StudioInspector.tsx').includes('<ClipProFields') && read('src/screens/studio/StudioInspector.tsx').includes('<CurveEditor'), 'inspector wires clip pro controls + curve editor')
ok(read('src/screens/studio/StudioTimeline.tsx').includes('doc.markers') && read('src/screens/studio/StudioTimeline.tsx').includes('onDropAt('), 'timeline draws markers and accepts drops')
ok(read('src/lib/studio/export.ts').includes('mixGainAt(doc, clip') && read('src/screens/studio/StudioPreview.tsx').includes('mixGainAt(doc, audio'), 'preview and export use the same ducking gain')
const main = read('electron/main.cjs')
const assembly = read('electron/assembly.cjs')
ok(/AI_BACKOFF_MS = \[1000, 4000\]/.test(main) && main.includes('askWithBackoff()'), '1.8: 1 s / 4 s backoff on transient AI errors')
ok(assembly.includes('function loudnessPlan(') && main.includes('assembly.loudnormMeasureArgs(source, target)') && main.includes('assembly.loudnessPlan({'),
  '2.4/assembly: the MP4 export measures the recording first and applies the loudness decision, not a fixed dynamic filter')
ok(/loudness: \{ mode: loudness\.mode, note: loudness\.note, why: loudness\.why \}/.test(main), 'and reports which correction ran, so the toast can say it')
for (const op of ['rippleDelete', 'productMotion', 'setDucking', 'addTestimonialGrid', 'addCaptions']) ok(main.includes(`"type":"${op}"`), `agent prompt documents ${op}`)
const renderer = read('src/lib/studio/renderer.ts')
ok(!/Math\.random|Date\.now|performance\.now/.test(renderer + read('src/lib/studio/layouts.ts') + read('src/lib/studio/color.ts') + read('src/lib/studio/textTools.ts') + read('src/lib/studio/curves.ts') + read('src/lib/studio/audioMix.ts')), 'renderer purity: no clock or randomness in the new motion/colour/audio code')

console.log(`pro features check passed — ${n} assertions: timeline trim/ripple/slip/roll/markers, curves, wheels/LUT/scopes/auto-grade/chroma, ducking/LUFS, captions/kinetic/variants, device/product/collage/testimonial/before-after/logo/intake, suggestions, link licensing, agent ops, backoff`)
