/**
 * Inspector for Home_X kit clips. Every control patches the clip through
 * onPatch, so edits are one undo step each and saved with the project.
 */
import type { StudioClip, StudioDoc, StudioKitClip, StudioKitMedia, StudioMediaClip } from '../../types/project'
import { KIT_ACCENTS, KIT_KINDS, kineticWords, normaliseKit } from '../../lib/studio/homeKit'
import type { StudioKitWord } from '../../types/project'

const inputCx = 'w-full cu-input px-2.5 py-1.5 text-sm text-text'

function Row({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <label className="block space-y-1">
      <span className="text-xs font-medium text-muted">{label}</span>
      {children}
      {hint && <span className="block text-xs text-muted">{hint}</span>}
    </label>
  )
}

export function KitFields({ clip: raw, doc, onPatch }: { clip: StudioKitClip; doc: StudioDoc; onPatch: (p: Partial<StudioClip>) => void }) {
  const clip = normaliseKit(raw)
  const set = (p: Partial<StudioKitClip>) => onPatch(p as Partial<StudioClip>)
  const info = KIT_KINDS.find((k) => k.id === clip.kit)!
  const photos = doc.clips.filter((c): c is StudioMediaClip => c.kind === 'image' || c.kind === 'video')
  const takesMedia = clip.kit === 'image-stack'
  const slots: StudioKitMedia[] = clip.media?.length ? clip.media : clip.variant === 'stack' ? [null, null, null] : [null]
  const setSlot = (i: number, mediaId: string) => {
    const next = [...slots]
    const src = photos.find((p) => p.mediaId === mediaId)
    next[i] = src ? { mediaId: src.mediaId, fileName: src.fileName } : null
    set({ media: next })
  }
  return (
    <div className="space-y-3">
      <p className="text-xs text-muted">{info.name} — {info.use} Preview and export draw the same frames.</p>
      {info.variants.length > 1 && (
        <Row label="Look">
          <select className={inputCx} value={clip.variant} onChange={(e) => set({ variant: e.target.value })}>
            {info.variants.map((v) => <option key={v} value={v}>{v}</option>)}
          </select>
        </Row>
      )}
      <Row label="Title"><input className={inputCx} value={clip.title ?? ''} onChange={(e) => set({ title: e.target.value })} /></Row>
      <Row label="Subtitle / label"><input className={inputCx} value={clip.subtitle ?? ''} onChange={(e) => set({ subtitle: e.target.value })} /></Row>
      {(clip.kit === 'stat-card' || clip.kit === 'browser-mockup') && (
        <Row label="Eyebrow"><input className={inputCx} value={clip.eyebrow ?? ''} onChange={(e) => set({ eyebrow: e.target.value })} /></Row>
      )}
      {(clip.kit === 'browser-mockup' || clip.kit === 'checkout-card') && (
        <Row label="URL"><input className={inputCx} value={clip.url ?? ''} onChange={(e) => set({ url: e.target.value })} /></Row>
      )}
      {clip.kit !== 'cursor-zoom' && clip.kit !== 'image-stack' && clip.kit !== 'block-row-3d' && clip.kit !== 'kinetic-headline' && (
        <Row label="Items (one per line)" hint={clip.kit === 'checkout-card' ? 'Line 1 price, line 2 total, then "Label|Value" summary rows — your real numbers only.' : 'Your own words and numbers — nothing is invented.'}>
          <textarea className={inputCx} rows={4} value={(clip.items ?? []).join('\n')} onChange={(e) => set({ items: e.target.value.split('\n') })} />
        </Row>
      )}
      {(clip.kit === 'rating-bars' || clip.kit === 'block-row-3d') && (
        <Row label={clip.kit === 'rating-bars' ? 'Values % (comma-separated)' : 'Block count'}>
          <input className={`${inputCx} font-mono tabular-nums`} value={(clip.values ?? []).join(', ')} onChange={(e) => set({ values: e.target.value.split(',').map((v) => Number(v.trim())).filter((v) => Number.isFinite(v)) })} />
        </Row>
      )}
      {(clip.kit === 'pill-text' || clip.kit === 'stat-card' || clip.kit === 'browser-mockup') && (
        <Row label="Active item" hint="Index from 0; stat cards use 1 for the green active tint.">
          <input type="number" className={`${inputCx} font-mono tabular-nums`} value={clip.active ?? 0} onChange={(e) => set({ active: Number(e.target.value) })} />
        </Row>
      )}
      {clip.kit === 'kinetic-headline' && <KineticWords clip={clip} set={set} />}
      {clip.kit === 'block-row-3d' && (
        <div className="space-y-1">
          <label className="flex items-center gap-2 text-xs text-muted">
            <input type="checkbox" checked={clip.real3d === true} onChange={(e) => set({ real3d: e.target.checked || undefined })} />
            Real 3D (Three.js)
          </label>
          <p className="text-xs text-muted">
            {clip.real3d ? 'Rendered with Three.js (loaded on demand) in both preview and export. Until it loads — or if this device has no WebGL — the deterministic 2.5D draw is shown, and export tells you if it had to fall back.' : 'Drawn as 2.5D perspective on the shared canvas — identical in preview and export.'}
          </p>
        </div>
      )}
      {takesMedia && (
        <div className="space-y-1">
          <span className="text-xs font-medium text-muted">Photo slots</span>
          {!photos.length && <p className="text-xs text-muted">Add images or footage to the timeline first — empty slots stay visible as “drop media here”.</p>}
          {slots.map((m, i) => (
            <select key={i} className={inputCx} aria-label={`Photo slot ${i + 1}`} value={m?.mediaId ?? ''} onChange={(e) => setSlot(i, e.target.value)}>
              <option value="">Slot {i + 1}: empty (drop media here)</option>
              {photos.map((p) => <option key={p.id} value={p.mediaId}>{p.fileName}</option>)}
            </select>
          ))}
          {clip.variant === 'stack' && slots.length < 8 && <button type="button" className="text-xs text-accent-text underline" onClick={() => set({ media: [...slots, null] })}>Add slot</button>}
        </div>
      )}
      <Row label="Accent">
        <select className={inputCx} value={clip.accent} onChange={(e) => set({ accent: e.target.value })}>
          {KIT_ACCENTS.map((a) => <option key={a.id} value={a.color}>{a.label}</option>)}
        </select>
      </Row>
      <Row label="Surface">
        <select className={inputCx} value={clip.theme} onChange={(e) => set({ theme: e.target.value as 'light' | 'dark' })}>
          <option value="light">Light</option>
          <option value="dark">Dark</option>
        </select>
      </Row>
      <label className="flex items-center gap-2 text-xs text-muted">
        <input type="checkbox" checked={clip.scrim === null} onChange={(e) => set({ scrim: e.target.checked ? null : 0.55 })} />
        Auto scrim behind text on photos
      </label>
      {clip.scrim !== null && (
        <label className="flex items-center gap-2 text-xs">
          <span className="w-24 shrink-0 font-medium text-muted">Scrim</span>
          <input type="range" min={0} max={1} step={0.05} value={clip.scrim} onChange={(e) => set({ scrim: Number(e.target.value) })} className="min-w-0 flex-1" aria-label="Scrim strength" />
          <span className="w-12 text-right font-mono tabular-nums text-text">{Math.round(clip.scrim * 100)}%</span>
        </label>
      )}
      <label className="flex items-center gap-2 text-xs text-muted">
        <input type="checkbox" checked={clip.reducedMotion} onChange={(e) => set({ reducedMotion: e.target.checked })} />
        Reduced motion (opacity-only)
      </label>
      <Row label="Layout seed" hint="Changes the deterministic jitter (stack rotation, drift). Same seed → same frames.">
        <input type="number" className={`${inputCx} font-mono tabular-nums`} value={clip.seed} onChange={(e) => set({ seed: Math.max(0, Math.round(Number(e.target.value) || 0)) })} />
      </Row>
    </div>
  )
}

