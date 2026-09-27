/**
 * Saved-project schema migration (2.29).
 *
 * The persisted store carries a version number (zustand `persist` version).
 * Anything saved by an older build goes through `migratePersisted`, which is
 * pure so scripts/check-migration.mjs can feed it real old-shaped fixtures.
 *
 * History of the persisted shape:
 *   v0 — pre-persist blob `{ projects, ... }` (wrapped by the storage adapter)
 *   v1 — `studio` added to projects; starter demo projects removed
 *   v2 — (0.9.1) every StudioDoc normalised on load: keyframes sorted with
 *        `at`, interrupted component recordings re-queued, text/media clip
 *        defaults filled, trackCount covers every clip, component shelf.
 *
 * Rule: migration never drops user content. Unknown clip kinds are kept as
 * they are (the renderer skips what it does not know) rather than deleted.
 */
import type { Project, StudioClip, StudioDoc, StudioKeyframe } from '../types/project'

export const PERSIST_VERSION = 2

const ASPECTS = new Set(['16:9', '9:16', '1:1', '4:5'])
const FPS = new Set([24, 30, 60])
const STARTER_NAMES = new Set(['Aurora Launch Teaser', 'Podcast Clip — Ep. 12', 'Logo Sting v2'])

const num = (v: unknown, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback)

let counter = 0
const freshId = () => `m${Date.now().toString(36)}${(counter++).toString(36)}`

export function normaliseKeyframes(raw: unknown): StudioKeyframe[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null
  const keys = raw
    .filter((k): k is Record<string, unknown> => Boolean(k) && typeof k === 'object')
    .map((k) => {
      // Very early builds wrote `time`/`t` instead of `at`.
      const at = num(k.at, num(k.time, num(k.t, NaN)))
      if (!Number.isFinite(at)) return null
      const out: StudioKeyframe = { at: Math.max(0, at), ease: (typeof k.ease === 'string' ? k.ease : 'ease-in-out') as StudioKeyframe['ease'] }
      for (const prop of ['x', 'y', 'scale', 'rotation', 'opacity'] as const) {
        if (typeof k[prop] === 'number' && Number.isFinite(k[prop])) out[prop] = k[prop] as number
      }
      return out
    })
    .filter((k): k is StudioKeyframe => k !== null)
    .sort((a, b) => a.at - b.at)
  return keys.length ? keys : null
}

function normaliseClip(raw: Record<string, unknown>): StudioClip {
  const clip: Record<string, unknown> = { ...raw }
  clip.id = typeof clip.id === 'string' && clip.id ? clip.id : freshId()
  clip.track = Math.max(0, Math.round(num(clip.track, 0)))
  clip.startSec = Math.max(0, num(clip.startSec, 0))
  clip.durationSec = Math.max(0.2, num(clip.durationSec, 3))
  clip.name = typeof clip.name === 'string' ? clip.name : String(clip.kind ?? 'Clip')
  clip.transitionIn = typeof clip.transitionIn === 'string' ? clip.transitionIn : 'none'
  clip.transitionOut = typeof clip.transitionOut === 'string' ? clip.transitionOut : 'none'
  clip.opacity = Math.min(1, Math.max(0, num(clip.opacity, 1)))
  if ('keyframes' in clip) clip.keyframes = normaliseKeyframes(clip.keyframes)

  if (clip.kind === 'text') {
    clip.text = typeof clip.text === 'string' ? clip.text : ''
    clip.fontSizePct = num(clip.fontSizePct, 6)
    clip.color = typeof clip.color === 'string' ? clip.color : '#FFFFFF'
    clip.weight = [400, 600, 800].includes(clip.weight as number) ? clip.weight : 800
    clip.align = ['left', 'center', 'right'].includes(clip.align as string) ? clip.align : 'center'
    clip.x = num(clip.x, 0.5)
    clip.y = num(clip.y, 0.5)
    clip.anim = typeof clip.anim === 'string' ? clip.anim : 'fade-up'
    clip.captionStyle = clip.captionStyle ?? null
    clip.highlightWord = clip.highlightWord ?? null
  } else if (clip.kind === 'video' || clip.kind === 'image') {
    clip.trimInSec = Math.max(0, num(clip.trimInSec, 0))
    clip.sourceDurationSec = Math.max(0, num(clip.sourceDurationSec, 0))
    clip.speed = num(clip.speed, 1) > 0 ? num(clip.speed, 1) : 1
    clip.volume = Math.min(1, Math.max(0, num(clip.volume, 1)))
    clip.fit = clip.fit === 'contain' ? 'contain' : 'cover'
    clip.localPath = clip.localPath ?? null
  } else if (clip.kind === 'audio') {
    clip.trimInSec = Math.max(0, num(clip.trimInSec, 0))
    clip.sourceDurationSec = Math.max(0, num(clip.sourceDurationSec, 0))
    clip.volume = Math.min(1, Math.max(0, num(clip.volume, 1)))
    clip.fadeInSec = Math.max(0, num(clip.fadeInSec, 0))
    clip.fadeOutSec = Math.max(0, num(clip.fadeOutSec, 0))
    clip.localPath = clip.localPath ?? null
  } else if (clip.kind === 'overlay') {
    clip.dataUrl = typeof clip.dataUrl === 'string' ? clip.dataUrl : ''
    clip.source = typeof clip.source === 'string' ? clip.source : ''
    clip.x = num(clip.x, 0.5)
    clip.y = num(clip.y, 0.5)
    clip.scale = num(clip.scale, 1)
    const meta = clip.component as Record<string, unknown> | undefined
    if (meta && typeof meta === 'object') {
      // A recording interrupted by a crash or quit was saved mid-flight as
      // "recording"; left alone it would never be recorded. Queue it again.
      const status = meta.status === 'recording' ? 'pending' : meta.status
      clip.component = {
        ...meta,
        status: ['pending', 'ready', 'failed'].includes(status as string) ? status : 'pending',
        recordSec: Math.min(120, Math.max(0.5, num(meta.recordSec, 4))),
        interact: meta.interact !== false,
      }
    }
  }
  return clip as unknown as StudioClip
}

