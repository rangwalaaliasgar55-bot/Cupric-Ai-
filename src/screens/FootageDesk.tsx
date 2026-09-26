import { useMemo, useRef, useState } from 'react'
import { Check, ChevronRight, Film, Loader2, Square, RectangleHorizontal, RectangleVertical, Upload, X } from 'lucide-react'
import { Badge } from '../components/Badge'
import { Button } from '../components/Button'
import { Card } from '../components/Card'
import { EmptyState } from '../components/EmptyState'
import { NoProject } from '../components/NoProject'
import { ProgressBar } from '../components/ProgressBar'
import { Segmented } from '../components/Segmented'
import type { FootageAsset } from '../types/project'
import { uploadFootage } from '../lib/arena'
import { useActiveProject, useProjectStore } from '../state/useProjectStore'
import { cx, fmtDur, hashStr, mulberry32, round1 } from '../lib/utils'

const CAPTIONS = [
  {
    id: 'hormozi' as const,
    label: 'Hormozi',
    preview: (
      <span
        className="text-center text-sm font-black uppercase italic leading-tight tracking-tight text-white"
        style={{ textShadow: '2px 2px 0 #000, -2px 2px 0 #000, 2px -2px 0 #000, -2px -2px 0 #000' }}
      >
        SHIPPING <span className="text-accent">NOW</span>
      </span>
    ),
  },
  {
    id: 'standard' as const,
    label: 'Standard',
    preview: (
      <span
        className="text-center text-sm font-bold leading-tight text-white"
        style={{ textShadow: '1px 1px 0 #000, -1px 1px 0 #000, 1px -1px 0 #000, -1px -1px 0 #000' }}
      >
        Shipping now.
      </span>
    ),
  },
  {
    id: 'minimal' as const,
    label: 'Minimal',
    preview: <span className="rounded-md bg-black/70 px-2 py-0.5 text-center text-xs font-medium text-white">Shipping now.</span>,
  },
]

export function FootageDesk() {
  const project = useActiveProject()
  const addFootageAsset = useProjectStore((s) => s.addFootageAsset)
  const pushToast = useProjectStore((s) => s.pushToast)

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const [uploading, setUploading] = useState<{ name: string; pct: number } | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  if (!project) return <NoProject />

  const assets = project.footageAssets
  const selected = assets.find((f) => f.id === selectedId) ?? null

  async function handleDrop(file: File | null) {
    if (!project || uploading) return
    const name = file?.name ?? `raw-clip-${Math.floor(Math.random() * 900 + 100)}.mp4`
    setUploading({ name, pct: 0 })
    const res = await uploadFootage(file, project.id, (pct) => setUploading((cur) => (cur ? { ...cur, pct } : cur)))
    const id = addFootageAsset(project.id, {
      name,
      durationSec: res.durationSec,
      status: 'uploaded',
      silenceRanges: res.silenceRanges,
      captionStyle: 'standard',
      crop: '9:16',
    })
    setUploading(null)
    setSelectedId(id)
    pushToast('success', `${name} scanned — ${res.silenceRanges.length} silence cut${res.silenceRanges.length === 1 ? '' : 's'} found`)
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto w-full max-w-5xl space-y-5 px-6 py-6">
        <div>
          <h1 className="text-lg font-bold">Footage Desk</h1>
          <p className="text-sm text-muted">
            Drop raw video — silences get marked, captions and crop get chosen, one click applies the edit.
          </p>
        </div>

        {/* Upload zone */}
        <div
          role="button"
          tabIndex={0}
          aria-label="Upload raw footage"
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
          {uploading ? (
            <>
              <Loader2 size={18} className="motion-safe:animate-spin text-accent-text" />
              <div className="text-sm font-medium">Scanning {uploading.name} for silences…</div>
              <div className="w-56">
                <ProgressBar pct={uploading.pct} />
              </div>
              <div className="font-mono text-xs tabular-nums text-muted">{uploading.pct}%</div>
            </>
          ) : (
            <>
              <Upload size={18} className="text-muted" />
              <div className="text-sm font-medium">Drop raw video here</div>
              <div className="text-xs text-muted">MP4 / MOV — audio is scanned locally (mocked)</div>
            </>
          )}
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="video/*"
          className="hidden"
          aria-hidden
          tabIndex={-1}
          onChange={(e) => {
            handleDrop(e.target.files?.[0] ?? null)
            e.currentTarget.value = ''
          }}
        />

        {/* Asset list */}
        {assets.length === 0 ? (
          <EmptyState
            icon={Film}
            title="No footage yet"
            hint="Drop a raw video above. The auto-edit finds silent stretches and marks them for removal."
          />
        ) : (
          <div className="space-y-2">
            {assets.map((f) => {
              const isSel = f.id === selectedId
              return (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => setSelectedId(f.id)}
                  aria-pressed={isSel}
                  className={cx(
                    'flex w-full items-center gap-3 rounded-xl border px-4 py-3 text-left transition-colors duration-150',
                    isSel ? 'border-accent/50 bg-panel' : 'border-line bg-panel/40 hover:border-text/20',
                  )}
                >
                  <Film size={16} className={isSel ? 'text-accent-text' : 'text-muted'} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{f.name}</div>
                    <div className="text-xs tabular-nums text-muted">
                      {fmtDur(f.durationSec)} · {f.silenceRanges.length} silence cut{f.silenceRanges.length === 1 ? '' : 's'} · {f.crop} · {f.captionStyle}
                    </div>
                  </div>
                  <Badge tone={f.status === 'edited' ? 'accent' : 'neutral'}>
                    {f.status === 'edited' && <Check size={11} />}
                    {f.status}
                  </Badge>
                  <ChevronRight size={15} className="text-muted/60" />
                </button>
              )
            })}
          </div>
        )}

        {/* Detail panel — waveform is the centerpiece */}
        {selected && <FootageDetail key={selected.id} asset={selected} />}
      </div>
    </div>
  )
}

