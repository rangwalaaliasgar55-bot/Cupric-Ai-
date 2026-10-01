#!/usr/bin/env node
/** Autosave / crash recovery / version history (2.26), against a temp folder. */
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const require = createRequire(import.meta.url)
const h = require('../electron/project-history.cjs')
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'newbrand-history-'))
const blob = (name, clips = 1) => JSON.stringify({ state: { projects: [{ name, studio: { clips: Array.from({ length: clips }, (_, i) => ({ id: i })) } }] }, version: 2 })
const at = (min) => new Date(Date.UTC(2026, 8, 27, 10, min, 0))

try {
  // First save rolls a snapshot; a save 30 s later does not; 2+ min later does.
  h.save(dir, blob('A'), { now: at(0) })
  h.save(dir, blob('A2'), { now: new Date(at(0).getTime() + 30000) })
  assert.equal(h.listVersions(dir).length, 1)
  h.save(dir, blob('B', 3), { now: at(3) })
  const versions = h.listVersions(dir)
  assert.equal(versions.length, 2)
  assert.equal(versions[0].names[0], 'B', 'newest first')
  assert.equal(versions[0].clips, 3)
  assert.equal(versions[0].schemaVersion, 2)
  assert.equal(h.load(dir).text, blob('B', 3))

  // Invalid JSON is refused and never overwrites good data.
  assert.throws(() => h.save(dir, '{"state":'), /not valid JSON/)
  assert.equal(h.load(dir).text, blob('B', 3))

  // No temp files left behind by atomic writes.
  assert.ok(!fs.readdirSync(dir).some((f) => f.endsWith('.tmp')))

  // A corrupted main file (crash mid-write by another tool, disk error) recovers from the newest valid snapshot.
  fs.writeFileSync(path.join(dir, 'projects.json'), '{"state": {"projects": [', 'utf8')
  const recovered = h.load(dir)
  assert.ok(recovered.recoveredFrom, 'recovered from a snapshot')
  assert.equal(JSON.parse(recovered.text).state.projects[0].name, 'B')
  assert.ok(fs.readdirSync(dir).some((f) => f.startsWith('projects.corrupt-')), 'damaged file kept for inspection')

  // Restore keeps the current state as "before-restore", so a restore is undoable.
  const oldest = h.listVersions(dir).find((v) => v.names[0] === 'A')
  h.restore(dir, oldest.id)
  assert.equal(JSON.parse(h.load(dir).text).state.projects[0].name, 'A')
  assert.ok(h.listVersions(dir).some((v) => v.label === 'before-restore' && v.names[0] === 'B'))

  // Path traversal is refused.
  assert.throws(() => h.restore(dir, '../projects.json'), /Unknown version/)

  // Rolling window: only `keep` autosaves survive.
  for (let i = 0; i < 12; i += 1) h.save(dir, blob(`R${i}`), { now: at(10 + i * 3), keep: 5 })
  assert.equal(h.listVersions(dir).filter((v) => v.label === 'autosave').length, 5)

  // Unclean-exit detection.
  const sdir = path.join(dir, 'session')
  assert.equal(h.beginSession(sdir), false)
  assert.equal(h.beginSession(sdir), true, 'second start without endSession = crash')
  h.endSession(sdir)
  assert.equal(h.beginSession(sdir), false)
  console.log('project history check passed — atomic saves, rolling snapshots, corrupt-file recovery, undoable restore, crash detection')
} finally {
  fs.rmSync(dir, { recursive: true, force: true })
}
