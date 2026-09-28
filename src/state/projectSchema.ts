/**
 * Load-time validation of the saved state (projects.json) — 0.10.1.
 *
 * zustand only runs `migrate` when the saved version differs from the build's,
 * so a same-version file with a bad shape (hand-edited, half-written, written
 * by a newer build) used to flow straight into the screens — `brief: null`
 * alone blanked Library and Studio. This runs on EVERY load, after migrate.
 *
 * Contract: it never throws, never crashes a screen, and never silently drops
 * user content. Anything unknown falls back to a safe default and produces a
 * one-line warning the UI shows after load:
 *   - unknown view            → 'home'
 *   - unknown backgroundId    → 'lime-void'
 *   - unknown clip.kind       → clip KEPT (renderer skips it), warned
 *   - bad font                → default font (Inter Variable → system font)
 *   - empty clips / timeline / 0 tracks → valid empty doc (≥1 track)
 * Non-object junk entries (null, strings) are not content and are skipped.
 */
import { z } from 'zod'
import type { AutomationJob, Project, StudioClip, StudioDoc, View } from '../types/project'
import { normaliseStudioDoc } from './migrate'

export const VIEWS = ['home', 'auto', 'review', 'brief', 'arena', 'footage', 'timeline', 'studio', 'motion', 'lab', 'render', 'library'] as const satisfies readonly View[]
// Compile-time: every View is listed above (adding a view without it fails typecheck).
type MissingView = Exclude<View, (typeof VIEWS)[number]>
const _allViewsListed: MissingView extends never ? true : MissingView = true
void _allViewsListed

export const KNOWN_CLIP_KINDS = ['video', 'image', 'audio', 'text', 'background', 'adjustment', 'overlay', 'glass', 'sticker', 'sequence', 'shape', 'cursor', 'loader', 'kit'] as const satisfies readonly StudioClip['kind'][]
type MissingKind = Exclude<StudioClip['kind'], (typeof KNOWN_CLIP_KINDS)[number]>
const _allKindsListed: MissingKind extends never ? true : MissingKind = true
void _allKindsListed

export const DEFAULT_BACKGROUND_ID = 'lime-void'

export type PersistedAppState = {
  projects: Project[]
  activeProjectId: string | null
  view: View
  theme: 'dark' | 'light'
  soundCues: boolean
  automationJobs: AutomationJob[]
}

export type ValidationResult = { state: Partial<PersistedAppState>; warnings: string[] }

type Options = {
  /** Background ids this build can paint (STUDIO_BACKGROUNDS). */
  backgroundIds: readonly string[]
  /** Stable id source for repaired entries (injectable for tests). */
  makeId?: (prefix: string) => string
}

const isObj = (v: unknown): v is Record<string, unknown> => Boolean(v) && typeof v === 'object' && !Array.isArray(v)
const EPOCH = '1970-01-01T00:00:00.000Z'

