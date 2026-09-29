#!/usr/bin/env node
/**
 * Phase 3, as a build gate.
 *
 * The UI work in this phase is mostly *adoption*: tokens that already existed,
 * a focus ring that already existed, an `EmptyState` that already worked. Work
 * like that regresses silently — a new screen ships with a hardcoded colour, a
 * slider loses its tab stop, a card loses its label — because nothing fails.
 *
 * So this check asserts the properties that a human reviewer would have to
 * notice by hand:
 *   1. one design system: no stray hex colours, no second icon set, no `outline:
 *      none` that removes the focus ring;
 *   2. every screen has a state story: loading, and an error with a way out;
 *   3. the timeline is reachable without a mouse and says where the playhead is;
 *   4. first-run onboarding exists, is wired, and goes somewhere;
 *   5. the two desks explain themselves in the app;
 *   6. no dead-end buttons: destructive actions confirm, installs report failure.
 *
 * Everything here is a structural assertion over source the app actually ships.
 * Nothing is mocked, and the check fails loudly by naming the file and line.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { readdir } from 'node:fs/promises'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (rel) => readFileSync(path.join(root, rel), 'utf8')
let n = 0
const ok = (condition, message) => { assert.ok(condition, message); n++ }
/** Line number of the first match, for a failure message a person can act on. */
const lineOf = (text, needle) => text.split('\n').findIndex((l) => l.includes(needle)) + 1

