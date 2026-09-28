/**
 * Kinetic brand film: the production recipe learned from the six reference
 * films in PR #20 (cupric-ai-brand-film*.zip, cupric-ai-cinematic-brand-film*.zip).
 *
 * Every one of them shares the same grammar, measured with sourceFilm.ts:
 *   - 40 s, 14 chapters: twelve 3 s beats, then two 2 s beats (statement, end card)
 *   - one or two huge uppercase lines per beat, ending in a full stop, typed on
 *     in two steps ("CREATE." → "WITH INTELLIGENCE.") at 0.3 s and ~50 % of the beat
 *   - a small mono HUD label per beat ("001 — GENESIS") in the top-left
 *   - a dark particle / 3D backdrop running under the whole film, lime accent
 *   - a scattered word cloud beat (THINK BUILD TEST CREATE ITERATE LAUNCH)
 *   - a split "HUMAN INTENT. / MACHINE SPEED." beat, a logo reveal, a tagline, an end card
 *
 * The recipe is structure and pacing only. Copy comes from the brief. A
 * must-keep line is used verbatim, and the brand and CTA come from the brief.
 * Neutral verbs fill the manifesto beats. Numeric claims (the "10×" beat) are
 * never invented: that beat stays a visible "[Add …]" placeholder.
 */
import type { PlanShot, ProductionBrief } from './types'

export const BRAND_FILM_SOURCE = {
  pr: 'https://github.com/rangwalaaliasgar55-bot/Cupric-Ai-/pull/20',
  files: ['cupric-ai-brand-film.zip', 'cupric-ai-brand-film (1).zip', 'cupric-ai-brand-film (2).zip', 'cupric-ai-brand-film (3).zip', 'cupric-ai-cinematic-brand-film.zip', 'cupric-ai-cinematic-brand-film (1).zip'],
}

type Beat = { name: string; share: number; label: string; layout: NonNullable<PlanShot['typeShot']>['layout']; lines: string[] | null; purpose: string; transition: string }

/** Shares are of the whole film (sum = 1): 12 × 3/40 + 2 × 2/40. */
export const BRAND_FILM_BEATS: Beat[] = [
  { name: 'Hook', share: 3 / 40, label: 'GENESIS', layout: 'stack', lines: ['CREATE.', 'WITH INTENT.'], purpose: 'One verb, then what makes it different', transition: 'none' },
  { name: 'Infinite directions', share: 3 / 40, label: 'BRANCHING', layout: 'stack', lines: ['ONE IDEA.', 'INFINITE DIRECTIONS.'], purpose: 'Scale of possibility from a single input', transition: 'blur' },
  { name: 'In motion', share: 3 / 40, label: 'LIVE NETWORK', layout: 'center', lines: ['IN MOTION.'], purpose: 'The product thinking, shown as movement', transition: 'zoom-in' },
  { name: 'Build faster', share: 3 / 40, label: 'ASSEMBLY', layout: 'stack', lines: ['BUILD', 'FASTER.'], purpose: 'Speed benefit', transition: 'push-up' },
  { name: 'Prompt to product', share: 3 / 40, label: 'PROMPT → PRODUCT', layout: 'split', lines: ['FROM PROMPT', 'TO PRODUCT.'], purpose: 'Input becomes output — the product UI moment', transition: 'wipe-left' },
  { name: 'Less repetition', share: 3 / 40, label: 'ITERATION', layout: 'split', lines: ['LESS REPETITION.', 'MORE CREATION.'], purpose: 'Contrast pair', transition: 'blur' },
  { name: 'Multiplier', share: 3 / 40, label: 'MULTIPLIER', layout: 'center', lines: null, purpose: 'Your one quantified claim — only if you can back it', transition: 'zoom-in' },
  { name: 'Ideas connect', share: 3 / 40, label: 'SYNTHESIS', layout: 'stack', lines: ['IDEAS', 'CONNECT.'], purpose: 'Things joining up', transition: 'iris' },
  { name: 'Make noise', share: 3 / 40, label: 'ITERATION LOOP', layout: 'cloud', lines: ['MAKE NOISE.'], purpose: 'Burst of action words', transition: 'blur' },
  { name: 'Human + machine', share: 3 / 40, label: 'COLLABORATION', layout: 'split', lines: ['HUMAN INTENT.', 'MACHINE SPEED.'], purpose: 'Partnership pair', transition: 'wipe-left' },
  { name: "What's next", share: 3 / 40, label: 'ECOSYSTEM', layout: 'stack', lines: ['BUILD', "WHAT'S NEXT."], purpose: 'Forward look', transition: 'push-up' },
  { name: 'Brand reveal', share: 3 / 40, label: 'IDENTITY', layout: 'logo', lines: null, purpose: 'Brand name alone, large', transition: 'zoom-in' },
  { name: 'Statement', share: 2 / 40, label: 'STATEMENT', layout: 'center', lines: null, purpose: 'The tagline', transition: 'fade' },
  { name: 'End card', share: 2 / 40, label: 'END', layout: 'end', lines: null, purpose: 'Brand + call to action', transition: 'fade' },
]

