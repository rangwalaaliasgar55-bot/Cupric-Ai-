/**
 * One "Apply" for every resource in every pack.
 *
 * Before this, only glass / backgrounds / animations / transitions / effects
 * reached the timeline. Components opened another screen, templates stalled on
 * a modal that refused without media, fonts and icons opened a website, and
 * HTML scenes copied a file path. Each of those read as "Apply doesn't work".
 *
 * `applyResource` answers every item with something that lands in the edit:
 *
 *   glass, background, animation,  → native clip at the playhead (a background
 *   transition, effect                 gets a new bottom track rather than
 *                                      covering what is already there)
 *   saas-template (storyboards)     → a directed multi-layer edit (storyboard.ts)
 *   component (Lab demo)            → Lab renders its real motion into frames
 *   component / block (external)    → rebuilt as an editable native scene
 *   icon                            → glass mark + wordmark
 *   font                            → set on the selected text, or a sample
 *   template (HTML scene)           → rendered frame-by-frame into a clip
 *   voice                           → runs the command in Studio
 *   source, provider, skill         → reference links (not timeline media)
 *
 * The function is pure. Anything that needs the DOM (Lab capture, HTML frame
 * capture, font download, running a voice command) comes back as an action
 * the UI performs, so the same code serves the button and the stage drop and
 * can be tested over every catalogue item in Node.
 */
import type { StudioClip, StudioDoc, StudioGlassClip, StudioTextClip } from '../../types/project'
import { uid } from '../utils'
import { STUDIO_BACKGROUNDS } from './backgrounds'
import { MAX_TRACKS, defaultGlassClip, defaultStickerClip, defaultTextClip, docDuration, placeClip, trackIsFree } from './doc'
import { motionPatch, type DirectionStyle } from './motionDirector'
import { resourceToStudio } from './resourceDrop'
import {
  LOOKS,
  SAMPLE_COPY,
  backgroundFor,
  classifyResource,
  textAnimFor,
  transitionFor,
  type Archetype,
} from './resourceLook'
import { findComponent, withComponent } from './components'
import { buildStoryboard, directText, frameRatio, panelSize, placeLayers, plateBehind, templateSlots, type TemplateFillData } from './storyboard'
import { TRANSITIONS } from './transitions'

export type ApplyItem = {
  kind: string
  id: string
  name: string
  description?: string
  data?: Record<string, unknown>
  source?: string
  css?: string
  tags?: string[]
}

export type ApplyContext = {
  /** Playhead, seconds. */
  atSec: number
  selectedId?: string | null
  /** Project brief lines, title first (template auto-fill). */
  brief?: string[]
  brandName?: string
  /** True when the Lab has a runnable demo for this slug. */
  hasLabDemo?: (slug: string) => boolean
}

export type ApplyResult =
  | { ok: true; type: 'doc'; doc: StudioDoc; focusId: string | null; focusSec: number; message: string; font?: { family: string; weights: number[] }; needsStudio?: boolean }
  | { ok: true; type: 'html-template'; file: string; name: string; durationSec: number; size: [number, number]; atSec: number; message: string }
  | { ok: true; type: 'voice-command'; phrase: string; message: string }
  | { ok: true; type: 'link'; url: string | null; cue: string; message: string }
  | { ok: false; reason: string }

/** What the Apply button says for an item — every kind has a real verb. */
export function applyLabel(item: Pick<ApplyItem, 'kind' | 'id' | 'source' | 'data'>): string {
  switch (item.kind) {
    case 'saas-template':
      return 'Apply template'
    case 'component':
      return 'Apply to timeline'
    case 'font':
      return 'Apply font'
    case 'voice':
      return 'Run command'
    case 'source':
    case 'provider':
    case 'skill':
      return 'Open link'
    case 'transition':
      return 'Apply transition'
    case 'effect':
      return 'Apply effect'
    default:
      return 'Apply to timeline'
  }
}

/* ——— helpers ——————————————————————————————————————————————————————— */

const round2 = (n: number) => Math.round(n * 100) / 100
const SCENE_SEC = 4

function firstSentence(text: string | undefined, max = 72): string {
  const t = String(text ?? '').split(' · ')[0].split(/(?<=[.!?])\s/)[0].replace(/\.$/, '').trim()
  if (t.length <= max) return t
  return t.slice(0, max).replace(/\s+\S*$/, '').replace(/[\s,;:–—-]+$/, '') + '…'
}

