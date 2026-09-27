/**
 * Output formats by channel: story reels, feed posts, Ultra HD, custom.
 * A preset sets aspect + resolution + fps on the doc (one undo step); the
 * exporter reads `sizeForAspect(doc.aspect, doc.resolution)`.
 */
import type { StudioAspect, StudioDoc, StudioResolution } from '../../types/project'
import { sizeForAspect } from './doc'

export type ChannelPreset = { id: string; label: string; group: 'Social' | 'Video' | 'Ultra HD'; aspect: StudioAspect; resolution: StudioResolution; fps: 24 | 30 | 60; maxSec?: number; note?: string }

export const CHANNEL_PRESETS: ChannelPreset[] = [
  { id: 'ig-reel', label: 'Instagram Reel', group: 'Social', aspect: '9:16', resolution: '1080p', fps: 30, maxSec: 180 },
  { id: 'ig-story', label: 'Instagram Story', group: 'Social', aspect: '9:16', resolution: '1080p', fps: 30, maxSec: 60, note: 'Keep text inside the social safe area.' },
  { id: 'ig-feed', label: 'Instagram feed (4:5)', group: 'Social', aspect: '4:5', resolution: '1080p', fps: 30, note: 'The profile grid crops to 3:4 — keep the subject centred.' },
  { id: 'tiktok', label: 'TikTok', group: 'Social', aspect: '9:16', resolution: '1080p', fps: 30, maxSec: 600 },
  { id: 'yt-shorts', label: 'YouTube Shorts', group: 'Social', aspect: '9:16', resolution: '1080p', fps: 60, maxSec: 180 },
  { id: 'linkedin', label: 'LinkedIn / Facebook square', group: 'Social', aspect: '1:1', resolution: '1080p', fps: 30 },
  { id: 'x-post', label: 'X post', group: 'Social', aspect: '16:9', resolution: '1080p', fps: 30, maxSec: 140 },
  { id: 'yt', label: 'YouTube 1080p', group: 'Video', aspect: '16:9', resolution: '1080p', fps: 30 },
  { id: 'yt-1440', label: 'YouTube 1440p (2K)', group: 'Video', aspect: '16:9', resolution: '1440p', fps: 30 },
  { id: 'web-720', label: 'Web / email 720p', group: 'Video', aspect: '16:9', resolution: '720p', fps: 30 },
  { id: 'uhd', label: 'Ultra HD 4K (3840×2160)', group: 'Ultra HD', aspect: '16:9', resolution: '2160p', fps: 30, note: 'Heavy: turn on video proxies for smooth editing.' },
  { id: 'uhd-vertical', label: 'Ultra HD vertical (2160×3840)', group: 'Ultra HD', aspect: '9:16', resolution: '2160p', fps: 30 },
]

export function presetLabel(p: ChannelPreset): string {
  const [w, h] = sizeForAspect(p.aspect, p.resolution)
  return `${p.label} · ${w}×${h} · ${p.fps} fps`
}

/** The preset matching the doc's current settings, if any. */
export function matchingPreset(doc: Pick<StudioDoc, 'aspect' | 'resolution' | 'fps'>): ChannelPreset | null {
  return CHANNEL_PRESETS.find((p) => p.aspect === doc.aspect && p.resolution === (doc.resolution ?? '1080p') && p.fps === doc.fps) ?? null
}

/** Warnings for a doc against a preset (length limits etc.) — never silent. */
export function presetWarnings(p: ChannelPreset, durationSec: number): string[] {
  const out: string[] = []
  if (p.maxSec && durationSec > p.maxSec) out.push(`${p.label} allows up to ${p.maxSec}s — this edit is ${Math.round(durationSec)}s.`)
  if (p.note) out.push(p.note)
  return out
}
