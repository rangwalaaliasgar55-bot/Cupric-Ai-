const { app, BrowserWindow, Menu, shell, ipcMain, dialog, clipboard } = require('electron')
const fs = require('fs')
const fsp = fs.promises
const path = require('path')
const os = require('os')
const { pathToFileURL } = require('url')
const { spawn } = require('child_process')
const { GoogleGenerativeAI } = require('@google/generative-ai')
const AdmZip = require('adm-zip')
const { approveManualArenaGate, isManualArenaGateBlocked } = require('./automation-gate.cjs')
const resourceContext = require('./resource-context.cjs')
const projectHistory = require('./project-history.cjs')
const diagnostics = require('./diagnostics.cjs')
const encoders = require('./encoders.cjs')
const proxies = require('./proxies.cjs')
const tts = require('./tts.cjs')
const { migrateSettings } = require('./settings-migration.cjs')
const voiceEngines = require('./voice-engines.cjs')
const { ADVANCED_VIDEO_PLAYBOOK_PROMPT } = require('./opus-playbook.cjs')
const { createStockService } = require('./stock.cjs')
const pathSandbox = require('./path-sandbox.cjs')

let elog = null
try {
  elog = require('electron-log/main')
} catch {}

let autoUpdater
try {
  ;({ autoUpdater } = require('electron-updater'))
} catch {}

function asarUnpackedSibling(value) {
  const direct = String(value || '')
  if (!direct) return null
  // Electron's fs APIs can see files inside app.asar, but child_process cannot
  // spawn executables from an archive. Always prefer the asar.unpacked copy.
  return direct.replace(/([\\/])app\.asar([\\/])/i, '$1app.asar.unpacked$2')
}

function candidateBinaryPath(value) {
  if (!value) return null
  const direct = String(value)
  const unpacked = asarUnpackedSibling(direct)
  if (unpacked && unpacked !== direct && fs.existsSync(unpacked)) return unpacked
  if (!/[\\/]app\.asar[\\/]/i.test(direct) && fs.existsSync(direct)) return direct
  return null
}

function findOnPath(binName) {
  const suffixes = process.platform === 'win32' ? ['.exe', '.cmd', '.bat', ''] : ['']
  for (const dir of String(process.env.PATH || '').split(path.delimiter)) {
    for (const suffix of suffixes) {
      const candidate = path.join(dir, `${binName}${suffix}`)
      if (fs.existsSync(candidate)) return candidate
    }
  }
  return null
}

function resolveMediaTool(kind) {
  const envName = kind === 'ffmpeg' ? 'FFMPEG_PATH' : 'FFPROBE_PATH'
  const envCandidate = candidateBinaryPath(process.env[`CUPRIC_${envName}`] || process.env[`NORTHFRAME_${envName}`] || process.env[envName])
  if (envCandidate) return envCandidate
  try {
    const moduleCandidate = kind === 'ffmpeg' ? require('ffmpeg-static') : require('ffprobe-static').path
    const resolved = candidateBinaryPath(moduleCandidate)
    if (resolved) return resolved
  } catch {}
  return findOnPath(kind)
}

let ffmpegPath = resolveMediaTool('ffmpeg')
let ffprobePath = resolveMediaTool('ffprobe')

const DEV_URL = process.env.ELECTRON_START_URL
const APP_ID = 'app.cupric-ai.studio'
const MAX_RENDER_DURATION_SEC = 180
const DEFAULT_SILENCE_NOISE_DB = -35
const DEFAULT_SILENCE_MIN_DURATION = 0.8
const DEFAULT_GEMINI_MODEL = 'gemini-2.5-flash'
const GEMINI_FALLBACK_MODELS = ['gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-flash-latest', 'gemini-flash-lite-latest', 'gemini-2.0-flash']
const ZEN_FREE_MODELS = ['big-pickle', 'space-bunny-free', 'mimo-v2.6-flash-free']
const ZEN_BASE_URL = 'https://opencode.ai/zen/v1'
const AI_DISCOVERY_TIMEOUT_MS = 1500
const AI_DISCOVERY_CACHE_MS = 30_000
const freeBrain = require('./free-brain.cjs')
const AI_MODES = new Set(['auto', 'gemini', 'zen', 'openrouter', 'ollama', 'lmstudio', 'template'])
// Discovery uses freeBrain.LOCAL_PROBE_ORDER (4096 → 11434 → 1234 → 8080).

const renderJobs = new Map()
const renderQueue = []
let renderQueueRunning = false
const automationRunStates = new Map()
let mainWindow = null
let updateDownloaded = false
let installingUpdate = false
let aiDiscoveryPromise = null
let aiDiscoveryCache = { at: 0, result: null }
let aiStatusCache = { at: 0, dots: { gemini: 'unknown', zen: 'unknown', local: 'unknown' } }
let stockServiceInstance = null
const rundownCache = new Map()
const rundownQueue = []
let rundownQueueRunning = false

// ---------------------------------------------------------------------------
// App hardening: single instance, logs, crash capture
// ---------------------------------------------------------------------------

// Isolated profile for automated boot checks / portable testing
// (scripts/check-boot.mjs). Must run before anything reads userData — the
// single-instance lock below is keyed on it, so a test never collides with a
// running copy of the app.
if (process.env.CUPRIC_USER_DATA_DIR) {
  try {
    fs.mkdirSync(process.env.CUPRIC_USER_DATA_DIR, { recursive: true })
    app.setPath('userData', process.env.CUPRIC_USER_DATA_DIR)
  } catch {}
}

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    const win = BrowserWindow.getAllWindows()[0]
    if (win) {
      if (win.isMinimized()) win.restore()
      win.focus()
    }
  })
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true })
}

function userDataPath(...parts) {
  return path.join(app.getPath('userData'), ...parts)
}

function stockService() {
  if (!stockServiceInstance) stockServiceInstance = createStockService({ cacheDir: userDataPath('stock-cache') })
  return stockServiceInstance
}

// The owner proxy is configured by deployment, never hard-coded or bundled.
// A personal URL in Settings takes precedence; the environment fallback keeps
// the paid path useful without putting a shared secret in the app.
function stockSettings() {
  const settings = readSettings()
  if (!String(settings.stockProxyUrl || '').trim() && String(process.env.CUPRIC_STOCK_PROXY_URL || '').trim()) {
    settings.stockProxyUrl = String(process.env.CUPRIC_STOCK_PROXY_URL).trim()
  }
  return settings
}

async function stockProxyHealth(url) {
  const proxy = String(url || '').trim().replace(/\/+$/, '')
  if (!/^https?:\/\//i.test(proxy)) return { configured: false, healthy: false, error: 'No proxy URL configured' }
  try {
    const response = await fetch(`${proxy}/health`, { method: 'GET', signal: AbortSignal.timeout(2500) })
    return { configured: true, healthy: response.ok, status: response.status, url: proxy, error: response.ok ? null : `HTTP ${response.status}` }
  } catch (error) {
    return { configured: true, healthy: false, url: proxy, error: error?.message || 'Proxy health check failed' }
  }
}

function logFile() {
  const dir = userDataPath('logs')
  ensureDir(dir)
  return path.join(dir, `${new Date().toISOString().slice(0, 10)}.log`)
}

/**
 * File logging (0.10.1): electron-log writes main + renderer lines to
 * userData/logs/cupric.log (rotated at 5 MB). The dated JSON-lines files that
 * logLine has always written stay, because the diagnostic report reads them.
 */
const VERBOSE_LOGGING = process.argv.includes('--enable-logging') || process.env.CUPRIC_VERBOSE_LOG === '1'
if (elog) {
  try {
    elog.transports.file.resolvePathFn = () => path.join(app.getPath('userData'), 'logs', 'cupric.log')
    elog.transports.file.maxSize = 5 * 1024 * 1024
    elog.transports.file.level = VERBOSE_LOGGING ? 'debug' : 'info'
    elog.transports.console.level = VERBOSE_LOGGING ? 'debug' : 'warn'
  } catch {}
}

function logLine(kind, message, extra) {
  try {
    const line = JSON.stringify({ at: new Date().toISOString(), kind, message, extra }) + os.EOL
    fs.appendFileSync(logFile(), line, 'utf8')
  } catch {}
  try {
    elog?.info(`[${kind}]`, message, extra === undefined ? '' : extra)
  } catch {}
}

const RENDERER_LOG_LEVELS = new Set(['error', 'warn', 'info', 'debug'])
/** Renderer lines (src/lib/log.ts). Validated: it is untrusted input. */
function writeRendererLog(payload) {
  const level = RENDERER_LOG_LEVELS.has(payload?.level) ? payload.level : 'info'
  const scope = String(payload?.scope || 'app').replace(/[^\w:.-]/g, '').slice(0, 40) || 'app'
  const message = String(payload?.message ?? '').slice(0, 2000)
  let data = payload?.data
  try {
    const text = JSON.stringify(data)
    if (text && text.length > 4000) data = `${text.slice(0, 4000)}…`
  } catch {
    data = String(data)
  }
  try {
    const logger = elog ? elog.scope(`renderer:${scope}`) : null
    if (logger) logger[level](message, data === undefined ? '' : data)
    else logLine(`renderer:${scope}:${level}`, message, data)
  } catch {}
  return true
}

process.on('uncaughtException', (err) => {
  logLine('uncaughtException', err?.message || String(err), err?.stack)
})
process.on('unhandledRejection', (reason) => {
  logLine('unhandledRejection', reason?.message || String(reason), reason?.stack || reason)
})

function appEntryUrl() {
  if (DEV_URL) return DEV_URL
  return pathToFileURL(path.join(__dirname, '..', 'dist', 'index.html')).toString()
}

function showRendererCrashedScreen(win, details) {
  logLine('renderer-gone', details?.reason || 'renderer gone', details)
  const restartUrl = appEntryUrl()
  const html = `<!doctype html><html><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><title>Cupric AI recovered</title><style>body{margin:0;height:100vh;display:grid;place-items:center;background:#0B0B10;color:#F4F1EA;font-family:Inter,Segoe UI,Arial,sans-serif}.card{max-width:520px;border:1px solid rgba(255,255,255,.12);border-radius:18px;background:#15151B;padding:28px;box-shadow:0 24px 80px rgba(0,0,0,.35)}h1{font-size:20px;margin:0 0 8px}p{color:#9CA3AF;line-height:1.55}.btn{border:0;border-radius:12px;background:#C8F542;color:#10130A;font-weight:800;padding:10px 14px;cursor:pointer}.muted{font-size:12px;color:#6B7280}</style></head><body><main class="card"><h1>Renderer recovered</h1><p>Cupric AI's interface crashed, but your desktop process stayed alive and wrote a crash log. Reload the workspace to continue.</p><button class="btn" onclick="location.href=${JSON.stringify(restartUrl)}">Reload Cupric AI</button><p class="muted">Logs live in ${escapeHtml(userDataPath('logs'))}</p></main></body></html>`
  if (!win.isDestroyed()) win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`).catch(() => {})
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

// ---------------------------------------------------------------------------
// Settings and state persistence
// ---------------------------------------------------------------------------

function settingsFile() {
  return userDataPath('settings.json')
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return fallback
  }
}

function writeJson(file, value) {
  ensureDir(path.dirname(file))
  fs.writeFileSync(file, JSON.stringify(value, null, 2), 'utf8')
}

function readSettings() {
  return readJson(settingsFile(), {})
}

function writeSettings(next) {
  writeJson(settingsFile(), next)
}

function geminiApiKey() {
  return String(readSettings().geminiApiKey || process.env.GEMINI_API_KEY || '').trim()
}

function geminiModel() {
  return String(readSettings().geminiModel || process.env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL).trim() || DEFAULT_GEMINI_MODEL
}

function stripJsonComments(text) {
  let out = ''
  let inString = false
  let quote = ''
  let escaped = false
  for (let i = 0; i < String(text || '').length; i += 1) {
    const ch = text[i]
    const next = text[i + 1]
    if (inString) {
      out += ch
      if (escaped) escaped = false
      else if (ch === '\\') escaped = true
      else if (ch === quote) inString = false
      continue
    }
    if (ch === '"' || ch === "'") {
      inString = true
      quote = ch
      out += ch
      continue
    }
    if (ch === '/' && next === '/') {
      while (i < text.length && text[i] !== '\n') i += 1
      out += '\n'
      continue
    }
    if (ch === '/' && next === '*') {
      i += 2
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i += 1
      i += 1
      continue
    }
    out += ch
  }
  return out
}

function readJsonLoose(file) {
  try {
    if (!file || !fs.existsSync(file)) return null
    const text = fs.readFileSync(file, 'utf8')
    try { return JSON.parse(text) } catch { return JSON.parse(stripJsonComments(text)) }
  } catch {
    return null
  }
}

function uniqueExistingFiles(files) {
  const seen = new Set()
  return files
    .filter(Boolean)
    .map((file) => path.resolve(String(file)))
    .filter((file) => {
      const key = file.toLowerCase()
      if (seen.has(key)) return false
      seen.add(key)
      return fs.existsSync(file)
    })
}

function opencodeConfigFiles() {
  const home = os.homedir()
  const files = []
  const addDir = (dir) => {
    if (!dir) return
    files.push(
      path.join(dir, 'opencode.json'),
      path.join(dir, 'opencode.jsonc'),
      path.join(dir, 'config.json'),
      path.join(dir, 'config.jsonc'),
      path.join(dir, 'auth.json'),
    )
  }
  // OpenCode Desktop stores profiles beneath ai.opencode.desktop rather than
  // the CLI directory. Keep the scan shallow and bounded: this runs on every
  // settings read, so it must never walk an entire home directory.
  const addDesktopProfiles = (root) => {
    if (!root) return
    addDir(root)
    try {
      for (const name of fs.readdirSync(root).slice(0, 40)) {
        const child = path.join(root, name)
        try { if (fs.statSync(child).isDirectory()) addDir(child) } catch {}
      }
    } catch {}
  }
  files.push(process.env.OPENCODE_CONFIG, process.env.OPENCODE_AUTH_FILE)
  if (home) {
    addDir(path.join(home, '.config', 'opencode'))
    addDir(path.join(home, '.local', 'share', 'opencode'))
    files.push(path.join(home, '.opencode.json'), path.join(home, '.opencode.jsonc'))
  }
  addDir(path.join(process.env.APPDATA || '', 'opencode'))
  addDir(path.join(process.env.LOCALAPPDATA || '', 'opencode'))
  addDesktopProfiles(path.join(process.env.APPDATA || '', 'ai.opencode.desktop'))
  addDesktopProfiles(path.join(process.env.LOCALAPPDATA || '', 'ai.opencode.desktop'))
  addDir(path.join(process.env.XDG_CONFIG_HOME || '', 'opencode'))
  addDir(path.join(process.env.XDG_DATA_HOME || '', 'opencode'))
  // Project-local OpenCode config is useful when Cupric AI is launched from a workspace.
  files.push(path.join(process.cwd(), 'opencode.json'), path.join(process.cwd(), 'opencode.jsonc'))
  return uniqueExistingFiles(files)
}

function normalizedBaseUrl(value) {
  return String(value || '').trim().replace(/\/+$/, '')
}

function secretFromConfig(value) {
  const raw = String(value || '').trim()
  if (!raw) return ''
  const envMatch = raw.match(/^\{env:([^}]+)\}$/) || raw.match(/^env:([A-Z0-9_]+)$/i) || raw.match(/^\$([A-Z0-9_]+)$/i)
  if (envMatch) return String(process.env[envMatch[1]] || '').trim()
  return raw
}

function providerSettings(provider) {
  return { ...(provider?.options || {}), ...(provider?.settings || {}), ...(provider || {}) }
}

function providerBaseUrl(provider) {
  const settings = providerSettings(provider)
  return normalizedBaseUrl(settings.baseURL || settings.baseUrl || settings.base_url || settings.url)
}

function providerApiKey(provider) {
  const settings = providerSettings(provider)
  return secretFromConfig(settings.apiKey || settings.api_key || settings.key || settings.token || settings.authorization?.replace(/^Bearer\s+/i, ''))
}

function providerModels(provider) {
  const models = provider?.models || provider?.model || {}
  return models && typeof models === 'object' && !Array.isArray(models) ? models : {}
}

function readOpenCodeProviderEntries() {
  const entries = []
  for (const file of opencodeConfigFiles()) {
    const data = readJsonLoose(file)
    if (!data || typeof data !== 'object') continue
    const providers = data.providers || data.provider || {}
    if (providers && typeof providers === 'object') {
      for (const [providerId, provider] of Object.entries(providers)) {
        if (!provider || typeof provider !== 'object') continue
        entries.push({ file, providerId, provider, root: data })
      }
    }
    // Some auth exports are a flat map of provider IDs to credentials.
    const authProviders = data.auth || data.credentials || {}
    if (authProviders && typeof authProviders === 'object') {
      for (const [providerId, provider] of Object.entries(authProviders)) {
        if (!provider) continue
        entries.push({ file, providerId, provider: typeof provider === 'object' ? provider : { apiKey: provider }, root: data })
      }
    }
  }
  return entries
}

function discoverOpenCodeConfiguredModels() {
  const presets = []
  for (const entry of readOpenCodeProviderEntries()) {
    const { file, providerId, provider, root } = entry
    const baseUrl = providerBaseUrl(provider)
    if (!baseUrl) continue
    const providerName = String(provider?.name || providerId || 'OpenCode')
    const models = providerModels(provider)
    for (const [logicalId, modelInfoRaw] of Object.entries(models)) {
      const modelInfo = modelInfoRaw && typeof modelInfoRaw === 'object' ? modelInfoRaw : {}
      const model = String(modelInfo.modelID || modelInfo.modelId || modelInfo.id || logicalId || '').trim()
      if (!model) continue
      const label = `${providerName} · ${String(modelInfo.name || logicalId || model).trim()}`
      presets.push({
        id: `opencode-${providerId}-${model}`.replace(/[^a-z0-9_.:-]+/gi, '-'),
        label,
        baseUrl,
        model,
        note: `Imported from OpenCode Desktop/config (${path.basename(file)}). API keys stay in OpenCode/env or Cupric settings.`,
        source: 'opencode-desktop',
      })
    }
    const selected = String(root?.model || '').trim()
    if (selected && selected.startsWith(`${providerId}/`)) {
      const model = selected.slice(String(providerId).length + 1)
      presets.push({
        id: `opencode-selected-${providerId}-${model}`.replace(/[^a-z0-9_.:-]+/gi, '-'),
        label: `${providerName} · ${model}`,
        baseUrl,
        model,
        note: `Selected OpenCode model from ${path.basename(file)}.`,
        source: 'opencode-desktop',
      })
    }
  }
  const seen = new Set()
  return presets.filter((preset) => {
    const key = `${normalizedBaseUrl(preset.baseUrl)}|${preset.model}`.toLowerCase()
    if (seen.has(key)) return false
    seen.add(key)
    return true
  }).slice(0, 300)
}

function resolveOpenCodeApiKey(baseUrl, model) {
  const targetBase = normalizedBaseUrl(baseUrl)
  const targetModel = String(model || '').trim()
  const entries = readOpenCodeProviderEntries()
  for (const { providerId, provider } of entries) {
    const baseMatches = targetBase && providerBaseUrl(provider) === targetBase
    const models = providerModels(provider)
    const modelMatches = !targetModel || Object.entries(models).some(([logicalId, infoRaw]) => {
      const info = infoRaw && typeof infoRaw === 'object' ? infoRaw : {}
      return targetModel === logicalId || targetModel === info.modelID || targetModel === info.modelId || targetModel === info.id
    })
    if (baseMatches && modelMatches) {
      const directKey = providerApiKey(provider)
      if (directKey) return directKey
      const sibling = entries.find(entry => entry.providerId === providerId && providerApiKey(entry.provider))
      const siblingKey = sibling ? providerApiKey(sibling.provider) : ''
      if (siblingKey) return siblingKey
    }
  }
  return ''
}

function openCodeAuthSecrets() {
  const secrets = []
  const visit = (value, hint = '') => {
    if (!value || typeof value !== 'object') return
    for (const [key, child] of Object.entries(value)) {
      const nextHint = `${hint} ${key}`.toLowerCase()
      if (typeof child === 'string' && /(?:api.?key|access.?token|token|secret|credential)/i.test(key) && /(zen|opencode)/i.test(nextHint) || typeof child === 'string' && /(zen|opencode)/i.test(nextHint) && child.trim().length > 10) {
        const secret = secretFromConfig(child)
        if (secret) secrets.push(secret)
      } else if (child && typeof child === 'object') visit(child, nextHint)
    }
  }
  for (const file of opencodeConfigFiles()) {
    if (!/auth\.json$/i.test(file)) continue
    visit(readJsonLoose(file), path.basename(path.dirname(file)))
  }
  return [...new Set(secrets)]
}

function configuredOpenCodeKey(baseUrl, model) {
  return String(
    process.env.OPENCODE_API_KEY ||
    process.env.ANTHROPIC_API_KEY ||
    process.env.OPENAI_API_KEY ||
    process.env.OPENROUTER_API_KEY ||
    resolveOpenCodeApiKey(baseUrl, model) ||
    openCodeAuthSecrets()[0] ||
    '',
  ).trim()
}

function configuredAiMode(settings = readSettings()) {
  const value = String(settings.aiMode || '').toLowerCase()
  // RULE ZERO: a remote mode that has no key (e.g. an old "openrouter" default
  // migrated from aiProvider) must never make the first AI action fail — it
  // behaves exactly like Auto until the user actually adds a key.
  if ((value === 'openrouter' || value === 'zen') && !String(settings.openCodeApiKey || process.env.OPENROUTER_API_KEY || process.env.OPENCODE_API_KEY || process.env.OPENAI_API_KEY || '').trim()) return 'auto'
  if (value === 'gemini' && !String(settings.geminiApiKey || process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '').trim()) return 'auto'
  if (AI_MODES.has(value)) return value
  if (settings.aiProvider === 'gemini') return 'gemini'
  if (settings.aiProvider === 'opencode') return 'openrouter'
  return 'auto'
}

function publicDiscovery(result) {
  if (!result) return result
  const pick = result.pick ? { ...result.pick } : result.pick
  if (pick) delete pick.apiKey
  return { ...result, pick, configured: Array.isArray(result.configured) ? result.configured.map((item) => { const safe = { ...item }; delete safe.apiKey; return safe }) : result.configured }
}

/**
 * Discover the first usable source without asking the user to paste a key.
 * This is intentionally the one discovery implementation used by settings,
 * first AI use, and fallback routing; model pick-up is never duplicated in a
 * renderer or in a provider-specific adapter.
 */
async function autoDiscover(options = {}) {
  const force = Boolean(options.force)
  if (!force && aiDiscoveryCache.result && Date.now() - aiDiscoveryCache.at < AI_DISCOVERY_CACHE_MS) return aiDiscoveryCache.result
  if (aiDiscoveryPromise) return aiDiscoveryPromise
  aiDiscoveryPromise = (async () => {
    const settings = readSettings()
    const configuredMode = configuredAiMode(settings)
    if (configuredMode !== 'auto' && !force) {
      const manual = {
        kind: configuredMode,
        provider: configuredMode === 'gemini' ? 'gemini' : configuredMode === 'template' ? 'template' : 'opencode',
        baseUrl: String(settings.openCodeBaseUrl || '').trim(),
        model: String(settings.openCodeModel || '').trim(),
        label: configuredMode === 'gemini' ? `Gemini · ${geminiModel()}` : configuredMode === 'template' ? 'Offline template' : `${configuredMode} · ${settings.openCodeModel || 'default model'}`,
        reason: 'Manual provider selected in Settings.',
        source: 'manual',
      }
      return { pick: manual, local: [], configured: [], setupRequired: configuredMode === 'template', checkedAt: new Date().toISOString() }
    }

    const configured = discoverOpenCodeConfiguredModels()
    const configuredKey = configuredOpenCodeKey('', '')
    const configuredPick = configured.find((preset) => {
      const key = resolveOpenCodeApiKey(preset.baseUrl, preset.model) || configuredKey
      return Boolean(key) || isLocalModelBase(preset.baseUrl)
    })
    if (configuredPick) {
      return { pick: { ...configuredPick, kind: 'opencode', provider: 'opencode', reason: 'OpenCode Desktop has a configured provider/model.', source: 'opencode-desktop' }, local: [], configured, setupRequired: false, checkedAt: new Date().toISOString() }
    }

    // OpenCode Desktop also forwards standard OpenAI-compatible environment
    // variables. Use those when no provider block was saved; never invent a
    // remote endpoint without the corresponding key.
    const openAiKey = String(process.env.OPENAI_API_KEY || '').trim()
    if (openAiKey) {
      const baseUrl = normalizedBaseUrl(process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1')
      const model = String(process.env.OPENAI_MODEL || 'gpt-4o-mini').trim()
      return { pick: { kind: 'opencode', provider: 'opencode', baseUrl, model, apiKey: openAiKey, label: `OpenAI · ${model}`, reason: 'OpenCode-compatible OPENAI_API_KEY is available.', source: 'environment' }, local: [], configured, setupRequired: false, checkedAt: new Date().toISOString() }
    }

    // Zen is deliberately not a zero-key provider. Only OPENCODE_API_KEY or a
    // Zen credential in OpenCode's auth.json may activate this route.
    const zenKey = String(process.env.OPENCODE_API_KEY || openCodeAuthSecrets()[0] || '').trim()
    if (zenKey) {
      let zenModels = []
      try { zenModels = await listOpenCodeModels({ baseUrl: ZEN_BASE_URL, apiKey: zenKey }) } catch {}
      const available = new Set(zenModels.map((model) => model.model))
      const candidates = ZEN_FREE_MODELS.filter((candidate) => !available.size || available.has(candidate))
      let model = candidates[0] || zenModels[0]?.model || ZEN_FREE_MODELS[0]
      for (const candidate of candidates) {
        if (await probeOpenCodeModel(ZEN_BASE_URL, zenKey, candidate)) { model = candidate; break }
      }
      const zen = { kind: 'zen', provider: 'opencode', baseUrl: ZEN_BASE_URL, model, apiKey: zenKey, label: `Zen Free · ${model}`, reason: 'OpenCode credentials include a Zen key.', source: 'opencode-auth' }
      return { pick: zen, local: [], configured, setupRequired: false, checkedAt: new Date().toISOString() }
    }

    // These probes are deliberately parallel and short. A stopped localhost
    // service must never make the first Generate click feel hung.
    // Order: OpenCode :4096 → Ollama :11434 → LM Studio :1234 → 127.0.0.1:8080.
    const local = await freeBrain.probeLocals({ timeoutMs: AI_DISCOVERY_TIMEOUT_MS }).catch(() => [])
    brainLocalsCache = { at: Date.now(), locals: local }
    const firstLocal = local[0]
    if (firstLocal) {
      const picked = { kind: firstLocal.kind, provider: 'opencode', baseUrl: firstLocal.baseUrl, model: firstLocal.models[0], label: `${firstLocal.label} · ${firstLocal.models[0]}`, reason: `${firstLocal.label} is running locally; no key is required.`, source: 'local', models: firstLocal.models }
      return { pick: picked, local, configured, setupRequired: false, checkedAt: new Date().toISOString() }
    }

    // Built-in keyless free cloud: no key, no signup. A short silent reachability
    // check only decides the label; routing still hops between both endpoints.
    for (const endpoint of freeBrain.KEYLESS_ENDPOINTS) {
      const reachable = await fetch(endpoint.modelsUrl, { signal: AbortSignal.timeout(AI_DISCOVERY_TIMEOUT_MS * 2) }).then((r) => r.ok).catch(() => false)
      if (reachable) {
        const picked = { kind: 'keyless', provider: 'keyless', baseUrl: endpoint.baseUrl, model: endpoint.draftModel, label: `${endpoint.label} · built in`, reason: 'Built-in free brain — no key or setup needed. A local model or your own key is used automatically when present.', source: 'builtin' }
        return { pick: picked, local, configured, setupRequired: false, checkedAt: new Date().toISOString() }
      }
    }

    const offline = { kind: 'template', provider: 'template', baseUrl: '', model: '', label: 'offline brain', reason: 'No network and no local model — the deterministic planner keeps everything working. Live AI resumes automatically when you are back online.', source: 'builtin' }
    return { pick: offline, local, configured, setupRequired: false, checkedAt: new Date().toISOString() }
  })().then((result) => {
    const current = readSettings()
    if (configuredAiMode(current) === 'auto') {
      const safePick = { ...result.pick }
      delete safePick.apiKey
      current.autoPick = safePick
      current.autoDiscoveredAt = result.checkedAt
      if (!Array.isArray(current.fallbackOrder) || !current.fallbackOrder.length) current.fallbackOrder = ['gemini', 'zen', 'ollama', 'lmstudio', 'template']
      if (result.pick.kind === 'opencode' || result.pick.kind === 'zen' || result.pick.kind === 'ollama' || result.pick.kind === 'lmstudio') {
        current.openCodeBaseUrl = result.pick.baseUrl
        current.openCodeModel = result.pick.model
        if (result.pick.apiKey && !process.env.OPENCODE_API_KEY) current.openCodeApiKey = result.pick.apiKey
      }
      writeSettings(current)
    }
    aiDiscoveryCache = { at: Date.now(), result }
    aiStatusCache = {
      at: Date.now(),
      dots: {
        gemini: geminiApiKey() ? 'unknown' : 'unknown',
        zen: result.pick?.kind === 'zen' ? 'ok' : 'unknown',
        local: result.local?.length ? 'ok' : 'unknown',
      },
    }
    try { mainWindow?.webContents.send('ai:discovery', { ...publicDiscovery(result), statusDots: aiStatusCache.dots }) } catch {}
    return result
  }).finally(() => { aiDiscoveryPromise = null })
  return aiDiscoveryPromise
}

function aiSettings() {
  const settings = readSettings()
  const mode = configuredAiMode(settings)
  const pick = mode === 'auto' && settings.autoPick ? settings.autoPick : null
  const baseFromPick = (pick?.kind === 'keyless' ? '' : pick?.baseUrl) || settings.openCodeBaseUrl || process.env.OPENCODE_BASE_URL || process.env.OPENAI_BASE_URL || ''
  const modelFromPick = (pick?.kind === 'keyless' ? '' : pick?.model) || settings.openCodeModel || process.env.OPENCODE_MODEL || process.env.OPENAI_MODEL || ''
  const openCodeBaseUrl = String(baseFromPick || (mode === 'openrouter' ? 'https://openrouter.ai/api/v1' : mode === 'zen' ? ZEN_BASE_URL : '')).trim()
  const openCodeModel = String(modelFromPick || (mode === 'zen' ? ZEN_FREE_MODELS[0] : mode === 'openrouter' ? 'qwen/qwen3-235b-a22b:free' : '')).trim()
  const openCodeApiKey = String(settings.openCodeApiKey || process.env.OPENCODE_API_KEY || process.env.OPENAI_API_KEY || process.env.OPENROUTER_API_KEY || resolveOpenCodeApiKey(openCodeBaseUrl, openCodeModel) || (mode === 'zen' ? openCodeAuthSecrets()[0] : '') || '').trim()
  const provider = mode === 'auto' && pick?.kind === 'keyless' ? 'keyless' : mode === 'gemini' ? 'gemini' : mode === 'template' || pick?.kind === 'template' || (mode === 'auto' && !pick) ? 'template' : mode === 'auto' && pick?.kind === 'gemini' ? 'gemini' : 'opencode'
  return { mode, pick, provider, openCodeBaseUrl, openCodeModel, openCodeApiKey }
}

function hasOpenCodeAccess() {
  const cfg = aiSettings()
  return Boolean(
    cfg.openCodeApiKey ||
    resolveOpenCodeApiKey(cfg.openCodeBaseUrl, cfg.openCodeModel) ||
    isLocalModelBase(cfg.openCodeBaseUrl),
  )
}

function publicSettings() {
  const settings = readSettings()
  const ai = aiSettings()
  const login = app.getLoginItemSettings ? app.getLoginItemSettings() : { openAtLogin: false }
  const pick = settings.autoPick || ai.pick || null
  const needsKey = ai.mode === 'gemini' || ai.mode === 'zen' || ai.mode === 'openrouter'
  return {
    hasKey: ai.provider === 'template' ? true : ai.provider === 'opencode' ? hasOpenCodeAccess() : Boolean(geminiApiKey()),
    hasGeminiKey: Boolean(geminiApiKey()),
    hasOpenCodeKey: hasOpenCodeAccess(),
    aiProvider: ai.provider,
    aiMode: ai.mode,
    autoPick: pick,
    setupRequired: Boolean(ai.mode === 'auto' && settings.autoPick?.kind === 'template'),
    fallbackOrder: Array.isArray(settings.fallbackOrder) ? settings.fallbackOrder : ['gemini', 'zen', 'ollama', 'lmstudio', 'template'],
    geminiModel: geminiModel(),
    openCodeBaseUrl: ai.openCodeBaseUrl,
    openCodeModel: ai.openCodeModel,
    openCodeImportedKey: Boolean(resolveOpenCodeApiKey(ai.openCodeBaseUrl, ai.openCodeModel) || openCodeAuthSecrets()[0]),
    statusDots: aiStatusCache.dots,
    needsKey,
    autoLaunch: Boolean(settings.autoLaunch ?? login.openAtLogin),
    silenceNoiseDb: Number.isFinite(Number(settings.silenceNoiseDb)) ? Number(settings.silenceNoiseDb) : DEFAULT_SILENCE_NOISE_DB,
    silenceMinDuration: Number.isFinite(Number(settings.silenceMinDuration))
      ? Number(settings.silenceMinDuration)
      : DEFAULT_SILENCE_MIN_DURATION,
    updateChannel: settings.updateChannel || 'latest',
    hardwareEncoding: settings.hardwareEncoding === 'off' ? 'off' : 'auto',
    stock: {
      proxyUrl: String(settings.stockProxyUrl || process.env.CUPRIC_STOCK_PROXY_URL || '').trim(),
      pixabayConfigured: Boolean(settings.pixabayApiKey || process.env.PIXABAY_API_KEY),
      pexelsConfigured: Boolean(settings.pexelsApiKey || process.env.PEXELS_API_KEY),
      keylessAvailable: true,
      quota: { pixabay: '100 requests/min', pexels: '200 requests/hour', openverse: 'anonymous limits apply', picsum: 'placeholder service' },
      proxyConfigured: Boolean(String(settings.stockProxyUrl || process.env.CUPRIC_STOCK_PROXY_URL || '').trim()),
    },
  }
}

function applySettingsPatch(patch) {
  const settings = readSettings()
  if (Object.prototype.hasOwnProperty.call(patch || {}, 'geminiApiKey')) {
    const key = String(patch.geminiApiKey || '').trim()
    if (key) settings.geminiApiKey = key
    else delete settings.geminiApiKey
  }
  if (Object.prototype.hasOwnProperty.call(patch || {}, 'aiMode')) {
    const next = String(patch.aiMode || '').toLowerCase()
    if (AI_MODES.has(next)) settings.aiMode = next
    // Manual mode changes invalidate a stale automatic pick, never a saved key.
    if (next !== 'auto') delete settings.autoPick
    if (next === 'zen') settings.openCodeBaseUrl = ZEN_BASE_URL
    if (next === 'ollama') settings.openCodeBaseUrl = 'http://localhost:11434/v1'
    if (next === 'lmstudio') settings.openCodeBaseUrl = 'http://localhost:1234/v1'
    if (next === 'openrouter' && !/^https:\/\/openrouter\.ai/i.test(String(settings.openCodeBaseUrl || ''))) settings.openCodeBaseUrl = 'https://openrouter.ai/api/v1'
  }
  if (Object.prototype.hasOwnProperty.call(patch || {}, 'fallbackOrder') && Array.isArray(patch.fallbackOrder)) {
    settings.fallbackOrder = patch.fallbackOrder.map(String).filter((value, index, list) => AI_MODES.has(value) && list.indexOf(value) === index)
  }
  if (Object.prototype.hasOwnProperty.call(patch || {}, 'aiProvider')) {
    settings.aiProvider = patch.aiProvider === 'opencode' ? 'opencode' : 'gemini'
    if (!settings.aiMode) settings.aiMode = patch.aiProvider === 'opencode' ? 'openrouter' : 'gemini'
  }
  if (Object.prototype.hasOwnProperty.call(patch || {}, 'geminiModel')) {
    const v = String(patch.geminiModel || '').trim()
    if (v) settings.geminiModel = v
  }
  if (Object.prototype.hasOwnProperty.call(patch || {}, 'openCodeApiKey')) {
    const key = String(patch.openCodeApiKey || '').trim()
    if (key) settings.openCodeApiKey = key
    else delete settings.openCodeApiKey
  }
  if (Object.prototype.hasOwnProperty.call(patch || {}, 'openCodeBaseUrl')) {
    const v = String(patch.openCodeBaseUrl || '').trim()
    if (v) settings.openCodeBaseUrl = v
  }
  if (Object.prototype.hasOwnProperty.call(patch || {}, 'openCodeModel')) {
    const v = String(patch.openCodeModel || '').trim()
    if (v) settings.openCodeModel = v
  }
  if (Object.prototype.hasOwnProperty.call(patch || {}, 'autoLaunch')) {
    settings.autoLaunch = Boolean(patch.autoLaunch)
    app.setLoginItemSettings({ openAtLogin: settings.autoLaunch })
  }
  if (Object.prototype.hasOwnProperty.call(patch || {}, 'silenceNoiseDb')) {
    const v = Number(patch.silenceNoiseDb)
    if (Number.isFinite(v)) settings.silenceNoiseDb = Math.max(-90, Math.min(-5, v))
  }
  if (Object.prototype.hasOwnProperty.call(patch || {}, 'hardwareEncoding')) {
    settings.hardwareEncoding = patch.hardwareEncoding === 'off' ? 'off' : 'auto'
    // Re-detect on the next render with the new preference.
    encoderSession.result = null
    encoderSession.disabledReason = null
  }
  for (const key of ['pixabayApiKey', 'pexelsApiKey']) {
    if (Object.prototype.hasOwnProperty.call(patch || {}, key)) {
      const value = String(patch[key] || '').trim()
      if (value) settings[key] = value
      else delete settings[key]
    }
  }
  if (Object.prototype.hasOwnProperty.call(patch || {}, 'stockProxyUrl')) {
    const value = String(patch.stockProxyUrl || '').trim()
    if (!value) delete settings.stockProxyUrl
    else if (/^https?:\/\//i.test(value)) settings.stockProxyUrl = value.replace(/\/+$/, '')
  }
  if (Object.prototype.hasOwnProperty.call(patch || {}, 'silenceMinDuration')) {
    const v = Number(patch.silenceMinDuration)
    if (Number.isFinite(v)) settings.silenceMinDuration = Math.max(0.1, Math.min(10, v))
  }
  writeSettings(settings)
  return publicSettings()
}

function stateFile() {
  return userDataPath('projects.json')
}

ipcMain.handle('settings:get', async () => {
  // Settings is a discovery trigger by design: opening the panel should tell a
  // fresh install what it can use before the user clicks Generate.
  await autoDiscover()
  return publicSettings()
})
ipcMain.handle('settings:hasKey', () => publicSettings().hasKey)
ipcMain.handle('settings:set', async (_event, patch) => {
  const result = applySettingsPatch(patch || {})
  if (configuredAiMode(readSettings()) === 'auto') await autoDiscover({ force: true })
  return publicSettings()
})
ipcMain.handle('ai:freeModels', async (_event, payload = {}) => {
  const cat = await refreshModelCatalogue({ force: Boolean(payload?.force) }).catch(() => readModelCatalogue())
  // Presence-only: never any key material in what the renderer receives.
  return { fetchedAt: cat.fetchedAt, models: (cat.models || []).map((m) => ({ id: m.id, source: m.source, kind: m.kind, badge: m.badge, isNew: Boolean(m.isNew), retired: Boolean(m.retired) })) }
})
ipcMain.handle('ai:ackNewModels', () => {
  const cat = readModelCatalogue()
  writeModelCatalogue({ ...cat, models: (cat.models || []).map((m) => ({ ...m, isNew: false, seen: true })) })
  return true
})
/**
 * F-1 — endpoint health for the Settings dots. Presence only: a route key
 * (baseUrl|model), its label, and whether it is quarantined. Never a key.
 */
ipcMain.handle('ai:health', () => ({ routes: healthRows(), at: Date.now() }))
ipcMain.handle('ai:autoDiscover', async () => publicDiscovery(await autoDiscover({ force: true })))
ipcMain.handle('ai:openZenAuth', () => shell.openExternal('https://opencode.ai/auth'))
ipcMain.handle('ai:installOllama', () => shell.openExternal('https://ollama.com/download'))
ipcMain.handle('ai:useTemplate', () => {
  applySettingsPatch({ aiMode: 'template' })
  return publicSettings()
})
ipcMain.handle('settings:autoLaunch', (_event, enabled) => applySettingsPatch({ autoLaunch: Boolean(enabled) }))

// Stock rail (Jobs 10–12): provider credentials are read only in main, search
// responses are cached under userData, and downloaded media lands in the
// project folder before the renderer can register it.
ipcMain.handle('stock:keyStatus', () => {
  const settings = stockSettings()
  return {
    pixabay: Boolean(settings.pixabayApiKey || process.env.PIXABAY_API_KEY),
    pexels: Boolean(settings.pexelsApiKey || process.env.PEXELS_API_KEY),
    proxy: Boolean(settings.stockProxyUrl),
    proxyUrl: String(settings.stockProxyUrl || ''),
    quota: { pixabay: '100 requests/min', pexels: '200 requests/hour', openverse: 'anonymous limits apply', picsum: 'placeholder service' },
    keyless: true,
  }
})
ipcMain.handle('stock:proxyHealth', async () => stockProxyHealth(stockSettings().stockProxyUrl))
ipcMain.handle('stock:search', async (_event, payload) => {
  const provider = ['pixabay', 'pexels', 'openverse', 'picsum'].includes(payload?.provider) ? payload.provider : 'openverse'
  const kind = payload?.kind === 'video' ? 'video' : 'image'
  return stockService().search(provider, kind, payload?.options || {}, stockSettings())
})
ipcMain.handle('stock:testConnection', async (_event, payload) => {
  const provider = ['pixabay', 'pexels', 'openverse', 'picsum'].includes(payload?.provider) ? payload.provider : 'openverse'
  const settings = stockSettings()
  const result = await stockService().search(provider, provider === 'picsum' ? 'image' : 'image', { query: 'nature', perPage: 3 }, settings)
  return { ok: true, provider, resultCount: result.results.length, route: settings.stockProxyUrl ? 'proxy with personal-key fallback' : 'direct/keyless', quota: publicSettings().stock.quota }
})
ipcMain.handle('stock:download', async (_event, payload) => {
  const projectId = String(payload?.projectId || '')
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(projectId)) throw new Error('A valid project is required before downloading stock.')
  const item = payload?.item
  const result = await stockService().download(projectRoot(projectId), item, stockSettings())
  return result
})
/**
 * JOB 2 — one term, the whole source chain, in the main process.
 *
 * The renderer used to pick one provider, take the first hit and give up,
 * which is how a saved Pixabay key plus a keyless Openverse still produced
 * "No footage could be downloaded". Search, retry and fallback all belong on
 * this side of the bridge; the renderer gets a verdict and an attempt log it
 * can show the user verbatim.
 */
ipcMain.handle('stock:fetchForTerm', async (_event, payload) => {
  const projectId = String(payload?.projectId || '')
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(projectId)) throw new Error('A valid project is required before downloading stock.')
  return stockService().fetchForTerm(projectRoot(projectId), {
    term: payload?.term,
    kind: payload?.kind,
    orientation: payload?.orientation,
    provider: payload?.provider,
    perPage: payload?.perPage,
  }, stockSettings())
})

// Review Room notes are persisted in the main process on desktop, so a reload
// or renderer crash does not erase feedback. The room id is deliberately
// unguessable only when the caller puts it in the invite URL; this is a local
// review log, not an authentication boundary.
function reviewRoomId(value) {
  const id = String(value || 'default').trim().replace(/[^a-zA-Z0-9_-]+/g, '-').slice(0, 100)
  return id || 'default'
}
function reviewFile(room) { return userDataPath('review-rooms', `${reviewRoomId(room)}.json`) }
function reviewComments(room) {
  const list = readJson(reviewFile(room), [])
  return Array.isArray(list) ? list.filter((item) => item && typeof item === 'object').slice(-500) : []
}
ipcMain.handle('review:list', (_event, payload) => reviewComments(payload?.room))
ipcMain.handle('review:add', (_event, payload) => {
  const room = reviewRoomId(payload?.room)
  const text = String(payload?.text || '').trim().slice(0, 2000)
  if (!text) throw new Error('Review note cannot be empty.')
  const current = reviewComments(room)
  const comment = { id: `review-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, at: Math.max(0, Number(payload?.at) || 0), text, author: String(payload?.author || 'Guest reviewer').trim().slice(0, 80) || 'Guest reviewer', resolved: false, createdAt: new Date().toISOString() }
  writeJson(reviewFile(room), [...current, comment])
  return comment
})
ipcMain.handle('review:resolve', (_event, payload) => {
  const room = reviewRoomId(payload?.room)
  const current = reviewComments(room).map((item) => item.id === payload?.id ? { ...item, resolved: Boolean(payload?.resolved) } : item)
  writeJson(reviewFile(room), current)
  return current
})
// Autosave / crash recovery / version history (2.26): atomic writes, a
// rolling set of snapshots, recovery from the newest valid one when the main
// file is unreadable. Logic lives in project-history.cjs so it is testable.
let stateRecovery = { previousSessionCrashed: false, recoveredFrom: null }
ipcMain.handle('state:save', (_event, payload) => {
  const value = typeof payload === 'string' ? payload : payload?.value ?? JSON.stringify(payload ?? null)
  try {
    projectHistory.save(app.getPath('userData'), String(value))
  } catch (err) {
    logLine('state-save-failed', err?.message || String(err))
    throw err
  }
  return true
})
ipcMain.handle('state:load', () => {
  const result = projectHistory.load(app.getPath('userData'))
  if (result.recoveredFrom) {
    stateRecovery = { ...stateRecovery, recoveredFrom: result.recoveredFrom }
    logLine('state-recovered', 'projects.json was unreadable; restored the newest valid autosave', { from: result.recoveredFrom })
  } else if (result.corrupt) {
    stateRecovery = { ...stateRecovery, unreadable: true }
    logLine('state-unreadable', 'projects.json was unreadable and no valid autosave exists; kept it as projects.corrupt-*.json and started empty')
  }
  logLine('project:load', 'state:load served', { bytes: result.text ? result.text.length : 0, recoveredFrom: result.recoveredFrom || null, corrupt: Boolean(result.corrupt) })
  return result.text
})
ipcMain.handle('state:recoveryInfo', () => stateRecovery)

