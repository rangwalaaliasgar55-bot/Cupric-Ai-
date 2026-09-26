export type RenderUpdate = (pct: number) => void
import type { SceneRundown } from '../types/project'
import { getIpc } from './bridge'

export type RenderSource = {
  sourceType?: 'arena' | 'footage' | 'rundown'
  type?: 'arena' | 'footage' | 'rundown'
  id?: string
  label?: string
  durationSec?: number
  htmlPath?: string | null
  arenaPath?: string | null
  localPath?: string | null
  videoPath?: string | null
  footagePath?: string | null
  in?: number
  out?: number
  silenceRanges?: [number, number][]
  applySilenceCuts?: boolean
  captions?: { start?: number; end?: number; from?: number; to?: number; text?: string; copy?: string }[]
  captionStyle?: 'hormozi' | 'standard' | 'minimal'
  crop?: '16:9' | '9:16' | '1:1'
  rundown?: SceneRundown
}
export type RenderJobInput = {
  id?: string
  aspect?: string
  fps?: number
  quality?: string
  outputName?: string | null
  size?: [number, number]
  sources?: RenderSource[]
}
export type RenderResult = { outputPath?: string; outputName?: string; error?: string; cancelled?: boolean }

type BrowserRenderContext = {
  canvas: HTMLCanvasElement
  ctx: CanvasRenderingContext2D
  width: number
  height: number
  fps: number
  cancelled: () => boolean
  onUpdate: RenderUpdate
  totalDuration: number
  elapsedBefore: number
}

function mediaPathFromSource(source: RenderSource): string | null {
  if (source.sourceType === 'rundown' || source.type === 'rundown') return 'cupric-generated-rundown'
  return source.videoPath || source.footagePath || source.htmlPath || source.arenaPath || source.localPath || null
}

function isBrowserOnlyPath(path: string | null | undefined): boolean {
  return Boolean(path && /^(blob|data|https?):/i.test(path))
}

function hasBrowserOnlySources(job: RenderJobInput): boolean {
  return (job.sources ?? []).some(
    (source) => source.sourceType === 'rundown' || source.type === 'rundown' || isBrowserOnlyPath(mediaPathFromSource(source)),
  )
}

function durationOfSource(source: RenderSource): number {
  const explicit = Number(source.durationSec)
  if (Number.isFinite(explicit) && explicit > 0) return explicit
  const start = Number(source.in || 0)
  const end = Number(source.out)
  if (Number.isFinite(end) && end > start) return end - start
  return 3
}

function targetForAspect(aspect?: string, size?: [number, number]) {
  if (Array.isArray(size) && size.length >= 2) return { width: Math.round(size[0] || 1280), height: Math.round(size[1] || 720) }
  if (aspect === '9:16') return { width: 720, height: 1280 }
  if (aspect === '1:1') return { width: 900, height: 900 }
  return { width: 1280, height: 720 }
}

function nextFrame(): Promise<number> {
  return new Promise((resolve) => requestAnimationFrame(resolve))
}

function drawCover(ctx: CanvasRenderingContext2D, media: HTMLVideoElement, width: number, height: number) {
  const sourceW = media.videoWidth || width
  const sourceH = media.videoHeight || height
  const scale = Math.max(width / sourceW, height / sourceH)
  const drawW = sourceW * scale
  const drawH = sourceH * scale
  const x = (width - drawW) / 2
  const y = (height - drawH) / 2
  ctx.drawImage(media, x, y, drawW, drawH)
}

