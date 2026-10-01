/**
 * Hand a clip to the Studio from another screen.
 *
 * Clips arrive with an entrance (fade, pop, keyframes). Opening the Studio
 * with the playhead on the clip's very first frame therefore showed an empty
 * canvas — which read as "it added nothing". The Studio picks this up on
 * mount, selects the clip, and parks the playhead where it is fully visible.
 */
const KEY = 'newbrand:studio-focus'

export function focusStudioClip(clipId: string | null | undefined): void {
  if (!clipId) return
  try {
    sessionStorage.setItem(KEY, clipId)
  } catch {
    /* storage unavailable: the clip is still on the timeline */
  }
}

export function takeStudioFocus(): string | null {
  try {
    const id = sessionStorage.getItem(KEY)
    if (id) sessionStorage.removeItem(KEY)
    return id
  } catch {
    return null
  }
}

/** Where a clip is on screen and settled: past its entrance, before its exit. */
export function visibleMomentOf(clip: { startSec: number; durationSec: number }): number {
  return clip.startSec + Math.min(0.8, clip.durationSec / 2)
}
