/**
 * What a resource *is*, read from its name, category and description.
 *
 * Most catalogue entries (Great UI, Spell, Bencho, React Bits, Skiper, PanelUI)
 * are references to React components whose source Cupric does not ship. They
 * still have a clear visual identity — "Pixel Page Transition", "Tilt Card",
 * "Count Up", "Aurora" — so Apply rebuilds that identity with native, editable
 * Studio clips instead of refusing. This file is the shared vocabulary: one
 * archetype per family, and the look each family gets on the canvas.
 */
import type { StudioTextAnim, StudioTransition } from '../../types/project'
import type { DirectionStyle } from './motionDirector'

export type Archetype =
  | 'transition'
  | 'text'
  | 'counter'
  | 'loader'
  | 'chart'
  | 'background'
  | 'button'
  | 'menu'
  | 'social'
  | 'media'
  | 'card'
  | 'icon'
  | 'generic'

type Rule = { archetype: Archetype; test: RegExp }

/**
 * Ordered: the first match wins. Specific families come before broad ones —
 * "Pixel Swipe Text" is a text effect, not a transition; "Chart Card" is a
 * chart, not a card.
 */
const RULES: Rule[] = [
  { archetype: 'text', test: /\b(text|type|typing|typewriter|words?|letters?|headline|quote|scrambl\w*|shimmer|shiny|highlight\w*|signature|glitch|decrypt\w*|split line|stagger\w*|fuzzy|rotating|falling|ascii|lettering|heading|title|caption|subtitle)\b/i },
  { archetype: 'transition', test: /\b(transition|page transition|wipe|curtain|blinds|swipe theme|theme provider|dissolve|crossfade|morph)\b/i },
  { archetype: 'counter', test: /\b(count\s?up|counter|odometer|number|ticker|stats?|metrics?|percent\w*|kpi|score)\b/i },
  { archetype: 'loader', test: /\b(loader|loading|spinner|progress|skeleton|pulse)\b/i },
  { archetype: 'chart', test: /\b(chart|graph|bars?|sparkline|analytics|dashboard|funnel)\b/i },
  { archetype: 'background', test: /\b(background|gradient|aurora|light rays|rays|beams?|grid|noise|particles?|orbs?|glow|spotlight|mesh|galaxy|silk|plasma|squares|dots|iridescen\w*|threads|lightning|hyperspeed|balatro|waves?|liquid chrome|dither|prism|ripple|starfield|lamp|vortex|smoke|fog|shader)\b/i },
  { archetype: 'button', test: /\b(button|cta|link|badge|pill|chip|toggle|switch|checkbox|copy|like|star button|follow|tag)\b/i },
  { archetype: 'menu', test: /\b(menu|dock|nav\w*|tabs?|dropdown|select|accordion|shortcuts?|keyboard|breadcrumbs?|pagination|stepper|sidebar|command|toolbar)\b/i },
  { archetype: 'social', test: /\b(tweet|twitter|instagram|facebook|linkedin|github|spotify|avatars?|team|profile|vinyl|testimonial|review|comment)\b/i },
  { archetype: 'media', test: /\b(image|images|mockup|macbook|mobile|phone|device|video|gallery|carousel|logos|album|book|qr|photo|screenshot|marquee|lens|reveal)\b/i },
  { archetype: 'card', test: /\b(card|modal|dialog|panel|tooltip|toast|notification|popover|input|form|checklist|pricing|table|list|section|timeline|feature|hero|onboarding|login|signup|stack)\b/i },
]

export function classifyResource(item: { name: string; kind?: string; category?: string; description?: string }): Archetype {
  if (item.kind === 'icon') return 'icon'
  // Name first: it is the most specific signal. Category and description
  // only break ties when the name alone says nothing.
  for (const source of [item.name, `${item.category ?? ''}`, `${item.description ?? ''}`]) {
    if (!source) continue
    const hit = RULES.find((rule) => rule.test.test(source))
    if (hit) return hit.archetype
  }
  if (item.category && /background/i.test(item.category)) return 'background'
  if (item.category && /text/i.test(item.category)) return 'text'
  return 'generic'
}

export type ResourceLook = {
  /** Stage painter id from backgrounds.ts. */
  backgroundId: string
  /** Glass preset id from glass.ts for panels, pills and lenses. */
  glassPreset: string
  /** Per-word text animation that never moves the block (keyframes do that). */
  textAnim: StudioTextAnim
  style: DirectionStyle
}

