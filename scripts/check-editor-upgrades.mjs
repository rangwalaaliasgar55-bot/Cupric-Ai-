#!/usr/bin/env node
/**
 * Editor upgrades: channel formats / Ultra HD, hidden-muted-variables output
 * pass, clip context-menu actions + lock, scenes, variables, event bus,
 * scripting API, auto-edit (beats, tighten speech, reframe, pacing),
 * word-timed components, Phone Studio (geometry, motion, apps, purity),
 * phoneDesign agent op.
 */
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { readFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const tmp = path.join(root, '.editor-upgrades-check.mjs')
await build({
  bundle: true, outfile: tmp, format: 'esm', platform: 'node', logLevel: 'error', jsx: 'automatic',
  loader: { '.tsx': 'tsx', '.css': 'empty', '.svg': 'dataurl', '.png': 'dataurl', '.jpg': 'dataurl' },
  stdin: {
    contents: [
      "export * as formats from './src/lib/studio/formats'",
      "export * as docm from './src/lib/studio/doc'",
      "export * as resolve from './src/lib/studio/resolve'",
      "export * as actions from './src/lib/studio/clipActions'",
      "export * as scenes from './src/lib/studio/scenes'",
      "export * as events from './src/lib/studio/studioEvents'",
      "export * as api from './src/lib/studio/studioApi'",
      "export * as auto from './src/lib/studio/autoEdit'",
      "export * as director from './src/lib/studio/componentDirector'",
      "export * as phone from './src/lib/studio/phone'",
      "export * as ops from './src/lib/studio/editOps'",
      "export * as sugg from './src/lib/studio/suggestions'",
      "export * as caps from './src/lib/studio/autoCaptions'",
      "export * as tl from './src/lib/studio/timelineOps'",
    ].join('\n'),
    resolveDir: root, loader: 'ts',
  },
})
const m = await import(`${pathToFileURL(tmp).href}?t=${Date.now()}`)
await rm(tmp, { force: true })
let n = 0
const ok = (c, msg) => { assert.ok(c, msg); n += 1 }
const throws = (fn, re, msg) => { assert.throws(fn, re, msg); n += 1 }

const base = () => ({
  aspect: '16:9', fps: 30, backgroundId: 'bg', trackCount: 3, clips: [
    { id: 'v1', kind: 'video', mediaId: 'm1', fileName: 'a.mp4', localPath: null, track: 0, startSec: 0, durationSec: 4, trimInSec: 0, sourceDurationSec: 30, speed: 1, volume: 1, fit: 'cover', name: 'Shot A', transitionIn: 'none', transitionOut: 'none', opacity: 1 },
    { id: 'v2', kind: 'video', mediaId: 'm2', fileName: 'b.mp4', localPath: null, track: 0, startSec: 4, durationSec: 4, trimInSec: 2, sourceDurationSec: 30, speed: 1, volume: 1, fit: 'cover', name: 'Shot B', transitionIn: 'none', transitionOut: 'none', opacity: 1 },
    { ...m.docm.defaultTextClip(1, 1), id: 't1', text: 'Only {{price}} today', durationSec: 3 },
  ],
})

/* formats */
ok(JSON.stringify(m.docm.sizeForAspect('16:9', '2160p')) === '[3840,2160]' && JSON.stringify(m.docm.sizeForAspect('9:16', '2160p')) === '[2160,3840]', 'Ultra HD sizes')
ok(JSON.stringify(m.docm.sizeForAspect('4:5')) === '[1080,1350]' && JSON.stringify(m.docm.sizeForAspect('16:9')) === '[1920,1080]', '4:5 feed + 1080p default')
for (const a of ['16:9', '9:16', '1:1', '4:5']) for (const r of ['720p', '1080p', '1440p', '2160p']) ok(m.docm.sizeForAspect(a, r).every((v) => v % 2 === 0), `${a}@${r} even`)
ok(m.formats.CHANNEL_PRESETS.some((p) => p.id === 'ig-reel') && m.formats.CHANNEL_PRESETS.some((p) => p.resolution === '2160p'), 'channel presets include reels and UHD')
ok(m.formats.matchingPreset({ aspect: '4:5', resolution: '1080p', fps: 30 })?.id === 'ig-feed', 'preset matching')
ok(m.formats.presetWarnings(m.formats.CHANNEL_PRESETS.find((p) => p.id === 'ig-story'), 90).some((w) => /60s/.test(w)), 'length warning for stories')

/* resolve: hidden, muted, variables */
{
  const d = base()
  d.variables = [{ name: 'price', value: '₹499' }]
  d.clips[1] = { ...d.clips[1], hidden: true }
  d.clips[0] = { ...d.clips[0], muted: true }
  d.clips.push({ ...m.docm.defaultTextClip(5, 1), id: 't2', text: 'Hi {{nobody}}' })
  const r = m.resolve.resolveForOutput(d)
  ok(!r.clips.some((c) => c.id === 'v2'), 'hidden clip not output')
  ok(r.clips.find((c) => c.id === 'v1').volume === 0, 'muted clip silent')
  ok(r.clips.find((c) => c.id === 't1').text === 'Only ₹499 today', 'variable substituted')
  ok(r.clips.find((c) => c.id === 't2').text === 'Hi {{nobody}}', 'unknown variable stays visible')
  ok(m.resolve.resolveForOutput(d) === r && d.clips[0].volume === 1, 'cached and non-mutating')
  ok(JSON.stringify(m.resolve.variablesUsed(d)) === '["nobody","price"]', 'variables used')
}
const read = (p) => readFileSync(path.join(root, p), 'utf8')
ok(read('src/lib/studio/export.ts').includes('const doc = resolveForOutput(editDoc)') && read('src/screens/studio/StudioPreview.tsx').includes('resolveForOutput(editDoc)'), 'preview and export share the resolve pass')

/* clip actions */
{
  const d = base()
  const A = m.actions
  let r = A.applyClipAction(d, 'v1', 'copy', { time: 0, clipboard: null })
  ok(r.clipboard?.id === 'v1' && !r.doc, 'copy fills clipboard only')
  const cb = r.clipboard
  r = A.applyClipAction(d, null, 'paste', { time: 10, clipboard: cb })
  const pasted = r.doc.clips.find((c) => c.id === r.select)
  ok(pasted && pasted.startSec === 10 && pasted.id !== 'v1' && r.label === 'Paste clip', 'paste at playhead with new id')
  r = A.applyClipAction(d, 'v1', 'duplicate', { time: 0, clipboard: null })
  ok(r.doc.clips.length === 4 && r.doc.clips.find((c) => c.id === r.select).startSec === 4 && r.doc.clips.find((c) => c.id === r.select).track !== 0, 'duplicate goes after, never overlapping')
  r = A.applyClipAction(d, 'v1', 'split', { time: 2, clipboard: null })
  ok(r.doc.clips.filter((c) => c.kind === 'video').length === 3, 'split at playhead')
  ok(A.applyClipAction(d, 'v1', 'split', { time: 7, clipboard: null }).message, 'split outside refuses with reason')
  r = A.applyClipAction(d, 'v1', 'lock', { time: 0, clipboard: null })
  const locked = r.doc
  for (const a of ['cut', 'delete', 'ripple-delete', 'split', 'flip-x', 'bring-forward', 'hide', 'mute', 'to-playhead']) {
    const res = A.applyClipAction(locked, 'v1', a, { time: 2, clipboard: null })
    ok(!res.doc && /locked/.test(res.message), `locked refuses ${a}`)
  }
  ok(A.applyClipAction(locked, 'v1', 'copy', { time: 0, clipboard: null }).clipboard, 'locked still copies')
  ok(A.applyClipAction(locked, 'v1', 'lock', { time: 0, clipboard: null }).doc.clips.find((c) => c.id === 'v1').locked === false, 'unlock')
  ok(A.clipMenu(locked.clips[0], { time: 2, hasClipboard: false }).find((i) => i.id === 'delete').disabled === 'Unlock the clip first', 'menu explains disabled items')
  r = A.applyClipAction(d, 'v1', 'flip-x', { time: 0, clipboard: null })
  ok(r.doc.clips.find((c) => c.id === 'v1').flipX === true && r.label === 'Flip horizontal', 'flip')
  r = A.applyClipAction(d, 't1', 'send-backward', { time: 0, clipboard: null })
  const moved = r.doc.clips.find((c) => c.id === 't1')
  ok(!r.doc.clips.some((c) => c.id !== 't1' && c.track === moved.track && c.startSec < moved.startSec + moved.durationSec && moved.startSec < c.startSec + c.durationSec), 'arrange never overlaps')
  ok(A.applyClipAction(d, 't1', 'mute', { time: 0, clipboard: null }).message === undefined ? false : true, 'text cannot be muted (reason given)')
  ok(!A.clipMenu(d.clips[2], { time: 0, hasClipboard: true }).some((i) => i.id === 'mute'), 'mute only offered for clips with sound')
}
const studio = read('src/screens/Studio.tsx')
ok(studio.includes("c: 'copy', x: 'cut', v: 'paste', d: 'duplicate'") && studio.includes('<ClipContextMenu') && studio.includes('onContextMenu'), 'hotkeys + timeline and canvas menus wired')
ok(read('src/screens/studio/StudioTimeline.tsx').includes('if (clip.locked) return'), 'timeline will not drag/trim locked clips')
ok(read('src/lib/studio/renderer.ts').match(/(ctx|target)\.scale\(clip\.flipX \? -1 : 1, clip\.flipY \? -1 : 1\)/), 'renderer flips')

/* scenes + variables */
{
  let d = base()
  const s1 = m.scenes.saveScene(d, 'Cut A', '2026-01-01T00:00:00Z')
  d = s1.doc
  ok(d.scenes.length === 1 && !('scenes' in d.scenes[0].doc), 'scene snapshot excludes scene list')
  const edited = { ...d, clips: d.clips.slice(0, 1) }
  const loaded = m.scenes.loadScene(edited, s1.scene.id)
  ok(loaded.clips.length === 3 && loaded.scenes.length === 1, 'load restores clips, keeps scenes')
  loaded.clips[0].name = 'changed'
  ok(d.scenes[0].doc.clips[0].name === 'Shot A', 'loading deep-copies (scene not mutated)')
  ok(m.scenes.duplicateScene(d, s1.scene.id).scenes.length === 2 && m.scenes.deleteScene(d, s1.scene.id).scenes.length === 0, 'duplicate/delete')
  ok(m.scenes.renameScene(d, s1.scene.id, '  Final ').scenes[0].name === 'Final', 'rename trims')
  d = m.scenes.setVariable(d, 'price', '₹1')
  d = m.scenes.setVariable(d, 'PRICE', '₹2')
  ok(d.variables.length === 1 && d.variables[0].value === '₹2', 'variables are case-insensitive upserts')
  throws(() => m.scenes.setVariable(d, '1bad', 'x'), /start with a letter/, 'bad variable name refused')
}

/* events */
{
  const d = base()
  const next = { ...d, clips: [...d.clips.slice(1), { ...d.clips[0], startSec: 1 }, { ...d.clips[2], id: 'new' }] }
  const evs = m.events.diffDocs(d, next).map((e) => e.event)
  ok(evs.includes('doc:change') && evs.includes('clip:add') && evs.includes('clip:change') && !evs.includes('timeline:change'), `diff events (${evs.join(',')})`)
  ok(m.events.diffDocs(d, { ...d, clips: [...d.clips, { ...d.clips[0], id: 'late', startSec: 20 }] }).some((e) => e.event === 'timeline:change'), 'timeline:change when length changes')
  let got = null
  const off = m.events.onStudio('clip:remove', (p) => { got = p.clip.id })
  m.events.emitDiff(d, { ...d, clips: d.clips.slice(1) })
  off()
  ok(got === 'v1', 'subscribers receive clip:remove')
  const off2 = m.events.onStudio('doc:change', () => { throw new Error('bad plugin') })
  const origErr = console.error; console.error = () => {}
  m.events.emitStudio('doc:change', { doc: d })
  console.error = origErr
  off2()
  ok(true, 'a throwing subscriber does not break emit'); 
}

/* scripting API */
{
  let doc = base()
  const labels = []
  const api = m.api.createStudioApi({ getDoc: () => doc, commit: (d, l) => { doc = d; labels.push(l) }, getSelected: () => null, select() {}, getTime: () => 0, seek() {} })
  const sid = api.scenes.save('Script scene')
  ok(api.scenes.list()[0].id === sid, 'api scenes')
  api.blocks.apply([{ type: 'addText', text: 'From a script', track: 2, startSec: 2, durationSec: 2 }], 'Script add')
  ok(doc.clips.some((c) => c.kind === 'text' && c.text === 'From a script') && labels.at(-1) === 'Script add', 'api blocks.apply goes through the validated op path')
  throws(() => api.blocks.apply([{ type: 'nukeEverything' }]), /./, 'invalid op refused')
  throws(() => api.blocks.update('v1', { kind: 'text' }), /Cannot patch kind/, 'structural patch refused')
  api.blocks.update('v1', { opacity: 0.5 })
  ok(doc.clips.find((c) => c.id === 'v1').opacity === 0.5, 'api update')
  api.variables.set('price', '₹99')
  ok(api.scenes.export().clips.find((c) => c.id === 't1').text === 'Only ₹99 today', 'api export resolves variables')
  api.formats.apply('uhd')
  ok(doc.resolution === '2160p' && doc.aspect === '16:9', 'api formats')
  ok(labels.length >= 5 && labels.every(Boolean), 'every api mutation is a labelled undo step')
}

/* auto-edit: beats */
{
  const sr = 22050, dur = 12, bpm = 120, period = 0.5, phase = 0.21
  const x = new Float32Array(sr * dur)
  let seed = 3; const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648) - 0.5
  for (let i = 0; i < x.length; i += 1) x[i] = rnd() * 0.04
  for (let b = phase; b < dur; b += period) { const s = Math.floor(b * sr); for (let k = 0; k < 1500 && s + k < x.length; k += 1) x[s + k] += Math.exp(-k / 250) * Math.sin((2 * Math.PI * 70 * k) / sr) }
  const r = m.auto.detectBeats(x, sr)
  ok(Math.abs(r.bpm - bpm) < 2, `tempo ${r.bpm}`)
  const inner = r.times.filter((t) => t > 1 && t < dur - 1)
  ok(inner.every((t) => Math.abs(((t - phase) / period) - Math.round((t - phase) / period)) * period < 0.05), 'beats within 50 ms')
  const d = base()
  d.clips.push({ id: 'mu', kind: 'audio', mediaId: 'mm', fileName: 'm.mp3', localPath: null, track: 2, startSec: 0, durationSec: 8, trimInSec: 0, sourceDurationSec: 60, volume: 1, name: 'Music', transitionIn: 'none', transitionOut: 'none', opacity: 1, beats: { bpm: 120, times: [0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4.2, 4.7, 5.2] } })
  const s = m.auto.snapCutsToBeats(d)
  const a2 = s.doc.clips.find((c) => c.id === 'v1'), b2 = s.doc.clips.find((c) => c.id === 'v2')
  ok(s.moved === 1 && Math.abs(a2.durationSec - 4.2) < 1e-6 && Math.abs(b2.startSec - 4.2) < 1e-6 && Math.abs(b2.trimInSec - 2.2) < 1e-6, 'cut rolled onto the beat (trim follows)')
  ok(m.sugg.suggestEdits(d).some((x) => x.id === 'beat-sync'), 'beat-sync suggestion')
}

