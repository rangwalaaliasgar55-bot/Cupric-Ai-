/**
 * Real rigid-body physics for Studio (Rapier, WASM — see 3D_SPEC.md).
 *
 * Scrubbable by construction: each preset is simulated once at a fixed 60 Hz
 * step from a deterministic initial state, and every step's transforms are
 * cached. Drawing time t reads frame round(t·60) — seeking backwards or
 * exporting replays the exact same motion; nothing depends on wall-clock time or
 * a random source.
 *
 * Rapier loads lazily (≈1.4 MB WASM). Until it is ready the layer paints a
 * labelled placeholder and `onPhysicsReady` fires so the preview redraws;
 * export awaits `ensurePhysicsFor(doc)` so frames are never baked without it.
 */
import type { StudioDoc } from '../../types/project'

type Rapier = typeof import('@dimforge/rapier3d-compat')
type Body = { kind: 'box' | 'ball' | 'domino'; hx: number; hy: number }

export const PHYSICS_PRESETS = [
  { id: 'stack', name: 'Stack knock-over', detail: 'A tower of blocks hit by a ball.' },
  { id: 'drop', name: 'Drop & pile', detail: 'Blocks and balls rain down and settle.' },
  { id: 'explosion', name: 'Explosion', detail: 'A cube of blocks bursts outward.' },
  { id: 'dominoes', name: 'Dominoes', detail: 'A row of dominoes topples in sequence.' },
] as const
export type PhysicsPreset = (typeof PHYSICS_PRESETS)[number]['id']

export const PHYSICS_HZ = 60
const MAX_SEC = 30

let R: Rapier | null = null
let loading: Promise<void> | null = null
let failed: string | null = null
const listeners = new Set<() => void>()

export function physicsReady() { return R !== null }
export function physicsError() { return failed }
export function onPhysicsReady(fn: () => void): () => void { listeners.add(fn); return () => listeners.delete(fn) }

export function loadPhysics(): Promise<void> {
  if (R) return Promise.resolve()
  if (!loading) {
    loading = import('@dimforge/rapier3d-compat')
      .then(async (m) => {
        const mod = ((m as unknown as { default?: Rapier }).default ?? (m as unknown as Rapier))
        await mod.init()
        R = mod
        listeners.forEach((fn) => fn())
      })
      .catch((err) => { failed = err instanceof Error ? err.message : String(err); loading = null; throw err })
  }
  return loading
}

export const isPhysicsBackground = (id: string) => id.startsWith('physics-')
const presetOf = (id: string): PhysicsPreset => (id.slice('physics-'.length) as PhysicsPreset)

/** Export/render gate: resolves once every physics layer in the doc can draw. */
export async function ensurePhysicsFor(doc: Pick<StudioDoc, 'clips' | 'backgroundId'>): Promise<void> {
  const uses = isPhysicsBackground(doc.backgroundId) || doc.clips.some((c) => c.kind === 'background' && isPhysicsBackground(c.backgroundId))
  if (uses) await loadPhysics()
}

type Sim = { bodies: Body[]; frames: Float32Array[]; step: () => void }
const sims = new Map<string, Sim>()

/** Deterministic 0..1 hash (no random source). */
const hash1 = (n: number) => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x) }

function build(preset: PhysicsPreset): Sim {
  const r = R!
  const world = new r.World({ x: 0, y: -9.81, z: 0 })
  world.timestep = 1 / PHYSICS_HZ
  world.createCollider(r.ColliderDesc.cuboid(40, 0.5, 40).setTranslation(0, -2.5, 0).setFriction(0.8))
  const handles: import('@dimforge/rapier3d-compat').RigidBody[] = []
  const bodies: Body[] = []
  const add = (x: number, y: number, z: number, kind: Body['kind'], hx = 0.25, hy = hx) => {
    const b = world.createRigidBody(r.RigidBodyDesc.dynamic().setTranslation(x, y, z).setCanSleep(true))
    world.createCollider((kind === 'ball' ? r.ColliderDesc.ball(hx) : r.ColliderDesc.cuboid(hx, hy, kind === 'domino' ? 0.3 : hx)).setRestitution(kind === 'ball' ? 0.35 : 0.1).setFriction(0.6).setDensity(kind === 'ball' ? 3 : 1), b)
    handles.push(b); bodies.push({ kind, hx, hy })
    return b
  }
  let explodeAt = -1
  if (preset === 'stack') {
    for (let i = 0; i < 10; i += 1) add(((i % 2) - 0.5) * 0.02, -1.75 + i * 0.505, 0, 'box')
    add(-7, -1.2, 0, 'ball', 0.45).setLinvel({ x: 13, y: 1.2, z: 0 }, true)
  } else if (preset === 'drop') {
    for (let i = 0; i < 36; i += 1) add((hash1(i) - 0.5) * 4, 1 + i * 0.4, (hash1(i * 3) - 0.5) * 0.6, i % 3 ? 'box' : 'ball', 0.2 + hash1(i * 7) * 0.14)
  } else if (preset === 'explosion') {
    for (let x = 0; x < 4; x += 1) for (let y = 0; y < 4; y += 1) add((x - 1.5) * 0.52, -1.75 + y * 0.51, 0, 'box')
    explodeAt = Math.round(PHYSICS_HZ * 0.8)
  } else {
    for (let i = 0; i < 16; i += 1) add(-4.2 + i * 0.56, -1.5, 0, 'domino', 0.07, 0.5)
    handles[0].applyImpulse({ x: 0.35, y: 0, z: 0 }, true)
  }
  const frames: Float32Array[] = []
  const snapshot = () => {
    // Per body: x, y, z-rotation (front view).
    const a = new Float32Array(handles.length * 3)
    handles.forEach((b, i) => {
      const t = b.translation(), q = b.rotation()
      a[i * 3] = t.x; a[i * 3 + 1] = t.y
      a[i * 3 + 2] = Math.atan2(2 * (q.w * q.z + q.x * q.y), 1 - 2 * (q.y * q.y + q.z * q.z))
    })
    frames.push(a)
  }
  snapshot()
  const step = () => {
    const f = frames.length
    if (f === explodeAt) handles.forEach((b) => { const t = b.translation(); const d = Math.hypot(t.x, t.y + 2) + 0.3; b.applyImpulse({ x: (t.x / d) * 1.3, y: 1.8 / d + 0.7, z: 0 }, true) })
    world.step()
    snapshot()
  }
  return { bodies, frames, step }
}

