/**
 * Stage / marketing gradients only.
 * App chrome stays flat surface tokens (DESIGN.md).
 * Inspired by common Tailwind/CSS background patterns (ibelick-style).
 */

export type GradientPreset = {
  id: string
  name: string
  /** Tailwind-friendly class string for previews */
  className: string
  /** Raw CSS for Arena HTML */
  css: string
  use: 'stage' | 'thumbnail' | 'marketing'
}

export const GRADIENT_PRESETS: GradientPreset[] = [
  {
    id: 'lime-void',
    name: 'Lime Void',
    className: 'bg-[radial-gradient(ellipse_80%_60%_at_50%_40%,rgba(200,245,66,0.14),transparent_70%),#0B0B10]',
    css: 'background: radial-gradient(ellipse 80% 60% at 50% 40%, rgba(200,245,66,0.14), transparent 70%), #0B0B10;',
    use: 'stage',
  },
  {
    id: 'grid-haze',
    name: 'Grid Haze',
    className:
      'bg-[#0B0B10] [background-image:radial-gradient(ellipse_70%_50%_at_50%_30%,rgba(200,245,66,0.08),transparent),linear-gradient(rgba(255,255,255,0.03)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.03)_1px,transparent_1px)] [background-size:100%_100%,48px_48px,48px_48px]',
    css: `background-color:#0B0B10;background-image:radial-gradient(ellipse 70% 50% at 50% 30%,rgba(200,245,66,0.08),transparent),linear-gradient(rgba(255,255,255,0.03) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,0.03) 1px,transparent 1px);background-size:100% 100%,48px 48px,48px 48px;`,
    use: 'stage',
  },
  {
    id: 'blue-orbit',
    name: 'Blue Orbit',
    className: 'bg-[radial-gradient(circle_at_80%_20%,rgba(79,182,232,0.16),transparent_45%),radial-gradient(circle_at_20%_80%,rgba(200,245,66,0.08),transparent_40%),#0B0B10]',
    css: 'background: radial-gradient(circle at 80% 20%, rgba(79,182,232,0.16), transparent 45%), radial-gradient(circle at 20% 80%, rgba(200,245,66,0.08), transparent 40%), #0B0B10;',
    use: 'thumbnail',
  },
  {
    id: 'warm-paper',
    name: 'Warm Paper',
    className: 'bg-[linear-gradient(160deg,#1a1410_0%,#0f0c0a_50%,#0B0B10_100%)]',
    css: 'background: linear-gradient(160deg, #1a1410 0%, #0f0c0a 50%, #0B0B10 100%);',
    use: 'thumbnail',
  },
  {
    id: 'dot-field',
    name: 'Dot Field',
    className: 'bg-[#0B0B10] [background-image:radial-gradient(rgba(255,255,255,0.08)_1px,transparent_1px)] [background-size:24px_24px]',
    css: 'background-color:#0B0B10;background-image:radial-gradient(rgba(255,255,255,0.08) 1px,transparent 1px);background-size:24px 24px;',
    use: 'stage',
  },
]

export function gradientById(id: string): GradientPreset | undefined {
  return GRADIENT_PRESETS.find((g) => g.id === id)
}
