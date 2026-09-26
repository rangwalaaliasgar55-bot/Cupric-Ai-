/**
 * One-click hand-offs into the Studio.
 *
 * The Footage Desk and Arena Desk both hold assets that the editor can use, but
 * they store paths and data URLs rather than live media handles. These helpers
 * do the conversion and add a real clip — no placeholder, no silent no-op: if
 * an asset cannot be used yet, the caller gets an Error explaining why.
 */

import type { ArenaAsset, FootageAsset, Project, StudioClip, StudioMediaClip, StudioOverlayClip } from '../../types/project'
import { getIpc } from '../bridge'
import { uid } from '../utils'
import { nextFreeStart, studioOf } from './doc'
import { registerUrl } from './media'

/** Resolve a desktop path to something a <video> can load. */
async function playableUrl(localPath: string): Promise<string> {
  if (/^(blob|data|https?|file):/i.test(localPath)) return localPath
  const ipc = getIpc()
  if (!ipc) throw new Error('This file lives on disk — open the desktop app to use it in the Studio.')
  const url: string = await ipc.invoke('arena:previewPath', localPath)
  if (!url) throw new Error('The main process could not produce a preview URL for that file.')
  return url
}

/** Footage → a video clip on track 1. */
export async function footageToStudioClip(project: Project, asset: FootageAsset): Promise<StudioMediaClip> {
  if (!asset.localPath) {
    throw new Error(`“${asset.name}” has no file path — re-import it in the Footage Desk (desktop) to edit it here.`)
  }
  const url = await playableUrl(asset.localPath)
  const handle = await registerUrl(url, asset.name, 'video', asset.localPath)
  const doc = studioOf(project)
  const durationSec = handle.durationSec > 0 ? handle.durationSec : Math.max(0.5, asset.durationSec)

  return {
    id: uid(),
    kind: 'video',
    track: 0,
    startSec: nextFreeStart(doc, 0, 0, durationSec),
    durationSec,
    name: asset.name.replace(/\.[^.]+$/, '').slice(0, 28),
    transitionIn: 'fade',
    transitionOut: 'none',
    opacity: 1,
    mediaId: handle.id,
    fileName: asset.name,
    localPath: asset.localPath,
    trimInSec: 0,
    sourceDurationSec: durationSec,
    speed: 1,
    volume: 1,
    fit: 'cover',
    posterDataUrl: handle.posterDataUrl,
  }
}

/**
 * Arena asset → an overlay clip.
 *
 * An Arena asset is an HTML motion piece; the Studio canvas cannot execute it,
 * so what goes on the timeline is its captured thumbnail. That is stated in the
 * clip's `source` label so nobody thinks the animation itself was imported.
 */
export function arenaToStudioClip(project: Project, asset: ArenaAsset): StudioOverlayClip {
  if (!asset.thumbnailDataUrl) {
    throw new Error(
      `“${asset.name}” has no captured frame yet. Import or preview it in the Arena Desk first, then send it here.`,
    )
  }
  const doc = studioOf(project)
  const track = Math.min(doc.trackCount - 1, 1)
  return {
    id: uid(),
    kind: 'overlay',
    track,
    startSec: nextFreeStart(doc, track, 0, 3),
    durationSec: 3,
    name: asset.name.replace(/\.html?$/i, '').slice(0, 28),
    transitionIn: 'fade',
    transitionOut: 'fade',
    opacity: 1,
    dataUrl: asset.thumbnailDataUrl,
    source: `Arena · ${asset.name} (captured frame)`,
    x: 0.5,
    y: 0.5,
    scale: 1,
  }
}

export function isStudioClip(value: unknown): value is StudioClip {
  return typeof value === 'object' && value !== null && 'kind' in value
}