function visibleMoment(clip: { startSec: number; durationSec: number }): number {
  return round2(clip.startSec + Math.min(0.8, clip.durationSec / 2))
}

/**
 * Put a background under everything at the playhead: on track 0 when it is
 * free there, otherwise on a new bottom track (every other clip moves up one)
 * so a background can never cover footage or text.
 */
function withBackgroundClip(doc: StudioDoc, clip: StudioClip): { doc: StudioDoc; clip: StudioClip } {
  const end = clip.startSec + clip.durationSec
  if (trackIsFree(doc, 0, clip.startSec, end)) {
    const placed = { ...clip, track: 0 } as StudioClip
    return { doc: { ...doc, trackCount: Math.max(1, doc.trackCount), clips: [...doc.clips, placed] }, clip: placed }
  }
  if (doc.trackCount < MAX_TRACKS && doc.clips.every((c) => c.track < MAX_TRACKS - 1)) {
    const lifted = doc.clips.map((c) => ({ ...c, track: c.track + 1 }) as StudioClip)
    const placed = { ...clip, track: 0 } as StudioClip
    return { doc: { ...doc, trackCount: Math.min(MAX_TRACKS, doc.trackCount + 1), clips: [...lifted, placed] }, clip: placed }
  }
  // Every track is taken: set it as the stage instead, which paints beneath all.
  return { doc: { ...doc, backgroundId: (clip as { backgroundId?: string }).backgroundId ?? doc.backgroundId }, clip }
}

/** Place one clip at the playhead on the first free track (creating tracks). */
function withPlacedClip(doc: StudioDoc, clip: StudioClip, atSec: number): { doc: StudioDoc; clip: StudioClip } {
  const placed = placeClip(doc, { ...clip, startSec: round2(Math.max(0, atSec)) } as StudioClip)
  return { doc: { ...doc, trackCount: placed.trackCount, clips: [...doc.clips, placed.clip] }, clip: placed.clip }
}

/** Several layers that must overlap in time: each gets its own track, bottom → top. */
function withLayers(doc: StudioDoc, atSec: number, durationSec: number, layers: StudioClip[]): { doc: StudioDoc; clips: StudioClip[]; start: number } {
  const { start, tracks, trackCount } = placeLayers(doc, atSec, durationSec, layers.length, 1)
  const delta = start - layers[0].startSec
  const clips = layers.map((layer, i) => ({ ...layer, track: tracks[i], startSec: round2(layer.startSec + delta) }) as StudioClip)
  return { doc: { ...doc, trackCount, clips: [...doc.clips, ...clips] }, clips, start }
}

/* ——— native scenes for component-like references ———————————————— */

