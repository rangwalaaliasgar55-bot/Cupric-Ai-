/**
 * Resource Finder — search every pack at once from a plain-language
 * description ("numbers going up for our revenue slide", "logos scrolling",
 * "fancy backdrop for the intro"). Pure and deterministic:
 *
 *  1. intent phrases expand the query into the words resources actually use
 *     (counter, marquee, mesh …) and nudge the resource kinds that fit;
 *  2. light stemming + one-typo fuzzy matching, so "testimonals" still hits;
 *  3. every result explains WHY it matched, so the user can trust or refine it.
 */

export type FinderItem = { id: string; kind: string; name: string; description: string; tags?: string[]; data?: Record<string, unknown> }
export type FinderResult = { packId: string; packName: string; item: FinderItem; score: number; why: string[] }

type Intent = { id: string; label: string; re: RegExp; terms: string[]; kinds?: string[] }

/** What people say → the words resources are named with. Order is irrelevant. */
export const INTENTS: Intent[] = [
  { id: 'stats', label: 'numbers / stats', re: /\b(number|numbers|stat|stats|statistic|metric|kpi|growth|revenue|count|counting|going up|increase|percent|%|figures?)\b/, terms: ['counter', 'stat', 'number', 'count', 'ticker', 'chart'], kinds: ['component', 'saas-template'] },
  { id: 'pricing', label: 'pricing', re: /\b(price|pricing|plans?|tiers?|cost|subscription)\b/, terms: ['pricing', 'plan', 'card', 'counter'], kinds: ['component', 'block'] },
  { id: 'logos', label: 'logos / brands', re: /\b(logos?|brands?|partners?|clients?|trusted by|companies|sponsors?)\b/, terms: ['marquee', 'logo', 'brand', 'icon', 'ticker'], kinds: ['component', 'icon', 'provider'] },
  { id: 'social-proof', label: 'testimonials', re: /\b(testimonials?|reviews?|quotes?|customers? (say|said)|feedback|social proof|ratings?)\b/, terms: ['testimonial', 'quote', 'review', 'card', 'stagger', 'marquee'], kinds: ['component', 'saas-template'] },
  { id: 'gallery', label: 'gallery / photos', re: /\b(gallery|photos?|pictures?|images?|portfolio|showcase|screenshots?|carousel|slideshow)\b/, terms: ['gallery', 'scroll', 'image', 'carousel', 'infinite', 'stack', 'parallax'], kinds: ['component', 'saas-template'] },
  { id: 'opener', label: 'intro / hero', re: /\b(intro|opening|opener|start|beginning|hero|title card|first scene|headline)\b/, terms: ['hero', 'mesh', 'gradient', 'particles', 'aurora', 'split', 'title', 'reveal'], kinds: ['background', 'component', 'animation'] },
  { id: 'cta', label: 'call to action', re: /\b(cta|call to action|sign ?up|subscribe|buy|download|get started|button|click|join)\b/, terms: ['magnetic', 'button', 'spotlight', 'cta', 'shine', 'glow'], kinds: ['component'] },
  { id: 'background', label: 'background', re: /\b(backgrounds?|backdrop|behind|wallpaper|texture|ambient|atmosphere)\b/, terms: ['background', 'gradient', 'aurora', 'mesh', 'grid', 'noise', 'particles', 'beam'], kinds: ['background'] },
  { id: 'energetic', label: 'energetic', re: /\b(hype|energetic|energy|punchy|fast|glitch|shake|impact|bold|loud|exciting)\b/, terms: ['glitch', 'shake', 'flash', 'zoom', 'punch', 'pop', 'whip'], kinds: ['effect', 'transition', 'animation'] },
  { id: 'calm', label: 'calm / premium', re: /\b(calm|smooth|elegant|luxury|premium|minimal|clean|soft|subtle|classy)\b/, terms: ['fade', 'blur', 'glass', 'soft', 'smooth', 'drift', 'minimal'], kinds: ['glass', 'transition', 'animation'] },
  { id: 'transition', label: 'transitions', re: /\b(transitions?|between scenes|cut|wipe|swipe|change scene)\b/, terms: ['transition', 'wipe', 'fade', 'slide', 'zoom'], kinds: ['transition'] },
  { id: 'text', label: 'text animation', re: /\b(text|typing|typewriter|words?|letters?|caption|kinetic|lettering|type)\b/, terms: ['text', 'typewriter', 'split', 'reveal', 'word', 'kinetic', 'scramble'], kinds: ['animation', 'component'] },
  { id: 'captions', label: 'captions', re: /\b(captions?|subtitles?|transcript)\b/, terms: ['caption', 'subtitle', 'word', 'karaoke'], kinds: ['animation', 'saas-template'] },
  { id: 'font', label: 'fonts', re: /\b(fonts?|typeface|typography|serif|sans|script|handwriting)\b/, terms: ['font', 'typeface', 'sans', 'serif', 'display'], kinds: ['font'] },
  { id: 'icons', label: 'icons / logos of companies', re: /\b(icons?|glyphs?|pictograms?|company logo|brand icon)\b/, terms: ['icon', 'icons', 'logo', 'simple icons', 'lucide', 'svg'], kinds: ['icon', 'provider', 'source'] },
  { id: 'depth', label: '3D / physics', re: /\b(3d|depth|physics|falling|gravity|bounce|tilt|perspective|dominoes?)\b/, terms: ['3d', 'physics', 'tilt', 'depth', 'perspective', 'bounce'], kinds: ['component', 'effect'] },
  { id: 'charts', label: 'charts / data', re: /\b(charts?|graphs?|data|analytics|dashboard|bar|line chart|pie)\b/, terms: ['chart', 'graph', 'bar', 'line', 'dashboard', 'data'], kinds: ['component', 'saas-template'] },
  { id: 'features', label: 'features', re: /\b(features?|benefits?|how it works|steps|product tour|overview)\b/, terms: ['bento', 'feature', 'grid', 'card', 'steps', 'tabs'], kinds: ['component', 'saas-template'] },
  { id: 'glass', label: 'glass', re: /\b(glass|frosted|blur panel|translucent|glassmorphism)\b/, terms: ['glass', 'frosted', 'blur'], kinds: ['glass'] },
  { id: 'motion-lib', label: 'animation libraries', re: /\b(animation library|motion library|framer|gsap|scroll ?trigger|spring)\b/, terms: ['framer motion', 'gsap', 'motion', 'scrolltrigger', 'spring'], kinds: ['source', 'provider'] },
  { id: 'voice', label: 'voice', re: /\b(voice|speak|say|dictate|voice ?over|narration)\b/, terms: ['voice', 'speech', 'narration'], kinds: ['voice'] },
  { id: 'vertical', label: 'vertical / social', re: /\b(tiktok|reels?|shorts|vertical|instagram|story|stories|9:16)\b/, terms: ['vertical', '9:16', 'social', 'caption', 'story'], kinds: ['saas-template', 'template'] },
  { id: 'loading', label: 'loaders / progress', re: /\b(loading|loader|progress|spinner|waiting)\b/, terms: ['loader', 'progress', 'spinner'], kinds: ['component'] },
]

