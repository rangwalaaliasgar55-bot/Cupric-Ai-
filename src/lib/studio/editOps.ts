import type { StudioClip, StudioDoc, StudioKeyframe, StudioTextAnim, StudioTransition } from '../../types/project'
import { clamp } from '../utils'
import { defaultTextClip, normaliseClip, reorderTracks } from './doc'

export type StudioEditOp =
  | { type: 'patchClip'; clipId: string; patch: Record<string, string | number> }
  | { type: 'moveClip'; clipId: string; track?: number; startSec?: number }
  | { type: 'deleteClip'; clipId: string }
  | { type: 'addText'; text: string; track: number; startSec: number; durationSec: number; color?: string; fontFamily?: string; anim?: StudioTextAnim }
  | { type: 'setKeyframe'; clipId: string; at: number; values: Partial<Pick<StudioKeyframe, 'x' | 'y' | 'scale' | 'rotation' | 'opacity'>>; ease?: StudioKeyframe['ease'] }
  | { type: 'reorderTrack'; from: number; to: number }
  | { type: 'applyStylePreset'; preset: 'editorial' | 'bold-social' | 'minimal' }

export type StudioEditPlan = { summary: string; ops: StudioEditOp[]; source: 'live' | 'local'; warning?: string }

const PATCH_KEYS = new Set(['x', 'y', 'scale', 'rotation', 'opacity', 'fontSizePct', 'color', 'fontFamily', 'weight', 'align', 'highlightWord', 'text', 'anim', 'transitionIn', 'transitionOut', 'volume'])
const TEXT_KEYS = new Set(['fontSizePct', 'color', 'fontFamily', 'weight', 'align', 'highlightWord', 'text', 'anim'])
const FONTS = new Set(['Inter Variable', 'Manrope Variable', 'DM Sans Variable', 'Space Grotesk Variable', 'Playfair Display Variable', 'JetBrains Mono Variable'])
const ANIMS = new Set<StudioTextAnim>(['none', 'fade-up', 'pop', 'typewriter', 'word-reveal', 'shimmer', 'slide-left', 'glass-rise', 'liquid-wave'])
const TRANSITIONS = new Set<StudioTransition>(['none', 'fade', 'wipe-left', 'zoom-in', 'blur', 'iris', 'push-up', 'glass-wipe', 'liquid-dissolve', 'lens-sweep'])
const EASES = new Set<StudioKeyframe['ease']>(['linear', 'ease-in', 'ease-out', 'ease-in-out'])

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