function sceneLayers(doc: StudioDoc, item: ApplyItem, archetype: Archetype, at: number): StudioClip[] {
  const aspect = doc.aspect
  const look = LOOKS[archetype]
  const style: DirectionStyle = look.style
  const sample = SAMPLE_COPY[archetype]
  const ratio = frameRatio(aspect)
  const name = item.name.trim() || 'Component'
  const d = SCENE_SEC
  const text = (copy: string, role: 'hero' | 'body' | 'cta' | 'caption', y: number, delay = 0, anim = look.textAnim, index = 0): StudioTextClip => {
    const clip = defaultTextClip(at + delay, 1)
    clip.name = `${name} · ${role === 'hero' ? 'title' : role}`
    clip.text = copy
    clip.durationSec = d - delay
    clip.y = y
    directText(clip, role, { aspect, style, templateAnim: anim, index, isLast: false })
    clip.durationSec = d - delay
    return clip
  }
  const glass = (preset: string, shape: 'panel' | 'lens', w: number, h: number, y: number, label = '', delay = 0, x = 0.5): StudioGlassClip => {
    const clip = defaultGlassClip(at + delay, 1, preset, shape)
    const size = shape === 'lens' ? { w: w / (ratio < 1 ? 0.62 : 1), h } : panelSize(aspect, w, h)
    clip.name = `${name} · ${shape === 'lens' ? 'lens' : 'panel'}`
    clip.durationSec = d - delay
    clip.x = x
    clip.y = y
    clip.w = Math.min(0.94, size.w)
    clip.h = size.h
    clip.label = label
    if (shape === 'lens') clip.radiusPct = 50
    Object.assign(clip, motionPatch(clip, { entrance: shape === 'lens' ? 'scale-pop' : 'rise-in', emphasis: shape === 'lens' ? 'float' : 'breathe', exit: 'fade-out', intensity: 0.9 }))
    return clip
  }

  switch (archetype) {
    case 'text':
      return [text(sample.title, 'hero', 0.48, 0, textAnimFor(name))]
    case 'counter':
      return [text(/\d/.test(name) ? name : sample.title, 'hero', 0.44, 0, 'typewriter'), text(sample.body, 'body', 0.58, 0.25, 'word-reveal', 1)]
    case 'loader': {
      const ring = defaultStickerClip(at, 1, 'pulse-ring')
      ring.name = `${name} · spinner`
      ring.durationSec = d
      ring.y = 0.42
      ring.scale = 0.7
      Object.assign(ring, motionPatch(ring, { entrance: 'scale-pop', exit: 'fade-out', intensity: 0.8 }))
      return [ring, text(sample.title, 'body', 0.62, 0.1, 'typewriter', 1)]
    }
    case 'chart': {
      const heights = [0.14, 0.22, 0.3, 0.4]
      const base = 0.72
      const barW = ratio < 1 ? 0.13 : 0.07
      const bars = heights.map((h, i) => {
        const bar = defaultGlassClip(at + 0.12 * i, 1, look.glassPreset, 'panel')
        bar.name = `${name} · bar ${i + 1}`
        bar.durationSec = d - 0.12 * i
        bar.w = barW
        bar.h = h
        bar.x = 0.5 + (i - 1.5) * barW * 1.35
        bar.y = base - h / 2
        bar.radiusPct = 18
        bar.motion = 'static'
        Object.assign(bar, motionPatch(bar, { entrance: 'rise-in', exit: 'fade-out', intensity: 1 }))
        return bar
      })
      return [...bars, text(sample.title, 'hero', 0.26, 0.3, 'word-reveal')]
    }
    case 'button': {
      const label = /button|cta|link|pill/i.test(name) ? sample.title : name
      const pillText = text(label, 'cta', 0.5, 0, 'shimmer')
      const plate = plateBehind(pillText, aspect, look.glassPreset, 1)
      const cursor = defaultStickerClip(at + 0.4, 1, 'arrow-nudge')
      cursor.name = `${name} · pointer`
      cursor.durationSec = d - 0.4
      cursor.x = Math.min(0.9, 0.5 + plate.w / 2 + 0.04)
      cursor.y = 0.58
      cursor.scale = 0.35
      return [plate, pillText, cursor]
    }
    case 'menu':
      return [glass(look.glassPreset, 'panel', 0.74, 0.12, 0.5, sample.title), text(sample.body, 'body', 0.66, 0.3, 'word-reveal', 1)]
    case 'social':
      return [
        glass(look.glassPreset, 'panel', 0.6, 0.32, 0.52),
        glass('lens', 'lens', 0.1, 0.1, 0.3, 'YB', 0.15),
        text(sample.title, 'body', 0.46, 0.2, 'word-reveal', 1),
        text(sample.body, 'caption', 0.56, 0.35, 'word-reveal', 2),
      ]
    case 'media':
      return [glass(look.glassPreset, 'panel', 0.62, 0.52, 0.44, sample.title), text(firstSentence(name), 'caption', 0.84, 0.3, 'word-reveal')]
    case 'card':
      return [glass(look.glassPreset, 'panel', 0.62, 0.36, 0.5), text(sample.title, 'body', 0.45, 0.15, 'word-reveal', 1), text(sample.body, 'caption', 0.55, 0.3, 'word-reveal', 2)]
    case 'icon': {
      const mark = glass('lens', 'lens', 0.2, 0.2, 0.42, name.replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('') || '★')
      return [mark, text(name, 'cta', 0.66, 0.2, 'shimmer')]
    }
    default:
      return [glass(look.glassPreset, 'panel', 0.64, 0.36, 0.5), text(name, 'body', 0.45, 0.1, 'word-reveal', 1), text(firstSentence(item.description) || sample.body, 'caption', 0.56, 0.25, 'word-reveal', 2)]
  }
}

