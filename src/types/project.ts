export type AutomationMode = 'guided' | 'auto-draft' | 'auto-final'
export type VotingMode = 'manual-arena' | 'official-arena-api' | 'local-scoring'
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
      className: string
    }
