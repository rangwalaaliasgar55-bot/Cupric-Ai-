/**
 * ThinkingStates — Transitions.dev "Thinking states" (p28) rebuilt for the
 * Cupric UI. Status copy holds, blurs up and out, and the next line slides in,
 * with an optional shimmer. See resources/transitions-dev/ATTRIBUTION.md.
 *
 * - Self-contained: styles are injected once (guarded by element id =
 *   idempotent) and only when `document` exists (SSR-safe).
 * - Tokens: defaults read DESIGN.md variables (--color-muted/--color-text,
 *   --ease-soft), never an unrelated palette.
 * - Every timing/colour is a prop, applied as per-instance CSS variables.
 * - Reduced motion: 'system' follows prefers-reduced-motion, 'reduce' always
 *   shows static swaps, 'full' keeps motion.
 * - Accessibility: role=status + aria-live=polite announces each real state.
 *
 * App UI only. The Studio/export version is the pure frame function in
 * src/lib/studio/loaders.ts (no wall clock in the renderer).
 */
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react'

const STYLE_ID = 'cupric-think-states'
const CSS = `
.cu-think { position: relative; display: inline-block; text-align: left; vertical-align: bottom; }
.cu-think-sizer { display: block; visibility: hidden; white-space: nowrap; }
.cu-think-text {
  position: absolute; top: 0; left: 0; right: 0; display: block; white-space: nowrap;
  color: var(--think-base, var(--color-muted));
  transform: translateY(0); filter: blur(0); opacity: 1;
  transition: transform var(--think-swap, 150ms) var(--think-ease, ease-in-out), filter var(--think-swap, 150ms) var(--think-ease, ease-in-out), opacity var(--think-swap, 150ms) var(--think-ease, ease-in-out);
  will-change: transform, filter, opacity;
}
.cu-think[data-shimmer="on"] .cu-think-text::before {
  content: attr(data-text); position: absolute; inset: 0; pointer-events: none;
  background-image: linear-gradient(90deg, transparent 0%, transparent 40%, var(--think-highlight, var(--color-text)) 50%, transparent 60%, transparent 100%);
  background-size: 400% 100%; background-repeat: no-repeat;
  -webkit-background-clip: text; background-clip: text; color: transparent; -webkit-text-fill-color: transparent;
  animation: cu-think-shimmer var(--think-shimmer, 2000ms) linear infinite;
}
@keyframes cu-think-shimmer { 0% { background-position: 100% 0; } 100% { background-position: 0% 0; } }
.cu-think-text.is-exit { transform: translateY(calc(var(--think-distance, 8px) * -1)); filter: blur(var(--think-blur, 2px)); opacity: 0; }
.cu-think-text.is-enter-start { transition: none; transform: translateY(var(--think-distance, 8px)); filter: blur(var(--think-blur, 2px)); opacity: 0; }
.cu-think[data-motion="reduce"] .cu-think-text { transition: none !important; transform: none !important; filter: none !important; }
.cu-think[data-motion="reduce"] .cu-think-text::before { display: none !important; }
@media (prefers-reduced-motion: reduce) {
  .cu-think[data-motion="system"] .cu-think-text { transition: none !important; transform: none !important; filter: none !important; }
  .cu-think[data-motion="system"] .cu-think-text::before { display: none !important; }
}
`

/** Inject the stylesheet once. Safe to call during render on the server (no-op). */
export function ensureThinkingStyles(): void {
  if (typeof document === 'undefined' || document.getElementById(STYLE_ID)) return
  const el = document.createElement('style')
  el.id = STYLE_ID
  el.textContent = CSS
  document.head.appendChild(el)
}
ensureThinkingStyles()

export type ThinkingStatesProps = {
  states: string[]
  holdMs?: number
  swapMs?: number
  gapMs?: number
  distancePx?: number
  blurPx?: number
  shimmerMs?: number
  shimmer?: boolean
  baseColor?: string
  highlightColor?: string
  ease?: string
  reducedMotion?: 'system' | 'reduce' | 'full'
  /** Stop cycling (e.g. while the owning panel is hidden). */
  paused?: boolean
  className?: string
}

export function ThinkingStates({
  states,
  holdMs = 2000,
  swapMs = 150,
  gapMs = 50,
  distancePx = 8,
  blurPx = 2,
  shimmerMs = 2000,
  shimmer = true,
  baseColor,
  highlightColor,
  ease = 'ease-in-out',
  reducedMotion = 'system',
  paused = false,
  className,
}: ThinkingStatesProps) {
  const list = states.filter((s) => s && s.trim())
  const safe = list.length ? list : ['Working']
  const [current, setCurrent] = useState(0)
  const [leaving, setLeaving] = useState<number | null>(null)
  const [entering, setEntering] = useState(false)
  const liveRef = useRef<HTMLSpanElement>(null)
  const idx = current % safe.length
  const signature = safe.join('\u0000')

  // New list (e.g. the job moved to another step) → start from its first line.
  useEffect(() => { setCurrent(0); setLeaving(null); setEntering(false) }, [signature])

  useEffect(() => {
    if (paused || safe.length < 2) return
    const hold = setTimeout(() => {
      setLeaving(idx)
      setCurrent((i) => (i + 1) % safe.length)
      setEntering(true)
    }, holdMs)
    return () => clearTimeout(hold)
  }, [idx, safe.length, holdMs, paused])

  useLayoutEffect(() => {
    if (!entering) return
    if (liveRef.current) void liveRef.current.offsetWidth
    const release = setTimeout(() => setEntering(false), gapMs)
    const done = setTimeout(() => setLeaving(null), swapMs + gapMs)
    return () => { clearTimeout(release); clearTimeout(done) }
  }, [entering, gapMs, swapMs])

  const longest = safe.reduce((a, b) => (b.length > a.length ? b : a), '')
  const vars = {
    '--think-swap': `${swapMs}ms`,
    '--think-distance': `${distancePx}px`,
    '--think-blur': `${blurPx}px`,
    '--think-shimmer': `${shimmerMs}ms`,
    '--think-ease': ease,
    ...(baseColor ? { '--think-base': baseColor } : {}),
    ...(highlightColor ? { '--think-highlight': highlightColor } : {}),
  } as CSSProperties

  return (
    <span className={`cu-think${className ? ` ${className}` : ''}`} role="status" aria-live="polite" data-motion={reducedMotion} data-shimmer={shimmer ? 'on' : 'off'} style={vars}>
      <span className="cu-think-sizer" aria-hidden="true">{longest}</span>
      {leaving !== null && leaving < safe.length && (
        <span className="cu-think-text is-exit" data-text={safe[leaving]} aria-hidden="true">{safe[leaving]}</span>
      )}
      <span key={idx} ref={liveRef} className={`cu-think-text${entering ? ' is-enter-start' : ''}`} data-text={safe[idx]}>
        {safe[idx]}
      </span>
    </span>
  )
}
