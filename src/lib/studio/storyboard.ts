/**
 * Storyboard templates → a finished, directed edit.
 *
 * A template is a list of scenes: [copy, seconds, animation, slot kind]. The
 * old filler turned each scene into a bare text clip on a flat stage, blocked
 * entirely when a scene wanted media the project did not have yet, and started
 * every title on an invisible first frame — so applying a template looked like
 * nothing happened. This builder produces what an editor would hand over:
 *
 *  - a background layer under the whole piece,
 *  - hierarchy (hero / supporting / call to action) with fitted type sizes,
 *    content-aware fonts and a highlight word,
 *  - keyframed entrances and exits (never two identical in a row),
 *  - a glass plate behind the call to action,
 *  - media slots filled from the project's own footage, or a designed
 *    placeholder panel that says what belongs there — never a refusal,
 *  - copy from the project's brief when there is one ("auto-fill"),
 *
 * all placed on tracks that are free for the template's whole span, so it
 * can never cover or collide with the existing edit. Pure: never mutates `doc`.
 */
import type { StudioClip, StudioDoc, StudioGlassClip, StudioTextAnim, StudioTextClip } from '../../types/project'
import { uid } from '../utils'
import { STUDIO_BACKGROUNDS } from './backgrounds'
import { MAX_TRACKS, defaultGlassClip, defaultTextClip, docDuration, trackIsFree } from './doc'
import { fontFor } from './editOps'
import {
  directTransition,
  motionPatch,
  pickHighlightWord,
  readingTimeSec,
  type DirectionStyle,
  type EntranceRecipe,
  type ExitRecipe,
  type MotionSpec,
} from './motionDirector'
import { GENERIC_COPY, LOOKS, SAMPLE_COPY, type Archetype } from './resourceLook'
import { TEXT_ANIMATIONS } from './transitions'

export type TemplateSlotKind = 'text' | 'media' | 'logo'
export type TemplateSceneTuple = [text: string, durationSec: number, animation: StudioTextAnim, kind?: TemplateSlotKind]
export type TemplateFillData = { scenes?: TemplateSceneTuple[]; durationSec?: number }
export type TemplateAssignments = Record<string, { text?: string; clipId?: string }>
export type TemplateSlot = {
  id: string
  index: number
  label: string
  kind: TemplateSlotKind
  defaultText: string
  durationSec: number
  animation: StudioTextAnim
}

const VALID_ANIMS = new Set<string>(TEXT_ANIMATIONS.map((a) => a.id))

export function templateSlots(data: TemplateFillData): TemplateSlot[] {
  return (data.scenes ?? [])
    .filter((scene) => Array.isArray(scene) && typeof scene[0] === 'string')
    .map(([text, duration, animation, kind = 'text'], index) => ({
      id: `slot-${index + 1}`,
      index,
      label: kind === 'text' ? `Text ${index + 1}` : kind === 'logo' ? 'Logo' : `Media ${index + 1}`,
      kind: kind === 'media' || kind === 'logo' ? kind : 'text',
      defaultText: text.trim() || 'Your headline',
      durationSec: Math.min(30, Math.max(0.5, Number(duration) || 3)),
      animation: VALID_ANIMS.has(animation) ? animation : 'fade-up',
    }))
}

/* ——— Layout helpers ——————————————————————————————————————————————— */

/** Frame width over height. Type and panel sizes are fractions of height. */
export function frameRatio(aspect: StudioDoc['aspect']): number {
  return aspect === '9:16' ? 9 / 16 : aspect === '1:1' ? 1 : 16 / 9
}

/**
 * Largest type size (percent of frame height) at which `text` fits inside
 * title-safe (80% of the width). Bold display glyphs average ~0.6 em, and a
 * line only wraps between words, so the longest word must always fit — and a
 * short line should fit on one line.
 */
