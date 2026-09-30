#!/usr/bin/env python3
"""Read a stated duration out of a Hindi (Devanagari) brief as well as English.

Found by scripts/lib/pipeline-evidence.mjs: the brief
"स्मार्ट बचत ऐप के लिए 20 सेकंड का विज्ञापन" asked for 20 seconds and silently got
the 30-second default, because the duration pattern only knew the English word.
The pipeline otherwise supports Hindi (language detection, Hindi TTS voices), so
dropping the one number the brief is explicit about is a defect, not a limit.
"""
import io

p = 'src/lib/automation/plan.ts'
s = io.open(p, encoding='utf-8').read()

old = """export function intakeFromBrief(input: AutonomyBrief, brand?: { colors?: string[]; fonts?: string[] }, mediaNames?: string[]): ProductionIntake {
  const text = input.brief.replace(/\\s+/g, ' ').trim()
  const lower = text.toLowerCase()
  const duration = input.durationSec
    ?? Number(/\\b(\\d{1,3})\\s*(?:-|\\s)?\\s*(?:second|sec|s\\b)/i.exec(lower)?.[1])
    ?? 30"""
new = """/**
 * The number in a brief, in either script.
 *
 * English briefs write "20 seconds"; Hindi briefs write "20 सेकंड" and often in
 * Devanagari digits ("२० सेकंड"). Both are a stated duration and both are read.
 * Devanagari digits are folded to ASCII first, so the same pattern matches.
 */
const DEVANAGARI_DIGITS = /[\\u0966-\\u096F]/g
const SECOND_WORDS = '(?:second|sec|s\\\\b|सेकंड|सेकेंड|सेकण्ड|सकंड)'

function statedSeconds(text: string): number | null {
  const ascii = text.replace(DEVANAGARI_DIGITS, (digit) => String(digit.charCodeAt(0) - 0x0966))
  // "20 सेकंड", "20-second", "20s", and the Hindi word order "सेकंड 20".
  const after = new RegExp(`(?<!\\\\d)(\\\\d{1,3})\\\\s*(?:-|\\\\s)?\\\\s*${SECOND_WORDS}`, 'i').exec(ascii)
  if (after) return Number(after[1])
  const before = new RegExp(`${SECOND_WORDS}\\\\s*(\\\\d{1,3})`, 'i').exec(ascii)
  return before ? Number(before[1]) : null
}

/** The shortest structure the engine can build; below this a brief is raised to it. */
export const MIN_BRIEF_SECONDS = 8

/**
 * The duration the brief asked for, and whether the floor moved it.
 *
 * `requestedSec` is kept so nothing is silently changed: a 6-second request that
 * becomes an 8-second plan is reported as exactly that.
 */
export function requestedDuration(input: AutonomyBrief): { seconds: number | null; raisedFrom: number | null } {
  const text = String(input.brief ?? '').replace(/\\s+/g, ' ').trim()
  const explicit = Number(input.durationSec)
  const stated = Number.isFinite(explicit) && explicit > 0 ? explicit : statedSeconds(text)
  if (stated === null) return { seconds: null, raisedFrom: null }
  const clamped = Math.max(MIN_BRIEF_SECONDS, Math.min(180, Math.round(stated)))
  return { seconds: clamped, raisedFrom: clamped !== Math.round(stated) ? Math.round(stated) : null }
}

export function intakeFromBrief(input: AutonomyBrief, brand?: { colors?: string[]; fonts?: string[] }, mediaNames?: string[]): ProductionIntake {
  const text = input.brief.replace(/\\s+/g, ' ').trim()
  const lower = text.toLowerCase()
  const duration = requestedDuration(input).seconds ?? 30"""
assert s.count(old) == 1, 'intake anchor'
s = s.replace(old, new, 1)

io.open(p, 'w', encoding='utf-8').write(s)
print('Hindi duration parsing added')
