/**
 * Component director — smart auto-insertion of UI components.
 *
 * Answers the four questions a motion designer asks before dropping a widget
 * into an edit, as deterministic code (same doc → same plan, no randomness):
 *
 *   WHEN   — only where the copy makes a claim a component can SHOW: a price,
 *            a number, a call to action, a notification, a search, a rating…
 *            Never on a line that has nothing to demonstrate, never two
 *            components at once, and at most one per ~7 s of edit so the
 *            piece never turns into a widget catalogue.
 *   WHICH  — the cue picks a query + preferred Lab category; the best-ranked
 *            real component wins, and a slug is not reused in one edit.
 *   HOW    — style of the edit (motionDirector.styleFromContent) × role of
 *            the component (a CTA pops and pulses, a toast drops in from the
 *            side, data rises in calmly…) → a MotionSpec, intensity scaled
 *            by the edit style.
 *   WHERE  — opposite half of the frame from the line it illustrates, timed
 *            to land just after the words (so the claim is read first, then
 *            proven), held for reading time but inside the line's window.
 *
 * Output is a list of `addComponent` edit ops with a human reason each: the
 * same op the agent uses, so there is ONE recorder path and the whole plan
 * is previewed and accepted as ONE undo step.
 */
import type { StudioClip, StudioDoc, StudioTextClip } from '../../types/project'
import { COMPONENTS, findComponent, rankComponents, type ComponentEntry } from './components'
import { docDuration } from './doc'
import type { StudioEditOp } from './editOps'
import { wordsToTimeline } from './autoCaptions'
import { styleFromContent, STYLE_INTENSITY, type DirectionStyle, type MotionSpec } from './motionDirector'

export type ComponentCue =
  | 'price' | 'stat' | 'cta' | 'notify' | 'search' | 'progress' | 'toggle' | 'rating'
  | 'chart' | 'steps' | 'chat' | 'schedule' | 'checkout' | 'features'

type CueRule = { cue: ComponentCue; test: RegExp; query: string; category: ComponentEntry['category'][]; role: Role; why: string }
type Role = 'cta' | 'data' | 'feedback' | 'control' | 'card'

/** Ordered: the first matching cue wins for a line (most specific first). */
const RULES: CueRule[] = [
  { cue: 'checkout', test: /\b(checkout|check out|cart|pay(ment)?s?|upi|card details)\b/i, query: 'checkout payment card', category: ['cards', 'inputs'], role: 'card', why: 'the line talks about paying — show the checkout' },
  { cue: 'price', test: /(?:[$€£₹]\s?\d|\b\d+\s?(?:rs|inr|usd)\b|\bper (?:month|year|user)\b|\/mo\b|\bpricing\b|\bplans?\b)/i, query: 'pricing plan card', category: ['cards', 'data'], role: 'card', why: 'a price is mentioned — a pricing card makes it concrete' },
  { cue: 'rating', test: /\b(\d(?:\.\d)?\s?stars?|rated|ratings?|reviews?|5\/5|4\.\d\/5)\b/i, query: 'rating stars', category: ['feedback', 'data', 'inputs'], role: 'data', why: 'a rating claim — show the stars filling' },
  { cue: 'chart', test: /\b(revenue|growth|grew|grow|trend|chart|graph|analytics|insights?)\b/i, query: 'chart graph bar line', category: ['data'], role: 'data', why: 'growth language — a chart proves it visually' },
  { cue: 'stat', test: /(\b\d[\d,.]*\s?(?:%|x|k|m|\+)(?=\s|$|[^\w])|\b\d{2,}[\d,]*\s+(?:users|customers|downloads|teams|orders|hours|minutes)\b)/i, query: 'counter number odometer ticker', category: ['data', 'text'], role: 'data', why: 'a number is claimed — count up to it' },
  { cue: 'progress', test: /\b(upload(?:ing)?|loading|processing|in seconds|instantly|sync(?:ing)?|progress)\b/i, query: 'progress loader bar', category: ['feedback'], role: 'feedback', why: 'speed/processing claim — a progress bar shows it happen' },
  { cue: 'notify', test: /\b(notif(?:y|ication)s?|alerts?|reminders?|never miss|get notified|ping)\b/i, query: 'toast notification alert', category: ['feedback'], role: 'feedback', why: 'notifications mentioned — slide a toast in' },
  { cue: 'chat', test: /\b(chat|message|messaging|dm|reply|support team|whatsapp)\b/i, query: 'chat message bubble', category: ['cards', 'feedback', 'objects'], role: 'card', why: 'conversation — show a chat bubble' },
  { cue: 'schedule', test: /\b(book(?:ing)?|schedule|calendar|appointment|reserve|slot)\b/i, query: 'calendar date picker', category: ['inputs', 'data'], role: 'control', why: 'booking — show a date being picked' },
  { cue: 'search', test: /\b(search|find|discover|look up|browse)\b/i, query: 'search input bar', category: ['inputs', 'navigation'], role: 'control', why: 'search/find — type into a search bar' },
  { cue: 'toggle', test: /\b(dark mode|toggle|switch (?:on|off)|turn (?:on|off)|enable|one tap|one click)\b/i, query: 'toggle switch', category: ['inputs', 'buttons'], role: 'control', why: 'an on/off action — flip a switch' },
  { cue: 'steps', test: /\b(steps?|how it works|in \d+ (?:easy )?steps|first,|then,|finally)\b/i, query: 'stepper steps progress', category: ['navigation', 'feedback'], role: 'card', why: 'a process — a stepper walks through it' },
  { cue: 'features', test: /\b(features?|everything you need|all[- ]in[- ]one|tabs?)\b/i, query: 'tabs segmented feature', category: ['navigation', 'cards'], role: 'card', why: 'feature list — tabs flick through them' },
  { cue: 'cta', test: /\b(sign ?up|subscribe|buy now|shop now|order now|get started|start (?:free|now|today)|try (?:it )?(?:free|now)|download|join|book a demo|learn more|link in bio)\b/i, query: 'button cta shiny', category: ['buttons'], role: 'cta', why: 'call to action — a real button gets pressed' },
]

