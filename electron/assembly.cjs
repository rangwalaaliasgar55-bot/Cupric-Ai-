/**
 * The FFmpeg assembly half: joining gated renders, building one soundtrack out of many
 * pieces, laying a track onto a picture at delivery loudness, and assembling an EDL.
 *
 * Ported from veedstudio/open-edit (Apache-2.0 — see THIRD_PARTY_NOTICES.md):
 *   cli/src/commands/concat-chapters.ts   → stream-copy a film out of its chapters
 *   cli/src/commands/mix-audio.ts         → narration/music/sfx with ducking by the voice
 *   cli/src/commands/mux-audio.ts         → loudness decided from a measurement
 *   cli/src/commands/apply-edl.ts, edl.ts → one encode of the kept ranges, crossfaded joins
 *
 * Why this file is PURE — no `child_process`, no `fs`, no Electron. Every decision here is a
 * string, a number or a refusal, so the whole thing can be exercised against real FFmpeg in
 * `scripts/check-assembly.mjs` and then executed by `main.cjs` with the argv it returns. A
 * planner that ran the binary itself could not be tested without one.
 *
 * What is kept from upstream, because it is the part that was learned the hard way:
 *
 *   - `concat-chapters` refuses to stream-copy parts that do not match, because a mismatch
 *     produces a file that plays for one chapter and then glitches — a defect nobody sees
 *     until the whole thing is watched. Cupric's rundown render does have a legitimate
 *     re-encode fallback (a hardware encoder that failed part-way), so the plan RE-ENCODES
 *     and states why instead of refusing; the silent `-c copy` glitch is gone either way.
 *   - `mix-audio` never guesses a duck: the narration bus itself opens the gap, `amix` runs
 *     with `normalize=0` (its default divides every input by the input count, which is why a
 *     mix built without it comes out mysteriously quiet), and every pad is bounded to the
 *     film's own length (`apad` with no bound pads forever).
 *   - `mux-audio` treats loudness as a DECISION with a stated reason: a linear gain from a
 *     measurement pass, loudnorm's dynamic normaliser (which pumps on speech, and is named
 *     as the different processing decision it is), or nothing — and the picture decides the
 *     length, never `-shortest`.
 *   - `apply-edl` snaps every edge UP to its source's frame grid so picture, sound and a
 *     retimed transcript all land on the same instants, cuts the audio's joins with two
 *     linear fades that sum to unity, and refuses a source whose colour tags contradict the
 *     bt709 assumption rather than stamping bt709 over it.
 *
 * Two deliberate departures from upstream, both because Cupric's binaries and callers differ:
 *
 *   - EDL audio delay is written per channel (`adelay=48000S|48000S`) instead of upstream's
 *     `adelay=48000S:all=1`. The `all` option needs ffmpeg ≥ 4.2; every input in this graph
 *     is forced to stereo by `aformat`, so spelling both channels out is the same result on
 *     any build — and it is what made this graph runnable in the sandbox at all, on 7.0.2.
 *   - the loudness target is a parameter (`loudnessPlan({ target })`) rather than a constant,
 *     because Cupric's Studio document already carries `loudnessTarget` (LUFS). The default
 *     is upstream's delivery target: -14 LUFS integrated, -1 dBTP true peak, 11 LU range.
 *
 * `main.cjs` runs the concat plan (render path) and the loudness plan (Studio MP4 export).
 * The mix, the mux and the EDL assembly are ported and verified but not yet called from a UI
 * surface; `docs/AUDIT_2026-09-29_REFERENCES.md` names the intended call sites.
 */

'use strict'

/* ——————————————— concat-chapters: joining renders without a surprise ——————————————— */

/** The demuxer's list format. Single quotes in a path are escaped the way ffmpeg expects. */
function concatList(parts) {
  if (!Array.isArray(parts) || !parts.length) throw new Error('concat: no parts given')
  return parts.map((p) => `file '${String(p).replace(/'/g, "'\\''")}'`).join('\n') + '\n'
}

/**
 * What ffprobe's stream JSON says about a file's shape. The fields are the ones the concat
 * demuxer requires to be identical: codec parameters per stream, plus the canvas and rate.
 */
function shapeFromProbeJson(parsed) {
  const streams = Array.isArray(parsed?.streams) ? parsed.streams : []
  const v = streams.find((s) => s && s.codec_type === 'video') || {}
  const a = streams.find((s) => s && s.codec_type === 'audio') || {}
  return {
    codec: String(v.codec_name ?? ''),
    width: Number(v.width ?? 0),
    height: Number(v.height ?? 0),
    fps: String(v.r_frame_rate ?? ''),
    audioCodec: String(a.codec_name ?? ''),
    sampleRate: String(a.sample_rate ?? ''),
    channels: Number(a.channels ?? 0),
  }
}

/** The ffprobe argv for `shapeFromProbeJson`; `-of json` keeps it one parse, no prose. */
function probeShapeArgs(file) {
  return [
    '-v', 'error',
    '-show_entries', 'stream=codec_name,codec_type,width,height,r_frame_rate,sample_rate,channels',
    '-of', 'json',
    file,
  ]
}

