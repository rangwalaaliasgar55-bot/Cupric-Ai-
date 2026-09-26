import { useEffect, useRef } from 'react'
import type { StudioDoc, StudioMediaClip } from '../../types/project'
import { clipEnd, previewSizeForAspect, sourceTimeFor } from '../../lib/studio/doc'
import { getMedia } from '../../lib/studio/media'
import { drawStudioFrame, registrySources } from '../../lib/studio/renderer'

type Props = {
  doc: StudioDoc
  time: number
  playing: boolean
  muted: boolean
  /** Called ~every frame while playing so the parent owns the clock. */
  onTimeChange: (t: number) => void
  duration: number
  onEnded: () => void
}

/**
 * The canvas the edit is drawn on.
 *
 * Playback is wall-clock driven and video elements are nudged into place, so
 * scrubbing, playing and exporting all go through `drawStudioFrame`.
 */
export function StudioPreview({ doc, time, playing, muted, onTimeChange, duration, onEnded }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const timeRef = useRef(time)
  timeRef.current = time

  const [width, height] = previewSizeForAspect(doc.aspect)

  // Keep video elements aligned with the timeline, then paint one frame.
  function syncAndDraw(t: number, isPlaying: boolean) {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return

    for (const clip of doc.clips) {
      if (clip.kind !== 'video') continue
      const media = clip as StudioMediaClip
      const el = getMedia(media.mediaId)?.element
      if (!(el instanceof HTMLVideoElement)) continue
      const active = t >= media.startSec && t < clipEnd(media)
      el.muted = muted || media.volume <= 0
      el.volume = Math.min(1, Math.max(0, media.volume))
      el.playbackRate = media.speed > 0 ? media.speed : 1
      if (active) {
        const want = sourceTimeFor(media, t)
        if (Math.abs(el.currentTime - want) > (isPlaying ? 0.28 : 0.03)) el.currentTime = want
        if (isPlaying && el.paused) void el.play().catch(() => undefined)
        if (!isPlaying && !el.paused) el.pause()
      } else if (!el.paused) {
        el.pause()
      }
    }

    drawStudioFrame(ctx, doc, t, canvas.width, canvas.height, registrySources)
  }

  // Paused: redraw whenever the document or the playhead changes.
  useEffect(() => {
    if (playing) return
    syncAndDraw(time, false)
    // Overlay images decode asynchronously; repaint shortly after so a newly
    // added lab overlay appears without the user having to scrub.
    const retry = window.setTimeout(() => syncAndDraw(timeRef.current, false), 160)
    return () => window.clearTimeout(retry)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc, time, playing, muted, width, height])

  // Playing: one rAF loop owns the clock.
  useEffect(() => {
    if (!playing) return
    let raf = 0
    let last = performance.now()
    const step = (now: number) => {
      const dt = (now - last) / 1000
      last = now
      const next = timeRef.current + dt
      if (next >= duration) {
        syncAndDraw(duration, false)
        onEnded()
        return
      }
      timeRef.current = next
      onTimeChange(next)
      syncAndDraw(next, true)
      raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => {
      cancelAnimationFrame(raf)
      for (const clip of doc.clips) {
        if (clip.kind !== 'video') continue
        const el = getMedia((clip as StudioMediaClip).mediaId)?.element
        if (el instanceof HTMLVideoElement && !el.paused) el.pause()
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, duration, doc])

  return (
    <div
      className="relative mx-auto flex h-full max-h-full items-center justify-center"
      style={{ aspectRatio: `${width} / ${height}` }}
    >
      <canvas
        ref={canvasRef}
        width={width}
        height={height}
        aria-label="Studio preview"
        className="h-full w-full rounded-xl border border-line bg-black object-contain shadow-[0_12px_32px_rgb(0_0_0/0.36)]"
      />
    </div>
  )
}
