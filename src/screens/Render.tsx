import { useState } from 'react'
import { MatrixLoader } from '../components/loaders/MatrixLoader'
import { Download, FolderOpen, Rocket, Square, RectangleHorizontal, RectangleVertical, X } from 'lucide-react'
import { Badge } from '../components/Badge'
import { Button } from '../components/Button'
import { Card } from '../components/Card'
import { EmptyState } from '../components/EmptyState'
import { NoProject } from '../components/NoProject'
import { ProgressBar } from '../components/ProgressBar'
import { Segmented } from '../components/Segmented'
import type { RenderJob } from '../types/project'
import { getIpc } from '../lib/bridge'
import { pauseRender, resumeRender } from '../lib/render'
import { useActiveProject, useProjectStore } from '../state/useProjectStore'
import { cx, fmtDur, relTime } from '../lib/utils'

const PRESETS = [
  { id: 'yt', label: 'YouTube 1080p', aspect: '16:9' as const, fps: 30 as const, quality: 'final' as const },
  { id: 'shorts', label: 'Shorts 1080×1920', aspect: '9:16' as const, fps: 60 as const, quality: 'final' as const },
  { id: 'x', label: 'X / Twitter 16:9', aspect: '16:9' as const, fps: 30 as const, quality: 'draft' as const },
]

const DIMS: Record<RenderJob['aspect'], string> = {
  '16:9': '1920×1080',
  '9:16': '1080×1920',
  '1:1': '1080×1080',
}

