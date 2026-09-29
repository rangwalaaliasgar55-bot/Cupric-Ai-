/**
 * Cupric design engine — the layer that turns a generated plan into a piece
 * that *looks designed*.
 *
 * Why this exists: `planToDoc` produces an honest but flat build — one chrome
 * backdrop for the whole film, every headline in Inter, the same size everywhere,
 * no accents, no safe-area logic, and no link at all to the font suggestions
 * Studio already had. The output was editable, and boring.
 *
 * This module re-designs a built scene set with the rules a motion designer
 * actually uses, and it is pure + deterministic (same inputs → same clips):
 *
 *   1. a different stage per scene (gradient/pattern/atmosphere), so a run of
 *      scenes reads as a film rather than one card repeated;
 *   2. a typographic system taken from the very suggestions the Studio shows
 *      (`fontStyles.suggestTextLooks`) — headline, emphasis face, ink colours
 *      and animation come from one look, so the suggestions visibly drive the
 *      output instead of living in a side panel;
 *   3. contrast-checked ink: every colour is measured against the stage it sits
 *      on and lightened until it clears 4.5:1, so nothing is unreadable;
 *   4. hierarchy + safe areas per aspect (eyebrow → headline → support), with
 *      three layout modes alternating across scenes;
 *   5. native accents (rule, underline, pill, glass plate) drawn as real
 *      editable clips, so finishing a scene is dragging a clip, not redrawing;
 *   6. per-scene transitions from the direction, and legibility scrims on the
 *      busy stages.
 */
import type { StudioClip, StudioDoc, StudioShapeClip, StudioTextClip, StudioTransition } from '../../types/project'
import { contrast, hasItalic, mix, moodOf, paletteFrom, suggestTextLooks, type Mood } from './fontStyles'
import { VIDEO_FONT_FAMILIES } from './videoFonts'

/** The subset of a production brief this engine needs (kept loose on purpose). */
export type DesignBrief = {
  brandColors?: string[]
  tone?: 'high' | 'medium' | 'calm'
  aspect?: '16:9' | '9:16' | '1:1' | '4:5'
  referenceStyle?: string
  language?: string
}

export type DesignDirectionId = 'typography' | 'composition' | 'atmosphere'

export type DesignDirection = {
  id: DesignDirectionId
  name: string
  why: string
  /** Look indexes (into the 9 suggestions) this direction prefers. */
  lookOrder: number[]
  /** Stage ids in the order scenes take them. */
  stages: string[]
  transitions: StudioTransition[]
  align: 'left' | 'center' | 'alternate'
  /** Headline glow for punchy directions. */
  glow: number
  /** Accent shape kit for scene rules. */
  accent: 'rule' | 'underline' | 'pill' | 'bar'
}

/**
 * Direction A leads with type, B with geometry, C with atmosphere. They are the
 * three candidates the local battle scores — genuinely different pieces, not
 * three colour swaps of one layout.
 */
export const DESIGN_DIRECTIONS: DesignDirection[] = [
  {
    id: 'typography',
    name: 'Typography-led',
    why: 'Scale contrast and tight tracking carry the piece; the type *is* the visual.',
    lookOrder: [0, 3, 6, 1],
    stages: ['void', 'lime-void', 'warm-paper', 'void', 'grid-haze'],
    transitions: ['fade', 'push-up', 'wipe-left'],
    align: 'center',
    glow: 0.22,
    accent: 'underline',
  },
  {
    id: 'composition',
    name: 'Composition-led',
    why: 'Geometry, rules and panels build the frame; type sits in a grid.',
    lookOrder: [1, 4, 7, 2],
    stages: ['grid-haze', 'glass-stage', 'spotlight', 'dot-field', 'studio-white'],
    transitions: ['wipe-left', 'push-up', 'iris'],
    align: 'left',
    glow: 0.12,
    accent: 'rule',
  },
  {
    id: 'atmosphere',
    name: 'Atmosphere-led',
    why: 'Gradient fields and depth do the emotional work under a restrained type layer.',
    lookOrder: [2, 5, 8, 0],
    stages: ['aurora', 'mesh-lagoon', 'violet-dusk', 'blue-orbit', 'mesh-ember'],
    transitions: ['liquid-dissolve', 'blur', 'fade'],
    align: 'alternate',
    glow: 0.3,
    accent: 'bar',
  },
]

