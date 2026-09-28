/**
 * Production planner, the guided autonomous flow on the Autonomous screen:
 * Intake → Brief → Research → Plan → Preview → Build → Review → Export.
 *
 * - Every stage change is saved on the project as a checkpoint, so a restart
 *   resumes here.
 * - Build is one undoable step (commitProduction) and appends by default.
 *   Replacing the timeline needs a second, explicit consent.
 * - Manual approval is the only gate. Nothing is auto-approved.
 */
import { useEffect, useMemo, useState } from 'react'
import { CheckCircle2, AlertTriangle, XCircle, ExternalLink } from 'lucide-react'
import { Card } from '../../components/Card'
import { Button } from '../../components/Button'
import { Badge } from '../../components/Badge'
import { MatrixLoader } from '../../components/loaders/MatrixLoader'
import { ThinkingStates } from '../../components/loaders/ThinkingStates'
import { useActiveProject, useProjectStore } from '../../state/useProjectStore'
import { studioOf } from '../../lib/studio/doc'
import { LOADER_PRESETS } from '../../lib/studio/loaders'
import { uid } from '../../lib/utils'
import {
  INTAKE_QUESTIONS, buildBrief, buildPlan, detectLanguage, normaliseSession, openQuestions, planToDoc, polishEdit, research, reviewEdit, reviewScore,
  type OpusIndex, type ResourceCandidate,
} from '../../lib/production/engine'
import { PRODUCTION_STAGES, type Confidence, type ProductionIntake, type ProductionSession, type ProductionStage } from '../../lib/production/types'

const STAGE_LABEL: Record<ProductionStage, string> = { intake: 'Intake', brief: 'Brief', research: 'Research', plan: 'Plan', preview: 'Preview', build: 'Build', review: 'Review', export: 'Export' }
const CONF_TONE: Record<Confidence, 'accent' | 'info' | 'danger'> = { high: 'accent', medium: 'info', low: 'danger' }
const inputCx = 'w-full cu-input px-2.5 py-1.5 text-sm text-text'

type Catalogue = { index: OpusIndex; resources: ResourceCandidate[] }

function useCatalogue(): { data: Catalogue | null; error: string | null } {
  const [data, setData] = useState<Catalogue | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let live = true
    Promise.all([import('../../../resources/opus55/data/index.json'), import('../../../resources/uselayouts/audit.json')])
      .then(([idx, audit]) => {
        if (!live) return
        const resources: ResourceCandidate[] = [
          ...LOADER_PRESETS.map((p) => ({ id: `transitions-dev-${p.id}`, name: p.name, pack: 'transitions-dev', description: p.description, tags: ['loader', 'loading', 'status'] })),
          ...(audit.default as { items: Array<{ id: string; name: string; description: string; category: string; tags: string[]; insertable: boolean }> }).items
            .filter((i) => i.insertable)
            .map((i) => ({ id: i.id, name: i.name, pack: 'uselayouts', description: i.description, tags: [i.category, ...i.tags] })),
        ]
        setData({ index: idx.default as unknown as OpusIndex, resources })
      })
      .catch((e) => live && setError(e instanceof Error ? e.message : String(e)))
    return () => { live = false }
  }, [])
  return { data, error }
}

