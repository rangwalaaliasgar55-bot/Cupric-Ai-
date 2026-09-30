/**
 * Reading the length out of a brief.
 *
 * This is small and it matters: the number the user types is the one thing in a
 * brief that is unambiguous, and getting it wrong produces a plan for the wrong
 * length with no error anywhere. `scripts/lib/pipeline-evidence.mjs` found the
 * bug these tests pin — a Hindi brief ("स्मार्ट बचत ऐप के लिए 20 सेकंड का विज्ञापन")
 * asked for 20 seconds and silently got the 30-second default, because the
 * pattern only knew the English word "second".
 */
import { describe, expect, it } from 'vitest'
import { MAX_BRIEF_SECONDS, MIN_BRIEF_SECONDS, intakeFromBrief, requestedDuration } from '../lib/automation/plan'

const brief = (text: string, extra: Partial<{ aspect: '16:9' | '9:16' | '1:1'; fps: 30 | 60; durationSec: number }> = {}) => ({
  brief: text,
  aspect: '16:9' as const,
  fps: 30 as const,
  quality: 'draft' as const,
  ...extra,
})

describe('requestedDuration', () => {
  it('reads the English forms a person actually writes', () => {
    expect(requestedDuration(brief('a 20-second ad'))?.seconds).toBe(20)
    expect(requestedDuration(brief('a 20 second explainer'))?.seconds).toBe(20)
    expect(requestedDuration(brief('a 20s teaser'))?.seconds).toBe(20)
    expect(requestedDuration(brief('exactly 45 seconds'))?.seconds).toBe(45)
  })

  it('reads Hindi, in words and in Devanagari digits', () => {
    // The regression: this used to return null and take the 30-second default.
    expect(requestedDuration(brief('स्मार्ट बचत ऐप के लिए 20 सेकंड का विज्ञापन'))?.seconds).toBe(20)
    expect(requestedDuration(brief('२० सेकंड का विज्ञापन'))?.seconds).toBe(20)
    expect(requestedDuration(brief('यह १५ सेकेंड का क्लिप है'))?.seconds).toBe(15)
  })

  it('reads the Hindi word order with the number after the unit', () => {
    expect(requestedDuration(brief('सेकंड 30 का विज्ञापन'))?.seconds).toBe(30)
  })

  it('a number supplied by the form wins over one in the text', () => {
    expect(requestedDuration(brief('a 20-second ad', { durationSec: 12 }))?.seconds).toBe(12)
  })

  it('says nothing when the brief states no length', () => {
    expect(requestedDuration(brief('make something good'))).toEqual({ seconds: null, adjustedFrom: null })
    expect(requestedDuration(brief(''))).toEqual({ seconds: null, adjustedFrom: null })
  })

  it('never changes a length silently — raising is reported', () => {
    const short = requestedDuration(brief('a 6-second sting'))
    expect(short.seconds).toBe(MIN_BRIEF_SECONDS)
    expect(short.adjustedFrom).toBe(6)
    expect(requestedDuration(brief('a 12-second promo')).adjustedFrom).toBeNull()
  })

  it('never changes a length silently — capping is reported', () => {
    const epic = requestedDuration(brief('a 300-second epic'))
    expect(epic.seconds).toBe(MAX_BRIEF_SECONDS)
    // This was the half-honest case: the field used to be null when a length was
    // capped rather than raised, so a 5-minute request became 3 minutes with
    // nothing to show for it.
    expect(epic.adjustedFrom).toBe(300)
  })

  it('does not mistake other numbers for a duration', () => {
    // "a 3-part series" is not three seconds.
    expect(requestedDuration(brief('a 3-part series about bees'))?.seconds).toBeNull()
    expect(requestedDuration(brief('a video with 4 scenes'))?.seconds).toBeNull()
    expect(requestedDuration(brief('20 tips for editing'))?.seconds).toBeNull()
  })
})

describe('intakeFromBrief and the duration', () => {
  it('carries the stated length into the intake', () => {
    expect(intakeFromBrief(brief('an 18-second launch film')).durationSec).toBe(18)
    expect(intakeFromBrief(brief('18 सेकंड की लॉन्च फिल्म')).durationSec).toBe(18)
  })

  it('uses the documented default only when the brief is silent', () => {
    expect(intakeFromBrief(brief('make something good')).durationSec).toBe(30)
  })

  it('never produces a duration the engine cannot build', () => {
    for (const text of ['a 1-second thing', 'a 500-second thing', '']) {
      const value = intakeFromBrief(brief(text)).durationSec
      expect(value).toBeGreaterThanOrEqual(MIN_BRIEF_SECONDS)
      expect(value).toBeLessThanOrEqual(180)
    }
  })
})
