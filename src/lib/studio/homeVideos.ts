/**
 * Home_X video styles — six parametric template auto-fills built only from
 * native clips (text, shape, cursor, kit). Pure and offline: the same doc +
 * fill always yields the same clips, so the first pass is instant and every
 * frame is reproducible in preview and export.
 *
 * Content rules:
 *  - Headlines/supporting/CTA come from the brief (or neutral defaults that
 *    read as instructions, e.g. "Your headline").
 *  - Stats, prices, ratings and names come ONLY from `fill.stats` etc. When
 *    the user gave none, the card shows a visible placeholder ("—" + "Add your
 *    number") — we never invent numbers, quotes or photos.
 *  - Photo slots use project footage in timeline order; the rest stay visible
 *    "drop media here" slots.
 *  - The plan is applied by the caller as ONE undoable doc patch, placed after
 *    the current end of the edit so it never covers existing work.
 */
import type { StudioAspect, StudioClip, StudioCursorClip, StudioDoc, StudioKeyframe, StudioKitClip, StudioKitMedia, StudioShapeClip, StudioTextClip } from '../../types/project'
import { CORE_TOKENS, VIDEO_TOKENS, mulberry32, normaliseKit } from './homeKit'
import { aspectRatio, docDuration, MAX_TRACKS } from './doc'

export type HomeStyleId = 'saas-capture' | 'kinetic-float' | 'red-pill' | 'launch-stats' | 'mascot-checkout' | 'dark-3d'

export const HOME_STYLES: Array<{ id: HomeStyleId; name: string; durationSec: number; fps: 30 | 60; summary: string }> = [
  { id: 'saas-capture', name: 'SaaS screen-capture', durationSec: 8, fps: 30, summary: 'App close-up → browser wide, cursor click with zoom, text callouts.' },
  { id: 'kinetic-float', name: 'Bold kinetic + floating UI', durationSec: 30, fps: 30, summary: 'Orange stage, huge lowercase headline, drifting UI cards, composer + rating bars.' },
  { id: 'red-pill', name: 'Red-pill explainer', durationSec: 25, fps: 30, summary: 'Off-white stage, words as red pills, checklist with an active red line, badge.' },
  { id: 'launch-stats', name: 'Premium launch / stat cards', durationSec: 21, fps: 30, summary: 'Cream stage, flying photo stack, giant figure, stat cards + landscape card.' },
  { id: 'mascot-checkout', name: 'Mascot + checkout', durationSec: 39, fps: 60, summary: 'Blue stage, your mascot, pastel price cards, currency chips, checkout card.' },
  { id: 'dark-3d', name: 'Dark 3D explainer', durationSec: 26, fps: 60, summary: 'Near-black stage, two-tone headline, perspective row of numbered blocks.' },
]

export type HomeFill = {
  headline?: string
  supporting?: string
  cta?: string
  brand?: string
  url?: string
  /** User-supplied figures: value + label (e.g. {value:'12', label:'Retailers'}). */
  stats?: Array<{ value: string; label: string }>
  /** User-supplied prices for price cards. */
  prices?: Array<{ name: string; price: string; icon?: string }>
  /** User-supplied rating rows. */
  ratings?: Array<{ label: string; value: number }>
  /** Words to render as pills (style 3). */
  pillWords?: string[]
  /** Checklist lines (style 3). */
  checklist?: string[]
}

export type BrollSuggestion = { id: string; label: string; startSec: number; durationSec: number; reason: string }

export type HomeVideoPlan = {
  style: HomeStyleId
  doc: StudioDoc
  clips: StudioClip[]
  changes: string[]
  startSec: number
  durationSec: number
  /** Photo slots left empty (visible placeholders, never blocking). */
  emptySlots: number
  /** Suggested B-roll moments — shown as a queue, each accepted separately. */
  broll: BrollSuggestion[]
}

/* ——— builders ——— */

type Ctx = { start: number; portrait: boolean; ratio: number; nextId: () => string; clips: StudioClip[]; media: StudioKitMedia[]; mediaUsed: number }