/** Cached transforms for `preset` at local time `sec` (null while Rapier loads). */
export function physicsFrame(preset: PhysicsPreset, sec: number): { bodies: Body[]; data: Float32Array } | null {
  if (!R) return null
  let sim = sims.get(preset)
  if (!sim) { sim = build(preset); sims.set(preset, sim) }
  const f = Math.max(0, Math.min(MAX_SEC * PHYSICS_HZ, Math.round(sec * PHYSICS_HZ)))
  while (sim.frames.length <= f) sim.step()
  return { bodies: sim.bodies, data: sim.frames[f] }
}

const COLORS = ['#C8F542', '#4FB6E8', '#F4F1EA', '#E24B4A', '#9A9AA5']

/** Paint the physics layer (orthographic front view, 6 world units tall ≈ frame height). */
export function paintPhysics(ctx: CanvasRenderingContext2D, backgroundId: string, w: number, h: number, sec: number) {
  const g = ctx.createLinearGradient(0, 0, 0, h)
  g.addColorStop(0, '#15151B')
  g.addColorStop(1, '#0B0B10')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, w, h)
  const u = h / 6.2
  const ox = w / 2, oy = h * 0.5
  const floorY = oy + 2 * u
  ctx.fillStyle = 'rgba(244,241,234,0.06)'
  ctx.fillRect(0, floorY, w, h - floorY)
  const frame = physicsFrame(presetOf(backgroundId), sec)
  if (!frame) {
    if (!failed) void loadPhysics().catch(() => undefined)
    ctx.fillStyle = '#9A9AA5'
    ctx.font = `600 ${Math.round(h * 0.03)}px 'Inter Variable', Inter, sans-serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(failed ? `Physics engine failed to load: ${failed}` : 'Loading physics engine…', w / 2, h / 2)
    return
  }
  frame.bodies.forEach((b, i) => {
    const x = ox + frame.data[i * 3] * u, y = oy - frame.data[i * 3 + 1] * u, rot = frame.data[i * 3 + 2]
    ctx.save()
    ctx.translate(x, y)
    ctx.rotate(-rot)
    ctx.fillStyle = COLORS[i % COLORS.length]
    ctx.shadowColor = 'rgba(0,0,0,0.45)'
    ctx.shadowBlur = u * 0.15
    ctx.shadowOffsetY = u * 0.05
    if (b.kind === 'ball') {
      ctx.beginPath()
      ctx.arc(0, 0, b.hx * u, 0, Math.PI * 2)
      ctx.fill()
    } else {
      const bw = b.hx * 2 * u, bh = b.hy * 2 * u, rr = Math.min(bw, bh) * 0.18
      ctx.beginPath()
      ctx.moveTo(-bw / 2 + rr, -bh / 2)
      ctx.arcTo(bw / 2, -bh / 2, bw / 2, bh / 2, rr)
      ctx.arcTo(bw / 2, bh / 2, -bw / 2, bh / 2, rr)
      ctx.arcTo(-bw / 2, bh / 2, -bw / 2, -bh / 2, rr)
      ctx.arcTo(-bw / 2, -bh / 2, bw / 2, -bh / 2, rr)
      ctx.closePath()
      ctx.fill()
    }
    ctx.restore()
  })
}
