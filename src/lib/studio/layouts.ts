/**
 * Layout & motion generators:
 *   2.15 device mockups · 2.16 2.5D product-photo presets · 2.19 collage ·
 *   2.20 testimonial grid · 2.21 before/after · 2.22 logo reveals ·
 *   2.23 asset-first intake (startup / business / product).
 *
 * Every generator is parametric and pure — keyframes and clip geometry, never
 * generated pixels — so preview and export are identical. Nothing here ever
 * writes a testimonial, review or result: those are empty editable
 * placeholders the user fills in.
 */

import type {
  StudioClip,
  StudioDevice,
  StudioDoc,
  StudioGlassClip,
  StudioKeyframe,
  StudioMediaClip,
  StudioTextClip,
} from '../../types/project'
import { defaultGlassClip, defaultTextClip, placeClip } from './doc'
import { applyTextPreset } from './textTools'
import { uid } from '../utils'

export type MediaRef = { mediaId: string; fileName: string; localPath: string | null; kind: 'image' | 'video'; durationSec?: number; posterDataUrl?: string | null }

export function mediaClip(ref: MediaRef, startSec: number, durationSec: number, track: number, extra: Partial<StudioMediaClip> = {}): StudioMediaClip {
  return {
    id: uid(),
    kind: ref.kind,
    track,
    startSec,
    durationSec,
    name: ref.fileName.replace(/\.[^.]+$/, '').slice(0, 28) || 'Media',
    transitionIn: 'none',
    transitionOut: 'none',
    opacity: 1,
    mediaId: ref.mediaId,
    fileName: ref.fileName,
    localPath: ref.localPath,
    trimInSec: 0,
    sourceDurationSec: ref.durationSec ?? 0,
    speed: 1,
    volume: ref.kind === 'video' ? 1 : 0,
    fit: 'cover',
    x: 0.5,
    y: 0.5,
    scale: 1,
    posterDataUrl: ref.posterDataUrl ?? null,
    ...extra,
  }
}

/* ——— 2.15 device mockups ——— */

/**
 * Screen rectangle inside a device frame whose outer box is (x,y,w,h). The
 * renderer draws the body, then clips the content into this rect.
 */
export function deviceGeometry(device: StudioDevice, x: number, y: number, w: number, h: number) {
  if (device === 'phone') {
    // Portrait phone at ~9:19.5, centred in the box.
    const ph = Math.min(h, (w * 19.5) / 9)
    const pw = (ph * 9) / 19.5
    const bx = x + (w - pw) / 2, by = y + (h - ph) / 2
    const bezel = pw * 0.035
    return { body: { x: bx, y: by, w: pw, h: ph, r: pw * 0.14 }, screen: { x: bx + bezel, y: by + bezel, w: pw - bezel * 2, h: ph - bezel * 2, r: pw * 0.11 }, notch: { x: bx + pw * 0.36, y: by + bezel * 1.6, w: pw * 0.28, h: pw * 0.07 } }
  }
  if (device === 'laptop') {
    const lw = Math.min(w, (h / 0.68) * 1)
    const lh = lw * 0.62
    const bx = x + (w - lw) / 2, by = y + (h - lw * 0.68) / 2
    const bezel = lw * 0.025
    return { body: { x: bx + lw * 0.06, y: by, w: lw * 0.88, h: lh, r: lw * 0.02 }, screen: { x: bx + lw * 0.06 + bezel, y: by + bezel, w: lw * 0.88 - bezel * 2, h: lh - bezel * 2.4, r: 2 }, base: { x: bx, y: by + lh, w: lw, h: lw * 0.04, r: lw * 0.02 } }
  }
  if (device === 'browser') {
    const bar = Math.max(18, h * 0.07)
    return { body: { x, y, w, h, r: Math.min(w, h) * 0.03 }, screen: { x, y: y + bar, w, h: h - bar, r: 0 }, bar: { x, y, w, h: bar } }
  }
  return { body: { x, y, w, h, r: 0 }, screen: { x, y, w, h, r: 0 } }
}

/* ——— 2.16 product-photo 2.5D presets & 2.22 logo reveals ——— */

export const PRODUCT_PRESETS = ['subtle', 'push-in', 'orbit', 'hero-reveal'] as const
export type ProductPreset = (typeof PRODUCT_PRESETS)[number]
export const LOGO_REVEALS = ['scale-pop', 'blur-rise', 'spin-settle', 'wipe-on'] as const
export type LogoReveal = (typeof LOGO_REVEALS)[number]