const base = (c: Ctx, name: string, track: number, at: number, dur: number) => ({
  id: c.nextId(),
  track,
  startSec: Math.round((c.start + at) * 100) / 100,
  durationSec: Math.round(dur * 100) / 100,
  name,
  transitionIn: 'none' as const,
  transitionOut: 'none' as const,
  opacity: 1,
})

/** Portrait-aware placement: landscape value, portrait value. */
const L = (c: Ctx, land: number, port: number) => (c.portrait ? port : land)

function stage(c: Ctx, at: number, dur: number, color: string, name = 'Stage') {
  const clip: StudioShapeClip = { ...base(c, name, 0, at, dur), kind: 'shape', shape: 'rectangle', x: 0.5, y: 0.5, w: 1.001, aspect: 1 / c.ratio + 0.002, fill: color, stroke: null, strokeWidth: 0, anim: 'none', radius: 0 }
  c.clips.push(clip)
}

function textClip(c: Ctx, track: number, at: number, dur: number, t: string, o: Partial<StudioTextClip> = {}) {
  const clip: StudioTextClip = {
    ...base(c, o.name ?? 'Text', track, at, dur),
    kind: 'text',
    text: t,
    fontSizePct: 8,
    fontFamily: 'Inter Variable',
    color: CORE_TOKENS.text,
    weight: 800,
    align: 'center',
    x: 0.5,
    y: 0.5,
    anim: 'fade-up',
    captionStyle: null,
    highlightWord: null,
    legibility: 'auto',
    ...o,
  } as StudioTextClip
  // Fonts sized to fit: long copy shrinks so a line never overflows ~90% width.
  const maxPct = (90 / Math.max(1, t.length * 0.55)) * (c.portrait ? 0.56 : 1) * c.ratio
  clip.fontSizePct = Math.max(2.4, Math.min(clip.fontSizePct, maxPct))
  c.clips.push(clip)
  return clip
}

function kit(c: Ctx, track: number, at: number, dur: number, k: Partial<StudioKitClip> & Pick<StudioKitClip, 'kit'>) {
  const clip = normaliseKit({ ...base(c, k.name ?? k.kit, track, at, dur), ...k, startSec: Math.round((c.start + at) * 100) / 100, durationSec: dur, track })
  clip.id = c.nextId()
  c.clips.push(clip)
  return clip
}

function takeMedia(c: Ctx, n: number): StudioKitMedia[] {
  const out: StudioKitMedia[] = []
  for (let i = 0; i < n; i++) out.push(c.media[c.mediaUsed++] ?? null)
  return out
}

function kf(at: number, values: Partial<StudioKeyframe>, ease: StudioKeyframe['ease'] = 'ease-out'): StudioKeyframe {
  return { at: Math.round(at * 1000) / 1000, ease, ...values } as StudioKeyframe
}

function cursor(c: Ctx, track: number, at: number, dur: number, from: [number, number], to: [number, number], clickFrac: number): StudioCursorClip {
  const clip: StudioCursorClip = { ...base(c, 'Cursor', track, at, dur), kind: 'cursor', style: 'arrow', x: to[0], y: to[1], fromX: from[0], fromY: from[1], clicks: [clickFrac], action: 'click', size: 1, color: VIDEO_TOKENS.ink, rippleColor: CORE_TOKENS.info }
  c.clips.push(clip)
  return clip
}

const PLACE = { value: '—', label: 'Add your number' }

