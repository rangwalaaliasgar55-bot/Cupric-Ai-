/**
 * Transcription: one shape for every Whisper-family payload, and the per-word
 * reveal timings captions animate from.
 *
 * Ported from veedstudio/open-edit (Apache-2.0 — see THIRD_PARTY_NOTICES.md),
 * files `cli/src/prep/transcript-types.ts`, `cli/src/prep/whisper-mapper.ts` and
 * `cli/src/prep/synth-word-timings.ts`, and adapted so the same code runs in the
 * renderer (a file the user drops in), on the desktop (whisper.cpp through IPC)
 * and in the headless check.
 *
 * WHY THE PORT MATTERS. Cupric already transcribed on the desktop, but each
 * caller got whatever shape its engine produced: whisper.cpp words here, a
 * pasted paragraph there, and captions that had to guess at timing. Downstream
 * could not tell which provider ran, so it could not be right for all of them.
 * Here every family is normalised once — interpolate the untimed words, group
 * them into beats, sort, then ASSERT nothing was lost — and everything after
 * this file reads one transcript shape.
 *
 * THE INVARIANT: words in === words out. A mapper that silently drops a word
 * produces a caption that skips a spoken word, which is the one failure a viewer
 * always notices. It throws instead.
 */

export interface TranscriptWord {
  text: string
  /** [startSec, endSec] on the source's own timeline. */
  timestamp: [number, number]
}

export interface TranscriptChunk {
  text: string
  timestamp: [number, number]
  words: TranscriptWord[]
}

export interface Transcript {
  text: string
  chunks: TranscriptChunk[]
}

/* ─────────────── accepted provider shapes ─────────────── */

/** `word` is openai-whisper / WhisperX / mlx-whisper; `text` is whisper-timestamped. */
export interface WhisperWord {
  word?: string
  text?: string
  start?: number
  end?: number
}

export interface WhisperSegment {
  start?: number
  end?: number
  text?: string
  words?: WhisperWord[]
}

/** whisper.cpp `--output-json` (-oj): offsets are integer MILLISECONDS. */
export interface WhisperCppEntry {
  text?: string
  offsets?: { from?: number; to?: number }
}

export interface WhisperJson {
  text?: string
  segments?: WhisperSegment[]
  words?: WhisperWord[]
  transcription?: WhisperCppEntry[]
}

export interface GroupOptions {
  /** Start a new cue when the silence before a word is at least this long. */
  gapSec?: number
  /** Hard cap on words per cue, so a pauseless monologue still yields beats. */
  maxWords?: number
}

export interface MapResult {
  transcript: Transcript
  /** Words the provider left untimed, whose windows were inferred. */
  interpolated: number
  /** Words whose times ran backwards and were reordered to match their reveals. */
  reordered: number
}

export const DEFAULT_GAP_SEC = 0.6
export const DEFAULT_MAX_WORDS = 8

const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n)
const r3 = (n: number) => Math.round(n * 1000) / 1000

/** One token on its way to becoming a word. `inferred` marks a window we made up. */
interface Pending {
  text: string
  start?: number
  end?: number
  inferred?: boolean
  /** Index of the provider segment this came from; undefined when there is no segmentation. */
  group?: number
}

/**
 * A provider "word" containing whitespace is a segment in disguise —
 * whisper.cpp without `-ml 1` emits whole sentences this way. Splitting marks
 * the windows inferred, so such a transcript reports a large interpolation
 * count instead of passing as word-timed.
 */
function tokenize(p: Pending): Pending[] {
  const parts = p.text.split(/\s+/).filter((t) => t !== '')
  if (parts.length <= 1) return parts.length === 1 ? [{ ...p, text: parts[0] }] : []
  if (!finite(p.start) || !finite(p.end)) {
    return parts.map((text) => ({ text, group: p.group, inferred: true }))
  }
  // Proportional to token length: longer words take longer to say.
  const total = parts.reduce((n, t) => n + t.length, 0) || parts.length
  const span = Math.max(0, p.end - p.start)
  let cursor = p.start
  return parts.map((text) => {
    const width = (span * text.length) / total
    const word = { text, start: cursor, end: cursor + width, inferred: true, group: p.group }
    cursor += width
    return word
  })
}

