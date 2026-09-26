const { app, BrowserWindow, Menu, shell, ipcMain, dialog } = require('electron')
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

function candidateBinaryPath(value) {
  if (!value) return null
  const direct = String(value)
  if (fs.existsSync(direct)) return direct
  const unpacked = direct.replace(`${path.sep}app.asar${path.sep}`, `${path.sep}app.asar.unpacked${path.sep}`)
  if (unpacked !== direct && fs.existsSync(unpacked)) return unpacked
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
  const envCandidate = candidateBinaryPath(process.env[`NORTHFRAME_${envName}`] || process.env[envName])
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
const APP_ID = 'app.northframe.studio'
const MAX_RENDER_DURATION_SEC = 120
const DEFAULT_SILENCE_NOISE_DB = -35
const DEFAULT_SILENCE_MIN_DURATION = 0.8

const renderJobs = new Map()
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
  const html = `<!doctype html><html><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><title>Northframe Studio recovered</title><style>body{margin:0;height:100vh;display:grid;place-items:center;background:#0B0B10;color:#F4F1EA;font-family:Inter,Segoe UI,Arial,sans-serif}.card{max-width:520px;border:1px solid rgba(255,255,255,.12);border-radius:18px;background:#15151B;padding:28px;box-shadow:0 24px 80px rgba(0,0,0,.35)}h1{font-size:20px;margin:0 0 8px}p{color:#9CA3AF;line-height:1.55}.btn{border:0;border-radius:12px;background:#C8F542;color:#10130A;font-weight:800;padding:10px 14px;cursor:pointer}.muted{font-size:12px;color:#6B7280}</style></head><body><main class="card"><h1>Renderer recovered</h1><p>Northframe Studio's interface crashed, but your desktop process stayed alive and wrote a crash log. Reload the workspace to continue.</p><button class="btn" onclick="location.href=${JSON.stringify(restartUrl)}">Reload Northframe Studio</button><p class="muted">Logs live in ${escapeHtml(userDataPath('logs'))}</p></main></body></html>`
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

function publicSettings() {
  const settings = readSettings()
  const login = app.getLoginItemSettings ? app.getLoginItemSettings() : { openAtLogin: false }
  return {
    hasKey: Boolean(geminiApiKey()),
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
ipcMain.handle('settings:hasKey', () => Boolean(geminiApiKey()))
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

function arenaPromptOf(rundown) {
  return (
    'Build a SINGLE FILE index.html motion-graphics piece. HARD CONSTRAINTS: ' +
    'one file, inline CSS/JS, no build step. ' +
    `Root #scene exactly ${rundown.size[0]}x${rundown.size[1]} px. ` +
    `Duration ${rundown.durationSec}s at ${rundown.fps}fps. ` +
    'Implement window.__seek(t) — all motion must be a pure function of t, no CSS animations, no setTimeout, no Math.random in the frame loop. ' +
    `Style: ${rundown.style}. Scene copy: ` +
    rundown.scenes.map((s) => `[${s.from}-${s.to}s ${s.type}] "${s.copy}" (${s.motion})`).join(' ')
  )
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
        copy: String(scene?.copy || briefText || 'Northframe').slice(0, 180),
        motion: String(scene?.motion || 'ease-out type reveal').slice(0, 220),
      }))
    : []
  const safeScenes = scenes.length
    ? scenes.map((s) => ({ ...s, to: Math.max(s.from + 0.1, s.to) }))
    : [{ id: uid('scene'), from: 0, to: durationSec, type: 'hook', copy: briefText || 'Northframe', motion: 'bold type reveal, subtle parallax' }]
  const rundown = {
    title: String(candidate?.title || `${String(briefText || 'Northframe').slice(0, 48)} — ${durationSec}s motion piece`),
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
  return `You are Northframe Studio's creative director. Return STRICT JSON only, no markdown, matching exactly this TypeScript shape:
{"title":string,"durationSec":number,"fps":30|60,"size":[number,number],"style":string,"scenes":[{"id":string,"from":number,"to":number,"type":string,"copy":string,"motion":string}],"arenaPrompt":string}

Rules:
- Total duration must be 1-120 seconds.
- Prefer 1920x1080 unless the brief asks square or vertical.
- The scenes must cover the duration in timeline order.
- The arenaPrompt value must use this exact shape: "Build a SINGLE FILE index.html motion-graphics piece. HARD CONSTRAINTS: one file, inline CSS/JS, no build step. Root #scene exactly WxH px. Duration Ns at 30fps. Implement window.__seek(t) — all motion must be a pure function of t, no CSS animations, no setTimeout, no Math.random in the frame loop. Style: ... Scene copy: ..."

Brief: ${prompt}
History: ${JSON.stringify(history || [])}
Current rundown/context: ${JSON.stringify(rundownContext || {})}`
}

async function generateRundown(prompt, history, context) {
  const key = geminiApiKey()
  if (!key) throw new Error('Gemini API key is not configured')
  const model = new GoogleGenerativeAI(key).getGenerativeModel({
    model: 'gemini-2.0-flash',
    generationConfig: { responseMimeType: 'application/json' },
  })
  let lastError
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const result = await model.generateContent(geminiRundownPrompt(prompt, history, context))
      return normalizeRundown(parseJsonFromModel(result.response.text()), prompt)
    } catch (err) {
      lastError = err
      logLine('gemini-parse-retry', err?.message || String(err))
    }
  }
  throw lastError
}