function style1(c: Ctx, f: HomeFill) {
  // 0–3.5s app close-up, 3.5–8s browser wide (hard cut).
  stage(c, 0, 8, VIDEO_TOKENS.paper)
  const app = kit(c, 1, 0, 3.5, { kit: 'browser-mockup', variant: 'saas', theme: 'light', accent: CORE_TOKENS.info, x: 0.5, y: 0.5, w: L(c, 0.86, 0.94), title: f.headline ?? 'makes your work easier', subtitle: 'Enter message…', eyebrow: 'Model', url: f.brand ?? 'Desktop app', items: ['Video generation', 'Document', 'Website'] })
  // Zoom on click: 1 → 1.12 at the click, EASE_SOFT-like ease-out over ~180 ms.
  app.keyframes = [kf(0, { scale: 1 }), kf(1.9, { scale: 1 }), kf(2.08, { scale: 1.12 }, 'ease-out'), kf(3.5, { scale: 1.12 }, 'hold')]
  kit(c, 3, 0, 3.5, { kit: 'cursor-zoom', x: 0.5, y: L(c, 0.47, 0.46), w: 0.3, fromX: 0.78, fromY: 0.82, clickAt: 0.56, accent: CORE_TOKENS.info })
  const wide = kit(c, 1, 3.5, 4.5, { kit: 'browser-mockup', variant: 'agent', theme: 'light', accent: CORE_TOKENS.info, x: 0.5, y: 0.52, w: L(c, 0.9, 0.96), url: f.url ?? 'app.example.com', title: 'Thinking', subtitle: 'Progress', values: [1, 1, 1] })
  wide.keyframes = [kf(0, { scale: 1.04 }), kf(1.2, { scale: 1 }, 'ease-out')]
  textClip(c, 2, 4.2, 3.6, f.supporting ?? 'Your callout here', { fontSizePct: 4, color: CORE_TOKENS.lightText, y: L(c, 0.93, 0.9), weight: 800 })
}

function style2(c: Ctx, f: HomeFill) {
  const rnd = mulberry32(2)
  stage(c, 0, 14, VIDEO_TOKENS.orange)
  const headline = (f.headline ?? 'what do I post').toLowerCase()
  textClip(c, 3, 0.2, 13.6, headline, { fontSizePct: 16, color: CORE_TOKENS.lightPanel, anim: 'word-reveal', weight: 800, name: 'Kinetic headline' })
  // 10–12 floating UI cards: slow sine drift, low intensity, deterministic.
  const n = 11
  for (let i = 0; i < n; i++) {
    const x = 0.08 + (i % 4) * 0.28 + (rnd() - 0.5) * 0.06
    const y = 0.14 + Math.floor(i / 4) * 0.34 + (rnd() - 0.5) * 0.06
    if (Math.abs(x - 0.5) < 0.2 && Math.abs(y - 0.5) < 0.14) continue // keep the headline clear
    const rot = (rnd() - 0.5) * 12
    const card: StudioShapeClip = { ...base(c, 'Float card', 1 + (i % 2), 0.1 + i * 0.05, 13.8 - i * 0.05), kind: 'shape', shape: 'rounded-rect', x, y, w: 0.16, aspect: 0.42, fill: CORE_TOKENS.lightPanel, stroke: null, strokeWidth: 0, anim: 'pop', radius: 0.18, label: "What's happening?!", labelColor: CORE_TOKENS.lightText, rotation: rot }
    const amp = 0.008 + rnd() * 0.006, phase = rnd() * Math.PI * 2
    card.keyframes = [0, 1, 2, 3, 4].map((k) => kf((k / 4) * card.durationSec, { y: y + Math.sin(phase + k * Math.PI / 2) * amp, rotation: rot + Math.sin(phase + k) * 1.5 }, 'ease-in-out'))
    c.clips.push(card)
  }
  const brand = (f.brand ?? 'YOUR BRAND').toUpperCase()
  textClip(c, 4, 0, 14, brand, { fontSizePct: 2.4, color: CORE_TOKENS.lightPanel, x: 0.06, y: 0.06, align: 'left', anim: 'none', fontFamily: 'JetBrains Mono Variable', weight: 600 })
  textClip(c, 4, 0, 14, 'THE BLANK PAGE', { fontSizePct: 2.4, color: CORE_TOKENS.lightPanel, x: 0.94, y: 0.06, align: 'right', anim: 'none', fontFamily: 'JetBrains Mono Variable', weight: 600 })
  textClip(c, 4, 0, 14, 'STUDIO', { fontSizePct: 2.4, color: CORE_TOKENS.lightPanel, x: 0.06, y: 0.94, align: 'left', anim: 'none', fontFamily: 'JetBrains Mono Variable', weight: 600 })
  // Light panel beat.
  stage(c, 14, 16, VIDEO_TOKENS.paper, 'Light panel')
  textClip(c, 3, 14.2, 15.6, f.supporting ?? 'make it yours.', { fontSizePct: 7, color: CORE_TOKENS.lightText, x: L(c, 0.17, 0.5), y: L(c, 0.5, 0.12), anim: 'word-reveal', highlightWord: 'yours', emphasisColor: VIDEO_TOKENS.orange, name: 'Kinetic headline' })
  kit(c, 1, 14.4, 15.4, { kit: 'browser-mockup', variant: 'composer', theme: 'light', accent: VIDEO_TOKENS.orange, x: 0.5, y: L(c, 0.52, 0.42), w: L(c, 0.34, 0.8), title: f.brand ?? 'Your name', items: [f.cta ?? 'Write your post here.', 'NewBrand fills this from your brief.', ''], subtitle: 'Ready to post' })
  const ratings = f.ratings?.length ? f.ratings : null
  kit(c, 2, 14.8, 15, {
    kit: 'rating-bars', theme: 'light', accent: VIDEO_TOKENS.orange, x: L(c, 0.84, 0.5), y: L(c, 0.52, 0.8), w: L(c, 0.24, 0.7), title: 'POST RATING',
    items: ratings ? ratings.map((r) => r.label) : ['Add a rating', 'Add a rating', 'Add a rating', 'Add a rating', 'Add a rating'],
    values: ratings ? ratings.map((r) => r.value) : [0, 0, 0, 0, 0],
  })
}

