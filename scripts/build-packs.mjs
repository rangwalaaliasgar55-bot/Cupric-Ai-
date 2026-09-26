/**
 * Generates `resources/packs/*.json` from the registries that the app itself
 * uses, so a pack can never describe something the code cannot render.
 *
 * Run: npm run packs:build
 */

import { build } from 'esbuild'
import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { fileURLToPath, pathToFileURL } from 'node:url'
import path from 'node:path'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const outDir = path.join(root, 'resources', 'packs')
const tmp = path.join(root, '.packs-bundle.mjs')

const entry = `
export { GLASS_PRESETS } from './src/lib/glass'
export { TRANSITIONS, TEXT_ANIMATIONS } from './src/lib/studio/transitions'
export { STUDIO_BACKGROUNDS } from './src/lib/studio/backgrounds'
export { EFFECTS } from './src/lib/effects'
export { GRADIENT_PRESETS } from './src/lib/gradients'
export { VOICE_PHRASES } from './src/lib/voice'
export { SOURCES } from './src/lib/sources'
export { VIDEO_TEMPLATES } from './src/lib/videoTemplates'
`

await build({
  bundle: true,
  outfile: tmp,
  format: 'esm',
  platform: 'node',
  logLevel: 'warning',
  loader: { '.css': 'empty', '.svg': 'dataurl', '.json': 'json' },
  stdin: { contents: entry, resolveDir: root, sourcefile: 'packs-entry.ts', loader: 'ts' },
})

// pathToFileURL, not a `file://` concat: a Windows path like C:\a\b.mjs is
// not a valid URL and the release build runs on windows-latest.
const mod = await import(`${pathToFileURL(tmp).href}?t=${Date.now()}`)
await rm(tmp, { force: true })

const VERSION = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8')).version
const today = new Date().toISOString().slice(0, 10)

/** @type {import('../src/lib/packs').Pack[]} */
const packs = []

packs.push({
  id: 'glass',
  name: 'Liquid Glass',
  description:
    'Refracting glass materials for the app chrome and for the Studio canvas. One parameter set drives the DOM (backdrop-filter + SVG displacement) and the exported video (canvas).',
  version: VERSION,
  source: 'Cupric implementation, technique after agpallav.com/liquid-glass, glass-lens-react and liquefy-ui',
  license: 'MIT (this implementation)',
  items: mod.GLASS_PRESETS.map((p) => ({
    id: p.id,
    kind: 'glass',
    name: p.name,
    description: p.description,
    data: p.params,
    tags: ['glass', 'material'],
  })),
})

packs.push({
  id: 'transitions',
  name: 'Transitions',
  description: 'Every transition the Studio renderer implements, including the glass and liquid families.',
  version: VERSION,
  source: 'Cupric Studio renderer',
  license: 'MIT',
  items: mod.TRANSITIONS.map((t) => ({
    id: t.id,
    kind: 'transition',
    name: t.name,
    description: t.description,
    data: { family: t.family },
    tags: ['transition', t.family],
  })),
})

packs.push({
  id: 'animations',
  name: 'Text animations',
  description: 'Caption and title animations, all pure functions of clip progress so preview and export match.',
  version: VERSION,
  source: 'Cupric Studio renderer',
  license: 'MIT',
  items: mod.TEXT_ANIMATIONS.map((t) => ({
    id: t.id,
    kind: 'animation',
    name: t.name,
    description: t.description,
    data: { family: t.family },
    tags: ['animation', t.family],
  })),
})

packs.push({
  id: 'backgrounds',
  name: 'Backgrounds & gradients',
  description: 'Studio stage backgrounds — gradients, mesh gradients and patterns — with the CSS twin used by the app and by Arena HTML.',
  version: VERSION,
  source: 'Cupric tokens, catalogue shape after ibelick',
  license: 'MIT',
  items: [
    ...mod.STUDIO_BACKGROUNDS.map((b) => ({
      id: b.id,
      kind: 'background',
      name: b.name,
      description: `${b.group} · renders identically on the canvas and in CSS`,
      css: b.css,
      data: { group: b.group, studio: true },
      tags: ['background', b.group],
    })),
    ...mod.GRADIENT_PRESETS.map((g) => ({
      id: `chrome-${g.id}`,
      kind: 'background',
      name: g.name,
      description: 'App-chrome gradient (stage and thumbnails only).',
      css: g.css,
      data: { group: 'chrome', studio: false },
      tags: ['background', 'chrome'],
    })),
  ],
})

packs.push({
  id: 'effects',
  name: 'Effects',
  description: 'Effect cues shared by the Arena prompt builder and the local renderer.',
  version: VERSION,
  source: 'Cupric effects registry, mapping notes in resources/kdenlive',
  license: 'MIT',
  items: mod.EFFECTS.map((e) => ({
    id: e.id,
    kind: 'effect',
    name: e.name,
    description: e.description,
    data: { effectKind: e.kind, promptCue: e.promptCue },
    tags: ['effect', e.kind],
  })),
})

