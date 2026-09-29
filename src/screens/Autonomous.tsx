import { useEffect, useMemo, useRef, useState } from 'react'
import { ThinkingStates } from '../components/loaders/ThinkingStates'
import { MatrixLoader } from '../components/loaders/MatrixLoader'
import { ProductionPlanner } from './production/ProductionPlanner'
import { rundownToDoc } from '../lib/production/fromRundown'
import { studioOf } from '../lib/studio/doc'
import { uid } from '../lib/utils'
import type { AutomationJob } from '../types/project'
import { dedupeMessages, humanError } from '../lib/humanError'
import { Mic, MicOff, Volume2 } from 'lucide-react'
import { Card } from '../components/Card'
import { Badge } from '../components/Badge'
import { Button } from '../components/Button'
import { ProgressBar } from '../components/ProgressBar'
import { getIpc } from '../lib/bridge'
import { useProjectStore } from '../state/useProjectStore'
import { isVoiceSupported, shouldAutoStartBrief, speak, stopSpeaking, VoiceListener } from '../lib/voice'
import type { AutomationMode, VotingMode } from '../types/project'
import { planWithRemotionCapabilities } from '../lib/remotionResources'
import { DESIGN_DIRECTIONS, designAll } from '../lib/studio/design'
import { reportFileName } from '../lib/automation/report'
import { CheckCircle2, Download, FileText, Sparkles, Trophy } from 'lucide-react'

/** Silence after a complete-sounding phrase before hands-free starts a job. */
const AUTO_START_SETTLE_MS = 1800

function openOutput(outputPath?: string | null) {
  const ipc = getIpc()
  if (ipc && outputPath) void ipc.invoke('automation:openOutput', { outputPath })
}

