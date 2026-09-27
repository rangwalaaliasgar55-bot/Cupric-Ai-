/**
 * Part 4 — ingest a resource link with a licence check.
 *
 * Classifies a pasted URL before anything is fetched: known open sources get
 * their licence and attribution recorded; closed marketplaces and sites whose
 * terms forbid reuse are refused with a reason (never scraped); anything
 * unknown is allowed only as a link, flagged "licence unverified", and the
 * user must confirm they hold the rights before it enters a pack.
 */

export type LinkVerdict = {
  url: string
  host: string
  status: 'allowed' | 'blocked' | 'unverified'
  kind: 'image' | 'video' | 'audio' | 'font' | 'animation' | 'icon' | 'code' | 'page'
  source: string
  sourceLicense: string | null
  attribution: string | null
  /** Plain-English reason shown in the UI. */
  reason: string
  /** User must tick "I have the rights" before import. */
  requiresConfirmation: boolean
}

type Rule = { match: RegExp; source: string; license: string | null; kind: LinkVerdict['kind']; status: LinkVerdict['status']; reason: string; attribution?: (u: URL) => string }

const RULES: Rule[] = [
  // Refused: closed marketplaces / terms forbid redistribution (see ARCHITECTURE licensing rules).
  { match: /(^|\.)capcut\.(com|net)$/, source: 'CapCut', license: null, kind: 'page', status: 'blocked', reason: 'CapCut templates and assets are licensed for use inside CapCut only. Cupric never scrapes them.' },
  { match: /(^|\.)dafont\.com$/, source: 'DaFont', license: null, kind: 'font', status: 'blocked', reason: 'DaFont licences vary per font and are often personal-use only. Use Google Fonts or Fontsource instead.' },
  { match: /(^|\.)(envato|elements\.envato|videohive\.net|audiojungle\.net|motionarray|artlist\.io|epidemicsound|shutterstock|gettyimages|istockphoto|adobestock|stock\.adobe)\.com$|(^|\.)(videohive|audiojungle)\.net$/, source: 'Paid marketplace', license: null, kind: 'page', status: 'blocked', reason: 'Paid-marketplace assets are licensed to the purchaser. Download them there with your own licence and import the file.' },
  { match: /(^|\.)(tiktok|instagram|youtube|youtu|facebook|x|twitter)\.(com|be)$/, source: 'Social platform', license: null, kind: 'video', status: 'blocked', reason: 'Other people\'s social posts are copyrighted. Only import footage you own or have permission to use.' },

  // Open sources with a known licence.
  { match: /(^|\.)unsplash\.com$/, source: 'Unsplash', license: 'Unsplash License', kind: 'image', status: 'allowed', reason: 'Free to use, attribution appreciated.', attribution: (u) => `Photo via Unsplash (${u.pathname.split('/').filter(Boolean).slice(-1)[0] ?? ''})` },
  { match: /(^|\.)pexels\.com$/, source: 'Pexels', license: 'Pexels License', kind: 'image', status: 'allowed', reason: 'Free to use; do not resell unaltered copies.', attribution: () => 'Via Pexels' },
  { match: /(^|\.)pixabay\.com$/, source: 'Pixabay', license: 'Pixabay Content License', kind: 'image', status: 'allowed', reason: 'Free to use; no standalone redistribution.', attribution: () => 'Via Pixabay' },
  { match: /(^|\.)(fonts\.google|fonts\.gstatic)\.com$/, source: 'Google Fonts', license: 'OFL-1.1 / Apache-2.0', kind: 'font', status: 'allowed', reason: 'Open font licences — embeddable in video.' },
  { match: /(^|\.)fontsource\.org$/, source: 'Fontsource', license: 'per-font (OFL mostly)', kind: 'font', status: 'allowed', reason: 'Open-source fonts; licence recorded per family.' },
  { match: /(^|\.)lottiefiles\.com$/, source: 'LottieFiles', license: 'Lottie Simple License', kind: 'animation', status: 'allowed', reason: 'Free animations under the Lottie Simple License.', attribution: () => 'Animation via LottieFiles' },
  { match: /(^|\.)(lucide\.dev|heroicons\.com|phosphoricons\.com|tabler\.io)$/, source: 'Open icon set', license: 'MIT / ISC', kind: 'icon', status: 'allowed', reason: 'Permissively licensed icons.' },
  { match: /(^|\.)freesound\.org$/, source: 'Freesound', license: 'per-sound (CC0 / CC-BY / CC-BY-NC)', kind: 'audio', status: 'unverified', reason: 'Each sound has its own Creative Commons licence — check it is not NC for commercial work.' },
  { match: /(^|\.)(commons\.wikimedia|wikimedia)\.org$/, source: 'Wikimedia Commons', license: 'per-file (CC / PD)', kind: 'image', status: 'unverified', reason: 'Licence is per file; attribution is usually required.' },
  { match: /(^|\.)(github\.com|raw\.githubusercontent\.com|gitlab\.com)$/, source: 'Code repository', license: null, kind: 'code', status: 'unverified', reason: 'The licence comes from the repository — it is looked up before import.' },
]