// ── 1. one design system ─────────────────────────────────────────────────────
const styles = read('src/styles.css')
for (const token of ['--color-bg', '--color-panel', '--color-line', '--color-text', '--color-muted', '--color-accent', '--radius', '--shadow-1', '--ease-soft']) {
  ok(styles.includes(token), `styles.css defines ${token}`)
}
ok(/:focus-visible/.test(styles) && /box-shadow/.test(styles), 'styles.css keeps a visible focus ring')
/**
 * An `outline: none` is allowed only where the same rule shows focus another
 * way. `.cu-input:focus` replaces the ring with an accent border, which is a
 * real indicator; a bare `outline: none` would be a keyboard user losing their
 * place entirely.
 */
{
  const css = styles.replace(/\/\*[\s\S]*?\*\//g, '')
  const offenders = []
  for (const match of css.matchAll(/outline:\s*none/g)) {
    const ruleStart = css.lastIndexOf('{', match.index)
    const selectorStart = Math.max(css.lastIndexOf('}', ruleStart), css.lastIndexOf('{', ruleStart - 1))
    const rule = css.slice(selectorStart + 1, css.indexOf('}', match.index))
    if (!/box-shadow|border-color/.test(rule)) offenders.push(rule.trim().split('\n')[0])
  }
  ok(offenders.length === 0, `every outline:none has another focus indicator (found ${offenders.join(' | ') || 'none'})`)
}

const screensDir = path.join(root, 'src/screens')
const screenFiles = (await readdir(screensDir)).filter((f) => f.endsWith('.tsx'))
ok(screenFiles.length >= 10, `the screens directory holds the app's screens (found ${screenFiles.length})`)

/**
 * Hardcoded colours where they matter: in styling.
 *
 * A hex inside a preset's palette array is data — the swatches it renders — and
 * belongs there. A hex inside `className`, `style`, `fill` or `stroke` is a
 * colour that escaped the token set, and that is how a design system dies one
 * screen at a time. Only the second kind is checked.
 */
const STYLING_ATTR = /(?:className|style|fill|stroke|color)\s*=\s*(?:"([^"]*)"|\{\{?([^}]*)\}\}?)/g
function strayColours(text) {
  const found = new Set()
  for (const match of text.matchAll(STYLING_ATTR)) {
    const value = match[1] ?? match[2] ?? ''
    for (const hex of value.matchAll(/#[0-9a-fA-F]{3,8}\b/g)) found.add(hex[0].toLowerCase())
  }
  return [...found]
}
const componentFiles = (await readdir(path.join(root, 'src/components'))).filter((f) => f.endsWith('.tsx'))
for (const file of screenFiles.map((f) => `src/screens/${f}`).concat(componentFiles.map((f) => `src/components/${f}`))) {
  const stray = strayColours(read(file))
  ok(stray.length === 0, `${file} styles with tokens, not hex (found ${stray.join(', ') || 'none'})`)
}

// One icon set. lucide-react is the app's; a second set would double the bundle
// and the visual language.
const iconImports = new Set()
for (const file of [...screenFiles.map((f) => `src/screens/${f}`), ...componentFiles.map((f) => `src/components/${f}`)]) {
  for (const m of read(file).matchAll(/from '(lucide-react|@(?:heroicons|radix-ui\/react-icons|iconify)[^']*)'/g)) iconImports.add(m[1])
}
ok([...iconImports].every((name) => name === 'lucide-react'), `only lucide-react is used for icons (found ${[...iconImports].join(', ')})`)
ok(iconImports.has('lucide-react'), 'lucide-react is the icon set in use')

// ── 2. the four states ───────────────────────────────────────────────────────
const states = read('src/components/ScreenStates.tsx')
ok(/export function LoadingState/.test(states) && /export function ErrorState/.test(states) && /export function ScreenState/.test(states), 'the state kit exports loading, error and the wrapper')
ok(/pct = null/.test(states) && /aria-busy="true"/.test(states), 'LoadingState takes an optional real percentage and announces itself')
ok(/Number\.isFinite/.test(states), 'LoadingState refuses to render a percentage that is not a number')
ok(/onRetry/.test(states) && /nextStep/.test(states), 'ErrorState offers a retry or an explicit next step')
ok(/role="alert"/.test(states), 'ErrorState announces itself as an alert')
ok(/<details/.test(states), 'technical detail is available but collapsed')
ok(/motion-reduce:animate-none/.test(states), 'loading motion respects prefers-reduced-motion')

const emptyState = read('src/components/EmptyState.tsx')
ok(/action/.test(emptyState), 'EmptyState still takes an action, so an empty screen is never a dead end')

// ── 3. the timeline without a mouse ──────────────────────────────────────────
const timeline = read('src/screens/Timeline.tsx')
ok(/role="slider"/.test(timeline), 'the ruler is a slider')
const sliderBlock = timeline.slice(timeline.indexOf('role="slider"'), timeline.indexOf('role="slider"') + 1400)
ok(/tabIndex=\{0\}/.test(sliderBlock), 'the playhead slider is focusable (tabIndex 0), not skipped by Tab')
ok(/ArrowLeft/.test(sliderBlock) && /ArrowRight/.test(sliderBlock), 'arrow keys move the playhead')
ok(/Home/.test(sliderBlock) && /End/.test(sliderBlock), 'Home and End jump to the ends')
ok(/aria-valuetext/.test(sliderBlock), 'the slider reads out a time, not a bare number')
ok(/aria-keyshortcuts/.test(sliderBlock), 'the keys it accepts are declared')
ok(!/role="slider"[\s\S]{0,400}tabIndex=\{-1\}/.test(timeline), 'the slider is not excluded from the tab order')
ok(/role="list"/.test(timeline) && /role="listitem"/.test(timeline), 'clips are a list, so their order is conveyed')
ok(/aria-live="polite"/.test(timeline), 'the timeline has one live region for what the picture cannot say')
ok(/aria-keyshortcuts="Alt\+ArrowLeft Alt\+ArrowRight Delete Enter"/.test(timeline), 'clip keys are declared on the clip')
ok(/data-clip-index/.test(timeline), 'clips carry a stable index for tests and for the label')

// ── 4. first-run onboarding ──────────────────────────────────────────────────
const onboarding = read('src/lib/onboarding.ts')
ok(/ONBOARDING_CONCEPTS/.test(onboarding) && /ONBOARDING_KEY/.test(onboarding), 'the onboarding copy and its memory live in one module')
for (const id of ['studio', 'autonomous', 'arena', 'footage']) {
  ok(new RegExp(`id: '${id}'`).test(onboarding), `the tour explains ${id}`)
}
ok(/export function shouldShowOnboarding/.test(onboarding) && /projectsExist/.test(onboarding), 'the tour knows not to greet an existing project')
ok(/try \{[\s\S]*?\} catch/.test(onboarding), 'storage access is guarded, so a locked profile cannot crash the shell')
const dialog = read('src/app-shell/Onboarding.tsx')
ok(/role="dialog"/.test(dialog) && /aria-modal="true"/.test(dialog), 'the tour is a real modal')
ok(/Escape/.test(dialog) && /'Tab'/.test(dialog), 'the modal closes on Escape and holds focus inside')
ok(/data-onboarding-card=/.test(dialog), 'each concept is a card the E2E suite can find')
ok(/setView\(concept\.action\)/.test(dialog), 'every card navigates somewhere')
ok(!/disabled=/.test(dialog), 'dismissing the tour is never blocked')
const layout = read('src/app-shell/AppLayout.tsx')
ok(/<Onboarding /.test(layout), 'the tour is mounted in the shell')
ok(/useOnboarding\(/.test(layout), 'the shell decides whether to show it')
const palette = read('src/app-shell/CommandPalette.tsx')
ok(/Quick tour of Cupric/.test(palette), 'the tour can be reopened from the command palette')

// ── 5. the desks explain themselves ──────────────────────────────────────────
const purpose = read('src/components/ScreenPurpose.tsx')
ok(/data-screen-purpose/.test(purpose), 'the purpose block is identifiable')
ok(/localStorage/.test(purpose), 'a dismissed purpose block stays dismissed')
for (const [id, file] of [['arena', 'src/screens/ArenaDesk.tsx'], ['footage', 'src/screens/FootageDesk.tsx']]) {
  const text = read(file)
  ok(new RegExp(`<ScreenPurpose`).test(text) && new RegExp(`id="${id}"`).test(text), `${file} explains what ${id} is for`)
  const block = text.slice(text.indexOf('<ScreenPurpose'), text.indexOf('<ScreenPurpose') + 700)
  ok(/what="/.test(block) && /next="/.test(block), `${file}'s explanation says what it is for and what to do first`)
}

// ── 6. no dead ends ──────────────────────────────────────────────────────────
const home = read('src/screens/HomeProject.tsx')
ok(/armed|confirm/i.test(home), 'deleting a project still asks first')
const readiness = read('src/app-shell/ReadinessPanel.tsx')
ok(/installVoiceEngine/.test(readiness), 'a missing speech engine offers the real download')
ok(/progressFraction|progressLabel/.test(readiness), 'the download reports progress rather than a spinner')
ok(/result\.ok/.test(readiness) || /\.ok === false/.test(readiness), 'a failed install is branched on, not assumed to have worked')
const installer = read('electron/voice-install.cjs')
ok(/\.part`/.test(installer) || /\.part'/.test(installer) || /partial/.test(installer), 'a download writes to a partial file and renames it when complete')
ok(/expect/.test(installer) && /existsSync/.test(installer), 'the installer verifies the files it claims to have installed')
ok(/safeEntryTarget/.test(installer), 'archive extraction validates every entry path')
ok(!/process\.env\.CUPRIC_FAKE|simulate|mockSuccess/i.test(installer), 'the installer contains no simulated-success path')

console.log(`phase3 ui: ${n} assertions passed`)
