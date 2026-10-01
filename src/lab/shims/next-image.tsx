/**
 * next/image shim.
 *
 * The lab components were written for Next.js. NewBrand is a Vite + Electron
 * app with no image optimizer, so `Image` is a plain <img> that honours the
 * same props the lab files pass (src / alt / width / height / className).
 */
import type { CSSProperties } from 'react'

export type ImageProps = {
  src: string
  alt: string
  width?: number
  height?: number
  className?: string
  style?: CSSProperties
  priority?: boolean
  unoptimized?: boolean
  draggable?: boolean
  sizes?: string
  fill?: boolean
}

export default function Image({ priority: _priority, unoptimized: _unoptimized, fill, style, ...props }: ImageProps) {
  const fillStyle: CSSProperties | undefined = fill
    ? { position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', ...style }
    : style
  // eslint-disable-next-line jsx-a11y/alt-text -- alt comes through props
  return <img {...props} style={fillStyle} />
}
