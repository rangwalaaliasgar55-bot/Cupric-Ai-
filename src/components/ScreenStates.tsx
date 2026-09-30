/**
 * Screen states — the four states every screen owes the person looking at it.
 *
 * Phase 3's rule: empty, loading (with real progress), success, and error with a
 * way out. `EmptyState` already existed and is good; what was missing is the
 * other three being *available as a kit*, so a screen that loads its own data has
 * an obvious, consistent way to say "still working", "that failed, try again",
 * and "it worked" instead of inventing a spinner or, worse, showing nothing.
 *
 * Design decisions worth stating:
 *   - **`ErrorState` always offers a retry** (unless the caller genuinely cannot
 *     retry, in which case it says what to do instead). A dead end is the one
 *     thing an error card must never be.
 *   - **`LoadingState` takes real progress when it has it.** A percentage is a
 *     promise that something is moving; an indeterminate bar is honest about not
 *     knowing. Passing `pct={null}` gets the honest one.
 *   - Both announce themselves (`role="status"` / `role="alert"`) and are
 *     labelled, so a screen reader user gets the same four states.
 */
import { AlertTriangle, Loader2, RotateCw } from 'lucide-react'
import type { ReactNode } from 'react'
import { Button } from './Button'
import { cx } from '../lib/utils'

/** "Still working" — with a real percentage only when one exists. */
export function LoadingState({
  label = 'Loading',
  pct = null,
  hint,
  className,
}: {
  label?: string
  /** 0–100 when the work reports progress, `null` when it cannot. */
  pct?: number | null
  hint?: string
  className?: string
}) {
  const known = typeof pct === 'number' && Number.isFinite(pct)
  const clamped = known ? Math.max(0, Math.min(100, Math.round(pct))) : null
  return (
    <div
      className={cx('flex flex-col items-center justify-center gap-3 px-8 py-12 text-center', className)}
      role="status"
      aria-live="polite"
      aria-busy="true"
      aria-label={known ? `${label}, ${clamped}% complete` : `${label} in progress`}
    >
      <div className="flex items-center gap-2 text-sm text-muted">
        <Loader2 size={15} className="animate-spin text-accent-text motion-reduce:animate-none" aria-hidden />
        <span>{label}</span>
        {known && <span className="font-mono tabular-nums text-text">{clamped}%</span>}
      </div>
      {known ? (
        <div className="h-1 w-56 overflow-hidden rounded bg-line">
          <div className="h-1 rounded bg-accent transition-[width] duration-200 motion-reduce:transition-none" style={{ width: `${clamped}%` }} />
        </div>
      ) : (
        <div className="h-1 w-56 overflow-hidden rounded bg-line">
          <div className="h-1 w-1/3 animate-pulse rounded bg-muted/60 motion-reduce:animate-none motion-reduce:w-full" />
        </div>
      )}
      {hint && <p className="max-w-sm text-xs leading-relaxed text-muted">{hint}</p>}
    </div>
  )
}

/**
 * "That failed" — with the reason, and with something to press.
 *
 * `onRetry` is almost always the right answer. When it is genuinely absent the
 * caller must pass `nextStep`, so the card can still tell the person what to do;
 * the component refuses to render an error with no way forward.
 */
export function ErrorState({
  title = 'That did not work',
  message,
  onRetry,
  retryLabel = 'Try again',
  nextStep,
  details,
  className,
}: {
  title?: string
  message: string
  onRetry?: () => void
  retryLabel?: string
  /** What to do when retrying is pointless ("check the file still exists"). */
  nextStep?: string
  /** Technical detail, shown small and un-truncated for a support report. */
  details?: string | null
  className?: string
}) {
  return (
    <div
      className={cx(
        'flex flex-col items-center justify-center gap-3 rounded-xl border border-danger/30 bg-danger/[0.06] px-8 py-10 text-center',
        className,
      )}
      role="alert"
    >
      <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-danger/40 bg-panel text-danger" aria-hidden>
        <AlertTriangle size={19} />
      </div>
      <div className="text-sm font-semibold tracking-[var(--tracking-display)]">{title}</div>
      <p className="max-w-md text-sm leading-relaxed text-muted">{message}</p>
      {nextStep && <p className="max-w-md text-xs leading-relaxed text-muted/80">{nextStep}</p>}
      {onRetry ? (
        <Button size="sm" variant="outline" onClick={onRetry}>
          <RotateCw size={13} aria-hidden /> {retryLabel}
        </Button>
      ) : !nextStep ? (
        // Should never happen: the caller forgot both. Loud in dev, harmless in
        // production, and never a silently dead-end card for the user.
        <p className="max-w-md text-xs text-danger">This failure has no retry and no next step — that is a bug in this screen.</p>
      ) : null}
      {details && (
        <details className="mt-1 w-full max-w-md text-left">
          <summary className="cursor-pointer text-[11px] text-muted/70">Technical detail</summary>
          <pre className="mt-1.5 max-h-32 overflow-auto whitespace-pre-wrap break-words rounded-md bg-bg/70 p-2 font-mono text-[11px] leading-relaxed text-muted">{details}</pre>
        </details>
      )}
    </div>
  )
}

/**
 * A small wrapper for the common shape: a screen that fetches once.
 *
 * It exists so screens stop hand-rolling `useEffect` + `useState` triples and
 * forgetting the retry button. `run` must be idempotent; `deps` behaves like
 * `useEffect`'s.
 */
export function ScreenState({
  state,
  onRetry,
  retryLabel,
  nextStep,
  details,
  loadingLabel,
  pct,
  className,
  children,
}: {
  state: { status: 'loading' | 'error' | 'ready'; message?: string }
  onRetry?: () => void
  retryLabel?: string
  nextStep?: string
  details?: string | null
  loadingLabel?: string
  pct?: number | null
  className?: string
  children: ReactNode
}): ReactNode {
  if (state.status === 'loading') return <LoadingState label={loadingLabel} pct={pct} className={className} />
  if (state.status === 'error') {
    return (
      <ErrorState
        message={state.message || 'Something went wrong.'}
        onRetry={onRetry}
        retryLabel={retryLabel}
        nextStep={nextStep}
        details={details}
        className={className}
      />
    )
  }
  return children
}
