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
import type { StudioDoc } from '../../types/project'
import { Button } from '../../components/Button'
import { suggestEdits } from '../../lib/studio/suggestions'
import { buildBeforeAfter, buildCollage, buildFromAssets, buildTestimonialGrid, type IntakeKind, type MediaRef } from '../../lib/studio/layouts'
import { captionsFromTranscript } from '../../lib/studio/textTools'
import { computeScopes, type Scopes } from '../../lib/studio/color'
import { removeMarker } from '../../lib/studio/timelineOps'
import { placeClip } from '../../lib/studio/doc'
import { registerFile } from '../../lib/studio/media'
import { checkResourceLink, githubRepoOf, withRepoLicense, type LinkVerdict } from '../../lib/resourceLinks'

type Props = {
  doc: StudioDoc
  time: number
  /** Show a proposed doc on the stage without committing it (null = stop). */
  onPreview: (doc: StudioDoc | null, label: string) => void
  onCommit: (doc: StudioDoc, label: string) => void
  onSeek: (t: number) => void
}

const inputCx = 'w-full rounded-lg border border-line bg-panel-alt px-2.5 py-1.5 text-sm text-text'

function Section({ title, children, open }: { title: string; children: React.ReactNode; open?: boolean }) {
  return (
    <details open={open} className="rounded-lg border border-line bg-panel/40 open:bg-panel/70">
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

export function StudioProPanel({ doc, time, onPreview, onCommit, onSeek }: Props) {
  const [pending, setPending] = useState<{ doc: StudioDoc; label: string; notes?: string[] } | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const suggestions = useMemo(() => suggestEdits(doc), [doc])
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
          <div key={s.id} className="rounded-md border border-line p-2">
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
            <button key={n} type="button" className="rounded-md border border-line px-2 py-0.5 text-xs hover:border-accent/60" onClick={() => propose(buildTestimonialGrid(doc, n, time).doc, `Testimonial grid (${n})`, ['Cards are empty placeholders. Paste real quotes you have permission to use — the app never writes them.'])}>
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
            <input className="min-w-0 flex-1 rounded border border-line bg-panel-alt px-1.5 py-0.5" value={m.label} aria-label="Marker label" onChange={(e) => onCommit({ ...doc, markers: (doc.markers ?? []).map((x) => (x.id === m.id ? { ...x, label: e.target.value } : x)) }, 'Rename marker')} />
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
