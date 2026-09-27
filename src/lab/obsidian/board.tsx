/**
 * Motion-board components — Cupric's own implementations of techniques shown
 * in a user-supplied "motion board" reference (no licence; nothing copied: no
 * code, fonts or images). What is learnt is the grammar every tile follows:
 *
 *   one cycle = forward (≈2.2 s, eased) → hold (read it) → return (≈1.4 s)
 *   every frame = a pure function of t (seek), so preview = export
 *   shared elements travel instead of cutting; siblings stagger 0.1–0.35
 *
 * Each component reads only the stage clock and its props.
 */
import type { CSSProperties } from 'react'
import { useTimingInfo } from '../framecn/editframe-shim'

const clamp = (x: number, a = 0, b = 1) => Math.max(a, Math.min(b, x))
const lerp = (a: number, b: number, t: number) => a + (b - a) * t
const eio = (t: number) => { t = clamp(t); return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2 }
const eo = (t: number) => 1 - (1 - clamp(t)) ** 3
const FONT = "'Inter Variable', Inter, system-ui, sans-serif"
const fam = (f?: string) => (f && f.trim() ? `'${f.trim()}', ${FONT}` : FONT)

/** Forward → hold → return, as progress p (0..1) plus the phase. Pure in t. */
export function cycleAt(tSec: number, forward = 2.2, hold = 4.4, ret = 1.4, loop = true) {
  const total = forward + hold + ret
  const L = loop ? ((tSec % total) + total) % total : Math.min(tSec, forward + hold)
  if (L < forward) return { phase: 'fwd' as const, p: L / forward, h: 0 }
  if (L < forward + hold) return { phase: 'hold' as const, p: 1, h: (L - forward) / hold }
  return { phase: 'ret' as const, p: 1 - eio((L - forward - hold) / ret), h: 1 }
}

type Base = { width?: number; height?: number; background?: string; fontFamily?: string; loop?: boolean }
const box = (w: number, h: number, bg: string): CSSProperties => ({ width: w, height: h, background: bg, position: 'relative', overflow: 'hidden' })
const nums = (s: string) => s.split(',').map((v) => Number(v.trim())).filter((v) => Number.isFinite(v))

// ─── Chart morph: the same values turn from bars into a line through the tops.
export function ChartMorph({ title = 'Weekly reach', values = '40,58,49,74,63,92', labels = 'M,T,W,T,F,S', color = '#58b6ff', lineColor = '#f4f1ea', accentColor = '#c8f542', loop = true, fontFamily, width = 1280, height = 720, background = '#0b0b10' }: Base & { title?: string; values?: string; labels?: string; color?: string; lineColor?: string; accentColor?: string }) {
  const { ref, ownCurrentTimeMs } = useTimingInfo()
  const { p } = cycleAt(ownCurrentTimeMs / 1000, 2.2, 4.4, 1.4, loop)
  const k = eio(p)
  const v = nums(values).slice(0, 12)
  const vals = v.length >= 2 ? v : [1, 2]
  const max = Math.max(...vals, 1)
  const L = 160, R = width - 160, base = height - 150, top = 170
  const xs = vals.map((_, i) => L + (i * (R - L)) / (vals.length - 1))
  const pts = vals.map((val, i) => [xs[i], base - (val / max) * (base - top)] as const)
  const lk = clamp((k - 0.2) / 0.7)
  const path = pts.map((q, i) => `${i ? 'L' : 'M'}${q[0].toFixed(1)},${q[1].toFixed(1)}`).join(' ')
  const len = pts.slice(1).reduce((s, q, i) => s + Math.hypot(q[0] - pts[i][0], q[1] - pts[i][1]), 0)
  const lab = labels.split(',')
  const last = pts[pts.length - 1]
  return (
    <div ref={ref} style={box(width, height, background)}>
      <svg width={width} height={height} style={{ position: 'absolute', inset: 0, fontFamily: fam(fontFamily) }}>
        <text x={L - 40} y={100} fill={lineColor} fontSize={40} fontWeight={700}>{title}</text>
        <line x1={L - 40} y1={base} x2={R + 40} y2={base} stroke={lineColor} strokeOpacity={0.25} strokeWidth={2} />
        {pts.map(([x, y], i) => {
          const ki = eio(k * 1.6 - i * 0.12), bw = lerp(56, 6, ki)
          return <rect key={i} x={x - bw / 2} y={y} width={bw} height={base - y} rx={Math.min(8, bw / 2)} fill={color} opacity={lerp(0.9, 0.35, ki)} />
        })}
        {lk > 0 && <path d={path} fill="none" stroke={lineColor} strokeWidth={6} strokeLinecap="round" strokeLinejoin="round" strokeDasharray={len} strokeDashoffset={len * (1 - lk)} />}
        {pts.map(([x, y], i) => { const d = eo((lk - i / (pts.length - 1) + 0.03) / 0.1); const isLast = i === pts.length - 1; return d > 0 ? <circle key={i} cx={x} cy={y} r={(isLast ? 14 : 9) * d} fill={isLast ? accentColor : background} stroke={isLast ? background : lineColor} strokeWidth={4} /> : null })}
        {k > 0.86 && <g opacity={clamp((k - 0.86) / 0.14)}><rect x={last[0] - 120} y={last[1] - 70} width={90} height={50} rx={12} fill={accentColor} /><text x={last[0] - 75} y={last[1] - 36} textAnchor="middle" fontSize={26} fontWeight={700} fill={background}>{vals[vals.length - 1]}</text></g>}
        {xs.map((x, i) => <text key={i} x={x} y={base + 50} textAnchor="middle" fontSize={24} fill={lineColor} opacity={0.5}>{lab[i]?.trim() ?? ''}</text>)}
      </svg>
    </div>
  )
}

