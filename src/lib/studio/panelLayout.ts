/**
 * JOB 9 — how much room the stage gets.
 *
 * The Studio had a fixed 320px inspector, a 380px pro panel and a 360px
 * components panel, none of which could be collapsed. On a 1120px laptop that
 * left a ~270px preview inside a huge empty stage: the thing you are actually
 * editing was the smallest element on screen.
 *
 * Pure layout arithmetic, so the gate can prove the stage keeps its share at
 * real window widths without a browser.
 */

export const INSPECTOR_MIN = 240
export const INSPECTOR_MAX = 560
export const INSPECTOR_DEFAULT = 320
/** Collapsed: just wide enough for the expand button and the section icons. */
export const RAIL_WIDTH = 44

const WIDTH_KEY = 'cupric.studio.inspectorWidth'
const COLLAPSED_KEY = 'cupric.studio.inspectorCollapsed'

export function clampInspectorWidth(px: number): number {
  if (!Number.isFinite(px)) return INSPECTOR_DEFAULT
  return Math.min(INSPECTOR_MAX, Math.max(INSPECTOR_MIN, Math.round(px)))
}

/** Remembered across sessions — resizing a panel every time you open the app is not a feature. */
export function readInspectorWidth(): number {
  try {
    const raw = localStorage.getItem(WIDTH_KEY)
    return raw ? clampInspectorWidth(Number(raw)) : INSPECTOR_DEFAULT
  } catch { return INSPECTOR_DEFAULT }
}

export function writeInspectorWidth(px: number) {
  try { localStorage.setItem(WIDTH_KEY, String(clampInspectorWidth(px))) } catch { /* private mode: session only */ }
}

export function readInspectorCollapsed(): boolean {
  try { return localStorage.getItem(COLLAPSED_KEY) === '1' } catch { return false }
}

export function writeInspectorCollapsed(collapsed: boolean) {
  try { localStorage.setItem(COLLAPSED_KEY, collapsed ? '1' : '0') } catch { /* session only */ }
}

export type PanelState = {
  windowWidth: number
  /** The left resources/nav rail, which is always present. */
  navWidth: number
  inspectorWidth: number
  inspectorCollapsed: boolean
  componentsOpen: boolean
  proOpen: boolean
}

/**
 * What is left for the stage, in pixels and as a fraction of the window.
 *
 * The acceptance criterion — stage ≥ 60% of the window when the inspector is
 * collapsed — is checked against this at 1120px and 1920px.
 */
export function stageWidth(state: PanelState, componentsWidth = 360, proWidth = 380): { px: number; fraction: number } {
  const inspector = state.inspectorCollapsed ? RAIL_WIDTH : clampInspectorWidth(state.inspectorWidth)
  const used = state.navWidth + inspector + (state.componentsOpen ? componentsWidth : 0) + (state.proOpen ? proWidth : 0)
  const px = Math.max(0, state.windowWidth - used)
  return { px, fraction: state.windowWidth > 0 ? px / state.windowWidth : 0 }
}

/**
 * z-lanes, in one place.
 *
 * Panels drifted between z-10, z-20, z-30, z-40, z-50, z-[70] and z-[90] with
 * no rule, which is why the background-jobs and review panels drew over the
 * toolbar. The order is fixed here and nowhere else: chrome sits over the
 * canvas, toasts over chrome, modals over everything.
 */
export const Z = {
  /** The stage and anything painted into it. */
  canvas: 0,
  /** Toolbars, rails, inspectors — the app's own furniture. */
  chrome: 20,
  /** Floating panels launched from the chrome (background jobs, review). */
  panel: 40,
  /** Transient messages. Above every panel, below anything modal. */
  toast: 70,
  /** Anything that takes over the screen and must be dismissed. */
  modal: 90,
  /**
   * The crash card only. It has to outrank a modal, because the modal may be
   * the thing that just threw — and a crash report you cannot see is useless.
   */
  crash: 1000,
} as const

export type ZLane = keyof typeof Z
