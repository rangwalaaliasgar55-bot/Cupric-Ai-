/**
 * Never a white screen (0.10.1).
 *
 * Three layers, from narrowest to widest:
 *   1. Per-route React error boundaries (app-shell/ErrorBoundary.tsx) — a
 *      screen that throws while rendering or in an effect is replaced by a
 *      fallback card; the sidebar and every other screen keep working.
 *   2. Global `error` / `unhandledrejection` listeners (this file) — errors
 *      outside React show a dismissible global card instead of vanishing.
 *   3. A last-resort plain-DOM card (renderFatalFallback) for when React
 *      itself is gone: the root rendered nothing after an error, or React
 *      reported an uncaught error at the root. It needs no React, no store
 *      and no CSS bundle, so it still works when those are what broke.
 *
 * Every layer offers the same three things: the project id, "Copy error" and
 * "Go to Library" (which also switches the saved view, so a restart does not
 * boot straight back into the broken screen).
 */
import { describeBridge } from './bridge'
import { recentRendererErrors } from './diagnostics'
import { rlog } from './log'

export type CrashContext = { route?: string | null; projectId?: string | null; view?: string | null }
export type GlobalCrash = { id: number; kind: 'error' | 'unhandledrejection'; message: string; stack?: string; count: number }

type Listener = (crashes: GlobalCrash[]) => void

let crashes: GlobalCrash[] = []
const listeners = new Set<Listener>()
let installed = false
let seq = 0
/** Filled in by the app once the store exists, so this module stays store-free. */
let contextProvider: () => CrashContext = () => ({})
let goToLibrary: () => void = () => {}

export function setCrashContextProvider(fn: () => CrashContext, onGoToLibrary: () => void) {
  contextProvider = fn
  goToLibrary = onGoToLibrary
}

export function crashContext(): CrashContext {
  try {
    return contextProvider()
  } catch {
    return {}
  }
}

export function requestGoToLibrary() {
  try {
    goToLibrary()
  } catch (err) {
    rlog.error('crash', 'Go to Library failed', err)
  }
}

export function subscribeGlobalCrashes(fn: Listener): () => void {
  listeners.add(fn)
  fn(crashes)
  return () => listeners.delete(fn)
}

export function dismissGlobalCrash(id: number) {
  crashes = crashes.filter((c) => c.id !== id)
  listeners.forEach((l) => l(crashes))
}

/**
 * Browser noise that is not an application failure. "Script error." is NOT
 * here on purpose: it is what a muted error looks like, and hiding it could
 * hide a real crash — it is shown with a pointer to the log instead.
 */
const BENIGN = [/ResizeObserver loop/i]
const MUTED = /^Script error\.?$/

function errorParts(value: unknown): { message: string; stack?: string } {
  if (value instanceof Error) return { message: `${value.name}: ${value.message}`, stack: value.stack }
  if (typeof value === 'string') return { message: value }
  try {
    return { message: JSON.stringify(value) ?? String(value) }
  } catch {
    return { message: String(value) }
  }
}

function pushGlobal(kind: GlobalCrash['kind'], value: unknown, fallbackMessage?: string) {
  const parts = value === undefined || value === null ? { message: fallbackMessage ?? 'Unknown error' } : errorParts(value)
  if (BENIGN.some((re) => re.test(parts.message))) return
  if (MUTED.test(parts.message)) parts.message = 'Script error (the browser hid the details — the full error is in the log file under userData/logs).'
  rlog.error('crash', `${kind}: ${parts.message}`, { stack: parts.stack?.split('\n').slice(0, 12).join('\n'), ...crashContext() })
  const existing = crashes.find((c) => c.message === parts.message)
  if (existing) crashes = crashes.map((c) => (c === existing ? { ...c, count: c.count + 1 } : c))
  else crashes = [...crashes, { id: ++seq, kind, message: parts.message, stack: parts.stack, count: 1 }].slice(-3)
  listeners.forEach((l) => l(crashes))
  scheduleBlankCheck()
}

/** If React rendered nothing after an error, it is gone — show the DOM card. */
function scheduleBlankCheck() {
  window.setTimeout(() => {
    const root = document.getElementById('root')
    if (root && root.childElementCount === 0 && !document.getElementById('newbrand-fatal')) {
      renderFatalFallback(crashes.at(-1)?.message ?? 'The interface stopped rendering.', crashes.at(-1)?.stack)
    }
  }, 50)
}

export function installCrashGuard() {
  if (installed || typeof window === 'undefined') return
  installed = true
  window.addEventListener('error', (event) => {
    // Resource load failures (img/script 404) bubble here without an error.
    if (!event.error && !event.message) return
    pushGlobal('error', event.error, event.message)
  })
  window.addEventListener('unhandledrejection', (event) => pushGlobal('unhandledrejection', event.reason, 'Unhandled promise rejection'))
}

