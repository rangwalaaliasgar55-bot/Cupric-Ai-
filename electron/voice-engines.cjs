/**
 * Offline speech recognition for the desktop app (1.10).
 *
 * Web Speech in Chromium streams audio to an online Google service that a
 * packaged Electron app cannot use, so dictation never worked on desktop.
 * The renderer now records the microphone itself (16 kHz mono WAV per
 * utterance) and main transcribes it locally, trying in order:
 *
 *   1. Whisper (whisper.cpp CLI + a ggml model) — fully offline, any OS.
 *      Looked for in CUPRIC_WHISPER_PATH / CUPRIC_WHISPER_MODEL, then the
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
  const envBin = env.CUPRIC_WHISPER_PATH && exists(env.CUPRIC_WHISPER_PATH) ? env.CUPRIC_WHISPER_PATH : null
  const envModel = env.CUPRIC_WHISPER_MODEL && exists(env.CUPRIC_WHISPER_MODEL) ? env.CUPRIC_WHISPER_MODEL : null
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

module.exports = { findWhisper, whisperArgs, cleanTranscript, windowsSpeechArgs, WINDOWS_SPEECH_SCRIPT, WINDOWS_SPEECH_PROBE, MODEL_PREFERENCE, exeNames }
