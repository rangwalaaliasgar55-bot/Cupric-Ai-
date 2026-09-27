/**
 * Video fonts — the bundled families (all SIL OFL, self-hosted via Fontsource,
 * so preview and export never touch the network) with what each is best at
 * and how to customise it. Single source of truth for the inspector, the
 * agent (editOps) and the rich-text renderer.
 */
export type VideoFont = {
  family: string
  label: string
  role: 'caption' | 'headline' | 'display' | 'emphasis' | 'body' | 'mono'
  bestFor: string
  customize: string
  /** Has a real italic cut (for *emphasis* runs). */
  italic?: boolean
  weights: [number, number]
}

export const VIDEO_FONTS: VideoFont[] = [
  { family: 'Geist Variable', label: 'Geist', role: 'headline', bestFor: 'SaaS/product headlines, clean UI captions', customize: 'Weight 650–800, tracking −2%, pair with Instrument Serif italic for emphasis words.', weights: [100, 900] },
  { family: 'Inter Variable', label: 'Inter', role: 'caption', bestFor: 'Subtitles and small UI text that must read at a glance', customize: 'Weight 600–800 for captions, 500 for body; add a 2–3px dark stroke on busy footage.', weights: [100, 900] },
  { family: 'Montserrat Variable', label: 'Montserrat', role: 'caption', bestFor: 'Talking-head captions (the CapCut / creator look)', customize: 'Weight 800–900, sentence case, highlight 1–2 key words with a colour box.', italic: true, weights: [100, 900] },
  { family: 'Poppins', label: 'Poppins', role: 'caption', bestFor: 'Friendly, rounded social captions', customize: 'Weights 500 / 700 / 800 are bundled. Use 800 for hooks, 500 for secondary lines.', weights: [500, 800] },
  { family: 'Outfit Variable', label: 'Outfit', role: 'headline', bestFor: 'Modern geometric titles, fitness/lifestyle brands', customize: 'Weight 700+, tight line-height 1.0 for stacked hooks.', weights: [100, 900] },
  { family: 'Manrope Variable', label: 'Manrope', role: 'body', bestFor: 'Editorial explainers, lower thirds', customize: 'Weight 500–700; generous letter-spacing (+2%) in small caps labels.', weights: [200, 800] },
  { family: 'DM Sans Variable', label: 'DM Sans', role: 'body', bestFor: 'Compact social text and data labels', customize: 'Weight 500–700; tabular numbers for stats.', weights: [100, 1000] },
  { family: 'Space Grotesk Variable', label: 'Space Grotesk', role: 'headline', bestFor: 'Tech, AI and product launches', customize: 'Weight 600–700; pair with JetBrains Mono for code/data accents.', weights: [300, 700] },
  { family: 'Bebas Neue', label: 'Bebas Neue', role: 'display', bestFor: 'Tall all-caps impact titles, sports, trailers', customize: 'Single weight — scale it big (12–18% of frame height), tracking +2%, always uppercase.', weights: [400, 400] },
  { family: 'Anton', label: 'Anton', role: 'display', bestFor: 'Bold YouTube thumbnails-style punch words', customize: 'Single heavy weight; use for 1–3 words, add stroke or shadow over footage.', weights: [400, 400] },
  { family: 'Instrument Serif', label: 'Instrument Serif', role: 'emphasis', bestFor: 'Elegant italic emphasis words (“a *woman* over 30”), luxury, editorial', customize: 'Use the italic for single emphasised words inside a sans line, tinted with the accent colour, ~1.1× size.', italic: true, weights: [400, 400] },
  { family: 'Playfair Display Variable', label: 'Playfair Display', role: 'emphasis', bestFor: 'Classic serif titles, quotes, testimonials', customize: 'Italic for pull-quotes; weight 500–700 for titles.', italic: true, weights: [400, 900] },
  { family: 'Plus Jakarta Sans Variable', label: 'Plus Jakarta Sans', role: 'headline', bestFor: 'Premium SaaS and fintech titles', customize: 'Weight 700–800, tracking −2%; pairs with Fraunces italic for emphasis.', weights: [200, 800] },
  { family: 'Bricolage Grotesque Variable', label: 'Bricolage Grotesque', role: 'headline', bestFor: 'Characterful creator/brand titles with personality', customize: 'Weight 700–800; big and tight (line-height 0.95).', weights: [200, 800] },
  { family: 'Syne Variable', label: 'Syne', role: 'display', bestFor: 'Art-direction, fashion, agency reels', customize: 'Weight 700–800 gets wide and dramatic — keep to 1–4 words.', weights: [400, 800] },
  { family: 'Unbounded Variable', label: 'Unbounded', role: 'display', bestFor: 'Web3, gaming, futuristic hype titles', customize: 'Weight 600–900, all caps optional; give it room — it is wide.', weights: [200, 900] },
  { family: 'Archivo Black', label: 'Archivo Black', role: 'display', bestFor: 'Heavy sale / promo punch lines', customize: 'Single black weight; box behind it or a thick stroke on footage.', weights: [400, 400] },
  { family: 'Fraunces Variable', label: 'Fraunces', role: 'emphasis', bestFor: 'Warm soft-serif emphasis, food, lifestyle, books', customize: 'Italic 400–600 for emphasis words; upright 700 for cosy titles.', italic: true, weights: [100, 900] },
  { family: 'DM Serif Display', label: 'DM Serif Display', role: 'emphasis', bestFor: 'High-contrast magazine headlines and quotes', customize: 'Use large (10%+ of frame); italic for pull-quotes.', italic: true, weights: [400, 400] },
  { family: 'JetBrains Mono Variable', label: 'JetBrains Mono', role: 'mono', bestFor: 'Code, timecodes, numbers that tick', customize: 'Weight 500–700; use for counters so digits do not jitter.', weights: [100, 800] },
]

export const VIDEO_FONT_FAMILIES = new Set(VIDEO_FONTS.map((f) => f.family))
export const EMPHASIS_FONT = 'Instrument Serif'

export function fontInfo(family: string | undefined): VideoFont | undefined {
  return VIDEO_FONTS.find((f) => f.family === family)
}

/** Pick a caption font by the feel of the words (used by the agent). */
export function suggestFont(text: string): string {
  const s = text.toLowerCase()
  if (/\b(ai|api|software|data|tech|code|launch|app|saas)\b/.test(s)) return 'Space Grotesk Variable'
  if (/\b(luxury|elegant|wedding|fashion|beauty|story|love)\b/.test(s)) return 'Playfair Display Variable'
  if (/\b(sport|game|trailer|epic|win|beast|record)\b/.test(s)) return 'Bebas Neue'
  if (/\b(fitness|gym|workout|body|health|coach)\b/.test(s)) return 'Outfit Variable'
  return 'Montserrat Variable'
}
