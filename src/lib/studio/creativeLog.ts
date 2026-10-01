/**
 * What has already been tried on a piece of footage, and why the accepted one was accepted.
 *
 * Adapted from veedstudio/open-edit's `cli/src/commands/creative-log.ts` (Apache-2.0 —
 * see THIRD_PARTY_NOTICES.md). Upstream's launch session carried this by hand: every
 * creative brief ended with an "ALREADY TRIED ON THIS CLIP AND REJECTED" list and, once
 * something landed, a sentence naming why. That worked — later rounds genuinely diverged —
 * but it lived in the orchestrator's context, so it was retyped for every agent and erased
 * by the first compaction. Three rounds of "you approached them all the same way" came from
 * exactly that.
 *
 * Three things are kept from upstream, because they are the parts that make it useful:
 *
 *   - the log is keyed by the FOOTAGE, not by the run: round two and round three of a
 *     treatment are different documents on the same clip, and it is the clip that
 *     accumulates history;
 *   - a rejection needs a REASON: a list of rejected looks with no reasons cannot tell a
 *     later pass what to avoid (nobody remembers whether the look was wrong or merely early);
 *   - a corrupt store is preserved before anything is written over it. Reading through a
 *     corrupt log is fine — history is a helper, not a gate. Writing through it is not: an
 *     empty fallback would erase the reject/accept history of every clip at once.
 *
 * Two things are NewBrand's own, and both are additions rather than translations:
 *
 *   - `directionId` on an attempt. Upstream's `what` is free text; NewBrand's design engine
 *     picks one of three named directions, so an attempt that names one carries the id too
 *     and `designAll` can skip it (see `avoidedDirections`). The free text is still kept and
 *     still shown — the id is only a hint for the deterministic engine;
 *   - `creativeBrief` is fed to the model prompt in `aiText.requestTextVariants`, so a
 *     rewrite of the text over footage that has a history is asked not to land on the looks
 *     that were already rejected there.
 *
 * Storage is `localStorage`, the same shape `transcriptStore.ts` uses, with an in-memory
 * fallback so nothing here depends on a browser being present.
 */
import type { StudioClip, StudioDoc } from '../../types/project'
import type { DesignDirectionId } from './design'

export const CREATIVE_LOG_KEY = 'newbrand.creative-log.v1'
/** Above this many footage entries the oldest are dropped (a working log, not an archive). */
export const CREATIVE_LOG_LIMIT = 60

export interface CreativeAttempt {
  /** What was tried, in the user's words. */
  what: string
  /** Why it landed or why it was rejected. Required for both. */
  why: string
  /** Set when `what` names one of the design engine's directions. */
  directionId?: DesignDirectionId
  /** When it was recorded (ms). */
  at: number
}

export interface CreativeLogEntry {
  /** The footage this history belongs to (the key). */
  source: string
  /** Everything that did not land. Accumulates; never replaced. */
  rejected: CreativeAttempt[]
  /** The last thing that did land. A later acceptance replaces it. */
  accepted?: CreativeAttempt
}

export type CreativeLog = Record<string, CreativeLogEntry>

export interface CreativeAttemptInput {
  what: string
  why: string
  directionId?: DesignDirectionId
}

export type CreativeRecord = { ok: boolean; message: string; log: CreativeLog; entry: CreativeLogEntry }

/* ——— identity ——— */

export interface CreativeKeyInput {
  mediaId?: string | null
  localPath?: string | null
  fileName?: string | null
  name?: string | null
  /** Fallback for a clip with no file: two different clips are not one footage. */
  id?: string | null
}

/**
 * The identity of a piece of footage: the file when there is one, else the media handle,
 * else the clip name. Documented the way `transcriptKeyOf` is — a re-imported file is the
 * same footage, and two files with the same name in different folders are two.
 */
export function creativeKeyOf(clip: CreativeKeyInput): string {
  const first = [clip.localPath, clip.fileName, clip.mediaId, clip.name, clip.id]
    .map((value) => String(value ?? '').trim())
    .find((value) => value !== '')
  return first ?? ''
}

/**
 * The footage a clip at `startSec` sits on: the video under its midpoint, else the nearest
 * video that starts before it, else null. Used so a text clip's rewrite is asked to avoid
 * the looks already rejected on the picture underneath it.
 */
export function footageKeyFor(doc: StudioDoc, startSec: number, durationSec = 0): string | null {
  const videos = doc.clips.filter((c: StudioClip) => c.kind === 'video' && !c.hidden)
  if (!videos.length) return null
  const mid = startSec + Math.max(0, durationSec) / 2
  const covering = videos.find((c) => c.startSec <= mid && c.startSec + Math.max(0, c.durationSec) >= mid)
  if (covering) return creativeKeyOf(covering)
  const before = videos
    .filter((c) => c.startSec <= startSec)
    .sort((a, b) => b.startSec - a.startSec)[0]
  return creativeKeyOf(before ?? videos[0])
}