function style3(c: Ctx, f: HomeFill) {
  stage(c, 0, 25, VIDEO_TOKENS.paper)
  const words = f.pillWords?.length ? f.pillWords : ['with']
  const line = f.headline ? f.headline.replace(new RegExp(`\\b(${words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})\\b`, 'gi'), '[$1]') + ' [+]' : 'connect [with] over [+]'
  const pill = kit(c, 1, 0, 11, { kit: 'pill-text', variant: 'inline', theme: 'light', accent: CORE_TOKENS.danger, x: 0.5, y: 0.5, w: L(c, 0.7, 0.92), title: line })
  // Horizontal slide-through on exit.
  pill.keyframes = [kf(0, { x: 0.5 }), kf(10.4, { x: 0.5 }), kf(11, { x: -0.4 }, 'ease-in')]
  const list = kit(c, 1, 11, 14, { kit: 'pill-text', variant: 'checklist', theme: 'light', accent: CORE_TOKENS.danger, x: L(c, 0.36, 0.5), y: L(c, 0.5, 0.42), w: L(c, 0.46, 0.84), items: f.checklist?.length ? f.checklist : ['Add your first task', 'Add your second task', 'Add your third task', 'Your active task'] })
  list.keyframes = [kf(0, { x: 1.2 }), kf(0.5, { x: L(c, 0.36, 0.5) }, 'ease-out')]
  const badge: StudioShapeClip = { ...base(c, 'Badge', 2, 12.2, 12.8), kind: 'shape', shape: 'circle', x: L(c, 0.74, 0.35), y: L(c, 0.5, 0.78), w: L(c, 0.09, 0.2), aspect: 1, fill: VIDEO_TOKENS.ink, stroke: null, strokeWidth: 0, anim: 'none' }
  badge.keyframes = [kf(0, { x: 1.2 }), kf(0.45, { x: badge.x }, 'ease-out')]
  c.clips.push(badge)
  const tag = kit(c, 3, 12.4, 12.6, { kit: 'pill-text', variant: 'inline', theme: 'light', accent: CORE_TOKENS.danger, x: L(c, 0.86, 0.65), y: L(c, 0.5, 0.78), w: L(c, 0.14, 0.34), title: `[${f.brand ?? 'Brand'}]` })
  tag.keyframes = [kf(0, { x: 1.2 }), kf(0.45, { x: tag.x }, 'ease-out')]
}

