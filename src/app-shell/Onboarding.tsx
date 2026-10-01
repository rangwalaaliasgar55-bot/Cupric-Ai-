/**
 * First-run welcome: what this app is, in four cards, once.
 *
 * The copy and the rule for showing it live in `src/lib/onboarding.ts` (pure and
 * tested); this file is layout, keyboard handling and the dismissal.
 *
 * Behaviour worth knowing:
 *   - It is a real modal: focus is moved in, held inside (Tab cycles), Escape and
 *     the backdrop dismiss it, and it renders nothing once seen.
 *   - **Dismissing is never blocked.** No "you must read this" gate, no scroll
 *     trap: someone who already knows what an editor is should be able to leave
 *     in one key press.
 *   - Each card's button opens the screen it describes and records the dismissal,
 *     so the tour is also a way to start.
 *   - It is reachable again from the command palette / Settings ("Show the tour"),
 *     which is why `useOnboarding` is separate from the component.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { ArrowRight, Clapperboard, Film, Sparkles, Wand2, X } from 'lucide-react'
import { Button } from '../components/Button'
import {
  ONBOARDING_CONCEPTS,
  markOnboardingSeen,
  onboardingStorage,
  shouldShowOnboarding,
  type OnboardingConcept,
} from '../lib/onboarding'
import { useProjectStore } from '../state/useProjectStore'
import { EASE_SPRING } from '../lib/motion'

const ICONS: Record<string, typeof Clapperboard> = {
  studio: Clapperboard,
  autonomous: Wand2,
  arena: Sparkles,
  footage: Film,
}

/**
 * The shown/not-shown decision, with a way to force it open again.
 *
 * `open()` is what the command palette and the Settings button call; it does not
 * clear the "seen" flag, so a person who opens the tour deliberately does not get
 * it again on the next launch.
 */
export function useOnboarding({ projectsExist }: { projectsExist: boolean }) {
  const [visible, setVisible] = useState(false)
  useEffect(() => {
    const storage = onboardingStorage()
    if (shouldShowOnboarding(storage, { projectsExist })) {
      setVisible(true)
      return
    }
    // Somebody who already has projects never sees the dialog; the flag is still
    // recorded, so a fresh profile later does not resurface it.
    if (projectsExist) markOnboardingSeen(storage)
  }, [projectsExist])
  const dismiss = useCallback(() => {
    markOnboardingSeen(onboardingStorage())
    setVisible(false)
  }, [])
  return { visible, dismiss, open: useCallback(() => setVisible(true), []) }
}

export function Onboarding({ visible, onDismiss }: { visible: boolean; onDismiss: () => void }) {
  const setView = useProjectStore((s) => s.setView)
  const dialogRef = useRef<HTMLDivElement>(null)
  const primaryRef = useRef<HTMLButtonElement>(null)

  // Hold focus inside the dialog and let Escape close it. Both are what a modal
  // is expected to do; neither was possible before because there was no modal.
  useEffect(() => {
    if (!visible) return
    const previous = document.activeElement as HTMLElement | null
    primaryRef.current?.focus()
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onDismiss()
        return
      }
      if (event.key !== 'Tab') return
      const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      )
      if (!focusable || focusable.length === 0) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKeyDown, true)
    return () => {
      document.removeEventListener('keydown', onKeyDown, true)
      previous?.focus?.()
    }
  }, [visible, onDismiss])

  const go = (concept: OnboardingConcept) => {
    setView(concept.action)
    onDismiss()
  }

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          className="fixed inset-0 z-[80] flex items-center justify-center overflow-y-auto bg-bg/80 p-4 backdrop-blur-sm"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18, ease: EASE_SPRING }}
          onClick={onDismiss}
        >
          <motion.div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="onboarding-title"
            aria-describedby="onboarding-intro"
            data-onboarding
            className="relative w-full max-w-3xl rounded-2xl border border-line bg-panel shadow-[var(--shadow-3)]"
            initial={{ opacity: 0, y: 14, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.98 }}
            transition={{ duration: 0.22, ease: EASE_SPRING }}
            onClick={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              onClick={onDismiss}
              aria-label="Close the welcome tour"
              className="absolute right-3 top-3 rounded-md p-1.5 text-muted transition-colors duration-150 hover:bg-panel-alt hover:text-text"
            >
              <X size={15} />
            </button>

            <div className="border-b border-line px-6 py-5">
              <h2 id="onboarding-title" className="text-lg font-semibold tracking-[var(--tracking-display)]">
                Welcome to NewBrand
              </h2>
              <p id="onboarding-intro" className="mt-1.5 max-w-2xl text-sm leading-relaxed text-muted">
                Four screens do most of the work. You can skip this and come back to it any time — press
                {' '}<kbd className="rounded border border-line px-1.5 py-0.5 font-mono text-[11px]">Ctrl</kbd>
                {' '}+{' '}
                <kbd className="rounded border border-line px-1.5 py-0.5 font-mono text-[11px]">K</kbd>
                {' '}and choose “Quick tour of NewBrand”.
              </p>
            </div>

            <div className="grid gap-3 px-6 py-5 sm:grid-cols-2">
              {ONBOARDING_CONCEPTS.map((concept, index) => {
                const Icon = ICONS[concept.id] ?? Clapperboard
                return (
                  <div key={concept.id} className="flex flex-col rounded-xl border border-line bg-panel-alt/50 p-4" data-onboarding-card={concept.id}>
                    <div className="flex items-center gap-2.5">
                      <span className="flex h-8 w-8 items-center justify-center rounded-lg border border-line bg-panel text-accent-text" aria-hidden>
                        <Icon size={15} />
                      </span>
                      <span className="text-sm font-semibold">{concept.title}</span>
                    </div>
                    <p className="mt-2.5 text-sm leading-relaxed text-text/90">{concept.what}</p>
                    <p className="mt-1.5 text-xs leading-relaxed text-muted">{concept.when}</p>
                    <div className="mt-3 flex-1" />
                    <Button
                      ref={index === 0 ? primaryRef : undefined}
                      size="sm"
                      variant={index === 0 ? 'primary' : 'outline'}
                      className="self-start"
                      onClick={() => go(concept)}
                    >
                      {concept.actionLabel} <ArrowRight size={13} aria-hidden />
                    </Button>
                  </div>
                )
              })}
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-6 py-4">
              <p className="text-xs text-muted">Nothing here is required reading — the app works the same either way.</p>
              <Button size="sm" variant="outline" onClick={onDismiss}>
                Got it, do not show again
              </Button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