export const directionById = (id: DesignDirectionId): DesignDirection =>
  DESIGN_DIRECTIONS.find((d) => d.id === id) ?? DESIGN_DIRECTIONS[0]

/** Base ink of each shipped stage — used to contrast-check the type on it. */
const STAGE_BASE: Record<string, { base: string; busy: boolean }> = {
  void: { base: '#0B0B10', busy: false },
  'lime-void': { base: '#0B0B10', busy: false },
  'grid-haze': { base: '#0B0B10', busy: true },
  'dot-field': { base: '#0B0B10', busy: true },
  'blue-orbit': { base: '#0B0B10', busy: true },
  'warm-paper': { base: '#F4EFE4', busy: true },
  'studio-white': { base: '#F7F6F2', busy: true },
  aurora: { base: '#0B0B10', busy: true },
  spotlight: { base: '#0B0B10', busy: true },
  'lime-wash': { base: '#0B0B10', busy: false },
  'mesh-lagoon': { base: '#0B0B10', busy: true },
  'mesh-ember': { base: '#101014', busy: true },
  'liquid-chrome': { base: '#0B0B10', busy: true },
  'liquid-lime': { base: '#0B0B10', busy: true },
  'noise-veil': { base: '#0B0B10', busy: true },
  'glass-stage': { base: '#0B0B10', busy: true },
  'violet-dusk': { base: '#0B0B10', busy: true },
}

export const stageBase = (id: string) => STAGE_BASE[id] ?? { base: '#0B0B10', busy: true }

const isDark = (hex: string) => contrast(hex, '#FFFFFF') < 2.6

/** Lighten (or darken) `color` until it clears `ratio` against `on`. */
export function readableOn(color: string, on: string, ratio = 4.5): string {
  let out = color
  for (let i = 0; i < 10 && contrast(out, on) < ratio; i++) {
    out = mix(out, isDark(on) ? '#FFFFFF' : '#0B0B10', 0.18)
  }
  return contrast(out, on) >= ratio ? out : isDark(on) ? '#FFFFFF' : '#0B0B10'
}

/** 12% top / 18% bottom on vertical, gentler on wide frames (platform chrome). */
export function safeArea(aspect: DesignBrief['aspect']): { top: number; bottom: number; left: number } {
  if (aspect === '9:16') return { top: 0.13, bottom: 0.2, left: 0.08 }
  if (aspect === '4:5') return { top: 0.1, bottom: 0.14, left: 0.08 }
  if (aspect === '1:1') return { top: 0.09, bottom: 0.12, left: 0.09 }
  return { top: 0.08, bottom: 0.12, left: 0.07 }
}

/** Mood string → the direction's stages that fit it best (never empty). */
function stagesFor(direction: DesignDirection, mood: Mood, brief: DesignBrief): string[] {
  const bright = mood === 'friendly' || mood === 'education' || mood === 'luxury'
  const ranked = [...direction.stages].sort((a, b) => score(b) - score(a))
  function score(id: string) {
    let s = 0
    const dark = isDark(stageBase(id).base)
    if (bright ? !dark : dark) s += 2
    const tone = brief.tone ?? 'medium'
    if (tone === 'high' && (id === 'spotlight' || id === 'mesh-ember' || id === 'lime-void')) s += 1
    if (tone === 'calm' && (id === 'aurora' || id === 'mesh-lagoon' || id === 'violet-dusk')) s += 1
    if (stageBase(id).busy) s += 0.5
    return s
  }
  return [...new Set([...ranked, ...direction.stages])]
}

export type DesignScene = {
  index: number
  role: 'hook' | 'beat' | 'proof' | 'cta'
  from: number
  to: number
  headline: string
  stage: string
  layout: 'stack' | 'lower' | 'split'
  look: string
  headlineFont: string
  emphasisFont: string
  ink: string
  accent: string
  transitionIn: StudioTransition
  textClipIds: string[]
  accentClipId: string | null
  scrim: boolean
}

export type DesignReport = {
  direction: DesignDirection
  scenes: DesignScene[]
  notes: string[]
  /** Deterministic self-assessment (0–100) used by the candidate battle. */
  score: number
}

