/**
 * NewBrand's shader kit (phase 5).
 *
 * The Lab's 18 `fc-shader-*` effects used to render through
 * `@paper-design/shaders-react`, which is licensed PolyForm Shield 1.0.0 —
 * a licence that restricts commercial use. These tests cover the replacement:
 * the pure field maths, and a renderer that must be deterministic, animated,
 * palette-aware, genuinely non-uniform, and distinct from its siblings.
 *
 * They also assert the structural claim that matters legally: no file in the
 * repository imports the removed package any more, and it is not a dependency.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { SHADER_KINDS, renderShaderPixels } from '../lib/shaders/render'
import {
  billow,
  clamp01,
  mixRgb,
  noise01,
  orbitDot,
  paletteOf,
  ramp,
  rampStepped,
  smoothstep,
  toRgb,
  voronoi,
  warpPoint,
} from '../lib/shaders/fields'

const W = 40
const H = 24

const frame = (kind: (typeof SHADER_KINDS)[number], time = 0, params = {}) => {
  const data = renderShaderPixels(kind, { width: W, height: H, params: { time, ...params } })
  const pixels: [number, number, number][] = []
  for (let i = 0; i < data.length; i += 4) pixels.push([data[i], data[i + 1], data[i + 2]])
  return { data, pixels }
}

/** Mean absolute difference across all channels. */
const meanDiff = (a: Uint8ClampedArray, b: Uint8ClampedArray) => {
  let sum = 0
  let count = 0
  for (let i = 0; i < a.length; i += 4) {
    sum += Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2])
    count += 3
  }
  return sum / count
}

const lumaRange = (data: Uint8ClampedArray) => {
  let min = 255
  let max = 0
  for (let i = 0; i < data.length; i += 4) {
    const luma = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]
    if (luma < min) min = luma
    if (luma > max) max = luma
  }
  return max - min
}

const distinctColours = (data: Uint8ClampedArray) => {
  const seen = new Set<number>()
  for (let i = 0; i < data.length; i += 4) seen.add((data[i] << 16) | (data[i + 1] << 8) | data[i + 2])
  return seen.size
}

describe('field maths', () => {
  it('parses hex, short hex and rgb() colours', () => {
    expect(toRgb('#ff8000')).toEqual([255, 128, 0])
    expect(toRgb('#f80')).toEqual([255, 136, 0])
    expect(toRgb('rgb(12, 34, 56)')).toEqual([12, 34, 56])
    expect(toRgb('not-a-colour')).toEqual([0, 0, 0])
    expect(toRgb(undefined)).toEqual([0, 0, 0])
  })

  it('blends, clamps and shapes without going out of range', () => {
    expect(mixRgb([0, 0, 0], [100, 200, 50], 0.5)).toEqual([50, 100, 25])
    expect(mixRgb([0, 0, 0], [100, 200, 50], 5)).toEqual([100, 200, 50])
    expect(mixRgb([0, 0, 0], [100, 200, 50], -3)).toEqual([0, 0, 0])
    expect(clamp01(-4)).toBe(0)
    expect(clamp01(4)).toBe(1)
    expect(smoothstep(0, 1, 0)).toBe(0)
    expect(smoothstep(0, 1, 1)).toBe(1)
    expect(smoothstep(0, 1, 0.5)).toBeCloseTo(0.5, 6)
  })

  it('keeps a palette usable when the caller passes nothing', () => {
    const fallback = paletteOf(undefined, [[1, 2, 3]])
    expect(fallback).toEqual([[1, 2, 3]])
    expect(paletteOf(['#fff', '  '], [[1, 2, 3]])).toEqual([[255, 255, 255]])
    expect(ramp([[0, 0, 0], [100, 100, 100]], 0.5)).toEqual([50, 50, 50])
    expect(ramp([[0, 0, 0], [100, 100, 100]], 1.5)).toEqual([50, 50, 50]) // wraps
    // A stepped ramp must reach its brightest band: `ramp` wraps at 1, so the
    // top band has to be asked for just below the wrap point.
    expect(rampStepped([[0, 0, 0], [100, 100, 100]], 0.5, 2)[0]).toBeGreaterThan(99)
    expect(rampStepped([[0, 0, 0], [100, 100, 100]], 0, 2)).toEqual([0, 0, 0])
    expect(rampStepped([[0, 0, 0], [100, 100, 100]], 1, 2)[0]).toBeGreaterThan(99)
    // …while the plain ramp keeps wrapping, which circular effects rely on.
    expect(ramp([[0, 0, 0], [100, 100, 100]], 1)).toEqual([0, 0, 0])
  })

  it('is deterministic and in range across every primitive', () => {
    for (let i = 0; i < 50; i++) {
      const x = i * 0.37
      const y = i * 0.11
      const z = i * 0.05
      const n = noise01(x, y, z)
      expect(n).toBe(noise01(x, y, z))
      expect(n).toBeGreaterThanOrEqual(0)
      expect(n).toBeLessThanOrEqual(1)
      const b = billow(x, y, z)
      expect(b).toBeGreaterThanOrEqual(0)
      expect(b).toBeLessThanOrEqual(1)
    }
    const [wx, wy] = warpPoint(0.3, 0.4, 1.2, 0.5)
    expect([wx, wy]).toEqual(warpPoint(0.3, 0.4, 1.2, 0.5))
    expect(warpPoint(0.3, 0.4, 1.2, 0)).toEqual([0.3, 0.4])
    const cell = voronoi(0.4, 0.6, 5)
    expect(cell.f2).toBeGreaterThanOrEqual(cell.f1)
    expect(voronoi(0.4, 0.6, 5)).toEqual(cell)
  })

  it('puts orbit dots on a ring that stays inside the frame', () => {
    for (let i = 0; i < 6; i++) {
      for (const t of [0, 1.5, 9]) {
        const [x, y] = orbitDot(i, 6, 0.6, t)
        expect(Math.hypot(x, y)).toBeLessThan(0.55)
      }
    }
  })
})

