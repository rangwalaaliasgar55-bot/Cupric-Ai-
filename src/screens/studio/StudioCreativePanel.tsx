import { useMemo, useState } from 'react'
import { Copy, Download, Gauge, Image as ImageIcon, Layers, Mic, Palette, Repeat2, Search, Share2 } from 'lucide-react'
import type { StudioAspect, StudioClip, StudioDoc } from '../../types/project'
import { Button } from '../../components/Button'
import { PLATFORM_PRESETS, checkPreset, studioToSrt } from '../../lib/studio/editTools'
import { applyBrandKit, buildVariants, reframeForAspect, socialMetadata, speedRamp, SPEED_RAMPS, type BrandKit, type SpeedRampId } from '../../lib/studio/creativeTools'
import { simpleIconSlug, simpleIconUrl } from '../../lib/simpleIcons'
import { synthesizeVoiceover, type VoiceoverLanguage } from '../../lib/voice'
import { useActiveProject, useProjectStore } from '../../state/useProjectStore'
import { uid, copyText } from '../../lib/utils'
import { captureStill } from '../../lib/studio/export'
import { DESIGN_DIRECTIONS, designAll, type DesignDirectionId } from '../../lib/studio/design'
import {
  avoidedDirections,
  creativeBrief,
  footageKeyFor,
  logEntry,
  readCreativeLog,
  recordAcceptance,
  recordRejection,
} from '../../lib/studio/creativeLog'
import { Sparkles } from 'lucide-react'

type Props = {
  doc: StudioDoc
  time: number
  selectedId?: string | null
  onPreview: (doc: StudioDoc | null, label: string) => void
  onCommit: (doc: StudioDoc, label: string) => void
  /** Import generated files (voiceover WAV) through the Studio's normal path. */
  onImportFiles?: (files: FileList) => void
}

const FONTS = ['Geist Variable', 'Inter Variable', 'Manrope Variable', 'DM Sans Variable', 'Space Grotesk Variable', 'Playfair Display Variable', 'JetBrains Mono Variable']
const inputCx = 'w-full cu-input px-2.5 py-1.5 text-sm text-text'

function Block({ icon: Icon, title, children, open }: { icon: typeof Gauge; title: string; children: React.ReactNode; open?: boolean }) {
  return (
    <details open={open} className="group cu-section overflow-hidden">
      <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2.5 text-xs font-semibold text-text">
        <Icon size={14} className="text-accent-text" /> {title}
      </summary>
      <div className="space-y-2.5 border-t border-line px-3 py-3">{children}</div>
    </details>
  )
}

