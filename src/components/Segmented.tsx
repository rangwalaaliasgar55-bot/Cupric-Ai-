import type { ReactNode } from 'react'
import { cx } from '../lib/utils'

export type SegmentedOption<T extends string> = {
  value: T
  label: string
  icon?: ReactNode
}

/** Segmented control — one active pill, keyboard/AT friendly. */
export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
  className,
}: {
  label: string
  value: T
  options: SegmentedOption<T>[]
  onChange: (v: T) => void
  className?: string
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={cx('inline-flex items-center gap-0.5 rounded-lg border border-line bg-panel-alt p-0.5', className)}
    >
      {options.map((o) => {
        const active = value === o.value
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(o.value)}
            className={cx(
              'inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium transition-colors duration-150',
              active ? 'border-line bg-panel text-text' : 'border-transparent text-muted hover:text-text',
            )}
          >
            {o.icon}
            {o.label}
          </button>
        )
      })}
    </div>
  )
}