/** What differs between two parts, in words a person can act on. */
function shapeDiff(a, b) {
  const out = []
  if (a.codec !== b.codec) out.push(`video codec ${a.codec || 'none'} vs ${b.codec || 'none'}`)
  if (a.width !== b.width || a.height !== b.height) out.push(`canvas ${a.width}x${a.height} vs ${b.width}x${b.height}`)
  if (a.fps !== b.fps) out.push(`fps ${a.fps || '?'} vs ${b.fps || '?'}`)
  if (a.audioCodec !== b.audioCodec) out.push(`audio codec ${a.audioCodec || 'none'} vs ${b.audioCodec || 'none'}`)
  if (a.sampleRate !== b.sampleRate) out.push(`sample rate ${a.sampleRate || 'none'} vs ${b.sampleRate || 'none'}`)
  if (a.channels !== b.channels) out.push(`channels ${a.channels} vs ${b.channels}`)
  return out
}

/**
 * Stream-copy only when every part's shape matches the first; otherwise re-encode onto one
 * set of parameters and say which parts disagreed and how. `shapes` null = the caller could
 * not probe (no ffprobe): the copy goes ahead as it always did, flagged as unverified rather
 * than reported as checked.
 */
function planConcat({ shapes, encoderSwitched = false } = {}) {
  if (!Array.isArray(shapes) || shapes.length < 2) {
    return { mode: 'copy', reasons: [], unverified: 'fewer than two parts — nothing to compare' }
  }
  const reasons = []
  for (let i = 1; i < shapes.length; i += 1) {
    const diff = shapeDiff(shapes[0], shapes[i])
    if (diff.length) reasons.push(`part ${i + 1} does not match part 1 — ${diff.join(', ')}`)
  }
  if (encoderSwitched) {
    reasons.push('a hardware encoder failed part-way, so the parts did not all come from one encoder')
  }
  if (!reasons.length) return { mode: 'copy', reasons: [] }
  return {
    mode: 'reencode',
    reasons,
    unverified: 'copying streams requires identical codec parameters, so these parts are re-encoded together',
  }
}

/**
 * The ffmpeg argv for a concat plan. `reencodeArgs` is the caller's encoder chain (Cupric
 * keeps its own software/hardware choice); the stream-copy branch takes no codec arguments
 * at all, which is the point of it.
 */
function concatArgs({ mode, listPath, outPath, reencodeArgs = [] }) {
  const head = ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', listPath]
  if (mode === 'copy') return [...head, '-c', 'copy', '-movflags', '+faststart', outPath]
  return [...head, ...reencodeArgs, '-movflags', '+faststart', outPath]
}

/* ——————————————— mix-audio: one soundtrack out of many pieces ——————————————— */

/** `voice` is the bus everything else can duck under. */
const MIX_ROLES = ['voice', 'music', 'sfx', 'ambience']

/**
 * The filtergraph, built as a string so it can be read and tested without running ffmpeg.
 *
 * `adelay` needs a value per channel, `amix` with `normalize=0` keeps levels where the spec
 * put them, and `apad` plus `atrim` fix the total length so a short mix does not shorten the
 * film.
 */
