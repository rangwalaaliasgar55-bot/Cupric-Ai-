/**
 * Autonomous production engine: pure, DOM-free, deterministic.
 *
 * intake → brief (assumptions + missing info) → research (Opus index cases,
 * production skills, native resources, each with a reason) → plan (shots,
 * text, captions, motion, transitions, audio, export, confidence per
 * decision) → build (editable Studio clips, appended, undoable) → review
 * (actionable checks against the brief).
 *
 * Honesty rules the code enforces:
 *  - Copy comes only from the user's intake. Where a beat needs words the user
 *    didn't give, the text is a visible "[Add …]" placeholder with low
 *    confidence, never invented claims, numbers, quotes or testimonials.
 *  - Missing footage becomes a named placeholder clip that the review flags.
 *  - Cases are cited by id/author/URL and adapted structurally, never copied.
 */
import { BRAND_FILM_SOURCE, brandFilmShots, cloudLayout, isBrandFilmBrief } from './brandFilm'
import type { StudioClip, StudioDoc, StudioMediaClip, StudioTextClip, StudioTransition } from '../../types/project'
import type {
  CaseCitation, Confidence, PlanDecision, PlanShot, ProductionAspect, ProductionBrief, ProductionIntake, ProductionPlan,
  ProductionResearch, ProductionSession, ProductionStage, ResourcePick, ReviewCheck, SkillPick, BriefField,
} from './types'
import { PRODUCTION_STAGES } from './types'
import { directClip, motionPatch, type DirectionStyle } from '../studio/motionDirector'
import { snapCutsToBeats, timelineBeats } from '../studio/autoEdit'

/* ——— catalogue shapes (resources/opus55/data/index.json) ——— */
type Tagged = { tag: string; evidence: string }
export type OpusCase = {
  caseId: string; title: string; summary: string; categoryEn: string; sourceUrl: string; author: string | null; date: string | null
  promptPublished: boolean; durationSec: number | null; videoType: Tagged[]; techniques: Tagged[]; audio: Tagged[]; textPatterns: Tagged[]
  visualStyle: Tagged[]; industries: Tagged[]; similar: Array<{ caseId: string; score: number }>; skills: string[]
}
export type OpusSkill = {
  id: string; name: string; when: string; beats: Array<{ name: string; share: number; purpose: string }>; shotSec: [number, number]
  transitions: string[]; text: string; audio: string; requiredInputs: string[]; avoid: string[]; matchTags: string[]; energy: 'high' | 'medium' | 'calm'
  evidenceCaseIds: string[]; evidenceCount: number
}
export type OpusIndex = { total: number; cases: OpusCase[]; skills: OpusSkill[] }
export type ResourceCandidate = { id: string; name: string; pack: string; description: string; tags: string[] }

/* ——— intake ——————————————————————————————————————————————————— */

export const INTAKE_QUESTIONS: Array<{ key: keyof ProductionIntake; question: string; placeholder: string; required: boolean; why: string }> = [
  { key: 'making', question: 'What are you making?', placeholder: 'e.g. A 30-second launch video for our budgeting app', required: true, why: 'Chooses the production skill and story structure.' },
  { key: 'audience', question: 'Who is it for?', placeholder: 'e.g. Freelancers in India who invoice clients monthly', required: true, why: 'Sets tone, vocabulary and hook.' },
  { key: 'platform', question: 'Where will it be published?', placeholder: 'Instagram Reels, YouTube Shorts, TikTok, LinkedIn, X…', required: true, why: 'Decides safe zones, captions and default aspect.' },
  { key: 'durationSec', question: 'Desired duration (seconds)?', placeholder: '15, 30, 45, 60', required: false, why: 'Sets the number of beats and shot length.' },
  { key: 'aspect', question: 'Desired aspect ratio?', placeholder: '9:16', required: false, why: 'Frames the whole edit; reframing later loses quality.' },
  { key: 'assets', question: 'What footage and assets do you have?', placeholder: 'One per line: product-demo.mp4, logo.png, founder-interview.mov', required: true, why: 'Every shot is mapped to a real asset or flagged as missing.' },
  { key: 'narration', question: 'Voiceover, captions, both, or neither?', placeholder: 'captions', required: false, why: 'Voice-led and caption-first edits are timed differently.' },
  { key: 'language', question: 'English, Hindi, or both?', placeholder: 'en', required: false, why: 'Caption and voice language.' },
  { key: 'brandColors', question: 'Brand colours?', placeholder: '#C8F542, #0B0B10', required: false, why: 'Text and accent colours.' },
  { key: 'brandFonts', question: 'Brand fonts?', placeholder: 'Inter, Space Grotesk', required: false, why: 'Title and caption type.' },
  { key: 'cta', question: 'Call to action?', placeholder: 'Download free at example.com', required: false, why: 'The last beat. Without it, the close is a placeholder.' },
  { key: 'referenceStyle', question: 'Reference style?', placeholder: 'calm premium, fast-cut, cinematic, like Apple product films…', required: false, why: 'Picks pacing and motion.' },
  { key: 'mustKeep', question: 'Must-keep content?', placeholder: 'One per line: exact lines, shots or facts that must appear', required: false, why: 'Used verbatim, never paraphrased.' },
  { key: 'avoid', question: 'Content to avoid?', placeholder: 'e.g. no stock people, no music with lyrics', required: false, why: 'Hard constraints on the plan.' },
]

export function emptyIntake(): ProductionIntake {
  return { making: '', audience: '', platform: '', durationSec: null, aspect: null, assets: '', narration: null, language: null, brandColors: '', brandFonts: '', cta: '', referenceStyle: '', mustKeep: '', avoid: '' }
}

/** The high-value questions still unanswered (ask these before expensive work). */
export function openQuestions(intake: ProductionIntake): typeof INTAKE_QUESTIONS {
  return INTAKE_QUESTIONS.filter((q) => {
    const v = intake[q.key]
    return v === null || v === '' || (typeof v === 'number' && !Number.isFinite(v))
  })
}

export function emptySession(): ProductionSession {
  return { version: 1, stage: 'intake', intake: emptyIntake(), brief: null, research: null, plan: null, approved: false, replaceApproved: false, builtClipIds: [], review: null, checkpoints: [] }
}

/** Defensive load of a saved session (hand-edited or older saves never crash the UI). */
export function normaliseSession(raw: unknown): ProductionSession {
  const base = emptySession()
  if (!raw || typeof raw !== 'object') return base
  const r = raw as Partial<ProductionSession>
  const stage = PRODUCTION_STAGES.includes(r.stage as ProductionStage) ? (r.stage as ProductionStage) : 'intake'
  return {
    ...base,
    ...r,
    version: 1,
    stage,
    intake: { ...base.intake, ...(r.intake && typeof r.intake === 'object' ? r.intake : {}) },
    brief: r.brief && typeof r.brief === 'object' ? r.brief : null,
    research: r.research && typeof r.research === 'object' ? r.research : null,
    plan: r.plan && typeof r.plan === 'object' && Array.isArray(r.plan.shots) ? r.plan : null,
    approved: r.approved === true,
    replaceApproved: r.replaceApproved === true,
    builtClipIds: Array.isArray(r.builtClipIds) ? r.builtClipIds.filter((x) => typeof x === 'string') : [],
    review: Array.isArray(r.review) ? r.review : null,
    checkpoints: Array.isArray(r.checkpoints) ? r.checkpoints.slice(-50) : [],
  }
}

