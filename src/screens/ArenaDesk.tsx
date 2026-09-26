import { useRef, useState } from 'react'
import { Check, Copy, FileCode2, Loader2, Lock, Play, Swords, Upload } from 'lucide-react'
import { Badge } from '../components/Badge'
import { Button } from '../components/Button'
import { Card } from '../components/Card'
import { EmptyState } from '../components/EmptyState'
import { IconButton } from '../components/IconButton'
import { Kbd } from '../components/Kbd'
import { Modal } from '../components/Modal'
import { NoProject } from '../components/NoProject'
import { ProgressBar } from '../components/ProgressBar'
import type { ArenaAsset, Project } from '../types/project'
import { importArenaZip } from '../lib/arena'
import { useActiveProject, useProjectStore } from '../state/useProjectStore'
import { copyText, cx, deriveAspect, gradientFor, relTime } from '../lib/utils'

const STATUS_TONE = {
  'prompt-ready': 'neutral',
  'awaiting-vote': 'info',
  imported: 'accent',
  rendered: 'accent',
} as const

export function ArenaDesk() {
  const project = useActiveProject()
  const addArenaAsset = useProjectStore((s) => s.addArenaAsset)
  const startRender = useProjectStore((s) => s.startRender)
  const pushToast = useProjectStore((s) => s.pushToast)
  const setView = useProjectStore((s) => s.setView)

  const [dragOver, setDragOver] = useState(false)
  const [importing, setImporting] = useState<{ name: string; pct: number } | null>(null)
  const [preview, setPreview] = useState<ArenaAsset | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  if (!project) return <NoProject />
  const locked = project.brief.lockedRundown

  if (!locked)
    return (
      <div className="flex h-full items-center justify-center p-8">
        <EmptyState
          icon={Lock}
          title="Arena Desk is locked"
          hint="Lock a rundown in the Brief first — the Arena prompt is generated from it."
          action={
            <Button variant="primary" size="sm" onClick={() => setView('brief')}>
              Go to Brief
            </Button>
          }
          className="max-w-md"
        />
      </div>
    )

  async function handleDrop(file: File | null) {
    if (!project || importing) return
    setImporting({ name: file?.name ?? 'arena-winner.zip', pct: 0 })
    const res = await importArenaZip(file, project.id, (pct) =>
      setImporting((cur) => (cur ? { ...cur, pct } : cur)),
    )
    addArenaAsset(project.id, {
      name: res.htmlFileName,
      status: 'imported',
      prompt: locked!.arenaPrompt,
      htmlFileName: res.htmlFileName,
      thumbnailDataUrl: null,
    })
    setImporting(null)
    pushToast('success', `Imported ${res.htmlFileName} — ready to preview or render`)
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto w-full max-w-5xl space-y-5 px-6 py-6">
        <div>
          <h1 className="text-lg font-bold">Arena Desk</h1>
          <p className="text-sm text-muted">
            Battle two models in arena.ai/code, then import the winning motion piece here.
          </p>
        </div>

        {/* 1. Copy this → 2. Paste → 3. Vote → 4. Drop the zip */}
        <Card className="overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3">
            <div className="text-xs font-semibold uppercase tracking-wider text-muted">Arena prompt</div>
            <PromptCopyButton text={locked.arenaPrompt} />
          </div>
          <pre className="max-h-44 overflow-auto whitespace-pre-wrap break-words bg-bg/40 px-4 py-3 font-mono text-xs leading-relaxed text-text/85">
            {locked.arenaPrompt}
          </pre>
        </Card>
        <p className="text-xs leading-relaxed text-muted">
          <Kbd>1</Kbd> Copy this <span aria-hidden>→</span> <Kbd>2</Kbd> Paste into arena.ai/code{' '}
          <span aria-hidden>→</span> <Kbd>3</Kbd> Vote for a winner <span aria-hidden>→</span>{' '}
          <Kbd>4</Kbd> Drop the downloaded .zip below
        </p>

        {/* Import zone */}
        <div
          role="button"
          tabIndex={0}
          aria-label="Import Arena zip or html file"
          onClick={() => fileRef.current?.click()}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault()
              fileRef.current?.click()
            }
          }}
          onDragOver={(e) => {
            e.preventDefault()
            setDragOver(true)
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault()
            setDragOver(false)
            handleDrop(e.dataTransfer.files?.[0] ?? null)
          }}
          className={cx(
            'flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border border-dashed px-6 py-9 text-center transition-all duration-150',
            dragOver ? 'scale-[1.01] border-accent bg-accent/5' : 'border-line bg-panel/40 hover:border-muted/50',
          )}
        >
          {importing ? (
            <>
              <Loader2 size={18} className="motion-safe:animate-spin text-accent-text" />
              <div className="text-sm font-medium">Importing {importing.name}</div>
              <div className="w-56">
                <ProgressBar pct={importing.pct} />
              </div>
              <div className="font-mono text-xs tabular-nums text-muted">{importing.pct}%</div>
            </>
          ) : (
            <>
              <Upload size={18} className="text-muted" />
              <div className="text-sm font-medium">Drop the Arena .zip / .html here</div>
              <div className="text-xs text-muted">or click to browse — import runs locally (mocked)</div>
            </>
          )}
        </div>
        <input
          ref={fileRef}
          type="file"
          accept=".zip,.html"
          className="hidden"
          aria-hidden
          tabIndex={-1}
          onChange={(e) => {
            handleDrop(e.target.files?.[0] ?? null)
            e.currentTarget.value = ''
          }}
        />

        {/* Asset grid */}
        {project.arenaAssets.length === 0 ? (
          <EmptyState
            icon={Swords}
            title="No Arena assets yet"
            hint="Win a battle in arena.ai/code and drop the file above — it lands here as an owned asset."
          />
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {project.arenaAssets.map((a) => (
              <ArenaCard
                key={a.id}
                asset={a}
                onPreview={() => setPreview(a)}
                onBrowse={() => fileRef.current?.click()}
                onRender={() => {
                  startRender(project.id, {
                    aspect: deriveAspect(locked.size),
                    fps: locked.fps === 60 ? 60 : 30,
                    quality: 'draft',
                    label: a.htmlFileName ?? a.name,
                  })
                }}
              />
            ))}
          </div>
        )}
      </div>

      <PreviewModal
        asset={preview}
        project={project}
        onClose={() => setPreview(null)}
        onRender={() => {
          if (!preview) return
          startRender(project.id, {
            aspect: deriveAspect(locked.size),
            fps: locked.fps === 60 ? 60 : 30,
            quality: 'draft',
            label: preview.htmlFileName ?? preview.name,
          })
          setPreview(null)
        }}
      />
    </div>
  )
}

