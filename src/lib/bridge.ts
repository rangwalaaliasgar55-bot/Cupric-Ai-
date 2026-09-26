/**
 * Unified desktop bridge accessor.
 * Prefer `window.cupric`; keep `northframe` as legacy alias from preload.
 */

/**
 * IPC payloads cross a process boundary, so their shape is only known to the
 * handler in electron/main.cjs. Callers annotate what they expect at the call
 * site; the bridge itself stays deliberately untyped rather than pretending to
 * validate anything.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
export type CupricIpc = {
  invoke: (channel: string, payload?: unknown) => Promise<any>
  on: (channel: string, callback: (payload: any) => void) => () => void
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
