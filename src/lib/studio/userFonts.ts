/**
 * Fonts the user adds themselves (for example families they downloaded from
 * fontshare.com under their own free ITF licence). They stay on this machine
 * (IndexedDB), are registered with FontFace for preview AND export, and are
 * never uploaded or redistributed by NewBrand.
 */

export const FONT_FILE_EXT = /\.(woff2|woff|otf|ttf)$/i
export type UserFontFace = { id: string; family: string; weight: string; style: 'normal' | 'italic'; fileName: string; source: 'fontshare' | 'file'; addedAt: number }
type Stored = UserFontFace & { data: ArrayBuffer }

export const USER_FONTS_EVENT = 'newbrand:user-fonts-changed'
const FONT_EXT = /\.(woff2|woff|otf|ttf)$/i
const DB = 'newbrand-user-fonts'
const STORE = 'faces'

let faces: UserFontFace[] = []
let ready: Promise<void> | null = null

/* ─────────────── sfnt metadata (pure; tested) ─────────────── */

export type FontMeta = { family: string | null; subfamily: string | null; weight: number | null; italic: boolean; variable: [number, number] | null }

/** Read family/weight/italic from an OTF/TTF buffer. WOFF/WOFF2 → null fields (filename is used). */
export function readFontMeta(buf: ArrayBuffer): FontMeta {
  const empty: FontMeta = { family: null, subfamily: null, weight: null, italic: false, variable: null }
  if (buf.byteLength < 12) return empty
  const v = new DataView(buf)
  const tag = v.getUint32(0)
  if (tag !== 0x00010000 && tag !== 0x4f54544f && tag !== 0x74727565) return empty // not TTF/OTF/true
  const num = v.getUint16(4)
  const tables = new Map<string, { off: number; len: number }>()
  for (let i = 0; i < num; i++) {
    const o = 12 + i * 16
    if (o + 16 > buf.byteLength) break
    const t = String.fromCharCode(v.getUint8(o), v.getUint8(o + 1), v.getUint8(o + 2), v.getUint8(o + 3))
    tables.set(t, { off: v.getUint32(o + 8), len: v.getUint32(o + 12) })
  }
  const out = { ...empty }
  const name = tables.get('name')
  if (name && name.off + 6 <= buf.byteLength) {
    const count = v.getUint16(name.off + 2)
    const strOff = name.off + v.getUint16(name.off + 4)
    const found: Record<number, string> = {}
    for (let i = 0; i < count; i++) {
      const r = name.off + 6 + i * 12
      if (r + 12 > buf.byteLength) break
      const platform = v.getUint16(r), id = v.getUint16(r + 6), len = v.getUint16(r + 8), off = strOff + v.getUint16(r + 10)
      if (![1, 2, 16, 17].includes(id) || off + len > buf.byteLength) continue
      let s = ''
      if (platform === 3 || platform === 0) for (let j = 0; j + 1 < len; j += 2) s += String.fromCharCode(v.getUint16(off + j))
      else if (platform === 1) for (let j = 0; j < len; j++) s += String.fromCharCode(v.getUint8(off + j))
      if (s && (platform === 3 || !found[id])) found[id] = s
    }
    out.family = (found[16] || found[1] || '').trim() || null
    out.subfamily = (found[17] || found[2] || '').trim() || null
  }
  const os2 = tables.get('OS/2')
  if (os2 && os2.off + 64 <= buf.byteLength) {
    out.weight = v.getUint16(os2.off + 4)
    out.italic = (v.getUint16(os2.off + 62) & 1) === 1
  }
  const fvar = tables.get('fvar')
  if (fvar && fvar.off + 16 <= buf.byteLength) {
    const axesOff = fvar.off + v.getUint16(fvar.off + 4), axes = v.getUint16(fvar.off + 8), size = v.getUint16(fvar.off + 10)
    for (let i = 0; i < axes; i++) {
      const a = axesOff + i * size
      if (a + 20 > buf.byteLength) break
      if (v.getUint32(a) === 0x77676874) out.variable = [v.getInt32(a + 4) / 65536, v.getInt32(a + 12) / 65536] // 'wght'
    }
  }
  if (out.subfamily && /italic|oblique/i.test(out.subfamily)) out.italic = true
  return out
}

const WEIGHT_WORDS: Array<[RegExp, number]> = [[/thin|hairline/i, 100], [/extra ?light|ultra ?light/i, 200], [/light/i, 300], [/medium/i, 500], [/semi ?bold|demi/i, 600], [/extra ?bold|ultra ?bold/i, 800], [/black|heavy/i, 900], [/bold/i, 700]]

