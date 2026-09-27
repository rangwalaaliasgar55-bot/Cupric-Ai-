/**
 * Cupric's own stand-in for the two Editframe names framecn components use.
 * Editframe itself is proprietary and is NOT vendored. framecn components
 * animate with CSS keyframes (which run on the browser clock) and shaders read
 * `ownCurrentTimeMs`; the Studio recorder captures both in real time.
 */
import { createContext, forwardRef, useContext, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'

/** Elapsed ms since the stage (re)started — provided by FramecnStage. */
export const StageClock = createContext<number | null>(null)

export function useElapsedMs(active = true): number {
  const [t, setT] = useState(0)
  useEffect(() => {
    if (!active) return
    let raf = 0
    const start = performance.now()
    const tick = () => { setT(performance.now() - start); raf = requestAnimationFrame(tick) }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [active])
  return t
}

type TimegroupProps = { duration?: string; mode?: string; style?: CSSProperties; className?: string; children?: ReactNode }

export const Timegroup = forwardRef<HTMLDivElement, TimegroupProps>(function Timegroup({ style, className, children }, ref) {
  return <div ref={ref} className={className} style={style} data-framecn-timegroup="">{children}</div>
})

export function useTimingInfo() {
  const ref = useRef<HTMLDivElement>(null)
  const shared = useContext(StageClock)
  const own = useElapsedMs(shared === null)
  return { ref, ownCurrentTimeMs: shared ?? own }
}