/** The stored history of the footage under a clip, as `footageKeyFor` resolves it. */
export function entryForClip(doc: StudioDoc, clip: { startSec: number; durationSec: number }, log: CreativeLog = readCreativeLog().log): CreativeLogEntry | null {
  const key = footageKeyFor(doc, clip.startSec, clip.durationSec)
  return key ? logEntry(log, key) : null
}

/* ——— reads and writes over a store ——— */

export function emptyEntry(source: string): CreativeLogEntry {
  return { source, rejected: [] }
}

/** The entry for a key — always an object, so callers never branch on undefined. */
export function logEntry(log: CreativeLog, key: string): CreativeLogEntry {
  const found = log[key]
  if (!found || typeof found !== 'object') return emptyEntry(key)
  return {
    source: typeof found.source === 'string' ? found.source : key,
    rejected: Array.isArray(found.rejected) ? found.rejected.filter(isAttempt) : [],
    ...(isAttempt(found.accepted) ? { accepted: found.accepted } : {}),
  }
}

function isAttempt(value: unknown): value is CreativeAttempt {
  const a = value as CreativeAttempt | undefined
  return Boolean(a && typeof a === 'object' && typeof a.what === 'string' && typeof a.why === 'string')
}

const clean = (value: string | undefined) => String(value ?? '').trim()

/**
 * Record a rejected look. The reason is required — that is upstream's rule and this
 * codebase's: `{ ok: false, message }` instead of a silent no-op so the UI can say why.
 * The same `what` reported twice is one attempt; a re-run must not inflate the history.
 */
export function rejectLook(log: CreativeLog, key: string, input: CreativeAttemptInput, at = Date.now()): CreativeRecord {
  const what = clean(input.what)
  const why = clean(input.why)
  const entry = logEntry(log, key)
  if (!what) return { ok: false, message: 'Say what was tried — a rejection with no description records nothing.', log, entry }
  if (!why) return { ok: false, message: 'A reason is required: a list of rejected looks with no reasons cannot tell a later pass what to avoid.', log, entry }
  const already = entry.rejected.some((r) => r.what === what)
  if (!already) entry.rejected.push({ what, why, ...(input.directionId ? { directionId: input.directionId } : {}), at })
  const next: CreativeLog = { ...log, [key]: entry }
  return {
    ok: true,
    message: already
      ? `“${what}” was already on the rejected list — the note is unchanged (${entry.rejected.length} on file).`
      : `Recorded “${what}” as rejected. ${entry.rejected.length} rejection(s) on file for this footage.`,
    log: next,
    entry: logEntry(next, key),
  }
}

/** Record the look that landed. A later acceptance replaces it; the rejections only accumulate. */
export function acceptLook(log: CreativeLog, key: string, input: CreativeAttemptInput, at = Date.now()): CreativeRecord {
  const what = clean(input.what)
  const why = clean(input.why)
  const entry = logEntry(log, key)
  if (!what) return { ok: false, message: 'Say what landed — “accepted” with nothing attached records nothing.', log, entry }
  if (!why) return { ok: false, message: 'A reason is required: the accepted look is the bar for the next round, and “why” is the part that explains the bar.', log, entry }
  const next: CreativeLog = { ...log, [key]: { ...entry, accepted: { what, why, ...(input.directionId ? { directionId: input.directionId } : {}), at } } }
  return { ok: true, message: `Recorded “${what}” as the accepted look for this footage.`, log: next, entry: logEntry(next, key) }
}

/**
 * The history as prompt-ready prose. Empty when nothing has been tried, so a first round
 * carries no ceremony. The wording is upstream's, because it is doing work: the accepted
 * block says "this is the bar, not a thing to copy" (so the next round does not clone it),
 * and the rejected block says the list is not to be landed on again.
 */
export function creativeBrief(entry: CreativeLogEntry | null): string {
  if (!entry) return ''
  const parts: string[] = []
  if (entry.accepted) {
    parts.push(
      `WHAT WAS ACCEPTED ON THIS FOOTAGE, AND WHY — this is the bar, not a thing to copy:\n` +
        `  ${entry.accepted.what}\n  Why it landed: ${entry.accepted.why}`,
    )
  }
  if (entry.rejected.length) {
    parts.push(
      `ALREADY TRIED ON THIS FOOTAGE AND REJECTED — do not land on any of these again:\n` +
        entry.rejected.map((r) => `  · ${r.what}${r.why ? ` — rejected because ${r.why}` : ''}`).join('\n'),
    )
  }
  return parts.join('\n\n')
}

