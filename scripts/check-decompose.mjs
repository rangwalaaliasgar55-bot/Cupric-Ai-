#!/usr/bin/env node
/**
 * Break a clip into editable pieces — "import a finished video and take it
 * apart". Covers the pure half (`breakAtCuts`: close the pauses up, or split at
 * their boundaries keeping the original timing), the modes of `decomposeClip`
 * (measured silence / pauses in the words / even pieces / scene changes / the
 * shots-and-pauses import path), the shot detector's pure half
 * (`frameDifference`, `shotCutTimes`, `remapSourceTime`), the word coverage
 * across the pieces, the caption hand-off, the speed mapping and the honest
 * failure paths. The waveform probe needs real audio and the shot detector needs
 * a decodable video, so both measured paths are only checked for their graceful
 * failure here; the packaged-desktop scenario covers the rest.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import { rm } from 'node:fs/promises'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const out = path.join(root, '.check-decompose.mjs')
await build({
  bundle: true, outfile: out, format: 'esm', platform: 'node', logLevel: 'error',
  stdin: { contents: "export * from './src/lib/studio/decompose'\nexport * as ac from './src/lib/studio/autoCaptions'\nexport * as doc from './src/lib/studio/doc'\nexport * as shots from './src/lib/studio/shots'", resolveDir: root, loader: 'ts' },
})
const m = await import(pathToFileURL(out).href)
await rm(out, { force: true })

let n = 0
const ok = (c, msg) => { assert.ok(c, msg); n += 1 }
const near = (a, b, tol, msg) => ok(Math.abs(a - b) <= tol, `${msg} (${a} vs ${b})`)
const read = (p) => readFileSync(path.join(root, p), 'utf8')

/* ——— one clip, three spoken sentences, two long pauses ——— */
const words = [
  { word: 'This', start: 0, end: 0.3 }, { word: 'is', start: 0.32, end: 0.6 }, { word: 'one.', start: 0.62, end: 0.9 },
  { word: 'Second', start: 2.0, end: 2.3 }, { word: 'sentence.', start: 2.32, end: 2.7 },
  { word: 'Third', start: 5.5, end: 5.8 }, { word: 'one!', start: 5.82, end: 6.2 },
]
const video = {
  id: 'v', kind: 'video', track: 0, startSec: 0, durationSec: 10, name: 'Interview take 2',
  transitionIn: 'none', transitionOut: 'none', opacity: 1, mediaId: 'm-video', fileName: 'take2.mp4', localPath: '/tmp/take2.mp4',
  trimInSec: 0, sourceDurationSec: 12, speed: 1, volume: 1, fit: 'cover', x: 0.5, y: 0.5, scale: 1, words,
}
const overlay = { ...m.doc.defaultTextClip(7, 2), id: 'lower', name: 'Lower third', text: 'Guest' }
const music = {
  id: 'mus', kind: 'audio', track: 2, startSec: 0, durationSec: 10, name: 'Bed', role: 'music',
  transitionIn: 'none', transitionOut: 'none', opacity: 1, mediaId: 'm-music', fileName: 'bed.mp3', localPath: null,
  trimInSec: 0, sourceDurationSec: 30, volume: 0.2,
}
const baseDoc = { aspect: '16:9', fps: 30, backgroundId: 'lime-void', trackCount: 3, clips: [video, overlay, music] }
const clone = () => JSON.parse(JSON.stringify(baseDoc))

/* ——— naming ——— */
ok(m.stripPieceSuffix('Interview take 2 · 2/5') === 'Interview take 2', 'a piece suffix is stripped before re-labeling')
ok(m.pieceName('Interview take 2', 0, 3) === 'Interview take 2 · 1/3', 'pieces are numbered')
ok(m.stripPieceSuffix('Plain name') === 'Plain name', 'a name with no suffix is untouched')

