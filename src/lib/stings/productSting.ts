/**
 * Product Sting — a 12 s, 1080×1080 keynote-style product sting (f0–f359 at
 * 29.97 fps; the 59.94 master samples half frames).
 *
 * Everything the film draws lives inside `stingProgram`, a single
 * self-contained function with no imports or outer references. That lets the
 * exact same code run in three places:
 *   1. the in-app preview/stills (Canvas 2D),
 *   2. the exported HTML (window.__seek(t) → the desktop Render queue),
 *   3. the Node stills/film checks (@napi-rs/canvas).
 * Every value is a pure, continuous function of the frame number: keyframe
 * tables + easing, seeded hashes, no timers, no Math.random, no clock.
 */

export const STING = {
  width: 1080, height: 1080, fps: 30000 / 1001, masterFps: 60000 / 1001, frames: 360,
  durationSec: 12.075, bpm: 124, cuts: [72, 101, 159, 187, 215, 245, 301] as const,
  stills: [40, 86, 150, 230] as const,
}
/** Music beat k in seconds (124 BPM, first downbeat at 48 ms). */
export const beatSec = (k: number) => 0.048 + 0.4838 * k
export const frameSec = (f: number) => f / STING.fps

export type StingPalette = {
  page: string; haze: string; ice: string; deep: string; sky: string; navy: string
  a1: string; a2: string; a3: string; white: string; floor: string; ink: string; grey: string
}
export const DEFAULT_PALETTE: StingPalette = {
  page: '#FDFDFB', haze: '#B7CFEB', ice: '#E6F0FA', deep: '#294376', sky: '#769CC2', navy: '#1E2F52',
  a1: '#2F6BFF', a2: '#3CC8F0', a3: '#4ED6A0', white: '#FFFFFF', floor: '#DBEEFD', ink: '#1D1D1F', grey: '#BCBCBA',
}

export type StingInputs = {
  product: string
  hub: string
  /** Data URL of the user's logo; null = the built-in viewfinder mark. */
  logoDataUrl: string | null
  markText: string
  /** Up to three brand colours mapped onto accent roles (validated). */
  brandColors: string[]
  prompt: string
  pageTitle: string
  pageBody: string
  keyPhrase: string
  cards: [string, string]
  music: string
}

export const DEFAULT_STING: StingInputs = {
  product: 'Frame by Frame', hub: 'Whop', logoDataUrl: null, markText: 'FF', brandColors: [],
  prompt: 'Make a launch video for my app',
  pageTitle: '2.1 Choose a reference',
  pageBody: 'Every great launch starts with a reference you love. Pick one, study it frame for frame, and let Frame by Frame turn it into your own film in minutes.',
  keyPhrase: 'frame for frame',
  cards: ['Launch', 'Sound'],
  music: 'Mixkit “Rising Forest” (free house) slowed to 124 BPM — supply the file; it is not bundled',
}

const HEX = /^#[0-9a-f]{6}$/i
export function hexToHsl(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16)
  const r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2
  if (max === min) return [0, 0, l]
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  const h = max === r ? ((g - b) / d + (g < b ? 6 : 0)) : max === g ? (b - r) / d + 2 : (r - g) / d + 4
  return [h * 60, s, l]
}
/** The brief bans purple, violet, magenta and orange. */
export function isBannedHue(hex: string): boolean {
  const [h, s] = hexToHsl(hex)
  if (s < 0.18) return false
  return (h >= 255 && h <= 345) || (h >= 12 && h <= 48)
}

export function paletteFor(inputs: Pick<StingInputs, 'brandColors'>): { palette: StingPalette; rejected: string[] } {
  const rejected: string[] = []
  const ok = inputs.brandColors.filter((c) => HEX.test(c)).filter((c) => (isBannedHue(c) ? (rejected.push(c), false) : true)).slice(0, 3)
  const p = { ...DEFAULT_PALETTE }
  if (ok[0]) p.a1 = ok[0]
  if (ok[1]) p.a2 = ok[1]
  if (ok[2]) p.a3 = ok[2]
  return { palette: p, rejected }
}

export function sanitizeSting(raw: Partial<StingInputs> | null | undefined): StingInputs {
  const o = raw ?? {}
  const s = (v: unknown, d: string, max: number) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : d)
  const d = DEFAULT_STING
  const body = s(o.pageBody, d.pageBody, 400)
  let key = s(o.keyPhrase, d.keyPhrase, 60)
  if (!body.toLowerCase().includes(key.toLowerCase())) key = body.split(/\s+/).slice(0, 3).join(' ')
  const cards = Array.isArray(o.cards) ? o.cards : d.cards
  return {
    product: s(o.product, d.product, 40), hub: s(o.hub, d.hub, 20),
    logoDataUrl: typeof o.logoDataUrl === 'string' && /^data:image\/(png|jpeg|webp|svg\+xml);base64,/.test(o.logoDataUrl) ? o.logoDataUrl : null,
    markText: s(o.markText, d.markText, 3), brandColors: Array.isArray(o.brandColors) ? o.brandColors.filter((c) => typeof c === 'string' && HEX.test(c)).slice(0, 3) : [],
    prompt: s(o.prompt, d.prompt, 60), pageTitle: s(o.pageTitle, d.pageTitle, 48), pageBody: body, keyPhrase: key,
    cards: [s(cards[0], d.cards[0], 14), s(cards[1], d.cards[1], 14)], music: s(o.music, d.music, 160),
  }
}

/** Environment the program needs: an offscreen canvas factory, a font family and an optional logo image. */
export type StingEnv = { makeCanvas: (w: number, h: number) => any; font: string; logo?: any }
export type StingProgram = { frames: number; seek: (ctx: any, frame: number) => void }

