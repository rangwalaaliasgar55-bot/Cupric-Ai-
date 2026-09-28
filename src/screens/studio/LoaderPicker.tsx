import { useState } from 'react'
import { LOADER_PRESETS } from '../../lib/studio/loaders'
import { LoaderPreview } from './LoaderPreview'

/** Loader library popover (Transitions.dev thinking states + matrix loader presets). */
export function LoaderPicker({ onPick, onClose }: { onPick: (presetId: string) => void; onClose: () => void }) {
  const [q, setQ] = useState('')
  const list = LOADER_PRESETS.filter((p) => !q || `${p.name} ${p.description}`.toLowerCase().includes(q.toLowerCase()))
  return (
    <div className="cu-panel absolute left-0 top-full z-40 mt-2 w-[480px] p-3 shadow-2xl" role="dialog" aria-label="Loaders">
      <div className="mb-2 flex items-center gap-2">
        <input autoFocus className="cu-input min-w-0 flex-1 px-2.5 py-1.5 text-sm" placeholder="Search — thinking, scan, orbit, lime…" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Escape' && onClose()} />
        <button type="button" className="cu-chip px-2 py-1 text-xs" onClick={onClose}>Close</button>
      </div>
      <div className="grid max-h-96 grid-cols-2 gap-2 overflow-y-auto pr-1">
        {list.map((p) => (
          <button key={p.id} type="button" title={p.description} onClick={() => onPick(p.id)} className="flex flex-col gap-1 rounded-lg border border-line bg-black/20 p-1.5 text-left text-text/90 transition hover:border-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent">
            <LoaderPreview clip={p.patch} width={200} height={84} label={p.name} />
            <span className="truncate text-xs">{p.name}</span>
          </button>
        ))}
        {!list.length && <p className="col-span-2 py-6 text-center text-xs text-muted">No loader matches “{q}”.</p>}
      </div>
      <p className="mt-2 text-xs text-muted">From Transitions.dev (attributed). Drawn natively: preview and export match frame for frame.</p>
    </div>
  )
}