/* ——— breakAtCuts: close the pauses up ——— */
{
  const cuts = [[1.02, 1.88], [2.82, 5.38], [6.32, 10]]
  const r = m.breakAtCuts(clone(), 'v', cuts)
  ok(!r.reason && r.pieces === 3, `three cuts → three pieces (${r.reason ?? ''})`)
  near(r.removedSec, 7.1, 0.01, 'the removed silence is reported')
  const pieces = r.doc.clips.filter((c) => c.mediaId === 'm-video').sort((a, b) => a.startSec - b.startSec)
  ok(pieces.map((p) => p.name).join(' | ') === 'Interview take 2 · 1/3 | Interview take 2 · 2/3 | Interview take 2 · 3/3', 'pieces are named in order')
  near(pieces[0].startSec, 0, 1e-9, 'the first piece keeps the clip’s position')
  near(pieces[1].startSec, 1.02, 0.001, 'pieces are butted together (no gap)')
  near(pieces[2].startSec, 1.96, 0.001, 'and the second gap closed too')
  near(pieces.reduce((a, p) => a + p.durationSec, 0), 2.9, 0.01, 'the video is 7.1 s shorter')
  ok(pieces.every((p) => p.kind === 'video' && p.track === 0 && p.trimInSec >= 0 && p.trimInSec < 12), 'every piece is an ordinary video clip with a real trim')
  ok(pieces[0].transitionIn === 'none' && pieces[2].transitionOut === 'none', 'transitions stay on the outer edges')
  const moved = r.doc.clips.find((c) => c.id === 'lower')
  // It sat at 7 s, inside removed silence, so it lands on the boundary the cut created.
  near(moved.startSec, 2.9, 0.01, 'an overlay after the cuts moves left with the audio')
  const bed = r.doc.clips.find((c) => c.id === 'mus')
  near(bed.startSec, 0, 1e-9, 'clips before the cut do not move')
  near(bed.durationSec, 2.9, 0.01, 'a music bed over the whole clip shortens with it')
  ok(r.doc.clips.length === 5, 'three video pieces + overlay + music, nothing else invented')
}

/* ——— breakAtCuts: keep the original timing ——— */
{
  const cuts = [[1.02, 1.88], [2.82, 5.38]]
  const r = m.breakAtCuts(clone(), 'v', cuts, { keepTiming: true })
  ok(!r.reason && r.pieces === 5, `two cuts → five clips (speech, pause, speech, pause, speech) — got ${r.pieces}`)
  ok(r.removedSec === 0, 'nothing is removed when the timing is kept')
  const pieces = r.doc.clips.filter((c) => c.mediaId === 'm-video').sort((a, b) => a.startSec - b.startSec)
  near(pieces[0].startSec, 0, 1e-9, 'still starts where the clip started')
  near(pieces[pieces.length - 1].startSec + pieces[pieces.length - 1].durationSec, 10, 0.001, 'still ends where the clip ended')
  const cover = pieces.map((p) => [p.startSec, p.startSec + p.durationSec])
  ok(cover.every((r2, i) => i === 0 || Math.abs(r2[0] - cover[i - 1][1]) < 0.001), 'the pieces tile the clip with no gap and no overlap')
  const moved = r.doc.clips.find((c) => c.id === 'lower')
  near(moved.startSec, 7, 1e-9, 'overlays do not move (the timeline is unchanged)')
}

