/**
 * Document checks.
 *
 * `validateEditingPlan` checks a plan an agent proposed; this checks the thing
 * the user is actually editing. The rules are the ones that cost a re-export:
 * text outside the safe area, two captions on screen at once, a clip pointing
 * at media that is gone, a mask that hides everything.
 *
 * Every issue is written the way a person would say it, and carries a fix
 * where a fix is obvious — a warning you cannot act on is just nagging.
 */
import type { StudioClip, StudioDoc, StudioTextClip } from '../../types/project'
import { SAFE_MARGIN } from './renderer'

export type DocIssueSeverity = 'error' | 'warning'

export type DocIssue = {
  id: string
  severity: DocIssueSeverity
  /** What is wrong, in plain words. */
  message: string
  /** What to do about it, when that is not obvious from the message. */
  hint?: string
  clipId?: string
  /** A one-click correction, when one exists. */
  fix?: { label: string; patch: Partial<StudioClip> }
}

const clipEnd = (clip: StudioClip) => clip.startSec + clip.durationSec

/** Rough painted box for a text clip, in normalised units. Mirrors the preview's estimate. */
function textBox(clip: StudioTextClip) {
  const h = (clip.fontSizePct / 100) * 1.5
  const w = Math.min(0.92, Math.max(0.3, clip.text.length * clip.fontSizePct * 0.006))
  return { left: clip.x - w / 2, right: clip.x + w / 2, top: clip.y - h / 2, bottom: clip.y + h / 2 }
}

function timeOverlap(a: StudioClip, b: StudioClip) {
  return a.startSec < clipEnd(b) - 0.001 && b.startSec < clipEnd(a) - 0.001
}

