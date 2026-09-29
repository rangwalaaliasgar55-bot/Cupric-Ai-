/**
 * `humanError` — the last line between a failure and a person.
 *
 * Every user-facing error in this app goes through this function: a caught
 * exception, an IPC rejection (which Electron wraps in "Error invoking remote
 * method 'x': Error: …"), a provider's raw JSON, or nothing at all. The Phase 0
 * rule was "never leave a caught error unlogged or unsurfaced"; this is the
 * "surfaced" half, so it is worth testing as behaviour rather than as text.
 *
 * The tests below are written against what the function promises in its own
 * doc comment (short, human, never "undefined"), not against its current
 * wording, so rewording a sentence does not fail the suite.
 */
import { describe, expect, it } from 'vitest'
import { humanError } from '../lib/humanError'

// A clipped message ends with an ellipsis, which is also a sentence ending.
const looksLikeASentence = (text: string) => /^[A-Z].*[.!?…]$/s.test(text.trim())

describe('humanError', () => {
  const label = (value: unknown) => {
    try {
      return String(value)
    } catch {
      // `Object.create(null)` has no prototype, so String() throws on it — which
      // is itself worth feeding to humanError.
      return Object.prototype.toString.call(value)
    }
  }

  it('never returns an empty string, for any kind of throwable', () => {
    const inputs: unknown[] = [
      undefined,
      null,
      '',
      '   ',
      new Error(''),
      new Error('undefined'),
      {},
      [],
      Object.create(null),
      0,
      false,
      Symbol('nope'),
      new TypeError('x is not a function'),
      { toString: () => '[object Object]' },
    ]
    for (const input of inputs) {
      const text = humanError(input, 'Export')
      expect(text.length, `humanError(${label(input)}) returned nothing`).toBeGreaterThan(10)
      expect(text).not.toMatch(/undefined|\[object|^null$/i)
      expect(looksLikeASentence(text), `"${text}" does not read as a sentence`).toBe(true)
    }
  })

  it('names what the user was doing when nothing else is known', () => {
    const text = humanError(new Error(''), 'Importing the clip')
    expect(text).toContain('Importing the clip')
    expect(humanError({}, 'Saving')).toContain('Saving')
  })

  it('strips Electron\u2019s IPC wrapper instead of showing it', () => {
    const wrapped = new Error("Error invoking remote method 'studio:exportMp4': Error: The disk is full.")
    const text = humanError(wrapped, 'Export')
    expect(text).not.toMatch(/invoking remote method/i)
    // The real reason must survive the unwrapping — that is the whole point.
    expect(text.toLowerCase()).toContain('disk')
  })

  it('never lets a keyword rule resurrect a stack trace', () => {
    // The regression this pins: the passthrough rule used to match the bare word
    // `electron`, which is in the path of every main-process frame, so a stack
    // satisfied the rule and was returned verbatim.
    const withPath = new Error("TypeError: bad\n    at drawStudioFrame (/app/electron/main.cjs:1214:18)")
    const text = humanError(withPath, 'Rendering')
    expect(text).not.toMatch(/drawStudioFrame|main\.cjs/)
    expect(text).toMatch(/log/i)
  })

  it('still keeps a genuine "needs the desktop app" message', () => {
    const text = humanError(new Error('This file lives on disk — open the desktop app to use it in the Studio'), 'Import')
    expect(text.toLowerCase()).toContain('desktop app')
    expect(text).not.toMatch(/internal error/i)
  })

  it('keeps a message that was already written for a person', () => {
    const text = humanError(new Error('The export needs at least one clip on the timeline.'), 'Export')
    expect(text.toLowerCase()).toContain('at least one clip')
  })

  it('replaces a stack trace with a sentence and points at the log', () => {
    const thrown = new Error('TypeError: Cannot read properties of undefined (reading \'map\')\n    at drawStudioFrame (/app/electron/main.cjs:1214:18)\n    at executeRenderJob (/app/electron/main.cjs:4591:5)')
    const text = humanError(thrown, 'Rendering')
    expect(text).not.toMatch(/at drawStudioFrame|\.cjs:\d+/)
    expect(text.length).toBeLessThanOrEqual(190)
    expect(looksLikeASentence(text)).toBe(true)
  })

  it('keeps a long genuine explanation but truncates it rather than dumping it', () => {
    const long = new Error(`The encoder refused the frame. ${'Reason: unsupported pixel format. '.repeat(20)}`)
    const text = humanError(long, 'Export')
    expect(text.length).toBeLessThanOrEqual(200)
    expect(looksLikeASentence(text)).toBe(true)
  })

  it('is stable: the same input twice gives the same sentence', () => {
    const error = new Error('NETWORK_ERROR: the request to the local model timed out after 30s')
    expect(humanError(error, 'Autonomous Mode')).toBe(humanError(error, 'Autonomous Mode'))
  })

  it('treats a string throwable the same way as an Error', () => {
    expect(humanError('NO_KEY_CONFIGURED', 'Ask')).toBe(humanError(new Error('NO_KEY_CONFIGURED'), 'Ask'))
  })
})
