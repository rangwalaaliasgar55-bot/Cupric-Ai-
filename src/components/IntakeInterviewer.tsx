/**
 * JOB 4 — the mic that fills the form and asks what is still missing.
 *
 * Speak once; every field the transcript actually answers is filled, flashes,
 * and shows the phrase it was heard in. Then Cupric asks for the *next single
 * missing required answer* — one question at a time, in voice and in text.
 * Fields nobody answered stay blank and are listed as visible assumptions.
 *
 * Nothing here invents an answer. Every value written to the intake came out
 * of the user's own words, and the citation next to it proves which words.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Mic, MicOff, Volume2, Check, CornerDownLeft, Info } from 'lucide-react'
import { Button } from './Button'
import { isVoiceSupported, speak, stopSpeaking, VoiceListener } from '../lib/voice'
import {
  fillIntakeFromSpeech, nextInterviewQuestion, requiredRemaining, visibleAssumptions,
  speakBackFill, intakeLabel, type IntakeEvidence, type IntakeKey,
} from '../lib/production/intakeFromSpeech'
import type { ProductionIntake } from '../lib/production/types'

export type IntakeInterviewerProps = {
  intake: ProductionIntake
  onPatch: (patch: Partial<ProductionIntake>) => void
  /** Field keys currently flashing, so the form can highlight what just filled. */
  onFlash?: (keys: IntakeKey[]) => void
  className?: string
}