function mixGraph(spec) {
  const tracks = Array.isArray(spec?.tracks) ? spec.tracks : []
  if (!tracks.length) throw new Error('mix-audio: the spec has no tracks')
  if (!Number.isFinite(spec.durationSec) || spec.durationSec <= 0) {
    throw new Error(`mix-audio: durationSec must be a positive number, got ${spec.durationSec}`)
  }
  const parts = []
  const voices = []
  const ducked = []
  const plain = []

  tracks.forEach((t, i) => {
    if (!Number.isFinite(t.atSec) || t.atSec < 0) {
      throw new Error(`mix-audio: "${t.path}" starts at ${t.atSec}s — a start must be a non-negative number`)
    }
    if (t.role !== undefined && !MIX_ROLES.includes(t.role)) {
      throw new Error(`mix-audio: "${t.path}" has role "${t.role}" — the roles are ${MIX_ROLES.join(', ')}`)
    }
    const ms = Math.round(t.atSec * 1000)
    const chain = [`[${i}:a]aresample=48000`, `adelay=${ms}|${ms}`]
    if (t.gainDb) chain.push(`volume=${t.gainDb}dB`)
    if (t.fadeInSec) chain.push(`afade=t=in:st=${t.atSec}:d=${t.fadeInSec}`)
    if (t.fadeOutSec) {
      // Measured from the END of the film, because a cue's own length is not knowable from the spec.
      const at = Math.max(0, spec.durationSec - t.fadeOutSec)
      chain.push(`afade=t=out:st=${at}:d=${t.fadeOutSec}`)
    }
    const l = `a${i}`
    parts.push(`${chain.join(',')}[${l}]`)
    if (t.role === 'voice') voices.push(l)
    else if (t.duck) ducked.push(l)
    else plain.push(l)
  })

  if (ducked.length && !voices.length) {
    throw new Error('mix-audio: a track asks to be ducked, but no track is marked role "voice" to duck it')
  }

  let voiceBus = ''
  if (voices.length) {
    voiceBus = 'vox'
    parts.push(
      voices.length === 1
        ? `[${voices[0]}]anull[${voiceBus}]`
        : `${voices.map((l) => `[${l}]`).join('')}amix=inputs=${voices.length}:normalize=0[${voiceBus}]`,
    )
  }

  const beds = []
  if (ducked.length) {
    // The narration itself opens the gap: a threshold high enough to ignore room tone, a slow
    // release so the bed does not pump between words.
    //
    // THE THRESHOLD IS ABSOLUTE, so how deep the bed dips is set by how loud the VOICE is, not
    // by the gap between them. Measured against the same bed, a voice at -3 dB pulls the mix
    // down ~1.4 dB, at -12 dB ~0.8 dB, and at -24 dB not at all — below the threshold nothing
    // ducks. Level the narration before mixing, or set its gain so it actually crosses; a
    // quiet take silently gets no ducking.
    //
    // The key is padded to the film's length. `sidechaincompress` ends its OUTPUT when the
    // sidechain ends, so an unpadded key truncated the bed at the last word. Music dying when
    // narration stops is the exact opposite of what ducking is for.
    parts.push(`[${voiceBus}]asplit=2[vmix][vkeyraw]`)
    parts.push(`[vkeyraw]apad=whole_dur=${spec.durationSec}[vkey]`)
    const bed = ducked.length === 1 ? ducked[0] : 'beds'
    if (ducked.length > 1) parts.push(`${ducked.map((l) => `[${l}]`).join('')}amix=inputs=${ducked.length}:normalize=0[beds]`)
    parts.push(`[${bed}][vkey]sidechaincompress=threshold=0.03:ratio=8:attack=20:release=600[duckedbed]`)
    beds.push('duckedbed', 'vmix')
  } else if (voiceBus) {
    beds.push(voiceBus)
  }
  beds.push(...plain)

  // `apad` with no bound pads FOREVER, and `atrim` downstream does not always close the graph
  // — a fifty-track stress spec ran ffmpeg for an hour without finishing. Pad to the film's
  // own length instead, so the padding ends on its own and `atrim` only ever has to cut.
  const out = 'mix'
  const tail = `apad=whole_dur=${spec.durationSec},atrim=0:${spec.durationSec},asetpts=N/SR/TB[${out}]`
  parts.push(
    beds.length === 1
      ? `[${beds[0]}]${tail}`
      : `${beds.map((l) => `[${l}]`).join('')}amix=inputs=${beds.length}:normalize=0,${tail}`,
  )

  return { graph: parts.join(';'), out }
}

/** The ffmpeg argv for a mix: one input per track, in the order the graph labels them. */
function mixArgs({ paths, graph, out, outPath }) {
  return [
    '-y', '-hide_banner', '-loglevel', 'error',
    ...paths.flatMap((p) => ['-i', p]),
    '-filter_complex', graph,
    '-map', `[${out}]`,
    '-c:a', 'aac', '-b:a', '192k', '-ar', '48000',
    outPath,
  ]
}

/* ——————————————— mux-audio: the delivery loudness, decided and reported ——————————————— */

/**
 * The delivery target this pipeline aims at: -14 LUFS integrated, -1 dBTP true peak, 11 LU
 * range. It is the level the major social platforms have converged on for upload
 * normalisation; a platform that moves its own target moves these, so they are constants to
 * revisit, not physical facts.
 */
const DELIVERY_TARGET = Object.freeze({ i: -14, tp: -1, lra: 11 })

const targetString = (target) => `loudnorm=I=${target.i}:TP=${target.tp}:LRA=${target.lra}`

/** The one-pass measurement that decides which loudnorm mode is honest to use. */
function loudnormMeasureArgs(source, target = DELIVERY_TARGET) {
  return ['-hide_banner', '-nostats', '-i', source, '-af', `${targetString(target)}:print_format=json`, '-vn', '-f', 'null', '-']
}

/**
 * The JSON summary loudnorm prints, out of the rest of ffmpeg's stderr. Anchored on the
 * block's own first key: a warning printed after it that happens to contain a brace would
 * otherwise shift a last-brace slice and lose the measurement. Null when there is no summary
 * or it does not parse.
 */
function parseLoudnormSummary(stderr) {
  const text = String(stderr ?? '')
  const anchor = text.lastIndexOf('"input_i"')
  const open = anchor === -1 ? -1 : text.lastIndexOf('{', anchor)
  const close = open === -1 ? -1 : text.indexOf('}', anchor)
  if (open === -1 || close === -1) return null
  try {
    return JSON.parse(text.slice(open, close + 1))
  } catch {
    return null
  }
}

const MEASURED_KEYS = ['input_i', 'input_tp', 'input_lra', 'input_thresh', 'target_offset']

/**
 * The summary as numbers, or null when they are unusable. Present is not the same as usable:
 * a silent track reports every key, with `-inf` in some of them. The filter is built from
 * these coerced numbers, never from the summary's strings, so `""` or `" "` cannot
 * interpolate as an empty argument.
 */
function measurementFromSummary(summary) {
  if (!summary || typeof summary !== 'object') return null
  const values = MEASURED_KEYS.map((key) => Number(summary[key]))
  if (values.some((v) => !Number.isFinite(v))) return null
  return {
    input_i: values[0],
    input_tp: values[1],
    input_lra: values[2],
    input_thresh: values[3],
    target_offset: values[4],
  }
}