/** Role × edit style → how the component moves. */
function motionFor(role: Role, style: DirectionStyle, fromLeft: boolean): MotionSpec {
  const intensity = Math.round(STYLE_INTENSITY[style] * (role === 'cta' ? 1.1 : 0.9) * 100) / 100
  if (style === 'minimal') return { entrance: 'fade-in', exit: 'fade-out', intensity }
  switch (role) {
    case 'cta':
      return { entrance: style === 'cinematic' ? 'blur-focus' : 'scale-pop', emphasis: style === 'bold-social' ? 'heartbeat' : 'pulse', exit: 'pop-out', intensity }
    case 'feedback':
      return { entrance: fromLeft ? 'slide-in-left' : 'slide-in-right', exit: fromLeft ? 'slide-out-left' : 'slide-out-right', intensity }
    case 'data':
      return { entrance: style === 'bold-social' ? 'scale-pop' : 'rise-in', exit: 'fade-out', intensity }
    case 'control':
      return { entrance: style === 'cinematic' ? 'blur-focus' : 'zoom-in', exit: 'zoom-out', intensity }
    default:
      return { entrance: style === 'bold-social' ? 'drop-in' : 'rise-in', emphasis: style === 'bold-social' ? 'float' : 'none', exit: 'sink-out', intensity }
  }
}

export type ComponentMoment = {
  cue: ComponentCue
  lineId: string
  line: string
  slug: string
  name: string
  startSec: number
  durationSec: number
  x: number
  y: number
  interact: boolean
  motion: MotionSpec
  reason: string
}

export type DirectorOptions = { maxComponents?: number; secondsPerComponent?: number }

const overlaps = (a0: number, a1: number, b0: number, b1: number, pad = 0) => a0 < b1 + pad && b0 < a1 + pad

/** The best real component for a cue, preferring its categories, skipping used slugs. */
export function componentForCue(rule: Pick<CueRule, 'query' | 'category'>, used: Set<string>): ComponentEntry | null {
  const ranked = rankComponents(rule.query, 40).filter((e) => !used.has(e.slug))
  return ranked.find((e) => rule.category.includes(e.category)) ?? ranked[0] ?? COMPONENTS.find((e) => rule.category.includes(e.category) && !used.has(e.slug)) ?? null
}

export function cueOf(text: string): CueRule | null {
  return RULES.find((r) => r.test.test(text)) ?? null
}

