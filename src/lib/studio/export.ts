/**
 * Studio exporter.
 *
 * Records the exact same `drawStudioFrame` output the preview shows, in real
 * time, through MediaRecorder — so picture, motion and audio stay in sync and
 * the file length always matches the timeline length.
 *
 * Why real time rather than frame stepping: MediaRecorder timestamps frames by
 * wall clock. Stepping frames faster than real time produces a file whose
 * duration and audio are wrong, which is exactly the kind of "looks done but
 * isn't" behaviour this app is trying to avoid.
 */

import { registrySources } from './sources'
import { ensureDocFonts } from './fonts'
import type { StudioAudioClip, StudioDoc, StudioMediaClip } from '../../types/project'
import { getIpc, isDesktop } from '../bridge'
import { clipEnd, docDuration, sizeForAspect, sourceTimeFor } from './doc'
import { mixGainAt } from './audioMix'
import { getMedia, overlayImage } from './media'
import { stickerFrame } from './lottie'
import { drawableElement, drawStudioFrame, type FrameSources } from './renderer'

export type ExportOptions = {
  fileName?: string
  /** Render scale: 1 = full export size (1080p class), 0.5 = fast draft. */
  scale?: number
  onProgress?: (pct: number) => void
  signal?: { cancelled: boolean }
}

export type ExportResult = {
  blob: Blob
  url: string
  fileName: string
  durationSec: number
  mimeType: string
  cancelled: boolean
}

function pickMimeType(): string {
  const candidates = [
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm;codecs=vp9',
    'video/webm',
    'video/mp4',
  ]
  for (const type of candidates) {
    if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(type)) return type
  }
  return ''
}

/** One audio graph per element, reused across exports (a second
 *  createMediaElementSource on the same element throws). */
const audioNodes = new WeakMap<HTMLMediaElement, { source: MediaElementAudioSourceNode; gain: GainNode }>()

function audioGraph(ctx: AudioContext, el: HTMLMediaElement) {
  let node = audioNodes.get(el)
  if (!node) {
    const source = ctx.createMediaElementSource(el)
    const gain = ctx.createGain()
    source.connect(gain)
    gain.connect(ctx.destination)
    node = { source, gain }
    audioNodes.set(el, node)
  }
  return node
}


/** Move a clip's gain to `value` over one frame, avoiding zipper noise. */
function rampGain(ctx: AudioContext, el: HTMLMediaElement, value: number) {
  const { gain } = audioGraph(ctx, el)
  const now = ctx.currentTime
  gain.gain.cancelScheduledValues(now)
  gain.gain.setValueAtTime(gain.gain.value, now)
  gain.gain.linearRampToValueAtTime(value, now + 0.02)
}

