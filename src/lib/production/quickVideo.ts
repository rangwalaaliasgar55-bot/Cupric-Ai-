/**
 * Quick Video: topic → script → search terms → stock footage → voiceover →
 * subtitles → music → an editable Studio doc.
 *
 * The pipeline design and settings are ported (concepts only, rewritten in
 * TypeScript) from MoneyPrinterTurbo by harry0703, MIT © 2024 Harry:
 * https://github.com/harry0703/MoneyPrinterTurbo (app/models/schema.py
 * VideoParams, app/services/{llm,task,video,subtitle}.py).
 *
 * Everything here is pure and deterministic: variants come from seeded
 * mulberry32, never an unseeded RNG or the clock, so the same settings always
 * build the same timeline, and preview and export use the same doc.
 */
import type { StudioAspect, StudioAudioClip, StudioCaptionStyle, StudioClip, StudioDoc, StudioMediaClip, StudioTextClip, StudioTimingSource } from '../../types/project'
import { planCaptionLines } from '../studio/textTools'

export const QUICK_VIDEO_SOURCE = { name: 'MoneyPrinterTurbo', url: 'https://github.com/harry0703/MoneyPrinterTurbo', license: 'MIT', attribution: 'MIT © 2024 Harry (harry0703)' } as const

export type QuickConcatMode = 'sequential' | 'random'
export type QuickSubtitlePosition = 'top' | 'center' | 'bottom' | 'two-thirds' | 'custom'
export type QuickProvider = 'openverse' | 'pexels' | 'pixabay' | 'picsum'
export type QuickLanguage = 'en' | 'hi'

export type QuickVideoSettings = {
  topic: string
  /** When non-empty, used as-is instead of drafting one (MPT "custom script"). */
  script: string
  language: QuickLanguage
  paragraphs: number
  extraPrompt: string
  aspect: StudioAspect
  fit: 'cover' | 'contain'
  concat: QuickConcatMode
  /** Longest a single footage clip plays, in seconds (MPT video_clip_duration). */
  clipMaxSec: number
  /** Keep footage in script order (MPT match_materials_to_script). */
  matchScriptOrder: boolean
  termCount: number
  provider: QuickProvider
  mediaKind: 'video' | 'image'
  voice: 'tts' | 'none'
  voiceRate: number
  voiceVolume: number
  bgmVolume: number
  subtitles: boolean
  subtitlePosition: QuickSubtitlePosition
  subtitleCustomY: number
  subtitleStyle: StudioCaptionStyle
  subtitleColor: string
  subtitleSizePct: number
  subtitleMaxChars: number
  /**
   * When the offline voiceover is generated, transcribe it back to get real
   * word times for the subtitles (desktop only; one extra offline Whisper pass).
   * Off, or in the browser build, the subtitles are timed from the script's own
   * estimate — and every caption clip says so (`timingSource: 'even'`).
   */
  wordTimings: boolean
  variants: number
  seed: number
}

export const DEFAULT_QUICK_SETTINGS: QuickVideoSettings = {
  topic: '', script: '', language: 'en', paragraphs: 1, extraPrompt: '',
  aspect: '9:16', fit: 'cover', concat: 'random', clipMaxSec: 4, matchScriptOrder: false, termCount: 5,
  provider: 'openverse', mediaKind: 'image', voice: 'tts', voiceRate: 0, voiceVolume: 1, bgmVolume: 0.2,
  subtitles: true, subtitlePosition: 'bottom', subtitleCustomY: 0.7, subtitleStyle: 'standard', subtitleColor: '#FFFFFF', subtitleSizePct: 6, subtitleMaxChars: 32,
  wordTimings: true, variants: 1, seed: 1,
}

