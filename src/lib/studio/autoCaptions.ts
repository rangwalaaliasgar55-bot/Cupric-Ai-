/**
 * 2.5 — auto-captions from a clip's own audio, with real timings.
 *
 * Desktop: main extracts the clip's audio (FFmpeg) and transcribes it
 * offline. Whisper gives per-word times; Windows Speech gives per-phrase
 * times, and the result says which. The browser build has no offline
 * engine, so it says so and keeps the paste-a-transcript path.
 */
import { getIpc } from '../bridge'
import type { StudioAudioClip, StudioDoc, StudioMediaClip, StudioTextClip } from '../../types/project'
import { getMedia } from './media'
import { captionsFromTranscript } from './textTools'

export type TimedWord = { word: string; start: number; end: number }
export type Transcription = { engine: 'whisper' | 'windows'; timing: 'word' | 'phrase'; words: TimedWord[] }

/**
 * Source-file seconds → timeline seconds for one clip, honouring trim and
 * speed; words outside the clip's used range are dropped.
 */
export function wordsToTimeline(words: TimedWord[], clip: StudioMediaClip | StudioAudioClip): TimedWord[] {
  const speed = clip.kind === 'video' && clip.speed > 0 ? clip.speed : 1
  const srcIn = clip.trimInSec
  const srcOut = srcIn + clip.durationSec * speed
  const toT = (s: number) => clip.startSec + (s - srcIn) / speed
  return words
    .filter((w) => w.end > srcIn && w.start < srcOut)
    .map((w) => ({ word: w.word, start: toT(Math.max(srcIn, w.start)), end: toT(Math.min(srcOut, w.end)) }))
}

/** Timed words (timeline seconds) → caption clips on a new top track. */
export function captionsForClip(doc: StudioDoc, clip: StudioMediaClip | StudioAudioClip, words: TimedWord[], maxWords = 4): { doc: StudioDoc; captions: StudioTextClip[] } {
  const timed = wordsToTimeline(words, clip)
  if (!timed.length) return { doc, captions: [] }
  const track = Math.min(23, doc.trackCount)
  const captions = captionsFromTranscript('', { startSec: 0, durationSec: 0, track, maxWords, words: timed })
  // The words stay on the source clip (source seconds): speech tightening and
  // word-timed components read them later, through any trim or split.
  const clips = doc.clips.map((c) => (c.id === clip.id ? ({ ...c, words: words.map((w) => ({ word: w.word, start: w.start, end: w.end })) } as typeof c) : c))
  return { doc: { ...doc, trackCount: Math.min(24, Math.max(doc.trackCount, track + 1)), clips: [...clips, ...captions] }, captions }
}

export async function transcribeMediaPath(path: string, lang = 'en'): Promise<Transcription> {
  const ipc = getIpc()
  if (!ipc) throw new Error('Auto-captions from audio need the desktop app (offline Whisper runs there). Paste a transcript below instead.')
  if (!path) throw new Error('This clip has no file on disk (downloaded or packaged), so its audio cannot be read. Re-import it from disk.')
  return (await ipc.invoke('voice:transcribeMedia', { path, lang })) as Transcription
}

export async function transcribeClip(clip: StudioMediaClip | StudioAudioClip, lang = 'en'): Promise<Transcription> {
  const path = getMedia(clip.mediaId)?.localPath ?? (clip as { localPath?: string | null }).localPath ?? ''
  return transcribeMediaPath(path, lang)
}
