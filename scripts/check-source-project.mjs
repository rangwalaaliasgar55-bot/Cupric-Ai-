#!/usr/bin/env node
/**
 * Multi-file source-project ZIP import: a Vite/React film (chapter map,
 * scene components, [t,v] keyframe engine, audio engine, palette, WebGL
 * layer) decomposes into Studio clips; an unrecognisable zip is refused
 * explicitly instead of degrading to a text-only title card.
 */
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { readFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const tmp = path.join(root, '.source-project-check.mjs')
await build({
  bundle: true, outfile: tmp, format: 'esm', platform: 'node', logLevel: 'error',
  stdin: { contents: "export * from './src/lib/studio/sourceProject'\nexport { readGeneratedPackage } from './src/lib/studio/generatedPackage'\nexport { keyframeValuesAt, keyframeFilter } from './src/lib/studio/renderer'\nexport { default as JSZip } from 'jszip'", resolveDir: root, loader: 'ts' },
})
const m = await import(`${pathToFileURL(tmp).href}?t=${Date.now()}`)
await rm(tmp, { force: true })
let n = 0
const ok = (c, msg) => { assert.ok(c, msg); n += 1 }

const film = {
  'aurora-film/package.json': JSON.stringify({ name: 'aurora-film', dependencies: { react: '^18', 'react-dom': '^18', three: '^0.160' }, devDependencies: { vite: '^5' } }),
  'aurora-film/index.html': '<!doctype html><html><head><title>Aurora</title></head><body><div id="root"></div><script type="module" src="/src/main.jsx"></script></body></html>',
  'aurora-film/vite.config.js': "import { defineConfig } from 'vite'\nexport default defineConfig({})",
  'aurora-film/src/film/constants.js': `
    export const FPS = 60
    export const DURATION = 3 * 6 // seconds
    export const COLORS = { bg: '#07070c', text: '#f3efe6', accent: '#ffb347', muted: '#6b6b78' }
    export const CHAPTERS = [
      { name: 'cold_open', start: 0, end: 5 },
      { name: 'the problem', start: 5 },
      { name: 'Reveal', start: 10.5 },
      { name: 'call-to-action', start: 14 },
    ]
  `,
  'aurora-film/src/scenes/ColdOpenScene.jsx': `
    import React from 'react'
    export function ColdOpenScene({ t }) {
      const opacity = [[0, 0], [0.8, 1], [4.2, 1], [5, 0]]
      return (<div className="scene"><h1>Light finds a way</h1><p>A film about focus</p></div>)
    }
  `,
  'aurora-film/src/scenes/ProblemScene.jsx': `
    export const ProblemScene = ({ t, width }) => {
      return <section><h2>Every edit feels like guesswork</h2></section>
    }
  `,
  'aurora-film/src/scenes/RevealScene.jsx': `
    export default function RevealScene({ local }) { return <div><h1>Meet Aurora</h1><span>{local.toFixed(2)}</span></div> }
  `,
  'aurora-film/src/scenes/CtaScene.jsx': `
    export function CtaScene({ t }) { const label = 'Start free today'; return <button>Start free today</button> }
  `,
  'aurora-film/src/engine/keyframes.js': `
    // Keyframe engine: [time, value] pairs, sampled by lerp.
    export const KF = {
      reveal: {
        scale: [[0, 0.8], [1.2, 1], [3.5, 1.06]],
        bloomIntensity: [[0, 0], [1, 0.9], [3.5, 0.3]],
        focus: [[0, 0.2], [1.5, 1]],
        colorDrift: [[0, 0], [3.5, 0.1]],
        wobbleSeed: [[0, 3], [1, 7]],
      },
    }
    export function sample(track, t) { return track[0][1] }
  `,
  'aurora-film/src/engine/audio.js': `
    export function startEngine() { const ctx = new AudioContext(); const o = ctx.createOscillator(); o.connect(ctx.destination); o.start() }
  `,
  'aurora-film/src/bg/ParticleField.jsx': `
    import * as THREE from 'three'
    export function ParticleField() { const r = new THREE.WebGLRenderer(); return null }
  `,
  'aurora-film/src/App.jsx': `
    import { ColdOpenScene } from './scenes/ColdOpenScene'
    export const SCENES = [ColdOpenScene, ProblemScene, RevealScene, CtaScene]
    export default function App() { return <div id="app" /> }
  `,
  'aurora-film/node_modules/three/build/three.module.js': 'export const WRONG = 1',
}
const files = Object.entries(film).filter(([p]) => !p.includes('node_modules')).map(([p, text]) => ({ path: p, text }))

// ——— detection ———
const p = m.detectSourceProject(files, film['aurora-film/index.html'])
ok(p, 'Vite/React film recognised')
ok(p.framework === 'Vite + React' && p.fps === 60, `framework + fps (${p.framework}, ${p.fps})`)
ok(p.durationSec === 18, `DURATION = 3 * 6 evaluated safely (${p.durationSec})`)
ok(p.chapters.length === 4 && p.chapters.map((c) => c.name).join('|') === 'Cold Open|The Problem|Reveal|Call To Action', `chapters named (${p.chapters.map((c) => c.name)})`)
ok(JSON.stringify(p.chapters.map((c) => [c.startSec, c.durationSec])) === '[[0,5],[5,5.5],[10.5,3.5],[14,4]]', `chapter timing incl. end / next start / film end (${JSON.stringify(p.chapters.map((c) => [c.startSec, c.durationSec]))})`)
ok(p.scenes.length === 4 && !p.scenes.some((s) => /App|ParticleField/.test(s.name)), `4 scene components (${p.scenes.map((s) => s.name)})`)
ok(p.scenes.map((s) => s.chapterIndex).join() === '0,1,2,3', 'scenes mapped to chapters')
ok(p.scenes[0].lines.includes('Light finds a way') && p.scenes[3].lines.includes('Start free today'), 'scene copy extracted')
const reveal = p.scenes.find((s) => s.name === 'RevealScene')
ok(reveal.tracks.some((t) => t.channel === 'glow') && reveal.tracks.some((t) => t.channel === 'blur') && reveal.tracks.some((t) => t.channel === 'hue'), 'engine keyframes routed to the Reveal scene (by enclosing key)')
ok(p.notes.some((x) => /wobbleSeed/.test(x)), 'unsupported params reported, not silently dropped')
ok(p.palette.find((c) => c.name === 'accent')?.color === '#ffb347', 'palette read')
ok(p.webgl?.kind === 'three' && /ParticleField/.test(p.webgl.file), 'WebGL layer found')
ok(p.audio.synthesized && /audio\.js$/.test(p.audio.module), 'synthesised audio engine detected')

// ——— conversion ———
let k = 0
const imp = m.sourceProjectToClips(p, { trackCount: 3 }, 0, (pre) => `${pre}${k++}`)
const kinds = imp.clips.map((c) => c.kind)
ok(kinds.filter((x) => x === 'background').length === 1 && kinds.filter((x) => x === 'text').length === 4 && kinds.filter((x) => x === 'overlay').length === 4, `layer + 4 chapter clips + 4 scene overlays (${kinds})`)
const bg = imp.clips.find((c) => c.kind === 'background')
ok(bg.startSec === 0 && bg.durationSec === 18 && bg.track === 0 && /3D layer/.test(bg.name), 'WebGL → background layer across the film')
const ch = imp.clips.filter((c) => c.kind === 'text')
ok(ch[2].startSec === 10.5 && ch[2].durationSec === 3.5 && ch[2].name === '03 Reveal' && ch[2].text === 'Meet Aurora', 'chapter clip at its time with its copy')
ok(ch.every((c) => c.color.toLowerCase() === '#f3efe6'), 'text uses the palette')
const ov = imp.clips.filter((c) => c.kind === 'overlay')
ok(new Set(ov.map((c) => c.track)).size === 1 && ov.every((c) => c.track > ch[0].track), 'scenes on their own track above chapters')
ok(ov.every((c) => c.dataUrl.startsWith('data:image/svg+xml') && decodeURIComponent(c.dataUrl).includes('#07070c')), 'scene cards drawn in the palette')
ok(ov[0].source.endsWith('#ColdOpenScene'), 'overlay remembers its source component')
const open = ov[0].keyframes
ok(open && open.length === 4 && open[1].at === 0.8 && open[1].opacity === 1 && open[3].opacity === 0, 'scene-local opacity keys converted')
const rv = ov.find((c) => c.name === 'Reveal Scene').keyframes
ok(rv && rv.every((key) => ['scale', 'glow', 'blur', 'hue'].every((f) => typeof key[f] === 'number')), 'every channel sampled at every key (no holes)')
ok(Math.abs(rv[0].blur - 11.2) < 1e-6 && rv.find((x) => x.at === 1.5).blur === 0, 'focus 0.2→1 becomes blur 11.2px→sharp')
ok(Math.abs(rv.at(-1).hue - 36) < 1e-6, 'colour drift 0..1 → degrees')
const vals = m.keyframeValuesAt({ ...ov[2], startSec: 10.5 }, 10.5 + 1)
ok(vals && vals.glow > 0.8 && vals.scale > 0.95, 'renderer interpolates imported curves')
ok(/blur\(.*brightness\(.*hue-rotate\(/.test(m.keyframeFilter({ ...ov[2], startSec: 0 }, 0.5, 1080)), 'renderer applies focus/bloom/drift')
ok(imp.markers.length === 4 && imp.markers[1].at === 5 && imp.markers[1].label === 'The Problem', 'chapter markers')
ok(imp.notes.some((x) => /synthesised/.test(x)) && imp.notes.some((x) => /background layer/.test(x)), 'honest notes for audio + WebGL')

// ——— parallel-array chapter map (CH_T + CHAPTERS) ———
const alt = m.detectSourceProject([
  { path: 'src/data.ts', text: "export const CHAPTERS = ['Hook', 'Proof', 'Close']\nexport const CH_T = [0, 3.5, 9, 12]" },
  { path: 'src/Hook.tsx', text: 'export function Hook({ t }: { t: number }) { return <h1>Stop scrolling</h1> }' },
  { path: 'src/Proof.tsx', text: 'export function Proof({ t }) { return <p>10x faster edits</p> }' },
])
ok(alt && JSON.stringify(alt.chapters.map((c) => [c.name, c.startSec, c.durationSec])) === '[["Hook",0,3.5],["Proof",3.5,5.5],["Close",9,3]]', `CH_T parallel arrays (${JSON.stringify(alt?.chapters)})`)
ok(alt.scenes.find((s) => s.name === 'Proof').chapterIndex === 1, 'scene matched by name')

// ——— no execution, no false positives ———
ok(m.detectSourceProject([{ path: 'a.js', text: "export const X = fetch('/evil')" }, { path: 'b.js', text: 'console.log(1)' }]) === null, 'plain scripts are not a film')
ok(!m.readConstants([{ path: 'x.js', text: "const A = alert('pwned')\nconst B = 2 * 3" }]).has('A') && m.readConstants([{ path: 'x.js', text: 'const B = 2 * 3' }]).get('B') === 6, 'calls are never evaluated; arithmetic is')

// ——— through a real zip ———
const zip = new m.JSZip()
for (const [pth, text] of Object.entries(film)) zip.file(pth, text)
zip.file('aurora-film/public/theme.mp3', new Uint8Array([0xff, 0xfb, 0x90, 0x00]))
const blob = await zip.generateAsync({ type: 'uint8array' })
const pkg = await m.readGeneratedPackage(new File([blob], 'aurora-film.zip'))
ok(pkg.sources.length >= 10 && !pkg.sources.some((s) => s.path.includes('node_modules')), 'package exposes every source file (node_modules skipped)')
ok(m.detectSourceProject(pkg.sources, pkg.html)?.chapters.length === 4, 'detected straight from the zip')
ok(pkg.assets.some((a) => a.sourcePath.endsWith('theme.mp3')), 'audio file carried for the audio track')

// ——— neither shape → explicit message ———
const junk = [{ path: 'notes/readme.md', text: '# hi' }, { path: 'lib/util.js', text: 'export const add = (a, b) => a + b' }, { path: 'lib/more.js', text: 'export function x() {}' }]
ok(m.detectSourceProject(junk, '') === null, 'unrelated code not recognised')
const msg = m.unrecognizedMessage('stuff.zip', junk, '')
ok(/found 2 source files/.test(msg) && /no importable scene format/.test(msg) && /Nothing was imported/.test(msg), `explicit refusal (${msg.slice(0, 60)}…)`)

const studio = readFileSync(path.join(root, 'src/screens/Studio.tsx'), 'utf8')
ok(studio.includes('detectSourceProject(generated.sources, generated.html)') && studio.includes("pushToast('error', unrecognizedMessage("), 'Studio routes source projects and refuses unknown zips')

console.log(`source project import check passed — ${n} assertions`)
