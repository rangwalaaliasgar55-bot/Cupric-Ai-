import { useEffect, useState } from 'react'
import type { ComponentConfig } from '../../lab/framecn/customizer-config'
import type { StudioOverlayClip, StudioClip, StudioCursorClip, StudioDoc, StudioShapeAnim, StudioShapeClip, StudioTextClip } from '../../types/project'
import { SHAPES, shapeById } from '../../lib/studio/shapes'
import { cursorNeeded } from '../../lib/studio/cursor'
import { RICH_DEFAULTS, RICH_PRESETS } from '../../lib/studio/richText'
import { cx } from '../../lib/utils'

const inputCx = 'w-full cu-input px-2.5 py-1.5 text-sm text-text'

function Row({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <label className="block space-y-1">
      <span className="text-xs font-medium text-muted">{label}</span>
      {children}
      {hint && <span className="block text-[11px] text-muted/80">{hint}</span>}
    </label>
  )
}

function Range({ label, value, min, max, step, suffix, onChange }: { label: string; value: number; min: number; max: number; step: number; suffix?: string; onChange: (v: number) => void }) {
  return (
    <label className="flex items-center gap-2 text-xs">
      <span className="w-24 shrink-0 font-medium text-muted">{label}</span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} className="min-w-0 flex-1" aria-label={label} />
      <span className="w-14 text-right font-mono tabular-nums text-text">{Math.round(value * 100) / 100}{suffix}</span>
    </label>
  )
}

/** 3D for ANY clip: tilt about X, turn about Y, perspective — also keyframeable. */
export function ThreeDFields({ clip, onPatch }: { clip: StudioClip; onPatch: (p: Partial<StudioClip>) => void }) {
  const on = Math.abs(clip.tiltX ?? 0) > 0.05 || Math.abs(clip.turnY ?? 0) > 0.05
  const presets: Array<[string, number, number, number]> = [['Flat', 0, 0, 1600], ['Lean back', 22, 0, 1400], ['Turn left', 0, -28, 1400], ['Turn right', 0, 28, 1400], ['Hero tilt', 14, -18, 1200], ['Floor', 58, 0, 1000]]
  return (
    <details className="group cu-section" open={on}>
      <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-xs font-medium text-text">3D {on && <span className="h-1.5 w-1.5 rounded-full bg-accent" aria-label="in use" />}</summary>
      <div className="space-y-2.5 border-t border-line px-3 py-3">
        <Range label="Tilt X" value={clip.tiltX ?? 0} min={-80} max={80} step={1} suffix="°" onChange={(v) => onPatch({ tiltX: v || undefined })} />
        <Range label="Turn Y" value={clip.turnY ?? 0} min={-80} max={80} step={1} suffix="°" onChange={(v) => onPatch({ turnY: v || undefined })} />
        <Range label="Perspective" value={clip.perspective ?? 1600} min={400} max={4000} step={50} suffix="px" onChange={(v) => onPatch({ perspective: v === 1600 ? undefined : v })} />
        <div className="flex flex-wrap gap-1">
          {presets.map(([name, x, y, p]) => (
            <button key={name} type="button" className="cu-chip px-2 py-0.5 text-xs" onClick={() => onPatch({ tiltX: x || undefined, turnY: y || undefined, perspective: p === 1600 ? undefined : p })}>{name}</button>
          ))}
        </div>
        <p className="text-[11px] text-muted">Works on text, photos, video, shapes and components. Animate it with keyframes (Tilt / Turn) for flips and card swings.</p>
      </div>
    </details>
  )
}

