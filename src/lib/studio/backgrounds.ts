/**
 * Studio backgrounds.
 *
 * Every preset exists twice, on purpose:
 *  - `css`  — what the DOM preview / Arena HTML / Library copy button use.
 *  - `paint` — the same look drawn straight onto a 2D canvas, so an export is
 *              pixel-identical to the preview instead of "close enough".
 *
 * Gradients follow the ibelick-style catalogue referenced in DESIGN.md but are
 * re-expressed in Cupric tokens: near-black base, one lime accent, blue informs.
 */

export type StudioBackground = {
  id: string
  name: string
  group: 'gradient' | 'pattern' | 'solid' | 'mesh'
  css: string
  paint: (ctx: CanvasRenderingContext2D, w: number, h: number, t: number) => void
}

function fill(ctx: CanvasRenderingContext2D, w: number, h: number, color: string) {
  ctx.fillStyle = color
  ctx.fillRect(0, 0, w, h)
}

function radial(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  cx: number,
  cy: number,
  radius: number,
  inner: string,
  outer: string,
) {
  const g = ctx.createRadialGradient(cx * w, cy * h, 0, cx * w, cy * h, radius * Math.max(w, h))
  g.addColorStop(0, inner)
  g.addColorStop(1, outer)
  ctx.fillStyle = g
  ctx.fillRect(0, 0, w, h)
}

function grid(ctx: CanvasRenderingContext2D, w: number, h: number, step: number, color: string) {
  ctx.save()
  ctx.strokeStyle = color
  ctx.lineWidth = Math.max(1, Math.round(w / 1920))
  ctx.beginPath()
  for (let x = 0; x <= w; x += step) {
    ctx.moveTo(Math.round(x) + 0.5, 0)
    ctx.lineTo(Math.round(x) + 0.5, h)
  }
  for (let y = 0; y <= h; y += step) {
    ctx.moveTo(0, Math.round(y) + 0.5)
    ctx.lineTo(w, Math.round(y) + 0.5)
  }
  ctx.stroke()
  ctx.restore()
}

function dots(ctx: CanvasRenderingContext2D, w: number, h: number, step: number, color: string) {
  ctx.save()
  ctx.fillStyle = color
  const r = Math.max(1, w / 900)
  for (let x = step / 2; x < w; x += step) {
    for (let y = step / 2; y < h; y += step) {
      ctx.beginPath()
      ctx.arc(x, y, r, 0, Math.PI * 2)
      ctx.fill()
    }
  }
  ctx.restore()
}

