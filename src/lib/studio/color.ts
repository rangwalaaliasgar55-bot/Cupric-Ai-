/**
 * Colour science for the Studio (2.3 wheels/scopes/LUT, 2.17 auto photo grade).
 *
 * Everything here operates on plain RGBA byte arrays so the same code runs in
 * the preview, in the exporter and in Node checks. Nothing reads the clock or
 * a random source: the same pixels always produce the same result.
 */

import type { StudioGradeNode, StudioLut } from '../../types/project'

export const MAX_LUT_SIZE = 33

/* ——— .cube LUTs ——— */

/**
 * Parse an Adobe/Resolve `.cube` 3D LUT. Throws a plain-English error for
 * anything unusable (1D LUTs, oversized tables, wrong row counts) so the UI can
 * say why rather than silently doing nothing.
 */
export function parseCube(text: string, name = 'LUT'): StudioLut {
  let size = 0
  let domainMin = [0, 0, 0]
  let domainMax = [1, 1, 1]
  const data: number[] = []
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const upper = line.toUpperCase()
    if (upper.startsWith('TITLE')) {
      const m = line.match(/"(.+)"/)
      if (m) name = m[1]
      continue
    }
    if (upper.startsWith('LUT_1D_SIZE')) throw new Error('This is a 1D LUT. Use a 3D .cube file.')
    if (upper.startsWith('LUT_3D_SIZE')) {
      size = Number(line.split(/\s+/)[1])
      continue
    }
    if (upper.startsWith('DOMAIN_MIN')) {
      domainMin = line.split(/\s+/).slice(1, 4).map(Number)
      continue
    }
    if (upper.startsWith('DOMAIN_MAX')) {
      domainMax = line.split(/\s+/).slice(1, 4).map(Number)
      continue
    }
    if (/^[A-Z_]+/.test(upper)) continue
    const parts = line.split(/\s+/).map(Number)
    if (parts.length >= 3 && parts.slice(0, 3).every(Number.isFinite)) {
      for (let c = 0; c < 3; c += 1) {
        const span = domainMax[c] - domainMin[c] || 1
        data.push(Math.min(1, Math.max(0, (parts[c] - domainMin[c]) / span)))
      }
    }
  }
  if (!size || size < 2) throw new Error('No LUT_3D_SIZE found — is this a .cube file?')
  if (size > MAX_LUT_SIZE) throw new Error(`LUT is ${size}³; the Studio supports up to ${MAX_LUT_SIZE}³.`)
  if (data.length !== size * size * size * 3) throw new Error(`LUT says ${size}³ but has ${data.length / 3} entries.`)
  return { name: name.slice(0, 48), size, data, strength: 1 }
}

/** Trilinear lookup of one normalised RGB triple. */
export function lookupLut(lut: StudioLut, r: number, g: number, b: number): [number, number, number] {
  const n = lut.size - 1
  const fr = Math.min(n, Math.max(0, r * n))
  const fg = Math.min(n, Math.max(0, g * n))
  const fb = Math.min(n, Math.max(0, b * n))
  const r0 = Math.floor(fr), g0 = Math.floor(fg), b0 = Math.floor(fb)
  const r1 = Math.min(n, r0 + 1), g1 = Math.min(n, g0 + 1), b1 = Math.min(n, b0 + 1)
  const dr = fr - r0, dg = fg - g0, db = fb - b0
  const s = lut.size
  const at = (ri: number, gi: number, bi: number, c: number) => lut.data[(ri + gi * s + bi * s * s) * 3 + c]
  const out: [number, number, number] = [0, 0, 0]
  for (let c = 0; c < 3; c += 1) {
    const c00 = at(r0, g0, b0, c) * (1 - dr) + at(r1, g0, b0, c) * dr
    const c10 = at(r0, g1, b0, c) * (1 - dr) + at(r1, g1, b0, c) * dr
    const c01 = at(r0, g0, b1, c) * (1 - dr) + at(r1, g0, b1, c) * dr
    const c11 = at(r0, g1, b1, c) * (1 - dr) + at(r1, g1, b1, c) * dr
    out[c] = (c00 * (1 - dg) + c10 * dg) * (1 - db) + (c01 * (1 - dg) + c11 * dg) * db
  }
  return out
}

/** An identity LUT (for tests and as a starting point). */
export function identityLut(size = 17): StudioLut {
  const data: number[] = []
  for (let b = 0; b < size; b += 1) for (let g = 0; g < size; g += 1) for (let r = 0; r < size; r += 1) data.push(r / (size - 1), g / (size - 1), b / (size - 1))
  return { name: 'Identity', size, data, strength: 1 }
}

/* ——— lift / gamma / gain ——— */

type Wheels = Extract<StudioGradeNode, { id: 'wheels' }>

export function neutralWheels(): Wheels {
  return { id: 'wheels', enabled: true, lift: [0, 0, 0], gamma: [0, 0, 0], gain: [0, 0, 0] }
}

