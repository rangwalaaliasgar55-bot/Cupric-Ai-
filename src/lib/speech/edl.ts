/**
 * The EDL (edit decision list): which intervals of a source to keep, in output
 * order — plus the retiming of word timings onto the timeline that cut produced.
 *
 * Ported from veedstudio/open-edit `cli/src/edl.ts` and
 * `cli/src/commands/retime-transcript.ts` (Apache-2.0 — see
 * THIRD_PARTY_NOTICES.md). Adapted from file paths to in-memory media: Cupric's
 * sources are clips in a project, not paths on disk, so `sources` becomes a
 * label and the caller supplies the transcript.
 *
 * ONE reader, ONE validator, ONE snapping rule, so the assembled picture, the
 * retimed captions and the speech-tightening report are all cut on the same
 * instants. A second copy of the rounding is how captions drift a frame per cut.
 */
import type { Gap, ProbeResult } from './probe'
import type { Transcript, TranscriptChunk, TranscriptWord } from './transcript'

/** One kept interval of one source, in that source's own seconds. */
export interface EdlRange {
  source: string
  start: number
  end: number
  /** Free text carried through for the reader; ignored by the maths. */
  note?: string
}

export interface Edl {
  /** id -> a label for the source (a file name, or 'main'). */
  sources: Record<string, string>
  /** id -> transcript path or key. Absent: the transcript of that source video. */
  transcripts?: Record<string, string>
  ranges: EdlRange[]
}

/** A range whose edges sit on its source's frame grid. */
export interface SnappedRange extends EdlRange {
  fps: number
}

const r3 = (n: number) => Math.round(n * 1000) / 1000

/** The range checks both the cut and the retime share, with one set of messages between them. */
export function assertRanges(ranges: EdlRange[]): void {
  if (ranges.length === 0) throw new Error('The edit decision list has no ranges — there would be nothing left to keep.')
  ranges.forEach((range, index) => {
    // A negative trim start reads as the whole clip downstream, so the assembled
    // file would be longer than promised.
    if (range.start < 0) throw new Error(`Range ${index + 1} of “${range.source}” starts at ${range.start}, before the file begins.`)
    if (!(range.end > range.start)) {
      throw new Error(`Range ${index + 1} of “${range.source}” ends at ${range.end}, which is not after its start ${range.start}.`)
    }
  })
}

/**
 * Both edges moved UP to the next frame instant.
 *
 * A cut keeps the frames whose time is at or after `start` and before `end`, so
 * a range between frames keeps a whole number of frames that `end - start` does
 * not describe; audio cut to the raw edges then differs from the picture by up
 * to a frame per range in either direction, and the drift grows with every join.
 * On the grid, picture, sound and the retimed captions are all exactly
 * (end - start) long.
 */
export function snapToFrames(range: EdlRange, fps: number, index = 0): SnappedRange {
  const up = (t: number) => Math.ceil(t * fps - 1e-6) / fps
  const snapped = { ...range, start: up(range.start), end: up(range.end), fps }
  if (!(snapped.end > snapped.start)) {
    throw new Error(`Range ${index + 1} of “${range.source}” (${range.start}–${range.end}s) is shorter than one frame at ${fps} fps.`)
  }
  return snapped
}

/** Every range on its source's grid; `fpsBySource` is probed once per source, never per range. */
export function snapRanges(ranges: EdlRange[], fpsBySource: ReadonlyMap<string, number>): SnappedRange[] {
  return ranges.map((range, index) => {
    const fps = fpsBySource.get(range.source)
    if (fps === undefined) throw new Error(`No frame rate known for source “${range.source}”.`)
    return snapToFrames(range, fps, index)
  })
}

/** The distinct sources, in first-use order. */
export function sourceOrder(ranges: EdlRange[]): string[] {
  return [...new Set(ranges.map((r) => r.source))]
}

/** Total output length of an edit, in seconds — the film the EDL describes. */
export function edlDuration(ranges: Array<Pick<EdlRange, 'start' | 'end'>>): number {
  return r3(ranges.reduce((n, r) => n + (r.end - r.start), 0))
}