export const CLOUD_WORDS = ['THINK', 'BUILD', 'TEST', 'CREATE', 'ITERATE', 'LAUNCH']

/** Does this brief ask for a type-led brand film rather than a footage edit? */
export function isBrandFilmBrief(brief: Pick<ProductionBrief, 'title' | 'goal' | 'referenceStyle'>): boolean {
  return /brand ?film|manifesto|brand anthem|cinematic brand|kinetic typ|title sequence|launch film|sizzle|type[- ]led|motion ?graphics film/i.test(`${brief.title} ${brief.goal} ${brief.referenceStyle}`)
}

/** Brand name from the brief: "brand film for Acme", "Acme brand film", or the title. */
export function brandNameOf(brief: Pick<ProductionBrief, 'title' | 'goal'>): string | null {
  const txt = `${brief.goal} ${brief.title}`
  const m = txt.match(/\b(?:for|of|introducing|called)\s+([A-Z][\w.&-]*(?:\s+[A-Z][\w.&-]*){0,2})/) ?? txt.match(/\b([A-Z][\w.&-]*(?:\s+[A-Z][\w.&-]*){0,2})\s+(?:brand ?film|manifesto|launch)/i)
  const name = m?.[1]?.trim()
  return name && !/^(?:A|An|The|Our|My|Make|Create)$/i.test(name) ? name : null
}

const up = (s: string) => s.trim().toUpperCase()
const r2 = (n: number) => Math.round(n * 100) / 100

/** The 14 type-led shots, sized to the brief's duration. */
export function brandFilmShots(brief: ProductionBrief): PlanShot[] {
  const total = brief.durationSec > 0 ? brief.durationSec : 40
  const brand = brandNameOf(brief)
  const keep = [...brief.mustKeep]
  let t = 0
  return BRAND_FILM_BEATS.map((b, i) => {
    const len = r2(total * b.share)
    let lines = b.lines ? [...b.lines] : []
    let confidence: PlanShot['confidence'] = 'medium'
    if (b.name === 'Multiplier') { lines = keep.length ? [up(keep.shift()!)] : ['[Add your one backed number]']; confidence = lines[0].startsWith('[') ? 'low' : 'high' }
    else if (b.name === 'Brand reveal') { lines = brand ? [up(brand)] : ['[Add brand name]']; confidence = brand ? 'high' : 'low' }
    else if (b.name === 'Statement') { lines = keep.length ? [up(keep.shift()!)] : brief.goal ? [up(brief.goal.split(/[.!?]/)[0].split(/\s+/).slice(0, 6).join(' ')) + '.'] : ['[Add your tagline]']; confidence = keep.length || brief.goal ? 'medium' : 'low' }
    else if (b.name === 'End card') { lines = [brand ? up(brand) : '[Add brand name]', brief.cta ? up(brief.cta) : '[Add your call to action]']; confidence = brand && brief.cta ? 'high' : 'low' }
    else if (keep.length && i > 0 && i % 3 === 0) { lines = [up(keep.shift()!)]; confidence = 'high' }
    const shot: PlanShot = {
      id: `shot-${i + 1}`, beat: b.name, startSec: r2(t), durationSec: len, purpose: b.purpose,
      onScreenText: lines.join(' '), caption: brief.narration === 'none' ? '' : lines.join(' '),
      visual: 'Native kinetic typography over the film backdrop — no footage needed', mediaName: null,
      transitionIn: b.transition, motion: 'type-on, hold, cut on the beat', confidence,
      typeShot: { lines, label: `${String(i + 1).padStart(3, '0')} — ${b.label}`, layout: b.layout, ...(b.layout === 'cloud' ? { words: CLOUD_WORDS } : {}) },
    }
    t += len
    return shot
  })
}

/** Deterministic positions for the word-cloud beat (mulberry32, fixed seed). */
export function cloudLayout(n: number, seed = 20): Array<{ x: number; y: number }> {
  let a = seed >>> 0
  const rnd = () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
  return Array.from({ length: n }, (_, i) => ({ x: r2(i % 2 ? 0.62 + rnd() * 0.22 : 0.16 + rnd() * 0.22), y: r2(0.18 + (i / Math.max(1, n - 1)) * 0.64) }))
}