export function lintStudioDoc(doc: StudioDoc, opts: { hasMedia?: (mediaId: string) => boolean } = {}): DocIssue[] {
  const issues: DocIssue[] = []
  const texts = doc.clips.filter((c): c is StudioTextClip => c.kind === 'text')

  for (const clip of doc.clips) {
    if ((clip.kind === 'video' || clip.kind === 'image' || clip.kind === 'audio') && opts.hasMedia) {
      if (!opts.hasMedia(clip.mediaId)) {
        issues.push({
          id: `media:${clip.id}`,
          severity: 'error',
          clipId: clip.id,
          message: `“${clip.name}” has lost its file.`,
          hint: 'Relink it in the inspector, or delete the clip — it exports as a placeholder otherwise.',
        })
      }
    }

    if (clip.mask && (clip.mask.shape === 'rect' || clip.mask.shape === 'ellipse')) {
      if (clip.mask.w < 0.02 || clip.mask.h < 0.02) {
        issues.push({
          id: `mask-empty:${clip.id}`,
          severity: 'warning',
          clipId: clip.id,
          message: `The mask on “${clip.name}” is so small the clip is effectively invisible.`,
          fix: { label: 'Remove the mask', patch: { mask: null } },
        })
      }
    }

    if (clip.mask?.shape === 'matte' && !clip.mask.matteDataUrl) {
      issues.push({
        id: `mask-matte:${clip.id}`,
        severity: 'error',
        clipId: clip.id,
        message: `“${clip.name}” is set to use an imported matte, but no matte has been chosen.`,
        hint: 'Pick a greyscale PNG in the Mask section, or switch the mask off.',
      })
    }

    if (clip.kind === 'audio' && clip.volume <= 0) {
      issues.push({
        id: `silent:${clip.id}`,
        severity: 'warning',
        clipId: clip.id,
        message: `“${clip.name}” is silent, so it will not be in the export.`,
        fix: { label: 'Set it to 80%', patch: { volume: 0.8 } as Partial<StudioClip> },
      })
    }

    if (clip.kind === 'audio' && clip.fadeInSec + clip.fadeOutSec > clip.durationSec + 0.001) {
      issues.push({
        id: `fades:${clip.id}`,
        severity: 'warning',
        clipId: clip.id,
        message: `The fades on “${clip.name}” are longer than the clip, so it never reaches full level.`,
      })
    }

    if (clip.kind === 'sticker' && clip.stickerId === 'custom') {
      let ok = false
      try {
        const parsed = JSON.parse(clip.json ?? 'null') as { layers?: unknown[] } | null
        ok = Boolean(parsed && Array.isArray(parsed.layers) && parsed.layers.length)
      } catch {
        ok = false
      }
      if (!ok) {
        issues.push({
          id: `sticker:${clip.id}`,
          severity: 'error',
          clipId: clip.id,
          message: `The imported sticker on “${clip.name}” is not a Lottie file this player can read.`,
          hint: 'Export it from After Effects with Bodymovin, without images or expressions.',
        })
      }
    }
  }

  for (const clip of texts) {
    const box = textBox(clip)
    const outside =
      box.left < SAFE_MARGIN - 0.001 ||
      box.right > 1 - SAFE_MARGIN + 0.001 ||
      box.top < SAFE_MARGIN - 0.001 ||
      box.bottom > 1 - SAFE_MARGIN + 0.001
    if (outside) {
      issues.push({
        id: `safe:${clip.id}`,
        severity: 'warning',
        clipId: clip.id,
        message: `“${clip.text.slice(0, 28)}” sits in the outer 5% of the frame.`,
        hint: 'It is nudged back in when rendered — move it yourself if the exact position matters.',
        fix: { label: 'Centre it', patch: { x: 0.5 } as Partial<StudioClip> },
      })
    }

    if (clip.fontSizePct < 3.5) {
      issues.push({
        id: `tiny:${clip.id}`,
        severity: 'warning',
        clipId: clip.id,
        message: `“${clip.text.slice(0, 28)}” is small enough to be unreadable on a phone.`,
        fix: { label: 'Set to 6%', patch: { fontSizePct: 6 } as Partial<StudioClip> },
      })
    }
  }

  // Two captions on screen, on the same track, in the same place: the renderer
  // draws them straight through each other.
  for (let i = 0; i < texts.length; i += 1) {
    for (let j = i + 1; j < texts.length; j += 1) {
      const a = texts[i]
      const b = texts[j]
      if (a.track !== b.track) continue
      if (!timeOverlap(a, b)) continue
      const ba = textBox(a)
      const bb = textBox(b)
      const overlaps = ba.left < bb.right && bb.left < ba.right && ba.top < bb.bottom && bb.top < ba.bottom
      if (!overlaps) continue
      issues.push({
        id: `collide:${a.id}:${b.id}`,
        severity: 'warning',
        clipId: b.id,
        message: `“${a.text.slice(0, 20)}” and “${b.text.slice(0, 20)}” are on screen together and overlap.`,
        hint: 'Move one of them, put them on different tracks, or shorten the first.',
      })
    }
  }

  // Holes in the timeline read as black frames in the export.
  const visible = doc.clips
    .filter((c) => c.kind !== 'audio')
    .map((c) => ({ start: c.startSec, end: clipEnd(c) }))
    .sort((a, b) => a.start - b.start)
  const total = doc.clips.reduce((max, c) => Math.max(max, clipEnd(c)), 0)
  let covered = 0
  for (const span of visible) {
    if (span.start > covered + 0.12) {
      issues.push({
        id: `gap:${covered.toFixed(2)}`,
        severity: 'warning',
        message: `Nothing is on screen between ${covered.toFixed(1)}s and ${span.start.toFixed(1)}s.`,
        hint: 'The export shows the stage background there — fine if that is what you meant.',
      })
    }
    covered = Math.max(covered, span.end)
  }
  if (total > 120.001) {
    issues.push({
      id: 'too-long',
      severity: 'error',
      message: `The timeline runs ${total.toFixed(1)}s — longer than the 120s render limit.`,
    })
  }

  return issues
}
