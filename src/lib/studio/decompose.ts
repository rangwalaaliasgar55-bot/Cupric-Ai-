/**
 * Break a clip into editable pieces — the "import a finished video and take it
 * apart" half of the Studio.
 *
 * A video dropped into Cupric used to arrive as one indivisible block: the only
 * ways to change it were to trim its edges or tighten it (which throws the
 * pauses away). Editing someone else's cut means the opposite — every phrase,
 * every pause and every shot boundary has to become something you can select,
 * move, delete, retime or caption on its own.
 *
 * Three ways in, all producing ordinary Studio clips (so the rest of the editor
 * — captions, gates, export, undo — needs to know nothing about this file):
 *
 *   silence  measure the clip's own waveform (`studio/speechProbe.ts`) and break
 *            at the pauses. No transcript, no model, works on any file.
 *   words    break at the pauses in the words, which needs a transcription
 *            (`clip.words`, written by auto-captions).
 *   even     chop into fixed-length pieces, for footage with no speech at all
 *            (music, B-roll, screen recordings).
 *   shots    split where the picture changes (studio/shots.ts), for a montage
 *            cut to music: the cuts the edit already has, kept as the cuts.
 *   auto     the import path: split at the shots AND close up the measured
 *            pauses, so a finished video arrives as phrases and shots.
 *
 * `keepTiming` decides what happens to the removed silence: by default the
 * pieces close up (a real edit — the video gets shorter), and with
 * `keepTiming: true` every piece stays exactly where it was, silence included,
 * so the timeline still plays back identically until the user deletes a piece.
 *
 * Word timings survive: they live in SOURCE seconds on the clip, so each piece
 * keeps the words inside its own range and anything downstream (captions,
 * `wordsToTimeline`) maps them per piece without re-transcribing.
 */
import type { StudioAudioClip, StudioClip, StudioDoc, StudioMediaClip } from '../../types/project'
import { captionsForClip } from './autoCaptions'
import { speechCuts, tightenClip } from './autoEdit'
import { splitClipAt } from './doc'
import { probeClip, probeCuts } from './speechProbe'
import { analyseShots, median, remapSourceTime } from './shots'

export type DecomposeMode = 'silence' | 'words' | 'even' | 'shots' | 'auto'

export interface DecomposeOptions {
  mode?: DecomposeMode
  /** `even`: target length of each piece, in seconds. */
  pieceSec?: number
  /** `words`: a pause at least this long starts a new piece. */
  maxPauseSec?: number
  /** Keep every piece at its original timeline position instead of closing the gaps. */
  keepTiming?: boolean
  /** Label the pieces "Name · 2/5". On by default; turn off to keep the clip's name. */
  rename?: boolean
  /** Add word-timed captions for the clip before splitting, when it has word timings. */
  caption?: { maxWords?: number } | null
  /**
   * `shots`/`auto`: the shot boundaries to use, in SOURCE seconds. Omit to sample
   * the clip's frames (`analyseShots`); tests and callers that already measured
   * pass their own, so the assembly can be covered headlessly.
   */
  shots?: number[]
  /** `shots`/`auto`: detector settings (samples per second, minimum shot length). */
  shotOpts?: { fps?: number; minShotSec?: number; sensitivity?: number; width?: number }
  /** `shots`/`auto`: progress while the frames are sampled, for a status line. */
  onProgress?: (pct: number, label: string) => void
}

export interface DecomposeResult {
  doc: StudioDoc
  mode: DecomposeMode
  /** How many clips the original became (1 = nothing was split). */
  pieces: number
  /** Seconds of silence closed up (0 with `keepTiming`). */
  removedSec: number
  cuts: number
  /** Caption clips created before the split, if asked for. */
  captions: number
  reason?: string
  notes: string[]
}

const MIN_PIECE_SEC = 0.2

const fail = (doc: StudioDoc, mode: DecomposeMode, reason: string): DecomposeResult => ({ doc, mode, pieces: 1, removedSec: 0, cuts: 0, captions: 0, reason, notes: [] })

/** "Take 3 · 2/5" → "Take 3", so re-splitting does not stack suffixes. */
export function stripPieceSuffix(name: string): string {
  return name.replace(/\s·\s\d+\/\d+$/, '').trim() || name
}

