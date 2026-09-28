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
import { flushSync } from 'react-dom'
import { Archive, Check, Loader2, Trash2, X } from 'lucide-react'
import type { StudioClip, StudioDoc } from '../../types/project'
import { DemoFrame } from '../../lab/DemoFrame'
import { availableSlugs } from '../../lab/demos'
import { GeneratedFrame } from './GeneratedFrame'
import { Button } from '../../components/Button'
import { humanError } from '../../lib/humanError'
import { findComponent, fitComponentScale, isPendingComponent } from '../../lib/studio/components'
import { recordComponent } from '../../lib/studio/componentRecorder'
import { useProjectStore } from '../../state/useProjectStore'
import { Z } from '../../lib/studio/panelLayout'

export function ComponentRecorderHost({ projectId, doc }: { projectId: string; doc: StudioDoc }) {
  const landRecording = useProjectStore((s) => s.landComponentRecording)
  const moveToShelf = useProjectStore((s) => s.shelveComponentRecording)
  const discard = useProjectStore((s) => s.discardComponentRecording)
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
        else pushToast('success', `“${current.name}” applied at ${current.startSec.toFixed(1)}s. Undo removes it.`)
      }}
      // JOB 6 — "Save to shelf" moves a timeline recording off the timeline, so
      // nothing lands in the edit until the user actually wants it there.
      onShelve={(patch) => {
        moveToShelf(projectId, current.id, patch as never)
        pushToast('success', `“${current.name}” saved to the shelf — it is not on your timeline. Place it from Components when you want it.`)
      }}
      onDiscard={() => {
        setSkipped((prev) => new Set(prev).add(current.id))
        discard(projectId, current.id)
        pushToast('info', `Discarded the recording of “${current.name}”. Nothing was added to your timeline.`)
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

/** What the user reviews before anything touches the timeline. */
type RecordingReview = {
  patch: Record<string, unknown>
  first: string
  mid: string
  last: string
  frameCount: number
  animated: boolean
  durationSec: number
  width: number
  height: number
  bytes: number
}

const AUTO_APPLY_KEY = 'cupric.componentRecorder.autoApply'
/** Auto-insert is off until the user asks for it, and remembered per machine. */
function readAutoApply(): boolean {
  try { return localStorage.getItem(AUTO_APPLY_KEY) === '1' } catch { return false }
}
function writeAutoApply(on: boolean) {
  try { localStorage.setItem(AUTO_APPLY_KEY, on ? '1' : '0') } catch { /* private mode: the session default stands */ }
}

const prettyBytes = (n: number) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`)

function RecorderCard({
  clip,
  remaining,
  aspect,
  onShelf = false,
  onDone,
  onShelve,
  onDiscard,
  onCancel,
  onError,
}: {
  clip: StudioClip & { kind: 'overlay' }
  remaining: number
  aspect: StudioDoc['aspect']
  onShelf?: boolean
  onDone: (patch: Record<string, unknown>) => void
  onShelve: (patch: Record<string, unknown>) => void
  onDiscard: () => void
  onCancel: () => void
  onError: (message: string) => void
}) {
  const meta = clip.component!
  const entry = findComponent(meta.slug)
  const stageRef = useRef<HTMLDivElement>(null)
  const [pct, setPct] = useState(0)
  const [phase, setPhase] = useState<'loading' | 'recording' | 'finishing' | 'review'>('loading')
  /**
   * JOB 6 — nothing lands on the timeline unreviewed.
   *
   * The finished recording waits here with its first, middle and last frame on
   * screen until the user chooses Apply, Save to shelf or Discard. Auto-insert
   * still exists but is now opt-in and remembered per machine.
   */
  const [review, setReview] = useState<RecordingReview | null>(null)
  const [autoApply, setAutoApply] = useState(readAutoApply)
  const abortRef = useRef<AbortController | null>(null)
  // The shared clock for clock-driven components: each shot renders exactly its own moment.
  const [clockSec, setClockSec] = useState(0)

  const generated = meta.generated?.source === 'agent-generated' ? meta.generated : null
  const label = entry?.name ?? generated?.name ?? meta.slug

  useEffect(() => {
    if (!generated && (!entry || !availableSlugs.has(meta.slug))) {
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
          onClock: (sec) => { if (alive) flushSync(() => setClockSec(sec)) },
          onProgress: (value) => alive && setPct(value),
        })
        if (!alive) return
        setPhase('finishing')
        if (!result.frames.length) throw new Error('No frames were captured.')
        // The compositor captures at screen density, the DOM renderers at `pixelRatio`.
        const density = result.method === 'compositor' ? window.devicePixelRatio || 1 : pixelRatio
        const patch = {
          dataUrl: result.frames[Math.min(result.frames.length - 1, Math.floor(result.frames.length * 0.6))],
          frames: result.animated ? result.frames : undefined,
          frameFps: result.animated ? result.frameFps : undefined,
          // Keep a size the user chose; size fresh placements to read well.
          scale: clip.scale !== 1 ? clip.scale : fitComponentScale(result.width, result.height, density, aspect),
          source: `${generated ? 'Agent-generated' : 'UI component'} · ${label} · ${result.animated ? `${result.frames.length} frames recorded live` : 'still (it has no motion on its own)'}`,
          component: { ...meta, status: 'ready', error: undefined },
        }
        const frames = result.frames
        const shot = (fraction: number) => frames[Math.min(frames.length - 1, Math.max(0, Math.round((frames.length - 1) * fraction)))]
        const built: RecordingReview = {
          patch,
          first: shot(0),
          mid: shot(0.5),
          last: shot(1),
          frameCount: frames.length,
          animated: Boolean(result.animated),
          durationSec: meta.recordSec,
          width: Math.round(result.width),
          height: Math.round(result.height),
          bytes: frames.reduce((sum, f) => sum + Math.round((f.length - (f.indexOf(',') + 1)) * 0.75), 0),
        }
        // Opt-in auto-insert keeps the old one-click flow for people who want it.
        if (readAutoApply()) { onDone(patch); return }
        setReview(built)
        setPhase('review')
      } catch (error) {
        if (!alive || controller.signal.aborted) return
        onError(humanError(error, `Could not record “${label}”`))
      }
    })()
    return () => {
      alive = false
      controller.abort()
    }
    // One recording per mount (the host keys this card by clip + settings).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /* ——— JOB 6: review, then apply ———————————————————————————————
   * The recording is finished and is sitting in memory. It goes nowhere until
   * the user picks one of the three buttons below.
   */
  if (phase === 'review' && review) {
    const shots: Array<[string, string]> = [['First frame', review.first], ['Middle', review.mid], ['Last frame', review.last]]
    return (
      <div style={{ zIndex: Z.modal }} className="fixed inset-0 flex items-center justify-center bg-black/45 p-4 backdrop-blur-[2px]" role="dialog" aria-label={`Review the recording of ${clip.name}`}>
        <div className="flex max-h-full w-[min(680px,94vw)] flex-col overflow-hidden rounded-2xl border border-line bg-panel shadow-2xl">
          <div className="flex items-center gap-3 border-b border-line px-4 py-2.5">
            <Check size={14} className="text-accent-text" />
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-semibold">Review “{clip.name}”</div>
              <div className="text-xs text-muted">
                {review.animated ? `${review.frameCount} frames` : 'Still — this component has no motion of its own'} · {review.durationSec}s · {review.width}×{review.height} · {prettyBytes(review.bytes)}
                {remaining > 1 ? ` · ${remaining - 1} more queued` : ''}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-2 overflow-y-auto p-4">
            {shots.map(([label, src]) => (
              <figure key={label} className="min-w-0">
                <div className="lab-canvas flex aspect-video items-center justify-center overflow-hidden rounded-lg border border-line bg-black/40">
                  <img src={src} alt={`${label} of the recording`} className="max-h-full max-w-full object-contain" />
                </div>
                <figcaption className="mt-1 text-[11px] text-muted">{label}</figcaption>
              </figure>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-2 border-t border-line px-4 py-2.5">
            <label className="mr-auto flex items-center gap-1.5 text-[11px] text-muted" title="Skip this review next time and drop recordings straight onto the timeline">
              <input type="checkbox" checked={autoApply} onChange={(e) => { setAutoApply(e.target.checked); writeAutoApply(e.target.checked) }} />
              Apply future recordings automatically
            </label>
            <Button size="sm" variant="ghost" onClick={onDiscard} title="Throw this recording away — nothing is added">
              <Trash2 size={13} /> Discard
            </Button>
            <Button size="sm" variant="outline" onClick={() => onShelve(review.patch)} title="Keep it in Components without putting it on the timeline">
              <Archive size={13} /> Save to shelf
            </Button>
            <Button size="sm" variant="primary" onClick={() => onDone(review.patch)} title={`Place it at ${clip.startSec.toFixed(1)}s on track ${clip.track + 1}`}>
              <Check size={13} /> Apply at {clip.startSec.toFixed(1)}s
            </Button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div style={{ zIndex: Z.modal }} className="fixed inset-0 flex items-center justify-center bg-black/45 p-4 backdrop-blur-[2px]" role="dialog" aria-label={`Recording ${clip.name}`}>
      <div className="flex max-h-full w-[min(640px,94vw)] flex-col overflow-hidden rounded-2xl border border-line bg-panel shadow-2xl">
        <div className="flex items-center gap-3 border-b border-line px-4 py-2.5">
          <Loader2 size={14} className="animate-spin text-accent-text" />
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold">Recording “{clip.name}”</div>
            <div className="text-xs text-muted">
              {phase === 'loading' ? 'Loading the component…' : phase === 'finishing' ? 'Building the preview to review…' : `${meta.interact ? 'Acting it out' : 'Capturing'} · ${meta.recordSec}s of real animation · ${pct}%`}
              {remaining > 1 ? ` · ${remaining - 1} more queued` : ''}
            </div>
          </div>
          <Button size="sm" variant="ghost" onClick={() => { abortRef.current?.abort(); onCancel() }} aria-label="Stop recording">
            <X size={13} /> Stop
          </Button>
        </div>
        {/* Natural size, on screen: exactly what lands in the video. */}
        <div ref={stageRef} className="lab-canvas relative flex h-[min(400px,62vh)] w-full items-center justify-center overflow-hidden p-6">
          {generated ? (
            // Same recorder pipeline; the agent's code is a pure function of t = clock / length.
            <div className="lab-canvas grid place-items-center">
              <GeneratedFrame code={generated.code} props={meta.props} reducedMotion={Boolean(generated.calm)} t={Math.min(1, clockSec / Math.max(0.5, meta.recordSec))} />
            </div>
          ) : (
            <DemoFrame slug={meta.slug} play forceMotion props={meta.props} className="place-items-center" atSeconds={clockSec} />
          )}
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
