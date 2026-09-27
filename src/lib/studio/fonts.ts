/**
 * Google fonts on demand, for the canvas and the export.
 *
 * The Remotion font catalogue lists 1,800+ Google families, but the Studio
 * only bundles six. Choosing any other family used to paint the fallback
 * sans-serif — in the preview *and* in the exported video — so the font
 * resources looked broken. `ensureFont` downloads the family's Latin files
 * once, keeps them in Cache Storage so they work offline afterwards, and
 * registers them with `document.fonts`, which is exactly what the canvas
 * renderer resolves `fontFamily` against.
 */
import type { StudioDoc } from '../../types/project'

/** Families that ship with the app (see styles.css) — never downloaded. */
const BUNDLED = new Set(['inter', 'inter variable', 'jetbrains mono', 'jetbrains mono variable', 'manrope', 'manrope variable', 'playfair display', 'playfair display variable', 'dm sans', 'dm sans variable', 'space grotesk', 'space grotesk variable', 'system-ui', 'sans-serif', 'serif', 'monospace'])

const CACHE_NAME = 'cupric-fonts-v1'
const pending = new Map<string, Promise<boolean>>()
export const FONTS_CHANGED_EVENT = 'cupric:fonts-changed'

export function isBundledFont(family: string): boolean {
  return BUNDLED.has(family.trim().toLowerCase())
}

async function cachedFetch(url: string): Promise<Response> {
  const cache = typeof caches !== 'undefined' ? await caches.open(CACHE_NAME).catch(() => null) : null
  const hit = cache ? await cache.match(url).catch(() => undefined) : undefined
  if (hit) return hit
  const response = await fetch(url, { mode: 'cors', credentials: 'omit' })
  if (!response.ok) throw new Error(`Font download failed (${response.status})`)
  if (cache) await cache.put(url, response.clone()).catch(() => undefined)
  return response
}

type Face = { weight: string; style: string; url: string; unicodeRange?: string }

/** The Latin @font-face blocks of a css2 stylesheet. */
export function parseFontCss(css: string): Face[] {
  const faces: Face[] = []
  const blocks = css.split(/(?=\/\*\s*[\w-]+\s*\*\/\s*@font-face)|(?=@font-face)/)
  for (const block of blocks) {
    const subset = block.match(/\/\*\s*([\w-]+)\s*\*\//)?.[1]
    if (subset && subset !== 'latin' && subset !== 'latin-ext') continue
    const url = block.match(/src:\s*url\(([^)]+)\)/)?.[1]?.replace(/["']/g, '')
    if (!url) continue
    faces.push({
      url,
      weight: block.match(/font-weight:\s*([\d\s]+);/)?.[1]?.trim() ?? '400',
      style: block.match(/font-style:\s*(\w+)/)?.[1] ?? 'normal',
      unicodeRange: block.match(/unicode-range:\s*([^;]+);/)?.[1]?.trim(),
    })
  }
  return faces
}

/**
 * Make `family` available to the canvas. Resolves true when it is usable
 * (bundled, already loaded, or downloaded now), false when it could not be
 * fetched — the text then keeps rendering in the fallback face.
 */
export function ensureFont(family: string, weights: number[] = [400, 600, 800]): Promise<boolean> {
  const name = family.trim()
  if (!name || isBundledFont(name) || typeof document === 'undefined' || !('fonts' in document)) return Promise.resolve(true)
  const key = name.toLowerCase()
  const existing = pending.get(key)
  if (existing) return existing
  const job = (async () => {
    try {
      if (document.fonts.check(`16px "${name}"`) && [...document.fonts].some((f) => f.family.replace(/["']/g, '') === name)) return true
      const wanted = [...new Set(weights.filter((w) => w >= 100 && w <= 900).map((w) => Math.round(w / 100) * 100))].sort((a, b) => a - b)
      const axis = wanted.length ? `:wght@${wanted.join(';')}` : ''
      const url = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(name).replace(/%20/g, '+')}${axis}&display=swap`
      let css: string
      try {
        css = await (await cachedFetch(url)).text()
      } catch {
        // Some families have no weight axis at those stops — ask for the default.
        css = await (await cachedFetch(`https://fonts.googleapis.com/css2?family=${encodeURIComponent(name).replace(/%20/g, '+')}&display=swap`)).text()
      }
      const faces = parseFontCss(css)
      if (!faces.length) return false
      await Promise.all(
        faces.map(async (face) => {
          const buffer = await (await cachedFetch(face.url)).arrayBuffer()
          const font = new FontFace(name, buffer, { weight: face.weight, style: face.style, ...(face.unicodeRange ? { unicodeRange: face.unicodeRange } : {}) })
          await font.load()
          document.fonts.add(font)
        }),
      )
      window.dispatchEvent(new CustomEvent(FONTS_CHANGED_EVENT, { detail: name }))
      return true
    } catch {
      pending.delete(key) // allow a retry once the network is back
      return false
    }
  })()
  pending.set(key, job)
  return job
}

/** Every non-bundled family a document uses. */
export function docFontFamilies(doc: Pick<StudioDoc, 'clips'>): string[] {
  const families = new Set<string>()
  for (const clip of doc.clips) {
    if (clip.kind === 'text' && clip.fontFamily && !isBundledFont(clip.fontFamily)) families.add(clip.fontFamily)
  }
  return [...families]
}

/** Load every font a document needs; resolves with the families that failed. */
export async function ensureDocFonts(doc: Pick<StudioDoc, 'clips'>): Promise<string[]> {
  const families = docFontFamilies(doc)
  const results = await Promise.all(families.map((family) => ensureFont(family)))
  return families.filter((_, i) => !results[i])
}
