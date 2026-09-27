/**
 * Template auto-fill: the review dialog's view of `buildStoryboard`.
 *
 * `missing` lists media slots that had no footage. They no longer block the
 * apply — each receives a designed "drop your media here" panel — because a
 * template that refuses to apply reads as a template that does not work.
 */
import type { StudioClip, StudioDoc } from '../../types/project'
import {
  buildStoryboard,
  type StoryboardOptions,
  type TemplateAssignments,
  type TemplateFillData,
  type TemplateSlot,
} from './storyboard'

export { templateSlots } from './storyboard'
export type { TemplateAssignments, TemplateFillData, TemplateSceneTuple, TemplateSlot, TemplateSlotKind } from './storyboard'

export type TemplateFillPlan = {
  clips: StudioClip[]
  slots: TemplateSlot[]
  /** Media slots that will get a placeholder panel (they do not block). */
  missing: TemplateSlot[]
  changes: string[]
  durationSec: number
  /** The complete next document: apply it as one undoable patch. */
  doc: StudioDoc
  startSec: number
  focusId: string | null
}

/**
 * Pure, non-destructive template planner. It never mutates `doc`; the caller
 * presents `changes` and applies `doc` only after explicit acceptance.
 */
export function planTemplateFill(
  doc: StudioDoc,
  data: TemplateFillData,
  assignments: TemplateAssignments,
  templateName: string,
  opts: StoryboardOptions = {},
): TemplateFillPlan {
  const result = buildStoryboard(doc, data, templateName, assignments, opts)
  return {
    clips: result.clips,
    slots: result.slots,
    missing: result.placeholders,
    changes: result.changes,
    durationSec: result.durationSec,
    doc: result.doc,
    startSec: result.startSec,
    focusId: result.focusId,
  }
}
