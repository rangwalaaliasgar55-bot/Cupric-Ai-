/**
 * Animated cursor — motion model + "is a cursor needed here?" rules.
 *
 * Motion (pure function of clip progress, no clock/randomness):
 *   glide from `from` to the target on a gentle arc with ease-in-out and a
 *   short deceleration ("aim") before each click; on click the pointer
 *   presses (scale 0.82) and a ripple ring expands and fades; the target
 *   clip (if linked) presses in at the same moment — the component "reacts".
 *
 * Need rules: a cursor only helps where the viewer must understand an
 * interaction (buttons, forms, toggles, menus, tabs, sliders, drag areas,
 * hover cards). On backgrounds, text effects, counters, loaders, marquees or
 * charts it is visual noise, so the agent leaves it out — and says why.
 */
import type { StudioCursorClip } from '../../types/project'

const clamp01 = (v: number) => Math.min(1, Math.max(0, v))
const easeOut = (t: number) => 1 - (1 - t) ** 3

export const CLICK_PRESS_SEC = 0.14
export const RIPPLE_SEC = 0.5
const REBOUND_SEC = 0.2

export type CursorFrame = {
  x: number
  y: number
  /** Pointer scale (press < 1, rebound slightly > 1). */
  press: number
  /** Ripple rings currently visible: radius progress 0–1 and alpha. */
  ripples: Array<{ x: number; y: number; p: number; alpha: number }>
  /** 0–1 press depth to apply to the linked target (negative = hover lift). */
  targetPress: number
  alpha: number
  /** 0–1 click flash intensity (bright bloom under the tip). */
  flash: number
  /** Distance (normalised) to the stop being approached — "auto" style swaps arrow → hand when close. */
  toTarget: number
}

type CursorInput = Pick<StudioCursorClip, 'x' | 'y' | 'fromX' | 'fromY' | 'clicks' | 'action' | 'toX' | 'toY' | 'durationSec'> & { stops?: Array<{ x: number; y: number }> }

/** Human "aim" easing: quick launch, long deceleration into the target (cubic-bezier .3,0,.15,1). */
function aimEase(t: number): number {
  const x1 = 0.3, x2 = 0.15, y1 = 0, y2 = 1
  const bx = (u: number) => 3 * u * (1 - u) ** 2 * x1 + 3 * u * u * (1 - u) * x2 + u ** 3
  const by = (u: number) => 3 * u * (1 - u) ** 2 * y1 + 3 * u * u * (1 - u) * y2 + u ** 3
  let u = t
  for (let i = 0; i < 6; i++) {
    const d = (bx(u + 1e-4) - bx(u)) / 1e-4 || 1
    u = clamp01(u - (bx(u) - t) / d)
  }
  return by(u)
}

type Seg = { depart: number; arrive: number; click: number; from: { x: number; y: number }; to: { x: number; y: number }; k: number }

function segments(c: CursorInput): { segs: Seg[]; clicks: number[] } {
  const dur = Math.max(0.1, c.durationSec)
  const clicks = (c.clicks?.length ? c.clicks : [0.6]).map((f) => clamp01(f) * dur).sort((a, b) => a - b)
  const stops = c.stops?.length ? c.stops : [{ x: c.x, y: c.y }]
  const segs: Seg[] = []
  let prev = { x: c.fromX, y: c.fromY }
  let prevEnd = 0
  clicks.forEach((click, k) => {
    const to = stops[Math.min(k, stops.length - 1)]
    const gap = click - prevEnd
    const aim = Math.min(0.24, Math.max(0.06, gap * 0.3))
    segs.push({ depart: prevEnd, arrive: Math.max(prevEnd + 0.05, click - aim), click, from: prev, to, k })
    prev = to
    prevEnd = click + CLICK_PRESS_SEC
  })
  return { segs, clicks }
}

