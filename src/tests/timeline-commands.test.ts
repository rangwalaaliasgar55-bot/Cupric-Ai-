/**
 * The timeline command layer (Phase 1.3), tested without a window.
 *
 * These tests exist because the bug they guard against is invisible in a
 * screenshot and easy to reintroduce: an undo step boundary that follows the
 * clock instead of the gesture. The first test in `gesture atomicity` is the
 * whole point of the module — hundreds of commands from one drag must collapse
 * into exactly one undo step, and two drags must never collapse into each other.
 *
 * The rest assert the edits themselves: a trim never produces a sub-frame
 * duration, a head trim moves the source in-point with it, a split lands on a
 * frame the exporter can actually draw, and a delete that ripples takes the
 * markers with it.
 */
import { describe, expect, it } from 'vitest'
import { emptyStudioDoc, MIN_CLIP_SEC, clipEnd, docDuration, snapTime } from '../lib/studio/doc'
import { applyTimelineCommand, commandMeta, newGesture, type TimelineCommand } from '../lib/studio/commands'
import { frameOf, lastFrame, snapToFrame, stepFrames, timeOfFrame, formatFrame, snapDurationToFrames } from '../lib/studio/frames'
import type { StudioDoc, StudioMarker, StudioMediaClip } from '../types/project'

/** A three-clip document at 30 fps, entirely on track 0 unless a test moves it. */
function fixture(): StudioDoc {
  const clip = (id: string, startSec: number, durationSec: number, track = 0): StudioMediaClip => ({
    id,
    kind: 'video',
    track,
    startSec,
    durationSec,
    name: id,
    transitionIn: 'none',
    transitionOut: 'none',
    opacity: 1,
    mediaId: `media-${id}`,
    fileName: `${id}.mp4`,
    localPath: null,
    fit: 'cover',
    volume: 1,
    speed: 1,
    trimInSec: 2,
    sourceDurationSec: 30,
  })
  return {
    ...emptyStudioDoc(),
    fps: 30,
    trackCount: 2,
    clips: [clip('a', 0, 2), clip('b', 6, 3)],
    markers: [{ id: 'm1', at: 6.5, label: 'beat', color: 'lime' }] as StudioMarker[],
  }
}

const withClips = (doc: StudioDoc, clips: StudioDoc['clips']): StudioDoc => ({ ...doc, clips })
const clipById = (doc: StudioDoc, id: string) => doc.clips.find((c) => c.id === id)!

describe('frame arithmetic', () => {
  it('maps a frame index to a time and back without drift', () => {
    const doc = fixture()
    for (const frame of [0, 1, 29, 30, 41, 89, 90, 179]) {
      expect(frameOf(doc, timeOfFrame(doc, frame))).toBe(frame)
    }
  })

  it('rounds a time to the nearest frame rather than flooring it', () => {
    const doc = fixture()
    // Frame 30 is at exactly 1.000 s; 1.016 s is 0.5 of a frame past it.
    expect(frameOf(doc, 1.0)).toBe(30)
    expect(frameOf(doc, 1.016)).toBe(30)
    expect(frameOf(doc, 1.017)).toBe(31)
  })

  it('never snaps past the last frame the export can contain', () => {
    const doc = fixture()
    const end = docDuration(doc)
    expect(lastFrame(doc)).toBe(Math.ceil(end * 30) - 1)
    expect(snapToFrame(doc, end + 5)).toBeLessThanOrEqual(end)
    expect(frameOf(doc, snapToFrame(doc, end))).toBeLessThanOrEqual(lastFrame(doc))
  })

  it('steps whole frames in both directions, inside the document', () => {
    const doc = fixture()
    expect(stepFrames(doc, 1, 1)).toBeCloseTo(1 + 1 / 30, 6)
    expect(stepFrames(doc, 1, -1)).toBeCloseTo(1 - 1 / 30, 6)
    expect(stepFrames(doc, 0, -5)).toBe(0)
    expect(stepFrames(doc, docDuration(doc), 1)).toBeLessThanOrEqual(docDuration(doc))
  })

  it('snaps a duration up to a whole frame and never below the minimum', () => {
    const doc = fixture()
    // 0.9966 s is not a frame at 30 fps; it must become 1.000 s (frame 30).
    expect(snapDurationToFrames(doc, 1 - 1 / 300, MIN_CLIP_SEC)).toBeCloseTo(1, 6)
    expect(snapDurationToFrames(doc, 0.0001, MIN_CLIP_SEC)).toBe(MIN_CLIP_SEC)
    expect(snapDurationToFrames(doc, 2, MIN_CLIP_SEC)).toBeCloseTo(2, 6)
  })

  it('labels the playhead with a frame number', () => {
    const doc = fixture()
    expect(formatFrame(doc, 1)).toContain('frame 30')
    expect(formatFrame(doc, 1)).toMatch(/^\d+:\d{2}\.\d · frame \d+$/)
  })
})

