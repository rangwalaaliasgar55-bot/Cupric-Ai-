/**
 * Offline dictation for the desktop app (1.10), renderer half.
 *
 * Records the microphone locally, cuts it into utterances with a simple
 * energy voice-activity detector, encodes each as 16 kHz mono 16-bit WAV and
 * hands it to the main process (`voice:transcribe`), which runs Whisper or
 * Windows Speech Recognition — no network either way.
 *
 * The audio helpers at the top are pure (no DOM), so
 * scripts/check-local-voice.mjs exercises them directly.
 */

export const TARGET_RATE = 16000

/** Linear-interpolation resample of mono float samples to `to` Hz. */
export function downsample(input: Float32Array, from: number, to = TARGET_RATE): Float32Array {
  if (from === to) return input.slice()
  const ratio = from / to
  const length = Math.max(0, Math.floor(input.length / ratio))
  const out = new Float32Array(length)
  for (let i = 0; i < length; i += 1) {
    const pos = i * ratio
    const i0 = Math.floor(pos)
    const i1 = Math.min(input.length - 1, i0 + 1)
    const frac = pos - i0
    out[i] = input[i0] * (1 - frac) + input[i1] * frac
  }
  return out
}

/** 16-bit PCM mono WAV. */
export function encodeWav(samples: Float32Array, rate = TARGET_RATE): Uint8Array {
  const bytes = new Uint8Array(44 + samples.length * 2)
  const view = new DataView(bytes.buffer)
  const ascii = (offset: number, text: string) => [...text].forEach((c, i) => view.setUint8(offset + i, c.charCodeAt(0)))
  ascii(0, 'RIFF')
  view.setUint32(4, 36 + samples.length * 2, true)
  ascii(8, 'WAVE')
  ascii(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true) // PCM
  view.setUint16(22, 1, true) // mono
  view.setUint32(24, rate, true)
  view.setUint32(28, rate * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  ascii(36, 'data')
  view.setUint32(40, samples.length * 2, true)
  for (let i = 0; i < samples.length; i += 1) {
    const s = Math.max(-1, Math.min(1, samples[i]))
    view.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true)
  }
  return bytes
}

export function rms(samples: Float32Array): number {
  let sum = 0
  for (let i = 0; i < samples.length; i += 1) sum += samples[i] * samples[i]
  return samples.length ? Math.sqrt(sum / samples.length) : 0
}

export type SegmenterOptions = {
  /** Loudness that counts as speech, above the tracked noise floor. */
  minThreshold?: number
  /** Silence that ends an utterance. */
  endSilenceSec?: number
  /** Hard cap so a long monologue still gets transcribed in pieces. */
  maxUtteranceSec?: number
  /** Shorter than this is a cough or a click, not words. */
  minUtteranceSec?: number
  rate?: number
}

/**
 * Energy VAD: feed 16 kHz chunks, get whole utterances back. The threshold
 * adapts to the room: 3× the running noise floor, never below `minThreshold`.
 */
export class UtteranceSegmenter {
  private buf: Float32Array[] = []
  private voicedSec = 0
  private silenceSec = 0
  private lengthSec = 0
  private preroll: Float32Array[] = []
  private noise = 0.004
  private readonly o: Required<SegmenterOptions>

  constructor(opts: SegmenterOptions = {}) {
    this.o = { minThreshold: 0.012, endSilenceSec: 0.8, maxUtteranceSec: 15, minUtteranceSec: 0.35, rate: TARGET_RATE, ...opts }
  }

  /** Returns a finished utterance when this chunk closed one, else null. */
  push(chunk: Float32Array): Float32Array | null {
    const sec = chunk.length / this.o.rate
    const level = rms(chunk)
    const threshold = Math.max(this.o.minThreshold, this.noise * 3)
    const voiced = level > threshold
    if (!voiced && !this.buf.length) {
      // Track the noise floor only while nobody is speaking.
      this.noise = this.noise * 0.95 + level * 0.05
      this.preroll.push(chunk)
      // Keep ~0.3 s before speech so the first syllable is not clipped.
      let pre = this.preroll.reduce((n, c) => n + c.length, 0) / this.o.rate
      while (pre > 0.3 && this.preroll.length > 1) {
        pre -= this.preroll[0].length / this.o.rate
        this.preroll.shift()
      }
      return null
    }
    if (!this.buf.length) {
      this.buf.push(...this.preroll)
      this.lengthSec = this.preroll.reduce((n, c) => n + c.length, 0) / this.o.rate
      this.preroll = []
    }
    this.buf.push(chunk)
    this.lengthSec += sec
    if (voiced) {
      this.voicedSec += sec
      this.silenceSec = 0
    } else {
      this.silenceSec += sec
    }
    if (this.silenceSec >= this.o.endSilenceSec || this.lengthSec >= this.o.maxUtteranceSec) return this.flush()
    return null
  }

