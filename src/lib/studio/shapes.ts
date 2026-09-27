/**
 * Shape library — vector shapes drawn natively by the renderer.
 *
 * Every shape is built as sampled polylines in a unit box (−0.5…0.5), so the
 * same geometry drives fill, stroke and a length-exact "draw-on" (the stroke
 * drawing itself, e.g. the curved arrow between a before/after pair).
 * Pure + deterministic: no randomness, no clock.
 *
 * `use` is written for an editor/agent: where a professional would reach for
 * the shape, so the automation can pick shapes by purpose.
 */

export type Pt = [number, number]
export type SubPath = { pts: Pt[]; closed: boolean }
export type ShapeGeom = SubPath[]

export type ShapeCategory = 'basic' | 'polygon' | 'arrow' | 'callout' | 'emphasis' | 'ui' | 'symbol' | 'frame' | 'line' | 'organic'

export type ShapeDef = {
  id: string
  name: string
  category: ShapeCategory
  /** Where editors use it — read by the agent. */
  use: string
  /** Stroke-only by nature (arrows drawn as lines, scribbles, brackets). */
  strokeOnly?: boolean
  /** Default height/width in px ratio. */
  aspect: number
  takesSides?: boolean
  takesRadius?: boolean
  build: (o: { sides: number; radius: number; aspect: number }) => ShapeGeom
  tags: string[]
}

const TAU = Math.PI * 2
const closed = (pts: Pt[]): SubPath => ({ pts, closed: true })
const open = (pts: Pt[]): SubPath => ({ pts, closed: false })

function ellipse(rx = 0.5, ry = 0.5, cx = 0, cy = 0, n = 96, a0 = 0, a1 = TAU): Pt[] {
  const out: Pt[] = []
  for (let i = 0; i <= n; i++) {
    const a = a0 + ((a1 - a0) * i) / n
    out.push([cx + Math.cos(a) * rx, cy + Math.sin(a) * ry])
  }
  return out
}

function polygon(sides: number, r = 0.5, rot = -Math.PI / 2): Pt[] {
  const out: Pt[] = []
  for (let i = 0; i < sides; i++) out.push([Math.cos(rot + (TAU * i) / sides) * r, Math.sin(rot + (TAU * i) / sides) * r])
  return out
}

function star(points: number, outer = 0.5, inner = 0.22, rot = -Math.PI / 2): Pt[] {
  const out: Pt[] = []
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 === 0 ? outer : inner
    const a = rot + (Math.PI * i) / points
    out.push([Math.cos(a) * r, Math.sin(a) * r])
  }
  return out
}

/** Rounded rectangle in unit box scaled by aspect so corners stay round in px. */
function roundRect(radius: number, aspect: number): Pt[] {
  // Work in px-like space: width 1, height aspect; convert back to unit box.
  const w = 1, h = aspect
  const r = Math.max(0, Math.min(0.5, radius)) * Math.min(w, h)
  const out: Pt[] = []
  const corner = (cx: number, cy: number, a0: number) => {
    for (let i = 0; i <= 12; i++) { const a = a0 + (Math.PI / 2) * (i / 12); out.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]) }
  }
  corner(w / 2 - r, -h / 2 + r, -Math.PI / 2)
  corner(w / 2 - r, h / 2 - r, 0)
  corner(-w / 2 + r, h / 2 - r, Math.PI / 2)
  corner(-w / 2 + r, -h / 2 + r, Math.PI)
  return out.map(([x, y]) => [x, y / aspect])
}

function quad(p0: Pt, c: Pt, p1: Pt, n = 48): Pt[] {
  const out: Pt[] = []
  for (let i = 0; i <= n; i++) {
    const t = i / n, u = 1 - t
    out.push([u * u * p0[0] + 2 * u * t * c[0] + t * t * p1[0], u * u * p0[1] + 2 * u * t * c[1] + t * t * p1[1]])
  }
  return out
}

