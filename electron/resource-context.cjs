'use strict'
/**
 * Resource selection for autonomous generation.
 *
 * Searches EVERY bundled pack listed in resources/packs/index.json (UI Lab
 * components, PanelUI, React Bits, Skiper, external UI, Mantine / Pixel
 * Perfect / Sora UI, backgrounds, effects, templates, sources…), not a
 * hand-picked subset. Font entries are excluded (they're typography, chosen
 * elsewhere) and voice commands aren't visual.
 *
 * Selection is by *function*, not just keywords: every rundown scene is
 * classified as a beat (opener / feature / proof / social-proof / gallery /
 * cta / close), the beat decides which motion fits, and each scene gets a
 * layered composition (background → main → accent) rather than one resource
 * per scene. Pure: fs + path only, so it is unit-tested directly.
 */
const fs = require('node:fs')
const path = require('node:path')

const STOP = new Set(['the', 'and', 'for', 'with', 'this', 'that', 'from', 'into', 'your', 'our', 'video', 'scene', 'motion', 'seconds', 'make', 'show', 'about', 'will', 'then'])
const SKIP_KINDS = new Set(['font', 'voice'])

/** What each beat is for, and the motion that serves that purpose. */
const BG_HERO = /mesh|gradient|aurora|particle|field background|shader|wave|liquid|orbit|dither|galaxy|nebula/
const BG_CALM = /grid|dots?|noise|paper|void|wash|spotlight|subtle|stage|halftone|checker/
/** The canonical primitive for each beat/layer — preferred when it exists. */
const PREFER = {
  opener: { background: /mesh gradient|mesh-gradient|particle/, main: /split|kinetic|headline|text reveal/ },
  feature: { main: /bento|scroll reveal/, accent: /badge|pill/ },
  proof: { background: /grid|dot|noise/, main: /stat counter|count(s)? up|number ticker|counter/ },
  'social-proof': { main: /marquee|testimonial/ },
  gallery: { main: /infinite scrolling images|scroll gallery|infinite scroll|gallery/ },
  cta: { background: /spotlight|grid|dot/, main: /magnetic/, accent: /spotlight/ },
  close: { main: /logo/ },
}
const BEATS = {
  opener: { motion: 'mesh-gradient drift or a particle / 3D field behind the headline, headline resolves over it. Reserve hero backgrounds for openers — never mid-video behind busy content.', want: { background: BG_HERO, main: /headline|title|kinetic|split text|text reveal|word|type|letter|scramble|blur reveal|shimmer text/ }, layers: ['background', 'main'] },
  feature: { motion: 'build-in reveal: elements rise/fade in with a 60–90ms stagger (scroll-reveal / bento build).', want: { main: /bento|feature|scroll reveal|reveal|card grid|tiles?|stagger/, accent: /badge|pill|chip|tag/ }, layers: ['main', 'accent'] },
  proof: { motion: 'build-in reveal, then numbers count up to their real value (stat counter); charts draw on. Never overshoot a figure.', want: { background: BG_CALM, main: /stat|counter|count up|number|chart|metric|kpi|ticker|sparkline|ring progress|gauge/ }, layers: ['background', 'main'] },
  'social-proof': { motion: 'marquee of logos/quotes, or staggered card reveal — never a static drop. Leave testimonial copy as empty placeholders.', want: { main: /marquee|testimonial|logo|quote|avatar|review|tweet/ }, layers: ['main'] },
  gallery: { motion: "the component's native scroll-driven motion (e.g. Sora UI infinite scrolling images, scroll gallery) — driven by the timeline, not frozen as a still.", want: { main: /gallery|scrolling images|infinite scroll|carousel|image stack|slider|filmstrip|product/ }, layers: ['main'] },
  cta: { motion: 'magnetic-button pull + cursor-spotlight gradient on the one thing to act on; a tap/press at the end.', want: { background: BG_CALM, main: /magnetic button|magnetic|cta button|call to action|button/, accent: /spotlight|cursor glow|glow|shine|shimmer/ }, layers: ['background', 'main', 'accent'] },
  close: { motion: 'calm settle: logo/brand resolves, motion slows; no hero backgrounds or busy components.', want: { main: /logo|signature|brand|resolve|fade/ }, layers: ['main'] },
}

