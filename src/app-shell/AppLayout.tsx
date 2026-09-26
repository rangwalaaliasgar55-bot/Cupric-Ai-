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
import { Timeline } from '../screens/Timeline'
import { Autonomous } from '../screens/Autonomous'
import { useProjectStore } from '../state/useProjectStore'

const SCREENS = {
  home: <HomeProject />,
  auto: <Autonomous />,
  brief: <Brief />,
  arena: <ArenaDesk />,
  footage: <FootageDesk />,
  timeline: <Timeline />,
  render: <Render />,
  library: <Library />,
} as const

export function AppLayout() {
  const view = useProjectStore((s) => s.view)

  return (
    <div className="flex h-full overflow-hidden bg-bg text-text">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
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
