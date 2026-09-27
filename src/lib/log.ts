/**
 * Renderer file logging (0.10.1).
 *
 * Lines go to the main process over the allowlisted `log:write` channel and
 * land in electron-log's file under userData/logs/ next to the main-process
 * log, so a support log shows bridge init, project load/create and Studio
 * mount timings even when the window itself is blank. In the web build there
 * is no main process: lines only go to the console at debug level.
 *
 * Never throws, never awaits: logging must not be able to break the thing it
 * is logging. Timings use performance.now() — this module is not on the
 * motion/render path, and never touches Date.now/Math.random there.
 */
import { getIpc } from './bridge'

export type LogLevel = 'error' | 'warn' | 'info' | 'debug'

function safeData(data: unknown): unknown {
  if (data === undefined) return undefined
  if (data instanceof Error) return { name: data.name, message: data.message, stack: data.stack?.split('\n').slice(0, 12).join('\n') }
  try {
    const text = JSON.stringify(data)
    return text && text.length > 4000 ? `${text.slice(0, 4000)}…` : data
  } catch {
    return String(data)
  }
}

function write(level: LogLevel, scope: string, message: string, data?: unknown) {
  const payload = { level, scope: String(scope).slice(0, 40), message: String(message).slice(0, 2000), data: safeData(data) }
  try {
    const ipc = getIpc()
    if (ipc) {
      void ipc.invoke('log:write', payload).catch(() => undefined)
      return
    }
  } catch {
    /* fall through to console */
  }
  if (level === 'error') console.error(`[cupric:${payload.scope}]`, payload.message, payload.data ?? '')
  else console.debug(`[cupric:${payload.scope}]`, payload.message, payload.data ?? '')
}

export const rlog = {
  error: (scope: string, message: string, data?: unknown) => write('error', scope, message, data),
  warn: (scope: string, message: string, data?: unknown) => write('warn', scope, message, data),
  info: (scope: string, message: string, data?: unknown) => write('info', scope, message, data),
  debug: (scope: string, message: string, data?: unknown) => write('debug', scope, message, data),
}
