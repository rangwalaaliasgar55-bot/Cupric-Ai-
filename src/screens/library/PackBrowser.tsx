import { memo, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState, type DragEvent } from 'react'
import { LoaderPreview } from '../studio/LoaderPreview'
import type { StudioLoaderClip } from '../../types/project'
import { ThinkingStates } from '../../components/loaders/ThinkingStates'
import { MatrixLoader } from '../../components/loaders/MatrixLoader'
import { motion } from 'motion/react'
import {
  Check,
  CloudDownload,
  Copy,
  Layers,
  Loader2,
  Mic,
  RefreshCw,
  Search,
  Sparkles,
  ExternalLink,
  Film,
  Link2,
  Type as TypeIcon,
  Wand2,
  WifiOff,
  Zap,
  History,
  Star,
} from 'lucide-react'
import { filterPackItems, loadFavourites, loadRecent, pushRecent, toggleFavourite, windowRange, type PackFilter } from '../../lib/library/packPrefs'
import { Badge } from '../../components/Badge'
import { Button } from '../../components/Button'
import { ProgressBar } from '../../components/ProgressBar'
import { Modal } from '../../components/Modal'
import { ResourceFinder } from './ResourceFinder'
import { GlassPanel } from '../../components/glass'
import {
  downloadAllPacks,
  isOnline,
  loadPack,
  loadPackIndex,
  offlineStatus,
  PACKS_BASE,
  type Pack,
  type PackIndex,
  type PackItem,
} from '../../lib/packs'
import { docDuration, studioOf } from '../../lib/studio/doc'
import { useActiveProject, useProjectStore } from '../../state/useProjectStore'
import { EASE_SOFT } from '../../lib/motion'
import { useReducedMotion } from '../../lib/use-reduced-motion'
import { resourceDisposition, writeDragPayload, type ResourceDisposition } from '../../lib/studio/resourceDrop'
import { planTemplateFill, templateSlots, type TemplateAssignments, type TemplateFillData } from '../../lib/studio/templateFill'
import { applyLabel } from '../../lib/studio/resourceApply'
import { classifyResource } from '../../lib/studio/resourceLook'
import { briefLines, storyboardCopy, type BriefSource } from '../../lib/studio/storyboard'
import { requestStudioFocus, studioPlayhead } from '../../lib/studio/studioLink'
import { useResourceApply } from './useResourceApply'

const KIND_ICON = {
  glass: Sparkles,
  transition: Zap,
  animation: TypeIcon,
  background: Layers,
  effect: Wand2,
  component: Layers,
  voice: Mic,
  source: Link2,
  template: Film,
  font: TypeIcon,
  skill: Sparkles,
  icon: Sparkles,
  block: Layers,
  provider: Wand2,
  'saas-template': Film,
} as const

/** What Apply produces, in the reader's words. */
const DISPOSITION_LABEL: Record<ResourceDisposition, string> = {
  clip: 'Native clip',
  scene: 'Builds a scene',
  lab: 'Animated capture',
  template: 'Storyboard',
  render: 'Renders to clip',
  font: 'Font',
  command: 'Voice command',
  reference: 'Link',
}

type Source = 'memory' | 'cache' | 'network' | 'local' | 'none'

const SOURCE_LABEL: Record<Source, string> = {
  memory: 'in memory',
  cache: 'offline cache',
  network: 'github',
  local: 'bundled copy',
  none: 'unavailable',
}

