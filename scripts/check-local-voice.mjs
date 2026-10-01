#!/usr/bin/env node
/**
 * Offline voice input (1.10): audio pipeline, utterance segmentation, engine
 * discovery and command construction. Real Whisper / Windows Speech are not
 * available in CI — this covers everything around them, and runs a fake
 * whisper-cli end to end so the argument contract is exercised for real.
 */
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { execFile } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const tmp = path.join(root, '.local-voice-check.mjs')
await build({ bundle: true, outfile: tmp, format: 'esm', platform: 'neutral', logLevel: 'warning', stdin: { contents: "export * from './src/lib/localVoice'", resolveDir: root, loader: 'ts' } })
const v = await import(`${pathToFileURL(tmp).href}?t=${Date.now()}`)
rmSync(tmp, { force: true })

// Resampling 48 kHz → 16 kHz keeps duration and a 440 Hz tone's energy.
const sr = 48000
const tone = (sec, amp, rate = sr) => Float32Array.from({ length: Math.round(sec * rate) }, (_, i) => amp * Math.sin((2 * Math.PI * 440 * i) / rate))
const down = v.downsample(tone(1, 0.5), sr)
assert.equal(down.length, 16000)
assert.ok(Math.abs(v.rms(down) - 0.5 / Math.SQRT2) < 0.01)

// WAV header: RIFF/WAVE, PCM mono 16 kHz 16-bit, correct sizes.
const wav = v.encodeWav(Float32Array.from([0, 1, -1, 0.5]))
const dv = new DataView(wav.buffer)
const str = (o, n) => String.fromCharCode(...wav.slice(o, o + n))
assert.equal(str(0, 4), 'RIFF'); assert.equal(str(8, 4), 'WAVE'); assert.equal(str(36, 4), 'data')
assert.equal(dv.getUint16(20, true), 1); assert.equal(dv.getUint16(22, true), 1)
assert.equal(dv.getUint32(24, true), 16000); assert.equal(dv.getUint16(34, true), 16)
assert.equal(dv.getUint32(40, true), 8); assert.equal(wav.length, 52)
assert.equal(dv.getInt16(46, true), 32767); assert.equal(dv.getInt16(48, true), -32768)

// Segmenter: silence → speech 1.2 s → silence 1 s → one utterance; clicks ignored.
const chunks = (sec, amp) => {
  const all = tone(sec, amp, 16000)
  const out = []
  for (let i = 0; i < all.length; i += 1600) out.push(all.slice(i, i + 1600))
  return out
}
const seg = new v.UtteranceSegmenter()
const results = []
for (const c of [...chunks(1, 0.001), ...chunks(1.2, 0.2), ...chunks(1, 0.001), ...chunks(0.1, 0.3), ...chunks(1, 0.001)]) {
  const u = seg.push(c)
  if (u) results.push(u)
}
assert.equal(results.length, 1, 'one real utterance; the 0.1 s click is dropped')
const sec = results[0].length / 16000
assert.ok(sec > 1.2 && sec < 2.4, `utterance length ${sec}s includes pre-roll + end silence`)
// Long monologue is cut at the cap.
const long = new v.UtteranceSegmenter({ maxUtteranceSec: 3 })
let cut = 0
for (const c of chunks(7, 0.2)) if (long.push(c)) cut += 1
assert.equal(cut, 2)
assert.ok(long.flush(), 'stop() flushes the tail')

// Engine discovery.
const require = createRequire(import.meta.url)
const e = require('../electron/voice-engines.cjs')
const files = new Set(['/app/whisper/Release/whisper-cli.exe', '/data/whisper/ggml-base.en-q5_1.bin', '/data/whisper/ggml-tiny.en.bin'])
const lists = { '/data/whisper': ['ggml-tiny.en.bin', 'ggml-base.en-q5_1.bin', 'readme.txt'] }
const found = e.findWhisper({ platform: 'win32', dirs: ['/app/whisper', '/data/whisper'], exists: (p) => files.has(p.replace(/\\/g, '/')), list: (d) => lists[d.replace(/\\/g, '/')] || [] })
assert.equal(found.bin.replace(/\\/g, '/'), '/app/whisper/Release/whisper-cli.exe')
assert.equal(path.basename(found.model), 'ggml-base.en-q5_1.bin', 'prefers the quantized base model')
assert.equal(e.findWhisper({ platform: 'win32', dirs: ['/nowhere'], exists: () => false, list: () => [] }), null)
const envFound = e.findWhisper({ env: { NEWBRAND_WHISPER_PATH: '/x/w', NEWBRAND_WHISPER_MODEL: '/x/m.bin' }, dirs: [], exists: () => true, list: () => [] })
assert.deepEqual(envFound, { bin: '/x/w', model: '/x/m.bin' })

