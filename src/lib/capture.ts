/**
 * Turn a live DOM element into an image, whatever it is painted with.
 *
 * 1. Desktop: ask the main process to grab the element's rectangle straight
 *    from the compositor — pixel-perfect for oklch(), color-mix(),
 *    backdrop-filter, canvas and WebGL.
 * 2. Browser: html-to-image, which lets the browser itself render the DOM
 *    through an SVG foreignObject, so modern CSS colours work.
 * 3. Last resort: html2canvas, with the element's computed oklch colours
 *    flattened to rgb first so it cannot throw on them.
 */
import { getIpc } from './bridge'

export type CaptureOptions = {
  /** Output format; webp/jpeg keep long frame sequences small. */
  type?: 'image/png' | 'image/webp' | 'image/jpeg'
  quality?: number
  background?: string | null
}

async function viaCompositor(element: HTMLElement, options: CaptureOptions): Promise<string | null> {
  const ipc = getIpc()
  if (!ipc) return null
  const rect = element.getBoundingClientRect()
  if (rect.width < 2 || rect.height < 2) return null
  try {
    const url = (await ipc.invoke('capture:rect', {
      x: rect.left,
      y: rect.top,
      width: rect.width,
      height: rect.height,
      format: options.type === 'image/png' ? 'png' : 'jpeg',
    })) as string
    return typeof url === 'string' && url.startsWith('data:image/') ? url : null
  } catch {
    return null
  }
}

/** Font CSS is identical for every frame of a sequence; embed it once. */
let fontCss: { root: HTMLElement; css: string } | null = null

async function viaHtmlToImage(element: HTMLElement, options: CaptureOptions): Promise<string | null> {
  try {
    const { toCanvas, getFontEmbedCSS } = await import('html-to-image')
    if (!fontCss || fontCss.root !== element) {
      fontCss = { root: element, css: await getFontEmbedCSS(element).catch(() => '') }
    }
    const canvas = await toCanvas(element, {
      pixelRatio: 1,
      cacheBust: false,
      fontEmbedCSS: fontCss.css,
      backgroundColor: options.background ?? undefined,
      // The clone keeps the root's own layout styles; an `mx-auto` margin (or
      // any transform) would shift the content inside the SVG and leave a
      // blank band on one side of every frame.
      style: { margin: '0', transform: 'none', left: '0', top: '0' },
      width: element.offsetWidth || undefined,
      height: element.offsetHeight || undefined,
      // Fonts are bundled locally; skip anything that cannot be inlined.
      filter: (node) => !(node instanceof HTMLElement && node.dataset.captureIgnore === 'true'),
    })
    if (!canvas.width || !canvas.height) return null
    return canvas.toDataURL(options.type ?? 'image/webp', options.quality ?? 0.82)
  } catch {
    return null
  }
}

/** Replace oklch()/color-mix() in inline styles with the browser's resolved rgb. */
function flattenModernColours(root: HTMLElement): () => void {
  const touched: Array<[HTMLElement, string]> = []
  const props = ['color', 'background-color', 'border-top-color', 'border-right-color', 'border-bottom-color', 'border-left-color', 'outline-color', 'fill', 'stroke', 'box-shadow', 'background-image']
  const probe = document.createElement('canvas').getContext('2d')
  const toRgb = (value: string) => {
    if (!probe) return value
    return value.replace(/(?:oklch|oklab|lch|lab|color-mix|color)\([^()]*(?:\([^()]*\)[^()]*)*\)/g, (match) => {
      probe.fillStyle = '#000'
      probe.fillStyle = match
      return String(probe.fillStyle)
    })
  }
  for (const el of [root, ...root.querySelectorAll<HTMLElement>('*')]) {
    const computed = getComputedStyle(el)
    const before = el.getAttribute('style') ?? ''
    let changed = false
    for (const prop of props) {
      const value = computed.getPropertyValue(prop)
      if (/oklch|oklab|lch\(|lab\(|color-mix|color\(/.test(value)) {
        el.style.setProperty(prop, prop === 'background-image' && /gradient/.test(value) ? toRgb(value) : toRgb(value))
        changed = true
      }
    }
    if (changed) touched.push([el, before])
  }
  return () => {
    for (const [el, before] of touched) {
      if (before) el.setAttribute('style', before)
      else el.removeAttribute('style')
    }
  }
}

async function viaHtml2Canvas(element: HTMLElement, options: CaptureOptions): Promise<string> {
  const { default: html2canvas } = await import('html2canvas')
  const restore = flattenModernColours(element)
  try {
    const canvas = await html2canvas(element, { backgroundColor: options.background ?? null, scale: 1, logging: false, useCORS: true })
    return canvas.toDataURL(options.type ?? 'image/webp', options.quality ?? 0.82)
  } finally {
    restore()
  }
}

export type CaptureMethod = 'compositor' | 'html-to-image' | 'html2canvas'

/** Capture `element` to a data URL. Throws only when every method fails. */
export async function captureElement(element: HTMLElement, options: CaptureOptions = {}, prefer?: CaptureMethod): Promise<{ dataUrl: string; method: CaptureMethod }> {
  if (prefer !== 'html-to-image' && prefer !== 'html2canvas') {
    const direct = await viaCompositor(element, options)
    if (direct) return { dataUrl: direct, method: 'compositor' }
  }
  if (prefer !== 'html2canvas') {
    const rendered = await viaHtmlToImage(element, options)
    if (rendered && !(await looksBlank(rendered))) return { dataUrl: rendered, method: 'html-to-image' }
  }
  return { dataUrl: await viaHtml2Canvas(element, options), method: 'html2canvas' }
}

/** A fully transparent or single-colour frame means the renderer silently failed. */
async function looksBlank(dataUrl: string): Promise<boolean> {
  try {
    const img = new Image()
    img.src = dataUrl
    await img.decode()
    const w = 48
    const h = Math.max(1, Math.round((img.height / Math.max(1, img.width)) * 48))
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) return false
    ctx.drawImage(img, 0, 0, w, h)
    const data = ctx.getImageData(0, 0, w, h).data
    let min = 765
    let max = 0
    let opaque = 0
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] < 8) continue
      opaque += 1
      const v = data[i] + data[i + 1] + data[i + 2]
      if (v < min) min = v
      if (v > max) max = v
    }
    return opaque === 0 || max - min < 6
  } catch {
    return false
  }
}