/**
 * What loudnorm will actually do with a measurement, mirroring its own gate: the linear mode
 * applies only when the gain that reaches the target keeps the true peak under the ceiling,
 * the loudness range is within the limit, and neither the level nor the range measured as
 * exactly zero (a constant level reports a range of 0 LU); otherwise ffmpeg runs its dynamic
 * normaliser without saying so, and the report has to say it instead. (An input under three
 * seconds takes loudnorm's own peak-limited linear gain whatever is passed.)
 */
function decideLoudnorm(measured, target = DELIVERY_TARGET) {
  const { input_i: i, input_tp: tp, input_lra: lra, input_thresh: thresh, target_offset: offset } = measured
  const withMeasurement = `${targetString(target)}:measured_I=${i}:measured_TP=${tp}:measured_LRA=${lra}:measured_thresh=${thresh}:offset=${offset}`
  const gain = target.i - i
  const peakAfter = tp + gain
  const reasons = []
  if (peakAfter > target.tp) {
    reasons.push(`a linear gain of ${gain >= 0 ? '+' : ''}${gain.toFixed(1)} dB would put the true peak at ${peakAfter.toFixed(1)} dBTP (limit ${target.tp})`)
  }
  if (lra > target.lra) reasons.push(`the loudness range is ${lra.toFixed(1)} LU (limit ${target.lra})`)
  if (lra === 0) reasons.push('the loudness range measured as 0 LU (a constant level), which the linear mode refuses')
  else if (i === 0) reasons.push('the integrated loudness measured as exactly 0 LUFS, which the linear mode refuses')
  if (reasons.length) return { mode: 'dynamic', filter: `${withMeasurement}:linear=false`, why: reasons.join('; ') }
  return { mode: 'measured', filter: `${withMeasurement}:linear=true` }
}

const unmeasured = (target, why) => ({ mode: 'dynamic', filter: targetString(target), why })

/**
 * The whole loudness decision: `measured` when the measurement says a linear gain is safe,
 * `dynamic` when loudnorm would run its own normaliser, `none` when nothing should be applied.
 * `note` is the sentence a user sees, and it names what actually ran — a line that claims
 * -14 LUFS after a fallback is a lie the deliverable cannot be checked against.
 */
function loudnessPlan({ target = DELIVERY_TARGET, normalise = true, hasAudio = true, measured = null, measureError = '' } = {}) {
  if (!normalise) return { mode: 'none', filter: null, why: 'not requested', note: '' }
  if (!hasAudio) return { mode: 'none', filter: null, why: 'the source has no audio track — nothing to normalise', note: 'no audio track in the source' }
  if (measureError) {
    const plan = unmeasured(target, `the measurement pass could not run: ${measureError}`)
    return { ...plan, note: `audio corrected dynamically — ${plan.why}` }
  }
  if (!measured) {
    const plan = unmeasured(target, 'the measurement pass printed no readable summary')
    return { ...plan, note: `audio corrected dynamically — ${plan.why}` }
  }
  const decision = decideLoudnorm(measured, target)
  if (decision.mode === 'measured') {
    return { ...decision, note: `audio normalised to ${target.i} LUFS (linear gain from a measurement)` }
  }
  return { ...decision, note: `audio corrected dynamically (loudnorm's per-window normaliser, which pumps on speech) — ${decision.why}` }
}

/** A measured result that is unusable (silence) is left at its own level rather than pinned. */
function silencePlan(target = DELIVERY_TARGET) {
  return {
    mode: 'none',
    filter: null,
    why: 'the track has no measurable loudness (silence or near-silence), so it is left at its own level',
    note: 'audio left as recorded — the track has no measurable loudness (silence or near-silence)',
  }
}

/**
 * The mux argv. The PICTURE decides the length (`-t`), because `-shortest` let a built mix
 * truncate the film: a 2 s track over a 6 s render wrote a 2 s deliverable and exited 0.
 * `-map 1:a:0?` tolerates a source with no audio track, and 48 kHz on every path keeps a
 * chapter muxed without loudnorm from differing in rate from its neighbours.
 */
function muxArgs({ silent, audio, durationSec, filter = null, outPath }) {
  if (!Number.isFinite(durationSec) || durationSec <= 0) {
    throw new Error(`mux-audio: could not read the picture's duration (got ${durationSec})`)
  }
  return [
    '-y', '-hide_banner', '-loglevel', 'error',
    '-i', silent, '-i', audio,
    '-map', '0:v:0', '-map', '1:a:0?', '-c:v', 'copy',
    ...(filter ? ['-af', filter] : []),
    '-c:a', 'aac', '-ar', '48000',
    '-t', String(durationSec),
    '-movflags', '+faststart',
    outPath,
  ]
}

/** The ffprobe argv for the picture's own length; the stream's figure first, the container's second. */
function pictureDurationArgs(file) {
  return [
    ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=duration', '-of', 'csv=p=0', file],
    ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file],
  ]
}

/**
 * The length an export must be cut to: the timeline's own length, never the recording's.
 * MediaRecorder stops on the first animation frame at/after the end, and on a slow machine
 * the stop and the final chunk flush land late — the WebM then runs up to ~1 s past the
 * timeline. Trimming in the MP4 pass (`-t` as an output option, so it bounds audio and
 * picture alike) is the one place that can fix that without touching the recorder.
 * An explicit `durationSec` wins; otherwise the document's last clip end is used; a value
 * that is missing or not positive returns null (no trim, never a zero-length file).
 */