// One-click diagnostic report (2.27). Redaction lives in diagnostics.cjs.
function recentLogLines(maxFiles = 2) {
  try {
    const dir = userDataPath('logs')
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.log')).sort().slice(-maxFiles)
    return files.flatMap((f) => fs.readFileSync(path.join(dir, f), 'utf8').split(/\r?\n/)).slice(-2000)
  } catch {
    return []
  }
}
/* ——— 2.7 video proxies ——————————————————————————————————————————————— */
const proxyJobs = new Map()

ipcMain.handle('media:proxy', async (event, payload) => {
  const sourcePath = payload?.path
  const stat = proxies.validateSource(sourcePath)
  ffmpegPath = candidateBinaryPath(ffmpegPath) || resolveMediaTool('ffmpeg')
  if (!ffmpegPath) throw new Error('FFmpeg is unavailable, so proxies cannot be made. Set CUPRIC_FFMPEG_PATH or reinstall.')
  const dir = userDataPath('proxies')
  ensureDir(dir)
  const outPath = path.join(dir, `${proxies.proxyKey(sourcePath, stat)}.mp4`)
  if (fs.existsSync(outPath) && fs.statSync(outPath).size > 1024) return { path: outPath, url: pathToFileURL(outPath).toString(), cached: true }
  // One job per output: two clips of the same file share one transcode.
  if (!proxyJobs.has(outPath)) {
    const tmp = `${outPath}.part.mp4`
    const durationSec = Number(payload?.durationSec) || 0
    const job = runProcess(null, ffmpegPath, proxies.proxyArgs(sourcePath, tmp), {
      onStdout: (chunk) => {
        const pct = proxies.progressFrom(chunk, durationSec)
        if (pct !== null && !event.sender.isDestroyed()) event.sender.send('media:proxyProgress', { path: sourcePath, pct })
      },
    })
      .then(async () => {
        await fsp.rename(tmp, outPath)
        return outPath
      })
      .catch(async (err) => {
        await fsp.rm(tmp, { force: true })
        throw new Error(`Proxy failed: ${String(err?.message || err).slice(-400)}`)
      })
      .finally(() => proxyJobs.delete(outPath))
    proxyJobs.set(outPath, job)
  }
  const done = await proxyJobs.get(outPath)
  return { path: done, url: pathToFileURL(done).toString(), cached: false }
})

ipcMain.handle('media:proxyDelete', async (_event, payload) => {
  const stat = proxies.validateSource(payload?.path)
  const outPath = path.join(userDataPath('proxies'), `${proxies.proxyKey(payload.path, stat)}.mp4`)
  await fsp.rm(outPath, { force: true })
  return { deleted: true }
})

ipcMain.handle('log:write', (_event, payload) => writeRendererLog(payload))

ipcMain.handle('diag:report', (_event, payload) => {
  const settings = publicSettings()
  return diagnostics.buildReport({
    appVersion: app.getVersion(),
    packaged: app.isPackaged,
    platform: process.platform,
    osRelease: os.release(),
    arch: process.arch,
    versions: process.versions,
    media: mediaToolStatus(),
    encoder: typeof videoEncoderState === 'function' ? videoEncoderState() : null,
    ai: settings,
    recovery: stateRecovery,
    versionCount: projectHistory.listVersions(app.getPath('userData')).length,
    logLines: recentLogLines(),
    rendererErrors: Array.isArray(payload?.rendererErrors) ? payload.rendererErrors.map(String).slice(-40) : [],
    homeDir: os.homedir(),
  })
})
ipcMain.handle('state:listVersions', () => projectHistory.listVersions(app.getPath('userData')))
ipcMain.handle('state:snapshotNow', () => {
  try {
    const text = fs.readFileSync(stateFile(), 'utf8')
    return { id: projectHistory.snapshot(app.getPath('userData'), text, 'manual') }
  } catch (err) {
    throw new Error(`Nothing saved yet to keep as a version (${err?.message || String(err)}).`)
  }
})
ipcMain.handle('state:restoreVersion', (_event, payload) => {
  const result = projectHistory.restore(app.getPath('userData'), String(payload?.id || ''))
  logLine('state-restored', 'Restored an earlier version', result)
  return result
})
ipcMain.handle('state:clear', () => {
  fs.rmSync(stateFile(), { force: true })
  return true
})

// Autonomous jobs are persisted independently from renderer state. The UI owns presentation;
// the native queue now streams real step progress as work happens instead of doing
// the whole render before the first status update.
function automationFile() { return userDataPath('automation', 'jobs.json') }
function automationJobs() { return readJson(automationFile(), []) }
function saveAutomationJobs(jobs) { writeJson(automationFile(), jobs) }
/**
 * One readable line per distinct problem.
 *
 * Jobs are resumed, retried and re-gated, and each pass used to push the same
 * message again — plus raw provider dumps (a Gemini 429 is ~2 KB of JSON). The
 * review report ended up listing one error a dozen times. Warnings are
 * normalised and de-duplicated wherever they are stored, with a count when
 * something really did happen more than once.
 */
