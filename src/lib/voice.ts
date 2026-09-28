/**
 * Voice commands for the Studio.
 *
 * Two halves, deliberately separated:
 *  - `parseVoiceCommand` is a pure function (string -> command | null). It is
 *    the whole grammar and can be tested without a browser.
 *  - `VoiceListener` is a thin wrapper over the Web Speech API that feeds
 *    transcripts into the parser. If the API is missing, `isVoiceSupported()`
 *    returns false and the UI hides the button instead of pretending.
 *
 * Engines, in order (1.10):
 *  1. Desktop with an offline engine (Whisper, then Windows Speech
 *     Recognition — see electron/voice-engines.cjs): the mic is recorded
 *     locally and transcribed by the main process. No network.
 *  2. Otherwise Web Speech, which works in a browser but needs Google's
 *     online service — unreachable from the packaged desktop app.
 *  3. When that fails, one friendly message saying to type instead.
 */
import { getIpc } from './bridge'
import { LocalVoiceListener } from './localVoice'

export type VoiceEngineStatus = { whisper: boolean; windows: boolean; engine: 'whisper' | 'windows' | null; whisperModel?: string | null }
let engineStatus: VoiceEngineStatus | null = null

/** Ask the desktop app which offline engines exist. Call once at startup. */
export async function primeVoiceEngines(): Promise<VoiceEngineStatus | null> {
  const ipc = getIpc()
  if (!ipc) return null
  try {
    engineStatus = (await ipc.invoke('voice:status')) as VoiceEngineStatus
  } catch {
    engineStatus = null
  }
  return engineStatus
}

export function offlineVoiceEngine(): VoiceEngineStatus['engine'] {
  return engineStatus?.engine ?? null
}

export type VoiceCommand =
  | { type: 'play' }
  | { type: 'pause' }
  | { type: 'stop' }
  | { type: 'seek-start' }
  | { type: 'seek-end' }
  | { type: 'seek-to'; seconds: number }
  | { type: 'nudge'; seconds: number }
  | { type: 'split' }
  | { type: 'delete' }
  | { type: 'duplicate' }
  | { type: 'undo' }
  | { type: 'add-text'; text?: string }
  | { type: 'add-background'; name?: string }
  | { type: 'add-glass'; preset?: string }
  | { type: 'set-transition'; transition: string }
  | { type: 'zoom'; direction: 'in' | 'out' }
  | { type: 'export' }
  | { type: 'mute'; on: boolean }
  /** The whole utterance is a brief: run the autonomous pipeline on it. */
  | { type: 'make-video'; brief: string }

const NUMBER_WORDS: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9,
  ten: 10, eleven: 11, twelve: 12, fifteen: 15, twenty: 20, thirty: 30, sixty: 60,
  a: 1, an: 1,
}

function toNumber(token: string | undefined): number | null {
  if (!token) return null
  const n = Number(token)
  if (Number.isFinite(n)) return n
  const word = NUMBER_WORDS[token.toLowerCase()]
  return word === undefined ? null : word
}

/** Command vocabulary, in the order it is matched. */
export const VOICE_PHRASES: { say: string; does: string }[] = [
  { say: '"play" / "pause" / "stop"', does: 'Transport control' },
  { say: '"go to start" / "go to end"', does: 'Jump the playhead' },
  { say: '"go to 12 seconds"', does: 'Seek to a time' },
  { say: '"forward 5" / "back 2"', does: 'Nudge the playhead' },
  { say: '"split" / "cut here"', does: 'Split the selected clip at the playhead' },
  { say: '"delete" / "duplicate"', does: 'Edit the selected clip' },
  { say: '"add text hello world"', does: 'New caption with that wording' },
  { say: '"add background aurora"', does: 'New background clip, matched by name' },
  { say: '"add glass lens"', does: 'New glass panel/lens clip' },
  { say: '"transition fade"', does: 'Set the selected clip\u2019s in-transition' },
  { say: '"zoom in" / "zoom out"', does: 'Timeline zoom' },
  { say: '"mute" / "unmute"', does: 'Preview audio' },
  { say: '"export"', does: 'Start the export' },
  { say: '"make a video about …"', does: 'Hand the whole sentence to the autonomous pipeline' },
]