const k = (at: number, v: Omit<StudioKeyframe, 'at' | 'ease'>, ease: StudioKeyframe['ease'] = 'ease-in-out'): StudioKeyframe => ({ at: Math.round(at * 1000) / 1000, ...v, ease })

/**
 * Keyframes for a product photo. Scale/position/rotation only — a 2.5D
 * camera move over a flat image, fully parametric.
 */
export function productPresetKeyframes(preset: ProductPreset, dur: number): StudioKeyframe[] {
  const d = Math.max(0.5, dur)
  switch (preset) {
    case 'subtle':
      return [k(0, { scale: 1.02, x: 0.49 }, 'linear'), k(d, { scale: 1.08, x: 0.51 }, 'linear')]
    case 'push-in':
      return [k(0, { scale: 1 }, 'expo-out'), k(d * 0.85, { scale: 1.22 }, 'linear'), k(d, { scale: 1.24 })]
    case 'orbit':
      return [k(0, { x: 0.46, scale: 1.1, rotation: -2.5 }), k(d / 2, { x: 0.54, scale: 1.14, rotation: 2.5 }), k(d, { x: 0.46, scale: 1.1, rotation: -2.5 })]
    case 'hero-reveal':
      return [k(0, { scale: 1.35, opacity: 0, y: 0.56 }, 'expo-out'), k(Math.min(1.1, d * 0.4), { scale: 1.06, opacity: 1, y: 0.5 }, 'linear'), k(d, { scale: 1.12, opacity: 1, y: 0.5 })]
  }
}

export function logoRevealKeyframes(kind: LogoReveal, dur: number): StudioKeyframe[] {
  const d = Math.max(0.8, dur)
  const land = Math.min(0.9, d * 0.35)
  switch (kind) {
    case 'scale-pop':
      return [k(0, { scale: 0.2, opacity: 0 }, 'back-out'), k(land, { scale: 1, opacity: 1 }, 'linear'), k(d, { scale: 1.04, opacity: 1 })]
    case 'blur-rise':
      return [k(0, { y: 0.58, opacity: 0 }, 'expo-out'), k(land, { y: 0.5, opacity: 1 }, 'linear'), k(d, { y: 0.5, scale: 1.03 })]
    case 'spin-settle':
      return [k(0, { rotation: -180, scale: 0.4, opacity: 0 }, 'elastic-out'), k(land * 1.4, { rotation: 0, scale: 1, opacity: 1 }, 'linear'), k(d, { rotation: 0, scale: 1 })]
    case 'wipe-on':
      return [k(0, { x: 0.42, opacity: 0 }, 'expo-out'), k(land, { x: 0.5, opacity: 1 }, 'linear'), k(d, { x: 0.5 })]
  }
}

/** Apply a product preset to an image/video clip (one patch = one undo step). */
export function withProductPreset(clip: StudioMediaClip, preset: ProductPreset): StudioMediaClip {
  return { ...clip, motionPreset: preset, keyframes: productPresetKeyframes(preset, clip.durationSec), transitionIn: preset === 'hero-reveal' ? 'none' : clip.transitionIn }
}

/* ——— 2.19 collage ——— */

/** Grid cells (normalised) for n photos in a given aspect. */
export function collageCells(n: number, aspect: StudioDoc['aspect']): Array<{ x: number; y: number; w: number; h: number }> {
  const count = Math.max(1, Math.min(9, n))
  const portrait = aspect === '9:16'
  let cols = count <= 1 ? 1 : count <= 4 ? 2 : 3
  if (portrait && count <= 3) cols = 1
  const rows = Math.ceil(count / cols)
  const gap = 0.012
  const cells: Array<{ x: number; y: number; w: number; h: number }> = []
  for (let i = 0; i < count; i += 1) {
    const r = Math.floor(i / cols)
    const inRow = r === rows - 1 ? count - r * cols : cols
    const c = i % cols
    const w = (1 - gap * (inRow + 1)) / inRow
    const h = (1 - gap * (rows + 1)) / rows
    cells.push({ x: gap + c * (w + gap), y: gap + r * (h + gap), w, h })
  }
  return cells
}

/**
 * One media clip per photo, each scaled and matted into its cell and
 * arriving on a staggered beat. Cell geometry becomes a rect mask plus a
 * position/scale — reusing the existing renderer paths.
 */
