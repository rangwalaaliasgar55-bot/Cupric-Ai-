// Shapes library, cursor clicks (and when NOT to add one), 3D projection,
// rich captions, fonts, agent ops, prompt/UI wiring. Pure-module assertions
// plus a recording fake canvas for the draw paths.
import { build } from 'esbuild'
import { readFileSync, rmSync } from 'node:fs'
import assert from 'node:assert/strict'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const out = path.resolve('.check-shapes-cursor-3d.mjs')
await build({
  stdin: { contents: ["export * as sh from './src/lib/studio/shapes'", "export * as cur from './src/lib/studio/cursor'", "export * as rx from './src/lib/studio/renderExtras'", "export * as rt from './src/lib/studio/richText'", "export * as vf from './src/lib/studio/videoFonts'", "export * as kit from './src/lib/studio/motionKit'", "export * as ops from './src/lib/studio/editOps'", "export * as docm from './src/lib/studio/doc'"].join('\n'), resolveDir: process.cwd(), loader: 'ts' },
  bundle: true, format: 'esm', platform: 'node', outfile: out, logLevel: 'silent',
})
const m = await import(pathToFileURL(out).href)
rmSync(out, { force: true })
let n = 0
const ok = (c, msg) => { assert.ok(c, msg); n++ }
const read = (p) => readFileSync(p, 'utf8')

/* shapes */
const ids = m.sh.SHAPES.map((s) => s.id)
ok(ids.length >= 50 && new Set(ids).size === ids.length, `≥50 unique shapes (${ids.length})`)
for (const s of m.sh.SHAPES) {
  ok(s.use && s.use.length > 8, `${s.id} explains how editors use it`)
  const g = m.sh.shapeGeometry(s.id, { aspect: s.aspect, sides: 6, radius: 0.1 })
  ok(g.length > 0 && g.every((p) => p.pts.length >= 2 && p.pts.every(([x, y]) => Number.isFinite(x) && Number.isFinite(y) && Math.abs(x) <= 0.75 && Math.abs(y) <= 0.75)), `${s.id} geometry finite and inside its box`)
}
{
  const p = m.sh.shapeGeometry('curved-arrow', { aspect: 0.6 })[0]
  const L = m.sh.pathLength(p)
  ok(m.sh.partialPath(p, 0).length <= 1 && m.sh.partialPath(p, 1).length === p.pts.length, 'draw-on: 0 → nothing, 1 → whole path')
  const half = m.sh.partialPath(p, 0.5)
  ok(Math.abs(m.sh.pathLength({ pts: half, closed: false }) - L / 2) < L * 0.02, 'draw-on half length is half the stroke')
  ok(m.sh.shapeGeometry('star', { aspect: 1, sides: 5 }) === m.sh.shapeGeometry('star', { aspect: 1, sides: 5 }), 'geometry cached (scrub perf)')
}
ok(m.sh.shapesFor('before after comparison')[0].category === 'arrow', 'before/after → an arrow first')
ok(['underline', 'circle-scribble', 'highlight-bar'].includes(m.sh.shapesFor('emphasise a key word')[0].id), 'emphasis → underline/scribble/highlight')
ok(['burst', 'seal', 'sparkle', 'star'].includes(m.sh.shapesFor('sale price badge')[0].id), 'price → badge shape')

/* cursor rules */
const yes = ['Shiny button', 'Toggle switch', 'Signup form input', 'Dropdown menu', 'App onboarding demo']
const no = ['Aurora background', 'Loading spinner', 'Bar chart', 'Text reveal headline', 'Particles']
for (const name of yes) ok(m.cur.cursorNeeded({ name }).needed, `cursor needed: ${name}`)
for (const name of no) { const v = m.cur.cursorNeeded({ name }); ok(!v.needed && v.reason.length > 10, `no cursor (explained): ${name}`) }
{
  const c = m.cur.cursorForTarget({ id: 'b', x: 0.6, y: 0.7, startSec: 1, durationSec: 4, track: 1 }, 'click', 'c1')
  ok(c.kind === 'cursor' && c.targetClipId === 'b' && c.track === 2 && c.clicks.length === 1, 'cursor above its target, linked, one click')
  const a = m.cur.cursorAt(c, 0), b = m.cur.cursorAt(c, c.clicks[0] * c.durationSec)
  ok(Math.hypot(a.x - c.x, a.y - c.y) > 0.05 && Math.hypot(b.x - c.x, b.y - c.y) < 0.01, 'travels from off-target to the target by the click')
  ok(b.targetPress > 0 && b.press < 1, 'press on click (pointer + target)')
  const late = m.cur.cursorAt(c, c.clicks[0] * c.durationSec + 0.15)
  ok(late.ripples.length > 0, 'ripple after click')
  ok(JSON.stringify(m.cur.cursorAt(c, 1.234)) === JSON.stringify(m.cur.cursorAt(c, 1.234)), 'deterministic (preview = export)')
  const h = m.cur.cursorAt({ ...c, action: 'hover', clicks: [] }, c.durationSec * 0.8)
  ok(h.targetPress < 0 && h.ripples.length === 0, 'hover lifts, no ripple')
}

