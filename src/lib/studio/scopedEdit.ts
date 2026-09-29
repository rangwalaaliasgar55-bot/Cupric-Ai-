/**
 * Did that edit change only what it was asked to change?
 *
 * Ported from veedstudio/open-edit's `cli/src/commands/scoped-edit.ts`
 * (Apache-2.0 — see THIRD_PARTY_NOTICES.md), which calls this the largest class
 * of defect that is decidable from two documents alone: "I told you to move
 * nothing". Their note is the reason it exists — `--verify` cannot help, because
 * both documents are valid and a caption that moved 40 ms renders exactly as
 * well as one that did not. So the check is a diff with an allow-list, not a
 * render.
 *
 * In Cupric every edit path replaces a whole document — a gate fix, an agent
 * edit, an autonomous stage, a group move — so "only what was asked" is not
 * something the edit can be trusted to have done. This compares the document
 * before and after and names everything that changed, flagging the changes that
 * were not on the list.
 *
 * It judges **intent, not quality**: a change outside the allow-list is not
 * necessarily wrong, it is unasked for, and the caller (a report, a toast, a
 * log line) decides what to do about it. Nothing here mutates a document.
 */
import type { StudioClip, StudioDoc } from '../../types/project'

export type ScopedChangeKind =
  | 'clip-added'
  | 'clip-removed'
  | 'clip-changed'
  | 'doc-changed'

export interface ScopedFieldChange {
  field: string
  before: unknown
  after: unknown
}

export interface ScopedChange {
  kind: ScopedChangeKind
  /** The clip the change belongs to; '' for a document-level change. */
  clipId: string
  label: string
  fields: ScopedFieldChange[]
  /** True when the change was named by the caller's allow-list. */
  allowed: boolean
}

export interface ScopedEditReport {
  /** Every difference, in document order (additions last). */
  changes: ScopedChange[]
  /** The subset nobody asked for. */
  unexpected: ScopedChange[]
  /** Nothing unasked-for changed. */
  ok: boolean
  summary: string
}

export interface ScopedEditOptions {
  /**
   * Clip ids or clip names (case-insensitive) the edit was allowed to touch.
   * A change to any other clip is reported in `unexpected`.
   */
  allow?: string[]
  /**
   * Document-level fields the edit may change (`aspect`, `fps`, `trackCount`,
   * `backgroundId`, `markers`, `title`). Nothing is allowed by default: a fix
   * for one caption has no business re-framing the edit.
   */
  allowDoc?: string[]
  /** Fields to ignore everywhere, e.g. a bookkeeping timestamp. */
  ignoreFields?: string[]
}

/** Clip fields a scoped edit is judged on, by clip kind. */
const COMMON_FIELDS = ['name', 'track', 'startSec', 'durationSec', 'hidden', 'locked', 'transitionIn', 'transitionOut'] as const
const MEDIA_FIELDS = ['trimInSec', 'speed', 'opacity', 'volume', 'fit', 'x', 'y', 'scale'] as const
const TEXT_FIELDS = ['text', 'color', 'fontSizePct', 'align', 'anim', 'captionStyle', 'highlightWord', 'x', 'y', 'weight', 'wordDelaysMs', 'timingSource'] as const

const DOC_FIELDS = ['title', 'aspect', 'fps', 'trackCount', 'backgroundId', 'markers'] as const

function watchedFields(clip: StudioClip): readonly string[] {
  if (clip.kind === 'text') return [...COMMON_FIELDS, ...TEXT_FIELDS]
  return [...COMMON_FIELDS, ...MEDIA_FIELDS]
}

const sameValue = (a: unknown, b: unknown): boolean => {
  if (a === b) return true
  if (a === null || a === undefined || b === null || b === undefined) return (a ?? null) === (b ?? null)
  if (typeof a !== 'object' || typeof b !== 'object') return false
  return JSON.stringify(a) === JSON.stringify(b)
}

/** A value short enough to read in a sentence. */
const show = (value: unknown): string => {
  if (value === undefined) return 'unset'
  if (value === null) return 'none'
  if (typeof value === 'number') return String(Math.round(value * 1000) / 1000)
  if (typeof value === 'string') return value.length > 24 ? `${value.slice(0, 21)}…` : value
  if (Array.isArray(value)) return `${value.length} item(s)`
  if (typeof value === 'boolean') return value ? 'on' : 'off'
  return 'set'
}

