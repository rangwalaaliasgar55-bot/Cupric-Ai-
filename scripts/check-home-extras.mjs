#!/usr/bin/env node
/** UI-2 pack favourites/recent + windowing, V-2 background polish, kinetic headline, real-3D block row fallback. */
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { readFileSync, rmSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const tmp = path.join(root, '.home-extras-check.mjs')
await build({ bundle: true, outfile: tmp, format: 'esm', platform: 'node', logLevel: 'error', loader: { '.css': 'empty', '.svg': 'dataurl', '.png': 'dataurl' },
  stdin: { contents: "export * from './src/lib/library/packPrefs'; export * from './src/lib/studio/backgroundPolish'; export { applyStudioEditPlan } from './src/lib/studio/editOps'; export { drawKit, normaliseKit, kineticWords, KIT_KINDS, setBlockRow3dRenderer, blockLit } from './src/lib/studio/homeKit'; export { loadBlockRow3d, blockRow3dError, needsBlockRow3d } from './src/lib/studio/blockRow3d'", resolveDir: root, loader: 'ts' } })
const m = await import(`${pathToFileURL(tmp).href}?t=${Date.now()}`)
rmSync(tmp, { force: true })
let n = 0
const ok = (c, msg) => { assert.ok(c, msg); n += 1 }

/* UI-2 */
const r0 = m.windowRange(4000, 4, 264, 0, 900)
ok(r0.start === 0 && r0.end <= 4 * (Math.ceil(900 / 264) + 3) && r0.end < 60, 'only the visible rows (+overscan) of 4,000 items mount')
const r1 = m.windowRange(4000, 4, 264, -264 * 500, 900)
ok(r1.start > 0 && r1.start % 4 === 0 && r1.padTop === (r1.start / 4) * 264, 'scrolled window starts on a row boundary with an exact top spacer')
ok(r1.padTop + (r1.end - r1.start) / 4 * 264 + r1.padBottom === 1000 * 264, 'spacers + rendered rows keep the full scroll height')
ok(m.windowRange(0, 4, 264, 0, 900).end === 0, 'empty list renders nothing')
ok(m.loadFavourites().length === 0 && m.toggleFavourite('a', []).includes('a'), 'no DOM → favourites are safe no-ops')
const store = new Map()
globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)) }
m.toggleFavourite('x'); m.toggleFavourite('y'); m.toggleFavourite('x')
ok(JSON.stringify(m.loadFavourites()) === '["y"]', 'favourites toggle and persist')
for (let i = 0; i < 50; i++) m.pushRecent(`r${i}`)
m.pushRecent('r10')
const rec = m.loadRecent()
ok(rec.length === m.RECENT_LIMIT && rec[0] === 'r10' && new Set(rec).size === rec.length, 'recent is deduped, most-recent-first, capped')
const items = [{ id: 'y' }, { id: 'r10' }, { id: 'r49' }, { id: 'z' }]
ok(m.filterPackItems(items, 'favourites', ['y'], []).map((i) => i.id).join() === 'y', 'favourites filter')
ok(m.filterPackItems(items, 'recent', [], rec).map((i) => i.id).join() === 'r10,r49', 'recent filter keeps recency order')
delete globalThis.localStorage
const pb = readFileSync(path.join(root, 'src/screens/library/PackBrowser.tsx'), 'utf8')
ok(/windowRange\(/.test(pb) && /filterPackItems\(/.test(pb) && /pushRecent\(/.test(pb) && /toggleFavourite\(/.test(pb), 'PackBrowser windows the grid and wires favourites + recent')

/* V-2 */
const doc = { aspect: '16:9', fps: 30, trackCount: 3, clips: [
  { id: 'v', kind: 'video', mediaId: 'm', fileName: 'a.mp4', track: 0, startSec: 0, durationSec: 12, trimInSec: 0, speed: 1, volume: 1, transitionIn: 'none', transitionOut: 'none', opacity: 1 },
  { id: 't1', kind: 'text', text: 'Meet Nova', track: 1, startSec: 0, durationSec: 3, x: 0.5, y: 0.3, fontSizePct: 8, color: '#FFFFFF', transitionIn: 'none', transitionOut: 'none', opacity: 1 },
  { id: 't2', kind: 'text', text: 'Sign up today', track: 1, startSec: 6, durationSec: 3, x: 0.5, y: 0.7, fontSizePct: 6, color: '#FFFFFF', transitionIn: 'none', transitionOut: 'none', opacity: 1 },
] }
const before = JSON.stringify(doc)
const offer = m.backgroundPolishOffer(doc)
ok(offer && offer.plan.ops.length > 0 && offer.signature === m.docSignature(doc), 'background pass plans a polish tied to this exact timeline')
ok(JSON.stringify(doc) === before, 'planning never mutates the doc (offer only)')
const applied = m.applyStudioEditPlan(doc, offer.plan.ops)
ok(applied !== doc && m.docSignature(applied) !== offer.signature, 'accepting yields one new doc (one undo step) with a new signature')
ok(m.backgroundPolishOffer({ ...doc, clips: [doc.clips[0]] }) === null, 'nothing honest to offer → no offer')
ok(m.backgroundPolishEnabled() === true, 'enabled by default, DOM-guarded')
const studio = readFileSync(path.join(root, 'src/screens/Studio.tsx'), 'utf8')
ok(/backgroundPolishOffer\(doc\)/.test(studio) && /setAgentPlan\(polishOffer\.plan\)/.test(studio), 'offer goes through the agent preview diff → Accept/Reject path')

/* kinetic headline */
ok(m.KIT_KINDS.some((k) => k.id === 'kinetic-headline'), 'kinetic-headline is a kit kind')
const words = m.kineticWords({ title: 'Ship [faster] with {Nova} *today*!' })
ok(words.map((w) => w.style).join() === 'plain,keyword,plain,chip,glow' && words[4].text === 'today!', 'title markup → per-word styles')
ok(words.every((w, i) => Math.abs(w.delay - i * 0.09) < 1e-9) && words[1].weight === 800 && words[0].weight === 700, 'default delays stagger; styled words are heavier')
const kc = m.normaliseKit({ kit: 'kinetic-headline', words: [{ text: 'Hi', color: 'blue', weight: 600, delay: 1, style: 'glow' }, { text: 'x', color: '#FF00FF', weight: 3, style: 'bogus' }, { text: '' }] })
ok(kc.words.length === 2 && kc.words[0].color === 'blue' && kc.words[1].color === undefined && kc.words[1].weight === undefined && kc.words[1].style === undefined, 'normalise keeps token colours only, drops raw hex/invalid weights, empty words')
function mockCtx() {
  const calls = []
  let alpha = 1
  const ctx = new Proxy({ calls, font: '10px x', measureText: (s) => ({ width: s.length * (parseFloat(/(\d+)px/.exec(ctx.font)?.[1] ?? '10') * 0.55) }),
    createRadialGradient: () => ({ addColorStop() {} }), createLinearGradient: () => ({ addColorStop() {} }),
    get globalAlpha() { return alpha }, set globalAlpha(v) { alpha = v },
  }, { get: (t, k) => (k in t ? t[k] : (...a) => { if (k === 'fillText') calls.push([a[0], alpha]) }), set: (t, k, v) => { if (k === 'globalAlpha') alpha = v; else t[k] = v; return true } })
  return ctx
}
const head = m.normaliseKit({ kit: 'kinetic-headline', title: 'One two', durationSec: 3, words: [{ text: 'One', delay: 0 }, { text: 'Two', delay: 1.5 }] })
const at = (t) => { const c = mockCtx(); m.drawKit(c, head, t, 1280, 720); return Object.fromEntries(c.calls.map(([s, a]) => [s, a])) }
const f1 = at(0.8)
ok(f1.One > 0.9 && f1.Two === 0, 'each word enters at its own delay')
ok(at(3).Two > 0.99, 'late word has landed by the end')
ok(JSON.stringify(at(1.7)) === JSON.stringify(at(1.7)), 'same time → same frame (pure)')
const rm = at.call(null, 0.1) && (() => { const c = mockCtx(); m.drawKit(c, { ...head, reducedMotion: true }, head.startSec + 0.5, 1280, 720); return c.calls.map(([, a]) => a) })()
ok(rm.every((a) => a > 0.99), 'reduced motion: all words shown, opacity-only')

/* block row 3D */
const row = m.normaliseKit({ kit: 'block-row-3d', values: [6], real3d: true })
ok(row.real3d === true && m.needsBlockRow3d([row]), 'real3d flag survives normalise')
const c25 = mockCtx(); m.drawKit(c25, row, 2, 1280, 720)
ok(c25.calls.length === 6, 'no renderer registered → 2.5D fallback draws every block')
ok((await m.loadBlockRow3d()) === false && /Node|DOM/.test(m.blockRow3dError()), 'Node has no WebGL → honest reason, stays on 2.5D')
let used = 0
m.setBlockRow3dRenderer((clip, e, p, w, h) => { used += 1; return { image: {}, labels: [{ x: 1, y: 1, i: 0, lit: m.blockLit(0, 6, p) }] } })
const c3 = mockCtx(); m.drawKit(c3, row, 2, 1280, 720)
ok(used === 1 && c3.calls.length === 1, 'registered Three renderer is used by the shared drawKit (preview == export)')
const cOff = mockCtx(); m.drawKit(cOff, { ...row, real3d: undefined }, 2, 1280, 720)
ok(used === 1 && cOff.calls.length === 6, 'real3d off → 2.5D even when Three is loaded')
console.log(`home extras check passed — ${n} assertions`)
