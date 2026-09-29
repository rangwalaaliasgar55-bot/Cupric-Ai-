/**
 * The gate chain Cupric runs before it calls an edit delivered.
 *
 * Ported from veedstudio/open-edit — `cli/src/wcag/policy.ts`, `windows.ts`,
 * `treat.ts`, `cli/src/safe-zone.ts` and `cli/src/commands/gates.ts`
 * (Apache-2.0, see THIRD_PARTY_NOTICES.md) — and adapted to Cupric's document
 * model: the background statistics come from frames Cupric itself renders, so the
 * gate measures the edit that will be exported rather than a model's opinion of
 * it.
 *
 * What is kept from upstream, because each of these is a bug avoided:
 *
 *  - **WCAG 2.2 thresholds**, including the large-text rule (≥24px, or ≥18.66px
 *    bold): one flat 4.5 would fail a big headline that is perfectly legible and
 *    pass a 14px caption that is not.
 *  - **The sliding one-second window.** A caption unreadable for a whole second is
 *    a real failure; a 200ms dip is sampling noise. Judging per instant is too
 *    harsh, pooling a whole run averages the bad second away — so a run fails iff
 *    SOME second of it fails.
 *  - **Fixes are evaluated analytically against the samples already taken.** A
 *    scrim is painted over the footage; it does not repaint the footage, so
 *    re-sampling to "see" the result measures a different question (and after a
 *    shadow exists the sampler reads background that was never behind the text).
 *  - **Stop at the first failed gate and name it.** A chain that reports "3 gates
 *    failed" without saying which one stopped it is how a run wanders.
 *  - **A correction budget.** Two corrections per gate, then stop and report: a
 *    run nobody is watching should not loop a fix forever.
 */
import type { StudioDoc, StudioTextClip } from '../../types/project'
import { lintStudioDoc, type DocIssue } from './lint'
import { safeZoneFor, insideZone, overflowOf, type Zone } from './safeZone'
import type { TextBox } from './textLayout'

/* ─────────────── WCAG 2.2 policy ─────────────── */

export type Level = 'AA' | 'AAA'
export interface Rgb { r: number; g: number; b: number }
export interface Rgba extends Rgb { a: number }
export interface RecCluster { color: Rgb; weight: number }

/** WCAG 2.2 "large text": ≥24px, or ≥18.66px when bold. */
export function isLargeText(fontSizePx: number, fontWeight: number): boolean {
  return fontSizePx >= 24 || (fontWeight >= 700 && fontSizePx >= 18.66)
}

export function thresholdFor(level: Level, fontSizePx: number, fontWeight: number): number {
  const large = isLargeText(fontSizePx, fontWeight)
  if (level === 'AA') return large ? 3 : 4.5
  return large ? 4.5 : 7
}

const srgbToLinear = (v: number) => {
  const s = v / 255
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
}

export function relativeLuminance(c: Rgb): number {
  return 0.2126 * srgbToLinear(c.r) + 0.7152 * srgbToLinear(c.g) + 0.0722 * srgbToLinear(c.b)
}

export function ratioFromLuminance(a: number, b: number): number {
  const hi = Math.max(a, b)
  const lo = Math.min(a, b)
  return (hi + 0.05) / (lo + 0.05)
}

export function contrastRatio(a: Rgb, b: Rgb): number {
  return ratioFromLuminance(relativeLuminance(a), relativeLuminance(b))
}

/** A translucent foreground over an opaque background, per WCAG's alpha compositing. */
export function composite(fg: Rgb, alpha: number, bg: Rgb): Rgb {
  const a = Math.min(1, Math.max(0, alpha))
  return { r: a * fg.r + (1 - a) * bg.r, g: a * fg.g + (1 - a) * bg.g, b: a * fg.b + (1 - a) * bg.b }
}

export function parseHex(hex: string): Rgb | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return null
  const body = m[1].length === 3 ? m[1].split('').map((c) => c + c).join('') : m[1]
  return { r: parseInt(body.slice(0, 2), 16), g: parseInt(body.slice(2, 4), 16), b: parseInt(body.slice(4, 6), 16) }
}

export function toHex(c: Rgb): string {
  const h = (n: number) => Math.round(Math.min(255, Math.max(0, n))).toString(16).padStart(2, '0')
  return `#${h(c.r)}${h(c.g)}${h(c.b)}`.toUpperCase()
}

/** HSL round-trip, so a recolor keeps the hue it was authored with. */
export function rgbToHsl(c: Rgb): { h: number; s: number; l: number } {
  const r = c.r / 255, g = c.g / 255, b = c.b / 255
  const max = Math.max(r, g, b), min = Math.min(r, g, b)
  const l = (max + min) / 2
  if (max === min) return { h: 0, s: 0, l }
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  let h = 0
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6
  else if (max === g) h = ((b - r) / d + 2) / 6
  else h = ((r - g) / d + 4) / 6
  return { h, s, l }
}

