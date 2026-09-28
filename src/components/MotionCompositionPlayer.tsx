import { Suspense, lazy } from 'react'
import type { SceneRundown } from '../types/project'

// F-4: Remotion is the single heaviest preview dependency and is only reached
// once a rundown is locked. Fetch it then, not at first paint.
const Impl = lazy(() => import('./MotionCompositionPlayer.impl'))

export function MotionCompositionPlayer({ rundown }: { rundown: SceneRundown }) {
  const width = Math.max(240, Math.round(rundown.size[0] || 1920))
  const height = Math.max(240, Math.round(rundown.size[1] || 1080))
  return (
    <Suspense
      fallback={
        <div
          className="grid place-items-center rounded-xl border border-line bg-panel-alt text-xs text-muted"
          style={{ width: '100%', aspectRatio: `${width} / ${height}` }}
          role="status"
        >
          Loading the player…
        </div>
      }
    >
      <Impl rundown={rundown} />
    </Suspense>
  )
}