/** The design directions this footage has explicitly rejected. */
export function avoidedDirections(entry: CreativeLogEntry | null): DesignDirectionId[] {
  if (!entry) return []
  const ids = entry.rejected.map((r) => r.directionId).filter((id): id is DesignDirectionId => Boolean(id))
  return [...new Set(ids)]
}

export function creativeLogStats(log: CreativeLog): { footage: number; rejected: number; accepted: number } {
  const entries = Object.keys(log).map((key) => logEntry(log, key))
  return {
    footage: entries.filter((e) => e.rejected.length || e.accepted).length,
    rejected: entries.reduce((n, e) => n + e.rejected.length, 0),
    accepted: entries.filter((e) => e.accepted).length,
  }
}

/* ——— storage ——— */

let memory: CreativeLog | null = null
/** Set when the stored text could not be parsed; the next write preserves it first. */
let corrupt = false

function storage(): Storage | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null
  } catch {
    // A browser with storage blocked: the log becomes per-session, which is still better
    // than the same three rounds converging again in one sitting.
    return null
  }
}

/**
 * Read the log. A store that cannot be parsed reads as empty AND is flagged — reading
 * through it is fine, writing through it would erase every clip's history at once.
 */
export function readCreativeLog(): { log: CreativeLog; corrupt: boolean } {
  const store = storage()
  if (!store) return { log: memory ?? (memory = {}), corrupt: false }
  const raw = store.getItem(CREATIVE_LOG_KEY)
  if (!raw) return { log: {}, corrupt: false }
  try {
    const parsed = JSON.parse(raw) as CreativeLog
    return { log: parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}, corrupt: false }
  } catch {
    corrupt = true
    return { log: {}, corrupt: true }
  }
}

/**
 * Write the log, keeping an unparsable one instead of overwriting it: `<key>.corrupt`,
 * then `.corrupt.1`, `.corrupt.2` … so a second corruption never replaces the first
 * (upstream renames to `.corrupt.json` on disk for the same reason).
 */
export function writeCreativeLog(log: CreativeLog): { preserved?: string } {
  const store = storage()
  let preserved: string | undefined
  if (store && corrupt) {
    if (store.getItem(CREATIVE_LOG_KEY)) {
      let dest = `${CREATIVE_LOG_KEY}.corrupt`
      let n = 1
      while (store.getItem(dest)) dest = `${CREATIVE_LOG_KEY}.corrupt.${n++}`
      try {
        store.setItem(dest, store.getItem(CREATIVE_LOG_KEY) ?? '')
        preserved = dest
      } catch {
        // Quota: the history below is still worth keeping, and the caller is told nothing was preserved.
      }
    }
    corrupt = false
  }
  const trimmed = trimLog(log)
  if (!store) {
    memory = trimmed
    return preserved ? { preserved } : {}
  }
  try {
    store.setItem(CREATIVE_LOG_KEY, JSON.stringify(trimmed))
  } catch {
    memory = trimmed
  }
  return preserved ? { preserved } : {}
}

/** Keep the `CREATIVE_LOG_LIMIT` footage entries with the most recent activity. */
function trimLog(log: CreativeLog): CreativeLog {
  const keys = Object.keys(log)
  if (keys.length <= CREATIVE_LOG_LIMIT) return log
  const ranked = keys
    .map((k) => {
      const entry = logEntry(log, k)
      return { k, at: Math.max(entry.accepted?.at ?? 0, ...entry.rejected.map((r) => r.at), 0) }
    })
    .sort((a, b) => a.at - b.at)
  const next = { ...log }
  for (const { k } of ranked) {
    if (Object.keys(next).length <= CREATIVE_LOG_LIMIT) break
    delete next[k]
  }
  return next
}

/** Reject a look and persist it in one call. */
export function recordRejection(key: string, input: CreativeAttemptInput): CreativeRecord {
  const { log } = readCreativeLog()
  const result = rejectLook(log, key, input)
  if (result.ok) writeCreativeLog(result.log)
  return result
}

/** Accept a look and persist it in one call. */
export function recordAcceptance(key: string, input: CreativeAttemptInput): CreativeRecord {
  const { log } = readCreativeLog()
  const result = acceptLook(log, key, input)
  if (result.ok) writeCreativeLog(result.log)
  return result
}

/** The brief for one footage key, read from storage. Empty when nothing is recorded. */
export function briefForKey(key: string | null): string {
  if (!key) return ''
  return creativeBrief(logEntry(readCreativeLog().log, key))
}

/** The brief for the footage under a clip — what `aiText` attaches to a rewrite prompt. */
export function briefForClip(doc: StudioDoc, clip: { startSec: number; durationSec: number }): string {
  return briefForKey(footageKeyFor(doc, clip.startSec, clip.durationSec))
}

/** Test/UI support: forget the in-session copy without touching storage. */
export function resetCreativeMemory(): void {
  memory = null
  corrupt = false
}
