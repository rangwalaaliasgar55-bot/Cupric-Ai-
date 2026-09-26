const { app, BrowserWindow, Menu, shell, ipcMain, dialog, clipboard } = require('electron')
const fs = require('fs')
const fsp = fs.promises
const path = require('path')
const os = require('os')
const { pathToFileURL } = require('url')
const { spawn } = require('child_process')
const { GoogleGenerativeAI } = require('@google/generative-ai')
const AdmZip = require('adm-zip')

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
const MAX_RENDER_DURATION_SEC = 120
const DEFAULT_SILENCE_NOISE_DB = -35
const DEFAULT_SILENCE_MIN_DURATION = 0.8
const DEFAULT_GEMINI_MODEL = 'gemini-3.8-flash'
const GEMINI_FALLBACK_MODELS = ['gemini-3.8-flash', 'gemini-2.5-flash', 'gemini-2.5-flash-lite']

const renderJobs = new Map()
const automationRunStates = new Map()
let mainWindow = null
let updateDownloaded = false
let installingUpdate = false

// ---------------------------------------------------------------------------
// App hardening: single instance, logs, crash capture
// ---------------------------------------------------------------------------

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

function logFile() {
  const dir = userDataPath('logs')
  ensureDir(dir)
  return path.join(dir, `${new Date().toISOString().slice(0, 10)}.log`)
}

function logLine(kind, message, extra) {
  try {
    const line = JSON.stringify({ at: new Date().toISOString(), kind, message, extra }) + os.EOL
    fs.appendFileSync(logFile(), line, 'utf8')
  } catch {}
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
  files.push(process.env.OPENCODE_CONFIG, process.env.OPENCODE_AUTH_FILE)
  if (home) {
    addDir(path.join(home, '.config', 'opencode'))
    addDir(path.join(home, '.local', 'share', 'opencode'))
    files.push(path.join(home, '.opencode.json'), path.join(home, '.opencode.jsonc'))
  }
  addDir(path.join(process.env.APPDATA || '', 'opencode'))
  addDir(path.join(process.env.LOCALAPPDATA || '', 'opencode'))
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

function aiSettings() {
  const settings = readSettings()
  const provider = settings.aiProvider === 'gemini' ? 'gemini' : 'opencode'
  const openCodeBaseUrl = String(settings.openCodeBaseUrl || process.env.OPENCODE_BASE_URL || process.env.OPENAI_BASE_URL || 'https://openrouter.ai/api/v1').trim()
  const openCodeModel = String(settings.openCodeModel || process.env.OPENCODE_MODEL || process.env.OPENAI_MODEL || 'qwen/qwen3-235b-a22b:free').trim()
  const openCodeApiKey = String(settings.openCodeApiKey || process.env.OPENCODE_API_KEY || process.env.OPENAI_API_KEY || process.env.OPENROUTER_API_KEY || '').trim()
  return { provider, openCodeBaseUrl, openCodeModel, openCodeApiKey }
}

function hasOpenCodeAccess() {
  const cfg = aiSettings()
  return Boolean(
    cfg.openCodeApiKey ||
    resolveOpenCodeApiKey(cfg.openCodeBaseUrl, cfg.openCodeModel) ||
    /^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])/i.test(cfg.openCodeBaseUrl),
  )
}

function publicSettings() {
  const settings = readSettings()
  const ai = aiSettings()
  const login = app.getLoginItemSettings ? app.getLoginItemSettings() : { openAtLogin: false }
  return {
    hasKey: ai.provider === 'opencode' ? hasOpenCodeAccess() : Boolean(geminiApiKey()),
    hasGeminiKey: Boolean(geminiApiKey()),
    hasOpenCodeKey: hasOpenCodeAccess(),
    aiProvider: ai.provider,
    geminiModel: geminiModel(),
    openCodeBaseUrl: ai.openCodeBaseUrl,
    openCodeModel: ai.openCodeModel,
    openCodeImportedKey: Boolean(resolveOpenCodeApiKey(ai.openCodeBaseUrl, ai.openCodeModel)),
    autoLaunch: Boolean(settings.autoLaunch ?? login.openAtLogin),
    silenceNoiseDb: Number.isFinite(Number(settings.silenceNoiseDb)) ? Number(settings.silenceNoiseDb) : DEFAULT_SILENCE_NOISE_DB,
    silenceMinDuration: Number.isFinite(Number(settings.silenceMinDuration))
      ? Number(settings.silenceMinDuration)
      : DEFAULT_SILENCE_MIN_DURATION,
    updateChannel: settings.updateChannel || 'latest',
  }
}