/* ——— brief ———————————————————————————————————————————————————— */

const lines = (s: string) => s.split(/\n|,(?![^(]*\))/).map((x) => x.trim()).filter(Boolean)
const lc = (s: string) => s.toLowerCase()

const PLATFORM_ASPECT: Array<[RegExp, ProductionAspect]> = [
  [/reel|tiktok|short|story|stories|snap/i, '9:16'],
  [/youtube(?! short)|website|landing|vimeo|presentation/i, '16:9'],
  [/linkedin|feed|instagram post|facebook/i, '4:5'],
  [/x\b|twitter/i, '16:9'],
]

export function detectTone(text: string): ProductionBrief['tone'] {
  const t = lc(text)
  if (/calm|premium|luxury|minimal|elegant|cinematic|slow|documentary|shant|शांत/.test(t)) return 'calm'
  if (/fast|hype|energetic|high.?energy|punchy|bold|launch|sports|trailer|tez|तेज़/.test(t)) return 'high'
  return 'medium'
}

/** Script-based language detection (Devanagari → Hindi). Used for captions and voice. */
export function detectLanguage(text: string): { language: 'en' | 'hi' | 'en+hi' | null; confidence: Confidence } {
  const deva = (text.match(/[\u0900-\u097F]/g) ?? []).length
  const latin = (text.match(/[A-Za-z]/g) ?? []).length
  const hinglish = /\b(hai|nahi|kya|aap|hum|mera|tera|kaise|bahut|accha|acha|yaar|kar|karo|ke liye)\b/i.test(text)
  if (!deva && !latin) return { language: null, confidence: 'low' }
  if (deva && latin > deva * 0.5) return { language: 'en+hi', confidence: 'medium' }
  if (deva) return { language: 'hi', confidence: deva > 12 ? 'high' : 'medium' }
  if (hinglish) return { language: 'en+hi', confidence: 'low' }
  return { language: 'en', confidence: latin > 20 ? 'high' : 'medium' }
}

