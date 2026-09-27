#!/usr/bin/env node
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { rm } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import JSZip from 'jszip'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const tmp = path.join(root, '.generated-package-check.mjs')
const tmpImport = path.join(root, '.generated-import-check.mjs')
await build({
  entryPoints: [path.join(root, 'src/lib/studio/generatedPackage.ts')],
  outfile: tmp,
  bundle: true,
  platform: 'node',
  format: 'esm',
  logLevel: 'silent',
})
await build({
  entryPoints: [path.join(root, 'src/lib/studio/importHtml.ts')],
  outfile: tmpImport,
  bundle: true,
  platform: 'node',
  format: 'esm',
  logLevel: 'silent',
})
try {
  const { readGeneratedPackage } = await import(`${pathToFileURL(tmp).href}?t=${Date.now()}`)
  const { parseGeneratedHtml } = await import(`${pathToFileURL(tmpImport).href}?t=${Date.now()}`)
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
  // A cinematic brand film: canvas-only index.html, storyboard in js/scenes.js
  // under an uppercase name with headline/sub keys and millisecond timings.
  // This is the shape that used to fail with "no readable scene manifest".
  const film = new JSZip()
  film.file('cupric-film/index.html', '<!doctype html><html><head><title>Cupric AI — Brand Film</title></head><body><canvas id="stage"></canvas><script src="js/scenes.js"></script><script src="js/main.js"></script></body></html>')
  film.file('cupric-film/js/scenes.js', "export const SCENES = [\n  { headline: 'Cupric AI', sub: 'The editor that thinks in motion', start: 0, end: 3200 },\n  { headline: `Every cut, directed`, start: 3200, end: 6400, animation: 'word stagger' }, // comment\n  { headline: 'Start free today', start: 6400, end: 9000 },\n];")
  film.file('cupric-film/js/main.js', 'const ctx = document.getElementById("stage").getContext("2d"); ctx.drawImage(new Image(), 0, 0); const src = "media/logo.png";')
  film.file('cupric-film/media/logo.png', new Uint8Array([137, 80, 78, 71]))
  film.file('cupric-film/node_modules/junk/index.js', 'const scenes = [{ copy: "wrong" }]')
  const filmPkg = await readGeneratedPackage(new File([await film.generateAsync({ type: 'uint8array' })], 'Cupric-ai-cinematic-brand-film (1).zip'))
  assert.match(filmPkg.scripts, /SCENES/)
  assert.doesNotMatch(filmPkg.scripts, /wrong/, 'node_modules must be skipped')
  assert.deepEqual(filmPkg.assets.map((a) => a.sourcePath), ['cupric-film/media/logo.png'], 'media referenced only from JS is still found')
  const filmPiece = parseGeneratedHtml(filmPkg.html, { scripts: filmPkg.scripts, name: 'Cupric-ai-cinematic-brand-film (1).zip' })
  assert.equal(filmPiece.via, 'scene-array')
  assert.deepEqual(filmPiece.scenes.filter((s) => s.role !== 'sub').map((s) => s.copy), ['Cupric AI', 'Every cut, directed', 'Start free today'])
  assert.equal(filmPiece.scenes.find((s) => s.role === 'sub')?.copy, 'The editor that thinks in motion')
  assert.equal(filmPiece.durationSec, 9, 'millisecond timings are converted to seconds')

  // Copy only inside JSX components.
  const jsx = parseGeneratedHtml('<div id="root"></div>', { scripts: '/* src/App.tsx */\nexport default () => <main><h1 className="hero">Meet {name} Cupric</h1><p>Edit at the speed of thought</p></main>', name: 'app.zip' })
  assert.equal(jsx.via, 'headings')
  assert.equal(jsx.scenes.length, 2)

  // Timed markup.
  const timed = parseGeneratedHtml('<section data-start="0" data-end="2"><h2>One</h2></section><section data-start="2" data-duration="3"><h2>Two</h2></section>')
  assert.equal(timed.via, 'timed-markup')
  assert.equal(timed.durationSec, 5)

  // Nothing readable at all still imports as a renameable title card.
  const bare = parseGeneratedHtml('<canvas></canvas><script>requestAnimationFrame(()=>{})</script>', { name: 'cupric-ai-cinematic-brand-film (1).zip' })
  assert.equal(bare.via, 'title')
  assert.equal(bare.scenes[0].copy, 'Cupric AI Cinematic Brand Film')
  assert.equal(parseGeneratedHtml('<html></html>'), null, 'without a name an empty page is still null')

  // A zip with no HTML at all (just a storyboard and media) is accepted.
  const noHtml = new JSZip()
  noHtml.file('storyboard.json', JSON.stringify({ beats: [{ title: 'Hello', duration: 2 }, { title: 'World', duration: 2 }] }))
  const noHtmlPkg = await readGeneratedPackage(new File([await noHtml.generateAsync({ type: 'uint8array' })], 'story.zip'))
  const noHtmlPiece = parseGeneratedHtml(noHtmlPkg.html, { scripts: noHtmlPkg.scripts, name: 'story.zip' })
  assert.deepEqual(noHtmlPiece.scenes.map((s) => s.copy), ['Hello', 'World'])

  console.log('generated package check passed — zip media and scenes are recovered from HTML, scripts, JSX and JSON without executing anything; unreadable packages still import as a title card')
} finally {
  await rm(tmp, { force: true })
  await rm(tmpImport, { force: true })
}