function cubic(p0: Pt, c1: Pt, c2: Pt, p1: Pt, n = 64): Pt[] {
  const out: Pt[] = []
  for (let i = 0; i <= n; i++) {
    const t = i / n, u = 1 - t
    out.push([
      u * u * u * p0[0] + 3 * u * u * t * c1[0] + 3 * u * t * t * c2[0] + t * t * t * p1[0],
      u * u * u * p0[1] + 3 * u * u * t * c1[1] + 3 * u * t * t * c2[1] + t * t * t * p1[1],
    ])
  }
  return out
}

/** Arrow head as an open "V" at the end of a path, pointing along its last segment. */
function head(pts: Pt[], size = 0.14): SubPath {
  const [x1, y1] = pts[pts.length - 1]
  const [x0, y0] = pts[Math.max(0, pts.length - 4)]
  const a = Math.atan2(y1 - y0, x1 - x0)
  return open([[x1 + Math.cos(a + 2.6) * size, y1 + Math.sin(a + 2.6) * size], [x1, y1], [x1 + Math.cos(a - 2.6) * size, y1 + Math.sin(a - 2.6) * size]])
}

const heart = (): Pt[] => {
  const out: Pt[] = []
  for (let i = 0; i <= 120; i++) {
    const t = (TAU * i) / 120
    const x = 16 * Math.sin(t) ** 3
    const y = -(13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t))
    out.push([x / 34, y / 34 + 0.03])
  }
  return out
}

/** Deterministic organic blob (sum of sines — no randomness). */
const blob = (lobes = 5): Pt[] => {
  const out: Pt[] = []
  for (let i = 0; i <= 120; i++) {
    const a = (TAU * i) / 120
    const r = 0.42 + 0.05 * Math.sin(a * lobes) + 0.03 * Math.sin(a * (lobes + 2) + 1.3)
    out.push([Math.cos(a) * r, Math.sin(a) * r])
  }
  return out
}

