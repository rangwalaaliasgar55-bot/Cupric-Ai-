/**
 * Offline text-to-speech voiceover (desktop), English and Hindi. It needs no
 * network, API key, Ollama or local server. Engines are tried in this order:
 *
 *   1. Piper (offline neural TTS, MIT CLI) when a binary and a matching voice
 *      model (`en_*.onnx` / `hi_*.onnx`) are found. Lookup order:
 *      CUPRIC_PIPER_PATH / CUPRIC_PIPER_DIR, the bundled `piper/` resources
 *      folder, `<userData>/piper/`, then `vendor/piper/`. Models are NOT
 *      bundled: they're 60 MB+ each and every voice has its own licence, so
 *      the user adds the ones they want.
 *   2. The OS voice:
 *      - Windows: System.Speech (SAPI), choosing an installed voice by culture
 *        (hi-IN / en-*).
 *      - macOS: `say` (Lekha for Hindi, once downloaded in System Settings).
 *      - Linux: `espeak-ng -v hi` / `-v en-us`.
 *
 * The text goes through an environment variable or stdin, never the command
 * line, so nothing the user types can be run as a command. Every failure says
 * what's missing and how to fix it, and nothing falls back silently to the
 * wrong language.
 */
const { spawn } = require('child_process')
const fs = require('fs')
const os = require('os')
const path = require('path')

const MAX_CHARS = 5000
const LANGS = ['en', 'hi']

/** 'en' | 'hi' from an explicit choice, or detected from the script (Devanagari → hi). */
function resolveLanguage(language, text) {
  if (LANGS.includes(language)) return language
  const deva = (String(text).match(/[\u0900-\u097F]/g) || []).length
  const latin = (String(text).match(/[A-Za-z]/g) || []).length
  return deva > 0 && deva >= latin * 0.3 ? 'hi' : 'en'
}

/* ——— Piper discovery (pure; exists/list injected for tests) ——— */
function piperSetup({ platform = process.platform, env = process.env, dirs = [], exists = fs.existsSync, isFile = safeIsFile, list = safeList } = {}) {
  const exe = platform === 'win32' ? 'piper.exe' : 'piper'
  const roots = [env.CUPRIC_PIPER_DIR, ...dirs].filter(Boolean)
  const bin = [env.CUPRIC_PIPER_PATH, ...roots.flatMap((d) => [path.join(d, 'piper', exe), path.join(d, exe)])].find((p) => p && exists(p) && isFile(p)) || null
  if (!bin) return null
  const models = {}
  for (const d of [...roots, path.dirname(bin)]) {
    for (const name of list(d).sort()) {
      const m = /^(en|hi)_[A-Za-z]{2}-[\w-]+\.onnx$/.exec(name)
      if (m && !models[m[1]] && exists(path.join(d, `${name}.json`))) models[m[1]] = path.join(d, name)
    }
  }
  return { bin, models }
}
function safeIsFile(p) { try { return fs.statSync(p).isFile() } catch { return false } }
function safeList(dir) { try { return fs.readdirSync(dir) } catch { return [] } }

function piperCommand(setup, lang, outPath, { rate = 0 } = {}) {
  const model = setup?.models?.[lang]
  if (!model) return null
  const r = Math.max(-10, Math.min(10, Math.round(Number(rate) || 0)))
  const lengthScale = (1 - r / 25).toFixed(2) // faster rate → shorter phonemes
  return { cmd: setup.bin, args: ['--model', model, '--output_file', outPath, '--length_scale', lengthScale], ext: 'wav', stdinText: true, engine: `Piper (${path.basename(model, '.onnx')})` }
}

const MAC_VOICE = { en: 'Samantha', hi: 'Lekha' }
const ESPEAK_VOICE = { en: 'en-us', hi: 'hi' }

function ttsCommand(platform, outPath, { rate = 0, voice = '', language = 'en' } = {}) {
  const r = Math.max(-10, Math.min(10, Math.round(Number(rate) || 0)))
  const lang = LANGS.includes(language) ? language : 'en'
  if (platform === 'win32') {
    // Pick the named voice, else the first installed voice for the culture.
    // If there's no Hindi voice, exit 3 rather than read Hindi in English.
    const script = [
      'Add-Type -AssemblyName System.Speech',
      '$s = New-Object System.Speech.Synthesis.SpeechSynthesizer',
      '$picked = $false',
      'if ($env:CUPRIC_TTS_VOICE) { try { $s.SelectVoice($env:CUPRIC_TTS_VOICE); $picked = $true } catch {} }',
      'if (-not $picked) { $v = $s.GetInstalledVoices() | Where-Object { $_.Enabled -and $_.VoiceInfo.Culture.Name -like ($env:CUPRIC_TTS_LANG + "*") } | Select-Object -First 1; if ($v) { $s.SelectVoice($v.VoiceInfo.Name); $picked = $true } }',
      'if (-not $picked -and $env:CUPRIC_TTS_LANG -ne "en") { [Console]::Error.WriteLine("no-voice-for-language"); exit 3 }',
      `$s.Rate = ${r}`,
      '$s.SetOutputToWaveFile($env:CUPRIC_TTS_OUT)',
      '$s.Speak($env:CUPRIC_TTS_TEXT)',
      '$s.Dispose()',
    ].join('; ')
    return { cmd: 'powershell.exe', args: ['-NoProfile', '-NonInteractive', '-Command', script], ext: 'wav', stdinText: false, engine: 'Windows Speech' }
  }
  if (platform === 'darwin') {
    const wpm = String(Math.round(175 * (1 + r / 20)))
    const args = ['-o', outPath, '--file-format=WAVE', '--data-format=LEI16@22050', '-r', wpm, '-f', '-']
    const v = voice && /^[A-Za-z][\w ()-]{0,40}$/.test(String(voice)) ? String(voice) : lang === 'hi' ? MAC_VOICE.hi : ''
    if (v) args.unshift('-v', v)
    return { cmd: 'say', args, ext: 'wav', stdinText: true, engine: 'macOS say' }
  }
  const speed = String(Math.round(170 * (1 + r / 20)))
  return { cmd: 'espeak-ng', fallback: 'espeak', args: ['-v', ESPEAK_VOICE[lang], '-w', outPath, '-s', speed, '--stdin'], ext: 'wav', stdinText: true, engine: 'eSpeak NG' }
}

