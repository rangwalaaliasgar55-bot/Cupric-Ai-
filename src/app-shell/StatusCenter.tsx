/** Top-bar status centre: active jobs badge + a panel with open/cancel/resume. */
import { useEffect, useMemo, useRef, useState } from 'react'
import { Z } from '../lib/studio/panelLayout'
import { Activity } from 'lucide-react'
import { useProjectStore } from '../state/useProjectStore'
import { activeCount, collectStatus } from '../lib/statusCenter'
import { ProgressBar } from '../components/ProgressBar'

export function StatusCenter() {
  const jobs = useProjectStore((s) => s.automationJobs)
  const projects = useProjectStore((s) => s.projects)
  const cancel = useProjectStore((s) => s.cancelAutomationJob)
  const resume = useProjectStore((s) => s.resumeAutomationJob)
  const setView = useProjectStore((s) => s.setView)
  const openProject = useProjectStore((s) => s.setActiveProject)
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const items = useMemo(() => collectStatus(jobs, projects), [jobs, projects])
  const active = activeCount(items)

  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !ref.current?.contains(e.target as Node)) setOpen(false)
    }
    window.addEventListener('mousedown', close)
    window.addEventListener('keydown', close)
    return () => { window.removeEventListener('mousedown', close); window.removeEventListener('keydown', close) }
  }, [open])

  return (
    <div ref={ref} className="relative">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-label={`Background jobs: ${active} active`}
        className="relative grid h-8 w-8 place-items-center rounded-lg text-muted transition-colors duration-150 hover:bg-panel-alt hover:text-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent">
        <Activity size={16} className={active ? 'text-accent-text' : ''} />
        {active > 0 && <span className="absolute -right-0.5 -top-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-accent px-1 font-mono text-[10px] font-semibold text-accent-ink">{active}</span>}
      </button>
      {open && (
        <div role="dialog" aria-label="Background jobs" style={{ zIndex: Z.panel }} className="absolute right-0 top-10 w-[min(380px,92vw)] overflow-hidden rounded-xl border border-line bg-panel shadow-2xl motion-safe:animate-[fadeIn_120ms_ease-out]">
          <div className="border-b border-line px-3 py-2 text-sm font-medium">Background jobs</div>
          <ul className="max-h-[60vh] space-y-1 overflow-y-auto p-2">
            {items.length === 0 && <li className="px-2 py-6 text-center text-xs text-muted">Nothing running. Renders and Auto runs show up here.</li>}
            {items.slice(0, 30).map((it) => (
              <li key={`${it.kind}-${it.id}`} className="rounded-lg border border-line px-3 py-2 text-xs">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate font-medium text-text">{it.title}</span>
                  <span className={it.state === 'error' ? 'text-danger' : it.state === 'waiting' ? 'text-info' : it.state === 'active' ? 'text-accent-text' : 'text-muted'}>{it.state === 'waiting' ? 'needs you' : it.state}</span>
                </div>
                <div className="mt-0.5 truncate text-muted">{it.detail}</div>
                {(it.state === 'active' || it.state === 'waiting') && <ProgressBar pct={it.pct} className="mt-1.5" />}
                <div className="mt-1.5 flex gap-1.5">
                  <button type="button" className="cu-chip px-2 py-0.5" onClick={() => { openProject(it.projectId); setView(it.kind === 'render' ? 'render' : 'auto'); setOpen(false) }}>Open</button>
                  {it.kind === 'automation' && it.state === 'active' && <button type="button" className="cu-chip px-2 py-0.5" onClick={() => cancel(it.id)}>Cancel</button>}
                  {it.kind === 'automation' && (it.state === 'error' || it.state === 'cancelled') && <button type="button" className="cu-chip px-2 py-0.5" onClick={() => resume(it.id)}>Resume</button>}
                  {it.state === 'waiting' && it.kind === 'automation' && <button type="button" className="cu-chip px-2 py-0.5" onClick={() => { setView('auto'); setOpen(false) }}>Review gate</button>}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