export function pieceName(name: string, index: number, total: number): string {
  return `${stripPieceSuffix(name)} · ${index + 1}/${total}`
}

/** Timeline time for a source-second boundary, honouring trim, speed and position. */
function timelineTime(clip: StudioMediaClip | StudioAudioClip, sourceSec: number): number {
  const speed = clip.kind === 'video' && clip.speed > 0 ? clip.speed : 1
  return clip.startSec + (sourceSec - clip.trimInSec) / speed
}

/**
 * Split a clip at timeline times, latest first so each split's offsets stay
 * valid. Returns the doc unchanged when no time lands inside the clip.
 */
function splitAtTimes(doc: StudioDoc, clipId: string, times: number[]): { doc: StudioDoc; pieces: number } {
  let next = doc
  let pieces = 1
  const ordered = [...new Set(times.map((t) => Math.round(t * 1000) / 1000))].sort((a, b) => b - a)
  for (const t of ordered) {
    const clip = next.clips.find((c) => c.id === clipId)
    if (!clip) break
    if (t - clip.startSec <= MIN_PIECE_SEC || clip.startSec + clip.durationSec - t <= MIN_PIECE_SEC) continue
    const halves = splitClipAt(clip, t)
    if (!halves) continue
    next = { ...next, clips: next.clips.flatMap((c) => (c.id === clipId ? halves : [c])) }
    pieces += 1
  }
  return { doc: next, pieces }
}

/** The clips a split produced: the original id plus every id that did not exist before. */
function piecesOf(doc: StudioDoc, before: Set<string>, clip: StudioMediaClip | StudioAudioClip): StudioClip[] {
  return doc.clips
    .filter((c) => (c.id === clip.id || !before.has(c.id)) && c.track === clip.track && c.kind === clip.kind && (c as StudioMediaClip).mediaId === (clip as StudioMediaClip).mediaId)
    .sort((a, b) => a.startSec - b.startSec)
}

/** Split whichever clip of this track/media pair contains each timeline time, latest first. */
function splitAtTimesWhere(doc: StudioDoc, clip: StudioMediaClip | StudioAudioClip, times: number[]): { doc: StudioDoc; splits: number } {
  let next = doc
  let splits = 0
  const ordered = [...new Set(times.map((t) => Math.round(t * 1000) / 1000))].sort((a, b) => b - a)
  for (const t of ordered) {
    const target = next.clips.find((c) => c.track === clip.track && c.kind === clip.kind && (c as StudioMediaClip).mediaId === (clip as StudioMediaClip).mediaId
      && t - c.startSec > MIN_PIECE_SEC && c.startSec + c.durationSec - t > MIN_PIECE_SEC)
    if (!target) continue
    const halves = splitClipAt(target, t)
    if (!halves) continue
    next = { ...next, clips: next.clips.flatMap((c) => (c.id === target.id ? halves : [c])) }
    splits += 1
  }
  return { doc: next, splits }
}

function renamePieces(doc: StudioDoc, pieces: StudioClip[]): StudioDoc {
  if (pieces.length < 2) return doc
  const byId = new Map(pieces.map((p, i) => [p.id, pieceName(p.name, i, pieces.length)]))
  return { ...doc, clips: doc.clips.map((c) => (byId.has(c.id) ? { ...c, name: byId.get(c.id)! } : c)) }
}

/**
 * Break one clip at a list of cut ranges (source seconds). The pure half of the
 * feature: whoever worked out the cuts — the waveform probe, the word timings, a
 * test — gets the same assembly.
 *
 *   keepTiming false → the cuts are closed up (`tightenClip`: a real edit).
 *   keepTiming true  → the clip is split at the cut boundaries instead, so the
 *                      timeline still plays back identically and each pause is
 *                      its own, deletable clip.
 */
