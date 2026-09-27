#!/usr/bin/env node
/** Object-tracked masks: tracker accuracy on synthetic footage, scale, occlusion hold, coordinate mapping, renderer path. */
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { readFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const tmp = path.join(root, '.mask-track-check.mjs')
await build({ bundle: true, outfile: tmp, format: 'esm', platform: 'node', logLevel: 'error', stdin: { contents: "export * from './src/lib/studio/maskTrack'\nexport { trackedMask } from './src/lib/studio/renderer'", resolveDir: root, loader: 'ts' } })
const m = await import(`${pathToFileURL(tmp).href}?t=${Date.now()}`)
await rm(tmp, { force: true })
let n = 0
const ok = (c, msg) => { assert.ok(c, msg); n += 1 }

// Deterministic textured background + a distinct textured subject.
const W = 192, H = 108
const hash = (x, y) => { let h = (x * 374761393 + y * 668265263) | 0; h = (h ^ (h >>> 13)) * 1274126177; return ((h ^ (h >>> 16)) >>> 0) / 4294967296 }
const path_ = (t) => ({ x: 0.25 + 0.45 * t + 0.05 * Math.sin(t * 6), y: 0.45 + 0.18 * Math.sin(t * 3.1) })
function frame(t, { gain = 1, size = 22, hide = false } = {}) {
  const d = new Uint8Array(W * H)
  const c = path_(t)
  const sx = c.x * W, sy = c.y * H
  for (let y = 0; y < H; y += 1) for (let x = 0; x < W; x += 1) {
    let v = 60 + 50 * hash(x >> 2, y >> 2) + 20 * Math.sin(x / 9)
    const dx = x - sx, dy = y - sy
    if (!hide && Math.abs(dx) < size / 2 && Math.abs(dy) < size / 2) {
      const u = Math.floor(((dx / size) + 0.5) * 4), w = Math.floor(((dy / size) + 0.5) * 4)
      v = (u + w) % 2 ? 235 : 25 // checker subject
    }
    d[y * W + x] = Math.max(0, Math.min(255, v * gain))
  }
  return { t, w: W, h: H, data: d }
}
const N = 36
const frames = Array.from({ length: N }, (_, i) => frame(i / (N - 1), { gain: 0.85 + 0.3 * (i / (N - 1)), size: 22 * (1 + 0.2 * (i / (N - 1))) }))
const c0 = path_(0)
const box = { x: c0.x - 11 / W, y: c0.y - 11 / H, w: 22 / W, h: 22 / H }
const pts = m.trackBox(frames, box)
ok(pts.length === N, 'one point per frame')
const errs = pts.map((p, i) => { const c = path_(i / (N - 1)); return Math.hypot((p.x - c.x) * W, (p.y - c.y) * H) })
ok(Math.max(...errs) < 2.5, `follows the subject through brightness change + growth (max err ${Math.max(...errs).toFixed(2)} px of ${W})`)
ok(pts.at(-1).w > pts[0].w * 1.08, `box grows with the subject (${(pts.at(-1).w / pts[0].w).toFixed(2)}x)`)
ok(pts.every((p) => p.confidence > 0.5), 'confident throughout')
ok(JSON.stringify(m.trackBox(frames, box)) === JSON.stringify(pts), 'deterministic')

// Occlusion: subject hidden for 4 frames → holds, flags, then reacquires.
const occ = Array.from({ length: N }, (_, i) => frame(i / (N - 1), { hide: i >= 14 && i < 18 }))
const po = m.trackBox(occ, box)
ok(po.slice(14, 18).some((p) => p.confidence < 0.35), 'occlusion is flagged as low confidence')
const after = po.slice(20).map((p, j) => { const c = path_((j + 20) / (N - 1)); return Math.hypot((p.x - c.x) * W, (p.y - c.y) * H) })
ok(Math.max(...after) < 3, `reacquires after occlusion (max ${Math.max(...after).toFixed(2)} px)`)
ok(/lost the subject on/.test(m.trackSummary(po)), 'summary tells the user about lost frames')

// Simplify keeps a straight path short, curves detailed.
const line = Array.from({ length: 20 }, (_, i) => ({ at: i / 10, x: 0.1 + i * 0.01, y: 0.5, w: 0.2, h: 0.2, confidence: 1 }))
ok(m.simplifyTrack(line).length === 2, 'straight track simplified to two points')
ok(m.simplifyTrack(pts).length > 4, 'curved track keeps its shape')

// Mapping: cover-fit 16:9 source into a 9:16 frame, round trip.
const map = m.sourceFrameMap({ fit: 'cover', x: 0.5, y: 0.5, scale: 1 }, 1920, 1080, 1080, 1920)
const b = { x: 0.4, y: 0.3, w: 0.1, h: 0.2 }
const back = map.toFrame({ ...map.toSource(b) })
ok(Math.abs(back.x - b.x) < 1e-9 && Math.abs(back.w - b.w) < 1e-9, 'frame↔source round trip')
ok(Math.abs(map.toFrame({ x: 0.5, y: 0.5 }).x - 0.5) < 1e-9 && map.toFrame({ x: 0, y: 0 }).x < 0, 'cover crop extends beyond the frame')

// Applied mask: clip-local times (trim/speed), renderer follows the path.
const mask = { shape: 'ellipse', x: 0, y: 0, w: 0.2, h: 0.2, featherPct: 4, invert: false, threshold: 0.5, softness: 0.25 }
const idMap = m.sourceFrameMap({ fit: 'cover', x: 0.5, y: 0.5, scale: 1 }, 1920, 1080, 1920, 1080)
const tracked = m.applyTrack(mask, [{ at: 2, x: 0.3, y: 0.5, w: 0.2, h: 0.2, confidence: 1 }, { at: 4, x: 0.7, y: 0.5, w: 0.2, h: 0.2, confidence: 1 }], idMap, 2, 2)
ok(tracked.track[0].at === 0 && tracked.track[1].at === 1, 'source time → clip-local time (trim 2s, speed 2x)')
const mid = m.trackedMask(tracked, 0.5)
ok(Math.abs(mid.x + mid.w / 2 - 0.5) < 1e-9 && Math.abs(m.trackedMask(tracked, 5).x + 0.1 - 0.7) < 1e-9, 'renderer interpolates and holds the end')
ok(m.trackedMask({ ...mask, shape: 'luma', track: tracked.track }, 0.5).x === 0, 'keys ignore tracks')

const r = readFileSync(path.join(root, 'src/lib/studio/renderer.ts'), 'utf8')
const insp = readFileSync(path.join(root, 'src/screens/studio/StudioInspector.tsx'), 'utf8')
ok(r.includes('trackedMask(clip.mask, t - clip.startSec)'), 'renderer uses the tracked mask for preview and export')
ok(insp.includes('Track subject') && insp.includes('Clear tracking') && insp.includes('it needs a video clip'), 'inspector exposes tracking and explains when it can’t')

console.log(`mask tracking check passed — ${n} assertions`)
