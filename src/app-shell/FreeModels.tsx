import { useCallback, useEffect, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { getIpc } from '../lib/bridge'

type Row = { id: string; source: string; kind: string; badge: string; isNew: boolean; retired: boolean }

/**
 * JOB 2 — model catalogue. Filled silently by the main process (24 h cache,
 * refresh on start when stale, weekly timer). Refresh and "Free only" are
 * overrides; nothing here is needed for AI to work. Never changes the saved
 * selection. Rows carry presence only — no key material.
 */
export function FreeModels() {
  const [rows, setRows] = useState<Row[]>([])
  const [freeOnly, setFreeOnly] = useState(() => { try { return localStorage.getItem('cupric.models.freeOnly') !== '0' } catch { return true } })
  const [busy, setBusy] = useState(false)
  const [fetchedAt, setFetchedAt] = useState(0)
  const load = useCallback(async (force = false) => {
    const ipc = getIpc()
    if (!ipc) return
    setBusy(true)
    try {
      const res = (await ipc.invoke('ai:freeModels', { force })) as { fetchedAt?: number; models?: Row[] }
      setRows(Array.isArray(res?.models) ? res.models : [])
      setFetchedAt(Number(res?.fetchedAt) || 0)
    } catch { /* silent: the brain works without this list */ } finally { setBusy(false) }
  }, [])
  useEffect(() => {
    void load(false)
    const ipc = getIpc()
    const off = ipc && typeof ipc.on === 'function' ? ipc.on('ai:models', () => void load(false)) : undefined
    return () => off?.()
  }, [load])
  useEffect(() => { try { localStorage.setItem('cupric.models.freeOnly', freeOnly ? '1' : '0') } catch { /* ignore */ } }, [freeOnly])
  if (!getIpc()) return null
  const shown = rows.filter((r) => !freeOnly || r.badge === 'FREE' || r.badge === '$0 local').slice(0, 60)
  const newCount = rows.filter((r) => r.isNew).length
  return (
    <div className="rounded-lg border border-line bg-panel p-2 text-xs" data-testid="free-models">
      <div className="flex items-center justify-between gap-2">
        <span className="font-semibold text-text">Models {newCount ? <span className="ml-1 rounded bg-accent px-1 text-accent-ink">{newCount} NEW</span> : null}</span>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1 text-muted"><input type="checkbox" checked={freeOnly} onChange={(e) => setFreeOnly(e.target.checked)} /> Free only</label>
          <button type="button" aria-label="Refresh model list" title="Refresh model list" disabled={busy} onClick={() => void load(true)} className="rounded border border-line p-1 text-muted disabled:opacity-50">
            <RefreshCw size={12} aria-hidden className={busy ? 'motion-safe:animate-spin' : ''} />
          </button>
        </div>
      </div>
      {!rows.length ? (
        <p className="mt-1 text-muted">{busy ? 'Checking your providers…' : 'No models to list yet. Add a provider key or start a local model server in Settings — the list is your own account\u2019s models, never a shared pool.'}</p>
      ) : (
        <ul className="mt-1.5 max-h-40 space-y-0.5 overflow-auto">
          {shown.map((r) => (
            <li key={`${r.source}|${r.id}`} className={`flex items-center justify-between gap-2 ${r.retired ? 'text-muted line-through opacity-60' : 'text-text'}`} title={r.retired ? 'Retired by its provider — Cupric falls back automatically' : r.source}>
              <span className="truncate">{r.id}{r.isNew && <span className="ml-1 rounded bg-accent px-1 text-accent-ink">NEW</span>}</span>
              <span className="shrink-0 text-muted">{r.retired ? 'retired' : r.badge}</span>
            </li>
          ))}
        </ul>
      )}
      {fetchedAt > 0 && <p className="mt-1 text-muted">Updated {new Date(fetchedAt).toLocaleDateString()}</p>}
    </div>
  )
}
