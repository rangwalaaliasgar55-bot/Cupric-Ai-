/**
 * Auto-edit engine — the pure halves of five automations. Each returns a new
 * doc for preview → Accept (one undo step); nothing is applied silently.
 *
 *  1. Beat sync      — detectBeats (spectral-flux onsets → tempo by
 *                      autocorrelation → dynamic-programming beat tracker),
 *                      snapCutsToBeats rolls main-track cuts onto beats.
 *  2. Tighten speech — removes filler words and long pauses using real word
 *                      timings, and remaps everything after so captions and
 *                      overlays stay in sync.
 *  3. Smart reframe  — landscape footage in a portrait/square frame: a
 *                      smoothed subject track becomes x keyframes (the
 *                      analysis that produces the track lives in the UI).
 *  4. Word-timed components — see componentDirector (uses clip.words).
 *  5. Pacing         — hook in the first second, punch-ins on long static shots.
 */
import type { StudioAudioClip, StudioClip, StudioDoc, StudioMediaClip, StudioTextClip, StudioWord } from '../../types/project'
import { uid } from '../utils'
import { aspectRatio, clipEnd, defaultTextClip, docDuration } from './doc'
import { rollEdit } from './timelineOps'

/* ——— 1. beats ——————————————————————————————————————————————————————— */

function fftMag(re: Float64Array, im: Float64Array): void {
  const n = re.length
  for (let i = 1, j = 0; i < n; i += 1) {
    let bit = n >> 1
    for (; j & bit; bit >>= 1) j ^= bit
    j ^= bit
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]] }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len
    const wr = Math.cos(ang), wi = Math.sin(ang)
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0
      for (let k = 0; k < len / 2; k += 1) {
        const ar = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci
        const ai = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr
        re[i + k + len / 2] = re[i + k] - ar; im[i + k + len / 2] = im[i + k] - ai
        re[i + k] += ar; im[i + k] += ai
        const nr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = nr
      }
    }
  }
}

/** Onset strength per hop (spectral flux, log-compressed, mean-removed). */
export function onsetEnvelope(samples: Float32Array, sampleRate: number, hop = 512, size = 1024): { env: Float64Array; hopSec: number } {
  const frames = Math.max(0, Math.floor((samples.length - size) / hop))
  const env = new Float64Array(frames)
  const win = new Float64Array(size).map((_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / size))
  let prev = new Float64Array(size / 2)
  const re = new Float64Array(size), im = new Float64Array(size)
  for (let f = 0; f < frames; f += 1) {
    const off = f * hop
    for (let i = 0; i < size; i += 1) { re[i] = samples[off + i] * win[i]; im[i] = 0 }
    fftMag(re, im)
    const mag = new Float64Array(size / 2)
    let flux = 0
    for (let k = 1; k < size / 2; k += 1) {
      mag[k] = Math.log1p(100 * Math.hypot(re[k], im[k]))
      const d = mag[k] - prev[k]
      if (d > 0) flux += d
    }
    env[f] = flux
    prev = mag
  }
  // Remove the local mean (≈0.5 s) so loud passages don't dominate.
  const w = Math.max(1, Math.round((0.5 * sampleRate) / hop))
  const out = new Float64Array(frames)
  let acc = 0
  for (let i = 0; i < frames; i += 1) {
    acc += env[i]
    if (i >= w) acc -= env[i - w]
    out[i] = Math.max(0, env[i] - acc / Math.min(i + 1, w))
  }
  return { env: out, hopSec: hop / sampleRate }
}