describe('timeline commands', () => {
  it('moves a clip to a new start and track', () => {
    const doc = fixture()
    const result = applyTimelineCommand(doc, { kind: 'move', clipId: 'a', startSec: 4, track: 1 })
    expect(result.changed).toBe(true)
    expect(clipById(result.doc, 'a').startSec).toBeCloseTo(4, 3)
    expect(clipById(result.doc, 'a').track).toBe(1)
  })

  it('refuses a move that changes nothing, with a reason', () => {
    const doc = fixture()
    const result = applyTimelineCommand(doc, { kind: 'move', clipId: 'a', startSec: 0, track: 0 })
    expect(result.changed).toBe(false)
    expect(result.reason).toMatch(/already there/i)
    expect(result.doc).toBe(doc)
  })

  it('lifts a clip onto a free layer instead of letting it hide the clip underneath', () => {
    const doc = fixture()
    // Track 0 is occupied 0–2 s by 'a'; dropping 'b' there must not overlap it.
    const result = applyTimelineCommand(doc, { kind: 'move', clipId: 'b', startSec: 0, track: 0 })
    const moved = clipById(result.doc, 'b')
    const other = clipById(result.doc, 'a')
    expect(result.changed).toBe(true)
    const overlap = moved.startSec < clipEnd(other) - 0.005 && clipEnd(moved) > other.startSec + 0.005
    expect(overlap && moved.track === other.track).toBe(false)
  })

  it('trims the tail onto a whole frame', () => {
    const doc = fixture()
    const result = applyTimelineCommand(doc, { kind: 'trim', clipId: 'a', edge: 'end', atSec: 1.49 })
    const clip = clipById(result.doc, 'a')
    expect(result.changed).toBe(true)
    // 1.49 s is frame 45 (1.5 s), not 44 (1.4667 s): rounding, not flooring.
    expect(frameOf(result.doc, clip.durationSec)).toBe(45)
    expect(clip.startSec + clip.durationSec).toBeCloseTo(1.5, 6)
  })

  it('moves the source in-point when the head is trimmed', () => {
    const doc = fixture()
    const result = applyTimelineCommand(doc, { kind: 'trim', clipId: 'a', edge: 'start', atSec: 0.5 })
    const clip = clipById(result.doc, 'a') as StudioMediaClip
    expect(result.changed).toBe(true)
    expect(clip.startSec).toBeCloseTo(0.5, 3)
    expect(clip.durationSec).toBeCloseTo(1.5, 3)
    // The source must advance by the trimmed amount, or the first half second
    // of the file plays in the middle of the clip instead of being cut.
    expect(clip.trimInSec).toBeCloseTo(2.5, 3)
    expect(clip.startSec + clip.durationSec).toBeCloseTo(2, 3)
  })

  it('extends the head back into the source, and no further than the source goes', () => {
    // 'a' starts at 0 with trimInSec 2 — two seconds of source sit before the
    // visible part. Moved to 1.0 s first, so there is room to extend left.
    const doc = fixture()
    const moved = applyTimelineCommand(doc, { kind: 'move', clipId: 'a', startSec: 1 })
    const extended = applyTimelineCommand(moved.doc, { kind: 'trim', clipId: 'a', edge: 'start', atSec: 0.5, gesture: newGesture('trim') })
    const clip = clipById(extended.doc, 'a') as StudioMediaClip
    expect(extended.changed).toBe(true)
    expect(clip.startSec).toBeCloseTo(0.5, 6)
    expect(clip.durationSec).toBeCloseTo(2.5, 6)
    // Half a second of source was consumed: 2.0 → 1.5, and never below zero.
    expect(clip.trimInSec).toBeCloseTo(1.5, 6)

    // A clip with nothing before its in-point cannot be extended at all: asking
    // says so, instead of producing a clip whose first frames repeat one image.
    const bare = withClips(moved.doc, moved.doc.clips.map((c) => (c.id === 'a' ? { ...(c as StudioMediaClip), trimInSec: 0 } : c)))
    const tooFar = applyTimelineCommand(bare, { kind: 'trim', clipId: 'a', edge: 'start', atSec: 0.5 })
    expect(tooFar.changed).toBe(false)
    expect(tooFar.reason).toMatch(/no more source/i)

    // And the timeline has no negative time to trim to: a request before zero is
    // clamped to zero rather than moving the clip off the start of the track.
    const clamped = applyTimelineCommand(bare, { kind: 'trim', clipId: 'a', edge: 'start', atSec: -2 })
    expect(clamped.changed).toBe(false)
  })

  it('refuses a trim that would invert the clip, and says why', () => {
    const doc = fixture()
    const result = applyTimelineCommand(doc, { kind: 'trim', clipId: 'a', edge: 'start', atSec: 5 })
    expect(result.changed).toBe(false)
    expect(result.reason).toMatch(/shorter than/i)
  })

  it('splits on a frame, and refuses at the edges', () => {
    const doc = fixture()
    const split = applyTimelineCommand(doc, { kind: 'split', clipId: 'a', atSec: 1.02 })
    expect(split.changed).toBe(true)
    expect(split.doc.clips).toHaveLength(3)
    const [left, right] = split.doc.clips.filter((c) => c.kind === 'video' && c.name === 'a')
    expect(left.durationSec + right.durationSec).toBeCloseTo(2, 6)
    // The cut is at frame 31, and each half is a whole number of frames.
    expect(frameOf(split.doc, left.durationSec)).toBe(31)
    expect(frameOf(split.doc, right.durationSec)).toBe(29)

    const edge = applyTimelineCommand(doc, { kind: 'split', clipId: 'a', atSec: 0.05 })
    expect(edge.changed).toBe(false)
    expect(edge.reason).toMatch(/inside the clip/i)
  })

  it('deletes without rippling, and separately with rippling that takes the markers', () => {
    const doc = fixture()
    const plain = applyTimelineCommand(doc, { kind: 'delete', clipId: 'a' })
    expect(plain.doc.clips.map((c) => c.id)).not.toContain('a')
    expect(clipById(plain.doc, 'b').startSec).toBe(6)
    expect(plain.doc.markers?.[0].at).toBe(6.5)

    const rippled = applyTimelineCommand(doc, { kind: 'delete', clipId: 'a', ripple: true })
    expect(clipById(rippled.doc, 'b').startSec).toBe(4)
    expect(rippled.doc.markers?.[0].at).toBe(4.5)
  })

  it('reorders tracks and reports a no-op', () => {
    const doc = withClips(fixture(), [])
    expect(applyTimelineCommand(doc, { kind: 'reorder-tracks', from: 0, to: 1 }).changed).toBe(true)
    expect(applyTimelineCommand(doc, { kind: 'reorder-tracks', from: 1, to: 1 }).changed).toBe(false)
  })

  it('patches a clip, and treats an identical patch as no edit at all', () => {
    const doc = fixture()
    const changed = applyTimelineCommand(doc, { kind: 'patch', clipId: 'a', patch: { opacity: 0.5 } })
    expect(clipById(changed.doc, 'a').opacity).toBe(0.5)
    const nothing = applyTimelineCommand(changed.doc, { kind: 'patch', clipId: 'a', patch: { opacity: 0.5 } })
    expect(nothing.changed).toBe(false)
  })

  it('snaps a drag to a neighbouring clip edge inside the tolerance', () => {
    const doc = fixture()
    // 'a' ends at 2.000 s; a drag to 2.03 s with 60 px/s tolerance snaps to it.
    const result = applyTimelineCommand(doc, { kind: 'move', clipId: 'b', startSec: 2.03, track: 1 }, { pps: 60 })
    expect(clipById(result.doc, 'b').startSec).toBeCloseTo(2, 6)
    // Far from any edge, the drag is preserved (rounded to a frame).
    const free = applyTimelineCommand(doc, { kind: 'move', clipId: 'b', startSec: 4.51, track: 1 }, { pps: 60 })
    expect(frameOf(free.doc, clipById(free.doc, 'b').startSec)).toBe(frameOf(free.doc, 4.51))
  })
})

