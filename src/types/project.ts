export type AutomationMode = 'guided' | 'auto-draft' | 'auto-final'
/**
 * How the winning candidate is chosen.
 * - `local-scoring`: the app generates several AI candidates and scores them
 *   against the renderer contract itself.
 * - `manual-arena`: the human votes on arena.ai and approves the gate.
 * An "official Arena API" mode existed here but was never implemented — it only
 * threw — so it was removed rather than left reachable in the UI.
 */
export type VotingMode = 'manual-arena' | 'local-scoring'
export type AutomationStepStatus = 'queued' | 'running' | 'waiting-for-user' | 'done' | 'error' | 'cancelled'
export type AutomationStep = {
  id: string
  label: string
  status: AutomationStepStatus
  progressPct: number
  message?: string
  startedAt?: string
  completedAt?: string
  errorMessage?: string
}
export type AutomationJob = {
  id: string
  projectId: string
  brief: string
  footageFolder?: string | null
  outputFolder?: string | null
  aspect: '16:9' | '9:16' | '1:1'
  fps: 30 | 60
  quality: 'draft' | 'final'
  mode: AutomationMode
  votingMode: VotingMode
  status: AutomationStepStatus
  currentStepId: string | null
  steps: AutomationStep[]
  createdAt: string
  updatedAt: string
  outputPath?: string | null
  reviewReportPath?: string | null
  rundown?: SceneRundown | null
  rundownPath?: string | null
  winnerPath?: string | null
  waitingMessage?: string | null
  errorMessage?: string | null
  warnings?: string[]
  manualVoteApproved?: boolean
  candidates?: { file: string; score: number; reasons: string[] }[]
  footageMeta?: unknown
  arenaOpenedAt?: string | null
}

export type View =
  | 'home'
  | 'auto'
  | 'review'
  | 'brief'
  | 'arena'
  | 'footage'
  | 'timeline'
  | 'studio'
  | 'lab'
  | 'render'
  | 'library'

export type BriefMessage = { role: 'user' | 'gemini'; text: string; at: string }

export type SceneRundown = {
  title: string
  durationSec: number
  fps: number
  size: [number, number]
  style: string
  scenes: { id: string; from: number; to: number; type: string; copy: string; motion: string }[]
  arenaPrompt: string
}

export type ArenaAsset = {
  id: string
  name: string
  status: 'prompt-ready' | 'awaiting-vote' | 'imported' | 'rendered'
  prompt: string
  htmlFileName: string | null
  thumbnailDataUrl: string | null
  localPath?: string | null
  createdAt: string
}

export type FootageAsset = {
  id: string
  name: string
  durationSec: number
  localPath?: string | null
  status: 'uploaded' | 'analyzing' | 'edited'
  silenceRanges: [number, number][]
  waveform?: number[]
  captionStyle: 'hormozi' | 'standard' | 'minimal'
  crop: '16:9' | '9:16' | '1:1'
}

export type TimelineClip = {
  id: string
  sourceType: 'arena' | 'footage'
  sourceId: string
  startSec: number
  durationSec: number
}

export type RenderJob = {
  id: string
  aspect: '16:9' | '9:16' | '1:1'
  fps: 30 | 60
  quality: 'draft' | 'final'
  status: 'queued' | 'rendering' | 'done' | 'error'
  progressPct: number
  outputName: string | null
  outputPath?: string | null
  errorMessage?: string | null
  createdAt: string
  sources?: unknown[]
}

export type Project = {
  id: string
  name: string
  createdAt: string
  updatedAt: string
  brief: {
    messages: BriefMessage[]
    /** Draft rundown being filled in by Gemini — becomes lockedRundown on "Lock". */
    draftRundown: Partial<SceneRundown> | null
    lockedRundown: SceneRundown | null
  }
  arenaAssets: ArenaAsset[]
  footageAssets: FootageAsset[]
  timeline: TimelineClip[]
  renderJobs: RenderJob[]
  /** In-app editor document. Optional on projects created before 0.3.0. */
  studio?: StudioDoc
  brandKit: { colors: string[]; font: string; logoDataUrl: string | null }
}

export type LibraryItem =
  | { id: string; kind: 'rundown'; name: string; updatedAt: string; rundown: SceneRundown }
  | { id: string; kind: 'arena'; name: string; updatedAt: string; prompt: string; style: string }
  | { id: string; kind: 'preset'; name: string; updatedAt: string; colors: string[]; font: string }
  | {
      id: string
      kind: 'effect'
      name: string
      updatedAt: string
      effectId: string
      effectKind: 'background' | 'transition' | 'caption' | 'motion' | 'texture'
      description: string
      promptCue: string
    }
  | {
      id: string
      kind: 'background'
      name: string
      updatedAt: string
      gradientId: string
      css: string
    }

