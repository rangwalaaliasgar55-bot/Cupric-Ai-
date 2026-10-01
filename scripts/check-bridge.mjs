#!/usr/bin/env node
/**
 * check:bridge — the desktop bridge stays read-only (v0.10.1).
 *
 * 0.10.0 blanked the Studio with `window.newbrand = {...window.newbrand, studio}`:
 * contextBridge defines window.newbrand non-writable, so the packaged app threw
 * "Cannot assign to read only property 'newbrand' of object '#<Window>'" on
 * mount. This check makes every way back to that a build failure:
 *
 *   1. ESLint `no-restricted-syntax` (scripts/eslint-bridge-rule.mjs) over
 *      src/ and electron/ — zero errors allowed.
 *   2. The rule is self-tested against the exact 0.10.0 code and other write
 *      forms (and must NOT fire on legitimate reads / window.__newbrandStudio).
 *   3. A comment-stripped source grep as a second net.
 *   4. The preload is executed against a mocked contextBridge: ONE deep-frozen
 *      bridge, exposed exactly as `newbrand` + `northframe`, identical object.
 *   5. A tsc fixture proves direct assignment is a TYPE error.
 *   6. If dist/ exists, the minified bundle is scanned for `.newbrand=`.
 */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'
import { ESLint } from 'eslint'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const rel = (f) => path.relative(root, f)
const problems = []
const ok = (msg) => console.log(`  ✓ ${msg}`)

/* 1. ESLint over the sources ——————————————————————————————————————— */
const eslint = new ESLint({ cwd: root })
const results = await eslint.lintFiles(['src/**/*.{ts,tsx}', 'electron/**/*.cjs'])
const lintErrors = results.flatMap((r) => r.messages.filter((m) => m.severity === 2).map((m) => `${rel(r.filePath)}:${m.line}:${m.column} ${m.ruleId ?? 'parse'} — ${m.message.slice(0, 110)}`))
if (lintErrors.length) problems.push(`ESLint found ${lintErrors.length} error(s):\n    ${lintErrors.join('\n    ')}`)
else ok(`ESLint bridge rule: ${results.length} files, 0 errors`)

/* 2. Self-test the rule ————————————————————————————————————————————— */
const BAD = {
  '0.10.0 Studio (verbatim)': `const w = window as unknown as { newbrand?: Record<string, unknown> }\nw.newbrand = { ...(w.newbrand ?? {}), studio: api }\nif (w.newbrand?.studio === api) delete w.newbrand.studio`,
  'minified form': `nt.newbrand={...nt.newbrand,studio:Ve}`,
  'direct window assign': `window.newbrand = bridge`,
  'legacy alias assign': `window.northframe = bridge`,
  'computed assign': `window['newbrand'] = bridge`,
  'nested member assign': `window.newbrand.studio = api`,
  'cast then assign': `;(window as any).newbrand = {}`,
  'globalThis assign': `globalThis.newbrand = {}`,
  'logical assign': `window.newbrand ??= bridge`,
  'delete bridge': `delete (window as any).newbrand`,
  'delete nested': `delete window.newbrand.studio`,
  'Object.assign into bridge': `Object.assign(window.newbrand, { studio: api })`,
  'defineProperty on window': `Object.defineProperty(window, 'newbrand', { value: 1 })`,
  'Reflect.deleteProperty': `Reflect.deleteProperty(window, 'northframe')`,
}
const GOOD = {
  'getBridge read': `const b = window.newbrand ?? window.northframe ?? null`,
  'optional call': `void window.newbrand?.ipc.invoke('settings:get')`,
  'comparison': `if (window.newbrand === x) {}`,
  'studio global assign': `window.__newbrandStudio = api`,
  'studio global delete': `delete window.__newbrandStudio`,
  'unrelated property': `obj.newbrandSomething = 1`,
}
const selfTestFile = path.join(root, 'src/__bridge_selftest__.ts')
for (const [name, code] of Object.entries(BAD)) {
  const [r] = await eslint.lintText(code, { filePath: selfTestFile })
  const hits = r.messages.filter((m) => m.ruleId === 'no-restricted-syntax')
  if (!hits.length) problems.push(`rule self-test: "${name}" was NOT flagged:\n    ${code}`)
}
for (const [name, code] of Object.entries(GOOD)) {
  const [r] = await eslint.lintText(code, { filePath: selfTestFile })
  const hits = r.messages.filter((m) => m.severity === 2)
  if (hits.length) problems.push(`rule self-test: legitimate "${name}" was flagged: ${hits.map((h) => h.message.slice(0, 80)).join(' | ')}`)
}
ok(`rule self-test: ${Object.keys(BAD).length} write forms flagged, ${Object.keys(GOOD).length} legitimate reads allowed`)