export function hslToRgb({ h, s, l }: { h: number; s: number; l: number }): Rgb {
  if (s === 0) return { r: l * 255, g: l * 255, b: l * 255 }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s
  const p = 2 * l - q
  const f = (t: number) => {
    let x = t
    if (x < 0) x += 1
    if (x > 1) x -= 1
    if (x < 1 / 6) return p + (q - p) * 6 * x
    if (x < 1 / 2) return q
    if (x < 2 / 3) return p + (q - p) * (2 / 3 - x) * 6
    return p
  }
  return { r: f(h + 1 / 3) * 255, g: f(h) * 255, b: f(h - 1 / 3) * 255 }
}

/**
 * WCAG's own relative luminance needs the *composited* colour, and a caption's
 * ink is usually opaque — the alpha here is the clip's fade-in, so a block that
 * is still fading is scored as it actually looks.
 */
export function inkOver(inkHex: string, alpha: number, bg: Rgb): Rgb {
  const ink = parseHex(inkHex)
  if (!ink) return bg
  return composite(ink, alpha, bg)
}

/* ─────────────── samples: the colour behind each text block ─────────────── */

export interface ElementSample {
  clipId: string
  /** Seconds on the timeline this frame sits at. */
  tSec: number
  /** How much of the text box the ink covers (0–1). Used to weight failure by the area a reader loses. */
  coverage: number
  /** Ink colours the block wore in this frame, and the alpha of each. */
  inks: Array<{ hex: string; alpha: number }>
  /** Font size and weight, which is what the threshold depends on. */
  fontSizePx: number
  fontWeight: number
  /** The colours the block sat over, weight-normalised (from `sampleBackground`). */
  clusters: RecCluster[]
}

export interface ElementVerdict {
  clipId: string
  /** Lowest ratio any cluster gave any ink colour. */
  worstRatio: number
  /** Fraction of the sampled area that is below the threshold, weighted by colour mass. */
  failureMass: number
  threshold: number
  passes: boolean
  worstCluster: RecCluster | null
  /** Per-second detail, so a report can name the second that failed. */
  windows: Array<{ from: number; to: number; worstRatio: number; passes: boolean }>
}

export const DEFAULT_AUDIT_FPS = 5

/** What the sampler should read behind the text. */
export type SampleMode = 'ring' | 'interior'
export interface SampleOptions {
  /** `ring` (default) reads the band around the box; `interior` reads the box itself. */
  mode?: SampleMode
  /** Band outside the box, in pixels, that the ring samples. */
  bandPx?: number
  /** Interior coverage mask (255 = glyph). Interior sampling skips covered pixels. */
  mask?: Uint8Array
  /** Max clusters kept; the rest fold into their nearest neighbour. */
  maxClusters?: number
}

/** 4 bits per channel: enough to tell two backgrounds apart, cheap enough to run on a render. */
const quantize = (c: Rgb): string => `${c.r >> 4},${c.g >> 4},${c.b >> 4}`

function cluster(pixels: Rgb[], maxClusters: number): RecCluster[] {
  const buckets = new Map<string, { color: Rgb; weight: number }>()
  for (const p of pixels) {
    const key = quantize(p)
    const hit = buckets.get(key)
    if (hit) {
      hit.weight += 1
      continue
    }
    buckets.set(key, { color: p, weight: 1 })
  }
  const list = [...buckets.values()].sort((a, b) => b.weight - a.weight).slice(0, maxClusters)
  const total = list.reduce((n, c) => n + c.weight, 0) || 1
  return list.map((c) => ({ color: c.color, weight: c.weight / total }))
}

/**
 * The colour behind a text block, read from a frame that was already rendered.
 *
 * Two sources, chosen by what is available:
 *  - `interior` — pixels inside the box the glyph mask says are NOT ink. Exact,
 *    and what the desktop and the export path can afford.
 *  - `ring` — pixels in a band around the box. A composition with a plate or a
 *    scrim behind the text is uniform there, so the ring is the same answer for
 *    a fraction of the work — and it cannot mistake the glyphs themselves for
 *    the background, which is the failure mode of sampling a bare box.
 */
