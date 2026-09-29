#!/usr/bin/env node
/**
 * check:speech — the speech layer, executed for real.
 *
 * Cupric's captions used to be guessed from the clip's own timing: a fixed
 * even split of the block, so a word could appear a full second before it was
 * spoken. The ported speech layer fixes that, and this check proves each half of
 * it without a browser or a recording:
 *
 *   transcript  every whisper family output → one shape, words in === words out
 *   timings     real word times when they exist, even split when they do not
 *   captions    which words belong to which caption clip, and where the gaps are
 *   probe       silence/floor/threshold/gaps read from PCM we synthesise here
 *   edl         frame snapping, cutting on a probe, and retiming a transcript
 */
import assert from 'node:assert/strict'
import { rmSync } from 'node:fs'
import path from 'node:path'
import { build } from 'esbuild'

const root = process.cwd()
const out = path.join(root, 'node_modules', '.cache', 'cupric-check-speech.mjs')
rmSync(out, { force: true })
await build({
  stdin: {
    contents: [
      "export * as tr from './src/lib/speech/transcript'",
      "export * as pb from './src/lib/speech/probe'",
      "export * as edl from './src/lib/speech/edl'",
      "export * as cap from './src/lib/speech/captions'",
    ].join('\n'),
    resolveDir: root,
    loader: 'ts',
  },
  bundle: true,
  format: 'esm',
  platform: 'node',
  outfile: out,
  logLevel: 'silent',
})
const m = await import(`file://${out}`)

let n = 0
const ok = (cond, label) => { assert.ok(cond, `FAIL: ${label}`); n++ }
const eq = (a, b, label) => { assert.equal(a, b, `FAIL: ${label}`); n++ }
const near = (a, b, tol, label) => { assert.ok(Math.abs(a - b) <= tol, `FAIL: ${label} (${a} vs ${b})`); n++ }

/* ── 1. every provider shape maps to one transcript ────────────────── */
{
  // WhisperX / openai-whisper: segments[].words[] (fluent with word times)
  const whisperx = {
    segments: [
      { start: 0, end: 2, text: ' Hello there friend ', words: [{ word: ' Hello', start: 0.1, end: 0.5 }, { word: ' there', start: 0.6, end: 0.9 }, { word: ' friend', start: 1, end: 1.4 }] },
      { start: 2, end: 3.5, text: 'Nice to meet you', words: [{ word: ' Nice', start: 2.1, end: 2.4 }, { word: ' to', start: 2.5, end: 2.6 }, { word: ' meet', start: 2.7, end: 3 }, { word: ' you', start: 3.1, end: 3.4 }] },
    ],
  }
  const a = m.tr.mapWhisperTranscript(whisperx)
  eq(a.transcript.chunks.length, 2, 'whisperx: segments become chunks')
  eq(a.transcript.chunks[0].words.length, 3, 'whisperx: words kept')
  eq(a.transcript.chunks[0].words[0].text, 'Hello', 'whisperx: leading space trimmed')
  eq(a.interpolated, 0, 'whisperx: nothing had to be interpolated')
  ok(a.transcript.text.includes('Hello there friend'), 'whisperx: chunk text preserved')

  // whisper-timestamped: words are `text`
  const wt = m.tr.mapWhisperTranscript({ segments: [{ start: 0, end: 1, text: 'hi you', words: [{ text: 'hi', start: 0, end: 0.3 }, { text: 'you', start: 0.4, end: 0.8 }] }] })
  eq(wt.transcript.chunks[0].words[1].text, 'you', 'whisper-timestamped: `text` words read')

  // OpenAI verbose_json: flat words[]
  const oai = m.tr.mapWhisperTranscript({ text: 'one two', words: [{ word: 'one', start: 1, end: 1.3 }, { word: 'two', start: 1.4, end: 1.9 }] })
  eq(oai.transcript.chunks.length, 1, 'openai: flat words grouped into a chunk')
  eq(oai.transcript.chunks[0].words.length, 2, 'openai: both words present')

  // whisper.cpp: integer millisecond offsets, no word times
  const cpp = m.tr.mapWhisperTranscript({ transcription: [{ offsets: { from: 0, to: 2000 }, text: ' hello world ' }, { offsets: { from: 2000, to: 3200 }, text: ' again ' }] })
  eq(cpp.transcript.chunks[0].words.map((w) => w.text).join(' '), 'hello world again', 'whisper.cpp: entries split into words, none lost')
  near(cpp.transcript.chunks[0].words[2].timestamp[0], 2, 1e-9, 'whisper.cpp: integer ms offsets → seconds')
  near(cpp.transcript.chunks[0].words[2].timestamp[1], 3.2, 1e-9, 'whisper.cpp: both offsets converted')

  // Interpolation: a segment with no word times still yields timed words.
  const mixed = m.tr.mapWhisperTranscript({
    segments: [
      { start: 0, end: 1, text: 'one two' },
      { start: 1, end: 2, text: 'three four', words: [{ word: 'three', start: 1, end: 1.4 }, { word: 'four', start: 1.5, end: 1.9 }] },
    ],
  })
  eq(mixed.interpolated, 2, 'mixed: both untimed words were interpolated, and counted')
  eq(mixed.transcript.chunks[0].words.length, 2, 'mixed: untimed words were invented from the segment')
  ok(mixed.transcript.chunks[0].words[0].timestamp[0] >= 0 && mixed.transcript.chunks[0].words[1].timestamp[1] <= 1.0001, 'mixed: interpolated words stay inside their segment')

  // The invariant is enforced, not hoped for.
  eq(m.tr.transcriptWordCount(a.transcript), 7, 'invariant: 7 words in, 7 words out')
  let threw = false
  try { m.tr.mapWhisperTranscript({}) } catch (e) { threw = e instanceof m.tr.NoWordTimingsError }
  ok(threw, 'an empty transcript throws instead of producing silent captions')
  threw = false
  try { m.tr.mapWhisperTranscript({ segments: [{ start: 0, end: 1, text: 'a b c' }] }, { gapSec: -1 }) } catch { threw = true }
  ok(threw, 'a nonsense option is rejected rather than silently ignored')
}

