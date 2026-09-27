// Resource Finder: plain-language queries against ALL real packs must surface
// the right resources near the top, deterministically, with reasons.
import { build } from 'esbuild'
import { readFileSync, rmSync } from 'node:fs'
import assert from 'node:assert/strict'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const out = path.resolve('.check-resource-finder.mjs')
await build({ stdin: { contents: "export * from './src/lib/resourceFinder'", resolveDir: process.cwd(), loader: 'ts' }, bundle: true, format: 'esm', platform: 'node', outfile: out, logLevel: 'silent' })
const f = await import(pathToFileURL(out).href)
rmSync(out, { force: true })

const index = JSON.parse(readFileSync('resources/packs/index.json', 'utf8'))
const packs = index.packs.map((e) => { const p = JSON.parse(readFileSync(`resources/packs/${e.id}.json`, 'utf8')); return { id: p.id, name: p.name, items: p.items } })
let n = 0
const ok = (c, m) => { assert.ok(c, m); n++ }
const top = (q, k = 6) => f.findResources(q, packs, 24).results.slice(0, k)
const hit = (q, re, k = 6) => {
  const r = top(q, k)
  ok(r.some((x) => re.test(`${x.item.id} ${x.item.name}`)), `“${q}” should surface ${re} in top ${k}; got ${r.map((x) => x.item.id).join(', ')}`)
}

hit('numbers going up for our revenue', /counter|stat|number|count/i)
hit('logos of companies that trust us', /marquee|logo|simple-icons/i)
hit('fancy background for the intro', /mesh|gradient|aurora|particle|background/i)
hit('customer reviews', /testimonial|review|quote/i)
hit('button that makes people click', /button|magnetic/i)
hit('photo gallery that scrolls', /gallery|scroll|carousel/i)
hit('free icons and brand logos', /simple-icons|lucide|logo-dev|phosphor|tabler|icon/i)
hit('framer motion', /framer-motion/i, 3)
hit('gsap', /gsap/i, 3)
hit('satoshi font', /satoshi/i, 3)
hit('geist', /geist/i, 3)
hit('testimonals', /testimonial/i) // typo tolerance
hit('bento', /bento/i, 3)
hit('glassy frosted panel', /glass|frost/i)

const a = JSON.stringify(top('calm premium transition', 10).map((r) => r.item.id))
ok(a === JSON.stringify(top('calm premium transition', 10).map((r) => r.item.id)), 'same query → same order')
ok(top('customer reviews', 3).every((r) => r.why.length > 0), 'results explain why they matched')
ok(!top('customer reviews', 10).some((r) => r.item.kind === 'font'), 'fonts do not drown non-font searches')
ok(top('serif font for headlines', 5).some((r) => r.item.kind === 'font' || /font/.test(r.item.id)), 'font intent surfaces fonts')
ok(f.findResources('zzqxv', packs).results.length === 0, 'nonsense returns nothing (explained in UI)')
const r = f.findResources('logos', packs, 24).results
const per = r.reduce((m, x) => m.set(x.packId, (m.get(x.packId) ?? 0) + 1), new Map())
ok([...per.values()].every((v) => v <= 6), 'no pack takes over the list')
ok(f.findResources('x', packs).searched === index.packs.reduce((s, e) => s + e.itemCount, 0), 'every resource in every pack is searched')
ok(readFileSync('src/screens/library/PackBrowser.tsx', 'utf8').includes('<ResourceFinder'), 'finder is in the Library/Studio pack browser')
console.log(`resource finder check passed — ${n} assertions across ${packs.length} packs`)
