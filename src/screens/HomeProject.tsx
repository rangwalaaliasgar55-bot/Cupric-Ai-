import { useEffect, useState } from 'react'
import { Copy, Plus, Trash2 } from 'lucide-react'
import { Badge } from '../components/Badge'
import { Button } from '../components/Button'
import { Card } from '../components/Card'
import { EmptyState } from '../components/EmptyState'
import { IconButton } from '../components/IconButton'
import type { Project } from '../types/project'
import { useProjectStore } from '../state/useProjectStore'
import { cx, gradientFor, initials, relTime } from '../lib/utils'

export function HomeProject() {
  const projects = useProjectStore((s) => s.projects)
  const createProject = useProjectStore((s) => s.createProject)
  const setActiveProject = useProjectStore((s) => s.setActiveProject)
  const setView = useProjectStore((s) => s.setView)
  const duplicateProject = useProjectStore((s) => s.duplicateProject)
  const deleteProject = useProjectStore((s) => s.deleteProject)
  const pushToast = useProjectStore((s) => s.pushToast)

  function open(id: string) {
    setActiveProject(id)
    setView('brief')
  }

  function create() {
    const id = createProject()
    pushToast('success', 'Project created — starting in the Brief')
    void id
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto w-full max-w-6xl px-6 py-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-xl font-bold">Projects</h1>
            <p className="mt-0.5 text-sm text-muted">
              Short-form video, from rough idea to exported cut — brief, battle, edit, render.
            </p>
          </div>
          <Button variant="primary" onClick={create}>
            <Plus size={15} />
            New project
          </Button>
        </div>

        {projects.length === 0 ? (
          <div className="mt-8">
            <EmptyState
              icon={Plus}
              title="No projects yet"
              hint="Every project starts as a rough idea in the Brief — Gemini drafts the rundown from there."
              action={
                <Button variant="primary" size="sm" onClick={create}>
                  <Plus size={14} />
                  New project
                </Button>
              }
            />
          </div>
        ) : (
          <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {projects.map((p) => (
              <ProjectCard
                key={p.id}
                project={p}
                onOpen={() => open(p.id)}
                onDuplicate={() => {
                  duplicateProject(p.id)
                  pushToast('success', `Duplicated “${p.name}”`)
                }}
                onDelete={() => {
                  deleteProject(p.id)
                  pushToast('info', `Deleted “${p.name}”`)
                }}
              />
            ))}
            <button
              type="button"
              onClick={create}
              className="flex min-h-[208px] flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed border-line text-muted transition-colors duration-150 hover:border-accent/50 hover:text-text"
            >
              <Plus size={18} />
              <span className="text-sm font-medium">New project</span>
              <span className="text-xs text-muted">Starts in the Brief</span>
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

function ProjectCard({
  project,
  onOpen,
  onDuplicate,
  onDelete,
}: {
  project: Project
  onOpen: () => void
  onDuplicate: () => void
  onDelete: () => void
}) {
  const hasRender = project.renderJobs.some((j) => j.status === 'done')
  const thumbnail = project.arenaAssets.find((a) => a.thumbnailDataUrl)?.thumbnailDataUrl ?? null
  return (
    <Card className="group flex flex-col overflow-hidden transition-colors duration-150 hover:border-text/20">
      <button type="button" onClick={onOpen} aria-label={`Open ${project.name}`} className="block text-left">
        <div className={cx('relative aspect-video w-full overflow-hidden', thumbnail ? 'bg-bg' : gradientFor(project.id))}>
          {thumbnail ? (
            <img src={thumbnail} alt="" className="h-full w-full object-cover" />
          ) : (
            <span className="absolute inset-0 flex items-center justify-center text-xl font-bold tracking-wide text-white/85">
              {initials(project.name)}
            </span>
          )}
          {hasRender && (
            <Badge tone="accent" className="absolute right-2 top-2">
              rendered
            </Badge>
          )}
        </div>
      </button>
      <div className="flex flex-1 flex-col gap-3 p-4">
        <div>
          <div className="truncate text-sm font-semibold">{project.name}</div>
          <div className="mt-0.5 text-xs text-muted">Edited {relTime(project.updatedAt)}</div>
        </div>
        <div className="flex items-center gap-2 text-xs text-muted">
          <span className="tabular-nums">{project.arenaAssets.length} arena</span>
          <span aria-hidden>·</span>
          <span className="tabular-nums">{project.footageAssets.length} footage</span>
          <span aria-hidden>·</span>
          <span className="tabular-nums">{project.timeline.length} clips</span>
        </div>
        <div className="mt-auto flex items-center gap-1.5 pt-1">
          <Button size="sm" variant="primary" onClick={onOpen}>
            Open
          </Button>
          <IconButton label="Duplicate project" onClick={onDuplicate}>
            <Copy size={15} />
          </IconButton>
          <DeleteButton onDelete={onDelete} />
        </div>
      </div>
    </Card>
  )
}

/** Two-step delete — inline confirm, no tooltip, no dialog. */
function DeleteButton({ onDelete }: { onDelete: () => void }) {
  const [armed, setArmed] = useState(false)
  useEffect(() => {
    if (!armed) return
    const t = window.setTimeout(() => setArmed(false), 2500)
    return () => window.clearTimeout(t)
  }, [armed])

  if (armed)
    return (
      <Button size="sm" variant="danger" onClick={onDelete} className="px-2">
        Confirm?
      </Button>
    )
  return (
    <IconButton label="Delete project" onClick={() => setArmed(true)} className="hover:text-danger">
      <Trash2 size={15} />
    </IconButton>
  )
}
