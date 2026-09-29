/**
 * Captions that follow the voice.
 *
 * The Studio can already draw word-by-word captions; what it could not do is
 * know *when* each word was spoken. This module closes that gap: it takes a
 * timed transcript (`transcript.ts`) plus the timing of every caption clip
 * already on the timeline, works out which spoken words belong to which clip,
 * and hands each clip its display text together with the per-word reveal delays
 * the renderer animates (`StudioTextClip.wordDelaysMs`).
 *
 * Three rules, all of them borrowed from how a professional captioner works:
 *
 *   1. A word belongs to the clip whose window it was spoken in.
 *   2. Words are never dropped or reordered — a caption missing the word a
 *      speaker stressed is worse than an over-full caption.
 *   3. If a clip's window contains no timed speech (a card, an intro, a silent
 *      beat) the clip keeps its own words and they are spread evenly, which
 *      still beats a static line sitting on the screen.
 *
 * Delays are emitted CLIP-RELATIVE (ms from the clip's own start), because a
 * clip that is later moved, split or retimed should keep its sync. The clip's
 * own `durationSec` is what the renderer animates against.
 *
 * Ported from veedstudio/open-edit (`cli/src/prep/synth-word-timings.ts`,
 * `cli/src/prep/transcript-types.ts`) under Apache-2.0 — see
 * THIRD_PARTY_NOTICES.md.
 */

import type { Transcript, TranscriptWord, WordTiming } from './transcript'
import { synthWordTimings, tokenizeText, toClipDelays, wordChunksOf } from './transcript'

/** A caption clip already on the timeline, plus the text it is showing now. */
export interface CaptionWindow {
  id: string
  startSec: number
  durationSec: number
  /** The clip's current text — the fallback source of words for a silent window. */
  text?: string
}

export interface CaptionStyleOptions {
  /** Soft wrap width for the emitted text. Long words are never broken. */
  maxCharsPerLine?: number
  /** Preferred line count. Words are rebalanced onto this many lines when they fit. */
  maxLines?: number
  /** Lead-in before the first spoken word when retiming, ms. */
  leadMs?: number
  /** Tail after the last spoken word when retiming, ms. */
  tailMs?: number
}

export const CAPTION_DEFAULTS = { maxCharsPerLine: 24, maxLines: 2, leadMs: 80, tailMs: 160 }

export interface CaptionAssignment {
  id: string
  /** Display text, lines separated by `\n`, words in spoken order. */
  text: string
  /** One delay per word in `text`, ms from the clip's start. */
  wordDelaysMs: number[]
  /** Spoken span of the assigned words, or null when the window held no speech. */
  spoken: { startSec: number; endSec: number } | null
  /** True when the words were spread evenly because nothing timed covered the window. */
  synthesised: boolean
  /**
   * Where the clip should sit to match the voice: first word minus the lead,
   * last word plus the tail. Null when the clip is already close (`toleranceSec`)
   * or when there is no speech to match.
   */
  suggest: { startSec: number; durationSec: number } | null
}

export interface CaptionOrphan {
  text: string
  startSec: number
  endSec: number
}

export interface CaptionReport {
  assignments: CaptionAssignment[]
  /** Timed words that no clip covered — the user's next caption, or a gap. */
  orphans: CaptionOrphan[]
  wordsTotal: number
  wordsAssigned: number
}

/** Layout a run of words onto at most `maxLines` lines, guessing nothing. */
export function wrapCaptionWords(words: string[], maxCharsPerLine = CAPTION_DEFAULTS.maxCharsPerLine, maxLines = CAPTION_DEFAULTS.maxLines): string[] {
  if (!words.length) return []
  const greedy: string[][] = [[]]
  for (const word of words) {
    const line = greedy[greedy.length - 1]
    const width = line.length ? line.join(' ').length + 1 + word.length : word.length
    if (line.length && width > maxCharsPerLine) greedy.push([word])
    else line.push(word)
  }
  if (greedy.length <= maxLines || maxLines < 1) return greedy.map((l) => l.join(' ')).filter(Boolean)

  // Too many lines: rebalance onto exactly `maxLines` by minimising the longest
  // line (classic DP), so a caption reads in two even glances instead of one
  // full line and a straggler.
  const n = words.length
  const width = (i: number, j: number) => words.slice(i, j).join(' ').length
  const cost: number[][] = Array.from({ length: maxLines + 1 }, () => new Array(n + 1).fill(Infinity))
  const split: number[][] = Array.from({ length: maxLines + 1 }, () => new Array(n + 1).fill(0))
  cost[0][0] = 0
  for (let line = 1; line <= maxLines; line++) {
    for (let end = 1; end <= n; end++) {
      for (let start = line - 1; start < end; start++) {
        if (cost[line - 1][start] === Infinity) continue
        const w = width(start, end)
        const penalty = Math.max(cost[line - 1][start], w)
        if (penalty < cost[line][end]) {
          cost[line][end] = penalty
          split[line][end] = start
        }
      }
    }
  }
  if (cost[maxLines][n] === Infinity) return greedy.map((l) => l.join(' ')).filter(Boolean)
  const lines: string[] = []
  let end = n
  for (let line = maxLines; line > 0; line--) {
    const start = split[line][end]
    lines.unshift(words.slice(start, end).join(' '))
    end = start
  }
  return lines.filter(Boolean)
}

/**
 * Beat windows for a transcript: the provider's own segments when it gave them,
 * otherwise chunked from the words themselves (`synthWordTimings`), so a
 * transcript with no segment structure still drives captions.
 */
