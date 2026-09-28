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
  /** Mechanical post-render QA; this is never a fabricated visual-quality claim. */
  renderEvaluation?: {
    valid: boolean
    retryable?: boolean
    score: number
    checks: { id: string; ok: boolean; detail: string; fatal?: boolean }[]
    durationSec?: number
    size?: [number, number] | null
    hasAudio?: boolean
  } | null
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
  | 'motion'
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
  status: 'queued' | 'working' | 'paused' | 'rendering' | 'done' | 'error'
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
  /** Autonomous production session (lib/production). Normalised on read. */
  production?: unknown
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

export type StudioAspect = '16:9' | '9:16' | '1:1' | '4:5'
/** Export size by short side: 720p … 2160p (Ultra HD). */
export type StudioResolution = '720p' | '1080p' | '1440p' | '2160p'
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
  /** 2.18 — per-word kinetic run: each word lands on its own beat. */
  | 'kinetic'
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
   * 2.3 — colour wheels. Lift/gamma/gain per channel, each -100..100. Needs
   * the pixels, so a clip with this node takes the scratch-layer path.
   */
  | { id: 'wheels'; enabled: boolean; lift: [number, number, number]; gamma: [number, number, number]; gain: [number, number, number] }

/** 2.3 — a parsed .cube 3D LUT (size ≤ 33), applied after the grade. */
export type StudioLut = { name: string; size: number; /** size³ × RGB, 0–1, red fastest. */ data: number[]; strength: number }

/** 2.6 — how a clip composites onto what is below it. */
export type StudioBlendMode = 'normal' | 'multiply' | 'screen' | 'overlay' | 'darken' | 'lighten' | 'color-dodge' | 'soft-light' | 'difference' | 'add'

/** 2.15 — device frame drawn around a media/overlay clip. */
export type StudioDevice = 'none' | 'phone' | 'laptop' | 'browser'

/** Phone Studio — animated phone mockup with an editable, animated screen. */
export type StudioPhoneMotion = 'none' | 'float' | 'tilt-in' | 'spin-reveal' | 'rise' | 'hero-zoom' | 'swing'
export type StudioPhoneApp =
  | { kind: 'product'; title: string; subtitle: string; price: string; cta: string; badge: string; rating: number | null; accent: string }
  | { kind: 'lockscreen'; time: string; date: string; notifications: Array<{ app: string; title: string; body: string }> }
  | { kind: 'social'; handle: string; caption: string; likes: string; accent: string }
  | { kind: 'browser'; url: string; title: string; subtitle: string; cta: string; accent: string }
export type StudioPhoneFormFactor = 'single' | 'duo'
export type StudioDuoFoldMotion = 'open' | 'fold-in' | 'fold-out' | 'peek'
export type StudioDuoScreenMode = 'wide' | 'mirror' | 'outer-right'
export type StudioPhoneStyle = {
  frameColor: string
  island: 'island' | 'notch' | 'none'
  buttons: boolean
  glare: boolean
  motion: StudioPhoneMotion
  /** Tall screenshots scroll top → bottom across the clip. */
  scroll: boolean
  /** Animated app UI drawn on the screen over the clip's media. */
  app: StudioPhoneApp | null
  /** Optional foldable form factor; absent means the original single phone. */
  formFactor?: StudioPhoneFormFactor
  /** Deterministic fold choreography for the two-panel iPhone Duo-style mockup. */
  duoFold?: StudioDuoFoldMotion
  /** How source media/copy is projected onto the two panels. */
  duoScreen?: StudioDuoScreenMode
  /** 0–1 perspective/depth exaggeration, kept editable and bounded by the UI. */
  duoDepth?: number
  /** Accent used for the hinge and fold highlight; defaults to frameColor. */
  duoHingeColor?: string
}

/** 2.7 — a named point on the timeline. */
export type StudioMarker = { id: string; at: number; label: string; color: 'lime' | 'info' | 'danger' }

/**
 * Per-clip matte.
 *
 * `rect` and `ellipse` are drawn here. `luma` keys on brightness. `matte` uses
 * an image the user supplies — that is the object-aware path, because nothing
 * in this app segments a subject on its own: a matte rendered by an external
 * tool (or by the automation pipeline) is imported and used as the alpha.
 */
