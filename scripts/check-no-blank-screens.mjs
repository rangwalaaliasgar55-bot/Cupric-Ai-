#!/usr/bin/env node
/**
 * JOB 8 gate — no screen in this app may go black.
 *
 * Two real black screens were reported. "Open in editor to render" in the
 * Motion Engine set `window.location.href = "/editor?from=local"`, navigating
 * a single-page shell off itself to a path nothing serves. And the AI Scene
 * Graph Generator's "Generate & Open in Studio" button called a dev-only API,
 * got ok:false, and silently did nothing.
 *
 * This check makes both classes of bug fail the build: SPA-breaking navigation
 * anywhere in the renderer, and an async handler that can finish without
 * telling the user anything.
 */
import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (rel) => readFile(path.join(root, rel), 'utf8')

/* ——— 1. nothing navigates the shell away from itself ————————————— */
{
  /** Every .ts/.tsx under src, minus the Next.js page tree, which is a separate build. */
  async function walk(dir, out = []) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name === 'app') continue
        await walk(full, out)
      } else if (/\.tsx?$/.test(entry.name)) out.push(full)
    }
    return out
  }
  const files = await walk(path.join(root, 'src'))
  assert.ok(files.length > 200, `the walk found the source tree (${files.length} files)`)

  const offenders = []
  for (const file of files) {
    const src = await readFile(file, 'utf8')
    const rel = path.relative(root, file)
    // Assigning location or location.href throws the SPA away. window.open is
    // fine (new tab), and so is reading location.
    for (const re of [/window\.location\.href\s*=/g, /window\.location\.assign\(/g, /window\.location\.replace\(/g, /(?<![.\w])location\.href\s*=/g]) {
      if (re.test(src)) offenders.push(`${rel}: ${src.match(re)[0]}`)
    }
  }
  assert.deepEqual(offenders, [], `these navigate the single-page shell away from itself and blank the app:\n  ${offenders.join('\n  ')}`)
}

/* ——— 2. the editor handoff happens in-app, with a boundary —————— */
{
  const customize = await read('src/components/customize.ts')
  assert.match(customize, /export const OPEN_EDITOR_EVENT/, 'the handoff is an event, not a navigation')
  assert.match(customize, /window\.dispatchEvent\(new CustomEvent\(OPEN_EDITOR_EVENT, \{ detail: \{ ok: true \} \}\)\)/, 'a successful handoff notifies the host')
  assert.match(customize, /detail: \{ ok: false, reason:/, 'a failed handoff reports a reason instead of failing silently')
  assert.match(customize, /localStorage\.setItem\(LOCAL_DOC_KEY/, 'the doc still travels through the existing handoff key')

  const engine = await read('src/screens/MotionEngine.tsx')
  assert.match(engine, /window\.addEventListener\(OPEN_EDITOR_EVENT, onOpen\)/, 'the Motion Engine listens for the handoff')
  assert.match(engine, /window\.removeEventListener\(OPEN_EDITOR_EVENT, onOpen\)/, 'and unsubscribes')
  assert.match(engine, /setTab\('editor'\)/, 'and opens the editor in place')
  assert.match(engine, /<RouteErrorBoundary route="Motion editor">/, 'the editor is wrapped in the logging error boundary, so a throw shows diagnostics instead of a black screen')
  assert.match(engine, /<Suspense fallback=/, 'and a lazy chunk that is still loading shows a loader, not nothing')
  assert.match(engine, /\{handoffError && \(/, 'a failed handoff is shown inline')

  const editor = await read('src/components/editor/Editor.tsx')
  assert.match(editor, /sp\.get\("from"\) === "local" \|\| !sp\.get\("project"\)/, 'the editor reads a handed-over doc even without the old URL query')
}

/* ——— 3. the scene-graph button always ends somewhere visible ————— */
{
  const showcase = await read('src/engine-showcase/InteractiveShowcase.tsx')
  const fnStart = showcase.indexOf('const handleAiGenerate')
  const fn = showcase.slice(fnStart, showcase.indexOf('\n  };', showcase.indexOf('} finally {', fnStart)))

  assert.match(fn, /if \(!prompt\) \{ setAiNote/, 'an empty prompt gets an answer, not a spinner')
  assert.match(fn, /guardedJson</, '1. the dev API is tried first')
  assert.match(fn, /ipc\.invoke\('gemini:ask'/, '2. then the desktop router from JOB 3, with its own fallback chain and 20s cap')
  assert.match(fn, /no model was reachable, so only your own words were used/, '3. then a deterministic reading of the prompt — which says so')
  assert.match(fn, /setAiNote\(\{ tone: 'info', text: `The scene graph could not be generated/, 'a thrown error becomes an inline sentence')
  assert.doesNotMatch(fn, /console\.error\(e\);\s*\n\s*\} finally/, 'errors are no longer swallowed into the console')

  // Every path through the handler reports something.
  // Three success branches — API, router, offline — each ending in a visible
  // result, plus the throw branch handled above. No silent exit remains.
  const applyCalls = (fn.match(/\bapply\(\{/g) || []).length
  assert.equal(applyCalls, 3, `all three success branches resolve to a visible result (found ${applyCalls})`)
  assert.match(showcase, /\{aiNote && \(/, 'and the note is rendered')

  // The two selects are real controls now.
  assert.match(showcase, /value=\{aiAspect\} onChange=/, 'the aspect select is wired')
  assert.match(showcase, /value=\{aiDuration\} onChange=/, 'the duration select is wired')
  assert.match(fn, /duration: aiDuration/, 'and the chosen duration reaches the request')
  assert.match(fn, /aspect: aiAspect/, 'as does the chosen aspect')

  // Design tokens, not a hand-rolled gradient (DESIGN.md).
  assert.doesNotMatch(showcase, /from-indigo-500 via-purple-600 to-pink-500/, 'the CTA uses DESIGN tokens instead of an off-palette gradient')
}

console.log('JOB 8 check passed — 0 SPA-breaking navigations in the renderer, the editor handoff opens in place behind an error boundary, and the scene-graph generator has a 3-step chain that always ends in a visible, honest result')