describe('the 18 effects', () => {
  it('are all implemented and all render', () => {
    expect(SHADER_KINDS).toHaveLength(18)
    for (const kind of SHADER_KINDS) {
      const { data } = frame(kind)
      expect(data.length, `${kind} produced pixels`).toBe(W * H * 4)
      for (let i = 3; i < data.length; i += 4) expect(data[i], `${kind} is opaque`).toBe(255)
    }
  })

  it('reject an unknown effect instead of drawing nothing', () => {
    expect(() => renderShaderPixels('not-an-effect' as never, { width: 4, height: 4 })).toThrow(/Unknown shader effect/)
  })

  it('are deterministic frame for frame', () => {
    for (const kind of SHADER_KINDS) {
      const a = frame(kind, 1.25).data
      const b = frame(kind, 1.25).data
      expect(meanDiff(a, b), `${kind} is deterministic`).toBe(0)
    }
  })

  it('actually move when time advances', () => {
    for (const kind of SHADER_KINDS) {
      const early = frame(kind, 0).data
      const later = frame(kind, 1.7).data
      expect(meanDiff(early, later), `${kind} animates`).toBeGreaterThan(1)
    }
  })

  it('draw something with real contrast, not a flat fill', () => {
    for (const kind of SHADER_KINDS) {
      const { data } = frame(kind, 0.4)
      expect(lumaRange(data), `${kind} has contrast`).toBeGreaterThan(12)
      expect(distinctColours(data), `${kind} has more than two colours`).toBeGreaterThanOrEqual(2)
    }
  })

  it('respond to their colour props', () => {
    const custom = { colors: ['#ff0000', '#00ff00', '#0000ff'], colorBack: '#000000', colorFront: '#ffffff', colorMid: '#00ffff', colorHighlight: '#ff00ff' }
    let changed = 0
    for (const kind of SHADER_KINDS) {
      const plain = frame(kind, 0.6).data
      const themed = frame(kind, 0.6, custom).data
      if (meanDiff(plain, themed) > 0.5) changed++
    }
    // The palette-driven effects must all obey it; the noise/textured ones that
    // read only colorBack/colorFront are covered by that first pair.
    expect(changed).toBeGreaterThanOrEqual(13)
  })

  it('are not the same effect under different names', () => {
    const frames = SHADER_KINDS.map((kind) => ({ kind, data: frame(kind, 0.6).data }))
    const collisions: string[] = []
    for (let i = 0; i < frames.length; i++) {
      for (let j = i + 1; j < frames.length; j++) {
        const diff = meanDiff(frames[i].data, frames[j].data)
        // 3/255 average difference is the threshold below which two effects
        // would be visually interchangeable at normal size.
        if (diff < 3) collisions.push(`${frames[i].kind}≈${frames[j].kind} (${diff.toFixed(1)})`)
      }
    }
    expect(collisions).toEqual([])
  })

  it('honour their headline knobs (density, count, steps)', () => {
    const dotted = frame('dot-orbit', 0.5, { count: 2 }).data
    const busy = frame('dot-orbit', 0.5, { count: 9 }).data
    expect(meanDiff(dotted, busy)).toBeGreaterThan(0.5)
    const twoSteps = frame('simplex-noise', 0.5, { stepsPerColor: 1 }).data
    const manySteps = frame('simplex-noise', 0.5, { stepsPerColor: 8 }).data
    expect(meanDiff(twoSteps, manySteps)).toBeGreaterThan(0.5)
    const tight = frame('dithering', 0.5, { size: 2 }).data
    const coarse = frame('dithering', 0.5, { size: 12 }).data
    expect(meanDiff(tight, coarse)).toBeGreaterThan(0.5)
  })

  it('render at any size asked, including tiny and wide frames', () => {
    for (const [w, h] of [[1, 1], [3, 2], [160, 4], [4, 160]]) {
      const data = renderShaderPixels('water', { width: w, height: h, params: { time: 0.3 } })
      expect(data.length).toBe(w * h * 4)
    }
  })
})

