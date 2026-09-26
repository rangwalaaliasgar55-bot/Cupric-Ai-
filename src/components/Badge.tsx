import type { HTMLAttributes } from 'react'
import { cx } from '../lib/utils'

type Tone = 'neutral' | 'accent' | 'info' | 'danger'

const tones: Record<Tone, string> = {
  neutral: 'border-line bg-panel-alt text-muted',
  accent: 'border-accent/30 bg-accent/10 text-accent-text',
  info: 'border-info/30 bg-info/10 text-info',
  danger: 'border-danger/30 bg-danger/10 text-danger',
}

export function Badge({
  tone = 'neutral',
  className,
  ...rest
}: HTMLAttributes<HTMLSpanElement> & { tone?: Tone }) {
  return (
    <span
      className={cx(
        'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium',
        tones[tone],
        className,
      )}
      {...rest}
    />
  )
}
