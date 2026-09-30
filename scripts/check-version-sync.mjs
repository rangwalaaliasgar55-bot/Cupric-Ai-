#!/usr/bin/env node
/**
 * check:version-sync — the version is stated in four places, and they must
 * agree.
 *
 * Phase 0 finding D4: the newest release on GitHub was v0.15.0 while the README
 * that ships next to it still advertised 0.13.0 installers. Nothing noticed,
 * because nothing compared them. This check does, in the build chain, so drift
 * fails the build instead of reaching a download page.
 *
 * The four statements, and what "agree" means:
 *
 *   1. `package.json` → version        the single source of truth.
 *   2. README.md      → artifact names and the "Current version" line must
 *                        quote exactly that version, so the download
 *                        instructions cannot describe a release that is not
 *                        this one.
 *   3. CHANGELOG.md   → the top section is either `## [Unreleased]` or
 *                        `## [<version>]`, and the version appears as a
 *                        released section somewhere in the file.
 *   4. the running app → the version is never a literal in app code: it comes
 *                        from `app.getVersion()` in the main process, exposed
 *                        over IPC, and rendered by Settings. (The Lab's demo
 *                        components contain sample changelog data with version
 *                        numbers in it; that prefix is excluded and the
 *                        exclusion is asserted, so it cannot quietly grow.)
 *
 * Under a release tag (`GITHUB_REF_TYPE=tag`, `GITHUB_REF_NAME=v1.2.3`, or
 * `--tag v1.2.3` locally) the rules tighten: the tag must equal `v<version>`
 * and the changelog's top section must be the version itself — a release commit
 * finalises the changelog rather than tagging whatever was on the branch.
 *
 * Run: npm run check:version-sync        (add `--tag v0.13.0` to test a tag)
 */

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8')

let checks = 0
const ok = (condition, label) => {
  assert.ok(condition, `FAIL: ${label}`)
  checks += 1
}

/* ── 1. package.json is the source of truth ─────────────────────────────── */
const pkg = JSON.parse(read('package.json'))
const version = pkg.version
ok(/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(version), `package.json version is semver (${version})`)
assert.notEqual(pkg.build, undefined, 'FAIL: package.json has an electron-builder config')
assert.equal(pkg.build.extraMetadata?.version ?? version, version, 'FAIL: build.extraMetadata.version would override the app version')
checks += 1

/* ── 2. the README describes this version ───────────────────────────────── */
const readme = read('README.md')
const setupVersions = [...readme.matchAll(/Cupric-AI-Setup-([0-9][0-9A-Za-z.-]*)\.exe/g)].map((m) => m[1])
const portableVersions = [...readme.matchAll(/Cupric-AI-([0-9][0-9A-Za-z.-]*)-x64-Portable\.exe/g)].map((m) => m[1])
ok(setupVersions.length > 0, 'README names the NSIS installer it produces')
ok(portableVersions.length > 0, 'README names the portable build it produces')
assert.deepEqual([...new Set(setupVersions)], [version], `FAIL: README installer names disagree with package.json ${version}`)
checks += 1
assert.deepEqual([...new Set(portableVersions)], [version], `FAIL: README portable names disagree with package.json ${version}`)
checks += 1
const currentVersionLine = readme.match(/\*\*Current version:\*\*\s*`?([0-9][0-9A-Za-z.-]*)`?/)
ok(currentVersionLine != null, 'README states a "**Current version:**" line')
assert.equal(currentVersionLine[1], version, `FAIL: README says the current version is ${currentVersionLine?.[1]}, package.json says ${version}`)
checks += 1

