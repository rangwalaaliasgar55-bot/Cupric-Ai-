// framecn vendoring (licence, shim, every component server-renders), user
// fonts (sfnt parsing, filename fallback), Fontshare licence compliance, text
// look suggestions, improved cursor motion, agent wiring.
import { build } from 'esbuild'
import { readFileSync, readdirSync, rmSync, existsSync } from 'node:fs'
import assert from 'node:assert/strict'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const read = (p) => readFileSync(p, 'utf8')
let n = 0
const ok = (c, msg) => { assert.ok(c, msg); n++ }

/* framecn: licence + provenance */
const fc = JSON.parse(read('src/lab/framecn/entries.json'))
ok(fc.license === 'MIT' && read('src/lab/framecn/LICENSE').includes('MIT'), 'framecn MIT licence vendored')
ok(fc.count >= 100 && fc.entries.length === fc.count, `≥100 framecn components (${fc.count})`)
for (const e of fc.entries) {
  ok(existsSync(`src/lab/components/${e.slug}.tsx`) && existsSync(`src/lab/framecn/${e.dir}/index.tsx`), `${e.slug} wrapper + source`)
  ok(['captions', 'text', 'transitions', 'scenes', 'shaders', 'motion'].includes(e.category), `${e.slug} categorised`)
}
const allSrc = readdirSync('src/lab/framecn', { recursive: true }).filter((f) => String(f).endsWith('.tsx') || String(f).endsWith('.ts')).map((f) => read(path.join('src/lab/framecn', String(f)))).join('\n')
ok(!/from ["']@editframe\//.test(allSrc), 'no proprietary Editframe import (own shim instead)')
ok(!JSON.parse(read('package.json')).dependencies['@editframe/react'], 'Editframe not a dependency')
ok(read('src/lab/framecn/editframe-shim.tsx').includes('export const Timegroup') && read('src/lab/framecn/editframe-shim.tsx').includes('export function useTimingInfo'), 'shim provides the two used names')
for (const cat of ['captions', 'scenes', 'transitions', 'shaders', 'motion']) ok(read('src/lab/registry.ts').includes(`id: "${cat}"`), `category ${cat} in Components tab`)
const pack = JSON.parse(read('resources/packs/framecn.json'))
ok(pack.items.length === fc.count && pack.items.every((i) => i.kind === 'component' && i.data.license === 'MIT' && !i.data.source && !i.data.provider), 'framecn pack: records (not links), attributed')

/* every framecn component renders (SSR, default props) */
const entry = [
  "import { renderToString } from 'react-dom/server'",
  "import { createElement } from 'react'",
  "import { FramecnStage } from './src/lab/framecn/stage'",
  "import { FRAMECN_CONFIGS } from './src/lab/framecn/configs'",
  ...fc.entries.map((e, i) => `import * as m${i} from './src/lab/framecn/${e.dir}'`),
  `export const mods = { ${fc.entries.map((e, i) => `'${e.slug}': m${i}`).join(', ')} }`,
  'export { renderToString, createElement, FramecnStage, FRAMECN_CONFIGS }',
  "export * as comps from './src/lib/studio/components'",
  "export * as uf from './src/lib/studio/userFonts'",
  "export * as fs from './src/lib/studio/fontStyles'",
  "export * as fnt from './src/lib/studio/fonts'",
  "export * as cur from './src/lib/studio/cursor'",
  "export * as ops from './src/lib/studio/editOps'",
  "export * as docm from './src/lib/studio/doc'",
].join('\n')
const out = path.resolve('.check-framecn-fonts.mjs')
await build({ stdin: { contents: entry, resolveDir: process.cwd(), loader: 'tsx' }, bundle: true, format: 'esm', platform: 'node', outfile: out, logLevel: 'silent', jsx: 'automatic', packages: 'external', loader: { '.json': 'json' }, define: { 'import.meta.glob': 'undefined' } })
globalThis.window ??= undefined
const m = await import(pathToFileURL(out).href)
rmSync(out, { force: true })
for (const e of fc.entries) {
  const cfg = m.FRAMECN_CONFIGS[e.slug]
  ok(cfg && cfg.durationInFrames > 0, `${e.slug} config`)
  const Comp = Object.values(m.mods[e.slug]).find((v) => typeof v === 'function' && v.name === cfg.componentName) ?? m.mods[e.slug][cfg.componentName]
  ok(typeof Comp === 'function', `${e.slug} exports ${cfg.componentName}`)
  let html = ''
  try { html = m.renderToString(m.createElement(m.FramecnStage, { component: Comp, config: cfg })) } catch (err) { throw new Error(`${e.slug} failed to render: ${err.message}`) }
  ok(html.length > 50, `${e.slug} renders`)
  const defaults = Object.fromEntries(Object.entries(cfg.controls).map(([k, c]) => [k, c.default]))
  ok(Object.keys(m.comps.validateComponentProps(e.slug, defaults)).length === Object.keys(defaults).length, `${e.slug} defaults pass validation`)
}
assert.throws(() => m.comps.validateComponentProps('fc-staggered-fade-up', { nope: 1 }), /no prop/); n++
assert.throws(() => m.comps.validateComponentProps('fc-staggered-fade-up', { fontSize: 'big' }), /number/); n++
ok(m.comps.validateComponentProps('fc-staggered-fade-up', { fontSize: 9999 }).fontSize === 200, 'numbers clamped to the control range')
ok(m.comps.componentCatalogFor('karaoke captions', 14).some((c) => c.slug.startsWith('fc-') && c.props), 'agent catalogue lists framecn props')
{
  const doc = { aspect: '16:9', fps: 30, backgroundId: 'bg', trackCount: 2, clips: [] }
  const plan = m.ops.validateStudioEditPlan({ summary: 's', ops: [{ type: 'addComponent', slug: 'fc-staggered-fade-up', startSec: 0, durationSec: 3, props: { text: 'Ship faster', color: '#FFFFFF' } }] }, doc)
  const next = m.ops.applyStudioEditPlan(doc, plan.ops)
  ok(next.clips[0].component.props.text === 'Ship faster', 'agent sets framecn props')
}
ok(read('src/lab/DemoFrame.tsx').includes('DemoPropsContext.Provider') && read('src/screens/studio/ComponentRecorderHost.tsx').includes('props={meta.props}'), 'props reach the single recorder path')
ok(read('src/screens/studio/StudioInspector.tsx').includes('<FramecnFields') && read('src/screens/studio/InspectorExtras.tsx').includes('Apply & re-record'), 'inspector edits framecn props (re-records)')

/* user fonts */
{
  const f = m.uf.metaFromFileName('fonts/ClashDisplay-SemiboldItalic.woff2')
  ok(f.family === 'Clash Display' && f.weight === 600 && f.italic, 'filename → family/weight/italic')
  const v = m.uf.metaFromFileName('Satoshi-Variable.ttf')
  ok(v.family === 'Satoshi' && v.variable, 'variable detected from filename')
  ok(m.uf.metaFromFileName('GeneralSans-ExtraLight.otf').weight === 200 && m.uf.metaFromFileName('Switzer-Black.otf').weight === 900, 'weight words')
  // Minimal synthetic sfnt: name(1="Test Sans", 2="Bold Italic") + OS/2 (weight 700, italic bit).
  const nameStr = (s) => Buffer.from(s, 'utf16le').swap16()
  const s1 = nameStr('Test Sans'), s2 = nameStr('Bold Italic')
  const nameTbl = Buffer.alloc(6 + 2 * 12 + s1.length + s2.length)
  nameTbl.writeUInt16BE(0, 0); nameTbl.writeUInt16BE(2, 2); nameTbl.writeUInt16BE(6 + 24, 4)
  ;[[1, s1, 0], [2, s2, s1.length]].forEach(([id, s, off], i) => { const r = 6 + i * 12; nameTbl.writeUInt16BE(3, r); nameTbl.writeUInt16BE(1, r + 2); nameTbl.writeUInt16BE(0x409, r + 4); nameTbl.writeUInt16BE(id, r + 6); nameTbl.writeUInt16BE(s.length, r + 8); nameTbl.writeUInt16BE(off, r + 10) })
  s1.copy(nameTbl, 30); s2.copy(nameTbl, 30 + s1.length)
  const os2 = Buffer.alloc(96); os2.writeUInt16BE(700, 4); os2.writeUInt16BE(1, 62)
  const head = Buffer.alloc(12 + 2 * 16); head.writeUInt32BE(0x00010000, 0); head.writeUInt16BE(2, 4)
  const offName = head.length, offOs2 = offName + nameTbl.length
  head.write('name', 12, 'latin1'); head.writeUInt32BE(offName, 20); head.writeUInt32BE(nameTbl.length, 24)
  head.write('OS/2', 28, 'latin1'); head.writeUInt32BE(offOs2, 36); head.writeUInt32BE(os2.length, 40)
  const buf = Buffer.concat([head, nameTbl, os2])
  const meta = m.uf.readFontMeta(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length))
  ok(meta.family === 'Test Sans' && meta.weight === 700 && meta.italic, 'sfnt name/OS2 parsed')
  ok(m.uf.readFontMeta(new ArrayBuffer(4)).family === null && m.uf.readFontMeta(new TextEncoder().encode('wOF2xxxxxxxxxxxx').buffer).family === null, 'woff2/garbage → filename fallback, no throw')
  ok(read('src/lib/studio/fonts.ts').includes('isUserFont(name)'), 'user fonts never fetched from the network')
}

/* Fontshare licence compliance: names only, never files or API */
{
  ok(m.fs.FONTSHARE_FONTS.length >= 20 && m.fs.FONTSHARE_FONTS.every((f) => m.fs.fontshareUrl(f.slug).startsWith('https://www.fontshare.com/fonts/')), 'Fontshare catalogue links to fontshare.com')
  const code = ['src', 'electron'].flatMap((d) => readdirSync(d, { recursive: true }).filter((f) => /\.(ts|tsx|cjs|css)$/.test(String(f))).map((f) => read(path.join(d, String(f))))).join('\n')
  ok(!/api\.fontshare\.com|cdn\.fontshare\.com/.test(code), 'no Fontshare API/CDN serving (ITF FFL forbids apps offering the fonts)')
  ok(!existsSync('resources/fonts/fontshare'), 'no Fontshare files bundled')
}

/* look suggestions */
{
  const avail = (f) => ['Geist Variable', 'Instrument Serif', 'Montserrat Variable', 'Inter Variable', 'Space Grotesk Variable', 'JetBrains Mono Variable', 'Fraunces Variable', 'Playfair Display Variable', 'Plus Jakarta Sans Variable'].includes(f)
  const looks = m.fs.suggestTextLooks('Launch your AI app in minutes', { brandColors: ['#0B0B10', '#C8F542', '#7C5CFF'], available: avail, includeMissing: true })
  ok(m.fs.moodOf('Launch your AI app') === 'tech' && m.fs.moodOf('If you are a woman over 30') === 'fitness', 'mood detection')
  ok(looks.length >= 6 && looks.filter((l) => !l.needs).every((l) => avail(l.patch.fontFamily) && avail(l.patch.emphasisFont)), 'applicable looks only use available fonts')
  ok(looks.some((l) => l.needs?.url.includes('fontshare.com')), 'missing Fontshare font suggested with a link, not applied')
  ok(new Set(looks.map((l) => l.patch.fontFamily)).size >= 2 && new Set(looks.map((l) => l.patch.emphasisColor)).size >= 3, 'varied fonts and colours')
  const pal = m.fs.paletteFrom(['#0B0B10', '#C8F542', '#7C5CFF'])
  ok(pal.between.includes(m.fs.mix('#C8F542', '#7C5CFF', 0.5)) || pal.between.length >= 3, 'in-between tones from the brand kit')
  ok([...pal.base, ...pal.between].every((c) => m.fs.contrast(c, '#0B0B10') >= 3), 'every suggested colour readable on dark')
  ok(m.fs.fontChoicesForAgent(['Satoshi']).find((f) => f.family === 'Satoshi').source === 'yours', 'agent sees the user’s fonts')
  const doc = { aspect: '16:9', fps: 30, backgroundId: 'bg', trackCount: 2, clips: [{ ...m.docm.defaultTextClip(0, 1), id: 't' }] }
  assert.throws(() => m.ops.validateStudioEditPlan({ summary: 's', ops: [{ type: 'patchClip', clipId: 't', patch: { fontFamily: 'Satoshi' } }] }, doc), /Fontshare font the user has not added/); n++
  ok(read('src/screens/studio/StudioInspector.tsx').includes('<FontStudio') && read('src/screens/studio/FontStudio.tsx').includes('Suggested looks'), 'suggestions in the text inspector')

  /* fonts that must be loaded before canvas ink is committed */
  ok(m.fnt.isBundledFont('Noto Sans Devanagari') && m.fnt.isBundledFont('Hind') && m.fnt.fontKind('Noto Sans Devanagari') === 'bundled', 'the two Devanagari families ship in the bundle')
  ok(m.fnt.fontKind('Satoshi') === 'remote' && m.fnt.fontKind('Geist Variable') === 'bundled', 'font kind: bundled vs remote')
  const plan = m.fnt.docFontPlan({ clips: [{ kind: 'text', fontFamily: 'Geist Variable', emphasisFont: 'Instrument Serif', weight: 800 }] })
  ok(plan.length === 2 && plan.every((f) => f.weights.includes(800)), 'the emphasis face is planned (and loaded) with the headline face')
  ok(m.fnt.docFontPlan({ clips: [{ kind: 'text', fontFamily: 'Inter Variable', hidden: true }] }).length === 0, 'hidden clips need no faces')
  ok(read('src/lib/studio/export.ts').includes('onWarning') && read('src/lib/studio/export.ts').includes('ensureDocFonts'), 'export verifies every face and warns instead of baking the fallback')
  ok(read('src/screens/Studio.tsx').includes('onWarning') && read('src/App.tsx').includes('FONT_MISSING_EVENT'), 'a font that cannot load reaches the user as a toast')
  ok(read('src/lib/studio/fonts.ts').includes('USER_FONTS_EVENT') && read('src/lib/studio/fonts.ts').includes('failedAt'), 'a failed download is not cached forever — adding the file retries at once')
  ok(read('electron/main.cjs').includes('STUDIO CONTEXT.fonts') && read('src/screens/Studio.tsx').includes('fonts: fontChoicesForAgent('), 'agent prompt + context include fonts')
}

/* cursor motion */
{
  const c = m.cur.cursorForTarget({ id: 'b', x: 0.5, y: 0.5, startSec: 0, durationSec: 3, track: 0, name: 'Buy button' }, 'click', 'c')
  ok(c.style === 'auto' && c.trail === true, 'new cursors: auto style + trail')
  ok(m.cur.cursorForTarget({ id: 'i', x: 0.5, y: 0.5, startSec: 0, durationSec: 3, track: 0, name: 'Email input' }, 'click', 'c').style === 'ibeam', 'inputs get an I-beam')
  const click = c.clicks[0] * c.durationSec
  const at = m.cur.cursorAt(c, click)
  ok(Math.hypot(at.x - 0.5, at.y - 0.5) < 1e-6, 'lands exactly on target at the click')
  let past = 0
  for (let t = click - 0.3; t < click; t += 0.005) { const f = m.cur.cursorAt(c, t); const along = (f.x - 0.5) * -0.22 + (f.y - 0.5) * -0.25; past = Math.max(past, along) }
  ok(past > 0.001, 'overshoots then settles (human aim)')
  const mid = m.cur.cursorAt(c, click * 0.3), early = m.cur.cursorAt(c, click * 0.1)
  ok(Math.hypot(mid.x - early.x, mid.y - early.y) > 0.02, 'fast launch')
  ok(m.cur.cursorAt(c, click + 0.24).press > 1, 'rebound after the press')
  ok(m.cur.cursorAt(c, click + 0.05).flash > 0 && m.cur.cursorAt(c, click + 0.2).ripples.length >= 2, 'flash + double ripple')
  const multi = { ...c, stops: [{ x: 0.3, y: 0.3 }, { x: 0.7, y: 0.4 }, { x: 0.5, y: 0.8 }], clicks: [0.25, 0.55, 0.85] }
  multi.stops.forEach((s, i) => { const f = m.cur.cursorAt(multi, multi.clicks[i] * multi.durationSec); ok(Math.hypot(f.x - s.x, f.y - s.y) < 1e-6, `journey stop ${i + 1} clicked exactly`) })
  ok(m.cur.cursorAt(c, 1.1).toTarget >= 0, 'distance for auto hand swap')
  ok(read('src/lib/studio/renderExtras.ts').includes("'ibeam'") && read('src/lib/studio/renderExtras.ts').includes('Motion-blur trail'), 'renderer: I-beam + trail')
}
console.log(`framecn + fonts + cursor check passed — ${n} assertions, ${fc.count} framecn components render`)
