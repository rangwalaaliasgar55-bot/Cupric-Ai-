#!/usr/bin/env node
/**
 * Load-time schema validation of projects.json (0.10.1): bad saved data
 * degrades to defaults + warnings, never a crash, never silent content loss.
 * Pure unit check of src/state/projectSchema.ts; check:boot covers the UI.
 */
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { rm } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const tmp = path.join(root, '.project-schema-check.mjs')
await build({
  bundle: true, outfile: tmp, format: 'esm', platform: 'node', logLevel: 'warning',
  stdin: { contents: "export { validatePersistedState, VIEWS, KNOWN_CLIP_KINDS } from './src/state/projectSchema'", resolveDir: root, loader: 'ts' },
})
const m = await import(`${pathToFileURL(tmp).href}?t=${Date.now()}`)
await rm(tmp, { force: true })

const opts = { backgroundIds: ['void', 'lime-void', 'grid-haze'] }
const v = (raw) => m.validatePersistedState(raw, opts)

// Nothing saved / junk at the top level → empty state, never a throw.
assert.deepEqual(v(undefined).state, {})
assert.deepEqual(v(null).warnings, [])
assert.equal(v('garbage').warnings.length, 1)

// The exact 0.10.0 bug-report project is valid as-is: no warnings, nothing changed.
{
  const doc = { aspect: '9:16', fps: 30, backgroundId: 'lime-void', clips: [], trackCount: 3 }
  const project = { id: 'p1', name: 'Reel', createdAt: 'x', updatedAt: 'x', brief: { messages: [], draftRundown: null, lockedRundown: null }, arenaAssets: [], footageAssets: [], timeline: [], renderJobs: [], studio: doc, brandKit: { colors: [], font: 'Inter', logoDataUrl: null } }
  const { state, warnings } = v({ projects: [project], activeProjectId: 'p1', view: 'studio', theme: 'dark', soundCues: true, automationJobs: [] })
  assert.deepEqual(warnings, [], 'a healthy empty project produces no warnings')
  assert.equal(state.view, 'studio')
  assert.equal(state.activeProjectId, 'p1')
  assert.deepEqual(state.projects[0].studio.clips, [])
  assert.equal(state.projects[0].studio.trackCount, 3)
}

// Corrupt shapes → defaults + warnings.
{
  const { state, warnings } = v({
    projects: [
      {
        id: 'p-bad', name: 42, brief: null, arenaAssets: 'nope', footageAssets: null, timeline: null, renderJobs: [null, { status: 'done' }],
        studio: {
          aspect: '3:2', fps: 7, backgroundId: 'missing-bg', trackCount: 0,
          clips: [
            { kind: 'hologram', id: 'h1', track: 4, startSec: 0, durationSec: 2 },
            { kind: 'text', id: 't1', track: 0, startSec: 0, durationSec: 2, text: null, fontFamily: 42 },
            { kind: 'background', id: 'b1', track: 0, startSec: 0, durationSec: 2, backgroundId: 'gone' },
            null, 'str',
          ],
        },
      },
      'not-a-project', null,
      { id: 'p-bad', name: 'duplicate id' },
    ],
    activeProjectId: 'missing', view: 'warp-zone', theme: 'sepia', soundCues: 'loud', automationJobs: null,
  })
  assert.equal(state.view, 'home', 'unknown view → home')
  assert.equal(state.activeProjectId, null, 'dangling active project → none')
  assert.equal(state.theme, 'dark')
  assert.equal(state.soundCues, true)
  assert.deepEqual(state.automationJobs, [])
  assert.equal(state.projects.length, 2, 'junk entries skipped, real projects kept')
  assert.notEqual(state.projects[0].id, state.projects[1].id, 'duplicate id repaired')
  const p = state.projects[0]
  assert.equal(p.name, 'Untitled project')
  assert.deepEqual(p.brief, { messages: [], draftRundown: null, lockedRundown: null }, 'brief:null (the Library crash) → empty brief')
  assert.deepEqual(p.timeline, [])
  assert.deepEqual(p.arenaAssets, [])
  assert.equal(p.renderJobs.length, 1)
  assert.ok(p.renderJobs[0].id, 'render job without id gets one')
  const doc = p.studio
  assert.equal(doc.aspect, '9:16')
  assert.equal(doc.fps, 30)
  assert.equal(doc.backgroundId, 'lime-void', 'unknown backgroundId → lime-void')
  assert.ok(doc.trackCount >= 5, 'trackCount covers the highest clip and is never 0')
  assert.equal(doc.clips.length, 3, 'non-object clips skipped, every real clip kept')
  assert.equal(doc.clips.find((c) => c.id === 'h1').kind, 'hologram', 'unknown kind KEPT (renderer skips it)')
  const text = doc.clips.find((c) => c.id === 't1')
  assert.equal(text.text, '')
  assert.ok(!('fontFamily' in text), 'unreadable font removed → default font')
  assert.equal(doc.clips.find((c) => c.id === 'b1').backgroundId, 'lime-void')
  const all = warnings.join('\n')
  for (const needle of ['view', 'hologram', 'background', 'font', 'aspect', 'fps', 'tracks', 'unreadable project', 'no longer exists']) {
    assert.ok(all.includes(needle), `a warning mentions "${needle}":\n${all}`)
  }
}

// Zero tracks / missing studio → a valid, empty doc.
{
  const { state } = v({ projects: [{ id: 'z', name: 'Zero', studio: { clips: [], trackCount: 0 } }, { id: 'n', name: 'No studio' }], view: 'library' })
  for (const p of state.projects) {
    assert.ok(p.studio.trackCount >= 1)
    assert.deepEqual(p.studio.clips, [])
    assert.equal(p.studio.backgroundId, 'lime-void')
  }
}

// Idempotent: validating repaired output changes nothing and warns nothing.
{
  const first = v({ projects: [{ id: 'a', name: 'A', studio: { aspect: '1:1', fps: 24, backgroundId: 'grid-haze', clips: [{ kind: 'text', id: 't', track: 0, startSec: 0, durationSec: 1, text: 'x' }], trackCount: 2 } }], view: 'studio', activeProjectId: 'a' })
  const second = v(JSON.parse(JSON.stringify(first.state)))
  assert.deepEqual(second.warnings, [])
  assert.deepEqual(second.state, first.state)
}

assert.ok(m.VIEWS.includes('studio') && m.VIEWS.includes('library'))
console.log(`project schema check passed — ${m.VIEWS.length} views, ${m.KNOWN_CLIP_KINDS.length} clip kinds; corrupt saves repair to defaults with warnings, content kept, idempotent`)
