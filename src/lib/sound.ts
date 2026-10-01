/**
 * Two sounds, and no more.
 *
 * A sound cue earns its place by telling you something you would otherwise
 * have to watch for. There are exactly two moments like that in NewBrand: an
 * export finishing (you looked away — it takes real time, because it records
 * in real time) and an export failing. Everything else is visible on screen
 * already, and a click on every button is an app that people mute.
 *
 * They are synthesised, not sampled: a couple of oscillators and an envelope
 * weigh nothing, ship no files, and cannot 404. They are quiet by design —
 * around -28 dBFS peak, which reads as a hint rather than a notification —
 * and they respect the user's choice and the system's reduced-motion setting,
 * which is the closest thing the web gives us to "this person wants calm".
 */

let context: AudioContext | null = null
let enabled = true

/** Turn cues on or off. Persisted by the caller; this just holds the answer. */
export function setSoundEnabled(value: boolean) {
  enabled = value
}

export function isSoundEnabled(): boolean {
  return enabled
}

function prefersCalm(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/** Lazily created, because an AudioContext made before a gesture starts suspended. */
function ensureContext(): AudioContext | null {
  if (typeof window === 'undefined') return null
  if (context) return context
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!Ctor) return null
  try {
    context = new Ctor()
    return context
  } catch {
    return null
  }
}

type Tone = {
  /** Hz. */
  freq: number
  /** Seconds from the start of the cue. */
  at: number
  durationSec: number
  /** Peak gain. Kept low: these sit under the room, not over it. */
  peak: number
  type?: OscillatorType
}

function play(tones: Tone[]) {
  if (!enabled || prefersCalm()) return
  const ctx = ensureContext()
  if (!ctx) return
  // A context can be suspended if the cue is the first audio in the session.
  if (ctx.state === 'suspended') void ctx.resume().catch(() => undefined)

  const now = ctx.currentTime + 0.01
  for (const tone of tones) {
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.type = tone.type ?? 'sine'
    osc.frequency.setValueAtTime(tone.freq, now + tone.at)

    // A short exponential decay — a struck sound rather than a beep. Ramps
    // start and end above zero because exponential ramps cannot touch it.
    const start = now + tone.at
    const end = start + tone.durationSec
    gain.gain.setValueAtTime(0.0001, start)
    gain.gain.exponentialRampToValueAtTime(tone.peak, start + 0.012)
    gain.gain.exponentialRampToValueAtTime(0.0001, end)

    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.start(start)
    osc.stop(end + 0.02)
  }
}

/**
 * Done.
 *
 * A rising perfect fifth (A5 → E6), the interval that reads as resolved
 * without sounding like a fanfare.
 */
export function cueDone() {
  play([
    { freq: 880, at: 0, durationSec: 0.16, peak: 0.04 },
    { freq: 1318.5, at: 0.09, durationSec: 0.22, peak: 0.035 },
  ])
}

/**
 * Something stopped.
 *
 * The same two notes, descending and a shade darker. Deliberately not harsh:
 * the error message does the explaining, this only makes you look up.
 */
export function cueProblem() {
  play([
    { freq: 660, at: 0, durationSec: 0.14, peak: 0.035, type: 'triangle' },
    { freq: 440, at: 0.1, durationSec: 0.26, peak: 0.03, type: 'triangle' },
  ])
}

/** Release the audio hardware. Called when the app closes a project. */
export function releaseSound() {
  void context?.close().catch(() => undefined)
  context = null
}
