#!/usr/bin/env node
/**
 * Auto-captions with real timings: Whisper JSON / Windows phrase parsing,
 * real FFmpeg audio extraction (16 kHz mono WAV), and source→timeline mapping
 * through trim and speed into caption clips. Whisper itself is not run here
 * (no model in CI); its -oj output format is fixed by the sample below.
 */
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(import.meta.url)
const ve = require(path.join(root, 'electron/voice-engines.cjs'))
let n = 0
const ok = (c, m) => { assert.ok(c, m); n += 1 }

const args = ve.whisperWordArgs({ model: '/m.bin', wavPath: '/a.wav', outBase: '/o', lang: 'hi-IN' })
ok(args.includes('-oj') && args.includes('-sow') && args[args.indexOf('-ml') + 1] === '1' && args[args.indexOf('-l') + 1] === 'hi', 'whisper word args')

// Real whisper.cpp -oj shape (one segment per word with -ml 1 -sow).
const sample = JSON.stringify({ systeminfo: 'x', model: {}, params: {}, result: { language: 'en' }, transcription: [
  { timestamps: { from: '00:00:00,000', to: '00:00:00,000' }, offsets: { from: 0, to: 0 }, text: '' },
  { timestamps: {}, offsets: { from: 320, to: 610 }, text: ' Launch' },
  { timestamps: {}, offsets: { from: 610, to: 900 }, text: ' day' },
  { timestamps: {}, offsets: { from: 900, to: 1500 }, text: ' is' },
  { timestamps: {}, offsets: { from: 1500, to: 1600 }, text: ' [MUSIC]' },
  { timestamps: {}, offsets: { from: 1600, to: 2400 }, text: ' here.' },
] })
const words = ve.parseWhisperWords(sample)
ok(words.length === 4 && words[0].word === 'Launch' && words[0].start === 0.32 && words[3].end === 2.4, 'whisper words parsed, non-speech dropped')
assert.throws(() => ve.parseWhisperWords('{bad'), /unreadable/); n += 1

const phr = ve.parseWindowsPhrases('1000\t2000\thello big world\r\nnoise\n5000\t500\tok\n')
ok(phr.length === 4 && phr[0].start === 1 && Math.abs(phr[2].end - 3) < 1e-9 && phr[3].start === 5, 'windows phrases spread over their span')
ok(ve.WINDOWS_TIMED_SCRIPT.includes('$args[0]') && !ve.windowsTimedArgs('/x; rm -rf').slice(0, -1).join(' ').includes('rm -rf'), 'path passed as argument, not interpolated')

