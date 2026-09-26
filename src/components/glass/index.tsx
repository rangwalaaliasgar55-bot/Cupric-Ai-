import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import { GlassSurface } from './GlassSurface'
import type { GlassPresetId } from '../../lib/glass'
import { cx } from '../../lib/utils'

export { GlassSurface }
export type { GlassSurfaceProps } from './GlassSurface'

/** A frosted card. Everything inside sits above the material. */
export function GlassPanel({
  children,
  preset = 'plaque',
  radius = 16,
  className,
}: {
  children: ReactNode
  preset?: GlassPresetId
  radius?: number
  className?: string
}) {
  return (
    <div
      className={cx('relative overflow-hidden border border-white/12', className)}
      style={{ borderRadius: radius }}
    >
      <GlassSurface preset={preset} radius={radius} />
      <div className="relative">{children}</div>
    </div>
  )
}

/** Glass button with the press-scale the rest of the app uses. */
export function GlassButton({
  children,
  icon: Icon,
  onClick,
  preset = 'hero',
  className,
  ...rest
}: {
  children?: ReactNode
  icon?: LucideIcon
  onClick?: () => void
  preset?: GlassPresetId
  className?: string
} & Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'onClick' | 'className'>) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cx(
        'glass-control relative isolate inline-flex select-none items-center gap-2 overflow-hidden rounded-full',
        'border border-white/14 px-4 py-2 text-sm font-medium text-text',
        'transition-transform duration-150 ease-out active:scale-[0.96]',
        className,
      )}
      {...rest}
    >
      <GlassSurface preset={preset} radius={999} reveal />
      {Icon && <Icon size={15} className="relative" />}
      {children && <span className="relative">{children}</span>}
    </button>
  )
}

/**
 * A draggable circular lens. Drag it over anything on the page — it refracts
 * whatever is behind, which is the whole point of the material.
 */
export function GlassLens({
  size = 148,
  initial = { x: 0.5, y: 0.5 },
  label = 'Glass lens — drag me',
}: {
  size?: number
  initial?: { x: number; y: number }
  label?: string
}) {
  const hostRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState(initial)
  const dragging = useRef(false)

  const move = useCallback((clientX: number, clientY: number) => {
    const host = hostRef.current?.parentElement
    if (!host) return
    const rect = host.getBoundingClientRect()
    setPos({
      x: Math.min(1, Math.max(0, (clientX - rect.left) / rect.width)),
      y: Math.min(1, Math.max(0, (clientY - rect.top) / rect.height)),
    })
  }, [])

  useEffect(() => {
    const onMove = (e: PointerEvent) => dragging.current && move(e.clientX, e.clientY)
    const onUp = () => (dragging.current = false)
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
  }, [move])

  return (
    <div
      ref={hostRef}
      role="button"
      tabIndex={0}
      aria-label={label}
      title={label}
      onPointerDown={(e) => {
        e.preventDefault()
        dragging.current = true
      }}
      onKeyDown={(e) => {
        const step = e.shiftKey ? 0.08 : 0.02
        if (e.key === 'ArrowLeft') setPos((p) => ({ ...p, x: Math.max(0, p.x - step) }))
        if (e.key === 'ArrowRight') setPos((p) => ({ ...p, x: Math.min(1, p.x + step) }))
        if (e.key === 'ArrowUp') setPos((p) => ({ ...p, y: Math.max(0, p.y - step) }))
        if (e.key === 'ArrowDown') setPos((p) => ({ ...p, y: Math.min(1, p.y + step) }))
      }}
      className="absolute z-20 cursor-grab overflow-hidden rounded-full border border-white/20 active:cursor-grabbing"
      style={{
        width: size,
        height: size,
        left: `calc(${pos.x * 100}% - ${size / 2}px)`,
        top: `calc(${pos.y * 100}% - ${size / 2}px)`,
      }}
    >
      <GlassSurface preset="lens" radius={999} />
    </div>
  )
}

/** macOS-style glass dock for quick actions. */
export function GlassDock({
  items,
}: {
  items: { id: string; label: string; icon: LucideIcon; onSelect: () => void; active?: boolean }[]
}) {
  return (
    <div className="relative inline-flex items-center gap-1 overflow-hidden rounded-full border border-white/14 p-1.5">
      <GlassSurface preset="plaque" radius={999} />
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          aria-label={item.label}
          title={item.label}
          onClick={item.onSelect}
          className={cx(
            'relative flex h-9 w-9 items-center justify-center rounded-full transition-transform duration-150 ease-out',
            'active:scale-[0.96]',
            item.active ? 'bg-accent text-accent-ink' : 'text-text/80 hover:text-text',
          )}
        >
          <item.icon size={16} />
        </button>
      ))}
    </div>
  )
}
