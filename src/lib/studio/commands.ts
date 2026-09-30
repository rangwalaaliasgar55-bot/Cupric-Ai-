/**
 * The timeline command layer (Phase 1.3).
 *
 * Phase 1.3 asked for drag/trim/reorder/split with a command-pattern undo stack.
 * The app already had undo — a snapshot stack that is genuinely harder to get
 * wrong than hand-written inverses, and it stays the engine underneath. What it
 * did not have is a *command*: every gesture called `patchClip` directly, and
 * undo steps were separated by a 700 ms wall-clock window on identical labels.
 * That is wrong in a way users notice. Drag a clip slowly, pause to look at
 * something, keep dragging: one gesture, two undo steps. Undo once and the clip
 * is somewhere you never put it. Undo the second time and it is gone.
 *
 * So this module introduces the command value: an edit that knows its own name
 * and, crucially, its own *merge key*. A gesture keeps one merge key from
 * pointer-down to pointer-up, which makes the undo boundary follow the gesture
 * instead of the clock. Two separate drags carry different keys and are
 * therefore always two steps, no matter how fast you drag them.
 *
 * Every function here is pure. `applyTimelineCommand` is `(doc, command) →
 * { doc, changed, reason? }` and nothing else — no store, no React, no I/O — so
 * the whole edit surface can be tested without a window, which is exactly what
 * `src/tests/timeline-commands.test.ts` does.
 */
import type { StudioClip, StudioDoc, StudioMediaClip } from '../../types/project'
import { MIN_CLIP_SEC, placeClip, reorderTracks, settleClip, snapTime, splitClipAt, trackIsFree, clipEnd } from './doc'
import { snapDurationToFrames, snapPlayhead } from './frames'
import { markerTimes } from './timelineOps'
import { moveWithGroup } from './editTools'

/**
 * Times are stored at microsecond resolution — the same resolution frames.ts
 * uses to turn a frame index into a time. Rounding to milliseconds here would
 * undo that: frame 209 of a 30 fps timeline is 6.966667 s, and a millisecond
 * round leaves a value that no longer sits exactly on a frame. It is still the
 * same frame after rounding, but the invariant "a stored time is exactly
 * frame ÷ fps" is what lets the preview, the ruler and the exporter agree, and
 * it costs nothing to keep.
 */
const micro = (v: number) => Math.round(v * 1e6) / 1e6

export type EditResult = { doc: StudioDoc; changed: boolean; reason?: string }
const same = (doc: StudioDoc, reason: string): EditResult => ({ doc, changed: false, reason })

/**
 * A timeline edit, as a value.
 *
 * `gesture` is the merge key. Commands from one continuous gesture share it and
 * collapse into a single undo step; a fresh gesture gets a fresh key (the
 * timeline mints one per pointer-down) and is always its own step. Commands
 * without a gesture — a toolbar button, a keyboard shortcut — never merge.
 */
export type TimelineCommand =
  | { kind: 'move'; clipId: string; startSec: number; track?: number; gesture?: string }
  | { kind: 'trim'; clipId: string; edge: 'start' | 'end'; atSec: number; gesture?: string }
  | { kind: 'patch'; clipId: string; patch: Partial<StudioClip>; label?: string; gesture?: string }
  | { kind: 'split'; clipId: string; atSec: number }
  | { kind: 'delete'; clipId: string; ripple?: boolean }
  | { kind: 'reorder-tracks'; from: number; to: number }
  | { kind: 'settle'; clipId: string; gesture?: string }
  | { kind: 'move-group'; clipId: string; startSec?: number; track?: number; gesture?: string }

/** What an undo step says, and how it is told apart from its neighbours. */
export type CommandMeta = { label: string; mergeKey: string | null }

const KIND_LABEL: Record<TimelineCommand['kind'], string> = {
  move: 'Move clip',
  'move-group': 'Move group',
  trim: 'Trim clip',
  patch: 'Edit clip',
  split: 'Split clip',
  delete: 'Delete clip',
  'reorder-tracks': 'Reorder tracks',
  settle: 'Settle clip',
}

export function commandMeta(command: TimelineCommand): CommandMeta {
  const label = command.kind === 'patch' && command.label ? command.label : KIND_LABEL[command.kind]
  const gesture = 'gesture' in command ? command.gesture : undefined
  /**
   * The merge key is the gesture itself, and nothing else.
   *
   * Not the kind and not the clip: a single drag can move a clip, settle it onto
   * another layer when the pointer comes up, and move three grouped clips with
   * it, and all of that is one thing the person did. The label comes from the
   * first command of the gesture (they merge into the snapshot that one pushed),
   * so Undo says "move clip" rather than "settle clip" — which is what the
   * gesture was.
   */
  return { label, mergeKey: gesture ?? null }
}

