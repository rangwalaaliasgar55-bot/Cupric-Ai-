/**
 * Render a deterministic HTML scene (resources/effects/*.html) into frames.
 *
 * Those scenes expose `window.__seek(t)`, the same contract the desktop render
 * pipeline uses. Reading their manifest into native clips produced page titles
 * and technical labels instead of the designed piece, so Apply renders the
 * real thing, seeked frame by frame and rasterised through SVG foreignObject →
 * canvas → WebP. Canvases inside the scene are swapped for their pixels first,
 * because a serialized <canvas> element is blank.
 *
 * Isolation (2.28): scene HTML can come from third-party packs, and this runs
 * inside the app window, which holds the desktop IPC bridge. So the scene is
 * loaded in an iframe with `sandbox="allow-scripts"` and NO allow-same-origin:
 * it gets an opaque origin, cannot touch `window.parent` (or the bridge),
 * localStorage, cookies, popups or top navigation. A CSP meta blocks all
 * network access (`connect-src 'none'`, no remote scripts/images/fonts). The
 * serialization runs inside the frame via a small agent and each frame comes
 * back as markup over postMessage; the parent only ever rasterises it as an
 * SVG <img>, which never executes script.
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

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.decoding = 'async'
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('The scene frame could not be rasterised.'))
    img.src = src
  })
}

/** CSP for captured scenes: inline code only, no network of any kind. */
export const SCENE_CSP = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; media-src data: blob:; connect-src 'none'; frame-src 'none'; form-action 'none'; base-uri 'none'"

/** Runs inside the sandboxed frame: seek, serialize, post the markup back. */
const AGENT = `(() => {
  const reply = (msg) => parent.postMessage(Object.assign({ __newbrandScene: true }, msg), '*');
  const raf = () => new Promise((r) => requestAnimationFrame(() => r()));
  window.addEventListener('message', async (event) => {
    const msg = event.data;
    if (!msg || msg.__newbrandHost !== true) return;
    try {
      if (msg.type === 'probe') {
        if (document.fonts && document.fonts.ready) { try { await document.fonts.ready } catch (e) {} }
        reply({ id: msg.id, type: 'probe', hasSeek: typeof window.__seek === 'function' });
        return;
      }
      if (msg.type !== 'frame') return;
      await window.__seek(msg.t);
      await raf();
      const clone = document.documentElement.cloneNode(true);
      const live = Array.from(document.querySelectorAll('canvas'));
      const cloned = Array.from(clone.querySelectorAll('canvas'));
      live.forEach((c, i) => {
        const target = cloned[i];
        if (!target) return;
        const img = document.createElement('img');
        try { img.src = c.toDataURL('image/png') } catch (e) { return }
        img.setAttribute('style', target.getAttribute('style') || '');
        img.setAttribute('width', String(c.width));
        img.setAttribute('height', String(c.height));
        if (target.id) img.id = target.id;
        if (target.className) img.className = target.className;
        target.replaceWith(img);
      });
      clone.querySelectorAll('script, iframe, object, embed').forEach((n) => n.remove());
      const cspMeta = clone.querySelector('meta[http-equiv="Content-Security-Policy"]');
      if (cspMeta) cspMeta.remove();
      reply({ id: msg.id, type: 'frame', markup: new XMLSerializer().serializeToString(clone) });
    } catch (error) {
      reply({ id: msg.id, type: 'error', message: String((error && error.message) || error) });
    }
  });
})();`

/** The scene document with the CSP and agent injected first in <head>. */
export function sandboxedSceneDoc(html: string, csp: string = SCENE_CSP): string {
  const inject = `<meta http-equiv="Content-Security-Policy" content="${csp}"><script>${AGENT}</script>`
  if (/<head[^>]*>/i.test(html)) return html.replace(/<head[^>]*>/i, (m) => `${m}${inject}`)
  if (/<html[^>]*>/i.test(html)) return html.replace(/<html[^>]*>/i, (m) => `${m}<head>${inject}</head>`)
  return `<!doctype html><html><head>${inject}</head><body>${html}</body></html>`
}