export type DesignOptions = {
  direction?: DesignDirection
  makeId: (n: number) => string
  /** Bump to re-roll stage/tint choices without changing the model (Shuffle). */
  seed?: number
}

const r2 = (n: number) => Math.round(n * 100) / 100
const isTextClip = (c: StudioClip): c is StudioTextClip => c.kind === 'text'
const isBackgroundClip = (c: StudioClip): c is Extract<StudioClip, { kind: 'background' }> => c.kind === 'background'

/** Scene boundaries: text clusters separated by a real gap (or a backdrop change). */
export function sceneWindows(clips: StudioClip[], gapSec = 0.4): Array<{ from: number; to: number; clips: StudioClip[]; text: StudioTextClip[] }> {
  const texts = clips.filter(isTextClip).slice().sort((a, b) => a.startSec - b.startSec)
  const windows: Array<{ from: number; to: number; clips: StudioClip[]; text: StudioTextClip[] }> = []
  for (const clip of texts) {
    const last = windows[windows.length - 1]
    const end = clip.startSec + clip.durationSec
    if (last && clip.startSec <= last.to + gapSec) {
      last.to = Math.max(last.to, end)
      last.text.push(clip)
    } else {
      windows.push({ from: clip.startSec, to: end, clips: [], text: [clip] })
    }
  }
  // Anything that is not text (media, accents) joins the window it overlaps.
  for (const w of windows) w.clips = clips.filter((c) => c.startSec < w.to - 0.01 && c.startSec + c.durationSec > w.from + 0.01)
  return windows
}

/** Which scene is this — from its words and position in the film. */
function roleOf(index: number, total: number, text: string): DesignScene['role'] {
  if (index === 0) return 'hook'
  if (index === total - 1) return 'cta'
  if (/[%$€£]|\b\d{2,}\b|\b\d+(\.\d+)?\s?(x|k|m|%)\b/i.test(text)) return 'proof'
  return 'beat'
}

const isEyebrow = (clip: StudioTextClip, headlineSize: number) =>
  clip.fontSizePct <= headlineSize * 0.32 || /JetBrains Mono/i.test(clip.fontFamily ?? '')

/**
 * Re-design the clips `clipIds` (the ones this run built) inside `doc`.
 * Nothing outside `clipIds` is touched, so a user's own clips are never
 * restyled. Returns the new doc plus the report the review screen shows.
 */