export function beatWindows(transcript: Transcript): Array<{ text: string; startSec: number; endSec: number; delaysMs: number[] }> {
  if (!transcript.chunks.length) return []
  const { beats } = synthWordTimings(transcript.chunks, wordChunksOf(transcript))
  return beats.map((beat) => ({
    text: beat.words.map((w: WordTiming) => w.w).join(' '),
    startSec: beat.startSec,
    endSec: beat.endSec,
    delaysMs: toClipDelays(beat),
  }))
}

/**
 * Assign timed words to caption clips.
 *
 * Each word goes to the window that overlaps it most, keeping spoken order; a
 * word that no window covers shows up in `orphans` so the caller can tell the
 * user exactly where the captions stop.
 */
export function assignCaptions(transcript: Transcript, windows: CaptionWindow[], opts: CaptionStyleOptions = {}): CaptionReport {
  const style = { ...CAPTION_DEFAULTS, ...opts }
  const timed = windows
    .filter((w) => w.durationSec > 0)
    .map((w) => ({ ...w, endSec: w.startSec + w.durationSec }))
    .sort((a, b) => a.startSec - b.startSec)

  const buckets = new Map<string, TranscriptWord[]>()
  for (const w of timed) buckets.set(w.id, [])
  const orphans: CaptionOrphan[] = []

  const words = transcript.chunks
    .flatMap((chunk) => chunk.words)
    .filter((w) => w.text.trim())
    .sort((a, b) => a.timestamp[0] - b.timestamp[0])
  for (const word of words) {
    const [wStart, wEnd] = word.timestamp
    const midpoint = (wStart + wEnd) / 2
    // A word belongs to the window that overlaps it most; when two windows
    // overlap equally (a cut caption over a long one), the word follows the
    // window its midpoint was spoken in.
    let best: { id: string; overlap: number; midInside: boolean } | null = null
    for (const w of timed) {
      const overlap = Math.min(wEnd, w.endSec) - Math.max(wStart, w.startSec)
      if (overlap <= 0) continue
      const midInside = midpoint >= w.startSec && midpoint < w.endSec
      const candidate = { id: w.id, overlap, midInside }
      if (
        !best ||
        (candidate.midInside && !best.midInside) ||
        (candidate.midInside === best.midInside && candidate.overlap > best.overlap)
      ) {
        best = candidate
      }
    }
    if (best) buckets.get(best.id)!.push(word)
    else orphans.push({ text: word.text, startSec: wStart, endSec: wEnd })
  }

  const assignments: CaptionAssignment[] = []
  for (const w of timed) {
    const spoken = (buckets.get(w.id) ?? []).slice().sort((a, b) => a.timestamp[0] - b.timestamp[0])
    if (spoken.length) {
      const words = spoken.map((word) => word.text.trim()).filter(Boolean)
      const startSec = spoken[0].timestamp[0]
      const endSec = Math.max(...spoken.map((word) => word.timestamp[1]))
      const lines = wrapCaptionWords(words, style.maxCharsPerLine, style.maxLines)
      // Clip-relative: the first word lands on the clip's start, so the block's
      // entrance and the voice are the same event.
      const wordDelaysMs = spoken.map((word) => Math.max(0, Math.round((word.timestamp[0] - w.startSec) * 1000)))
      assignments.push({
        id: w.id,
        text: lines.join('\n'),
        wordDelaysMs,
        spoken: { startSec, endSec },
        synthesised: false,
        suggest: suggestTiming(w, startSec, endSec, style),
      })
      continue
    }

    // Nothing timed in this window: keep the clip's own words and spread them.
    const words = tokenizeText(w.text ?? '')
    if (!words.length) continue
    const lines = wrapCaptionWords(words, style.maxCharsPerLine, style.maxLines)
    const slot = (w.durationSec * 1000) / words.length
    assignments.push({
      id: w.id,
      text: lines.join('\n'),
      wordDelaysMs: words.map((_, i) => Math.round(i * slot)),
      spoken: null,
      synthesised: true,
      suggest: null,
    })
  }

  return {
    assignments,
    orphans,
    wordsTotal: words.length,
    wordsAssigned: words.length - orphans.length,
  }
}

function suggestTiming(
  window: { startSec: number; endSec: number },
  spokeStart: number,
  spokeEnd: number,
  style: Required<CaptionStyleOptions>,
): CaptionAssignment['suggest'] {
  const startSec = Math.max(0, spokeStart - style.leadMs / 1000)
  const durationSec = Math.max(0.5, spokeEnd + style.tailMs / 1000 - startSec)
  const driftStart = Math.abs(startSec - window.startSec)
  const driftDur = Math.abs(durationSec - (window.endSec - window.startSec))
  // Under two frames of drift on both ends is below what anyone can see.
  if (driftStart < 0.08 && driftDur < 0.08) return null
  return { startSec: Math.round(startSec * 1000) / 1000, durationSec: Math.round(durationSec * 1000) / 1000 }
}

/** Patches ready to spread over the Studio clips by id. */
export function captionPatches(
  assignments: CaptionAssignment[],
): Array<{ id: string; patch: { text: string; wordDelaysMs: number[] } }> {
  return assignments.map((a) => ({ id: a.id, patch: { text: a.text, wordDelaysMs: a.wordDelaysMs } }))
}

/** One line for the UI: how well the captions follow the voice. */
export function describeCaptions(report: CaptionReport): string {
  const { wordsAssigned, wordsTotal, orphans, assignments } = report
  const timings = assignments.filter((a) => !a.synthesised).length
  const missed = orphans.length ? `, ${orphans.length} word(s) not in any caption (first at ${orphans[0].startSec.toFixed(1)}s)` : ''
  return `${timings}/${assignments.length} captions timed to the voice, ${wordsAssigned}/${wordsTotal} words placed${missed}`
}
