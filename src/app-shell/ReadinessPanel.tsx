/**
 * Readiness, as a panel: what this machine can do, and what is missing.
 *
 * Adapted from open-edit's `readiness` command (Apache-2.0, see
 * THIRD_PARTY_NOTICES.md) — see `src/lib/readiness.ts` for why NewBrand needs it:
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
import {
  installOfferFor,
  installVoiceEngine,
  listVoiceEngines,
  progressFraction,
  progressLabel,
  type InstallProgress,
  type InstallResult,
  type VoiceEngineList,
} from '../lib/voiceEngines'
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
  const [engines, setEngines] = useState<VoiceEngineList | null>(null)
  /** Real byte progress for an install in flight, keyed by engine id. */
  const [installing, setInstalling] = useState<{ engine: string; progress: InstallProgress | null } | null>(null)
  /** The last real failure, shown verbatim — never replaced by "something went wrong". */
  /**
   * The two ways an install can end without installing anything.
   *
   * `error` is a real failure — a download that failed, an archive that would not
   * unpack — and it is shown in red. `manual` is not a failure: some engines
   * cannot be installed by an app at all (a Windows system voice, whisper.cpp
   * fetched with the build), and the honest outcome is instructions. Showing
   * those in the failure colour taught people to read a perfectly good
   * explanation as something broken.
   */
  const [installError, setInstallError] = useState<{ engine: string; message: string; kind: 'error' | 'manual' } | null>(null)

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

  // Which engines exist here. Read-only, and a failure is reported rather than
  // shown as "nothing installed".
  useEffect(() => {
    let live = true
    listVoiceEngines()
      .then((list) => { if (live) setEngines(list) })
      .catch((error: Error) => { if (live) setInstallError({ engine: 'list', message: error.message, kind: 'error' }) })
    return () => { live = false }
  }, [])

  const runInstall = useCallback(async (engine: string) => {
    setInstallError(null)
    setInstalling({ engine, progress: null })
    const result: InstallResult = await installVoiceEngine(engine, (progress) => {
      // Progress events for other engines are ignored: two installs cannot run
      // from this panel at once, and a stray event must not move this bar.
      setInstalling((current) => (current && current.engine === progress.engine ? { engine: progress.engine, progress } : current))
    })
    if (!result.ok) {
      setInstallError({ engine, message: result.error, kind: result.stage === 'manual' || result.stage === 'platform' ? 'manual' : 'error' })
      setInstalling(null)
      return
    }
    setInstalling(null)
    // Re-probe and re-list: the point of installing is that the checks change.
    const list = await listVoiceEngines().catch(() => null)
    if (list) setEngines(list)
    await probe()
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
                <InstallAction
                  check={check}
                  engines={engines}
                  installing={installing}
                  error={installError?.engine === installOfferFor(check.id, engines?.engines.find((e) => e.id.startsWith('piper'))?.id)?.engine ? installError?.message ?? null : null}
                  errorKind={installError?.engine === installOfferFor(check.id, engines?.engines.find((e) => e.id.startsWith('piper'))?.id)?.engine ? installError?.kind ?? 'error' : null}
                  onInstall={runInstall}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/**
 * The install button for a check that has one.
 *
 * Three states, all real: nothing to offer (the written remedy stays), an offer,
 * and an install in flight with byte counts and, when it fails, the actual
 * message from the download rather than a generic apology.
 */
function InstallAction({
  check,
  engines,
  installing,
  error,
  errorKind,
  onInstall,
}: {
  check: ReadinessCheck
  engines: VoiceEngineList | null
  installing: { engine: string; progress: InstallProgress | null } | null
  error: string | null
  /** `manual` means "here is what to do instead", not "this broke". */
  errorKind: 'error' | 'manual' | null
  onInstall: (engine: string) => void
}) {
  if (check.ok) return null
  const piper = engines?.engines.find((e) => e.id === 'piper')
  const offer = installOfferFor(check.id, piper?.id)
  if (!offer) return null
  const active = installing?.engine === offer.engine
  const info = engines?.engines.find((e) => e.id === offer.engine)
  const fraction = active ? progressFraction(installing.progress) : null
  /**
   * Why the button cannot be pressed, in words.
   *
   * A greyed-out control with no explanation is a dead end wearing a different
   * hat, and `check-ui-audit.mjs` fails the build for it. The reason is both
   * visible and wired to the button with `aria-describedby`, so it reaches a
   * screen reader too.
   */
  const blockedReason = engines && !engines.supported
    ? 'Speech engines install themselves on Windows only.'
    : installing && !active
      ? `Waiting for the ${installing.engine} download to finish.`
      : null
  const reasonId = `install-reason-${offer.engine}`
  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={() => onInstall(offer.engine)}
        disabled={Boolean(installing) || (engines ? !engines.supported : false)}
        title={blockedReason ?? `Download ${info?.label ?? offer.engine} and install it into your NewBrand folder`}
        aria-describedby={blockedReason ? reasonId : undefined}
        className="rounded-md border border-line bg-panel-alt/60 px-2 py-1 text-[11px] font-medium text-text transition-colors duration-150 hover:border-text/20 hover:bg-panel-alt disabled:opacity-50"
      >
        {active ? progressLabel(installing.progress) : offer.verb}
      </button>
      {blockedReason && <span id={reasonId} className="text-[11px] text-muted/70">{blockedReason}</span>}
      {info?.sizeHint && <span className="text-[11px] text-muted/70">{info.sizeHint}</span>}
      {active && (
        <progress
          // Determinate only when the server declared a length.
          value={fraction ?? undefined}
          max={fraction === null ? undefined : 1}
          className="h-1.5 w-32"
          aria-label={`Downloading ${info?.label ?? offer.engine}`}
        />
      )}
      {error && (
        <span
          className={errorKind === 'manual' ? 'text-[11px] text-muted' : 'text-[11px] text-danger'}
          // Instructions are read, a failure is announced. Both are surfaced;
          // neither is swallowed, and the difference is in the wording and the
          // colour, not in whether a person sees it.
          role={errorKind === 'manual' ? undefined : 'alert'}
        >
          {error}
        </span>
      )}
    </div>
  )
}