// ─── Masked type: colour fills the word from the bottom through its own letter shapes.
export function MaskedType({ word = 'LAUNCH', subline = 'in motion', color = '#f4f1ea', fillFrom = '#ff8a5c', fillTo = '#58b6ff', fontSize = 220, loop = true, fontFamily, width = 1280, height = 720, background = '#0b0b10' }: Base & { word?: string; subline?: string; color?: string; fillFrom?: string; fillTo?: string; fontSize?: number }) {
  const { ref, ownCurrentTimeMs } = useTimingInfo()
  const { p } = cycleAt(ownCurrentTimeMs / 1000, 2.2, 4.4, 1.4, loop)
  const cy = height * 0.5
  const edge = lerp(cy + fontSize * 0.1, cy - fontSize * 0.8, eio(p / 0.75))
  const sub = lerp(cy + fontSize * 0.75, cy + fontSize * 0.45, eio((p - 0.3) / 0.65))
  const id = 'mt' + Math.round(fontSize)
  return (
    <div ref={ref} style={box(width, height, background)}>
      <svg width={width} height={height} style={{ position: 'absolute', inset: 0 }}>
        <defs>
          <linearGradient id={id + 'g'} x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor={fillFrom} /><stop offset="1" stopColor={fillTo} /></linearGradient>
          <clipPath id={id + 't'}><text x={width / 2} y={cy} textAnchor="middle" fontFamily={fam(fontFamily)} fontSize={fontSize} fontWeight={800} letterSpacing={-4}>{word}</text></clipPath>
          <clipPath id={id + 'r'}><rect x={0} y={edge} width={width} height={height} /></clipPath>
          <clipPath id={id + 'm'}><rect x={0} y={0} width={width} height={cy + fontSize * 0.52} /></clipPath>
        </defs>
        <text x={width / 2} y={cy} textAnchor="middle" fontFamily={fam(fontFamily)} fontSize={fontSize} fontWeight={800} letterSpacing={-4} fill="none" stroke={color} strokeOpacity={0.45} strokeWidth={2}>{word}</text>
        <g clipPath={`url(#${id}t)`}><g clipPath={`url(#${id}r)`}><rect width={width} height={height} fill={`url(#${id}g)`} /></g></g>
        {p > 0.02 && p < 0.98 && <line x1={width * 0.1} y1={edge} x2={width * 0.9} y2={edge} stroke={fillFrom} strokeWidth={3} />}
        <g clipPath={`url(#${id}m)`}><text x={width / 2} y={sub} textAnchor="middle" fontFamily={fam(fontFamily)} fontSize={fontSize * 0.26} fontWeight={600} fill={color}>{subline}</text></g>
      </svg>
    </div>
  )
}

// ─── Elastic type: letters change width and height on a locked baseline, peaking in the centre.
export function ElasticType({ text = 'STRETCH', color = '#f4f1ea', accentColor = '#c8f542', fontSize = 150, stretch = 2, loop = true, fontFamily, width = 1280, height = 720, background = '#0b0b10' }: Base & { text?: string; color?: string; accentColor?: string; fontSize?: number; stretch?: number }) {
  const { ref, ownCurrentTimeMs } = useTimingInfo()
  const { p } = cycleAt(ownCurrentTimeMs / 1000, 2.2, 4.4, 1.4, loop)
  const chars = [...text]
  const mid = (chars.length - 1) / 2
  const baseY = height * 0.64
  return (
    <div ref={ref} style={{ ...box(width, height, background), display: 'flex', alignItems: 'flex-end', justifyContent: 'center', paddingBottom: height - baseY }}>
      <div style={{ display: 'flex', alignItems: 'flex-end', fontFamily: fam(fontFamily), fontSize, fontWeight: 800, lineHeight: 0.8 }}>
        {chars.map((c, i) => {
          const dist = Math.abs(i - mid) / Math.max(1, mid)
          const k = eio(p * 1.36 - Math.abs(i - mid) * 0.12)
          const sy = lerp(1, 1 + (stretch - 1) * (1 - dist), k)
          const sx = lerp(1, lerp(0.78, 1.08, dist), k)
          return <span key={i} style={{ display: 'inline-block', transformOrigin: '50% 100%', transform: `scale(${sx.toFixed(3)}, ${sy.toFixed(3)})`, color: Math.round(mid) === i ? accentColor : color, margin: '0 0.02em', whiteSpace: 'pre' }}>{c}</span>
        })}
      </div>
      <div style={{ position: 'absolute', left: 60, right: 60, top: baseY, height: 2, background: accentColor, opacity: 0.5 }} />
    </div>
  )
}