/**
 * Parse one utterance. Returns null when nothing matches — the caller should
 * show the transcript so the user can see *why* nothing happened.
 */
export function parseVoiceCommand(rawInput: string): VoiceCommand | null {
  const raw = rawInput.trim().toLowerCase().replace(/[.!,?]+$/g, '')
  if (!raw) return null
  // Optional wake word.
  const text = raw.replace(/^(hey |ok |cupric,? |hey cupric,? )+/g, '').trim()

  if (/^(play|resume|go)$/.test(text)) return { type: 'play' }
  if (/^(pause|hold)$/.test(text)) return { type: 'pause' }
  if (/^stop$/.test(text)) return { type: 'stop' }
  if (/^(go to |jump to |back to )?(the )?(start|beginning)$/.test(text)) return { type: 'seek-start' }
  if (/^(go to |jump to )?(the )?end$/.test(text)) return { type: 'seek-end' }

  let m = text.match(/^(?:go to|jump to|seek to|seek)\s+([\w.]+)\s*(seconds?|secs?|s)?$/)
  if (m) {
    const n = toNumber(m[1])
    if (n !== null) return { type: 'seek-to', seconds: n }
  }

  m = text.match(/^(forward|ahead|skip|back|rewind|backward)\s+([\w.]+)\s*(seconds?|secs?|s)?$/)
  if (m) {
    const n = toNumber(m[2])
    if (n !== null) {
      const sign = /^(back|rewind|backward)$/.test(m[1]) ? -1 : 1
      return { type: 'nudge', seconds: sign * n }
    }
  }

  if (/^(split|cut|cut here|split here|split clip)$/.test(text)) return { type: 'split' }
  if (/^(delete|remove|delete clip|remove clip)$/.test(text)) return { type: 'delete' }
  if (/^(duplicate|copy clip|duplicate clip)$/.test(text)) return { type: 'duplicate' }
  if (/^undo$/.test(text)) return { type: 'undo' }

  m = text.match(/^(?:add|insert|new)\s+(?:a\s+)?(?:text|caption|title)(?:\s+(?:saying|that says|with)?\s*(.*))?$/)
  if (m) {
    const words = (m[1] ?? '').trim()
    return { type: 'add-text', text: words || undefined }
  }

  m = text.match(/^(?:add|insert|new)\s+(?:a\s+)?(?:background|bg)(?:\s+(.*))?$/)
  if (m) return { type: 'add-background', name: (m[1] ?? '').trim() || undefined }

  m = text.match(/^(?:add|insert|new)\s+(?:a\s+)?glass(?:\s+(.*))?$/)
  if (m) return { type: 'add-glass', preset: (m[1] ?? '').trim() || undefined }

  m = text.match(/^(?:set\s+)?transition(?:\s+to)?\s+(.+)$/)
  if (m) return { type: 'set-transition', transition: m[1].trim().replace(/\s+/g, '-') }

  if (/^zoom (in|out)$/.test(text)) {
    return { type: 'zoom', direction: text.endsWith('in') ? 'in' : 'out' }
  }
  if (/^(mute|silence)$/.test(text)) return { type: 'mute', on: true }
  if (/^unmute$/.test(text)) return { type: 'mute', on: false }
  if (/^(export|render|save video|export video)$/.test(text)) return { type: 'export' }

  // Checked last, so it never shadows a specific command: anything phrased as
  // "make/create/generate a video …" becomes an autonomous job brief.
  m = text.match(/^(?:make|create|generate|build)\s+(?:me\s+)?(?:a|an)?\s*(?:video|short|clip|promo|reel)\b(.*)$/)
  if (m) {
    const rest = m[1].replace(/^\s*(?:about|for|of|that says|saying|showing)\s*/, '').trim()
    if (rest) return { type: 'make-video', brief: rest }
  }

  return null
}

