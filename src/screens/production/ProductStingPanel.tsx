/**
 * Product Sting — fill in the inputs, check four stills, then scrub/play the
 * whole 12 s film, download it (HTML + WAV) or add it to the project as a
 * renderable motion piece. The preview, stills and export share one renderer.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { Download, Film, Palette, Plus, Upload } from 'lucide-react'
import interWoff2 from '@fontsource-variable/inter/files/inter-latin-wght-normal.woff2?url'
import { Button } from '../../components/Button'
import { Badge } from '../../components/Badge'
import { SpotlightCard, ShinyText } from '../../components/fx'
import { importArenaZip } from '../../lib/arena'
import { useActiveProject, useProjectStore } from '../../state/useProjectStore'
import { DEFAULT_STING, STING, buildStingHtml, isBannedHue, paletteFor, sanitizeSting, stingProgram, type StingInputs } from '../../lib/stings/productSting'
import { encodeWav16, renderStingAudio } from '../../lib/stings/stingAudio'

const KEY = 'cupric.productSting'
const inputCx = 'cu-input w-full'
const mk = (w: number, h: number) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c }
const FONT = "'Inter Variable', Inter, system-ui, sans-serif"

/** Pull up to three saturated brand colours from a logo (skips banned hues). */
function coloursFromImage(img: HTMLImageElement): string[] {
  const c = mk(64, 64), x = c.getContext('2d')!
  x.drawImage(img, 0, 0, 64, 64)
  const d = x.getImageData(0, 0, 64, 64).data
  const buckets = new Map<number, { n: number; r: number; g: number; b: number }>()
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] < 200) continue
    const r = d[i], g = d[i + 1], b = d[i + 2], max = Math.max(r, g, b), min = Math.min(r, g, b)
    if (max - min < 40 || max < 50) continue
    const key = (r >> 5) * 64 + (g >> 5) * 8 + (b >> 5)
    const e = buckets.get(key) ?? { n: 0, r: 0, g: 0, b: 0 }
    e.n++; e.r += r; e.g += g; e.b += b; buckets.set(key, e)
  }
  return [...buckets.values()].sort((a, b) => b.n - a.n)
    .map((e) => '#' + [e.r, e.g, e.b].map((v) => Math.round(v / e.n).toString(16).padStart(2, '0')).join(''))
    .filter((h) => !isBannedHue(h)).slice(0, 3)
}
async function fileToDataUrl(file: File): Promise<string> {
  return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = rej; r.readAsDataURL(file) })
}
async function decodeMusic(file: File): Promise<{ left: Float32Array; right: Float32Array }> {
  const buf = await file.arrayBuffer()
  const ctx = new OfflineAudioContext(2, 48000 * 30, 48000)
  const audio = await ctx.decodeAudioData(buf)
  const off = new OfflineAudioContext(2, Math.min(audio.length, 48000 * 30) * Math.ceil(48000 / audio.sampleRate), 48000)
  const src = off.createBufferSource(); src.buffer = audio; src.connect(off.destination); src.start()
  const r = await off.startRendering()
  return { left: r.getChannelData(0), right: r.numberOfChannels > 1 ? r.getChannelData(1) : r.getChannelData(0) }
}

