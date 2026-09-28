/**
 * Film styles — the eight kinds of motion film, as something the agent can choose.
 *
 * The catalogue is adapted from the motion-launch-videos skill family by
 * Marouane Gazouzi (https://github.com/Kimeur/motion-launch-videos), MIT
 * licensed. What makes that family work is not the styles themselves but the
 * discipline around them: every style carries an explicit "use it for" AND an
 * explicit "not for". A router with only positive descriptions will cheerfully
 * pick a particle swarm for a data story, because nothing told it not to.
 *
 * So each style here owns both lists, and `pickFilmStyle` reads the second one
 * as hard evidence against. When nothing scores, it says so and asks rather
 * than guessing — which is the same rule the rest of Cupric follows.
 */

export type FilmStyleId =
  | 'kinetic-type'
  | 'shapes'
  | 'ui-demo'
  | 'charts'
  | 'particles'
  | 'cartoon'
  | 'pixel'
  | 'dimensional'

export type FilmStyle = {
  id: FilmStyleId
  label: string
  /** One line the user reads on the card. */
  blurb: string
  /** Seconds — the range this style actually works in. */
  durationSec: [number, number]
  /** Phrases in a brief that point AT this style. */
  useFor: string[]
  /** Phrases that rule it out. Checked before `useFor`. */
  notFor: string[]
  /** What Cupric needs from you before it can build one. */
  needs: string[]
  /** The Studio pieces this style is assembled from — all of which exist. */
  builtFrom: string[]
}

export const FILM_STYLES: readonly FilmStyle[] = [
  {
    id: 'kinetic-type',
    label: 'Kinetic type',
    blurb: 'Big animated words on a bold colour. The launch bumper everyone recognises.',
    durationSec: [6, 20],
    useFor: ['launch', 'bumper', 'sting', 'announcement', 'tagline', 'slogan', 'quote', 'manifesto', 'teaser', 'promo'],
    notFor: ['screen recording', 'talking head', 'walkthrough', 'tutorial', 'interview', 'footage'],
    needs: ['The words themselves — 3 to 6 short beats', 'Two colours', 'A format (16:9, 9:16 or 1:1)'],
    builtFrom: ['text clips with anim: kinetic', 'highlight runs and chips', 'spring keyframes'],
  },
  {
    id: 'shapes',
    label: 'Flat shapes',
    blurb: 'Circles, bars and icons that pop, draw on and morph. The explainer look.',
    durationSec: [6, 20],
    useFor: ['explainer', 'feature', 'how it works', 'icon', 'logo reveal', 'steps', 'process', 'benefit'],
    notFor: ['character', 'mascot', 'photoreal', 'real data', 'screen recording'],
    needs: ['The 3 to 5 points to make', 'A shape or icon per point'],
    builtFrom: ['shape clips', 'draw-on keyframes', 'sticker and overlay clips'],
  },
  {
    id: 'ui-demo',
    label: 'Product UI demo',
    blurb: 'A device shows your real screens while a pointer taps, scrolls and types.',
    durationSec: [8, 15],
    useFor: ['app', 'demo', 'product tour', 'feature', 'onboarding', 'dashboard', 'saas', 'walkthrough', 'changelog'],
    notFor: ['screen recording', 'talking head', 'abstract', 'mascot'],
    needs: ['Screenshots of the real screens', 'The one path through the product to show', 'A caption per step (4 words max)'],
    builtFrom: ['browser-mockup kit', 'cursor-zoom kit with the cursor pack', 'callout text clips'],
  },
  {
    id: 'charts',
    label: 'Data story',
    blurb: 'A number counts up, bars grow, a line draws on — every figure sourced.',
    durationSec: [6, 20],
    useFor: ['numbers', 'stat', 'metric', 'growth', 'kpi', 'milestone', 'year in review', 'results', 'report', 'ranking'],
    notFor: ['mascot', 'pixel art', 'particle', 'no data', 'made up'],
    needs: ['The real figures', 'Where each figure came from — shown on screen'],
    builtFrom: ['stat-card kit', 'rating-bars kit', 'count-up text'],
  },
  {
    id: 'particles',
    label: 'Particles',
    blurb: 'Thousands of points drift, swarm into your name, burst and reform.',
    durationSec: [8, 15],
    useFor: ['logo reveal', 'ambient', 'atmospheric', 'dust', 'swarm', 'abstract', 'ident', 'loop'],
    notFor: ['real data', 'screen recording', 'walkthrough', 'character', 'readable paragraph'],
    needs: ['The word or logo the swarm forms', 'A background colour'],
    builtFrom: ['loader clips', 'overlay clips', 'loop-exact noise drift'],
  },
  {
    id: 'cartoon',
    label: 'Cartoon mascot',
    blurb: 'An original character walks on, reacts and holds up your name.',
    durationSec: [6, 20],
    useFor: ['mascot', 'character', 'playful', 'friendly', 'sticker', 'greeting', 'fun'],
    notFor: ['real person', 'existing character', 'trademarked', 'data', 'screen recording', 'corporate'],
    needs: ['What the character should do', 'Your product name for the sign'],
    builtFrom: ['shape clips', 'squash-and-stretch spring keyframes'],
  },
  {
    id: 'pixel',
    label: 'Pixel art',
    blurb: 'Low-res, at most 16 colours, a blinking PRESS START. Retro and game launches.',
    durationSec: [6, 20],
    useFor: ['game', 'retro', '8-bit', 'arcade', 'pixel', 'indie', 'nostalgia'],
    notFor: ['corporate', 'photoreal', 'real data', 'screen recording', 'smooth gradient'],
    needs: ['The title screen text', 'A palette of at most 16 colours'],
    builtFrom: ['shape clips on a whole-pixel grid', 'hold eases'],
  },
  {
    id: 'dimensional',
    label: 'Dimensional type',
    blurb: 'Extruded type and shapes that turn and catch the light.',
    durationSec: [6, 20],
    useFor: ['logo sting', 'wordmark', 'badge', 'premium', 'identity', 'title', 'ident'],
    notFor: ['real data', 'screen recording', 'character', 'walkthrough', 'paragraph'],
    needs: ['The word or logo', 'An accent colour'],
    builtFrom: ['block-row-3d kit', 'tiltX / turnY keyframes', 'spring keyframes'],
  },
] as const

