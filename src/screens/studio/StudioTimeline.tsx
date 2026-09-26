import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Image as ImageIcon, Layers, Music, Sparkles, Type as TypeIcon, Video } from 'lucide-react'
import type { StudioAudioClip, StudioClip, StudioDoc, StudioMediaClip } from '../../types/project'
import { MIN_CLIP_SEC, clipEnd, snapTime } from '../../lib/studio/doc'
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
}

type Drag =
  | { mode: 'move'; id: string; grabOffsetSec: number; startTrack: number; pointerStartY: number }
  | { mode: 'trim-start'; id: string; originStart: number; originDuration: number; originTrimIn: number }
  | { mode: 'trim-end'; id: string; originDuration: number }
  | { mode: 'scrub' }

function clipIcon(clip: StudioClip) {
  if (clip.kind === 'video') return Video
  if (clip.kind === 'image') return ImageIcon
  if (clip.kind === 'text') return TypeIcon
  if (clip.kind === 'overlay') return Layers
  if (clip.kind === 'glass') return Sparkles
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
              : clip.kind === 'audio'
                ? 'bg-[rgb(167_139_250/0.16)] border-[rgb(167_139_250/0.42)]'
                : 'bg-panel-alt border-line'
  return cx(base, selected && 'ring-2 ring-accent ring-offset-0')
}

/** Ruler tick spacing that stays readable at every zoom level. */
function tickStep(pps: number): number {
  if (pps >= 160) return 0.5
  if (pps >= 90) return 1
  if (pps >= 45) return 2
  if (pps >= 24) return 5
  return 10
}

export function StudioTimeline({ doc, time, pps, duration, selectedId, onSelect, onSeek, onPatchClip }: Props) {
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

      if (drag.mode === 'move') {
        const rawStart = t - drag.grabOffsetSec
        const start = snapTime(doc, rawStart, clip.id, [time], 8 / pps)
        const rowDelta = Math.round((event.clientY - drag.pointerStartY) / (ROW_H + ROW_GAP))
        const track = clamp(drag.startTrack + rowDelta, 0, doc.trackCount - 1)
        onPatchClip(clip.id, { startSec: Math.max(0, start), track })
        return
      }

      if (drag.mode === 'trim-start') {
        const maxShift = drag.originDuration - MIN_CLIP_SEC
        const snapped = snapTime(doc, t, clip.id, [time], 8 / pps)
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
      const snapped = snapTime(doc, t, clip.id, [time], 8 / pps)
      onPatchClip(clip.id, { durationSec: Math.max(MIN_CLIP_SEC, snapped - clip.startSec) })
    }

    const onUp = () => setDrag(null)
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
    }
  }, [drag, doc, onPatchClip, onSeek, pps, spanSec, time, timeAt])

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
    <div className="flex min-h-0 flex-col border-t border-line bg-panel">
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
            <div ref={laneRef} className="relative" style={{ width }} onPointerDown={() => onSelect(null)}>
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
                          onPointerDown={(e) => {
                            e.stopPropagation()
                            e.preventDefault()
                            onSelect(clip.id)
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
                            'cursor-grab active:cursor-grabbing select-none',
                            clipTint(clip, selected),
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
                          <span className="relative flex min-w-0 items-center gap-1.5">
                            <Icon size={13} className="shrink-0 opacity-80" />
                            <span className="truncate font-medium text-text">{clip.name}</span>
                          </span>
                          <span className="relative ml-auto hidden font-mono text-xs text-muted tabular-nums sm:inline">
                            {clip.durationSec.toFixed(1)}s
                          </span>

                          {/* Trim handles */}
                          <span
                            role="presentation"
                            onPointerDown={(e) => {
                              e.stopPropagation()
                              e.preventDefault()
                              onSelect(clip.id)
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
                              setDrag({ mode: 'trim-end', id: clip.id, originDuration: clip.durationSec })
                            }}
                            className="absolute inset-y-0 right-0 w-2 cursor-ew-resize bg-text/0 hover:bg-text/25"
                          />
                        </div>
                      )
                    })}
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
