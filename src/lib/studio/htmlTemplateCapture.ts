/**
 * Render a deterministic HTML scene (resources/effects/*.html) into frames.
 *
 * Those scenes expose `window.__seek(t)`, the same contract the desktop render
 * pipeline uses. Reading their manifest into native clips produced page titles
 * and technical labels instead of the designed piece, so Apply renders the
 * real thing: the scene loads in an invisible same-origin frame (srcdoc works
 * in the dev server and in the packaged file:// app alike), is seeked frame by
 * frame, and each frame is rasterised through SVG foreignObject → canvas →
 * WebP. Canvases inside the scene are swapped for their pixels first, because
 * a serialized <canvas> element is blank.
 */

export type HtmlCaptureOptions = {
  file: string
  size: [number, number]
  durationSec: number
  fps?: number
  onProgress?: (pct: number) => void
  signal?: AbortSignal
}

export type HtmlCaptureResult = { frames: string[]; frameFps: number; width: number; height: number }

async function fetchText(file: string): Promise<string> {
  const rel = file.replace(/^\/+/, '')
  const candidates = [`/${rel}`, `./${rel}`, `../${rel}`]
  let lastError: unknown = null
  for (const url of candidates) {
    try {
      const response = await fetch(url, { cache: 'no-cache' })
      if (!response.ok) continue
      const text = await response.text()
      if (/<html|<body|<div/i.test(text)) return text
    } catch (error) {
      lastError = error
    }
  }
  throw new Error(`The scene file ${rel} is not bundled with this build${lastError ? '' : ''}.`)
}

const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.decoding = 'async'
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('The scene frame could not be rasterised.'))
    img.src = src
  })
}

export async function captureHtmlTemplate(opts: HtmlCaptureOptions): Promise<HtmlCaptureResult> {
  const [sceneW, sceneH] = opts.size
  const fps = Math.max(4, Math.min(12, opts.fps ?? 10))
  const frameCount = Math.max(1, Math.round(opts.durationSec * fps))
  // Frames are stored in the project: cap the long side to keep it light.
  const scale = Math.min(1, 1280 / Math.max(sceneW, sceneH))
  const outW = Math.round(sceneW * scale)
  const outH = Math.round(sceneH * scale)

  const html = await fetchText(opts.file)
  const frame = document.createElement('iframe')
  frame.setAttribute('aria-hidden', 'true')
  frame.tabIndex = -1
  frame.style.cssText = `position:fixed;left:-20000px;top:0;width:${sceneW}px;height:${sceneH}px;border:0;opacity:0;pointer-events:none;`
  const loaded = new Promise<void>((resolve, reject) => {
    frame.onload = () => resolve()
    setTimeout(() => reject(new Error('The scene took too long to load.')), 8000)
  })
  frame.srcdoc = html
  document.body.appendChild(frame)
  try {
    await loaded
    const win = frame.contentWindow as (Window & { __seek?: (t: number) => void }) | null
    const doc = frame.contentDocument
    if (!win || !doc || typeof win.__seek !== 'function') throw new Error('This scene has no seekable timeline (window.__seek).')
    await doc.fonts?.ready.catch(() => undefined)

    const canvas = document.createElement('canvas')
    canvas.width = outW
    canvas.height = outH
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Canvas is unavailable.')
    const serializer = new XMLSerializer()
    const frames: string[] = []
    for (let i = 0; i < frameCount; i += 1) {
      if (opts.signal?.aborted) throw new DOMException('Cancelled', 'AbortError')
      win.__seek(i / fps)
      await nextFrame()
      // Canvases serialize empty: replace each with an <img> of its pixels.
      const clone = doc.documentElement.cloneNode(true) as HTMLElement
      const liveCanvases = [...doc.querySelectorAll('canvas')]
      const clonedCanvases = [...clone.querySelectorAll('canvas')]
      liveCanvases.forEach((live, index) => {
        const target = clonedCanvases[index]
        if (!target) return
        const img = doc.createElement('img')
        try {
          img.src = live.toDataURL('image/png')
        } catch {
          return
        }
        img.setAttribute('style', target.getAttribute('style') ?? '')
        img.setAttribute('width', String(live.width))
        img.setAttribute('height', String(live.height))
        if (target.id) img.id = target.id
        if (target.className) img.className = target.className
        target.replaceWith(img)
      })
      clone.querySelectorAll('script').forEach((node) => node.remove())
      const markup = serializer.serializeToString(clone)
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${sceneW}" height="${sceneH}"><foreignObject x="0" y="0" width="100%" height="100%">${markup}</foreignObject></svg>`
      const img = await loadImage(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`)
      ctx.clearRect(0, 0, outW, outH)
      ctx.drawImage(img, 0, 0, outW, outH)
      frames.push(canvas.toDataURL('image/webp', 0.82))
      opts.onProgress?.(Math.round(((i + 1) / frameCount) * 100))
    }
    return { frames, frameFps: fps, width: outW, height: outH }
  } finally {
    frame.remove()
  }
}