// Arguments and transcript cleaning.
const args = e.whisperArgs({ model: 'm.bin', wavPath: 'a.wav', outBase: 'a', lang: 'en-US', threads: 99 })
assert.deepEqual(args, ['-m', 'm.bin', '-f', 'a.wav', '-l', 'en', '-t', '8', '-nt', '-np', '-otxt', '-of', 'a'])
assert.equal(e.whisperArgs({ model: 'm', wavPath: 'w', outBase: 'o', lang: '; rm -rf' })[5], 'en', 'junk language → en')
assert.equal(e.cleanTranscript(' [BLANK_AUDIO]\n Make the title bigger. (music) '), 'Make the title bigger.')
const ps = e.windowsSpeechArgs('C:\\evil"; Remove-Item x; ".wav')
assert.equal(ps[ps.length - 1], 'C:\\evil"; Remove-Item x; ".wav', 'path is a separate argument')
assert.ok(!ps[ps.length - 2].includes('evil'), 'path is never interpolated into the script')
assert.match(e.WINDOWS_SPEECH_SCRIPT, /SetInputToWaveFile\(\$args\[0\]\)/)
assert.match(e.WINDOWS_SPEECH_SCRIPT, /DictationGrammar/)

// A fake whisper-cli honouring the real CLI contract (-of base → base.txt).
if (process.platform !== 'win32') {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'newbrand-whisper-'))
  try {
    mkdirSync(path.join(dir, 'models'))
    writeFileSync(path.join(dir, 'models', 'ggml-base.en.bin'), 'x')
    const bin = path.join(dir, 'whisper-cli')
    writeFileSync(bin, '#!/bin/sh\nwhile [ $# -gt 0 ]; do case "$1" in -of) shift; OUT="$1";; -f) shift; IN="$1";; esac; shift; done\n[ -s "$IN" ] || exit 3\necho " [BLANK_AUDIO] add the like button " > "$OUT.txt"\n')
    chmodSync(bin, 0o755)
    const setup = e.findWhisper({ platform: 'linux', dirs: [dir], exists: (p) => { try { readFileSync(p); return true } catch { return false } }, list: (d) => require('node:fs').readdirSync(d) })
    assert.ok(setup, 'fake install discovered')
    const wavPath = path.join(dir, 'u.wav')
    writeFileSync(wavPath, v.encodeWav(tone(0.5, 0.2, 16000)))
    await new Promise((res, rej) => execFile(setup.bin, e.whisperArgs({ model: setup.model, wavPath, outBase: path.join(dir, 'u') }), (err) => (err ? rej(err) : res())))
    assert.equal(e.cleanTranscript(readFileSync(path.join(dir, 'u.txt'), 'utf8')), 'add the like button')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

// Wiring: VoiceListener prefers the offline engine; the final fallback message stays.
const voice = readFileSync(path.join(root, 'src/lib/voice.ts'), 'utf8')
assert.match(voice, /if \(offlineVoiceEngine\(\)\) return this\.startLocal\(\)/)
assert.match(voice, /case 'network':[\s\S]*Type your brief instead/)
const main = readFileSync(path.join(root, 'electron/main.cjs'), 'utf8')
assert.match(main, /ipcMain\.handle\('voice:transcribe'/)
assert.ok(main.indexOf('whisperSetup()\n    if (whisper)') < main.indexOf('await probeWindowsSpeech()) {'), 'Whisper is tried before Windows Speech')
console.log('local voice check passed — resampling, WAV encoding, utterance segmentation, Whisper/Windows engine chain (hardware pass on Windows still required)')
