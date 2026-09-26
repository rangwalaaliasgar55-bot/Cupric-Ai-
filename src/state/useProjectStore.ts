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
  StudioClip,
  StudioDoc,
} from '../types/project'
import { getIpc } from '../lib/bridge'
import { planWithRemotionCapabilities } from '../lib/remotionResources'
import { startRender as launchRender, type RenderSource } from '../lib/render'
import { makeSeedProjects } from '../lib/seed'
import { emptyStudioDoc, normaliseClip, splitClipAt, studioOf } from '../lib/studio/doc'
import { clamp, nowIso, round1, slugify, uid } from '../lib/utils'

export type Toast = { id: string; kind: 'success' | 'info' | 'error'; text: string }

const activeRenderCancels = new Map<string, () => void>()

function downloadBrowserRender(result: { outputPath?: string; outputName?: string } | undefined) {
  if (!result?.outputPath || !/^(blob|data):/i.test(result.outputPath)) return
  const a = document.createElement('a')
  a.href = result.outputPath
  a.download = result.outputName || 'cupric-render.webm'
  document.body.appendChild(a)
  a.click()
  a.remove()
}

const desktopAwareStorage: StateStorage = {
  getItem: async (name) => {
    const ipc = getIpc()
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
    const ipc = getIpc()
    if (!ipc) {
      window.localStorage.setItem(name, value)
      return
    }
    void ipc.invoke('state:save', { key: name, value })
  },
  removeItem: (name) => {
    const ipc = getIpc()
    if (!ipc) {
      window.localStorage.removeItem(name)
      return
    }
    void ipc.invoke('state:clear', { key: name })
  },
}