function travel(seg: Seg, t: number): { x: number; y: number } {
  const dx = seg.to.x - seg.from.x, dy = seg.to.y - seg.from.y
  const len = Math.hypot(dx, dy)
  if (len < 1e-4) return { ...seg.to }
  const ux = dx / len, uy = dy / len
  // Overshoot a touch past the target, then spring back (settle) before the click.
  const ov = Math.min(0.014, len * 0.05)
  const end = { x: seg.to.x + ux * ov, y: seg.to.y + uy * ov }
  if (t <= seg.arrive) {
    const p = aimEase(clamp01((t - seg.depart) / Math.max(0.05, seg.arrive - seg.depart)))
    const side = seg.k % 2 === 0 ? 1 : -1 // alternate arc sides on multi-stop journeys
    const arc = len * 0.16 * side
    const c1 = { x: seg.from.x + dx * 0.28 - uy * arc, y: seg.from.y + dy * 0.28 + ux * arc }
    const c2 = { x: end.x - dx * 0.22 - uy * arc * 0.45, y: end.y - dy * 0.22 + ux * arc * 0.45 }
    const q = 1 - p
    return {
      x: q ** 3 * seg.from.x + 3 * q * q * p * c1.x + 3 * q * p * p * c2.x + p ** 3 * end.x,
      y: q ** 3 * seg.from.y + 3 * q * q * p * c1.y + 3 * q * p * p * c2.y + p ** 3 * end.y,
    }
  }
  // Damped spring from the overshoot back onto the target, exactly on it at the click.
  const tau = t - seg.arrive
  const land = clamp01((seg.click - t) / 0.06)
  const k = ov * Math.exp(-16 * tau) * Math.cos(tau * 26) * land
  // Tiny deterministic hand drift while aiming (zero at the click).
  const drift = 0.0012 * land * clamp01(tau / 0.1)
  return { x: seg.to.x + ux * k + Math.sin(t * 7.3 + seg.k) * drift, y: seg.to.y + uy * k + Math.cos(t * 5.9 + seg.k * 2) * drift }
}

/** Cursor state at clip-local time `local` (seconds). Pure: preview = export. */
export function cursorAt(c: CursorInput, local: number): CursorFrame {
  const dur = Math.max(0.1, c.durationSec)
  const { segs, clicks } = segments(c)
  const last = segs[segs.length - 1]
  const active = segs.find((s) => local <= s.click + CLICK_PRESS_SEC) ?? last
  let pos = travel(active, Math.min(local, active.click))
  if (local > last.click && c.action === 'drag' && c.toX !== undefined && c.toY !== undefined) {
    const p = aimEase(clamp01((local - last.click - 0.08) / Math.max(0.2, dur - last.click - 0.35)))
    pos = { x: last.to.x + (c.toX - last.to.x) * p, y: last.to.y + (c.toY - last.to.y) * p }
  } else if (local > last.click) pos = { ...last.to }
  let press = 1
  let targetPress = 0
  let flash = 0
  const ripples: CursorFrame['ripples'] = []
  if (c.action !== 'hover') {
    const moments = c.action === 'double-click' ? segs.flatMap((s) => [{ t: s.click, at: s.to }, { t: s.click + 0.18, at: s.to }]) : segs.map((s) => ({ t: s.click, at: s.to }))
    for (const m of moments) {
      const d = local - m.t
      if (c.action === 'drag' && d >= 0) { press = 0.84; targetPress = 0.6; continue } // held while dragging
      if (d >= -CLICK_PRESS_SEC / 2 && d <= CLICK_PRESS_SEC) {
        const kk = d < 0 ? 1 - -d / (CLICK_PRESS_SEC / 2) : 1 - d / CLICK_PRESS_SEC
        press = Math.min(press, 1 - 0.2 * clamp01(kk))
        targetPress = Math.max(targetPress, clamp01(kk))
      } else if (d > CLICK_PRESS_SEC && d <= CLICK_PRESS_SEC + REBOUND_SEC) {
        press = Math.max(press, 1 + 0.06 * Math.sin(Math.PI * ((d - CLICK_PRESS_SEC) / REBOUND_SEC)))
      }
      if (d >= 0 && d <= 0.22) flash = Math.max(flash, 1 - d / 0.22)
      if (d >= 0 && d <= RIPPLE_SEC) ripples.push({ x: m.at.x, y: m.at.y, p: easeOut(d / RIPPLE_SEC), alpha: 1 - d / RIPPLE_SEC })
      const d2 = d - 0.08 // second, softer ring
      if (d2 >= 0 && d2 <= RIPPLE_SEC) ripples.push({ x: m.at.x, y: m.at.y, p: easeOut(d2 / RIPPLE_SEC) * 0.7, alpha: (1 - d2 / RIPPLE_SEC) * 0.5 })
    }
  } else if (local > segs[0].arrive) {
    targetPress = -clamp01((local - segs[0].arrive) / 0.2)
  }
  const alpha = clamp01(local / 0.12) * clamp01((dur - local) / 0.18)
  const toTarget = Math.hypot(pos.x - active.to.x, pos.y - active.to.y)
  void clicks
  return { x: pos.x, y: pos.y, press, ripples, targetPress, alpha, flash, toTarget }
}

