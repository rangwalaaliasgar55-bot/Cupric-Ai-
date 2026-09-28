/**
 * Format starters for the guided-production intake. A starter only fills
 * blank answers — it never overwrites anything the user typed — and its
 * wording is structural (what to make), never a claim about the product.
 */
import type { ProductionIntake } from './types'

export type FormatStarter = { id: string; label: string; hint: string; fill: Partial<ProductionIntake> }

export const FORMAT_STARTERS: FormatStarter[] = [
  { id: 'brand-film', label: 'Kinetic brand film', hint: '40 s · 14 type-led beats · no footage needed (learned from PR #20)',
    fill: { making: 'A 40 second cinematic brand film for [Your brand]', durationSec: 40, aspect: '16:9', platform: 'YouTube, website hero', assets: 'None — type-led film', narration: 'none', referenceStyle: 'kinetic typography, dark backdrop, lime accent' } },
  { id: 'launch-reel', label: 'Product launch reel', hint: '20–30 s vertical, hook → demo → CTA',
    fill: { making: 'A 25 second launch reel for [Your product]', durationSec: 25, aspect: '9:16', platform: 'Instagram Reels, YouTube Shorts', narration: 'captions', referenceStyle: 'fast-cut' } },
  { id: 'explainer', label: 'Explainer', hint: '45–60 s, problem → how it works → proof',
    fill: { making: 'A 60 second explainer of how [Your product] works', durationSec: 60, aspect: '16:9', platform: 'YouTube, LinkedIn', narration: 'voiceover', referenceStyle: 'calm, clear' } },
  { id: 'founder', label: 'Founder story', hint: '30–45 s talking head with captions',
    fill: { making: 'A 40 second founder story: why we started [Your company]', durationSec: 40, aspect: '9:16', platform: 'LinkedIn, Instagram Reels', narration: 'captions', referenceStyle: 'honest, documentary' } },
]

const blank = (v: unknown) => v === null || v === undefined || (typeof v === 'string' && !v.trim())

/** Fill only the blanks. Returns the patch and which fields it touched. */
export function applyStarter(intake: ProductionIntake, id: string): { patch: Partial<ProductionIntake>; filled: string[] } {
  const s = FORMAT_STARTERS.find((x) => x.id === id)
  if (!s) return { patch: {}, filled: [] }
  const patch: Partial<ProductionIntake> = {}
  for (const [k, v] of Object.entries(s.fill) as Array<[keyof ProductionIntake, never]>) if (blank(intake[k])) patch[k] = v
  return { patch, filled: Object.keys(patch) }
}