function tidyWarning(raw) {
  let text = String(raw ?? '')
    .replace(/Error invoking remote method '[^']+':\s*/g, '')
    .replace(/\[GoogleGenerativeAI Error\]:?\s*/g, '')
    .replace(/^(?:Error:\s*)+/, '')
    .replace(/\s+/g, ' ')
    .trim()
  const daily = /PerDay|per day|daily/i.test(text)
  // Cut provider JSON / stack dumps down to the sentence before them.
  const dump = text.search(/\s\[\{\s*"@type"|\s\{\s*"error"|\s+at\s+\S+\s+\(|\n\s+at\s/)
  if (dump > 40) text = `${text.slice(0, dump).trim()}…`
  if (/\b429\b|quota|rate.?limit|resource_exhausted/i.test(text)) {
    const model = text.match(/models\/([\w.-]+)|model[:\s]+([\w.-]*gemini[\w.-]*)/i)
    const name = model ? (model[1] || model[2]) : ''
    const lead = text.match(/^[^.:(]*?(?:unavailable|fell back|failed)[^.:(]*[.:]?/i)?.[0]?.replace(/[.:]$/, '') || 'Live AI was rate-limited'
    text = `${lead}: ${name ? `${name} ` : 'the AI provider '}is out of free quota${daily ? ' for today' : ' for now'}. Cupric used the next available model or its built-in fallback.`
  }
  return text.length > 420 ? `${text.slice(0, 417).trimEnd()}…` : text
}

function tidyWarnings(list) {
  const order = []
  const counts = new Map()
  const firstText = new Map()
  for (const item of Array.isArray(list) ? list : []) {
    const text = tidyWarning(String(item ?? '').replace(/\s*\(×\d+\)$/, ''))
    if (!text) continue
    const previous = String(item ?? '').match(/\(×(\d+)\)$/)
    // Collapse retry delays and timestamps, keep small ordinals ("Candidate 2").
    const key = text.toLowerCase().replace(/\d{2,}(?:\.\d+)?|\d+\.\d+/g, '#').slice(0, 180)
    if (!counts.has(key)) {
      order.push(key)
      firstText.set(key, text)
      counts.set(key, previous ? Number(previous[1]) : 1)
    } else {
      counts.set(key, counts.get(key) + 1)
    }
  }
  return order.map((key) => (counts.get(key) > 1 ? `${firstText.get(key)} (×${counts.get(key)})` : firstText.get(key)))
}

function patchAutomation(id, patch) {
  if (patch && Array.isArray(patch.warnings)) patch = { ...patch, warnings: tidyWarnings(patch.warnings) }
  const jobs = automationJobs()
  const next = jobs.map(j => j.id === id ? { ...j, ...patch, updatedAt: new Date().toISOString() } : j)
  saveAutomationJobs(next)
  return next.find(j => j.id === id) || null
}
function sendAutomation(channel, payload) {
  try { mainWindow?.webContents.send(channel, payload) } catch {}
}
function automationRoot(jobId) { return userDataPath('automation', jobId) }
function automationStep(job, index) { return job?.steps?.[index] || null }
function patchAutomationStep(jobId, index, stepPatch, jobPatch = {}, channel = 'automation:progress') {
  const latest = automationJobs().find(j => j.id === jobId)
  if (!latest) return null
  const step = automationStep(latest, index)
  if (!step) return latest
  const steps = latest.steps.map((item, i) => i === index ? { ...item, ...stepPatch } : item)
  const current = patchAutomation(jobId, { ...jobPatch, steps })
  if (current) sendAutomation(channel, current)
  return current
}
function startAutomationStep(jobId, index, message) {
  const latest = automationJobs().find(j => j.id === jobId)
  const step = automationStep(latest, index)
  if (!step || step.status === 'done') return latest
  return patchAutomationStep(jobId, index, { status: 'running', progressPct: Math.max(5, step.progressPct || 0), message, startedAt: step.startedAt || new Date().toISOString() }, { status: 'running', currentStepId: step.id, waitingMessage: null }, 'automation:step')
}
function finishAutomationStep(jobId, index, message) {
  const latest = automationJobs().find(j => j.id === jobId)
  const step = automationStep(latest, index)
  if (!step) return latest
  return patchAutomationStep(jobId, index, { status: 'done', progressPct: 100, message, completedAt: new Date().toISOString() }, { status: 'running', currentStepId: step.id }, 'automation:progress')
}
function waitAutomationStep(jobId, index, message) {
  const latest = automationJobs().find(j => j.id === jobId)
  const step = automationStep(latest, index)
  if (!step) return latest
  const current = patchAutomationStep(jobId, index, { status: 'waiting-for-user', progressPct: 100, message }, { status: 'waiting-for-user', currentStepId: step.id, waitingMessage: message }, 'automation:waiting')
  return current
}
function failAutomation(jobId, err, stepIndex) {
  const message = err?.message || String(err)
  const latest = automationJobs().find(j => j.id === jobId)
  const patch = { status: 'error', errorMessage: message, currentStepId: null }
  if (latest && Number.isInteger(stepIndex) && latest.steps?.[stepIndex]) {
    patch.steps = latest.steps.map((step, i) => i === stepIndex ? { ...step, status: 'error', progressPct: step.progressPct || 100, errorMessage: message, message } : step)
  }
  const failed = patchAutomation(jobId, patch) || { id: jobId, status: 'error', errorMessage: message }
  sendAutomation('automation:error', failed)
  logLine('automation-error', message, { jobId })
  return failed
}
function automationState(jobId) {
  let state = automationRunStates.get(jobId)
  if (!state) {
    state = { id: jobId, cancelled: false, processes: new Set(), windows: new Set(), sender: mainWindow?.webContents }
    automationRunStates.set(jobId, state)
  }
  state.sender = mainWindow?.webContents
  return state
}
function stopAutomationState(jobId) {
  const state = automationRunStates.get(jobId)
  if (!state) return
  state.cancelled = true
  for (const child of state.processes) stopChild(child)
  for (const win of state.windows) {
    try { if (!win.isDestroyed()) win.destroy() } catch {}
  }
}
function ensureAutomationActive(jobId, state) {
  const latest = automationJobs().find(j => j.id === jobId)
  if (state?.cancelled || latest?.status === 'cancelled') throw new Error('Automation cancelled')
  if (!latest) throw new Error('Automation job disappeared')
  return latest
}
function fallbackRundownForJob(job) {
  return normalizeRundown({
    title: String(job.brief || 'Cupric AI').slice(0, 48),
    durationSec: /\b(\d{1,3})\s*(?:s|sec|second)/i.test(job.brief || '') ? Number((job.brief || '').match(/\b(\d{1,3})\s*(?:s|sec|second)/i)?.[1]) : 12,
    fps: job.fps,
    size: job.aspect === '9:16' ? [1080, 1920] : job.aspect === '1:1' ? [1080, 1080] : [1920, 1080],
    style: 'Cupric AI deterministic kinetic type, near-black canvas, lime accent, clean editorial motion',
  }, job.brief)
}
function candidateHtmlForRundown(rundown, variant = 0) {
  const width = Array.isArray(rundown.size) ? Number(rundown.size[0]) || 1920 : 1920
  const height = Array.isArray(rundown.size) ? Number(rundown.size[1]) || 1080 : 1080
  const safeJson = JSON.stringify(rundown).replace(/</g, '\\u003c')
  const sourceManifest = {
    sources: [
      { id: 'copy', type: 'text', description: 'Scene copy from the locked Cupric AI rundown' },
      { id: 'procedural-visuals', type: 'generated', description: 'Inline CSS/JS typography, gradients, grids, masks, counters, and SVG/CSS shapes' },
    ],
    sequence: (rundown.scenes || []).map((s, index) => ({ index: index + 1, from: s.from, to: s.to, type: s.type, copy: s.copy, motion: s.motion })),
    renderSpec: { width, height, durationSec: rundown.durationSec, fps: rundown.fps },
  }
  const safeManifest = JSON.stringify(sourceManifest).replace(/</g, '\\u003c')
  const palettes = [
    { bg: '#0B0B10', fg: '#F4F1EA', accent: '#C8F542', alt: '#4FB6E8' },
    { bg: '#101014', fg: '#F8F4E8', accent: '#4FB6E8', alt: '#C8F542' },
    { bg: '#090A0F', fg: '#FFFFFF', accent: '#C8F542', alt: '#A78BFA' },
  ]
  const palette = palettes[variant % palettes.length]
  return `<!doctype html><html><head><meta charset="utf-8"/><meta name="viewport" content="width=${width},height=${height},initial-scale=1"/><title>${escapeHtml(rundown.title)}</title><style>
html,body{margin:0;width:100%;height:100%;overflow:hidden;background:${palette.bg};font-family:Inter,Segoe UI,Arial,sans-serif;color:${palette.fg}}
#scene{position:relative;width:${width}px;height:${height}px;overflow:hidden;background:radial-gradient(circle at 18% 20%,${palette.accent}33,transparent 28%),radial-gradient(circle at 88% 82%,${palette.alt}2e,transparent 34%),linear-gradient(135deg,${palette.bg},#171820 58%,#0f1016);transform-origin:top left}
.grid{position:absolute;inset:0;background-image:linear-gradient(rgba(255,255,255,.055) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.055) 1px,transparent 1px);background-size:${Math.round(width/16)}px ${Math.round(height/12)}px;mask-image:linear-gradient(180deg,transparent,black 22%,black 78%,transparent);opacity:.38}
.brand{position:absolute;left:7%;top:9%;font-weight:900;letter-spacing:.22em;color:${palette.accent};font-size:${Math.max(22, Math.round(width*.026))}px}.badge{position:absolute;right:7%;top:9%;border:1px solid rgba(255,255,255,.16);border-radius:999px;padding:.7em 1em;color:${palette.fg};font-weight:800;font-size:${Math.max(16, Math.round(width*.014))}px;background:rgba(255,255,255,.06)}
.copy{position:absolute;left:7%;right:8%;top:32%;font-weight:950;line-height:.92;letter-spacing:-.06em;text-wrap:balance;font-size:${Math.max(48, Math.round(width*.075))}px}.motion{position:absolute;left:7%;right:19%;top:66%;color:rgba(244,241,234,.72);font-size:${Math.max(22, Math.round(width*.026))}px;line-height:1.25}.bar{position:absolute;left:7%;bottom:9%;height:${Math.max(8, Math.round(height*.01))}px;border-radius:999px;background:${palette.accent};width:0}.orb{position:absolute;width:${Math.round(Math.min(width,height)*.28)}px;height:${Math.round(Math.min(width,height)*.28)}px;border-radius:50%;filter:blur(4px);background:${palette.accent};opacity:.16;right:6%;bottom:16%}</style></head><body><div id="scene"><div class="grid"></div><div class="orb"></div><div class="brand">CUPRIC AI</div><div class="badge" id="badge"></div><div class="copy" id="copy"></div><div class="motion" id="motion"></div><div class="bar" id="bar"></div></div><script>
const rundown=${safeJson}; const sourceManifest=${safeManifest}; window.__cupricSourceManifest=sourceManifest; const variant=${variant}; const duration=Math.max(.1, Number(rundown.durationSec)||12);
const copy=document.getElementById('copy'), motion=document.getElementById('motion'), bar=document.getElementById('bar'), badge=document.getElementById('badge'), orb=document.querySelector('.orb'), grid=document.querySelector('.grid');
function clamp(n,a,b){return Math.max(a,Math.min(b,n))} function ease(x){x=clamp(x,0,1);return 1-Math.pow(1-x,3)}
function sceneAt(t){return (rundown.scenes||[]).find(s=>t>=Number(s.from||0)&&t<Number(s.to||duration)) || (rundown.scenes||[])[(rundown.scenes||[]).length-1] || {from:0,to:duration,type:'hook',copy:rundown.title,motion:rundown.style}}
window.__seek=function(t){t=clamp(Number(t)||0,0,duration); const s=sceneAt(t); const from=Number(s.from||0), to=Math.max(from+.1,Number(s.to||duration)); const local=clamp((t-from)/(to-from),0,1); const e=ease(local*2.4); copy.textContent=String(s.copy||rundown.title||'Cupric AI').toUpperCase(); motion.textContent=String(s.motion||rundown.style||'deterministic motion'); badge.textContent=String(s.type||'scene')+' · '+t.toFixed(1)+'s'; copy.style.opacity=e; copy.style.transform='translateY('+((1-e)*70)+'px) scale('+(0.96+e*.04)+')'; motion.style.opacity=clamp((local-.12)*2.2,0,1); motion.style.transform='translateX('+((1-e)*(variant%2?-40:40))+'px)'; bar.style.width=(7+86*(t/duration))+'%'; orb.style.transform='translate('+(Math.sin(t*.9+variant)*60)+'px,'+(Math.cos(t*.7+variant)*50)+'px) scale('+(1+Math.sin(t*1.1)*.08)+')'; grid.style.transform='translateY('+(-t*18)+'px)';}; window.__seek(0);
</script></body></html>`
}
/**
 * Where the shipped resource packs live, in dev and when packaged.
 *
 * electron-builder copies `resources/**` next to the app, so try the packaged
 * location first and fall back to the repo layout during `npm run desktop`.
 */
function packsDir() {
  const candidates = [
    path.join(process.resourcesPath || '', 'resources', 'packs'),
    path.join(__dirname, '..', 'resources', 'packs'),
    path.join(__dirname, '..', 'dist', 'resources', 'packs'),
  ]
  return candidates.find((dir) => dir && fs.existsSync(dir)) || ''
}

/** Resource selection by beat across every bundled pack — see electron/resource-context.cjs. */
function automationResourceContext(brief, rundown) {
  return resourceContext.automationResourceContext(brief, rundown, packsDir())
}

/**
 * Validate a model-authored HTML candidate against the same contract the
 * renderer enforces at capture time (see renderArenaSegment): one file, a
 * #scene root, a deterministic window.__seek(t), and no wall-clock animation.
 *
 * Returns a score and the reasons behind it. Anything that fails a `fatal`
 * check cannot be rendered at all and is disqualified rather than ranked.
 */
function validateCandidateHtml(html, rundown) {
  const text = String(html || '')
  const checks = [
    { id: 'non-empty', ok: text.trim().length > 400, fatal: true, points: 10, why: 'has real content' },
    { id: 'html-doc', ok: /<html[\s>]/i.test(text) && /<\/html>/i.test(text), fatal: true, points: 10, why: 'complete HTML document' },
    { id: 'scene-root', ok: /id=["']scene["']/.test(text), fatal: true, points: 15, why: 'has the #scene root the renderer captures' },
    { id: 'seek', ok: /window\.__seek\s*=/.test(text), fatal: true, points: 25, why: 'defines window.__seek(t)' },
    { id: 'manifest', ok: /__cupricSourceManifest/.test(text), fatal: false, points: 8, why: 'declares its source manifest' },
    { id: 'initial-frame', ok: /__seek\s*\(\s*0\s*\)/.test(text), fatal: false, points: 8, why: 'paints a valid frame at t=0' },
    { id: 'self-contained', ok: !/<script[^>]+src=|<link[^>]+href=["']https?:/i.test(text), fatal: true, points: 12, why: 'no remote scripts or stylesheets' },
    { id: 'no-wall-clock', ok: !/requestAnimationFrame|setInterval|setTimeout|Date\.now\(\)|performance\.now\(\)/.test(text), fatal: false, points: 12, why: 'frames depend only on t, not on wall-clock time' },
    { id: 'no-random', ok: !/Math\.random/.test(text), fatal: false, points: 6, why: 'deterministic (no Math.random)' },
    { id: 'size', ok: text.includes(String(rundown.size?.[0])) && text.includes(String(rundown.size?.[1])), fatal: false, points: 6, why: 'renders at the requested frame size' },
    {
      id: 'copy',
      ok: (rundown.scenes || []).every((scene) => !scene.copy || text.includes(String(scene.copy).slice(0, 18))),
      fatal: false,
      points: 10,
      why: 'carries every line of locked scene copy',
    },
  ]
  const failedFatal = checks.filter((c) => c.fatal && !c.ok)
  const score = checks.reduce((n, c) => n + (c.ok ? c.points : 0), 0)
  return {
    valid: failedFatal.length === 0,
    score,
    reasons: checks.filter((c) => c.ok).map((c) => c.why),
    failures: checks.filter((c) => !c.ok).map((c) => `${c.fatal ? 'FATAL' : 'weak'}: ${c.why}`),
  }
}

/** Strip ```html fences and any prose the model wrapped the file in. */
function extractHtmlFromModel(text) {
  const raw = String(text || '')
  const fenced = raw.match(/```(?:html)?\s*([\s\S]*?)```/i)
  const body = fenced ? fenced[1] : raw
  const start = body.search(/<!doctype html|<html[\s>]/i)
  return (start >= 0 ? body.slice(start) : body).trim()
}

async function generateCandidateHtml(prompt) {
  // Same router as everything else: a Gemini 429 falls through to the next
  // Gemini model, OpenCode, or a running local model instead of ending the
  // battle with "No AI candidate passed the render contract".
  const reply = await completeWithFallback({
    system: 'You are a motion-graphics engineer. Return ONLY a complete single-file index.html. No prose, no markdown fences.',
    user: prompt,
    temperature: 0.85,
    deadlineMs: 150_000,
    task: 'lock',
  })
  return extractHtmlFromModel(reply.text)
}

const CANDIDATE_COUNT = 3
// One overall budget for the candidate step (all candidates run in parallel).
const CANDIDATE_DEADLINE_MS = 150000

/** How many times a candidate may be sent back for repair. */
const REPAIR_ROUNDS = 2

/**
 * Critique → repair.
 *
 * A model that fails the render contract has usually got 90% of a good piece
 * and one mechanical mistake — a remote font link, a rAF loop, a missing
 * `__seek`. Throwing that away and re-rolling wastes the good 90%, so the file
 * goes back with the exact list of failures and a demand for the smallest fix
 * that clears them.
 *
 * Two rules keep this honest:
 *  - a repair is only accepted if it scores *better* than what went in, so a
 *    model that "fixes" the file into something worse is ignored;
 *  - the loop is bounded, and every round is recorded in the voting report.
 */
async function critiqueAndRepair(html, verdict, rundown, label) {
  let bestHtml = html
  let bestVerdict = verdict
  const history = []

  for (let round = 1; round <= REPAIR_ROUNDS; round += 1) {
    if (bestVerdict.valid && !bestVerdict.failures.length) break

    const critique = [
      'You wrote this single-file motion-graphics HTML for Cupric AI. It did not pass the renderer contract.',
      '',
      'FAILED CHECKS — every one of these must be fixed:',
      ...bestVerdict.failures.map((f) => `- ${f}`),
      '',
      'RULES (unchanged):',
      '- One self-contained file. No CDN, no remote font, no external asset of any kind.',
      '- All motion must be a pure function of t via window.__seek(t). No requestAnimationFrame, no setInterval, no Date.now, no performance.now, no Math.random.',
      '- Keep the #scene root and call __seek(0) once so the file paints a valid first frame.',
      '- Keep the existing design. Change as little as possible: fix the failures, keep everything that already works.',
      '',
      'Return ONLY the corrected complete HTML file.',
      '',
      'CURRENT FILE:',
      bestHtml,
    ].join('\n')

    try {
      const repaired = await generateCandidateHtml(critique)
      const repairedVerdict = validateCandidateHtml(repaired, rundown)
      const improved = repairedVerdict.score > bestVerdict.score || (repairedVerdict.valid && !bestVerdict.valid)
      history.push({
        round,
        addressed: bestVerdict.failures,
        scoreBefore: bestVerdict.score,
        scoreAfter: repairedVerdict.score,
        accepted: improved,
        remaining: repairedVerdict.failures,
      })
      if (!improved) break
      bestHtml = repaired
      bestVerdict = repairedVerdict
    } catch (err) {
      history.push({ round, error: err?.message || String(err) })
      logLine('automation-repair-failed', err?.message || String(err), { candidate: label, round })
      break
    }
  }

  return { html: bestHtml, verdict: bestVerdict, history }
}


/**
 * The real model battle.
 *
 * Previously this wrote the same hardcoded template three times with three
 * palettes and "scored" it with checks that all three always passed — the
 * winner was decided by the `i * 4` tiebreak, i.e. by nothing. Now each
 * candidate is an independent model generation from the locked Arena prompt
 * (plus the resource context), validated against the renderer's real contract.
 *
 * The boilerplate template is still here, but only as an explicit, *declared*
 * rescue: if it is used, the job says so in warnings and the voting report
 * records `fallbackUsed`.
 */
async function writeAutomationCandidates(root, rundown, job, warnings) {
  const resources = automationResourceContext(job?.brief, rundown)
  const basePrompt = rundown.arenaPrompt || arenaPromptOf(rundown)
  const prompt = resources.prompt
    ? `${basePrompt}\n\nCOMPOSE WITH CUPRIC'S OWN RESOURCE LIBRARY:\n${resources.prompt}\n\nFollow the scene-by-scene direction: give each scene the motion its beat calls for and layer its background/main/accent resources, re-implemented in inline HTML/CSS/SVG.`
    : basePrompt

  const candidates = []
  const attempts = []
  let fallbackUsed = false
  // With no model at all, don't sit on a spinner: Cupric AI's built-in
  // deterministic candidates (below) are the honest answer straight away.
  const liveModel = aiSettings().provider !== 'template' || Boolean(geminiApiKey()) || hasOpenCodeAccess()
  const progress = (done, note) => {
    if (!job?.id) return
    try { patchAutomationStep(job.id, 3, { progressPct: Math.min(95, 5 + Math.round((90 * done) / CANDIDATE_COUNT)), message: note }) } catch {}
  }
  let settled = 0
  let closed = false

  const runOne = async (i) => {
    const file = path.join(root, `candidate-${i + 1}.html`)
    // Each candidate gets a different creative constraint so the battle
    // compares genuinely different pieces, not three samples of one prompt.
    const angle = [
      'Direction A: typography-led. The type IS the visual — scale contrast, tight tracking, minimal ornament.',
      'Direction B: composition-led. Geometry, masks and grid motion carry the piece; type is secondary.',
      'Direction C: atmosphere-led. Gradient/field background with depth and a restrained, confident type layer.',
    ][i % 3]
    try {
      const first = await generateCandidateHtml(`${prompt}\n\nCREATIVE DIRECTION FOR THIS CANDIDATE:\n${angle}`)
      const firstVerdict = validateCandidateHtml(first, rundown)
      // Anything short of a clean pass goes back to the model with its own
      // failures quoted at it, rather than being binned.
      const { html, verdict, history } = await critiqueAndRepair(first, firstVerdict, rundown, i + 1)
      attempts.push({
        candidate: i + 1,
        generated: true,
        valid: verdict.valid,
        failures: verdict.failures,
        scoreBeforeRepair: firstVerdict.score,
        score: verdict.score,
        repairRounds: history,
      })
      if (closed) return
      if (!verdict.valid) {
        logLine('automation-candidate-invalid', `Candidate ${i + 1} failed the render contract even after repair`, verdict.failures)
        return
      }
      if (history.some((h) => h.accepted)) {
        warnings.push(`Candidate ${i + 1} needed ${history.filter((h) => h.accepted).length} repair round(s) before it met the render contract.`)
      }
      fs.writeFileSync(file, html, 'utf8')
      candidates.push({
        file,
        score: verdict.score,
        generatedBy: aiSettings().provider,
        reasons: verdict.reasons,
        failures: verdict.failures,
        repaired: history.some((h) => h.accepted),
      })
    } catch (err) {
      if (closed) return
      attempts.push({ candidate: i + 1, generated: false, error: err?.message || String(err) })
      logLine('automation-candidate-failed', err?.message || String(err), { candidate: i + 1 })
    } finally {
      if (!closed) { settled += 1; progress(settled, `Candidate ${settled} of ${CANDIDATE_COUNT} finished`) }
    }
  }

  if (liveModel) {
    // In parallel, under one deadline: a slow or stuck model can't hold the run hostage.
    progress(0, `Generating ${CANDIDATE_COUNT} candidates in parallel (up to ${Math.round(CANDIDATE_DEADLINE_MS / 1000)}s)`)
    let timer
    const deadline = new Promise((resolve) => { timer = setTimeout(() => resolve('timeout'), CANDIDATE_DEADLINE_MS) })
    const outcome = await Promise.race([Promise.allSettled(Array.from({ length: CANDIDATE_COUNT }, (_, i) => runOne(i))), deadline])
    clearTimeout(timer)
    closed = true
    if (outcome === 'timeout') {
      warnings.push(`The AI model took longer than ${Math.round(CANDIDATE_DEADLINE_MS / 1000)}s, so Cupric kept the ${candidates.length} candidate(s) that finished in time.`)
      attempts.push({ generated: false, error: 'deadline reached' })
    }
  } else {
    attempts.push({ generated: false, error: 'no AI model configured, so Cupric AI built-in candidates were used' })
  }

  if (!candidates.length) {
    // Honest fallback: say it out loud, do not dress canned HTML up as a battle.
    fallbackUsed = true
    const reason = attempts.map((a) => a.error || (a.failures || []).join('; ')).filter(Boolean)[0] || 'unknown model error'
    warnings.push(
      `No AI candidate passed the render contract (${reason}). Cupric fell back to its built-in deterministic template — this render was NOT chosen by a model battle.`,
    )
    for (let i = 0; i < CANDIDATE_COUNT; i += 1) {
      const file = path.join(root, `candidate-${i + 1}.html`)
      const html = candidateHtmlForRundown(rundown, i)
      fs.writeFileSync(file, html, 'utf8')
      const verdict = validateCandidateHtml(html, rundown)
      candidates.push({ file, score: verdict.score, generatedBy: 'builtin-template', reasons: verdict.reasons, failures: verdict.failures })
    }
  } else if (candidates.length < CANDIDATE_COUNT) {
    warnings.push(`${CANDIDATE_COUNT - candidates.length} of ${CANDIDATE_COUNT} AI candidates failed to generate or failed validation; the winner was picked from the ${candidates.length} that passed.`)
  }

  candidates.sort((a, b) => b.score - a.score)
  writeJson(path.join(root, 'voting-report.json'), {
    mode: fallbackUsed ? 'builtin-template-fallback' : 'ai-generated-local-scoring',
    repairRoundsAllowed: REPAIR_ROUNDS,
    provider: aiSettings().provider,
    fallbackUsed,
    resourcesUsed: {
      components: resources.components.map((c) => c.id),
      templates: resources.templates.map((t) => t.id),
      sources: resources.sources.map((s) => s.id),
      scenePlan: resources.scenes.map((p) => ({ beat: p.beat, layers: Object.fromEntries(Object.entries(p.layers).map(([k, v]) => [k, v.id])) })),
      searched: resources.searched.total,
    },
    prompt,
    attempts,
    winner: candidates[0].file,
    candidates,
  })
  return { candidates, winnerPath: candidates[0].file, fallbackUsed }
}
async function ingestAutomationFootage(job, root, warnings, state) {
  if (!job.footageFolder) return null
  if (!fs.existsSync(job.footageFolder)) {
    warnings.push(`Footage folder was not found: ${job.footageFolder}`)
    return null
  }
  ffmpegPath = candidateBinaryPath(ffmpegPath) || resolveMediaTool('ffmpeg')
  ffprobePath = candidateBinaryPath(ffprobePath) || resolveMediaTool('ffprobe')
  if (!ffmpegPath || !ffprobePath) {
    warnings.push('Footage ingest skipped because FFmpeg/FFprobe is unavailable. Rendering can still use generated motion candidates if FFmpeg is present.')
    return null
  }
  const videoExt = /\.(mp4|mov|m4v|webm|mkv|avi)$/i
  const files = fs.readdirSync(job.footageFolder).map(name => path.join(job.footageFolder, name)).filter(p => {
    try { return fs.statSync(p).isFile() && videoExt.test(p) } catch { return false }
  })
  files.sort((a, b) => fs.statSync(b).size - fs.statSync(a).size)
  if (!files[0]) {
    warnings.push('No supported video file was found in the footage folder.')
    return null
  }
  ensureAutomationActive(job.id, state)
  const footageRoot = path.join(root, 'footage'); ensureDir(footageRoot)
  const copied = path.join(footageRoot, safeFileName(path.basename(files[0]), 'footage.mp4'))
  fs.copyFileSync(files[0], copied)
  const probe = await probeMedia(copied)
  const settings = publicSettings()
  let silenceRanges = []
  try {
    const silenceResult = await runProcess(state, ffmpegPath, ['-hide_banner', '-i', copied, '-af', `silencedetect=noise=${settings.silenceNoiseDb}dB:d=${settings.silenceMinDuration}`, '-f', 'null', '-'])
    silenceRanges = parseSilence(silenceResult.stderr, probe.durationSec)
  } catch (err) {
    warnings.push(`Silence detection failed: ${err?.message || err}`)
  }
  const sidecar = files[0].replace(/\.[^.]+$/, '.srt')
  const vttSidecar = files[0].replace(/\.[^.]+$/, '.vtt')
  const captions = parseCaptionSidecar(fs.existsSync(sidecar) ? sidecar : vttSidecar)
  const footage = { source: copied, durationSec: probe.durationSec, silenceRanges, captions, status: 'edited', captionStyle: /podcast|short|social/i.test(job.brief) ? 'hormozi' : 'standard', crop: job.aspect }
  writeJson(path.join(root, 'footage-analysis.json'), footage)
  return footage
}
async function openArenaBuilderForPrompt(prompt, extra = {}) {
  const url = 'https://arena.ai/code'
  const text = String(prompt || '').trim()
  let copied = false
  try {
    if (!text) throw new Error('No Arena prompt is available to copy')
    clipboard.writeText(text)
    copied = clipboard.readText() === text
    if (!copied) throw new Error('The Arena prompt could not be verified on the clipboard')
    await shell.openExternal(url)
    logLine('arena-opened', 'Opened Arena builder', { copied, ...extra })
  } catch (err) {
    logLine('arena-open-failed', err?.message || String(err), { copied, ...extra })
    throw new Error(`Could not prepare the manual Arena gate: ${err?.message || err}`)
  }
  return { url, copied }
}

async function renderAutomationMp4(job, root, rundown, winnerPath, footageMeta, warnings, state) {
  ffmpegPath = candidateBinaryPath(ffmpegPath) || resolveMediaTool('ffmpeg')
  if (!ffmpegPath) throw new Error('FFmpeg is unavailable in this build, so Cupric AI cannot render MP4. Set CUPRIC_FFMPEG_PATH or install a build with ffmpeg-static unpacked.')
  const outDir = path.join(userDataPath('renders'), job.id)
  const workDir = path.join(outDir, 'work')
  fs.rmSync(workDir, { recursive: true, force: true })
  ensureDir(workDir); ensureDir(outDir)
  const target = targetSizeForAspect(job.aspect, rundown.size)
  const segments = []
  const arenaDuration = Math.min(MAX_RENDER_DURATION_SEC, Math.max(1, Number(rundown.durationSec) || 12))
  segments.push(await renderArenaSegment(state, {
    sourceType: 'arena',
    arenaPath: winnerPath,
    htmlPath: winnerPath,
    durationSec: arenaDuration,
    captions: rundown.scenes.map(s => ({ start: Math.max(0, Number(s.from) || 0), end: Math.min(arenaDuration, Number(s.to) || arenaDuration), text: s.copy })).filter(c => c.end > c.start),
    captionStyle: 'standard',
  }, { fps: job.fps, quality: job.quality, target, workDir, segmentIndex: segments.length, onUnits: () => {} }))
  if (footageMeta) {
    const footageSegments = await renderFootageSegments(state, {
      sourceType: 'footage',
      videoPath: footageMeta.source,
      durationSec: Math.min(120, footageMeta.durationSec),
      silenceRanges: footageMeta.silenceRanges,
      captions: footageMeta.captions,
      applySilenceCuts: true,
      captionStyle: footageMeta.captionStyle,
      crop: footageMeta.crop,
    }, { fps: job.fps, quality: job.quality, target, workDir, segmentIndex: segments.length, onUnits: () => {} })
    segments.push(...footageSegments)
  }
  if (!segments.length) throw new Error('No renderable media was produced')
  const timeline = segments.map((s, i) => ({ id: `clip-${i + 1}`, startSec: segments.slice(0, i).reduce((n, x) => n + x.duration, 0), durationSec: s.duration, source: s.path }))
  writeJson(path.join(root, 'timeline.json'), timeline)
  writeJson(path.join(root, 'editing-plan.json'), { schema_version: '1.0', project: { target_duration_s: rundown.durationSec, aspect_ratio: job.aspect, fps: job.fps }, sections: [{ role: 'autonomous-edit', clips: timeline.map((clip, i) => ({ id: clip.id, source_file: clip.source, in_s: 0, out_s: clip.durationSec, purpose: i === 0 ? 'generated motion creative' : 'supporting footage edit', transition_in: i === 0 ? 'hard_cut' : 'dissolve', captions: [] })) }], captions: { enabled: true, mode: 'phrase', auto_from_transcript: true } })
  const outputPath = path.join(outDir, `${safeFileName(rundown.title, 'cupric-ai')}.mp4`)
  await concatSegments(state, segments, outputPath, { workDir })
  fs.rmSync(workDir, { recursive: true, force: true })
  if (job.outputFolder) {
    try {
      ensureDir(job.outputFolder)
      const copyPath = path.join(job.outputFolder, path.basename(outputPath))
      await fsp.copyFile(outputPath, copyPath)
      return copyPath
    } catch (err) {
      warnings.push(`Could not copy to output folder: ${err?.message || err}`)
    }
  }
  return outputPath
}

/**
 * Post-render quality gate. This is intentionally mechanical and repeatable:
 * it checks the file that will actually be delivered rather than claiming that
 * a model's HTML score proves visual quality. A failed gate gets one bounded
 * render retry; it never loops forever or fabricates a pass.
 */
async function evaluateAutomationRender(outputPath, job, rundown) {
  const checks = []
  const add = (id, ok, detail, fatal = false) => checks.push({ id, ok: Boolean(ok), detail, fatal })
  const exists = Boolean(outputPath && fs.existsSync(outputPath))
  const bytes = exists ? fs.statSync(outputPath).size : 0
  add('file-exists', exists, exists ? 'MP4 exists at the delivered path' : 'MP4 is missing', true)
  add('file-size', bytes > 4096, `${bytes} bytes`, true)
  if (!exists || bytes <= 4096) return { valid: false, retryable: true, score: 0, checks }

  try {
    const probe = await probeMedia(outputPath)
    const video = probe.streams.find((stream) => stream.codec_type === 'video')
    const target = targetSizeForAspect(job.aspect, rundown.size)
    const duration = Number(probe.durationSec) || 0
    add('video-stream', Boolean(video), video ? `${video.codec_name || 'video'} stream present` : 'no video stream', true)
    add('target-size', Boolean(video && Number(video.width) === target.width && Number(video.height) === target.height), video ? `${video.width}×${video.height}; expected ${target.width}×${target.height}` : 'unknown dimensions', true)
    add('even-dimensions', Boolean(video && Number(video.width) % 2 === 0 && Number(video.height) % 2 === 0), video ? `${video.width}×${video.height} are encoder-safe` : 'unknown dimensions', true)
    const expectedDuration = Math.max(0.5, Number(rundown.durationSec) || 1)
    add('duration', duration >= expectedDuration * 0.85, `${duration.toFixed(2)}s; expected at least ${expectedDuration.toFixed(2)}s`, false)
    add('audio-stream', Boolean(probe.hasAudio), probe.hasAudio ? 'audio stream present' : 'silent render (allowed, but review it)', false)
    const fpsText = String(video?.avg_frame_rate || video?.r_frame_rate || '')
    const [num, den] = fpsText.split('/').map(Number)
    const actualFps = den ? num / den : Number(fpsText)
    add('frame-rate', !actualFps || Math.abs(actualFps - Number(job.fps)) <= 0.5, fpsText ? `${actualFps.toFixed(2)} fps; expected ${job.fps}` : 'frame rate unavailable', false)
    const fatalFailed = checks.filter((check) => check.fatal && !check.ok)
    const passed = checks.filter((check) => check.ok).length
    return {
      valid: fatalFailed.length === 0,
      retryable: fatalFailed.length > 0,
      score: Math.round((passed / checks.length) * 100),
      checks,
      durationSec: duration,
      size: video ? [video.width, video.height] : null,
      hasAudio: Boolean(probe.hasAudio),
    }
  } catch (error) {
    add('ffprobe', false, `Could not inspect the delivered MP4: ${error?.message || String(error)}`, true)
    return { valid: false, retryable: false, score: 0, checks }
  }
}

function generationGuideFor(job, rundown) {
  return {
    renderSpec: { aspect: job.aspect, fps: job.fps, quality: job.quality, durationSec: rundown.durationSec, size: rundown.size },
    sources: [
      { id: 'rundown-copy', type: 'text', description: 'Locked Cupric AI scene copy and timing' },
      { id: 'arena-html', type: 'generated-motion-html', description: 'Single-file HTML with inline CSS/JS and deterministic window.__seek(t)' },
      { id: 'opus55-playbook', type: 'craft-guidance', description: 'Attributed case-study catalogue patterns translated into Cupric-native timing, editability, iteration and QA rules; not model training' },
      ...(job.footageMeta ? [{ id: 'footage', type: 'video', description: 'User-selected footage folder clip analyzed with FFprobe/FFmpeg silence detection' }] : []),
    ],
    sequence: (rundown.scenes || []).map((s, index) => ({ index: index + 1, from: s.from, to: s.to, type: s.type, copy: s.copy, motion: s.motion })),
    generationSteps: [
      'Generate/lock the creative rundown from the brief.',
      'Ask the configured model (Gemini or OpenCode) for several independent single-file HTML motion pieces, each given a different creative direction and the matching entries from the Cupric resource catalogue.',
      'Validate every candidate against the renderer contract (#scene root, deterministic window.__seek(t), self-contained, scene copy present) and score the survivors.',
      'Optionally ingest footage, detect silences, and add captions/crop metadata.',
      'Render HTML frames and footage segments with FFmpeg, then concatenate into the final MP4.',
      'Probe the delivered MP4 for file integrity, target dimensions, even encoder-safe dimensions, duration, frame rate and audio; retry one failed render at most once and report the result.',
      'Preserve the editable rundown, candidate history, source manifest and review report beside the MP4.',
    ],
  }
}

function writeAutomationReview(job, root, rundown, rawWarnings) {
  const warnings = tidyWarnings(rawWarnings)
  const reviewReportPath = path.join(root, 'review-report.json')
  const generationGuide = generationGuideFor(job, rundown)
  const sequenceMd = generationGuide.sequence.map(s => `- ${s.index}. ${s.from}-${s.to}s **${s.type}** — "${s.copy}"; motion: ${s.motion}`).join('\n')
  const sourcesMd = generationGuide.sources.map(s => `- ${s.id} (${s.type}): ${s.description}`).join('\n')
  writeJson(reviewReportPath, { brief: job.brief, mode: job.mode, votingMode: job.votingMode, rundown, outputPath: job.outputPath || null, footageUsed: Boolean(job.footageMeta), generationGuide, renderEvaluation: job.renderEvaluation || null, warnings })
  const evaluation = job.renderEvaluation
  const qaMd = evaluation
    ? `## Delivered render QA\n\nScore: ${evaluation.score ?? 0}/100 · ${evaluation.valid ? 'PASS' : 'REVIEW REQUIRED'}\n\n${(evaluation.checks || []).map((check) => `- ${check.ok ? 'PASS' : 'FAIL'} ${check.id}: ${check.detail}`).join('\n') || '- No checks recorded.'}`
    : '## Delivered render QA\n\n- Not available yet.'
  fs.writeFileSync(path.join(root, 'review-report.md'), `# Cupric AI review report\n\n## Brief\n${job.brief}\n\n## Rundown\n${rundown.title}\n\nVoting mode: ${job.votingMode}\n\nOutput: ${job.outputPath || 'Not rendered yet'}\n\n## Sources\n${sourcesMd}\n\n## Generation sequence\n${sequenceMd}\n\n## How the video is generated\n${generationGuide.generationSteps.map(step => `- ${step}`).join('\n')}\n\n${qaMd}\n\nWarnings:\n${warnings.length ? warnings.map(w => `- ${w}`).join('\n') : '- None'}\n`, 'utf8')
  return reviewReportPath
}
async function runAutomationPipeline(jobId) {
  const state = automationState(jobId)
  state.cancelled = false
  let stepIndex = 0
  let warnings = []
  try {
    let job = ensureAutomationActive(jobId, state)
    warnings = tidyWarnings(Array.isArray(job.warnings) ? job.warnings : [])
    const root = automationRoot(job.id)
    ensureDir(root)

    stepIndex = 0
    if (automationStep(job, 0)?.status !== 'done') {
      startAutomationStep(job.id, 0, 'Project workspace created')
      ensureDir(path.join(root, 'assets'))
      job = finishAutomationStep(job.id, 0, 'Project workspace ready') || job
    }

    stepIndex = 1
    job = ensureAutomationActive(job.id, state)
    let rundown = job.rundown || null
    if (!rundown) {
      startAutomationStep(job.id, 1, 'Drafting instant offline rundown')
      // Build the deterministic first pass immediately. A live polish can
      // replace it later, but neither the job nor the timeline waits on AI.
      rundown = fallbackRundownForJob(job)
      writeJson(path.join(root, 'rundown.json'), rundown)
      job = patchAutomation(job.id, { rundown, rundownPath: path.join(root, 'rundown.json'), warnings }) || job
      sendAutomation('automation:progress', job)
      job = finishAutomationStep(job.id, 1, 'Instant rundown ready; live polish queued') || job
      const capabilityContext = job.remotionPlan
        ? `\n\nREMOTION CAPABILITY PLAN (follow this deterministic plan): template=${job.remotionPlan.template}; font=${job.remotionPlan.font}; skills=${(job.remotionPlan.skills || []).join(', ')}; no remote assets; preview and export must match.`
        : ''
      void generateRundown(`${job.brief}${capabilityContext}`, [], { aspect: job.aspect, fps: job.fps, mode: job.mode })
        .then((polished) => {
          rundown = polished
          const latest = automationJobs().find((item) => item.id === job.id)
          if (latest?.status === 'running') {
            writeJson(path.join(root, 'rundown.json'), polished)
            patchAutomation(job.id, { rundown: polished, rundownPath: path.join(root, 'rundown.json') })
            sendAutomation('automation:progress', automationJobs().find((item) => item.id === job.id))
          }
        })
        .catch((err) => logLine('interactive-rundown-fallback', err?.message || String(err), { jobId: job.id }))
    }

    stepIndex = 2
    job = ensureAutomationActive(job.id, state)
    if (automationStep(job, 2)?.status !== 'done') {
      startAutomationStep(job.id, 2, 'Locking the generated rundown for review and render')
      writeJson(path.join(root, 'rundown.json'), rundown)
      job = patchAutomation(job.id, { rundown, rundownPath: path.join(root, 'rundown.json') }) || job
      sendAutomation('automation:progress', job)
      job = finishAutomationStep(job.id, 2, 'Rundown locked') || job
    }

    stepIndex = 3
    job = ensureAutomationActive(job.id, state)
    if (!job.winnerPath || !Array.isArray(job.candidates)) {
      startAutomationStep(
        job.id,
        3,
        job.votingMode === 'manual-arena'
          ? 'Generating AI review candidates before the manual Arena gate'
          : `Generating ${CANDIDATE_COUNT} AI candidates and scoring them against the render contract`,
      )
      const candidateResult = await writeAutomationCandidates(root, rundown, job, warnings)
      job = patchAutomation(job.id, { candidates: candidateResult.candidates, winnerPath: candidateResult.winnerPath, warnings }) || job
      sendAutomation('automation:progress', job)
    }
    if (isManualArenaGateBlocked(job)) {
      const message = 'Manual Arena review gate: Cupric opened arena.ai/code in your browser and copied the Arena prompt. Paste it there, run the battle/build, vote yourself, download the winning ZIP, then approve this gate to continue. Public voting is never automated.'
      if (!job.arenaOpenedAt) {
        try {
          await openArenaBuilderForPrompt(rundown.arenaPrompt || arenaPromptOf(rundown), { jobId: job.id, source: 'automation' })
          job = patchAutomation(job.id, { arenaOpenedAt: new Date().toISOString() }) || job
        } catch (err) {
          warnings.push(err?.message || String(err))
        }
      }
      // The gate message is status, not a new problem: keep exactly one copy.
      const gateWarnings = warnings.includes(message) ? warnings : warnings.concat(message)
      job.reviewReportPath = writeAutomationReview({ ...job, outputPath: null }, root, rundown, gateWarnings)
      patchAutomation(job.id, { reviewReportPath: job.reviewReportPath, warnings: gateWarnings })
      waitAutomationStep(job.id, 3, message)
      return
    }
    job = finishAutomationStep(job.id, 3, job.votingMode === 'manual-arena' ? 'Manual gate approved' : 'Winner selected from the AI candidate battle') || job
    if (job.votingMode === 'manual-arena') {
      logLine('automation-gate-resumed', 'Manual Arena approval advanced to footage/timeline stages', { jobId: job.id, nextStep: 4 })
    }

    stepIndex = 4
    job = ensureAutomationActive(job.id, state)
    let footageMeta = job.footageMeta || null
    if (automationStep(job, 4)?.status !== 'done') {
      startAutomationStep(job.id, 4, job.footageFolder ? 'Analyzing footage folder' : 'No footage folder supplied; using generated creative')
      footageMeta = await ingestAutomationFootage(job, root, warnings, state)
      job = patchAutomation(job.id, { footageMeta, warnings }) || job
      job = finishAutomationStep(job.id, 4, footageMeta ? 'Footage analyzed' : 'Footage skipped') || job
    }

    stepIndex = 5
    job = ensureAutomationActive(job.id, state)
    if (automationStep(job, 5)?.status !== 'done') {
      startAutomationStep(job.id, 5, 'Building timeline and edit plan')
      writeJson(path.join(root, 'timeline-plan.json'), { winnerPath: job.winnerPath, footage: footageMeta, aspect: job.aspect, fps: job.fps, quality: job.quality })
      job = finishAutomationStep(job.id, 5, 'Timeline built') || job
    }

    stepIndex = 6
    job = ensureAutomationActive(job.id, state)
    if (!job.outputPath) {
      startAutomationStep(job.id, 6, 'Rendering MP4')
      const outputPath = await renderAutomationMp4(job, root, rundown, job.winnerPath, footageMeta, warnings, state)
      job = patchAutomation(job.id, { outputPath, warnings }) || job
      sendAutomation('automation:progress', job)
      job = finishAutomationStep(job.id, 6, 'MP4 rendered') || job
    } else {
      job = finishAutomationStep(job.id, 6, 'MP4 already rendered') || job
    }

    stepIndex = 7
    job = ensureAutomationActive(job.id, state)
    if (automationStep(job, 7)?.status !== 'done') {
      startAutomationStep(job.id, 7, 'Evaluating the delivered MP4 and checking whether one bounded retry is needed')
      let renderEvaluation = job.renderEvaluation || null
      if (!renderEvaluation) {
        renderEvaluation = await evaluateAutomationRender(job.outputPath, job, rundown)
        if (!renderEvaluation.valid && renderEvaluation.retryable) {
          warnings.push('The delivered MP4 failed a mechanical render gate; Cupric performed one bounded re-render before reporting the result.')
          const retryOutputPath = await renderAutomationMp4(job, root, rundown, job.winnerPath, footageMeta, warnings, state)
          job = patchAutomation(job.id, { outputPath: retryOutputPath }) || job
          renderEvaluation = await evaluateAutomationRender(retryOutputPath, job, rundown)
        }
        if (!renderEvaluation.valid) warnings.push('Delivered MP4 needs review: the mechanical render gate did not pass all required checks. No quality pass was fabricated.')
        job = patchAutomation(job.id, { renderEvaluation, warnings }) || job
      }
      const reviewReportPath = writeAutomationReview(job, root, rundown, warnings)
      job = patchAutomation(job.id, { reviewReportPath, warnings }) || job
      job = finishAutomationStep(job.id, 7, renderEvaluation.valid ? 'Render QA passed; review report ready' : 'Review report ready with QA warnings') || job
    }

    const done = patchAutomation(job.id, { status: 'done', currentStepId: null, waitingMessage: null, warnings })
    sendAutomation('automation:done', done)
  } catch (err) {
    if (/Automation cancelled/i.test(err?.message || String(err))) {
      const cancelled = patchAutomation(jobId, { status: 'cancelled', currentStepId: null })
      sendAutomation('automation:progress', cancelled)
    } else {
      failAutomation(jobId, err, stepIndex)
    }
  } finally {
    const latest = automationJobs().find(j => j.id === jobId)
    if (latest?.status !== 'waiting-for-user') automationRunStates.delete(jobId)
  }
}

ipcMain.handle('automation:list', () => automationJobs())
ipcMain.handle('automation:get', (_e, p) => automationJobs().find(j => j.id === p?.jobId) || null)
ipcMain.handle('automation:start', async (_e, job) => {
  const existing = automationJobs().filter(j => j.id !== job.id)
  const normalized = { ...job, status: 'running', errorMessage: null, waitingMessage: null, warnings: [], updatedAt: new Date().toISOString() }
  saveAutomationJobs([normalized, ...existing])
  setTimeout(() => { void runAutomationPipeline(job.id) }, 0)
  return normalized
})
ipcMain.handle('automation:cancel', (_e, p) => {
  stopAutomationState(p?.jobId)
  const latest = automationJobs().find(j => j.id === p?.jobId)
  const steps = latest?.steps?.map(step => step.status === 'running' || step.status === 'waiting-for-user' ? { ...step, status: 'cancelled', message: 'Cancelled' } : step)
  return patchAutomation(p?.jobId, { status: 'cancelled', currentStepId: null, steps })
})
ipcMain.handle('automation:resume', (_e, p) => {
  const job = patchAutomation(p?.jobId, { status: 'running', errorMessage: null, waitingMessage: null })
  if (job) setTimeout(() => { void runAutomationPipeline(job.id) }, 0)
  return job
})
ipcMain.handle('automation:approveStep', (_e, p) => {
  const latest = automationJobs().find(j => j.id === p?.jobId)
  const approved = approveManualArenaGate(latest, p?.stepId)
  const job = patchAutomation(p?.jobId, approved)
  // Resume on a fresh task: approval returns to the caller immediately, while
  // the same persisted job continues at step 4 rather than re-entering gate 3.
  setTimeout(() => { void runAutomationPipeline(job.id) }, 0)
  return job
})
ipcMain.handle('automation:rejectStep', (_e, p) => {
  stopAutomationState(p?.jobId)
  return patchAutomation(p?.jobId, { status: 'error', currentStepId: null, errorMessage: 'Step rejected during review' })
})
ipcMain.handle('automation:setWatchedFolder', (_e, p) => p?.folder || null)
ipcMain.handle('automation:setOutputFolder', (_e, p) => p?.folder || null)
ipcMain.handle('automation:openOutput', (_e, p) => { if (p?.outputPath) shell.showItemInFolder(p.outputPath); return true })

// ---------------------------------------------------------------------------
// Gemini IPC
// ---------------------------------------------------------------------------

/**
 * Pull the JSON object out of whatever a model wrote around it.
 *
 * Models wrap JSON in fences, prefix it with "Sure! Here is…", leave trailing
 * commas, use smart quotes, or emit <think>…</think> blocks first. Each of
 * those used to surface as "The reply came back malformed". This finds the
 * first balanced object, repairs the common slips, and only then gives up.
 */
function firstBalancedObject(raw) {
  const start = raw.indexOf('{')
  if (start < 0) return null
  let depth = 0
  let inString = false
  let escaped = false
  for (let i = start; i < raw.length; i += 1) {
    const ch = raw[i]
    if (inString) {
      if (escaped) escaped = false
      else if (ch === '\\') escaped = true
      else if (ch === '"') inString = false
      continue
    }
    if (ch === '"') inString = true
    else if (ch === '{') depth += 1
    else if (ch === '}') {
      depth -= 1
      if (depth === 0) return raw.slice(start, i + 1)
    }
  }
  return null
}

function parseJsonFromModel(text) {
  const raw = String(text || '')
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2018\u2019]/g, "'")
    .trim()
  const fence = raw.match(/```(?:json|JSON)?\s*([\s\S]*?)```/)
  const candidates = [fence?.[1], firstBalancedObject(fence?.[1] || ''), firstBalancedObject(raw), raw].filter(Boolean)
  let lastError
  for (const candidate of candidates) {
    for (const attempt of [candidate, candidate.replace(/,(\s*[}\]])/g, '$1'), stripJsonComments(candidate).replace(/,(\s*[}\]])/g, '$1')]) {
      try {
        return JSON.parse(attempt)
      } catch (err) {
        lastError = err
      }
    }
  }
  const error = new Error(`Model reply is not valid JSON (${lastError?.message || 'no object found'})`)
  error.code = 'BAD_JSON'
  throw error
}

function clampNumber(value, min, max, fallback) {
  const n = Number(value)
  return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback
}

function uid(prefix = 'id') {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

function sceneSequenceLines(rundown) {
  return (rundown.scenes || [])
    .map((s, index) => `${index + 1}. ${s.from}-${s.to}s | ${String(s.type || 'scene').toUpperCase()} | on-screen copy: "${s.copy}" | motion: ${s.motion}`)
    .join('\n')
}

function arenaPromptOf(rundown) {
  return `Build a SINGLE FILE index.html motion-graphics piece for Cupric AI to capture as video.

HARD CONSTRAINTS:
- Return only the final index.html code.
- One file only: inline CSS and inline JavaScript, no build step.
- Root element must be #scene exactly ${rundown.size[0]}x${rundown.size[1]} px.
- Duration is exactly ${rundown.durationSec}s at ${rundown.fps}fps.
- Implement window.__seek(t). Every frame must be a pure deterministic function of t.
- No CSS animations, no setTimeout, no request-based randomness, no Math.random in the frame loop.
- Do not fetch remote assets. Do not rely on external fonts, CDNs, images, audio, or video.

SOURCE / ASSET PLAN:
- Visual sources are generated inside this HTML: typography, CSS/SVG shapes, gradients, grids, counters, masks, and light texture.
- Text source is the scene copy below; keep spelling exact unless making tiny line-break changes for layout.
- If you need icons or marks, draw them with inline SVG/CSS only.
- Include window.__cupricSourceManifest = { sources, sequence, renderSpec } so Cupric AI can inspect how the video was generated.

STYLE:
${rundown.style}

OPUS CASE-STUDY CRAFT POLICY — apply these production heuristics to the scene while obeying the HTML-only contract above. This is a local Cupric playbook, not model training and not evidence about the original case authors:
${ADVANCED_VIDEO_PLAYBOOK_PROMPT}

SEQUENCE / TIMELINE:
${sceneSequenceLines(rundown)}

DEPTH — USE CSS 3D, NOT A 3D LIBRARY:
- There is no WebGL and no Three.js here: one file, no bundler, nothing to import. Depth comes from CSS 3D transforms, which cost nothing and stay deterministic.
- Put \`perspective: 1200px\` on a wrapper and \`transform-style: preserve-3d\` on the group you are moving.
- Compose depth with translate3d/rotateX/rotateY/rotateZ driven by t — e.g. cards that turn as they enter, a title plane that settles from rotateX(12deg), layers parallaxing at different translateZ.
- Every transform must be written from inside __seek(t). Do not use CSS @keyframes or transitions: they run on the wall clock and will tear when the renderer steps frame by frame.
- Sort overlapping 3D layers explicitly with translateZ; do not rely on z-index alone once preserve-3d is on.

IMPLEMENTATION NOTES:
- At t=0 the first scene must be visible and valid.
- All scene transitions must happen according to the timeline above. Automatically choose a visible but restrained transition for every boundary (mask wipe, depth push, lens sweep, blur-through or dissolve); do not repeat one transition throughout.
- Automatically identify one meaningful keyword in each short scene and give it a separate span, accent colour, weight or reveal timing. Never highlight filler words.
- Build a complete effects pass into __seek(t): subtle grain or grid depth, foreground/background parallax, scene-specific text reveals, and entrance/settle/exit states. Effects must be pure functions of clip-local progress and must settle before copy needs to be read.
- Use safe-area margins and responsive scaling inside the fixed #scene canvas.
- Expose clear variables for duration, fps, scenes, sourceManifest, effectForScene(index), and transitionForBoundary(index).
- The piece should look like a finished video, not a placeholder: polished typography, automatic keyword highlighting, motion hierarchy, background design, coherent effects, and a final hold.`
}

function normalizeRundown(candidate, briefText) {
  const durationSec = Math.round(clampNumber(candidate?.durationSec, 1, MAX_RENDER_DURATION_SEC, 12) * 10) / 10
  const fps = Number(candidate?.fps) === 60 ? 60 : 30
  const size = Array.isArray(candidate?.size) && candidate.size.length >= 2
    ? [Math.round(clampNumber(candidate.size[0], 240, 4096, 1920)), Math.round(clampNumber(candidate.size[1], 240, 4096, 1080))]
    : [1920, 1080]
  const scenes = Array.isArray(candidate?.scenes)
    ? candidate.scenes.slice(0, 12).map((scene, index) => ({
        id: String(scene?.id || uid('scene')),
        from: Math.round(clampNumber(scene?.from, 0, durationSec, index === 0 ? 0 : (durationSec / 3) * index) * 10) / 10,
        to: Math.round(clampNumber(scene?.to, 0.1, durationSec, durationSec) * 10) / 10,
        type: String(scene?.type || (index === 0 ? 'hook' : 'beat')).slice(0, 40),
        copy: String(scene?.copy || briefText || 'Cupric AI').slice(0, 180),
        motion: String(scene?.motion || 'ease-out type reveal').slice(0, 220),
      }))
    : []
  const safeScenes = scenes.length
    ? scenes.map((s) => ({ ...s, to: Math.max(s.from + 0.1, s.to) }))
    : [{ id: uid('scene'), from: 0, to: durationSec, type: 'hook', copy: briefText || 'Cupric AI', motion: 'bold type reveal, subtle parallax' }]
  const rundown = {
    title: String(candidate?.title || `${String(briefText || 'Cupric AI').slice(0, 48)} — ${durationSec}s motion piece`),
    durationSec,
    fps,
    size,
    style: String(candidate?.style || 'Kinetic type on near-black, one lime accent, deterministic ease-out motion'),
    scenes: safeScenes,
    arenaPrompt: '',
  }
  rundown.arenaPrompt = arenaPromptOf(rundown)
  return rundown
}

function geminiRundownPrompt(prompt, history, rundownContext) {
  return `You are Cupric AI's creative director. Return STRICT JSON only, no markdown, matching exactly this TypeScript shape:
{"title":string,"durationSec":number,"fps":30|60,"size":[number,number],"style":string,"scenes":[{"id":string,"from":number,"to":number,"type":string,"copy":string,"motion":string}],"arenaPrompt":string}

Rules:
- Total duration must be 1-120 seconds.
- Prefer 1920x1080 unless the brief asks square or vertical.
- The scenes must cover the duration in timeline order.
- The arenaPrompt value must be a complete Arena build brief: hard constraints, source/asset plan, exact sequence/timeline, style, and implementation notes. It must require a single index.html with inline CSS/JS and window.__seek(t).

Brief: ${prompt}
History: ${JSON.stringify(history || [])}
Current rundown/context: ${JSON.stringify(rundownContext || {})}`
}

function isLocalModelBase(baseUrl) {
  return /^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])/i.test(String(baseUrl || ''))
}

function isFreeModel(model) {
  const id = String(model?.id || '')
  if (id.includes(':free')) return true
  const pricing = model?.pricing || {}
  const values = [pricing.prompt, pricing.completion, pricing.request, pricing.image]
  return values.length > 0 && values.every((value) => value === undefined || Number(value) === 0)
}

async function listOpenCodeModels(payload = {}) {
  const cfg = aiSettings()
  const baseUrl = String(payload.baseUrl || cfg.openCodeBaseUrl || '').trim()
  const apiKey = String(payload.apiKey || cfg.openCodeApiKey || resolveOpenCodeApiKey(baseUrl, payload.model || cfg.openCodeModel) || '').trim()
  if (!baseUrl) throw new Error('OpenCode/OpenAI-compatible base URL is not configured')
  const headers = {}
  if (apiKey) headers.authorization = `Bearer ${apiKey}`
  if (/openrouter\.ai/i.test(baseUrl)) {
    headers['HTTP-Referer'] = 'https://cupric.ai'
    headers['X-Title'] = 'Cupric AI'
  }
  const result = await fetch(`${baseUrl.replace(/\/$/, '')}/models`, { headers })
  if (!result.ok) throw new Error(`Model list failed (${result.status}): ${(await result.text()).slice(0, 500)}`)
  const data = await result.json()
  const rawModels = Array.isArray(data?.data) ? data.data : Array.isArray(data?.models) ? data.models : []
  const local = isLocalModelBase(baseUrl)
  return rawModels
    .filter((model) => local || isFreeModel(model))
    .map((model) => {
      const id = String(model?.id || model?.name || '')
      const label = String(model?.name || id).replace(/\s*\(?free\)?\s*$/i, '')
      return { id: `live-${id}`, label, baseUrl, model: id, note: local ? 'Local OpenCode/Ollama model discovered from your machine.' : 'Free model discovered from the configured model endpoint.' }
    })
    .filter((model) => model.model)
    .slice(0, 200)
}

async function probeOpenCodeModel(baseUrl, apiKey, model) {
  try {
    const response = await fetch(`${normalizedBaseUrl(baseUrl)}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(AI_DISCOVERY_TIMEOUT_MS),
      body: JSON.stringify({ model, messages: [{ role: 'user', content: 'Reply with one word: OK' }], max_tokens: 1, temperature: 0, stream: false }),
    })
    return response.ok
  } catch { return false }
}

ipcMain.handle('opencode:listModels', (_event, payload) => listOpenCodeModels(payload || {}))
ipcMain.handle('opencode:discoverModels', () => discoverOpenCodeConfiguredModels())

function classifyGeminiError(err) {
  const message = String(err?.message || err || '')
  if (/401|403|api key|unauthorized|permission denied|invalid argument/i.test(message)) return { category: 'wrong-key', message: 'Gemini rejected this key. Check that it is a Google AI Studio key with Generative Language API access.' }
  if (/429|quota|resource_exhausted|rate.?limit/i.test(message)) return { category: 'quota', message: 'The key is valid, but this Gemini model is out of quota for now.' }
  if (/503|overload|high demand|unavailable/i.test(message)) return { category: 'high-demand', message: 'Gemini is temporarily at high demand. Cupric will retry, then use the next provider.' }
  if (/404|not found|deprecated|no longer available/i.test(message)) return { category: 'model-missing', message: 'That Gemini model is no longer available. Cupric will use gemini-2.5-flash.' }
  return { category: 'network', message: message.slice(0, 360) || 'Gemini could not be reached.' }
}

async function listGeminiModels(key = geminiApiKey()) {
  const token = String(key || '').trim()
  if (!token) throw new Error('Gemini model refresh needs a key. Choose Auto or paste a Gemini key in Settings.')
  const response = await fetchOrExplain(`https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(token)}`, { signal: AbortSignal.timeout(5000) })
  if (!response.ok) throw new Error(`Gemini model list failed (${response.status}): ${(await response.text()).slice(0, 300)}`)
  const data = await response.json()
  return (Array.isArray(data?.models) ? data.models : [])
    .filter((model) => Array.isArray(model?.supportedGenerationMethods) && model.supportedGenerationMethods.includes('generateContent'))
    .filter((model) => !/deprecated|embedding|aqa|robotics/i.test(String(model?.name || model?.displayName || '')))
    .map((model) => ({
      id: String(model.name || '').replace(/^models\//, ''),
      label: String(model.displayName || model.name || '').replace(/^models\//, ''),
      inputTokenLimit: model.inputTokenLimit,
      outputTokenLimit: model.outputTokenLimit,
    }))
    .filter((model) => model.id)
}

ipcMain.handle('gemini:listModels', (_event, payload = {}) => listGeminiModels(payload.apiKey || geminiApiKey()))
ipcMain.handle('ai:testConnection', async (_event, payload = {}) => {
  const provider = payload.provider === 'opencode' ? 'opencode' : 'gemini'
  const started = Date.now()
  try {
    if (provider === 'opencode') {
      const models = await listOpenCodeModels({ baseUrl: payload.baseUrl, apiKey: payload.apiKey, model: payload.model })
      return { ok: true, provider, latencyMs: Date.now() - started, category: 'ok', message: `Connected · ${models.length} free/local model${models.length === 1 ? '' : 's'} visible` }
    }
    const key = String(payload.apiKey || geminiApiKey() || '').trim()
    if (!key) throw new Error('Gemini needs a key in manual mode. Choose Auto or paste a Gemini key in Settings.')
    const modelName = String(payload.model || geminiModel()).trim() || DEFAULT_GEMINI_MODEL
    const model = new GoogleGenerativeAI(key).getGenerativeModel({ model: modelName, generationConfig: { maxOutputTokens: 1 } })
    await model.generateContent('Reply OK')
    return { ok: true, provider, latencyMs: Date.now() - started, category: 'ok', message: `Connected to ${modelName}` }
  } catch (err) {
    const classified = provider === 'gemini' ? classifyGeminiError(err) : { category: 'network', message: err?.message || String(err) }
    if (provider === 'gemini' && classified.category === 'model-missing') {
      const settings = readSettings()
      settings.geminiModel = DEFAULT_GEMINI_MODEL
      writeSettings(settings)
      classified.message = `${classified.message} Saved default: ${DEFAULT_GEMINI_MODEL}.`
    }
    return { ok: false, provider, latencyMs: Date.now() - started, ...classified }
  }
})

/**
 * Why a fetch failed, in words. Node's fetch throws a bare "fetch failed" and
 * hides ECONNREFUSED / ENOTFOUND in `cause`, which is why a stopped local
 * OpenCode server used to be reported as "Cupric could not reach the network".
 */
async function fetchOrExplain(url, init) {
  try {
    return await fetch(url, init)
  } catch (err) {
    if (err?.name === 'TimeoutError' || err?.name === 'AbortError') throw new Error(`Request to ${new URL(url).origin} timed out`)
    const code = err?.cause?.code || err?.code || ''
    const origin = (() => { try { return new URL(url).origin } catch { return url } })()
    const why = code === 'ECONNREFUSED'
      ? 'is not running (connection refused)'
      : code === 'ENOTFOUND' || code === 'EAI_AGAIN'
        ? 'could not be found (DNS / offline)'
        : `could not be reached${code ? ` (${code})` : ''}`
    throw new Error(`fetch failed: ${origin} ${why}`)
  }
}

async function callOpenCode(messages, options = {}) {
  const cfg = { ...aiSettings(), ...(options.override || {}) }
  if (!cfg.openCodeBaseUrl) throw new Error('OpenCode/OpenAI-compatible base URL is not configured')
  const inheritedKey = resolveOpenCodeApiKey(cfg.openCodeBaseUrl, cfg.openCodeModel)
  const apiKey = cfg.openCodeApiKey || inheritedKey
  if (!apiKey && !isLocalModelBase(cfg.openCodeBaseUrl)) {
    throw new Error('This remote provider needs a key. Choose Auto for a local model, or save a key in Settings.')
  }
  const baseUrl = normalizedBaseUrl(cfg.openCodeBaseUrl)
  const url = `${baseUrl}/chat/completions`
  const headers = { 'content-type': 'application/json' }
  if (/openrouter\.ai/i.test(cfg.openCodeBaseUrl)) {
    headers['HTTP-Referer'] = 'https://cupric.ai'
    headers['X-Title'] = 'Cupric AI'
  }
  if (apiKey) headers.authorization = `Bearer ${apiKey}`
  const body = {
    model: cfg.openCodeModel,
    messages,
    temperature: options.temperature ?? 0.55,
    stream: false,
    ...(options.json ? { response_format: { type: 'json_object' } } : {}),
  }
  let result = await fetchOrExplain(url, {
    method: 'POST',
    headers,
    signal: AbortSignal.timeout(options.timeoutMs ?? 30_000),
    body: JSON.stringify(body),
  })
  // Plenty of local servers reject response_format; ask again without it
  // rather than failing a request that would otherwise work.
  if (!result.ok && options.json && (result.status === 400 || result.status === 422)) {
    delete body.response_format
    result = await fetchOrExplain(url, { method: 'POST', headers, signal: AbortSignal.timeout(options.timeoutMs ?? 30_000), body: JSON.stringify(body) })
  }
  if (!result.ok) throw new Error(`OpenCode model ${cfg.openCodeModel} at ${baseUrl} failed (${result.status}): ${(await result.text()).slice(0, 600)}`)
  const data = await result.json()
  const content = data?.choices?.[0]?.message?.content ?? data?.message?.content ?? data?.choices?.[0]?.text ?? ''
  const text = Array.isArray(content) ? content.map((part) => part?.text || '').join('') : String(content || '')
  if (!text.trim()) throw new Error('OpenCode model returned an empty response')
  return text
}

// ——— provider routing, quota awareness and fallback ————————————————————————

/**
 * Models that just told us they are out of quota, and until when.
 *
 * Retrying a 429 three times with backoff — what the old code did — burns the
 * free tier faster and still fails. A per-model cooldown means the next
 * request goes straight to a model that can answer.
 */
const aiCooldowns = new Map()

function isQuotaError(err) {
  return /\b429\b|too many requests|quota|rate.?limit|resource_exhausted/i.test(err?.message || String(err))
}

function quotaCooldownMs(err) {
  const message = err?.message || String(err)
  if (/PerDay|per day|daily/i.test(message)) return 60 * 60 * 1000
  const m = message.match(/retry in\s+([\d.]+)\s*s/i) || message.match(/retryDelay\W+([\d.]+)s/i)
  return Math.min(10 * 60 * 1000, Math.max(15_000, (m ? Number(m[1]) + 2 : 60) * 1000))
}

function coolingDown(key) {
  const entry = aiCooldowns.get(key)
  if (!entry) return false
  if (Date.now() >= entry.until) {
    aiCooldowns.delete(key)
    return false
  }
  return true
}

function geminiModelCandidates() {
  const seen = new Set()
  return [geminiModel(), ...GEMINI_FALLBACK_MODELS]
    .map((model) => String(model || '').trim())
    .filter((model) => model && !seen.has(model) && seen.add(model))
}

/**
 * Try every Gemini model in turn. Each model has its own free-tier bucket, so
 * a 429 on one is a reason to move to the next, not to stop.
 */
async function runGeminiGenerateContent(key, prompt, generationConfig) {
  let lastError
  const candidates = geminiModelCandidates()
  const ready = candidates.filter((model) => !coolingDown(`gemini:${model}`))
  if (!ready.length) {
    const soonest = Math.min(...candidates.map((model) => aiCooldowns.get(`gemini:${model}`)?.until || Date.now()))
    const error = new Error(`429 quota: every Gemini model (${candidates.join(', ')}) is rate-limited; retry in ${Math.max(1, Math.round((soonest - Date.now()) / 1000))}s`)
    error.code = 'QUOTA'
    throw error
  }
  for (const modelName of ready) {
    try {
      const model = new GoogleGenerativeAI(key).getGenerativeModel({ model: modelName, ...(generationConfig ? { generationConfig } : {}) })
      const result = await model.generateContent(prompt)
      result.modelName = modelName
      return result
    } catch (err) {
      lastError = err
      const message = err?.message || String(err)
      logLine('gemini-model-failed', message.slice(0, 400), { model: modelName })
      if (isQuotaError(err)) {
        aiCooldowns.set(`gemini:${modelName}`, { until: Date.now() + quotaCooldownMs(err), reason: 'quota' })
        continue
      }
      if (/404|not found|no longer available|not available|not supported|invalid model/i.test(message)) {
        aiCooldowns.set(`gemini:${modelName}`, { until: Date.now() + 6 * 60 * 60 * 1000, reason: 'missing' })
        if (modelName === geminiModel()) {
          const settings = readSettings()
          settings.geminiModel = DEFAULT_GEMINI_MODEL
          writeSettings(settings)
        }
        continue
      }
      if (/\b5\d\d\b|overload|unavailable|high demand|timed out|timeout/i.test(message)) continue
      break
    }
  }
  throw lastError
}

/** Local OpenAI-compatible servers worth probing when nothing else answers. */
// Same order as freeBrain.LOCAL_PROBE_ORDER: OpenCode → Ollama → LM Studio → :8080.
const LOCAL_AI_ENDPOINTS = [
  'http://localhost:4096/v1',
  'http://localhost:11434/v1',
  'http://localhost:1234/v1',
  'http://127.0.0.1:8080/v1',
  'http://127.0.0.1:1337/v1',
]
let localAiCache = { at: 0, found: null }

async function discoverRunningLocalModel() {
  if (Date.now() - localAiCache.at < 60_000) return localAiCache.found
  const configured = normalizedBaseUrl(aiSettings().openCodeBaseUrl)
  const probes = LOCAL_AI_ENDPOINTS.filter((base) => base !== configured).map(async (base) => {
    const response = await fetch(`${base}/models`, { signal: AbortSignal.timeout(900) })
    if (!response.ok) throw new Error(String(response.status))
    const data = await response.json()
    const models = (Array.isArray(data?.data) ? data.data : Array.isArray(data?.models) ? data.models : [])
      .map((m) => String(m?.id || m?.name || m?.model || ''))
      .filter((id) => id && !/embed|whisper|tts|rerank/i.test(id))
    if (!models.length) throw new Error('no chat models')
    return { baseUrl: base, model: models[0] }
  })
  const settled = await Promise.allSettled(probes)
  const found = settled.find((r) => r.status === 'fulfilled')?.value || null
  localAiCache = { at: Date.now(), found }
  return found
}

/**
 * The ordered list of things that can answer right now: the chosen provider,
 * then the other one, then any local model server that happens to be running.
 */
async function aiRoutes(task = 'draft') {
  let cfg = aiSettings()
  const taskModel = String(readSettings()[`${task}Model`] || '').trim()
  let discovered = null
  if (cfg.mode === 'auto') {
    discovered = await autoDiscover().catch(() => null)
    cfg = aiSettings()
  }
  const routes = []
  const seen = new Set()
  const add = (route) => {
    const key = `${route.provider}|${route.override?.openCodeBaseUrl || cfg.openCodeBaseUrl}|${route.override?.openCodeModel || cfg.openCodeModel}`
    if (seen.has(key)) return
    seen.add(key)
    routes.push(route)
  }
  const addLocal = (entry) => {
    if (!entry?.baseUrl || !entry?.models?.[0]) return
    add({ provider: 'opencode', label: `${entry.label} · ${entry.models[0]}`, override: { openCodeBaseUrl: entry.baseUrl, openCodeModel: entry.models[0], openCodeApiKey: '' } })
  }

  const addGemini = () => { if (geminiApiKey()) add({ provider: 'gemini', label: `Gemini · ${geminiModel()}` }) }
  const addConfigured = () => {
    const selectedModel = taskModel || cfg.openCodeModel
    if (cfg.openCodeBaseUrl && selectedModel && hasOpenCodeAccess() && !coolingDown(`opencode:${cfg.openCodeBaseUrl}|${selectedModel}`)) {
      add({ provider: 'opencode', label: `${cfg.mode === 'zen' ? 'Zen Free' : 'OpenCode'} · ${selectedModel}`, override: taskModel ? { openCodeModel: selectedModel } : undefined })
    }
  }

  const addZen = (source) => {
    const zen = source?.pick?.kind === 'zen' ? source.pick : null
    if (zen) add({ provider: 'opencode', label: `Zen Free · ${zen.model}`, override: { openCodeBaseUrl: zen.baseUrl, openCodeModel: zen.model, openCodeApiKey: zen.apiKey } })
  }
  const addLocalKind = (source, wanted) => {
    for (const entry of source?.local || []) {
      if (wanted === 'ollama' && entry.kind !== 'ollama') continue
      if (wanted === 'lmstudio' && !['lmstudio', 'local-1337'].includes(entry.kind)) continue
      addLocal(entry)
    }
  }
  const fallbackOrder = Array.isArray(readSettings().fallbackOrder) ? readSettings().fallbackOrder : ['gemini', 'zen', 'ollama', 'lmstudio', 'template']
  const addDiscoveredFallbacks = (source) => {
    for (const kind of fallbackOrder) {
      if (kind === 'gemini') addGemini()
      else if (kind === 'zen') addZen(source)
      else if (kind === 'ollama' || kind === 'lmstudio') addLocalKind(source, kind)
    }
  }

  // Auto first adds the discovered OpenCode/Desktop pick, then honours the
  // user's reorderable fallback list. Explicit Gemini keeps Gemini first but
  // still gets exactly the same auto chain after a 429/503.
  if (cfg.mode === 'auto') {
    addConfigured()
    addDiscoveredFallbacks(discovered)
  } else if (cfg.mode === 'gemini') {
    addGemini()
    const fallback = await autoDiscover({ force: true }).catch(() => null)
    addDiscoveredFallbacks(fallback)
  } else if (cfg.mode !== 'template') {
    addConfigured()
    const fallback = await autoDiscover({ force: true }).catch(() => null)
    addDiscoveredFallbacks(fallback)
  }
  // Keep one last local probe for fallback cases where a configured desktop
  // provider was selected before the local scan ran.
  const local = await discoverRunningLocalModel().catch(() => null)
  if (local) add({ provider: 'opencode', label: `Local · ${local.model}`, override: { openCodeBaseUrl: local.baseUrl, openCodeModel: local.model, openCodeApiKey: '' } })
  return routes
}

/**
 * One completion from whichever route can answer, within a deadline.
 *
 * `images` are `{ mimeType, data(base64) }`; they go to Gemini as inline data
 * and to OpenAI-compatible servers as image_url parts. With `json`, a reply
 * that does not parse gets exactly one stricter repair round on the same route
 * before moving on.
 */
/* ——— zero-setup brain wiring (free-brain.cjs) ——————————————————————— */

const brainCooldowns = freeBrain.createCooldowns()
/**
 * F-1 — endpoint health. Two failures inside 5 minutes quarantine a route for
 * 15 minutes; Settings shows it red; a cheap probe restores it automatically
 * with one quiet toast. Keys never enter this map — only `baseUrl|model`.
 */
const routeHealth = freeBrain.createHealthLedger()
let routeProbeTimer = null
let brainLocalsCache = { at: 0, locals: [] }

function healthRows() {
  return routeHealth.entries().map((row) => ({
    key: row.key,
    label: row.label,
    unhealthy: row.unhealthy,
    until: row.until,
    reason: row.reason,
    failures: row.failures,
  }))
}

function sendHealth() {
  try { mainWindow?.webContents.send('ai:health', { routes: healthRows(), at: Date.now() }) } catch {}
}

/** Route → the URL a health probe can hit without spending a completion. */
function routeProbeUrl(route) {
  if (route?.provider === 'keyless') return route.brain?.modelsUrl || `${normalizedBaseUrl(route.brain?.baseUrl || '')}/models`
  if (route?.provider === 'gemini') return 'https://generativelanguage.googleapis.com/v1beta/models'
  const cfg = { ...aiSettings(), ...(route?.override || {}) }
  return `${normalizedBaseUrl(cfg.openCodeBaseUrl)}/models`
}

/** key → the URL a probe can hit; recorded when a route first misbehaves. */
const routeProbeUrls = new Map()

/**
 * One failure against one route. Two inside 5 minutes quarantine it for 15,
 * which the routing then skips and Settings shows red.
 */
function noteRouteFailure(route, reason) {
  const key = routeKey(route)
  routeProbeUrls.set(key, routeProbeUrl(route))
  const state = routeHealth.fail(key, { label: route.label, reason })
  if (state.unhealthy) {
    logLine('ai-route-unhealthy', `${route.label} paused for ${Math.round((state.until - Date.now()) / 60_000)} min`, { reason })
    scheduleHealthProbes()
  }
  sendHealth()
  return state
}

/**
 * Recovery. Every 60 s, quietly GET the endpoint's model list for each
 * quarantined route; the first 2xx restores it and says so once. No dialogs,
 * no user action, no completion spent.
 */
function scheduleHealthProbes() {
  if (routeProbeTimer) return
  routeProbeTimer = setInterval(() => {
    const queue = routeHealth.probeQueue()
    if (!queue.length) {
      clearInterval(routeProbeTimer)
      routeProbeTimer = null
      return
    }
    for (const key of queue) {
      const url = routeProbeUrls.get(key)
      if (!url) { routeHealth.ok(key); sendHealth(); continue }
      routeHealth.markProbing(key, true)
      void fetch(url, { signal: AbortSignal.timeout(freeBrain.HEALTH_PROBE_MS) })
        .then((res) => {
          if (!res.ok) throw new Error(String(res.status))
          const restored = routeHealth.ok(key)
          brainCooldowns.set(key, 0, 'recovered')
          if (restored.restored) {
            sendAiNotice(`${restored.label || 'that model'} is answering again`, 'toast')
            logLine('ai-route-restored', String(restored.label || key))
          }
          sendHealth()
        })
        .catch(() => { routeHealth.fail(key, { reason: 'probe-failed' }); routeHealth.markProbing(key, false); sendHealth() })
    }
  }, 60_000)
  routeProbeTimer.unref?.()
}

function routeKey(route) {
  if (route.provider === 'keyless') return `${route.brain.chatUrl}|${route.brain.model}`
  if (route.provider === 'gemini') return `gemini|${geminiModel()}`
  const cfg = { ...aiSettings(), ...(route.override || {}) }
  return `${normalizedBaseUrl(cfg.openCodeBaseUrl)}|${cfg.openCodeModel}`
}

/** Inline/toast notice to the renderer — never a dialog. */
function sendAiNotice(text, kind = 'inline') {
  try { mainWindow?.webContents.send('ai:notice', { text, kind, at: Date.now() }) } catch {}
}

async function brainLocals() {
  if (Date.now() - brainLocalsCache.at < 60_000) return brainLocalsCache.locals
  const locals = await freeBrain.probeLocals().catch(() => [])
  brainLocalsCache = { at: Date.now(), locals }
  return locals
}

/**
 * JOB 1 route order. draft: local → keyless → user keys; strong (lock, repair,
 * agent-ops): user keys (best first) → local → keyless. First working wins;
 * the deterministic template stays the callers' final fallback.
 */
async function brainRoutes(task = 'draft') {
  const existing = await aiRoutes(task).catch(() => [])
  const isLocalRoute = (r) => r.provider === 'opencode' && isLocalModelBase(r.override?.openCodeBaseUrl || aiSettings().openCodeBaseUrl)
  const locals = await brainLocals()
  const localRoutes = [
    ...locals.map((l) => ({ provider: 'opencode', label: `${l.label} · ${l.models[0]}`, override: { openCodeBaseUrl: l.baseUrl, openCodeModel: l.models[0], openCodeApiKey: '' } })),
    ...existing.filter(isLocalRoute),
  ]
  const userRoutes = existing.filter((r) => !isLocalRoute(r))
  const keyless = freeBrain.planRoutes({ task, keyless: freeBrain.KEYLESS_ENDPOINTS }).filter((r) => r.kind === 'keyless')
    .map((brain) => ({ provider: 'keyless', label: brain.label, brain }))
  const strong = task !== 'draft' && task !== 'classify'
  const ordered = strong ? [...userRoutes, ...localRoutes, ...keyless] : [...localRoutes, ...keyless, ...userRoutes]
  const seen = new Set()
  const unique = ordered.filter((r) => { const k = routeKey(r); if (seen.has(k)) return false; seen.add(k); return true })
  const ready = unique.filter((r) => { const k = routeKey(r); return !brainCooldowns.cooling(k) && !routeHealth.unhealthy(k) })
  // If everything is cooling or quarantined we still try (the deterministic
  // template is the caller's fallback, but a blip must not lock AI out).
  return ready.length ? ready : unique.filter((r) => !brainCooldowns.cooling(routeKey(r)))
}

function noteRetiredModel(route) {
  const model = route.provider === 'keyless' ? route.brain.model : route.provider === 'gemini' ? geminiModel() : (route.override?.openCodeModel || aiSettings().openCodeModel)
  brainCooldowns.set(routeKey(route), 24 * 3600_000, 'retired')
  const cat = readModelCatalogue()
  writeModelCatalogue(freeBrain.retireModel(cat, null, model))
  const next = freeBrain.fallbackModel(cat, { id: model })
  sendAiNotice(`${model} was retired by its provider — switched to ${next ? next.id : 'the next free model'} for now.`, 'inline')
}

/* ——— JOB 2: free-model catalogue (silent, cached 24 h, weekly refresh) ——— */

function modelCatalogueFile() { return userDataPath('ai-cache', 'models.json') }
function readModelCatalogue() { return readJson(modelCatalogueFile(), { fetchedAt: 0, models: [], knownIds: [] }) }
function writeModelCatalogue(cat) { try { writeJson(modelCatalogueFile(), cat) } catch {} }

/** Sources: keyless defaults + locals + OpenCode imports; keyed providers only when a key exists. */
async function modelSources() {
  const sources = freeBrain.KEYLESS_ENDPOINTS.map((k) => ({
    id: k.id, kind: 'keyless', url: k.modelsUrl,
    parse: (data) => (Array.isArray(data) ? data : data?.data || [])
      .filter((m) => k.id !== 'pollinations' || !m.tier || m.tier === 'anonymous'),
  }))
  for (const l of await brainLocals()) sources.push({ id: l.kind, kind: 'local', url: `${l.baseUrl}/models` })
  const settings = readSettings()
  const orKey = String(process.env.OPENROUTER_API_KEY || (/openrouter\.ai/i.test(settings.openCodeBaseUrl || '') ? settings.openCodeApiKey : '') || '').trim()
  if (orKey) sources.push({ id: 'openrouter', kind: 'user', url: 'https://openrouter.ai/api/v1/models', headers: { authorization: `Bearer ${orKey}` } })
  const gKey = geminiApiKey()
  if (gKey) sources.push({ id: 'gemini', kind: 'user', url: `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(gKey)}`, parse: (d) => (d?.models || []).filter((m) => (m.supportedGenerationMethods || []).includes('generateContent')) })
  const groqKey = String(process.env.GROQ_API_KEY || settings.groqApiKey || '').trim()
  if (groqKey) sources.push({ id: 'groq', kind: 'user', url: 'https://api.groq.com/openai/v1/models', headers: { authorization: `Bearer ${groqKey}` } })
  const metaKey = String(process.env.MODEL_API_KEY || settings.metaApiKey || '').trim()
  const metaBase = normalizedBaseUrl(process.env.MODEL_API_BASE_URL || settings.metaBaseUrl || '')
  if (metaKey && metaBase) sources.push({ id: 'meta', kind: 'user', url: `${metaBase}/models`, headers: { authorization: `Bearer ${metaKey}` } })
  for (const preset of discoverOpenCodeConfiguredModels()) {
    const key = resolveOpenCodeApiKey(preset.baseUrl, preset.model)
    if (key || isLocalModelBase(preset.baseUrl)) sources.push({ id: `opencode:${preset.baseUrl}`, kind: isLocalModelBase(preset.baseUrl) ? 'local' : 'user', url: `${normalizedBaseUrl(preset.baseUrl)}/models`, headers: key ? { authorization: `Bearer ${key}` } : {} })
  }
  const seen = new Set()
  return sources.filter((src) => (seen.has(src.url) ? false : seen.add(src.url)))
}

let modelRefreshPromise = null
async function refreshModelCatalogue({ force = false } = {}) {
  const prev = readModelCatalogue()
  if (!force && !freeBrain.isStale(prev)) return prev
  if (modelRefreshPromise) return modelRefreshPromise
  modelRefreshPromise = (async () => {
    const fresh = await freeBrain.aggregateModels(await modelSources())
    // Everything failed (offline): keep the cache, don't mark anything retired.
    if (!fresh.models.length && fresh.errors.length) return prev
    const { catalogue, added, retired } = freeBrain.mergeCatalogue(prev, fresh)
    writeModelCatalogue(catalogue)
    try { mainWindow?.webContents.send('ai:models', { added: added.map((m) => m.id).slice(0, 12), retired: retired.map((m) => m.id).slice(0, 12), count: catalogue.models.length }) } catch {}
    if (added.length) sendAiNotice(`${added.length} new free model${added.length === 1 ? '' : 's'} available: ${added.slice(0, 3).map((m) => m.id).join(', ')}${added.length > 3 ? '…' : ''}`, 'toast')
    logLine('ai-models', `catalogue ${catalogue.models.length} (+${added.length}, retired ${retired.length}, failed ${fresh.failedSources.join(',') || 'none'})`)
    return catalogue
  })().finally(() => { modelRefreshPromise = null })
  return modelRefreshPromise
}

/** On start: silent local probe ("local brain found, switched") + stale-catalogue refresh + weekly timer. */
async function startZeroSetupBrain() {
  try {
    const locals = await brainLocals()
    const settings = readSettings()
    const found = locals[0] ? `${locals[0].kind}|${locals[0].models[0]}` : ''
    if (found && found !== settings.lastLocalBrain) {
      settings.lastLocalBrain = found
      writeSettings(settings)
      sendAiNotice(`local brain found, switched to ${locals[0].label}`, 'toast')
    } else if (!found && settings.lastLocalBrain) {
      settings.lastLocalBrain = ''
      writeSettings(settings)
    }
  } catch {}
  void refreshModelCatalogue().catch(() => undefined)
  setInterval(() => void refreshModelCatalogue({ force: true }).catch(() => undefined), freeBrain.WEEK_MS).unref?.()
}

/** 1.8 — backoff schedule for transient AI errors, per route. */
const AI_BACKOFF_MS = [1000, 4000]

async function completeWithFallback({ system, user, json = false, temperature = 0.4, images = [], history = [], deadlineMs = 45_000, validate, task = 'draft' }) {
  // Router contract: draft is cheap/free, lock prefers a stronger model, and
  // agent-ops always requests strict JSON mode. Providers can override these
  // model slots in settings without changing the fallback chain.
  if (task === 'agent-ops') json = true
  const routes = await brainRoutes(task)
  if (!routes.length) {
    const error = new Error('No live AI provider is configured and no local model server (Ollama, LM Studio, OpenCode) is running')
    error.code = 'NO_PROVIDER'
    throw error
  }
  const deadline = Date.now() + deadlineMs
  const failures = []
  // F-1: once a route has failed, the answer that finally arrives came from a
  // *different* brain. Say that once, in words, never as a raw timeout.
  let hopped = false
  for (const route of routes) {
    const remaining = deadline - Date.now()
    if (remaining < 2500) break
    // Per-attempt cap by route class (local 8 s, remote/free 20 s) instead of
    // one 30 s budget that a single hung endpoint could eat whole.
    const routeClass = route.provider === 'keyless' ? 'keyless'
      : route.provider === 'gemini' ? 'gemini'
        : isLocalModelBase(route.override?.openCodeBaseUrl || aiSettings().openCodeBaseUrl) ? 'local'
          : 'free'
    const attemptMs = freeBrain.attemptTimeoutMs(routeClass, remaining)
    try {
      const ask = async (extraInstruction = '') => {
        const userText = extraInstruction ? `${user}\n\n${extraInstruction}` : user
        if (route.provider === 'keyless') {
          // Built-in keyless free endpoint: spacing per endpoint, low temp, fixed seed.
          const key = `${route.brain.chatUrl}|${route.brain.model}`
          // Queue behind other requests to the same free endpoint (≈1 per 15 s)
          // instead of bursting into its rate limit.
          const wait = brainCooldowns.reserve(key, route.brain.minIntervalMs)
          if (wait > deadline - Date.now() - 2500) throw new Error('429 free brain queue is longer than this request can wait')
          if (wait) await delay(wait)
          const text = await freeBrain.chatOnce(route.brain, [
            { role: 'system', content: system },
            ...history.map((h) => ({ role: h.role === 'ai' ? 'assistant' : 'user', content: h.text })),
            { role: 'user', content: userText },
          ], { json, temperature: Math.min(temperature, 0.3), timeoutMs: freeBrain.attemptTimeoutMs(routeClass, deadline - Date.now()) })
          return { text, model: route.brain.model }
        }
        if (route.provider === 'gemini') {
          const historyText = history.length ? `Conversation so far:\n${history.map((h) => `${h.role === 'ai' ? 'Assistant' : 'User'}: ${h.text}`).join('\n')}\n\n` : ''
          const parts = [{ text: `${system}\n\n${historyText}${userText}` }, ...images.map((image) => ({ inlineData: { mimeType: image.mimeType || 'image/jpeg', data: image.data } }))]
          const result = await withTimeout(
            runGeminiGenerateContent(geminiApiKey(), images.length ? parts : parts[0].text, { ...(json ? { responseMimeType: 'application/json' } : {}), temperature }),
            freeBrain.attemptTimeoutMs(routeClass, deadline - Date.now()),
            'Gemini request',
          )
          return { text: result.response.text(), model: result.modelName || geminiModel() }
        }
        const userContent = images.length
          ? [{ type: 'text', text: userText }, ...images.map((image) => ({ type: 'image_url', image_url: { url: `data:${image.mimeType || 'image/jpeg'};base64,${image.data}` } }))]
          : userText
        const text = await callOpenCode([
          { role: 'system', content: system },
          ...history.map((h) => ({ role: h.role === 'ai' ? 'assistant' : 'user', content: h.text })),
          { role: 'user', content: userContent },
        ], { json, temperature, override: route.override, timeoutMs: freeBrain.attemptTimeoutMs(routeClass, deadline - Date.now()) })
        return { text, model: route.override?.openCodeModel || aiSettings().openCodeModel }
      }
      // 1.8 / F-1 — provider throttling (429 / 503 / overload) gets the same
      // route again after 1 s, then 4 s, while the deadline allows. A timeout
      // or a quota exhaustion moves straight to the next route: retrying a
      // hung endpoint is exactly what killed AI twice in the 0.13.0 logs.
      const askWithBackoff = async (extra = '') => {
        for (let attempt = 0; ; attempt += 1) {
          try {
            return await ask(extra)
          } catch (err) {
            if (freeBrain.isTimeoutError(err)) throw err
            const wait = AI_BACKOFF_MS[attempt]
            if (route.provider === 'keyless' && retryableAiError(err)) sendAiNotice(freeBrain.BUSY_NOTICE, 'inline')
            if (wait === undefined || !retryableAiError(err) || deadline - Date.now() < wait + 2500) throw err
            logLine('ai-backoff', `${route.label}: retry in ${wait}ms`, { error: (err?.message || String(err)).slice(0, 200) })
            await delay(wait)
          }
        }
      }
      let reply = await askWithBackoff()
      if (json) {
        let parsed
        try {
          parsed = parseJsonFromModel(reply.text)
          if (validate) validate(parsed)
        } catch (err) {
          if (deadline - Date.now() < 3000) throw err
          logLine('ai-json-repair', err?.message || String(err), { route: route.label })
          reply = await ask(`Your previous reply could not be used (${String(err?.message || err).slice(0, 200)}). Reply again with ONLY one valid JSON object — no markdown, no prose, no comments, no trailing commas.`)
          parsed = parseJsonFromModel(reply.text)
          if (validate) validate(parsed)
        }
        if (hopped) sendAiNotice(freeBrain.switchedNotice(route.label), 'inline')
        return { ...reply, parsed, route: route.label, switched: hopped }
      }
      if (hopped) sendAiNotice(freeBrain.switchedNotice(route.label), 'inline')
      routeHealth.ok(routeKey(route), { label: route.label })
      return { ...reply, route: route.label, switched: hopped }
    } catch (err) {
      failures.push(`${route.label}: ${err?.message || String(err)}`)
      logLine('ai-route-failed', (err?.message || String(err)).slice(0, 600), { route: route.label })
      hopped = true
      // F-1: a timeout cools the route for a minute and counts against its
      // health — it never gets retried inside the same request.
      const timedOut = freeBrain.isTimeoutError(err)
      // Per-route cooldown for EVERY route and every failure class, not only
      // quota on the configured one.
      brainCooldowns.set(
        routeKey(route),
        timedOut ? freeBrain.TIMEOUT_COOLDOWN_MS : isQuotaError(err) ? quotaCooldownMs(err) : /\b503\b|overload/i.test(err?.message || '') ? 20_000 : 20_000,
        timedOut ? 'timeout' : isQuotaError(err) ? 'quota' : /\b503\b|overload/i.test(err?.message || '') ? 'unavailable' : 'failed',
      )
      noteRouteFailure(route, timedOut ? 'timeout' : isQuotaError(err) ? 'quota' : 'failed')
      if (route.provider === 'opencode' && !route.override && isQuotaError(err)) {
        const cfg = aiSettings()
        aiCooldowns.set(`opencode:${cfg.openCodeBaseUrl}|${cfg.openCodeModel}`, { until: Date.now() + quotaCooldownMs(err), reason: 'quota' })
      }
      if (route.provider === 'keyless' && /\((401|402|403|410)\)/.test(err?.message || '')) brainCooldowns.set(routeKey(route), 24 * 3600_000, 'keyless-revoked')
      // Dead model (404 / model_not_found): grey it out, fall through silently.
      if (/\b404\b|model_not_found|model not found|does not exist/i.test(err?.message || '')) noteRetiredModel(route)
    }
  }
  // Report the most useful failure first: quota beats "connection refused".
  const ordered = [...failures].sort((a, b) => Number(isQuotaError(b)) - Number(isQuotaError(a)))
  sendAiNotice(freeBrain.OFFLINE_NOTICE, 'inline')
  const error = new Error(ordered.length ? ordered.join(' | ').slice(0, 1800) : 'The AI request ran out of time before any provider answered')
  // F-1: the diagnostic text stays on `message` for the log; anything a user
  // can read uses `friendly`, which never contains a raw URL or "timed out".
  error.friendly = freeBrain.friendlyAiMessage(ordered[0] || '')
  error.code = error.code || 'NO_ANSWER'
  throw error
}

/** User-facing sentence for an AI failure — honest, never a raw provider dump. */
function friendlyAiError(err) {
  return err?.friendly || freeBrain.friendlyAiMessage(err?.message || String(err || ''))
}

async function generateGeminiRundown(prompt, history, context) {
  const key = geminiApiKey()
  if (!key) throw new Error('Gemini needs a key in manual mode. Choose Auto or paste a Gemini key in Settings.')
  const result = await runGeminiGenerateContent(key, geminiRundownPrompt(prompt, history, context), { responseMimeType: 'application/json' })
  return normalizeRundown(parseJsonFromModel(result.response.text()), prompt)
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function withTimeout(promise, ms, label) {
  let timer
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${Math.round(ms / 1000)} seconds`)), ms)
  })
  return Promise.race([promise, deadline]).finally(() => clearTimeout(timer))
}