function pendingFromWords(words: WhisperWord[], group?: number): Pending[] {
  return words
    .map((w) => ({ text: (w.word ?? w.text ?? '').trim(), start: w.start, end: w.end, group }))
    .flatMap((p) => tokenize(p))
}

function pendingFromCpp(entries: WhisperCppEntry[]): Pending[] {
  return entries
    .map((e) => {
      const from = e.offsets?.from
      const to = e.offsets?.to
      return {
        text: (e.text ?? '').trim(),
        start: finite(from) ? from / 1000 : undefined,
        end: finite(to) ? to / 1000 : undefined,
      }
    })
    .flatMap((p) => tokenize(p))
}

/** Spreads `count` windows evenly across [from,to]; a zero-width span yields zero-width windows. */
function spread(from: number, to: number, count: number): [number, number][] {
  const lo = Math.min(from, to)
  const hi = Math.max(from, to)
  const step = count > 0 ? (hi - lo) / count : 0
  return Array.from({ length: count }, (_, i) => [lo + step * i, lo + step * (i + 1)])
}

/**
 * Timing runs over the WHOLE transcript, not per segment: a segment whose
 * alignment failed entirely then borrows the gap between its neighbours'
 * anchors instead of vanishing for want of a window.
 */
function timeAll(
  pending: Pending[],
  bounds: { start?: number; end?: number }[],
): { words: TranscriptWord[]; groups: (number | undefined)[]; interpolated: number } {
  const anchored = pending.map((p) => finite(p.start) && finite(p.end))
  const firstAnchor = anchored.indexOf(true)
  const lastAnchor = anchored.lastIndexOf(true)
  if (firstAnchor === -1) return { words: [], groups: [], interpolated: 0 }

  const words: TranscriptWord[] = []
  const groups: (number | undefined)[] = []
  let interpolated = 0
  let i = 0
  while (i < pending.length) {
    if (anchored[i]) {
      words.push({ text: pending[i].text, timestamp: [pending[i].start as number, pending[i].end as number] })
      groups.push(pending[i].group)
      if (pending[i].inferred) interpolated += 1
      i += 1
      continue
    }
    let j = i // [i, j) is a maximal run of untimed words
    while (j < pending.length && !anchored[j]) j += 1
    const groupStart = bounds[pending[i].group ?? -1]?.start
    const groupEnd = bounds[pending[j - 1].group ?? -1]?.end
    const from = i > firstAnchor
      ? (pending[i - 1].end as number)
      : (finite(groupStart) ? groupStart : (pending[firstAnchor].start as number))
    const to = j <= lastAnchor
      ? (pending[j].start as number)
      : (finite(groupEnd) ? groupEnd : (pending[lastAnchor].end as number))
    const windows = spread(from, to, j - i)
    for (let k = i; k < j; k += 1) {
      words.push({ text: pending[k].text, timestamp: windows[k - i] })
      groups.push(pending[k].group)
      interpolated += 1
    }
    i = j
  }
  return { words, groups, interpolated }
}

/** The window must cover its own words: a beat whose words fall outside is dropped by the animator. */
function chunkOf(words: TranscriptWord[], start?: number, end?: number): TranscriptChunk | undefined {
  if (words.length === 0) return undefined
  // MIN start and MAX end across every word, not first/last by start-order:
  // overlaps are normal in ASR, so an interior word can start later yet end
  // later still, and a window bounded by the last word's end would leave that
  // word's midpoint outside it.
  const earliest = words.reduce((min, w) => Math.min(min, w.timestamp[0]), Infinity)
  const latestEnd = words.reduce((max, w) => Math.max(max, w.timestamp[1]), -Infinity)
  const from = Math.min(finite(start) ? start : earliest, earliest)
  const to = Math.max(finite(end) ? end : latestEnd, latestEnd)
  return { text: words.map((w) => w.text).join(' '), timestamp: [from, to], words }
}

/**
 * Cue boundaries from prosody, not from the model: sentence-ending punctuation,
 * a real pause, or the word cap. Used only when the provider gave no
 * segmentation of its own.
 */
