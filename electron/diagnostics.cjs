/**
 * One-click diagnostic report (2.27).
 *
 * Replaces "paste the raw ffmpeg log into chat": version, OS, media engine,
 * encoder, active AI provider and the recent warnings/errors, as one block of
 * text. Secrets never leave: API keys, bearer tokens, key-like query params
 * and the user's home directory are redacted before anything is returned.
 * No Electron imports, so scripts/check-diagnostics.mjs tests the redaction.
 */
const os = require('node:os')

const REDACTIONS = [
  // Google API keys (AIza…), OpenAI/OpenRouter style keys (sk-…, sk-or-…).
  [/AIza[0-9A-Za-z_-]{20,}/g, '[redacted-google-key]'],
  [/\bsk-(?:or-|proj-|ant-)?[0-9A-Za-z_-]{16,}/g, '[redacted-key]'],
  [/\b(?:gh[pousr]|github_pat)_[0-9A-Za-z_]{20,}/g, '[redacted-token]'],
  [/(Bearer\s+)[0-9A-Za-z._~+/=-]{8,}/gi, '$1[redacted]'],
  [/([?&](?:key|api_key|apikey|token|access_token|secret)=)[^&\s"']+/gi, '$1[redacted]'],
  [/("?(?:api[_-]?key|apiKey|geminiApiKey|openCodeApiKey|authorization|password|secret|token)"?\s*[:=]\s*)"[^"]*"/gi, '$1"[redacted]"'],
]

function redact(text, homeDir = os.homedir()) {
  let out = String(text ?? '')
  for (const [re, rep] of REDACTIONS) out = out.replace(re, rep)
  if (homeDir && homeDir.length > 2) out = out.split(homeDir).join('~')
  return out
}

/** Keep the last `max` log lines that are warnings/errors (JSON lines from logLine). */
function recentProblemLines(rawLines, max = 60) {
  const lines = rawLines.filter(Boolean)
  const picked = lines.filter((line) => /error|fail|warn|crash|unresponsive|gone|reject|exception|unclean|recovered/i.test(line))
  return picked.slice(-max)
}

function hostOnly(url) {
  try {
    const u = new URL(String(url))
    return `${u.protocol}//${u.host}`
  } catch {
    return '(unset)'
  }
}

/**
 * Assemble the report. Every input is plain data gathered by main.cjs; this
 * function only formats and redacts.
 */
function buildReport(info) {
  const lines = []
  const push = (k, v) => lines.push(`${k}: ${v}`)
  lines.push('=== Cupric AI diagnostic report ===')
  push('Generated', info.now || new Date().toISOString())
  push('App version', info.appVersion || 'unknown')
  push('Packaged', info.packaged ? 'yes' : 'no (dev)')
  push('OS', `${info.platform || process.platform} ${info.osRelease || os.release()} (${info.arch || process.arch})`)
  push('Electron / Chrome / Node', `${info.versions?.electron || '?'} / ${info.versions?.chrome || '?'} / ${info.versions?.node || process.versions.node}`)
  push('Memory', `${Math.round((info.totalMemBytes || os.totalmem()) / 1024 ** 3)} GB total, ${Math.round((info.freeMemBytes || os.freemem()) / 1024 ** 3)} GB free`)
  push('CPU', `${info.cpuModel || (os.cpus()[0] && os.cpus()[0].model) || '?'} × ${info.cpuCount || os.cpus().length}`)
  lines.push('')
  lines.push('--- Media engine ---')
  push('FFmpeg', info.media?.ffmpeg ? 'found' : 'MISSING')
  push('FFprobe', info.media?.ffprobe ? 'found' : 'MISSING')
  push('Video encoder', info.encoder ? `${info.encoder.name} (${info.encoder.hardware ? 'hardware' : 'software'})` : 'not probed yet')
  if (info.encoder?.tried?.length) push('Encoders tried', info.encoder.tried.join(', '))
  lines.push('')
  lines.push('--- AI provider (no keys) ---')
  push('Active provider', info.ai?.provider || 'none')
  push('Gemini key set', info.ai?.hasGeminiKey ? 'yes' : 'no')
  push('Gemini model', info.ai?.geminiModel || '(default)')
  push('OpenCode endpoint', hostOnly(info.ai?.openCodeBaseUrl))
  push('OpenCode model', info.ai?.openCodeModel || '(unset)')
  push('OpenCode access', info.ai?.hasOpenCodeKey ? 'yes' : 'no')
  lines.push('')
  lines.push('--- Session ---')
  push('Previous session closed cleanly', info.recovery?.previousSessionCrashed ? 'NO (unclean exit detected)' : 'yes')
  push('Recovered from autosave', info.recovery?.recoveredFrom || 'no')
  push('Saved versions', String(info.versionCount ?? 0))
  lines.push('')
  lines.push('--- Recent warnings & errors (main process) ---')
  const mainLines = recentProblemLines(info.logLines || [])
  lines.push(mainLines.length ? mainLines.join('\n') : '(none)')
  if (info.rendererErrors?.length) {
    lines.push('')
    lines.push('--- Recent warnings & errors (app window) ---')
    lines.push(info.rendererErrors.slice(-40).join('\n'))
  }
  lines.push('')
  lines.push('(API keys, tokens and your home folder path are removed from this report.)')
  return redact(lines.join('\n'), info.homeDir)
}

module.exports = { buildReport, redact, recentProblemLines }
