import { Suspense, lazy, useEffect, useState } from 'react'
import { useProjectStore } from '../state/useProjectStore'

/**
 * Mounts the Ask panel the first time it is opened (F-4).
 *
 * Ask is a slide-over that starts closed, but it was the largest single piece
 * of app code in the first-paint bundle — the chat, the settings sheet, the
 * model pickers, the orb animation and both AI clients. None of that is needed
 * to draw the window.
 *
 * Once opened it stays mounted, so the conversation, the settings sheet and
 * the endpoint-health poll all survive closing the panel; only the very first
 * open pays for the fetch, behind the panel's own slide-in.
 */
const AskPanel = lazy(() => import('./AskPanel').then((m) => ({ default: m.AskPanel })))

export function AskPanelHost() {
  const open = useProjectStore((s) => s.askOpen)
  const [everOpened, setEverOpened] = useState(open)

  useEffect(() => {
    if (open) setEverOpened(true)
  }, [open])

  if (!everOpened) return null
  return (
    <Suspense fallback={null}>
      <AskPanel />
    </Suspense>
  )
}
