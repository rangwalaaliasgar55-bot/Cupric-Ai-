/**
 * Browser-side analysis feeding the pure auto-edit engine (autoEdit.ts).
 *  - analyseBeats: decode the music, mix to mono at ~22 kHz, detect beats.
 *  - analyseSubject: sample frames of a video and track where the subject
 *    is across the width — skin-tone pixels (faces, hands) weigh most, then
 *    motion. A heuristic, stated as such in the UI; no ML model, no network.
 */
import type { StudioAudioClip, StudioMediaClip } from '../../types/project'
import { detectBeats, type SubjectSample } from './autoEdit'
import { getMedia, loadVideo, seekTo } from './media'

export async function analyseBeats(clip: StudioAudioClip): Promise<{ bpm: number; times: number[] }> {
  const handle = getMedia(clip.mediaId)
  if (!handle) throw new Error('The music file is not loaded — relink it first.')
  const buf = await (await fetch(handle.url)).arrayBuffer()
  const Ctor = window.OfflineAudioContext || (window as unknown as { webkitOfflineAudioContext: typeof OfflineAudioContext }).webkitOfflineAudioContext
  const ctx = new Ctor(1, 1, 44100)
  const audio = await ctx.decodeAudioData(buf)
  const factor = Math.max(1, Math.round(audio.sampleRate / 22050))
  const len = Math.floor(audio.length / factor)
  const mono = new Float32Array(len)
  for (let ch = 0; ch < audio.numberOfChannels; ch += 1) {
    const data = audio.getChannelData(ch)
    for (let i = 0; i < len; i += 1) {
      let s = 0
      for (let k = 0; k < factor; k += 1) s += data[i * factor + k] || 0
      mono[i] += s / factor / audio.numberOfChannels
    }
  }
  const r = detectBeats(mono, audio.sampleRate / factor)
  if (!r.times.length) throw new Error('No steady beat was found in this audio.')
  return r
}

export async function analyseSubject(clip: StudioMediaClip, onProgress?: (pct: number) => void, fps = 3): Promise<{ samples: SubjectSample[]; srcW: number; srcH: number }> {
  const handle = getMedia(clip.mediaId)
  if (!handle || handle.kind !== 'video') throw new Error('The video file is not loaded — relink it first.')
  // A private element: never disturbs the preview or export elements.
  const video = await loadVideo(handle.url)
  const W = 96
  const H = Math.max(8, Math.round((W * video.videoHeight) / Math.max(1, video.videoWidth)))
  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('Canvas is unavailable.')
  const speed = clip.speed > 0 ? clip.speed : 1
  const from = clip.trimInSec
  const to = Math.min(video.duration || from + clip.durationSec * speed, from + clip.durationSec * speed)
  const samples: SubjectSample[] = []
  let prev: Uint8ClampedArray | null = null
  const steps = Math.max(2, Math.ceil((to - from) * fps))
  for (let i = 0; i <= steps; i += 1) {
    const t = from + ((to - from) * i) / steps
    await seekTo(video, Math.min(t, Math.max(0, (video.duration || t) - 0.05)))
    ctx.drawImage(video, 0, 0, W, H)
    const px = ctx.getImageData(0, 0, W, H).data
    let sum = 0, wx = 0
    for (let y = 0; y < H; y += 1) {
      for (let x = 0; x < W; x += 1) {
        const o = (y * W + x) * 4
        const r = px[o], g = px[o + 1], b = px[o + 2]
        // YCbCr skin rule (Chai & Ngan) — cheap and lighting-tolerant.
        const cb = 128 - 0.168736 * r - 0.331264 * g + 0.5 * b
        const cr = 128 + 0.5 * r - 0.418688 * g - 0.081312 * b
        const skin = cb >= 77 && cb <= 127 && cr >= 133 && cr <= 173 ? 1 : 0
        const motion = prev ? (Math.abs(r - prev[o]) + Math.abs(g - prev[o + 1]) + Math.abs(b - prev[o + 2])) / 765 : 0
        // Upper frame counts more: faces sit high.
        const w = (skin * 2 + motion * 3) * (1.2 - (0.4 * y) / H)
        sum += w
        wx += w * (x + 0.5)
      }
    }
    prev = px
    samples.push({ t, cx: sum > W * H * 0.004 ? wx / sum / W : samples.length ? samples[samples.length - 1].cx : 0.5, weight: sum })
    onProgress?.(Math.round((i / steps) * 100))
  }
  video.removeAttribute('src')
  video.load()
  return { samples, srcW: handle.width, srcH: handle.height }
}