/** Plain-language fix for a missing language/engine, per platform. */
function blockerFor(platform, lang, detail = '') {
  if (lang === 'hi') {
    if (platform === 'win32') return 'No Hindi voice is installed for Windows Speech. Add a Hindi voice (Settings → Time & language → Speech → Add voices → Hindi), or put Piper plus a hi_IN voice model in the Cupric "piper" folder. Some Windows Hindi voices are OneCore-only and hidden from System.Speech, and Piper avoids that.'
    if (platform === 'darwin') return 'The Hindi voice "Lekha" is not downloaded. Get it in System Settings → Accessibility → Spoken Content → System voice → Manage Voices → Hindi, or add Piper plus a hi_IN model.'
    return 'eSpeak NG could not speak Hindi. Install espeak-ng (it includes Hindi), or add Piper plus a hi_IN model.'
  }
  return platform === 'linux' ? `Install espeak-ng for offline voiceover on Linux, or add Piper plus an en_US model.${detail ? ` (${detail})` : ''}` : `The system voice could not speak${detail ? `: ${detail}` : ''}.`
}

function run(cmd, args, env, stdinText) {
  return new Promise((resolve) => {
    let err = ''
    let child
    try { child = spawn(cmd, args, { env, windowsHide: true }) } catch (e) { resolve({ ok: false, error: String(e.message || e), missing: true }); return }
    child.on('error', (e) => resolve({ ok: false, error: String(e.message || e), missing: e.code === 'ENOENT' }))
    child.stderr.on('data', (d) => { err += d })
    child.on('close', (code) => resolve(code === 0 ? { ok: true } : { ok: false, error: err.trim() || `exit ${code}`, code }))
    if (stdinText != null) { child.stdin.end(stdinText) } else child.stdin.end()
  })
}

function readWav(out) {
  try {
    const buf = fs.readFileSync(out)
    fs.rmSync(out, { force: true })
    return buf.length >= 64 && buf.toString('ascii', 0, 4) === 'RIFF' ? buf : null
  } catch { return null }
}

/**
 * payload: { text, rate?, voice?, language?: 'en' | 'hi' | 'auto' }
 * opts.piperDirs: where to look for Piper (main passes the app's folders).
 */
async function synthesize(payload, platform = process.platform, opts = {}) {
  const text = String(payload?.text ?? '').trim()
  if (!text) return { ok: false, error: 'Write the voiceover script first.' }
  if (text.length > MAX_CHARS) return { ok: false, error: `Keep a voiceover under ${MAX_CHARS} characters. Split longer scripts into parts.` }
  const lang = resolveLanguage(payload?.language, text)
  const out = path.join(os.tmpdir(), `cupric-tts-${process.pid}-${Date.now()}.wav`)
  const env = { ...process.env, CUPRIC_TTS_TEXT: text, CUPRIC_TTS_OUT: out, CUPRIC_TTS_VOICE: String(payload?.voice ?? ''), CUPRIC_TTS_LANG: lang }
  const tried = []

  const piper = piperCommand(opts.piper !== undefined ? opts.piper : piperSetup({ platform, dirs: opts.piperDirs || [] }), lang, out, payload)
  if (piper) {
    const res = await run(piper.cmd, piper.args, env, text)
    const buf = res.ok ? readWav(out) : null
    if (buf) return { ok: true, mime: 'audio/wav', base64: buf.toString('base64'), engine: piper.engine, language: lang }
    tried.push(`Piper: ${res.error || 'no audio'}`)
  }

  const c = ttsCommand(platform, out, { ...payload, language: lang })
  let res = await run(c.cmd, c.args, env, c.stdinText ? text : null)
  if (!res.ok && res.missing && c.fallback) res = await run(c.fallback, c.args, env, text)
  if (!res.ok) {
    const langMissing = res.code === 3 || /no-voice-for-language|voice.*not found|Invalid voice/i.test(res.error || '')
    return { ok: false, error: langMissing || lang === 'hi' ? blockerFor(platform, lang) : blockerFor(platform, lang, res.error), language: lang, tried: [...tried, `${c.engine}: ${res.error}`] }
  }
  const buf = readWav(out)
  if (!buf) return { ok: false, error: 'The system voice produced no audio.', language: lang }
  return { ok: true, mime: 'audio/wav', base64: buf.toString('base64'), engine: c.engine, language: lang }
}

module.exports = { synthesize, ttsCommand, piperSetup, piperCommand, resolveLanguage, blockerFor, MAX_CHARS, LANGS }
