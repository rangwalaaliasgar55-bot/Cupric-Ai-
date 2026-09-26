import type { HTMLAttributes } from 'react'
import { cx } from '../lib/utils'

export function Kbd({ className, ...rest }: HTMLAttributes<HTMLElement>) {
  return (
    <kbd
      className={cx(
        'inline-flex h-5 min-w-5 items-center justify-center rounded-md border border-line ' +
          'bg-panel-alt px-1 font-mono text-xs text-muted',
        className,
      )}
      {...rest}
    />
  )
}
