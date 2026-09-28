/**
 * Lottie stickers, made deterministic.
 *
 * lottie-web normally plays against the wall clock, which is exactly wrong for
 * an editor: scrubbing back to 3.2s must show what 3.2s showed the first time,
 * and the exporter — which runs slower than real time — must not fall behind.
 * So every animation here is loaded paused and advanced with
 * `goToAndStop(frame, true)`. The timeline is the only clock.
 *
 * Each sticker renders into its own offscreen canvas; the frame renderer just
 * draws that canvas. Nothing touches the DOM the user can see.
 */
import type { AnimationItem } from 'lottie-web'

/**
 * lottie-web (~300 kB) is loaded on demand so it is not in the first-paint
 * bundle. Export awaits `preloadLottie()` before drawing any frame, so export
 * output is unchanged; the Studio preloads it on mount.
 */
type LottieModule = typeof import('lottie-web').default
let lottie: LottieModule | null = null
let lottieLoading: Promise<void> | null = null
export function preloadLottie(): Promise<void> {
  if (lottie) return Promise.resolve()
  if (!lottieLoading) lottieLoading = import('lottie-web').then((m) => { lottie = (m as unknown as { default?: LottieModule }).default ?? (m as unknown as LottieModule) })
  return lottieLoading
}
import type { StudioStickerClip } from '../../types/project'

/** Built-ins, bundled at build time — a sticker must work with no network. */
const BUILT_IN = import.meta.glob('../../../resources/lottie/*.json', {
  eager: true,
  import: 'default',
}) as Record<string, unknown>

export type StickerInfo = { id: string; name: string; durationSec: number }

function idFromPath(p: string) {
  return p.slice(p.lastIndexOf('/') + 1).replace(/\.json$/, '')
}

const BUILT_IN_BY_ID = new Map<string, Record<string, unknown>>(
  Object.entries(BUILT_IN)
    .filter(([path]) => idFromPath(path) !== 'index')
    .map(([path, json]) => [idFromPath(path), json as Record<string, unknown>]),
)

/** Sticker catalogue for the picker, sorted so the list never reorders itself. */
export const STICKERS: StickerInfo[] = [...BUILT_IN_BY_ID.entries()]
  .map(([id, json]) => ({
    id,
    name: String((json as { nm?: string }).nm ?? id),
    durationSec: Number(((json as { op: number; fr: number }).op / (json as { fr: number }).fr).toFixed(3)),
  }))
  .sort((a, b) => a.name.localeCompare(b.name))

export function stickerById(id: string): StickerInfo | null {
  return STICKERS.find((s) => s.id === id) ?? null
}

type Entry = {
  anim: AnimationItem
  canvas: HTMLCanvasElement
  totalFrames: number
  frameRate: number
  /** The frame currently painted, so an unchanged frame is never re-rendered. */
  painted: number
}

const cache = new Map<string, Entry | 'failed'>()

/** Cache key: built-ins by id, imported JSON by clip (its content can change). */
function keyFor(clip: StudioStickerClip) {
  return clip.stickerId === 'custom' ? `custom:${clip.id}:${(clip.json ?? '').length}` : `builtin:${clip.stickerId}`
}

function dataFor(clip: StudioStickerClip): Record<string, unknown> | null {
  if (clip.stickerId === 'custom') {
    if (!clip.json) return null
    try {
      return JSON.parse(clip.json) as Record<string, unknown>
    } catch {
      return null
    }
  }
  return BUILT_IN_BY_ID.get(clip.stickerId) ?? null
}

/** Offscreen resolution. 512 is enough for a sticker at any sane on-screen size. */
const SIZE = 512

function ensure(clip: StudioStickerClip): Entry | null {
  const key = keyFor(clip)
  const existing = cache.get(key)
  if (existing === 'failed') return null
  if (existing) return existing
  if (typeof document === 'undefined') return null

  const data = dataFor(clip)
  if (!data) {
    cache.set(key, 'failed')
    return null
  }

  const canvas = document.createElement('canvas')
  const w = Number((data as { w?: number }).w) || SIZE
  const h = Number((data as { h?: number }).h) || SIZE
  const fit = SIZE / Math.max(w, h)
  canvas.width = Math.max(1, Math.round(w * fit))
  canvas.height = Math.max(1, Math.round(h * fit))
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    cache.set(key, 'failed')
    return null
  }

  if (!lottie) {
    // Not loaded yet: draw nothing this frame (never cache as failed).
    void preloadLottie()
    return null
  }
  try {
    const anim = lottie.loadAnimation<'canvas'>({
      renderer: 'canvas',
      // `context` is what actually receives the drawing; `container` is only
      // required by the types, and the canvas renderer ignores it.
      container: canvas,
      loop: false,
      autoplay: false,
      animationData: JSON.parse(JSON.stringify(data)),
      rendererSettings: { context: ctx, clearCanvas: true, preserveAspectRatio: 'xMidYMid meet' },
    })
    const entry: Entry = {
      anim,
      canvas,
      totalFrames: Math.max(1, anim.totalFrames || 1),
      frameRate: anim.frameRate || 60,
      painted: -1,
    }
    cache.set(key, entry)
    return entry
  } catch {
    cache.set(key, 'failed')
    return null
  }
}

/**
 * The sticker's canvas, wound to the frame that belongs at `localSec`.
 *
 * Returns null while the sticker cannot be built (bad JSON, no DOM) — the
 * renderer then simply draws nothing, which is better than an exception in the
 * middle of an export.
 */
export function stickerFrame(clip: StudioStickerClip, localSec: number): CanvasImageSource | null {
  const entry = ensure(clip)
  if (!entry) return null
  const speed = clip.speed > 0 ? clip.speed : 1
  const raw = localSec * speed * entry.frameRate
  const last = entry.totalFrames - 1
  // Looping wraps; otherwise the sticker holds its final frame, which is what
  // a "check mark appears" sticker should do for the rest of the clip.
  const frame = clip.loop ? ((raw % entry.totalFrames) + entry.totalFrames) % entry.totalFrames : Math.min(raw, last)
  const quantised = Math.round(frame * 1000) / 1000
  if (quantised !== entry.painted) {
    entry.anim.goToAndStop(quantised, true)
    entry.painted = quantised
  }
  return entry.canvas
}

/** Natural aspect of a sticker, for laying it out before any frame is drawn. */
export function stickerAspect(clip: StudioStickerClip): number {
  const entry = ensure(clip)
  if (!entry) return 1
  return entry.canvas.width / entry.canvas.height
}

/** Drop cached players — call when a project closes, so memory does not creep. */
export function releaseStickers() {
  for (const entry of cache.values()) {
    if (entry !== 'failed') entry.anim.destroy()
  }
  cache.clear()
}
