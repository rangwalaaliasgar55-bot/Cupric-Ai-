/**
 * Unified desktop bridge accessor.
 * Prefer `window.cupric`; keep `northframe` as legacy alias from preload.
 */

export type CupricIpc = {
  invoke: (channel: string, payload?: unknown) => Promise<unknown>
  on: (channel: string, callback: (payload: unknown) => void) => () => void
}

export type CupricBridge = {
  isDesktop: boolean
  platform: string
  versions: { electron: string; chrome: string; node: string }
  filePathFor: (file: File) => string | null
  ipc: CupricIpc
  paths: { arenaPreviewUrl: (localPath: string) => Promise<unknown> }
}

declare global {
  interface Window {
    cupric?: CupricBridge
    northframe?: CupricBridge
  }
}

export function getBridge(): CupricBridge | null {
  if (typeof window === 'undefined') return null
  return window.cupric ?? window.northframe ?? null
}

export function getIpc(): CupricIpc | null {
  return getBridge()?.ipc ?? null
}

export function isDesktop(): boolean {
  return Boolean(getBridge()?.isDesktop)
}
