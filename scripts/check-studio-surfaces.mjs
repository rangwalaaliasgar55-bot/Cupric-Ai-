#!/usr/bin/env node
/**
 * JOB 9 gate — the preview gets the room, and the layers stop fighting.
 *
 * The screenshots showed a 320px inspector that could not be collapsed, five
 * stacked toolbars, a ~270px preview inside a huge empty stage, and a
 * background-jobs panel drawn over the toolbar because it sat at z-[120] —
 * above both the toast lane and the modal lane.
 *
 * The stage-share requirement is arithmetic, so it is checked as arithmetic at
 * the two target widths rather than with a screenshot nobody can reproduce.
 */
import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import { rm } from 'node:fs/promises'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (rel) => readFile(path.join(root, rel), 'utf8')

const tmp = path.join(root, '.studio-surfaces-check.mjs')
await build({
  bundle: true, outfile: tmp, format: 'esm', platform: 'node', logLevel: 'warning',
  stdin: { contents: `export * from './src/lib/studio/panelLayout'`, resolveDir: root, sourcefile: 'check-studio-surfaces.ts', loader: 'ts' },
})
const L = await import(`${pathToFileURL(tmp).href}?t=${Date.now()}`)
await rm(tmp, { force: true })

/* ——— 1. the stage keeps its share at 1120 and 1920 ——————————————— */
{
  const NAV = 56 // the left icon rail
  for (const windowWidth of [1120, 1920]) {
    const collapsed = L.stageWidth({
      windowWidth, navWidth: NAV, inspectorWidth: L.INSPECTOR_DEFAULT,
      inspectorCollapsed: true, componentsOpen: false, proOpen: false,
    })
    assert.ok(
      collapsed.fraction >= 0.6,
      `at ${windowWidth}px with the inspector collapsed the stage gets ${(collapsed.fraction * 100).toFixed(1)}% — the floor is 60%`,
    )

    // Expanded is allowed to be narrower, but never absurd.
    const expanded = L.stageWidth({
      windowWidth, navWidth: NAV, inspectorWidth: L.INSPECTOR_DEFAULT,
      inspectorCollapsed: false, componentsOpen: false, proOpen: false,
    })
    assert.ok(expanded.px >= 640, `at ${windowWidth}px the expanded layout still leaves ${expanded.px}px of stage`)
    assert.ok(collapsed.px > expanded.px, 'collapsing the inspector actually gives the stage more room')
  }

  // The worst realistic case — everything open on a small laptop — must still
  // leave a usable stage rather than the 270px strip in the screenshot.
  const worst = L.stageWidth({
    windowWidth: 1120, navWidth: NAV, inspectorWidth: L.INSPECTOR_MAX,
    inspectorCollapsed: false, componentsOpen: true, proOpen: true,
  })
  assert.ok(worst.px < 200, 'with every panel open at max width the stage IS squeezed — which is why collapsing must exist')
  const rescued = L.stageWidth({
    windowWidth: 1120, navWidth: NAV, inspectorWidth: L.INSPECTOR_MAX,
    inspectorCollapsed: true, componentsOpen: false, proOpen: false,
  })
  assert.ok(rescued.fraction >= 0.6, 'and collapsing rescues it in one click')
}

