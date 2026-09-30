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

// Phase 0 §A4: no third-party keyless brain ships. LLM7 was never embedded (its
// Terms §3A forbid it) and Pollinations was removed, so a fresh install with no
// key and no local model is told exactly that instead of quietly using a
// service that injects ads into replies and can withdraw access at will.
const codeOnly = (text) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '$1')
const freeBrainSource = await readFile(new URL('../electron/free-brain.cjs', import.meta.url), 'utf8')
assert.equal(brain.KEYLESS_ENDPOINTS.length, 0, 'no built-in third-party keyless endpoint')
for (const [name, text] of [['main.cjs', main], ['free-brain.cjs', freeBrainSource]]) {
  assert.doesNotMatch(codeOnly(text), /pollinations|llm7/i, `${name} must not call a third-party free-AI service`)
}
assert.ok(!('stripSponsored' in brain), 'the reply-rewriting helper is gone, not merely unused')
assert.deepEqual(brain.LOCAL_PROBE_ORDER.map((l) => new URL(l.baseUrl).port), ['4096', '11434', '1234', '8080'], 'local probe order')

// Fresh install: no keys, no local servers → no live route, and an honest result.
{
  const fetchImpl = async (url) => { throw new Error('unexpected request to ' + url) }
  const locals = await brain.probeLocals({ fetchImpl })
  assert.equal(locals.length, 0)
  const routes = brain.planRoutes({ task: 'draft', locals, userRoutes: [] })
  assert.equal(routes.length, 0, 'nothing is routed when nothing is configured')
  const out = await brain.completeViaRoutes(routes, [{ role: 'user', content: 'plan' }], { fetchImpl, sleepImpl: noSleep })
  assert.equal(out.ok, false)
  assert.equal(out.notice, 'offline brain', 'the caller is told plainly')
}
// A provider's reply is returned exactly as received — no ad-stripping, no rewriting.
{
  const verbatim = 'Hook: open on the product.\n🌸 **Ad** — support example.com/redirect\nNext line'
  const out = await brain.completeViaRoutes(
    brain.planRoutes({ task: 'draft', userRoutes: [{ label: 'Test', baseUrl: 'https://api.example.com/v1', model: 'm', apiKey: 'k' }] }),
    [{ role: 'user', content: 'plan' }],
    { fetchImpl: async () => reply(verbatim), sleepImpl: noSleep },
  )
  assert.ok(out.ok)
  assert.equal(out.text, verbatim, 'provider text is never rewritten (Phase 0 §A4)')
}
// 429 → silent 1s→4s backoff with busy notice, then success on the same endpoint.
{
  const waits = []; const notices = []
  let hits = 0
  const fetchImpl = async () => { hits += 1; return hits < 3 ? json(429, { error: 'rate limit' }) : reply('ok after wait') }
  const routes = brain.planRoutes({ task: 'draft', userRoutes: [{ label: 'Retrying provider', baseUrl: 'https://api.example.com/v1', model: 'm', apiKey: 'k' }] })
  const out = await brain.completeViaRoutes(routes, [{ role: 'user', content: 'x' }], { fetchImpl, sleepImpl: async (ms) => { waits.push(ms) }, onNotice: (n) => notices.push(n) })
  assert.ok(waits.indexOf(1000) >= 0 && waits.indexOf(4000) > waits.indexOf(1000), 'backoff 1s → 4s')
  assert.ok(out.ok && out.text === 'ok after wait')
  assert.equal(notices.length, 0, 'a configured provider is retried silently; the busy notice belonged to the removed free service')
}
// Concurrent callers queue (≈15 s apart) instead of bursting into the limit.
{
  let t = 0
  const cd = brain.createCooldowns(() => t)
  assert.deepEqual([cd.reserve('k', 15_500), cd.reserve('k', 15_500), cd.reserve('k', 15_500)], [0, 15_500, 31_000], 'slots are reserved in order')
}
// A keyless endpoint a caller configured explicitly and that withdraws access
// (403/410) switches itself off; the predicate that decides this is still real.
{
  const cooldowns = brain.createCooldowns()
  const explicit = [{ kind: 'keyless', label: 'Explicit keyless', baseUrl: 'https://free.example/v1', chatUrl: 'https://free.example/v1', model: 'm', apiKey: '', minIntervalMs: 0 }]
  const out = await brain.completeViaRoutes(explicit, [{ role: 'user', content: 'x' }], { fetchImpl: async () => json(403, { error: 'key required' }), sleepImpl: noSleep, cooldowns })
  assert.equal(out.ok, false); assert.equal(out.notice, 'offline brain')
  assert.equal(cooldowns.dump()[0].reason, 'keyless-revoked')
  assert.ok(brain.keylessRevoked(410) && !brain.keylessRevoked(429))
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
  assert.deepEqual(dead, ['llama3.2:3b']); assert.equal(out.ok, false, 'a dead local model with no other route reports failure honestly')
}
// JOB 2 aggregator: parallel, isolated failures, dedupe, badges, NEW, retire, TTL.
{
  const src = (id, kind, url) => ({ id, kind, url })
  const sources = [src('groq', 'user', 'k1'), src('openrouter', 'user', 'or'), src('broken', 'user', 'b'), src('ollama', 'local', 'o')]
  const v1 = { k1: [{ id: 'llama-3.3-70b-versatile' }, { id: 'llama-3.3-70b-versatile' }], or: [{ id: 'qwen/qwen3:free' }, { id: 'openai/gpt-5' }], o: [{ id: 'llama3.2:3b' }] }
  const fetchFor = (map) => async (url) => (url === 'b' ? json(500, {}) : json(200, { data: map[url] || [] }))
  const a1 = await brain.aggregateModels(sources, { fetchImpl: fetchFor(v1) })
  assert.deepEqual(a1.failedSources, ['broken'], 'an endpoint 500 is isolated')
  assert.equal(a1.models.length, 4, 'deduped')
  const badge = Object.fromEntries(a1.models.map((m) => [m.id, m.badge]))
  assert.deepEqual(badge, { 'llama3.2:3b': '$0 local', 'llama-3.3-70b-versatile': 'credits', 'qwen/qwen3:free': 'FREE', 'openai/gpt-5': 'paid' })
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
// Wiring: provider layer (Phase 1.1) + key hygiene.
assert.match(main, /require\('\.\/ai-providers\.cjs'\)/, 'main runs the provider layer')
assert.match(main, /require\('\.\/ai-provider-config\.cjs'\)/, 'main maps settings to a provider config')
assert.match(main, /const shouldPolish = configuredAiMode\(\) !== 'template' && aiSettings\(\)\.provider !== 'none'/, 'nothing is queued when no provider can answer')
assert.match(main, /provider: 'none'/, "autoDiscover reports 'none' instead of borrowing a service")
assert.match(main, /route\.provider === 'provider'[\s\S]{0,400}aiProviders\.generate\(route\.config/, 'the configured provider is called through the provider layer')
assert.match(main, /ipcMain\.handle\('ai:testProvider'/, 'provider connection tests are real IPC')
assert.match(main, /ipcMain\.handle\('ai:listModels'/, 'model lists come from the provider endpoint')
assert.match(main, /brainCooldowns\.set\(routeKey\(route\)/, 'per-route cooldown for every route')
assert.match(main, /local brain found, switched/)
assert.match(main, /ipcMain\.handle\('ai:freeModels'[\s\S]{0,400}badge: m\.badge, isNew/, 'renderer gets presence-only model rows')
assert.doesNotMatch(main.slice(main.indexOf("ipcMain.handle('ai:freeModels'"), main.indexOf("ipcMain.handle('ai:ackNewModels'")), /apiKey|headers/, 'no key material to renderer')
assert.match(preload, /'ai:notice'/); assert.match(preload, /'ai:freeModels'/)
console.log('Zero-setup brain check passed — no third-party fallback, verbatim provider text, 429 backoff+hop, honest offline notice, local preference, aggregator NEW/retire/TTL/isolation')
