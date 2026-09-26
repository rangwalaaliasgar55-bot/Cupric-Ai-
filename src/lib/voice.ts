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
 * Nothing here calls a network service: SpeechRecognition in Chromium does its
 * own thing, and when it is unavailable we simply do not offer the feature.
 */

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
  return recognitionCtor() !== null
}

export type VoiceEvents = {
  onTranscript: (text: string, isFinal: boolean) => void
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
 * Continuous listener. `start()` is a no-op when unsupported, so callers do not
 * need to branch twice.
 */
export class VoiceListener {
  private rec: SpeechRecognitionLike | null = null
  private running = false

  constructor(
    private events: VoiceEvents,
    private lang = 'en-US',
    private mode: VoiceMode = 'command',
  ) {}

  get active() {
    return this.running
  }

  start() {
    const Ctor = recognitionCtor()
    if (!Ctor || this.running) return false
    const rec = new Ctor()
    rec.lang = this.lang
    rec.continuous = true
    rec.interimResults = true

    rec.onresult = (e: any) => {
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
      this.events.onError?.(
        code === 'not-allowed'
          ? 'Microphone permission denied.'
          : `Speech recognition error: ${code}`,
      )
    }
    rec.onend = () => {
      // Chromium ends the session every ~60s; restart while the user wants it.
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

  stop() {
    this.running = false
    try {
      this.rec?.stop()
    } catch {
      /* already stopped */
    }
    this.rec = null
  }
}
