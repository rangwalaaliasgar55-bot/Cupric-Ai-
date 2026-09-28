import { agentSlug, readAgentAnimation } from './agentCode'
import { clampClipPlacement } from './stageBounds'
import type { StudioKitKind, StudioOverlayClip, StudioShapeAnim, StudioBlendMode, StudioClip, StudioDevice, StudioDoc, StudioKeyframe, StudioTextAnim, StudioTransition, StudioAspect } from '../../types/project'
import { VIDEO_FONT_FAMILIES } from './videoFonts'
import { isUserFont } from './userFonts'
import { fontshareFont } from './fontStyles'
import { SHAPES, shapeById } from './shapes'
import { addCursorTo, addLoader, addShape as addShapeKit } from './motionKit'
import { LOADER_PRESETS, loaderPreset } from './loaders'
import { closeGaps as closeGapsOp, addMarker as addMarkerOp, rippleDelete as rippleDeleteOp } from './timelineOps'
import { LOGO_REVEALS, PRODUCT_PRESETS, buildTestimonialGrid, logoRevealKeyframes, withProductPreset, type LogoReveal, type ProductPreset } from './layouts'
import { TEXT_PRESETS, applyTextPreset, captionsFromTranscript } from './textTools'
import { DEFAULT_DUCKING } from './audioMix'
import { clampRecordSec } from './components'
import { clamp } from '../utils'
import { PHONE_DESIGNS } from './phone'
import { MAX_TRACKS, defaultTextClip, docDuration, normaliseClip, reorderTracks, resolveOverlaps, aspectRatio } from './doc'
import { componentFromInstruction, findComponent, validateComponentProps, withComponent } from './components'
import { studioPlayhead } from './studioLink'
import { nestScene } from './scenes'
import { KIT_ACCENTS, KIT_KINDS, isKitKind, normaliseKit } from './homeKit'
import { HOME_STYLES, planHomeVideo, type HomeFill, type HomeStyleId } from './homeVideos'
import {
  ALL_RECIPE_IDS,
  choreograph,
  explicitStyle,
  styleFromContent,
  CAMERA_RECIPES,
  EMPHASIS_RECIPES,
  ENTRANCE_RECIPES,
  EXIT_RECIPES,
  MOTION_PRESETS,
  describeMotionSpec,
  directClip,
  directTransition,
  motionPatch,
  motionSpecFromText,
  pickHighlightWord,
  readingTimeSec,
  styleFromInstruction,
  type DirectionStyle,
  type MotionSpec,
} from './motionDirector'

export type StudioEditOp =
  | { type: 'patchClip'; clipId: string; patch: Record<string, string | number> }
  | { type: 'reframe' | 'reframeClip'; clipId: string; aspect: StudioAspect; x?: number; y?: number; scale?: number }
  | { type: 'nestScene'; sceneId: string; at: number }
  | { type: 'moveClip'; clipId: string; track?: number; startSec?: number }
  | { type: 'deleteClip'; clipId: string }
  | {
      type: 'addText'
      text: string
      track: number
      startSec: number
      durationSec: number
      color?: string
      fontFamily?: string
      anim?: StudioTextAnim
      x?: number
      y?: number
      fontSizePct?: number
      weight?: 400 | 600 | 800
      align?: 'left' | 'center' | 'right'
      highlightWord?: string
      motion?: MotionSpec
    }
  | { type: 'applyMotion'; clipId: string; motion: MotionSpec }
  /** Vector shape from the shape library (see shapes.ts `use` for when). */
  | { type: 'addLoader'; preset: string; startSec: number; durationSec: number; states?: string[]; x?: number; y?: number }
  | { type: 'addShape'; shape: string; startSec: number; durationSec: number; x?: number; y?: number; w?: number; fill?: string | null; stroke?: string | null; anim?: StudioShapeAnim; label?: string }
  /** Animated cursor clicking/hovering a clip — only where an interaction needs explaining. */
  | { type: 'addCursor'; clipId: string; action?: 'click' | 'double-click' | 'hover' | 'drag'; force?: boolean }
  | { type: 'clearKeyframes'; clipId: string }
  | { type: 'setKeyframe'; clipId: string; at: number; values: Partial<Pick<StudioKeyframe, 'x' | 'y' | 'scale' | 'rotation' | 'opacity' | 'tiltX' | 'turnY'>>; ease?: StudioKeyframe['ease'] }
  | { type: 'reorderTrack'; from: number; to: number }
  | { type: 'applyStylePreset'; preset: 'editorial' | 'bold-social' | 'minimal' }
  /** Place a UI component (src/lab/components); the Studio records its real animation. */
  | { type: 'setComponentProps'; clipId: string; /** Merged over the clip's current props; the component re-records. */ props: Record<string, string | number | boolean> }
  | { type: 'addComponent'; slug: string; startSec: number; durationSec: number; x?: number; y?: number; interact?: boolean; motion?: MotionSpec; /** Also add a clicking cursor when the component is interactive (cursorNeeded decides). */ cursor?: boolean; /** framecn props (text, colours…) validated against the component's controls. */ props?: Record<string, string | number | boolean>; /** Preferred layer (0 = bottom, for shader backgrounds); moved up if busy. */ track?: number }
  /* 2.11 — expansion: every new subsystem is reachable by the agent too. */
  | { type: 'rippleDelete'; clipId: string }
  | { type: 'closeGaps'; track?: number }
  | { type: 'addMarker'; at: number; label?: string }
  | { type: 'setBlend'; clipId: string; mode: StudioBlendMode }
  | { type: 'setDevice'; clipId: string; device: StudioDevice }
  | { type: 'phoneDesign'; clipId: string; design: string }
  | { type: 'productMotion'; clipId: string; preset: ProductPreset }
  | { type: 'logoReveal'; clipId: string; reveal: LogoReveal }
  | { type: 'textPreset'; clipId: string; preset: string }
  | { type: 'setAudioRole'; clipId: string; role: 'music' | 'voice' | 'sfx' }
  | { type: 'setDucking'; enabled: boolean; amountDb?: number }
  | { type: 'addTestimonialGrid'; count: number; startSec: number }
  | { type: 'addCaptions'; transcript: string; startSec: number; durationSec: number }
  /** Home_X kit piece (homeKit.ts). Text fields only — numbers must come from the user. */
  | { type: 'addKit'; kit: StudioKitKind; variant?: string; startSec: number; durationSec: number; x?: number; y?: number; w?: number; title?: string; subtitle?: string; items?: string[]; accent?: string; track?: number }
  /** JOB 4 — a NEW animation the agent wrote (validated by agentCode.ts), recorded like any component. */
  | { type: 'addAnimation'; name: string; kind: string; durationSec: number; code: string; props: Record<string, string | number | boolean>; ease: string; startSec: number; x?: number; y?: number }
  /** One of the six Home_X styles, appended after the current edit. */
  | { type: 'buildHomeVideo'; style: HomeStyleId; fill?: HomeFill }

export type StudioEditPlan = { summary: string; ops: StudioEditOp[]; source: 'live' | 'local'; warning?: string }

const PATCH_KEYS = new Set(['tiltX', 'turnY', 'perspective', 'emphasisColor', 'emphasisFont', 'boxColor', 'accentColor', 'textGlow', 'x', 'y', 'scale', 'rotation', 'opacity', 'fontSizePct', 'color', 'fontFamily', 'weight', 'align', 'highlightWord', 'text', 'anim', 'transitionIn', 'transitionOut', 'volume', 'durationSec', 'startSec', 'name'])
const TEXT_KEYS = new Set(['fontSizePct', 'color', 'fontFamily', 'weight', 'align', 'highlightWord', 'text', 'anim'])
const FONTS = { has: (f: string) => VIDEO_FONT_FAMILIES.has(f) || isUserFont(f) }
const fontError = (f: unknown) => fontshareFont(String(f)) ? `“${f}” is a Fontshare font the user has not added yet — use a bundled font and suggest they download it free from Fontshare and drop the zip into Cupric` : `Unknown font “${f}”`
const ANIMS = new Set<StudioTextAnim>(['none', 'fade-up', 'pop', 'typewriter', 'word-reveal', 'shimmer', 'slide-left', 'glass-rise', 'liquid-wave', 'kinetic'])
const BLEND_MODES = new Set<StudioBlendMode>(['normal', 'multiply', 'screen', 'overlay', 'darken', 'lighten', 'color-dodge', 'soft-light', 'difference', 'add'])
const TRANSITIONS = new Set<StudioTransition>(['none', 'fade', 'wipe-left', 'zoom-in', 'blur', 'iris', 'push-up', 'glass-wipe', 'liquid-dissolve', 'lens-sweep'])
const EASES = new Set<StudioKeyframe['ease']>(['linear', 'ease-in', 'ease-out', 'ease-in-out', 'back-out', 'back-in', 'expo-out', 'expo-in-out', 'elastic-out', 'hold', 'bezier', 'spring-slam', 'spring-land', 'spring-punch', 'spring-glide'])
const KEYFRAME_SCALABLE = ['kit', 'loader', 'shape', 'overlay', 'sticker', 'video', 'image', 'text', 'glass']

/** Default motion for an agent-placed component, by what kind of component it is. */
export function defaultComponentMotion(slug: string): MotionSpec {
  const category = findComponent(slug)?.category
  if (category === 'shaders' || category === 'scenes' || category === 'transitions') return { entrance: 'fade-in', exit: 'fade-out', intensity: 0.6 }
  if (category === 'captions' || category === 'motion' || category === 'text') return { entrance: 'fade-in', exit: 'fade-out', intensity: 0.5 }
  return { entrance: 'rise-in', exit: 'fade-out', intensity: 0.8 }
}

