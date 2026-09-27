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
      // Same names as stage backgrounds — label them so lists aren't ambiguous.
      name: `${g.name} (app chrome)`,
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
      'All 135 PanelUI components and 21 chart visualisations as editable Cupric-native Studio storyboards. React Native source stays upstream; Cupric uses its own deterministic renderer.',
    version: VERSION,
    source: `${panel.source} (${panel.package} ${panel.upstreamVersion}, ${panel.platform})`,
    license: panel.license,
    items: panel.entries.map((entry, _i, all) => ({
      // Slugs like `index` repeat across groups: keep the first id stable and
      // qualify later ones by group so every id is unique (React keys, apply).
      id: all.findIndex((e) => e.slug === entry.slug) === _i ? `panelui-${entry.slug}` : `panelui-${entry.group}-${entry.slug}`,
      kind: 'saas-template',
      name: entry.name,
      description: `${entry.description || `PanelUI ${entry.group} entry`} · editable Cupric-native storyboard`,
      data: {
        durationSec: 9,
        scenes: [
          [entry.name, 3, 'pop', 'text'],
          [entry.description || `Editable ${entry.group} state`, 4, 'word-reveal', 'text'],
          ['Customize in Studio', 2, 'fade-up', 'text'],
        ],
        source: `https://panelui.dev/docs/${entry.group}/${entry.slug}`,
        sourceKind: 'components',
        editable: true,
        agentUsable: true,
        sourceCopied: false,
        license: panel.license,
        platform: panel.platform,
      },
      tags: ['panelui', entry.group, 'editable', 'agent', 'native-storyboard'],
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
  // Exact Google family names + weights, extracted from @remotion/google-fonts
  // (import names drop spaces and spell digits out, so they cannot be loaded).
  const fontMeta = JSON.parse(await readFile(path.join(root, 'resources', 'remotion', 'font-meta.json'), 'utf8')).fonts
  // Every template used to share one placeholder storyboard ("Replace with
  // your content"), so applying any of them produced the same empty-looking
  // edit. Each now has a real, on-brief storyboard for what it is for.
  const REMOTION_STORYBOARDS = {
    audiogram: [['EPISODE 42', 2.5, 'pop'], ['The one habit that doubled our output', 4, 'word-reveal'], ['New episode — listen now', 3.5, 'shimmer']],
    blank: [['Your story starts here', 3, 'fade-up'], ['Add media, text and motion', 3.5, 'word-reveal'], ['Made with Cupric', 2.5, 'shimmer']],
    'code-hike': [['Ship it in three lines', 3, 'typewriter'], ['npm install your-sdk', 3.5, 'typewriter'], ['Read the docs', 3, 'fade-up']],
    electron: [['Your desktop app', 3, 'pop'], ['Native speed. Web skills.', 4, 'word-reveal'], ['Download for Mac and Windows', 3, 'shimmer']],
    helloworld: [['Hello, world', 3, 'pop'], ['Every video starts with one frame', 4, 'word-reveal'], ['Let’s make yours', 3, 'fade-up']],
    'music-visualization': [['NOW PLAYING', 2.5, 'pop'], ['Cover art', 4, 'fade-up', 'media'], ['Out now everywhere', 3.5, 'shimmer']],
    'next-app-tailwind': [['Launch your Next app', 3, 'pop'], ['Tailwind-fast UI, ready to deploy', 4, 'word-reveal'], ['Start building today', 3, 'fade-up']],
    overlay: [['BREAKING', 2, 'pop'], ['Lower thirds that land every time', 4, 'slide-left'], ['Subscribe for more', 3, 'shimmer']],
    'prompt-to-motion-graphics': [['Type a prompt', 3, 'typewriter'], ['Get motion graphics in seconds', 4, 'word-reveal'], ['Try it free', 3, 'pop']],
    'prompt-to-video': [['From prompt to video', 3, 'pop'], ['Describe it. Watch it render.', 4, 'word-reveal'], ['Create your first video', 3, 'fade-up']],
    'react-router': [['Every route, animated', 3, 'pop'], ['Smooth page-to-page stories', 4, 'word-reveal'], ['See the demo', 3, 'fade-up']],
    recorder: [['Record once', 2.5, 'pop'], ['Your screen recording', 4.5, 'fade-up', 'media'], ['Share everywhere', 3, 'shimmer']],
    'render-server': [['Render at scale', 3, 'pop'], ['Thousands of videos, one API', 4, 'word-reveal'], ['Deploy your server', 3, 'fade-up']],
    skia: [['Pixel-perfect graphics', 3, 'glass-rise'], ['GPU-drawn shapes and shaders', 4, 'word-reveal'], ['Draw something bold', 3, 'shimmer']],
    stargazer: [['1,000 STARS', 3, 'pop'], ['Thank you to every contributor', 4, 'word-reveal'], ['Star us on GitHub', 3, 'shimmer']],
    still: [['One perfect frame', 3, 'fade-up'], ['Thumbnails and social cards', 3.5, 'word-reveal'], ['Export as an image', 2.5, 'fade-up']],
    three: [['Step into 3D', 3, 'glass-rise'], ['Depth, light and motion', 4, 'word-reveal'], ['Explore the scene', 3, 'fade-up']],
    tiktok: [['WAIT FOR IT', 2, 'pop'], ['Captions that pop on every word', 4, 'word-reveal'], ['Follow for part 2', 3, 'shimmer']],
    vercel: [['Deployed in seconds', 3, 'pop'], ['Preview every change instantly', 4, 'word-reveal'], ['Ship to production', 3, 'fade-up']],
    'vibe-code': [['Just vibe it', 3, 'liquid-wave'], ['Describe the app. Watch it build.', 4, 'word-reveal'], ['Start vibing', 3, 'pop']],
  }
  const storyboardFor = (t) => (REMOTION_STORYBOARDS[t.id] ?? [[t.name, 3, 'pop'], [`${t.name}, made simple`, 4, 'word-reveal'], ['See it in action', 3, 'fade-up']])
    .map(([text, sec, anim, kind = 'text']) => [text, sec, anim, kind])
  // Developer skills and packages have ids like "add-cli-option" / ".cargo";
  // show them as words, and keep a storyboard body short enough to read.
  const humanName = (id) => {
    const words = String(id).replace(/^[.@]+/, '').replace(/[-_/]+/g, ' ').trim()
    const acronyms = /^(cli|api|ai|ui|ssr|css|html|js|ts|gpu|cpu|mp4|gif|svg|url|sdk|aws|gcp|ffmpeg|webgl|webcodecs|lambda)$/i
    const out = words.split(/\s+/).map((w, i) => (acronyms.test(w) ? w.toUpperCase() : i === 0 ? w.charAt(0).toUpperCase() + w.slice(1) : w)).join(' ')
    return out || String(id)
  }
  const firstSentence = (text, max = 84) => {
    const sentence = String(text).split(/(?<=[.!?])\s/)[0].replace(/\.$/, '')
    if (sentence.length <= max) return sentence
    return sentence.slice(0, max).replace(/\s+\S*$/, '').replace(/[\s,;:–—-]+$/, '') + '…'
  }
  const items = [
    ...remotion.templates.map((t) => ({
      id: `template-${t.id}`,
      kind: 'saas-template',
      name: t.name,
      description: `Editable Cupric-native storyboard for the ${t.name} workflow · upstream ${t.package}`,
      data: {
        durationSec: storyboardFor(t).reduce((sum, scene) => sum + scene[1], 0),
        scenes: storyboardFor(t),
        source: t.source,
        package: t.package,
        editable: true,
        agentUsable: true,
        sourceCopied: false,
      },
      tags: ['remotion', 'template', 'editable', 'agent', 'native-storyboard'],
    })),
    // Helper modules (base, from-info…) are not fonts; only real families ship.
    ...remotion.fonts.names.filter((name) => fontMeta[name]).map((name) => ({
      id: `font-${name}`,
      kind: 'font',
      name: fontMeta[name][0],
      description: 'Google font · Apply sets it on the selected text (or adds a sample). Downloads once, then works offline.',
      data: { provider: remotion.fonts.provider, family: fontMeta[name][0], weights: fontMeta[name][1], latin: fontMeta[name][2] === 1 },
      tags: ['remotion', 'font'],
    })),
    ...remotion.skills.map((skill) => ({
      id: `skill-${skill.id}`,
      kind: 'saas-template',
      name: humanName(skill.name),
      description: `${skill.description} · editable agent-ready storyboard`,
      data: {
        durationSec: 10,
        scenes: [[humanName(skill.name), 3, 'pop', 'text'], [firstSentence(skill.description), 4.5, 'word-reveal', 'text'], ['Automated with Cupric', 2.5, 'fade-up', 'text']],
        source: `${remotion.source.url}/tree/${remotion.source.ref}/.agents/skills/${skill.id}`,
        editable: true,
        agentUsable: true,
        sourceCopied: false,
      },
      tags: ['remotion', 'skill', 'agent', 'editable', 'native-storyboard'],
    })),
    ...(remotion.packages ?? []).map((pkg) => ({
      id: `package-${pkg.id}`,
      kind: 'saas-template',
      name: humanName(pkg.name),
      description: `Editable native capability storyboard · upstream Remotion package remains license-gated`,
      data: {
        durationSec: 8,
        scenes: [[humanName(pkg.name), 3, 'pop', 'text'], [`Built with the ${pkg.name.replace(/^[.@]+/, '')} package`, 5, 'word-reveal', 'text']],
        source: pkg.source,
        license: pkg.license,
        intake: 'original-native-storyboard',
        editable: true,
        agentUsable: true,
        sourceCopied: false,
      },
      tags: ['remotion', 'package', 'agent', 'editable', 'native-storyboard', 'license-review'],
    })),
  ]
  packs.push({
    id: 'remotion',
    name: 'Remotion toolkit',
    description: 'Remotion templates, skills and package capabilities are usable as editable Cupric-native storyboards; every Google font applies to Studio text and downloads once for offline use. No upstream source is vendored.',
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

// Curated link-only UI library index (Mantine, Pixel Perfect UI, Sora UI).
// Hand-maintained in resources/packs/ui-libraries.json — carried through as-is
// so regenerating packs never drops it.
try {
  packs.push(JSON.parse(await readFile(path.join(outDir, 'ui-libraries.json'), 'utf8')))
} catch {
  console.warn('resources/packs/ui-libraries.json not readable — skipping the UI libraries pack')
}

// Hand-picked free essentials (libraries, fonts, icons, media) — curated file.
try {
  packs.push(JSON.parse(await readFile(path.join(outDir, 'essentials.json'), 'utf8')))
} catch {
  console.warn('resources/packs/essentials.json not readable — skipping Essentials')
}

// Motion kit — fonts, Javis.jl concepts (curated file).
try {
  packs.push(JSON.parse(await readFile(path.join(outDir, 'motion-kit.json'), 'utf8')))
} catch {
  console.warn('resources/packs/motion-kit.json not readable — skipping Motion kit')
}

// framecn (MIT) video components — vendored + recorded like lab components.
try {
  const fc = JSON.parse(await readFile(path.join(root, 'src', 'lab', 'framecn', 'entries.json'), 'utf8'))
  packs.push({
    id: 'framecn',
    name: 'framecn — video captions, type, transitions, scenes, shaders',
    description: `${fc.count} video components from framecn.dev (MIT), vendored into src/lab/framecn. Captions, kinetic typography, transitions, full product scenes and WebGL shader backgrounds; each records into the Studio with editable props.`,
    version: VERSION,
    source: fc.source,
    license: 'MIT (framecn); shaders via @paper-design/shaders-react (Apache-2.0)',
    items: fc.entries.map((e) => ({
      id: e.slug,
      kind: 'component',
      name: e.name,
      description: e.description,
      data: { category: e.category, license: 'MIT', attribution: `framecn — ${fc.repo}`, upstream: `${fc.repo}/tree/main/registry/bases/editframe/components/${e.dir}` },
      tags: ['component', 'framecn', 'video', e.category],
    })),
  })
} catch {
  console.warn('src/lab/framecn/entries.json not readable — skipping the framecn pack')
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
