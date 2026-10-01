/**
 * Libraries.dev area: the 7 libraries in the installed skill
 * (resources/libraries-dev), the read-only `libraries review` report, and the
 * `libraries apply` hand-off.
 *
 * The report is produced by `node scripts/libraries-review.mjs`, because the
 * renderer can't read the repo. Apply never installs anything from inside the
 * app. The secure IPC allowlist has no shell or npm channel, and the skill
 * says to ask before installing. So Apply gives you the exact command and the
 * placement for your approval.
 */
import { useMemo, useState } from 'react'
import { Copy, ExternalLink } from 'lucide-react'
import { Card } from '../../components/Card'
import { Badge } from '../../components/Badge'
import { Button } from '../../components/Button'
import report from '../../../resources/libraries-dev/review.json'
import { useProjectStore } from '../../state/useProjectStore'

type Lib = (typeof report.libraries)[number]
type Finding = (typeof report.findings)[number]
type Tab = 'libraries' | 'review' | 'apply'

export function LibrariesDev() {
  const [tab, setTab] = useState<Tab>('libraries')
  const [pkg, setPkg] = useState<string>('all')
  const [pick, setPick] = useState<Finding | null>(null)
  const pushToast = useProjectStore((s) => s.pushToast)
  const findings = useMemo(() => report.findings.filter((f) => pkg === 'all' || f.package === pkg), [pkg])
  const copy = (text: string) => navigator.clipboard?.writeText(text).then(() => pushToast('success', 'Copied.'), () => pushToast('error', 'Clipboard unavailable.'))

  return (
    <Card className="p-5" data-testid="libraries-dev">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">Libraries.dev</h2>
          <p className="mt-1 max-w-2xl text-xs text-muted">The {report.libraries.length} MIT libraries in the Libraries.dev skill, where they fit in NewBrand, and how to add one. Nothing here changes code without your approval.</p>
        </div>
        <div role="tablist" aria-label="Libraries.dev" className="flex gap-1">
          {(['libraries', 'review', 'apply'] as Tab[]).map((t) => (
            <button key={t} role="tab" aria-selected={tab === t} type="button" onClick={() => setTab(t)}
              className={`rounded-lg border px-2.5 py-1 text-xs capitalize transition-colors duration-150 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent ${tab === t ? 'border-accent bg-accent/10 text-text' : 'border-line text-muted hover:text-text'}`}>
              {t === 'libraries' ? 'Libraries' : `libraries ${t}`}
            </button>
          ))}
        </div>
      </div>

      {tab === 'libraries' && (
        <div className="mt-4 grid gap-2 md:grid-cols-2">
          {report.libraries.map((l: Lib) => (
            <div key={l.package} className="rounded-lg border border-line px-3 py-2 text-xs">
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium text-text">{l.name} <span className="font-mono text-muted">{l.package}@{l.version}</span></span>
                <span className="flex gap-1"><Badge>{l.license}</Badge>{l.installed && <Badge tone="accent">installed</Badge>}</span>
              </div>
              <div className="mt-1 text-muted"><span className="font-mono">{`<${l.component}>`}</span> · {l.useFor}</div>
              <a href={l.homepage} target="_blank" rel="noreferrer" className="mt-1 inline-flex items-center gap-1 text-muted hover:text-accent-text">{l.homepage} <ExternalLink size={11} /></a>
            </div>
          ))}
        </div>
      )}

      {tab === 'review' && (
        <div className="mt-4 space-y-2">
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
            <span>{report.counts.findings} findings in {report.counts.files} files · {report.counts.applied} applied · read-only.</span>
            <select aria-label="Filter by library" className="cu-input px-2 py-1 text-xs" value={pkg} onChange={(e) => setPkg(e.target.value)}>
              <option value="all">All libraries</option>
              {report.libraries.map((l: Lib) => <option key={l.package} value={l.package}>{l.name}</option>)}
            </select>
            <span>Refresh with <code className="font-mono">npm run libraries:review</code></span>
          </div>
          <ul className="max-h-96 space-y-1.5 overflow-y-auto pr-1">
            {findings.map((f, i) => (
              <li key={`${f.file}-${f.line}-${f.target}-${i}`} className="rounded-lg border border-line px-3 py-2 text-xs">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-mono text-text">{f.file}{f.line ? `:${f.line}` : ''}</span>
                  <Badge tone={f.status === 'applied' ? 'accent' : f.status === 'no-fit' ? 'neutral' : 'info'}>{f.status}</Badge>
                </div>
                <div className="text-muted">{f.target} → <span className="text-text">{f.suggestedLibrary}</span>{f.variant ? ` (${f.variant})` : ''}. {f.why}</div>
                <div className="text-muted/80">Risk: {f.risks}</div>
                {f.status === 'suggested' && <button type="button" className="mt-1 text-accent-text hover:underline" onClick={() => { setPick(f); setTab('apply') }}>Plan apply →</button>}
              </li>
            ))}
          </ul>
        </div>
      )}

      {tab === 'apply' && (
        <div className="mt-4 space-y-2 text-xs text-muted">
          {!pick ? <p>Pick a suggestion under <strong>libraries review</strong> to plan an apply.</p> : (() => {
            const lib = report.libraries.find((l: Lib) => l.package === pick.package)
            const cmd = `npm install ${pick.package}${lib && 'peer' in lib && lib.peer ? ` ${lib.peer}` : ''}`
            return (
              <>
                <p className="text-text">{pick.suggestedLibrary} → {pick.file}{pick.line ? `:${pick.line}` : ''}</p>
                <p>{pick.why} Variant: {pick.variant ?? 'n/a'}. Licence: {pick.license}. Risk: {pick.risks}</p>
                <div className="flex items-center gap-2"><code className="rounded bg-panel-alt px-2 py-1 font-mono text-text">{cmd}</code><Button size="sm" variant="outline" onClick={() => copy(cmd)}><Copy size={12} /> Copy</Button></div>
                <p>For your approval: the app can't run npm itself (the secure bridge has no shell access). Run the command in the repo, then import <span className="font-mono">{lib?.component}</span> from a client component. Follow {lib?.reference} for the exact props, and respect reduced motion.</p>
              </>
            )
          })()}
        </div>
      )}
    </Card>
  )
}
