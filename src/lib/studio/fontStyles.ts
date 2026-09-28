/**
 * Font catalogue beyond the bundle + automatic text-look suggestions.
 *
 * Fontshare: every family below was verified on fontshare.com as "Closed
 * Source" (ITF Free Font License). That licence forbids an app from offering
 * the fonts to its users, so Cupric ships only these names/roles: the user
 * downloads a family free from Fontshare and drops the zip into Cupric
 * (userFonts.ts), after which suggestions and the agent use it like any font.
 */
import { VIDEO_FONTS, type VideoFont } from './videoFonts'

export type CatalogFont = { family: string; slug: string; role: VideoFont['role']; bestFor: string; weights: [number, number]; italic?: boolean }

export const FONTSHARE_FONTS: CatalogFont[] = [
  { family: 'Satoshi', slug: 'satoshi', role: 'headline', bestFor: 'The modern SaaS/creator default — clean geometric titles and captions', weights: [300, 900], italic: true },
  { family: 'Clash Display', slug: 'clash-display', role: 'display', bestFor: 'Hype hooks and launch titles with sharp character', weights: [200, 700] },
  { family: 'General Sans', slug: 'general-sans', role: 'caption', bestFor: 'Neutral, highly legible captions and lower thirds', weights: [200, 700], italic: true },
  { family: 'Cabinet Grotesk', slug: 'cabinet-grotesk', role: 'display', bestFor: 'Bold editorial headlines, agency reels', weights: [100, 900] },
  { family: 'Clash Grotesk', slug: 'clash-grotesk', role: 'headline', bestFor: 'Tech titles that need more warmth than Inter', weights: [200, 700] },
  { family: 'Switzer', slug: 'switzer', role: 'body', bestFor: 'Swiss-style explainers and data labels', weights: [100, 900], italic: true },
  { family: 'Supreme', slug: 'supreme', role: 'caption', bestFor: 'Friendly rounded captions, lifestyle', weights: [100, 800], italic: true },
  { family: 'Chillax', slug: 'chillax', role: 'headline', bestFor: 'Playful, soft brand titles', weights: [200, 700] },
  { family: 'Ranade', slug: 'ranade', role: 'body', bestFor: 'Calm humanist body text and quotes', weights: [100, 700], italic: true },
  { family: 'Panchang', slug: 'panchang', role: 'display', bestFor: 'Extra-wide futuristic titles, gaming, sport', weights: [200, 800] },
  { family: 'Excon', slug: 'excon', role: 'display', bestFor: 'Techy condensed titles and HUD labels', weights: [100, 900] },
  { family: 'Stardom', slug: 'stardom', role: 'display', bestFor: 'Glam fashion and beauty titles', weights: [400, 400] },
  { family: 'Tanker', slug: 'tanker', role: 'display', bestFor: 'Heavy poster punch words', weights: [400, 400] },
  { family: 'Zodiak', slug: 'zodiak', role: 'emphasis', bestFor: 'Luxury serif titles and italic emphasis', weights: [100, 900], italic: true },
  { family: 'Sentient', slug: 'sentient', role: 'emphasis', bestFor: 'Soft editorial serif, storytelling', weights: [200, 700], italic: true },
  { family: 'Boska', slug: 'boska', role: 'emphasis', bestFor: 'High-contrast magazine serif, italic emphasis words', weights: [200, 900], italic: true },
  { family: 'Author', slug: 'author', role: 'emphasis', bestFor: 'Literary quotes and testimonials', weights: [200, 700], italic: true },
  { family: 'Bespoke Serif', slug: 'bespoke-serif', role: 'emphasis', bestFor: 'Premium brand serif, food and hospitality', weights: [300, 800], italic: true },
  { family: 'Gambetta', slug: 'gambetta', role: 'body', bestFor: 'Readable serif body and subtitles for docs', weights: [300, 700], italic: true },
  { family: 'Telma', slug: 'telma', role: 'display', bestFor: 'Quirky rounded display, kids and food', weights: [300, 900] },
  { family: 'Kihim', slug: 'kihim', role: 'display', bestFor: 'Experimental art titles (decorative, use sparingly)', weights: [400, 400] },
]

