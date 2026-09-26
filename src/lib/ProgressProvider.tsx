/**
 * Supplies the clock to everything below it.
 *
 * The capture path mounts this with a fixed `seconds` so a screenshot is
 * reproducible; a preview can mount it with a scrubbing value so a whole tree
 * of components moves in lockstep with the playhead.
 */
import type { ReactNode } from 'react'
import { useMemo } from 'react'
import { ProgressContext } from './progress'

export function ProgressProvider({ seconds, children }: { seconds: number; children: ReactNode }) {
  // Memoised on the number itself: a new object each render would re-render
  // every consumer for nothing.
  const value = useMemo(() => ({ seconds }), [seconds])
  return <ProgressContext.Provider value={value}>{children}</ProgressContext.Provider>
}
