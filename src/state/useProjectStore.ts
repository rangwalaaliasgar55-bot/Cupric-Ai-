import { create } from 'zustand'
import { createJSONStorage, persist, type StateStorage } from 'zustand/middleware'
import type {
  ArenaAsset,
  BriefMessage,
  FootageAsset,
  Project,
  RenderJob,
  SceneRundown,
  TimelineClip,
  View,
  AutomationJob,
  AutomationStep,
  AutomationMode,
  VotingMode,
} from '../types/project'
import { startRender as launchRender, type RenderSource } from '../lib/render'
import { makeSeedProjects } from '../lib/seed'
import { clamp, nowIso, round1, slugify, uid } from '../lib/utils'

export type Toast = { id: string; kind: 'success' | 'info' | 'error'; text: string }

const activeRenderCancels = new Map<string, () => void>()

const desktopAwareStorage: StateStorage = {
  getItem: async (name) => {
    const ipc = (window as any).northframe?.ipc
    if (!ipc) return window.localStorage.getItem(name)
    const value = await ipc.invoke('state:load', { key: name })
    if (typeof value === 'string') {
      try {
        const parsed = JSON.parse(value)
        if (parsed && !parsed.state && Array.isArray(parsed.projects)) return JSON.stringify({ state: parsed, version: 0 })
      } catch {}
      return value
    }
    return value ? JSON.stringify(value) : null
  },
  setItem: (name, value) => {
    const ipc = (window as any).northframe?.ipc
    if (!ipc) {
      window.localStorage.setItem(name, value)
      return
    }
    void ipc.invoke('state:save', { key: name, value })
  },
  removeItem: (name) => {
    const ipc = (window as any).northframe?.ipc
    if (!ipc) {
      window.localStorage.removeItem(name)
      return
    }
    void ipc.invoke('state:clear', { key: name })
  },
}

function renderSourcesForProject(project: Project): RenderSource[] {
  return project.timeline.map((clip) => {
    if (clip.sourceType === 'arena') {
      const asset = project.arenaAssets.find((a) => a.id === clip.sourceId)
      return {
        id: clip.id,
        sourceType: 'arena',
        durationSec: clip.durationSec,
        htmlPath: asset?.localPath ?? null,
        arenaPath: asset?.localPath ?? null,
      }
    }
    const asset = project.footageAssets.find((f) => f.id === clip.sourceId)
    return {
      id: clip.id,
      sourceType: 'footage',
      durationSec: clip.durationSec,
      videoPath: asset?.localPath ?? null,
      footagePath: asset?.localPath ?? null,
      silenceRanges: asset?.silenceRanges ?? [],
      applySilenceCuts: asset?.status === 'edited',
      captionStyle: asset?.captionStyle ?? 'standard',
      crop: asset?.crop ?? '9:16',
    }
  })
}

type AppState = {
  projects: Project[]
  activeProjectId: string | null
  view: View
  theme: 'dark' | 'light'
  askOpen: boolean
  toasts: Toast[]
  automationJobs: AutomationJob[]

  startAutomationJob: (input: { brief: string; footageFolder?: string | null; outputFolder?: string | null; aspect: AutomationJob['aspect']; fps: AutomationJob['fps']; quality: AutomationJob['quality']; mode: AutomationMode; votingMode: VotingMode }) => void
  updateAutomationJob: (jobId: string, patch: Partial<AutomationJob>) => void
  updateAutomationStep: (jobId: string, stepId: string, patch: Partial<AutomationStep>) => void
  cancelAutomationJob: (jobId: string) => void
  resumeAutomationJob: (jobId: string) => void
  approveAutomationStep: (jobId: string, stepId: string) => void
  rejectAutomationStep: (jobId: string, stepId: string) => void

  setView: (v: View) => void
  setTheme: (t: 'dark' | 'light') => void
  toggleTheme: () => void
  setAskOpen: (open: boolean) => void
  pushToast: (kind: Toast['kind'], text: string) => void
  dismissToast: (id: string) => void

  createProject: (name?: string) => string
  duplicateProject: (id: string) => void
  deleteProject: (id: string) => void
  setActiveProject: (id: string) => void
  renameProject: (id: string, name: string) => void

  addBriefMessage: (pid: string, msg: BriefMessage) => void
  patchRundown: (pid: string, patch: Partial<SceneRundown>) => void
  lockRundown: (pid: string) => void

  addArenaAsset: (pid: string, a: Omit<ArenaAsset, 'id' | 'createdAt'>) => string
  updateArenaAsset: (pid: string, id: string, patch: Partial<ArenaAsset>) => void

  addFootageAsset: (pid: string, f: Omit<FootageAsset, 'id'>) => string
  updateFootageAsset: (pid: string, id: string, patch: Partial<FootageAsset>) => void

  addTimelineClip: (pid: string, clip: Omit<TimelineClip, 'id' | 'startSec'>) => void
  removeTimelineClip: (pid: string, clipId: string) => void
  moveTimelineClip: (pid: string, from: number, to: number) => void
  setClipDuration: (pid: string, clipId: string, dur: number) => void

  startRender: (
    pid: string,
    opts: { aspect: RenderJob['aspect']; fps: RenderJob['fps']; quality: RenderJob['quality']; label?: string },
  ) => void
  retryRender: (pid: string, jobId: string) => void
  cancelRender: (pid: string, jobId: string) => void
  updateRenderJob: (pid: string, jobId: string, patch: Partial<RenderJob>) => void
}