/* auto-edit: tighten speech */
{
  const words = [
    { word: 'So', start: 0.2, end: 0.4 }, { word: 'um', start: 0.5, end: 0.8 }, { word: 'this', start: 0.9, end: 1.1 },
    { word: 'is', start: 1.1, end: 1.2 }, { word: 'great.', start: 1.2, end: 1.6 }, { word: 'Buy', start: 3.2, end: 3.5 }, { word: 'it', start: 3.5, end: 3.7 },
  ]
  const d = base()
  d.clips[0] = { ...d.clips[0], words, durationSec: 4 }
  d.clips.push({ ...m.docm.defaultTextClip(3.2, 2), id: 'cap', text: 'Buy it', durationSec: 0.6 })
  const r = m.auto.tightenClip(d, 'v1')
  ok(r.cuts === 2 && r.removedSec > 1.5 && r.removedSec < 2.2, `filler + long pause removed (${r.cuts} cuts, ${r.removedSec}s)`)
  const parts = r.doc.clips.filter((c) => c.mediaId === 'm1').sort((a, b) => a.startSec - b.startSec)
  ok(parts.length === 3 && parts.every((p, i) => i === 0 || Math.abs(p.startSec - (parts[i - 1].startSec + parts[i - 1].durationSec)) < 1e-3), 'kept pieces butt together')
  const buy = parts[2]
  const cap = r.doc.clips.find((c) => c.id === 'cap')
  const buyTimeline = buy.startSec + (3.2 - buy.trimInSec)
  ok(Math.abs(cap.startSec - buyTimeline) < 0.02, `caption stays on its word (${cap.startSec} vs ${buyTimeline.toFixed(3)})`)
  ok(r.doc.clips.find((c) => c.id === 'v2').startSec < 4, 'later clips ripple left')
  ok(m.auto.tightenClip(base(), 'v1').reason?.includes('Transcribe'), 'no words → honest reason')
  ok(m.sugg.suggestEdits(d).some((x) => x.id === 'tighten-v1'), 'tighten suggestion')
}

