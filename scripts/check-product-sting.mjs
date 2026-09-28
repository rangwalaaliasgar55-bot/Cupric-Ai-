// Product sting: self-contained deterministic renderer, exact cut frames, HTML contract, mastered sound.
import { build } from 'esbuild'
import { readFileSync, rmSync } from 'node:fs'
import assert from 'node:assert/strict'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
const out = path.resolve('.check-product-sting.mjs')
await build({ stdin: { contents: "export * as s from './src/lib/stings/productSting'; export * as a from './src/lib/stings/stingAudio'", resolveDir: process.cwd(), loader: 'ts' }, bundle: true, minify: true, format: 'esm', platform: 'node', outfile: out, logLevel: 'silent' })
const { s, a } = await import(pathToFileURL(out).href).catch((e) => { rmSync(out, { force: true }); throw e })
rmSync(out, { force: true })
let n = 0
const ok = (c, msg) => { assert.ok(c, msg); n++ }
// Recording stub canvas: every draw call is logged so two runs can be compared.
function stubCanvas(log) {
  const ctx = new Proxy({}, {
    get(t, k) {
      if (k === 'canvas') return { width: 1080, height: 1080 }
      if (k === 'measureText') return (txt) => ({ width: String(txt).length * 30 })
      if (k === 'createLinearGradient' || k === 'createRadialGradient') return () => ({ addColorStop() {} })
      if (k in t) return t[k]
      return (...args) => { log.push(k + ':' + args.map((x) => (typeof x === 'number' ? x.toFixed(3) : typeof x === 'object' ? 'o' : String(x))).join(',')) }
    },
    set(t, k, v) { t[k] = v; log.push('set ' + String(k) + '=' + String(v)); return true },
  })
  return { width: 1080, height: 1080, getContext: () => ctx }
}
const I = s.sanitizeSting({}), { palette } = s.paletteFor(I)
const src = s.stingProgram.toString()
const program = new Function('return (' + src + ')')()
ok(typeof program === 'function', 'minified renderer serialises to a self-contained function')
ok(!/Math\.random|Date\.now|performance\.now|requestAnimationFrame|setTimeout|setInterval/.test(src), 'no randomness, clock or timers in the renderer')
const run = (f) => { const log = []; const p = program(I, palette, { makeCanvas: () => stubCanvas(log), font: 'Inter' }); p.seek(stubCanvas(log).getContext(), f); return log }
for (const f of [0, 40, 71, 72, 86, 100.5, 101, 150, 158, 159, 186, 187, 214, 215, 230, 245, 280, 301, 359]) {
  const l1 = run(f); ok(l1.length > 5 && JSON.stringify(l1) === JSON.stringify(run(f)), `f${f} draws and is deterministic`)
}
ok(JSON.stringify(run(270)) === JSON.stringify(run(286)), 'S7 holds still f269–287')
ok(JSON.stringify(run(250)) !== JSON.stringify(run(251)) && JSON.stringify(run(290)) !== JSON.stringify(run(291)), 'S7 moves outside its hold')
ok(JSON.stringify(run(40)) !== JSON.stringify(run(40.5)), 'half frames differ (continuous motion for the 59.94 master)')
ok(JSON.stringify(s.STING.cuts) === '[72,101,159,187,215,245,301]' && s.STING.frames === 360, 'cut frames exact')
for (const c of [72, 101, 159]) { const next = s.beatSec(Math.round((c / s.STING.fps - 0.048) / 0.4838 + 0.5)); ok(Math.abs((next - c / s.STING.fps) * s.STING.fps - 2) < 1.2, `cut f${c} leads a beat by ~2 frames`) }
ok(s.isBannedHue('#8A2BE2') && s.isBannedHue('#FF8C00') && s.isBannedHue('#FF00FF') && !s.isBannedHue('#2F6BFF') && !s.isBannedHue('#4ED6A0'), 'purple/orange/magenta banned, blues + mint allowed')
ok(s.paletteFor({ brandColors: ['#8A2BE2', '#0055AA'] }).palette.a1 === '#0055AA', 'banned brand colour skipped')
ok(s.sanitizeSting({ pageBody: 'Hello world here', keyPhrase: 'missing' }).keyPhrase === 'Hello world here', 'key phrase must exist in the page')
const html = s.buildStingHtml(I)
ok(html.includes('id="scene"') && /window\.__seek\s*=/.test(html) && /__seek\(0\)/.test(html), 'HTML meets the renderer contract')
ok(!/<script[^>]+src=|https?:\/\//.test(html.replace(/https?:\/\/[^"']*w3\.org[^"']*/g, '')), 'HTML is self-contained')
const mix = a.renderStingAudio()
ok(mix.left.length === Math.round(12.075 * 48000), 'sound is exactly 12.075 s')
ok(Math.abs(mix.lufs + 14) < 0.5 && mix.truePeak <= -1, `mastered −14 LUFS / ≤ −1 dBTP (${mix.lufs.toFixed(2)} / ${mix.truePeak.toFixed(2)})`)
ok(JSON.stringify(Array.from(mix.left.slice(100000, 100050))) === JSON.stringify(Array.from(a.renderStingAudio().left.slice(100000, 100050))), 'sound is deterministic')
ok(Math.abs(mix.left[mix.left.length - 1]) < 1e-3, 'ends on the 60 ms fade')
const panel = readFileSync('src/screens/production/ProductStingPanel.tsx', 'utf8')
ok(panel.includes('STING.stills') && panel.includes('stillsOk') && panel.includes('importArenaZip') && !/publish\(/.test(panel), 'panel: stills gate before the film, adds to project, never publishes')
ok(readFileSync('src/screens/production/ProductionPlanner.tsx', 'utf8').includes('<ProductStingPanel />'), 'panel mounted')
console.log(`product sting OK (${n} assertions)`)
