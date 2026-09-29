/**
 * Autonomous run — local planning.
 *
 * The desktop pipeline reaches for a model first and falls back to a 12-second
 * placeholder rundown. In a browser there was no pipeline at all: the job was
 * marked "desktop-only" and stopped. This module is the missing brain that runs
 * anywhere: it turns the brief into a full production (intake → brief →
 * research → plan → rundown) using the same Opus catalogue the guided planner
 * uses, so an autonomous run and a hand-driven one produce the same *kind* of
 * editable, designed result.
 *
 * Pure and deterministic: `planLocally` is a function of its inputs (the
 * catalogue is data), which is what makes the runner re-runnable and the
 * candidate battle reproducible.
 */
import { buildBrief, buildPlan, research, searchResources, type OpusIndex, type ResourceCandidate } from '../production/engine'
import type { ProductionBrief, ProductionIntake, ProductionPlan, ProductionResearch } from '../production/types'
import { LOADER_PRESETS } from '../studio/loaders'
import { VIDEO_FONT_FAMILIES } from '../studio/videoFonts'
import type { SceneRundown } from '../../types/project'

export type AutonomyBrief = {
  /** The full brief text (the UI prefixes the target duration). */
  brief: string
  aspect: '16:9' | '9:16' | '1:1'
  fps: 30 | 60
  durationSec?: number
  quality: 'draft' | 'final'
  /**
   * File names of media already in the project. The planner assigns them to
   * shots, so the design uses real footage/photos instead of honest
   * placeholders. Empty means a type-led film.
   */
  mediaNames?: string[]
}

const ASPECT_WORD: Array<[RegExp, '16:9' | '9:16' | '1:1' | '4:5']> = [
  [/\b(vertical|reels?|shorts?|tiktok|portrait|9[:\s-]?16)\b/i, '9:16'],
  [/\b(square|1[:\s-]?1|feed post)\b/i, '1:1'],
  [/\b(4[:\s-]?5|portrait post)\b/i, '4:5'],
  [/\b(landscape|widescreen|youtube|16[:\s-]?9|horizontal)\b/i, '16:9'],
]

/** The spoken or typed brief → the structured intake the engine expects. */
export function intakeFromBrief(input: AutonomyBrief, brand?: { colors?: string[]; fonts?: string[] }, mediaNames?: string[]): ProductionIntake {
  const text = input.brief.replace(/\s+/g, ' ').trim()
  const lower = text.toLowerCase()
  const duration = input.durationSec
    ?? Number(/\b(\d{1,3})\s*(?:-|\s)?\s*(?:second|sec|s\b)/i.exec(lower)?.[1])
    ?? 30
  const aspect = ASPECT_WORD.find(([re]) => re.test(lower))?.[1] ?? input.aspect
  const audience = /\b(?:for|aimed at|targeting|audience:?)\s+([^.;,]{3,60})/i.exec(text)?.[1]?.trim() ?? ''
  const platform = /\b(?:on|for|post(?:ed)? to)\s+(instagram|youtube|tiktok|linkedin|facebook|x|twitter|reels|shorts)\b/i.exec(text)?.[1] ?? ''
  const cta = /\b(?:cta|call to action)\s*:?\s*([^.;]{2,48})/i.exec(text)?.[1]?.trim()
    ?? (/\b(sign up|book now|learn more|get started|try it|download|shop now|join|subscribe)\b/i.exec(text)?.[1] ?? '')
  const hindi = /[\u0900-\u097F]/.test(text)
  return {
    making: text.slice(0, 400) || 'A short product video',
    audience: audience || (/\b(founder|creator|team|business|student|marketer|developer|coach)s?\b/i.exec(lower)?.[1] ?? ''),
    platform,
    durationSec: Math.max(8, Math.min(180, Math.round(duration))),
    aspect,
    // Real media in the project wins over a guess from the words: the planner
    // binds these names to shots, and `planToDoc` reuses the actual clips.
    assets: (mediaNames ?? []).filter(Boolean).length
      ? (mediaNames ?? []).filter(Boolean).join('\n')
      : /\b(my footage|our footage|raw clips?|b-?roll|photos?|screenshots?)\b/i.test(lower) ? 'Use the media already in this project' : 'None — type-led',
    narration: /\b(voice ?over|narrat\w+|voiceover)\b/i.test(lower) ? 'voiceover' : /\bno (?:captions?|subtitles?)\b/i.test(lower) ? 'none' : 'captions',
    language: hindi ? (/[a-z]{3,}/i.test(text.replace(/[\u0900-\u097F]/g, '')) ? 'en+hi' : 'hi') : 'en',
    brandColors: (brand?.colors ?? []).join(', '),
    brandFonts: (brand?.fonts ?? []).filter((f) => VIDEO_FONT_FAMILIES.has(f)).join(', '),
    cta,
    referenceStyle: /\b(cinematic|documentary|kinetic|editorial|minimal|bold|energetic|calm|playful|luxury|premium)\b/i.exec(lower)?.[1] ?? '',
    mustKeep: '',
    avoid: '',
  }
}

export type Catalogue = { index: OpusIndex; resources: ResourceCandidate[] }