const STOP = new Set('a an the for of to in on with and or my our your i we want need make create some something like that this it is be me us please video scene slide show shows showing up go going get got out new cool nice good very really thing things stuff kind sort'.split(' '))

/** Very small English stemmer — enough to fold plural/-ing/-ed forms together. */
export function stem(w: string): string {
  if (w.length <= 3) return w
  return w.replace(/(ies)$/, 'y').replace(/(ing|edly|ed|ly|es|s)$/, '').replace(/(.)\1$/, '$1') || w
}

export function tokens(s: string): string[] {
  return s.toLowerCase().replace(/[^a-z0-9%:+#.\- ]+/g, ' ').split(/[\s\-_.]+/).filter((t) => t && !STOP.has(t))
}

/** True when a and b are within one edit (only for words ≥ 5 chars). */
function oneEdit(a: string, b: string): boolean {
  if (a === b) return true
  if (a.length < 5 || b.length < 5 || Math.abs(a.length - b.length) > 1) return false
  let i = 0, j = 0, edits = 0
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue }
    if (++edits > 1) return false
    if (a.length > b.length) i++
    else if (b.length > a.length) j++
    else { i++; j++ }
  }
  return edits + (a.length - i) + (b.length - j) <= 1
}

export type ParsedQuery = { raw: string; words: string[]; intents: Intent[]; expanded: string[]; kinds: Map<string, number>; wantsFonts: boolean }

export function parseQuery(query: string): ParsedQuery {
  const raw = query.trim().toLowerCase()
  const intents = INTENTS.filter((i) => i.re.test(raw))
  const words = [...new Set(tokens(raw).map(stem))]
  const expanded = [...new Set(intents.flatMap((i) => i.terms))].filter((t) => !words.includes(stem(t)))
  const kinds = new Map<string, number>()
  for (const i of intents) for (const k of i.kinds ?? []) kinds.set(k, (kinds.get(k) ?? 0) + 1)
  return { raw, words, intents, expanded, kinds, wantsFonts: intents.some((i) => i.id === 'font') }
}