/* ——— decide: pauses in the words ——— */
{
  const r = await m.decomposeClip(clone(), 'v', { mode: 'words', caption: {} })
  ok(!r.reason, `words mode breaks the clip (${r.reason ?? ''})`)
  ok(r.pieces === 3 && r.cuts === 3, `three spoken sentences → three pieces (${r.pieces})`)
  ok(r.captions > 0, 'the pieces are captioned from the clip’s own word timings')
  ok(r.notes.some((x) => /pause.*in the word timings/.test(x)), 'the note says the boundaries came from the word timings')
  ok(r.notes.some((x) => /word timings stay on the pieces/i.test(x)), 'the note says word timings survive the split')
  const pieces = r.doc.clips.filter((c) => c.mediaId === 'm-video').sort((a, b) => a.startSec - b.startSec)
  // No word may be lost or duplicated across the pieces.
  const seen = pieces.flatMap((p) => m.ac.wordsToTimeline(p.words ?? [], p)).map((w) => w.word)
  ok(seen.length === words.length, `every word lands in exactly one piece (${seen.length}/${words.length})`)
  ok(words.every((w) => seen.includes(w.word)), 'no word was dropped by the split')
  ok(seen.join(' ') === words.map((w) => w.word).join(' '), 'and the order is the spoken order')
  // Captions were moved onto the new, shorter timeline.
  const caps = r.doc.clips.filter((c) => c.kind === 'text' && c.id.startsWith('cap-'))
  ok(caps.length > 0 && caps.every((c) => c.startSec + c.durationSec <= 3.1), 'captions follow the cut instead of pointing at removed silence')
  ok(caps.every((c) => c.timingSource === 'word' && c.wordDelaysMs?.length === c.text.split(/\s+/).length), 'captions stay word-timed and correctly sized')
  const second = await m.decomposeClip(clone(), 'v', { mode: 'words', caption: {} })
  // New clips get fresh ids by design (the same `uid()` a manual split uses), so
  // determinism here means identical pieces, times, trims and names.
  const shape = (d) => JSON.stringify({ ...d, clips: d.clips.map(({ id, ...rest }) => rest) })
  ok(shape(r.doc) === shape(second.doc), 'the split is deterministic apart from the new clip ids')
  // Re-splitting must not stack suffixes.
  const again = await m.decomposeClip(r.doc, pieces[0].id, { mode: 'words', caption: null })
  ok(again.reason || again.doc.clips.filter((c) => c.mediaId === 'm-video').every((c) => !/·\s\d+\/\d+\s·\s\d+\/\d+/.test(c.name)), 'breaking a piece again does not stack suffixes')
}

/* ——— decide: even pieces ——— */
{
  const r = await m.decomposeClip(clone(), 'v', { mode: 'even', pieceSec: 4 })
  ok(!r.reason && r.pieces === 3, `10 s in 4 s pieces → 3 (${r.pieces})`)
  const pieces = r.doc.clips.filter((c) => c.mediaId === 'm-video').sort((a, b) => a.startSec - b.startSec)
  near(pieces[0].durationSec, 10 / 3, 0.01, 'pieces are evenly long')
  near(pieces.reduce((a, p) => a + p.durationSec, 0), 10, 0.01, 'the clip keeps its length')
  near(pieces[2].trimInSec, 20 / 3, 0.01, 'each piece starts deeper into the source')
  ok(r.removedSec === 0 && r.notes.some((x) => /still plays back exactly as before/.test(x)), 'even mode removes nothing and says so')
}

/* ——— speed is honoured ——— */
{
  const fast = { ...clone(), clips: [{ ...video, speed: 2, durationSec: 5 }] }
  const r = m.breakAtCuts(fast, 'v', [[2.04, 3.76]], { keepTiming: true })
  ok(!r.reason && r.pieces === 3, 'a 2× clip still splits at the right boundaries')
  const pieces = r.doc.clips.filter((c) => c.mediaId === 'm-video').sort((a, b) => a.startSec - b.startSec)
  near(pieces[0].durationSec, 1.02, 0.01, 'the first piece is the source range divided by the speed')
  near(pieces[1].startSec, 1.02, 0.01, 'the pause piece sits where it really is on the timeline')
  near(pieces.reduce((a, p) => a + p.durationSec, 0), 5, 0.01, 'the timeline length is unchanged')
}