/* ── 2. word timings: real when possible, even split when not ──────── */
{
  const segments = [{ timestamp: [0, 2], text: 'one two three' }, { timestamp: [2, 4], text: 'four five' }]
  const words = [
    { timestamp: [0.2, 0.5], text: 'one' }, { timestamp: [0.7, 1.0], text: 'two' }, { timestamp: [1.4, 1.9], text: 'three' },
    { timestamp: [2.5, 2.9], text: 'four' }, { timestamp: [3.1, 3.6], text: 'five' },
  ]
  const real = m.tr.synthWordTimings(segments, words)
  eq(real.beats.length, 2, 'beats follow the transcript segments')
  const d0 = m.tr.toClipDelays(real.beats[0])
  eq(d0.length, 3, 'clip delays: one per word')
  near(d0[0], 200, 1, 'clip delays: first word at its real time, relative to the clip')
  near(d0[1], 700, 1, 'clip delays: second word at its real time')
  ok(d0[0] <= d0[1] && d0[1] <= d0[2], 'clip delays are monotonic')
  ok(d0.every((d) => d >= 0), 'clip delays never go negative (a clip cannot reveal before it starts)')

  // Count mismatch (a provider dropped a word) must NOT produce a caption with
  // words missing — this beat even-splits its own tokens instead.
  const short = m.tr.synthWordTimings([{ timestamp: [0, 2], text: 'one two three' }], [{ timestamp: [0.2, 0.5], text: 'one' }])
  eq(short.beats[0].words.length, 3, 'mismatch: still three words in the caption')
  near(short.beats[0].words[1].delayMs, Math.round((2 / 3) * 1000), 1, 'mismatch: even split used (slot = window/wordCount)')

  const fallback = m.tr.synthWordTimings(segments, null)
  near(fallback.beats[1].words[0].delayMs, 2000, 1, 'fallback: second beat starts at its own start')
  near(fallback.beats[1].words[1].delayMs, 3000, 1, 'fallback: last word lands one slot before the window closes')

  const solo = m.tr.evenSplitDelays(1, 2, ['a', 'b'])
  eq(solo[0].delayMs, 1000, 'even split: measured from the window start')
  eq(solo[1].delayMs, 1500, 'even split: evenly spaced')
}

