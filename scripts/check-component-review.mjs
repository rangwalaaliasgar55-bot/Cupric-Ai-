#!/usr/bin/env node
/**
 * JOB 6 gate — nothing lands on the timeline unreviewed, and component text
 * belongs to the user.
 *
 * The screenshot showed a recording modal that dropped its result straight
 * onto the timeline the moment capture ended, and a "Hold to delete" pill
 * whose words were a hard-coded string. Both are checked here: the review step
 * and its three outcomes on the UI side, and the editable text props by
 * actually running the prop validator.
 */
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import { rm } from 'node:fs/promises'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (rel) => readFile(path.join(root, rel), 'utf8')

/* ——— 1. the recorder reviews before it applies ————————————————— */
{
  const host = await read('src/screens/studio/ComponentRecorderHost.tsx')

  assert.match(host, /phase === 'review' && review/, 'there is a review phase between capture and the timeline')
  assert.match(host, /type RecordingReview = \{/, 'the finished recording is held as reviewable data')

  // The preview card shows first / middle / last frame, duration and size.
  assert.match(host, /\['First frame', review\.first\], \['Middle', review\.mid\], \['Last frame', review\.last\]/, 'the card shows first, middle and last frames')
  assert.match(host, /review\.durationSec\}s/, 'the card states the duration')
  assert.match(host, /review\.width\}×\{review\.height\}/, 'the card states the pixel size')
  assert.match(host, /prettyBytes\(review\.bytes\)/, 'the card states how heavy it is')

  // Three outcomes, and only one of them touches the timeline.
  const reviewCard = host.slice(host.indexOf("if (phase === 'review'"), host.indexOf('  return (\n    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/45 p-4 backdrop-blur-[2px]" role="dialog" aria-label={`Recording'))
  assert.match(reviewCard, /onClick=\{onDiscard\}/, 'Discard is offered')
  assert.match(reviewCard, /onClick=\{\(\) => onShelve\(review\.patch\)\}/, 'Save to shelf is offered')
  assert.match(reviewCard, /onClick=\{\(\) => onDone\(review\.patch\)\}/, 'Apply is offered')
  assert.match(reviewCard, /Apply at \{clip\.startSec\.toFixed\(1\)\}s/, 'Apply says exactly where it will land')

  // Auto-insert survives, but only if the user asks for it.
  assert.match(host, /const AUTO_APPLY_KEY = 'cupric\.componentRecorder\.autoApply'/, 'the auto-insert preference is persisted')
  assert.match(host, /return localStorage\.getItem\(AUTO_APPLY_KEY\) === '1'/, 'auto-insert is OFF unless explicitly enabled')
  assert.match(host, /if \(readAutoApply\(\)\) \{ onDone\(patch\); return \}/, 'auto-insert is checked before the review is shown')
  assert.match(host, /Apply future recordings automatically/, 'and the review card is where you turn it on')

  // The capture path must not still call onDone unconditionally.
  const capture = host.slice(host.indexOf("setPhase('finishing')"), host.indexOf('} catch (error)'))
  const unconditionalApply = capture.match(/onDone\(/g) || []
  assert.equal(unconditionalApply.length, 1, 'the only onDone in the capture path is the opt-in auto-apply branch')
}

/* ——— 2. the store can shelve and discard without an undo step ————— */
{
  const store = await read('src/state/useProjectStore.ts')
  assert.match(store, /shelveComponentRecording: \(pid, clipId, patch\) =>\s*\n\s*applyBackground/, 'shelving is a background write, like landing is')
  assert.match(store, /discardComponentRecording: \(pid, clipId\) =>\s*\n\s*applyBackground/, 'discarding is a background write')
  const shelve = store.slice(store.indexOf('shelveComponentRecording: (pid, clipId, patch)'), store.indexOf('/** JOB 6 — discard'))
  assert.match(shelve, /clips: doc\.clips\.filter\(\(c\) => c\.id !== clipId\)/, 'shelving takes the clip OFF the timeline')
  assert.match(shelve, /shelf:/, 'and puts it on the shelf')
  const discard = store.slice(store.indexOf('discardComponentRecording: (pid, clipId)'), store.indexOf('addStudioClip: (pid, clip)'))
  assert.match(discard, /clips: doc\.clips\.filter\(\(c\) => c\.id !== clipId\)/, 'discard removes it from the timeline')
  assert.match(discard, /shelf: doc\.shelf\.filter\(\(c\) => c\.id !== clipId\)/, 'and from the shelf')
}

/* ——— 3. component text is a real editable prop ————————————————— */
{
  const tmp = path.join(root, '.component-review-check.mjs')
  await build({
    bundle: true, outfile: tmp, format: 'esm', platform: 'node', logLevel: 'warning',
    stdin: {
      contents: `
        export { validateComponentProps, componentPropsSummary } from './src/lib/studio/components'
        export { PROP_CONFIGS } from './src/lab/propConfigs'
      `,
      resolveDir: root, sourcefile: 'check-component-review.ts', loader: 'ts',
    },
  })
  const mod = await import(`${pathToFileURL(tmp).href}?t=${Date.now()}`)
  await rm(tmp, { force: true })

  // The pill from the screenshot now has settable words.
  const cfg = mod.PROP_CONFIGS['hold-to-delete']
  assert.ok(cfg, '"hold-to-delete" has a prop config, so the inspector can edit it')
  assert.equal(cfg.controls.label.type, 'text', 'the button text is an editable text field')
  assert.equal(cfg.controls.label.default, 'Hold to delete', 'its default is the text it always had')
  assert.equal(cfg.controls.doneLabel.type, 'text', 'the completed-state text is editable too')

  const ok = mod.validateComponentProps('hold-to-delete', { label: 'Hold to remove this shot', doneLabel: 'Removed' })
  assert.equal(ok.label, 'Hold to remove this shot', 'custom text validates and is kept verbatim')
  assert.equal(ok.doneLabel, 'Removed')
  assert.throws(() => mod.validateComponentProps('hold-to-delete', { nope: 'x' }), /has no prop/, 'unknown props are refused with a readable reason')
  assert.match(mod.componentPropsSummary('hold-to-delete'), /label/, 'the agent is told the prop exists, so asking Cupric works too')

  // The component actually reads them.
  const src = await read('src/lab/components/hold-to-delete.tsx')
  assert.match(src, /useDemoProps/, 'the component reads per-clip props')
  assert.match(src, /\{labels\.label\}/, 'and renders the custom text instead of a literal')
  assert.match(src, /\{labels\.doneLabel\}/, 'including the completed state')
  assert.doesNotMatch(src.slice(src.indexOf('function Label')), />\s*Hold to delete\s*</, 'the hard-coded string is gone from the render path')

  // Re-recording keeps the custom text: props live on the clip's component
  // meta, and the recorder hands that same object back on every pass.
  const host = await read('src/screens/studio/ComponentRecorderHost.tsx')
  assert.match(host, /props=\{meta\.props\}/, 'the recorder renders the component with the clip\'s own props')
  assert.match(host, /component: \{ \.\.\.meta, status: 'ready', error: undefined \}/, 'and the finished patch preserves meta — including props — so a re-record keeps custom text')
}

console.log('JOB 6 check passed — recordings wait in a first/middle/last review card with Apply / Save to shelf / Discard, auto-insert is opt-in and persisted, and component text is an editable prop that survives a re-record')
