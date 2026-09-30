/**
 * Frame arithmetic for the studio timeline (Phase 1.3).
 *
 * The complaint this file answers is subtle and specific: the playhead used to
 * be a bare number of seconds. Every seek, scrub, trim and keyframe landed on an
 * arbitrary float, so the preview drew a state that is *between* two frames —
 * a position the exporter can never produce. What you saw was not what you got,
 * by up to a frame, and on a 30 fps timeline the two obvious symptoms are a
 * clip trimmed to "1.000 s" exporting 30 frames instead of 30-and-a-something,
 * and frame stepping that drifts because it adds 1/30.0 to an already-off time.
 *
 * Everything here is pure and integer-backed: a frame is an integer index, a
 * time is a frame divided by the project's frame rate, and rounding only ever
 * happens once, in `frameOf`. The functions are used by the preview, the ruler,
 * the keyboard and the command layer, so all four agree on where frame 12 is.
 *
 * One deliberate detail: times are rounded to microseconds (6 decimal places)
 * rather than kept as raw `n / fps` floats. `1 / 30` accumulated fifty times is
 * 1.6666666666666665, and two branches that compute the same frame by different
 * routes must compare equal — the exporter already rounds millisecond values
 * before writing them, and the timeline matches that resolution.
 */
import type { StudioDoc } from '../../types/project'
import { docDuration, snapToFrame } from './doc'

/** Microsecond resolution: the finest value the app ever stores. */
const RESOLUTION = 1e6
/**
 * The rounding lives in `doc.ts` (`snapToFrame(t, fps)`), which is the primitive
 * the timeline's snapping, `normaliseClip` and `splitClipAt` already use. Two
 * implementations of "which frame is this time on" would eventually disagree;
 * this file adds the frame *indices*, the document bounds and the readout on top
 * of that one.
 */
const toTime = (frame: number, fps: number) => snapToFrame(frame / fps, fps)

/** The project's frame rate, defended against a document that lost it. */
export function fpsOf(doc: Pick<StudioDoc, 'fps'>): number {
  const fps = Number(doc?.fps)
  return Number.isFinite(fps) && fps > 0 ? fps : 30
}

/**
 * The frame index a playhead time sits on.
 *
 * `Math.round`, not `Math.floor`: the playhead is a position, not a bucket, and
 * a time 1.6 ms past a frame boundary is closer to that frame than the next one.
 * Rounding keeps `frameOf(timeOfFrame(n)) === n` exact for every n, which is the
 * property the step buttons and the round trip in the tests rely on.
 */
export function frameOf(doc: Pick<StudioDoc, 'fps'>, t: number): number {
  const fps = fpsOf(doc)
  const time = Number.isFinite(t) ? t : 0
  return Math.max(0, Math.round(time * fps))
}

/** The exact time of a frame index — the only place a time is derived from one. */
export function timeOfFrame(doc: Pick<StudioDoc, 'fps'>, frame: number): number {
  return toTime(Math.max(0, Math.round(Number.isFinite(frame) ? frame : 0)), fpsOf(doc))
}

/**
 * Snap a time onto the frame it is nearest, bounded by the document.
 *
 * This is the playhead's snap (and the split's): it clamps to the last frame the
 * document can draw, because a playhead past the end would show a frame the
 * export cannot contain. Clip times do **not** go through this — dropping a clip
 * at the end legitimately makes the document longer, so `commands.ts` uses
 * `snapTime` from `doc.ts`, which snaps to a frame without an upper bound.
 */
export function snapPlayhead(doc: StudioDoc, t: number): number {
  const duration = docDuration(doc)
  const clamped = Math.min(Math.max(Number.isFinite(t) ? t : 0, 0), duration)
  const frame = Math.min(frameOf(doc, clamped), lastFrame(doc))
  return Math.min(timeOfFrame(doc, frame), duration)
}

/** The last frame the export can contain, given the document's length. */
export function lastFrame(doc: StudioDoc): number {
  // A 3.000 s / 30 fps document renders frames 0..89; frame 90 is one frame past
  // the end, and its time equals the document duration exactly.
  return Math.max(0, Math.ceil(docDuration(doc) * fpsOf(doc)) - 1)
}

/** Move the playhead by whole frames. `n` may be negative. */
export function stepFrames(doc: StudioDoc, t: number, n: number): number {
  const target = frameOf(doc, t) + Math.round(n)
  return timeOfFrame(doc, Math.min(Math.max(target, 0), lastFrame(doc)))
}

/** Snap a duration to whole frames, never to zero and never to a fractional frame. */
export function snapDurationToFrames(doc: Pick<StudioDoc, 'fps'>, seconds: number, minSeconds: number): number {
  const fps = fpsOf(doc)
  const frames = Math.max(1, Math.round(seconds * fps))
  return Math.max(minSeconds, toTime(frames, fps))
}

/**
 * "1:23.4 · frame 41" — the readout shown next to the playhead.
 *
 * The frame number is the point: with it on screen, "did my trim land where I
 * meant" is answerable without exporting and scrubbing the result.
 */
export function formatFrame(doc: Pick<StudioDoc, 'fps'>, t: number): string {
  const fps = fpsOf(doc)
  const frame = frameOf(doc, t)
  const seconds = frame / fps
  const minutes = Math.floor(seconds / 60)
  const rest = seconds - minutes * 60
  return `${minutes}:${rest.toFixed(1).padStart(4, '0')} · frame ${frame}`
}
