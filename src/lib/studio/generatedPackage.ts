import JSZip from 'jszip'

export type GeneratedPackageAsset = {
  file: File
  sourcePath: string
}

export type GeneratedPackage = {
  html: string
  name: string
  assets: GeneratedPackageAsset[]
  /**
   * Every script, data and extra document in the package, concatenated as
   * text. Generated films keep their storyboard in scenes.js / data.json /
   * App.tsx as often as in the HTML, so the scene parser reads all of it.
   */
  scripts: string
  /** Every readable text file with its path (for multi-file source projects). */
  sources: Array<{ path: string; text: string }>
  /** Package-level notes for the user (skipped files, limits). */
  notes: string[]
}

/** Code and data worth scanning for scene copy. */
const TEXT_EXT = /\.(?:m?js|cjs|jsx|tsx?|json|json5|md|txt|vue|svelte|astro|html?|css)$/i
const SKIP_PATH = /(?:^|\/)(?:node_modules|\.git|dist|build|vendor|__MACOSX)\/|\.min\.js$|(?:^|\/)(?:package-lock|pnpm-lock|yarn\.lock)|(?:^|\/)\._/i
const MAX_TEXT_FILE = 600 * 1024
const MAX_CORPUS = 3 * 1024 * 1024
const MAX_MEDIA = 60

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
  // Paths written in scripts: "assets/hero.png", './media/intro.mp4', `img/a.webp`.
  for (const match of html.matchAll(/["'`]((?:\.{0,2}\/)?[\w@%+~\-/. ]+\.(?:png|jpe?g|webp|gif|avif|svg|mp4|webm|mov|mp3|wav|ogg|m4a|aac))["'`]/gi)) add(match[1])
  return refs
}

/**
 * Read standalone generated HTML, or inspect a zip and return its primary
 * document, every script/data file as text, and referenced media as ordinary
 * Files. Nothing in the package is executed; the caller turns every returned
 * asset into a native editable clip.
 *
 * It does not throw for "unusual" packages — no index.html, scenes kept in
 * JavaScript, too many assets. It returns what it found and explains the rest.
 */
export async function readGeneratedPackage(file: File): Promise<GeneratedPackage> {
  if (/\.html?$/i.test(file.name)) return { html: await file.text(), name: file.name, assets: [], scripts: '', sources: [], notes: [] }
  if (!/\.zip$/i.test(file.name)) throw new Error('Choose a .zip, .html or .htm package')
  if (file.size > 250 * 1024 * 1024) throw new Error('Generated zip packages are limited to 250 MB')

  let zip: JSZip
  try {
    zip = await JSZip.loadAsync(file)
  } catch {
    throw new Error(`${file.name} is not a readable zip archive (it may be damaged or still downloading)`)
  }
  const notes: string[] = []
  const files = Object.values(zip.files).filter((entry) => !entry.dir && !SKIP_PATH.test(entry.name))
  const htmlEntries = files.filter((entry) => /\.html?$/i.test(entry.name))
  // Prefer the shallowest index.html, then any HTML, shallowest first.
  const depth = (name: string) => name.split('/').length
  const primary =
    htmlEntries.filter((entry) => /(^|\/)index\.html?$/i.test(entry.name)).sort((a, b) => depth(a.name) - depth(b.name))[0] ??
    [...htmlEntries].sort((a, b) => depth(a.name) - depth(b.name))[0]

  const html = primary ? await primary.async('text') : ''

  // Everything else that is text: scripts, JSON, JSX, other pages.
  let corpus = ''
  const sources: Array<{ path: string; text: string }> = []
  const textEntries = files
    .filter((entry) => entry !== primary && TEXT_EXT.test(entry.name))
    .sort((a, b) => Number(/scene|story|script|data|timeline|film|app|main|index/i.test(b.name)) - Number(/scene|story|script|data|timeline|film|app|main|index/i.test(a.name)))
  for (const entry of textEntries) {
    if (corpus.length > MAX_CORPUS) {
      notes.push('Some large code files were skipped while looking for scenes.')
      break
    }
    const size = (entry as unknown as { _data?: { uncompressedSize?: number } })._data?.uncompressedSize ?? 0
    if (size > MAX_TEXT_FILE) continue
    try {
      const text = await entry.async('text')
      if (text.length <= MAX_TEXT_FILE) {
        corpus += `\n/* ${entry.name} */\n${text}`
        sources.push({ path: entry.name, text })
      }
    } catch {
      /* unreadable entry: skip */
    }
  }

  const refs = mediaReferences(`${html}\n${corpus}`, primary?.name ?? '')
  const allMedia = files.filter((entry) => Boolean(MIME_BY_EXT[entry.name.split('.').pop()?.toLowerCase() ?? '']))
  const referenced = allMedia.filter((entry) => refs.has(normalisePath(entry.name)) || [...refs].some((ref) => normalisePath(entry.name).endsWith(`/${ref}`) || ref.endsWith(`/${entry.name.split('/').pop()}`)))
  // Nothing matched a reference (paths rewritten by a bundler, or no HTML):
  // import all the media rather than none of it.
  let mediaEntries = referenced.length ? referenced : allMedia
  if (mediaEntries.length > MAX_MEDIA) {
    notes.push(`The package has ${mediaEntries.length} media files; the first ${MAX_MEDIA} were imported.`)
    mediaEntries = mediaEntries.slice(0, MAX_MEDIA)
  }

  const assets: GeneratedPackageAsset[] = []
  for (const entry of mediaEntries) {
    const ext = entry.name.split('.').pop()?.toLowerCase() ?? ''
    try {
      const blob = await entry.async('blob')
      const leafName = entry.name.split('/').pop() || `asset.${ext}`
      assets.push({ file: new File([blob], leafName, { type: MIME_BY_EXT[ext] }), sourcePath: entry.name })
    } catch {
      notes.push(`Could not read ${entry.name}.`)
    }
  }
  if (!primary && !corpus && !assets.length) throw new Error(`${file.name} contains no HTML, code or media that Cupric can edit`)
  return { html, name: primary?.name.split('/').pop() || file.name, assets, scripts: corpus, sources, notes }
}