/* ——— browser side ——— */

type SpeechRecognitionLike = {
  lang: string
  continuous: boolean
  interimResults: boolean
  start: () => void
  stop: () => void
  onresult: ((e: any) => void) | null
  onerror: ((e: any) => void) | null
  onend: (() => void) | null
}

function recognitionCtor(): (new () => SpeechRecognitionLike) | null {
  if (typeof window === 'undefined') return null
  const w = window as any
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null
}

export function isVoiceSupported(): boolean {
  // Packaged Electron must never fall through to Chromium Web Speech: that
  // implementation sends microphone audio to an online service. The browser
  // build may still use it when no desktop IPC exists.
  if (getIpc()) return engineStatus === null || offlineVoiceEngine() !== null
  return recognitionCtor() !== null
}

export type VoiceEvents = {
  onTranscript: (text: string, isFinal: boolean) => void
  onLevel?: (level: number) => void
  onTranscribing?: (active: boolean) => void
  onCommand: (command: VoiceCommand, transcript: string) => void
  onUnrecognised?: (transcript: string) => void
  onError?: (message: string) => void
  onEnd?: () => void
}

export type VoiceMode =
  /** Grammar mode: only recognised commands fire (the Studio mic). */
  | 'command'
  /**
   * Dictation mode: nothing is parsed, every final phrase is handed over as
   * text. This is what "speak a brief and walk away" needs — a brief is prose,
   * and running it through the command grammar would throw all of it away.
   */
  | 'dictation'

/**
 * Speak a line back with the browser's own synthesiser.
 *
 * No dependency and no network: it is the cheapest way to close the loop on a
 * hands-free run. Silently does nothing where speech synthesis is missing,
 * because status is always shown on screen as well — audio is the garnish.
 */
export function speak(text: string, opts: { rate?: number; interrupt?: boolean } = {}) {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return
  try {
    if (opts.interrupt) window.speechSynthesis.cancel()
    const utterance = new SpeechSynthesisUtterance(text)
    utterance.rate = opts.rate ?? 1.02
    window.speechSynthesis.speak(utterance)
  } catch {
    /* synthesis is optional */
  }
}

export function stopSpeaking() {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return
  try {
    window.speechSynthesis.cancel()
  } catch {
    /* nothing to cancel */
  }
}

/**
 * Errors that will not fix themselves by retrying. `network` is the common one
 * on the desktop build: Chromium's Web Speech sends audio to an online speech
 * service that an Electron app is not always allowed to use. Restarting just
 * fails again, which used to stack the same toast four times.
 */
const FATAL_VOICE_ERRORS = new Set(['network', 'not-allowed', 'service-not-allowed', 'audio-capture', 'language-not-supported', 'bad-grammar'])

/** One plain sentence per Web Speech error code, never the raw code alone. */
export function voiceErrorMessage(code: string): string {
  switch (code) {
    case 'network':
    case 'service-not-allowed':
      return 'Voice input needs an online speech service that isn’t reachable from this app right now. Type your brief instead — everything else keeps working.'
    case 'not-allowed':
      return 'Microphone access is blocked. Allow Cupric AI in your system’s microphone privacy settings, then try again.'
    case 'audio-capture':
      return 'No microphone was found. Plug one in or pick an input device in your system sound settings, then try again.'
    case 'language-not-supported':
      return 'Voice input doesn’t support this language here. Type your brief instead.'
    case 'no-engine':
      return 'Offline voice input isn’t installed. Add Whisper (run “npm run whisper:fetch”, or put whisper-cli and a ggml model in the app’s whisper folder) — or type your brief instead.'
    case 'engine-failed':
      return 'The offline speech engine couldn’t transcribe that. Type your brief instead, or copy a diagnostic report from Settings if it keeps happening.'
    case 'restart-loop':
      return 'Voice input keeps stopping on its own, so Cupric turned it off. Type your brief instead, or try the mic again later.'
    default:
      return 'Voice input stopped unexpectedly. Try the mic again, or type your brief instead.'
  }
}

