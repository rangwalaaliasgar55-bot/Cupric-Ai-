/**
 * Runtime media registry for the Studio.
 *
 * Object URLs and decoded <video> elements cannot be persisted, so the store
 * only ever keeps a `mediaId`, the file name, the source duration and (on
 * desktop) the real path. This module owns the live handles for the session
 * and tells the UI honestly when a clip needs relinking after a reload.
 */

import { getBridge } from '../bridge'
import { uid } from '../utils'

export type MediaHandle = {
  id: string
  kind: 'video' | 'image'
  fileName: string
  localPath: string | null
  url: string
  durationSec: number
  width: number
  height: number
  element: HTMLVideoElement | HTMLImageElement
  posterDataUrl: string | null
}

const registry = new Map<string, MediaHandle>()

export function getMedia(mediaId: string | null | undefined): MediaHandle | null {
  if (!mediaId) return null
  return registry.get(mediaId) ?? null
}

export function hasMedia(mediaId: string | null | undefined): boolean {
  return Boolean(mediaId && registry.has(mediaId))
}

export function releaseMedia(mediaId: string) {
  const handle = registry.get(mediaId)
  if (!handle) return
  if (handle.element instanceof HTMLVideoElement) handle.element.pause()
  URL.revokeObjectURL(handle.url)
  registry.delete(mediaId)
}

function posterFrom(el: HTMLVideoElement | HTMLImageElement, w: number, h: number): string | null {
  try {
    const canvas = document.createElement('canvas')
    const scale = Math.min(1, 240 / Math.max(w || 1, 1))
    canvas.width = Math.max(1, Math.round((w || 240) * scale))
    canvas.height = Math.max(1, Math.round((h || 135) * scale))
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    ctx.drawImage(el, 0, 0, canvas.width, canvas.height)
    return canvas.toDataURL('image/jpeg', 0.6)
  } catch {
    // Tainted canvas (remote file) — the timeline just falls back to a block.
    return null
  }
}

function loadVideo(url: string): Promise<HTMLVideoElement> {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video')
    video.preload = 'auto'
    video.muted = true
    video.playsInline = true
    video.crossOrigin = 'anonymous'
    video.src = url
    const onReady = () => {
      // `loadeddata` guarantees a decodable first frame for the poster.
      video.removeEventListener('loadeddata', onReady)
      resolve(video)
    }
    video.addEventListener('loadeddata', onReady)
    video.addEventListener('error', () => reject(new Error('This file could not be decoded as video.')), { once: true })
  })
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('This file could not be decoded as an image.'))
    img.src = url
  })
}

/** Register a picked File and return a handle the editor can draw immediately. */
export async function registerFile(file: File, existingId?: string): Promise<MediaHandle> {
  const isVideo = file.type.startsWith('video/') || /\.(mp4|mov|webm|mkv|m4v|avi)$/i.test(file.name)
  const isImage = file.type.startsWith('image/') || /\.(png|jpe?g|webp|gif|avif|svg)$/i.test(file.name)
  if (!isVideo && !isImage) throw new Error(`${file.name} is not a video or image file.`)

  const url = URL.createObjectURL(file)
  const id = existingId ?? uid()
  const localPath = getBridge()?.filePathFor(file) ?? null

  try {
    if (isVideo) {
      const element = await loadVideo(url)
      const durationSec = Number.isFinite(element.duration) && element.duration > 0 ? element.duration : 0
      const handle: MediaHandle = {
        id,
        kind: 'video',
        fileName: file.name,
        localPath,
        url,
        durationSec,
        width: element.videoWidth,
        height: element.videoHeight,
        element,
        posterDataUrl: posterFrom(element, element.videoWidth, element.videoHeight),
      }
      registry.set(id, handle)
      return handle
    }

    const element = await loadImage(url)
    const handle: MediaHandle = {
      id,
      kind: 'image',
      fileName: file.name,
      localPath,
      url,
      durationSec: 0,
      width: element.naturalWidth,
      height: element.naturalHeight,
      element,
      posterDataUrl: posterFrom(element, element.naturalWidth, element.naturalHeight),
    }
    registry.set(id, handle)
    return handle
  } catch (err) {
    URL.revokeObjectURL(url)
    throw err
  }
}

/**
 * Seek a video element to an exact time and wait for the frame to be ready.
 * Used by the frame-accurate exporter; preview playback never blocks on this.
 */
export function seekTo(video: HTMLVideoElement, time: number): Promise<void> {
  return new Promise((resolve) => {
    const target = Math.max(0, Math.min(time, Math.max(0, (video.duration || 0) - 1 / 1000)))
    if (Math.abs(video.currentTime - target) < 0.001 && video.readyState >= 2) {
      resolve()
      return
    }
    let settled = false
    const done = () => {
      if (settled) return
      settled = true
      video.removeEventListener('seeked', done)
      clearTimeout(timer)
      resolve()
    }
    // A missing keyframe can swallow `seeked`; never hang the export on it.
    const timer = setTimeout(done, 400)
    video.addEventListener('seeked', done)
    video.currentTime = target
  })
}

/* ——— overlay snapshots (UI Lab demos, logos, stickers) ——— */

const overlayCache = new Map<string, HTMLImageElement>()

/**
 * Decode an overlay data URL once and keep it around. Returns null on the
 * first call (decode is async) and the image on every call after that, which
 * is exactly what a draw loop needs — no promises inside the renderer.
 */
export function overlayImage(key: string, dataUrl: string): HTMLImageElement | null {
  const cached = overlayCache.get(key)
  if (cached) return cached.complete && cached.naturalWidth > 0 ? cached : null
  const img = new Image()
  img.src = dataUrl
  overlayCache.set(key, img)
  return null
}

export function clearOverlay(key: string) {
  overlayCache.delete(key)
}
