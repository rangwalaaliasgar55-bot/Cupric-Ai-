/**
 * Bundle budget (F-4).
 *
 * The 0.13.0 build shipped a 4.31MB `index` chunk: every screen, the whole
 * Studio compositor, the Ask panel, the Remotion player and both WASM
 * dependencies were parsed before the window could paint. This check builds
 * the app in memory (nothing is written to disk) and holds three lines:
 *
 *   1. the initial route — the entry chunk of app code — stays under 500kB;
 *   2. the whole eager payload (entry plus the chunks the browser must fetch
 *      before first paint) stays under its ceiling;
 *   3. the known heavyweights are reachable only through dynamic imports, so
 *      a session that never opens a HEIC, a physics clip or a locked rundown
 *      never downloads them.
 *
 * Run: npm run check:bundle
 */
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/** Initial route: the entry chunk of app code. The 0.13.0 number was 4310kB. */
const ENTRY_BUDGET_KB = 500
/** Entry plus every chunk the browser fetches before first paint. */
const EAGER_BUDGET_KB = 700
/** Chunks that must never be in the eager set — each is dynamic-import only. */
const LAZY_ONLY = [
  'vendor-remotion',
  'vendor-rapier',
  'vendor-heic',
  'vendor-lottie',
  'vendor-html2canvas',
  'vendor-three',
]
/** Screens that must each be split into their own chunk (React.lazy). */
const SPLIT_SCREENS = [
  'ArenaDesk', 'Brief', 'FootageDesk', 'Library', 'Render',
  'ReviewRoom', 'Timeline', 'Studio', 'Lab', 'Autonomous', 'MotionEngine',
]

const { build } = await import('vite')
const result = await build({
  configFile: path.join(root, 'vite.config.ts'),
  root,
  logLevel: 'error',
  build: { write: false },
})
const bundles = Array.isArray(result) ? result : [result]
const output = bundles.flatMap((b) => b.output)
const chunks = new Map()
for (const item of output) {
  if (item.type !== 'chunk') continue
  chunks.set(item.fileName, item)
}

const entry = [...chunks.values()].find((c) => c.isEntry)
if (!entry) {
  console.error('bundle budget FAILED: the build produced no entry chunk')
  process.exit(1)
}

/** Chunks the browser must have before first paint: the entry and its static imports. */
const eager = new Set()
const queue = [entry.fileName]
while (queue.length) {
  const name = queue.shift()
  if (eager.has(name)) continue
  eager.add(name)
  for (const next of chunks.get(name)?.imports ?? []) queue.push(next)
}

const sizeOf = (name) => Buffer.byteLength(chunks.get(name)?.code ?? '', 'utf8')
const kb = (bytes) => bytes / 1024
const entryKb = kb(sizeOf(entry.fileName))
const eagerBytes = [...eager].reduce((n, name) => n + sizeOf(name), 0)
const lazyBytes = [...chunks.keys()].filter((n) => !eager.has(n)).reduce((n, name) => n + sizeOf(name), 0)

console.log('bundle budget — chunks the browser needs before first paint\n')
console.log('      size  chunk')
for (const name of [...eager].sort((a, b) => sizeOf(b) - sizeOf(a))) {
  console.log(`  ${kb(sizeOf(name)).toFixed(1).padStart(8)}kB  ${name}${name === entry.fileName ? '  (entry)' : ''}`)
}
console.log(`\n  initial route ${entryKb.toFixed(1)}kB of ${ENTRY_BUDGET_KB}kB`)
console.log(`  eager total   ${kb(eagerBytes).toFixed(1)}kB of ${EAGER_BUDGET_KB}kB across ${eager.size} chunks`)
console.log(`  deferred      ${kb(lazyBytes).toFixed(1)}kB across ${chunks.size - eager.size} chunks, fetched only when used`)

const problems = []
if (entryKb > ENTRY_BUDGET_KB) {
  problems.push(`the initial route is ${entryKb.toFixed(1)}kB, over the ${ENTRY_BUDGET_KB}kB budget`)
}
if (kb(eagerBytes) > EAGER_BUDGET_KB) {
  problems.push(`first paint has to fetch ${kb(eagerBytes).toFixed(1)}kB, over the ${EAGER_BUDGET_KB}kB budget`)
}

for (const heavy of LAZY_ONLY) {
  const hit = [...eager].find((name) => name.includes(heavy))
  if (hit) problems.push(`${heavy} is in the eager set (${hit}) — it must be reached through a dynamic import only`)
  const built = [...chunks.keys()].some((name) => name.includes(heavy))
  if (!built && heavy !== 'vendor-html2canvas') {
    problems.push(`${heavy} was not emitted as its own chunk — check manualChunks in vite.config.ts`)
  }
}

for (const screen of SPLIT_SCREENS) {
  const own = [...chunks.keys()].some((name) => name.startsWith(`assets/${screen}-`) || name.startsWith(`${screen}-`))
  if (!own) problems.push(`${screen} is not in a chunk of its own — it should be a React.lazy screen`)
  if ([...eager].some((name) => name.includes(`/${screen}-`))) {
    problems.push(`${screen} is fetched before first paint`)
  }
}

// The compositor is the largest single graph in the app and belongs to the
// Studio and the export host, never to the shell.
const entryModules = Object.keys(entry.modules ?? {}).map((id) => id.replace(`${root}/`, ''))
for (const forbidden of ['src/lib/studio/renderer.ts', 'src/lib/studio/export.ts', 'src/app-shell/AskPanel.tsx']) {
  if (entryModules.includes(forbidden)) {
    problems.push(`${forbidden} is compiled into the entry chunk — it should load on demand`)
  }
}

if (problems.length) {
  console.error(`\nbundle budget FAILED:\n  - ${problems.join('\n  - ')}`)
  process.exit(1)
}
console.log('\nbundle budget passed')