function retryableAiError(err) {
  // Backoff is deliberately narrow: only provider throttling/high demand gets
  // the 1s → 4s retry budget. Auth, malformed requests and 404s fall through
  // immediately to the next route.
  return /\b429\b|\b503\b|resource_exhausted|overload|high demand|temporar(?:y|ily) unavailable/i.test(err?.message || String(err))
}

function rundownCacheKey(prompt, context = {}) {
  const input = `${String(prompt || '').trim().toLowerCase()}|${JSON.stringify({ aspect: context.aspect, fps: context.fps, mode: context.mode })}`
  let hash = 2166136261
  for (let i = 0; i < input.length; i += 1) hash = Math.imul(hash ^ input.charCodeAt(i), 16777619)
  return `rundown-${(hash >>> 0).toString(16)}`
}

function rundownCacheFile() { return userDataPath('ai-cache', 'rundowns.json') }
function readRundownCache() { return readJson(rundownCacheFile(), {}) }
function cacheRundown(key, rundown) {
  const cache = readRundownCache()
  cache[key] = { savedAt: new Date().toISOString(), rundown }
  writeJson(rundownCacheFile(), cache)
  rundownCache.set(key, rundown)
}

async function generateRundown(prompt, history, context) {
  const key = rundownCacheKey(prompt, context)
  const memory = rundownCache.get(key) || readRundownCache()[key]?.rundown
  if (memory) {
    rundownCache.set(key, memory)
    logLine('ai-rundown-cache-hit', key)
    return memory
  }
  const reply = await completeWithFallback({
    system: 'You are Cupric AI creative director. Return STRICT JSON only, no markdown.',
    user: geminiRundownPrompt(prompt, history, context),
    json: true,
    temperature: 0.6,
    deadlineMs: 60_000,
    task: 'draft',
    validate: (value) => {
      if (!value || typeof value !== 'object' || !Array.isArray(value.scenes)) throw new Error('rundown JSON needs a scenes array')
    },
  })
  logLine('ai-rundown-route', reply.route)
  const rundown = normalizeRundown(reply.parsed, prompt)
  cacheRundown(key, rundown)
  return rundown
}