export function fitTextSize(text: string, aspect: StudioDoc['aspect'], wanted: number, oneLineUpTo = 16): number {
  const words = text.split(/\s+/).filter(Boolean)
  const longestWord = Math.max(1, ...words.map((w) => w.length))
  const chars = text.length <= oneLineUpTo ? Math.max(longestWord, text.length) : longestWord
  const fit = Math.floor(((0.8 * frameRatio(aspect)) / (chars * 0.6)) * 1000) / 10
  return Math.max(3.2, Math.min(wanted, fit))
}

/** Panel sizes are authored for 16:9; portrait and square get wider, shorter panels. */
export function panelSize(aspect: StudioDoc['aspect'], w: number, h: number): { w: number; h: number } {
  if (aspect === '9:16') return { w: Math.min(0.9, w * 1.45), h: h * 0.72 }
  if (aspect === '1:1') return { w: Math.min(0.9, w * 1.15), h: h * 0.9 }
  return { w, h }
}

/**
 * `count` tracks, bottom to top, that are free for the whole span, starting
 * at `from`. Returns null when the document cannot hold them.
 */
export function allocateTracks(doc: Pick<StudioDoc, 'clips' | 'trackCount'>, start: number, end: number, count: number, from = 0): number[] | null {
  const tracks: number[] = []
  for (let track = Math.max(0, from); track < MAX_TRACKS && tracks.length < count; track += 1) {
    if (trackIsFree(doc, track, start, end)) tracks.push(track)
  }
  return tracks.length === count ? tracks : null
}

/**
 * Where a multi-layer insert goes: at `atSec` when enough tracks are free
 * there, otherwise at the end of the edit (always free).
 */
export function placeLayers(doc: StudioDoc, atSec: number, durationSec: number, count: number, from = 0): { start: number; tracks: number[]; trackCount: number } {
  const at = Math.max(0, Math.round(atSec * 100) / 100)
  const here = allocateTracks(doc, at, at + durationSec, count, from)
  if (here) return { start: at, tracks: here, trackCount: Math.min(MAX_TRACKS, Math.max(doc.trackCount, here[here.length - 1] + 1)) }
  const end = Math.round(docDuration(doc) * 100) / 100
  const tracks = Array.from({ length: count }, (_, i) => Math.min(MAX_TRACKS - 1, from + i))
  return { start: end, tracks, trackCount: Math.min(MAX_TRACKS, Math.max(doc.trackCount, tracks[tracks.length - 1] + 1)) }
}

/* ——— Direction ———————————————————————————————————————————————————— */

/** Template anims that move the whole block → the keyframe entrance that does the same job better. */
const BLOCK_TO_ENTRANCE: Partial<Record<StudioTextAnim, EntranceRecipe>> = {
  pop: 'scale-pop',
  'fade-up': 'rise-in',
  'slide-left': 'slide-in-right',
  'glass-rise': 'blur-focus',
}

export type TextRole = 'hero' | 'body' | 'cta' | 'caption'

/**
 * Style one text clip for its role: font, weight, fitted size, highlight word,
 * a per-word rhythm anim and a keyframed entrance / exit. Mutates `clip`.
 */
