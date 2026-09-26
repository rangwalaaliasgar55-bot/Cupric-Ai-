/**
 * Dragging a Resources item onto the Studio stage.
 *
 * Why this file exists: the Library could only *click* items into the edit, and
 * the stage had no drop handler at all — so a drag ended in nothing, which read
 * as "the drag silently failed". The registry was never wired to the canvas
 * because there was no mapping from a pack item to a clip outside the Library
 * component itself.
 *
 * So the mapping lives here, shared by both paths: the Library button and the
 * stage drop produce the exact same clip. Anything this function cannot turn
 * into something the renderer can actually draw returns an explicit error
 * instead of a placeholder clip — a clip that renders nothing is worse than a
 * refusal, because it looks like the app worked.
 */

import type { StudioClip, StudioDoc } from '../../types/project'
import { uid } from '../utils'
import { STUDIO_BACKGROUNDS } from './backgrounds'
import { defaultGlassClip, defaultTextClip, nextFreeStart } from './doc'
import { TEXT_ANIMATIONS, TRANSITIONS } from './transitions'

/** Custom MIME so a drag from the Library can never be confused with a file. */
export const RESOURCE_MIME = 'application/x-cupric-resource'

export type ResourceDragPayload = {
  /** Pack item kind: glass, background, animation, transition, effect, component… */
  kind: string
  id: string
  name: string
  description?: string
  data?: Record<string, unknown>
}

export type DropResult =
  | { ok: true; clip: StudioClip; message: string }
  | { ok: true; docPatch: Partial<StudioDoc>; message: string }
  | { ok: false; reason: string }

export function readDragPayload(transfer: DataTransfer): ResourceDragPayload | null {
  const raw = transfer.getData(RESOURCE_MIME)
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as ResourceDragPayload
    return parsed && typeof parsed.kind === 'string' && typeof parsed.id === 'string' ? parsed : null
  } catch {
    return null
  }
}

export function writeDragPayload(transfer: DataTransfer, payload: ResourceDragPayload) {
  transfer.setData(RESOURCE_MIME, JSON.stringify(payload))
  transfer.setData('text/plain', payload.name)
  transfer.effectAllowed = 'copy'
}

/**
 * Turn a dropped resource into an edit change at `atSec`.
 *
 * Returns either a clip to add or a document patch (backgrounds set the stage),
 * so the caller never has to branch on the resource kind a second time.
 */
export function resourceToStudio(doc: StudioDoc, payload: ResourceDragPayload, atSec: number): DropResult {
  const topTrack = Math.max(0, Math.min(1, doc.trackCount - 1))

  switch (payload.kind) {
    case 'glass': {
      const clip = defaultGlassClip(
        nextFreeStart(doc, topTrack, atSec, 3),
        topTrack,
        payload.id,
        payload.id === 'lens' ? 'lens' : 'panel',
      )
      return { ok: true, clip, message: `“${payload.name}” glass added at ${atSec.toFixed(1)}s.` }
    }

    case 'background': {
      const known = STUDIO_BACKGROUNDS.find((b) => b.id === payload.id)
      if (!known) {
        // Chrome gradients exist as CSS only; the canvas has no painter for
        // them, so adding a clip would render an empty frame.
        return {
          ok: false,
          reason: `“${payload.name}” is a chrome gradient with no canvas painter — it can style the app, but the Studio cannot draw it.`,
        }
      }
      const clip: StudioClip = {
        id: uid(),
        kind: 'background',
        track: 0,
        startSec: nextFreeStart(doc, 0, atSec, 4),
        durationSec: 4,
        name: known.name,
        transitionIn: 'fade',
        transitionOut: 'fade',
        opacity: 1,
        backgroundId: known.id,
      }
      return { ok: true, clip, message: `“${known.name}” dropped onto the stage.` }
    }

    case 'animation': {
      const anim = TEXT_ANIMATIONS.find((a) => a.id === payload.id)
      if (!anim) return { ok: false, reason: `The renderer has no text animation called “${payload.id}”.` }
      const clip = defaultTextClip(nextFreeStart(doc, topTrack, atSec, 3), topTrack)
      clip.anim = anim.id
      clip.text = payload.name
      return { ok: true, clip, message: `New caption using “${anim.name}”.` }
    }

    case 'transition': {
      const transition = TRANSITIONS.find((t) => t.id === payload.id)
      if (!transition) return { ok: false, reason: `The renderer has no transition called “${payload.id}”.` }
      return {
        ok: false,
        reason: `“${transition.name}” is a transition — drop it on a clip in the timeline, or set it in the inspector. It has nothing to attach to on an empty stage.`,
      }
    }

    case 'effect': {
      const cue = String((payload.data as { promptCue?: string } | undefined)?.promptCue ?? payload.description ?? '')
      const clip = defaultTextClip(nextFreeStart(doc, topTrack, atSec, 3), topTrack)
      clip.text = payload.name
      clip.fontSizePct = 6
      return {
        ok: true,
        clip,
        message: cue
          ? `“${payload.name}” added as a titled beat — its prompt cue is on the clip name for the generator.`
          : `“${payload.name}” added as a titled beat.`,
      }
    }

    case 'component':
      // Lab demos are live React, not pixels. The honest answer is to say what
      // the path actually is rather than drop an empty overlay on the canvas.
      return {
        ok: false,
        reason: `“${payload.name}” is a live React demo. Open it in the Lab and use “Send to Studio” to capture it as an overlay frame — the canvas cannot mount React components.`,
      }

    case 'template':
      return {
        ok: false,
        reason: `“${payload.name}” is an HTML scene rendered by the desktop pipeline, not a canvas clip. Use it from the Render screen.`,
      }

    case 'source':
      return { ok: false, reason: `“${payload.name}” is a reference link, not editable material.` }

    default:
      return { ok: false, reason: `Cupric does not know how to place a “${payload.kind}” item on the stage yet.` }
  }
}
