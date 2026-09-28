#!/usr/bin/env node
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const [main, preload, panel, browserClient] = await Promise.all([
  readFile(new URL('../electron/main.cjs', import.meta.url), 'utf8'),
  readFile(new URL('../electron/preload.cjs', import.meta.url), 'utf8'),
  readFile(new URL('../src/app-shell/AskPanel.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/lib/gemini.ts', import.meta.url), 'utf8'),
])
assert.match(main, /ipcMain\.handle\('ai:testConnection'/, 'desktop must expose provider connection tests')
assert.match(main, /provider === 'opencode'[\s\S]*?listOpenCodeModels/, 'OpenCode test must hit its model endpoint')
assert.match(main, /maxOutputTokens: 1/, 'Gemini test must use a minimal completion')
assert.match(preload, /'ai:testConnection'/, 'connection test IPC must be allowlisted')
assert.match(panel, /testConnection\('gemini'\)/, 'Settings must expose Gemini test action')
assert.match(panel, /testConnection\('opencode'\)/, 'Settings must expose OpenCode test action')
assert.match(panel, /providerStatus\[aiProvider\]/, 'active provider status must be visible before editing')
assert.match(main, /interactive-rundown-fallback/, 'interactive rundown failures must be instrumented')
assert.match(main, /source: 'local'[\s\S]*?fallbackReason/, 'interactive rundown must return an honest deterministic fallback')
assert.match(browserClient, /live\.source === 'local'/, 'renderer must preserve the main process fallback label')

console.log('AI connection check passed — provider tests, visible status and interactive deterministic fallback are wired')

/* ——— JOB 1/2: zero-setup brain + free-model aggregator (mocked, no network) ——— */
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const brain = require('../electron/free-brain.cjs')
const json = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body, text: async () => JSON.stringify(body) })
const reply = (text) => json(200, { choices: [{ message: { content: text } }] })
const noSleep = async () => {}

// Keyless endpoints are real, keyless and OpenAI-compatible.
assert.equal(brain.KEYLESS_ENDPOINTS.length, 2, 'exactly two built-in keyless endpoints')
assert.deepEqual(brain.LOCAL_PROBE_ORDER.map((l) => new URL(l.baseUrl).port), ['4096', '11434', '1234', '8080'], 'local probe order')