async function generateStudioEditPlan(instruction, studioContext) {
  const schemaPrompt = `${ADVANCED_VIDEO_PLAYBOOK_PROMPT}\nYou are the edit-planning agent inside Cupric AI Studio — a senior motion designer and editor. Return STRICT JSON only.
The user instruction must become a batch of allowlisted, non-destructive edit operations. Never invent clip IDs.

OUTPUT:
{"summary":string,"ops":[operation]}

OPERATIONS:
- {"type":"applyMotion","clipId":string,"motion":{"entrance"?:E,"emphasis"?:M,"exit"?:X,"camera"?:C,"intensity"?:number}}
  PREFERRED way to animate. Cupric's motion engine writes the keyframes with correct timing for the clip length,
  relative to the clip's resting position/size, with professional eases. intensity 0.5 subtle · 1 standard · 1.5 punchy.
  E entrance: fade-in, rise-in, drop-in, slide-in-left, slide-in-right, scale-pop, zoom-in, spin-in, whip-in, blur-focus
  M while on screen: pulse, heartbeat, shake, wiggle, float, breathe
  X exit: fade-out, sink-out, rise-out, slide-out-left, slide-out-right, zoom-out, pop-out
  C camera (video/image): ken-burns-in, ken-burns-out, pan-left, pan-right, push-in, drift-up, dolly-punch
  Or {"motion":{"preset":"title-pop"|"editorial"|"lower-third"|"hype"|"sticker"|"whip"|"ken-burns"|"punch"|"calm"}}
- {"type":"patchClip","clipId":string,"patch":{allowed properties}}
  Allowed: x, y, scale, rotation, opacity, fontSizePct, color, fontFamily, weight(400|600|800), align, highlightWord, text, anim, transitionIn, transitionOut, volume, durationSec, startSec, name.
  highlightWord must be an exact word already present in that text clip.
  Also allowed: tiltX/turnY (-89..89 degrees, 3D on ANY clip), perspective (200..8000), and for text emphasisColor, boxColor, accentColor ("#rrggbb"), textGlow (0..1).
  Fonts (video-grade): Geist Variable, Inter Variable, Montserrat Variable (bold captions), Poppins, Outfit Variable, Manrope Variable, DM Sans Variable, Space Grotesk Variable, Bebas Neue / Anton (condensed hype titles, uppercase), Instrument Serif / Playfair Display Variable (italic emphasis), JetBrains Mono Variable (code/stats).
  Also any family in STUDIO CONTEXT.fonts (source "yours" = fonts the user added, e.g. Satoshi / Clash Display from Fontshare — prefer them when they fit the mood). Pair ONE headline/caption family with ONE emphasis family (emphasisFont); never use more than two families in a video. Pick colours from the brand kit and in-between tints; keep text contrast >= 4.5:1 on its background.
  Fontshare fonts NOT in STUDIO CONTEXT.fonts cannot be used: say which one would suit and that it is free at fontshare.com (download and drop the zip into Cupric).
  RICH CAPTIONS inside text: *word* = serif italic emphasis, ==words== = colour highlight box, {words} = accent colour, ^30^ = big number, newline = stacked lines. Emphasise 1–2 words per caption, never whole sentences.
  Text animations (content-level): none, fade-up, pop, typewriter, word-reveal, shimmer, slide-left, glass-rise, liquid-wave.
  Transitions: none, fade, wipe-left, zoom-in, blur, iris, push-up, glass-wipe, liquid-dissolve, lens-sweep.
- {"type":"addText","text":string,"track":number,"startSec":number,"durationSec":number,"x"?:0..1,"y"?:0..1,"fontSizePct"?:number,"weight"?:400|600|800,"align"?:"left"|"center"|"right","color"?:"#rrggbb","fontFamily"?:string,"anim"?:string,"highlightWord"?:string,"motion"?:{...as applyMotion}}
- {"type":"addKit","kit":"cursor-zoom"|"pill-text"|"stat-card"|"rating-bars"|"image-stack"|"browser-mockup"|"checkout-card"|"block-row-3d","variant"?:string,"startSec":number,"durationSec":number,"x"?:0..1,"y"?:0..1,"w"?:0.05..1.5,"title"?:string,"subtitle"?:string,"items"?:string[],"accent"?:"#E24B4A"|"#FF5A1F"|"#2F6BFF"|"#1FA463"|"#C8F542"|"#4FB6E8"} — Home_X kit piece; pill-text wraps [words] in pills. Never put invented numbers, prices or ratings in title/items
- {"type":"buildHomeVideo","style":"saas-capture"|"kinetic-float"|"red-pill"|"launch-stats"|"mascot-checkout"|"dark-3d","fill"?:{"headline"?:string,"supporting"?:string,"cta"?:string,"brand"?:string,"url"?:string,"pillWords"?:string[],"checklist"?:string[]}} — append a whole Home_X style; stats/prices come only from the user
- {"type":"addLoader","preset":"thinking-states"|"thinking-states-agent"|"matrix-scan"|"matrix-twinkle"|"matrix-orbit"|"matrix-pulse"|"matrix-rounded"|"matrix-monochrome"|"matrix-lime"|"matrix-reduced"|"matrix-compact"|"matrix-large"|"matrix-inline"|"matrix-fullscreen","startSec":number,"durationSec":number,"states"?:string[] (1-8 real process steps from the brief, never invented results),"x"?:0..1,"y"?:0..1} — Transitions.dev loader drawn natively; only for a genuine loading/thinking beat in the story
- {"type":"addShape","shape":id,"startSec":number,"durationSec":number,"x"?:0..1,"y"?:0..1,"w"?:0.01..1.5 (width, fraction of frame),"fill"?:"#rrggbb"|null,"stroke"?:"#rrggbb"|null,"anim"?:"draw-on"|"draw-then-fill"|"pop"|"grow"|"spin-in"|"pulse"|"wiggle"|"none","label"?:string}
  Shapes: rectangle rounded-rect pill circle ellipse ring arc semicircle triangle diamond pentagon hexagon octagon polygon parallelogram trapezoid star sparkle burst seal sunburst arrow block-arrow curved-arrow loop-arrow double-arrow chevron elbow-arrow speech-bubble thought-bubble callout-box lower-third underline circle-scribble strike highlight-bar brackets frame button progress-bar toggle play browser check cross plus heart lightning pin quote-marks cloud line wave zigzag spiral blob.
  How editors use them: curved-arrow/elbow-arrow point FROM a caption TO the thing (before→after); underline/circle-scribble/highlight-bar mark ONE key word or number (draw-on, 0.4s); burst/seal/sparkle for price/NEW badges (pop); check/cross for do-vs-don't; lower-third/callout-box behind names; brackets/frame to isolate a detail. One accent shape per beat; match the brand accent; keep stroke 6–10px.
- {"type":"addCursor","clipId":string,"action"?:"click"|"double-click"|"hover"|"drag","force"?:true}
  Adds a pointer that travels to that clip and clicks it (the clip presses in; recorded components are re-recorded interacting). Use ONLY for interactive UI — buttons, toggles, inputs, menus, app/website demos, tutorials. Never on backgrounds, text-only reveals, loaders, charts or decorative motion; the app refuses those unless force is true, and you should not force it.
- {"type":"setKeyframe","clipId":string,"at":number,"values":{"x"?,"y"?,"scale"?,"rotation"?,"opacity"?},"ease":"linear"|"ease-in"|"ease-out"|"ease-in-out"|"expo-out"|"expo-in-out"|"back-out"|"back-in"|"elastic-out"|"hold"}
  Only for custom paths applyMotion cannot express. scale and opacity are MULTIPLIERS of the clip's own value (1 = rest). x/y are absolute 0..1. The ease on a key controls travel to the NEXT key.
- {"type":"clearKeyframes","clipId":string}
- {"type":"moveClip","clipId":string,"track":number?,"startSec":number?}
- {"type":"reframeClip","clipId":string,"aspect":"16:9"|"9:16"|"1:1"|"4:5","x"?:0..1,"y"?:0..1,"scale"?:0.05..10}  Reframe one video/image while preserving a safe subject centre.
- {"type":"nestScene","sceneId":string,"at":number}  Place an existing saved scene as one editable sequence clip.
- {"type":"deleteClip","clipId":string}
- {"type":"reorderTrack","from":number,"to":number}
- {"type":"applyStylePreset","preset":"editorial"|"bold-social"|"minimal"}
- {"type":"setComponentProps","clipId":string,"props":{...}}  Change the text, colours, sizes or font INSIDE an existing component clip (STUDIO CONTEXT.clips[].componentProps are its current values, settableProps the allowed keys). Merged over the current props; the component re-records itself. Use it whenever the user asks to change a component's words, colour or font — never delete and re-add.
- {"type":"addComponent","slug":string,"startSec":number,"durationSec":number,"track"?:number (0 = bottom layer, use for shader backgrounds),"x"?:0..1,"y"?:0..1,"interact"?:boolean,"cursor"?:true (adds a clicking pointer when the component is interactive),"props"?:{only keys listed in that component's context "props" — e.g. set the real headline text, brand colours},"motion"?:{...as applyMotion}}
- {"type":"rippleDelete","clipId":string}
- {"type":"closeGaps","track"?:number}
- {"type":"addMarker","at":number,"label"?:string}
- {"type":"setBlend","clipId":string,"mode":"normal"|"multiply"|"screen"|"overlay"|"darken"|"lighten"|"color-dodge"|"soft-light"|"difference"|"add"}
- {"type":"setDevice","clipId":string,"device":"none"|"phone"|"laptop"|"browser"}  (video/image/component clips)
- {"type":"productMotion","clipId":string,"preset":"subtle"|"push-in"|"orbit"|"hero-reveal"}  (image/video)
- {"type":"logoReveal","clipId":string,"reveal":"scale-pop"|"blur-rise"|"spin-settle"|"wipe-on"}  (image/video)
- {"type":"textPreset","clipId":string,"preset":"title"|"subtitle"|"lower-third"|"caption"|"quote"|"cta"|"kinetic"}
- {"type":"setAudioRole","clipId":string,"role":"music"|"voice"|"sfx"}
- {"type":"setDucking","enabled":boolean,"amountDb"?:-30..-3}
- {"type":"addTestimonialGrid","count":1..4,"startSec":number}  (EMPTY placeholders — never write testimonials)
- {"type":"phoneDesign","clipId":"...","design":"product-launch"|"hero-product"|"app-scroll"|"notification"|"social-post"|"minimal"|"iphone-duo"}  (animated phone or foldable duo mockup; copy stays placeholder for the user to edit)
- {"type":"addCaptions","transcript":string,"startSec":number,"durationSec":number}  (only the user's own words)
  Places a real animated UI component (buttons, toggles, counters, cards, loaders, charts…). Cupric plays the actual component,
  acts it out (hover, clicks) and records its genuine animation into an editable overlay clip. slug MUST be one of
  STUDIO CONTEXT.components[].slug. Use one when the user asks for a UI element, a product/app demo moment, or a named component.
  fc-* slugs are framecn video components: captions (karaoke, neon, editorial emphasis), kinetic typography, transitions, full scenes (browser flow, dashboard populate, device assemble) and WebGL shader backgrounds. Always pass props with the user's real words and brand colours instead of leaving demo text.
  ob-* slugs (after ObsidianUI): ob-flip-text (3D letter-flip title), ob-text-stream ("We make ___" stepping word list; items = comma-separated words), ob-click-spark (transparent spark burst to lay over a click/press), ob-marquee-band (tilted crossing tape bands of phrases for launches/sales).
  mb-* slugs (motion-board set): mb-chart-morph (bars → line through the tops → final value badge; values = comma-separated numbers), mb-masked-type (colour rises inside one big word + subline), mb-elastic-type (letters stretch on a locked baseline), mb-shutter-reveal (staggered slats uncover art, badge lands), mb-search-results (search pill types a query, result cards stage in; results = "title|meta, title|meta").
- Motion timing grammar (use it when choosing starts/durations and when explaining): every beat is forward (≈2.2 s, ease-in-out) → HOLD long enough to read (≈2× the forward) → quick return or cut (≈1.4 s). Move one shared element across states instead of cutting between them (button → player, bars → line, search → results). Stagger siblings 0.1–0.35 s, never all at once. Big type gets one idea per beat.
  Every component with text also accepts props.fontFamily = one family from STUDIO CONTEXT.fonts, so the component's type matches the rest of the edit (monospace/code text stays mono).
  Each catalogue line has "use": follow it for track, length and placement.

Track 0 is the bottom layer; higher tracks draw on top. Overlapping clips on one track are automatically lifted to a free track, so you may place text anywhere. Keyframe times are local to the clip. The context may include attributed motionReferences from React Bits, Skiper UI and Remotion: use their names as creative vocabulary, but translate every idea into only the native operations above. Never claim to install or execute an upstream component.

MOTION PLAYBOOK (follow it):
- Every animated element has a purpose: enter to be noticed, live while it is read, leave so the next idea can land. Motion with no purpose is noise.
- Hierarchy: the hero title gets the most expressive entrance (scale-pop / blur-focus / rise-in); supporting lines get quieter entrances; never give every layer the same move.
- Lower thirds (y > 0.72) slide in and out from the side. CTAs pop in and pulse once. Stickers spin/pop in and float.
- Video and photos get a slow camera move (ken-burns-in/out, pan, drift); alternate directions between consecutive shots. Photos always need one.
- Energy by genre: social/reels → intensity 1.3, zoom-in / scale-pop / dolly-punch, zoom-in or push-up transitions. Cinematic/brand → intensity 0.8–0.9, blur-focus / rise-in, liquid-dissolve / blur / lens-sweep. Minimal → 0.6, fade / rise.
- Reading time: a line needs about 0.8s + 0.3s per word on screen, at rest. If a text clip is shorter, patch durationSec.
- Typography: hero weight 800 and the largest size; supporting weight 600 at ~60% of the hero size; pick one highlightWord per important line (a number, a name or the strongest noun).
- Don't double-animate: a keyframed entrance replaces fade-up/pop text animations and non-media transitions (the engine handles this). word-reveal or typewriter can accompany a subtle entrance on long lines.
- Transitions only at real cuts between media clips, varied, never the same twice in a row.
- For broad requests (auto edit, polish, make it better/cinematic/professional) touch EVERY visible clip: typography + highlight + applyMotion for text; transition + camera applyMotion for media; applyMotion for stickers/overlays/glass. 2 ops per clip is normal. Do not merely return applyStylePreset or a single fade.
- For narrow requests, change only what was asked, precisely.

COMPONENT PLAYBOOK (how a senior editor uses them):
- Pick by the job, not the name: hook/hero line → kinetic text (fc-blur-reveal, fc-per-character-rise, ob-flip-text, ob-text-stream); spoken lines → one caption style for the WHOLE video (fc-caption-*); numbers → odometer / stat-counter / fc-animated-bar-chart with the real figure; product/app → fc-browser-flow, fc-dashboard-populate, fc-hero-device-assemble; code → fc-terminal-simulator, fc-glass-code-block; mood/premium → one fc-shader-* or mesh gradient background on track 0 spanning the scene; cuts → one fc-* transition (0.6–1.2 s) centred on the join; launch/sale → ob-marquee-band, fc-success-confetti; clicks → ob-click-spark on the track above the pressed element, starting 0.05 s before the press.
- Text inside components is real copy: set every text prop (text, items, prefix, title…) to the user's words, colour props to the brand kit, fontFamily to the edit's headline or caption font. Never leave demo words like "BlurReveal" or "Now live".
- Keep one visual system: at most 2 font families, 1 accent colour, 1 caption style, 1 background family per video. Reuse the same transition family with varied directions rather than a different effect at every cut.
- Density: one hero component per beat (3–6 s); accents (spark, confetti, marquee) are brief. Do not stack two full-frame scenes at the same time. Components must not cover faces or the key product; place with x/y and leave safe margins (5% sides, 10% top/bottom for 9:16).
- When a request needs more than one step, return all of them in ONE plan, in order (e.g. background shader → headline component → captions → transition → motion on existing clips).

TYPOGRAPHY & COLOUR:
- Hook/title: display or condensed family, weight 800, the largest size, 2–6 words per line. Captions: a clean sans at weight 600–800, 1 emphasised word per line via rich markup. Serif italic only for emphasis words.
- Colour: text on dark = #f4f1ea-ish off-white, on light = near-black; accent only on the one word/number that matters; keep contrast ≥ 4.5:1. Derive tints from the brand kit instead of inventing new hues.

SMOOTHNESS (every edit must feel continuous):
- Nothing hard-cuts on or off: every added text/component/shape gets an entrance and an exit (the engine defaults to a soft rise/fade if you omit motion, but choose the right one).
- Overlap beats by 0.2–0.4 s so the next element enters while the previous leaves; stagger sibling elements by 0.08–0.15 s; never start two hero entrances on the same frame.
- Entrances 0.35–0.7 s ease-out (expo-out / back-out for pop), exits 0.25–0.45 s ease-in, faster than entrances. Camera moves span the whole shot and are slow (intensity ≤ 1).
- Land key moments on the beat: a number reveal, click spark or cut sits on a marker or a change in the voice when there is one.
- Components that animate themselves (captions, scenes, shaders, transitions, kinetic text) get only a gentle fade in/out, never an extra rise or pop.
Do not return prose outside JSON.

STUDIO CONTEXT:
${JSON.stringify(studioContext)}

USER INSTRUCTION:
${instruction}`
  const reply = await completeWithFallback({
    system: 'You are the senior motion designer and editor inside Cupric AI Studio. Return only one valid JSON object of edit operations.',
    user: schemaPrompt,
    json: true,
    temperature: 0.25,
    deadlineMs: STUDIO_PLAN_DEADLINE_MS - 2000,
    task: 'agent-ops',
    validate: (value) => {
      if (!value || typeof value !== 'object' || !Array.isArray(value.ops) || value.ops.length === 0) throw new Error('edit plan JSON needs a non-empty ops array')
    },
  })
  return { ...reply.parsed, source: 'live', model: reply.model, route: reply.route }
}

