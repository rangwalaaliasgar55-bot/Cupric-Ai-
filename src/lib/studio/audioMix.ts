/**
 * Audio mix helpers (2.4): waveform peaks, auto-ducking and loudness (LUFS).
 *
 * Ducking is a pure function of the document and time, so the preview (element
 * volume) and the export (Web Audio gain automation) compute the same gain.
 */

import type { StudioAudioClip, StudioClip, StudioDoc } from '../../types/project'
import { audioGainAt, clipEnd } from './doc'

export const DEFAULT_DUCKING = { enabled: true, amountDb: -12, fadeSec: 0.25 }

const dbToGain = (db: number) => Math.pow(10, db / 20)

/** Clips that count as speech: audio clips with role 'voice', and video clips with sound. */
function voiceSpans(doc: StudioDoc): Array<[number, number]> {
  return doc.clips
    .filter((c: StudioClip) => (c.kind === 'audio' && c.role === 'voice') || (c.kind === 'video' && c.volume > 0.05))
    .map((c) => [c.startSec, clipEnd(c)] as [number, number])
}

/**
 * 0–1 duck multiplier for a music clip at time t. Ramps down `fadeSec`
 * before speech and back up `fadeSec` after, so the dip never clicks.
 */
export function duckAt(doc: StudioDoc, clip: StudioAudioClip, t: number): number {
  const d = doc.ducking
  if (!d?.enabled || (clip.role ?? 'music') !== 'music') return 1
  const fade = Math.max(0.01, d.fadeSec)
  let depth = 0
  for (const [a, b] of voiceSpans(doc)) {
    if (t >= a && t <= b) return dbToGain(d.amountDb)
    if (t < a && t > a - fade) depth = Math.max(depth, 1 - (a - t) / fade)
    if (t > b && t < b + fade) depth = Math.max(depth, 1 - (t - b) / fade)
  }
  return 1 + (dbToGain(d.amountDb) - 1) * depth
}

/** Final gain: the clip's own volume/fades × ducking. Use everywhere audio is mixed. */
export function mixGainAt(doc: StudioDoc, clip: StudioAudioClip, t: number): number {
  return audioGainAt(clip, t) * duckAt(doc, clip, t)
}

/** Gain points for export automation: every `step` seconds across the clip. */
export function gainAutomation(doc: StudioDoc, clip: StudioAudioClip, step = 0.05): Array<[number, number]> {
  const out: Array<[number, number]> = []
  for (let t = clip.startSec; t < clipEnd(clip); t += step) out.push([Math.round(t * 1000) / 1000, mixGainAt(doc, clip, t)])
  out.push([clipEnd(clip), 0])
  return out
}

/** Peak envelope for drawing a waveform: max |sample| per bucket, 0–1. */
export function computePeaks(channels: Float32Array[], sampleRate: number, perSecond = 100): number[] {
  if (!channels.length) return []
  const len = channels[0].length
  const bucket = Math.max(1, Math.floor(sampleRate / perSecond))
  const peaks: number[] = []
  for (let start = 0; start < len; start += bucket) {
    let m = 0
    const end = Math.min(len, start + bucket)
    for (const ch of channels) for (let i = start; i < end; i += 1) { const v = Math.abs(ch[i]); if (v > m) m = v }
    peaks.push(Math.round(Math.min(1, m) * 1000) / 1000)
  }
  return peaks
}

/* ——— ITU-R BS.1770-4 integrated loudness ——— */

type Biquad = { b0: number; b1: number; b2: number; a1: number; a2: number }

/** K-weighting: high-shelf pre-filter + RLB high-pass, coefficients for any rate. */
function kWeighting(fs: number): [Biquad, Biquad] {
  // Stage 1: shelving (from the BS.1770 reference derivation).
  let f0 = 1681.974450955533, G = 3.999843853973347, Q = 0.7071752369554196
  let K = Math.tan((Math.PI * f0) / fs)
  const Vh = Math.pow(10, G / 20), Vb = Math.pow(Vh, 0.4996667741545416)
  let a0 = 1 + K / Q + K * K
  const shelf = { b0: (Vh + (Vb * K) / Q + K * K) / a0, b1: (2 * (K * K - Vh)) / a0, b2: (Vh - (Vb * K) / Q + K * K) / a0, a1: (2 * (K * K - 1)) / a0, a2: (1 - K / Q + K * K) / a0 }
  // Stage 2: high-pass.
  f0 = 38.13547087602444; Q = 0.5003270373238773
  K = Math.tan((Math.PI * f0) / fs)
  a0 = 1 + K / Q + K * K
  const hp = { b0: 1, b1: -2, b2: 1, a1: (2 * (K * K - 1)) / a0, a2: (1 - K / Q + K * K) / a0 }
  return [shelf, hp]
}

function filter(x: Float32Array, f: Biquad): Float32Array {
  const y = new Float32Array(x.length)
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0
  for (let i = 0; i < x.length; i += 1) {
    const v = f.b0 * x[i] + f.b1 * x1 + f.b2 * x2 - f.a1 * y1 - f.a2 * y2
    x2 = x1; x1 = x[i]; y2 = y1; y1 = v
    y[i] = v
  }
  return y
}

/** Integrated loudness in LUFS (absolute −70 gate, relative −10 gate). −Infinity for silence. */
export function measureLufs(channels: Float32Array[], sampleRate: number): number {
  if (!channels.length || channels[0].length < sampleRate * 0.4) return -Infinity
  const [shelf, hp] = kWeighting(sampleRate)
  const weighted = channels.slice(0, 2).map((ch) => filter(filter(ch, shelf), hp))
  const block = Math.round(sampleRate * 0.4)
  const hop = Math.round(sampleRate * 0.1)
  const powers: number[] = []
  for (let s = 0; s + block <= weighted[0].length; s += hop) {
    let sum = 0
    for (const ch of weighted) { let e = 0; for (let i = s; i < s + block; i += 1) e += ch[i] * ch[i]; sum += e / block }
    powers.push(sum)
  }
  const lk = (p: number) => -0.691 + 10 * Math.log10(p)
  const abs = powers.filter((p) => lk(p) > -70)
  if (!abs.length) return -Infinity
  const rel = lk(abs.reduce((a, b) => a + b, 0) / abs.length) - 10
  const gated = abs.filter((p) => lk(p) > rel)
  if (!gated.length) return -Infinity
  return lk(gated.reduce((a, b) => a + b, 0) / gated.length)
}

/** Linear gain to hit `target` LUFS, capped at +12 dB so noise is never blown up. */
export function normaliseGain(measured: number, target: number): number {
  if (!Number.isFinite(measured)) return 1
  return dbToGain(Math.min(12, target - measured))
}