export function Render() {
  const project = useActiveProject()
  const startRender = useProjectStore((s) => s.startRender)
  const retryRender = useProjectStore((s) => s.retryRender)
  const cancelRender = useProjectStore((s) => s.cancelRender)
  const updateRenderJob = useProjectStore((s) => s.updateRenderJob)
  const pushToast = useProjectStore((s) => s.pushToast)

  const [aspect, setAspect] = useState<RenderJob['aspect']>('9:16')
  const [fps, setFps] = useState<RenderJob['fps']>(30)
  const [quality, setQuality] = useState<RenderJob['quality']>('draft')
  const [presetId, setPresetId] = useState('custom')

  if (!project) return <NoProject />

  const jobs = [...project.renderJobs].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
  const total = project.timeline.reduce((acc, c) => acc + c.durationSec, 0)
  const canRender = project.timeline.length > 0 || Boolean(project.brief.lockedRundown)

  function applyPreset(id: string) {
    setPresetId(id)
    const p = PRESETS.find((x) => x.id === id)
    if (p) {
      setAspect(p.aspect)
      setFps(p.fps)
      setQuality(p.quality)
    }
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto grid w-full max-w-6xl grid-cols-1 gap-5 px-6 py-6 lg:grid-cols-[360px_1fr]">
        {/* Export settings */}
        <Card className="h-fit space-y-5 p-4">
          <div className="text-sm font-semibold">Export settings</div>

          <div>
            <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">Aspect ratio</div>
            <div className="grid grid-cols-3 gap-2">
              {(
                [
                  { v: '16:9', Icon: RectangleHorizontal },
                  { v: '9:16', Icon: RectangleVertical },
                  { v: '1:1', Icon: Square },
                ] as const
              ).map(({ v, Icon }) => {
                const active = aspect === v
                return (
                  <button
                    key={v}
                    type="button"
                    aria-pressed={active}
                    onClick={() => {
                      setAspect(v)
                      setPresetId('custom')
                    }}
                    className={cx(
                      'flex flex-col items-center gap-1.5 rounded-xl border px-2 py-3 transition-colors duration-150',
                      active ? 'border-accent/60 bg-accent/5 text-text' : 'border-line text-muted hover:border-text/20 hover:text-text',
                    )}
                  >
                    <Icon size={18} className={active ? 'text-accent-text' : 'text-muted'} />
                    <span className="text-xs font-medium">{v}</span>
                    <span className="font-mono text-xs tabular-nums text-muted">{DIMS[v]}</span>
                  </button>
                )
              })}
            </div>
          </div>

          <div>
            <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">Frame rate</div>
            <Segmented
              label="Frame rate"
              value={String(fps)}
              onChange={(v) => {
                setFps(Number(v) as RenderJob['fps'])
                setPresetId('custom')
              }}
              options={[
                { value: '30', label: '30 fps' },
                { value: '60', label: '60 fps' },
              ]}
            />
          </div>

          <div>
            <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">Quality</div>
            <Segmented
              label="Quality"
              value={quality}
              onChange={(v) => {
                setQuality(v)
                setPresetId('custom')
              }}
              options={[
                { value: 'draft', label: 'Draft' },
                { value: 'final', label: 'Final' },
              ]}
            />
            <p className="mt-1.5 text-xs text-muted">Draft ≈ fast proxy · Final = slower, higher quality H.264.</p>
          </div>

          <div>
            <label htmlFor="render-preset" className="mb-2 block text-xs font-semibold uppercase tracking-wider text-muted">
              Preset
            </label>
            <select
              id="render-preset"
              value={presetId}
              onChange={(e) => applyPreset(e.target.value)}
              className="w-full rounded-lg border border-line bg-panel-alt px-3 py-2 text-sm"
            >
              <option value="custom">Custom</option>
              {PRESETS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          </div>

          <div className="rounded-lg bg-panel-alt px-3 py-2.5 text-xs tabular-nums text-muted">
            Est. output: {fmtDur(total)} · {DIMS[aspect]} · {fps}fps · {quality}
          </div>

          <Button
            variant="primary"
            className="w-full"
            disabled={!canRender} title={(!canRender) ? 'Add clips to the timeline or lock a rundown in Brief first' : undefined}
            onClick={() => startRender(project.id, { aspect, fps, quality })}
          >
            <Rocket size={15} />
            Start render
          </Button>
          {!canRender && (
            <p className="-mt-3 text-xs text-muted">Add a Timeline clip or lock a Brief rundown first.</p>
          )}
          {project.timeline.length === 0 && project.brief.lockedRundown && (
            <p className="-mt-3 text-xs text-accent-text">No timeline clips yet — this will create a real generated video from the locked rundown.</p>
          )}
        </Card>

        {/* Queue */}
        <div className="space-y-3">
          <div className="flex items-baseline justify-between">
            <h2 className="text-sm font-semibold">Render queue</h2>
            <span className="text-xs tabular-nums text-muted">{jobs.length} job{jobs.length === 1 ? '' : 's'}</span>
          </div>
          {jobs.length === 0 ? (
            <EmptyState
              icon={Rocket}
              title="No renders yet"
              hint="Set your export settings and start the first render — progress streams here."
            />
          ) : (
            jobs.map((job) => (
              <JobRow
                key={job.id}
                job={job}
                onRetry={() => retryRender(project.id, job.id)}
                onCancel={() => cancelRender(project.id, job.id)}
                onPause={async () => {
                  const paused = await pauseRender(job.id)
                  if (paused) updateRenderJob(project.id, job.id, { status: 'paused' })
                }}
                onResume={async () => {
                  const resumed = await resumeRender(job.id)
                  if (resumed) updateRenderJob(project.id, job.id, { status: 'rendering' })
                }}
                onDownload={async () => {
                  if (job.outputPath?.startsWith('blob:') || job.outputPath?.startsWith('data:')) {
                    const a = document.createElement('a')
                    a.href = job.outputPath
                    a.download = job.outputName || 'newbrand-render.webm'
                    a.click()
                    pushToast('success', `Downloaded ${job.outputName || 'browser render'}`)
                  }
                  else if (job.outputPath && getIpc()) {
                    const result = (await getIpc()!.invoke('render:copyToDownloads', job.outputPath)) as
                      | { ok?: boolean; outputPath?: string; error?: string }
                      | null
                    if (result?.error) pushToast('error', `Copy failed — ${result.error}`)
                    else pushToast('success', `Copied to Downloads${result?.outputPath ? ` — ${result.outputPath}` : ''}`)
                  }
                  else pushToast('info', 'Finish a render before downloading')
                }}
                onReveal={async () => {
                  if (job.outputPath && getIpc()) await getIpc()!.invoke('render:reveal', job.outputPath)
                  else if (job.outputPath?.startsWith('blob:')) window.open(job.outputPath, '_blank', 'noopener,noreferrer')
                  else pushToast('info', 'This render has no desktop output yet')
                }}
              />
            ))
          )}
        </div>
      </div>
    </div>
  )
}

function JobRow({
  job,
  onRetry,
  onCancel,
  onPause,
  onResume,
  onDownload,
  onReveal,
}: {
  job: RenderJob
  onRetry: () => void
  onCancel: () => void
  onPause: () => void
  onResume: () => void
  onDownload: () => void
  onReveal: () => void
}) {
  const tone: 'accent' | 'info' | 'danger' | 'neutral' =
    job.status === 'done' ? 'accent' : job.status === 'error' ? 'danger' : job.status === 'rendering' || job.status === 'working' ? 'info' : 'neutral'
  return (
    <Card className="space-y-3 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate font-mono text-sm font-medium">{job.outputName}</div>
          <div className="mt-0.5 text-xs tabular-nums text-muted">
            {job.aspect} · {job.fps}fps · {job.quality} · started {relTime(job.createdAt)}
          </div>
        </div>
        <Badge tone={tone}>{job.status}</Badge>
      </div>

      {(job.status === 'rendering' || job.status === 'working' || job.status === 'queued' || job.status === 'paused') && (
        <div className="flex items-center gap-3">
          <MatrixLoader variant={job.status === 'queued' ? 'pulse' : 'scan'} disabled={job.status === 'paused'} label={`Render ${job.status}`} />
          <ProgressBar pct={job.progressPct} />
          <span className="w-10 shrink-0 text-right font-mono text-xs tabular-nums text-muted">
            {Math.round(job.progressPct)}%
          </span>
          {job.status === 'paused' ? (
            <Button size="sm" variant="outline" onClick={onResume}>Resume</Button>
          ) : (
            <Button size="sm" variant="ghost" onClick={onPause}>Pause</Button>
          )}
          <Button size="sm" variant="ghost" onClick={onCancel}>
            <X size={13} />
            Cancel
          </Button>
        </div>
      )}

      {job.status === 'done' && (
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={onDownload}>
            <Download size={14} />
            Download
          </Button>
          <Button size="sm" variant="ghost" onClick={onReveal}>
            <FolderOpen size={14} />
            Reveal
          </Button>
        </div>
      )}

      {job.status === 'error' && (
        <div className="flex items-center justify-between gap-3">
          <span className="text-xs text-danger">{job.errorMessage ?? `Worker stopped at ${Math.round(job.progressPct)}%.`}</span>
          <Button size="sm" variant="outline" onClick={onRetry}>
            Retry
          </Button>
        </div>
      )}
    </Card>
  )
}
