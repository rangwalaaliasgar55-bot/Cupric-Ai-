/**
 * Inspector for loader clips (Transitions.dev thinking states + matrix dots).
 * Every control edits a clip prop through onPatch, so edits go through the
 * store's undo history and are saved with the project.
 */
import type { StudioClip, StudioLoaderClip, StudioLoaderEase, StudioLoaderVariant } from '../../types/project'
import { LOADER_EASES, LOADER_PRESETS, MATRIX_VARIANTS, loaderLoopSec, normaliseLoader } from '../../lib/studio/loaders'

const inputCx = 'w-full cu-input px-2.5 py-1.5 text-sm text-text'

function Row({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <label className="block space-y-1">
      <span className="text-xs font-medium text-muted">{label}</span>
      {children}
      {hint && <span className="block text-xs text-muted/80">{hint}</span>}
    </label>
  )
}

function Range({ label, value, min, max, step, suffix, onChange }: { label: string; value: number; min: number; max: number; step: number; suffix?: string; onChange: (v: number) => void }) {
  return (
    <label className="flex items-center gap-2 text-xs">
      <span className="w-24 shrink-0 font-medium text-muted">{label}</span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} className="min-w-0 flex-1" aria-label={label} />
      <span className="w-16 text-right font-mono tabular-nums text-text">{Math.round(value * 1000) / 1000}{suffix}</span>
    </label>
  )
}

function Swatch({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="flex items-center gap-2 text-xs text-muted">
      <input type="color" value={value} onChange={(e) => onChange(e.target.value)} className="h-6 w-6 rounded border border-line bg-transparent" aria-label={label} />
      {label}
    </label>
  )
}

export function LoaderFields({ clip: raw, onPatch }: { clip: StudioLoaderClip; onPatch: (p: Partial<StudioClip>) => void }) {
  const clip = normaliseLoader(raw)
  const set = (p: Partial<StudioLoaderClip>) => onPatch(p as Partial<StudioClip>)
  const loop = loaderLoopSec(clip)
  const preset = LOADER_PRESETS.find((p) => p.id === clip.presetId)
  return (
    <div className="space-y-3">
      <p className="text-xs text-muted">
        {preset ? `${preset.name} — ` : ''}Transitions.dev {clip.loader === 'matrix' ? 'matrix dot loader' : 'thinking states'}, rebuilt as a native clip. Preview and export draw the same frames.
      </p>
      <Row label="Loader">
        <select className={inputCx} value={clip.loader} onChange={(e) => set({ loader: e.target.value as StudioLoaderClip['loader'] })}>
          <option value="thinking">Thinking states</option>
          <option value="matrix">Matrix dot loader</option>
        </select>
      </Row>

      {clip.loader === 'thinking' ? (
        <>
          <Row label="Status lines (one per line)" hint="Use the real steps of your video — never invented results.">
            <textarea
              className={`${inputCx} min-h-[72px]`}
              value={clip.states.join('\n')}
              onChange={(e) => set({ states: e.target.value.split('\n').map((s) => s.slice(0, 80)) })}
              onBlur={(e) => set({ states: e.target.value.split('\n').map((s) => s.trim()).filter(Boolean) })}
            />
          </Row>
          <Range label="Hold" value={clip.holdMs} min={200} max={8000} step={50} suffix="ms" onChange={(v) => set({ holdMs: v })} />
          <Range label="Swap" value={clip.swapMs} min={0} max={1500} step={10} suffix="ms" onChange={(v) => set({ swapMs: v })} />
          <Range label="Gap" value={clip.gapMs} min={0} max={1000} step={10} suffix="ms" onChange={(v) => set({ gapMs: v })} />
          <Range label="Distance" value={clip.distancePx} min={0} max={60} step={1} suffix="px" onChange={(v) => set({ distancePx: v })} />
          <Range label="Blur" value={clip.blurPx} min={0} max={16} step={0.5} suffix="px" onChange={(v) => set({ blurPx: v })} />
          <label className="flex items-center gap-2 text-xs text-muted">
            <input type="checkbox" checked={clip.shimmer} onChange={(e) => set({ shimmer: e.target.checked })} /> Shimmer
          </label>
          {clip.shimmer && <Range label="Shimmer" value={clip.shimmerMs} min={300} max={8000} step={50} suffix="ms" onChange={(v) => set({ shimmerMs: v })} />}
          <div className="grid grid-cols-2 gap-2">
            <Swatch label="Base" value={clip.baseColor} onChange={(v) => set({ baseColor: v })} />
            <Swatch label="Highlight" value={clip.highlightColor} onChange={(v) => set({ highlightColor: v })} />
          </div>
          <Range label="Text size" value={clip.size} min={0.01} max={0.2} step={0.002} onChange={(v) => set({ size: v })} />
        </>
      ) : (
        <>
          <Row label="Variant">
            <select className={inputCx} value={clip.variant} onChange={(e) => set({ variant: e.target.value as StudioLoaderVariant })}>
              {MATRIX_VARIANTS.map((v) => <option key={v} value={v}>{v}</option>)}
            </select>
          </Row>
          <label className="flex items-center gap-2 text-xs text-muted">
            <input type="checkbox" checked={clip.rounded} onChange={(e) => set({ rounded: e.target.checked })} /> Rounded (drop corners)
          </label>
          <Range label="Cycle" value={clip.cycleMs} min={200} max={6000} step={50} suffix="ms" onChange={(v) => set({ cycleMs: v })} />
          <div className="grid grid-cols-2 gap-2">
            <Swatch label="Base" value={clip.baseColor} onChange={(v) => set({ baseColor: v })} />
            <Swatch label="Active" value={clip.activeColor} onChange={(v) => set({ activeColor: v })} />
          </div>
          <Range label="Cell size" value={clip.size} min={0.002} max={0.06} step={0.001} onChange={(v) => set({ size: v })} />
          <Row label="Accessible label">
            <input className={inputCx} value={clip.label} onChange={(e) => set({ label: e.target.value })} />
          </Row>
          <label className="flex items-center gap-2 text-xs text-muted">
            <input type="checkbox" checked={clip.backdrop} onChange={(e) => set({ backdrop: e.target.checked })} /> Full-screen backdrop
          </label>
        </>
      )}

      <Row label="Easing">
        <select className={inputCx} value={clip.ease} onChange={(e) => set({ ease: e.target.value as StudioLoaderEase })}>
          {Object.entries(LOADER_EASES).map(([id, e]) => <option key={id} value={id}>{e.label}</option>)}
        </select>
      </Row>
      <Range label="Speed" value={clip.speed} min={0.25} max={4} step={0.05} suffix="×" onChange={(v) => set({ speed: v })} />
      <div className="grid grid-cols-2 gap-2">
        <label className="flex items-center gap-2 text-xs text-muted">
          <input type="checkbox" checked={clip.loop} onChange={(e) => set({ loop: e.target.checked })} /> Loop
        </label>
        <label className="flex items-center gap-2 text-xs text-muted" title="Exports the still version: instant swaps, no blur, no shimmer, no pulsing.">
          <input type="checkbox" checked={clip.reducedMotion} onChange={(e) => set({ reducedMotion: e.target.checked })} /> Reduced motion
        </label>
      </div>
      <button
        type="button"
        className="w-full rounded-lg border border-line px-2.5 py-1.5 text-xs text-muted hover:bg-panel-alt hover:text-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
        onClick={() => set({ durationSec: Math.max(0.5, Math.round(loop * 100) / 100) })}
      >
        Fit clip to one loop ({loop.toFixed(2)}s)
      </button>
    </div>
  )
}
