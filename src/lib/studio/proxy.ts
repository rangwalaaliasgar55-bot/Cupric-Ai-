/**
 * 2.7 — video proxies, renderer side.
 *
 * Desktop only: FFmpeg in the main process writes a 540p short-GOP copy
 * (electron/proxies.cjs). The preview then drives that copy; the exporter
 * keeps reading the original file, so the output is full quality.
 * The browser build has no FFmpeg and says so instead of pretending.
 */
import { getIpc } from '../bridge'
import { getMedia, loadVideo, onVideoRegistered, proxyMode, type MediaHandle } from './media'

export type ProxyStatus = { state: 'none' | 'making' | 'ready' | 'failed' | 'unavailable'; pct: number; error?: string; cached?: boolean }

const status = new Map<string, ProxyStatus>()
export const PROXY_EVENT = 'newbrand:proxy'
const emit = (mediaId: string) => globalThis.dispatchEvent?.(new CustomEvent(PROXY_EVENT, { detail: { mediaId } }))

export function proxyStatus(mediaId: string): ProxyStatus {
  const handle = getMedia(mediaId)
  if (handle?.previewVideo) return { state: 'ready', pct: 1, ...(status.get(mediaId)?.cached ? { cached: true } : {}) }
  return status.get(mediaId) ?? { state: 'none', pct: 0 }
}

/** Same rule as electron/proxies.cjs needsProxy (kept in sync by check:proxies). */
export function shouldAutoProxy(h: Pick<MediaHandle, 'width' | 'height' | 'bytes'>): boolean {
  const short = Math.min(h.width || 0, h.height || 0)
  const long = Math.max(h.width || 0, h.height || 0)
  if (long > 1920 || short > 1080) return true
  return short >= 1080 && (h.bytes ?? 0) > 60 * 1024 * 1024
}

let listening = false
function listen() {
  const ipc = getIpc()
  if (listening || !ipc?.on) return
  listening = true
  ipc.on('media:proxyProgress', (payload: unknown) => {
    const p = payload as { path?: string; pct?: number }
    for (const [id, s] of status) {
      if (s.state === 'making' && getMedia(id)?.localPath === p.path) {
        status.set(id, { ...s, pct: Math.max(s.pct, Number(p.pct) || 0) })
        emit(id)
      }
    }
  })
}

/** Build (or reuse) the proxy for a video handle and attach it. */
export async function makeProxy(mediaId: string): Promise<ProxyStatus> {
  const handle = getMedia(mediaId)
  if (!handle || handle.kind !== 'video') return { state: 'failed', pct: 0, error: 'Only video clips get proxies.' }
  if (handle.previewVideo) return proxyStatus(mediaId)
  const ipc = getIpc()
  if (!ipc) {
    const s: ProxyStatus = { state: 'unavailable', pct: 0, error: 'Proxies need the desktop app (FFmpeg runs there). The browser plays the original.' }
    status.set(mediaId, s)
    emit(mediaId)
    return s
  }
  if (!handle.localPath) {
    const s: ProxyStatus = { state: 'unavailable', pct: 0, error: 'This clip has no file path (it came from a download or a package), so there is nothing for FFmpeg to read.' }
    status.set(mediaId, s)
    emit(mediaId)
    return s
  }
  listen()
  status.set(mediaId, { state: 'making', pct: 0 })
  emit(mediaId)
  try {
    const r = (await ipc.invoke('media:proxy', { path: handle.localPath, durationSec: handle.durationSec })) as { url: string; cached: boolean }
    const video = await loadVideo(r.url)
    const live = getMedia(mediaId)
    if (!live) return { state: 'none', pct: 0 }
    live.previewVideo = video
    const s: ProxyStatus = { state: 'ready', pct: 1, cached: r.cached }
    status.set(mediaId, s)
    emit(mediaId)
    return s
  } catch (err) {
    const s: ProxyStatus = { state: 'failed', pct: 0, error: err instanceof Error ? err.message : String(err) }
    status.set(mediaId, s)
    emit(mediaId)
    return s
  }
}

/** Drop the proxy (file and element); preview goes back to the original. */
export async function removeProxy(mediaId: string): Promise<void> {
  const handle = getMedia(mediaId)
  if (!handle) return
  handle.previewVideo?.pause()
  handle.previewVideo = undefined
  status.delete(mediaId)
  const ipc = getIpc()
  if (ipc && handle.localPath) await ipc.invoke('media:proxyDelete', { path: handle.localPath }).catch(() => undefined)
  emit(mediaId)
}

/** Called after a video is registered: proxy it in the background when warranted. */
export function maybeAutoProxy(handle: MediaHandle) {
  if (handle.kind !== 'video' || !getIpc() || !handle.localPath) return
  const mode = proxyMode()
  if (mode === 'off') return
  if (mode === 'always' || shouldAutoProxy(handle)) void makeProxy(handle.id)
}

onVideoRegistered(maybeAutoProxy)
