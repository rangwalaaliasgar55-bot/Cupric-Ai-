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
  group: 'gradient' | 'pattern' | 'solid'
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