export function breakAtCuts(
  doc: StudioDoc,
  clipId: string,
  cuts: Array<[number, number]>,
  opts: { keepTiming?: boolean; rename?: boolean } = {},
): { doc: StudioDoc; pieces: number; removedSec: number; reason?: string } {
  const clip = doc.clips.find((c) => c.id === clipId)
  if (!clip || (clip.kind !== 'video' && clip.kind !== 'audio')) return { doc, pieces: 1, removedSec: 0, reason: 'Select a video or audio clip to break apart.' }
  if (!cuts.length) return { doc, pieces: 1, removedSec: 0, reason: 'No boundary to break on.' }
  const before = new Set(doc.clips.map((c) => c.id))
  if (opts.keepTiming) {
    const boundaries = cuts.flatMap(([a, b]) => [timelineTime(clip, a), timelineTime(clip, b)])
    const split = splitAtTimes(doc, clipId, boundaries)
    const pieces = piecesOf(split.doc, before, clip)
    if (pieces.length < 2) return { doc, pieces: 1, removedSec: 0, reason: 'Those boundaries fall outside this clip, so there was nothing to break.' }
    return { doc: opts.rename === false ? split.doc : renamePieces(split.doc, pieces), pieces: pieces.length, removedSec: 0 }
  }
  const tightened = tightenClip(doc, clipId, { cuts })
  if (!tightened.cuts) return { doc, pieces: 1, removedSec: 0, reason: tightened.reason ?? 'Nothing to split.' }
  const pieces = piecesOf(tightened.doc, before, clip)
  if (pieces.length < 2) return { doc, pieces: 1, removedSec: 0, reason: 'Those pauses are at the clip’s edges — trim the clip instead.' }
  return { doc: opts.rename === false ? tightened.doc : renamePieces(tightened.doc, pieces), pieces: pieces.length, removedSec: tightened.removedSec }
}

/**
 * Break one clip at timeline times, removing nothing: the same video, cut into
 * selectable pieces where the picture changes.
 */
export function breakAtPoints(
  doc: StudioDoc,
  clipId: string,
  times: number[],
  opts: { rename?: boolean } = {},
): { doc: StudioDoc; pieces: number; reason?: string } {
  const clip = doc.clips.find((c) => c.id === clipId) as StudioMediaClip | StudioAudioClip | undefined
  if (!clip || (clip.kind !== 'video' && clip.kind !== 'audio')) return { doc, pieces: 1, reason: 'Select a video or audio clip to break apart.' }
  const inside = times.filter((t) => t - clip.startSec > MIN_PIECE_SEC && clip.startSec + clip.durationSec - t > MIN_PIECE_SEC)
  if (!inside.length) return { doc, pieces: 1, reason: 'No cue lands inside this clip.' }
  const before = new Set(doc.clips.map((c) => c.id))
  const split = splitAtTimes(doc, clipId, inside)
  const pieces = piecesOf(split.doc, before, clip)
  if (pieces.length < 2) return { doc, pieces: 1, reason: 'Those boundaries sit at the clip’s edges — trim it instead.' }
  return { doc: opts.rename === false ? split.doc : renamePieces(split.doc, pieces), pieces: pieces.length }
}

/**
 * Break one clip apart. Async only because measuring the waveform (and, for the
 * shot modes, sampling frames) is; every branch returns a new doc that the
 * caller commits as ONE undo step.
 */