/* eslint-disable */
// NOTE: keep this function fully self-contained — it is serialised into the exported HTML.
export function stingProgram(I: any, P: any, env: any): StingProgram {
  const W = 1080
  const F = env.font
  const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v)
  const lerp = (a: number, b: number, t: number) => a + (b - a) * t
  const E: any = {
    lin: (t: number) => t,
    out: (t: number) => 1 - Math.pow(1 - t, 3),
    in: (t: number) => t * t * t,
    inout: (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
    expo: (t: number) => (t >= 1 ? 1 : 1 - Math.pow(2, -9 * t)),
    sine: (t: number) => 0.5 - Math.cos(Math.PI * t) / 2,
  }
  function kf(f: number, tab: number[][], ease?: string): number {
    const e = E[ease || 'lin']
    if (f <= tab[0][0]) return tab[0][1]
    for (let i = 0; i < tab.length - 1; i++) {
      const a = tab[i], b = tab[i + 1]
      if (f <= b[0]) return lerp(a[1], b[1], e((f - a[0]) / (b[0] - a[0] || 1)))
    }
    return tab[tab.length - 1][1]
  }
  /** Exponential ease-out approach: covers `k` of the remaining distance per frame. */
  const approach = (f: number, f0: number, from: number, to: number, k: number) => (f <= f0 ? from : to + (from - to) * Math.pow(1 - k, f - f0))
  const hash = (i: number) => { const x = Math.sin(i * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x) }
  function hex(c: string, a: number) {
    const n = parseInt(c.slice(1), 16)
    return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')'
  }
  function mix(c1: string, c2: string, t: number) {
    const a = parseInt(c1.slice(1), 16), b = parseInt(c2.slice(1), 16)
    const ch = (s: number) => Math.round(lerp((a >> s) & 255, (b >> s) & 255, clamp(t, 0, 1)))
    return 'rgb(' + ch(16) + ',' + ch(8) + ',' + ch(0) + ')'
  }
  function rr(c: any, x: number, y: number, w: number, h: number, r: number) {
    r = Math.max(0, Math.min(r, w / 2, h / 2))
    c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r)
    c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath()
  }
  const pool: any[] = []
  let used = 0
  function layer() {
    if (!pool[used]) pool[used] = env.makeCanvas(W, W)
    const cv = pool[used++]
    const c = cv.getContext('2d')
    c.setTransform(1, 0, 0, 1, 0, 0); c.globalAlpha = 1; c.filter = 'none'; c.globalCompositeOperation = 'source-over'
    c.clearRect(0, 0, W, W)
    return { cv, c }
  }
  /** Composite a stage-sized layer with round blur `b` and a directional smear (dx, dy). */
  function put(c: any, cv: any, b: number, dx: number, dy: number, alpha?: number) {
    const a0 = alpha == null ? 1 : alpha
    const len = Math.hypot(dx, dy)
    const n = len < 1 ? 1 : Math.min(14, Math.ceil(len / 1.6) + 1)
    c.save()
    if (b > 0.05) c.filter = 'blur(' + b.toFixed(2) + 'px)'
    for (let i = 0; i < n; i++) {
      const t = n === 1 ? 0 : i / (n - 1) - 0.5
      c.globalAlpha = a0 * (n === 1 ? 1 : 1 / (i + 1))
      c.drawImage(cv, dx * t, dy * t)
    }
    c.restore()
  }
  function font(c: any, w: number, px: number) { c.font = w + ' ' + px.toFixed(2) + 'px ' + F }

  // ---------- shared art -------------------------------------------------
  function mark(c: any, cx: number, cy: number, s: number, color: string) {
    if (env.logo) {
      const img = env.logo, iw = img.width || 1, ih = img.height || 1, k = (s * 0.86) / Math.max(iw, ih)
      c.drawImage(img, cx - (iw * k) / 2, cy - (ih * k) / 2, iw * k, ih * k)
      return
    }
    const h = s * 0.43, arm = s * 0.16, lw = Math.max(1, s * 0.055)
    c.save(); c.strokeStyle = color; c.lineWidth = lw; c.lineCap = 'round'; c.lineJoin = 'round'
    for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      c.beginPath(); c.moveTo(cx + sx * h, cy + sy * (h - arm)); c.lineTo(cx + sx * h, cy + sy * h); c.lineTo(cx + sx * (h - arm), cy + sy * h); c.stroke()
    }
    c.fillStyle = color; font(c, 800, s * 0.34); c.textAlign = 'center'; c.textBaseline = 'middle'
    c.fillText(I.markText, cx, cy + s * 0.012)
    c.restore()
  }
  function cursor(c: any, x: number, y: number, rotDeg: number, sc: number) {
    c.save(); c.translate(x, y); c.rotate((rotDeg * Math.PI) / 180); c.scale(sc, sc)
    c.shadowColor = 'rgba(0,0,0,0.28)'; c.shadowBlur = 6; c.shadowOffsetY = 2
    c.beginPath(); c.moveTo(0, 0); c.lineTo(0, 30); c.lineTo(7.2, 23.6); c.lineTo(12.2, 35.4); c.lineTo(17.4, 33.2)
    c.lineTo(12.6, 21.8); c.lineTo(21.6, 21.4); c.closePath()
    c.fillStyle = '#000'; c.fill(); c.shadowColor = 'transparent'
    c.lineWidth = 2.2; c.strokeStyle = '#fff'; c.lineJoin = 'round'; c.stroke()
    c.restore()
  }
  /** Procedural cover art in the palette — no text, no photos. */
  function cover(c: any, x: number, y: number, w: number, h: number, v: number) {
    c.save(); c.beginPath(); c.rect(x, y, w, h); c.clip()
    const g = c.createLinearGradient(x, y, x, y + h)
    g.addColorStop(0, v === 1 ? P.navy : P.deep); g.addColorStop(1, v === 2 ? P.a2 : P.sky); c.fillStyle = g; c.fillRect(x, y, w, h)
    const orb = c.createRadialGradient(x + w * (0.25 + 0.5 * hash(v + 3)), y + h * 0.35, 0, x + w * 0.5, y + h * 0.35, w * 0.7)
    orb.addColorStop(0, hex(v === 2 ? P.a3 : P.a2, 0.85)); orb.addColorStop(1, hex(P.a1, 0)); c.fillStyle = orb; c.fillRect(x, y, w, h)
    c.strokeStyle = 'rgba(255,255,255,0.55)'; c.lineWidth = Math.max(1, w / 260)
    c.beginPath(); c.arc(x + w * (0.3 + 0.4 * hash(v + 9)), y + h * 0.62, h * 0.42, 0, Math.PI * 2); c.stroke()
    c.beginPath(); c.moveTo(x, y + h * 0.72); c.lineTo(x + w, y + h * 0.72); c.stroke()
    c.fillStyle = hex(P.white, 0.9)
    for (let i = 0; i < 3; i++) { const r = h * (0.05 + 0.04 * hash(v * 7 + i)); c.beginPath(); c.arc(x + w * (0.15 + 0.3 * i + 0.1 * hash(v + i)), y + h * (0.22 + 0.3 * hash(i + v * 3)), r, 0, Math.PI * 2); c.globalAlpha = 0.18; c.fill() }
    c.restore()
  }

  // ---------- S1 f0–71: header + hub window + click ---------------------
  function lockupLayout(c: any) {
    font(c, 500, 64); const nameW = c.measureText(I.product).width
    font(c, 600, 32); const pillText = 'on ' + I.hub; const pillW = c.measureText(pillText).width + 52
    const total = 132 + 26 + nameW + 24 + pillW
    return { nameW, pillW, pillText, s: Math.min(1.25, 589 / total) }
  }
  const lockY = (f: number) => (f <= 37 ? kf(f, [[0, 932], [2, 776], [5, 683], [10, 608], [24, 546], [37, 536]], 'lin') : 536 - (f - 37))
  function s1(c: any, f: number) {
    c.fillStyle = mix(P.haze, P.page, kf(f, [[0, 0], [28, 1]], 'out')); c.fillRect(0, 0, W, W)
    const fl = c.createRadialGradient(540, 1180, 0, 540, 1180, 620); fl.addColorStop(0, hex(P.floor, 1)); fl.addColorStop(1, hex(P.floor, 0)); c.fillStyle = fl; c.fillRect(0, 0, W, W)
    const z = f < 46 ? 1 : f < 60 ? kf(f, [[46, 1], [60, 1.2]], 'inout') : f < 61 ? 1.2 : kf(f, [[61, 1.2], [71, 1.04]], 'in')
    const world = layer()
    const w = world.c
    // hub window
    const wa = kf(f, [[0, 0], [14, 0], [15, 0.53], [19, 0.7], [24, 1]])
    if (wa > 0) {
      w.save(); w.globalAlpha = wa
      w.shadowColor = 'rgba(41,67,118,0.10)'; w.shadowBlur = 40; w.shadowOffsetY = 10
      rr(w, 408, 405, 900, 900, 93); w.fillStyle = '#FCFDFF'; w.fill(); w.shadowColor = 'transparent'
      w.save(); rr(w, 408, 405, 900, 900, 93); w.clip()
      w.fillStyle = '#F1F6FF'; w.fillRect(408, 405, 900, 104)
      const ig = w.createRadialGradient(760, 1180, 0, 760, 1180, 520); ig.addColorStop(0, hex(P.floor, 0.9)); ig.addColorStop(1, hex(P.floor, 0)); w.fillStyle = ig; w.fillRect(408, 509, 900, 700)
      rr(w, 600, 431, 330, 52, 26); w.fillStyle = '#FFFFFF'; w.fill(); w.strokeStyle = '#E3E8EF'; w.lineWidth = 1.5; w.stroke()
      w.strokeStyle = '#9AA6B8'; w.lineWidth = 3; w.beginPath(); w.arc(630, 456, 9, 0, Math.PI * 2); w.stroke(); w.beginPath(); w.moveTo(637, 463); w.lineTo(644, 470); w.stroke()
      font(w, 400, 22); w.fillStyle = '#9AA6B8'; w.textBaseline = 'middle'; w.fillText('Search', 656, 457)
      // icon column
      for (const [iy, a] of [[739, 1], [900, 0.35]]) {
        w.globalAlpha = wa * a; rr(w, 509, iy - 28, 56, 56, 16); w.fillStyle = iy === 739 ? P.ice : '#EEF1F5'; w.fill()
        w.strokeStyle = P.navy; w.lineWidth = 3; w.beginPath()
        if (iy === 739) { rr(w, 524, iy - 14, 26, 28, 4); w.stroke() } else { rr(w, 522, iy - 13, 30, 22, 8); w.stroke() }
      }
      w.globalAlpha = wa
      // course card
      w.shadowColor = 'rgba(41,67,118,0.10)'; w.shadowBlur = 24; w.shadowOffsetY = 6
      rr(w, 764, 700, 420, 520, 34); w.fillStyle = '#FFFFFF'; w.fill(); w.shadowColor = 'transparent'
      w.save(); rr(w, 764, 700, 420, 520, 34); w.clip(); cover(w, 764, 700, 420, 230, 0); w.restore()
      font(w, 600, 28); w.fillStyle = P.ink; w.textBaseline = 'alphabetic'; w.fillText(I.product, 790, 976)
      font(w, 400, 22); w.fillStyle = '#8A8F98'; w.fillText('Course · 8 lessons', 790, 1012)
      w.restore(); w.restore()
    }
    // header lockup
    const L = lockupLayout(w)
    const y = lockY(f), vy = lockY(f) - lockY(f - 0.5)
    const lay = layer(); const l = lay.c
    l.save(); l.translate(474, y); l.scale(L.s, L.s)
    // ice ring
    const ring = kf(f, [[53, 0], [58, 1]], 'out')
    if (ring > 0) { const rg = l.createRadialGradient(66, 0, 60, 66, 0, 87); rg.addColorStop(0, hex('#D5F3FF', ring)); rg.addColorStop(1, hex('#F7FEFF', 0)); l.fillStyle = rg; l.beginPath(); l.arc(66, 0, 87, 0, Math.PI * 2); l.fill() }
    l.beginPath(); l.arc(66, 0, 66, 0, Math.PI * 2); l.fillStyle = '#FBFCFE'; l.shadowColor = 'rgba(30,47,82,0.08)'; l.shadowBlur = 16; l.fill(); l.shadowColor = 'transparent'
    l.lineWidth = 1 / L.s; l.strokeStyle = '#E8E8EA'; l.stroke()
    mark(l, 66, 0, 132, P.ink)
    l.restore()
    put(w, lay.cv, Math.abs(vy) * 0.25, 0, vy * 1.4)
    // name + pill with their own entrance blur
    if (f >= 2) {
      const nl = layer(); const n = nl.c
      n.save(); n.translate(474, y); n.scale(L.s, L.s); font(n, 500, 64); n.fillStyle = P.ink; n.textBaseline = 'middle'; n.fillText(I.product, 158, 2); n.restore()
      put(w, nl.cv, kf(f, [[2, 10], [9, 0]], 'out') + Math.abs(vy) * 0.2, 0, vy * 1.4)
    }
    if (f >= 4) {
      const pl = layer(); const p = pl.c
      const dx = kf(f, [[4, 15], [13, 0]], 'out')
      p.save(); p.translate(474 + dx, y); p.scale(L.s, L.s)
      const px = 158 + L.nameW + 24
      rr(p, px, -31, L.pillW, 62, 31); p.fillStyle = '#2F2E2F'; p.fill()
      font(p, 600, 32); p.fillStyle = '#FFFFFF'; p.textBaseline = 'middle'; p.fillText(L.pillText, px + 26, 1); p.restore()
      put(w, pl.cv, kf(f, [[4, 18], [5, 12], [13, 0]], 'out') + Math.abs(vy) * 0.2, 0, vy * 1.4, kf(f, [[4, 0.4], [6, 1]]))
    }
    // cursor
    if (f >= 27) {
      const cx = f <= 44 ? kf(f, [[27, 891], [44, 770]], 'out') : f <= 56 ? kf(f, [[44, 770], [56, 629]], 'inout') : kf(f, [[56, 629], [59, 587], [71, 555]], 'out')
      const cy = f <= 44 ? kf(f, [[27, 393], [44, 383]], 'out') : f <= 56 ? kf(f, [[44, 383], [56, 564]], 'inout') : kf(f, [[56, 564], [59, 546], [71, 531]], 'out')
      const rot = kf(f, [[47, 0], [51, -62], [56, -62], [60, -18]], 'inout')
      const sc = kf(f, [[56, 1], [60, 1.55]], 'out') * kf(f, [[69, 1], [71, 0.85]], 'inout')
      const cl = layer(); cursor(cl.c, cx, cy, rot, sc)
      const pvx = cx - (f - 0.5 <= 44 ? kf(f - 0.5, [[27, 891], [44, 770]], 'out') : cx), pvy = 0
      put(w, cl.cv, 0, pvx * 1.2, pvy, kf(f, [[27, 0], [29, 1]]))
    }
    c.save(); c.translate(540, 540); c.scale(z, z); c.translate(-540, -540)
    const dz = Math.abs(z - (f < 46 ? 1 : f < 60 ? kf(f - 0.5, [[46, 1], [60, 1.2]], 'inout') : f < 61 ? 1.2 : kf(f - 0.5, [[61, 1.2], [71, 1.04]], 'in')))
    put(c, world.cv, dz * 60, 0, 0)
    c.restore()
  }

  // ---------- S2 f72–100: app icon + orbit ------------------------------
  function s2(c: any, f: number) {
    c.fillStyle = P.page; c.fillRect(0, 0, W, W)
    const size = f <= 86 ? kf(f, [[72, 276], [86, 178]], 'expo') : f <= 88 ? 178 : kf(f, [[88, 178], [100, 40]], 'in')
    const k = size / 178
    const icx = f <= 88 ? 540 : kf(f, [[88, 540], [100, 557]], 'in')
    const icy = f <= 88 ? 540 : kf(f, [[88, 540], [100, 507]], 'in')
    const lay = layer(); const l = lay.c
    const halo = f <= 86 ? kf(f, [[72, 200], [75, 240], [86, 326]], 'out') : 326 * k
    l.beginPath(); l.arc(icx, icy, halo / 2, 0, Math.PI * 2); l.fillStyle = '#E9E9E7'; l.globalAlpha = kf(f, [[72, 0.4], [75, 1]]); l.fill(); l.globalAlpha = 1
    const sq = 92
    const lockT = clamp((f - 72) / 14, 0, 1), spin = (1 - E.expo(lockT)) * Math.PI * 1.4
    const orbit = f <= 86 ? lerp(430, 216, E.expo(lockT)) : 216
    const cols = [P.white, P.a1, P.a2, P.a3], ang = [Math.PI, -Math.PI / 2, 0, Math.PI / 2]
    const rowT = clamp((f - 88) / 12, 0, 1), re = E.in(rowT)
    const squares = cols.map((col, i) => {
      const a = ang[i] + spin
      let x = icx + Math.cos(a) * orbit, y = icy + Math.sin(a) * orbit
      if (f > 88) {
        x = lerp(540 + Math.cos(ang[i]) * 216, i === 0 ? icx : icx + 55 + (i - 1) * 49, re)
        y = lerp(540 + Math.sin(ang[i]) * 216, icy, re)
      }
      return { x, y, col, a: f <= 86 ? spin : 0, behind: i === 0 && f > 88 }
    })
    const drawSq = (s: any) => {
      l.save(); l.translate(s.x, s.y); l.rotate(-s.a * 0.5)
      const d = f > 88 ? lerp(92, 36, re) : sq
      l.shadowColor = 'rgba(30,47,82,0.12)'; l.shadowBlur = 10; l.shadowOffsetY = 3
      if (f > 88 && s.col !== P.white) { l.beginPath(); l.arc(0, 0, d / 2, 0, Math.PI * 2) } else rr(l, -d / 2, -d / 2, d, d, (26 / 92) * d * (1 - re) + (d / 2) * re)
      l.fillStyle = s.col; l.fill(); l.shadowColor = 'transparent'
      if (s.col === P.white) { l.lineWidth = 1; l.strokeStyle = '#E3E8EF'; l.stroke() }
      l.restore()
    }
    squares.filter((s) => s.behind).forEach(drawSq)
    // icon
    const g = l.createLinearGradient(icx, icy - size / 2, icx, icy + size / 2); g.addColorStop(0, P.deep); g.addColorStop(1, P.navy)
    l.shadowColor = 'rgba(30,47,82,0.25)'; l.shadowBlur = 18 * k; l.shadowOffsetY = 6 * k
    rr(l, icx - size / 2, icy - size / 2, size, size, size * 0.28); l.fillStyle = g; l.fill(); l.shadowColor = 'transparent'
    mark(l, icx, icy, size * 0.62, '#FFFFFF')
    squares.filter((s) => !s.behind).forEach(drawSq)
    const b = f <= 88 ? kf(f, [[72, 0.8], [76, 0]]) : kf(f, [[88, 0.3], [100, 6]], 'in')
    put(c, lay.cv, b, 0, f > 88 ? (icy - kf(f - 0.5, [[88, 540], [100, 507]], 'in')) * 2 : 0)
  }

  // ---------- S3 f101–158: menu bar + frosted prompt --------------------
  function wallpaper(c: any, ox: number, oy: number) {
    const g = c.createLinearGradient(0, 538 + oy, 0, 1400 + oy); g.addColorStop(0, P.deep); g.addColorStop(1, P.sky)
    c.fillStyle = g; c.fillRect(-200, 538 + oy, W + 400, 1200)
    const tg = c.createRadialGradient(960 + ox, 610 + oy, 0, 960 + ox, 610 + oy, 360); tg.addColorStop(0, hex(P.a2, 0.42)); tg.addColorStop(1, hex(P.a2, 0)); c.fillStyle = tg; c.fillRect(-200, 538 + oy, W + 400, 1200)
    c.strokeStyle = 'rgba(255,255,255,0.45)'; c.lineWidth = 2
    c.beginPath(); c.arc(560 + ox, 900 + oy, 330, 0, Math.PI * 2); c.stroke()
    c.beginPath(); c.moveTo(-200, 700 + oy); c.lineTo(W + 200, 700 + oy); c.moveTo(-200, 985 + oy); c.lineTo(W + 200, 985 + oy); c.moveTo(262 + ox, 538 + oy); c.lineTo(262 + ox, 1300 + oy); c.stroke()
    c.fillStyle = 'rgba(255,255,255,0.9)'; const sx = 262 + ox, sy = 700 + oy
    c.beginPath(); c.moveTo(sx, sy - 22); c.quadraticCurveTo(sx, sy, sx + 22, sy); c.quadraticCurveTo(sx, sy, sx, sy + 22); c.quadraticCurveTo(sx, sy, sx - 22, sy); c.quadraticCurveTo(sx, sy, sx, sy - 22); c.fill()
  }
  function s3(c: any, f: number) {
    const pan = kf(f, [[115, 0], [130, 125]], 'inout')
    const lift = f <= 136 ? 0 : 0.568 * (f - 136) * (f - 136)
    const vlift = f <= 136 ? 0 : 1.136 * (f - 136)
    const vpan = pan - kf(f - 0.5, [[115, 0], [130, 125]], 'inout')
    const lay = layer(); const l = lay.c
    l.save(); l.translate(0, -lift)
    l.fillStyle = '#FFFFFF'; l.fillRect(0, -400, W, 825)
    wallpaper(l, pan, 0)
    l.fillStyle = '#050506'; l.fillRect(0, 425, W, 50); l.fillStyle = '#686866'; l.fillRect(0, 425, W, 2)
    l.fillStyle = P.navy; l.fillRect(0, 477, W, 61)
    l.save(); l.translate(pan, 0)
    // menu bar right cluster (white)
    l.strokeStyle = '#FFFFFF'; l.fillStyle = '#FFFFFF'; l.lineWidth = 3.2; l.lineCap = 'round'
    for (let i = 0; i < 3; i++) { l.beginPath(); l.arc(300, 520, 8 + i * 8, -Math.PI * 0.78, -Math.PI * 0.22); l.stroke() }
    l.beginPath(); l.arc(300, 519, 2.6, 0, Math.PI * 2); l.fill()
    rr(l, 348, 495, 50, 24, 7); l.lineWidth = 2.4; l.stroke(); rr(l, 352, 499, 36, 16, 4); l.fill(); rr(l, 400, 502, 4, 10, 2); l.fill()
    rr(l, 434, 496, 44, 22, 11); l.stroke(); l.beginPath(); l.arc(467, 507, 7, 0, Math.PI * 2); l.fill()
    mark(l, 557, 507, 50, '#FFFFFF')
    ;[P.a1, P.a2, P.a3].forEach((col: string, i: number) => { l.beginPath(); l.arc([612, 661, 709][i], 507, 18, 0, Math.PI * 2); l.fillStyle = col; l.fill() })
    font(l, 500, 34); l.fillStyle = '#FFFFFF'; l.textBaseline = 'middle'; l.fillText('Mon Jun 22  9:41 AM', 748, 509)
    l.restore()
    // frosted glass prompt box
    if (f >= 116) {
      const bw = kf(f, [[116, 60], [119, 430], [122, 640], [126, 744], [130, 734], [134, 723], [138, 726]], 'sine')
      const bh = kf(f, [[116, 24], [119, 120], [122, 196], [126, 238], [130, 224], [134, 229], [138, 228]], 'sine')
      const bx = 559 + pan - bw / 2, by = 568
      const glass = layer(); const g = glass.c
      g.filter = 'blur(22px)'; wallpaper(g, pan, 0); g.filter = 'none'
      g.fillStyle = 'rgba(236,246,255,0.30)'; g.fillRect(0, 0, W, W)
      g.globalCompositeOperation = 'destination-in'; rr(g, bx, by, bw, bh, 60); g.fillStyle = '#000'; g.fill(); g.globalCompositeOperation = 'source-over'
      l.save(); l.shadowColor = 'rgba(12,24,52,0.28)'; l.shadowBlur = 40; l.shadowOffsetY = 14; rr(l, bx, by, bw, bh, 60); l.fillStyle = 'rgba(255,255,255,0.01)'; l.fill(); l.restore()
      l.drawImage(glass.cv, 0, 0)
      l.save(); rr(l, bx, by, bw, bh, 60); l.clip()
      const rim = l.createLinearGradient(0, by, 0, by + 30); rim.addColorStop(0, 'rgba(255,255,255,0.75)'); rim.addColorStop(1, 'rgba(255,255,255,0)')
      l.strokeStyle = rim; l.lineWidth = 3; rr(l, bx + 1.5, by + 1.5, bw - 3, bh - 3, 58); l.stroke()
      const inner = clamp((f - 119) / 6, 0, 1)
      l.globalAlpha = inner
      // typed prompt: ~1 char/frame from f121 to f150 with short holds
      const full = I.prompt, n = full.length
      let shown = 0
      for (let i = 1; i <= n; i++) { const hold = Math.floor(i / 2.5) * 0.35; if (f >= 121 + ((i - 1) * (29 - Math.floor(n / 2.5) * 0.35)) / Math.max(1, n - 1) + hold) shown = i }
      if (f >= 150) shown = n
      font(l, 500, 40); l.fillStyle = '#FFFFFF'; l.textBaseline = 'middle'
      const tx = bx + 46, ty = by + 70
      const txt = full.slice(0, shown)
      l.fillText(txt, tx, ty)
      const tw = l.measureText(txt).width
      l.fillRect(tx + tw + 3, ty - 23, 3, 46)
      // bottom icons (white outline) + send
      l.strokeStyle = '#FFFFFF'; l.lineWidth = 3
      const iy = by + bh - 52
      l.beginPath(); l.arc(tx + 16, iy, 16, 0, Math.PI * 2); l.moveTo(tx + 16, iy - 8); l.lineTo(tx + 16, iy + 8); l.moveTo(tx + 8, iy); l.lineTo(tx + 24, iy); l.stroke()
      l.beginPath(); l.arc(tx + 76, iy, 16, 0, Math.PI * 2); l.moveTo(tx + 60, iy); l.lineTo(tx + 92, iy); l.ellipse(tx + 76, iy, 7, 16, 0, 0, Math.PI * 2); l.stroke()
      rr(l, tx + 128, iy - 16, 18, 26, 9); l.stroke(); l.beginPath(); l.arc(tx + 137, iy + 2, 14, 0.15 * Math.PI, 0.85 * Math.PI); l.moveTo(tx + 137, iy + 16); l.lineTo(tx + 137, iy + 22); l.stroke()
      const sx = bx + bw - 66
      l.beginPath(); l.arc(sx, iy, 25.5, 0, Math.PI * 2); l.fillStyle = P.a1; l.fill()
      l.strokeStyle = '#FFFFFF'; l.lineWidth = 3.4; l.lineCap = 'round'; l.beginPath(); l.moveTo(sx, iy + 11); l.lineTo(sx, iy - 11); l.moveTo(sx - 9, iy - 3); l.lineTo(sx, iy - 12); l.lineTo(sx + 9, iy - 3); l.stroke()
      l.restore()
    }
    // cursor
    if (f >= 102) {
      const cy = approach(f, 102, 1140, 522, 0.19), cx = 557 + pan * (f < 118 ? 0 : 1)
      const sc = kf(f, [[113, 1], [115, 0.85], [117, 1]], 'inout')
      cursor(l, cx, cy, 0, sc * 1.25)
    }
    l.restore()
    const tint = kf(f, [[154, 0], [158, 0.85]], 'in')
    const enter = kf(f, [[101, 3], [110, 0]], 'out')
    put(c, lay.cv, enter + vlift * 0.08, -vpan * 1.5, -vlift * 0.3)
    if (tint > 0) { c.fillStyle = hex('#E6F4FE', tint); c.fillRect(0, 0, W, W) }
  }

  // ---------- S4 f159–186: answer page scrolls in -----------------------
  function pageLayout(c: any) {
    font(c, 400, 47)
    const words = I.pageBody.split(/\s+/)
    const key = I.keyPhrase.toLowerCase().split(/\s+/)
    const lines: any[] = [[]]
    let x = 0, keyAt = -1
    for (let i = 0; i < words.length; i++) {
      if (keyAt < 0 && key.every((k: string, j: number) => (words[i + j] || '').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '') === k.replace(/[^\p{L}\p{N}]/gu, ''))) keyAt = i
      const isKey = keyAt >= 0 && i >= keyAt && i < keyAt + key.length
      font(c, isKey ? 600 : 400, 47)
      const w = c.measureText(words[i] + ' ').width
      if (x + w > 850 && x > 0) { lines.push([]); x = 0 }
      lines[lines.length - 1].push({ t: words[i], x, key: isKey, w })
      x += w
    }
    return lines
  }
  function page(c: any, off: number) {
    c.fillStyle = P.page; c.fillRect(0, 0, W, W)
    c.save(); c.translate(0, off)
    font(c, 500, 26); c.fillStyle = '#9A9A98'; c.textBaseline = 'alphabetic'; c.fillText(I.product + '  ›  Module 2', 120, 250)
    font(c, 700, 62); c.fillStyle = P.ink; c.fillText(I.pageTitle, 120, 336)
    const lines = pageLayout(c)
    let kx = 450, ky = 591
    lines.forEach((ln: any[], i: number) => ln.forEach((w: any) => {
      font(c, w.key ? 600 : 400, 47); c.fillStyle = w.key ? '#000000' : P.grey
      const y = 430 + i * 58
      c.fillText(w.t, 120 + w.x, y)
      if (w.key) { kx = 120 + w.x + w.w / 2; ky = y + 20 }
    }))
    c.restore()
    return { kx, ky }
  }
  const scroll = (f: number) => (f <= 166 ? kf(f, [[159, 420], [160, 315], [161, 210], [162, 170], [163, 140], [164, 116], [165, 96], [166, 81]]) : f <= 175 ? kf(f, [[166, 81], [175, 14]], 'expo') : f <= 180 ? kf(f, [[175, 14], [180, 0]], 'out') : kf(f, [[180, 0], [186, -6]], 'sine'))
  function s4(c: any, f: number) {
    const off = scroll(f), v = off - scroll(f - 0.5)
    const lay = layer(); const l = lay.c
    const k = page(l, off)
    const cf = Math.min(f, 180)
    const cx = k.kx + (f > 180 ? (f - 180) * 2.2 : 0), cy = k.ky + (scroll(cf) - scroll(180)) * 0.0 + (f < 180 ? scroll(f) - 0 : 0) * 0 + (f <= 180 ? scroll(f) : 0)
    cursor(l, cx, cy + 8, 20, 1.3)
    put(c, lay.cv, kf(f, [[159, 24], [165, 1.5], [168, 0]], 'out'), 0, v * 2.4)
    const fl = kf(f, [[159, 1], [165, 0]], 'out')
    if (fl > 0) { c.fillStyle = hex('#E2F4FE', fl * 0.9); c.fillRect(0, 0, W, W) }
  }

  // ---------- S5 f187–214: a card rises over the page -------------------
  const coverTop = (f: number) => (f <= 205 ? kf(f, [[187, 642], [191, 456], [196, 395], [200, 369], [205, 348]], 'out') : 348 - (f - 205) * 4)
  function s5(c: any, f: number) {
    const bg = layer(); page(bg.c, -6 - (f - 186) * 0.8)
    const frame = layer(); const fr = frame.c
    put(fr, bg.cv, kf(f, [[187, 0], [195, 2.5]], 'out'), 0, 0)
    const top = coverTop(f), v = top - coverTop(f - 0.5)
    const sc = kf(f, [[207, 1], [214, 0.95]], 'in'), rise = kf(f, [[207, 0], [214, -40]], 'in')
    const card = layer(); const k = card.c
    k.save(); k.translate(540, top + rise); k.scale(sc, sc); k.translate(-540, -top)
    k.shadowColor = 'rgba(30,47,82,0.18)'; k.shadowBlur = 50; k.shadowOffsetY = -6
    rr(k, 203, top - 40, 675, 900, 72); k.fillStyle = '#FFFFFF'; k.fill(); k.shadowColor = 'transparent'
    rr(k, 500, top - 26, 80, 8, 4); k.fillStyle = '#E3E6EB'; k.fill()
    k.save(); rr(k, 227, top, 627, 536, 64); k.clip(); cover(k, 227, top, 627, 536, 1); k.restore()
    font(k, 600, 38); k.fillStyle = '#000'; k.textBaseline = 'alphabetic'; k.fillText(I.pageTitle.replace(/^[\d.]+\s*/, ''), 235, top + 596)
    font(k, 400, 23); k.fillStyle = '#8A8F98'; k.fillText(I.product + ' · Lesson ' + (I.pageTitle.match(/^[\d.]+/) || ['1'])[0], 235, top + 634)
    k.restore()
    put(fr, card.cv, kf(f, [[187, 2.4], [189, 3.8], [201, 0]], 'out'), 0, v * 1.6)
    put(c, frame.cv, kf(f, [[206, 0], [207, 1], [214, 7]], 'in'), 0, 0)
  }

  // ---------- S6 f215–244: two stacked cards with glass titles ----------
  function glassCard(c: any, x: number, y: number, w: number, h: number, v: number, title: string, pill: string) {
    c.save(); c.shadowColor = 'rgba(30,47,82,0.16)'; c.shadowBlur = 30; c.shadowOffsetY = 10
    rr(c, x, y, w, h, 57); c.fillStyle = '#fff'; c.fill(); c.restore()
    c.save(); rr(c, x, y, w, h, 57); c.clip(); cover(c, x, y, w, h, v)
    const g = layer(); const gc = g.c
    gc.filter = 'blur(14px)'; cover(gc, x, y, w, h, v); gc.filter = 'none'
    gc.fillStyle = 'rgba(255,255,255,0.48)'; gc.fillRect(x, y, w, h)
    gc.globalCompositeOperation = 'destination-in'
    let px = 170; font(gc, 800, px); const tw = gc.measureText(title).width; if (tw > w - 50) { px *= (w - 50) / tw; font(gc, 800, px) }
    gc.textBaseline = 'alphabetic'; gc.fillStyle = '#000'; gc.fillText(title, x + 26, y + h + px * 0.16)
    gc.globalCompositeOperation = 'source-over'
    c.drawImage(g.cv, 0, 0)
    font(c, 600, 22); const pw = c.measureText(pill).width + 36
    rr(c, x + 24, y + 24, pw, 44, 22); c.fillStyle = 'rgba(255,255,255,0.30)'; c.fill(); c.strokeStyle = 'rgba(255,255,255,0.55)'; c.lineWidth = 1; c.stroke()
    c.fillStyle = '#fff'; c.textBaseline = 'middle'; c.fillText(pill, x + 42, y + 47)
    c.beginPath(); c.arc(x + w - 46, y + 46, 22, 0, Math.PI * 2); c.fillStyle = 'rgba(255,255,255,0.30)'; c.fill(); c.stroke()
    c.fillStyle = '#fff'; for (let i = -1; i <= 1; i++) { c.beginPath(); c.arc(x + w - 46 + i * 8, y + 46, 2.6, 0, Math.PI * 2); c.fill() }
    c.restore()
  }
  function s6(c: any, f: number) {
    c.fillStyle = '#FFFFFF'; c.fillRect(0, 0, W, W)
    const up = (ff: number) => (ff <= 230 ? 0 : ff <= 238 ? (ff - 230) * 3 : 24 + (ff - 238) * 3 + 2.6 * (ff - 238) * (ff - 238))
    const exitV = up(f) - up(f - 0.5)
    const lay = layer(); const l = lay.c
    const ty = approach(f, 215, 264, 168, 0.16) - up(f), tsc = approach(f, 215, 1.08, 1, 0.16)
    const by = approach(f, 218, 927, 552, 0.15) - up(f)
    if (f >= 217) glassCard(l, 271, by, 538, 348, 2, I.cards[1], 'Module 5')
    l.save(); l.translate(540, ty + 174); l.scale(tsc, tsc); l.translate(-540, -(ty + 174))
    glassCard(l, 271, ty, 538, 348, 0, I.cards[0], 'Module 3'); l.restore()
    put(c, lay.cv, kf(f, [[215, 12], [224, 0]], 'out') + kf(f, [[238, 0], [244, 9]], 'in'), 0, -exitV * 2)
  }

  // ---------- S7 f245–300: logo disc (the only hold f269–287) ------------
  function s7(c: any, f: number) {
    c.fillStyle = P.page; c.fillRect(0, 0, W, W)
    const top = f <= 269 ? kf(f, [[245, 569], [250, 491], [255, 468], [269, 456]], 'out') : 456
    const d = f <= 287 ? 168 : kf(f, [[287, 168], [300, 123]], 'in')
    const cy = f <= 287 ? top + 84 : 540
    const v = f <= 269 ? top - kf(f - 0.5, [[245, 569], [250, 491], [255, 468], [269, 456]], 'out') : 0
    const lay = layer(); const l = lay.c
    l.beginPath(); l.arc(540, cy, d / 2, 0, Math.PI * 2); l.fillStyle = '#F6F6F6'; l.shadowColor = 'rgba(30,47,82,0.10)'; l.shadowBlur = 20; l.shadowOffsetY = 6; l.fill(); l.shadowColor = 'transparent'
    mark(l, 540, cy, d, P.ink)
    put(c, lay.cv, 0, 0, f < 246 ? 60 : v * 2)
  }

  // ---------- S8 f301–359: black end card, glowing wordmark -------------
  function s8(c: any, f: number) {
    const bg = c.createRadialGradient(540, 540, 0, 540, 540, 780); bg.addColorStop(0, '#272729'); bg.addColorStop(1, '#020204'); c.fillStyle = bg; c.fillRect(0, 0, W, W)
    const width = kf(f, [[301, 1650], [302, 1350], [303, 1110], [304, 1049], [309, 734], [311, 678], [320, 563], [342, 516], [350, 492], [355, 450], [359, 267]], f >= 350 ? 'in' : 'lin')
    font(c, 600, 100); const base = c.measureText(I.product).width || 1
    const px = (100 * width) / base
    const lay = layer(); const l = lay.c
    const draw = (cx: any, scale: number, alpha: number) => { font(cx, 600, px * scale); cx.textAlign = 'center'; cx.textBaseline = 'middle'; cx.globalAlpha = alpha; cx.fillText(I.product, 540, 540); cx.globalAlpha = 1 }
    l.fillStyle = '#F3F3F5'
    if (f < 305) { const n = 24; for (let i = n; i >= 1; i--) draw(l, 1 + i * 0.018 * (305 - f), (0.35 * (1 - i / (n + 1))) * clamp((305 - f) / 4, 0, 1)) }
    l.save(); l.shadowColor = 'rgba(210,225,255,0.35)'; l.shadowBlur = 80; draw(l, 1, 1); l.shadowColor = 'rgba(255,255,255,0.8)'; l.shadowBlur = 10; draw(l, 1, 1); l.restore()
    put(c, lay.cv, kf(f, [[350, 0], [355, 1], [359, 3.5]], 'in'), f < 304 ? kf(f, [[301, 90], [304, 0]]) : 0, 0)
  }

  const SHOTS = [
    { f0: 0, f1: 71, render: s1 }, { f0: 72, f1: 100, render: s2 }, { f0: 101, f1: 158, render: s3 }, { f0: 159, f1: 186, render: s4 },
    { f0: 187, f1: 214, render: s5 }, { f0: 215, f1: 244, render: s6 }, { f0: 245, f1: 300, render: s7 }, { f0: 301, f1: 359, render: s8 },
  ]
  return {
    frames: 360,
    seek(ctx: any, frame: number) {
      const f = clamp(frame, 0, 359.999)
      let shot = SHOTS[0]
      for (const s of SHOTS) if (f >= s.f0) shot = s
      used = 0
      const out = layer()
      out.c.save(); shot.render(out.c, f); out.c.restore()
      const cw = ctx.canvas ? ctx.canvas.width : W
      ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1; ctx.filter = 'none'
      ctx.drawImage(out.cv, 0, 0, cw, cw); ctx.restore()
    },
  }
}
/* eslint-enable */