export const fontshareUrl = (slug: string) => `https://www.fontshare.com/fonts/${slug}`
export const fontshareFont = (family: string) => FONTSHARE_FONTS.find((f) => f.family.toLowerCase() === family.trim().toLowerCase())

/* ─────────────── colour helpers ─────────────── */

const hex = (c: string) => { const m = c.replace('#', ''); const f = m.length === 3 ? m.split('').map((x) => x + x).join('') : m.slice(0, 6); return [0, 2, 4].map((i) => parseInt(f.slice(i, i + 2), 16) || 0) }
const toHex = (rgb: number[]) => '#' + rgb.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('').toUpperCase()
/** Colour between a and b (t = 0 → a). */
export const mix = (a: string, b: string, t = 0.5) => toHex(hex(a).map((v, i) => v + (hex(b)[i] - v) * t))
export const luminance = (c: string) => { const [r, g, b] = hex(c).map((v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4 }); return 0.2126 * r + 0.7152 * g + 0.0722 * b }
export const contrast = (a: string, b: string) => { const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05) }

/** A palette from the brand kit plus in-between tones, every text colour readable on dark footage. */
export function paletteFrom(brand: string[] = []): { base: string[]; between: string[] } {
  const base = (brand.filter((c) => /^#[0-9a-f]{3,6}$/i.test(c)).map((c) => toHex(hex(c))).slice(0, 4))
  const seed = base.length ? base : ['#C8F542', '#A970FF', '#FF6B6B', '#4FB6E8']
  const between: string[] = []
  for (let i = 0; i < seed.length; i++) for (let j = i + 1; j < seed.length; j++) between.push(mix(seed[i], seed[j], 0.5))
  seed.forEach((c) => between.push(mix(c, '#FFFFFF', 0.45))) // soft tints for emphasis words
  const readable = (c: string) => (contrast(c, '#0B0B10') >= 3 ? c : mix(c, '#FFFFFF', 0.5))
  return { base: seed.map(readable), between: [...new Set(between.map(readable))].slice(0, 8) }
}

/* ─────────────── suggestions ─────────────── */

export type Mood = 'tech' | 'luxury' | 'hype' | 'friendly' | 'fitness' | 'education' | 'story'
export function moodOf(text: string): Mood {
  const s = text.toLowerCase()
  if (/\b(ai|api|app|saas|software|code|data|launch|startup|dashboard|feature)\b/.test(s)) return 'tech'
  if (/\b(luxury|elegant|premium|fashion|beauty|wedding|jewel|perfume)\b/.test(s)) return 'luxury'
  if (/\b(sale|off|now|new|drop|win|free|limited|%|!{1,})/.test(s)) return 'hype'
  if (/\b(workout|fitness|gym|body|weight|health|coach|women|men|over \d+)\b/.test(s)) return 'fitness'
  if (/\b(how|why|learn|tip|step|guide|tutorial|mistake)\b/.test(s)) return 'education'
  if (/\b(story|journey|when i|i was|years ago|remember)\b/.test(s)) return 'story'
  return 'friendly'
}

export type TextLook = {
  id: string
  name: string
  why: string
  patch: { fontFamily: string; weight: 400 | 600 | 800; color: string; emphasisFont: string; emphasisColor: string; boxColor: string; accentColor: string; textGlow?: number; anim: 'kinetic' | 'word-reveal' | 'pop' | 'fade-up' }
  /** Needs a font the user has not added yet (Fontshare link shown instead of applying silently). */
  needs?: { family: string; url: string }
}

const RECIPES: Record<Mood, Array<{ name: string; head: string[]; emph: string[]; anim: TextLook['patch']['anim']; glow?: number; why: string }>> = {
  tech: [
    { name: 'Launch clean', head: ['Satoshi', 'Geist Variable', 'Plus Jakarta Sans Variable'], emph: ['Instrument Serif'], anim: 'word-reveal', why: 'Neutral geometric sans with one serif word reads premium and modern.' },
    { name: 'Dev punch', head: ['Clash Grotesk', 'Space Grotesk Variable'], emph: ['JetBrains Mono Variable'], anim: 'kinetic', why: 'Grotesk + mono accent signals “built by engineers”.' },
    { name: 'Future wide', head: ['Panchang', 'Unbounded Variable'], emph: ['Instrument Serif'], anim: 'pop', glow: 0.4, why: 'Wide display type + glow for AI / web3 hype.' },
  ],
  luxury: [
    { name: 'Editorial serif', head: ['Zodiak', 'DM Serif Display', 'Playfair Display Variable'], emph: ['Boska', 'Instrument Serif'], anim: 'fade-up', why: 'High-contrast serif, slow fade — the magazine look.' },
    { name: 'Quiet luxury', head: ['General Sans', 'Manrope Variable'], emph: ['Bespoke Serif', 'Fraunces Variable'], anim: 'word-reveal', why: 'Light sans with a warm serif accent; restraint reads expensive.' },
    { name: 'Glam', head: ['Stardom', 'Syne Variable'], emph: ['Instrument Serif'], anim: 'pop', glow: 0.3, why: 'Fashion display face for beauty and launches.' },
  ],
  hype: [
    { name: 'Poster slam', head: ['Tanker', 'Anton', 'Archivo Black'], emph: ['Instrument Serif'], anim: 'kinetic', why: 'Heavy condensed type slams in word by word.' },
    { name: 'Tall caps', head: ['Clash Display', 'Bebas Neue'], emph: ['Fraunces Variable'], anim: 'pop', glow: 0.35, why: 'Tall display caps + glow for drops and sales.' },
    { name: 'Creator bold', head: ['Cabinet Grotesk', 'Montserrat Variable'], emph: ['Instrument Serif'], anim: 'kinetic', why: 'The talking-head hook: heavy sans, one italic word.' },
  ],
  fitness: [
    { name: 'Coach hook', head: ['Satoshi', 'Montserrat Variable'], emph: ['Instrument Serif'], anim: 'kinetic', glow: 0.45, why: 'Matches the “a *woman* over 30” creator style.' },
    { name: 'Athletic', head: ['Clash Display', 'Outfit Variable'], emph: ['Zodiak', 'Playfair Display Variable'], anim: 'pop', why: 'Confident geometric display with a serif payoff word.' },
    { name: 'Wide sport', head: ['Panchang', 'Bebas Neue'], emph: ['Fraunces Variable'], anim: 'kinetic', why: 'Wide/tall sport titles for stats and PRs.' },
  ],
  education: [
    { name: 'Explainer', head: ['General Sans', 'Inter Variable'], emph: ['Instrument Serif'], anim: 'word-reveal', why: 'Maximum legibility; one emphasised term per line.' },
    { name: 'Friendly teacher', head: ['Supreme', 'Poppins'], emph: ['Fraunces Variable'], anim: 'fade-up', why: 'Rounded forms feel approachable.' },
    { name: 'Swiss notes', head: ['Switzer', 'DM Sans Variable'], emph: ['JetBrains Mono Variable'], anim: 'word-reveal', why: 'Structured grotesk + mono for steps and numbers.' },
  ],
  story: [
    { name: 'Storyteller', head: ['Sentient', 'Fraunces Variable'], emph: ['Instrument Serif'], anim: 'fade-up', why: 'Soft serif carries a narrative voice.' },
    { name: 'Diary', head: ['Author', 'Playfair Display Variable'], emph: ['Instrument Serif'], anim: 'word-reveal', why: 'Literary serif, words appear as spoken.' },
    { name: 'Modern memoir', head: ['Ranade', 'Manrope Variable'], emph: ['Boska', 'Instrument Serif'], anim: 'fade-up', why: 'Humanist sans with an elegant italic.' },
  ],
  friendly: [
    { name: 'Social pop', head: ['Chillax', 'Bricolage Grotesque Variable'], emph: ['Instrument Serif'], anim: 'pop', why: 'Characterful sans with a bounce.' },
    { name: 'Clean caption', head: ['Satoshi', 'Geist Variable'], emph: ['Fraunces Variable'], anim: 'word-reveal', why: 'Neutral captions that suit any footage.' },
    { name: 'Round & warm', head: ['Supreme', 'Poppins'], emph: ['Instrument Serif'], anim: 'kinetic', why: 'Rounded, friendly letterforms with an upbeat bounce — good for lifestyle and community clips.' },
  ],
}

/**
 * Six to nine complete looks for this text: a font pairing, weight, animation
 * and colours from the brand palette plus in-between tones. Fonts the user has
 * not added are either swapped for the bundled equivalent or flagged `needs`.
 */
export function suggestTextLooks(text: string, opts: { brandColors?: string[]; available: (family: string) => boolean; includeMissing?: boolean }): TextLook[] {
  const mood = moodOf(text)
  const { base, between } = paletteFrom(opts.brandColors)
  /**
   * JOB 5 — the six visible cards must be six different looks.
   *
   * The mood's own three recipes come first, then the nearest other moods fill
   * up to six distinct pairings. Colourway variants are emitted *after* all of
   * them (see the ordering below), so the first screenful is never the same
   * three recipes shown twice.
   */
  const NEIGHBOURS: Record<Mood, Mood[]> = {
    tech: ['education', 'hype', 'luxury'], luxury: ['story', 'tech', 'friendly'], hype: ['fitness', 'friendly', 'tech'],
    friendly: ['hype', 'education', 'story'], fitness: ['hype', 'tech', 'friendly'], education: ['tech', 'friendly', 'story'],
    story: ['luxury', 'education', 'friendly'],
  }
  const recipes: typeof RECIPES[Mood] = []
  const takenNames = new Set<string>()
  for (const m of [mood, ...NEIGHBOURS[mood]]) {
    for (const r of RECIPES[m]) {
      if (recipes.length >= 6 || takenNames.has(r.name)) continue
      takenNames.add(r.name)
      recipes.push(r)
    }
  }
  const looks: TextLook[] = []
  const alternates: TextLook[] = []
  recipes.forEach((r, i) => {
    const pick = (list: string[], fallbacks: string[]) => list.find((f) => opts.available(f)) ?? fallbacks.find((f) => opts.available(f)) ?? fallbacks[fallbacks.length - 1]
    const head = pick(r.head, ['Geist Variable', 'Inter Variable'])
    const emph = pick(r.emph, ['Instrument Serif', 'Playfair Display Variable', head])
    const colorways: Array<[string, string, string, string]> = [
      ['#FFFFFF', between[i % between.length] ?? '#D9B8FF', base[i % base.length], base[(i + 1) % base.length]],
      [mix('#FFFFFF', base[i % base.length], 0.12), base[(i + 1) % base.length], between[(i + 2) % between.length] ?? base[0], base[(i + 2) % base.length]],
    ]
    colorways.forEach(([color, emphasisColor, boxColor, accentColor], k) => {
      const look: TextLook = {
        id: `${mood}-${i}-${k}`,
        name: `${r.name}${k ? ' · alt colour' : ''}`,
        why: r.why,
        patch: { fontFamily: head, weight: /Serif|Zodiak|Sentient|Author|Fraunces|Playfair|Boska/.test(head) ? 600 : 800, color, emphasisFont: emph, emphasisColor, boxColor, accentColor, anim: r.anim, ...(r.glow ? { textGlow: r.glow } : {}) },
      }
      // Primary colourways lead; alternates queue up behind all six recipes.
      ;(k === 0 ? looks : alternates).push(look)
    })
    const wanted = r.head[0]
    const fs = fontshareFont(wanted)
    if (opts.includeMissing && fs && !opts.available(wanted)) {
      alternates.push({ id: `${mood}-${i}-fs`, name: `${r.name} with ${wanted}`, why: `${r.why} Best with ${wanted} — free on Fontshare.`, patch: { ...alternates[alternates.length - 1].patch, fontFamily: wanted }, needs: { family: wanted, url: fontshareUrl(fs.slug) } })
    }
  })
  return [...looks, ...alternates].slice(0, 12)
}

/** Everything the agent may choose from: bundled + user fonts (with roles). */
export function fontChoicesForAgent(userFamilies: string[]): Array<{ family: string; role: string; bestFor: string; source: 'bundled' | 'yours' }> {
  return [
    ...VIDEO_FONTS.map((f) => ({ family: f.family, role: f.role, bestFor: f.bestFor, source: 'bundled' as const })),
    ...userFamilies.map((family) => { const fs = fontshareFont(family); return { family, role: fs?.role ?? 'headline', bestFor: fs?.bestFor ?? 'Font the user added', source: 'yours' as const } }),
  ]
}
