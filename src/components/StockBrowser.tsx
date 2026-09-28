import { useEffect, useState } from 'react'
import { ThinkingStates } from './loaders/ThinkingStates'
import { MatrixLoader } from './loaders/MatrixLoader'
import { Download, ExternalLink, Loader2, Search, ShieldCheck } from 'lucide-react'
import { Badge } from './Badge'
import { Button } from './Button'
import { Card } from './Card'
import { getIpc } from '../lib/bridge'
import { registerUrl } from '../lib/studio/media'
import { placeClip, studioOf } from '../lib/studio/doc'
import { uid } from '../lib/utils'
import { useActiveProject, useProjectStore } from '../state/useProjectStore'
import type { StudioMediaClip } from '../types/project'

type Provider = 'openverse' | 'picsum' | 'pixabay' | 'pexels'
type Kind = 'image' | 'video'
type StockResult = {
  provider: Provider; id: string; kind: Kind; title: string; user?: string; photographer?: string
  previewUrl: string; downloadUrl: string; pageUrl: string; attribution: string; license?: string
  placeholderOnly?: boolean
}
type KeyStatus = { pixabay: boolean; pexels: boolean; proxy: boolean; keyless: boolean }

const PROVIDERS: Array<{ id: Provider; label: string; note: string }> = [
  { id: 'openverse', label: 'Openverse', note: 'CC / public-domain images with required creator and licence credit' },
  { id: 'picsum', label: 'Picsum placeholders', note: 'Seeded placeholders for drafts and mood boards; replace before publishing' },
  { id: 'pixabay', label: 'Pixabay', note: 'Photos and video; server-side key or proxy required' },
  { id: 'pexels', label: 'Pexels', note: 'Photos and video; server-side key or proxy required' },
]