/**
 * Snap a clip's time against clip edges, markers and the playhead.
 *
 * `snapTime` (doc.ts) already rounds to the nearest frame; deliberately no
 * document-length clamp afterwards, because a clip dropped past the end of the
 * timeline extends it rather than being illegal.
 */
function snapFor(doc: StudioDoc, clipId: string, raw: number, playhead: number, pps: number): number {
  const tolerance = Math.max(1 / 60, 8 / Math.max(1, pps))
  return Math.max(0, snapTime(doc, raw, clipId, [playhead, ...markerTimes(doc)], tolerance))
}

export type ApplyOptions = {
  /** Current playhead, offered as a snap target while dragging. */
  playhead?: number
  /** Timeline zoom, which sets the snap tolerance in seconds. */
  pps?: number
}

/**
 * Apply one command. Returns the same document object when nothing changed, so
 * the store can refuse to create an undo step that would appear to do nothing.
 */
export function applyTimelineCommand(doc: StudioDoc, command: TimelineCommand, options: ApplyOptions = {}): EditResult {
  const playhead = options.playhead ?? 0
  const pps = options.pps ?? 60

  switch (command.kind) {
    case 'move': {
      const clip = doc.clips.find((c) => c.id === command.clipId)
      if (!clip) return same(doc, 'That clip is no longer on the timeline.')
      const start = Math.max(0, snapFor(doc, clip.id, command.startSec, playhead, pps))
      const track = Math.round(command.track ?? clip.track)
      if (start === clip.startSec && track === clip.track) return same(doc, 'The clip is already there.')
      const next = { ...clip, startSec: start, track } as StudioClip
      // Dropping onto occupied time lifts the clip onto a free layer rather than
      // hiding clip. `settleClip` is the same rule the app used before this
      // layer existed, so a drag and the pre-drag code agree on the result.
      const moved = { ...doc, clips: doc.clips.map((c) => (c.id === clip.id ? next : c)) }
      const settled = settleClip(moved, clip.id)
      return { doc: settled, changed: true }
    }

    case 'trim': {
      const clip = doc.clips.find((c) => c.id === command.clipId)
      if (!clip) return same(doc, 'That clip is no longer on the timeline.')
      const at = Math.max(0, snapFor(doc, clip.id, command.atSec, playhead, pps))
      if (command.edge === 'start') {
        const cut = at - clip.startSec
        const media = clip.kind === 'video' || clip.kind === 'audio'
        const speed = clip.kind === 'video' ? (clip as StudioMediaClip).speed || 1 : 1
        // Dragging the head to the LEFT extends the clip back into its source,
        // and only that far: there is no footage before the file starts, and the
        // old code happily produced a clip whose first second was a frozen frame.
        const source = media ? Math.max(0, ((clip as StudioMediaClip).trimInSec ?? 0) / speed) : Number.POSITIVE_INFINITY
        if (cut < -source - 1e-6) return same(doc, media ? 'There is no more source before this point.' : 'The clip cannot start before zero.')
        if (cut >= clip.durationSec - MIN_CLIP_SEC) return same(doc, `A clip cannot be shorter than ${MIN_CLIP_SEC}s.`)
        if (cut === 0) return same(doc, 'That trim did not move an edge.')
        const duration = snapDurationToFrames(doc, clip.durationSec - cut, MIN_CLIP_SEC)
        const next = { ...clip, startSec: at, durationSec: duration } as StudioClip
        // Trimming the head of media moves the source in-point with it, or the
        // edit silently skips the beginning of the file instead of hiding it.
        if (media) {
          if (duration === clip.durationSec) return same(doc, 'That trim did not move an edge.')
          // The in-point advances by the amount cut off the head; subtracting
          // here would have played the trimmed-away seconds in the middle of the
          // clip. (Caught by src/tests/timeline-commands.test.ts.)
          ;(next as Partial<StudioMediaClip>).trimInSec = micro(Math.max(0, ((clip as StudioMediaClip).trimInSec ?? 0) + cut * speed))
        }
        if (next.startSec < 0) return same(doc, 'The clip cannot start before zero.')
        if (next.keyframes?.length) {
          next.keyframes = next.keyframes.map((k) => ({ ...k, at: micro(k.at - cut) })).filter((k) => k.at >= -0.001)
        }
        return { doc: { ...doc, clips: doc.clips.map((c) => (c.id === clip.id ? next : c)) }, changed: true }
      }
      const duration = snapDurationToFrames(doc, at - clip.startSec, MIN_CLIP_SEC)
      if (duration === clip.durationSec) return same(doc, 'That trim did not move an edge.')
      const next = { ...clip, durationSec: duration } as StudioClip
      if (next.keyframes?.length) next.keyframes = next.keyframes.filter((k) => k.at <= duration + 0.001)
      return { doc: { ...doc, clips: doc.clips.map((c) => (c.id === clip.id ? next : c)) }, changed: true }
    }

    case 'patch': {
      const clip = doc.clips.find((c) => c.id === command.clipId)
      if (!clip) return same(doc, 'That clip is no longer on the timeline.')
      const merged = { ...clip, ...command.patch } as StudioClip
      const next = {
        ...merged,
        startSec: micro(Math.max(0, merged.startSec)),
        durationSec: micro(Math.max(MIN_CLIP_SEC, merged.durationSec)),
      } as StudioClip
      // A patch that changes nothing is not an edit. Without this, a drag that
      // snaps back to where it started would still cost an undo step. Compared
      // after normalising, so a sub-microsecond wobble is not an edit either.
      if (shallowEqual(clip, next)) return same(doc, 'That changed nothing.')
      return { doc: { ...doc, clips: doc.clips.map((c) => (c.id === clip.id ? next : c)) }, changed: true }
    }

    case 'move-group': {
      const clip = doc.clips.find((c) => c.id === command.clipId)
      if (!clip?.groupId) return same(doc, 'That clip is not part of a group.')
      const start = command.startSec === undefined ? undefined : Math.max(0, snapFor(doc, clip.id, command.startSec, playhead, pps))
      const track = command.track === undefined ? undefined : Math.round(command.track)
      const grouped = moveWithGroup(doc, clip.id, { ...(start === undefined ? {} : { startSec: start }), ...(track === undefined ? {} : { track }) })
      if (!grouped) return same(doc, 'That group did not move.')
      return { doc: grouped, changed: true }
    }

    case 'split': {
      const clip = doc.clips.find((c) => c.id === command.clipId)
      if (!clip) return same(doc, 'Select a clip to split.')
      const at = snapPlayhead(doc, command.atSec)
      const halves = splitClipAt(clip, at)
      if (!halves) return same(doc, `Put the playhead at least ${MIN_CLIP_SEC}s inside the clip to split it.`)
      return {
        doc: { ...doc, clips: doc.clips.flatMap((c) => (c.id === clip.id ? halves : [c])) },
        changed: true,
      }
    }

    case 'delete': {
      const clip = doc.clips.find((c) => c.id === command.clipId)
      if (!clip) return same(doc, 'That clip is already gone.')
      if (!command.ripple) {
        const clips = doc.clips.filter((c) => c.id !== clip.id)
        return { doc: { ...doc, clips }, changed: true }
      }
      // Ripple: everything after it on the same track slides back to close the
      // hole, and markers follow so they stay on the frames they mark.
      const gap = clip.durationSec
      const end = clipEnd(clip)
      const clips = doc.clips
        .filter((c) => c.id !== clip.id)
        .map((c) => (c.track === clip.track && c.startSec >= end - 0.001 ? { ...c, startSec: micro(Math.max(0, c.startSec - gap)) } : c))
      const markers = (doc.markers ?? []).map((m) => (m.at >= end ? { ...m, at: micro(Math.max(0, m.at - gap)) } : m))
      return { doc: { ...doc, clips, markers }, changed: true }
    }

    case 'reorder-tracks': {
      const next = reorderTracks(doc, command.from, command.to)
      return next === doc ? same(doc, 'Those are the same track.') : { doc: next, changed: true }
    }

    case 'settle': {
      const clip = doc.clips.find((c) => c.id === command.clipId)
      if (!clip) return same(doc, 'That clip is no longer on the timeline.')
      const others = { ...doc, clips: doc.clips.filter((c) => c.id !== clip.id) }
      if (trackIsFree(others, clip.track, clip.startSec, clipEnd(clip))) return same(doc, 'Nothing to settle.')
      const placed = placeClip(others, clip)
      return {
        doc: { ...doc, trackCount: placed.trackCount, clips: doc.clips.map((c) => (c.id === clip.id ? placed.clip : c)) },
        changed: true,
      }
    }

    default: {
      // Exhaustiveness: a new command kind must be given a case here rather than
      // silently doing nothing.
      const never: never = command
      return same(doc, `Unhandled timeline command: ${JSON.stringify(never)}`)
    }
  }
}

/** Patches are flat and small; comparing their keys is cheaper than a deep clone. */
function shallowEqual(a: StudioClip, b: StudioClip): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)] as Array<keyof StudioClip>)
  for (const key of keys) {
    const left = a[key]
    const right = b[key]
    if (left === right) continue
    if (Array.isArray(left) && Array.isArray(right) && JSON.stringify(left) === JSON.stringify(right)) continue
    if (typeof left === 'object' && typeof right === 'object' && JSON.stringify(left) === JSON.stringify(right)) continue
    return false
  }
  return true
}

/** A fresh merge key per gesture. The counter is not a source of data — it only
 *  has to differ from the previous one within a session, which a counter does
 *  exactly and a timestamp does almost always. */
let gestureCounter = 0
export function newGesture(kind: string): string {
  gestureCounter += 1
  return `${kind}-${gestureCounter}`
}
