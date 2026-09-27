/**
 * UI components on the Studio timeline — the pure half.
 *
 * Every Lab component (src/lab/components, 190 of them) can be placed in an
 * edit. A placed component is an overlay clip carrying `component` settings;
 * it starts `pending`, and the Studio's recorder plays the real React demo,
 * acts it out (hover, pointer path, clicks) and records its actual animation
 * into frames. Because the settings live on the clip, the same clip can be
 * re-recorded longer, without interaction, etc. — and the agent can place
 * components with nothing but a slug.
 *
 * DOM-free: bundled by the Node checks and by the agent planner.
 */
import { FONT_FAMILY_RE, PROP_CONFIGS } from '../../lab/propConfigs'
import type { StudioAspect, StudioClip, StudioDoc, StudioOverlayClip } from '../../types/project'
import { categories, lab, type LabEntry } from '../../lab/registry'
import { uid } from '../utils'
import { placeClip, sizeForAspect } from './doc'

export type ComponentEntry = LabEntry
export const COMPONENTS: ComponentEntry[] = lab
export const COMPONENT_CATEGORIES = categories

const BY_SLUG = new Map(COMPONENTS.map((entry) => [entry.slug, entry]))

export function findComponent(slug: string | null | undefined): ComponentEntry | null {
  return slug ? BY_SLUG.get(slug) ?? null : null
}

export const DEFAULT_RECORD_SEC = 4
/** Shortest recording that still shows motion. */
export const MIN_RECORD_SEC = 0.5
/**
 * No 2–8 s preset ceiling any more: the user types any length. The only limit
 * is memory — every frame is an image kept in the project — so beyond this the
 * recorder refuses honestly instead of freezing the app. 12 fps × 120 s ≈ 1,440
 * frames, which is already very heavy.
 */
export const MAX_RECORD_SEC = 120
/** Past this, warn that the recording will make the project large. */
export const HEAVY_RECORD_SEC = 30

/** Parse whatever the user typed into a usable record length (seconds). */
export function clampRecordSec(value: unknown, fallback = DEFAULT_RECORD_SEC): number {
  const n = typeof value === 'string' ? Number(value.replace(/s$/i, '').trim()) : Number(value)
  if (!Number.isFinite(n) || n <= 0) return fallback
  return Math.round(Math.min(MAX_RECORD_SEC, Math.max(MIN_RECORD_SEC, n)) * 100) / 100
}

const words = (text: string) => text.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2)

/** Components ranked for a free-text query (names first, then keywords and descriptions). */
export function rankComponents(query: string, limit = 20): ComponentEntry[] {
  const q = query.toLowerCase().trim()
  if (!q) return COMPONENTS.slice(0, limit)
  const terms = words(q)
  return COMPONENTS.map((entry, index) => {
    const name = entry.name.toLowerCase()
    let score = q.includes(name) ? 12 : 0
    for (const term of terms) {
      if (name.includes(term)) score += 4
      if (entry.slug.includes(term)) score += 2
      if ((entry.keywords ?? '').toLowerCase().includes(term)) score += 2
      if (entry.description.toLowerCase().includes(term)) score += 1
      if (entry.category === term || entry.category.startsWith(term)) score += 1
    }
    return { entry, index, score }
  })
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, limit)
    .map((row) => row.entry)
}

/**
 * The component an instruction explicitly asks for, if any: "add the odometer",
 * "put a toggle switch component after the title". Needs either the exact
 * component name or the word component/widget plus a strong match, so an
 * ordinary edit request never sprouts a random widget.
 */
