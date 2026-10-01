/**
 * The platform-safe area type is placed in, as canvas fractions.
 *
 * Ported from veedstudio/open-edit `cli/src/safe-zone.ts` (Apache-2.0 — see
 * THIRD_PARTY_NOTICES.md). One definition: the safe-zone gate, the placement
 * measurement and the design engine's margins all mean these numbers, because a
 * second copy is how a gate ends up measuring against a zone the author was
 * never told about.
 *
 * NewBrand's own `safeArea()` (studio/design.ts) expresses the same idea as
 * per-edge insets; `safeZoneFor` is the single source both of them — and the
 * gate — now read.
 */
import type { StudioAspect } from '../../types/project'

export interface Zone {
  x0: number
  x1: number
  y0: number
  y1: number
}

/** 9:16 keeps the band a feed's own chrome covers clear; 16:9 and 1:1 are plain insets. */
export function safeZone(w: number, h: number): Zone {
  if (h > w) return { x0: 0.06, x1: 0.89, y0: 0.11, y1: 0.83 }
  const inset = w === h ? 0.05 : 0.06
  return { x0: inset, x1: 1 - inset, y0: inset, y1: 1 - inset }
}

/**
 * The canvas a doc's aspect renders to before any user resolution choice — the
 * zone only depends on orientation, so this is the aspect's own ratio at 1080
 * on the short edge (matching `sizeForAspect`).
 */
export function canvasForAspect(aspect: StudioAspect): [number, number] {
  if (aspect === '1:1') return [1080, 1080]
  if (aspect === '4:5') return [1080, 1350]
  if (aspect === '9:16') return [1080, 1920]
  return [1920, 1080]
}

export function safeZoneFor(aspect: StudioAspect): Zone {
  const [w, h] = canvasForAspect(aspect)
  return safeZone(w, h)
}

/** Edge insets (fractions of the frame) in the shape the design engine uses. */
export function insetsOf(zone: Zone): { top: number; bottom: number; left: number; right: number } {
  return { top: zone.y0, bottom: 1 - zone.y1, left: zone.x0, right: 1 - zone.x1 }
}

export type Rect = { x: number; y: number; w: number; h: number }

/** True when the whole rect (canvas fractions, centre-based) sits inside the zone. */
export function insideZone(rect: Rect, zone: Zone, tolerance = 1e-9): boolean {
  return (
    rect.x - rect.w / 2 >= zone.x0 - tolerance
    && rect.x + rect.w / 2 <= zone.x1 + tolerance
    && rect.y - rect.h / 2 >= zone.y0 - tolerance
    && rect.y + rect.h / 2 <= zone.y1 + tolerance
  )
}

/** How far outside the zone a rect reaches, per edge, in fractions (0 when inside). */
export function overflowOf(rect: Rect, zone: Zone): { left: number; right: number; top: number; bottom: number } {
  const round = (n: number) => Math.round(n * 1000) / 1000
  return {
    left: round(Math.max(0, zone.x0 - (rect.x - rect.w / 2))),
    right: round(Math.max(0, rect.x + rect.w / 2 - zone.x1)),
    top: round(Math.max(0, zone.y0 - (rect.y - rect.h / 2))),
    bottom: round(Math.max(0, rect.y + rect.h / 2 - zone.y1)),
  }
}

/** Distance from the nearest edge, in fractions of the frame — the placement measurement. */
export function marginsOf(rect: Rect, zone: Zone): { left: number; right: number; top: number; bottom: number } {
  const round = (n: number) => Math.round(n * 1000) / 1000
  return {
    left: round(rect.x - rect.w / 2 - zone.x0),
    right: round(zone.x1 - (rect.x + rect.w / 2)),
    top: round(rect.y - rect.h / 2 - zone.y0),
    bottom: round(zone.y1 - (rect.y + rect.h / 2)),
  }
}
