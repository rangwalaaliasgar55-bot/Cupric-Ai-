import type { HTMLAttributes } from 'react'
import { cx } from '../lib/utils'

export function Card({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cx('rounded-xl border border-line bg-panel', className)} {...rest} />
}