function FootageDetail({ asset }: { asset: FootageAsset }) {
  const project = useActiveProject()
  const updateFootageAsset = useProjectStore((s) => s.updateFootageAsset)
  const pushToast = useProjectStore((s) => s.pushToast)
  const [caption, setCaption] = useState(asset.captionStyle)
  const [crop, setCrop] = useState(asset.crop)
  if (!project) return null

  const cuts = asset.silenceRanges
  const cutTotal = cuts.reduce((acc, [a, b]) => acc + (b - a), 0)

  function apply() {
    updateFootageAsset(project!.id, asset.id, {
      status: 'edited',
      captionStyle: caption,
      crop,
    })
    pushToast('success', 'Edit applied — clip is ready for the Timeline')
  }

  return (
    <Card className="overflow-hidden">
      <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold">{asset.name}</div>
          <div className="text-xs text-muted">Review silence cuts, captions and crop — then apply.</div>
        </div>
        <Badge tone={asset.status === 'edited' ? 'accent' : 'neutral'}>{asset.status}</Badge>
      </div>

      <div className="space-y-6 p-4">
        <Waveform
          seed={asset.id}
          duration={asset.durationSec}
          cuts={cuts}
          onExclude={(i) =>
            updateFootageAsset(project.id, asset.id, {
              silenceRanges: cuts.filter((_, idx) => idx !== i),
            })
          }
        />

        <div>
          <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">Caption style</div>
          <div className="grid grid-cols-3 gap-3">
            {CAPTIONS.map((c) => {
              const active = caption === c.id
              return (
                <button
                  key={c.id}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setCaption(c.id)}
                  className={cx(
                    'rounded-xl border p-3 transition-colors duration-150',
                    active ? 'border-accent/60 bg-accent/5' : 'border-line hover:border-text/20',
                  )}
                >
                  <div className="flex h-16 items-center justify-center rounded-lg bg-[#08080c] px-2">{c.preview}</div>
                  <div className="mt-2 flex items-center justify-center gap-1.5 text-xs font-medium">
                    <span
                      className={cx(
                        'inline-block h-3 w-3 rounded-full border',
                        active ? 'border-accent bg-accent' : 'border-muted/60',
                      )}
                    />
                    {c.label}
                  </div>
                </button>
              )
            })}
          </div>
        </div>

        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">Crop / aspect</div>
            <Segmented
              label="Crop / aspect"
              value={crop}
              onChange={setCrop}
              options={[
                { value: '16:9', label: '16:9', icon: <RectangleHorizontal size={13} /> },
                { value: '9:16', label: '9:16', icon: <RectangleVertical size={13} /> },
                { value: '1:1', label: '1:1', icon: <Square size={13} /> },
              ]}
            />
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs tabular-nums text-muted">
              {cuts.length} cut{cuts.length === 1 ? '' : 's'} → −{round1(cutTotal)}s
            </span>
            <Button variant="primary" onClick={apply}>
              Apply edit
            </Button>
          </div>
        </div>
      </div>
    </Card>
  )
}

/** Deterministic waveform + red silence overlays, each excludable. */
function Waveform({
  seed,
  duration,
  cuts,
  onExclude,
}: {
  seed: string
  duration: number
  cuts: [number, number][]
  onExclude: (i: number) => void
}) {
  const bars = useMemo(() => {
    const rnd = mulberry32(hashStr(seed))
    return Array.from({ length: 88 }, () => 0.12 + rnd() * 0.88)
  }, [seed])

  return (
    <div>
      <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">Silence map</div>
      <div className="relative h-28 overflow-hidden rounded-lg border border-line bg-bg/60 px-1.5">
        <div className="flex h-full items-center gap-[2px]">
          {bars.map((h, i) => (
            <div key={i} className="flex-1 rounded-sm bg-text/20" style={{ height: `${h * 100}%` }} />
          ))}
        </div>
        {cuts.map(([a, b], i) => (
          <div
            key={`${a}-${b}`}
            className="absolute inset-y-0 border-x border-danger/60 bg-danger/20"
            style={{ left: `${(a / duration) * 100}%`, width: `${((b - a) / duration) * 100}%` }}
          >
            <button
              type="button"
              aria-label={`Exclude cut ${i + 1} (${(b - a).toFixed(1)}s)`}
              onClick={() => onExclude(i)}
              className="absolute right-0.5 top-0.5 flex h-5 w-5 items-center justify-center rounded-md bg-danger/85 text-white transition-transform duration-150 hover:bg-danger active:scale-[0.96]"
            >
              <X size={11} />
            </button>
            <span className="absolute bottom-0.5 left-1 font-mono text-xs tabular-nums text-danger">
              −{(b - a).toFixed(1)}s
            </span>
          </div>
        ))}
      </div>
      <div className="mt-1 flex justify-between font-mono text-xs tabular-nums text-muted">
        <span>0:00</span>
        <span>{fmtDur(duration)}</span>
      </div>
    </div>
  )
}