function drawSlate(ctx: CanvasRenderingContext2D, width: number, height: number, title: string, subtitle: string, t = 0) {
  const pulse = 0.5 + Math.sin(t * Math.PI * 2) * 0.5
  const gradient = ctx.createLinearGradient(0, 0, width, height)
  gradient.addColorStop(0, '#0B0B10')
  gradient.addColorStop(1, '#1C1C24')
  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, width, height)
  ctx.globalAlpha = 0.25
  ctx.fillStyle = '#C8F542'
  ctx.beginPath()
  ctx.arc(width * (0.18 + pulse * 0.04), height * 0.18, Math.min(width, height) * 0.22, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = '#4FB6E8'
  ctx.beginPath()
  ctx.arc(width * 0.84, height * (0.78 - pulse * 0.04), Math.min(width, height) * 0.25, 0, Math.PI * 2)
  ctx.fill()
  ctx.globalAlpha = 1
  ctx.fillStyle = '#C8F542'
  ctx.font = `700 ${Math.max(16, Math.round(width * 0.022))}px Inter, Arial, sans-serif`
  ctx.letterSpacing = '3px'
  ctx.fillText('CUPRIC AI', width * 0.07, height * 0.16)
  ctx.letterSpacing = '0px'
  ctx.fillStyle = '#F4F1EA'
  ctx.font = `800 ${Math.max(30, Math.round(width * 0.058))}px Inter, Arial, sans-serif`
  wrapText(ctx, title, width * 0.07, height * 0.48, width * 0.84, Math.max(38, width * 0.066))
  ctx.fillStyle = '#9A9AA5'
  ctx.font = `500 ${Math.max(18, Math.round(width * 0.024))}px Inter, Arial, sans-serif`
  wrapText(ctx, subtitle, width * 0.07, height * 0.66, width * 0.78, Math.max(26, width * 0.034))
}

function wrapText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, maxWidth: number, lineHeight: number) {
  const words = text.split(/\s+/).filter(Boolean)
  let line = ''
  let cursorY = y
  for (const word of words) {
    const test = line ? `${line} ${word}` : word
    if (ctx.measureText(test).width > maxWidth && line) {
      ctx.fillText(line, x, cursorY)
      line = word
      cursorY += lineHeight
    } else line = test
  }
  if (line) ctx.fillText(line, x, cursorY)
}

function drawProgress(ctx: CanvasRenderingContext2D, width: number, height: number, pct: number) {
  const margin = width * 0.07
  const barW = width - margin * 2
  const barH = Math.max(6, height * 0.008)
  const y = height - margin * 0.75
  ctx.fillStyle = 'rgba(255,255,255,.14)'
  ctx.fillRect(margin, y, barW, barH)
  ctx.fillStyle = '#C8F542'
  ctx.fillRect(margin, y, barW * Math.max(0, Math.min(1, pct)), barH)
}

function drawResourcePack(ctx: CanvasRenderingContext2D, width: number, height: number, t: number) {
  const cards = ['Cu/AI mark', 'kinetic type', 'motion grid', 'accent shapes']
  const cardW = width * 0.17
  const cardH = height * 0.105
  const gap = width * 0.014
  const startX = width * 0.07
  const y = height * 0.78
  ctx.font = `700 ${Math.max(12, Math.round(width * 0.014))}px Inter, Arial, sans-serif`
  cards.forEach((label, index) => {
    const x = startX + index * (cardW + gap)
    const pulse = 0.5 + Math.sin(t * 2 + index) * 0.5
    ctx.fillStyle = 'rgba(255,255,255,.075)'
    roundRect(ctx, x, y, cardW, cardH, 14)
    ctx.fill()
    ctx.strokeStyle = index % 2 ? 'rgba(79,182,232,.38)' : 'rgba(200,245,66,.38)'
    ctx.stroke()
    ctx.fillStyle = index % 2 ? '#4FB6E8' : '#C8F542'
    ctx.beginPath()
    ctx.arc(x + cardH * 0.5, y + cardH * 0.5, cardH * (0.18 + pulse * 0.08), 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = '#F4F1EA'
    ctx.fillText(label, x + cardH * 0.92, y + cardH * 0.56)
  })
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const radius = Math.min(r, w / 2, h / 2)
  ctx.beginPath()
  ctx.moveTo(x + radius, y)
  ctx.arcTo(x + w, y, x + w, y + h, radius)
  ctx.arcTo(x + w, y + h, x, y + h, radius)
  ctx.arcTo(x, y + h, x, y, radius)
  ctx.arcTo(x, y, x + w, y, radius)
  ctx.closePath()
}

function loadVideo(src: string): Promise<HTMLVideoElement> {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video')
    video.crossOrigin = 'anonymous'
    video.preload = 'auto'
    video.muted = true
    video.playsInline = true
    video.src = src
    video.onloadeddata = () => resolve(video)
    video.onerror = () => reject(new Error('Browser could not decode a video clip on the timeline'))
  })
}