export function designScenes(doc: StudioDoc, brief: DesignBrief, clipIds: string[], opts: DesignOptions): { doc: StudioDoc; report: DesignReport } {
  const direction = opts.direction ?? DESIGN_DIRECTIONS[0]
  const seed = Math.max(0, Math.round(opts.seed ?? 0))
  const mine = doc.clips.filter((c) => clipIds.includes(c.id))
  const windows = sceneWindows(mine)
  const notes: string[] = []
  if (!windows.length) return { doc, report: { direction, scenes: [], notes: ['No text scenes to design.'], score: 0 } }

  const mood = moodOf(windows.map((w) => w.text.map((t) => t.text).join(' ')).join(' '))
  const { base: brandBase, between } = paletteFrom(brief.brandColors ?? [])
  const accentPool = [...brandBase, ...between]
  const stages = stagesFor(direction, mood, brief)
  const safe = safeArea(brief.aspect)
  const bundled = (f: string) => VIDEO_FONT_FAMILIES.has(f)
  const allLooks = suggestTextLooks(windows.map((w) => w.text.map((t) => t.text).join(' ')).join(' '), {
    brandColors: brief.brandColors,
    available: bundled,
    includeMissing: false,
  })

  const patches = new Map<string, Partial<StudioClip>>()
  const added: StudioClip[] = []
  const scenes: DesignScene[] = []
  const replacedBackgrounds = new Set<string>()
  // Where a fresh accent track goes: above everything this run built.
  const accentTrack = Math.min(23, Math.max(...mine.map((c) => c.track)) + 1)

  windows.forEach((win, i) => {
    const role = roleOf(i, windows.length, win.text.map((t) => t.text).join(' '))
    const stageId = stages[(i + seed) % stages.length]
    const stage = stageBase(stageId)
    const headline = [...win.text].sort((a, b) => b.fontSizePct - a.fontSizePct)[0]
    if (!headline) return
    const look = allLooks.length ? allLooks[(direction.lookOrder[i % direction.lookOrder.length] + seed) % allLooks.length] : null
    const headlineFont = look && bundled(look.patch.fontFamily) ? look.patch.fontFamily : headline.fontFamily ?? 'Inter Variable'
    const emphasisFont = look && bundled(look.patch.emphasisFont) ? look.patch.emphasisFont : 'Instrument Serif'
    const accent = readableOn(accentPool[(i + seed) % accentPool.length] ?? '#C8F542', stage.base, 3)
    const lookInk = look?.patch.color && contrast(look.patch.color, stage.base) >= 4.5 ? look.patch.color : '#F4F1EA'
    const ink = readableOn(lookInk, stage.base, 4.5)
    const support = readableOn(mix(ink, stage.base, 0.28), stage.base, 4.5)
    const layout: DesignScene['layout'] = role === 'cta' ? 'lower' : direction.align === 'left' ? (i % 3 === 1 ? 'split' : 'stack') : i % 3 === 1 ? 'lower' : i % 3 === 2 ? 'split' : 'stack'
    const align: StudioTextClip['align'] = direction.align === 'left' ? 'left' : direction.align === 'alternate' && i % 2 ? 'right' : 'center'

    // — 1. stage: one backdrop per scene, cross-faded, at the run's own track.
    const bgY = 0
    const bgClip = mine.find(isBackgroundClip)
    if (bgClip) {
      if (i === 0) {
        patches.set(bgClip.id, { backgroundId: stageId, startSec: r2(win.from), durationSec: r2(Math.max(0.3, win.to - win.from)), transitionIn: 'fade', transitionOut: 'none', name: `Stage · ${stageId}` })
      } else {
        const id = opts.makeId(1000 + i)
        added.push({
          id, kind: 'background', backgroundId: stageId, track: bgClip.track ?? bgY,
          startSec: r2(win.from), durationSec: r2(Math.max(0.3, win.to - win.from)), name: `Stage · ${stageId}`,
          transitionIn: direction.transitions[(i + seed) % direction.transitions.length], transitionOut: 'none', opacity: 1,
        })
      }
      replacedBackgrounds.add(bgClip.id)
    } else if (i === 0) {
      added.push({
        id: opts.makeId(1000), kind: 'background', backgroundId: stageId, track: bgY,
        startSec: r2(win.from), durationSec: r2(Math.max(0.3, win.to - win.from)), name: `Stage · ${stageId}`,
        transitionIn: 'fade', transitionOut: 'none', opacity: 1,
      })
    }

    // — 2. type: hierarchy, safe areas, contrast-checked ink, the look's motion.
    const sizes = win.text.map((t) => t.fontSizePct).sort((a, b) => b - a)
    const headlineSize = sizes[0] ?? 8
    const anchorY = layout === 'lower' ? 1 - safe.bottom - 0.12 : layout === 'split' ? 0.36 + safe.top * 0.4 : 0.46
    const words = (headline.text ?? '').replace(/[*={}^]/g, '').trim().split(/\s+/).filter(Boolean).length
    win.text.forEach((clip, k) => {
      const eyebrow = isEyebrow(clip, headlineSize)
      const isHeadline = clip.id === headline.id
      const scale = isHeadline ? (words <= 3 ? 1.16 : words <= 6 ? 1 : 0.86) : eyebrow ? 1 : 0.62
      const y = isHeadline ? anchorY : eyebrow ? safe.top + 0.03 : Math.min(1 - safe.bottom, anchorY + 0.14 + k * 0.045)
      patches.set(clip.id, {
        fontFamily: eyebrow ? 'JetBrains Mono Variable' : isHeadline ? headlineFont : clip.fontFamily && bundled(clip.fontFamily) ? clip.fontFamily : headlineFont,
        color: eyebrow ? support : isHeadline ? ink : ink,
        fontSizePct: r2(Math.max(1.2, Math.min(22, headlineSize * scale))),
        x: align === 'left' ? safe.left + 0.06 : align === 'right' ? 1 - safe.left - 0.06 : 0.5,
        y: r2(Math.max(safe.top, Math.min(1 - safe.bottom, y))),
        align,
        anim: isHeadline && look ? look.patch.anim : eyebrow ? 'typewriter' : (clip.anim === 'none' ? 'fade-up' : clip.anim),
        emphasisFont,
        emphasisItalic: hasItalic(emphasisFont),
        emphasisColor: look?.patch.emphasisColor && contrast(look.patch.emphasisColor, stage.base) >= 3 ? look.patch.emphasisColor : accent,
        boxColor: look?.patch.boxColor ?? accent,
        accentColor: accent,
        textGlow: isHeadline ? direction.glow : clip.textGlow,
        legibility: 'auto',
        scrimStrength: stage.busy ? (isHeadline ? 0.42 : 0.5) : 0.3,
        name: `${role === 'hook' ? 'Hook' : role === 'cta' ? 'CTA' : `Scene ${i + 1}`} · ${clip.name?.slice(0, 28) ?? 'text'}`,
      } as Partial<StudioTextClip>)
    })

    // — 3. accents: a drawn rule/pill that belongs to the scene (still editable).
    let accentClipId: string | null = null
    if (role !== 'proof' || win.text.length === 1) {
      const shape = direction.accent === 'pill' ? 'pill' : direction.accent === 'bar' ? 'rounded-rect' : direction.accent === 'underline' ? 'underline' : 'line'
      const accentClip: StudioShapeClip = {
        id: opts.makeId(2000 + i),
        kind: 'shape',
        shape,
        x: align === 'left' ? safe.left + 0.22 : align === 'right' ? 1 - safe.left - 0.22 : 0.5,
        y: r2(Math.max(safe.top + 0.02, Math.min(1 - safe.bottom - 0.02, anchorY - (shape === 'pill' ? 0.11 : 0.085)))),
        w: shape === 'pill' ? 0.16 : shape === 'rounded-rect' ? 0.3 : align === 'center' ? 0.26 : 0.34,
        aspect: shape === 'pill' ? 0.3 : shape === 'rounded-rect' ? 0.16 : 0.04,
        fill: shape === 'line' || shape === 'underline' ? null : accent,
        stroke: shape === 'line' || shape === 'underline' ? accent : null,
        strokeWidth: 10,
        anim: 'draw-on',
        label: shape === 'pill' && role === 'cta' ? 'Get started' : undefined,
        labelColor: ink,
        track: accentTrack,
        startSec: r2(win.from + 0.08),
        durationSec: r2(Math.max(0.3, win.to - win.from - 0.16)),
        name: shape === 'pill' ? 'CTA pill' : direction.accent === 'underline' ? 'Underline' : 'Accent rule',
        transitionIn: 'none',
        transitionOut: 'fade',
        opacity: 1,
      }
      added.push(accentClip)
      accentClipId = accentClip.id
    }

    scenes.push({
      index: i,
      role,
      from: r2(win.from),
      to: r2(win.to),
      headline: (headline.text ?? '').replace(/[*={}^]/g, ''),
      stage: stageId,
      layout,
      look: look?.name ?? 'House look',
      headlineFont,
      emphasisFont,
      ink,
      accent,
      transitionIn: i === 0 ? 'fade' : direction.transitions[(i + seed) % direction.transitions.length],
      textClipIds: win.text.map((c) => c.id),
      accentClipId,
      scrim: stage.busy,
    })
    if (i === 0) notes.push(`${direction.name}: ${windows.length} scene(s) across ${new Set(scenes.map((s) => s.stage)).size} stage(s), headline ${headlineFont}, accents in ${accent}.`)
  })

  // Background clip from planToDoc covered the whole film — the per-scene stages
  // replace it, so it must not paint over them.
  if (replacedBackgrounds.size === 1 && windows.length > 1) {
    for (const id of replacedBackgrounds) if (!patches.has(id)) patches.set(id, { hidden: true })
  }

  const designed: StudioDoc = {
    ...doc,
    backgroundId: doc.backgroundId || 'void',
    clips: [
      ...doc.clips.map((c) => {
        const patch = patches.get(c.id)
        return patch ? ({ ...c, ...patch } as StudioClip) : c
      }),
      ...added,
    ],
    trackCount: Math.max(doc.trackCount, accentTrack + 1),
  }

  const report: DesignReport = { direction, scenes, notes, score: designScore(designed, scenes) }
  return { doc: designed, report }
}