export const ASPECT_PRESETS: Array<{ aspect: StudioAspect; label: string; size: string; use: string }> = [
  { aspect: '9:16', label: 'Portrait 9:16', size: '1080×1920', use: 'Shorts, Reels, TikTok' },
  { aspect: '16:9', label: 'Landscape 16:9', size: '1920×1080', use: 'YouTube' },
  { aspect: '1:1', label: 'Square 1:1', size: '1080×1080', use: 'Feed posts' },
  { aspect: '4:5', label: 'Portrait 4:5', size: '1080×1350', use: 'Instagram feed' },
]

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
const num = (v: unknown, d: number, lo: number, hi: number) => (typeof v === 'number' && Number.isFinite(v) ? clamp(v, lo, hi) : d)
const pick = <T extends string>(v: unknown, allowed: readonly T[], d: T): T => (allowed.includes(v as T) ? (v as T) : d)
const str = (v: unknown, d: string, max: number) => (typeof v === 'string' ? v.slice(0, max) : d)
const r2 = (n: number) => Math.round(n * 100) / 100

/** Allowlisted parse: unknown keys are dropped, values clamped. Never carries keys or secrets. */
export function sanitizeSettings(raw: unknown): QuickVideoSettings {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const d = DEFAULT_QUICK_SETTINGS
  return {
    topic: str(o.topic, d.topic, 300), script: str(o.script, d.script, 6000),
    language: pick(o.language, ['en', 'hi'] as const, d.language),
    paragraphs: Math.round(num(o.paragraphs, d.paragraphs, 1, 5)), extraPrompt: str(o.extraPrompt, d.extraPrompt, 1000),
    aspect: pick(o.aspect, ['9:16', '16:9', '1:1', '4:5'] as const, d.aspect), fit: pick(o.fit, ['cover', 'contain'] as const, d.fit),
    concat: pick(o.concat, ['sequential', 'random'] as const, d.concat), clipMaxSec: num(o.clipMaxSec, d.clipMaxSec, 1, 10),
    matchScriptOrder: typeof o.matchScriptOrder === 'boolean' ? o.matchScriptOrder : d.matchScriptOrder,
    termCount: Math.round(num(o.termCount, d.termCount, 1, 10)),
    provider: pick(o.provider, ['openverse', 'pexels', 'pixabay', 'picsum'] as const, d.provider), mediaKind: pick(o.mediaKind, ['video', 'image'] as const, d.mediaKind),
    voice: pick(o.voice, ['tts', 'none'] as const, d.voice), voiceRate: Math.round(num(o.voiceRate, d.voiceRate, -5, 5)),
    voiceVolume: num(o.voiceVolume, d.voiceVolume, 0, 1), bgmVolume: num(o.bgmVolume, d.bgmVolume, 0, 1),
    subtitles: typeof o.subtitles === 'boolean' ? o.subtitles : d.subtitles,
    subtitlePosition: pick(o.subtitlePosition, ['top', 'center', 'bottom', 'two-thirds', 'custom'] as const, d.subtitlePosition),
    subtitleCustomY: num(o.subtitleCustomY, d.subtitleCustomY, 0.05, 0.95),
    subtitleStyle: pick(o.subtitleStyle, ['hormozi', 'standard', 'minimal'] as const, d.subtitleStyle),
    subtitleColor: typeof o.subtitleColor === 'string' && /^#[0-9a-f]{6}$/i.test(o.subtitleColor) ? o.subtitleColor : d.subtitleColor,
    subtitleSizePct: num(o.subtitleSizePct, d.subtitleSizePct, 3, 14), subtitleMaxChars: Math.round(num(o.subtitleMaxChars, d.subtitleMaxChars, 12, 60)),
    wordTimings: typeof o.wordTimings === 'boolean' ? o.wordTimings : d.wordTimings,
    variants: Math.round(num(o.variants, d.variants, 1, 5)), seed: Math.round(num(o.seed, d.seed, 1, 2 ** 31 - 1)),
  }
}

/** Export/import generation settings (MPT "import/export settings"). */
export function exportSettings(s: QuickVideoSettings): string {
  return JSON.stringify({ kind: 'newbrand.quickVideo', version: 1, settings: sanitizeSettings(s) }, null, 2)
}
export function importSettings(text: string): QuickVideoSettings {
  const parsed = JSON.parse(text) as { kind?: string; settings?: unknown }
  if (parsed?.kind !== 'newbrand.quickVideo') throw new Error('Not a NewBrand Quick Video settings file')
  return sanitizeSettings(parsed.settings)
}

