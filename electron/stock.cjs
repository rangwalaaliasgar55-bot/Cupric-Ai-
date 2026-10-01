/**
 * Main-process stock rail for Pixabay, Pexels, Openverse and Picsum.
 * API keys never leave this module. Search results are cached for 24 hours and
 * downloads are copied into a project's private app-data folder before the
 * renderer sees them.
 */
const crypto = require('node:crypto')
const fs = require('node:fs')
const fsp = require('node:fs/promises')
const path = require('node:path')
const { fileURLToPath } = require('node:url')

const DAY = 24 * 60 * 60 * 1000
const PIXABAY_LIMIT = { count: 100, windowMs: 60 * 1000 }
const PEXELS_LIMIT = { count: 200, windowMs: 60 * 60 * 1000 }
const OPENVERSE_LIMIT = { count: 5, windowMs: 60 * 60 * 1000, dayCount: 100, dayMs: DAY }
const ALLOWED_HOSTS = new Set(['pixabay.com', 'images.pexels.com', 'videos.pexels.com', 'api.openverse.org', 'images.openverse.org', 'picsum.photos'])

const clampPage = (value, max) => Math.max(1, Math.min(max, Math.round(Number(value) || 1)))
const clampPerPage = (value, max) => Math.max(3, Math.min(max, Math.round(Number(value) || 20)))
const text = (value, fallback = '') => String(value ?? fallback).trim()
const hash = (value) => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 32)

function cleanProxy(value) {
  const raw = text(value)
  if (!raw) return ''
  try {
    const url = new URL(raw)
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return ''
    return `${url.origin}${url.pathname.replace(/\/+$/, '')}`
  } catch { return '' }
}

function safeFileName(value, fallback = 'stock') {
  const base = path.basename(text(value, fallback)).replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '')
  return (base || fallback).slice(0, 120)
}

function normalizeOptions(options = {}) {
  return {
    query: text(options.query),
    page: clampPage(options.page, 500),
    perPage: clampPerPage(options.perPage, 50),
    orientation: ['all', 'horizontal', 'vertical'].includes(options.orientation) ? options.orientation : 'all',
    category: text(options.category),
    colors: text(options.colors),
    imageType: ['all', 'photo', 'illustration', 'vector'].includes(options.imageType) ? options.imageType : 'all',
    editorsChoice: Boolean(options.editorsChoice),
    license: text(options.license, 'cc0,by'),
  }
}

function pixabayUrl(kind, options, key, proxyUrl) {
  const o = normalizeOptions(options)
  const params = new URLSearchParams({
    q: o.query,
    page: String(o.page),
    per_page: String(Math.min(200, o.perPage)),
    safesearch: 'true',
    orientation: o.orientation,
  })
  if (o.category) params.set('category', o.category)
  if (o.colors) params.set('colors', o.colors)
  if (o.imageType && kind === 'image') params.set('image_type', o.imageType)
  if (o.editorsChoice) params.set('editors_choice', 'true')
  const proxy = cleanProxy(proxyUrl)
  if (proxy) return `${proxy}/pixabay${kind === 'video' ? '/videos' : ''}?${params.toString()}`
  params.set('key', text(key))
  return `https://pixabay.com/api${kind === 'video' ? '/videos' : '/'}?${params.toString()}`
}

function pexelsUrl(kind, options, proxyUrl) {
  const o = normalizeOptions(options)
  const params = new URLSearchParams({ query: o.query, page: String(o.page), per_page: String(Math.min(80, o.perPage)) })
  if (o.orientation !== 'all') params.set('orientation', o.orientation)
  if (o.colors) params.set('color', o.colors)
  const proxy = cleanProxy(proxyUrl)
  return `${proxy ? `${proxy}/pexels` : `https://api.pexels.com/v1`}/${kind === 'video' ? 'videos/search' : 'search'}?${params.toString()}`
}

function openverseUrl(options) {
  const o = normalizeOptions(options)
  const params = new URLSearchParams({ q: o.query, page: String(o.page), page_size: String(Math.min(20, o.perPage)), license: o.license || 'cc0,by' })
  return `https://api.openverse.org/v1/images/?${params.toString()}`
}

