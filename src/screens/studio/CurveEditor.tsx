/**
 * 2.2 — keyframe curve editor. Drag the two handles (or pick a preset); the
 * curve drawn is sampled from the same bezierEase the renderer uses. Handle
 * drags patch on pointer-up only, so one drag = one undo step.
 */
import { useRef, useState } from 'react'
import { CURVE_PRESETS, bezierEase, clampBezier, type Bezier } from '../../lib/studio/curves'

const W = 200
const H = 140
const PAD = 30 // room for overshoot above/below

export function CurveEditor({ value, onChange }: { value: Bezier; onChange: (b: Bezier) => void }) {
  const [draft, setDraft] = useState<Bezier | null>(null)
  const drag = useRef<0 | 1 | null>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const b = draft ?? value
  const toX = (x: number) => x * W
  const toY = (y: number) => PAD + (1 - y) * (H - PAD * 2)
  const fromEvent = (e: React.PointerEvent): [number, number] => {
    const r = svgRef.current!.getBoundingClientRect()
    const x = ((e.clientX - r.left) / r.width) * W
    const y = ((e.clientY - r.top) / r.height) * H
    return [x / W, 1 - (y - PAD) / (H - PAD * 2)]
  }
  const path = Array.from({ length: 41 }, (_, i) => {
    const x = i / 40
    return `${i ? 'L' : 'M'}${toX(x).toFixed(1)},${toY(bezierEase(b, x)).toFixed(1)}`
  }).join(' ')

  return (
    <div className="space-y-1.5">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        className="w-full touch-none rounded-md border border-line bg-panel-alt"
        aria-label="Keyframe curve editor"
        onPointerMove={(e) => {
          if (drag.current === null) return
          const [x, y] = fromEvent(e)
          const next = [...b] as Bezier
          next[drag.current * 2] = x
          next[drag.current * 2 + 1] = y
          setDraft(clampBezier(next))
        }}
        onPointerUp={() => {
          if (drag.current !== null && draft) onChange(draft)
          drag.current = null
          setDraft(null)
        }}
      >
        <line x1={0} y1={toY(0)} x2={W} y2={toY(0)} stroke="currentColor" className="text-line" />
        <line x1={0} y1={toY(1)} x2={W} y2={toY(1)} stroke="currentColor" className="text-line" />
        <line x1={toX(0)} y1={toY(0)} x2={toX(b[0])} y2={toY(b[1])} stroke="#4FB6E8" strokeWidth={1} />
        <line x1={toX(1)} y1={toY(1)} x2={toX(b[2])} y2={toY(b[3])} stroke="#4FB6E8" strokeWidth={1} />
        <path d={path} fill="none" stroke="#C8F542" strokeWidth={2} />
        {[0, 1].map((h) => (
          <circle
            key={h}
            cx={toX(b[h * 2])}
            cy={toY(b[h * 2 + 1])}
            r={6}
            fill="#F4F1EA"
            className="cursor-grab"
            role="slider"
            aria-label={`Curve handle ${h + 1}`}
            aria-valuetext={`${b[h * 2].toFixed(2)}, ${b[h * 2 + 1].toFixed(2)}`}
            onPointerDown={(e) => {
              ;(e.target as Element).setPointerCapture?.(e.pointerId)
              drag.current = h as 0 | 1
            }}
          />
        ))}
      </svg>
      <div className="flex flex-wrap gap-1">
        {CURVE_PRESETS.map((p) => (
          <button key={p.id} type="button" className="cu-chip px-1.5 py-0.5 text-xs" onClick={() => onChange(p.bezier)}>
            {p.label}
          </button>
        ))}
      </div>
      <p className="font-mono text-xs text-muted">cubic-bezier({b.map((v) => v.toFixed(2)).join(', ')})</p>
    </div>
  )
}
