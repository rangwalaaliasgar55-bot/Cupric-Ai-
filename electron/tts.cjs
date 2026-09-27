/**
 * Offline text-to-speech voiceover (desktop). Uses the voice engine that ships
 * with the OS — no network, no API key:
 *   Windows → System.Speech (SAPI) via PowerShell
 *   macOS   → `say`
 *   Linux   → `espeak-ng` / `espeak` when installed
 * The text travels in an environment variable, never on the command line, so
 * nothing the user types can be interpreted as a command.
 */
const { spawn } = require('child_process')
const fs = require('fs')
const os = require('os')
const path = require('path')

const MAX_CHARS = 5000

function ttsCommand(platform, outPath, { rate = 0, voice = '' } = {}) {
  const r = Math.max(-10, Math.min(10, Math.round(Number(rate) || 0)))
  if (platform === 'win32') {
    const script = [
      'Add-Type -AssemblyName System.Speech',
      '$s = New-Object System.Speech.Synthesis.SpeechSynthesizer',
      'if ($env:CUPRIC_TTS_VOICE) { try { $s.SelectVoice($env:CUPRIC_TTS_VOICE) } catch {} }',
      `$s.Rate = ${r}`,
      '$s.SetOutputToWaveFile($env:CUPRIC_TTS_OUT)',
      '$s.Speak($env:CUPRIC_TTS_TEXT)',
      '$s.Dispose()',
    ].join('; ')
    return { cmd: 'powershell.exe', args: ['-NoProfile', '-NonInteractive', '-Command', script], ext: 'wav', stdinText: false }
  }
  if (platform === 'darwin') {
    const wpm = String(Math.round(175 * (1 + r / 20)))
    const args = ['-o', outPath, '--file-format=WAVE', '--data-format=LEI16@22050', '-r', wpm, '-f', '-']
    if (voice && /^[A-Za-z][\w ()-]{0,40}$/.test(String(voice))) args.unshift('-v', String(voice))
    return { cmd: 'say', args, ext: 'wav', stdinText: true }
  }
  const speed = String(Math.round(170 * (1 + r / 20)))
  return { cmd: 'espeak-ng', fallback: 'espeak', args: ['-w', outPath, '-s', speed, '--stdin'], ext: 'wav', stdinText: true }
}

function run(cmd, args, env, stdinText) {
  return new Promise((resolve) => {
    let err = ''
    let child
    try { child = spawn(cmd, args, { env, windowsHide: true }) } catch (e) { resolve({ ok: false, error: String(e.message || e), missing: true }); return }
    child.on('error', (e) => resolve({ ok: false, error: String(e.message || e), missing: e.code === 'ENOENT' }))
    child.stderr.on('data', (d) => { err += d })
    child.on('close', (code) => resolve(code === 0 ? { ok: true } : { ok: false, error: err.trim() || `exit ${code}` }))
    if (stdinText != null) { child.stdin.end(stdinText) } else child.stdin.end()
  })
}

async function synthesize(payload, platform = process.platform) {
  const text = String(payload?.text ?? '').trim()
  if (!text) return { ok: false, error: 'Write the voiceover script first.' }
  if (text.length > MAX_CHARS) return { ok: false, error: `Keep a voiceover under ${MAX_CHARS} characters — split longer scripts into parts.` }
  const out = path.join(os.tmpdir(), `cupric-tts-${process.pid}-${Date.now()}.wav`)
  const c = ttsCommand(platform, out, payload)
  const env = { ...process.env, CUPRIC_TTS_TEXT: text, CUPRIC_TTS_OUT: out, CUPRIC_TTS_VOICE: String(payload?.voice ?? '') }
  let res = await run(c.cmd, c.args, env, c.stdinText ? text : null)
  if (!res.ok && res.missing && c.fallback) res = await run(c.fallback, c.args, env, text)
  if (!res.ok) {
    const hint = platform === 'linux' ? ' Install espeak-ng for offline voiceover on Linux.' : ''
    return { ok: false, error: `The system voice could not speak: ${res.error}.${hint}` }
  }
  try {
    const buf = fs.readFileSync(out)
    fs.rmSync(out, { force: true })
    if (buf.length < 64) return { ok: false, error: 'The system voice produced no audio.' }
    return { ok: true, mime: 'audio/wav', base64: buf.toString('base64'), engine: platform === 'win32' ? 'Windows Speech' : platform === 'darwin' ? 'macOS say' : 'eSpeak NG' }
  } catch (e) {
    return { ok: false, error: `Voiceover file missing: ${e.message || e}` }
  }
}

module.exports = { synthesize, ttsCommand, MAX_CHARS }