export function directText(
  clip: StudioTextClip,
  role: TextRole,
  opts: { aspect: StudioDoc['aspect']; style: DirectionStyle; templateAnim?: StudioTextAnim; index: number; isLast: boolean },
): StudioTextClip {
  const { aspect, style } = opts
  const bold = style === 'bold-social'
  const heroWanted = bold ? 11 : style === 'minimal' ? 8.5 : 9.5
  const wanted = role === 'hero' ? heroWanted : role === 'cta' ? heroWanted * 0.66 : role === 'caption' ? 4.2 : heroWanted * 0.56
  clip.fontSizePct = fitTextSize(clip.text, aspect, wanted, role === 'hero' ? 16 : 26)
  clip.fontFamily = fontFor(clip.text, style, role === 'hero')
  clip.weight = role === 'hero' || role === 'cta' ? 800 : 600
  clip.highlightWord = pickHighlightWord(clip.text) || null
  // Keep a readable minimum on screen.
  clip.durationSec = Math.max(clip.durationSec, Math.min(8, readingTimeSec(clip.text) + 0.6))

  const templateAnim = opts.templateAnim ?? 'fade-up'
  const words = (clip.text.match(/\S+/g) ?? []).length
  const blockEntrance = BLOCK_TO_ENTRANCE[templateAnim]
  // Keyframes move the block; the anim adds rhythm inside it without moving it.
  clip.anim = blockEntrance ? (words <= 1 ? 'shimmer' : 'word-reveal') : templateAnim

  const heroEntrance: EntranceRecipe = bold ? 'scale-pop' : style === 'cinematic' || style === 'minimal' ? 'blur-focus' : 'rise-in'
  const cycle: EntranceRecipe[] = bold ? ['zoom-in', 'slide-in-right', 'drop-in', 'whip-in'] : ['rise-in', 'slide-in-left', 'blur-focus', 'rise-in']
  const entrance: EntranceRecipe =
    templateAnim === 'typewriter' ? 'fade-in' : role === 'caption' ? 'slide-in-left' : role === 'hero' ? (blockEntrance ?? heroEntrance) : role === 'cta' ? 'scale-pop' : blockEntrance ?? cycle[opts.index % cycle.length]
  const exit: ExitRecipe = role === 'caption' ? 'slide-out-left' : opts.isLast ? 'fade-out' : bold ? 'zoom-out' : opts.index % 2 ? 'sink-out' : 'fade-out'
  const spec: MotionSpec = {
    entrance,
    exit,
    emphasis: role === 'cta' ? 'pulse' : role === 'hero' && clip.durationSec > 3 ? (style === 'cinematic' ? 'breathe' : 'none') : 'none',
    intensity: bold ? 1.2 : style === 'minimal' ? 0.6 : 0.9,
  }
  Object.assign(clip, motionPatch(clip, spec))
  // A per-word anim the keyframes do not fight must survive the patch.
  if (!blockEntrance && VALID_ANIMS.has(templateAnim)) clip.anim = templateAnim
  return clip
}

/** Glass plate behind a line of text, sized to the text. */
export function plateBehind(text: StudioTextClip, aspect: StudioDoc['aspect'], preset: string, track: number): StudioGlassClip {
  const ratio = frameRatio(aspect)
  const lineW = Math.min(0.8, (text.text.length * 0.6 * text.fontSizePct) / 100 / ratio)
  const plate = defaultGlassClip(text.startSec, track, preset, 'panel')
  plate.name = 'CTA plate'
  plate.durationSec = text.durationSec
  plate.x = text.x
  plate.y = text.y
  plate.w = Math.min(0.92, lineW + 0.1 / (ratio < 1 ? 0.7 : 1))
  plate.h = Math.max(0.08, (text.fontSizePct / 100) * 2.3)
  plate.radiusPct = 50
  plate.motion = 'sweep'
  Object.assign(plate, motionPatch(plate, { entrance: 'rise-in', exit: 'fade-out', intensity: 0.8 }))
  return plate
}

/* ——— Brief auto-fill ——————————————————————————————————————————————— */

export type BriefSource = {
  name?: string
  brief?: { lockedRundown?: { title?: string; scenes?: { copy?: string }[] } | null; draftRundown?: { title?: string; scenes?: { copy?: string }[] } | null }
}

/** The project's own words, in order: title first, then each scene's copy. */
export function briefLines(project: BriefSource | null | undefined): string[] {
  const rundown = project?.brief?.lockedRundown ?? project?.brief?.draftRundown ?? null
  const lines = [rundown?.title, ...(rundown?.scenes ?? []).map((scene) => scene?.copy)]
    .map((line) => String(line ?? '').replace(/\s+/g, ' ').trim())
    .filter((line) => line.length > 1 && line.length <= 140)
  return [...new Set(lines)]
}

/* ——— The builder ————————————————————————————————————————————————— */

export type StoryboardOptions = {
  /** Where to start; default is the end of the current edit. */
  atSec?: number
  /** Project brief lines (title first) used to fill the copy. */
  brief?: string[]
  /** Brand / project name for logo slots. */
  brandName?: string
  archetype?: Archetype
  style?: DirectionStyle
}

