/**
 * Liquid-glass material.
 *
 * One parameter set drives three render paths, the way the public
 * liquid-glass write-ups (agpallav.com/liquid-glass, glass-lens-react,
 * liquefy-ui) describe the technique:
 *
 *  1. DOM / Chromium — `backdrop-filter: blur() saturate()` plus an SVG
 *     `feDisplacementMap` whose map is generated here as a data URL. The map's
 *     red and green channels encode x/y offsets that ramp up inside the bezel,
 *     so the edge *refracts* instead of only blurring.
 *  2. DOM fallback — no backdrop-filter (or reduced transparency): a frosted
 *     tint with the same rim and specular, no displacement.
 *  3. Canvas — `src/lib/studio/glass.ts` reproduces the same look on the
 *     Studio canvas, because backdrop-filter cannot be exported to video.
 *
 * Everything is a pure function of the params, so a clip at time t always
 * renders the same frame.
 */

export type GlassParams = {
  /** Backdrop blur in px at 1000px reference width. */
  blur: number
  /** Displacement strength, 0–1 (how hard the edge bends). */
  strength: number
  /** Per-channel offset (chromatic dispersion), 0–1. */
  chroma: number
  /** How far in from the edge the bend reaches, 0–1 of the half-size. */
  bezel: number
  /** Edge falloff shape. 1 = linear, >1 = snappier rim. */
  curvature: number
  /** Rim highlight opacity, 0–1. */
  edge: number
  /** Inner glow opacity, 0–1. */
  glow: number
  /** Specular sweep angle in degrees. */
  specularAngle: number
  /** Tint applied over the backdrop. */
  tint: string
  /** Saturation multiplier for the backdrop. */
  saturate: number
}

export type GlassPresetId = 'hero' | 'portfolio' | 'plaque' | 'liquid' | 'frost' | 'lens'

export type GlassPreset = {
  id: GlassPresetId
  name: string
  description: string
  params: GlassParams
}

const BASE: GlassParams = {
  blur: 10,
  strength: 0.6,
  chroma: 0.35,
  bezel: 0.35,
  curvature: 1.6,
  edge: 0.7,
  glow: 0.35,
  specularAngle: 130,
  tint: 'rgba(255,255,255,0.06)',
  saturate: 1.5,
}

export const GLASS_PRESETS: GlassPreset[] = [
  {
    id: 'hero',
    name: 'Hero',
    description: 'Crisp and dispersive — the loud one, made for footage behind it.',
    params: { ...BASE, blur: 6, strength: 0.85, chroma: 0.6, edge: 0.9, glow: 0.5 },
  },
  {
    id: 'portfolio',
    name: 'Portfolio',
    description: 'Subtle refraction over stills; reads as a pane, not an effect.',
    params: { ...BASE, blur: 12, strength: 0.45, chroma: 0.22, edge: 0.55, glow: 0.25 },
  },
  {
    id: 'plaque',
    name: 'Plaque',
    description: 'A thick slab of glass — heavy blur, wide bezel, quiet rim.',
    params: { ...BASE, blur: 22, strength: 0.5, chroma: 0.18, bezel: 0.5, curvature: 2.2, edge: 0.4, glow: 0.2 },
  },
  {
    id: 'liquid',
    name: 'Liquid',
    description: 'Maximum surface tension: deep bend, strong chroma, hot rim.',
    params: { ...BASE, blur: 8, strength: 1, chroma: 0.8, bezel: 0.45, curvature: 1.3, edge: 1, glow: 0.6 },
  },
  {
    id: 'frost',
    name: 'Frost',
    description: 'No bend at all — plain frosted panel for text-heavy surfaces.',
    params: { ...BASE, blur: 18, strength: 0, chroma: 0, edge: 0.4, glow: 0.15, saturate: 1.2 },
  },
  {
    id: 'lens',
    name: 'Lens',
    description: 'Small circular magnifier — the draggable one.',
    params: { ...BASE, blur: 2, strength: 1, chroma: 0.7, bezel: 0.6, curvature: 1.1, edge: 0.85, glow: 0.4 },
  },
]

export function glassPreset(id: string): GlassPreset {
  return GLASS_PRESETS.find((p) => p.id === id) ?? GLASS_PRESETS[0]
}

/**
 * Build the displacement map for `feDisplacementMap`.
 *
 * Neutral grey (128,128) means "no offset". Towards each edge the red channel
 * pushes x and the green channel pushes y outward, ramped by `curvature`, which
 * is what makes the border bend the backdrop like a real bezel.
 */
export function displacementMapDataUrl(
  params: Pick<GlassParams, 'bezel' | 'curvature'>,
  width = 256,
  height = 256,
  radiusRatio = 0.28,
): string {
  if (typeof document === 'undefined') return ''
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) return ''

  const image = ctx.createImageData(width, height)
  const data = image.data
  const bezelPx = Math.max(1, Math.min(width, height) * 0.5 * params.bezel)
  const radius = Math.min(width, height) * radiusRatio

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      // Signed distance to a rounded rectangle (negative outside, positive in).
      const cx = Math.abs(x - width / 2) - (width / 2 - radius)
      const cy = Math.abs(y - height / 2) - (height / 2 - radius)
      const qx = Math.max(cx, 0)
      const qy = Math.max(cy, 0)
      const outside = Math.hypot(qx, qy) + Math.min(Math.max(cx, cy), 0) - radius
      const edgeDist = Math.max(0, -outside)

      const t = Math.max(0, 1 - edgeDist / bezelPx)
      const ramp = Math.pow(t, params.curvature)

      // Direction: push away from the nearest edge, towards the centre.
      const vx = x - width / 2
      const vy = y - height / 2
      const length = Math.hypot(vx, vy) || 1
      const nx = vx / length
      const ny = vy / length

      const index = (y * width + x) * 4
      data[index] = Math.round(128 + nx * ramp * 127)
      data[index + 1] = Math.round(128 + ny * ramp * 127)
      data[index + 2] = 128
      data[index + 3] = 255
    }
  }

  ctx.putImageData(image, 0, 0)
  return canvas.toDataURL('image/png')
}

/** Does this engine support the refracting path at all? */
export function supportsBackdropFilter(): boolean {
  if (typeof window === 'undefined' || !window.CSS?.supports) return false
  return window.CSS.supports('backdrop-filter', 'blur(4px)') || window.CSS.supports('-webkit-backdrop-filter', 'blur(4px)')
}

/** CSS for the frosted layer — shared by the DOM component and the Library. */
export function glassBackdropCss(params: GlassParams): string {
  return `backdrop-filter: blur(${params.blur}px) saturate(${params.saturate}); -webkit-backdrop-filter: blur(${params.blur}px) saturate(${params.saturate}); background: ${params.tint};`
}

/** The rim + specular overlay, expressed as a gradient stack. */
export function glassRimCss(params: GlassParams): string {
  const angle = params.specularAngle
  return [
    `background-image: linear-gradient(${angle}deg, rgba(255,255,255,${0.55 * params.edge}) 0%, rgba(255,255,255,0) 28%, rgba(255,255,255,0) 72%, rgba(255,255,255,${0.32 * params.edge}) 100%)`,
    `box-shadow: inset 0 1px 0 rgba(255,255,255,${0.5 * params.edge}), inset 0 -1px 0 rgba(255,255,255,${0.22 * params.edge}), inset 0 0 ${18 * params.glow}px rgba(255,255,255,${0.35 * params.glow})`,
  ].join('; ')
}
