import { useEffect, useMemo, useRef, useState } from 'react'
import { Mic, MicOff, Volume2 } from 'lucide-react'
import { Card } from '../components/Card'
import { Button } from '../components/Button'
import { ProgressBar } from '../components/ProgressBar'
import { getIpc } from '../lib/bridge'
import { useProjectStore } from '../state/useProjectStore'
import { isVoiceSupported, shouldAutoStartBrief, speak, stopSpeaking, VoiceListener } from '../lib/voice'
import type { AutomationMode, VotingMode } from '../types/project'

/** Silence after a complete-sounding phrase before hands-free starts a job. */
const AUTO_START_SETTLE_MS = 1800

function openOutput(outputPath?: string | null) {
  const ipc = getIpc()
  if (ipc && outputPath) void ipc.invoke('automation:openOutput', { outputPath })
}

function openArenaForJob(jobId: string) {
  const ipc = getIpc()
  if (ipc) void ipc.invoke('automation:openArena', { jobId })
  else window.open('https://arena.ai/code', '_blank', 'noopener,noreferrer')
}

export function Autonomous() {
  const jobs = useProjectStore(s => s.automationJobs)
  const start = useProjectStore(s => s.startAutomationJob)
  const cancel = useProjectStore(s => s.cancelAutomationJob)
  const resume = useProjectStore(s => s.resumeAutomationJob)
  const approve = useProjectStore(s => s.approveAutomationStep)
  const reject = useProjectStore(s => s.rejectAutomationStep)
  const pushToast = useProjectStore(s => s.pushToast)
  const [brief, setBrief] = useState('')
  const [mode, setMode] = useState<AutomationMode>('auto-draft')
  const [vote, setVote] = useState<VotingMode>('local-scoring')
  const [aspect, setAspect] = useState<'16:9'|'9:16'|'1:1'>('16:9')
  const [fps, setFps] = useState<30|60>(30)
  const [quality, setQuality] = useState<'draft'|'final'>('draft')
  const [footageFolder, setFootageFolder] = useState<string | null>(null)
  const [outputFolder, setOutputFolder] = useState<string | null>(null)
  const pickFolder = async (setter: (v: string | null) => void) => {
    const ipc = getIpc()
    if (ipc) setter(await ipc.invoke('dialog:pickFolder'))
  }
  const voiceSupported = useMemo(() => isVoiceSupported(), [])
  const [listening, setListening] = useState(false)
  const [heard, setHeard] = useState<string | null>(null)
  const [handsFree, setHandsFree] = useState(true)
  const [speakBack, setSpeakBack] = useState(true)
  const listenerRef = useRef<VoiceListener | null>(null)
  const settingsRef = useRef({ aspect, fps, quality, mode, vote, footageFolder, outputFolder, handsFree, speakBack })
  settingsRef.current = { aspect, fps, quality, mode, vote, footageFolder, outputFolder, handsFree, speakBack }

  const job = jobs[0]
  const currentStep = job?.steps.find(step => step.id === job.currentStepId) || job?.steps.find(step => step.status === 'waiting-for-user') || null

  const settleRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const spokenStatusRef = useRef<string | null>(null)
  useEffect(() => {
    if (!job || !speakBack) return
    // One announcement per state change, never per render.
    const key = `${job.id}:${job.status}`
    if (spokenStatusRef.current === key) return
    spokenStatusRef.current = key
    if (job.status === 'done') speak('Your video is finished and saved.', { interrupt: true })
    else if (job.status === 'error') speak(`The job stopped: ${job.errorMessage ?? 'unknown error'}.`, { interrupt: true })
    else if (job.status === 'waiting-for-user') speak('I need you: there is a review gate waiting.', { interrupt: true })
  }, [job?.id, job?.status, job?.errorMessage, speakBack, job])

  useEffect(() => {
    return () => {
      listenerRef.current?.stop()
      listenerRef.current = null
      if (settleRef.current) clearTimeout(settleRef.current)
      settleRef.current = null
      stopSpeaking()
    }
  }, [])

  /**
   * Speak one brief, get a video.
   *
   * The Studio mic parses a command grammar; this one is in dictation mode, so
   * the whole sentence survives as prose and becomes `job.brief`. With
   * hands-free on, the first final phrase starts the pipeline immediately —
   * no further clicks, which is the whole point.
   */
  function toggleDictation() {
    if (listenerRef.current?.active) {
      listenerRef.current.stop()
      listenerRef.current = null
      if (settleRef.current) clearTimeout(settleRef.current)
      settleRef.current = null
      setListening(false)
      return
    }
    const listener = new VoiceListener(
      {
        onTranscript: (text, isFinal) => {
          if (!text) return
          setHeard(isFinal ? text : `${text}\u2026`)
          setBrief((prev) => (isFinal ? `${prev ? `${prev} ` : ''}${text}`.trim() : prev))
          if (settleRef.current) {
            clearTimeout(settleRef.current)
            settleRef.current = null
          }
          if (!isFinal) return
          const cfg = settingsRef.current
          if (!cfg.handsFree) return
          const spoken = text.trim()
          if (!shouldAutoStartBrief(spoken)) return
          // Two gates, not one: the phrase must look complete AND the speaker
          // must stay quiet afterwards. A pause mid-thought produces a final
          // phrase too, so silence is what actually separates "done" from
          // "still talking".
          settleRef.current = setTimeout(() => {
            settleRef.current = null
            listener.stop()
            listenerRef.current = null
            setListening(false)
            startJob(spoken)
          }, AUTO_START_SETTLE_MS)
        },
        onCommand: () => {},
        onError: (message) => {
          pushToast('error', message)
          setListening(false)
        },
        onEnd: () => setListening(false),
      },
      'en-US',
      'dictation',
    )
    if (listener.start()) {
      listenerRef.current = listener
      setListening(true)
      setHeard('Listening\u2026 describe the video you want.')
      if (settingsRef.current.speakBack) speak('Listening. Describe the video you want.', { interrupt: true })
    }
  }

  function startJob(text: string) {
    const cfg = settingsRef.current
    const finalBrief = text.trim() || brief.trim()
    if (!finalBrief) return
    start({
      brief: finalBrief,
      footageFolder: cfg.footageFolder,
      outputFolder: cfg.outputFolder,
      aspect: cfg.aspect,
      fps: cfg.fps,
      quality: cfg.quality,
      mode: cfg.mode,
      votingMode: cfg.vote,
    })
    if (cfg.speakBack) speak(`Starting. ${finalBrief.slice(0, 90)}. I will tell you when the render is done.`, { interrupt: true })
  }

  return (
    <div className="h-full overflow-y-auto p-8">
      <div className="mx-auto max-w-4xl space-y-5">
        <div>
          <p className="font-mono text-xs uppercase tracking-widest text-accent-text">Autonomous production</p>
          <h1 className="mt-2 text-3xl font-semibold">One brief. Finished MP4.</h1>
          <p className="mt-2 text-sm text-muted">Cupric AI runs the creative pipeline while keeping review gates visible.</p>
        </div>

        <Card>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <label className="text-sm font-medium">Project goal / brief</label>
            {voiceSupported && (
              <div className="flex flex-wrap items-center gap-3">
                <label className="flex items-center gap-1.5 text-xs text-muted">
                  <input type="checkbox" checked={handsFree} onChange={(e) => setHandsFree(e.target.checked)} />
                  Start as soon as I stop speaking
                </label>
                <label className="flex items-center gap-1.5 text-xs text-muted">
                  <input type="checkbox" checked={speakBack} onChange={(e) => setSpeakBack(e.target.checked)} />
                  <Volume2 size={12} /> Speak status back
                </label>
                <Button size="sm" variant={listening ? 'primary' : 'outline'} onClick={toggleDictation}>
                  {listening ? <Mic size={13} /> : <MicOff size={13} />} {listening ? 'Listening' : 'Speak the brief'}
                </Button>
              </div>
            )}
          </div>
          {heard && <p className="mt-2 text-xs text-muted">{heard}</p>}
          <textarea
            value={brief}
            onChange={e => setBrief(e.target.value)}
            placeholder="Describe the video, audience, message, and feeling…"
            className="mt-3 min-h-28 w-full rounded-lg border border-line bg-bg p-3 text-sm outline-none focus:border-accent"
          />
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <Button variant="outline" onClick={() => pickFolder(setFootageFolder)}>Footage folder {footageFolder ? '✓' : '(optional)'}</Button>
            <Button variant="outline" onClick={() => pickFolder(setOutputFolder)}>Output folder {outputFolder ? '✓' : '(optional)'}</Button>
          </div>
          <div className="mt-5 grid gap-4 sm:grid-cols-3">
            <label className="text-xs text-muted">Aspect
              <select value={aspect} onChange={e => setAspect(e.target.value as any)} className="mt-2 block w-full rounded border border-line bg-bg p-2 text-text">
                <option>16:9</option><option>9:16</option><option>1:1</option>
              </select>
            </label>
            <label className="text-xs text-muted">Frame rate
              <select value={fps} onChange={e => setFps(Number(e.target.value) as 30|60)} className="mt-2 block w-full rounded border border-line bg-bg p-2 text-text">
                <option value="30">30 fps</option><option value="60">60 fps</option>
              </select>
            </label>
            <label className="text-xs text-muted">Quality
              <select value={quality} onChange={e => setQuality(e.target.value as any)} className="mt-2 block w-full rounded border border-line bg-bg p-2 text-text">
                <option value="draft">Draft</option><option value="final">Final</option>
              </select>
            </label>
          </div>
          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            <label className="text-xs text-muted">Autonomy
              <select value={mode} onChange={e => setMode(e.target.value as AutomationMode)} className="mt-2 block w-full rounded border border-line bg-bg p-2 text-text">
                <option value="guided">Guided</option><option value="auto-draft">Auto Draft</option><option value="auto-final">Auto Final</option>
              </select>
            </label>
            <label className="text-xs text-muted">Voting
              <select value={vote} onChange={e => setVote(e.target.value as VotingMode)} className="mt-2 block w-full rounded border border-line bg-bg p-2 text-text">
                <option value="local-scoring">AI candidate battle, scored locally (no public vote)</option>
                <option value="manual-arena">Manual Arena vote</option>
              </select>
            </label>
          </div>
          <div className="mt-5 flex justify-end">
            <Button onClick={() => startJob(brief)} disabled={!brief.trim()}>
              Start autonomous job
            </Button>
          </div>
        </Card>

        {job && (
          <Card>
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="font-medium">{job.status === 'done' ? 'Production complete' : 'Production timeline'}</h2>
                <p className="text-xs text-muted">
                  {job.votingMode === 'manual-arena'
                    ? 'Manual Arena is a required review gate; Cupric never automates public voting.'
                    : 'Local scoring stays private and never automates public voting.'}
                </p>
                {job.outputPath && <p className="mt-1 font-mono text-[11px] text-muted">MP4: {job.outputPath}</p>}
              </div>
              <div className="flex flex-wrap justify-end gap-2">
                {job.status === 'running' && <Button variant="outline" onClick={() => cancel(job.id)}>Cancel</Button>}
                {(job.status === 'cancelled' || job.status === 'error') && <Button onClick={() => resume(job.id)}>Resume</Button>}
                {job.outputPath && <Button variant="outline" onClick={() => openOutput(job.outputPath)}>Reveal MP4</Button>}
              </div>
            </div>

            {job.status === 'waiting-for-user' && currentStep && (
              <div className="mt-4 rounded-xl border border-accent/30 bg-accent/10 p-3">
                <div className="text-sm font-semibold text-accent-text">Review gate waiting</div>
                <p className="mt-1 text-sm text-muted">{job.waitingMessage || currentStep.message || 'Approve this gate to continue.'}</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button size="sm" variant="outline" onClick={() => openArenaForJob(job.id)}>Open Arena in browser</Button>
                  <Button size="sm" onClick={() => approve(job.id, currentStep.id)}>Approve gate & continue</Button>
                  <Button size="sm" variant="outline" onClick={() => reject(job.id, currentStep.id)}>Reject</Button>
                </div>
              </div>
            )}

            {job.errorMessage && (
              <div className="mt-4 rounded-xl border border-danger/30 bg-danger/10 p-3 text-sm text-danger">
                {job.errorMessage}
              </div>
            )}

            {!!job.warnings?.length && (
              <div className="mt-4 rounded-xl border border-line bg-bg/40 p-3 text-xs text-muted">
                <div className="mb-1 font-semibold text-text">Warnings</div>
                <ul className="list-disc space-y-1 pl-4">
                  {job.warnings.slice(-4).map((warning, index) => <li key={`${warning}-${index}`}>{warning}</li>)}
                </ul>
              </div>
            )}

            <div className="mt-5 space-y-3">
              {job.steps.map(step => (
                <div key={step.id}>
                  <div className="flex justify-between gap-3 text-xs">
                    <span>{step.label}</span>
                    <span className="text-muted">{step.status}</span>
                  </div>
                  <ProgressBar pct={step.progressPct} className="mt-1" />
                  {step.message && <div className="mt-1 text-xs text-muted">{step.message}</div>}
                  {step.errorMessage && <div className="mt-1 text-xs text-danger">{step.errorMessage}</div>}
                </div>
              ))}
            </div>
          </Card>
        )}
      </div>
    </div>
  )
}