/** Accept a motion spec from a model, dropping anything it made up. */
function readMotionSpec(value: unknown): MotionSpec | null {
  if (typeof value === 'string') {
    const preset = MOTION_PRESETS.find((item) => item.id === value)
    return preset ? preset.spec : motionSpecFromText(value)
  }
  if (!value || typeof value !== 'object') return null
  const raw = value as Record<string, unknown>
  if (typeof raw.preset === 'string') {
    const preset = MOTION_PRESETS.find((item) => item.id === raw.preset)
    if (preset) return { ...preset.spec, ...(finite(raw.intensity) ? { intensity: clamp(raw.intensity, 0.3, 2) } : {}) }
  }
  const pickId = (key: string, list: Array<{ id: string }>) => {
    const id = typeof raw[key] === 'string' ? String(raw[key]) : ''
    return list.some((item) => item.id === id) ? id : undefined
  }
  const spec: MotionSpec = {
    entrance: pickId('entrance', ENTRANCE_RECIPES) as MotionSpec['entrance'],
    emphasis: pickId('emphasis', EMPHASIS_RECIPES) as MotionSpec['emphasis'],
    exit: pickId('exit', EXIT_RECIPES) as MotionSpec['exit'],
    camera: pickId('camera', CAMERA_RECIPES) as MotionSpec['camera'],
    ...(finite(raw.intensity) ? { intensity: clamp(raw.intensity, 0.3, 2) } : {}),
  }
  return spec.entrance || spec.emphasis || spec.exit || spec.camera ? spec : null
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

export function validateStudioEditPlan(value: unknown, doc: StudioDoc): StudioEditPlan {
  if (!value || typeof value !== 'object') throw new Error('Edit plan must be an object')
  const raw = value as { summary?: unknown; ops?: unknown; source?: unknown; warning?: unknown }
  if (!Array.isArray(raw.ops) || raw.ops.length === 0) throw new Error('Edit plan must contain at least one operation')
  const ids = new Set(doc.clips.map((clip) => clip.id))
  // Ops may reference clips created earlier in the same plan? They cannot —
  // addText has no id — so every clipId must exist now.
  const validateOne = (entry: unknown, index: number): StudioEditOp => {
    if (!entry || typeof entry !== 'object') throw new Error(`Operation ${index + 1} is not an object`)
    const op = entry as Record<string, unknown>
    const type = String(op.type || '')
    const requireClip = () => {
      const clipId = String(op.clipId || '')
      if (!ids.has(clipId)) throw new Error(`Operation ${index + 1} references unknown clip “${clipId}”`)
      return clipId
    }
    if (type === 'patchClip') {
      const clipId = requireClip()
      const clip = doc.clips.find((item) => item.id === clipId)!
      if (!op.patch || typeof op.patch !== 'object' || Array.isArray(op.patch)) throw new Error(`Operation ${index + 1} needs a patch`)
      const patch: Record<string, string | number> = {}
      for (const [key, item] of Object.entries(op.patch as Record<string, unknown>)) {
        if (!PATCH_KEYS.has(key)) throw new Error(`Property “${key}” is not editable by the agent`)
        if (typeof item !== 'string' && !finite(item)) throw new Error(`Property “${key}” has an invalid value`)
        if (TEXT_KEYS.has(key) && clip.kind !== 'text') throw new Error(`Property “${key}” only applies to text clips`)
        if ((key === 'x' || key === 'y') && !('x' in clip) && clip.kind !== 'video' && clip.kind !== 'image') throw new Error(`Property “${key}” does not apply to this clip`)
        if (key === 'scale' && !['overlay', 'sticker', 'video', 'image'].includes(clip.kind)) throw new Error('Scale only applies to visual clips')
        if (key === 'volume' && clip.kind !== 'audio' && clip.kind !== 'video' && clip.kind !== 'image') throw new Error('Volume only applies to media and audio clips')
        if ((key === 'fontFamily' || key === 'emphasisFont') && !FONTS.has(String(item))) throw new Error(fontError(item))
        if (key === 'color' && !/^#[0-9a-f]{6}$/i.test(String(item))) throw new Error(`Invalid colour “${item}”`)
        if (key === 'text' && (typeof item !== 'string' || item.length > 500)) throw new Error('Text must contain at most 500 characters')
        if (key === 'highlightWord') {
          if (typeof item !== 'string' || item.length > 60) throw new Error('Highlight word must contain at most 60 characters')
          const words = clip.kind === 'text' ? clip.text.match(/[A-Za-z0-9][A-Za-z0-9'-]*/g) ?? [] : []
          if (item && !words.some((word) => word.toLowerCase() === item.toLowerCase())) throw new Error(`Highlight word “${item}” is not present in the clip text`)
        }
        if (key === 'weight' && ![400, 600, 800].includes(Number(item))) throw new Error('Text weight must be 400, 600 or 800')
        if (key === 'align' && !['left', 'center', 'right'].includes(String(item))) throw new Error(`Unknown text alignment “${item}”`)
        if (key === 'anim' && !ANIMS.has(item as StudioTextAnim)) throw new Error(`Unknown animation “${item}”`)
        if ((key === 'transitionIn' || key === 'transitionOut') && !TRANSITIONS.has(item as StudioTransition)) throw new Error(`Unknown transition “${item}”`)
        if (key === 'name' && (typeof item !== 'string' || item.length > 60)) throw new Error('Name must contain at most 60 characters')
        const ranges: Record<string, [number, number]> = { x: [0, 1], y: [0, 1], scale: [0.05, 10], rotation: [-3600, 3600], tiltX: [-89, 89], turnY: [-89, 89], perspective: [200, 8000], textGlow: [0, 1], opacity: [0, 1], fontSizePct: [1, 40], volume: [0, 2], durationSec: [0.2, 3600], startSec: [0, 36000] }
        if (key in ranges && (typeof item !== 'number' || item < ranges[key][0] || item > ranges[key][1])) throw new Error(`Property “${key}” is outside its safe range`)
        patch[key] = item
      }
      if (!Object.keys(patch).length) throw new Error(`Operation ${index + 1} has an empty patch`)
      return { type, clipId, patch }
    }
    if (type === 'reframe' || type === 'reframeClip') {
      const clipId = requireClip()
      const clip = doc.clips.find((item) => item.id === clipId)!
      if (clip.kind !== 'video' && clip.kind !== 'image') throw new Error('Reframe applies to video and image clips')
      const aspect = String(op.aspect) as StudioAspect
      if (!['16:9', '9:16', '1:1', '4:5'].includes(aspect)) throw new Error(`Unknown reframe aspect “${String(op.aspect)}”`)
      const unit = (value: unknown, fallback: number) => value === undefined ? fallback : finite(value) ? clamp(value, 0.05, 0.95) : (() => { throw new Error('Reframe positions must be finite numbers') })()
      const scale = op.scale === undefined ? undefined : finite(op.scale) ? clamp(op.scale, 0.05, 10) : (() => { throw new Error('Reframe scale must be finite') })()
      return { type: type as 'reframe' | 'reframeClip', clipId, aspect, x: unit(op.x, 0.5), y: unit(op.y, 0.5), ...(scale === undefined ? {} : { scale }) }
    }
    if (type === 'nestScene') {
      const sceneId = String(op.sceneId || '')
      if (!doc.scenes?.some((scene) => scene.id === sceneId)) throw new Error(`Unknown scene “${sceneId}”`)
      if (!finite(op.at) || op.at < 0) throw new Error('Nested scene placement needs a non-negative time')
      return { type, sceneId, at: op.at }
    }
    if (type === 'moveClip') {
      const clipId = requireClip()
      if (!finite(op.track) && !finite(op.startSec)) throw new Error(`Operation ${index + 1} needs track or startSec`)
      return { type, clipId, ...(finite(op.track) ? { track: op.track } : {}), ...(finite(op.startSec) ? { startSec: op.startSec } : {}) }
    }
    if (type === 'deleteClip') return { type, clipId: requireClip() }
    if (type === 'addLoader') {
      if (typeof op.preset !== 'string' || !loaderPreset(op.preset)) throw new Error(`Unknown loader preset “${String(op.preset)}” — use one of: ${LOADER_PRESETS.map((x) => x.id).join(', ')}`)
      if (![op.startSec, op.durationSec].every(finite) || (op.startSec as number) < 0 || (op.durationSec as number) < 0.2) throw new Error(`Operation ${index + 1} has invalid timing`)
      for (const k of ['x', 'y'] as const) if (op[k] !== undefined && (!finite(op[k]) || (op[k] as number) < 0 || (op[k] as number) > 1)) throw new Error(`Loader ${k} must be 0–1`)
      if (op.states !== undefined && (!Array.isArray(op.states) || op.states.length < 1 || op.states.length > 8 || op.states.some((s: unknown) => typeof s !== 'string' || !s.trim() || s.length > 60))) throw new Error('Loader states must be 1–8 non-empty lines of at most 60 characters')
      return { type, preset: op.preset, startSec: op.startSec as number, durationSec: op.durationSec as number, ...(op.states ? { states: (op.states as string[]).map((s) => s.trim()) } : {}), ...(op.x !== undefined ? { x: op.x as number } : {}), ...(op.y !== undefined ? { y: op.y as number } : {}) }
    }
    if (type === 'addShape') {
      if (typeof op.shape !== 'string' || !shapeById(op.shape)) throw new Error(`Unknown shape “${String(op.shape)}” — use one of: ${SHAPES.map((x) => x.id).join(', ')}`)
      if (![op.startSec, op.durationSec].every(finite) || (op.startSec as number) < 0 || (op.durationSec as number) < 0.2) throw new Error(`Operation ${index + 1} has invalid timing`)
      for (const k of ['x', 'y'] as const) if (op[k] !== undefined && (!finite(op[k]) || (op[k] as number) < 0 || (op[k] as number) > 1)) throw new Error(`Shape ${k} must be 0–1`)
      if (op.w !== undefined && (!finite(op.w) || (op.w as number) < 0.01 || (op.w as number) > 1.5)) throw new Error('Shape width must be 0.01–1.5 of the frame')
      for (const k of ['fill', 'stroke'] as const) if (op[k] !== undefined && op[k] !== null && !/^#[0-9a-f]{6}$/i.test(String(op[k]))) throw new Error(`Shape ${k} must be a #RRGGBB colour or null`)
      if (op.anim !== undefined && !['none', 'draw-on', 'pop', 'grow', 'spin-in', 'pulse', 'wiggle', 'draw-then-fill'].includes(String(op.anim))) throw new Error(`Unknown shape animation “${op.anim}”`)
      if (op.label !== undefined && (typeof op.label !== 'string' || op.label.length > 40)) throw new Error('Shape label must be at most 40 characters')
      return { type, shape: op.shape, startSec: op.startSec as number, durationSec: op.durationSec as number, ...(op.x !== undefined ? { x: op.x as number } : {}), ...(op.y !== undefined ? { y: op.y as number } : {}), ...(op.w !== undefined ? { w: op.w as number } : {}), ...(op.fill !== undefined ? { fill: op.fill as string | null } : {}), ...(op.stroke !== undefined ? { stroke: op.stroke as string | null } : {}), ...(op.anim !== undefined ? { anim: op.anim as StudioShapeAnim } : {}), ...(op.label ? { label: op.label as string } : {}) }
    }
    if (type === 'addCursor') {
      const clipId = requireClip()
      if (op.action !== undefined && !['click', 'double-click', 'hover', 'drag'].includes(String(op.action))) throw new Error(`Unknown cursor action “${op.action}”`)
      return { type, clipId, ...(op.action ? { action: op.action as 'click' } : {}), ...(op.force === true ? { force: true } : {}) }
    }
    if (type === 'addText') {
      if (typeof op.text !== 'string' || !op.text.trim() || op.text.length > 500) throw new Error(`Operation ${index + 1} needs 1–500 characters of text`)
      if (![op.track, op.startSec, op.durationSec].every(finite) || (op.startSec as number) < 0 || (op.durationSec as number) < 0.2) throw new Error(`Operation ${index + 1} has invalid timing`)
      if (op.color !== undefined && (typeof op.color !== 'string' || !/^#[0-9a-f]{6}$/i.test(op.color))) throw new Error(`Operation ${index + 1} has an invalid colour`)
      if (op.fontFamily !== undefined && !FONTS.has(String(op.fontFamily))) throw new Error(fontError(op.fontFamily))
      const anim = op.anim === undefined ? undefined : String(op.anim) as StudioTextAnim
      if (anim && !ANIMS.has(anim)) throw new Error(`Unknown animation “${anim}”`)
      const motion = op.motion === undefined ? null : readMotionSpec(op.motion)
      const unit = (v: unknown) => (finite(v) ? clamp(v, 0, 1) : undefined)
      const x = unit(op.x)
      const y = unit(op.y)
      const fontSizePct = finite(op.fontSizePct) ? clamp(op.fontSizePct, 1, 40) : undefined
      const weight = [400, 600, 800].includes(Number(op.weight)) ? (Number(op.weight) as 400 | 600 | 800) : undefined
      const align = ['left', 'center', 'right'].includes(String(op.align)) ? (String(op.align) as 'left' | 'center' | 'right') : undefined
      const words = op.text.match(/[A-Za-z0-9][A-Za-z0-9'-]*/g) ?? []
      const highlightWord = typeof op.highlightWord === 'string' ? words.find((w) => w.toLowerCase() === String(op.highlightWord).toLowerCase()) : undefined
      return {
        type,
        text: op.text,
        track: clamp(Math.round(op.track as number), 0, MAX_TRACKS - 1),
        startSec: op.startSec as number,
        durationSec: op.durationSec as number,
        ...(typeof op.color === 'string' ? { color: op.color } : {}),
        ...(typeof op.fontFamily === 'string' ? { fontFamily: op.fontFamily } : {}),
        ...(anim ? { anim } : {}),
        ...(x !== undefined ? { x } : {}),
        ...(y !== undefined ? { y } : {}),
        ...(fontSizePct !== undefined ? { fontSizePct } : {}),
        ...(weight ? { weight } : {}),
        ...(align ? { align } : {}),
        ...(highlightWord ? { highlightWord } : {}),
        ...(motion ? { motion } : {}),
      }
    }
    if (type === 'applyMotion') {
      const clipId = requireClip()
      const target = doc.clips.find((item) => item.id === clipId)!
      if (target.kind === 'audio') throw new Error('Audio clips have no visual motion')
      const motion = readMotionSpec(op.motion ?? op)
      if (!motion) throw new Error(`Operation ${index + 1} needs a motion preset or entrance / emphasis / exit / camera recipe (${[...ALL_RECIPE_IDS].slice(0, 8).join(', ')}…)`)
      return { type, clipId, motion }
    }
    if (type === 'clearKeyframes') {
      return { type, clipId: requireClip() }
    }
    if (type === 'setKeyframe') {
      const clipId = requireClip()
      if (!finite(op.at) || !op.values || typeof op.values !== 'object') throw new Error(`Operation ${index + 1} has invalid keyframe data`)
      const values: Record<string, number> = {}
      for (const [key, item] of Object.entries(op.values as Record<string, unknown>)) {
        if (!['x', 'y', 'scale', 'rotation', 'opacity', 'tiltX', 'turnY'].includes(key) || !finite(item)) throw new Error(`Invalid keyframe property “${key}”`)
        const targetClip = doc.clips.find((item) => item.id === clipId)!
        if ((key === 'x' || key === 'y') && !('x' in targetClip) && targetClip.kind !== 'video' && targetClip.kind !== 'image') throw new Error(`Keyframe property “${key}” does not apply to this clip`)
        if (key === 'scale' && !KEYFRAME_SCALABLE.includes(targetClip.kind)) throw new Error('Scale keyframes only apply to visual clips')
        const ranges: Record<string, [number, number]> = { x: [0, 1], y: [0, 1], scale: [0.05, 10], rotation: [-3600, 3600], opacity: [0, 1] }
        if (item < ranges[key][0] || item > ranges[key][1]) throw new Error(`Keyframe property “${key}” is outside its safe range`)
        values[key] = item
      }
      if (!Object.keys(values).length) throw new Error(`Operation ${index + 1} has an empty keyframe`)
      const ease = op.ease === undefined ? undefined : String(op.ease) as StudioKeyframe['ease']
      if (ease && !EASES.has(ease)) throw new Error(`Unknown easing “${ease}”`)
      return { type, clipId, at: op.at, values, ...(ease ? { ease } : {}) }
    }
    if (type === 'reorderTrack') {
      if (!finite(op.from) || !finite(op.to)) throw new Error(`Operation ${index + 1} has invalid tracks`)
      return { type, from: op.from, to: op.to }
    }
    if (type === 'setComponentProps') {
      const clipId = requireClip()
      const clip = doc.clips.find((item) => item.id === clipId)!
      const slug = clip.kind === 'overlay' ? (clip as StudioOverlayClip).component?.slug : undefined
      if (!slug) throw new Error(`Operation ${index + 1}: “${clip.name}” is not a component clip`)
      const props = validateComponentProps(slug, op.props)
      if (typeof props.fontFamily === 'string' && props.fontFamily && !FONTS.has(props.fontFamily)) throw new Error(fontError(props.fontFamily))
      if (!Object.keys(props).length) throw new Error(`Operation ${index + 1} sets no props`)
      return { type, clipId, props }
    }
    if (type === 'addAnimation') {
      if (!finite(op.startSec) || (op.startSec as number) < 0) throw new Error(`Operation ${index + 1} has invalid timing`)
      const spec = readAgentAnimation(op)
      const unit = (v: unknown) => (finite(v) ? clamp(v, 0.05, 0.95) : undefined)
      const x = unit(op.x)
      const y = unit(op.y)
      return { type, ...spec, startSec: op.startSec as number, ...(x !== undefined ? { x } : {}), ...(y !== undefined ? { y } : {}) }
    }
    if (type === 'addComponent') {
      const slug = String(op.slug ?? op.component ?? '').trim()
      if (!findComponent(slug)) throw new Error(`Unknown component “${slug}”`)
      if (!finite(op.startSec) || (op.startSec as number) < 0) throw new Error(`Operation ${index + 1} has invalid timing`)
      const durationSec = finite(op.durationSec) ? clamp(op.durationSec, 1, 30) : 4
      const unit = (v: unknown) => (finite(v) ? clamp(v, 0.05, 0.95) : undefined)
      const x = unit(op.x)
      const y = unit(op.y)
      const motion = op.motion === undefined ? null : readMotionSpec(op.motion)
      const props = op.props !== undefined ? validateComponentProps(slug, op.props) : undefined
      if (props && typeof props.fontFamily === 'string' && props.fontFamily && !FONTS.has(props.fontFamily)) throw new Error(fontError(props.fontFamily))
      return {
        type,
        slug,
        ...(finite(op.track) ? { track: clamp(Math.round(op.track as number), 0, MAX_TRACKS - 1) } : {}),
        ...(op.cursor === true ? { cursor: true } : {}),
        ...(props ? { props } : {}),
        startSec: op.startSec as number,
        durationSec,
        ...(x !== undefined ? { x } : {}),
        ...(y !== undefined ? { y } : {}),
        ...(typeof op.interact === 'boolean' ? { interact: op.interact } : {}),
        ...(motion ? { motion } : {}),
      }
    }
    if (type === 'rippleDelete') return { type, clipId: requireClip() }
    if (type === 'closeGaps') return { type, ...(finite(op.track) ? { track: clamp(Math.round(op.track as number), 0, MAX_TRACKS - 1) } : {}) }
    if (type === 'addMarker') {
      if (!finite(op.at) || (op.at as number) < 0) throw new Error(`Operation ${index + 1} has an invalid marker time`)
      return { type, at: op.at as number, ...(typeof op.label === 'string' ? { label: op.label.slice(0, 40) } : {}) }
    }
    if (type === 'setBlend') {
      const mode = String(op.mode) as StudioBlendMode
      if (!BLEND_MODES.has(mode)) throw new Error(`Unknown blend mode “${mode}”`)
      return { type, clipId: requireClip(), mode }
    }
    if (type === 'setDevice') {
      const device = String(op.device) as StudioDevice
      if (!['none', 'phone', 'laptop', 'browser'].includes(device)) throw new Error(`Unknown device “${device}”`)
      const clipId = requireClip()
      const kind = doc.clips.find((c) => c.id === clipId)?.kind
      if (kind !== 'video' && kind !== 'image' && kind !== 'overlay') throw new Error('Device frames go on video, image or component clips')
      return { type, clipId, device }
    }
    if (type === 'phoneDesign') {
      const design = String(op.design ?? '')
      if (!PHONE_DESIGNS.some((d) => d.id === design)) throw new Error(`Unknown phone design “${design}” (use ${PHONE_DESIGNS.map((d) => d.id).join(', ')})`)
      const clipId = requireClip()
      const kind = doc.clips.find((c) => c.id === clipId)?.kind
      if (kind !== 'video' && kind !== 'image' && kind !== 'overlay') throw new Error('Phone designs go on video, image or component clips')
      return { type, clipId, design }
    }
    if (type === 'productMotion' || type === 'logoReveal') {
      const clipId = requireClip()
      const kind = doc.clips.find((c) => c.id === clipId)?.kind
      if (kind !== 'video' && kind !== 'image') throw new Error('Photo motion goes on image or video clips')
      if (type === 'productMotion') {
        const preset = String(op.preset) as ProductPreset
        if (!PRODUCT_PRESETS.includes(preset)) throw new Error(`Unknown product preset “${preset}”`)
        return { type, clipId, preset }
      }
      const reveal = String(op.reveal) as LogoReveal
      if (!LOGO_REVEALS.includes(reveal)) throw new Error(`Unknown logo reveal “${reveal}”`)
      return { type, clipId, reveal }
    }
    if (type === 'textPreset') {
      const clipId = requireClip()
      if (doc.clips.find((c) => c.id === clipId)?.kind !== 'text') throw new Error('Text presets go on text clips')
      if (!TEXT_PRESETS.some((p) => p.id === op.preset)) throw new Error(`Unknown text preset “${String(op.preset)}”`)
      return { type, clipId, preset: String(op.preset) }
    }
    if (type === 'setAudioRole') {
      const clipId = requireClip()
      if (doc.clips.find((c) => c.id === clipId)?.kind !== 'audio') throw new Error('Audio roles go on audio clips')
      const role = String(op.role)
      if (role !== 'music' && role !== 'voice' && role !== 'sfx') throw new Error(`Unknown audio role “${role}”`)
      return { type, clipId, role }
    }
    if (type === 'setDucking') return { type, enabled: op.enabled !== false, ...(finite(op.amountDb) ? { amountDb: clamp(op.amountDb as number, -30, -3) } : {}) }
    if (type === 'addTestimonialGrid') {
      if (!finite(op.startSec)) throw new Error(`Operation ${index + 1} has invalid timing`)
      return { type, count: finite(op.count) ? clamp(Math.round(op.count as number), 1, 4) : 2, startSec: Math.max(0, op.startSec as number) }
    }
    if (type === 'addCaptions') {
      const transcript = String(op.transcript ?? '').trim().slice(0, 4000)
      if (!transcript) throw new Error('Captions need transcript text')
      if (!finite(op.startSec) || !finite(op.durationSec)) throw new Error(`Operation ${index + 1} has invalid timing`)
      return { type, transcript, startSec: Math.max(0, op.startSec as number), durationSec: clamp(op.durationSec as number, 0.5, 600) }
    }
    if (type === 'applyStylePreset' && ['editorial', 'bold-social', 'minimal'].includes(String(op.preset))) {
      return { type, preset: String(op.preset) as 'editorial' | 'bold-social' | 'minimal' }
    }
    if (type === 'addKit') {
      if (!isKitKind(op.kit)) throw new Error(`Unknown kit “${String(op.kit)}” — use one of: ${KIT_KINDS.map((k) => k.id).join(', ')}`)
      const variants = KIT_KINDS.find((k) => k.id === op.kit)!.variants
      if (op.variant !== undefined && (typeof op.variant !== 'string' || !variants.includes(op.variant))) throw new Error(`Kit ${op.kit} has no look “${String(op.variant)}” — use one of: ${variants.join(', ')}`)
      if (![op.startSec, op.durationSec].every(finite) || (op.startSec as number) < 0 || (op.durationSec as number) < 0.2) throw new Error(`Operation ${index + 1} has invalid timing`)
      for (const k of ['x', 'y'] as const) if (op[k] !== undefined && (!finite(op[k]) || (op[k] as number) < 0 || (op[k] as number) > 1)) throw new Error(`Kit ${k} must be 0–1`)
      if (op.w !== undefined && (!finite(op.w) || (op.w as number) < 0.05 || (op.w as number) > 1.5)) throw new Error('Kit width must be 0.05–1.5 of the frame')
      if (op.accent !== undefined && !KIT_ACCENTS.some((a) => a.color.toUpperCase() === String(op.accent).toUpperCase())) throw new Error('Kit accent must be a DESIGN video-palette token')
      for (const k of ['title', 'subtitle'] as const) if (op[k] !== undefined && (typeof op[k] !== 'string' || (op[k] as string).length > 160)) throw new Error(`Kit ${k} must be text of at most 160 characters`)
      if (op.items !== undefined && (!Array.isArray(op.items) || op.items.length > 12 || op.items.some((v: unknown) => typeof v !== 'string' || v.length > 120))) throw new Error('Kit items must be at most 12 lines of text')
      if (op.track !== undefined && (!finite(op.track) || (op.track as number) < 0)) throw new Error('Kit track must be a non-negative number')
      const pick = <K extends string>(keys: readonly K[]) => Object.fromEntries(keys.filter((k) => op[k] !== undefined).map((k) => [k, op[k]]))
      return { type, kit: op.kit, startSec: op.startSec as number, durationSec: op.durationSec as number, ...pick(['variant', 'x', 'y', 'w', 'title', 'subtitle', 'items', 'accent', 'track'] as const) } as StudioEditOp
    }
    if (type === 'buildHomeVideo') {
      if (!HOME_STYLES.some((st) => st.id === op.style)) throw new Error(`Unknown style “${String(op.style)}” — use one of: ${HOME_STYLES.map((st) => st.id).join(', ')}`)
      const fill: HomeFill = {}
      const f = (op.fill && typeof op.fill === 'object' ? op.fill : {}) as Record<string, unknown>
      for (const k of ['headline', 'supporting', 'cta', 'brand', 'url'] as const) if (typeof f[k] === 'string' && (f[k] as string).trim()) fill[k] = (f[k] as string).trim().slice(0, 120)
      if (Array.isArray(f.pillWords)) fill.pillWords = f.pillWords.filter((w): w is string => typeof w === 'string' && !!w.trim()).slice(0, 6)
      if (Array.isArray(f.checklist)) fill.checklist = f.checklist.filter((w): w is string => typeof w === 'string' && !!w.trim()).slice(0, 6)
      // Numbers (stats, prices, ratings) are NOT accepted from the model — only from the user's own form.
      return { type, style: op.style as HomeStyleId, fill }
    }
    throw new Error(`Operation ${index + 1} uses unsupported type “${type}”`)
  }
  // Keep every valid op and report the rest, instead of letting one invented
  // property throw away an otherwise good plan.
  const dropped: string[] = []
  const ops: StudioEditOp[] = raw.ops.slice(0, 120).flatMap((entry, index) => {
    try {
      return [validateOne(entry, index)]
    } catch (err) {
      dropped.push(err instanceof Error ? err.message : String(err))
      return []
    }
  })
  if (!ops.length) throw new Error(dropped[0] ?? 'Edit plan had no usable operations')
  const skipped = dropped.length ? `Skipped ${dropped.length} unsafe step${dropped.length === 1 ? '' : 's'} (${[...new Set(dropped)].slice(0, 2).join('; ')}).` : ''
  const warning = [typeof raw.warning === 'string' ? raw.warning : '', skipped].filter(Boolean).join(' ')
  return {
    summary: typeof raw.summary === 'string' && raw.summary.trim() ? raw.summary : `${ops.length} proposed edit${ops.length === 1 ? '' : 's'}`,
    ops,
    source: raw.source === 'local' ? 'local' : 'live',
    ...(warning ? { warning } : {}),
  }
}

export function describeStudioEditOp(op: StudioEditOp, doc: StudioDoc): string {
  const name = 'clipId' in op ? doc.clips.find((clip) => clip.id === op.clipId)?.name ?? op.clipId : ''
  if (op.type === 'patchClip') return `Change ${name}: ${Object.entries(op.patch).map(([key, value]) => `${key} → ${value}`).join(', ')}`
  if (op.type === 'moveClip') return `Move ${name}${op.track !== undefined ? ` to T${op.track + 1}` : ''}${op.startSec !== undefined ? ` at ${op.startSec.toFixed(2)}s` : ''}`
  if (op.type === 'deleteClip') return `Delete ${name}`
  if (op.type === 'addKit') return `Add ${KIT_KINDS.find((k) => k.id === op.kit)?.name ?? op.kit} at ${op.startSec.toFixed(2)}s for ${op.durationSec.toFixed(1)}s`
  if (op.type === 'buildHomeVideo') return `Build “${HOME_STYLES.find((st) => st.id === op.style)?.name ?? op.style}” after the current edit`
  if (op.type === 'addLoader') return `Add ${loaderPreset(op.preset)?.name ?? op.preset} at ${op.startSec.toFixed(2)}s for ${op.durationSec.toFixed(1)}s`
  if (op.type === 'addShape') return `Add ${shapeById(op.shape)?.name ?? op.shape} at ${op.startSec.toFixed(2)}s${op.anim ? ` · ${op.anim}` : ''}`
  if (op.type === 'addCursor') return `Add a cursor ${op.action ?? 'click'} on clip ${op.clipId}`
  if (op.type === 'addText') return `Add text “${op.text}” at ${op.startSec.toFixed(2)}s for ${op.durationSec.toFixed(1)}s${op.motion ? ` · ${describeMotionSpec(op.motion)}` : ''}`
  if (op.type === 'applyMotion') return `Animate ${name}: ${describeMotionSpec(op.motion)}`
  if (op.type === 'clearKeyframes') return `Remove keyframes from ${name}`
  if (op.type === 'setKeyframe') return `Keyframe ${name} at ${op.at.toFixed(2)}s: ${Object.keys(op.values).join(', ')}`
  if (op.type === 'reorderTrack') return `Swap T${op.from + 1} and T${op.to + 1}`
  if (op.type === 'rippleDelete') return `Ripple-delete ${name} (close the gap)`
  if (op.type === 'closeGaps') return op.track === undefined ? 'Close gaps on every track' : `Close gaps on T${op.track + 1}`
  if (op.type === 'addMarker') return `Marker “${op.label ?? 'Marker'}” at ${op.at.toFixed(2)}s`
  if (op.type === 'setBlend') return `Blend ${name}: ${op.mode}`
  if (op.type === 'phoneDesign') return `Put ${name} on an animated phone (${PHONE_DESIGNS.find((d) => d.id === op.design)?.label ?? op.design})`
  if (op.type === 'setDevice') return op.device === 'none' ? `Remove device frame from ${name}` : `Put ${name} in a ${op.device} frame`
  if (op.type === 'productMotion') return `Product motion on ${name}: ${op.preset}`
  if (op.type === 'logoReveal') return `Logo reveal on ${name}: ${op.reveal}`
  if (op.type === 'textPreset') return `Style ${name} as ${TEXT_PRESETS.find((p) => p.id === op.preset)?.label ?? op.preset}`
  if (op.type === 'setAudioRole') return `Mark ${name} as ${op.role}`
  if (op.type === 'setDucking') return op.enabled ? `Duck music under speech${op.amountDb !== undefined ? ` by ${op.amountDb} dB` : ''}` : 'Turn ducking off'
  if (op.type === 'addTestimonialGrid') return `Add ${op.count} empty testimonial card${op.count > 1 ? 's' : ''} at ${op.startSec.toFixed(2)}s (you fill in real quotes)`
  if (op.type === 'addCaptions') return `Add captions from the transcript at ${op.startSec.toFixed(2)}s`
  if (op.type === 'setComponentProps') return `Update ${name}: ${Object.entries(op.props).map(([k, v]) => `${k} = ${typeof v === 'string' ? `“${v.slice(0, 40)}”` : v}`).join(', ')} (re-records)`
  if (op.type === 'addAnimation') return `Write a new “${op.name}” ${op.kind} animation (${op.durationSec}s, agent-generated, validated) at ${op.startSec.toFixed(2)}s`
  if (op.type === 'addComponent') return `Add the “${findComponent(op.slug)?.name ?? op.slug}” component at ${op.startSec.toFixed(2)}s for ${op.durationSec.toFixed(1)}s (its real animation is recorded)${op.cursor ? ' · with a clicking cursor if it is interactive' : ''}${op.motion ? ` · ${describeMotionSpec(op.motion)}` : ''}`
  if (op.type === 'reframe' || op.type === 'reframeClip') return `Reframe ${name} for ${op.aspect}`
  if (op.type === 'nestScene') return `Nest scene ${op.sceneId} at ${op.at.toFixed(2)}s`
  if (op.type === 'applyStylePreset') return `Apply ${op.preset} style across the timeline`
  return 'Edit timeline'
}

export function applyStudioEditPlan(doc: StudioDoc, ops: StudioEditOp[]): StudioDoc {
  let next = { ...doc, clips: [...doc.clips] }
  const growTracks = (track: number) => Math.min(MAX_TRACKS, Math.max(next.trackCount, Math.round(track) + 1))
  for (const op of ops) {
    if (op.type === 'deleteClip') next = { ...next, clips: next.clips.filter((clip) => clip.id !== op.clipId) }
    else if (op.type === 'reframe' || op.type === 'reframeClip') next = {
      ...next,
      clips: next.clips.map((clip) => clip.id === op.clipId && (clip.kind === 'video' || clip.kind === 'image')
        ? { ...clip, fit: 'cover', x: op.x ?? clip.x ?? 0.5, y: op.y ?? clip.y ?? 0.5, ...(op.scale === undefined ? {} : { scale: op.scale }) }
        : clip),
    }
    else if (op.type === 'nestScene') next = nestScene(next, op.sceneId, op.at).doc
    else if (op.type === 'moveClip') {
      if (op.track !== undefined) next = { ...next, trackCount: growTracks(op.track) }
      next = { ...next, clips: next.clips.map((clip) => clip.id === op.clipId ? normaliseClip({ ...clip, ...(op.track !== undefined ? { track: op.track } : {}), ...(op.startSec !== undefined ? { startSec: op.startSec } : {}) } as StudioClip, next.trackCount) : clip) }
    }
    else if (op.type === 'patchClip') next = { ...next, clips: next.clips.map((clip) => {
      if (clip.id !== op.clipId) return clip
      const patched = normaliseClip({ ...clip, ...op.patch } as StudioClip, next.trackCount)
      // Re-time keyframes with the clip so a longer title keeps its exit at the end.
      if (typeof op.patch.durationSec === 'number' && clip.keyframes?.length && clip.durationSec > 0) {
        const ratio = patched.durationSec / clip.durationSec
        patched.keyframes = clip.keyframes.map((k) => ({ ...k, at: Math.round(k.at * ratio * 1000) / 1000 }))
      }
      return patched
    }) }
    else if (op.type === 'addKit') {
      const dur = op.durationSec
      let track = op.track !== undefined ? Math.round(op.track) : 1
      const busy = (tr: number) => next.clips.some((c) => c.track === tr && c.startSec < op.startSec + dur - 0.005 && c.startSec + c.durationSec > op.startSec + 0.005)
      while (track < MAX_TRACKS - 1 && busy(track)) track++
      const id = `kit-${op.kit}-${next.clips.length.toString(36)}-${Math.round(op.startSec * 100).toString(36)}`
      const clip = normaliseKit({ id, kit: op.kit, variant: op.variant, track, startSec: op.startSec, durationSec: dur, x: op.x, y: op.y, w: op.w, title: op.title, subtitle: op.subtitle, items: op.items, accent: op.accent })
      next = { ...next, trackCount: growTracks(track), clips: [...next.clips, clip] }
    }
    else if (op.type === 'buildHomeVideo') next = planHomeVideo(next, op.style, op.fill ?? {}).doc
    else if (op.type === 'addLoader') {
      const r = addLoader(next, op.preset, op.startSec, { durationSec: op.durationSec, ...(op.states ? { states: op.states } : {}), ...(op.x !== undefined ? { x: op.x } : {}), ...(op.y !== undefined ? { y: op.y } : {}) })
      if (r.changed) next = r.doc
    }
    else if (op.type === 'addShape') {
      const r = addShapeKit(next, op.shape, op.startSec, { durationSec: op.durationSec, ...(op.x !== undefined ? { x: op.x } : {}), ...(op.y !== undefined ? { y: op.y } : {}), ...(op.w !== undefined ? { w: op.w } : {}), ...(op.fill !== undefined ? { fill: op.fill } : {}), ...(op.stroke !== undefined ? { stroke: op.stroke } : {}), ...(op.anim ? { anim: op.anim } : {}), ...(op.label ? { label: op.label } : {}) })
      if (r.changed) next = r.doc
    }
    else if (op.type === 'addCursor') {
      const r = addCursorTo(next, op.clipId, { force: op.force, action: op.action })
      if (!r.changed) throw new Error(r.reason ?? 'Cursor not added')
      next = r.doc
    }
    else if (op.type === 'addText') {
      next = { ...next, trackCount: growTracks(op.track) }
      const clip = defaultTextClip(Math.max(0, op.startSec), clamp(Math.round(op.track), 0, next.trackCount - 1))
      clip.text = op.text
      clip.name = op.text.slice(0, 24)
      clip.durationSec = Math.max(0.2, op.durationSec)
      if (op.color) clip.color = op.color
      if (op.fontFamily) clip.fontFamily = op.fontFamily
      if (op.anim) clip.anim = op.anim
      if (op.x !== undefined) clip.x = op.x
      if (op.y !== undefined) clip.y = op.y
      if (op.fontSizePct !== undefined) clip.fontSizePct = op.fontSizePct
      if (op.weight) clip.weight = op.weight
      if (op.align) clip.align = op.align
      if (op.highlightWord) clip.highlightWord = op.highlightWord
      // No motion and no text animation would hard-cut the text on and off;
      // an editor always eases it, so default to a quiet rise and fade.
      const textMotion: MotionSpec | undefined = op.motion ?? (op.anim ? undefined : { entrance: 'rise-in', exit: 'fade-out', intensity: 0.7 })
      const finalClip = textMotion ? ({ ...clip, ...motionPatch(clip, textMotion) } as StudioClip) : clip
      next = { ...next, clips: [...next.clips, finalClip] }
    } else if (op.type === 'applyMotion') next = { ...next, clips: next.clips.map((clip) => clip.id === op.clipId ? ({ ...clip, ...motionPatch(clip, op.motion) } as StudioClip) : clip) }
    else if (op.type === 'clearKeyframes') next = { ...next, clips: next.clips.map((clip) => clip.id === op.clipId ? { ...clip, keyframes: [] } : clip) }
    else if (op.type === 'setKeyframe') next = { ...next, clips: next.clips.map((clip) => {
      if (clip.id !== op.clipId) return clip
      const at = clamp(op.at, 0, clip.durationSec)
      const keys = (clip.keyframes ?? []).filter((key) => Math.abs(key.at - at) > 0.02)
      return { ...clip, keyframes: [...keys, { at, ease: op.ease ?? 'ease-in-out', ...op.values }].sort((a, b) => a.at - b.at) }
    }) }
    else if (op.type === 'reorderTrack') next = reorderTracks(next, op.from, op.to)
    else if (op.type === 'setComponentProps') next = { ...next, clips: next.clips.map((clip) => {
      const ov = clip as StudioOverlayClip
      if (clip.id !== op.clipId || !ov.component) return clip
      return { ...ov, component: { ...ov.component, props: { ...(ov.component.props ?? {}), ...op.props }, status: 'pending' } } as StudioClip
    }) }
    else if (op.type === 'addAnimation') {
      const slug = agentSlug(op.name)
      const added = withComponent(next, slug, { startSec: op.startSec, durationSec: op.durationSec, recordSec: op.durationSec, interact: false, x: op.x, y: op.y })
      next = {
        ...added.doc,
        clips: added.doc.clips.map((clip) => clip.id === added.clip.id && clip.kind === 'overlay' && clip.component
          ? { ...clip, name: op.name, source: `Agent-generated · ${op.name}`, component: { ...clip.component, props: op.props, generated: { source: 'agent-generated' as const, name: op.name, kind: op.kind, code: op.code, ease: op.ease } } }
          : clip),
      }
    }
    else if (op.type === 'addComponent') {
      const added = withComponent(next, op.slug, {
        startSec: op.startSec,
        durationSec: op.durationSec,
        // 2.13: the component records for the clip's own length (clamped).
        recordSec: clampRecordSec(op.durationSec),
        ...(op.x !== undefined ? { x: op.x } : {}),
        ...(op.y !== undefined ? { y: op.y } : {}),
        ...(op.interact !== undefined ? { interact: op.interact } : {}),
        ...(op.track !== undefined ? { track: op.track } : {}),
      })
      // A component never just pops on — but full-frame pieces that animate
      // themselves (scenes, shaders, transitions, captions, kinetic type)
      // only cross-fade: rising a whole background looks broken.
      const motion: MotionSpec = op.motion ?? defaultComponentMotion(op.slug)
      const ov = added.clip as StudioOverlayClip
      const base = op.props && ov.component ? { ...ov, component: { ...ov.component, props: op.props } } : added.clip
      const clip = { ...base, ...motionPatch(base, motion) } as StudioClip
      next = { ...added.doc, clips: added.doc.clips.map((c) => (c.id === clip.id ? clip : c)) }
      if (op.cursor) {
        const withCursor = addCursorTo(next, clip.id)
        if (withCursor.changed) next = withCursor.doc
      }
    }
    else if (op.type === 'applyStylePreset') next = applyStyle(next, op.preset)
    else if (op.type === 'rippleDelete') next = rippleDeleteOp(next, op.clipId).doc
    else if (op.type === 'closeGaps') next = closeGapsOp(next, op.track).doc
    else if (op.type === 'addMarker') next = addMarkerOp(next, op.at, op.label).doc
    else if (op.type === 'setDucking') next = { ...next, ducking: { ...(next.ducking ?? DEFAULT_DUCKING), enabled: op.enabled, ...(op.amountDb !== undefined ? { amountDb: op.amountDb } : {}) } }
    else if (op.type === 'addTestimonialGrid') next = buildTestimonialGrid(next, op.count, op.startSec).doc
    else if (op.type === 'addCaptions') {
      const caps = captionsFromTranscript(op.transcript, { startSec: op.startSec, durationSec: op.durationSec, track: Math.min(MAX_TRACKS - 1, next.trackCount) })
      next = { ...next, trackCount: Math.min(MAX_TRACKS, next.trackCount + 1), clips: [...next.clips, ...caps] }
    } else if (op.type === 'phoneDesign') {
      const design = PHONE_DESIGNS.find((d) => d.id === op.design)
      if (design) next = { ...next, clips: next.clips.map((clip) => (clip.id === op.clipId ? ({ ...clip, device: 'phone', phone: structuredClone(design.style), ...(clip.kind !== 'overlay' ? { fit: 'contain' } : {}) } as StudioClip) : clip)) }
    } else if (op.type === 'setBlend' || op.type === 'setDevice' || op.type === 'productMotion' || op.type === 'logoReveal' || op.type === 'textPreset' || op.type === 'setAudioRole') {
      next = {
        ...next,
        clips: next.clips.map((clip) => {
          if (clip.id !== op.clipId) return clip
          if (op.type === 'setBlend') return { ...clip, blendMode: op.mode }
          if (op.type === 'setDevice') return { ...clip, device: op.device } as StudioClip
          if (op.type === 'productMotion' && (clip.kind === 'image' || clip.kind === 'video')) return withProductPreset(clip, op.preset)
          if (op.type === 'logoReveal') return { ...clip, keyframes: logoRevealKeyframes(op.reveal, clip.durationSec), motionPreset: `logo:${op.reveal}` } as StudioClip
          if (op.type === 'textPreset' && clip.kind === 'text') return applyTextPreset(clip, op.preset)
          if (op.type === 'setAudioRole' && clip.kind === 'audio') return { ...clip, role: op.role }
          return clip
        }),
      }
    }
  }
  // Whatever the plan did, never leave two clips fighting for one track slot —
  // and JOB 7: never leave one outside the stage either. Both invariants are
  // enforced at the single exit, so no future op can forget them.
  return onStageDoc(resolveOverlaps(next))
}

/** Clamp every clip's placement (and its keyframes) into the stage. */
function onStageDoc(doc: StudioDoc): StudioDoc {
  let changed = false
  const clips = doc.clips.map((clip) => {
    const c = clampClipPlacement(clip as StudioClip & { x?: number; y?: number; scale?: number })
    if (c !== clip) changed = true
    return c as StudioClip
  })
  return changed ? { ...doc, clips } : doc
}

function applyStyle(doc: StudioDoc, preset: Extract<StudioEditOp, { type: 'applyStylePreset' }>['preset']): StudioDoc {
  const styles = {
    editorial: { color: '#F4F1EA', fontFamily: 'Playfair Display Variable', anim: 'fade-up' as StudioTextAnim, transitionIn: 'fade' as StudioTransition },
    'bold-social': { color: '#C8F542', fontFamily: 'Inter Variable', anim: 'pop' as StudioTextAnim, transitionIn: 'zoom-in' as StudioTransition },
    minimal: { color: '#F4F1EA', fontFamily: 'Manrope Variable', anim: 'none' as StudioTextAnim, transitionIn: 'fade' as StudioTransition },
  }[preset]
  return { ...doc, clips: doc.clips.map((clip) => clip.kind === 'text' ? { ...clip, ...styles } : clip) }
}

/* ——— Local planner ————————————————————————————————————————————————————————
 * Runs with no network at all, so "the live agent is unavailable" never means
 * "nothing happens". It understands the common intents — polish everything,
 * add text, animate this, clear motion, untangle tracks — and falls back to a
 * directed motion pass instead of giving up.
 */

const POLISH_RE = /analy[sz]e the timeline|automatic edit|auto[ -]?edit|auto[ -]?polish|automatic effects|auto[ -]?effects|effects pass|polish|professional|make it (?:look )?(?:better|good|great|pro|premium|cinematic)|improve|enhance|cinematic|level up|clean (?:it )?up/
const ADD_TEXT_RE = /\b(?:add|write|put|insert|create|type|place|show)\b[^.]*?\b(text|title|headline|heading|caption|subtitle|cta|call to action|label|lower third|tagline|quote)\b/

type LocalOpts = { time?: number }

export function fontFor(text: string, style: DirectionStyle, isHero: boolean): string {
  if (/\b(ai|api|data|software|system|future|digital|tech|code|app|cloud|device)\b/i.test(text)) return 'Space Grotesk Variable'
  if (style === 'cinematic' || /\b(story|discover|journey|beautiful|introducing|legacy|crafted)\b/i.test(text)) return isHero ? 'Playfair Display Variable' : 'Manrope Variable'
  if (style === 'bold-social') return 'Inter Variable'
  if (style === 'minimal') return 'Manrope Variable'
  return isHero ? 'Manrope Variable' : 'DM Sans Variable'
}

/** A whole-timeline pass: typography, hierarchy, reading time, motion, transitions. */
function polishPlan(doc: StudioDoc, instruction: string): StudioEditPlan {
  // An explicit request wins; otherwise the content decides (a brand film
  // gets cinematic motion, a sale reel gets bold social motion).
  const style = explicitStyle(instruction) ?? styleFromContent(doc.clips)
  const ops: StudioEditOp[] = []
  const visual = [...doc.clips].filter((c) => c.kind !== 'audio').sort((a, b) => a.startSec - b.startSec || a.track - b.track)
  const texts = visual.filter((c): c is Extract<StudioClip, { kind: 'text' }> => c.kind === 'text')
  const media = visual.filter((c) => c.kind === 'video' || c.kind === 'image').sort((a, b) => a.startSec - b.startSec)
  const hero = [...texts].sort((a, b) => b.fontSizePct - a.fontSizePct || a.startSec - b.startSec)[0]
  const lastEnd = Math.max(0, ...visual.map((c) => c.startSec + c.durationSec))
  const counts = { text: 0, media: 0, transitions: 0, highlights: 0, retimed: 0, other: 0 }
  let textIndex = 0
  let mediaIndex = 0

  // Set the house look first; the per-clip typography, highlights and
  // choreography below then refine it clip by clip.
  if (texts.length) {
    const preset = style === 'bold-social' ? 'bold-social' : style === 'minimal' ? 'minimal' : 'editorial'
    ops.push({ type: 'applyStylePreset', preset })
  }

  visual.forEach((clip, index) => {
    const isLast = Math.abs(clip.startSec + clip.durationSec - lastEnd) < 0.05
    if (clip.kind === 'text') {
      const isHero = clip.id === hero?.id
      const patch: Record<string, string | number> = {
        fontFamily: fontFor(clip.text, style, isHero),
        weight: isHero ? 800 : 600,
      }
      if (!clip.highlightWord) {
        const word = pickHighlightWord(clip.text)
        if (word) {
          patch.highlightWord = word
          counts.highlights += 1
        }
      }
      // Hierarchy: the hero reads first, supporting lines step down.
      const wanted = hero ? (hero.fontSizePct < 8 ? (style === 'bold-social' ? 11 : 9.5) : hero.fontSizePct) : 9
      // Fit inside title-safe (80% of the width) for this aspect: bold display
      // glyphs average ~0.6 em, and a line wraps only between words, so the
      // longest word — or the whole line when it is short — must fit.
      const frameW = aspectRatio(doc.aspect)
      const heroText = hero?.text ?? ''
      const longestWord = Math.max(1, ...heroText.split(/\s+/).map((w) => w.length))
      const fitChars = heroText.length <= 14 ? Math.max(longestWord, heroText.length) : longestWord
      const fitPct = Math.floor(((0.8 * frameW) / (fitChars * 0.6)) * 1000) / 10
      const heroSize = Math.max(4.5, Math.min(wanted, fitPct))
      if (isHero && clip.fontSizePct !== heroSize) patch.fontSizePct = heroSize
      if (!isHero && clip.fontSizePct > heroSize * 0.75) patch.fontSizePct = Math.max(4.5, Math.round(heroSize * 0.6 * 10) / 10)
      const words = (clip.text.match(/\S+/g) ?? []).length
      // Text motion in two layers, like a motion designer builds it: the
      // keyframes move the block (applyMotion below), and a per-word anim
      // that never moves the block adds rhythm inside it. Block-moving anims
      // would fight the keyframes, so they are never chosen here.
      patch.anim = words <= 1 || (style === 'bold-social' && !isHero) ? 'shimmer' : 'word-reveal'
      const needed = readingTimeSec(clip.text) + 0.5
      if (clip.durationSec < needed) {
        patch.durationSec = Math.round(needed * 10) / 10
        counts.retimed += 1
      }
      ops.push({ type: 'patchClip', clipId: clip.id, patch })
      const retimed = { ...clip, durationSec: typeof patch.durationSec === 'number' ? patch.durationSec : clip.durationSec }
      ops.push({ type: 'applyMotion', clipId: clip.id, motion: directClip(retimed, { index, textIndex, mediaIndex, isHero, isLast }, style) })
      textIndex += 1
      counts.text += 1
      return
    }
    if (clip.kind === 'video' || clip.kind === 'image') {
      const mi = media.indexOf(clip)
      const previous = media[mi - 1]
      const isCut = !previous || Math.abs(previous.startSec + previous.durationSec - clip.startSec) < 0.35
      if (isCut) {
        ops.push({ type: 'patchClip', clipId: clip.id, patch: { transitionIn: directTransition(mediaIndex, style), ...(isLast ? { transitionOut: 'fade' } : {}) } })
        counts.transitions += 1
      }
      ops.push({ type: 'applyMotion', clipId: clip.id, motion: directClip(clip, { index, textIndex, mediaIndex, isHero: false, isLast }, style) })
      mediaIndex += 1
      counts.media += 1
      return
    }
    ops.push({ type: 'applyMotion', clipId: clip.id, motion: directClip(clip, { index, textIndex, mediaIndex, isHero: false, isLast }, style) })
    counts.other += 1
  })

  const parts = [
    counts.text ? `${counts.text} text layer${counts.text === 1 ? '' : 's'} with hierarchy, fonts and choreographed keyframes` : '',
    counts.highlights ? `${counts.highlights} highlight word${counts.highlights === 1 ? '' : 's'}` : '',
    counts.retimed ? `${counts.retimed} line${counts.retimed === 1 ? '' : 's'} lengthened to reading time` : '',
    counts.media ? `camera moves on ${counts.media} shot${counts.media === 1 ? '' : 's'}` : '',
    counts.transitions ? `${counts.transitions} varied transition${counts.transitions === 1 ? '' : 's'}` : '',
    counts.other ? `motion on ${counts.other} sticker / overlay / glass layer${counts.other === 1 ? '' : 's'}` : '',
  ].filter(Boolean)
  return {
    summary: `${style.replace('-', ' ')} polish: ${parts.join(', ') || 'motion pass'}`,
    source: 'local',
    ops,
  }
}

function extractCopy(instruction: string): string | null {
  const quoted = instruction.match(/["“”'‘’]([^"“”]{1,300})["“”'‘’]/)
  if (quoted && quoted[1].trim().length > 0 && !/^s /.test(quoted[1])) return quoted[1].trim()
  const said = instruction.match(/(?:saying|that says|says|reading|that reads|with the (?:text|words?)|:)\s+(.{1,300})$/i)
  if (said) return said[1].trim().replace(/[.!]$/, '')
  const after = instruction.match(/\b(?:text|title|headline|heading|caption|subtitle|cta|label|tagline|quote)\b\s+(?!at\b|on\b|in\b|to\b|for\b|near\b)(.{2,300})$/i)
  if (after) return after[1].trim().replace(/\s+(?:at|on|in) (?:the )?(?:start|end|beginning|top|bottom|middle|center)\b.*$/i, '')
  return null
}

function addTextPlan(instruction: string, doc: StudioDoc, opts: LocalOpts): StudioEditPlan {
  const t = instruction.toLowerCase()
  const role = t.match(ADD_TEXT_RE)?.[1] ?? 'text'
  const isCta = /cta|call to action|subscribe|follow|buy|sign up|download|link in bio/.test(t)
  const isLower = /lower third/.test(role)
  const isCaption = /caption|subtitle/.test(role)
  const copy = extractCopy(instruction) ?? (isCta ? 'Follow for more' : isLower ? 'Name Surname · Role' : isCaption ? 'Your caption here' : 'Your headline')
  const style = styleFromInstruction(instruction)
  const durationSec = Math.round(Math.max(isCta ? 2.5 : 2.2, readingTimeSec(copy) + 0.6) * 10) / 10
  const total = docDuration(doc)
  const atMatch = t.match(/\bat\s+(\d+(?:\.\d+)?)\s*s(?:ec(?:onds?)?)?\b/)
  let startSec = opts.time ?? 0
  if (atMatch) startSec = Number(atMatch[1])
  else if (/\b(?:at|in) the end|ending|outro|final/.test(t) || isCta) startSec = Math.max(0, total - durationSec)
  else if (/\b(?:at|in) the (?:start|beginning)|intro|opening/.test(t)) startSec = 0
  const y = /\btop\b/.test(t) ? 0.18 : /\bbottom\b/.test(t) || isLower ? 0.84 : isCaption ? 0.78 : isCta ? 0.8 : 0.45
  const fontSizePct = isLower ? 4.5 : isCaption ? 5.2 : isCta ? 6.5 : style === 'bold-social' ? 11 : 9
  const motion = motionSpecFromText(instruction) ?? (isLower ? { entrance: 'slide-in-left', exit: 'slide-out-left', intensity: 0.8 } as MotionSpec : isCta ? { entrance: 'scale-pop', emphasis: 'pulse', exit: 'fade-out', intensity: 1.1 } as MotionSpec : isCaption ? { entrance: 'rise-in', exit: 'fade-out', intensity: 0.6 } as MotionSpec : directClip({ ...defaultTextClip(0, 0), durationSec }, { index: 0, textIndex: 0, mediaIndex: 0, isHero: true, isLast: false }, style))
  const highlightWord = pickHighlightWord(copy)
  const color = /\blime|green\b/.test(t) ? '#C8F542' : /\bblue\b/.test(t) ? '#4FB6E8' : /\bred\b/.test(t) ? '#E24B4A' : /\bblack\b/.test(t) ? '#111111' : undefined
  const op: StudioEditOp = {
    type: 'addText',
    text: copy,
    track: Math.max(1, doc.trackCount - 1),
    startSec: Math.round(startSec * 100) / 100,
    durationSec,
    x: 0.5,
    y,
    fontSizePct,
    weight: isCaption || isLower ? 600 : 800,
    align: 'center',
    fontFamily: fontFor(copy, style, !isCaption && !isLower),
    anim: (copy.match(/\S+/g) ?? []).length > 6 ? 'word-reveal' : 'none',
    ...(highlightWord && !isLower ? { highlightWord } : {}),
    ...(color ? { color } : {}),
    motion,
  }
  return { summary: `Add ${isCta ? 'a call to action' : isLower ? 'a lower third' : isCaption ? 'a caption' : 'a title'} “${copy}” with ${describeMotionSpec(motion).toLowerCase()}`, source: 'local', ops: [op] }
}

const COUNT_WORDS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8 }

/** "add two keyframes", "3 keyframes", "a pair of keys" → 2 / 3 / 2. */
export function requestedKeyframeCount(text: string): number | null {
  const m = text.toLowerCase().match(/\b(\d{1,2}|one|two|three|four|five|six|seven|eight|a pair of|a couple of)\s+(?:more\s+)?(?:key\s?frames?|keys)\b/)
  if (!m) return null
  const n = /pair|couple/.test(m[1]) ? 2 : COUNT_WORDS[m[1]] ?? Number(m[1])
  return Number.isFinite(n) ? Math.max(1, Math.min(12, n)) : null
}

/**
 * Turn a directed motion spec into exactly `count` real, editable keyframes.
 * The choreography's first and last poses are always kept, so two keys is
 * "from → to"; extra keys come from the choreography's own beats, and if the
 * user asks for more than it has, midpoints of the longest gaps are added.
 */
function keyframeOpsFor(clip: StudioClip, spec: MotionSpec, count: number): StudioEditOp[] {
  const keys = choreograph(clip, spec)
  if (!keys.length) return []
  let picked: StudioKeyframe[]
  const visible = (k: StudioKeyframe) => (k.opacity ?? 1) >= 0.99
  if (count <= keys.length) {
    // Priority, so every count reads as designed motion and never leaves the
    // clip invisible: 1 → the resting pose; 2 → entrance start → rest;
    // 3 → + the hold before the exit; 4 → + the exit end; then the beats.
    const firstVisible = keys.findIndex(visible)
    let lastVisible = -1
    for (let i = keys.length - 1; i >= 0; i--) if (visible(keys[i])) { lastVisible = i; break }
    const order = count === 1
      ? [Math.max(0, firstVisible)]
      : [0, firstVisible, lastVisible, keys.length - 1, ...keys.map((_, i) => i)]
    const chosen: number[] = []
    for (const i of order) if (i >= 0 && !chosen.includes(i) && chosen.length < count) chosen.push(i)
    picked = chosen.sort((a, b) => a - b).map((i) => keys[i])
  } else {
    picked = [...keys]
    while (picked.length < count) {
      let gap = 0
      for (let i = 1; i < picked.length - 1; i++) {
        if (picked[i + 1].at - picked[i].at > picked[gap + 1].at - picked[gap].at) gap = i
      }
      const a = picked[gap], b = picked[gap + 1] ?? a
      const mid: StudioKeyframe = { at: (a.at + b.at) / 2, ease: a.ease }
      for (const prop of ['x', 'y', 'scale', 'rotation', 'opacity', 'tiltX', 'turnY'] as const) {
        const va = a[prop], vb = b[prop]
        if (typeof va === 'number' && typeof vb === 'number') mid[prop] = (va + vb) / 2
      }
      picked.splice(gap + 1, 0, mid)
    }
  }
  const positional = 'x' in clip || clip.kind === 'video' || clip.kind === 'image'
  return picked.map((key) => {
    const values: Partial<Pick<StudioKeyframe, 'x' | 'y' | 'scale' | 'rotation' | 'opacity' | 'tiltX' | 'turnY'>> = {}
    for (const prop of ['x', 'y', 'scale', 'rotation', 'opacity', 'tiltX', 'turnY'] as const) {
      const v = key[prop]
      if (typeof v !== 'number' || !Number.isFinite(v)) continue
      if ((prop === 'x' || prop === 'y') && !positional) continue
      if (prop === 'scale' && !KEYFRAME_SCALABLE.includes(clip.kind)) continue
      values[prop] = prop === 'opacity' || prop === 'x' || prop === 'y' ? clamp(v, 0, 1) : prop === 'scale' ? clamp(v, 0.05, 10) : prop === 'tiltX' || prop === 'turnY' ? clamp(v, -89, 89) : v
    }
    if (!Object.keys(values).length) values.opacity = 1
    return { type: 'setKeyframe', clipId: clip.id, at: clamp(key.at, 0, clip.durationSec), values, ease: key.ease } as StudioEditOp
  })
}

/** "Add the odometer after the title" → an addComponent op at a sensible time and place. */
export function componentPlan(instruction: string, doc: StudioDoc, opts: LocalOpts = {}): StudioEditPlan | null {
  const entry = componentFromInstruction(instruction)
  if (!entry) return null
  const text = instruction.toLowerCase()
  const seconds = Number(text.match(/\b(?:for|lasting)\s+(\d+(?:\.\d+)?)\s*(?:s|sec|secs|seconds)\b/)?.[1])
  const at = Number(text.match(/\bat\s+(\d+(?:\.\d+)?)\s*(?:s|sec|secs|seconds)\b/)?.[1])
  const startSec = Number.isFinite(at) ? at : /\b(?:end|after everything|at the end)\b/.test(text) ? docDuration(doc) : Math.max(0, opts.time ?? 0)
  const y = /\b(?:bottom|lower)\b/.test(text) ? 0.74 : /\b(?:top|upper)\b/.test(text) ? 0.26 : undefined
  const style = styleFromInstruction(instruction)
  const motion: MotionSpec = { entrance: style === 'bold-social' ? 'scale-pop' : 'rise-in', exit: 'fade-out', intensity: style === 'bold-social' ? 1.2 : 0.9 }
  return {
    summary: `Add the “${entry.name}” component — Cupric records its real animation`,
    source: 'local',
    ops: [{ type: 'addComponent', slug: entry.slug, startSec, durationSec: Number.isFinite(seconds) ? clamp(seconds, 1, 30) : 4, ...(y !== undefined ? { y } : {}), motion }],
  }
}

export function localStudioEditPlan(instruction: string, doc: StudioDoc, selectedId: string | null, opts: LocalOpts = {}): StudioEditPlan {
  const text = instruction.trim().toLowerCase()
  const component = componentPlan(instruction, doc, opts)
  if (component) return component
  if (ADD_TEXT_RE.test(text)) return addTextPlan(instruction, doc, opts)
  const styleMatch = HOME_STYLES.find((st) => text.includes(st.name.toLowerCase()) || text.includes(st.id))
  if (styleMatch && /\b(?:build|make|create|add|use)\b/.test(text)) {
    return { summary: `Build the “${styleMatch.name}” style after the current edit`, source: 'local', ops: [{ type: 'buildHomeVideo', style: styleMatch.id, fill: {} }] }
  }
  const pills = /\bemphasi[sz]e\s+(.+?)\s+as\s+pills?\b/i.exec(instruction)
  if (pills) {
    const target = doc.clips.find((c) => c.id === selectedId && c.kind === 'text')
    if (!target || target.kind !== 'text') throw new Error('Select the text clip whose words should become pills, then ask again.')
    const words = pills[1].split(/,|\band\b/).map((w) => w.trim().replace(/^[“"']|[”"']$/g, '')).filter(Boolean)
    const missing = words.filter((w) => !new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(target.text))
    if (missing.length) throw new Error(`“${missing.join('”, “')}” is not in the selected text.`)
    const title = words.reduce((acc, w) => acc.replace(new RegExp(`\\b(${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})\\b`, 'i'), '[$1]'), target.text)
    return {
      summary: `Turn ${words.length} word${words.length === 1 ? '' : 's'} into red pills`,
      source: 'local',
      ops: [
        { type: 'addKit', kit: 'pill-text', variant: 'inline', startSec: target.startSec, durationSec: target.durationSec, x: clamp(target.x, 0, 1), y: clamp(target.y, 0, 1), w: 0.7, title, track: target.track },
        { type: 'deleteClip', clipId: target.id },
      ],
    }
  }
  if (!doc.clips.length) throw new Error('The timeline is empty. Import footage or say “add a title saying …” to start.')

  if (/\b(?:fix|resolve|untangle|organi[sz]e|clean up) (?:the )?(?:overlap|overlaps|overlapping|tracks|layers|timeline)/.test(text)) {
    const resolved = resolveOverlaps(doc)
    const moved = resolved.clips.filter((c, i) => c.track !== doc.clips[i].track || c.startSec !== doc.clips[i].startSec)
    if (!moved.length) throw new Error('No overlapping clips — every layer already has its own slot.')
    return { summary: `Lift ${moved.length} overlapping clip${moved.length === 1 ? '' : 's'} onto free tracks`, source: 'local', ops: moved.map((c) => ({ type: 'moveClip', clipId: c.id, track: c.track, startSec: c.startSec }) as StudioEditOp) }
  }

  const targets = /\b(?:all|every|everything|each)\b/.test(text) ? doc.clips.filter((c) => c.kind !== 'audio') : doc.clips.filter((c) => c.id === selectedId)
  if (/\b(?:remove|clear|delete|reset|strip)\b.*\b(?:keyframes?|motion|animation)s?\b/.test(text)) {
    const clear = targets.length ? targets : doc.clips.filter((c) => c.keyframes?.length)
    if (clear.length) return { summary: `Remove keyframes from ${clear.length} clip${clear.length === 1 ? '' : 's'}`, source: 'local', ops: clear.map((c) => ({ type: 'clearKeyframes', clipId: c.id }) as StudioEditOp) }
  }

  if (POLISH_RE.test(text) && !selectedId) return polishPlan(doc, instruction)
  if (POLISH_RE.test(text) && /\b(?:all|every|everything|whole|timeline|video|edit)\b/.test(text)) return polishPlan(doc, instruction)

  const motionTargets = targets.length ? targets : []
  // An explicit keyframe count means the user wants keys they can grab and
  // edit, not an opaque recipe — so emit exactly that many setKeyframe ops.
  const keyCount = requestedKeyframeCount(text)
  if (keyCount) {
    const keyTargets = (motionTargets.length ? motionTargets : doc.clips.filter((c) => c.kind !== 'audio').slice(0, 1)).filter((c) => c.kind !== 'audio')
    if (keyTargets.length) {
      const ops = keyTargets.flatMap((c, index) => keyframeOpsFor(c, motionSpecFromText(instruction, c) ?? directClip(c, { index, textIndex: index, mediaIndex: index, isHero: index === 0, isLast: false }, styleFromInstruction(instruction)), keyCount))
      if (ops.length) {
        return {
          summary: `Add ${keyCount} editable keyframe${keyCount === 1 ? '' : 's'} to ${keyTargets.length === 1 ? `“${keyTargets[0].name}”` : `${keyTargets.length} clips`}`,
          source: 'local',
          ops,
        }
      }
    }
  }
  const requested = motionSpecFromText(instruction, motionTargets[0])
  if (requested && motionTargets.length) {
    return {
      summary: `Animate ${motionTargets.length === 1 ? `“${motionTargets[0].name}”` : `${motionTargets.length} clips`}: ${describeMotionSpec(requested)}`,
      source: 'local',
      ops: motionTargets.filter((c) => c.kind !== 'audio').map((c) => ({ type: 'applyMotion', clipId: c.id, motion: requested }) as StudioEditOp),
    }
  }
  if (requested && !motionTargets.length) {
    const all = doc.clips.filter((c) => c.kind !== 'audio')
    return { summary: `Animate all ${all.length} layers: ${describeMotionSpec(requested)}`, source: 'local', ops: all.map((c) => ({ type: 'applyMotion', clipId: c.id, motion: requested }) as StudioEditOp) }
  }
  if (!selectedId) return polishPlan(doc, instruction)

  const clip = doc.clips.find((item) => item.id === selectedId)
  if (!clip) throw new Error('Select a clip first so Cupric knows what to edit')
  const patch: Record<string, string | number> = {}
  const visualX: number | null = clip.kind === 'video' || clip.kind === 'image' ? (clip.x ?? 0.5) : 'x' in clip && typeof clip.x === 'number' ? clip.x : null
  const visualY: number | null = clip.kind === 'video' || clip.kind === 'image' ? (clip.y ?? 0.5) : 'y' in clip && typeof clip.y === 'number' ? clip.y : null
  if (clip.kind === 'text') {
    const rewrite = instruction.match(/(?:change|replace|set|make)\s+(?:the\s+)?(?:text|copy|words?)\s+(?:to|into|as)\s+["“']?(.+?)["”']?$/i)?.[1]
    if (rewrite) patch.text = rewrite.slice(0, 500)
  }
  if (/move (it )?up|higher/.test(text) && visualY !== null) patch.y = clamp(visualY - 0.1, 0, 1)
  if (/move (it )?down|lower/.test(text) && visualY !== null) patch.y = clamp(visualY + 0.1, 0, 1)
  if (/move (it )?left/.test(text) && visualX !== null) patch.x = clamp(visualX - 0.1, 0, 1)
  if (/move (it )?right/.test(text) && visualX !== null) patch.x = clamp(visualX + 0.1, 0, 1)
  if (/bigger|larger/.test(text)) {
    if (clip.kind === 'text') patch.fontSizePct = Math.min(28, clip.fontSizePct * 1.2)
    else if (clip.kind === 'overlay' || clip.kind === 'sticker' || clip.kind === 'video' || clip.kind === 'image') patch.scale = (clip.scale ?? 1) * 1.2
  }
  if (/smaller/.test(text)) {
    if (clip.kind === 'text') patch.fontSizePct = Math.max(2, clip.fontSizePct * 0.8)
    else if (clip.kind === 'overlay' || clip.kind === 'sticker' || clip.kind === 'video' || clip.kind === 'image') patch.scale = (clip.scale ?? 1) * 0.8
  }
  if (/fade in/.test(text)) patch.transitionIn = 'fade'
  const requestedTransition: [RegExp, StudioTransition][] = [
    [/glass wipe/, 'glass-wipe'], [/liquid dissolve|melt/, 'liquid-dissolve'], [/lens sweep/, 'lens-sweep'],
    [/wipe/, 'wipe-left'], [/zoom transition|zoom in/, 'zoom-in'], [/blur transition|blur in/, 'blur'],
    [/iris/, 'iris'], [/push up/, 'push-up'],
  ]
  const transition = requestedTransition.find(([pattern]) => pattern.test(text))
  if (transition) patch.transitionIn = transition[1]
  if (clip.kind === 'text') {
    const requestedAnimation: [RegExp, StudioTextAnim][] = [
      [/word reveal|word.by.word/, 'word-reveal'], [/typewriter|typing/, 'typewriter'], [/shimmer|shine/, 'shimmer'],
      [/glass rise|frost/, 'glass-rise'], [/liquid wave|wave text/, 'liquid-wave'], [/slide left|slide in/, 'slide-left'],
      [/pop|punch/, 'pop'], [/fade up|rise/, 'fade-up'],
    ]
    const animation = requestedAnimation.find(([pattern]) => pattern.test(text))
    if (animation) patch.anim = animation[1]
    const highlightRequest = instruction.match(/highlight\s+["“']?([\w'-]+)["”']?/i)?.[1]
    if (highlightRequest) {
      const exactWord = clip.text.match(/[A-Za-z0-9][A-Za-z0-9'-]*/g)?.find((word) => word.toLowerCase() === highlightRequest.toLowerCase())
      if (exactWord) patch.highlightWord = exactWord
    }
    if (/playfair|serif|cinematic font/.test(text)) patch.fontFamily = 'Playfair Display Variable'
    else if (/manrope|modern font/.test(text)) patch.fontFamily = 'Manrope Variable'
    else if (/dm sans|social font/.test(text)) patch.fontFamily = 'DM Sans Variable'
    else if (/space grotesk|geometric|tech font/.test(text)) patch.fontFamily = 'Space Grotesk Variable'
    else if (/mono|technical font/.test(text)) patch.fontFamily = 'JetBrains Mono Variable'
    else if (/inter|clean sans/.test(text)) patch.fontFamily = 'Inter Variable'
    const colors: [RegExp, string][] = [[/\blime\b/, '#C8F542'], [/\bblue\b/, '#4FB6E8'], [/\bred\b/, '#E24B4A'], [/\bwhite\b/, '#F4F1EA']]
    const color = colors.find(([pattern]) => pattern.test(text))
    if (color) patch.color = color[1]
  }
  const track = text.match(/\b(?:track|t)\s*(\d{1,2})\b/i)?.[1]
  if (track) return { summary: `Move “${clip.name}” to track ${track}`, source: 'local', ops: [{ type: 'moveClip', clipId: clip.id, track: Number(track) - 1 }] }
  const rotate = text.match(/rotate(?: it)?\s*(-?\d+)/)?.[1]
  if (rotate) patch.rotation = Number(rotate)
  if (Object.keys(patch).length) return { summary: `Edit “${clip.name}”`, source: 'local', ops: [{ type: 'patchClip', clipId: clip.id, patch }] }
  // Nothing specific recognised: give the selected clip directed, role-aware
  // motion rather than refusing. The plan preview lets the user say no.
  const style = styleFromInstruction(instruction)
  const lastEnd = Math.max(0, ...doc.clips.map((c) => c.startSec + c.durationSec))
  const spec = directClip(clip, { index: 0, textIndex: 0, mediaIndex: 0, isHero: clip.kind === 'text', isLast: Math.abs(clip.startSec + clip.durationSec - lastEnd) < 0.05 }, style)
  return {
    summary: `Give “${clip.name}” directed motion: ${describeMotionSpec(spec)}`,
    source: 'local',
    ops: [{ type: 'applyMotion', clipId: clip.id, motion: spec }],
    warning: 'Cupric did not recognise a specific change, so it proposed professional motion for the selected clip. Try “bounce in and float”, “make it bigger”, or “add a caption saying …”.',
  }
}


/**
 * A live model asked to "auto polish" sometimes returns one fade on one clip.
 * When a broad request leaves visible clips untouched, add the motion
 * director's treatment for exactly those clips, so the result is never
 * trivial. Narrow requests are left alone.
 */
export function enrichThinPlan(plan: StudioEditPlan, instruction: string, doc: StudioDoc, selectedId: string | null): StudioEditPlan {
  // Asked for a component by name, but the model forgot to place it.
  if (plan.source !== 'local' && !plan.ops.some((op) => op.type === 'addComponent')) {
    const component = componentPlan(instruction, doc, { time: studioPlayhead() ?? undefined })
    if (component) plan = { ...plan, ops: [...plan.ops, ...component.ops], summary: `${plan.summary} + ${component.summary}` }
  }
  const broad = POLISH_RE.test(instruction.toLowerCase()) && (!selectedId || /\b(?:all|every|everything|whole|timeline|video|edit)\b/i.test(instruction))
  if (!broad || plan.source === 'local') return plan
  const visible = doc.clips.filter((c) => c.kind !== 'audio')
  const touched = new Set(plan.ops.flatMap((op) => ('clipId' in op ? [op.clipId] : [])))
  const animated = new Set(plan.ops.flatMap((op) => (op.type === 'applyMotion' || op.type === 'setKeyframe' ? [op.clipId] : [])))
  const missing = visible.filter((c) => !touched.has(c.id) || !animated.has(c.id))
  if (!missing.length) return plan
  let local: StudioEditPlan
  try {
    local = polishPlan(doc, instruction)
  } catch {
    return plan
  }
  const missingIds = new Set(missing.map((c) => c.id))
  const extra = local.ops.filter((op) => 'clipId' in op && missingIds.has(op.clipId) && !(op.type === 'patchClip' && touched.has(op.clipId)))
  if (!extra.length) return plan
  return {
    ...plan,
    ops: [...plan.ops, ...extra],
    summary: `${plan.summary} + directed motion for ${missing.length} more layer${missing.length === 1 ? '' : 's'}`,
  }
}