/** Prompt for a live model; structure follows MPT build_script_prompt. */
export function scriptPrompt(s: QuickVideoSettings): string {
  return [
    '# Role: Short-form video script writer',
    '## Constraints:',
    '1. Return only the narration text: no titles, markdown, scene labels or stage directions.',
    '2. Open with a hook in the first sentence; keep sentences short and speakable.',
    '3. Never invent statistics, quotes or testimonials.',
    `4. Write exactly ${s.paragraphs} paragraph${s.paragraphs > 1 ? 's' : ''}.`,
    '# Initialization:',
    `- video subject: ${s.topic.trim()}`,
    `- language: ${s.language === 'hi' ? 'Hindi (Devanagari)' : 'English'}`,
    ...(s.extraPrompt.trim() ? ['# Additional User Requirements:', s.extraPrompt.trim()] : []),
  ].join('\n')
}

/** Clean a model reply down to narration text (strip fences, markdown, labels). */
export function cleanScript(reply: string): string {
  return reply.replace(/```[a-z]*\n?|```/gi, '').replace(/^\s*(#+|\*\*|[-*]\s+)/gm, '').replace(/\*\*/g, '')
    .replace(/^\s*(scene|narrator|voiceover|vo)\s*\d*\s*:\s*/gim, '').replace(/\n{3,}/g, '\n\n').trim()
}

/**
 * Offline draft when no live model is configured. It is a clearly-structured
 * template built from the topic only — no facts are invented; the user edits it.
 */
export function draftScript(s: QuickVideoSettings): string {
  const t = s.topic.trim() || 'your topic'
  if (s.language === 'hi') {
    const p = [`${t} के बारे में एक बात जो ज़्यादातर लोग नहीं जानते।`, `पहले समझिए कि ${t} क्यों मायने रखता है।`, `फिर एक आसान कदम जो आप आज उठा सकते हैं।`, `ऐसी और वीडियो के लिए फ़ॉलो करें।`]
    return chunk(p, s.paragraphs)
  }
  const p = [`Here is what most people miss about ${t}.`, `First, why ${t} matters to you right now.`, `Then one simple step you can take today.`, `Follow for more on ${t}.`]
  return chunk(p, s.paragraphs)
}
function chunk(sentences: string[], paragraphs: number): string {
  const per = Math.ceil(sentences.length / paragraphs)
  const out: string[] = []
  for (let i = 0; i < sentences.length; i += per) out.push(sentences.slice(i, i + per).join(' '))
  return out.join('\n\n')
}

const STOP = new Set('a an the and or but of to in on at for with from by is are was were be been it its this that these those you your we our they their i me my he she his her as not no so if then than there here what which who how why when where most people miss right now one simple step can take today follow more about first matters just very really into out up down over also will would could should do does did have has had get got'.split(' '))

/** Deterministic keyword → stock search terms (1–3 words, always tied to the subject). */
export function searchTerms(topic: string, script: string, amount = 5, ordered = false): string[] {
  const subject = topic.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter((w) => w && !STOP.has(w)).slice(0, 2).join(' ')
  const words = script.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter((w) => w.length > 3 && !STOP.has(w) && !subject.split(' ').includes(w))
  const counts = new Map<string, { n: number; first: number }>()
  words.forEach((w, i) => { const c = counts.get(w); if (c) c.n += 1; else counts.set(w, { n: 1, first: i }) })
  let keys = [...counts.entries()]
  keys = ordered ? keys.sort((a, b) => a[1].first - b[1].first) : keys.sort((a, b) => b[1].n - a[1].n || a[1].first - b[1].first)
  const terms = keys.slice(0, Math.max(0, amount - 1)).map(([w]) => (subject ? `${subject} ${w}` : w).split(' ').slice(0, 3).join(' '))
  const all = subject ? (ordered ? [subject, ...terms] : [subject, ...terms]) : terms
  return [...new Set(all)].slice(0, amount).length ? [...new Set(all)].slice(0, amount) : ['abstract background']
}

/** Words-per-second speaking estimate, adjusted by the TTS rate step (−5…+5). */
export function estimateNarrationSec(script: string, language: QuickLanguage, rate = 0): number {
  const words = script.trim().split(/\s+/).filter(Boolean).length
  const wps = (language === 'hi' ? 2.2 : 2.6) * (1 + rate * 0.08)
  return r2(Math.max(3, words / Math.max(0.5, wps)))
}

/** Split narration into subtitle lines at punctuation, then by max characters. */
export function splitSubtitles(script: string, maxChars = 32): string[] {
  const sentences = script.replace(/\s+/g, ' ').split(/(?<=[.!?।,;:])\s+/).map((x) => x.trim()).filter(Boolean)
  const lines: string[] = []
  for (const s of sentences) {
    let cur = ''
    for (const w of s.split(' ')) {
      if (cur && (cur + ' ' + w).length > maxChars) { lines.push(cur); cur = w } else cur = cur ? `${cur} ${w}` : w
    }
    if (cur) lines.push(cur)
  }
  return lines
}

/** Time lines proportionally to their length across the narration (MPT's no-word-timing fallback). */
export function timeSubtitles(lines: string[], totalSec: number, startSec = 0): Array<{ text: string; startSec: number; durationSec: number }> {
  const weights = lines.map((l) => Math.max(4, l.length))
  const sum = weights.reduce((a, b) => a + b, 0) || 1
  let t = startSec
  return lines.map((text, i) => {
    const d = (weights[i] / sum) * totalSec
    const item = { text, startSec: r2(t), durationSec: r2(d) }
    t += d
    return item
  })
}

export function mulberry32(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Seeds for N batch variants (MPT video_count), derived from the base seed. */
export function variantSeeds(count: number, base: number): number[] {
  const rnd = mulberry32(base)
  return Array.from({ length: clamp(Math.round(count), 1, 5) }, (_, i) => (i === 0 ? base : 1 + Math.floor(rnd() * 2 ** 30)))
}

export type QuickMedia = { mediaId: string; fileName: string; localPath: string | null; kind: 'video' | 'image'; durationSec: number; term: string; posterDataUrl?: string | null }
export type FootageSlot = { media: QuickMedia; startSec: number; durationSec: number; trimInSec: number }

/**
 * Cover the narration with footage: each clip plays at most clipMaxSec; the
 * pool repeats if needed (MPT combine_videos). `random` shuffles with the seed.
 */
export function planFootage(media: QuickMedia[], totalSec: number, clipMaxSec: number, concat: QuickConcatMode, seed: number): FootageSlot[] {
  if (!media.length || totalSec <= 0) return []
  const rnd = mulberry32(seed)
  const order = [...media]
  if (concat === 'random') for (let i = order.length - 1; i > 0; i -= 1) { const j = Math.floor(rnd() * (i + 1)); [order[i], order[j]] = [order[j], order[i]] }
  const slots: FootageSlot[] = []
  const uses = new Map<string, number>()
  let t = 0
  let i = 0
  while (t < totalSec - 0.01 && slots.length < 400) {
    const m = order[i % order.length]
    const used = uses.get(m.mediaId) ?? 0
    const maxLen = m.kind === 'video' && m.durationSec > 0 ? Math.min(clipMaxSec, m.durationSec) : clipMaxSec
    const d = Math.min(maxLen, totalSec - t)
    const trimInSec = m.kind === 'video' && m.durationSec > maxLen ? r2(((used * clipMaxSec) % Math.max(0.01, m.durationSec - maxLen))) : 0
    slots.push({ media: m, startSec: r2(t), durationSec: r2(Math.max(0.2, d)), trimInSec })
    uses.set(m.mediaId, used + 1)
    t += d
    i += 1
  }
  return slots
}

export function subtitleY(s: QuickVideoSettings): number {
  return s.subtitlePosition === 'top' ? 0.14 : s.subtitlePosition === 'center' ? 0.5 : s.subtitlePosition === 'two-thirds' ? 0.67 : s.subtitlePosition === 'custom' ? s.subtitleCustomY : 0.84
}

export type QuickAudio = { mediaId: string; fileName: string; localPath: string | null; durationSec: number }

/** One spoken word on the timeline, in seconds (from a transcription of the voiceover). */
export type QuickWord = { word: string; start: number; end: number }

/**
 * What the subtitles in a built doc are timed by — read from the clips, not from
 * what the caller intended, so the run log and the task history can never claim
 * more precision than the timeline actually has.
 */
export function captionTimingOf(doc: StudioDoc): { source: StudioTimingSource; exact: number; approximate: number; label: string } | null {
  const subs = doc.clips.filter((c): c is StudioTextClip => c.kind === 'text' && /-sub-\d+$/.test(c.id))
  if (!subs.length) return null
  const exact = subs.filter((c) => c.timingSource === 'word').length
  const approximate = subs.length - exact
  const source: StudioTimingSource = subs.some((c) => c.timingSource === 'phrase') ? 'phrase' : exact ? 'word' : 'even'
  const label = source === 'word'
    ? `real word times (${exact} of ${subs.length} captions)`
    : source === 'phrase'
      ? 'phrase times from the voice engine — words inside a phrase are approximate'
      : 'estimated from the script — no word timings'
  return { source, exact, approximate, label }
}

/** Compose the editable Studio doc. Ids are derived from the seed so rebuilds are stable. */
export function buildQuickDoc(base: StudioDoc, s: QuickVideoSettings, script: string, media: QuickMedia[], opts: { voice?: QuickAudio | null; music?: QuickAudio | null; seed?: number; words?: QuickWord[] | null } = {}): StudioDoc {
  const seed = opts.seed ?? s.seed
  const total = opts.voice?.durationSec ? r2(opts.voice.durationSec) : estimateNarrationSec(script, s.language, s.voiceRate)
  const clips: StudioClip[] = []
  const id = (p: string, i: number) => `qv-${seed}-${p}-${i}`
  planFootage(media, total, s.clipMaxSec, s.concat, seed).forEach((slot, i) => {
    const m = slot.media
    const clip: StudioMediaClip = {
      id: id('shot', i), kind: m.kind, track: 0, startSec: slot.startSec, durationSec: slot.durationSec, name: `${m.term}`.slice(0, 28),
      transitionIn: i === 0 ? 'none' : 'fade', transitionOut: 'none', opacity: 1, mediaId: m.mediaId, fileName: m.fileName, localPath: m.localPath,
      trimInSec: slot.trimInSec, sourceDurationSec: m.durationSec || slot.durationSec, speed: 1, volume: 0, fit: s.fit, x: 0.5, y: 0.5, scale: 1, posterDataUrl: m.posterDataUrl ?? null,
    }
    clips.push(clip)
  })
  if (s.subtitles) {
    // Real word times (when the voiceover was transcribed) decide the caption
    // boundaries and the per-word reveals; without them the script's own
    // estimate is used and every clip is labelled `even` so nothing downstream
    // can mistake it for a measurement.
    const spoken = opts.words?.length ? opts.words.filter((w) => w.end > 0 && w.start < total + 0.5) : null
    const lines: Array<{ text: string; startSec: number; durationSec: number; wordDelaysMs: number[] | null; timingSource: StudioTimingSource }> =
      spoken?.length
        ? planCaptionLines('', { startSec: 0, durationSec: total, maxWords: 4, maxChars: s.subtitleMaxChars, words: spoken })
        : timeSubtitles(splitSubtitles(script, s.subtitleMaxChars), total).map((line) => ({ ...line, wordDelaysMs: null, timingSource: 'even' as const }))
    lines.forEach((line, i) => {
      const clip: StudioTextClip = {
        id: id('sub', i), kind: 'text', track: 1, startSec: line.startSec, durationSec: Math.max(0.3, line.durationSec), name: `Sub · ${line.text.slice(0, 18)}`,
        transitionIn: 'none', transitionOut: 'none', opacity: 1, text: line.text, fontSizePct: s.subtitleSizePct, fontFamily: 'Inter Variable', color: s.subtitleColor,
        weight: 800, align: 'center', x: 0.5, y: subtitleY(s), anim: (line.wordDelaysMs ? 'word-reveal' : 'none') as StudioTextClip['anim'], captionStyle: s.subtitleStyle, highlightWord: null,
        timingSource: line.timingSource,
        ...(line.wordDelaysMs ? { wordDelaysMs: line.wordDelaysMs } : {}),
      }
      clips.push(clip)
    })
  }
  const audio = (a: QuickAudio, track: number, role: 'voice' | 'music', vol: number, i: number): StudioAudioClip => ({
    id: id(role, i), kind: 'audio', track, startSec: 0, durationSec: role === 'voice' ? r2(a.durationSec) : total, name: role === 'voice' ? 'Voiceover' : 'Music',
    transitionIn: 'none', transitionOut: 'none', opacity: 1, mediaId: a.mediaId, fileName: a.fileName, localPath: a.localPath, trimInSec: 0,
    sourceDurationSec: a.durationSec, volume: vol, fadeInSec: role === 'music' ? 0.5 : 0, fadeOutSec: role === 'music' ? 1 : 0, role,
  })
  if (opts.voice) clips.push(audio(opts.voice, 2, 'voice', s.voiceVolume, 0))
  if (opts.music) clips.push(audio(opts.music, 3, 'music', s.bgmVolume, 0))
  const credit = { url: QUICK_VIDEO_SOURCE.url, source: 'Quick Video pipeline (after MoneyPrinterTurbo)', sourceLicense: 'MIT', attribution: QUICK_VIDEO_SOURCE.attribution }
  const credits = [...(base.credits ?? []).filter((c) => c.url !== credit.url), credit]
  return { ...base, aspect: s.aspect, clips, trackCount: Math.max(base.trackCount, opts.music ? 4 : opts.voice ? 3 : 2), ducking: opts.voice && opts.music ? { enabled: true, amountDb: -12, fadeSec: 0.3 } : base.ducking, credits }
}

/** Task history (MPT task list), newest first, capped. */
export type QuickTask = { id: string; at: string; topic: string; variants: number; clips: number; durationSec: number; status: 'done' | 'failed'; note: string; settings: QuickVideoSettings }
export function pushTask(history: QuickTask[], task: QuickTask, cap = 20): QuickTask[] {
  return [task, ...history.filter((t) => t.id !== task.id)].slice(0, cap)
}
export function parseHistory(raw: string | null): QuickTask[] {
  try {
    const arr = JSON.parse(raw || '[]')
    return Array.isArray(arr) ? arr.filter((t) => t && typeof t.id === 'string').map((t) => ({ ...t, settings: sanitizeSettings(t.settings) })).slice(0, 20) : []
  } catch { return [] }
}

/**
 * Batch variants: variant 1 becomes the live timeline; every variant is also
 * saved as a scene (different seeded footage order) so "Export every scene"
 * renders them all with the same renderer.
 */
export function buildQuickVariants(base: StudioDoc, s: QuickVideoSettings, script: string, media: QuickMedia[], opts: { voice?: QuickAudio | null; music?: QuickAudio | null; words?: QuickWord[] | null } = {}): StudioDoc {
  const seeds = variantSeeds(s.variants, s.seed)
  const { scenes: _drop, ...plain } = base
  const docs = seeds.map((seed) => buildQuickDoc(plain as StudioDoc, s, script, media, { ...opts, seed }))
  const first = docs[0]
  if (seeds.length === 1) return { ...first, scenes: base.scenes }
  const scenes = [...(base.scenes ?? []), ...docs.map((d, i) => {
    const { scenes: _s, ...snap } = d
    return { id: `qv-scene-${seeds[i]}`, name: `Quick video · variant ${i + 1}`, savedAt: new Date(0).toISOString(), doc: snap }
  })]
  return { ...first, scenes }
}
