import { GanttChart, Home, Film, FlaskConical, Library as LibraryIcon, MessagesSquare, Rocket, Scissors, Swords, Bot, Video, Sparkles } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { motion } from 'motion/react'
import type { View } from '../types/project'
import { useActiveProject, useProjectStore } from '../state/useProjectStore'
import { cx } from '../lib/utils'
import logoUrl from '../assets/logo.svg'

type NavItem = {
  view: View
  label: string
  icon: LucideIcon
  needProject?: boolean
  needLock?: boolean
}

const NAV: NavItem[] = [
  { view: 'auto', label: 'Auto', icon: Bot },
  { view: 'review', label: 'Review Room', icon: Video },
  { view: 'home', label: 'Home', icon: Home },
  { view: 'brief', label: 'Brief', icon: MessagesSquare, needProject: true },
  { view: 'arena', label: 'Arena Desk', icon: Swords, needProject: true, needLock: true },
  { view: 'footage', label: 'Footage Desk', icon: Film, needProject: true },
  { view: 'studio', label: 'Studio', icon: Scissors, needProject: true },
  { view: 'motion', label: 'Motion Engine', icon: Sparkles },
  { view: 'timeline', label: 'Timeline', icon: GanttChart, needProject: true },
  { view: 'lab', label: 'UI Lab', icon: FlaskConical },
  { view: 'render', label: 'Render', icon: Rocket, needProject: true },
  { view: 'library', label: 'Library', icon: LibraryIcon },
]

export function Sidebar() {
  const view = useProjectStore((s) => s.view)
  const setView = useProjectStore((s) => s.setView)
  const active = useActiveProject()

  const disabledReason = (item: NavItem): string | null => {
    if (item.needProject && !active) return ' — open a project'
    if (item.needLock && !active?.brief.lockedRundown) return ' — lock a rundown in Brief'
    return null
  }

  return (
    <aside className="relative z-10 flex h-full w-44 shrink-0 flex-col border-r border-line bg-panel/80 px-3 py-3 backdrop-blur-xl">
      <img src={logoUrl} alt="Cupric AI" className="mb-4 h-10 w-full" />

      <div className="cu-eyebrow mb-1.5 px-3">Workspace</div>
      <nav aria-label="Primary" className="flex flex-col gap-0.5">
        {NAV.map((item) => {
          const reason = disabledReason(item)
          const isActive = view === item.view
          const Icon = item.icon
          return (
            <div key={item.view} className="group relative flex w-full">
              <button
                type="button"
                aria-label={item.label}
                aria-current={isActive ? 'page' : undefined}
                disabled={!!reason}
                onClick={() => setView(item.view)}
                className={cx(
                  'relative flex h-10 w-full items-center gap-3 rounded-lg px-3 text-left text-sm font-medium transition-colors duration-150',
                  isActive
                    ? 'bg-panel-alt text-text shadow-[var(--shadow-sheen)]'
                    : reason
                      ? 'cursor-not-allowed text-muted/35'
                      : 'text-muted hover:bg-panel-alt hover:text-text',
                )}
              >
                {isActive && (
                  <motion.span
                    layoutId="rail-active"
                    transition={{ type: 'spring', stiffness: 500, damping: 38 }}
                    className="absolute -left-3 h-6 w-[3px] rounded-r-full bg-accent"
                  />
                )}
                <Icon size={18} className={cx('shrink-0', isActive && 'text-accent-text')} />
                <span className="truncate">{item.label}</span>
              </button>
              {reason && (
                <span className="pointer-events-none absolute left-full top-1/2 z-50 ml-2 -translate-y-1/2 whitespace-nowrap rounded-md border border-line bg-panel-alt px-2 py-1 text-xs text-muted opacity-0 transition-opacity duration-150 group-hover:opacity-100">
                  {reason.replace(/^ — /, '')}
                </span>
              )}
            </div>
          )
        })}
      </nav>

      <div className="mt-auto px-3 font-mono text-xs text-muted/50">v{__APP_VERSION__}</div>
    </aside>
  )
}
