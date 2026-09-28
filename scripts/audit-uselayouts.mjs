#!/usr/bin/env node
// Static audit of every vendored uselayouts component.
// Reads the source as text and never imports or executes it. For each registry item it
// records category, licence, dependencies, the interaction and animation model, the
// required props, the Cupric-native equivalent, and whether the source is safe to
// adapt. Output: resources/uselayouts/audit.json. build-packs.mjs merges that file
// into the Library pack.
//
//   node scripts/audit-uselayouts.mjs
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// fileURLToPath, not fileURLToPath(import.meta.url): on Windows the URL
// path is '/C:/a/b/scripts/x.mjs', which resolves to the bogus root '\C:\a\b'
// and every read below throws ENOENT. The release build runs on windows-latest.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const base = path.join(root, 'resources', 'uselayouts')
const registry = JSON.parse(readFileSync(path.join(base, 'registry.json'), 'utf8'))
const browse = JSON.parse(readFileSync(path.join(base, 'browse-categories.json'), 'utf8')).items
const media = JSON.parse(readFileSync(path.join(base, 'browse-media.json'), 'utf8'))
const UPSTREAM_COMMIT = '78bfa803aed67d424755b66bb3f30eeed42d7502'

// Anything that would reach outside a sandboxed, deterministic scene.
const UNSAFE = [
  [/\beval\s*\(|new Function\s*\(/, 'dynamic code evaluation'],
  [/dangerouslySetInnerHTML/, 'raw HTML injection'],
  [/\bfetch\s*\(|XMLHttpRequest|WebSocket\s*\(/, 'network access'],
  [/localStorage|sessionStorage|indexedDB/, 'persistent browser storage'],
  [/window\.open\s*\(|location\.(href|assign|replace)/, 'navigation'],
  [/navigator\.clipboard/, 'clipboard access'],
]
const NONDETERMINISTIC = [
  [/Math\.random\s*\(/, 'Math.random'],
  [/Date\.now\s*\(|new Date\s*\(/, 'wall clock'],
  [/setInterval\s*\(/, 'setInterval timers'],
]

function detect(src, table) {
  return table.filter(([re]) => re.test(src)).map(([, label]) => label)
}

function interactionModel(src, hints) {
  const kinds = new Set((hints?.items ?? []).map((i) => i.kind))
  const found = []
  if (/drag\b|onDrag|useDrag|dragConstraints/.test(src) || kinds.has('drag')) found.push('drag')
  if (/onHoverStart|whileHover|onMouseEnter|onPointerEnter/.test(src) || kinds.has('hover')) found.push('hover')
  if (/onClick|onTap|whileTap/.test(src) || kinds.has('click') || kinds.has('tap')) found.push('click')
  if (/useScroll|onScroll|scrollYProgress|useInView|whileInView/.test(src) || kinds.has('scroll')) found.push('scroll')
  if (/onKeyDown|onKeyUp|useHotkeys/.test(src)) found.push('keyboard')
  if (/<input|<textarea|onChange=/.test(src)) found.push('text/form input')
  return found.length ? found.join(' + ') : 'passive (autoplay)'
}

function animationModel(src) {
  const found = []
  if (/from ["']motion\/react["']|from ["']framer-motion["']/.test(src)) found.push('motion (framer)')
  if (/type:\s*["']spring["']|useSpring/.test(src)) found.push('springs')
  if (/layoutId|\blayout\b=/.test(src)) found.push('shared layout')
  if (/AnimatePresence/.test(src)) found.push('enter/exit presence')
  if (/@keyframes|animate-\[|animation:/.test(src)) found.push('CSS keyframes')
  if (/rotateX|rotateY|perspective|preserve-3d/.test(src)) found.push('CSS 3D')
  if (/<canvas|getContext\(/.test(src)) found.push('canvas')
  return found.length ? found.join(', ') : 'CSS transitions'
}

function requiredProps(src) {
  // Destructured props of the default/first exported component, with and without defaults.
  const m = src.match(/export\s+(?:default\s+)?function\s+\w*\s*\(\s*\{([^}]*)\}/) || src.match(/const\s+\w+\s*=\s*\(\s*\{([^}]*)\}\s*(?::[^)]*)?\)\s*=>/)
  if (!m) return { required: [], optional: [] }
  const parts = m[1].split(',').map((p) => p.trim()).filter(Boolean).filter((p) => !p.startsWith('...'))
  return {
    required: parts.filter((p) => !p.includes('=')).map((p) => p.split(':')[0].trim()),
    optional: parts.filter((p) => p.includes('=')).map((p) => p.split('=')[0].split(':')[0].trim()),
  }
}

// Map a uselayouts browse category onto the native storyboard family Apply builds.
const EQUIVALENT = {
  Button: 'Native button scene: shape (pill) + label text + cursor click; press-in on click',
  Navigation: 'Native navigation scene: glass bar + text items + cursor; active-indicator keyframes',
  Input: 'Native form scene: glass field + typed text (word-reveal) + cursor I-beam',
  Display: 'Native card/display scene: glass panel + title/body text + entrance keyframes',
  List: 'Native list scene: stacked text rows with staggered rise-in',
  Layout: 'Native layout scene: glass panels arranged by the storyboard grid',
  Media: 'Native media scene: image/video placeholder slot (honest relink) + caption',
  Feedback: 'Native feedback scene: badge shape + status text + pop animation',
}

const items = []
for (const entry of registry.items) {
  const files = (entry.files ?? []).map((f) => {
    const rel = f.path.startsWith('registry/') || f.path.startsWith('hooks/') ? f.path : `registry/${f.path}`
    const abs = path.join(base, rel)
    return { path: f.path, vendoredPath: `resources/uselayouts/${rel}`, present: existsSync(abs), source: existsSync(abs) ? readFileSync(abs, 'utf8') : '' }
  })
  const src = files.map((f) => f.source).join('\n')
  const controlsPath = path.join(base, 'registry', 'default', 'controls', `${entry.name}.json`)
  const controls = existsSync(controlsPath) ? JSON.parse(readFileSync(controlsPath, 'utf8')) : null
  const unsafe = detect(src, UNSAFE)
  const nondeterministic = detect(src, NONDETERMINISTIC)
  const category = browse[entry.name]?.category ?? 'Uncategorised'
  const props = requiredProps(src)
  const m = media[entry.name] ?? {}
  items.push({
    id: `uselayouts-${entry.name}`,
    slug: entry.name,
    name: entry.title,
    category,
    tagline: browse[entry.name]?.tagline ?? null,
    description: entry.description,
    sourceUrl: `https://uselayouts.com/docs/components/${entry.name}`,
    registryUrl: `https://uselayouts.com/r/${entry.name}`,
    repositoryPaths: files.map((f) => f.path),
    vendoredPaths: files.map((f) => f.vendoredPath),
    allFilesVendored: files.every((f) => f.present),
    docsPath: existsSync(path.join(base, 'docs', `${entry.name}.mdx`)) ? `resources/uselayouts/docs/${entry.name}.mdx` : null,
    license: 'MIT',
    attribution: 'uselayouts by Urvish Mali: MIT License, Copyright (c) 2025 Urvish Mali. Keep resources/uselayouts/LICENSE with any copy.',
    dependencies: entry.dependencies ?? [],
    registryDependencies: entry.registryDependencies ?? [],
    interaction: interactionModel(src, controls?.interactionHints),
    animation: animationModel(src),
    requiredProps: props.required,
    optionalProps: props.optional,
    tags: controls?.tags ?? [],
    cupricEquivalent: EQUIVALENT[category] ?? 'Native storyboard scene (glass panel, text, shapes) rebuilt from the item name and description',
    previewable: Boolean(m.posterUrl),
    posterUrl: m.posterUrl ?? null,
    videoUrl: m.videoUrl ?? null,
    // The upstream React code never runs in Cupric. Apply builds native clips, so
    // export is deterministic whatever the source does.
    deterministicExport: true,
    insertable: unsafe.length === 0,
    referenceOnly: unsafe.length > 0,
    unsafePatterns: unsafe,
    sourceNondeterminism: nondeterministic,
    refusal: unsafe.length ? `Source uses ${unsafe.join(', ')}. Cupric will not adapt it automatically; it stays reference-only.` : null,
    fallback: 'If motion/clsx/tailwind-merge are unavailable nothing changes: the adapter uses only Cupric native clips.',
  })
}

const out = {
  generatedBy: 'scripts/audit-uselayouts.mjs',
  upstream: 'https://github.com/iurvish/uselayouts',
  upstreamCommit: UPSTREAM_COMMIT,
  catalogueUrl: 'https://uselayouts.com/browse',
  license: 'MIT (Copyright (c) 2025 Urvish Mali)',
  total: items.length,
  insertable: items.filter((i) => i.insertable).length,
  referenceOnly: items.filter((i) => i.referenceOnly).length,
  categories: Object.fromEntries([...new Set(items.map((i) => i.category))].sort().map((c) => [c, items.filter((i) => i.category === c).length])),
  items,
}
writeFileSync(path.join(base, 'audit.json'), `${JSON.stringify(out, null, 2)}\n`)
console.log(`uselayouts audit: ${out.total} items · ${out.insertable} insertable · ${out.referenceOnly} reference-only · categories ${JSON.stringify(out.categories)}`)