/* kit + agent ops */
const base = () => ({ aspect: '16:9', fps: 30, backgroundId: 'bg', trackCount: 2, clips: [
  { ...m.docm.defaultTextClip(0, 1), id: 't1', text: 'Hello' },
  { id: 'btn', kind: 'overlay', name: 'Shiny button', dataUrl: '', source: 'component', x: 0.5, y: 0.6, scale: 1, track: 1, startSec: 1, durationSec: 4, transitionIn: 'none', transitionOut: 'none', opacity: 1, component: { slug: 'nope', status: 'ready', recordSec: 3, interact: false } },
] })
{
  const r = m.kit.addShape(base(), 'underline', 1)
  const s = r.doc.clips.find((c) => c.id === r.clipId)
  ok(r.changed && s.kind === 'shape' && s.stroke && !s.fill && s.anim === 'draw-on', 'stroke shapes default to draw-on')
  ok(!m.kit.addShape(base(), 'nonsense', 0).changed, 'unknown shape refused')
  const c = m.kit.addCursorTo(base(), 'btn')
  ok(c.changed && c.doc.clips.find((x) => x.id === 'btn').component.interact === true && c.doc.clips.find((x) => x.id === 'btn').component.status === 'pending', 'cursor on a component turns on interaction and re-records')
  const t = m.kit.addCursorTo(base(), 't1')
  ok(!t.changed && t.reason, 'text clip → refused with reason')
  ok(m.kit.addCursorTo(base(), 't1', { force: true }).changed, 'force overrides')
}
{
  const plan = m.ops.validateStudioEditPlan({ summary: 's', ops: [{ type: 'addShape', shape: 'curved-arrow', startSec: 0.5, durationSec: 2, x: 0.5, y: 0.5, anim: 'draw-on' }, { type: 'addCursor', clipId: 'btn' }, { type: 'patchClip', clipId: 't1', patch: { tiltX: 20, turnY: -15 } }] }, base())
  const r = m.ops.applyStudioEditPlan(base(), plan.ops)
  const d = r.doc ?? r
  ok(d.clips.some((c) => c.kind === 'shape' && c.shape === 'curved-arrow') && d.clips.some((c) => c.kind === 'cursor'), 'agent adds shape + cursor')
  ok(d.clips.find((c) => c.id === 't1').tiltX === 20, 'agent patches 3D')
  assert.throws(() => m.ops.validateStudioEditPlan({ summary: 's', ops: [{ type: 'addShape', shape: 'dragon', startSec: 0, durationSec: 2 }] }, base()), /Unknown shape/); n++
  assert.throws(() => m.ops.validateStudioEditPlan({ summary: 's', ops: [{ type: 'patchClip', clipId: 't1', patch: { tiltX: 120 } }] }, base()), /safe range/); n++
  assert.throws(() => m.ops.applyStudioEditPlan(base(), m.ops.validateStudioEditPlan({ summary: 's', ops: [{ type: 'addCursor', clipId: 't1' }] }, base()).ops), /cursor|text/i); n++
}

