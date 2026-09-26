import { Suspense, useDeferredValue, useMemo, useRef, useState } from 'react'
import { ArrowLeft, FlaskConical, Loader2, Search, Wand2 } from 'lucide-react'
import html2canvas from 'html2canvas'
import { Button } from '../components/Button'
import { availableSlugs, getDemo } from '../lab/demos'
import { PreviewPlayContext } from '../lab/preview-play'
import { categories, lab, type LabEntry } from '../lab/registry'
import { groups } from '../lab/order'
import type { StudioOverlayClip } from '../types/project'
import { nextFreeStart, studioOf } from '../lib/studio/doc'
import { useActiveProject, useProjectStore } from '../state/useProjectStore'
import { cx, uid } from '../lib/utils'

/**
 * UI Lab — the vendored lab.xevrion.dev catalogue running locally.
 *
 * Two jobs:
 *  1. an interaction reference while building Cupric screens, and
 *  2. a source of on-brand motion stills that can be dropped straight onto the
 *     Studio timeline as overlays.
 */

const ALL = 'all' as const

function DemoFrame({ slug, play, className }: { slug: string; play: boolean | null; className?: string }) {
  const Demo = getDemo(slug)
  if (!Demo) {
    return <div className="grid h-full place-items-center text-xs text-muted">No demo file</div>
  }
  return (
    <PreviewPlayContext.Provider value={play}>
      <Suspense
        fallback={
          <div className="grid h-full place-items-center">
            <Loader2 size={16} className="animate-spin text-muted" />
          </div>
        }
      >
        <div className={cx('lab-canvas grid h-full w-full place-items-center overflow-hidden', className)}>
          <Demo />
        </div>
      </Suspense>
    </PreviewPlayContext.Provider>
  )
}

function LabCard({ entry, onOpen }: { entry: LabEntry; onOpen: () => void }) {
  const [hover, setHover] = useState(false)
  return (
    <button
      type="button"
      onClick={onOpen}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onFocus={() => setHover(true)}
      onBlur={() => setHover(false)}
      className="group overflow-hidden rounded-xl border border-line bg-panel text-left transition-colors duration-150 hover:border-accent/40"
    >
      <div className="relative h-40 overflow-hidden border-b border-line">
        <div
          className="pointer-events-none absolute inset-0"
          style={{ transform: `scale(${entry.previewScale ?? 1})`, transformOrigin: 'center' }}
        >
          <DemoFrame slug={entry.slug} play={hover} />
        </div>
      </div>
      <div className="space-y-1 px-3 py-2.5">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium text-text">{entry.name}</span>
          {entry.isNew && (
            <span className="rounded-full border border-accent/40 px-1.5 text-xs text-accent-text">new</span>
          )}
        </div>
        <p className="line-clamp-2 text-xs leading-relaxed text-muted">{entry.description}</p>
      </div>
    </button>
  )
}

