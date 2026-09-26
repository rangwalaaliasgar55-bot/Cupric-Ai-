/**
 * Stage / marketing gradients.
 *
 * Single source of truth is `src/lib/studio/backgrounds.ts` — those presets are
 * the ones the Studio can actually paint into an exported frame. This module
 * only reshapes them for the Library and for Arena HTML prompts, so the two
 * lists can never drift apart again.
 */

import { STUDIO_BACKGROUNDS, backgroundById } from './studio/backgrounds'

export type GradientPreset = {
  id: string
  name: string
  /** Raw CSS — what the Library copies and what Arena HTML embeds. */
  css: string
  use: 'stage' | 'thumbnail' | 'marketing'
}

export const GRADIENT_PRESETS: GradientPreset[] = STUDIO_BACKGROUNDS.map((bg) => ({
  id: bg.id,
  name: bg.name,
  css: bg.css,
  use: bg.group === 'solid' ? 'marketing' : bg.group === 'pattern' ? 'stage' : 'thumbnail',
}))

export function gradientById(id: string): GradientPreset | undefined {
  const found = GRADIENT_PRESETS.find((g) => g.id === id)
  return found ?? (STUDIO_BACKGROUNDS.some((b) => b.id === id) ? GRADIENT_PRESETS[0] : undefined)
}

export { backgroundById }
