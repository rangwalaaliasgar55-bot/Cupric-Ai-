/**
 * Video components re-implemented from ObsidianUI ideas (MIT, see ./LICENSE).
 *
 * Every frame is a pure function of the stage clock (`useTimingInfo`), which
 * FramecnStage provides, so the Studio recorder, the preview and the export
 * all see the same frames. No requestAnimationFrame, no Math.random, no
 * pointer events: the originals reacted to scroll, clicks and the wall clock.
 */
import type { CSSProperties } from 'react'
import { useTimingInfo } from '../framecn/editframe-shim'

const clamp01 = (v: number) => Math.min(1, Math.max(0, v))
const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2)
const easeOut = (t: number) => t * (2 - t)
const mod = (a: number, n: number) => ((a % n) + n) % n
const DEFAULT_FONT = "'Inter Variable', Inter, system-ui, sans-serif"
const family = (f: unknown) => (typeof f === 'string' && f.trim() ? `'${f.trim()}', ${DEFAULT_FONT}` : DEFAULT_FONT)

type Base = { width?: number; height?: number; background?: string; fontFamily?: string }
const stage = (width: number, height: number, background: string): CSSProperties => ({
  width, height, background, position: 'relative', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center',
})

// ─── Flip text ──────────────────────────────────────────────────────────────
// ObsidianUI FlipText: every character flips on X; the delay follows a sine
// of its position (sin(i/n · π/2) · duration · 0.25), so the wave starts fast
// and settles, instead of a flat linear stagger.
export type FlipTextProps = Base & { text?: string; color?: string; fontSize?: number; fontWeight?: string | number; duration?: number; together?: boolean; loop?: boolean }
export function FlipText({ text = 'Flip every letter', color = '#f4f1ea', fontSize = 110, fontWeight = '700', duration = 2.2, together = false, loop = true, fontFamily, width = 1280, height = 720, background = '#0b0b10' }: FlipTextProps) {
  const { ref, ownCurrentTimeMs } = useTimingInfo()
  const t = ownCurrentTimeMs / 1000
  const chars = [...text]
  const n = Math.max(1, chars.length)
  const dur = Math.max(0.3, duration)
  return (
    <div ref={ref} style={stage(width, height, background)}>
      <div style={{ perspective: 1000, fontFamily: family(fontFamily), fontSize, fontWeight: Number(fontWeight), color, lineHeight: 1, whiteSpace: 'pre', display: 'flex', flexWrap: 'wrap', justifyContent: 'center', maxWidth: width * 0.9 }}>
        {chars.map((ch, i) => {
          const delay = together ? 0 : Math.sin((i / n) * (Math.PI / 2)) * dur * 0.25
          const local = t - delay
          // One flip takes 35% of the cycle; the rest is a readable hold.
          const phase = local < 0 ? 0 : loop ? mod(local, dur) / dur : clamp01(local / dur)
          const angle = easeInOutCubic(clamp01(phase / 0.35)) * 360
          const face: CSSProperties = { position: 'absolute', inset: 0, backfaceVisibility: 'hidden', WebkitBackfaceVisibility: 'hidden' }
          if (ch === ' ') return <span key={i} style={{ display: 'inline-block', width: '0.28em' }} />
          return (
            <span key={i} style={{ position: 'relative', display: 'inline-block', transformStyle: 'preserve-3d', transform: `rotateX(${angle}deg)` }}>
              <span style={{ visibility: 'hidden' }}>{ch}</span>
              <span style={face}>{ch}</span>
              <span style={{ ...face, transform: 'rotateX(180deg)' }}>{ch}</span>
            </span>
          )
        })}
      </div>
    </div>
  )
}

// ─── Text stream ────────────────────────────────────────────────────────────
// ObsidianUI TextStream: a small caps prefix over an endless vertical stream
// of words, masked top and bottom. `stepped` snaps word by word with an ease
// (great for "We build ___" hooks); otherwise it glides at constant speed.
export type TextStreamProps = Base & { prefix?: string; items?: string; color?: string; accentColor?: string; fontSize?: number; fontWeight?: string | number; speed?: number; stepped?: boolean }
export function TextStream({ prefix = 'We make', items = 'launch videos, product demos, app walkthroughs, social reels', color = '#f4f1ea', accentColor = '#c8f542', fontSize = 96, fontWeight = '700', speed = 1, stepped = true, fontFamily, width = 1280, height = 720, background = '#0b0b10' }: TextStreamProps) {
  const { ref, ownCurrentTimeMs } = useTimingInfo()
  const list = items.split(',').map((s) => s.trim()).filter(Boolean)
  const words = list.length ? list : ['—']
  const n = words.length
  const t = (ownCurrentTimeMs / 1000) * Math.max(0.1, speed)
  // Position in "items travelled": one item per 1.1 s, stepped = 0.45 s move + hold.
  const perItem = 1.1
  const raw = t / perItem
  const pos = stepped ? Math.floor(raw) + easeInOutCubic(clamp01((raw % 1) / 0.42)) : raw
  const itemH = fontSize * 1.25
  const offset = mod(pos, n) * itemH
  const active = Math.round(pos) % n
  const viewportH = itemH * 2.6
  const mask = 'linear-gradient(to bottom, transparent 0%, black 32%, black 68%, transparent 100%)'
  return (
    <div ref={ref} style={{ ...stage(width, height, background), flexDirection: 'column', gap: fontSize * 0.2, fontFamily: family(fontFamily) }}>
      <p style={{ margin: 0, fontSize: Math.max(14, fontSize * 0.24), letterSpacing: '0.25em', textTransform: 'uppercase', color, opacity: 0.5 }}>{prefix}</p>
      <div style={{ position: 'relative', width: '100%', height: viewportH, overflow: 'hidden', maskImage: mask, WebkitMaskImage: mask }}>
        <div style={{ position: 'absolute', left: 0, right: 0, top: viewportH / 2 - itemH / 2, transform: `translateY(${-(offset + n * itemH)}px)` }}>
          {[0, 1, 2].flatMap((copy) => words.map((w, i) => (
            <div key={`${copy}-${i}`} style={{ height: itemH, lineHeight: `${itemH}px`, textAlign: 'center', whiteSpace: 'nowrap', fontSize, fontWeight: Number(fontWeight), color: i === active ? accentColor : color }}>{w}</div>
          )))}
        </div>
      </div>
    </div>
  )
}

