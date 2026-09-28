import type { Project, View } from '../types/project'

export type StartStep = { id: string; label: string; hint: string; view: View; done: boolean }

/** Pure: each step is derived from real project state — nothing is ticked by hand. */
export function gettingStartedSteps(p: Project | null | undefined): StartStep[] {
  const clips = p?.studio?.clips?.length ?? 0
  return [
    { id: 'brief', label: 'Describe the idea', hint: 'Chat in the Brief', view: 'brief', done: !!p && p.brief.messages.some((m) => m.role === 'user') },
    { id: 'lock', label: 'Lock a rundown', hint: 'Lock the draft rundown', view: 'brief', done: !!p?.brief.lockedRundown },
    { id: 'media', label: 'Add footage or assets', hint: 'Upload in Footage', view: 'footage', done: !!p && p.footageAssets.length + p.arenaAssets.length > 0 },
    { id: 'edit', label: 'Build an edit in Studio', hint: 'Put clips on the timeline', view: 'studio', done: clips > 0 },
    { id: 'render', label: 'Export a video', hint: 'Finish a render', view: 'render', done: !!p && p.renderJobs.some((j) => j.status === 'done') },
  ]
}

export function progressOf(steps: StartStep[]): { done: number; total: number } {
  return { done: steps.filter((s) => s.done).length, total: steps.length }
}
