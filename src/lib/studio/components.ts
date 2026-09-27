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
import { FRAMECN_CONFIGS } from '../../lab/framecn/configs'
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

/** Compact catalogue lines for a model prompt: the best matches for this request. */
export function componentCatalogFor(instruction: string, limit = 14): { slug: string; name: string; category: string; does: string; props?: string }[] {
  const ranked = rankComponents(instruction, limit)
  const pool = ranked.length >= 6 ? ranked : [...ranked, ...COMPONENTS.filter((e) => !ranked.includes(e)).slice(0, limit - ranked.length)]
  return pool.map((entry) => {
    const props = componentPropsSummary(entry.slug)
    return { slug: entry.slug, name: entry.name, category: entry.category, does: entry.description.slice(0, 90), ...(props ? { props } : {}) }
  })
}

/** "text:text, color:#hex, fontSize:24–200" — what the agent may set via addComponent.props. */
export function componentPropsSummary(slug: string): string | null {
  const cfg = FRAMECN_CONFIGS[slug]
  if (!cfg) return null
  return Object.entries(cfg.controls).map(([k, c]) => `${k}:${c.type === 'number' ? `${c.min}–${c.max}` : c.type === 'color' ? '#hex' : c.type === 'select' ? c.options.join('|') : c.type}`).join(', ')
}

/** Validate agent/user props against the component's own controls. Throws with a readable reason. */
export function validateComponentProps(slug: string, value: unknown): Record<string, string | number | boolean> {
  const cfg = FRAMECN_CONFIGS[slug]
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
