/**
 * JOB 4 — turn one spoken answer into filled intake fields.
 *
 * The rule that shapes every function here: **nothing is invented**. A field is
 * only filled when the transcript literally contains the answer, and every
 * filled field carries the exact phrase it was heard in so the user can check
 * the machine understood them. Anything not said stays blank and is surfaced
 * as a visible assumption — never as fabricated copy.
 *
 * Pure and dependency-free so `scripts/check-voice-intake.mjs` can run it in
 * Node without a microphone, a browser, or a model.
 */
import { INTAKE_QUESTIONS } from './engine'
import type { ProductionIntake } from './types'

export type IntakeKey = Extract<keyof ProductionIntake, string>

/** A field that was filled, and the words it came from. */
export type IntakeEvidence = {
  key: IntakeKey
  /** Human label for the field, for toasts and the transcript trail. */
  label: string
  /** The value written into the intake. */
  value: string | number
  /** The exact substring of the transcript that produced it. */
  heard: string
}

export type SpeechFill = {
  patch: Partial<ProductionIntake>
  evidence: IntakeEvidence[]
  /** Fields that already had a value, so speech left them alone. */
  keptFilled: IntakeKey[]
  /** True when the transcript produced nothing at all. */
  empty: boolean
}

const LABELS: Record<string, string> = {
  making: 'What', audience: 'Who', platform: 'Where', durationSec: 'Duration', aspect: 'Aspect',
  assets: 'Footage', narration: 'Narration', language: 'Language', brandColors: 'Brand colours',
  brandFonts: 'Brand fonts', cta: 'Call to action', referenceStyle: 'Reference style',
  mustKeep: 'Must keep', avoid: 'Avoid',
}

export function intakeLabel(key: IntakeKey): string {
  return LABELS[key] || String(key)
}

function isBlank(v: unknown): boolean {
  if (v === null || v === undefined) return true
  if (typeof v === 'number') return !Number.isFinite(v)
  return String(v).trim() === ''
}

/* ——— spoken numbers ——————————————————————————————————————————— */

const ONES: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9,
  ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16,
  seventeen: 17, eighteen: 18, nineteen: 19,
}
const TENS: Record<string, number> = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 }

/** "forty five" → 45, "thirty" → 30, "12" → 12. Returns null when it is not a number. */
export function spokenNumber(raw: string): number | null {
  const text = raw.toLowerCase().trim()
  if (/^\d+$/.test(text)) return Number(text)
  const words = text.split(/[\s-]+/).filter(Boolean)
  let total = 0
  let matched = false
  for (let i = 0; i < words.length; i += 1) {
    const w = words[i]
    if (TENS[w] !== undefined) {
      const next = words[i + 1]
      if (next && ONES[next] !== undefined && ONES[next] < 10) { total += TENS[w] + ONES[next]; i += 1 } else total += TENS[w]
      matched = true
    } else if (ONES[w] !== undefined) { total += ONES[w]; matched = true } else if (/^\d+$/.test(w)) { total += Number(w); matched = true }
  }
  return matched ? total : null
}

/* ——— field extractors ————————————————————————————————————————— */

type Hit = { value: string | number; heard: string }

const PLATFORMS: Array<[RegExp, string]> = [
  [/\binstagram(?:\s+reels?)?\b/i, 'Instagram Reels'],
  [/\breels?\b/i, 'Instagram Reels'],
  [/\byou\s?tube\s+shorts?\b/i, 'YouTube Shorts'],
  [/\byou\s?tube\b/i, 'YouTube'],
  [/\btik\s?tok\b/i, 'TikTok'],
  [/\blinked\s?in\b/i, 'LinkedIn'],
  [/\bfacebook\b/i, 'Facebook'],
  [/\b(?:twitter|on x)\b/i, 'X'],
  [/\bwhats\s?app\b/i, 'WhatsApp'],
  [/\bour website\b|\blanding page\b/i, 'Website'],
]

