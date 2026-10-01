/**
 * Font catalogue beyond the bundle + automatic text-look suggestions.
 *
 * Fontshare: every family below was verified on fontshare.com as "Closed
 * Source" (ITF Free Font License). That licence forbids an app from offering
 * the fonts to its users, so NewBrand ships only these names/roles: the user
 * downloads a family free from Fontshare and drops the zip into NewBrand
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
    { name: 'Round & warm', head: ['Supreme', 'Poppins'], emph: ['Instrument Serif'], anim: 'kinetic', why: 'Rounded and upbeat.' },
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
  const recipes = [...RECIPES[mood], ...RECIPES[mood === 'friendly' ? 'hype' : 'friendly'].slice(0, 1)]
  const looks: TextLook[] = []
  recipes.forEach((r, i) => {
    const pick = (list: string[], fallbacks: string[]) => list.find((f) => opts.available(f)) ?? fallbacks.find((f) => opts.available(f)) ?? fallbacks[fallbacks.length - 1]
    const head = pick(r.head, ['Geist Variable', 'Inter Variable'])
    const emph = pick(r.emph, ['Instrument Serif', 'Playfair Display Variable', head])
    const colorways: Array<[string, string, string, string]> = [
      ['#FFFFFF', between[i % between.length] ?? '#D9B8FF', base[i % base.length], base[(i + 1) % base.length]],
      [mix('#FFFFFF', base[i % base.length], 0.12), base[(i + 1) % base.length], between[(i + 2) % between.length] ?? base[0], base[(i + 2) % base.length]],
    ]
    colorways.forEach(([color, emphasisColor, boxColor, accentColor], k) => {
      looks.push({
        id: `${mood}-${i}-${k}`,
        name: `${r.name}${k ? ' · alt colour' : ''}`,
        why: r.why,
        patch: { fontFamily: head, weight: /Serif|Zodiak|Sentient|Author|Fraunces|Playfair|Boska/.test(head) ? 600 : 800, color, emphasisFont: emph, emphasisColor, boxColor, accentColor, anim: r.anim, ...(r.glow ? { textGlow: r.glow } : {}) },
      })
    })
    const wanted = r.head[0]
    const fs = fontshareFont(wanted)
    if (opts.includeMissing && fs && !opts.available(wanted)) {
      looks.push({ id: `${mood}-${i}-fs`, name: `${r.name} with ${wanted}`, why: `${r.why} Best with ${wanted} — free on Fontshare.`, patch: { ...looks[looks.length - 2].patch, fontFamily: wanted }, needs: { family: wanted, url: fontshareUrl(fs.slug) } })
    }
  })
  return looks.slice(0, 9)
}

/* ─────────────── applying a look ─────────────── */

/**
 * Fonts with a real italic cut. Emphasis markup (*word*) is painted italic, and
 * a synthetic slant of a font that has none is what makes a suggested look
 * look wrong on screen. When the ideal emphasis face has no italic, the look
 * falls back to the accent colour and a heavier weight instead.
 */
const ITALIC_FAMILIES = new Set([
  'instrument serif', 'playfair display', 'playfair display variable', 'fraunces', 'fraunces variable',
  'dm serif display', 'zodiak', 'sentient', 'boska', 'author', 'bespoke serif', 'gambetta',
  'montserrat', 'montserrat variable', 'satoshi', 'general sans', 'switzer', 'supreme', 'ranade',
  'inter', 'inter variable', 'geist', 'geist variable', 'poppins', 'dm sans', 'dm sans variable',
  'manrope', 'manrope variable', 'outfit', 'outfit variable', 'plus jakarta sans', 'plus jakarta sans variable',
  'bricolage grotesque', 'bricolage grotesque variable', 'space grotesk', 'space grotesk variable',
  'syne', 'syne variable', 'unbounded', 'unbounded variable', 'noto sans devanagari',
])

export function hasItalic(family: string): boolean {
  return ITALIC_FAMILIES.has(family.trim().toLowerCase())
}

/** The bundle's closest stand-in for a family the user has not added yet. */
const STAND_IN: Record<string, string[]> = {
  satoshi: ['Geist Variable', 'Inter Variable', 'Plus Jakarta Sans Variable'],
  'clash display': ['Bricolage Grotesque Variable', 'Outfit Variable', 'Archivo Black'],
  'clash grotesk': ['Space Grotesk Variable', 'Geist Variable'],
  'general sans': ['Inter Variable', 'Manrope Variable'],
  'cabinet grotesk': ['Bricolage Grotesque Variable', 'Montserrat Variable'],
  switzer: ['Inter Variable', 'DM Sans Variable'],
  supreme: ['Poppins', 'DM Sans Variable'],
  chillax: ['Poppins', 'Outfit Variable'],
  ranade: ['Manrope Variable', 'DM Sans Variable'],
  panchang: ['Unbounded Variable', 'Archivo Black'],
  excon: ['JetBrains Mono Variable', 'Bebas Neue'],
  stardom: ['Syne Variable', 'Playfair Display Variable'],
  tanker: ['Anton', 'Archivo Black'],
  zodiak: ['Playfair Display Variable', 'DM Serif Display'],
  sentient: ['Fraunces Variable', 'Instrument Serif'],
  boska: ['Playfair Display Variable', 'DM Serif Display'],
  author: ['DM Serif Display', 'Fraunces Variable'],
  'bespoke serif': ['Fraunces Variable', 'Playfair Display Variable'],
  gambetta: ['Fraunces Variable', 'Playfair Display Variable'],
  telma: ['Poppins', 'Outfit Variable'],
  kihim: ['Syne Variable', 'Unbounded Variable'],
}

