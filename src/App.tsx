import { useEffect } from 'react'
import { MotionConfig } from 'motion/react'
import { AppLayout } from './app-shell/AppLayout'
import { getBridge, getIpc } from './lib/bridge'
import { setSoundEnabled } from './lib/sound'
import { transitionSoft } from './lib/motion'
import { useProjectStore } from './state/useProjectStore'

export default function App() {
  const theme = useProjectStore((s) => s.theme)
  const setAskOpen = useProjectStore((s) => s.setAskOpen)
  const soundCues = useProjectStore((s) => s.soundCues)

  useEffect(() => {
    document.documentElement.dataset.theme = theme
  }, [theme])

  // On macOS the window is a real vibrancy material, so the app must not paint
  // an opaque background over it — the panels stay solid, the page behind them
  // lets the desktop through. Everywhere else the background is opaque as usual.
  // The stored preference is the source of truth; the sound module holds the
  // live answer so it can be read from outside React.
  useEffect(() => {
    setSoundEnabled(soundCues)
  }, [soundCues])

  useEffect(() => {
    const platform = getBridge()?.platform
    if (platform === 'darwin') document.documentElement.dataset.vibrancy = 'on'
    else delete document.documentElement.dataset.vibrancy
  }, [])

  /**
   * Updates announce themselves once, quietly, and only when there is
   * something to act on.
   *
   * The main process checks at launch and every four hours after that, so
   * nobody has to go looking for a "check for updates" button. "checking" and
   * "current" stay silent — they are not news. Only a finished download says
   * anything, and even then it is a toast that waits rather than a dialog
   * that interrupts: the update installs on the next quit regardless, so the
   * button is a shortcut, not a demand.
   */
  useEffect(() => {
    const ipc = getIpc()
    if (!ipc || typeof ipc.on !== 'function') return
    return ipc.on('updater:status', (event: { status?: string; version?: string }) => {
      if (event?.status !== 'downloaded') return
      const version = event.version ? ` ${event.version}` : ''
      useProjectStore.getState().pushToast('info', `Cupric${version} is ready — it installs next time you quit.`, {
        // One banner per version, however many times the event arrives.
        id: `update-${event.version ?? 'ready'}`,
        sticky: true,
        action: {
          label: 'Restart now',
          run: () => {
            void ipc.invoke('updater:install').catch(() => {
              useProjectStore
                .getState()
                .pushToast('error', 'That update could not be applied right now. It will install when you next quit.')
            })
          },
        },
      })
    })
  }, [])

  // Electron is the source of truth for native job progress.
  useEffect(() => {
    const ipc = getIpc()
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
        store.updateAutomationJob(id, {
          status: payload.status === 'error' ? 'error' : 'waiting-for-user',
          waitingMessage: payload.message,
          errorMessage: payload.status === 'error' ? payload.message : undefined,
        })
      }
    }
    const unsubs = ['automation:progress', 'automation:step', 'automation:done', 'automation:waiting', 'automation:error'].map(
      (c) => ipc.on(c, apply),
    )
    return () => unsubs.forEach((off: any) => off?.())
  }, [])

  // ⌘K / Ctrl+K toggles the Ask panel
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
    <MotionConfig reducedMotion="user" transition={transitionSoft}>
      <AppLayout />
    </MotionConfig>
  )
}