/** Nothing to transition between yet: two title cards joined by the move. */
function transitionDemo(doc: StudioDoc, itemName: string, transition: StudioClip['transitionIn'], transitionName: string, atSec: number): ApplyResult {
  const before = defaultTextClip(0, 1)
  before.text = SAMPLE_COPY.transition.title
  before.name = `${itemName} · before`
  const after = defaultTextClip(2, 1)
  after.text = SAMPLE_COPY.transition.body
  after.name = `${itemName} · after`
  for (const clip of [before, after]) {
    clip.durationSec = 2
    directText(clip, 'hero', { aspect: doc.aspect, style: 'cinematic', templateAnim: 'shimmer', index: 0, isLast: false })
    clip.durationSec = 2
  }
  after.transitionIn = transition
  const stage: StudioClip = { id: uid(), kind: 'background', track: 0, startSec: round2(atSec), durationSec: 4, name: `${itemName} · stage`, transitionIn: 'fade', transitionOut: 'fade', opacity: 1, backgroundId: LOOKS.transition.backgroundId }
  let next = withBackgroundClip(doc, stage).doc
  const placed = withLayers(next, atSec, 4, [before])
  next = placed.doc
  const afterPlaced = { ...after, track: placed.clips[0].track, startSec: round2(placed.start + 2) } as StudioClip
  next = { ...next, clips: [...next.clips, afterPlaced] }
  return { ok: true, type: 'doc', doc: next, focusId: afterPlaced.id, focusSec: round2(placed.start + 2.1), message: `“${itemName}” added as a ${transitionName} transition demo — put your own clips on the timeline to use it between shots.` }
}

function applySceneLike(doc: StudioDoc, item: ApplyItem, ctx: ApplyContext, label: string): ApplyResult {
  const archetype = classifyResource({ name: item.name, kind: item.kind, category: String(item.data?.category ?? ''), description: item.description })

  if (archetype === 'transition') {
    const transition = transitionFor(item.name)
    const known = TRANSITIONS.find((t) => t.id === transition) ?? TRANSITIONS.find((t) => t.id === 'fade')!
    const visual = doc.clips.filter((c) => c.kind !== 'audio')
    if (visual.length) {
      // Nearest clip edge to the playhead gets the transition.
      const target = [...visual].sort((a, b) => {
        const dist = (c: StudioClip) => Math.min(Math.abs(c.startSec - ctx.atSec), Math.abs(c.startSec + c.durationSec - ctx.atSec))
        return dist(a) - dist(b) || b.startSec - a.startSec
      })[0]
      const next = { ...doc, clips: doc.clips.map((c) => (c.id === target.id ? ({ ...c, transitionIn: known.id } as StudioClip) : c)) }
      return { ok: true, type: 'doc', doc: next, focusId: target.id, focusSec: round2(target.startSec + 0.15), message: `“${item.name}” applied as a ${known.name} transition into “${target.name}”.` }
    }
    return transitionDemo(doc, item.name, known.id, known.name, ctx.atSec)
  }

  if (archetype === 'background') {
    const backgroundId = backgroundFor(`${item.name} ${item.description ?? ''}`)
    const clip: StudioClip = { id: uid(), kind: 'background', track: 0, startSec: round2(ctx.atSec), durationSec: SCENE_SEC, name: item.name, transitionIn: 'fade', transitionOut: 'fade', opacity: 1, backgroundId }
    const { doc: next, clip: placed } = withBackgroundClip(doc, clip)
    const painter = STUDIO_BACKGROUNDS.find((b) => b.id === backgroundId)?.name ?? backgroundId
    return { ok: true, type: 'doc', doc: next, focusId: placed.id, focusSec: visibleMoment(placed), message: `“${item.name}” added as an editable ${painter} background under your edit.` }
  }

  const layers = sceneLayers(doc, item, archetype, round2(ctx.atSec))
  const span = Math.max(...layers.map((l) => l.startSec + l.durationSec)) - Math.min(...layers.map((l) => l.startSec))
  const placed = withLayers(doc, ctx.atSec, span, layers)
  const focus = placed.clips.find((c) => c.kind === 'text') ?? placed.clips[0]
  const moved = placed.start > ctx.atSec + 0.01 ? ` at ${placed.start.toFixed(1)}s (the playhead had no room)` : ''
  return {
    ok: true,
    type: 'doc',
    doc: placed.doc,
    focusId: focus.id,
    focusSec: visibleMoment({ startSec: placed.start, durationSec: span }),
    message: `“${item.name}” ${label} as ${placed.clips.length} editable layer${placed.clips.length === 1 ? '' : 's'}${moved}.`,
  }
}

