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
const studioMp4 = source.slice(source.indexOf('async function executeStudioMp4Job'), source.indexOf("ipcMain.handle('media:status'"))
assert.match(studioMp4, /scale=trunc\(iw\/2\)\*2:trunc\(ih\/2\)\*2/, 'Studio MP4 conversion must snap odd canvas sizes to even')

console.log('encode dimensions check passed — every integer size from 240 through 4096 is even-safe, and arena/Studio encodes scale+pad to even frames')