export function validatePersistedState(raw: unknown, opts: Options): ValidationResult {
  const warnings: string[] = []
  const warn = (msg: string) => {
    if (!warnings.includes(msg)) warnings.push(msg)
  }
  let n = 0
  const makeId = opts.makeId ?? ((prefix: string) => `${prefix}-repaired-${(n++).toString(36)}`)
  const knownBackgrounds = new Set(opts.backgroundIds)
  const knownKinds = new Set<string>(KNOWN_CLIP_KINDS)

  if (!isObj(raw)) {
    if (raw !== undefined && raw !== null) warn('Saved projects were not in a readable shape, so Cupric started with an empty workspace.')
    return { state: {}, warnings }
  }

  const objArray = (label: string) =>
    z.unknown().transform((v): Record<string, unknown>[] => {
      if (v === undefined || v === null) return []
      if (!Array.isArray(v)) {
        warn(`${label} was not a list and was reset.`)
        return []
      }
      const kept = v.filter(isObj)
      if (kept.length !== v.length) warn(`${v.length - kept.length} unreadable ${label} entr${v.length - kept.length === 1 ? 'y was' : 'ies were'} skipped.`)
      return kept
    })

  const withIds = (prefix: string) => (items: Record<string, unknown>[]) => items.map((item) => (typeof item.id === 'string' && item.id ? item : { ...item, id: makeId(prefix) }))

  const BriefSchema = z
    .object({
      messages: objArray('brief message').catch([]),
      draftRundown: z.record(z.unknown()).nullable().catch(null),
      lockedRundown: z.record(z.unknown()).nullable().catch(null),
    })
    .passthrough()

  const BrandKitSchema = z
    .object({
      colors: z.array(z.string()).catch(['#C8F542']),
      font: z.string().min(1).catch('Inter'),
      logoDataUrl: z.string().nullable().catch(null),
    })
    .passthrough()

  const ProjectSchema = z
    .object({
      id: z.string().min(1),
      name: z.string().catch(() => {
        warn('A project had no readable name and was renamed "Untitled project".')
        return 'Untitled project'
      }),
      createdAt: z.string().catch(EPOCH),
      updatedAt: z.string().catch(EPOCH),
      brief: BriefSchema.catch(() => ({ messages: [], draftRundown: null, lockedRundown: null })),
      arenaAssets: objArray('Arena asset').transform(withIds('arena')).catch([]),
      footageAssets: objArray('footage asset').transform(withIds('footage')).catch([]),
      timeline: objArray('timeline clip').transform(withIds('tl')).catch([]),
      renderJobs: objArray('render job').transform(withIds('job')).catch([]),
      studio: z.unknown(),
      production: z.unknown(),
      brandKit: BrandKitSchema.catch({ colors: ['#C8F542'], font: 'Inter', logoDataUrl: null }),
    })
    .passthrough()

  // ——— projects ———
  const rawProjects: unknown = raw.projects
  let projectEntries: Record<string, unknown>[] = []
  if (Array.isArray(rawProjects)) {
    projectEntries = rawProjects.filter(isObj)
    const junk = rawProjects.length - projectEntries.length
    if (junk) warn(`${junk} unreadable project entr${junk === 1 ? 'y was' : 'ies were'} skipped.`)
  } else if (rawProjects !== undefined && rawProjects !== null) {
    warn('The saved project list was unreadable and was reset.')
  }

  const seenIds = new Set<string>()
  const projects: Project[] = projectEntries.map((entry) => {
    const withId = typeof entry.id === 'string' && entry.id && !seenIds.has(entry.id) ? entry : { ...entry, id: makeId('project') }
    if (withId !== entry) warn('A project had a missing or duplicate id and was given a new one.')
    seenIds.add(withId.id as string)
    const parsed = ProjectSchema.parse(withId) as unknown as Project
    return { ...parsed, studio: validateStudio(parsed.studio, parsed.name, { warn, knownBackgrounds, knownKinds }) }
  })

  // ——— the rest ———
  const view = z.enum(VIEWS).safeParse(raw.view)
  if (raw.view !== undefined && !view.success) warn(`Unknown saved view "${String(raw.view).slice(0, 40)}" — opened Home instead.`)

  let activeProjectId = typeof raw.activeProjectId === 'string' ? raw.activeProjectId : null
  if (activeProjectId && !projects.some((p) => p.id === activeProjectId)) {
    warn('The last open project no longer exists; no project is open.')
    activeProjectId = null
  }

  const state: Partial<PersistedAppState> = {
    projects,
    activeProjectId,
    view: view.success ? view.data : 'home',
  }
  if (raw.theme !== undefined) state.theme = raw.theme === 'light' ? 'light' : 'dark'
  if (raw.soundCues !== undefined) state.soundCues = typeof raw.soundCues === 'boolean' ? raw.soundCues : true
  if (raw.automationJobs !== undefined) {
    state.automationJobs = (Array.isArray(raw.automationJobs) ? raw.automationJobs : [])
      .filter((j): j is Record<string, unknown> => isObj(j) && typeof j.id === 'string')
      .map((j) => ({ ...j, steps: Array.isArray(j.steps) ? j.steps.filter(isObj) : [], warnings: Array.isArray(j.warnings) ? j.warnings : [] })) as unknown as AutomationJob[]
  }
  return { state, warnings }
}

type StudioCtx = { warn: (msg: string) => void; knownBackgrounds: Set<string>; knownKinds: Set<string> }

function validateStudio(raw: unknown, projectName: string, { warn, knownBackgrounds, knownKinds }: StudioCtx): StudioDoc {
  const src = isObj(raw) ? raw : {}
  const name = `"${String(projectName).slice(0, 40)}"`
  const rawClips = Array.isArray(src.clips) ? src.clips : []
  if (src.clips !== undefined && !Array.isArray(src.clips)) warn(`${name}: the Studio clip list was unreadable and was reset.`)
  const junk = rawClips.filter((c) => !isObj(c)).length
  if (junk) warn(`${name}: ${junk} unreadable Studio clip entr${junk === 1 ? 'y was' : 'ies were'} skipped.`)

  const doc = normaliseStudioDoc(src)
  if (src.aspect !== undefined && src.aspect !== doc.aspect) warn(`${name}: unknown aspect "${String(src.aspect)}" — using ${doc.aspect}.`)
  if (src.fps !== undefined && src.fps !== doc.fps) warn(`${name}: unsupported ${String(src.fps)} fps — using ${doc.fps}.`)
  if (src.trackCount !== undefined && src.trackCount !== doc.trackCount && Number(src.trackCount) < 1) warn(`${name}: the timeline had no tracks — added one.`)

  if (!knownBackgrounds.has(doc.backgroundId)) {
    warn(`${name}: background "${doc.backgroundId.slice(0, 40)}" is not available in this build — using Lime Void.`)
    doc.backgroundId = DEFAULT_BACKGROUND_ID
  }

  const unknownKinds = new Set<string>()
  doc.clips = doc.clips.map((clip) => {
    const c = clip as StudioClip & Record<string, unknown>
    const kind = typeof c.kind === 'string' ? c.kind : ''
    if (!knownKinds.has(kind)) unknownKinds.add(kind || '(none)')
    if (kind === 'background' && (typeof c.backgroundId !== 'string' || !knownBackgrounds.has(c.backgroundId))) {
      warn(`${name}: a background clip used an unavailable background — using Lime Void.`)
      return { ...c, backgroundId: DEFAULT_BACKGROUND_ID } as StudioClip
    }
    if (kind === 'text' && 'fontFamily' in c && (typeof c.fontFamily !== 'string' || !c.fontFamily.trim())) {
      warn(`${name}: a text clip had an unreadable font — using the default font.`)
      const { fontFamily: _drop, ...rest } = c
      void _drop
      return rest as StudioClip
    }
    return clip
  })
  if (unknownKinds.size) {
    const list = [...unknownKinds].map((k) => `"${k.slice(0, 24)}"`).join(', ')
    warn(`${name}: clip type ${list} is not supported by this build — kept in the project but not drawn.`)
  }
  return doc
}
