#!/usr/bin/env node
/**
 * check:assembly — the FFmpeg assembly plans, and the files they actually produce.
 *
 * `electron/assembly.cjs` is the ported assembly half of open-edit (Apache-2.0):
 * concat-chapters (stream-copy with a shape precheck), mix-audio (narration/music/sfx with
 * ducking by the voice bus), mux-audio (loudness decided from a measurement) and apply-edl
 * (one encode of the kept ranges, crossfaded joins). It is pure on purpose, so this file can
 * assert the exact graph text and argv, THEN run the same argv against a real FFmpeg and read
 * the files back with ffprobe.
 *
 * The second half is skipped, with a printed reason, when no FFmpeg/ffprobe is available or
 * when the build is too old for the options these graphs use (`amix=normalize`,
 * `apad=whole_dur`, `sidechaincompress`). That skip is stated rather than hidden: a check
 * that silently stops verifying the files is worse than one that says it could not.
 */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(import.meta.url)
const assembly = require(path.join(root, 'electron', 'assembly.cjs'))

let n = 0
const ok = (c, msg) => { assert.ok(c, msg); n += 1 }
const eq = (a, b, msg) => { assert.equal(a, b, msg); n += 1 }
const deepEq = (a, b, msg) => { assert.deepEqual(a, b, msg); n += 1 }
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8')
const say = (...parts) => console.log('  ·', ...parts)
const throws = (fn, pattern, msg) => {
  let error = null
  try { fn() } catch (err) { error = err }
  ok(error && pattern.test(error.message), `${msg} (${error?.message ?? 'no error'})`)
}

/* ——————————————— concat-chapters: the plan ——————————————— */

eq(assembly.concatList(['/a/b c.mp4', "/a/o'brien.mp4"]), "file '/a/b c.mp4'\nfile '/a/o'\\''brien.mp4'\n", 'the concat list escapes a quote and keeps a space')
throws(() => assembly.concatList([]), /no parts given/, 'an empty concat list is refused')

const shapes = (over = {}) => ({ codec: 'h264', width: 1920, height: 1080, fps: '30/1', audioCodec: 'aac', sampleRate: '48000', channels: 2, ...over })
deepEq(assembly.shapeDiff(shapes(), shapes()), [], 'two identical shapes differ in nothing')
deepEq(assembly.shapeDiff(shapes(), shapes({ height: 720, fps: '30000/1001' })), ['canvas 1920x1080 vs 1920x720', 'fps 30/1 vs 30000/1001'], 'a different canvas and rate are named')
deepEq(assembly.shapeDiff(shapes(), shapes({ audioCodec: '', sampleRate: '', channels: 0 })), ['audio codec aac vs none', 'sample rate 48000 vs none', 'channels 2 vs 0'], 'a part with no audio is named as such')

const matched = assembly.planConcat({ shapes: [shapes(), shapes()] })
eq(matched.mode, 'copy', 'matching parts are stream-copied')
deepEq(matched.reasons, [], 'with nothing to explain')
eq(matched.unverified, undefined, 'and nothing unverified')

const mismatched = assembly.planConcat({ shapes: [shapes(), shapes({ width: 1280, height: 720 })] })
eq(mismatched.mode, 'reencode', 'a mismatched part is re-encoded instead of copied')
ok(/part 2 does not match part 1 — canvas 1920x1080 vs 1280x720/.test(mismatched.reasons[0]), 'and the report names the part and the fields')
ok(/copying streams requires identical codec parameters/.test(mismatched.unverified ?? ''), 'with the reason copying would have been wrong')

const switched = assembly.planConcat({ shapes: [shapes(), shapes()], encoderSwitched: true })
eq(switched.mode, 'reencode', 'a part-way hardware-encoder failure re-encodes even when the shapes match')
ok(/a hardware encoder failed part-way/.test(switched.reasons[0]), 'and says why')

const nothingToCompare = assembly.planConcat({ shapes: [shapes()] })
eq(nothingToCompare.mode, 'copy', 'one part is copied')
ok(/fewer than two parts/.test(nothingToCompare.unverified ?? ''), 'and nothing is claimed to have been compared')
const noProbe = assembly.planConcat({ shapes: null })
eq(noProbe.mode, 'copy', 'no ffprobe means the copy goes ahead as it always did')
ok(/nothing to compare/.test(noProbe.unverified ?? ''), 'flagged as unverified rather than reported as checked')