export function sampleBackground(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  box: { x: number; y: number; w: number; h: number },
  opts: SampleOptions = {},
): RecCluster[] {
  const band = Math.max(1, Math.round(opts.bandPx ?? 8))
  const maxClusters = Math.max(2, Math.min(12, opts.maxClusters ?? 6))
  const left = Math.max(0, Math.floor(box.x - box.w / 2))
  const right = Math.min(width - 1, Math.ceil(box.x + box.w / 2))
  const top = Math.max(0, Math.floor(box.y - box.h / 2))
  const bottom = Math.min(height - 1, Math.ceil(box.y + box.h / 2))
  const pixels: Rgb[] = []
  // Sample on a grid rather than every pixel: the answer is a distribution, and a
  // 4K frame has twenty thousand samples in one caption box.
  const step = Math.max(1, Math.round(Math.min(box.w, box.h) / 48))
  const maskWidth = Math.max(1, right - left + 1)

  const push = (x: number, y: number) => {
    const i = (y * width + x) * 4
    if (i < 0 || i + 3 >= rgba.length) return
    if (rgba[i + 3] < 8) return
    pixels.push({ r: rgba[i], g: rgba[i + 1], b: rgba[i + 2] })
  }

  const readInterior = () => {
    for (let y = top; y <= bottom; y += step) {
      for (let x = left; x <= right; x += step) {
        // With a coverage mask the glyph pixels are skipped: what is left is the
        // ground the text actually sits on.
        if (opts.mask && opts.mask[(y - top) * maskWidth + (x - left)] > 8) continue
        push(x, y)
      }
    }
  }

  const readRing = () => {
    for (let y = Math.max(0, top - band); y <= Math.min(height - 1, bottom + band); y += step) {
      for (let x = Math.max(0, left - band); x <= Math.min(width - 1, right + band); x += step) {
        if (x >= left && x <= right && y >= top && y <= bottom) continue
        push(x, y)
      }
    }
  }

  if (opts.mode === 'interior') {
    readInterior()
    if (!pixels.length) readRing()
  } else {
    readRing()
    if (!pixels.length) readInterior()
  }

  if (!pixels.length) return [{ color: { r: 0, g: 0, b: 0 }, weight: 1 }]
  return cluster(pixels, maxClusters)
}

/** Verdict for one block, over every sampled frame. Implements the sliding-window policy. */
export function judgeElement(samples: ElementSample[], level: Level = 'AA', auditFps = DEFAULT_AUDIT_FPS): ElementVerdict | null {
  if (!samples.length) return null
  const first = samples[0]
  const threshold = thresholdFor(level, first.fontSizePx, first.fontWeight)

  const perFrame = samples.map((s) => {
    let worst = Infinity
    let worstCluster: RecCluster | null = null
    let mass = 0
    for (const clusterStat of s.clusters) {
      for (const ink of s.inks) {
        const ratio = contrastRatio(inkOver(ink.hex, ink.alpha, clusterStat.color), clusterStat.color)
        if (ratio < worst) {
          worst = ratio
          worstCluster = clusterStat
        }
        if (ratio < threshold) mass += clusterStat.weight / Math.max(1, s.inks.length)
      }
    }
    return { tSec: s.tSec, ratio: Number.isFinite(worst) ? worst : 21, mass: Math.min(1, mass), worstCluster }
  })

  // Sliding one-second windows: every sampled frame belongs to at least one full
  // window, so no frame at the tail is orphaned.
  const size = Math.max(1, Math.round(auditFps))
  const windows: Array<{ from: number; to: number; worstRatio: number; passes: boolean }> = []
  const stepFrames = Math.max(1, Math.round(size / 2))
  for (let i = 0; i < perFrame.length; i += stepFrames) {
    const slice = perFrame.slice(i, i + size)
    if (slice.length < Math.min(size, perFrame.length)) break
    const worst = Math.min(...slice.map((f) => f.ratio))
    windows.push({ from: slice[0].tSec, to: slice[slice.length - 1].tSec, worstRatio: worst, passes: worst >= threshold })
    if (i + size >= perFrame.length) break
  }
  if (!windows.length) {
    const worst = Math.min(...perFrame.map((f) => f.ratio))
    windows.push({ from: first.tSec, to: perFrame[perFrame.length - 1].tSec, worstRatio: worst, passes: worst >= threshold })
  }

  const worstFrame = perFrame.reduce((worst, f) => (f.ratio < worst.ratio ? f : worst), perFrame[0])
  return {
    clipId: first.clipId,
    worstRatio: Math.round(worstFrame.ratio * 100) / 100,
    failureMass: Math.round(perFrame.reduce((m, f) => Math.max(m, f.mass), 0) * 1000) / 1000,
    threshold,
    passes: windows.every((w) => w.passes),
    worstCluster: worstFrame.worstCluster,
    windows,
  }
}

/* ─────────────── fixes, evaluated analytically ─────────────── */

export type FixKind = 'recolor' | 'scrim'

export interface Fix {
  kind: FixKind
  /** Ink colour after the fix (recolor) or the plate colour (scrim). */
  color: string
  /** Plate alpha for a scrim fix. */
  plateAlpha?: number
  /** The worst ratio the fix is guaranteed against the sampled clusters. */
  guaranteedRatio: number
  /** True when every sampled cluster clears the threshold with this fix. */
  guaranteed: boolean
  /** How much of the frame the fix changes (0–1) — the tie-breaker between fixes. */
  cost: number
}

/**
 * Hue-preserving recolor: walk the ink's lightness (in HSL) until every sampled
 * cluster clears the threshold. This is the `hue_preserving` strategy upstream
 * tries first — it keeps the design's palette and changes only how light the ink
 * is, which is the least visible fix that can work.
 */
