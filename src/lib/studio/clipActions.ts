/**
 * Clip actions — one pure table behind the timeline context menu, the canvas
 * context menu and the keyboard shortcuts, so all three behave identically.
 *
 * Every action returns the next doc (committed by the caller as ONE undo
 * step with `label`) or a refusal `message` explaining why nothing changed —
 * never a silent no-op. Locked clips refuse every edit except Unlock / Copy.
 */
import type { StudioClip, StudioDoc } from '../../types/project'
import { uid } from '../utils'
import { MAX_TRACKS, clipEnd, placeClip, snapToFrame, splitClipAt } from './doc'
import { rippleDelete } from './timelineOps'

export type ClipActionId =
  | 'copy' | 'cut' | 'paste' | 'duplicate' | 'split' | 'delete' | 'ripple-delete'
  | 'lock' | 'hide' | 'mute' | 'flip-x' | 'flip-y'
  | 'bring-forward' | 'send-backward' | 'to-playhead'

export type ClipMenuItem = { id: ClipActionId; label: string; shortcut?: string; group: 'edit' | 'clip' | 'arrange' | 'state'; disabled?: string }

export type ActionResult = { doc?: StudioDoc; label?: string; clipboard?: StudioClip; select?: string | null; message?: string }

const EDITS = new Set<ClipActionId>(['cut', 'split', 'delete', 'ripple-delete', 'flip-x', 'flip-y', 'bring-forward', 'send-backward', 'to-playhead', 'hide', 'mute'])
const hasAudio = (c: StudioClip) => c.kind === 'video' || c.kind === 'audio'
const visual = (c: StudioClip) => c.kind !== 'audio'

/** Menu for a clip, in order of relevance, with reasons for anything unavailable. */
export function clipMenu(clip: StudioClip, ctx: { time: number; hasClipboard: boolean }): ClipMenuItem[] {
  const lockedWhy = clip.locked ? 'Unlock the clip first' : undefined
  const inside = ctx.time > clip.startSec + 0.05 && ctx.time < clipEnd(clip) - 0.05
  const items: ClipMenuItem[] = [
    { id: 'split', label: 'Split at playhead', shortcut: 'S', group: 'edit', disabled: lockedWhy ?? (inside ? undefined : 'Move the playhead inside the clip') },
    { id: 'duplicate', label: 'Duplicate', shortcut: 'Ctrl+D', group: 'edit' },
    { id: 'copy', label: 'Copy', shortcut: 'Ctrl+C', group: 'edit' },
    { id: 'cut', label: 'Cut', shortcut: 'Ctrl+X', group: 'edit', disabled: lockedWhy },
    { id: 'paste', label: 'Paste at playhead', shortcut: 'Ctrl+V', group: 'edit', disabled: ctx.hasClipboard ? undefined : 'Copy a clip first' },
    { id: 'to-playhead', label: 'Move to playhead', group: 'arrange', disabled: lockedWhy },
    { id: 'bring-forward', label: 'Bring forward (track up)', shortcut: 'Ctrl+]', group: 'arrange', disabled: lockedWhy ?? (clip.track >= MAX_TRACKS - 1 ? 'Already on the top track' : undefined) },
    { id: 'send-backward', label: 'Send backward (track down)', shortcut: 'Ctrl+[', group: 'arrange', disabled: lockedWhy ?? (clip.track <= 0 ? 'Already on the bottom track' : undefined) },
  ]
  if (visual(clip)) {
    items.push(
      { id: 'flip-x', label: clip.flipX ? 'Unflip horizontal' : 'Flip horizontal', group: 'clip', disabled: lockedWhy },
      { id: 'flip-y', label: clip.flipY ? 'Unflip vertical' : 'Flip vertical', group: 'clip', disabled: lockedWhy },
    )
  }
  if (hasAudio(clip)) items.push({ id: 'mute', label: clip.muted ? 'Unmute' : 'Mute', shortcut: 'Ctrl+M', group: 'state', disabled: lockedWhy })
  items.push(
    { id: 'hide', label: clip.hidden ? 'Show' : 'Hide', shortcut: 'Ctrl+H', group: 'state', disabled: lockedWhy },
    { id: 'lock', label: clip.locked ? 'Unlock' : 'Lock', shortcut: 'Ctrl+L', group: 'state' },
    { id: 'delete', label: 'Delete', shortcut: 'Del', group: 'edit', disabled: lockedWhy },
    { id: 'ripple-delete', label: 'Ripple delete (close gap)', shortcut: 'Shift+Del', group: 'edit', disabled: lockedWhy },
  )
  return items
}

