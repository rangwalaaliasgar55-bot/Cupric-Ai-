/**
 * Motion director.
 *
 * Keyframes are easy to add and hard to get right. A model asked to "animate
 * the logo" writes two keys at 0s and 0.7s and calls it a day; a motion
 * designer thinks in phases (enter → live → leave), budgets time so the
 * viewer can actually read, picks a curve that matches the intent, and never
 * lets two systems animate the same thing at once.
 *
 * This module is that designer, as deterministic code. The AI (or the local
 * planner, or the user in the inspector) chooses *what* — "scale-pop in, float
 * while on screen, sink out" — and `choreograph` writes the keyframes: correct
 * timing for the clip length, relative to the clip's resting position and
 * size, with professional eases. Same input, same output, always valid.
 */
import type { StudioClip, StudioEase, StudioKeyframe, StudioTextAnim, StudioTextClip, StudioTransition } from '../../types/project'
import { clamp } from '../utils'

export type EntranceRecipe =
  | 'fade-in'
  | 'rise-in'
  | 'drop-in'
  | 'slide-in-left'
  | 'slide-in-right'
  | 'scale-pop'
  | 'zoom-in'
  | 'spin-in'
  | 'whip-in'
  | 'blur-focus'
export type EmphasisRecipe = 'pulse' | 'shake' | 'float' | 'breathe' | 'wiggle' | 'heartbeat'
export type ExitRecipe = 'fade-out' | 'sink-out' | 'rise-out' | 'slide-out-left' | 'slide-out-right' | 'zoom-out' | 'pop-out'
export type CameraRecipe = 'ken-burns-in' | 'ken-burns-out' | 'pan-left' | 'pan-right' | 'push-in' | 'drift-up' | 'dolly-punch'

export type MotionSpec = {
  entrance?: EntranceRecipe | 'none'
  emphasis?: EmphasisRecipe | 'none'
  exit?: ExitRecipe | 'none'
  /** Whole-clip camera move, meant for video and image layers. */
  camera?: CameraRecipe | 'none'
  /** 0.5 = subtle, 1 = standard, 1.6 = punchy. Scales distances, not timing. */
  intensity?: number
}

type Offsets = { dx?: number; dy?: number; scale?: number; rotation?: number; opacity?: number }

const ENTRANCES: Record<EntranceRecipe, { label: string; from: Offsets; ease: StudioEase }> = {
  'fade-in': { label: 'Fade in', from: { opacity: 0 }, ease: 'ease-out' },
  'rise-in': { label: 'Rise in', from: { dy: 0.06, opacity: 0, scale: 0.96 }, ease: 'expo-out' },
  'drop-in': { label: 'Drop in', from: { dy: -0.09, opacity: 0 }, ease: 'back-out' },
  'slide-in-left': { label: 'Slide in from left', from: { dx: -0.28, opacity: 0 }, ease: 'expo-out' },
  'slide-in-right': { label: 'Slide in from right', from: { dx: 0.28, opacity: 0 }, ease: 'expo-out' },
  'scale-pop': { label: 'Scale pop', from: { scale: 0.55, opacity: 0 }, ease: 'back-out' },
  'zoom-in': { label: 'Zoom in', from: { scale: 1.35, opacity: 0 }, ease: 'expo-out' },
  'spin-in': { label: 'Spin in', from: { rotation: -120, scale: 0.4, opacity: 0 }, ease: 'back-out' },
  'whip-in': { label: 'Whip in', from: { dx: 0.4, rotation: 8, opacity: 0 }, ease: 'expo-out' },
  'blur-focus': { label: 'Focus in', from: { scale: 1.08, opacity: 0 }, ease: 'ease-out' },
}

