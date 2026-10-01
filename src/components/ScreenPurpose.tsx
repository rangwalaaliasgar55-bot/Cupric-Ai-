/**
 * ScreenPurpose — "what is this screen for", in one line, at the top of it.
 *
 * Phase 1.5 asked the two desks to explain themselves in the app instead of in a
 * document. The failure mode it fixes is real: Arena Desk and Footage Desk both
 * look like file browsers, and a person who does not already know the difference
 * has no way to find out from the UI (the README is not in the app).
 *
 * It is dismissible **per screen** and the dismissal is remembered, because a
 * line of prose that cannot be closed becomes clutter for the person who already
 * read it. `data-screen-purpose` is what `scripts/check-phase3-ui.mjs` looks for.
 */
import { useState } from 'react'
import { Info, X } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { cx } from '../lib/utils'

const KEY_PREFIX = 'newbrand.purpose.dismissed.'

function readDismissed(id: string): boolean {
  try {
    return typeof localStorage !== 'undefined' && localStorage.getItem(KEY_PREFIX + id) === '1'
  } catch {
    return false
  }
}

export function ScreenPurpose({
  id,
  icon: Icon = Info,
  title,
  what,
  next,
  className,
}: {
  /** Stable id for the remembered dismissal (usually the view name). */
  id: string
  icon?: LucideIcon
  title: string
  /** One sentence: what this screen is for. */
  what: string
  /** One sentence: what to do here first. Optional but usually worth saying. */
  next?: string
  className?: string
}) {
  const [hidden, setHidden] = useState(() => readDismissed(id))
  if (hidden) return null
  return (
    <div
      data-screen-purpose={id}
      className={cx('flex items-start gap-2.5 rounded-xl border border-line bg-panel-alt/40 px-3.5 py-2.5', className)}
    >
      <Icon size={15} className="mt-0.5 shrink-0 text-accent-text" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="text-xs font-semibold text-text">{title}</p>
        <p className="mt-0.5 text-xs leading-relaxed text-muted">
          {what}
          {next && <> {next}</>}
        </p>
      </div>
      <button
        type="button"
        aria-label={`Hide the explanation of ${title}`}
        className="shrink-0 rounded-md p-1 text-muted transition-colors duration-150 hover:bg-panel hover:text-text"
        onClick={() => {
          try {
            localStorage.setItem(KEY_PREFIX + id, '1')
          } catch {
            // Remembering is a nicety; failing to remember must not block hiding.
          }
          setHidden(true)
        }}
      >
        <X size={13} />
      </button>
    </div>
  )
}
