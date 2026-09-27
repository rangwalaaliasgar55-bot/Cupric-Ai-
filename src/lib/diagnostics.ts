/**
 * Renderer half of the one-click diagnostic report (2.27).
 *
 * Keeps a small ring of recent console errors/warnings and uncaught errors
 * from the app window, then asks the main process to assemble and redact the
 * full report. In the web build there is no main process, so a shorter report
 * is built here with the same redaction rules for keys and tokens.
 */
import { getBridge, getIpc } from './bridge'

const MAX = 60
const ring: string[] = []
let installed = false

function remember(kind: string, parts: unknown[]) {
  const text = parts
    .map((p) => (p instanceof Error ? `${p.name}: ${p.message}` : typeof p === 'string' ? p : (() => { try { return JSON.stringify(p) } catch { return String(p) } })()))
    .join(' ')
    .slice(0, 600)
  ring.push(`${new Date().toISOString()} [${kind}] ${text}`)
  if (ring.length > MAX) ring.splice(0, ring.length - MAX)
}

/** Call once at startup. Wraps console.error/warn without changing their output. */
export function installDiagnostics() {
  if (installed || typeof window === 'undefined') return
  installed = true
  const origError = console.error.bind(console)
  const origWarn = console.warn.bind(console)
  console.error = (...args: unknown[]) => {
    remember('error', args)
    origError(...args)
  }
  console.warn = (...args: unknown[]) => {
    remember('warn', args)
    origWarn(...args)
  }
  window.addEventListener('error', (e) => remember('uncaught', [e.message, e.filename ? `${e.filename}:${e.lineno}` : '']))
  window.addEventListener('unhandledrejection', (e) => remember('unhandled-rejection', [e.reason]))
}

export function recentRendererErrors(): string[] {
  return [...ring]
}

const REDACT: [RegExp, string][] = [
  [/AIza[0-9A-Za-z_-]{20,}/g, '[redacted-google-key]'],
  [/\bsk-(?:or-|proj-|ant-)?[0-9A-Za-z_-]{16,}/g, '[redacted-key]'],
  [/(Bearer\s+)[0-9A-Za-z._~+/=-]{8,}/gi, '$1[redacted]'],
  [/([?&](?:key|api_key|apikey|token|access_token|secret)=)[^&\s"']+/gi, '$1[redacted]'],
]

export function redactForReport(text: string): string {
  return REDACT.reduce((out, [re, rep]) => out.replace(re, rep), text)
}

export async function buildDiagnosticReport(): Promise<string> {
  const ipc = getIpc()
  if (ipc) return String(await ipc.invoke('diag:report', { rendererErrors: recentRendererErrors() }))
  const bridge = getBridge()
  const lines = [
    '=== Cupric AI diagnostic report (web build) ===',
    `Generated: ${new Date().toISOString()}`,
    `App version: ${typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'unknown'}`,
    `Browser: ${navigator.userAgent}`,
    `Desktop bridge: ${bridge ? 'yes' : 'no'}`,
    `Screen: ${window.screen.width}×${window.screen.height} @${window.devicePixelRatio}x`,
    '',
    '--- Recent warnings & errors ---',
    ring.length ? ring.join('\n') : '(none)',
    '',
    '(API keys and tokens are removed from this report.)',
  ]
  return redactForReport(lines.join('\n'))
}

/** Copy the report to the clipboard; returns the text so the UI can show it if copying is blocked. */
export async function copyDiagnosticReport(): Promise<{ text: string; copied: boolean }> {
  const text = await buildDiagnosticReport()
  try {
    await navigator.clipboard.writeText(text)
    return { text, copied: true }
  } catch {
    return { text, copied: false }
  }
}