/** Rich caption styles (markup) + presets matching creator talking-head edits. */
export function RichTextFields({ clip, onPatch }: { clip: StudioTextClip; onPatch: (p: Partial<StudioClip>) => void }) {
  return (
    <details className="group cu-section">
      <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-xs font-medium text-text">Caption styles — emphasis, box, accent</summary>
      <div className="space-y-2.5 border-t border-line px-3 py-3">
        <p className="text-[11px] leading-relaxed text-muted">
          Type in the text box: <code className="text-text">*word*</code> serif italic · <code className="text-text">==words==</code> highlight box · <code className="text-text">{'{words}'}</code> accent colour · <code className="text-text">^30^</code> big · new line = stacked.
        </p>
        <div className="grid grid-cols-2 gap-1.5">
          {RICH_PRESETS.map((p) => (
            <button key={p.id} type="button" title={p.hint} className="cu-chip px-2 py-1.5 text-left text-xs" onClick={() => onPatch({ text: p.text, name: p.name, ...(p.patch as Partial<StudioTextClip>) } as Partial<StudioClip>)}>
              <span className="block font-medium text-text">{p.name}</span>
              <span className="block truncate text-[11px] text-muted">{p.hint}</span>
            </button>
          ))}
        </div>
        <div className="grid grid-cols-3 gap-2">
          {([['Emphasis', 'emphasisColor', RICH_DEFAULTS.emphasisColor], ['Box', 'boxColor', RICH_DEFAULTS.boxColor], ['Accent', 'accentColor', RICH_DEFAULTS.accentColor]] as const).map(([label, key, def]) => (
            <label key={key} className="flex items-center gap-1.5 text-xs text-muted">
              <input type="color" value={(clip[key] as string | undefined) ?? def} onChange={(e) => onPatch({ [key]: e.target.value } as Partial<StudioClip>)} className="h-7 w-7 rounded border border-line bg-transparent" aria-label={`${label} colour`} />
              {label}
            </label>
          ))}
        </div>
        <Row label="Emphasis font">
          <select className={inputCx} value={clip.emphasisFont ?? RICH_DEFAULTS.emphasisFont} onChange={(e) => onPatch({ emphasisFont: e.target.value } as Partial<StudioClip>)}>
            <option value="Instrument Serif">Instrument Serif italic — modern editorial</option>
            <option value="Playfair Display Variable">Playfair Display italic — classic</option>
            <option value="Montserrat Variable">Montserrat italic — sporty</option>
          </select>
        </Row>
        <Range label="Glow" value={clip.textGlow ?? 0} min={0} max={1} step={0.05} onChange={(v) => onPatch({ textGlow: v || undefined } as Partial<StudioClip>)} />
      </div>
    </details>
  )
}

const SHAPE_ANIMS: Array<[StudioShapeAnim, string]> = [['none', 'None'], ['draw-on', 'Draw on (stroke writes itself)'], ['draw-then-fill', 'Draw, then fill'], ['pop', 'Pop'], ['grow', 'Grow left → right'], ['spin-in', 'Spin in'], ['pulse', 'Pulse (loop)'], ['wiggle', 'Wiggle (settles)']]