type AgentReply = { __newbrandScene: true; id: number; type: 'probe' | 'frame' | 'error'; hasSeek?: boolean; markup?: string; message?: string }

/**
 * Arena exports may fetch their own bundled JSON (inlined as data: URLs by
 * inlineBlobAssets), so their CSP additionally allows `connect-src data:` —
 * still no network.
 */
export const ARENA_SCENE_CSP = SCENE_CSP.replace("connect-src 'none'", 'connect-src data:')

/** A live sandboxed scene: seek + rasterise frames, then close. */
export type SandboxedScene = {
  /** Seek to t seconds and draw that frame into ctx at outW×outH. */
  drawFrame: (t: number, ctx: CanvasRenderingContext2D, outW: number, outH: number) => Promise<void>
  close: () => void
}

/**
 * Load scene HTML in the opaque-origin sandbox (see header) and wait until it
 * reports a seekable timeline. The single isolation path for every HTML
 * capture in the app: resource templates, Arena thumbnails, Arena renders.
 */
export async function openSandboxedScene(html: string, sceneW: number, sceneH: number, opts: { csp?: string } = {}): Promise<SandboxedScene> {
  const frame = document.createElement('iframe')
  frame.setAttribute('aria-hidden', 'true')
  // Opaque origin: scripts run, but nothing else the app has is reachable.
  frame.setAttribute('sandbox', 'allow-scripts')
  frame.setAttribute('referrerpolicy', 'no-referrer')
  frame.tabIndex = -1
  frame.style.cssText = `position:fixed;left:-20000px;top:0;width:${sceneW}px;height:${sceneH}px;border:0;opacity:0;pointer-events:none;`

  let nextId = 1
  const waiting = new Map<number, { resolve: (r: AgentReply) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }>()
  const onMessage = (event: MessageEvent) => {
    // Only the frame we created may answer, and only in the agent's format.
    if (event.source !== frame.contentWindow) return
    const data = event.data as AgentReply
    if (!data || data.__newbrandScene !== true || typeof data.id !== 'number') return
    const entry = waiting.get(data.id)
    if (!entry) return
    waiting.delete(data.id)
    clearTimeout(entry.timer)
    entry.resolve(data)
  }
  const ask = (msg: { type: 'probe' } | { type: 'frame'; t: number }, timeoutMs = 8000) =>
    new Promise<AgentReply>((resolve, reject) => {
      const id = nextId++
      const timer = setTimeout(() => {
        waiting.delete(id)
        reject(new Error(msg.type === 'probe' ? 'The scene took too long to load.' : 'The scene stopped responding while being captured.'))
      }, timeoutMs)
      waiting.set(id, { resolve, reject, timer })
      frame.contentWindow?.postMessage({ __newbrandHost: true, id, ...msg }, '*')
    })
  const close = () => {
    window.removeEventListener('message', onMessage)
    for (const entry of waiting.values()) clearTimeout(entry.timer)
    waiting.clear()
    frame.remove()
  }

  const loaded = new Promise<void>((resolve, reject) => {
    frame.onload = () => resolve()
    setTimeout(() => reject(new Error('The scene took too long to load.')), 8000)
  })
  window.addEventListener('message', onMessage)
  frame.srcdoc = sandboxedSceneDoc(html, opts.csp)
  document.body.appendChild(frame)
  try {
    await loaded
    const probe = await ask({ type: 'probe' })
    if (!probe.hasSeek) throw new Error('This scene has no seekable timeline (window.__seek).')
  } catch (err) {
    close()
    throw err
  }
  return {
    close,
    drawFrame: async (t, ctx, outW, outH) => {
      const reply = await ask({ type: 'frame', t })
      if (reply.type === 'error' || !reply.markup) throw new Error(`The scene failed while being captured: ${reply.message ?? 'no frame'}`)
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${sceneW}" height="${sceneH}"><foreignObject x="0" y="0" width="100%" height="100%">${reply.markup}</foreignObject></svg>`
      const img = await loadImage(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`)
      ctx.drawImage(img, 0, 0, outW, outH)
    },
  }
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
  const scene = await openSandboxedScene(html, sceneW, sceneH)
  try {
    const canvas = document.createElement('canvas')
    canvas.width = outW
    canvas.height = outH
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Canvas is unavailable.')
    const frames: string[] = []
    for (let i = 0; i < frameCount; i += 1) {
      if (opts.signal?.aborted) throw new DOMException('Cancelled', 'AbortError')
      ctx.clearRect(0, 0, outW, outH)
      await scene.drawFrame(i / fps, ctx, outW, outH)
      frames.push(canvas.toDataURL('image/webp', 0.82))
      opts.onProgress?.(Math.round(((i + 1) / frameCount) * 100))
    }
    return { frames, frameFps: fps, width: outW, height: outH }
  } finally {
    scene.close()
  }
}

/* ——— same-origin blob assets → self-contained scene HTML ——————————————— */

const BLOB_RE = /blob:[^\s"'()<>]+/g

async function blobToDataUrl(blob: Blob): Promise<string> {
  const buf = new Uint8Array(await blob.arrayBuffer())
  let bin = ''
  for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000))
  return `data:${blob.type || 'application/octet-stream'};base64,${btoa(bin)}`
}

/**
 * The sandboxed frame has an opaque origin, so it cannot load the app's
 * blob: URLs, and SVG rasterisation cannot load any URL. Fetch them here
 * (the parent owns them) and inline: stylesheets become <style>, scripts
 * become inline <script>, everything else a data: URL. `fetchBlob` is
 * injectable for tests.
 */
export async function inlineBlobAssets(html: string, fetchBlob: (url: string) => Promise<Blob> = async (u) => (await fetch(u)).blob()): Promise<string> {
  const cache = new Map<string, Blob>()
  const get = async (u: string) => {
    if (!cache.has(u)) cache.set(u, await fetchBlob(u))
    return cache.get(u) as Blob
  }
  const replaceAsync = async (text: string, re: RegExp, fn: (...m: string[]) => Promise<string>) => {
    const parts: Array<string | Promise<string>> = []
    let last = 0
    for (const m of text.matchAll(re)) {
      parts.push(text.slice(last, m.index), fn(...(m as unknown as string[])))
      last = (m.index ?? 0) + m[0].length
    }
    parts.push(text.slice(last))
    return (await Promise.all(parts)).join('')
  }
  const inlineData = (text: string) => replaceAsync(text, BLOB_RE, async (u) => {
    try {
      return await blobToDataUrl(await get(u))
    } catch {
      return u
    }
  })
  const safeClose = (t: string, tag: string) => t.replace(new RegExp(`</${tag}`, 'gi'), `<\\/${tag}`)
  let out = await replaceAsync(html, /<link\b[^>]*\bhref=(["'])(blob:[^"']+)\1[^>]*>/gi, async (tag, _q, u) => {
    if (!/rel=(["'])?stylesheet/i.test(tag)) return tag
    try {
      return `<style>${safeClose(await inlineData(await (await get(u)).text()), 'style')}</style>`
    } catch {
      return tag
    }
  })
  out = await replaceAsync(out, /<script\b([^>]*)\bsrc=(["'])(blob:[^"']+)\2([^>]*)>\s*<\/script>/gi, async (tag, pre, _q, u, post) => {
    try {
      return `<script${pre}${post}>${safeClose(await inlineData(await (await get(u)).text()), 'script')}</script>`
    } catch {
      return tag
    }
  })
  return inlineData(out)
}
