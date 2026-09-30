#!/usr/bin/env node
/**
 * check:licences — the licensing decisions of Phase 5, enforced rather than
 * remembered.
 *
 * `docs/AUDIT_PHASE0.md` §C found two dependencies whose licences restrict
 * commercial use (`@paper-design/shaders-react`, PolyForm Shield 1.0.0; and
 * `remotion`/`@remotion/player`, free only up to three employees) plus a
 * bundled LGPL wasm that nobody had written down. Phase 5 replaced the first
 * two and documented the third (`docs/PHASE1_LICENSING.md`).
 *
 * This check keeps those decisions from quietly regressing:
 *
 *   1. the replaced packages are gone — not a dependency, not in the lockfile;
 *   2. every production dependency's declared licence is on the allow-list, and
 *      anything copyleft/restricted/unknown fails with its name;
 *   3. nothing imports a replaced package any more (with comments and template
 *      literals blanked, so sample code inside a string is not a false alarm);
 *   4. every production dependency is named in the licensing document, so the
 *      document cannot go stale when a dependency is added;
 *   5. the notices record the ported Apache-2.0 code, the vendored framecn
 *      attribution and the bundled LGPL wasm obligation;
 *   6. the shipped resource packs keep their `license-review` flags visible.
 *
 * Run: npm run check:licences
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

const pkg = JSON.parse(read('package.json'))
const production = Object.keys(pkg.dependencies || {})

/* ── 1. the replaced packages are really gone ───────────────────────────── */
const REPLACED = ['@paper-design/shaders-react', 'remotion', '@remotion/player']
const lockText = read('package-lock.json')
for (const name of REPLACED) {
  ok(!production.includes(name), `${name} is not a dependency`)
  ok(!(pkg.devDependencies || {})[name] && !(pkg.optionalDependencies || {})[name], `${name} is not a dev/optional dependency`)
  ok(!lockText.includes(`"${name}"`), `${name} is absent from package-lock.json`)
}

/* ── 2. dependency licences ─────────────────────────────────────────────── */
const ALLOWED = [
  /^MIT\b/i,
  /^Apache-2\.0$/i,
  /^ISC$/i,
  /^BSD-[23]-Clause$/i,
  /^OFL-1\.1$/i,
  /^CC0-1\.0$/i,
  /^\(MIT OR GPL-3\.0-or-later\)$/i,
]
/** Licences that restrict commercial use or are otherwise not shippable here. */
const FORBIDDEN = /PolyForm|SSPL|BUSL|Business Source|Commons Clause|Elastic License|Prosperity|proprietary|SEE LICENSE IN/i
const declared = []
const restricted = []
const unknown = []

for (const name of production) {
  const manifestPath = path.join(root, 'node_modules', name, 'package.json')
  if (!fs.existsSync(manifestPath)) {
    unknown.push(`${name} (not installed)`)
    continue
  }
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
  const license = typeof manifest.license === 'string' ? manifest.license : manifest.licenses ? JSON.stringify(manifest.licenses) : ''
  declared.push({ name, version: manifest.version, license })
  if (!license) unknown.push(`${name} (no licence field)`)
  else if (FORBIDDEN.test(license)) restricted.push(`${name}: ${license}`)
  else if (!ALLOWED.some((pattern) => pattern.test(license))) unknown.push(`${name}: ${license}`)
}

ok(production.length >= 40, `the production dependency list is read from package.json (${production.length})`)
assert.deepEqual(restricted, [], `FAIL: production dependencies with a commercial-use restriction: ${restricted.join(', ')}`)
checks += 1
assert.deepEqual(unknown, [], `FAIL: production dependencies whose licence is missing or not on the allow-list: ${unknown.join(', ')}`)
checks += 1
for (const entry of declared) ok(entry.license.length > 0, `${entry.name} declares a licence (${entry.license})`)

