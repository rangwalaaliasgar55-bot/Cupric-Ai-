/**
 * What this machine can do, and what it is missing.
 *
 * Adapted from veedstudio/open-edit's `cli/src/commands/readiness.ts`
 * (Apache-2.0 — see THIRD_PARTY_NOTICES.md). Upstream's version reports what is
 * present versus what is still missing for a run, names the remedy beside every
 * miss, marks the non-blocking ones, is read-only and makes no network calls.
 * Its best detail is kept: a tool that exists but cannot start is diagnosed as
 * *not runnable* rather than as absent, because "install it" is the wrong advice
 * for a binary that is already there.
 *
 * The reason it matters in Cupric: the app degrades quietly by design. MP4 export
 * falls back to a WebM draft, auto-captions say the desktop engine is needed,
 * stock search runs keyless, and the AI layer falls back to a local model — all
 * correct, and all easy to mistake for the app being broken. Nothing told the
 * user which capabilities this machine actually has.
 *
 * `describeReadiness` is pure: the facts are gathered by whoever can gather them
 * (`gatherReadinessFacts` on the desktop, a browser-shaped subset elsewhere), so
 * the wording and the blocking rules are testable without Electron.
 */

export interface ReadinessFacts {
  /** Running inside the desktop app (IPC available). */
  desktop: boolean
  /** FFmpeg resolved *and* runnable (`media:status`). */
  ffmpeg: boolean
  ffprobe: boolean
  /** Offline speech: a whisper.cpp binary plus a model, or Windows Speech. */
  whisper: boolean
  windowsSpeech: boolean
  whisperModel: string | null
  /** Offline voiceover (Piper) models found, by language. */
  piper: { en: boolean; hi: boolean } | null
  /** An AI provider that needs no account (a local Ollama / LM Studio server). */
  localModel: boolean
  /** Any AI provider configured at all (key, or a local model). */
  aiConfigured: boolean
  /** Stock search keys. Optional by design — the keyless providers still work. */
  stock: { pixabay: boolean; pexels: boolean; proxy: boolean }
  /** Clips in the open project whose file is not loaded in this session. */
  missingMedia: number
  /** Clips in the open project, for the "is there anything to render" line. */
  clips: number
  /** Projects that can be rendered (a timeline, or a locked rundown). */
  renderable: boolean
  /** The browser build: no desktop engine, and it must be said. */
  webDraft?: boolean
}

export type ReadinessArea = 'export' | 'captions' | 'voice' | 'ai' | 'footage' | 'project'

export interface ReadinessCheck {
  id: string
  /** What it enables, in the user's words. */
  label: string
  area: ReadinessArea
  ok: boolean
  /** True when the thing it enables cannot work at all without it. */
  blocking: boolean
  detail: string
  /** What to do about it. Absent when nothing needs doing. */
  remedy?: string
  /** Set when something exists but cannot be used — the "present but broken" case. */
  broken?: boolean
}

export interface ReadinessReport {
  checks: ReadinessCheck[]
  /** Blocking checks that are not satisfied. */
  blocking: ReadinessCheck[]
  /** Optional checks that are not satisfied. */
  optional: ReadinessCheck[]
  /** Blocking checks that are satisfied. */
  ready: ReadinessCheck[]
  ok: boolean
  summary: string
}

const yes = (detail: string): Pick<ReadinessCheck, 'ok' | 'detail'> => ({ ok: true, detail })