/** Copy → inline check, not a toast (finish-pass rule). */
function PromptCopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <Button
      size="sm"
      variant={copied ? 'outline' : 'primary'}
      onClick={async () => {
        if (await copyText(text)) {
          setCopied(true)
          window.setTimeout(() => setCopied(false), 1600)
        }
      }}
      className="min-w-[118px]"
    >
      {copied ? (
        <>
          <Check size={14} className="text-accent-text" /> Copied
        </>
      ) : (
        <>
          <Copy size={14} /> Copy prompt
        </>
      )}
    </Button>
  )
}

function ArenaCard({
  asset,
  onPreview,
  onBrowse,
  onRender,
}: {
  asset: ArenaAsset
  onPreview: () => void
  onBrowse: () => void
  onRender: () => void
}) {
  const [copied, setCopied] = useState(false)

  return (
    <Card className="flex flex-col overflow-hidden">
      <div className={cx('relative flex aspect-video w-full items-center justify-center', gradientFor(asset.id))}>
        <FileCode2 size={22} className="text-white/70" />
        <Badge tone={STATUS_TONE[asset.status]} className="absolute right-2 top-2">
          {asset.status === 'rendered' && <Check size={11} />}
          {asset.status}
        </Badge>
      </div>
      <div className="flex flex-1 flex-col gap-2 p-4">
        <div className="truncate text-sm font-semibold">{asset.name}</div>
        <div className="text-xs text-muted">Added {relTime(asset.createdAt)}</div>
        <div className="mt-auto flex flex-wrap items-center gap-1.5 pt-2">
          {asset.status === 'prompt-ready' && (
            <Button
              size="sm"
              variant="outline"
              onClick={async () => {
                if (await copyText(asset.prompt)) {
                  setCopied(true)
                  window.setTimeout(() => setCopied(false), 1600)
                }
              }}
            >
              {copied ? <Check size={13} className="text-accent-text" /> : <Copy size={13} />}
              {copied ? 'Copied' : 'Copy prompt'}
            </Button>
          )}
          {asset.status === 'awaiting-vote' && (
            <>
              <span className="text-xs text-info">Waiting on your vote in arena.ai/code</span>
              <Button size="sm" variant="outline" onClick={onBrowse}>
                <Upload size={13} />
                I won — import file
              </Button>
            </>
          )}
          {(asset.status === 'imported' || asset.status === 'rendered') && (
            <>
              <Button size="sm" variant="outline" onClick={onPreview}>
                <Play size={13} />
                Preview
              </Button>
              <Button size="sm" variant="primary" onClick={onRender}>
                Render to MP4
              </Button>
            </>
          )}
        </div>
      </div>
    </Card>
  )
}

/** Live "iframe-style" mock preview of the imported Arena piece. */
function PreviewModal({
  asset,
  project,
  onClose,
  onRender,
}: {
  asset: ArenaAsset | null
  project: Project
  onClose: () => void
  onRender: () => void
}) {
  const size = project.brief.lockedRundown?.size ?? [1920, 1080]
  const fps = project.brief.lockedRundown?.fps ?? 30
  return (
    <Modal open={!!asset} onClose={onClose} label={asset ? `Preview ${asset.name}` : 'Preview'}>
      {asset && (
        <Card className="overflow-hidden">
          <div className="flex items-center justify-between border-b border-line px-4 py-3">
            <div className="truncate text-sm font-semibold">{asset.name}</div>
            <IconButton label="Close preview" onClick={onClose}>
              <span aria-hidden className="text-sm leading-none">
                ✕
              </span>
            </IconButton>
          </div>
          <div className="relative aspect-video overflow-hidden bg-[#08080c]">
            <div className="nf-drift absolute -left-10 -top-10 h-64 w-64 rounded-full bg-accent/25 blur-3xl" />
            <div className="nf-drift absolute -bottom-16 -right-10 h-72 w-72 rounded-full bg-info/20 blur-3xl" style={{ animationDelay: '-4s' }} />
            <div className="relative flex h-full flex-col items-center justify-center gap-2">
              <FileCode2 size={26} className="text-white/40" />
              <div className="font-mono text-xs text-white/60">{asset.htmlFileName ?? asset.name}</div>
              <Badge tone="accent">sandboxed preview — mocked</Badge>
            </div>
          </div>
          <div className="flex items-center justify-between gap-3 px-4 py-3">
            <span className="font-mono text-xs tabular-nums text-muted">
              {size[0]}×{size[1]} · {fps}fps · __seek(t) verified
            </span>
            <Button size="sm" variant="primary" onClick={onRender}>
              Render to MP4
            </Button>
          </div>
        </Card>
      )}
    </Modal>
  )
}
