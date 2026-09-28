/**
 * Live thumbnail of a loader clip, painted by the SAME pure `drawLoader` the
 * Studio preview and export use — so a Library card can never look different
 * from the exported video. The clock is the card's own elapsed time (UI only,
 * never written to the project); under reduced motion it holds a still frame.
 */
import { useEffect, useRef } from 'react'
import type { StudioLoaderClip } from '../../types/project'
import { drawLoader, normaliseLoader } from '../../lib/studio/loaders'
import { useReducedMotion } from '../../lib/use-reduced-motion'

export function LoaderPreview({ clip, width = 240, height = 135, label }: { clip: Partial<StudioLoaderClip>; width?: number; height?: number; label?: string }) {
  const ref = useRef<HTMLCanvasElement>(null)
  const reduced = useReducedMotion()
  const key = JSON.stringify(clip)
  useEffect(() => {
    const canvas = ref.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return
    const dpr = Math.min(2, typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1)
    canvas.width = Math.round(width * dpr)
    canvas.height = Math.round(height * dpr)
    // Thumbnails are small: scale size up so a 1080p-tuned loader stays legible.
    const base = normaliseLoader({ ...clip, startSec: 0 })
    const thumb = { ...base, size: base.loader === 'matrix' ? Math.max(base.size * 3, 0.03) : Math.max(base.size * 2.2, 0.1), reducedMotion: base.reducedMotion || reduced }
    let raf = 0
    let first = -1
    const paint = (now: number) => {
      if (first < 0) first = now
      ctx.setTransform(1, 0, 0, 1, 0, 0)
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      drawLoader(ctx, thumb, thumb.reducedMotion ? 0.4 : (now - first) / 1000, canvas.width, canvas.height)
      if (!thumb.reducedMotion && !document.hidden) raf = requestAnimationFrame(paint)
    }
    raf = requestAnimationFrame(paint)
    const onVis = () => { if (!document.hidden) { cancelAnimationFrame(raf); raf = requestAnimationFrame(paint) } }
    document.addEventListener('visibilitychange', onVis)
    return () => { cancelAnimationFrame(raf); document.removeEventListener('visibilitychange', onVis) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, width, height, reduced])
  return <canvas ref={ref} style={{ width, height }} className="block rounded-lg bg-bg" role="img" aria-label={label ?? 'Loader preview'} />
}