function picsumItems(options = {}) {
  const o = normalizeOptions(options)
  const count = Math.min(20, o.perPage)
  const seed = text(options.seed, o.query || 'newbrand')
  return Array.from({ length: count }, (_, index) => {
    const id = `${seed}-${(o.page - 1) * count + index}`
    const imageId = Math.abs(hash(id).split('').reduce((n, c) => n + c.charCodeAt(0), 0)) % 1000
    const width = o.orientation === 'vertical' ? 720 : 1280
    const height = o.orientation === 'horizontal' ? 720 : 1280
    const params = options.grayscale ? '&grayscale' : ''
    return {
      provider: 'picsum', id, kind: 'image', title: `Placeholder ${imageId}`, user: 'Picsum', photographer: 'Picsum',
      previewUrl: `https://picsum.photos/id/${imageId}/${Math.min(480, width)}/${Math.min(480, height)}${params}`,
      downloadUrl: `https://picsum.photos/id/${imageId}/${width}/${height}${params}`,
      pageUrl: `https://picsum.photos/id/${imageId}`, attribution: 'Placeholder via Picsum (replace before publishing)',
      license: 'Picsum placeholder service', placeholderOnly: true,
    }
  })
}

function normalizePixabay(kind, hit) {
  const url = text(kind === 'video' ? hit.videos?.medium?.url || hit.videos?.small?.url : hit.largeImageURL || hit.webformatURL)
  return {
    provider: 'pixabay', id: String(hit.id), kind, title: text(hit.tags, 'Pixabay stock'), user: text(hit.user, 'Pixabay user'), photographer: text(hit.user, 'Pixabay user'),
    previewUrl: text(hit.previewURL || url), downloadUrl: url, pageUrl: text(hit.pageURL, 'https://pixabay.com/'),
    attribution: `via Pixabay user ${text(hit.user, 'unknown')}`, license: 'Pixabay Content License', placeholderOnly: false,
  }
}

function normalizePexels(kind, hit) {
  let downloadUrl = ''
  if (kind === 'image') downloadUrl = text(hit.src?.large2x || hit.src?.large || hit.src?.original)
  else {
    const files = Array.isArray(hit.video_files) ? hit.video_files.filter((file) => file?.link && Number(file.width || 0) <= 1920 && Number(file.height || 0) <= 1080) : []
    downloadUrl = text((files.sort((a, b) => Number(b.width || 0) - Number(a.width || 0))[0] || hit.video_files?.[0])?.link)
  }
  const photographer = text(hit.photographer, 'Pexels photographer')
  return {
    provider: 'pexels', id: String(hit.id), kind, title: text(hit.alt || hit.url, 'Pexels stock'), user: photographer, photographer,
    previewUrl: text(kind === 'image' ? hit.src?.medium || hit.src?.small : hit.image), downloadUrl, pageUrl: text(hit.url, 'https://www.pexels.com/'),
    attribution: `Via Pexels ${photographer}`, license: 'Pexels License', placeholderOnly: false,
  }
}

function normalizeOpenverse(hit) {
  const creator = text(hit.creator, 'Unknown creator')
  const license = text(hit.license, 'license unverified')
  const pageUrl = text(hit.foreign_landing_url || hit.detail_url || hit.url)
  return {
    provider: 'openverse', id: text(hit.id || hit.identifier), kind: 'image', title: text(hit.title, 'Openverse image'), user: creator, photographer: creator,
    previewUrl: text(hit.thumbnail || hit.url), downloadUrl: text(hit.url), pageUrl,
    attribution: `Via Openverse — ${creator} — ${license}${hit.license_version ? ` ${hit.license_version}` : ''} — Source: ${pageUrl || 'source page unavailable'}`,
    license, licenseUrl: text(hit.license_url), placeholderOnly: false,
  }
}

