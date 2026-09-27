/**
 * Auto-edit suggestions (2.9).
 *
 * Reads the document and proposes fixes. Each suggestion carries a pure
 * `apply(doc)` so the UI can preview the result without touching the project,
 * then commit it as ONE undo step on Accept. Nothing is applied automatically.
 */

import type { StudioAudioClip, StudioDoc, StudioTextClip } from '../../types/project'
import { clipEnd, docDuration } from './doc'
import { closeGaps } from './timelineOps'
import { DEFAULT_DUCKING } from './audioMix'
import { unfilledPlaceholders } from './layouts'

export type Suggestion = {
  id: string
  title: string
  detail: string
  severity: 'info' | 'warn'
  apply: (doc: StudioDoc) => StudioDoc
}

export function suggestEdits(doc: StudioDoc): Suggestion[] {
  const out: Suggestion[] = []
  const media = doc.clips.filter((c) => c.kind === 'video' || c.kind === 'image')

  // Gaps on the main media track show a black frame.
  const gapped = closeGaps(doc, 0)
  if (gapped.changed && media.some((c) => c.track === 0)) {
    out.push({ id: 'close-gaps', title: 'Close gaps on the main track', detail: 'Empty space between clips exports as a black frame.', severity: 'warn', apply: (d) => closeGaps(d, 0).doc })
  }

  // Long static photos feel dead; give them gentle motion.
  const still = media.filter((c) => c.kind === 'image' && c.durationSec >= 2.5 && !c.keyframes?.length)
  if (still.length) {
    out.push({
      id: 'photo-motion',
      title: `Add subtle motion to ${still.length} still photo${still.length > 1 ? 's' : ''}`,
      detail: 'A slow push keeps a photo alive without distracting from it.',
      severity: 'info',
      apply: (d) => ({
        ...d,
        clips: d.clips.map((c) =>
          still.some((s) => s.id === c.id) && c.kind === 'image'
            ? { ...c, motionPreset: 'subtle', keyframes: [{ at: 0, scale: 1.02, x: 0.49, ease: 'linear' }, { at: c.durationSec, scale: 1.08, x: 0.51, ease: 'linear' }] }
            : c,
        ),
      }),
    })
  }

  // Hard cuts between every media clip — offer a quick fade on joins.
  const cuts = media.filter((c) => c.track === 0 && c.startSec > 0.01 && c.transitionIn === 'none')
  if (cuts.length >= 3) {
    out.push({
      id: 'soft-joins',
      title: `Soften ${cuts.length} hard cuts`,
      detail: 'Adds a short fade on each join on the main track.',
      severity: 'info',
      apply: (d) => ({ ...d, clips: d.clips.map((c) => (cuts.some((x) => x.id === c.id) ? { ...c, transitionIn: 'fade' } : c)) }),
    })
  }

  // Music under speech with no ducking.
  const music = doc.clips.filter((c): c is StudioAudioClip => c.kind === 'audio' && (c.role ?? 'music') === 'music')
  const speech = doc.clips.some((c) => (c.kind === 'audio' && c.role === 'voice') || (c.kind === 'video' && c.volume > 0.05))
  if (music.length && speech && !doc.ducking?.enabled) {
    out.push({ id: 'duck', title: 'Duck music under speech', detail: 'Lowers music by 12 dB whenever someone is talking.', severity: 'info', apply: (d) => ({ ...d, ducking: { ...DEFAULT_DUCKING } }) })
  }

  // Text that runs past the end of the edit, or is too brief to read.
  const total = docDuration(doc)
  const quick = doc.clips.filter((c): c is StudioTextClip => c.kind === 'text' && c.durationSec < Math.min(3, 0.3 + c.text.split(/\s+/).length * 0.28))
  if (quick.length) {
    out.push({
      id: 'read-time',
      title: `Give ${quick.length} caption${quick.length > 1 ? 's' : ''} time to be read`,
      detail: 'About 0.3 s per word plus a beat — viewers miss faster text.',
      severity: 'warn',
      apply: (d) => ({
        ...d,
        clips: d.clips.map((c) => {
          if (c.kind !== 'text' || !quick.some((q) => q.id === c.id)) return c
          const want = Math.round((0.3 + c.text.split(/\s+/).length * 0.28) * 100) / 100
          return { ...c, durationSec: Math.max(c.durationSec, Math.min(want, Math.max(c.durationSec, total - c.startSec))) }
        }),
      }),
    })
  }

  // Legibility off on text over media.
  const risky = doc.clips.filter((c): c is StudioTextClip => c.kind === 'text' && c.legibility === 'off' && media.some((m) => m.startSec < clipEnd(c) && clipEnd(m) > c.startSec))
  if (risky.length) {
    out.push({ id: 'legibility', title: 'Let the app protect text over footage', detail: 'Turns legibility back to auto so a scrim appears only when needed.', severity: 'info', apply: (d) => ({ ...d, clips: d.clips.map((c) => (risky.some((r) => r.id === c.id) ? { ...c, legibility: 'auto' } : c)) }) })
  }

  // Placeholders still in the edit: flagged, never auto-filled.
  const holes = unfilledPlaceholders(doc)
  if (holes.length) {
    out.push({ id: 'placeholders', title: `${holes.length} placeholder${holes.length > 1 ? 's' : ''} still need real content`, detail: 'Testimonials are never written for you. Fill them in or remove them — Accept removes them.', severity: 'warn', apply: (d) => ({ ...d, clips: d.clips.filter((c) => !holes.some((h) => h.id === c.id)) }) })
  }

  return out
}