export function StockBrowser() {
  const project = useActiveProject()
  const patchStudio = useProjectStore((s) => s.patchStudio)
  const pushToast = useProjectStore((s) => s.pushToast)
  const [provider, setProvider] = useState<Provider>('openverse')
  const [kind, setKind] = useState<Kind>('image')
  const [query, setQuery] = useState('mountain lake')
  const [orientation, setOrientation] = useState('all')
  const [results, setResults] = useState<StockResult[]>([])
  const [status, setStatus] = useState<KeyStatus>({ pixabay: false, pexels: false, proxy: false, keyless: true })
  const [busy, setBusy] = useState(false)
  const [downloading, setDownloading] = useState<string | null>(null)
  const [message, setMessage] = useState('')
  const [observedQuota, setObservedQuota] = useState<{ limit?: string | null; remaining?: string | null; reset?: string | null } | null>(null)

  useEffect(() => {
    const ipc = getIpc()
    if (!ipc) return
    void ipc.invoke('stock:keyStatus').then((value) => setStatus(value as KeyStatus)).catch(() => undefined)
  }, [])

  async function search() {
    const ipc = getIpc()
    if (!ipc) { setMessage('Stock search is available in the desktop app.'); return }
    setBusy(true); setMessage('')
    try {
      const result = await ipc.invoke('stock:search', { provider, kind: provider === 'picsum' ? 'image' : kind, options: { query, orientation, perPage: 8 } }) as { results?: StockResult[]; quota?: { limit?: string | null; remaining?: string | null; reset?: string | null } | null }
      setResults(result.results ?? [])
      setObservedQuota(result.quota || null)
      if (!result.results?.length) setMessage('No results. Try a broader phrase.')
    } catch (err) {
      setResults([])
      setMessage(err instanceof Error ? err.message : String(err))
    } finally { setBusy(false) }
  }

  async function download(item: StockResult) {
    if (!project) { pushToast('info', 'Open a project before downloading stock into the timeline.'); return }
    const ipc = getIpc()
    if (!ipc) return
    setDownloading(item.id)
    try {
      const saved = await ipc.invoke('stock:download', { projectId: project.id, item }) as { localPath: string; fileName: string; kind: Kind; attribution: string; pageUrl: string; source: string; sourceLicense: string | null }
      const url = await ipc.invoke('arena:previewPath', saved.localPath) as string
      const handle = await registerUrl(url, saved.fileName, saved.kind, saved.localPath)
      const durationSec = saved.kind === 'video' ? Math.max(0.2, handle.durationSec || 5) : 5
      const clip: StudioMediaClip = {
        id: uid(), kind: saved.kind, track: 0, startSec: 0, durationSec,
        name: saved.fileName.replace(/\.[^.]+$/, '').slice(0, 28), transitionIn: 'fade', transitionOut: 'fade', opacity: 1,
        mediaId: handle.id, fileName: handle.fileName, localPath: handle.localPath, trimInSec: 0,
        sourceDurationSec: handle.durationSec || durationSec, speed: 1, volume: 1, fit: 'cover', x: 0.5, y: 0.5, scale: 1,
        posterDataUrl: handle.posterDataUrl,
      }
      const doc = studioOf(project)
      const placed = placeClip(doc, clip)
      const credit = { url: saved.pageUrl, source: saved.source, sourceLicense: saved.sourceLicense, attribution: saved.attribution }
      patchStudio(project.id, { clips: [...doc.clips, placed.clip], trackCount: placed.trackCount, credits: [...(doc.credits ?? []), credit] }, `Add ${saved.source} stock`)
      pushToast('success', `${saved.fileName} added as an editable ${saved.kind} clip. Credit saved: ${saved.attribution}`)
    } catch (err) { pushToast('error', err instanceof Error ? err.message : String(err)) }
    finally { setDownloading(null) }
  }

  const keyRequired = provider === 'pixabay' ? !status.pixabay && !status.proxy : provider === 'pexels' ? !status.pexels && !status.proxy : false
  return (
    <Card className="space-y-3 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-sm font-semibold"><Search size={15} /> Stock browser</div>
          <p className="mt-1 max-w-2xl text-xs text-muted">Keyless providers appear first. Results always show their real credit, and downloads are copied into project data before becoming clips.</p>
        </div>
        <Badge tone={status.proxy ? 'accent' : 'info'}><ShieldCheck size={11} /> {status.proxy ? 'Pro stock proxy' : 'No shared key'}</Badge>
      </div>
      <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Stock provider">
        {PROVIDERS.map((item) => <button key={item.id} type="button" role="tab" aria-selected={provider === item.id} onClick={() => { setProvider(item.id); setResults([]); setMessage('') }} className={`rounded-lg border px-2.5 py-1.5 text-xs ${provider === item.id ? 'border-accent bg-accent/10 text-text' : 'border-line text-muted hover:text-text'}`}>{item.label}</button>)}
      </div>
      <p className="text-[11px] text-muted">{PROVIDERS.find((item) => item.id === provider)?.note}</p>
      <form className="flex flex-wrap gap-2" onSubmit={(event) => { event.preventDefault(); void search() }}>
        <input className="cu-input min-w-[220px] flex-1" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={provider === 'picsum' ? 'Seed or mood-board label' : 'Search stock'} aria-label="Stock search" />
        <select className="cu-input w-28" value={kind} onChange={(event) => setKind(event.target.value as Kind)} disabled={provider === 'openverse' || provider === 'picsum'} aria-label="Stock type"><option value="image">Images</option><option value="video">Video</option></select>
        <select className="cu-input w-32" value={orientation} onChange={(event) => setOrientation(event.target.value)} aria-label="Stock orientation"><option value="all">All shapes</option><option value="horizontal">Horizontal</option><option value="vertical">Vertical</option></select>
        <Button variant="primary" type="submit" disabled={busy} title={(busy) ? 'Searching…' : undefined}>{busy ? <Loader2 size={13} className="animate-spin" /> : <Search size={13} />} Search</Button>
      </form>
      {busy && results.length === 0 && (
        <div className="flex items-center gap-2 rounded-md border border-line bg-panel-alt/40 px-2.5 py-2 text-xs" data-testid="stock-searching">
          <MatrixLoader variant="twinkle" label="Searching stock" />
          <ThinkingStates states={[`Searching ${PROVIDERS.find((item) => item.id === provider)?.label ?? 'stock'}${query.trim() ? ` for “${query.trim()}”` : ''}`]} />
        </div>
      )}
      {keyRequired && <p className="rounded-md border border-line bg-panel-alt/50 px-2.5 py-2 text-xs text-muted">{provider === 'pixabay' ? 'Pixabay' : 'Pexels'} is locked until you add your own key in Settings → Stock or configure the owner proxy. Keyless Openverse and Picsum are ready now.</p>}
      {message && <p className="rounded-md border border-danger/30 bg-danger/5 px-2.5 py-2 text-xs text-muted" role="status">{message}</p>}
      {observedQuota && <p className="rounded-md border border-line bg-panel-alt/40 px-2.5 py-2 text-[10px] text-muted" role="status">Live provider quota: {observedQuota.remaining ?? 'unknown'} remaining of {observedQuota.limit ?? 'unknown'}{observedQuota.reset ? ` · resets ${observedQuota.reset}` : ''}</p>}
      {results.length > 0 && <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {results.map((item) => <div key={`${item.provider}-${item.id}`} className="overflow-hidden rounded-lg border border-line bg-panel-alt/50">
          <a href={item.pageUrl} target="_blank" rel="noreferrer" title="Open source page"><img src={item.previewUrl} alt={item.title} className="h-24 w-full object-cover" loading="lazy" /></a>
          <div className="space-y-1.5 p-2"><p className="line-clamp-2 text-[11px] text-text">{item.title}</p><p className="line-clamp-2 text-[10px] text-muted">{item.attribution}</p><Button size="sm" className="w-full" variant="outline" disabled={downloading === item.id || item.placeholderOnly && !project} title={(downloading === item.id || item.placeholderOnly && !project) ? 'Downloading, or open a project to use this placeholder' : undefined} onClick={() => void download(item)}>{downloading === item.id ? <Loader2 size={12} className="animate-spin" /> : <Download size={12} />} {item.placeholderOnly ? 'Add placeholder' : 'Download'}</Button></div>
        </div>)}
      </div>}
      <p className="flex items-center gap-1 text-[10px] text-muted"><ExternalLink size={10} /> Videos are available from Pixabay/Pexels when configured. Openverse results are license-filtered and credited; Picsum is draft-only.</p>
    </Card>
  )
}