/* ——— JOB 4: agent writes NEW animations (validated in the renderer by agentCode.ts) ——— */
ipcMain.handle('agent:generateAnimation', async (_event, payload = {}) => {
  const instruction = String(payload?.instruction || '').slice(0, 800)
  const durationSec = Math.min(30, Math.max(0.5, Number(payload?.durationSec) || 2))
  const rules = String(payload?.rules || '').slice(0, 4000)
  const fewShots = (Array.isArray(payload?.fewShots) ? payload.fewShots : []).slice(0, 3)
    .map((shot) => `REQUEST: ${String(shot?.request || '').slice(0, 200)}\nANSWER: ${JSON.stringify(shot?.answer || {}).slice(0, 5000)}`).join('\n\n')
  const previous = payload?.previous && typeof payload.previous === 'object'
    ? `\n\nYOUR PREVIOUS ATTEMPT WAS REJECTED. Fix exactly these problems and return the whole corrected JSON:\n${String(payload.previous.problems || '').slice(0, 1500)}\nPREVIOUS CODE:\n${String(payload.previous.code || '').slice(0, 15_500)}`
    : ''
  const reply = await completeWithFallback({
    system: 'You write small, original, deterministic animation components for Cupric AI Studio. Return ONLY one JSON object: {"name","kind","durationSec","ease","props","code"}. The code is one plain JavaScript function (no JSX, no TypeScript types) exactly like the examples. Write project-original code; never copy third-party source.',
    user: `RULES (every one is enforced; violations are rejected):\n${rules}\n\nEXAMPLES (fewShots):\n${fewShots}\n\nREQUEST: ${instruction}\nLength: ${durationSec}s (t goes 0→1 over this length).${previous}`,
    json: true,
    temperature: 0.2,
    deadlineMs: 40_000,
    task: previous ? 'repair' : 'agent-code',
    validate: (value) => { if (!value || typeof value !== 'object' || typeof value.code !== 'string' || !value.code.trim()) throw new Error('animation JSON needs a code string') },
  })
  const v = reply.parsed || {}
  return { name: String(v.name || 'Agent animation').slice(0, 60), kind: String(v.kind || 'title').slice(0, 30), ease: String(v.ease || 'ease-out'), props: v.props && typeof v.props === 'object' ? v.props : {}, code: String(v.code || '').slice(0, 16_000), durationSec, model: reply.model, route: reply.route }
})

/** Persist accepted agent code as a file: repo src/lab/generated in dev, userData when packaged. */
ipcMain.handle('agent:saveGenerated', async (_event, payload = {}) => {
  const slug = String(payload?.slug || '')
  const code = String(payload?.code || '')
  if (!/^gen-[a-z0-9-]{1,40}$/.test(slug) || !code || code.length > 16_000) return { ok: false }
  const dir = DEV_URL ? path.join(__dirname, '..', 'src', 'lab', 'generated') : userDataPath('agent-generated')
  fs.mkdirSync(dir, { recursive: true })
  const file = path.join(dir, `${slug}.tsx`)
  const header = `// @ts-nocheck\n// Agent-generated animation “${String(payload?.name || slug).replace(/[\r\n*/]/g, ' ').slice(0, 60)}” — source: agent-generated.\n// Validated by src/lib/studio/agentCode.ts (pure function of t, seeded, token colours, reduced motion).\n// Rendered only through GeneratedFrame's allowlisted tree; never imported directly.\n`
  fs.writeFileSync(file, header + code + '\n', 'utf8')
  return { ok: true, file: DEV_URL ? path.relative(path.join(__dirname, '..'), file) : `agent-generated/${slug}.tsx` }
})

// Long enough for one fallback hop (Gemini → a local/OpenCode model), short
// enough that the renderer's deterministic local plan takes over quickly.
const STUDIO_PLAN_DEADLINE_MS = 25_000

async function liveAiChat(text, ctx, extra = {}) {
  const images = Array.isArray(extra.images) ? extra.images.filter((image) => image && typeof image.data === 'string' && image.data.length < 12_000_000).slice(0, 4) : []
  const history = Array.isArray(extra.history) ? extra.history.slice(-8).map((h) => ({ role: h?.role === 'ai' ? 'ai' : 'user', text: String(h?.text || '').slice(0, 4000) })) : []
  try {
    return await liveAiChatOnce(text, ctx, { images, history })
  } catch (err) {
    // F-1: the chat bubble gets one honest line, never "Request to
    // https://… timed out". The full reason is in the log.
    logLine('ai-chat-failed', (err?.message || String(err)).slice(0, 600))
    throw Object.assign(new Error(friendlyAiError(err)), { code: err?.code || 'NO_ANSWER' })
  }
}

async function liveAiChatOnce(text, ctx, { images, history }) {
  const reply = await completeWithFallback({
    system: "You are Cupric AI's desktop creative copilot: a senior video editor and motion designer. Be concise, practical and specific. Help with video creation, keyframe animation, typography, transitions, rendering, resources, prompts and edits. When images are attached, look at them carefully and refer to what is actually in them.",
    user: `Context: ${JSON.stringify(ctx || {})}\nUser: ${text}`,
    images,
    history,
    temperature: 0.6,
    deadlineMs: 60_000,
  })
  return reply.text
}

async function handleGeminiAsk(payload) {
  try {
    const prompt = String(payload?.prompt || '').trim()
  const context = payload?.rundownContext || {}
  const providerLabel = aiSettings().provider === 'opencode' ? 'your OpenCode model' : aiSettings().provider === 'gemini' ? 'Gemini' : 'the free built-in brain'
  const cacheKey = rundownCacheKey(prompt, context)
  const cached = rundownCache.get(cacheKey) || readRundownCache()[cacheKey]?.rundown
  if (cached) {
    return { source: 'live', cached: true, text: `Loaded your cached ${cached.durationSec}s rundown instantly.`, rundownPatch: cached }
  }

  // The timeline is never held hostage by a remote model. Return the
  // deterministic shape now, then polish it in a small persisted queue. The
  // renderer receives ai:rundownPolished when the live answer arrives.
  const aspect = context.aspect === '16:9' || context.aspect === '1:1' ? context.aspect : '9:16'
  const instant = fallbackRundownForJob({ brief: prompt, aspect, fps: context.fps === 60 ? 60 : 30 })
  const requestId = String(payload?.requestId || uid('rundown'))
  // Zero setup: the keyless free brain is always a route, so polish unless the
  // user explicitly chose the offline template.
  const shouldPolish = configuredAiMode() !== 'template'
  if (shouldPolish) {
    rundownQueue.push({ requestId, prompt, history: payload?.history || [], context, cacheKey, projectId: payload?.projectId || null })
    void pumpRundownQueue()
  }
  return {
    source: 'local',
    fallbackReason: shouldPolish ? undefined : 'No live AI provider was found; offline template is active.',
    queued: shouldPolish,
    requestId,
    text: shouldPolish
      ? `Cupric AI drafted this rundown instantly. It's asking ${providerLabel} to refine it in the background, and the timeline is usable now.`
      : 'Cupric AI drafted this rundown offline. The timeline is fully editable now. Connecting Gemini, Zen or a local model lets Cupric AI refine it further.',
    rundownPatch: instant,
    }
  } catch (err) {
    const fallbackReason = err?.message || String(err)
    const context = payload?.rundownContext || {}
    const aspect = context.aspect === '16:9' || context.aspect === '1:1' ? context.aspect : '9:16'
    const rundownPatch = fallbackRundownForJob({ brief: String(payload?.prompt || ''), aspect, fps: context.fps === 60 ? 60 : 30 })
    logLine('interactive-rundown-fallback', fallbackReason, { provider: aiSettings().provider })
    return { source: 'local', fallbackReason: 'Live AI was unavailable; the offline template is ready.', text: 'Live AI was unavailable, so Cupric built an editable offline template instead.', rundownPatch }
  }
}
ipcMain.handle('gemini:ask', (_event, payload) => handleGeminiAsk(payload))

async function pumpRundownQueue() {
  if (rundownQueueRunning) return
  rundownQueueRunning = true
  try {
    while (rundownQueue.length) {
      const task = rundownQueue.shift()
      if (!task) continue
      try {
        const rundown = await generateRundown(task.prompt, task.history, task.context)
        mainWindow?.webContents.send('ai:rundownPolished', { requestId: task.requestId, projectId: task.projectId, rundown })
      } catch (err) {
        const message = err?.message || String(err)
        if ((retryableAiError(err) || /offline|fetch failed|timed out|connection refused/i.test(message)) && (task.attempts || 0) < 2) {
          task.attempts = (task.attempts || 0) + 1
          rundownQueue.push(task)
          logLine('rundown-polish-retrying', message, { requestId: task.requestId, attempt: task.attempts })
          mainWindow?.webContents.send('ai:rundownPolished', { requestId: task.requestId, projectId: task.projectId, status: 'retrying', message: `AI polish queued — retrying (${task.attempts}/2).` })
          await delay(task.attempts === 1 ? 1000 : 4000)
          continue
        }
        logLine('interactive-rundown-fallback', message, { requestId: task.requestId, projectId: task.projectId })
        logLine('rundown-polish-failed', message, { requestId: task.requestId, projectId: task.projectId })
        mainWindow?.webContents.send('ai:rundownPolished', { requestId: task.requestId, projectId: task.projectId, error: 'Live polish was unavailable; the instant template remains ready.' })
      }
    }
  } finally {
    rundownQueueRunning = false
  }
}
ipcMain.handle('gemini:chat', async (_event, payload) => liveAiChat(payload?.text || '', payload?.ctx || {}, { images: payload?.images, history: payload?.history }))
ipcMain.handle('studio:planEdits', async (_event, payload) => {
  const instruction = String(payload?.instruction || '').trim().slice(0, 2000)
  if (!instruction) throw new Error('Describe the edit you want first')
  return withTimeout(generateStudioEditPlan(instruction, payload?.context || {}), STUDIO_PLAN_DEADLINE_MS, 'Studio auto edit')
})

// ---------------------------------------------------------------------------
// Arena import / preview
// ---------------------------------------------------------------------------

function projectRoot(projectId) {
  return userDataPath('projects', String(projectId || 'default'))
}

function isSubPath(child, parent) {
  const rel = path.relative(path.resolve(parent), path.resolve(child))
  return rel === '' || (!!rel && !rel.startsWith('..') && !path.isAbsolute(rel))
}

/* ——— F-2: the project-data sandbox ————————————————————————————————————
 * Everything Cupric writes for a project, as real directories. A preview path
 * must canonicalise (symlinks, junctions, Windows case, 8.3 short names) into
 * one of these — the 0.13.0 build compared raw strings against `projects`
 * alone, which rejected every `renders/<jobId>/…` export in a batch.
 */
function projectDataRoots() {
  return pathSandbox.PROJECT_DATA_DIRS.map((dir) => userDataPath(dir))
}

const realpathNative = (p) => (fs.realpathSync.native ? fs.realpathSync.native(p) : fs.realpathSync(p))

/** `{ ok, canonical, root }` — or `{ ok:false, canonical, reason, message }`. */
function resolveProjectDataPath(candidate) {
  const roots = projectDataRoots()
  const verdict = pathSandbox.resolveInsideRoots(candidate, roots, { realpath: realpathNative, platform: process.platform })
  if (verdict.ok) return verdict
  return { ...verdict, message: pathSandbox.outsideMessage(verdict.canonical || String(candidate || ''), roots) }
}

/**
 * Honest rejection: an Error the renderer can render inline, naming the path
 * and offering "Reveal folder". Never a bare "…is outside…" IPC string.
 */
function outsideProjectDataError(candidate, verdict) {
  const error = new Error(verdict.message)
  error.code = 'PATH_OUTSIDE_PROJECT_DATA'
  error.path = verdict.canonical || String(candidate || '')
  error.canReveal = Boolean(error.path)
  return error
}

function safeFileName(name, fallback = 'file') {
  const cleaned = String(name || fallback)
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
  return cleaned || fallback
}

function findIndexHtml(dir) {
  let firstHtml = null
  const entries = fs.readdirSync(dir, { withFileTypes: true })
  for (const entry of entries) {
    const p = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      const found = findIndexHtml(p)
      if (found) return found
    } else if (entry.name.toLowerCase() === 'index.html') {
      return p
    } else if (!firstHtml && /\.html?$/i.test(entry.name)) {
      firstHtml = p
    }
  }
  return firstHtml
}

function extractZipSafely(zipPath, outDir) {
  const zip = new AdmZip(zipPath)
  const outRoot = path.resolve(outDir)
  for (const entry of zip.getEntries()) {
    const target = path.resolve(outDir, entry.entryName)
    if (!isSubPath(target, outRoot)) throw new Error(`Unsafe Arena zip entry: ${entry.entryName}`)
    if (entry.isDirectory) {
      ensureDir(target)
    } else {
      ensureDir(path.dirname(target))
      fs.writeFileSync(target, entry.getData())
    }
  }
}

async function createHiddenWindow(width, height) {
  // Offscreen capture windows must be exactly the target size. Without
  // enableLargerThanScreen the OS clamps a 1920×1080 window to the work area
  // (e.g. 1759×894 on a small or scaled display) and libx264 then refuses the
  // odd width. Frames are also resized and padded later as a second guard.
  const win = new BrowserWindow({
    show: false,
    width,
    height,
    useContentSize: true,
    enableLargerThanScreen: true,
    resizable: false,
    backgroundColor: '#000000',
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      backgroundThrottling: false,
      // Background Studio exports use the same renderer compositor in an
      // offscreen window, but never run inside the user's interactive window.
      preload: path.join(__dirname, 'preload.cjs'),
      zoomFactor: 1,
    },
  })
  try {
    win.setContentSize(width, height)
  } catch {
    /* some platforms refuse while hidden; frames are normalised anyway */
  }
  return win
}

/**
 * capturePage returns device pixels, so on a 125 % or 150 % display — or when
 * the window was clamped — the image is not the size we asked for. Normalise
 * every frame to the exact (even) target before it reaches the encoder.
 */
function exactFrame(img, width, height) {
  const size = img.getSize()
  if (size.width === width && size.height === height) return img
  return img.resize({ width, height, quality: 'best' })
}

/**
 * The last guard before libx264: fit any input inside an even W×H canvas.
 * Handles odd sizes, DPI-scaled frames and wrong aspect ratios alike.
 */
function evenFrameFilter(width, height) {
  const w = evenInt(width, 1920)
  const h = evenInt(height, 1080)
  return `scale=${w}:${h}:force_original_aspect_ratio=decrease:flags=lanczos,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1,format=yuv420p`
}

async function captureArena(indexPath, timeSec = 1.5, width = 1280, height = 720) {
  const win = await createHiddenWindow(width, height)
  try {
    await win.loadFile(indexPath)
    const hasSeek = await win.webContents.executeJavaScript('typeof window.__seek === "function"', true)
    if (!hasSeek) throw new Error('Arena index.html must define window.__seek(t)')
    await win.webContents.executeJavaScript(`window.__seek(${JSON.stringify(timeSec)})`, true)
    await win.webContents.executeJavaScript('new Promise((resolve) => requestAnimationFrame(() => resolve(true)))', true)
    await new Promise((resolve) => setTimeout(resolve, 250))
    return (await win.webContents.capturePage()).toDataURL('image/png')
  } finally {
    if (!win.isDestroyed()) win.destroy()
  }
}

ipcMain.handle('dialog:pickArena', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openFile'],
    filters: [{ name: 'Arena export', extensions: ['zip', 'html', 'htm'] }],
  })
  return result.canceled ? null : result.filePaths[0]
})

ipcMain.handle('arena:import', async (_event, payload) => {
  const filePath = payload?.filePath
  const projectId = payload?.projectId || 'default'
  if (!filePath) throw new Error('No Arena file selected')
  if (!fs.existsSync(filePath)) throw new Error('Arena file does not exist')

  const assetId = uid('arena')
  const outDir = path.join(projectRoot(projectId), 'arena', assetId)
  ensureDir(outDir)

  if (/\.zip$/i.test(filePath)) {
    extractZipSafely(filePath, outDir)
  } else if (/\.html?$/i.test(filePath)) {
    fs.copyFileSync(filePath, path.join(outDir, safeFileName(path.basename(filePath), 'index.html')))
  } else {
    throw new Error('Arena import must be a .zip or .html file')
  }

  const indexPath = findIndexHtml(outDir)
  if (!indexPath) throw new Error('Arena export does not contain an HTML file')

  const html = fs.readFileSync(indexPath, 'utf8')
  if (!html.includes('__seek')) throw new Error('Arena index.html must define window.__seek(t)')

  const thumbnailDataUrl = await captureArena(indexPath)
  return { assetId, htmlFileName: path.basename(indexPath), localPath: indexPath, thumbnailDataUrl }
})

ipcMain.handle('arena:previewPath', async (_event, localPath) => {
  if (!localPath) throw new Error('No preview path provided')
  const verdict = resolveProjectDataPath(localPath)
  if (!verdict.ok) throw outsideProjectDataError(localPath, verdict)
  // The canonical path is what actually exists on disk — file:// URLs built
  // from an 8.3 or wrong-case spelling fail to load on some Windows setups.
  return pathToFileURL(verdict.canonical).toString()
})

