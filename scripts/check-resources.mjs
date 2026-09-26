#!/usr/bin/env node
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const root = new URL('../', import.meta.url)
const pkg = JSON.parse(await readFile(new URL('package.json', root), 'utf8'))
const index = JSON.parse(await readFile(new URL('resources/packs/index.json', root), 'utf8'))
assert.equal(index.version, pkg.version, 'bundled pack index must match the application version')
assert.equal(index.packs.length, 13, 'all 13 resource packs must be indexed')
let total = 0
for (const entry of index.packs) {
  const pack = JSON.parse(await readFile(new URL(`resources/packs/${entry.id}.json`, root), 'utf8'))
  assert.equal(pack.version, pkg.version, `${entry.id} pack version must match the app`)
  assert.equal(pack.items.length, entry.itemCount, `${entry.id} item count must match the index`)
  total += pack.items.length
}
assert.equal(total, 2630, 'the complete v0.5 resource catalogue must be bundled')

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
