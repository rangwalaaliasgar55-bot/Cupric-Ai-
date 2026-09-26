/**
 * Generated motion graphics, taken apart into editable clips.
 *
 * Until now an Arena piece arrived in the Studio as a single captured frame:
 * you could move it and scale it, and that was all. The thing the model spent
 * its effort on — the scene copy, the timings, the order — was locked inside
 * an HTML file the canvas cannot execute.
 *
 * Every piece Cupric generates is required to declare
 * `window.__cupricSourceManifest = { sources, sequence, renderSpec }`, and the
 * scene list is the sequence. So the output is not a black box: it is a
 * storyboard with a renderer attached, and this reads the storyboard back out
 * as real text clips the user can retime, rewrite and restyle.
 *
 * Nothing here executes the file. It is parsed as text, on purpose — running
 * generated JavaScript to find out what it says would be a security decision,
 * not a convenience.
 */
import type { SceneRundown, StudioClip, StudioDoc, StudioTextAnim, StudioTransition } from '../../types/project'
import { uid } from '../utils'
import { defaultTextClip, nextFreeStart } from './doc'

export type ImportedScene = {
  /** Seconds from the start of the piece. */
  from: number
  to: number
  copy: string
  /** Free-text motion description from the manifest, used to pick an animation. */
  motion?: string
  type?: string
}

export type ImportedPiece = {
  scenes: ImportedScene[]
  durationSec: number
  fps: 24 | 30 | 60 | null
  size: [number, number] | null
  /** What the manifest said the piece was built from. */
  sources: string[]
  /** How the scenes were recovered, so the UI can be honest about confidence. */
  via: 'manifest' | 'scene-array' | 'headings'
}

/** Pull the first balanced `{…}` or `[…]` literal starting at `from`. */
function balancedLiteral(text: string, from: number): string | null {
  const open = text[from]
  const close = open === '{' ? '}' : open === '[' ? ']' : null
  if (!close) return null
  let depth = 0
  let inString: string | null = null
  for (let i = from; i < text.length; i += 1) {
    const ch = text[i]
    if (inString) {
      if (ch === '\\') i += 1
      else if (ch === inString) inString = null
      continue
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      inString = ch
      continue
    }
    if (ch === open) depth += 1
    else if (ch === close) {
      depth -= 1
      if (depth === 0) return text.slice(from, i + 1)
    }
  }
  return null
}

/**
 * Parse a JS object literal loosely enough to cope with what models write.
 *
 * Unquoted keys, single quotes and trailing commas are all normal in
 * hand-written JS and all invalid JSON. This repairs those three things and
 * nothing else — anything cleverer would be evaluating code by another name.
 */
function looseParse<T>(literal: string): T | null {
  const candidates = [
    literal,
    literal
      .replace(/([{,]\s*)([A-Za-z_$][\w$]*)\s*:/g, '$1"$2":')
      .replace(/'([^'\\]*(?:\\.[^'\\]*)*)'/g, (_m, inner: string) => JSON.stringify(inner))
      .replace(/,(\s*[}\]])/g, '$1'),
  ]
  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate) as T
    } catch {
      /* try the next repair */
    }
  }
  return null
}

