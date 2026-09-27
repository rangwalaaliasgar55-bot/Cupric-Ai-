#!/usr/bin/env node
/**
 * Untrusted HTML isolation (2.28). Captured scenes can come from third-party
 * packs; they must never run where the desktop bridge (IPC) is reachable.
 * This fails the build if any of those guarantees regress.
 */
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { readFile, readdir, rm } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (p) => readFile(path.join(root, p), 'utf8')

// 1. Every Electron window: sandboxed renderer, isolated context, no Node.
const main = await read('electron/main.cjs')
const windows = [...main.matchAll(/new BrowserWindow\(\{([\s\S]*?)\n\s*\}\)/g)].map((m) => m[1])
assert.ok(windows.length >= 2, 'found the app and capture windows')
for (const w of windows) {
  assert.match(w, /sandbox:\s*true/, 'BrowserWindow without sandbox: true')
  assert.match(w, /contextIsolation:\s*true/, 'BrowserWindow without contextIsolation: true')
  assert.match(w, /nodeIntegration:\s*false/, 'BrowserWindow without nodeIntegration: false')
  assert.ok(!/nodeIntegrationInSubFrames:\s*true/.test(w), 'subframes must not get Node')
  assert.ok(!/webSecurity:\s*false/.test(w), 'webSecurity must stay on')
}
assert.match(main, /setWindowOpenHandler/, 'popups from content are denied')

// 2. The in-app scene capture: opaque-origin sandbox, no DOM reach-through, no network.
const cap = await read('src/lib/studio/htmlTemplateCapture.ts')
assert.match(cap, /setAttribute\('sandbox', 'allow-scripts'\)/, 'scene iframe must be sandboxed')
assert.ok(!/allow-same-origin/.test(cap.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '')), 'allow-same-origin would give the scene the app origin')
assert.ok(!/contentDocument/.test(cap.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '')), 'parent must not reach into the scene DOM')
assert.match(cap, /event\.source !== frame\.contentWindow/, 'replies are accepted only from our frame')

// 3. Arena previews in the UI are sandboxed too.
for (const m of (await read('src/screens/ArenaDesk.tsx')).matchAll(/<iframe[^>]*>/g)) {
  assert.match(m[0], /sandbox="allow-scripts"/, 'Arena preview iframe must be sandboxed')
  assert.ok(!/allow-same-origin/.test(m[0]))
}

// 4. The injected document: CSP first, blocks every network path, works on every bundled scene.
const tmp = path.join(root, '.sandbox-check.mjs')
await build({
  bundle: true, outfile: tmp, format: 'esm', platform: 'node', logLevel: 'warning',
  stdin: { contents: "export { sandboxedSceneDoc, SCENE_CSP } from './src/lib/studio/htmlTemplateCapture'", resolveDir: root, loader: 'ts' },
})
const mod = await import(`${pathToFileURL(tmp).href}?t=${Date.now()}`)
await rm(tmp, { force: true })
for (const directive of ["default-src 'none'", "connect-src 'none'", "frame-src 'none'", "form-action 'none'", "base-uri 'none'"]) {
  assert.ok(mod.SCENE_CSP.includes(directive), `CSP missing ${directive}`)
}
assert.ok(!/unsafe-eval|https?:|\*/.test(mod.SCENE_CSP), 'CSP must not allow eval or remote origins')
const scenes = (await readdir(path.join(root, 'resources/effects'))).filter((f) => f.endsWith('.html'))
assert.ok(scenes.length > 0)
for (const f of scenes) {
  const html = await read(`resources/effects/${f}`)
  const doc = mod.sandboxedSceneDoc(html)
  const cspAt = doc.indexOf('Content-Security-Policy')
  const agentAt = doc.indexOf('<script>(() => {')
  const sceneScriptAt = doc.indexOf('<script', doc.indexOf('</script>', agentAt))
  assert.ok(cspAt > 0 && cspAt < agentAt, `${f}: CSP must be the first thing in <head>`)
  assert.ok(sceneScriptAt === -1 || agentAt < sceneScriptAt, `${f}: CSP + agent must precede scene scripts`)
}
assert.match(mod.sandboxedSceneDoc('<div>x</div>'), /^<!doctype html><html><head><meta http-equiv="Content-Security-Policy"/)
console.log(`sandbox check passed — ${windows.length} sandboxed windows, scene capture isolated (opaque origin, no network), ${scenes.length} bundled scenes wrapped`)