export function IntakeInterviewer({ intake, onPatch, onFlash, className }: IntakeInterviewerProps) {
  const voiceSupported = useMemo(() => isVoiceSupported(), [])
  const [listening, setListening] = useState(false)
  const [partial, setPartial] = useState('')
  const [transcribing, setTranscribing] = useState(false)
  const [micError, setMicError] = useState<string | null>(null)
  const [trail, setTrail] = useState<IntakeEvidence[]>([])
  const [asked, setAsked] = useState<IntakeKey[]>([])
  const [typed, setTyped] = useState('')
  const [speakBack, setSpeakBack] = useState(true)
  const listenerRef = useRef<VoiceListener | null>(null)
  // The interview reads live state from a ref: the listener is created once
  // per session and must not capture a stale intake.
  const stateRef = useRef({ intake, asked, speakBack })
  stateRef.current = { intake, asked, speakBack }

  const question = useMemo(() => nextInterviewQuestion(intake, asked), [intake, asked])
  const remaining = requiredRemaining(intake)
  const assumptions = useMemo(() => visibleAssumptions(intake), [intake])

  useEffect(() => () => { listenerRef.current?.stop(); listenerRef.current = null; stopSpeaking() }, [])

  /** One utterance in, filled fields out. */
  const absorb = useCallback((text: string) => {
    const { intake: live, asked: askedNow, speakBack: talk } = stateRef.current
    // When a question is on screen the answer belongs to *that* field first.
    const pending = nextInterviewQuestion(live, askedNow)
    const direct = pending ? fillIntakeFromSpeech(text, live, { only: pending.key }) : { patch: {}, evidence: [], keptFilled: [], empty: true }
    const broad = fillIntakeFromSpeech(text, live)
    const patch = { ...direct.patch, ...broad.patch }
    const evidence = [...direct.evidence, ...broad.evidence.filter((e) => !direct.evidence.some((d) => d.key === e.key))]
    if (!evidence.length) {
      setMicError(`Heard “${text}” but it did not answer a field. Try naming one thing, like “thirty seconds” or “for Instagram Reels”.`)
      return
    }
    setMicError(null)
    onPatch(patch)
    setTrail((prev) => [...evidence, ...prev].slice(0, 8))
    onFlash?.(evidence.map((e) => e.key))
    if (pending && evidence.some((e) => e.key === pending.key)) setAsked((prev) => (prev.includes(pending.key) ? prev : [...prev, pending.key]))
    if (talk) speak(speakBackFill({ patch, evidence, keptFilled: [], empty: false }), { interrupt: true })
  }, [onPatch, onFlash])

  function toggleMic() {
    if (listenerRef.current?.active) {
      listenerRef.current.stop(); listenerRef.current = null
      setListening(false); setPartial(''); setTranscribing(false)
      return
    }
    setMicError(null)
    const listener = new VoiceListener({
      onTranscript: (text, isFinal) => {
        if (!text) return
        if (!isFinal) { setPartial(`${text}…`); return }
        setPartial('')
        absorb(text)
      },
      onTranscribing: setTranscribing,
      onCommand: () => {},
      onUnrecognised: () => {},
      // Dictation never dead-ends: the box below always accepts the same words.
      onError: (message) => { setMicError(`${message} You can type the answer instead — it fills the same fields.`); setListening(false) },
      onEnd: () => { setListening(false); setPartial('') },
    }, 'en-US', 'dictation')
    listenerRef.current = listener
    listener.start()
    setListening(true)
  }

  function submitTyped() {
    const text = typed.trim()
    if (!text) return
    setTyped('')
    absorb(text)
  }

  function skipQuestion() {
    if (!question) return
    setAsked((prev) => (prev.includes(question.key) ? prev : [...prev, question.key]))
  }

  return (
    <div className={`rounded-xl border border-line bg-surface-2/40 p-3 ${className || ''}`} data-testid="intake-interviewer">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-text">Answer out loud — Cupric fills the form</span>
          {remaining > 0
            ? <span className="rounded-full border border-line px-2 py-0.5 text-[11px] text-muted">{remaining} required left</span>
            : <span className="inline-flex items-center gap-1 rounded-full border border-accent/50 px-2 py-0.5 text-[11px] text-accent-text"><Check size={10} /> all required answered</span>}
        </div>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1.5 text-xs text-muted">
            <input type="checkbox" checked={speakBack} onChange={(e) => { setSpeakBack(e.target.checked); if (!e.target.checked) stopSpeaking() }} />
            <Volume2 size={12} /> Speak status back
          </label>
          <Button size="sm" variant={listening ? 'primary' : 'outline'} onClick={toggleMic}
            title={voiceSupported ? 'Answer the questions out loud' : 'No microphone engine available — type instead'}>
            {listening ? <Mic size={13} /> : <MicOff size={13} />} {listening ? 'Listening' : 'Answer by voice'}
          </Button>
        </div>
      </div>

      {/* One question at a time, never a wall of them. */}
      <div className="mt-2.5 rounded-lg border border-line bg-bg/60 p-2.5">
        {question ? (
          <>
            <p className="text-sm text-text">
              {question.question}
              {question.required && <span className="text-accent-text"> *</span>}
            </p>
            <p className="mt-0.5 text-[11px] text-muted">{question.why}</p>
          </>
        ) : (
          <p className="text-sm text-text">Nothing left to ask — every question is answered. Generate the brief when you are ready.</p>
        )}
        <div className="mt-2 flex items-center gap-1.5">
          <input
            className="min-w-0 flex-1 rounded-lg border border-line bg-surface px-2.5 py-1.5 text-xs text-text outline-none focus:border-accent"
            placeholder={question ? question.placeholder : 'Add anything else you want the edit to know'}
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); submitTyped() } }}
            aria-label={question ? question.question : 'Extra notes'}
          />
          <Button size="sm" variant="outline" onClick={submitTyped} disabled={!typed.trim()} title="Fill the fields from this answer"><CornerDownLeft size={12} /></Button>
          {question && !question.required && <Button size="sm" variant="ghost" onClick={skipQuestion} title="Leave this blank; it becomes a visible assumption">Skip</Button>}
        </div>
      </div>

      <div className="mt-2 min-h-[16px] text-[11px]" aria-live="polite">
        {transcribing ? <span className="text-accent-text">Transcribing offline…</span>
          : partial ? <span className="text-muted">{partial}</span>
          : micError ? <span className="text-info">{micError}</span>
          : listening ? <span className="text-muted">Listening — say your answer.</span>
          : null}
      </div>

      {/* Every fill cites the words it came from. */}
      {trail.length > 0 && (
        <ul className="mt-1.5 space-y-1">
          {trail.map((e, i) => (
            <li key={`${e.key}-${i}`} className="flex flex-wrap items-baseline gap-1.5 text-[11px]">
              <Check size={10} className="translate-y-px text-accent-text" />
              <span className="font-medium text-text">{e.label}</span>
              <span className="text-text">{String(e.value)}</span>
              <span className="text-muted">— heard “{e.heard}”</span>
            </li>
          ))}
        </ul>
      )}

      {assumptions.length > 0 && (
        <details className="mt-2 text-[11px]">
          <summary className="cursor-pointer text-muted"><Info size={10} className="mr-1 inline" />{assumptions.length} blank{assumptions.length === 1 ? '' : 's'} will become visible assumptions</summary>
          <ul className="mt-1 space-y-0.5 pl-4">
            {assumptions.map((a) => (
              <li key={a.key} className="text-muted"><span className="text-text">{a.label}</span> — {a.text}</li>
            ))}
          </ul>
        </details>
      )}
    </div>
  )
}

export { intakeLabel }