export interface CutPlan {
  /**
   * Kept ranges, in seconds INTO THE PROBED RANGE (0 = where the probe started).
   * A caller that probed a clip mid-file adds `probe.rangeStart` to get source
   * seconds — the planner works in one coordinate system, and it is the local one.
   */
  ranges: EdlRange[]
  /** Seconds removed from the source. */
  removedSec: number
  /** Gaps that were too short to cut safely, kept whole. */
  keptGaps: number
  /** Speech moments left in place because they sit between two cuts. */
  islandsKept: number
}

export interface CutOptions {
  /** Length of the source. */
  durationSec: number
  /**
   * Room tone kept either side of a cut. Cutting to the exact edge of voicing
   * clips the last consonant and sounds like a broken splice; a fifth of a
   * second is what makes a tighten inaudible.
   */
  paddingSec?: number
  /** Cuts shorter than this are not worth a join (and cost a frame of drift each). */
  minCutSec?: number
  /** An island of speech shorter than this between two cuts is cut with them. */
  minKeepSec?: number
  /** Trim leading and trailing silence too. */
  trimEdges?: boolean
}

/**
 * The cut decision: gaps measured by the probe become the intervals to remove,
 * everything else is kept.
 *
 * This is the half of open-edit's CUT step that a script can make on its own —
 * the probe gives safe cut targets, the padding and the island rule decide which
 * ones are worth taking, and the result is a normal EDL that the snapping and
 * retiming rules then apply to like any hand-made list.
 */
export function rangesFromProbe(probe: ProbeResult, opts: CutOptions): CutPlan {
  const duration = Math.max(0, opts.durationSec)
  // A probe asked to report file seconds (`rangeStart`) describes its own gaps in
  // those seconds too, so everything is shifted back to the range's own clock
  // before a single cut is decided: mixing the two produced edge trims measured
  // from the wrong end of the clip.
  const local = (t: number) => Math.max(0, Math.min(duration, t - probe.rangeStart))
  const padding = Math.max(0, opts.paddingSec ?? 0.12)
  const minCut = Math.max(0, opts.minCutSec ?? 0.2)
  const minKeep = Math.max(0, opts.minKeepSec ?? 0.25)
  const trimEdges = opts.trimEdges ?? true

  if (!probe.speechFound || duration <= 0) {
    return { ranges: duration > 0 ? [{ source: 'main', start: 0, end: r3(duration) }] : [], removedSec: 0, keptGaps: 0, islandsKept: 0 }
  }

  // Kept intervals: [0, duration] minus the gap middles (each gap shrunk by the padding).
  let kept: Array<{ start: number; end: number }> = [{ start: 0, end: duration }]
  let keptGaps = 0
  let islandsKept = 0

  const cut = (from: number, to: number) => {
    const next: Array<{ start: number; end: number }> = []
    for (const interval of kept) {
      if (to <= interval.start || from >= interval.end) {
        next.push(interval)
        continue
      }
      if (from > interval.start) next.push({ start: interval.start, end: from })
      if (to < interval.end) next.push({ start: to, end: interval.end })
    }
    kept = next
  }

  for (const gap of probe.gaps) {
    const from = local(gap.start) + padding
    const to = local(gap.end) - padding
    if (to - from < minCut) {
      keptGaps += 1
      continue
    }
    cut(from, to)
  }

  // An island of speech between two cuts, shorter than minKeep, is speech nobody
  // can hear — cut it with its neighbours instead of leaving a 90ms blip and two
  // joins to carry it.
  if (minKeep > 0 && kept.length > 2) {
    const merged: Array<{ start: number; end: number }> = []
    for (let i = 0; i < kept.length; i++) {
      const interval = kept[i]
      const interior = i > 0 && i < kept.length - 1
      if (interior && interval.end - interval.start < minKeep) {
        islandsKept += 1
        const previous = merged[merged.length - 1]
        const next = kept[i + 1]
        if (previous && next) {
          merged[merged.length - 1] = { start: previous.start, end: next.start }
          kept.splice(i + 1, 1)
        }
        continue
      }
      merged.push(interval)
    }
    kept = merged
  }

  if (trimEdges && probe.onset !== null) {
    const head = Math.max(0, local(probe.onset) - padding)
    if (head >= minCut) cut(0, head)
  }
  if (trimEdges && probe.decay !== null) {
    const tail = Math.min(duration, local(probe.decay) + padding)
    if (duration - tail >= minCut) cut(tail, duration)
  }

  const ranges: EdlRange[] = kept
    .filter((i) => i.end - i.start > 0.04)
    .map((i, n) => ({ source: 'main', start: r3(i.start), end: r3(i.end), note: n === 0 ? 'open' : undefined }))

  const keptSec = ranges.reduce((n, r) => n + (r.end - r.start), 0)
  return { ranges, removedSec: r3(Math.max(0, duration - keptSec)), keptGaps, islandsKept }
}