export function groupWordsIntoChunks(words: TranscriptWord[], opts: GroupOptions = {}): TranscriptChunk[] {
  const gapSec = opts.gapSec ?? DEFAULT_GAP_SEC
  const maxWords = Math.max(1, opts.maxWords ?? DEFAULT_MAX_WORDS)
  const chunks: TranscriptChunk[] = []
  let current: TranscriptWord[] = []

  const flush = (): void => {
    const chunk = chunkOf(current)
    if (chunk) chunks.push(chunk)
    current = []
  }

  for (const word of words) {
    const previous = current[current.length - 1]
    if (previous && word.timestamp[0] - previous.timestamp[1] >= gapSec) flush()
    current.push(word)
    if (current.length >= maxWords || /[.!?…]["')\]]?$/.test(word.text)) flush()
  }
  flush()
  return chunks
}

/**
 * Assigns a flat word list to wordless segments by midpoint. Words past the
 * last segment stay with the last one rather than being discarded: provider
 * word times routinely run past a segment's end.
 */
function assignToSegments(segments: WhisperSegment[], pending: Pending[]): Pending[] {
  const cuts: (number | undefined)[] = segments.map((s, i) => {
    if (finite(s.end)) return s.end
    const nextStart = segments[i + 1]?.start
    return finite(nextStart) ? nextStart : undefined
  })
  for (let i = cuts.length - 2; i >= 0; i -= 1) {
    if (cuts[i] === undefined) cuts[i] = cuts[i + 1]
  }

  let group = 0
  return pending.map((p) => {
    const mid = finite(p.start) && finite(p.end) ? (p.start + p.end) / 2 : undefined
    if (mid !== undefined) {
      while (group < segments.length - 1) {
        const cut = cuts[group]
        if (cut === undefined || mid <= cut) break
        group += 1
      }
    }
    return { ...p, group }
  })
}

/**
 * Provider order is not guaranteed. Overlapping word windows are normal in ASR
 * and left alone; starts that run BACKWARDS are not, and are sorted so the
 * caption text and the reveal order agree.
 */
function orderWords(words: TranscriptWord[]): { words: TranscriptWord[]; reordered: number } {
  let reordered = 0
  for (let i = 1; i < words.length; i += 1) {
    if (words[i].timestamp[0] < words[i - 1].timestamp[0]) reordered += 1
  }
  if (reordered === 0) return { words, reordered }
  return { words: [...words].sort((a, b) => a.timestamp[0] - b.timestamp[0]), reordered }
}

export class NoWordTimingsError extends Error {
  constructor() {
    super(
      'No per-word timings in this transcript. Re-run the transcription with word timestamps ' +
      '(WhisperX emits them by default · openai-whisper / mlx-whisper: --word_timestamps True · ' +
      'whisper.cpp: -oj -ml 1 · OpenAI API: timestamp_granularities=["word"]). ' +
      'Without them the caption animation would guess, so Cupric will not pretend it knows.',
    )
    this.name = 'NoWordTimingsError'
  }
}

/**
 * Map any accepted Whisper-family payload into the editor's transcript shape.
 *
 * ONE PIPELINE, because a branch per family is a branch per way of losing a word:
 *   normalise → flat Pending[] (+ segment bounds)
 *     → time   interpolate untimed words from their neighbours ACROSS boundaries
 *     → group  one chunk per provider segment, or prosody grouping when there is none
 *     → order  sort chunks, and words within a chunk
 *     → assert output word count === input word count, or throw
 */
export function mapWhisperTranscript(input: WhisperJson, opts: GroupOptions = {}): MapResult {
  if (!input || typeof input !== 'object') throw new Error('That file is not a Whisper transcription (expected a JSON object).')
  const segments = Array.isArray(input.segments) ? input.segments : []
  const flatWords = Array.isArray(input.words) ? input.words : []
  const cppEntries = Array.isArray(input.transcription) ? input.transcription : []

  const segmentsCarryWords = segments.some((s) => Array.isArray(s.words) && s.words.length > 0)
  let pending: Pending[]
  if (segmentsCarryWords) {
    // A segment whose alignment failed (WhisperX leaves `words` off individual
    // segments all the time) still has its text. Dropping it would silently
    // remove a whole sentence from the captions — and the word-count invariant
    // cannot see it, because the count is taken from what was collected. Keep
    // its tokens untimed instead; `timeAll` gives them windows between the
    // surviving anchors and the segment's own bounds.
    pending = segments.flatMap((s, i) => {
      const words = Array.isArray(s.words) ? s.words : []
      if (words.length) return pendingFromWords(words, i)
      return tokenizeText(s.text ?? '').map((text) => ({ text, group: i, inferred: true }))
    })
  } else {
    const loose = flatWords.length > 0 ? pendingFromWords(flatWords) : pendingFromCpp(cppEntries)
    pending = segments.length > 0 ? assignToSegments(segments, loose) : loose
  }
  const inputWords = pending.length

  const bounds = segments.map((s) => ({ start: s.start, end: s.end }))
  const { words, groups, interpolated } = timeAll(pending, bounds)

  if (words.length === 0) throw new NoWordTimingsError()

  let chunks: TranscriptChunk[]
  let reordered = 0
  if (segments.length > 0) {
    chunks = segments
      .map((s, i) => {
        const mine = words.filter((_, k) => groups[k] === i)
        const ordered = orderWords(mine)
        reordered += ordered.reordered
        // An absent end borrows the next segment's start rather than swallowing the rest of the words.
        const end = finite(s.end) ? s.end : segments.slice(i + 1).map((n) => n.start).find(finite)
        return chunkOf(ordered.words, s.start, end)
      })
      .filter((c): c is TranscriptChunk => c !== undefined)
  } else {
    const ordered = orderWords(words)
    reordered += ordered.reordered
    chunks = groupWordsIntoChunks(ordered.words, opts)
  }

  chunks.sort((a, b) => a.timestamp[0] - b.timestamp[0])

  const outputWords = chunks.reduce((n, c) => n + c.words.length, 0)
  if (outputWords !== inputWords) {
    throw new Error(
      `Internal error while mapping this transcript: ${inputWords} words in, ${outputWords} out. ` +
      'A word was lost; this is a bug in the mapper, not in the file.',
    )
  }

  return { transcript: { text: chunks.map((c) => c.text).join(' '), chunks }, interpolated, reordered }
}

/* ─────────────── captions: beats and per-word reveals ─────────────── */

/** One transcript chunk at either granularity: [startSec, endSec] + its text. */
export interface TimedChunk {
  timestamp: [number, number]
  text: string
}

export interface WordTiming {
  w: string
  /** Milliseconds from the start of the beat's clip (see `toClipDelays`). */
  delayMs: number
}

export interface BeatTiming {
  i: number
  startSec: number
  endSec: number
  words: WordTiming[]
}

export interface WordTimings {
  beats: BeatTiming[]
}

const cleanWord = (text: string) => text.trim()
export const tokenizeText = (text: string): string[] => text.trim().split(/\s+/).filter(Boolean)

/**
 * Even-split fallback: words revealed back-to-back from cue start at
 * slot = window/wordCount, so the last word lands one slot before the window
 * closes. Always in-window and monotonic.
 */
export function evenSplitDelays(startSec: number, endSec: number, words: string[]): WordTiming[] {
  const cueDelayMs = Math.round(startSec * 1000)
  const winMs = Math.max(0, Math.round((endSec - startSec) * 1000))
  const n = words.length
  const slot = n > 0 ? winMs / n : 0
  return words.map((w, i) => ({ w: cleanWord(w), delayMs: cueDelayMs + Math.round(i * slot) }))
}

function isTimed(c: unknown): c is TimedChunk {
  const t = (c as TimedChunk)?.timestamp
  return Array.isArray(t) && t.length === 2 && typeof t[0] === 'number' && typeof t[1] === 'number'
    && typeof (c as TimedChunk).text === 'string'
}

/**
 * Map real word times into a beat, in order, as absolute-ms delays clamped into
 * the beat window and kept monotonic (transcript word starts are already sorted,
 * but guard against jitter and overlap).
 */
function realWordDelays(seg: TimedChunk, words: TimedChunk[]): WordTiming[] {
  const [s, e] = seg.timestamp
  const cueDelayMs = Math.round(s * 1000)
  const cueEndMs = cueDelayMs + Math.max(0, Math.round((e - s) * 1000))
  const inBeat = words
    .filter((w) => { const m = (w.timestamp[0] + w.timestamp[1]) / 2; return m >= s && m < e })
    .sort((a, b) => a.timestamp[0] - b.timestamp[0])
  let prev = cueDelayMs
  return inBeat.map((w) => {
    let d = Math.round(w.timestamp[0] * 1000)
    if (d < cueDelayMs) d = cueDelayMs
    if (d < prev) d = prev
    if (d > cueEndMs) d = cueEndMs
    prev = d
    return { w: cleanWord(w.text), delayMs: d }
  })
}

/**
 * Build per-beat word timings. `segments` = transcript segment chunks (beats);
 * `words` = per-word chunks, or null to force the even-split fallback.
 *
 * COMPLETENESS GUARD: the caption must equal the transcript. Midpoint binning
 * can drop words whose midpoint lands in an inter-segment gap or on a boundary,
 * or disagree with the segment's own tokenisation — any count mismatch means the
 * real timings are unsafe for THIS beat, so it even-splits its own tokens rather
 * than rendering a caption missing spoken words.
 */
export function synthWordTimings(segments: TimedChunk[], words?: TimedChunk[] | null): WordTimings {
  const wordChunks = (words ?? []).filter(isTimed)
  const beats = segments.map((seg, idx) => {
    if (!isTimed(seg)) throw new Error(`Transcript chunk ${idx + 1} has no usable timestamp — its cue window cannot be derived.`)
    const [s, e] = seg.timestamp
    const tokens = tokenizeText(seg.text)
    const real = wordChunks.length > 0 ? realWordDelays(seg, wordChunks) : []
    const timings = real.length === tokens.length && real.length > 0 ? real : evenSplitDelays(s, e, tokens)
    return { i: idx + 1, startSec: s, endSec: e, words: timings }
  })
  return { beats }
}

/** Word chunks from a transcript: every chunk's words, flattened, timed. */
export function wordChunksOf(transcript: Transcript): TimedChunk[] {
  return transcript.chunks.flatMap((c) => c.words.map((w) => ({ timestamp: w.timestamp, text: w.text })))
}

/**
 * Beats → delays RELATIVE to clip start, which is what a Studio text clip needs:
 * the clip can be moved, split or retimed and every word stays in sync with the
 * voice, instead of carrying an absolute timeline time that a drag invalidates.
 */
export function toClipDelays(beat: BeatTiming): number[] {
  const base = Math.round(beat.startSec * 1000)
  return beat.words.map((w) => Math.max(0, w.delayMs - base))
}

/** `synthWordTimings` straight from a transcript. */
export function wordTimingsFor(transcript: Transcript, opts: GroupOptions = {}): WordTimings {
  const beats = transcript.chunks.length
    ? transcript.chunks
    : groupWordsIntoChunks(transcript.chunks.flatMap((c) => c.words), opts)
  return synthWordTimings(beats, wordChunksOf({ ...transcript, chunks: beats }))
}

/** The reverse direction, for artefacts: a transcript from caption text + delays. */
export function transcriptWordCount(transcript: Transcript): number {
  return transcript.chunks.reduce((n, c) => n + c.words.length, 0)
}

/** Rounded transcript for on-disk artefacts (`transcript.json`). */
export function transcriptToJson(transcript: Transcript): Transcript {
  return {
    text: transcript.text,
    chunks: transcript.chunks.map((c) => ({
      text: c.text,
      timestamp: [r3(c.timestamp[0]), r3(c.timestamp[1])],
      words: c.words.map((w) => ({ text: w.text, timestamp: [r3(w.timestamp[0]), r3(w.timestamp[1])] })),
    })),
  }
}

/** `word-timings.json`, in the shape the CLI wrote, so artefacts stay interchangeable. */
export function wordTimingsToJson(timings: WordTimings): { beats: Array<{ i: number; startSec: number; endSec: number; cueDelayMs: number; cueDurMs: number; words: WordTiming[] }> } {
  return {
    beats: timings.beats.map((b) => ({
      i: b.i,
      startSec: r3(b.startSec),
      endSec: r3(b.endSec),
      cueDelayMs: Math.round(b.startSec * 1000),
      cueDurMs: Math.max(0, Math.round((b.endSec - b.startSec) * 1000)),
      words: b.words,
    })),
  }
}
