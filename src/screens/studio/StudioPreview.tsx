import { useEffect, useRef, useState } from 'react'
import type {
  StudioAudioClip,
  StudioClip,
  StudioDoc,
  StudioGlassClip,
  StudioMediaClip,
  StudioOverlayClip,
  StudioTextClip,
} from '../../types/project'
import { audioGainAt, clipEnd, previewSizeForAspect, sourceTimeFor } from '../../lib/studio/doc'
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
  /** Selected clip, for the transform handles. */
  selected?: StudioClip | null
  onPatchSelected?: (patch: Partial<StudioClip>) => void
}

/**
 * The canvas the edit is drawn on.
 *
 * Playback is wall-clock driven and video elements are nudged into place, so
 * scrubbing, playing and exporting all go through `drawStudioFrame`.
 */
export function StudioPreview({
  doc,
  time,
  playing,
  muted,
  onTimeChange,
  duration,
  onEnded,
  selected = null,
  onPatchSelected,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const frameRef = useRef<HTMLDivElement>(null)
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

    // Audio clips paint nothing, so they are driven here rather than in the
    // renderer: seek, gain (master × fades) and play/pause follow the playhead
    // exactly like video does.
    for (const clip of doc.clips) {
      if (clip.kind !== 'audio') continue
      const audio = clip as StudioAudioClip
      const el = getMedia(audio.mediaId)?.element
      if (!(el instanceof HTMLAudioElement)) continue
      const active = t >= audio.startSec && t < clipEnd(audio)
      el.volume = muted ? 0 : audioGainAt(audio, t)
      el.muted = muted || el.volume <= 0
      if (active && isPlaying) {
        const want = sourceTimeFor(audio, t)
        if (Math.abs(el.currentTime - want) > 0.3) el.currentTime = want
        if (el.paused) void el.play().catch(() => undefined)
      } else if (!el.paused) {
        el.pause()
        // Scrubbing while paused should still land the head in the right place,
        // so the next play starts from the scrubbed position, not the old one.
        if (active) el.currentTime = sourceTimeFor(audio, t)
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
        if (clip.kind !== 'video' && clip.kind !== 'audio') continue
        const el = getMedia((clip as StudioMediaClip | StudioAudioClip).mediaId)?.element
        if (el instanceof HTMLMediaElement && !el.paused) el.pause()
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, duration, doc])

  return (
    <div
      ref={frameRef}
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
      {!playing && selected && onPatchSelected && (
        <TransformHandles clip={selected} time={time} frame={frameRef} onPatch={onPatchSelected} />
      )}
    </div>
  )
}

/* ————————————————————————————————————————————————————————————————
 * Transform handles
 *
 * CapCut rule: the canvas is for *placement only*. Dragging moves the layer,
 * a corner handle scales it, and everything else — the words, the colour, the
 * animation — is edited in the inspector. So this overlay deliberately exposes
 * no text caret and no content affordance at all.
 * ———————————————————————————————————————————————————————————————— */

type Box = { x: number; y: number; w: number; h: number }

/** Normalised (0–1) box for the clips that have a position on the stage. */
function boxOf(clip: StudioClip): Box | null {
  if (clip.kind === 'text') {
    const text = clip as StudioTextClip
    // Text has no stored size, only a font size, so the box is an estimate of
    // the painted line — good enough to grab, and it never drives the render.
    const h = (text.fontSizePct / 100) * 1.5
    return { x: text.x, y: text.y, w: Math.min(0.92, Math.max(0.3, text.text.length * text.fontSizePct * 0.006)), h }
  }
  if (clip.kind === 'overlay') {
    const overlay = clip as StudioOverlayClip
    return { x: overlay.x, y: overlay.y, w: 0.5 * overlay.scale, h: 0.32 * overlay.scale }
  }
  if (clip.kind === 'glass') {
    const glass = clip as StudioGlassClip
    return { x: glass.x, y: glass.y, w: glass.w, h: glass.h }
  }
  return null
}

function TransformHandles({
  clip,
  time,
  frame,
  onPatch,
}: {
  clip: StudioClip
  time: number
  frame: React.RefObject<HTMLDivElement | null>
  onPatch: (patch: Partial<StudioClip>) => void
}) {
  const [drag, setDrag] = useState<{ mode: 'move' | 'scale'; startX: number; startY: number; box: Box } | null>(null)
  const active = time >= clip.startSec && time < clip.startSec + clip.durationSec
  const box = boxOf(clip)

  useEffect(() => {
    if (!drag) return
    const rect = frame.current?.getBoundingClientRect()
    if (!rect) return

    const onMove = (event: PointerEvent) => {
      const dx = (event.clientX - drag.startX) / rect.width
      const dy = (event.clientY - drag.startY) / rect.height
      if (drag.mode === 'move') {
        const x = Math.min(1, Math.max(0, drag.box.x + dx))
        const y = Math.min(1, Math.max(0, drag.box.y + dy))
        onPatch({ x, y } as Partial<StudioClip>)
        return
      }
      // Scale from the centre: the corner drag changes the half-width, so the
      // layer grows symmetrically and never walks across the frame.
      const factor = Math.max(0.15, 1 + (dx + dy))
      if (clip.kind === 'glass') {
        onPatch({
          w: Math.min(1, Math.max(0.05, drag.box.w * factor)),
          h: Math.min(1, Math.max(0.05, drag.box.h * factor)),
        } as Partial<StudioClip>)
      } else if (clip.kind === 'overlay') {
        onPatch({ scale: Math.min(3, Math.max(0.1, (clip as StudioOverlayClip).scale * factor)) } as Partial<StudioClip>)
      } else if (clip.kind === 'text') {
        onPatch({
          fontSizePct: Math.min(28, Math.max(2, (clip as StudioTextClip).fontSizePct * factor)),
        } as Partial<StudioClip>)
      }
    }
    const onUp = () => setDrag(null)
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp, { once: true })
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
    // `clip` is read fresh on every move through the closure above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drag, clip, onPatch])

  if (!active || !box) return null

  const style: React.CSSProperties = {
    left: `${(box.x - box.w / 2) * 100}%`,
    top: `${(box.y - box.h / 2) * 100}%`,
    width: `${box.w * 100}%`,
    height: `${box.h * 100}%`,
  }

  return (
    <div
      role="presentation"
      className="absolute cursor-move rounded-sm border border-dashed border-accent/80 bg-accent/5"
      style={style}
      onPointerDown={(event) => {
        event.preventDefault()
        setDrag({ mode: 'move', startX: event.clientX, startY: event.clientY, box })
      }}
    >
      <span
        role="presentation"
        title="Drag to scale"
        onPointerDown={(event) => {
          event.stopPropagation()
          event.preventDefault()
          setDrag({ mode: 'scale', startX: event.clientX, startY: event.clientY, box })
        }}
        className="absolute -bottom-1.5 -right-1.5 h-3 w-3 cursor-nwse-resize rounded-sm border border-bg bg-accent"
      />
    </div>
  )
}
