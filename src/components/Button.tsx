import { forwardRef, type ButtonHTMLAttributes } from 'react'
import { cx } from '../lib/utils'

type Variant = 'primary' | 'outline' | 'ghost' | 'danger'
type Size = 'sm' | 'md'

const base =
  'inline-flex select-none items-center justify-center gap-2 rounded-lg font-medium ' +
  'transition-[background-color,border-color,color,transform] duration-150 ease-out ' +
  'active:scale-[0.96] disabled:pointer-events-none disabled:opacity-40'

const variants: Record<Variant, string> = {
  primary: 'bg-accent font-semibold text-accent-ink hover:bg-accent-hover',
  outline: 'border border-line text-text hover:bg-panel-alt',
  ghost: 'text-muted hover:bg-panel-alt hover:text-text',
  danger: 'border border-danger/40 text-danger hover:bg-danger/10',
}

const sizes: Record<Size, string> = {
  sm: 'h-8 px-3 text-xs',
  md: 'h-9 px-4 text-sm',
}

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant
  size?: Size
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'outline', size = 'md', className, type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cx(base, variants[variant], sizes[size], className)}
      {...rest}
    />
  )
})
