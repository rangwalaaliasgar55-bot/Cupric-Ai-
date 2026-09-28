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

// Built-in keyless endpoint: exactly one, and never LLM7 (its Terms §3A forbid embedding).
assert.equal(brain.KEYLESS_ENDPOINTS.length, 1, 'one built-in keyless endpoint')
assert.ok(brain.KEYLESS_ENDPOINTS.every((e) => !/llm7/i.test(e.baseUrl)), 'LLM7 must not be built in')
assert.doesNotMatch(main, /llm7\.io/, 'main process never calls LLM7')
assert.deepEqual(brain.LOCAL_PROBE_ORDER.map((l) => new URL(l.baseUrl).port), ['4096', '11434', '1234', '8080'], 'local probe order')

// Fresh install: no keys, no local servers, online → first AI action answers via keyless.
{
  const fetchImpl = async (url, init) => {
    if (/localhost|127\.0\.0\.1/.test(url)) throw new Error('ECONNREFUSED')
    if (url.includes('pollinations')) { const b = JSON.parse(init.body); assert.equal(b.seed, brain.FIXED_SEED); assert.ok(b.temperature <= 0.3); assert.ok(!init.headers.authorization, 'no key sent'); return reply('Hook: open on the product.\n\n---\n\n**Sponsor**\nTry X https://pollinations.ai/redirect/42') }
    throw new Error('unexpected ' + url)
  }
  const locals = await brain.probeLocals({ fetchImpl })
  assert.equal(locals.length, 0)
  const routes = brain.planRoutes({ task: 'draft', locals, userRoutes: [] })
  assert.equal(routes[0].kind, 'keyless')
  const out = await brain.completeViaRoutes(routes, [{ role: 'user', content: 'plan' }], { fetchImpl, sleepImpl: noSleep })
  assert.ok(out.ok && out.kind === 'keyless', 'zero-setup first AI action answers via keyless')
  assert.equal(out.text, 'Hook: open on the product.', 'ad block stripped')
}
// Ad formats never reach the user.
assert.equal(brain.stripSponsored('Plan\n🌸 **Ad** 🌸 buy things\nNext'), 'Plan\nNext')
assert.equal(brain.stripSponsored('Plan\n\n***\nSupport Pollinations.AI: donate'), 'Plan')
assert.equal(brain.stripSponsored('Keep --- this dash text'), 'Keep --- this dash text')
// 429 → silent 1s→4s backoff with busy notice, then success on the same endpoint.
{
  const waits = []; const notices = []
  let hits = 0
  const fetchImpl = async () => { hits += 1; return hits < 3 ? json(429, { error: 'rate limit' }) : reply('ok after wait') }
  const out = await brain.completeViaRoutes(brain.planRoutes({ task: 'draft' }), [{ role: 'user', content: 'x' }], { fetchImpl, sleepImpl: async (ms) => { waits.push(ms) }, onNotice: (n) => notices.push(n) })
  assert.ok(waits.indexOf(1000) >= 0 && waits.indexOf(4000) > waits.indexOf(1000), 'backoff 1s → 4s')
  assert.ok(out.ok && out.text === 'ok after wait')
  assert.deepEqual(notices, [brain.BUSY_NOTICE]); assert.equal(out.notice, 'free brain busy, retrying')
}
// Concurrent callers queue (≈15 s apart) instead of bursting into the limit.
{
  let t = 0
  const cd = brain.createCooldowns(() => t)
  assert.deepEqual([cd.reserve('k', 15_500), cd.reserve('k', 15_500), cd.reserve('k', 15_500)], [0, 15_500, 31_000], 'slots are reserved in order')
}
// Keyless use withdrawn (403/410) → endpoint switches itself off, honest offline notice, no throw.
{
  const cooldowns = brain.createCooldowns()
  const out = await brain.completeViaRoutes(brain.planRoutes({ task: 'draft' }), [{ role: 'user', content: 'x' }], { fetchImpl: async () => json(403, { error: 'key required' }), sleepImpl: noSleep, cooldowns })
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
  assert.deepEqual(dead, ['llama3.2:3b']); assert.equal(out.text, 'keyless')
}
// JOB 2 aggregator: parallel, isolated failures, dedupe, badges, NEW, retire, TTL.
{
  const src = (id, kind, url) => ({ id, kind, url })
  const sources = [src('pollinations', 'keyless', 'k1'), src('openrouter', 'user', 'or'), src('broken', 'user', 'b'), src('ollama', 'local', 'o')]
  const v1 = { k1: [{ id: 'openai-fast' }, { id: 'openai-fast' }], or: [{ id: 'qwen/qwen3:free' }, { id: 'openai/gpt-5' }], o: [{ id: 'llama3.2:3b' }] }
  const fetchFor = (map) => async (url) => (url === 'b' ? json(500, {}) : json(200, { data: map[url] || [] }))
  const a1 = await brain.aggregateModels(sources, { fetchImpl: fetchFor(v1) })
  assert.deepEqual(a1.failedSources, ['broken'], 'an endpoint 500 is isolated')
  assert.equal(a1.models.length, 4, 'deduped')
  const badge = Object.fromEntries(a1.models.map((m) => [m.id, m.badge]))
  assert.deepEqual(badge, { 'llama3.2:3b': '$0 local', 'openai-fast': 'FREE', 'qwen/qwen3:free': 'FREE', 'openai/gpt-5': 'paid' })
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
/* ——— F-1: tokenharbor-class timeouts must cost ~nothing ————————————————
 * Production log: `[ai-route-failed] Request to https://tokenharbor.ai timed
 * out { route: 'OpenCode · deepseek-v4.1-flash:free' }` ten times in a day.
 * The contract now: per-attempt cap by route class, never a retry on the same
 * hung route, instant hop, 2 strikes in 5 min = 15 min quarantine.
 */
{
  // Per-attempt caps: local fails fastest, no class above 25 s, never below 2 s.
  assert.equal(brain.attemptTimeoutMs('free'), 20_000, 'remote free routes fail fast at 20s')
  assert.equal(brain.attemptTimeoutMs('local'), 8_000, 'a wedged localhost costs 8s, not 30s')
  assert.ok(Object.values(brain.ROUTE_ATTEMPT_MS).every((ms) => ms >= 2_000 && ms <= 25_000), 'no route class may hold the request for half a minute')
  assert.equal(brain.attemptTimeoutMs('free', 5_000), 5_000, 'the remaining deadline still wins')
  assert.equal(brain.attemptTimeoutMs('free', 10), 2_000, 'a floor keeps the last attempt meaningful')
  assert.ok(brain.isTimeoutError({ name: 'TimeoutError' }) && brain.isTimeoutError(new Error('Request to https://tokenharbor.ai timed out')), 'both shapes of timeout are recognised')
  assert.ok(!brain.isTimeoutError(new Error('429 rate limit')), 'a rate limit is not a timeout')

  // First route hangs until aborted, second answers instantly.
  const hang = (url, init) => new Promise((_, reject) => {
    const signal = init?.signal
    if (!signal) return
    signal.addEventListener('abort', () => reject(Object.assign(new Error('The operation was aborted'), { name: 'TimeoutError' })), { once: true })
  })
  const routes = [
    // attemptMs stands in for the shipped 20 s class cap so the check is instant.
    { kind: 'free', label: 'OpenCode · deepseek-v4.1-flash:free', baseUrl: 'https://tokenharbor.ai/v1', model: 'deepseek-v4.1-flash:free', attemptMs: 250 },
    { kind: 'local', label: 'Ollama · llama3.2:3b', baseUrl: 'http://localhost:11434/v1', model: 'llama3.2:3b' },
  ]
  const fetchImpl = async (url, init) => (url.includes('tokenharbor') ? hang(url, init) : reply('local answer'))
  const cooldowns = brain.createCooldowns()
  const health = brain.createHealthLedger()
  const started = Date.now()
  // AbortSignal.timeout uses an unref'd timer; hold the loop open for the test.
  const keepAlive = setInterval(() => {}, 25)
  const out = await brain.completeViaRoutes(routes, [{ role: 'user', content: 'x' }], { fetchImpl, cooldowns, health, sleepImpl: noSleep })
  clearInterval(keepAlive)
  const elapsed = Date.now() - started
  assert.ok(out.ok && out.text === 'local answer', 'the second route answers')
  assert.ok(elapsed < 1000, `total user-visible stall must stay under 1s, was ${elapsed}ms`)
  assert.equal(out.notice, 'free brain busy, used ollama instead', 'the user reads one friendly line, never a raw timeout')
  assert.equal(cooldowns.dump().find((c) => c.key.includes('tokenharbor'))?.reason, 'timeout', 'the hung route is cooled down')
  assert.equal(health.entries().find((e) => e.label.includes('deepseek'))?.failures, 1, 'strike one recorded')
  assert.equal(health.unhealthy('https://tokenharbor.ai/v1|deepseek-v4.1-flash:free'), false, 'one timeout is not a quarantine')
}
// Two failures in five minutes → 15 min quarantine → probe restores it.
{
  let t = 0
  const health = brain.createHealthLedger({ now: () => t })
  const key = 'https://tokenharbor.ai/v1|m'
  assert.equal(health.fail(key, { label: 'OpenCode · m', reason: 'timeout' }).unhealthy, false)
  t += 60_000
  const second = health.fail(key, { label: 'OpenCode · m', reason: 'timeout' })
  assert.ok(second.unhealthy && second.until === t + brain.HEALTH_QUARANTINE_MS, '2 strikes in 5 min = 15 min out')
  assert.equal(brain.HEALTH_WINDOW_MS, 5 * 60_000)
  assert.equal(brain.HEALTH_QUARANTINE_MS, 15 * 60_000)
  assert.deepEqual(health.entries().map((e) => [e.label, e.unhealthy, e.reason]), [['OpenCode · m', true, 'timeout']], 'Settings gets a red row, no key material')
  assert.deepEqual(health.probeQueue(), [], 'nothing is probed while it is quarantined')
  t += brain.HEALTH_QUARANTINE_MS
  assert.deepEqual(health.probeQueue(), [key], 'quarantine elapsed → probe it')
  assert.equal(health.ok(key).restored, true, 'a successful probe restores it (one quiet toast)')
  assert.equal(health.unhealthy(key), false)
  // Strikes older than the window do not accumulate into a quarantine.
  const slow = brain.createHealthLedger({ now: () => t })
  slow.fail(key); t += brain.HEALTH_WINDOW_MS + 1
  assert.equal(slow.fail(key).unhealthy, false, 'one failure every ten minutes is not an outage')
  // Quarantined routes are skipped entirely by the router.
  const skipped = await brain.completeViaRoutes(
    [{ kind: 'free', label: 'dead', baseUrl: 'https://tokenharbor.ai/v1', model: 'm' }],
    [{ role: 'user', content: 'x' }],
    { fetchImpl: async () => { throw new Error('must not be called') }, health: { unhealthy: () => true, ok() {}, fail: () => ({}) }, sleepImpl: noSleep },
  )
  assert.equal(skipped.ok, false, 'an unhealthy route is not even attempted')
}
// No raw provider text ever reaches a user.
{
  assert.equal(brain.friendlyAiMessage('Request to https://tokenharbor.ai timed out'), 'the free brain was too slow, so Cupric used its offline outline instead')
  assert.ok(!brain.friendlyAiMessage('Request to https://tokenharbor.ai timed out').includes('tokenharbor'), 'no raw host in user-facing copy')
  assert.match(brain.friendlyAiMessage('429 quota exceeded'), /rate-limited/)
  assert.match(brain.friendlyAiMessage('fetch failed: ECONNREFUSED'), /no model was reachable/)
  assert.equal(brain.switchedNotice('Ollama · llama3.2:3b'), 'free brain busy, used ollama instead')
}
// Main-process wiring for all of the above.
assert.match(main, /freeBrain\.attemptTimeoutMs\(routeClass/, 'completeWithFallback caps each attempt by route class')
assert.match(main, /if \(freeBrain\.isTimeoutError\(err\)\) throw err/, 'a timeout is never retried on the same route')
assert.match(main, /const routeHealth = freeBrain\.createHealthLedger\(\)/, 'main keeps an endpoint health ledger')
assert.match(main, /noteRouteFailure\(route,/, 'every route failure is recorded against health')
assert.match(main, /scheduleHealthProbes/, 'quarantined endpoints are auto-probed')
assert.match(main, /is answering again/, 'recovery says so once, quietly')
assert.match(main, /freeBrain\.switchedNotice\(route\.label\)/, 'a silent failover explains itself inline')
assert.match(main, /error\.friendly = freeBrain\.friendlyAiMessage/, 'the thrown error carries a user-safe sentence')
assert.match(main, /ipcMain\.handle\('ai:health'/, 'Settings can read endpoint health')
assert.doesNotMatch(main.slice(main.indexOf("ipcMain.handle('ai:health'"), main.indexOf("ipcMain.handle('ai:health'") + 400), /apiKey|authorization/i, 'health rows carry no key material')
assert.match(preload, /'ai:health'/, 'ai:health is allowlisted')
{
  const ask = await readFile(new URL('../src/app-shell/AskPanel.tsx', import.meta.url), 'utf8')
  assert.match(ask, /routeHealth\.map/, 'Settings renders a dot per endpoint')
  assert.match(ask, /route\.unhealthy \? 'bg-danger' : 'bg-accent'/, 'an unhealthy endpoint is red')
}
console.log('F-1 check passed — 20s fail-fast cap, instant hop, 5min/15min quarantine with auto-recovery, no raw timeouts in the UI')

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
