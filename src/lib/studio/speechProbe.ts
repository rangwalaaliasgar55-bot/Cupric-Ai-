/**
 * Measure a clip's own audio, then cut where it is actually quiet.
 *
 * Speech tightening used to need word timings, which need a transcription, which
 * needs a model — so a clip Cupric had never transcribed could not be tightened
 * at all. The probe removes that dependency: decode the clip's audio with
 * WebAudio, measure the noise floor and the gaps above it (`speech/probe.ts`),
 * and hand the gaps to the existing cut machinery as source-second cuts.
 *
 * The two paths agree by construction: word-based tightening cuts at pauses in
 * the words, probe-based tightening cuts at pauses in the waveform. Whichever
 * evidence exists, the clip becomes sub-clips butted together by `tightenClip`,
 * and captions and overlays move with it.
 */

import type { StudioAudioClip, StudioDoc, StudioMediaClip } from '../../types/project'
import { cutsFromRanges, rangesFromProbe, type CutPlan } from '../speech/edl'
import { decodeWithWebAudio, probeFloatPcm, type ProbeResult } from '../speech/probe'
import { tightenClip } from './autoEdit'
import { getMedia } from './media'

export interface ClipProbe {
  probe: ProbeResult
  /** The clip's used range in source seconds: [trimIn, trimIn + duration × speed]. */
  range: [number, number]
  plan: CutPlan
}

/** Probes are expensive (a full decode); the same clip must not pay twice. */
const cache = new Map<string, ClipProbe>()

export function clearProbeCache(): void {
  cache.clear()
}

function rangeOf(clip: StudioMediaClip | StudioAudioClip): [number, number] {
  const speed = clip.kind === 'video' && clip.speed > 0 ? clip.speed : 1
  return [clip.trimInSec, clip.trimInSec + clip.durationSec * speed]
}

/**
 * Decode the clip's file and measure it. Null when there is no file on this
 * machine to read (a clip that needs relinking, or an image clip).
 */
export async function probeClip(clip: StudioMediaClip | StudioAudioClip, opts: { paddingSec?: number; minCutSec?: number; maxSeconds?: number } = {}): Promise<ClipProbe | null> {
  const handle = getMedia(clip.mediaId)
  if (!handle || (handle.kind !== 'video' && handle.kind !== 'audio')) return null
  const range = rangeOf(clip)
  const key = `${handle.id}:${range[0]}:${range[1]}:${opts.paddingSec ?? ''}:${opts.minCutSec ?? ''}`
  const hit = cache.get(key)
  if (hit) return hit

  const response = await fetch(handle.url)
  const data = await response.arrayBuffer()
  const decoded = await decodeWithWebAudio(data)
  if (!decoded.mono.length) return null

  // Probe only the clip's used range: the probe's times are source seconds, so
  // the cuts it produces drop straight into the clip.
  const from = Math.max(0, Math.floor(range[0] * decoded.sampleRate))
  // A long source is measured at its head: a 40-minute interview's first three
  // minutes say whether the room is quiet, and nobody waits for the rest.
  const maxSamples = Math.round((opts.maxSeconds ?? 900) * decoded.sampleRate)
  const to = Math.min(decoded.mono.length, Math.floor(range[1] * decoded.sampleRate), from + maxSamples)
  if (to <= from) return null
  const slice = decoded.mono.slice(from, to)
  // The probe reports times in the file's own seconds; the planner then works
  // out its ranges on the probed range's clock, and this is where the two meet.
  const probe = probeFloatPcm(decoded.sampleRate, slice, { rangeStart: range[0] })
  const plan = rangesFromProbe(probe, {
    durationSec: slice.length / decoded.sampleRate,
    paddingSec: opts.paddingSec ?? 0.12,
    minCutSec: opts.minCutSec ?? 0.2,
    minKeepSec: 0.25,
    trimEdges: true,
  })
  // Shift the kept ranges onto the clip's own range, so the cuts line up with
  // `tightenClip`'s expectations whatever the trim was.
  const ranges = plan.ranges.map((r) => ({ ...r, source: clip.id, start: r.start + range[0], end: r.end + range[0] }))
  const local: ClipProbe = { probe, range, plan: { ...plan, ranges } }
  cache.set(key, local)
  return local
}

/** The cuts a measurement implies for a clip, in source seconds. */
export function probeCuts(measured: ClipProbe): Array<[number, number]> {
  return cutsFromRanges(measured.plan.ranges, measured.range[0], measured.range[1])
}

/**
 * Tighten a clip by measurement: probe it, flip the kept ranges into cuts, then
 * run the same cut the word-based path runs — one undo step, captions included.
 */
export async function tightenWithProbe(
  doc: StudioDoc,
  clipId: string,
  opts: { paddingSec?: number; minCutSec?: number } = {},
): Promise<{ doc: StudioDoc; removedSec: number; cuts: number; reason?: string; probe?: ProbeResult }> {
  const clip = doc.clips.find((c) => c.id === clipId)
  if (!clip || (clip.kind !== 'video' && clip.kind !== 'audio')) return { doc, removedSec: 0, cuts: 0, reason: 'Select a video or audio clip.' }
  if (clip.locked) return { doc, removedSec: 0, cuts: 0, reason: 'That clip is locked.' }
  const measured = await probeClip(clip, opts)
  if (!measured) return { doc, removedSec: 0, cuts: 0, reason: 'Cupric cannot read this clip’s audio — relink the file, or transcribe it instead.' }
  if (!measured.probe.speechFound) {
    return { doc, removedSec: 0, cuts: 0, reason: 'No speech to find here: the level never rises 6 dB above its own floor, so there is no gap that is safe to cut.', probe: measured.probe }
  }
  const cuts = probeCuts(measured)
  if (!cuts.length) {
    return { doc, removedSec: 0, cuts: 0, reason: 'Every pause in this clip is shorter than the safe minimum — cutting them would slice the speech.', probe: measured.probe }
  }
  const result = tightenClip(doc, clipId, { cuts })
  return { ...result, probe: measured.probe }
}