export const SHAPES: ShapeDef[] = [
  // basic
  { id: 'rectangle', name: 'Rectangle', category: 'basic', aspect: 0.6, takesRadius: true, use: 'Colour blocks, split-screen panels, text backing plates.', tags: ['box', 'panel', 'block'], build: (o) => [closed(roundRect(o.radius, o.aspect))] },
  { id: 'rounded-rect', name: 'Rounded card', category: 'basic', aspect: 0.6, takesRadius: true, use: 'Card behind a stat or quote, UI mock panels.', tags: ['card', 'panel'], build: (o) => [closed(roundRect(o.radius || 0.18, o.aspect))] },
  { id: 'pill', name: 'Pill', category: 'basic', aspect: 0.3, use: 'Tags, labels, buttons, “NEW” chips.', tags: ['tag', 'chip', 'button', 'label'], build: (o) => [closed(roundRect(0.5, o.aspect))] },
  { id: 'circle', name: 'Circle', category: 'basic', aspect: 1, use: 'Spotlight dots, avatars backing, focus markers.', tags: ['dot', 'round'], build: () => [closed(ellipse())] },
  { id: 'ellipse', name: 'Ellipse', category: 'basic', aspect: 0.6, use: 'Soft glow plates under products, stage floor shadows.', tags: ['oval'], build: () => [closed(ellipse())] },
  { id: 'ring', name: 'Ring', category: 'basic', aspect: 1, strokeOnly: true, use: 'Highlight a face/object, loading ring, radar ping.', tags: ['donut', 'highlight', 'loader'], build: () => [closed(ellipse(0.46, 0.46))] },
  { id: 'arc', name: 'Arc', category: 'basic', aspect: 1, strokeOnly: true, use: 'Progress gauges, stat dials (draw-on = fill up).', tags: ['gauge', 'progress', 'dial'], build: () => [open(ellipse(0.46, 0.46, 0, 0, 72, Math.PI * 0.75, Math.PI * 2.25))] },
  { id: 'semicircle', name: 'Semicircle', category: 'basic', aspect: 0.5, use: 'Horizon plates, half-dial backgrounds.', tags: ['half'], build: () => [closed([...ellipse(0.5, 1, 0, 0.5, 64, Math.PI, TAU)])] },
  // polygons
  { id: 'triangle', name: 'Triangle', category: 'polygon', aspect: 0.9, use: 'Direction cues, warning signs, geometric accents.', tags: ['tri'], build: () => [closed(polygon(3))] },
  { id: 'diamond', name: 'Diamond', category: 'polygon', aspect: 1, use: 'Bullet markers, premium accents, list icons.', tags: ['rhombus', 'bullet'], build: () => [closed([[0, -0.5], [0.5, 0], [0, 0.5], [-0.5, 0]])] },
  { id: 'pentagon', name: 'Pentagon', category: 'polygon', aspect: 1, use: 'Badges, geometric patterns.', tags: [], build: () => [closed(polygon(5))] },
  { id: 'hexagon', name: 'Hexagon', category: 'polygon', aspect: 1, use: 'Tech/science motifs, honeycomb feature grids.', tags: ['honeycomb', 'tech'], build: () => [closed(polygon(6, 0.5, 0))] },
  { id: 'octagon', name: 'Octagon', category: 'polygon', aspect: 1, use: 'Stop signs, bold badges.', tags: ['stop'], build: () => [closed(polygon(8, 0.5, Math.PI / 8))] },
  { id: 'polygon', name: 'Polygon (any sides)', category: 'polygon', aspect: 1, takesSides: true, use: 'Any regular polygon 3–24 sides.', tags: ['n-gon'], build: (o) => [closed(polygon(Math.max(3, Math.min(24, o.sides || 6))))] },
  { id: 'parallelogram', name: 'Parallelogram', category: 'polygon', aspect: 0.35, use: 'Dynamic lower-third bars, sports graphics.', tags: ['slant', 'lower third'], build: () => [closed([[-0.38, -0.5], [0.5, -0.5], [0.38, 0.5], [-0.5, 0.5]])] },
  { id: 'trapezoid', name: 'Trapezoid', category: 'polygon', aspect: 0.5, use: 'Tabs, stage/perspective plates.', tags: [], build: () => [closed([[-0.32, -0.5], [0.32, -0.5], [0.5, 0.5], [-0.5, 0.5]])] },
  // stars / bursts
  { id: 'star', name: 'Star', category: 'emphasis', aspect: 1, takesSides: true, use: 'Ratings (★★★★★ above testimonials), achievements.', tags: ['rating', 'review', 'favourite'], build: (o) => [closed(star(Math.max(3, Math.min(24, o.sides || 5))))] },
  { id: 'sparkle', name: 'Sparkle', category: 'emphasis', aspect: 1, use: 'Magic/AI moments, “new” shine, twinkles near a product.', tags: ['twinkle', 'shine', 'ai', 'magic'], build: () => [closed(star(4, 0.5, 0.1, -Math.PI / 2))] },
  { id: 'burst', name: 'Starburst badge', category: 'emphasis', aspect: 1, takesSides: true, use: 'SALE / NEW / −50% stickers, price call-outs.', tags: ['sale', 'badge', 'sticker', 'price'], build: (o) => [closed(star(Math.max(8, o.sides || 14), 0.5, 0.4))] },
  { id: 'seal', name: 'Scalloped seal', category: 'emphasis', aspect: 1, use: 'Guarantee / certified / award seals.', tags: ['award', 'guarantee', 'certified'], build: () => [closed(ellipse(0.5, 0.5, 0, 0, 180).map(([x, y], i) => { const k = 1 - 0.05 * (1 + Math.cos((i / 180) * TAU * 18)) / 2; return [x * k, y * k] as Pt }))] },
  { id: 'sunburst', name: 'Sunburst rays', category: 'emphasis', aspect: 1, strokeOnly: true, use: 'Behind a reveal (logo, product, number) for energy.', tags: ['rays', 'reveal', 'energy'], build: () => Array.from({ length: 16 }, (_, i) => { const a = (TAU * i) / 16; return open([[Math.cos(a) * 0.2, Math.sin(a) * 0.2], [Math.cos(a) * 0.5, Math.sin(a) * 0.5]]) }) },
  // arrows
  { id: 'arrow', name: 'Arrow', category: 'arrow', aspect: 0.4, strokeOnly: true, use: 'Point at a detail, “swipe”, next step.', tags: ['point', 'direction'], build: () => { const p: Pt[] = [[-0.5, 0], [0.5, 0]]; return [open(p), head(p, 0.3)] } },
  { id: 'block-arrow', name: 'Block arrow', category: 'arrow', aspect: 0.5, use: 'Bold direction, process flows, “before → after”.', tags: ['process', 'flow'], build: () => [closed([[-0.5, -0.18], [0.1, -0.18], [0.1, -0.45], [0.5, 0], [0.1, 0.45], [0.1, 0.18], [-0.5, 0.18]])] },
  { id: 'curved-arrow', name: 'Curved arrow', category: 'arrow', aspect: 0.45, strokeOnly: true, use: 'Before → after transformations, “look here” loops (draw-on).', tags: ['before after', 'transformation', 'swoosh'], build: () => { const p = quad([-0.45, -0.3], [0, 0.75], [0.45, -0.3]); return [open(p), head(p, 0.2)] } },
  { id: 'loop-arrow', name: 'Loop arrow', category: 'arrow', aspect: 0.6, strokeOnly: true, use: 'Hand-drawn “check this out” pointer with a loop.', tags: ['hand drawn', 'doodle', 'pointer'], build: () => { const p = cubic([-0.5, 0.3], [0.1, 0.6], [0.2, -0.6], [-0.05, -0.1], 48).concat(cubic([-0.05, -0.1], [-0.3, 0.3], [0.2, 0.3], [0.5, -0.3], 48).slice(1)); return [open(p), head(p, 0.16)] } },
  { id: 'double-arrow', name: 'Double arrow', category: 'arrow', aspect: 0.3, strokeOnly: true, use: 'Comparisons, sizes, “vs”.', tags: ['compare', 'vs', 'width'], build: () => { const p: Pt[] = [[-0.5, 0], [0.5, 0]]; return [open(p), head(p, 0.3), head([[0.5, 0], [-0.5, 0]], 0.3)] } },
  { id: 'chevron', name: 'Chevron', category: 'arrow', aspect: 1, strokeOnly: true, use: 'Next / swipe up hints, list bullets.', tags: ['next', 'swipe'], build: () => [open([[-0.25, -0.45], [0.25, 0], [-0.25, 0.45]])] },
  { id: 'elbow-arrow', name: 'Elbow arrow', category: 'arrow', aspect: 0.8, strokeOnly: true, use: 'Callout leaders from a label to a feature.', tags: ['callout', 'leader'], build: () => { const p: Pt[] = [[-0.5, -0.4], [0.2, -0.4], [0.2, 0.45]]; return [open(p), head(p, 0.18)] } },
  // callouts
  { id: 'speech-bubble', name: 'Speech bubble', category: 'callout', aspect: 0.7, use: 'Quotes, dialogue, testimonial snippets, comments.', tags: ['quote', 'chat', 'comment', 'dialogue'], build: () => { const r = roundRect(0.22, 0.55).map(([x, y]) => [x, y * 0.78 - 0.1] as Pt); return [closed(r), closed([[-0.2, 0.28], [-0.32, 0.5], [-0.02, 0.29]])] } },
  { id: 'thought-bubble', name: 'Thought bubble', category: 'callout', aspect: 0.75, use: 'Inner thoughts, ideas, “what if…”.', tags: ['idea', 'think'], build: () => [closed(ellipse(0.5, 0.33, 0, -0.1)), closed(ellipse(0.07, 0.07, -0.25, 0.32)), closed(ellipse(0.04, 0.04, -0.35, 0.44))] },
  { id: 'callout-box', name: 'Callout label', category: 'callout', aspect: 0.4, use: 'Labels pointing at product parts / UI elements.', tags: ['label', 'annotation'], build: () => [closed(roundRect(0.3, 0.4).map(([x, y]) => [x, y * 0.8] as Pt)), open([[-0.35, 0.4], [-0.5, 0.5]])] },
  { id: 'lower-third', name: 'Lower-third bar', category: 'callout', aspect: 0.16, use: 'Name + title of a speaker, location tags.', tags: ['name', 'title', 'speaker', 'lower third'], build: () => [closed([[-0.5, -0.5], [0.46, -0.5], [0.5, 0.5], [-0.5, 0.5]])] },
  // emphasis (hand-drawn)
  { id: 'underline', name: 'Swoosh underline', category: 'emphasis', aspect: 0.15, strokeOnly: true, use: 'Underline a key word in a caption (draw-on under the word).', tags: ['underline', 'highlight word', 'emphasis'], build: () => [open(cubic([-0.5, 0.1], [-0.15, -0.35], [0.2, 0.5], [0.5, -0.2]))] },
  { id: 'circle-scribble', name: 'Circle scribble', category: 'emphasis', aspect: 0.5, strokeOnly: true, use: 'Circle a word, price or detail like a marker pen.', tags: ['circle word', 'marker', 'highlight'], build: () => [open(ellipse(0.5, 0.45, 0, 0, 120, -0.3, TAU + 0.5).map(([x, y], i) => [x * (1 + i * 0.0006), y * (1 - i * 0.0008)] as Pt))] },
  { id: 'strike', name: 'Strikethrough', category: 'emphasis', aspect: 0.12, strokeOnly: true, use: 'Cross out an old price or a myth (“~~$99~~ $49”).', tags: ['cross out', 'old price', 'myth'], build: () => [open([[-0.5, 0.15], [0.5, -0.15]])] },
  { id: 'highlight-bar', name: 'Marker highlight', category: 'emphasis', aspect: 0.22, use: 'Highlighter bar behind words (the purple box look).', tags: ['highlighter', 'box', 'marker'], build: () => [closed([[-0.5, -0.4], [0.5, -0.5], [0.48, 0.45], [-0.48, 0.5]])] },
  { id: 'brackets', name: 'Corner brackets', category: 'frame', aspect: 0.6, strokeOnly: true, use: 'Frame/focus on a subject (viewfinder look), tech HUD.', tags: ['viewfinder', 'focus', 'hud', 'frame'], build: () => { const s = 0.18; return [open([[-0.5, -0.5 + s], [-0.5, -0.5], [-0.5 + s, -0.5]]), open([[0.5 - s, -0.5], [0.5, -0.5], [0.5, -0.5 + s]]), open([[0.5, 0.5 - s], [0.5, 0.5], [0.5 - s, 0.5]]), open([[-0.5 + s, 0.5], [-0.5, 0.5], [-0.5, 0.5 - s]])] } },
  { id: 'frame', name: 'Frame border', category: 'frame', aspect: 0.6, strokeOnly: true, takesRadius: true, use: 'Border around a photo/screen recording, polaroid frames.', tags: ['border', 'photo'], build: (o) => [closed(roundRect(o.radius || 0.04, o.aspect))] },
  // ui
  { id: 'button', name: 'Button', category: 'ui', aspect: 0.28, takesRadius: true, use: 'CTA buttons (“Get started”, “Shop now”) — pair with a cursor click.', tags: ['cta', 'click', 'button'], build: (o) => [closed(roundRect(o.radius || 0.35, o.aspect))] },
  { id: 'progress-bar', name: 'Progress bar', category: 'ui', aspect: 0.06, use: 'Loading, goal progress, video chapter progress (grow).', tags: ['progress', 'loader', 'goal'], build: () => [closed(roundRect(0.5, 0.06))] },
  { id: 'toggle', name: 'Toggle', category: 'ui', aspect: 0.5, use: 'On/off feature moments in product demos.', tags: ['switch', 'on off'], build: () => [closed(roundRect(0.5, 0.5)), closed(ellipse(0.2, 0.4, 0.25, 0))] },
  { id: 'play', name: 'Play button', category: 'ui', aspect: 1, use: 'Video thumbnails, “watch” cues.', tags: ['video', 'watch'], build: () => [closed(ellipse()), closed([[-0.12, -0.2], [0.22, 0], [-0.12, 0.2]])] },
  { id: 'browser', name: 'Browser window', category: 'ui', aspect: 0.62, strokeOnly: true, use: 'Frame website/screen recordings in a SaaS demo.', tags: ['website', 'window', 'saas'], build: () => [closed(roundRect(0.04, 0.62)), open([[-0.5, -0.36], [0.5, -0.36]]), closed(ellipse(0.018, 0.03, -0.45, -0.43, 16)), closed(ellipse(0.018, 0.03, -0.4, -0.43, 16)), closed(ellipse(0.018, 0.03, -0.35, -0.43, 16))] },
  // symbols
  { id: 'check', name: 'Check mark', category: 'symbol', aspect: 1, strokeOnly: true, use: 'Benefits lists, “done”, correct answer (draw-on).', tags: ['tick', 'yes', 'done', 'benefit'], build: () => [open([[-0.4, 0.02], [-0.12, 0.3], [0.42, -0.3]])] },
  { id: 'cross', name: 'Cross', category: 'symbol', aspect: 1, strokeOnly: true, use: 'Myths, wrong way, “don’t do this”.', tags: ['x', 'no', 'wrong'], build: () => [open([[-0.35, -0.35], [0.35, 0.35]]), open([[0.35, -0.35], [-0.35, 0.35]])] },
  { id: 'plus', name: 'Plus', category: 'symbol', aspect: 1, use: 'Add-ons, bonuses, “and more”.', tags: ['add', 'bonus'], build: () => [closed([[-0.12, -0.5], [0.12, -0.5], [0.12, -0.12], [0.5, -0.12], [0.5, 0.12], [0.12, 0.12], [0.12, 0.5], [-0.12, 0.5], [-0.12, 0.12], [-0.5, 0.12], [-0.5, -0.12], [-0.12, -0.12]])] },
  { id: 'heart', name: 'Heart', category: 'symbol', aspect: 0.9, use: 'Likes, love, wellness, favourite moments.', tags: ['like', 'love'], build: () => [closed(heart())] },
  { id: 'lightning', name: 'Lightning bolt', category: 'symbol', aspect: 1.4, use: 'Speed, energy, power features.', tags: ['fast', 'power', 'energy'], build: () => [closed([[0.1, -0.5], [-0.3, 0.05], [-0.02, 0.05], [-0.12, 0.5], [0.3, -0.08], [0.02, -0.08]])] },
  { id: 'pin', name: 'Location pin', category: 'symbol', aspect: 1.3, use: 'Places, store locations, travel maps.', tags: ['map', 'location', 'place'], build: () => [closed([...ellipse(0.36, 0.36 / 1.3, 0, -0.18, 48, Math.PI * 0.8, Math.PI * 2.2), [0, 0.5]]), closed(ellipse(0.12, 0.09, 0, -0.2, 24))] },
  { id: 'quote-marks', name: 'Quote marks', category: 'symbol', aspect: 0.7, use: 'Open a testimonial or pull-quote.', tags: ['testimonial', 'quote'], build: () => [closed([...ellipse(0.16, 0.2, -0.24, 0, 32), [-0.08, 0.1], [-0.3, 0.45]]), closed([...ellipse(0.16, 0.2, 0.24, 0, 32), [0.4, 0.1], [0.18, 0.45]])] },
  { id: 'cloud', name: 'Cloud', category: 'symbol', aspect: 0.6, use: 'Cloud products, dreamy/soft moments.', tags: ['saas', 'weather'], build: () => [closed([...ellipse(0.22, 0.3, -0.25, 0.1, 30, Math.PI / 2, Math.PI * 1.5), ...ellipse(0.26, 0.4, 0, -0.1, 30, Math.PI, TAU), ...ellipse(0.22, 0.3, 0.25, 0.1, 30, -Math.PI / 2, Math.PI / 2)])] },
  // lines
  { id: 'line', name: 'Line', category: 'line', aspect: 0.02, strokeOnly: true, use: 'Dividers, timeline rules, underlines.', tags: ['divider', 'rule'], build: () => [open([[-0.5, 0], [0.5, 0]])] },
  { id: 'wave', name: 'Wave line', category: 'line', aspect: 0.2, strokeOnly: true, use: 'Audio/voice motifs, playful dividers.', tags: ['audio', 'squiggle'], build: () => [open(Array.from({ length: 97 }, (_, i) => [-0.5 + i / 96, Math.sin((i / 96) * TAU * 3) * 0.4] as Pt))] },
  { id: 'zigzag', name: 'Zigzag', category: 'line', aspect: 0.2, strokeOnly: true, use: 'Energetic accents, retro graphics.', tags: ['retro'], build: () => [open(Array.from({ length: 11 }, (_, i) => [-0.5 + i / 10, i % 2 ? 0.45 : -0.45] as Pt))] },
  { id: 'spiral', name: 'Spiral', category: 'line', aspect: 1, strokeOnly: true, use: 'Hypnotic transitions, “deep dive” moments.', tags: ['hypnotic'], build: () => [open(Array.from({ length: 241 }, (_, i) => { const a = (i / 240) * TAU * 3.5; const r = (i / 240) * 0.5; return [Math.cos(a) * r, Math.sin(a) * r] as Pt }))] },
  // organic
  { id: 'blob', name: 'Organic blob', category: 'organic', aspect: 1, takesSides: true, use: 'Soft backdrops behind cut-out people/products (creator style).', tags: ['backdrop', 'soft', 'cutout'], build: (o) => [closed(blob(o.sides || 5))] },
]