function style4(c: Ctx, f: HomeFill) {
  stage(c, 0, 21, VIDEO_TOKENS.cream)
  kit(c, 1, 0, 9, { kit: 'image-stack', variant: 'stack', theme: 'light', accent: VIDEO_TOKENS.green, x: 0.5, y: L(c, 0.24, 0.2), w: L(c, 0.8, 0.94), media: takeMedia(c, 5), seed: 4 })
  textClip(c, 2, 0.6, 8.4, `◉ ${f.brand ?? 'Your brand'} Announcing`, { fontSizePct: 2.8, color: CORE_TOKENS.lightMuted, y: L(c, 0.56, 0.5), weight: 600, name: 'Eyebrow' })
  const figure = f.stats?.[0]?.value
  kit(c, 3, 0.9, 8.1, { kit: 'stat-card', variant: 'stat', theme: 'light', accent: VIDEO_TOKENS.green, x: 0.5, y: L(c, 0.74, 0.66), w: L(c, 0.5, 0.86), title: figure ?? PLACE.value, subtitle: figure ? f.stats?.[0]?.label ?? '' : PLACE.label })
  stage(c, 9, 12, VIDEO_TOKENS.cream, 'Split')
  const stats = f.stats?.slice(1, 4) ?? []
  for (let i = 0; i < 3; i++) {
    const s = stats[i]
    kit(c, 1 + (i % 2), 9 + i * 0.06, 12 - i * 0.06, { kit: 'stat-card', variant: 'stat', theme: 'light', accent: VIDEO_TOKENS.green, x: L(c, 0.2, 0.5), y: L(c, 0.26 + i * 0.24, 0.1 + i * 0.19), w: L(c, 0.3, 0.6), title: s?.value ?? PLACE.value, subtitle: s?.label ?? PLACE.label, active: i === 0 ? 1 : 0 })
  }
  kit(c, 3, 9.2, 11.8, { kit: 'image-stack', variant: 'landscape', theme: 'light', accent: VIDEO_TOKENS.green, x: L(c, 0.66, 0.5), y: L(c, 0.5, 0.78), w: L(c, 0.58, 0.9), media: takeMedia(c, 1), title: f.supporting ?? 'Your headline over your photo' })
}

function style5(c: Ctx, f: HomeFill) {
  stage(c, 0, 39, VIDEO_TOKENS.blue)
  const mascot = kit(c, 1, 0, 18, { kit: 'image-stack', variant: 'single', theme: 'light', accent: VIDEO_TOKENS.blue, x: L(c, 0.18, 0.5), y: L(c, 0.52, 0.25), w: L(c, 0.24, 0.4), media: takeMedia(c, 1), name: 'Mascot' })
  // Parallax sway only (never warp): tiny x/rotation drift.
  mascot.keyframes = [0, 1, 2, 3, 4].map((k) => kf((k / 4) * 18, { x: mascot.x + Math.sin(k * Math.PI / 2) * 0.006, rotation: Math.sin(k * Math.PI / 2) * 1.2 }, 'ease-in-out'))
  const prices = f.prices?.length ? f.prices : null
  const fills = [VIDEO_TOKENS.yellow, VIDEO_TOKENS.pink, VIDEO_TOKENS.mint]
  const icons = ['laptop', 'books', 'camera']
  for (let i = 0; i < 3; i++) {
    const p = prices?.[i]
    const card = kit(c, 2, 0.3 + i * 0.07, 17.7 - i * 0.07, { kit: 'stat-card', variant: 'price', theme: 'light', accent: fills[i], x: L(c, 0.44 + i * 0.19, 0.2 + i * 0.3), y: L(c, 0.5, 0.66), w: L(c, 0.17, 0.28), eyebrow: `// item 0${i + 1}`, title: p?.name ?? 'Your product', subtitle: p?.icon ?? icons[i], items: [p?.price ?? '—'] })
    card.keyframes = [kf(0, { rotation: -8 + i * 8, y: L(c, 0.6, 0.72) }), kf(0.5, { rotation: 0, y: L(c, 0.5, 0.66) }, 'ease-out')]
  }
  stage(c, 18, 21, VIDEO_TOKENS.paper, 'Checkout')
  textClip(c, 3, 18.2, 20.8, f.headline ?? 'In their own currency.', { fontSizePct: 6.5, color: CORE_TOKENS.lightText, x: L(c, 0.26, 0.5), y: L(c, 0.36, 0.1), highlightWord: 'own', emphasisColor: VIDEO_TOKENS.blue, emphasisFont: 'Playfair Display Variable', anim: 'word-reveal' } as Partial<StudioTextClip>)
  kit(c, 1, 18.6, 20.4, { kit: 'pill-text', variant: 'chips', theme: 'light', accent: VIDEO_TOKENS.blue, x: L(c, 0.26, 0.5), y: L(c, 0.55, 0.2), w: L(c, 0.34, 0.8), items: ['USD', 'EUR', 'GBP', 'JPY'], active: 3 })
  const checkoutPrices = f.prices?.[0]
  kit(c, 2, 18.4, 20.6, { kit: 'checkout-card', theme: 'light', accent: VIDEO_TOKENS.blue, x: L(c, 0.7, 0.5), y: L(c, 0.52, 0.6), w: L(c, 0.5, 0.92), url: f.url ?? 'store.example.com', title: checkoutPrices?.name ?? 'Your product', items: [checkoutPrices?.price ?? '—', checkoutPrices?.price ?? '', 'Subtotal|', 'Tax|'] })
  cursor(c, 4, 26, 5, [0.9, 0.9], [L(c, 0.82, 0.74), L(c, 0.8, 0.84)], 0.7)
}

