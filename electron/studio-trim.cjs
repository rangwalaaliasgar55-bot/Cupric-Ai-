/**
 * Making the exported file the length of the edit — not the length of the take.
 *
 * The desktop Studio export is a **real-time capture**: the offscreen renderer
 * draws the timeline while MediaRecorder records the compositor. That is what
 * keeps audio and motion in sync, and it is also why the file can be longer than
 * the timeline: the recorder stops a frame or two after the last one was drawn,
 * and on a machine with no GPU (a CI runner draws 1080x1920 in software) those
 * frames take measurably longer than 1/fps. Measured on the Windows runner: a
 * 3.0s edit produced a 3.97s file on one run and ~3.0s on the next, with no code
 * change in between.
 *
 * A file that is 30 % longer than the timeline is wrong in a way the user can
 * see (a second of frozen frame at the end) and in a way the app should not
 * announce as "Saved". FFmpeg already runs on every MP4 export, so the trim is
 * one argument — and, because this module is pure, the exact argv the app uses
 * can be run against the real FFmpeg by `scripts/check-studio-trim.mjs`.
 *
 * Two rules this file exists to keep:
 *
 *   1. **The timeline is the authority.** The expected length of the output is
 *      what the user edited, never what the recorder happened to produce. A
 *      recording that is too SHORT is not padded (FFmpeg cannot invent frames);
 *      it is reported, because the file then cannot contain the whole edit.
 *   2. **Never claim a length that was not produced.** `plan()` returns the
 *      number the verification pass must check the file against, so "Saved" and
 *      the timeline agree.
 */

/** How far the finished file may differ from the timeline before it is wrong. */
const DEFAULT_TOLERANCE_SEC = 0.75

/** FFmpeg accepts fractional seconds; three decimals is a frame at 1000 fps. */
function formatSeconds(value) {
  return (Math.round(value * 1000) / 1000).toFixed(3)
}

/**
 * What to cut, and what to check the result against.
 *
 * @param {object} input
 * @param {number|null} input.docDurationSec  the timeline's own length, if known
 * @param {number|null} input.recordingDurationSec  what the recorder produced
 * @param {number} [input.toleranceSec]
 */
function plan({ docDurationSec = null, recordingDurationSec = null, toleranceSec = DEFAULT_TOLERANCE_SEC } = {}) {
  const target = Number(docDurationSec)
  const recorded = Number(recordingDurationSec)
  const hasTarget = Number.isFinite(target) && target > 0
  const hasRecording = Number.isFinite(recorded) && recorded > 0

  if (!hasTarget) {
    // Nothing to cut to. The recording is the only length anyone can name, and
    // the log says so rather than inventing a target.
    return {
      apply: false,
      targetSec: null,
      expectedDurationSec: hasRecording ? recorded : null,
      toleranceSec,
      reason: hasRecording ? 'the timeline length was not reported, so the file keeps the recording length' : 'no length is known for either the timeline or the recording',
    }
  }

  if (!hasRecording) {
    return {
      apply: true,
      targetSec: target,
      expectedDurationSec: target,
      toleranceSec,
      reason: 'the recording could not be measured; the export is cut to the timeline',
    }
  }

  const overrun = recorded - target
  if (overrun <= toleranceSec) {
    return {
      apply: false,
      // Still cut it: a recording inside tolerance is a rounding difference, and
      // leaving a few stray frames at the end of an edit is never what anyone
      // wants. `apply: false` here only means there is nothing interesting to
      // report.
      targetSec: target,
      expectedDurationSec: target,
      toleranceSec,
      reason: overrun <= 0
        ? 'the recording is within a frame of the timeline'
        : `the recording ran ${overrun.toFixed(2)}s past the timeline, inside the ${toleranceSec}s tolerance`,
      overrunSec: overrun,
    }
  }

  return {
    apply: true,
    targetSec: target,
    expectedDurationSec: target,
    toleranceSec,
    reason: `the recording ran ${overrun.toFixed(2)}s past the ${target.toFixed(2)}s timeline (a real-time capture on a slow machine), so it is cut to the edit`,
    overrunSec: overrun,
  }
}

/**
 * The argument that does the cutting, or nothing when there is no target.
 *
 * Placed before the output file, which is where FFmpeg reads an output option.
 */
function trimArgs(planResult) {
  const target = Number(planResult?.targetSec)
  if (!Number.isFinite(target) || target <= 0) return []
  return ['-t', formatSeconds(target)]
}

/**
 * The whole MP4 command, exactly as `electron/main.cjs` runs it.
 *
 * Kept here rather than inline in the main process so the real argv can be
 * executed by a test: `scripts/check-studio-trim.mjs` encodes a deliberately
 * over-long recording with these arguments and measures the file that comes out.
 *
 * @param {object} input
 * @param {string} input.source        the recording, on disk
 * @param {string} input.outputPath    where the MP4 goes
 * @param {number} input.fps
 * @param {number} input.targetSec     the timeline length
 * @param {string[]} [input.videoArgs] encoder selection, supplied by the caller
 * @param {string[]} [input.audioArgs] loudness filter, supplied by the caller
 */
function mp4Args({ source, outputPath, fps, targetSec, videoArgs = [], audioArgs = [] }) {
  const rate = Number(fps) > 0 ? Math.round(Number(fps)) : 30
  return [
    '-y',
    '-hide_banner',
    '-v', 'error',
    '-i', source,
    '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2:flags=lanczos,setsar=1',
    ...videoArgs,
    '-r', String(rate),
    '-movflags', '+faststart',
    ...audioArgs,
    // 48 kHz on every path: loudnorm works at 192 kHz and would otherwise hand the
    // encoder 96 kHz, so an export with a target and one without would differ in rate.
    '-c:a', 'aac',
    '-ar', '48000',
    '-b:a', '192k',
    ...trimArgs({ targetSec }),
    outputPath,
  ]
}

module.exports = { plan, trimArgs, mp4Args, formatSeconds, DEFAULT_TOLERANCE_SEC }