/** Decide where components belong in this edit. Pure and deterministic. */
export function directComponents(doc: StudioDoc, opts: DirectorOptions = {}): ComponentMoment[] {
  const total = docDuration(doc)
  if (total <= 0) return []
  const budget = Math.max(0, Math.min(opts.maxComponents ?? 6, Math.floor(total / (opts.secondsPerComponent ?? 7)) || 1))
  const style = styleFromContent(doc.clips)
  const existing = doc.clips.filter((c) => c.kind === 'overlay' && (c as { component?: unknown }).component) as StudioClip[]
  const busy: Array<[number, number]> = existing.map((c) => [c.startSec, c.startSec + c.durationSec])
  const used = new Set(existing.map((c) => (c as { component?: { slug: string } }).component?.slug ?? ''))
  const lines = (doc.clips.filter((c) => c.kind === 'text') as StudioTextClip[])
    .filter((t) => t.text.trim().length >= 3 && t.durationSec >= 1.2)
    .sort((a, b) => a.startSec - b.startSec || a.id.localeCompare(b.id))
  // Spoken words (timeline seconds) from any transcribed clip: a component
  // lands ON the word that makes the claim, not just somewhere in the line.
  const spoken = doc.clips.flatMap((c) => ((c.kind === 'video' || c.kind === 'audio') && c.words?.length && !c.hidden ? wordsToTimeline(c.words, c) : []))
  const out: ComponentMoment[] = []
  const seenCues = new Map<ComponentCue, number>()
  for (const line of lines) {
    if (out.length >= budget) break
    const rule = cueOf(line.text)
    if (!rule) continue
    // The same idea twice (two CTAs) earns a second component only much later.
    const lastSame = seenCues.get(rule.cue)
    if (lastSame !== undefined && line.startSec - lastSame < 15) continue
    // Land after the words start (read the claim, then see it proven).
    const lead = Math.min(0.6, line.durationSec * 0.2)
    // Single word first ("₹499"), then word pairs for multi-word cues ("sign up").
    const inLine = (w: { start: number }) => w.start >= line.startSec - 1 && w.start <= line.startSec + line.durationSec
    const cueWord = spoken.find((w) => inLine(w) && rule.test.test(w.word)) ?? spoken.find((w, i) => inLine(w) && rule.test.test(`${w.word} ${spoken[i + 1]?.word ?? ''}`))
    const startSec = Math.round((cueWord ? Math.max(0, cueWord.start) : line.startSec + lead) * 100) / 100
    const durationSec = Math.round(Math.max(2, Math.min(6, line.durationSec - lead + 0.8, total - startSec)) * 100) / 100
    if (durationSec < 1.5) continue
    if (busy.some(([a, b]) => overlaps(startSec, startSec + durationSec, a, b, 0.75))) continue
    const entry = componentForCue(rule, used)
    if (!entry) continue
    const textY = typeof line.y === 'number' ? line.y : 0.5
    const y = textY <= 0.5 ? 0.68 : 0.32
    const fromLeft = out.length % 2 === 1
    out.push({
      cue: rule.cue,
      lineId: line.id,
      line: line.text,
      slug: entry.slug,
      name: entry.name,
      startSec,
      durationSec,
      x: 0.5,
      y,
      interact: rule.role === 'cta' || rule.role === 'control',
      motion: motionFor(rule.role, style, fromLeft),
      reason: `“${line.text.slice(0, 48)}${line.text.length > 48 ? '…' : ''}” — ${rule.why}. ${entry.name}, ${style} motion, ${y > 0.5 ? 'below' : 'above'} the line${cueWord ? `, landing on the spoken word “${cueWord.word}”` : ''}.`,
    })
    used.add(entry.slug)
    busy.push([startSec, startSec + durationSec])
    seenCues.set(rule.cue, line.startSec)
  }
  return out
}

/** Moments → the agent's own edit ops (one recorder path, one undo step). */
export function componentOps(moments: ComponentMoment[]): StudioEditOp[] {
  return moments
    .filter((m) => findComponent(m.slug))
    .map((m) => ({ type: 'addComponent', slug: m.slug, startSec: m.startSec, durationSec: m.durationSec, x: m.x, y: m.y, interact: m.interact, motion: m.motion }) as StudioEditOp)
}