// Fresh install: no keys, no local servers, online → first AI action answers via keyless.
{
  const calls = []
  const fetchImpl = async (url, init) => {
    calls.push(url)
    if (/localhost|127\.0\.0\.1/.test(url)) throw new Error('ECONNREFUSED')
    if (url.includes('llm7')) { const b = JSON.parse(init.body); assert.equal(b.seed, brain.FIXED_SEED); assert.ok(b.temperature <= 0.3); return reply('Hook: open on the product.') }
    throw new Error('unexpected ' + url)
  }
  const locals = await brain.probeLocals({ fetchImpl })
  assert.equal(locals.length, 0)
  const routes = brain.planRoutes({ task: 'draft', locals, userRoutes: [] })
  assert.equal(routes[0].kind, 'keyless')
  const out = await brain.completeViaRoutes(routes, [{ role: 'user', content: 'plan' }], { fetchImpl, sleepImpl: noSleep })
  assert.ok(out.ok && out.kind === 'keyless' && out.text.startsWith('Hook'), 'zero-setup first AI action answers via keyless')
  assert.equal(out.notice, '')
}
// 429 on LLM7 → silent 1s→4s backoff, busy notice, hop to Pollinations.
{
  const waits = []; const notices = []
  let hits = 0
  const fetchImpl = async (url) => { if (url.includes('llm7')) { hits += 1; return json(429, { error: 'rate limit' }) } return reply('ok from backup\n\n---\n**Sponsor** buy things') }
  const out = await brain.completeViaRoutes(brain.planRoutes({ task: 'draft' }), [{ role: 'user', content: 'x' }], { fetchImpl, sleepImpl: async (ms) => { waits.push(ms) }, onNotice: (n) => notices.push(n) })
  assert.equal(hits, 3, 'one try + two backoff retries on the same route')
  assert.ok(waits.indexOf(1000) >= 0 && waits.indexOf(4000) > waits.indexOf(1000), 'backoff 1s → 4s')
  assert.ok(out.ok && out.text === 'ok from backup', 'hopped to the other keyless endpoint, sponsor block stripped')
  assert.deepEqual(notices, [brain.BUSY_NOTICE])
  assert.equal(out.notice, 'free brain busy, retrying')
}
// Wifi off → no route answers → honest "offline brain", no throw.
{
  const out = await brain.completeViaRoutes(brain.planRoutes({ task: 'draft' }), [{ role: 'user', content: 'x' }], { fetchImpl: async () => { throw new Error('ENOTFOUND') }, sleepImpl: noSleep })
  assert.equal(out.ok, false); assert.equal(out.notice, 'offline brain')
}
// Ollama appears later → preferred for draft; strong prefers the best user key.
{
  const fetchImpl = async (url) => (url.includes(':11434') ? json(200, { data: [{ id: 'llama3.2:3b' }, { id: 'nomic-embed-text' }] }) : Promise.reject(new Error('down')))
  const locals = await brain.probeLocals({ fetchImpl })
  assert.equal(locals[0].kind, 'ollama'); assert.deepEqual(locals[0].models, ['llama3.2:3b'])
  assert.equal(brain.planRoutes({ task: 'draft', locals })[0].kind, 'local')
  const user = [{ label: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1', model: 'deepseek/deepseek-v3:free' }]
  assert.equal(brain.planRoutes({ task: 'repair', locals, userRoutes: user })[0].kind, 'user', 'strong work goes to the best reachable model')
  const dead = []
  const out = await brain.completeViaRoutes(brain.planRoutes({ task: 'draft', locals }), [{ role: 'user', content: 'x' }], { fetchImpl: async (url) => (url.includes(':11434') ? json(404, { error: { code: 'model_not_found' } }) : reply('keyless')), sleepImpl: noSleep, onRetired: (m) => dead.push(m.model) })
  assert.deepEqual(dead, ['llama3.2:3b']); assert.equal(out.text, 'keyless')
}
// JOB 2 aggregator: parallel, isolated failures, dedupe, badges, NEW, retire, TTL.
{
  const src = (id, kind, url) => ({ id, kind, url })
  const sources = [src('llm7', 'keyless', 'k1'), src('openrouter', 'user', 'or'), src('broken', 'user', 'b'), src('ollama', 'local', 'o')]
  const v1 = { k1: [{ id: 'default' }, { id: 'default' }], or: [{ id: 'qwen/qwen3:free' }, { id: 'openai/gpt-5' }], o: [{ id: 'llama3.2:3b' }] }
  const fetchFor = (map) => async (url) => (url === 'b' ? json(500, {}) : json(200, { data: map[url] || [] }))
  const a1 = await brain.aggregateModels(sources, { fetchImpl: fetchFor(v1) })
  assert.deepEqual(a1.failedSources, ['broken'], 'an endpoint 500 is isolated')
  assert.equal(a1.models.length, 4, 'deduped')
  const badge = Object.fromEntries(a1.models.map((m) => [m.id, m.badge]))
  assert.deepEqual(badge, { 'llama3.2:3b': '$0 local', default: 'FREE', 'qwen/qwen3:free': 'FREE', 'openai/gpt-5': 'paid' })
  const first = brain.mergeCatalogue(null, a1, { now: 1000 })
  assert.equal(first.added.length, 0, 'first run is not a flood of NEW badges')
  const v2 = { ...v1, or: [{ id: 'openai/gpt-5' }, { id: 'meta/muse-spark-2.0' }, { id: 'mistral/new-model:free' }] }
  const second = brain.mergeCatalogue(first.catalogue, await brain.aggregateModels(sources, { fetchImpl: fetchFor(v2) }), { now: 2000 })
  assert.deepEqual(second.added.map((m) => m.id).sort(), ['meta/muse-spark-2.0', 'mistral/new-model:free'], 'new IDs flagged NEW')
  assert.deepEqual(second.retired.map((m) => m.id), ['qwen/qwen3:free'], 'vanished ID retired')
  assert.ok(second.catalogue.models.find((m) => m.id === 'qwen/qwen3:free').retired)
  assert.equal(brain.fallbackModel(second.catalogue, { id: 'qwen/qwen3:free', source: 'openrouter' }).id, 'mistral/new-model:free', 'retired → free fallback')
  const down = await brain.aggregateModels(sources, { fetchImpl: async (url) => (url === 'or' ? json(500, {}) : json(200, { data: v2[url] || [] })) })
  const third = brain.mergeCatalogue(second.catalogue, down, { now: 3000 })
  assert.equal(third.retired.length, 0, 'a failing source never retires its models')
  assert.equal(brain.isStale({ fetchedAt: 1 }, brain.MODEL_CACHE_TTL_MS), false)
  assert.equal(brain.isStale({ fetchedAt: 1 }, brain.MODEL_CACHE_TTL_MS + 1), true, '24h TTL')
  assert.ok(brain.aggregateModels.length >= 1 && brain.MODEL_CAP === 300)
}
// Wiring: RULE ZERO + key hygiene.
assert.match(main, /value === 'openrouter' \|\| value === 'zen'\) && !String/, 'keyless openrouter/zen mode falls back to auto')
assert.match(main, /const shouldPolish = configuredAiMode\(\) !== 'template'/, 'fresh installs polish via the free brain')
assert.match(main, /kind: 'keyless', provider: 'keyless'/, 'autoDiscover picks the keyless brain before the template')
assert.doesNotMatch(main, /setupRequired: true/, 'discovery never requires setup')
assert.match(main, /route\.provider === 'keyless'/, 'completeWithFallback runs keyless routes')
assert.match(main, /brainCooldowns\.set\(routeKey\(route\)/, 'per-route cooldown for every route')
assert.match(main, /local brain found, switched/)
assert.match(main, /ipcMain\.handle\('ai:freeModels'[\s\S]{0,400}badge: m\.badge, isNew/, 'renderer gets presence-only model rows')
assert.doesNotMatch(main.slice(main.indexOf("ipcMain.handle('ai:freeModels'"), main.indexOf("ipcMain.handle('ai:ackNewModels'")), /apiKey|headers/, 'no key material to renderer')
assert.match(preload, /'ai:notice'/); assert.match(preload, /'ai:freeModels'/)
console.log('Zero-setup brain check passed — keyless first action, 429 backoff+hop, offline notice, local preference, aggregator NEW/retire/TTL/isolation')
