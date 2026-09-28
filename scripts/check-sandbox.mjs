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

/* ——— F-2: the project-data path allowlist ————————————————————————————
 * Production log: `[render-queue-error] 'arena:previewPath': Preview path is
 * outside Cupric AI project data { jobId: 'studio-export-*' }` — seven jobs,
 * one batch. Two root causes, both asserted here: too few roots, and a raw
 * string prefix that cannot see through Windows case / 8.3 / junctions.
 */
{
  const { createRequire } = await import('node:module')
  const require = createRequire(import.meta.url)
  const sandbox = require('../electron/path-sandbox.cjs')

  // 1. Every directory Cupric writes media into is a root — and userData
  //    itself never is (settings.json lives there).
  for (const dir of ['projects', 'renders', 'proxies', 'stock-cache', 'automation', 'agent-generated', 'voice-tmp']) {
    assert.ok(sandbox.PROJECT_DATA_DIRS.includes(dir), `${dir} must be inside the project-data sandbox`)
  }
  assert.ok(!sandbox.PROJECT_DATA_DIRS.some((d) => !d || d === '.' || d === '/' || d === ''), 'the userData root is never a root')
  assert.match(main, /function projectDataRoots\(\)/, 'main builds the roots from one list')
  assert.match(main, /pathSandbox\.PROJECT_DATA_DIRS\.map/, 'main uses the shared list, not a second copy')
  assert.doesNotMatch(main, /Preview path is outside Cupric AI project data/, 'the bare rejection string is gone')
  assert.match(main, /resolveProjectDataPath\(localPath\)/, 'arena:previewPath goes through the canonicalising resolver')
  assert.match(main, /PATH_OUTSIDE_PROJECT_DATA/, 'a refusal is a typed, explainable error')
  assert.match(main, /ipcMain\.handle\('path:reveal'/, 'a refused path can be revealed in one click')

  // 2. A real export batch: renders/<jobId>/ and projects/<id>/arena/<assetId>/
  //    must both resolve INSIDE, on both platforms.
  const winRoot = 'C:\\Users\\Aliasgar Rangwala\\AppData\\Roaming\\Cupric AI'
  const winRoots = sandbox.PROJECT_DATA_DIRS.map((d) => `${winRoot}\\${d}`)
  const inside = (p, opts = {}) => sandbox.resolveInsideRoots(p, winRoots, { platform: 'win32', ...opts }).ok
  assert.ok(inside(`${winRoot}\\renders\\studio-export-1a2b3c\\cupric-studio.mp4`), 'a finished render is inside project data')
  assert.ok(inside(`${winRoot}\\projects\\default\\arena\\asset-42\\index.html`), 'an imported Arena asset is inside project data')
  assert.ok(inside(`${winRoot}\\projects\\default\\footage\\1730000000-clip.mp4`), 'imported footage is inside project data')
  assert.ok(inside(`${winRoot}\\proxies\\9f8e7d.mp4`), 'an editing proxy is inside project data')

  // 3. Windows spellings of the SAME file: mixed case, 8.3 short names and a
  //    junction. All three used to read as "outside".
  const shortNames = new Map([
    ['C:\\Users\\ALIASG~1\\AppData\\Roaming\\CUPRIC~1', winRoot],
    ['c:\\users\\aliasgar rangwala\\appdata\\roaming\\cupric ai', winRoot],
    ['D:\\Redirected\\Cupric AI', winRoot],
  ])
  const realpath = (p) => {
    for (const [short, long] of shortNames) {
      if (p.toLowerCase() === short.toLowerCase()) return long
      if (p.toLowerCase().startsWith(`${short.toLowerCase()}\\`)) return `${long}${p.slice(short.length)}`
    }
    return p
  }
  assert.ok(inside('C:\\Users\\ALIASG~1\\AppData\\Roaming\\CUPRIC~1\\renders\\studio-export-7\\out.mp4', { realpath }), '8.3 short names resolve inside')
  assert.ok(inside('c:\\users\\aliasgar rangwala\\appdata\\roaming\\cupric ai\\RENDERS\\Studio-Export-7\\OUT.MP4', { realpath }), 'mixed case resolves inside')
  assert.ok(inside('D:\\Redirected\\Cupric AI\\projects\\p1\\arena\\a1\\index.html', { realpath }), 'a junction/symlinked userData resolves inside')
  assert.equal(
    sandbox.canonicalize('C:\\Users\\ALIASG~1\\AppData\\Roaming\\CUPRIC~1\\renders\\job\\new-file.mp4', { realpath, platform: 'win32' }),
    `${winRoot}\\renders\\job\\new-file.mp4`,
    'a not-yet-written render target canonicalises via its deepest existing ancestor',
  )

  // 4. Containment is still real: no prefix tricks, no traversal, no siblings.
  assert.ok(!inside('C:\\Users\\Aliasgar Rangwala\\Desktop\\secret.mp4'), 'a desktop file is outside')
  assert.ok(!inside(`${winRoot}\\settings.json`), 'settings.json (keys) is never previewable')
  assert.ok(!inside(`${winRoot}\\renders-private\\x.mp4`), 'a sibling with the same prefix is outside')
  assert.ok(!inside(`${winRoot}\\renders\\..\\settings.json`), 'traversal out of a root is outside')
  assert.ok(!sandbox.isInside('/home/u/.config/Cupric AI/rendersX', '/home/u/.config/Cupric AI/renders', { platform: 'linux' }), 'POSIX prefix sibling is outside')
  assert.ok(!sandbox.isInside('/home/u/.config/Cupric AI/RENDERS/x', '/home/u/.config/Cupric AI/renders', { platform: 'linux' }), 'POSIX stays case-sensitive')
  assert.ok(sandbox.isInside('/home/u/.config/Cupric AI/renders/x', '/home/u/.config/Cupric AI/renders', { platform: 'linux' }))

  // 5. A refusal is a sentence a person can act on, naming the path.
  const refused = sandbox.outsideMessage('C:\\Users\\A\\Desktop\\clip.mp4', winRoots)
  assert.ok(refused.includes('C:\\Users\\A\\Desktop\\clip.mp4'), 'the message names the file')
  assert.ok(/renders/.test(refused) && /Reveal folder/i.test(refused), 'the message says where files may live and offers reveal')

  // 6. An export batch never dies because one clip is unreadable.
  assert.match(main, /export-asset-skipped/, 'an unusable export asset is logged and skipped')
  const bg = main.slice(main.indexOf('async function executeStudioBackgroundJob'), main.indexOf("ipcMain.handle('studio:submitRecording'"))
  assert.match(bg, /resolveProjectDataPath\(asset\.localPath\)/, 'the main process resolves asset URLs where the roots are known')
  assert.match(bg, /unusable: verdict\.message/, 'a refused asset carries its reason to the renderer')
  // F-4 moved the offscreen export host behind a dynamic import; the skip rule
  // travelled with it, so the assertions follow the code.
  const renderMain = await read('src/main.tsx')
  assert.match(renderMain, /backgroundExportHost/, 'the renderer hands background export jobs to the export host')
  const exportHost = await read('src/lib/studio/backgroundExportHost.ts')
  assert.match(exportHost, /if \(!asset\.localPath \|\| asset\.unusable\) continue/, 'the renderer skips unusable assets instead of failing the job')
  assert.match(exportHost, /asset\.url \|\|/, 'the renderer prefers the pre-resolved URL')
  assert.match(exportHost, /export-asset-skipped/, 'a skipped asset is logged with its reason')
  const preview = await read('src/lib/previewPath.ts')
  assert.match(preview, /path:reveal/, 'the renderer can reveal a refused path')
  assert.match(await read('src/components/VideoPreview.tsx'), /Reveal folder/, 'a refused preview offers Reveal folder inline')
}
console.log('F-2 check passed — 7 project-data roots, Windows case/8.3/junction normalisation, honest refusals with reveal, export batches survive one bad clip')