/* auto-edit: reframe */
{
  const clip = { ...base().clips[0], durationSec: 4 }
  const samples = [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4].map((t) => ({ t, cx: t < 2 ? 0.3 : 0.75, weight: 1 }))
  const r = m.auto.reframePatch(clip, samples, 9 / 16, 16 / 9)
  const s = (16 / 9) / (9 / 16)
  ok(r.patch.fit === 'contain' && Math.abs(r.patch.scale - s) < 1e-3, 'source height fills the portrait frame')
  const xs = r.patch.keyframes.map((k) => k.x)
  ok(xs[0] > 0.5 && xs.at(-1) < 0.5, 'pans from left subject to right subject')
  const lo = 0.5 - (s - 1) / 2, hi = 0.5 + (s - 1) / 2
  ok(xs.every((x) => x >= lo - 1e-9 && x <= hi + 1e-9), 'never reveals an edge')
  ok(m.auto.reframePatch(clip, samples, 16 / 9, 16 / 9).reason, 'already fits → reason')
  const jitter = [0, 0.5, 1, 1.5, 2].map((t, i) => ({ t, cx: 0.5 + (i % 2 ? 0.02 : -0.02), weight: 1 }))
  ok(m.auto.reframePatch(clip, jitter, 9 / 16, 16 / 9).patch.keyframes.length === 2, 'deadzone ignores jitter')
}

