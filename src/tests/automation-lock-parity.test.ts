/**
 * Two implementations of one rule set must agree.
 *
 * The desktop pipeline locks rundowns in `electron/automation-steps.cjs`; the
 * browser build validates them in `src/lib/automation/lock.ts` (it cannot
 * require a main-process CommonJS file). Duplication is the risk, so the parity
 * is tested here on the fixtures that matter: valid rundowns, gaps, overlaps,
 * wrong frame size, unsupported fps, missing copy, short scenes, long copy.
 *
 * If either side changes a rule without the other, this file fails.
 */
import { describe, expect, it } from 'vitest'
import { createRequire } from 'node:module'
import { validateRundown as validateInBrowser, type RundownVerdict } from '../lib/automation/lock'
import type { SceneRundown } from '../types/project'

const require = createRequire(import.meta.url)
const desktop = require('../../electron/automation-steps.cjs')

const sizeFor = (aspect: string): [number, number] => (aspect === '9:16' ? [1080, 1920] : aspect === '1:1' ? [1080, 1080] : [1920, 1080])

function make(opts: { durationSec?: number; aspect?: '9:16' | '1:1' | '16:9'; fps?: number; sceneCount?: number; copies?: string[] } = {}): SceneRundown {
  const durationSec = opts.durationSec ?? 12
  const aspect = opts.aspect ?? '9:16'
  const sceneCount = opts.sceneCount ?? 4
  const each = durationSec / sceneCount
  const copies = opts.copies ?? ['First line', 'Second line', 'Third line', 'Fourth line']
  return {
    title: 'Parity fixture',
    durationSec,
    fps: opts.fps ?? 30,
    size: sizeFor(aspect),
    style: 'kinetic',
    arenaPrompt: 'prompt',
    scenes: Array.from({ length: sceneCount }, (_, index) => ({
      id: `scene-${index + 1}`,
      from: Number((index * each).toFixed(2)),
      to: Number(((index + 1) * each).toFixed(2)),
      type: ['hook', 'build', 'proof', 'cta'][index % 4],
      copy: copies[index % copies.length],
      motion: `motion ${index + 1}`,
    })),
  }
}

const fixtures: Array<{ name: string; rundown: SceneRundown; aspect: '9:16' | '1:1' | '16:9'; fps: number }> = [
  { name: 'a plain 12s vertical rundown', rundown: make(), aspect: '9:16', fps: 30 },
  { name: 'a 6s square rundown', rundown: make({ durationSec: 6, aspect: '1:1', sceneCount: 2 }), aspect: '1:1', fps: 30 },
  { name: 'a 20s landscape 60fps rundown', rundown: make({ durationSec: 20, aspect: '16:9', fps: 60, sceneCount: 5 }), aspect: '16:9', fps: 60 },
  { name: 'a 24fps rundown', rundown: make({ fps: 24, sceneCount: 3 }), aspect: '9:16', fps: 24 },
  { name: 'a gap between scenes', rundown: (() => { const r = make(); r.scenes[2].from = 7.5; return r })(), aspect: '9:16', fps: 30 },
  { name: 'an overlap between scenes', rundown: (() => { const r = make(); r.scenes[2].from = 5; return r })(), aspect: '9:16', fps: 30 },
  { name: 'a size that contradicts the aspect', rundown: (() => { const r = make(); r.size = [1920, 1080]; return r })(), aspect: '9:16', fps: 30 },
  { name: 'an unsupported frame rate', rundown: make({ fps: 23 }), aspect: '9:16', fps: 23 },
  { name: 'a scene with no copy', rundown: (() => { const r = make(); r.scenes[1].copy = ''; return r })(), aspect: '9:16', fps: 30 },
  { name: 'a scene shorter than the minimum', rundown: (() => { const r = make(); r.scenes[0].to = r.scenes[0].from + 0.1; r.scenes[1].from = r.scenes[0].to; return r })(), aspect: '9:16', fps: 30 },
  { name: 'copy longer than a caption can be', rundown: (() => { const r = make(); r.scenes[0].copy = 'x'.repeat(240); return r })(), aspect: '9:16', fps: 30 },
  { name: 'no scenes at all', rundown: (() => { const r = make(); r.scenes = []; return r })(), aspect: '9:16', fps: 30 },
  { name: 'no duration', rundown: (() => { const r = make(); r.durationSec = 0; return r })(), aspect: '9:16', fps: 30 },
  { name: 'no title', rundown: (() => { const r = make(); r.title = ''; return r })(), aspect: '9:16', fps: 30 },
]

describe('the browser lock and the desktop lock agree', () => {
  it.each(fixtures)('$name', ({ rundown, aspect, fps }) => {
    const desktopVerdict = desktop.validateRundown(rundown, { aspect, fps }) as RundownVerdict
    const browserVerdict = validateInBrowser(rundown, { aspect, fps })
    expect(browserVerdict.ok).toBe(desktopVerdict.ok)
    expect(browserVerdict.issues.length).toBe(desktopVerdict.issues.length)
    // Same issue in the same position: order is part of the contract too,
    // because the first issue is what a user reads first.
    browserVerdict.issues.forEach((issue, index) => {
      const other = desktopVerdict.issues[index]
      // Wording may differ by a leading article; the substance must not.
      const normalise = (text: string) => text.toLowerCase().replace(/^the /, '').replace(/\s+/g, ' ').trim()
      expect(normalise(issue)).toBe(normalise(other))
    })
  })

  it('both accept the same valid rundowns and reject the same broken one', () => {
    const good = make()
    expect(desktop.validateRundown(good, { aspect: '9:16', fps: 30 }).ok).toBe(true)
    expect(validateInBrowser(good, { aspect: '9:16', fps: 30 }).ok).toBe(true)

    const bad = make()
    bad.scenes[1].from = 99
    expect(desktop.validateRundown(bad, { aspect: '9:16', fps: 30 }).ok).toBe(false)
    expect(validateInBrowser(bad, { aspect: '9:16', fps: 30 }).ok).toBe(false)
  })

  it('both describe what they checked', () => {
    const browser = validateInBrowser(make(), { aspect: '9:16', fps: 30 })
    const desktopVerdict = desktop.validateRundown(make(), { aspect: '9:16', fps: 30 }) as RundownVerdict
    expect(browser.checks.map((check) => check.id)).toEqual(desktopVerdict.checks.map((check: { id: string }) => check.id))
  })
})
