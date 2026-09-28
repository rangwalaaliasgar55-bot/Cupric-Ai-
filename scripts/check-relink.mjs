#!/usr/bin/env node
/**
 * JOB 10 gate — relink that relinks.
 *
 * Reopening a project asked you to find every media file, including the ones
 * that had never moved, because the only recovery path was a browser file
 * picker. On the desktop the absolute path is right there in the project.
 *
 * The classifier is pure, so its four states are checked by running it. The
 * desktop half is checked against the real IPC surface, and the web half is
 * checked to be unchanged — an honest box is the correct answer there.
 */
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { transformSync } from 'esbuild'
import { createRequire } from 'node:module'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (rel) => readFile(path.join(root, rel), 'utf8')
const require = createRequire(import.meta.url)

/* Load relink.ts with a stubbed bridge, so both worlds can be simulated. */
async function loadRelink(hasIpc) {
  const src = await read('src/lib/studio/relink.ts')
  const js = transformSync(src.replace(/^import \{ getIpc \}[^\n]*\n/m, ''), { loader: 'ts', format: 'cjs', target: 'es2022' }).code
  const calls = []
  const ipc = hasIpc ? {
    invoke: async (channel, payload) => {
      calls.push({ channel, payload })
      if (channel === 'media:checkPaths') {
        return payload.paths.map((p) => (p.includes('gone') ? { path: p, exists: false } : { path: p, exists: true, sizeBytes: 1024, modifiedMs: 1 }))
      }
      if (channel === 'media:locate') return { path: '/new/place/clip.mp4', fileName: 'clip.mp4', sizeBytes: 2048 }
      return null
    },
  } : null
  const mod = { exports: {} }
  // eslint-disable-next-line no-new-func
  new Function('require', 'module', 'exports', 'getIpc', js)(require, mod, mod.exports, () => ipc)
  return { ...mod.exports, calls }
}

/* ——— 1. desktop: a file that never moved is never asked about ———— */
{
  const R = await loadRelink(true)
  assert.equal(R.canAutoRelink(), true, 'the desktop can check the disk itself')

  const statuses = await R.checkPaths(['/media/a.mp4', '/media/gone.mp4', '/media/a.mp4'])
  assert.equal(R.calls.length, 1, 'one round trip for the whole project, not one per clip')
  assert.deepEqual(R.calls[0].payload.paths, ['/media/a.mp4', '/media/gone.mp4'], 'and duplicate paths are asked about once')

  const present = R.verdictFor({ clipId: 'c1', mediaId: 'm1', fileName: 'a.mp4', localPath: '/media/a.mp4' }, statuses)
  assert.equal(present.state, 'found', 'a file still on disk resolves silently')
  assert.match(R.relinkMessage({ fileName: 'a.mp4' }, present), /still where you left it/, 'and says so rather than demanding action')

  const gone = R.verdictFor({ clipId: 'c2', mediaId: 'm2', fileName: 'gone.mp4', localPath: '/media/gone.mp4' }, statuses)
  assert.equal(gone.state, 'missing', 'a file that moved is reported missing')
  const msg = R.relinkMessage({ fileName: 'gone.mp4' }, gone)
  assert.match(msg, /no longer at \/media\/gone\.mp4/, 'the message names the path it looked in')
  assert.match(msg, /Locate it|remove the clip/, 'and offers both ways out')
  assert.doesNotMatch(msg, /Error|failed|undefined|\[object/i, 'a missing file is not phrased as a crash')

  // A project imported before paths were stored still gets a sane answer.
  const noPath = R.verdictFor({ clipId: 'c3', mediaId: 'm3', fileName: 'old.mp4', localPath: null }, statuses)
  assert.equal(noPath.state, 'no-path')
  assert.match(R.relinkMessage({ fileName: 'old.mp4' }, noPath), /without a folder path/, 'and it explains why, instead of blaming the user')

  const located = await R.locateFile('gone.mp4')
  assert.equal(located.path, '/new/place/clip.mp4', 'Locate returns the newly chosen path')
  assert.equal(R.calls.at(-1).channel, 'media:locate', 'through the native picker, not a browser input')
  assert.equal(R.calls.at(-1).payload.fileName, 'gone.mp4', 'and the dialog is titled with the file being looked for')
}

/* ——— 2. web: the honest box, unchanged ————————————————————————— */
{
  const R = await loadRelink(false)
  assert.equal(R.canAutoRelink(), false, 'a browser has no filesystem to check')
  assert.deepEqual([...(await R.checkPaths(['/media/a.mp4']))], [], 'and no IPC call is attempted')
  const v = R.verdictFor({ clipId: 'c1', mediaId: 'm1', fileName: 'a.mp4', localPath: '/media/a.mp4' }, new Map())
  assert.equal(v.state, 'web', 'the web verdict is its own state, not a fake "missing"')
  const msg = R.relinkMessage({ fileName: 'a.mp4' }, v)
  assert.match(msg, /cannot keep a file handle across a reload/, 'it explains the real browser limitation')
  assert.match(msg, /the desktop app remembers the folder/, 'and says where the better experience is')
}

/* ——— 3. wired end to end ————————————————————————————————————— */
{
  const main = await read('electron/main.cjs')
  assert.match(main, /ipcMain\.handle\('media:checkPaths'/, 'main can check paths')
  assert.match(main, /ipcMain\.handle\('media:locate'/, 'main can open the native picker')
  const check = main.slice(main.indexOf("ipcMain.handle('media:checkPaths'"), main.indexOf("ipcMain.handle('media:locate'"))
  assert.match(check, /paths\.slice\(0, 500\)/, 'the batch is bounded')
  assert.doesNotMatch(check, /readFileSync|createReadStream/, 'existence checking never reads file contents')

  const preload = await read('electron/preload.cjs')
  assert.match(preload, /'media:checkPaths', 'media:locate'/, 'both channels are allowlisted')

  const inspector = await read('src/screens/studio/StudioInspector.tsx')
  assert.match(inspector, /void checkPaths\(\[clip\.localPath\]\)/, 'the inspector checks the real path on mount')
  assert.match(inspector, /clip\.posterDataUrl && \(/, 'a missing clip shows its thumbnail, so you know WHICH clip it is')
  assert.match(inspector, /\{locating \? 'Locating…' : 'Locate…'\}/, 'Locate is offered, with a busy state')
  assert.match(inspector, /Remove clip/, 'and so is removing the clip')
  assert.match(inspector, /relinkMessage\(target, verdict\)/, 'the copy comes from the one classifier, not a second wording')
  assert.match(inspector, /onPatch\(\{ localPath: picked\.path, fileName: picked\.fileName \}/, 'locating writes the new real path back to the project')
}

console.log('JOB 10 check passed — desktop resolves unmoved files with one batched disk check, a missing file gets its thumbnail plus Locate and Remove, and the web keeps the honest box that explains why')
