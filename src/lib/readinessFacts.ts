/**
 * Gather the facts `readiness.ts` describes. Everything environment-shaped is
 * asked of the desktop main process when it is there; the browser build answers
 * what it can and says so.
 *
 * Nothing here writes, installs or fetches: it is a read-only look at the
 * machine, matching upstream's `readiness` command (no network calls).
 */
import type { StudioDoc } from '../types/project'
import { getIpc } from './bridge'
import { isConfigured as isOpenCodeConfigured, loadSettings as loadOpenCodeSettings } from './opencode'
import { getMedia } from './studio/media'
import type { ReadinessFacts } from './readiness'

interface MediaStatus { ffmpeg?: string | null; ffprobe?: string | null; ready?: boolean }
interface VoiceStatus { whisper?: boolean; windows?: boolean; engine?: string | null; whisperModel?: string | null; piper?: { en: boolean; hi: boolean } | null }
interface PublicSettings {
  hasKey?: boolean
  aiProvider?: string
  aiMode?: string
  statusDots?: { gemini?: string; zen?: string; local?: string }
  stock?: { pixabayConfigured?: boolean; pexelsConfigured?: boolean; proxyConfigured?: boolean }
}
interface StockKeyStatus { pixabay?: boolean; pexels?: boolean; proxy?: boolean }

/** Clips whose media is not loaded in this session — they render as nothing. */
export function missingMediaCount(doc: StudioDoc | null | undefined): number {
  if (!doc) return 0
  return doc.clips.filter((clip) => {
    const mediaId = (clip as { mediaId?: string }).mediaId
    return Boolean(mediaId) && !getMedia(mediaId)
  }).length
}

/**
 * Read the machine's capabilities. Every IPC call is individually guarded: a
 * missing handler (an older build) must not blank the whole report.
 */
export async function gatherReadinessFacts(doc: StudioDoc | null | undefined, opts: { renderable?: boolean } = {}): Promise<ReadinessFacts> {
  const clips = doc?.clips?.length ?? 0
  const missingMedia = missingMediaCount(doc)
  const ipc = getIpc()
  const base: ReadinessFacts = {
    desktop: Boolean(ipc),
    ffmpeg: false,
    ffprobe: false,
    whisper: false,
    windowsSpeech: false,
    whisperModel: null,
    piper: null,
    localModel: false,
    aiConfigured: false,
    stock: { pixabay: false, pexels: false, proxy: false },
    missingMedia,
    clips,
    renderable: opts.renderable ?? clips > 0,
    webDraft: !ipc,
  }
  if (!ipc) {
    // Browser build: the local-model settings live in localStorage, so a user
    // running Ollama against the web build still gets an honest answer.
    const local = loadOpenCodeSettings()
    const configured = isOpenCodeConfigured(local)
    return {
      ...base,
      aiConfigured: configured,
      localModel: configured && /localhost|127\.0\.0\.1|0\.0\.0\.0/i.test(local.baseUrl),
    }
  }

  const [media, voice, settings, stock] = await Promise.all([
    ipc.invoke('media:status').catch(() => null) as Promise<MediaStatus | null>,
    ipc.invoke('voice:status').catch(() => null) as Promise<VoiceStatus | null>,
    ipc.invoke('settings:get').catch(() => null) as Promise<PublicSettings | null>,
    ipc.invoke('stock:keyStatus').catch(() => null) as Promise<StockKeyStatus | null>,
  ])

  const provider = String(settings?.aiProvider ?? '')
  const reported = (settings as { provider?: { kind?: string; isLocal?: boolean; hasKey?: boolean } } | null)?.provider
  // A local model server counts as configured only when discovery actually saw
  // one (statusDots.local === 'ok'), not merely because a mode name says so.
  const localModel = Boolean(reported?.isLocal) || settings?.statusDots?.local === 'ok'
  // `template` reports a key as present because offline templates work — true,
  // but it is not a model answering, so it must not read as "AI configured".
  // `none` is the honest state: nothing is configured yet.
  const aiConfigured = provider !== 'template' && provider !== 'none' && Boolean(settings?.hasKey)

  return {
    ...base,
    desktop: true,
    webDraft: false,
    ffmpeg: Boolean(media?.ffmpeg),
    ffprobe: Boolean(media?.ffprobe),
    whisper: Boolean(voice?.whisper),
    windowsSpeech: Boolean(voice?.windows),
    whisperModel: voice?.whisperModel ?? null,
    piper: voice?.piper ?? null,
    localModel,
    aiConfigured: aiConfigured || localModel,
    stock: {
      pixabay: Boolean(stock?.pixabay ?? settings?.stock?.pixabayConfigured),
      pexels: Boolean(stock?.pexels ?? settings?.stock?.pexelsConfigured),
      proxy: Boolean(stock?.proxy ?? settings?.stock?.proxyConfigured),
    },
  }
}
