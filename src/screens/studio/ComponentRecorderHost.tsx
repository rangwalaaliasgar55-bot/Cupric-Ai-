/**
 * Records queued UI components in the Studio.
 *
 * Any overlay clip whose `component.status` is `pending` — placed from the
 * Components panel, Resources, the Lab or by the agent — is recorded here:
 * the real React component plays on a visible stage (the compositor can only
 * capture what is on screen), is acted out, and its actual animation replaces
 * the placeholder card on the timeline. One at a time, in timeline order.
 */
import { ProgressBar } from '../../components/ProgressBar'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Loader2, X } from 'lucide-react'
import type { StudioClip, StudioDoc } from '../../types/project'
import { DemoFrame } from '../../lab/DemoFrame'
import { availableSlugs } from '../../lab/demos'
import { Button } from '../../components/Button'
import { humanError } from '../../lib/humanError'
import { findComponent, fitComponentScale, isPendingComponent } from '../../lib/studio/components'
import { recordComponent } from '../../lib/studio/componentRecorder'
import { useProjectStore } from '../../state/useProjectStore'

export function ComponentRecorderHost({ projectId, doc }: { projectId: string; doc: StudioDoc }) {
  const landRecording = useProjectStore((s) => s.landComponentRecording)
  const pushToast = useProjectStore((s) => s.pushToast)
  const [skipped, setSkipped] = useState<Set<string>>(new Set())
  // Timeline clips first, then shelf recordings (2.13 — record now, place
  // later). Both go through this one recorder; there is no second path.
  const queue = useMemo(
    () => [
      ...doc.clips.filter((clip) => isPendingComponent(clip) && !skipped.has(clip.id)).sort((a, b) => a.startSec - b.startSec),
      ...(doc.shelf ?? []).filter((clip) => isPendingComponent(clip) && !skipped.has(clip.id)),
    ],
    [doc.clips, doc.shelf, skipped],
  )
  const current = queue[0] as (StudioClip & { kind: 'overlay' }) | undefined
  if (!current?.component) return null
  const onShelf = (doc.shelf ?? []).some((item) => item.id === current.id)
  // Recording results land without an undo step (2.31 audit): Undo after
  // your own edit must undo your edit, not the recording.
  const update = (patch: Partial<StudioClip>) => landRecording(projectId, current.id, patch as never)
  return (
    <RecorderCard
      key={`${current.id}:${current.component.slug}:${current.component.recordSec}:${current.component.interact}`}
      clip={current}
      remaining={queue.length}
      aspect={doc.aspect}
      onShelf={onShelf}
      onDone={(patch) => {
        update(patch as Partial<StudioClip>)
        if (onShelf) pushToast('success', `“${current.name}” recorded — place it from Components whenever you like.`)
      }}
      onCancel={() => {
        setSkipped((prev) => new Set(prev).add(current.id))
        update({ component: { ...current.component!, status: 'failed', error: 'Recording cancelled' } } as Partial<StudioClip>)
        pushToast('info', `Stopped recording “${current.name}”. Select it and press Record again any time.`)
      }}
      onError={(message) => {
        update({ component: { ...current.component!, status: 'failed', error: message } } as Partial<StudioClip>)
        pushToast('error', message, { id: `component-${current.id}` })
      }}
    />
  )
}