export function buildBrief(intake: ProductionIntake): ProductionBrief {
  const assumptions: string[] = []
  const missing: string[] = []
  const fields: BriefField[] = []
  const user = (key: BriefField['key'], label: string, value: string) => fields.push({ key, label, value, source: 'user' })
  const assume = (key: BriefField['key'], label: string, value: string, why: string) => { fields.push({ key, label, value, source: 'assumed', why }); assumptions.push(`${label}: ${value} (${why})`) }

  for (const q of INTAKE_QUESTIONS.filter((x) => x.required)) {
    const v = intake[q.key]
    if (v === null || v === '') missing.push(q.question)
  }

  const goal = intake.making.trim()
  goal ? user('making', 'Goal', goal) : null
  const audience = intake.audience.trim()
  audience ? user('audience', 'Audience', audience) : assume('audience', 'Audience', 'General social audience', 'not specified: the hook stays broad')
  const platform = intake.platform.trim()
  platform ? user('platform', 'Platform', platform) : assume('platform', 'Platform', 'Instagram Reels / YouTube Shorts', 'not specified: vertical short-form is the safest default')

  let aspect = intake.aspect
  if (aspect) user('aspect', 'Aspect ratio', aspect)
  else {
    aspect = PLATFORM_ASPECT.find(([re]) => re.test(platform))?.[1] ?? '9:16'
    assume('aspect', 'Aspect ratio', aspect, platform ? `usual for ${platform}` : 'vertical short-form default')
  }
  let durationSec = intake.durationSec && Number.isFinite(intake.durationSec) ? Math.min(180, Math.max(5, Math.round(intake.durationSec))) : null
  if (durationSec) user('durationSec', 'Duration', `${durationSec}s`)
  else {
    durationSec = /linkedin|youtube(?! short)/i.test(platform) ? 45 : 30
    assume('durationSec', 'Duration', `${durationSec}s`, 'a common short-form length for this platform')
  }
  let narration = intake.narration
  if (narration) user('narration', 'Narration', narration)
  else {
    narration = /voice|narrat|founder|talking|interview/i.test(`${goal} ${intake.assets}`) ? 'both' : 'captions'
    assume('narration', 'Narration', narration, narration === 'both' ? 'the assets mention a voice or speaker' : 'most feeds autoplay muted, so captions carry the message')
  }
  let language = intake.language
  if (language) user('language', 'Language', language)
  else {
    const det = detectLanguage(`${goal} ${audience} ${intake.mustKeep} ${intake.cta}`)
    language = det.language ?? 'en'
    assume('language', 'Language', language, `detected from your text (${det.confidence} confidence)`)
  }
  const tone = detectTone(`${intake.referenceStyle} ${goal}`)
  ;(intake.referenceStyle ? user : (k: BriefField['key'], l: string, v: string) => assume(k, l, v, 'inferred from the goal'))('tone', 'Tone', tone)
  const cta = intake.cta.trim()
  cta ? user('cta', 'Call to action', cta) : missing.push('Call to action (the final beat stays a visible placeholder until you add one)')
  if (!intake.assets.trim()) missing.push('Footage/assets: every visual shot will be an honest placeholder')

  const brandColors = (intake.brandColors.match(/#[0-9a-f]{6}\b/gi) ?? []).map((c) => c.toUpperCase())
  if (!brandColors.length) assume('brandColors', 'Brand colours', '#F4F1EA text, #C8F542 accent', 'NewBrand defaults until you give brand colours')
  else user('brandColors', 'Brand colours', brandColors.join(', '))
  const brandFonts = lines(intake.brandFonts)
  brandFonts.length ? user('brandFonts', 'Brand fonts', brandFonts.join(', ')) : assume('brandFonts', 'Brand fonts', 'Inter Variable', 'bundled locally, so export never depends on a network font')

  const title = goal ? goal.replace(/^(a|an|the)\s+/i, '').slice(0, 60) : 'Untitled production'
  return {
    title, goal, audience: audience || 'General social audience', platform: platform || 'Instagram Reels / YouTube Shorts', durationSec, aspect, narration, language, tone, cta,
    brandColors, brandFonts, mustKeep: lines(intake.mustKeep), avoid: lines(intake.avoid), referenceStyle: intake.referenceStyle.trim(), assets: intake.assets, fields, assumptions, missing, edited: false,
  }
}

/* ——— research ————————————————————————————————————————————————— */

const GOAL_TAGS: Array<[RegExp, string[]]> = [
  [/\bad\b|advert|promo|campaign|sale|offer/i, ['videoType:ad']],
  [/launch|announce|release|introduc|new feature/i, ['videoType:launch']],
  [/demo|product|feature|showcase/i, ['videoType:product-demo', 'industries:consumer-brand']],
  [/saas|software|web ?app|dashboard|platform|tool|app\b|website/i, ['videoType:saas-walkthrough', 'industries:software']],
  [/tutorial|how to|step|guide|walkthrough/i, ['videoType:tutorial']],
  [/explain|educat|teach|lesson|concept|course/i, ['videoType:explainer', 'industries:education']],
  [/logo|intro|sting|brand reveal|opener/i, ['videoType:logo-reveal']],
  [/data|stat|chart|number|report/i, ['videoType:data-explainer']],
  [/compar|versus|\bvs\b/i, ['videoType:comparison']],
  [/founder|startup|story of|why we/i, ['videoType:founder', 'industries:startup']],
  [/music|song|mv\b/i, ['videoType:music-video', 'audio:music']],
  [/story|narrative|short film/i, ['videoType:narrative']],
  [/3d|three\.?js|spatial/i, ['videoType:3d']],
  [/game|gaming/i, ['videoType:game', 'industries:gaming']],
  [/fitness|gym|health/i, ['industries:health']],
  [/finance|invest|budget|money|crypto/i, ['industries:finance']],
  [/travel|city|tour/i, ['industries:travel']],
]
const TONE_TAGS: Record<ProductionBrief['tone'], string[]> = {
  calm: ['visualStyle:premium', 'visualStyle:minimal', 'visualStyle:cinematic'],
  medium: ['visualStyle:minimal'],
  high: ['visualStyle:futuristic', 'techniques:transitions'],
}
const SKILL_HINTS: Array<[RegExp, string]> = [
  [/ugc|creator|testimonial style|selfie/i, 'ugc-ad'], [/talking|interview|speaker|podcast/i, 'talking-head'], [/before.?after/i, 'before-after'],
  [/testimonial|review|quote/i, 'testimonial-layout'], [/logo|sting|intro/i, 'logo-reveal'], [/mobile app|ios|android|app store/i, 'app-walkthrough'],
  [/screen record|screencast/i, 'screen-recording'], [/saas|software|web ?app|dashboard/i, 'saas-walkthrough'], [/data|stat|chart/i, 'data-explainer'],
  [/tutorial|how to|step/i, 'tutorial'], [/explain|educat|teach/i, 'educational-explainer'], [/founder|why we built/i, 'founder-video'],
  [/launch|announce/i, 'launch-video'], [/compar|versus|\bvs\b/i, 'comparison-video'], [/\bad\b|advert|promo|campaign/i, 'social-ad'],
  [/demo|product/i, 'product-demo-pacing'], [/fast.?cut|montage/i, 'fast-cut'], [/cinematic|film/i, 'cinematic'], [/minimal/i, 'minimal-product'],
  [/premium|luxury|calm/i, 'calm-premium'], [/hype|energetic|high.?energy/i, 'high-energy'],
]

export function briefTags(brief: ProductionBrief): string[] {
  const text = `${brief.goal} ${brief.audience} ${brief.referenceStyle} ${brief.assets}`
  const tags = new Set<string>()
  for (const [re, t] of GOAL_TAGS) if (re.test(text)) t.forEach((x) => tags.add(x))
  TONE_TAGS[brief.tone].forEach((x) => tags.add(x))
  if (brief.narration === 'voiceover' || brief.narration === 'both') tags.add('audio:voiceover')
  if (brief.narration === 'captions' || brief.narration === 'both') tags.add('text:captions')
  return [...tags]
}

const caseTags = (c: OpusCase) => new Set([`cat:${c.categoryEn}`, ...(['videoType', 'techniques', 'audio', 'textPatterns', 'visualStyle', 'industries'] as const).flatMap((k) => c[k].map((x) => `${k === 'textPatterns' ? 'text' : k}:${x.tag}`))])

/** Rank catalogue cases for a brief. Deterministic: ties break on case id. */
export function retrieveCases(index: OpusIndex, brief: ProductionBrief, limit = 6): CaseCitation[] {
  const want = briefTags(brief)
  return index.cases
    .map((c) => {
      const have = caseTags(c)
      const hits = want.filter((t) => have.has(t))
      let score = hits.reduce((s, t) => s + (t.startsWith('videoType') ? 3 : t.startsWith('industries') ? 2 : 1), 0)
      const why: string[] = hits.map((t) => t.replace(':', ' '))
      if (c.durationSec && Math.abs(c.durationSec - brief.durationSec) <= Math.max(5, brief.durationSec * 0.25)) { score += 1.5; why.push(`similar stated length (${c.durationSec}s)`) }
      if (c.promptPublished) { score += 0.5; why.push('prompt published (structure is inspectable)') }
      return { c, score, why }
    })
    .filter((r) => r.score > 0.5)
    .sort((a, b) => b.score - a.score || a.c.caseId.localeCompare(b.c.caseId))
    .slice(0, limit)
    .map(({ c, score, why }) => ({ caseId: c.caseId, title: c.title, author: c.author, sourceUrl: c.sourceUrl, why: why.join(' · '), score: Math.round(score * 10) / 10 }))
}

export function selectSkills(index: OpusIndex, brief: ProductionBrief, cases: CaseCitation[], limit = 3): SkillPick[] {
  const text = `${brief.goal} ${brief.referenceStyle} ${brief.assets}`
  const citedIds = new Set(cases.map((c) => c.caseId))
  return index.skills
    .map((s, order) => {
      const why: string[] = []
      let score = 0
      const hint = SKILL_HINTS.findIndex(([re, id]) => id === s.id && re.test(text))
      if (hint >= 0) { score += 5; why.push('matches what you are making') }
      if (s.energy === brief.tone) { score += 1.5; why.push(`${s.energy} energy fits the tone`) }
      if (brief.narration === 'captions' && s.id === 'silent-caption-first') { score += 2; why.push('caption-first delivery') }
      if ((brief.narration === 'voiceover' || brief.narration === 'both') && s.id === 'voiceover-led') { score += 2; why.push('voiceover sets the timing') }
      if (s.id === 'hook-construction') { score += 1; why.push('every short needs a first-second hook') }
      const overlap = s.evidenceCaseIds.filter((id) => citedIds.has(id)).length
      if (overlap) { score += overlap; why.push(`${overlap} of the cited cases show it`) }
      return { s, score, why, order }
    })
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score || a.order - b.order)
    .slice(0, limit)
    .map(({ s, score, why }) => ({ id: s.id, name: s.name, why: why.join(' · '), score, evidenceCount: s.evidenceCount }))
}

export function searchResources(candidates: ResourceCandidate[], brief: ProductionBrief, limit = 6): ResourcePick[] {
  const terms = lc(`${brief.goal} ${brief.referenceStyle}`).split(/[^a-z0-9]+/).filter((w) => w.length > 3)
  return candidates
    .map((r, i) => {
      const hay = lc(`${r.name} ${r.description} ${r.tags.join(' ')}`)
      const hits = terms.filter((t) => hay.includes(t))
      return { r, i, hits }
    })
    .filter((x) => x.hits.length)
    .sort((a, b) => b.hits.length - a.hits.length || a.i - b.i)
    .slice(0, limit)
    .map(({ r, hits }) => ({ id: r.id, name: r.name, pack: r.pack, why: `mentions ${hits.slice(0, 3).join(', ')}` }))
}

export function research(index: OpusIndex, brief: ProductionBrief, resources: ResourceCandidate[] = []): ProductionResearch {
  const cases = retrieveCases(index, brief)
  const skills = selectSkills(index, brief, cases)
  const notes: string[] = []
  if (!cases.length) notes.push('No catalogue case matched this brief closely; the plan relies on NewBrand craft skills alone.')
  const lowEvidence = skills.filter((s) => s.evidenceCount === 0)
  for (const s of lowEvidence) notes.push(`“${s.name}” is NewBrand craft guidance with no catalogue case that directly demonstrates it.`)
  notes.push('Cases are cited for structure only. Nothing is copied: copy, claims and media come from your intake.')
  return { cases, skills, resources: searchResources(resources, brief), notes }
}

/* ——— plan ————————————————————————————————————————————————————— */

const TRANSITION_MAP: Record<string, StudioTransition> = { cut: 'none', whip: 'none', fade: 'fade', wipe: 'wipe-left', push: 'push-up', 'push-up': 'push-up', zoom: 'zoom-in', blur: 'blur', iris: 'iris', 'glass-wipe': 'glass-wipe', 'lens-sweep': 'lens-sweep' }
const r2 = (n: number) => Math.round(n * 100) / 100

export function buildPlan(index: OpusIndex, brief: ProductionBrief, found: ProductionResearch): ProductionPlan {
  const skill = index.skills.find((s) => s.id === found.skills.find((p) => p.id !== 'hook-construction')?.id) ?? index.skills.find((s) => s.id === found.skills[0]?.id) ?? index.skills[0]
  const cites = found.cases.slice(0, 3).map((c) => c.caseId)
  const assets = lines(brief.assets)
  const [lo, hi] = skill.shotSec
  const avgShot = brief.tone === 'high' ? lo + (hi - lo) * 0.3 : brief.tone === 'calm' ? lo + (hi - lo) * 0.8 : (lo + hi) / 2
  const transitions = skill.transitions.map((t) => TRANSITION_MAP[t] ?? 'fade')
  const mustKeep = [...brief.mustKeep]
  const shots: PlanShot[] = []
  let t = 0
  let assetCursor = 0
  skill.beats.forEach((beat, bi) => {
    const beatLen = brief.durationSec * beat.share
    const count = Math.max(1, Math.round(beatLen / Math.max(0.4, avgShot)))
    const len = beatLen / count
    for (let k = 0; k < count; k++) {
      const first = bi === 0 && k === 0
      const last = bi === skill.beats.length - 1 && k === count - 1
      let text = ''
      let confidence: Confidence = 'medium'
      if (first) { text = brief.goal ? hookLine(brief.goal) : '[Add your hook line]'; confidence = brief.goal ? 'medium' : 'low' }
      else if (last) { text = brief.cta || '[Add your call to action]'; confidence = brief.cta ? 'high' : 'low' }
      else if (mustKeep.length) { text = mustKeep.shift()!; confidence = 'high' }
      else if (k === 0) { text = `[Add: ${beat.purpose.split(/[;—(]/)[0].trim().toLowerCase()}]`; confidence = 'low' }
      const media = assets.length ? assets[assetCursor++ % assets.length] : null
      shots.push({
        id: `shot-${shots.length + 1}`,
        beat: beat.name,
        startSec: r2(t),
        durationSec: r2(len),
        purpose: beat.purpose,
        onScreenText: text,
        caption: brief.narration === 'none' ? '' : text,
        visual: media ? `Use “${media}”` : `Needs footage: ${beat.purpose.toLowerCase()}`,
        mediaName: media,
        transitionIn: first ? 'none' : transitions[(shots.length) % transitions.length],
        motion: brief.tone === 'high' ? 'punch-in 1.00→1.08' : brief.tone === 'calm' ? 'slow push 1.00→1.03' : 'gentle push 1.00→1.05',
        confidence: media ? confidence : 'low',
      })
      t += len
    }
  })
  const typeLed = isBrandFilmBrief(brief)
  if (typeLed) shots.splice(0, shots.length, ...brandFilmShots(brief))
  const shotCount = shots.length
  const decisions: PlanDecision[] = [
    ...(typeLed ? [{ area: 'Format', decision: 'Kinetic brand film: 14 type-led beats over a particle backdrop, mono HUD labels, lime accent', why: `Your brief asks for a brand film. The structure and pacing are learned from the reference films in ${BRAND_FILM_SOURCE.pr}. The copy is yours, or a visible placeholder.`, confidence: 'high' as Confidence, cites: [] }] : []),
    { area: 'Structure', decision: `${skill.name}: ${skill.beats.map((b) => b.name).join(' → ')}`, why: `${skill.when} Picked because: ${found.skills.find((s) => s.id === skill.id)?.why || 'best available match'}.`, confidence: found.skills[0]?.score >= 5 ? 'high' : 'medium', cites },
    { area: 'Pacing', decision: `${shotCount} shots, about ${avgShot.toFixed(1)}s each (range ${lo}–${hi}s)`, why: `${brief.tone} tone within the skill's shot-length range.`, confidence: 'medium', cites },
    { area: 'Hook', decision: shots[0]?.onScreenText ?? '', why: 'First frame states the goal in ≤ 7 words, taken from your own words.', confidence: brief.goal ? 'medium' : 'low', cites: [] },
    { area: 'Transitions', decision: [...new Set(transitions)].join(', '), why: `Skill recipe (${skill.transitions.join(', ')}), mapped to native NewBrand transitions. The first shot is a hard cut.`, confidence: 'high', cites },
    { area: 'Typography', decision: `Inter Variable · ${skill.text}`, why: brief.brandFonts.length ? `Built with the bundled Inter so export never depends on the network. To use ${brief.brandFonts[0]}, add it in Studio → Fonts and apply it to the text clips.` : 'Bundled font, so export never depends on the network.', confidence: brief.brandFonts.length ? 'low' : 'medium', cites: [] },
    { area: 'Captions', decision: brief.narration === 'none' ? 'Off' : `${brief.language === 'hi' ? 'Hindi' : brief.language === 'en+hi' ? 'English + Hindi' : 'English'} captions, max 2 lines`, why: brief.narration === 'captions' ? 'Caption-first: feeds autoplay muted.' : 'Captions follow the voiceover transcript once it is recorded.', confidence: 'medium', cites: [] },
    { area: 'Audio', decision: skill.audio, why: brief.avoid.some((a) => /music|lyric/i.test(a)) ? 'Respecting your "avoid" list for music.' : 'Skill recipe.', confidence: 'medium', cites: [] },
  ]
  const unresolved = [
    ...shots.filter((s) => !s.mediaName && !s.typeShot).map((s) => `${s.id} (${s.beat}): no footage assigned`),
    ...shots.filter((s) => s.onScreenText.startsWith('[')).map((s) => `${s.id} (${s.beat}): copy needed: ${s.onScreenText}`),
    ...(typeLed ? [] : skill.requiredInputs).filter((i) => !brief.assets.toLowerCase().includes(i.split(' ')[0].toLowerCase())).map((i) => `Skill input not confirmed: ${i}`),
  ]
  const needsApproval = [
    ...decisions.filter((d) => d.confidence === 'low').map((d) => `${d.area}: low confidence`),
    ...(shots.some((s) => s.confidence === 'low') ? [`${shots.filter((s) => s.confidence === 'low').length} low-confidence shot(s) will be placeholders`] : []),
  ]
  return {
    skillId: typeLed ? 'kinetic-brand-film' : skill.id,
    shots,
    decisions,
    audio: { music: brief.avoid.some((a) => /music/i.test(a)) ? 'None (avoided)' : 'Add a licensed track from your media; none is invented', voice: brief.narration === 'voiceover' || brief.narration === 'both' ? `Record or import a ${brief.language} voiceover; captions are generated from its transcript` : 'None', ducking: brief.narration === 'voiceover' || brief.narration === 'both', notes: [skill.audio] },
    captions: { enabled: brief.narration !== 'none', style: brief.tone === 'high' ? 'hormozi' : 'standard', language: brief.language, notes: ['Keep captions inside the platform safe area (top 12%, bottom 20% reserved).'] },
    export: { aspect: brief.aspect, resolution: 1080, fps: 30, format: 'mp4', watermark: false, endCard: false },
    unresolved,
    needsApproval,
  }
}

function hookLine(goal: string): string {
  const words = goal.replace(/^(a|an|the|make|create|build)\s+/i, '').replace(/\b\d+[- ]?(second|sec|s)\b/gi, '').replace(/\s+/g, ' ').trim().split(' ')
  const line = words.slice(0, 7).join(' ')
  return line.charAt(0).toUpperCase() + line.slice(1)
}

/* ——— build ———————————————————————————————————————————————————— */

export type BuildResult = { doc: StudioDoc; clipIds: string[]; placeholders: number; reused: number; destructive: boolean }

/**
 * Plan → editable Studio clips. Default is non-destructive: clips are
 * appended after the current timeline on their own tracks. `replace` clears
 * the timeline first and needs the explicit replaceApproved flag. Real
 * imported media (existing video/image clips whose file name matches an
 * intake asset) is reused. Anything unresolved becomes a named placeholder.
 */
export function planToDoc(doc: StudioDoc, plan: ProductionPlan, brief: ProductionBrief, opts: { makeId: (n: number) => string; replace?: boolean; replaceApproved?: boolean; motion?: boolean }): BuildResult {
  const destructive = Boolean(opts.replace)
  if (destructive && !opts.replaceApproved) throw new Error('Replacing the timeline is destructive and needs explicit approval.')
  const baseClips = destructive ? [] : doc.clips
  const offset = destructive ? 0 : r2(baseClips.reduce((m, c) => Math.max(m, c.startSec + c.durationSec), 0))
  const media = doc.clips.filter((c): c is StudioMediaClip => (c.kind === 'video' || c.kind === 'image') && Boolean(c.mediaId))
  const firstFree = destructive ? 0 : Math.max(0, ...baseClips.map((c) => c.track + 1))
  const mediaTrack = Math.min(22, firstFree)
  const textTrack = Math.min(23, mediaTrack + 1)
  let n = 0
  const clipIds: string[] = []
  const out: StudioClip[] = []
  let placeholders = 0
  let reused = 0
  const color = brief.brandColors.find((c) => c !== '#0B0B10') ?? '#F4F1EA'
  const typeShots = plan.shots.filter((sh) => sh.typeShot)
  if (typeShots.length) {
    const accent = brief.brandColors.find((c) => c !== '#0B0B10' && c !== '#F4F1EA') ?? '#C8F542'
    const end = Math.max(...typeShots.map((sh) => sh.startSec + sh.durationSec))
    const bid = opts.makeId(n++)
    out.push({ id: bid, kind: 'background', backgroundId: 'liquid-chrome', track: mediaTrack, startSec: r2(offset), durationSec: r2(end), name: 'Film backdrop', transitionIn: 'fade', transitionOut: 'fade', opacity: 1 } as unknown as StudioClip)
    clipIds.push(bid)
  }
  for (const shot of plan.shots) {
    if (shot.typeShot) {
      const ts = shot.typeShot
      const accent = brief.brandColors.find((c) => c !== '#0B0B10' && c !== '#F4F1EA') ?? '#C8F542'
      const t0 = r2(offset + shot.startSec)
      const hindi = brief.language === 'hi'
      const font = hindi ? 'Noto Sans Devanagari' : brief.brandFonts[0] ?? 'Inter Variable'
      const add = (c: Partial<StudioTextClip> & { text: string; track: number; startSec: number; durationSec: number }) => {
        const id = opts.makeId(n++)
        out.push({ id, kind: 'text', name: `${shot.id} · ${c.text.slice(0, 20)}`, transitionIn: 'none', transitionOut: 'fade', opacity: 1, fontSizePct: 12, fontFamily: font, color: '#F4F1EA', weight: 800, align: 'center', x: 0.5, y: 0.5, anim: 'word-reveal', captionStyle: null, highlightWord: null, legibility: 'off', ...c, startSec: r2(c.startSec), durationSec: r2(Math.max(0.3, c.durationSec)) } as StudioTextClip)
        clipIds.push(id)
      }
      const vertical = brief.aspect === '9:16'
      const big = vertical ? 9 : 13
      add({ text: ts.label, track: Math.min(23, textTrack + 1), startSec: t0 + 0.15, durationSec: shot.durationSec - 0.3, fontSizePct: 1.8, fontFamily: 'JetBrains Mono', color: '#9AA3AD', weight: 600, x: vertical ? 0.3 : 0.16, y: 0.07, anim: 'typewriter', transitionOut: 'fade' })
      const placeholder = (l: string) => (l.startsWith('[') ? { color: '#9A9AA5' } : {})
      if (ts.layout === 'stack' && ts.lines.length >= 2) {
        const half = r2(shot.durationSec * 0.45)
        add({ text: ts.lines[0], track: textTrack, startSec: t0 + 0.25, durationSec: half, fontSizePct: big * 1.25, anim: 'kinetic', ...placeholder(ts.lines[0]) })
        add({ text: ts.lines[1], track: textTrack, startSec: t0 + 0.25 + half, durationSec: shot.durationSec - 0.25 - half, fontSizePct: big * 0.8, anim: 'word-reveal', color: accent, textGlow: 0.35, ...placeholder(ts.lines[1]) })
      } else if (ts.layout === 'split' && ts.lines.length >= 2) {
        add({ text: ts.lines[0], track: textTrack, startSec: t0 + 0.2, durationSec: shot.durationSec - 0.2, fontSizePct: big * 0.6, x: 0.5, y: 0.4, anim: 'slide-left', ...placeholder(ts.lines[0]) })
        add({ text: ts.lines[1], track: Math.min(23, textTrack + 2), startSec: t0 + 0.2 + shot.durationSec * 0.3, durationSec: shot.durationSec * 0.7 - 0.2, fontSizePct: big * 0.6, x: 0.5, y: 0.6, color: accent, anim: 'slide-left', ...placeholder(ts.lines[1]) })
      } else if (ts.layout === 'cloud') {
        const words = ts.words ?? []
        const pos = cloudLayout(words.length)
        words.forEach((w, i) => add({ text: w, track: Math.min(23, textTrack + 2 + i), startSec: t0 + 0.1 + i * 0.08, durationSec: shot.durationSec * 0.55, fontSizePct: big * 0.55, x: pos[i].x, y: pos[i].y, color: i % 3 === 1 ? accent : '#F4F1EA', anim: 'pop' }))
        add({ text: ts.lines[0] ?? '', track: textTrack, startSec: t0 + shot.durationSec * 0.55, durationSec: shot.durationSec * 0.45, fontSizePct: big * 1.1, anim: 'kinetic' })
      } else if (ts.layout === 'end') {
        add({ text: ts.lines[0], track: textTrack, startSec: t0 + 0.1, durationSec: shot.durationSec - 0.1, fontSizePct: big * 0.8, y: 0.44, anim: 'fade-up', ...placeholder(ts.lines[0]) })
        if (ts.lines[1]) add({ text: ts.lines[1], track: Math.min(23, textTrack + 2), startSec: t0 + 0.4, durationSec: shot.durationSec - 0.4, fontSizePct: big * 0.28, y: 0.6, color: accent, weight: 600, anim: 'fade-up', ...placeholder(ts.lines[1]) })
      } else {
        add({ text: ts.lines.join(' '), track: textTrack, startSec: t0 + 0.2, durationSec: shot.durationSec - 0.2, fontSizePct: ts.layout === 'logo' ? big * 1.2 : big, anim: ts.layout === 'logo' ? 'pop' : 'kinetic', ...(ts.layout === 'logo' ? { textGlow: 0.4 } : {}), ...placeholder(ts.lines.join(' ')) })
      }
      continue
    }
    const match = shot.mediaName ? media.find((m) => lc(m.fileName) === lc(shot.mediaName!) || lc(m.fileName).includes(lc(shot.mediaName!).replace(/\.[a-z0-9]+$/, ''))) : null
    const id = opts.makeId(n++)
    const common = { id, track: mediaTrack, startSec: r2(offset + shot.startSec), durationSec: shot.durationSec, transitionIn: shot.transitionIn as StudioTransition, transitionOut: 'none' as StudioTransition, opacity: 1 }
    if (match) {
      reused++
      out.push({ ...match, ...common, name: `${shot.id} · ${match.fileName}`, trimInSec: match.trimInSec, speed: match.speed, x: 0.5, y: 0.5, scale: 1 } as StudioMediaClip)
    } else {
      placeholders++
      out.push({ ...common, kind: 'image', name: `${shot.id} · replace: ${shot.mediaName ?? shot.purpose}`.slice(0, 90), mediaId: '', fileName: shot.mediaName ? `Import “${shot.mediaName}”` : 'Add footage for this shot', localPath: null, trimInSec: 0, sourceDurationSec: shot.durationSec, speed: 1, volume: 1, fit: 'cover', x: 0.5, y: 0.5, scale: 1 } as StudioMediaClip)
    }
    clipIds.push(id)
    if (shot.onScreenText) {
      const tid = opts.makeId(n++)
      const text: StudioTextClip = {
        id: tid, kind: 'text', track: textTrack, startSec: r2(offset + shot.startSec), durationSec: shot.durationSec, name: `${shot.id} · text`,
        transitionIn: 'none', transitionOut: 'none', opacity: 1, text: shot.onScreenText, fontSizePct: shot.startSec === 0 ? 8 : 6,
        fontFamily: /[\u0900-\u097F]/.test(shot.onScreenText) || brief.language === 'hi' ? 'Noto Sans Devanagari' : 'Inter Variable',
        color: shot.onScreenText.startsWith('[') ? '#9A9AA5' : color, weight: 800, align: 'center', x: 0.5, y: brief.aspect === '9:16' ? 0.62 : 0.72,
        anim: brief.tone === 'high' ? 'kinetic' : 'fade-up', captionStyle: null, highlightWord: null,
      }
      out.push(text)
      clipIds.push(tid)
    }
  }
  const built: StudioDoc = { ...doc, aspect: destructive ? brief.aspect : doc.aspect, clips: [...baseClips, ...out], trackCount: Math.max(destructive ? 1 : doc.trackCount, textTrack + 1, ...out.map((c) => c.track + 1)) }
  return { doc: opts.motion === false ? built : directProduction(built, clipIds, brief), clipIds, placeholders, reused, destructive }
}

/* ——— NewBrand: motion direction + polish (deterministic, never touches copy) ——— */

export function styleForBrief(brief: ProductionBrief): DirectionStyle {
  if (brief.tone === 'high') return 'bold-social'
  if (brief.tone === 'calm') return /film|story|brand|cinematic|travel/i.test(`${brief.fields.map((f) => f.value).join(' ')}`) ? 'cinematic' : 'minimal'
  return 'editorial'
}

/**
 * Keyframe the built clips like a motion designer: enter → live → leave, timed
 * to each clip's length, with eases chosen for the style (motionDirector).
 * Only touches the clips in `clipIds`, so your own clips stay exactly as they were.
 */
export function directProduction(doc: StudioDoc, clipIds: string[], brief: ProductionBrief): StudioDoc {
  const style = styleForBrief(brief)
  const ids = new Set(clipIds)
  const mine = doc.clips.filter((c) => ids.has(c.id)).sort((a, b) => a.startSec - b.startSec || a.track - b.track)
  const texts = mine.filter((c) => c.kind === 'text')
  const media = mine.filter((c) => c.kind === 'video' || c.kind === 'image')
  const patches = new Map<string, Partial<StudioClip>>()
  mine.forEach((clip, index) => {
    const textIndex = (texts as StudioClip[]).indexOf(clip)
    const mediaIndex = media.indexOf(clip)
    const isLast = clip.kind === 'text' ? textIndex === texts.length - 1 : mediaIndex === media.length - 1
    const spec = directClip(clip, { index, textIndex: Math.max(0, textIndex), mediaIndex: Math.max(0, mediaIndex), isHero: textIndex === 0, isLast }, style)
    patches.set(clip.id, motionPatch(clip, spec))
  })
  return { ...doc, clips: doc.clips.map((c) => (patches.has(c.id) ? ({ ...c, ...patches.get(c.id) } as StudioClip) : c)) }
}

export type PolishResult = { doc: StudioDoc; fixes: string[]; leftForYou: string[] }

/**
 * "NewBrand polish": fixes what the review can fix safely and lists the rest.
 * It never writes copy, never swaps placeholders for fake media, and never
 * changes the aspect ratio (that needs your say-so).
 */
export function polishEdit(doc: StudioDoc, brief: ProductionBrief, plan: ProductionPlan | null, clipIds: string[]): PolishResult {
  const ids = new Set(clipIds)
  const fixes: string[] = []
  const leftForYou: string[] = []
  let clips = doc.clips.map((c) => {
    if (!ids.has(c.id)) return c
    let next = c
    if (c.kind === 'text' && (c.y < 0.14 || c.y > 0.78)) next = { ...next, y: Math.min(0.78, Math.max(0.14, c.y)) } as StudioClip
    if ('volume' in next && typeof (next as { volume?: number }).volume === 'number' && (next as { volume: number }).volume > 1) next = { ...next, volume: 1 } as StudioClip
    return next
  })
  const moved = clips.filter((c, i) => c !== doc.clips[i] && c.kind === 'text').length
  if (moved) fixes.push(`Moved ${moved} text clip(s) into the caption-safe area.`)
  const quieted = clips.filter((c, i) => c !== doc.clips[i] && c.kind !== 'text').length
  if (quieted) fixes.push(`Brought ${quieted} boosted clip(s) back to 100% volume.`)
  // Transition density: keep transitions only where the beat changes.
  const media = clips.filter((c) => ids.has(c.id) && (c.kind === 'video' || c.kind === 'image')).sort((a, b) => a.startSec - b.startSec)
  const withT = media.filter((m) => m.transitionIn !== 'none')
  if (media.length && withT.length / media.length > 0.7) {
    const beatOf = (name: string) => plan?.shots.find((s) => name.startsWith(`${s.id} `))?.beat ?? name
    const keep = new Set(media.filter((m, i) => i === 0 || beatOf(m.name) !== beatOf(media[i - 1].name)).map((m) => m.id))
    clips = clips.map((c) => (ids.has(c.id) && (c.kind === 'video' || c.kind === 'image') && !keep.has(c.id) && c.transitionIn !== 'none' ? ({ ...c, transitionIn: 'none' } as StudioClip) : c))
    fixes.push(`Switched ${withT.length - keep.size} in-beat transition(s) to hard cuts, keeping transitions on beat changes.`)
  }
  let next: StudioDoc = { ...doc, clips }
  const hasVoice = clips.some((c) => c.kind === 'audio' && /voice|vo\b|narrat/i.test(c.name))
  if (plan?.audio.ducking && hasVoice && !doc.ducking?.enabled) {
    next = { ...next, ducking: { enabled: true, amountDb: doc.ducking?.amountDb ?? -12, fadeSec: doc.ducking?.fadeSec ?? 0.25 } }
    fixes.push('Turned on music ducking under the voiceover.')
  }
  next = directProduction(next, clipIds, brief)
  fixes.push(`Re-timed keyframe motion on ${clipIds.length} built clip(s) for a ${styleForBrief(brief)} feel.`)
  const scoped = next.clips.filter((c) => ids.has(c.id))
  const copyPh = scoped.filter((c) => c.kind === 'text' && c.text.trim().startsWith('[')).length
  const mediaPh = scoped.filter((c) => (c.kind === 'video' || c.kind === 'image') && !(c as StudioMediaClip).mediaId).length
  const fast = scoped.filter((c) => c.kind === 'text' && c.text.split(/\s+/).length / Math.max(0.1, c.durationSec) > 3.5).length
  if (copyPh) leftForYou.push(`Write ${copyPh} bracketed line(s). NewBrand won't invent claims or quotes.`)
  if (mediaPh) leftForYou.push(`Replace ${mediaPh} placeholder shot(s) with your footage.`)
  if (fast) leftForYou.push(`Shorten ${fast} line(s) that read faster than 3.5 words per second.`)
  if (doc.aspect !== brief.aspect) leftForYou.push(`Switch the Studio aspect to ${brief.aspect} if you want the brief's format. That changes framing, so it's your call.`)
  return { doc: next, fixes, leftForYou }
}

/* ——— review ——————————————————————————————————————————————————— */

export function reviewEdit(doc: StudioDoc, brief: ProductionBrief, plan: ProductionPlan | null, clipIds?: string[]): ReviewCheck[] {
  const scope = clipIds?.length ? doc.clips.filter((c) => clipIds.includes(c.id)) : doc.clips
  const checks: ReviewCheck[] = []
  const add = (id: string, label: string, status: ReviewCheck['status'], detail: string, fix: string | null = null) => checks.push({ id, label, status, detail, fix })
  const start = scope.length ? Math.min(...scope.map((c) => c.startSec)) : 0
  const end = scope.length ? Math.max(...scope.map((c) => c.startSec + c.durationSec)) : 0
  const length = end - start
  const texts = scope.filter((c): c is StudioTextClip => c.kind === 'text')
  const visuals = scope.filter((c) => c.kind === 'video' || c.kind === 'image')

  const dev = brief.durationSec ? Math.abs(length - brief.durationSec) / brief.durationSec : 0
  add('brief-duration', 'Brief alignment: duration', !scope.length ? 'fail' : dev <= 0.1 ? 'pass' : dev <= 0.25 ? 'warn' : 'fail', `${length.toFixed(1)}s edit vs ${brief.durationSec}s brief`, dev > 0.1 ? `Trim or extend to about ${brief.durationSec}s (the Plan tab regenerates timing).` : null)
  add('brief-aspect', 'Export dimensions', doc.aspect === brief.aspect ? 'pass' : 'warn', `Project ${doc.aspect}, brief ${brief.aspect}`, doc.aspect === brief.aspect ? null : `Switch the Studio aspect to ${brief.aspect} before export (Studio → aspect).`)
  const hook = texts.find((t) => t.startSec - start < 1.5)
  add('hook', 'Hook strength', !hook ? 'fail' : hook.text.startsWith('[') ? 'warn' : hook.text.split(/\s+/).length <= 8 ? 'pass' : 'warn', hook ? `First line: “${hook.text}”` : 'No on-screen line in the first 1.5s', !hook ? 'Add a ≤ 7-word hook line in the first second.' : hook.text.startsWith('[') ? 'Replace the placeholder with your real hook.' : hook.text.split(/\s+/).length > 8 ? 'Shorten the hook to 7 words or fewer.' : null)
  const shotLens = visuals.map((v) => v.durationSec)
  const avg = shotLens.length ? shotLens.reduce((a, b) => a + b, 0) / shotLens.length : 0
  const range = brief.tone === 'high' ? [0.4, 2.2] : brief.tone === 'calm' ? [2, 7] : [1, 4]
  add('pacing', 'Pacing', !shotLens.length ? 'fail' : avg >= range[0] && avg <= range[1] ? 'pass' : 'warn', `Average shot ${avg.toFixed(1)}s (${brief.tone} tone target ${range[0]}–${range[1]}s)`, avg > range[1] ? 'Split long shots or add punch-ins.' : avg < range[0] && shotLens.length ? 'Merge very short shots; viewers need time to read.' : null)
  const fast = texts.filter((t) => t.text.split(/\s+/).length / Math.max(0.1, t.durationSec) > 3.5)
  add('readability', 'Readability', fast.length ? 'warn' : 'pass', fast.length ? `${fast.length} line(s) faster than 3.5 words/s` : 'Every line holds long enough to read', fast.length ? `Lengthen or shorten: ${fast.slice(0, 3).map((t) => `“${t.text.slice(0, 24)}”`).join(', ')}` : null)
  const unsafe = texts.filter((t) => t.y < 0.12 || t.y > 0.8)
  add('caption-safety', 'Caption safety', unsafe.length ? 'warn' : 'pass', unsafe.length ? `${unsafe.length} text clip(s) inside platform UI zones` : 'All text inside the safe area', unsafe.length ? 'Move text between 12% and 80% of the frame height.' : null)
  let maxStack = 0
  for (const t of texts) maxStack = Math.max(maxStack, texts.filter((o) => o.startSec < t.startSec + t.durationSec && t.startSec < o.startSec + o.durationSec).length)
  add('hierarchy', 'Visual hierarchy', maxStack > 2 ? 'warn' : 'pass', `Up to ${maxStack} text layer(s) at once`, maxStack > 2 ? 'Keep one headline and at most one supporting line per moment.' : null)
  const loud = scope.filter((c) => 'volume' in c && typeof (c as { volume?: number }).volume === 'number' && (c as { volume: number }).volume > 1)
  const hasVoice = scope.some((c) => c.kind === 'audio' && /voice|vo\b|narrat/i.test(c.name))
  add('audio', 'Audio levels', loud.length ? 'warn' : plan?.audio.ducking && hasVoice && !doc.ducking?.enabled ? 'warn' : 'pass', loud.length ? `${loud.length} clip(s) boosted above 100%` : plan?.audio.ducking ? (doc.ducking?.enabled ? 'Ducking on' : hasVoice ? 'Voice present, ducking off' : 'No voice track yet') : 'No boosted clips', loud.length ? 'Bring volumes to ≤ 100% and use loudness normalisation.' : plan?.audio.ducking && hasVoice && !doc.ducking?.enabled ? 'Turn on auto-ducking in the Studio audio panel.' : null)
  const withTransition = visuals.filter((v) => v.transitionIn !== 'none').length
  const density = visuals.length ? withTransition / visuals.length : 0
  add('transition-density', 'Transition density', density > 0.7 ? 'warn' : 'pass', `${withTransition}/${visuals.length} shots use a transition`, density > 0.7 ? 'Use hard cuts for most shots and save transitions for beat changes.' : null)
  const credits = doc.credits ?? []
  const stockish = visuals.filter((v) => /pexels|pixabay|openverse|unsplash|stock/i.test((v as StudioMediaClip).fileName ?? ''))
  add('licensing', 'Asset licensing', stockish.length && !credits.length ? 'warn' : 'pass', stockish.length ? `${stockish.length} stock-looking file(s), ${credits.length} credit(s) recorded` : 'No third-party stock detected', stockish.length && !credits.length ? 'Import stock through the Stock browser so its licence and credit are recorded.' : null)
  const ph = visuals.filter((v) => !(v as StudioMediaClip).mediaId)
  add('placeholders', 'Placeholder usage', ph.length ? 'fail' : 'pass', ph.length ? `${ph.length} shot(s) still placeholders: ${ph.slice(0, 3).map((p) => p.name).join('; ')}` : 'Every shot has real media', ph.length ? 'Import the named footage and replace each placeholder (select the clip, then Replace media).' : null)
  const copyPh = texts.filter((t) => t.text.trim().startsWith('['))
  add('missing-copy', 'Missing copy', copyPh.length ? 'fail' : 'pass', copyPh.length ? `${copyPh.length} placeholder line(s)` : 'All copy is real', copyPh.length ? 'Write the bracketed lines. NewBrand will not invent claims, stats or quotes.' : null)
  add('missing-footage', 'Missing footage', plan && plan.unresolved.some((u) => /footage/.test(u)) ? 'warn' : 'pass', plan ? `${plan.unresolved.filter((u) => /footage/.test(u)).length} shot(s) planned without footage` : 'No plan', plan && plan.unresolved.some((u) => /footage/.test(u)) ? 'List your assets in Intake, one per line, and rebuild.' : null)
  return checks
}

export function reviewScore(checks: ReviewCheck[]): number {
  if (!checks.length) return 0
  return Math.round((checks.reduce((s, c) => s + (c.status === 'pass' ? 1 : c.status === 'warn' ? 0.5 : 0), 0) / checks.length) * 100)
}

/* ——— Run until approval / auto-finish ——————————————————————————— */

/** Intake → brief → research → plan in one go. Stops at the preview: approval stays manual. */
export function runToApproval(index: OpusIndex, intake: ProductionIntake, resources: ResourceCandidate[] = []): Pick<ProductionSession, 'brief' | 'research' | 'plan'> {
  const brief = buildBrief(intake)
  const found = research(index, brief, resources)
  return { brief, research: found, plan: buildPlan(index, brief, found) }
}

export type FinishRound = { round: number; score: number; fixes: string[] }
export type FinishResult = BuildResult & { rounds: FinishRound[]; review: ReviewCheck[]; leftForYou: string[]; beatsSnapped: number; beatNote: string | null }

/**
 * After approval: build, then review → polish → review until the score stops
 * improving (max 3 rounds). Optionally rolls cuts onto analysed music beats.
 * Pure and deterministic. The caller commits it as ONE undo step.
 */
export function autoFinish(doc: StudioDoc, plan: ProductionPlan, brief: ProductionBrief, opts: { makeId: (n: number) => string; replace?: boolean; replaceApproved?: boolean; snapToBeats?: boolean; maxRounds?: number }): FinishResult {
  const built = planToDoc(doc, plan, brief, opts)
  let cur = built.doc
  let review = reviewEdit(cur, brief, plan, built.clipIds)
  let score = reviewScore(review)
  const rounds: FinishRound[] = [{ round: 0, score, fixes: ['Built from the approved plan with keyframed motion.'] }]
  let leftForYou: string[] = []
  let beatsSnapped = 0
  let beatNote: string | null = null
  if (opts.snapToBeats) {
    if (!timelineBeats(cur).length) beatNote = 'No analysed music on the timeline. Add music and run Beats in the audio inspector, then NewBrand can cut on the beat.'
    else {
      const snapped = snapCutsToBeats(cur, 0.3)
      cur = snapped.doc
      beatsSnapped = snapped.moved
      beatNote = `Rolled ${snapped.moved} cut(s) onto music beats.`
    }
  }
  for (let round = 1; round <= (opts.maxRounds ?? 3); round++) {
    const p = polishEdit(cur, brief, plan, built.clipIds)
    const nextReview = reviewEdit(p.doc, brief, plan, built.clipIds)
    const nextScore = reviewScore(nextReview)
    leftForYou = p.leftForYou
    if (nextScore <= score && round > 1) break
    cur = p.doc
    review = nextReview
    rounds.push({ round, score: nextScore, fixes: p.fixes })
    if (nextScore <= score) break
    score = nextScore
  }
  return { ...built, doc: cur, rounds, review, leftForYou, beatsSnapped, beatNote }
}