/** The bundled catalogue (Opus cases/skills + UI resources) — loaded once. */
let cataloguePromise: Promise<Catalogue> | null = null
export function loadCatalogue(): Promise<Catalogue> {
  if (!cataloguePromise) {
    cataloguePromise = Promise.all([
      import('../../../resources/opus55/data/index.json'),
      import('../../../resources/uselayouts/audit.json'),
    ]).then(([idx, audit]) => {
      const resources: ResourceCandidate[] = [
        ...LOADER_PRESETS.map((p) => ({ id: `transitions-dev-${p.id}`, name: p.name, pack: 'transitions-dev', description: p.description, tags: ['loader', 'loading', 'status'] })),
        ...((audit.default as { items: Array<{ id: string; name: string; description: string; category: string; tags: string[]; insertable: boolean }> }).items ?? [])
          .filter((i) => i.insertable)
          .map((i) => ({ id: i.id, name: i.name, pack: 'uselayouts', description: i.description, tags: [i.category, ...i.tags] })),
      ]
      return { index: idx.default as unknown as OpusIndex, resources }
    })
  }
  return cataloguePromise
}

export type LocalPlan = {
  intake: ProductionIntake
  brief: ProductionBrief
  research: ProductionResearch
  plan: ProductionPlan
  rundown: SceneRundown
}

/**
 * Brief → production. Deterministic; the model (if there is one) can only ever
 * *improve* on this, never gate it.
 */
export function planLocally(input: AutonomyBrief, catalogue: Catalogue, brand?: { colors?: string[]; fonts?: string[] }): LocalPlan {
  const intake = intakeFromBrief(input, brand, input.mediaNames)
  const brief = buildBrief(intake)
  const found = research(catalogue.index, brief, catalogue.resources)
  const plan = buildPlan(catalogue.index, brief, found)
  return { intake, brief, research: found, plan, rundown: rundownFromPlan(plan, brief, input.fps, intake.aspect ?? input.aspect) }
}

/**
 * The plan the *other* paths consume (the Autonomous screen, the desktop
 * pipeline, the Arena handoff): a flat scene list with timing, copy and motion.
 */
export function rundownFromPlan(plan: ProductionPlan, brief: ProductionBrief, fps: number, aspect: '16:9' | '9:16' | '1:1' | '4:5'): SceneRundown {
  const size: [number, number] = aspect === '9:16' ? [1080, 1920] : aspect === '1:1' ? [1080, 1080] : aspect === '4:5' ? [1080, 1350] : [1920, 1080]
  const scenes = plan.shots.map((shot, i) => ({
    id: shot.id || `scene-${i + 1}`,
    from: Math.round(shot.startSec * 10) / 10,
    to: Math.round((shot.startSec + shot.durationSec) * 10) / 10,
    type: shot.beat || (i === 0 ? 'hook' : i === plan.shots.length - 1 ? 'cta' : 'beat'),
    copy: (shot.typeShot ? shot.typeShot.lines.join(' ') : shot.onScreenText) || '',
    motion: `${shot.motion}${shot.transitionIn && shot.transitionIn !== 'none' ? `; in: ${shot.transitionIn}` : ''}`,
  }))
  const durationSec = scenes.length ? scenes[scenes.length - 1].to : Math.max(1, brief.durationSec)
  return {
    title: brief.title || 'Cupric AI run',
    durationSec,
    fps: fps === 60 ? 60 : 30,
    size,
    style: `${plan.skillId} · ${brief.tone} tone · ${brief.brandColors.slice(0, 3).join(' ')}`,
    scenes,
    arenaPrompt: arenaPromptOf(brief, scenes, size, fps),
  }
}

/**
 * The Arena build brief. Kept byte-compatible in spirit with the desktop's
 * `arenaPromptOf`: single self-contained HTML, deterministic `window.__seek(t)`,
 * no remote assets — but written from the *planned* scenes, so a hand-off to
 * Arena carries the same structure the local render uses.
 */
export function arenaPromptOf(brief: ProductionBrief, scenes: SceneRundown['scenes'], size: [number, number], fps: number): string {
  const lines = scenes.map((s, i) => `${i + 1}. ${s.from}s–${s.to}s · ${s.type} — “${s.copy}” (${s.motion})`).join('\n')
  return [
    'Build ONE self-contained index.html motion piece — inline CSS + JS, no network requests, no external fonts.',
    `Canvas: ${size[0]}×${size[1]} at ${fps}fps. Total length ${scenes[scenes.length - 1]?.to ?? brief.durationSec}s.`,
    'Hard constraints:',
    '- A single root element with id="scene".',
    '- Deterministic playback: define window.__seek(t) that renders the frame at t seconds with no randomness (seeded PRNG only) and no time-based animation state.',
    '- All type uses system/bundled sans or serif stacks; no @import, no fetch, no base64 media.',
    `- Structure exactly these ${scenes.length} scenes in order:`,
    lines,
    `Style: ${brief.tone} tone, ${brief.referenceStyle || 'clean editorial motion'}, colours ${brief.brandColors.join(' ') || '#0B0B10 #C8F542 #F4F1EA'}.`,
    'Set window.__cupricSourceManifest = { scenes: [...], renderSpec: { width, height, fps } }.',
    'Ship only the HTML.',
  ].join('\n')
}

/** Resource ids the plan leans on — shown in the run report. */
export function citedResources(found: ProductionResearch, catalogue: Catalogue, brief: ProductionBrief, limit = 3): string[] {
  const extra = searchResources(catalogue.resources, brief, limit)
  return [...new Set([...found.resources.map((r) => r.id), ...extra.map((r) => r.id)])]
}
