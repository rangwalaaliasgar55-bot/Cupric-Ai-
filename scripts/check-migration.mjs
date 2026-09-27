#!/usr/bin/env node
/**
 * Saved-project and settings migration across versions (2.29): files written
 * by older builds must open cleanly in this one, without losing content.
 */
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { readFile, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const tmp = path.join(root, '.migration-check.mjs')
await build({
  bundle: true, outfile: tmp, format: 'esm', platform: 'node', logLevel: 'warning',
  stdin: { contents: "export { migratePersisted, normaliseStudioDoc, PERSIST_VERSION } from './src/state/migrate'", resolveDir: root, loader: 'ts' },
})
const m = await import(`${pathToFileURL(tmp).href}?t=${Date.now()}`)
await rm(tmp, { force: true })

// The store's persist version must be the migration module's.
const store = await readFile(path.join(root, 'src/state/useProjectStore.ts'), 'utf8')
assert.match(store, /version: PERSIST_VERSION/)
assert.match(store, /migratePersisted\(persisted, fromVersion\)/)
assert.ok(m.PERSIST_VERSION >= 2)

// v1 file saved by 0.5.0.
const fixture = JSON.parse(await readFile(path.join(root, 'scripts/fixtures/project-v1-0.5.0.json'), 'utf8'))
const out = m.migratePersisted(fixture.state, fixture.version)
assert.equal(out.projects.length, 2, 'no project dropped')
assert.equal(out.activeProjectId, 'p-old', 'other state kept')
const doc = out.projects[0].studio
assert.equal(doc.aspect, '9:16', 'unknown aspect → default')
assert.equal(doc.fps, 30, 'unknown fps → default')
assert.equal(doc.clips.length, 5, 'no clip dropped (unknown kinds kept)')
assert.ok(doc.trackCount >= 3, 'trackCount covers the highest clip track')
const text = doc.clips.find((c) => c.id === 'c1')
assert.deepEqual(text.keyframes.map((k) => k.at), [0, 2], 'legacy `time` keyframes → sorted `at`')
assert.equal(text.keyframes[1].ease, 'ease-in-out')
assert.equal(text.weight, 800)
assert.equal(text.align, 'center')
assert.equal(text.captionStyle, null)
const comp = doc.clips.find((c) => c.id === 'c2').component
assert.equal(comp.status, 'pending', 'interrupted recording is re-queued')
assert.equal(comp.recordSec, 120, 'record length clamped to the supported range')
const video = doc.clips.find((c) => c.id === 'c3')
assert.equal(video.speed, 1)
assert.equal(video.fit, 'cover')
assert.equal(video.trimInSec, 0)
assert.equal(doc.clips.find((c) => c.id === 'c4').kind, 'hologram', 'unknown kind preserved')
assert.ok(doc.clips[4].id, 'missing id assigned')
assert.deepEqual(out.projects[1].studio.clips, [], 'project without a studio gets an empty one')

// v0 blob (pre-persist): starter demos removed, user projects kept.
const v0 = m.migratePersisted({ projects: [{ id: 'd', name: 'Aurora Launch Teaser' }, { id: 'u', name: 'Mine', timeline: [{ sourceId: '' }, { sourceId: 'x' }] }] }, 0)
assert.deepEqual(v0.projects.map((p) => p.id), ['u'])
assert.equal(v0.projects[0].timeline.length, 1)

// Idempotent: migrating current data again changes nothing.
const again = m.migratePersisted(out, m.PERSIST_VERSION)
assert.deepEqual(again, out)

// Garbage in → a loadable empty state, never a throw.
assert.deepEqual(m.migratePersisted(null, 1).projects, [])
assert.deepEqual(m.normaliseStudioDoc('nonsense').clips, [])

// settings.json
const require = createRequire(import.meta.url)
const { migrateSettings, SETTINGS_VERSION } = require('../electron/settings-migration.cjs')
const s1 = migrateSettings({ apiKey: 'AIzaOLDKEY123', provider: 'gemini', hardwareEncoding: 'turbo', autoLaunch: 1 })
assert.equal(s1.settings.geminiApiKey, 'AIzaOLDKEY123')
assert.equal(s1.settings.aiProvider, 'gemini')
assert.equal(s1.settings.hardwareEncoding, 'auto')
assert.equal(s1.settings.autoLaunch, true)
assert.equal(s1.settings.settingsVersion, SETTINGS_VERSION)
assert.ok(!('provider' in s1.settings) && !('apiKey' in s1.settings))
assert.equal(s1.changed, true)
const s2 = migrateSettings(s1.settings)
assert.equal(s2.changed, false, 'settings migration is idempotent')
assert.equal(migrateSettings({ aiProvider: 'claude' }).settings.aiProvider, undefined)
assert.equal(migrateSettings(null).settings.settingsVersion, SETTINGS_VERSION)

console.log(`migration check passed — 0.5.0-era project and v0 blob open cleanly in persist v${m.PERSIST_VERSION}; settings v${SETTINGS_VERSION}`)