/**
 * Run every direction on the *same* edit and keep the best one.
 *
 * This is the battle the autonomous run and the guided planner share: three
 * genuinely different designs of one plan, scored by the engine's own rules,
 * with the winner committed. The losing directions are returned so the UI can
 * say what they were and why they lost.
 */
export function designAll(
  doc: StudioDoc,
  brief: DesignBrief,
  clipIds: string[],
  makeId: (n: number) => string,
  opts: { only?: DesignDirectionId; avoid?: DesignDirectionId[] } = {},
): {
  doc: StudioDoc
  report: DesignReport
  battle: Array<{ id: DesignDirectionId; name: string; score: number; reasons: string[] }>
  /** Directions the caller asked to skip because this footage rejected them (creative log). */
  skipped: Array<{ id: DesignDirectionId; name: string }>
  /** Set when the skip list would have emptied the battle and was ignored. */
  skippedNote?: string
} {
  let best: { doc: StudioDoc; report: DesignReport } | null = null
  const battle: Array<{ id: DesignDirectionId; name: string; score: number; reasons: string[] }> = []
  const pool0 = opts.only ? DESIGN_DIRECTIONS.filter((d) => d.id === opts.only) : DESIGN_DIRECTIONS
  // A rejected direction is not a direction to run again — that is the whole point of keeping
  // the log. An explicit `only` wins: the user asked for that one, so it runs.
  const avoid = opts.only ? [] : [...new Set(opts.avoid ?? [])]
  const kept = pool0.filter((d) => !avoid.includes(d.id))
  const skipped = pool0.filter((d) => avoid.includes(d.id)).map((d) => ({ id: d.id, name: d.name }))
  const pool = kept.length ? kept : pool0
  const skippedNote = kept.length || !skipped.length
    ? undefined
    : `Every direction has been rejected on this footage, so the battle ran all ${pool0.length} again — clear a rejection in the history below to stop that.`
  for (const direction of pool) {
    const result = designScenes(doc, brief, clipIds, { direction, makeId, seed: direction.lookOrder[0] })
    battle.push({
      id: direction.id,
      name: direction.name,
      score: result.report.score,
      reasons: [
        direction.why,
        `${result.report.scenes.length} scenes · ${new Set(result.report.scenes.map((s) => s.stage)).size} stage(s)`,
      ],
    })
    if (!best || result.report.score > best.report.score) best = { doc: result.doc, report: result.report }
  }
  battle.sort((a, b) => b.score - a.score)
  // Nothing is reported as skipped when the skip list was ignored — the note explains why the
  // battle ran everything instead.
  return {
    doc: best!.doc,
    report: best!.report,
    battle,
    skipped: kept.length ? skipped : [],
    ...(skippedNote ? { skippedNote } : {}),
  }
}

