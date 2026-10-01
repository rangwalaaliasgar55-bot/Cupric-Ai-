#!/usr/bin/env node
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { readFile } from 'node:fs/promises'
const require = createRequire(import.meta.url)
const stock = require('../electron/stock.cjs')

const response = (data, status = 200, headers = {}) => ({ status, ok: status >= 200 && status < 300, headers: { get: (key) => headers[key.toLowerCase()] || null }, json: async () => data, arrayBuffer: async () => Buffer.from('image-data') })
const dir = await mkdtemp(path.join(os.tmpdir(), 'newbrand-stock-'))
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
  assert.ok(main.includes("ipcMain.handle('stock:search'") && main.includes("ipcMain.handle('stock:download'") && main.includes("ipcMain.handle('stock:proxyHealth'") && main.includes('NEWBRAND_STOCK_PROXY_URL') && main.includes('quota:'), 'stock IPC, deployment proxy health and quota status stay in main')
  console.log('stock check passed — Pixabay/Pexels/Openverse/Picsum URLs, cache, attribution, retry, rate limits and key isolation')
} finally {
  await rm(dir, { recursive: true, force: true })
}