function timelineSeconds(payload) {
  const explicit = Number(payload?.durationSec)
  if (Number.isFinite(explicit) && explicit > 0) return Math.round(explicit * 1000) / 1000
  const clips = Array.isArray(payload?.doc?.clips) ? payload.doc.clips : []
  let end = 0
  for (const c of clips) {
    const e = Number(c?.startSec) + Number(c?.durationSec)
    if (Number.isFinite(e) && e > end) end = e
  }
  return end > 0 ? Math.round(end * 1000) / 1000 : null
}

/** Output-side trim argv for `timelineSeconds`; empty when there is nothing to trim to. */
function trimToTimelineArgs(payload) {
  const sec = timelineSeconds(payload)
  return sec ? ['-t', sec.toFixed(3)] : []
}

/** `loudnorm=I=…` needs a target; Cupric's document stores the integrated value in LUFS. */
function targetFromLufs(lufs) {
  const i = Number(lufs)
  if (!Number.isFinite(i) || i < -30 || i > -8) return null
  return { i: Math.round(i * 10) / 10, tp: DELIVERY_TARGET.tp, lra: DELIVERY_TARGET.lra }
}

/* ——————————————— apply-edl: the kept ranges of an EDL, in one encode ——————————————— */

/** One kept interval of one source, in that source's own seconds. */
function assertRanges(ranges) {
  if (!Array.isArray(ranges) || ranges.length === 0) throw new Error('the EDL has no ranges')
  ranges.forEach((range, index) => {
    // ffmpeg reads a negative trim start as the whole clip, so the assembled file would be
    // longer than promised.
    if (range.start < 0) throw new Error(`range ${index} of "${range.source}" starts at ${range.start}, before the file begins`)
    if (!(range.end > range.start)) {
      throw new Error(`range ${index} of "${range.source}" ends at ${range.end}, which is not after its start ${range.start}`)
    }
  })
}

const describeValue = (value) => (typeof value === 'string' ? `"${value}"` : JSON.stringify(value) ?? String(value))

const isStringMap = (value) =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
  && Object.values(value).every((v) => typeof v === 'string' && v !== '')

/** Shape-check a parsed EDL. `origin` names the file in every message. */
function parseEdl(raw, origin = 'edl') {
  const bad = (what, value) => new Error(`${origin}: ${what} — got ${describeValue(value)}`)
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw bad('an EDL is a JSON object', raw)
  const o = raw
  if (!isStringMap(o.sources)) throw bad('"sources" must map each id to a video path', o.sources)
  const sources = o.sources
  if (o.transcripts !== undefined && !isStringMap(o.transcripts)) throw bad('"transcripts" must map ids to transcript paths', o.transcripts)
  if (!Array.isArray(o.ranges)) throw bad('"ranges" must be an array', o.ranges)
  const ranges = o.ranges.map((entry, index) => {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) throw bad(`range ${index} must be an object`, entry)
    const { source, start, end, note } = entry
    if (typeof source !== 'string' || !Object.prototype.hasOwnProperty.call(sources, source)) {
      throw bad(`range ${index} names a source the "sources" map has no entry for`, source)
    }
    for (const [name, value] of [['start', start], ['end', end]]) {
      if (typeof value !== 'number' || !Number.isFinite(value)) throw bad(`range ${index} "${name}" must be a number of seconds`, value)
    }
    if (note !== undefined && typeof note !== 'string') throw bad(`range ${index} "note" must be text`, note)
    return { source, start, end, ...(note === undefined ? {} : { note }) }
  })
  assertRanges(ranges)
  return { sources, ...(o.transcripts === undefined ? {} : { transcripts: o.transcripts }), ranges }
}

/** The distinct sources, in first-use order. */
const sourceOrder = (ranges) => [...new Set(ranges.map((r) => r.source))]

/**
 * Both edges moved UP to the next frame instant. ffmpeg's `trim` keeps the frames whose time
 * is at or after `start` and before `end`, so a range cut between frames keeps a whole number
 * of frames that `end - start` does not describe; audio cut to the raw edges then differs
 * from the picture by up to a frame per range, in either direction, and the drift grows with
 * every join. On the grid, picture, sound and the retimed transcript are all exactly
 * `end - start` long.
 */
function snapToFrames(range, fps, index = 0) {
  const up = (t) => Math.ceil(t * fps - 1e-6) / fps
  const snapped = { ...range, start: up(range.start), end: up(range.end), fps }
  if (!(snapped.end > snapped.start)) {
    throw new Error(`range ${index} of "${range.source}" (${range.start}-${range.end}) is shorter than one frame at ${fps} fps`)
  }
  return snapped
}

/** Every range on its source's grid; `fpsBySource` is probed once per source, never per range. */
function snapRanges(ranges, fpsBySource) {
  return ranges.map((range, index) => {
    const fps = typeof fpsBySource?.get === 'function' ? fpsBySource.get(range.source) : fpsBySource?.[range.source]
    if (fps === undefined) throw new Error(`no frame rate known for source "${range.source}"`)
    return snapToFrames(range, fps, index)
  })
}