/**
 * Deterministic design self-check: does this edit hold together?
 *
 * Measured, not claimed — the same idea as the desktop render gate. The
 * candidate battle ranks directions with this, so the winner is chosen by the
 * design that holds up, not by array order.
 */
export function designScore(doc: StudioDoc, scenes: DesignScene[]): number {
  if (!scenes.length) return 0
  const text = doc.clips.filter(isTextClip)
  const stages = new Set(scenes.map((s) => s.stage))
  const fonts = new Set(text.map((c) => c.fontFamily))
  let score = 55
  // Variety across a film.
  score += Math.min(12, Math.max(0, stages.size - 1) * 4)
  score += Math.min(6, Math.max(0, fonts.size - 1) * 2)
  // Every scene needs a readable headline and an accent.
  score += scenes.filter((s) => contrast(s.ink, stageBase(s.stage).base) >= 4.5).length * 2
  score += scenes.filter((s) => s.accentClipId).length * 2
  // Hierarchy: at least two distinct sizes in the piece.
  const sizes = new Set(text.map((c) => Math.round(c.fontSizePct)))
  score += sizes.size >= 3 ? 6 : sizes.size === 2 ? 3 : 0
  // Safe areas respected, nothing pushed off the frame.
  const inside = text.every((c) => c.y >= 0.04 && c.y <= 0.96)
  score += inside ? 6 : -8
  // Scrims only where the stage is busy.
  score -= Math.max(0, text.filter((c) => c.legibility === 'on' && !c.scrimStrength).length)
  // Every clip has a duration the renderer can honour.
  score -= doc.clips.filter((c) => c.durationSec < 0.2).length * 3
  return Math.max(0, Math.min(100, Math.round(score)))
}