export const filmStyle = (id: FilmStyleId): FilmStyle =>
  FILM_STYLES.find((s) => s.id === id) ?? FILM_STYLES[0]

export type StylePick = {
  style: FilmStyle
  /** 0–1. Below `MIN_CONFIDENCE` the caller must ask rather than assume. */
  confidence: number
  /** The words in the brief that decided it — quoted back, never invented. */
  because: string[]
}

/** Under this we ask a question instead of picking for you. */
export const MIN_CONFIDENCE = 0.34

/**
 * Score every style against a brief and rank them.
 *
 * `notFor` is checked first and is disqualifying, not a penalty: a brief that
 * says "screen recording" must never come back as kinetic type, however many
 * other words matched.
 */
export function rankFilmStyles(brief: string): StylePick[] {
  const text = ` ${brief.toLowerCase().replace(/[^a-z0-9]+/g, ' ')} `
  const hits = (phrases: string[]) => phrases.filter((p) => text.includes(` ${p} `) || text.includes(` ${p}s `))

  return FILM_STYLES.map((style) => {
    const against = hits(style.notFor)
    if (against.length) return { style, confidence: 0, because: [] }
    const forHits = hits(style.useFor)
    // Two matching words is a real signal; one is a hint.
    const confidence = Math.min(1, forHits.length / 3)
    return { style, confidence, because: forHits }
  }).sort((a, b) => b.confidence - a.confidence)
}

/**
 * The single best style for a brief, or null when the brief does not say.
 *
 * Returning null is the point: it is what makes the caller ask a question
 * instead of producing a particle swarm for a quarterly report.
 */
export function pickFilmStyle(brief: string): StylePick | null {
  const ranked = rankFilmStyles(brief)
  const best = ranked[0]
  if (!best || best.confidence < MIN_CONFIDENCE) return null
  // A tie is not a decision either.
  if (ranked[1] && ranked[1].confidence >= best.confidence) return null
  return best
}

/** The one question to ask when the brief does not name a style. */
export function styleQuestion(brief: string): { question: string; options: Array<{ id: FilmStyleId; label: string; hint: string }> } {
  const ranked = rankFilmStyles(brief).filter((r) => r.confidence > 0)
  const shortlist = (ranked.length >= 2 ? ranked.slice(0, 3) : rankFilmStyles('').slice(0, 3)).map((r) => r.style)
  const pool = shortlist.length ? shortlist : FILM_STYLES.slice(0, 3)
  return {
    question: 'What kind of film is this?',
    options: pool.map((s) => ({ id: s.id, label: s.label, hint: s.blurb })),
  }
}

/**
 * What is still missing before this style can be built.
 *
 * Returned as questions, not as defaults — a style's `needs` are the things
 * Cupric refuses to invent on your behalf.
 */
export function missingFor(style: FilmStyle, supplied: Record<string, boolean>): string[] {
  return style.needs.filter((need) => !supplied[need])
}