/* ————————————————————————————————————————————————————————————————
 * Studio — the in-app CapCut-style editor.
 * A StudioDoc is the full edit: stacked tracks of clips over a background,
 * rendered deterministically to a canvas by src/lib/studio/renderer.ts.
 * ———————————————————————————————————————————————————————————————— */

export type StudioAspect = '16:9' | '9:16' | '1:1'
export type StudioTextAnim =
  | 'none'
  | 'fade-up'
  | 'word-reveal'
  | 'pop'
  | 'typewriter'
  | 'slide-left'
  | 'shimmer'
  | 'glass-rise'
  | 'liquid-wave'
export type StudioTransition =
  | 'none'
  | 'fade'
  | 'wipe-left'
  | 'zoom-in'
  | 'blur'
  | 'iris'
  | 'push-up'
  | 'glass-wipe'
  | 'liquid-dissolve'
  | 'lens-sweep'
export type StudioCaptionStyle = 'hormozi' | 'standard' | 'minimal'

type StudioClipCommon = {
  id: string
  /** 0 = bottom-most track. Higher tracks draw on top. */
  track: number
  startSec: number
  durationSec: number
  name: string
  transitionIn: StudioTransition
  transitionOut: StudioTransition
  /** 0–1 */
  opacity: number
}

export type StudioMediaClip = StudioClipCommon & {
  kind: 'video' | 'image'
  /** Runtime handle into the media registry (object URLs are never persisted). */
  mediaId: string
  fileName: string
  localPath: string | null
  /** Seconds into the source file where this clip starts. */
  trimInSec: number
  sourceDurationSec: number
  speed: number
  volume: number
  fit: 'cover' | 'contain'
  posterDataUrl?: string | null
}

export type StudioTextClip = StudioClipCommon & {
  kind: 'text'
  text: string
  fontSizePct: number
  color: string
  weight: 400 | 600 | 800
  align: 'left' | 'center' | 'right'
  /** Normalised 0–1 position of the text box centre. */
  x: number
  y: number
  anim: StudioTextAnim
  captionStyle: StudioCaptionStyle | null
  highlightWord: string | null
}

export type StudioBackgroundClip = StudioClipCommon & {
  kind: 'background'
  backgroundId: string
}

export type StudioOverlayClip = StudioClipCommon & {
  kind: 'overlay'
  /** PNG snapshot (data URL) of a UI Lab demo or any imported image. */
  dataUrl: string
  source: string
  x: number
  y: number
  scale: number
}

/**
 * Background music / voiceover.
 *
 * Audio paints nothing, so it never reaches the canvas renderer — it is mixed
 * in the preview (element volume) and in the export (Web Audio gain). Fades are
 * stored in seconds rather than as a curve id so preview and export can compute
 * the same gain from the same numbers.
 */
export type StudioAudioClip = StudioClipCommon & {
  kind: 'audio'
  mediaId: string
  fileName: string
  localPath: string | null
  /** Seconds into the source file where this clip starts. */
  trimInSec: number
  sourceDurationSec: number
  /** 0–1 master level for this clip, before fades. */
  volume: number
  fadeInSec: number
  fadeOutSec: number
}

export type StudioGlassClip = StudioClipCommon & {
  kind: 'glass'
  /** Preset id from `src/lib/glass.ts`. */
  presetId: string
  shape: 'panel' | 'lens'
  /** Normalised geometry (0–1 of the frame). */
  x: number
  y: number
  w: number
  h: number
  radiusPct: number
  motion: 'static' | 'sweep' | 'drift' | 'pop'
  /** Optional label drawn on the panel. */
  label: string
  labelColor: string
}

export type StudioClip =
  | StudioMediaClip
  | StudioAudioClip
  | StudioTextClip
  | StudioBackgroundClip
  | StudioOverlayClip
  | StudioGlassClip

/**
 * Stage background that is not one of the shipped presets.
 * Lives on the document, not on a clip, so changing it never depends on what is
 * selected — `transparent` exports a black stage (video has no alpha) but keeps
 * the checkerboard in the preview so the user can see there is nothing behind.
 */
export type StudioCustomBackground =
  | { type: 'solid'; color: string }
  | { type: 'transparent' }
  | { type: 'image'; dataUrl: string; fit: 'cover' | 'contain' }

export type StudioDoc = {
  aspect: StudioAspect
  fps: 24 | 30 | 60
  /** Background painted under every clip. */
  backgroundId: string
  /** When set, this wins over `backgroundId`. */
  customBackground?: StudioCustomBackground | null
  clips: StudioClip[]
  trackCount: number
}