export function recolorFix(clusters: RecCluster[], inkHex: string, threshold: number): Fix | null {
  const ink = parseHex(inkHex)
  if (!ink || !clusters.length) return null
  const hsl = rgbToHsl(ink)
  for (let step = 0; step <= 20; step++) {
    for (const direction of hsl.l <= 0.5 ? [1, -1] : [-1, 1]) {
      const l = Math.min(1, Math.max(0, hsl.l + direction * step * 0.04))
      const candidate = hslToRgb({ ...hsl, l })
      let worst = Infinity
      for (const c of clusters) worst = Math.min(worst, contrastRatio(candidate, c.color))
      if (worst >= threshold) {
        return {
          kind: 'recolor',
          color: toHex(candidate),
          guaranteedRatio: Math.round(worst * 100) / 100,
          guaranteed: true,
          cost: Math.abs(l - hsl.l),
        }
      }
    }
  }
  return null
}

/**
 * Plate (scrim) behind the block: find the smallest alpha of `plateHex` that
 * lifts every cluster over the threshold. Painted over the footage, so the
 * evaluation composes it against the samples already taken.
 */
export function scrimFix(clusters: RecCluster[], inkHex: string, threshold: number, plateHex = '#0B0B10'): Fix | null {
  const plate = parseHex(plateHex)
  const ink = parseHex(inkHex)
  if (!plate || !ink || !clusters.length) return null
  for (let alpha = 0.1; alpha <= 0.951; alpha += 0.05) {
    let worst = Infinity
    for (const c of clusters) {
      const behind = composite(plate, alpha, c.color)
      worst = Math.min(worst, contrastRatio(ink, behind))
    }
    if (worst >= threshold) {
      return {
        kind: 'scrim',
        color: toHex(plate),
        plateAlpha: Math.round(alpha * 100) / 100,
        guaranteedRatio: Math.round(worst * 100) / 100,
        guaranteed: true,
        cost: Math.round(alpha * 100) / 100,
      }
    }
  }
  return null
}

/**
 * The fix to take: whichever is least visible among those that fully clear the
 * bar. A recolor that changes the palette a hair beats a scrim that dulls a
 * quarter of the frame — but only while it actually passes.
 */
export function recommendFix(samples: ElementSample[], level: Level = 'AA'): Fix | null {
  if (!samples.length) return null
  const clusters = samples.flatMap((s) => s.clusters)
  const worstThreshold = samples.reduce((max, s) => Math.max(max, thresholdFor(level, s.fontSizePx, s.fontWeight)), 0)
  const inks = samples.flatMap((s) => s.inks.map((i) => i.hex))
  const options: Fix[] = []
  for (const ink of new Set(inks)) {
    const recolor = recolorFix(clusters, ink, worstThreshold)
    if (recolor) options.push(recolor)
  }
  for (const ink of new Set(inks)) {
    const scrim = scrimFix(clusters, ink, worstThreshold)
    if (scrim) options.push(scrim)
  }
  if (!options.length) return null
  options.sort((a, b) => (a.kind === b.kind ? a.cost - b.cost : a.kind === 'recolor' ? -1 : 1))
  return options[0]
}

/* ─────────────── timing: what is drawn, and when ─────────────── */

/**
 * The gate upstream calls `expect-windows` (open-edit's
 * `cli/src/commands/expect-windows.ts`, Apache-2.0 — see THIRD_PARTY_NOTICES.md).
 *
 * Every other gate in this file judges **what** is drawn, so a caption that
 * arrives a second late, holds long after its last word, or is still on screen
 * when the next one lands passes all of them. Those are the corrections a viewer
 * actually notices, and they are decidable from the document alone — no frames,
 * no engine statistics — so this gate costs nothing to run.
 *
 * The rules, each with the numbers behind it:
 *
 *   reveal-past-end  a word revealed after the block ends never appears
 *   missing-delays   fewer delays than words: the trailing words never appear
 *   delay-order      delays that go backwards hold words back
 *   hold             a timed block outliving its last word by more than maxHold
 *   late-reveal      a timed block sitting up this long before its first word
 *   overlap          two text blocks on one track sharing screen time
 */
export const TIMING_DEFAULTS = {
  /** A block may sit up this long before its first word before it counts as late. */
  maxLeadSec: 1.2,
  /** How long a timed block may outlive its own last word. */
  maxHoldSec: 3,
  /** Two blocks on one track may butt-join, but not share more than this. */
  minOverlapSec: 0.05,
}

export interface TimingOptions {
  maxLeadSec?: number
  maxHoldSec?: number
  minOverlapSec?: number
}

const round3 = (n: number) => Math.round(n * 1000) / 1000
const wordCountOf = (text: string) => text.split(/\s+/).filter(Boolean).length

/** Text blocks per track, in time order. A hidden block is not on screen. */
function textByTrack(doc: StudioDoc): StudioTextClip[][] {
  const byTrack = new Map<number, StudioTextClip[]>()
  for (const clip of doc.clips) {
    if (clip.kind !== 'text' || clip.hidden) continue
    const list = byTrack.get(clip.track) ?? []
    list.push(clip)
    byTrack.set(clip.track, list)
  }
  for (const list of byTrack.values()) list.sort((a, b) => a.startSec - b.startSec)
  return [...byTrack.values()]
}