// ─── Shutter reveal: slats retract left to right over the art, then a badge lands.
export function ShutterReveal({ badge = 'New drop', slats = 7, colorA = '#f6d8c8', colorB = '#cfe5f2', slatColor = '#16181d', badgeColor = '#ffffff', loop = true, fontFamily, width = 1280, height = 720, background = '#0b0b10' }: Base & { badge?: string; slats?: number; colorA?: string; colorB?: string; slatColor?: string; badgeColor?: string }) {
  const { ref, ownCurrentTimeMs } = useTimingInfo()
  const { p } = cycleAt(ownCurrentTimeMs / 1000, 2.2, 4.4, 1.4, loop)
  const n = Math.max(3, Math.min(16, Math.round(slats)))
  const sl = width / n
  const bk = eio((p - 0.45) / 0.35)
  return (
    <div ref={ref} style={{ ...box(width, height, background), background: `linear-gradient(135deg, ${colorA}, ${colorB})` }}>
      <div style={{ position: 'absolute', left: '52%', top: '22%', width: height * 0.5, height: height * 0.5, borderRadius: '50%', background: 'radial-gradient(circle at 36% 32%, #f7c3a8, #d97557 55%, #9c4a31)' }} />
      {Array.from({ length: n }, (_, i) => { const t = eio(p * 1.7 - i * 0.1); const w = sl * (1 - t); return w > 0.5 ? <div key={i} style={{ position: 'absolute', top: 0, bottom: 0, left: i * sl + (sl - w) / 2 - 0.5, width: w + 1, background: slatColor, borderRight: '1px solid rgba(255,255,255,0.15)' }} /> : null })}
      {bk > 0 && <div style={{ position: 'absolute', left: 48, top: 48 + (1 - bk) * 12, opacity: bk, background: badgeColor, borderRadius: 999, padding: '10px 26px', fontFamily: fam(fontFamily), fontWeight: 700, fontSize: 30, color: slatColor }}>{badge}</div>}
    </div>
  )
}

// ─── Search → results: the pill opens, the query types, results stage in one by one.
export function SearchResults({ query = 'spring campaign', results = 'Spring launch email|Email · 48% opens, Spring reel cut|Reel · 21k views, Spring landing page|Page · 6.2% signups', color = '#16181d', accentColor = '#d97557', cardColor = '#ffffff', loop = true, fontFamily, width = 1280, height = 720, background = '#f2f0eb' }: Base & { query?: string; results?: string; color?: string; accentColor?: string; cardColor?: string }) {
  const { ref, ownCurrentTimeMs } = useTimingInfo()
  const { p } = cycleAt(ownCurrentTimeMs / 1000, 2.6, 4.2, 1.2, loop)
  const k0 = eio(p / 0.22), k1 = clamp((p - 0.16) / 0.36), k2 = clamp((p - 0.5) / 0.5)
  const W = lerp(320, width - 240, k0)
  const typed = query.slice(0, Math.round(k1 * query.length))
  const rows = results.split(',').map((r) => r.split('|').map((s) => s.trim())).filter((r) => r[0]).slice(0, 4)
  const dots = [accentColor, '#58b6ff', color, '#8ccbeb']
  return (
    <div ref={ref} style={{ ...box(width, height, background), fontFamily: fam(fontFamily), color }}>
      <div style={{ position: 'absolute', left: 120, top: 90, width: W, height: 96, borderRadius: 48, background: cardColor, boxShadow: '0 10px 30px rgba(0,19,47,0.12)', display: 'flex', alignItems: 'center', paddingLeft: 90, fontSize: 38, fontWeight: 600, overflow: 'hidden', whiteSpace: 'nowrap' }}>
        <span style={{ position: 'absolute', left: 36, width: 30, height: 30, borderRadius: '50%', border: `5px solid ${color}` }} />
        {typed ? <span>{typed}</span> : <span style={{ opacity: 0.4 }}>Search</span>}
        {k0 > 0.6 && <span style={{ width: 4, height: 44, marginLeft: 4, background: accentColor }} />}
      </div>
      {rows.map(([t, m], i) => { const ri = eio(k2 * 1.7 - i * 0.35); return ri > 0 ? (
        <div key={i} style={{ position: 'absolute', left: 120, top: 220 + i * 120 + (1 - ri) * 30, width: width - 240, height: 100, opacity: ri, borderRadius: 28, background: cardColor, boxShadow: '0 10px 30px rgba(0,19,47,0.10)', display: 'flex', alignItems: 'center', gap: 28, paddingLeft: 24 }}>
          <div style={{ width: 64, height: 64, borderRadius: 18, background: dots[i % 4], opacity: 0.85 }} />
          <div><div style={{ fontSize: 32, fontWeight: 700 }}>{t}</div><div style={{ fontSize: 24, opacity: 0.55 }}>{m ?? ''}</div></div>
        </div>) : null })}
    </div>
  )
}