const matchesAllow = (clip: StudioClip, before: StudioClip | undefined, allow: string[]): boolean => {
  if (!allow.length) return false
  const needles = allow.map((entry) => entry.trim().toLowerCase()).filter(Boolean)
  const candidates = [clip.id, clip.name, before?.id, before?.name].filter(Boolean).map((value) => String(value).toLowerCase())
  return candidates.some((value) => needles.includes(value))
}

/**
 * Compare two revisions of the same edit and report what moved.
 *
 * `allow` is deliberately generous about *how* a target is named (id or title,
 * so a report can say "Lower third" and a caller can say `clip-7`), and
 * deliberately strict about *what* that permits: only clips named there, and no
 * document-level field unless it is listed in `allowDoc`.
 */
export function diffStudioDoc(baseline: StudioDoc, candidate: StudioDoc, opts: ScopedEditOptions = {}): ScopedEditReport {
  const allow = opts.allow ?? []
  const allowDoc = new Set((opts.allowDoc ?? []).map((field) => field.trim()))
  const ignore = new Set((opts.ignoreFields ?? []).map((field) => field.trim()))
  const before = new Map(baseline.clips.map((clip) => [clip.id, clip]))
  const after = new Map(candidate.clips.map((clip) => [clip.id, clip]))
  const changes: ScopedChange[] = []

  for (const clip of baseline.clips) {
    if (after.has(clip.id)) continue
    changes.push({
      kind: 'clip-removed',
      clipId: clip.id,
      label: `“${clip.name}” was removed`,
      fields: [],
      allowed: matchesAllow(clip, clip, allow),
    })
  }

  for (const clip of candidate.clips) {
    const previous = before.get(clip.id)
    if (!previous) {
      changes.push({
        kind: 'clip-added',
        clipId: clip.id,
        label: `“${clip.name}” was added on track ${clip.track}`,
        fields: [],
        allowed: matchesAllow(clip, previous, allow),
      })
      continue
    }
    const fields: ScopedFieldChange[] = []
    for (const field of watchedFields(clip)) {
      if (ignore.has(field)) continue
      const a = (previous as unknown as Record<string, unknown>)[field]
      const b = (clip as unknown as Record<string, unknown>)[field]
      if (!sameValue(a, b)) fields.push({ field, before: a, after: b })
    }
    if (!fields.length) continue
    const described = fields
      .slice(0, 2)
      .map((change) => `${change.field} ${show(change.before)} → ${show(change.after)}`)
      .join(', ')
    changes.push({
      kind: 'clip-changed',
      clipId: clip.id,
      label: `“${clip.name}”: ${described}${fields.length > 2 ? ` (+${fields.length - 2} more)` : ''}`,
      fields,
      allowed: matchesAllow(clip, previous, allow),
    })
  }

  const docFields: ScopedFieldChange[] = []
  for (const field of DOC_FIELDS) {
    if (ignore.has(field)) continue
    const a = (baseline as unknown as Record<string, unknown>)[field]
    const b = (candidate as unknown as Record<string, unknown>)[field]
    if (!sameValue(a, b)) docFields.push({ field, before: a, after: b })
  }
  if (docFields.length) {
    const described = docFields.map((change) => `${change.field} ${show(change.before)} → ${show(change.after)}`).join(', ')
    changes.push({
      kind: 'doc-changed',
      clipId: '',
      label: `the edit itself: ${described}`,
      fields: docFields,
      allowed: docFields.every((change) => allowDoc.has(change.field)),
    })
  }

  const unexpected = changes.filter((change) => !change.allowed)
  const summary = changes.length
    ? `${changes.length} change(s), ${changes.length - unexpected.length} allowed${unexpected.length ? `, ${unexpected.length} not asked for: ${unexpected[0].label}` : ''}`
    : 'nothing changed'
  return { changes, unexpected, ok: unexpected.length === 0, summary }
}

/**
 * The allow-list a gate report implies: the clips it proposed fixes for.
 * "Fix all" may touch those and nothing else — which is exactly what this
 * function is for.
 */
export function allowListOfReport(report: { findings: Array<{ clipId?: string }> }): string[] {
  return [...new Set(report.findings.map((finding) => finding.clipId).filter((id): id is string => Boolean(id)))]
}