type Indexed = { name: string[]; tags: string[]; desc: string[]; nameRaw: string; hay: string }
const idxCache = new WeakMap<FinderItem, Indexed>()
function indexOf(item: FinderItem): Indexed {
  let hit = idxCache.get(item)
  if (!hit) {
    const tagText = (item.tags ?? []).join(' ')
    hit = {
      name: tokens(item.name).map(stem),
      tags: tokens(tagText).map(stem),
      desc: tokens(item.description).map(stem),
      nameRaw: item.name.toLowerCase(),
      hay: `${item.name} ${tagText} ${item.description}`.toLowerCase(),
    }
    idxCache.set(item, hit)
  }
  return hit
}

function wordScore(w: string, ix: Indexed, weight: number, why: Set<string>, label: string): number {
  if (w.includes(' ')) return ix.hay.includes(w) ? (why.add(`${label} “${w}”`), 4 * weight) : 0
  if (ix.name.includes(w)) { why.add(`${label} “${w}” in name`); return 5 * weight }
  if (ix.tags.includes(w)) { why.add(`${label} “${w}” tag`); return 3 * weight }
  if (ix.desc.includes(w)) return 1.5 * weight
  if (ix.name.some((n) => oneEdit(n, w))) { why.add(`close to “${w}”`); return 3 * weight }
  if (ix.name.some((n) => n.length >= 4 && w.length >= 4 && (n.startsWith(w) || w.startsWith(n)))) return 2 * weight
  if (ix.desc.some((n) => oneEdit(n, w))) return 1 * weight
  return 0
}

export function scoreItem(q: ParsedQuery, item: FinderItem): { score: number; why: string[] } {
  if (!q.raw) return { score: 0, why: [] }
  const ix = indexOf(item)
  const why = new Set<string>()
  let score = 0
  let direct = 0
  for (const w of q.words) { const s = wordScore(w, ix, 1, why, 'matches'); score += s; if (s > 0) direct++ }
  let intentHits = 0
  for (const t of q.expanded) { const s = wordScore(stem(t), ix, 0.55, why, 'fits'); if (s > 0) intentHits++; score += s }
  if (ix.nameRaw === q.raw) score += 12
  else if (q.raw.length > 3 && ix.nameRaw.includes(q.raw)) score += 6
  if (score <= 0) return { score: 0, why: [] }
  // Kind fit — only rewards items that already matched something.
  const kindVotes = q.kinds.get(item.kind) ?? 0
  if (kindVotes) { score += 2 * kindVotes; why.add(`${item.kind} suits ${q.intents.filter((i) => i.kinds?.includes(item.kind)).map((i) => i.label).join(', ')}`) }
  if (item.kind === 'font' && !q.wantsFonts) score *= 0.25 // 1800+ fonts must not drown everything else
  // Resources that apply straight into Studio beat link-outs at equal relevance.
  if (item.kind === 'provider' || item.kind === 'source') score *= q.kinds.has(item.kind) ? 1 : 0.8
  if (q.words.length > 1 && direct === q.words.length) score *= 1.25
  if (intentHits >= 2) score *= 1.1
  return { score: Math.round(score * 100) / 100, why: [...why].slice(0, 3) }
}

export type FinderPack = { id: string; name: string; items: FinderItem[] }

export function findResources(query: string, packs: FinderPack[], limit = 24): { results: FinderResult[]; understood: string[]; searched: number } {
  const q = parseQuery(query)
  let searched = 0
  const results: FinderResult[] = []
  for (const p of packs) {
    for (const item of p.items) {
      searched++
      const { score, why } = scoreItem(q, item)
      if (score > 0) results.push({ packId: p.id, packName: p.name, item, score, why })
    }
  }
  // Stable ordering: score, then pack, then name — same query, same list.
  results.sort((a, b) => b.score - a.score || a.packId.localeCompare(b.packId) || a.item.name.localeCompare(b.item.name))
  // Diversity: at most 6 per pack in the top list so one big pack can't take over.
  const perPack = new Map<string, number>()
  const top: FinderResult[] = []
  for (const r of results) {
    const n = perPack.get(r.packId) ?? 0
    if (n >= 6) continue
    perPack.set(r.packId, n + 1)
    top.push(r)
    if (top.length >= limit) break
  }
  return { results: top, understood: q.intents.map((i) => i.label), searched }
}

/** One-tap example prompts shown under the finder. */
export const FINDER_EXAMPLES = [
  'numbers going up for our revenue',
  'logos of companies that trust us',
  'fancy background for the intro',
  'customer reviews',
  'button that makes people click',
  'photo gallery that scrolls',
  'calm premium transition',
  'free icons and brand logos',
]