export function validateStudioEditPlan(value: unknown, doc: StudioDoc): StudioEditPlan {
  if (!value || typeof value !== 'object') throw new Error('Edit plan must be an object')
  const raw = value as { summary?: unknown; ops?: unknown; source?: unknown; warning?: unknown }
  if (!Array.isArray(raw.ops) || raw.ops.length === 0 || raw.ops.length > 40) throw new Error('Edit plan must contain 1–40 operations')
  const ids = new Set(doc.clips.map((clip) => clip.id))
  const ops: StudioEditOp[] = raw.ops.map((entry, index) => {
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
        if (key === 'fontFamily' && !FONTS.has(String(item))) throw new Error(`Unknown bundled font “${item}”`)
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
        const ranges: Record<string, [number, number]> = { x: [0, 1], y: [0, 1], scale: [0.05, 10], rotation: [-3600, 3600], opacity: [0, 1], fontSizePct: [1, 40], volume: [0, 2] }
        if (key in ranges && (typeof item !== 'number' || item < ranges[key][0] || item > ranges[key][1])) throw new Error(`Property “${key}” is outside its safe range`)
        patch[key] = item
      }
      if (!Object.keys(patch).length) throw new Error(`Operation ${index + 1} has an empty patch`)
      return { type, clipId, patch }
    }
    if (type === 'moveClip') {
      const clipId = requireClip()
      if (!finite(op.track) && !finite(op.startSec)) throw new Error(`Operation ${index + 1} needs track or startSec`)
      return { type, clipId, ...(finite(op.track) ? { track: op.track } : {}), ...(finite(op.startSec) ? { startSec: op.startSec } : {}) }
    }
    if (type === 'deleteClip') return { type, clipId: requireClip() }
    if (type === 'addText') {
      if (typeof op.text !== 'string' || !op.text.trim() || op.text.length > 500) throw new Error(`Operation ${index + 1} needs 1–500 characters of text`)
      if (![op.track, op.startSec, op.durationSec].every(finite) || (op.startSec as number) < 0 || (op.durationSec as number) < 0.2) throw new Error(`Operation ${index + 1} has invalid timing`)
      if (op.color !== undefined && (typeof op.color !== 'string' || !/^#[0-9a-f]{6}$/i.test(op.color))) throw new Error(`Operation ${index + 1} has an invalid colour`)
      if (op.fontFamily !== undefined && !FONTS.has(String(op.fontFamily))) throw new Error(`Unknown bundled font “${op.fontFamily}”`)
      const anim = op.anim === undefined ? undefined : String(op.anim) as StudioTextAnim
      if (anim && !ANIMS.has(anim)) throw new Error(`Unknown animation “${anim}”`)
      return { type, text: op.text, track: op.track as number, startSec: op.startSec as number, durationSec: op.durationSec as number, ...(typeof op.color === 'string' ? { color: op.color } : {}), ...(typeof op.fontFamily === 'string' ? { fontFamily: op.fontFamily } : {}), ...(anim ? { anim } : {}) }
    }
    if (type === 'setKeyframe') {
      const clipId = requireClip()
      if (!finite(op.at) || !op.values || typeof op.values !== 'object') throw new Error(`Operation ${index + 1} has invalid keyframe data`)
      const values: Record<string, number> = {}
      for (const [key, item] of Object.entries(op.values as Record<string, unknown>)) {
        if (!['x', 'y', 'scale', 'rotation', 'opacity'].includes(key) || !finite(item)) throw new Error(`Invalid keyframe property “${key}”`)
        const targetClip = doc.clips.find((item) => item.id === clipId)!
        if ((key === 'x' || key === 'y') && !('x' in targetClip) && targetClip.kind !== 'video' && targetClip.kind !== 'image') throw new Error(`Keyframe property “${key}” does not apply to this clip`)
        if (key === 'scale' && !['overlay', 'sticker', 'video', 'image'].includes(targetClip.kind)) throw new Error('Scale keyframes only apply to visual clips')
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
    if (type === 'applyStylePreset' && ['editorial', 'bold-social', 'minimal'].includes(String(op.preset))) {
      return { type, preset: String(op.preset) as 'editorial' | 'bold-social' | 'minimal' }
    }
    throw new Error(`Operation ${index + 1} uses unsupported type “${type}”`)
  })
  return {
    summary: typeof raw.summary === 'string' && raw.summary.trim() ? raw.summary : `${ops.length} proposed edit${ops.length === 1 ? '' : 's'}`,
    ops,
    source: raw.source === 'local' ? 'local' : 'live',
    ...(typeof raw.warning === 'string' ? { warning: raw.warning } : {}),
  }
}

export function describeStudioEditOp(op: StudioEditOp, doc: StudioDoc): string {
  const name = 'clipId' in op ? doc.clips.find((clip) => clip.id === op.clipId)?.name ?? op.clipId : ''
  if (op.type === 'patchClip') return `Change ${name}: ${Object.entries(op.patch).map(([key, value]) => `${key} → ${value}`).join(', ')}`
  if (op.type === 'moveClip') return `Move ${name}${op.track !== undefined ? ` to T${op.track + 1}` : ''}${op.startSec !== undefined ? ` at ${op.startSec.toFixed(2)}s` : ''}`
  if (op.type === 'deleteClip') return `Delete ${name}`
  if (op.type === 'addText') return `Add text “${op.text}” on T${op.track + 1} at ${op.startSec.toFixed(2)}s`
  if (op.type === 'setKeyframe') return `Keyframe ${name} at ${op.at.toFixed(2)}s: ${Object.keys(op.values).join(', ')}`
  if (op.type === 'reorderTrack') return `Swap T${op.from + 1} and T${op.to + 1}`
  return `Apply ${op.preset} style across the timeline`
}

export function applyStudioEditPlan(doc: StudioDoc, ops: StudioEditOp[]): StudioDoc {
  let next = { ...doc, clips: [...doc.clips] }
  for (const op of ops) {
    if (op.type === 'deleteClip') next = { ...next, clips: next.clips.filter((clip) => clip.id !== op.clipId) }
    else if (op.type === 'moveClip') next = { ...next, clips: next.clips.map((clip) => clip.id === op.clipId ? normaliseClip({ ...clip, ...(op.track !== undefined ? { track: op.track } : {}), ...(op.startSec !== undefined ? { startSec: op.startSec } : {}) } as StudioClip, next.trackCount) : clip) }
    else if (op.type === 'patchClip') next = { ...next, clips: next.clips.map((clip) => clip.id === op.clipId ? normaliseClip({ ...clip, ...op.patch } as StudioClip, next.trackCount) : clip) }
    else if (op.type === 'addText') {
      const clip = defaultTextClip(Math.max(0, op.startSec), clamp(Math.round(op.track), 0, next.trackCount - 1))
      clip.text = op.text
      clip.durationSec = Math.max(0.2, op.durationSec)
      if (op.color) clip.color = op.color
      if (op.fontFamily) clip.fontFamily = op.fontFamily
      if (op.anim) clip.anim = op.anim
      next = { ...next, clips: [...next.clips, clip] }
    } else if (op.type === 'setKeyframe') next = { ...next, clips: next.clips.map((clip) => {
      if (clip.id !== op.clipId) return clip
      const at = clamp(op.at, 0, clip.durationSec)
      const keys = (clip.keyframes ?? []).filter((key) => Math.abs(key.at - at) > 0.02)
      return { ...clip, keyframes: [...keys, { at, ease: op.ease ?? 'ease-in-out', ...op.values }].sort((a, b) => a.at - b.at) }
    }) }
    else if (op.type === 'reorderTrack') next = reorderTracks(next, op.from, op.to)
    else if (op.type === 'applyStylePreset') next = applyStyle(next, op.preset)
  }
  return next
}

function applyStyle(doc: StudioDoc, preset: Extract<StudioEditOp, { type: 'applyStylePreset' }>['preset']): StudioDoc {
  const styles = {
    editorial: { color: '#F4F1EA', fontFamily: 'Playfair Display Variable', anim: 'fade-up' as StudioTextAnim, transitionIn: 'fade' as StudioTransition },
    'bold-social': { color: '#C8F542', fontFamily: 'Inter Variable', anim: 'pop' as StudioTextAnim, transitionIn: 'zoom-in' as StudioTransition },
    minimal: { color: '#F4F1EA', fontFamily: 'Manrope Variable', anim: 'none' as StudioTextAnim, transitionIn: 'fade' as StudioTransition },
  }[preset]
  return { ...doc, clips: doc.clips.map((clip) => clip.kind === 'text' ? { ...clip, ...styles } : clip) }
}

/** Useful without a model and intentionally conservative: selected clip only. */
export function localStudioEditPlan(instruction: string, doc: StudioDoc, selectedId: string | null): StudioEditPlan {
  const text = instruction.trim().toLowerCase()
  if (/analy[sz]e the timeline|automatic edit|auto edit|auto polish|automatic effects|auto effects|effects pass/.test(text)) {
    if (!doc.clips.length) throw new Error('Import or add at least one clip before running Auto edit')
    const ops: StudioEditOp[] = [{ type: 'applyStylePreset', preset: /social|short|reel|bold/.test(text) ? 'bold-social' : 'editorial' }]
    const transitionCycle: StudioTransition[] = ['fade', 'push-up', 'blur', 'glass-wipe', 'lens-sweep']
    const animationCycle: StudioTextAnim[] = ['word-reveal', 'fade-up', 'pop', 'glass-rise', 'shimmer']
    const editable = doc.clips.filter((item) => item.kind !== 'audio').slice(0, 12)
    editable.forEach((item, index) => {
      const transitionIn = index === 0 ? 'fade' : transitionCycle[index % transitionCycle.length]
      if (item.kind === 'text') {
        const words = item.text.match(/[A-Za-z0-9][A-Za-z0-9'-]*/g) ?? []
        const highlightWord = [...words].filter((word) => word.length > 3).sort((a, b) => b.length - a.length)[0] ?? ''
        const technical = /\b(ai|api|data|software|system|future|digital|tech|code)\b/i.test(item.text)
        const editorial = words.length > 9 || /\b(story|discover|journey|beautiful|introducing)\b/i.test(item.text)
        ops.push({
          type: 'patchClip',
          clipId: item.id,
          patch: {
            transitionIn,
            anim: animationCycle[index % animationCycle.length],
            fontFamily: technical ? 'Space Grotesk Variable' : editorial ? 'Playfair Display Variable' : 'DM Sans Variable',
            weight: index === 0 ? 800 : 600,
            ...(highlightWord ? { highlightWord } : {}),
          },
        })
      } else {
        ops.push({ type: 'patchClip', clipId: item.id, patch: { transitionIn } })
      }
    })
    const moving = editable.filter((item) => ['video', 'image', 'overlay', 'sticker'].includes(item.kind)).slice(0, 3)
    for (const item of moving) {
      const x = 'x' in item && typeof item.x === 'number' ? item.x : 0.5
      const y = 'y' in item && typeof item.y === 'number' ? item.y : 0.5
      const scale = 'scale' in item && typeof item.scale === 'number' ? item.scale : 1
      ops.push(
        { type: 'setKeyframe', clipId: item.id, at: 0, values: { x, y: clamp(y + 0.025, 0, 1), scale: scale * 0.96, opacity: 0.75 }, ease: 'ease-out' },
        { type: 'setKeyframe', clipId: item.id, at: Math.min(0.75, item.durationSec * 0.35), values: { x, y, scale, opacity: 1 }, ease: 'ease-in-out' },
      )
    }
    return {
      summary: `Auto-polish ${editable.length} timeline layer${editable.length === 1 ? '' : 's'} with typography, highlights, transitions and purposeful motion`,
      source: 'local',
      ops,
      warning: 'The live model was unavailable, so Cupric prepared this deterministic effect pass locally. Review the listed changes before accepting them.',
    }
  }
  const clip = doc.clips.find((item) => item.id === selectedId)
  if (!clip) throw new Error('Select a clip first so Cupric knows what to edit')
  const patch: Record<string, string | number> = {}
  const visualX: number | null = clip.kind === 'video' || clip.kind === 'image' ? (clip.x ?? 0.5) : 'x' in clip && typeof clip.x === 'number' ? clip.x : null
  const visualY: number | null = clip.kind === 'video' || clip.kind === 'image' ? (clip.y ?? 0.5) : 'y' in clip && typeof clip.y === 'number' ? clip.y : null
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
  const track = text.match(/(?:track|t)\s*([1-8])/i)?.[1]
  if (track) return { summary: `Move “${clip.name}” to track ${track}`, source: 'local', ops: [{ type: 'moveClip', clipId: clip.id, track: Number(track) - 1 }] }
  const rotate = text.match(/rotate(?: it)?\s*(-?\d+)/)?.[1]
  if (rotate) patch.rotation = Number(rotate)
  if (/add (?:two )?keyframes|animate (?:it|movement)|subtle motion/.test(text) && visualX !== null && visualY !== null) {
    const canScale = ['overlay', 'sticker', 'video', 'image'].includes(clip.kind)
    const scale = canScale && 'scale' in clip && typeof clip.scale === 'number' ? clip.scale : 1
    const ops: StudioEditOp[] = Object.keys(patch).length ? [{ type: 'patchClip', clipId: clip.id, patch }] : []
    ops.push(
      { type: 'setKeyframe', clipId: clip.id, at: 0, values: { x: visualX, y: clamp(visualY + 0.03, 0, 1), ...(canScale ? { scale: scale * 0.96 } : {}), opacity: 0.7 }, ease: 'ease-out' },
      { type: 'setKeyframe', clipId: clip.id, at: Math.min(0.7, clip.durationSec * 0.35), values: { x: visualX, y: visualY, ...(canScale ? { scale } : {}), opacity: 1 }, ease: 'ease-in-out' },
    )
    return { summary: `Animate “${clip.name}” with editable entrance and settle keyframes`, source: 'local', ops }
  }
  if (Object.keys(patch).length) return { summary: `Edit “${clip.name}”`, source: 'local', ops: [{ type: 'patchClip', clipId: clip.id, patch }] }
  throw new Error('That instruction needs a live AI model. Try “move it up”, “make it bigger”, “fade in”, “rotate 15”, or “move to track 3”.')
}
