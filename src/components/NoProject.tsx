import { FolderOpen } from 'lucide-react'
import { Button } from './Button'
import { EmptyState } from './EmptyState'
import { useProjectStore } from '../state/useProjectStore'

/** Shared guard for the six project-scoped screens. */
export function NoProject() {
  const createProject = useProjectStore((s) => s.createProject)
  const hasProjects = useProjectStore((s) => s.projects.length > 0)
  const setView = useProjectStore((s) => s.setView)
  return (
    <div className="flex h-full items-center justify-center p-8">
      <EmptyState
        icon={FolderOpen}
        title="No project open"
        hint={hasProjects ? 'Every desk works on the active project. Open one on Home to continue.' : 'Every desk works on the active project. Start one — it opens right here.'}
        action={
          hasProjects ? (
            <Button variant="primary" size="sm" onClick={() => setView('home')}>Open a project on Home</Button>
          ) : (
            <Button variant="primary" size="sm" onClick={() => createProject()}>New project</Button>
          )
        }
        className="max-w-md"
      />
    </div>
  )
}