/**
 * The cuts an edit's kept ranges imply, inside one source window: what is left
 * of `[from, to]` once every kept range is removed.
 *
 * Kept ranges are what a probe measures; `tightenClip` and the renderer want the
 * cuts, so the flip is done in one place rather than three. Slivers under
 * `minSliverSec` are dropped — a two-frame fragment is not a cut, it is a
 * rounding artefact that costs a join.
 */
export function cutsFromRanges(ranges: Array<Pick<EdlRange, 'start' | 'end'>>, from: number, to: number, minSliverSec = 0.05): Array<[number, number]> {
  const cuts: Array<[number, number]> = []
  let cursor = from
  for (const range of [...ranges].sort((a, b) => a.start - b.start)) {
    if (range.start - cursor > minSliverSec) cuts.push([round3(Math.max(from, cursor)), round3(Math.min(to, range.start))])
    cursor = Math.max(cursor, range.end)
  }
  if (to - cursor > minSliverSec) cuts.push([round3(Math.max(from, cursor)), round3(to)])
  return cuts.filter(([a, b]) => b > a)
}

const round3 = (n: number) => Math.round(n * 1000) / 1000

/* ─────────────── retiming: words onto the cut timeline ─────────────── */

/** A word kept by the edit, already on the output timeline. */
interface Placed {
  word: TranscriptWord
  /** Index of the chunk it came from, so a chunk is not silently merged with its neighbour. */
  chunk: number
  /** Which range placed it, so one chunk cannot span a cut. */
  range: number
  /** Identity of the source word, so a word placed twice is still one word. */
  key: string
}

/** Whether any of the word lies inside the range. A zero-length word is judged by its instant. */
function touches([a, b]: [number, number], range: EdlRange): boolean {
  if (b - a <= 0) return a >= range.start && a < range.end
  return Math.min(b, range.end) - Math.max(a, range.start) > 0
}

/**
 * Words whose majority lies inside [start, end), moved so that `start` becomes
 * `offset`. A word overlapping the edge by half its length or less is dropped
 * rather than clipped — a half word is not a word.
 */
export function placeRange(transcript: Transcript, range: EdlRange, offset: number, rangeIndex: number): Placed[] {
  const out: Placed[] = []
  const { start, end } = range
  transcript.chunks.forEach((chunk, chunkIndex) => {
    chunk.words.forEach((word, wordIndex) => {
      const [a, b] = word.timestamp
      if (!touches(word.timestamp, range)) return
      const duration = b - a
      if (duration > 0 && Math.min(b, end) - Math.max(a, start) <= duration / 2) return
      const shifted: TranscriptWord = {
        text: word.text,
        timestamp: [offset + Math.max(a, start) - start, offset + Math.min(b, end) - start],
      }
      out.push({ word: shifted, chunk: chunkIndex, range: rangeIndex, key: `${range.source}#${chunkIndex}#${wordIndex}` })
    })
  })
  return out
}

/** Regroup placed words into chunks, breaking wherever the source chunk or the range changes. */
export function regroup(placed: Placed[]): TranscriptChunk[] {
  const chunks: TranscriptChunk[] = []
  let current: Placed[] = []
  const flush = () => {
    if (current.length === 0) return
    const words = current.map((p) => p.word)
    // The window spans every word, not the first and last: a provider may list
    // words out of start order, and a window that excluded one would drop a beat.
    let min = Infinity
    let max = -Infinity
    for (const w of words) {
      min = Math.min(min, w.timestamp[0])
      max = Math.max(max, w.timestamp[1])
    }
    chunks.push({
      text: words.map((w) => w.text).join(' ').replace(/\s+([,.!?;:])/g, '$1'),
      timestamp: [min, max],
      words,
    })
    current = []
  }
  for (const p of placed) {
    const previous = current[current.length - 1]
    if (previous && (previous.chunk !== p.chunk || previous.range !== p.range)) flush()
    current.push(p)
  }
  flush()
  return chunks
}