export function ShapeFields({ clip, onPatch }: { clip: StudioShapeClip; onPatch: (p: Partial<StudioClip>) => void }) {
  const def = shapeById(clip.shape)
  const cats = [...new Set(SHAPES.map((s) => s.category))]
  return (
    <div className="space-y-3">
      <Row label="Shape" hint={def?.use}>
        <select className={inputCx} value={clip.shape} onChange={(e) => { const d = shapeById(e.target.value); onPatch({ shape: e.target.value, aspect: d?.aspect ?? clip.aspect, name: d?.name ?? 'Shape', ...(d?.strokeOnly && !clip.stroke ? { stroke: clip.fill ?? '#FFFFFF' } : {}) } as Partial<StudioClip>) }}>
          {cats.map((c) => <optgroup key={c} label={c[0].toUpperCase() + c.slice(1)}>{SHAPES.filter((s) => s.category === c).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</optgroup>)}
        </select>
      </Row>
      <Row label="Animation">
        <select className={inputCx} value={clip.anim} onChange={(e) => onPatch({ anim: e.target.value as StudioShapeAnim } as Partial<StudioClip>)}>
          {SHAPE_ANIMS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </Row>
      <div className="grid grid-cols-2 gap-2">
        <label className={cx('flex items-center gap-2 text-xs text-muted', def?.strokeOnly && 'opacity-40')}>
          <input type="checkbox" checked={!!clip.fill} disabled={def?.strokeOnly} onChange={(e) => onPatch({ fill: e.target.checked ? '#C8F542' : null } as Partial<StudioClip>)} /> Fill
          {clip.fill && <input type="color" value={clip.fill} onChange={(e) => onPatch({ fill: e.target.value } as Partial<StudioClip>)} className="h-6 w-6 rounded border border-line bg-transparent" aria-label="Fill colour" />}
        </label>
        <label className="flex items-center gap-2 text-xs text-muted">
          <input type="checkbox" checked={!!clip.stroke} onChange={(e) => onPatch({ stroke: e.target.checked ? '#FFFFFF' : null } as Partial<StudioClip>)} /> Stroke
          {clip.stroke && <input type="color" value={clip.stroke} onChange={(e) => onPatch({ stroke: e.target.value } as Partial<StudioClip>)} className="h-6 w-6 rounded border border-line bg-transparent" aria-label="Stroke colour" />}
        </label>
      </div>
      <Range label="Size" value={clip.w} min={0.02} max={1.2} step={0.01} onChange={(v) => onPatch({ w: v } as Partial<StudioClip>)} />
      <Range label="Height ratio" value={clip.aspect} min={0.02} max={3} step={0.01} onChange={(v) => onPatch({ aspect: v } as Partial<StudioClip>)} />
      <Range label="Stroke width" value={clip.strokeWidth} min={0} max={40} step={0.5} suffix="px" onChange={(v) => onPatch({ strokeWidth: v } as Partial<StudioClip>)} />
      {def?.takesSides && <Range label={clip.shape === 'star' || clip.shape === 'burst' ? 'Points' : clip.shape === 'blob' ? 'Lobes' : 'Sides'} value={clip.sides ?? (clip.shape === 'star' ? 5 : 6)} min={3} max={24} step={1} onChange={(v) => onPatch({ sides: v } as Partial<StudioClip>)} />}
      {def?.takesRadius && <Range label="Corner radius" value={clip.radius ?? 0} min={0} max={0.5} step={0.01} onChange={(v) => onPatch({ radius: v } as Partial<StudioClip>)} />}
      <Range label="Glow" value={clip.glow ?? 0} min={0} max={1} step={0.05} onChange={(v) => onPatch({ glow: v || undefined } as Partial<StudioClip>)} />
      <Row label="Label inside (optional)">
        <input className={inputCx} value={clip.label ?? ''} placeholder="e.g. Get started · SALE · NEW" onChange={(e) => onPatch({ label: e.target.value || undefined } as Partial<StudioClip>)} />
      </Row>
    </div>
  )
}

export function CursorFields({ clip, doc, onPatch }: { clip: StudioCursorClip; doc: StudioDoc; onPatch: (p: Partial<StudioClip>) => void }) {
  const target = doc.clips.find((c) => c.id === clip.targetClipId)
  const verdict = target ? cursorNeeded({ name: target.name, description: target.kind === 'overlay' ? target.component?.slug ?? '' : target.kind === 'shape' ? target.shape : '', category: target.kind }) : null
  const targets = doc.clips.filter((c) => c.id !== clip.id && 'x' in c && c.kind !== 'cursor')
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2">
        <Row label="Pointer">
          <select className={inputCx} value={clip.style} onChange={(e) => onPatch({ style: e.target.value } as Partial<StudioClip>)}>
            <option value="auto">Auto (arrow → hand on target)</option><option value="arrow">Arrow</option><option value="hand">Hand</option><option value="ibeam">I-beam (text inputs)</option><option value="dot">Dot</option><option value="ring">Ring</option><option value="touch">Touch (mobile)</option>
          </select>
        </Row>
        <Row label="Action">
          <select className={inputCx} value={clip.action} onChange={(e) => onPatch({ action: e.target.value, clicks: e.target.value === 'hover' ? [] : clip.clicks.length ? clip.clicks : [0.55] } as Partial<StudioClip>)}>
            <option value="click">Click</option><option value="double-click">Double-click</option><option value="hover">Hover</option><option value="drag">Drag</option>
          </select>
        </Row>
      </div>
      <Row label="Reacts on" hint={verdict ? verdict.reason : 'Link a clip and it presses in on each click (or lifts on hover).'}>
        <select className={inputCx} value={clip.targetClipId ?? ''} onChange={(e) => {
          const t = doc.clips.find((c) => c.id === e.target.value) as (StudioClip & { x?: number; y?: number }) | undefined
          onPatch({ targetClipId: e.target.value || null, ...(t && typeof t.x === 'number' ? { x: t.x, y: t.y } : {}) } as Partial<StudioClip>)
        }}>
          <option value="">Nothing (free cursor)</option>
          {targets.map((c) => <option key={c.id} value={c.id}>{c.name || c.kind}</option>)}
        </select>
      </Row>
      {clip.action !== 'hover' && <Range label="Click at" value={clip.clicks[0] ?? 0.55} min={0.15} max={0.95} step={0.01} onChange={(v) => onPatch({ clicks: [v, ...clip.clicks.slice(1)] } as Partial<StudioClip>)} />}
      <div className="grid grid-cols-2 gap-2">
        <Range label="Target X" value={clip.x} min={0} max={1} step={0.005} onChange={(v) => onPatch({ x: v } as Partial<StudioClip>)} />
        <Range label="Target Y" value={clip.y} min={0} max={1} step={0.005} onChange={(v) => onPatch({ y: v } as Partial<StudioClip>)} />
        <Range label="From X" value={clip.fromX} min={0} max={1} step={0.005} onChange={(v) => onPatch({ fromX: v } as Partial<StudioClip>)} />
        <Range label="From Y" value={clip.fromY} min={0} max={1} step={0.005} onChange={(v) => onPatch({ fromY: v } as Partial<StudioClip>)} />
      </div>
      <Range label="Size" value={clip.size} min={0.5} max={3} step={0.05} suffix="×" onChange={(v) => onPatch({ size: v } as Partial<StudioClip>)} />
      <label className="flex items-center gap-2 text-xs text-muted"><input type="checkbox" checked={clip.trail !== false} onChange={(e) => onPatch({ trail: e.target.checked } as Partial<StudioClip>)} /> Motion-blur trail</label>
      {clip.action !== 'hover' && clip.action !== 'drag' && (
        <div className="space-y-1.5 rounded-lg border border-line p-2">
          <div className="flex items-center justify-between text-xs"><span className="font-medium text-text">Click journey</span>
            <button type="button" className="cu-chip px-2 py-0.5 text-[11px]" onClick={() => {
              const stops = clip.stops?.length ? clip.stops : [{ x: clip.x, y: clip.y }]
              if (stops.length >= 6) return
              const lastStop = stops[stops.length - 1]
              const nextStops = [...stops, { x: Math.min(0.92, lastStop.x + 0.15), y: Math.min(0.9, lastStop.y + 0.08) }]
              const n = nextStops.length
              onPatch({ stops: nextStops, clicks: nextStops.map((_, i) => Math.round(((i + 1) / (n + 0.6)) * 100) / 100) } as Partial<StudioClip>)
            }}>+ Add click stop</button>
          </div>
          {(clip.stops ?? []).map((st, i) => (
            <div key={i} className="grid grid-cols-[auto_1fr_1fr_auto] items-center gap-1.5 text-[11px] text-muted">
              <span>#{i + 1}</span>
              <input type="range" min={0} max={1} step={0.005} value={st.x} aria-label={`Stop ${i + 1} X`} onChange={(e) => onPatch({ stops: clip.stops!.map((q, j) => (j === i ? { ...q, x: Number(e.target.value) } : q)), ...(i === 0 ? { x: Number(e.target.value) } : {}) } as Partial<StudioClip>)} />
              <input type="range" min={0} max={1} step={0.005} value={st.y} aria-label={`Stop ${i + 1} Y`} onChange={(e) => onPatch({ stops: clip.stops!.map((q, j) => (j === i ? { ...q, y: Number(e.target.value) } : q)), ...(i === 0 ? { y: Number(e.target.value) } : {}) } as Partial<StudioClip>)} />
              <button type="button" className="text-muted hover:text-danger" aria-label={`Remove stop ${i + 1}`} onClick={() => { const stops = clip.stops!.filter((_, j) => j !== i); onPatch({ stops: stops.length > 1 ? stops : undefined, clicks: (stops.length ? stops : [0]).map((_, k, a) => Math.round(((k + 1) / (a.length + 0.6)) * 100) / 100) } as Partial<StudioClip>) }}>✕</button>
            </div>
          ))}
          {!clip.stops?.length && <p className="text-[11px] text-muted">One click on the target. Add stops for a walkthrough: the pointer arcs from each click to the next.</p>}
        </div>
      )}
      <div className="flex gap-3 text-xs text-muted">
        <label className="flex items-center gap-1.5"><input type="color" value={clip.color} onChange={(e) => onPatch({ color: e.target.value } as Partial<StudioClip>)} className="h-6 w-6 rounded border border-line bg-transparent" aria-label="Cursor colour" /> Pointer</label>
        <label className="flex items-center gap-1.5"><input type="color" value={clip.rippleColor} onChange={(e) => onPatch({ rippleColor: e.target.value } as Partial<StudioClip>)} className="h-6 w-6 rounded border border-line bg-transparent" aria-label="Click ripple colour" /> Click ripple</label>
      </div>
    </div>
  )
}

/** framecn component props (from its own customizer config); applying re-records the clip. */
export function FramecnFields({ clip, onPatch }: { clip: StudioOverlayClip; onPatch: (p: Partial<StudioClip>) => void }) {
  const slug = clip.component?.slug ?? ''
  const [configs, setConfigs] = useState<Record<string, ComponentConfig> | null>(null)
  useEffect(() => { let live = true; void import('../../lab/propConfigs').then((m) => live && setConfigs(m.PROP_CONFIGS)); return () => { live = false } }, [])
  const config = configs?.[slug]
  const saved = clip.component?.props ?? {}
  const [draft, setDraft] = useState<Record<string, string | number | boolean>>(saved)
  useEffect(() => setDraft(clip.component?.props ?? {}), [clip.id]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!slug.startsWith('fc-') && !slug.startsWith('ob-')) return null
  if (!config) return <p className="text-xs text-muted">Loading component settings…</p>
  const dirty = JSON.stringify(draft) !== JSON.stringify(saved)
  const apply = () => clip.component && onPatch({ component: { ...clip.component, props: draft, status: 'pending' } } as Partial<StudioClip>)
  return (
    <div className="cu-section space-y-2.5 px-3 py-3">
      <div className="flex items-center justify-between text-xs font-medium text-text">Component settings <span className="text-[11px] font-normal text-muted">{slug.startsWith('ob-') ? 'after ObsidianUI · MIT' : 'framecn · MIT'}</span></div>
      {Object.entries(config.controls).map(([key, c]) => {
        const v = draft[key] ?? c.default
        const set = (val: string | number | boolean) => setDraft((d) => ({ ...d, [key]: val }))
        if (c.type === 'text') return <Row key={key} label={c.label}><input className={inputCx} value={String(v)} onChange={(e) => set(e.target.value)} /></Row>
        if (c.type === 'color') return <label key={key} className="flex items-center gap-2 text-xs text-muted"><input type="color" value={String(v).startsWith('#') && String(v).length === 7 ? String(v) : '#ffffff'} onChange={(e) => set(e.target.value)} className="h-6 w-6 rounded border border-line bg-transparent" aria-label={c.label} />{c.label}</label>
        if (c.type === 'number') return <Range key={key} label={c.label} value={Number(v)} min={c.min} max={c.max} step={c.step} onChange={set} />
        if (c.type === 'boolean') return <label key={key} className="flex items-center gap-2 text-xs text-muted"><input type="checkbox" checked={Boolean(v)} onChange={(e) => set(e.target.checked)} />{c.label}</label>
        return <Row key={key} label={c.label}><select className={inputCx} value={String(v)} onChange={(e) => set(e.target.value)}>{[...new Set([...c.options, String(c.default)])].map((o) => <option key={o} value={o}>{o}</option>)}</select></Row>
      })}
      <div className="flex gap-2">
        <button type="button" disabled={!dirty} title={(!dirty) ? 'No changes to apply' : undefined} onClick={apply} className={cx('cu-chip px-3 py-1 text-xs', dirty ? 'border-accent text-accent' : 'opacity-50')}>Apply & re-record</button>
        {Object.keys(saved).length > 0 && <button type="button" className="cu-chip px-3 py-1 text-xs" onClick={() => { setDraft({}); clip.component && onPatch({ component: { ...clip.component, props: undefined, status: 'pending' } } as Partial<StudioClip>) }}>Reset to defaults</button>}
      </div>
    </div>
  )
}
