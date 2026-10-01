/**
 * Offline speech recognition for the desktop app (1.10).
 *
 * Web Speech in Chromium streams audio to an online Google service that a
 * packaged Electron app cannot use, so dictation never worked on desktop.
 * The renderer now records the microphone itself (16 kHz mono WAV per
 * utterance) and main transcribes it locally, trying in order:
 *
 *   1. Whisper (whisper.cpp CLI + a ggml model) — fully offline, any OS.
 *      Looked for in NEWBRAND_WHISPER_PATH / NEWBRAND_WHISPER_MODEL, then the
 *      app's bundled `whisper/` resources folder, then `<userData>/whisper/`,
 *      then `vendor/whisper/` in a dev checkout. `npm run whisper:fetch`
 *      downloads a quantized English model and the Windows binary there.
 *   2. Windows Speech Recognition (System.Speech, via Windows PowerShell) —
 *      built into Windows, offline, reads the same WAV file.
 *   3. Neither → the caller keeps the existing single friendly message.
 *
 * No Electron imports, so scripts/check-local-voice.mjs tests discovery,
 * argument building and output cleaning without either engine installed.
 */
const path = require('node:path')

const BIN_NAMES = ['whisper-cli', 'whisper', 'main'] // newest name first
const MODEL_PREFERENCE = [
  'ggml-base.en-q5_1.bin',
  'ggml-base.en.bin',
  'ggml-small.en-q5_1.bin',
  'ggml-small.en.bin',
  'ggml-tiny.en-q5_1.bin',
  'ggml-tiny.en.bin',
  'ggml-base-q5_1.bin',
  'ggml-base.bin',
]

function exeNames(platform) {
  return BIN_NAMES.flatMap((n) => (platform === 'win32' ? [`${n}.exe`] : [n]))
}

/**
 * Find a whisper.cpp binary and model. `exists(p)` and `list(dir)` are
 * injected (fs.existsSync / fs.readdirSync) so this is testable.
 */
function findWhisper({ env = {}, dirs = [], platform = process.platform, exists, list }) {
  const envBin = env.NEWBRAND_WHISPER_PATH && exists(env.NEWBRAND_WHISPER_PATH) ? env.NEWBRAND_WHISPER_PATH : null
  const envModel = env.NEWBRAND_WHISPER_MODEL && exists(env.NEWBRAND_WHISPER_MODEL) ? env.NEWBRAND_WHISPER_MODEL : null
  let bin = envBin
  let model = envModel
  for (const dir of dirs) {
    if (!dir) continue
    const candidates = [dir, path.join(dir, 'Release'), path.join(dir, 'bin')]
    if (!bin) {
      for (const d of candidates) {
        const hit = exeNames(platform).map((n) => path.join(d, n)).find((p) => exists(p))
        if (hit) {
          bin = hit
          break
        }
      }
    }
    if (!model) {
      for (const d of [dir, path.join(dir, 'models')]) {
        let names = []
        try {
          names = list(d) || []
        } catch {
          names = []
        }
        const pick = MODEL_PREFERENCE.find((m) => names.includes(m)) || names.find((n) => /^ggml-.*\.bin$/i.test(n))
        if (pick) {
          model = path.join(d, pick)
          break
        }
      }
    }
    if (bin && model) break
  }
  return bin && model ? { bin, model } : null
}

/** whisper.cpp CLI arguments: plain text out, no timestamps, no progress. */
function whisperArgs({ model, wavPath, outBase, lang = 'en', threads = 4 }) {
  const language = String(lang || 'en').slice(0, 2).toLowerCase()
  return ['-m', model, '-f', wavPath, '-l', /^[a-z]{2}$/.test(language) ? language : 'en', '-t', String(Math.max(1, Math.min(8, threads))), '-nt', '-np', '-otxt', '-of', outBase]
}

/** Drop whisper's non-speech markers and collapse whitespace. */
function cleanTranscript(text) {
  return String(text || '')
    .replace(/\[(?:BLANK_AUDIO|MUSIC|NOISE|SILENCE|INAUDIBLE|APPLAUSE|LAUGHTER)[^\]]*\]/gi, ' ')
    .replace(/\((?:music|noise|silence|inaudible|blank audio|applause|laughs?|laughter)[^)]*\)/gi, ' ')
    .replace(/\[\d{2}:\d{2}[^\]]*\]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * PowerShell for Windows Speech Recognition over a WAV file. The path is
 * passed as an argument ($args[0]), never interpolated into the script, so a
 * file name cannot inject code.
 */
const WINDOWS_SPEECH_SCRIPT = [
  '$ErrorActionPreference = "Stop"',
  'Add-Type -AssemblyName System.Speech',
  '$engine = New-Object System.Speech.Recognition.SpeechRecognitionEngine',
  '$engine.LoadGrammar((New-Object System.Speech.Recognition.DictationGrammar))',
  '$engine.SetInputToWaveFile($args[0])',
  '$parts = @()',
  'while ($true) { $r = $engine.Recognize(); if ($r -eq $null) { break }; $parts += $r.Text }',
  '$engine.Dispose()',
  '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8',
  'Write-Output ($parts -join " ")',
].join('; ')