/* ——— 2. width and collapse survive a restart ————————————————————— */
{
  assert.equal(L.clampInspectorWidth(10), L.INSPECTOR_MIN, 'a silly narrow width is clamped')
  assert.equal(L.clampInspectorWidth(9999), L.INSPECTOR_MAX, 'a silly wide width is clamped')
  assert.equal(L.clampInspectorWidth(Number.NaN), L.INSPECTOR_DEFAULT, 'NaN falls back to the default')
  assert.ok(L.RAIL_WIDTH > 0 && L.RAIL_WIDTH < 80, 'the collapsed rail is a rail, not a panel')

  const studio = await read('src/screens/Studio.tsx')
  assert.match(studio, /useState\(readInspectorCollapsed\)/, 'the collapsed state is restored on mount')
  assert.match(studio, /useState\(readInspectorWidth\)/, 'so is the width')
  assert.match(studio, /writeInspectorCollapsed\(!prev\)/, 'collapsing is persisted')
  assert.match(studio, /writeInspectorWidth\(inspectorWidth\)/, 'and so is a resize, once the drag ends')
  assert.match(studio, /aria-label="Resize the inspector"/, 'the resize handle is reachable and labelled')
  assert.match(studio, /onDoubleClick=\{toggleInspector\}/, 'double-clicking the handle collapses it')
  assert.match(studio, /aria-label="Inspector \(collapsed\)"/, 'the collapsed rail is still announced')
  assert.match(studio, /label="Show the inspector"/, 'and always offers the way back — panels minimise, never disappear')

  // The agent bar — one of the five stacked toolbars — folds away too.
  assert.match(studio, /agentBarCollapsed \?/, 'the agent instruction row can be collapsed')
  assert.match(studio, /Ask Cupric to edit/, 'and folds to a single chip that says what it is')
  assert.match(studio, /localStorage\.setItem\('cupric\.studio\.agentBar'/, 'that choice is remembered')
}

/* ——— 3. one z-lane order, obeyed everywhere ——————————————————— */
{
  assert.ok(L.Z.canvas < L.Z.chrome, 'chrome sits above the canvas')
  assert.ok(L.Z.chrome < L.Z.panel, 'floating panels sit above the chrome')
  assert.ok(L.Z.panel < L.Z.toast, 'toasts sit above every panel')
  assert.ok(L.Z.toast < L.Z.modal, 'and modals sit above the toasts')
  assert.ok(L.Z.modal < L.Z.crash, 'the crash card outranks even a modal — it may be the modal that threw')

  // Nothing may hand-roll a z-index above the toast lane: that is exactly how
  // the background-jobs panel ended up drawn over the toolbar at z-[120].
  async function walk(dir, out = []) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) { if (entry.name !== 'node_modules') await walk(full, out) }
      else if (/\.tsx$/.test(entry.name)) out.push(full)
    }
    return out
  }
  const offenders = []
  for (const file of await walk(path.join(root, 'src'))) {
    const src = await readFile(file, 'utf8')
    for (const m of src.matchAll(/z-\[(\d+)\]/g)) {
      // The crash lane is the single documented exception.
      if (Number(m[1]) > L.Z.toast && Number(m[1]) !== L.Z.crash) offenders.push(`${path.relative(root, file)}: ${m[0]}`)
    }
  }
  assert.deepEqual(offenders, [], `these sit above the toast lane and can cover a toast or fight a modal:\n  ${offenders.join('\n  ')}`)

  // The four surfaces that were fighting now read their lane from one module.
  const toasts = await read('src/components/Toasts.tsx')
  assert.match(toasts, /zIndex: Z\.toast/, 'toasts use the toast lane')
  assert.doesNotMatch(toasts, /z-\[70\]/, 'and no longer hard-code it')
  const status = await read('src/app-shell/StatusCenter.tsx')
  assert.match(status, /zIndex: Z\.panel/, 'background jobs is a panel, below toasts — it used to be z-[120], above everything')
  const menu = await read('src/screens/studio/ClipContextMenu.tsx')
  assert.match(menu, /zIndex: Z\.panel/, 'the clip context menu is a panel')
  const recorder = await read('src/screens/studio/ComponentRecorderHost.tsx')
  assert.match(recorder, /zIndex: Z\.modal/, 'the recorder and its review card are modals')
  const palette = await read('src/app-shell/CommandPalette.tsx')
  assert.match(palette, /zIndex: Z\.modal/, 'the command palette is a modal, not z-[200]')
  const boundary = await read('src/app-shell/ErrorBoundary.tsx')
  assert.match(boundary, /zIndex: Z\.crash/, 'the crash card uses the one documented lane above modals')
}

/* ——— 4. a truncated name still tells you what it is ————————————— */
{
  const timeline = await read('src/screens/studio/StudioTimeline.tsx')
  assert.match(timeline, /className="truncate font-medium text-text" title=\{clip\.name\}/, 'a clipped clip name carries the full name as a tooltip')
}

console.log('JOB 9 check passed — stage keeps ≥60% at 1120px and 1920px with the inspector collapsed, width/collapse persist, 0 z-indexes above the toast lane, truncated names keep their tooltip')