export function normaliseStudioDoc(raw: unknown): StudioDoc {
  const doc = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const clips = Array.isArray(doc.clips)
    ? (doc.clips.filter((c) => c && typeof c === 'object') as Record<string, unknown>[]).map(normaliseClip)
    : []
  const shelf = Array.isArray(doc.shelf)
    ? (doc.shelf.filter((c) => c && typeof c === 'object') as Record<string, unknown>[]).map(normaliseClip).filter((c) => c.kind === 'overlay')
    : []
  const highest = clips.reduce((m, c) => Math.max(m, c.track), -1)
  const out: StudioDoc = {
    ...(doc as Partial<StudioDoc>),
    aspect: ASPECTS.has(doc.aspect as string) ? (doc.aspect as StudioDoc['aspect']) : '9:16',
    fps: FPS.has(doc.fps as number) ? (doc.fps as StudioDoc['fps']) : 30,
    backgroundId: typeof doc.backgroundId === 'string' ? doc.backgroundId : 'lime-void',
    clips,
    trackCount: Math.max(1, Math.round(num(doc.trackCount, 3)), highest + 1),
  }
  if (shelf.length) out.shelf = shelf as StudioDoc['shelf']
  else delete out.shelf
  return out
}

type PersistedShape = { projects?: Project[]; [key: string]: unknown }

/** zustand `persist` migrate: bring any older saved state up to PERSIST_VERSION. */
export function migratePersisted(persisted: unknown, fromVersion: number): PersistedShape {
  const state = (persisted && typeof persisted === 'object' ? persisted : {}) as PersistedShape
  let projects = Array.isArray(state.projects) ? state.projects : []

  if (fromVersion < 1) {
    projects = projects
      .filter((project) => !STARTER_NAMES.has(project.name))
      .map((project) => ({
        ...project,
        timeline: (project.timeline ?? []).filter((clip) => Boolean(clip.sourceId)),
        renderJobs: (project.renderJobs ?? []).filter((job) => Boolean(job.outputPath)),
        arenaAssets: (project.arenaAssets ?? []).map((asset) =>
          !asset.localPath && (asset.status === 'imported' || asset.status === 'rendered') ? { ...asset, status: 'awaiting-vote' as const } : asset,
        ),
      }))
  }

  // Every version: make every project's edit loadable by this build.
  projects = projects.map((project) => ({
    ...project,
    timeline: Array.isArray(project.timeline) ? project.timeline : [],
    renderJobs: Array.isArray(project.renderJobs) ? project.renderJobs : [],
    arenaAssets: Array.isArray(project.arenaAssets) ? project.arenaAssets : [],
    studio: normaliseStudioDoc(project.studio),
  }))

  return { ...state, projects }
}
