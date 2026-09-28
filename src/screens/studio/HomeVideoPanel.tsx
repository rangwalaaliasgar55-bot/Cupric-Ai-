/**
 * Home_X styles popover: pick a style, review the brief-derived copy and your
 * own figures, preview the planned changes, then Accept (one undo step).
 * B-roll suggestions arrive as a queue — each is accepted on its own; nothing
 * is inserted automatically.
 */
import { useMemo, useState, type FormEvent } from 'react'
import type { Project, StudioDoc } from '../../types/project'
import { HOME_STYLES, acceptBroll, planHomeVideo, type BrollSuggestion, type HomeFill, type HomeStyleId } from '../../lib/studio/homeVideos'

const inputCx = 'w-full cu-input px-2.5 py-1.5 text-sm text-text'

/** Brief → copy. Only the user's own rundown text; empty when there is none. */
export function fillFromBrief(project: Project | null): HomeFill {
  const r = project?.brief.lockedRundown ?? null
  if (!r) return {}
  const scenes = r.scenes ?? []
  return {
    headline: r.title || undefined,
    supporting: scenes[1]?.copy || scenes[0]?.copy || undefined,
    cta: scenes[scenes.length - 1]?.copy || undefined,
    brand: project?.name || undefined,
  }
}

const rows = (s: string) => s.split('\n').map((l) => l.split('|').map((p) => p.trim())).filter((p) => p[0])