packs.push({
  id: 'voice',
  name: 'Voice commands',
  description: 'The Studio voice grammar. Each entry is a phrase the parser in src/lib/voice.ts accepts.',
  version: VERSION,
  source: 'Cupric voice parser (Web Speech API)',
  license: 'MIT',
  items: mod.VOICE_PHRASES.map((p, i) => ({
    id: `voice-${i}`,
    kind: 'voice',
    name: p.say,
    description: p.does,
    tags: ['voice'],
  })),
})

packs.push({
  id: 'sources',
  name: 'Sources',
  description:
    'The external libraries, generators and galleries Cupric draws on — for the app interface and for the local HTML → MP4 generator. Each entry carries a prompt cue the brief builder can paste verbatim.',
  version: VERSION,
  source: 'src/lib/sources.ts (links only; nothing third-party is bundled)',
  license: 'Per entry — see each item',
  items: mod.SOURCES.map((s) => ({
    id: s.id,
    kind: 'source',
    name: s.name,
    description: s.description,
    data: {
      url: s.url,
      sourceKind: s.kind,
      use: s.use,
      intake: s.intake,
      license: s.license,
      promptCue: s.promptCue,
    },
    tags: ['source', s.kind, s.use, ...s.tags],
  })),
})

packs.push({
  id: 'templates',
  name: 'Video templates',
  description:
    'Self-contained HTML scenes under resources/effects. Each exposes window.__seek(t) and a source manifest, so the desktop renderer can capture it frame by frame into an MP4 with no network.',
  version: VERSION,
  source: 'Cupric templates, built after Forge UI, 23rd.dev and motion-primitives',
  license: 'MIT (this implementation)',
  items: mod.VIDEO_TEMPLATES.map((t) => ({
    id: t.id,
    kind: 'template',
    name: t.name,
    description: t.description,
    data: {
      file: t.file,
      durationSec: t.durationSec,
      fps: t.fps,
      size: t.size,
      loops: t.loops ?? false,
      sources: t.sources,
    },
    tags: ['template', ...t.tags],
  })),
})

// PanelUI: catalogue only. The library is React Native, so its source cannot
// run in Cupric's DOM renderer — what we vendor is the behaviour catalogue that
// the prompt builder and our own components learn from.
try {
  const panel = JSON.parse(await readFile(path.join(root, 'resources', 'panelui', 'registry.json'), 'utf8'))
  packs.push({
    id: 'panelui',
    name: 'PanelUI catalogue',
    description:
      'All 135 PanelUI components and 21 chart visualisations, with the upstream behaviour notes. React Native source stays upstream; Cupric mines the behaviour, the copy and the accessibility rules.',
    version: VERSION,
    source: `${panel.source} (${panel.package} ${panel.upstreamVersion}, ${panel.platform})`,
    license: panel.license,
    items: panel.entries.map((entry) => ({
      id: `panelui-${entry.slug}`,
      kind: 'source',
      name: entry.name,
      description: entry.description || `PanelUI ${entry.group} entry`,
      data: {
        url: `https://panelui.dev/docs/${entry.group}/${entry.slug}`,
        sourceKind: 'components',
        use: 'ui',
        intake: 'reference',
        license: panel.license,
        platform: panel.platform,
        promptCue: entry.description || '',
      },
      tags: ['source', 'panelui', entry.group],
    })),
  })
} catch {
  console.warn('resources/panelui/registry.json not readable — skipping the PanelUI pack')
}

// SaaS blueprints are first-class editable Studio storyboards.
try {
  const saas = JSON.parse(await readFile(path.join(root, 'resources', 'saas', 'templates.json'), 'utf8'))
  packs.push({
    id: 'saas-video',
    name: 'SaaS video templates',
    description: saas.description,
    version: VERSION,
    source: 'Cupric authored templates',
    license: 'MIT (Cupric authored blueprint)',
    items: saas.templates.map((template) => ({
      id: template.id,
      kind: 'saas-template',
      name: template.name,
      description: template.goal,
      data: { durationSec: template.durationSec, scenes: template.scenes, editable: true, agentUsable: true },
      tags: ['saas', 'video', 'template', 'editable', 'agent'],
    })),
  })
} catch {
  console.warn('resources/saas/templates.json not readable — skipping SaaS pack')
}

