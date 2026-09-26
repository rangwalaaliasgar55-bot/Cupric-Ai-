import { clamp, cx } from '../lib/utils'

export function ProgressBar({ pct, className }: { pct: number; className?: string }) {
  return (
    <div
      role="progressbar"
      aria-valuenow={Math.round(clamp(pct, 0, 100))}
      aria-valuemin={0}
      aria-valuemax={100}
      className={cx('h-1 w-full overflow-hidden rounded-full bg-line', className)}
    >
      <div
        className="h-full rounded-full bg-accent transition-[width] duration-150 ease-linear"
        style={{ width: `${clamp(pct, 0, 100)}%` }}
      />
    </div>
  )
}