/** Self-contained HTML (renderer contract: #scene root + deterministic window.__seek(t)). */
export function buildStingHtml(inputs: StingInputs, opts: { fontDataUrl?: string | null } = {}): string {
  const I = sanitizeSting(inputs)
  const { palette } = paletteFor(I)
  const fontFace = opts.fontDataUrl ? `@font-face{font-family:'StingInter';src:url(${opts.fontDataUrl}) format('woff2');font-weight:100 900;font-display:block}` : ''
  const family = opts.fontDataUrl ? "'StingInter', Inter, system-ui, sans-serif" : "Inter, 'Inter Variable', system-ui, sans-serif"
  const safe = (v: unknown) => JSON.stringify(v).replace(/</g, '\\u003c')
  return `<!doctype html><html><head><meta charset="utf-8"><title>${I.product.replace(/[<&]/g, '')} — product sting</title>
<style>${fontFace}html,body{margin:0;background:#000;overflow:hidden}#scene{width:1080px;height:1080px;position:relative}canvas{display:block;width:1080px;height:1080px}</style></head>
<body><div id="scene"><canvas id="c" width="1080" height="1080"></canvas></div>
<script>
(function(){
var I=${safe({ ...I, logoDataUrl: null })}, P=${safe(palette)}, LOGO=${safe(I.logoDataUrl)};
var program=${stingProgram.toString()};
var FPS=30000/1001, DURATION=${STING.durationSec};
var cv=document.getElementById('c'), ctx=cv.getContext('2d'), prog=null, last=0;
function mk(w,h){var c=document.createElement('canvas');c.width=w;c.height=h;return c}
function boot(logo){prog=program(I,P,{makeCanvas:mk,font:${safe(family)},logo:logo});prog.seek(ctx,last*FPS)}
window.__seek=function(t){last=Math.max(0,Math.min(DURATION,Number(t)||0));if(prog)prog.seek(ctx,last*FPS)};
window.__stingMeta={frames:360,fps:FPS,masterFps:60000/1001,duration:DURATION,cuts:${safe(STING.cuts)}};
var ready=(document.fonts&&document.fonts.load?Promise.all([document.fonts.load('400 40px StingInter'),document.fonts.load('600 40px StingInter'),document.fonts.load('800 40px StingInter')]).catch(function(){}):Promise.resolve());
ready.then(function(){if(!LOGO){boot(null);return}var im=new Image();im.onload=function(){boot(im)};im.onerror=function(){boot(null)};im.src=LOGO});
window.__seek(0);
})();
</script></body></html>`
}
