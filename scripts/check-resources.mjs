#!/usr/bin/env node
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const root = new URL('../', import.meta.url)
const pkg = JSON.parse(await readFile(new URL('package.json', root), 'utf8'))
const index = JSON.parse(await readFile(new URL('resources/packs/index.json', root), 'utf8'))
assert.equal(index.version, pkg.version, 'bundled pack index must match the application version')
assert.equal(index.packs.length, 16, 'all 16 resource packs must be indexed')
let total = 0
for (const entry of index.packs) {
  const pack = JSON.parse(await readFile(new URL(`resources/packs/${entry.id}.json`, root), 'utf8'))
  assert.equal(pack.version, pkg.version, `${entry.id} pack version must match the app`)
  assert.equal(pack.items.length, entry.itemCount, `${entry.id} item count must match the index`)
  total += pack.items.length
}
assert.equal(total, 3519, 'the complete resource catalogue must be bundled')
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

console.log(`resource check passed — ${index.packs.length} bundled packs, ${total} items, shared by Library and Studio`)
