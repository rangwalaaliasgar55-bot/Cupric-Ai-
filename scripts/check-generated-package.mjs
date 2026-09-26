#!/usr/bin/env node
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { rm } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import JSZip from 'jszip'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const tmp = path.join(root, '.generated-package-check.mjs')
await build({
  entryPoints: [path.join(root, 'src/lib/studio/generatedPackage.ts')],
  outfile: tmp,
  bundle: true,
  platform: 'node',
  format: 'esm',
  logLevel: 'silent',
})
try {
  const { readGeneratedPackage } = await import(`${pathToFileURL(tmp).href}?t=${Date.now()}`)
  const zip = new JSZip()
  zip.file('project/index.html', '<h1>Launch</h1><img src="assets/hero.png"><video src="./assets/demo.mp4"></video>')
  zip.file('project/assets/hero.png', new Uint8Array([137, 80, 78, 71]))
  zip.file('project/assets/demo.mp4', new Uint8Array([0, 0, 0, 24]))
  zip.file('project/assets/unused.jpg', new Uint8Array([255, 216, 255]))
  const bytes = await zip.generateAsync({ type: 'uint8array' })
  const result = await readGeneratedPackage(new File([bytes], 'project.zip', { type: 'application/zip' }))
  assert.equal(result.name, 'index.html')
  assert.match(result.html, /Launch/)
  assert.deepEqual(result.assets.map((asset) => asset.sourcePath).sort(), ['project/assets/demo.mp4', 'project/assets/hero.png'])
  assert.equal(result.assets[0].file instanceof File, true)

  const html = await readGeneratedPackage(new File(['<h1>Standalone</h1>'], 'scene.html', { type: 'text/html' }))
  assert.equal(html.assets.length, 0)
  assert.match(html.html, /Standalone/)
  console.log('generated package check passed — referenced zip media is extracted as editable Files without executing HTML')
} finally {
  await rm(tmp, { force: true })
}
