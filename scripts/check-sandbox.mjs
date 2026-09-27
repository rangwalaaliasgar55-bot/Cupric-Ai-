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
  stdin: { contents: "export { sandboxedSceneDoc, SCENE_CSP, ARENA_SCENE_CSP, inlineBlobAssets } from './src/lib/studio/htmlTemplateCapture'", resolveDir: root, loader: 'ts' },
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
// 5. Web-only Arena paths (thumbnail + browser render) use the same sandbox.
{
  const { execSync } = await import('node:child_process')
  const offenders = execSync(`grep -rln "createElement('iframe')" src || true`, { cwd: root, encoding: 'utf8' }).trim().split('\n').filter(Boolean)
  assert.deepEqual(offenders, ['src/lib/studio/htmlTemplateCapture.ts'], `only the sandbox helper may create iframes, found: ${offenders.join(', ')}`)
  for (const f of ['src/lib/browserMedia.ts', 'src/lib/render.ts']) {
    const t = await read(f)
    assert.ok(t.includes('openSandboxedScene(') && t.includes('ARENA_SCENE_CSP'), `${f} must capture through openSandboxedScene`)
    assert.ok(!/contentDocument|contentWindow|html2canvas/.test(t), `${f} must not reach into a frame's document`)
  }
  assert.ok(mod.ARENA_SCENE_CSP.includes('connect-src data:') && !/https?:|\*|unsafe-eval/.test(mod.ARENA_SCENE_CSP), 'Arena CSP: data: fetch only, no network')
  const blobs = {
    'blob:app/css': new Blob(['.a{background:url(blob:app/png)}</style><script>x</script>'], { type: 'text/css' }),
    'blob:app/js': new Blob(['window.__seek=()=>1;"</script>"'], { type: 'text/javascript' }),
    'blob:app/png': new Blob([new Uint8Array([137, 80, 78, 71])], { type: 'image/png' }),
    'blob:app/json': new Blob(['{"a":1}'], { type: 'application/json' }),
  }
  const out = await mod.inlineBlobAssets(
    `<head><link rel="stylesheet" href="blob:app/css"><script src="blob:app/js"></script></head><img src="blob:app/png"><script>fetch("blob:app/json")</script><img src="blob:app/gone">`,
    async (u) => { if (!blobs[u]) throw new Error('gone'); return blobs[u] },
  )
  assert.ok(out.includes('<style>.a{background:url(data:image/png;base64,iVBORw==)}<\\/style><script>x</script></style>'), 'stylesheet inlined, nested blob → data:, cannot close the tag early')
  assert.ok(/<script\s*>window\.__seek=\(\)=>1;"<\\\/script>"<\/script>/.test(out), 'script inlined safely')
  assert.ok(out.includes('fetch("data:application/json;base64,') && out.includes('src="data:image/png;base64,iVBORw=="'), 'fetch + img refs inlined')
  assert.ok(out.includes('blob:app/gone'), 'unreadable blobs are left alone, not dropped silently')
}
assert.match(mod.sandboxedSceneDoc('<div>x</div>'), /^<!doctype html><html><head><meta http-equiv="Content-Security-Policy"/)
console.log(`sandbox check passed — ${windows.length} sandboxed windows, scene capture isolated (opaque origin, no network), ${scenes.length} bundled scenes wrapped`)