const EXITS: Record<ExitRecipe, { label: string; to: Offsets; ease: StudioEase }> = {
  'fade-out': { label: 'Fade out', to: { opacity: 0 }, ease: 'ease-in' },
  'sink-out': { label: 'Sink out', to: { dy: 0.05, opacity: 0 }, ease: 'ease-in' },
  'rise-out': { label: 'Rise out', to: { dy: -0.05, opacity: 0 }, ease: 'ease-in' },
  'slide-out-left': { label: 'Slide out left', to: { dx: -0.3, opacity: 0 }, ease: 'back-in' },
  'slide-out-right': { label: 'Slide out right', to: { dx: 0.3, opacity: 0 }, ease: 'back-in' },
  'zoom-out': { label: 'Zoom out', to: { scale: 0.8, opacity: 0 }, ease: 'ease-in' },
  'pop-out': { label: 'Pop out', to: { scale: 1.2, opacity: 0 }, ease: 'back-in' },
}

const EMPHASES: Record<EmphasisRecipe, string> = {
  pulse: 'Pulse',
  shake: 'Shake',
  float: 'Float',
  breathe: 'Breathe',
  wiggle: 'Wiggle',
  heartbeat: 'Heartbeat',
}

const CAMERAS: Record<CameraRecipe, string> = {
  'ken-burns-in': 'Ken Burns push',
  'ken-burns-out': 'Ken Burns pull',
  'pan-left': 'Pan left',
  'pan-right': 'Pan right',
  'push-in': 'Snap push-in',
  'drift-up': 'Drift up',
  'dolly-punch': 'Punch zoom',
}

export const ENTRANCE_RECIPES = Object.entries(ENTRANCES).map(([id, v]) => ({ id: id as EntranceRecipe, label: v.label }))
export const EXIT_RECIPES = Object.entries(EXITS).map(([id, v]) => ({ id: id as ExitRecipe, label: v.label }))
export const EMPHASIS_RECIPES = Object.entries(EMPHASES).map(([id, label]) => ({ id: id as EmphasisRecipe, label }))
export const CAMERA_RECIPES = Object.entries(CAMERAS).map(([id, label]) => ({ id: id as CameraRecipe, label }))

export const ALL_RECIPE_IDS = new Set<string>([
  ...Object.keys(ENTRANCES),
  ...Object.keys(EXITS),
  ...Object.keys(EMPHASES),
  ...Object.keys(CAMERAS),
])

/** One-click looks for the inspector and the agent. */
export const MOTION_PRESETS: Array<{ id: string; label: string; hint: string; spec: MotionSpec }> = [
  { id: 'title-pop', label: 'Title pop', hint: 'Overshoot in, hold, fade', spec: { entrance: 'scale-pop', exit: 'fade-out', intensity: 1 } },
  { id: 'editorial', label: 'Editorial rise', hint: 'Soft rise, long glide', spec: { entrance: 'rise-in', exit: 'fade-out', intensity: 0.8 } },
  { id: 'lower-third', label: 'Lower third', hint: 'Slide in and out left', spec: { entrance: 'slide-in-left', exit: 'slide-out-left', intensity: 0.8 } },
  { id: 'hype', label: 'Hype punch', hint: 'Zoom in, pulse, pop out', spec: { entrance: 'zoom-in', emphasis: 'pulse', exit: 'pop-out', intensity: 1.3 } },
  { id: 'sticker', label: 'Sticker bounce', hint: 'Spin in, float, pop out', spec: { entrance: 'spin-in', emphasis: 'float', exit: 'pop-out', intensity: 1 } },
  { id: 'whip', label: 'Whip', hint: 'Fast whip in, slide out', spec: { entrance: 'whip-in', exit: 'slide-out-left', intensity: 1.2 } },
  { id: 'ken-burns', label: 'Ken Burns', hint: 'Slow cinematic push', spec: { entrance: 'fade-in', camera: 'ken-burns-in', intensity: 1 } },
  { id: 'punch', label: 'Punch zoom', hint: 'Beat-synced punch', spec: { camera: 'dolly-punch', intensity: 1 } },
  { id: 'calm', label: 'Calm focus', hint: 'Barely-there focus pull', spec: { entrance: 'blur-focus', emphasis: 'breathe', exit: 'fade-out', intensity: 0.6 } },
]

