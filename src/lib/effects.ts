/**
 * Local effects library for video generation and Arena prompts.
 * Deterministic, no remote assets — safe for window.__seek(t) HTML pieces.
 */

export type EffectKind = 'background' | 'transition' | 'caption' | 'motion' | 'texture'

export type Effect = {
  id: string
  name: string
  kind: EffectKind
  description: string
  /** CSS / SVG snippet or motion cue for Arena prompts */
  snippet: string
  /** Prompt fragment agents can paste */
  promptCue: string
  tags: string[]
}

export const EFFECTS: Effect[] = [
  {
    id: 'bg-soft-grid',
    name: 'Soft Grid',
    kind: 'background',
    description: 'Subtle dark grid with soft radial vignette — marketing / stage only.',
    snippet: `background:
  radial-gradient(ellipse 80% 60% at 50% 40%, rgb(200 245 66 / 0.06), transparent 70%),
  linear-gradient(rgb(255 255 255 / 0.03) 1px, transparent 1px),
  linear-gradient(90deg, rgb(255 255 255 / 0.03) 1px, transparent 1px);
background-size: 100% 100%, 48px 48px, 48px 48px;
background-color: #0B0B10;`,
    promptCue: 'Dark near-black base (#0B0B10) with a soft 48px grid at 3% white and a faint lime radial glow at center.',
    tags: ['grid', 'dark', 'stage'],
  },
  {
    id: 'bg-dot-field',
    name: 'Dot Field',
    kind: 'background',
    description: 'Sparse dot field — good for kinetic type and quote cards.',
    snippet: `background-color: #0B0B10;
background-image: radial-gradient(rgb(255 255 255 / 0.08) 1px, transparent 1px);
background-size: 24px 24px;`,
    promptCue: 'Near-black field with sparse 1px dots every 24px at 8% white opacity.',
    tags: ['dots', 'minimal'],
  },
  {
    id: 'bg-lime-haze',
    name: 'Lime Haze',
    kind: 'background',
    description: 'Two soft lime orbs, pointer-events none — brand energy without noise.',
    snippet: `background:
  radial-gradient(circle at 20% 30%, rgb(200 245 66 / 0.12), transparent 45%),
  radial-gradient(circle at 80% 70%, rgb(79 182 232 / 0.08), transparent 40%),
  #0B0B10;`,
    promptCue: 'Two soft orbs: lime at 20% 30% (12% opacity) and blue at 80% 70% (8% opacity) over #0B0B10.',
    tags: ['gradient', 'brand'],
  },
  {
    id: 'bg-noise-paper',
    name: 'Noise Paper',
    kind: 'texture',
    description: 'SVG noise grain overlay for paper-cut and editorial looks.',
    snippet: `/* overlay */
opacity: 0.04;
mix-blend-mode: overlay;
background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E");`,
    promptCue: 'Very light film-grain overlay (4% opacity, overlay blend) using SVG turbulence noise.',
    tags: ['noise', 'film'],
  },
  {
    id: 'tr-mask-wipe',
    name: 'Mask Wipe L→R',
    kind: 'transition',
    description: 'Hard mask wipe left to right driven by t.',
    snippet: `// in __seek(t):
const p = clamp((t - from) / (to - from), 0, 1);
el.style.clipPath = \`inset(0 \${(1 - p) * 100}% 0 0)\`;`,
    promptCue: 'Scene transition: clip-path mask wipe left-to-right as a pure function of t between scene from/to.',
    tags: ['wipe', 'mask'],
  },
  {
    id: 'tr-scale-overshoot',
    name: 'Scale Overshoot',
    kind: 'motion',
    description: 'Spring-like scale 0.92 → 1.04 → 1.0 for logo stings.',
    snippet: `// spring-ish via piecewise ease
function overshoot(p) {
  if (p < 0.6) return 0.92 + (1.04 - 0.92) * (p / 0.6);
  return 1.04 + (1 - 1.04) * ((p - 0.6) / 0.4);
}`,
    promptCue: 'Logo enters with scale overshoot: 0.92 → 1.04 → 1.0, no CSS animation — pure function of t.',
    tags: ['spring', 'logo'],
  },
  {
    id: 'cap-hormozi',
    name: 'Hormozi Caption',
    kind: 'caption',
    description: 'Big bold captions, one lime highlight word, safe margins.',
    snippet: `font: 800 64px/1.1 Inter, system-ui, sans-serif;
color: #F4F1EA;
text-transform: uppercase;
letter-spacing: -0.02em;
/* highlight word */ color: #C8F542;`,
    promptCue: 'Hormozi-style captions: 64px bold uppercase, warm white, one lime accent word, 80px safe margins.',
    tags: ['caption', 'social'],
  },
  {
    id: 'cap-minimal',
    name: 'Minimal Chip',
    kind: 'caption',
    description: 'Quiet lower-third chip.',
    snippet: `font: 500 18px/1.3 Inter, system-ui, sans-serif;
color: #F4F1EA;
background: rgb(21 21 27 / 0.85);
padding: 8px 14px;
border-radius: 8px;
border: 1px solid rgb(255 255 255 / 0.08);`,
    promptCue: 'Minimal lower-third: 18px medium, panel glass background, 8px radius, hairline border.',
    tags: ['caption', 'quiet'],
  },
  {
    id: 'mo-word-reveal',
    name: 'Word-by-Word Reveal',
    kind: 'motion',
    description: 'Kinetic type at ~9 words/s driven by t.',
    snippet: `const words = copy.split(' ');
const visible = Math.floor(p * words.length);
// render words.slice(0, visible)`,
    promptCue: 'Word-by-word kinetic reveal at ~9 words per second; visibility is floor(progress * wordCount).',
    tags: ['type', 'kinetic'],
  },
  {
    id: 'mo-counter-tick',
    name: 'Tabular Counter',
    kind: 'motion',
    description: 'CTA number ticks with tabular-nums.',
    snippet: `el.style.fontVariantNumeric = 'tabular-nums';
el.textContent = Math.floor(from + (to - from) * p).toLocaleString();`,
    promptCue: 'Counter ticks with font-variant-numeric: tabular-nums; value is pure lerp of t.',
    tags: ['stats', 'cta'],
  },
]

export function effectsByKind(kind: EffectKind): Effect[] {
  return EFFECTS.filter((e) => e.kind === kind)
}

export function effectById(id: string): Effect | undefined {
  return EFFECTS.find((e) => e.id === id)
}

/** Build a compact prompt appendix from selected effect ids */
export function effectsPromptAppendix(ids: string[]): string {
  const picked = ids.map(effectById).filter(Boolean) as Effect[]
  if (!picked.length) return ''
  return (
    '\n\nEFFECT CUES (apply deterministically in __seek):\n' +
    picked.map((e) => `- ${e.name}: ${e.promptCue}`).join('\n')
  )
}
