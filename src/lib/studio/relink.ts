/**
 * JOB 10 — relink that actually relinks.
 *
 * A browser cannot keep a file handle across a reload, so reopening a project
 * showed "Relink file" for every media clip — including the ones that had
 * never moved. On the desktop that is needless: the project stores the real
 * absolute path next to the handle, so Cupric can check the disk itself and
 * put the file back without asking.
 *
 * On the web there is no path and no disk, so the honest box stays exactly as
 * it was. This module reports which world it is in rather than pretending.
 */
import { getIpc } from '../bridge'

export type PathStatus = { path: string; exists: boolean; sizeBytes?: number; modifiedMs?: number }

export type RelinkTarget = {
  clipId: string
  mediaId: string
  fileName: string
  localPath: string | null
  posterDataUrl?: string | null
}

export type RelinkVerdict =
  /** Desktop, the file is still where the project left it — nothing to ask. */
  | { state: 'found'; path: string; sizeBytes?: number }
  /** Desktop, the path is recorded but the file is gone — offer Locate / Remove. */
  | { state: 'missing'; path: string }
  /** No absolute path was ever stored (web import, or a pre-desktop project). */
  | { state: 'no-path' }
  /** Not running on the desktop: the file picker is the only option there is. */
  | { state: 'web' }

/** True when the real filesystem is reachable — i.e. the desktop build. */
export function canAutoRelink(): boolean {
  return getIpc() !== null
}

/**
 * Ask the main process which of these paths still exist.
 *
 * One round trip for the whole project rather than one per clip: a timeline
 * with sixty clips should not mean sixty IPC calls on open.
 */
export async function checkPaths(paths: string[]): Promise<Map<string, PathStatus>> {
  const out = new Map<string, PathStatus>()
  const ipc = getIpc()
  const unique = [...new Set(paths.filter(Boolean))]
  if (!ipc || !unique.length) return out
  try {
    const rows = await ipc.invoke('media:checkPaths', { paths: unique }) as PathStatus[] | null
    for (const row of rows ?? []) out.set(row.path, row)
  } catch {
    // A failed check is not a missing file: say nothing rather than claim loss.
  }
  return out
}

/** Classify one clip against the result of `checkPaths`. */
export function verdictFor(target: RelinkTarget, statuses: Map<string, PathStatus>): RelinkVerdict {
  if (!canAutoRelink()) return { state: 'web' }
  if (!target.localPath) return { state: 'no-path' }
  const status = statuses.get(target.localPath)
  if (!status) return { state: 'no-path' }
  return status.exists
    ? { state: 'found', path: status.path, sizeBytes: status.sizeBytes }
    : { state: 'missing', path: status.path }
}

/** Open the native picker for one missing file. Returns null when cancelled. */
export async function locateFile(fileName: string): Promise<{ path: string; fileName: string; sizeBytes?: number } | null> {
  const ipc = getIpc()
  if (!ipc) return null
  try {
    return await ipc.invoke('media:locate', { fileName }) as { path: string; fileName: string; sizeBytes?: number } | null
  } catch {
    return null
  }
}

/**
 * What to tell the user, in one sentence, for each verdict.
 *
 * Never a dialog and never a raw error — a missing file is an expected state
 * in any editor, and it gets an honest inline explanation with the two actions
 * that resolve it.
 */
export function relinkMessage(target: RelinkTarget, verdict: RelinkVerdict): string {
  switch (verdict.state) {
    case 'found':
      return `“${target.fileName}” is still where you left it. Cupric reloaded it from ${verdict.path}.`
    case 'missing':
      return `“${target.fileName}” is no longer at ${verdict.path}. Locate it to point Cupric at the new place, or remove the clip.`
    case 'no-path':
      return `“${target.fileName}” was imported without a folder path, so Cupric cannot find it by itself. Pick the file again to restore it.`
    case 'web':
      return `Your browser cannot keep a file handle across a reload. Pick “${target.fileName}” again to restore the picture and sound — the desktop app remembers the folder and does this for you.`
  }
}
