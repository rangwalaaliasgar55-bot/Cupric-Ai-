/**
 * Keyframe value graph (inspector). Pick a property to see its curve over the
 * clip, sampled from the renderer. Drag a point to change its time and value,
 * double-click empty space to add a key, and use Copy/Paste to move a motion
 * between clips. A drag commits on pointer-up, so one drag is one undo step.
 */
import { useMemo, useRef, useState } from 'react'
import type { StudioClip, StudioKeyframe } from '../../types/project'
import {
  GRAPH_PROPS, addKeyAt, animatedProps, copyKeys, graphRange, moveKey, pasteKeys, propInfo, sampleProp, setAllEases,
  type GraphProp, type KeyClipboard,
} from '../../lib/studio/keyframeGraph'

const W = 280
const H = 130
const PAD = 8
// Module-level: the clipboard survives switching the selected clip.
let clipboard: KeyClipboard | null = null

export function KeyframeGraph({ clip, localTime, onPatch, onNote }: { clip: StudioClip; localTime: number; onPatch: (p: Partial<StudioClip>) => void; onNote?: (msg: string) => void }) {
  const keys = useMemo(() => clip.keyframes ?? [], [clip.keyframes])
  const animated = animatedProps(keys)
  const [prop, setProp] = useState<GraphProp>(animated[0] ?? 'opacity')
  const [drag, setDrag] = useState<{ index: number; keys: StudioKeyframe[] } | null>(null)
  const [, force] = useState(0)
  const svgRef = useRef<SVGSVGElement>(null)
  const shown: StudioClip = drag ? { ...clip, keyframes: drag.keys } : clip
  const samples = useMemo(() => sampleProp(shown, prop), [shown, prop])
  const [lo, hi] = useMemo(() => graphRange(samples, prop), [samples, prop])
  const dur = Math.max(0.01, clip.durationSec)
  const toX = (t: number) => PAD + (t / dur) * (W - PAD * 2)
  const toY = (v: number) => PAD + (1 - (v - lo) / (hi - lo || 1)) * (H - PAD * 2)
  const fromEvent = (e: React.PointerEvent | React.MouseEvent) => {
    const r = svgRef.current!.getBoundingClientRect()
    const x = ((e.clientX - r.left) / r.width) * W
    const y = ((e.clientY - r.top) / r.height) * H
    return { at: ((x - PAD) / (W - PAD * 2)) * dur, value: lo + (1 - (y - PAD) / (H - PAD * 2)) * (hi - lo) }
  }
  const path = samples.map(([t, v], i) => `${i ? 'L' : 'M'}${toX(t).toFixed(1)},${toY(v).toFixed(1)}`).join(' ')
  const cur = drag?.keys ?? keys
  const info = propInfo(prop)

  return (
    <div className="space-y-2" data-testid="keyframe-graph">
      <div className="flex flex-wrap items-center gap-1.5">
        <select aria-label="Graph property" className="cu-input px-2 py-1 text-xs" value={prop} onChange={(e) => setProp(e.target.value as GraphProp)}>
          {GRAPH_PROPS.map((p) => <option key={p.id} value={p.id}>{p.label}{animated.includes(p.id) ? ' •' : ''}</option>)}
        </select>
        <button type="button" className="cu-chip px-2 py-1 text-xs" disabled={!keys.length} title={(!keys.length) ? 'This clip has no keyframes' : undefined} onClick={() => { clipboard = copyKeys(keys); force((n) => n + 1); onNote?.(`Copied ${keys.length} keyframe(s).`) }}>Copy</button>
        <button type="button" className="cu-chip px-2 py-1 text-xs" disabled={!clipboard} title="Paste at the playhead" onClick={() => { if (!clipboard) return; const r = pasteKeys(keys, clipboard, Math.max(0, localTime), clip.durationSec); onPatch({ keyframes: r.keys }); onNote?.(r.dropped ? `Pasted. ${r.dropped} key(s) ran past the clip end and were dropped. Try "Paste to fit".` : 'Pasted at the playhead.') }}>Paste</button>
        <button type="button" className="cu-chip px-2 py-1 text-xs" disabled={!clipboard} title="Paste, scaled to finish at the clip end" onClick={() => { if (!clipboard) return; onPatch({ keyframes: pasteKeys(keys, clipboard, Math.max(0, localTime), clip.durationSec, true).keys }) }}>Paste to fit</button>
        <select aria-label="Set every ease" className="cu-input px-2 py-1 text-xs" value="" disabled={keys.length < 2} onChange={(e) => e.target.value && onPatch({ keyframes: setAllEases(keys, e.target.value as StudioKeyframe['ease']) })}>
          <option value="">All eases…</option><option value="ease-in-out">Smooth</option><option value="expo-out">Snappy</option><option value="back-out">Overshoot</option><option value="elastic-out">Spring</option><option value="linear">Linear</option><option value="hold">Hold (step)</option>
        </select>
      </div>
      <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} className="h-[130px] w-full touch-none select-none rounded-lg border border-line bg-bg/60" role="img"
        aria-label={`${info.label} over ${clip.durationSec.toFixed(1)} seconds, ${cur.length} keyframes. Double-click to add a key.`}
        onDoubleClick={(e) => { const { at } = fromEvent(e); onPatch({ keyframes: addKeyAt(clip, prop, at) }) }}
        onPointerMove={(e) => { if (!drag) return; const { at, value } = fromEvent(e); setDrag({ index: drag.index, keys: moveKey(keys, drag.index, at, value, prop, clip.durationSec) }) }}
        onPointerUp={() => { if (drag) { onPatch({ keyframes: drag.keys }); setDrag(null) } }}
        onPointerLeave={() => { if (drag) { onPatch({ keyframes: drag.keys }); setDrag(null) } }}>
        <line x1={PAD} x2={W - PAD} y1={toY(info.rest)} y2={toY(info.rest)} className="stroke-line" strokeDasharray="3 3" />
        {localTime >= 0 && localTime <= dur && <line x1={toX(localTime)} x2={toX(localTime)} y1={0} y2={H} className="stroke-info/60" />}
        <path d={path} fill="none" className="stroke-accent" strokeWidth={1.8} />
        {cur.map((k, i) => typeof k[prop] === 'number' && (
          <rect key={`${i}-${k.at}`} x={toX(k.at) - 4.5} y={toY(k[prop] as number) - 4.5} width={9} height={9} transform={`rotate(45 ${toX(k.at)} ${toY(k[prop] as number)})`}
            className={`cursor-grab fill-panel stroke-accent ${drag?.index === i ? 'fill-accent' : ''}`} strokeWidth={1.5}
            role="slider" tabIndex={0} aria-label={`${info.label} key at ${k.at.toFixed(2)}s`} aria-valuenow={k[prop] as number} aria-valuemin={info.min} aria-valuemax={info.max}
            onPointerDown={(e) => { e.stopPropagation(); (e.target as Element).setPointerCapture?.(e.pointerId); setDrag({ index: i, keys }) }}
            onKeyDown={(e) => {
              const dv = e.key === 'ArrowUp' ? info.step * 5 : e.key === 'ArrowDown' ? -info.step * 5 : 0
              const dt = e.key === 'ArrowRight' ? 0.05 : e.key === 'ArrowLeft' ? -0.05 : 0
              if (!dv && !dt) return
              e.preventDefault()
              onPatch({ keyframes: moveKey(keys, i, k.at + dt, (k[prop] as number) + dv, prop, clip.durationSec) })
            }} />
        ))}
      </svg>
      <p className="text-xs text-muted/80">Drag a diamond to change its time and value, or focus one and use the arrow keys. Double-click to add a key. The dashed line is the resting value.</p>
    </div>
  )
}