/* ── 3. captions follow the clip, and report the gaps ─────────────── */
{
  const transcript = m.tr.mapWhisperTranscript({
    segments: [
      { start: 0, end: 1.6, text: 'stop scrolling', words: [{ word: 'Stop', start: 0.1, end: 0.4 }, { word: 'scrolling', start: 0.5, end: 1.0 }] },
      { start: 1.6, end: 3.2, text: 'and look here', words: [{ word: 'and', start: 1.7, end: 1.9 }, { word: 'look', start: 2.0, end: 2.3 }, { word: 'here', start: 2.4, end: 2.8 }] },
      { start: 5, end: 6, text: 'outro', words: [{ word: 'outro', start: 5.2, end: 5.8 }] },
    ],
  }).transcript

  const report = m.cap.assignCaptions(transcript, [
    { id: 'c1', startSec: 0, durationSec: 1.8, text: 'stop scrolling' },
    { id: 'c2', startSec: 1.5, durationSec: 1.8, text: 'and look here' },
    { id: 'c3', startSec: 3.4, durationSec: 1.4, text: 'placeholder card' }, // no speech in this window
  ])
  eq(report.assignments.length, 3, 'every caption gets an assignment')
  const [c1, c2, c3] = report.assignments
  eq(c1.text, 'Stop scrolling', 'words assigned in spoken order, wrapped')
  eq(c1.wordDelaysMs.length, 2, 'one delay per word')
  near(c1.wordDelaysMs[0], 100, 1, 'first word at its own spoken time, relative to the clip start')
  near(c1.wordDelaysMs[1], 500, 1, 'second word at its own spoken time')
  eq(c1.synthesised, false, 'timed caption is not synthesised')
  ok(c1.suggest !== null, 'a caption that is out of sync suggests a correction')
  near(c1.suggest.startSec, 0.02, 0.01, 'suggested start = first word − lead')
  ok(c1.suggest.durationSec >= 1.1, 'suggested duration covers the spoken span plus the tail')

  eq(c2.text, 'and look here', 'second caption follows the second sentence')
  near(c2.wordDelaysMs[0], 200, 1, 'clip-relative delays do not carry the transcript offset')

  eq(c3.synthesised, true, 'a silent window falls back to an even split')
  eq(c3.text, 'placeholder card', 'the silent window keeps its own words')
  eq(c3.wordDelaysMs.length, 2, 'the fallback still reveals word by word')
  near(c3.wordDelaysMs[1], 700, 2, 'the fallback spreads the words across the clip')

  eq(report.orphans.length, 1, 'the word after the last caption is reported as an orphan')
  eq(report.orphans[0].text, 'outro', 'the orphan is the word that named it')
  eq(report.wordsAssigned, 5, 'five of six words landed in a caption')
  ok(/5\/6 words placed/.test(m.cap.describeCaptions(report)), 'the summary names the coverage')

  // Wrapping: never drop a word, prefer balanced lines.
  const lines = m.cap.wrapCaptionWords('one two three four five six seven'.split(' '), 12, 2)
  eq(lines.length, 2, 'wrapping honours maxLines')
  eq(lines.join(' ').split(' ').length, 7, 'wrapping never drops a word')
  const long = m.cap.wrapCaptionWords(['antidisestablishmentarianism', 'ok'], 10, 2)
  eq(long[0], 'antidisestablishmentarianism', 'a word longer than the line is never broken')

  // The quote every captioner lives by: everything, always.
  const patches = m.cap.captionPatches(report.assignments)
  eq(patches.length, 3, 'patches are produced per caption')
  eq(patches[0].patch.wordDelaysMs.length, 2, 'the patch carries the delays for the renderer')
}

/* ── 4. probe: silence, speech and the gaps between ───────────────── */
{
  // 16 kHz mono: 0.5s silence, 0.6s tone, 0.3s silence, 0.6s tone, 0.5s silence.
  const rate = 16000
  const pcm = new Float32Array(Math.round(2.5 * rate))
  const tone = (fromSec, toSec) => {
    for (let i = Math.round(fromSec * rate); i < Math.round(toSec * rate); i++) pcm[i] = 0.35 * Math.sin((2 * Math.PI * 200 * i) / rate)
  }
  tone(0.5, 1.1)
  tone(1.4, 2.0)
  const probe = m.pb.probeFloatPcm(rate, pcm)
  eq(probe.speechFound, true, 'probe finds speech in a signal with two bursts')
  ok(probe.floor < probe.threshold, 'floor sits below the speech threshold')
  ok(probe.threshold <= probe.peak, 'threshold cannot exceed the peak')
  ok(probe.gaps.length >= 1, 'the pause between the bursts is reported as a gap')
  ok(probe.gaps.every((g) => g.duration >= 0.25), 'gaps are at least a quarter second — shorter is mid-word')
  ok(probe.onset !== null && probe.onset > 0.4 && probe.onset < 0.7, 'onset lands on the first burst')
  ok(probe.decay !== null && probe.decay > 1.9 && probe.decay < 2.2, 'decay lands on the end of the second burst')
  ok(/Speech from/i.test(m.pb.describeProbe(probe)), 'the probe describes itself in words')

  const silence = m.pb.probeFloatPcm(rate, new Float32Array(rate))
  eq(silence.speechFound, false, 'a silent track reports no speech rather than a threshold on noise')
  eq(silence.gaps.length, 0, 'silence is not one long gap')
  ok(/No speech found/i.test(m.pb.describeProbe(silence)), 'the silent probe says so in the UI line')

  // A different sample rate is resampled, not mis-measured: the same clip at
  // 44.1 kHz must report the same speech.
  const big = new Float32Array(44100 * 2)
  for (let i = 0; i < big.length; i++) big[i] = 0.3 * Math.sin((2 * Math.PI * 180 * i) / 44100)
  const at441 = m.pb.probeFloatPcm(44100, big)
  near(at441.envelope.length, 200, 3, 'a 44.1 kHz buffer is resampled into 10 ms windows')

  const int16 = m.pb.toInt16(pcm)
  eq(int16.length, pcm.length, 'toInt16 keeps the sample count')
  ok(Math.max(...int16) > 8000, 'toInt16 scales into the usable range')
  const mono = m.pb.monoOf([pcm, pcm])
  eq(mono.length, pcm.length, 'two identical channels average to one')
}