export const STUDIO_BACKGROUNDS: StudioBackground[] = [
  {
    id: 'void',
    name: 'Void',
    group: 'solid',
    css: 'background:#0B0B10;',
    paint: (ctx, w, h) => fill(ctx, w, h, '#0B0B10'),
  },
  {
    id: 'lime-void',
    name: 'Lime Void',
    group: 'gradient',
    css: 'background: radial-gradient(ellipse 80% 60% at 50% 40%, rgba(200,245,66,0.14), transparent 70%), #0B0B10;',
    paint: (ctx, w, h) => {
      fill(ctx, w, h, '#0B0B10')
      radial(ctx, w, h, 0.5, 0.4, 0.7, 'rgba(200,245,66,0.18)', 'rgba(200,245,66,0)')
    },
  },
  {
    id: 'grid-haze',
    name: 'Grid Haze',
    group: 'pattern',
    css: 'background-color:#0B0B10;background-image:radial-gradient(ellipse 70% 50% at 50% 30%,rgba(200,245,66,0.08),transparent),linear-gradient(rgba(255,255,255,0.03) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,0.03) 1px,transparent 1px);background-size:100% 100%,48px 48px,48px 48px;',
    paint: (ctx, w, h) => {
      fill(ctx, w, h, '#0B0B10')
      grid(ctx, w, h, Math.round(w / 40), 'rgba(255,255,255,0.045)')
      radial(ctx, w, h, 0.5, 0.3, 0.6, 'rgba(200,245,66,0.12)', 'rgba(200,245,66,0)')
    },
  },
  {
    id: 'dot-field',
    name: 'Dot Field',
    group: 'pattern',
    css: 'background-color:#0B0B10;background-image:radial-gradient(rgba(255,255,255,0.08) 1px,transparent 1px);background-size:24px 24px;',
    paint: (ctx, w, h) => {
      fill(ctx, w, h, '#0B0B10')
      dots(ctx, w, h, Math.round(w / 50), 'rgba(255,255,255,0.10)')
    },
  },
  {
    id: 'blue-orbit',
    name: 'Blue Orbit',
    group: 'gradient',
    css: 'background: radial-gradient(circle at 80% 20%, rgba(79,182,232,0.16), transparent 45%), radial-gradient(circle at 20% 80%, rgba(200,245,66,0.08), transparent 40%), #0B0B10;',
    paint: (ctx, w, h) => {
      fill(ctx, w, h, '#0B0B10')
      radial(ctx, w, h, 0.8, 0.2, 0.5, 'rgba(79,182,232,0.22)', 'rgba(79,182,232,0)')
      radial(ctx, w, h, 0.2, 0.8, 0.45, 'rgba(200,245,66,0.12)', 'rgba(200,245,66,0)')
    },
  },
  {
    id: 'warm-paper',
    name: 'Warm Paper',
    group: 'gradient',
    css: 'background: linear-gradient(160deg, #1a1410 0%, #0f0c0a 50%, #0B0B10 100%);',
    paint: (ctx, w, h) => {
      const g = ctx.createLinearGradient(0, 0, w * 0.4, h)
      g.addColorStop(0, '#1a1410')
      g.addColorStop(0.5, '#0f0c0a')
      g.addColorStop(1, '#0B0B10')
      ctx.fillStyle = g
      ctx.fillRect(0, 0, w, h)
    },
  },
  {
    id: 'aurora',
    name: 'Aurora Drift',
    group: 'gradient',
    css: 'background: radial-gradient(ellipse 60% 40% at 25% 25%, rgba(200,245,66,0.16), transparent 60%), radial-gradient(ellipse 50% 45% at 75% 70%, rgba(79,182,232,0.18), transparent 60%), #0B0B10;',
    paint: (ctx, w, h, t) => {
      fill(ctx, w, h, '#0B0B10')
      // Slow, deterministic drift: a function of t only, so exports match preview.
      const drift = Math.sin(t * 0.4) * 0.06
      radial(ctx, w, h, 0.25 + drift, 0.25, 0.55, 'rgba(200,245,66,0.20)', 'rgba(200,245,66,0)')
      radial(ctx, w, h, 0.75 - drift, 0.7, 0.55, 'rgba(79,182,232,0.22)', 'rgba(79,182,232,0)')
    },
  },
  {
    id: 'spotlight',
    name: 'Spotlight',
    group: 'gradient',
    css: 'background: radial-gradient(circle at 50% 0%, rgba(244,241,234,0.14), transparent 55%), #0B0B10;',
    paint: (ctx, w, h) => {
      fill(ctx, w, h, '#0B0B10')
      radial(ctx, w, h, 0.5, 0, 0.7, 'rgba(244,241,234,0.16)', 'rgba(244,241,234,0)')
    },
  },
  {
    id: 'lime-wash',
    name: 'Lime Wash',
    group: 'gradient',
    css: 'background: linear-gradient(140deg, #16210a 0%, #0f1408 45%, #0B0B10 100%);',
    paint: (ctx, w, h) => {
      const g = ctx.createLinearGradient(0, 0, w, h)
      g.addColorStop(0, '#16210a')
      g.addColorStop(0.45, '#0f1408')
      g.addColorStop(1, '#0B0B10')
      ctx.fillStyle = g
      ctx.fillRect(0, 0, w, h)
    },
  },
  {
    id: 'mesh-lagoon',
    name: 'Mesh Lagoon',
    group: 'mesh',
    css: 'background-color:#0B0B10;background-image:radial-gradient(at 18% 22%,rgba(79,182,232,0.30) 0px,transparent 55%),radial-gradient(at 82% 18%,rgba(200,245,66,0.20) 0px,transparent 50%),radial-gradient(at 68% 82%,rgba(120,88,232,0.24) 0px,transparent 55%),radial-gradient(at 22% 78%,rgba(79,182,232,0.16) 0px,transparent 50%);',
    paint: (ctx, w, h, t) => {
      fill(ctx, w, h, '#0B0B10')
      const d = Math.sin(t * 0.35) * 0.04
      radial(ctx, w, h, 0.18 + d, 0.22, 0.55, 'rgba(79,182,232,0.34)', 'rgba(79,182,232,0)')
      radial(ctx, w, h, 0.82 - d, 0.18, 0.5, 'rgba(200,245,66,0.22)', 'rgba(200,245,66,0)')
      radial(ctx, w, h, 0.68, 0.82 + d * 0.6, 0.55, 'rgba(120,88,232,0.26)', 'rgba(120,88,232,0)')
      radial(ctx, w, h, 0.22, 0.78 - d * 0.6, 0.5, 'rgba(79,182,232,0.18)', 'rgba(79,182,232,0)')
    },
  },
  {
    id: 'mesh-ember',
    name: 'Mesh Ember',
    group: 'mesh',
    css: 'background-color:#0B0B10;background-image:radial-gradient(at 26% 14%,rgba(255,138,76,0.26) 0px,transparent 52%),radial-gradient(at 78% 30%,rgba(232,74,106,0.22) 0px,transparent 50%),radial-gradient(at 50% 88%,rgba(200,245,66,0.14) 0px,transparent 55%);',
    paint: (ctx, w, h, t) => {
      fill(ctx, w, h, '#0B0B10')
      const d = Math.cos(t * 0.3) * 0.035
      radial(ctx, w, h, 0.26 + d, 0.14, 0.52, 'rgba(255,138,76,0.30)', 'rgba(255,138,76,0)')
      radial(ctx, w, h, 0.78 - d, 0.3, 0.5, 'rgba(232,74,106,0.26)', 'rgba(232,74,106,0)')
      radial(ctx, w, h, 0.5, 0.88, 0.55, 'rgba(200,245,66,0.16)', 'rgba(200,245,66,0)')
    },
  },
  {
    id: 'liquid-chrome',
    name: 'Liquid Chrome',
    group: 'mesh',
    css: 'background:conic-gradient(from 210deg at 50% 50%,#0B0B10,#1b2430,#3a4757,#0f141b,#2b3542,#0B0B10);',
    paint: (ctx, w, h, t) => {
      // Banded conic sheen, approximated with an angular sweep of strips so it
      // renders identically in the browser canvas and in an offscreen export.
      const cx = w / 2
      const cy = h / 2
      const radius = Math.hypot(w, h)
      const stops = ['#0B0B10', '#1b2430', '#3a4757', '#0f141b', '#2b3542', '#0B0B10']
      const steps = 180
      const base = (210 * Math.PI) / 180 + t * 0.25
      for (let i = 0; i < steps; i++) {
        const a0 = base + (i / steps) * Math.PI * 2
        const a1 = base + ((i + 1.4) / steps) * Math.PI * 2
        const pos = (i / steps) * (stops.length - 1)
        ctx.fillStyle = stops[Math.round(pos)]
        ctx.beginPath()
        ctx.moveTo(cx, cy)
        ctx.arc(cx, cy, radius, a0, a1)
        ctx.closePath()
        ctx.fill()
      }
      radial(ctx, w, h, 0.5, 0.5, 0.75, 'rgba(255,255,255,0.05)', 'rgba(11,11,16,0.55)')
    },
  },
  {
    id: 'liquid-lime',
    name: 'Liquid Lime',
    group: 'mesh',
    css: 'background-color:#0B0B10;background-image:radial-gradient(at 30% 30%,rgba(200,245,66,0.28) 0px,transparent 50%),radial-gradient(at 70% 70%,rgba(200,245,66,0.12) 0px,transparent 45%),linear-gradient(120deg,rgba(255,255,255,0.03),transparent 60%);',
    paint: (ctx, w, h, t) => {
      fill(ctx, w, h, '#0B0B10')
      // Two blobs orbiting a shared centre — a cheap metaball feel.
      const a = t * 0.5
      radial(ctx, w, h, 0.5 + Math.cos(a) * 0.16, 0.5 + Math.sin(a) * 0.12, 0.45, 'rgba(200,245,66,0.30)', 'rgba(200,245,66,0)')
      radial(ctx, w, h, 0.5 - Math.cos(a) * 0.16, 0.5 - Math.sin(a) * 0.12, 0.4, 'rgba(200,245,66,0.16)', 'rgba(200,245,66,0)')
      const g = ctx.createLinearGradient(0, 0, w, h)
      g.addColorStop(0, 'rgba(255,255,255,0.04)')
      g.addColorStop(0.6, 'rgba(255,255,255,0)')
      ctx.fillStyle = g
      ctx.fillRect(0, 0, w, h)
    },
  },
  {
    id: 'noise-veil',
    name: 'Noise Veil',
    group: 'pattern',
    css: 'background-color:#0B0B10;background-image:radial-gradient(ellipse 70% 50% at 50% 0%,rgba(244,241,234,0.10),transparent 60%),repeating-linear-gradient(0deg,rgba(255,255,255,0.025) 0px,rgba(255,255,255,0.025) 1px,transparent 1px,transparent 3px);',
    paint: (ctx, w, h) => {
      fill(ctx, w, h, '#0B0B10')
      radial(ctx, w, h, 0.5, 0, 0.7, 'rgba(244,241,234,0.10)', 'rgba(244,241,234,0)')
      ctx.save()
      ctx.strokeStyle = 'rgba(255,255,255,0.025)'
      ctx.lineWidth = 1
      const step = Math.max(3, Math.round(h / 360))
      ctx.beginPath()
      for (let y = 0; y <= h; y += step) {
        ctx.moveTo(0, y + 0.5)
        ctx.lineTo(w, y + 0.5)
      }
      ctx.stroke()
      ctx.restore()
    },
  },
  {
    id: 'glass-stage',
    name: 'Glass Stage',
    group: 'gradient',
    css: 'background:linear-gradient(180deg,#141821 0%,#0B0B10 60%),radial-gradient(ellipse 60% 30% at 50% 100%,rgba(200,245,66,0.12),transparent 70%);',
    paint: (ctx, w, h) => {
      const g = ctx.createLinearGradient(0, 0, 0, h)
      g.addColorStop(0, '#141821')
      g.addColorStop(0.6, '#0B0B10')
      ctx.fillStyle = g
      ctx.fillRect(0, 0, w, h)
      radial(ctx, w, h, 0.5, 1, 0.5, 'rgba(200,245,66,0.14)', 'rgba(200,245,66,0)')
    },
  },
  {
    id: 'violet-dusk',
    name: 'Violet Dusk',
    group: 'gradient',
    css: 'background:linear-gradient(160deg,#1b1430 0%,#120f1f 45%,#0B0B10 100%);',
    paint: (ctx, w, h) => {
      const g = ctx.createLinearGradient(0, 0, w * 0.5, h)
      g.addColorStop(0, '#1b1430')
      g.addColorStop(0.45, '#120f1f')
      g.addColorStop(1, '#0B0B10')
      ctx.fillStyle = g
      ctx.fillRect(0, 0, w, h)
      radial(ctx, w, h, 0.75, 0.15, 0.45, 'rgba(120,88,232,0.20)', 'rgba(120,88,232,0)')
    },
  },
  {
    id: 'studio-white',
    name: 'Studio White',
    group: 'solid',
    css: 'background:#F4F1EA;',
    paint: (ctx, w, h) => fill(ctx, w, h, '#F4F1EA'),
  },
]

export function backgroundById(id: string): StudioBackground {
  return STUDIO_BACKGROUNDS.find((b) => b.id === id) ?? STUDIO_BACKGROUNDS[0]
}
