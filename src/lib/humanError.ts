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
/** "Please retry in 40.515s" / "retryDelay":"40s" → 41 */
function retrySeconds(raw: string): number | null {
  const m = raw.match(/retry in\s+([\d.]+)\s*s/i) ?? raw.match(/retryDelay\W+([\d.]+)s/i)
  return m ? Math.ceil(Number(m[1])) : null
}

function modelName(raw: string): string | null {
  return raw.match(/model[\s:"]+([a-z0-9][\w.:/-]*(?:flash|pro|lite|gpt|claude|qwen|llama|gemma|deepseek|mistral)[\w.:/-]*)/i)?.[1]
    ?? raw.match(/models\/([\w.-]+):generateContent/i)?.[1]
    ?? null
}

function localServer(raw: string): string | null {
  const m = raw.match(/https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]):(\d+)/i)
  if (!m) return null
  const port = m[1]
  const name = port === '11434' ? 'Ollama' : port === '1234' ? 'LM Studio' : port === '4096' ? 'OpenCode' : port === '8080' ? 'llama.cpp' : port === '1337' ? 'Atomic Chat' : 'local model'
  return `${name} (port ${port})`
}

const RULES: Rule[] = [
  {
    match: /No AI provider is configured|No live AI provider is configured|NO_PROVIDER/i,
    say: () =>
      'No AI model is set up yet, so Cupric used its built-in motion engine. For live AI, open Settings → AI and add an OpenAI, Anthropic or Gemini key, or start a local model server (Ollama, LM Studio) — Cupric detects those on its own.',
  },
  {
    match: /ran out of time before any provider answered|Studio auto edit timed out|timed out after/i,
    say: () => 'The AI took too long to answer, so Cupric used its built-in motion engine instead. Try again later for a live plan.',
  },
  {
    // First, because quota errors quote URLs, JSON and the word "fetching",
    // which used to be misread as "no network" or "malformed reply".
    match: /\b429\b|too many requests|quota|rate.?limit|resource_exhausted/i,
    say: (raw) => {
      const model = modelName(raw)
      const wait = retrySeconds(raw)
      const daily = /PerDay|per day|daily/i.test(raw)
      const limit = raw.match(/limit:\s*(\d+)/i)?.[1]
      const who = model ? `the free quota for ${model}` : 'the model provider\'s quota'
      const when = daily
        ? `It resets daily${limit ? ` (${limit} requests/day on the free tier)` : ''}`
        : wait ? `It frees up in about ${wait}s` : 'It frees up shortly'
      return `Used up ${who}. ${when}. Add a free local model (Ollama / LM Studio) or an OpenCode key in Settings to keep going`
    },
  },
  {
    match: /empty file|produced an empty/i,
    say: () => 'The recorder finished but produced nothing. Try a shorter export, or switch to WebM.',
  },
  {
    match: /width not divisible by 2|height not divisible by 2/i,
    say: () => 'The frame size was an odd number of pixels, which H.264 cannot encode. Update Cupric — renders are now snapped to even sizes automatically.',
  },
  {
    match: /MediaRecorder|mimeType|codec not supported|isTypeSupported/i,
    say: () => 'This browser cannot record that format. The desktop app can — or export WebM here and convert after.',
  },
  {
    match: /NotAllowedError|permission denied/i,
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
    match: /\babort(ed)?\b|cancell?ed/i,
    say: () => 'Cancelled. Nothing was saved.',
  },
  {
    match: /timeout|timed out|ETIMEDOUT|deadline/i,
    say: () => 'That took too long and Cupric stopped waiting. It is usually worth one more try.',
  },
  {
    // A local model server that is simply not running is not "no internet".
    match: /(ECONNREFUSED|fetch failed|Failed to fetch|connect)[\s\S]*(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])|(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])[\s\S]*(ECONNREFUSED|fetch failed|Failed to fetch|not running)/i,
    say: (raw) => `The ${localServer(raw) ?? 'local model'} server is not running, so nothing answered. Start it, or pick a different model in the Ask panel settings`,
  },
  {
    match: /fetch failed|Failed to fetch|ENOTFOUND|ECONNREFUSED|ECONNRESET|network|offline|EAI_AGAIN/i,
    say: () => 'Cupric could not reach the AI provider. Check the connection and the model base URL in Settings — everything already downloaded still works offline.',
  },
  {
    match: /api key|unauthori[sz]ed|\b401\b|\b403\b|permission_denied/i,
    say: () => 'The model rejected the key. Add a working API key in Settings and try again.',
  },
  {
    match: /safety|blocked by|content policy/i,
    say: () => 'The model refused this one on safety grounds. Rephrasing the brief usually clears it.',
  },
  {
    match: /Unexpected token|JSON\.parse|in JSON at position|Unexpected end of JSON|is not valid JSON|malformed/i,
    say: () => 'The model replied, but not in the format Cupric needs, so the reply was discarded instead of guessed at. Cupric retries with a stricter prompt automatically — try once more if this persists.',
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
    // "…needs the desktop app", "…runs on the desktop app" — the feature only
    // works in the packaged app, and the message already says so.
    //
    // This used to also match the bare word `electron`, which is in the path of
    // every main-process stack frame (`/app/electron/main.cjs`), so a stack trace
    // satisfied this rule and was returned verbatim to the user. Found by
    // src/tests/human-error.test.ts.
    match: /desktop app/i,
    say: (raw) => raw,
  },
]