export type StudioMask = {
  shape: 'rect' | 'ellipse' | 'luma' | 'matte' | 'chroma'
  /** 2.6 — chroma key: colour to remove (threshold = tolerance, softness = edge). */
  keyColor?: string
  /** 2.6 — pull the key colour's spill out of the edges (0–1). */
  spill?: number
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
  /**
   * Object tracking: the box centre (and size, if it scaled) at clip-local
   * times, produced by "Track subject". When present the rect/ellipse follows it.
   */
  track?: StudioMaskTrackPoint[] | null
}

export type StudioMaskTrackPoint = { at: number; x: number; y: number; w?: number; h?: number; confidence?: number }

/**
 * One keyframe on a clip's own timeline.
 *
 * `at` is seconds from the clip's start, not from the document — so moving or
 * trimming a clip carries its animation with it. Only the properties present
 * are animated; anything omitted keeps the clip's static value.
 */
export type StudioEase =
  | 'linear'
  | 'ease-in'
  | 'ease-out'
  | 'ease-in-out'
  | 'back-out'
  | 'back-in'
  | 'expo-out'
  | 'expo-in-out'
  | 'elastic-out'
  | 'hold'
  /** 2.2 — custom curve from the curve editor; control points in `bezier`. */
  | 'bezier'
  /**
   * Real damped springs, evaluated in closed form so they stay a pure
   * function of t. Unlike `back-out` (a polynomial imitating a bounce) these
   * overshoot, ring down and settle the way physical motion does.
   */
  | 'spring-slam'
  | 'spring-land'
  | 'spring-punch'
  | 'spring-glide'

export type StudioKeyframe = {
  at: number
  x?: number
  y?: number
  scale?: number
  rotation?: number
  opacity?: number
  /** 3D tilt / turn in degrees (see StudioClipCommon). */
  tiltX?: number
  turnY?: number
  /** Focus: gaussian blur in px at 1080p (0 = sharp). */
  blur?: number
  /** Bloom / glow intensity 0–1 (brightness lift + soft halo). */
  glow?: number
  /** Colour drift: hue rotation in degrees. */
  hue?: number
  /** Easing from this keyframe to the next. */
  /**
   * How the value travels to the NEXT keyframe. The expressive eases are what
   * make motion read as designed rather than mechanical: `back-out` overshoots
   * and settles, `expo-out` snaps then glides, `elastic-out` springs, and
   * `hold` jumps at the next key (a step / freeze).
   */
  ease: StudioEase
  /** 2.2 — CSS-style cubic-bezier control points (x1, y1, x2, y2) for ease 'bezier'. */
  bezier?: [number, number, number, number]
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
  /** 3D: tilt about the horizontal axis in degrees (top away = positive). */
  tiltX?: number
  /** 3D: turn about the vertical axis in degrees (right side away = positive). */
  turnY?: number
  /** 3D camera distance in px at 1080p (smaller = stronger perspective). Default 1600. */
  perspective?: number
  /** Up to three grade nodes, applied in array order. Absent means ungraded. */
  grade?: StudioGradeNode[] | null
  /** Absent means the clip fills its own bounds with no matte. */
  mask?: StudioMask | null
  /** Property animation, sorted by `at`. Absent means the clip is static. */
  keyframes?: StudioKeyframe[] | null
  /** Clips sharing a groupId move together. Absent means ungrouped. */
  groupId?: string
  /** 2.6 — absent means normal. */
  blendMode?: StudioBlendMode
  /** 2.3 — absent means no LUT. */
  lut?: StudioLut | null
  /** Locked clips cannot be moved, trimmed or deleted until unlocked. */
  locked?: boolean
  /** Hidden clips stay on the timeline but are not drawn or heard. */
  hidden?: boolean
  /** Muted clips are drawn but silent. */
  muted?: boolean
  /** Mirror about the clip's own centre. */
  flipX?: boolean
  flipY?: boolean
}

/** A transcribed word in SOURCE-file seconds (survives trims and splits). */
export type StudioWord = { word: string; start: number; end: number }