export function Lab() {
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState<string>(ALL)
  const [open, setOpen] = useState<LabEntry | null>(null)
  const [capturing, setCapturing] = useState(false)
  const stageRef = useRef<HTMLDivElement>(null)

  const project = useActiveProject()
  const addStudioClip = useProjectStore((s) => s.addStudioClip)
  const setView = useProjectStore((s) => s.setView)
  const pushToast = useProjectStore((s) => s.pushToast)

  const deferred = useDeferredValue(query.trim().toLowerCase())

  const entries = useMemo(() => {
    const pool = lab.filter((entry) => availableSlugs.has(entry.slug))
    return pool.filter((entry) => {
      if (category !== ALL && entry.category !== category) return false
      if (!deferred) return true
      return `${entry.name} ${entry.description} ${entry.keywords ?? ''} ${entry.slug}`
        .toLowerCase()
        .includes(deferred)
    })
  }, [category, deferred])

  const missing = lab.length - lab.filter((e) => availableSlugs.has(e.slug)).length

  /** Rasterise the open demo and drop it on the Studio timeline as an overlay. */
  async function sendToStudio() {
    if (!open || !project || !stageRef.current) return
    setCapturing(true)
    try {
      const canvas = await html2canvas(stageRef.current, {
        backgroundColor: null,
        scale: 2,
        logging: false,
        useCORS: true,
      })
      const dataUrl = canvas.toDataURL('image/png')
      const doc = studioOf(project)
      const track = Math.min(doc.trackCount - 1, 1)
      const clip: StudioOverlayClip = {
        id: uid(),
        kind: 'overlay',
        track,
        startSec: nextFreeStart(doc, track, 0, 3),
        durationSec: 3,
        name: open.name,
        transitionIn: 'fade',
        transitionOut: 'fade',
        opacity: 1,
        dataUrl,
        source: `UI Lab · ${open.name}`,
        x: 0.5,
        y: 0.5,
        scale: 0.8,
      }
      addStudioClip(project.id, clip)
      pushToast('success', `${open.name} added to the Studio timeline`)
      setView('studio')
    } catch (err) {
      pushToast('error', err instanceof Error ? err.message : 'Could not capture this demo')
    } finally {
      setCapturing(false)
    }
  }

  if (open) {
    const groupIndex = groups.flatMap((g) => g.items).findIndex((e) => e.slug === open.slug)
    const ordered = groups.flatMap((g) => g.items).filter((e) => availableSlugs.has(e.slug))
    const position = ordered.findIndex((e) => e.slug === open.slug)

    return (
      <div className="flex h-full min-h-0 flex-col">
        <div className="flex shrink-0 items-center gap-3 border-b border-line px-6 py-3">
          <Button size="sm" variant="ghost" onClick={() => setOpen(null)}>
            <ArrowLeft size={14} /> All components
          </Button>
          <div className="min-w-0">
            <h1 className="truncate text-base font-semibold">{open.name}</h1>
            <p className="truncate text-xs text-muted">{open.description}</p>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={position <= 0}
              onClick={() => setOpen(ordered[position - 1] ?? null)}
            >
              Previous
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={position < 0 || position >= ordered.length - 1}
              onClick={() => setOpen(ordered[position + 1] ?? null)}
            >
              Next
            </Button>
            <Button size="sm" variant="primary" onClick={() => void sendToStudio()} disabled={!project || capturing}>
              {capturing ? <Loader2 size={13} className="animate-spin" /> : <Wand2 size={13} />} Send to Studio
            </Button>
          </div>
        </div>
        {!project && (
          <p className="border-b border-line bg-panel px-6 py-2 text-xs text-muted">
            Open a project first to send this component to the Studio timeline.
          </p>
        )}

        <div className="min-h-0 flex-1 overflow-auto p-8">
          <div
            ref={stageRef}
            className={cx(
              'lab-canvas mx-auto flex min-h-[420px] w-full max-w-4xl rounded-xl border border-line p-10',
              open.anchor === 'top' ? 'items-start' : 'items-center',
              'justify-center',
            )}
          >
            <DemoFrame slug={open.slug} play={null} className="place-items-center" />
          </div>
          <p className="mx-auto mt-3 max-w-4xl font-mono text-xs text-muted">
            {open.category} · src/lab/components/{open.slug}.tsx
            {groupIndex >= 0 ? ` · #${groupIndex + 1}` : ''}
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 space-y-3 border-b border-line px-6 py-4">
        <div className="flex items-center gap-3">
          <FlaskConical size={18} className="text-accent-text" />
          <div>
            <h1 className="text-base font-semibold">UI Lab</h1>
            <p className="text-xs text-muted">
              {entries.length} of {availableSlugs.size} interactions vendored from lab.xevrion.dev — reference them,
              or snapshot one onto the Studio timeline.
              {missing > 0 && ` (${missing} registry entries have no local file)`}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <label className="relative flex-1 min-w-52">
            <span className="sr-only">Search components</span>
            <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search dock, slider, toast…"
              className="w-full rounded-lg border border-line bg-panel-alt py-1.5 pl-9 pr-3 text-base text-text placeholder:text-muted/60"
            />
          </label>

          <div className="flex flex-wrap gap-1.5">
            <button
              type="button"
              onClick={() => setCategory(ALL)}
              className={cx(
                'rounded-full border px-2.5 py-1 text-xs transition-colors duration-150',
                category === ALL ? 'border-accent bg-accent text-accent-ink' : 'border-line text-muted hover:text-text',
              )}
            >
              All
            </button>
            {categories.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => setCategory(c.id)}
                className={cx(
                  'rounded-full border px-2.5 py-1 text-xs transition-colors duration-150',
                  category === c.id ? 'border-accent bg-accent text-accent-ink' : 'border-line text-muted hover:text-text',
                )}
              >
                {c.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
        {entries.length === 0 ? (
          <p className="py-16 text-center text-sm text-muted">Nothing matches “{query}”.</p>
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-4">
            {entries.map((entry) => (
              <LabCard key={entry.slug} entry={entry} onOpen={() => setOpen(entry)} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
