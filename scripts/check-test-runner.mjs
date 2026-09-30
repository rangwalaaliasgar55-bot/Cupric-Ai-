#!/usr/bin/env node
/**
 * check:test-runner — the tests must be able to fail.
 *
 * Phase 0 audit (docs/AUDIT_PHASE0.md §A1): `vitest` was not a dependency, no
 * `test` script existed, and `vite.config.ts` aliased the `vitest` specifier to
 * `src/shims/vitest.ts`, whose `expect()` returned an object of empty matcher
 * functions. A test bundled through the app's Vite config therefore passed
 * without asserting anything, and the two real test files were never run by
 * the release chain at all.
 *
 * This guard makes that failure mode impossible to reintroduce quietly:
 *   1. the `vitest` specifier must resolve to the real package, not a local file
 *   2. `vitest` must be a devDependency and `npm test` must exist
 *   3. no alias may point the specifier somewhere else
 *   4. no shim may re-export describe/it/expect
 * It is deliberately behavioural about (1): it asks Node to resolve the
 * specifier rather than grepping for a filename.
 */
import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const problems = []

/* 1. Where does `vitest` actually resolve to? */
let resolved = ''
try {
  resolved = import.meta.resolve('vitest')
} catch (err) {
  problems.push(`\`vitest\` cannot be resolved (${err?.message || err}). Add vitest to devDependencies.`)
}
if (resolved && !/node_modules\/vitest\//.test(resolved)) {
  problems.push(`\`vitest\` resolves to ${resolved}, which is not the real package. A local shim can pass without asserting.`)
}

/* 2. Dependency + script. */
const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'))
if (!pkg.devDependencies?.vitest) problems.push('vitest is not in devDependencies.')
if (!pkg.scripts?.test) problems.push('There is no `test` script, so nothing runs the tests.')
if (pkg.scripts?.build && !pkg.scripts.build.includes('npm run test')) {
  problems.push('`npm run build` does not run `npm run test`, so a red test cannot block a release.')
}

/* 3. No alias may point the specifier at a local file. */
const vite = await readFile(path.join(root, 'vite.config.ts'), 'utf8')
if (/['"]vitest['"]\s*:/.test(vite)) problems.push('vite.config.ts aliases the `vitest` specifier (it must resolve to the real runner).')

/* 4. No no-op test shim may exist anywhere under src/. */
async function walk(dir) {
  const out = []
  for (const entry of await readdir(path.join(root, dir), { withFileTypes: true })) {
    const rel = `${dir}/${entry.name}`
    if (entry.isDirectory()) out.push(...(await walk(rel)))
    else if (/\.(ts|tsx)$/.test(entry.name)) out.push(rel)
  }
  return out
}
for (const file of await walk('src')) {
  const text = await readFile(path.join(root, file), 'utf8')
  const exportsExpect = /export\s+(const|function)\s+expect\b/.test(text)
  const hasVitestName = /vitest/i.test(file)
  if (exportsExpect && hasVitestName) problems.push(`${file} re-implements the test framework (a shim's matchers can be empty).`)
}

if (problems.length) {
  console.error('test-runner check FAILED:')
  for (const problem of problems) console.error(`  - ${problem}`)
  process.exit(1)
}
console.log(`test-runner check passed — \`vitest\` resolves to ${resolved.replace(root, '.')}, \`npm test\` runs in the release chain`)