/* pacing */
{
  const d = base()
  d.clips = d.clips.filter((c) => c.kind !== 'text')
  d.clips[0].durationSec = 6
  const issues = m.auto.pacingIssues(d)
  ok(issues.some((i) => i.id === 'hook') && issues.some((i) => i.id === 'punch-in'), 'pacing finds hook + long static shot')
  const hooked = issues.find((i) => i.id === 'hook').apply(d)
  ok(hooked.clips.some((c) => c.kind === 'text' && c.startSec === 0 && /Your hook/.test(c.text)), 'hook is an editable placeholder, not invented copy')
}

/* word-timed components */
{
  const d = base()
  d.clips[0] = { ...d.clips[0], words: [{ word: 'Only', start: 1.4, end: 1.6 }, { word: '₹499', start: 1.9, end: 2.3 }], durationSec: 4 }
  d.clips[2] = { ...d.clips[2], text: 'Only ₹499/month', durationSec: 3 }
  d.clips.push({ ...d.clips[1], id: 'v3', startSec: 8, durationSec: 10, trimInSec: 0, hidden: false })
  const mo = m.director.directComponents(d)
  const price = mo.find((x) => x.cue === 'price')
  ok(price && Math.abs(price.startSec - 1.9) < 0.01 && /spoken word/.test(price.reason), `component lands on the spoken word (${price?.startSec})`)
}