function style6(c: Ctx, f: HomeFill) {
  stage(c, 0, 26, VIDEO_TOKENS.ink)
  const [a, b] = splitTwoTone(f.headline ?? 'CHASING THE ROOFLINE')
  textClip(c, 2, 0.2, 11.8, `${a} ${b}`.toUpperCase(), { fontSizePct: 12, color: CORE_TOKENS.text, highlightWord: b.toUpperCase(), emphasisColor: VIDEO_TOKENS.orange, y: 0.42, anim: 'word-reveal', name: 'Glow headline', textGlow: 0.3 } as Partial<StudioTextClip>)
  textClip(c, 2, 0.8, 11.2, f.supporting ?? 'your subline here', { fontSizePct: 2.8, color: CORE_TOKENS.muted, y: 0.6, fontFamily: 'JetBrains Mono Variable', weight: 400 })
  const board = kit(c, 1, 0, 12, { kit: 'block-row-3d', accent: VIDEO_TOKENS.orange, theme: 'dark', x: 0.5, y: 0.82, w: 0.9, values: [8] })
  board.opacity = 0.35
  const row = kit(c, 1, 12, 14, { kit: 'block-row-3d', accent: VIDEO_TOKENS.orange, theme: 'dark', x: 0.5, y: L(c, 0.5, 0.45), w: L(c, 0.95, 1), values: [14] })
  row.keyframes = [kf(0, { scale: 1 }), kf(14, { scale: 1.06 }, 'linear')] // slow camera push (parametric only)
  textClip(c, 2, 12.6, 13.4, f.cta ?? "One thread for every number you've got,", { fontSizePct: 4, color: CORE_TOKENS.text, y: L(c, 0.86, 0.8), highlightWord: 'every', emphasisColor: VIDEO_TOKENS.orange, weight: 800 } as Partial<StudioTextClip>)
}

function splitTwoTone(s: string): [string, string] {
  const words = s.trim().split(/\s+/)
  if (words.length < 2) return [s, '']
  return [words.slice(0, -1).join(' '), words[words.length - 1]]
}

const BUILDERS: Record<HomeStyleId, (c: Ctx, f: HomeFill) => void> = {
  'saas-capture': style1,
  'kinetic-float': style2,
  'red-pill': style3,
  'launch-stats': style4,
  'mascot-checkout': style5,
  'dark-3d': style6,
}

/* ——— planner ——— */

/**
 * Plan a style into the doc. Pure: never mutates `doc`; the caller shows
 * `changes` and applies `plan.doc` as one undo step.
 */
