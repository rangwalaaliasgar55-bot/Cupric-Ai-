import { useCallback, useEffect, useMemo, useState, type DragEvent } from 'react'
import { AnimatePresence, motion } from 'motion/react'
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
} from 'lucide-react'
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
  const [visibleCount, setVisibleCount] = useState(90)
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

  const items = useMemo(() => {
    const all = pack?.items ?? []
    const q = query.trim().toLowerCase()
    if (!q) return all
    return all.filter(
      (i) =>
        i.name.toLowerCase().includes(q) ||
        i.description.toLowerCase().includes(q) ||
        (i.tags ?? []).some((tag) => tag.includes(q)),
    )
  }, [pack, query])
  const visibleItems = useMemo(() => items.slice(0, visibleCount), [items, visibleCount])

  useEffect(() => setVisibleCount(90), [active, query])

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
                v{index.version} · {index.packs.reduce((sum, entry) => sum + entry.itemCount, 0).toLocaleString()} items
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
        <Button size="sm" variant={fullyOffline ? 'outline' : 'primary'} onClick={() => void download()} disabled={downloading !== null}>
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
      </div>

      {pack && (
        <p className="text-xs text-muted">
          {pack.description} <span className="opacity-70">· {pack.source} · {pack.license} · loaded from {SOURCE_LABEL[source]}</span>
        </p>
      )}

      {loading ? (
        <div className="flex items-center gap-2 py-10 text-sm text-muted">
          <Loader2 size={14} className="animate-spin" /> Loading {active}…
        </div>
      ) : !pack ? (
        <div className="rounded-xl border border-dashed border-line px-6 py-10 text-center text-sm text-muted">
          Could not load the “{active}” pack. It is not cached and the repository could not be reached.
        </div>
      ) : (
        /* Columns from the space the grid actually has, not the window: the same
            browser lives full-width in Library and in Studio's narrow side panel. */
        <motion.div layout className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,15rem),1fr))] gap-3">
          <AnimatePresence mode="popLayout" initial={false}>
            {visibleItems.map((item, i) => {
              const Icon = KIND_ICON[item.kind] ?? Layers
              const disposition = resourceDisposition(item.kind, item)
              const dispositionLabel = DISPOSITION_LABEL[disposition]
              const rendering = progress?.id === item.id
              return (
                <motion.div
                  key={item.id}
                  layout
                  initial={reduced ? false : { opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={reduced ? undefined : { opacity: 0, scale: 0.97 }}
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
                  className="group flex cursor-grab flex-col gap-2.5 cu-panel p-3.5 transition-colors duration-150 hover:border-text/25 active:cursor-grabbing"
                >
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
                      {item.kind === 'saas-template' && (
                        <Button size="sm" variant="ghost" onClick={() => customizeTemplate(item)} aria-label={`Customize ${item.name}`}>
                          Customize
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant={used.has(item.id) ? 'ghost' : 'outline'}
                        onClick={() => void addToStudio(item)}
                        disabled={rendering}
                        aria-label={`${applyLabel(item)}: ${item.name}`}
                        title={used.has(item.id) ? 'Applied — click to apply again' : undefined}
                      >
                        {rendering ? (
                          <><Loader2 size={12} className="animate-spin" /> {progress?.pct ?? 0}%</>
                        ) : used.has(item.id) ? (
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
            })}
          </AnimatePresence>
          {visibleItems.length < items.length && (
            <div className="col-span-full flex items-center justify-center gap-3 rounded-xl border border-dashed border-line bg-panel/50 p-4">
              <span className="text-xs text-muted">Showing {visibleItems.length.toLocaleString()} of {items.length.toLocaleString()}</span>
              <Button size="sm" variant="outline" onClick={() => setVisibleCount((count) => count + 90)}>
                Load 90 more
              </Button>
            </div>
          )}
        </motion.div>
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
            <Button variant="primary" onClick={applyTemplateFill} disabled={!fillPlan || fillPlan.clips.length === 0}>
              Accept & auto-fill
            </Button>
          </div>
        </div>
      </Modal>
    </section>
  )
}