async function geminiChat(text, ctx) {
  const key = geminiApiKey()
  if (!key) throw new Error('Gemini API key is not configured')
  const model = new GoogleGenerativeAI(key).getGenerativeModel({ model: 'gemini-2.0-flash' })
  const result = await model.generateContent(
    `You are Northframe Studio's desktop creative copilot. Be concise, practical, and specific. Never mention API keys. Context: ${JSON.stringify(
      ctx || {},
    )}. User: ${text}`,
  )
  return result.response.text()
}

ipcMain.handle('gemini:ask', async (_event, payload) => {
  const rundownPatch = await generateRundown(payload?.prompt || '', payload?.history || [], payload?.rundownContext || {})
  return {
    text: `Live Gemini drafted a ${rundownPatch.durationSec}s rundown with ${rundownPatch.scenes.length} scene${rundownPatch.scenes.length === 1 ? '' : 's'}. The Arena prompt is ready at the bottom when you lock it.`,
    rundownPatch,
  }
})
ipcMain.handle('gemini:chat', async (_event, payload) => geminiChat(payload?.text || '', payload?.ctx || {}))

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
  if (!isSubPath(localPath, root)) throw new Error('Preview path is outside Northframe project data')
  return pathToFileURL(localPath).toString()
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
    throw new Error('FFmpeg/FFprobe binaries are unavailable in this build. Run a clean install so ffmpeg-static and ffprobe-static can download their native binaries, or set NORTHFRAME_FFMPEG_PATH and NORTHFRAME_FFPROBE_PATH.')
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
  const safe = safeFileName(name || 'northframe-render.mp4', 'northframe-render.mp4')
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
    throw new Error(`Timeline is ${Math.round(nominalDuration)}s. Northframe currently limits desktop renders to ${MAX_RENDER_DURATION_SEC}s.`)
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
  if (!isSubPath(outputPath, rendersRoot)) throw new Error('Render output is outside Northframe renders')
  shell.showItemInFolder(outputPath)
  return true
})

ipcMain.handle('render:copyToDownloads', async (_event, outputPath) => {
  if (!outputPath || !fs.existsSync(outputPath)) throw new Error('Render output does not exist yet')
  const rendersRoot = userDataPath('renders')
  if (!isSubPath(outputPath, rendersRoot)) throw new Error('Render output is outside Northframe renders')
  const downloads = app.getPath('downloads')
  const dest = path.join(downloads, safeFileName(path.basename(outputPath), 'northframe-render.mp4'))
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
    title: 'Northframe Studio',
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
