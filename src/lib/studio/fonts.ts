/**
 * Fonts for the canvas, the preview and the export.
 *
 * Three kinds of family reach a text clip:
 *   bundled  — shipped with the app (@fontsource, see styles.css);
 *   yours    — files the user dropped in (IndexedDB, see userFonts.ts);
 *   remote   — any other name, downloaded once from Google Fonts and cached.
 *
 * The canvas renderer resolves `fontFamily` against `document.fonts`. A face
 * that has never been laid out in the DOM is *not* loaded, and canvas text
 * silently paints in the fallback instead — which is what "the font I picked
 * didn't apply" really was: applying a suggestion changed the document, the
 * bundle's CSS had simply never fetched that face. So every path now proves
 * the face is ready (`document.fonts.load` + `check`) before anything claims a
 * font is applied, and the answer is reported instead of assumed.
 */
import type { StudioDoc } from '../../types/project'

/** Families that ship with the app (see styles.css) — never downloaded. */
const BUNDLED = new Set(['inter', 'inter variable', 'jetbrains mono', 'jetbrains mono variable', 'manrope', 'manrope variable', 'playfair display', 'playfair display variable', 'dm sans', 'dm sans variable', 'space grotesk', 'space grotesk variable', 'geist', 'geist variable', 'montserrat', 'montserrat variable', 'poppins', 'outfit', 'outfit variable', 'bebas neue', 'anton', 'instrument serif', 'syne', 'syne variable', 'unbounded', 'unbounded variable', 'bricolage grotesque', 'bricolage grotesque variable', 'fraunces', 'fraunces variable', 'dm serif display', 'plus jakarta sans', 'plus jakarta sans variable', 'archivo black', 'noto sans devanagari', 'hind', 'system-ui', 'sans-serif', 'serif', 'monospace'])

import { USER_FONTS_EVENT, isUserFont, userFontsReady } from './userFonts'

const CACHE_NAME = 'cupric-fonts-v1'
/** In-flight requests only — settled results are dropped so a late font file wins. */
const pending = new Map<string, Promise<boolean>>()
/** Families that just failed, so a loop of callers does not hammer the network. */
const failedAt = new Map<string, number>()
const RETRY_AFTER_MS = 30_000
if (typeof window !== 'undefined') {
  // Adding a font file invalidates every earlier failure immediately.
  window.addEventListener(USER_FONTS_EVENT, () => { failedAt.clear(); pending.clear() })
}
export const FONTS_CHANGED_EVENT = 'cupric:fonts-changed'
/** Fired when a family turns out to be unusable, so the UI can say so. */
export const FONT_MISSING_EVENT = 'cupric:font-missing'

export type FontKind = 'bundled' | 'user' | 'remote'
/** ready = painted with the real face · loading · missing = will fall back. */
export type FontStatus = 'ready' | 'loading' | 'missing'

export function isBundledFont(family: string): boolean {
  return BUNDLED.has(family.trim().toLowerCase())
}

/** Where a family comes from. Unknown names are remote (downloaded on demand). */
export function fontKind(family: string): FontKind {
  const name = family.trim()
  if (isBundledFont(name)) return 'bundled'
  if (isUserFont(name)) return 'user'
  return 'remote'
}

export const hasFontApi = () =>
  typeof document !== 'undefined' && 'fonts' in document && typeof document.fonts?.load === 'function'

