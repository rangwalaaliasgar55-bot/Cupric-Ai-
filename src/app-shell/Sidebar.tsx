import { GanttChart, Home, Film, FlaskConical, Library as LibraryIcon, MessagesSquare, Rocket, Scissors, Swords, Bot, Video, Sparkles } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { motion } from 'motion/react'
import type { View } from '../types/project'
import { useActiveProject, useProjectStore } from '../state/useProjectStore'
import { cx } from '../lib/utils'
import { EASE_SPRING } from '../lib/motion'
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
  const createProject = useProjectStore((s) => s.createProject)

  const disabledReason = (item: NavItem): string | null => {
    if (item.needProject && !active) return ' — open a project'
    if (item.needLock && !active?.brief.lockedRundown) return ' — lock a rundown in Brief'
    return null
  }

  return (
    <aside className="relative z-10 flex h-full w-44 shrink-0 flex-col border-r border-line bg-panel/80 px-3 py-3 backdrop-blur-xl">
      <img src={logoUrl} alt="NewBrand" className="mb-4 h-10 w-full" />

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
                // `data-nav` is the stable handle the Windows E2E suite clicks
                // (tests/e2e/*.spec.ts). Labels change with the copy; this does
                // not, and it is inert for users.
                data-nav={item.view}
                aria-label={item.label}
                aria-current={isActive ? 'page' : undefined}
                disabled={!!reason}
                aria-describedby={reason ? 'nav-lock-reason' : undefined}
                title={reason ? reason.replace(/^ — /, '') : undefined}
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
                    transition={{ duration: 0.2, ease: EASE_SPRING }}
                    className="absolute -left-3 h-6 w-[3px] rounded-r-full bg-accent"
                  />
                )}
                <Icon size={18} className={cx('shrink-0', isActive && 'text-accent-text')} />
                <span className="truncate">{item.label}</span>
              </button>
            </div>
          )
        })}
      </nav>
      {/* Inline (not tooltip-only) reason for the locked desks — DESIGN §2. */}
      {!active ? (
        <div className="mt-2 space-y-1.5 px-3">
          <p id="nav-lock-reason" className="text-xs text-muted">Project desks unlock when a project is open.</p>
          <button type="button" onClick={() => createProject()} className="w-full rounded-lg bg-accent px-2 py-1.5 text-xs font-medium text-accent-ink active:scale-[0.96]">New project</button>
        </div>
      ) : !active.brief.lockedRundown ? (
        <p id="nav-lock-reason" className="mt-2 px-3 text-xs text-muted">Arena Desk unlocks after you lock a rundown in Brief.</p>
      ) : null}

      <div className="mt-auto px-3 font-mono text-xs text-muted/50">v{__APP_VERSION__}</div>
    </aside>
  )
}