export async function exportStudio(doc: StudioDoc, options: ExportOptions = {}): Promise<ExportResult> {
  const duration = docDuration(doc)
  if (duration <= 0) throw new Error('Nothing to export — the timeline is empty.')
  if (typeof MediaRecorder === 'undefined') throw new Error('This browser cannot record video (MediaRecorder missing).')

  // Fonts chosen from Resources are downloaded on demand; wait for them so the
  // export never bakes the fallback face into the video.
  await ensureDocFonts(doc).catch(() => [])
  await document.fonts?.ready.catch(() => undefined)

  const scale = options.scale ?? 1
  const [fullW, fullH] = sizeForAspect(doc.aspect)
  const width = Math.round((fullW * scale) / 2) * 2
  const height = Math.round((fullH * scale) / 2) * 2

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d', { alpha: false })
  if (!ctx) throw new Error('Could not create a 2D canvas context for export.')

  const videoClips = doc.clips.filter((c): c is StudioMediaClip => c.kind === 'video')
  // Export reads the ORIGINAL files (2.7): silence any preview proxy first.
  for (const clip of videoClips) getMedia(clip.mediaId)?.previewVideo?.pause()
  const audioClips = doc.clips.filter((c): c is StudioAudioClip => c.kind === 'audio')

  // — audio mix —
  let audioCtx: AudioContext | null = null
  let mixDest: MediaStreamAudioDestinationNode | null = null
  const audible: (StudioMediaClip | StudioAudioClip)[] = [
    ...videoClips.filter((clip) => clip.volume > 0 && getMedia(clip.mediaId)),
    ...audioClips.filter((clip) => clip.volume > 0 && getMedia(clip.mediaId)),
  ]
  if (audible.length) {
    const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
    audioCtx = new Ctor()
    if (audioCtx.state === 'suspended') await audioCtx.resume()
    mixDest = audioCtx.createMediaStreamDestination()
    for (const clip of audible) {
      const handle = getMedia(clip.mediaId)
      if (!handle || !(handle.element instanceof HTMLMediaElement)) continue
      const { gain } = audioGraph(audioCtx, handle.element)
      // Music clips ride their fade envelope, so the gain is set per frame in
      // the tick loop below; video keeps its single clip volume.
      gain.gain.value = clip.kind === 'audio' ? 0 : clip.volume
      gain.connect(mixDest)
    }
  }

  const stream = canvas.captureStream(doc.fps)
  if (mixDest) for (const track of mixDest.stream.getAudioTracks()) stream.addTrack(track)

  const mimeType = pickMimeType()
  const recorder = new MediaRecorder(stream, {
    ...(mimeType ? { mimeType } : {}),
    videoBitsPerSecond: Math.round(width * height * doc.fps * 0.12),
  })
  const chunks: Blob[] = []
  recorder.ondataavailable = (event) => {
    if (event.data && event.data.size) chunks.push(event.data)
  }

  const sources: FrameSources = {
    media: (clip) => drawableElement(clip.mediaId),
    // Same resolver as the preview, so animated Lab captures export animated.
    overlay: registrySources.overlay,
    sticker: (clip, localSec) => stickerFrame(clip, localSec),
  }

  // Reset every audio clip to its trim-in as well, so a music bed that was
  // auditioned mid-track does not start from wherever it was left.
  for (const clip of audioClips) {
    const el = getMedia(clip.mediaId)?.element
    if (el instanceof HTMLAudioElement) {
      el.pause()
      el.currentTime = clip.trimInSec
      el.volume = 1
    }
  }

  // Reset every video to its trim-in before the recorder starts rolling.
  for (const clip of videoClips) {
    const handle = getMedia(clip.mediaId)
    if (handle?.element instanceof HTMLVideoElement) {
      handle.element.pause()
      handle.element.currentTime = clip.trimInSec
      handle.element.muted = clip.volume <= 0
      handle.element.playbackRate = clip.speed > 0 ? clip.speed : 1
    }
  }

  const stopped = new Promise<void>((resolve) => {
    recorder.onstop = () => resolve()
  })

  recorder.start(200)
  const startedAt = performance.now()
  let cancelled = false

  await new Promise<void>((resolve) => {
    const tick = () => {
      const elapsed = (performance.now() - startedAt) / 1000

      if (options.signal?.cancelled) {
        cancelled = true
        resolve()
        return
      }

      // Keep every video element aligned with the timeline.
      for (const clip of videoClips) {
        const handle = getMedia(clip.mediaId)
        const el = handle?.element
        if (!(el instanceof HTMLVideoElement)) continue
        const active = elapsed >= clip.startSec && elapsed < clipEnd(clip)
        if (active) {
          const want = sourceTimeFor(clip, elapsed)
          if (Math.abs(el.currentTime - want) > 0.25) el.currentTime = want
          if (el.paused) void el.play().catch(() => undefined)
        } else if (!el.paused) {
          el.pause()
        }
      }

      for (const clip of audioClips) {
        const el = getMedia(clip.mediaId)?.element
        if (!(el instanceof HTMLAudioElement)) continue
        const active = elapsed >= clip.startSec && elapsed < clipEnd(clip)
        if (active) {
          const want = sourceTimeFor(clip, elapsed)
          if (Math.abs(el.currentTime - want) > 0.25) el.currentTime = want
          if (el.paused) void el.play().catch(() => undefined)
          // Ramp instead of assign: stepping gain once per frame is audible as
          // zipper noise, and a fade is exactly where it would be heard.
          if (audioCtx) rampGain(audioCtx, el, mixGainAt(doc, clip, elapsed))
        } else {
          if (audioCtx) rampGain(audioCtx, el, 0)
          if (!el.paused) el.pause()
        }
      }

      drawStudioFrame(ctx, doc, Math.min(elapsed, duration), width, height, sources)
      options.onProgress?.(Math.min(99, (elapsed / duration) * 100))

      if (elapsed >= duration) {
        resolve()
        return
      }
      requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  })

  for (const clip of [...videoClips, ...audioClips]) {
    const el = getMedia(clip.mediaId)?.element
    if (el instanceof HTMLMediaElement) el.pause()
  }

  recorder.stop()
  await stopped
  for (const track of stream.getTracks()) track.stop()
  if (mixDest) {
    for (const clip of audible) {
      const handle = getMedia(clip.mediaId)
      const el = handle?.element
      if (el instanceof HTMLMediaElement && audioCtx) audioGraph(audioCtx, el).gain.disconnect(mixDest)
    }
  }
  await audioCtx?.close()

  const blob = new Blob(chunks, { type: mimeType || 'video/webm' })
  if (!blob.size && !cancelled) throw new Error('The recorder produced an empty file.')
  options.onProgress?.(100)

  const extension = (mimeType || 'video/webm').includes('mp4') ? 'mp4' : 'webm'
  const fileName = options.fileName ? `${options.fileName}.${extension}` : `cupric-studio.${extension}`

  return { blob, url: URL.createObjectURL(blob), fileName, durationSec: duration, mimeType: mimeType || 'video/webm', cancelled }
}

/**
 * Desktop only: hand the recorded blob to FFmpeg in the main process and get a
 * real H.264 MP4 back. In the browser there is no FFmpeg, so callers keep the
 * WebM — we never rename a WebM to .mp4.
 */
export async function convertToMp4(
  blob: Blob,
  fileName: string,
  fps: number,
  loudnessTarget: number | null = null,
): Promise<{ outputPath: string; bytes: number }> {
  const ipc = getIpc()
  if (!isDesktop() || !ipc) throw new Error('MP4 conversion needs the desktop app (FFmpeg runs in the main process).')
  const buffer = await blob.arrayBuffer()
  const result: { outputPath: string; bytes: number } = await ipc.invoke('studio:exportMp4', {
    bytes: new Uint8Array(buffer),
    fileName,
    fps,
    loudnessTarget,
  })
  return result
}

/** True when the Export-as-MP4 button should be offered. */
export function canExportMp4(): boolean {
  return isDesktop() && getIpc() !== null
}

/** Single PNG still of the composition at `t` — used for thumbnails/posters. */
export function captureStill(doc: StudioDoc, t: number, maxWidth = 640): string | null {
  const [fullW, fullH] = sizeForAspect(doc.aspect)
  const scale = Math.min(1, maxWidth / fullW)
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(fullW * scale)
  canvas.height = Math.round(fullH * scale)
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  drawStudioFrame(ctx, doc, t, canvas.width, canvas.height, {
    media: (clip) => drawableElement(clip.mediaId),
    // Same resolver as the preview, so animated Lab captures export animated.
    overlay: registrySources.overlay,
    sticker: (clip, localSec) => stickerFrame(clip, localSec),
  })
  try {
    return canvas.toDataURL('image/jpeg', 0.7)
  } catch {
    return null
  }
}
