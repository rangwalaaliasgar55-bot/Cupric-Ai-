/**
 * MatrixLoader — Transitions.dev "Matrix dot loader" (p33) rebuilt for the
 * Cupric UI. 16 cells pulse base → active with the upstream delay tables
 * (shared with the Studio renderer via matrixDelay). See
 * resources/transitions-dev/ATTRIBUTION.md.
 *
 * Self-contained (idempotent, SSR-safe style injection), token colours,
 * reduced-motion aware, role=status with an accessible label.
 * Presets: scan · twinkle · orbit · pulse · rounded · monochrome · lime ·
 * disabled (static) · compact · large · inline · full-screen.
 */
import type { CSSProperties } from 'react'
import { matrixDelay } from '../../lib/studio/loaders'
import type { StudioLoaderVariant } from '../../types/project'

const STYLE_ID = 'cupric-matrix-loader'
const CSS = `
.cu-matrix { display: inline-grid; grid-template-columns: repeat(4, var(--matrix-cell, 2px)); grid-auto-rows: var(--matrix-cell, 2px); gap: var(--matrix-cell, 2px); vertical-align: middle; }
.cu-matrix i { display: block; border-radius: 0; background: var(--matrix-base, var(--color-panel-alt)); animation: cu-matrix-pulse var(--matrix-cycle, 1200ms) var(--matrix-ease, ease-in-out) infinite; animation-delay: calc(var(--d, 0) * 1ms); }
.cu-matrix i.is-gap { visibility: hidden; animation: none; }
.cu-matrix[data-motion="reduce"] i, .cu-matrix[data-disabled="true"] i { animation: none !important; }
.cu-matrix[data-disabled="true"] { opacity: 0.45; }
@keyframes cu-matrix-pulse { 0%, 45%, 100% { background-color: var(--matrix-base, var(--color-panel-alt)); } 15% { background-color: var(--matrix-active, var(--color-muted)); } }
@media (prefers-reduced-motion: reduce) { .cu-matrix[data-motion="system"] i { animation: none !important; } }
.cu-matrix-fullscreen { position: fixed; inset: 0; z-index: 60; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px; background: var(--color-bg); }
`
export function ensureMatrixStyles(): void {
  if (typeof document === 'undefined' || document.getElementById(STYLE_ID)) return
  const el = document.createElement('style')
  el.id = STYLE_ID
  el.textContent = CSS
  document.head.appendChild(el)
}
ensureMatrixStyles()

const CORNERS = [0, 3, 12, 15]
const SIZE_PX = { compact: 2, inline: 3, default: 3, large: 6 } as const
const TONES = {
  default: { base: 'var(--color-panel-alt)', active: 'var(--color-muted)' },
  monochrome: { base: 'var(--color-line)', active: 'var(--color-text)' },
  lime: { base: 'var(--color-panel-alt)', active: 'var(--color-accent)' },
} as const

export type MatrixLoaderProps = {
  variant?: StudioLoaderVariant
  rounded?: boolean
  cycle?: number
  label?: string
  tone?: keyof typeof TONES
  size?: keyof typeof SIZE_PX
  disabled?: boolean
  reducedMotion?: 'system' | 'reduce' | 'full'
  fullScreen?: boolean
  className?: string
}

export function MatrixLoader({ variant = 'scan', rounded = false, cycle = 1200, label = 'Loading', tone = 'default', size = 'default', disabled = false, reducedMotion = 'system', fullScreen = false, className }: MatrixLoaderProps) {
  const colours = TONES[tone]
  const grid = (
    <div
      className={`cu-matrix${className ? ` ${className}` : ''}`}
      data-variant={variant}
      data-motion={reducedMotion}
      data-disabled={disabled ? 'true' : 'false'}
      role="status"
      aria-label={label}
      style={{ '--matrix-cycle': `${cycle}ms`, '--matrix-cell': `${SIZE_PX[size]}px`, '--matrix-base': colours.base, '--matrix-active': colours.active } as CSSProperties}
    >
      {Array.from({ length: 16 }, (_, idx) => {
        if (rounded && CORNERS.includes(idx)) return <i key={idx} className="is-gap" />
        const d = matrixDelay(variant, idx, cycle)
        return <i key={idx} style={d === null ? { animation: 'none' } : ({ '--d': d } as CSSProperties)} />
      })}
    </div>
  )
  if (!fullScreen) return grid
  return (
    <div className="cu-matrix-fullscreen">
      {grid}
      <span className="text-sm text-muted">{label}</span>
    </div>
  )
}