/* ——— honest failures ——— */
{
  const noWords = { ...clone(), clips: [{ ...video, words: null }] }
  const r1 = await m.decomposeClip(noWords, 'v', { mode: 'words' })
  ok(!r1.pieces || r1.pieces === 1, 'no word timings → nothing is broken')
  ok(/no word timings/i.test(r1.reason ?? ''), `and it says what to do instead (${r1.reason})`)
  const locked = { ...clone(), clips: [{ ...video, locked: true }] }
  ok(/locked/i.test((await m.decomposeClip(locked, 'v', { mode: 'words' })).reason ?? ''), 'a locked clip is refused')
  const tiny = { ...clone(), clips: [{ ...video, durationSec: 0.4 }] }
  ok(/nothing to chop|shorter than/i.test((await m.decomposeClip(tiny, 'v', { mode: 'even', pieceSec: 4 })).reason ?? ''), 'too short to chop → refused, not silently split')
  // No file on this machine → the measured-silence mode must explain itself.
  const r4 = await m.decomposeClip(clone(), 'v', { mode: 'silence' })
  ok(/cannot read this clip’s audio|relink/i.test(r4.reason ?? ''), `unreadable audio is named, not faked (${r4.reason})`)
  ok((await m.decomposeClip(clone(), 'lower', { mode: 'silence' })).reason?.includes('video or audio'), 'a text clip is not breakable')
  // A failure must hand back the document exactly as it arrived: no caption half
  // added, no renamed piece, nothing for the caller to accidentally commit.
  const before = JSON.stringify(clone())
  const failed = await m.decomposeClip(clone(), 'v', { mode: 'silence', caption: {} })
  ok(!!failed.reason && failed.pieces === 1 && failed.captions === 0, 'a failed break reports one piece and no captions')
  ok(JSON.stringify(failed.doc) === before, 'and returns the document untouched')
}

/* ——— UI wiring ——— */
{
  const panel = read('src/screens/studio/StudioProPanel.tsx')
  ok(panel.includes('decomposeClip') && panel.includes('Break into clips'), 'the Pro panel offers breaking a clip apart')
  ok(/Measured pauses/.test(panel) && /Even pieces/.test(panel) && /Keep the original timing/.test(panel), 'all three modes and the timing choice are reachable')
  const studio = read('src/screens/Studio.tsx')
  ok(studio.includes('break-into-clips') && studio.includes('Break into clips (measured pauses)'), 'the timeline right-click menu offers it too')
  ok(/one Undo reverts it/.test(studio), 'the quick action says the result is one undo step')
}