// ─── Click spark ────────────────────────────────────────────────────────────
// ObsidianUI ClickSpark's burst geometry — `count` lines at equal angles,
// travelling eased·radius while shrinking size·(1-eased) — fired on a fixed
// schedule instead of on real clicks. Transparent by default: lay it over a
// button or a cursor click on a higher track.
export type ClickSparkProps = Base & { color?: string; sparkCount?: number; sparkSize?: number; sparkRadius?: number; durationMs?: number; interval?: number; bursts?: string; strokeWidth?: number }
export function ClickSpark({ color = '#c8f542', sparkCount = 8, sparkSize = 34, sparkRadius = 70, durationMs = 450, interval = 1, bursts = 'center', strokeWidth = 4, width = 1280, height = 720, background = 'transparent' }: ClickSparkProps) {
  const { ref, ownCurrentTimeMs } = useTimingInfo()
  const every = Math.max(0.2, interval) * 1000
  const dur = Math.max(100, Math.min(every, durationMs))
  const index = Math.floor(ownCurrentTimeMs / every)
  const elapsed = ownCurrentTimeMs - index * every
  // Burst positions: centre, or a deterministic golden-angle walk around it.
  const spread = bursts === 'scatter'
  const golden = index * 2.399963
  const cx = width / 2 + (spread ? Math.cos(golden) * width * 0.22 * ((index % 3) / 2 + 0.3) : 0)
  const cy = height / 2 + (spread ? Math.sin(golden) * height * 0.22 * ((index % 3) / 2 + 0.3) : 0)
  const p = clamp01(elapsed / dur)
  const e = easeOut(p)
  const count = Math.max(3, Math.round(sparkCount))
  const lines = elapsed < dur ? Array.from({ length: count }, (_, i) => {
    const a = (2 * Math.PI * i) / count
    const d = e * sparkRadius
    const len = sparkSize * (1 - e)
    return { x1: cx + d * Math.cos(a), y1: cy + d * Math.sin(a), x2: cx + (d + len) * Math.cos(a), y2: cy + (d + len) * Math.sin(a) }
  }) : []
  return (
    <div ref={ref} style={stage(width, height, background)}>
      <svg width={width} height={height} style={{ position: 'absolute', inset: 0 }}>
        {lines.map((l, i) => <line key={i} {...l} stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" />)}
      </svg>
    </div>
  )
}

// ─── Marquee band ───────────────────────────────────────────────────────────
// After ObsidianUI's draggable marquee: a tilted band of repeating words that
// scrolls forever. Loops seamlessly by translating a doubled track by a
// percentage, so it never needs to measure text. `crossed` adds a second band
// running the other way, the classic launch-video "tape" look.
export type MarqueeBandProps = Base & { text?: string; separator?: string; color?: string; bandColor?: string; secondBandColor?: string; fontSize?: number; fontWeight?: string | number; speed?: number; angle?: number; crossed?: boolean; uppercase?: boolean }
export function MarqueeBand({ text = 'Now live, Built for teams, Ship faster', separator = '✦', color = '#0b0b10', bandColor = '#c8f542', secondBandColor = '#f4f1ea', fontSize = 64, fontWeight = '800', speed = 1, angle = -6, crossed = true, uppercase = true, fontFamily, width = 1280, height = 720, background = '#0b0b10' }: MarqueeBandProps) {
  const { ref, ownCurrentTimeMs } = useTimingInfo()
  const words = text.split(',').map((s) => s.trim()).filter(Boolean)
  const unit = (words.length ? words : ['Marquee']).map((w) => `${uppercase ? w.toUpperCase() : w}  ${separator}  `).join('')
  const run = unit.repeat(4)
  const phase = mod((ownCurrentTimeMs / 1000) * Math.max(0.05, speed) * 0.12, 1)
  const band = (bg: string, fg: string, deg: number, dir: 1 | -1, key: string) => (
    <div key={key} style={{ position: 'absolute', left: -width * 0.1, width: width * 1.2, top: '50%', transform: `translateY(-50%) rotate(${deg}deg)`, background: bg, padding: `${fontSize * 0.28}px 0`, overflow: 'hidden', boxShadow: '0 20px 60px rgba(0,0,0,0.35)' }}>
      <div style={{ display: 'flex', width: 'max-content', transform: `translateX(${dir === 1 ? -phase * 50 : (phase - 1) * 50}%)`, whiteSpace: 'pre', fontFamily: family(fontFamily), fontSize, fontWeight: Number(fontWeight), color: fg, lineHeight: 1 }}>
        <span>{run}</span><span>{run}</span>
      </div>
    </div>
  )
  return (
    <div ref={ref} style={stage(width, height, background)}>
      {crossed && band(secondBandColor, color, -angle, -1, 'b')}
      {band(bandColor, color, angle, 1, 'a')}
    </div>
  )
}