/** Tempo in BPM from the onset envelope (autocorrelation, prior around 120). */
export function estimateTempo(env: Float64Array, hopSec: number, minBpm = 60, maxBpm = 180): number {
  const minLag = Math.max(1, Math.floor(60 / maxBpm / hopSec))
  const maxLag = Math.ceil(60 / minBpm / hopSec)
  let best = 0, bestLag = Math.round(0.5 / hopSec)
  for (let lag = minLag; lag <= maxLag; lag += 1) {
    let s = 0
    for (let i = lag; i < env.length; i += 1) s += env[i] * env[i - lag]
    const bpm = 60 / (lag * hopSec)
    const prior = Math.exp(-0.5 * Math.log2(bpm / 120) ** 2 / 0.9 ** 2)
    if (s * prior > best) { best = s * prior; bestLag = lag }
  }
  // Parabolic refinement for sub-hop accuracy.
  const ac = (lag: number) => { let s = 0; for (let i = lag; i < env.length; i += 1) s += env[i] * env[i - lag]; return s }
  const a = ac(bestLag - 1), b = ac(bestLag), c = ac(bestLag + 1)
  const shift = a - 2 * b + c !== 0 ? (0.5 * (a - c)) / (a - 2 * b + c) : 0
  return 60 / ((bestLag + Math.max(-0.5, Math.min(0.5, shift))) * hopSec)
}

/** Beat times (seconds) by dynamic programming (Ellis 2007). */
export function trackBeats(env: Float64Array, hopSec: number, bpm: number, tightness = 100): number[] {
  const period = 60 / bpm / hopSec
  const n = env.length
  if (!n) return []
  const score = new Float64Array(n)
  const back = new Int32Array(n).fill(-1)
  for (let t = 0; t < n; t += 1) {
    let best = 0, arg = -1
    const lo = Math.max(0, Math.round(t - 2 * period)), hi = Math.max(0, Math.round(t - period / 2))
    for (let p = lo; p <= hi && p < t; p += 1) {
      const v = score[p] - tightness * Math.log((t - p) / period) ** 2
      if (arg < 0 || v > best) { best = v; arg = p }
    }
    score[t] = env[t] + (arg >= 0 ? Math.max(0, best) : 0)
    back[t] = arg >= 0 && best > 0 ? arg : -1
  }
  // Start from the best-scoring frame in the last period.
  let t = n - 1
  for (let i = Math.max(0, Math.floor(n - period)); i < n; i += 1) if (score[i] > score[t]) t = i
  const beats: number[] = []
  while (t >= 0) { beats.push(t * hopSec); t = back[t] }
  return beats.reverse()
}

export function detectBeats(samples: Float32Array, sampleRate: number): { bpm: number; times: number[] } {
  const { env, hopSec } = onsetEnvelope(samples, sampleRate)
  if (env.length < 16) return { bpm: 0, times: [] }
  let bpm = estimateTempo(env, hopSec)
  // Octave check: if the half-period beat grid also lands on strong onsets,
  // the true tempo is double (autocorrelation favours the slower octave).
  const strength = (b: number) => trackBeats(env, hopSec, b).reduce((acc, t) => acc + env[Math.min(env.length - 1, Math.round(t / hopSec))], 0) / Math.max(1, (env.length * hopSec * b) / 60)
  if (bpm * 2 <= 200 && strength(bpm * 2) > 0.6 * strength(bpm)) bpm *= 2
  const times = trackBeats(env, hopSec, bpm).map((t) => Math.round(t * 1000) / 1000)
  // Report the tempo the tracked beats actually have.
  const gaps = times.slice(1).map((t, i) => t - times[i]).sort((x, y) => x - y)
  const med = gaps.length ? gaps[Math.floor(gaps.length / 2)] : 0
  const regular = times.slice(1).map((t, i) => t - times[i]).filter((g) => Math.abs(g - med) < med * 0.25)
  const measured = regular.length ? 60 / (regular.reduce((x, y) => x + y, 0) / regular.length) : bpm
  return { bpm: Math.round(measured * 10) / 10, times }
}

/** Beats of every analysed music clip, in TIMELINE seconds. */
export function timelineBeats(doc: StudioDoc): number[] {
  const out: number[] = []
  for (const c of doc.clips) {
    if (c.kind !== 'audio' || !c.beats?.times.length || c.hidden) continue
    for (const b of c.beats.times) {
      if (b < c.trimInSec || b > c.trimInSec + c.durationSec) continue
      out.push(c.startSec + (b - c.trimInSec))
    }
  }
  return out.sort((a, b) => a - b)
}

