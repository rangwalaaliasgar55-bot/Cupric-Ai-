/**
 * One clock for anything that animates.
 *
 * A component with its own `requestAnimationFrame` loop is fine on a web page
 * and useless in a video: the exporter steps frame by frame, slower than real
 * time, so a self-driven component records whatever it happened to be doing
 * when the screenshot was taken. Two of the same component on one frame are
 * not even in phase with each other.
 *
 * So the rule is the same one the Studio renderer already follows: motion is a
 * function of a number. `useProgress` gives a component that number. Inside a
 * `ProgressProvider` — which is what the capture path mounts — the number is
 * supplied and the component is deterministic. Outside one, it falls back to
 * its own rAF loop so the Lab still looks alive and nothing had to be written
 * twice.
 *
 * Reduced motion is honoured in the fallback: it holds at the resting value
 * rather than animating.
 */
import { createContext, useContext, useEffect, useRef, useState } from 'react'

/** Seconds elapsed, supplied by whoever is driving. */
export type ProgressContextValue = { seconds: number } | null

export const ProgressContext = createContext<ProgressContextValue>(null)

/** True when something upstream is supplying the clock. */
export function useIsDriven(): boolean {
  return useContext(ProgressContext) !== null
}

export type UseProgressOptions = {
  /** Length of one cycle, in seconds. */
  durationSec?: number
  /** Wrap at the end of a cycle, or hold at 1. */
  loop?: boolean
  /** Value used when motion is reduced and nothing is driving. */
  restingValue?: number
}

/**
 * A 0–1 value for this component's animation.
 *
 * Driven: derived from the supplied clock, so the same time always gives the
 * same value — scrub back and it matches, export slowly and it still matches.
 * Undriven: a local rAF loop, which is exactly what these components did
 * before, just in one place instead of thirty.
 */
export function useProgress(options: UseProgressOptions = {}): number {
  const { durationSec = 2, loop = true, restingValue = 1 } = options
  const driver = useContext(ProgressContext)
  const [local, setLocal] = useState(0)
  const reduced = usePrefersReducedMotion()
  const startedAt = useRef<number | null>(null)

  const driven = driver !== null

  useEffect(() => {
    if (driven || reduced) return
    let raf = 0
    const step = (now: number) => {
      if (startedAt.current === null) startedAt.current = now
      const elapsed = (now - startedAt.current) / 1000
      setLocal(cycle(elapsed, durationSec, loop))
      raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [driven, durationSec, loop, reduced])

  if (driven) return cycle(driver.seconds, durationSec, loop)
  if (reduced) return restingValue
  return local
}

/** Elapsed seconds → 0–1, wrapping or clamping. */
export function cycle(elapsedSec: number, durationSec: number, loop: boolean): number {
  const span = durationSec > 0 ? durationSec : 1
  const raw = elapsedSec / span
  if (!Number.isFinite(raw)) return 0
  if (loop) {
    const wrapped = raw % 1
    return wrapped < 0 ? wrapped + 1 : wrapped
  }
  return raw < 0 ? 0 : raw > 1 ? 1 : raw
}

/**
 * Discrete step index, for components that tick rather than glide.
 *
 * A clock's second hand, a rotating word, a marquee that advances a slot —
 * these want "which one is showing", not a fraction, and deriving it here
 * keeps them off `setInterval`.
 */
export function useStep(count: number, everySec = 1): number {
  const total = Math.max(1, Math.floor(count))
  const progress = useProgress({ durationSec: total * everySec, loop: true })
  return Math.min(total - 1, Math.floor(progress * total))
}

/**
 * Raw seconds from the driving clock, or the component's own elapsed time.
 *
 * For components whose animation is not a simple 0–1 cycle — a frame sequence,
 * a stepped pattern — the seconds are more useful than a fraction.
 */
export function useDrivenSeconds(): number {
  const driver = useContext(ProgressContext)
  const [local, setLocal] = useState(0)
  const startedAt = useRef<number | null>(null)
  const driven = driver !== null

  useEffect(() => {
    if (driven) return
    let raf = 0
    const step = (now: number) => {
      if (startedAt.current === null) startedAt.current = now
      setLocal((now - startedAt.current) / 1000)
      raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [driven])

  return driver ? driver.seconds : local
}

/** Matches the app-wide hook, but usable from `src/lib` without a cycle. */
function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false)
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return
    const query = window.matchMedia('(prefers-reduced-motion: reduce)')
    setReduced(query.matches)
    const onChange = (event: MediaQueryListEvent) => setReduced(event.matches)
    query.addEventListener('change', onChange)
    return () => query.removeEventListener('change', onChange)
  }, [])
  return reduced
}