export function timingGate(doc: StudioDoc, opts: TimingOptions = {}): GateFinding[] {
  const cfg = { ...TIMING_DEFAULTS, ...opts }
  const findings: GateFinding[] = []
  const frameSec = 1 / (doc.fps > 0 ? doc.fps : 30)

  for (const clip of doc.clips) {
    if (clip.kind !== 'text' || clip.hidden) continue
    const delays = (clip.wordDelaysMs ?? []).filter((d) => Number.isFinite(d))
    if (!delays.length) continue
    const words = wordCountOf(clip.text)
    const first = Math.min(...delays)
    const last = Math.max(...delays)

    if (words > delays.length) {
      findings.push({
        gate: 'timing',
        id: 'timing:missing-delays',
        severity: 'error',
        clipId: clip.id,
        message: `\u201C${clip.name}\u201D has ${delays.length} word timing(s) for ${words} word(s): the last ${words - delays.length} never appear.`,
        hint: 'The reveal is indexed by word, so a short list stops early \u2014 re-time the block (auto-captions) or shorten its text.',
        detail: { words, delays: delays.length },
      })
    }
    for (let i = 1; i < delays.length; i += 1) {
      if (delays[i] < delays[i - 1]) {
        findings.push({
          gate: 'timing',
          id: 'timing:delay-order',
          severity: 'warning',
          clipId: clip.id,
          message: `\u201C${clip.name}\u201D reveals its words out of order (${delays[i - 1]} ms then ${delays[i]} ms), so a later word can appear before an earlier one.`,
          hint: 'Delays are read in order; re-time the block from its transcript.',
          detail: { index: i, before: delays[i - 1], after: delays[i] },
        })
        break
      }
    }

    const lastSec = last / 1000
    if (lastSec > clip.durationSec - frameSec) {
      findings.push({
        gate: 'timing',
        id: 'timing:reveal-past-end',
        severity: 'error',
        clipId: clip.id,
        message: `\u201C${clip.name}\u201D ends at ${round3(clip.durationSec)}s but its last word is revealed at ${round3(lastSec)}s, so that word is never seen.`,
        hint: 'Extend the block to fit its last word, or re-time it.',
        fix: { label: 'Hold to fit the last word', patch: { durationSec: round3(lastSec + 0.3) } },
        detail: { endSec: round3(clip.durationSec), lastRevealSec: round3(lastSec) },
      })
    } else if (clip.durationSec - lastSec > cfg.maxHoldSec) {
      findings.push({
        gate: 'timing',
        id: 'timing:hold',
        severity: 'warning',
        clipId: clip.id,
        message: `\u201C${clip.name}\u201D stays up for ${round3(clip.durationSec - lastSec)}s after its last word.`,
        hint: 'A long hold reads as a stuck caption; cut it back or let the next block carry the time.',
        fix: { label: `Trim to ${round3(lastSec + 0.9)}s`, patch: { durationSec: round3(lastSec + 0.9) } },
        detail: { holdSec: round3(clip.durationSec - lastSec) },
      })
    }
    if (first / 1000 > cfg.maxLeadSec) {
      findings.push({
        gate: 'timing',
        id: 'timing:late-reveal',
        severity: 'warning',
        clipId: clip.id,
        message: `\u201C${clip.name}\u201D is on screen for ${round3(first / 1000)}s before its first word appears.`,
        hint: 'Start the block with its first word, or keep the lead-in deliberately.',
        detail: { leadSec: round3(first / 1000) },
      })
    }
  }

  for (const list of textByTrack(doc)) {
    for (let i = 0; i + 1 < list.length; i += 1) {
      const a = list[i]
      const b = list[i + 1]
      const overlap = a.startSec + a.durationSec - b.startSec
      if (overlap <= cfg.minOverlapSec) continue
      const last = Math.max(0, ...(a.wordDelaysMs ?? []).filter((d) => Number.isFinite(d)))
      const trimmed = b.startSec - a.startSec
      const safe = trimmed >= 0.35 && last / 1000 <= trimmed - frameSec
      findings.push({
        gate: 'timing',
        id: 'timing:overlap',
        severity: 'warning',
        clipId: a.id,
        message: `\u201C${a.name}\u201D and \u201C${b.name}\u201D are both on screen for ${round3(overlap)}s.`,
        hint: safe
          ? 'Trim the earlier block to where the later one starts, or move one of them.'
          : 'Two captions at once is a decision, not a default \u2014 move or shorten one.',
        ...(safe ? { fix: { label: `Trim to ${round3(trimmed)}s`, patch: { durationSec: round3(trimmed) } } } : {}),
        detail: { overlapSec: round3(overlap), other: b.name },
      })
    }
  }
  return findings
}

/* ─────────────── the gates ─────────────── */

export type GateName = 'lint' | 'timing' | 'safezones' | 'contrast' | 'deliver'

export interface GateFinding {
  gate: GateName
  id: string
  severity: 'error' | 'warning'
  message: string
  hint?: string
  clipId?: string
  /** A one-click correction, when one exists. */
  fix?: { label: string; patch: Partial<StudioTextClip> }
  /** Measured numbers behind the finding, for the report (never for a claim). */
  detail?: Record<string, number | string | boolean | null>
}

