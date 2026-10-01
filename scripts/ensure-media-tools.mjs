#!/usr/bin/env node
/**
 * ensure-media-tools.mjs — make sure this checkout can really encode *and* check.
 *
 * Why this exists: `ffmpeg-static` and `ffprobe-static` are **optional**
 * dependencies. `ffprobe-static` bundles its binaries in the npm tarball, and
 * `ffmpeg-static` downloads its binary in a postinstall script; when either
 * fails, npm removes the package *silently* — no error, no warning in the
 * install summary. The consequences are worse than they look:
 *
 *   - without FFmpeg the app cannot render MP4 at all;
 *   - without ffprobe **nothing the app renders can be verified** — the export
 *     still succeeds, but the read-back check that stops a broken file being
 *     announced as "Saved" cannot run.
 *
 * Both were missing in the checkout this work was done in, and FFmpeg was
 * missing on the first Windows CI run. The build chain still passed, because
 * most checks skip media work when the tools are absent — the first real signal
 * would have been a user whose export failed.
 *
 * It never pretends. Each tool is resolved, then obtained if possible, and the
 * exit code is non-zero when either is still missing: that is a build failure
 * for CI and a clear message for a developer.
 *
 *   npm run media:ensure
 *   NEWBRAND_FFMPEG_PATH=/path/to/ffmpeg NEWBRAND_FFPROBE_PATH=/path/to/ffprobe npm run media:ensure
 */
import { existsSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const isWindows = process.platform === 'win32'
const exe = (name) => (isWindows ? `${name}.exe` : name)
const TOOLS = ['ffmpeg', 'ffprobe']

/** Where a tool could legitimately be, in the order the app checks. */
function candidates(tool) {
  const list = []
  const envName = `NEWBRAND_${tool.toUpperCase()}_PATH`
  if (process.env[envName]) list.push([envName, process.env[envName]])
  if (process.env[`${tool.toUpperCase()}_PATH`]) list.push([`${tool.toUpperCase()}_PATH`, process.env[`${tool.toUpperCase()}_PATH`]])
  const moduleName = `${tool}-static`
  try {
    const loaded = require(moduleName)
    const resolved = typeof loaded === 'string' ? loaded : loaded?.path
    list.push([`${moduleName} module`, resolved ?? null, resolved ? undefined : 'the module exported no path'])
  } catch (error) {
    list.push([`${moduleName} module`, null, `require threw: ${error?.code || error?.message}`])
  }
  const which = spawnSync(isWindows ? 'where' : 'which', [tool], { encoding: 'utf8' })
  const onPath = which.status === 0 ? String(which.stdout).split(/\r?\n/).map((l) => l.trim()).filter(Boolean)[0] : null
  list.push(['PATH', onPath])
  list.push(['repo-local package', path.join(root, 'node_modules', moduleName, exe(tool))])
  return list
}

function resolve(tool) {
  for (const [source, file, note] of candidates(tool)) {
    if (note || !file) continue
    const resolved = path.isAbsolute(file) ? file : path.resolve(root, file)
    if (existsSync(resolved)) return { file: resolved, source }
  }
  return null
}

function describe(entry) {
  const [source, file, note] = entry
  if (note) return `${source}: ${note}`
  if (!file) return `${source}: not configured`
  const resolved = path.isAbsolute(file) ? file : path.resolve(root, file)
  try {
    const stat = statSync(resolved)
    return `${source}: ${resolved} (${(stat.size / 1e6).toFixed(1)} MB)`
  } catch {
    return `${source}: ${resolved} — NOT PRESENT`
  }
}

/**
 * Getting a tool back, in the same order for both.
 *
 * `npm rebuild` re-runs the package's own install script; `npm install --no-save`
 * is for a package npm removed entirely after a failed optional install.
 * `--no-save` keeps package.json and package-lock.json exactly as committed: a
 * missing binary is a problem with this machine's network, not with the project.
 */
function attempt(tool) {
  const moduleName = `${tool}-static`
  console.log(`  · ${tool}: npm rebuild ${moduleName} (re-runs its install script)`)
  const rebuild = spawnSync('npm', ['rebuild', moduleName], { cwd: root, encoding: 'utf8', shell: isWindows })
  if (rebuild.status !== 0) {
    console.log(`      npm rebuild exited ${rebuild.status}: ${(rebuild.stderr || '').trim().split('\n').slice(-2).join(' ')}`)
  }
  if (resolve(tool)) return true

  console.log(`  · ${tool}: npm install ${moduleName} --no-save`)
  const install = spawnSync('npm', ['install', moduleName, '--no-save', '--no-audit', '--no-fund'], { cwd: root, encoding: 'utf8', shell: isWindows })
  if (install.status !== 0) {
    console.log(`      npm install exited ${install.status}: ${(install.stderr || '').trim().split('\n').slice(-2).join(' ')}`)
  }
  return Boolean(resolve(tool))
}

const found = {}
console.log(`ensure-media-tools: looking for ${TOOLS.join(' and ')} (${isWindows ? 'Windows' : process.platform})`)
for (const tool of TOOLS) {
  const hit = resolve(tool)
  if (hit) {
    found[tool] = hit
    console.log(`  ✓ ${tool}: ${hit.source} → ${hit.file}`)
  }
}

for (const tool of TOOLS) {
  if (found[tool]) continue
  console.log(`  · ${tool}: not found. Candidates checked:`)
  for (const entry of candidates(tool)) console.log(`      ${describe(entry)}`)
  if (attempt(tool)) {
    found[tool] = resolve(tool)
    console.log(`  ✓ ${tool}: obtained → ${found[tool].file}`)
  }
}

const missing = TOOLS.filter((tool) => !found[tool])
if (missing.length === 0) process.exit(0)

console.error('')
console.error(`ensure-media-tools FAILED — missing: ${missing.join(', ')}`)
for (const tool of missing) {
  console.error(`${tool}:`)
  for (const entry of candidates(tool)) console.error(`  ${describe(entry)}`)
}
console.error('')
console.error('Both are optional dependencies whose binaries are fetched at install time.')
console.error('Without FFmpeg the app cannot render MP4; without ffprobe nothing it renders')
console.error('can be verified. Every media check in the chain skips rather than passes when')
console.error('they are absent, so this is a failure, not a warning.')
console.error('')
console.error('Fixes, in order of preference:')
console.error('  1. npm rebuild ffmpeg-static ffprobe-static        (on a network that can reach the registries)')
console.error('  2. Install them and set NEWBRAND_FFMPEG_PATH / NEWBRAND_FFPROBE_PATH')
console.error('  3. FFMPEG_BINARIES_URL=<mirror> npm rebuild ffmpeg-static')
process.exit(1)