/* ── 5. EDL: snap, cut on a probe, retime a transcript ────────────── */
{
  const fps = 30
  const snapped = m.edl.snapToFrames({ source: 'main', start: 1.001, end: 2.499 }, fps)
  near(snapped.start, 31 / 30, 1e-9, 'snap: an off-grid start moves up to the next frame instant')
  near(snapped.end, 2.5, 1e-9, 'snap: 2.499s ceils to the next frame (a cut never clips the last frame)')
  near(m.edl.snapToFrames({ source: 'main', start: 1 + 1e-9, end: 2 }, fps).start, 1, 1e-9, 'snap: a frame instant is not pushed off its own grid by float noise')
  ok(snapped.end > 2.499, 'snapped end is never before the requested end')
  eq(m.edl.edlDuration([{ start: 0, end: 2 }, { start: 5, end: 6.5 }]), 3.5, 'duration is the sum of the ranges')
  eq(m.edl.sourceOrder([{ source: 'b', start: 0, end: 1 }, { source: 'a', start: 0, end: 1 }, { source: 'b', start: 2, end: 3 }]).join(','), 'b,a', 'sources are listed once, in first-use order')

  let threw = false
  try { m.edl.assertRanges([{ source: 'main', start: 2, end: 2 }]) } catch { threw = true }
  ok(threw, 'a zero-length range is rejected at the boundary, not at render time')
  threw = false
  try { m.edl.assertRanges([{ source: 'main', start: -1, end: 2 }]) } catch { threw = true }
  ok(threw, 'a negative range is rejected')
  const oneFrame = m.edl.snapToFrames({ source: 'main', start: 1, end: 1.005 }, fps)
  near(oneFrame.end - oneFrame.start, 1 / fps, 1e-9, 'a range shorter than one frame grows to exactly one frame')

  // Cut the probe's silence out: two bursts kept, head and tail trimmed.
  const rate = 16000
  const pcm = new Float32Array(rate * 3)
  for (let i = Math.round(0.4 * rate); i < Math.round(1.2 * rate); i++) pcm[i] = 0.3 * Math.sin((2 * Math.PI * 180 * i) / rate)
  for (let i = Math.round(2.0 * rate); i < Math.round(2.8 * rate); i++) pcm[i] = 0.3 * Math.sin((2 * Math.PI * 180 * i) / rate)
  const probe = m.pb.probeFloatPcm(rate, pcm)
  const plan = m.edl.rangesFromProbe(probe, { durationSec: 3, paddingSec: 0.12, minCutSec: 0.2, minKeepSec: 0.25 })
  eq(plan.ranges.length, 2, 'the cut planner keeps the two speech islands separate')
  ok(plan.removedSec > 0.7 && plan.removedSec < 1.0, 'the silence between the bursts and the lead-in is removed')
  ok(plan.ranges.every((x) => x.end > x.start), 'every kept range has a real duration')
  near(plan.ranges[0].start, 0.28, 0.02, 'the lead-in is trimmed to the onset minus the padding')
  near(plan.ranges[1].end, 3, 0.02, 'the kept tail keeps its last frame')
  eq(plan.keptGaps, 1, 'the 160ms tail gap is kept: under the safe minimum is not worth a join')
  ok(/kept range|Kept whole/i.test(m.edl.describeCut(plan, probe)), 'the cut plan describes itself')

  // A probe asked for file seconds reports its gaps in file seconds too; the
  // planner must still cut the region it was given, not the head of the file.
  const offset = m.pb.probeFloatPcm(rate, pcm.slice(0, rate * 3), { rangeStart: 40 })
  const offsetPlan = m.edl.rangesFromProbe(offset, { durationSec: 3, paddingSec: 0.12, minCutSec: 0.2 })
  ok(offsetPlan.ranges.every((r) => r.start >= 0 && r.end <= 3), 'ranges from an offset probe stay inside the probed range')
  near(offsetPlan.removedSec, plan.removedSec, 0.05, 'and the same audio cuts the same way whatever second it was probed at')
  near(offsetPlan.ranges[0].start, plan.ranges[0].start, 0.02, 'including the head trim')

  // Kept ranges → the cuts a clipper expects, and back again.
  const flipped = m.edl.cutsFromRanges(offsetPlan.ranges, 0, 3)
  ok(flipped.length >= 1, 'kept ranges flip into cuts')
  const reKept = [[0, 3]].flatMap(([a, b]) => {
    const out = []
    let cursor = a
    for (const [x, y] of flipped) { if (x - cursor > 0.05) out.push([cursor, x]); cursor = y }
    if (b - cursor > 0.05) out.push([cursor, b])
    return out
  })
  near(m.edl.edlDuration(reKept.map(([a, b]) => ({ start: a, end: b }))), m.edl.edlDuration(offsetPlan.ranges), 0.05, 'flipping and flipping back loses only the slivers')

  // A silent file is kept whole: there is no speech to tighten, and an EDL that
  // keeps nothing would break the render.
  const quiet = m.edl.rangesFromProbe(m.pb.probeFloatPcm(rate, new Float32Array(rate)), { durationSec: 1 })
  eq(quiet.ranges.length, 1, 'a silent clip is kept whole')
  eq(quiet.removedSec, 0, 'and nothing is claimed to have been removed')

  // Retiming: the words move onto the cut timeline instead of being re-transcribed.
  const transcript = m.tr.mapWhisperTranscript({
    segments: [
      { start: 0.5, end: 0.9, text: 'before', words: [{ word: 'before', start: 0.5, end: 0.8 }] },
      { start: 2.1, end: 2.6, text: 'after', words: [{ word: 'after', start: 2.1, end: 2.5 }] },
    ],
  }).transcript
  const ranges = [
    m.edl.snapToFrames({ source: 'main', start: 0, end: 1.2 }, fps),
    m.edl.snapToFrames({ source: 'main', start: 2, end: 3 }, fps),
  ]
  const cut = m.edl.retime(ranges, () => transcript)
  eq(cut.durationSec, 2.2, 'the retimed transcript is as long as the kept ranges')
  eq(cut.chunks.length, 2, 'both words survive the cut')
  near(cut.chunks[0].words[0].timestamp[0], 0.5, 1e-9, 'a word inside the first range keeps its offset')
  near(cut.chunks[1].words[0].timestamp[0], 1.3, 1e-9, 'a word after the cut moves up by the removed time')
  eq(cut.droppedAtEdges, 0, 'no word was lost at an edge')
  ok(cut.text.includes('before') && cut.text.includes('after'), 'the retimed transcript reads as the speech does')

  // A word split by a cut disappears, and that is counted rather than lost.
  const edge = m.tr.mapWhisperTranscript({
    segments: [{ start: 0.2, end: 1.3, text: 'keep edge', words: [{ word: 'keep', start: 0.2, end: 0.5 }, { word: 'edge', start: 1.1, end: 1.3 }] }],
  }).transcript
  const edgeCut = m.edl.retime([m.edl.snapToFrames({ source: 'main', start: 0, end: 1.2 }, fps)], () => edge)
  eq(edgeCut.text, 'keep', 'a word the cut halved is dropped rather than clipped to a half word')
  eq(edgeCut.droppedAtEdges, 1, 'and the drop is counted, so the caller can warn instead of guessing')
  eq(edgeCut.chunks.length, 1, 'the surviving word keeps its chunk')

  // An edit that keeps nothing anywhere is a mistake, not a silent empty film.
  threw = false
  try { m.edl.retime([m.edl.snapToFrames({ source: 'main', start: 10, end: 11 }, fps)], () => edge) } catch { threw = true }
  ok(threw, 'an edit that keeps no word at all throws with a readable reason')
}

console.log(`speech check passed — ${n} assertions`)
