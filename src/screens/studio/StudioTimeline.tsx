import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, ChevronUp, Image as ImageIcon, Layers, Music, Sparkles, Sticker, SlidersHorizontal, Type as TypeIcon, Video, Lock, EyeOff, VolumeX , Shapes, MousePointerClick, Loader as LoaderIcon } from 'lucide-react'
import type { StudioAudioClip, StudioClip, StudioDoc, StudioMediaClip } from '../../types/project'
import { MAX_TRACKS, MIN_CLIP_SEC, clipEnd, snapTime } from '../../lib/studio/doc'
import { markerTimes } from '../../lib/studio/timelineOps'
import { moveKeyframeTime } from '../../lib/studio/keyframeEdit'
import { getMedia } from '../../lib/studio/media'
import { clamp, cx, fmtClock } from '../../lib/utils'

const ROW_H = 56
const ROW_GAP = 6
const HEADER_W = 84

type Props = {
  doc: StudioDoc
  time: number
  pps: number
  duration: number
  selectedId: string | null
  onSelect: (id: string | null) => void
  onSeek: (t: number) => void
  onPatchClip: (id: string, patch: Partial<StudioClip>) => void
  onReorderTrack: (from: number, to: number) => void
  onSettleClip?: (id: string) => void
  /** 2.10 — a file or resource dropped on a lane, at the pointer's time and track. */
  onDropAt?: (data: DataTransfer, sec: number, track: number) => void
  /** Right-click on a clip: open the clip context menu at the pointer. */
  onClipContextMenu?: (clipId: string, x: number, y: number) => void
}

type Drag =
  | { mode: 'move'; id: string; grabOffsetSec: number; startTrack: number; pointerStartY: number }
  | { mode: 'trim-start'; id: string; originStart: number; originDuration: number; originTrimIn: number }
  | { mode: 'trim-end'; id: string; originDuration: number }
  | { mode: 'keyframe'; id: string; index: number }
  | { mode: 'scrub' }

function clipIcon(clip: StudioClip) {
  if (clip.kind === 'video') return Video
  if (clip.kind === 'image') return ImageIcon
  if (clip.kind === 'text') return TypeIcon
  if (clip.kind === 'overlay') return Layers
  if (clip.kind === 'glass') return Sparkles
  if (clip.kind === 'sticker') return Sticker
  if (clip.kind === 'shape') return Shapes
  if (clip.kind === 'cursor') return MousePointerClick
  if (clip.kind === 'loader') return LoaderIcon
  if (clip.kind === 'adjustment') return SlidersHorizontal
  return Music
}

function clipTint(clip: StudioClip, selected: boolean): string {
  const base =
    clip.kind === 'text'
      ? 'bg-accent/18 border-accent/45'
      : clip.kind === 'video'
        ? 'bg-info/18 border-info/45'
        : clip.kind === 'image'
          ? 'bg-info/12 border-info/30'
          : clip.kind === 'overlay'
            ? 'bg-[rgb(226_75_74/0.14)] border-[rgb(226_75_74/0.38)]'
            : clip.kind === 'glass'
              ? 'bg-[rgb(255_255_255/0.10)] border-[rgb(255_255_255/0.32)] backdrop-blur-sm'
              : clip.kind === 'shape'
                ? 'bg-[rgb(200_245_66/0.10)] border-[rgb(200_245_66/0.34)]'
              : clip.kind === 'cursor' || clip.kind === 'loader'
                ? 'bg-[rgb(79_182_232/0.12)] border-[rgb(79_182_232/0.40)]'
              : clip.kind === 'adjustment'
                ? 'bg-[rgb(255_196_92/0.14)] border-[rgb(255_196_92/0.42)]'
              : clip.kind === 'sticker'
                ? 'bg-[rgb(255_196_92/0.16)] border-[rgb(255_196_92/0.44)]'
                : clip.kind === 'audio'
                ? 'bg-[rgb(167_139_250/0.16)] border-[rgb(167_139_250/0.42)]'
                : 'bg-panel-alt border-line'
  return cx(base, selected && 'ring-2 ring-accent ring-offset-0')
}

