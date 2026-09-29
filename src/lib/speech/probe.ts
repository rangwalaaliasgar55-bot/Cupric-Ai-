/**
 * Where speech starts and stops, measured from the audio rather than read off a
 * transcript.
 *
 * Ported from veedstudio/open-edit `cli/src/commands/speech-probe.ts`
 * (Apache-2.0 — see THIRD_PARTY_NOTICES.md), with the decoder split out: the
 * maths below is a pure function of 16-bit PCM, and the PCM comes from WebAudio
 * in the renderer or FFmpeg on the desktop, so both environments measure the
 * same clip the same way.
 *
 * WHY THIS REPLACES CUPric'S OLD SILENCE CHECK. The previous browser detector
 * used a fixed −35 dBFS threshold. A street sits 20 dB above a quiet room, so
 * one fixed number finds gaps in one clip and none in the other, and a
 * room-tone clip reports "no silence" while a hissy one reports "all silence".
 * Here the floor is MEASURED per clip (the 10th percentile of the envelope), the
 * threshold is derived from it, and a clip with no dynamic range to separate
 * speech from floor says so instead of guessing.
 *
 * Word boundaries are not cut points either: ASR can report a gap between two
 * words where the waveform shows unbroken voicing, and cutting there slices a
 * phoneme. Gaps are what is safe to cut.
 */

export interface Gap {
  start: number
  end: number
  duration: number
}

export interface ProbeResult {
  /** Measured noise floor in dBFS: the 10th percentile of the envelope. */
  floor: number
  /** Loudest window in dBFS. */
  peak: number
  /** Threshold used to separate speech from floor, in dBFS. */
  threshold: number
  /** First window at or above threshold, in seconds FROM THE START OF THE FILE — an EDL in-point. */
  onset: number | null
  /** End of the last window at or above threshold, also in file seconds. */
  decay: number | null
  /** Sub-threshold stretches at least `gapMs` long, in file seconds — the safe cut targets. */
  gaps: Gap[]
  /**
   * False when the signal has no dynamic range to separate speech from floor.
   * `floor`, `peak` and `threshold` still hold real measurements; `onset`,
   * `decay` and `gaps` do not.
   */
  speechFound: boolean
  /** Per-window dBFS, so a caller can render or re-threshold without decoding again. */
  envelope: number[]
  windowMs: number
  rangeStart: number
}

/** Below this the clip is one flat level: digital silence, room tone with nobody talking, or a dead decode. */
export const MIN_DYNAMIC_RANGE_DB = 6

export const DEFAULT_WINDOW_MS = 10
export const DEFAULT_GAP_MS = 250
export const SAMPLE_RATE = 16_000

/** dBFS of each fixed-length window of 16-bit mono PCM. */
export function envelopeOf(pcm: Int16Array, windowSamples: number): number[] {
  const out: number[] = []
  for (let i = 0; i + windowSamples <= pcm.length; i += windowSamples) {
    let sum = 0
    for (let j = i; j < i + windowSamples; j++) sum += pcm[j] * pcm[j]
    const rms = Math.sqrt(sum / windowSamples)
    out.push(rms > 0 ? 20 * Math.log10(rms / 32768) : -100)
  }
  return out
}

export function percentile(values: number[], p: number): number {
  if (values.length === 0) return -100
  const sorted = [...values].sort((a, b) => a - b)
  const index = Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * p)))
  return sorted[index]
}

/**
 * Speech is separated from the floor by a margin above the MEASURED floor, so
 * the same numbers work on a street and in a booth. The margin is deliberately
 * generous: a false gap costs a bad cut, a missed gap only costs an opportunity.
 */
export function analyse(envelope: number[], windowMs: number, gapMs: number, rangeStart: number): ProbeResult {
  const floor = percentile(envelope, 0.1)
  // reduce, not Math.max(...envelope): spreading one argument per window throws
  // RangeError past ~125k windows, which at a 10ms window is a 20-minute clip.
  const peak = envelope.reduce((hi, v) => (v > hi ? v : hi), -100)
  const threshold = Math.min(floor + 12, floor + (peak - floor) * 0.35)
  if (envelope.length === 0 || peak - floor < MIN_DYNAMIC_RANGE_DB) {
    return { floor, peak, threshold, onset: null, decay: null, gaps: [], speechFound: false, envelope, windowMs, rangeStart }
  }
  const perSecond = 1000 / windowMs
  const at = (index: number) => rangeStart + index / perSecond

  const first = envelope.findIndex((v) => v >= threshold)
  const last = envelope.findLastIndex((v) => v >= threshold)
  const onset = first < 0 ? null : at(first)
  const decay = last < 0 ? null : at(last + 1)

  // ceil, not round: a reported gap is AT LEAST `gapMs` long.
  const minWindows = Math.max(1, Math.ceil(gapMs / windowMs - 1e-9))
  const gaps: Gap[] = []
  let runStart = -1
  for (let i = 0; i <= envelope.length; i++) {
    const quiet = i < envelope.length && envelope[i] < threshold
    if (quiet && runStart < 0) runStart = i
    if (!quiet && runStart >= 0) {
      if (i - runStart >= minWindows) gaps.push({ start: at(runStart), end: at(i), duration: (i - runStart) / perSecond })
      runStart = -1
    }
  }

  return { floor, peak, threshold, onset, decay, gaps, speechFound: true, envelope, windowMs, rangeStart }
}