function providerKey(provider, settings = {}, env = process.env) {
  if (provider === 'pixabay') return text(settings.pixabayApiKey || env.PIXABAY_API_KEY)
  if (provider === 'pexels') return text(settings.pexelsApiKey || env.PEXELS_API_KEY)
  return ''
}

function createLimiter(now = () => Date.now()) {
  const windows = new Map()
  const allow = (key, rule) => {
    const at = now()
    const entry = windows.get(key) || { hits: [], days: [] }
    entry.hits = entry.hits.filter((stamp) => at - stamp < rule.windowMs)
    if (rule.dayMs) entry.days = entry.days.filter((stamp) => at - stamp < rule.dayMs)
    const wait = entry.hits.length >= rule.count ? Math.max(1, rule.windowMs - (at - entry.hits[0])) : 0
    const dayWait = rule.dayCount && entry.days.length >= rule.dayCount ? Math.max(1, rule.dayMs - (at - entry.days[0])) : 0
    if (wait || dayWait) return { ok: false, waitMs: Math.max(wait, dayWait) }
    entry.hits.push(at); if (rule.dayMs) entry.days.push(at); windows.set(key, entry)
    return { ok: true, waitMs: 0 }
  }
  return { allow, windows }
}

function createStockService({ cacheDir, fetchImpl = globalThis.fetch, now = () => Date.now(), sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)), env = process.env } = {}) {
  const limiter = createLimiter(now)
  const cacheRoot = cacheDir || path.join(process.cwd(), '.stock-cache')
  const observedQuota = new Map()
  const readCache = async (key) => {
    try {
      const record = JSON.parse(await fsp.readFile(path.join(cacheRoot, `${key}.json`), 'utf8'))
      return record && now() - Number(record.at) < DAY ? record.value : null
    } catch { return null }
  }
  const writeCache = async (key, value) => {
    await fsp.mkdir(cacheRoot, { recursive: true })
    await fsp.writeFile(path.join(cacheRoot, `${key}.json`), JSON.stringify({ at: now(), value }), 'utf8')
  }
  const requestJson = async (url, init, key, provider = '') => {
    const cached = await readCache(key)
    if (cached) return cached
    if (typeof fetchImpl !== 'function') throw new Error('Stock search needs a network connection or a configured proxy.')
    let response
    let lastStatus = 0
    for (const waitMs of [0, 1000, 4000]) {
      if (waitMs) await sleep(waitMs)
      response = await fetchImpl(url, init)
      lastStatus = response.status
      if (response.status !== 429) break
    }
    if (!response || response.status === 429) throw new Error(`Stock provider is busy (HTTP ${lastStatus || 429}). Try again shortly.`)
    if (!response.ok) throw new Error(`Stock provider returned HTTP ${response.status}. Check the provider key or proxy.`)
    const data = await response.json()
    const getHeader = (name) => text(response.headers?.get?.(name))
    const limit = getHeader('x-ratelimit-limit') || getHeader('ratelimit-limit')
    const remaining = getHeader('x-ratelimit-remaining') || getHeader('ratelimit-remaining')
    const reset = getHeader('x-ratelimit-reset') || getHeader('ratelimit-reset')
    if (provider && (limit || remaining || reset)) observedQuota.set(provider, { limit: limit || null, remaining: remaining || null, reset: reset || null, observed: now() })
    await writeCache(key, data)
    return data
  }
  const search = async (provider, kind, options = {}, settings = {}) => {
    const normalized = normalizeOptions(options)
    if (provider === 'picsum') return { provider, kind: 'image', total: 1000, results: picsumItems(normalized), placeholderOnly: true }
    if (provider === 'openverse' && kind !== 'image') throw new Error('Openverse currently supplies images here; choose Openverse images or a stock video provider.')
    const key = providerKey(provider, settings, env)
    if ((provider === 'pixabay' || provider === 'pexels') && !key && !cleanProxy(settings.stockProxyUrl)) throw new Error(`${provider === 'pixabay' ? 'Pixabay' : 'Pexels'} needs a key or Stock Proxy URL. Open the Stock settings for setup options.`)
    const rule = provider === 'pixabay' ? PIXABAY_LIMIT : provider === 'pexels' ? PEXELS_LIMIT : OPENVERSE_LIMIT
    const limited = limiter.allow(`${provider}:${key || settings.stockProxyUrl || 'anonymous'}`, rule)
    if (!limited.ok) throw new Error(`Stock rate limit reached. Try again in ${Math.ceil(limited.waitMs / 1000)}s.`)
    let data
    const proxy = cleanProxy(settings.stockProxyUrl)
    const requestProvider = async (useProxy) => {
      const route = useProxy ? proxy : ''
      if (provider === 'pixabay') return requestJson(pixabayUrl(kind, normalized, key, route), {}, hash({ provider, kind, normalized, proxy: route }), provider)
      if (provider === 'pexels') return requestJson(pexelsUrl(kind, normalized, route), { headers: key && !route ? { Authorization: key } : {} }, hash({ provider, kind, normalized, proxy: route }), provider)
      return requestJson(openverseUrl(normalized), {}, hash({ provider, kind, normalized }), provider)
    }
    try {
      data = await requestProvider(Boolean(proxy))
    } catch (error) {
      // A paid proxy is preferred, not a single point of failure. If a
      // personal key exists, retry directly without ever sending it to the
      // proxy. Keyless providers keep their friendly original error.
      if (proxy && key) data = await requestProvider(false)
      else throw error
    }
    const raw = provider === 'pixabay' ? data.hits || [] : provider === 'pexels' ? (data.photos || data.videos || []) : (data.results || [])
    const results = raw.map((hit) => provider === 'pixabay' ? normalizePixabay(kind, hit) : provider === 'pexels' ? normalizePexels(kind, hit) : normalizeOpenverse(hit)).filter((item) => item.downloadUrl && item.previewUrl)
    return { provider, kind, total: Number(data.totalHits || data.total_results || data.total_results || data.total || results.length), results, placeholderOnly: false, quota: observedQuota.get(provider) || null }
  }
  const download = async (projectDir, item, settings = {}) => {
    if (!item || item.placeholderOnly && !item.downloadUrl) throw new Error('This stock item has no downloadable file.')
    const remote = new URL(text(item.downloadUrl))
    const proxyHost = cleanProxy(settings.stockProxyUrl) ? new URL(cleanProxy(settings.stockProxyUrl)).hostname.toLowerCase() : ''
    if (!ALLOWED_HOSTS.has(remote.hostname.toLowerCase()) && remote.hostname.toLowerCase() !== proxyHost) throw new Error('Stock download host is not allowlisted.')
    if (typeof fetchImpl !== 'function') throw new Error('Stock download needs a network connection.')
    const response = await fetchImpl(remote.href)
    if (!response.ok) throw new Error(`Stock download failed (HTTP ${response.status}).`)
    const type = text(response.headers?.get?.('content-type')).toLowerCase()
    const ext = item.kind === 'video' || type.includes('video') ? '.mp4' : type.includes('png') ? '.png' : '.jpg'
    const fileName = safeFileName(`${item.provider}-${item.id}${ext}`)
    const dir = path.join(projectDir, 'stock')
    await fsp.mkdir(dir, { recursive: true })
    const target = path.join(dir, fileName)
    const bytes = Buffer.from(await response.arrayBuffer())
    await fsp.writeFile(target, bytes)
    return { localPath: target, fileName, kind: item.kind, bytes: bytes.length, attribution: item.attribution, pageUrl: item.pageUrl, source: item.provider, sourceLicense: item.license || null }
  }
  return { search, download, providerKey, limiter, normalizeOptions, readCache, writeCache, observedQuota }
}

module.exports = {
  DAY, PIXABAY_LIMIT, PEXELS_LIMIT, OPENVERSE_LIMIT, ALLOWED_HOSTS,
  pixabayUrl, pexelsUrl, openverseUrl, picsumItems, normalizePixabay, normalizePexels, normalizeOpenverse,
  normalizeOptions, providerKey, createLimiter, createStockService, cleanProxy,
}
