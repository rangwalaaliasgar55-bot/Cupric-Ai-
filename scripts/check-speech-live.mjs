#!/usr/bin/env node
/**
 * check:speech-live — do the offline speech engines really work?
 *
 * Every other check around voice is about the app's *beliefs*: that the engine
 * list is complete, that a missing engine produces a download button, that the
 * progress events carry real byte counts. None of them can answer the question a
 * user asks — "if I press that button, do I get a voice?" — because the answer
 * depends on files that live on the internet, and a repository checkout has
 * none of them.
 *
 * This check downloads the real artefacts and runs them:
 *
 *   1. `electron/voice-install.cjs` — the app's own installer, not a copy of it —
 *      fetches the Piper engine and the English voice into a temporary folder;
 *   2. `piper.exe` is run with that voice model and a real sentence on stdin,
 *      exactly the way `electron/tts.cjs` runs it, and the WAV it writes is
 *      parsed here: RIFF/WAVE header, 16-bit PCM, a plausible sample rate, and a
 *      duration computed from the byte count rather than assumed;
 *   3. a second, longer sentence must produce a different amount of audio, which
 *      is what distinguishes synthesis from a canned file;
 *   4. with `--with-whisper`, `scripts/fetch-whisper.mjs` fetches the whisper.cpp
 *      build and the quantized English model, and the WAV from step 2 is
 *      transcribed by `whisper-cli`. The transcript has to contain words that
 *      were actually spoken. That is the round trip: Piper speaks, Whisper
 *      listens, and the words match.
 *
 * Windows only, on purpose — the app is Windows-only, `piper.exe` is a Windows
 * binary and so is the whisper build it fetches. On any other platform this
 * fails with that reason rather than reporting a pass nobody earned.
 *
 * Usage:
 *   npm run check:speech-live
 *   npm run check:speech-live -- --with-whisper     (adds ~60 MB and a few minutes)
 *   npm run check:speech-live -- --keep             (leave the downloads in place)
 */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const voiceInstall = require(path.join(root, 'electron', 'voice-install.cjs'))
const voiceEngines = require(path.join(root, 'electron', 'voice-engines.cjs'))
const tts = require(path.join(root, 'electron', 'tts.cjs'))

const withWhisper = process.argv.includes('--with-whisper')
const keep = process.argv.includes('--keep')

let checks = 0
const ok = (condition, label) => {
  assert.ok(condition, `FAIL: ${label}`)
  checks += 1
  console.log(`  ✓ ${label}`)
}

if (process.platform !== 'win32') {
  console.error('check:speech-live FAILED — this check installs and runs the Windows speech engines.')
  console.error(`  running on ${process.platform}: piper.exe and the whisper.cpp Windows build cannot run here.`)
  console.error('  It is Windows-only because the product is; run it on Windows (the pull-request workflow does).')
  process.exit(1)
}

const work = fs.mkdtempSync(path.join(os.tmpdir(), 'cupric-speech-live-'))
const piperDir = path.join(work, 'piper')
fs.mkdirSync(piperDir, { recursive: true })

/** Parse a WAV file the way a player would, and refuse anything that is not one. */
function readWav(file) {
  const buffer = fs.readFileSync(file)
  if (buffer.length < 44) throw new Error(`${path.basename(file)} is only ${buffer.length} bytes — not a WAV file`)
  const riff = buffer.toString('ascii', 0, 4)
  const wave = buffer.toString('ascii', 8, 12)
  const fmtChunk = buffer.toString('ascii', 12, 16)
  const audioFormat = buffer.readUInt16LE(20)
  const channels = buffer.readUInt16LE(22)
  const sampleRate = buffer.readUInt32LE(24)
  const byteRate = buffer.readUInt32LE(28)
  const bitsPerSample = buffer.readUInt16LE(34)
  // Find the data chunk (there is usually a LIST/fact chunk in front of it).
  let offset = 12
  let dataBytes = 0
  while (offset + 8 <= buffer.length) {
    const id = buffer.toString('ascii', offset, offset + 4)
    const size = buffer.readUInt32LE(offset + 4)
    if (id === 'data') {
      dataBytes = Math.min(size, buffer.length - offset - 8)
      break
    }
    offset += 8 + size + (size % 2)
  }
  return { riff, wave, fmtChunk, audioFormat, channels, sampleRate, byteRate, bitsPerSample, dataBytes, totalBytes: buffer.length }
}

console.log('check:speech-live — downloading the real engines\n')

// ── 1. the app's own installer, against the real servers ─────────────────────
console.log('Piper engine (electron/voice-install.cjs, real network):')
let progressEvents = 0
const piperInstall = await voiceInstall.install('piper', {
  dir: piperDir,
  platform: 'win32',
  onProgress: () => { progressEvents += 1 },
})
ok(piperInstall.ok === true, `the engine installed: ${piperInstall.ok ? piperInstall.dir : `${piperInstall.stage} — ${piperInstall.error}`}`)
ok(fs.existsSync(path.join(piperDir, 'piper.exe')), 'piper.exe is on disk where the app looks for it')
ok(progressEvents > 1, `progress was reported ${progressEvents} times during the download`)

console.log('\nEnglish voice (the lessac medium model):')
const modelInstall = await voiceInstall.install('piper-model-en', { dir: piperDir, platform: 'win32' })
ok(modelInstall.ok === true, `the voice installed: ${modelInstall.ok ? modelInstall.installed.join(', ') : `${modelInstall.stage} — ${modelInstall.error}`}`)

