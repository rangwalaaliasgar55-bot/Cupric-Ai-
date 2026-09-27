/**
 * Right-click menu for a clip (timeline or canvas). Items come from the pure
 * clipMenu() table; unavailable items stay visible with the reason as a
 * tooltip. Keyboard: ↑/↓ to move, Enter to run, Esc to close.
 */
import { useEffect, useRef, useState } from 'react'
import type { StudioClip } from '../../types/project'
import { clipMenu, type ClipActionId } from '../../lib/studio/clipActions'
import { cx } from '../../lib/utils'

type Props = {
  clip: StudioClip
  x: number
  y: number
  time: number
  hasClipboard: boolean
  extra?: Array<{ id: string; label: string; run: () => void }>
  onAction: (id: ClipActionId) => void
  onClose: () => void
}

export function ClipContextMenu({ clip, x, y, time, hasClipboard, extra = [], onAction, onClose }: Props) {
  const items = clipMenu(clip, { time, hasClipboard })
  const all = [...items.map((i) => ({ key: i.id, label: i.label, shortcut: i.shortcut, disabled: i.disabled, group: i.group, run: () => onAction(i.id) })), ...extra.map((e) => ({ key: e.id, label: e.label, shortcut: undefined, disabled: undefined, group: 'more', run: e.run }))]
  const [active, setActive] = useState(() => all.findIndex((i) => !i.disabled))
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    ref.current?.focus()
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) onClose() }
    window.addEventListener('mousedown', close)
    window.addEventListener('blur', onClose)
    return () => { window.removeEventListener('mousedown', close); window.removeEventListener('blur', onClose) }
  }, [onClose])

  // Keep the menu on screen.
  const left = Math.min(x, window.innerWidth - 250)
  const top = Math.min(y, window.innerHeight - all.length * 30 - 40)

  return (
    <div
      ref={ref}
      role="menu"
      tabIndex={-1}
      aria-label={`${clip.name} actions`}
      className="fixed z-[100] w-60 rounded-xl border border-line bg-panel p-1 shadow-2xl outline-none"
      style={{ left, top: Math.max(8, top) }}
      onContextMenu={(e) => e.preventDefault()}
      onKeyDown={(e) => {
        const step = (d: number) => {
          let i = active
          for (let n = 0; n < all.length; n += 1) { i = (i + d + all.length) % all.length; if (!all[i].disabled) break }
          setActive(i)
        }
        if (e.key === 'ArrowDown') { e.preventDefault(); step(1) }
        else if (e.key === 'ArrowUp') { e.preventDefault(); step(-1) }
        else if (e.key === 'Enter' && all[active] && !all[active].disabled) { e.preventDefault(); all[active].run(); onClose() }
        else if (e.key === 'Escape') { e.preventDefault(); onClose() }
        e.stopPropagation()
      }}
    >
      <p className="truncate px-2.5 pb-1 pt-1.5 text-[11px] font-medium uppercase tracking-wide text-muted">{clip.name}{clip.locked ? ' · locked' : ''}</p>
      {all.map((item, i) => (
        <div key={item.key}>
          {i > 0 && all[i - 1].group !== item.group && <div className="my-1 h-px bg-line" role="separator" />}
          <button
            type="button"
            role="menuitem"
            aria-disabled={!!item.disabled}
            title={item.disabled}
            onMouseEnter={() => !item.disabled && setActive(i)}
            onClick={() => { if (item.disabled) return; item.run(); onClose() }}
            className={cx(
              'flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-left text-sm',
              item.disabled ? 'cursor-not-allowed text-muted/50' : i === active ? 'bg-panel-alt text-text' : 'text-text',
            )}
          >
            <span>{item.label}</span>
            {item.shortcut && <span className="font-mono text-[11px] text-muted">{item.shortcut}</span>}
          </button>
        </div>
      ))}
    </div>
  )
}
