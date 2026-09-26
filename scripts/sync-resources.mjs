#!/usr/bin/env node
/**
 * Pull upstream resource catalogs into resources/ for offline Library + agents.
 * Run: node scripts/sync-resources.mjs
 * Or:  npm run resources:sync
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

async function fetchText(url) {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`${url} → ${res.status}`)
  return res.text()
}

function parseUiLabRegistry(ts) {
  const lab = []
  const chunks = ts.split(/\n  \{\n/)
  for (const c of chunks.slice(1)) {
    const slug = (c.match(/slug:\s*"([^"]+)"/) || [])[1]
    const name = (c.match(/name:\s*"([^"]+)"/) || [])[1]
    const category = (c.match(/category:\s*"([^"]+)"/) || [])[1]
    const d1 = c.match(/description:\s*\n\s*"([^"]+)"/)
    const d2 = c.match(/description:\s*"([^"]+)"/)
    const description = (d1 && d1[1]) || (d2 && d2[1]) || ''
    const keywords = (c.match(/keywords:\s*"([^"]+)"/) || [])[1]
    if (slug && name && category) lab.push({ slug, name, category, description, keywords })
  }
  return lab
}

async function main() {
  await mkdir(join(root, 'resources/ui-lab'), { recursive: true })
  await mkdir(join(root, 'resources/spectrum'), { recursive: true })
  await mkdir(join(root, 'public/resources/avatars'), { recursive: true })

  console.log('→ ui-lab registry.ts')
  const regTs = await fetchText('https://raw.githubusercontent.com/xevrion/ui-lab/main/src/lab/registry.ts')
  const lab = parseUiLabRegistry(regTs)
  const regJson = {
    source: 'https://github.com/xevrion/ui-lab',
    url: 'https://lab.xevrion.dev',
    license: 'MIT',
    syncedAt: new Date().toISOString(),
    count: lab.length,
    lab,
  }
  await writeFile(join(root, 'resources/ui-lab/registry.json'), JSON.stringify(regJson, null, 2))
  console.log(`  ${lab.length} entries`)

  console.log('→ spectrum registry.json (full)')
  try {
    const spectrum = await fetchText('https://raw.githubusercontent.com/arihantcodes/spectrum-ui/main/registry.json')
    await writeFile(join(root, 'resources/spectrum/registry.full.json'), spectrum)
    console.log(`  ${spectrum.length} bytes`)
  } catch (e) {
    console.warn('  spectrum registry skip:', e.message)
  }

  console.log('→ ui-lab avatars')
  for (const name of ['ava', 'ben', 'cara', 'dev', 'fay']) {
    try {
      const svg = await fetchText(`https://raw.githubusercontent.com/xevrion/ui-lab/main/public/avatars/${name}.svg`)
      await writeFile(join(root, `public/resources/avatars/${name}.svg`), svg)
      console.log(`  ${name}.svg`)
    } catch (e) {
      console.warn(`  ${name} skip:`, e.message)
    }
  }

  console.log('done. resources uploaded under resources/ and public/resources/')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
