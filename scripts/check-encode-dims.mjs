#!/usr/bin/env node
/** Regression check for libx264/yuv420p output dimensions. */
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'

const source = await readFile(new URL('../electron/main.cjs', import.meta.url), 'utf8')
const evenInt = source.match(/function evenInt\([\s\S]*?\n}/)?.[0]
const targetSize = source.match(/function targetSizeForAspect\([\s\S]*?\n}/)?.[0]
assert.ok(evenInt && targetSize, 'encode-size helpers must remain defined in electron/main.cjs')

const context = {}
vm.runInNewContext(`${evenInt}\n${targetSize}\nthis.targetSizeForAspect = targetSizeForAspect`, context)
const targetSizeForAspect = context.targetSizeForAspect

for (let n = 240; n <= 4096; n += 1) {
  const width = targetSizeForAspect('custom', [n, 1080])
  const height = targetSizeForAspect('custom', [1920, n])
  assert.equal(width.width % 2, 0, `width ${n} produced odd ${width.width}`)
  assert.equal(height.height % 2, 0, `height ${n} produced odd ${height.height}`)
}
for (const aspect of ['16:9', '9:16', '1:1']) {
  const size = targetSizeForAspect(aspect)
  assert.equal(size.width % 2, 0)
  assert.equal(size.height % 2, 0)
}

// Arena frame sequences: capturePage can return DPI-scaled or screen-clamped
// frames (the 1759×894 failure). The encode must scale+pad to an even target.
const evenFilter = source.match(/function evenFrameFilter\([\s\S]*?\n}/)?.[0]
assert.ok(evenFilter, 'evenFrameFilter must remain defined in electron/main.cjs')
const filterContext = {}
vm.runInNewContext(`${evenInt}\n${evenFilter}\nthis.evenFrameFilter = evenFrameFilter`, filterContext)
for (const [w, h] of [[1759, 894], [1920, 1080], [1081, 1919], [1, 1]]) {
  const filter = filterContext.evenFrameFilter(w, h)
  const [, fw, fh] = filter.match(/pad=(\d+):(\d+)/)
  assert.equal(Number(fw) % 2, 0, `pad width for ${w} must be even`)
  assert.equal(Number(fh) % 2, 0, `pad height for ${h} must be even`)
  assert.match(filter, /force_original_aspect_ratio=decrease/)
  assert.match(filter, /format=yuv420p/)
}
const arena = source.match(/async function renderArenaSegment\([\s\S]*?\n}/)?.[0] ?? ''
assert.match(arena, /exactFrame\(await win\.webContents\.capturePage\(\)/, 'arena frames must be normalised to the target size')
assert.match(arena, /evenFrameFilter\(ctx\.target\.width, ctx\.target\.height\)/, 'arena encode must use the even scale/pad filter')
assert.match(arena, /'-thread_queue_size',\s*'512',\s*'-framerate'/, 'the PNG input needs a larger thread queue')
assert.match(source, /enableLargerThanScreen: true/, 'hidden capture windows must not be clamped to the screen')
/*
 * The Studio MP4 arguments moved out of electron/main.cjs into
 * electron/studio-trim.cjs when the export was cut to the timeline. Grepping
 * main.cjs for the filter text would now pass on a stale copy and fail on a
 * refactor, so the check follows the code: main.cjs must build its MP4 command
 * through the module, and the module's real argv must contain the even-size
 * filter. Asserting on the produced argv is stronger than matching source text —
 * it cannot be satisfied by a comment.
 */
const studioMp4 = source.slice(source.indexOf('async function executeStudioMp4Job'), source.indexOf("ipcMain.handle('media:status'"))
// Both branches fixed this check for the same reason; this is the stronger
// half of the two — the argv the app really hands FFmpeg, not the text of the
// module that builds it (a source match can be satisfied by a comment).
assert.match(studioMp4, /studioTrim\.mp4Args\(/, 'Studio MP4 conversion must build its FFmpeg argv through electron/studio-trim.cjs')
assert.ok(!/'-vf'/.test(studioMp4), 'the Studio MP4 filter chain must live in one place, not a second copy in main.cjs')

const { createRequire } = await import('node:module')
const require = createRequire(import.meta.url)
const studioTrim = require('../electron/studio-trim.cjs')
const argv = studioTrim.mp4Args({ source: 'in.webm', outputPath: 'out.mp4', fps: 30, targetSec: 3, videoArgs: ['-c:v', 'libx264'] })
assert.ok(argv.includes('scale=trunc(iw/2)*2:trunc(ih/2)*2:flags=lanczos,setsar=1'), `Studio MP4 argv must snap odd canvas sizes to even — got ${JSON.stringify(argv)}`)
assert.equal(argv[argv.length - 1], 'out.mp4', 'the output path must be the last argument')
assert.ok(argv.includes('in.webm'), 'the recording must be the input')
// The cut-to-the-timeline argument, checked here as well as in check-studio-trim
// because a missing -t is the difference between a 3-second edit and a 4-second
// file, and this check runs on machines with no FFmpeg.
assert.deepEqual(argv.slice(argv.indexOf('-t'), argv.indexOf('-t') + 2), ['-t', '3.000'], 'the export must be cut to the timeline')

console.log('encode dimensions check passed — every integer size from 240 through 4096 is even-safe, and arena/Studio encodes scale+pad to even frames')