export function buildCollage(doc: StudioDoc, refs: MediaRef[], startSec: number, durationSec = 4): { doc: StudioDoc; clips: StudioClip[] } {
  if (!refs.length) return { doc, clips: [] }
  const cells = collageCells(refs.length, doc.aspect)
  let working = doc
  const clips: StudioClip[] = []
  refs.slice(0, 9).forEach((ref, i) => {
    const cell = cells[i]
    const stagger = Math.min(0.12 * i, durationSec * 0.3)
    const cx = cell.x + cell.w / 2, cy = cell.y + cell.h / 2
    const scale = Math.max(cell.w, cell.h)
    const base = mediaClip(ref, startSec + stagger, durationSec - stagger, 1 + i, {
      name: `Collage ${i + 1}`,
      x: cx,
      y: cy,
      scale,
      transitionIn: 'fade',
      mask: { shape: 'rect', x: cell.x, y: cell.y, w: cell.w, h: cell.h, featherPct: 0, invert: false, threshold: 0.5, softness: 0.2 },
      keyframes: [k(0, { scale: 0.92 }, 'back-out'), k(0.45, { scale: 1 }, 'linear')],
    })
    const placed = placeClip(working, base)
    working = { ...working, trackCount: placed.trackCount, clips: [...working.clips, placed.clip] }
    clips.push(placed.clip)
  })
  return { doc: working, clips }
}

/* ——— 2.20 testimonial grid ——— */

export const TESTIMONIAL_PLACEHOLDER = 'Add a real customer quote'
export const ATTRIBUTION_PLACEHOLDER = '— Name, role (with permission)'

/**
 * Glass cards with EMPTY, clearly-marked quote/attribution placeholders. The
 * app never writes testimonials. Export lint flags any placeholder left.
 */
export function buildTestimonialGrid(doc: StudioDoc, count: number, startSec: number, durationSec = 5): { doc: StudioDoc; clips: StudioClip[] } {
  const n = Math.max(1, Math.min(4, count))
  const portrait = doc.aspect === '9:16'
  let working = doc
  const clips: StudioClip[] = []
  for (let i = 0; i < n; i += 1) {
    const cols = portrait ? 1 : n > 2 ? 2 : n
    const rows = Math.ceil(n / cols)
    const c = i % cols, r = Math.floor(i / cols)
    const w = (0.86 - 0.04 * (cols - 1)) / cols
    const h = Math.min(0.26, (0.76 - 0.04 * (rows - 1)) / rows)
    const x = 0.07 + c * (w + 0.04) + w / 2
    const y = 0.12 + r * (h + 0.04) + h / 2
    const at = startSec + i * 0.25
    const card: StudioGlassClip = { ...defaultGlassClip(at, 1, 'frost', 'panel'), name: `Testimonial ${i + 1}`, x, y, w, h, motion: 'pop', durationSec: durationSec - i * 0.25 }
    const quote: StudioTextClip = { ...defaultTextClip(at, 2), name: `Quote ${i + 1}`, text: TESTIMONIAL_PLACEHOLDER, x, y: y - h * 0.12, fontSizePct: portrait ? 3 : 3.4, weight: 600, anim: 'fade-up', durationSec: durationSec - i * 0.25 }
    const who: StudioTextClip = { ...defaultTextClip(at + 0.15, 3), name: `Attribution ${i + 1}`, text: ATTRIBUTION_PLACEHOLDER, x, y: y + h * 0.28, fontSizePct: 2.2, weight: 400, color: '#C8F542', anim: 'fade-up', durationSec: durationSec - i * 0.25 - 0.15 }
    for (const clip of [card, quote, who] as StudioClip[]) {
      const placed = placeClip(working, clip)
      working = { ...working, trackCount: placed.trackCount, clips: [...working.clips, placed.clip] }
      clips.push(placed.clip)
    }
  }
  return { doc: working, clips }
}

/** Placeholder text still in the edit — export warns before shipping it. */
export function unfilledPlaceholders(doc: StudioDoc): StudioTextClip[] {
  return doc.clips.filter((c): c is StudioTextClip => c.kind === 'text' && (c.text === TESTIMONIAL_PLACEHOLDER || c.text === ATTRIBUTION_PLACEHOLDER))
}

/* ——— 2.21 before/after ——— */

export function buildBeforeAfter(before: MediaRef, after: MediaRef, startSec: number, track: number, durationSec = 4, mode: 'sweep' | 'static' = 'sweep'): StudioMediaClip {
  return mediaClip(after, startSec, durationSec, track, {
    name: 'Before / after',
    compare: { beforeMediaId: before.mediaId, beforeFileName: before.fileName, mode, position: 0.5 },
  })
}

