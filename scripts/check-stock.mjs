#!/usr/bin/env node
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { readFile } from 'node:fs/promises'
import { existsSync, statSync } from 'node:fs'
const require = createRequire(import.meta.url)
const stock = require('../electron/stock.cjs')

const response = (data, status = 200, headers = {}) => ({ status, ok: status >= 200 && status < 300, headers: { get: (key) => headers[key.toLowerCase()] || null }, json: async () => data, arrayBuffer: async () => Buffer.from('image-data') })
const dir = await mkdtemp(path.join(os.tmpdir(), 'cupric-stock-'))
try {
  let calls = []
  const settings = { pixabayApiKey: 'pixabay-test', pexelsApiKey: 'pexels-test' }
  const service = stock.createStockService({ cacheDir: dir, env: {}, sleep: async () => {}, fetchImpl: async (url, init) => {
    calls.push({ url: String(url), init })
    if (String(url).includes('pixabay.com')) return response({ totalHits: 1, hits: [{ id: 4, tags: 'neon city', user: 'Ava', previewURL: 'https://pixabay.com/preview.jpg', largeImageURL: 'https://pixabay.com/large.jpg', pageURL: 'https://pixabay.com/users/ava' }] })
    return response({ total_results: 1, results: [{ id: 'ov1', title: 'Lake', creator: 'Mira', url: 'https://images.openverse.org/lake.jpg', thumbnail: 'https://images.openverse.org/thumb.jpg', foreign_landing_url: 'https://example.org/lake', license: 'cc0', license_url: 'https://creativecommons.org/publicdomain/zero/1.0/' }] })
  } })
  const pix = await service.search('pixabay', 'image', { query: 'neon city', perPage: 200 }, settings)
  assert.ok(calls[0].url.includes('safesearch=true') && calls[0].url.includes('per_page=50'), 'Pixabay URL has safe search and bounded per-page')
  assert.ok(pix.results[0].attribution.includes('via Pixabay user Ava'), 'Pixabay attribution includes the user')
  const beforeCache = calls.length
  await service.search('pixabay', 'image', { query: 'neon city', perPage: 200 }, settings)
  assert.equal(calls.length, beforeCache, '24-hour cache avoids a second provider request')

  const pexelsService = stock.createStockService({ cacheDir: path.join(dir, 'pexels'), env: {}, sleep: async () => {}, fetchImpl: async (url, init) => { calls.push({ url: String(url), init }); return response({ total_results: 1, photos: [{ id: 7, photographer: 'Jo', url: 'https://pexels.com/photo/7', src: { medium: 'https://images.pexels.com/medium.jpg', large: 'https://images.pexels.com/large.jpg' } }] }, 200, { 'x-ratelimit-limit': '200', 'x-ratelimit-remaining': '199', 'x-ratelimit-reset': '3600' }) } })
  const pex = await pexelsService.search('pexels', 'image', { query: 'forest' }, settings)
  const pexCall = calls.at(-1)
  assert.ok(pexCall.url.startsWith('https://api.pexels.com/v1/search?') && pexCall.init.headers.Authorization === 'pexels-test', 'Pexels uses the main-process Authorization header')
  assert.equal(pex.results[0].attribution, 'Via Pexels Jo', 'Pexels attribution includes photographer')
  assert.equal(pex.quota.remaining, '199', 'provider response quota headers are surfaced safely')

  const proxyCalls = []
  const proxyService = stock.createStockService({ cacheDir: path.join(dir, 'proxy'), env: {}, sleep: async () => {}, fetchImpl: async (url) => {
    proxyCalls.push(String(url))
    if (String(url).includes('/pixabay?')) return response({}, 503)
    return response({ totalHits: 1, hits: [{ id: 9, tags: 'fallback', user: 'Key holder', previewURL: 'https://pixabay.com/preview.jpg', largeImageURL: 'https://pixabay.com/large.jpg', pageURL: 'https://pixabay.com/users/key-holder' }] })
  } })
  await proxyService.search('pixabay', 'image', { query: 'fallback' }, { pixabayApiKey: 'personal-key', stockProxyUrl: 'https://owner.example/stock' })
  assert.ok(proxyCalls.some((url) => url.startsWith('https://owner.example/stock/pixabay?')) && proxyCalls.some((url) => url.startsWith('https://pixabay.com/api/')), 'owner proxy is preferred and personal-key direct fallback stays available')

  const open = await service.search('openverse', 'image', { query: 'lake', perPage: 20 }, {})
  const openCall = calls.at(-1)
  assert.ok(openCall.url.includes('license=cc0%2Cby') && openCall.url.includes('page_size=20'), 'Openverse uses the license filter and max page size')
  assert.ok(open.results[0].attribution.includes('Mira') && open.results[0].attribution.includes('cc0') && open.results[0].attribution.includes('https://example.org/lake'), 'Openverse results require creator, licence and source URL credit')

  const picsum = await service.search('picsum', 'image', { query: 'draft', perPage: 3 }, {})
  assert.equal(picsum.results.length, 3)
  assert.ok(picsum.results.every((item) => item.placeholderOnly && /replace before publishing/i.test(item.attribution)), 'Picsum is visibly placeholder-only')

  let retry = 0
  const retryService = stock.createStockService({ cacheDir: path.join(dir, 'retry'), sleep: async () => {}, fetchImpl: async () => { retry += 1; return retry < 2 ? response({}, 429) : response({ results: [] }) } })
  await retryService.search('openverse', 'image', { query: 'retry' }, {})
  assert.equal(retry, 2, '429 retries once with the documented backoff sequence')

  let clock = 0
  const limiter = stock.createLimiter(() => clock)
  for (let i = 0; i < stock.OPENVERSE_LIMIT.count; i += 1) assert.equal(limiter.allow('openverse', stock.OPENVERSE_LIMIT).ok, true)
  assert.equal(limiter.allow('openverse', stock.OPENVERSE_LIMIT).ok, false, 'anonymous Openverse hourly bucket blocks excess requests')
  assert.ok(limiter.allow('openverse', stock.OPENVERSE_LIMIT).waitMs > 0)
  clock = 61 * 60 * 1000
  assert.equal(limiter.allow('openverse', stock.OPENVERSE_LIMIT).ok, true, 'Openverse bucket recovers after an hour')

  const rendererFiles = [
    await readFile(new URL('../src/components/StockBrowser.tsx', import.meta.url), 'utf8'),
    await readFile(new URL('../src/lib/resourceLinks.ts', import.meta.url), 'utf8'),
  ]
  const rendererText = rendererFiles.join('\n')
  assert.ok(!/PIXABAY_API_KEY|PEXELS_API_KEY|Authorization\s*:/i.test(rendererText), 'renderer never contains stock keys or auth headers')
  const main = await readFile(new URL('../electron/main.cjs', import.meta.url), 'utf8')
  assert.ok(main.includes("ipcMain.handle('stock:search'") && main.includes("ipcMain.handle('stock:download'") && main.includes("ipcMain.handle('stock:proxyHealth'") && main.includes('CUPRIC_STOCK_PROXY_URL') && main.includes('quota:'), 'stock IPC, deployment proxy health and quota status stay in main')
  console.log('stock check passed — Pixabay/Pexels/Openverse/Picsum URLs, cache, attribution, retry, rate limits and key isolation')

  /* ——— JOB 2: downloads that actually download ———————————————————————
   * Production log: `stock:download: Stock download host is not allowlisted`
   * for both "saas" and "video", then the dead-end toast "No footage could be
   * downloaded" — while Openverse and Picsum had never been asked. Both halves
   * are pinned here.
   */
  {
    // 1. The hosts providers really serve from are downloadable.
    for (const host of ['cdn.pixabay.com', 'videos.pexels.com', 'images.pexels.com', 'player.vimeo.com', 'vod-progressive.akamaized.net', 'picsum.photos']) {
      assert.ok(stock.ALLOWED_HOSTS.has(host), `${host} must be downloadable — providers serve files from it`)
    }

    const tmpProject = path.join(dir, 'job2-project')
    const bytesFor = (name) => Buffer.from(`fake-bytes-${name}`)
    /** A provider stub: search answers from `catalogue`, download works only for hosts in `serving`. */
    const makeService = ({ catalogue, serving, settings = {} }) => {
      const calls = []
      // The three provider *API* hosts answer searches; every other host is a
      // file download that only succeeds when `serving` lists it.
      const API = { 'pixabay.com': 'pixabay', 'api.pexels.com': 'pexels', 'api.openverse.org': 'openverse' }
      const fetchImpl = async (url) => {
        const target = new URL(String(url))
        calls.push(target.hostname + target.pathname)
        const provider = API[target.hostname]
        if (provider) {
          const body = catalogue[provider]
          if (!body) return { ok: false, status: 404, headers: { get: () => null }, json: async () => ({}) }
          return { ok: true, status: 200, headers: { get: () => null }, json: async () => body }
        }
        if (!serving.includes(target.hostname)) return { ok: false, status: 403, headers: { get: () => null }, json: async () => ({}) }
        return { ok: true, status: 200, headers: { get: (h) => (h === 'content-type' ? 'image/jpeg' : null) }, arrayBuffer: async () => bytesFor(target.hostname) }
      }
      return { service: stock.createStockService({ cacheDir: path.join(dir, `cache-${Math.random().toString(36).slice(2)}`), fetchImpl, env: {} }), calls, settings }
    }

    // 2. Provenance: a host Openverse itself returned is downloadable, even
    //    though no static list could ever name every federated CDN.
    {
      const { service, settings } = makeService({
        catalogue: { openverse: { results: [{ id: 'ov1', title: 'A wall', creator: 'Someone', license: 'cc0', url: 'https://live.staticflickr.com/1/a.jpg', thumbnail: 'https://api.openverse.org/t/1', foreign_landing_url: 'https://flickr.com/p/1' }] } },
        serving: ['live.staticflickr.com'],
      })
      const found = await service.search('openverse', 'image', { query: 'wall' }, settings)
      assert.equal(found.results.length, 1, 'Openverse returns its federated result')
      assert.ok(service.seenHosts.has('live.staticflickr.com'), 'a host the provider returned is remembered')
      const saved = await service.download(tmpProject, found.results[0], settings)
      assert.ok(saved.localPath.endsWith('.jpg'), 'a federated Openverse file downloads')
      assert.ok(existsSync(saved.localPath), 'the file is on disk')
      assert.ok(statSync(saved.localPath).size > 0, 'the file has bytes')
    }

    // 3. A host nobody offered us is still refused — with a sentence.
    {
      const { service, settings } = makeService({ catalogue: {}, serving: [] })
      await assert.rejects(
        () => service.download(tmpProject, { kind: 'image', downloadUrl: 'https://evil.example/x.jpg', provider: 'openverse', id: 'x' }, settings),
        (error) => {
          assert.ok(/evil\.example/.test(error.message), 'the refusal names the host')
          assert.ok(/search again|stock proxy/i.test(error.message), 'the refusal says what to do')
          assert.ok(!/not allowlisted/i.test(error.message), 'no bare jargon refusal')
          return true
        },
        'an unoffered host is refused',
      )
    }

    // 4. THE regression: the chosen provider's host refuses, so the chain
    //    must fall through to a keyless source instead of the dead-end toast.
    {
      const { service, settings } = makeService({
        catalogue: {
          pixabay: { hits: [{ id: 9, user: 'u', tags: 'city', videos: { medium: { url: 'https://blocked-cdn.pixabay.com/v/9.mp4' } }, previewURL: 'https://cdn.pixabay.com/p/9.jpg', pageURL: 'https://pixabay.com/v/9' }] },
          openverse: { results: [{ id: 'ov9', title: 'City', creator: 'C', license: 'cc0', url: 'https://ok-cdn.example/city.jpg', thumbnail: 'https://api.openverse.org/t/9', foreign_landing_url: 'https://example/9' }] },
        },
        serving: ['ok-cdn.example'],
        settings: { pixabayApiKey: 'test-key' },
      })
      const verdict = await service.fetchForTerm(tmpProject, { term: 'city', kind: 'video', provider: 'pixabay' }, settings)
      assert.equal(verdict.ok, true, 'a blocked first provider must not end the search')
      assert.equal(verdict.provider, 'openverse', 'the chain fell through to the keyless source')
      assert.ok(existsSync(verdict.saved.localPath) && statSync(verdict.saved.localPath).size > 0, 'the fallback file is real')
      const outcomes = verdict.tried.map((t) => `${t.provider}:${t.outcome}`)
      assert.ok(outcomes.some((o) => o.startsWith('pixabay:download-failed')), 'the blocked provider is recorded as tried')
      assert.ok(outcomes.includes('openverse:downloaded'), 'the source that worked is recorded')
    }

    // 5. Exhausted chain: an honest verdict, never a throw, and the log says
    //    which sources were asked and which were skipped and why.
    {
      const { service, settings } = makeService({ catalogue: { openverse: { results: [] } }, serving: [] })
      const verdict = await service.fetchForTerm(tmpProject, { term: 'nothing-at-all', kind: 'video', provider: 'pexels' }, settings)
      assert.equal(verdict.ok, false, 'an empty chain reports failure instead of throwing')
      assert.ok(/nothing-at-all/.test(verdict.reason), 'the reason names the term')
      assert.ok(verdict.tried.some((t) => t.outcome === 'skipped' && /no Pexels key/.test(t.detail)), 'a source that could not be asked says why')
      assert.ok(verdict.tried.some((t) => t.provider === 'openverse'), 'the keyless source was still asked')
    }

    // 6. The renderer must not re-implement any of this, and must not show a
    //    dead end while a source is untried.
    const quick = await readFile(new URL('../src/screens/production/QuickVideoPanel.tsx', import.meta.url), 'utf8')
    assert.ok(quick.includes("ipc.invoke('stock:fetchForTerm'"), 'the renderer asks the main process for the whole chain')
    assert.ok(!/No footage could be downloaded\./.test(quick), 'the dead-end toast is gone')
    assert.ok(/Not tried: /.test(quick), 'the failure names sources that were skipped')
    assert.ok(/Use project media/.test(quick), 'the failure points at the one source that always works')
    assert.ok(main.includes("ipcMain.handle('stock:fetchForTerm'"), 'the chain is handled in main')
    console.log('JOB 2 check passed — provider CDNs downloadable, provenance-based host trust, blocked host falls through to the next source, no dead end while a source is untried')
  }
} finally {
  await rm(dir, { recursive: true, force: true })
}