/** Build the report. Pure: same facts in, same report out. */
export function describeReadiness(facts: ReadinessFacts): ReadinessReport {
  const checks: ReadinessCheck[] = []
  const add = (check: ReadinessCheck) => checks.push(check)

  add({
    id: 'desktop',
    label: 'The desktop app',
    area: 'export',
    blocking: true,
    ...(facts.desktop
      ? yes('Running with the full media engine available.')
      : {
          ok: false,
          detail: 'This is the browser build: exports are WebM drafts, auto-captions have no offline engine and files cannot be written to disk.',
          remedy: 'Install the desktop build for MP4 export, offline transcription and local voiceover.',
        }),
  })

  // A tool that is present but does not start is not "missing" — saying so is the
  // whole point of upstream's probeVersion-not-exists check.
  const ffmpegPresent = facts.ffmpeg || facts.ffprobe
  add({
    id: 'ffmpeg',
    label: 'MP4 export (FFmpeg)',
    area: 'export',
    blocking: true,
    ...(facts.ffmpeg && facts.ffprobe
      ? yes('FFmpeg and FFprobe are both runnable.')
      : ffmpegPresent
        ? {
            ok: false,
            broken: true,
            detail: `Found, but not both halves are runnable${facts.ffmpeg ? ' (FFprobe is missing)' : ' (FFmpeg is missing)'} — export would start and fail at the first file.`,
            remedy: 'Set CUPRIC_FFMPEG_PATH and CUPRIC_FFPROBE_PATH, or reinstall so the bundled binaries unpack.',
          }
        : {
            ok: false,
            detail: 'Not found, so the Studio records a WebM draft in the browser instead of writing an MP4.',
            remedy: 'Reinstall so ffmpeg-static and ffprobe-static unpack their binaries, or set CUPRIC_FFMPEG_PATH.',
          }),
  })

  const speechEngine = facts.whisper ? 'whisper.cpp (offline)' : facts.windowsSpeech ? 'Windows Speech (offline)' : null
  add({
    id: 'captions',
    label: 'Captions from a clip’s audio',
    area: 'captions',
    blocking: false,
    ...(speechEngine
      ? yes(`${speechEngine}${facts.whisper && facts.whisperModel ? ` — model ${facts.whisperModel}` : ''}.`)
      : {
          ok: false,
          detail: 'No offline recogniser found, so auto-captions fall back to typing or pasting a transcript.',
          remedy: 'Run npm run whisper:fetch, or drop a whisper.cpp build and a ggml model into <userData>/whisper.',
        }),
  })

  if (facts.desktop) {
    const langs = facts.piper ? [facts.piper.en ? 'English' : '', facts.piper.hi ? 'Hindi' : ''].filter(Boolean) : []
    add({
      id: 'voiceover',
      label: 'Offline voiceover (Piper)',
      area: 'voice',
      blocking: false,
      ...(langs.length
        ? yes(`${langs.join(' and ')} models are installed; the operating system voice is used for anything else.`)
        : {
            ok: false,
            detail: 'No Piper model found, so the system voice is used — fine for a rough cut, thinner for a finished one.',
            remedy: 'Add a Piper voice under <userData>/piper to narrate offline.',
          }),
    })
  }

  add({
    id: 'ai',
    label: 'Writing and planning (an AI provider)',
    area: 'ai',
    blocking: true,
    ...(facts.aiConfigured
      ? yes(facts.localModel ? 'A local model is answering, which costs nothing and needs no account.' : 'A configured provider is available.')
      : {
          ok: false,
          detail: 'No provider is set up, so scripts, briefs and agent edits cannot be generated.',
          remedy: 'Add a key in settings, or run a local model (Ollama / LM Studio) — that needs no account.',
        }),
  })

  add({
    id: 'stock',
    label: 'Stock footage search',
    area: 'footage',
    blocking: false,
    ...(facts.stock.pixabay || facts.stock.pexels || facts.stock.proxy
      ? yes(`${[facts.stock.pixabay ? 'Pixabay' : '', facts.stock.pexels ? 'Pexels' : '', facts.stock.proxy ? 'a proxy' : ''].filter(Boolean).join(', ')} configured — Openverse and Picsum also work keyless.`)
      : {
          ok: false,
          detail: 'No keys are set, so search uses the keyless providers (Openverse, Picsum) with their smaller, lower-resolution catalogues.',
          remedy: 'Add a Pixabay or Pexels key, or a stock proxy URL, to search the larger libraries.',
        }),
  })

  add({
    id: 'media',
    label: 'Every clip’s file',
    area: 'project',
    blocking: true,
    ...(facts.missingMedia
      ? {
          ok: false,
          detail: `${facts.missingMedia} clip(s) point at a file this session does not have loaded — they draw as blocks and render black.`,
          remedy: 'Relink them in the media panel (Studio → Media), or remove the clips.',
        }
      : yes('Every clip’s media is loaded.')),
  })

  add({
    id: 'timeline',
    label: 'Something to render',
    area: 'project',
    blocking: true,
    ...(facts.renderable
      ? yes(`The open project has ${facts.clips} clip(s).`)
      : {
          ok: false,
          detail: 'The open project has no timeline clips and no locked rundown, so a render would produce an empty video.',
          remedy: 'Add footage in the Studio, or lock a rundown in the Brief.',
        }),
  })

  const blocking = checks.filter((check) => check.blocking && !check.ok)
  const optional = checks.filter((check) => !check.blocking && !check.ok)
  const ready = checks.filter((check) => check.blocking && check.ok)
  const summary = blocking.length
    ? `${blocking.length} thing(s) would stop a run: ${blocking.map((check) => check.label).join(', ')}.`
    : optional.length
      ? `Ready to render. ${optional.length} optional item(s) would improve the result: ${optional.map((check) => check.label).join(', ')}.`
      : 'Ready: every capability this app can use is available.'
  return { checks, blocking, optional, ready, ok: blocking.length === 0, summary }
}

/** One line for a status area, without the checks. */
export function readinessLine(report: ReadinessReport): string {
  return report.ok ? (report.optional.length ? `Ready · ${report.optional.length} optional` : 'Ready') : `Not ready · ${report.blocking.length} blocking`
}

/**
 * What is missing, as the plain sentences a user can act on — the same strings
 * the panel shows, so an error path and the panel cannot drift apart.
 */
export function readinessRemedies(report: ReadinessReport): Array<{ label: string; remedy: string }> {
  return [...report.blocking, ...report.optional]
    .filter((check) => Boolean(check.remedy))
    .map((check) => ({ label: check.label, remedy: check.remedy as string }))
}