// Real extraction.
let ffmpeg = process.env.CUPRIC_FFMPEG_PATH
if (!ffmpeg || !existsSync(ffmpeg)) { try { ffmpeg = require('ffmpeg-static') } catch { ffmpeg = null } }
if (ffmpeg && existsSync(ffmpeg)) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'cupric-cap-'))
  try {
    const src = path.join(dir, 'talk.mp4')
    assert.equal(spawnSync(ffmpeg, ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=320x240:rate=25:duration=3', '-f', 'lavfi', '-i', 'sine=frequency=300:sample_rate=48000:duration=3', '-ac', '2', '-shortest', src]).status, 0)
    const wav = path.join(dir, 'a.wav')
    assert.equal(spawnSync(ffmpeg, ve.extractWavArgs(src, wav)).status, 0)
    const b = readFileSync(wav)
    ok(b.toString('ascii', 0, 4) === 'RIFF' && b.readUInt16LE(22) === 1 && b.readUInt32LE(24) === 16000 && b.readUInt16LE(34) === 16, 'real FFmpeg extraction → 16 kHz mono 16-bit WAV')
    ok(Math.abs((b.length - 44) / 32000 - 3) < 0.1, 'full clip length extracted')
  } finally { rmSync(dir, { recursive: true, force: true }) }
}

const tmp = path.join(root, '.auto-captions-check.mjs')
await build({ bundle: true, outfile: tmp, format: 'esm', platform: 'node', logLevel: 'error', stdin: { contents: "export * from './src/lib/studio/autoCaptions'\nexport * as tt from './src/lib/studio/textTools'\nexport * as qv from './src/lib/production/quickVideo'", resolveDir: root, loader: 'ts' } })
const ac = await import(`${pathToFileURL(tmp).href}?t=${Date.now()}`)
await rm(tmp, { force: true })
// Clip at 10s on the timeline, trimmed 0.5s into the source, played at 2x for 0.5s → source 0.5..1.5
const clip = { id: 'v', kind: 'video', mediaId: 'm', startSec: 10, durationSec: 0.5, trimInSec: 0.5, speed: 2, track: 0 }
const tl = ac.wordsToTimeline(words, clip)
ok(tl.length === 3 && tl[0].word === 'Launch' && tl[0].start === 10, 'trim clips the first word to the clip start')
ok(Math.abs(tl[1].start - (10 + (0.61 - 0.5) / 2)) < 1e-9, 'speed halves the gaps')
ok(!tl.some((w) => w.word === 'here.'), 'words after the used range are dropped')
const doc = { trackCount: 2, clips: [clip] }
const { doc: next, captions } = ac.captionsForClip(doc, { ...clip, durationSec: 20, speed: 1, trimInSec: 0 }, words, 2)
ok(captions.length === 2 && captions[0].startSec === 10.32 && captions[0].text.startsWith('Launch day') && captions[1].text.startsWith('is here.'), `captions follow word timing (${captions.map((c) => c.startSec + ':' + c.text).join(' | ')})`)
ok(next.trackCount === 3 && captions.every((c) => c.track === 2) && next.clips.length === 3, 'captions land on a new top track')

// Word-level reveals: the caption carries when each of ITS words was spoken, so
// `word-reveal` and the karaoke tint follow the voice instead of a steady clock.
assert.deepEqual(captions[0].wordDelaysMs, [0, 290], 'caption 1 carries its words\' own spoken times'); n += 1
assert.deepEqual(captions[1].wordDelaysMs, [0, 700], 'caption 2 too, relative to its own start'); n += 1
ok(captions.every((c) => c.anim === 'word-reveal'), 'timed captions reveal word by word')
ok(captions.every((c) => c.durationSec >= 0.3 && c.durationSec <= 3), 'each caption covers just its own words')
ok(captions[0].durationSec === 0.58 && captions[1].durationSec === 1.5, `caption windows follow the speech (${captions.map((c) => c.durationSec).join(',')})`)

// A breath ends a caption: a spoken pause splits the line even with no
// punctuation and room for more words.
{
  const spoken = [
    { word: 'this', start: 0, end: 0.3 }, { word: 'is', start: 0.32, end: 0.5 }, { word: 'one', start: 0.52, end: 0.8 },
    { word: 'thought', start: 1.5, end: 1.9 }, { word: 'entirely', start: 1.92, end: 2.4 },
  ]
  const split = ac.tt.captionsFromTranscript('', { startSec: 0, durationSec: 3, track: 1, maxWords: 8, words: spoken })
  ok(split.length === 2, `a 0.7s pause splits the caption (${split.map((c) => c.text).join(' | ')})`)
  assert.deepEqual(split[1].wordDelaysMs, [0, 420], 'the second caption keeps its own word times'); n += 1
}

// Phrase-timed engines stamp every word with the phrase start. Drawing that
// faithfully is a caption that appears all at once mid-phrase, so the reveal
// falls back to an even split across the same window.
{
  const phrase = [
    { word: 'hello', start: 1, end: 2 }, { word: 'big', start: 1, end: 2 }, { word: 'world', start: 1, end: 2 },
  ]
  const untimed = ac.tt.captionsFromTranscript('', { startSec: 0, durationSec: 3, track: 1, maxWords: 8, words: phrase })
  assert.deepEqual(untimed[0].wordDelaysMs, [0, 333, 667], 'a phrase-only engine gets an even split, not three identical delays'); n += 1
}

// The paste-a-transcript path has no timings to follow, so it must not pretend.
{
  const pasted = ac.tt.captionsFromTranscript('One two three. Four five.', { startSec: 0, durationSec: 4, track: 1, maxWords: 4 })
  ok(pasted.length === 2 && pasted.every((c) => c.wordDelaysMs === undefined), 'pasted text makes captions with no invented word timings')
}

const read = (p) => readFileSync(path.join(root, p), 'utf8')
ok(read('electron/main.cjs').includes("ipcMain.handle('voice:transcribeMedia'") && read('electron/preload.cjs').includes("'voice:transcribeMedia'"), 'IPC wired')
ok(read('src/screens/studio/StudioProPanel.tsx').includes('phrase-level timing'), 'UI states the timing precision')

/* ——— provenance: a caption must never claim more precision than it has ——— */
{
  const exact = ac.tt.captionDelaysWithSource([{ start: 0, end: 0.3 }, { start: 0.3, end: 0.6 }], 0, 0.6, 2)
  ok(exact.source === 'word' && JSON.stringify(exact.delays) === '[0,300]', 'matching word times are labelled real')
  const phrase = ac.tt.captionDelaysWithSource([{ start: 1, end: 2 }, { start: 1, end: 2 }], 1, 1, 2)
  ok(phrase.source === 'phrase' && phrase.delays[1] > 0, 'repeated stamps are labelled phrase-level and spread evenly')
  const mismatch = ac.tt.captionDelaysWithSource([{ start: 0, end: 0.3 }], 0, 1, 3)
  ok(mismatch.source === 'even' && mismatch.delays.length === 3, 'a word-count mismatch falls back to an even split, labelled')
  const jitter = ac.tt.captionDelaysWithSource([{ start: 0.6, end: 0.8 }, { start: 0.2, end: 0.4 }], 0, 0.6, 2)
  ok(jitter.source === 'even' && jitter.delays[1] > 0, 'times that run backwards are not trusted')
  const one = ac.tt.captionDelaysWithSource([{ start: 0.5, end: 0.7 }], 0.5, 0.2, 1)
  ok(one.source === 'word' && one.delays[0] === 0, 'a single word has nothing to guess')
}

/* ——— one planner for both entry points ——— */
{
  const words = [
    { word: 'one', start: 0, end: 0.3 }, { word: 'two', start: 0.32, end: 0.6 }, { word: 'three', start: 0.62, end: 0.95 },
    { word: 'four', start: 1.8, end: 2.1 }, { word: 'five', start: 2.12, end: 2.4 },
  ]
  const planned = ac.tt.planCaptionLines('', { startSec: 0, durationSec: 3, maxWords: 8, maxChars: 40, words })
  ok(planned.length === 2 && planned[0].timingSource === 'word' && planned[0].wordDelaysMs.length === 3, `planner keeps real lines (${planned.map((l) => l.text).join(' | ')})`)
  ok(planned[0].startSec === 0 && Math.abs(planned[1].startSec - 1.8) < 1e-9, 'lines start where their first word was spoken')
  const budget = ac.tt.planCaptionLines('alpha beta gamma delta epsilon', { startSec: 0, durationSec: 5, maxChars: 12 })
  ok(budget.every((l) => l.text.length <= 12) && budget.length >= 3, `character budget splits lines (${budget.map((l) => l.text).join(' | ')})`)
  const estimated = ac.tt.planCaptionLines('one two three four', { startSec: 2, durationSec: 4, maxWords: 2 })
  ok(estimated.length === 2 && estimated.every((l) => l.wordDelaysMs === null && l.timingSource === 'even'), 'no words → no invented delays, labelled estimated')
  ok(Math.abs(estimated.reduce((a, l) => a + l.durationSec, 0) - 4) < 0.02, 'estimated lines still cover the window')
}

/* ——— Quick Video: the same contract, so build and Studio cannot drift ——— */
{
  const qv = ac.qv
  ok(qv.DEFAULT_QUICK_SETTINGS.wordTimings === true, 'real word timings are on by default')
  ok(qv.sanitizeSettings({ ...qv.DEFAULT_QUICK_SETTINGS, wordTimings: false }).wordTimings === false, 'the setting survives sanitising')
  ok(qv.sanitizeSettings({ wordTimings: 'yes' }).wordTimings === true, 'a non-boolean falls back to the default')
  const s = { ...qv.DEFAULT_QUICK_SETTINGS, topic: 'Captions', seed: 5, variants: 1 }
  const script = 'One two three. Four five six.'
  const media = [{ mediaId: 'm0', fileName: 'f0.jpg', localPath: null, kind: 'image', durationSec: 0, term: 't0' }]
  const base = { aspect: '16:9', fps: 30, backgroundId: 'lime-void', clips: [], trackCount: 3 }
  const voice = { mediaId: 'v', fileName: 'v.wav', localPath: '/tmp/v.wav', durationSec: 2.4 }
  const words = [
    { word: 'One', start: 0, end: 0.3 }, { word: 'two', start: 0.32, end: 0.6 }, { word: 'three.', start: 0.62, end: 0.95 },
    { word: 'Four', start: 1.4, end: 1.7 }, { word: 'five', start: 1.72, end: 2.0 }, { word: 'six.', start: 2.02, end: 2.4 },
  ]
  const timed = qv.buildQuickDoc(base, s, script, media, { voice, words })
  const subs = timed.clips.filter((c) => c.kind === 'text')
  ok(subs.length === 2 && subs.every((c) => c.timingSource === 'word'), 'word-timed build labels every caption real')
  ok(subs.every((c) => c.wordDelaysMs.length === c.text.split(/\s+/).length), 'each caption has exactly one delay per word it shows')
  ok(subs.every((c) => c.wordDelaysMs.every((d, i) => i === 0 || d >= c.wordDelaysMs[i - 1])), 'delays are monotonic')
  ok(subs[0].startSec === 0 && Math.abs(subs[1].startSec - 1.4) < 1e-9, `captions land where the words were spoken (${subs.map((c) => c.startSec).join(',')})`)
  ok(subs.every((c) => c.startSec + c.durationSec <= voice.durationSec + 0.5), 'captions stay inside the narration')
  ok(JSON.stringify(subs) === JSON.stringify(qv.buildQuickDoc(base, s, script, media, { voice, words }).clips.filter((c) => c.kind === 'text')), 'the timed build is deterministic')
  ok(qv.captionTimingOf(timed).source === 'word' && /real word times/.test(qv.captionTimingOf(timed).label), 'the run summary reports real timings')

  const plain = qv.buildQuickDoc(base, s, script, media, { voice })
  const plainSubs = plain.clips.filter((c) => c.kind === 'text')
  ok(plainSubs.length >= 1 && plainSubs.every((c) => c.timingSource === 'even' && !c.wordDelaysMs), 'without word times the captions are labelled estimated')
  ok(Math.abs(Math.max(...plainSubs.map((c) => c.startSec + c.durationSec)) - voice.durationSec) < 0.05, 'the estimated captions still cover the narration')
  ok(qv.captionTimingOf(plain).label.includes('estimated'), 'the run summary says the timing is estimated')
  ok(qv.captionTimingOf({ ...plain, clips: plain.clips.filter((c) => c.kind !== 'text') }) === null, 'no subtitles → no summary')

  const panel = read('src/screens/production/QuickVideoPanel.tsx')
  ok(panel.includes('transcribeMediaPath') && panel.includes('words') && panel.includes('captionTimingOf'), 'Quick Video transcribes its voiceover and passes the words into the build')
  ok(panel.includes('Real word timings') && /estimated from the script/.test(panel), 'the panel says which timing it used instead of implying precision')
  ok(read('src/screens/studio/StudioInspector.tsx').includes('Word timing:'), 'Studio shows where a caption’s timing came from')
}

console.log(`auto-captions check passed — ${n} assertions`)
