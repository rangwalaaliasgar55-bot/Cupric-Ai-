export type RenderUpdate = (pct: number) => void
export type RenderJobInput = { id?: string; aspect?: string; fps?: number; quality?: string; outputName?: string | null; sources?: unknown[] }

export function startRender(job: RenderJobInput, onUpdate: RenderUpdate, onDone: (result?: { outputPath?: string }) => void): () => void {
  const ipc = (window as any).northframe?.ipc
  if (ipc) {
    let cancelled = false
    onUpdate(1)
    ipc.invoke('render:start', job).then((result: { outputPath?: string }) => { if (!cancelled) { onUpdate(100); onDone(result) } }).catch(() => { if (!cancelled) onDone() })
    return () => { cancelled = true; void ipc.invoke('render:cancel', { jobId: job.id }) }
  }
  const total = 6000
  const t0 = performance.now()
  let last = -1
  const iv = window.setInterval(() => {
    const t = Math.min(1, (performance.now() - t0) / total)
    const pct = Math.floor((1 - Math.pow(1 - t, 1.7)) * 100)
    if (pct !== last) { last = pct; onUpdate(pct) }
    if (t >= 1) { window.clearInterval(iv); onDone() }
  }, 110)
  return () => window.clearInterval(iv)
}

export const fakeStartRender = (onUpdate: RenderUpdate, onDone: () => void) => startRender({}, onUpdate, onDone)
