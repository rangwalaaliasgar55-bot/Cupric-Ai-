/**
 * Quick Video — one topic in, an editable timeline out. Each stage can be run
 * on its own or all at once, and every result stays editable in Studio.
 * Pipeline concept after MoneyPrinterTurbo (MIT © 2024 Harry), rewritten in TS.
 */
import { useMemo, useState } from 'react'
import { Download, Upload, Wand2, History, Play, RotateCcw } from 'lucide-react'
import { Button } from '../../components/Button'
import { Badge } from '../../components/Badge'
import { MatrixLoader } from '../../components/loaders/MatrixLoader'
import { PipelineIcon, ShinyText, SpotlightCard, type PipelineStepState } from '../../components/fx'
import { getIpc } from '../../lib/bridge'
import { registerFile, registerUrl } from '../../lib/studio/media'
import { studioOf } from '../../lib/studio/doc'
import { transcribeMediaPath } from '../../lib/studio/autoCaptions'
import { synthesizeVoiceover } from '../../lib/voice'
import { useActiveProject, useProjectStore } from '../../state/useProjectStore'
import {
  ASPECT_PRESETS, DEFAULT_QUICK_SETTINGS, QUICK_VIDEO_SOURCE, buildQuickVariants, captionTimingOf, cleanScript, draftScript, estimateNarrationSec,
  exportSettings, importSettings, parseHistory, pushTask, sanitizeSettings, scriptPrompt, searchTerms,
  type QuickAudio, type QuickMedia, type QuickTask, type QuickVideoSettings, type QuickWord,
} from '../../lib/production/quickVideo'

const STEPS = [
  { id: 'script', label: 'Script' }, { id: 'terms', label: 'Terms' }, { id: 'footage', label: 'Footage' },
  { id: 'voice', label: 'Voice' }, { id: 'subtitles', label: 'Subtitles' }, { id: 'music', label: 'Music' }, { id: 'compose', label: 'Timeline' },
] as const
type StepId = (typeof STEPS)[number]['id']
const HISTORY_KEY = 'newbrand.quickVideo.history'
const SETTINGS_KEY = 'newbrand.quickVideo.settings'
const inputCx = 'cu-input w-full'

