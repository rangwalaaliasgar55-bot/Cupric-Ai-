import { useEffect, useRef, useState } from 'react'
import type {
  StudioAudioClip,
  StudioClip,
  StudioDoc,
  StudioGlassClip,
  StudioMediaClip,
  StudioOverlayClip,
  StudioStickerClip,
  StudioTextClip,
} from '../../types/project'
import { clipEnd, previewSizeForAspect, sourceTimeFor } from '../../lib/studio/doc'
import { safeAreas } from '../../lib/studio/textTools'
import { mixGainAt } from '../../lib/studio/audioMix'
import { getMedia } from '../../lib/studio/media'
import { drawStudioFrame, keyframeValuesAt, measureTextBlock } from '../../lib/studio/renderer'
import { docFontFamilies, ensureDocFonts, FONTS_CHANGED_EVENT } from '../../lib/studio/fonts'
import { patchTransformKeyframe } from '../../lib/studio/keyframeEdit'
import { registrySources } from '../../lib/studio/sources'

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
  /** Editing-only title/action safe guides; never painted into exports. */
  showSafeAreas?: boolean
  /** Canvas transforms create/update a keyframe at the playhead. */
  keyframeRecord?: boolean
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
  showSafeAreas = false,
  keyframeRecord = false,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const frameRef = useRef<HTMLDivElement>(null)
  const timeRef = useRef(time)
  timeRef.current = time
  const playingRef = useRef(playing)
  playingRef.current = playing

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
      el.volume = muted ? 0 : mixGainAt(doc, audio, t)
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

  // Custom fonts (Resources → Fonts) download on demand. Load whatever this
  // document uses, and repaint the moment a face arrives — otherwise titles
  // stay in the fallback font until the next scrub.
  const fontKey = docFontFamilies(doc).join('|')
  useEffect(() => {
    if (fontKey) void ensureDocFonts(doc)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fontKey])
  useEffect(() => {
    const repaint = () => {
      if (!playingRef.current) syncAndDraw(timeRef.current, false)
    }
    window.addEventListener(FONTS_CHANGED_EVENT, repaint)
    document.fonts?.addEventListener?.('loadingdone', repaint)
    return () => {
      window.removeEventListener(FONTS_CHANGED_EVENT, repaint)
      document.fonts?.removeEventListener?.('loadingdone', repaint)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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
      {showSafeAreas && !playing && (
        <div className="pointer-events-none absolute inset-0" aria-label="Title and action safe area guides">
          <div className="absolute inset-[5%] rounded border border-dashed border-white/35">
            <span className="absolute left-1 top-0.5 text-[9px] font-medium uppercase tracking-wide text-white/55">action safe</span>
          </div>
          <div className="absolute inset-[10%] rounded border border-dashed border-accent/60">
            <span className="absolute left-1 top-0.5 text-[9px] font-medium uppercase tracking-wide text-accent-text/80">title safe</span>
          </div>
          {doc.aspect === '9:16' &&
            safeAreas('9:16')
              .filter((b) => b.id === 'social')
              .map((b) => (
                <div key={b.id} className="absolute rounded border border-dashed border-info/70" style={{ left: `${b.x * 100}%`, top: `${b.y * 100}%`, width: `${b.w * 100}%`, height: `${b.h * 100}%` }}>
                  <span className="absolute bottom-0.5 left-1 text-[9px] font-medium uppercase tracking-wide text-info">clear of app UI</span>
                </div>
              ))}
        </div>
      )}
      {!playing && selected && onPatchSelected && (
        <TransformHandles
          clip={selected}
          time={time}
          frame={frameRef}
          keyframeRecord={keyframeRecord}
          onPatch={onPatchSelected}
        />
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
let measureCtx: CanvasRenderingContext2D | null = null

function boxOf(clip: StudioClip, frameAspect = 16 / 9): Box | null {
  if (clip.kind === 'text') {
    const text = clip as StudioTextClip
    measureCtx ??= document.createElement('canvas').getContext('2d')
    if (measureCtx) {
      // Measure at a nominal 1080-high frame; the result is normalised.
      const size = measureTextBlock(measureCtx, text, 1080 * frameAspect, 1080)
      return { x: text.x, y: text.y, w: size.w, h: size.h }
    }
    // Text has no stored size, only a font size, so the box is an estimate of
    // the painted line — good enough to grab, and it never drives the render.
    const h = (text.fontSizePct / 100) * 1.5
    return { x: text.x, y: text.y, w: Math.min(0.92, Math.max(0.3, text.text.length * text.fontSizePct * 0.006)), h }
  }
  if (clip.kind === 'video' || clip.kind === 'image') {
    const media = clip as StudioMediaClip
    const scale = media.scale ?? 1
    return { x: media.x ?? 0.5, y: media.y ?? 0.5, w: scale, h: scale }
  }
  if (clip.kind === 'overlay') {
    const overlay = clip as StudioOverlayClip
    // Mirror the renderer: the image is fitted inside the frame by its own
    // aspect ratio, then scaled. A fixed guess made the handles lie.
    const image = registrySources.overlay(overlay, 0) as HTMLImageElement | null
    const sw = image?.naturalWidth || 16
    const sh = image?.naturalHeight || 10
    const base = Math.min(frameAspect / sw, 1 / sh)
    return { x: overlay.x, y: overlay.y, w: (sw * base * overlay.scale) / frameAspect, h: sh * base * overlay.scale }
  }
  if (clip.kind === 'glass') {
    const glass = clip as StudioGlassClip
    return { x: glass.x, y: glass.y, w: glass.w, h: glass.h }
  }
  if (clip.kind === 'sticker') {
    const sticker = clip as StudioStickerClip
    // Stickers draw at a quarter of the shorter edge, so the grab box follows
    // the same rule the renderer uses.
    const size = 0.25 * sticker.scale
    return { x: sticker.x, y: sticker.y, w: size, h: size }
  }
  return null
}

function TransformHandles({
  clip,
  time,
  frame,
  keyframeRecord,
  onPatch,
}: {
  clip: StudioClip
  time: number
  frame: React.RefObject<HTMLDivElement | null>
  keyframeRecord: boolean
  onPatch: (patch: Partial<StudioClip>) => void
}) {
  const [drag, setDrag] = useState<
    { mode: 'move' | 'scale' | 'rotate'; startX: number; startY: number; box: Box; startRotation: number; startScale: number } | null
  >(null)
  // Snap guides shown while moving (normalised positions) and the inline
  // text editor opened by double-clicking a text layer.
  const [guides, setGuides] = useState<{ v: number[]; h: number[]; readout: string } | null>(null)
  const [editing, setEditing] = useState<string | null>(null)
  const active = time >= clip.startSec && time < clip.startSec + clip.durationSec
  const values = keyframeValuesAt(clip, time)
  const frameRect = frame.current?.getBoundingClientRect()
  const baseBox = boxOf(clip, frameRect && frameRect.height > 0 ? frameRect.width / frameRect.height : 16 / 9)
  const box = baseBox ? {
    ...baseBox,
    x: values?.x ?? baseBox.x,
    y: values?.y ?? baseBox.y,
    w: baseBox.w * (values?.scale ?? 1),
    h: baseBox.h * (values?.scale ?? 1),
  } : null

  useEffect(() => {
    if (!drag) return
    const rect = frame.current?.getBoundingClientRect()
    if (!rect) return

    const onMove = (event: PointerEvent) => {
      const dx = (event.clientX - drag.startX) / rect.width
      const dy = (event.clientY - drag.startY) / rect.height
      const patchTransform = (
        keyPatch: Parameters<typeof patchTransformKeyframe>[2],
        staticPatch: Partial<StudioClip>,
      ) => onPatch(patchTransformKeyframe(clip, time, keyPatch, keyframeRecord) ?? staticPatch)
      if (drag.mode === 'rotate') {
        const cx = rect.left + drag.box.x * rect.width
        const cy = rect.top + drag.box.y * rect.height
        // Angle from the clip's centre to the pointer, measured from straight
        // up, which is where the handle sits when the clip is unrotated.
        const raw = (Math.atan2(event.clientY - cy, event.clientX - cx) * 180) / Math.PI + 90
        let next = ((raw + 180) % 360) - 180
        // Shift snaps to 15°, and everything snaps within 3° of a right angle
        // so "straight" is reachable without a steady hand.
        if (event.shiftKey) next = Math.round(next / 15) * 15
        else {
          const nearest = Math.round(next / 90) * 90
          if (Math.abs(next - nearest) < 3) next = nearest
        }
        patchTransform(
          { rotation: Math.round(next) },
          { rotation: next === 0 ? undefined : Math.round(next) } as Partial<StudioClip>,
        )
        return
      }
      if (drag.mode === 'move') {
        let x = Math.min(1, Math.max(0, drag.box.x + dx))
        let y = Math.min(1, Math.max(0, drag.box.y + dy))
        // Magnetic guides, like every pro editor: the frame centre and the
        // title/action-safe edges pull the layer's centre or edges in when
        // it gets within a few pixels. Hold Alt to place freely.
        const v: number[] = []
        const h: number[] = []
        if (!event.altKey) {
          const snapAxis = (pos: number, half: number, px: number, lines: number[], hit: number[]) => {
            const tol = 6 / px
            let best: { d: number; pos: number; line: number } | null = null
            for (const line of lines) {
              for (const [edge, offset] of [[pos, 0], [pos - half, half], [pos + half, -half]] as const) {
                const d = Math.abs(edge - line)
                if (d < tol && (!best || d < best.d)) best = { d, pos: line + offset, line }
              }
            }
            if (!best) return pos
            hit.push(best.line)
            return best.pos
          }
          x = snapAxis(x, drag.box.w / 2, rect.width, [0.5, 0.05, 0.95, 0.1, 0.9], v)
          y = snapAxis(y, drag.box.h / 2, rect.height, [0.5, 0.05, 0.95, 0.1, 0.9], h)
        }
        setGuides({ v, h, readout: `${Math.round(x * 100)}% · ${Math.round(y * 100)}%` })
        patchTransform({ x, y }, { x, y } as Partial<StudioClip>)
        return
      }
      // Scale from the centre: keyframed scale is a multiplier; static scale
      // keeps using each clip kind's native size property.
      const factor = Math.max(0.15, 1 + (dx + dy))
      const keyframePatch = patchTransformKeyframe(
        clip,
        time,
        { scale: Math.min(4, Math.max(0.1, drag.startScale * factor)) },
        keyframeRecord,
      )
      if (keyframePatch) {
        onPatch(keyframePatch)
        return
      }
      if (clip.kind === 'glass') {
        onPatch({
          w: Math.min(1, Math.max(0.05, drag.box.w * factor)),
          h: Math.min(1, Math.max(0.05, drag.box.h * factor)),
        } as Partial<StudioClip>)
      } else if (clip.kind === 'video' || clip.kind === 'image') {
        onPatch({ scale: Math.min(4, Math.max(0.05, ((clip as StudioMediaClip).scale ?? 1) * factor)) } as Partial<StudioClip>)
      } else if (clip.kind === 'overlay') {
        onPatch({ scale: Math.min(3, Math.max(0.1, (clip as StudioOverlayClip).scale * factor)) } as Partial<StudioClip>)
      } else if (clip.kind === 'text') {
        onPatch({
          fontSizePct: Math.min(28, Math.max(2, (clip as StudioTextClip).fontSizePct * factor)),
        } as Partial<StudioClip>)
      } else if (clip.kind === 'sticker') {
        onPatch({ scale: Math.min(4, Math.max(0.2, (clip as StudioStickerClip).scale * factor)) } as Partial<StudioClip>)
      }
    }
    const onUp = () => { setDrag(null); setGuides(null) }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp, { once: true })
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
    // `clip` is read fresh on every move through the closure above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drag, clip, keyframeRecord, onPatch, time])

  if (!active || !box) return null

  const rotation = values?.rotation ?? clip.rotation ?? 0
  const style: React.CSSProperties = {
    left: `${(box.x - box.w / 2) * 100}%`,
    top: `${(box.y - box.h / 2) * 100}%`,
    width: `${box.w * 100}%`,
    height: `${box.h * 100}%`,
    // The outline turns with the layer, so the handles stay on the corners the
    // user can actually see.
    transform: rotation ? `rotate(${rotation}deg)` : undefined,
  }

  const isText = clip.kind === 'text'
  const commitText = (value: string) => {
    setEditing(null)
    const next = value.replace(/\s+$/, '')
    if (isText && next && next !== (clip as StudioTextClip).text) onPatch({ text: next } as Partial<StudioClip>)
  }

  return (
    <>
    {guides && (
      <div className="pointer-events-none absolute inset-0 z-20" aria-hidden>
        {guides.v.map((g) => <span key={`v${g}`} className="absolute top-0 bottom-0 w-px bg-accent shadow-[0_0_6px_var(--color-accent)]" style={{ left: `${g * 100}%` }} />)}
        {guides.h.map((g) => <span key={`h${g}`} className="absolute left-0 right-0 h-px bg-accent shadow-[0_0_6px_var(--color-accent)]" style={{ top: `${g * 100}%` }} />)}
        <span className="absolute bottom-2 left-1/2 -translate-x-1/2 rounded-md bg-black/75 px-2 py-0.5 font-mono text-[10px] text-white tabular-nums">{guides.readout}</span>
      </div>
    )}
    <div
      role="presentation"
      className="absolute cursor-move rounded-sm border border-dashed border-accent/80 bg-accent/5"
      style={style}
      title={isText ? 'Drag to move · double-click to edit text · Alt to skip snapping' : 'Drag to move · Alt to skip snapping'}
      onDoubleClick={(event) => {
        if (!isText) return
        event.preventDefault()
        event.stopPropagation()
        setDrag(null)
        setEditing((clip as StudioTextClip).text)
      }}
      onPointerDown={(event) => {
        if (editing !== null) return
        event.preventDefault()
        setDrag({ mode: 'move', startX: event.clientX, startY: event.clientY, box, startRotation: rotation, startScale: values?.scale ?? 1 })
      }}
    >
      {editing !== null && (
        <textarea
          autoFocus
          aria-label="Edit text on canvas"
          defaultValue={editing}
          onFocus={(event) => event.currentTarget.select()}
          onPointerDown={(event) => event.stopPropagation()}
          onKeyDown={(event) => {
            event.stopPropagation()
            if (event.key === 'Escape') { event.preventDefault(); setEditing(null) }
            if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); commitText(event.currentTarget.value) }
          }}
          onBlur={(event) => commitText(event.currentTarget.value)}
          className="absolute left-1/2 top-1/2 z-30 min-h-[2.5rem] w-[max(100%,12rem)] -translate-x-1/2 -translate-y-1/2 resize-none rounded-md border border-accent bg-black/85 p-2 text-center text-sm font-semibold text-white shadow-xl outline-none"
        />
      )}
      <span
        role="presentation"
        title="Drag to rotate · hold Shift for 15° steps"
        onPointerDown={(event) => {
          event.stopPropagation()
          event.preventDefault()
          setDrag({ mode: 'rotate', startX: event.clientX, startY: event.clientY, box, startRotation: rotation, startScale: values?.scale ?? 1 })
        }}
        className="absolute -top-7 left-1/2 h-3.5 w-3.5 -translate-x-1/2 cursor-grab rounded-full border border-bg bg-accent"
      />
      <span className="absolute -top-[1.1rem] left-1/2 h-4 w-px -translate-x-1/2 bg-accent/70" />
      {rotation !== 0 && (
        <span className="absolute -top-14 left-1/2 -translate-x-1/2 rounded bg-bg/90 px-1.5 py-0.5 font-mono text-[10px] text-muted tabular-nums">
          {rotation}°
        </span>
      )}
      <span
        role="presentation"
        title="Drag to scale"
        onPointerDown={(event) => {
          event.stopPropagation()
          event.preventDefault()
          setDrag({ mode: 'scale', startX: event.clientX, startY: event.clientY, box, startRotation: rotation, startScale: values?.scale ?? 1 })
        }}
        className="absolute -bottom-1.5 -right-1.5 h-3 w-3 cursor-nwse-resize rounded-sm border border-bg bg-accent"
      />
    </div>
    </>
  )
}