/* ——— the entry point ——————————————————————————————————————————————— */

export function applyResource(doc: StudioDoc, item: ApplyItem, ctx: ApplyContext): ApplyResult {
  const atSec = Math.max(0, Number.isFinite(ctx.atSec) ? ctx.atSec : 0)

  switch (item.kind) {
    case 'glass':
    case 'animation':
    case 'effect':
    case 'transition':
    case 'background': {
      // Chrome gradients are CSS twins of native painters: use the painter.
      let payload = { kind: item.kind, id: item.id, name: item.name, description: item.description, data: item.data }
      if (item.kind === 'background' && !STUDIO_BACKGROUNDS.some((b) => b.id === item.id)) {
        const twin = item.id.replace(/^chrome-/, '')
        const id = STUDIO_BACKGROUNDS.some((b) => b.id === twin) ? twin : backgroundFor(item.name)
        payload = { ...payload, id }
      }
      const hasVisual = doc.clips.some((c) => c.kind !== 'audio')
      if (item.kind === 'transition' && !hasVisual) {
        const known = TRANSITIONS.find((t) => t.id === item.id)
        if (!known) return { ok: false, reason: `The renderer has no transition called “${item.id}”.` }
        return transitionDemo(doc, item.name, known.id, known.name, atSec)
      }
      let base = doc
      let result = resourceToStudio(base, payload, atSec)
      if (!result.ok && !hasVisual && item.kind === 'effect') {
        // Effects that act on a clip (mask wipe, overshoot) get a title to act on.
        const title = defaultTextClip(atSec, 1)
        title.name = `${item.name} · title`
        title.text = SAMPLE_COPY.text.title
        title.durationSec = SCENE_SEC
        directText(title, 'hero', { aspect: doc.aspect, style: 'editorial', templateAnim: 'shimmer', index: 0, isLast: true })
        title.durationSec = SCENE_SEC
        base = withPlacedClip(doc, title, atSec).doc
        result = resourceToStudio(base, payload, atSec)
      }
      if (!result.ok) return result
      doc = base
      if ('action' in result) return applyResource(doc, { ...item, kind: 'component' }, ctx)
      if ('docPatch' in result) {
        const next = { ...doc, ...result.docPatch }
        const changed = (result.docPatch.clips ?? []).find((c) => !doc.clips.some((o) => o === c))
        return { ok: true, type: 'doc', doc: next, focusId: changed?.id ?? null, focusSec: changed ? round2(changed.startSec + 0.15) : atSec, message: result.message }
      }
      const clip = result.clip
      const { doc: next, clip: placed } = clip.kind === 'background' ? withBackgroundClip(doc, { ...clip, startSec: round2(atSec) } as StudioClip) : withPlacedClip(doc, clip, atSec)
      return { ok: true, type: 'doc', doc: next, focusId: placed.id, focusSec: visibleMoment(placed), message: result.message.replace(/ at \d+(\.\d+)?s\./, '.') }
    }

    case 'saas-template': {
      const data = (item.data ?? {}) as TemplateFillData
      if (!templateSlots(data).length) {
        // No storyboard at all: still apply, as a titled scene.
        return applySceneLike(doc, { ...item, kind: 'component' }, ctx, 'added')
      }
      const archetype = classifyResource({ name: item.name, category: String(item.data?.category ?? ''), description: item.description })
      const board = buildStoryboard(doc, data, item.name, {}, { brief: ctx.brief, brandName: ctx.brandName, archetype })
      const focus = board.clips.find((c) => c.id === board.focusId) ?? board.clips[0]
      const extra = board.placeholders.length ? ` ${board.placeholders.length} media slot${board.placeholders.length === 1 ? ' has' : 's have'} a placeholder panel — import footage to fill ${board.placeholders.length === 1 ? 'it' : 'them'}.` : ''
      const filled = ctx.brief?.length ? ' Copy filled from your brief.' : ''
      return {
        ok: true,
        type: 'doc',
        doc: board.doc,
        focusId: board.focusId,
        focusSec: focus ? visibleMoment(focus) : board.startSec,
        message: `“${item.name}” applied: ${board.clips.length} layers, ${board.durationSec.toFixed(1)}s at ${board.startSec.toFixed(1)}s.${filled}${extra}`,
      }
    }

    case 'component': {
      const external = Boolean(item.source || item.data?.source || item.data?.provider)
      if (!external && findComponent(item.id) && (ctx.hasLabDemo?.(item.id) ?? true)) {
        // The real component, recorded with its real animation by the Studio.
        const added = withComponent(doc, item.id, { startSec: atSec, recordSec: 4, durationSec: 4 })
        const clip = { ...added.clip, ...motionPatch(added.clip, { entrance: 'rise-in', exit: 'fade-out', intensity: 0.8 }) } as StudioClip
        return {
          ok: true,
          type: 'doc',
          doc: { ...added.doc, clips: added.doc.clips.map((c) => (c.id === clip.id ? clip : c)) },
          focusId: clip.id,
          focusSec: visibleMoment(clip),
          needsStudio: true,
          message: `“${item.name}” added — the Studio is recording its real animation into the clip.`,
        }
      }
      return applySceneLike(doc, item, ctx, 'rebuilt natively')
    }

    case 'block':
      return applySceneLike(doc, item, ctx, 'rebuilt natively')

    case 'icon':
      return applySceneLike(doc, { ...item, kind: 'icon' }, ctx, 'added')

    case 'font': {
      const family = String(item.data?.family ?? item.name).trim()
      const weights = Array.isArray(item.data?.weights) ? (item.data!.weights as number[]).filter((w) => Number.isFinite(w)) : [400, 700]
      const target = doc.clips.find((c) => c.id === ctx.selectedId && c.kind === 'text')
      if (target) {
        const next = { ...doc, clips: doc.clips.map((c) => (c.id === target.id ? ({ ...c, fontFamily: family } as StudioClip) : c)) }
        return { ok: true, type: 'doc', doc: next, focusId: target.id, focusSec: visibleMoment(target), message: `${family} applied to “${target.name}”.`, font: { family, weights } }
      }
      const sample = defaultTextClip(atSec, 1)
      sample.name = `${family} sample`
      sample.text = family
      sample.fontFamily = family
      sample.durationSec = 3
      sample.fontSizePct = Math.min(9, Math.max(4, (0.8 * frameRatio(doc.aspect)) / (Math.max(6, family.length) * 0.6) * 100))
      sample.weight = weights.includes(800) ? 800 : weights.includes(600) ? 600 : 400
      Object.assign(sample, motionPatch(sample, { entrance: 'rise-in', exit: 'fade-out', intensity: 0.8 }))
      sample.anim = 'word-reveal'
      const { doc: next, clip } = withPlacedClip(doc, sample, atSec)
      return { ok: true, type: 'doc', doc: next, focusId: clip.id, focusSec: visibleMoment(clip), message: `Added a ${family} title. Select any text and apply a font to restyle it.`, font: { family, weights } }
    }

    case 'template': {
      const data = (item.data ?? {}) as { file?: string; durationSec?: number; size?: [number, number] }
      if (!data.file) return { ok: false, reason: `“${item.name}” is missing its scene file.` }
      return {
        ok: true,
        type: 'html-template',
        file: data.file,
        name: item.name,
        durationSec: Math.min(12, Math.max(1, Number(data.durationSec) || 4)),
        size: Array.isArray(data.size) && data.size.length === 2 ? [Number(data.size[0]) || 1080, Number(data.size[1]) || 1920] : [1080, 1920],
        atSec,
        message: `Rendering “${item.name}” into an animated clip…`,
      }
    }

    case 'voice': {
      const phrase = (item.name.match(/"([^"]+)"/)?.[1] ?? item.name).replace(/[“”"]/g, '').trim()
      return { ok: true, type: 'voice-command', phrase, message: `Running “${phrase}”.` }
    }

    case 'source':
    case 'provider':
    case 'skill': {
      const url = String(item.data?.url ?? item.data?.source ?? item.source ?? '') || null
      const cue = String(item.data?.promptCue ?? item.description ?? item.name)
      return { ok: true, type: 'link', url, cue, message: `“${item.name}” is a reference link, not timeline media${url ? ' — opening it' : ''}. Its cue was copied for the AI prompt.` }
    }

    default:
      return applySceneLike(doc, item, ctx, 'added')
  }
}

/** Every doc-producing result keeps the edit inside the track limit. */
export function docDurationAfter(result: ApplyResult): number {
  return result.ok && result.type === 'doc' ? docDuration(result.doc) : 0
}
