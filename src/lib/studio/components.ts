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
export function componentCatalogFor(instruction: string, limit = 14): { slug: string; name: string; category: string; does: string }[] {
  const ranked = rankComponents(instruction, limit)
  const pool = ranked.length >= 6 ? ranked : [...ranked, ...COMPONENTS.filter((e) => !ranked.includes(e)).slice(0, limit - ranked.length)]
  return pool.map((entry) => ({ slug: entry.slug, name: entry.name, category: entry.category, does: entry.description.slice(0, 90) }))
}

/**
 * A pending component clip. The Studio recorder fills in its frames; until
 * then the renderer draws a labelled placeholder card, so nothing is blank.
 */
export function componentClip(slug: string, opts: { startSec: number; durationSec?: number; recordSec?: number; interact?: boolean; track?: number; x?: number; y?: number } ): StudioOverlayClip {
  const entry = findComponent(slug)
  const recordSec = Math.min(10, Math.max(1.5, opts.recordSec ?? DEFAULT_RECORD_SEC))
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
 * frame is treated as a 540-CSS-pixel-wide screen (so UI reads at ~2× in
 * 1080p), capped to 80% of the frame. `pixelRatio` is the capture scale.
 */
export function fitComponentScale(imgW: number, imgH: number, pixelRatio: number, aspect: StudioAspect): number {
  if (!(imgW > 0 && imgH > 0)) return 0.8
  const [W, H] = sizeForAspect(aspect)
  const k = Math.min(W, H) / 540
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