/**
 * Where each range's input is opened: every range is its OWN input, seeked to a whole second
 * at least one second before it starts. One input shared by every range made the graph buffer
 * whatever a reordered edit needed later. The seek is coarse on purpose: the graph's trim
 * defines the edge, and the second of margin keeps that edge inside what was decoded.
 */
const inputSeeks = (ranges) => ranges.map((range) => Math.max(0, Math.floor(range.start) - 1))

const ASSUMED_COLOUR = Object.freeze({ primaries: 'bt709', transfer: 'bt709', space: 'bt709' })
const sameTags = (a, b) => a.primaries === b.primaries && a.transfer === b.transfer && a.space === b.space
const describeTags = (t) => `${t.primaries}/${t.transfer}/${t.space}`

/**
 * One colour for the whole output, or a refusal: every source must agree, and a source that
 * declares any axis the bt709 assumption would contradict (an HDR transfer, wide-gamut
 * primaries) is never relabelled by having the rest assumed for it. `colourTagsOf` in this
 * same file produces the reports this reads.
 */
function decideColour(sources) {
  if (!Array.isArray(sources) || !sources.length) throw new Error('decideColour: no sources')
  for (const { id, colour } of sources) {
    if (!colour.assumed) continue
    const contradicted = Object.entries(colour.declared).filter(([axis, value]) => value !== ASSUMED_COLOUR[axis])
    if (contradicted.length > 0) {
      throw new Error(
        `source "${id}" declares ${contradicted.map(([axis, value]) => `${axis} ${value}`).join(' and ')} but not the rest — ` +
          'stamping bt709 over it would mislabel the picture. Tag the file completely before assembling.',
      )
    }
  }
  const first = sources[0]
  for (const { id, colour } of sources.slice(1)) {
    if (!sameTags(colour.tags, first.colour.tags)) {
      throw new Error(
        `sources disagree on colour: "${first.id}" is ${describeTags(first.colour.tags)} and "${id}" is ` +
          `${describeTags(colour.tags)} — convert them to one colour space before assembling.`,
      )
    }
  }
  return first.colour
}

const seconds = (t) => t.toFixed(6)
const AUDIO_RATE = 48000
/** One AAC block at the lowest common source rate: the most a file's audio ends short of its picture by design. */
const AAC_BLOCK_SEC = 1024 / 44100

/**
 * One filter graph: trim every range out of its own input, put each on the same canvas,
 * concat the video, and crossfade the audio by mixing fades rather than with `acrossfade`.
 *
 * The ranges arrive snapped to their source's frame grid, so each keeps a whole number of
 * frames. The VIDEO trim edges sit half a frame before those instants: a frame's timestamp
 * can land a few microseconds either side of k/fps once rounded to the container's timebase,
 * and a boundary exactly on it would keep or drop that frame by luck. The AUDIO is cut on the
 * instants themselves.
 *
 * Every segment but the last takes `crossfadeSec` of EXTRA audio from beyond its out-point,
 * fades out over that tail, and is delayed to its place on the output timeline; the next
 * segment fades in over the same window, and `amix` sums them without renormalising. Two
 * linear fades sum to unity, so the sound that bleeds across a join is the room tone that
 * genuinely followed the last kept frame. The last segment is padded to its snapped length,
 * so the mix is exactly as long as the concatenated video even when the source's audio ends
 * a few milliseconds before its last frame does.
 */
function buildEdlGraph({ ranges, seeks, canvas, colour, crossfadeSec }) {
  const parts = []
  const scale =
    `scale=${canvas.width}:${canvas.height}:force_original_aspect_ratio=decrease:flags=lanczos,` +
    `pad=${canvas.width}:${canvas.height}:(ow-iw)/2:(oh-ih)/2,setsar=1`

  let offset = 0
  ranges.forEach((range, i) => {
    const isLast = i === ranges.length - 1
    const start = range.start - seeks[i]
    const end = range.end - seeks[i]
    const length = range.end - range.start
    const halfFrame = 0.5 / range.fps
    parts.push(
      `[${i}:v]trim=start=${seconds(Math.max(0, start - halfFrame))}:end=${seconds(end - halfFrame)},` +
        `setpts=PTS-STARTPTS,${scale}[v${i}]`,
    )
    const audio = [
      `atrim=start=${seconds(start)}:end=${seconds(isLast ? end : end + crossfadeSec)}`,
      'asetpts=PTS-STARTPTS',
      `aformat=sample_rates=${AUDIO_RATE}:channel_layouts=stereo`,
    ]
    if (i > 0) audio.push(`afade=t=in:st=0:d=${seconds(crossfadeSec)}`)
    if (isLast) audio.push(`apad=whole_len=${Math.round(length * AUDIO_RATE)}`)
    else audio.push(`afade=t=out:st=${seconds(length)}:d=${seconds(crossfadeSec)}`)
    // Delayed in SAMPLES: adelay's default unit is whole milliseconds, which is not a frame
    // boundary. Written per channel — upstream's `all=1` needs ffmpeg ≥ 4.2 and every input
    // here is already forced to stereo by the `aformat` above.
    const delay = Math.round(offset * AUDIO_RATE)
    if (delay > 0) audio.push(`adelay=${delay}S|${delay}S`)
    parts.push(`[${i}:a]${audio.join(',')}[a${i}]`)
    offset += length
  })

  // Colour is stamped as frame properties: the encoder takes its tags from the frames it is
  // handed, and the -color_* output options are ignored on the builds this runs against.
  parts.push(
    `${ranges.map((_, i) => `[v${i}]`).join('')}concat=n=${ranges.length}:v=1:a=0,` +
      `setparams=color_primaries=${colour.primaries}:color_trc=${colour.transfer}:colorspace=${colour.space}[vout]`,
  )
  parts.push(
    ranges.length === 1
      ? '[a0]anull[aout]'
      : `${ranges.map((_, i) => `[a${i}]`).join('')}amix=inputs=${ranges.length}:normalize=0:dropout_transition=0[aout]`,
  )

  return { filter: parts.join(';'), videoLabel: '[vout]', audioLabel: '[aout]' }
}

