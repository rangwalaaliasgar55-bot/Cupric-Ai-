/**
 * Pro tools panel — document-level features:
 *   2.9 auto-edit suggestions (preview → accept) · 2.23 build from my assets ·
 *   2.19 collage · 2.20 testimonial grid · 2.21 before/after · 2.5 captions
 *   from a transcript · 2.7 markers · 2.3 scopes · Part 4 import from link.
 *
 * Nothing here edits the project directly: builders produce a proposed doc
 * that is PREVIEWED on the stage, then committed as ONE undo step on Accept.
 */
import { useMemo, useState } from 'react'
import type { StudioAudioClip, StudioDoc, StudioMediaClip } from '../../types/project'
import { Button } from '../../components/Button'
import { suggestEdits } from '../../lib/studio/suggestions'
import { buildBeforeAfter, buildCollage, buildFromAssets, buildTestimonialGrid, type IntakeKind, type MediaRef } from '../../lib/studio/layouts'
import { captionsFromTranscript } from '../../lib/studio/textTools'
import { captionsForClip, transcribeClip } from '../../lib/studio/autoCaptions'
import { componentOps, directComponents } from '../../lib/studio/componentDirector'
import { deleteScene, duplicateScene, loadScene, removeVariable, renameScene, saveScene, setVariable, updateScene, nestScene } from '../../lib/studio/scenes'
import { variablesUsed } from '../../lib/studio/resolve'
import { reframePatch, snapCutsToBeats, tightenClip, timelineBeats } from '../../lib/studio/autoEdit'
import { analyseBeats, analyseSubject } from '../../lib/studio/autoEditAnalysis'
import { aspectRatio } from '../../lib/studio/doc'
import { DEFAULT_PHONE, PHONE_DESIGNS, PHONE_FRAME_COLORS, PHONE_MOTIONS, defaultApp } from '../../lib/studio/phone'
import type { StudioPhoneApp, StudioPhoneStyle } from '../../types/project'
import { emitStudio } from '../../lib/studio/studioEvents'
import { applyStudioEditPlan, describeStudioEditOp } from '../../lib/studio/editOps'
import { computeScopes, type Scopes } from '../../lib/studio/color'
import { removeMarker } from '../../lib/studio/timelineOps'
import { placeClip } from '../../lib/studio/doc'
import { registerFile } from '../../lib/studio/media'
import { StudioCreativePanel } from './StudioCreativePanel'
import { checkResourceLink, githubRepoOf, withRepoLicense, type LinkVerdict } from '../../lib/resourceLinks'

type Props = {
  doc: StudioDoc
  time: number
  /** Show a proposed doc on the stage without committing it (null = stop). */
  onPreview: (doc: StudioDoc | null, label: string) => void
  onCommit: (doc: StudioDoc, label: string) => void
  onSeek: (t: number) => void
  selectedId?: string | null
  onImportFiles?: (files: FileList) => void
}

const inputCx = 'w-full cu-input px-2.5 py-1.5 text-sm text-text'

function Section({ title, children, open }: { title: string; children: React.ReactNode; open?: boolean }) {
  return (
    <details open={open} className="group cu-section">
      <summary className="cursor-pointer list-none px-3 py-2 text-xs font-semibold text-text">{title}</summary>
      <div className="space-y-2.5 border-t border-line px-3 py-3">{children}</div>
    </details>
  )
}

async function refsFrom(files: FileList | null): Promise<{ refs: MediaRef[]; errors: string[] }> {
  const refs: MediaRef[] = []
  const errors: string[] = []
  for (const file of Array.from(files ?? [])) {
    try {
      const h = await registerFile(file)
      if (h.kind === 'audio') { errors.push(`${file.name}: audio is not a photo or clip`); continue }
      refs.push({ mediaId: h.id, fileName: h.fileName, localPath: h.localPath, kind: h.kind, durationSec: h.durationSec, posterDataUrl: h.posterDataUrl })
    } catch (err) {
      errors.push(err instanceof Error ? err.message : `${file.name} could not be opened`)
    }
  }
  return { refs, errors }
}

