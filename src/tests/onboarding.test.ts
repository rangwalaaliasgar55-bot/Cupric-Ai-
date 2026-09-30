/**
 * The first-run rule.
 *
 * Onboarding is the kind of feature that quietly annoys people when it is
 * wrong: shown twice, shown to someone who already has ten projects, or — worse
 * — impossible to get back to. These tests pin the rule itself, which is why it
 * lives in `src/lib/onboarding.ts` as a pure function over a storage-like object
 * rather than inside the dialog component.
 */
import { describe, expect, it } from 'vitest'
import {
  ONBOARDING_CONCEPTS,
  ONBOARDING_KEY,
  markOnboardingSeen,
  onboardingStorage,
  shouldShowOnboarding,
} from '../lib/onboarding'

/** A stand-in for localStorage that behaves like the real one, including throwing. */
function memoryStorage(seed: Record<string, string> = {}, { throws = false } = {}) {
  const map = new Map(Object.entries(seed))
  return {
    getItem: (key: string) => {
      if (throws) throw new Error('storage disabled')
      return map.get(key) ?? null
    },
    setItem: (key: string, value: string) => {
      if (throws) throw new Error('storage disabled')
      map.set(key, value)
    },
    get size() {
      return map.size
    },
    raw: map,
  }
}

describe('shouldShowOnboarding', () => {
  it('shows on a genuinely fresh install', () => {
    expect(shouldShowOnboarding(memoryStorage(), { projectsExist: false })).toBe(true)
  })

  it('stays away once it has been seen', () => {
    expect(shouldShowOnboarding(memoryStorage({ [ONBOARDING_KEY]: '2026-09-29T10:00:00.000Z' }), { projectsExist: false })).toBe(false)
  })

  it('stays away for someone who already has projects, even with an empty store', () => {
    // The upgrade case: the flag cannot exist yet, but the person is clearly not
    // new. Showing a welcome tour over an existing project is the bug this
    // prevents.
    expect(shouldShowOnboarding(memoryStorage(), { projectsExist: true })).toBe(false)
  })

  it('treats a missing or unreadable store as "already seen" rather than nagging', () => {
    // If storage is unavailable the choice cannot be remembered, so the wrong
    // answer is to show the modal on every launch.
    expect(shouldShowOnboarding(null, { projectsExist: false })).toBe(false)
    expect(shouldShowOnboarding(memoryStorage({}, { throws: true }), { projectsExist: false })).toBe(false)
  })

  it('ignores an empty stored value (a cleared profile)', () => {
    expect(shouldShowOnboarding(memoryStorage({ [ONBOARDING_KEY]: '' }), { projectsExist: false })).toBe(true)
  })
})

describe('markOnboardingSeen', () => {
  it('records a timestamp, and is what makes the next call return false', () => {
    const storage = memoryStorage()
    expect(shouldShowOnboarding(storage, { projectsExist: false })).toBe(true)
    markOnboardingSeen(storage)
    expect(shouldShowOnboarding(storage, { projectsExist: false })).toBe(false)
    expect(storage.raw.get(ONBOARDING_KEY)).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })

  it('never throws when storage refuses to write', () => {
    expect(() => markOnboardingSeen(memoryStorage({}, { throws: true }))).not.toThrow()
    expect(() => markOnboardingSeen(null)).not.toThrow()
  })
})

describe('onboardingStorage', () => {
  // A test double for the *platform* API, not for app behaviour: it stores what
  // it is given, and the assertions below are about which global the adapter
  // chooses and how it behaves when the global misbehaves.
  function withGlobalLocalStorage<T>(value: unknown, run: () => T): T {
    const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
    Object.defineProperty(globalThis, 'localStorage', { value, configurable: true, writable: true })
    try {
      return run()
    } finally {
      if (original) Object.defineProperty(globalThis, 'localStorage', original)
      else delete (globalThis as Record<string, unknown>).localStorage
    }
  }

  it('uses the real global when there is one', () => {
    const store = memoryStorage()
    withGlobalLocalStorage(store, () => expect(onboardingStorage()).toBe(store))
  })

  it('returns null, rather than throwing, where there is no storage at all', () => {
    // Node without a DOM shim, or a locked-down renderer.
    withGlobalLocalStorage(undefined, () => expect(onboardingStorage()).toBeNull())
  })

  it('returns null when storage exists but refuses reads', () => {
    withGlobalLocalStorage(memoryStorage({}, { throws: true }), () => expect(onboardingStorage()).toBeNull())
  })

  it('the null it returns keeps the rule quiet', () => {
    withGlobalLocalStorage(undefined, () => expect(shouldShowOnboarding(onboardingStorage(), { projectsExist: false })).toBe(false))
  })
})

describe('ONBOARDING_CONCEPTS', () => {
  it('covers the four things Phase 3 asked to explain', () => {
    expect(ONBOARDING_CONCEPTS.map((c) => c.id)).toEqual(['studio', 'autonomous', 'arena', 'footage'])
  })

  it('every card explains what the screen is for and where it goes', () => {
    for (const concept of ONBOARDING_CONCEPTS) {
      expect(concept.title.length).toBeGreaterThan(2)
      expect(concept.what.length).toBeGreaterThan(40)
      expect(concept.when.length).toBeGreaterThan(40)
      expect(concept.action).toMatch(/^(studio|auto|arena|footage)$/)
      expect(concept.actionLabel.length).toBeGreaterThan(2)
    }
  })

  it('sends each card to a screen that exists in the shell', async () => {
    // A tour whose buttons navigate nowhere is worse than no tour. The view list
    // is the one the schema validates saved state against, so it cannot drift
    // from the app without the schema drifting too.
    const { VIEWS } = await import('../state/projectSchema')
    const known = new Set<string>(VIEWS)
    for (const concept of ONBOARDING_CONCEPTS) expect(known).toContain(concept.action)
  })

  it('does not promise features in words the app never uses', () => {
    const text = ONBOARDING_CONCEPTS.map((c) => `${c.title} ${c.what} ${c.when}`).join(' ').toLowerCase()
    expect(text).toContain('timeline')
    expect(text).toContain('video')
    expect(text).not.toMatch(/\bcoming soon\b|\bsoon\b|\bbeta\b/)
  })
})