/** A session that dies this many times this quickly, hearing nothing, is stuck. */
const RESTART_LIMIT = 3
const RESTART_WINDOW_MS = 8000

/**
 * Continuous listener. `start()` is a no-op when unsupported, so callers do not
 * need to branch twice.
 */
export class VoiceListener {
  private rec: SpeechRecognitionLike | null = null
  private running = false
  /** Codes already reported this session: an error is said once, not per retry. */
  private reported = new Set<string>()
  private restarts: number[] = []

  constructor(
    private events: VoiceEvents,
    private lang = 'en-US',
    private mode: VoiceMode = 'command',
  ) {}

  get active() {
    return this.running
  }

  private local: LocalVoiceListener | null = null

  /** Offline path: record locally, transcribe in the main process. */
  private startLocal(): boolean {
    const ipc = getIpc()
    if (!ipc) return false
    this.reported.clear()
    const local = new LocalVoiceListener(
      {
        onFinal: (text) => {
          this.events.onTranscribing?.(false)
          this.events.onTranscript(text, true)
          if (this.mode === 'dictation') return
          const command = parseVoiceCommand(text)
          if (command) this.events.onCommand(command, text)
          else this.events.onUnrecognised?.(text)
        },
        onListening: (level) => this.events.onLevel?.(level),
        onTranscribing: (active) => this.events.onTranscribing?.(active),
        onError: (code) => {
          this.running = false
          this.events.onTranscribing?.(false)
          this.report(code)
        },
        onEnd: () => {
          if (this.local === local) this.local = null
          this.running = false
          this.events.onEnd?.()
        },
      },
      (wav, lang) => ipc.invoke('voice:transcribe', { wav, lang }),
      this.lang,
    )
    this.local = local
    this.running = true
    void local.start().then((ok) => {
      if (!ok) {
        this.running = false
        this.local = null
        this.events.onEnd?.()
      }
    })
    return true
  }

  start() {
    if (this.running) return false
    if (offlineVoiceEngine()) return this.startLocal()
    if (getIpc()) {
      this.events.onError?.('Offline voice is not installed yet. Type your brief instead, or run npm run whisper:fetch to install the bundled model.')
      this.events.onEnd?.()
      return false
    }
    const Ctor = recognitionCtor()
    if (!Ctor) return false
    const rec = new Ctor()
    this.reported.clear()
    this.restarts = []
    rec.lang = this.lang
    rec.continuous = true
    rec.interimResults = true

    rec.onresult = (e: any) => {
      // Hearing anything proves the session is healthy again.
      this.restarts = []
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const result = e.results[i]
        const transcript: string = result[0]?.transcript ?? ''
        this.events.onTranscript(transcript.trim(), Boolean(result.isFinal))
        if (!result.isFinal) continue
        // Dictation never parses: the caller wants the words, not a verb.
        if (this.mode === 'dictation') continue
        const command = parseVoiceCommand(transcript)
        if (command) this.events.onCommand(command, transcript.trim())
        else this.events.onUnrecognised?.(transcript.trim())
      }
    }
    rec.onerror = (e: any) => {
      const code = e?.error ?? 'unknown'
      // `no-speech` and `aborted` are normal; only surface the real failures.
      if (code === 'no-speech' || code === 'aborted') return
      // Retrying cannot fix these; stop now so onend does not restart the loop.
      if (FATAL_VOICE_ERRORS.has(code)) this.running = false
      this.report(code)
    }
    rec.onend = () => {
      // Chromium ends the session every ~60s; restart while the user wants it.
      if (this.running) {
        const now = Date.now()
        this.restarts = [...this.restarts.filter((at) => now - at < RESTART_WINDOW_MS), now]
        if (this.restarts.length > RESTART_LIMIT) {
          this.running = false
          this.report('restart-loop')
        }
      }
      if (this.running) {
        try {
          rec.start()
          return
        } catch {
          /* fall through to a clean stop */
        }
      }
      this.running = false
      this.events.onEnd?.()
    }