const POSITIONED = new Set(['shape', 'text', 'overlay', 'glass', 'sticker', 'video', 'image'])
const SCALABLE = new Set(['shape', 'text', 'overlay', 'glass', 'sticker', 'video', 'image'])

type Rest = { x?: number; y?: number; scale?: number; rotation: number; opacity: number }

function restOf(clip: StudioClip): Rest {
  const positioned = POSITIONED.has(clip.kind)
  const x = clip.kind === 'video' || clip.kind === 'image' ? (clip.x ?? 0.5) : 'x' in clip && typeof clip.x === 'number' ? clip.x : 0.5
  const y = clip.kind === 'video' || clip.kind === 'image' ? (clip.y ?? 0.5) : 'y' in clip && typeof clip.y === 'number' ? clip.y : 0.5
  return {
    ...(positioned ? { x, y } : {}),
    ...(SCALABLE.has(clip.kind) ? { scale: 1 } : {}),
    rotation: clip.rotation ?? 0,
    opacity: 1,
  }
}

function applyOffsets(rest: Rest, o: Offsets | undefined, intensity: number): Rest {
  if (!o) return { ...rest }
  const k = intensity
  const out: Rest = { ...rest }
  if (out.x !== undefined && o.dx) out.x = clamp(out.x + o.dx * k, 0, 1)
  if (out.y !== undefined && o.dy) out.y = clamp(out.y + o.dy * k, 0, 1)
  // Scale offsets are relative to 1: 0.55 at intensity 1.3 → 1 - 0.45×1.3.
  if (out.scale !== undefined && o.scale !== undefined) out.scale = clamp(1 + (o.scale - 1) * k, 0.05, 10)
  if (o.rotation) out.rotation = rest.rotation + o.rotation * k
  if (o.opacity !== undefined) out.opacity = clamp(o.opacity, 0, 1)
  return out
}

function key(at: number, values: Rest, ease: StudioEase): StudioKeyframe {
  const k: StudioKeyframe = { at: Math.round(at * 1000) / 1000, ease }
  if (values.x !== undefined) k.x = Math.round(values.x * 10000) / 10000
  if (values.y !== undefined) k.y = Math.round(values.y * 10000) / 10000
  if (values.scale !== undefined) k.scale = Math.round(values.scale * 10000) / 10000
  k.rotation = Math.round(values.rotation * 100) / 100
  k.opacity = Math.round(values.opacity * 1000) / 1000
  return k
}

/**
 * Timing budget. Entrances take ~18% of a clip (0.3–0.8s), exits ~14%
 * (0.25–0.6s), and at least half the clip is spent at rest so text can be
 * read. Very short clips get a quick entrance and no exit — the cut is the exit.
 */
export function motionTiming(durationSec: number, spec: MotionSpec) {
  const d = Math.max(0.2, durationSec)
  const wantsIn = spec.entrance && spec.entrance !== 'none'
  const wantsOut = spec.exit && spec.exit !== 'none'
  if (d < 1) return { tIn: wantsIn ? d * 0.45 : 0, tOut: 0 }
  let tIn = wantsIn ? clamp(d * 0.18, 0.3, 0.8) : 0
  let tOut = wantsOut ? clamp(d * 0.14, 0.25, 0.6) : 0
  const maxMotion = d * 0.5
  if (tIn + tOut > maxMotion) {
    const scale = maxMotion / (tIn + tOut)
    tIn *= scale
    tOut *= scale
  }
  return { tIn, tOut }
}

