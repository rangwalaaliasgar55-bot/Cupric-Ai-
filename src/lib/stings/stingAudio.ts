/**
 * Product Sting soundtrack — exactly 12.075 s, 48 kHz stereo, fully synthesized
 * and deterministic (seeded noise). 124 BPM house groove with a soft intro and
 * the drop on beat 5 (2.467 s), plus the SFX cue sheet from the brief. A user
 * track can replace the synthesized music; SFX are always synthesized.
 * Mastered to −14 LUFS integrated (ITU-R BS.1770 K-weighting + gating) with a
 * 4× oversampled peak limiter at −1 dBTP; only the last 60 ms fades.
 */
import { beatSec } from './productSting'

export const STING_SR = 48000
export const STING_LEN = Math.round(12.075 * STING_SR)
export const SFX_CUES = {
  impact: [0.1], whoosh: [2.402, 3.37, 5.305, 10.043], hit: [6.24, 8.175], click: [2.33, 3.83],
  ticks: { from: 4.04, to: 5.0, every: 0.032 }, shimmer: [10.05],
}

function rng(seed: number) {
  let a = seed >>> 0
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296 * 2 - 1 }
}
const TAU = Math.PI * 2
const midi = (n: number) => 440 * Math.pow(2, (n - 69) / 12)

function addMusic(L: Float32Array, R: Float32Array) {
  const noise = rng(124)
  const drop = beatSec(5)
  const chords = [[57, 60, 64, 67], [53, 57, 60, 64], [48, 52, 55, 59], [55, 59, 62, 65]] // Am7 Fmaj7 Cmaj7 G7-ish
  const bars = (t: number) => Math.floor(Math.max(0, t - 0.048) / (0.4838 * 4))
  let lp = 0
  for (let i = 0; i < STING_LEN; i++) {
    const t = i / STING_SR
    const beatPos = (t - 0.048) / 0.4838
    const inBeat = beatPos - Math.floor(beatPos)
    const post = t >= drop
    const ch = chords[bars(t) % 4]
    // pad (soft in the intro, fuller after the drop)
    let pad = 0
    for (const n of ch) { const fr = midi(n); pad += Math.sin(TAU * fr * t) * 0.5 + Math.sin(TAU * fr * 2.003 * t) * 0.15 }
    const padAmp = post ? 0.05 : 0.035 * Math.min(1, t / 1.2)
    let s = pad * padAmp * (post ? 0.75 + 0.25 * Math.sin(TAU * inBeat) : 1)
    if (post && beatPos >= 0) {
      // four-on-the-floor kick
      const kt = inBeat * 0.4838
      s += Math.sin(TAU * (48 + 110 * Math.exp(-kt * 28)) * kt) * Math.exp(-kt * 9) * 0.55
      // off-beat bass on the chord root
      const off = (inBeat + 0.5) % 1, bt = off * 0.4838
      if (inBeat >= 0.5) s += Math.sin(TAU * midi(ch[0] - 24) * t) * Math.exp(-bt * 6) * 0.28
      // off-beat hats
      const ht = off * 0.4838
      lp = lp * 0.2 + noise() * 0.8
      s += (noise() - lp) * Math.exp(-ht * 55) * 0.09
    } else if (beatPos >= 2) {
      const ht = ((inBeat + 0.5) % 1) * 0.4838
      s += noise() * Math.exp(-ht * 70) * 0.02 * (t / drop) // soft intro ticks building into the drop
    }
    L[i] += s; R[i] += s * 0.98 + pad * padAmp * 0.02
  }
}

export function addSfx(L: Float32Array, R: Float32Array) {
  const noise = rng(7)
  const add = (at: number, len: number, fn: (t: number) => number, pan = 0) => {
    const s0 = Math.max(0, Math.round(at * STING_SR)), n = Math.round(len * STING_SR)
    for (let i = 0; i < n && s0 + i < STING_LEN; i++) { const v = fn(i / STING_SR); L[s0 + i] += v * (1 - pan); R[s0 + i] += v * (1 + pan) }
  }
  for (const at of SFX_CUES.impact) add(at, 0.6, (t) => Math.sin(TAU * (40 + 60 * Math.exp(-t * 20)) * t) * Math.exp(-t * 7) * 0.5 + noise() * Math.exp(-t * 40) * 0.08)
  for (const peak of SFX_CUES.whoosh) {
    let y = 0
    add(peak - 0.45, 0.7, (t) => { const d = t - 0.45; const env = d < 0 ? Math.pow(1 + d / 0.45, 3) : Math.exp(-d * 14); const k = 0.04 + 0.35 * env; y += k * (noise() - y); return y * env * 0.55 })
  }
  for (const at of SFX_CUES.hit) add(at, 0.5, (t) => Math.sin(TAU * (55 + 90 * Math.exp(-t * 30)) * t) * Math.exp(-t * 10) * 0.5 + noise() * Math.exp(-t * 30) * 0.12)
  for (const at of SFX_CUES.click) add(at, 0.02, (t) => (Math.sin(TAU * 3200 * t) * 0.5 + noise() * 0.5) * Math.exp(-t * 400) * 0.35)
  for (let at = SFX_CUES.ticks.from; at <= SFX_CUES.ticks.to + 1e-6; at += SFX_CUES.ticks.every) add(at, 0.01, (t) => noise() * Math.exp(-t * 900) * 0.05, 0.1)
  for (const at of SFX_CUES.shimmer) add(at, 1.4, (t) => [2093, 2637, 3136, 4186].reduce((a, f, i) => a + Math.sin(TAU * f * t + i), 0) * Math.exp(-t * 3) * Math.min(1, t * 30) * 0.03)
}

