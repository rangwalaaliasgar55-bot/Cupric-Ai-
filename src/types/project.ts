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
  /** Deterministic Remotion capability selection used by the autonomous plan. */
  remotionPlan?: {
    template: string
    font: string
    skills: string[]
    rationale: string
    render: { aspect: '16:9' | '9:16' | '1:1'; fps: 30 | 60; deterministic: true; noRemoteAssets: true }
  }
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

/**
 * One stage of the colour grade.
 *
 * Three nodes, in a fixed order, because that is the order a colourist works
 * in: balance the image, set the contrast, then put a look on top. Every
 * parameter is -100..100 with 0 meaning "do nothing", so a node that has never
 * been touched costs nothing and can be skipped entirely.
 */
export type StudioGradeNode =
  | { id: 'balance'; enabled: boolean; exposure: number; temperature: number }
  | { id: 'contrast'; enabled: boolean; contrast: number; fade: number }
  | { id: 'look'; enabled: boolean; saturation: number; hue: number }

/**
 * Per-clip matte.
 *
 * `rect` and `ellipse` are drawn here. `luma` keys on brightness. `matte` uses
 * an image the user supplies — that is the object-aware path, because nothing
 * in this app segments a subject on its own: a matte rendered by an external
 * tool (or by the automation pipeline) is imported and used as the alpha.
 */
export type StudioMask = {
  shape: 'rect' | 'ellipse' | 'luma' | 'matte'
  /** Normalised geometry for the shape masks. */
  x: number
  y: number
  w: number
  h: number
  /** Edge softness as a percentage of the smaller frame dimension. */
  featherPct: number
  invert: boolean
  /** Luma key: the brightness that becomes opaque, and how soft the ramp is. */
  threshold: number
  softness: number
  /** Greyscale or alpha image used as the matte, for `shape: 'matte'`. */
  matteDataUrl?: string | null
}

/**
 * One keyframe on a clip's own timeline.
 *
 * `at` is seconds from the clip's start, not from the document — so moving or
 * trimming a clip carries its animation with it. Only the properties present
 * are animated; anything omitted keeps the clip's static value.
 */
export type StudioKeyframe = {
  at: number
  x?: number
  y?: number
  scale?: number
  rotation?: number
  opacity?: number
  /** Easing from this keyframe to the next. */
  ease: 'linear' | 'ease-in' | 'ease-out' | 'ease-in-out'
}

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
  /** Degrees clockwise about the clip's own centre. Absent means 0. */
  rotation?: number
  /** Up to three grade nodes, applied in array order. Absent means ungraded. */
  grade?: StudioGradeNode[] | null
  /** Absent means the clip fills its own bounds with no matte. */
  mask?: StudioMask | null
  /** Property animation, sorted by `at`. Absent means the clip is static. */
  keyframes?: StudioKeyframe[] | null
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
  /** Normalised centre and scale. Optional for backwards-compatible projects. */
  x?: number
  y?: number
  scale?: number
  posterDataUrl?: string | null
}

export type StudioTextClip = StudioClipCommon & {
  kind: 'text'
  text: string
  fontSizePct: number
  /** Bundled font family used identically by preview and export. */
  fontFamily?: string
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
  /** Still fallback (data URL) of a UI Lab demo or imported image. */
  dataUrl: string
  /** Optional pre-rendered deterministic animation frames from a React demo. */
  frames?: string[]
  frameFps?: number
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

/**
 * A Lottie sticker.
 *
 * The animation is played by frame number, never by wall clock, so the frame
 * shown at time `t` is the same in the preview, in a re-scrub, and in the
 * export — the same rule the rest of the renderer follows.
 */
export type StudioStickerClip = StudioClipCommon & {
  kind: 'sticker'
  /** Built-in sticker id, or 'custom' when `json` carries an imported file. */
  stickerId: string
  json?: string | null
  /** Normalised centre. */
  x: number
  y: number
  /** 1 = the sticker's natural size against the shorter frame edge. */
  scale: number
  loop: boolean
  /** Playback rate through the Lottie timeline. */
  speed: number
}

export type StudioClip =
  | StudioMediaClip
  | StudioAudioClip
  | StudioTextClip
  | StudioBackgroundClip
  | StudioOverlayClip
  | StudioGlassClip
  | StudioStickerClip

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
