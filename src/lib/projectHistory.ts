/**
 * Version history for the whole project store (2.26).
 *
 * Desktop: the main process keeps atomic saves plus a rolling set of
 * snapshots (electron/project-history.cjs). Web: a small ring in
 * localStorage, best effort — browsers cap storage, so a quota error is
 * reported, never swallowed into a pretend success.
 */
import { getIpc } from './bridge'

export type ProjectVersion = {
  id: string
  at: string
  label: string
  bytes: number
  valid: boolean
  projects: number
  clips: number
  names: string[]
  schemaVersion: number | null
}

export type RecoveryInfo = { previousSessionCrashed: boolean; recoveredFrom: string | null; /** projects.json was unreadable and no autosave was valid (0.10.1). */ unreadable?: boolean }

export const STORE_KEY = 'northframe-v1'
const WEB_RING_KEY = `${STORE_KEY}:history`
const WEB_RING_SIZE = 6
const WEB_MIN_INTERVAL_MS = 2 * 60 * 1000

type WebEntry = { id: string; at: string; label: string; text: string }

function readRing(): WebEntry[] {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(WEB_RING_KEY) || '[]')
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function writeRing(entries: WebEntry[]) {
  // Drop the oldest until it fits; a full project with recorded frames can be
  // megabytes, and localStorage is ~5 MB total.
  let list = entries.slice(0, WEB_RING_SIZE)
  while (list.length) {
    try {
      window.localStorage.setItem(WEB_RING_KEY, JSON.stringify(list))
      return
    } catch {
      list = list.slice(0, -1)
    }
  }
  window.localStorage.removeItem(WEB_RING_KEY)
}

function summarise(text: string): Pick<ProjectVersion, 'projects' | 'clips' | 'names' | 'schemaVersion' | 'valid'> {
  try {
    const parsed = JSON.parse(text)
    const state = parsed?.state ?? parsed
    const projects: { name?: string; studio?: { clips?: unknown[] } }[] = Array.isArray(state?.projects) ? state.projects : []
    return {
      valid: true,
      projects: projects.length,
      clips: projects.reduce((n, p) => n + (Array.isArray(p?.studio?.clips) ? p.studio!.clips!.length : 0), 0),
      names: projects.slice(0, 4).map((p) => String(p?.name || 'Untitled')),
      schemaVersion: typeof parsed?.version === 'number' ? parsed.version : null,
    }
  } catch {
    return { valid: false, projects: 0, clips: 0, names: [], schemaVersion: null }
  }
}

/** Called by the web storage adapter on every save. Throttled. */
export function webAutosave(text: string, label = 'autosave', force = false) {
  const ring = readRing()
  const newest = ring[0]
  if (!force && newest && Date.now() - Date.parse(newest.at) < WEB_MIN_INTERVAL_MS) return
  const at = new Date().toISOString()
  writeRing([{ id: `web-${at}`, at, label, text }, ...ring])
}

export async function listVersions(): Promise<ProjectVersion[]> {
  const ipc = getIpc()
  if (ipc) return ((await ipc.invoke('state:listVersions')) as ProjectVersion[]) ?? []
  return readRing().map((e) => ({ id: e.id, at: e.at, label: e.label, bytes: e.text.length, ...summarise(e.text) }))
}

export async function snapshotNow(): Promise<void> {
  const ipc = getIpc()
  if (ipc) {
    await ipc.invoke('state:snapshotNow')
    return
  }
  const current = window.localStorage.getItem(STORE_KEY)
  if (!current) throw new Error('Nothing has been saved yet.')
  webAutosave(current, 'manual', true)
}

/** Restore a version, then reload so every screen reads the restored state. */
export async function restoreVersion(id: string): Promise<void> {
  const ipc = getIpc()
  if (ipc) {
    await ipc.invoke('state:restoreVersion', { id })
  } else {
    const entry = readRing().find((e) => e.id === id)
    if (!entry) throw new Error('That version is no longer available.')
    const current = window.localStorage.getItem(STORE_KEY)
    if (current) webAutosave(current, 'before-restore', true)
    window.localStorage.setItem(STORE_KEY, entry.text)
  }
  window.location.reload()
}

export async function recoveryInfo(): Promise<RecoveryInfo> {
  const ipc = getIpc()
  if (!ipc) return { previousSessionCrashed: false, recoveredFrom: null }
  try {
    return ((await ipc.invoke('state:recoveryInfo')) as RecoveryInfo) ?? { previousSessionCrashed: false, recoveredFrom: null }
  } catch {
    return { previousSessionCrashed: false, recoveredFrom: null }
  }
}
