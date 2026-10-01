/**
 * Error boundaries + fallback cards (0.10.1). See lib/crashGuard.ts for the
 * layering. A screen that throws — while rendering OR in an effect, which is
 * how 0.10.0's Studio died — shows a card here instead of taking the whole
 * window down to white.
 */
import { Component, useEffect, useState, type ErrorInfo, type ReactNode } from 'react'
import { AlertTriangle, ClipboardCopy, Library, RotateCcw, X } from 'lucide-react'
import {
  buildErrorReport,
  copyText,
  crashContext,
  dismissGlobalCrash,
  requestGoToLibrary,
  subscribeGlobalCrashes,
  type GlobalCrash,
} from '../lib/crashGuard'
import { rlog } from '../lib/log'

const FORCE_THROW_KEY = 'newbrand:debug:forceThrow'

/**
 * Test hook for check:boot and manual QA: with
 * `sessionStorage['newbrand:debug:forceThrow'] = '<route>'` that route throws
 * during render, so the fallback path can be verified in a packaged build.
 */
function ForceThrow({ route }: { route: string }) {
  let forced: string | null = null
  try {
    forced = window.sessionStorage.getItem(FORCE_THROW_KEY)
  } catch {}
  if (forced && (forced === route || forced === '*')) throw new Error(`Forced test error in "${route}" (sessionStorage ${FORCE_THROW_KEY})`)
  return null
}

type BoundaryProps = { route: string; children: ReactNode; variant?: 'route' | 'app' }
type BoundaryState = { error: Error | null; componentStack: string | null }

export class RouteErrorBoundary extends Component<BoundaryProps, BoundaryState> {
  state: BoundaryState = { error: null, componentStack: null }

  static getDerivedStateFromError(error: unknown): Partial<BoundaryState> {
    return { error: error instanceof Error ? error : new Error(String(error)) }
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    this.setState({ componentStack: info.componentStack ?? null })
    rlog.error('boundary', `${this.props.route} crashed: ${error instanceof Error ? error.message : String(error)}`, {
      ...crashContext(),
      route: this.props.route,
      stack: error instanceof Error ? error.stack?.split('\n').slice(0, 12).join('\n') : undefined,
      componentStack: info.componentStack?.split('\n').slice(0, 12).join('\n'),
    })
  }

  reset = () => this.setState({ error: null, componentStack: null })

  render() {
    if (this.state.error) {
      return (
        <FallbackCard
          kind={this.props.variant ?? 'route'}
          route={this.props.route}
          error={this.state.error}
          componentStack={this.state.componentStack}
          onRetry={this.reset}
          onLibrary={() => {
            requestGoToLibrary()
            this.reset()
          }}
        />
      )
    }
    return (
      <>
        <ForceThrow route={this.props.route} />
        {this.props.children}
      </>
    )
  }
}

type CardProps = {
  kind: 'route' | 'app' | 'global'
  route?: string
  error: unknown
  componentStack?: string | null
  onRetry?: () => void
  onLibrary: () => void
  onDismiss?: () => void
  count?: number
}

export function FallbackCard({ kind, route, error, componentStack, onRetry, onLibrary, onDismiss, count }: CardProps) {
  const ctx = crashContext()
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'blocked'>('idle')
  const report = buildErrorReport(error, { ...ctx, route: route ?? ctx.route ?? null, componentStack })
  const message = error instanceof Error ? error.message : String(error)
  const title =
    kind === 'global' ? 'Something went wrong in the background' : kind === 'app' ? 'NewBrand hit an error' : `The ${route ?? 'current'} screen hit an error`

  const body = (
    <div
      data-newbrand-fallback={kind}
      role="alert"
      className="w-full max-w-lg rounded-2xl border border-danger/40 bg-panel/95 p-5 text-text shadow-[0_24px_80px_rgb(0_0_0/0.45)] backdrop-blur"
    >
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-danger/15 text-danger">
          <AlertTriangle size={16} />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold">
            {title}
            {count && count > 1 ? <span className="ml-1 text-muted">×{count}</span> : null}
          </h2>
          <p className="mt-1 text-xs text-muted">
            Your work is saved. Project <span className="font-mono text-text">{ctx.projectId ?? '(none)'}</span>
            {kind !== 'global' ? ' — the rest of the app still works.' : ' — you can keep working or dismiss this.'}
          </p>
        </div>
        {onDismiss && (
          <button type="button" aria-label="Dismiss" onClick={onDismiss} className="rounded-md p-1 text-muted hover:text-text">
            <X size={14} />
          </button>
        )}
      </div>
      <pre className="mt-3 max-h-40 overflow-auto whitespace-pre-wrap rounded-lg bg-bg/80 p-2.5 font-mono text-[11px] leading-relaxed text-danger">
        {copyState === 'blocked' ? report : message}
      </pre>
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => void copyText(report).then((ok) => setCopyState(ok ? 'copied' : 'blocked'))}
          className="inline-flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-xs font-medium hover:bg-panel-alt"
        >
          <ClipboardCopy size={13} /> {copyState === 'copied' ? 'Copied' : copyState === 'blocked' ? 'Copy blocked — select the text above' : 'Copy error'}
        </button>
        <button
          type="button"
          onClick={onLibrary}
          className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-accent-ink hover:brightness-110"
        >
          <Library size={13} /> Go to Library
        </button>
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            className="inline-flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-xs font-medium hover:bg-panel-alt"
          >
            <RotateCcw size={13} /> Try again
          </button>
        )}
      </div>
    </div>
  )

  if (kind === 'global') return body
  return <div className={kind === 'app' ? 'flex h-screen items-center justify-center bg-bg p-6' : 'flex h-full items-center justify-center p-6'}>{body}</div>
}

/** Errors outside React (window.onerror / unhandledrejection). */
export function GlobalErrorCards() {
  const [items, setItems] = useState<GlobalCrash[]>([])
  useEffect(() => subscribeGlobalCrashes(setItems), [])
  if (!items.length) return null
  const latest = items[items.length - 1]
  const error = Object.assign(new Error(latest.message), { stack: latest.stack })
  return (
    <div className="pointer-events-none fixed inset-x-0 top-4 z-[1000] flex justify-center px-4">
      <div className="pointer-events-auto w-full max-w-lg">
        <FallbackCard
          kind="global"
          error={error}
          count={latest.count}
          onLibrary={() => {
            requestGoToLibrary()
            items.forEach((c) => dismissGlobalCrash(c.id))
          }}
          onDismiss={() => items.forEach((c) => dismissGlobalCrash(c.id))}
        />
      </div>
    </div>
  )
}