/* captions keep words on the clip */
{
  const d = base()
  const r = m.caps.captionsForClip(d, d.clips[0], [{ word: 'Hello', start: 0.1, end: 0.5 }])
  ok(r.doc.clips.find((c) => c.id === 'v1').words?.length === 1, 'transcribed words saved on the source clip')
}

/* phone */
{
  const P = m.phone
  const g = P.phoneGeometry({ x: 0, y: 0, w: 900, h: 1950 })
  ok(Math.abs(g.body.w / g.body.h - 9 / 19.5) < 1e-6 && g.screen.x > g.bezel.x && g.bezel.x > g.body.x, 'frame → bezel → display nesting')
  for (const mo of P.PHONE_MOTIONS) {
    const a = P.phonePose(mo.id, 0.7, 4), b = P.phonePose(mo.id, 0.7, 4)
    ok(JSON.stringify(a) === JSON.stringify(b) && Object.values(a).every(Number.isFinite), `${mo.id} deterministic + finite`)
    const settled = P.phonePose(mo.id, 3, 4)
    ok(Math.abs(settled.dx) < 0.05 && Math.abs(settled.scale - 1) < 0.08 && settled.squashX > 0.95, `${mo.id} settles`)
  }
  ok(P.phonePose('spin-reveal', 0, 4).squashX < 0.2, 'spin starts edge-on')
  ok(P.countUp('₹1,499', 0) === '₹0' && P.countUp('₹1,499', 1) === '₹1,499' && P.countUp('Free', 0.5) === 'Free', 'price count-up')
  ok(P.scrollAt(0, 10) === 0 && P.scrollAt(10, 10) === 1, 'scroll holds at both ends')
  ok(P.defaultApp('product').rating === null && P.defaultApp('social').likes === '', 'no fabricated ratings or likes by default')
  ok(P.PHONE_FRAME_COLORS.every((c) => ['#1C1C24', '#9A9AA5', '#F4F1EA', '#C8F542', '#4FB6E8', '#E24B4A'].includes(c.color)), 'frame colours are DESIGN tokens')
  // Draw every design × a few times with a recording ctx: balanced, deterministic, paints.
  const mkCtx = () => {
    const log = []
    let depth = 0
    const grad = { addColorStop() {} }
    const target = { measureText: (t) => ({ width: String(t).length * 7 }), createLinearGradient: () => grad, save() { depth += 1; log.push('save') }, restore() { depth -= 1; if (depth < 0) throw new Error('unbalanced'); log.push('restore') } }
    const ctx = new Proxy(target, { get: (t, k) => (k in t ? t[k] : k === '__depth' ? depth : (...args) => log.push(`${String(k)}(${args.map((a) => (typeof a === 'number' ? a.toFixed(2) : typeof a)).join(',')})`)), set: (t, k, v) => { log.push(`${String(k)}=${typeof v === 'number' ? v.toFixed(3) : v}`); return true } })
    return { ctx, log, depth: () => depth }
  }
  for (const d of P.PHONE_DESIGNS) {
    for (const sec of [0, 0.6, 1.5, 3.2]) {
      const a = mkCtx(), b = mkCtx()
      let media = 0
      P.drawPhone(a.ctx, d.style, { x: 0, y: 0, w: 540, h: 960 }, sec, 4, () => { media += 1 })
      P.drawPhone(b.ctx, d.style, { x: 0, y: 0, w: 540, h: 960 }, sec, 4, () => {})
      ok(a.depth() === 0 && a.log.join('|') === b.log.join('|') && a.log.length > 20 && media === 1, `${d.id}@${sec}s balanced, deterministic, paints media once`)
    }
  }
  const withRating = { ...P.PHONE_DESIGNS[0].style, app: { ...P.defaultApp('product'), rating: 4.5 } }
  const c1 = mkCtx(), c2 = mkCtx()
  P.drawPhone(c1.ctx, withRating, { x: 0, y: 0, w: 540, h: 960 }, 2, 4, () => {})
  P.drawPhone(c2.ctx, P.PHONE_DESIGNS[0].style, { x: 0, y: 0, w: 540, h: 960 }, 2, 4, () => {})
  ok(c1.log.filter((l) => l.startsWith('closePath')).length > c2.log.filter((l) => l.startsWith('closePath')).length, 'stars only drawn when a rating is entered')
  const r = read('src/lib/studio/renderer.ts')
  ok((r.match(/drawPhone\(ctx, clip\.phone/g) || []).length === 2, 'renderer uses Phone Studio for media and component clips')
  ok(!/Math\.random|Date\.now|performance\.now/.test(read('src/lib/studio/phone.ts')), 'phone module is pure (no random, no clock)')
}

/* phoneDesign agent op */
{
  const d = base()
  const plan = m.ops.validateStudioEditPlan({ summary: 'p', ops: [{ type: 'phoneDesign', clipId: 'v1', design: 'product-launch' }] }, d)
  const next = m.ops.applyStudioEditPlan(d, plan.ops)
  const v = next.clips.find((c) => c.id === 'v1')
  ok(v.device === 'phone' && v.phone.app.kind === 'product' && v.fit === 'contain', 'agent can put a clip on an animated phone')
  throws(() => m.ops.validateStudioEditPlan({ summary: 'p', ops: [{ type: 'phoneDesign', clipId: 't1', design: 'product-launch' }] }, d), /video, image or component/, 'phone op refuses text')
  throws(() => m.ops.validateStudioEditPlan({ summary: 'p', ops: [{ type: 'phoneDesign', clipId: 'v1', design: 'nope' }] }, d), /Unknown phone design/, 'unknown design refused')
  ok(read('electron/main.cjs').includes('"type":"phoneDesign"'), 'agent prompt documents phoneDesign')
}

/* slide trim */
{
  const d = base()
  d.clips.push({ ...d.clips[1], id: 'v3', startSec: 8, durationSec: 4, trimInSec: 5 })
  const r = m.tl.slideClip(d, 'v2', 1)
  const g = (id) => r.doc.clips.find((c) => c.id === id)
  ok(r.changed && g('v2').startSec === 5 && g('v2').durationSec === 4 && g('v2').trimInSec === 2, 'slide moves the clip, keeps its length and frames')
  ok(g('v1').durationSec === 5 && g('v3').startSec === 9 && g('v3').durationSec === 3 && g('v3').trimInSec === 6, 'neighbours absorb the slide (edit length unchanged)')
  ok(m.tl.slideClip(d, 'v2', -99).doc.clips.find((c) => c.id === 'v1').durationSec >= 0.1, 'slide clamps at neighbour minimum')
  ok(/touching/.test(m.tl.slideClip({ ...d, clips: [d.clips[2]] }, 't1', 1).reason), 'slide explains when there are no neighbours')
  ok(read('src/screens/Studio.tsx').includes("commit(slideClip(") && read('src/screens/Studio.tsx').includes('Slide the clip between its neighbours'), 'slide has a documented shortcut')
}

/* nested sequences */
{
  let d = base()
  d.clips[0] = { ...d.clips[0], keyframes: [{ at: 0, opacity: 0, ease: 'linear' }, { at: 2, opacity: 1, ease: 'linear' }] }
  d = m.scenes.saveScene(d, 'Intro', '2026-01-01T00:00:00Z').doc
  const sid = d.scenes[0].id
  const outer = { ...d, clips: [{ ...m.docm.defaultTextClip(0, 1), id: 'title', durationSec: 2, track: 5 }] }
  const nested = m.scenes.nestScene(outer, sid, 10)
  const seq = nested.doc.clips.find((c) => c.id === nested.clipId)
  ok(seq.kind === 'sequence' && seq.startSec === 10 && seq.durationSec === 8, 'scene nested as one sequence clip of its length')
  const trimmed = { ...nested.doc, clips: nested.doc.clips.map((c) => (c.id === seq.id ? { ...c, trimInSec: 1, durationSec: 4, x: 0.25, y: 0.25, scale: 0.5, opacity: 0.8 } : c)) }
  const flat = m.resolve.resolveForOutput(trimmed).clips
  ok(!flat.some((c) => c.kind === 'sequence'), 'output has no sequence clips (flattened)')
  const fv1 = flat.find((c) => c.id.endsWith('~v1')), fv2 = flat.find((c) => c.id.endsWith('~v2'))
  ok(fv1.startSec === 10 && Math.abs(fv1.durationSec - 3) < 1e-9 && fv1.trimInSec === 1, 'inner clip retimed + trimmed to the window (source in-point follows)')
  ok(fv2.startSec === 13 && fv2.durationSec === 1 && fv2.trimInSec === 2, 'second inner clip clipped at the window end')
  ok(Math.abs(fv1.keyframes[1].at - 1) < 1e-9, 'inner keyframes shift with the trim')
  ok(fv1.x === 0.25 && fv1.scale === 0.5 && Math.abs(fv1.opacity - 0.8) < 1e-9, 'sequence placement + opacity apply to children')
  ok(flat.filter((c) => c.id.includes('~')).every((c) => c.track > seq.track && c.track < seq.track + 1), 'children stack at the sequence layer')
  ok(flat.find((c) => c.id.endsWith('~t1'))?.startSec === 10 && flat.find((c) => c.id.endsWith('~t1')).fontSizePct < d.clips[2].fontSizePct, 'text inside the window retimed and scaled with the sequence')
  // self-nesting / cycles are harmless
  const self = { ...trimmed, scenes: [{ ...trimmed.scenes[0], doc: { ...trimmed.scenes[0].doc, clips: [...trimmed.scenes[0].doc.clips, { ...seq, id: 'loop', startSec: 0 }] } }] }
  ok(Array.isArray(m.resolve.resolveForOutput(self).clips), 'a scene containing itself does not recurse forever')
  ok(read('src/screens/studio/StudioProPanel.tsx').includes('Nest at playhead'), 'Scenes panel can nest a scene')
}

console.log(`editor upgrades check passed — ${n} assertions`)
