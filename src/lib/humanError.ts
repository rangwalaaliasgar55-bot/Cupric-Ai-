/**
 * Errors, said out loud like a person would say them.
 *
 * `gemini.ts` already answers in a human voice when a model call fails; this
 * extends the same courtesy to everything else — render failures, imports,
 * Arena timeouts, disk problems. A raw exception string is a dead end: it
 * names an internal thing the reader has never heard of and suggests nothing
 * to do about it.
 *
 * The rules this follows:
 *  - say what did not happen, in the user's terms;
 *  - say what to try, if there is anything to try;
 *  - never print a stack, a channel name, or an error code on its own.
 */

type Rule = { match: RegExp; say: (raw: string) => string }

/** Ordered — the first match wins, so put the specific ones first. */
const RULES: Rule[] = [
  {
    match: /empty file|produced an empty/i,
    say: () => 'The recorder finished but produced nothing. Try a shorter export, or switch to WebM.',
  },
  {
    match: /MediaRecorder|not supported|mimeType|codec/i,
    say: () => 'This browser cannot record that format. The desktop app can — or export WebM here and convert after.',
  },
  {
    match: /NotAllowedError|permission denied|denied/i,
    say: () => 'Permission was refused. Check the microphone, camera or folder permission this needs and try again.',
  },
  {
    match: /NotFoundError|ENOENT|no such file/i,
    say: () => 'That file is not where the project expects it. Relink it, or re-import it.',
  },
  {
    match: /EACCES|EPERM|read-only/i,
    say: () => 'Cupric is not allowed to write there. Pick a different output folder.',
  },
  {
    match: /ENOSPC|no space/i,
    say: () => 'The disk is full, so nothing could be written. Free some space and try again.',
  },
  {
    match: /abort|cancell?ed/i,
    say: () => 'Cancelled. Nothing was saved.',
  },
  {
    match: /timeout|timed out|ETIMEDOUT|deadline/i,
    say: () => 'That took too long and Cupric stopped waiting. It is usually worth one more try.',
  },
  {
    match: /fetch failed|ENOTFOUND|ECONNREFUSED|network|offline|EAI_AGAIN/i,
    say: () => 'Cupric could not reach the network. Check the connection — everything already downloaded still works offline.',
  },
  {
    match: /api key|unauthori[sz]ed|401|403/i,
    say: () => 'The model rejected the key. Add a working API key in Settings and try again.',
  },
  {
    match: /429|rate limit|quota|resource_exhausted/i,
    say: () => 'The model is rate-limiting us. Wait a minute, or switch provider in Settings.',
  },
  {
    match: /safety|blocked|content policy/i,
    say: () => 'The model refused this one on safety grounds. Rephrasing the brief usually clears it.',
  },
  {
    match: /JSON|unexpected token|parse/i,
    say: () => 'The reply came back malformed, so Cupric threw it away rather than guess. Try again.',
  },
  {
    match: /__seek/i,
    say: () => 'That HTML does not expose window.__seek(t), so Cupric cannot step it frame by frame. It has to be a deterministic single file.',
  },
  {
    match: /ffmpeg|ffprobe/i,
    say: () => 'The video tool could not process that file. It may be an unusual codec — try re-exporting the source as H.264.',
  },
  {
    match: /desktop app|electron/i,
    say: (raw) => raw,
  },
]

/** Anything that is obviously machine output rather than a sentence. */
const LOOKS_TECHNICAL = /^\w*Error:|\n\s+at\s|\bat\s+\S+\s*\([^)]*:\d+:\d+\)|\bundefined is not\b|is not a function/

/** The longest an error is allowed to be before it stops being readable. */
const MAX_LENGTH = 180

/**
 * Turn anything thrown into a sentence worth showing.
 *
 * `context` is what the user was doing ("Export", "Import"), and is used as
 * the fallback subject when nothing else is known about the failure.
 */
export function humanError(error: unknown, context = 'That'): string {
  const raw = error instanceof Error ? error.message : typeof error === 'string' ? error : ''
  const trimmed = raw.trim()

  for (const rule of RULES) {
    if (rule.match.test(trimmed)) return sentence(rule.say(trimmed), context)
  }

  // A stack trace helps whoever wrote the code and nobody else. It is in the
  // log either way; the person gets a sentence.
  if (LOOKS_TECHNICAL.test(trimmed)) {
    return `${context} hit an internal error. It has been written to the log — trying again is worth a go.`
  }

  // An empty or unreadable error is the worst case: say so plainly rather than
  // showing "undefined" or "[object Object]".
  if (!trimmed || /^\[object|undefined$|^null$/.test(trimmed)) {
    return `${context} failed, and Cupric did not get a reason why. Trying once more is worth it; if it keeps happening, check Settings.`
  }

  // A message written for a person already: keep it, just make sure it reads
  // as a sentence and is not an essay.
  return sentence(trimmed, context)
}

/** Trim to a readable length, capitalise, and finish the sentence. */
function sentence(text: string, context: string): string {
  const trimmed = text.trim()
  if (!trimmed) return `${context} failed.`
  const clipped = trimmed.length > MAX_LENGTH ? `${trimmed.slice(0, MAX_LENGTH - 1).trimEnd()}…` : trimmed
  const capitalised = clipped.charAt(0).toUpperCase() + clipped.slice(1)
  return /[.!?…]$/.test(capitalised) ? capitalised : `${capitalised}.`
}
