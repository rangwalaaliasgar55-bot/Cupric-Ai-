#!/usr/bin/env node
/**
 * ensure-ffmpeg.mjs — make sure this checkout can really encode.
 *
 * Why this exists: `ffmpeg-static` is an **optional** dependency, and unlike
 * `ffprobe-static` (which bundles its binaries inside the npm tarball), it
 * downloads its binary in a postinstall script. When that download fails, npm
 * removes the optional dependency *silently* — no error, no warning in the
 * install summary — and the app then cannot render MP4 at all. The build chain
 * still passes, because most checks skip FFmpeg-dependent work when it is
 * absent; the first real signal would be a user whose export fails.
 *
 * The first Windows CI run of the PR gate found exactly this: `ffprobe: ok`,
 * `ffmpeg: no`. A Windows verification run without FFmpeg verifies nothing about
 * rendering, so the workflows call this before the chain.
 *
 * It never pretends. Each strategy prints what it tried and what happened, and
 * the exit code is non-zero when no FFmpeg could be obtained — which is a build
 * failure for CI and a clear message for a developer.
 *
 *   npm run ffmpeg:ensure
 *   CUPRIC_FFMPEG_PATH=/path/to/ffmpeg npm run ffmpeg:ensure
 */
import { existsSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const isWindows = process.platform === 'win32'
const exe = isWindows ? 'ffmpeg.exe' : 'ffmpeg'

/** Every place FFmpeg could legitimately be, in the order the app checks them. */
function candidates() {
  const list = []
  if (process.env.CUPRIC_FFMPEG_PATH) list.push(['CUPRIC_FFMPEG_PATH', process.env.CUPRIC_FFMPEG_PATH])
  if (process.env.FFMPEG_PATH) list.push(['FFMPEG_PATH', process.env.FFMPEG_PATH])
  try {
    const resolved = require('ffmpeg-static')
    list.push(['ffmpeg-static module', typeof resolved === 'string' ? resolved : resolved?.path])
  } catch (error) {
    list.push(['ffmpeg-static module', null, `require threw: ${error?.code || error?.message}`])
  }
  const which = spawnSync(isWindows ? 'where' : 'which', ['ffmpeg'], { encoding: 'utf8' })
  const onPath = which.status === 0 ? String(which.stdout).split(/\r?\n/).map((l) => l.trim()).filter(Boolean)[0] : null
  list.push(['PATH', onPath])
  list.push(['repo-local unpack', path.join(root, 'node_modules', 'ffmpeg-static', exe)])
  return list
}

function describe(entry) {
  const [source, file, note] = entry
  if (note) return `${source}: ${note}`
  if (!file) return `${source}: not configured`
  try {
    const stat = statSync(file)
    return `${source}: ${file} (${(stat.size / 1e6).toFixed(1)} MB)`
  } catch {
    return `${source}: ${file} — NOT PRESENT`
  }
}

function found() {
  for (const entry of candidates()) {
    const file = entry[1]
    if (file && existsSync(file)) return { file, source: entry[0] }
  }
  return null
}

console.log(`ensure-ffmpeg: looking for a ${isWindows ? 'Windows' : process.platform} FFmpeg`)

let hit = found()
if (hit) {
  console.log(`  ✓ ${hit.source}: ${hit.file}`)
  process.exit(0)
}

console.log('  · not found yet. Candidates checked:')
for (const entry of candidates()) console.log(`      ${describe(entry)}`)

/**
 * Strategy 1 — ask npm to run the package's install script again.
 *
 * `npm rebuild` re-runs postinstall for an already-installed package. If the
 * package is missing entirely (npm removed it after a failed optional install),
 * it does nothing, which is why there is a second strategy.
 */
console.log('  · strategy 1: npm rebuild ffmpeg-static (re-runs its download script)')
const rebuild = spawnSync('npm', ['rebuild', 'ffmpeg-static'], { cwd: root, encoding: 'utf8', shell: isWindows })
process.stdout.write((rebuild.stdout || '').split('\n').map((l) => (l ? `      ${l}\n` : '')).join(''))
if (rebuild.status !== 0) console.log(`      npm rebuild exited ${rebuild.status}: ${(rebuild.stderr || '').trim().split('\n').slice(-3).join(' ')}`)
hit = found()
if (hit) {
  console.log(`  ✓ after rebuild — ${hit.source}: ${hit.file}`)
  process.exit(0)
}

/**
 * Strategy 2 — install it again, without touching the lockfile.
 *
 * `--no-save` keeps package.json and package-lock.json exactly as committed: a
 * missing binary is a problem with this machine's network, not with the project.
 */
console.log('  · strategy 2: npm install ffmpeg-static --no-save (re-runs the download)')
const install = spawnSync('npm', ['install', 'ffmpeg-static', '--no-save', '--no-audit', '--no-fund'], { cwd: root, encoding: 'utf8', shell: isWindows })
process.stdout.write((install.stdout || '').split('\n').slice(-12).map((l) => (l ? `      ${l}\n` : '')).join(''))
if (install.status !== 0) console.log(`      npm install exited ${install.status}: ${(install.stderr || '').trim().split('\n').slice(-3).join(' ')}`)
hit = found()
if (hit) {
  console.log(`  ✓ after install — ${hit.source}: ${hit.file}`)
  process.exit(0)
}

console.error('')
console.error('ensure-ffmpeg FAILED — no FFmpeg binary could be obtained.')
console.error('Candidates checked:')
for (const entry of candidates()) console.error(`  ${describe(entry)}`)
console.error('')
console.error('FFmpeg is an optional dependency whose binary is downloaded at install time.')
console.error('Without it Cupric AI cannot render MP4, and every render check in the chain')
console.error('skips rather than passes — so this is a failure, not a warning.')
console.error('')
console.error('Fixes, in order of preference:')
console.error('  1. npm rebuild ffmpeg-static            (on a network that can reach GitHub releases)')
console.error('  2. Install FFmpeg and set CUPRIC_FFMPEG_PATH to ffmpeg.exe')
console.error('  3. FFMPEG_BINARIES_URL=<mirror> npm rebuild ffmpeg-static')
process.exit(1)
