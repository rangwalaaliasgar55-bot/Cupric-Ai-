import { Suspense, lazy, useEffect, type ReactElement } from 'react'
import { AnimatePresence, MotionConfig, motion } from 'motion/react'
import { recoveryInfo } from '../lib/projectHistory'
import { AskPanel } from './AskPanel'
import { CommandPalette } from './CommandPalette'
import { Sidebar } from './Sidebar'
import { TopBar } from './TopBar'
import { Toasts } from '../components/Toasts'
const ArenaDesk = lazy(() => import('../screens/ArenaDesk').then((m) => ({ default: m.ArenaDesk })))
const Brief = lazy(() => import('../screens/Brief').then((m) => ({ default: m.Brief })))
const FootageDesk = lazy(() => import('../screens/FootageDesk').then((m) => ({ default: m.FootageDesk })))
import { HomeProject } from '../screens/HomeProject'
const Library = lazy(() => import('../screens/Library').then((m) => ({ default: m.Library })))
const Render = lazy(() => import('../screens/Render').then((m) => ({ default: m.Render })))
const ReviewRoom = lazy(() => import('../screens/ReviewRoom').then((m) => ({ default: m.ReviewRoom })))
const Timeline = lazy(() => import('../screens/Timeline').then((m) => ({ default: m.Timeline })))
const Studio = lazy(() => import('../screens/Studio').then((m) => ({ default: m.Studio })))
const Lab = lazy(() => import('../screens/Lab').then((m) => ({ default: m.Lab })))
const Autonomous = lazy(() => import('../screens/Autonomous').then((m) => ({ default: m.Autonomous })))
const MotionEngine = lazy(() => import('../screens/MotionEngine').then((m) => ({ default: m.MotionEngine })))
import { useProjectStore } from '../state/useProjectStore'
import { AppBackdrop } from './AppBackdrop'
import { BrainNotice } from './BrainNotice'
import { GlobalErrorCards, RouteErrorBoundary } from './ErrorBoundary'
import type { View } from '../types/project'
import { ThinkingStates } from '../components/loaders/ThinkingStates'
import { Onboarding, useOnboarding } from './Onboarding'

// Heavy screens (Studio, Lab, Motion, Library…) are split into their own
// chunks so first paint only pays for Home and the shell.
function ScreenFallback() {
  return (
    <div className="flex h-full items-center justify-center p-8 text-sm" role="status">
      <ThinkingStates states={['Opening', 'Loading tools']} />
    </div>
  )
}

const SCREENS = {
  home: <HomeProject />,
  auto: <Autonomous />,
  review: <ReviewRoom />,
  brief: <Brief />,
  arena: <ArenaDesk />,
  footage: <FootageDesk />,
  timeline: <Timeline />,
  studio: <Studio />,
  motion: <MotionEngine />,
  lab: <Lab />,
  render: <Render />,
  library: <Library />,
} as const satisfies Record<View, ReactElement>

export function AppLayout() {
  const view = useProjectStore((s) => s.view)
  // A view this build does not know (hand-edited or newer projects.json) must
  // never render an empty <main>. The store validates on load; this is the
  // belt to that pair of braces.
  const screen: View = view in SCREENS ? view : 'home'
  const pushToast = useProjectStore((s) => s.pushToast)
  const projectCount = useProjectStore((s) => s.projects.length)
  // First run only, and never for an upgrade that already has work (see
  // src/lib/onboarding.ts). `openOnboarding` reopens it from the palette.
  const onboarding = useOnboarding({ projectsExist: projectCount > 0 })
  useEffect(() => {
    const open = () => onboarding.open()
    window.addEventListener('cupric:onboarding', open)
    return () => window.removeEventListener('cupric:onboarding', open)
  }, [onboarding])

  // Crash recovery (2.26): say so when the last session ended badly or the
  // project file had to be restored from an autosave.
  useEffect(() => {
    void recoveryInfo().then((info) => {
      if (info.unreadable) {
        pushToast('error', 'Your projects file could not be read and no autosave was usable, so Cupric started empty. The damaged file was kept next to it as projects.corrupt-….json.', { sticky: true, id: 'state-unreadable' })
      } else if (info.recoveredFrom) {
        pushToast('info', 'Your project file was damaged, so Cupric restored the most recent autosave. Earlier versions are in Ask → Settings → Version history.', { sticky: true, id: 'state-recovered' })
      } else if (info.previousSessionCrashed) {
        pushToast('info', 'Cupric did not close cleanly last time. Your work was autosaved — if anything is missing, restore an earlier version from Ask → Settings → Version history.', { sticky: true, id: 'unclean-exit' })
      }
    })
  }, [pushToast])

  return (
    <MotionConfig reducedMotion="user">
    <div className="relative flex h-full overflow-hidden text-text">
      {/* The backdrop is a sibling behind the chrome, not a parent background,
          so panels can be translucent over it. */}
      <AppBackdrop />
      <Sidebar />
      <div className="relative z-10 flex min-w-0 flex-1 flex-col">
        <TopBar />
        {/* data-view: which screen is mounted (check:boot waits on it). */}
        <main className="min-h-0 flex-1 overflow-hidden" data-view={screen}>
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={screen}
              className="h-full"
              // Opacity only: screens are exactly viewport-height, so any
              // translate — even a 6px entrance that a busy screen (Apex)
              // never finishes — pushes their bottom edge out of the window.
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.16, ease: 'easeOut' }}
            >
              {/* One boundary per route, keyed by view: a screen that throws
                  shows a fallback card; the shell and other screens live on. */}
              <RouteErrorBoundary key={screen} route={screen}>
                <Suspense fallback={<ScreenFallback />}>{SCREENS[screen]}</Suspense>
              </RouteErrorBoundary>
            </motion.div>
          </AnimatePresence>
        </main>
      </div>
      <RouteErrorBoundary route="ask-panel">
        <AskPanel />
      </RouteErrorBoundary>
      <CommandPalette />
      <Toasts />
      <BrainNotice />
      <GlobalErrorCards />
      <Onboarding visible={onboarding.visible} onDismiss={onboarding.dismiss} />
    </div>
    </MotionConfig>
  )
}