function literalAfter(html: string, pattern: RegExp): string | null {
  const match = pattern.exec(html)
  if (!match) return null
  const start = html.indexOf(match[0])
  const brace = html.slice(start).search(/[{[]/)
  if (brace < 0) return null
  return balancedLiteral(html, start + brace)
}

const num = (value: unknown, fallback: number) => {
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

/** Read whatever structure the file is willing to admit to. */
export function parseGeneratedHtml(html: string): ImportedPiece | null {
  const text = String(html || '')
  if (!text.trim()) return null

  const manifestLiteral = literalAfter(text, /__cupricSourceManifest\s*=\s*/)
  const manifest = manifestLiteral
    ? looseParse<{ sequence?: unknown[]; sources?: unknown[]; renderSpec?: Record<string, unknown> }>(manifestLiteral)
    : null

  const spec = manifest?.renderSpec ?? {}
  const fpsRaw = num((spec as { fps?: unknown }).fps, 0)
  const fps = fpsRaw === 24 || fpsRaw === 30 || fpsRaw === 60 ? (fpsRaw as 24 | 30 | 60) : null
  const sizeRaw = (spec as { size?: unknown }).size
  const size = Array.isArray(sizeRaw) && sizeRaw.length >= 2 ? ([num(sizeRaw[0], 1920), num(sizeRaw[1], 1080)] as [number, number]) : null

  const sources = Array.isArray(manifest?.sources)
    ? manifest.sources.map((s) => (typeof s === 'string' ? s : String((s as { name?: string })?.name ?? ''))).filter(Boolean)
    : []

  const fromSequence = normaliseScenes(manifest?.sequence)
  if (fromSequence.length) {
    return { scenes: fromSequence, durationSec: endOf(fromSequence), fps, size, sources, via: 'manifest' }
  }

  // No usable manifest sequence: most generated files still keep a scenes
  // array, because the prompt asks for one.
  const scenesLiteral = literalAfter(text, /(?:const|let|var)\s+scenes\s*=\s*/)
  const fromArray = normaliseScenes(scenesLiteral ? looseParse<unknown[]>(scenesLiteral) : null)
  if (fromArray.length) {
    return { scenes: fromArray, durationSec: endOf(fromArray), fps, size, sources, via: 'scene-array' }
  }

  // Last resort: the words on screen, in document order, split evenly. Worse
  // timings, but the copy is the part that is painful to retype.
  const headings = [...text.matchAll(/<(h1|h2|h3|p|figcaption)[^>]*>([\s\S]*?)<\/\1>/gi)]
    .map((m) => m[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim())
    .filter((line) => line.length > 1 && line.length < 200)
  if (!headings.length) return null

  const total = num((spec as { durationSec?: unknown }).durationSec, Math.max(6, headings.length * 2.5))
  const each = total / headings.length
  return {
    scenes: headings.map((copy, i) => ({ from: i * each, to: (i + 1) * each, copy })),
    durationSec: total,
    fps,
    size,
    sources,
    via: 'headings',
  }
}

function endOf(scenes: ImportedScene[]) {
  return scenes.reduce((max, s) => Math.max(max, s.to), 0)
}

/** Accept the several shapes a scene list turns up in, reject the rest. */
function normaliseScenes(input: unknown): ImportedScene[] {
  if (!Array.isArray(input)) return []
  const out: ImportedScene[] = []
  let cursor = 0
  for (const raw of input) {
    // ["COPY", durationSec, "anim"] — the shape the SaaS blueprints use.
    if (Array.isArray(raw)) {
      const copy = String(raw[0] ?? '').trim()
      const duration = num(raw[1], 3)
      if (!copy) continue
      out.push({ from: cursor, to: cursor + duration, copy, motion: typeof raw[2] === 'string' ? raw[2] : undefined })
      cursor += duration
      continue
    }
    if (!raw || typeof raw !== 'object') continue
    const scene = raw as Record<string, unknown>
    const copy = String(scene.copy ?? scene.text ?? scene.title ?? '').trim()
    if (!copy) continue
    const from = num(scene.from ?? scene.start ?? scene.at, cursor)
    const explicitTo = scene.to ?? scene.end
    const to = explicitTo !== undefined ? num(explicitTo, from + 3) : from + num(scene.durationSec ?? scene.duration, 3)
    if (!(to > from)) continue
    out.push({
      from,
      to,
      copy,
      motion: typeof scene.motion === 'string' ? scene.motion : undefined,
      type: typeof scene.type === 'string' ? scene.type : undefined,
    })
    cursor = to
  }
  return out.sort((a, b) => a.from - b.from)
}

/** Map the model's prose motion description onto an animation we actually have. */
export function animForMotion(motion: string | undefined, index: number): StudioTextAnim {
  const text = (motion ?? '').toLowerCase()
  if (/type|typewriter|keyed/.test(text)) return 'typewriter'
  if (/word|per-word|stagger/.test(text)) return 'word-reveal'
  if (/pop|punch|scale|spring/.test(text)) return 'pop'
  if (/wave|liquid|fluid/.test(text)) return 'liquid-wave'
  if (/shimmer|shine|gloss/.test(text)) return 'shimmer'
  if (/glass|frost|blur/.test(text)) return 'glass-rise'
  if (/slide|push|swipe/.test(text)) return 'slide-left'
  if (/up|rise|fade/.test(text)) return 'fade-up'
  // No description: alternate between two safe entrances so consecutive
  // scenes do not all move identically.
  return index % 2 === 0 ? 'fade-up' : 'pop'
}

/** Headline first, then progressively smaller — the hierarchy a viewer expects. */
function sizeFor(copy: string, index: number): number {
  const words = copy.trim().split(/\s+/).length
  if (index === 0 && words <= 6) return 11
  if (words <= 4) return 10
  if (words <= 10) return 7.5
  return 6
}

/**
 * Build editable clips from a parsed piece.
 *
 * The clips are the real thing — the same text clips the Studio makes when you
 * press Text — so everything already built works on them: keyframes, grades,
 * masks, rotation, the checks panel. Nothing about them remembers they came
 * from a model.
 */
export function rundownToStudioClips(rundown: SceneRundown, doc: StudioDoc, label = 'Generated'): StudioClip[] {
  return piecesToStudioClips({
    scenes: rundown.scenes.map((scene) => ({
      from: scene.from,
      to: scene.to,
      copy: scene.copy,
      motion: scene.motion,
      type: scene.type,
    })),
    durationSec: rundown.durationSec,
    fps: rundown.fps === 24 || rundown.fps === 30 || rundown.fps === 60 ? rundown.fps : null,
    size: rundown.size,
    sources: ['automation-rundown'],
    via: 'manifest',
  }, doc, label)
}

export function piecesToStudioClips(piece: ImportedPiece, doc: StudioDoc, label = 'Generated'): StudioClip[] {
  const track = Math.min(doc.trackCount - 1, 1)
  const base = nextFreeStart(doc, track, 0, Math.max(1, piece.durationSec))
  const clips: StudioClip[] = []

  piece.scenes.forEach((scene, index) => {
    const template = defaultTextClip(0, track)
    const transitionIn: StudioTransition = index === 0 ? 'fade' : 'liquid-dissolve'
    clips.push({
      ...template,
      id: uid(),
      name: `${label} · scene ${index + 1}`,
      startSec: Math.round((base + scene.from) * 100) / 100,
      durationSec: Math.max(0.4, Math.round((scene.to - scene.from) * 100) / 100),
      text: scene.copy,
      fontSizePct: sizeFor(scene.copy, index),
      anim: animForMotion(scene.motion, index),
      transitionIn,
      transitionOut: 'fade',
    })
  })

  return clips
}