export function StudioCreativePanel({ doc, time, selectedId, onPreview, onCommit, onImportFiles }: Props) {
  const project = useActiveProject()
  const [msg, setMsg] = useState<string | null>(null)
  const selected = doc.clips.find((c) => c.id === selectedId) ?? null
  const [lookWhat, setLookWhat] = useState('')
  const [lookWhy, setLookWhy] = useState('')
  const [logMsg, setLogMsg] = useState<string | null>(null)
  const [logVersion, setLogVersion] = useState(0)
  /**
   * The design history for the footage in play: the selected clip's picture, else the first
   * video in the edit. Read per render from the log (one small localStorage read) and bumped
   * by `logVersion` after a write, so the panel never shows a stale list.
   */
  const footageKey = footageKeyFor(doc, selected ? selected.startSec : 0, selected ? selected.durationSec : 0)
  const entry = useMemo(() => (footageKey ? logEntry(readCreativeLog().log, footageKey) : null), [footageKey, logVersion])
  const footageBrief = creativeBrief(entry)
  /** Record the typed look against this footage. Both directions need a reason, as upstream. */
  function recordLook(kind: 'rejected' | 'accepted') {
    if (!footageKey) { setMsg('Import some footage first — the history is kept per source clip.'); return }
    const directionId = DESIGN_DIRECTIONS.find((d) => d.name === lookWhat.trim() || d.id === lookWhat.trim())?.id
    const input = { what: lookWhat, why: lookWhy, ...(directionId ? { directionId } : {}) }
    const result = kind === 'rejected' ? recordRejection(footageKey, input) : recordAcceptance(footageKey, input)
    setLogMsg(result.message)
    if (result.ok) { setLookWhy(''); setLogVersion((v) => v + 1) }
  }

  /**
   * Design engine entry point. `direction` null = run every direction and keep
   * the highest-scoring one; that is the same battle the autonomous run uses.
   * Scenes = the selected clips when a selection exists, the whole edit otherwise.
   */
  function runDesign(direction: DesignDirectionId | null) {
    const ids = selected ? [selected.id] : doc.clips.map((c) => c.id)
    if (!ids.length) { setDesignMsg('This edit is empty — add clips first.'); return }
    const brief = {
      brandColors: kit.colors,
      aspect: doc.aspect,
      tone: (doc.fps >= 60 ? 'high' : 'medium') as 'high' | 'medium' | 'calm',
      referenceStyle: '',
    }
    const makeId = () => uid()
    const avoided = avoidedDirections(logEntry(readCreativeLog().log, footageKey ?? ''))
    if (direction) {
      const named = DESIGN_DIRECTIONS.find((d) => d.id === direction)
      const result = designAll(doc, brief, ids, makeId, { only: direction })
      setDesignMsg(`Applied “${named?.name}”: ${result.report.scenes.length} scene(s), score ${result.report.score}/100. ${result.report.notes[0] ?? ''}`)
      // The look's own stated reason, pre-filled so recording the acceptance is one click —
      // still editable, and still not recorded until the user says so.
      setLookWhat(named?.name ?? '')
      setLookWhy(named?.why ?? '')
      commitResult({ doc: result.doc, changed: result.doc !== doc, reason: 'That direction changed nothing.' }, `Design engine → ${named?.name ?? direction}`)
      return
    }
    const battle = designAll(doc, brief, ids, makeId, { avoid: avoided })
    const skipNote = battle.skipped.length
      ? ` Skipped ${battle.skipped.map((s) => s.name).join(', ')} — rejected on this footage before.`
      : ''
    setDesignMsg(`Scored ${battle.battle.length} directions here: ${battle.battle.map((b) => `${b.name} ${b.score}`).join(' · ')}. Built “${battle.report.direction.name}” (${battle.report.score}/100).${skipNote}${battle.skippedNote ? ` ${battle.skippedNote}` : ''}`)
    setLookWhat(battle.report.direction.name)
    setLookWhy(battle.report.direction.why)
    commitResult({ doc: battle.doc, changed: battle.doc !== doc, reason: 'Nothing to redesign yet.' }, `Design engine → ${battle.report.direction.name}`)
  }


  /* Brand Kit lives on the project so every edit and the autonomous pipeline share it. */
  const kit: BrandKit = project?.brandKit ?? { colors: ['#0B0B10', '#C8F542', '#F4F1EA'], font: 'Inter Variable', logoDataUrl: null }
  const saveKit = (next: BrandKit) => {
    if (!project) return
    useProjectStore.setState((s) => ({ projects: s.projects.map((p) => (p.id === project.id ? { ...p, brandKit: next, updatedAt: new Date().toISOString() } : p)) }))
  }
  const [ramp, setRamp] = useState<SpeedRampId>('hero-moment')
  const [presetId, setPresetId] = useState('reels')
  const [logoQuery, setLogoQuery] = useState('')
  const [logoBusy, setLogoBusy] = useState(false)
  const [script, setScript] = useState('')
  const [rate, setRate] = useState(0)
  const [ttsLang, setTtsLang] = useState<VoiceoverLanguage>('auto')
  const [ttsBusy, setTtsBusy] = useState(false)
  const [variantCount, setVariantCount] = useState(3)
  const [aspect, setAspect] = useState<StudioAspect>(doc.aspect === '9:16' ? '16:9' : '9:16')
  const [thumbnail, setThumbnail] = useState<string | null>(null)
  const [designMsg, setDesignMsg] = useState<string | null>(null)
  const social = socialMetadata(doc, project?.name || 'Untitled video')

  const commitResult = (r: { doc: StudioDoc; changed: boolean; reason?: string; notes?: string[] }, label: string) => {
    if (!r.changed) { setMsg(r.reason ?? 'Nothing to change.'); return }
    onPreview(null, '')
    onCommit(r.doc, label)
    setMsg(r.notes?.join(' ') || `${label} — done (Ctrl+Z undoes it).`)
  }

  async function fetchLogo(): Promise<string | null> {
    const slug = simpleIconSlug(logoQuery)
    if (!slug) { setMsg('Type a brand name, e.g. “Stripe” or “GitHub”.'); return null }
    setLogoBusy(true)
    try {
      const color = (kit.colors.find((c, i) => i > 0 && /^#[0-9a-f]{6}$/i.test(c)) ?? '#F4F1EA').slice(1)
      const res = await fetch(simpleIconUrl(slug, color))
      if (!res.ok) { setMsg(`Simple Icons has no logo called “${logoQuery}” (${slug}). Check the spelling on simpleicons.org.`); return null }
      const svg = await res.text()
      return `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(svg)))}`
    } catch {
      setMsg('Could not reach Simple Icons — logos need an internet connection. Upload a logo file instead.')
      return null
    } finally { setLogoBusy(false) }
  }

  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between">
        <h2 className="text-sm font-semibold">Create</h2>
        <span className="text-[11px] text-muted">every action is one undo step</span>
      </div>
      {msg && <p role="status" className="rounded-lg border border-line bg-panel-alt/60 px-2.5 py-1.5 text-xs text-muted">{msg}</p>}

      <Block icon={Gauge} title="Speed ramp" open={selected?.kind === 'video'}>
        {selected?.kind !== 'video' ? (
          <p className="text-xs text-muted">Select a video clip on the timeline to ramp its speed.</p>
        ) : (
          <>
            <select className={inputCx} value={ramp} onChange={(e) => setRamp(e.target.value as SpeedRampId)} aria-label="Speed ramp preset">
              {Object.entries(SPEED_RAMPS).map(([id, r]) => <option key={id} value={id}>{r.label}</option>)}
            </select>
            <p className="text-[11px] text-muted">Speeds: {SPEED_RAMPS[ramp].speeds.join('× → ')}× · the clip is split into 5 segments with continuous footage; later clips on the track move to make room.</p>
            <div className="flex gap-1.5">
              <Button size="sm" variant="outline" onMouseEnter={() => { const r = speedRamp(doc, selected.id, ramp); if (r.changed) onPreview(r.doc, 'Speed ramp preview') }} onMouseLeave={() => onPreview(null, '')}>Preview</Button>
              <Button size="sm" variant="primary" onClick={() => commitResult(speedRamp(doc, selected.id, ramp), `Speed ramp · ${SPEED_RAMPS[ramp].label.split(' (')[0]}`)}>Apply ramp</Button>
            </div>
          </>
        )}
      </Block>

      <Block icon={Sparkles} title="Design engine (stages, type, accents)">
        <p className="text-[11px] leading-relaxed text-muted">
          Redesigns the selected scenes (or the whole edit) the way a motion designer would: a different stage per scene,
          one typographic system taken from the font suggestions, contrast-checked ink, native accent shapes and safe-area
          placement. It only ever edits cups it created or that you selected — and it is one undo step.
        </p>
        <div className="flex flex-wrap gap-1.5">
          <Button size="sm" variant="primary" onClick={() => runDesign(null)}>Auto (best of {DESIGN_DIRECTIONS.length})</Button>
          {DESIGN_DIRECTIONS.map((d) => (
            <Button key={d.id} size="sm" variant="outline" title={d.why} onClick={() => runDesign(d.id)}>{d.name.replace('-led', '')}</Button>
          ))}
        </div>
        {designMsg && <p className="rounded-md bg-accent/10 px-2 py-1.5 text-[11px] text-text">{designMsg}</p>}
        <div className="space-y-1.5 rounded-md border border-line px-2 py-2">
          <p className="text-[11px] leading-relaxed text-muted">
            {entry?.rejected.length || entry?.accepted
              ? `This footage has a history: ${entry.rejected.length} rejected look(s)${entry.accepted ? `, accepted “${entry.accepted.what}”` : ''}. A rejected direction is not scored again here, and a rewrite over this footage is told what not to land on.`
              : 'Nothing recorded on this footage yet. Recording a look here keeps it out of the next round — the design engine stops scoring a direction you rejected, and text rewrites over this clip are told what not to land on.'}
          </p>
          <input className={inputCx} aria-label="Look tried on this footage" placeholder="What was tried (e.g. Composition-led)" value={lookWhat} onChange={(e) => setLookWhat(e.target.value)} />
          <input className={inputCx} aria-label="Why it landed or was rejected" placeholder="Why (required)" value={lookWhy} onChange={(e) => setLookWhy(e.target.value)} />
          <div className="flex flex-wrap gap-1.5">
            <Button size="sm" variant="outline" title="Record this look as rejected on this footage (needs a reason)" onClick={() => recordLook('rejected')}>Rejected</Button>
            <Button size="sm" variant="outline" title="Record this look as the accepted bar for this footage (needs a reason)" onClick={() => recordLook('accepted')}>This one landed</Button>
            {footageBrief ? (
              <Button
                size="sm"
                variant="outline"
                title="Copy the history as prose — paste it into any brief for this footage"
                onClick={() => { void copyText(footageBrief); setLogMsg('Brief copied — the accepted look is named as the bar, and the rejections as things not to land on again.') }}
              >
                Copy brief
              </Button>
            ) : null}
          </div>
          {logMsg && <p role="status" className="text-[11px] text-muted">{logMsg}</p>}
        </div>
      </Block>

      <Block icon={Palette} title="Brand Kit">
        <div className="flex flex-wrap items-center gap-1.5">
          {kit.colors.map((c, i) => (
            <label key={i} className="relative">
              <input type="color" aria-label={`Brand colour ${i + 1}`} value={/^#[0-9a-f]{6}$/i.test(c) ? c : '#000000'} onChange={(e) => saveKit({ ...kit, colors: kit.colors.map((x, j) => (j === i ? e.target.value : x)) })} className="h-8 w-8 cursor-pointer rounded-md border border-line bg-transparent" />
            </label>
          ))}
          {kit.colors.length < 6 && <button type="button" className="h-8 w-8 rounded-md border border-dashed border-line text-muted hover:text-text" onClick={() => saveKit({ ...kit, colors: [...kit.colors, '#4FB6E8'] })} aria-label="Add brand colour">+</button>}
          {kit.colors.length > 1 && <button type="button" className="text-[11px] text-muted underline" onClick={() => saveKit({ ...kit, colors: kit.colors.slice(0, -1) })}>remove last</button>}
        </div>
        <p className="text-[11px] text-muted">First colour = background; text uses the brand colour with the best contrast.</p>
        <select className={inputCx} aria-label="Brand font" value={kit.font} onChange={(e) => saveKit({ ...kit, font: e.target.value })}>
          {(FONTS.includes(kit.font) ? FONTS : [kit.font, ...FONTS]).map((f) => <option key={f} value={f}>{f.replace(' Variable', '')}</option>)}
        </select>
        <div className="flex items-center gap-2">
          {kit.logoDataUrl ? <img src={kit.logoDataUrl} alt="Brand logo" className="h-9 w-9 rounded-md border border-line bg-panel-alt object-contain p-1" /> : <div className="flex h-9 w-9 items-center justify-center rounded-md border border-dashed border-line text-[10px] text-muted">logo</div>}
          <label className="cursor-pointer cu-chip px-2 py-1 text-xs">
            Upload logo
            <input type="file" accept="image/png,image/svg+xml,image/jpeg,image/webp" className="hidden" onChange={(e) => {
              const f = e.target.files?.[0]
              if (!f) return
              const r = new FileReader()
              r.onload = () => saveKit({ ...kit, logoDataUrl: String(r.result) })
              r.readAsDataURL(f)
            }} />
          </label>
          {kit.logoDataUrl && <button type="button" className="text-[11px] text-muted underline" onClick={() => saveKit({ ...kit, logoDataUrl: null })}>clear</button>}
        </div>
        <div className="flex flex-wrap gap-1.5">
          <Button size="sm" variant="primary" onClick={() => commitResult(applyBrandKit(doc, kit), 'Apply Brand Kit')}>Apply to video</Button>
          <Button size="sm" variant="outline" onClick={() => commitResult(applyBrandKit(doc, kit, { stage: true }), 'Apply Brand Kit + background')}>+ brand background</Button>
        </div>
      </Block>

      <Block icon={Search} title="Brand & company logos (Simple Icons)">
        <p className="text-[11px] text-muted">3,000+ free brand logos (CC0; each mark stays its owner’s trademark — use only where you have the right to show it).</p>
        <div className="flex gap-1.5">
          <input className={inputCx} placeholder="e.g. Stripe, GitHub, Figma" value={logoQuery} onChange={(e) => setLogoQuery(e.target.value)} aria-label="Brand name" />
        </div>
        <div className="flex flex-wrap gap-1.5">
          <Button size="sm" variant="outline" disabled={logoBusy || !logoQuery.trim()} title={(logoBusy || !logoQuery.trim()) ? 'Type a brand name first — or wait' : undefined} onClick={async () => {
            const dataUrl = await fetchLogo()
            if (!dataUrl) return
            const track = Math.max(0, ...doc.clips.map((c) => c.track)) + 1
            const clip = { id: uid(), kind: 'overlay', name: `${logoQuery.trim()} logo`, source: 'simple-icons', dataUrl, x: 0.5, y: 0.5, scale: 0.22, track, startSec: Math.max(0, time), durationSec: 3, opacity: 1, transitionIn: 'fade', transitionOut: 'fade' } as StudioClip
            onCommit({ ...doc, clips: [...doc.clips, clip], trackCount: Math.max(doc.trackCount, track + 1) }, `Add ${logoQuery.trim()} logo`)
            setMsg(`${logoQuery.trim()} logo added at the playhead (Simple Icons, CC0).`)
          }}>{logoBusy ? 'Fetching…' : 'Add at playhead'}</Button>
          <Button size="sm" variant="outline" disabled={logoBusy || !logoQuery.trim()} title={(logoBusy || !logoQuery.trim()) ? 'Type a brand name first — or wait' : undefined} onClick={async () => { const d = await fetchLogo(); if (d) { saveKit({ ...kit, logoDataUrl: d }); setMsg('Saved as your Brand Kit logo.') } }}>Use as my logo</Button>
        </div>
      </Block>

      <Block icon={Mic} title="AI voiceover (offline)">
        <textarea className={`${inputCx} min-h-20`} placeholder="Write the narration. Your computer’s built-in voice reads it — no internet, no API key." value={script} onChange={(e) => setScript(e.target.value)} aria-label="Voiceover script" maxLength={5000} />
        <label className="flex items-center gap-2 text-xs text-muted">Language
          <select className={inputCx} value={ttsLang} onChange={(e) => setTtsLang(e.target.value as VoiceoverLanguage)} aria-label="Voiceover language">
            <option value="auto">Auto (Devanagari → Hindi)</option><option value="en">English</option><option value="hi">Hindi (हिन्दी)</option>
          </select>
        </label>
        <label className="flex items-center gap-2 text-xs text-muted">Pace
          <input type="range" min={-6} max={6} value={rate} onChange={(e) => setRate(Number(e.target.value))} className="flex-1" aria-label="Voiceover pace" />
          <span className="w-8 text-right font-mono tabular-nums">{rate > 0 ? `+${rate}` : rate}</span>
        </label>
        <Button size="sm" variant="primary" disabled={ttsBusy || !script.trim()} title={(ttsBusy || !script.trim()) ? 'Write a script first — or wait for the voice' : undefined} onClick={async () => {
          if (!onImportFiles) { setMsg('Voiceover import is not available here.'); return }
          setTtsBusy(true)
          try {
            const { file, engine, language } = await synthesizeVoiceover(script, { rate, language: ttsLang })
            const dt = new DataTransfer(); dt.items.add(file)
            onImportFiles(dt.files)
            setMsg(`${language === 'hi' ? 'Hindi' : 'English'} voiceover generated offline with ${engine} and added at the playhead as an audio clip.`)
          } catch (err) { setMsg(err instanceof Error ? err.message : String(err)) } finally { setTtsBusy(false) }
        }}>{ttsBusy ? 'Speaking…' : 'Generate voiceover'}</Button>
        <p className="text-[11px] text-muted">English and Hindi, fully offline: Piper (if you add a voice model), else Windows Speech, macOS voices or eSpeak NG. If a Hindi voice is missing, Cupric tells you how to add it and never reads Hindi with an English voice. Tip: “Auto-captions” can then caption it.</p>
      </Block>

      <Block icon={Layers} title="Batch variants">
        <p className="text-[11px] text-muted">Makes copies with a rewritten headline (different tones) and the accent rotated through your brand colours, saved as scenes for A/B tests.</p>
        <div className="flex items-center gap-2">
          <select className={inputCx} value={variantCount} onChange={(e) => setVariantCount(Number(e.target.value))} aria-label="Number of variants">
            {[2, 3, 4, 5, 6].map((n) => <option key={n} value={n}>{n} variants</option>)}
          </select>
          <Button size="sm" variant="primary" onClick={() => commitResult(buildVariants(doc, variantCount, kit), `Build ${variantCount} variants`)}>Build</Button>
        </div>
      </Block>

      <Block icon={Share2} title="Social share kit" open>
        <p className="text-[11px] text-muted">Creates draft metadata from your existing text and a still thumbnail. Exports never add a watermark unless you explicitly add a logo/end card.</p>
        <label className="block text-[11px] text-muted">Title<input className={`${inputCx} mt-1`} value={social.title} readOnly aria-label="Social title" /></label>
        <label className="block text-[11px] text-muted">Caption<textarea className={`${inputCx} mt-1 min-h-14`} value={social.caption} readOnly aria-label="Social caption" /></label>
        <div className="rounded-lg border border-line bg-panel-alt/50 px-2 py-1.5 text-[11px] text-muted">{social.hashtags.join(' ')}</div>
        <div className="flex flex-wrap gap-1.5">
          <Button size="sm" variant="outline" onClick={() => void copyText(`${social.caption}\n\n${social.hashtags.join(' ')}`).then((ok) => setMsg(ok ? 'Caption and hashtags copied.' : 'Clipboard is unavailable.'))}><Copy size={12} /> Copy caption + hashtags</Button>
          <Button size="sm" variant="primary" onClick={() => { const still = captureStill(doc, time); if (still) { setThumbnail(still); setMsg('Thumbnail captured from the same deterministic renderer used by preview/export.') } else setMsg('Could not capture a thumbnail at this playhead.') }}><ImageIcon size={12} /> Capture thumbnail</Button>
        </div>
        {thumbnail && <div className="flex items-center gap-2 rounded-lg border border-line bg-panel-alt/50 p-2"><img src={thumbnail} alt="Generated video thumbnail" className="h-16 w-28 rounded object-cover" /><a href={thumbnail} download="cupric-thumbnail.png" className="cu-chip flex items-center gap-1 px-2 py-1 text-xs"><Download size={12} /> Download PNG</a></div>}
      </Block>

      <Block icon={Share2} title="Platform export preset">
        <select className={inputCx} value={presetId} onChange={(e) => setPresetId(e.target.value)} aria-label="Platform">
          {PLATFORM_PRESETS.map((p) => <option key={p.id} value={p.id}>{p.label} · {p.aspect}</option>)}
        </select>
        {(() => { const preset = PLATFORM_PRESETS.find((p) => p.id === presetId)!; const issues = checkPreset(doc, preset); return (
          <>
            <p className="text-[11px] text-muted">{preset.note} Up to {preset.maxSec >= 3600 ? 'hours' : `${preset.maxSec}s`}, {preset.fps} fps.</p>
            {issues.length === 0 ? <p className="text-[11px] text-accent-text">Ready for {preset.label}.</p> : (
              <ul className="list-disc pl-4 text-[11px]">{issues.map((i) => <li key={i.text} className={i.level === 'error' ? 'text-danger' : 'text-muted'}>{i.text}</li>)}</ul>
            )}
            <div className="flex flex-wrap gap-1.5">
              <Button size="sm" variant="primary" disabled={doc.aspect === preset.aspect && doc.fps === preset.fps} title={(doc.aspect === preset.aspect && doc.fps === preset.fps) ? 'Already using this format' : undefined} onClick={() => { commitResult({ doc: { ...(doc.aspect === preset.aspect ? doc : reframeForAspect(doc, preset.aspect)), fps: preset.fps }, changed: true }, `Apply ${preset.label} preset`); setMsg(`Set to ${preset.aspect} at ${preset.fps} fps. Text was reframed into the new safe area. Undo reverts it.`) }}>Apply preset</Button>
              <Button size="sm" variant="outline" onClick={() => { const r = studioToSrt(doc); if (!r.cues) { setMsg('No text clips to turn into captions yet.'); return } const url = URL.createObjectURL(new Blob([r.srt], { type: 'application/x-subrip' })); const a = document.createElement('a'); a.href = url; a.download = `${(project?.name || 'captions').replace(/[^\w-]+/g, '-')}.srt`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); setMsg(`Saved ${r.cues} caption cue(s) as SRT${r.skipped ? `. Skipped ${r.skipped} placeholder line(s)` : ''}.`) }}><Download size={12} /> Captions (.srt)</Button>
            </div>
          </>
        ) })()}
      </Block>

      <Block icon={Repeat2} title="Repurpose to another size">
        <p className="text-[11px] text-muted">Reframes the edit: text keeps its size against the short side and moves inside the safe area. “All sizes” in the toolbar renders 9:16, 1:1 and 16:9 with this reframe.</p>
        <div className="flex items-center gap-2">
          <select className={inputCx} value={aspect} onChange={(e) => setAspect(e.target.value as StudioAspect)} aria-label="Target size">
            {(['9:16', '1:1', '4:5', '16:9'] as StudioAspect[]).filter((a) => a !== doc.aspect).map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
          <Button size="sm" variant="outline" onMouseEnter={() => onPreview(reframeForAspect(doc, aspect), `Reframe ${aspect}`)} onMouseLeave={() => onPreview(null, '')}>Preview</Button>
          <Button size="sm" variant="primary" onClick={() => commitResult({ doc: reframeForAspect(doc, aspect), changed: true }, `Repurpose to ${aspect}`)}>Convert</Button>
        </div>
      </Block>
    </div>
  )
}