/** Anything that is obviously machine output rather than a sentence. */
const LOOKS_TECHNICAL = /^\w*Error:|\n\s+at\s|\bat\s+\S+\s*\([^)]*:\d+:\d+\)|\bundefined is not\b|is not a function/

/**
 * A real stack frame: `
    at fn (file:12:3)` or `at fn (file:12:3)`.
 *
 * Checked before the keyword rules, not after them. A rule matches on a word
 * that can appear in a *path* — `electron`, `ffmpeg` — and a rule that echoes
 * the raw text then hands the whole stack to the user. Neither the promise in
 * this file's header ("never print a stack") nor LOOKS_TECHNICAL can hold if a
 * keyword gets there first.
 */
const HAS_STACK_FRAMES = /\n\s+at\s|\bat\s+\S+\s*\([^)]*:\d+:\d+\)/

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
  // Electron wraps every main-process failure in
  // "Error invoking remote method 'x': Error: …" — noise to a person.
  const trimmed = raw
    .replace(/^Error invoking remote method '[^']*':\s*/i, '')
    .replace(/^(?:\w*Error:\s*)+/, '')
    .replace(/^\[GoogleGenerativeAI Error\]:\s*/i, '')
    .trim()

  // Machine output first: no rule may resurrect a stack trace.
  if (HAS_STACK_FRAMES.test(raw)) {
    return `${context} hit an internal error. It has been written to the log — trying again is worth a go.`
  }

  for (const rule of RULES) {
    // Rule text is written by us, so it is never truncated mid-sentence.
    if (rule.match.test(raw)) return sentence(rule.say(raw), context, false)
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
function sentence(text: string, context: string, clip = true): string {
  const trimmed = text.trim()
  if (!trimmed) return `${context} failed.`
  const clipped = clip && trimmed.length > MAX_LENGTH ? `${trimmed.slice(0, MAX_LENGTH - 1).trimEnd()}…` : trimmed
  const capitalised = clipped.charAt(0).toUpperCase() + clipped.slice(1)
  return /[.!?…]$/.test(capitalised) ? capitalised : `${capitalised}.`
}


/**
 * Collapse a list of messages to one line per distinct problem, most recent
 * wording kept, with a repeat count. Used wherever warnings are listed.
 */
export function dedupeMessages(list: readonly string[] | null | undefined): Array<{ text: string; count: number }> {
  const out = new Map<string, { text: string; count: number }>()
  for (const raw of list ?? []) {
    const prior = Number(String(raw).match(/\(×(\d+)\)$/)?.[1] ?? 1)
    const cleaned = String(raw).replace(/\s*\(×\d+\)$/, '').trim()
    // Rewrite only what a rule recognises (quota, offline, odd frame size…);
    // an informational note is already written for a person.
    const text = RULES.some((rule) => rule.match.test(cleaned))
      ? humanError(cleaned, 'Cupric')
      : cleaned.length > 320 ? `${cleaned.slice(0, 317).trimEnd()}…` : cleaned
    const key = text.toLowerCase().replace(/\d{2,}(?:\.\d+)?|\d+\.\d+/g, '#').slice(0, 180)
    const hit = out.get(key)
    if (hit) hit.count += prior
    else out.set(key, { text, count: prior })
  }
  return [...out.values()]
}