export function componentFromInstruction(instruction: string): ComponentEntry | null {
  const text = instruction.toLowerCase()
  const exact = COMPONENTS.filter((entry) => entry.name.length > 3 && new RegExp(`\\b${entry.name.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(text))
    .sort((a, b) => b.name.length - a.name.length)[0]
  if (exact && /\b(add|insert|put|place|use|show|drop|include)\b/.test(text)) return exact
  if (!/\b(component|widget|ui element|ui component)\b/.test(text)) return null
  const stripped = text.replace(/\b(add|insert|put|place|use|show|drop|include|a|an|the|component|widget|ui|element|here|at|playhead|to|timeline|please)\b/g, ' ')
  return rankComponents(stripped, 1)[0] ?? null
}

/**
 * What an editor reaches for, by intent. Keyword ranking alone never offers a
 * caption style or a shader when someone types "make it look premium", so the
 * catalogue leads with these whenever the request (or the edit's own text)
 * hints at the intent. Every slug is asserted to exist by check:agent-kit.
 */
export const INTENT_PICKS: { id: string; test: RegExp; slugs: string[] }[] = [
  { id: 'hook', test: /\b(hook|title|headline|intro|opening|open with|tagline|slogan|hero)\b/i, slugs: ['fc-blur-reveal', 'ob-flip-text', 'ob-text-stream', 'fc-per-character-rise', 'fc-mask-reveal-up', 'fc-tracking-in', 'fc-slot-machine-roll'] },
  { id: 'captions', test: /\b(caption|subtitle|karaoke|spoken|voice ?over|transcript|words? on screen)\b/i, slugs: ['fc-caption-pill-karaoke', 'fc-caption-editorial-emphasis', 'fc-caption-highlight', 'fc-caption-kinetic-slam', 'fc-caption-neon-accent'] },
  { id: 'stats', test: /\b(stat|number|metric|growth|revenue|users|percent|kpi|chart|data|\d+ ?%|\d+k)\b/i, slugs: ['odometer', 'stat-counter', 'fc-animated-bar-chart', 'fc-animated-line-chart', 'gauge', 'sparkline'] },
  { id: 'product', test: /\b(product|app|saas|demo|dashboard|website|landing|feature|walkthrough|tutorial|software)\b/i, slugs: ['fc-browser-flow', 'fc-dashboard-populate', 'fc-hero-device-assemble', 'fc-cursor-flow', 'command-palette', 'fc-staggered-bento-grid'] },
  { id: 'code', test: /\b(code|developer|dev|api|terminal|cli|deploy|sdk|github)\b/i, slugs: ['fc-terminal-simulator', 'fc-glass-code-block', 'fc-code-diff-wipe', 'fc-terminal-to-browser-deploy', 'fc-live-code-compilation'] },
  { id: 'background', test: /\b(background|backdrop|premium|luxury|cinematic|ambient|aesthetic|moody|gradient|shader|glow)\b/i, slugs: ['fc-shader-mesh-gradient', 'fc-shader-grain-gradient', 'fc-shader-god-rays', 'fc-shader-liquid-metal', 'fc-mesh-gradient-bg', 'fc-shader-smoke-ring'] },
  { id: 'transition', test: /\b(transition|cut|scene change|between (scenes|shots|clips)|wipe|smooth)\b/i, slugs: ['fc-zoom-through-transition', 'fc-frosted-glass-wipe', 'fc-directional-wipe', 'fc-chromatic-aberration-wipe', 'fc-spatial-push', 'fc-per-word-crossfade'] },
  { id: 'launch', test: /\b(launch|announce|new|sale|offer|discount|cta|sign ?up|download|live now|release)\b/i, slugs: ['ob-marquee-band', 'fc-product-launch-trailer', 'fc-success-confetti', 'fc-spring-pop-in', 'announcement-banner', 'fc-logo-enter'] },
  { id: 'interaction', test: /\b(click|tap|press|button|cursor|pointer|interact)\b/i, slugs: ['ob-click-spark', 'fc-simulated-cursor', 'magnetic-button', 'like-button', 'toggle-switch'] },
  { id: 'pricing', test: /\b(pric(e|ing)|plan|tier|subscription)\b/i, slugs: ['fc-pricing-tier-focus', 'pricing-toggle', 'pricing-calculator'] },
  { id: 'notify', test: /\b(notification|message|chat|alert|toast|inbox)\b/i, slugs: ['fc-toast-notification', 'chat-thread', 'notification-bell'] },
  { id: 'steps', test: /\b(steps?|process|how it works|workflow|pipeline|journey|onboarding)\b/i, slugs: ['fc-progress-steps', 'fc-pipeline-journey', 'fc-data-flow-pipes', 'onboarding-checklist'] },
  { id: 'ai', test: /\b(ai|gpt|generate|generation|prompt|llm|agent)\b/i, slugs: ['fc-ai-generate-overlay', 'fc-ai-generation-canvas', 'fc-chat-to-preview-layout'] },
  // Broad polish: one of each kind, so the agent can build a full edit.
  { id: 'polish', test: /\b(better|polish|improve|professional|pro|auto ?edit|make it (pop|nice|good|great)|level up|enhance|upgrade|viral|engaging)\b/i, slugs: ['fc-blur-reveal', 'fc-caption-editorial-emphasis', 'fc-zoom-through-transition', 'fc-shader-grain-gradient', 'odometer', 'ob-marquee-band', 'ob-click-spark'] },
]

/** Placement guidance per category, shown next to each catalogue line. */
export const COMPONENT_USE: Record<string, string> = {
  shaders: 'background: track 0, the whole scene long, text on top; set colours to the brand',
  scenes: 'a full-frame beat of 3-6 s; set its text props to the real copy',
  transitions: 'sits across a cut, 0.6-1.2 s, centred on the join between two shots',
  captions: 'the spoken/on-screen line: put the real words in text, fontFamily = the caption font',
  text: 'the hero line of a beat: real words in text, fontFamily + color from the brand',
  motion: 'an accent moment layered over a beat (confetti, cursor, click spark, marquee)',
}

export function intentsFor(text: string): string[] {
  return INTENT_PICKS.filter((intent) => intent.test.test(text)).map((intent) => intent.id)
}

/** Compact catalogue lines for a model prompt: intent picks first, then the best keyword matches. */
export function componentCatalogFor(instruction: string, limit = 18, extraText = ''): { slug: string; name: string; category: string; does: string; use?: string; props?: string }[] {
  const text = `${instruction} ${extraText}`
  const picked: ComponentEntry[] = []
  const add = (entry: ComponentEntry | null) => { if (entry && !picked.includes(entry) && picked.length < limit) picked.push(entry) }
  // Round-robin across matched intents so one intent cannot fill the list.
  const lists = INTENT_PICKS.filter((intent) => intent.test.test(instruction) || (extraText && intent.test.test(extraText))).map((intent) => intent.slugs)
  for (let round = 0; round < 4; round++) for (const list of lists) add(findComponent(list[round]))
  for (const entry of rankComponents(text, limit)) add(entry)
  if (picked.length < 6) for (const entry of COMPONENTS) { if (picked.length >= limit) break; add(entry) }
  return picked.map((entry) => {
    const props = componentPropsSummary(entry.slug)
    const use = COMPONENT_USE[entry.category]
    return { slug: entry.slug, name: entry.name, category: entry.category, does: entry.description.slice(0, 90), ...(use ? { use } : {}), ...(props ? { props } : {}) }
  })
}

/** "text:text, color:#hex, fontSize:24–200" — what the agent may set via addComponent.props. */
export function componentPropsSummary(slug: string): string | null {
  const cfg = PROP_CONFIGS[slug]
  if (!cfg) return null
  return Object.entries(cfg.controls).map(([k, c]) => `${k}:${c.type === 'number' ? `${c.min}–${c.max}` : c.type === 'color' ? '#hex' : c.type === 'select' ? c.options.join('|') : k === 'fontFamily' ? 'font family from STUDIO CONTEXT.fonts' : c.type}`).join(', ')
}

/** Validate agent/user props against the component's own controls. Throws with a readable reason. */
export function validateComponentProps(slug: string, value: unknown): Record<string, string | number | boolean> {
  const cfg = PROP_CONFIGS[slug]
  if (!cfg) throw new Error(`“${slug}” has no settable props`)
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('props must be an object')
  const out: Record<string, string | number | boolean> = {}
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    const c = cfg.controls[k]
    if (!c) throw new Error(`“${slug}” has no prop “${k}” — allowed: ${Object.keys(cfg.controls).join(', ')}`)
    if (c.type === 'number') { if (typeof v !== 'number' || !Number.isFinite(v)) throw new Error(`${k} must be a number`); out[k] = Math.min(c.max, Math.max(c.min, v)) }
    else if (c.type === 'boolean') { if (typeof v !== 'boolean') throw new Error(`${k} must be true/false`); out[k] = v }
    else if (c.type === 'color') { if (typeof v !== 'string' || (v !== c.default && !/^(#[0-9a-f]{3,8}|(rgb|hsl)a?\([^)]{1,60}\)|[a-z]{3,20})$/i.test(v.trim()))) throw new Error(`${k} must be a colour (#hex, rgb(), hsl() or a CSS colour name)`); out[k] = v }
    else if (c.type === 'select') { if ((typeof v !== 'string' && typeof v !== 'number') || ![...c.options, c.default].map(String).includes(String(v))) throw new Error(`${k} must be one of ${c.options.join(', ')}`); out[k] = v }
    else if (k === 'fontFamily') { if (typeof v !== 'string' || (v !== '' && !FONT_FAMILY_RE.test(v.trim()))) throw new Error('fontFamily must be a font family name'); out[k] = v.trim() }
    else { if (typeof v !== 'string' || v.length > 400) throw new Error(`${k} must be text under 400 characters`); out[k] = v }
  }
  return out
}

/**
 * A pending component clip. The Studio recorder fills in its frames; until
 * then the renderer draws a labelled placeholder card, so nothing is blank.
 */
export function componentClip(slug: string, opts: { startSec: number; durationSec?: number; recordSec?: number; interact?: boolean; track?: number; x?: number; y?: number } ): StudioOverlayClip {
  const entry = findComponent(slug)
  const recordSec = clampRecordSec(opts.recordSec)
  return {
    id: uid(),
    kind: 'overlay',
    track: Math.max(0, opts.track ?? 1),
    startSec: Math.max(0, Math.round(opts.startSec * 100) / 100),
    durationSec: Math.max(0.5, opts.durationSec ?? recordSec),
    name: entry?.name ?? slug,
    transitionIn: 'fade',
    transitionOut: 'fade',
    opacity: 1,
    dataUrl: '',
    source: `UI component · ${entry?.name ?? slug}`,
    x: opts.x ?? 0.5,
    y: opts.y ?? 0.5,
    scale: 1,
    loop: true,
    playbackRate: 1,
    component: { slug, status: 'pending', recordSec, interact: opts.interact ?? true },
  }
}

/** Add a pending component at `startSec` on the first free track (creating tracks). */
export function withComponent(doc: StudioDoc, slug: string, opts: Parameters<typeof componentClip>[1]): { doc: StudioDoc; clip: StudioClip } {
  const placed = placeClip(doc, componentClip(slug, opts))
  return { doc: { ...doc, trackCount: placed.trackCount, clips: [...doc.clips, placed.clip] }, clip: placed.clip }
}

/**
 * Clip scale that shows a recorded component at a legible, crisp size: the
 * frame's short side is treated as a 380-CSS-pixel screen (a widget is the
 * hero of its clip, so it reads at ~2.8× in 1080p), capped to 80% of the frame. `pixelRatio` is the capture scale.
 */
export function fitComponentScale(imgW: number, imgH: number, pixelRatio: number, aspect: StudioAspect): number {
  if (!(imgW > 0 && imgH > 0)) return 0.8
  const [W, H] = sizeForAspect(aspect)
  const k = Math.min(W, H) / 380
  const cssW = imgW / Math.max(0.5, pixelRatio)
  const cssH = imgH / Math.max(0.5, pixelRatio)
  const wantW = Math.min(W * 0.8, cssW * k)
  const wantH = Math.min(H * 0.8, cssH * k)
  const base = Math.min(W / imgW, H / imgH)
  const scale = Math.min(wantW / (imgW * base), wantH / (imgH * base))
  return Math.round(Math.min(1, Math.max(0.15, scale)) * 1000) / 1000
}

export function isPendingComponent(clip: StudioClip): clip is StudioOverlayClip & { component: NonNullable<StudioOverlayClip['component']> } {
  return clip.kind === 'overlay' && Boolean(clip.component) && (clip.component!.status === 'pending' || clip.component!.status === 'recording')
}

/**
 * Record now, place later (2.13). A shelf item is a component clip that is not
 * on the timeline yet: the same recorder fills it, and Place copies it to the
 * playhead as many times as the user wants.
 */
export function shelfComponent(slug: string, opts: { recordSec?: number; interact?: boolean }): StudioOverlayClip {
  const clip = componentClip(slug, { startSec: 0, recordSec: opts.recordSec, interact: opts.interact })
  return { ...clip, durationSec: clip.component!.recordSec }
}

/** A ready shelf recording, as a fresh timeline clip at `startSec` on the first free track. */
export function placeShelfItem(doc: StudioDoc, item: StudioOverlayClip, startSec: number): { doc: StudioDoc; clip: StudioClip } {
  const fresh: StudioOverlayClip = { ...item, id: uid(), startSec: Math.max(0, Math.round(startSec * 100) / 100), durationSec: Math.max(item.durationSec, 0.5) }
  const placed = placeClip(doc, fresh)
  return { doc: { ...doc, trackCount: placed.trackCount, clips: [...doc.clips, placed.clip] }, clip: placed.clip }
}
