/**
 * Autonomous production session: intake → brief → research → plan →
 * preview → build → review → export. It's saved on the project, so a restart
 * resumes at the last checkpoint.
 */

export type ProductionStage = 'intake' | 'brief' | 'research' | 'plan' | 'preview' | 'build' | 'review' | 'export'
export const PRODUCTION_STAGES: ProductionStage[] = ['intake', 'brief', 'research', 'plan', 'preview', 'build', 'review', 'export']

export type ProductionLanguage = 'en' | 'hi' | 'en+hi'
export type ProductionAspect = '9:16' | '16:9' | '1:1' | '4:5'

export type ProductionIntake = {
  making: string
  audience: string
  platform: string
  durationSec: number | null
  aspect: ProductionAspect | null
  assets: string
  narration: 'voiceover' | 'captions' | 'both' | 'none' | null
  language: ProductionLanguage | null
  brandColors: string
  brandFonts: string
  cta: string
  referenceStyle: string
  mustKeep: string
  avoid: string
}

export type Confidence = 'high' | 'medium' | 'low'

export type BriefField = { key: keyof ProductionIntake | 'tone' | 'skill'; label: string; value: string; source: 'user' | 'assumed'; why?: string }

export type ProductionBrief = {
  title: string
  goal: string
  audience: string
  platform: string
  durationSec: number
  aspect: ProductionAspect
  narration: NonNullable<ProductionIntake['narration']>
  language: ProductionLanguage
  tone: 'high' | 'medium' | 'calm'
  cta: string
  brandColors: string[]
  brandFonts: string[]
  mustKeep: string[]
  avoid: string[]
  referenceStyle: string
  assets: string
  fields: BriefField[]
  assumptions: string[]
  missing: string[]
  /** User edited the brief after generation. */
  edited: boolean
}

export type CaseCitation = { caseId: string; title: string; author: string | null; sourceUrl: string; why: string; score: number }
export type SkillPick = { id: string; name: string; why: string; score: number; evidenceCount: number }
export type ResourcePick = { id: string; name: string; pack: string; why: string }

export type ProductionResearch = {
  cases: CaseCitation[]
  skills: SkillPick[]
  resources: ResourcePick[]
  notes: string[]
}

export type PlanDecision = { area: string; decision: string; why: string; confidence: Confidence; cites: string[] }

export type PlanShot = {
  id: string
  beat: string
  startSec: number
  durationSec: number
  purpose: string
  onScreenText: string
  caption: string
  visual: string
  /** Name of the imported asset to use, or null = unresolved placeholder. */
  mediaName: string | null
  transitionIn: string
  motion: string
  confidence: Confidence
}

export type ProductionPlan = {
  skillId: string
  shots: PlanShot[]
  decisions: PlanDecision[]
  audio: { music: string; voice: string; ducking: boolean; notes: string[] }
  captions: { enabled: boolean; style: string; language: ProductionLanguage; notes: string[] }
  export: { aspect: ProductionAspect; resolution: 1080; fps: 30; format: 'mp4' | 'webm'; watermark: false; endCard: boolean }
  unresolved: string[]
  /** Anything below this needs explicit approval before build. */
  needsApproval: string[]
}

export type ReviewCheck = { id: string; label: string; status: 'pass' | 'warn' | 'fail'; detail: string; fix: string | null }

export type ProductionCheckpoint = { stage: ProductionStage; label: string; at: string }

export type ProductionSession = {
  version: 1
  stage: ProductionStage
  intake: ProductionIntake
  brief: ProductionBrief | null
  research: ProductionResearch | null
  plan: ProductionPlan | null
  /** Plan approved by the user (manual approval is the only gate). */
  approved: boolean
  /** Explicit consent to replace the current timeline (destructive build). */
  replaceApproved: boolean
  builtClipIds: string[]
  review: ReviewCheck[] | null
  checkpoints: ProductionCheckpoint[]
}
