import type { ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import { cx } from '../lib/utils'

/** Empty state with exactly one action (finish-pass rule). */
export function EmptyState({
  icon: Icon,
  title,
  hint,
  action,
  className,
}: {
  icon: LucideIcon
  title: string
  hint?: string
  action?: ReactNode
  className?: string
}) {
  return (
    <div
      className={cx(
        'cu-dot-grid relative flex min-h-56 w-full flex-col items-center justify-center gap-2.5 overflow-hidden ' +
          'rounded-xl border border-dashed border-line bg-panel/40 px-8 py-12 text-center',
        className,
      )}
    >
      {/* Aceternity-style spotlight behind the icon; static, no motion. */}
      <div aria-hidden className="pointer-events-none absolute left-1/2 top-1/2 h-56 w-56 -translate-x-1/2 -translate-y-[70%] rounded-full bg-accent/[0.07] blur-3xl" />
      <div className="relative flex h-12 w-12 items-center justify-center rounded-2xl border border-line bg-gradient-to-b from-panel-alt to-panel text-accent-text shadow-[var(--shadow-sheen),var(--shadow-2)]">
        <Icon size={20} />
      </div>
      <div className="relative mt-1 text-md font-semibold tracking-[var(--tracking-display)]">{title}</div>
      {hint && <p className="relative max-w-sm text-sm leading-relaxed text-muted">{hint}</p>}
      {action && <div className="relative mt-2">{action}</div>}
    </div>
  )
}
