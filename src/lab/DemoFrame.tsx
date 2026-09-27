/**
 * One Lab demo, lazily loaded, shared by the Lab screen, the Studio
 * Components panel and the background component recorder.
 */
import { Suspense } from 'react'
import { Loader2 } from 'lucide-react'
import { MotionConfig } from 'motion/react'
import { ProgressProvider } from '../lib/ProgressProvider'
import { cx } from '../lib/utils'
import { getDemo } from './demos'
import { PreviewPlayContext } from './preview-play'
import { DemoPropsContext, type DemoProps } from './demo-props'

export function DemoFrame({
  slug,
  play,
  className,
  atSeconds,
  forceMotion,
  props,
}: {
  /** Per-clip props (framecn text/colours); omitted = the demo's defaults. */
  props?: DemoProps | null
  slug: string
  play: boolean | null
  className?: string
  /**
   * When set, the demo is driven from this instant instead of its own clock.
   * Components that read the shared clock then render the same pixels every
   * time — which is what makes a capture reproducible.
   */
  atSeconds?: number
  /**
   * Record motion even when the OS asks for reduced motion: a captured clip
   * must show the component's real animation, not its resting state.
   */
  forceMotion?: boolean
}) {
  const Demo = getDemo(slug)
  if (!Demo) {
    return <div className="grid h-full place-items-center text-xs text-muted">No demo file</div>
  }
  const body = (
    <DemoPropsContext.Provider value={props ?? null}>
    <PreviewPlayContext.Provider value={play}>
      <Suspense
        fallback={
          <div className="grid h-full place-items-center">
            <Loader2 size={16} className="animate-spin text-muted" />
          </div>
        }
      >
        <div className={cx('lab-canvas grid h-full w-full place-items-center overflow-hidden', className)}>
          <Demo />
        </div>
      </Suspense>
    </PreviewPlayContext.Provider>
    </DemoPropsContext.Provider>
  )
  const driven = atSeconds === undefined ? body : <ProgressProvider seconds={atSeconds}>{body}</ProgressProvider>
  return forceMotion ? <MotionConfig reducedMotion="never">{driven}</MotionConfig> : driven
}