function biquad(x: Float32Array, b: number[], a: number[]) {
  const y = new Float32Array(x.length); let x1 = 0, x2 = 0, y1 = 0, y2 = 0
  for (let i = 0; i < x.length; i++) { const v = b[0] * x[i] + b[1] * x1 + b[2] * x2 - a[1] * y1 - a[2] * y2; x2 = x1; x1 = x[i]; y2 = y1; y1 = v; y[i] = v }
  return y
}
/** Integrated loudness (LUFS), BS.1770-4 at 48 kHz with absolute and relative gates. */
export function integratedLufs(L: Float32Array, R: Float32Array): number {
  const kw = (x: Float32Array) => biquad(biquad(x, [1.53512485958697, -2.69169618940638, 1.19839281085285], [1, -1.69065929318241, 0.73248077421585]), [1, -2, 1], [1, -1.99004745483398, 0.99007225036621])
  const l = kw(L), r = kw(R), block = 0.4 * STING_SR, hop = 0.1 * STING_SR
  const z: number[] = []
  for (let s = 0; s + block <= l.length; s += hop) { let sum = 0; for (let i = s; i < s + block; i++) sum += l[i] * l[i] + r[i] * r[i]; z.push(sum / block) }
  const lk = (m: number) => -0.691 + 10 * Math.log10(m)
  const abs = z.filter((m) => lk(m) > -70)
  if (!abs.length) return -70
  const rel = lk(abs.reduce((a, b) => a + b, 0) / abs.length) - 10
  const g = abs.filter((m) => lk(m) > rel)
  return lk(g.reduce((a, b) => a + b, 0) / g.length)
}
/** 4× oversampled (cubic) peak estimate in dBTP. */
export function truePeakDb(L: Float32Array, R: Float32Array): number {
  let peak = 0
  for (const x of [L, R]) for (let i = 1; i < x.length - 2; i++) {
    const p0 = x[i - 1], p1 = x[i], p2 = x[i + 1], p3 = x[i + 2]
    for (let k = 0; k < 4; k++) { const t = k / 4; const v = p1 + 0.5 * t * (p2 - p0 + t * (2 * p0 - 5 * p1 + 4 * p2 - p3 + t * (3 * (p1 - p2) + p3 - p0))); const a = Math.abs(v); if (a > peak) peak = a }
  }
  return 20 * Math.log10(peak || 1e-9)
}
function limit(L: Float32Array, R: Float32Array, ceilDb: number) {
  const ceil = Math.pow(10, ceilDb / 20), look = 96, rel = Math.exp(-1 / (0.05 * STING_SR))
  const need = new Float32Array(L.length)
  for (let i = 0; i < L.length; i++) { const a = Math.max(Math.abs(L[i]), Math.abs(R[i])) * 1.12; need[i] = a > ceil ? ceil / a : 1 }
  let g = 1
  const gains = new Float32Array(L.length)
  for (let i = L.length - 1; i >= 0; i--) { let m = 1; for (let j = i; j < Math.min(L.length, i + look); j += 8) m = Math.min(m, need[j]); g = m < g ? m : m + (g - m) * rel; gains[i] = g }
  for (let i = 0; i < L.length; i++) { L[i] *= gains[i]; R[i] *= gains[i] }
}

export type StingMix = { left: Float32Array; right: Float32Array; lufs: number; truePeak: number }
/** Build the full soundtrack. `music` (48 kHz) replaces the synthesized groove, placed from `musicOffsetSec`. */
export function renderStingAudio(opts: { music?: { left: Float32Array; right: Float32Array } | null; musicOffsetSec?: number; musicGain?: number } = {}): StingMix {
  const L = new Float32Array(STING_LEN), R = new Float32Array(STING_LEN)
  if (opts.music) {
    const off = Math.round((opts.musicOffsetSec ?? 0) * STING_SR), g = opts.musicGain ?? 0.7
    for (let i = 0; i < STING_LEN; i++) { const j = i + off; if (j >= 0 && j < opts.music.left.length) { L[i] += opts.music.left[j] * g; R[i] += opts.music.right[j] * g } }
  } else addMusic(L, R)
  addSfx(L, R)
  for (let pass = 0; pass < 3; pass++) {
    const gain = Math.pow(10, (-14 - integratedLufs(L, R)) / 20)
    for (let i = 0; i < STING_LEN; i++) { L[i] *= gain; R[i] *= gain }
    limit(L, R, -1.2)
  }
  const fade = Math.round(0.06 * STING_SR)
  for (let i = 0; i < fade; i++) { const k = 1 - i / fade; L[STING_LEN - 1 - (fade - 1 - i)] *= k; R[STING_LEN - 1 - (fade - 1 - i)] *= k }
  return { left: L, right: R, lufs: integratedLufs(L, R), truePeak: truePeakDb(L, R) }
}

export function encodeWav16(L: Float32Array, R: Float32Array, sr = STING_SR): Uint8Array {
  const n = L.length, buf = new ArrayBuffer(44 + n * 4), v = new DataView(buf)
  const w = (o: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)) }
  w(0, 'RIFF'); v.setUint32(4, 36 + n * 4, true); w(8, 'WAVE'); w(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 2, true)
  v.setUint32(24, sr, true); v.setUint32(28, sr * 4, true); v.setUint16(32, 4, true); v.setUint16(34, 16, true); w(36, 'data'); v.setUint32(40, n * 4, true)
  for (let i = 0; i < n; i++) { v.setInt16(44 + i * 4, Math.max(-1, Math.min(1, L[i])) * 32767, true); v.setInt16(46 + i * 4, Math.max(-1, Math.min(1, R[i])) * 32767, true) }
  return new Uint8Array(buf)
}
