/**
 * The four screens a new person needs to understand, in plain language.
 *
 * Phase 3 asked for a first-run explanation of Studio, Autonomous Mode, Arena
 * and Footage Desk. It is a pure data module on purpose: the copy, the order and
 * the "have I seen this" rule are all testable here, and the component that
 * renders it (`src/app-shell/Onboarding.tsx`) holds nothing but layout.
 *
 * Two rules learned from the rest of this codebase:
 *   - **Say what the thing is for, not what it is called.** "Autonomous Mode" is
 *     a name; "paste a brief and Cupric edits the video for you" is the feature.
 *   - **Every card goes somewhere.** The `action` view is where the button lands,
 *     so a card can never be a dead end.
 */
import type { View } from '../types/project'

export type OnboardingConcept = {
  id: string
  /** The name as it appears in the sidebar. */
  title: string
  /** One sentence: what it is for. */
  what: string
  /** One sentence: when to reach for it. */
  when: string
  /** The sidebar view its button opens. */
  action: View
  /** Button copy, phrased as an offer rather than a command. */
  actionLabel: string
}

/**
 * Order matters: this is the order somebody needs them in, not the order they
 * appear in the sidebar. Studio first because it is where the work lands,
 * Autonomous second because it is the shortcut most people want, then the two
 * desks that feed materials into both.
 */
export const ONBOARDING_CONCEPTS: OnboardingConcept[] = [
  {
    id: 'studio',
    title: 'Studio',
    what: 'The editor: clips on a timeline, captions, text, motion components, and the export button.',
    when: 'Whenever you want to change something by hand — trim a clip, move a caption, swap a shot.',
    action: 'studio',
    actionLabel: 'Open the Studio',
  },
  {
    id: 'autonomous',
    title: 'Autonomous Mode',
    what: 'Paste a brief and Cupric plans the edit, picks the shots and renders a first cut on its own.',
    when: 'When you want a rough cut to react to instead of building one from nothing.',
    action: 'auto',
    actionLabel: 'Try a brief',
  },
  {
    id: 'arena',
    title: 'Arena Desk',
    what: 'Where generated scenes land — animations, HTML pages and ZIP packages you can preview, keep, or import as editable clips.',
    when: 'When you have something generated elsewhere (or by Cupric) and want it in the video.',
    action: 'arena',
    actionLabel: 'Open Arena Desk',
  },
  {
    id: 'footage',
    title: 'Footage Desk',
    what: 'Your raw material: import video and images, look at what is in them, and send the good parts to the timeline.',
    when: 'When you are starting from files on disk rather than from a script.',
    action: 'footage',
    actionLabel: 'Open Footage Desk',
  },
]

/** Where "have they seen it" lives. One key, so it is easy to reset by hand. */
export const ONBOARDING_KEY = 'cupric.onboarding.seen'

/** Minimal storage surface, so the rule below is testable without a browser. */
export type OnboardingStorage = {
  getItem: (key: string) => string | null
  setItem: (key: string, value: string) => void
}

/** Read a storage object without throwing (private mode, disabled cookies). */
export function onboardingStorage(): OnboardingStorage | null {
  try {
    if (typeof localStorage === 'undefined') return null
    localStorage.getItem(ONBOARDING_KEY)
    return localStorage
  } catch {
    return null
  }
}

/**
 * Should the welcome card be shown?
 *
 * Yes on a fresh install (nothing stored), yes again if the stored value is not
 * a value we write, and **no** once it has been seen — including when storage is
 * unavailable, because a modal that reappears on every launch with no way to
 * make it stop is worse than one that never appears.
 *
 * `projectsExist` exists for the upgrade case: somebody who already has work
 * does not need the "what is this app" tour, so they get the dismissal recorded
 * silently rather than a dialog.
 */
export function shouldShowOnboarding(storage: OnboardingStorage | null, { projectsExist = false } = {}): boolean {
  if (!storage) return false
  let stored: string | null = null
  try {
    stored = storage.getItem(ONBOARDING_KEY)
  } catch (error) {
    // Reading threw (private mode, a storage shim that refuses). We cannot tell
    // whether it was seen, and the wrong answer is a dialog on every launch, so
    // this errs towards silence. Nothing to log: it is the environment, not a
    // failure of the app, and `onboardingStorage()` reports the same condition.
    return false
  }
  // Any value we wrote counts — the flag carries a date (see below), so this is
  // "somebody dismissed this", not "the string equals 1".
  if (typeof stored === 'string' && stored.length > 0) return false
  if (projectsExist) return false
  return true
}

/**
 * Record that it has been seen, with the date.
 *
 * The date is for the diagnostic report: "the tour was shown on 2026-09-29" is
 * a fact, where a bare `1` is not. Returns false when storage refused the write
 * — the caller does not need to do anything about that, but it is not reported
 * as success.
 */
export function markOnboardingSeen(storage: OnboardingStorage | null): boolean {
  if (!storage) return false
  try {
    storage.setItem(ONBOARDING_KEY, new Date().toISOString())
    return storage.getItem(ONBOARDING_KEY) !== null
  } catch {
    return false
  }
}