/** Roll each main-track cut to the nearest beat within `tolSec`. */
export function snapCutsToBeats(doc: StudioDoc, tolSec = 0.3): { doc: StudioDoc; moved: number; skipped: string[] } {
  const beats = timelineBeats(doc)
  if (!beats.length) return { doc, moved: 0, skipped: ['Analyse the music’s beats first.'] }
  let next = doc
  let moved = 0
  const skipped: string[] = []
  const main = () => next.clips.filter((c) => c.track === 0 && (c.kind === 'video' || c.kind === 'image')).sort((a, b) => a.startSec - b.startSec)
  for (const left of main()) {
    const cur = next.clips.find((c) => c.id === left.id)!
    const cut = clipEnd(cur)
    const right = next.clips.find((c) => c.id !== cur.id && c.track === 0 && Math.abs(c.startSec - cut) < 0.02)
    if (!right) continue
    let nearest = beats[0]
    for (const b of beats) if (Math.abs(b - cut) < Math.abs(nearest - cut)) nearest = b
    const delta = nearest - cut
    if (Math.abs(delta) < 0.01 || Math.abs(delta) > tolSec) continue
    const r = rollEdit(next, cur.id, delta)
    if (r.changed) { next = r.doc; moved += 1 } else skipped.push(`${cur.name}: ${r.reason ?? 'could not roll'}`)
  }
  return { doc: next, moved, skipped }
}

/* ——— 2. tighten speech ——————————————————————————————————————————————— */