export const LOOKS: Record<Archetype, ResourceLook> = {
  transition: { backgroundId: 'violet-dusk', glassPreset: 'liquid', textAnim: 'word-reveal', style: 'cinematic' },
  text: { backgroundId: 'lime-void', glassPreset: 'frost', textAnim: 'word-reveal', style: 'editorial' },
  counter: { backgroundId: 'grid-haze', glassPreset: 'plaque', textAnim: 'typewriter', style: 'bold-social' },
  loader: { backgroundId: 'dot-field', glassPreset: 'frost', textAnim: 'typewriter', style: 'minimal' },
  chart: { backgroundId: 'grid-haze', glassPreset: 'plaque', textAnim: 'word-reveal', style: 'editorial' },
  background: { backgroundId: 'aurora', glassPreset: 'frost', textAnim: 'shimmer', style: 'cinematic' },
  button: { backgroundId: 'spotlight', glassPreset: 'liquid', textAnim: 'shimmer', style: 'bold-social' },
  menu: { backgroundId: 'glass-stage', glassPreset: 'frost', textAnim: 'word-reveal', style: 'minimal' },
  social: { backgroundId: 'mesh-lagoon', glassPreset: 'portfolio', textAnim: 'word-reveal', style: 'bold-social' },
  media: { backgroundId: 'blue-orbit', glassPreset: 'hero', textAnim: 'word-reveal', style: 'cinematic' },
  card: { backgroundId: 'glass-stage', glassPreset: 'portfolio', textAnim: 'word-reveal', style: 'editorial' },
  icon: { backgroundId: 'lime-void', glassPreset: 'lens', textAnim: 'shimmer', style: 'bold-social' },
  generic: { backgroundId: 'grid-haze', glassPreset: 'portfolio', textAnim: 'word-reveal', style: 'editorial' },
}

/** The stage painter a background-family name most resembles. */
export function backgroundFor(name: string): string {
  const n = name.toLowerCase()
  if (/aurora|northern/.test(n)) return 'aurora'
  if (/grid|squares|lines/.test(n)) return 'grid-haze'
  if (/dot|particle|star|galaxy|hyperspeed/.test(n)) return 'dot-field'
  if (/spot|lamp|rays|beam|light/.test(n)) return 'spotlight'
  if (/mesh|gradient|iridescen|prism|silk/.test(n)) return 'mesh-lagoon'
  if (/ember|fire|lava|warm/.test(n)) return 'mesh-ember'
  if (/chrome|liquid|metal|ripple|wave/.test(n)) return 'liquid-chrome'
  if (/noise|dither|grain|smoke|fog/.test(n)) return 'noise-veil'
  if (/orb|orbit|vortex|plasma/.test(n)) return 'blue-orbit'
  if (/paper|cream|light mode/.test(n)) return 'warm-paper'
  if (/glass/.test(n)) return 'glass-stage'
  return 'violet-dusk'
}

/** The native transition a transition-family name most resembles. */
export function transitionFor(name: string): StudioTransition {
  const n = name.toLowerCase()
  if (/circular|iris|circle|radial/.test(n)) return 'iris'
  if (/blur|cross/.test(n)) return 'blur'
  if (/wipe|sweep|curtain|blinds|swipe|color/.test(n)) return 'wipe-left'
  if (/pixel|dissolve|sine|wave|liquid|morph/.test(n)) return 'liquid-dissolve'
  if (/glass/.test(n)) return 'glass-wipe'
  if (/cascade|stagger|push|slide|interlock/.test(n)) return 'push-up'
  if (/zoom|scale/.test(n)) return 'zoom-in'
  if (/lens/.test(n)) return 'lens-sweep'
  return 'fade'
}

/** The per-word animation a text-family name most resembles. */
export function textAnimFor(name: string): StudioTextAnim {
  const n = name.toLowerCase()
  if (/type|typing|scrambl|terminal|install|random|decrypt|ascii|command/.test(n)) return 'typewriter'
  if (/shimmer|shiny|gradient|highlight|glow|special/.test(n)) return 'shimmer'
  if (/wave|liquid|wobble|jelly/.test(n)) return 'liquid-wave'
  if (/glass/.test(n)) return 'glass-rise'
  return 'word-reveal'
}

/** Sample copy per family, written like real product copy — never lorem. */
export const SAMPLE_COPY: Record<Archetype, { title: string; body: string; cta: string }> = {
  transition: { title: 'Before', body: 'After', cta: 'See the difference' },
  text: { title: 'Make every word land', body: 'Motion that reads like a voice', cta: 'Start writing' },
  counter: { title: '2,480+', body: 'teams shipped faster this month', cta: 'Join them' },
  loader: { title: 'Rendering your cut…', body: 'Almost there', cta: 'Done' },
  chart: { title: '+38% this quarter', body: 'Growth you can see at a glance', cta: 'See the report' },
  background: { title: 'Set the mood', body: 'A stage that moves with you', cta: 'Make it yours' },
  button: { title: 'Get started', body: 'Free for your first project', cta: 'Get started' },
  menu: { title: 'Home   Work   About   Contact', body: 'Everything one tap away', cta: 'Explore' },
  social: { title: '@yourbrand', body: 'Just shipped the update everyone asked for.', cta: 'Follow for more' },
  media: { title: 'Drop your media here', body: 'A frame built for your product', cta: 'Watch the demo' },
  card: { title: 'Everything in one place', body: 'Plan, edit and ship without switching tabs', cta: 'Try it free' },
  icon: { title: 'Built in', body: 'Works with the tools you already use', cta: 'Connect' },
  generic: { title: 'Designed to move', body: 'Every layer is editable in Studio', cta: 'Make it yours' },
}

/** Placeholder lines a template ships with, which the project brief should replace. */
export const GENERIC_COPY = /^(replace with your content|edit motion, timing and style|customi[sz]e in studio|customi[sz]e every property|editable animation state|make it yours|your (headline|product)|agent-ready native workflow|scroll-driven movement|your story starts here)$/i