export function HomeVideoPanel({ doc, project, onApply, onClose }: { doc: StudioDoc; project: Project | null; onApply: (next: StudioDoc, label: string) => void; onClose: () => void }) {
  const brief = useMemo(() => fillFromBrief(project), [project])
  const [style, setStyle] = useState<HomeStyleId>('saas-capture')
  const [copy, setCopy] = useState({ headline: brief.headline ?? '', supporting: brief.supporting ?? '', cta: brief.cta ?? '', brand: brief.brand ?? '', url: '' })
  const [stats, setStats] = useState('')
  const [prices, setPrices] = useState('')
  const [ratings, setRatings] = useState('')
  const [pills, setPills] = useState('')
  const [checklist, setChecklist] = useState('')
  const [queue, setQueue] = useState<BrollSuggestion[]>([])
  const [error, setError] = useState<string | null>(null)

  const fill: HomeFill = useMemo(() => {
    const f: HomeFill = {}
    for (const k of ['headline', 'supporting', 'cta', 'brand', 'url'] as const) if (copy[k].trim()) f[k] = copy[k].trim()
    const st = rows(stats).map(([value, label]) => ({ value, label: label ?? '' }))
    if (st.length) f.stats = st
    const pr = rows(prices).map(([name, price, icon]) => ({ name, price: price ?? '', icon }))
    if (pr.length) f.prices = pr
    const ra = rows(ratings).map(([label, value]) => ({ label, value: Number(value) })).filter((r) => Number.isFinite(r.value))
    if (ra.length) f.ratings = ra
    const pw = pills.split(',').map((w) => w.trim()).filter(Boolean)
    if (pw.length) f.pillWords = pw
    const cl = checklist.split('\n').map((l) => l.trim()).filter(Boolean)
    if (cl.length) f.checklist = cl
    return f
  }, [copy, stats, prices, ratings, pills, checklist])

  const plan = useMemo(() => {
    try { return planHomeVideo(doc, style, fill) } catch (err) { return err instanceof Error ? err.message : String(err) }
  }, [doc, style, fill])

  function submit(e: FormEvent) {
    e.preventDefault()
    if (typeof plan === 'string') { setError(plan); return }
    onApply(plan.doc, `Build ${HOME_STYLES.find((s) => s.id === style)?.name}`)
    setQueue(plan.broll)
    setError(null)
  }

  function acceptOne(s: BrollSuggestion) {
    try {
      onApply(acceptBroll(doc, s), `B-roll slot: ${s.label}`)
      setQueue((q) => q.filter((x) => x.id !== s.id))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const meta = HOME_STYLES.find((s) => s.id === style)!
  const showStats = style === 'launch-stats'
  const showPrices = style === 'mascot-checkout'
  const showRatings = style === 'kinetic-float'
  const showPills = style === 'red-pill'

  return (
    <div className="cu-panel absolute left-0 top-full z-40 mt-2 w-[520px] p-3 shadow-2xl" role="dialog" aria-label="Home_X video styles">
      <form onSubmit={submit} onKeyDown={(e) => { if (e.key === 'Escape') onClose(); if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit(e) }} className="space-y-2">
        <div className="grid grid-cols-2 gap-1.5" role="radiogroup" aria-label="Style">
          {HOME_STYLES.map((s) => (
            <button key={s.id} type="button" role="radio" aria-checked={style === s.id} onClick={() => setStyle(s.id)} className={`rounded-lg border p-2 text-left transition-colors duration-150 ${style === s.id ? 'border-accent bg-accent/10' : 'border-line hover:border-accent/50'}`}>
              <span className="block text-sm font-medium text-text">{s.name}</span>
              <span className="block text-xs text-muted"><span className="font-mono tabular-nums">{s.durationSec}s · {s.fps}fps</span> — {s.summary}</span>
            </button>
          ))}
        </div>
        <p className="text-xs text-muted">{brief.headline ? 'Copy below comes from your locked brief — edit freely.' : 'No locked brief yet, so copy fields start empty and the video shows neutral placeholders.'}</p>
        <div className="grid grid-cols-2 gap-2">
          {(['headline', 'supporting', 'cta', 'brand', 'url'] as const).map((k) => (
            <label key={k} className="block space-y-1">
              <span className="text-xs font-medium capitalize text-muted">{k === 'cta' ? 'CTA' : k === 'url' ? 'URL' : k}</span>
              <input className={inputCx} value={copy[k]} onChange={(e) => setCopy((c) => ({ ...c, [k]: e.target.value }))} />
            </label>
          ))}
        </div>
        {showStats && <Area label="Your stats — one per line: value | label" hint="Only your real figures. Empty cards show “Add your number”." value={stats} onChange={setStats} />}
        {showPrices && <Area label="Your products — name | price | icon (laptop, books, camera)" hint="Only your real prices." value={prices} onChange={setPrices} />}
        {showRatings && <Area label="Your ratings — label | percent" hint="Only real scores; empty bars read “Add a rating”." value={ratings} onChange={setRatings} />}
        {showPills && (
          <>
            <label className="block space-y-1"><span className="text-xs font-medium text-muted">Words to show as pills (comma-separated, must be in the headline)</span><input className={inputCx} value={pills} onChange={(e) => setPills(e.target.value)} /></label>
            <Area label="Checklist lines (last line is the active red one)" value={checklist} onChange={setChecklist} />
          </>
        )}
        <div className="rounded-lg border border-line p-2 text-xs text-muted" aria-live="polite">
          <p className="mb-1 font-medium text-text">Preview of changes</p>
          {typeof plan === 'string' ? <p className="text-danger">{plan}</p> : <ul className="list-disc space-y-0.5 pl-4">{plan.changes.map((c) => <li key={c}>{c}</li>)}</ul>}
        </div>
        {error && <p className="text-xs text-danger" role="alert">{error}</p>}
        <div className="flex items-center justify-end gap-2">
          <button type="button" className="cu-chip px-3 py-1.5 text-xs" onClick={onClose}>Close</button>
          <button type="submit" className="rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-accent-ink active:scale-[0.96]" disabled={typeof plan === 'string'}>Accept — add {meta.name} <kbd className="ml-1 font-mono">⌘↵</kbd></button>
        </div>
        {typeof plan === 'string' && <p className="text-right text-xs text-muted">Fix the error above to enable Accept.</p>}
      </form>
      {queue.length > 0 && (
        <div className="mt-3 border-t border-line pt-2">
          <p className="mb-1 text-xs font-medium text-text">B-roll suggestions — accept each one you want (adds a “drop media here” slot)</p>
          <ul className="space-y-1">
            {queue.map((s) => (
              <li key={s.id} className="flex items-center gap-2 text-xs">
                <span className="min-w-0 flex-1 text-muted"><span className="font-mono tabular-nums text-text">{s.startSec.toFixed(1)}s</span> {s.label} — {s.reason}</span>
                <button type="button" className="cu-chip px-2 py-1" onClick={() => acceptOne(s)}>Accept</button>
                <button type="button" className="cu-chip px-2 py-1" onClick={() => setQueue((q) => q.filter((x) => x.id !== s.id))}>Dismiss</button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

function Area({ label, hint, value, onChange }: { label: string; hint?: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="block space-y-1">
      <span className="text-xs font-medium text-muted">{label}</span>
      <textarea className={inputCx} rows={3} value={value} onChange={(e) => onChange(e.target.value)} />
      {hint && <span className="block text-xs text-muted">{hint}</span>}
    </label>
  )
}