/* ——— shot detection (studio/shots.ts) ——— */
{
  const black = new Uint8ClampedArray([0, 0, 0, 255, 0, 0, 0, 255])
  const white = new Uint8ClampedArray([255, 255, 255, 255, 255, 255, 255, 255])
  const half = new Uint8ClampedArray([255, 255, 255, 255, 0, 0, 0, 255])
  near(m.shots.frameDifference(black, black), 0, 1e-9, 'identical frames differ by nothing')
  near(m.shots.frameDifference(black, white), 1, 1e-9, 'a black-to-white change is 1')
  near(m.shots.frameDifference(black, half), 0.5, 1e-9, 'a half-frame change is 0.5')
  ok(m.shots.frameDifference(new Uint8ClampedArray(0), black) === 0, 'an empty buffer cannot report a change')
  near(m.shots.median([3, 1, 2]), 2, 1e-9, 'median of an odd list')
  near(m.shots.median([4, 1, 3, 2]), 2.5, 1e-9, 'median of an even list')
  ok(m.shots.median([]) === 0, 'median of nothing is 0, not NaN')

  const montage = []
  for (let i = 0; i <= 80; i += 1) montage.push({ t: i * 0.25, diff: 0.01 })
  montage.find((f) => Math.abs(f.t - 5) < 1e-9).diff = 0.4
  montage.find((f) => Math.abs(f.t - 10) < 1e-9).diff = 0.35
  montage.find((f) => Math.abs(f.t - 10.25) < 1e-9).diff = 0.05
  const cuts = m.shots.shotCutTimes(montage)
  ok(JSON.stringify(cuts) === '[5,10]', `a montage yields its two cuts (${JSON.stringify(cuts)})`)
  const plusOne = m.shots.shotCutTimes([...montage, { t: 15, diff: 0.5 }])
  ok(plusOne[plusOne.length - 1] === 15, 'a later cut is found too')

  // Two spikes closer than one shot: the stronger one wins, at its own time.
  const close = [{ t: 0, diff: 0.01 }, { t: 1, diff: 0.3 }, { t: 1.2, diff: 0.6 }, { t: 2, diff: 0.01 }]
  ok(JSON.stringify(m.shots.shotCutTimes(close)) === '[1.2]', 'two changes inside one shot collapse to the stronger')
  // A locked-off shot with sensor noise must not produce cuts.
  const noise = Array.from({ length: 40 }, (_, i) => ({ t: i * 0.25, diff: i % 3 === 0 ? 0.02 : i % 3 === 1 ? 0.012 : 0.016 }))
  ok(m.shots.shotCutTimes(noise).length === 0, 'sensor noise is not a cut')
  // A handheld shot has a high, noisy baseline: the adaptive threshold absorbs it.
  const handheld = Array.from({ length: 40 }, (_, i) => ({ t: i * 0.25, diff: i === 20 ? 0.09 : 0.05 + (i % 5) * 0.008 }))
  ok(m.shots.shotCutTimes(handheld).length === 0, 'a moving camera is not a montage')
  // A fast cross-fade reads as at most one cut, never a cascade of them.
  const fade = [{ t: 0, diff: 0.01 }, { t: 0.25, diff: 0.22 }, { t: 0.5, diff: 0.22 }, { t: 0.75, diff: 0.01 }]
  ok(m.shots.shotCutTimes(fade).length === 1, 'a short fade is one boundary, not two')
  ok(m.shots.shotCutTimes([]).length === 0 && m.shots.shotCutTimes([{ t: 0, diff: 0.9 }]).length === 0, 'too few samples means no cuts')

  // remapSourceTime: where a boundary landed before the cuts were made.
  const v = { startSec: 4, durationSec: 6, trimInSec: 2, speed: 1 }
  near(m.shots.remapSourceTime(2, v, [[3, 4]]), 4, 1e-9, 'a time before any cut is unchanged')
  near(m.shots.remapSourceTime(3.5, v, [[3, 4]]), 5, 1e-9, 'a time inside a removed range lands on its start')
  near(m.shots.remapSourceTime(5, v, [[3, 4]]), 6, 1e-9, 'a time after the cut moves left by what was removed')
  near(m.shots.remapSourceTime(0, v, []), 4, 1e-9, 'a source time before the trim-in clamps to the clip’s first frame')
  near(m.shots.remapSourceTime(30, v, []), 10, 1e-9, 'and one past the end clamps to its last')
  near(m.shots.remapSourceTime(4, { startSec: 0, durationSec: 2, trimInSec: 0, speed: 2 }, [[1, 2]]), 1.5, 1e-9, 'speed divides the result, as it does everywhere else')
}