export interface GateReport {
  ok: boolean
  /** The gate that stopped the chain, when one did. */
  stoppedAt: GateName | null
  findings: GateFinding[]
  /** Every gate that ran, in order, with what it cost. */
  ran: Array<{ gate: GateName; ok: boolean; findings: number; ms: number }>
  contrast: { elements: ElementVerdict[]; sampled: number; passes: boolean }
  safeZones: { aspect: string; zone: Zone; checked: number; passes: boolean }
  /** Timing: how many timed blocks were judged and whether they all held. */
  timing: { blocks: number; passes: boolean }
  summary: string
}

export interface GateInput {
  doc: StudioDoc
  /** Frames the caller rendered: pixels plus the boxes each text block occupied. */
  frames: Array<{
    tSec: number
    width: number
    height: number
    rgba: Uint8ClampedArray
    boxes: TextBox[]
    /** Optional glyph coverage per box, for exact interior sampling. */
    masks?: Record<string, Uint8Array>
  }>
  level?: Level
  /** Skip a gate by name (a silent render has no loudness to check, etc.). */
  skip?: GateName[]
  /** Delivery facts, when the caller has them (desktop FFmpeg). */
  delivery?: DeliveryFindings
  /** Media existence check for the lint gate. */
  hasMedia?: (mediaId: string) => boolean
  /**
   * Cap on how long the chain may run, in ms. Undefined means as long as it
   * needs; 0 means no time at all, which stops at the first gate it reaches.
   */
  budgetMs?: number
}

export type DeliveryFindings = {
  file: string
  durationSec: number
  width: number
  height: number
  fps: number
  hasAudio: boolean
  loudness: { integratedLufs: number; truePeakDb: number | null; rangeLu: number | null } | null
  sync: Array<{ tSec: number; offsetFrames: number | null }>
  findings: string[]
}

export const LOUDNESS_TARGET = { integratedLufs: -14, truePeakDb: -1, rangeLu: 11 }

function safeZoneGate(doc: StudioDoc, frames: GateInput['frames']): { findings: GateFinding[]; zone: Zone; checked: number } {
  const zone = safeZoneFor(doc.aspect)
  const findings: GateFinding[] = []
  const seen = new Set<string>()
  let checked = 0
  const width = frames[0]?.width ?? 1080
  const height = frames[0]?.height ?? 1920
  for (const frame of frames) {
    for (const box of frame.boxes) {
      const clip = doc.clips.find((c) => c.id === box.clipId)
      if (!clip || clip.kind !== 'text' || clip.hidden) continue
      checked += 1
      if (seen.has(box.clipId)) continue
      const normalized = {
        x: (box.x + box.w / 2) / width,
        y: (box.y + box.h / 2) / height,
        w: box.w / width,
        h: box.h / height,
      }
      if (!insideZone(normalized, zone, 0.002)) {
        const over = overflowOf(normalized, zone)
        seen.add(box.clipId)
        findings.push({
          gate: 'safezones',
          id: `safezone:${box.clipId}`,
          severity: 'warning',
          clipId: box.clipId,
          message: `“${clip.name}” reaches outside the platform-safe area: ${[
            over.left > 0 ? `${Math.round(over.left * 100)}% past the left edge` : null,
            over.right > 0 ? `${Math.round(over.right * 100)}% past the right` : null,
            over.top > 0 ? `${Math.round(over.top * 100)}% past the top` : null,
            over.bottom > 0 ? `${Math.round(over.bottom * 100)}% under the bottom` : null,
          ].filter(Boolean).join(', ')}. Feeds and players cover that band with their own UI.`,
          hint: 'Nudge the block inside, or let Cupric do it — the fix moves it to the nearest inside position at the same size.',
          detail: { left: over.left, right: over.right, top: over.top, bottom: over.bottom },
          fix: {
            label: 'Move it inside the safe area',
            patch: {
              x: Math.min(1 - zone.x1 + normalized.w / 2, Math.max(zone.x0 + normalized.w / 2, normalized.x)),
              y: Math.min(zone.y1 - normalized.h / 2, Math.max(zone.y0 + normalized.h / 2, normalized.y)),
            },
          },
        })
      }
    }
  }
  return { findings, zone, checked }
}

