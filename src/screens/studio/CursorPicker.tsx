/**
 * Cursor pack v2 picker — every variant previewed doing the thing it does.
 *
 * A grid of eight nameless pointer icons would be useless: what you need to
 * know is how each one *moves*, because that is what ends up in the video. So
 * each card runs the real loop — fly in, travel, press, ripple — painted by
 * the same `drawCursor` the renderer and the export call.
 *
 * Reduced motion holds a still frame mid-press instead of animating, and the
 * cards stop painting when the tab is hidden.
 */
import { useEffect, useRef } from 'react'
import { CURSOR_VARIANTS, clickPress, clickRipple, cursorFade, cursorPosition, drawCursor, type CursorKind } from '../../lib/studio/cursorPack'
import { useReducedMotion } from '../../lib/use-reduced-motion'
import { cx } from '../../lib/utils'

const CYCLE = 3.2

/** One card: the pointer flies in, crosses, clicks, and lifts out. */
function CursorCard({ kind, width = 132, height = 84 }: { kind: CursorKind; width?: number; height?: number }) {
  const ref = useRef<HTMLCanvasElement>(null)
  const reduced = useReducedMotion()

  useEffect(() => {
    const canvas = ref.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return
    const dpr = Math.min(2, typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1)
    canvas.width = Math.round(width * dpr)
    canvas.height = Math.round(height * dpr)
    const w = canvas.width
    const h = canvas.height
    const size = Math.round(26 * dpr)

    /** One pass of the demo at loop time `q` (0–1). Pure in q. */
    const paint = (q: number) => {
      ctx.setTransform(1, 0, 0, 1, 0, 0)
      ctx.clearRect(0, 0, w, h)

      // The target the pointer is aiming at, so the click has a reason.
      const tx = w * 0.68
      const ty = h * 0.52
      ctx.save()
      ctx.globalAlpha = 0.5
      ctx.strokeStyle = 'rgba(148,163,184,0.85)'
      ctx.lineWidth = 1 * dpr
      ctx.beginPath()
      ctx.roundRect(tx - 26 * dpr, ty - 13 * dpr, 52 * dpr, 26 * dpr, 6 * dpr)
      ctx.stroke()
      ctx.restore()

      // Beats: 0–.18 fly in · .18–.55 travel · .55–.78 press · .78–1 lift out.
      let x = w * 0.18
      let y = h * 0.78
      let alpha = 1
      let press = 0
      let ripple = -1

      if (q < 0.18) {
        alpha = cursorFade(q / 0.18, 'in')
        const p = cursorPosition(q / 0.18, [0.05, 1.05], [0.18, 0.78])
        x = w * p[0]
        y = h * p[1]
      } else if (q < 0.55) {
        const p = cursorPosition((q - 0.18) / 0.37, [0.18, 0.78], [tx / w, ty / h])
        x = w * p[0]
        y = h * p[1]
      } else if (q < 0.78) {
        x = tx
        y = ty
        const local = (q - 0.55) / 0.23
        press = clickPress(local)
        ripple = local
      } else {
        const p = cursorPosition((q - 0.78) / 0.22, [tx / w, ty / h], [0.92, 1.1])
        x = w * p[0]
        y = h * p[1]
        alpha = cursorFade((q - 0.78) / 0.22, 'out')
      }

      if (ripple >= 0) {
        const r = clickRipple(ripple, size)
        if (r.alpha > 0.004) {
          ctx.save()
          ctx.globalAlpha = r.alpha
          ctx.strokeStyle = 'rgba(148,163,184,0.9)'
          ctx.lineWidth = 1.5 * dpr
          ctx.beginPath()
          ctx.arc(tx, ty, r.radius, 0, Math.PI * 2)
          ctx.stroke()
          ctx.restore()
        }
      }

      drawCursor(ctx, kind, x, y, { size, alpha, press, fill: '#F8FAFC', stroke: '#0B0B10' })
    }

    if (reduced) {
      paint(0.62) // a still frame mid-press: you can still see the shape.
      return
    }
    let raf = 0
    let first = -1
    const tick = (now: number) => {
      if (first < 0) first = now
      paint((((now - first) / 1000) % CYCLE) / CYCLE)
      if (!document.hidden) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    const onVis = () => {
      if (!document.hidden) {
        cancelAnimationFrame(raf)
        raf = requestAnimationFrame(tick)
      }
    }
    document.addEventListener('visibilitychange', onVis)
    return () => {
      cancelAnimationFrame(raf)
      document.removeEventListener('visibilitychange', onVis)
    }
  }, [kind, width, height, reduced])

  return <canvas ref={ref} style={{ width, height }} className="rounded-md bg-panel-alt" aria-hidden />
}

export function CursorPicker({ value, onPick }: { value?: CursorKind; onPick: (kind: CursorKind) => void }) {
  return (
    <div className="space-y-2">
      <p className="text-xs text-muted">
        Pointers are drawn from paths, so they stay sharp at any export size. Travel is sprung and takes real time — a
        pointer that teleports reads as a glitch.
      </p>
      <div className="grid grid-cols-2 gap-2">
        {CURSOR_VARIANTS.map((variant) => (
          <button
            key={variant.kind}
            type="button"
            onClick={() => onPick(variant.kind)}
            aria-pressed={value === variant.kind}
            title={variant.hint}
            className={cx(
              'rounded-lg border p-1.5 text-left transition-colors',
              value === variant.kind ? 'border-accent bg-accent/10' : 'border-line hover:border-accent/60 hover:bg-panel-alt',
            )}
          >
            <CursorCard kind={variant.kind} />
            <div className="mt-1 px-0.5 text-xs font-semibold">{variant.label}</div>
            <div className="px-0.5 text-xs leading-snug text-muted">{variant.hint}</div>
          </button>
        ))}
      </div>
    </div>
  )
}