export function shapeById(id: string): ShapeDef | undefined {
  return SHAPES.find((s) => s.id === id)
}

const geomCache = new Map<string, ShapeGeom>()
export function shapeGeometry(id: string, o: { sides?: number; radius?: number; aspect: number }): ShapeGeom {
  const def = shapeById(id) ?? SHAPES[0]
  const key = `${def.id}|${o.sides ?? 0}|${(o.radius ?? 0).toFixed(3)}|${o.aspect.toFixed(3)}`
  let g = geomCache.get(key)
  if (!g) {
    g = def.build({ sides: o.sides ?? 0, radius: o.radius ?? 0, aspect: o.aspect })
    if (geomCache.size > 400) geomCache.clear()
    geomCache.set(key, g)
  }
  return g
}

export function pathLength(p: SubPath): number {
  let len = 0
  for (let i = 1; i < p.pts.length; i++) len += Math.hypot(p.pts[i][0] - p.pts[i - 1][0], p.pts[i][1] - p.pts[i - 1][1])
  if (p.closed && p.pts.length > 1) len += Math.hypot(p.pts[0][0] - p.pts[p.pts.length - 1][0], p.pts[0][1] - p.pts[p.pts.length - 1][1])
  return len
}

/** Points of the first `fraction` of a subpath's length (for draw-on). */
export function partialPath(p: SubPath, fraction: number): Pt[] {
  const pts = p.closed ? [...p.pts, p.pts[0]] : p.pts
  if (fraction >= 1) return pts
  const total = pathLength(p)
  let left = total * Math.max(0, fraction)
  const out: Pt[] = [pts[0]]
  for (let i = 1; i < pts.length && left > 0; i++) {
    const seg = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1])
    if (seg <= left) { out.push(pts[i]); left -= seg } else {
      const k = left / seg
      out.push([pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * k, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * k])
      left = 0
    }
  }
  return out
}

/** Pick shapes for a purpose (agent helper): matches name, use and tags. */
export function shapesFor(purpose: string, limit = 5): ShapeDef[] {
  const words = purpose.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2)
  return SHAPES.map((s) => {
    const hay = `${s.name} ${s.use} ${s.tags.join(' ')}`.toLowerCase()
    return { s, score: words.reduce((n, w) => n + (hay.includes(w) ? (s.tags.some((t) => t.includes(w)) ? 3 : 1) : 0), 0) }
  }).filter((x) => x.score > 0).sort((a, b) => b.score - a.score || a.s.id.localeCompare(b.s.id)).slice(0, limit).map((x) => x.s)
}