function findPlatform(t: string): Hit | null {
  const found: string[] = []
  let heard = ''
  for (const [re, name] of PLATFORMS) {
    const m = t.match(re)
    if (m && !found.includes(name)) { found.push(name); if (!heard) heard = m[0] }
  }
  return found.length ? { value: found.join(', '), heard } : null
}

function findDuration(t: string): Hit | null {
  // "30 seconds", "thirty second", "a minute", "one and a half minutes"
  const min = t.match(/\b(?:(\d+(?:\.\d+)?)|(\w+(?:[\s-]\w+)?))\s*(?:minute|minutes|min|mins)\b/i)
  if (min) {
    const n = min[1] ? Number(min[1]) : spokenNumber(min[2] || '')
    if (n !== null && n > 0 && n <= 30) return { value: Math.round(n * 60), heard: min[0].trim() }
  }
  if (/\b(?:a|one)\s+minute\b/i.test(t)) { const m = t.match(/\b(?:a|one)\s+minute\b/i)!; return { value: 60, heard: m[0] } }
  const sec = t.match(/\b(\d+|\w+(?:[\s-]\w+)?)\s*(?:seconds?|secs?|s)\b/i)
  if (sec) {
    const n = spokenNumber(sec[1])
    if (n !== null && n > 0 && n <= 1800) return { value: n, heard: sec[0].trim() }
  }
  return null
}

function findAspect(t: string): Hit | null {
  const explicit = t.match(/\b(9\s*[:x by]+\s*16|16\s*[:x by]+\s*9|1\s*[:x by]+\s*1|4\s*[:x by]+\s*5)\b/i)
  if (explicit) {
    const digits = explicit[0].replace(/[^\d]/g, '')
    const map: Record<string, string> = { '916': '9:16', '169': '16:9', '11': '1:1', '45': '4:5' }
    const v = map[digits]
    if (v) return { value: v, heard: explicit[0].trim() }
  }
  const vertical = t.match(/\b(vertical|portrait|full\s?screen phone)\b/i)
  if (vertical) return { value: '9:16', heard: vertical[0] }
  const landscape = t.match(/\b(landscape|horizontal|wide\s?screen)\b/i)
  if (landscape) return { value: '16:9', heard: landscape[0] }
  const square = t.match(/\bsquare\b/i)
  if (square) return { value: '1:1', heard: square[0] }
  return null
}