export function ProductStingPanel() {
  const project = useActiveProject()
  const addArenaAsset = useProjectStore((s) => s.addArenaAsset)
  const pushToast = useProjectStore((s) => s.pushToast)
  const [inputs, setInputs] = useState<StingInputs>(() => { try { return sanitizeSting(JSON.parse(localStorage.getItem(KEY) || '{}')) } catch { return DEFAULT_STING } })
  const [logo, setLogo] = useState<HTMLImageElement | null>(null)
  const [frame, setFrame] = useState(40)
  const [playing, setPlaying] = useState(false)
  const [stillsOk, setStillsOk] = useState(false)
  const [music, setMusic] = useState<{ left: Float32Array; right: Float32Array } | null>(null)
  const [musicOffset, setMusicOffset] = useState(0)
  const [busy, setBusy] = useState<string | null>(null)
  const stillRefs = useRef<Array<HTMLCanvasElement | null>>([])
  const mainRef = useRef<HTMLCanvasElement | null>(null)
  const { palette, rejected } = useMemo(() => paletteFor(inputs), [inputs])
  const program = useMemo(() => stingProgram(inputs, palette, { makeCanvas: mk, font: FONT, logo }), [inputs, palette, logo])

  const set = (patch: Partial<StingInputs>) => setInputs((prev) => { const next = sanitizeSting({ ...prev, ...patch }); try { localStorage.setItem(KEY, JSON.stringify({ ...next, logoDataUrl: next.logoDataUrl && next.logoDataUrl.length < 400000 ? next.logoDataUrl : null })) } catch { /* quota */ } setStillsOk(false); return next })

  useEffect(() => {
    if (!inputs.logoDataUrl) { setLogo(null); return }
    const im = new Image(); im.onload = () => setLogo(im); im.src = inputs.logoDataUrl
  }, [inputs.logoDataUrl])

  useEffect(() => {
    let alive = true
    void document.fonts?.ready.then(() => {
      if (!alive) return
      STING.stills.forEach((f, i) => { const c = stillRefs.current[i]; if (c) program.seek(c.getContext('2d'), f) })
    })
    return () => { alive = false }
  }, [program])

  useEffect(() => { const c = mainRef.current; if (c) program.seek(c.getContext('2d'), frame) }, [program, frame])

  // Playback steps the frame number; what is drawn is still a pure function of that number.
  useEffect(() => {
    if (!playing) return
    let raf = 0, start: number | null = null, from = frame
    const tick = (now: number) => {
      if (start === null) start = now
      const f = from + ((now - start) / 1000) * STING.fps
      if (f >= 359.99) { setFrame(359); setPlaying(false); return }
      setFrame(f); raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing])

  async function htmlText() {
    const res = await fetch(interWoff2); const b = new Uint8Array(await res.arrayBuffer())
    let bin = ''; for (let i = 0; i < b.length; i += 0x8000) bin += String.fromCharCode(...b.subarray(i, i + 0x8000))
    return buildStingHtml(inputs, { fontDataUrl: `data:font/woff2;base64,${btoa(bin)}` })
  }
  const save = (blob: Blob, name: string) => { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000) }
  const slug = inputs.product.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'product'

  async function downloadAudio() {
    setBusy('Mixing sound')
    await new Promise((r) => setTimeout(r, 20))
    try {
      const mix = renderStingAudio({ music, musicOffsetSec: musicOffset })
      save(new Blob([encodeWav16(mix.left, mix.right)], { type: 'audio/wav' }), `${slug}-sting.wav`)
      pushToast('success', `Sound mastered: ${mix.lufs.toFixed(1)} LUFS, ${mix.truePeak.toFixed(1)} dBTP, 12.075 s.`)
    } finally { setBusy(null) }
  }
  async function addToProject() {
    if (!project) { pushToast('info', 'Open a project first.'); return }
    setBusy('Adding to project')
    try {
      const file = new File([await htmlText()], `${slug}-sting.html`, { type: 'text/html' })
      const res = await importArenaZip(file, project.id, () => undefined)
      addArenaAsset(project.id, { name: `${inputs.product} — product sting`, status: 'imported', prompt: 'Product sting recipe (12 s, 1080×1080)', htmlFileName: res.htmlFileName, thumbnailDataUrl: res.thumbnailDataUrl ?? stillRefs.current[0]?.toDataURL('image/jpeg', 0.8) ?? null, localPath: res.localPath ?? null })
      pushToast('success', 'Sting added as a motion piece — render it from the Render screen, then add the WAV.')
    } catch (err) { pushToast('error', err instanceof Error ? err.message : String(err)) } finally { setBusy(null) }
  }

  const field = (label: string, key: keyof StingInputs, max = 60) => (
    <label className="block text-[11px] text-muted">{label}<input className={inputCx} maxLength={max} value={String(inputs[key] ?? '')} onChange={(e) => set({ [key]: e.target.value } as Partial<StingInputs>)} /></label>
  )

  return (
    <SpotlightCard className="mt-4 p-4">
      <div className="space-y-3" data-testid="product-sting">
        <div>
          <h3 className="text-sm font-semibold"><ShinyText>Product sting</ShinyText> <span className="font-normal text-muted">— 12 s square keynote-style film</span></h3>
          <p className="mt-1 max-w-2xl text-xs text-muted">Header in the hub window → cursor click → app icon and orbit → menu bar and frosted prompt → answer page → cards → logo → end card. Fill what you have; anything empty uses the defaults. Check the four stills before playing the full film.</p>
        </div>

        <div className="grid gap-3 md:grid-cols-3">
          <div className="space-y-2">
            {field('Product name', 'product', 40)}
            {field('Hub (the dark pill says “on …”)', 'hub', 20)}
            <div className="flex items-end gap-2">
              <label className="flex-1 text-[11px] text-muted">Logo (optional)<input type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" className="block w-full text-[11px]" onChange={async (e) => { const f = e.target.files?.[0]; if (f) set({ logoDataUrl: await fileToDataUrl(f) }) }} /></label>
              {inputs.logoDataUrl && <Button size="sm" variant="ghost" onClick={() => set({ logoDataUrl: null })}>Use mark</Button>}
            </div>
            {!inputs.logoDataUrl && field('Mark letters (viewfinder mark)', 'markText', 3)}
            <div className="flex flex-wrap items-center gap-1.5">
              {[0, 1, 2].map((i) => <input key={i} type="color" aria-label={`Brand colour ${i + 1}`} className="h-8 w-10" value={inputs.brandColors[i] ?? [palette.a1, palette.a2, palette.a3][i]} onChange={(e) => { const c = [...inputs.brandColors]; c[i] = e.target.value; set({ brandColors: c }) }} />)}
              <Button size="sm" variant="outline" disabled={!logo} onClick={() => { if (logo) { const c = coloursFromImage(logo); set({ brandColors: c }); pushToast('info', c.length ? `Pulled ${c.join(', ')}` : 'No usable colours in that logo.') } }}><Palette size={12} /> From logo</Button>
              <Button size="sm" variant="ghost" onClick={() => set({ brandColors: [] })}>Default blues</Button>
            </div>
            {rejected.length > 0 && <p className="text-[11px] text-danger">Skipped {rejected.join(', ')} — the style bans purple, violet, magenta and orange.</p>}
          </div>
          <div className="space-y-2">
            {field('What the user types', 'prompt', 60)}
            {field('Answer page title', 'pageTitle', 48)}
            <label className="block text-[11px] text-muted">Answer page (2–3 sentences)<textarea className={`${inputCx} min-h-20`} maxLength={400} value={inputs.pageBody} onChange={(e) => set({ pageBody: e.target.value })} /></label>
            {field('Key phrase (must appear in the page)', 'keyPhrase', 60)}
          </div>
          <div className="space-y-2">
            <div className="grid grid-cols-2 gap-2">
              <label className="text-[11px] text-muted">Card 1<input className={inputCx} maxLength={14} value={inputs.cards[0]} onChange={(e) => set({ cards: [e.target.value, inputs.cards[1]] })} /></label>
              <label className="text-[11px] text-muted">Card 2<input className={inputCx} maxLength={14} value={inputs.cards[1]} onChange={(e) => set({ cards: [inputs.cards[0], e.target.value] })} /></label>
            </div>
            <label className="block text-[11px] text-muted">Music track (optional — otherwise a synthesized 124 BPM groove)
              <input type="file" accept="audio/*" className="block w-full text-[11px]" onChange={async (e) => { const f = e.target.files?.[0]; if (!f) return; try { setMusic(await decodeMusic(f)); set({ music: f.name }) } catch { pushToast('error', 'Could not decode that audio file.') } }} />
            </label>
            {music && <label className="block text-[11px] text-muted">Start the track at · {musicOffset.toFixed(2)} s (line its drop up with 2.47 s)<input type="range" min={0} max={20} step={0.01} value={musicOffset} onChange={(e) => setMusicOffset(Number(e.target.value))} className="w-full" /></label>}
            <p className="text-[10px] text-muted">The default Mixkit track (“Rising Forest”) is not bundled. Download it yourself under Mixkit’s free licence and add it here; tempo changes aren’t applied automatically.</p>
          </div>
        </div>

        <div>
          <div className="mb-1 flex items-center gap-2 text-xs font-medium">Stills <Badge tone={stillsOk ? 'accent' : 'info'}>{stillsOk ? 'approved' : 'check these first'}</Badge></div>
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            {STING.stills.map((f, i) => (
              <button key={f} type="button" onClick={() => setFrame(f)} className="overflow-hidden rounded-lg border border-line text-left hover:border-accent">
                <canvas ref={(el) => { stillRefs.current[i] = el }} width={540} height={540} className="block aspect-square w-full" />
                <span className="block px-2 py-1 text-[10px] text-muted">f{f} · {['header in the window', 'icon cross', 'finished prompt', 'two cards'][i]}</span>
              </button>
            ))}
          </div>
          {!stillsOk && <Button size="sm" variant="primary" className="mt-2" onClick={() => setStillsOk(true)}>Stills look right — show the full film</Button>}
        </div>

        {stillsOk && (
          <div className="grid gap-3 md:grid-cols-[minmax(0,420px)_1fr]">
            <canvas ref={mainRef} width={720} height={720} className="aspect-square w-full rounded-lg border border-line" aria-label="Sting preview" />
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Button size="sm" variant="outline" onClick={() => { if (frame >= 359) setFrame(0); setPlaying((p) => !p) }}>{playing ? 'Pause' : 'Play'}</Button>
                <span className="font-mono text-xs tabular-nums text-muted">f{frame.toFixed(1)} · {(frame / STING.fps).toFixed(2)} s</span>
              </div>
              <input type="range" min={0} max={359} step={0.5} value={frame} onChange={(e) => { setPlaying(false); setFrame(Number(e.target.value)) }} className="w-full" aria-label="Frame" />
              <div className="flex flex-wrap gap-1 text-[10px] text-muted">{STING.cuts.map((c) => <button key={c} type="button" className="rounded border border-line px-1.5 py-0.5 hover:text-text" onClick={() => setFrame(c)}>cut f{c}</button>)}</div>
              <div className="flex flex-wrap gap-1.5 pt-1">
                <Button size="sm" variant="primary" disabled={!!busy} onClick={() => void addToProject()}><Plus size={12} /> Add to project</Button>
                <Button size="sm" variant="outline" disabled={!!busy} onClick={async () => save(new Blob([await htmlText()], { type: 'text/html' }), `${slug}-sting.html`)}><Film size={12} /> Download HTML</Button>
                <Button size="sm" variant="outline" disabled={!!busy} onClick={() => void downloadAudio()}><Download size={12} /> Download sound (WAV)</Button>
              </div>
              {busy && <p className="text-[11px] text-muted">{busy}…</p>}
              <p className="text-[10px] text-muted">The HTML defines window.__seek(t), so the desktop Render queue captures it frame by frame. Sound is mastered to −14 LUFS, −1 dBTP. <Upload size={10} className="inline" /> Nothing is published.</p>
            </div>
          </div>
        )}
      </div>
    </SpotlightCard>
  )
}