export function ProductionPlanner() {
  const project = useActiveProject()
  const commit = useProjectStore((s) => s.commitProduction)
  const setView = useProjectStore((s) => s.setView)
  const pushToast = useProjectStore((s) => s.pushToast)
  const setAskOpen = useProjectStore((s) => s.setAskOpen)
  const [polishNotes, setPolishNotes] = useState<{ fixes: string[]; leftForYou: string[] } | null>(null)
  const { data: catalogue, error } = useCatalogue()
  const session = useMemo(() => normaliseSession(project?.production), [project?.production])
  const [view, setViewStage] = useState<ProductionStage>(session.stage)
  useEffect(() => setViewStage(session.stage), [session.stage])

  if (!project) return <Card className="p-5 text-sm text-muted">Open or create a project to start a guided production.</Card>

  const save = (next: ProductionSession, label: string, studio?: Parameters<typeof commit>[3]) => {
    const withCheckpoint: ProductionSession = next.stage !== session.stage || label.startsWith('Build')
      ? { ...next, checkpoints: [...next.checkpoints, { stage: next.stage, label, at: new Date().toISOString() }].slice(-50) }
      : next
    commit(project.id, withCheckpoint, label, studio)
  }
  const setIntake = (patch: Partial<ProductionIntake>) => save({ ...session, intake: { ...session.intake, ...patch } }, 'Edit production intake')
  const stageIndex = PRODUCTION_STAGES.indexOf(session.stage)
  const open = openQuestions(session.intake)

  function makeBrief() {
    const brief = buildBrief(session.intake)
    save({ ...session, brief, research: null, plan: null, approved: false, review: null, stage: 'brief' }, 'Generate production brief')
  }
  function runResearch() {
    if (!session.brief || !catalogue) return
    save({ ...session, research: research(catalogue.index, session.brief, catalogue.resources), plan: null, approved: false, stage: 'research' }, 'Research references')
  }
  function makePlan() {
    if (!session.brief || !session.research || !catalogue) return
    save({ ...session, plan: buildPlan(catalogue.index, session.brief, session.research), approved: false, stage: 'plan' }, 'Generate production plan')
  }
  function build(replace: boolean) {
    if (!session.plan || !session.brief || !session.approved) return
    const doc = studioOf(project)
    try {
      const r = planToDoc(doc, session.plan, session.brief, { makeId: () => uid(), replace, replaceApproved: session.replaceApproved })
      const review = reviewEdit(r.doc, session.brief, session.plan, r.clipIds)
      save({ ...session, builtClipIds: r.clipIds, review, stage: 'review' }, replace ? 'Build production (replace timeline)' : 'Build production (append)', r.doc)
      pushToast('success', `Built ${r.clipIds.length} editable clips${r.reused ? ` · ${r.reused} use your imported media` : ''}${r.placeholders ? ` · ${r.placeholders} placeholder(s) to replace` : ''}. Undo reverts the whole build.`)
    } catch (e) {
      pushToast('error', e instanceof Error ? e.message : String(e))
    }
  }
  function polish() {
    if (!session.brief || !session.builtClipIds.length) return
    const live = new Set(studioOf(project).clips.map((c) => c.id))
    const ids = session.builtClipIds.filter((id) => live.has(id))
    const r = polishEdit(studioOf(project), session.brief, session.plan, ids)
    const review = reviewEdit(r.doc, session.brief, session.plan, ids)
    save({ ...session, builtClipIds: ids, review }, 'Cupric AI polish', r.doc)
    setPolishNotes({ fixes: r.fixes, leftForYou: r.leftForYou })
    pushToast('success', `Cupric AI applied ${r.fixes.length} fix(es). Undo reverts them all.`)
  }
  function rerunReview() {
    if (!session.brief) return
    save({ ...session, review: reviewEdit(studioOf(project), session.brief, session.plan, session.builtClipIds) }, 'Review production')
  }

  return (
    <Card className="p-5" data-testid="production-planner">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-medium">Guided production</h2>
          <p className="mt-1 max-w-2xl text-xs text-muted">Asks first, plans before touching the timeline, cites the catalogue cases it learned structure from, and never invents copy, stats, quotes or footage. Each stage is saved, so you can close the app and resume.</p>
        </div>
        {session.checkpoints.length > 0 && <Badge tone="neutral">Checkpoint: {session.checkpoints[session.checkpoints.length - 1].label}</Badge>}
      </div>

      <nav className="mt-4 flex flex-wrap gap-1" aria-label="Production stages">
        {PRODUCTION_STAGES.map((s, i) => (
          <button key={s} type="button" onClick={() => setViewStage(s)} disabled={i > stageIndex}
            aria-current={view === s ? 'step' : undefined}
            className={`rounded-lg border px-2.5 py-1 text-xs transition-colors duration-150 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-40 ${view === s ? 'border-accent bg-accent/10 text-text' : 'border-line text-muted hover:text-text'}`}>
            {i + 1}. {STAGE_LABEL[s]}
          </button>
        ))}
      </nav>

      {error && <p className="mt-3 text-xs text-danger" role="alert">Could not load the case catalogue: {error}</p>}
      {!catalogue && !error && (
        <div className="mt-3 flex items-center gap-2 text-xs"><MatrixLoader variant="scan" label="Loading catalogue" /><ThinkingStates states={['Loading the Opus case index', 'Loading resource audits']} /></div>
      )}

      <div className="mt-4 space-y-3">
        {view === 'intake' && (
          <>
            <p className="text-xs text-muted">{open.filter((q) => q.required).length ? `${open.filter((q) => q.required).length} key question(s) left before the brief.` : 'All key questions answered.'} Optional answers improve the plan; blanks become visible assumptions.</p>
            <div className="grid gap-3 md:grid-cols-2">
              {INTAKE_QUESTIONS.map((q) => (
                <label key={q.key} className="block space-y-1">
                  <span className="text-xs font-medium text-text">{q.question}{q.required && <span className="text-accent-text"> *</span>}</span>
                  {q.key === 'aspect' ? (
                    <select className={inputCx} value={session.intake.aspect ?? ''} onChange={(e) => setIntake({ aspect: (e.target.value || null) as ProductionIntake['aspect'] })}>
                      <option value="">Decide from platform</option><option value="9:16">9:16</option><option value="16:9">16:9</option><option value="1:1">1:1</option><option value="4:5">4:5</option>
                    </select>
                  ) : q.key === 'narration' ? (
                    <select className={inputCx} value={session.intake.narration ?? ''} onChange={(e) => setIntake({ narration: (e.target.value || null) as ProductionIntake['narration'] })}>
                      <option value="">Decide for me</option><option value="captions">Captions</option><option value="voiceover">Voiceover</option><option value="both">Both</option><option value="none">Neither</option>
                    </select>
                  ) : q.key === 'language' ? (
                    <select className={inputCx} value={session.intake.language ?? ''} onChange={(e) => setIntake({ language: (e.target.value || null) as ProductionIntake['language'] })}>
                      <option value="">Detect from my text</option><option value="en">English</option><option value="hi">Hindi</option><option value="en+hi">Both</option>
                    </select>
                  ) : q.key === 'durationSec' ? (
                    <input type="number" min={5} max={180} className={inputCx} placeholder={q.placeholder} value={session.intake.durationSec ?? ''} onChange={(e) => setIntake({ durationSec: e.target.value ? Number(e.target.value) : null })} />
                  ) : q.key === 'assets' || q.key === 'mustKeep' ? (
                    <textarea className={`${inputCx} min-h-[64px]`} placeholder={q.placeholder} value={session.intake[q.key] as string} onChange={(e) => setIntake({ [q.key]: e.target.value } as Partial<ProductionIntake>)} />
                  ) : (
                    <input className={inputCx} placeholder={q.placeholder} value={session.intake[q.key] as string} onChange={(e) => setIntake({ [q.key]: e.target.value } as Partial<ProductionIntake>)} />
                  )}
                  <span className="block text-xs text-muted/80">{q.why}</span>
                </label>
              ))}
            </div>
            {session.intake.making && (() => { const d = detectLanguage(`${session.intake.making} ${session.intake.mustKeep}`); return d.language ? <p className="text-xs text-muted">Detected language: {d.language} ({d.confidence} confidence)</p> : null })()}
            <Button onClick={makeBrief} disabled={!session.intake.making.trim()}>Generate brief</Button>
          </>
        )}

        {view === 'brief' && session.brief && (
          <>
            <div className="grid gap-2 md:grid-cols-2">
              {session.brief.fields.map((f) => (
                <div key={`${f.key}-${f.label}`} className="rounded-lg border border-line bg-panel-alt/40 px-3 py-2">
                  <div className="flex items-center justify-between gap-2 text-xs text-muted">{f.label}<Badge tone={f.source === 'user' ? 'accent' : 'neutral'}>{f.source === 'user' ? 'yours' : 'assumed'}</Badge></div>
                  <div className="text-sm">{f.value}</div>
                  {f.why && <div className="text-xs text-muted/80">{f.why}</div>}
                </div>
              ))}
            </div>
            {session.brief.missing.length > 0 && (
              <div className="rounded-lg border border-danger/30 bg-danger/5 p-3 text-xs"><div className="font-medium text-text">Missing information</div><ul className="mt-1 list-disc pl-4 text-muted">{session.brief.missing.map((m) => <li key={m}>{m}</li>)}</ul></div>
            )}
            <p className="text-xs text-muted">To change anything, edit the Intake answers and regenerate. Your answers always win over assumptions.</p>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={() => setViewStage('intake')}>Edit intake</Button>
              <Button onClick={runResearch} disabled={!catalogue}>Research references</Button>
            </div>
          </>
        )}

        {view === 'research' && session.research && (
          <>
            <div>
              <h3 className="text-sm font-medium">Catalogue cases ({session.research.cases.length})</h3>
              <ul className="mt-2 space-y-1.5">
                {session.research.cases.map((c) => (
                  <li key={c.caseId} className="rounded-lg border border-line px-3 py-2 text-xs">
                    <a href={c.sourceUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-medium text-text hover:text-accent-text">{c.title} <ExternalLink size={11} /></a>
                    <span className="text-muted"> · @{c.author ?? 'unknown'} · case {c.caseId} · score {c.score}</span>
                    <div className="text-muted">Why: {c.why}</div>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <h3 className="text-sm font-medium">Production skills</h3>
              <ul className="mt-2 space-y-1 text-xs">{session.research.skills.map((s) => <li key={s.id}><span className="text-text">{s.name}</span> <span className="text-muted">· {s.why} · {s.evidenceCount} catalogue case(s)</span></li>)}</ul>
            </div>
            {session.research.resources.length > 0 && (
              <div>
                <h3 className="text-sm font-medium">Native resources</h3>
                <ul className="mt-2 space-y-1 text-xs">{session.research.resources.map((r) => <li key={r.id}><span className="text-text">{r.name}</span> <span className="text-muted">· {r.pack} · {r.why}</span></li>)}</ul>
              </div>
            )}
            <ul className="list-disc pl-4 text-xs text-muted">{session.research.notes.map((n) => <li key={n}>{n}</li>)}</ul>
            <Button onClick={makePlan}>Generate plan</Button>
          </>
        )}

        {view === 'plan' && session.plan && (
          <>
            <div className="space-y-1.5">
              {session.plan.decisions.map((d) => (
                <div key={d.area} className="rounded-lg border border-line px-3 py-2 text-xs">
                  <div className="flex items-center justify-between gap-2"><span className="font-medium text-text">{d.area}: {d.decision}</span><Badge tone={CONF_TONE[d.confidence]}>{d.confidence}</Badge></div>
                  <div className="text-muted">{d.why}{d.cites.length ? ` Cites case ${d.cites.join(', ')}.` : ''}</div>
                </div>
              ))}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="text-muted"><tr><th className="py-1 pr-2">Shot</th><th className="pr-2">Beat</th><th className="pr-2">Time</th><th className="pr-2">Text</th><th className="pr-2">Visual</th><th className="pr-2">In</th><th>Conf.</th></tr></thead>
                <tbody>{session.plan.shots.map((s) => (
                  <tr key={s.id} className="border-t border-line align-top">
                    <td className="py-1 pr-2 font-mono">{s.id}</td><td className="pr-2">{s.beat}</td><td className="pr-2 font-mono tabular-nums">{s.startSec.toFixed(1)}–{(s.startSec + s.durationSec).toFixed(1)}s</td>
                    <td className={`pr-2 ${s.onScreenText.startsWith('[') ? 'text-danger' : ''}`}>{s.onScreenText}</td><td className={`pr-2 ${s.mediaName ? '' : 'text-danger'}`}>{s.visual}</td><td className="pr-2">{s.transitionIn}</td><td><Badge tone={CONF_TONE[s.confidence]}>{s.confidence}</Badge></td>
                  </tr>))}</tbody>
              </table>
            </div>
            <p className="text-xs text-muted">Audio: {session.plan.audio.music} · Voice: {session.plan.audio.voice} · Export: {session.plan.export.aspect} {session.plan.export.resolution}p {session.plan.export.fps} fps {session.plan.export.format.toUpperCase()}, no watermark.</p>
            <Button onClick={() => save({ ...session, stage: 'preview' }, 'Open production preview')}>Preview storyboard</Button>
          </>
        )}

        {view === 'preview' && session.plan && (
          <>
            <div className="flex h-16 w-full overflow-hidden rounded-lg border border-line" role="img" aria-label="Storyboard timeline">
              {session.plan.shots.map((s) => (
                <div key={s.id} title={`${s.id} · ${s.beat} · ${s.onScreenText}`} style={{ width: `${(s.durationSec / session.plan!.shots.reduce((a, b) => a + b.durationSec, 0)) * 100}%` }}
                  className={`flex flex-col justify-between border-r border-line p-1 text-xs ${s.mediaName ? 'bg-info/10' : 'bg-danger/10'}`}>
                  <span className="truncate font-mono">{s.id}</span><span className="truncate text-muted">{s.mediaName ? s.beat : 'placeholder'}</span>
                </div>
              ))}
            </div>
            {session.plan.unresolved.length > 0 && <div className="rounded-lg border border-danger/30 bg-danger/5 p-3 text-xs"><div className="font-medium">Unresolved ({session.plan.unresolved.length})</div><ul className="mt-1 list-disc pl-4 text-muted">{session.plan.unresolved.slice(0, 12).map((u) => <li key={u}>{u}</li>)}</ul></div>}
            {session.plan.needsApproval.length > 0 && <ul className="list-disc pl-4 text-xs text-danger">{session.plan.needsApproval.map((n) => <li key={n}>{n}</li>)}</ul>}
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={session.approved} onChange={(e) => save({ ...session, approved: e.target.checked, replaceApproved: e.target.checked ? session.replaceApproved : false }, e.target.checked ? 'Approve production plan' : 'Withdraw plan approval')} />
              I reviewed this plan and approve building it. Placeholders will be clearly labelled.
            </label>
            <Button onClick={() => save({ ...session, stage: 'build' }, 'Ready to build')} disabled={!session.approved}>Continue to build</Button>
          </>
        )}

        {view === 'build' && session.plan && (
          <>
            <p className="text-xs text-muted">Build adds {session.plan.shots.length} media slots plus text as real, editable Studio clips <strong>after</strong> your current timeline. Cupric AI keyframes their motion (enter → hold → exit, eased for the tone), and every keyframe stays editable in the inspector. It's one undo step. Replacing the timeline is destructive and needs a second approval.</p>
            <div className="flex flex-wrap items-center gap-2">
              <Button onClick={() => build(false)} disabled={!session.approved}>Build (append)</Button>
              <label className="flex items-center gap-2 text-xs text-muted">
                <input type="checkbox" checked={session.replaceApproved} disabled={!session.approved} onChange={(e) => save({ ...session, replaceApproved: e.target.checked }, 'Approve timeline replacement')} />
                Allow replacing my current timeline
              </label>
              <Button variant="danger" onClick={() => build(true)} disabled={!session.approved || !session.replaceApproved}>Build (replace)</Button>
            </div>
          </>
        )}

        {view === 'review' && session.review && (
          <>
            <div className="flex items-center gap-3"><Badge tone={reviewScore(session.review) >= 80 ? 'accent' : reviewScore(session.review) >= 50 ? 'info' : 'danger'}>Review {reviewScore(session.review)}/100</Badge><Button size="sm" onClick={polish} disabled={!session.builtClipIds.length} title="Fixes safe-area, volume, transition density, ducking and keyframe motion. It never writes copy or fakes footage.">Cupric AI polish</Button><Button size="sm" variant="outline" onClick={rerunReview}>Re-run review</Button><Button size="sm" variant="outline" onClick={() => setAskOpen(true)} title="Ask Cupric AI for specific edits: trims, captions, keyframes, transitions">Ask Cupric AI</Button><Button size="sm" variant="outline" onClick={() => setView('studio')}>Open Studio</Button></div>
            {polishNotes && (
              <div className="rounded-lg border border-accent/30 bg-accent/5 p-3 text-xs">
                <div className="font-medium text-text">Cupric AI polish</div>
                <ul className="mt-1 list-disc pl-4 text-muted">{polishNotes.fixes.map((f) => <li key={f}>{f}</li>)}</ul>
                {polishNotes.leftForYou.length > 0 && <><div className="mt-2 font-medium text-text">Needs you</div><ul className="mt-1 list-disc pl-4 text-muted">{polishNotes.leftForYou.map((f) => <li key={f}>{f}</li>)}</ul></>}
              </div>
            )}
            <ul className="space-y-1.5">
              {session.review.map((c) => (
                <li key={c.id} className="flex items-start gap-2 rounded-lg border border-line px-3 py-2 text-xs">
                  {c.status === 'pass' ? <CheckCircle2 size={14} className="mt-0.5 text-accent-text" aria-label="pass" /> : c.status === 'warn' ? <AlertTriangle size={14} className="mt-0.5 text-info" aria-label="warning" /> : <XCircle size={14} className="mt-0.5 text-danger" aria-label="fail" />}
                  <div><div className="text-text">{c.label}: <span className="text-muted">{c.detail}</span></div>{c.fix && <div className="text-muted">Fix: {c.fix}</div>}</div>
                </li>
              ))}
            </ul>
            <Button onClick={() => save({ ...session, stage: 'export' }, 'Ready to export')}>Continue to export</Button>
          </>
        )}

        {view === 'export' && (
          <div className="space-y-2 text-xs text-muted">
            <p>Export uses the Studio renderer, the same one as the preview. No watermark by default. Add an end card only if you want one (it's a normal, editable clip). Progress is shown in the Studio and the Render queue, and both can be cancelled.</p>
            {session.review && session.review.some((c) => c.status === 'fail') && <p className="text-danger">{session.review.filter((c) => c.status === 'fail').length} review check(s) still failing. You can export anyway, but placeholders will appear in the video.</p>}
            <Button onClick={() => setView('studio')}>Open Studio to export</Button>
          </div>
        )}
      </div>
    </Card>
  )
}
