import { useEffect } from 'react'
import { MotionConfig } from 'motion/react'
import { AppLayout } from './app-shell/AppLayout'
import { getBridge, getIpc } from './lib/bridge'
import { setSoundEnabled } from './lib/sound'
import { transitionSoft } from './lib/motion'
import { useProjectStore } from './state/useProjectStore'
import { studioOf } from './lib/studio/doc'
import { rundownToStudioClips } from './lib/studio/importHtml'
import { FONT_MISSING_EVENT } from './lib/studio/fonts'
import { fontshareFont, fontshareUrl } from './lib/studio/fontStyles'

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
          // The autonomous render is not a dead-end MP4: once complete, seed
          // an empty project's Studio with ordinary editable scene clips. A
          // non-empty edit is never overwritten, and the one patch is one undo.
          if (job.status === 'done') {
            const latestProject = useProjectStore.getState().projects.find((project) => project.id === job.projectId)
            const doc = studioOf(latestProject)
            if (latestProject && doc.clips.length === 0) {
              const clips = rundownToStudioClips(job.rundown, doc, 'Autonomous')
              store.patchStudio(job.projectId, {
                clips,
                aspect: job.aspect,
                fps: job.fps,
              })
              store.pushToast('success', 'Editable generated scenes are ready in Studio.', {
                action: { label: 'Open Studio', run: () => useProjectStore.getState().setView('studio') },
              })
            }
          }
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

  /**
   * A font that cannot be made ready is a design problem the user can fix, not
   * something to paint over. Say it once per family — canvas text has already
   * fallen back by the time this fires — and put the way out in the toast:
   * the Fontshare page when the family is free there, the Studio font shelf
   * otherwise.
   */
  useEffect(() => {
    const onMissing = (event: Event) => {
      const family = (event as CustomEvent<{ family?: string }>).detail?.family?.trim()
      if (!family) return
      const catalog = fontshareFont(family)
      const store = useProjectStore.getState()
      store.pushToast('error', `“${family}” is not loading, so ${family} text is drawing in the fallback face. Download the family and add it in Studio → Text → Fonts (it is embedded in your exports from then on).`, {
        id: `font-missing-${family.toLowerCase()}`,
        sticky: true,
        action: catalog
          ? { label: `Get ${family} free`, run: () => window.open(fontshareUrl(catalog.slug), '_blank', 'noopener') }
          : { label: 'Open Studio', run: () => store.setView('studio') },
      })
    }
    window.addEventListener(FONT_MISSING_EVENT, onMissing)
    return () => window.removeEventListener(FONT_MISSING_EVENT, onMissing)
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