export function StudioProPanel({ doc, time, onPreview, onCommit, onSeek, selectedId, onImportFiles }: Props) {
  const [transcribing, setTranscribing] = useState(false)
  const [sceneName, setSceneName] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [varName, setVarName] = useState('')
  const [varValue, setVarValue] = useState('')
  const [pending, setPending] = useState<{ doc: StudioDoc; label: string; notes?: string[] } | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const suggestions = useMemo(() => suggestEdits(doc), [doc])
  const smartMoments = useMemo(() => directComponents(doc), [doc])
  const [intake, setIntake] = useState<{ kind: IntakeKind; name: string; tagline: string; cta: string; logo: MediaRef | null; photos: MediaRef[]; clips: MediaRef[] }>({ kind: 'product', name: '', tagline: '', cta: '', logo: null, photos: [], clips: [] })
  const [transcript, setTranscript] = useState('')
  const [scopes, setScopes] = useState<Scopes | null>(null)
  const [link, setLink] = useState('')
  const [verdict, setVerdict] = useState<LinkVerdict | null>(null)
  const [rights, setRights] = useState(false)
  const [compare, setCompare] = useState<MediaRef[]>([])

  const propose = (next: StudioDoc, label: string, notes?: string[]) => {
    setPending({ doc: next, label, notes })
    onPreview(next, label)
  }
  const accept = () => {
    if (!pending) return
    onCommit(pending.doc, pending.label)
    onPreview(null, '')
    setMsg(`${pending.label} applied — one Undo reverts it.`)
    setPending(null)
  }
  const cancel = () => {
    onPreview(null, '')
    setPending(null)
  }

  const readScopes = () => {
    const canvas = document.querySelector<HTMLCanvasElement>('canvas[aria-label="Studio preview"]')
    const ctx = canvas?.getContext('2d', { willReadFrequently: true })
    if (!canvas || !ctx) return setMsg('Open a clip on the stage first — scopes read the preview frame.')
    try {
      setScopes(computeScopes(ctx.getImageData(0, 0, canvas.width, canvas.height).data, canvas.width, canvas.height))
    } catch {
      setMsg('The preview has cross-origin media, so its pixels cannot be read.')
    }
  }

  const checkLink = async () => {
    setRights(false)
    let v = checkResourceLink(link)
    const repo = githubRepoOf(v.url)
    if (repo) {
      try {
        const res = await fetch(`https://api.github.com/repos/${repo}/license`)
        const spdx = res.ok ? ((await res.json()) as { license?: { spdx_id?: string } }).license?.spdx_id ?? null : null
        v = withRepoLicense(v, spdx)
      } catch {
        v = { ...v, reason: `${v.reason} (Licence lookup failed — offline?)` }
      }
    }
    setVerdict(v)
  }

  const importLink = async () => {
    if (!verdict || verdict.status === 'blocked') return
    if (verdict.requiresConfirmation && !rights) return setMsg('Tick “I have the rights” first.')
    const credit = { url: verdict.url, source: verdict.source, sourceLicense: verdict.sourceLicense, attribution: verdict.attribution }
    const credits = [...(doc.credits ?? []).filter((c) => c.url !== credit.url), credit]
    if (verdict.kind === 'image' || verdict.kind === 'video' || verdict.kind === 'audio') {
      try {
        const res = await fetch(verdict.url)
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const blob = await res.blob()
        const file = new File([blob], decodeURIComponent(new URL(verdict.url).pathname.split('/').pop() || 'download'), { type: blob.type })
        const { refs, errors } = await refsFrom(Object.assign([file], { item: (i: number) => [file][i] }) as unknown as FileList)
        if (!refs.length) throw new Error(errors[0] ?? 'not a usable media file')
        const { mediaClip } = await import('../../lib/studio/layouts')
        const placed = placeClip(doc, mediaClip(refs[0], time, refs[0].kind === 'video' ? Math.min(8, refs[0].durationSec || 5) : 3, 0))
        onCommit({ ...doc, credits, trackCount: placed.trackCount, clips: [...doc.clips, placed.clip] }, 'Import from link')
        setMsg(`Imported with credit: ${verdict.attribution ?? verdict.source}.`)
      } catch (err) {
        onCommit({ ...doc, credits }, 'Save link credit')
        setMsg(`Could not download the file directly (${err instanceof Error ? err.message : 'blocked'}). The link and its licence were saved to Credits — download it yourself and drop it in.`)
      }
    } else {
      onCommit({ ...doc, credits }, 'Save link credit')
      setMsg('Saved to Credits with its licence. Pages and fonts are not downloaded automatically.')
    }
    setVerdict(null)
    setLink('')
  }

  return (
    <div className="space-y-3">
      <StudioCreativePanel doc={doc} time={time} selectedId={selectedId} onPreview={onPreview} onCommit={onCommit} onImportFiles={onImportFiles} />
      <div>
        <h2 className="text-sm font-semibold">Pro tools</h2>
        <p className="mt-1 text-xs text-muted">Everything previews on the stage first. Accept = one undo step.</p>
      </div>

      {pending && (
        <div className="sticky top-0 z-10 space-y-2 rounded-lg border border-accent/50 bg-panel p-3 shadow-lg" role="status">
          <p className="text-xs font-semibold text-text">Previewing: {pending.label}</p>
          {pending.notes?.map((n) => <p key={n} className="text-xs text-muted">• {n}</p>)}
          <div className="flex gap-2">
            <Button size="sm" variant="primary" onClick={accept}>Accept</Button>
            <Button size="sm" variant="outline" onClick={cancel}>Cancel</Button>
          </div>
        </div>
      )}
      {msg && <p className="rounded-md border border-line bg-panel-alt/60 px-2 py-1.5 text-xs text-muted" role="status">{msg}</p>}

      <Section title={`Suggestions (${suggestions.length})`} open>
        {!suggestions.length && <p className="text-xs text-muted">Nothing to suggest — the edit looks clean.</p>}
        {suggestions.map((s) => (
          <div key={s.id} className="cu-section p-2.5">
            <p className={s.severity === 'warn' ? 'text-xs font-medium text-danger' : 'text-xs font-medium text-text'}>{s.title}</p>
            <p className="mt-0.5 text-xs text-muted">{s.detail}</p>
            <Button size="sm" variant="outline" className="mt-1.5" onClick={() => propose(s.apply(doc), s.title)}>Preview</Button>
          </div>
        ))}
      </Section>

      <Section title="Build from my assets">
        <select className={inputCx} value={intake.kind} onChange={(e) => setIntake({ ...intake, kind: e.target.value as IntakeKind })} aria-label="What is this video for">
          <option value="product">Product</option>
          <option value="startup">Startup</option>
          <option value="business">Local business</option>
        </select>
        <input className={inputCx} placeholder="Brand / product name" value={intake.name} onChange={(e) => setIntake({ ...intake, name: e.target.value })} />
        <input className={inputCx} placeholder="Tagline (optional)" value={intake.tagline} onChange={(e) => setIntake({ ...intake, tagline: e.target.value })} />
        <input className={inputCx} placeholder="Call to action, e.g. Order today" value={intake.cta} onChange={(e) => setIntake({ ...intake, cta: e.target.value })} />
        <label className="block text-xs text-muted">Logo<input type="file" accept="image/*,.heic,.heif" className="mt-1 block text-xs" onChange={async (e) => setIntake({ ...intake, logo: (await refsFrom(e.target.files)).refs[0] ?? null })} /></label>
        <label className="block text-xs text-muted">Photos<input type="file" multiple accept="image/*,.heic,.heif" className="mt-1 block text-xs" onChange={async (e) => setIntake({ ...intake, photos: (await refsFrom(e.target.files)).refs })} /></label>
        <label className="block text-xs text-muted">Clips<input type="file" multiple accept="video/*" className="mt-1 block text-xs" onChange={async (e) => setIntake({ ...intake, clips: (await refsFrom(e.target.files)).refs })} /></label>
        <Button
          size="sm"
          variant="primary"
          onClick={() => {
            const r = buildFromAssets(doc, intake.kind, intake)
            propose(r.doc, `Build ${intake.kind} video from assets`, [
              ...(doc.clips.length ? ['This replaces the current timeline — Cancel keeps it, and Undo restores it after Accept.'] : []),
              ...r.notes,
            ])
          }}
        >
          Build first cut
        </Button>
      </Section>

      <Section title="Layouts">
        <label className="block text-xs text-muted">Collage — pick 2–9 photos
          <input type="file" multiple accept="image/*,.heic,.heif" className="mt-1 block text-xs" onChange={async (e) => {
            const { refs, errors } = await refsFrom(e.target.files)
            if (errors.length) setMsg(errors.join(' · '))
            if (refs.length < 2) return setMsg('A collage needs at least two photos.')
            propose(buildCollage(doc, refs, time).doc, `Collage of ${refs.length}`)
          }} />
        </label>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted">Testimonial grid</span>
          {[1, 2, 3, 4].map((n) => (
            <button key={n} type="button" className="cu-chip px-2 py-0.5 text-xs" onClick={() => propose(buildTestimonialGrid(doc, n, time).doc, `Testimonial grid (${n})`, ['Cards are empty placeholders. Paste real quotes you have permission to use — the app never writes them.'])}>
              {n}
            </button>
          ))}
        </div>
        <label className="block text-xs text-muted">Before / after — pick the BEFORE then the AFTER
          <input type="file" multiple accept="image/*,.heic,.heif" className="mt-1 block text-xs" onChange={async (e) => {
            const { refs } = await refsFrom(e.target.files)
            const pair = [...compare, ...refs].slice(-2)
            setCompare(pair)
            if (pair.length < 2) return setMsg('Now pick the AFTER photo.')
            const placed = placeClip(doc, buildBeforeAfter(pair[0], pair[1], time, 0))
            propose({ ...doc, trackCount: placed.trackCount, clips: [...doc.clips, placed.clip] }, 'Before / after')
            setCompare([])
          }} />
        </label>
      </Section>

      <Section title="Phone Studio">
        {(() => {
          const sel = doc.clips.find((c) => c.id === selectedId && (c.kind === 'image' || c.kind === 'video' || c.kind === 'overlay'))
          if (!sel) return <p className="text-xs text-muted">Select a product photo, screenshot, video or recorded component. Phone Studio puts it on an animated phone screen you can fully edit.</p>
          const phone = (sel as { phone?: StudioPhoneStyle | null }).phone
          const on = (sel as { device?: string }).device === 'phone' && !!phone
          const put = (next: StudioPhoneStyle | null, label: string) =>
            onCommit({ ...doc, clips: doc.clips.map((c) => (c.id === sel.id ? ({ ...c, device: next ? 'phone' : 'none', phone: next, ...(next && c.kind !== 'overlay' ? { fit: 'contain' } : {}) } as typeof c) : c)) }, label)
          const setApp = (patch: Partial<StudioPhoneApp>) => phone?.app && put({ ...phone, app: { ...phone.app, ...patch } as StudioPhoneApp }, 'Edit phone screen')
          return (
            <div className="space-y-2.5">
              <div className="grid grid-cols-2 gap-1.5">
                {PHONE_DESIGNS.map((d) => (
                  <button key={d.id} type="button" title={d.detail} onClick={() => put(structuredClone(d.style), `Phone design: ${d.label}`)} className="cu-chip px-2 py-1.5 text-left text-xs text-text">
                    <span className="font-medium">{d.label}</span>
                    <span className="mt-0.5 block text-[11px] leading-snug text-muted">{d.detail}</span>
                  </button>
                ))}
              </div>
              {on && phone && (
                <>
                  <div>
                    <p className="mb-1 text-[11px] font-medium text-muted">Frame colour</p>
                    <div className="flex flex-wrap gap-1.5">
                      {PHONE_FRAME_COLORS.map((c) => (
                        <button key={c.id} type="button" aria-label={c.label} title={c.label} onClick={() => put({ ...phone, frameColor: c.color }, 'Phone frame colour')} className={`h-6 w-6 rounded-full border-2 ${phone.frameColor === c.color ? 'border-accent' : 'border-line'}`} style={{ background: c.color }} />
                      ))}
                      <input type="color" aria-label="Custom frame colour" value={phone.frameColor} onChange={(e) => put({ ...phone, frameColor: e.target.value }, 'Phone frame colour')} className="h-6 w-8 cursor-pointer rounded border border-line bg-transparent" />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-1.5">
                    <label className="text-[11px] text-muted">Motion
                      <select className={inputCx} value={phone.motion} onChange={(e) => put({ ...phone, motion: e.target.value as StudioPhoneStyle['motion'] }, 'Phone motion')}>
                        {PHONE_MOTIONS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
                      </select>
                    </label>
                    <label className="text-[11px] text-muted">Camera
                      <select className={inputCx} value={phone.island} onChange={(e) => put({ ...phone, island: e.target.value as StudioPhoneStyle['island'] }, 'Phone camera')}>
                        <option value="island">Dynamic island</option><option value="notch">Notch</option><option value="none">None</option>
                      </select>
                    </label>
                  </div>
                  <div className="flex flex-wrap gap-3 text-xs text-text">
                    {(['buttons', 'glare', 'scroll'] as const).map((k) => (
                      <label key={k} className="flex items-center gap-1.5"><input type="checkbox" checked={phone[k]} onChange={(e) => put({ ...phone, [k]: e.target.checked }, `Phone ${k}`)} />{k === 'scroll' ? 'Scroll tall screenshot' : k === 'glare' ? 'Glass glare' : 'Side buttons'}</label>
                    ))}
                  </div>
                  <label className="block text-[11px] text-muted">Screen
                    <select className={inputCx} value={phone.app?.kind ?? 'none'} onChange={(e) => put({ ...phone, app: e.target.value === 'none' ? null : defaultApp(e.target.value as StudioPhoneApp['kind']) }, 'Phone screen')}>
                      <option value="none">Just the media</option><option value="product">Product page (animated)</option><option value="lockscreen">Lock screen + notifications</option><option value="social">Social post (like animation)</option>
                    </select>
                  </label>
                  {phone.app?.kind === 'product' && (
                    <div className="space-y-1.5">
                      <input className={inputCx} aria-label="Product name" value={phone.app.title} onChange={(e) => setApp({ title: e.target.value })} />
                      <input className={inputCx} aria-label="Subtitle" value={phone.app.subtitle} onChange={(e) => setApp({ subtitle: e.target.value })} />
                      <div className="grid grid-cols-3 gap-1.5">
                        <input className={inputCx} aria-label="Price" placeholder="Price" value={phone.app.price} onChange={(e) => setApp({ price: e.target.value })} />
                        <input className={inputCx} aria-label="Button" placeholder="Button" value={phone.app.cta} onChange={(e) => setApp({ cta: e.target.value })} />
                        <input className={inputCx} aria-label="Badge" placeholder="Badge" value={phone.app.badge} onChange={(e) => setApp({ badge: e.target.value })} />
                      </div>
                      <div className="flex items-center gap-2 text-xs text-muted">
                        <label className="flex items-center gap-1">Rating <input className={`${inputCx} w-16`} type="number" min={0} max={5} step={0.1} placeholder="—" value={phone.app.rating ?? ''} onChange={(e) => setApp({ rating: e.target.value === '' ? null : Math.max(0, Math.min(5, Number(e.target.value))) })} /></label>
                        <span>only shown if you enter your real rating</span>
                      </div>
                      <label className="flex items-center gap-2 text-xs text-muted">Accent <input type="color" value={phone.app.accent} onChange={(e) => setApp({ accent: e.target.value })} /></label>
                    </div>
                  )}
                  {phone.app?.kind === 'lockscreen' && (
                    <div className="space-y-1.5">
                      <div className="grid grid-cols-2 gap-1.5">
                        <input className={inputCx} aria-label="Time" value={phone.app.time} onChange={(e) => setApp({ time: e.target.value })} />
                        <input className={inputCx} aria-label="Date" value={phone.app.date} onChange={(e) => setApp({ date: e.target.value })} />
                      </div>
                      {phone.app.notifications.map((n, i) => (
                        <div key={i} className="space-y-1 rounded-md border border-line p-1.5">
                          {(['app', 'title', 'body'] as const).map((k) => (
                            <input key={k} className={inputCx} aria-label={`Notification ${i + 1} ${k}`} placeholder={k} value={n[k]} onChange={(e) => phone.app?.kind === 'lockscreen' && setApp({ notifications: phone.app.notifications.map((x, j) => (j === i ? { ...x, [k]: e.target.value } : x)) })} />
                          ))}
                          <button type="button" className="text-[11px] text-muted hover:text-danger" onClick={() => phone.app?.kind === 'lockscreen' && setApp({ notifications: phone.app.notifications.filter((_, j) => j !== i) })}>Remove</button>
                        </div>
                      ))}
                      {phone.app.notifications.length < 4 && <Button size="sm" variant="outline" onClick={() => phone.app?.kind === 'lockscreen' && setApp({ notifications: [...phone.app.notifications, { app: 'Your app', title: 'Notification title', body: 'Message' }] })}>Add notification</Button>}
                    </div>
                  )}
                  {phone.app?.kind === 'social' && (
                    <div className="space-y-1.5">
                      <input className={inputCx} aria-label="Handle" value={phone.app.handle} onChange={(e) => setApp({ handle: e.target.value })} />
                      <textarea className={`${inputCx} h-16`} aria-label="Caption" value={phone.app.caption} onChange={(e) => setApp({ caption: e.target.value })} />
                      <input className={inputCx} aria-label="Likes line" placeholder="Likes line (optional — only real numbers)" value={phone.app.likes} onChange={(e) => setApp({ likes: e.target.value })} />
                    </div>
                  )}
                  <Button size="sm" variant="outline" onClick={() => put(null, 'Remove phone')}>Remove phone</Button>
                </>
              )}
              {!on && <Button size="sm" variant="outline" onClick={() => put({ ...DEFAULT_PHONE }, 'Put on phone')}>Put on a phone</Button>}
            </div>
          )
        })()}
      </Section>

      <Section title="Auto-edit" open>
        {(() => {
          const sel = doc.clips.find((c) => c.id === selectedId)
          const music = (sel?.kind === 'audio' ? sel : doc.clips.find((c) => c.kind === 'audio' && (c.role ?? 'music') === 'music')) as StudioAudioClip | undefined
          const beats = timelineBeats(doc)
          const run = async (label: string, fn: () => Promise<void>) => {
            setBusy(label)
            setMsg(null)
            try { await fn() } catch (err) { setMsg(err instanceof Error ? err.message : String(err)) } finally { setBusy(null) }
          }
          return (
            <div className="space-y-2">
              <div className="cu-section p-2.5">
                <p className="text-xs font-medium text-text">Beat sync</p>
                <p className="text-xs text-muted">{music?.beats ? `${music.name}: ${music.beats.bpm} BPM, ${music.beats.times.length} beats (${beats.length} on the timeline).` : music ? `Analyse “${music.name}” to find its beats.` : 'Add a music clip first.'}</p>
                <div className="mt-1.5 flex gap-1.5">
                  <Button size="sm" variant="outline" disabled={!music || !!busy} onClick={() => music && run('beats', async () => {
                    const r = await analyseBeats(music)
                    onCommit({ ...doc, clips: doc.clips.map((c) => (c.id === music.id ? { ...c, beats: r } as StudioAudioClip : c)) }, 'Analyse beats')
                    setMsg(`Found ${r.times.length} beats at ${r.bpm} BPM.`)
                  })}>{busy === 'beats' ? 'Analysing…' : 'Analyse beats'}</Button>
                  <Button size="sm" variant="outline" disabled={!beats.length} onClick={() => {
                    const r = snapCutsToBeats(doc)
                    if (!r.moved) return setMsg(r.skipped[0] ?? 'Every main-track cut is already on a beat (or more than 0.3 s from one).')
                    propose(r.doc, `Snap ${r.moved} cuts to the beat`, r.skipped)
                  }}>Snap cuts to beats</Button>
                  <Button size="sm" variant="outline" disabled={!beats.length} onClick={() => {
                    const markers = beats.map((at, i) => ({ id: `beat-${i}`, at: Math.round(at * 1000) / 1000, label: `Beat ${i + 1}`, color: 'info' as const }))
                    propose({ ...doc, markers: [...(doc.markers ?? []).filter((m) => !m.id.startsWith('beat-')), ...markers] }, 'Beat markers')
                  }}>Beats → markers</Button>
                </div>
              </div>
              <div className="cu-section p-2.5">
                <p className="text-xs font-medium text-text">Tighten speech</p>
                <p className="text-xs text-muted">{sel && (sel.kind === 'video' || sel.kind === 'audio') ? (sel.words?.length ? `Removes “um/uh” and pauses over 0.6 s from “${sel.name}”, using its ${sel.words.length} word timings.` : 'Run Auto-captions on this clip first — tightening needs its word timings.') : 'Select a transcribed video or audio clip.'}</p>
                <Button size="sm" variant="outline" className="mt-1.5" disabled={!sel || !(sel.kind === 'video' || sel.kind === 'audio') || !sel.words?.length} onClick={() => {
                  if (!sel) return
                  const r = tightenClip(doc, sel.id)
                  if (!r.cuts) return setMsg(r.reason ?? 'Nothing to tighten.')
                  propose(r.doc, `Tighten speech (−${r.removedSec.toFixed(1)} s)`, [`${r.cuts} cuts; captions and overlays after the clip move with the words.`])
                }}>Tighten</Button>
              </div>
              <div className="cu-section p-2.5">
                <p className="text-xs font-medium text-text">Smart reframe</p>
                <p className="text-xs text-muted">{sel?.kind === 'video' ? `Follows the subject (faces, then motion) so landscape footage works in ${doc.aspect}. A heuristic tracker — check the preview.` : 'Select a landscape video clip in a portrait or square edit.'}</p>
                <Button size="sm" variant="outline" className="mt-1.5" disabled={sel?.kind !== 'video' || !!busy} onClick={() => sel?.kind === 'video' && run('reframe', async () => {
                  const clip = sel as StudioMediaClip
                  const a = await analyseSubject(clip, (p) => setMsg(`Analysing frames… ${p}%`))
                  const r = reframePatch(clip, a.samples, aspectRatio(doc.aspect), a.srcW / Math.max(1, a.srcH))
                  if (r.reason) return setMsg(r.reason)
                  setMsg(null)
                  propose({ ...doc, clips: doc.clips.map((c) => (c.id === clip.id ? ({ ...c, ...r.patch } as StudioMediaClip) : c)) }, 'Smart reframe', [`${r.patch.keyframes?.length ?? 0} pan keyframes`])
                })}>{busy === 'reframe' ? 'Tracking…' : 'Reframe'}</Button>
              </div>
            </div>
          )
        })()}
      </Section>

      <Section title={`Scenes (${(doc.scenes ?? []).length})`}>
        <p className="text-xs text-muted">Save the whole edit as a named scene, try something else, and load any scene back. Loading is one undo step.</p>
        <div className="flex gap-1.5">
          <input className={inputCx} placeholder="Scene name" value={sceneName} onChange={(e) => setSceneName(e.target.value)} />
          <Button size="sm" variant="outline" onClick={() => {
            try {
              const r = saveScene(doc, sceneName)
              onCommit(r.doc, `Save scene “${r.scene.name}”`)
              emitStudio('scene:save', { id: r.scene.id, name: r.scene.name })
              setSceneName('')
            } catch (err) { setMsg(err instanceof Error ? err.message : String(err)) }
          }}>Save</Button>
        </div>
        {(doc.scenes ?? []).map((sc) => (
          <div key={sc.id} className="cu-section p-2.5">
            <input aria-label="Scene name" className="w-full bg-transparent text-xs font-medium text-text outline-none" defaultValue={sc.name} onBlur={(e) => e.target.value !== sc.name && onCommit(renameScene(doc, sc.id, e.target.value), 'Rename scene')} />
            <p className="text-[11px] text-muted">{sc.doc.clips.length} clips · {sc.doc.aspect} · saved {new Date(sc.savedAt).toLocaleString()}</p>
            <div className="mt-1.5 flex flex-wrap gap-1">
              <Button size="sm" variant="outline" onClick={() => { onCommit(loadScene(doc, sc.id), `Load scene “${sc.name}”`); emitStudio('scene:load', { id: sc.id, name: sc.name }) }}>Load</Button>
              <Button size="sm" variant="outline" onClick={() => onCommit(updateScene(doc, sc.id), `Update scene “${sc.name}”`)}>Overwrite</Button>
              <Button size="sm" variant="outline" title="Place this scene inside the current edit as one nested sequence clip at the playhead" onClick={() => { try { onCommit(nestScene(doc, sc.id, time).doc, `Nest “${sc.name}”`) } catch (err) { setMsg(err instanceof Error ? err.message : String(err)) } }}>Nest at playhead</Button>
              <Button size="sm" variant="outline" onClick={() => { try { onCommit(duplicateScene(doc, sc.id), 'Duplicate scene') } catch (err) { setMsg(err instanceof Error ? err.message : String(err)) } }}>Duplicate</Button>
              <Button size="sm" variant="outline" onClick={() => onCommit(deleteScene(doc, sc.id), `Delete scene “${sc.name}”`)}>Delete</Button>
            </div>
          </div>
        ))}
      </Section>

      <Section title={`Variables (${(doc.variables ?? []).length})`}>
        <p className="text-xs text-muted">Type <code className="font-mono text-text">{'{{name}}'}</code> in any text; it shows the value here in preview and export. Change a value once to update every title — handy for prices, names and dates.</p>
        {(() => {
          const used = variablesUsed(doc)
          const defined = new Set((doc.variables ?? []).map((v) => v.name.toLowerCase()))
          const missing = used.filter((u) => !defined.has(u))
          return missing.length ? <p className="text-xs text-danger">Used but not defined: {missing.map((m) => `{{${m}}}`).join(', ')} — shown as typed until you add them.</p> : null
        })()}
        {(doc.variables ?? []).map((v) => (
          <div key={v.name} className="flex items-center gap-1.5">
            <code className="w-28 shrink-0 truncate font-mono text-xs text-text">{`{{${v.name}}}`}</code>
            <input aria-label={`Value of ${v.name}`} className={inputCx} defaultValue={v.value} onBlur={(e) => e.target.value !== v.value && onCommit(setVariable(doc, v.name, e.target.value), `Set {{${v.name}}}`)} />
            <Button size="sm" variant="outline" aria-label={`Remove ${v.name}`} onClick={() => onCommit(removeVariable(doc, v.name), `Remove {{${v.name}}}`)}>×</Button>
          </div>
        ))}
        <div className="flex gap-1.5">
          <input className={inputCx} placeholder="name" value={varName} onChange={(e) => setVarName(e.target.value)} />
          <input className={inputCx} placeholder="value" value={varValue} onChange={(e) => setVarValue(e.target.value)} />
          <Button size="sm" variant="outline" onClick={() => {
            try { onCommit(setVariable(doc, varName, varValue), `Set {{${varName}}}`); setVarName(''); setVarValue('') } catch (err) { setMsg(err instanceof Error ? err.message : String(err)) }
          }}>Add</Button>
        </div>
      </Section>

      <Section title={`Smart components (${smartMoments.length})`}>
        <p className="text-xs text-muted">Reads your text lines and adds a real UI component only where one can prove the claim — a price, a number, a call to action, a notification… Motion follows the edit's style; timing lands just after the words.</p>
        {!smartMoments.length && <p className="text-xs text-muted">No line here makes a claim a component could show. Add copy like “Only ₹499/month”, “10,000 users”, or “Sign up free”.</p>}
        {smartMoments.map((m) => (
          <div key={m.lineId} className="cu-section p-2.5">
            <p className="text-xs font-medium text-text">{m.startSec.toFixed(1)}s · {m.name}</p>
            <p className="mt-0.5 text-xs text-muted">{m.reason}</p>
            <p className="mt-0.5 text-[11px] text-muted">{describeStudioEditOp(componentOps([m])[0], doc)}</p>
          </div>
        ))}
        {smartMoments.length > 0 && (
          <Button size="sm" variant="outline" onClick={() => propose(applyStudioEditPlan(doc, componentOps(smartMoments)), `${smartMoments.length} smart components`, ['Each component records its real animation after you accept.'])}>Preview all</Button>
        )}
      </Section>

      <Section title="Auto-captions from a clip's audio">
        {(() => {
          const src = doc.clips.find((c) => c.id === selectedId && (c.kind === 'video' || c.kind === 'audio')) as StudioMediaClip | StudioAudioClip | undefined
          return (
            <>
              <p className="text-xs text-muted">{src ? `Transcribes the selected ${src.kind} clip offline and times each caption to the words.` : 'Select a video or audio clip on the timeline first.'}</p>
              <Button size="sm" variant="outline" disabled={!src || transcribing} onClick={async () => {
                if (!src) return
                setTranscribing(true)
                setMsg(null)
                try {
                  const r = await transcribeClip(src)
                  const { doc: next, captions } = captionsForClip(doc, src, r.words)
                  if (!captions.length) return setMsg('No speech was recognised in the used part of this clip.')
                  propose(next, `${captions.length} auto-captions`, [r.timing === 'word' ? `Whisper · word-level timing (${r.words.length} words)` : `Windows Speech · phrase-level timing — words are spread across each phrase, so check fast speech`])
                } catch (err) {
                  setMsg(err instanceof Error ? err.message : String(err))
                } finally {
                  setTranscribing(false)
                }
              }}>{transcribing ? 'Transcribing…' : 'Transcribe & caption'}</Button>
            </>
          )
        })()}
      </Section>

      <Section title="Captions from a transcript">
        <textarea className={`${inputCx} h-24`} placeholder="Paste what is said. Captions are timed across the edit (or from the playhead)." value={transcript} onChange={(e) => setTranscript(e.target.value)} />
        <Button size="sm" variant="outline" onClick={() => {
          const total = Math.max(1, doc.clips.reduce((m, c) => Math.max(m, c.startSec + c.durationSec), 0) - time)
          const caps = captionsFromTranscript(transcript, { startSec: time, durationSec: total, track: doc.trackCount })
          if (!caps.length) return setMsg('Paste some transcript text first.')
          propose({ ...doc, trackCount: Math.min(24, doc.trackCount + 1), clips: [...doc.clips, ...caps] }, `${caps.length} captions`)
        }}>Generate captions</Button>
      </Section>

      <Section title={`Markers (${(doc.markers ?? []).length})`}>
        {!(doc.markers ?? []).length && <p className="text-xs text-muted">Press M on the timeline to drop a marker.</p>}
        {(doc.markers ?? []).map((m) => (
          <div key={m.id} className="flex items-center justify-between gap-2 text-xs">
            <button type="button" className="font-mono text-info hover:underline" onClick={() => onSeek(m.at)}>{m.at.toFixed(2)}s</button>
            <input className="min-w-0 flex-1 cu-chip px-1.5 py-0.5" value={m.label} aria-label="Marker label" onChange={(e) => onCommit({ ...doc, markers: (doc.markers ?? []).map((x) => (x.id === m.id ? { ...x, label: e.target.value } : x)) }, 'Rename marker')} />
            <button type="button" className="text-muted hover:text-danger" onClick={() => onCommit(removeMarker(doc, m.id).doc, 'Remove marker')}>Remove</button>
          </div>
        ))}
      </Section>

      <Section title="Scopes">
        <Button size="sm" variant="outline" onClick={readScopes}>Read current frame</Button>
        {scopes && (
          <div className="space-y-2">
            <svg viewBox="0 0 256 60" className="h-16 w-full rounded bg-black" aria-label="RGB histogram">
              {(['r', 'g', 'b'] as const).map((c) => (
                <polyline key={c} fill="none" strokeWidth={1} stroke={c === 'r' ? '#E24B4A' : c === 'g' ? '#C8F542' : '#4FB6E8'} points={scopes.histogram[c].map((v, i) => `${i},${60 - v * 58}`).join(' ')} />
              ))}
            </svg>
            <svg viewBox={`0 0 ${scopes.waveform.columns} ${scopes.waveform.levels}`} preserveAspectRatio="none" className="h-16 w-full rounded bg-black" aria-label="Luma waveform">
              {scopes.waveform.data.map((v, i) => v > 0.02 && <rect key={i} x={Math.floor(i / scopes.waveform.levels)} y={scopes.waveform.levels - 1 - (i % scopes.waveform.levels)} width={1} height={1} fill="#C8F542" opacity={Math.min(1, v * 3)} />)}
            </svg>
            <svg viewBox="0 0 64 64" className="mx-auto h-24 w-24 rounded-full bg-black" aria-label="Vectorscope">
              {scopes.vectorscope.map((v, i) => v > 0.02 && <rect key={i} x={i % 64} y={Math.floor(i / 64)} width={1} height={1} fill="#F4F1EA" opacity={Math.min(1, v * 4)} />)}
            </svg>
            <p className="text-xs text-muted">Mean luma {Math.round(scopes.stats.meanLuma * 100)}% · clipped highs {(scopes.stats.clippedHigh * 100).toFixed(1)}% · lows {(scopes.stats.clippedLow * 100).toFixed(1)}%</p>
          </div>
        )}
      </Section>

      <Section title="Import from link (licence checked)">
        <input className={inputCx} placeholder="https://…" value={link} onChange={(e) => { setLink(e.target.value); setVerdict(null) }} />
        <Button size="sm" variant="outline" onClick={checkLink} disabled={!link.trim()}>Check licence</Button>
        {verdict && (
          <div className="space-y-1.5 rounded-md border border-line p-2 text-xs">
            <p className={verdict.status === 'blocked' ? 'font-semibold text-danger' : verdict.status === 'allowed' ? 'font-semibold text-accent' : 'font-semibold text-text'}>
              {verdict.status === 'blocked' ? 'Refused' : verdict.status === 'allowed' ? 'Allowed' : 'Licence unverified'} · {verdict.source}
            </p>
            <p className="text-muted">{verdict.reason}</p>
            {verdict.sourceLicense && <p className="text-muted">Licence: {verdict.sourceLicense}</p>}
            {verdict.requiresConfirmation && (
              <label className="flex items-center gap-2"><input type="checkbox" checked={rights} onChange={(e) => setRights(e.target.checked)} /> I own this or have permission to use it</label>
            )}
            {verdict.status !== 'blocked' && <Button size="sm" variant="primary" onClick={importLink}>Import</Button>}
          </div>
        )}
        {!!(doc.credits ?? []).length && (
          <div className="text-xs text-muted">
            <p className="font-medium text-text">Credits</p>
            {(doc.credits ?? []).map((c) => <p key={c.url} className="truncate" title={c.url}>{c.attribution ?? c.source}{c.sourceLicense ? ` · ${c.sourceLicense}` : ''}</p>)}
          </div>
        )}
      </Section>
    </div>
  )
}