/**
 * F-2 — "Reveal folder" for a path the sandbox refused. Opening Explorer on a
 * file the user picked themselves leaks nothing back into the renderer, and it
 * is the one action that actually helps when a path is in the wrong place.
 */
ipcMain.handle('path:reveal', async (_event, target) => {
  const p = String(target || '').trim()
  if (!p || !path.isAbsolute(p) || !fs.existsSync(p)) throw new Error('That file is no longer on disk.')
  shell.showItemInFolder(p)
  return true
})

/**
 * Read a generated HTML file back as text, so the Studio can take it apart
 * into editable clips.
 *
 * Same containment rule as the preview path — only files inside Cupric's own
 * project data — and a size cap, because this is parsed in the renderer.
 */
/**
 * Capture a rectangle of the calling window, exactly as Chromium painted it.
 *
 * UI Lab components use oklch(), color-mix(), backdrop-filter, canvas and
 * WebGL — none of which DOM-to-canvas libraries reproduce (html2canvas throws
 * on oklch outright). The compositor's own pixels are always right.
 */
ipcMain.handle('capture:rect', async (event, rect) => {
  const x = Math.max(0, Math.floor(Number(rect?.x) || 0))
  const y = Math.max(0, Math.floor(Number(rect?.y) || 0))
  const width = Math.max(1, Math.min(4096, Math.ceil(Number(rect?.width) || 0)))
  const height = Math.max(1, Math.min(4096, Math.ceil(Number(rect?.height) || 0)))
  const image = await event.sender.capturePage({ x, y, width, height })
  if (image.isEmpty()) throw new Error('The capture came back empty — keep the component on screen while it renders.')
  // capturePage returns device pixels; hand back CSS-pixel size so frames
  // stay light and consistent across 100 % / 150 % displays.
  const sized = image.getSize().width > width * 1.05 ? image.resize({ width, height, quality: 'best' }) : image
  const format = rect?.format === 'png' ? 'png' : 'jpeg'
  return format === 'png' ? sized.toDataURL() : `data:image/jpeg;base64,${sized.toJPEG(88).toString('base64')}`
})

ipcMain.handle('arena:readHtml', async (_event, localPath) => {
  if (!localPath) throw new Error('No file path provided')
  const verdict = resolveProjectDataPath(localPath)
  if (!verdict.ok) throw outsideProjectDataError(localPath, verdict)
  localPath = verdict.canonical
  const stat = fs.statSync(localPath)
  const MAX_BYTES = 8 * 1024 * 1024
  if (stat.size > MAX_BYTES) throw new Error('That file is larger than 8 MB, which is too big to be a single-file scene')
  return fs.readFileSync(localPath, 'utf8')
})

ipcMain.handle('arena:openBuilder', async (_event, payload) => {
  return openArenaBuilderForPrompt(payload?.prompt || '', { source: payload?.source || 'arena-desk' })
})

ipcMain.handle('automation:openArena', async (_event, payload) => {
  const job = automationJobs().find(j => j.id === payload?.jobId)
  if (!job) throw new Error('Automation job was not found')
  let rundown = job.rundown || null
  if (!rundown && job.rundownPath && fs.existsSync(job.rundownPath)) rundown = readJson(job.rundownPath, null)
  const prompt = payload?.prompt || rundown?.arenaPrompt || (rundown ? arenaPromptOf(rundown) : '')
  if (!prompt) throw new Error('No Arena prompt is available yet')
  const result = await openArenaBuilderForPrompt(prompt, { jobId: job.id, source: 'automation-button' })
  patchAutomation(job.id, { arenaOpenedAt: new Date().toISOString() })
  return result
})

// ---------------------------------------------------------------------------
// Footage ingest / FFmpeg analysis
// ---------------------------------------------------------------------------

function mediaToolStatus() {
  ffmpegPath = candidateBinaryPath(ffmpegPath) || resolveMediaTool('ffmpeg')
  ffprobePath = candidateBinaryPath(ffprobePath) || resolveMediaTool('ffprobe')
  return {
    ffmpeg: ffmpegPath || null,
    ffprobe: ffprobePath || null,
    ready: Boolean(ffmpegPath && ffprobePath),
  }
}

function assertMediaTools() {
  const status = mediaToolStatus()
  if (!status.ready) {
    throw new Error('FFmpeg/FFprobe binaries are unavailable in this build. Run a clean install so ffmpeg-static and ffprobe-static can download their native binaries, or set CUPRIC_FFMPEG_PATH and CUPRIC_FFPROBE_PATH.')
  }
}

function stopChild(child) {
  if (!child || child.killed) return
  try {
    if (process.platform === 'win32') {
      spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true })
    } else {
      child.kill('SIGTERM')
      setTimeout(() => {
        try {
          if (!child.killed) child.kill('SIGKILL')
        } catch {}
      }, 1500).unref?.()
    }
  } catch {}
}

function runProcess(jobState, bin, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { windowsHide: true, cwd: options.cwd || undefined })
    let stdout = ''
    let stderr = ''
    if (jobState) jobState.processes.add(child)
    child.stdout?.on('data', (chunk) => {
      stdout += chunk.toString('utf8')
      if (stdout.length > 20 * 1024 * 1024) stdout = stdout.slice(-10 * 1024 * 1024)
      options.onStdout?.(chunk)
    })
    child.stderr?.on('data', (chunk) => {
      const text = chunk.toString('utf8')
      stderr += text
      if (stderr.length > 20 * 1024 * 1024) stderr = stderr.slice(-10 * 1024 * 1024)
      options.onStderr?.(text)
    })
    child.on('error', (err) => {
      if (jobState) jobState.processes.delete(child)
      reject(err)
    })
    child.on('close', (code, signal) => {
      if (jobState) jobState.processes.delete(child)
      if (jobState?.cancelled) reject(new Error('Render cancelled'))
      else if (code === 0) resolve({ stdout, stderr })
      else {
        const err = new Error(`Process failed (${code ?? signal}): ${stderr.slice(-1800)}`)
        err.stderr = stderr
        reject(err)
      }
    })
  })
}

function runProcessBuffer(jobState, bin, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { windowsHide: true, cwd: options.cwd || undefined })
    const chunks = []
    let stderr = ''
    if (jobState) jobState.processes.add(child)
    child.stdout?.on('data', (chunk) => chunks.push(Buffer.from(chunk)))
    child.stderr?.on('data', (chunk) => {
      stderr += chunk.toString('utf8')
      if (stderr.length > 4 * 1024 * 1024) stderr = stderr.slice(-2 * 1024 * 1024)
      options.onStderr?.(chunk.toString('utf8'))
    })
    child.on('error', (err) => {
      if (jobState) jobState.processes.delete(child)
      reject(err)
    })
    child.on('close', (code, signal) => {
      if (jobState) jobState.processes.delete(child)
      if (jobState?.cancelled) reject(new Error('Render cancelled'))
      else if (code === 0) resolve({ buffer: Buffer.concat(chunks), stderr })
      else reject(new Error(`Process failed (${code ?? signal}): ${stderr.slice(-1800)}`))
    })
  })
}

async function probeMedia(filePath) {
  assertMediaTools()
  const result = await runProcess(null, ffprobePath, ['-v', 'error', '-print_format', 'json', '-show_streams', '-show_format', filePath])
  const data = JSON.parse(result.stdout || '{}')
  const durationSec = Number(data?.format?.duration) || Number(data?.streams?.find((s) => s.codec_type === 'video')?.duration) || 0
  const hasAudio = Array.isArray(data.streams) && data.streams.some((stream) => stream.codec_type === 'audio')
  return { durationSec, hasAudio, streams: data.streams || [] }
}

function parseSilence(stderr, durationSec) {
  const ranges = []
  let currentStart = null
  for (const line of String(stderr || '').split(/\r?\n/)) {
    const start = line.match(/silence_start:\s*([0-9.]+)/)
    if (start) currentStart = Number(start[1])
    const end = line.match(/silence_end:\s*([0-9.]+)/)
    if (end && currentStart !== null) {
      const a = Math.max(0, currentStart)
      const b = Math.min(durationSec || Number(end[1]), Number(end[1]))
      if (b > a) ranges.push([Math.round(a * 10) / 10, Math.round(b * 10) / 10])
      currentStart = null
    }
  }
  if (currentStart !== null && durationSec > currentStart) ranges.push([Math.round(currentStart * 10) / 10, Math.round(durationSec * 10) / 10])
  return ranges
}

function parseCaptionSidecar(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return []
  const text = fs.readFileSync(filePath, 'utf8').replace(/^WEBVTT\s*/i, '')
  const stamp = (s) => { const p = s.replace(',', '.').split(':').map(Number); return p.length === 3 ? p[0] * 3600 + p[1] * 60 + p[2] : p[0] * 60 + p[1] }
  return text.split(/\n\s*\n/).map(block => {
    const m = block.match(/(\d{1,2}:\d{2}:\d{2}[.,]\d{3}|\d{1,2}:\d{2}[.,]\d{3})\s*-->\s*(\d{1,2}:\d{2}:\d{2}[.,]\d{3}|\d{1,2}:\d{2}[.,]\d{3})[\s\S]*?\n([\s\S]*)/)
    if (!m) return null
    return { start: stamp(m[1]), end: stamp(m[2]), text: m[3].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim() }
  }).filter(c => c && c.text && c.end > c.start)
}

function waveformFromPcm(buffer, bars = 88) {
  if (!buffer?.length) return []
  const sampleCount = Math.floor(buffer.length / 2)
  const bucketSize = Math.max(1, Math.floor(sampleCount / bars))
  const values = []
  for (let bucket = 0; bucket < bars; bucket += 1) {
    const start = bucket * bucketSize
    const end = bucket === bars - 1 ? sampleCount : Math.min(sampleCount, start + bucketSize)
    let peak = 0
    for (let i = start; i < end; i += 1) {
      const v = Math.abs(buffer.readInt16LE(i * 2)) / 32768
      if (v > peak) peak = v
    }
    values.push(Math.max(0.04, Math.min(1, Math.round(peak * 1000) / 1000)))
  }
  return values
}

async function buildWaveform(videoPath, durationSec) {
  const maxSeconds = Math.min(Math.max(durationSec || 0, 1), 600)
  const { buffer } = await runProcessBuffer(null, ffmpegPath, [
    '-v',
    'error',
    '-t',
    String(maxSeconds),
    '-i',
    videoPath,
    '-vn',
    '-ac',
    '1',
    '-ar',
    '8000',
    '-f',
    's16le',
    '-',
  ])
  return waveformFromPcm(buffer)
}

/**
 * Studio export → MP4.
 *
 * The renderer records the canvas to WebM (that is all MediaRecorder can do in
 * Chromium), sends the bytes here, and FFmpeg remuxes/transcodes them to H.264
 * MP4 so the file plays anywhere. Without FFmpeg we say so instead of silently
 * renaming a WebM to .mp4.
 */
async function executeStudioWebmJob(state, payload) {
  const bytes = payload?.bytes
  if (!bytes || !bytes.byteLength) throw new Error('No recording was received from the Studio.')
  const outDir = userDataPath('renders', state.id)
  ensureDir(outDir)
  const base = safeFileName(String(payload?.fileName || 'cupric-studio'), 'cupric-studio').replace(/\.(webm|mp4)$/i, '')
  const outputPath = path.join(outDir, `${base}.webm`)
  await ensureNotCancelled(state)
  await fsp.writeFile(outputPath, Buffer.from(bytes))
  const { size } = await fsp.stat(outputPath)
  if (payload?.reveal !== false) shell.showItemInFolder(outputPath)
  return { outputPath, bytes: size }
}

async function executeStudioMp4Job(state, payload) {
  const bytes = payload?.bytes
  if (!bytes || !bytes.byteLength) throw new Error('No recording was received from the Studio.')

  ffmpegPath = candidateBinaryPath(ffmpegPath) || resolveMediaTool('ffmpeg')
  if (!ffmpegPath) {
    throw new Error('FFmpeg is unavailable in this build, so the WebM cannot be converted. Set CUPRIC_FFMPEG_PATH or install a build with ffmpeg-static unpacked.')
  }

  const outDir = userDataPath('renders', state.id)
  ensureDir(outDir)
  const base = safeFileName(String(payload?.fileName || 'cupric-studio'), 'cupric-studio').replace(/\.(webm|mp4)$/i, '')
  const source = path.join(outDir, `${base}.webm`)
  const outputPath = path.join(outDir, `${base}.mp4`)

  await fsp.writeFile(source, Buffer.from(bytes))

  const fps = Number(payload?.fps) > 0 ? Math.round(Number(payload.fps)) : 30
  const crf = String(Math.max(14, Math.min(32, Number(payload?.crf) || 18)))
  const buildArgs = (videoArgs) => [
    '-y',
    '-hide_banner',
    '-v', 'error',
    '-i', source,
    '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2:flags=lanczos,setsar=1',
    ...videoArgs,
    '-r', String(fps),
    '-movflags', '+faststart',
    ...encoders.loudnormArgs(payload?.loudnessTarget),
    '-c:a', 'aac',
    '-b:a', '192k',
    outputPath,
  ]

  try {
    await ensureNotCancelled(state)
    if (payload?.crf) {
      await runProcess(state, ffmpegPath, buildArgs(['-c:v', 'libx264', '-preset', 'medium', '-crf', crf, '-profile:v', 'high', '-pix_fmt', 'yuv420p']))
    } else {
      await runEncode(state, 'final', buildArgs)
    }
  } catch (err) {
    await fsp.rm(source, { force: true })
    throw new Error(`FFmpeg could not convert the recording: ${err?.message || String(err)}`)
  }

  if (!fs.existsSync(outputPath)) {
    await fsp.rm(source, { force: true })
    throw new Error('FFmpeg reported success but produced no file.')
  }

  await fsp.rm(source, { force: true })
  const { size } = await fsp.stat(outputPath)
  if (payload?.reveal !== false) shell.showItemInFolder(outputPath)
  return { outputPath, bytes: size }
}

async function executeStudioBackgroundJob(state, payload) {
  const doc = payload?.doc
  if (!doc || !Array.isArray(doc.clips)) throw new Error('Studio export did not include an editable timeline.')
  const width = Number(payload?.width) > 0 ? Math.round(Number(payload.width)) : 1920
  const height = Number(payload?.height) > 0 ? Math.round(Number(payload.height)) : 1080
  const win = await createHiddenWindow(width, height)
  state.windows.add(win)
  state.captureWindow = win
  state.captureSender = win.webContents
  const recording = new Promise((resolve, reject) => {
    state.recordingResolve = resolve
    state.recordingReject = reject
  })
  try {
    if (DEV_URL) await win.loadURL(DEV_URL)
    else await win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))
    await ensureNotCancelled(state)
    // F-2: resolve every asset URL *here*, where the roots are known. The
    // 0.13.0 renderer asked `arena:previewPath` per asset and one rejection
    // killed the whole job — seven `render-queue-error`s from one batch.
    const assets = (Array.isArray(payload.assets) ? payload.assets : []).map((asset) => {
      if (!asset?.localPath) return { ...asset, url: '' }
      const verdict = resolveProjectDataPath(asset.localPath)
      if (!verdict.ok) {
        logLine('export-asset-skipped', verdict.message, { jobId: state.id, asset: asset.id })
        return { ...asset, url: '', unusable: verdict.message }
      }
      return { ...asset, localPath: verdict.canonical, url: pathToFileURL(verdict.canonical).toString() }
    })
    const skipped = assets.filter((a) => a.unusable)
    if (skipped.length) sendRenderQueueStatus(state, 'working', 0, { warning: `${skipped.length} clip${skipped.length === 1 ? '' : 's'} could not be read from disk and were skipped: ${skipped.map((a) => a.fileName || a.id).join(', ')}` })
    win.webContents.send('studio:backgroundExport', {
      jobId: state.id,
      doc,
      assets,
      fileName: payload.fileName,
      scale: Number(payload.scale) > 0 ? Number(payload.scale) : 1,
    })
    const submitted = await recording
    await ensureNotCancelled(state)
    const outputPayload = { ...payload, ...(submitted || {}) }
    return payload.format === 'webm'
      ? await executeStudioWebmJob(state, outputPayload)
      : await executeStudioMp4Job(state, outputPayload)
  } finally {
    state.recordingResolve = null
    state.recordingReject = null
    state.captureWindow = null
    state.captureSender = null
    state.windows.delete(win)
    if (!win.isDestroyed()) win.destroy()
  }
}

ipcMain.handle('studio:submitRecording', (event, payload) => {
  const id = String(payload?.jobId || '')
  const state = renderJobs.get(id)
  if (!state || state.kind !== 'studio-background' || state.captureSender !== event.sender) throw new Error('That Studio export is no longer accepting a recording.')
  if (!payload?.bytes || !payload.bytes.byteLength) throw new Error('The background Studio recorder returned an empty file.')
  state.recordingResolve?.({ bytes: payload.bytes })
  return { accepted: true }
})

ipcMain.handle('studio:recordingError', (event, payload) => {
  const id = String(payload?.jobId || '')
  const state = renderJobs.get(id)
  if (!state || state.kind !== 'studio-background' || state.captureSender !== event.sender) return false
  state.recordingReject?.(new Error(String(payload?.error || 'Background Studio recording failed.')))
  return true
})

ipcMain.handle('studio:progress', (event, payload) => {
  const id = String(payload?.jobId || '')
  const state = renderJobs.get(id)
  if (!state || state.kind !== 'studio-background' || state.captureSender !== event.sender) return false
  sendRenderEvent(state.sender, 'render:progress', { jobId: id, pct: Math.max(0, Math.min(100, Number(payload?.pct) || 0)) })
  return true
})

ipcMain.handle('studio:exportMp4', async (event, payload) => {
  const background = Boolean(payload?.background)
  if (!background || payload?.format !== 'webm') assertMediaTools()
  const id = uid('studio-export')
  const state = {
    id,
    kind: background ? 'studio-background' : 'studio-mp4',
    payload: { ...(payload || {}) },
    captureSender: null,
    event,
    sender: event.sender,
    status: 'queued',
    codec: payload?.codec === 'av1' ? 'av1' : 'h264',
    cancelled: false,
    paused: false,
    processes: new Set(),
    windows: new Set(),
    resumeWaiters: [],
  }
  renderJobs.set(id, state)
  renderQueue.push(state)
  sendRenderQueueStatus(state, 'queued', 0)
  void pumpRenderQueue()
  return { jobId: id, status: 'queued' }
})

ipcMain.handle('media:status', () => mediaToolStatus())

/* ——— offline voice input (1.10) ——— */
// Whisper (whisper.cpp) first, Windows Speech Recognition second; the
// renderer shows its existing friendly message when neither is available.
let windowsSpeechAvailable = null

function whisperSetup() {
  return voiceEngines.findWhisper({
    env: process.env,
    dirs: [
      process.resourcesPath ? path.join(process.resourcesPath, 'whisper') : null,
      userDataPath('whisper'),
      path.join(__dirname, '..', 'vendor', 'whisper'),
    ],
    platform: process.platform,
    exists: (p) => fs.existsSync(p),
    list: (d) => fs.readdirSync(d),
  })
}

async function probeWindowsSpeech() {
  if (process.platform !== 'win32') return false
  if (windowsSpeechAvailable !== null) return windowsSpeechAvailable
  try {
    const { stdout } = await runProcess(null, 'powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', voiceEngines.WINDOWS_SPEECH_PROBE])
    windowsSpeechAvailable = Number(String(stdout).trim()) > 0
  } catch (err) {
    windowsSpeechAvailable = false
    logLine('voice-windows-probe-failed', err?.message || String(err))
  }
  return windowsSpeechAvailable
}

function piperDirs() {
  return [
    process.resourcesPath ? path.join(process.resourcesPath, 'piper') : null,
    userDataPath('piper'),
    path.join(__dirname, '..', 'vendor', 'piper'),
  ].filter(Boolean)
}
ipcMain.handle('voice:tts', async (_event, payload) => tts.synthesize(payload, process.platform, { piperDirs: piperDirs() }))

ipcMain.handle('voice:status', async () => {
  const whisper = whisperSetup()
  const windows = await probeWindowsSpeech()
  return {
    whisper: Boolean(whisper),
    windows,
    engine: whisper ? 'whisper' : windows ? 'windows' : null,
    whisperModel: whisper ? path.basename(whisper.model) : null,
    // Offline voiceover languages: Piper models found (en/hi); the OS voice is probed on use.
    piper: (() => { const p = tts.piperSetup({ platform: process.platform, dirs: piperDirs() }); return p ? { en: Boolean(p.models.en), hi: Boolean(p.models.hi) } : null })(),
    piperFolder: userDataPath('piper'),
  }
})

ipcMain.handle('voice:transcribe', async (_event, payload) => {
  const bytes = payload?.wav
  if (!bytes || !bytes.byteLength) return { text: '', engine: null }
  if (bytes.byteLength > 8 * 1024 * 1024) throw new Error('That recording is too long to transcribe in one go.')
  const dir = userDataPath('voice-tmp')
  ensureDir(dir)
  const base = path.join(dir, `utt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
  const wavPath = `${base}.wav`
  await fsp.writeFile(wavPath, Buffer.from(bytes))
  const failures = []
  try {
    const whisper = whisperSetup()
    if (whisper) {
      try {
        await runProcess(null, whisper.bin, voiceEngines.whisperArgs({ model: whisper.model, wavPath, outBase: base, lang: payload?.lang, threads: Math.max(1, os.cpus().length - 1) }), { cwd: path.dirname(whisper.bin) })
        const text = voiceEngines.cleanTranscript(await fsp.readFile(`${base}.txt`, 'utf8').catch(() => ''))
        return { text, engine: 'whisper' }
      } catch (err) {
        failures.push(`Whisper: ${String(err?.message || err).slice(0, 300)}`)
      }
    }
    if (await probeWindowsSpeech()) {
      try {
        const { stdout } = await runProcess(null, 'powershell.exe', voiceEngines.windowsSpeechArgs(wavPath))
        return { text: voiceEngines.cleanTranscript(stdout), engine: 'windows' }
      } catch (err) {
        failures.push(`Windows Speech: ${String(err?.message || err).slice(0, 300)}`)
      }
    }
    if (failures.length) logLine('voice-transcribe-failed', failures.join(' | '))
    const error = new Error(failures.length ? 'Offline speech recognition failed on this recording.' : 'No offline speech engine is installed.')
    error.code = failures.length ? 'engine-failed' : 'no-engine'
    throw error
  } finally {
    fsp.rm(wavPath, { force: true }).catch(() => {})
    fsp.rm(`${base}.txt`, { force: true }).catch(() => {})
  }
})

/**
 * Auto-captions: transcribe a whole clip on disk WITH word timings.
 * Whisper gives per-word times; Windows Speech gives per-phrase times (the
 * reply says which, so the UI never overstates accuracy).
 */
ipcMain.handle('voice:transcribeMedia', async (_event, payload) => {
  const sourcePath = payload?.path
  if (typeof sourcePath !== 'string' || !path.isAbsolute(sourcePath) || !fs.existsSync(sourcePath)) throw new Error('That clip has no file on disk to transcribe — import it from disk in the desktop app.')
  if (!/\.(mp4|mov|m4v|mkv|webm|avi|mp3|wav|m4a|aac|flac|ogg|opus)$/i.test(sourcePath)) throw new Error('Only audio and video files can be transcribed.')
  ffmpegPath = candidateBinaryPath(ffmpegPath) || resolveMediaTool('ffmpeg')
  if (!ffmpegPath) throw new Error('FFmpeg is unavailable, so the clip’s audio cannot be read.')
  const whisper = whisperSetup()
  const windows = !whisper && (await probeWindowsSpeech())
  if (!whisper && !windows) {
    const error = new Error('No offline speech engine is installed. Run `npm run whisper:fetch` (or install Windows Speech) to enable auto-captions.')
    error.code = 'no-engine'
    throw error
  }
  const dir = userDataPath('voice-tmp')
  ensureDir(dir)
  const base = path.join(dir, `media-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
  const wavPath = `${base}.wav`
  try {
    await runProcess(null, ffmpegPath, voiceEngines.extractWavArgs(sourcePath, wavPath))
    if (whisper) {
      await runProcess(null, whisper.bin, voiceEngines.whisperWordArgs({ model: whisper.model, wavPath, outBase: base, lang: payload?.lang, threads: Math.max(1, os.cpus().length - 1) }), { cwd: path.dirname(whisper.bin) })
      const words = voiceEngines.parseWhisperWords(await fsp.readFile(`${base}.json`, 'utf8'))
      return { engine: 'whisper', timing: 'word', words }
    }
    const { stdout } = await runProcess(null, 'powershell.exe', voiceEngines.windowsTimedArgs(wavPath))
    return { engine: 'windows', timing: 'phrase', words: voiceEngines.parseWindowsPhrases(stdout) }
  } finally {
    for (const ext of ['.wav', '.json', '.txt']) fsp.rm(`${base}${ext}`, { force: true }).catch(() => {})
  }
})

ipcMain.handle('dialog:pickFolder', async () => {
  const result = await dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory'] })
  return result.canceled ? null : result.filePaths[0]
})

ipcMain.handle('dialog:pickFootage', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openFile'],
    filters: [{ name: 'Video', extensions: ['mp4', 'mov', 'm4v', 'webm', 'mkv', 'avi'] }],
  })
  return result.canceled ? null : result.filePaths[0]
})

ipcMain.handle('footage:analyze', async (_event, payload) => {
  assertMediaTools()
  const srcPath = payload?.srcPath
  const projectId = payload?.projectId || 'default'
  if (!srcPath) throw new Error('No footage selected')
  if (!fs.existsSync(srcPath)) throw new Error('Footage file does not exist')

  const dir = path.join(projectRoot(projectId), 'footage')
  ensureDir(dir)
  const dest = path.join(dir, `${Date.now()}-${safeFileName(path.basename(srcPath), 'footage.mp4')}`)
  fs.copyFileSync(srcPath, dest)

  const settings = publicSettings()
  const { durationSec } = await probeMedia(dest)
  const silence = await runProcess(null, ffmpegPath, [
    '-hide_banner',
    '-i',
    dest,
    '-af',
    `silencedetect=noise=${settings.silenceNoiseDb}dB:d=${settings.silenceMinDuration}`,
    '-f',
    'null',
    '-',
  ])
  let waveform = []
  try {
    waveform = await buildWaveform(dest, durationSec)
  } catch (err) {
    logLine('waveform-failed', err?.message || String(err))
  }
  return {
    name: path.basename(srcPath),
    videoPath: dest,
    durationSec: Math.round((durationSec || 0) * 10) / 10,
    silenceRanges: parseSilence(silence.stderr, durationSec),
    waveform,
  }
})

// ---------------------------------------------------------------------------
// Render pipeline
// ---------------------------------------------------------------------------

function evenInt(n, fallback) {
  const r = Math.round(Number(n) || fallback)
  return r % 2 === 0 ? r : r + 1
}
function targetSizeForAspect(aspect, size) {
  if (Array.isArray(size) && size.length >= 2) {
    return { width: evenInt(size[0], 1920), height: evenInt(size[1], 1080) }
  }
  if (aspect === '9:16') return { width: 1080, height: 1920 }
  if (aspect === '1:1') return { width: 1080, height: 1080 }
  return { width: 1920, height: 1080 }
}

function crfForQuality(quality) {
  return quality === 'final' ? '18' : '28'
}

function presetForQuality(quality) {
  return quality === 'final' ? 'slow' : 'veryfast'
}

/* ——— hardware-accelerated encoding (2.24) ——— */
// Detected once per session (a tiny real test encode per candidate), then
// reused. If a hardware encoder fails mid-render the segment is re-encoded
// with libx264 and hardware is disabled for the rest of the session.
const encoderSession = { result: null, pending: null, disabledReason: null }

function hardwareEncodingMode() {
  const mode = readSettings().hardwareEncoding
  return mode === 'off' ? 'off' : 'auto'
}

async function currentVideoEncoder() {
  if (encoderSession.disabledReason) return encoders.SOFTWARE
  if (encoderSession.result) return encoderSession.result.name
  if (!encoderSession.pending) {
    encoderSession.pending = encoders
      .detect((args) => runProcess(null, ffmpegPath, args), process.platform, hardwareEncodingMode())
      .then((result) => {
        encoderSession.result = result
        logLine('video-encoder', result.reason, { name: result.name, tried: result.tried, errors: result.errors, legacy: !!result.legacy })
        return result
      })
      .finally(() => { encoderSession.pending = null })
  }
  return (await encoderSession.pending).name
}

function videoEncoderState() {
  const r = encoderSession.result
  if (!r) return encoderSession.disabledReason ? { name: encoders.SOFTWARE, hardware: false, tried: [], reason: encoderSession.disabledReason } : null
  if (encoderSession.disabledReason) return { name: encoders.SOFTWARE, hardware: false, tried: r.tried, reason: encoderSession.disabledReason }
  return r
}

/**
 * Run an FFmpeg encode whose video arguments come from the chosen encoder.
 * `build(videoArgs)` returns the full argument list.
 */
async function runEncode(state, quality, build, options) {
  const name = await currentVideoEncoder()
  const codec = state?.codec === 'av1' ? 'av1' : 'h264'
  try {
    return await runProcess(state, ffmpegPath, build(encoders.videoArgs(name, quality, codec)), options)
  } catch (err) {
    if (!encoders.isHardware(name) || state?.cancelled) throw err
    encoderSession.disabledReason = `${name} failed during a render; switched to libx264 for this session.`
    logLine('video-encoder-fallback', encoderSession.disabledReason, { error: String(err?.message || err).slice(-600) })
    if (state) state.encoderSwitched = true
    return runProcess(state, ffmpegPath, build(encoders.videoArgs(codec === 'av1' ? encoders.AV1_SOFTWARE : encoders.SOFTWARE, quality, codec)), options)
  }
}

function renderOutputName(name) {
  const safe = safeFileName(name || 'cupric-render.mp4', 'cupric-render.mp4')
  return /\.mp4$/i.test(safe) ? safe : `${safe}.mp4`
}

function sendRenderEvent(sender, channel, payload) {
  try {
    if (!sender.isDestroyed()) sender.send(channel, payload)
  } catch {}
}

async function ensureNotCancelled(state) {
  if (state.cancelled) throw new Error('Render cancelled')
  while (state.paused && !state.cancelled) {
    await new Promise((resolve) => state.resumeWaiters.push(resolve))
  }
  if (state.cancelled) throw new Error('Render cancelled')
}

function mediaPathFromSource(source) {
  return source?.htmlPath || source?.arenaPath || source?.localPath || source?.videoPath || source?.footagePath || null
}

function durationOfSource(source) {
  const explicit = Number(source?.durationSec)
  if (Number.isFinite(explicit) && explicit > 0) return explicit
  const start = Number(source?.in || 0)
  const end = Number(source?.out)
  if (Number.isFinite(end) && end > start) return end - start
  return 3
}

function ffmpegProgressSeconds(text) {
  const ms = text.match(/out_time_ms=(\d+)/)
  if (ms) return Number(ms[1]) / 1_000_000
  const us = text.match(/out_time_us=(\d+)/)
  if (us) return Number(us[1]) / 1_000_000
  const time = text.match(/time=(\d+):(\d+):(\d+(?:\.\d+)?)/)
  if (time) return Number(time[1]) * 3600 + Number(time[2]) * 60 + Number(time[3])
  return null
}

