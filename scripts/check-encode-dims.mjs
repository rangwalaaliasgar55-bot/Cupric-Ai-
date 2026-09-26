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

console.log('encode dimensions check passed — every integer size from 240 through 4096 is even-safe')