/** Float PCM (as WebAudio hands it over) → the 16-bit mono the analyser reads. */
export function toInt16(pcm: Float32Array): Int16Array {
  const out = new Int16Array(pcm.length)
  for (let i = 0; i < pcm.length; i++) {
    const v = Math.max(-1, Math.min(1, pcm[i]))
    out[i] = v < 0 ? v * 0x8000 : v * 0x7fff
  }
  return out
}

/** Mono-mix an AudioBuffer's channels, so a stereo clip is measured once, not twice. */
export function monoOf(channels: Float32Array[]): Float32Array {
  if (channels.length <= 1) return channels[0] ?? new Float32Array(0)
  const n = Math.min(...channels.map((c) => c.length))
  const out = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    let sum = 0
    for (const c of channels) sum += c[i]
    out[i] = sum / channels.length
  }
  return out
}

export interface ProbeOptions {
  windowMs?: number
  gapMs?: number
  rangeStart?: number
}

/** The whole measurement, from 16-bit mono PCM. */
export function probePcm(pcm: Int16Array, opts: ProbeOptions = {}): ProbeResult {
  const windowMs = opts.windowMs ?? DEFAULT_WINDOW_MS
  const windowSamples = Math.max(1, Math.round((SAMPLE_RATE * windowMs) / 1000))
  // The window the envelope was actually cut with — a whole number of samples, so
  // times derive from it rather than from the requested figure.
  const effectiveWindowMs = (windowSamples * 1000) / SAMPLE_RATE
  return analyse(envelopeOf(pcm, windowSamples), effectiveWindowMs, opts.gapMs ?? DEFAULT_GAP_MS, opts.rangeStart ?? 0)
}

/** Convenience for decoded audio of any sample rate. */
export function probeFloatPcm(sampleRate: number, mono: Float32Array, opts: ProbeOptions = {}): ProbeResult {
  const resampled = sampleRate === SAMPLE_RATE ? mono : resampleLinear(mono, sampleRate, SAMPLE_RATE)
  return probePcm(toInt16(resampled), opts)
}

/** Linear resampling: enough for an envelope measured in 10 ms windows. */
export function resampleLinear(input: Float32Array, from: number, to: number): Float32Array {
  if (from === to || input.length === 0) return input
  const out = new Float32Array(Math.max(1, Math.round((input.length * to) / from)))
  const step = from / to
  for (let i = 0; i < out.length; i++) {
    const at = i * step
    const i0 = Math.floor(at)
    const i1 = Math.min(input.length - 1, i0 + 1)
    const t = at - i0
    out[i] = input[i0] * (1 - t) + input[i1] * t
  }
  return out
}

/** One line for the UI, so a probe never reads as a bare number. */
export function describeProbe(result: ProbeResult, gapMs = DEFAULT_GAP_MS): string {
  const s = (v: number | null) => (v === null ? '—' : `${v.toFixed(2)}s`)
  if (result.envelope.length === 0) {
    return `No audio measured — the clip has no samples in that range (or its audio could not be decoded).`
  }
  if (!result.speechFound) {
    return `No speech found: the level never rises ${MIN_DYNAMIC_RANGE_DB} dB above its own floor (${result.floor.toFixed(1)} dBFS). Either nothing is said here, or the whole clip is one continuous voicing — either way there is no gap to cut.`
  }
  if (!result.gaps.length) {
    return `Speech from ${s(result.onset)} to ${s(result.decay)} with no gap of ${gapMs}ms or more — every boundary here is inside continuous voicing, so none of them is a safe cut.`
  }
  const saved = result.gaps.reduce((n, g) => n + g.duration, 0)
  return `Speech from ${s(result.onset)} to ${s(result.decay)} · floor ${result.floor.toFixed(1)} dBFS · ${result.gaps.length} gap(s) ≥ ${gapMs}ms, ${saved.toFixed(2)}s of dead air in total.`
}

/* ─────────────── decoding: browser and desktop ─────────────── */

export type PcmSource = { sampleRate: number; mono: Float32Array }

/** Decode any audio/video file the browser can read, with WebAudio. */
export async function decodeWithWebAudio(data: ArrayBuffer): Promise<PcmSource> {
  const Ctor = typeof window !== 'undefined'
    ? (window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext)
    : undefined
  if (!Ctor) throw new Error('This browser has no WebAudio decoder, so the clip’s audio cannot be measured here.')
  const context = new Ctor()
  try {
    const buffer = await context.decodeAudioData(data.slice(0))
    const channels = Array.from({ length: buffer.numberOfChannels }, (_, i) => buffer.getChannelData(i))
    return { sampleRate: buffer.sampleRate, mono: monoOf(channels) }
  } finally {
    void context.close().catch(() => undefined)
  }
}
