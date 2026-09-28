/**
 * JOB 13 — coloured-keyword and highlight-chip RUNS.
 *
 * `highlightWord` could only ever mark one word, and it only ever changed that
 * word's colour. The look this pack is chasing highlights a PHRASE — "in six
 * weeks", "without a gym" — and draws a filled chip behind the whole run, not
 * a ragged box per word.
 *
 * So the matching has to work on runs of consecutive words, and the chip has
 * to be measured across the run as a unit. Both live here as pure functions,
 * because the preview and the export call the same code and must agree to the
 * pixel.
 *
 * Nothing here invents text. A run that is not literally present in the clip's
 * own words simply does not match, and nothing is highlighted.
 */

/** One word of a caption line, plus where it sits in a highlighted run. */
export type WordRun = {
  word: string
  /** Index of the run this word belongs to, or -1 when it is not highlighted. */
  run: number
  /** True for the first word of a run — where a chip starts. */
  runStart: boolean
  /** True for the last word of a run — where a chip ends. */
  runEnd: boolean
}

/** How a highlighted run is painted. */
export type HighlightStyle = 'color' | 'chip'

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '')

/**
 * Split a phrase spec into individual runs.
 *
 * Commas separate alternatives, so `"six weeks, no gym"` marks two phrases.
 * Empty fragments are dropped rather than matching everything.
 */
export function parseRuns(spec: string | null | undefined): string[][] {
  if (!spec) return []
  return spec
    .split(',')
    .map((phrase) => phrase.split(/\s+/).map(norm).filter(Boolean))
    .filter((words) => words.length > 0)
}

/**
 * Mark which words of `words` fall inside a highlighted run.
 *
 * Longest runs are matched first so `"six weeks"` wins over a bare `"six"`,
 * and matches never overlap — a word belongs to exactly one run.
 */
export function markRuns(words: string[], spec: string | null | undefined): WordRun[] {
  const marks: WordRun[] = words.map((word) => ({ word, run: -1, runStart: false, runEnd: false }))
  const runs = parseRuns(spec)
  if (!runs.length) return marks

  const normalised = words.map(norm)
  let runIndex = 0
  // Longest first, so a phrase beats one of its own words.
  for (const phrase of [...runs].sort((a, b) => b.length - a.length)) {
    for (let i = 0; i + phrase.length <= normalised.length; i += 1) {
      let hit = true
      for (let k = 0; k < phrase.length; k += 1) {
        if (normalised[i + k] !== phrase[k]) { hit = false; break }
      }
      if (!hit) continue
      // Never steal words from a run already claimed.
      let free = true
      for (let k = 0; k < phrase.length; k += 1) if (marks[i + k].run !== -1) { free = false; break }
      if (!free) continue
      for (let k = 0; k < phrase.length; k += 1) {
        marks[i + k].run = runIndex
        marks[i + k].runStart = k === 0
        marks[i + k].runEnd = k === phrase.length - 1
      }
      runIndex += 1
    }
  }
  return marks
}

/** Does this clip highlight anything at all? Used to skip the work entirely. */
export function hasHighlight(spec: string | null | undefined, legacyWord?: string | null): boolean {
  return parseRuns(spec).length > 0 || !!legacyWord?.trim()
}

/**
 * Combine the new run spec with the old single `highlightWord`.
 *
 * Projects saved before this existed keep working: their one word becomes a
 * one-word run, and no document needs migrating.
 */
export function runSpec(spec: string | null | undefined, legacyWord: string | null | undefined): string | null {
  const parts = [spec?.trim(), legacyWord?.trim()].filter(Boolean)
  return parts.length ? parts.join(', ') : null
}

/** Chip padding and corner radius as fractions of the font size. */
export const CHIP = { padX: 0.22, padY: 0.16, radius: 0.26 } as const

/**
 * A chip's grow-in, driven only by the clip's own progress.
 *
 * Returns 0→1 with a short ease so the chip wipes in behind its words rather
 * than popping. Pure in `p`: preview and export produce the same frame.
 */
export function chipReveal(p: number, runIndex: number, runCount: number): number {
  if (runCount <= 0) return 1
  const slot = 1 / Math.max(1, runCount)
  const start = Math.min(0.5, runIndex * slot * 0.5)
  const q = Math.max(0, Math.min(1, (p - start) / 0.22))
  return q * q * (3 - 2 * q)
}