function renderSourcesForProject(project: Project): RenderSource[] {
  if (project.timeline.length === 0 && project.brief.lockedRundown) {
    const rundown = project.brief.lockedRundown
    return [{
      id: `${project.id}-rundown`,
      label: rundown.title || project.name,
      sourceType: 'rundown',
      durationSec: rundown.durationSec,
      rundown,
    }]
  }
  return project.timeline.map((clip) => {
    if (clip.sourceType === 'arena') {
      const asset = project.arenaAssets.find((a) => a.id === clip.sourceId)
      return {
        id: clip.id,
        label: asset?.name ?? 'Arena asset',
        sourceType: 'arena',
        durationSec: clip.durationSec,
        htmlPath: asset?.localPath ?? null,
        arenaPath: asset?.localPath ?? null,
      }
    }
    const asset = project.footageAssets.find((f) => f.id === clip.sourceId)
    return {
      id: clip.id,
      label: asset?.name ?? 'Footage clip',
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
  /** Undo stack. Never persisted — history dies with the session, by design. */
  past: HistoryEntry[]
  future: HistoryEntry[]

  undo: () => void
  redo: () => void

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

  addTimelineClip: (pid: string, clip: Omit<TimelineClip, 'id' | 'startSec'>, insertIndex?: number) => void
  removeTimelineClip: (pid: string, clipId: string) => void
  moveTimelineClip: (pid: string, from: number, to: number) => void
  setClipDuration: (pid: string, clipId: string, dur: number) => void

  /* Studio — the in-app editor */
  patchStudio: (pid: string, patch: Partial<StudioDoc>) => void
  addStudioClip: (pid: string, clip: StudioClip) => void
  updateStudioClip: (pid: string, clipId: string, patch: Partial<StudioClip>) => void
  removeStudioClip: (pid: string, clipId: string) => void
  splitStudioClip: (pid: string, clipId: string, atSec: number) => void
  duplicateStudioClip: (pid: string, clipId: string) => void
  addStudioTrack: (pid: string) => void

  startRender: (
    pid: string,
    opts: { aspect: RenderJob['aspect']; fps: RenderJob['fps']; quality: RenderJob['quality']; label?: string; sources?: RenderSource[] },
  ) => void
  retryRender: (pid: string, jobId: string) => void
  cancelRender: (pid: string, jobId: string) => void
  updateRenderJob: (pid: string, jobId: string, patch: Partial<RenderJob>) => void
}

/**
 * One undo step.
 *
 * The whole project list is snapshotted rather than a diff. Projects are plain
 * JSON of a few hundred KB at most, snapshots are structurally shared by the
 * untouched entries, and the stack is capped — which buys a guarantee that no
 * diff scheme gives you: *every* action is undoable, including the ones added
 * after this was written, because nothing has to remember to record itself.
 */
type HistoryEntry = { projects: Project[]; label: string; at: number }

/** Deepest the undo stack goes. Beyond this the oldest steps are dropped. */
const HISTORY_LIMIT = 80

/** Drags fire dozens of updates a second; they should be one undo step. */
const COALESCE_MS = 700

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
      /**
       * The single funnel every project mutation goes through — which is why
       * undo can cover all of them at once.
       *
       * `label` is what the user is told they are undoing. Repeats of the same
       * label in quick succession (a slider drag) collapse into one step.
       */
      const updateProject = (id: string, fn: (p: Project) => Project, label = 'Edit') =>
        set((s) => {
          const snapshot: HistoryEntry = { projects: s.projects, label, at: Date.now() }
          const top = s.past[s.past.length - 1]
          const coalesce = Boolean(top && top.label === label && snapshot.at - top.at < COALESCE_MS)
          const past = coalesce ? s.past : [...s.past, snapshot].slice(-HISTORY_LIMIT)
          return {
            projects: s.projects.map((p) => (p.id === id ? { ...fn(p), updatedAt: nowIso() } : p)),
            past,
            // Any new edit abandons the redo branch, as in every editor.
            future: [],
          }
        })

      /** For mutations that are not a single-project edit (create, delete…). */
      const recordHistory = (label: string) =>
        set((s) => ({
          past: [...s.past, { projects: s.projects, label, at: Date.now() }].slice(-HISTORY_LIMIT),
          future: [],
        }))

      return {
        projects: makeSeedProjects(),
        activeProjectId: null,
        view: 'home',
        theme: 'dark',
        askOpen: false,
        toasts: [],
        automationJobs: [],
        past: [],
        future: [],

        undo: () => {
          const { past, projects } = get()
          const entry = past[past.length - 1]
          if (!entry) {
            get().pushToast('info', 'Nothing to undo.')
            return
          }
          set((s) => ({
            projects: entry.projects,
            past: s.past.slice(0, -1),
            future: [...s.future, { projects, label: entry.label, at: Date.now() }].slice(-HISTORY_LIMIT),
          }))
          get().pushToast('info', `Undid: ${entry.label.toLowerCase()}`)
        },
        redo: () => {
          const { future, projects } = get()
          const entry = future[future.length - 1]
          if (!entry) {
            get().pushToast('info', 'Nothing to redo.')
            return
          }
          set((s) => ({
            projects: entry.projects,
            future: s.future.slice(0, -1),
            past: [...s.past, { projects, label: entry.label, at: Date.now() }].slice(-HISTORY_LIMIT),
          }))
          get().pushToast('info', `Redid: ${entry.label.toLowerCase()}`)
        },
        startAutomationJob: (input) => {
          const projectId = get().activeProjectId || get().createProject()
          const id = uid()
          const labels = ['Create project', 'Generate AI rundown', 'Lock rundown', 'Generate candidates', 'Ingest footage', 'Build timeline', 'Render MP4', 'Review report']
          const steps = labels.map((label, i) => ({ id: `${id}-step-${i}`, label, status: i === 0 ? 'running' as const : 'queued' as const, progressPct: 0 }))
          const job: AutomationJob = {
            ...input,
            remotionPlan: planWithRemotionCapabilities(input.brief, input.aspect, input.fps),
            id,
            projectId,
            status: 'running',
            currentStepId: steps[0].id,
            steps,
            createdAt: nowIso(),
            updatedAt: nowIso(),
            outputPath: null,
            reviewReportPath: null,
          }
          set((s) => ({ automationJobs: [job, ...s.automationJobs], view: 'auto' }))
          const ipc = getIpc()
          if (ipc) {
            void ipc.invoke('automation:start', job)
              .then((remoteJob: AutomationJob | null) => { if (remoteJob?.id) get().updateAutomationJob(remoteJob.id, remoteJob) })
              .catch((err: Error) => get().updateAutomationJob(id, { status: 'error', errorMessage: err?.message || 'Automation failed' }))
          } else {
            // No Electron: the pipeline needs the filesystem, FFmpeg and the
            // model bridge, so say so instead of animating a fake success.
            get().updateAutomationJob(id, {
              status: 'error',
              currentStepId: null,
              errorMessage:
                'Autonomous runs need the desktop app (filesystem + FFmpeg). In the browser, build the video by hand in Studio or use Brief → Arena.',
            })
            get().pushToast('info', 'Autonomous runs are desktop-only — Studio works right here in the browser.')
          }
        },
        updateAutomationJob: (jobId, patch) => set((s) => ({ automationJobs: s.automationJobs.map((j) => j.id === jobId ? { ...j, ...patch, updatedAt: nowIso() } : j) })),
        updateAutomationStep: (jobId, stepId, patch) => set((s) => ({ automationJobs: s.automationJobs.map((j) => j.id === jobId ? { ...j, steps: j.steps.map((x) => x.id === stepId ? { ...x, ...patch } : x), updatedAt: nowIso() } : j) })),
        cancelAutomationJob: (jobId) => {
          const ipc = getIpc()
          if (ipc) void ipc.invoke('automation:cancel', { jobId }).then((remoteJob: AutomationJob | null) => { if (remoteJob?.id) get().updateAutomationJob(remoteJob.id, remoteJob) })
          get().updateAutomationJob(jobId, { status: 'cancelled' })
        },
        resumeAutomationJob: (jobId) => {
          const ipc = getIpc()
          if (ipc) void ipc.invoke('automation:resume', { jobId }).then((remoteJob: AutomationJob | null) => { if (remoteJob?.id) get().updateAutomationJob(remoteJob.id, remoteJob) })
          get().updateAutomationJob(jobId, { status: 'running' })
        },
        approveAutomationStep: (jobId, stepId) => {
          const ipc = getIpc()
          if (ipc) void ipc.invoke('automation:approveStep', { jobId, stepId }).then((remoteJob: AutomationJob | null) => { if (remoteJob?.id) get().updateAutomationJob(remoteJob.id, remoteJob) })
        },
        rejectAutomationStep: (jobId, stepId) => {
          const ipc = getIpc()
          if (ipc) void ipc.invoke('automation:rejectStep', { jobId, stepId }).then((remoteJob: AutomationJob | null) => { if (remoteJob?.id) get().updateAutomationJob(remoteJob.id, remoteJob) })
        },

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
            studio: emptyStudioDoc(),
            brandKit: { colors: ['#0B0B10', '#C8F542', '#F4F1EA'], font: 'Inter Variable', logoDataUrl: null },
          }
          recordHistory('Create project')
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
          recordHistory('Duplicate project')
          set((s) => ({ projects: [...s.projects, copy] }))
        },
        deleteProject: (id) => {
          recordHistory('Delete project')
          return set((s) => ({
            projects: s.projects.filter((p) => p.id !== id),
            activeProjectId: s.activeProjectId === id ? null : s.activeProjectId,
            view: s.activeProjectId === id ? 'home' : s.view,
          }))
        },
        setActiveProject: (activeProjectId) => set({ activeProjectId }),
        renameProject: (id, name) => updateProject(id, (p) => ({ ...p, name: name || 'Untitled project' }), 'Rename project'),

        addBriefMessage: (pid, msg) =>
          updateProject(pid, (p) => ({ ...p, brief: { ...p.brief, messages: [...p.brief.messages, msg] } }), 'Add message'),
        patchRundown: (pid, patch) =>
          updateProject(pid, (p) => ({
            ...p,
            brief: {
              ...p.brief,
              draftRundown: { ...(p.brief.draftRundown ?? {}), ...patch },
            },
          }), 'Edit rundown'),
        lockRundown: (pid) => {
          const p = get().projects.find((x) => x.id === pid)
          const draft = p?.brief.draftRundown
          if (!p || !draft?.title || !draft.scenes?.length || !draft.arenaPrompt) return
          updateProject(pid, (proj) => ({
            ...proj,
            brief: { ...proj.brief, lockedRundown: draft as SceneRundown },
          }), 'Lock rundown')
        },

        addArenaAsset: (pid, a) => {
          const id = uid()
          updateProject(pid, (p) => ({
            ...p,
            arenaAssets: [{ ...a, id, createdAt: nowIso() }, ...p.arenaAssets],
          }), 'Add Arena asset')
          return id
        },
        updateArenaAsset: (pid, id, patch) =>
          updateProject(pid, (p) => ({
            ...p,
            arenaAssets: p.arenaAssets.map((a) => (a.id === id ? { ...a, ...patch } : a)),
          }), 'Edit Arena asset'),

        addFootageAsset: (pid, f) => {
          const id = uid()
          updateProject(pid, (p) => ({ ...p, footageAssets: [...p.footageAssets, { ...f, id }] }), 'Add footage')
          return id
        },
        updateFootageAsset: (pid, id, patch) =>
          updateProject(pid, (p) => ({
            ...p,
            footageAssets: p.footageAssets.map((f) => (f.id === id ? { ...f, ...patch } : f)),
          }), 'Edit footage'),

        addTimelineClip: (pid, clip, insertIndex) =>
          updateProject(pid, (p) => {
            const next = [...p.timeline]
            const at = Number.isFinite(insertIndex) ? clamp(Number(insertIndex), 0, next.length) : next.length
            next.splice(at, 0, { ...clip, id: uid(), startSec: 0 })
            return { ...p, timeline: relayout(next) }
          }, 'Add clip'),
        removeTimelineClip: (pid, clipId) =>
          updateProject(pid, (p) => ({
            ...p,
            timeline: relayout(p.timeline.filter((c) => c.id !== clipId)),
          }), 'Remove clip'),
        moveTimelineClip: (pid, from, to) =>
          updateProject(pid, (p) => {
            const arr = [...p.timeline]
            const [moved] = arr.splice(from, 1)
            if (!moved) return p
            arr.splice(clamp(to, 0, arr.length), 0, moved)
            return { ...p, timeline: relayout(arr) }
          }, 'Move clip'),
        setClipDuration: (pid, clipId, dur) =>
          updateProject(pid, (p) => ({
            ...p,
            timeline: relayout(
              p.timeline.map((c) =>
                c.id === clipId ? { ...c, durationSec: round1(clamp(dur, 0.5, 600)) } : c,
              ),
            ),
          }), 'Change duration'),

        updateRenderJob: (pid, jobId, patch) =>
          updateProject(pid, (p) => ({
            ...p,
            renderJobs: p.renderJobs.map((j) => (j.id === jobId ? { ...j, ...patch } : j)),
          })),

        /* ——— Studio ——— */

        patchStudio: (pid, patch) =>
          updateProject(pid, (p) => ({ ...p, studio: { ...studioOf(p), ...patch } }), 'Change project settings'),

        addStudioClip: (pid, clip) =>
          updateProject(pid, (p) => {
            const doc = studioOf(p)
            const trackCount = Math.max(doc.trackCount, clip.track + 1)
            return {
              ...p,
              studio: { ...doc, trackCount, clips: [...doc.clips, normaliseClip(clip, trackCount)] },
            }
          }, 'Add clip'),

        updateStudioClip: (pid, clipId, patch) =>
          updateProject(pid, (p) => {
            const doc = studioOf(p)
            return {
              ...p,
              studio: {
                ...doc,
                clips: doc.clips.map((c) =>
                  c.id === clipId ? normaliseClip({ ...c, ...patch } as StudioClip, doc.trackCount) : c,
                ),
              },
            }
          }, 'Edit clip'),

        removeStudioClip: (pid, clipId) =>
          updateProject(pid, (p) => {
            const doc = studioOf(p)
            return { ...p, studio: { ...doc, clips: doc.clips.filter((c) => c.id !== clipId) } }
          }, 'Delete clip'),

        splitStudioClip: (pid, clipId, atSec) =>
          updateProject(pid, (p) => {
            const doc = studioOf(p)
            const clip = doc.clips.find((c) => c.id === clipId)
            if (!clip) return p
            const halves = splitClipAt(clip, atSec)
            if (!halves) return p
            return {
              ...p,
              studio: { ...doc, clips: doc.clips.flatMap((c) => (c.id === clipId ? halves : [c])) },
            }
          }, 'Split clip'),

        duplicateStudioClip: (pid, clipId) =>
          updateProject(pid, (p) => {
            const doc = studioOf(p)
            const clip = doc.clips.find((c) => c.id === clipId)
            if (!clip) return p
            const copy = normaliseClip(
              { ...clip, id: uid(), startSec: clip.startSec + clip.durationSec },
              doc.trackCount,
            )
            return { ...p, studio: { ...doc, clips: [...doc.clips, copy] } }
          }, 'Duplicate clip'),

        addStudioTrack: (pid) =>
          updateProject(pid, (p) => {
            const doc = studioOf(p)
            return { ...p, studio: { ...doc, trackCount: Math.min(8, doc.trackCount + 1) } }
          }, 'Add track'),

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
            sources: opts.sources,
          }
          updateProject(pid, (proj) => ({ ...proj, renderJobs: [job, ...proj.renderJobs] }))
          get().pushToast('info', `Render started — ${job.outputName}`)
          const renderSources = opts.sources ?? renderSourcesForProject(p)
          const cancel = launchRender(
            { ...job, sources: renderSources },
            (pct) => get().updateRenderJob(pid, job.id, { progressPct: pct, status: 'rendering' }),
            (result) => {
              activeRenderCancels.delete(job.id)
              if (result?.error) {
                get().updateRenderJob(pid, job.id, { status: 'error', errorMessage: result.error })
                get().pushToast('error', `Render failed — ${result.error}`)
                return
              }
              downloadBrowserRender(result)
              get().updateRenderJob(pid, job.id, { progressPct: 100, status: 'done', outputPath: result?.outputPath ?? null, outputName: result?.outputName ?? job.outputName, errorMessage: null })
              get().pushToast('success', `Render complete — ${result?.outputName ?? job.outputName}`)
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
          const renderSources = (job.sources as RenderSource[] | undefined) ?? renderSourcesForProject(p)
          const cancel = launchRender(
            { ...job, sources: renderSources },
            (pct) => get().updateRenderJob(pid, jobId, { progressPct: pct, status: 'rendering' }),
            (result) => {
              activeRenderCancels.delete(jobId)
              if (result?.error) {
                get().updateRenderJob(pid, jobId, { status: 'error', errorMessage: result.error })
                get().pushToast('error', `Render failed — ${result.error}`)
                return
              }
              downloadBrowserRender(result)
              get().updateRenderJob(pid, jobId, { progressPct: 100, status: 'done', outputPath: result?.outputPath ?? null, outputName: result?.outputName ?? job.outputName, errorMessage: null })
              get().pushToast('success', `Render complete — ${result?.outputName ?? job.outputName}`)
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
      version: 1,
      storage: createJSONStorage(() => desktopAwareStorage),
      migrate: (persisted) => {
        const state = persisted as Partial<AppState>
        const starterNames = new Set(['Aurora Launch Teaser', 'Podcast Clip — Ep. 12', 'Logo Sting v2'])
        return {
          ...state,
          projects: (state.projects ?? [])
            .filter((project) => !starterNames.has(project.name))
            .map((project) => ({
              ...project,
              studio: project.studio ?? emptyStudioDoc(),
              timeline: (project.timeline ?? []).filter((clip) => Boolean(clip.sourceId)),
              renderJobs: (project.renderJobs ?? []).filter((job) => Boolean(job.outputPath)),
              arenaAssets: (project.arenaAssets ?? []).map((asset) =>
                !asset.localPath && (asset.status === 'imported' || asset.status === 'rendered')
                  ? { ...asset, status: 'awaiting-vote' as const }
                  : asset,
              ),
            })),
        }
      },
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
