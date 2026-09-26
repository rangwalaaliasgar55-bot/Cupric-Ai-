import type { StudioClip, StudioKeyframe } from '../../types/project'
import { clamp } from '../utils'

export type KeyframeTransformPatch = Pick<StudioKeyframe, 'x' | 'y' | 'scale' | 'rotation' | 'opacity'>

export function nearestKeyframeIndex(keys: StudioKeyframe[] | null | undefined, localSec: number, toleranceSec: number): number {
  if (!keys?.length) return -1
  let best = -1
  let distance = toleranceSec + Number.EPSILON
  keys.forEach((key, index) => {
    const next = Math.abs(key.at - localSec)
    if (next <= distance) {
      best = index
      distance = next
    }
  })
  return best
}

function baselineKeyframe(clip: StudioClip, at: number): StudioKeyframe {
  const positioned = clip.kind === 'text' || clip.kind === 'overlay' || clip.kind === 'glass' || clip.kind === 'sticker'
  return {
    at,
    ease: 'ease-in-out',
    ...(positioned ? { x: clip.x, y: clip.y } : {}),
    rotation: clip.rotation ?? 0,
    opacity: 1,
    scale: 1,
  }
}

/**
 * Route a canvas transform into a nearby keyframe, or create one while record
 * mode is enabled. Returns null when the caller should patch static clip data.
 */
export function patchTransformKeyframe(
  clip: StudioClip,
  absoluteTime: number,
  patch: Partial<KeyframeTransformPatch>,
  record: boolean,
  toleranceSec = 0.08,
): Partial<StudioClip> | null {
  const local = clamp(absoluteTime - clip.startSec, 0, clip.durationSec)
  const keys = [...(clip.keyframes ?? [])].sort((a, b) => a.at - b.at)
  let index = nearestKeyframeIndex(keys, local, toleranceSec)
  if (index < 0) {
    if (!record) return null
    keys.push(baselineKeyframe(clip, Math.round(local * 100) / 100))
    keys.sort((a, b) => a.at - b.at)
    index = nearestKeyframeIndex(keys, local, toleranceSec)
  }
  keys[index] = { ...keys[index], ...patch }
  return { keyframes: keys }
}

/** Keep a dragged keyframe inside its clip and from crossing its neighbours. */
export function moveKeyframeTime(keys: StudioKeyframe[], index: number, at: number, durationSec: number, fps: number): StudioKeyframe[] {
  if (!keys[index]) return keys
  const frame = 1 / Math.max(1, fps)
  const min = index > 0 ? keys[index - 1].at + frame : 0
  const max = index < keys.length - 1 ? keys[index + 1].at - frame : durationSec
  const next = [...keys]
  next[index] = { ...next[index], at: Math.round(clamp(at, min, Math.max(min, max)) * 1000) / 1000 }
  return next
}