deepEq(assembly.concatArgs({ mode: 'copy', listPath: 'l.txt', outPath: 'out.mp4' }), ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', 'l.txt', '-c', 'copy', '-movflags', '+faststart', 'out.mp4'], 'the copy argv takes no codec arguments at all')
deepEq(
  assembly.concatArgs({ mode: 'reencode', listPath: 'l.txt', outPath: 'out.mp4', reencodeArgs: ['-c:v', 'libx264', '-c:a', 'aac'] }),
  ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', 'l.txt', '-c:v', 'libx264', '-c:a', 'aac', '-movflags', '+faststart', 'out.mp4'],
  'the re-encode argv keeps the caller’s encoder chain',
)
ok(assembly.probeShapeArgs('a.mp4').includes('stream=codec_name,codec_type,width,height,r_frame_rate,sample_rate,channels'), 'the shape probe asks for exactly the fields the demuxer needs')
eq(assembly.shapeFromProbeJson({ streams: [{ codec_type: 'video', codec_name: 'h264', width: 640, height: 360, r_frame_rate: '25/1' }, { codec_type: 'audio', codec_name: 'aac', sample_rate: '44100', channels: 1 }] }).channels, 1, 'the shape reader takes the first video and the first audio')

/* ——————————————— mix-audio: the graph ——————————————— */

throws(() => assembly.mixGraph({ durationSec: 2, tracks: [] }), /the spec has no tracks/, 'a mix with no tracks is refused')
throws(() => assembly.mixGraph({ durationSec: 0, tracks: [{ path: 'v.wav', atSec: 0 }] }), /durationSec must be a positive number, got 0/, 'a mix with no length is refused')
throws(() => assembly.mixGraph({ durationSec: 2, tracks: [{ path: 'v.wav', atSec: -1 }] }), /starts at -1s — a start must be a non-negative number/, 'a negative start is refused')
throws(() => assembly.mixGraph({ durationSec: 2, tracks: [{ path: 'm.wav', atSec: 0, duck: true }] }), /no track is marked role "voice" to duck it/, 'a ducked bed with no voice is refused')
throws(() => assembly.mixGraph({ durationSec: 2, tracks: [{ path: 'x.wav', atSec: 0, role: 'drums' }] }), /the roles are voice, music, sfx, ambience/, 'an unknown role is refused')

const duckedGraph = assembly.mixGraph({
  durationSec: 12,
  tracks: [
    { path: 'vo.wav', atSec: 0, role: 'voice' },
    { path: 'music.wav', atSec: 0, role: 'music', gainDb: -6, duck: true, fadeInSec: 1, fadeOutSec: 2 },
    { path: 'boom.wav', atSec: 3.5, role: 'sfx', gainDb: -3 },
  ],
})
eq(
  duckedGraph.graph,
  '[0:a]aresample=48000,adelay=0|0[v.a]'
    .replace('[v.a]', '[a0]') +
    ';[1:a]aresample=48000,adelay=0|0,volume=-6dB,afade=t=in:st=0:d=1,afade=t=out:st=10:d=2[a1]' +
    ';[2:a]aresample=48000,adelay=3500|3500,volume=-3dB[a2]' +
    ';[a0]anull[vox]' +
    ';[vox]asplit=2[vmix][vkeyraw]' +
    ';[vkeyraw]apad=whole_dur=12[vkey]' +
    ';[a1][vkey]sidechaincompress=threshold=0.03:ratio=8:attack=20:release=600[duckedbed]' +
    ';[duckedbed][vmix][a2]amix=inputs=3:normalize=0,apad=whole_dur=12,atrim=0:12,asetpts=N/SR/TB[mix]',
  'the ducked mix graph is exactly the ported one: per-channel delay, normalize=0, a padded key, and a bounded tail',
)
eq(duckedGraph.out, 'mix', 'and its output label')
ok(/afade=t=out:st=10:d=2/.test(duckedGraph.graph), 'a fade-out is measured from the END of the film, not from the cue’s own start')

const twoVoices = assembly.mixGraph({ durationSec: 5, tracks: [{ path: 'a.wav', atSec: 0, role: 'voice' }, { path: 'b.wav', atSec: 1, role: 'voice' }, { path: 'm.wav', atSec: 0, role: 'music' }] })
ok(/\[a0\]\[a1\]amix=inputs=2:normalize=0\[vox\]/.test(twoVoices.graph), 'two narration takes are summed onto one voice bus')
ok(/\[vox\]\[a2\]amix=inputs=2:normalize=0,apad=whole_dur=5/.test(twoVoices.graph), 'and a plain bed is summed with the bus without renormalising')
ok(!/sidechaincompress/.test(twoVoices.graph), 'nothing ducks when nothing asks to')

const single = assembly.mixGraph({ durationSec: 3, tracks: [{ path: 'only.wav', atSec: 0.25, role: 'voice' }] })
ok(/\[a0\]anull\[vox\];\[vox\]apad=whole_dur=3,atrim=0:3,asetpts=N\/SR\/TB\[mix\]/.test(single.graph), 'one track needs no mixing at all — the bus is a straight line to the bounded tail')
ok(/adelay=250\|250/.test(single.graph), 'a start is written in whole milliseconds for adelay')

deepEq(
  assembly.mixArgs({ paths: ['vo.wav', 'm.wav'], graph: 'g', out: 'mix', outPath: 'out.m4a' }),
  ['-y', '-hide_banner', '-loglevel', 'error', '-i', 'vo.wav', '-i', 'm.wav', '-filter_complex', 'g', '-map', '[mix]', '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', 'out.m4a'],
  'the mix argv feeds one input per track, in label order',
)

/* ——————————————— mux-audio: the loudness decision ——————————————— */

eq(assembly.DELIVERY_TARGET.i, -14, 'the delivery target is -14 LUFS integrated')
eq(assembly.DELIVERY_TARGET.tp, -1, 'with a -1 dBTP true-peak ceiling')
eq(assembly.DELIVERY_TARGET.lra, 11, 'and an 11 LU range limit')
eq(assembly.targetString({ i: -14, tp: -1, lra: 11 }), 'loudnorm=I=-14:TP=-1:LRA=11', 'which builds one filter string')
eq(assembly.targetFromLufs(-16).i, -16, 'a document’s own LUFS target is honoured')
eq(assembly.targetFromLufs(-31), null, 'an out-of-range target is refused rather than clamped')
eq(assembly.targetFromLufs('loud'), null, 'and so is a non-number')
ok(assembly.loudnormMeasureArgs('a.webm').includes('-f') && assembly.loudnormMeasureArgs('a.webm').includes('null'), 'the measurement decodes audio only into the null muxer')

const summaryText = 'noise\n{\n\t"input_i" : "-21.85",\n\t"input_tp" : "-18.06",\n\t"input_lra" : "0.00",\n\t"input_thresh" : "-31.85",\n\t"target_offset" : "0.05"\n}\nwarning: something {odd}\n'
const summary = assembly.parseLoudnormSummary(summaryText)
eq(summary.input_i, '-21.85', 'the measurement summary is found inside the rest of stderr')
eq(assembly.parseLoudnormSummary('nothing here'), null, 'and is null when ffmpeg printed none')
eq(assembly.measurementFromSummary({ input_i: '-inf', input_tp: '-inf', input_lra: '0', input_thresh: '-inf', target_offset: '0' }), null, 'an unmeasurable track is not a measurement')
eq(assembly.measurementFromSummary(summary).input_tp, -18.06, 'and a readable one becomes numbers, never strings')
deepEq(assembly.measurementFromSummary({ input_i: '', input_tp: ' ', input_lra: '0', input_thresh: '0', target_offset: '0' }), { input_i: 0, input_tp: 0, input_lra: 0, input_thresh: 0, target_offset: 0 }, 'an empty string coerces to 0, never to an empty argument')
eq(assembly.decideLoudnorm(assembly.measurementFromSummary({ input_i: '', input_tp: ' ', input_lra: '0', input_thresh: '0', target_offset: '0' })).mode, 'dynamic', 'and a summary of blanks can therefore never produce a linear gain')

const safe = assembly.decideLoudnorm({ input_i: -21.85, input_tp: -18.06, input_lra: 3, input_thresh: -31.85, target_offset: 0.05 })
eq(safe.mode, 'measured', 'a quiet, peak-safe track takes a linear gain')
ok(/:linear=true$/.test(safe.filter), 'built from the measurement')
ok(safe.filter.includes('measured_I=-21.85'), 'including every measured value loudnorm needs')

const peaky = assembly.decideLoudnorm({ input_i: -20, input_tp: -3, input_lra: 5, input_thresh: -30, target_offset: 0 })
eq(peaky.mode, 'dynamic', 'a track whose linear gain would break the peak ceiling is normalised dynamically')
ok(/would put the true peak at -?3\.0 dBTP \(limit -1\)/.test(peaky.why), 'with the number that decided it')

const wide = assembly.decideLoudnorm({ input_i: -20, input_tp: -18, input_lra: 14, input_thresh: -30, target_offset: 0 })
eq(wide.mode, 'dynamic', 'a too-wide loudness range is refused by the linear mode')
ok(/the loudness range is 14\.0 LU \(limit 11\)/.test(wide.why), 'and named')
ok(/the loudness range measured as 0 LU \(a constant level\), which the linear mode refuses/.test(assembly.decideLoudnorm({ input_i: -20, input_tp: -18, input_lra: 0, input_thresh: -30, target_offset: 0 }).why), 'a constant level is refused as loudnorm itself refuses it')
ok(/the integrated loudness measured as exactly 0 LUFS/.test(assembly.decideLoudnorm({ input_i: 0, input_tp: -18, input_lra: 5, input_thresh: -30, target_offset: 0 }).why), 'and so is a level that measured exactly zero')

eq(assembly.loudnessPlan({ normalise: false }).mode, 'none', 'no target requested means nothing is applied')
eq(assembly.loudnessPlan({ hasAudio: false }).note, 'no audio track in the source', 'a silent source is not normalised, and the note says so')
ok(/corrected dynamically — the measurement pass could not run: ffmpeg exploded/.test(assembly.loudnessPlan({ measureError: 'ffmpeg exploded' }).note), 'a measurement that could not run falls back to the dynamic filter and says why')
ok(/no readable summary/.test(assembly.loudnessPlan({ measured: null }).why), 'an unreadable summary is named as such')
ok(/audio normalised to -14 LUFS \(linear gain from a measurement\)/.test(assembly.loudnessPlan({ measured: { input_i: -21.85, input_tp: -18.06, input_lra: 3, input_thresh: -31.85, target_offset: 0.05 } }).note), 'and a linear pass is reported as one')
ok(/pumps on speech/.test(assembly.loudnessPlan({ measured: { input_i: -20, input_tp: -3, input_lra: 5, input_thresh: -30, target_offset: 0 } }).note), 'while a dynamic pass names what it is')
ok(/no measurable loudness/.test(assembly.silencePlan().note), 'silence is left at its own level rather than pinned')

throws(() => assembly.muxArgs({ silent: 'p.mp4', audio: 'a.m4a', durationSec: 0, outPath: 'o.mp4' }), /could not read the picture's duration/, 'a mux without a picture length is refused')
const muxArgv = assembly.muxArgs({ silent: 'p.mp4', audio: 'a.m4a', durationSec: 6.02, filter: 'loudnorm=I=-14', outPath: 'o.mp4' })
deepEq(
  muxArgv,
  ['-y', '-hide_banner', '-loglevel', 'error', '-i', 'p.mp4', '-i', 'a.m4a', '-map', '0:v:0', '-map', '1:a:0?', '-c:v', 'copy', '-af', 'loudnorm=I=-14', '-c:a', 'aac', '-ar', '48000', '-t', '6.02', '-movflags', '+faststart', 'o.mp4'],
  'the mux copies the picture, tolerates a source with no audio, and takes its length from the picture',
)
ok(!muxArgv.includes('-shortest'), 'never -shortest: a short track must not truncate the film')
eq(assembly.muxArgs({ silent: 'p.mp4', audio: 'a.m4a', durationSec: 6, outPath: 'o.mp4' }).includes('-af'), false, 'and a mux with no filter applies none')
eq(assembly.pictureDurationArgs('p.mp4').length, 2, 'the picture duration is asked of the stream first and the container second')
// Studio MP4 pass trims to the timeline (a late MediaRecorder stop overruns by up to ~1 s).
eq(assembly.timelineSeconds({ durationSec: 5 }), 5, 'an explicit timeline length wins')
eq(assembly.timelineSeconds({ doc: { clips: [{ startSec: 0, durationSec: 3 }, { startSec: 2.5, durationSec: 2.25 }] } }), 4.75, 'without one, the last clip end is the length')
eq(assembly.timelineSeconds({ durationSec: 0, doc: { clips: [] } }), null, 'nothing to trim to is null, never zero')
eq(assembly.timelineSeconds({ durationSec: 'x', doc: { clips: [{ startSec: 1, durationSec: 1.23456 }] } }), 2.235, 'garbage falls through to the document, rounded to ms')
assert.deepEqual(assembly.trimToTimelineArgs({ durationSec: 4.75 }), ['-t', '4.750'], 'trim argv is an output -t'); n += 1
assert.deepEqual(assembly.trimToTimelineArgs({}), [], 'no length, no trim'); n += 1
{
  const main = fs.readFileSync(path.join(root, 'electron', 'main.cjs'), 'utf8')
  ok(/assembly\.trimToTimelineArgs\(payload\)/.test(main), 'the Studio MP4 pass applies the timeline trim')
}

/* ——————————————— apply-edl: the contract ——————————————— */

throws(() => assembly.parseEdl([], 'e.json'), /an EDL is a JSON object — got \[\]/, 'an EDL that is not an object is refused')
throws(() => assembly.parseEdl({ sources: { a: 12 }, ranges: [] }, 'e.json'), /"sources" must map each id to a video path/, 'a sources map with a non-path in it is refused')
throws(() => assembly.parseEdl({ sources: {}, ranges: [] }, 'e.json'), /the EDL has no ranges/, 'an EDL with nothing in it is refused for having nothing kept')
throws(() => assembly.parseEdl({ sources: { a: 'a.mp4' } }, 'e.json'), /"ranges" must be an array/, 'a missing ranges list is refused')
throws(() => assembly.parseEdl({ sources: { a: 'a.mp4' }, ranges: [{ source: 'b', start: 0, end: 1 }] }, 'e.json'), /range 0 names a source the "sources" map has no entry for/, 'a range naming an unknown source is refused')
throws(() => assembly.parseEdl({ sources: { a: 'a.mp4' }, ranges: [{ source: 'a', start: 0, end: '1' }] }, 'e.json'), /range 0 "end" must be a number of seconds — got "1"/, 'a non-numeric edge is refused with its value')
throws(() => assembly.parseEdl({ sources: { a: 'a.mp4' }, ranges: [{ source: 'a', start: -1, end: 1 }] }, 'e.json'), /starts at -1, before the file begins/, 'a negative start is refused: ffmpeg would read it as the whole clip')
throws(() => assembly.parseEdl({ sources: { a: 'a.mp4' }, ranges: [{ source: 'a', start: 1, end: 1 }] }, 'e.json'), /ends at 1, which is not after its start 1/, 'an empty range is refused')
throws(() => assembly.parseEdl({ sources: { a: 'a.mp4' }, ranges: [] }, 'e.json'), /the EDL has no ranges/, 'an EDL with nothing kept is refused')
const parsed = assembly.parseEdl({ sources: { a: 'a.mp4' }, transcripts: { a: 'a.json' }, ranges: [{ source: 'a', start: 0.5, end: 2, note: 'opening' }] }, 'e.json')
eq(parsed.ranges[0].note, 'opening', 'a note is carried through untouched')
deepEq(parsed.transcripts, { a: 'a.json' }, 'and so is the transcript map')
eq('note' in assembly.parseEdl({ sources: { a: 'a.mp4' }, ranges: [{ source: 'a', start: 0, end: 1 }] }, 'e.json').ranges[0], false, 'an absent note stays absent')

const forward = assembly.snapToFrames({ source: 'a', start: 0.21, end: 1.9 }, 30, 0)
ok(Math.abs(forward.start - 7 / 30) < 1e-9, `an edge between frames moves UP to the next frame instant (0.21 -> ${forward.start.toFixed(6)})`)
eq(forward.fps, 30, 'and the grid it was snapped to is kept with it')
ok(Math.abs(forward.end - 1.9) < 1e-9, 'an edge already on the grid stays put')
throws(() => assembly.snapToFrames({ source: 'a', start: 1.001, end: 1.002 }, 30, 2), /range 2 of "a" \(1.001-1.002\) is shorter than one frame at 30 fps/, 'a range that falls inside one frame is refused, not rounded into existence')
deepEq(assembly.snapRanges([{ source: 'a', start: 0.21, end: 1.9 }], new Map([['a', 30]])).map((r) => r.start), [7 / 30], 'ranges are snapped against a per-source rate, up to the next frame instant')
throws(() => assembly.snapRanges([{ source: 'a', start: 0, end: 1 }], new Map()), /no frame rate known for source "a"/, 'a source with no known rate is refused, not guessed')
deepEq(assembly.sourceOrder([{ source: 'b' }, { source: 'a' }, { source: 'b' }]), ['b', 'a'], 'sources are ordered by first use, never by listing a directory')
deepEq(assembly.inputSeeks([{ start: 0.5 }, { start: 2.1 }, { start: 7.9 }]), [0, 1, 6], 'each range is seeked one whole second before its start')
eq(assembly.inputSeeks([{ start: 0 }])[0], 0, 'and never before the file')

const tags = { primaries: 'bt709', transfer: 'bt709', space: 'bt709' }
eq(assembly.decideColour([{ id: 'a', colour: { tags, assumed: false, declared: tags } }, { id: 'b', colour: { tags, assumed: false, declared: tags } }]).tags.transfer, 'bt709', 'sources that agree are stamped with that colour')
throws(
  () => assembly.decideColour([{ id: 'a', colour: { tags, assumed: false, declared: tags } }, { id: 'b', colour: { tags: { primaries: 'bt2020', transfer: 'smpte2084', space: 'bt2020nc' }, assumed: false, declared: {} } }]),
  /sources disagree on colour: "a" is bt709\/bt709\/bt709 and "b" is bt2020\/smpte2084\/bt2020nc/,
  'sources that disagree are refused, with both colours named',
)
throws(
  () => assembly.decideColour([{ id: 'a', colour: { tags: assembly.ASSUMED_COLOUR, assumed: true, declared: { transfer: 'smpte2084' } } }]),
  /source "a" declares transfer smpte2084 but not the rest — stamping bt709 over it would mislabel the picture/,
  'a partially tagged source that contradicts bt709 is refused rather than relabelled',
)

const graph = assembly.buildEdlGraph({
  ranges: [
    { source: 'a', start: 0.2, end: 1.9, fps: 30 },
    { source: 'a', start: 2.1, end: 3.7, fps: 30 },
  ],
  seeks: [0, 1],
  canvas: { width: 1080, height: 1920 },
  colour: tags,
  crossfadeSec: 0.04,
})
ok(/\[0:v\]trim=start=0\.183333:end=1\.883333/.test(graph.filter), 'the video trim starts half a frame before the snapped edge')
ok(/\[1:v\]trim=start=1\.083333:end=2\.683333/.test(graph.filter), 'and each range is trimmed out of its own seeked input')
ok(/scale=1080:1920:force_original_aspect_ratio=decrease:flags=lanczos,pad=1080:1920:\(ow-iw\)\/2:\(oh-ih\)\/2,setsar=1/.test(graph.filter), 'every range is put on the output canvas without distortion')
ok(/atrim=start=0\.200000:end=1\.940000,asetpts=PTS-STARTPTS,aformat=sample_rates=48000:channel_layouts=stereo,afade=t=out:st=1\.700000:d=0\.040000/.test(graph.filter), 'a non-last segment takes extra audio past its out-point and fades out over the join')
ok(/\[1:a\]atrim=start=1\.100000:end=2\.700000,asetpts=PTS-STARTPTS,aformat=sample_rates=48000:channel_layouts=stereo,afade=t=in:st=0:d=0\.040000,apad=whole_len=76800,adelay=81600S\|81600S\[a1\]/.test(graph.filter), 'the last segment fades in and is padded to exactly its snapped length in samples')
ok(/adelay=81600S\|81600S/.test(graph.filter), 'the second segment is delayed in SAMPLES, per channel, so a join lands on a frame boundary (81600 samples = 1.7s)')
ok(/\[v0\]\[v1\]concat=n=2:v=1:a=0,setparams=color_primaries=bt709:color_trc=bt709:colorspace=bt709\[vout\]/.test(graph.filter), 'the picture is concatenated once and stamped with one colour')
ok(/\[a0\]\[a1\]amix=inputs=2:normalize=0:dropout_transition=0\[aout\]/.test(graph.filter), 'and the two fades are summed without renormalising: two linear fades make one crossfade')
const singleGraph = assembly.buildEdlGraph({ ranges: [{ source: 'a', start: 0, end: 1, fps: 30 }], seeks: [0], canvas: { width: 320, height: 180 }, colour: tags, crossfadeSec: 0.04 })
ok(!/adelay/.test(singleGraph.filter) && /\[a0\]anull\[aout\]/.test(singleGraph.filter), 'one range needs no delay and no fade')

const edlArgv = assembly.edlArgs({
  ranges: [{ source: 'a', start: 2.1, end: 3.7, fps: 30 }],
  seeks: [1], paths: ['/v/a.mp4'], graph: graph.filter, videoLabel: '[vout]', audioLabel: '[aout]', outPath: '/o/out.mp4', rate: '30/1', crf: 20,
})
deepEq(edlArgv.slice(0, 6), ['-nostdin', '-y', '-hide_banner', '-loglevel', 'error', '-ss'], 'a seeked range opens its input at the coarse seek')
ok(edlArgv.includes('-r') && edlArgv[edlArgv.indexOf('-r') + 1] === '30/1', 'the output rate is pinned, which gives the last frame a duration')
ok(edlArgv.includes('-movflags') && edlArgv.includes('+faststart'), 'and the deliverable starts fast')

const sources = {
  a: { fps: 30, rate: '30/1', averageFps: 30, video: 4, audio: 4 },
  b: { fps: 25, rate: '25/1', averageFps: 25, video: 4, audio: 4 },
}
deepEq(assembly.edlProblems({ ranges: [{ source: 'a', start: 0.5, end: 1, fps: 30 }], sources, crossfadeMs: 40, order: ['a'] }), [], 'a healthy range has no problems')
ok(/no longer than the 40ms crossfade/.test(assembly.edlProblems({ ranges: [{ source: 'a', start: 0, end: 0.04, fps: 30 }, { source: 'a', start: 1, end: 2, fps: 30 }], sources, crossfadeMs: 40, order: ['a'] })[0] ?? ''), 'a range no longer than the crossfade is reported')
ok(/the source's picture is only 4\.000s long/.test(assembly.edlProblems({ ranges: [{ source: 'a', start: 0, end: 6, fps: 30 }], sources, crossfadeMs: 40, order: ['a'] })[0] ?? ''), 'a range past the picture is reported')
const joinProblem = assembly.edlProblems({ ranges: [{ source: 'a', start: 3, end: 4, fps: 30 }, { source: 'a', start: 0, end: 1, fps: 30 }], sources, crossfadeMs: 40, order: ['a'] }).find((m) => /its join needs/.test(m))
ok(Boolean(joinProblem), 'a join that needs audio past the recording is reported')
ok(/Move the out-point earlier, reorder so this range is last, or lower the crossfade/.test(joinProblem ?? ''), 'with the three ways to fix it')
ok(/sources disagree on frame rate: "a" runs at 30\/1 fps and "b" at 25\/1/.test(assembly.edlProblems({ ranges: [{ source: 'a', start: 0, end: 1, fps: 30 }], sources, crossfadeMs: 40, order: ['a', 'b'] })[0] ?? ''), 'a rate mismatch between sources is reported rather than silently resampled')

/* ——————————————— probe readers ——————————————— */

const completeColour = assembly.colourFromProbeJson({ streams: [{ color_primaries: 'bt709', color_transfer: 'bt709', color_space: 'bt709' }] })
eq(completeColour.assumed, false, 'a fully tagged source is not assumed')
eq(completeColour.tags.space, 'bt709', 'and carries its own colour')
const partial = assembly.colourFromProbeJson({ streams: [{ color_primaries: 'bt2020', color_transfer: 'unknown', color_space: '' }] })
eq(partial.assumed, true, 'a partially tagged source falls back to the whole assumption, not piecemeal')
eq(partial.tags.primaries, 'bt709', 'with the assumed tags')
eq(partial.declared.primaries, 'bt2020', 'and the declared axis kept so the assumption can be refused downstream')
deepEq(assembly.colourFromProbeJson({ streams: [{}] }).declared, {}, 'an untagged source declares nothing')

eq(assembly.frameRateFromProbeJson({ streams: [{ r_frame_rate: '30000/1001', avg_frame_rate: '30000/1001' }] }).rate, '30000/1001', 'the rational rate is kept for -r, never re-approximated')
eq(assembly.frameRateFromProbeJson({ streams: [{ r_frame_rate: '25/1', avg_frame_rate: '24/1' }] }).averageFps, 24, 'and the average rate is reported beside the nominal one')
eq(assembly.frameRateFromProbeJson({ streams: [{ avg_frame_rate: '25/1' }] }).averageFps, 25, 'a missing nominal rate falls back to the average rather than reading as a skipped frame')
throws(() => assembly.frameRateFromProbeJson({ streams: [{ r_frame_rate: '0/0' }] }), /no usable frame rate/, 'a file with no usable rate is refused')

deepEq(assembly.displaySizeFromProbeJson({ streams: [{ width: 1920, height: 1080 }] }), { width: 1920, height: 1080 }, 'display size is read as-is')
deepEq(assembly.displaySizeFromProbeJson({ streams: [{ width: 1920, height: 1080, side_data_list: [{ rotation: -90 }] }] }), { width: 1080, height: 1920 }, 'a quarter-turn rotation swaps them, because ffmpeg autorotates before filtering')
eq(assembly.durationFromProbeJson({ streams: [{ duration: '2.5' }] }, { format: { duration: '2.6' } }), 2.5, 'the stream duration wins when it exists')
eq(assembly.durationFromProbeJson({ streams: [{}] }, { format: { duration: '2.6' } }), 2.6, 'the container’s stands in when the stream has none')
eq(assembly.durationFromProbeJson({ streams: [{}] }, {}), 0, 'and zero is reported when neither says')
eq(assembly.hasAudioFromProbeJson({ streams: [{ index: 1 }] }), true, 'an audio stream is seen')
eq(assembly.hasAudioFromProbeJson({ streams: [] }), false, 'and its absence is not a crash')

/* ——————————————— how the app uses it ——————————————— */

const main = read('electron/main.cjs')
ok(/const assembly = require\('\.\/assembly\.cjs'\)/.test(main), 'main.cjs loads the assembly module')
ok(/assembly\.planConcat\(\{ shapes, encoderSwitched/.test(main), 'the render path plans the concat instead of assuming a stream copy')
ok(/assembly\.concatArgs\(\{ mode: plan\.mode/.test(main), 'and runs the argv that plan produced')
ok(/assembly\.probeShapeArgs\(segment\.path\)/.test(main), 'probing each part’s shape before copying')
ok(/logLine\('render-concat'/.test(main), 'and writing the plan, its reasons and anything unverified to the log')
ok(/assembly\.loudnormMeasureArgs\(source, target\)/.test(main), 'the Studio MP4 export measures the recording before deciding its level')
ok(/assembly\.parseLoudnormSummary\(measured\.stderr\)/.test(main), 'reads the measurement summary out of stderr')
ok(/assembly\.measurementFromSummary\(summary\)/.test(main), 'and refuses to build a filter from unreadable numbers')
ok(/assembly\.loudnessPlan\(\{ normalise: false/.test(main), 'no target means nothing is applied, as before')
ok(/loudness: \{ mode: loudness\.mode, note: loudness\.note, why: loudness\.why \}/.test(main), 'and the export reports which correction ran')
ok(/'render:done', \{ jobId: state\.id, outputPath: result\?\.outputPath \|\| null, bytes: result\?\.bytes \|\| null, loudness: result\?\.loudness \|\| null \}/.test(main), 'which reaches the renderer with the export')
ok(!/encoders\.loudnormArgs\(payload\?\.loudnessTarget\)/.test(main), 'and the old dynamic-by-default call is gone from that path')

const exportTs = read('src/lib/studio/export.ts')
ok(/export type LoudnessReport = \{ mode: 'measured' \| 'dynamic' \| 'none'; note: string; why\?: string \}/.test(exportTs), 'the renderer carries the loudness report as a type')
ok(/loudness: event\.loudness \?\? null/.test(exportTs), 'and reads it off the done event')
const studio = read('src/screens/Studio.tsx')
ok(/farm\.loudness && farm\.loudness\.mode !== 'none' \? ` \\u2014 \$\{farm\.loudness\.note\}`/.test(studio), 'the export toast says which correction ran')

/* ——————————————— the real thing ——————————————— */

const exists = (p) => Boolean(p) && fs.existsSync(p)
const safeRequire = (id) => { try { return require(id) } catch { return null } }
const onPath = (name) => (process.env.PATH || '').split(path.delimiter).map((dir) => path.join(dir, name)).find(exists)
const ffmpeg = [process.env.CUPRIC_FFMPEG_PATH, process.env.FFMPEG_PATH, safeRequire('ffmpeg-static'), safeRequire('@ffmpeg-installer/ffmpeg')?.path, onPath('ffmpeg')].find(exists)
const ffprobe = [process.env.CUPRIC_FFPROBE_PATH, process.env.FFPROBE_PATH, safeRequire('ffprobe-static')?.path, onPath('ffprobe')].find(exists)

const skipped = (why) => console.log(`SKIP — ${why}\nthe plan, graph and argv assertions above ran (${n} assertions); the real FFmpeg pass did not.`)
if (!exists(ffmpeg) || !exists(ffprobe)) {
  skipped(`no FFmpeg/ffprobe found (ffmpeg ${ffmpeg ?? 'missing'}, ffprobe ${ffprobe ?? 'missing'}). Set CUPRIC_FFMPEG_PATH / CUPRIC_FFPROBE_PATH, or install ffmpeg-static.`)
  console.log(`assembly check passed — ${n} assertions, real pass skipped`)
  process.exit(0)
}

// spawnSync, not execFileSync: volumedetect and loudnorm print their numbers to STDERR, and
// execFileSync only hands stderr back when the process throws — a successful measurement would
// lose its result (the same reason open-edit's mux-audio measures with spawnSync).
const run = (bin, args) => {
  const result = spawnSync(bin, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  return { code: result.status ?? 1, stdout: String(result.stdout ?? ''), stderr: String(result.stderr ?? '') }
}
const ff = (...args) => run(ffmpeg, args)
const ffprobeJson = (args) => JSON.parse(run(ffprobe, args).stdout || '{}')
const ffprobeNumber = (args) => Number(String(run(ffprobe, args).stdout || '').trim())

const version = (run(ffmpeg, ['-version']).stdout.split('\n')[0] || 'unknown ffmpeg').trim()
const supports = (filterArgs) => ff('-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=duration=0.3', '-af', filterArgs, '-f', 'null', '-').code === 0
const graphSupport = supports('adelay=0|0,apad=whole_dur=0.3,atrim=0:0.3') && supports('amix=inputs=1:normalize=0')
const edlSupport = supports('adelay=4800S|4800S,apad=whole_len=4800,afade=t=in:st=0:d=0.04')
const duckSupport = ff(
  '-hide_banner', '-loglevel', 'error',
  '-f', 'lavfi', '-i', 'sine=frequency=200:duration=0.3',
  '-f', 'lavfi', '-i', 'sine=frequency=800:duration=0.3',
  '-filter_complex', '[0:a]asplit=2[v][k];[1:a][k]sidechaincompress=threshold=0.03:ratio=8[d];[d][v]amix=inputs=2:normalize=0[o]',
  '-map', '[o]', '-f', 'null', '-',
).code === 0

if (!graphSupport || !edlSupport || !duckSupport) {
  skipped(`${version} is too old for the options these graphs use (mix ${graphSupport ? 'ok' : 'unsupported'}, edl ${edlSupport ? 'ok' : 'unsupported'}, ducking ${duckSupport ? 'ok' : 'unsupported'}).`)
  console.log(`assembly check passed — ${n} assertions, real pass skipped`)
  process.exit(0)
}

const work = fs.mkdtempSync(path.join(os.tmpdir(), 'cupric-assembly-'))
const at = (name) => path.join(work, name)
const built = (name, args) => {
  const result = ff('-y', '-hide_banner', '-loglevel', 'error', ...args, at(name))
  if (result.code !== 0) throw new Error(`could not build ${name}: ${result.stderr.slice(-300)}`)
  return at(name)
}
/** A test pattern at `size`, with a tone of its own or silent. */
function makeSegment(name, size, { audio = true, tone = 440, gain = 0, seconds = 2 } = {}) {
  return built(name, [
    '-f', 'lavfi', '-i', `testsrc2=size=${size}:rate=30:duration=${seconds}`,
    ...(audio ? ['-f', 'lavfi', '-i', `sine=frequency=${tone}:duration=${seconds}`, '-af', `volume=${gain}dB`, '-c:a', 'aac', '-ar', '48000', '-ac', '2'] : ['-an']),
    '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p',
  ])
}
/** An audio-only piece, for the mix and mux tests. */
function makeAudio(name, { tone = 440, seconds = 2, gain = 0 } = {}) {
  return built(name, ['-f', 'lavfi', '-i', `sine=frequency=${tone}:duration=${seconds}`, '-af', `volume=${gain}dB`, '-c:a', 'aac', '-ar', '48000'])
}
const durationOf = (file) => ffprobeNumber(['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file])
const streamCounts = (file) => {
  const streams = (ffprobeJson(['-v', 'error', '-show_entries', 'stream=codec_type', '-of', 'json', file]).streams ?? [])
  return { video: streams.filter((s) => s.codec_type === 'video').length, audio: streams.filter((s) => s.codec_type === 'audio').length }
}
const meanVolume = (file, ss, t, filters = []) => {
  const r = run(ffmpeg, ['-hide_banner', '-ss', String(ss), '-t', String(t), '-i', file, '-af', [...filters, 'volumedetect'].join(','), '-f', 'null', '-'])
  const match = /mean_volume:\s*(-?[\d.]+) dB/.exec(r.stderr)
  return match ? Number(match[1]) : NaN
}
const integratedLoudness = (file) => {
  const r = run(ffmpeg, assembly.loudnormMeasureArgs(file, assembly.DELIVERY_TARGET))
  return assembly.measurementFromSummary(assembly.parseLoudnormSummary(r.stderr))
}

try {
  /* ——— concat: matching parts stream-copy, mismatched parts re-encode and still play ——— */
  const partA = makeSegment('part-a.mp4', '320x180', { tone: 440 })
  const partB = makeSegment('part-b.mp4', '320x180', { tone: 660 })
  const probeShape = (file) => assembly.shapeFromProbeJson(ffprobeJson(assembly.probeShapeArgs(file)))
  const plan = assembly.planConcat({ shapes: [probeShape(partA), probeShape(partB)] })
  eq(plan.mode, 'copy', 'two renders of the same shape are stream-copied')
  const listCopy = at('concat-copy.txt')
  fs.writeFileSync(listCopy, assembly.concatList([partA, partB]))
  const copied = at('out-copy.mp4')
  const copyRun = ff(...assembly.concatArgs({ mode: plan.mode, listPath: listCopy, outPath: copied }))
  eq(copyRun.code, 0, 'the copy argv ffmpeg was actually given runs (it is the one main.cjs is handed)')
  const copyDuration = durationOf(copied)
  ok(Math.abs(copyDuration - 4) < 0.15, `the joined file is the sum of its parts (${copyDuration.toFixed(3)}s for 2 x 2s)`)
  deepEq(streamCounts(copied), { video: 1, audio: 1 }, 'with one video and one audio stream, not two of each')
  say(`concat stream-copy: 2 x 2s parts -> ${copyDuration.toFixed(3)}s, 1 video + 1 audio stream`)
  ok(ffprobeNumber(['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width', '-of', 'csv=p=0', copied]) === 320, 'and the canvas of the parts')

  const odd = makeSegment('part-odd.mp4', '256x144', { tone: 880 })
  const mismatch = assembly.planConcat({ shapes: [probeShape(partA), probeShape(odd)] })
  eq(mismatch.mode, 'reencode', 'a part of another size is not stream-copied')
  ok(mismatch.reasons[0].includes('canvas 320x180 vs 256x144'), 'and the plan names the difference')
  const listRe = at('concat-re.txt')
  fs.writeFileSync(listRe, assembly.concatList([partA, odd]))
  const reencoded = at('out-re.mp4')
  const reRun = ff(...assembly.concatArgs({
    mode: mismatch.mode, listPath: listRe, outPath: reencoded,
    reencodeArgs: ['-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '26', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-ar', '48000', '-ac', '2'],
  }))
  eq(reRun.code, 0, 'the re-encode argv runs too — the fix produces a file, not a refusal')
  const reDuration = durationOf(reencoded)
  ok(Math.abs(reDuration - 4) < 0.15, `and the re-encoded join is still the sum of its parts (${reDuration.toFixed(3)}s)`)
  deepEq(streamCounts(reencoded), { video: 1, audio: 1 }, 'on one set of stream parameters')
  say(`concat re-encode: a 320x180 and a 256x144 part -> ${reDuration.toFixed(3)}s on one canvas`)

  /* ——— mix: the narration opens the gap, and the bed comes back when it stops ——— */
  const voice = makeAudio('voice.m4a', { tone: 900, seconds: 1 })
  const bed = makeAudio('bed.m4a', { tone: 220, seconds: 2, gain: -6 })
  const spec = { durationSec: 2, tracks: [{ path: voice, atSec: 0, role: 'voice' }, { path: bed, atSec: 0, role: 'music', duck: true, gainDb: -6 }] }
  const { graph: mixGraphText, out: mixOut } = assembly.mixGraph(spec)
  const mixed = at('mix.m4a')
  const mixRun = ff(...assembly.mixArgs({ paths: spec.tracks.map((t) => t.path), graph: mixGraphText, out: mixOut, outPath: mixed }))
  eq(mixRun.code, 0, 'the mixed graph ffmpeg was actually given runs')
  const mixDuration = durationOf(mixed)
  ok(Math.abs(mixDuration - 2) < 0.1, `the mix is exactly the film's length, not its longest cue (${mixDuration.toFixed(3)}s for a 2s film)`)
  eq(streamCounts(mixed).audio, 1, 'and it is one track out of two pieces')
  // The bed is the 220 Hz tone and the narration is at 900 Hz, so a lowpass hears the bed
  // alone. Two things are measurable: the bed is quieter while the voice plays (the duck), and
  // it is still there after the voice stops (the key is padded — an unpadded key cut the bed at
  // the last word). The dip is modest on purpose: the threshold is ABSOLUTE, so the depth is set
  // by the voice's own level, and upstream measured 1.4 dB for a -3 dB voice.
  const bedOnlySpec = { durationSec: 2, tracks: [{ path: bed, atSec: 0, role: 'music', gainDb: -6 }] }
  const bedOnlyGraph = assembly.mixGraph(bedOnlySpec)
  const bedOnly = at('bed-only.m4a')
  ff(...assembly.mixArgs({ paths: [bed], graph: bedOnlyGraph.graph, out: bedOnlyGraph.out, outPath: bedOnly }))
  const referenceUnder = meanVolume(bedOnly, 0.2, 0.5, ['lowpass=f=400'])
  const referenceTail = meanVolume(bedOnly, 1.3, 0.6, ['lowpass=f=400'])
  const bedWhileTalking = meanVolume(mixed, 0.2, 0.5, ['lowpass=f=400'])
  const bedAfterTalking = meanVolume(mixed, 1.3, 0.6, ['lowpass=f=400'])
  ok(Number.isFinite(bedWhileTalking) && Number.isFinite(bedAfterTalking), `the bed is measurable in both windows (${bedWhileTalking} dB under the narration, ${bedAfterTalking} dB after it)`)
  ok(referenceUnder - bedWhileTalking >= 0.5, `the narration ducks the bed: ${(referenceUnder - bedWhileTalking).toFixed(1)} dB quieter under the voice than the same bed mixed alone (${referenceUnder} dB)`)
  ok(Math.abs(bedAfterTalking - referenceTail) <= 1, `and the bed is still there after the voice stops: ${bedAfterTalking} dB against ${referenceTail} dB for the same bed alone (an unpadded sidechain key would have cut it off)`)
  ok(mixDuration > 1.99, `the padded tail is what keeps the film's length (${mixDuration.toFixed(3)}s)`)
  say(`mix: bed alone ${referenceUnder} dB under the voice window, ${referenceTail} dB after it; with the narration ${bedWhileTalking} dB / ${bedAfterTalking} dB (duck ${(referenceUnder - bedWhileTalking).toFixed(1)} dB)`)

  const sfx = makeAudio('sfx.m4a', { tone: 1400, seconds: 0.4 })
  const threePiece = { durationSec: 2, tracks: [{ path: voice, atSec: 0, role: 'voice' }, { path: bed, atSec: 0, role: 'music', duck: true, gainDb: -6 }, { path: sfx, atSec: 1.5, role: 'sfx', gainDb: -3 }] }
  const threeGraph = assembly.mixGraph(threePiece)
  const threeOut = at('mix3.m4a')
  const threeRun = ff(...assembly.mixArgs({ paths: threePiece.tracks.map((t) => t.path), graph: threeGraph.graph, out: threeGraph.out, outPath: threeOut }))
  eq(threeRun.code, 0, 'narration, music and an effect mix in one pass')
  ok(Math.abs(durationOf(threeOut) - 2) < 0.1, 'and the file is still the film’s length')

  /* ——— mux: the picture decides the length, the measurement decides the level ——— */
  const picture = makeSegment('picture.mp4', '320x180', { audio: false, seconds: 2 })
  const shortTrack = makeAudio('short.m4a', { tone: 500, seconds: 0.6, gain: -20 })
  const shortMux = at('mux-short.mp4')
  const shortRun = ff(...assembly.muxArgs({ silent: picture, audio: shortTrack, durationSec: durationOf(picture), outPath: shortMux }))
  eq(shortRun.code, 0, 'a track shorter than the picture muxes')
  const shortDuration = durationOf(shortMux)
  ok(Math.abs(shortDuration - 2) < 0.15, `and the picture decides the length, not the track: ${shortDuration.toFixed(3)}s out of a 0.6s cue (with -shortest this file would have been 0.6s)`)
  eq(streamCounts(shortMux).audio, 1, 'the delivered file has the track on it')
  say(`mux: a 0.6s cue on a 2s picture -> ${shortDuration.toFixed(3)}s (the picture decides the length)`)

  // Two levels, ten LU apart: a real loudness range, and a quiet one, so a linear gain reaches
  // the target inside the true-peak ceiling — which is exactly the case `decideLoudnorm` claims.
  const stepFile = built('step.m4a', [
    '-f', 'lavfi', '-i', 'sine=frequency=300:duration=1.5', '-f', 'lavfi', '-i', 'sine=frequency=520:duration=1.5',
    '-filter_complex', '[0:a]volume=-26dB[a0];[1:a]volume=-16dB[a1];[a0][a1]concat=n=2:v=0:a=1[o]', '-map', '[o]', '-c:a', 'aac', '-ar', '48000',
  ])
  const measured = integratedLoudness(stepFile)
  ok(Boolean(measured), 'a real ffmpeg measurement produces the five numbers the plan needs')
  const planLevel = assembly.loudnessPlan({ measured })
  eq(planLevel.mode, 'measured', `a quiet, peak-safe track takes the linear pass (measured ${measured.input_i} LUFS, ${measured.input_tp} dBTP, ${measured.input_lra} LU)`)
  const quietPicture = makeSegment('quiet-picture.mp4', '320x180', { audio: false, seconds: 3 })
  const leveled = at('mux-leveled.mp4')
  const levelRun = ff(...assembly.muxArgs({ silent: quietPicture, audio: stepFile, durationSec: durationOf(quietPicture), filter: planLevel.filter, outPath: leveled }))
  eq(levelRun.code, 0, 'the measured filter runs')
  const after = integratedLoudness(leveled)
  ok(Boolean(after), 'and the delivered file can be measured again')
  ok(Math.abs(after.input_i - assembly.DELIVERY_TARGET.i) < 1, `the file really is at the target: ${after.input_i} LUFS against a ${assembly.DELIVERY_TARGET.i} LUFS target`)
  ok(after.input_tp <= assembly.DELIVERY_TARGET.tp + 0.1, `with the true peak under the ceiling (${after.input_tp} dBTP, limit ${assembly.DELIVERY_TARGET.tp})`)
  say(`loudness: measured ${measured.input_i} LUFS -> delivered ${after.input_i} LUFS / ${after.input_tp} dBTP (target ${assembly.DELIVERY_TARGET.i} / ${assembly.DELIVERY_TARGET.tp})`)

  const constant = makeAudio('constant.m4a', { tone: 700, seconds: 2, gain: -20 })
  const constantMeasured = integratedLoudness(constant)
  const constantPlan = assembly.loudnessPlan({ measured: constantMeasured })
  eq(
    constantPlan.mode,
    assembly.decideLoudnorm(constantMeasured, assembly.DELIVERY_TARGET).mode,
    `the plan follows the measurement ffmpeg actually produced (LRA ${constantMeasured.input_lra} LU → ${constantPlan.mode})`,
  )
  ok(/:linear=(true|false)$/.test(String(constantPlan.filter)), 'and the filter it builds is the one ffmpeg was handed')

  /* ——— apply-edl: one encode, snapped to the grid, crossfaded joins ——— */
  const source = makeSegment('source.mp4', '320x180', { tone: 400, seconds: 4 })
  const sourceShape = probeShape(source)
  const fpsProbe = assembly.frameRateFromProbeJson(ffprobeJson(assembly.probeArgs.frameRate(source)))
  eq(fpsProbe.rate, '30/1', 'the source’s own rate is read for -r')
  const edl = assembly.parseEdl({
    sources: { a: 'source.mp4' },
    ranges: [
      { source: 'a', start: 0.2, end: 1.9, note: 'first' },
      { source: 'a', start: 2.1, end: 3.7, note: 'second' },
    ],
  }, 'edl.json')
  const snapped = assembly.snapRanges(edl.ranges, new Map([['a', fpsProbe.fps]]))
  const keptSeconds = snapped.reduce((total, r) => total + (r.end - r.start), 0)
  const seeks = assembly.inputSeeks(snapped)
  // ffprobe 4.0 cannot answer the rotation question (`stream_side_data` arrived in 4.3), so the
  // dimensions are asked for without it and that fact is printed — the swap itself is asserted
  // in the pure section above, and a rotated file here would assemble at its stored size.
  const rotationProbe = assembly.probeArgs.displaySize(source)
  const canReadRotation = run(ffprobe, rotationProbe).code === 0
  const rotationArgs = canReadRotation ? rotationProbe : assembly.probeArgs.displaySizeBasic(source)
  if (!canReadRotation) {
    console.log(`NOTE — this ffprobe cannot report rotation side data (stream_side_data needs 4.3): the EDL test reads the stored dimensions.`)
  }
  const edlGraph = assembly.buildEdlGraph({
    ranges: snapped, seeks, canvas: assembly.displaySizeFromProbeJson(ffprobeJson(rotationArgs)),
    colour: assembly.colourFromProbeJson(ffprobeJson(assembly.probeArgs.colour(source))).tags, crossfadeSec: 0.04,
  })
  const edlOut = at('edl.mp4')
  const edlRun = ff(...assembly.edlArgs({
    ranges: snapped, seeks, paths: snapped.map(() => source), graph: edlGraph.filter,
    videoLabel: edlGraph.videoLabel, audioLabel: edlGraph.audioLabel, outPath: edlOut, rate: fpsProbe.rate, crf: 28,
  }))
  eq(edlRun.code, 0, 'the EDL graph runs on a real file')
  const edlDuration = durationOf(edlOut)
  ok(Math.abs(edlDuration - keptSeconds) < 0.1, `the assembled file is the kept time and nothing more (${edlDuration.toFixed(3)}s of ${keptSeconds.toFixed(3)}s kept, two ranges out of a 4s source)`)
  deepEq(streamCounts(edlOut), { video: 1, audio: 1 }, 'with one picture and one sound, joined once')
  const frames = ffprobeNumber(['-v', 'error', '-count_frames', '-select_streams', 'v:0', '-show_entries', 'stream=nb_read_frames', '-of', 'csv=p=0', edlOut])
  ok(Math.abs(frames - Math.round(keptSeconds * fpsProbe.fps)) <= 2, `the picture is a whole number of frames on the grid: ${frames} frames for ${keptSeconds.toFixed(3)}s at ${fpsProbe.fps} fps (${Math.round(keptSeconds * fpsProbe.fps)} expected)`)
  const audioDuration = ffprobeNumber(['-v', 'error', '-select_streams', 'a:0', '-show_entries', 'stream=duration', '-of', 'csv=p=0', edlOut])
  ok(Math.abs(audioDuration - edlDuration) < 0.1, `picture and sound are the same length, so a join cannot drift (${audioDuration.toFixed(3)}s of sound for ${edlDuration.toFixed(3)}s of picture)`)
  const outShape = probeShape(edlOut)
  eq(outShape.width, sourceShape.width, 'the assembled picture keeps the canvas it was cut from')
  eq(outShape.codec, 'h264', 'and is delivered as H.264')
  say(`apply-edl: 2 ranges kept ${keptSeconds.toFixed(3)}s of a 4s source -> ${edlDuration.toFixed(3)}s, ${frames} frames, sound ${audioDuration.toFixed(3)}s`)

  /* ——— the guards would have stopped an edit that could not be assembled ——— */
  const wideRange = assembly.snapRanges([{ source: 'a', start: 3.7, end: 6 }], new Map([['a', fpsProbe.fps]]))
  const problems = assembly.edlProblems({
    ranges: wideRange, order: ['a'], crossfadeMs: 40,
    sources: { a: { fps: fpsProbe.fps, rate: fpsProbe.rate, video: durationOf(source), audio: durationOf(source) } },
  })
  ok(problems.some((m) => /the source's picture is only 4\.000s long/.test(m)), `a range past the end of the picture is refused before the encode (${problems[0]})`)
} catch (err) {
  console.error(`the real FFmpeg pass failed: ${err?.message || err}`)
  console.error(`the files it built are in ${work}`)
  process.exit(1)
}

fs.rmSync(work, { recursive: true, force: true })
console.log(`assembly check passed — ${n} assertions, real FFmpeg pass included (${version})`)
