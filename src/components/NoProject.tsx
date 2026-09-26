import { FolderOpen } from 'lucide-react'
import { Button } from './Button'
import { EmptyState } from './EmptyState'
import { useProjectStore } from '../state/useProjectStore'

/** Shared guard for the six project-scoped screens. */
export function NoProject() {
  const setView = useProjectStore((s) => s.setView)
  return (
    <div className="flex h-full items-center justify-center p-8">
      <EmptyState
        icon={FolderOpen}
        title="No project open"
        hint="Pick a project on Home — or start a new one. Every desk operates on the active project."
        action={
          <Button variant="primary" size="sm" onClick={() => setView('home')}>
            Go to Home
          </Button>
        }
        className="max-w-md"
      />
    </div>
  )
}
