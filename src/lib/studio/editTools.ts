/**
 * Editor upgrades (batch 3), pure and deterministic:
 * - grouping: tie a clip to the clips on screen with it, and move them together
 * - text-based editing: turn deleted transcript words into cuts
 * - SRT export from Studio text clips
 * - platform export presets and a pre-flight check
 */
import type { StudioAspect, StudioClip, StudioDoc, StudioWord } from '../../types/project'

const r3 = (v: number) => Math.round(v * 1000) / 1000

/* ——— grouping ——— */
export function groupOverlapping(doc: StudioDoc, clipId: string, groupId: string): { doc: StudioDoc; count: number } {
  const clip = doc.clips.find((c) => c.id === clipId)
  if (!clip) return { doc, count: 0 }
  const a = clip.startSec
  const b = clip.startSec + clip.durationSec
  const members = new Set(doc.clips.filter((c) => !c.locked && (c.id === clipId || (c.startSec < b - 0.01 && c.startSec + c.durationSec > a + 0.01))).map((c) => c.id))
  if (members.size < 2) return { doc, count: 1 }
  return { doc: { ...doc, clips: doc.clips.map((c) => (members.has(c.id) ? { ...c, groupId } : c)) }, count: members.size }
}

export function ungroup(doc: StudioDoc, clipId: string): { doc: StudioDoc; count: number } {
  const gid = doc.clips.find((c) => c.id === clipId)?.groupId
  if (!gid) return { doc, count: 0 }
  let count = 0
  const clips = doc.clips.map((c) => { if (c.groupId !== gid) return c; count++; const { groupId: _g, ...rest } = c; return rest as StudioClip })
  return { doc: { ...doc, clips }, count }
}

/**
 * A drag/nudge of one grouped clip moves every member by the same time and
 * track delta, clamped so nobody goes before 0 s or off the track range.
 * Returns null when the clip isn't grouped or the patch doesn't move it.
 */
export function moveWithGroup(doc: StudioDoc, clipId: string, patch: Partial<StudioClip>): StudioDoc | null {
  const clip = doc.clips.find((c) => c.id === clipId)
  if (!clip?.groupId || (patch.startSec === undefined && patch.track === undefined)) return null
  const members = doc.clips.filter((c) => c.groupId === clip.groupId)
  let dt = patch.startSec !== undefined ? patch.startSec - clip.startSec : 0
  let dk = patch.track !== undefined ? patch.track - clip.track : 0
  dt = Math.max(dt, -Math.min(...members.map((m) => m.startSec)))
  dk = Math.max(dk, -Math.min(...members.map((m) => m.track)))
  dk = Math.min(dk, 23 - Math.max(...members.map((m) => m.track)))
  const rest = { ...patch }
  delete rest.startSec
  delete rest.track
  const clips = doc.clips.map((c) => (c.groupId === clip.groupId ? ({ ...c, ...(c.id === clipId ? rest : {}), startSec: r3(c.startSec + dt), track: c.track + dk } as StudioClip) : c))
  return { ...doc, clips, trackCount: Math.max(doc.trackCount, ...clips.map((c) => c.track + 1)) }
}

/* ——— text-based editing ——— */
/** Source-time cuts for the deleted word indices; neighbours merge into one cut. */
export function wordCuts(words: StudioWord[], removed: Set<number>, range: [number, number], pad = 0.03): Array<[number, number]> {
  const sorted = words.map((w, i) => ({ ...w, i })).filter((w) => w.end > range[0] && w.start < range[1]).sort((a, b) => a.start - b.start)
  const cuts: Array<[number, number]> = []
  for (let k = 0; k < sorted.length; k++) {
    if (!removed.has(sorted[k].i)) continue
    let j = k
    while (j + 1 < sorted.length && removed.has(sorted[j + 1].i)) j++
    // Cut from the end of the previous kept word to the start of the next kept word.
    const from = k > 0 ? sorted[k - 1].end + pad : range[0]
    const to = j + 1 < sorted.length ? sorted[j + 1].start - pad : range[1]
    if (to - from > 0.05) cuts.push([r3(Math.max(range[0], from)), r3(Math.min(range[1], to))])
    k = j
  }
  return cuts
}

/* ——— SRT ——— */
const ts = (s: number) => {
  const ms = Math.max(0, Math.round(s * 1000))
  const p = (n: number, w = 2) => String(n).padStart(w, '0')
  return `${p(Math.floor(ms / 3600000))}:${p(Math.floor(ms / 60000) % 60)}:${p(Math.floor(ms / 1000) % 60)},${p(ms % 1000, 3)}`
}
/** Visible text clips → SRT cues in time order. Placeholders are skipped and counted. */
export function studioToSrt(doc: StudioDoc): { srt: string; cues: number; skipped: number } {
  const texts = doc.clips.filter((c) => c.kind === 'text' && !c.hidden && c.text.trim()).sort((a, b) => a.startSec - b.startSec || a.track - b.track) as Array<Extract<StudioClip, { kind: 'text' }>>
  const real = texts.filter((t) => !t.text.trim().startsWith('['))
  const srt = real.map((t, i) => `${i + 1}\n${ts(t.startSec)} --> ${ts(t.startSec + t.durationSec)}\n${t.text.replace(/\*/g, '').trim()}\n`).join('\n')
  return { srt, cues: real.length, skipped: texts.length - real.length }
}

