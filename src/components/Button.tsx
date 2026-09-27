import { forwardRef, type ButtonHTMLAttributes } from 'react'
import { cx } from '../lib/utils'

type Variant = 'primary' | 'outline' | 'ghost' | 'danger'
type Size = 'sm' | 'md'

/*
 * Mantine-style sizing (sm 32 / md 36) with a Magic UI-style sheen on primary:
 * a 1px top highlight plus an accent glow on hover. Tokens only (DESIGN.md).
 */
const base =
  'relative inline-flex shrink-0 select-none items-center justify-center gap-2 whitespace-nowrap rounded-lg font-medium tracking-[var(--tracking-ui)] ' +
  'transition-[background-color,border-color,color,box-shadow,transform] duration-150 ease-[var(--ease-soft)] ' +
  'active:scale-[0.97] disabled:pointer-events-none disabled:opacity-40'

const variants: Record<Variant, string> = {
  primary:
    'bg-accent font-semibold text-accent-ink shadow-[var(--shadow-sheen),var(--shadow-1)] ' +
    'hover:bg-accent-hover hover:shadow-[var(--shadow-sheen),var(--shadow-accent-glow)]',
  outline:
    'border border-line bg-panel-alt/40 text-text shadow-[var(--shadow-sheen)] ' +
    'hover:border-text/20 hover:bg-panel-alt',
  ghost: 'text-muted hover:bg-panel-alt hover:text-text',
  danger: 'border border-danger/40 text-danger hover:border-danger/70 hover:bg-danger/10',
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