/** "ClashDisplay-SemiboldItalic.woff2" → { family: "Clash Display", weight: 600, italic: true } */
export function metaFromFileName(fileName: string): { family: string; weight: number; italic: boolean; variable: boolean } {
  const base = fileName.split('/').pop()!.replace(FONT_EXT, '')
  const [famRaw, styleRaw = ''] = base.split(/[-_](?=[^-_]*$)/)
  const family = famRaw.replace(/[-_]+/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/\s+(Variable|VF)$/i, '').trim()
  const style = styleRaw || ''
  const variable = /variable|vf/i.test(style) || /variable/i.test(base)
  const weight = WEIGHT_WORDS.find(([re]) => re.test(style))?.[1] ?? 400
  return { family, weight, italic: /italic|oblique/i.test(style), variable }
}

/* ─────────────── storage ─────────────── */

function db(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    if (typeof indexedDB === 'undefined') return resolve(null)
    const req = indexedDB.open(DB, 1)
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id' })
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => resolve(null)
  })
}
async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T | null> {
  const d = await db()
  if (!d) return null
  return new Promise((resolve) => {
    const r = fn(d.transaction(STORE, mode).objectStore(STORE))
    r.onsuccess = () => resolve(r.result)
    r.onerror = () => resolve(null)
  })
}

async function register(s: Stored) {
  if (typeof document === 'undefined' || !('fonts' in document)) return
  const face = new FontFace(s.family, s.data.slice(0), { weight: s.weight, style: s.style })
  await face.load()
  document.fonts.add(face)
}

/** Load every stored face once (app start / first use). */
export function userFontsReady(): Promise<void> {
  if (!ready) ready = (async () => {
    const all = ((await tx('readonly', (s) => s.getAll())) ?? []) as Stored[]
    faces = all.map(({ data: _d, ...f }) => f)
    await Promise.all(all.map((f) => register(f).catch(() => undefined)))
    if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(USER_FONTS_EVENT))
  })()
  return ready
}

export function isUserFont(family: string): boolean {
  const k = family.trim().toLowerCase()
  return faces.some((f) => f.family.toLowerCase() === k)
}
export function userFontFamilies(): string[] {
  return [...new Set(faces.map((f) => f.family))].sort()
}
export function userFontFaces(): UserFontFace[] {
  return faces
}

export type ImportFontsResult = { added: UserFontFace[]; skipped: string[] }

export type FontFileEntry = { name: string; data: ArrayBuffer }

/** Add font files (already extracted — see fontZip.ts for .zip downloads such as Fontshare). */
export async function importFontEntries(entries: FontFileEntry[], source: UserFontFace['source'] = 'file', skipped: string[] = []): Promise<ImportFontsResult> {
  entries = entries.filter((e) => FONT_EXT.test(e.name))
  // Prefer one format per face: woff2 > otf > ttf > woff; variable files replace statics of the same family.
  const rank = (n: string) => (/\.woff2$/i.test(n) ? 0 : /\.otf$/i.test(n) ? 1 : /\.ttf$/i.test(n) ? 2 : 3)
  entries.sort((a, b) => rank(a.name) - rank(b.name))
  const seen = new Set<string>()
  const added: UserFontFace[] = []
  await userFontsReady()
  for (const e of entries) {
    const m = readFontMeta(e.data)
    const f = metaFromFileName(e.name)
    const family = m.family ?? f.family
    const weight = m.variable ? `${m.variable[0]} ${m.variable[1]}` : f.variable ? '100 900' : String(m.weight ?? f.weight)
    const style = (m.family ? m.italic : f.italic) ? 'italic' : 'normal'
    const id = `${family}|${weight}|${style}`.toLowerCase()
    if (!family || seen.has(id)) { if (family) skipped.push(`${e.name} (duplicate of an added face)`); continue }
    seen.add(id)
    const rec: Stored = { id, family, weight, style, fileName: e.name.split('/').pop()!, source, addedAt: Date.now(), data: e.data }
    try {
      await register(rec)
    } catch {
      skipped.push(`${e.name} (the browser could not read this font file)`)
      continue
    }
    await tx('readwrite', (s) => s.put(rec))
    const { data: _data, ...face } = rec
    faces = [...faces.filter((x) => x.id !== id), face]
    added.push(face)
  }
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(USER_FONTS_EVENT))
  return { added, skipped }
}

export async function removeUserFontFamily(family: string): Promise<void> {
  const gone = faces.filter((f) => f.family === family)
  for (const f of gone) await tx('readwrite', (s) => s.delete(f.id))
  faces = faces.filter((f) => f.family !== family)
  if (typeof document !== 'undefined' && 'fonts' in document) for (const ff of [...document.fonts]) if (ff.family.replace(/["']/g, '') === family) document.fonts.delete(ff)
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(USER_FONTS_EVENT))
}