describe('gesture atomicity', () => {
  const gesture = newGesture('drag')

  it('folds a grouped move and the settle that ends it into the drag that started them', () => {
    const a = commandMeta({ kind: 'move', clipId: 'a', startSec: 1, gesture })
    const group = commandMeta({ kind: 'move-group', clipId: 'a', startSec: 1, gesture })
    const settle = commandMeta({ kind: 'settle', clipId: 'a', gesture })
    expect(settle.mergeKey).toBe(a.mergeKey)
    expect(group.mergeKey).toBe(a.mergeKey)
    // Each command still names itself; the *step* is named by whichever command
    // opened it, which for a drag is the move.
    expect(settle.label).toBe('Settle clip')
    expect(a.label).toBe('Move clip')
  })

  it('gives one gesture one merge key and the next gesture a different one', () => {
    const first = commandMeta({ kind: 'move', clipId: 'a', startSec: 1, gesture })
    const second = commandMeta({ kind: 'move', clipId: 'a', startSec: 9, gesture })
    const other = commandMeta({ kind: 'move', clipId: 'a', startSec: 1, gesture: newGesture('drag') })
    expect(first.mergeKey).not.toBeNull()
    expect(first.mergeKey).toBe(second.mergeKey)
    expect(other.mergeKey).not.toBe(first.mergeKey)
    expect(first.label).toBe('Move clip')
  })

  it('does not merge commands that never carried a gesture', () => {
    expect(commandMeta({ kind: 'split', clipId: 'a', atSec: 1 }).mergeKey).toBeNull()
    expect(commandMeta({ kind: 'delete', clipId: 'a' }).mergeKey).toBeNull()
    expect(commandMeta({ kind: 'reorder-tracks', from: 0, to: 1 }).mergeKey).toBeNull()
  })

  it('survives a drag replayed as hundreds of pointer events, ending where the last one said', () => {
    // A real drag: the pointer is sampled every 16 ms while the timeline runs at
    // 30 fps, so several events land on the same frame. The document must end on
    // the frame of the last event, and the number of *edits* must be the number
    // of distinct frames the pointer crossed — not the number of events.
    let doc = fixture()
    let edits = 0
    const samples = 240
    for (let i = 0; i < samples; i += 1) {
      const result = applyTimelineCommand(doc, { kind: 'move', clipId: 'b', startSec: 1 + i / 120, track: 1, gesture })
      if (result.changed) {
        doc = result.doc
        edits += 1
      }
    }
    const expectedFrame = frameOf(doc, 1 + (samples - 1) / 120)
    expect(frameOf(doc, clipById(doc, 'b').startSec)).toBe(expectedFrame)
    // Two seconds of dragging at 30 fps cannot be more than ~60 edits, and each
    // one is a genuine move.
    expect(edits).toBeGreaterThan(50)
    expect(edits).toBeLessThanOrEqual(62)
  })

  it('reports no edit when the same position arrives twice, and a real one when it moves back', () => {
    const doc = fixture()
    const moved = applyTimelineCommand(doc, { kind: 'move', clipId: 'a', startSec: 3, gesture })
    const repeat = applyTimelineCommand(moved.doc, { kind: 'move', clipId: 'a', startSec: 3, gesture })
    expect(repeat.changed).toBe(false)
    // Moving back is a change to the document — but the shared merge key keeps
    // it in the *same* history entry, so one Undo still returns the clip to
    // where the gesture started (see timeline-history.test.ts).
    const back = applyTimelineCommand(moved.doc, { kind: 'move', clipId: 'a', startSec: 0, gesture })
    expect(back.changed).toBe(true)
    expect(clipById(back.doc, 'a').startSec).toBe(0)
  })
})

