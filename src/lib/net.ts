/**
 * F-3 — one guarded fetch for the whole renderer.
 *
 * Production 0.13.0 logged `TypeError: Failed to fetch` eight times in a
 * single minute: a packaged app served over `file://` asking for
 * `/resources/packs/*.json`, five local `/models` probes against servers that
 * were not running, and a stock/updater poll — every one of them a bare
 * `fetch()` whose rejection reached the console.
 *
 * The rule from now on: **no renderer code calls `fetch` directly**. Every
 * network read goes through `guardedFetch`/`guardedJson`, which
 *   • short-circuits when the browser says it is offline,
 *   • always applies a timeout (an AbortController, never an open socket),
 *   • never throws and never rejects — callers get `{ ok:false, reason }`,
 *   • reports one honest, human sentence the UI can show inline,
 * so a caller can fall back to its cache or an explicit placeholder in the
 * same shape it always uses (see `resourceDrop.ts` / `resourceApply.ts`).
 */

export type NetFailure = {
  ok: false
  /** The browser (or a previous failure) says there is no network. */
  offline: boolean
  /** True when a cache/placeholder is the right answer, not an error toast. */
  expected: boolean
  /** One honest sentence, safe to render inline. */
  reason: string
  status?: number
}
export type NetSuccess<T> = { ok: true; data: T; status: number }
export type NetResult<T> = NetSuccess<T> | NetFailure

export const OFFLINE_REASON = 'You are offline — Cupric is using what it already has.'

/** `navigator.onLine` is a hint, not a promise; absence of the API means "assume online". */
export function isOnline(): boolean {
  return typeof navigator === 'undefined' ? true : navigator.onLine !== false
}

function describe(error: unknown, url: string): string {
  const message = error instanceof Error ? error.message : String(error ?? '')
  const host = (() => {
    try { return new URL(url, typeof location === 'undefined' ? 'http://localhost' : location.href).host || 'that file' } catch { return 'that address' }
  })()
  if (/abort/i.test(message)) return `${host} did not answer in time — Cupric used what it already has.`
  if (/Failed to fetch|NetworkError|Load failed/i.test(message)) return `${host} could not be reached — Cupric used what it already has.`
  return `${host} could not be read (${message.slice(0, 120)}) — Cupric used what it already has.`
}

export type GuardOptions = {
  timeoutMs?: number
  init?: RequestInit
  /** Try even when `navigator.onLine` is false (same-origin/bundled reads). */
  allowOffline?: boolean
}

/**
 * A `fetch` that resolves to a verdict instead of rejecting. Non-2xx is a
 * failure too, so callers never read a 404's HTML as JSON.
 */
export async function guardedFetch(url: string, options: GuardOptions = {}): Promise<{ ok: true; response: Response } | NetFailure> {
  const { timeoutMs = 12_000, init, allowOffline = false } = options
  if (typeof fetch === 'undefined') return { ok: false, offline: true, expected: true, reason: 'This build has no network access.' }
  if (!allowOffline && !isOnline()) return { ok: false, offline: true, expected: true, reason: OFFLINE_REASON }
  const controller = typeof AbortController === 'undefined' ? null : new AbortController()
  const timer = controller && typeof setTimeout === 'function' ? setTimeout(() => controller.abort(), timeoutMs) : null
  try {
    const response = await fetch(url, { ...init, signal: init?.signal ?? controller?.signal })
    if (!response.ok) {
      return {
        ok: false,
        offline: false,
        expected: response.status === 404,
        status: response.status,
        reason: `That request came back ${response.status}${response.statusText ? ` ${response.statusText}` : ''} — Cupric used what it already has.`,
      }
    }
    return { ok: true, response }
  } catch (error) {
    return { ok: false, offline: !isOnline(), expected: true, reason: describe(error, url) }
  } finally {
    if (timer) clearTimeout(timer)
  }
}

/** JSON flavour. A body that is not JSON is a failure, not a crash. */
export async function guardedJson<T>(url: string, options: GuardOptions = {}): Promise<NetResult<T>> {
  const result = await guardedFetch(url, options)
  if (!result.ok) return result
  try {
    return { ok: true, data: (await result.response.json()) as T, status: result.response.status }
  } catch (error) {
    return { ok: false, offline: false, expected: true, reason: describe(error, url) }
  }
}

/** Text flavour, same contract. */
export async function guardedText(url: string, options: GuardOptions = {}): Promise<NetResult<string>> {
  const result = await guardedFetch(url, options)
  if (!result.ok) return result
  try {
    return { ok: true, data: await result.response.text(), status: result.response.status }
  } catch (error) {
    return { ok: false, offline: false, expected: true, reason: describe(error, url) }
  }
}

/** Blob flavour, for fonts/icons/media the UI can also live without. */
export async function guardedBlob(url: string, options: GuardOptions = {}): Promise<NetResult<Blob>> {
  const result = await guardedFetch(url, options)
  if (!result.ok) return result
  try {
    return { ok: true, data: await result.response.blob(), status: result.response.status }
  } catch (error) {
    return { ok: false, offline: false, expected: true, reason: describe(error, url) }
  }
}

/** Subscribe to connectivity changes; returns an unsubscribe. */
export function onConnectivityChange(handler: (online: boolean) => void): () => void {
  if (typeof window === 'undefined') return () => {}
  const online = () => handler(true)
  const offline = () => handler(false)
  window.addEventListener('online', online)
  window.addEventListener('offline', offline)
  return () => {
    window.removeEventListener('online', online)
    window.removeEventListener('offline', offline)
  }
}
