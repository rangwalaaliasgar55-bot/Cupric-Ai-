/**
 * Studio → Components: every UI Lab component, one click from the timeline.
 *
 * Pick one to preview it live, choose how long to record and whether Cupric
 * should act it out, then Add. The clip lands at the playhead on a free track
 * and the recorder captures the component's real animation. Rows are also
 * draggable onto the stage, and double-click adds immediately.
 */
import { useDeferredValue, useMemo, useState, type DragEvent } from 'react'
import { MousePointerClick, Plus, Search } from 'lucide-react'
import { Button } from '../../components/Button'
import { DemoFrame } from '../../lab/DemoFrame'
import { availableSlugs } from '../../lab/demos'
import { cx } from '../../lib/utils'
import { COMPONENT_CATEGORIES, COMPONENTS, DEFAULT_RECORD_SEC, type ComponentEntry } from '../../lib/studio/components'
import { writeDragPayload } from '../../lib/studio/resourceDrop'

const ALL = 'all'

export function ComponentsPanel({ onAdd }: { onAdd: (slug: string, opts: { recordSec: number; interact: boolean }) => void }) {
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState<string>(ALL)
  const [selected, setSelected] = useState<ComponentEntry | null>(null)
  const [recordSec, setRecordSec] = useState(DEFAULT_RECORD_SEC)
  const [interact, setInteract] = useState(true)
  const deferred = useDeferredValue(query.trim().toLowerCase())

  const pool = useMemo(() => COMPONENTS.filter((entry) => availableSlugs.has(entry.slug)), [])
  const entries = useMemo(
    () =>
      pool.filter((entry) => {
        if (category !== ALL && entry.category !== category) return false
        if (!deferred) return true
        return `${entry.name} ${entry.description} ${entry.keywords ?? ''} ${entry.slug}`.toLowerCase().includes(deferred)
      }),
    [category, deferred, pool],
  )

  const add = (entry: ComponentEntry) => onAdd(entry.slug, { recordSec, interact })

  return (
    <div className="flex min-h-0 flex-col gap-3">
      <div>
        <h2 className="text-sm font-semibold">
          Components <span className="font-mono text-xs font-normal text-muted">{pool.length}</span>
        </h2>
        <p className="mt-1 text-xs text-muted">
          Real UI components with their real animation. Add one and Cupric plays it, acts it out and records it onto your timeline as an
          editable clip.
        </p>
      </div>

      {selected ? (
        <div className="rounded-xl border border-line bg-panel">
          <div className="lab-canvas relative h-44 overflow-hidden rounded-t-xl">
            <DemoFrame key={selected.slug} slug={selected.slug} play forceMotion className="origin-center scale-[0.8] place-items-center" />
          </div>
          <div className="space-y-2.5 p-3">
            <div>
              <div className="text-sm font-semibold">{selected.name}</div>
              <p className="line-clamp-2 text-xs text-muted">{selected.description}</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <label className="flex items-center gap-1.5 text-xs text-muted">
                Length
                <select
                  value={recordSec}
                  onChange={(e) => setRecordSec(Number(e.target.value))}
                  className="h-7 rounded-md border border-line bg-bg px-1.5 text-xs text-text"
                  aria-label="Recording length"
                >
                  {[2, 3, 4, 6, 8].map((s) => (
                    <option key={s} value={s}>{s}s</option>
                  ))}
                </select>
              </label>
              <label className="flex items-center gap-1.5 text-xs text-muted" title="Hover, move over and press its controls while recording, so interactive components show their motion">
                <input type="checkbox" checked={interact} onChange={(e) => setInteract(e.target.checked)} className="accent-[var(--color-accent,#C8F542)]" />
                <MousePointerClick size={12} /> Act it out
              </label>
              <Button size="sm" variant="primary" className="ml-auto" onClick={() => add(selected)} aria-label={`Add ${selected.name} to the timeline`}>
                <Plus size={13} /> Add at playhead
              </Button>
            </div>
          </div>
        </div>
      ) : (
        <div className="rounded-xl border border-dashed border-line px-3 py-4 text-center text-xs text-muted">
          Pick a component to preview it here · double-click to add it straight away · or drag it onto the stage
        </div>
      )}

      <div className="relative">
        <Search size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search components…"
          aria-label="Search components"
          className="h-8 w-full rounded-lg border border-line bg-panel pl-8 pr-3 text-xs placeholder:text-muted/70"
        />
      </div>
      <div className="flex flex-wrap gap-1">
        {[{ id: ALL, label: 'All' }, ...COMPONENT_CATEGORIES].map((c) => (
          <button
            key={c.id}
            type="button"
            onClick={() => setCategory(c.id)}
            className={cx(
              'rounded-full border px-2 py-0.5 text-[11px] transition-colors',
              category === c.id ? 'border-accent/60 bg-accent/15 text-accent-text' : 'border-line text-muted hover:text-text',
            )}
          >
            {c.label}
          </button>
        ))}
      </div>

      <ul className="space-y-1" aria-label="Components">
        {entries.map((entry) => (
          <li key={entry.slug}>
            <div
              role="button"
              tabIndex={0}
              draggable
              onDragStart={(event: DragEvent<HTMLDivElement>) =>
                writeDragPayload(event.dataTransfer, { kind: 'component', id: entry.slug, name: entry.name, description: entry.description })
              }
              onClick={() => setSelected(entry)}
              onDoubleClick={() => add(entry)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') add(entry)
                if (e.key === ' ') {
                  e.preventDefault()
                  setSelected(entry)
                }
              }}
              className={cx(
                'group flex cursor-pointer items-center gap-2 rounded-lg border px-2.5 py-2 transition-colors',
                selected?.slug === entry.slug ? 'border-accent/50 bg-accent/10' : 'border-transparent hover:border-line hover:bg-panel',
              )}
              aria-label={`${entry.name} — ${entry.description}`}
            >
              <div className="min-w-0 flex-1">
                <div className="truncate text-xs font-medium">{entry.name}</div>
                <div className="truncate text-[11px] text-muted">{entry.description}</div>
              </div>
              <span className="shrink-0 rounded-full border border-line px-1.5 text-[10px] text-muted">{entry.category}</span>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  add(entry)
                }}
                className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-line text-muted opacity-70 transition hover:border-accent/60 hover:text-accent-text group-hover:opacity-100"
                aria-label={`Add ${entry.name}`}
                title="Add at playhead"
              >
                <Plus size={12} />
              </button>
            </div>
          </li>
        ))}
        {!entries.length && <li className="px-2 py-6 text-center text-xs text-muted">No component matches “{query}”.</li>}
      </ul>
    </div>
  )
}
