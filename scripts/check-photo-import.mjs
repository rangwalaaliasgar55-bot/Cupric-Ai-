#!/usr/bin/env node
/**
 * Phone-photo import (2.30) and photo proxies (2.25): HEIC detection, EXIF
 * orientation parsing, proxy sizing, and the preview/export split.
 */
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { readFile, rm } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const tmp = path.join(root, '.photo-import-check.mjs')
await build({
  bundle: true, outfile: tmp, format: 'esm', platform: 'node', logLevel: 'warning', external: ['heic2any'],
  stdin: { contents: "export * from './src/lib/studio/photoImport'", resolveDir: root, loader: 'ts' },
})
const p = await import(`${pathToFileURL(tmp).href}?t=${Date.now()}`)
await rm(tmp, { force: true })

/** Minimal JPEG: SOI, APP1 Exif with one IFD0 entry (Orientation), EOI. */
function jpegWithOrientation(value, little = true) {
  const tiff = []
  const u16 = (v) => (little ? [v & 255, v >> 8] : [v >> 8, v & 255])
  const u32 = (v) => (little ? [v & 255, (v >> 8) & 255, (v >> 16) & 255, v >>> 24] : [v >>> 24, (v >> 16) & 255, (v >> 8) & 255, v & 255])
  tiff.push(...(little ? [0x49, 0x49] : [0x4d, 0x4d]), ...u16(42), ...u32(8))
  tiff.push(...u16(1)) // one entry
  tiff.push(...u16(0x0112), ...u16(3), ...u32(1), ...u16(value), 0, 0)
  tiff.push(...u32(0))
  const exif = [0x45, 0x78, 0x69, 0x66, 0, 0, ...tiff]
  const len = exif.length + 2
  return new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0, 0xff, 0xe1, len >> 8, len & 255, ...exif, 0xff, 0xd9]).buffer
}
for (const v of [1, 3, 6, 8, 2, 5]) {
  assert.equal(p.readExifOrientation(jpegWithOrientation(v, true)), v, `little-endian orientation ${v}`)
  assert.equal(p.readExifOrientation(jpegWithOrientation(v, false)), v, `big-endian orientation ${v}`)
}
assert.equal(p.readExifOrientation(new Uint8Array([0x89, 0x50, 0x4e, 0x47]).buffer), 1, 'PNG → upright')
assert.equal(p.readExifOrientation(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]).buffer), 1, 'JPEG without EXIF → upright')
assert.equal(p.readExifOrientation(jpegWithOrientation(6).slice(0, 30)), 1, 'truncated EXIF never throws')
assert.equal(p.orientationSwapsAxes(6), true)
assert.equal(p.orientationSwapsAxes(3), false)

const ftyp = (major, compat = []) => {
  const s = `\0\0\0\x18ftyp${major}\0\0\0\0${compat.join('')}`
  return Uint8Array.from(s, (c) => c.charCodeAt(0))
}
assert.equal(p.isHeicBytes(ftyp('heic')), true, 'iPhone HEIC')
assert.equal(p.isHeicBytes(ftyp('mif1', ['heic'])), true, 'HEIF with heic compat brand')
assert.equal(p.isHeicBytes(ftyp('isom', ['mp41'])), false, 'MP4 is not HEIC')
assert.equal(p.isHeicBytes(new Uint8Array([0xff, 0xd8, 0xff])), false)
assert.equal(p.looksLikeHeicName('IMG_0001.HEIC'), true)
assert.equal(p.looksLikeHeicName('x.jpg', 'image/heif'), true)
assert.equal(p.looksLikeHeicName('x.jpg', 'image/jpeg'), false)

assert.deepEqual(p.proxySize(4032, 3024), [1600, 1200], '12 MP phone photo → 1600 px proxy')
assert.deepEqual(p.proxySize(3024, 4032), [1200, 1600])
assert.equal(p.proxySize(1600, 900), null, 'small photos are not proxied')
assert.equal(p.proxySize(0, 0), null)

// Wiring: HEIC reaches the photo path; preview draws the proxy, export the original.
const media = await readFile(path.join(root, 'src/lib/studio/media.ts'), 'utf8')
assert.match(media, /heic\|heif/, 'picker regex accepts .heic/.heif')
assert.match(media, /convertHeic\(/)
assert.match(media, /preparePhoto\(/)
const sources = await readFile(path.join(root, 'src/lib/studio/sources.ts'), 'utf8')
assert.match(sources, /drawableElement\(clip\.mediaId, 'preview'\)/, 'preview uses proxies')
const exporter = await readFile(path.join(root, 'src/lib/studio/export.ts'), 'utf8')
assert.ok(!/drawableElement\(clip\.mediaId, 'preview'\)/.test(exporter), 'export must draw full-resolution originals')
const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'))
assert.ok(pkg.dependencies.heic2any, 'HEIC converter is a dependency')
console.log('photo import check passed — HEIC detection, EXIF orientation (both byte orders), proxy sizing, preview/export split')
