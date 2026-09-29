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
import { resolveForOutput } from './resolve'
import { clipEnd, docDuration, sizeForAspect, sourceTimeFor } from './doc'
import { mixGainAt } from './audioMix'
import { getMedia, overlayImage } from './media'
import { preloadLottie, stickerFrame } from './lottie'
import { ensurePhysicsFor } from './physics'
import { drawableElement, drawStudioFrame, type FrameSources } from './renderer'

export type ExportOptions = {
  fileName?: string
  /** Render scale: 1 = full export size (1080p class), 0.5 = fast draft. */
  scale?: number
  onProgress?: (pct: number) => void
  signal?: { cancelled: boolean }
  /**
   * Something the user should know about the file they are about to get — used
   * for fonts that could not be loaded, so the fallback face is never a silent
   * surprise in the exported video.
   */
  onWarning?: (message: string) => void
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

export async function exportStudio(editDoc: StudioDoc, options: ExportOptions = {}): Promise<ExportResult> {
  if (editDoc.clips.some((c) => c.kind === 'sticker')) await preloadLottie()
  const doc = resolveForOutput(editDoc)
  const duration = docDuration(doc)
  if (duration <= 0) throw new Error('Nothing to export — the timeline is empty.')
  if (typeof MediaRecorder === 'undefined') throw new Error('This browser cannot record video (MediaRecorder missing).')

  // Every font the edit uses is verified before a single frame is drawn. A face
  // that is not ready means the canvas paints the fallback — which is exactly
  // the bug this reports instead of baking into the file.
  const missingFonts = await ensureDocFonts(doc).catch(() => [])
  if (missingFonts.length) {
    options.onWarning?.(
      `${missingFonts.length} font${missingFonts.length === 1 ? '' : 's'} could not be loaded (${missingFonts.slice(0, 3).join(', ')}), so the export uses the fallback face for them. Add the font files in Studio → Fonts, or pick a bundled family, and export again.`,
    )
  }
  // Physics layers must never be baked as the loading placeholder.
  await ensurePhysicsFor(doc)
  await document.fonts?.ready.catch(() => undefined)

  const scale = options.scale ?? 1
  const [fullW, fullH] = sizeForAspect(doc.aspect, doc.resolution)
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
 * Desktop farm export. The main process creates a hidden Studio renderer,
 * sends it this editable document, and queues the resulting recording beside
 * every other render job. The visible Studio never owns MediaRecorder or a
 * conversion process, so scrubbing stays responsive and exports survive the
 * renderer being navigated. Browser builds continue to use exportStudio below.
 */
export async function exportStudioInBackground(
  doc: StudioDoc,
  options: { fileName?: string; fps: number; loudnessTarget?: number | null; format: 'webm' | 'mp4'; onProgress?: (pct: number) => void; signal?: { cancelled: boolean } },
): Promise<{ outputPath: string; bytes: number; format: 'webm' | 'mp4' }> {
  const ipc = getIpc()
  if (!isDesktop() || !ipc) throw new Error('Background Studio export needs the desktop app.')
  if (doc.clips.some((c) => c.kind === 'sticker')) await preloadLottie()
  const assets = new Map<string, { id: string; kind: 'video' | 'image' | 'audio'; fileName: string; localPath: string | null }>()
  for (const clip of doc.clips) {
    if (clip.kind === 'video' || clip.kind === 'image' || clip.kind === 'audio') {
      assets.set(clip.mediaId, { id: clip.mediaId, kind: clip.kind, fileName: clip.fileName, localPath: clip.localPath })
    }
  }
  const scale = 1
  const [fullW, fullH] = sizeForAspect(doc.aspect, doc.resolution)
  const width = Math.round((fullW * scale) / 2) * 2
  const height = Math.round((fullH * scale) / 2) * 2
  const result: { outputPath: string; bytes: number } = await new Promise((resolve, reject) => {
    let jobId = ''
    let settled = false
    const cleanups: Array<() => void> = []
    let cancelPoll: number | null = null
    const finish = (fn: () => void) => {
      if (settled) return
      settled = true
      if (cancelPoll !== null) window.clearInterval(cancelPoll)
      cleanups.forEach((cleanup) => cleanup())
      fn()
    }
    if (options.signal) {
      cancelPoll = window.setInterval(() => {
        if (options.signal?.cancelled && jobId) void ipc.invoke('render:cancel', { jobId })
      }, 120)
      cleanups.push(() => { if (cancelPoll !== null) window.clearInterval(cancelPoll) })
    }
    cleanups.push(ipc.on('render:progress', (event: { jobId?: string; pct?: number }) => {
      if (!jobId || event?.jobId !== jobId) return
      options.onProgress?.(Math.max(0, Math.min(100, Number(event.pct) || 0)))
    }))
    cleanups.push(ipc.on('render:done', (event: { jobId?: string; outputPath?: string; bytes?: number }) => {
      if (!jobId || event?.jobId !== jobId || !event.outputPath) return
      finish(() => resolve({ outputPath: event.outputPath!, bytes: Number(event.bytes) || 0 }))
    }))
    cleanups.push(ipc.on('render:error', (event: { jobId?: string; error?: string }) => {
      if (!jobId || event?.jobId !== jobId) return
      finish(() => reject(new Error(event.error || 'Background Studio export failed')))
    }))
    void ipc.invoke('studio:exportMp4', {
      background: true,
      format: options.format,
      doc,
      assets: [...assets.values()],
      fileName: options.fileName,
      fps: options.fps,
      loudnessTarget: options.loudnessTarget ?? null,
      width,
      height,
      reveal: options.format === 'mp4',
    }).then((accepted: { jobId?: string }) => {
      if (accepted?.jobId) jobId = accepted.jobId
      else finish(() => reject(new Error('Background Studio export was not queued.')))
    }).catch((error: unknown) => finish(() => reject(error)))
  })
  return { ...result, format: options.format }
}

/**
 * Desktop only: hand the recorded blob to FFmpeg in the main process and get a
 * real H.264 MP4 back. Kept for API callers that already have a recording;
 * the regular Studio route uses exportStudioInBackground instead.
 */
export async function convertToMp4(
  blob: Blob,
  fileName: string,
  fps: number,
  loudnessTarget: number | null = null,
  signal?: { cancelled: boolean },
): Promise<{ outputPath: string; bytes: number }> {
  const ipc = getIpc()
  if (!isDesktop() || !ipc) throw new Error('MP4 conversion needs the desktop app (FFmpeg runs in the main process).')
  const buffer = await blob.arrayBuffer()
  const result: { outputPath: string; bytes: number } = await new Promise((resolve, reject) => {
    let jobId = ''
    let settled = false
    const cleanups: Array<() => void> = []
    let cancelPoll: number | null = null
    const finish = (fn: () => void) => {
      if (settled) return
      settled = true
      if (cancelPoll !== null) window.clearInterval(cancelPoll)
      cleanups.forEach((cleanup) => cleanup())
      fn()
    }
    if (signal) {
      cancelPoll = window.setInterval(() => {
        if (signal.cancelled && jobId) void ipc.invoke('render:cancel', { jobId })
      }, 120)
      cleanups.push(() => { if (cancelPoll !== null) window.clearInterval(cancelPoll) })
    }
    cleanups.push(ipc.on('render:done', (event: { jobId?: string; outputPath?: string; bytes?: number }) => {
      if (!jobId || event?.jobId !== jobId || !event.outputPath) return
      finish(() => resolve({ outputPath: event.outputPath!, bytes: Number(event.bytes) || 0 }))
    }))
    cleanups.push(ipc.on('render:error', (event: { jobId?: string; error?: string }) => {
      if (!jobId || event?.jobId !== jobId) return
      finish(() => reject(new Error(event.error || 'MP4 export failed')))
    }))
    void ipc.invoke('studio:exportMp4', {
      bytes: new Uint8Array(buffer),
      fileName,
      fps,
      loudnessTarget,
    }).then((accepted: { jobId?: string; outputPath?: string; bytes?: number; status?: string }) => {
      if (accepted?.outputPath) {
        finish(() => resolve({ outputPath: accepted.outputPath!, bytes: Number(accepted.bytes) || 0 }))
      } else if (accepted?.jobId) jobId = accepted.jobId
      else finish(() => reject(new Error('MP4 export was not queued.')))
    }).catch((error: unknown) => finish(() => reject(error)))
  })
  return result
}

/** True when the Export-as-MP4 button should be offered. */
export function canExportMp4(): boolean {
  return isDesktop() && getIpc() !== null
}

/** Single PNG still of the composition at `t` — used for thumbnails/posters. */
export function captureStill(editDoc: StudioDoc, t: number, maxWidth = 640): string | null {
  const doc = resolveForOutput(editDoc)
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