export type StudioMediaClip = StudioClipCommon & {
  kind: 'video' | 'image'
  /** Transcript words with timing (auto-captions); drives speech tightening. */
  words?: StudioWord[] | null
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
  /** 2.15 — device mockup frame. */
  device?: StudioDevice
  /** Phone Studio settings (used when device is 'phone'). */
  phone?: StudioPhoneStyle | null
  /**
   * 2.21 — before/after. This clip is the AFTER; `beforeMediaId` is drawn on
   * the left of a divider. Both images come from the user — never generated.
   */
  compare?: { beforeMediaId: string; beforeFileName: string; mode: 'sweep' | 'static'; position: number } | null
  /** 2.16 — the parametric product-photo preset that wrote this clip's keyframes. */
  motionPreset?: string | null
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
  /**
   * JOB 13 — highlight a PHRASE, not just one word. Comma-separated, e.g.
   * `"six weeks, no gym"`. Matched literally against the clip's own words;
   * a phrase that is not present simply does not highlight anything.
   */
  highlightRuns?: string | null
  /** Colour the run, or draw a filled chip behind it. Default `color`. */
  highlightStyle?: 'color' | 'chip'
  /** Rich markup colours: *emphasis* (serif italic), ==highlight box==, {accent}, ^big^. */
  emphasisColor?: string
  emphasisFont?: string
  boxColor?: string
  accentColor?: string
  /** Soft glow behind the glyphs (0–1), like creator hook titles. */
  textGlow?: number
  /**
   * Text legibility (2.14). `auto` (default) paints a soft scrim only when the
   * pixels under the text are low-contrast or busy; `on` always; `off` never.
   */
  legibility?: 'auto' | 'on' | 'off'
  /** Scrim opacity 0–1 (default 0.55). */
  scrimStrength?: number
}

export type StudioBackgroundClip = StudioClipCommon & {
  kind: 'background'
  backgroundId: string
}

/** A full-frame, non-destructive grade applied to clips below this timeline layer. */
export type StudioAdjustmentClip = StudioClipCommon & {
  kind: 'adjustment'
  grade: StudioGradeNode[]
}

/**
 * A UI component (src/lab/components) living on the timeline. The Studio
 * records its real React animation into `frames`; these settings say how, so
 * the clip can be re-recorded at any time — by the user or by the agent.
 */
export type StudioComponentMeta = {
  slug: string
  /** pending → queued for the Studio recorder; ready → frames recorded. */
  status: 'pending' | 'recording' | 'ready' | 'failed'
  /** Seconds of motion to record (the clip loops it when longer). */
  recordSec: number
  /** Act the component out (hover, pointer path, clicks) while recording. */
  interact: boolean
  /** Props for props-driven components (framecn text, colours, sizes). Changing them re-records. */
  props?: Record<string, string | number | boolean>
  error?: string
  /** JOB 4 — an animation the agent wrote; validated code travels with the clip (undo, re-record). */
  generated?: { source: 'agent-generated'; name: string; kind: string; code: string; ease: string; /** Record the agent's reduced-motion (opacity-only) path. */ calm?: boolean }
}