function seekVideo(video: HTMLVideoElement, time: number): Promise<void> {
  return new Promise((resolve) => {
    const done = () => {
      video.removeEventListener('seeked', done)
      resolve()
    }
    video.addEventListener('seeked', done)
    video.currentTime = Math.max(0, Math.min(time, Number.isFinite(video.duration) ? video.duration : time))
    window.setTimeout(done, 500)
  })
}

async function renderFootageSource(source: RenderSource, context: BrowserRenderContext) {
  const src = source.videoPath || source.footagePath || source.localPath
  if (!src) throw new Error('Timeline footage source is missing')
  const duration = durationOfSource(source)
  const startSec = Number(source.in || 0)
  const video = await loadVideo(src)
  await seekVideo(video, startSec)
  await video.play().catch(() => undefined)

  const startedAt = performance.now()
  let elapsed = 0
  while (elapsed < duration && !context.cancelled()) {
    elapsed = Math.min(duration, (performance.now() - startedAt) / 1000)
    context.ctx.fillStyle = '#000'
    context.ctx.fillRect(0, 0, context.width, context.height)
    drawCover(context.ctx, video, context.width, context.height)
    drawProgress(context.ctx, context.width, context.height, elapsed / duration)
    context.onUpdate(Math.min(99, ((context.elapsedBefore + elapsed) / context.totalDuration) * 100))
    await nextFrame()
  }
  video.pause()
}

function loadIframe(src: string, width: number, height: number): Promise<HTMLIFrameElement> {
  return new Promise((resolve, reject) => {
    const iframe = document.createElement('iframe')
    iframe.src = src
    iframe.style.position = 'fixed'
    iframe.style.left = '-100000px'
    iframe.style.top = '0'
    iframe.style.width = `${width}px`
    iframe.style.height = `${height}px`
    iframe.style.border = '0'
    iframe.style.pointerEvents = 'none'
    iframe.onload = () => resolve(iframe)
    iframe.onerror = () => reject(new Error('Arena HTML preview could not be loaded for browser rendering'))
    document.body.appendChild(iframe)
  })
}

async function captureArenaFrame(iframe: HTMLIFrameElement, context: BrowserRenderContext, t: number) {
  const win = iframe.contentWindow as (Window & { __seek?: (time: number) => void | Promise<void> }) | null
  const doc = iframe.contentDocument
  if (!win || !doc) throw new Error('Arena HTML is not accessible for browser capture')
  if (typeof win.__seek !== 'function') throw new Error('Arena HTML must expose window.__seek(t)')
  await win.__seek(t)
  await nextFrame()
  const { default: html2canvas } = await import('html2canvas')
  const element = (doc.getElementById('scene') || doc.body || doc.documentElement) as HTMLElement
  const shot = await html2canvas(element, {
    backgroundColor: '#0B0B10',
    logging: false,
    useCORS: true,
    allowTaint: true,
    width: context.width,
    height: context.height,
    windowWidth: context.width,
    windowHeight: context.height,
    scale: 1,
  })
  context.ctx.fillStyle = '#0B0B10'
  context.ctx.fillRect(0, 0, context.width, context.height)
  context.ctx.drawImage(shot, 0, 0, context.width, context.height)
}

function sceneAt(rundown: SceneRundown, time: number) {
  return rundown.scenes.find((scene) => time >= scene.from && time < scene.to) || rundown.scenes[rundown.scenes.length - 1]
}

function easeOutCubic(t: number) {
  return 1 - Math.pow(1 - Math.max(0, Math.min(1, t)), 3)
}

