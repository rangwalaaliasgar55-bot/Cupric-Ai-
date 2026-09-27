import { useEffect, useMemo, useRef, useState } from 'react'
import { ExternalLink, Sparkles, Wand2 } from 'lucide-react'
import { loadPack, loadPackIndex, type Pack } from '../../lib/packs'
import { FINDER_EXAMPLES, findResources, type FinderPack } from '../../lib/resourceFinder'
import { cx } from '../../lib/utils'

/**
 * “Describe what you want to make” — searches EVERY pack at once and
 * explains each match. Selecting a result opens it in the pack browser, where
 * the usual Apply / drag-to-Studio actions live (one apply path, no fork).
 */
export function ResourceFinder({ onOpen }: { onOpen: (packId: string, itemName: string) => void }) {
  const [text, setText] = useState('')
  const [query, setQuery] = useState('')
  const [packs, setPacks] = useState<FinderPack[] | null>(null)
  const [loading, setLoading] = useState(false)
  const started = useRef(false)

  // Load every pack the first time the finder is used (cached by lib/packs).
  const ensurePacks = () => {
    if (started.current) return
    started.current = true
    setLoading(true)
    void loadPackIndex().then(async ({ index }) => {
      const loaded = await Promise.all((index?.packs ?? []).map((e) => loadPack(e.id).then(({ pack }) => pack as Pack | null)))
      setPacks(loaded.filter((p): p is Pack => !!p).map((p) => ({ id: p.id, name: p.name, items: p.items })))
      setLoading(false)
    })
  }

  useEffect(() => {
    const t = setTimeout(() => setQuery(text), 180)
    return () => clearTimeout(t)
  }, [text])

  const found = useMemo(() => (packs && query.trim().length >= 2 ? findResources(query, packs, 18) : null), [packs, query])

  const run = (q: string) => { ensurePacks(); setText(q); setQuery(q) }

  return (
    <div className="cu-panel space-y-3 p-4">
      <div className="flex items-center gap-2">
        <Wand2 size={15} className="text-accent-text" />
        <h3 className="text-sm font-semibold">Find the right resource</h3>
        <span className="text-xs text-muted">— describe it in your own words; every pack is searched</span>
      </div>
      <input
        value={text}
        onFocus={ensurePacks}
        onChange={(e) => { ensurePacks(); setText(e.target.value) }}
        placeholder="e.g. “numbers going up for our revenue slide” or “logos scrolling”"
        aria-label="Describe the resource you need"
        className="h-10 w-full rounded-lg border border-line bg-panel-alt/60 px-3 text-sm placeholder:text-muted/70"
      />
      <div className="flex flex-wrap gap-1.5">
        {FINDER_EXAMPLES.map((ex) => (
          <button key={ex} type="button" onClick={() => run(ex)} className="rounded-full border border-line px-2.5 py-0.5 text-xs text-muted transition-colors hover:border-accent/50 hover:text-text">
            {ex}
          </button>
        ))}
      </div>
      {loading && <p className="text-xs text-muted">Loading every pack…</p>}
      {found && (
        <div className="space-y-2">
          <p className="text-xs text-muted">
            {found.understood.length ? <>Understood: <span className="text-text">{found.understood.join(' · ')}</span> · </> : null}
            searched {found.searched.toLocaleString()} resources · {found.results.length ? `${found.results.length} best matches` : 'no matches'}
          </p>
          {!found.results.length && (
            <p className="text-xs text-muted">Nothing fits yet. Try saying what it is for (“intro”, “pricing”, “reviews”) or how it should feel (“calm”, “punchy”).</p>
          )}
          <ul className="grid gap-2 sm:grid-cols-2">
            {found.results.map((r, i) => {
              const url = typeof r.item.data?.url === 'string' ? (r.item.data.url as string) : null
              return (
                <li key={`${r.packId}:${r.item.id}`} className={cx('group rounded-lg border border-line bg-panel-alt/40 p-2.5 transition-colors hover:border-text/20', i === 0 && 'border-accent/40')}>
                  <div className="flex items-start gap-2">
                    {i === 0 && <Sparkles size={13} className="mt-0.5 shrink-0 text-accent-text" aria-label="Best match" />}
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">{r.item.name}</div>
                      <div className="truncate text-xs text-muted">{r.packName} · {r.item.kind}</div>
                      <div className="mt-1 line-clamp-2 text-xs text-muted/90">{r.item.description}</div>
                      {r.why.length > 0 && <div className="mt-1 truncate text-[11px] text-accent-text/90">{r.why.join(' · ')}</div>}
                    </div>
                  </div>
                  <div className="mt-2 flex gap-1.5">
                    <button type="button" onClick={() => onOpen(r.packId, r.item.name)} className="rounded-md border border-line px-2 py-0.5 text-xs hover:border-accent/60">Open in pack</button>
                    {url && (
                      <button type="button" onClick={() => window.open(url, '_blank', 'noopener')} className="inline-flex items-center gap-1 rounded-md border border-line px-2 py-0.5 text-xs hover:border-accent/60">
                        <ExternalLink size={11} /> Source
                      </button>
                    )}
                  </div>
                </li>
              )
            })}
          </ul>
        </div>
      )}
    </div>
  )
}