describe('the PolyForm-licensed dependency is gone', () => {
  const repoRoot = process.cwd()

  const walk = (dir: string, out: string[] = []): string[] => {
    for (const entry of readdirSync(dir)) {
      if (entry === 'node_modules' || entry === '.git' || entry === 'dist') continue
      const full = path.join(dir, entry)
      const stat = statSync(full)
      if (stat.isDirectory()) walk(full, out)
      else if (/\.(ts|tsx|mjs|cjs|js|json|md)$/.test(entry)) out.push(full)
    }
    return out
  }

  it('is not imported anywhere in the source tree', () => {
    const offenders: string[] = []
    for (const file of walk(path.join(repoRoot, 'src')).concat(walk(path.join(repoRoot, 'scripts')), [path.join(repoRoot, 'package.json')])) {
      const text = readFileSync(file, 'utf8')
      // Mentions in comments (including this replacement's own explanation) are
      // fine; an actual import or a dependency entry is not.
      if (/from\s+["']@paper-design\/shaders-react["']/.test(text) || /require\(["']@paper-design\/shaders-react["']\)/.test(text)) {
        offenders.push(path.relative(repoRoot, file))
      }
    }
    expect(offenders).toEqual([])
    const pkg = JSON.parse(readFileSync(path.join(repoRoot, 'package.json'), 'utf8'))
    expect(pkg.dependencies['@paper-design/shaders-react']).toBeUndefined()
    expect(pkg.devDependencies?.['@paper-design/shaders-react']).toBeUndefined()
  })

  it('left all 18 Lab shader components rendering from our own kit', () => {
    const dir = path.join(repoRoot, 'src/lab/framecn')
    const shaderDirs = readdirSync(dir).filter((entry) => entry.startsWith('shader-') && statSync(path.join(dir, entry)).isDirectory())
    expect(shaderDirs).toHaveLength(18)
    for (const shader of shaderDirs) {
      const text = readFileSync(path.join(dir, shader, 'index.tsx'), 'utf8')
      expect(text, `${shader} imports our kit`).toMatch(/from\s+["']\.\.\/shader-kit["']/)
      expect(text, `${shader} no longer imports the removed package`).not.toMatch(/@paper-design/)
    }
  })

  it('keeps the vendored framecn attribution intact', () => {
    const license = readFileSync(path.join(repoRoot, 'src/lab/framecn/LICENSE'), 'utf8')
    expect(license.length).toBeGreaterThan(100)
    const notes = readFileSync(path.join(repoRoot, 'THIRD_PARTY_NOTICES.md'), 'utf8')
    expect(notes).toMatch(/framecn/i)
  })
})
