/**
 * F-2 — one place that turns a desktop path into something the renderer can
 * play, and one honest answer when it cannot.
 *
 * The main process owns the project-data sandbox (`electron/path-sandbox.cjs`).
 * When it refuses a path it sends back the reason *and* the path, so the UI
 * can say which file it means and offer "Reveal folder" — never a bare IPC
 * rejection string in a toast, never a dialog.
 */

import { getIpc } from './bridge'

export type PreviewPathOk = { ok: true; url: string }
export type PreviewPathRefused = { ok: false; message: string; path: string; canReveal: boolean }
export type PreviewPathResult = PreviewPathOk | PreviewPathRefused

const BROWSER_URL = /^(blob|data|https?|file):/i

/** Does this error carry the main process's sandbox refusal? */
function refusalOf(error: unknown): { message: string; path: string } | null {
  const message = error instanceof Error ? error.message : String(error ?? '')
  if (!message) return null
  if (!/outside its|can only preview files it wrote/i.test(message)) return null
  const quoted = message.match(/[“"]([^”"]+)[”"]/)
  return { message: message.replace(/^Error invoking remote method '[^']+':\s*Error:\s*/, ''), path: quoted?.[1] ?? '' }
}

export async function resolvePreviewUrl(localPath: string): Promise<PreviewPathResult> {
  const path = String(localPath || '')
  if (!path) return { ok: false, message: 'That clip has no file on disk yet.', path: '', canReveal: false }
  if (BROWSER_URL.test(path)) return { ok: true, url: path }
  const ipc = getIpc()
  if (!ipc) return { ok: false, message: 'This file lives on disk — open the desktop app to use it here.', path, canReveal: false }
  try {
    const url = (await ipc.invoke('arena:previewPath', path)) as string
    if (!url) throw new Error('The main process returned no preview URL.')
    return { ok: true, url }
  } catch (error) {
    const refusal = refusalOf(error)
    if (refusal) return { ok: false, message: refusal.message, path: refusal.path || path, canReveal: true }
    return { ok: false, message: error instanceof Error ? error.message : String(error), path, canReveal: true }
  }
}

/** Open the OS file browser on a path. Resolves false when it is gone. */
export async function revealPath(target: string): Promise<boolean> {
  const ipc = getIpc()
  if (!ipc || !target) return false
  try {
    return Boolean(await ipc.invoke('path:reveal', target))
  } catch {
    return false
  }
}
