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
import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState } from 'react'

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

/**
 * Seconds from the driving clock, or null when nothing is driving. Unlike
 * `useDrivenSeconds` it never starts a loop of its own, so a component can
 * keep its original self-running code for the Lab and switch to a pure
 * function of time only when captured.
 */
export function useDriverSeconds(): number | null {
  const driver = useContext(ProgressContext)
  return driver === null ? null : driver.seconds
}

/** Deterministic PRNG (mulberry32) for captured motion: same seed → same sequence. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * Replay a fixed-step simulation from its initial state up to `seconds`.
 * The result depends only on `seconds`, never on how the capture got there
 * (forward, backward, or a single still), which is what makes physics-style
 * components deterministic under capture.
 */
export function replaySim<S>(init: () => S, step: (s: S, dt: number, t: number) => void, seconds: number, dt = 1 / 60): S {
  const s = init()
  const n = Math.max(0, Math.min(60 * 60 * 10, Math.round(seconds / dt)))
  for (let i = 0; i < n; i++) step(s, dt, i * dt)
  return s
}

/** Fixed wall-clock origin used when a captured component shows a time of day (Mon 22 Jun 2026, 09:41). */
export const DRIVEN_EPOCH_MS = Date.UTC(2026, 5, 22, 9, 41, 0)

export type FrameClock = {
  /** True while a capture is driving the clock. */
  readonly driven: boolean
  /** Milliseconds: the driving clock while captured, performance.now() otherwise. */
  now(): number
  /** requestAnimationFrame that, while captured, fires on the driving clock in fixed 1/60 s steps. */
  raf(cb: (now: number) => void): number
  caf(id: number): void
  /** Math.random while live; a seeded sequence (same every mount) while captured. */
  random(): number
}

/**
 * Drop-in clock for components with their own animation loop (physics,
 * pointer-driven sims). Live, it is exactly `performance.now` +
 * `requestAnimationFrame` + `Math.random`, so the Lab is unchanged. Captured,
 * callbacks queue up and are run in fixed 1/60 s steps up to the driving
 * clock's time on every change, randomness is seeded, and `now()` reads the
 * driving clock — so a capture no longer depends on how fast frames were
 * grabbed.
 */
export function useFrameClock(seed = 1): FrameClock {
  const driver = useContext(ProgressContext)
  const drivenMs = driver === null ? null : driver.seconds * 1000
  const state = useRef<{ vt: number | null; queue: Map<number, (now: number) => void>; next: number; rand: () => number; drivenMs: number | null } | null>(null)
  if (!state.current) state.current = { vt: null, queue: new Map(), next: 1, rand: seededRandom(seed), drivenMs }
  state.current.drivenMs = drivenMs
  const clock = useRef<FrameClock | null>(null)
  if (!clock.current) {
    const s = state.current
    clock.current = {
      get driven() { return s.drivenMs !== null },
      now: () => (s.drivenMs !== null ? (s.vt ?? s.drivenMs) : performance.now()),
      raf: (cb) => {
        if (s.drivenMs === null) return requestAnimationFrame(cb)
        const id = s.next++
        s.queue.set(id, cb)
        return id
      },
      caf: (id) => {
        if (s.queue.delete(id)) return
        cancelAnimationFrame(id)
      },
      random: () => (s.drivenMs !== null ? s.rand() : Math.random()),
    }
  }
  useLayoutEffect(() => {
    const s = state.current!
    if (drivenMs === null) { s.vt = null; s.queue.clear(); return }
    if (s.vt === null || drivenMs < s.vt) { s.vt = drivenMs; return }
    const STEP = 1000 / 60
    let guard = 0
    while (s.vt < drivenMs - 1e-6 && guard++ < 36000) {
      s.vt = Math.min(drivenMs, s.vt + STEP)
      if (!s.queue.size) { s.vt = drivenMs; break }
      const due = [...s.queue.values()]
      s.queue.clear()
      for (const cb of due) cb(s.vt)
    }
  }, [drivenMs])
  return clock.current
}
