import { memo, useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import { Film, GanttChart, Pause, Play, Plus, Swords } from 'lucide-react'
import { Button } from '../components/Button'
import { EmptyState } from '../components/EmptyState'
import { NoProject } from '../components/NoProject'
import { useLocalMediaUrl } from '../components/VideoPreview'
import type { TimelineClip } from '../types/project'
import { useActiveProject, useProjectStore } from '../state/useProjectStore'
import { clamp, cx, fmtClock, fmtDur, round1 } from '../lib/utils'

const PPS = 56 // px per second

type DragState = {
  id: string
  kind: 'move' | 'resize'
  startX: number
  startDur: number
  index: number
  hoverIndex: number
  dur: number
  labelX: number
  labelY: number
}

type InsertTarget = { index: number; x: number; y: number }

export function Timeline() {
  const project = useActiveProject()
  const moveTimelineClip = useProjectStore((s) => s.moveTimelineClip)
  const setClipDuration = useProjectStore((s) => s.setClipDuration)

  const [playing, setPlaying] = useState(false)
  const [t, setT] = useState(0)
  const [drag, setDrag] = useState<DragState | null>(null)
  const [insert, setInsert] = useState<InsertTarget | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  const clips = project?.timeline ?? []
  const total = clips.reduce((acc, c) => acc + c.durationSec, 0)
  /** The clip the playhead is inside — what the preview below the ruler shows. */
  const activeClip = clips.find((c) => t >= c.startSec && t < c.startSec + c.durationSec) ?? null

  // Timeline preview playback: playhead advances in real time and loops.
  useEffect(() => {
    if (!playing || total <= 0) return
    let raf = 0
    let last = performance.now()
    const step = (now: number) => {
      const dt = (now - last) / 1000
      last = now
      setT((v) => (v + dt >= total ? 0 : v + dt))
      raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [playing, total])

  useEffect(() => {
    if (t > total) setT(total)
  }, [total, t])

  if (!project) return <NoProject />

  const pid: string = project.id
  const arenaName = (id: string) => project.arenaAssets.find((a) => a.id === id)?.name ?? null
  const footageName = (id: string) => project.footageAssets.find((f) => f.id === id)?.name ?? null
  const clipName = (c: TimelineClip) =>
    (c.sourceType === 'arena' ? arenaName(c.sourceId) : footageName(c.sourceId)) ??
    (c.sourceType === 'arena' ? 'Arena asset' : 'Footage clip')

  /* ——— drag: reorder + resize (pointer capture on the clip block) ——— */

  function onPointerDown(e: React.PointerEvent, clip: TimelineClip, index: number, kind: 'move' | 'resize') {
    if (drag) return
    e.preventDefault()
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    setDrag({
      id: clip.id,
      kind,
      startX: e.clientX,
      startDur: clip.durationSec,
      index,
      hoverIndex: index,
      dur: clip.durationSec,
      labelX: e.clientX,
      labelY: e.clientY,
    })
  }

  function onPointerMove(e: React.PointerEvent) {
    if (!drag || !scrollRef.current) return
    const rect = scrollRef.current.getBoundingClientRect()
    const x = e.clientX - rect.left + scrollRef.current.scrollLeft
    if (drag.kind === 'resize') {
      const dur = clamp(round1(drag.startDur + (e.clientX - drag.startX) / PPS), 0.5, 600)
      setDrag({ ...drag, dur, labelX: e.clientX, labelY: e.clientY })
    } else {
      const others = clips.filter((c) => c.id !== drag.id)
      let acc = 0
      let idx = 0
      for (const o of others) {
        const mid = acc + (o.durationSec * PPS) / 2
        if (x >= mid) {
          idx++
          acc += o.durationSec * PPS
        } else break
      }
      setDrag({ ...drag, hoverIndex: idx, labelX: e.clientX, labelY: e.clientY })
    }
  }

  function onPointerUp() {
    if (!drag) return
    if (drag.kind === 'resize') {
      setClipDuration(pid, drag.id, drag.dur)
    } else if (drag.hoverIndex !== drag.index) {
      moveTimelineClip(pid, drag.index, drag.hoverIndex)
    }
    setDrag(null)
  }

  /* ——— display order while dragging ——— */

  // Stable forwarders to the latest pointer handlers (keeps memoised clips still).
  const handlers = useRef({ onPointerDown, onPointerMove, onPointerUp })
  handlers.current = { onPointerDown, onPointerMove, onPointerUp }
  const clipActions = useMemo<TimelineClipActions>(() => ({
    down: (e, clip, index, kind) => handlers.current.onPointerDown(e, clip, index, kind),
    move: (e) => handlers.current.onPointerMove(e),
    up: () => handlers.current.onPointerUp(),
  }), [])

  const display: { clip: TimelineClip; originalIndex: number }[] = useMemo(() => {
    const withIdx = clips.map((clip, originalIndex) => ({ clip, originalIndex }))
    if (!drag || drag.kind !== 'move') return withIdx
    const others = withIdx.filter((w) => w.clip.id !== drag.id)
    const dragged = withIdx.find((w) => w.clip.id === drag.id)!
    others.splice(clamp(drag.hoverIndex, 0, others.length), 0, dragged)
    return others
  }, [clips, drag])

  function seek(e: React.MouseEvent<HTMLDivElement>) {
    if (!scrollRef.current) return
    const rect = scrollRef.current.getBoundingClientRect()
    const x = e.clientX - rect.left + scrollRef.current.scrollLeft
    setT(clamp(round1(x / PPS), 0, total))
  }

  return (
    <div className="flex h-full flex-col gap-4 px-6 py-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-bold">Timeline</h1>
          <div className="text-sm tabular-nums text-muted">
            Total {fmtDur(total)} · {clips.length} clip{clips.length === 1 ? '' : 's'}
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span className="font-mono text-sm tabular-nums text-muted">
            {fmtClock(Math.min(t, total))} <span className="text-muted/50">/ {fmtClock(total)}</span>
          </span>
          <Button
            variant="primary"
            size="sm"
            className="w-9 p-0"
            disabled={clips.length === 0} title={(clips.length === 0) ? 'Add a clip first' : undefined}
            aria-label={playing ? 'Pause' : 'Play'}
            onClick={() => setPlaying((p) => !p)}
          >
            {playing ? <Pause size={15} /> : <Play size={15} className="translate-x-px" />}
          </Button>
        </div>
      </div>

      {clips.length > 0 && (
        <TimelinePreview
          clip={activeClip}
          inClipSec={activeClip ? Math.max(0, t - activeClip.startSec) : 0}
          name={activeClip ? clipName(activeClip) : null}
          onOpen={(view) => useProjectStore.getState().setView(view)}
        />
      )}

      {clips.length === 0 ? (
        <EmptyState
          icon={GanttChart}
          title="Timeline is empty"
          hint="Insert Arena or Footage assets with the + controls — or apply a footage edit first."
          action={
            <Button size="sm" variant="primary" onClick={() => useProjectStore.getState().setView('footage')}>
              Open Footage Desk
            </Button>
          }
          className="flex-1"
        />
      ) : (
        <div
          ref={scrollRef}
          className="min-h-0 flex-1 overflow-x-auto overflow-y-hidden rounded-xl border border-line bg-panel/40"
        >
          <div className="relative" style={{ width: Math.max(total * PPS + 160, 0), minWidth: '100%' }}>
            {/* Ruler */}
            <div className="relative h-7 border-b border-line" onClick={seek} aria-label="Seek" role="slider" aria-valuenow={Math.round(t)} aria-valuemin={0} aria-valuemax={Math.round(total)} tabIndex={-1}>
              {Array.from({ length: Math.ceil(total) + 1 }, (_, i) => (
                <div key={i} className="absolute top-0 h-2 w-px bg-line" style={{ left: i * PPS }} />
              ))}
              {Array.from({ length: Math.floor(total / 5) + 1 }, (_, i) => (
                <span
                  key={i}
                  className="absolute top-2.5 -translate-x-1/2 font-mono text-xs tabular-nums text-muted"
                  style={{ left: i * 5 * PPS }}
                >
                  {i * 5}s
                </span>
              ))}
            </div>

            {/* Track */}
            <div className="relative flex h-24 items-stretch py-2" style={{ touchAction: 'none' }}>
              <InsertButton index={0} onOpen={setInsert} />
              {display.map(({ clip, originalIndex }) => (
                <div key={clip.id} className="flex items-stretch">
                  <TimelineClipBlock
                    clip={clip}
                    index={originalIndex}
                    dragKind={drag?.id === clip.id ? drag.kind : null}
                    shownDur={drag?.id === clip.id && drag.kind === 'resize' ? drag.dur : clip.durationSec}
                    projectId={project.id}
                    name={clipName(clip)}
                    actions={clipActions}
                  />
                  <InsertButton index={originalIndex + 1} onOpen={setInsert} />
                </div>
              ))}

              {/* Playhead */}
              {total > 0 && (
                <div className="pointer-events-none absolute bottom-0 top-7 z-20 w-px bg-text/80" style={{ left: Math.min(t, total) * PPS }}>
                  <div className="absolute -left-[5px] top-0 h-0 w-0 border-x-[5px] border-t-[7px] border-x-transparent border-t-text/80" />
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Floating duration label while resizing */}
      {drag?.kind === 'resize' && (
        <div
          className="pointer-events-none fixed z-50 -translate-x-1/2 -translate-y-[calc(100%+12px)] rounded-md border border-line bg-panel-alt px-2 py-1 font-mono text-xs tabular-nums text-accent-text"
          style={{ left: drag.labelX, top: drag.labelY }}
        >
          {drag.dur.toFixed(1)}s
        </div>
      )}

      {/* Insert popover (fixed so it escapes the scroll container) */}
      {insert && (
        <InsertPopover
          target={insert}
          onClose={() => setInsert(null)}
          onPick={(sourceType, sourceId, dur) => {
            useProjectStore.getState().addTimelineClip(project.id, { sourceType, sourceId, durationSec: dur }, insert.index)
            setInsert(null)
          }}
        />
      )}
    </div>
  )
}

/** Extensions a <video> element can actually decode. Anything else is not a film. */
const PLAYABLE = /\.(mp4|webm|m4v|mov|ogv|ogg)$/i

/**
 * What the strip points at, at the playhead.
 *
 * The Timeline is the project-level sequence of Arena pieces and footage clips
 * — a different model from the Studio document — so this is not the compositor:
 * it shows the *source* the render queue will use, seeked to the right place,
 * which is what the strip has always promised and never shown. A clip with no
 * file (not uploaded/imported yet) or an Arena HTML piece says so and offers the
 * screen that can do something about it, instead of a black rectangle.
 */
function TimelinePreview({
  clip,
  inClipSec,
  name,
  onOpen,
}: {
  clip: TimelineClip | null
  inClipSec: number
  name: string | null
  onOpen: (view: 'footage' | 'arena') => void
}) {
  const project = useActiveProject()
  const asset =
    clip?.sourceType === 'footage'
      ? project?.footageAssets.find((f) => f.id === clip.sourceId) ?? null
      : clip?.sourceType === 'arena'
        ? project?.arenaAssets.find((a) => a.id === clip.sourceId) ?? null
        : null
  const path = asset?.localPath ?? null
  const playable = Boolean(path && PLAYABLE.test(path) && clip?.sourceType === 'footage')
  const { url, error, loading } = useLocalMediaUrl(playable ? path : null)
  const videoRef = useRef<HTMLVideoElement>(null)
  // A file that opens but will not decode (corrupt, or a codec the machine has
  // no decoder for) is a real failure and has to be shown, not swallowed.
  const [decodeError, setDecodeError] = useState<string | null>(null)
  useEffect(() => setDecodeError(null), [url])

  // Follow the playhead: seek only when it has moved enough to matter, so a
  // 60 Hz playhead does not thrash the decoder.
  useEffect(() => {
    const el = videoRef.current
    if (!el || !url) return
    const want = Math.max(0, inClipSec)
    if (Number.isFinite(el.duration) && el.duration > 0) {
      el.currentTime = Math.min(want, Math.max(0, el.duration - 0.05))
      return
    }
    if (Math.abs(el.currentTime - want) > 0.15) el.currentTime = want
  }, [url, inClipSec])

  let body: ReactElement
  if (!clip) {
    body = <p className="text-xs text-muted">No clip under the playhead — scrub onto a clip to see its source here.</p>
  } else if (!asset) {
    body = (
      <p className="text-xs text-muted">
        This clip points at an asset that is no longer in the project, so there is nothing to show. Remove it from the strip or re-insert the asset.
      </p>
    )
  } else if (clip.sourceType === 'arena') {
    body = (
      <div className="flex flex-wrap items-center gap-3">
        <p className="text-xs text-muted">
          Arena pieces are generated HTML, not a video file, so there is no still to seek through. Render it from Arena Desk to get a video you can scrub here.
        </p>
        <Button size="sm" onClick={() => onOpen('arena')}>Open Arena Desk</Button>
      </div>
    )
  } else if (!path) {
    body = (
      <div className="flex flex-wrap items-center gap-3">
        <p className="text-xs text-muted">“{name}” has no local file yet — upload it in Footage Desk to preview and render it.</p>
        <Button size="sm" onClick={() => onOpen('footage')}>Open Footage Desk</Button>
      </div>
    )
  } else if (error || decodeError) {
    body = <p className="text-xs text-danger">{error ?? decodeError}</p>
  } else if (loading || !url) {
    body = <p className="text-xs text-muted">Opening {name}…</p>
  } else {
    body = (
      <video
        ref={videoRef}
        src={url}
        muted
        playsInline
        preload="metadata"
        className="max-h-52 w-full rounded-lg bg-black object-contain"
        aria-label={`Source preview of ${name ?? 'the selected clip'}`}
        onLoadedMetadata={() => {
          const el = videoRef.current
          if (el) el.currentTime = Math.max(0, Math.min(inClipSec, Math.max(0, el.duration - 0.05)))
        }}
        onError={() => setDecodeError(`${name ?? 'This file'} could not be decoded here. If it plays in another player, the codec is not available on this machine.`)}
      />
    )
  }

  return (
    <div className="rounded-xl border border-line bg-panel/40 p-3">
      <div className="mb-2 flex items-center justify-between gap-2 text-xs text-muted">
        <span className="truncate">{clip ? `${name} · ${clip.sourceType}` : 'Preview'}</span>
        {clip && <span className="font-mono tabular-nums">{inClipSec.toFixed(1)}s in clip</span>}
      </div>
      {body}
    </div>
  )
}

function InsertButton({ index, onOpen }: { index: number; onOpen: (t: InsertTarget) => void }) {
  return (
    <button
      type="button"
      aria-label={`Insert asset at position ${index + 1}`}
      onClick={(e) => {
        const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
        onOpen({ index, x: r.left, y: r.bottom })
      }}
      className="mx-0.5 my-auto flex h-6 w-6 shrink-0 items-center justify-center self-center rounded-md border border-dashed border-line text-muted transition-colors duration-150 hover:border-accent/60 hover:text-accent-text active:scale-[0.96]"
    >
      <Plus size={12} />
    </button>
  )
}

function InsertPopover({
  target,
  onClose,
  onPick,
}: {
  target: InsertTarget
  onClose: () => void
  onPick: (sourceType: 'arena' | 'footage', sourceId: string, dur: number) => void
}) {
  const project = useActiveProject()
  const overlayRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const arena = project?.arenaAssets ?? []
  const footage = project?.footageAssets ?? []
  const empty = arena.length === 0 && footage.length === 0

  const x = Math.min(target.x, window.innerWidth - 292)
  const y = Math.min(target.y, window.innerHeight - 260)

  return (
    <>
      <div ref={overlayRef} className="fixed inset-0 z-40" onClick={onClose} aria-hidden />
      <div
        role="menu"
        aria-label="Insert asset"
        className="fixed z-50 w-72 rounded-xl border border-line bg-panel-alt p-2"
        style={{ left: x, top: y + 6 }}
      >
        <div className="px-2 py-1.5 text-xs font-semibold uppercase tracking-wider text-muted">Insert asset</div>
        {empty && <div className="px-2 py-3 text-xs text-muted">Everything is already on the timeline.</div>}
        {arena.length > 0 && (
          <>
            <div className="px-2 pb-1 pt-1 text-xs text-muted">Arena</div>
            {arena.map((a) => (
              <button
                key={a.id}
                type="button"
                role="menuitem"
                onClick={() => onPick('arena', a.id, project?.brief.lockedRundown?.durationSec ?? 4)}
                className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors duration-150 hover:bg-panel"
              >
                <Swords size={13} className="text-accent-text" />
                <span className="min-w-0 flex-1 truncate text-xs font-medium">{a.name}</span>
                <span className="font-mono text-xs tabular-nums text-muted">{fmtDur(project?.brief.lockedRundown?.durationSec ?? 4)}</span>
                <Plus size={12} className="text-muted" />
              </button>
            ))}
          </>
        )}
        {footage.length > 0 && (
          <>
            <div className="px-2 pb-1 pt-1 text-xs text-muted">Footage</div>
            {footage.map((f) => (
              <button
                key={f.id}
                type="button"
                role="menuitem"
                onClick={() => onPick('footage', f.id, f.durationSec)}
                className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors duration-150 hover:bg-panel"
              >
                <Film size={13} className="text-info" />
                <span className="min-w-0 flex-1 truncate text-xs font-medium">{f.name}</span>
                <span className="font-mono text-xs tabular-nums text-muted">{fmtDur(f.durationSec)}</span>
                <Plus size={12} className="text-muted" />
              </button>
            ))}
          </>
        )}
      </div>
    </>
  )
}


type TimelineClipActions = {
  down: (e: React.PointerEvent, clip: TimelineClip, index: number, kind: 'move' | 'resize') => void
  move: (e: React.PointerEvent) => void
  up: () => void
}

/** One timeline clip, memoised so playback ticks do not re-render every block. */
const TimelineClipBlock = memo(function TimelineClipBlock({ clip, index, dragKind, shownDur, projectId, name, actions }: { clip: TimelineClip; name: string; index: number; dragKind: 'move' | 'resize' | null; shownDur: number; projectId: string; actions: TimelineClipActions }) {
  const isDragging = dragKind === 'move'
  const isArena = clip.sourceType === 'arena'
  return (
                  <div
    role="button"
                    tabIndex={0}
                    aria-label={`${isArena ? 'Arena' : 'Footage'} clip: ${name}, ${fmtDur(shownDur)}. Drag to reorder, drag right edge to resize.`}
                    onPointerDown={(e) => {
                      if ((e.target as HTMLElement).dataset.handle) return
                      actions.down(e, clip, index, 'move')
                    }}
                    onPointerMove={actions.move}
                    onPointerUp={actions.up}
                    onKeyDown={(e) => {
                      if (e.key === 'Backspace' || e.key === 'Delete') {
                        useProjectStore.getState().removeTimelineClip(projectId, clip.id)
                      }
                    }}
                    className={cx(
                      'group relative select-none rounded-lg border',
                      isArena ? 'border-accent/40 bg-accent/10' : 'border-info/40 bg-info/10',
                      isDragging ? 'z-10 cursor-grabbing opacity-90 ring-2 ring-accent/60' : 'cursor-grab',
                    )}
                    style={{ width: shownDur * PPS }}
                  >
                    <div className="pointer-events-none flex h-full flex-col justify-between p-2">
                      <div className="min-w-0">
                        <div className={cx('truncate text-xs font-semibold', isArena ? 'text-accent-text' : 'text-info')}>
                          {name}
                        </div>
                        <div className="text-xs tabular-nums text-muted">{fmtDur(shownDur)}</div>
                      </div>
                      <div className="flex items-center gap-1 text-xs text-muted">
                        {isArena ? <Swords size={10} /> : <Film size={10} />}
                        {clip.sourceType}
                      </div>
                    </div>
                    <div
                      data-handle="1"
                      onPointerDown={(e) => {
                        e.stopPropagation()
                        actions.down(e, clip, index, 'resize')
                      }}
                      onPointerMove={actions.move}
                      onPointerUp={actions.up}
                      className="absolute inset-y-0 right-0 w-2.5 cursor-ew-resize rounded-r-lg transition-colors duration-150 group-hover:bg-white/10"
                      aria-label="Resize clip duration"
                      role="separator"
                    />
                  </div>
  )
})
