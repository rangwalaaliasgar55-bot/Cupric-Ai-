import type { StudioClip, StudioDoc, StudioTextAnim } from '../../types/project'
import { uid } from '../utils'
import { defaultTextClip, docDuration } from './doc'

export type TemplateSlotKind = 'text' | 'media' | 'logo'
export type TemplateSceneTuple = [text: string, durationSec: number, animation: StudioTextAnim, kind?: TemplateSlotKind]
export type TemplateFillData = { scenes?: TemplateSceneTuple[]; durationSec?: number }
export type TemplateAssignments = Record<string, { text?: string; clipId?: string }>
export type TemplateSlot = {
  id: string
  index: number
  label: string
  kind: TemplateSlotKind
  defaultText: string
  durationSec: number
  animation: StudioTextAnim
}
export type TemplateFillPlan = {
  clips: StudioClip[]
  slots: TemplateSlot[]
  missing: TemplateSlot[]
  changes: string[]
  durationSec: number
}

export function templateSlots(data: TemplateFillData): TemplateSlot[] {
  return (data.scenes ?? []).map(([text, duration, animation, kind = 'text'], index) => ({
    id: `slot-${index + 1}`,
    index,
    label: kind === 'text' ? `Text ${index + 1}` : kind === 'logo' ? 'Logo' : `Media ${index + 1}`,
    kind,
    defaultText: text,
    durationSec: Math.max(0.2, Number(duration) || 3),
    animation,
  }))
}

function retimeKeyframes(clip: StudioClip, durationSec: number) {
  if (!clip.keyframes?.length || clip.durationSec <= 0) return clip.keyframes
  const ratio = durationSec / clip.durationSec
  return clip.keyframes.map((key) => ({ ...key, at: Math.min(durationSec, Math.max(0, key.at * ratio)) }))
}

/**
 * Pure, non-destructive template planner. It never mutates `doc`; the caller
 * presents `changes` and only appends `clips` after explicit acceptance.
 */
export function planTemplateFill(
  doc: StudioDoc,
  data: TemplateFillData,
  assignments: TemplateAssignments,
  templateName: string,
): TemplateFillPlan {
  const slots = templateSlots(data)
  const missing: TemplateSlot[] = []
  const clips: StudioClip[] = []
  const changes: string[] = []
  const textTrack = Math.min(1, doc.trackCount - 1)
  const mediaTrack = 0
  const total = slots.reduce((sum, slot) => sum + slot.durationSec, 0)
  const base = docDuration(doc)
  let cursor = base

  for (const slot of slots) {
    const value = assignments[slot.id] ?? {}
    if (slot.kind === 'text') {
      const clip = defaultTextClip(cursor, textTrack)
      clip.id = uid()
      clip.name = `${templateName} · ${slot.label}`
      clip.text = value.text?.trim() || slot.defaultText
      clip.durationSec = slot.durationSec
      clip.anim = slot.animation
      clip.fontSizePct = clip.text.length > 28 ? 6.5 : 9
      clip.highlightWord = clip.text.split(/\s+/)[0] || null
      clips.push(clip)
      changes.push(`${slot.label}: “${clip.text}” · ${slot.durationSec}s`)
    } else {
      const source = doc.clips.find((clip) => clip.id === value.clipId)
      const allowed = source && (source.kind === 'video' || source.kind === 'image' || source.kind === 'overlay' || source.kind === 'sticker')
      if (!source || !allowed) {
        missing.push(slot)
      } else {
        const clip: StudioClip = {
          ...source,
          id: uid(),
          name: `${templateName} · ${slot.label} · ${source.name}`,
          track: mediaTrack,
          startSec: cursor,
          durationSec: slot.durationSec,
          transitionIn: 'fade',
          transitionOut: 'fade',
          keyframes: retimeKeyframes(source, slot.durationSec),
        }
        clips.push(clip)
        changes.push(`${slot.label}: “${source.name}” auto-fit to ${slot.durationSec}s`)
      }
    }
    cursor += slot.durationSec
  }

  return { clips, slots, missing, changes, durationSec: total }
}