function videoFilter({ width, height }, captionsAssPath) {
  const filters = [
    `scale=${width}:${height}:force_original_aspect_ratio=increase`,
    `crop=${width}:${height}`,
    'setsar=1',
    'format=yuv420p',
  ]
  if (captionsAssPath) filters.push(`subtitles=${escapeFilterPath(captionsAssPath)}`)
  return filters.join(',')
}

function escapeFilterPath(filePath) {
  return String(filePath).replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "\\'")
}

function assTimestamp(sec) {
  const value = Math.max(0, Number(sec) || 0)
  const h = Math.floor(value / 3600)
  const m = Math.floor((value % 3600) / 60)
  const s = Math.floor(value % 60)
  const cs = Math.floor((value - Math.floor(value)) * 100)
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`
}

function writeAss(captions, style, target, outFile) {
  if (!Array.isArray(captions) || captions.length === 0) return null
  const fontSize = style === 'minimal' ? 42 : style === 'hormozi' ? 78 : 56
  const primary = style === 'hormozi' ? '&H00F2F5C8' : '&H00FFFFFF'
  const outline = style === 'minimal' ? 2 : 5
  const marginV = style === 'minimal' ? 110 : 150
  const events = captions
    .map((caption) => {
      const text = String(caption.text || caption.copy || '').replace(/[\r\n]+/g, ' ').replace(/,/g, '،')
      if (!text) return null
      return `Dialogue: 0,${assTimestamp(caption.start ?? caption.from ?? 0)},${assTimestamp(caption.end ?? caption.to ?? 1)},Default,,0,0,0,,${text}`
    })
    .filter(Boolean)
    .join('\n')
  const ass = `[Script Info]
ScriptType: v4.00+
PlayResX: ${target.width}
PlayResY: ${target.height}
WrapStyle: 0
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Inter,${fontSize},${primary},&H000000FF,&H00101010,&H99000000,-1,0,0,0,100,100,0,0,1,${outline},1,2,80,80,${marginV},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
${events}
`
  fs.writeFileSync(outFile, ass, 'utf8')
  return outFile
}

function intervalsWithoutCuts(start, end, cuts) {
  let cursor = start
  const intervals = []
  const sorted = (Array.isArray(cuts) ? cuts : [])
    .map(([a, b]) => [Number(a), Number(b)])
    .filter(([a, b]) => Number.isFinite(a) && Number.isFinite(b) && b > a)
    .sort((a, b) => a[0] - b[0])

  for (const [cutStartRaw, cutEndRaw] of sorted) {
    const cutStart = Math.max(start, cutStartRaw)
    const cutEnd = Math.min(end, cutEndRaw)
    if (cutEnd <= cursor || cutStart >= end) continue
    if (cutStart > cursor) intervals.push([cursor, cutStart])
    cursor = Math.max(cursor, cutEnd)
  }
  if (cursor < end) intervals.push([cursor, end])
  return intervals.filter(([a, b]) => b - a >= 0.05)
}

async function renderArenaSegment(state, source, ctx) {
  await ensureNotCancelled(state)
  const duration = Math.min(MAX_RENDER_DURATION_SEC, durationOfSource(source))
  const frameCount = Math.max(1, Math.ceil(duration * ctx.fps))
  const frameDir = path.join(ctx.workDir, `arena-frames-${ctx.segmentIndex}`)
  const segmentPath = path.join(ctx.workDir, `segment-${String(ctx.segmentIndex).padStart(4, '0')}.mp4`)
  ensureDir(frameDir)

  const arenaPath = source.htmlPath || source.arenaPath || source.localPath
  if (!arenaPath || !fs.existsSync(arenaPath)) throw new Error('Arena source file is missing')

  const win = await createHiddenWindow(ctx.target.width, ctx.target.height)
  state.windows.add(win)
  try {
    await win.loadFile(arenaPath)
    const hasSeek = await win.webContents.executeJavaScript('typeof window.__seek === "function"', true)
    if (!hasSeek) throw new Error('Arena source does not expose window.__seek(t)')
    for (let i = 0; i < frameCount; i += 1) {
      await ensureNotCancelled(state)
      const t = (Number(source.in) || 0) + i / ctx.fps
      await win.webContents.executeJavaScript(`window.__seek(${JSON.stringify(t)})`, true)
      await win.webContents.executeJavaScript('new Promise((resolve) => requestAnimationFrame(() => resolve(true)))', true)
      const img = exactFrame(await win.webContents.capturePage(), ctx.target.width, ctx.target.height)
      await fsp.writeFile(path.join(frameDir, `${String(i + 1).padStart(6, '0')}.png`), img.toPNG())
      ctx.onUnits(frameCount > 1 ? i + 1 : frameCount)
    }
  } finally {
    state.windows.delete(win)
    if (!win.isDestroyed()) win.destroy()
  }

  await runEncode(state, ctx.quality, (v) => [
    '-y',
    '-hide_banner',
    // A PNG sequence feeds faster than libx264 consumes it; the default
    // 8-packet queue produced "thread_queue_size" warnings and stalls.
    '-thread_queue_size',
    '512',
    '-framerate',
    String(ctx.fps),
    '-i',
    path.join(frameDir, '%06d.png'),
    '-thread_queue_size',
    '512',
    '-f',
    'lavfi',
    '-t',
    String(duration),
    '-i',
    'anullsrc=channel_layout=stereo:sample_rate=48000',
    '-map',
    '0:v:0',
    '-map',
    '1:a:0',
    '-r',
    String(ctx.fps),
    '-vf',
    evenFrameFilter(ctx.target.width, ctx.target.height),
    ...v,
    '-c:a',
    'aac',
    '-ar',
    '48000',
    '-ac',
    '2',
    '-shortest',
    segmentPath,
  ])

  return { path: segmentPath, duration }
}

async function renderFootageInterval(state, source, interval, ctx, hasAudio) {
  await ensureNotCancelled(state)
  const [start, end] = interval
  const duration = Math.max(0.05, end - start)
  const segmentPath = path.join(ctx.workDir, `segment-${String(ctx.segmentIndex).padStart(4, '0')}.mp4`)
  const assPath = writeAss(source.captions, source.captionStyle || 'standard', ctx.target, path.join(ctx.workDir, `captions-${ctx.segmentIndex}.ass`))
  const vf = videoFilter(ctx.target, assPath)

  const progressArgs = ['-progress', 'pipe:2', '-nostats']
  const base = ['-y', '-hide_banner', ...progressArgs, '-ss', String(start), '-t', String(duration), '-i', source.videoPath || source.footagePath]
  const output = (v) => [
    '-vf',
    vf,
    '-r',
    String(ctx.fps),
    ...v,
    '-c:a',
    'aac',
    '-ar',
    '48000',
    '-ac',
    '2',
    '-shortest',
    segmentPath,
  ]
  const args = (v) => hasAudio
    ? [...base, '-map', '0:v:0', '-map', '0:a:0', ...output(v)]
    : [...base, '-f', 'lavfi', '-t', String(duration), '-i', 'anullsrc=channel_layout=stereo:sample_rate=48000', '-map', '0:v:0', '-map', '1:a:0', ...output(v)]

  let lastUnits = 0
  await runEncode(state, ctx.quality, args, {
    onStderr: (text) => {
      const seconds = ffmpegProgressSeconds(text)
      if (seconds !== null) {
        lastUnits = Math.max(lastUnits, Math.min(duration, seconds) * ctx.fps)
        ctx.onUnits(lastUnits)
      }
    },
  })
  ctx.onUnits(duration * ctx.fps)
  return { path: segmentPath, duration }
}

async function renderFootageSegments(state, source, ctx) {
  const videoPath = source.videoPath || source.footagePath || source.localPath
  if (!videoPath || !fs.existsSync(videoPath)) throw new Error('Footage source file is missing')
  const probe = await probeMedia(videoPath)
  const sourceStart = Math.max(0, Number(source.in) || 0)
  const desiredDuration = Math.min(durationOfSource(source), Math.max(0.1, (probe.durationSec || durationOfSource(source)) - sourceStart))
  const sourceEnd = Math.min(Number(source.out) || sourceStart + desiredDuration, sourceStart + desiredDuration, probe.durationSec || sourceStart + desiredDuration)
  const cuts = source.applySilenceCuts ? source.silenceRanges : []
  const intervals = intervalsWithoutCuts(sourceStart, sourceEnd, cuts)
  if (intervals.length === 0) throw new Error('Footage clip has no audible intervals after silence cuts')

  const results = []
  for (const interval of intervals) {
    const result = await renderFootageInterval(state, source, interval, ctx, probe.hasAudio)
    results.push(result)
    ctx.segmentIndex += 1
  }
  return results
}

async function concatSegments(state, segments, outputPath, ctx) {
  await ensureNotCancelled(state)
  if (segments.length === 1) {
    await fsp.copyFile(segments[0].path, outputPath)
    return
  }
  const listPath = path.join(ctx.workDir, 'concat.txt')
  const body = segments.map((segment) => `file '${String(segment.path).replace(/'/g, "'\\''")}'`).join(os.EOL)
  fs.writeFileSync(listPath, body, 'utf8')
  // Segments are stream-copied when they all came from one encoder. If a
  // hardware encoder failed part-way (see runEncode), the segments differ,
  // so they are re-encoded together instead of risking a broken file.
  const codec = state?.encoderSwitched
    ? [...encoders.videoArgs(state.codec === 'av1' ? encoders.AV1_SOFTWARE : encoders.SOFTWARE, 'final', state.codec === 'av1' ? 'av1' : 'h264'), '-c:a', 'aac', '-ar', '48000', '-ac', '2']
    : ['-c', 'copy']
  await runProcess(state, ffmpegPath, ['-y', '-hide_banner', '-f', 'concat', '-safe', '0', '-i', listPath, ...codec, '-movflags', '+faststart', outputPath])
}

async function executeRenderJob(event, job, queuedState = null) {
  assertMediaTools()
  const sender = event.sender
  const id = String(job?.id || uid('render'))
  const sources = Array.isArray(job?.sources) ? job.sources : []
  const fps = Number(job?.fps) === 60 ? 60 : 30
  const target = targetSizeForAspect(job?.aspect, job?.size)
  const quality = job?.quality === 'final' ? 'final' : 'draft'
  const outDir = userDataPath('renders', id)
  const workDir = path.join(outDir, 'work')
  const outputPath = path.join(outDir, renderOutputName(job?.outputName))

  const usableSources = sources.filter((source) => source && (source.sourceType || source.type) && mediaPathFromSource(source))
  if (usableSources.length === 0) throw new Error('Add an imported Arena asset or analyzed footage clip before rendering')

  const nominalDuration = usableSources.reduce((sum, source) => sum + durationOfSource(source), 0)
  if (nominalDuration > MAX_RENDER_DURATION_SEC) {
    throw new Error(`Timeline is ${Math.round(nominalDuration)}s. Cupric AI currently limits desktop renders to ${MAX_RENDER_DURATION_SEC}s.`)
  }

  fs.rmSync(workDir, { recursive: true, force: true })
  ensureDir(workDir)
  ensureDir(outDir)

  const state = queuedState || { id, cancelled: false, paused: false, processes: new Set(), windows: new Set(), resumeWaiters: [], sender }
  state.id = id
  state.sender = sender
  state.processes ||= new Set()
  state.windows ||= new Set()
  state.resumeWaiters ||= []
  renderJobs.set(id, state)

  const totalUnits = Math.max(1, usableSources.reduce((sum, source) => sum + Math.max(1, Math.ceil(durationOfSource(source) * fps)), 0))
  let completedUnits = 0
  let currentSourceUnits = 0
  const setProgress = (units) => {
    currentSourceUnits = Math.max(currentSourceUnits, units)
    const pct = Math.min(98, Math.max(1, ((completedUnits + currentSourceUnits) / totalUnits) * 92))
    sendRenderEvent(sender, 'render:progress', { jobId: id, pct })
  }

  try {
    sendRenderEvent(sender, 'render:progress', { jobId: id, pct: 1 })
    const segments = []
    for (const source of usableSources) {
      await ensureNotCancelled(state)
      currentSourceUnits = 0
      if (source.sourceType === 'arena' || source.type === 'arena') {
        const segment = await renderArenaSegment(state, source, {
          fps,
          quality,
          target,
          workDir,
          segmentIndex: segments.length,
          onUnits: setProgress,
        })
        segments.push(segment)
        completedUnits += Math.max(1, Math.ceil(segment.duration * fps))
      } else if (source.sourceType === 'footage' || source.type === 'footage') {
        const before = segments.length
        const newSegments = await renderFootageSegments(state, source, {
          fps,
          quality,
          target,
          workDir,
          segmentIndex: segments.length,
          onUnits: setProgress,
        })
        segments.push(...newSegments)
        const renderedUnits = newSegments.reduce((sum, segment) => sum + Math.max(1, Math.ceil(segment.duration * fps)), 0)
        completedUnits += renderedUnits
        // A clip with silence cuts can produce more sub-segments; ensure future segment names stay unique.
        if (segments.length <= before) throw new Error('Footage segment generation failed')
      }
      sendRenderEvent(sender, 'render:progress', { jobId: id, pct: Math.min(96, (completedUnits / totalUnits) * 92) })
    }

    if (segments.length === 0) throw new Error('No renderable timeline segments were produced')
    sendRenderEvent(sender, 'render:progress', { jobId: id, pct: 96 })
    await concatSegments(state, segments, outputPath, { workDir })
    sendRenderEvent(sender, 'render:progress', { jobId: id, pct: 100 })
    sendRenderEvent(sender, 'render:done', { jobId: id, outputPath })
    fs.rmSync(workDir, { recursive: true, force: true })
    return { outputPath }
  } catch (err) {
    const message = err?.message || String(err)
    sendRenderEvent(sender, 'render:error', { jobId: id, error: message })
    logLine('render-error', message, { jobId: id })
    throw err
  } finally {
    for (const child of state.processes) stopChild(child)
    for (const win of state.windows) {
      try {
        if (!win.isDestroyed()) win.destroy()
      } catch {}
    }
    renderJobs.delete(id)
  }
}

function sendRenderQueueStatus(state, status, pct = 0, extra = {}) {
  state.status = status
  sendRenderEvent(state.sender, 'render:progress', { jobId: state.id, status, pct, ...extra })
}

function resolveRenderPause(state) {
  const waiters = state.resumeWaiters || []
  state.resumeWaiters = []
  for (const resolve of waiters) resolve()
}

function suspendChild(child) {
  if (!child || child.killed || !child.pid) return
  try {
    if (process.platform === 'win32') {
      spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `Suspend-Process -Id ${Number(child.pid)}`], { windowsHide: true })
    } else child.kill('SIGSTOP')
  } catch {}
}

function resumeChild(child) {
  if (!child || child.killed || !child.pid) return
  try {
    if (process.platform === 'win32') {
      spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `Resume-Process -Id ${Number(child.pid)}`], { windowsHide: true })
    } else child.kill('SIGCONT')
  } catch {}
}

async function pumpRenderQueue() {
  if (renderQueueRunning) return
  renderQueueRunning = true
  try {
    while (renderQueue.length) {
      const state = renderQueue.shift()
      if (!state || state.cancelled) continue
      try {
        await ensureNotCancelled(state)
        state.active = true
        sendRenderQueueStatus(state, 'working', 0)
        const result = state.kind === 'studio-mp4'
          ? await executeStudioMp4Job(state, state.payload)
          : state.kind === 'studio-background'
            ? await executeStudioBackgroundJob(state, state.payload)
            : await executeRenderJob(state.event, state.job, state)
        if (state.kind === 'studio-mp4' || state.kind === 'studio-background') {
          sendRenderEvent(state.sender, 'render:done', { jobId: state.id, outputPath: result?.outputPath || null, bytes: result?.bytes || null })
        }
        sendRenderQueueStatus(state, 'done', 100, { outputPath: result?.outputPath || null })
      } catch (err) {
        const message = err?.message || String(err)
        if (state.kind === 'studio-mp4' || state.kind === 'studio-background') sendRenderEvent(state.sender, 'render:error', { jobId: state.id, error: state.cancelled ? 'Render cancelled' : message })
        if (state.cancelled) sendRenderQueueStatus(state, 'error', 0, { error: 'Render cancelled' })
        else {
          sendRenderQueueStatus(state, 'error', 0, { error: message })
          logLine('render-queue-error', message, { jobId: state.id })
        }
        state.active = false
        renderJobs.delete(state.id)
      }
    }
  } finally {
    renderQueueRunning = false
  }
}

ipcMain.handle('render:start', async (event, job) => {
  assertMediaTools()
  const id = String(job?.id || uid('render'))
  const state = {
    id,
    job: { ...(job || {}), id },
    event,
    sender: event.sender,
    status: 'queued',
    codec: job?.codec === 'av1' ? 'av1' : 'h264',
    cancelled: false,
    paused: false,
    processes: new Set(),
    windows: new Set(),
    resumeWaiters: [],
  }
  renderJobs.set(id, state)
  renderQueue.push(state)
  sendRenderQueueStatus(state, 'queued', 0)
  void pumpRenderQueue()
  return { jobId: id, status: 'queued' }
})

ipcMain.handle('render:cancel', (_event, payload) => {
  const id = String(payload?.jobId || '')
  const state = renderJobs.get(id)
  if (!state) return false
  state.cancelled = true
  state.paused = false
  state.recordingReject?.(new Error('Render cancelled'))
  resolveRenderPause(state)
  for (const child of state.processes) stopChild(child)
  for (const win of state.windows) {
    try {
      if (!win.isDestroyed()) win.destroy()
    } catch {}
  }
  sendRenderEvent(state.sender, 'render:error', { jobId: id, error: 'Render cancelled' })
  return true
})

ipcMain.handle('render:pause', (_event, payload) => {
  const id = String(payload?.jobId || '')
  const state = renderJobs.get(id)
  if (!state || state.cancelled || state.status === 'done' || state.status === 'error') return false
  state.paused = true
  sendRenderQueueStatus(state, 'paused', Number(payload?.pct) || 0)
  for (const child of state.processes) suspendChild(child)
  return true
})

ipcMain.handle('render:resume', (_event, payload) => {
  const id = String(payload?.jobId || '')
  const state = renderJobs.get(id)
  if (!state || state.cancelled || state.status === 'done' || state.status === 'error') return false
  state.paused = false
  for (const child of state.processes) resumeChild(child)
  resolveRenderPause(state)
  sendRenderQueueStatus(state, state.active ? 'working' : 'queued', 0)
  return true
})

ipcMain.handle('render:preview', (_event, outputPath) => {
  if (!outputPath || !fs.existsSync(outputPath)) throw new Error('Render output does not exist yet')
  // F-2: canonicalise before comparing — a Windows 8.3 or wrong-case spelling
  // of the very folder we wrote must not read as "outside".
  const renders = pathSandbox.resolveInsideRoots(outputPath, [userDataPath('renders')], { realpath: realpathNative, platform: process.platform })
  if (!renders.ok) throw outsideProjectDataError(outputPath, { ...renders, message: pathSandbox.outsideMessage(renders.canonical, [userDataPath('renders')]) })
  outputPath = renders.canonical
  return pathToFileURL(outputPath).toString()
})

ipcMain.handle('render:reveal', (_event, outputPath) => {
  if (!outputPath || !fs.existsSync(outputPath)) throw new Error('Render output does not exist yet')
  // F-2: canonicalise before comparing — a Windows 8.3 or wrong-case spelling
  // of the very folder we wrote must not read as "outside".
  const renders = pathSandbox.resolveInsideRoots(outputPath, [userDataPath('renders')], { realpath: realpathNative, platform: process.platform })
  if (!renders.ok) throw outsideProjectDataError(outputPath, { ...renders, message: pathSandbox.outsideMessage(renders.canonical, [userDataPath('renders')]) })
  outputPath = renders.canonical
  shell.showItemInFolder(outputPath)
  return true
})

ipcMain.handle('render:copyToDownloads', async (_event, outputPath) => {
  if (!outputPath || !fs.existsSync(outputPath)) throw new Error('Render output does not exist yet')
  // F-2: canonicalise before comparing — a Windows 8.3 or wrong-case spelling
  // of the very folder we wrote must not read as "outside".
  const renders = pathSandbox.resolveInsideRoots(outputPath, [userDataPath('renders')], { realpath: realpathNative, platform: process.platform })
  if (!renders.ok) throw outsideProjectDataError(outputPath, { ...renders, message: pathSandbox.outsideMessage(renders.canonical, [userDataPath('renders')]) })
  outputPath = renders.canonical
  const downloads = app.getPath('downloads')
  const dest = path.join(downloads, safeFileName(path.basename(outputPath), 'cupric-render.mp4'))
  await fsp.copyFile(outputPath, dest)
  shell.showItemInFolder(dest)
  return { outputPath: dest }
})

// ---------------------------------------------------------------------------
// Updater
// ---------------------------------------------------------------------------

function wireUpdater() {
  if (!autoUpdater) return
  autoUpdater.autoDownload = true
  autoUpdater.on('checking-for-update', () => mainWindow?.webContents.send('updater:status', { status: 'checking' }))
  autoUpdater.on('update-available', (info) => mainWindow?.webContents.send('updater:status', { status: 'available', version: info?.version }))
  autoUpdater.on('update-not-available', () => mainWindow?.webContents.send('updater:status', { status: 'current' }))
  autoUpdater.on('error', (err) => {
    logLine('updater-error', err?.message || String(err))
    mainWindow?.webContents.send('updater:status', { status: 'error', message: err?.message || String(err) })
  })
  autoUpdater.on('update-downloaded', (info) => {
    updateDownloaded = true
    mainWindow?.webContents.send('updater:status', { status: 'downloaded', version: info?.version })
  })
}

/**
 * How often a running app looks for a new version.
 *
 * Updates should arrive the way they do in OpenCode: on their own, without
 * anyone pressing anything. The launch check alone misses the case that
 * matters most — an app left open for days — so it repeats.
 */
const UPDATE_CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000
let updateCheckTimer = null

function startPeriodicUpdateChecks() {
  if (!autoUpdater || DEV_URL || updateCheckTimer) return
  updateCheckTimer = setInterval(() => {
    // `checkForUpdates`, not `checkForUpdatesAndNotify`: the renderer's own
    // "ready to restart" banner is the notification now, and an OS toast on
    // top of it every four hours would be exactly the nagging this is meant
    // to avoid. The launch check keeps the notifier for the case where the
    // window is not up yet.
    autoUpdater.checkForUpdates().catch((err) => logLine('updater-periodic-failed', err?.message || String(err)))
  }, UPDATE_CHECK_INTERVAL_MS)
  // Never hold the process open just to check for updates.
  if (typeof updateCheckTimer.unref === 'function') updateCheckTimer.unref()
}

function stopPeriodicUpdateChecks() {
  if (!updateCheckTimer) return
  clearInterval(updateCheckTimer)
  updateCheckTimer = null
}

ipcMain.handle('updater:check', async () => {
  if (!autoUpdater) return { status: 'unavailable', message: 'electron-updater is unavailable in this build' }
  if (DEV_URL) return { status: 'dev', message: 'Updates are disabled in development mode' }
  await autoUpdater.checkForUpdatesAndNotify()
  return { status: 'checking' }
})

/**
 * Apply a downloaded update now, instead of at the next natural quit.
 *
 * The update installs on quit either way; this only exists so someone who has
 * seen the banner and wants it immediately does not have to close the app by
 * hand and reopen it.
 */
ipcMain.handle('updater:install', async () => {
  if (!autoUpdater) return { status: 'unavailable', message: 'electron-updater is unavailable in this build' }
  if (DEV_URL) return { status: 'dev', message: 'Updates are disabled in development mode' }
  if (!updateDownloaded) return { status: 'not-ready', message: 'No update has finished downloading yet' }
  if (installingUpdate) return { status: 'installing' }
  installingUpdate = true
  stopPeriodicUpdateChecks()
  try {
    // Deferred a tick so this IPC call can return before the app goes away —
    // otherwise the renderer sees a dead channel rather than an answer.
    setTimeout(() => {
      try {
        autoUpdater.quitAndInstall(false, true)
      } catch (err) {
        installingUpdate = false
        logLine('updater-install-failed', err?.message || String(err))
      }
    }, 120)
    return { status: 'installing' }
  } catch (err) {
    installingUpdate = false
    logLine('updater-install-failed', err?.message || String(err))
    return { status: 'error', message: err?.message || String(err) }
  }
})

// ---------------------------------------------------------------------------
// Main window
// ---------------------------------------------------------------------------

function createWindow() {
  // Real vibrancy, not a CSS imitation: on macOS the window background is the
  // system material, so it samples the desktop behind it the way every native
  // app does. `backgroundColor` must be transparent for the material to show,
  // which is why it is set per-platform.
  const isMac = process.platform === 'darwin'
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1120,
    minHeight: 720,
    // Taskbar / alt-tab / dock icon while running. Generated by
    // scripts/build-icons.mjs from the same mark the sidebar shows.
    icon: path.join(__dirname, 'assets', 'icon.png'),
    backgroundColor: isMac ? '#00000000' : '#0B0B10',
    ...(isMac
      ? {
          vibrancy: 'under-window',
          visualEffectState: 'followWindow',
          transparent: true,
          titleBarStyle: 'hiddenInset',
          trafficLightPosition: { x: 16, y: 18 },
        }
      : {}),
    title: 'Cupric AI',
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  })
  mainWindow = win
  Menu.setApplicationMenu(null)
  win.once('ready-to-show', () => win.show())
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('render-process-gone', (_event, details) => showRendererCrashedScreen(win, details))
  win.webContents.on('unresponsive', () => logLine('renderer-unresponsive', 'Renderer became unresponsive'))
  // Renderer console → log file. Uncaught errors ("Uncaught TypeError: …")
  // arrive here even when the renderer's own logging never initialised.
  win.webContents.on('console-message', (_event, level, message, line, sourceId) => {
    if (level < 2 && !VERBOSE_LOGGING) return
    const text = `${message}${sourceId ? ` (${String(sourceId).split(/[\\/]/).pop()}:${line})` : ''}`
    try {
      const logger = elog?.scope('renderer-console')
      if (logger) logger[level >= 3 ? 'error' : level === 2 ? 'warn' : 'info'](text)
      else if (level >= 2) logLine('renderer-console', text)
    } catch {}
  })
  win.webContents.on('preload-error', (_event, preloadPath, error) => logLine('preload-error', error?.message || String(error), { preloadPath, stack: error?.stack }))
  win.webContents.on('did-fail-load', (_event, code, description, url) => logLine('did-fail-load', description, { code, url }))
  win.webContents.on('did-finish-load', () => logLine('renderer-loaded', 'Window finished loading', { ms: Math.round(performance.now()) }))
  win.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return
    const key = String(input.key || '').toLowerCase()
    const wantsDevTools = key === 'f12' || ((input.control || input.meta) && input.shift && key === 'i')
    if (!wantsDevTools) return
    event.preventDefault()
    if (devToolsAllowed()) win.webContents.toggleDevTools()
    else logLine('devtools-blocked', 'DevTools are disabled in stable builds. Relaunch with --cupric-devtools (or CUPRIC_DEVTOOLS=1) to enable them.')
  })
  if (DEV_URL) win.loadURL(DEV_URL)
  else win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))
  return win
}

/**
 * DevTools shortcut (Ctrl+Shift+I / F12). The app menu is removed, so the
 * default accelerators are gone; this restores them for dev, beta/rc/alpha
 * builds (version has a prerelease tag), or an explicit opt-in flag.
 */
function devToolsAllowed() {
  return (
    !app.isPackaged ||
    /-(alpha|beta|rc|canary|dev)/i.test(app.getVersion()) ||
    process.env.CUPRIC_DEVTOOLS === '1' ||
    process.argv.includes('--cupric-devtools')
  )
}

app.setAppUserModelId(APP_ID)
wireUpdater()

// GPU safety (0.10.1): a GPU process that keeps dying must not leave a white
// window. Two GPU crashes in one session → next launch starts with hardware
// acceleration off (the same path as --disable-gpu). The renderer separately
// falls back to a DOM preview when a canvas cannot be created.
const GPU_SAFETY_FILE = () => userDataPath('gpu-safety.json')
let gpuCrashes = 0
try {
  const gpuState = JSON.parse(fs.readFileSync(GPU_SAFETY_FILE(), 'utf8'))
  if (gpuState?.disableNextLaunch) {
    app.disableHardwareAcceleration()
    fs.writeFileSync(GPU_SAFETY_FILE(), JSON.stringify({ disableNextLaunch: false, disabledAt: new Date().toISOString(), reason: gpuState.reason || 'gpu-crash' }))
    logLine('gpu-safety', 'Hardware acceleration disabled for this launch after repeated GPU crashes last session')
  }
} catch {}
app.on('child-process-gone', (_event, details) => {
  logLine('child-process-gone', `${details?.type} ${details?.reason}`, details)
  if (details?.type === 'GPU' && details?.reason !== 'clean-exit') {
    gpuCrashes += 1
    if (gpuCrashes >= 2) {
      try {
        fs.writeFileSync(GPU_SAFETY_FILE(), JSON.stringify({ disableNextLaunch: true, reason: details?.reason }))
      } catch {}
    }
  }
})

logLine('app-start', `Cupric AI ${app.getVersion()} starting`, {
  packaged: app.isPackaged,
  platform: process.platform,
  electron: process.versions.electron,
  disableGpu: process.argv.includes('--disable-gpu'),
  verbose: VERBOSE_LOGGING,
  userData: app.getPath('userData'),
})

app.whenReady().then(() => {
  // settings.json migration (2.29): once per launch, backed up first.
  try {
    if (fs.existsSync(settingsFile())) {
      const migrated = migrateSettings(readSettings())
      if (migrated.changed) {
        fs.copyFileSync(settingsFile(), `${settingsFile()}.v${migrated.fromVersion}.bak`)
        writeSettings(migrated.settings)
        logLine('settings-migrated', `settings.json upgraded from v${migrated.fromVersion}`)
      }
    }
  } catch (err) {
    logLine('settings-migration-failed', err?.message || String(err))
  }
  try {
    stateRecovery.previousSessionCrashed = projectHistory.beginSession(app.getPath('userData'))
    if (stateRecovery.previousSessionCrashed) logLine('unclean-exit', 'The previous session did not close cleanly')
  } catch {}
  createWindow()
  // Zero-setup brain: silent local probe + free-model catalogue refresh.
  setTimeout(() => void startZeroSetupBrain(), 2500)
  if (autoUpdater && !DEV_URL) autoUpdater.checkForUpdatesAndNotify().catch((err) => logLine('updater-launch-failed', err?.message || String(err)))
  startPeriodicUpdateChecks()
  app.on('activate', () => {
    if (!BrowserWindow.getAllWindows().length) createWindow()
  })
})
app.on('before-quit', () => {
  stopPeriodicUpdateChecks()
  if (autoUpdater && updateDownloaded && !installingUpdate) {
    installingUpdate = true
    try {
      autoUpdater.quitAndInstall(false, true)
    } catch (err) {
      logLine('updater-install-failed', err?.message || String(err))
    }
  }
})
app.on('will-quit', () => projectHistory.endSession(app.getPath('userData')))
app.on('window-all-closed', () => app.quit())