export function wheelsAreNeutral(w: Wheels): boolean {
  return [...w.lift, ...w.gamma, ...w.gain].every((v) => v === 0)
}

/** ASC-CDL style: out = (in·gain + lift·(1-in)) ^ (1/gamma), per channel. */
export function wheelsChannel(v: number, lift: number, gamma: number, gain: number): number {
  const L = lift / 400 // ±0.25
  const G = 1 + gain / 100 // 0..2
  const Y = Math.pow(2, gamma / 100) // 0.5..2
  const x = v * G + L * (1 - v)
  return Math.min(1, Math.max(0, Math.pow(Math.max(0, x), 1 / Y)))
}

/** Build a 256-entry table per channel — one pass over the pixels after that. */
export function wheelsTables(w: Wheels): [Uint8ClampedArray, Uint8ClampedArray, Uint8ClampedArray] {
  const tables = [0, 1, 2].map((c) => {
    const t = new Uint8ClampedArray(256)
    for (let i = 0; i < 256; i += 1) t[i] = Math.round(wheelsChannel(i / 255, w.lift[c], w.gamma[c], w.gain[c]) * 255)
    return t
  })
  return tables as [Uint8ClampedArray, Uint8ClampedArray, Uint8ClampedArray]
}

/**
 * Apply the pixel stages of a grade (wheels, then LUT) in place. Returns true
 * when anything was done. The CSS-filter stages (balance/contrast/look) have
 * already been applied by the canvas at draw time.
 */
export function applyPixelGrade(data: Uint8ClampedArray, nodes: StudioGradeNode[] | null | undefined, lut: StudioLut | null | undefined): boolean {
  const wheels = nodes?.find((n): n is Wheels => n.id === 'wheels' && n.enabled && !wheelsAreNeutral(n as Wheels))
  const useLut = lut && lut.strength > 0 ? lut : null
  if (!wheels && !useLut) return false
  const tables = wheels ? wheelsTables(wheels) : null
  // Cache LUT results by quantised colour: photos repeat colours heavily.
  const cache = useLut ? new Map<number, number>() : null
  const k = useLut ? Math.min(1, useLut.strength) : 0
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] === 0) continue
    let r = data[i], g = data[i + 1], b = data[i + 2]
    if (tables) {
      r = tables[0][r]
      g = tables[1][g]
      b = tables[2][b]
    }
    if (useLut && cache) {
      const key = (r << 16) | (g << 8) | b
      let packed = cache.get(key)
      if (packed === undefined) {
        const [lr, lg, lb] = lookupLut(useLut, r / 255, g / 255, b / 255)
        packed = (Math.round(lr * 255) << 16) | (Math.round(lg * 255) << 8) | Math.round(lb * 255)
        cache.set(key, packed)
      }
      r = Math.round(r + (((packed >> 16) & 255) - r) * k)
      g = Math.round(g + (((packed >> 8) & 255) - g) * k)
      b = Math.round(b + ((packed & 255) - b) * k)
    }
    data[i] = r
    data[i + 1] = g
    data[i + 2] = b
  }
  return true
}

/* ——— scopes ——— */

export type Scopes = {
  /** 256 bins per channel + luma, normalised so the tallest bin is 1. */
  histogram: { r: number[]; g: number[]; b: number[]; luma: number[] }
  /** Luma waveform: `columns` columns × 64 levels, counts normalised 0–1. */
  waveform: { columns: number; levels: number; data: number[] }
  /** Vectorscope: 64×64 grid of Cb/Cr density, normalised 0–1. */
  vectorscope: number[]
  stats: ImageStats
}

export type ImageStats = { meanLuma: number; p02: number; p98: number; meanSat: number; meanR: number; meanG: number; meanB: number; clippedHigh: number; clippedLow: number }

const lumaOf = (r: number, g: number, b: number) => 0.2126 * r + 0.7152 * g + 0.0722 * b

