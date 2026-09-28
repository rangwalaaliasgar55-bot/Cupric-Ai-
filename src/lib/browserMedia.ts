import { ARENA_SCENE_CSP, inlineBlobAssets, openSandboxedScene, type SandboxedScene } from './studio/htmlTemplateCapture'

export type BrowserArenaImportResult = {
  htmlFileName: string
  thumbnailDataUrl?: string | null
  localPath?: string | null
}

export type BrowserFootageAnalyzeResult = {
  name?: string
  durationSec: number
  silenceRanges: [number, number][]
  videoPath?: string | null
  waveform?: number[]
}

const DEFAULT_SILENCE_NOISE_DB = -35
const DEFAULT_SILENCE_MIN_DURATION = 0.8

const keepAliveUrls = new Set<string>()

function objectUrl(blob: Blob): string {
  const url = URL.createObjectURL(blob)
  keepAliveUrls.add(url)
  return url
}

function waitForProgress(ms: number, onProgress: (pct: number) => void, pct: number) {
  return new Promise<void>((resolve) => {
    window.setTimeout(() => {
      onProgress(pct)
      resolve()
    }, ms)
  })
}

function normalizePath(value: string): string {
  return value.replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+/, '')
}

function dirname(value: string): string {
  const normalized = normalizePath(value)
  const idx = normalized.lastIndexOf('/')
  return idx >= 0 ? normalized.slice(0, idx) : ''
}

function basename(value: string): string {
  const normalized = normalizePath(value)
  return normalized.slice(normalized.lastIndexOf('/') + 1)
}

function extname(value: string): string {
  const name = basename(value)
  const idx = name.lastIndexOf('.')
  return idx >= 0 ? name.slice(idx).toLowerCase() : ''
}