// External UI sources are represented as attributed, editable capability entries.
// We do not silently copy third-party code or assets without a compatible license.
try {
  const external = JSON.parse(await readFile(path.join(root, 'resources', 'external', 'catalog.json'), 'utf8'))
  packs.push({
    id: 'external-ui',
    name: 'External UI & motion resources',
    description: 'Indexed icons, UI blocks, motion components and design tools from Its Hover, Great UI, Bencho, Spell UI and DesignEng. Entries link to the original source and are available to the video/agent adapters.',
    version: VERSION,
    source: external.sources.map((s) => s.url).join(', '),
    license: external.policy,
    items: external.sources.flatMap((source) => source.items.map((item) => ({
      ...item,
      description: `${source.name} ${item.kind} · editable video cue and agent capability`,
      data: { provider: source.id, source: item.source, editable: item.editable, agentUsable: item.agentUsable },
      tags: ['external', source.id, item.kind, 'editable', 'agent'],
    }))),
  })
} catch {
  console.warn('resources/external/catalog.json not readable — skipping external UI pack')
}

// Remotion is represented as a capability pack rather than copied source. This
// keeps the app license-safe while making every upstream template, font name and
// agent skill discoverable to the Library and autonomous planner.
try {
  const remotion = JSON.parse(await readFile(path.join(root, 'resources', 'remotion', 'catalog.json'), 'utf8'))
  const items = [
    ...remotion.templates.map((t) => ({
      id: `template-${t.id}`,
      kind: 'template',
      name: t.name,
      description: `Remotion starter template · ${t.package}`,
      data: { source: t.source, package: t.package },
      tags: ['remotion', 'template'],
    })),
    ...remotion.fonts.names.map((name) => ({
      id: `font-${name}`,
      kind: 'font',
      name,
      description: 'Remotion Google Fonts catalog entry; loaded lazily with a local fallback.',
      data: { provider: remotion.fonts.provider },
      tags: ['remotion', 'font'],
    })),
    ...remotion.skills.map((skill) => ({
      id: `skill-${skill.id}`,
      kind: 'skill',
      name: skill.name,
      description: skill.description,
      data: { source: `${remotion.source.url}/tree/${remotion.source.ref}/.agents/skills/${skill.id}` },
      tags: ['remotion', 'skill', 'agent'],
    })),
    ...(remotion.packages ?? []).map((pkg) => ({
      id: `package-${pkg.id}`,
      kind: 'provider',
      name: pkg.name,
      description: `Remotion package capability · ${pkg.license}`,
      data: { source: pkg.source, license: pkg.license, intake: pkg.intake, agentUsable: pkg.agentUsable },
      tags: ['remotion', 'package', 'agent', 'license-review'],
    })),
  ]
  packs.push({
    id: 'remotion',
    name: 'Remotion toolkit',
    description: 'Upstream Remotion templates, Google Fonts catalog and agent skills indexed for autonomous planning. Source metadata only; no upstream code is vendored.',
    version: VERSION,
    source: remotion.source.url,
    license: remotion.source.license,
    items,
  })
} catch {
  console.warn('resources/remotion/catalog.json not readable — skipping the Remotion pack')
}

// React Bits is discoverable, but its Commons Clause explicitly forbids
// redistributing the component collection (including bundled/ported versions).
// Keep this as attributed metadata and never silently vendor upstream source.
try {
  const reactBits = JSON.parse(await readFile(path.join(root, 'resources', 'react-bits', 'catalog.json'), 'utf8'))
  packs.push({
    id: 'react-bits',
    name: 'React Bits storyboards',
    description: `All ${reactBits.items.length} current React Bits ideas as attributed references plus original, editable Cupric-native storyboards. No upstream component source is redistributed.`,
    version: VERSION,
    source: reactBits.source.url,
    license: reactBits.source.license,
    items: reactBits.items.map((item, index) => {
      // These are deliberately simple Cupric scenes, not ports of the upstream
      // implementation. Every resulting clip uses Studio's own renderer and is
      // therefore editable, keyframeable, agent-readable and safe to export.
      const animation = item.category === 'text'
        ? ['word-reveal', 'typewriter', 'shimmer', 'fade-up'][index % 4]
        : item.category === 'animations'
          ? ['pop', 'liquid-wave', 'glass-rise', 'slide-left'][index % 4]
          : item.category === 'background'
            ? 'fade-up'
            : ['pop', 'word-reveal', 'fade-up'][index % 3]
      const categoryLabel = item.category === 'animations' ? 'animation' : item.category
      const scenes = item.category === 'background'
        ? [[item.name, 4, animation, 'text'], ['Edit colors, motion and layers', 4, 'shimmer', 'text']]
        : [[item.name, 3, animation, 'text'], [`Editable ${categoryLabel} state`, 4, 'word-reveal', 'text'], ['Customize every property', 3, 'fade-up', 'text']]
      return {
        id: `react-bits-${item.id}`,
        kind: 'saas-template',
        name: item.name,
        description: `Original editable Cupric storyboard using “${item.name}” as attributed visual vocabulary`,
        data: {
          durationSec: scenes.reduce((sum, scene) => sum + scene[1], 0),
          scenes,
          source: item.source,
          category: item.category,
          editable: true,
          agentUsable: true,
          sourceCopied: false,
          intake: 'original-native-storyboard',
          attribution: 'React Bits · David Haz',
          license: reactBits.source.license,
        },
        tags: ['react-bits', item.category, 'editable', 'agent', 'attributed', 'native-storyboard'],
      }
    }),
  })
} catch {
  console.warn('resources/react-bits/catalog.json not readable — skipping React Bits')
}