export function buildErrorReport(error: unknown, ctx: CrashContext & { componentStack?: string | null } = {}): string {
  const { message, stack } = errorParts(error)
  const version = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'unknown'
  let bridge = 'unknown'
  try {
    bridge = JSON.stringify(describeBridge())
  } catch {}
  let recent: string[] = []
  try {
    recent = recentRendererErrors().slice(-12)
  } catch {}
  return [
    `NewBrand ${version} — ${ctx.route ? `"${ctx.route}" screen crashed` : 'error'}`,
    `Project: ${ctx.projectId ?? '(none)'}`,
    `View: ${ctx.view ?? '(unknown)'}`,
    `Bridge: ${bridge}`,
    `Agent: ${typeof navigator !== 'undefined' ? navigator.userAgent : ''}`,
    '',
    `Error: ${message}`,
    stack ? stack.split('\n').slice(0, 20).join('\n') : '',
    ctx.componentStack ? `\nComponent stack:${ctx.componentStack.split('\n').slice(0, 20).join('\n')}` : '',
    recent.length ? `\nRecent renderer errors:\n${recent.join('\n')}` : '',
    '',
    'Stuck on a blank screen after restarting? Quit NewBrand, open projects.json in the app data folder and change "view":"studio" to "view":"library".',
  ]
    .filter((line) => line !== '')
    .join('\n')
}

/** Copy text; resolves false (never throws) so callers can show the text instead. */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    try {
      const area = document.createElement('textarea')
      area.value = text
      area.style.position = 'fixed'
      area.style.opacity = '0'
      document.body.appendChild(area)
      area.select()
      const ok = document.execCommand('copy')
      area.remove()
      return ok
    } catch {
      return false
    }
  }
}

/**
 * Plain-DOM fallback. Inline styles only: the CSS bundle may be what failed.
 */
export function renderFatalFallback(message: string, stack?: string) {
  if (typeof document === 'undefined' || document.getElementById('newbrand-fatal')) return
  const ctx = crashContext()
  const report = buildErrorReport(stack ? Object.assign(new Error(message), { stack }) : message, ctx)
  rlog.error('crash', 'fatal fallback shown', { message, ...ctx })
  const host = document.createElement('div')
  host.id = 'newbrand-fatal'
  host.setAttribute('data-newbrand-fallback', 'fatal')
  host.setAttribute('role', 'alert')
  host.style.cssText = 'position:fixed;inset:0;z-index:2147483647;display:grid;place-items:center;background:#0B0B10;color:#F4F1EA;font:14px/1.5 system-ui,Segoe UI,Arial,sans-serif;padding:24px'
  const card = document.createElement('div')
  card.style.cssText = 'max-width:560px;width:100%;border:1px solid rgba(255,255,255,.12);border-radius:16px;background:#15151B;padding:24px'
  const h = document.createElement('h1')
  h.textContent = 'NewBrand hit an error'
  h.style.cssText = 'font-size:18px;margin:0 0 6px'
  const p = document.createElement('p')
  p.textContent = `Your work is saved. Project: ${ctx.projectId ?? '(none)'} · View: ${ctx.view ?? '(unknown)'}`
  p.style.cssText = 'margin:0 0 10px;color:#9CA3AF'
  const pre = document.createElement('pre')
  pre.textContent = message
  pre.style.cssText = 'white-space:pre-wrap;max-height:160px;overflow:auto;background:#0B0B10;border-radius:10px;padding:10px;font:12px/1.45 ui-monospace,Consolas,monospace;color:#F5A3A3'
  const row = document.createElement('div')
  row.style.cssText = 'display:flex;gap:8px;margin-top:14px;flex-wrap:wrap'
  const button = (label: string, primary: boolean, onClick: (b: HTMLButtonElement) => void) => {
    const b = document.createElement('button')
    b.type = 'button'
    b.textContent = label
    b.style.cssText = `border:0;border-radius:10px;padding:8px 12px;font-weight:700;cursor:pointer;${primary ? 'background:#C8F542;color:#10130A' : 'background:#23232B;color:#F4F1EA'}`
    b.onclick = () => onClick(b)
    row.appendChild(b)
  }
  button('Copy error', false, (b) => {
    void copyText(report).then((ok) => {
      b.textContent = ok ? 'Copied' : 'Copy blocked — text shown below'
      if (!ok) pre.textContent = report
    })
  })
  button('Go to Library', true, () => {
    requestGoToLibrary()
    // Give the store a moment to persist view:"library", then reload clean.
    window.setTimeout(() => window.location.reload(), 250)
  })
  button('Reload', false, () => window.location.reload())
  card.append(h, p, pre, row)
  host.appendChild(card)
  document.body.appendChild(host)
}