// ── 2. does the app's own Piper discovery find it, and does it speak? ────────
const setup = tts.piperSetup({ platform: 'win32', env: {}, dirs: [piperDir] })
ok(setup !== null, 'electron/tts.cjs discovers the engine the installer just put on disk')
ok(Boolean(setup?.models?.en), `and the English voice with it (${setup?.models?.en ? path.basename(setup.models.en) : 'none'})`)

function speak(text) {
  const out = path.join(work, `speech-${text.length}.wav`)
  const command = tts.piperCommand(setup, 'en', out, {})
  assert.ok(command, 'FAIL: tts.cjs built no Piper command for English')
  // The same invocation the app makes: text on stdin, WAV on disk.
  const result = spawnSync(command.cmd, command.args, { input: text, encoding: 'utf8', timeout: 120_000 })
  assert.equal(result.status, 0, `FAIL: piper.exe exited ${result.status}: ${(result.stderr || result.stdout || '').slice(-400)}`)
  assert.ok(fs.existsSync(out), 'FAIL: piper.exe wrote no file')
  return { file: out, wav: readWav(out) }
}

const first = speak('Cupric AI turns a rough idea into a finished video.')
ok(first.wav.riff === 'RIFF' && first.wav.wave === 'WAVE', 'the engine wrote a real RIFF/WAVE file')
ok(first.wav.audioFormat === 1 && first.wav.bitsPerSample === 16, `and it is uncompressed 16-bit PCM (format ${first.wav.audioFormat}, ${first.wav.bitsPerSample}-bit)`)
ok([16000, 22050, 24000].includes(first.wav.sampleRate), `at a sample rate the voice model declares (${first.wav.sampleRate} Hz)`)
const firstSeconds = first.wav.dataBytes / first.wav.byteRate
ok(firstSeconds > 1.5 && firstSeconds < 12, `speaking one sentence produced ${firstSeconds.toFixed(2)}s of audio`)

const second = speak('This is a much longer sentence, read out loud, so that the amount of audio it produces is plainly different from the short one before it.')
const secondSeconds = second.wav.dataBytes / second.wav.byteRate
ok(secondSeconds > firstSeconds, `a longer sentence produced more audio (${secondSeconds.toFixed(2)}s vs ${firstSeconds.toFixed(2)}s)`)
ok(second.wav.dataBytes !== first.wav.dataBytes, 'the two files differ, so this is synthesis rather than a canned sample')

// ── 3. the round trip: Piper speaks, Whisper listens ────────────────────────
if (withWhisper) {
  console.log('\nWhisper (whisper.cpp + a quantized English model, real network):')
  const fetch = spawnSync(process.execPath, [path.join(root, 'scripts', 'fetch-whisper.mjs')], { cwd: root, encoding: 'utf8', timeout: 30 * 60 * 1000 })
  const fetchTail = `${fetch.stdout || ''}${fetch.stderr || ''}`.trim().split(/\r?\n/).slice(-4).join('\n')
  assert.equal(fetch.status, 0, `FAIL: whisper:fetch exited ${fetch.status}\n${fetchTail}`)
  checks += 1
  console.log(`  ✓ the whisper build and model were fetched\n${fetchTail.split('\n').map((l) => `      ${l}`).join('\n')}`)

  const whisper = voiceEngines.findWhisper({
    env: {},
    dirs: [path.join(root, 'vendor', 'whisper')],
    platform: 'win32',
    exists: (p) => fs.existsSync(p),
    list: (d) => fs.readdirSync(d),
  })
  ok(whisper !== null, `electron/voice-engines.cjs finds what was just fetched (${whisper ? path.basename(whisper.bin) : 'nothing'})`)

  const spoken = 'Cupric AI turns a rough idea into a finished video.'
  const heard = speak(spoken)
  const outBase = path.join(work, 'transcript')
  const args = voiceEngines.whisperArgs({ model: whisper.model, wavPath: heard.file, outBase, lang: 'en', threads: Math.max(1, os.cpus().length - 1) })
  const run = spawnSync(whisper.bin, args, { cwd: path.dirname(whisper.bin), encoding: 'utf8', timeout: 10 * 60 * 1000 })
  const transcript = voiceEngines.cleanTranscript(fs.existsSync(`${outBase}.txt`) ? fs.readFileSync(`${outBase}.txt`, 'utf8') : '')
  ok(run.status === 0, `whisper-cli exited ${run.status}${run.status === 0 ? '' : `: ${(run.stderr || '').slice(-300)}`}`)
  ok(transcript.length > 0, `it produced a transcript: "${transcript}"`)
  const normalised = transcript.toLowerCase().replace(/[^a-z ]/g, ' ')
  const expected = ['cupric', 'idea', 'video']
  const found = expected.filter((word) => normalised.includes(word))
  ok(found.length >= 1, `the transcript contains what was actually spoken (matched: ${found.join(', ') || 'nothing'} of ${expected.join(', ')})`)
}

if (!keep) fs.rmSync(work, { recursive: true, force: true })
console.log(`\ncheck:speech-live passed — ${checks} assertions against real downloads${withWhisper ? ' (Piper and Whisper)' : ' (Piper)'}`)
if (keep) console.log(`the downloads were kept in ${work}`)