/** Faces `document.fonts` actually holds for this family (exact name, quotes stripped). */
function registeredFaces(family: string): FontFace[] {
  if (!hasFontApi()) return []
  const want = family.trim().replace(/["']/g, '').toLowerCase()
  return [...document.fonts].filter((f) => f.family.replace(/["']/g, '').toLowerCase() === want)
}

/**
 * Ask the browser to load one weight of a family and verify it did.
 *
 * `document.fonts.load` resolves with the matching faces (empty when the
 * family is unknown) and is idempotent — an already-loaded face returns at
 * once, so calling it on every apply, scrub and export costs nothing.
 */
async function loadFace(family: string, weights: number[]): Promise<boolean> {
  if (!hasFontApi()) return false
  const wanted = weights.length ? weights : [400]
  const spec = family.trim().replace(/["']/g, '')
  const results = await Promise.all(
    wanted.map((w) => document.fonts.load(`${Math.round(w)} 16px "${spec}"`).catch(() => [] as FontFace[])),
  )
  if (results.some((faces) => faces.length > 0)) return true
  // Fall back to the shorthand (some variable faces only match without a weight).
  const plain = await document.fonts.load(`16px "${spec}"`).catch(() => [] as FontFace[])
  if (plain.length > 0) return true
  return registeredFaces(spec).length > 0 && document.fonts.check(`16px "${spec}"`)
}

/** Synchronous best guess — used to paint the UI state without awaiting. */
export function fontStatus(family: string, weights: number[] = [400, 600, 800]): FontStatus {
  const name = family.trim()
  if (!name) return 'missing'
  if (!hasFontApi()) return isBundledFont(name) || isUserFont(name) ? 'ready' : 'missing'
  const spec = name.replace(/["']/g, '')
  if (weights.some((w) => document.fonts.check(`${w} 16px "${spec}"`))) return 'ready'
  if (document.fonts.check(`16px "${spec}"`) || registeredFaces(spec).length > 0) return 'loading'
  return isBundledFont(name) || isUserFont(name) ? 'loading' : 'missing'
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
 * Make `family` usable by the canvas. Resolves true only when a face for it is
 * really ready (bundled, user-added, already loaded, or downloaded now), false
 * when it could not be made ready — callers then say so instead of quietly
 * painting the fallback face and calling it applied.
 */
export function ensureFont(family: string, weights: number[] = [400, 600, 800]): Promise<boolean> {
  const name = family.trim()
  if (!name || typeof document === 'undefined' || !('fonts' in document)) return Promise.resolve(true)
  const wanted = [...new Set(weights.filter((w) => Number.isFinite(w) && w >= 100 && w <= 900).map((w) => Math.round(w / 100) * 100))]
  const key = name.toLowerCase()
  const existing = pending.get(key)
  if (existing) return existing
  const failed = failedAt.get(key)
  if (failed && Date.now() - failed < RETRY_AFTER_MS) return Promise.resolve(false)

  const job = (async () => {
    // 1. Bundled and user faces: they already exist, they just have to be
    //    loaded. This is the fix for "I picked a font and nothing changed".
    if (isBundledFont(name) || isUserFont(name)) {
      if (isUserFont(name)) await userFontsReady()
      if (await loadFace(name, wanted.concat(400))) return true
      // A bundled family that the stylesheet did not define (or a font file the
      // browser rejected) — report it rather than pretending.
      noteMissing(name, 'bundled-missing')
      return false
    }

    // 2. Already registered this session (user font or a previous download).
    if (await loadFace(name, wanted)) return true

    // 3. Remote: download the Latin files once and register them.
    try {
      const wanted_axis = wanted.length ? `:wght@${wanted.join(';')}` : ''
      const url = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(name).replace(/%20/g, '+')}${wanted_axis}&display=swap`
      let css: string
      try {
        css = await (await cachedFetch(url)).text()
      } catch {
        // Some families have no weight axis at those stops — ask for the default.
        css = await (await cachedFetch(`https://fonts.googleapis.com/css2?family=${encodeURIComponent(name).replace(/%20/g, '+')}&display=swap`)).text()
      }
      const faces = parseFontCss(css)
      if (!faces.length) {
        noteMissing(name, 'not-on-google-fonts')
        return false
      }
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
      noteMissing(name, 'network-or-licence')
      return false
    }
  })()
  pending.set(key, job)
  void job.then(
    (ready) => { pending.delete(key); if (!ready) failedAt.set(key, Date.now()) },
    () => { pending.delete(key) },
  )
  return job
}

/** One loud event per family, so the UI can explain the fallback exactly once. */
const missingNoted = new Set<string>()
function noteMissing(family: string, reason: string) {
  const key = `${family.toLowerCase()}|${reason}`
  if (missingNoted.has(key)) return
  missingNoted.add(key)
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(FONT_MISSING_EVENT, { detail: { family, reason } }))
}

/**
 * Every family a document uses (bundled included — those need loading too),
 * with the weights the clips actually ask for.
 */
export function docFontPlan(doc: Pick<StudioDoc, 'clips'>): Array<{ family: string; weights: number[] }> {
  const plan = new Map<string, Set<number>>()
  const want = (family: string | undefined | null, weight: number) => {
    const name = (family ?? '').trim()
    if (!name) return
    const weights = plan.get(name) ?? new Set<number>()
    weights.add(weight)
    plan.set(name, weights)
  }
  for (const clip of doc.clips) {
    if (clip.kind !== 'text' || clip.hidden) continue
    const weight = clip.weight ?? 400
    // The headline face *and* the emphasis face: without the second one the
    // one italic word a suggested look is built around paints in a fallback.
    want(clip.fontFamily, weight)
    want(clip.emphasisFont, weight)
  }
  return [...plan].map(([family, weights]) => ({ family, weights: [...weights] }))
}

/** Every family a document uses, bundled families included. */
export function docFontFamilies(doc: Pick<StudioDoc, 'clips'>): string[] {
  return docFontPlan(doc).map((f) => f.family)
}

/** Load every font a document needs; resolves with the families that failed. */
export async function ensureDocFonts(doc: Pick<StudioDoc, 'clips'>): Promise<string[]> {
  const plan = docFontPlan(doc)
  const results = await Promise.all(plan.map((f) => ensureFont(f.family, f.weights)))
  return plan.filter((_, i) => !results[i]).map((f) => f.family)
}

/** Per-family readiness for the UI ("is this project's type actually loaded?"). */
export async function fontReadiness(doc: Pick<StudioDoc, 'clips'>): Promise<Array<{ family: string; status: FontStatus; kind: FontKind }>> {
  const plan = docFontPlan(doc)
  await Promise.all(plan.map((f) => ensureFont(f.family, f.weights)))
  return plan.map((f) => ({ family: f.family, status: fontStatus(f.family, f.weights), kind: fontKind(f.family) }))
}