/** Write a clean keyframe track for `clip` from a motion spec. */
export function choreograph(clip: StudioClip, spec: MotionSpec): StudioKeyframe[] {
  if (clip.kind === 'audio') return []
  const d = Math.max(0.2, clip.durationSec)
  const k = clamp(spec.intensity ?? 1, 0.3, 2)
  const rest = restOf(clip)
  const { tIn, tOut } = motionTiming(d, spec)
  const liveStart = tIn
  const liveEnd = d - tOut
  const keys: StudioKeyframe[] = []

  const entrance = spec.entrance && spec.entrance !== 'none' ? ENTRANCES[spec.entrance] : null
  const exit = spec.exit && spec.exit !== 'none' && tOut > 0 ? EXITS[spec.exit] : null
  const camera = spec.camera && spec.camera !== 'none' ? spec.camera : null
  const emphasis = spec.emphasis && spec.emphasis !== 'none' ? spec.emphasis : null

  // The "live" phase can itself move (camera) — compute its two ends.
  let liveA: Rest = { ...rest }
  let liveB: Rest = { ...rest }
  let liveEase: StudioEase = 'linear'
  if (camera && rest.scale !== undefined) {
    const c = k
    switch (camera) {
      case 'ken-burns-in':
        liveA = { ...rest, scale: 1 }
        liveB = { ...rest, scale: 1 + 0.12 * c }
        liveEase = 'ease-in-out'
        break
      case 'ken-burns-out':
        liveA = { ...rest, scale: 1 + 0.12 * c }
        liveB = { ...rest, scale: 1 }
        liveEase = 'ease-in-out'
        break
      case 'pan-left':
        liveA = { ...rest, scale: 1 + 0.1 * c, x: clamp((rest.x ?? 0.5) + 0.03 * c, 0, 1) }
        liveB = { ...rest, scale: 1 + 0.1 * c, x: clamp((rest.x ?? 0.5) - 0.03 * c, 0, 1) }
        liveEase = 'ease-in-out'
        break
      case 'pan-right':
        liveA = { ...rest, scale: 1 + 0.1 * c, x: clamp((rest.x ?? 0.5) - 0.03 * c, 0, 1) }
        liveB = { ...rest, scale: 1 + 0.1 * c, x: clamp((rest.x ?? 0.5) + 0.03 * c, 0, 1) }
        liveEase = 'ease-in-out'
        break
      case 'push-in':
        liveA = { ...rest, scale: 1 }
        liveB = { ...rest, scale: 1 + 0.08 * c }
        liveEase = 'expo-out'
        break
      case 'drift-up':
        liveA = { ...rest, scale: 1 + 0.06 * c, y: clamp((rest.y ?? 0.5) + 0.015 * c, 0, 1) }
        liveB = { ...rest, scale: 1 + 0.06 * c, y: clamp((rest.y ?? 0.5) - 0.015 * c, 0, 1) }
        liveEase = 'linear'
        break
      case 'dolly-punch':
        liveA = { ...rest, scale: 1 }
        liveB = { ...rest, scale: 1 }
        break
    }
  }

  // Enter.
  if (entrance && tIn > 0) {
    keys.push(key(0, applyOffsets(liveA, entrance.from, k), entrance.ease))
  }
  keys.push(key(liveStart, liveA, liveEase))

  // Live phase: a punch zoom, or emphasis beats layered between the ends.
  if (camera === 'dolly-punch' && rest.scale !== undefined) {
    const span = liveEnd - liveStart
    const beats = Math.max(1, Math.min(4, Math.floor(span / 0.9)))
    for (let i = 0; i < beats; i += 1) {
      const t = liveStart + (span * (i + 0.5)) / beats
      keys.push(key(t - 0.001, { ...liveA }, 'hold'))
      keys.push(key(t, { ...liveA, scale: 1 + 0.1 * k }, 'expo-out'))
      keys.push(key(Math.min(liveEnd, t + Math.min(0.45, span / beats / 1.6)), { ...liveA }, 'linear'))
    }
  } else if (emphasis) {
    const span = liveEnd - liveStart
    const lerp = (p: number): Rest => ({
      ...liveA,
      ...(liveA.x !== undefined && liveB.x !== undefined ? { x: liveA.x + (liveB.x - liveA.x) * p } : {}),
      ...(liveA.y !== undefined && liveB.y !== undefined ? { y: liveA.y + (liveB.y - liveA.y) * p } : {}),
      ...(liveA.scale !== undefined && liveB.scale !== undefined ? { scale: liveA.scale + (liveB.scale - liveA.scale) * p } : {}),
    })
    const add = (p: number, o: Partial<Rest>, ease: StudioEase) => {
      if (span <= 0.2) return
      const base = lerp(p)
      keys.push(key(liveStart + span * p, { ...base, ...Object.fromEntries(Object.entries(o).map(([name, v]) => [name, name === 'rotation' ? base.rotation + (v as number) : name === 'scale' ? (base.scale ?? 1) * (v as number) : name === 'y' ? clamp((base.y ?? 0.5) + (v as number), 0, 1) : v])) }, ease))
    }
    switch (emphasis) {
      case 'pulse':
        add(0.45, { scale: 1 + 0.07 * k }, 'ease-in-out')
        add(0.6, {}, 'ease-in-out')
        break
      case 'heartbeat':
        add(0.35, { scale: 1 + 0.08 * k }, 'ease-out')
        add(0.42, {}, 'ease-out')
        add(0.5, { scale: 1 + 0.06 * k }, 'ease-out')
        add(0.6, {}, 'ease-in-out')
        break
      case 'shake':
        ;[0.4, 0.44, 0.48, 0.52, 0.56].forEach((p, i) => add(p, { rotation: (i % 2 ? -1 : 1) * 4 * k }, 'linear'))
        add(0.6, {}, 'ease-out')
        break
      case 'wiggle':
        ;[0.3, 0.45, 0.6, 0.75].forEach((p, i) => add(p, { rotation: (i % 2 ? -1 : 1) * 2.5 * k }, 'ease-in-out'))
        add(0.9, {}, 'ease-in-out')
        break
      case 'float':
        add(0.33, { y: -0.012 * k }, 'ease-in-out')
        add(0.66, { y: 0.008 * k }, 'ease-in-out')
        break
      case 'breathe':
        add(0.5, { scale: 1 + 0.03 * k }, 'ease-in-out')
        break
    }
  }

  // Leave.
  if (exit) {
    keys.push(key(liveEnd, liveB, exit.ease))
    keys.push(key(d, applyOffsets(liveB, exit.to, k), 'linear'))
  } else if (liveEnd > liveStart + 0.01 && (camera || emphasis)) {
    keys.push(key(d, liveB, 'linear'))
  }

  // Sort and dedupe keys that landed on the same frame.
  const sorted = keys.sort((a, b) => a.at - b.at)
  const out: StudioKeyframe[] = []
  for (const k2 of sorted) {
    const prev = out[out.length - 1]
    if (prev && Math.abs(prev.at - k2.at) < 0.0005) out[out.length - 1] = { ...prev, ...k2 }
    else out.push({ ...k2, at: clamp(k2.at, 0, d) })
  }
  return out
}