/**
 * The argv for one encode of the whole edit. `-ss` before each `-i` is the coarse seek from
 * `inputSeeks`; `-r` pins the output rate and gives the LAST frame a duration (without it
 * that frame reaches the muxer with none, the mp4 edit list ends a frame early, and players
 * drop the frame).
 */
function edlArgs({ ranges, seeks, paths, graph, videoLabel, audioLabel, outPath, rate, crf = 20 }) {
  return [
    '-nostdin', '-y', '-hide_banner', '-loglevel', 'error',
    ...ranges.flatMap((_, i) => [...(seeks[i] > 0 ? ['-ss', String(seeks[i])] : []), '-i', paths[i]]),
    '-filter_complex', graph,
    '-map', videoLabel, '-map', audioLabel,
    '-r', String(rate),
    '-c:v', 'libx264', '-preset', 'medium', '-crf', String(crf), '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '192k', '-ar', '48000',
    '-movflags', '+faststart',
    outPath,
  ]
}

/**
 * The guards `apply-edl` runs before it encodes anything. Kept as one function returning
 * messages (rather than throwing) so a caller can report every problem at once — the CLI
 * threw on the first, and a person fixing an edit wants the whole list.
 */
function edlProblems({ ranges, sources, crossfadeMs, order }) {
  const problems = []
  const sourceOf = (id) => sources[id]
  const crossfadeSec = crossfadeMs / 1000
  ranges.forEach((range, index) => {
    // A single range emits `anull`, not a crossfade, so it has no minimum beyond being non-empty.
    if (ranges.length > 1 && range.end - range.start <= crossfadeSec) {
      problems.push(
        `range ${index} of "${range.source}" is ${(range.end - range.start).toFixed(3)}s, no longer than the ` +
          `${crossfadeMs}ms crossfade — shorten the crossfade or lengthen the range`,
      )
    }
    const source = sourceOf(range.source)
    if (!source) return
    if (range.end > source.video + 1e-6) {
      problems.push(
        `range ${index} of "${range.source}" ends at ${range.end.toFixed(3)}s but the source's picture is only ` +
          `${source.video.toFixed(3)}s long. Move the out-point earlier.`,
      )
    }
    const isLast = index === ranges.length - 1
    const needed = isLast ? range.end : range.end + crossfadeSec
    // The last range's audio may end short of its snapped end: the snap moves the edge up by
    // less than a frame, and AAC stops on its own block grid rather than on the picture's.
    // Within that the graph pads the sound to the picture; beyond it the out-point is
    // genuinely past the recording.
    const tolerated = isLast ? 1 / range.fps + AAC_BLOCK_SEC : 0
    if (needed > source.audio + tolerated + 1e-6) {
      problems.push(
        isLast
          ? `range ${index} of "${range.source}" ends at ${range.end.toFixed(3)}s but the source's audio is only ` +
            `${source.audio.toFixed(3)}s long. Move the out-point earlier.`
          : `range ${index} of "${range.source}" ends at ${range.end.toFixed(3)}s and its join needs ` +
            `${crossfadeMs}ms more audio, but the source's audio is only ${source.audio.toFixed(3)}s long. ` +
            'Move the out-point earlier, reorder so this range is last, or lower the crossfade.',
      )
    }
  })
  // One frame rate for the whole output: the encode is forced to it, and a source at another
  // rate would have frames dropped or doubled to fit without a word.
  if (order?.length > 1) {
    const first = sourceOf(order[0])
    for (const id of order.slice(1)) {
      const source = sourceOf(id)
      if (!source || !first || Math.abs(source.fps - first.fps) > 1e-6) {
        if (source && first) {
          problems.push(
            `sources disagree on frame rate: "${order[0]}" runs at ${first.rate} fps and "${id}" at ${source.rate} — ` +
              'bring them to one rate first (concatenating with a re-encode does that).',
          )
        }
      }
    }
  }
  return problems
}

/* ——————————————— probe reports: pure readers of ffprobe's JSON ——————————————— */

const known = (value) => (typeof value === 'string' && value !== '' && value !== 'unknown' && value !== 'reserved' ? value : undefined)

/**
 * A source's colour tags. A partially tagged source is not carried through piecemeal: one
 * declared axis with two assumed ones describes a picture that does not exist, so the whole
 * report falls back to the bt709 assumption — which `decideColour` then refuses to stamp over
 * anything that contradicts it.
 */