export const FILLERS = new Set(['um', 'umm', 'uh', 'uhh', 'uhm', 'erm', 'er', 'hmm', 'mm', 'ah', 'eh'])
const bare = (w: string) => w.toLowerCase().replace(/[^a-z']/g, '')

/** Source-time ranges to remove from a clip: fillers and pauses over `maxPauseSec`. */
export function speechCuts(words: StudioWord[], range: [number, number], opts: { maxPauseSec?: number; padSec?: number; fillers?: boolean } = {}): Array<[number, number]> {
  const maxPause = opts.maxPauseSec ?? 0.6
  const pad = opts.padSec ?? 0.12
  const inRange = words.filter((w) => w.end > range[0] && w.start < range[1]).sort((a, b) => a.start - b.start)
  const kept = opts.fillers === false ? inRange : inRange.filter((w) => !FILLERS.has(bare(w.word)))
  const cuts: Array<[number, number]> = []
  const push = (a: number, b: number) => { if (b - a > 0.08) cuts.push([Math.max(range[0], a), Math.min(range[1], b)]) }
  if (!kept.length) return []
  if (kept[0].start - range[0] > maxPause) push(range[0], kept[0].start - pad)
  for (let i = 1; i < kept.length; i += 1) {
    const gap = kept[i].start - kept[i - 1].end
    // A removed filler leaves a gap too — cut it whenever it holds a filler or is long.
    const hadFiller = inRange.some((w) => w.start >= kept[i - 1].end - 0.001 && w.end <= kept[i].start + 0.001 && FILLERS.has(bare(w.word)))
    if (gap > maxPause || (hadFiller && gap > pad * 2)) push(kept[i - 1].end + pad, kept[i].start - pad)
  }
  const last = kept[kept.length - 1]
  if (range[1] - last.end > maxPause) push(last.end + pad, range[1])
  return cuts.filter(([a, b]) => b > a)
}

/**
 * Remove `cuts` (source seconds) from one clip: it becomes several sub-clips
 * butted together, and every other clip after the clip's start is remapped
 * through the same cut list so captions and overlays stay on their words.
 */
export function tightenClip(doc: StudioDoc, clipId: string, opts: { maxPauseSec?: number; padSec?: number; fillers?: boolean } = {}): { doc: StudioDoc; removedSec: number; cuts: number; reason?: string } {
  const clip = doc.clips.find((c) => c.id === clipId) as StudioMediaClip | StudioAudioClip | undefined
  if (!clip || (clip.kind !== 'video' && clip.kind !== 'audio')) return { doc, removedSec: 0, cuts: 0, reason: 'Select a video or audio clip.' }
  if (clip.locked) return { doc, removedSec: 0, cuts: 0, reason: 'That clip is locked.' }
  if (!clip.words?.length) return { doc, removedSec: 0, cuts: 0, reason: 'Transcribe this clip first (Auto-captions) so its word timings are known.' }
  const speed = clip.kind === 'video' && clip.speed > 0 ? clip.speed : 1
  const range: [number, number] = [clip.trimInSec, clip.trimInSec + clip.durationSec * speed]
  const cuts = speechCuts(clip.words, range, opts)
  if (!cuts.length) return { doc, removedSec: 0, cuts: 0, reason: 'No fillers or long pauses found.' }
  // Keep ranges = complement of cuts.
  const keeps: Array<[number, number]> = []
  let cursor = range[0]
  for (const [a, b] of cuts) { if (a - cursor > 0.05) keeps.push([cursor, a]); cursor = b }
  if (range[1] - cursor > 0.05) keeps.push([cursor, range[1]])
  const removedSrcBefore = (s: number) => cuts.reduce((acc, [a, b]) => acc + Math.max(0, Math.min(s, b) - a), 0)
  const remap = (t: number) => {
    if (t <= clip.startSec) return t
    const s = Math.min(range[1], clip.trimInSec + (t - clip.startSec) * speed)
    const inside = cuts.find(([a, b]) => s > a && s < b)
    const src = inside ? inside[0] : s
    const extra = t > clipEnd(clip) ? t - clipEnd(clip) : 0
    return clip.startSec + (src - clip.trimInSec - removedSrcBefore(src)) / speed + extra
  }
  const parts: StudioClip[] = []
  let at = clip.startSec
  keeps.forEach(([a, b], i) => {
    const durationSec = Math.round(((b - a) / speed) * 1000) / 1000
    parts.push({ ...clip, id: i === 0 ? clip.id : uid(), startSec: Math.round(at * 1000) / 1000, trimInSec: a, durationSec, transitionIn: i === 0 ? clip.transitionIn : 'none', transitionOut: i === keeps.length - 1 ? clip.transitionOut : 'none' } as StudioClip)
    at += durationSec
  })
  const others = doc.clips.filter((c) => c.id !== clip.id).map((c) => {
    if (c.startSec + c.durationSec <= clip.startSec + 0.001) return c
    const start = remap(c.startSec)
    const end = remap(c.startSec + c.durationSec)
    return { ...c, startSec: Math.round(start * 1000) / 1000, durationSec: Math.max(0.2, Math.round((end - start) * 1000) / 1000) }
  })
  const removedSec = cuts.reduce((acc, [a, b]) => acc + (b - a), 0) / speed
  return { doc: { ...doc, clips: [...others, ...parts] }, removedSec: Math.round(removedSec * 100) / 100, cuts: cuts.length }
}

/* ——— 3. smart reframe ———————————————————————————————————————————————— */

export type SubjectSample = { t: number; cx: number; weight: number }

/**
 * Subject track (source seconds, cx 0..1 across the SOURCE width) → a patch
 * that fits the whole source height into the frame and pans with x
 * keyframes. Smoothing: median-3, deadzone, speed limit — a camera
 * operator, not a jittery tracker.
 */
export function reframePatch(clip: StudioMediaClip, samples: SubjectSample[], frameAspect: number, srcAspect: number, opts: { deadzone?: number; maxSpeed?: number } = {}): { patch: Partial<StudioMediaClip>; reason?: string } {
  if (!(srcAspect > frameAspect * 1.05)) return { patch: {}, reason: 'The footage already fits this frame — nothing to reframe.' }
  const speed = clip.speed > 0 ? clip.speed : 1
  const used = samples.filter((s) => s.t >= clip.trimInSec - 0.01 && s.t <= clip.trimInSec + clip.durationSec * speed + 0.01).sort((a, b) => a.t - b.t)
  if (used.length < 2) return { patch: {}, reason: 'Not enough frames were analysed for this clip.' }
  const s = srcAspect / frameAspect // scale so the source height fills the frame
  const lo = 0.5 - (s - 1) / 2, hi = 0.5 + (s - 1) / 2
  const xFor = (cx: number) => Math.min(hi, Math.max(lo, 0.5 + s * (0.5 - cx)))
  // Median-3 then hold-with-deadzone.
  const med = used.map((p, i) => {
    const w = [used[i - 1], p, used[i + 1]].filter(Boolean).map((q) => q!.cx).sort((a, b) => a - b)
    return { t: p.t, cx: w[Math.floor(w.length / 2)] }
  })
  const dead = opts.deadzone ?? 0.07
  const maxSpeed = opts.maxSpeed ?? 0.35 // source-widths per second
  const keys: Array<{ at: number; cx: number }> = []
  let held = med[0].cx
  keys.push({ at: 0, cx: held })
  for (const p of med.slice(1)) {
    if (Math.abs(p.cx - held) < dead) continue
    const at = (p.t - clip.trimInSec) / speed
    const last = keys[keys.length - 1]
    const dt = Math.max(0.001, at - last.at)
    const limited = held + Math.sign(p.cx - held) * Math.min(Math.abs(p.cx - held), maxSpeed * dt)
    held = limited
    if (at - last.at < 0.4) keys[keys.length - 1] = { at: last.at, cx: held }
    else keys.push({ at, cx: held })
  }
  const keyframes = keys.map((k) => ({ at: Math.round(k.at * 1000) / 1000, x: Math.round(xFor(k.cx) * 10000) / 10000, ease: 'ease-in-out' as const }))
  if (keyframes.length === 1) keyframes.push({ ...keyframes[0], at: Math.round(clip.durationSec * 1000) / 1000 })
  return { patch: { fit: 'contain', scale: Math.round(s * 10000) / 10000, x: keyframes[0].x, y: 0.5, keyframes } }
}

export function needsReframe(doc: StudioDoc, clip: StudioMediaClip, srcW: number, srcH: number): boolean {
  return clip.kind === 'video' && srcW > 0 && srcH > 0 && srcW / srcH > aspectRatio(doc.aspect) * 1.05
}

/* ——— 5. pacing ———————————————————————————————————————————————————————— */

export type PacingIssue = { id: string; title: string; detail: string; apply: (doc: StudioDoc) => StudioDoc }

export function pacingIssues(doc: StudioDoc): PacingIssue[] {
  const out: PacingIssue[] = []
  const total = docDuration(doc)
  if (total < 4) return out
  const texts = doc.clips.filter((c): c is StudioTextClip => c.kind === 'text' && !c.hidden)
  if (!texts.some((t) => t.startSec < 1)) {
    out.push({
      id: 'hook',
      title: 'Add a hook in the first second',
      detail: 'Viewers decide in about a second. Adds an editable title at 0 s — replace the placeholder with your payoff.',
      apply: (d) => {
        const track = Math.min(23, d.trackCount)
        const base = defaultTextClip(0, track)
        const clip: StudioTextClip = { ...base, durationSec: Math.min(2.5, total), name: 'Hook', text: 'Your hook — lead with the payoff', y: 0.3, anim: 'pop', transitionIn: 'none' }
        return { ...d, trackCount: Math.min(24, Math.max(d.trackCount, track + 1)), clips: [...d.clips, clip] }
      },
    })
  }
  const statics = doc.clips.filter((c): c is StudioMediaClip => c.kind === 'video' && c.track === 0 && !c.hidden && c.durationSec > 4 && !c.keyframes?.length && (c.scale ?? 1) === 1)
  if (statics.length) {
    out.push({
      id: 'punch-in',
      title: `Punch in on ${statics.length} long shot${statics.length > 1 ? 's' : ''}`,
      detail: 'Shots over 4 s with no movement feel slow. Adds a jump-cut punch-in (100% → 112%) halfway through each.',
      apply: (d) => ({
        ...d,
        clips: d.clips.map((c) => statics.some((s) => s.id === c.id) ? { ...c, keyframes: [{ at: 0, scale: 1, ease: 'hold' }, { at: Math.round((c.durationSec / 2) * 100) / 100, scale: 1.12, ease: 'hold' }] } as StudioClip : c),
      }),
    })
  }
  return out
}
