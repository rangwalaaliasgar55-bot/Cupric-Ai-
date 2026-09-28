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
/**
 * JOB 2 — hosts a download may be *started* against.
 *
 * The 0.13.0 list had six entries and rejected almost every real file:
 * Pixabay serves its videos and most images from `cdn.pixabay.com`, Pexels
 * videos come off `player.vimeo.com` / `vod-progressive.akamaized.net`, and
 * Openverse is a federated index — its results live on Flickr, Wikimedia,
 * museum CDNs and hundreds of other hosts that cannot be enumerated here.
 * That is why the production log shows `Stock download host is not
 * allowlisted` for both "saas" and "video".
 *
 * So there are two ways in, and neither trusts the renderer:
 *   1. this static list, for the provider CDNs we know by name; and
 *   2. provenance — a host is downloadable if the provider's own search API
 *      returned it to us in this session (`rememberHosts` below). The renderer
 *      never widens the set; only a provider response does.
 */
const ALLOWED_HOSTS = new Set([
  // Pixabay
  'pixabay.com', 'cdn.pixabay.com', 'i.vimeocdn.com',
  // Pexels
  'pexels.com', 'www.pexels.com', 'images.pexels.com', 'videos.pexels.com',
  'player.vimeo.com', 'vod-progressive.akamaized.net', 'vod-progressive-secure.akamaized.net',
  // Openverse's own API/thumbnail hosts
  'api.openverse.org', 'api.openverse.engineering', 'images.openverse.org',
  // Placeholder service
  'picsum.photos', 'fastly.picsum.photos',
])

/** Hosts a provider response has actually handed us. Bounded, session-only. */
const MAX_REMEMBERED_HOSTS = 500