function colourFromProbeJson(parsed) {
  const stream = Array.isArray(parsed?.streams) ? parsed.streams[0] : undefined
  const declared = {}
  const primaries = known(stream?.color_primaries)
  const transfer = known(stream?.color_transfer)
  const space = known(stream?.color_space)
  if (primaries) declared.primaries = primaries
  if (transfer) declared.transfer = transfer
  if (space) declared.space = space
  if (primaries && transfer && space) return { tags: { primaries, transfer, space }, assumed: false, declared }
  return { tags: ASSUMED_COLOUR, assumed: true, declared }
}

/**
 * A source's frame rate. `fps` is the nominal rate (the grid frames are meant to sit on),
 * `rate` is ffprobe's own rational (`30000/1001` — what `-r` takes without re-approximating a
 * decimal), and `averageFps` is what is actually present per second, equal to `fps` when
 * ffprobe declares no average so a missing figure never reads as a skipped frame.
 */
function frameRateFromProbeJson(parsed) {
  const stream = Array.isArray(parsed?.streams) ? parsed.streams[0] : undefined
  const parse = (value) => {
    const rate = String(value ?? '')
    const [n, d] = rate.split('/').map(Number)
    const fps = d ? n / d : n
    return Number.isFinite(fps) && fps > 0 ? { fps, rate } : null
  }
  const nominal = parse(stream?.r_frame_rate)
  const average = parse(stream?.avg_frame_rate)
  const found = nominal ?? average
  if (!found) throw new Error('ffprobe reports no usable frame rate')
  return { ...found, averageFps: (average ?? found).fps }
}

/** Display dimensions: a quarter-turn rotation tag swaps them, because ffmpeg autorotates before filtering. */
function displaySizeFromProbeJson(parsed) {
  const stream = Array.isArray(parsed?.streams) ? parsed.streams[0] : undefined
  let width = Number(stream?.width)
  let height = Number(stream?.height)
  if (!Number.isFinite(width) || !Number.isFinite(height)) throw new Error(`ffprobe: bad dims "${width}x${height}"`)
  const sideData = Array.isArray(stream?.side_data_list) ? stream.side_data_list : []
  const rotation = sideData.find((s) => s && s.rotation !== undefined)?.rotation
  if (rotation !== undefined && Math.abs(Math.round(Number(rotation))) % 180 === 90) {
    ;[width, height] = [height, width]
  }
  return { width, height }
}

/** The stream's own duration, falling back to the container's when the stream has none (Matroska). */
function durationFromProbeJson(streamParsed, formatParsed) {
  const fromStream = Number(Array.isArray(streamParsed?.streams) ? streamParsed.streams[0]?.duration : NaN)
  if (Number.isFinite(fromStream) && fromStream > 0) return fromStream
  const fromFormat = Number(formatParsed?.format?.duration)
  if (Number.isFinite(fromFormat) && fromFormat > 0) return fromFormat
  return 0
}

const probeArgs = {
  shape: probeShapeArgs,
  frameRate: (file) => ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=r_frame_rate,avg_frame_rate', '-of', 'json', file],
  displaySize: (file) => ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height:stream_side_data=rotation', '-of', 'json', file],
  /**
   * The same question without the rotation side data, for a build that cannot answer it
   * (`stream_side_data` arrived in ffprobe 4.3). Asked only after `displaySize` fails, and the
   * caller is expected to say so: a rotated file then assembles at its stored dimensions.
   */
  displaySizeBasic: (file) => ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'json', file],
  colour: (file) => ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=color_primaries,color_transfer,color_space', '-of', 'json', file],
  audioDuration: (file) => ['-v', 'error', '-select_streams', 'a:0', '-show_entries', 'stream=duration', '-of', 'json', file],
  videoDuration: (file) => ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=duration', '-of', 'json', file],
  formatDuration: (file) => ['-v', 'error', '-show_entries', 'format=duration', '-of', 'json', file],
  hasAudio: (file) => ['-v', 'error', '-select_streams', 'a', '-show_entries', 'stream=index', '-of', 'json', file],
}

const hasAudioFromProbeJson = (parsed) => Array.isArray(parsed?.streams) && parsed.streams.length > 0

module.exports = {
  /* concat */
  concatList,
  shapeFromProbeJson,
  probeShapeArgs,
  shapeDiff,
  planConcat,
  concatArgs,
  /* mix */
  MIX_ROLES,
  mixGraph,
  mixArgs,
  /* mux */
  DELIVERY_TARGET,
  targetString,
  targetFromLufs,
  loudnormMeasureArgs,
  parseLoudnormSummary,
  measurementFromSummary,
  decideLoudnorm,
  loudnessPlan,
  silencePlan,
  muxArgs,
  pictureDurationArgs,
  timelineSeconds,
  trimToTimelineArgs,
  /* edl */
  assertRanges,
  parseEdl,
  sourceOrder,
  snapToFrames,
  snapRanges,
  inputSeeks,
  ASSUMED_COLOUR,
  decideColour,
  buildEdlGraph,
  edlArgs,
  edlProblems,
  AUDIO_RATE,
  AAC_BLOCK_SEC,
  /* probes */
  colourFromProbeJson,
  frameRateFromProbeJson,
  displaySizeFromProbeJson,
  durationFromProbeJson,
  hasAudioFromProbeJson,
  probeArgs,
}
