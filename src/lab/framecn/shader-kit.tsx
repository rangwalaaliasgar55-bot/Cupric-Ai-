/**
 * Cupric's shader kit — the 18 Lab effects, drawn by our own renderer.
 *
 * These components replace `@paper-design/shaders-react`, which the vendored
 * framecn wrappers imported until Phase 5. That package is licensed PolyForm
 * Shield 1.0.0, which restricts commercial use and redistribution; this product
 * ships commercially, so the dependency was replaced rather than carried
 * (`docs/PHASE1_LICENSING.md`). The API is deliberately the same shape — the
 * same component names, the same props — so the wrappers only changed an import
 * path.
 *
 * How it draws, and what that costs:
 *   - The maths lives in `src/lib/shaders/render.ts` as pure per-pixel
 *     functions; this file is the React wrapper that paints them.
 *   - Rendering happens on the CPU into an internal buffer capped at
 *     `INTERNAL_MAX_WIDTH` and then scaled up with the browser's smoothing. The
 *     previous WebGL shaders ran per-pixel on the GPU at full resolution, so
 *     this is a deliberate trade: a soft gradient upscaled from 192 px looks
 *     the same, and it keeps a 4K preview from spending 40 ms per frame on one
 *     decorative background. `renderShaderPixels` is honest about being
 *     deterministic at whatever size it is asked for.
 *   - Frames are throttled to `MAX_FPS` and skipped while the tab is hidden, so
 *     a shader in a background component never competes with the editor.
 *
 * The `time` prop is milliseconds (what the wrappers pass through
 * `useShaderFrame`); pass `speed` only when no `frame` is given, in which case
 * the kit advances its own clock by `speed`.
 */
import { useEffect, useRef, type CSSProperties } from 'react'
import { renderShaderPixels, type ShaderKind, type ShaderParams } from '../../lib/shaders/render'

/** Internal render height/width ceiling. See the note above on the trade-off. */
export const INTERNAL_MAX_WIDTH = 192
export const INTERNAL_MAX_HEIGHT = 120
/** Frames per second ceiling for a decorative effect. */
export const MAX_FPS = 22

/**
 * The kit's props: the framecn layout props, plus every shader parameter the
 * effects read. Declared one by one (rather than as an index signature) so a
 * wrapper that passes a prop the kit does not understand fails to compile
 * instead of being silently dropped.
 */
export type ShaderKitProps = {
  /** Composition width in px (the wrappers pass 1280 by default). */
  width?: number
  /** Composition height in px (720 by default). */
  height?: number
  /** Elapsed milliseconds, already scaled by the caller's speed. */
  frame?: number
  /** Only used when `frame` is absent: how fast the kit's own clock runs. */
  speed?: number
  fps?: number
  durationInFrames?: number
  className?: string
  style?: CSSProperties
  /** Object-fit for the painted canvas. */
  fit?: 'cover' | 'contain' | 'fill'
  colors?: string[]
  colorBack?: string
  colorFront?: string
  colorMid?: string
  colorTint?: string
  colorBloom?: string
  colorGap?: string
  colorHighlight?: string
  proportion?: number
  softness?: number
  density?: number
  size?: number
  radius?: number
  thickness?: number
  scale?: number
  intensity?: number
  noise?: number
  contrast?: number
  brightness?: number
  bloom?: number
  swirl?: number
  distortion?: number
  repetition?: number
  contour?: number
  count?: number
  roundness?: number
  spreading?: number
  bandCount?: number
  twist?: number
  stepsPerColor?: number
  gap?: number
  glow?: number
  strokeWidth?: number
  length?: number
  waves?: number
  highlights?: number
  caustic?: number
  /** `dithering` accepts a pattern name; `liquid-metal` a shape name. */
  shape?: string
  type?: string
}

const PARAM_KEYS = new Set([
  'colors',
  'colorBack',
  'colorFront',
  'colorMid',
  'colorTint',
  'colorBloom',
  'colorGap',
  'colorHighlight',
  'proportion',
  'softness',
  'density',
  'size',
  'radius',
  'thickness',
  'scale',
  'intensity',
  'noise',
  'contrast',
  'brightness',
  'bloom',
  'swirl',
  'distortion',
  'repetition',
  'contour',
  'count',
  'roundness',
  'spreading',
  'bandCount',
  'twist',
  'stepsPerColor',
  'gap',
  'glow',
  'strokeWidth',
  'length',
  'waves',
  'highlights',
  'caustic',
  'shape',
  'type',
])

/** Pull the shader parameters out of the React props (everything but the rest). */
export function shaderParamsOf(props: Record<string, unknown>): ShaderParams {
  const params: Record<string, unknown> = {}
  for (const key of Object.keys(props)) {
    if (PARAM_KEYS.has(key)) params[key] = props[key]
  }
  return params as ShaderParams
}

/** Internal buffer size for a composition of `width`×`height`. */
export function internalSizeFor(width: number, height: number): [number, number] {
  const safeWidth = width > 0 ? width : 1280
  const safeHeight = height > 0 ? height : 720
  const scale = Math.min(INTERNAL_MAX_WIDTH / safeWidth, INTERNAL_MAX_HEIGHT / safeHeight, 1)
  return [Math.max(8, Math.round(safeWidth * scale)), Math.max(8, Math.round(safeHeight * scale))]
}

