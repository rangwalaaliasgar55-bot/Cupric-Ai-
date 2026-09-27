/**
 * Phone-photo import (2.30) and photo proxies (2.25).
 *
 *  - HEIC/HEIF (every iPhone photo by default) is not decodable by Chromium.
 *    It used to fail as "could not be decoded as an image"; now it is
 *    converted to JPEG on import. The converter (heic2any, MIT, which bundles
 *    libheif under LGPL-3.0) is a separate lazily loaded chunk, fetched only
 *    when a HEIC file is actually imported.
 *  - EXIF orientation is honoured: Chromium (the only engine Cupric runs in)
 *    applies it when decoding an image (`image-orientation: from-image`, the
 *    default since M81), so naturalWidth/Height and every drawImage are
 *    already upright — including the proxy, which is drawn from the decoded
 *    image. The tag is still read so the import can report it. HEIC
 *    conversion writes upright pixels too.
 *  - Photos larger than PROXY_EDGE get a downscaled preview proxy; scrubbing
 *    and preview draw the proxy, and only export touches the full original.
 *
 * The byte-level helpers are pure so scripts/check-photo-import.mjs tests them.
 */

/** Long edge of the preview proxy. Preview canvases are ≤720 px, so this
 *  leaves room for a 2× zoom/Ken Burns push before softness shows. */
export const PROXY_EDGE = 1600

const HEIC_BRANDS = new Set(['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'mif1', 'msf1'])

/** True when the bytes are an ISO-BMFF HEIF/HEIC container (brand at offset 8). */
export function isHeicBytes(bytes: Uint8Array): boolean {
  if (bytes.length < 12) return false
  const ftyp = String.fromCharCode(bytes[4], bytes[5], bytes[6], bytes[7])
  if (ftyp !== 'ftyp') return false
  const brand = String.fromCharCode(bytes[8], bytes[9], bytes[10], bytes[11])
  if (HEIC_BRANDS.has(brand)) return true
  // Compatible brands list (after major brand + minor version).
  for (let i = 16; i + 4 <= Math.min(bytes.length, 64); i += 4) {
    const b = String.fromCharCode(bytes[i], bytes[i + 1], bytes[i + 2], bytes[i + 3])
    if (b === 'heic' || b === 'heix' || b === 'mif1') return true
  }
  return false
}

export function looksLikeHeicName(name: string, type = ''): boolean {
  return /image\/hei[cf]/i.test(type) || /\.(heic|heif)$/i.test(name)
}

/**
 * EXIF orientation (1–8) from a JPEG, or 1 when absent/unreadable.
 * 1 = upright; 3 = 180°; 6 = 90° CW; 8 = 90° CCW; 2/4/5/7 mirrored variants.
 */
export function readExifOrientation(buffer: ArrayBuffer): number {
  const view = new DataView(buffer)
  if (view.byteLength < 4 || view.getUint16(0) !== 0xffd8) return 1
  let offset = 2
  while (offset + 4 <= view.byteLength) {
    const marker = view.getUint16(offset)
    const size = view.getUint16(offset + 2)
    if (marker === 0xffe1 && offset + 10 <= view.byteLength && view.getUint32(offset + 4) === 0x45786966) {
      const tiff = offset + 10
      if (tiff + 8 > view.byteLength) return 1
      const little = view.getUint16(tiff) === 0x4949
      const ifd = tiff + view.getUint32(tiff + 4, little)
      if (ifd + 2 > view.byteLength) return 1
      const entries = view.getUint16(ifd, little)
      for (let i = 0; i < entries; i += 1) {
        const entry = ifd + 2 + i * 12
        if (entry + 10 > view.byteLength) return 1
        if (view.getUint16(entry, little) === 0x0112) {
          const value = view.getUint16(entry + 8, little)
          return value >= 1 && value <= 8 ? value : 1
        }
      }
      return 1
    }
    if ((marker & 0xff00) !== 0xff00 || size < 2) return 1
    offset += 2 + size
  }
  return 1
}

/** Orientations 5–8 swap width and height. */
export function orientationSwapsAxes(orientation: number): boolean {
  return orientation >= 5 && orientation <= 8
}

/** Proxy dimensions for a photo, or null when the original is already small enough. */
export function proxySize(width: number, height: number, maxEdge = PROXY_EDGE): [number, number] | null {
  const long = Math.max(width, height)
  if (!(long > maxEdge)) return null
  const k = maxEdge / long
  return [Math.max(1, Math.round(width * k)), Math.max(1, Math.round(height * k))]
}

/** Convert a HEIC/HEIF blob to JPEG. Throws a message a person can act on. */
export async function convertHeic(blob: Blob, fileName: string): Promise<Blob> {
  try {
    const { default: heic2any } = await import('heic2any')
    const out = await heic2any({ blob, toType: 'image/jpeg', quality: 0.92 })
    return Array.isArray(out) ? out[0] : out
  } catch (err) {
    const detail = err instanceof Error ? err.message : typeof err === 'object' && err && 'message' in err ? String((err as { message: unknown }).message) : String(err)
    throw new Error(`${fileName} is a HEIC photo and could not be converted (${detail}). Export it as JPEG from Photos, or set your camera to “Most Compatible”, and import it again.`)
  }
}

export type PreparedPhoto = {
  /** What export draws: the full-resolution, correctly oriented original. */
  full: HTMLImageElement
  /** What preview/scrub draws: a ≤PROXY_EDGE copy, or `full` when small. */
  preview: HTMLImageElement | HTMLCanvasElement
  width: number
  height: number
  orientation: number
  proxied: boolean
}

/**
 * Orientation-correct a decoded photo and build its preview proxy.
 * `bytes` are the (JPEG) file bytes, used to read the EXIF tag.
 */
export function preparePhoto(img: HTMLImageElement, bytes: ArrayBuffer | null): PreparedPhoto {
  const orientation = bytes ? readExifOrientation(bytes) : 1
  const full = img
  const width = img.naturalWidth
  const height = img.naturalHeight
  const size = proxySize(width, height)
  if (!size) return { full, preview: full, width, height, orientation, proxied: false }
  const canvas = document.createElement('canvas')
  canvas.width = size[0]
  canvas.height = size[1]
  const ctx = canvas.getContext('2d')
  if (!ctx) return { full, preview: full, width, height, orientation, proxied: false }
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(full, 0, 0, size[0], size[1])
  return { full, preview: canvas, width, height, orientation, proxied: true }
}
