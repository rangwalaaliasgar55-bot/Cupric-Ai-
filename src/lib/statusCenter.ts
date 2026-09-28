/**
 * Status centre: every background job in one list (Auto pipeline runs and
 * Studio render jobs across projects). Pure, so it can be tested without the
 * store. The newest active jobs come first.
 */
import type { AutomationJob, Project } from '../types/project'

export type StatusItem = {
  id: string
  kind: 'automation' | 'render'
  title: string
  detail: string
  pct: number
  state: 'active' | 'waiting' | 'done' | 'error' | 'cancelled'
  projectId: string
  at: string
}

const autoState = (s: AutomationJob['status']): StatusItem['state'] =>
  s === 'running' || s === 'queued' ? 'active' : s === 'waiting-for-user' ? 'waiting' : s === 'done' ? 'done' : s === 'error' ? 'error' : 'cancelled'

export function collectStatus(jobs: AutomationJob[], projects: Pick<Project, 'id' | 'name' | 'renderJobs'>[]): StatusItem[] {
  const items: StatusItem[] = []
  for (const j of jobs) {
    const done = j.steps.filter((s) => s.status === 'done').length
    const cur = j.steps.find((s) => s.id === j.currentStepId) ?? j.steps.find((s) => s.status === 'running' || s.status === 'waiting-for-user')
    const pct = j.steps.length ? Math.round(((done + (cur && cur.status !== 'done' ? (cur.progressPct || 0) / 100 : 0)) / j.steps.length) * 100) : 0
    items.push({
      id: j.id, kind: 'automation', title: `Auto: ${j.brief.slice(0, 48) || 'untitled'}`,
      detail: j.status === 'waiting-for-user' ? 'Waiting for your review' : cur ? `${cur.label}${cur.message ? `: ${cur.message}` : ''}` : j.status,
      pct: j.status === 'done' ? 100 : pct, state: autoState(j.status), projectId: j.projectId, at: j.updatedAt,
    })
  }
  for (const p of projects) {
    for (const r of p.renderJobs ?? []) {
      const state: StatusItem['state'] = r.status === 'done' ? 'done' : r.status === 'error' ? 'error' : r.status === 'paused' ? 'waiting' : 'active'
      items.push({ id: r.id, kind: 'render', title: `Render ${r.aspect} ${r.fps}fps · ${p.name}`, detail: r.status === 'error' ? r.errorMessage ?? 'Failed' : r.outputName ?? r.status, pct: r.status === 'done' ? 100 : Math.round(r.progressPct || 0), state, projectId: p.id, at: r.createdAt })
    }
  }
  const rank = { active: 0, waiting: 1, error: 2, done: 3, cancelled: 4 }
  return items.sort((a, b) => rank[a.state] - rank[b.state] || b.at.localeCompare(a.at))
}

export const activeCount = (items: StatusItem[]) => items.filter((i) => i.state === 'active' || i.state === 'waiting').length