function AudioWaveform({ clip }: { clip: StudioAudioClip }) {
  const samples = getMedia(clip.mediaId)?.waveform ?? []
  if (!samples.length) return null
  const step = samples.length > 96 ? Math.ceil(samples.length / 96) : 1
  const visible = samples.filter((_, index) => index % step === 0)
  return (
    <svg className="pointer-events-none absolute inset-0 h-full w-full opacity-55" viewBox="0 0 100 40" preserveAspectRatio="none" aria-hidden>
      {visible.map((sample, index) => {
        const x = ((index + 0.5) / visible.length) * 100
        const half = Math.max(1, Math.min(18, sample * 18))
        return <line key={index} x1={x} x2={x} y1={20 - half} y2={20 + half} stroke="currentColor" strokeWidth={Math.max(0.35, 70 / visible.length)} />
      })}
    </svg>
  )
}

/** Ruler tick spacing that stays readable at every zoom level. */
function tickStep(pps: number): number {
  if (pps >= 160) return 0.5
  if (pps >= 90) return 1
  if (pps >= 45) return 2
  if (pps >= 24) return 5
  return 10
}

export function StudioTimeline({ doc, time, pps, duration, selectedId, onSelect, onSeek, onPatchClip, onReorderTrack, onSettleClip, onDropAt, onClipContextMenu }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const laneRef = useRef<HTMLDivElement>(null)
  const [drag, setDrag] = useState<Drag | null>(null)

  const spanSec = Math.max(duration + 4, 12)
  const width = spanSec * pps
  const step = tickStep(pps)

  const ticks = useMemo(() => {
    const out: number[] = []
    for (let t = 0; t <= spanSec; t += step) out.push(Math.round(t * 10) / 10)
    return out
  }, [spanSec, step])

  const timeAt = useCallback(
    (clientX: number): number => {
      const lane = laneRef.current
      if (!lane) return 0
      const rect = lane.getBoundingClientRect()
      return Math.max(0, (clientX - rect.left) / pps)
    },
    [pps],
  )

  // Pointer handling lives on the window so a fast drag never "sticks" when
  // the cursor leaves the lane.
  useEffect(() => {
    if (!drag) return

    const onMove = (event: PointerEvent) => {
      const t = timeAt(event.clientX)
      if (drag.mode === 'scrub') {
        onSeek(Math.min(t, spanSec))
        return
      }
      const clip = doc.clips.find((c) => c.id === drag.id)
      if (!clip) return

      if (drag.mode === 'keyframe') {
        const keys = clip.keyframes ?? []
        const nextKeys = moveKeyframeTime(keys, drag.index, t - clip.startSec, clip.durationSec, doc.fps)
        onPatchClip(clip.id, { keyframes: nextKeys })
        onSeek(clip.startSec + (nextKeys[drag.index]?.at ?? 0))
        return
      }

      if (drag.mode === 'move') {
        const rawStart = t - drag.grabOffsetSec
        const start = snapTime(doc, rawStart, clip.id, [time, ...markerTimes(doc)], 8 / pps)
        // Rows are drawn top layer first, so dragging DOWN means a LOWER track.
        // Dragging above the top row opens a new layer.
        const rowDelta = Math.round((event.clientY - drag.pointerStartY) / (ROW_H + ROW_GAP))
        const track = clamp(drag.startTrack - rowDelta, 0, Math.min(MAX_TRACKS - 1, doc.trackCount))
        onPatchClip(clip.id, { startSec: Math.max(0, start), track })
        return
      }

      if (drag.mode === 'trim-start') {
        const maxShift = drag.originDuration - MIN_CLIP_SEC
        const snapped = snapTime(doc, t, clip.id, [time, ...markerTimes(doc)], 8 / pps)
        const shift = clamp(snapped - drag.originStart, -drag.originStart, maxShift)
        const patch: Partial<StudioClip> = {
          startSec: drag.originStart + shift,
          durationSec: drag.originDuration - shift,
        }
        // Trimming the head of a media OR audio clip must move the source
        // in-point too, otherwise dragging the left edge of a music bed just
        // deletes the start of the song instead of sliding into it.
        if (clip.kind === 'video' || clip.kind === 'audio') {
          const speed = clip.kind === 'video' ? (clip as StudioMediaClip).speed || 1 : 1
          ;(patch as Partial<StudioMediaClip>).trimInSec = Math.max(0, drag.originTrimIn + shift * speed)
        }
        onPatchClip(clip.id, patch)
        return
      }

      // trim-end
      const snapped = snapTime(doc, t, clip.id, [time, ...markerTimes(doc)], 8 / pps)
      onPatchClip(clip.id, { durationSec: Math.max(MIN_CLIP_SEC, snapped - clip.startSec) })
    }

    const onUp = () => {
      // A drop that lands on another clip is lifted onto a free layer.
      if (drag.mode === 'move' || drag.mode === 'trim-end' || drag.mode === 'trim-start') onSettleClip?.(drag.id)
      setDrag(null)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
    }
  }, [drag, doc, onPatchClip, onSettleClip, onSeek, pps, spanSec, time, timeAt])

  // Keep the playhead in view while playing.
  useEffect(() => {
    const scroller = scrollRef.current
    if (!scroller) return
    const x = time * pps
    const left = scroller.scrollLeft
    const right = left + scroller.clientWidth - HEADER_W
    if (x < left || x > right - 40) scroller.scrollLeft = Math.max(0, x - scroller.clientWidth / 2)
  }, [time, pps])

  const tracks = Array.from({ length: doc.trackCount }, (_, i) => i).reverse()

  return (
    <div className="flex h-full min-h-0 flex-col border-t border-line bg-panel">
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-x-auto overflow-y-auto">
        <div className="relative flex" style={{ minWidth: width + HEADER_W }}>
          {/* Track labels */}
          <div className="sticky left-0 z-20 shrink-0 bg-panel" style={{ width: HEADER_W }}>
            <div className="h-7 border-b border-line" />
            {tracks.map((track) => (
              <div
                key={track}
                className="flex items-center justify-between border-b border-line/60 px-3 font-mono text-xs text-muted"
                style={{ height: ROW_H + ROW_GAP }}
              >
                <span>T{track + 1}</span>
                <span className="flex items-center" aria-label={`Reorder track ${track + 1}`}>
                  <button
                    type="button"
                    title="Move track up (raise layer)"
                    aria-label={`Move track ${track + 1} up`}
                    disabled={track >= doc.trackCount - 1}
                    onClick={() => onReorderTrack(track, track + 1)}
                    className="rounded p-0.5 hover:bg-panel-alt hover:text-text disabled:cursor-not-allowed disabled:opacity-25"
                  >
                    <ChevronUp size={12} />
                  </button>
                  <button
                    type="button"
                    title="Move track down (lower layer)"
                    aria-label={`Move track ${track + 1} down`}
                    disabled={track <= 0}
                    onClick={() => onReorderTrack(track, track - 1)}
                    className="rounded p-0.5 hover:bg-panel-alt hover:text-text disabled:cursor-not-allowed disabled:opacity-25"
                  >
                    <ChevronDown size={12} />
                  </button>
                </span>
              </div>
            ))}
          </div>

          <div className="relative flex-1" style={{ width }}>
            {/* Ruler — click or drag anywhere on it to scrub */}
            <div
              role="slider"
              tabIndex={0}
              aria-label="Playhead"
              aria-valuemin={0}
              aria-valuemax={Math.round(duration * 10) / 10}
              aria-valuenow={Math.round(time * 10) / 10}
              onKeyDown={(e) => {
                if (e.key === 'ArrowLeft') onSeek(Math.max(0, time - (e.shiftKey ? 1 : 1 / doc.fps)))
                if (e.key === 'ArrowRight') onSeek(Math.min(duration, time + (e.shiftKey ? 1 : 1 / doc.fps)))
              }}
              onPointerDown={(e) => {
                e.preventDefault()
                onSeek(timeAt(e.clientX))
                setDrag({ mode: 'scrub' })
              }}
              className="relative h-7 cursor-ew-resize border-b border-line bg-panel-alt/40 select-none"
              style={{ width }}
            >
              {ticks.map((t) => (
                <div key={t} className="absolute top-0 h-full" style={{ left: t * pps }}>
                  <div className="h-2 w-px bg-line" />
                  <span className="absolute left-1 top-1.5 font-mono text-xs text-muted/70 tabular-nums">
                    {t % 1 === 0 ? `${t}s` : ''}
                  </span>
                </div>
              ))}
            </div>

            {/* Lanes */}
            <div
              ref={laneRef}
              className="relative"
              style={{ width }}
              onPointerDown={() => onSelect(null)}
              onDragOver={(e) => {
                if (!onDropAt) return
                e.preventDefault()
                e.dataTransfer.dropEffect = 'copy'
              }}
              onDrop={(e) => {
                if (!onDropAt) return
                e.preventDefault()
                e.stopPropagation()
                const rect = e.currentTarget.getBoundingClientRect()
                const row = Math.max(0, Math.min(tracks.length - 1, Math.floor((e.clientY - rect.top) / (ROW_H + ROW_GAP))))
                const at = snapTime(doc, timeAt(e.clientX), '', [time, ...markerTimes(doc)], 8 / pps)
                onDropAt(e.dataTransfer, at, tracks[row])
              }}
            >
              {tracks.map((track) => (
                <div
                  key={track}
                  className="relative border-b border-line/60"
                  style={{ height: ROW_H + ROW_GAP }}
                >
                  {doc.clips
                    .filter((clip) => clip.track === track)
                    .map((clip) => {
                      const Icon = clipIcon(clip)
                      const selected = clip.id === selectedId
                      const poster = clip.kind === 'video' || clip.kind === 'image' ? clip.posterDataUrl : null
                      return (
                        <div
                          key={clip.id}
                          role="button"
                          tabIndex={0}
                          aria-label={`${clip.name}, ${clip.startSec.toFixed(1)} to ${clipEnd(clip).toFixed(1)} seconds`}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault()
                              onSelect(clip.id)
                            }
                          }}
                          onContextMenu={(e) => {
                            if (!onClipContextMenu) return
                            e.preventDefault()
                            e.stopPropagation()
                            onClipContextMenu(clip.id, e.clientX, e.clientY)
                          }}
                          onPointerDown={(e) => {
                            if (e.button === 2) return
                            e.stopPropagation()
                            e.preventDefault()
                            onSelect(clip.id)
                            // Locked clips select but never drag.
                            if (clip.locked) return
                            setDrag({
                              mode: 'move',
                              id: clip.id,
                              grabOffsetSec: timeAt(e.clientX) - clip.startSec,
                              startTrack: clip.track,
                              pointerStartY: e.clientY,
                            })
                          }}
                          className={cx(
                            'group absolute top-[3px] flex items-center gap-2 overflow-hidden rounded-lg border px-2 text-xs',
                            clip.locked ? 'cursor-default select-none' : 'cursor-grab active:cursor-grabbing select-none',
                            clipTint(clip, selected),
                            clip.hidden && 'opacity-40 [background-image:repeating-linear-gradient(135deg,transparent_0_6px,rgb(0_0_0/0.25)_6px_12px)]',
                          )}
                          style={{
                            left: clip.startSec * pps,
                            width: Math.max(18, clip.durationSec * pps),
                            height: ROW_H,
                          }}
                        >
                          {poster && (
                            <img
                              src={poster}
                              alt=""
                              aria-hidden
                              className="pointer-events-none absolute inset-0 h-full w-full object-cover opacity-30"
                            />
                          )}
                          {clip.kind === 'audio' && <AudioWaveform clip={clip as StudioAudioClip} />}
                          <span className="relative flex min-w-0 items-center gap-1.5">
                            <Icon size={13} className="shrink-0 opacity-80" />
                            <span className="truncate font-medium text-text">{clip.name}</span>
                            {clip.locked && <Lock size={11} className="shrink-0 text-muted" aria-label="Locked" />}
                            {clip.hidden && <EyeOff size={11} className="shrink-0 text-muted" aria-label="Hidden" />}
                            {clip.muted && <VolumeX size={11} className="shrink-0 text-muted" aria-label="Muted" />}
                          </span>
                          <span className="relative ml-auto hidden font-mono text-xs text-muted tabular-nums sm:inline">
                            {clip.durationSec.toFixed(1)}s
                          </span>

                          {selected && (clip.keyframes ?? []).map((keyframe, index) => (
                            <button
                              key={`${keyframe.at}-${index}`}
                              type="button"
                              title={`Keyframe at ${keyframe.at.toFixed(2)}s — drag to retime`}
                              aria-label={`Keyframe ${index + 1} at ${keyframe.at.toFixed(2)} seconds`}
                              onPointerDown={(event) => {
                                event.stopPropagation()
                                event.preventDefault()
                                onSelect(clip.id)
                                onSeek(clip.startSec + keyframe.at)
                                setDrag({ mode: 'keyframe', id: clip.id, index })
                              }}
                              className="absolute bottom-1 z-10 h-2.5 w-2.5 -translate-x-1/2 rotate-45 cursor-ew-resize border border-accent-ink bg-accent shadow-sm"
                              style={{ left: `${clamp(keyframe.at / clip.durationSec, 0, 1) * 100}%` }}
                            />
                          ))}

                          {/* Trim handles */}
                          <span
                            role="presentation"
                            onPointerDown={(e) => {
                              e.stopPropagation()
                              e.preventDefault()
                              onSelect(clip.id)
                              if (clip.locked) return
                              setDrag({
                                mode: 'trim-start',
                                id: clip.id,
                                originStart: clip.startSec,
                                originDuration: clip.durationSec,
                                originTrimIn:
                                  clip.kind === 'video' || clip.kind === 'audio'
                                    ? (clip as StudioMediaClip | StudioAudioClip).trimInSec
                                    : 0,
                              })
                            }}
                            className="absolute inset-y-0 left-0 w-2 cursor-ew-resize bg-text/0 hover:bg-text/25"
                          />
                          <span
                            role="presentation"
                            onPointerDown={(e) => {
                              e.stopPropagation()
                              e.preventDefault()
                              onSelect(clip.id)
                              if (clip.locked) return
                              setDrag({ mode: 'trim-end', id: clip.id, originDuration: clip.durationSec })
                            }}
                            className="absolute inset-y-0 right-0 w-2 cursor-ew-resize bg-text/0 hover:bg-text/25"
                          />
                        </div>
                      )
                    })}
                </div>
              ))}

              {/* Markers (2.7): M drops one, ; and ' jump between them, clips snap to them. */}
              {(doc.markers ?? []).map((m) => (
                <div key={m.id} className="pointer-events-none absolute -top-7 bottom-0 z-[9] w-px bg-info/70" style={{ left: m.at * pps }} title={`${m.label} · ${m.at.toFixed(2)}s`}>
                  <span className="absolute -left-[5px] top-0 h-2.5 w-2.5 rotate-45 rounded-[2px] bg-info" aria-label={`Marker ${m.label}`} />
                </div>
              ))}

              {/* Playhead */}
              <div
                className="pointer-events-none absolute -top-7 bottom-0 z-10 w-px bg-accent"
                style={{ left: time * pps }}
              >
                <span className="absolute -left-[13px] top-0 rounded-sm bg-accent px-1 font-mono text-xs text-accent-ink tabular-nums">
                  {fmtClock(time)}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