function findAudience(t: string): Hit | null {
  const m = t.match(/\b(?:it'?s |this is |aimed )?for\s+([^.,;!?]{3,90})/i)
  if (!m) return null
  const value = m[1].trim().replace(/\s+/g, ' ')
  // "for 30 seconds" / "for Instagram" is a duration or platform, not an audience.
  if (findDuration(value) || findPlatform(value)) return null
  return { value, heard: m[0].trim() }
}

function findAssets(t: string): Hit | null {
  const files = t.match(/\b[\w][\w-]*\.(?:mp4|mov|png|jpe?g|webm|gif|wav|mp3|m4a|avi|heic)\b/gi)
  if (files && files.length) return { value: files.join('\n'), heard: files.join(', ') }
  const have = t.match(/\bi (?:have|got|shot|already have)\s+([^.;!?]{3,140})/i)
  if (have) return { value: have[1].trim(), heard: have[0].trim() }
  if (/\bno footage\b|\bnothing (?:shot|yet)\b|\bno assets\b/i.test(t)) {
    const m = t.match(/\bno footage\b|\bnothing (?:shot|yet)\b|\bno assets\b/i)!
    return { value: 'none — use stock', heard: m[0] }
  }
  return null
}

function findNarration(t: string): Hit | null {
  const both = t.match(/\bboth (?:voice\s?over|voiceover) and captions?\b|\bvoice\s?over and captions?\b|\bcaptions? and voice\s?over\b/i)
  if (both) return { value: 'both', heard: both[0] }
  const none = t.match(/\bno (?:voice\s?over|narration|captions?)\b|\bneither\b/i)
  if (none) return { value: 'neither', heard: none[0] }
  const vo = t.match(/\bvoice\s?over\b|\bnarration\b|\bnarrated\b/i)
  if (vo) return { value: 'voiceover', heard: vo[0] }
  const cap = t.match(/\bcaptions?\b|\bsubtitles?\b|\bon\s?screen text\b/i)
  if (cap) return { value: 'captions', heard: cap[0] }
  return null
}

function findLanguage(t: string): Hit | null {
  const hin = /\bhindi\b/i.test(t)
  const eng = /\benglish\b/i.test(t)
  if (hin && eng) { const m = t.match(/\bhindi\b|\benglish\b/i)!; return { value: 'both', heard: m[0] } }
  if (hin) return { value: 'hi', heard: t.match(/\bhindi\b/i)![0] }
  if (eng) return { value: 'en', heard: t.match(/\benglish\b/i)![0] }
  return null
}

function findCta(t: string): Hit | null {
  const m = t.match(/\b(?:call to action(?: is| should be)?|end(?:ing)? with|cta(?: is)?|sign ?off with)\s+([^.;!?]{2,90})/i)
  if (m) return { value: m[1].trim(), heard: m[0].trim() }
  return null
}

/**
 * The subject of the video. Runs last and gives up any clause another field
 * already claimed, so "What" reads as a subject and not as a replay of the
 * whole sentence.
 */
function findMaking(t: string, claimed: string[] = []): Hit | null {
  const m = t.match(/\b(?:i(?:'m| am)?\s+(?:making|building|creating|shooting|producing)|make me|build me|create)\s+([^.;!?]{4,160})/i)
  const raw = m ? m[1].trim() : (t.split(/[.;!?]/)[0]?.trim() || '')
  if (!raw || raw.split(/\s+/).length < 4) return null
  const clauses = raw.split(',').map((c) => c.trim()).filter(Boolean)
  const kept: string[] = []
  for (const clause of clauses) {
    const low = clause.toLowerCase()
    // A clause that is *mostly* another field's evidence belongs to that field.
    const owned = claimed.some((c) => { const cl = c.toLowerCase(); return low.includes(cl) && cl.length >= low.length * 0.7 })
    if (owned) break
    kept.push(clause)
  }
  const value = (kept.length ? kept.join(', ') : clauses[0] || raw).trim()
  if (!value || value.split(/\s+/).length < 3) return null
  return { value, heard: m ? m[0].trim() : value }
}

const EXTRACTORS: Array<[IntakeKey, (t: string, claimed: string[]) => Hit | null]> = [
  // Order matters: narrow, unambiguous fields claim their words before the
  // catch-all "what are you making" sentence does.
  ['durationSec', findDuration],
  ['aspect', findAspect],
  ['platform', findPlatform],
  ['narration', findNarration],
  ['language', findLanguage],
  ['assets', findAssets],
  ['cta', findCta],
  ['audience', findAudience],
  ['making', findMaking],
]

/**
 * Fill blank intake fields from one spoken answer.
 *
 * Never overwrites a field that already has a value — the user's typed words
 * outrank a guess from a transcript. Returns the evidence for every fill so
 * the UI can cite the phrase it heard next to each field it changed.
 */
export function fillIntakeFromSpeech(transcript: string, intake: ProductionIntake, opts: { only?: IntakeKey } = {}): SpeechFill {
  const t = String(transcript || '').trim()
  const patch: Partial<ProductionIntake> = {}
  const evidence: IntakeEvidence[] = []
  const keptFilled: IntakeKey[] = []
  if (!t) return { patch, evidence, keptFilled, empty: true }

  const claimed: string[] = []
  for (const [key, extract] of EXTRACTORS) {
    if (opts.only && key !== opts.only) continue
    if (!isBlank(intake[key])) { keptFilled.push(key); continue }
    const hit = extract(t, claimed)
    if (!hit) continue
    claimed.push(hit.heard)
    // `only` means the user was answering this exact question: take the whole
    // utterance if no pattern matched a narrower span.
    ;(patch as Record<string, unknown>)[key] = hit.value
    evidence.push({ key, label: intakeLabel(key), value: hit.value, heard: hit.heard })
  }

  // Answering a direct question: if the extractor found nothing, the plain
  // words ARE the answer. Still never invented — it is verbatim what was said.
  if (opts.only && !evidence.length && isBlank(intake[opts.only])) {
    const key = opts.only
    const numeric = key === 'durationSec'
    const value = numeric ? spokenNumber(t) : t
    if (value !== null && value !== '') {
      ;(patch as Record<string, unknown>)[key] = value
      evidence.push({ key, label: intakeLabel(key), value, heard: t })
    }
  }

  return { patch, evidence, keptFilled, empty: evidence.length === 0 }
}

/* ——— the interviewer ————————————————————————————————————————— */

export type InterviewQuestion = { key: IntakeKey; question: string; why: string; placeholder: string; required: boolean }

/**
 * The single next question to ask — required ones first, in intake order, and
 * only ever one at a time. Returns null when nothing required is missing.
 */
export function nextInterviewQuestion(intake: ProductionIntake, asked: IntakeKey[] = []): InterviewQuestion | null {
  const blank = INTAKE_QUESTIONS.filter((q) => isBlank(intake[q.key]))
  const fresh = blank.filter((q) => !asked.includes(q.key))
  const pool = fresh.length ? fresh : []
  const required = pool.find((q) => q.required)
  const pick = required || pool[0]
  if (!pick) return null
  return { key: pick.key, question: pick.question, why: pick.why, placeholder: pick.placeholder, required: pick.required }
}

/** How many required answers are still missing. */
export function requiredRemaining(intake: ProductionIntake): number {
  return INTAKE_QUESTIONS.filter((q) => q.required && isBlank(intake[q.key])).length
}

export type Assumption = { key: IntakeKey; label: string; text: string }

/**
 * Blanks become *visible assumptions*, phrased as the choice Cupric will make
 * and flagged as an assumption — never presented as something the user said.
 */
const ASSUMPTIONS: Partial<Record<IntakeKey, string>> = {
  durationSec: 'no duration given — assuming a 30-second cut',
  aspect: 'no aspect given — assuming 9:16 vertical',
  narration: 'no narration choice — assuming captions only, no voiceover',
  language: 'no language given — assuming English',
  cta: 'no call to action — the closing card stays an empty placeholder for you to fill',
  brandColors: 'no brand colours — using the default palette',
  brandFonts: 'no brand fonts — using the default type',
  referenceStyle: 'no reference style — assuming a clean, modern cut',
  assets: 'no footage listed — shots will be sourced from stock and flagged',
  making: 'no subject given — Cupric cannot guess this one; it stays blank',
  audience: 'no audience given — assuming a general viewer',
  platform: 'no platform given — assuming social, with safe zones on',
}

export function visibleAssumptions(intake: ProductionIntake): Assumption[] {
  return INTAKE_QUESTIONS
    .filter((q) => isBlank(intake[q.key]) && ASSUMPTIONS[q.key])
    .map((q) => ({ key: q.key, label: intakeLabel(q.key), text: ASSUMPTIONS[q.key] as string }))
}

/** Spoken confirmation of what was just filled — read back only what was heard. */
export function speakBackFill(fill: SpeechFill): string {
  if (!fill.evidence.length) return 'I did not catch a field in that. Try naming one thing, like the duration or the platform.'
  const parts = fill.evidence.map((e) => `${e.label}: ${e.value}`)
  return `Filled ${parts.join(', ')}.`
}