/** Divider position (0–1 across the frame) at clip progress p. */
export function compareDivider(mode: 'sweep' | 'static', position: number, p: number): number {
  if (mode === 'static') return Math.min(0.98, Math.max(0.02, position))
  // Sweep: hold on "before", wipe across with an ease, settle on a split.
  const q = p < 0.15 ? 0 : p > 0.75 ? 1 : (p - 0.15) / 0.6
  const e = q < 0.5 ? 4 * q * q * q : 1 - Math.pow(-2 * q + 2, 3) / 2
  return 0.98 - e * (0.98 - Math.min(0.9, Math.max(0.1, position)))
}

/* ——— 2.23 asset-first intake ——— */

export type IntakeKind = 'startup' | 'business' | 'product'
export type IntakeAssets = { logo?: MediaRef | null; photos: MediaRef[]; clips: MediaRef[]; name: string; tagline?: string; cta?: string }

/**
 * Build a first cut from the user's own assets. Order per kind:
 *  startup  — logo reveal → problem/tagline → product shots → testimonial placeholders → CTA
 *  business — logo → photos with gentle motion → trust placeholders → CTA
 *  product  — hero-reveal → push-in/orbit shots → before/after (if 2+ photos) → CTA
 * Missing assets get labelled placeholders rather than invented content.
 */
export function buildFromAssets(doc: StudioDoc, kind: IntakeKind, assets: IntakeAssets): { doc: StudioDoc; notes: string[] } {
  const notes: string[] = []
  let working: StudioDoc = { ...doc, clips: [] , trackCount: Math.max(doc.trackCount, 4) }
  let t = 0
  const add = (clip: StudioClip) => {
    const placed = placeClip(working, clip)
    working = { ...working, trackCount: placed.trackCount, clips: [...working.clips, placed.clip] }
  }
  const title = (text: string, start: number, dur: number, preset: string, track = 2) =>
    add({ ...applyTextPreset({ ...defaultTextClip(start, track), durationSec: dur }, preset), text, name: preset })

  // Opening
  if (assets.logo) {
    add({ ...mediaClip(assets.logo, t, 2.4, 1, { fit: 'contain', scale: 0.5, name: 'Logo' }), keyframes: logoRevealKeyframes(kind === 'product' ? 'blur-rise' : 'scale-pop', 2.4) })
    t += 2.4
  } else {
    title(assets.name || 'Your brand', t, 2.2, 'title')
    notes.push('No logo supplied — opened on the brand name. Drop a logo on the title to swap it.')
    t += 2.2
  }
  if (assets.tagline?.trim()) {
    title(assets.tagline.trim(), t, 2.6, kind === 'startup' ? 'kinetic' : 'subtitle')
    t += 2.6
  }

  // Body
  const photos = assets.photos.slice(0, 8)
  const presets: ProductPreset[] = kind === 'product' ? ['hero-reveal', 'push-in', 'orbit', 'subtle'] : ['subtle', 'push-in', 'subtle', 'orbit']
  photos.forEach((ref, i) => {
    add(withProductPreset({ ...mediaClip(ref, t, 2.8, 0), transitionIn: i ? 'fade' : 'none' }, presets[i % presets.length]))
    t += 2.8
  })
  for (const ref of assets.clips.slice(0, 6)) {
    const dur = Math.min(5, Math.max(1.5, ref.durationSec || 4))
    add({ ...mediaClip(ref, t, dur, 0), transitionIn: 'fade' })
    t += dur
  }
  if (kind === 'product' && photos.length >= 2) {
    add(buildBeforeAfter(photos[0], photos[1], t, 0, 3.5))
    notes.push('Added a before/after from your first two photos — swap either in the inspector if they are not a real before/after pair.')
    t += 3.5
  }
  if (!photos.length && !assets.clips.length) notes.push('No photos or clips yet — add some and run this again for a fuller cut.')

  // Trust (never fabricated)
  if (kind !== 'product') {
    const grid = buildTestimonialGrid(working, kind === 'startup' ? 2 : 3, t, 4.5)
    working = grid.doc
    notes.push('Testimonial cards are empty placeholders — paste real quotes you have permission to use, or delete them.')
    t += 4.5
  }

  // Close
  title(assets.cta?.trim() || 'Your call to action', t, 2.6, 'cta')
  if (!assets.cta?.trim()) notes.push('Edit the call-to-action text before exporting.')
  t += 2.6
  return { doc: { ...working, clips: [...working.clips] }, notes }
}