export function planHomeVideo(doc: StudioDoc, style: HomeStyleId, fill: HomeFill = {}, opts: { aspect?: StudioAspect } = {}): HomeVideoPlan {
  const meta = HOME_STYLES.find((s) => s.id === style)
  if (!meta) throw new Error(`Unknown style “${style}” — use one of: ${HOME_STYLES.map((s) => s.id).join(', ')}`)
  const aspect = opts.aspect ?? doc.aspect
  const ratio = aspectRatio(aspect)
  const start = Math.round(docDuration(doc) * 100) / 100
  const media: StudioKitMedia[] = doc.clips
    .filter((c) => c.kind === 'image' || c.kind === 'video')
    .sort((a, b) => a.startSec - b.startSec)
    .map((c) => (c.kind === 'image' || c.kind === 'video' ? { mediaId: c.mediaId, fileName: c.fileName } : null))
  let n = 0
  const prefix = `hv-${style}-${doc.clips.length.toString(36)}-${Math.round(start * 100).toString(36)}`
  const c: Ctx = { start, portrait: ratio < 1, ratio, nextId: () => `${prefix}-${(n++).toString(36)}`, clips: [], media, mediaUsed: 0 }
  BUILDERS[style](c, fill)
  const tracksNeeded = c.clips.reduce((m, cl) => Math.max(m, cl.track + 1), 0)
  const trackCount = Math.min(MAX_TRACKS, Math.max(doc.trackCount, tracksNeeded))
  const slots = c.clips.filter((cl): cl is StudioKitClip => cl.kind === 'kit' && cl.kit === 'image-stack')
  const emptySlots = slots.reduce((sum, cl) => sum + (cl.media ?? []).filter((m) => !m).length, 0)
  const placeholders = c.clips.filter((cl) => cl.kind === 'kit' && (cl.title === PLACE.value || cl.items?.[0] === '—')).length
  const changes = [
    `Add “${meta.name}” (${meta.durationSec}s, ${aspect}) at ${start.toFixed(2)}s — ${c.clips.length} clips on ${tracksNeeded} tracks.`,
    `Photo slots: ${slots.length ? `${slots.reduce((s, cl) => s + (cl.media?.length ?? 0), 0) - emptySlots} filled from your footage, ${emptySlots} left as “drop media here”` : 'none'}.`,
    placeholders ? `${placeholders} number/price card${placeholders === 1 ? '' : 's'} show a placeholder — add your real figures (nothing is invented).` : 'All figures come from what you provided.',
  ]
  if (meta.fps === 60 && doc.fps !== 60) changes.push(`This style is designed for 60 fps; the doc stays at ${doc.fps} fps unless you change it.`)
  const broll: BrollSuggestion[] = [
    { id: `${prefix}-broll-0`, label: 'Product or screen close-up', startSec: start + meta.durationSec * 0.2, durationSec: 2.5, reason: 'After the hook, show the thing itself.' },
    { id: `${prefix}-broll-1`, label: 'Hands / people using it', startSec: start + meta.durationSec * 0.55, durationSec: 2.5, reason: 'A human moment before the proof beat.' },
    { id: `${prefix}-broll-2`, label: 'Result or outcome shot', startSec: start + meta.durationSec * 0.85, durationSec: 2, reason: 'Close on the outcome before the CTA.' },
  ]
  return { style, doc: { ...doc, clips: [...doc.clips, ...c.clips], trackCount }, clips: c.clips, changes, startSec: start, durationSec: meta.durationSec, emptySlots, broll }
}

/**
 * Accept ONE B-roll suggestion: a visible single-photo slot at that moment on
 * the first free track. Never called automatically.
 */
export function acceptBroll(doc: StudioDoc, s: BrollSuggestion): StudioDoc {
  let track = 0
  const end = s.startSec + s.durationSec
  const busy = (tr: number) => doc.clips.some((c) => c.track === tr && c.startSec < end - 0.005 && c.startSec + c.durationSec > s.startSec + 0.005)
  while (track < MAX_TRACKS && busy(track)) track++
  if (track >= MAX_TRACKS) throw new Error('No free track at that moment — remove a layer or move the suggestion.')
  const clip = normaliseKit({ id: s.id, kit: 'image-stack', variant: 'single', track, startSec: s.startSec, durationSec: s.durationSec, name: `B-roll: ${s.label}`, x: 0.5, y: 0.5, w: 0.6, media: [null], title: undefined })
  return { ...doc, clips: [...doc.clips, clip], trackCount: Math.max(doc.trackCount, track + 1) }
}