function drawRundownFrame(source: RenderSource, context: BrowserRenderContext, t: number) {
  const rundown = source.rundown
  const duration = durationOfSource(source)
  const scene = rundown ? sceneAt(rundown, t) : null
  const sceneStart = scene?.from ?? 0
  const sceneDuration = Math.max(0.1, (scene?.to ?? duration) - sceneStart)
  const local = Math.max(0, Math.min(1, (t - sceneStart) / sceneDuration))
  const enter = easeOutCubic(Math.min(1, local * 2.6))
  const width = context.width
  const height = context.height
  const ctx = context.ctx
  const title = scene?.copy || rundown?.title || source.label || 'Cupric AI video'
  const detail = scene?.motion || rundown?.style || 'Generated Cupric AI motion video'

  const gradient = ctx.createLinearGradient(0, 0, width, height)
  gradient.addColorStop(0, '#0B0B10')
  gradient.addColorStop(0.56, '#15151B')
  gradient.addColorStop(1, '#1C1C24')
  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, width, height)

  ctx.save()
  ctx.globalAlpha = 0.2
  ctx.fillStyle = '#C8F542'
  ctx.beginPath()
  ctx.arc(width * (0.12 + 0.06 * Math.sin(t * 1.7)), height * 0.14, Math.min(width, height) * 0.24, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = '#4FB6E8'
  ctx.beginPath()
  ctx.arc(width * (0.86 + 0.03 * Math.cos(t * 1.2)), height * 0.8, Math.min(width, height) * 0.28, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()

  ctx.fillStyle = '#C8F542'
  ctx.font = `800 ${Math.max(18, Math.round(width * 0.026))}px Inter, Arial, sans-serif`
  ctx.fillText('CUPRIC AI', width * 0.07, height * 0.12)

  ctx.save()
  ctx.translate(width * 0.07, height * 0.36)
  ctx.scale(0.96 + enter * 0.04, 0.96 + enter * 0.04)
  ctx.globalAlpha = enter
  ctx.fillStyle = '#9A9AA5'
  ctx.font = `700 ${Math.max(14, Math.round(width * 0.02))}px Inter, Arial, sans-serif`
  ctx.fillText(`${scene?.type || 'scene'} · ${Math.min(duration, t).toFixed(1)}s`, 0, -height * 0.075)
  ctx.fillStyle = '#F4F1EA'
  ctx.font = `900 ${Math.max(34, Math.round(width * 0.068))}px Inter, Arial, sans-serif`
  wrapText(ctx, title.toUpperCase(), 0, 0, width * 0.82, Math.max(44, width * 0.074))
  ctx.fillStyle = '#9A9AA5'
  ctx.font = `500 ${Math.max(16, Math.round(width * 0.023))}px Inter, Arial, sans-serif`
  wrapText(ctx, detail, 0, height * 0.28, width * 0.72, Math.max(24, width * 0.032))
  ctx.restore()

  drawResourcePack(ctx, width, height, t)
  drawProgress(ctx, width, height, t / Math.max(0.1, duration))
}

async function renderRundownSource(source: RenderSource, context: BrowserRenderContext) {
  const duration = durationOfSource(source)
  const startedAt = performance.now()
  let elapsed = 0
  while (elapsed < duration && !context.cancelled()) {
    elapsed = Math.min(duration, (performance.now() - startedAt) / 1000)
    drawRundownFrame(source, context, elapsed)
    context.onUpdate(Math.min(99, ((context.elapsedBefore + elapsed) / context.totalDuration) * 100))
    await nextFrame()
  }
}

async function renderArenaSource(source: RenderSource, context: BrowserRenderContext) {
  const src = source.htmlPath || source.arenaPath || source.localPath
  if (!src) throw new Error('Arena source is missing')
  const duration = durationOfSource(source)
  const iframe = await loadIframe(src, context.width, context.height)
  const captureFps = Math.min(12, context.fps)
  const frameDuration = 1 / captureFps
  try {
    for (let t = 0; t < duration && !context.cancelled(); t += frameDuration) {
      const sourceTime = (Number(source.in) || 0) + t
      await captureArenaFrame(iframe, context, sourceTime)
      drawProgress(context.ctx, context.width, context.height, t / duration)
      context.onUpdate(Math.min(99, ((context.elapsedBefore + t) / context.totalDuration) * 100))
      await new Promise((resolve) => window.setTimeout(resolve, frameDuration * 1000))
    }
  } finally {
    iframe.remove()
  }
}

function browserRender(job: RenderJobInput, onUpdate: RenderUpdate, onDone: (result?: RenderResult) => void): () => void {
  let cancelled = false
  let recorder: MediaRecorder | null = null
  const sources = (job.sources ?? []).filter((source) => source && (source.sourceType || source.type) && mediaPathFromSource(source))

  void (async () => {
    try {
      if (!sources.length) throw new Error('Add imported Arena HTML or footage before rendering')
      if (typeof MediaRecorder === 'undefined') throw new Error('This browser does not support MediaRecorder exports')
      const target = targetForAspect(job.aspect, job.size)
      const canvas = document.createElement('canvas')
      canvas.width = target.width
      canvas.height = target.height
      const ctx = canvas.getContext('2d')
      if (!ctx) throw new Error('Canvas rendering is unavailable')
      const fps = Number(job.fps) === 60 ? 60 : 30
      const stream = canvas.captureStream(fps)
      const mimeType = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'].find((mime) => MediaRecorder.isTypeSupported(mime)) || ''
      const chunks: BlobPart[] = []
      recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunks.push(event.data)
      }
      const stopped = new Promise<void>((resolve) => {
        if (recorder) recorder.onstop = () => resolve()
      })

      drawSlate(ctx, target.width, target.height, 'Preparing browser render', 'Recording canvas frames to a downloadable WebM draft.', 0)
      recorder.start(250)
      onUpdate(1)

      const totalDuration = sources.reduce((sum, source) => sum + durationOfSource(source), 0)
      let elapsedBefore = 0
      for (const source of sources) {
        if (cancelled) throw new Error('Render cancelled')
        const context: BrowserRenderContext = {
          canvas,
          ctx,
          width: target.width,
          height: target.height,
          fps,
          cancelled: () => cancelled,
          onUpdate,
          totalDuration,
          elapsedBefore,
        }
        if (source.sourceType === 'footage' || source.type === 'footage') await renderFootageSource(source, context)
        else if (source.sourceType === 'rundown' || source.type === 'rundown') await renderRundownSource(source, context)
        else await renderArenaSource(source, context)
        elapsedBefore += durationOfSource(source)
      }

      if (cancelled) throw new Error('Render cancelled')
      recorder.stop()
      await stopped
      const blob = new Blob(chunks, { type: recorder.mimeType || 'video/webm' })
      const outputPath = URL.createObjectURL(blob)
      const outputName = (job.outputName || 'cupric-render.mp4').replace(/\.mp4$/i, '.webm')
      onUpdate(100)
      onDone({ outputPath, outputName })
    } catch (err) {
      if (!cancelled) onDone({ error: err instanceof Error ? err.message : 'Browser render failed' })
    } finally {
      streamStop(recorder?.stream)
    }
  })

  return () => {
    cancelled = true
    try {
      if (recorder && recorder.state !== 'inactive') recorder.stop()
    } catch {}
  }
}

