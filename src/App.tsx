import { useEffect } from 'react'
import { MotionConfig } from 'motion/react'
import { AppLayout } from './app-shell/AppLayout'
import { useProjectStore } from './state/useProjectStore'

export default function App() {
  const theme = useProjectStore((s) => s.theme)
  const setAskOpen = useProjectStore((s) => s.setAskOpen)

  useEffect(() => {
    document.documentElement.dataset.theme = theme
  }, [theme])

  // Electron is the source of truth for native job progress.
  useEffect(() => {
    const ipc = (window as any).northframe?.ipc
    if (!ipc) return
    const apply = (payload: any) => {
      const job = payload?.id ? payload : payload?.job ? payload.job : payload
      const id = job?.id || job?.jobId || payload?.jobId
      if (!id) return
      const store = useProjectStore.getState()
      if (job?.steps) {
        store.updateAutomationJob(id, job)
        if (job.rundown && job.projectId) {
          store.patchRundown(job.projectId, job.rundown)
          store.lockRundown(job.projectId)
          if (job.rundown.title) store.renameProject(job.projectId, job.rundown.title)
        }
      } else if (payload?.message) {
        store.updateAutomationJob(id, { status: payload.status === 'error' ? 'error' : 'waiting-for-user', waitingMessage: payload.message, errorMessage: payload.status === 'error' ? payload.message : undefined })
      }
    }
    const unsubs = ['automation:progress', 'automation:step', 'automation:done', 'automation:waiting', 'automation:error'].map(c => ipc.on(c, apply))
    return () => unsubs.forEach((off: any) => off?.())
  }, [])

  // ⌘K / Ctrl+K toggles the Ask Gemini slide-over
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setAskOpen(!useProjectStore.getState().askOpen)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [setAskOpen])

  return (
    <MotionConfig reducedMotion="user" transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}>
      <AppLayout />
    </MotionConfig>
  )
}