export function computeScopes(data: Uint8ClampedArray, width: number, height: number, columns = 64): Scopes {
  const r = new Array(256).fill(0), g = new Array(256).fill(0), b = new Array(256).fill(0), l = new Array(256).fill(0)
  const levels = 64
  const wave = new Array(columns * levels).fill(0)
  const vec = new Array(64 * 64).fill(0)
  const step = Math.max(1, Math.floor((width * height) / 60000)) // sample ≤ ~60k px
  let n = 0, sumL = 0, sumS = 0, sR = 0, sG = 0, sB = 0, hi = 0, lo = 0
  for (let p = 0; p < width * height; p += step) {
    const i = p * 4
    if (data[i + 3] === 0) continue
    const R = data[i], G = data[i + 1], B = data[i + 2]
    const Y = lumaOf(R, G, B)
    const yi = Math.min(255, Math.round(Y))
    r[R] += 1; g[G] += 1; b[B] += 1; l[yi] += 1
    const col = Math.min(columns - 1, Math.floor(((p % width) / width) * columns))
    wave[col * levels + Math.min(levels - 1, yi >> 2)] += 1
    const cb = (B - Y) / 255, cr = (R - Y) / 255 // ±~0.9
    const vx = Math.min(63, Math.max(0, Math.round(32 + cb * 34)))
    const vy = Math.min(63, Math.max(0, Math.round(32 - cr * 34)))
    vec[vy * 64 + vx] += 1
    const max = Math.max(R, G, B), min = Math.min(R, G, B)
    sumS += max === 0 ? 0 : (max - min) / max
    sumL += Y; sR += R; sG += G; sB += B
    if (Y >= 250) hi += 1
    if (Y <= 5) lo += 1
    n += 1
  }
  const norm = (a: number[]) => {
    const m = Math.max(1, ...a)
    return a.map((v) => v / m)
  }
  let acc = 0, p02 = 0, p98 = 255
  let p02Set = false
  for (let i = 0; i < 256; i += 1) {
    acc += l[i]
    if (!p02Set && acc >= n * 0.02) { p02 = i; p02Set = true }
    if (acc >= n * 0.98) { p98 = i; break }
  }
  const N = Math.max(1, n)
  return {
    histogram: { r: norm(r), g: norm(g), b: norm(b), luma: norm(l) },
    waveform: { columns, levels, data: norm(wave) },
    vectorscope: norm(vec),
    stats: { meanLuma: sumL / N / 255, p02: p02 / 255, p98: p98 / 255, meanSat: sumS / N, meanR: sR / N / 255, meanG: sG / N / 255, meanB: sB / N / 255, clippedHigh: hi / N, clippedLow: lo / N },
  }
}

/* ——— 2.17 auto photo grade ——— */

/**
 * A gentle, explainable grade from image statistics: expose toward mid-grey,
 * stretch the tonal range, neutralise a colour cast, lift flat saturation.
 * Deliberately conservative — it proposes, the user accepts (non-destructive).
 */
export function autoGrade(stats: ImageStats): { nodes: StudioGradeNode[]; notes: string[] } {
  const notes: string[] = []
  const clampN = (v: number, lim = 40) => Math.round(Math.max(-lim, Math.min(lim, v)))
  const exposure = clampN((0.46 - stats.meanLuma) * 90, 35)
  if (Math.abs(exposure) >= 4) notes.push(exposure > 0 ? 'Brightened an under-exposed photo' : 'Pulled back an over-exposed photo')
  const range = Math.max(0.05, stats.p98 - stats.p02)
  const contrast = clampN((0.82 - range) * 60, 30)
  if (Math.abs(contrast) >= 4) notes.push(contrast > 0 ? 'Added contrast to a flat image' : 'Softened harsh contrast')
  // Warm/cool cast: blue vs red balance.
  const cast = stats.meanB - stats.meanR
  const temperature = clampN(cast * 160, 30)
  if (Math.abs(temperature) >= 4) notes.push(temperature > 0 ? 'Warmed a cool cast' : 'Cooled a warm cast')
  const saturation = clampN((0.32 - stats.meanSat) * 70, 25)
  if (Math.abs(saturation) >= 4) notes.push(saturation > 0 ? 'Lifted muted colour' : 'Calmed over-saturated colour')
  if (!notes.length) notes.push('This photo is already well balanced — no change suggested')
  return {
    nodes: [
      { id: 'balance', enabled: true, exposure, temperature },
      { id: 'contrast', enabled: true, contrast, fade: 0 },
      { id: 'look', enabled: true, saturation, hue: 0 },
    ],
    notes,
  }
}

/* ——— 2.6 chroma key ——— */

export function hexRgb(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return [0, 255, 0]
  const n = parseInt(m[1], 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

/**
 * Key out a colour in place. Distance is measured in chroma (Cb/Cr) so
 * shadows and highlights on a green screen key together; `tolerance` and
 * `softness` are 0–1; `spill` desaturates the key hue out of kept edges.
 */
export function chromaKey(data: Uint8ClampedArray, keyHex: string, tolerance: number, softness: number, spill = 0.5, invert = false) {
  const [kr, kg, kb] = hexRgb(keyHex)
  const kY = lumaOf(kr, kg, kb)
  const kCb = kb - kY, kCr = kr - kY
  const lo = tolerance * 180
  const hi = lo + Math.max(1, softness * 180)
  for (let i = 0; i < data.length; i += 4) {
    const R = data[i], G = data[i + 1], B = data[i + 2]
    const Y = lumaOf(R, G, B)
    const d = Math.hypot(B - Y - kCb, R - Y - kCr)
    let keep = d <= lo ? 0 : d >= hi ? 1 : (d - lo) / (hi - lo)
    if (invert) keep = 1 - keep
    data[i + 3] = Math.round(data[i + 3] * keep)
    if (spill > 0 && keep > 0 && keep < 1) {
      // Pull the key colour out of semi-transparent edges.
      const k = spill * (1 - keep)
      data[i] = Math.round(R + (Y - R) * k)
      data[i + 1] = Math.round(G + (Y - G) * k)
      data[i + 2] = Math.round(B + (Y - B) * k)
    }
  }
}