const WEIGHTS = [400, 500, 600, 700, 800] as const
const STYLES = ['plain', 'keyword', 'chip', 'glow'] as const

/** Per-word editor: colour, weight, entrance delay and style for each word. */
function KineticWords({ clip, set }: { clip: StudioKitClip; set: (p: Partial<StudioKitClip>) => void }) {
  const explicit = Boolean(clip.words?.length)
  const words = kineticWords(clip)
  const patchWord = (i: number, p: Partial<StudioKitWord>) => {
    const base: StudioKitWord[] = words.map((w) => ({ text: w.text, style: w.style, weight: w.weight, delay: w.delay, color: w.color === 'accent-of-clip' ? undefined : w.color }))
    base[i] = { ...base[i], ...p }
    set({ words: base })
  }
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-muted">Words</span>
        {explicit && <button type="button" className="text-xs text-accent-text underline" onClick={() => set({ words: undefined })}>Reset to title</button>}
      </div>
      {!explicit && <p className="text-xs text-muted">Parsed from the title: [keyword] {'{chip}'} *glow*. Edit any word below to take full control.</p>}
      {words.map((w, i) => (
        <div key={i} className="grid grid-cols-[1fr_auto_auto_auto_auto] items-center gap-1">
          <input className="min-w-0 cu-input px-2 py-1 text-xs" aria-label={`Word ${i + 1}`} value={w.text} onChange={(e) => patchWord(i, { text: e.target.value })} />
          <select className="cu-input px-1 py-1 text-xs" aria-label={`Word ${i + 1} style`} value={w.style} onChange={(e) => patchWord(i, { style: e.target.value as StudioKitWord['style'] })}>
            {STYLES.map((st) => <option key={st} value={st}>{st}</option>)}
          </select>
          <select className="cu-input px-1 py-1 text-xs" aria-label={`Word ${i + 1} colour`} value={w.color === 'accent-of-clip' ? '' : w.color} onChange={(e) => patchWord(i, { color: e.target.value || undefined })}>
            <option value="">Accent</option>
            <option value="text">Text</option>
            {KIT_ACCENTS.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
          </select>
          <select className="cu-input px-1 py-1 text-xs" aria-label={`Word ${i + 1} weight`} value={w.weight} onChange={(e) => patchWord(i, { weight: Number(e.target.value) as StudioKitWord['weight'] })}>
            {WEIGHTS.map((wt) => <option key={wt} value={wt}>{wt}</option>)}
          </select>
          <input type="number" min={0} max={60} step={0.05} className="w-16 cu-input px-1 py-1 font-mono text-xs tabular-nums" aria-label={`Word ${i + 1} delay in seconds`} value={w.delay} onChange={(e) => patchWord(i, { delay: Math.max(0, Number(e.target.value) || 0) })} />
        </div>
      ))}
    </div>
  )
}
