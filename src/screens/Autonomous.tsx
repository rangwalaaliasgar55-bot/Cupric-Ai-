import { useState } from 'react'
import { Card } from '../components/Card'
import { Button } from '../components/Button'
import { ProgressBar } from '../components/ProgressBar'
import { useProjectStore } from '../state/useProjectStore'
import type { AutomationMode, VotingMode } from '../types/project'

export function Autonomous() {
  const jobs = useProjectStore(s => s.automationJobs)
  const start = useProjectStore(s => s.startAutomationJob)
  const cancel = useProjectStore(s => s.cancelAutomationJob)
  const resume = useProjectStore(s => s.resumeAutomationJob)
  const [brief, setBrief] = useState('')
  const [mode, setMode] = useState<AutomationMode>('auto-draft')
  const [vote, setVote] = useState<VotingMode>('local-scoring')
  const [aspect, setAspect] = useState<'16:9'|'9:16'|'1:1'>('16:9')
  const [fps, setFps] = useState<30|60>(30)
  const [quality, setQuality] = useState<'draft'|'final'>('draft')
  const [footageFolder, setFootageFolder] = useState<string | null>(null)
  const [outputFolder, setOutputFolder] = useState<string | null>(null)
  const pickFolder = async (setter: (v: string | null) => void) => { const ipc = (window as any).northframe?.ipc; if (ipc) setter(await ipc.invoke('dialog:pickFolder')) }
  const job = jobs[0]
  return <div className="h-full overflow-y-auto p-8"><div className="mx-auto max-w-4xl space-y-5">
    <div><p className="font-mono text-xs uppercase tracking-widest text-accent-text">Autonomous production</p><h1 className="mt-2 text-3xl font-semibold">One brief. Finished MP4.</h1><p className="mt-2 text-sm text-muted">Cupric AI runs the creative pipeline while keeping review gates visible.</p></div>
    <Card><label className="text-sm font-medium">Project goal / brief</label><textarea value={brief} onChange={e=>setBrief(e.target.value)} placeholder="Describe the video, audience, message, and feeling…" className="mt-3 min-h-28 w-full rounded-lg border border-line bg-bg p-3 text-sm outline-none focus:border-accent" />
      <div className="mt-4 grid gap-3 sm:grid-cols-2"><Button variant="outline" onClick={()=>pickFolder(setFootageFolder)}>Footage folder {footageFolder ? '✓' : '(optional)'}</Button><Button variant="outline" onClick={()=>pickFolder(setOutputFolder)}>Output folder {outputFolder ? '✓' : '(optional)'}</Button></div><div className="mt-5 grid gap-4 sm:grid-cols-3"><label className="text-xs text-muted">Aspect<select value={aspect} onChange={e=>setAspect(e.target.value as any)} className="mt-2 block w-full rounded border border-line bg-bg p-2 text-text"><option>16:9</option><option>9:16</option><option>1:1</option></select></label><label className="text-xs text-muted">Frame rate<select value={fps} onChange={e=>setFps(Number(e.target.value) as 30|60)} className="mt-2 block w-full rounded border border-line bg-bg p-2 text-text"><option value="30">30 fps</option><option value="60">60 fps</option></select></label><label className="text-xs text-muted">Quality<select value={quality} onChange={e=>setQuality(e.target.value as any)} className="mt-2 block w-full rounded border border-line bg-bg p-2 text-text"><option value="draft">Draft</option><option value="final">Final</option></select></label></div>
      <div className="mt-5 grid gap-4 sm:grid-cols-2"><label className="text-xs text-muted">Autonomy<select value={mode} onChange={e=>setMode(e.target.value as AutomationMode)} className="mt-2 block w-full rounded border border-line bg-bg p-2 text-text"><option value="guided">Guided</option><option value="auto-draft">Auto Draft</option><option value="auto-final">Auto Final</option></select></label><label className="text-xs text-muted">Voting<select value={vote} onChange={e=>setVote(e.target.value as VotingMode)} className="mt-2 block w-full rounded border border-line bg-bg p-2 text-text"><option value="local-scoring">Local model battle scoring</option><option value="manual-arena">Manual Arena vote</option><option value="official-arena-api">Official Arena API</option></select></label></div>
      <div className="mt-5 flex justify-end"><Button onClick={()=>start({brief, footageFolder, outputFolder, aspect, fps, quality, mode, votingMode: vote})} disabled={!brief.trim()}>Start autonomous job</Button></div>
    </Card>
    {job && <Card><div className="flex items-center justify-between"><div><h2 className="font-medium">{job.status === 'done' ? 'Production complete' : 'Production timeline'}</h2><p className="text-xs text-muted">{job.votingMode === 'manual-arena' ? 'Manual Arena is a required review gate.' : 'Local scoring never automates public voting.'}</p></div><div className="flex gap-2">{job.status==='running' && <Button variant="outline" onClick={()=>cancel(job.id)}>Cancel</Button>}{(job.status==='cancelled'||job.status==='error') && <Button onClick={()=>resume(job.id)}>Resume</Button>}</div></div><div className="mt-5 space-y-3">{job.steps.map(s=><div key={s.id}><div className="flex justify-between text-xs"><span>{s.label}</span><span className="text-muted">{s.status}</span></div><ProgressBar pct={s.progressPct} className="mt-1" /></div>)}</div></Card>}
  </div></div>
}
