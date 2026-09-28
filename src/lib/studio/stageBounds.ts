/**
 * JOB 7 — nothing drifts off the stage.
 *
 * `x` and `y` are the clip's normalised centre (0..1 across the frame) and
 * `scale` multiplies its natural size. Nothing stopped a drop, a keyframe or an
 * agent op writing x = 3.4, which puts a resource three frames to the right of
 * anything anybody will ever see.
 *
 * This module is the single source of truth for what is allowed. It is applied
 * in three places — on write (drop / keyframe / agent op) and once more in the
 * renderer's resolve pass, which preview and export share — so a value that
 * slipped in from an older project or a hand-edited file is still corrected on
 * screen, and corrected identically in the exported file.
 *
 * Pure, no imports: the fuzz gate runs it ten thousand times in Node.
 */

/**
 * How far a clip's centre may sit outside the frame.
 *
 * Zero would be too strict: a title that bleeds off one edge on purpose is a
 * real design, and clamping its centre to the edge would change existing
 * projects. A small overhang keeps that possible while guaranteeing the anchor
 * — and therefore a visible part of every clip — is always on or beside the
 * stage rather than lost in space.
 */
export const STAGE_OVERHANG = 0.25
export const STAGE_MIN = -STAGE_OVERHANG
export const STAGE_MAX = 1 + STAGE_OVERHANG

/** Scale limits: below this it is invisible, above it nothing but noise fills the frame. */
export const SCALE_MIN = 0.05
export const SCALE_MAX = 8

/** Title-safe insets per aspect, as a fraction of width/height. */
export const SAFE_AREAS: Record<string, { x: number; y: number; note: string }> = {
  '16:9': { x: 0.05, y: 0.05, note: 'Broadcast title-safe: 5% on every edge.' },
  '9:16': { x: 0.06, y: 0.14, note: 'Reels/Shorts: the app puts captions and buttons over the bottom ~14%.' },
  '1:1': { x: 0.06, y: 0.06, note: 'Feed square: 6% keeps text clear of crops.' },
  '4:5': { x: 0.06, y: 0.09, note: 'Portrait feed: 9% top and bottom for the profile chrome.' },
}

export function safeAreaFor(aspect: string | undefined): { x: number; y: number; note: string } {
  return SAFE_AREAS[aspect ?? '16:9'] ?? SAFE_AREAS['16:9']
}

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v)

/** A finite number, or the fallback — NaN and Infinity are placements too. */
function finite(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback
}

export type Placement = { x?: number; y?: number; scale?: number }

/**
 * Clamp a placement into the stage.
 *
 * Only keys that are present come back, so this is safe to spread over a patch
 * without inventing an `x` on a clip that never had one.
 */
export function clampPlacement<T extends Placement>(p: T): T {
  const out = { ...p }
  if (p.x !== undefined) out.x = clamp(finite(p.x, 0.5), STAGE_MIN, STAGE_MAX)
  if (p.y !== undefined) out.y = clamp(finite(p.y, 0.5), STAGE_MIN, STAGE_MAX)
  if (p.scale !== undefined) out.scale = clamp(finite(p.scale, 1), SCALE_MIN, SCALE_MAX)
  return out
}

/** True when a placement would have been moved. Used to explain, not to block. */
export function isOutOfStage(p: Placement): boolean {
  const c = clampPlacement(p)
  return c.x !== p.x || c.y !== p.y || c.scale !== p.scale
}

/**
 * Is this placement outside the title-safe area for `aspect`?
 *
 * Unlike the hard clamp this never changes anything — it is the pre-export
 * warning, because "your caption sits under the Reels button" is advice, not
 * an error.
 */
export function outsideSafeArea(p: Placement, aspect: string | undefined): false | 'top' | 'bottom' | 'left' | 'right' {
  const safe = safeAreaFor(aspect)
  const x = finite(p.x, 0.5)
  const y = finite(p.y, 0.5)
  if (y < safe.y) return 'top'
  if (y > 1 - safe.y) return 'bottom'
  if (x < safe.x) return 'left'
  if (x > 1 - safe.x) return 'right'
  return false
}

/** One sentence naming what will be trimmed and where. Never a dialog. */
export function overflowMessage(name: string, where: Exclude<ReturnType<typeof outsideSafeArea>, false>, aspect: string | undefined): string {
  const safe = safeAreaFor(aspect)
  return `“${name}” sits past the ${where} safe edge for ${aspect ?? '16:9'}. ${safe.note} It will still export — move it in if you want it readable on every device.`
}

/**
 * Clamp every placement-bearing field of a clip, including its keyframes.
 *
 * Returns the same object when nothing needed changing, so the renderer's
 * identity-based caches (F-4) keep hitting.
 */
export function clampClipPlacement<T extends { x?: number; y?: number; scale?: number; keyframes?: ReadonlyArray<Placement & { at: number }> | null }>(clip: T): T {
  const base = clampPlacement(clip)
  let changed = base.x !== clip.x || base.y !== clip.y || base.scale !== clip.scale
  let keyframes = clip.keyframes
  if (clip.keyframes?.length) {
    const next = clip.keyframes.map((k) => {
      const c = clampPlacement(k)
      if (c.x === k.x && c.y === k.y && c.scale === k.scale) return k
      changed = true
      return { ...k, ...c }
    })
    if (changed) keyframes = next
  }
  if (!changed) return clip
  return { ...clip, ...base, ...(clip.keyframes ? { keyframes } : {}) }
}
