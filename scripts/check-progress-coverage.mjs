/**
 * Which lab components can be captured deterministically, and which cannot.
 *
 * A component that runs its own clock — `setInterval`, a self-restarting
 * `requestAnimationFrame`, an infinite WAAPI animation — records whatever it
 * happened to be doing when the frame was grabbed. Driven by `useProgress` /
 * `useDrivenSeconds`, the same time gives the same pixels.
 *
 * This does not pretend the whole library is retrofitted. It prints the real
 * number and lists exactly what is left, so the gap is a fact on a report
 * rather than a vague intention — and it fails if a component that *was*
 * retrofitted quietly goes back to driving itself.
 *
 * Run: npm run check:progress
 */
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const dir = path.join(root, 'src/lab/components')

/** Components already converted. Removing one from here is a regression. */
const RETROFITTED = [
  'word-rotator', 'pixel-loader', 'marquee',
  // Converted in the determinism pass: clocks, timers and physics loops now
  // read the shared clock (useDriverSeconds / useFrameClock) when captured.
  'balance-scale', 'call-widget', 'dynamic-island', 'footer-signature', 'greeting', 'ink-well',
  'logo-orbit', 'mini-clock', 'select-menu', 'spoiler-text', 'storage-meter', 'store-hours',
  'text-scramble', 'typewriter', 'typing-seismograph', 'voice-orb',
]

/** A self-restarting rAF loop, not the one-shot "commit layout" trick. */
const SELF_RAF = /requestAnimationFrame\s*\(\s*(step|tick|loop|frame|draw|animate|render)\b/
const INTERVAL = /setInterval\s*\(/
const INFINITE_WAAPI = /iterations:\s*Infinity/
/** Press-and-hold repeat and debounce timers are not animation clocks. */
const NOT_A_CLOCK = /repeat\.current|holdTimer|debounce|autosave|pointerdown/i

const files = (await readdir(dir)).filter((f) => f.endsWith('.tsx')).sort()

const selfDriven = []
const driven = []

for (const file of files) {
  const id = file.replace(/\.tsx$/, '')
  const source = await readFile(path.join(dir, file), 'utf8')
  const usesDriver = /useProgress|useDrivenSeconds|useDriverSeconds|useFrameClock|useStep|useIsDriven/.test(source)
  const hasOwnClock =
    (SELF_RAF.test(source) || INTERVAL.test(source) || INFINITE_WAAPI.test(source)) && !NOT_A_CLOCK.test(source)

  if (usesDriver) driven.push(id)
  else if (hasOwnClock) selfDriven.push(id)
}

const animated = driven.length + selfDriven.length
const pct = animated ? Math.round((driven.length / animated) * 100) : 100

console.log(`progress coverage — ${driven.length} of ${animated} time-driven components can be captured deterministically (${pct}%)\n`)
console.log(`  driven by the shared clock (${driven.length}):`)
for (const id of driven) console.log(`    ✓ ${id}`)
console.log(`\n  still running their own clock (${selfDriven.length}):`)
for (const id of selfDriven) console.log(`    · ${id}`)
console.log('\n  A component in the second list still works everywhere it is used today.')
console.log('  It simply cannot be guaranteed to look the same in two captures of the same moment.')

// Driven files must not keep an unseeded RNG in their capture path.
const unseeded = []
for (const id of driven) {
  const source = await readFile(path.join(dir, `${id}.tsx`), 'utf8')
  if (/Math\.random\(\)/.test(source) && !/useFrameClock|seededRandom|seededNoise/.test(source)) unseeded.push(id)
}
if (unseeded.length) console.log(`\n  note: driven but still calling Math.random outside a seeded clock: ${unseeded.join(', ')}`)

const regressed = RETROFITTED.filter((id) => !driven.includes(id))
if (regressed.length) {
  console.error(`\nFAILED — these were converted to the shared clock and no longer use it: ${regressed.join(', ')}`)
  process.exit(1)
}