function applySettingsPatch(patch) {
  const settings = readSettings()
  if (Object.prototype.hasOwnProperty.call(patch || {}, 'geminiApiKey')) {
    const key = String(patch.geminiApiKey || '').trim()
    if (key) settings.geminiApiKey = key
    else delete settings.geminiApiKey
  }
  if (Object.prototype.hasOwnProperty.call(patch || {}, 'aiProvider')) {
    settings.aiProvider = patch.aiProvider === 'opencode' ? 'opencode' : 'gemini'
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

ipcMain.handle('settings:get', () => publicSettings())
ipcMain.handle('settings:hasKey', () => publicSettings().hasKey)
ipcMain.handle('settings:set', (_event, patch) => applySettingsPatch(patch || {}))
ipcMain.handle('settings:autoLaunch', (_event, enabled) => applySettingsPatch({ autoLaunch: Boolean(enabled) }))
ipcMain.handle('state:save', (_event, payload) => {
  const value = typeof payload === 'string' ? payload : payload?.value ?? JSON.stringify(payload ?? null)
  ensureDir(path.dirname(stateFile()))
  fs.writeFileSync(stateFile(), String(value), 'utf8')
  return true
})
ipcMain.handle('state:load', () => {
  try {
    return fs.readFileSync(stateFile(), 'utf8')
  } catch {
    return null
  }
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
function patchAutomation(id, patch) {
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
function writeAutomationCandidates(root, rundown) {
  const candidates = []
  for (let i = 0; i < 3; i += 1) {
    const file = path.join(root, `candidate-${i + 1}.html`)
    fs.writeFileSync(file, candidateHtmlForRundown(rundown, i), 'utf8')
    const html = fs.readFileSync(file, 'utf8')
    const score = 50 + (html.includes('window.__seek') ? 20 : 0) + (html.includes(String(rundown.durationSec)) ? 8 : 0) + (i * 4) + (rundown.scenes?.length ? 8 : 0)
    candidates.push({ file, score, reasons: ['single-file HTML', 'defines window.__seek(t)', 'scene copy mapped to deterministic motion'] })
  }
  candidates.sort((a, b) => b.score - a.score)
  writeJson(path.join(root, 'voting-report.json'), { mode: 'local-scoring', winner: candidates[0].file, candidates })
  return { candidates, winnerPath: candidates[0].file }
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
  if (text) clipboard.writeText(text)
  try {
    await shell.openExternal(url)
    logLine('arena-opened', 'Opened Arena builder', { copied: Boolean(text), ...extra })
  } catch (err) {
    logLine('arena-open-failed', err?.message || String(err), extra)
    throw new Error(`Could not open Arena in the browser: ${err?.message || err}`)
  }
  return { url, copied: Boolean(text) }
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
function generationGuideFor(job, rundown) {
  return {
    renderSpec: { aspect: job.aspect, fps: job.fps, quality: job.quality, durationSec: rundown.durationSec, size: rundown.size },
    sources: [
      { id: 'rundown-copy', type: 'text', description: 'Locked Cupric AI scene copy and timing' },
      { id: 'arena-html', type: 'generated-motion-html', description: 'Single-file HTML with inline CSS/JS and deterministic window.__seek(t)' },
      ...(job.footageMeta ? [{ id: 'footage', type: 'video', description: 'User-selected footage folder clip analyzed with FFprobe/FFmpeg silence detection' }] : []),
    ],
    sequence: (rundown.scenes || []).map((s, index) => ({ index: index + 1, from: s.from, to: s.to, type: s.type, copy: s.copy, motion: s.motion })),
    generationSteps: [
      'Generate/lock the creative rundown from the brief.',
      'Build Arena candidates as single-file deterministic HTML motion pieces.',
      'Use private local scoring or a manual Arena browser vote gate to select the winner.',
      'Optionally ingest footage, detect silences, and add captions/crop metadata.',
      'Render HTML frames and footage segments with FFmpeg, then concatenate into the final MP4.',
    ],
  }
}

function writeAutomationReview(job, root, rundown, warnings) {
  const reviewReportPath = path.join(root, 'review-report.json')
  const generationGuide = generationGuideFor(job, rundown)
  const sequenceMd = generationGuide.sequence.map(s => `- ${s.index}. ${s.from}-${s.to}s **${s.type}** — "${s.copy}"; motion: ${s.motion}`).join('\n')
  const sourcesMd = generationGuide.sources.map(s => `- ${s.id} (${s.type}): ${s.description}`).join('\n')
  writeJson(reviewReportPath, { brief: job.brief, mode: job.mode, votingMode: job.votingMode, rundown, outputPath: job.outputPath || null, footageUsed: Boolean(job.footageMeta), generationGuide, warnings })
  fs.writeFileSync(path.join(root, 'review-report.md'), `# Cupric AI review report\n\n## Brief\n${job.brief}\n\n## Rundown\n${rundown.title}\n\nVoting mode: ${job.votingMode}\n\nOutput: ${job.outputPath || 'Not rendered yet'}\n\n## Sources\n${sourcesMd}\n\n## Generation sequence\n${sequenceMd}\n\n## How the video is generated\n${generationGuide.generationSteps.map(step => `- ${step}`).join('\n')}\n\nWarnings:\n${warnings.length ? warnings.map(w => `- ${w}`).join('\n') : '- None'}\n`, 'utf8')
  return reviewReportPath
}
async function runAutomationPipeline(jobId) {
  const state = automationState(jobId)
  state.cancelled = false
  let stepIndex = 0
  let warnings = []
  try {
    let job = ensureAutomationActive(jobId, state)
    warnings = Array.isArray(job.warnings) ? [...job.warnings] : []
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
      startAutomationStep(job.id, 1, 'Drafting creative rundown')
      try {
        rundown = await generateRundown(job.brief, [], { aspect: job.aspect, fps: job.fps, mode: job.mode })
      } catch (err) {
        warnings.push(`Live AI unavailable; used local deterministic rundown. ${err?.message || err}`)
        rundown = fallbackRundownForJob(job)
      }
      writeJson(path.join(root, 'rundown.json'), rundown)
      job = patchAutomation(job.id, { rundown, rundownPath: path.join(root, 'rundown.json'), warnings }) || job
      sendAutomation('automation:progress', job)
      job = finishAutomationStep(job.id, 1, 'Rundown generated') || job
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
    if (job.votingMode === 'official-arena-api') {
      throw new Error('Official Arena API voting is not configured in this build. Use Local model battle scoring for fully autonomous MP4, or Manual Arena for a visible human review gate.')
    }
    if (!job.winnerPath || !Array.isArray(job.candidates)) {
      startAutomationStep(job.id, 3, job.votingMode === 'manual-arena' ? 'Generating review candidates before the manual Arena gate' : 'Generating and locally scoring candidates')
      const candidateResult = writeAutomationCandidates(root, rundown)
      job = patchAutomation(job.id, { candidates: candidateResult.candidates, winnerPath: candidateResult.winnerPath }) || job
      sendAutomation('automation:progress', job)
    }
    if (job.votingMode === 'manual-arena' && !job.manualVoteApproved) {
      const message = 'Manual Arena review gate: Cupric opened arena.ai/code in your browser and copied the Arena prompt. Paste it there, run the battle/build, vote yourself, download the winning ZIP, then approve this gate to continue. Public voting is never automated.'
      if (!job.arenaOpenedAt) {
        try {
          await openArenaBuilderForPrompt(rundown.arenaPrompt || arenaPromptOf(rundown), { jobId: job.id, source: 'automation' })
          job = patchAutomation(job.id, { arenaOpenedAt: new Date().toISOString() }) || job
        } catch (err) {
          warnings.push(err?.message || String(err))
        }
      }
      job.reviewReportPath = writeAutomationReview({ ...job, outputPath: null }, root, rundown, warnings.concat(message))
      patchAutomation(job.id, { reviewReportPath: job.reviewReportPath, warnings: warnings.concat(message) })
      waitAutomationStep(job.id, 3, message)
      return
    }
    job = finishAutomationStep(job.id, 3, job.votingMode === 'manual-arena' ? 'Manual gate approved' : 'Candidate selected by local scoring') || job

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
      startAutomationStep(job.id, 7, 'Writing review report')
      const reviewReportPath = writeAutomationReview(job, root, rundown, warnings)
      job = patchAutomation(job.id, { reviewReportPath, warnings }) || job
      job = finishAutomationStep(job.id, 7, 'Review report ready') || job
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
  const steps = latest?.steps?.map(step => step.id === p?.stepId ? { ...step, status: 'done', progressPct: 100, message: 'Approved by reviewer', completedAt: new Date().toISOString() } : step)
  const job = patchAutomation(p?.jobId, { status: 'running', manualVoteApproved: true, waitingMessage: null, steps })
  if (job) setTimeout(() => { void runAutomationPipeline(job.id) }, 0)
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

function parseJsonFromModel(text) {
  const raw = String(text || '').trim()
  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const candidate = fence ? fence[1] : raw.match(/\{[\s\S]*\}/)?.[0] || raw
  return JSON.parse(candidate)
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

SEQUENCE / TIMELINE:
${sceneSequenceLines(rundown)}

IMPLEMENTATION NOTES:
- At t=0 the first scene must be visible and valid.
- All scene transitions must happen according to the timeline above.
- Use safe-area margins and responsive scaling inside the fixed #scene canvas.
- Expose clear variables for duration, fps, scenes, and sourceManifest.
- The piece should look like a finished video, not a placeholder: polished typography, motion hierarchy, background design, and a final hold.`
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

ipcMain.handle('opencode:listModels', (_event, payload) => listOpenCodeModels(payload || {}))
ipcMain.handle('opencode:discoverModels', () => discoverOpenCodeConfiguredModels())

async function callOpenCode(messages, options = {}) {
  const cfg = aiSettings()
  if (!cfg.openCodeBaseUrl) throw new Error('OpenCode/OpenAI-compatible base URL is not configured')
  const inheritedKey = resolveOpenCodeApiKey(cfg.openCodeBaseUrl, cfg.openCodeModel)
  const apiKey = cfg.openCodeApiKey || inheritedKey
  if (!apiKey && !isLocalModelBase(cfg.openCodeBaseUrl)) {
    throw new Error('OpenCode/OpenAI-compatible API key is not configured. Save a key in Cupric AI or import a configured OpenCode Desktop provider.')
  }
  const baseUrl = normalizedBaseUrl(cfg.openCodeBaseUrl)
  const url = `${baseUrl}/chat/completions`
  const headers = { 'content-type': 'application/json' }
  if (/openrouter\.ai/i.test(cfg.openCodeBaseUrl)) {
    headers['HTTP-Referer'] = 'https://cupric.ai'
    headers['X-Title'] = 'Cupric AI'
  }
  if (apiKey) headers.authorization = `Bearer ${apiKey}`
  const result = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model: cfg.openCodeModel,
      messages,
      temperature: options.temperature ?? 0.55,
      ...(options.json ? { response_format: { type: 'json_object' } } : {}),
    }),
  })
  if (!result.ok) throw new Error(`OpenCode model request failed (${result.status}): ${(await result.text()).slice(0, 1000)}`)
  const data = await result.json()
  const text = data?.choices?.[0]?.message?.content || data?.message?.content || ''
  if (!text) throw new Error('OpenCode model returned an empty response')
  return text
}

function geminiModelCandidates() {
  const seen = new Set()
  return [geminiModel(), ...GEMINI_FALLBACK_MODELS]
    .map((model) => String(model || '').trim())
    .filter((model) => model && !seen.has(model) && seen.add(model))
}

async function runGeminiGenerateContent(key, prompt, generationConfig) {
  let lastError
  for (const modelName of geminiModelCandidates()) {
    try {
      const model = new GoogleGenerativeAI(key).getGenerativeModel({ model: modelName, ...(generationConfig ? { generationConfig } : {}) })
      return await model.generateContent(prompt)
    } catch (err) {
      lastError = err
      logLine('gemini-model-failed', err?.message || String(err), { model: modelName })
      if (!/404|not found|no longer available|not available|not supported/i.test(err?.message || String(err))) break
    }
  }
  throw lastError
}

async function generateGeminiRundown(prompt, history, context) {
  const key = geminiApiKey()
  if (!key) throw new Error('Gemini API key is not configured')
  const result = await runGeminiGenerateContent(key, geminiRundownPrompt(prompt, history, context), { responseMimeType: 'application/json' })
  return normalizeRundown(parseJsonFromModel(result.response.text()), prompt)
}

async function generateOpenCodeRundown(prompt, history, context) {
  const text = await callOpenCode([
    { role: 'system', content: 'You are Cupric AI creative director. Return STRICT JSON only, no markdown.' },
    { role: 'user', content: geminiRundownPrompt(prompt, history, context) },
  ], { json: true })
  return normalizeRundown(parseJsonFromModel(text), prompt)
}

async function generateRundown(prompt, history, context) {
  const provider = aiSettings().provider
  let lastError
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      return provider === 'opencode'
        ? await generateOpenCodeRundown(prompt, history, context)
        : await generateGeminiRundown(prompt, history, context)
    } catch (err) {
      lastError = err
      logLine('ai-rundown-retry', err?.message || String(err), { provider })
    }
  }
  throw lastError
}

async function liveAiChat(text, ctx) {
  const provider = aiSettings().provider
  if (provider === 'opencode') {
    return callOpenCode([
      { role: 'system', content: 'You are Cupric AI desktop creative copilot. Be concise, practical, and specific. Help with video creation, rendering, resources, prompts, and edits.' },
      { role: 'user', content: `Context: ${JSON.stringify(ctx || {})}\nUser: ${text}` },
    ])
  }
  const key = geminiApiKey()
  if (!key) throw new Error('Gemini API key is not configured')
  const result = await runGeminiGenerateContent(
    key,
    `You are Cupric AI's desktop creative copilot. Be concise, practical, and specific. Context: ${JSON.stringify(
      ctx || {},
    )}. User: ${text}`,
  )
  return result.response.text()
}

ipcMain.handle('gemini:ask', async (_event, payload) => {
  const providerLabel = aiSettings().provider === 'opencode' ? 'OpenCode' : 'Gemini'
  const rundownPatch = await generateRundown(payload?.prompt || '', payload?.history || [], payload?.rundownContext || {})
  return {
    text: `Live ${providerLabel} drafted a ${rundownPatch.durationSec}s rundown with ${rundownPatch.scenes.length} scene${rundownPatch.scenes.length === 1 ? '' : 's'}. The Arena prompt is ready at the bottom when you lock it.`,
    rundownPatch,
  }
})
ipcMain.handle('gemini:chat', async (_event, payload) => liveAiChat(payload?.text || '', payload?.ctx || {}))

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
  const win = new BrowserWindow({
    show: false,
    width,
    height,
    useContentSize: true,
    backgroundColor: '#000000',
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      backgroundThrottling: false,
    },
  })
  return win
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
  const root = userDataPath('projects')
  if (!isSubPath(localPath, root)) throw new Error('Preview path is outside Cupric AI project data')
  return pathToFileURL(localPath).toString()
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

ipcMain.handle('media:status', () => mediaToolStatus())

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

function targetSizeForAspect(aspect, size) {
  if (Array.isArray(size) && size.length >= 2) {
    return { width: Math.round(Number(size[0]) || 1920), height: Math.round(Number(size[1]) || 1080) }
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

function renderOutputName(name) {
  const safe = safeFileName(name || 'cupric-render.mp4', 'cupric-render.mp4')
  return /\.mp4$/i.test(safe) ? safe : `${safe}.mp4`
}

function sendRenderEvent(sender, channel, payload) {
  try {
    if (!sender.isDestroyed()) sender.send(channel, payload)
  } catch {}
}

function ensureNotCancelled(state) {
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
  ensureNotCancelled(state)
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
      ensureNotCancelled(state)
      const t = (Number(source.in) || 0) + i / ctx.fps
      await win.webContents.executeJavaScript(`window.__seek(${JSON.stringify(t)})`, true)
      await win.webContents.executeJavaScript('new Promise((resolve) => requestAnimationFrame(() => resolve(true)))', true)
      const img = await win.webContents.capturePage()
      await fsp.writeFile(path.join(frameDir, `${String(i + 1).padStart(6, '0')}.png`), img.toPNG())
      ctx.onUnits(frameCount > 1 ? i + 1 : frameCount)
    }
  } finally {
    state.windows.delete(win)
    if (!win.isDestroyed()) win.destroy()
  }

  await runProcess(state, ffmpegPath, [
    '-y',
    '-hide_banner',
    '-framerate',
    String(ctx.fps),
    '-i',
    path.join(frameDir, '%06d.png'),
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
    'setsar=1,format=yuv420p',
    '-c:v',
    'libx264',
    '-preset',
    presetForQuality(ctx.quality),
    '-crf',
    crfForQuality(ctx.quality),
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
  ensureNotCancelled(state)
  const [start, end] = interval
  const duration = Math.max(0.05, end - start)
  const segmentPath = path.join(ctx.workDir, `segment-${String(ctx.segmentIndex).padStart(4, '0')}.mp4`)
  const assPath = writeAss(source.captions, source.captionStyle || 'standard', ctx.target, path.join(ctx.workDir, `captions-${ctx.segmentIndex}.ass`))
  const vf = videoFilter(ctx.target, assPath)

  const progressArgs = ['-progress', 'pipe:2', '-nostats']
  const base = ['-y', '-hide_banner', ...progressArgs, '-ss', String(start), '-t', String(duration), '-i', source.videoPath || source.footagePath]
  const output = [
    '-vf',
    vf,
    '-r',
    String(ctx.fps),
    '-c:v',
    'libx264',
    '-preset',
    presetForQuality(ctx.quality),
    '-crf',
    crfForQuality(ctx.quality),
    '-pix_fmt',
    'yuv420p',
    '-c:a',
    'aac',
    '-ar',
    '48000',
    '-ac',
    '2',
    '-shortest',
    segmentPath,
  ]
  const args = hasAudio
    ? [...base, '-map', '0:v:0', '-map', '0:a:0', ...output]
    : [...base, '-f', 'lavfi', '-t', String(duration), '-i', 'anullsrc=channel_layout=stereo:sample_rate=48000', '-map', '0:v:0', '-map', '1:a:0', ...output]

  let lastUnits = 0
  await runProcess(state, ffmpegPath, args, {
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
  ensureNotCancelled(state)
  if (segments.length === 1) {
    await fsp.copyFile(segments[0].path, outputPath)
    return
  }
  const listPath = path.join(ctx.workDir, 'concat.txt')
  const body = segments.map((segment) => `file '${String(segment.path).replace(/'/g, "'\\''")}'`).join(os.EOL)
  fs.writeFileSync(listPath, body, 'utf8')
  await runProcess(state, ffmpegPath, ['-y', '-hide_banner', '-f', 'concat', '-safe', '0', '-i', listPath, '-c', 'copy', '-movflags', '+faststart', outputPath])
}

ipcMain.handle('render:start', async (event, job) => {
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

  const state = { id, cancelled: false, processes: new Set(), windows: new Set(), sender }
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
      ensureNotCancelled(state)
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
})

ipcMain.handle('render:cancel', (_event, payload) => {
  const id = String(payload?.jobId || '')
  const state = renderJobs.get(id)
  if (!state) return false
  state.cancelled = true
  for (const child of state.processes) stopChild(child)
  for (const win of state.windows) {
    try {
      if (!win.isDestroyed()) win.destroy()
    } catch {}
  }
  sendRenderEvent(state.sender, 'render:error', { jobId: id, error: 'Render cancelled' })
  return true
})

ipcMain.handle('render:reveal', (_event, outputPath) => {
  if (!outputPath || !fs.existsSync(outputPath)) throw new Error('Render output does not exist yet')
  const rendersRoot = userDataPath('renders')
  if (!isSubPath(outputPath, rendersRoot)) throw new Error('Render output is outside Cupric AI renders')
  shell.showItemInFolder(outputPath)
  return true
})

ipcMain.handle('render:copyToDownloads', async (_event, outputPath) => {
  if (!outputPath || !fs.existsSync(outputPath)) throw new Error('Render output does not exist yet')
  const rendersRoot = userDataPath('renders')
  if (!isSubPath(outputPath, rendersRoot)) throw new Error('Render output is outside Cupric AI renders')
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

ipcMain.handle('updater:check', async () => {
  if (!autoUpdater) return { status: 'unavailable', message: 'electron-updater is unavailable in this build' }
  if (DEV_URL) return { status: 'dev', message: 'Updates are disabled in development mode' }
  await autoUpdater.checkForUpdatesAndNotify()
  return { status: 'checking' }
})

// ---------------------------------------------------------------------------
// Main window
// ---------------------------------------------------------------------------

function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1120,
    minHeight: 720,
    backgroundColor: '#0B0B10',
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
  if (DEV_URL) win.loadURL(DEV_URL)
  else win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))
  return win
}

app.setAppUserModelId(APP_ID)
wireUpdater()
app.whenReady().then(() => {
  createWindow()
  if (autoUpdater && !DEV_URL) autoUpdater.checkForUpdatesAndNotify().catch((err) => logLine('updater-launch-failed', err?.message || String(err)))
  app.on('activate', () => {
    if (!BrowserWindow.getAllWindows().length) createWindow()
  })
})
app.on('before-quit', () => {
  if (autoUpdater && updateDownloaded && !installingUpdate) {
    installingUpdate = true
    try {
      autoUpdater.quitAndInstall(false, true)
    } catch (err) {
      logLine('updater-install-failed', err?.message || String(err))
    }
  }
})
app.on('window-all-closed', () => app.quit())