export function PackBrowser() {
  const project = useActiveProject()
  const { apply, progress } = useResourceApply()
  const patchStudio = useProjectStore((s) => s.patchStudio)
  const setView = useProjectStore((s) => s.setView)
  const pushToast = useProjectStore((s) => s.pushToast)
  const reduced = useReducedMotion()

  const [index, setIndex] = useState<PackIndex | null>(null)
  const [active, setActive] = useState<string>('glass')
  const [pack, setPack] = useState<Pack | null>(null)
  const [source, setSource] = useState<Source>('none')
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')
  const deferredQuery = useDeferredValue(query)
  const [searchIds, setSearchIds] = useState<Set<string> | null>(null)
  const searchWorker = useRef<Worker | null>(null)
  const [filter, setFilter] = useState<PackFilter>('all')
  const [favourites, setFavourites] = useState<string[]>(() => loadFavourites())
  const [recent, setRecent] = useState<string[]>(() => loadRecent())
  const [downloading, setDownloading] = useState<{ pct: number; label: string } | null>(null)
  const [offline, setOffline] = useState<{ downloaded: string[]; total: number }>({ downloaded: [], total: 0 })
  const [used, setUsed] = useState<Set<string>>(new Set())
  const [online, setOnline] = useState(isOnline())
  const [templateFill, setTemplateFill] = useState<PackItem | null>(null)
  const [templateAssignments, setTemplateAssignments] = useState<TemplateAssignments>({})

  useEffect(() => {
    const update = () => setOnline(isOnline())
    window.addEventListener('online', update)
    window.addEventListener('offline', update)
    return () => {
      window.removeEventListener('online', update)
      window.removeEventListener('offline', update)
    }
  }, [])

  const refreshOffline = useCallback(() => {
    void offlineStatus().then(setOffline)
  }, [])

  useEffect(() => {
    const worker = new Worker(new URL('./packSearch.worker.ts', import.meta.url), { type: 'module' })
    searchWorker.current = worker
    worker.onmessage = (event: MessageEvent<{ ids?: string[] }>) => setSearchIds(new Set(event.data?.ids || []))
    return () => {
      worker.terminate()
      searchWorker.current = null
    }
  }, [])

  useEffect(() => {
    const all = pack?.items ?? []
    setSearchIds(null)
    searchWorker.current?.postMessage({ items: all.map(({ id, name, description, tags }) => ({ id, name, description, tags })), query: deferredQuery })
  }, [pack, deferredQuery])

  useEffect(() => {
    let alive = true
    void loadPackIndex().then(({ index: loaded }) => {
      if (!alive) return
      setIndex(loaded)
      if (loaded && !loaded.packs.some((p) => p.id === active)) setActive(loaded.packs[0]?.id ?? 'glass')
    })
    refreshOffline()
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshOffline])

  useEffect(() => {
    let alive = true
    setLoading(true)
    void loadPack(active).then(({ pack: loaded, source: from }) => {
      if (!alive) return
      setPack(loaded)
      setSource(from)
      setLoading(false)
    })
    return () => {
      alive = false
    }
  }, [active])

  // Stable handlers so memoised cards do not re-render on every keystroke.
  const applyRef = useRef<(item: PackItem) => void>(() => {})
  const customizeRef = useRef<(item: PackItem) => void>(() => {})
  const onApplyStable = useCallback((item: PackItem) => applyRef.current(item), [])
  const onCustomizeStable = useCallback((item: PackItem) => customizeRef.current(item), [])

  const items = useMemo(() => {
    const all = pack?.items ?? []
    if (!deferredQuery.trim()) return all
    if (!searchIds) return []
    return all.filter((item) => searchIds.has(item.id))
  }, [pack, deferredQuery, searchIds])
  // Only the rows on screen are mounted: the grid measures its own width for the
  // column count, then renders the visible row range between two spacers.
  const gridRef = useRef<HTMLDivElement | null>(null)
  const [gridView, setGridView] = useState({ cols: 3, top: 0, height: 900 })
  useEffect(() => {
    const node = gridRef.current
    if (!node) return
    let frame = 0
    const measure = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        const rect = node.getBoundingClientRect()
        const cols = Math.max(1, Math.floor((rect.width + GRID_GAP) / (CARD_MIN_W + GRID_GAP)))
        setGridView((prev) => (prev.cols === cols && Math.abs(prev.top - rect.top) < 1 && prev.height === window.innerHeight ? prev : { cols, top: rect.top, height: window.innerHeight }))
      })
    }
    measure()
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure)
    ro?.observe(node)
    // Scroll events don't bubble, but capture on document sees every scroll container.
    document.addEventListener('scroll', measure, { capture: true, passive: true })
    window.addEventListener('resize', measure)
    return () => {
      cancelAnimationFrame(frame)
      ro?.disconnect()
      document.removeEventListener('scroll', measure, { capture: true })
      window.removeEventListener('resize', measure)
    }
  }, [pack, loading])
  const shownItems = useMemo(() => filterPackItems(items, filter, favourites, recent), [items, filter, favourites, recent])
  const range = windowRange(shownItems.length, gridView.cols, ROW_H, gridView.top, gridView.height)
  const visibleItems = useMemo(() => shownItems.slice(range.start, range.end), [shownItems, range.start, range.end])
  const favSet = useMemo(() => new Set(favourites), [favourites])
  const onFavouriteStable = useCallback((item: PackItem) => setFavourites((cur) => toggleFavourite(item.id, cur)), [])

  const fillSlots = useMemo(
    () => templateFill ? templateSlots((templateFill.data ?? {}) as TemplateFillData) : [],
    [templateFill],
  )
  const fillOptions = useMemo(() => {
    if (!templateFill || !project) return undefined
    const doc = studioOf(project)
    return {
      atSec: studioPlayhead() ?? docDuration(doc),
      brief: briefLines(project as unknown as BriefSource),
      brandName: project.name,
      archetype: classifyResource({ name: templateFill.name, category: String((templateFill.data as { category?: string } | undefined)?.category ?? ''), description: templateFill.description }),
    }
    // Snapshotted when the dialog opens so the preview does not jump while typing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [templateFill])
  const fillCopy = useMemo(
    () => (fillOptions ? storyboardCopy(fillSlots, {}, fillOptions) : []),
    [fillOptions, fillSlots],
  )
  const fillPlan = useMemo(
    () => templateFill && project
      ? planTemplateFill(studioOf(project), (templateFill.data ?? {}) as TemplateFillData, templateAssignments, templateFill.name, fillOptions)
      : null,
    [fillOptions, project, templateAssignments, templateFill],
  )

  async function download() {
    setDownloading({ pct: 0, label: 'Starting' })
    const result = await downloadAllPacks((pct, label) => setDownloading({ pct, label }))
    setDownloading(null)
    refreshOffline()
    if (result.failed.length) pushToast('error', `Downloaded ${result.ok} packs, ${result.failed.length} failed.`)
    else pushToast('success', `All ${result.ok} packs are available offline.`)
  }

  /** Every card's Apply goes through the one shared path (also used by stage drops). */
  applyRef.current = (item) => void addToStudio(item)
  customizeRef.current = (item) => customizeTemplate(item)
  async function addToStudio(item: PackItem) {
    const ok = await apply(item)
    if (ok) markUsed(item)
  }

  /** Templates: the full review dialog, pre-filled with what Apply would use. */
  function customizeTemplate(item: PackItem) {
    if (!project) {
      pushToast('info', 'Open or create a project first — templates apply to its timeline.')
      setView('home')
      return
    }
    setTemplateAssignments({})
    setTemplateFill(item)
  }

  function applyTemplateFill() {
    if (!project || !templateFill || !fillPlan) return
    // One patch means the entire auto-fill is one undo step, never N silent
    // clip mutations. The plan shown in the dialog is exactly what is applied.
    patchStudio(project.id, { clips: fillPlan.doc.clips, trackCount: fillPlan.doc.trackCount })
    requestStudioFocus(fillPlan.focusId, fillPlan.startSec + 0.8)
    markUsed(templateFill)
    const inStudio = studioPlayhead() !== null
    pushToast('success', `“${templateFill.name}” applied: ${fillPlan.clips.length} layers as one undoable edit.`, inStudio ? undefined : {
      action: { label: 'Open Studio', run: () => setView('studio') },
    })
    setTemplateFill(null)
    setTemplateAssignments({})
  }

  function markUsed(item: PackItem) {
    setUsed((prev) => new Set(prev).add(item.id))
    setRecent((cur) => pushRecent(item.id, cur))
  }

  const fullyOffline = offline.total > 0 && offline.downloaded.length === offline.total

  return (
    <section className="space-y-4">
      <ResourceFinder onOpen={(packId, name) => { setActive(packId); setQuery(name) }} />
      <GlassPanel className="flex flex-wrap items-center gap-3 px-4 py-3" preset="frost" radius={14}>
        <div className="min-w-0 flex-1 basis-72">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            Resource packs
            {index && (
              <span className="font-mono text-xs font-normal text-muted">
                v{index.version}.{index.packs.reduce((sum, entry) => sum + entry.itemCount, 0)}
              </span>
            )}
            {!online && (
              <Badge tone="neutral">
                <WifiOff size={11} /> Offline
              </Badge>
            )}
          </h2>
          <p className="mt-0.5 text-xs text-muted">
            Bundled with this Cupric AI release so every installed resource is available offline. The stable repository
            ({PACKS_BASE.replace('https://', '')}) is used only as a fallback.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-3">
        <span className="whitespace-nowrap font-mono text-xs text-muted tabular-nums">
          {offline.downloaded.length}/{offline.total || '—'} cached
        </span>
        <Button size="sm" variant={fullyOffline ? 'outline' : 'primary'} onClick={() => void download()} disabled={downloading !== null} title={(downloading !== null) ? 'Downloading…' : undefined}>
          {downloading ? <Loader2 size={13} className="animate-spin" /> : fullyOffline ? <RefreshCw size={13} /> : <CloudDownload size={13} />}
          {downloading ? 'Downloading…' : fullyOffline ? 'Refresh' : 'Download all'}
        </Button>
        </div>
      </GlassPanel>

      {downloading && (
        <div className="flex items-center gap-3">
          <ProgressBar pct={downloading.pct} className="flex-1" />
          <span className="w-36 truncate text-xs text-muted">{downloading.label}</span>
        </div>
      )}

      <div className="sticky top-0 z-20 -mx-2 flex flex-wrap items-center gap-2 rounded-xl border border-line/70 bg-bg/90 p-2 shadow-lg shadow-black/10 backdrop-blur-xl">
        <label className="flex min-w-56 items-center gap-2 text-xs text-muted">
          <span className="shrink-0 font-medium">Resource pack</span>
          <select
            value={active}
            onChange={(event) => setActive(event.target.value)}
            className="h-8 min-w-0 flex-1 cu-panel px-2 text-xs font-medium text-text"
          >
            {(index?.packs ?? []).map((entry) => (
              <option key={entry.id} value={entry.id}>{entry.name} · {entry.itemCount.toLocaleString()}</option>
            ))}
          </select>
        </label>
        <div className="relative ml-auto min-w-56 flex-1 sm:max-w-80">
          <Search size={13} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search this pack…"
            aria-label="Search pack"
            className="h-8 w-full cu-panel pl-8 pr-3 text-xs placeholder:text-muted/70"
          />
        </div>
        <div className="flex items-center gap-1" role="group" aria-label="Show">
          {(['all', 'favourites', 'recent'] as const).map((f) => (
            <Button key={f} size="sm" variant={filter === f ? 'primary' : 'ghost'} onClick={() => setFilter(f)} aria-pressed={filter === f}>
              {f === 'all' ? 'All' : f === 'favourites' ? <><Star size={12} /> Favourites</> : <><History size={12} /> Recent</>}
            </Button>
          ))}
        </div>
      </div>

      {pack && (
        <p className="text-xs text-muted">
          {pack.description}{' '}
          <span className="opacity-70">· {pack.source} · {pack.license} · loaded from {SOURCE_LABEL[source]}</span>
          {/* F-3: a stale dot whenever the on-screen catalogue came from a
              cache rather than this build — honest, inline, no dialog. */}
          {(source === 'cache' || !online) && (
            <span className="ml-1.5 inline-flex items-center gap-1 align-middle" title={online ? 'Shown from the offline cache — refresh when convenient.' : 'You are offline — this is the cached catalogue.'}>
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-info" aria-hidden />
              <span>{online ? 'cached copy' : 'offline — cached copy'}</span>
            </span>
          )}
        </p>
      )}

      {loading ? (
        <div className="flex items-center gap-2 py-10 text-sm text-muted">
          <MatrixLoader variant="scan" label={`Loading ${active}`} /> <ThinkingStates states={[`Loading ${active}…`]} />
        </div>
      ) : !pack ? (
        <div className="rounded-xl border border-dashed border-line px-6 py-10 text-center text-sm text-muted">
          {/* F-3: an honest inline refusal — never a dialog, never a raw fetch error. */}
          <p>Could not load the “{active}” pack. It is not cached{online ? ' and the repository could not be reached' : ' and you are offline'}.</p>
          <p className="mt-1 text-xs">Everything already downloaded still works. Use “Download all” once you are back online to keep this pack offline too.</p>
        </div>
      ) : (
        /* Columns from the space the grid actually has, not the window: the same
            browser lives full-width in Library and in Studio's narrow side panel. */
        <div ref={gridRef}>
          {shownItems.length === 0 ? (
            <div className="rounded-xl border border-dashed border-line px-6 py-10 text-center text-sm text-muted">
              {filter === 'favourites' ? 'No favourites in this pack yet — star a card to keep it here.' : filter === 'recent' ? 'Nothing from this pack applied yet — applied items show up here.' : 'No items match this search.'}
            </div>
          ) : (
            <>
              <div style={{ height: range.padTop }} aria-hidden />
              <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(${gridView.cols}, minmax(0, 1fr))` }}>
                {visibleItems.map((item, i) => (
                  <PackCard
                    key={item.id}
                    item={item}
                    index={i}
                    reduced={reduced}
                    isUsed={used.has(item.id)}
                    isFavourite={favSet.has(item.id)}
                    rendering={progress?.id === item.id}
                    pct={progress?.id === item.id ? progress?.pct ?? 0 : 0}
                    onApply={onApplyStable}
                    onCustomize={onCustomizeStable}
                    onFavourite={onFavouriteStable}
                  />
                ))}
              </div>
              <div style={{ height: range.padBottom }} aria-hidden />
              <p className="pt-2 text-center text-xs text-muted">{shownItems.length.toLocaleString()} items · showing rows {Math.floor(range.start / gridView.cols) + 1}–{Math.ceil(range.end / gridView.cols)}</p>
            </>
          )}
        </div>
      )}

      <Modal
        open={Boolean(templateFill)}
        onClose={() => {
          setTemplateFill(null)
          setTemplateAssignments({})
        }}
        label={templateFill ? `Auto-fill ${templateFill.name}` : 'Auto-fill template'}
        widthClass="max-w-3xl"
      >
        <div className="max-h-[80vh] overflow-y-auto cu-panel p-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="font-mono text-xs uppercase tracking-widest text-accent-text">Template auto-fill</p>
              <h2 className="mt-1 text-lg font-semibold">{templateFill?.name}</h2>
              <p className="mt-1 text-xs text-muted">Every slot is already filled — from your brief, your footage or designed defaults. Change anything, review the exact timeline diff, then accept it as one undoable action.</p>
            </div>
            <Badge tone="info">{fillPlan?.durationSec ?? 0}s preview</Badge>
          </div>

          <div className="mt-5 space-y-3">
            {fillSlots.map((slot, slotIndex) => {
              const media = project ? studioOf(project).clips.filter((clip) =>
                clip.kind === 'video' || clip.kind === 'image' || clip.kind === 'overlay' || clip.kind === 'sticker',
              ) : []
              return (
                <label key={slot.id} className="block rounded-lg border border-line bg-panel-alt p-3">
                  <span className="flex items-center justify-between gap-2 text-xs font-semibold">
                    {slot.label}
                    <span className="font-mono font-normal text-muted tabular-nums">{slot.kind} · {slot.durationSec}s</span>
                  </span>
                  {slot.kind === 'text' ? (
                    <input
                      value={templateAssignments[slot.id]?.text ?? ''}
                      placeholder={fillCopy[slotIndex] ?? slot.defaultText}
                      aria-label={`${slot.label} text`}
                      onChange={(event) => setTemplateAssignments((current) => ({
                        ...current,
                        [slot.id]: { ...current[slot.id], text: event.target.value },
                      }))}
                      className="mt-2 h-9 w-full rounded-lg border border-line bg-bg px-3 text-sm"
                    />
                  ) : (
                    <select
                      value={templateAssignments[slot.id]?.clipId ?? ''}
                      onChange={(event) => setTemplateAssignments((current) => ({
                        ...current,
                        [slot.id]: { ...current[slot.id], clipId: event.target.value },
                      }))}
                      className="mt-2 h-9 w-full rounded-lg border border-line bg-bg px-3 text-sm"
                    >
                      <option value="">{slot.kind === 'logo' ? 'Auto: glass mark with your project name' : media.length ? 'Auto: next unused clip from your project' : 'Auto: placeholder panel (drop media later)'}</option>
                      {media.map((clip) => <option key={clip.id} value={clip.id}>{clip.name} · {clip.kind}</option>)}
                    </select>
                  )}
                  {slot.kind !== 'text' && media.length === 0 && (
                    <p className="mt-2 text-xs text-muted">No footage in this project yet — a designed “Drop your media here” panel fills the slot, and you can swap it any time.</p>
                  )}
                </label>
              )
            })}
          </div>

          <div className="mt-5 rounded-lg border border-line bg-bg/40 p-3">
            <div className="text-xs font-semibold">Proposed timeline diff</div>
            <ul className="mt-2 space-y-1 text-xs text-muted">
              {(fillPlan?.changes ?? []).map((change) => <li key={change}>+ {change}</li>)}
              {(fillPlan?.missing ?? []).map((slot) => <li key={slot.id} className="text-info">• {slot.label}: placeholder until you import media</li>)}
            </ul>
          </div>

          <div className="mt-5 flex justify-end gap-2">
            <Button variant="ghost" onClick={() => {
              setTemplateFill(null)
              setTemplateAssignments({})
            }}>Reject</Button>
            <Button variant="primary" onClick={applyTemplateFill} disabled={!fillPlan || fillPlan.clips.length === 0} title={(!fillPlan || fillPlan.clips.length === 0) ? 'Nothing to fill — this template has no usable slots' : undefined}>
              Accept & auto-fill
            </Button>
          </div>
        </div>
      </Modal>
    </section>
  )
}


/**
 * One resource card. Memoised: the grid re-renders on search/progress, but a
 * card only re-renders when its own props change. `content-visibility:auto`
 * lets the browser skip layout/paint for off-screen cards (virtualisation
 * without fixed row heights).
 */
const ROW_H = 264 // card 252px + 12px gap (gap-3)
const GRID_GAP = 12
const CARD_MIN_W = 240

const PackCard = memo(function PackCard({ item, index: i, reduced, isUsed, isFavourite, rendering, pct, onApply, onCustomize, onFavourite }: { item: PackItem; index: number; reduced: boolean; isUsed: boolean; isFavourite: boolean; rendering: boolean; pct: number; onApply: (item: PackItem) => void; onCustomize: (item: PackItem) => void; onFavourite: (item: PackItem) => void }) {
              const Icon = KIND_ICON[item.kind] ?? Layers
              const disposition = resourceDisposition(item.kind, item)
              const dispositionLabel = DISPOSITION_LABEL[disposition]
                return (
    <motion.div
                  key={item.id}
                                    initial={reduced ? false : { opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.22, ease: EASE_SOFT, delay: reduced ? 0 : Math.min(i, 12) * 0.015 }}
                  whileHover={reduced ? undefined : { y: -2 }}
                  // Draggable straight onto the Studio stage; the drop uses the
                  // same mapping as the button below, so both paths agree.
                  draggable
                  onDragStart={(event) =>
                    writeDragPayload((event as unknown as DragEvent<HTMLDivElement>).dataTransfer, {
                      kind: item.kind,
                      id: item.id,
                      name: item.name,
                      description: item.description,
                      data: item.data,
                    })
                  }
                  className="group flex h-[252px] cursor-grab flex-col gap-2.5 overflow-hidden cu-panel p-3.5 transition-colors duration-150 hover:border-text/25 active:cursor-grabbing"
                >
                  {item.data?.nativeAction === 'loader' && item.data?.loader ? (
                    <LoaderPreview clip={item.data.loader as Partial<StudioLoaderClip>} width={224} height={72} label={`${item.name} preview`} />
                  ) : typeof item.data?.posterUrl === 'string' ? (
                    <img
                      src={item.data.posterUrl}
                      alt={`${item.name} preview (from ${String(item.data.provider ?? 'source')})`}
                      loading="lazy"
                      className="h-24 w-full rounded-lg border border-line bg-panel-alt object-cover"
                      onError={(e) => { e.currentTarget.style.display = 'none' }}
                    />
                  ) : null}
                  {typeof item.data?.audit === 'object' && item.data.audit && (
                    <p className="text-xs text-muted" title={String((item.data.audit as { cupricEquivalent?: string }).cupricEquivalent ?? '')}>
                      {(item.data.audit as { interaction?: string }).interaction} · {(item.data.audit as { animation?: string }).animation} · {String(item.data.license ?? '')}
                    </p>
                  )}
                  {item.css && (
                    <div
                      className="h-14 w-full rounded-lg border border-line"
                      aria-hidden
                      ref={(node) => {
                        if (node) node.setAttribute('style', item.css ?? '')
                      }}
                    />
                  )}
                  <div className="flex items-start gap-2">
                    <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-line bg-panel-alt text-muted">
                      <Icon size={14} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <div className="min-w-0 flex-1 basis-32 truncate text-sm font-semibold" title={item.name}>{item.name}</div>
                        <Badge tone={disposition === 'reference' ? 'neutral' : disposition === 'clip' || disposition === 'template' ? 'accent' : 'info'}>
                          {dispositionLabel}
                        </Badge>
                      </div>
                      <p className="line-clamp-2 text-xs text-muted">{item.description}</p>
                    </div>
                  </div>
                  <div className="mt-auto flex items-center justify-between gap-2 pt-0.5">
                    <span className="min-w-0 truncate font-mono text-[11px] text-muted/70">
                      {/* A source's id means nothing to the reader; its domain does. */}
                      {item.kind === 'source'
                        ? ((item.data as { url?: string } | undefined)?.url ?? '')
                            .replace(/^https?:\/\//, '')
                            .replace(/\/$/, '')
                        : item.id}
                    </span>
                    <div className="flex shrink-0 items-center gap-1.5">
                      <Button size="sm" variant="ghost" onClick={() => onFavourite(item)} aria-pressed={isFavourite} aria-label={isFavourite ? `Remove ${item.name} from favourites` : `Add ${item.name} to favourites`}>
                        <Star size={12} className={isFavourite ? 'fill-current text-accent-text' : undefined} />
                      </Button>
                      {item.kind === 'saas-template' && (
                        <Button size="sm" variant="ghost" onClick={() => onCustomize(item)} aria-label={`Customize ${item.name}`}>
                          Customize
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant={isUsed ? 'ghost' : 'outline'}
                        onClick={() => onApply(item)}
                        disabled={rendering}
                        aria-label={`${applyLabel(item)}: ${item.name}`}
                        title={isUsed ? 'Applied — click to apply again' : undefined}
                      >
                        {rendering ? (
                          <><Loader2 size={12} className="animate-spin" /> {pct}%</>
                        ) : isUsed ? (
                          <><Check size={12} /> Again</>
                        ) : disposition === 'reference' ? (
                          <><ExternalLink size={12} /> {applyLabel(item)}</>
                        ) : disposition === 'command' ? (
                          <><Mic size={12} /> {applyLabel(item)}</>
                        ) : (
                          <><Wand2 size={12} /> Apply</>
                        )}
                      </Button>
                    </div>
                  </div>
                </motion.div>
  )
})
