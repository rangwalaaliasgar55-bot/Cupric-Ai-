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
        'flex min-h-56 w-full flex-col items-center justify-center gap-2.5 ' +
          'rounded-xl border border-dashed border-line bg-panel/40 px-8 py-12 text-center',
        className,
      )}
    >
      <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-line bg-panel-alt text-muted">
        <Icon size={19} />
      </div>
      <div className="text-base font-semibold">{title}</div>
      {hint && <p className="max-w-sm text-sm leading-relaxed text-muted">{hint}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  )
}