/** Built-in text animations that also move the whole block — they would fight keyframe entrances. */
const BLOCK_MOVING_ANIMS = new Set<StudioTextAnim>(['fade-up', 'pop', 'slide-left', 'glass-rise'])

/**
 * The patch that applies a motion spec to a clip, including removing a text
 * animation that would double up with the keyframed entrance.
 */
export function motionPatch(clip: StudioClip, spec: MotionSpec): Partial<StudioClip> {
  const keyframes = choreograph(clip, spec)
  const patch: Partial<StudioClip> & { anim?: StudioTextAnim } = { keyframes }
  if (clip.kind === 'text' && spec.entrance && spec.entrance !== 'none' && BLOCK_MOVING_ANIMS.has((clip as StudioTextClip).anim)) {
    patch.anim = 'none'
  }
  // A keyframed entrance replaces a transition that would fade on top of it.
  if (spec.entrance && spec.entrance !== 'none' && clip.transitionIn !== 'none' && clip.kind !== 'video' && clip.kind !== 'image') {
    patch.transitionIn = 'none'
  }
  if (spec.exit && spec.exit !== 'none' && clip.transitionOut !== 'none' && clip.kind !== 'video' && clip.kind !== 'image') {
    patch.transitionOut = 'none'
  }
  return patch
}

/* ——— Direction: what a senior editor would choose ———————————————————————— */