function windowsSpeechArgs(wavPath) {
  return ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', `& { ${WINDOWS_SPEECH_SCRIPT} }`, wavPath]
}

/** Probe: does this Windows have a System.Speech recognizer installed? */
const WINDOWS_SPEECH_PROBE = 'Add-Type -AssemblyName System.Speech; $n = [System.Speech.Recognition.SpeechRecognitionEngine]::InstalledRecognizers().Count; Write-Output $n'

/* ——— timed transcription for auto-captions ——————————————————————————— */

/**
 * whisper.cpp arguments for word timing: one segment per word (-ml 1 -sow),
 * JSON out (-oj) with millisecond offsets.
 */
function whisperWordArgs({ model, wavPath, outBase, lang = 'en', threads = 4 }) {
  const language = String(lang || 'en').slice(0, 2).toLowerCase()
  return ['-m', model, '-f', wavPath, '-l', /^[a-z]{2}$/.test(language) ? language : 'en', '-t', String(Math.max(1, Math.min(8, threads))), '-np', '-ml', '1', '-sow', '-oj', '-of', outBase]
}

/** whisper.cpp -oj output → [{word,start,end}] in seconds, non-speech dropped. */
function parseWhisperWords(jsonText) {
  let data
  try {
    data = JSON.parse(jsonText)
  } catch {
    throw new Error('Whisper produced unreadable JSON.')
  }
  const segs = Array.isArray(data?.transcription) ? data.transcription : []
  const words = []
  for (const seg of segs) {
    const text = cleanTranscript(seg?.text || '')
    if (!text) continue
    const from = Number(seg?.offsets?.from)
    const to = Number(seg?.offsets?.to)
    if (!Number.isFinite(from) || !Number.isFinite(to)) continue
    // A "word" segment can still hold two tokens (e.g. "U.S. A"): split evenly.
    const parts = text.split(/\s+/).filter(Boolean)
    const span = Math.max(1, to - from) / parts.length
    parts.forEach((w, i) => words.push({ word: w, start: (from + span * i) / 1000, end: (from + span * (i + 1)) / 1000 }))
  }
  return words
}

/**
 * Windows Speech with timing: each recognised phrase reports its audio
 * position and duration. Words get spread across their phrase — honest
 * phrase-level timing, flagged as such to the UI.
 */
const WINDOWS_TIMED_SCRIPT = [
  '$ErrorActionPreference = "Stop"',
  'Add-Type -AssemblyName System.Speech',
  '$engine = New-Object System.Speech.Recognition.SpeechRecognitionEngine',
  '$engine.LoadGrammar((New-Object System.Speech.Recognition.DictationGrammar))',
  '$engine.SetInputToWaveFile($args[0])',
  '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8',
  'while ($true) { $r = $engine.Recognize(); if ($r -eq $null) { break }; Write-Output ("{0}`t{1}`t{2}" -f $r.Audio.AudioPosition.TotalMilliseconds, $r.Audio.Duration.TotalMilliseconds, $r.Text) }',
  '$engine.Dispose()',
].join('; ')

function windowsTimedArgs(wavPath) {
  return ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', `& { ${WINDOWS_TIMED_SCRIPT} }`, wavPath]
}

/** "posMs<TAB>durMs<TAB>text" lines → [{word,start,end}], spread per phrase. */
function parseWindowsPhrases(stdout) {
  const words = []
  for (const line of String(stdout || '').split(/\r?\n/)) {
    const [pos, dur, ...rest] = line.split('\t')
    const text = cleanTranscript(rest.join(' '))
    const from = Number(pos)
    const len = Number(dur)
    if (!text || !Number.isFinite(from) || !Number.isFinite(len)) continue
    const parts = text.split(/\s+/)
    const weights = parts.map((w) => Math.max(1, w.length))
    const total = weights.reduce((a, b) => a + b, 0)
    let cursor = from
    parts.forEach((w, i) => {
      const d = (len * weights[i]) / total
      words.push({ word: w, start: cursor / 1000, end: (cursor + d) / 1000 })
      cursor += d
    })
  }
  return words
}

/** FFmpeg: any audio/video file → 16 kHz mono PCM WAV for the recognisers. */
function extractWavArgs(sourcePath, wavPath, maxSec = 1800) {
  return ['-y', '-hide_banner', '-v', 'error', '-i', sourcePath, '-vn', '-ac', '1', '-ar', '16000', '-t', String(maxSec), '-c:a', 'pcm_s16le', wavPath]
}

module.exports = {
  whisperWordArgs, parseWhisperWords, WINDOWS_TIMED_SCRIPT, windowsTimedArgs, parseWindowsPhrases, extractWavArgs, findWhisper, whisperArgs, cleanTranscript, windowsSpeechArgs, WINDOWS_SPEECH_SCRIPT, WINDOWS_SPEECH_PROBE, MODEL_PREFERENCE, exeNames }