/* 3. Source grep (comments stripped) ——————————————————————————————— */
function walk(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name)
    if (e.isDirectory()) walk(full, out)
    else if (/\.(tsx?|jsx?|cjs|mjs)$/.test(e.name)) out.push(full)
  }
  return out
}
const stripComments = (text) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1')
const GREP = [
  /\.(newbrand|northframe)\s*(?:=(?!=)|\?\?=|\|\|=|&&=)/,
  /\[\s*['"`](newbrand|northframe)['"`]\s*\]\s*=(?!=)/,
  /\bdelete\s+[^;\n]*\.(newbrand|northframe)\b/,
  /\.(newbrand|northframe)\s*\.\s*\w+\s*=(?!=)/,
]
const grepHits = []
for (const file of [...walk(path.join(root, 'src')), ...walk(path.join(root, 'electron'))]) {
  const lines = stripComments(readFileSync(file, 'utf8')).split('\n')
  lines.forEach((line, i) => {
    if (GREP.some((re) => re.test(line))) grepHits.push(`${rel(file)}:${i + 1}: ${line.trim().slice(0, 120)}`)
  })
}
if (grepHits.length) problems.push(`source grep found bridge writes:\n    ${grepHits.join('\n    ')}`)
else ok('source grep: no window.newbrand= / window.northframe= / delete *.newbrand.* in src/ or electron/')

/* 4. Preload: one frozen bridge, exposed twice, never changed ——————————— */
{
  const preloadPath = path.join(root, 'electron/preload.cjs')
  const source = readFileSync(preloadPath, 'utf8')
  const exposed = []
  const electronMock = {
    contextBridge: { exposeInMainWorld: (name, value) => exposed.push({ name, value }) },
    ipcRenderer: { invoke: async () => undefined, on() {}, removeListener() {} },
    webUtils: { getPathForFile: () => null },
  }
  const sandbox = { require: (id) => (id === 'electron' ? electronMock : (() => { throw new Error(`preload must not require ${id}`) })()), process: { platform: 'win32', versions: { electron: '33', chrome: '130', node: '20' } }, console }
  vm.runInNewContext(source, sandbox, { filename: preloadPath })
  const names = exposed.map((e) => e.name).sort()
  try {
    assert.deepEqual(names, ['newbrand', 'northframe'], 'preload must expose exactly `newbrand` and `northframe`')
    assert.equal(exposed[0].value, exposed[1].value, 'both names must expose the SAME bridge object')
    const b = exposed[0].value
    for (const [label, obj] of [['bridge', b], ['bridge.ipc', b.ipc], ['bridge.versions', b.versions], ['bridge.paths', b.paths]]) {
      assert.ok(Object.isFrozen(obj), `${label} must be frozen`)
    }
    assert.throws(() => { 'use strict'; b.studio = {} }, TypeError, 'adding to the bridge must throw')
    assert.throws(() => { 'use strict'; b.ipc.invoke = null }, TypeError, 'replacing an IPC method must throw')
    assert.equal(typeof b.ipc.invoke, 'function')
    assert.equal(b.isDesktop, true)
    assert.equal((source.match(/exposeInMainWorld\(/g) || []).length, 1, 'exposeInMainWorld must appear once (a loop over the two names)')
    assert.ok(!/\bbridge\s*(?:\.\s*\w+|\[[^\]]+\])\s*=(?!=)/.test(stripComments(source)), 'preload must not mutate the bridge after creating it')
    ok('preload: one deep-frozen bridge, exposed as newbrand + northframe (same object), immutable')
  } catch (err) {
    problems.push(`preload: ${err.message}`)
  }
}

/* 5. Types: direct assignment must be a type error ————————————————————— */
{
  const bridgeTs = readFileSync(path.join(root, 'src/lib/bridge.ts'), 'utf8')
  if (!/readonly\s+newbrand\?\s*:\s*Readonly<NewBrandBridge>/.test(bridgeTs) || !/readonly\s+northframe\?\s*:\s*Readonly<NewBrandBridge>/.test(bridgeTs)) {
    problems.push('src/lib/bridge.ts: Window must declare `readonly newbrand?: Readonly<NewBrandBridge>` and `readonly northframe?: Readonly<NewBrandBridge>`')
  }
  if (!/__newbrandStudio\?\s*:\s*StudioApi/.test(bridgeTs)) problems.push('src/lib/bridge.ts: Window must declare `__newbrandStudio?: StudioApi`')
  const tsconfig = path.join(root, '.bridge-typecheck.tsconfig.json')
  writeFileSync(
    tsconfig,
    JSON.stringify({ extends: './tsconfig.json', compilerOptions: { noEmit: true, types: ['vite/client'] }, include: [], files: ['scripts/fixtures/bridge-readonly.ts', 'src/app-version.d.ts'] }),
  )
  try {
    const tsc = spawnSync(process.execPath, [path.join(root, 'node_modules/typescript/bin/tsc'), '-p', tsconfig], { cwd: root, encoding: 'utf8' })
    if (tsc.status !== 0) problems.push(`type fixture scripts/fixtures/bridge-readonly.ts failed (a read-only guarantee was lost, or a legitimate use broke):\n    ${(tsc.stdout + tsc.stderr).trim().split('\n').slice(0, 12).join('\n    ')}`)
    else ok('types: assigning/deleting window.newbrand / window.northframe is a compile error; window.__newbrandStudio is allowed')
  } finally {
    rmSync(tsconfig, { force: true })
  }
}

/* 6. Built bundle (if present) ———————————————————————————————————————— */
{
  const assets = path.join(root, 'dist', 'assets')
  const newestSrc = () => Math.max(...walk(path.join(root, 'src')).map((f) => statSync(f).mtimeMs), statSync(path.join(root, 'electron/preload.cjs')).mtimeMs)
  if (existsSync(assets) && existsSync(path.join(root, 'dist/index.html')) && statSync(path.join(root, 'dist/index.html')).mtimeMs < newestSrc()) {
    ok('dist/ is older than src/ (stale build) — bundle scan skipped here; check:boot rebuilds and rescans it')
  } else if (existsSync(assets)) {
    const hits = []
    for (const f of readdirSync(assets).filter((n) => n.endsWith('.js'))) {
      const text = readFileSync(path.join(assets, f), 'utf8')
      const re = /[\w$\])]\.(newbrand|northframe)\s*=(?!=)|delete\s+[\w$.]+\.(newbrand|northframe)\b/g
      let m
      while ((m = re.exec(text))) hits.push(`${f}: …${text.slice(Math.max(0, m.index - 30), m.index + 50)}…`)
    }
    if (hits.length) problems.push(`dist/ bundle writes to the bridge (rebuild after fixing?):\n    ${hits.slice(0, 5).join('\n    ')}`)
    else ok('dist/ bundle: no writes to the bridge')
  } else {
    ok('dist/ not built — bundle scan runs in check:boot')
  }
}

if (problems.length) {
  console.error(`\ncheck:bridge FAILED:\n  - ${problems.join('\n  - ')}`)
  process.exit(1)
}
console.log('\ncheck:bridge passed — the desktop bridge is read-only everywhere (lint, grep, preload, types, bundle)')
