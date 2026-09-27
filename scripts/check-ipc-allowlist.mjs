#!/usr/bin/env node
/**
 * Every IPC channel the renderer invokes must be (1) in the preload allowlist
 * and (2) handled in the main process. A channel missing from either fails
 * only at runtime, only on desktop, as a generic rejection — which is how
 * "Open editable" in Arena Desk silently broke. This makes it a build error.
 */
import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

async function walk(dir) {
  const out = []
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) out.push(...(await walk(full)))
    else if (/\.(tsx?|jsx?)$/.test(entry.name)) out.push(full)
  }
  return out
}

const [preload, main] = await Promise.all([
  readFile(path.join(root, 'electron/preload.cjs'), 'utf8'),
  readFile(path.join(root, 'electron/main.cjs'), 'utf8'),
])

const allowBlock = preload.match(/const invokeChannels = new Set\(\[([\s\S]*?)\]\)/)
assert.ok(allowBlock, 'preload must declare an invokeChannels allowlist')
const allowed = new Set([...allowBlock[1].matchAll(/['"]([^'"]+)['"]/g)].map((m) => m[1]))
const handled = new Set([...main.matchAll(/ipcMain\.handle\(\s*['"]([^'"]+)['"]/g)].map((m) => m[1]))

const used = new Map()
for (const file of await walk(path.join(root, 'src'))) {
  const text = await readFile(file, 'utf8')
  for (const m of text.matchAll(/\binvoke(?:<[^>]*>)?\(\s*['"]([a-zA-Z]+:[\w:-]+)['"]/g)) {
    if (!used.has(m[1])) used.set(m[1], path.relative(root, file))
  }
}
assert.ok(used.size > 10, `expected to find renderer invoke calls (found ${used.size})`)

const notAllowed = [...used].filter(([ch]) => !allowed.has(ch))
const notHandled = [...used].filter(([ch]) => !handled.has(ch))
const allowedButUnhandled = [...allowed].filter((ch) => !handled.has(ch))

assert.deepEqual(notAllowed.map(([ch, f]) => `${ch} (${f})`), [], 'renderer invokes channels the preload does not allow')
assert.deepEqual(notHandled.map(([ch, f]) => `${ch} (${f})`), [], 'renderer invokes channels main.cjs does not handle')
assert.deepEqual(allowedButUnhandled, [], 'preload allows channels that main.cjs never handles')

console.log(`ipc allowlist check passed — ${used.size} renderer channels, all allowlisted and handled`)