function classifyBeat(scene, index, count) {
  const text = `${scene?.type || ''} ${scene?.copy || ''} ${scene?.motion || ''}`.toLowerCase()
  if (/\b(cta|call to action|sign ?up|buy|download|get started|start free|try|order|book|subscribe)\b/.test(text)) return 'cta'
  if (/\b(testimonial|review|trusted|customers? say|logos?|loved by)\b/.test(text)) return 'social-proof'
  if (/\b(\d+[%x×]|\d[\d,.]*\s*(users|customers|hours|faster|saved|k|m)|stat|metric|results?|proof|numbers?)\b/.test(text)) return 'proof'
  if (/\b(gallery|showcase|products?|collection|shots?|screens?|portfolio|lookbook)\b/.test(text)) return 'gallery'
  if (index === 0 || /\b(hook|intro|open|opener|hero|title)\b/.test(text)) return 'opener'
  if (index === count - 1 || /\b(outro|close|end|logo|sign ?off)\b/.test(text)) return count > 1 ? 'close' : 'opener'
  return 'feature'
}

function loadAll(dir) {
  let index
  try { index = JSON.parse(fs.readFileSync(path.join(dir, 'index.json'), 'utf8')) } catch { index = { packs: [] } }
  const ids = (index.packs || []).map((p) => p.id)
  const items = []
  const perPack = {}
  for (const id of ids) {
    try {
      const pack = JSON.parse(fs.readFileSync(path.join(dir, `${id}.json`), 'utf8'))
      const list = (Array.isArray(pack.items) ? pack.items : []).filter((it) => !SKIP_KINDS.has(it.kind))
      perPack[id] = list.length
      for (const it of list) items.push({ ...it, pack: id })
    } catch {
      perPack[id] = 0
    }
  }
  return { items, perPack }
}

const textOf = (it) => `${it.name || ''} ${it.description || ''} ${(it.tags || []).join(' ')} ${it.data?.motionRole || ''} ${it.data?.category || ''} ${it.id || ''}`.toLowerCase()

/** Layer each kind of item can fill. */
function layerOf(it) {
  const t = textOf(it)
  if (it.kind === 'background' || it.kind === 'glass' || /background|mesh-gradient|particle|aurora|shader/.test(t)) return 'background'
  if (/button|cta|badge|spotlight|magnetic|pill|toggle/.test(t)) return 'accent'
  return 'main'
}

