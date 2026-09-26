import { AnimatePresence, motion } from 'motion/react'
import { AskPanel } from './AskPanel'
import { Sidebar } from './Sidebar'
import { TopBar } from './TopBar'
import { Toasts } from '../components/Toasts'
import { ArenaDesk } from '../screens/ArenaDesk'
import { Brief } from '../screens/Brief'
import { FootageDesk } from '../screens/FootageDesk'
import { HomeProject } from '../screens/HomeProject'
import { Library } from '../screens/Library'
import { Render } from '../screens/Render'
import { ReviewRoom } from '../screens/ReviewRoom'
import { Timeline } from '../screens/Timeline'
import { Studio } from '../screens/Studio'
import { Lab } from '../screens/Lab'
import { Autonomous } from '../screens/Autonomous'
import { MotionEngine } from '../screens/MotionEngine'
import { useProjectStore } from '../state/useProjectStore'
import { AppBackdrop } from './AppBackdrop'

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
} as const

export function AppLayout() {
  const view = useProjectStore((s) => s.view)

  return (
    <div className="relative flex h-full overflow-hidden text-text">
      {/* The backdrop is a sibling behind the chrome, not a parent background,
          so panels can be translucent over it. */}
      <AppBackdrop />
      <Sidebar />
      <div className="relative z-10 flex min-w-0 flex-1 flex-col">
        <TopBar />
        <main className="min-h-0 flex-1 overflow-hidden">
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={view}
              className="h-full"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.16, ease: 'easeOut' }}
            >
              {SCREENS[view]}
            </motion.div>
          </AnimatePresence>
        </main>
      </div>
      <AskPanel />
      <Toasts />
    </div>
  )
}