export type DirectionStyle = 'editorial' | 'bold-social' | 'minimal' | 'cinematic'

const STOPWORDS = new Set(
  'the a an and or but of to in on at for with from by is are was were be been it this that these those your you our we my their his her its as into than then so just more most very can will not no yes all any each every about over under out up down new get got'.split(' '),
)

/** The word a viewer should notice: a number, a proper noun, or the strongest long word. */
export function pickHighlightWord(text: string): string {
  const words = text.match(/[A-Za-z0-9][A-Za-z0-9'-]*/g) ?? []
  if (words.length < 2) return ''
  const number = words.find((w) => /\d/.test(w))
  if (number) return number
  // The word that sells: offers and urgency beat merely long words.
  const persuasive = words.find((w) => /^(free|new|save|win|exclusive|instantly|unlimited|forever)$/i.test(w))
  if (persuasive) return persuasive
  const candidates = words.filter((w) => !STOPWORDS.has(w.toLowerCase()) && w.length > 3)
  const proper = candidates.slice(1).find((w) => /^[A-Z][a-z]/.test(w))
  if (proper) return proper
  return [...candidates].sort((a, b) => b.length - a.length)[0] ?? ''
}

/** Seconds a viewer needs to read `text` comfortably (≈ 200 wpm + a beat). */
export function readingTimeSec(text: string): number {
  const words = (text.match(/\S+/g) ?? []).length
  return clamp(0.8 + words * 0.3, 1.2, 8)
}

/** A style the user actually asked for, or null when they did not say. */
export function explicitStyle(text: string): DirectionStyle | null {
  const t = text.toLowerCase()
  if (/\b(social|reel|reels|tiktok|short|shorts|hype|bold|punchy|energetic|viral|youtube)\b/.test(t)) return 'bold-social'
  if (/\b(minimal|minimalist|calm|quiet|simple look|understated)\b/.test(t)) return 'minimal'
  if (/\b(cinematic|film|trailer|epic|dramatic|luxury|premium|brand)\b/.test(t)) return 'cinematic'
  if (/\b(editorial|magazine|documentary|elegant)\b/.test(t)) return 'editorial'
  return null
}

export function styleFromInstruction(text: string): DirectionStyle {
  return explicitStyle(text) ?? 'editorial'
}

/**
 * What the footage itself asks for, when the user gave no style: read the
 * words on screen and the clip names the way an editor skims a script.
 */
export function styleFromContent(clips: StudioClip[]): DirectionStyle {
  const copy = clips.map((c) => `${'text' in c ? (c as StudioTextClip).text : ''} ${c.name}`).join(' ').toLowerCase()
  const lines = clips.filter((c) => c.kind === 'text') as StudioTextClip[]
  const punchy = /\b(free|now|today|sale|off|deal|win|hack|secret|stop|wow|new)\b|!|\d+%|\$\d/.test(copy)
  const cinematic = /\b(introducing|film|story|journey|discover|legacy|crafted|brand|world|future|cinematic|meet)\b/.test(copy)
  const avgWords = lines.length ? lines.reduce((n, c) => n + c.text.split(/\s+/).length, 0) / lines.length : 0
  if (cinematic) return 'cinematic'
  if (punchy && avgWords <= 6) return 'bold-social'
  return 'editorial'
}

export const STYLE_INTENSITY: Record<DirectionStyle, number> = { editorial: 0.85, 'bold-social': 1.3, minimal: 0.6, cinematic: 0.9 }

/**
 * Choose a motion spec for one clip, given its role in the edit.
 *
 * - hero title (first / biggest text): the most expressive entrance
 * - lower thirds (y > 0.72): slide in and out from the side
 * - supporting text: a quieter entrance, alternating so it never repeats
 * - video / image: a slow camera move; alternating push and pull
 * - stickers, glass, overlays: a pop with a little life while on screen
 */
export function directClip(clip: StudioClip, role: { index: number; textIndex: number; mediaIndex: number; isHero: boolean; isLast: boolean }, style: DirectionStyle): MotionSpec {
  const intensity = STYLE_INTENSITY[style]
  if (clip.kind === 'text') {
    const y = clip.y
    if (y > 0.72) return { entrance: 'slide-in-left', exit: 'slide-out-left', intensity: intensity * 0.8 }
    if (role.isHero) {
      if (style === 'bold-social') return { entrance: 'scale-pop', emphasis: clip.durationSec > 3 ? 'pulse' : 'none', exit: 'pop-out', intensity }
      if (style === 'minimal') return { entrance: 'blur-focus', exit: 'fade-out', intensity }
      if (style === 'cinematic') return { entrance: 'blur-focus', emphasis: clip.durationSec > 3 ? 'breathe' : 'none', exit: 'fade-out', intensity }
      return { entrance: 'rise-in', exit: 'fade-out', intensity }
    }
    const cycle: EntranceRecipe[] = style === 'bold-social' ? ['zoom-in', 'slide-in-right', 'drop-in', 'whip-in'] : style === 'minimal' ? ['fade-in', 'rise-in'] : ['rise-in', 'slide-in-left', 'blur-focus', 'rise-in']
    const exitCycle: ExitRecipe[] = style === 'bold-social' ? ['zoom-out', 'slide-out-left', 'sink-out'] : ['fade-out', 'sink-out']
    return { entrance: cycle[role.textIndex % cycle.length], exit: role.isLast ? 'fade-out' : exitCycle[role.textIndex % exitCycle.length], intensity }
  }
  if (clip.kind === 'video' || clip.kind === 'image') {
    const cameras: CameraRecipe[] = style === 'bold-social' ? ['push-in', 'dolly-punch', 'ken-burns-in'] : ['ken-burns-in', 'ken-burns-out', 'pan-right', 'pan-left', 'drift-up']
    // Photos need the camera move more than footage, which already moves.
    const camera = clip.kind === 'image' || clip.durationSec >= 2 ? cameras[role.mediaIndex % cameras.length] : 'none'
    return { entrance: role.mediaIndex === 0 ? 'fade-in' : 'none', camera, exit: role.isLast ? 'fade-out' : 'none', intensity: clip.kind === 'video' ? intensity * 0.6 : intensity }
  }
  if (clip.kind === 'sticker') return { entrance: 'spin-in', emphasis: 'float', exit: 'pop-out', intensity }
  if (clip.kind === 'glass') return { entrance: 'rise-in', emphasis: 'breathe', exit: 'fade-out', intensity: intensity * 0.8 }
  if (clip.kind === 'overlay') return { entrance: 'scale-pop', emphasis: clip.durationSec > 3 ? 'float' : 'none', exit: 'fade-out', intensity }
  if (clip.kind === 'background') return { entrance: role.index === 0 ? 'fade-in' : 'none', intensity: 1 }
  return {}
}

/** Transitions between media cuts — varied, never the same twice in a row. */
export function directTransition(index: number, style: DirectionStyle): StudioTransition {
  const cycle: StudioTransition[] =
    style === 'bold-social'
      ? ['zoom-in', 'push-up', 'wipe-left', 'lens-sweep']
      : style === 'minimal'
        ? ['fade', 'blur']
        : style === 'cinematic'
          ? ['liquid-dissolve', 'blur', 'lens-sweep', 'fade']
          : ['fade', 'blur', 'liquid-dissolve', 'push-up']
  return index === 0 ? 'fade' : cycle[index % cycle.length]
}

export function describeMotionSpec(spec: MotionSpec): string {
  const parts = [
    spec.entrance && spec.entrance !== 'none' ? ENTRANCES[spec.entrance]?.label : '',
    spec.camera && spec.camera !== 'none' ? CAMERAS[spec.camera] : '',
    spec.emphasis && spec.emphasis !== 'none' ? EMPHASES[spec.emphasis] : '',
    spec.exit && spec.exit !== 'none' ? EXITS[spec.exit]?.label : '',
  ].filter(Boolean)
  return parts.length ? parts.join(' → ') : 'No motion'
}

/** Parse free text such as "bounce in, float, slide out to the left". */
export function motionSpecFromText(text: string, clip?: StudioClip): MotionSpec | null {
  const t = text.toLowerCase()
  const spec: MotionSpec = {}
  const entrance: Array<[RegExp, EntranceRecipe]> = [
    [/spin(?:s|ning)? in|rotate in|spin/, 'spin-in'],
    [/whip/, 'whip-in'],
    [/(?:pop|bounce|overshoot|spring)(?:s)?(?: in)?/, 'scale-pop'],
    [/zoom(?:s)? in|zoom-in|punch in/, 'zoom-in'],
    [/drop(?:s)? in|fall(?:s)? in|from (?:the )?top/, 'drop-in'],
    [/slide(?:s)? in from (?:the )?right|from (?:the )?right/, 'slide-in-right'],
    [/slide(?:s)? in|from (?:the )?left|lower third/, 'slide-in-left'],
    [/rise(?:s)?|fade up|float(?:s)? up|from (?:the )?bottom/, 'rise-in'],
    [/focus|blur in/, 'blur-focus'],
    [/fade(?:s)? in|appear/, 'fade-in'],
  ]
  const exit: Array<[RegExp, ExitRecipe]> = [
    [/slide(?:s)? out (?:to )?(?:the )?right|exit right/, 'slide-out-right'],
    [/slide(?:s)? out|exit left/, 'slide-out-left'],
    [/pop(?:s)? out|burst/, 'pop-out'],
    [/zoom(?:s)? out|shrink/, 'zoom-out'],
    [/sink|drop out|fall out/, 'sink-out'],
    [/rise out|fly up/, 'rise-out'],
    [/fade(?:s)? out|disappear|exit|at the end/, 'fade-out'],
  ]
  const emphasis: Array<[RegExp, EmphasisRecipe]> = [
    [/heartbeat|heart beat/, 'heartbeat'],
    [/pulse|pulsing|beat/, 'pulse'],
    [/shake|shaking|vibrate|earthquake/, 'shake'],
    [/wiggle|wobble/, 'wiggle'],
    [/float|hover|bob/, 'float'],
    [/breath/, 'breathe'],
  ]
  const camera: Array<[RegExp, CameraRecipe]> = [
    [/ken ?burns|slow (?:push|zoom)|cinematic zoom/, 'ken-burns-in'],
    [/pull (?:back|out)|zoom out slowly/, 'ken-burns-out'],
    [/pan (?:to the )?left/, 'pan-left'],
    [/pan (?:to the )?right|pan/, 'pan-right'],
    [/punch zoom|beat zoom|dolly/, 'dolly-punch'],
    [/push in|push-in/, 'push-in'],
    [/drift/, 'drift-up'],
  ]
  const outText = t.split(/\b(?:then|and then|,)\b/).slice(1).join(' ')
  const cam = camera.find(([re]) => re.test(t))
  if (cam && clip && (clip.kind === 'video' || clip.kind === 'image' || /ken|pan|push|drift|dolly|punch/.test(cam[0].source))) spec.camera = cam[1]
  const inHit = entrance.find(([re]) => re.test(t.replace(/(?:fade|slide|zoom|pop)s? out/g, '')))
  if (inHit && !(spec.camera && inHit[1] === 'zoom-in')) spec.entrance = inHit[1]
  const outHit = exit.find(([re]) => re.test(outText || t))
  if (outHit && /out|exit|disappear|end|shrink|burst|sink/.test(t)) spec.exit = outHit[1]
  const emp = emphasis.find(([re]) => re.test(t))
  if (emp) spec.emphasis = emp[1]
  if (/subtle|gentle|soft|calm|slow/.test(t)) spec.intensity = 0.6
  else if (/punchy|strong|big|dramatic|hype|energetic|fast|snappy/.test(t)) spec.intensity = 1.4
  if (!spec.entrance && !spec.exit && !spec.emphasis && !spec.camera) return null
  return spec
}