function contrastGate(
  doc: StudioDoc,
  frames: GateInput['frames'],
  level: Level,
): { findings: GateFinding[]; elements: ElementVerdict[]; sampled: number } {
  const findings: GateFinding[] = []
  const byClip = new Map<string, ElementSample[]>()
  let sampled = 0
  for (const frame of frames) {
    for (const box of frame.boxes) {
      const clip = doc.clips.find((c) => c.id === box.clipId)
      if (!clip || clip.kind !== 'text' || clip.hidden) continue
      const rect = { x: box.x, y: box.y, w: box.w, h: box.h }
      const mask = frame.masks?.[box.clipId]
      const clusters = sampleBackground(frame.rgba, frame.width, frame.height, rect, {
        mask,
        mode: mask ? 'interior' : 'ring',
        bandPx: Math.max(6, Math.round(box.fontSizePx * 0.35)),
      })
      sampled += 1
      const list = byClip.get(box.clipId) ?? []
      list.push({
        clipId: box.clipId,
        tSec: frame.tSec,
        coverage: 1,
        inks: box.colors.map((hex) => ({ hex, alpha: 1 })),
        fontSizePx: box.fontSizePx,
        fontWeight: box.fontWeight,
        clusters,
      })
      byClip.set(box.clipId, list)
    }
  }

  const elements: ElementVerdict[] = []
  for (const [clipId, samples] of byClip) {
    const verdict = judgeElement(samples, level)
    if (!verdict) continue
    elements.push(verdict)
    if (verdict.passes) continue
    const clip = doc.clips.find((c) => c.id === clipId)
    if (!clip || clip.kind !== 'text') continue
    const fix = recommendFix(samples, level)
    const worstSecond = verdict.windows.filter((w) => !w.passes).sort((a, b) => a.worstRatio - b.worstRatio)[0]
    findings.push({
      gate: 'contrast',
      id: `contrast:${clipId}`,
      severity: 'error',
      clipId,
      message: `“${clip.name}” falls below WCAG ${level} where it sits over the picture: worst ${verdict.worstRatio}:1 against a required ${verdict.threshold}:1${worstSecond ? ` (${worstSecond.from.toFixed(1)}–${worstSecond.to.toFixed(1)}s)` : ''}.`,
      hint: fix
        ? `Cupric measured the pixels behind the text and can fix it without guessing: ${fix.kind === 'recolor' ? `move the ink to ${fix.color}` : `paint a ${Math.round((fix.plateAlpha ?? 0) * 100)}% plate behind it`} (${fix.guaranteedRatio}:1 against every sampled colour).`
        : 'Every sampled colour failed: raise the scrim, or put the text on a plate of its own.',
      detail: {
        worstRatio: verdict.worstRatio,
        threshold: verdict.threshold,
        failureMass: verdict.failureMass,
        worstCluster: verdict.worstCluster ? toHex(verdict.worstCluster.color) : null,
        fix: fix?.kind ?? 'none',
      },
      ...(fix
        ? {
            fix: fix.kind === 'recolor'
              ? { label: `Use ${fix.color}`, patch: { color: fix.color } as Partial<StudioTextClip> }
              : { label: `Add a ${Math.round((fix.plateAlpha ?? 0) * 100)}% plate`, patch: { legibility: 'on' as const, scrimStrength: fix.plateAlpha } as Partial<StudioTextClip> },
          }
        : {}),
    })
  }
  return { findings, elements, sampled }
}

function deliveryGate(delivery: DeliveryFindings | undefined): GateFinding[] {
  if (!delivery) return []
  const findings: GateFinding[] = []
  const { loudness } = delivery
  if (!delivery.hasAudio) {
    findings.push({
      gate: 'deliver',
      id: 'deliver:silent',
      severity: 'warning',
      message: 'The delivered file has no audio stream. Fine for a type-led piece; a mistake if this was a talking-head edit.',
      hint: 'If it should have sound, mux the source audio before delivering.',
    })
  }
  if (loudness) {
    const off = Math.abs(loudness.integratedLufs - LOUDNESS_TARGET.integratedLufs)
    if (off > 1) {
      findings.push({
        gate: 'deliver',
        id: 'deliver:loudness',
        severity: 'warning',
        message: `Delivered loudness is ${loudness.integratedLufs.toFixed(1)} LUFS; the social target is ${LOUDNESS_TARGET.integratedLufs} LUFS ±1.`,
        hint: 'Cupric normalises on mux when the desktop pipeline produces the file — this report means it was skipped or overridden.',
        detail: { integratedLufs: loudness.integratedLufs, target: LOUDNESS_TARGET.integratedLufs },
      })
    }
    if (loudness.truePeakDb !== null && loudness.truePeakDb > LOUDNESS_TARGET.truePeakDb + 0.1) {
      findings.push({
        gate: 'deliver',
        id: 'deliver:truepeak',
        severity: 'error',
        message: `True peak is ${loudness.truePeakDb.toFixed(1)} dBTP (limit ${LOUDNESS_TARGET.truePeakDb} dBTP): platforms will clip it.`,
        detail: { truePeakDb: loudness.truePeakDb },
      })
    }
  }
  const slipped = delivery.sync
    .map((sample) => ({ tSec: sample.tSec, offset: sample.offsetFrames }))
    .filter((sample): sample is { tSec: number; offset: number } => sample.offset !== null && Math.abs(sample.offset) > 1)
  if (slipped.length) {
    findings.push({
      gate: 'deliver',
      id: 'deliver:sync',
      severity: 'error',
      message: `Picture is off the source by ${slipped.map((sample) => `${sample.offset > 0 ? '+' : ''}${sample.offset} frame(s) at ${sample.tSec.toFixed(1)}s`).join(', ')}.`,
      hint: 'A cut landed between frames, or the retime ran against unsnapped ranges.',
      detail: { samples: slipped.length },
    })
  }
  for (const note of delivery.findings) {
    findings.push({ gate: 'deliver', id: `deliver:${note.slice(0, 24)}`, severity: 'warning', message: note })
  }
  return findings
}