  /** Close whatever is buffered (e.g. when the user stops the mic). */
  flush(): Float32Array | null {
    const enough = this.voicedSec >= this.o.minUtteranceSec
    const total = this.buf.reduce((n, c) => n + c.length, 0)
    const out = new Float32Array(total)
    let at = 0
    for (const c of this.buf) {
      out.set(c, at)
      at += c.length
    }
    this.buf = []
    this.voicedSec = 0
    this.silenceSec = 0
    this.lengthSec = 0
    return enough && total ? out : null
  }
}

/* ——— the listener (DOM + IPC) ——————————————————————————————————— */

export type LocalVoiceEvents = {
  onFinal: (text: string) => void
  onListening?: (level: number) => void
  onError: (code: 'not-allowed' | 'audio-capture' | 'no-engine' | 'engine-failed', detail?: string) => void
  onEnd?: () => void
}

type Transcribe = (wav: Uint8Array, lang: string) => Promise<{ text: string; engine: string | null }>

export class LocalVoiceListener {
  private stream: MediaStream | null = null
  private ctx: AudioContext | null = null
  private node: ScriptProcessorNode | null = null
  private source: MediaStreamAudioSourceNode | null = null
  private segmenter = new UtteranceSegmenter()
  private queue: Promise<void> = Promise.resolve()
  private running = false
  private failedOnce = false

  constructor(private events: LocalVoiceEvents, private transcribe: Transcribe, private lang = 'en-US') {}

  get active() {
    return this.running
  }

  async start(): Promise<boolean> {
    if (this.running) return true
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } })
    } catch (err) {
      const name = (err as DOMException)?.name
      this.events.onError(name === 'NotAllowedError' || name === 'SecurityError' ? 'not-allowed' : 'audio-capture')
      return false
    }
    const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
    this.ctx = new Ctor()
    this.source = this.ctx.createMediaStreamSource(this.stream)
    // ScriptProcessor is deprecated but universally available in Electron and
    // needs no separate worklet file in the packaged app.
    this.node = this.ctx.createScriptProcessor(4096, 1, 1)
    const rate = this.ctx.sampleRate
    this.node.onaudioprocess = (e) => {
      if (!this.running) return
      const chunk = downsample(e.inputBuffer.getChannelData(0), rate)
      this.events.onListening?.(rms(chunk))
      const utterance = this.segmenter.push(chunk)
      if (utterance) this.send(utterance)
    }
    this.source.connect(this.node)
    this.node.connect(this.ctx.destination)
    this.running = true
    return true
  }

  private send(samples: Float32Array) {
    const wav = encodeWav(samples)
    this.queue = this.queue.then(async () => {
      try {
        const { text } = await this.transcribe(wav, this.lang)
        if (text) this.events.onFinal(text)
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        if (this.failedOnce) return
        this.failedOnce = true
        this.events.onError(/no offline speech engine/i.test(message) ? 'no-engine' : 'engine-failed', message)
        this.stop()
      }
    })
  }

  stop() {
    if (!this.running && !this.stream) return
    this.running = false
    const tail = this.segmenter.flush()
    if (tail) this.send(tail)
    try {
      this.node?.disconnect()
      this.source?.disconnect()
    } catch {
      /* already disconnected */
    }
    this.stream?.getTracks().forEach((t) => t.stop())
    void this.ctx?.close().catch(() => undefined)
    this.node = null
    this.source = null
    this.stream = null
    this.ctx = null
    void this.queue.then(() => this.events.onEnd?.())
  }
}