function streamStop(stream?: MediaStream) {
  stream?.getTracks().forEach((track) => track.stop())
}

export function startRender(job: RenderJobInput, onUpdate: RenderUpdate, onDone: (result?: RenderResult) => void): () => void {
  const ipc = getIpc()
  if (ipc && !hasBrowserOnlySources(job)) {
    let finished = false
    let cancelled = false
    const cleanup: Array<() => void> = []
    const done = (result?: RenderResult) => {
      if (finished) return
      finished = true
      cleanup.forEach((fn) => fn())
      onDone(result)
    }

    if (typeof ipc.on === 'function') {
      cleanup.push(
        ipc.on('render:progress', (event: { jobId?: string; pct?: number }) => {
          if (event?.jobId === job.id && typeof event.pct === 'number') onUpdate(event.pct)
        }),
      )
      cleanup.push(
        ipc.on('render:error', (event: { jobId?: string; error?: string }) => {
          if (event?.jobId === job.id && !cancelled) done({ error: event.error || 'Render failed' })
        }),
      )
      cleanup.push(
        ipc.on('render:done', (event: { jobId?: string; outputPath?: string }) => {
          if (event?.jobId === job.id) {
            onUpdate(100)
            done({ outputPath: event.outputPath })
          }
        }),
      )
    }

    onUpdate(1)
    ipc
      .invoke('render:start', job)
      .then((result: RenderResult) => {
        if (!cancelled) {
          onUpdate(100)
          done(result)
        }
      })
      .catch((err: Error) => {
        if (!cancelled) done({ error: err?.message || 'Render failed' })
      })

    return () => {
      cancelled = true
      cleanup.forEach((fn) => fn())
      void ipc.invoke('render:cancel', { jobId: job.id })
    }
  }

  return browserRender(job, onUpdate, onDone)
}