/* ───────────────────────────── need rules ───────────────────────────── */

export type CursorVerdict = { needed: boolean; action: StudioCursorClip['action']; reason: string }

const NEEDS: Array<{ re: RegExp; action: StudioCursorClip['action']; why: string }> = [
  { re: /\b(button|cta|buy|subscribe|sign ?up|get started|add to cart|checkout|follow)\b/, action: 'click', why: 'a button reads as clickable only when something clicks it' },
  { re: /\b(toggle|switch|checkbox|radio|like|heart|star rating|favorite|favourite|bookmark)\b/, action: 'click', why: 'the state change needs a visible cause' },
  { re: /\b(input|form|search|field|text ?box|login|email)\b/, action: 'click', why: 'show focus before typing' },
  { re: /\b(menu|dropdown|select|tabs?|accordion|navbar|nav|context menu|popover|dialog|modal)\b/, action: 'click', why: 'menus open on a click' },
  { re: /\b(slider|range|drag|sortable|kanban|reorder|scrubber|carousel)\b/, action: 'drag', why: 'dragging explains the motion' },
  { re: /\b(demo|walkthrough|tutorial|onboarding|how[- ]to|screen ?recording|app ui|dashboard|website|web ?app|browser)\b/, action: 'click', why: 'a walkthrough is followed by watching the pointer' },
  { re: /\b(hover|tooltip|card tilt|tilt card|magnetic|spotlight card|preview card)\b/, action: 'hover', why: 'hover effects need a pointer to trigger them' },
]
const NEVER = /\b(background|gradient|aurora|mesh|particles?|noise|grain|text effect|split text|typewriter|counter|count ?up|number|stat|marquee|ticker|loader|spinner|progress|chart|graph|logo|icon|caption|subtitle|title|headline|transition|glitch)\b/

/** Should a cursor be added to this component/resource? Always explains itself. */
export function cursorNeeded(item: { name?: string; description?: string; category?: string | null; tags?: string[] }): CursorVerdict {
  const hay = `${item.name ?? ''} ${item.category ?? ''} ${(item.tags ?? []).join(' ')} ${item.description ?? ''}`.toLowerCase()
  const need = NEEDS.find((n) => n.re.test(hay))
  // Interactive words in the NAME/category win over incidental "number" etc. in descriptions.
  const head = `${item.name ?? ''} ${item.category ?? ''}`.toLowerCase()
  if (need && (need.re.test(head) || !NEVER.test(head))) return { needed: true, action: need.action, reason: `Cursor ${need.action}: ${need.why}.` }
  if (NEVER.test(hay)) return { needed: false, action: 'click', reason: 'No cursor: this is a visual effect, not an interaction — a pointer would be noise.' }
  return { needed: false, action: 'click', reason: 'No cursor: nothing here is interactive.' }
}

/**
 * Default cursor clip for a target: approaches from the lower right (where
 * a right-handed user's pointer rests), clicks at 55% of the clip.
 */
export function cursorForTarget(target: { id: string; x: number; y: number; startSec: number; durationSec: number; track: number; name?: string }, action: StudioCursorClip['action'], id: string): StudioCursorClip {
  const dur = Math.min(Math.max(1.6, target.durationSec), 4)
  return {
    id, kind: 'cursor', name: action === 'drag' ? 'Cursor drag' : action === 'hover' ? 'Cursor hover' : 'Cursor click',
    style: /\b(input|field|search|email|text ?box|textarea)\b/i.test(target.name ?? '') ? 'ibeam' : 'auto', action, trail: true,
    x: target.x, y: target.y,
    fromX: Math.min(0.95, target.x + 0.22), fromY: Math.min(0.95, target.y + 0.25),
    toX: action === 'drag' ? Math.max(0.05, target.x - 0.2) : undefined, toY: action === 'drag' ? target.y : undefined,
    clicks: action === 'hover' ? [] : [0.55],
    size: 1, color: '#FFFFFF', rippleColor: '#C8F542',
    targetClipId: target.id,
    track: target.track + 1, startSec: target.startSec + Math.min(0.3, target.durationSec * 0.1), durationSec: dur,
    transitionIn: 'none', transitionOut: 'none', opacity: 1,
  }
}
