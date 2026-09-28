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

import type { StudioClip, StudioDoc, StudioKeyframe } from '../../types/project'
import { clampClipPlacement } from './stageBounds'
import { uid } from '../utils'
import { STUDIO_BACKGROUNDS } from './backgrounds'
import { defaultGlassClip, defaultTextClip, nextFreeStart } from './doc'
import { TEXT_ANIMATIONS, TRANSITIONS } from './transitions'
import { planTemplateFill, templateSlots, type TemplateFillData } from './templateFill'
import { findComponent, preferredRecordSec, withComponent } from './components'

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
  | { ok: true; action: 'open-lab'; labSlug: string; message: string }
  | { ok: false; reason: string }

export type ResourceDisposition = 'clip' | 'scene' | 'lab' | 'template' | 'render' | 'font' | 'command' | 'reference'

/**
 * One classification drives every resource badge: it names what Apply (or a
 * drop on the stage) produces — see resourceApply.ts, which implements it.
 */
export function resourceDisposition(kind: string, item?: { source?: string; data?: Record<string, unknown> }): ResourceDisposition {
  if (item?.data?.referenceOnly === true) return 'reference'
  if (item?.data?.nativeAction === 'loader') return 'clip'
  if (kind === 'component') return item && (item.source || item.data?.source || item.data?.provider) ? 'scene' : 'lab'
  if (kind === 'saas-template') return 'template'
  if (['glass', 'background', 'animation', 'effect', 'transition'].includes(kind)) return 'clip'
  if (kind === 'block' || kind === 'icon') return 'scene'
  if (kind === 'template') return 'render'
  if (kind === 'font') return 'font'
  if (kind === 'voice') return 'command'
  return 'reference'
}

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
  // JOB 7 — everything dropped lands on the stage. The inner builder is left
  // alone; every shape it can return passes through one clamp here, so no drop
  // path can forget it and no future drop path can either.
  const result = dropResource(doc, payload, atSec)
  if (!result.ok) return result
  if ('clip' in result) return { ...result, clip: clampClipPlacement(result.clip as never) as StudioClip }
  if ('docPatch' in result && result.docPatch.clips) {
    return { ...result, docPatch: { ...result.docPatch, clips: result.docPatch.clips.map((c) => clampClipPlacement(c as never) as StudioClip) } }
  }
  return result
}