/* ── 3. nothing imports a replaced package ──────────────────────────────── */
/**
 * Blank out comments and template literals so sample code *inside* a string —
 * the Lab ships a `glass-code-block` whose default content is a Remotion snippet
 * — is not mistaken for a real module import. Ordinary quoted strings keep their
 * contents, because the module specifier of a real import is exactly that; a
 * specifier hidden inside a one-line string is still worth flagging.
 */
function stripLiterals(source) {
  let out = ''
  const stack = [{ kind: 'code', depth: 0 }]
  let i = 0
  const blank = (ch) => { out += ch === '\n' ? '\n' : ' ' }
  while (i < source.length) {
    const top = stack[stack.length - 1]
    const ch = source[i]
    const next = source[i + 1]
    if (top.kind === 'code') {
      if (ch === '/' && next === '/') { stack.push({ kind: 'line' }); i += 2; continue }
      if (ch === '/' && next === '*') { stack.push({ kind: 'block' }); i += 2; continue }
      if (ch === "'") { stack.push({ kind: 'quote' }); out += ch; i += 1; continue }
      if (ch === '"') { stack.push({ kind: 'quote' }); out += ch; i += 1; continue }
      if (ch === '`') { stack.push({ kind: 'template' }); out += ch; i += 1; continue }
      if (top.expression && ch === '}') {
        if (top.depth === 0) { stack.pop(); out += ch; i += 1; continue }
        top.depth -= 1
      } else if (top.expression && ch === '{') {
        top.depth += 1
      }
      out += ch
      i += 1
      continue
    }
    if (top.kind === 'line') {
      if (ch === '\n') { stack.pop(); out += '\n' } else blank(ch)
      i += 1
      continue
    }
    if (top.kind === 'block') {
      if (ch === '*' && next === '/') { stack.pop(); blank(ch); blank(next); i += 2; continue }
      blank(ch)
      i += 1
      continue
    }
    if (top.kind === 'quote') {
      // keep the contents: a real import's specifier lives here
      out += ch
      if (ch === '\\') { out += next ?? ''; i += 2; continue }
      if (ch === "'" || ch === '"') stack.pop()
      i += 1
      continue
    }
    // template literal: its text is blanked, its ${…} expressions are code
    if (ch === '\\') { blank(ch); blank(next ?? ' '); i += 2; continue }
    if (ch === '$' && next === '{') {
      stack.push({ kind: 'code', depth: 0, expression: true })
      out += ch + next
      i += 2
      continue
    }
    if (ch === '`') { stack.pop(); out += ch; i += 1; continue }
    blank(ch)
    i += 1
  }
  return out
}

const sourceFiles = []
const walk = (dir) => {
  for (const entry of fs.readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '.git' || entry === 'dist') continue
    const full = path.join(dir, entry)
    const stat = fs.statSync(full)
    if (stat.isDirectory()) walk(full)
    else if (/\.(ts|tsx|mjs|cjs|js)$/.test(entry)) sourceFiles.push(full)
  }
}
walk(path.join(root, 'src'))
walk(path.join(root, 'scripts'))
walk(path.join(root, 'electron'))

/**
 * The checker itself is the one file allowed to name the removed packages (it
 * has to, to search for them). Everything else must be clean, and the exemption
 * is asserted to be exactly this file so it cannot quietly grow.
 */
const SELF = path.relative(root, fileURLToPath(import.meta.url))
ok(
  sourceFiles.filter((file) => path.relative(root, file) === SELF).length === 1,
  'exactly one file (this checker) is exempt from the import scan',
)
const importOffenders = sourceFiles
  .filter((file) => path.relative(root, file) !== SELF)
  .filter((file) => {
    const text = stripLiterals(fs.readFileSync(file, 'utf8'))
    return REPLACED.some((name) => new RegExp(`(?:from|require\\(|import)\\s*\\(?["']${name.replace('/', '\\/')}["']`).test(text))
  })
assert.deepEqual(importOffenders.map((f) => path.relative(root, f)), [], 'FAIL: a replaced package is still imported')
checks += 1

