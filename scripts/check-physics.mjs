#!/usr/bin/env node
/** Studio physics: real Rapier simulation, cached 60 Hz frames (scrubbable), presets behave, export gate, UI reachable. */
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { readFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const tmp = path.join(root, '.physics-check.mjs')
await build({ bundle: true, outfile: tmp, format: 'esm', platform: 'node', logLevel: 'error', stdin: { contents: "export * from './src/lib/studio/physics'\nexport { STUDIO_BACKGROUNDS, backgroundById } from './src/lib/studio/backgrounds'", resolveDir: root, loader: 'ts' } })
const m = await import(`${pathToFileURL(tmp).href}?t=${Date.now()}`)
let n = 0
const ok = (c, msg) => { assert.ok(c, msg); n += 1 }

const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'))
ok(pkg.dependencies['@dimforge/rapier3d-compat'], 'Rapier is a declared dependency (not transitive luck)')
ok(m.physicsFrame('stack', 1) === null, 'nothing simulated before the engine loads')
let fired = 0
m.onPhysicsReady(() => { fired += 1 })
await m.loadPhysics()
ok(m.physicsReady() && fired === 1, 'engine loads and notifies the preview')

const ys = (preset, sec) => { const f = m.physicsFrame(preset, sec); return Array.from({ length: f.bodies.length }, (_, i) => f.data[i * 3 + 1]) }
const xs = (preset, sec) => { const f = m.physicsFrame(preset, sec); return Array.from({ length: f.bodies.length }, (_, i) => f.data[i * 3]) }

// Stack: the tower's top block ends much lower after the ball hits.
const top0 = Math.max(...ys('stack', 0).slice(0, 10)), top4 = Math.max(...ys('stack', 4).slice(0, 10))
ok(top0 > 2.5 && top4 < top0 - 1.5, `stack is knocked over (top ${top0.toFixed(2)} → ${top4.toFixed(2)})`)
// Drop: everything falls and comes to rest on the floor (y ≥ -2.1).
const drop = ys('drop', 8)
ok(Math.max(...drop) < Math.max(...ys('drop', 0)) - 3 && Math.min(...drop) > -2.2, 'drop: bodies fall and rest on the floor')
// Explosion: spread widens after the burst at 0.8s.
const spread = (s) => { const x = xs('explosion', s); return Math.max(...x) - Math.min(...x) }
ok(spread(0.5) < 2 && spread(2) > spread(0.5) * 2, `explosion bursts (${spread(0.5).toFixed(2)} → ${spread(2).toFixed(2)})`)
// Dominoes: the last domino ends up rotated (fallen).
const last = (s) => { const f = m.physicsFrame('dominoes', s); return Math.abs(f.data[(f.bodies.length - 1) * 3 + 2]) }
ok(last(0) < 0.01 && last(8) > 0.8, `dominoes topple to the end (${last(8).toFixed(2)} rad)`)

// Scrubbable: seeking back returns identical cached frames; frames quantised to 60 Hz.
const a = Array.from(m.physicsFrame('stack', 2.5).data)
m.physicsFrame('stack', 6)
ok(JSON.stringify(Array.from(m.physicsFrame('stack', 2.5).data)) === JSON.stringify(a), 'scrubbing back replays the exact cached frame')
ok(m.physicsFrame('stack', 1 / 60 * 30.2).data === m.physicsFrame('stack', 0.5).data, 'time quantised to the 60 Hz cache')

// Backgrounds registry + local time + export gate.
ok(m.PHYSICS_PRESETS.every((p) => m.backgroundById(`physics-${p.id}`).id === `physics-${p.id}` && m.backgroundById(`physics-${p.id}`).local), 'every preset is a Studio background layer (local time)')
const r = readFileSync(path.join(root, 'src/lib/studio/renderer.ts'), 'utf8')
ok(r.includes('bg.local ? Math.max(0, t - clip.startSec) : t'), 'layer simulates from its own start')
ok(readFileSync(path.join(root, 'src/lib/studio/export.ts'), 'utf8').includes('await ensurePhysicsFor(doc)'), 'export waits for the engine')
ok(readFileSync(path.join(root, 'src/screens/studio/StudioPreview.tsx'), 'utf8').includes('onPhysicsReady('), 'preview repaints when the engine lands')
ok(!/Math\.random|Date\.now|performance\.now/.test(readFileSync(path.join(root, 'src/lib/studio/physics.ts'), 'utf8')), 'no randomness or clock in the simulation')
await rm(tmp, { force: true })
console.log(`physics check passed — ${n} assertions (Rapier ${pkg.dependencies['@dimforge/rapier3d-compat']})`)