const replace = (doc: StudioDoc, clip: StudioClip): StudioDoc => ({ ...doc, clips: doc.clips.map((c) => (c.id === clip.id ? clip : c)) })
/** Re-place a moved clip so it never overlaps another on its track. */
const reposition = (doc: StudioDoc, clip: StudioClip): StudioDoc => {
  const rest = { ...doc, clips: doc.clips.filter((c) => c.id !== clip.id) }
  const placed = placeClip(rest, clip)
  return { ...rest, trackCount: Math.max(doc.trackCount, placed.trackCount), clips: [...rest.clips, placed.clip] }
}

/** Paste a copy of `clip` at `atSec` on the first free track. */
export function pasteClip(doc: StudioDoc, clip: StudioClip, atSec: number): { doc: StudioDoc; id: string } {
  const placed = placeClip(doc, { ...structuredClone(clip), id: uid(), startSec: Math.max(0, Math.round(atSec * 100) / 100), locked: false } as StudioClip)
  return { doc: { ...doc, trackCount: placed.trackCount, clips: [...doc.clips, placed.clip] }, id: placed.clip.id }
}

export function applyClipAction(doc: StudioDoc, clipId: string | null, action: ClipActionId, ctx: { time: number; clipboard: StudioClip | null }): ActionResult {
  if (action === 'paste') {
    if (!ctx.clipboard) return { message: 'Nothing to paste — copy a clip first.' }
    const r = pasteClip(doc, ctx.clipboard, ctx.time)
    return { doc: r.doc, label: 'Paste clip', select: r.id }
  }
  const clip = doc.clips.find((c) => c.id === clipId)
  if (!clip) return { message: 'Select a clip first.' }
  if (clip.locked && EDITS.has(action)) return { message: `“${clip.name}” is locked — unlock it to edit.` }
  switch (action) {
    case 'copy':
      return { clipboard: structuredClone(clip), message: `Copied “${clip.name}”.` }
    case 'cut':
      return { clipboard: structuredClone(clip), doc: { ...doc, clips: doc.clips.filter((c) => c.id !== clip.id) }, label: 'Cut clip', select: null }
    case 'duplicate': {
      const placed = placeClip(doc, { ...structuredClone(clip), id: uid(), startSec: clipEnd(clip), locked: false } as StudioClip)
      return { doc: { ...doc, trackCount: placed.trackCount, clips: [...doc.clips, placed.clip] }, label: 'Duplicate clip', select: placed.clip.id }
    }
    case 'split': {
      const halves = splitClipAt(clip, ctx.time, doc.fps)
      if (!halves) return { message: 'Move the playhead inside the clip to split it.' }
      return { doc: { ...doc, clips: doc.clips.flatMap((c) => (c.id === clip.id ? halves : [c])) }, label: 'Split clip' }
    }
    case 'delete':
      return { doc: { ...doc, clips: doc.clips.filter((c) => c.id !== clip.id) }, label: 'Delete clip', select: null }
    case 'ripple-delete':
      return { doc: rippleDelete(doc, clip.id).doc, label: 'Ripple delete', select: null }
    case 'lock':
      return { doc: replace(doc, { ...clip, locked: !clip.locked }), label: clip.locked ? 'Unlock clip' : 'Lock clip' }
    case 'hide':
      return { doc: replace(doc, { ...clip, hidden: !clip.hidden }), label: clip.hidden ? 'Show clip' : 'Hide clip' }
    case 'mute':
      if (!hasAudio(clip)) return { message: 'This clip has no sound.' }
      return { doc: replace(doc, { ...clip, muted: !clip.muted }), label: clip.muted ? 'Unmute clip' : 'Mute clip' }
    case 'flip-x':
    case 'flip-y': {
      if (!visual(clip)) return { message: 'Audio clips cannot be flipped.' }
      const key = action === 'flip-x' ? 'flipX' : 'flipY'
      return { doc: replace(doc, { ...clip, [key]: !clip[key] } as StudioClip), label: action === 'flip-x' ? 'Flip horizontal' : 'Flip vertical' }
    }
    case 'bring-forward':
    case 'send-backward': {
      const track = clip.track + (action === 'bring-forward' ? 1 : -1)
      if (track < 0 || track >= MAX_TRACKS) return { message: action === 'bring-forward' ? 'Already on the top track.' : 'Already on the bottom track.' }
      return { doc: reposition({ ...doc, trackCount: Math.max(doc.trackCount, track + 1) }, { ...clip, track }), label: action === 'bring-forward' ? 'Bring forward' : 'Send backward' }
    }
    case 'to-playhead':
      return { doc: reposition(doc, { ...clip, startSec: Math.max(0, snapToFrame(ctx.time, doc.fps)) }), label: 'Move to playhead' }
  }
}

/** In-memory clipboard shared by menus and shortcuts. */
let clipboard: StudioClip | null = null
export const getClipboard = () => clipboard
export const setClipboard = (c: StudioClip | null) => { clipboard = c }
