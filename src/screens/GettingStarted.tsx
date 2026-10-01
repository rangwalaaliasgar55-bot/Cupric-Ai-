import { useState } from 'react'
import { Check, X } from 'lucide-react'
import { Card } from '../components/Card'
import type { Project } from '../types/project'
import { useProjectStore } from '../state/useProjectStore'
import { gettingStartedSteps, progressOf } from '../lib/gettingStarted'

const KEY = 'newbrand.gettingStarted.dismissed'

export function GettingStarted({ project }: { project: Project | null }) {
  const setActiveProject = useProjectStore((s) => s.setActiveProject)
  const setView = useProjectStore((s) => s.setView)
  const [hidden, setHidden] = useState(() => { try { return localStorage.getItem(KEY) === '1' } catch { return false } })
  const steps = gettingStartedSteps(project)
  const { done, total } = progressOf(steps)
  if (hidden || !project || done === total) return null
  return (
    <Card className="mt-6 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">Getting started · {project.name}</h2>
          <p className="text-xs text-muted">{done} of {total} done, based on this project's current state</p>
        </div>
        <button type="button" aria-label="Hide checklist" className="text-muted hover:text-text" onClick={() => { try { localStorage.setItem(KEY, '1') } catch { /* ignore */ } setHidden(true) }}><X size={14} /></button>
      </div>
      <div className="mt-2 h-1 rounded bg-line" role="progressbar" aria-valuenow={done} aria-valuemin={0} aria-valuemax={total}>
        <div className="h-1 rounded bg-accent transition-[width] duration-300 motion-reduce:transition-none" style={{ width: `${(done / total) * 100}%` }} />
      </div>
      <ol className="mt-3 grid gap-1.5 sm:grid-cols-5">
        {steps.map((s) => (
          <li key={s.id}>
            <button type="button" className="flex w-full items-center gap-2 rounded-md border border-line px-2 py-1.5 text-left text-xs hover:bg-surface-2" onClick={() => { setActiveProject(project.id); setView(s.view) }}>
              <span className={`grid h-4 w-4 shrink-0 place-items-center rounded-full border ${s.done ? 'border-success bg-success text-bg' : 'border-line'}`}>{s.done && <Check size={10} />}</span>
              <span><span className={s.done ? 'text-muted line-through' : 'text-text'}>{s.label}</span><br /><span className="text-muted">{s.hint}</span></span>
            </button>
          </li>
        ))}
      </ol>
    </Card>
  )
}