const EXT_KIND: Array<[RegExp, LinkVerdict['kind']]> = [
  [/\.(png|jpe?g|webp|gif|avif|heic|svg)$/i, 'image'],
  [/\.(mp4|mov|webm|m4v)$/i, 'video'],
  [/\.(mp3|wav|ogg|m4a|flac)$/i, 'audio'],
  [/\.(ttf|otf|woff2?)$/i, 'font'],
  [/\.(json|lottie)$/i, 'animation'],
]

export function checkResourceLink(input: string): LinkVerdict {
  let url: URL
  try {
    url = new URL(input.trim())
  } catch {
    return { url: input, host: '', status: 'blocked', kind: 'page', source: 'Unknown', sourceLicense: null, attribution: null, reason: 'That is not a valid link.', requiresConfirmation: false }
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    return { url: input, host: url.host, status: 'blocked', kind: 'page', source: 'Unknown', sourceLicense: null, attribution: null, reason: 'Only http(s) links can be imported.', requiresConfirmation: false }
  }
  const host = url.hostname.toLowerCase().replace(/^www\./, '')
  const extKind = EXT_KIND.find(([re]) => re.test(url.pathname))?.[1]
  const rule = RULES.find((r) => r.match.test(host))
  if (rule) {
    return {
      url: url.href,
      host,
      status: rule.status,
      kind: extKind ?? rule.kind,
      source: rule.source,
      sourceLicense: rule.license,
      attribution: rule.attribution ? rule.attribution(url) : rule.license ? `${rule.source} — ${rule.license}` : null,
      reason: rule.reason,
      requiresConfirmation: rule.status === 'unverified',
    }
  }
  return {
    url: url.href,
    host,
    status: 'unverified',
    kind: extKind ?? 'page',
    source: host,
    sourceLicense: null,
    attribution: `Source: ${host}`,
    reason: 'Unknown source — Cupric cannot verify the licence. Import only if you own it or have permission.',
    requiresConfirmation: true,
  }
}

/** SPDX ids a GitHub repo licence may have that allow reuse in a video. */
export const PERMISSIVE_SPDX = new Set(['MIT', 'ISC', 'Apache-2.0', 'BSD-2-Clause', 'BSD-3-Clause', 'CC0-1.0', 'Unlicense', 'OFL-1.1', 'CC-BY-4.0', 'Zlib', 'MPL-2.0', 'LGPL-3.0', 'LGPL-2.1'])

/** Resolve a repo verdict once the licence SPDX id is known. */
export function withRepoLicense(v: LinkVerdict, spdx: string | null): LinkVerdict {
  if (v.kind !== 'code' && v.source !== 'Code repository') return v
  if (!spdx || spdx === 'NOASSERTION') return { ...v, status: 'unverified', reason: 'This repository declares no licence, so by default all rights are reserved.', requiresConfirmation: true }
  if (PERMISSIVE_SPDX.has(spdx)) return { ...v, status: 'allowed', sourceLicense: spdx, attribution: `${v.url} — ${spdx}`, reason: `${spdx} licence — keep the attribution.`, requiresConfirmation: false }
  return { ...v, status: 'unverified', sourceLicense: spdx, reason: `${spdx} has conditions (e.g. copyleft or non-commercial). Check them before use.`, requiresConfirmation: true }
}

/** `owner/repo` for a GitHub URL, for the licence lookup. */
export function githubRepoOf(url: string): string | null {
  const m = /^https?:\/\/(?:www\.)?github\.com\/([^/]+)\/([^/#?]+)/i.exec(url)
  return m ? `${m[1]}/${m[2].replace(/\.git$/, '')}` : null
}
