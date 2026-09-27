import { useMemo, useState } from 'react'
import { SHAPES, shapeGeometry, type ShapeCategory } from '../../lib/studio/shapes'
import { cx } from '../../lib/utils'

const CATS: Array<[ShapeCategory | 'all', string]> = [['all', 'All'], ['emphasis', 'Emphasis'], ['arrow', 'Arrows'], ['callout', 'Callouts'], ['ui', 'UI'], ['symbol', 'Symbols'], ['basic', 'Basic'], ['polygon', 'Polygons'], ['frame', 'Frames'], ['line', 'Lines'], ['organic', 'Organic']]

function Thumb({ id, aspect, strokeOnly }: { id: string; aspect: number; strokeOnly?: boolean }) {
  const d = useMemo(() => shapeGeometry(id, { aspect }).map((s) => 'M' + s.pts.map(([x, y]) => `${(x * 40).toFixed(1)} ${(y * 40 * Math.min(1, Math.max(0.15, aspect))).toFixed(1)}`).join('L') + (s.closed ? 'Z' : '')).join(' '), [id, aspect])
  return (
    <svg viewBox="-24 -24 48 48" className="h-9 w-9" aria-hidden>
      <path d={d} fill={strokeOnly ? 'none' : 'currentColor'} fillOpacity={strokeOnly ? 0 : 0.85} stroke="currentColor" strokeWidth={strokeOnly ? 2.5 : 0} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

/** Shape library popover — every shape shows where professional editors use it. */
export function ShapePicker({ onPick, onClose }: { onPick: (id: string) => void; onClose: () => void }) {
  const [cat, setCat] = useState<ShapeCategory | 'all'>('all')
  const [q, setQ] = useState('')
  const list = SHAPES.filter((s) => (cat === 'all' || s.category === cat) && (!q || `${s.name} ${s.use} ${s.tags?.join(' ')}`.toLowerCase().includes(q.toLowerCase())))
  return (
    <div className="cu-panel absolute left-0 top-full z-40 mt-2 w-[440px] p-3 shadow-2xl" role="dialog" aria-label="Shapes">
      <div className="mb-2 flex items-center gap-2">
        <input autoFocus className="cu-input min-w-0 flex-1 px-2.5 py-1.5 text-sm" placeholder="Search — arrow, underline, badge, before after…" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Escape' && onClose()} />
        <button type="button" className="cu-chip px-2 py-1 text-xs" onClick={onClose}>Close</button>
      </div>
      <div className="mb-2 flex flex-wrap gap-1">
        {CATS.map(([id, label]) => <button key={id} type="button" className={cx('cu-chip px-2 py-0.5 text-xs', cat === id && 'border-accent text-accent')} onClick={() => setCat(id)}>{label}</button>)}
      </div>
      <div className="grid max-h-80 grid-cols-5 gap-1.5 overflow-y-auto pr-1">
        {list.map((s) => (
          <button key={s.id} type="button" title={`${s.name} — ${s.use}`} onClick={() => onPick(s.id)} className="flex flex-col items-center gap-1 rounded-lg border border-line bg-black/20 px-1 py-2 text-text/90 transition hover:border-accent hover:text-accent">
            <Thumb id={s.id} aspect={s.aspect} strokeOnly={s.strokeOnly} />
            <span className="w-full truncate text-center text-[10px]">{s.name}</span>
          </button>
        ))}
        {!list.length && <p className="col-span-5 py-6 text-center text-xs text-muted">No shape matches “{q}”.</p>}
      </div>
      <p className="mt-2 text-[11px] text-muted">Hover a shape to see how editors use it. Stroke shapes draw themselves on; filled shapes pop.</p>
    </div>
  )
}
