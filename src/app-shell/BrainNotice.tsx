import { useEffect, useState } from 'react'
import { Cpu } from 'lucide-react'
import { getIpc } from '../lib/bridge'
import { useProjectStore } from '../state/useProjectStore'

/**
 * Zero-setup brain notices (JOB 1/2). The main process sends `ai:notice`:
 *  - kind 'toast'  → one quiet info toast ("local brain found, switched", new free models);
 *  - kind 'inline' → a subtle one-line status ("free brain busy, retrying", "offline brain").
 * Never a dialog, never blocking, pointer-events-none.
 */
export function BrainNotice() {
  const [line, setLine] = useState('')
  const pushToast = useProjectStore((s) => s.pushToast)
  useEffect(() => {
    const ipc = getIpc()
    if (!ipc || typeof ipc.on !== 'function') return
    let timer: ReturnType<typeof setTimeout> | undefined
    const off = ipc.on('ai:notice', (payload: unknown) => {
      const p = (payload || {}) as { text?: string; kind?: string }
      const text = String(p.text || '').slice(0, 200)
      if (!text) return
      if (p.kind === 'toast') { pushToast('info', text, { id: `ai-notice-${text.slice(0, 40)}` }); return }
      setLine(text)
      clearTimeout(timer)
      timer = setTimeout(() => setLine(''), 6000)
    })
    return () => { clearTimeout(timer); off?.() }
  }, [pushToast])
  if (!line) return null
  return (
    <div role="status" aria-live="polite" className="pointer-events-none fixed bottom-3 left-1/2 z-40 flex -translate-x-1/2 items-center gap-1.5 rounded-full border border-line bg-panel px-3 py-1 text-xs text-muted shadow-sm">
      <Cpu size={12} aria-hidden /> {line}
    </div>
  )
}