/* 3D + drawing on a recording fake canvas */
function fakeCtx() {
  const calls = []
  const handler = { get: (t, k) => (k in t ? t[k] : typeof k === 'string' ? (...a) => { calls.push(k); return k === 'measureText' ? { width: 10 * String(a[0]).length } : k === 'createLinearGradient' || k === 'createRadialGradient' ? { addColorStop() {} } : undefined } : undefined), set: (t, k, v) => { t[k] = v; return true } }
  return { ctx: new Proxy({ canvas: { width: 1920, height: 1080 }, globalAlpha: 1, calls }, handler), calls }
}
{
  ok(!m.rx.has3D({}) && m.rx.has3D({ tiltX: 10 }), 'has3D')
  const { ctx, calls } = fakeCtx()
  const s = m.kit.makeShape('star', 0)
  m.rx.drawShape(ctx, { ...s, anim: 'pop' }, 1, 1920, 1080)
  ok(calls.includes('fill') || calls.includes('stroke'), 'shape draws')
  const f = fakeCtx()
  m.rx.drawCursor(f.ctx, m.cur.cursorForTarget({ id: 'b', x: 0.5, y: 0.5, startSec: 0, durationSec: 3, track: 0 }, 'click', 'c'), 1.7, 1920, 1080)
  ok(f.calls.includes('fill'), 'cursor draws')
}

/* rich captions */
{
  const w = m.rt.parseRich('If you’re\na *woman*\nover ^30^ and ==following advice== {not for you}')
  ok(w.find((x) => x.text === 'woman').style.em && w.find((x) => x.text === 'woman').line === 1, 'emphasis + line')
  ok(w.find((x) => x.text === '30').style.big && w.filter((x) => x.style.box).map((x) => x.text).join(' ') === 'following advice', 'big + box span')
  ok(w.filter((x) => x.style.accent).length === 3 && !w.find((x) => x.text === 'If').style.em, 'accent span; plain words plain')
  ok(m.rt.plainText('a *b* ==c d== {e} ^1^') === 'a b c d e 1' && !m.rt.hasRichMarkup('plain words'), 'plainText / detection')
  ok(m.rt.RICH_PRESETS.length >= 5 && m.rt.RICH_PRESETS.every((p) => m.rt.hasRichMarkup(p.text)), 'presets use the markup')
}

/* fonts */
{
  const fams = m.vf.VIDEO_FONTS.map((f) => f.family)
  for (const f of ['Montserrat Variable', 'Instrument Serif', 'Bebas Neue', 'Anton', 'Geist Variable']) ok(fams.includes(f), `font ${f}`)
  const css = read('src/styles.css')
  ok(['montserrat', 'instrument-serif', 'bebas-neue', 'anton'].every((f) => css.includes(`@fontsource`) && css.toLowerCase().includes(f)), 'fonts bundled (offline export)')
}

/* wiring */
const main = read('electron/main.cjs')
ok(main.includes('"type":"addShape"') && main.includes('"type":"addCursor"') && main.includes('RICH CAPTIONS') && main.includes('tiltX/turnY'), 'agent prompt teaches shapes, cursor, rich captions, 3D')
for (const id of (main.match(/Shapes: ([a-z0-9 -]+)\./) ?? ['', ''])[1].split(' ')) ok(ids.includes(id), `prompt shape exists: ${id}`)
ok(read('src/lib/studio/componentDirector.ts').includes('cursor: true'), 'director adds cursors to interactive components')
const studio = read('src/screens/Studio.tsx')
ok(studio.includes('<ShapePicker') && studio.includes('addCursorClick('), 'toolbar: Shape + Cursor')
const insp = read('src/screens/studio/StudioInspector.tsx')
ok(['<ThreeDFields', '<ShapeFields', '<CursorFields', '<RichTextFields', 'Tilt X'].every((s) => insp.includes(s)), 'inspector wired')
const r = read('src/lib/studio/renderer.ts')
ok(r.includes('project3D(') && r.includes('drawRichText(') && r.includes("clip.kind === 'shape'") && !/Math\.random|Date\.now|performance\.now/.test(read('src/lib/studio/renderExtras.ts') + read('src/lib/studio/cursor.ts') + read('src/lib/studio/shapes.ts')), 'renderer wired; motion code pure')
const pack = JSON.parse(read('resources/packs/motion-kit.json'))
ok(pack.items.find((i) => i.id === 'javis-jl').data.license === 'MIT' && pack.items.every((i) => i.data.license && i.data.attribution), 'motion-kit pack licensed + attributed')
console.log(`shapes/cursor/3D check passed — ${n} assertions`)
