import { useEffect, useId, useMemo, useState, type CSSProperties } from 'react'
import {
  displacementMapDataUrl,
  glassPreset,
  supportsBackdropFilter,
  type GlassParams,
  type GlassPresetId,
} from '../../lib/glass'
import { cx } from '../../lib/utils'

export type GlassSurfaceProps = {
  preset?: GlassPresetId
  /** Override individual params of the preset. */
  params?: Partial<GlassParams>
  /** Turn the edge bend off — frosted only. */
  refract?: boolean
  /** Lift brightness on hover/focus of the parent `.glass-control`. */
  reveal?: boolean
  radius?: number
  className?: string
  style?: CSSProperties
}

/**
 * The material itself: an absolutely-positioned layer that frosts and refracts
 * whatever is painted behind it. Drop it as the first child of a `relative`,
 * `overflow-hidden` container.
 *
 * It picks its own render path — displacement when the engine supports
 * backdrop-filter, a plain frost when it doesn't, and no animation at all
 * under `prefers-reduced-transparency` / `prefers-reduced-motion`.
 */
export function GlassSurface({
  preset = 'portfolio',
  params: overrides,
  refract = true,
  reveal = false,
  radius = 16,
  className,
  style,
}: GlassSurfaceProps) {
  const filterId = useId().replace(/[:]/g, '')
  const [canRefract, setCanRefract] = useState(false)
  const params = useMemo(() => ({ ...glassPreset(preset).params, ...overrides }), [preset, overrides])

  useEffect(() => {
    const reducedTransparency =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-transparency: reduce)').matches
    setCanRefract(refract && params.strength > 0 && supportsBackdropFilter() && !reducedTransparency)
  }, [refract, params.strength])

  // The map only depends on the bezel shape, so it is regenerated rarely.
  const mapUrl = useMemo(
    () => (canRefract ? displacementMapDataUrl({ bezel: params.bezel, curvature: params.curvature }) : ''),
    [canRefract, params.bezel, params.curvature],
  )

  const displacementScale = params.strength * 40

  return (
    <>
      {canRefract && mapUrl && (
        <svg aria-hidden className="pointer-events-none absolute h-0 w-0" focusable="false">
          <defs>
            <filter id={filterId} colorInterpolationFilters="sRGB">
              <feImage href={mapUrl} result="map" preserveAspectRatio="none" x="0" y="0" width="100%" height="100%" />
              {/* Chromatic dispersion: each channel is displaced by a slightly
                  different amount, which is what reads as "glass" not "blur". */}
              <feDisplacementMap
                in="SourceGraphic"
                in2="map"
                scale={displacementScale * (1 + params.chroma * 0.35)}
                xChannelSelector="R"
                yChannelSelector="G"
                result="red"
              />
              <feColorMatrix
                in="red"
                type="matrix"
                values="1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0"
                result="redOnly"
              />
              <feDisplacementMap
                in="SourceGraphic"
                in2="map"
                scale={displacementScale}
                xChannelSelector="R"
                yChannelSelector="G"
                result="green"
              />
              <feColorMatrix
                in="green"
                type="matrix"
                values="0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0"
                result="greenOnly"
              />
              <feDisplacementMap
                in="SourceGraphic"
                in2="map"
                scale={displacementScale * (1 - params.chroma * 0.35)}
                xChannelSelector="R"
                yChannelSelector="G"
                result="blue"
              />
              <feColorMatrix
                in="blue"
                type="matrix"
                values="0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0"
                result="blueOnly"
              />
              <feBlend in="redOnly" in2="greenOnly" mode="screen" result="rg" />
              <feBlend in="rg" in2="blueOnly" mode="screen" />
            </filter>
          </defs>
        </svg>
      )}

      <span
        aria-hidden
        data-glass-reveal={reveal ? '' : undefined}
        className={cx('glass-surface pointer-events-none absolute inset-0', className)}
        style={{
          borderRadius: radius,
          backdropFilter: `blur(${params.blur}px) saturate(${params.saturate})`,
          WebkitBackdropFilter: `blur(${params.blur}px) saturate(${params.saturate})`,
          background: params.tint,
          filter: canRefract && mapUrl ? `url(#${filterId})` : undefined,
          ...style,
        }}
      />

      {/* Rim + specular sit above the refraction so the highlight stays sharp. */}
      <span
        aria-hidden
        className="glass-rim pointer-events-none absolute inset-0"
        style={{
          borderRadius: radius,
          backgroundImage: `linear-gradient(${params.specularAngle}deg, rgba(255,255,255,${0.5 * params.edge}) 0%, rgba(255,255,255,0) 30%, rgba(255,255,255,0) 70%, rgba(255,255,255,${0.28 * params.edge}) 100%)`,
          boxShadow: `inset 0 1px 0 rgba(255,255,255,${0.5 * params.edge}), inset 0 -1px 0 rgba(255,255,255,${0.2 * params.edge}), inset 0 0 ${18 * params.glow}px rgba(255,255,255,${0.3 * params.glow})`,
        }}
      />
    </>
  )
}
