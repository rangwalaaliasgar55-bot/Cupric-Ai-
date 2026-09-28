// Transitions.dev ThinkingStates + MatrixLoader as Studio clips: presets,
// determinism (preview = export), reduced motion, normalisation, draw path,
// schema + UI wiring, attribution.
import { build } from 'esbuild'
import { readFileSync, rmSync } from 'node:fs'
import assert from 'node:assert/strict'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const out = path.resolve('.check-loaders.mjs')
await build({
  stdin: { contents: "export * as L from './src/lib/studio/loaders'", resolveDir: process.cwd(), loader: 'ts' },
  bundle: true, format: 'esm', platform: 'node', outfile: out, logLevel: 'silent',
})
const { L } = await import(pathToFileURL(out).href)
rmSync(out, { force: true })
let n = 0
const ok = (c, msg) => { assert.ok(c, msg); n++ }
const read = (p) => readFileSync(p, 'utf8')

const want = ['thinking-states', 'matrix-scan', 'matrix-twinkle', 'matrix-orbit', 'matrix-pulse', 'matrix-rounded', 'matrix-monochrome', 'matrix-lime', 'matrix-reduced', 'matrix-compact', 'matrix-large', 'matrix-inline', 'matrix-fullscreen']
for (const id of want) ok(L.loaderPreset(id), `preset ${id}`)

for (const p of L.LOADER_PRESETS) {
  const c = L.makeLoaderClip(p.id, 0, 'x')
  ok(c && c.kind === 'loader', `${p.id} makes a loader clip`)
  const f = (t) => JSON.stringify(c.loader === 'matrix' ? L.matrixFrameAt(c, t) : L.thinkingFrameAt(c, t))
  ok([0, 0.37, 1.9, 5.25].every((t) => f(t) === f(t)), `${p.id} frames deterministic`)
  ok(L.loaderLoopSec(c) > 0, `${p.id} loop length > 0`)
}

// Motion actually happens, and reduced motion freezes it.
const mx = L.makeLoaderClip('matrix-scan', 0, 'm')
ok(JSON.stringify(L.matrixFrameAt(mx, 0.1)) !== JSON.stringify(L.matrixFrameAt(mx, 0.5)), 'matrix animates')
const red = L.makeLoaderClip('matrix-reduced', 0, 'r')
ok(JSON.stringify(L.matrixFrameAt(red, 0.1)) === JSON.stringify(L.matrixFrameAt(red, 0.9)), 'reduced-motion matrix is static')
const th = L.makeLoaderClip('thinking-states', 0, 't')
ok(L.thinkingFrameAt(th, 0.1).current !== L.thinkingFrameAt(th, 2.5).current, 'thinking states rotate')
ok(L.thinkingFrameAt({ ...th, reducedMotion: true }, 1).lines.every((l) => l.blur === 0 && l.dy === 0), 'reduced-motion thinking: no blur/slide')
ok(L.matrixFrameAt(L.makeLoaderClip('matrix-rounded', 0, 'q'), 0.3).filter((c) => c.gap).length === 4, 'rounded removes 4 corners')

// Normalisation survives garbage.
const g = L.normaliseLoader({ loader: 'matrix', variant: 'nope', baseColor: 'red', cycleMs: -5, states: 7 })
ok(g.variant === 'scan' && /^#/.test(g.baseColor) && g.cycleMs >= 100 && g.states.length > 0, 'normalise repairs invalid fields')

// Draw path runs on a recording fake canvas.
let calls = 0
const ctx = new Proxy({}, { get: (t, k) => (k in t ? t[k] : typeof k === 'string' && /^(fill|stroke|line|font|text|global|shadow|filter|image)/.test(k) && !/Rect|Text$|^fill$|^stroke$/.test(k) ? undefined : () => { calls++; return { width: 50, addColorStop() {} } }), set: (t, k, v) => { t[k] = v; return true } })
L.drawLoader(ctx, mx, 0.4, 1080, 1920); L.drawLoader(ctx, th, 0.4, 1080, 1920)
ok(calls > 10, 'drawLoader issues canvas calls for both loaders')

const src = read('src/lib/studio/loaders.ts').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*/g, '')
ok(!/Math\.random|Date\.now|performance\.now/.test(src), 'loader engine has no randomness or wall clock')
ok(/'loader'/.test(read('src/state/projectSchema.ts')), 'schema knows loader clips')
ok(/drawLoader/.test(read('src/lib/studio/renderer.ts')), 'the one renderer (preview + export) draws loaders')
ok(/prefers-reduced-motion|useReducedMotion/.test(read('src/components/loaders/MatrixLoader.tsx') + read('src/components/loaders/ThinkingStates.tsx')), 'UI loaders respect reduced motion')
ok(/transitions\.dev/i.test(read('resources/transitions-dev/ATTRIBUTION.md')), 'attribution present')
console.log(`loaders: ${n} assertions passed`)