function guessMime(name: string): string {
  const ext = extname(name)
  if (ext === '.html' || ext === '.htm') return 'text/html'
  if (ext === '.css') return 'text/css'
  if (ext === '.js' || ext === '.mjs') return 'text/javascript'
  if (ext === '.svg') return 'image/svg+xml'
  if (ext === '.png') return 'image/png'
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg'
  if (ext === '.webp') return 'image/webp'
  if (ext === '.gif') return 'image/gif'
  if (ext === '.mp4') return 'video/mp4'
  if (ext === '.webm') return 'video/webm'
  if (ext === '.mov') return 'video/quicktime'
  if (ext === '.mp3') return 'audio/mpeg'
  if (ext === '.wav') return 'audio/wav'
  if (ext === '.woff2') return 'font/woff2'
  return 'application/octet-stream'
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function isExternalRef(value: string): boolean {
  return /^(?:[a-z]+:)?\/\//i.test(value) || /^(?:data|blob|mailto|tel):/i.test(value) || value.startsWith('#')
}

function resolveAssetUrl(refRaw: string, baseDir: string, urls: Map<string, string>, basenameUrls: Map<string, string>): string | null {
  const ref = refRaw.trim().replace(/^['"]|['"]$/g, '')
  if (!ref || isExternalRef(ref)) return null
  const [pathPart, suffix = ''] = ref.split(/(?=[?#])/)
  const normalizedDirect = normalizePath(pathPart)
  const normalizedRelative = normalizePath(baseDir ? `${baseDir}/${pathPart}` : pathPart)
  const url = urls.get(normalizedRelative) || urls.get(normalizedDirect) || basenameUrls.get(basename(pathPart)) || null
  return url ? `${url}${suffix}` : null
}

function rewriteAssetRefs(text: string, baseDir: string, urls: Map<string, string>, basenameUrls: Map<string, string>): string {
  return text
    .replace(/\b(src|href|poster)=(['"])([^'"]+)\2/gi, (match, attr: string, quote: string, ref: string) => {
      const next = resolveAssetUrl(ref, baseDir, urls, basenameUrls)
      return next ? `${attr}=${quote}${next}${quote}` : match
    })
    .replace(/url\((['"]?)([^)'"]+)\1\)/gi, (match, quote: string, ref: string) => {
      const next = resolveAssetUrl(ref, baseDir, urls, basenameUrls)
      return next ? `url(${quote}${next}${quote})` : match
    })
}

function ensureSeekFunction(html: string) {
  if (!html.includes('__seek')) {
    throw new Error('Arena HTML must define window.__seek(t). Import a real Arena/Remotion motion export.')
  }
}

/**
 * Thumbnail through the same opaque-origin sandbox as every other HTML
 * capture (2.28): imported Arena HTML is third-party code and must never run
 * with the app's origin.
 */
async function captureArenaThumbnail(src: string): Promise<string | null> {
  let scene: SandboxedScene | null = null
  try {
    const html = await inlineBlobAssets(await (await fetch(src)).text())
    scene = await openSandboxedScene(html, 1280, 720, { csp: ARENA_SCENE_CSP })
    const canvas = document.createElement('canvas')
    canvas.width = 640
    canvas.height = 360
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    ctx.fillStyle = '#0B0B10'
    ctx.fillRect(0, 0, 640, 360)
    await scene.drawFrame(1.5, ctx, 640, 360)
    return canvas.toDataURL('image/png')
  } catch {
    return null
  } finally {
    scene?.close()
  }
}

async function importHtmlFile(file: File, onProgress: (pct: number) => void): Promise<BrowserArenaImportResult> {
  onProgress(12)
  const html = await file.text()
  ensureSeekFunction(html)
  await waitForProgress(80, onProgress, 52)
  const url = objectUrl(new Blob([html], { type: 'text/html' }))
  const thumbnailDataUrl = await captureArenaThumbnail(url)
  await waitForProgress(80, onProgress, 100)
  return {
    htmlFileName: file.name.replace(/\.html?$/i, '.html'),
    localPath: url,
    thumbnailDataUrl,
  }
}

async function importZipFile(file: File, onProgress: (pct: number) => void): Promise<BrowserArenaImportResult> {
  onProgress(8)
  const { default: JSZip } = await import('jszip') // loaded only when a zip is dropped
  const zip = await JSZip.loadAsync(file)
  const entries = Object.values(zip.files).filter((entry) => !entry.dir)
  const htmlEntry = entries.find((entry) => /(^|\/)index\.html?$/i.test(entry.name)) || entries.find((entry) => /\.html?$/i.test(entry.name))
  if (!htmlEntry) throw new Error('Arena zip does not contain an HTML file')

  const rawUrls = new Map<string, string>()
  const basenameCounts = new Map<string, number>()
  const basenameUrls = new Map<string, string>()
  const cssText = new Map<string, string>()
  const htmlPath = normalizePath(htmlEntry.name)

  let done = 0
  for (const entry of entries) {
    const name = normalizePath(entry.name)
    if (name === htmlPath) continue
    if (/\.css$/i.test(name)) {
      cssText.set(name, await entry.async('text'))
    } else {
      rawUrls.set(name, objectUrl(await entry.async('blob').then((blob) => blob.slice(0, blob.size, guessMime(name)))))
    }
    done += 1
    onProgress(Math.min(70, 10 + Math.round((done / Math.max(1, entries.length)) * 58)))
  }

  for (const name of rawUrls.keys()) basenameCounts.set(basename(name), (basenameCounts.get(basename(name)) || 0) + 1)
  for (const [name, url] of rawUrls) if (basenameCounts.get(basename(name)) === 1) basenameUrls.set(basename(name), url)

  for (const [name, text] of cssText) {
    const rewritten = rewriteAssetRefs(text, dirname(name), rawUrls, basenameUrls)
    rawUrls.set(name, objectUrl(new Blob([rewritten], { type: 'text/css' })))
  }
  basenameUrls.clear()
  basenameCounts.clear()
  for (const name of rawUrls.keys()) basenameCounts.set(basename(name), (basenameCounts.get(basename(name)) || 0) + 1)
  for (const [name, url] of rawUrls) if (basenameCounts.get(basename(name)) === 1) basenameUrls.set(basename(name), url)

  let html = await htmlEntry.async('text')
  ensureSeekFunction(html)
  html = rewriteAssetRefs(html, dirname(htmlPath), rawUrls, basenameUrls)
  // Some Arena exports reference files without attributes, e.g. fetch("asset.json"). Patch the unambiguous ones too.
  for (const [name, url] of rawUrls) {
    const short = basename(name)
    if (basenameCounts.get(short) === 1) html = html.replace(new RegExp(`(['"])${escapeRegExp(short)}\\1`, 'g'), `$1${url}$1`)
  }
  onProgress(88)
  const htmlUrl = objectUrl(new Blob([html], { type: 'text/html' }))
  const thumbnailDataUrl = await captureArenaThumbnail(htmlUrl)
  onProgress(100)
  return {
    htmlFileName: basename(htmlPath),
    localPath: htmlUrl,
    thumbnailDataUrl,
  }
}

export async function importArenaFileInBrowser(file: File | null, onProgress: (pct: number) => void): Promise<BrowserArenaImportResult> {
  if (!file) throw new Error('Choose an Arena .zip or .html file to import')
  if (/\.zip$/i.test(file.name)) return importZipFile(file, onProgress)
  if (/\.html?$/i.test(file.name)) return importHtmlFile(file, onProgress)
  throw new Error('Arena import must be a .zip or .html file')
}

function loadVideoMetadata(src: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video')
    video.preload = 'metadata'
    video.muted = true
    video.src = src
    video.onloadedmetadata = () => {
      const duration = Number.isFinite(video.duration) ? video.duration : 0
      resolve(duration)
    }
    video.onerror = () => reject(new Error('The selected video could not be decoded by this browser'))
  })
}

function waveformFromChannel(channel: Float32Array, bars = 88): number[] {
  if (!channel.length) return []
  const bucketSize = Math.max(1, Math.floor(channel.length / bars))
  const values: number[] = []
  for (let bucket = 0; bucket < bars; bucket += 1) {
    const start = bucket * bucketSize
    const end = bucket === bars - 1 ? channel.length : Math.min(channel.length, start + bucketSize)
    let peak = 0
    for (let i = start; i < end; i += 1) peak = Math.max(peak, Math.abs(channel[i] || 0))
    values.push(Math.max(0.04, Math.min(1, Math.round(peak * 1000) / 1000)))
  }
  return values
}

function detectSilences(buffer: AudioBuffer, thresholdDb = DEFAULT_SILENCE_NOISE_DB, minDuration = DEFAULT_SILENCE_MIN_DURATION): [number, number][] {
  const threshold = Math.pow(10, thresholdDb / 20)
  const channel = buffer.getChannelData(0)
  const sampleRate = buffer.sampleRate
  const windowSize = Math.max(128, Math.floor(sampleRate * 0.05))
  const minWindows = Math.max(1, Math.ceil(minDuration / (windowSize / sampleRate)))
  const ranges: [number, number][] = []
  let silentStartWindow: number | null = null
  let windowIndex = 0

  for (let start = 0; start < channel.length; start += windowSize) {
    const end = Math.min(channel.length, start + windowSize)
    let sum = 0
    for (let i = start; i < end; i += 1) {
      const v = channel[i] || 0
      sum += v * v
    }
    const rms = Math.sqrt(sum / Math.max(1, end - start))
    const silent = rms < threshold
    if (silent && silentStartWindow === null) silentStartWindow = windowIndex
    if (!silent && silentStartWindow !== null) {
      if (windowIndex - silentStartWindow >= minWindows) {
        ranges.push([
          Math.round(silentStartWindow * (windowSize / sampleRate) * 10) / 10,
          Math.round(windowIndex * (windowSize / sampleRate) * 10) / 10,
        ])
      }
      silentStartWindow = null
    }
    windowIndex += 1
  }

  if (silentStartWindow !== null && windowIndex - silentStartWindow >= minWindows) {
    ranges.push([
      Math.round(silentStartWindow * (windowSize / sampleRate) * 10) / 10,
      Math.round(buffer.duration * 10) / 10,
    ])
  }
  return ranges.filter(([a, b]) => b > a)
}

async function analyzeAudio(file: File, onProgress: (pct: number) => void): Promise<{ waveform: number[]; silenceRanges: [number, number][] }> {
  const AudioContextCtor = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!AudioContextCtor) return { waveform: [], silenceRanges: [] }
  const context = new AudioContextCtor()
  try {
    onProgress(42)
    const data = await file.arrayBuffer()
    onProgress(58)
    const decoded = await context.decodeAudioData(data.slice(0))
    onProgress(78)
    return {
      waveform: waveformFromChannel(decoded.getChannelData(0)),
      silenceRanges: detectSilences(decoded),
    }
  } catch {
    return { waveform: [], silenceRanges: [] }
  } finally {
    void context.close()
  }
}

export async function analyzeFootageFileInBrowser(file: File | null, onProgress: (pct: number) => void): Promise<BrowserFootageAnalyzeResult> {
  if (!file) throw new Error('Choose an MP4, MOV, or WebM file to scan')
  const videoPath = objectUrl(file)
  onProgress(12)
  const durationSec = await loadVideoMetadata(videoPath)
  onProgress(32)
  const audio = await analyzeAudio(file, onProgress)
  onProgress(100)
  return {
    name: file.name,
    durationSec: Math.round(durationSec * 10) / 10,
    silenceRanges: audio.silenceRanges,
    waveform: audio.waveform,
    videoPath,
  }
}
