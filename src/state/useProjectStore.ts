import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type {
  ArenaAsset,
  BriefMessage,
  FootageAsset,
  Project,
  RenderJob,
  SceneRundown,
  TimelineClip,
  View,
} from '../types/project'
import { startRender } from '../lib/render'
import { makeSeedProjects } from '../lib/seed'
import { clamp, nowIso, round1, slugify, uid } from '../lib/utils'

export type Toast = { id: string; kind: 'success' | 'info' | 'error'; text: string }

type AppState = {
  projects: Project[]
  activeProjectId: string | null
  view: View
  theme: 'dark' | 'light'
  askOpen: boolean
  toasts: Toast[]

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
            createdAt: nowIso(),
          }
          updateProject(pid, (proj) => ({ ...proj, renderJobs: [job, ...proj.renderJobs] }))
          get().pushToast('info', `Render started — ${job.outputName}`)
          startRender({ ...job, sources: p.timeline.map((c) => ({ ...c, arenaPath: p.arenaAssets.find((a) => a.id === c.sourceId)?.localPath, footagePath: p.footageAssets.find((f) => f.id === c.sourceId)?.localPath })) },
            (pct) => get().updateRenderJob(pid, job.id, { progressPct: pct, status: 'rendering' }),
            (result) => {
              get().updateRenderJob(pid, job.id, { progressPct: 100, status: 'done', outputPath: result?.outputPath })
              get().pushToast('success', `Render complete — ${job.outputName}`)
            },
          )
        },

        retryRender: (pid, jobId) => {
          const p = get().projects.find((x) => x.id === pid)
          const job = p?.renderJobs.find((j) => j.id === jobId)
          if (!p || !job) return
          get().updateRenderJob(pid, jobId, { status: 'rendering', progressPct: 0 })
          get().pushToast('info', `Retry started — ${job.outputName}`)
          startRender({ ...job, sources: p.timeline },
            (pct) => get().updateRenderJob(pid, jobId, { progressPct: pct, status: 'rendering' }),
            () => {
              get().updateRenderJob(pid, jobId, { progressPct: 100, status: 'done' })
              get().pushToast('success', `Render complete — ${job.outputName}`)
            },
          )
        },
      }
    },
    {
      name: 'northframe-studio-v1',
      partialize: (s) => ({
        projects: s.projects,
        activeProjectId: s.activeProjectId,
        view: s.view,
        theme: s.theme,
      }),
    },
  ),
)

/** Convenience selector — the active project or null. */
export const useActiveProject = (): Project | null =>
  useProjectStore((s) => s.projects.find((p) => p.id === s.activeProjectId) ?? null)
