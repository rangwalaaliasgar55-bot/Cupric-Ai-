// Metadata for the ObsidianUI-inspired components (see ./LICENSE). Kept apart from
// configs.ts so the lab registry stays metadata-only.
export const OBSIDIAN_ENTRIES = [
  { slug: 'ob-flip-text', component: 'FlipText', name: 'Flip text', category: 'motion', description: 'Every letter flips on its X axis in a sine-staggered wave, then holds long enough to read.', keywords: 'obsidianui kinetic typography 3d flip letters title hook' },
  { slug: 'ob-text-stream', component: 'TextStream', name: 'Text stream', category: 'motion', description: 'A small caps prefix over an endless stream of words that steps one by one, the active word in your accent.', keywords: 'obsidianui rotating words we build hook headline cycle list ticker' },
  { slug: 'ob-click-spark', component: 'ClickSpark', name: 'Click spark', category: 'motion', description: 'Radial spark bursts on a fixed beat, transparent, to lay over a button press or cursor click.', keywords: 'obsidianui click burst sparkle tap effect overlay cursor press' },
  { slug: 'ob-marquee-band', component: 'MarqueeBand', name: 'Marquee band', category: 'motion', description: 'Tilted tape bands of repeating phrases scrolling forever, one crossing the other.', keywords: 'obsidianui marquee ticker tape scrolling banner launch loop' },
] as const
