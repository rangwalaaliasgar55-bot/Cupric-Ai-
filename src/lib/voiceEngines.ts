/**
 * The renderer's side of installing a speech engine.
 *
 * Phase 1.4's complaint was that the app told people the engine was missing and
 * left them there. `electron/voice-install.cjs` does the downloading; this file
 * is the thin, typed, testable seam in front of it, plus the one genuinely
 * tricky decision: which readiness check can be repaired by which engine, and
 * what to show while a download is happening.
 *
 * Everything here mirrors a real result. There is no optimistic "installed"
 * state: `installVoiceEngine` returns whatever the main process saw on disk.
 */
import { getIpc } from './bridge'

export type VoiceEngineId = 'piper' | 'piper-model-en' | 'whisper' | 'voice-hi'

export type VoiceEngineInfo = {
  id: VoiceEngineId | string
  label: string
  detail: string
  installed: boolean
  /** Rough download size, shown before the person commits to it. */
  sizeHint?: string
  /** Installed by Windows itself, not by us — the button explains instead. */
  manual?: boolean
}

export type VoiceEngineList = {
  platform: string
  supported: boolean
  piperDir: string
  whisperDir: string
  engines: VoiceEngineInfo[]
}

export type InstallProgress = {
  engine: string
  label?: string
  phase: 'download' | 'extract' | 'done' | 'complete'
  name?: string
  index?: number
  count?: number
  received: number | null
  /** null when the server sent no Content-Length — never invented. */
  total: number | null
}

export type InstallResult =
  | { ok: true; id: string; engine: string; dir: string; installed: string[] }
  | { ok: false; id: string; stage: string; error: string; url?: string; status?: number }

/** Ask the main process what is installed. Null means "not the desktop app". */
export async function listVoiceEngines(): Promise<VoiceEngineList | null> {
  const ipc = getIpc()
  if (!ipc) return null
  try {
    return (await ipc.invoke('voice:engines')) as VoiceEngineList
  } catch (error) {
    // A failed probe must not read as "nothing installed" — that would send
    // someone downloading an engine they already have.
    throw new Error(`Could not read the speech engine list: ${String((error as Error)?.message || error)}`)
  }
}

/**
 * Install an engine, reporting real byte counts as they arrive.
 *
 * The returned unsubscribe is called by the caller on unmount; leaving the
 * listener attached across a re-probe would double-count progress.
 */
export async function installVoiceEngine(
  id: VoiceEngineId | string,
  onProgress?: (progress: InstallProgress) => void,
): Promise<InstallResult> {
  const ipc = getIpc()
  if (!ipc) return { ok: false, id, stage: 'platform', error: 'Speech engines can only be installed from the desktop app.' }
  let off: (() => void) | null = null
  if (onProgress) {
    off = ipc.on('voice:install:progress', (event: InstallProgress) => onProgress(event))
  }
  try {
    return (await ipc.invoke('voice:install', { id })) as InstallResult
  } catch (error) {
    return { ok: false, id, stage: 'ipc', error: String((error as Error)?.message || error) }
  } finally {
    off?.()
  }
}

/**
 * Which readiness checks a person can fix from inside the app.
 *
 * Keys are `ReadinessCheck.id` values from src/lib/readiness.ts. Anything not in
 * here has no in-app remedy, and the panel keeps showing its written remedy
 * rather than a button that would do nothing.
 */
export const INSTALLABLE_CHECKS: Record<string, { engine: VoiceEngineId; verb: string }> = {
  voiceover: { engine: 'piper', verb: 'Download Piper' },
  captions: { engine: 'whisper', verb: 'Download Whisper' },
}

export function installOfferFor(checkId: string, engineId: string | undefined): { engine: VoiceEngineId; verb: string } | null {
  const offer = INSTALLABLE_CHECKS[checkId]
  if (!offer) return null
  // The voiceover check can be satisfied by Piper *or* by a Windows voice. If
  // Piper is already here, the missing piece is the voice model, so offer that
  // instead of downloading the engine a second time.
  if (engineId === 'piper' && offer.engine === 'piper') return { engine: 'piper-model-en', verb: 'Download English voice' }
  return offer
}

/** Honest progress copy: a percentage only when the server gave a total. */
export function progressLabel(progress: InstallProgress | null): string {
  if (!progress) return ''
  if (progress.phase === 'extract') return 'Unpacking…'
  if (progress.phase === 'complete') return 'Done'
  const mb = (bytes: number) => `${(bytes / 1e6).toFixed(1)} MB`
  const received = progress.received ?? 0
  if (progress.total && progress.total > 0) {
    const pct = Math.max(0, Math.min(100, Math.round((received / progress.total) * 100)))
    return `${pct}% — ${mb(received)} of ${mb(progress.total)}`
  }
  return received > 0 ? `${mb(received)} downloaded — the server did not report a total size` : 'Starting…'
}

/** Fraction for a progress element, or null when the total is unknown. */
export function progressFraction(progress: InstallProgress | null): number | null {
  if (!progress?.total || progress.total <= 0) return null
  return Math.max(0, Math.min(1, (progress.received ?? 0) / progress.total))
}