/**
 * Run the chain: lint → timing → safe zones → contrast → deliver. Stops at the
 * first gate with an error and names it; warnings ride along in the report.
 */
export function runGates(input: GateInput): GateReport {
  const level = input.level ?? 'AA'
  const skip = new Set(input.skip ?? [])
  const findings: GateFinding[] = []
  const ran: GateReport['ran'] = []
  let stoppedAt: GateName | null = null
  let contrast: GateReport['contrast'] = { elements: [], sampled: 0, passes: true }
  let timing: GateReport['timing'] = { blocks: 0, passes: true }
  let safeZones: GateReport['safeZones'] = { aspect: input.doc.aspect, zone: safeZoneFor(input.doc.aspect), checked: 0, passes: true }
  const started = Date.now()

  const step = (gate: GateName, fn: () => GateFinding[]) => {
    if (stoppedAt || skip.has(gate)) return
    if (input.budgetMs !== undefined && Date.now() - started >= input.budgetMs) {
      stoppedAt = gate
      findings.push({ gate, id: `${gate}:budget`, severity: 'warning', message: `The gate chain ran out of its time budget before ${gate}.`, hint: 'Raise the budget or shrink the sample count; the report says exactly how far it got.' })
      return
    }
    const t0 = Date.now()
    const produced = fn()
    findings.push(...produced)
    const blocked = produced.some((f) => f.severity === 'error')
    ran.push({ gate, ok: !blocked, findings: produced.length, ms: Date.now() - t0 })
    if (blocked) stoppedAt = gate
  }

  step('lint', () => lintStudioDoc(input.doc, { hasMedia: input.hasMedia }).map((issue: DocIssue) => ({
    gate: 'lint' as const,
    id: issue.id,
    severity: issue.severity === 'error' ? 'error' : 'warning',
    message: issue.message,
    ...(issue.hint ? { hint: issue.hint } : {}),
    ...(issue.clipId ? { clipId: issue.clipId } : {}),
  })))

  step('timing', () => {
    const produced = timingGate(input.doc)
    const blocks = input.doc.clips.filter((c) => c.kind === 'text' && !c.hidden && (c.wordDelaysMs?.length ?? 0) > 0).length
    timing = { blocks, passes: produced.length === 0 }
    return produced
  })

  step('safezones', () => {
    const result = safeZoneGate(input.doc, input.frames)
    safeZones = { aspect: input.doc.aspect, zone: result.zone, checked: result.checked, passes: result.findings.length === 0 }
    return result.findings
  })

  step('contrast', () => {
    const result = contrastGate(input.doc, input.frames, level)
    contrast = { elements: result.elements, sampled: result.sampled, passes: result.findings.length === 0 }
    return result.findings
  })

  step('deliver', () => deliveryGate(input.delivery))

  const errors = findings.filter((f) => f.severity === 'error')
  const summary = stoppedAt
    ? `Stopped at the ${stoppedAt} gate: ${errors.length} error(s), ${findings.length - errors.length} warning(s).`
    : findings.length
      ? `Passed every gate with ${findings.length} warning(s).`
      : 'Passed every gate.'
  return { ok: errors.length === 0, stoppedAt, findings, ran, contrast, safeZones, timing, summary }
}

/* ─────────────── the correction ledger ─────────────── */

/**
 * Two corrections per gate, then stop. The rule used to be prose ("at most
 * twice, then report"), and a run nobody was watching re-ran a whole chain five
 * times against one gate. Counted per gate, so the third failure says so itself;
 * a clean pass clears the count.
 */
export const GATE_BUDGET = 2

export type Ledger = Record<string, number>

export function recordFailure(ledger: Ledger, gate: GateName): number {
  const count = (ledger[gate] ?? 0) + 1
  ledger[gate] = count
  return count
}

export function clearGate(ledger: Ledger, gate: GateName): void {
  delete ledger[gate]
}

/** The line a third failure in a row adds. The count shapes the message, never the exit code. */
export function budgetLine(gate: GateName, count: number): string | null {
  return count > GATE_BUDGET
    ? `gates: failure ${count} in a row at ${gate} — the ${GATE_BUDGET} correction cycles are spent. Stop correcting and report this failure in plain terms, with the numbers behind it.`
    : null
}

/** Apply the one-click fixes a report proposed, as a single document edit. */
export function applyGateFixes(doc: StudioDoc, findings: GateFinding[]): { doc: StudioDoc; applied: number } {
  const patches = new Map<string, Partial<StudioTextClip>>()
  for (const finding of findings) {
    if (!finding.clipId || !finding.fix) continue
    patches.set(finding.clipId, { ...(patches.get(finding.clipId) ?? {}), ...finding.fix.patch })
  }
  if (!patches.size) return { doc, applied: 0 }
  return {
    doc: {
      ...doc,
      clips: doc.clips.map((clip) => (patches.has(clip.id) ? ({ ...clip, ...patches.get(clip.id) } as typeof clip) : clip)),
    },
    applied: patches.size,
  }
}