const nearest = (family: string, available: (f: string) => boolean): string | null => {
  const key = family.trim().toLowerCase()
  const chain = STAND_IN[key] ?? []
  return chain.find(available) ?? null
}

export type AppliedLook = {
  /** What to write onto the clip. Always uses fonts that are usable now. */
  patch: TextLook['patch'] & { emphasisItalic: boolean }
  /** True when the ideal font was swapped for the closest one that is ready. */
  degraded: boolean
  /** One line for the user, or null when nothing needed explaining. */
  note: string | null
  /** Font the look wanted for the headline, when it is not the one applied. */
  wanted: string | null
  /** Link to get the wanted font (Fontshare) — only when it is a real family. */
  downloadUrl: string | null
}

/**
 * Turn a suggestion into a patch that will *visibly* work right now.
 *
 * A suggestion whose ideal font is missing used to be a dead end ("needs X —
 * download it first"), which reads as "the suggestions are broken". Instead the
 * closest ready family is applied, the swap is stated in `note`, and the
 * Fontshare link to the real thing is carried along — so one click changes the
 * design, and the upgrade path is one more click.
 */
export function applyLook(look: TextLook, opts: { available: (family: string) => boolean }): AppliedLook {
  const wantedHead = look.patch.fontFamily
  const wantedEmph = look.patch.emphasisFont
  const head = opts.available(wantedHead) ? wantedHead : nearest(wantedHead, opts.available) ?? fallbackHead(opts.available)
  const emphWantedAvailable = opts.available(wantedEmph)
  const emph = emphWantedAvailable ? wantedEmph : nearest(wantedEmph, opts.available) ?? (hasItalic(head) ? head : 'Instrument Serif')
  const italic = hasItalic(emph)
  const swapped = head !== wantedHead || emph !== wantedEmph
  const fontshare = look.needs ?? (!opts.available(wantedHead) && fontshareFont(wantedHead) ? { family: wantedHead, url: fontshareUrl(fontshareFont(wantedHead)!.slug) } : null)
  const parts: string[] = []
  if (head !== wantedHead) parts.push(`${wantedHead} isn’t on this machine yet, so ${head} is standing in`)
  if (emph !== wantedEmph) parts.push(`emphasis uses ${emph}`)
  if (!italic && emph === wantedEmph) parts.push(`${emph} has no true italic, so the word is coloured and weighted instead`)
  return {
    patch: {
      ...look.patch,
      fontFamily: head,
      emphasisFont: emph,
      weight: /Serif|Zodiak|Sentient|Author|Fraunces|Playfair|Boska|Instrument/.test(head) ? 600 : look.patch.weight,
      emphasisItalic: italic,
    },
    degraded: swapped,
    note: parts.length ? `${parts.join('. ')}.` : null,
    wanted: swapped ? wantedHead : null,
    downloadUrl: swapped && fontshare ? fontshare.url : null,
  }
}

function fallbackHead(available: (f: string) => boolean): string {
  return ['Geist Variable', 'Inter Variable', 'Montserrat Variable', 'Poppins', 'DM Sans Variable'].find(available) ?? 'Inter Variable'
}

/**
 * Preview a look without applying it: the fonts a chip should draw with, the
 * stand-in it would use, and whether the ideal family is missing.
 */
export function lookPreview(look: TextLook, opts: { available: (family: string) => boolean }): {
  head: string
  emphasis: string
  /** The ideal headline font is not ready → the chip should say so. */
  swapped: boolean
  /** That ideal font is on Fontshare, so it can be fetched by the user. */
  fontshareUrl: string | null
} {
  const head = opts.available(look.patch.fontFamily) ? look.patch.fontFamily : null
  const emph = opts.available(look.patch.emphasisFont) ? look.patch.emphasisFont : null
  const odd = [look.patch.fontFamily, look.patch.emphasisFont].find((f) => !opts.available(f))
  const fs = odd ? fontshareFont(odd) : null
  const fallback = applyLook(look, opts)
  return { head: head ?? fallback.patch.fontFamily, emphasis: emph ?? fallback.patch.emphasisFont, swapped: fallback.degraded, fontshareUrl: fs ? fontshareUrl(fs.slug) : null }
}

/** Everything the agent may choose from: bundled + user fonts (with roles). */
export function fontChoicesForAgent(userFamilies: string[]): Array<{ family: string; role: string; bestFor: string; source: 'bundled' | 'yours' }> {
  return [
    ...VIDEO_FONTS.map((f) => ({ family: f.family, role: f.role, bestFor: f.bestFor, source: 'bundled' as const })),
    ...userFamilies.map((family) => { const fs = fontshareFont(family); return { family, role: fs?.role ?? 'headline', bestFor: fs?.bestFor ?? 'Font the user added', source: 'yours' as const } }),
  ]
}
