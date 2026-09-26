export type RenderUpdate = (pct: number) => void
export type RenderSource = {
  sourceType?: 'arena' | 'footage'
  type?: 'arena' | 'footage'
  id?: string
  durationSec?: number
  htmlPath?: string | null
  arenaPath?: string | null
  localPath?: string | null
  videoPath?: string | null
  footagePath?: string | null
  in?: number
  out?: number
  silenceRanges?: [number, number][]
  applySilenceCuts?: boolean
  captions?: { start?: number; end?: number; from?: number; to?: number; text?: string; copy?: string }[]
  captionStyle?: 'hormozi' | 'standard' | 'minimal'
  crop?: '16:9' | '9:16' | '1:1'
}
export type RenderJobInput = {
  id?: string
  aspect?: string
  fps?: number
  quality?: string
  outputName?: string | null
  size?: [number, number]
  sources?: RenderSource[]
}
export type RenderResult = { outputPath?: string; error?: string; cancelled?: boolean }

export function startRender(job: RenderJobInput, onUpdate: RenderUpdate, onDone: (result?: RenderResult) => void): () => void {
  const ipc = (window as any).northframe?.ipc
  if (ipc) {
    let finished = false
    let cancelled = false
    const cleanup: Array<() => void> = []
    const done = (result?: RenderResult) => {
      if (finished) return
      finished = true
      cleanup.forEach((fn) => fn())
      onDone(result)
    }

    if (typeof ipc.on === 'function') {
      cleanup.push(
        ipc.on('render:progress', (event: { jobId?: string; pct?: number }) => {
          if (event?.jobId === job.id && typeof event.pct === 'number') onUpdate(event.pct)
        }),
      )
      cleanup.push(
        ipc.on('render:error', (event: { jobId?: string; error?: string }) => {
          if (event?.jobId === job.id && !cancelled) done({ error: event.error || 'Render failed' })
        }),
      )
      cleanup.push(
        ipc.on('render:done', (event: { jobId?: string; outputPath?: string }) => {
          if (event?.jobId === job.id) {
            onUpdate(100)
            done({ outputPath: event.outputPath })
          }
        }),
      )
    }

    onUpdate(1)
    ipc
      .invoke('render:start', job)
      .then((result: RenderResult) => {
        if (!cancelled) {
          onUpdate(100)
          done(result)
        }
      })
      .catch((err: Error) => {
        if (!cancelled) done({ error: err?.message || 'Render failed' })
      })

    return () => {
      cancelled = true
      cleanup.forEach((fn) => fn())
      void ipc.invoke('render:cancel', { jobId: job.id })
    }
  }

  const total = 6000
  const t0 = performance.now()
  let last = -1
  const iv = window.setInterval(() => {
    const t = Math.min(1, (performance.now() - t0) / total)
    const pct = Math.floor((1 - Math.pow(1 - t, 1.7)) * 100)
    if (pct !== last) {
      last = pct
      onUpdate(pct)
    }
    if (t >= 1) {
      window.clearInterval(iv)
      onDone()
    }
  }, 110)
  return () => window.clearInterval(iv)
}

export const fakeStartRender = (onUpdate: RenderUpdate, onDone: () => void) => startRender({}, onUpdate, onDone)