describe('snapTime stays the single source of snapping', () => {
  it('snaps to zero and to the playhead when asked', () => {
    const doc = fixture()
    expect(snapTime(doc, 0.02, 'a', [5], 0.08)).toBe(0)
    expect(snapTime(doc, 5.02, 'a', [5], 0.08)).toBe(5)
  })
})

describe('commands are exhaustive', () => {
  it('has a label for every kind it declares', () => {
    const kinds: Array<TimelineCommand['kind']> = ['move', 'move-group', 'trim', 'patch', 'split', 'delete', 'reorder-tracks', 'settle']
    for (const kind of kinds) {
      const command = kind === 'move' || kind === 'move-group'
        ? ({ kind, clipId: 'a', startSec: 0 } as TimelineCommand)
        : kind === 'trim'
          ? ({ kind, clipId: 'a', edge: 'end', atSec: 1 } as TimelineCommand)
          : kind === 'patch'
            ? ({ kind, clipId: 'a', patch: {} } as TimelineCommand)
            : kind === 'split'
              ? ({ kind, clipId: 'a', atSec: 1 } as TimelineCommand)
              : kind === 'reorder-tracks'
                ? ({ kind, from: 0, to: 1 } as TimelineCommand)
                : ({ kind, clipId: 'a' } as TimelineCommand)
      expect(commandMeta(command).label.length).toBeGreaterThan(0)
    }
  })
})