/** Sequential single-track layout: startSec is always the cumulative sum. */
function relayout(clips: TimelineClip[]): TimelineClip[] {
  let t = 0
  return clips.map((c) => {
    const start = round1(t)
    t += c.durationSec
    return { ...c, startSec: start }
  })
}

export const useProjectStore = create<AppState>()(
  persist(
    (set, get) => {
      const updateProject = (id: string, fn: (p: Project) => Project) =>
        set((s) => ({
          projects: s.projects.map((p) => (p.id === id ? { ...fn(p), updatedAt: nowIso() } : p)),
        }))

      return {
        projects: makeSeedProjects(),
        activeProjectId: null,
        view: 'home',
        theme: 'dark',
        askOpen: false,
        toasts: [],
        automationJobs: [],
        startAutomationJob: (input) => {
          const projectId = get().activeProjectId || get().createProject()
          const id = uid()
          const labels = ['Create project', 'Generate Gemini rundown', 'Lock rundown', 'Generate candidates', 'Ingest footage', 'Build timeline', 'Render MP4', 'Review report']
          const steps = labels.map((label, i) => ({ id: `${id}-step-${i}`, label, status: i === 0 ? 'running' as const : 'queued' as const, progressPct: 0 }))
          const job: AutomationJob = { ...input, id, projectId, status: 'running', currentStepId: steps[0].id, steps, createdAt: nowIso(), updatedAt: nowIso(), outputPath: null, reviewReportPath: null }
          set((s) => ({ automationJobs: [job, ...s.automationJobs], view: 'auto' }))
          const ipc = (window as any).northframe?.ipc
          if (ipc) void ipc.invoke('automation:start', job)
          else {
            // Browser preview deliberately simulates progress without touching the filesystem.
            steps.forEach((step, i) => setTimeout(() => get().updateAutomationStep(id, step.id, { status: 'done', progressPct: 100, completedAt: nowIso() }), (i + 1) * 700))
            setTimeout(() => get().updateAutomationJob(id, { status: 'done', currentStepId: null }), labels.length * 700 + 100)
          }
        },
        updateAutomationJob: (jobId, patch) => set((s) => ({ automationJobs: s.automationJobs.map((j) => j.id === jobId ? { ...j, ...patch, updatedAt: nowIso() } : j) })),
        updateAutomationStep: (jobId, stepId, patch) => set((s) => ({ automationJobs: s.automationJobs.map((j) => j.id === jobId ? { ...j, steps: j.steps.map((x) => x.id === stepId ? { ...x, ...patch } : x), updatedAt: nowIso() } : j) })),
        cancelAutomationJob: (jobId) => { const ipc = (window as any).northframe?.ipc; if (ipc) void ipc.invoke('automation:cancel', { jobId }); get().updateAutomationJob(jobId, { status: 'cancelled' }) },
        resumeAutomationJob: (jobId) => { const ipc = (window as any).northframe?.ipc; if (ipc) void ipc.invoke('automation:resume', { jobId }); get().updateAutomationJob(jobId, { status: 'running' }) },
        approveAutomationStep: (jobId, stepId) => { const ipc = (window as any).northframe?.ipc; if (ipc) void ipc.invoke('automation:approveStep', { jobId, stepId }) },
        rejectAutomationStep: (jobId, stepId) => { const ipc = (window as any).northframe?.ipc; if (ipc) void ipc.invoke('automation:rejectStep', { jobId, stepId }) },

        setView: (view) => set({ view }),
        setTheme: (theme) => set({ theme }),
        toggleTheme: () => set((s) => ({ theme: s.theme === 'dark' ? 'light' : 'dark' })),
        setAskOpen: (askOpen) => set({ askOpen }),
        pushToast: (kind, text) => {
          const id = uid()
          set((s) => ({ toasts: [...s.toasts.slice(-3), { id, kind, text }] }))
          setTimeout(() => get().dismissToast(id), 4000)
        },
        dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),

        createProject: (name) => {
          const id = uid()
          const project: Project = {
            id,
            name: name?.trim() || 'Untitled project',
            createdAt: nowIso(),
            updatedAt: nowIso(),
            brief: { messages: [], draftRundown: null, lockedRundown: null },
            arenaAssets: [],
            footageAssets: [],
            timeline: [],
            renderJobs: [],
            brandKit: { colors: ['#0B0B10', '#C8F542', '#F4F1EA'], font: 'Inter Variable', logoDataUrl: null },
          }
          set((s) => ({ projects: [...s.projects, project], activeProjectId: id, view: 'brief' }))
          return id
        },
        duplicateProject: (id) => {
          const src = get().projects.find((p) => p.id === id)
          if (!src) return
          const copy: Project = structuredClone(src)
          copy.id = uid()
          copy.name = `${src.name} copy`
          copy.createdAt = nowIso()
          copy.updatedAt = nowIso()
          set((s) => ({ projects: [...s.projects, copy] }))
        },
        deleteProject: (id) =>
          set((s) => ({
            projects: s.projects.filter((p) => p.id !== id),
            activeProjectId: s.activeProjectId === id ? null : s.activeProjectId,
            view: s.activeProjectId === id ? 'home' : s.view,
          })),
        setActiveProject: (activeProjectId) => set({ activeProjectId }),
        renameProject: (id, name) => updateProject(id, (p) => ({ ...p, name: name || 'Untitled project' })),

        addBriefMessage: (pid, msg) =>
          updateProject(pid, (p) => ({ ...p, brief: { ...p.brief, messages: [...p.brief.messages, msg] } })),
        patchRundown: (pid, patch) =>
          updateProject(pid, (p) => ({
            ...p,
            brief: {
              ...p.brief,
              draftRundown: { ...(p.brief.draftRundown ?? {}), ...patch },
            },
          })),
        lockRundown: (pid) => {
          const p = get().projects.find((x) => x.id === pid)
          const draft = p?.brief.draftRundown
          if (!p || !draft?.title || !draft.scenes?.length || !draft.arenaPrompt) return
          updateProject(pid, (proj) => ({
            ...proj,
            brief: { ...proj.brief, lockedRundown: draft as SceneRundown },
          }))
        },

        addArenaAsset: (pid, a) => {
          const id = uid()
          updateProject(pid, (p) => ({
            ...p,
            arenaAssets: [{ ...a, id, createdAt: nowIso() }, ...p.arenaAssets],
          }))
          return id
        },
        updateArenaAsset: (pid, id, patch) =>
          updateProject(pid, (p) => ({
            ...p,
            arenaAssets: p.arenaAssets.map((a) => (a.id === id ? { ...a, ...patch } : a)),
          })),

        addFootageAsset: (pid, f) => {
          const id = uid()
          updateProject(pid, (p) => ({ ...p, footageAssets: [...p.footageAssets, { ...f, id }] }))
          return id
        },
        updateFootageAsset: (pid, id, patch) =>
          updateProject(pid, (p) => ({
            ...p,
            footageAssets: p.footageAssets.map((f) => (f.id === id ? { ...f, ...patch } : f)),
          })),

        addTimelineClip: (pid, clip) =>
          updateProject(pid, (p) => ({
            ...p,
            timeline: relayout([...p.timeline, { ...clip, id: uid(), startSec: 0 }]),
          })),
        removeTimelineClip: (pid, clipId) =>
          updateProject(pid, (p) => ({
            ...p,
            timeline: relayout(p.timeline.filter((c) => c.id !== clipId)),
          })),
        moveTimelineClip: (pid, from, to) =>
          updateProject(pid, (p) => {
            const arr = [...p.timeline]
            const [moved] = arr.splice(from, 1)
            if (!moved) return p
            arr.splice(clamp(to, 0, arr.length), 0, moved)
            return { ...p, timeline: relayout(arr) }
          }),
        setClipDuration: (pid, clipId, dur) =>
          updateProject(pid, (p) => ({
            ...p,
            timeline: relayout(
              p.timeline.map((c) =>
                c.id === clipId ? { ...c, durationSec: round1(clamp(dur, 0.5, 600)) } : c,
              ),
            ),
          })),

        updateRenderJob: (pid, jobId, patch) =>
          updateProject(pid, (p) => ({
            ...p,
            renderJobs: p.renderJobs.map((j) => (j.id === jobId ? { ...j, ...patch } : j)),
          })),

        startRender: (pid, opts) => {
          const p = get().projects.find((x) => x.id === pid)
          if (!p) return
          const base = slugify(opts.label ? opts.label.replace(/\.[^.]+$/, '') : p.name)
          const job: RenderJob = {
            id: uid(),
            aspect: opts.aspect,
            fps: opts.fps,
            quality: opts.quality,
            status: 'rendering',
            progressPct: 0,
            outputName: `${base}-${opts.aspect.replace(':', 'x')}-${opts.quality}.mp4`,
            outputPath: null,
            errorMessage: null,
            createdAt: nowIso(),
          }
          updateProject(pid, (proj) => ({ ...proj, renderJobs: [job, ...proj.renderJobs] }))
          get().pushToast('info', `Render started — ${job.outputName}`)
          const cancel = launchRender(
            { ...job, sources: renderSourcesForProject(p) },
            (pct) => get().updateRenderJob(pid, job.id, { progressPct: pct, status: 'rendering' }),
            (result) => {
              activeRenderCancels.delete(job.id)
              if (result?.error) {
                get().updateRenderJob(pid, job.id, { status: 'error', errorMessage: result.error })
                get().pushToast('error', `Render failed — ${result.error}`)
                return
              }
              get().updateRenderJob(pid, job.id, { progressPct: 100, status: 'done', outputPath: result?.outputPath ?? null, errorMessage: null })
              get().pushToast('success', `Render complete — ${job.outputName}`)
            },
          )
          activeRenderCancels.set(job.id, cancel)
        },

        retryRender: (pid, jobId) => {
          const p = get().projects.find((x) => x.id === pid)
          const job = p?.renderJobs.find((j) => j.id === jobId)
          if (!p || !job) return
          get().updateRenderJob(pid, jobId, { status: 'rendering', progressPct: 0, errorMessage: null })
          get().pushToast('info', `Retry started — ${job.outputName}`)
          const cancel = launchRender(
            { ...job, sources: renderSourcesForProject(p) },
            (pct) => get().updateRenderJob(pid, jobId, { progressPct: pct, status: 'rendering' }),
            (result) => {
              activeRenderCancels.delete(jobId)
              if (result?.error) {
                get().updateRenderJob(pid, jobId, { status: 'error', errorMessage: result.error })
                get().pushToast('error', `Render failed — ${result.error}`)
                return
              }
              get().updateRenderJob(pid, jobId, { progressPct: 100, status: 'done', outputPath: result?.outputPath ?? null, errorMessage: null })
              get().pushToast('success', `Render complete — ${job.outputName}`)
            },
          )
          activeRenderCancels.set(jobId, cancel)
        },

        cancelRender: (pid, jobId) => {
          activeRenderCancels.get(jobId)?.()
          activeRenderCancels.delete(jobId)
          get().updateRenderJob(pid, jobId, { status: 'error', errorMessage: 'Render cancelled' })
          get().pushToast('info', 'Render cancelled')
        },
      }
    },
    {
      name: 'northframe-v1',
      storage: createJSONStorage(() => desktopAwareStorage),
      partialize: (s) => ({
        projects: s.projects,
        activeProjectId: s.activeProjectId,
        view: s.view,
        theme: s.theme,
        automationJobs: s.automationJobs,
      }),
    },
  ),
)

/** Convenience selector — the active project or null. */
export const useActiveProject = (): Project | null =>
  useProjectStore((s) => s.projects.find((p) => p.id === s.activeProjectId) ?? null)