    this.rec = rec
    this.running = true
    try {
      rec.start()
    } catch (err) {
      this.running = false
      this.events.onError?.(err instanceof Error ? err.message : 'Could not start the microphone.')
      return false
    }
    return true
  }

  private report(code: string) {
    if (this.reported.has(code)) return
    this.reported.add(code)
    this.events.onError?.(voiceErrorMessage(code))
  }

  stop() {
    this.running = false
    if (this.local) {
      this.local.stop()
      return
    }
    try {
      this.rec?.stop()
    } catch {
      /* already stopped */
    }
    this.rec = null
  }
}

/** Minimum words before a dictated phrase is allowed to launch a job by itself. */
export const AUTO_START_MIN_WORDS = 6

/** Words that mean the speaker was mid-thought, whatever the pause suggested. */
const TRAILING_INCOMPLETE =
  /\b(a|an|the|and|or|but|so|then|with|without|for|to|of|in|on|at|about|that|this|like|plus|because|while|where|which|who|if|when|um|uh|erm|hmm)$/i

/** Phrases that are a request to start, not a brief worth starting. */
const BARE_REQUEST = /^(ok(ay)?\s+)?(hey\s+)?(cupric\s+)?(please\s+)?(make|create|build|generate|do)\s+(me\s+)?(a|an|the)?\s*(short|quick|new)?\s*(video|clip|promo|reel|ad)?\s*$/i

/**
 * Gate for hands-free dictation: should this settled phrase start a job?
 *
 * A false positive here is the worst failure mode in the product — the app
 * would run off and spend model budget on half a sentence — so every doubtful
 * case answers no and waits for the user to press the button.
 */
export function shouldAutoStartBrief(phrase: string, minWords = AUTO_START_MIN_WORDS): boolean {
  const spoken = phrase.trim().replace(/[\s,;:\u2026]+$/, '')
  if (!spoken) return false
  // Trailing comma/ellipsis in the raw phrase means the recogniser itself heard
  // an unfinished clause.
  if (/[,;:\u2026]$/.test(phrase.trim())) return false
  const words = spoken.split(/\s+/).filter(Boolean)
  if (words.length < minWords) return false
  if (BARE_REQUEST.test(spoken)) return false
  if (TRAILING_INCOMPLETE.test(words[words.length - 1] ?? '')) return false
  // A phrase that is exactly an editor command ("add text hello there please")
  // is a command, not a brief.
  const parsed = parseVoiceCommand(spoken)
  if (parsed && parsed.type !== 'make-video') return false
  return true
}

/**
 * Offline AI voiceover (desktop): the OS voice engine speaks `text` into a WAV
 * that the Studio imports like any other audio file. Throws with a readable
 * reason (browser build, engine missing, empty script).
 */
export async function synthesizeVoiceover(text: string, opts: { rate?: number; voice?: string } = {}): Promise<{ file: File; engine: string }> {
  const ipc = getIpc()
  if (!ipc) throw new Error('Voiceover uses your computer’s built-in voice, so it needs the desktop app.')
  const res = (await ipc.invoke('voice:tts', { text, rate: opts.rate ?? 0, voice: opts.voice ?? '' })) as { ok: boolean; error?: string; base64?: string; mime?: string; engine?: string }
  if (!res?.ok || !res.base64) throw new Error(res?.error ?? 'The voice engine did not answer.')
  const bin = atob(res.base64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  const name = `voiceover-${text.slice(0, 24).replace(/[^\w]+/g, '-').replace(/^-|-$/g, '').toLowerCase() || 'script'}.wav`
  return { file: new File([bytes], name, { type: res.mime ?? 'audio/wav' }), engine: res.engine ?? 'system voice' }
}