/* ——— platform presets ——— */
export type PlatformPreset = { id: string; label: string; aspect: StudioAspect; fps: 30 | 60; maxSec: number; safeTop: number; safeBottom: number; note: string }
export const PLATFORM_PRESETS: PlatformPreset[] = [
  { id: 'reels', label: 'Instagram Reels', aspect: '9:16', fps: 30, maxSec: 180, safeTop: 0.12, safeBottom: 0.2, note: 'Keep text clear of the caption and buttons at the bottom.' },
  { id: 'shorts', label: 'YouTube Shorts', aspect: '9:16', fps: 30, maxSec: 180, safeTop: 0.1, safeBottom: 0.18, note: 'Title and subscribe bar sit at the bottom.' },
  { id: 'tiktok', label: 'TikTok', aspect: '9:16', fps: 30, maxSec: 600, safeTop: 0.12, safeBottom: 0.22, note: 'The right-side icons and the caption cover the lower right.' },
  { id: 'linkedin', label: 'LinkedIn feed', aspect: '1:1', fps: 30, maxSec: 600, safeTop: 0.05, safeBottom: 0.08, note: 'Square plays well in the feed. Most people watch muted, so add captions.' },
  { id: 'youtube', label: 'YouTube (landscape)', aspect: '16:9', fps: 30, maxSec: 43200, safeTop: 0.05, safeBottom: 0.1, note: 'Leave room for the progress bar.' },
]

export type PresetIssue = { level: 'error' | 'warn'; text: string }
export function checkPreset(doc: StudioDoc, preset: PlatformPreset): PresetIssue[] {
  const issues: PresetIssue[] = []
  const dur = doc.clips.reduce((m, c) => Math.max(m, c.startSec + c.durationSec), 0)
  if (doc.aspect !== preset.aspect) issues.push({ level: 'error', text: `Aspect is ${doc.aspect}; ${preset.label} wants ${preset.aspect}.` })
  if (dur > preset.maxSec) issues.push({ level: 'error', text: `${dur.toFixed(0)}s is longer than ${preset.label}'s ${preset.maxSec}s limit.` })
  if (dur === 0) issues.push({ level: 'error', text: 'The timeline is empty.' })
  const unsafe = doc.clips.filter((c) => c.kind === 'text' && !c.hidden && (c.y < preset.safeTop || c.y > 1 - preset.safeBottom))
  if (unsafe.length) issues.push({ level: 'warn', text: `${unsafe.length} text clip(s) sit where ${preset.label}'s UI covers them.` })
  if (!doc.clips.some((c) => c.kind === 'text')) issues.push({ level: 'warn', text: 'No on-screen text. Many viewers watch muted, so add captions.' })
  return issues
}

/* ——— multi-select operations (batch 4) ——— */
const unlocked = (doc: StudioDoc, ids: Set<string>) => doc.clips.filter((c) => ids.has(c.id) && !c.locked)

/** Group exactly the chosen clips (locked ones are skipped). */
export function groupClips(doc: StudioDoc, ids: Set<string>, groupId: string): { doc: StudioDoc; count: number } {
  const pick = new Set(unlocked(doc, ids).map((c) => c.id))
  if (pick.size < 2) return { doc, count: pick.size }
  return { doc: { ...doc, clips: doc.clips.map((c) => (pick.has(c.id) ? { ...c, groupId } : c)) }, count: pick.size }
}

export function deleteClips(doc: StudioDoc, ids: Set<string>): { doc: StudioDoc; count: number } {
  const pick = new Set(unlocked(doc, ids).map((c) => c.id))
  return { doc: { ...doc, clips: doc.clips.filter((c) => !pick.has(c.id)) }, count: pick.size }
}

/** Move every chosen clip by `dt` seconds, clamped so the earliest stays ≥ 0. */
export function nudgeClips(doc: StudioDoc, ids: Set<string>, dt: number): { doc: StudioDoc; count: number } {
  const pick = unlocked(doc, ids)
  if (!pick.length) return { doc, count: 0 }
  const d = Math.max(dt, -Math.min(...pick.map((c) => c.startSec)))
  const set = new Set(pick.map((c) => c.id))
  return { doc: { ...doc, clips: doc.clips.map((c) => (set.has(c.id) ? { ...c, startSec: r3(c.startSec + d) } : c)) }, count: pick.length }
}

/** Line up every chosen clip's start with the earliest (or with `at`). */
export function alignStarts(doc: StudioDoc, ids: Set<string>, at?: number): { doc: StudioDoc; count: number } {
  const pick = unlocked(doc, ids)
  if (pick.length < 2 && at === undefined) return { doc, count: 0 }
  const t = r3(Math.max(0, at ?? Math.min(...pick.map((c) => c.startSec))))
  const set = new Set(pick.map((c) => c.id))
  return { doc: { ...doc, clips: doc.clips.map((c) => (set.has(c.id) ? { ...c, startSec: t } : c)) }, count: pick.length }
}

/** Shift/Ctrl-click toggle, keeping the primary selection in the set. */
export function toggleInSelection(sel: Set<string>, primary: string | null, id: string): Set<string> {
  const next = new Set(sel)
  if (primary) next.add(primary)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  return next
}