function RecorderCard({
  clip,
  remaining,
  aspect,
  onShelf = false,
  onDone,
  onCancel,
  onError,
}: {
  clip: StudioClip & { kind: 'overlay' }
  remaining: number
  aspect: StudioDoc['aspect']
  onShelf?: boolean
  onDone: (patch: Record<string, unknown>) => void
  onCancel: () => void
  onError: (message: string) => void
}) {
  const meta = clip.component!
  const entry = findComponent(meta.slug)
  const stageRef = useRef<HTMLDivElement>(null)
  const [pct, setPct] = useState(0)
  const [phase, setPhase] = useState<'loading' | 'recording' | 'finishing'>('loading')
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    if (!entry || !availableSlugs.has(meta.slug)) {
      onError(`The “${meta.slug}” component is not part of this build, so it cannot be recorded.`)
      return
    }
    const controller = new AbortController()
    abortRef.current = controller
    let alive = true
    void (async () => {
      try {
        // Wait for the lazily loaded demo to mount, then let it settle.
        const deadline = performance.now() + 10000
        while (alive && performance.now() < deadline && !stageRef.current?.querySelector('.lab-canvas .lab-canvas > *')) {
          await new Promise((resolve) => setTimeout(resolve, 80))
        }
        await new Promise((resolve) => setTimeout(resolve, 450))
        if (!alive || !stageRef.current) return
        setPhase('recording')
        const pixelRatio = 2
        const result = await recordComponent(stageRef.current, {
          durationSec: meta.recordSec,
          interact: meta.interact,
          pixelRatio,
          signal: controller.signal,
          onProgress: (value) => alive && setPct(value),
        })
        if (!alive) return
        setPhase('finishing')
        if (!result.frames.length) throw new Error('No frames were captured.')
        // The compositor captures at screen density, the DOM renderers at `pixelRatio`.
        const density = result.method === 'compositor' ? window.devicePixelRatio || 1 : pixelRatio
        onDone({
          dataUrl: result.frames[Math.min(result.frames.length - 1, Math.floor(result.frames.length * 0.6))],
          frames: result.animated ? result.frames : undefined,
          frameFps: result.animated ? result.frameFps : undefined,
          // Keep a size the user chose; size fresh placements to read well.
          scale: clip.scale !== 1 ? clip.scale : fitComponentScale(result.width, result.height, density, aspect),
          source: `UI component · ${entry.name} · ${result.animated ? `${result.frames.length} frames recorded live` : 'still (it has no motion on its own)'}`,
          component: { ...meta, status: 'ready', error: undefined },
        })
      } catch (error) {
        if (!alive || controller.signal.aborted) return
        onError(humanError(error, `Could not record “${entry.name}”`))
      }
    })()
    return () => {
      alive = false
      controller.abort()
    }
    // One recording per mount (the host keys this card by clip + settings).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/45 p-4 backdrop-blur-[2px]" role="dialog" aria-label={`Recording ${clip.name}`}>
      <div className="flex max-h-full w-[min(640px,94vw)] flex-col overflow-hidden rounded-2xl border border-line bg-panel shadow-2xl">
        <div className="flex items-center gap-3 border-b border-line px-4 py-2.5">
          <Loader2 size={14} className="animate-spin text-accent-text" />
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold">Recording “{clip.name}”</div>
            <div className="text-xs text-muted">
              {phase === 'loading' ? 'Loading the component…' : phase === 'finishing' ? onShelf ? 'Saving it to the shelf…' : 'Placing it on your timeline…' : `${meta.interact ? 'Acting it out' : 'Capturing'} · ${meta.recordSec}s of real animation · ${pct}%`}
              {remaining > 1 ? ` · ${remaining - 1} more queued` : ''}
            </div>
          </div>
          <Button size="sm" variant="ghost" onClick={() => { abortRef.current?.abort(); onCancel() }} aria-label="Stop recording">
            <X size={13} /> Stop
          </Button>
        </div>
        {/* Natural size, on screen: exactly what lands in the video. */}
        <div ref={stageRef} className="lab-canvas relative flex h-[min(400px,62vh)] w-full items-center justify-center overflow-hidden p-6">
          <DemoFrame slug={meta.slug} play forceMotion props={meta.props} className="place-items-center" />
        </div>
        {/* Inset footer, so the bar never gets cut off by the card's rounded corner. */}
        <div className="flex items-center gap-3 border-t border-line px-4 py-2.5">
          <ProgressBar pct={pct} className="flex-1" />
          <span className="w-10 text-right font-mono text-xs tabular-nums text-muted">{Math.round(pct)}%</span>
        </div>
      </div>
    </div>
  )
}
