#!/usr/bin/env node
/**
 * Build every app icon from ONE definition of the NewBrand mark: a lime N
 * on the ink tile, the same mark the sidebar shows.
 *
 * Why a hand-rolled rasterizer: the mark is only a rounded square and four
 * round-capped strokes, so it can be rendered exactly (analytic coverage with
 * 4×4 supersampling) without pulling a native image library into the build.
 * The output is deterministic, so re-running produces byte-identical files.
 *
 * Outputs
 *   build/icon.png          1024² — electron-builder source (mac/linux, NSIS)
 *   build/icon.ico          16…256 — Windows exe, installer, taskbar, shortcuts
 *   electron/assets/icon.png 512² — BrowserWindow icon (shipped with the app)
 *   public/logo.svg         favicon / web mark
 *
 * Usage: node scripts/build-icons.mjs [--check]
 *   --check  fail if any committed icon differs from what this script makes.
 */
import { deflateSync, inflateSync } from 'node:zlib'
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

export const MARK = {
  ink: [0x10, 0x11, 0x16],
  inkTop: [0x1a, 0x1c, 0x24],
  lime: [0xc8, 0xf5, 0x42],
  radius: 0.225, // tile corner radius, fraction of size
  arm: 0.255, // N stem height and half-width from centre, fraction of size
  stroke: 0.092, // stroke width, fraction of size
}

/** Small sizes get a heavier stroke so the mark survives 16 px taskbars. */
function strokeFor(size) {
  if (size <= 16) return 0.13
  if (size <= 24) return 0.115
  if (size <= 32) return 0.105
  if (size <= 48) return 0.095
  return MARK.stroke
}

function insideRoundRect(x, y, size, r) {
  const cx = Math.min(Math.max(x, r), size - r)
  const cy = Math.min(Math.max(y, r), size - r)
  const dx = x - cx
  const dy = y - cy
  return dx * dx + dy * dy <= r * r
}

function distToSegment(px, py, ax, ay, bx, by) {
  const vx = bx - ax
  const vy = by - ay
  const t = Math.max(0, Math.min(1, ((px - ax) * vx + (py - ay) * vy) / (vx * vx + vy * vy)))
  const dx = px - (ax + t * vx)
  const dy = py - (ay + t * vy)
  return Math.sqrt(dx * dx + dy * dy)
}

export function renderMark(size) {
  const px = new Uint8Array(size * size * 4)
  const r = MARK.radius * size
  const c = size / 2
  const a = MARK.arm * size
  const half = (strokeFor(size) * size) / 2
  const segments = [
    [c - a, c - a, c - a, c + a],
    [c + a, c - a, c + a, c + a],
    [c - a, c - a, c + a, c + a],
  ]
  const S = 4
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let tile = 0
      let lime = 0
      for (let sy = 0; sy < S; sy++) {
        for (let sx = 0; sx < S; sx++) {
          const fx = x + (sx + 0.5) / S
          const fy = y + (sy + 0.5) / S
          if (!insideRoundRect(fx, fy, size, r)) continue
          tile++
          if (segments.some(([ax, ay, bx, by]) => distToSegment(fx, fy, ax, ay, bx, by) <= half)) lime++
        }
      }
      const i = (y * size + x) * 4
      if (!tile) continue
      const k = y / size
      const bg = MARK.ink.map((v, j) => Math.round(MARK.inkTop[j] * (1 - k) + v * k))
      const mix = lime / tile
      px[i] = Math.round(bg[0] * (1 - mix) + MARK.lime[0] * mix)
      px[i + 1] = Math.round(bg[1] * (1 - mix) + MARK.lime[1] * mix)
      px[i + 2] = Math.round(bg[2] * (1 - mix) + MARK.lime[2] * mix)
      px[i + 3] = Math.round((255 * tile) / (S * S))
    }
  }
  return px
}

/* ——— PNG ——— */

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})
function crc32(buf) {
  let c = 0xffffffff
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}
export function encodePng(size, rgba) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // RGBA
  const raw = Buffer.alloc(size * (size * 4 + 1))
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0
    Buffer.from(rgba.buffer, y * size * 4, size * 4).copy(raw, y * (size * 4 + 1) + 1)
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

/* ——— ICO (PNG-compressed entries, supported since Windows Vista) ——— */