function automationResourceContext(brief, rundown, dir) {
  if (!dir) return { components: [], templates: [], sources: [], scenes: [], searched: { total: 0, packs: {} }, prompt: '' }
  const { items, perPack } = loadAll(dir)
  const haystack = `${brief || ''} ${rundown?.style || ''} ${(rundown?.scenes || []).map((s) => `${s.type} ${s.copy} ${s.motion}`).join(' ')}`
  const terms = Array.from(new Set(String(haystack).toLowerCase().match(/[a-z][a-z0-9-]{2,}/g) || [])).filter((w) => !STOP.has(w))
  const keyword = (it) => { const t = textOf(it); return terms.reduce((n, term) => (t.includes(term) ? n + 1 : n), 0) }
  // Local, recordable Lab components (and native storyboards) beat link-only references.
  const native = (it) => (
    it.pack === 'iphone-duo' ? 5 :
      it.pack === 'components' ? 3 :
        it.pack === 'backgrounds' ? 2 :
          it.pack === 'dashi-motion' ? 1.5 :
            it.kind === 'saas-template' ? 0.8 : 0
  )

  const scenes = (rundown?.scenes || []).slice(0, 12)
  const used = new Set()
  const scenePlans = scenes.map((scene, i) => {
    const beat = classifyBeat(scene, i, scenes.length)
    const spec = BEATS[beat]
    const local = `${scene.type || ''} ${scene.copy || ''} ${scene.motion || ''}`.toLowerCase().match(/[a-z][a-z0-9-]{2,}/g) || []
    const layers = {}
    for (const layer of spec.layers) {
      let best = null
      for (const it of items) {
        const lay = layerOf(it)
        if (used.has(it.id) || (lay !== layer && !(beat === 'cta' && layer === 'main' && lay === 'accent'))) continue
        if (beat !== 'opener' && layer === 'background' && /mesh|particle|aurora|shader|3d|liquid/.test(textOf(it))) continue // hero fields are for openers
        const t = textOf(it)
        const own = `${it.name || ''} ${it.description || ''}`.toLowerCase()
        const want = spec.want[layer]
        if (want && !want.test(own)) continue // must actually be the right kind of thing
        const prefer = PREFER[beat]?.[layer]
        const score = 4 + (prefer && prefer.test(own) ? 4 : 0) + (it.data?.motionRole === beat ? 1 : 0) + local.reduce((n, w) => (own.includes(w) ? n + 1.5 : n), 0) + keyword(it) * 0.2 + native(it)
        if (!best || score > best.score || (score === best.score && it.id < best.it.id)) best = { it, score }
      }
      if (best) { layers[layer] = best.it; used.add(best.it.id) }
    }
    return { index: i, beat, motion: spec.motion, layers, copy: String(scene.copy || '').slice(0, 80) }
  })

  const top = (filter, limit) => items.filter(filter).map((it) => ({ it, s: keyword(it) + native(it) })).sort((a, b) => b.s - a.s || (a.it.id < b.it.id ? -1 : 1)).slice(0, limit).map((e) => e.it)
  const components = top((it) => it.kind === 'component' || it.kind === 'block' || it.kind === 'saas-template', 12)
  const templates = top((it) => it.kind === 'template', 4)
  const sources = top((it) => it.kind === 'source', 6)
  const total = Object.values(perPack).reduce((a, b) => a + b, 0)

  const lines = [`Searched ${total} registered resources across ${Object.keys(perPack).length} packs (${Object.entries(perPack).map(([k, v]) => `${k} ${v}`).join(', ')}).`]
  if (scenePlans.length) {
    lines.push('', 'SCENE-BY-SCENE DIRECTION — the beat decides the motion; layer resources (background → main → accent) instead of one per scene:')
    for (const p of scenePlans) {
      const parts = ['background', 'main', 'accent'].filter((l) => p.layers[l]).map((l) => `${l}: ${p.layers[l].name} [${p.layers[l].pack}]`)
      lines.push(`- Scene ${p.index + 1} (${p.beat}${p.copy ? ` — “${p.copy}”` : ''}): ${parts.join(' · ') || 'type-led, no component'}. Motion: ${p.motion}`)
    }
  }
  if (components.length) {
    lines.push('', 'OTHER MATCHING COMPONENTS you may re-create in HTML/CSS (match their behaviour, not their code; link-only libraries are never copied):')
    lines.push(...components.map((c) => `- ${c.name} [${c.pack}]: ${String(c.description || '').slice(0, 140)}`))
  }
  const nativeActions = items.filter((it) => it.data?.nativeAction)
  if (nativeActions.length) {
    lines.push('', 'NATIVE CUPRIC ACTIONS — when the final result is an editable Studio project, prefer these allowlisted actions over an opaque approximation; when the current job is standalone HTML, reproduce only the behaviour with deterministic inline geometry:')
    lines.push(...nativeActions.map((action) => `- ${action.name}: ${action.data.nativeAction}(${action.data.design || action.id}) — ${String(action.description || '').slice(0, 180)}`))
  }
  if (templates.length) {
    lines.push('', 'EXISTING CUPRIC SCENE TEMPLATES whose structure is already proven to render (mirror their timing shape):')
    lines.push(...templates.map((t) => `- ${t.name} (${t.data?.durationSec ?? '?'}s): ${t.description}`))
  }
  if (sources.length) {
    lines.push('', 'HOUSE STYLE CUES from the Cupric sources catalogue:')
    lines.push(...sources.map((s) => `- ${s.name}: ${s.data?.promptCue || s.description}`))
  }
  return { components, templates, sources, scenes: scenePlans, searched: { total, packs: perPack }, prompt: lines.join('\n') }
}

module.exports = { automationResourceContext, classifyBeat, BEATS }