function loadSettings(): QuickVideoSettings {
  try { return sanitizeSettings(JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}')) } catch { return DEFAULT_QUICK_SETTINGS }
}

type StockItem = { id: string; kind: 'image' | 'video'; title: string; previewUrl: string; downloadUrl: string; pageUrl: string; attribution: string }

export function QuickVideoPanel() {
  const project = useActiveProject()
  const patchStudio = useProjectStore((s) => s.patchStudio)
  const pushToast = useProjectStore((s) => s.pushToast)
  const [s, setS] = useState<QuickVideoSettings>(loadSettings)
  const [terms, setTerms] = useState<string[]>([])
  const [steps, setSteps] = useState<Record<StepId, PipelineStepState>>({ script: 'idle', terms: 'idle', footage: 'idle', voice: 'idle', subtitles: 'idle', music: 'idle', compose: 'idle' })
  const [busy, setBusy] = useState<string | null>(null)
  const [log, setLog] = useState<string[]>([])
  const [music, setMusic] = useState<File | null>(null)
  const [history, setHistory] = useState<QuickTask[]>(() => parseHistory(typeof localStorage === 'undefined' ? null : localStorage.getItem(HISTORY_KEY)))
  const [useProjectMedia, setUseProjectMedia] = useState(false)

  const set = (patch: Partial<QuickVideoSettings>) => setS((prev) => { const next = sanitizeSettings({ ...prev, ...patch }); try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(next)) } catch { /* private mode */ } return next })
  const mark = (id: StepId, st: PipelineStepState) => setSteps((prev) => ({ ...prev, [id]: st }))
  const note = (line: string) => setLog((prev) => [...prev, line].slice(-12))
  const estimate = useMemo(() => (s.script.trim() ? estimateNarrationSec(s.script, s.language, s.voiceRate) : 0), [s.script, s.language, s.voiceRate])
  const projectMedia = useMemo(() => (project ? studioOf(project).clips.filter((c) => c.kind === 'video' || c.kind === 'image') : []), [project])

  async function writeScript(): Promise<string> {
    if (s.script.trim()) { mark('script', 'done'); return s.script }
    if (!s.topic.trim()) throw new Error('Type a topic first, or paste your own script.')
    mark('script', 'active')
    const ipc = getIpc()
    let text = ''
    if (ipc) {
      try {
        const reply = await ipc.invoke('gemini:chat', { text: scriptPrompt(s), ctx: { projectName: project?.name ?? null, view: 'production' }, history: [] })
        const raw = typeof reply === 'string' ? reply : (reply as { text?: string })?.text ?? ''
        text = cleanScript(raw)
        if (text) note('Script written by your configured model.')
      } catch (err) { note(`Live model unavailable (${err instanceof Error ? err.message : String(err)}); using the offline outline.`) }
    }
    if (!text) { text = draftScript(s); note('Offline outline drafted from the topic — edit it before building; no facts were invented.') }
    set({ script: text }); mark('script', 'done')
    return text
  }

  function makeTerms(script: string): string[] {
    mark('terms', 'active')
    const t = searchTerms(s.topic, script, s.termCount, s.matchScriptOrder)
    setTerms(t); mark('terms', 'done'); note(`Search terms: ${t.join(', ')}`)
    return t
  }

  async function fetchFootage(list: string[]): Promise<{ media: QuickMedia[]; credits: NonNullable<ReturnType<typeof studioOf>['credits']> }> {
    mark('footage', 'active')
    if (useProjectMedia || !getIpc()) {
      if (!projectMedia.length) throw new Error(getIpc() ? 'No video or image clips in this project yet — import some or switch to stock.' : 'Stock search runs in the desktop app. In the browser, import media into Studio and tick “Use project media”.')
      const media = projectMedia.map((c, i) => { const m = c as Extract<typeof c, { mediaId: string }>; return { mediaId: m.mediaId, fileName: m.fileName, localPath: m.localPath, kind: c.kind as 'video' | 'image', durationSec: (m as { sourceDurationSec?: number }).sourceDurationSec || c.durationSec, term: list[i % Math.max(1, list.length)] ?? c.name } })
      mark('footage', 'done'); note(`Using ${media.length} clips already in the project.`)
      return { media, credits: [] }
    }
    const ipc = getIpc()!
    const media: QuickMedia[] = []
    const credits: NonNullable<ReturnType<typeof studioOf>['credits']> = []
    const kind = s.provider === 'openverse' || s.provider === 'picsum' ? 'image' : s.mediaKind
    const orientation = s.aspect === '9:16' || s.aspect === '4:5' ? 'vertical' : s.aspect === '16:9' ? 'horizontal' : 'all'
    for (const term of list) {
      try {
        const res = await ipc.invoke('stock:search', { provider: s.provider, kind, options: { query: term, orientation, perPage: 3 } }) as { results?: StockItem[] }
        const item = res.results?.[0]
        if (!item) { note(`No ${s.provider} result for “${term}”.`); continue }
        const saved = await ipc.invoke('stock:download', { projectId: project!.id, item }) as { localPath: string; fileName: string; kind: 'image' | 'video'; attribution: string; pageUrl: string; source: string; sourceLicense: string | null }
        const url = await ipc.invoke('arena:previewPath', saved.localPath) as string
        const h = await registerUrl(url, saved.fileName, saved.kind, saved.localPath)
        media.push({ mediaId: h.id, fileName: h.fileName, localPath: h.localPath, kind: saved.kind, durationSec: h.durationSec || 0, term, posterDataUrl: h.posterDataUrl })
        credits.push({ url: saved.pageUrl, source: saved.source, sourceLicense: saved.sourceLicense, attribution: saved.attribution })
        note(`“${term}” → ${saved.attribution}`)
      } catch (err) { note(`“${term}” failed: ${err instanceof Error ? err.message : String(err)}`) }
    }
    if (!media.length) { mark('footage', 'error'); throw new Error('No footage could be downloaded. Check Settings → Stock, try Openverse, or use project media.') }
    mark('footage', 'done')
    return { media, credits }
  }

  async function makeVoice(script: string): Promise<{ voice: QuickAudio | null; words: QuickWord[] | null }> {
    if (s.voice === 'none') { mark('voice', 'skipped'); return { voice: null, words: null } }
    mark('voice', 'active')
    try {
      const { file, engine, language } = await synthesizeVoiceover(script, { rate: s.voiceRate, language: s.language })
      const h = await registerFile(file)
      mark('voice', 'done'); note(`${language === 'hi' ? 'Hindi' : 'English'} voiceover made offline with ${engine}.`)
      const voice = { mediaId: h.id, fileName: h.fileName, localPath: h.localPath, durationSec: h.durationSec || estimateNarrationSec(script, s.language, s.voiceRate) }
      return { voice, words: await transcribeVoice(h.localPath, language) }
    } catch (err) {
      mark('voice', 'error'); note(`Voiceover skipped: ${err instanceof Error ? err.message : String(err)} Timing uses the reading estimate.`)
      return { voice: null, words: null }
    }
  }

  /**
   * Real word times for the subtitles, from the voiceover we just made. This is
   * the same transcription entry point Studio's auto-captions use, so both paths
   * produce the same timings from the same audio. It never throws silently: a
   * failure is named in the log and the captions are labelled as estimates.
   */
  async function transcribeVoice(localPath: string | null, language: 'en' | 'hi'): Promise<QuickWord[] | null> {
    if (!s.wordTimings || !s.subtitles) return null
    if (!getIpc()) { note('Real word timings need the desktop app (offline Whisper). Subtitles are estimated from the script.'); return null }
    if (!localPath) { note('The voiceover has no file on disk, so its words cannot be timed. Subtitles are estimated from the script.'); return null }
    try {
      const { words, timing, engine } = await transcribeMediaPath(localPath, language)
      if (!words?.length) { note(`${engine} returned no words; subtitles are estimated from the script.`); return null }
      note(`Word timings from ${engine}${timing === 'phrase' ? ' (phrase-level — words inside a phrase are spread)' : ''}: ${words.length} words.`)
      return words
    } catch (err) {
      note(`Word timings unavailable (${err instanceof Error ? err.message : String(err)}). Subtitles are estimated from the script — they are labelled that way in Studio.`)
      return null
    }
  }

  async function makeMusic(): Promise<QuickAudio | null> {
    if (!music) { mark('music', 'skipped'); return null }
    mark('music', 'active')
    const h = await registerFile(music)
    mark('music', 'done'); note(`Music: ${music.name} at ${Math.round(s.bgmVolume * 100)}% (ducked under the voice).`)
    return { mediaId: h.id, fileName: h.fileName, localPath: h.localPath, durationSec: h.durationSec || 30 }
  }

  async function runAll() {
    if (!project) { pushToast('info', 'Open a project first.'); return }
    setBusy('Building'); setLog([])
    setSteps({ script: 'idle', terms: 'idle', footage: 'idle', voice: 'idle', subtitles: 'idle', music: 'idle', compose: 'idle' })
    try {
      const script = await writeScript()
      const list = terms.length ? terms : makeTerms(script)
      if (terms.length) mark('terms', 'done')
      const { media, credits } = await fetchFootage(list)
      const { voice, words } = await makeVoice(script)
      mark('subtitles', s.subtitles ? 'done' : 'skipped')
      const bgm = await makeMusic()
      mark('compose', 'active')
      const base = studioOf(project)
      const doc = buildQuickVariants(base, s, script, media, { voice, music: bgm, words })
      const merged = { ...doc, credits: [...(doc.credits ?? []), ...credits] }
      patchStudio(project.id, merged, `Quick video: ${s.topic.slice(0, 40) || 'custom script'}`)
      mark('compose', 'done')
      const timing = captionTimingOf(merged)
      note(timing ? `Subtitles: ${timing.label}.` : 'No subtitles in this build.')
      const dur = Math.max(0, ...merged.clips.map((c) => c.startSec + c.durationSec))
      const task: QuickTask = { id: `qv-${history.length + 1}-${s.seed}`, at: new Date().toISOString(), topic: s.topic || 'Custom script', variants: s.variants, clips: merged.clips.length, durationSec: Math.round(dur * 10) / 10, status: 'done', note: `${media.length} footage · ${voice ? 'voice' : 'no voice'} · ${bgm ? 'music' : 'no music'}${timing ? ` · captions ${timing.source}` : ''}`, settings: s }
      const next = pushTask(history, task); setHistory(next); try { localStorage.setItem(HISTORY_KEY, JSON.stringify(next)) } catch { /* ignore */ }
      pushToast('success', `Timeline built (${merged.clips.length} clips${s.variants > 1 ? `, ${s.variants} variants saved as scenes` : ''}). Undo reverts it in one step.`)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      note(msg); pushToast('error', msg)
      const task: QuickTask = { id: `qv-f-${history.length + 1}-${s.seed}`, at: new Date().toISOString(), topic: s.topic || 'Custom script', variants: s.variants, clips: 0, durationSec: 0, status: 'failed', note: msg.slice(0, 120), settings: s }
      const next = pushTask(history, task); setHistory(next); try { localStorage.setItem(HISTORY_KEY, JSON.stringify(next)) } catch { /* ignore */ }
    } finally { setBusy(null) }
  }

  function downloadSettings() {
    const blob = new Blob([exportSettings(s)], { type: 'application/json' })
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'quick-video-settings.json'; a.click(); URL.revokeObjectURL(a.href)
  }
  async function uploadSettings(file: File | undefined) {
    if (!file) return
    try { set(importSettings(await file.text())); pushToast('success', 'Settings imported.') } catch (err) { pushToast('error', err instanceof Error ? err.message : String(err)) }
  }

  return (
    <SpotlightCard className="mt-4 p-4" >
      <div data-testid="quick-video" className="space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h3 className="text-sm font-semibold"><ShinyText>Quick video</ShinyText> <span className="text-muted font-normal">— topic to editable timeline</span></h3>
            <p className="mt-1 max-w-2xl text-xs text-muted">Script → search terms → stock footage → offline voiceover → subtitles → music → timeline. Run it all or edit any step; the result is ordinary Studio clips.</p>
          </div>
          <div className="flex gap-1.5">
            <Button size="sm" variant="outline" onClick={downloadSettings}><Download size={12} /> Export settings</Button>
            <label className="inline-flex cursor-pointer items-center gap-1 rounded-lg border border-line px-2 py-1 text-xs text-muted hover:text-text"><Upload size={12} /> Import<input type="file" accept="application/json" className="hidden" onChange={(e) => void uploadSettings(e.target.files?.[0])} /></label>
          </div>
        </div>

        <div className="flex flex-wrap justify-between gap-2 rounded-lg border border-line bg-panel-alt/30 px-3 py-2" aria-label="Pipeline progress">
          {STEPS.map((st) => <PipelineIcon key={st.id} step={st.id} state={steps[st.id]} label={st.label} />)}
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          <div className="space-y-2">
            <label className="block text-[11px] text-muted">Topic<input className={inputCx} value={s.topic} onChange={(e) => set({ topic: e.target.value })} placeholder="e.g. Why sleep matters for focus" aria-label="Video topic" /></label>
            <div className="grid grid-cols-3 gap-2">
              <label className="text-[11px] text-muted">Language<select className={inputCx} value={s.language} onChange={(e) => set({ language: e.target.value as 'en' | 'hi' })}><option value="en">English</option><option value="hi">Hindi</option></select></label>
              <label className="text-[11px] text-muted">Paragraphs<input type="number" min={1} max={5} className={inputCx} value={s.paragraphs} onChange={(e) => set({ paragraphs: Number(e.target.value) })} /></label>
              <label className="text-[11px] text-muted">Variants<input type="number" min={1} max={5} className={inputCx} value={s.variants} onChange={(e) => set({ variants: Number(e.target.value) })} aria-label="Batch variants" /></label>
            </div>
            <label className="block text-[11px] text-muted">Extra instructions<input className={inputCx} value={s.extraPrompt} onChange={(e) => set({ extraPrompt: e.target.value })} placeholder="Tone, audience, call to action…" /></label>
            <label className="block text-[11px] text-muted">Script {estimate > 0 && <span className="tabular-nums">· ≈{estimate}s spoken</span>}
              <textarea className={`${inputCx} min-h-28`} value={s.script} onChange={(e) => set({ script: e.target.value })} placeholder="Leave empty to write one from the topic, or paste your own." aria-label="Video script" />
            </label>
            <div className="flex flex-wrap gap-1.5">
              <Button size="sm" variant="outline" disabled={!!busy} title={(!!busy) ? 'Busy — wait for the current step' : undefined} onClick={async () => { setBusy('Writing'); try { await writeScript() } catch (e) { pushToast('error', e instanceof Error ? e.message : String(e)) } finally { setBusy(null) } }}><Wand2 size={12} /> Write script</Button>
              <Button size="sm" variant="outline" disabled={!s.script.trim()} title={(!s.script.trim()) ? 'Write or generate a script first' : undefined} onClick={() => makeTerms(s.script)}>Suggest terms</Button>
              <Button size="sm" variant="ghost" onClick={() => { set({ script: '' }); setTerms([]) }}><RotateCcw size={12} /> Clear</Button>
            </div>
            <label className="block text-[11px] text-muted">Search terms (comma-separated)<input className={inputCx} value={terms.join(', ')} onChange={(e) => setTerms(e.target.value.split(',').map((t) => t.trim()).filter(Boolean))} aria-label="Search terms" /></label>
          </div>

          <div className="space-y-2">
            <div className="grid grid-cols-2 gap-2">
              <label className="text-[11px] text-muted">Format<select className={inputCx} value={s.aspect} onChange={(e) => set({ aspect: e.target.value as QuickVideoSettings['aspect'] })}>{ASPECT_PRESETS.map((a) => <option key={a.aspect} value={a.aspect}>{a.label} · {a.size}</option>)}</select></label>
              <label className="text-[11px] text-muted">Footage source<select className={inputCx} value={s.provider} onChange={(e) => set({ provider: e.target.value as QuickVideoSettings['provider'] })}><option value="openverse">Openverse (keyless)</option><option value="pexels">Pexels</option><option value="pixabay">Pixabay</option><option value="picsum">Picsum (draft)</option></select></label>
              <label className="text-[11px] text-muted">Media<select className={inputCx} value={s.mediaKind} onChange={(e) => set({ mediaKind: e.target.value as 'video' | 'image' })}><option value="image">Images</option><option value="video">Video</option></select></label>
              <label className="text-[11px] text-muted">Order<select className={inputCx} value={s.concat} onChange={(e) => set({ concat: e.target.value as 'random' | 'sequential' })}><option value="random">Shuffled (seeded)</option><option value="sequential">Script order</option></select></label>
              <label className="text-[11px] text-muted">Max clip length · {s.clipMaxSec}s<input type="range" min={1} max={10} step={0.5} value={s.clipMaxSec} onChange={(e) => set({ clipMaxSec: Number(e.target.value) })} className="w-full" /></label>
              <label className="text-[11px] text-muted">Seed<input type="number" min={1} className={inputCx} value={s.seed} onChange={(e) => set({ seed: Number(e.target.value) })} /></label>
            </div>
            <label className="flex items-center gap-2 text-[11px] text-muted"><input type="checkbox" checked={useProjectMedia} onChange={(e) => setUseProjectMedia(e.target.checked)} /> Use project media instead of stock ({projectMedia.length} clips)</label>
            <div className="grid grid-cols-2 gap-2">
              <label className="text-[11px] text-muted">Voice<select className={inputCx} value={s.voice} onChange={(e) => set({ voice: e.target.value as 'tts' | 'none' })}><option value="tts">Offline voiceover</option><option value="none">No voice</option></select></label>
              <label className="text-[11px] text-muted">Voice speed · {s.voiceRate}<input type="range" min={-5} max={5} value={s.voiceRate} onChange={(e) => set({ voiceRate: Number(e.target.value) })} className="w-full" /></label>
              <label className="text-[11px] text-muted">Music file<input type="file" accept="audio/*" className="block w-full text-[11px]" onChange={(e) => setMusic(e.target.files?.[0] ?? null)} aria-label="Background music" /></label>
              <label className="text-[11px] text-muted">Music volume · {Math.round(s.bgmVolume * 100)}%<input type="range" min={0} max={1} step={0.05} value={s.bgmVolume} onChange={(e) => set({ bgmVolume: Number(e.target.value) })} className="w-full" /></label>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <label className="flex items-center gap-2 text-[11px] text-muted"><input type="checkbox" checked={s.subtitles} onChange={(e) => set({ subtitles: e.target.checked })} /> Subtitles</label>
              <label className="text-[11px] text-muted">Style<select className={inputCx} value={s.subtitleStyle} onChange={(e) => set({ subtitleStyle: e.target.value as QuickVideoSettings['subtitleStyle'] })}><option value="standard">Standard</option><option value="hormozi">Hormozi</option><option value="minimal">Minimal</option></select></label>
              <label className="text-[11px] text-muted">Position<select className={inputCx} value={s.subtitlePosition} onChange={(e) => set({ subtitlePosition: e.target.value as QuickVideoSettings['subtitlePosition'] })}><option value="bottom">Bottom</option><option value="two-thirds">Lower third</option><option value="center">Centre</option><option value="top">Top</option><option value="custom">Custom</option></select></label>
              {s.subtitlePosition === 'custom'
                ? <label className="text-[11px] text-muted">Height · {Math.round(s.subtitleCustomY * 100)}%<input type="range" min={0.05} max={0.95} step={0.01} value={s.subtitleCustomY} onChange={(e) => set({ subtitleCustomY: Number(e.target.value) })} className="w-full" /></label>
                : <label className="text-[11px] text-muted">Colour<input type="color" className="block h-8 w-full" value={s.subtitleColor} onChange={(e) => set({ subtitleColor: e.target.value })} /></label>}
              <label className="text-[11px] text-muted">Size · {s.subtitleSizePct}%<input type="range" min={3} max={14} step={0.5} value={s.subtitleSizePct} onChange={(e) => set({ subtitleSizePct: Number(e.target.value) })} className="w-full" /></label>
              <label className="text-[11px] text-muted">Line length · {s.subtitleMaxChars}<input type="range" min={12} max={60} value={s.subtitleMaxChars} onChange={(e) => set({ subtitleMaxChars: Number(e.target.value) })} className="w-full" /></label>
            </div>
            <label className="flex items-start gap-2 text-[11px] text-muted">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={s.wordTimings}
                disabled={!s.subtitles || s.voice === 'none'}
                title={(!s.subtitles || s.voice === 'none') ? 'Needs subtitles and a generated voiceover' : undefined}
                onChange={(e) => set({ wordTimings: e.target.checked })}
                aria-label="Real word timings"
              />
              <span>
                Real word timings — transcribe the voiceover so each caption lands on the word that was spoken
                {getIpc() ? ' (offline Whisper, one extra pass over the voiceover)' : ' (desktop only; this build estimates the timings from the script and labels them that way)'}
              </span>
            </label>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Button variant="primary" disabled={!!busy || !project || (!s.topic.trim() && !s.script.trim())} title={(!!busy || !project || (!s.topic.trim() && !s.script.trim())) ? 'Open a project and enter a topic or script — or wait for the current step' : undefined} onClick={() => void runAll()} data-testid="quick-video-run"><Play size={13} /> Build timeline</Button>
          {busy && <span className="flex items-center gap-2 text-xs text-muted"><MatrixLoader variant="scan" label={busy} /> {busy}…</span>}
          <span className="text-[10px] text-muted">Replaces the current timeline as one undo step. Nothing is exported or published automatically.</span>
        </div>

        {log.length > 0 && <ul className="space-y-0.5 rounded-lg border border-line bg-panel-alt/30 px-3 py-2 text-[11px] text-muted" role="log">{log.map((l, i) => <li key={i}>{l}</li>)}</ul>}

        {history.length > 0 && (
          <details>
            <summary className="flex cursor-pointer items-center gap-1 text-xs text-muted hover:text-text"><History size={12} /> Task history ({history.length})</summary>
            <ul className="mt-2 space-y-1">
              {history.map((t) => (
                <li key={t.id} className="flex flex-wrap items-center gap-2 rounded-md border border-line px-2 py-1 text-[11px]">
                  <Badge tone={t.status === 'done' ? 'accent' : 'danger'}>{t.status}</Badge>
                  <span className="text-text">{t.topic}</span>
                  <span className="text-muted">{t.clips} clips · {t.durationSec}s · {t.note}</span>
                  <Button size="sm" variant="ghost" className="ml-auto" onClick={() => set(t.settings)}>Reuse settings</Button>
                </li>
              ))}
            </ul>
          </details>
        )}
        <p className="text-[10px] text-muted">Pipeline design after <a className="underline" href={QUICK_VIDEO_SOURCE.url} target="_blank" rel="noreferrer">{QUICK_VIDEO_SOURCE.name}</a> ({QUICK_VIDEO_SOURCE.attribution}, {QUICK_VIDEO_SOURCE.license}); concepts reimplemented in TypeScript.</p>
      </div>
    </SpotlightCard>
  )
}
