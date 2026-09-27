/**
 * Unified desktop bridge accessor.
 *
 * The preload exposes ONE frozen bridge object under two names with
 * `contextBridge.exposeInMainWorld` — `window.cupric` and the legacy alias
 * `window.northframe`. contextBridge defines those properties NON-WRITABLE and
 * NON-CONFIGURABLE, so in the packaged app any `window.cupric = …` or
 * `delete window.cupric.x` throws "Cannot assign to read only property
 * 'cupric' of object '#<Window>'". In 0.10.0 the Studio did exactly that on
 * mount, React unmounted the whole tree, and the window went white. The web
 * build has no bridge, so it never showed there.
 *
 * Rules (enforced by `npm run check:bridge` — ESLint + source scan + a
 * type-level fixture):
 *   - Renderer code reads the bridge through getBridge()/getIpc() only.
 *   - Nothing assigns to, deletes from, or defineProperty's window.cupric /
 *     window.northframe — the types below make direct assignment a TS error.
 *   - Renderer-owned globals get their own names (e.g. window.__cupricStudio).
 */
import type { StudioApi } from './studio/studioApi'

/**
 * IPC payloads cross a process boundary, so their shape is only known to the
 * handler in electron/main.cjs. Callers annotate what they expect at the call
 * site; the bridge itself stays deliberately untyped rather than pretending to
 * validate anything.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
export type CupricIpc = {
  readonly invoke: (channel: string, payload?: unknown) => Promise<any>
  readonly on: (channel: string, callback: (payload: any) => void) => () => void
}

export type CupricBridge = {
  readonly isDesktop: boolean
  readonly platform: string
  readonly versions: Readonly<{ electron: string; chrome: string; node: string }>
  readonly filePathFor: (file: File) => string | null
  readonly ipc: Readonly<CupricIpc>
  readonly paths: Readonly<{ arenaPreviewUrl: (localPath: string) => Promise<unknown> }>
}

declare global {
  interface Window {
    /** Set by the preload via contextBridge — read-only. Use getBridge(). */
    readonly cupric?: Readonly<CupricBridge>
    /** Legacy alias of `cupric` (same frozen object) — read-only. */
    readonly northframe?: Readonly<CupricBridge>
    /**
     * Studio scripting API while the Studio is mounted (see studioApi.ts).
     * Renderer-owned, so it is the one global the renderer may set/delete.
     */
    __cupricStudio?: StudioApi
  }
}

export function getBridge(): Readonly<CupricBridge> | null {
  if (typeof window === 'undefined') return null
  return window.cupric ?? window.northframe ?? null
}

export function getIpc(): Readonly<CupricIpc> | null {
  return getBridge()?.ipc ?? null
}

export function isDesktop(): boolean {
  return Boolean(getBridge()?.isDesktop)
}

/** For the boot log: how the bridge arrived (never mutates it). */
export function describeBridge(): { present: boolean; name: 'cupric' | 'northframe' | null; readOnly: boolean | null; frozen: boolean | null } {
  if (typeof window === 'undefined') return { present: false, name: null, readOnly: null, frozen: null }
  const name = window.cupric ? 'cupric' : window.northframe ? 'northframe' : null
  if (!name) return { present: false, name: null, readOnly: null, frozen: null }
  const desc = Object.getOwnPropertyDescriptor(window, name)
  return { present: true, name, readOnly: desc ? desc.writable === false || (!desc.set && !('value' in desc)) : null, frozen: Object.isFrozen(window[name]) }
}