// The stripper's own regression tests, using the real file that caused a false
// positive the first time this check ran.
ok(stripLiterals('const x = `import { m } from "remotion";`').indexOf('remotion') === -1, 'the literal stripper hides sample code inside template literals')
ok(/from\s*["']remotion["']/.test(stripLiterals('import { m } from "remotion"')), 'the literal stripper keeps real imports')
ok(/from\s*["']remotion["']/.test(stripLiterals('// import { m } from "remotion"')) === false, 'the literal stripper hides commented-out imports')
{
  const sample = read('src/lab/framecn/glass-code-block/index.tsx')
  ok(sample.indexOf('remotion') > 0, 'the Lab code sample really does contain the word (the stripper is doing work)')
  ok(stripLiterals(sample).indexOf('remotion') === -1, 'the Lab code sample no longer looks like an import')
}

/* ── 4. the licensing document cannot go stale ──────────────────────────── */
const doc = read('docs/PHASE1_LICENSING.md')
// A dependency counts as named only if it is written the way the document
// writes package names — in backticks. A bare substring ("zustand-removed")
// must not satisfy the drift gate, as a probe of this check demonstrated.
const missingFromDoc = declared.map((entry) => entry.name).filter((name) => !doc.includes(`\`${name}\``))
assert.deepEqual(missingFromDoc, [], `FAIL: production dependencies missing from docs/PHASE1_LICENSING.md: ${missingFromDoc.join(', ')}`)
checks += 1
ok(/PolyForm/.test(doc), 'the document records the removed PolyForm dependency')
ok(/Remotion/i.test(doc), 'the document records the removed Remotion licence')
ok(/libheif/i.test(doc) && /LGPL-3\.0/i.test(doc), 'the document records the bundled wasm obligation (library and licence)')
ok(/Decision/.test(doc), 'the document states decisions, not just observations')
ok(/license-review/.test(doc), 'the document explains the license-review flag')
ok(/not (ship|use)|does not ship|no longer/i.test(doc), 'the document says what is no longer shipped')

/* ── 5. the notices keep the obligations ───────────────────────────────── */
const notices = read('THIRD_PARTY_NOTICES.md')
ok(/open-edit/i.test(notices), 'the ported Apache-2.0 code is attributed')
ok(/Apache-2\.0/.test(notices), 'the Apache-2.0 licence is named in the notices')
ok(/libheif/i.test(notices), 'the bundled wasm library is named in the notices')
ok(/LGPL-3\.0/i.test(notices), 'the bundled wasm licence is named in the notices')
ok(/framecn/i.test(notices), 'the vendored framecn attribution is recorded')
ok(/Remotion/i.test(notices), 'the removed Remotion dependency is recorded in the notices')
ok(/PolyForm/i.test(notices), 'the removed PolyForm dependency is recorded in the notices')

/* ── 6. shipped resource packs declare their licence position ───────────── */
const packDir = path.join(root, 'resources', 'packs')
const packs = fs.readdirSync(packDir).filter((file) => file.endsWith('.json'))
ok(packs.length > 0, `resource packs are present (${packs.length})`)
const index = JSON.parse(read('resources/packs/index.json'))
const packList = Array.isArray(index) ? index : index.packs || Object.values(index)
ok(packList.length > 0, 'the pack index lists the packs')
const flagged = []
for (const file of packs) {
  const pack = JSON.parse(read(path.join('resources', 'packs', file)))
  const items = Array.isArray(pack.items) ? pack.items : []
  for (const item of items) {
    if (Array.isArray(item.tags) && item.tags.includes('license-review')) flagged.push(`${file}:${item.id}`)
  }
}
ok(flagged.length > 0, `items flagged license-review stay visible (${flagged.length} flagged)`)

console.log(
  `licences check passed — ${checks} assertions, ${declared.length} production dependencies all permissive `
  + `(${[...new Set(declared.map((d) => d.license))].sort().join(', ')}), `
  + `${REPLACED.length} restricted packages removed, ${flagged.length} pack items still flagged for review`,
)