/** Save an in-memory artefact (the review report) as a file. */
function downloadText(fileName: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/markdown;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

async function openArenaForJob(jobId: string): Promise<{ copied: boolean }> {
  const ipc = getIpc()
  if (ipc) return await ipc.invoke('automation:openArena', { jobId }) as { copied: boolean }
  const opened = window.open('https://arena.ai/code', '_blank', 'noopener,noreferrer')
  if (!opened) throw new Error('The browser blocked the Arena tab. Allow pop-ups and try again.')
  return { copied: false }
}

export function Autonomous() {
  const jobs = useProjectStore(s => s.automationJobs)
  const start = useProjectStore(s => s.startAutomationJob)
  const cancel = useProjectStore(s => s.cancelAutomationJob)
  const resume = useProjectStore(s => s.resumeAutomationJob)
  function openEditable(job: AutomationJob) {
    const st = useProjectStore.getState()
    const pid = job.projectId && st.projects.some((p) => p.id === job.projectId) ? job.projectId : st.activeProjectId
    const project = st.projects.find((p) => p.id === pid)
    if (!project || !job.rundown) { st.pushToast('error', 'Open the project this run belongs to first.'); return }
    const r = rundownToDoc(studioOf(project), job.rundown, () => uid())
    // The same design pass an autonomous run uses: per-scene stages, the
    // suggested type system, contrast-checked ink and native accents.
    const designed = designAll(r.doc, { brandColors: project.brandKit?.colors, aspect: job.aspect === '9:16' ? '9:16' : job.aspect === '1:1' ? '1:1' : '16:9' }, r.clipIds, () => uid())
    st.setActiveProject(project.id)
    st.patchStudio(project.id, { clips: designed.doc.clips, trackCount: designed.doc.trackCount }, 'Auto run → editable timeline')
    st.setView('studio')
    st.pushToast('success', `Added ${r.clipIds.length} designed scene clip(s) — ${designed.report.direction.name} (${designed.report.score}/100), keyframed motion${r.placeholders ? `, ${r.placeholders} need copy` : ''}. Undo reverts it.`)
  }
  /**
   * A desktop run can stop for reasons the app cannot fix from here — FFmpeg
   * missing from the build, a capture window that would not open, a folder that
   * moved. That must not be the end of the job: the same plan, design battle and
   * Studio renderer run in this window, so the film still gets made and the
   * timeline is still editable. The desktop path stays the fast one; this is the
   * way out when it stops.
   */
  const finishLocally = (j: AutomationJob) => {
    const st = useProjectStore.getState()
    st.updateAutomationJob(j.id, { status: 'running', errorMessage: null, waitingMessage: null })
    st.runAutomationLocally(j.id)
    pushToast('info', 'Finishing this run in the app: Cupric re-plans from the same brief, runs the design battle and renders with the Studio renderer.')
  }
  const approve = useProjectStore(s => s.approveAutomationStep)
  const reject = useProjectStore(s => s.rejectAutomationStep)
  const pushToast = useProjectStore(s => s.pushToast)
  const [brief, setBrief] = useState('')
  const [mode, setMode] = useState<AutomationMode>('auto-draft')
  const [vote, setVote] = useState<VotingMode>('local-scoring')
  const [aspect, setAspect] = useState<'16:9'|'9:16'|'1:1'>('16:9')
  const [fps, setFps] = useState<30|60>(30)
  const [targetDuration, setTargetDuration] = useState<30 | 50 | 180>(30)
  const [quality, setQuality] = useState<'draft'|'final'>('draft')
  const [footageFolder, setFootageFolder] = useState<string | null>(null)
  const [outputFolder, setOutputFolder] = useState<string | null>(null)
  const pickFolder = async (setter: (v: string | null) => void) => {
    const ipc = getIpc()
    if (ipc) setter(await ipc.invoke('dialog:pickFolder'))
  }
  const voiceSupported = useMemo(() => isVoiceSupported(), [])
  const [listening, setListening] = useState(false)
  const [micLevel, setMicLevel] = useState(0)
  const [transcribing, setTranscribing] = useState(false)
  const [heard, setHeard] = useState<string | null>(null)
  const [handsFree, setHandsFree] = useState(true)
  const [speakBack, setSpeakBack] = useState(true)
  const listenerRef = useRef<VoiceListener | null>(null)
  const settingsRef = useRef({ aspect, fps, targetDuration, quality, mode, vote, footageFolder, outputFolder, handsFree, speakBack })
  settingsRef.current = { aspect, fps, targetDuration, quality, mode, vote, footageFolder, outputFolder, handsFree, speakBack }

  const job = jobs[0]
  const currentStep = job?.steps.find(step => step.id === job.currentStepId) || job?.steps.find(step => step.status === 'waiting-for-user') || null
  const capabilityPlan = planWithRemotionCapabilities(brief, aspect, fps)

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
      setMicLevel(0)
      setTranscribing(false)
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
        onLevel: (level) => setMicLevel(Math.min(1, level * 4)),
        onTranscribing: (active) => setTranscribing(active),
        onError: (message) => {
          pushToast('error', message)
          setListening(false)
        },
        onEnd: () => { setListening(false); setMicLevel(0); setTranscribing(false) },
      },
      'en-US',
      'dictation',
    )
    if (listener.start()) {
      listenerRef.current = listener
      setListening(true)
      setHeard('Listening\u2026 describe the video you want.')
      if (settingsRef.current.speakBack) speak('Listening. Describe the video you want.', { interrupt: true })
    } else {
      pushToast('error', 'Voice recognition is unavailable. Check Windows microphone privacy permission and install the latest Web Speech components, then restart Cupric AI.')
    }
  }

  function startJob(text: string) {
    const cfg = settingsRef.current
    const request = text.trim() || brief.trim()
    if (!request) return
    const finalBrief = `Create exactly a ${cfg.targetDuration}-second video. ${request}`
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
          <p className="cu-eyebrow !text-accent-text">Autonomous production</p>
          <h1 className="mt-2 text-h1 font-semibold">One brief. Finished MP4.</h1>
          <p className="mt-2 text-sm text-muted">Cupric AI runs the creative pipeline while keeping review gates visible.</p>
        </div>

        <ProductionPlanner />

        <Card className="p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <label className="text-sm font-medium">Project goal / brief</label>
            <div className="flex flex-wrap items-center gap-3">
                <label className="flex items-center gap-1.5 text-xs text-muted">
                  <input type="checkbox" checked={handsFree} onChange={(e) => setHandsFree(e.target.checked)} />
                  Start as soon as I stop speaking
                </label>
                <label className="flex items-center gap-1.5 text-xs text-muted">
                  <input type="checkbox" checked={speakBack} onChange={(e) => setSpeakBack(e.target.checked)} />
                  <Volume2 size={12} /> Speak status back
                </label>
                <Button size="sm" variant={listening ? 'primary' : 'outline'} onClick={toggleDictation} title={voiceSupported ? 'Dictate the brief' : 'Click for microphone setup help'}>
                  {listening ? <Mic size={13} /> : <MicOff size={13} />} {listening ? 'Listening' : voiceSupported ? 'Speak the brief' : 'Voice setup'}
                </Button>
              </div>
          </div>
          <div className="mt-2 flex items-center gap-2 text-xs text-muted" aria-live="polite">
            <span className="flex h-3 items-end gap-px" aria-label={`Microphone level ${Math.round(micLevel * 100)} percent`}>{Array.from({ length: 12 }, (_, i) => <span key={i} className={i / 12 < micLevel ? 'w-1 rounded-t bg-accent' : 'w-1 rounded-t bg-line'} style={{ height: `${4 + (i % 4) * 2}px` }} />)}</span>
            {transcribing ? <span className="inline-flex items-center gap-2 text-accent-text"><MatrixLoader variant="scan" tone="lime" size="inline" label="Transcribing offline" /><ThinkingStates states={['Transcribing offline…']} baseColor="var(--color-accent-text)" /></span> : heard || (listening ? 'Listening…' : 'Mic idle — type the brief instead if voice is unavailable.')}
          </div>
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
          <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
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
            <label className="text-xs text-muted">Duration
              <select value={targetDuration} onChange={e => setTargetDuration(Number(e.target.value) as 30 | 50 | 180)} className="mt-2 block w-full rounded border border-line bg-bg p-2 text-text">
                <option value="30">30 seconds</option><option value="50">50 seconds</option><option value="180">3 minutes</option>
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
          <div className="mt-5 rounded-lg border border-line bg-bg/40 p-3 text-xs">
            <div className="font-semibold text-text">Remotion capability plan</div>
            <div className="mt-1 text-muted">Template <span className="text-text">{capabilityPlan.template}</span> · Font <span className="text-text">{capabilityPlan.font}</span> · {capabilityPlan.render.fps}fps</div>
            <div className="mt-1 text-muted">Skills: {capabilityPlan.skills.join(' · ')}</div>
            <div className="mt-1 text-muted">Deterministic frames · local asset fallback · preview/export parity</div>
            <div className="mt-1 text-muted">
              Candidate battle: {DESIGN_DIRECTIONS.map((d) => d.name).join(' · ')} — each is designed and scored on this machine.
            </div>
          </div>
          <div className="mt-5 flex justify-end">
            <Button onClick={() => startJob(brief)} disabled={!brief.trim()} title={(!brief.trim()) ? 'Describe the video first' : undefined}>
              Start autonomous job
            </Button>
          </div>
        </Card>

        {job && (
          <Card className="p-5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="flex items-center gap-2 font-medium">
                  {job.status === 'done' ? 'Production complete' : 'Production timeline'}
                  {typeof job.designScore === 'number' && <Badge tone="accent">design {job.designScore}/100</Badge>}
                  {job.renderEngine === 'studio-canvas' && <Badge tone="info">studio renderer · preview parity</Badge>}
                </h2>
                <p className="text-xs text-muted">
                  {job.votingMode === 'manual-arena'
                    ? 'Manual Arena is a required review gate; Cupric never automates public voting.'
                    : 'Local scoring stays private and never automates public voting.'}
                </p>
                {job.outputPath && <p className="mt-1 font-mono text-[11px] text-muted">MP4: {job.outputPath}</p>}
                {job.renderEvaluation && (
                  <p className={`mt-2 text-xs ${job.renderEvaluation.valid ? 'text-accent-text' : 'text-danger'}`}>
                    Render QA: {job.renderEvaluation.valid ? 'passed' : 'review required'} · {job.renderEvaluation.score}/100
                    {job.renderEvaluation.size && ` · ${job.renderEvaluation.size[0]}×${job.renderEvaluation.size[1]}`}
                  </p>
                )}
              </div>
              <div className="flex flex-wrap justify-end gap-2">
                {job.status === 'running' && <Button variant="outline" onClick={() => cancel(job.id)}>Cancel</Button>}
                {(job.status === 'cancelled' || job.status === 'error') && <Button onClick={() => resume(job.id)}>Resume</Button>}
                {job.status === 'error' && !job.outputPath && (
                  <Button variant="outline" onClick={() => finishLocally(job)} title="Plan, design and render this job in the app instead of the desktop pipeline — the result lands in Studio as editable clips plus a rendered preview.">
                    Finish in Studio
                  </Button>
                )}
                {job.outputPath && <Button variant="outline" onClick={() => openOutput(job.outputPath)}>Reveal MP4</Button>}
                {job.rundown?.scenes?.length ? <Button variant="outline" onClick={() => openEditable(job)} title="Rebuild this run's scenes as editable Studio clips with Cupric AI keyframe motion (one undo step)">Edit in Studio</Button> : null}
              </div>
            </div>

            {!!job.candidateBattle?.length && (
              <div className="mt-4 rounded-xl border border-line bg-bg/40 p-3" data-testid="candidate-battle">
                <div className="flex items-center gap-2 text-xs font-semibold text-text">
                  <Trophy size={13} className="text-accent-text" /> Candidate battle — {job.candidateBattle.length} directions, scored locally (no public vote)
                </div>
                <div className="mt-2 grid gap-2 sm:grid-cols-3">
                  {job.candidateBattle.map((c, i) => (
                    <div key={c.id} className={i === 0 ? 'rounded-lg border border-accent/40 bg-accent/5 p-2.5' : 'rounded-lg border border-line bg-panel-alt/30 p-2.5'}>
                      <div className="flex items-center justify-between gap-2 text-xs">
                        <span className="truncate font-medium text-text">{i === 0 ? '★ ' : ''}{c.name}</span>
                        <span className="shrink-0 tabular-nums text-muted">{c.score}/100</span>
                      </div>
                      <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-line">
                        <div className={i === 0 ? 'h-full rounded-full bg-accent' : 'h-full rounded-full bg-muted/50'} style={{ width: `${Math.max(3, c.score)}%` }} />
                      </div>
                      <ul className="mt-1.5 space-y-0.5 text-[11px] leading-snug text-muted">
                        {c.reasons.slice(0, 2).map((r) => <li key={r} className="truncate" title={r}>· {r}</li>)}
                      </ul>
                      <div className="mt-1 text-[10px] text-muted">design {c.designScore}/100</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {job.outputUrl && (
              <div className="mt-4 rounded-xl border border-line bg-bg/40 p-3" data-testid="run-output">
                <div className="flex flex-wrap items-center gap-2 text-xs font-semibold text-text">
                  <CheckCircle2 size={13} className="text-accent-text" /> Rendered with the Studio renderer — what you watched is what was recorded
                  <Button size="sm" variant="outline" className="ml-auto" onClick={() => { const a = document.createElement('a'); a.href = job.outputUrl!; a.download = job.outputPath?.split('/').pop() ?? 'cupric-run.webm'; a.click() }}>
                    <Download size={12} /> Download
                  </Button>
                  {job.reviewReport && (
                    <Button size="sm" variant="outline" onClick={() => downloadText(reportFileName(job), job.reviewReport!)}>
                      <FileText size={12} /> Report
                    </Button>
                  )}
                </div>
                <video src={job.outputUrl} controls playsInline className="mt-2 max-h-72 w-full rounded-lg border border-line bg-black" />
              </div>
            )}

            {job.reviewReport && !job.outputUrl && (
              <details className="mt-4 rounded-xl border border-line bg-bg/40 p-3 text-xs text-muted">
                <summary className="cursor-pointer select-none font-semibold text-text">Review report</summary>
                <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap font-sans text-[11px] leading-relaxed">{job.reviewReport}</pre>
                <Button size="sm" variant="outline" className="mt-2" onClick={() => downloadText(reportFileName(job), job.reviewReport!)}>
                  <Download size={12} /> Save report
                </Button>
              </details>
            )}

            {job.status === 'running' && (
              <div className="mt-3 flex items-center gap-2 text-sm" data-testid="autonomous-status">
                <MatrixLoader variant="orbit" tone="lime" label="Autonomous job running" />
                {/* Only real steps: the running step, then its own message if it has one. */}
                <ThinkingStates states={[currentStep?.label ?? job.steps.find((s) => s.status === 'running')?.label ?? 'Working', ...(job.steps.find((s) => s.status === 'running')?.message ? [String(job.steps.find((s) => s.status === 'running')?.message)] : [])]} holdMs={2600} />
              </div>
            )}

            {job.status === 'waiting-for-user' && currentStep && (
              <div className="mt-4 rounded-xl border border-accent/30 bg-accent/10 p-3">
                <div className="text-sm font-semibold text-accent-text">Review gate waiting</div>
                <p className="mt-1 text-sm text-muted">{job.waitingMessage || currentStep.message || 'Approve this gate to continue.'}</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => void openArenaForJob(job.id)
                      .then((result) => pushToast('success', result.copied
                        ? 'Arena opened and the prompt was verified on your clipboard. Paste it to continue.'
                        : 'Arena opened. Copy the prompt from the rundown before continuing.'))
                      .catch((error) => pushToast('error', error instanceof Error ? error.message : String(error)))}
                  >
                    Open Arena & copy prompt
                  </Button>
                  <Button size="sm" onClick={() => approve(job.id, currentStep.id)}>Approve gate & continue</Button>
                  <Button size="sm" variant="outline" onClick={() => reject(job.id, currentStep.id)}>Reject</Button>
                </div>
              </div>
            )}

            {job.errorMessage && (
              <div className="mt-4 rounded-xl border border-danger/30 bg-danger/10 p-3 text-sm text-danger">
                {humanError(job.errorMessage, 'The job')}
              </div>
            )}

            {!!job.warnings?.length && (() => {
              // One line per distinct problem, in plain words, with a count.
              const notes = dedupeMessages(job.warnings)
              return (
                <details className="mt-4 rounded-xl border border-line bg-bg/40 p-3 text-xs text-muted" open={notes.length <= 3}>
                  <summary className="cursor-pointer select-none font-semibold text-text">
                    {notes.length} note{notes.length === 1 ? '' : 's'} from this run
                  </summary>
                  <ul className="mt-2 list-disc space-y-1.5 pl-4 leading-relaxed">
                    {notes.map((note) => (
                      <li key={note.text}>
                        {note.text}
                        {note.count > 1 && <span className="ml-1.5 rounded bg-panel-alt px-1.5 py-0.5 font-mono text-[10px] text-muted">×{note.count}</span>}
                      </li>
                    ))}
                  </ul>
                </details>
              )
            })()}

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
