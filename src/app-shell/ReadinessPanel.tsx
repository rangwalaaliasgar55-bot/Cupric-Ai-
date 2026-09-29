/**
 * Readiness, as a panel: what this machine can do, and what is missing.
 *
 * Adapted from open-edit's `readiness` command (Apache-2.0, see
 * THIRD_PARTY_NOTICES.md) — see `src/lib/readiness.ts` for why Cupric needs it:
 * the app degrades quietly by design, so "no offline recogniser found" and "a
 * WebM draft instead of an MP4" are easy to mistake for the app being broken.
 *
 * Read-only, no network: it asks the main process what it found and prints the
 * answer, with the remedy beside every miss and a marker for the checks that are
 * optional rather than blocking.
 */
import { useCallback, useEffect, useState } from 'react'
import { CheckCircle2, CircleAlert, CircleDashed, RefreshCw } from 'lucide-react'
import { describeReadiness, type ReadinessCheck, type ReadinessReport } from '../lib/readiness'
import { gatherReadinessFacts } from '../lib/readinessFacts'
import { studioOf } from '../lib/studio/doc'
import { useActiveProject } from '../state/useProjectStore'
import { cx } from '../lib/utils'

const AREA_LABELS: Record<ReadinessCheck['area'], string> = {
  export: 'Export',
  captions: 'Captions',
  voice: 'Voice',
  ai: 'Writing',
  footage: 'Footage',
  project: 'This project',
}

function Mark({ check }: { check: ReadinessCheck }) {
  if (check.ok) return <CheckCircle2 size={12} className="mt-0.5 shrink-0 text-accent-text" aria-label="Available" />
  if (check.blocking) return <CircleAlert size={12} className="mt-0.5 shrink-0 text-[rgb(255_196_92)]" aria-label="Blocking" />
  return <CircleDashed size={12} className="mt-0.5 shrink-0 text-muted" aria-label="Optional" />
}

export function ReadinessPanel() {
  const project = useActiveProject()
  const [report, setReport] = useState<ReadinessReport | null>(null)
  const [busy, setBusy] = useState(false)

  const doc = project ? studioOf(project) : null
  const renderable = Boolean(project && (project.timeline.length > 0 || project.brief.lockedRundown))

  const probe = useCallback(async () => {
    setBusy(true)
    try {
      const facts = await gatherReadinessFacts(doc, { renderable })
      setReport(describeReadiness(facts))
    } finally {
      setBusy(false)
    }
  }, [doc, renderable])

  // Probed when the drawer opens, and on demand after that: nothing here is
  // expensive, but a stale "no FFmpeg" after an install would be worse than none.
  useEffect(() => {
    void probe()
  }, [probe])

  return (
    <div className="rounded-lg border border-line bg-bg/40 px-3 py-2 text-xs text-muted">
      <div className="flex items-center justify-between gap-3">
        <span>What this machine can do</span>
        <button
          type="button"
          onClick={() => void probe()}
          disabled={busy}
          title={busy ? 'Checking what is installed — one moment' : 'Ask the machine again (nothing here installs anything)'}
          className="flex shrink-0 items-center gap-1 text-muted underline underline-offset-2 hover:text-text disabled:opacity-50"
        >
          <RefreshCw size={11} className={busy ? 'motion-safe:animate-spin' : undefined} /> {busy ? 'Checking…' : 'Re-check'}
        </button>
      </div>
      <div className={cx('mt-1', report && !report.ok ? 'text-[rgb(255_196_92)]' : 'text-muted/70')}>
        {report ? report.summary : 'Checking what is installed…'}
      </div>
      {report && (
        <ul className="mt-2 space-y-1.5">
          {report.checks.map((check) => (
            <li key={check.id} className="flex items-start gap-2">
              <Mark check={check} />
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-2">
                  <span className={check.ok ? 'text-text' : 'text-text'}>{check.label}</span>
                  <span className="text-[10px] uppercase tracking-wide text-muted/70">{AREA_LABELS[check.area]}</span>
                  {!check.ok && <span className="text-[10px] text-muted/70">{check.blocking ? 'blocking' : 'optional'}</span>}
                </div>
                <div className="text-muted/80">{check.detail}</div>
                {check.remedy && <div className="text-muted/70">{check.remedy}</div>}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