/* ── 3. the changelog is a changelog, not a stub ────────────────────────── */
const changelog = read('CHANGELOG.md')
const headings = [...changelog.matchAll(/^##\s+\[([^\]]+)\]/gm)].map((m) => m[1])
ok(headings.length > 0, 'CHANGELOG.md has version sections')
const top = headings[0]
ok(top === 'Unreleased' || top === version, `CHANGELOG's top section is Unreleased or ${version} (found "${top}")`)
ok(headings.includes(version), `CHANGELOG has a section for ${version}`)
// The published releases are real, so the file must stay long enough to matter:
// a changelog that has been truncated to one entry is worse than none.
ok(headings.length >= 5, `CHANGELOG keeps the released history (${headings.length} sections)`)
ok(/\d{4}-\d{2}-\d{2}/.test(changelog), 'CHANGELOG entries carry release dates')

/* ── 4. the running app reads the version, never hardcodes it ───────────── */
const main = read('electron/main.cjs')
ok(/app\.getVersion\(\)/.test(main), 'main process reports app.getVersion()')
ok(/ipcMain\.handle\(\s*['"]app:info['"]/.test(main), 'the main process exposes app:info')
const appInfoHandler = main.match(/ipcMain\.handle\(\s*['"]app:info['"][\s\S]{0,1500}?\n\}\)/)
ok(appInfoHandler != null && /app\.getVersion\(\)/.test(appInfoHandler[0]), 'app:info returns the real version')
ok(appInfoHandler != null && /catch/.test(appInfoHandler[0]), 'app:info reports a failure instead of throwing into the void')
const preload = read('electron/preload.cjs')
ok(preload.includes("'app:info'"), 'the IPC allowlist includes app:info')
const settingsPanel = read('src/app-shell/AskPanel.tsx')
ok(/invoke[^\n]*app:info/.test(settingsPanel) || /app:info/.test(settingsPanel), 'Settings asks for the version')
ok(/appInfo|appVersion/.test(settingsPanel), 'Settings renders the version it was given')

// No version literal in app code. `src/lab/` is excluded on purpose: its
// components are vendored demo material, and `changelog-stack` ships sample
// changelog data with version numbers in it.
const EXCLUDED_PREFIX = 'src/lab/'
const scanned = []
const walk = (dir) => {
  for (const entry of fs.readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '.git' || entry === 'dist') continue
    const full = path.join(dir, entry)
    const rel = path.relative(root, full).split(path.sep).join('/')
    if (fs.statSync(full).isDirectory()) {
      if (rel === 'src/lab') continue
      walk(full)
    } else if (/\.(ts|tsx|cjs|js)$/.test(entry)) scanned.push(full)
  }
}
const offenders = []
for (const base of ['src', 'electron']) walk(path.join(root, base))
for (const file of scanned) {
  const text = fs.readFileSync(file, 'utf8')
  for (const match of text.matchAll(/['"`](\d+\.\d+\.\d+)['"`]/g)) {
    offenders.push(`${path.relative(root, file)}: ${match[1]}`)
  }
}
assert.deepEqual(offenders, [], `FAIL: a version literal is hardcoded in app code (the app must read app.getVersion()): ${offenders.join(', ')}`)
checks += 1
ok(fs.existsSync(path.join(root, EXCLUDED_PREFIX, 'components/changelog-stack.tsx')), `the only excluded prefix is ${EXCLUDED_PREFIX} and it exists`)

/* ── 5. under a tag, the tag and the changelog must match the version ───── */
const flagIndex = process.argv.indexOf('--tag')
const tag = flagIndex >= 0
  ? process.argv[flagIndex + 1]
  : process.env.GITHUB_REF_TYPE === 'tag'
    ? process.env.GITHUB_REF_NAME || process.env.GITHUB_REF?.replace('refs/tags/', '')
    : null

if (tag) {
  assert.equal(tag, `v${version}`, `FAIL: release tag ${tag} does not match package.json version ${version} — the tag and the artifact it builds must be the same release`)
  checks += 1
  assert.equal(top, version, `FAIL: releasing ${tag} requires CHANGELOG.md's top section to be [${version}] (found "${top}") — move the Unreleased notes under the version heading in the release commit`)
  checks += 1
  const releasable = headings.filter((h) => h !== 'Unreleased')
  assert.equal(releasable[0], version, `FAIL: CHANGELOG lists ${releasable[0]} above ${version}`)
  checks += 1
  console.log(`version sync passed under tag ${tag} — package.json, README, CHANGELOG and the app all say ${version}`)
} else {
  console.log(`version sync passed — package.json, README, CHANGELOG and the in-app version all agree on ${version} (${checks} assertions)`)
}
