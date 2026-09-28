#!/usr/bin/env node
/**
 * Runs the release check chain one step at a time, so a failure names itself.
 *
 * `npm run build` is a 65-step `&&` chain. When step 41 of 65 fails it exits
 * with a bare code 1 and no hint about what broke — which is exactly what
 * happened to the v0.12.0 release build. This runner executes the very same
 * chain (read from package.json, so there is still one source of truth) and
 * adds, per step:
 *
 *   - the step name and how long it took
 *   - a clear `BUILD FAILED: <step>` line
 *   - a GitHub Actions `::error` annotation, so the failing step is visible on
 *     the run page and in `gh run view` without opening the full log
 *
 * Usage: node scripts/run-checks.mjs [--continue]
 *   --continue  run every step instead of stopping at the first failure
 */
import { spawnSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'))

// One source of truth: the steps are whatever `npm run build` runs today.
const steps = pkg.scripts.build
  .split('&&')
  .map((step) => step.trim())
  .filter((step) => step && !step.includes('run-checks.mjs'))

// `npm run` puts node_modules/.bin on PATH; running this file directly does
// not, so `tsc` and `vite` would not resolve.
const binDir = path.join(root, 'node_modules', '.bin')
const env = {
  ...process.env,
  PATH: existsSync(binDir) ? `${binDir}${path.delimiter}${process.env.PATH ?? ''}` : process.env.PATH,
  Path: existsSync(binDir) ? `${binDir}${path.delimiter}${process.env.Path ?? ''}` : process.env.Path,
}

const keepGoing = process.argv.includes('--continue')
const failures = []

console.log(`running ${steps.length} release checks\n`)

for (const [i, step] of steps.entries()) {
  const label = `${i + 1}/${steps.length} ${step}`
  const started = Date.now()
  const result = spawnSync(step, { cwd: root, env, shell: true, stdio: 'inherit' })
  const seconds = ((Date.now() - started) / 1000).toFixed(1)
  if (result.status === 0) {
    console.log(`  ✓ ${label} (${seconds}s)\n`)
    continue
  }
  // `::error` is the GitHub Actions workflow command. It is plain text
  // everywhere else, so local runs are unaffected.
  console.log(`  ✗ ${label} (${seconds}s, exit ${result.status})`)
  console.log(`\n::error title=Release check failed::${step}\n`)
  failures.push({ step, status: result.status, seconds })
  if (!keepGoing) break
}

if (failures.length === 1) {
  console.log(`\nBUILD FAILED: ${failures[0].step}\n`)
} else if (failures.length > 1) {
  console.log(`\nBUILD FAILED: ${failures.length} steps failed\n`)
  for (const f of failures) console.log(`  - ${f.step} (exit ${f.status})`)
  console.log('')
} else {
  console.log(`\nBUILD PASSED: all ${steps.length} checks\n`)
}

process.exit(failures.length ? 1 : 0)
