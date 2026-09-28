#!/usr/bin/env node
import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const root = new URL('../', import.meta.url)
const pkg = JSON.parse(await readFile(new URL('package.json', root), 'utf8'))
const index = JSON.parse(await readFile(new URL('resources/packs/index.json', root), 'utf8'))
assert.equal(index.version, pkg.version, 'bundled pack index must match the application version')
assert.equal(index.packs.length, 24, 'all 24 resource packs must be indexed')
let total = 0
for (const entry of index.packs) {
  const pack = JSON.parse(await readFile(new URL(`resources/packs/${entry.id}.json`, root), 'utf8'))
  assert.equal(pack.version, pkg.version, `${entry.id} pack version must match the app`)
  assert.equal(pack.items.length, entry.itemCount, `${entry.id} item count must match the index`)
  total += pack.items.length
}
assert.equal(total, 4095, 'the complete resource catalogue must be bundled')
const tdev = JSON.parse(await readFile(new URL('resources/packs/transitions-dev.json', root), 'utf8'))
assert.equal(tdev.items.length, 14, 'Transitions.dev: 2 thinking-state + 12 matrix loader presets')
assert.ok(tdev.items.every((item) => item.data?.nativeAction === 'loader' && item.data?.deterministicExport && item.data?.source === 'https://transitions.dev'), 'Transitions.dev loaders apply natively with attribution')
const ul = JSON.parse(await readFile(new URL('resources/packs/uselayouts.json', root), 'utf8'))
assert.equal(ul.items.length, 64, 'uselayouts: the complete 64-item upstream catalogue')
assert.ok(ul.items.every((item) => item.data?.audit && item.data?.category && item.data?.attribution?.includes('MIT')), 'every uselayouts item carries its audit, category and MIT attribution')
const dashi = JSON.parse(await readFile(new URL('resources/packs/dashi-motion.json', root), 'utf8'))
assert.equal(dashi.items.length, 10, 'all dashi-motion distilled skills must be indexed')
assert.equal(dashi.source, 'https://github.com/chuspeeism/dashi-motion', 'dashi-motion attribution source must be retained')
assert.match(dashi.license, /No upstream license declared/i, 'dashi-motion must retain its no-license boundary')
assert.ok(dashi.items.every((item) => item.kind === 'skill' && item.data?.nativeRendererOnly && item.data?.referencePath), 'dashi skills must stay reference-only and native-renderer guided')
const duo = JSON.parse(await readFile(new URL('resources/packs/iphone-duo.json', root), 'utf8'))
assert.equal(duo.items.length, 11, 'iPhone Duo must contain its 10 skills and native apply action')
assert.equal(duo.items.filter((item) => item.kind === 'skill').length, 10, 'all iPhone Duo skills must be indexed')
const duoAction = duo.items.find((item) => item.data?.nativeAction === 'phoneDesign')
assert.ok(duoAction && duoAction.kind === 'component' && duoAction.data?.design === 'iphone-duo' && duoAction.data?.editable && duoAction.data?.agentUsable, 'iPhone Duo must apply as an editable Studio action')
assert.ok(duoAction.data?.assetPolicy?.includes('not bundled'), 'Apple assets must remain excluded')
const dashiNotice = await readFile(new URL('resources/dashi-motion/UPSTREAM-NOTICE.md', root), 'utf8')
assert.match(dashiNotice, /does not declare a software license/i, 'dashi-motion must preserve its no-license notice')
const duoNotice = await readFile(new URL('resources/iphone-duo/ATTRIBUTION.md', root), 'utf8')
assert.match(duoNotice, /Apple.*not bundled/i, 'iPhone Duo must preserve the Apple asset boundary')
const opus = JSON.parse(await readFile(new URL('resources/packs/opus55.json', root), 'utf8'))
assert.equal(opus.items.length, 312, 'the Opus catalogue must contain 300 cases plus 12 playbook rules')
assert.equal(opus.items.filter((item) => item.kind === 'source').length, 300, 'all Opus case studies must remain searchable')
assert.equal(opus.items.filter((item) => item.kind === 'skill').length, 12, 'all Opus playbook rules must be indexed')
assert.equal(opus.source, 'https://github.com/chuspeeism/awesome-opus-5-5-videos', 'Opus attribution source must be retained')
assert.match(opus.license, /MIT/i, 'Opus catalogue license must be retained')
assert.ok(opus.items.filter((item) => item.kind === 'source').every((item) => item.data?.provider === 'awesome-opus-5-5-videos' && item.data?.sourceUrl && Array.isArray(item.data?.githubVideos)), 'Opus case links and provider metadata must be retained')
assert.ok(opus.items.filter((item) => item.kind === 'source').every((item) => item.data?.mediaPolicy?.includes('third-party')), 'Opus media must remain link-only with rights guidance')
assert.ok(opus.items.filter((item) => item.kind === 'skill').every((item) => item.data?.nativeRendererOnly && item.data?.instruction), 'Opus playbook rules must be native-renderer guidance')
const uselayouts = JSON.parse(await readFile(new URL('resources/packs/uselayouts.json', root), 'utf8'))
assert.equal(uselayouts.items.length, 64, 'all uselayouts components must be indexed')
assert.equal(uselayouts.source, 'https://github.com/iurvish/uselayouts', 'uselayouts attribution source must be retained')
assert.match(uselayouts.license, /MIT/i, 'uselayouts license must be retained')
assert.ok(uselayouts.items.every((item) => item.data?.provider === 'uselayouts' && item.data?.editable && item.data?.agentUsable && Array.isArray(item.data?.sourceFiles) && item.data.sourceFiles.length), 'every uselayouts item must retain source files and editable metadata')
assert.ok(uselayouts.items.every((item) => item.data?.license === 'MIT'), 'every uselayouts item must retain MIT attribution')
const reactBits = JSON.parse(await readFile(new URL('resources/packs/react-bits.json', root), 'utf8'))
const skiper = JSON.parse(await readFile(new URL('resources/packs/skiper-ui.json', root), 'utf8'))
const remotion = JSON.parse(await readFile(new URL('resources/packs/remotion.json', root), 'utf8'))
{
  const fonts = remotion.items.filter((item) => item.kind === 'font')
  assert.equal(fonts.length, 1852, 'every loadable Google font from the Remotion catalogue must be listed')
  assert.ok(fonts.every((item) => typeof item.data?.family === 'string' && item.data.family && Array.isArray(item.data?.weights) && item.data.weights.length), 'fonts must carry the family and weights Apply downloads')
}
assert.equal(reactBits.items.length, 209, 'all current React Bits references must be indexed')
assert.ok(reactBits.items.every((item) => item.kind === 'saas-template' && item.data?.editable && item.data?.agentUsable), 'every React Bits reference must have an editable native storyboard')
assert.ok(reactBits.items.every((item) => item.data?.sourceCopied === false && item.data?.intake === 'original-native-storyboard'), 'Commons-Clause React Bits source must not be redistributed or represented as copied')
assert.ok(reactBits.items.every((item) => item.data?.attribution === 'React Bits · David Haz'), 'React Bits references must retain attribution')
assert.equal(skiper.items.length, 106, 'all supplied Skiper UI entries must be indexed')
assert.ok(skiper.items.every((item) => item.data?.attribution?.includes('Skiper UI')), 'Skiper adaptations must retain attribution')
assert.ok(skiper.items.every((item) => item.data?.editable && item.data?.agentUsable), 'Skiper storyboards must be editable and agent-usable')
assert.equal(remotion.items.filter((item) => item.id.startsWith('package-')).length, 137, 'all current Remotion packages must be indexed')
assert.ok(remotion.items.filter((item) => item.id.startsWith('package-')).every((item) => item.kind === 'saas-template' && item.data?.editable && item.tags?.includes('license-review')), 'Remotion packages must be usable native storyboards and retain the license-review gate')
assert.ok(remotion.items.filter((item) => item.id.startsWith('template-')).every((item) => item.kind === 'saas-template' && item.data?.editable), 'Remotion templates must be usable in Studio instead of copy-only cards')
const uiLibs = JSON.parse(await readFile(new URL('resources/packs/ui-libraries.json', root), 'utf8'))
for (const provider of ['mantine', 'pixel-perfect', 'sora-ui']) assert.ok(uiLibs.items.some((item) => item.data?.provider === provider), `${provider} must be registered`)
assert.ok(uiLibs.items.every((item) => item.data?.attribution && item.data?.license && item.data?.motionRole), 'UI library entries carry attribution, license and a motion role')
assert.ok(uiLibs.items.filter((item) => item.data?.provider !== 'mantine').every((item) => /link|not copied/i.test(item.data.license)), 'unlicensed libraries are link-only')
assert.ok(uiLibs.items.some((item) => item.id === 'sora-ui-infinite-scrolling-images' && item.data.nativeMotion === 'scroll-driven'), 'Soralabs infinite scroll keeps its scroll-driven motion')
const panel = JSON.parse(await readFile(new URL('resources/packs/panelui.json', root), 'utf8'))
assert.ok(panel.items.every((item) => item.kind === 'saas-template' && item.data?.editable && item.data?.agentUsable), 'PanelUI entries must create editable native storyboards')