/** The painted surface. One `<canvas>`, no children, no layout surprises. */
export function ShaderCanvas({ kind, ...props }: ShaderKitProps & { kind: ShaderKind }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const frameRef = useRef(props.frame)
  const propsAsRecord = props as unknown as Record<string, unknown>
  const paramsRef = useRef(shaderParamsOf(propsAsRecord))
  frameRef.current = props.frame
  paramsRef.current = shaderParamsOf(propsAsRecord)

  const [bufferWidth, bufferHeight] = internalSizeFor(Number(props.width) || 1280, Number(props.height) || 720)
  // A cheap signature of the parameters, so a change repaints immediately
  // instead of waiting for the next throttled frame.
  const signature = JSON.stringify(paramsRef.current)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const context = canvas.getContext('2d')
    if (!context) {
      // Never a silently blank box: say what happened in the console for the
      // developer and leave the canvas transparent for the caller's own error
      // handling (the Lab's stage draws its own frame around it).
      console.error(`[cupric:shader] no 2D context for the "${kind}" effect — the canvas cannot be painted`)
      return
    }
    canvas.width = bufferWidth
    canvas.height = bufferHeight
    const image = context.createImageData(bufferWidth, bufferHeight)
    let raf = 0
    let last = -Infinity
    const ownStart = performance.now()
    // `frame` wins when present (the wrappers already applied their speed); the
    // internal clock is the fallback for standalone use.
    const timeOf = () => {
      const given = frameRef.current
      if (typeof given === 'number' && Number.isFinite(given)) return given / 1000
      const speed = typeof props.speed === 'number' && Number.isFinite(props.speed) ? props.speed : 1
      return ((performance.now() - ownStart) / 1000) * speed
    }
    const paint = () => {
      const pixels = renderShaderPixels(kind, { width: bufferWidth, height: bufferHeight, params: { ...paramsRef.current, time: timeOf() } })
      image.data.set(pixels)
      context.putImageData(image, 0, 0)
    }
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick)
      if (typeof document !== 'undefined' && document.hidden) return
      if (now - last < 1000 / MAX_FPS) return
      last = now
      paint()
    }
    paint()
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [kind, bufferWidth, bufferHeight, signature, props.speed])

  const fit = props.fit === 'contain' || props.fit === 'fill' ? props.fit : 'cover'
  return (
    <canvas
      ref={canvasRef}
      className={props.className}
      data-shader={kind}
      style={{
        display: 'block',
        width: '100%',
        height: '100%',
        objectFit: fit,
        ...(props.style ?? {}),
      }}
    />
  )
}

const define = (kind: ShaderKind, name: string) => {
  const Component = (props: ShaderKitProps) => <ShaderCanvas kind={kind} {...props} />
  Component.displayName = name
  return Component
}

/* The 18 effects, one component each, named as the vendored wrappers expect. */
export type ColorPanelsProps = ShaderKitProps
export type DitheringProps = ShaderKitProps
export type DotOrbitProps = ShaderKitProps
export type GodRaysProps = ShaderKitProps
export type GrainGradientProps = ShaderKitProps
export type LiquidMetalProps = ShaderKitProps
export type MeshGradientProps = ShaderKitProps
export type MetaballsProps = ShaderKitProps
export type NeuroNoiseProps = ShaderKitProps
export type PerlinNoiseProps = ShaderKitProps
export type PulsingBorderProps = ShaderKitProps
export type SimplexNoiseProps = ShaderKitProps
export type SmokeRingProps = ShaderKitProps
export type SpiralProps = ShaderKitProps
export type SwirlProps = ShaderKitProps
export type VoronoiProps = ShaderKitProps
export type WarpProps = ShaderKitProps
export type WaterProps = ShaderKitProps

export const ColorPanels = define('color-panels', 'ColorPanels')
export const Dithering = define('dithering', 'Dithering')
export const DotOrbit = define('dot-orbit', 'DotOrbit')
export const GodRays = define('god-rays', 'GodRays')
export const GrainGradient = define('grain-gradient', 'GrainGradient')
export const LiquidMetal = define('liquid-metal', 'LiquidMetal')
export const MeshGradient = define('mesh-gradient', 'MeshGradient')
export const Metaballs = define('metaballs', 'Metaballs')
export const NeuroNoise = define('neuro-noise', 'NeuroNoise')
export const PerlinNoise = define('perlin-noise', 'PerlinNoise')
export const PulsingBorder = define('pulsing-border', 'PulsingBorder')
export const SimplexNoise = define('simplex-noise', 'SimplexNoise')
export const SmokeRing = define('smoke-ring', 'SmokeRing')
export const Spiral = define('spiral', 'Spiral')
export const Swirl = define('swirl', 'Swirl')
export const Voronoi = define('voronoi', 'Voronoi')
export const Warp = define('warp', 'Warp')
export const Water = define('water', 'Water')
