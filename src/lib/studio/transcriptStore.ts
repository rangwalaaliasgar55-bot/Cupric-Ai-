/**
 * The transcription already paid for, kept, and never silently replaced.
 *
 * Adapted from veedstudio/open-edit's `cli/src/prep/transcript-cache.ts`
 * (Apache-2.0 — see THIRD_PARTY_NOTICES.md). Upstream kept one transcript per
 * source video on disk and put a guard in front of it: a RETIMED transcript must
 * never be overwritten by a fresh alignment of the source, because that silently
 * restores exactly the drift the retime removed.
 *
 * NewBrand's equivalent has the same two jobs, and one difference worth stating:
 * a clip's word timings are kept in SOURCE seconds on purpose, so a trim, a
 * split or a shot cut does not invalidate them. What a fresh transcription can
 * still do is disagree — Whisper is not perfectly deterministic across runs, and
 * a re-run can quietly change the words behind captions that are already on the
 * timeline. So:
 *
 *   - the cache makes the second run free (a long clip is minutes of work);
 *   - the words that come back are compared with the ones the clip already
 *     carries, and a disagreement is reported instead of applied in silence.
 *
 * Storage is `localStorage`, keyed by file + language, with an in-memory
 * fallback so nothing here depends on a browser being present.
 */
import type { TimedWord, Transcription } from './autoCaptions'

export const TRANSCRIPT_STORE_KEY = 'newbrand.transcripts.v1'
/** Above this many files, the oldest entries are dropped (a caption cache, not an archive). */
export const TRANSCRIPT_CACHE_LIMIT = 40

export interface TranscriptFile {
  fileName: string
  localPath?: string | null
  bytes?: number
  durationSec?: number
}

export interface TranscriptEntry {
  words: TimedWord[]
  engine: Transcription['engine']
  timing: Transcription['timing']
  savedAt: number
  /** How many times this entry has been served from the cache. */
  hits: number
}

/**
 * The identity of a transcription: the file (path when there is one, else the
 * name), its size and duration, and the language. Two files with the same name
 * in different folders are different files; the same file re-imported is the
 * same transcription.
 */
export function transcriptKeyOf(file: TranscriptFile, lang: string): string {
  const where = file.localPath?.trim() || file.fileName
  const size = Number.isFinite(file.bytes) ? Math.round(file.bytes as number) : 0
  const seconds = Number.isFinite(file.durationSec) ? Math.round((file.durationSec as number) * 100) : 0
  return `${lang}|${where}|${size}|${seconds}`
}

/**
 * Do two word lists say the same thing? Compared word by word, in order, with a
 * tolerance on the times: two alignments of the same audio never agree to the
 * millisecond, and treating that as a change would warn on every re-run.
 */
export function wordsAgree(a: TimedWord[], b: TimedWord[], toleranceSec = 0.25): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i += 1) {
    if (a[i].word.trim().toLowerCase() !== b[i].word.trim().toLowerCase()) return false
    if (Math.abs(a[i].start - b[i].start) > toleranceSec) return false
  }
  return true
}

/** How many words of the earlier transcript the new one no longer matches. */
export function transcriptDrift(before: TimedWord[], after: TimedWord[]): { changed: boolean; words: number } {
  const byIndex = Math.max(before.length, after.length)
  let mismatched = 0
  for (let i = 0; i < byIndex; i += 1) {
    const a = before[i]
    const b = after[i]
    if (!a || !b || a.word.trim().toLowerCase() !== b.word.trim().toLowerCase()) mismatched += 1
  }
  return { changed: mismatched > 0, words: mismatched }
}

/* ——— storage ——— */

let memory: Record<string, TranscriptEntry> | null = null

function storage(): Storage | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null
  } catch {
    // A browser with storage blocked: the cache becomes per-session, which is
    // still better than transcribing twice in one sitting.
    return null
  }
}

function readAll(): Record<string, TranscriptEntry> {
  const store = storage()
  if (!store) return memory ?? (memory = {})
  try {
    const raw = store.getItem(TRANSCRIPT_STORE_KEY)
    const parsed = raw ? (JSON.parse(raw) as Record<string, TranscriptEntry>) : {}
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

function writeAll(all: Record<string, TranscriptEntry>): void {
  const store = storage()
  if (!store) {
    memory = all
    return
  }
  try {
    store.setItem(TRANSCRIPT_STORE_KEY, JSON.stringify(all))
  } catch {
    // Quota or a blocked store: keep this session's copy in memory instead of
    // losing the transcription that was just paid for.
    memory = all
  }
}

const isEntry = (value: unknown): value is TranscriptEntry =>
  Boolean(value && typeof value === 'object' && Array.isArray((value as TranscriptEntry).words) && (value as TranscriptEntry).words.every((w) => typeof w?.word === 'string'))

/** The cached transcription for a file, or null. Counts the hit when one is found. */
export function readTranscript(key: string): TranscriptEntry | null {
  const all = readAll()
  const entry = all[key]
  if (!isEntry(entry)) return null
  const counted = { ...entry, hits: (entry.hits ?? 0) + 1 }
  all[key] = counted
  writeAll(all)
  return counted
}

/** Whether a transcription is already stored for this file — without counting a hit. */
export function hasTranscript(key: string): boolean {
  return isEntry(readAll()[key])
}

/** Store a transcription, dropping the oldest entries past the limit. */
export function writeTranscript(key: string, entry: Omit<TranscriptEntry, 'savedAt' | 'hits'> & { savedAt?: number }): TranscriptEntry {
  const all = readAll()
  const next: TranscriptEntry = { words: entry.words, engine: entry.engine, timing: entry.timing, savedAt: entry.savedAt ?? Date.now(), hits: 0 }
  all[key] = next
  const keys = Object.keys(all)
  if (keys.length > TRANSCRIPT_CACHE_LIMIT) {
    // Never evict the entry being written: a transcript written after a session
    // of older ones can carry the smallest timestamp (its `savedAt` is when the
    // engine finished, not when the row was inserted) and would delete itself.
    const oldest = keys
      .filter((k) => k !== key)
      .map((k) => ({ k, at: all[k]?.savedAt ?? 0 }))
      .sort((a, b) => a.at - b.at)
      .slice(0, keys.length - TRANSCRIPT_CACHE_LIMIT)
    for (const { k } of oldest) delete all[k]
  }
  writeAll(all)
  return next
}

export function forgetTranscript(key: string): void {
  const all = readAll()
  delete all[key]
  writeAll(all)
}

/** How many transcriptions are kept, and how many times they were reused. */
export function transcriptCacheStats(): { files: number; hits: number } {
  const entries = Object.values(readAll()).filter(isEntry)
  return { files: entries.length, hits: entries.reduce((n, entry) => n + (entry.hits ?? 0), 0) }
}

/** Forget everything (the settings panel's "clear cached data" path). */
export function clearTranscriptCache(): void {
  memory = {}
  const store = storage()
  try {
    store?.removeItem(TRANSCRIPT_STORE_KEY)
  } catch {
    /* nothing to do */
  }
}