/* ——— decide: scene changes, and the import path ——— */
{
  // Shots only: nothing is removed, the sequence is unchanged.
  const r = await m.decomposeClip(clone(), 'v', { mode: 'shots', shots: [3, 6] })
  ok(!r.reason && r.pieces === 3, `two shot cuts → three clips (${r.reason ?? r.pieces})`)
  ok(r.removedSec === 0, 'shots alone remove nothing')
  const pieces = r.doc.clips.filter((c) => c.mediaId === 'm-video').sort((a, b) => a.startSec - b.startSec)
  ok(pieces.map((p) => p.name).join(' | ') === 'Interview take 2 · 1/3 | Interview take 2 · 2/3 | Interview take 2 · 3/3', 'shot pieces are named in order')
  near(pieces[2].startSec + pieces[2].durationSec, 10, 0.01, 'the sequence still spans the same time')
  ok(pieces.every((p) => p.words?.length), 'word timings ride along on every shot piece')
  ok(r.notes.some((x) => /shot boundar/.test(x)), 'the note says the split came from the picture')

  // No cuts found: say so instead of splitting at random.
  const none = await m.decomposeClip(clone(), 'v', { mode: 'shots', shots: [] })
  ok(!none.pieces || none.pieces === 1, 'no shot cuts → nothing is split')
  ok(/picture changes too little|No cue lands/i.test(none.reason ?? ''), `and the reason names the picture (${none.reason})`)

  // The import path: close the pauses AND split at the shot cuts that survive.
  const auto = await m.decomposeClip(clone(), 'v', { mode: 'auto', shots: [2.3, 8] })
  ok(!auto.reason, `auto mode breaks the clip (${auto.reason ?? ''})`)
  ok(auto.pieces === 4, `3 spoken pieces + 1 shot split inside a kept range (${auto.pieces})`)
  near(auto.removedSec, 7.1, 0.01, 'the measured pauses were closed')
  ok(auto.notes.some((x) => /Closed 3 pauses/.test(x)), 'the note says the pauses came from the word timings')
  ok(auto.notes.some((x) => /of 2 shot cuts landed inside removed silence/.test(x)), 'the shot inside removed silence is reported, not faked into an empty piece')
  const autos = auto.doc.clips.filter((c) => c.mediaId === 'm-video').sort((a, b) => a.startSec - b.startSec)
  ok(autos.every((p, i) => i === 0 || Math.abs(p.startSec - (autos[i - 1].startSec + autos[i - 1].durationSec)) < 0.002), 'the import pieces tile the new timeline')
  const seen = autos.flatMap((p) => m.ac.wordsToTimeline(p.words ?? [], p)).map((w) => w.word)
  ok(seen.length === words.length, `auto mode keeps every word (${seen.length}/${words.length})`)

  // With the original timing kept, a shot inside a pause still splits there.
  const kept = await m.decomposeClip(clone(), 'v', { mode: 'auto', shots: [3.5], keepTiming: true })
  ok(!kept.reason && kept.pieces === 7, `kept timing: 6 pause-boundary clips + 1 shot split (${kept.pieces})`)
  ok(kept.removedSec === 0, 'kept timing removes nothing')
  const keptPieces = kept.doc.clips.filter((c) => c.mediaId === 'm-video').sort((a, b) => a.startSec - b.startSec)
  near(keptPieces[0].startSec, 0, 1e-9, 'and still starts at the clip’s own time')
  near(keptPieces[keptPieces.length - 1].startSec + keptPieces[keptPieces.length - 1].durationSec, 10, 0.01, 'and still ends at the clip’s own time')

  // Progress is reported while the frames are sampled.
  const seenProgress = []
  await m.decomposeClip(clone(), 'v', { mode: 'shots', shots: [3], onProgress: (pct, label) => seenProgress.push([pct, label]) })
  ok(seenProgress.length === 0, 'pre-measured shots need no sampling (the caller already paid for it)')

  // An audio clip cannot be shot-detected: it has no picture to look at.
  const audioOnly = { ...clone(), clips: [{ ...video, kind: 'audio', role: 'voice' }] }
  const r2 = await m.decomposeClip(audioOnly, 'v', { mode: 'shots' })
  ok(/picture/i.test(r2.reason ?? ''), `audio is refused for shot mode with a reason about the picture (${r2.reason})`)
}

/* ——— UI wiring ——— */
{
  const panel = read('src/screens/studio/StudioProPanel.tsx')
  ok(/Scene changes/.test(panel) && /Shots \+ pauses/.test(panel), 'the Pro panel offers both shot-based modes')
  const studio = read('src/screens/Studio.tsx')
  ok(/scene changes/i.test(studio) && studio.includes('break-at-shots'), 'the timeline menu offers breaking at scene changes')
}

console.log(`decompose check passed — ${n} assertions`)