export interface RetimeResult extends Transcript {
  /** Words that overlapped a kept range but were split too finely by its edge to survive. */
  droppedAtEdges: number
  /** Seconds of the output timeline the words now cover. */
  durationSec: number
}

/**
 * Move per-word timings onto the timeline an EDL produced, instead of
 * transcribing the cut again. A cut changes when words were said, never which,
 * so every word keeps its window and shifts by its range's offset.
 *
 * Ranges arrive SNAPPED: the type is the promise that words land where the
 * picture was cut.
 */
export function retime(ranges: SnappedRange[], loadTranscript: (id: string) => Transcript): RetimeResult {
  assertRanges(ranges)
  const transcripts = new Map(sourceOrder(ranges).map((id) => [id, loadTranscript(id)]))
  const placed: Placed[] = []
  let offset = 0
  ranges.forEach((range, index) => {
    // A single range may legitimately keep nothing — b-roll, a held title, a
    // pause. Only an edit that keeps nothing ANYWHERE is the mistake.
    placed.push(...placeRange(transcripts.get(range.source)!, range, offset, index))
    offset += range.end - range.start
  })

  if (placed.length === 0) {
    throw new Error(
      'No range in this edit kept a single word. Check the ranges are in SECONDS and that the transcript belongs to this source.',
    )
  }

  // A word split near-evenly by a cut fails the majority test on both sides and
  // disappears; usually right, but counted rather than lost quietly. Counted by
  // IDENTITY: a word two ranges both offered is one word.
  const touched = new Set<string>()
  for (const range of ranges) {
    transcripts.get(range.source)!.chunks.forEach((chunk, chunkIndex) => {
      chunk.words.forEach((word, wordIndex) => {
        if (touches(word.timestamp, range)) touched.add(`${range.source}#${chunkIndex}#${wordIndex}`)
      })
    })
  }
  const kept = new Set(placed.map((p) => p.key))
  const droppedAtEdges = [...touched].filter((key) => !kept.has(key)).length

  const chunks = regroup(placed)
  chunkOrder(chunks)
  return {
    text: chunks.map((c) => c.text).join(' '),
    chunks,
    droppedAtEdges,
    durationSec: r3(offset),
  }
}

/** Sort chunks by their start, then their words, so a provider's order cannot leak through. */
export function chunkOrder(chunks: TranscriptChunk[]): TranscriptChunk[] {
  chunks.sort((a, b) => a.timestamp[0] - b.timestamp[0])
  for (const chunk of chunks) chunk.words.sort((a, b) => a.timestamp[0] - b.timestamp[0])
  return chunks
}

/** Gaps the cut left alone, for the report: what was measured vs what was removed. */
export function describeCut(plan: CutPlan, probe: ProbeResult): string {
  if (!plan.ranges.length) return 'Nothing to keep — the clip has no measurable speech and no length.'
  if (plan.ranges.length === 1) {
    const why = probe.gaps.length ? `none of its ${probe.gaps.length} gap(s) were both ≥ the safe minimum and outside the padding` : 'no safe cut gap was found'
    return `Kept whole: ${why}.`
  }
  const kept = edlDuration(plan.ranges)
  const parts = [
    `${plan.ranges.length} kept range(s), ${plan.removedSec.toFixed(2)}s of dead air removed (${kept.toFixed(2)}s left)`,
  ]
  if (plan.keptGaps) parts.push(`${plan.keptGaps} gap(s) kept because cutting them was not safe`)
  if (plan.islandsKept) parts.push(`${plan.islandsKept} island(s) of speech cut with their neighbours`)
  return `${parts.join(' · ')}.`
}

/** A probe's gaps described for a UI list. */
export const gapLabels = (gaps: Gap[]): string[] => gaps.map((g) => `${g.start.toFixed(2)}–${g.end.toFixed(2)}s (${Math.round(g.duration * 1000)}ms)`)
