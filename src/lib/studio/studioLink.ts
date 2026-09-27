/**
 * A live line between the Studio and panels that act on it (Resources, Lab).
 *
 * Resources used to append everything at the end of the edit because nothing
 * outside the Studio knew where the playhead was, and a resource applied from
 * the Studio's own side panel had no way to select what it just added. The
 * Studio publishes its playhead here and listens for "focus now" requests; a
 * panel that is not inside the Studio falls back to the session hand-over in
 * focus.ts, picked up when the Studio mounts.
 */
import { focusStudioClip } from './focus'

let mounted = false
let playhead = 0

export function publishPlayhead(t: number): void {
  playhead = Number.isFinite(t) ? Math.max(0, t) : 0
}

export function setStudioMounted(value: boolean): void {
  mounted = value
}

/** Where the playhead was left, even after leaving the Studio. */
export function lastStudioPlayhead(): number {
  return playhead
}

/** Playhead seconds while the Studio is on screen, else null. */
export function studioPlayhead(): number | null {
  return mounted ? playhead : null
}

export const FOCUS_NOW_EVENT = 'cupric:studio-focus-now'
export type FocusNowDetail = { clipId: string | null; atSec: number }

/** Select a clip and park the playhead on `atSec` — now if the Studio is up, else when it opens. */
export function requestStudioFocus(clipId: string | null, atSec: number): void {
  if (mounted) {
    window.dispatchEvent(new CustomEvent<FocusNowDetail>(FOCUS_NOW_EVENT, { detail: { clipId, atSec } }))
    return
  }
  focusStudioClip(clipId)
}

export const VOICE_RUN_EVENT = 'cupric:voice-run'
const VOICE_PENDING = 'cupric:voice-pending'

/**
 * Run a voice-command phrase as if it had been spoken. When the Studio is not
 * mounted it is held until the Studio opens. Returns true if it ran now.
 */
export function runVoicePhrase(phrase: string): boolean {
  if (mounted) {
    window.dispatchEvent(new CustomEvent<string>(VOICE_RUN_EVENT, { detail: phrase }))
    return true
  }
  try {
    sessionStorage.setItem(VOICE_PENDING, phrase)
  } catch {
    /* storage unavailable */
  }
  return false
}

export function takePendingVoicePhrase(): string | null {
  try {
    const phrase = sessionStorage.getItem(VOICE_PENDING)
    if (phrase) sessionStorage.removeItem(VOICE_PENDING)
    return phrase
  } catch {
    return null
  }
}

/* ——— Lab auto-capture hand-over ———————————————————————————————— */

const LAB_AUTOCAPTURE = 'cupric:lab-autocapture'
export type LabAutocapture = { slug: string; atSec: number; returnTo: 'studio' | 'library' }

export function requestLabAutocapture(request: LabAutocapture): void {
  try {
    sessionStorage.setItem(LAB_AUTOCAPTURE, JSON.stringify(request))
  } catch {
    /* storage unavailable: the Lab opens normally */
  }
}

export function takeLabAutocapture(): LabAutocapture | null {
  try {
    const raw = sessionStorage.getItem(LAB_AUTOCAPTURE)
    if (!raw) return null
    sessionStorage.removeItem(LAB_AUTOCAPTURE)
    const parsed = JSON.parse(raw) as LabAutocapture
    return typeof parsed?.slug === 'string' ? { slug: parsed.slug, atSec: Number(parsed.atSec) || 0, returnTo: parsed.returnTo === 'library' ? 'library' : 'studio' } : null
  } catch {
    return null
  }
}
