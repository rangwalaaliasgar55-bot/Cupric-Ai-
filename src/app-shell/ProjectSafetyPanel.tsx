/**
 * Settings → Project safety: version history (2.26) and the one-click
 * diagnostic report (2.27). Lives in the Ask panel's settings drawer, next to
 * the media-engine and update rows.
 */
import { useCallback, useEffect, useState } from 'react'
import { ClipboardCopy, History, RotateCcw, Save } from 'lucide-react'
import { listVersions, restoreVersion, snapshotNow, type ProjectVersion } from '../lib/projectHistory'
import { copyDiagnosticReport } from '../lib/diagnostics'
import { humanError } from '../lib/humanError'
import { useProjectStore } from '../state/useProjectStore'
import { getIpc } from '../lib/bridge'

function when(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function size(bytes: number): string {
  if (bytes > 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  return `${Math.max(1, Math.round(bytes / 1024))} KB`
}

const LABELS: Record<string, string> = { autosave: 'Autosave', manual: 'Kept by you', 'before-restore': 'Before a restore' }

export function ProjectSafetyPanel() {
  const pushToast = useProjectStore((s) => s.pushToast)
  const [versions, setVersions] = useState<ProjectVersion[] | null>(null)
  const [open, setOpen] = useState(false)
  const [reportText, setReportText] = useState<string | null>(null)
  const [hwEncoding, setHwEncoding] = useState<'auto' | 'off' | null>(null)

  useEffect(() => {
    const ipc = getIpc()
    if (!ipc) return
    void ipc.invoke('settings:get').then((s: { hardwareEncoding?: 'auto' | 'off' }) => setHwEncoding(s?.hardwareEncoding === 'off' ? 'off' : 'auto')).catch(() => undefined)
  }, [])

  async function toggleHw(next: boolean) {
    const ipc = getIpc()
    if (!ipc) return
    const saved = await ipc.invoke('settings:set', { hardwareEncoding: next ? 'auto' : 'off' })
    setHwEncoding(saved?.hardwareEncoding === 'off' ? 'off' : 'auto')
  }

  const refresh = useCallback(async () => {
    try {
      setVersions(await listVersions())
    } catch (err) {
      setVersions([])
      pushToast('error', humanError(err, 'Could not list saved versions'))
    }
  }, [pushToast])

  useEffect(() => {
    if (open) void refresh()
  }, [open, refresh])

  async function keepNow() {
    try {
      await snapshotNow()
      pushToast('success', 'Kept this version. You can restore it any time.')
      void refresh()
    } catch (err) {
      pushToast('error', humanError(err, 'Could not keep a version'))
    }
  }

  async function restore(v: ProjectVersion) {
    const ok = window.confirm(`Restore the version from ${when(v.at)}?\n\n${v.projects} project(s), ${v.clips} clip(s). What you have now is kept as a “Before a restore” version, so this can be undone.`)
    if (!ok) return
    try {
      await restoreVersion(v.id)
    } catch (err) {
      pushToast('error', humanError(err, 'Could not restore that version'))
    }
  }

  async function copyReport() {
    try {
      const { text, copied } = await copyDiagnosticReport()
      if (copied) {
        setReportText(null)
        pushToast('success', 'Diagnostic report copied — paste it wherever you report the problem. It contains no API keys.')
      } else {
        setReportText(text)
        pushToast('info', 'Copying was blocked — the report is shown below to select and copy.')
      }
    } catch (err) {
      pushToast('error', humanError(err, 'Could not build the diagnostic report'))
    }
  }

  return (
    <div className="space-y-2">
      {hwEncoding && (
        <label className="flex items-center justify-between gap-3 rounded-lg border border-line bg-bg/40 px-3 py-2 text-xs text-muted" title="Uses NVENC, Quick Sync, AMF or VideoToolbox when one works on this machine, and falls back to software encoding automatically">
          <span>
            Hardware-accelerated export
            <span className="block text-muted/70">Faster MP4 export on a supported GPU; falls back to software automatically.</span>
          </span>
          <input type="checkbox" checked={hwEncoding === 'auto'} onChange={(e) => void toggleHw(e.target.checked)} />
        </label>
      )}
      <div className="rounded-lg border border-line bg-bg/40 px-3 py-2 text-xs text-muted">
        <div className="flex items-center justify-between gap-3">
          <span className="flex items-center gap-1.5"><History size={12} /> Version history</span>
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => void keepNow()} className="flex items-center gap-1 text-muted underline underline-offset-2 hover:text-text">
              <Save size={11} /> Keep this version
            </button>
            <button type="button" onClick={() => setOpen((v) => !v)} className="text-muted underline underline-offset-2 hover:text-text">
              {open ? 'Hide' : 'Show'}
            </button>
          </div>
        </div>
        <div className="mt-1 text-muted/70">Your work autosaves continuously, and a restorable copy is kept every couple of minutes.</div>
        {open && (
          <ul className="mt-2 max-h-56 space-y-1 overflow-y-auto" aria-label="Saved versions">
            {versions === null && <li>Loading…</li>}
            {versions?.length === 0 && <li>No saved versions yet — one is kept a couple of minutes after your first edit.</li>}
            {versions?.map((v) => (
              <li key={v.id} className="flex items-center gap-2 rounded-md border border-line/60 px-2 py-1.5">
                <div className="min-w-0 flex-1">
                  <div className="text-text">{when(v.at)} <span className="text-muted">· {LABELS[v.label] ?? v.label}</span></div>
                  <div className="truncate text-[11px] text-muted/80">
                    {v.valid ? `${v.projects} project(s) · ${v.clips} clip(s) · ${size(v.bytes)}${v.names.length ? ` · ${v.names.join(', ')}` : ''}` : 'Damaged — cannot be restored'}
                  </div>
                </div>
                <button
                  type="button"
                  disabled={!v.valid} title={(!v.valid) ? 'This version is damaged and cannot be restored' : undefined}
                  onClick={() => void restore(v)}
                  className="flex shrink-0 items-center gap-1 rounded-md border border-line px-1.5 py-0.5 text-[11px] hover:border-accent/60 hover:text-text disabled:opacity-40"
                  aria-label={`Restore the version from ${when(v.at)}`}
                >
                  <RotateCcw size={11} /> Restore
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="rounded-lg border border-line bg-bg/40 px-3 py-2 text-xs text-muted">
        <div className="flex items-center justify-between gap-3">
          <span>Something went wrong?</span>
          <button type="button" onClick={() => void copyReport()} className="flex shrink-0 items-center gap-1 rounded-md border border-line px-2 py-1 text-text hover:border-accent/60">
            <ClipboardCopy size={11} /> Copy diagnostic report
          </button>
        </div>
        <div className="mt-1 text-muted/70">Version, system, media engine, AI provider and recent errors — never your API keys.</div>
        {reportText && (
          <textarea readOnly value={reportText} className="mt-2 h-40 w-full rounded-md border border-line bg-bg p-2 font-mono text-[10px] text-text" onFocus={(e) => e.currentTarget.select()} />
        )}
      </div>
    </div>
  )
}