export type StudioOverlayClip = StudioClipCommon & {
  kind: 'overlay'
  /** Still fallback (data URL) of a UI Lab demo or imported image. */
  dataUrl: string
  /** Optional pre-rendered deterministic animation frames from a React demo. */
  frames?: string[]
  frameFps?: number
  /** Playback speed of the frame strip (1 = as recorded). */
  playbackRate?: number
  /** Loop the frame strip when the clip is longer than it (default true). */
  loop?: boolean
  /** Set when this overlay is a recorded UI component. */
  component?: StudioComponentMeta
  source: string
  x: number
  y: number
  scale: number
  /** 2.15 — device mockup frame. */
  device?: StudioDevice
  /** Phone Studio settings (used when device is 'phone'). */
  phone?: StudioPhoneStyle | null
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
  /** Transcript words with timing, in source seconds. */
  words?: StudioWord[] | null
  /** Detected beats in SOURCE seconds + tempo (Analyse beats). */
  beats?: { bpm: number; times: number[] } | null
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
  /** 2.4 — music ducks under voice when doc ducking is on. Absent = music. */
  role?: 'music' | 'voice' | 'sfx'
  /** 2.4 — cached waveform peaks (0–1), ~100 per second, for the timeline. */
  peaks?: number[] | null
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
  | StudioAdjustmentClip
  | StudioOverlayClip
  | StudioGlassClip
  | StudioStickerClip
  | StudioSequenceClip
  | StudioShapeClip
  | StudioCursorClip
  | StudioLoaderClip
  | StudioKitClip

/**
 * Home_X video kit (lib/studio/homeKit.ts): nine native, parametric pieces
 * drawn by the shared renderer. Every motion is a pure function of the clip's
 * local time and `seed`, so preview and export match frame for frame.
 */
export type StudioKitKind = 'cursor-zoom' | 'pill-text' | 'stat-card' | 'rating-bars' | 'image-stack' | 'browser-mockup' | 'checkout-card' | 'block-row-3d' | 'kinetic-headline'

/** One word of a kinetic headline: its own colour (accent id), weight and entrance delay. */
export type StudioKitWord = {
  text: string
  /** KIT_ACCENTS id, or 'text' for the surface text colour. */
  color?: string
  weight?: 400 | 500 | 600 | 700 | 800
  /** Seconds after the clip starts that this word enters. */
  delay?: number
  style?: 'plain' | 'keyword' | 'chip' | 'glow'
}

/** A user-supplied photo slot. `null` stays a visible "drop media here" slot. */
export type StudioKitMedia = { mediaId: string; fileName: string } | null

export type StudioKitClip = StudioClipCommon & {
  kind: 'kit'
  kit: StudioKitKind
  /**
   * Per-kind look: browser-mockup 'agent' | 'saas' | 'composer';
   * pill-text 'inline' | 'checklist' | 'chips'; stat-card 'stat' | 'price';
   * image-stack 'stack' | 'single' | 'landscape'. Unknown → the kind's default.
   */
  variant?: string
  /** Centre (normalised) and width as a fraction of frame width. */
  x: number
  y: number
  w: number
  /** mulberry32 seed for layout jitter (image-stack rotation, float drift). */
  seed: number
  /** Opacity-only rendering (prefers-reduced-motion export). */
  reducedMotion: boolean
  /** Scrim behind text drawn over photos: null = auto (on when a photo is under text), 0–1 = manual strength. */
  scrim: number | null
  /** Surface theme of UI mockups. */
  theme: 'light' | 'dark'
  /** Accent token value (DESIGN.md video palette). */
  accent: string
  title?: string
  subtitle?: string
  eyebrow?: string
  url?: string
  items?: string[]
  values?: number[]
  media?: StudioKitMedia[]
  /** Highlighted item (active chip, active stat card, active checklist line). */
  active?: number
  /** cursor-zoom: start point (normalised frame) and click moment (0–1 of the clip). */
  fromX?: number
  fromY?: number
  clickAt?: number
  /** Cursor pack v2 — which pointer the cursor-zoom rig draws. Default 'arrow'. */
  cursor?: 'arrow' | 'hand' | 'finger' | 'text' | 'crosshair' | 'grab' | 'zoom' | 'dot'
  /** kinetic-headline: per-word runs. Missing → derived from `title` ([keyword] {chip} *glow*). */
  words?: StudioKitWord[]
  /** block-row-3d: render with real Three.js when available (falls back to the 2.5D canvas draw). */
  real3d?: boolean
}

export type StudioLoaderVariant = 'scan' | 'twinkle' | 'orbit' | 'pulse'
export type StudioLoaderEase = 'ease-in-out' | 'ease' | 'ease-out' | 'ease-in' | 'linear' | 'soft'

/**
 * Transitions.dev loaders rebuilt natively (lib/studio/loaders.ts): "thinking
 * states" (rotating status copy with a shimmer) and the 4×4 "matrix" dot
 * loader. Every CSS timing is a prop; drawing is a pure function of time.
 */
export type StudioLoaderClip = StudioClipCommon & {
  kind: 'loader'
  loader: 'thinking' | 'matrix'
  /** Library preset this clip came from (informational). */
  presetId?: string
  x: number
  y: number
  /** thinking: font height / frame height. matrix: cell side / frame height. */
  size: number
  states: string[]
  holdMs: number
  swapMs: number
  gapMs: number
  distancePx: number
  blurPx: number
  shimmerMs: number
  shimmer: boolean
  baseColor: string
  highlightColor: string
  activeColor: string
  ease: StudioLoaderEase
  variant: StudioLoaderVariant
  rounded: boolean
  cycleMs: number
  /** Playback-rate multiplier on every timing. */
  speed: number
  loop: boolean
  /** Export the reduced-motion (static) rendering. */
  reducedMotion: boolean
  /** Accessible name (matrix) — also used in captions/credits. */
  label: string
  /** Paint the app background under the loader (full-screen beat). */
  backdrop: boolean
}

export type StudioShapeAnim = 'none' | 'draw-on' | 'pop' | 'grow' | 'spin-in' | 'pulse' | 'wiggle' | 'draw-then-fill'

/** Vector shape drawn natively (crisp at any size); see lib/studio/shapes.ts. */
export type StudioShapeClip = StudioClipCommon & {
  kind: 'shape'
  shape: string
  x: number
  y: number
  /** Width as a fraction of frame width; height = w × aspect (in px terms). */
  w: number
  aspect: number
  fill: string | null
  stroke: string | null
  /** Stroke width in px at 1080p. */
  strokeWidth: number
  anim: StudioShapeAnim
  /** Regular polygon sides / star points when the shape takes them. */
  sides?: number
  /** Corner radius 0–0.5 of the short side (rects, pills, badges). */
  radius?: number
  /** Soft glow 0–1. */
  glow?: number
  /** Optional text inside (badges, bubbles, buttons). */
  label?: string
  labelColor?: string
}

export type StudioCursorStyle = 'auto' | 'arrow' | 'hand' | 'dot' | 'ring' | 'touch' | 'ibeam'

/**
 * Animated cursor: glides from `from` to the target and clicks there. When
 * `targetClipId` is set the target reacts (press-in) on each click.
 */
export type StudioCursorClip = StudioClipCommon & {
  kind: 'cursor'
  style: StudioCursorStyle
  /** Target point (normalised). */
  x: number
  y: number
  fromX: number
  fromY: number
  /** Click moments as fractions of the clip (0–1). */
  clicks: number[]
  action: 'click' | 'double-click' | 'hover' | 'drag'
  /** Drag end point for action 'drag'. */
  toX?: number
  toY?: number
  /** Size multiplier (1 = 3.2% of frame height). */
  size: number
  color: string
  rippleColor: string
  targetClipId?: string | null
  /** Multi-stop journey: click k happens at stops[min(k, stops.length-1)] (default: the single x/y target). */
  stops?: Array<{ x: number; y: number }>
  /** Motion-blur trail while moving fast (default on). */
  trail?: boolean
}

/**
 * Nested sequence: a saved scene (another complete edit) placed as ONE clip.
 * It stays a single, movable, trimmable block on the timeline; preview and
 * export flatten it in the shared output pass (resolveForOutput), so its
 * video, audio, text and effects play exactly as in the original edit.
 */
export type StudioSequenceClip = StudioClipCommon & {
  kind: 'sequence'
  sceneId: string
  /** Seconds into the nested edit where this clip starts playing. */
  trimInSec: number
  /** Placement of the nested frame (0.5/0.5/1 = full frame). */
  x: number
  y: number
  scale: number
}

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
  /**
   * Recorded components waiting to be placed (2.13 — record now, place later).
   * Not on the timeline, never rendered; Place copies one to the playhead.
   */
  shelf?: StudioOverlayClip[]
  /** 2.7 — timeline markers (M). Snap targets; never rendered. */
  markers?: StudioMarker[]
  /** Colour tokens imported with a source project (or set by the user). */
  palette?: Array<{ name: string; color: string }>
  /** 2.4 — auto-duck music under voice clips. */
  ducking?: { enabled: boolean; amountDb: number; fadeSec: number } | null
  /** 2.4 — loudness target for export normalisation (LUFS, e.g. -14). null = off. */
  loudnessTarget?: number | null
  /** Part 4 — licence + attribution of anything imported from a link. */
  credits?: Array<{ url: string; source: string; sourceLicense: string | null; attribution: string | null }>
  /** Export resolution (short side). Default 1080p. */
  resolution?: StudioResolution
  /** Dynamic-content variables: `{{name}}` in any text resolves to `value`. */
  variables?: Array<{ name: string; value: string }>
  /** Named scenes saved inside the project (whole-doc snapshots, minus scenes). */
  scenes?: Array<{ id: string; name: string; savedAt: string; doc: Omit<StudioDoc, 'scenes'> }>
}