const packsSource = await readFile(new URL('src/lib/packs.ts', root), 'utf8')
assert.match(packsSource, /PACKS_BRANCH = 'main'/, 'network fallback must use the stable branch')
assert.ok(
  packsSource.indexOf("fetchLocal<PackIndex>('index')") < packsSource.indexOf("idbGet<PackIndex>('index')"),
  'bundled index must win over stale IndexedDB data',
)
assert.ok(
  packsSource.indexOf('fetchLocal<Pack>(id)') < packsSource.indexOf('idbGet<Pack>(id)'),
  'bundled packs must win over stale IndexedDB data',
)
assert.match(JSON.stringify(pkg.build.files), /resources\/\*\*\/\*/, 'desktop release must package the resources tree')
const studio = await readFile(new URL('src/screens/Studio.tsx', root), 'utf8')
assert.match(studio, /<PackBrowser \/>/, 'Studio must mount the same resource browser as Library')
assert.match(studio, /All Library resources/, 'Studio resource drawer must be discoverable')

// Every pack has unique item ids (React keys, apply-by-id, finder results).
for (const entry of index.packs) {
  const p = JSON.parse(await readFile(new URL(`resources/packs/${entry.id}.json`, root), 'utf8'))
  const seen = new Set()
  for (const item of p.items) { assert.ok(!seen.has(item.id), `duplicate id ${entry.id}/${item.id}`); seen.add(item.id) }
}
const ess = JSON.parse(await readFile(new URL('resources/packs/essentials.json', root), 'utf8'))
for (const id of ['framer-motion', 'gsap', 'font-inter', 'font-geist', 'font-satoshi', 'simple-icons', 'logo-dev', 'lucide']) {
  const it = ess.items.find((x) => x.id === id)
  assert.ok(it && /^https:\/\//.test(it.data.url) && it.data.license, `essentials must include ${id} with url + license`)
}
console.log(`resource check passed — ${index.packs.length} bundled packs, ${total} items, shared by Library and Studio`)

/* ——— F-3: no renderer fetch may reject ————————————————————————————————
 * Production log: `(renderer-console) TypeError: Failed to fetch` ×8 inside
 * one minute — a packaged app asking `file://` for `/resources/packs/*.json`,
 * five dead localhost `/models` probes, a stock/updater poll. Every renderer
 * network read now goes through `src/lib/net.ts`, which resolves a verdict and
 * never rejects, and every caller has a cache or an explicit placeholder.
 */
{
  const { build } = await import('esbuild')
  const { rm } = await import('node:fs/promises')
  const { pathToFileURL } = await import('node:url')
  const nodePath = await import('node:path')
  // fileURLToPath, never URL.pathname: on Windows the latter yields
  // "/C:/..." with a leading slash, which resolves to a path that does not
  // exist, and execSync/esbuild then fail with an unhelpful ENOENT.
  const rootDir = nodePath.default.resolve(nodePath.default.dirname(fileURLToPath(import.meta.url)), '..')

  // 1. Nothing outside net.ts (and the vendored `src/lab` showcase source,
  //    which is display-only code) may call fetch directly.
  // Walked in Node rather than shelled out to grep: the release runs on
  // windows-latest, where shell quoting for an -E pattern with alternation
  // and parentheses is a coin flip, and `|| true` is not cmd syntax.
  const walk = async (dir) => {
    const out = []
    for (const e of await readdir(nodePath.default.join(rootDir, dir), { withFileTypes: true })) {
      const rel = `${dir}/${e.name}`
      if (e.isDirectory()) out.push(...await walk(rel))
      else if (/\.tsx?$/.test(e.name)) out.push(rel)
    }
    return out
  }
  const FETCH_CALL = /(await|=|return|void)\s+fetch\(/
  const offenders = []
  for (const file of await walk('src')) {
    if (file === 'src/lib/net.ts' || file.startsWith('src/lab/')) continue
    if (FETCH_CALL.test(await readFile(nodePath.default.join(rootDir, file), 'utf8'))) offenders.push(file)
  }
  assert.deepEqual(offenders, [], `every renderer network read must go through src/lib/net.ts, found: ${offenders.join(', ')}`)

  // 2. The guard's contract, exercised for real.
  const tmp = nodePath.default.join(rootDir, '.net-check.mjs')
  await build({
    bundle: true, outfile: tmp, format: 'esm', platform: 'node', logLevel: 'warning',
    stdin: { contents: "export * from './src/lib/net'", resolveDir: rootDir, loader: 'ts' },
  })
  const net = await import(`${pathToFileURL(tmp).href}?t=${Date.now()}`)
  await rm(tmp, { force: true })

  // `navigator` is a getter-only global in Node 22, so patch by descriptor.
  const withGlobals = async (patch, fn) => {
    const saved = Object.fromEntries(Object.keys(patch).map((k) => [k, Object.getOwnPropertyDescriptor(globalThis, k)]))
    for (const [k, v] of Object.entries(patch)) Object.defineProperty(globalThis, k, { value: v, configurable: true, writable: true })
    try {
      return await fn()
    } finally {
      for (const [k, descriptor] of Object.entries(saved)) {
        if (descriptor) Object.defineProperty(globalThis, k, descriptor)
        else delete globalThis[k]
      }
    }
  }

  // Wifi off: no request is even attempted, and the caller is told plainly.
  const offline = await withGlobals(
    { navigator: { onLine: false }, fetch: () => { throw new Error('must not be called when offline') } },
    () => net.guardedJson('https://example.com/models'),
  )
  assert.equal(offline.ok, false)
  assert.equal(offline.offline, true)
  assert.equal(offline.expected, true, 'offline is an expected state, not an error to shout about')
  assert.equal(offline.reason, net.OFFLINE_REASON)

  // Same-origin/bundled reads still run with the wifi off — that is exactly
  // what has to keep the Library alive.
  const bundled = await withGlobals(
    { navigator: { onLine: false }, fetch: async () => ({ ok: true, status: 200, json: async () => ({ packs: [] }) }) },
    () => net.guardedJson('/resources/packs/index.json', { allowOffline: true }),
  )
  assert.ok(bundled.ok && bundled.data.packs, 'bundled packs load offline')

  // A dead localhost /models probe: a verdict, never a rejection.
  const refused = await withGlobals(
    { navigator: { onLine: true }, fetch: async () => { throw new TypeError('Failed to fetch') } },
    () => net.guardedJson('http://localhost:11434/v1/models'),
  )
  assert.equal(refused.ok, false)
  assert.ok(!/Failed to fetch/.test(refused.reason), 'the raw TypeError never reaches a user')
  assert.match(refused.reason, /could not be reached — Cupric used what it already has\./)

  // Non-2xx is a failure, so no caller parses a 404 page as JSON.
  const notFound = await withGlobals(
    { navigator: { onLine: true }, fetch: async () => ({ ok: false, status: 404, statusText: 'Not Found' }) },
    () => net.guardedJson('https://example.com/nope.json'),
  )
  assert.equal(notFound.ok, false)
  assert.equal(notFound.status, 404)
  assert.equal(notFound.expected, true)

  // A body that is not JSON is a verdict too.
  const badBody = await withGlobals(
    { navigator: { onLine: true }, fetch: async () => ({ ok: true, status: 200, json: async () => { throw new SyntaxError('Unexpected token <') } }) },
    () => net.guardedJson('https://example.com/html-instead.json'),
  )
  assert.equal(badBody.ok, false)

  // Every helper resolves — nothing in this module can produce an unhandled
  // rejection, whatever fetch does.
  for (const helper of ['guardedFetch', 'guardedJson', 'guardedText', 'guardedBlob']) {
    const result = await withGlobals(
      { navigator: { onLine: true }, fetch: async () => { throw new Error('boom') } },
      () => net[helper]('https://example.com/x'),
    )
    assert.equal(result.ok, false, `${helper} resolves instead of rejecting`)
    assert.ok(typeof result.reason === 'string' && result.reason.length > 0, `${helper} explains itself`)
  }
  // A timeout aborts rather than holding a socket open.
  const aborted = await withGlobals(
    { navigator: { onLine: true }, fetch: (_url, init) => new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))) },
    () => net.guardedFetch('https://example.com/slow', { timeoutMs: 30 }),
  )
  assert.equal(aborted.ok, false)
  assert.match(aborted.reason, /did not answer in time/)

  // 3. The offline UI: the Library works from what it has, and says so.
  const packs = await readFile(new URL('src/lib/packs.ts', root), 'utf8')
  assert.match(packs, /guardedJson</, 'pack reads go through the guard')
  assert.ok(packs.includes("fetchJson<T>(`/resources/packs/${name}.json`, 4000, true)"), 'bundled pack reads are allowed offline')
  const browser = await readFile(new URL('src/screens/library/PackBrowser.tsx', root), 'utf8')
  assert.match(browser, /offline — cached copy/, 'a cached catalogue is labelled with a stale dot')
  assert.match(browser, /Everything already downloaded still works/, 'a failed pack load is an honest inline notice, not a dialog')
  assert.ok(!/window\.alert|confirm\(/.test(browser), 'never a dialog for an expected state')
  const ask = await readFile(new URL('src/app-shell/AskPanel.tsx', root), 'utf8')
  assert.match(ask, /modelsStale &&/, 'the model list shows a cached/stale state')
  assert.match(ask, /You are offline — showing the cached model list\./, 'and says so in words')
  const opencode = await readFile(new URL('src/lib/opencode.ts', root), 'utf8')
  assert.match(opencode, /allowOffline: isLocalBase/, 'localhost probes still run with the wifi off')
  assert.doesNotMatch(opencode, /await fetch\(/, 'no raw fetch left in the model client')
}
console.log('F-3 check passed — one guarded fetch for the renderer, zero possible unhandled rejections, offline Library + cached models with a stale dot')