export function encodeIco(pngs) {
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(pngs.length, 4)
  const dir = Buffer.alloc(16 * pngs.length)
  let offset = 6 + dir.length
  pngs.forEach(({ size, png }, i) => {
    const o = i * 16
    dir[o] = size >= 256 ? 0 : size
    dir[o + 1] = size >= 256 ? 0 : size
    dir.writeUInt16LE(1, o + 4) // colour planes
    dir.writeUInt16LE(32, o + 6) // bits per pixel
    dir.writeUInt32LE(png.length, o + 8)
    dir.writeUInt32LE(offset, o + 12)
    offset += png.length
  })
  return Buffer.concat([header, dir, ...pngs.map((p) => p.png)])
}

/* ——— SVG (same geometry, for the favicon) ——— */

export function markSvg() {
  const s = 64
  const c = s / 2
  const a = +(MARK.arm * s).toFixed(2)
  const hex = (rgb) => '#' + rgb.map((v) => v.toString(16).padStart(2, '0')).join('').toUpperCase()
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${s} ${s}" role="img" aria-label="NewBrand"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${hex(MARK.inkTop)}"/><stop offset="1" stop-color="${hex(MARK.ink)}"/></linearGradient></defs><rect width="${s}" height="${s}" rx="${+(MARK.radius * s).toFixed(2)}" fill="url(#g)"/><g transform="translate(${c} ${c})" stroke="${hex(MARK.lime)}" stroke-width="${+(MARK.stroke * s * 1.1).toFixed(2)}" stroke-linecap="round"><path d="M-${a} -${a}V${a}M${a} -${a}V${a}M-${a} -${a}L${a} ${a}"/></g></svg>\n`
}

function outputs() {
  const icoSizes = [16, 24, 32, 48, 64, 128, 256]
  const ico = encodeIco(icoSizes.map((size) => ({ size, png: encodePng(size, renderMark(size)) })))
  return [
    ['build/icon.png', encodePng(1024, renderMark(1024))],
    ['build/icon.ico', ico],
    ['electron/assets/icon.png', encodePng(512, renderMark(512))],
    ['public/logo.svg', Buffer.from(markSvg())],
  ]
}

/* ——— --check compares what the icons ARE, not incidental bytes ———
 * Git on Windows checks text out with CRLF, and zlib's compressed stream can
 * differ between platforms/CPUs for identical pixels, so a byte-exact check
 * fails a release build for no real reason. Compare the SVG with normalised
 * line endings and PNG/ICO by header + decoded pixel rows.
 */
function pngPixels(buf) {
  if (buf.length < 8 || buf.readUInt32BE(0) !== 0x89504e47) return buf
  const parts = []
  const idat = []
  for (let o = 8; o + 8 <= buf.length; ) {
    const len = buf.readUInt32BE(o)
    const type = buf.toString('latin1', o + 4, o + 8)
    const data = buf.subarray(o + 8, o + 8 + len)
    if (type === 'IHDR') parts.push(Buffer.from(data))
    else if (type === 'IDAT') idat.push(data)
    o += 12 + len
  }
  try {
    parts.push(inflateSync(Buffer.concat(idat)))
  } catch {
    return buf
  }
  return Buffer.concat(parts)
}

function icoPixels(buf) {
  if (buf.length < 6 || buf.readUInt16LE(2) !== 1) return buf
  const count = buf.readUInt16LE(4)
  const parts = [buf.subarray(0, 6)]
  for (let i = 0; i < count; i++) {
    const o = 6 + i * 16
    if (o + 16 > buf.length) return buf
    const len = buf.readUInt32LE(o + 8)
    const at = buf.readUInt32LE(o + 12)
    parts.push(buf.subarray(o, o + 8), pngPixels(buf.subarray(at, at + len)))
  }
  return Buffer.concat(parts)
}

export function canonicalIcon(rel, buf) {
  if (rel.endsWith('.svg')) return Buffer.from(buf.toString('utf8').replace(/\r\n/g, '\n'))
  if (rel.endsWith('.png')) return pngPixels(buf)
  if (rel.endsWith('.ico')) return icoPixels(buf)
  return buf
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) {
  const check = process.argv.includes('--check')
  let stale = 0
  for (const [rel, data] of outputs()) {
    const file = path.join(root, rel)
    if (check) {
      if (!existsSync(file) || !canonicalIcon(rel, readFileSync(file)).equals(canonicalIcon(rel, data))) {
        console.error(`stale icon: ${rel} — run node scripts/build-icons.mjs`)
        stale++
      }
      continue
    }
    mkdirSync(path.dirname(file), { recursive: true })
    writeFileSync(file, data)
    console.log(`wrote ${rel} (${data.length} bytes)`)
  }
  if (stale) process.exit(1)
  if (check) console.log('icons: up to date')
}
