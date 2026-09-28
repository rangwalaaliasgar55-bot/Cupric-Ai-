/**
 * Real Three.js renderer for the `block-row-3d` kit, loaded on demand
 * (dynamic import keeps `three` out of the main bundle). Registers itself
 * with homeKit; if WebGL is unavailable it stays unregistered and the shared
 * 2.5D canvas draw is used instead — preview and export both call drawKit, so
 * they switch together.
 *
 * Deterministic: the scene is rebuilt from (clip, local seconds, progress)
 * every frame — no clock, no randomness. Colours come from the clip's accent
 * (an allowed DESIGN token) and CORE_TOKENS.
 */
import type { StudioKitClip } from '../../types/project'
import { blockLit, CORE_TOKENS, setBlockRow3dRenderer } from './homeKit'

let loading: Promise<boolean> | null = null
let failed = ''

/** Why real 3D is unavailable ('' when it loaded or has not been tried). */
export const blockRow3dError = () => failed

/** Load Three.js and register the renderer. Resolves false (with a reason) when WebGL is missing. */
export function loadBlockRow3d(): Promise<boolean> {
  if (loading) return loading
  loading = (async () => {
    if (typeof document === 'undefined') {
      failed = 'No DOM (Node) — using the 2.5D draw'
      return false
    }
    try {
      const THREE = await import('three')
      const canvas = document.createElement('canvas')
      let renderer: InstanceType<typeof THREE.WebGLRenderer>
      try {
        renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true })
      } catch {
        failed = 'WebGL is not available on this device — using the 2.5D draw'
        return false
      }
      renderer.setPixelRatio(1)
      const scene = new THREE.Scene()
      const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 100)
      scene.add(new THREE.AmbientLight(0xffffff, 0.55))
      const key = new THREE.DirectionalLight(0xffffff, 1.1)
      key.position.set(2, 5, 4)
      scene.add(key)
      const blockGeo = new THREE.BoxGeometry(0.62, 1, 0.62)
      const pinGeo = new THREE.SphereGeometry(0.09, 20, 14)
      const group = new THREE.Group()
      scene.add(group)
      const v = new THREE.Vector3()

      setBlockRow3dRenderer((clip: StudioKitClip, e: number, p: number, w: number, h: number) => {
        const n = Math.min(24, Math.max(2, Math.round(clip.values?.[0] ?? 14)))
        renderer.setSize(w, h, false)
        camera.aspect = w / h
        // Camera push-in over the clip, same as the 2.5D draw.
        const push = clip.reducedMotion ? 0 : p * 0.18
        camera.position.set(-1.2, 1.6, 4.2 - push * 6)
        camera.lookAt(0.8, 0.3, -2)
        camera.updateProjectionMatrix()
        // Rebuild meshes each frame from pure inputs (n ≤ 24, cheap).
        for (const child of [...group.children]) {
          group.remove(child)
          const m = (child as unknown as { material?: { dispose: () => void } }).material
          m?.dispose()
        }
        const accent = new THREE.Color(clip.accent)
        const labels: Array<{ x: number; y: number; i: number; lit: number }> = []
        for (let i = 0; i < n; i += 1) {
          const lit = blockLit(i, n, p)
          const pulse = clip.reducedMotion ? 1 : 0.6 + 0.4 * (0.5 + 0.5 * Math.sin(e * 2.4 + i * 0.7))
          const x = i * 0.85
          const z = -i * 0.55
          const block = new THREE.Mesh(blockGeo, new THREE.MeshStandardMaterial({
            color: new THREE.Color(CORE_TOKENS.panelAlt),
            emissive: accent,
            emissiveIntensity: 0.05 + 0.25 * lit,
            roughness: 0.55,
            metalness: 0.1,
            transparent: true,
            opacity: 0.92,
          }))
          block.position.set(x, 0.5, z)
          group.add(block)
          const pin = new THREE.Mesh(pinGeo, new THREE.MeshStandardMaterial({
            color: lit > 0.01 ? accent : new THREE.Color(CORE_TOKENS.muted),
            emissive: accent,
            emissiveIntensity: 1.6 * lit * pulse,
          }))
          pin.position.set(x, 1.22, z)
          group.add(pin)
          v.set(x, 0.55, z + 0.32).project(camera)
          if (v.z < 1) labels.push({ x: (v.x * 0.5 + 0.5) * w, y: (-v.y * 0.5 + 0.5) * h, i, lit })
        }
        renderer.render(scene, camera)
        return { image: canvas, labels }
      })
      failed = ''
      return true
    } catch (err) {
      failed = `Three.js failed to load (${err instanceof Error ? err.message : String(err)}) — using the 2.5D draw`
      return false
    }
  })()
  return loading
}

/** True when a doc needs the real-3D renderer. */
export const needsBlockRow3d = (clips: ReadonlyArray<{ kind: string; kit?: string; real3d?: boolean }>) =>
  clips.some((c) => c.kind === 'kit' && c.kit === 'block-row-3d' && c.real3d === true)