export type StoryboardResult = {
  doc: StudioDoc
  clips: StudioClip[]
  slots: TemplateSlot[]
  /** Media slots with no footage yet; they received a placeholder panel. */
  placeholders: TemplateSlot[]
  changes: string[]
  startSec: number
  durationSec: number
  focusId: string | null
}

const MEDIA_KINDS = new Set(['video', 'image', 'overlay', 'sticker'])

function retimeKeyframes(clip: StudioClip, durationSec: number) {
  if (!clip.keyframes?.length || clip.durationSec <= 0) return clip.keyframes
  const ratio = durationSec / clip.durationSec
  return clip.keyframes.map((key) => ({ ...key, at: Math.min(durationSec, Math.max(0, key.at * ratio)) }))
}

function monogram(name: string): string {
  const letters = name
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('')
  return letters || 'C'
}

export function buildStoryboard(
  doc: StudioDoc,
  data: TemplateFillData,
  templateName: string,
  assignments: TemplateAssignments = {},
  opts: StoryboardOptions = {},
): StoryboardResult {
  const slots = templateSlots(data)
  const archetype = opts.archetype ?? 'generic'
  const look = LOOKS[archetype]
  const style = opts.style ?? look.style
  const brief = (opts.brief ?? []).filter(Boolean)
  const aspect = doc.aspect

  // Scene timing first (reading time can stretch a scene), then placement.
  const texts = slots.map((slot, i) => {
    const typed = assignments[slot.id]?.text?.trim()
    if (typed) return typed
    if (slot.kind !== 'text') return slot.defaultText
    // The brief fills text scenes in order; generic template lines always
    // yield to it, and so does the template's own title card.
    const textIndex = slots.slice(0, i).filter((s) => s.kind === 'text').length
    if (brief[textIndex]) return brief[textIndex]
    if (GENERIC_COPY.test(slot.defaultText)) {
      const sample = SAMPLE_COPY[archetype]
      return i === slots.length - 1 ? sample.cta : i === 0 ? sample.title : sample.body
    }
    return slot.defaultText
  })
  const durations = slots.map((slot, i) => (slot.kind === 'text' ? Math.max(slot.durationSec, Math.min(8, readingTimeSec(texts[i]) + 0.6)) : slot.durationSec))
  const total = Math.max(0.5, durations.reduce((sum, d) => sum + d, 0))

  const atSec = opts.atSec ?? docDuration(doc)
  const { start, tracks, trackCount } = placeLayers(doc, atSec, total, 3, 0)
  const [bgTrack, plateTrack, textTrack] = tracks

  const clips: StudioClip[] = []
  const changes: string[] = []
  const placeholders: TemplateSlot[] = []
  let focusId: string | null = null

  const backgroundId = STUDIO_BACKGROUNDS.some((b) => b.id === look.backgroundId) ? look.backgroundId : 'grid-haze'
  const background: StudioClip = {
    id: uid(),
    kind: 'background',
    track: bgTrack,
    startSec: start,
    durationSec: total,
    name: `${templateName} · stage`,
    transitionIn: 'fade',
    transitionOut: 'fade',
    opacity: 1,
    backgroundId,
  }
  clips.push(background)
  changes.push(`Stage: ${STUDIO_BACKGROUNDS.find((b) => b.id === backgroundId)?.name ?? backgroundId} under the whole piece`)

  const usedMedia = new Set<string>()
  const projectMedia = doc.clips.filter((c) => c.kind === 'video' || c.kind === 'image')
  const textSlotCount = slots.filter((s) => s.kind === 'text').length
  let cursor = start
  let textIndex = 0
  let mediaIndex = 0

  slots.forEach((slot, i) => {
    const duration = durations[i]
    const isLast = i === slots.length - 1
    if (slot.kind === 'text') {
      const role: TextRole = i === 0 ? 'hero' : isLast && textSlotCount > 1 ? 'cta' : 'body'
      const clip = defaultTextClip(cursor, textTrack)
      clip.name = `${templateName} · ${slot.label}`
      clip.text = texts[i]
      clip.durationSec = duration
      clip.y = role === 'hero' ? 0.46 : 0.5
      directText(clip, role, { aspect, style, templateAnim: slot.animation, index: textIndex, isLast })
      clip.durationSec = duration
      clips.push(clip)
      if (!focusId) focusId = clip.id
      if (role === 'cta') {
        clips.push(plateBehind(clip, aspect, look.glassPreset === 'lens' ? 'liquid' : look.glassPreset, plateTrack))
        changes.push(`${slot.label} (call to action): “${clip.text}” on a glass plate · ${duration.toFixed(1)}s`)
      } else {
        changes.push(`${slot.label} (${role === 'hero' ? 'title' : 'supporting'}): “${clip.text}” · ${clip.fontFamily?.replace(' Variable', '')} · ${duration.toFixed(1)}s`)
      }
      textIndex += 1
    } else if (slot.kind === 'logo') {
      const brand = (opts.brandName ?? '').trim() || texts[i]
      const lens = defaultGlassClip(cursor, plateTrack, 'lens', 'lens')
      lens.name = `${templateName} · logo mark`
      lens.durationSec = duration
      lens.y = 0.4
      lens.label = monogram(brand)
      Object.assign(lens, motionPatch(lens, { entrance: 'scale-pop', emphasis: 'float', exit: 'fade-out', intensity: 1 }))
      const word = defaultTextClip(cursor, textTrack)
      word.name = `${templateName} · wordmark`
      word.text = brand
      word.durationSec = duration
      word.y = 0.64
      directText(word, 'cta', { aspect, style, templateAnim: 'shimmer', index: textIndex, isLast })
      word.durationSec = duration
      clips.push(lens, word)
      changes.push(`Logo: “${brand}” as a glass mark and wordmark · ${duration.toFixed(1)}s`)
    } else {
      const chosen = doc.clips.find((c) => c.id === assignments[slot.id]?.clipId && MEDIA_KINDS.has(c.kind))
      // Auto-fill: the project's own footage, in order, before any placeholder.
      const source = chosen ?? projectMedia.find((c) => !usedMedia.has(c.id))
      if (source) {
        usedMedia.add(source.id)
        const clone = {
          ...source,
          id: uid(),
          name: `${templateName} · ${slot.label} · ${source.name}`,
          track: plateTrack,
          startSec: cursor,
          durationSec: duration,
          transitionIn: directTransition(mediaIndex, style),
          transitionOut: isLast ? 'fade' : 'none',
          keyframes: retimeKeyframes(source, duration),
        } as StudioClip
        clips.push(clone)
        changes.push(`${slot.label}: “${source.name}” ${chosen ? 'as chosen' : 'from your project'}, fitted to ${duration.toFixed(1)}s`)
      } else {
        placeholders.push(slot)
        const size = panelSize(aspect, 0.62, 0.5)
        const panel = defaultGlassClip(cursor, plateTrack, look.glassPreset === 'lens' ? 'hero' : look.glassPreset, 'panel')
        panel.name = `${templateName} · ${slot.label} (drop media)`
        panel.durationSec = duration
        panel.w = size.w
        panel.h = size.h
        panel.y = 0.44
        panel.label = 'Drop your media here'
        Object.assign(panel, motionPatch(panel, { entrance: 'rise-in', emphasis: 'breathe', exit: 'fade-out', intensity: 0.8 }))
        clips.push(panel)
        changes.push(`${slot.label}: placeholder panel — drop a clip on it or import media later`)
      }
      // The scene's line becomes a caption under the media.
      const caption = defaultTextClip(cursor, textTrack)
      caption.name = `${templateName} · ${slot.label} caption`
      caption.text = texts[i]
      caption.durationSec = duration
      caption.y = 0.84
      directText(caption, 'caption', { aspect, style, templateAnim: 'word-reveal', index: textIndex, isLast })
      caption.durationSec = duration
      clips.push(caption)
      mediaIndex += 1
    }
    cursor += duration
  })

  const next: StudioDoc = { ...doc, trackCount, clips: [...doc.clips, ...clips] }
  return { doc: next, clips, slots, placeholders, changes, startSec: start, durationSec: total, focusId }
}