function hostOf(url) {
  try { return new URL(String(url)).hostname.toLowerCase() } catch { return '' }
}

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
  const seed = text(options.seed, o.query || 'cupric')
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
  /** Hosts a provider search actually returned in this session (JOB 2). */
  const seenHosts = new Set()
  const rememberHosts = (results) => {
    for (const item of results || []) {
      for (const url of [item?.downloadUrl, item?.previewUrl]) {
        const host = hostOf(url)
        if (!host) continue
        if (seenHosts.size >= MAX_REMEMBERED_HOSTS) seenHosts.clear()
        seenHosts.add(host)
      }
    }
  }
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
    // JOB 2: the provider just told us where its files live. Remember those
    // hosts so the download can start — this is the only thing that widens
    // the allowlist, and the renderer cannot reach it.
    rememberHosts(results)
    return { provider, kind, total: Number(data.totalHits || data.total_results || data.total_results || data.total || results.length), results, placeholderOnly: false, quota: observedQuota.get(provider) || null }
  }
  const download = async (projectDir, item, settings = {}) => {
    if (!item || item.placeholderOnly && !item.downloadUrl) throw new Error('This stock item has no downloadable file.')
    const remote = new URL(text(item.downloadUrl))
    const proxyHost = cleanProxy(settings.stockProxyUrl) ? new URL(cleanProxy(settings.stockProxyUrl)).hostname.toLowerCase() : ''
    const host = remote.hostname.toLowerCase()
    if (remote.protocol !== 'https:' && remote.protocol !== 'http:') throw new Error(`Cupric only downloads over http(s); “${remote.protocol}” is not a download.`)
    // JOB 2: known provider CDN, the host the provider's own search returned,
    // or the owner proxy. Anything else is a sentence, not a bare refusal.
    if (!ALLOWED_HOSTS.has(host) && !seenHosts.has(host) && host !== proxyHost) {
      throw new Error(`${host} did not come from a Cupric stock search, so the file was not downloaded — search again, or set a stock proxy in Settings → Stock.`)
    }
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
  /**
   * JOB 2 — one term, every source, in order, until something lands.
   *
   * The dead-end toast in the production screenshots ("No footage could be
   * downloaded…") appeared while Openverse and Picsum had never been asked:
   * the caller tried exactly one provider and gave up. So the chain lives
   * here, in the main process, and reports what it tried so the renderer can
   * say something true instead of guessing.
   *
   * Order: the provider the user chose, then their keyed providers, then the
   * keyless ones, then the placeholder service. A source that cannot work
   * (no key, wrong media kind) is recorded as skipped with its reason and
   * never counts as a failure.
   */
  const chainFor = (preferred, kind, settings, env2 = env) => {
    const keyed = (provider) => Boolean(providerKey(provider, settings, env2)) || Boolean(cleanProxy(settings.stockProxyUrl))
    const all = [
      { provider: 'pixabay', kinds: ['image', 'video'], usable: keyed('pixabay'), why: 'no Pixabay key or proxy' },
      { provider: 'pexels', kinds: ['image', 'video'], usable: keyed('pexels'), why: 'no Pexels key or proxy' },
      { provider: 'openverse', kinds: ['image'], usable: true, why: '' },
      { provider: 'picsum', kinds: ['image'], usable: true, why: '' },
    ]
    // Rank: the chosen provider first, then anything that can answer in the
    // requested media kind, then the still-image fallbacks. A source is only
    // *skipped* when it genuinely cannot work (no key); a kind mismatch is a
    // demotion, not a refusal — a still beats an empty beat.
    const rank = (entry) => (entry.provider === preferred ? 0 : entry.kinds.includes(kind) ? 1 : 2)
    return [...all]
      .sort((a, b) => rank(a) - rank(b))
      .map((entry) => ({
        ...entry,
        askKind: entry.kinds.includes(kind) ? kind : 'image',
        skip: entry.usable ? '' : entry.why,
      }))
  }

  /**
   * Search + download one term through the chain.
   * Never throws for an exhausted chain — it returns `ok: false` with the
   * full attempt log, because "nothing found" is an answer, not a crash.
   */
  const fetchForTerm = async (projectDir, options = {}, settings = {}) => {
    const term = text(options.term || options.query)
    const kind = options.kind === 'video' ? 'video' : 'image'
    const orientation = ['all', 'horizontal', 'vertical'].includes(options.orientation) ? options.orientation : 'all'
    const perPage = clampPerPage(options.perPage, 10)
    if (!term) return { ok: false, term, tried: [], saved: null, reason: 'No search term was given.' }
    const tried = []
    for (const step of chainFor(text(options.provider, 'openverse'), kind, settings)) {
      if (step.skip) { tried.push({ provider: step.provider, outcome: 'skipped', detail: step.skip }); continue }
      // Openverse and Picsum only answer for images: a video term falls back
      // to a still rather than failing the whole beat.
      const askKind = step.askKind
      let results = []
      try {
        const found = await search(step.provider, askKind, { query: term, orientation, perPage }, settings)
        results = found.results || []
        if (!results.length) { tried.push({ provider: step.provider, outcome: 'empty', detail: `no results for “${term}”` }); continue }
      } catch (error) {
        tried.push({ provider: step.provider, outcome: 'search-failed', detail: error?.message || String(error) })
        continue
      }
      // More than one candidate, because the first hit is sometimes the one
      // host that refuses us.
      let lastError = ''
      for (const item of results.slice(0, 3)) {
        try {
          const saved = await download(projectDir, item, settings)
          tried.push({ provider: step.provider, outcome: 'downloaded', detail: saved.fileName })
          return { ok: true, term, kind: saved.kind, saved, tried, provider: step.provider }
        } catch (error) { lastError = error?.message || String(error) }
      }
      tried.push({ provider: step.provider, outcome: 'download-failed', detail: lastError })
    }
    const asked = tried.filter((t) => t.outcome !== 'skipped').map((t) => t.provider)
    const skipped = tried.filter((t) => t.outcome === 'skipped')
    const reason = asked.length
      ? `Nothing downloadable for “${term}” from ${[...new Set(asked)].join(', ')}.${skipped.length ? ` Not tried: ${skipped.map((t) => `${t.provider} (${t.detail})`).join(', ')}.` : ''}`
      : `No stock source was available for “${term}” — ${skipped.map((t) => `${t.provider}: ${t.detail}`).join('; ')}.`
    return { ok: false, term, saved: null, tried, reason }
  }

  return { search, download, fetchForTerm, chainFor, providerKey, limiter, normalizeOptions, readCache, writeCache, observedQuota, seenHosts }
}

module.exports = {
  DAY, PIXABAY_LIMIT, PEXELS_LIMIT, OPENVERSE_LIMIT, ALLOWED_HOSTS,
  pixabayUrl, pexelsUrl, openverseUrl, picsumItems, normalizePixabay, normalizePexels, normalizeOpenverse,
  normalizeOptions, providerKey, createLimiter, createStockService, cleanProxy,
}