function dropResource(doc: StudioDoc, payload: ResourceDragPayload, atSec: number): DropResult {
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
      if (!doc.clips.length) {
        return {
          ok: false,
          reason: `“${transition.name}” needs a clip. Add media or text first, then drop the transition again.`,
        }
      }
      // Stage drops have no timeline target. Pick the clip edge nearest the
      // playhead so the action is useful and predictable instead of refusing.
      const target = [...doc.clips].sort((a, b) => {
        const distance = (clip: StudioClip) => Math.min(Math.abs(clip.startSec - atSec), Math.abs(clip.startSec + clip.durationSec - atSec))
        return distance(a) - distance(b) || b.startSec - a.startSec
      })[0]
      return {
        ok: true,
        docPatch: {
          clips: doc.clips.map((clip) =>
            clip.id === target.id ? { ...clip, transitionIn: transition.id } as StudioClip : clip,
          ),
        },
        message: `“${transition.name}” applied to the nearest clip, “${target.name}”.`,
      }
    }

    case 'effect': {
      const backgrounds: Record<string, string> = {
        'bg-soft-grid': 'grid-haze',
        'bg-dot-field': 'dot-field',
        'bg-lime-haze': 'lime-void',
        'bg-noise-paper': 'noise-veil',
      }
      const backgroundId = backgrounds[payload.id]
      if (backgroundId) {
        const known = STUDIO_BACKGROUNDS.find((item) => item.id === backgroundId)
        if (!known) return { ok: false, reason: `The native painter for “${payload.name}” is unavailable.` }
        const clip: StudioClip = {
          id: uid(), kind: 'background', track: 0, startSec: nextFreeStart(doc, 0, atSec, 4), durationSec: 4,
          name: known.name, transitionIn: 'fade', transitionOut: 'fade', opacity: 1, backgroundId: known.id,
        }
        return { ok: true, clip, message: `Added the editable “${known.name}” background effect.` }
      }
      if (payload.id === 'tr-mask-wipe') {
        if (!doc.clips.length) return { ok: false, reason: 'Mask Wipe needs a clip. Add media or text first.' }
        const target = [...doc.clips].sort((a, b) => Math.abs(a.startSec - atSec) - Math.abs(b.startSec - atSec))[0]
        return {
          ok: true,
          docPatch: { clips: doc.clips.map((clip) => clip.id === target.id ? { ...clip, transitionIn: 'wipe-left' } as StudioClip : clip) },
          message: `Applied Mask Wipe to “${target.name}”.`,
        }
      }
      if (payload.id === 'tr-scale-overshoot') {
        if (!doc.clips.length) return { ok: false, reason: 'Scale Overshoot needs a visual clip first.' }
        const target = [...doc.clips].reverse().find((clip) => clip.kind !== 'audio' && clip.kind !== 'background')
        if (!target) return { ok: false, reason: 'Scale Overshoot needs a movable visual clip.' }
        const keyframes: StudioKeyframe[] = (target.keyframes ?? []).map(({ scale: _oldScale, ...keyframe }) => keyframe)
        const scaleFrames = [
          { at: 0, scale: 0.92, ease: 'ease-out' as const },
          { at: Math.min(0.18, target.durationSec * 0.25), scale: 1.04, ease: 'ease-out' as const },
          { at: Math.min(0.4, target.durationSec * 0.5), scale: 1, ease: 'ease-in-out' as const },
        ]
        for (const scaleFrame of scaleFrames) {
          const existing = keyframes.find((keyframe) => Math.abs(keyframe.at - scaleFrame.at) < 0.001)
          if (existing) Object.assign(existing, { scale: scaleFrame.scale, ease: scaleFrame.ease })
          else keyframes.push(scaleFrame)
        }
        keyframes.sort((a, b) => a.at - b.at)
        return {
          ok: true,
          docPatch: { clips: doc.clips.map((clip) => clip.id === target.id ? { ...clip, keyframes } as StudioClip : clip) },
          message: `Added three editable scale keyframes to “${target.name}”.`,
        }
      }
      const clip = defaultTextClip(nextFreeStart(doc, topTrack, atSec, 3), topTrack)
      clip.text = payload.id === 'cap-hormozi' ? 'MAKE EVERY WORD COUNT' : payload.id === 'cap-minimal' ? 'A quiet supporting thought' : payload.name
      if (payload.id === 'cap-hormozi') {
        clip.fontSizePct = 9
        clip.fontFamily = 'Space Grotesk Variable'
        clip.weight = 800
        clip.highlightWord = 'WORD'
        clip.anim = 'word-reveal'
      } else if (payload.id === 'cap-minimal') {
        clip.fontSizePct = 4
        clip.y = 0.82
        clip.anim = 'fade-up'
      } else if (payload.id === 'mo-word-reveal') {
        clip.anim = 'word-reveal'
      } else if (payload.id === 'mo-counter-tick') {
        clip.anim = 'typewriter'
      } else {
        return { ok: false, reason: `“${payload.name}” has no native Studio implementation yet.` }
      }
      return { ok: true, clip, message: `Added “${payload.name}” as a fully editable native text effect.` }
    }

    case 'component': {
      // The real component, recorded with its real animation by the Studio's
      // recorder (ComponentRecorderHost) — never a dead placeholder.
      if (!findComponent(payload.id)) return { ok: false, reason: `“${payload.name}” is not a built-in component.` }
      const added = withComponent(doc, payload.id, { startSec: atSec, recordSec: preferredRecordSec(), durationSec: preferredRecordSec() })
      return { ok: true, docPatch: { clips: added.doc.clips, trackCount: added.doc.trackCount }, message: `“${payload.name}” added — recording its real animation.` }
    }

    case 'template':
      return {
        ok: false,
        reason: `“${payload.name}” is an HTML scene rendered by the desktop pipeline, not a canvas clip. Use it from the Render screen.`,
      }

    case 'saas-template': {
      const data = (payload.data ?? {}) as TemplateFillData
      const slots = templateSlots(data)
      if (!slots.length) return { ok: false, reason: `“${payload.name}” has no editable scenes.` }
      // Media slots never block: project footage fills them, else a designed
      // placeholder panel does (see storyboard.ts).
      const plan = planTemplateFill(doc, data, {}, payload.name, { atSec })
      if (!plan.clips.length) return { ok: false, reason: `“${payload.name}” did not produce any clips.` }
      return {
        ok: true,
        docPatch: { clips: plan.doc.clips, trackCount: plan.doc.trackCount },
        message: `Added “${payload.name}” as ${plan.clips.length} editable clips.`,
      }
    }

    case 'source':
      return { ok: false, reason: `“${payload.name}” is a reference link, not editable material.` }

    case 'skill':
      return { ok: false, reason: `“${payload.name}” is an agent skill reference for planning renders, not visual material that can become a clip.` }

    case 'font':
      return { ok: false, reason: `“${payload.name}” is a font catalogue reference. Open its source to install or license the font; it is not embedded clip media.` }

    case 'icon':
      return { ok: false, reason: `“${payload.name}” is an icon-set reference, not an exported SVG or image. Open the source and import an actual icon file.` }

    case 'provider':
      return { ok: false, reason: `“${payload.name}” is a service/provider reference for the generation pipeline, not timeline media.` }

    case 'block':
      return { ok: false, reason: `“${payload.name}” is an upstream UI block reference. Open its source or use a capturable component from the Lab.` }

    case 'voice':
      return { ok: false, reason: `“${payload.name}” is a voice-command phrase. Copy it and use the Studio Voice control; it is not an audio clip.` }

    default:
      return { ok: false, reason: `Cupric does not know how to place a “${payload.kind}” item on the stage yet.` }
  }
}