// Skiper UI permits commercial adaptation with attribution. Each entry becomes
// an original Cupric-native storyboard: editable text/media clips rather than a
// copy of upstream source or assets, with the source credit retained in data.
try {
  const skiper = JSON.parse(await readFile(path.join(root, 'resources', 'skiper', 'catalog.json'), 'utf8'))
  packs.push({
    id: 'skiper-ui',
    name: 'Skiper UI blueprints',
    description: `All ${skiper.items.length} supplied Skiper UI ideas as attributed, editable Studio storyboards.`,
    version: VERSION,
    source: skiper.source.url,
    license: skiper.source.license,
    items: skiper.items.map((item) => {
      const isVideo = item.category === 'video'
      const isMotion = item.category === 'motion'
      const scenes = isVideo
        ? [[item.name, 2.5, 'fade-up', 'text'], ['Replace with your video', 5.5, 'none', 'media'], ['Close / replay', 2, 'pop', 'text']]
        : isMotion
          ? [[item.name, 3, 'fade-up', 'text'], ['Scroll-driven movement', 4, 'word-reveal', 'media'], ['Make it yours', 3, 'shimmer', 'text']]
          : [[item.name, 3, 'pop', 'text'], ['Editable interaction state', 4, 'word-reveal', 'text'], ['Call to action', 3, 'fade-up', 'text']]
      return {
        id: item.id,
        kind: 'saas-template',
        name: item.name,
        description: `Original editable storyboard inspired by ${item.name} · attribution: ${item.attribution}`,
        data: { durationSec: 10, scenes, editable: true, agentUsable: true, source: item.source, attribution: item.attribution, category: item.category },
        tags: ['skiper-ui', item.category, 'editable', 'agent', 'attributed'],
      }
    }),
  })
} catch {
  console.warn('resources/skiper/catalog.json not readable — skipping Skiper UI')
}

// The vendored lab components are listed from their generated registry.
try {
  const registry = JSON.parse(await readFile(path.join(root, 'resources', 'ui-lab', 'registry.json'), 'utf8'))
  const entries = Array.isArray(registry) ? registry : (registry.components ?? registry.entries ?? [])
  packs.push({
    id: 'components',
    name: 'Lab components',
    description: 'React components vendored from lab.xevrion.dev into src/lab/components and browsable in the Lab screen.',
    version: VERSION,
    source: 'https://lab.xevrion.dev/lab/',
    license: 'MIT (upstream)',
    items: entries.map((c) => ({
      id: String(c.id ?? c.slug ?? c.name),
      kind: 'component',
      name: String(c.name ?? c.id),
      description: String(c.description ?? c.category ?? 'Vendored lab component'),
      data: { path: c.path ?? null, category: c.category ?? null },
      tags: ['component', String(c.category ?? 'lab')],
    })),
  })
} catch {
  console.warn('resources/ui-lab/registry.json not readable — skipping the components pack')
}

await mkdir(outDir, { recursive: true })

const index = {
  version: VERSION,
  updated: today,
  repo: 'rangwalaaliasgar55-bot/Cupric-Ai-',
  packs: [],
}

for (const pack of packs) {
  const json = `${JSON.stringify(pack, null, 2)}\n`
  await writeFile(path.join(outDir, `${pack.id}.json`), json)
  index.packs.push({
    id: pack.id,
    name: pack.name,
    description: pack.description,
    itemCount: pack.items.length,
    bytes: Buffer.byteLength(json),
  })
}

await writeFile(path.join(outDir, 'index.json'), `${JSON.stringify(index, null, 2)}\n`)

/**
 * Mirror into `public/` so `vite build` copies the packs next to index.html.
 * That is what makes the packaged desktop app work with no network: the
 * renderer's last fallback is the relative `./resources/packs/...` copy.
 * The mirror is generated, so it is gitignored.
 */
const publicDir = path.join(root, 'public', 'resources', 'packs')
await mkdir(publicDir, { recursive: true })
for (const pack of packs) {
  await copyFile(path.join(outDir, `${pack.id}.json`), path.join(publicDir, `${pack.id}.json`))
}
await copyFile(path.join(outDir, 'index.json'), path.join(publicDir, 'index.json'))

console.log(`Wrote ${packs.length} packs (${index.packs.reduce((n, p) => n + p.itemCount, 0)} items) to resources/packs`)
