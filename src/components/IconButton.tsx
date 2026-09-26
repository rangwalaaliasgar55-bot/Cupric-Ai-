import type { ButtonHTMLAttributes } from 'react'
import { cx } from '../lib/utils'

/** Icon-only button — aria-label is required (finish-pass rule). */
export type IconButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & { label: string }

export function IconButton({ label, className, type = 'button', ...rest }: IconButtonProps) {
  return (
    <button
      type={type}
      aria-label={label}
      title={label}
      className={cx(
        'inline-flex h-8 w-8 items-center justify-center rounded-lg text-muted ' +
          'transition-[background-color,color,transform] duration-150 hover:bg-panel-alt hover:text-text ' +
          'active:scale-[0.96] disabled:pointer-events-none disabled:opacity-40',
        className,
      )}
      {...rest}
    />
  )
}
