/**
 * Trim a captured frame strip down to the component that is actually in it.
 *
 * A UI Lab stage is a wide canvas with the component somewhere in the middle.
 * Dropped into a 9:16 video untouched, that is a small widget floating in a big
 * flat rectangle. This finds the background colour from the corners, takes the
 * UNION of the content bounds over every frame (so nothing that moves gets cut
 * off mid-animation), pads it, and crops every frame identically. The crop gets
 * rounded corners so it sits on footage like a designed card, not a screenshot.
 *
 * Never throws: if anything goes wrong the original frames come back untouched.
 */

type Rect = { x: number; y: number; w: number; h: number }

function load(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('frame decode failed'))
    img.src = src
  })
}

/**
 * The stage background, read from a ring just inside the edges. The edge
 * itself is skipped on purpose: stages have borders and rounded corners that
 * are not "content" and would otherwise stretch the bounds to the full frame.
 */
function ringColour(d: Uint8ClampedArray, w: number, h: number, inset: number) {
  const r: number[] = [], g: number[] = [], b: number[] = [], a: number[] = []
  const push = (x: number, y: number) => {
    const i = (y * w + x) * 4
    r.push(d[i]); g.push(d[i + 1]); b.push(d[i + 2]); a.push(d[i + 3])
  }
  const stepX = Math.max(1, Math.floor(w / 64))
  const stepY = Math.max(1, Math.floor(h / 64))
  for (let x = inset; x < w - inset; x += stepX) { push(x, inset); push(x, h - 1 - inset) }
  for (let y = inset; y < h - inset; y += stepY) { push(inset, y); push(w - 1 - inset, y) }
  const median = (v: number[]) => v.sort((p, q) => p - q)[v.length >> 1] ?? 0
  return [median(r), median(g), median(b), median(a)]
}

function contentBounds(img: HTMLImageElement, tolerance: number): Rect | null {
  const w = img.naturalWidth
  const h = img.naturalHeight
  if (w < 32 || h < 32) return null
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return null
  ctx.drawImage(img, 0, 0)
  const d = ctx.getImageData(0, 0, w, h).data
  const inset = Math.max(8, Math.round(Math.min(w, h) * 0.035))
  const bg = ringColour(d, w, h, inset)
  let minX = w, minY = h, maxX = -1, maxY = -1
  const step = w * h > 1_500_000 ? 2 : 1
  for (let y = inset; y < h - inset; y += step) {
    for (let x = inset; x < w - inset; x += step) {
      const i = (y * w + x) * 4
      const diff = Math.max(Math.abs(d[i] - bg[0]), Math.abs(d[i + 1] - bg[1]), Math.abs(d[i + 2] - bg[2]), Math.abs(d[i + 3] - bg[3]))
      if (diff > tolerance) {
        if (x < minX) minX = x
        if (x > maxX) maxX = x
        if (y < minY) minY = y
        if (y > maxY) maxY = y
      }
    }
  }
  if (maxX < 0) return null
  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 }
}

export async function trimFrames(
  frames: string[],
  { padPx = 24, tolerance = 14, radiusPx = 18, type = 'image/webp', quality = 0.85 } = {},
): Promise<{ frames: string[]; trimmed: boolean }> {
  try {
    if (!frames.length) return { frames, trimmed: false }
    const images = await Promise.all(frames.map(load))
    const w = images[0].naturalWidth
    const h = images[0].naturalHeight
    let union: Rect | null = null
    // Bounds from a spread of frames is enough: motion is continuous, and
    // decoding every frame to pixels twice would double the capture time.
    const sampleIdx = [...new Set([0, 0.2, 0.4, 0.6, 0.8, 1].map((k) => Math.round(k * (images.length - 1))))]
    for (const idx of sampleIdx) {
      const b = contentBounds(images[idx], tolerance)
      if (!b) continue
      union = union
        ? {
            x: Math.min(union.x, b.x),
            y: Math.min(union.y, b.y),
            w: Math.max(union.x + union.w, b.x + b.w) - Math.min(union.x, b.x),
            h: Math.max(union.y + union.h, b.y + b.h) - Math.min(union.y, b.y),
          }
        : b
    }
    if (!union) return { frames, trimmed: false }
    const x = Math.max(0, union.x - padPx)
    const y = Math.max(0, union.y - padPx)
    const cw = Math.min(w, union.x + union.w + padPx) - x
    const ch = Math.min(h, union.y + union.h + padPx) - y
    // Not worth it when the component already fills the stage.
    if (cw * ch > w * h * 0.85) return { frames, trimmed: false }
    const out = document.createElement('canvas')
    out.width = cw
    out.height = ch
    const ctx = out.getContext('2d')
    if (!ctx) return { frames, trimmed: false }
    const radius = Math.min(radiusPx, cw / 4, ch / 4)
    const result = images.map((img) => {
      ctx.clearRect(0, 0, cw, ch)
      ctx.save()
      ctx.beginPath()
      if (typeof ctx.roundRect === 'function') ctx.roundRect(0, 0, cw, ch, radius)
      else ctx.rect(0, 0, cw, ch)
      ctx.clip()
      ctx.drawImage(img, x, y, cw, ch, 0, 0, cw, ch)
      ctx.restore()
      return out.toDataURL(type, quality)
    })
    return { frames: result, trimmed: true }
  } catch {
    return { frames, trimmed: false }
  }
}
