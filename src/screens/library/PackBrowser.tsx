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
import { defaultGlassClip, defaultTextClip, docDuration, nextFreeStart, studioOf } from '../../lib/studio/doc'
import type { StudioClip, StudioTextAnim, StudioTransition } from '../../types/project'
import { useActiveProject, useProjectStore } from '../../state/useProjectStore'
import { EASE_SOFT } from '../../lib/motion'
import { useReducedMotion } from '../../lib/use-reduced-motion'
import { writeDragPayload } from '../../lib/studio/resourceDrop'
import { copyText, cx, uid } from '../../lib/utils'

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
  const addStudioClip = useProjectStore((s) => s.addStudioClip)
  const updateStudioClip = useProjectStore((s) => s.updateStudioClip)
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
  const [downloading, setDownloading] = useState<{ pct: number; label: string } | null>(null)
  const [offline, setOffline] = useState<{ downloaded: string[]; total: number }>({ downloaded: [], total: 0 })
  const [used, setUsed] = useState<Set<string>>(new Set())
  const [online, setOnline] = useState(isOnline())

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

  async function download() {
    setDownloading({ pct: 0, label: 'Starting' })
    const result = await downloadAllPacks((pct, label) => setDownloading({ pct, label }))
    setDownloading(null)
    refreshOffline()
    if (result.failed.length) pushToast('error', `Downloaded ${result.ok} packs, ${result.failed.length} failed.`)
    else pushToast('success', `All ${result.ok} packs are available offline.`)
  }

  /** Every "Add to Studio" path goes through the normal store actions. */
  function addToStudio(item: PackItem) {
    if (!project) {
      pushToast('info', 'Open a project first.')
      setView('home')
      return
    }
    const doc = studioOf(project)
    const at = docDuration(doc)
    const topTrack = Math.min(1, doc.trackCount - 1)

    if (item.kind === 'saas-template') {
      const data = item.data as { scenes?: [string, number, StudioTextAnim][]; editable?: boolean } | undefined
      const scenes = data?.scenes ?? []
      let cursor = nextFreeStart(doc, 0, 0, 1)
      scenes.forEach(([text, duration, anim], index) => {
        const clip = defaultTextClip(cursor, topTrack)
        clip.text = text
        clip.name = `${item.name} · Scene ${index + 1}`
        clip.durationSec = Math.max(0.2, duration)
        clip.anim = anim
        clip.captionStyle = 'standard'
        clip.fontSizePct = text.length > 28 ? 6.5 : 9
        clip.highlightWord = text.split(/\s+/)[0] || null
        addStudioClip(project.id, clip)
        cursor += duration
      })
      patchStudio(project.id, { backgroundId: 'grid-haze' })
      pushToast('success', `“${item.name}” added as ${scenes.length} editable SaaS scenes. Edit every scene on the Studio timeline.`)
      markUsed(item)
      return
    }

    if (item.kind === 'glass') {
      const clip = defaultGlassClip(nextFreeStart(doc, topTrack, at, 3), topTrack, item.id, item.id === 'lens' ? 'lens' : 'panel')
      addStudioClip(project.id, clip)
      pushToast('success', `“${item.name}” glass added to the Studio.`)
    } else if (item.kind === 'background') {
      const studioNative = (item.data as { studio?: boolean } | undefined)?.studio
      if (studioNative === false) {
        // Chrome gradients are not Studio presets — the canvas cannot paint
        // them, so hand over the CSS rather than adding a clip that renders black.
        void copyText(item.css ?? '')
        pushToast('info', `“${item.name}” is a chrome gradient — CSS copied instead.`)
        markUsed(item)
        return
      }
      const clip: StudioClip = {
        id: uid(),
        kind: 'background',
        track: 0,
        startSec: nextFreeStart(doc, 0, at, 4),
        durationSec: 4,
        name: item.name,
        transitionIn: 'fade',
        transitionOut: 'fade',
        opacity: 1,
        backgroundId: item.id,
      }
      addStudioClip(project.id, clip)
      patchStudio(project.id, { backgroundId: item.id })
      pushToast('success', `“${item.name}” added as a background clip and set as the stage.`)
    } else if (item.kind === 'transition') {
      const last = [...doc.clips].sort((a, b) => a.startSec - b.startSec).pop()
      if (!last) {
        pushToast('info', 'Add a clip first — a transition needs something to run on.')
        return
      }
      updateStudioClip(project.id, last.id, { transitionIn: item.id as StudioTransition })
      pushToast('success', `“${item.name}” set as the in-transition on “${last.name}”.`)
    } else if (item.kind === 'animation') {
      const lastText = [...doc.clips].filter((c) => c.kind === 'text').sort((a, b) => a.startSec - b.startSec).pop()
      if (lastText) {
        updateStudioClip(project.id, lastText.id, { anim: item.id as StudioTextAnim } as Partial<StudioClip>)
        pushToast('success', `“${item.name}” applied to “${lastText.name}”.`)
      } else {
        const clip = defaultTextClip(nextFreeStart(doc, topTrack, at, 3), topTrack)
        clip.anim = item.id as StudioTextAnim
        addStudioClip(project.id, clip)
        pushToast('success', `New caption added with the “${item.name}” animation.`)
      }
    } else if (item.kind === 'effect') {
      const cue = (item.data as { promptCue?: string } | undefined)?.promptCue ?? item.description
      void copyText(cue)
      pushToast('success', `Effect cue “${item.name}” copied.`)
    } else if (item.kind === 'voice') {
      void copyText(item.name.replace(/"/g, ''))
      pushToast('info', 'Phrase copied — press Voice in the Studio and say it.')
    } else if (item.kind === 'source') {
      // Sources are links, not material: hand over the cue the prompt builder
      // wants and open the site in the user's own browser.
      const data = item.data as { url?: string; promptCue?: string } | undefined
      void copyText(data?.promptCue ?? item.description)
      if (data?.url) window.open(data.url, '_blank', 'noopener,noreferrer')
      pushToast('success', `Prompt cue for “${item.name}” copied.`)
    } else if (item.kind === 'template') {
      const data = item.data as { file?: string; durationSec?: number; fps?: number } | undefined
      void copyText(data?.file ?? item.id)
      pushToast('info', `“${item.name}” — ${data?.durationSec ?? 0}s at ${data?.fps ?? 30}fps. Path copied; open it from the Render screen.`)
    } else if (item.kind === 'component') {
      setView('lab')
      pushToast('info', `Opening the Lab at “${item.name}”.`)
    } else if (item.kind === 'icon' || item.kind === 'block') {
      const clip = defaultTextClip(nextFreeStart(doc, topTrack, at, 4), topTrack)
      clip.text = item.name
      clip.name = `Resource · ${item.name}`
      clip.anim = 'fade-up'
      addStudioClip(project.id, clip)
      const source = (item.data as { source?: string } | undefined)?.source
      pushToast('success', `“${item.name}” added as an editable Studio cue${source ? ' — source linked in the resource card' : ''}.`)
    } else if (item.kind === 'font' || item.kind === 'skill' || item.kind === 'provider') {
      const source = (item.data as { source?: string } | undefined)?.source
      if (source) window.open(source, '_blank', 'noopener,noreferrer')
      pushToast('info', `${item.name} is indexed with an editable video/agent adapter. Opening its upstream reference.`)
    }
    markUsed(item)
  }

  function markUsed(item: PackItem) {
    setUsed((prev) => new Set(prev).add(item.id))
  }

  const fullyOffline = offline.total > 0 && offline.downloaded.length === offline.total

  return (
    <section className="space-y-4">
      <GlassPanel className="flex flex-wrap items-center gap-3 px-4 py-3" preset="frost" radius={14}>
        <div className="min-w-0 flex-1">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            Resource packs
            {!online && (
              <Badge tone="neutral">
                <WifiOff size={11} /> Offline
              </Badge>
            )}
          </h2>
          <p className="mt-0.5 text-xs text-muted">
            Fetched from this repository over the internet ({PACKS_BASE.replace('https://', '')}) — nothing is read from
            your machine. Download once to keep them without a connection.
          </p>
        </div>
        <span className="font-mono text-xs text-muted tabular-nums">
          {offline.downloaded.length}/{offline.total || '—'} cached
        </span>
        <Button size="sm" variant={fullyOffline ? 'outline' : 'primary'} onClick={() => void download()} disabled={downloading !== null}>
          {downloading ? <Loader2 size={13} className="animate-spin" /> : fullyOffline ? <RefreshCw size={13} /> : <CloudDownload size={13} />}
          {downloading ? 'Downloading…' : fullyOffline ? 'Refresh' : 'Download all'}
        </Button>
      </GlassPanel>

      {downloading && (
        <div className="flex items-center gap-3">
          <ProgressBar pct={downloading.pct} className="flex-1" />
          <span className="w-36 truncate text-xs text-muted">{downloading.label}</span>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {(index?.packs ?? []).map((entry) => (
          <button
            key={entry.id}
            type="button"
            onClick={() => setActive(entry.id)}
            className={cx(
              'rounded-full border px-3 py-1.5 text-xs font-medium transition-colors duration-150',
              entry.id === active
                ? 'border-accent/60 bg-accent/15 text-accent-text'
                : 'border-line bg-panel text-muted hover:text-text',
            )}
          >
            {entry.name}
            <span className="ml-1.5 font-mono tabular-nums opacity-70">{entry.itemCount}</span>
          </button>
        ))}
        <div className="relative ml-auto min-w-48">
          <Search size={13} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search this pack…"
            aria-label="Search pack"
            className="h-8 w-full rounded-lg border border-line bg-panel pl-8 pr-3 text-xs placeholder:text-muted/70"
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
        <motion.div layout className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          <AnimatePresence mode="popLayout" initial={false}>
            {items.map((item, i) => {
              const Icon = KIND_ICON[item.kind] ?? Layers
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
                  className="group flex cursor-grab flex-col gap-2.5 rounded-xl border border-line bg-panel p-3.5 transition-colors duration-150 hover:border-text/25 active:cursor-grabbing"
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
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold">{item.name}</div>
                      <p className="line-clamp-2 text-xs text-muted">{item.description}</p>
                    </div>
                  </div>
                  <div className="mt-auto flex items-center justify-between gap-2 pt-0.5">
                    <span className="truncate font-mono text-[11px] text-muted/70">
                      {/* A source's id means nothing to the reader; its domain does. */}
                      {item.kind === 'source'
                        ? ((item.data as { url?: string } | undefined)?.url ?? '')
                            .replace(/^https?:\/\//, '')
                            .replace(/\/$/, '')
                        : item.id}
                    </span>
                    {used.has(item.id) ? (
                      <Badge tone="accent">
                        <Check size={11} /> Added
                      </Badge>
                    ) : (
                      <Button size="sm" variant="outline" onClick={() => addToStudio(item)}>
                        {item.kind === 'effect' || item.kind === 'voice' || item.kind === 'template' ? (
                          <>
                            <Copy size={12} /> Copy
                          </>
                        ) : item.kind === 'source' ? (
                          <>
                            <ExternalLink size={12} /> Open
                          </>
                        ) : item.kind === 'component' ? (
                          'Open in Lab'
                        ) : item.kind === 'font' || item.kind === 'skill' || item.kind === 'icon' || item.kind === 'block' || item.kind === 'provider' ? (
                          'Open source'
                        ) : (
                          'Add to Studio'
                        )}
                      </Button>
                    )}
                  </div>
                </motion.div>
              )
            })}
          </AnimatePresence>
        </motion.div>
      )}
    </section>
  )
}
