import { Suspense, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, FlaskConical, Loader2, Search, Wand2 } from 'lucide-react'
import { trimFrames } from '../lib/trimFrames'
import { captureElement } from '../lib/capture'
import { ProgressProvider } from '../lib/ProgressProvider'
import { Button } from '../components/Button'
import { availableSlugs } from '../lab/demos'
import { DemoFrame } from '../lab/DemoFrame'
import { PreviewPlayContext } from '../lab/preview-play'
import { categories, lab, type LabEntry } from '../lab/registry'
import { groups } from '../lab/order'
import type { StudioClip } from '../types/project'
import { docDuration, studioOf } from '../lib/studio/doc'
import { useActiveProject, useProjectStore } from '../state/useProjectStore'
import { cx, uid } from '../lib/utils'
import { humanError } from '../lib/humanError'
import { focusStudioClip } from '../lib/studio/focus'
import { lastStudioPlayhead } from '../lib/studio/studioLink'
import { preferredRecordSec, withComponent } from '../lib/studio/components'
import { motionPatch } from '../lib/studio/motionDirector'

/**
 * UI Lab — the vendored lab.xevrion.dev catalogue running locally.
 *
 * Two jobs:
 *  1. an interaction reference while building Cupric screens, and
 *  2. a source of on-brand motion stills that can be dropped straight onto the
 *     Studio timeline as overlays.
 */

const ALL = 'all' as const


/** Mount a card's live demo only once it scrolls near the viewport. */
function useNearViewport<T extends Element>(): [React.RefObject<T | null>, boolean] {
  const ref = useRef<T | null>(null)
  const [near, setNear] = useState(false)
  useEffect(() => {
    const node = ref.current
    if (!node || near) return
    if (typeof IntersectionObserver === 'undefined') {
      setNear(true)
      return
    }
    const observer = new IntersectionObserver((items) => {
      if (items.some((item) => item.isIntersecting)) {
        setNear(true)
        observer.disconnect()
      }
    }, { rootMargin: '300px 0px' })
    observer.observe(node)
    return () => observer.disconnect()
  }, [near])
  return [ref, near]
}

function LabCard({ entry, onOpen }: { entry: LabEntry; onOpen: () => void }) {
  const [hover, setHover] = useState(false)
  const [ref, near] = useNearViewport<HTMLDivElement>()
  return (
    // A div with button semantics, not a <button>: the live demo inside
    // renders its own buttons, and nested buttons are invalid HTML that
    // browsers "repair" unpredictably.
    <div
      ref={ref}
      role="button"
      tabIndex={0}
      aria-label={`Open ${entry.name}`}
      onClick={onOpen}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget) return
        if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onOpen() }
      }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onFocus={() => setHover(true)}
      onBlur={() => setHover(false)}
      className="group cursor-pointer overflow-hidden rounded-xl border border-line bg-panel text-left transition-colors duration-150 hover:border-accent/40 focus-visible:outline-2 focus-visible:outline-accent"
    >
      <div className="relative h-40 overflow-hidden border-b border-line">
        <div
          inert
          className="pointer-events-none absolute inset-0"
          style={{ transform: `scale(${entry.previewScale ?? 1})`, transformOrigin: 'center' }}
        >
          {near ? <DemoFrame slug={entry.slug} play={hover} /> : <div className="lab-canvas h-full w-full" />}
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
    </div>
  )
}

export function Lab() {
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState<string>(ALL)
  const [open, setOpen] = useState<LabEntry | null>(() => {
    const slug = sessionStorage.getItem('cupric:lab-open')
    if (slug) sessionStorage.removeItem('cupric:lab-open')
    return slug ? lab.find((entry) => entry.slug === slug) ?? null : null
  })
  const [capturing, setCapturing] = useState(false)
  const [captureProgress, setCaptureProgress] = useState(0)
  /**
   * The instant the open demo is pinned to, or undefined for "run freely".
   * Set while capturing so what lands on the timeline is a chosen moment
   * rather than whatever the component was mid-way through.
   */
  const [freezeAt, setFreezeAt] = useState<number | undefined>(undefined)
  const stageRef = useRef<HTMLDivElement>(null)

  const project = useActiveProject()
  const patchStudio = useProjectStore((s) => s.patchStudio)
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

  /**
   * Pre-render the React demo into a deterministic frame sequence. Studio can
   * then scrub and export its real motion instead of flattening the component
   * into the single screenshot that used to make Lab resources look broken.
   */
  /**
   * Put the component on the Studio timeline. The Studio's recorder plays it,
   * acts it out and records its real animation into the clip (see
   * ComponentRecorderHost), the same path as Studio → Components.
   */
  async function sendToStudio() {
    if (!open || !project) return
    setCapturing(true)
    try {
      const doc = studioOf(project)
      const added = withComponent(doc, open.slug, { startSec: Math.min(lastStudioPlayhead(), docDuration(doc)), recordSec: preferredRecordSec(), durationSec: preferredRecordSec() })
      const clip = { ...added.clip, ...motionPatch(added.clip, { entrance: 'rise-in', exit: 'fade-out', intensity: 0.8 }) } as StudioClip
      patchStudio(project.id, { trackCount: added.doc.trackCount, clips: added.doc.clips.map((c) => (c.id === clip.id ? clip : c)) })
      focusStudioClip(clip.id)
      pushToast('success', `${open.name} is on your timeline — the Studio is recording its real animation now.`)
      setView('studio')
    } catch (err) {
      pushToast('error', humanError(err, `Could not add ${open.name}`))
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
              disabled={position <= 0} title={(position <= 0) ? 'This is the first component' : undefined}
              onClick={() => setOpen(ordered[position - 1] ?? null)}
            >
              Previous
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={position < 0 || position >= ordered.length - 1} title={(position < 0 || position >= ordered.length - 1) ? 'This is the last component' : undefined}
              onClick={() => setOpen(ordered[position + 1] ?? null)}
            >
              Next
            </Button>
            <Button size="sm" variant="primary" onClick={() => void sendToStudio()} disabled={!project || capturing} title={(!project || capturing) ? 'Open a project first — or wait for the capture' : undefined}>
              {capturing ? <Loader2 size={13} className="animate-spin" /> : <Wand2 size={13} />}
              {capturing ? 'Adding…' : 'Add animated to Studio'}
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
            <DemoFrame slug={open.slug} play={capturing ? true : null} className="place-items-center" atSeconds={freezeAt} />
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
              or render its real React motion into a scrub-safe Studio clip.
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
