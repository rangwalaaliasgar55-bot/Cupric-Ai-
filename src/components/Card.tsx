import type { HTMLAttributes } from 'react'
import { cx } from '../lib/utils'

/**
 * Surface card — gradient panel with a 1px sheen (Mantine Paper + Magic UI
 * border feel). `interactive` adds the hover lift used for clickable tiles.
 */
export function Card({ className, interactive, ...rest }: HTMLAttributes<HTMLDivElement> & { interactive?: boolean }) {
  return (
    <div
      className={cx(
        'cu-panel',
        interactive && 'transition-[border-color,box-shadow,transform] duration-200 ease-[var(--ease-soft)] hover:-translate-y-px hover:border-text/15 hover:shadow-[var(--shadow-sheen),var(--shadow-2)]',
        className,
      )}
      {...rest}
    />
  )
}
