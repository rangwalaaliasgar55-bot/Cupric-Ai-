import JSZip from 'jszip'

export type GeneratedPackageAsset = {
  file: File
  sourcePath: string
}

export type GeneratedPackage = {
  html: string
  name: string
  assets: GeneratedPackageAsset[]
}

const MIME_BY_EXT: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif',
  avif: 'image/avif', svg: 'image/svg+xml', mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime',
  mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', m4a: 'audio/mp4', aac: 'audio/aac',
}

function normalisePath(path: string) {
  const parts: string[] = []
  for (const part of path.replace(/\\/g, '/').split('/')) {
    if (!part || part === '.') continue
    if (part === '..') parts.pop()
    else parts.push(part)
  }
  return parts.join('/')
}

function mediaReferences(html: string, htmlPath: string) {
  const base = htmlPath.includes('/') ? htmlPath.slice(0, htmlPath.lastIndexOf('/') + 1) : ''
  const refs = new Set<string>()
  const add = (raw: string) => {
    const value = raw.trim().replace(/^['"]|['"]$/g, '').split(/[?#]/)[0]
    if (!value || /^(?:data:|blob:|https?:|\/\/|#)/i.test(value)) return
    refs.add(normalisePath(base + value.replace(/^\.\//, '')))
  }
  for (const match of html.matchAll(/(?:src|poster)\s*=\s*(["'])(.*?)\1/gi)) add(match[2])
  for (const match of html.matchAll(/url\(\s*(["']?)(.*?)\1\s*\)/gi)) add(match[2])
  return refs
}

/**
 * Read standalone generated HTML, or inspect a zip and return both its primary
 * document and referenced media as ordinary Files. Nothing in the HTML is
 * executed; the caller turns every returned asset into a native editable clip.
 */
export async function readGeneratedPackage(file: File): Promise<GeneratedPackage> {
  if (/\.html?$/i.test(file.name)) return { html: await file.text(), name: file.name, assets: [] }
  if (!/\.zip$/i.test(file.name)) throw new Error('Choose a .zip, .html or .htm package')
  if (file.size > 250 * 1024 * 1024) throw new Error('Generated zip packages are limited to 250 MB')

  const zip = await JSZip.loadAsync(file)
  const entries = Object.values(zip.files).filter((entry) => !entry.dir && /\.html?$/i.test(entry.name))
  const primary = entries.find((entry) => /(^|\/)index\.html?$/i.test(entry.name)) ?? entries[0]
  if (!primary) throw new Error('This zip has no index.html or other HTML document to break down')

  const html = await primary.async('text')
  const refs = mediaReferences(html, primary.name)
  const mediaEntries = Object.values(zip.files).filter((entry) => {
    if (entry.dir) return false
    const ext = entry.name.split('.').pop()?.toLowerCase() ?? ''
    return Boolean(MIME_BY_EXT[ext]) && (refs.size === 0 || refs.has(normalisePath(entry.name)))
  })
  if (mediaEntries.length > 60) throw new Error(`This package references ${mediaEntries.length} media assets; the editable import limit is 60`)

  const assets: GeneratedPackageAsset[] = []
  for (const entry of mediaEntries) {
    const ext = entry.name.split('.').pop()?.toLowerCase() ?? ''
    const blob = await entry.async('blob')
    const leafName = entry.name.split('/').pop() || `asset.${ext}`
    assets.push({ file: new File([blob], leafName, { type: MIME_BY_EXT[ext] }), sourcePath: entry.name })
  }
  return { html, name: primary.name.split('/').pop() || file.name, assets }
}