export async function decomposeClip(doc: StudioDoc, clipId: string, opts: DecomposeOptions = {}): Promise<DecomposeResult> {
  const mode = opts.mode ?? 'silence'
  const clip = doc.clips.find((c) => c.id === clipId)
  if (!clip || (clip.kind !== 'video' && clip.kind !== 'audio')) return fail(doc, mode, 'Select a video or audio clip to break apart.')
  if (clip.locked) return fail(doc, mode, 'That clip is locked — unlock it first.')

  // Captions first, so the cut can carry them (they are remapped by the split).
  let working = doc
  let captions = 0
  if (opts.caption && clip.words?.length) {
    const capped = captionsForClip(working, clip, clip.words, opts.caption.maxWords ?? 4)
    working = capped.doc
    captions = capped.captions.length
  }
  const target = working.clips.find((c) => c.id === clipId) as StudioMediaClip | StudioAudioClip
  const notes: string[] = []

  if (mode === 'even') {
    const pieceSec = Math.max(MIN_PIECE_SEC * 2, opts.pieceSec ?? 4)
    const count = Math.max(1, Math.round(target.durationSec / pieceSec))
    const times = Array.from({ length: count - 1 }, (_, i) => target.startSec + (i + 1) * (target.durationSec / count))
    const before = new Set(working.clips.map((c) => c.id))
    const split = splitAtTimes(working, clipId, times)
    const pieces = piecesOf(split.doc, before, target)
    if (pieces.length < 2) return fail(doc, mode, `That clip is shorter than ${(pieceSec / 2).toFixed(1)} s — there is nothing to chop.`)
    notes.push(`Chopped into ${pieces.length} pieces of about ${(target.durationSec / pieces.length).toFixed(1)} s; the timeline still plays back exactly as before.`)
    return { doc: opts.rename === false ? split.doc : renamePieces(split.doc, pieces), mode, pieces: pieces.length, removedSec: 0, cuts: 0, captions, notes }
  }

  if (mode === 'shots' || mode === 'auto') {
    const before = new Set(working.clips.map((c) => c.id))
    const videoTarget = target.kind === 'video' ? (target as StudioMediaClip) : null
    let shots = opts.shots
    if (!shots) {
      if (!videoTarget) return fail(doc, mode, 'Looking for shots means looking at the picture — select a video clip, or use the silence or even split for audio.')
      try {
        const measured = await analyseShots(videoTarget, (pct) => opts.onProgress?.(pct, 'Sampling frames to find the cuts…'), opts.shotOpts)
        shots = measured.shots
        notes.push(`Compared ${measured.samples.length} sampled frames (median change ${median(measured.samples.map((f) => f.diff)).toFixed(3)}); ${shots.length} of them looked like cuts.`)
      } catch (err) {
        return fail(doc, mode, err instanceof Error ? err.message : String(err))
      }
    }

    if (mode === 'shots') {
      if (!shots.length) return fail(doc, mode, 'The picture changes too little from frame to frame to find a cut — nothing was split. Use the silence or even split instead.')
      const broken = breakAtPoints(working, clipId, shots.map((t) => (videoTarget ? timelineTime(videoTarget, t) : t)), { rename: opts.rename })
      if (broken.reason) return fail(doc, mode, broken.reason)
      notes.push(`Split at ${broken.pieces - 1} shot boundar${broken.pieces === 2 ? 'y' : 'ies'} — nothing was removed, so the timeline still plays back exactly as before.`)
      return { doc: broken.doc, mode, pieces: broken.pieces, removedSec: 0, cuts: shots.length, captions, notes }
    }

    // `auto` — the import path: close what the voice left empty, then split the
    // result at the shot cuts that survived (one inside removed silence has
    // nowhere to land and is skipped rather than creating an empty piece).
    const range: [number, number] = [target.trimInSec, target.trimInSec + target.durationSec * (target.kind === 'video' && target.speed > 0 ? target.speed : 1)]
    let cuts: Array<[number, number]> = []
    if (target.words?.length) {
      cuts = speechCuts(target.words, range, { maxPauseSec: opts.maxPauseSec ?? 0.45, fillers: false })
      if (cuts.length) notes.push(`Closed ${cuts.length} pause${cuts.length === 1 ? '' : 's'} found in the word timings.`)
    }
    if (!cuts.length && (target.kind === 'video' || target.kind === 'audio')) {
      const measured = await probeClip(target)
      if (!measured) notes.push('This clip’s audio could not be read, so no pause was closed — only the picture was split.')
      else if (!measured.probe.speechFound) notes.push('No speech in this clip, so no pause was closed — only the picture was split.')
      else {
        cuts = probeCuts(measured)
        notes.push(cuts.length
          ? `Closed ${cuts.length} pause${cuts.length === 1 ? '' : 's'} measured in the waveform (floor ${measured.probe.floor.toFixed(1)} dB).`
          : 'No pause in this clip is long enough to close safely.')
      }
    }

    let next = working
    let removedSec = 0
    if (cuts.length) {
      const tightened = breakAtCuts(working, clipId, cuts, { keepTiming: opts.keepTiming, rename: false })
      if (tightened.reason) return fail(doc, mode, tightened.reason)
      next = tightened.doc
      removedSec = tightened.removedSec
    }
    const mapped = videoTarget && shots.length
      ? shots.map((t) => (opts.keepTiming ? timelineTime(videoTarget, t) : remapSourceTime(t, videoTarget, cuts)))
      : []
    const split = splitAtTimesWhere(next, target, mapped)
    const pieces = piecesOf(split.doc, before, target)
    if (pieces.length < 2) {
      return fail(doc, mode, shots.length || cuts.length
        ? 'Every boundary this clip has sits at its edges or inside the removed silence — nothing was split.'
        : 'Nothing to break on: no shot change and no pause worth closing.')
    }
    if (shots.length > split.splits) {
      const lost = shots.length - split.splits
      notes.push(`${lost} of ${shots.length} shot cut${shots.length === 1 ? '' : 's'} landed inside removed silence or on a piece edge, so ${lost === 1 ? 'it' : 'they'} left no extra piece.`)
    }
    notes.push(`Arrived as ${pieces.length} clips${removedSec ? `, ${removedSec.toFixed(1)} s of silence closed up` : ''}. Each one is an ordinary clip: retime, move, delete or caption it on its own.`)
    if (target.words?.length) notes.push('Word timings stay on the pieces (source seconds), so captions and word-timed components keep working.')
    return { doc: opts.rename === false ? split.doc : renamePieces(split.doc, pieces), mode, pieces: pieces.length, removedSec, cuts: cuts.length + split.splits, captions, notes }
  }

  const range: [number, number] = [target.trimInSec, target.trimInSec + target.durationSec * (target.kind === 'video' && target.speed > 0 ? target.speed : 1)]
  let cuts: Array<[number, number]>
  if (mode === 'words') {
    if (!target.words?.length) return fail(doc, mode, 'This clip has no word timings yet — transcribe it (Pro → Auto-captions), or break it at its measured silence instead.')
    const maxPauseSec = opts.maxPauseSec ?? 0.45
    // `fillers: false` keeps every word: breaking a clip apart must never delete
    // a spoken "um" that the user did not ask to lose.
    cuts = speechCuts(target.words, range, { maxPauseSec, fillers: false })
    if (!cuts.length) return fail(doc, mode, `No pause in this clip reaches ${maxPauseSec.toFixed(2)} s, so there is no boundary to break on.`)
    notes.push(`Broke at ${cuts.length} pause${cuts.length === 1 ? '' : 's'} of ${maxPauseSec.toFixed(2)} s or more in the word timings.`)
  } else {
    const measured = await probeClip(target)
    if (!measured) return fail(doc, mode, 'Cupric cannot read this clip’s audio — relink the file, or transcribe it and break at the pauses in the words.')
    if (!measured.probe.speechFound) return fail(doc, mode, 'No speech in this clip: the level never rises 6 dB above its own floor. Use “split evenly” for footage like this.')
    cuts = probeCuts(measured)
    if (!cuts.length) return fail(doc, mode, 'Every pause in this clip is shorter than the safe minimum — breaking there would slice the speech.')
    notes.push(`Found ${cuts.length} pause${cuts.length === 1 ? '' : 's'} in the waveform (measured floor ${measured.probe.floor.toFixed(1)} dB, speech threshold ${measured.probe.threshold.toFixed(1)} dB).`)
  }

  const broken = breakAtCuts(working, clipId, cuts, { keepTiming: opts.keepTiming, rename: opts.rename })
  if (broken.reason) return fail(doc, mode, broken.reason)
  if (opts.keepTiming) {
    // Every piece stays where it was, pauses included: the sequence is still the
    // same video, but now each phrase and each silence is its own clip.
    notes.push(`Kept the original timing: ${broken.pieces} clips, including the pauses as their own clips. Delete a pause clip to close the gap.`)
  } else {
    notes.push(`${broken.pieces} pieces, ${broken.removedSec.toFixed(1)} s of silence closed up. Each piece is an ordinary clip: retime, move, delete or caption it on its own.`)
    if (target.words?.length) notes.push('Word timings stay on the pieces (source seconds), so captions and word-timed components keep working.')
  }
  return { doc: broken.doc, mode, pieces: broken.pieces, removedSec: broken.removedSec, cuts: cuts.length, captions, notes }
}
