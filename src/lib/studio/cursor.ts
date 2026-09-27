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
const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2)
const easeOut = (t: number) => 1 - (1 - t) ** 3

export const CLICK_PRESS_SEC = 0.14
export const RIPPLE_SEC = 0.45

export type CursorFrame = {
  x: number
  y: number
  /** Pointer scale (press = < 1). */
  press: number
  /** Ripple rings currently visible: radius progress 0–1 and alpha. */
  ripples: Array<{ x: number; y: number; p: number; alpha: number }>
  /** 0–1 press depth to apply to the linked target. */
  targetPress: number
  alpha: number
}

/** Cursor state at clip-local time `local` (seconds). */
export function cursorAt(c: Pick<StudioCursorClip, 'x' | 'y' | 'fromX' | 'fromY' | 'clicks' | 'action' | 'toX' | 'toY' | 'durationSec'>, local: number): CursorFrame {
  const dur = Math.max(0.1, c.durationSec)
  const clicks = (c.clicks?.length ? c.clicks : [0.6]).map((f) => clamp01(f) * dur).sort((a, b) => a - b)
  const first = clicks[0]
  // Arrive a little before the first click, so the pointer "aims" then clicks.
  const arrive = Math.max(0.05, first - Math.min(0.25, first * 0.3))
  let x: number, y: number
  if (local <= arrive) {
    const p = easeInOut(clamp01(local / arrive))
    // Quadratic arc: control point lifted perpendicular to the travel.
    const mx = (c.fromX + c.x) / 2, my = (c.fromY + c.y) / 2
    const dx = c.x - c.fromX, dy = c.y - c.fromY
    const cxp = mx - dy * 0.18, cyp = my + dx * 0.18
    const u = 1 - p
    x = u * u * c.fromX + 2 * u * p * cxp + p * p * c.x
    y = u * u * c.fromY + 2 * u * p * cyp + p * p * c.y
  } else if (c.action === 'drag' && c.toX !== undefined && c.toY !== undefined && local > first) {
    const p = easeInOut(clamp01((local - first) / Math.max(0.2, dur - first - 0.3)))
    x = c.x + (c.toX - c.x) * p
    y = c.y + (c.toY - c.y) * p
  } else {
    x = c.x
    y = c.y
  }
  let press = 1
  let targetPress = 0
  const ripples: CursorFrame['ripples'] = []
  if (c.action !== 'hover') {
    const moments = c.action === 'double-click' ? clicks.flatMap((t) => [t, t + 0.18]) : clicks
    for (const t of moments) {
      const d = local - t
      if (c.action === 'drag' && d >= 0) { press = 0.82; targetPress = 0.6; continue } // held down while dragging
      if (d >= -CLICK_PRESS_SEC / 2 && d <= CLICK_PRESS_SEC) {
        const k = d < 0 ? 1 - (-d / (CLICK_PRESS_SEC / 2)) : 1 - d / CLICK_PRESS_SEC
        press = Math.min(press, 1 - 0.18 * clamp01(k))
        targetPress = Math.max(targetPress, clamp01(k))
      }
      if (d >= 0 && d <= RIPPLE_SEC) ripples.push({ x: c.x, y: c.y, p: easeOut(d / RIPPLE_SEC), alpha: 1 - d / RIPPLE_SEC })
    }
  } else if (local > arrive) {
    targetPress = -clamp01((local - arrive) / 0.2) // negative = hover lift
  }
  const alpha = clamp01(local / 0.12) * clamp01((dur - local) / 0.18)
  return { x, y, press, ripples, targetPress, alpha }
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
export function cursorForTarget(target: { id: string; x: number; y: number; startSec: number; durationSec: number; track: number }, action: StudioCursorClip['action'], id: string): StudioCursorClip {
  const dur = Math.min(Math.max(1.6, target.durationSec), 4)
  return {
    id, kind: 'cursor', name: action === 'drag' ? 'Cursor drag' : action === 'hover' ? 'Cursor hover' : 'Cursor click',
    style: 'arrow', action,
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
