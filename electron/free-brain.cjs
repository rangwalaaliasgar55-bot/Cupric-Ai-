/**
 * Zero-setup brain (JOB 1) + free-model aggregator (JOB 2).
 *
 * RULE ZERO: the user never configures anything. On a fresh install the first
 * AI action answers through, in order (first working wins):
 *   1. a local model server that happens to be running (no key, $0);
 *   2. a built-in KEYLESS free cloud endpoint (two, so one covers the other);
 *   3. models from keys the user *optionally* added (never required);
 *   4. the deterministic offline template (callers already have it).
 * The router then gives cheap "draft" work to local/keyless models and
 * "strong" work (execute/repair) to the best reachable model.
 *
 * Pure and dependency-free: `fetchImpl` and `now` are injectable, so the Node
 * checks exercise every path with mocked endpoints. Nothing here reads or
 * logs a key; user keys arrive as opaque route objects from main.cjs.
 */

/**
 * Built-in keyless endpoint (re-verified 2026-09-28 from primary sources).
 *
 * - Pollinations legacy text API: text.pollinations.ai/models lists
 *   `openai-fast` with tier "anonymous"; POST https://text.pollinations.ai/openai
 *   is OpenAI-compatible; anonymous ≈ one request per 15 s. It is the legacy
 *   path (new integrations are pointed at keyed gen.pollinations.ai) and
 *   anonymous replies may carry an ad block, so: requests are spaced/queued
 *   rather than failing, ad blocks are stripped, JSON is validated by callers,
 *   and a 401/402/403/410 switches the endpoint off for a day automatically
 *   (the brain then falls through to local → user keys → offline template).
 *
 * Deliberately NOT built in: LLM7.io. Its Terms (updated 9 Aug 2026, §3A)
 * forbid embedding the service in another product without written approval
 * and §2 excludes production use — shipping it would put every user in breach.
 */
const KEYLESS_ENDPOINTS = [
  { id: 'pollinations', label: 'Free built-in brain', baseUrl: 'https://text.pollinations.ai/openai', chatUrl: 'https://text.pollinations.ai/openai', modelsUrl: 'https://text.pollinations.ai/models', apiKey: '', draftModel: 'openai-fast', strongModel: 'openai-fast', minIntervalMs: 15_500 },
]

/** Local servers, probed in this exact order (OpenCode → Ollama → LM Studio → llama.cpp/other). */
const LOCAL_PROBE_ORDER = [
  { kind: 'opencode', label: 'OpenCode', baseUrl: 'http://localhost:4096/v1' },
  { kind: 'ollama', label: 'Ollama', baseUrl: 'http://localhost:11434/v1' },
  { kind: 'lmstudio', label: 'LM Studio', baseUrl: 'http://localhost:1234/v1' },
  { kind: 'local-8080', label: 'Local model', baseUrl: 'http://127.0.0.1:8080/v1' },
]

const PROBE_TIMEOUT_MS = 900
const BACKOFF_MS = [1000, 4000]
const FIXED_SEED = 7
const BUSY_NOTICE = 'free brain busy, retrying'
const OFFLINE_NOTICE = 'offline brain'

/* ——— F-1: fail fast, hop silently, quarantine what keeps timing out ———
 *
 * Production 0.13.0 logs showed a remote free route (tokenharbor.ai) eating
 * the whole 30 s per-attempt budget ten times in one day, which left the rest
 * of the 45 s deadline too small for any other provider to answer. So:
 *   • every route class has its own *small* per-attempt cap (below), and a
 *     timeout is never retried on the same route — it hops immediately;
 *   • two failures inside 5 minutes quarantine an endpoint for 15 minutes
 *     (red dot in Settings), and a cheap probe restores it automatically;
 *   • the user only ever sees "free brain busy, used <x> instead".
 */
const ROUTE_ATTEMPT_MS = {
  local: 8_000,      // localhost: if it has not answered in 8 s it is wedged
  keyless: 20_000,   // built-in free cloud
  free: 20_000,      // remote ":free" tiers — the class that hung in production
  user: 20_000,      // the user's own key; still fails fast, we have fallbacks
  gemini: 25_000,
  default: 20_000,
}
const HEALTH_WINDOW_MS = 5 * 60_000
const HEALTH_QUARANTINE_MS = 15 * 60_000
const HEALTH_FAIL_LIMIT = 2
const HEALTH_PROBE_MS = 3_000
/** Timeout is not quota: a short cooldown so a blip does not blacklist a good route. */
const TIMEOUT_COOLDOWN_MS = 60_000
const DEFAULT_COOLDOWN_MS = 20_000

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** Per-attempt deadline for a route class, never longer than what is left. */
function attemptTimeoutMs(routeClass, remainingMs = Infinity) {
  const cap = ROUTE_ATTEMPT_MS[routeClass] ?? ROUTE_ATTEMPT_MS.default
  return Math.max(2_000, Math.min(cap, Number.isFinite(remainingMs) ? remainingMs : cap))
}

/** True for aborts/timeouts however the runtime spelled them. */
function isTimeoutError(err) {
  const name = err?.name || ''
  if (name === 'TimeoutError' || name === 'AbortError') return true
  return /timed out|timeout|ETIMEDOUT|aborted|UND_ERR_(?:HEADERS|BODY)_TIMEOUT/i.test(err?.message || String(err || ''))
}

/**
 * Endpoint health ledger. Keys are route keys (`chatUrl|model`), never keys
 * or URLs with secrets in them. `now` is injectable so the checks run instantly.
 *
 *   fail(key, meta)  → { unhealthy, until }   two strikes in 5 min = 15 min out
 *   ok(key)          → { restored }           clears strikes, one quiet toast
 *   unhealthy(key)   → boolean                routing skips these
 *   dueForProbe(key) → boolean                quarantine elapsed → probe it
 *   entries()        → rows for the Settings dots (no secrets)
 */
function createHealthLedger({ now = () => Date.now(), windowMs = HEALTH_WINDOW_MS, quarantineMs = HEALTH_QUARANTINE_MS, limit = HEALTH_FAIL_LIMIT } = {}) {
  const rows = new Map()
  const row = (key) => {
    let r = rows.get(key)
    if (!r) { r = { key, label: key, failures: [], until: 0, reason: '', probing: false }; rows.set(key, r) }
    return r
  }
  return {
    fail(key, { label = '', reason = 'failed' } = {}) {
      const r = row(key)
      if (label) r.label = label
      r.reason = reason
      r.failures = [...r.failures, now()].filter((t) => now() - t < windowMs)
      if (r.failures.length >= limit) r.until = now() + quarantineMs
      return { unhealthy: r.until > now(), until: r.until, failures: r.failures.length }
    },
    ok(key, { label = '' } = {}) {
      const r = rows.get(key)
      if (!r) return { restored: false }
      // "Restored" means it had been quarantined at all — the probe that
      // clears it usually runs *after* the 15 minutes have elapsed.
      const wasOut = r.until > 0
      if (label) r.label = label
      r.failures = []
      r.until = 0
      r.reason = ''
      r.probing = false
      return { restored: wasOut, label: r.label }
    },
    unhealthy: (key) => { const r = rows.get(key); return Boolean(r && r.until > now()) },
    dueForProbe: (key) => { const r = rows.get(key); return Boolean(r && r.until && r.until <= now() && !r.probing) },
    /** Keys whose quarantine has elapsed — probe these, restore the ones that answer. */
    probeQueue: () => [...rows.values()].filter((r) => r.until && r.until <= now() && !r.probing).map((r) => r.key),
    markProbing: (key, value = true) => { const r = rows.get(key); if (r) r.probing = value },
    entries: () => [...rows.values()].map((r) => ({
      key: r.key,
      label: r.label,
      unhealthy: r.until > now(),
      until: r.until,
      reason: r.reason,
      failures: r.failures.length,
    })),
    clear: () => rows.clear(),
  }
}

/** The only sentence a user sees when a route timed out mid-task. */
function switchedNotice(usedLabel) {
  const short = String(usedLabel || '').split('·')[0].trim().toLowerCase() || 'another model'
  return `free brain busy, used ${short} instead`
}

/**
 * Raw provider errors ("Request to https://tokenharbor.ai timed out") must
 * never reach a user mid-task. Everything expected becomes one honest line.
 */
function friendlyAiMessage(raw) {
  const text = String(raw?.message || raw || '')
  if (!text) return OFFLINE_NOTICE
  if (isTimeoutError({ message: text })) return 'the free brain was too slow, so Cupric used its offline outline instead'
  if (/\b429\b|quota|rate.?limit|resource_exhausted/i.test(text)) return 'the free model is rate-limited right now, so Cupric used its offline outline instead'
  if (/fetch failed|ENOTFOUND|ECONNREFUSED|offline|DNS/i.test(text)) return 'no model was reachable, so Cupric used its offline outline instead'
  return 'no model could answer, so Cupric used its offline outline instead'
}
const isChatModel = (id) => id && !/embed|rerank|whisper|tts|audio|image|video|vision-only|moderation/i.test(id)

/** Probe local servers in order; returns every one that answers with a chat model. Silent. */
async function probeLocals({ fetchImpl = fetch, timeoutMs = PROBE_TIMEOUT_MS, order = LOCAL_PROBE_ORDER } = {}) {
  const settled = await Promise.allSettled(order.map(async (endpoint) => {
    const response = await fetchImpl(`${endpoint.baseUrl}/models`, { signal: AbortSignal.timeout(timeoutMs) })
    if (!response.ok) throw new Error(String(response.status))
    const data = await response.json()
    const models = (Array.isArray(data?.data) ? data.data : Array.isArray(data?.models) ? data.models : [])
      .map((m) => String(m?.id || m?.name || m?.model || '').trim())
      .filter(isChatModel)
    if (!models.length) throw new Error('no chat model')
    return { ...endpoint, models }
  }))
  // Keep the declared order (allSettled preserves it), drop failures.
  return settled.flatMap((s) => (s.status === 'fulfilled' ? [s.value] : []))
}

/** Rough quality score so "strong" work goes to the biggest model we can reach. */
function modelQuality(id) {
  const s = String(id || '').toLowerCase()
  let q = 0
  const b = /(\d+(?:\.\d+)?)\s*b\b/.exec(s)
  if (b) q += Math.min(60, Number(b[1]) / 4)
  if (/opus|gpt-5(?!-nano|-mini)|gemini-(2\.5|3)[\w.-]*-pro|claude-(sonnet|opus)|deepseek-(v[34]|r1)|qwen3-(235|480)|kimi-k2|glm-5|llama-?4-maverick|muse-spark/.test(s)) q += 50
  if (/sonnet|gemini-(2\.5|3)[\w.-]*flash(?!-lite)|gpt-4o(?!-mini)|mistral-large|llama-3\.3-70b|qwen3|gpt-oss-120b/.test(s)) q += 25
  if (/mini|nano|lite|small|fast|flash-lite|8b|7b|3b|1b|tiny/.test(s)) q -= 15
  if (s === 'default' || s === 'pro') q += 10
  return q
}

/**
 * Ordered routes for a task. Routes are plain objects:
 *   { kind: 'local'|'keyless'|'user', label, baseUrl, chatUrl?, model, apiKey?, quality }
 * draft  → local, keyless (fast), user (cheapest first)
 * strong → user (best first), local (biggest first), keyless (default)
 */
function planRoutes({ task = 'draft', locals = [], userRoutes = [], keyless = KEYLESS_ENDPOINTS, cooling = () => false } = {}) {
  const strong = task !== 'draft' && task !== 'classify'
  const localRoutes = locals.flatMap((l) => {
    const sorted = [...l.models].sort((a, b) => (strong ? modelQuality(b) - modelQuality(a) : modelQuality(a) - modelQuality(b)))
    const model = sorted[0]
    return model ? [{ kind: 'local', label: `${l.label} · ${model}`, baseUrl: l.baseUrl, model, apiKey: '', quality: modelQuality(model) }] : []
  })
  const keylessRoutes = keyless.map((k) => ({ kind: 'keyless', id: k.id, label: `${k.label} · ${strong ? k.strongModel : k.draftModel}`, baseUrl: k.baseUrl, chatUrl: k.chatUrl, model: strong ? k.strongModel : k.draftModel, apiKey: k.apiKey, minIntervalMs: k.minIntervalMs, quality: modelQuality(strong ? k.strongModel : k.draftModel) }))
  const users = [...userRoutes].map((r) => ({ ...r, kind: 'user', quality: r.quality ?? modelQuality(r.model) }))
    .sort((a, b) => (strong ? b.quality - a.quality : a.quality - b.quality))
  const ordered = strong ? [...users, ...localRoutes, ...keylessRoutes] : [...localRoutes, ...keylessRoutes, ...users]
  const seen = new Set()
  return ordered.filter((r) => {
    const key = `${r.chatUrl || r.baseUrl}|${r.model}`
    if (seen.has(key) || cooling(key)) return false
    seen.add(key)
    return true
  })
}

/**
 * Anonymous Pollinations replies may carry an ad/sponsor block. Remove any
 * trailing block introduced by a rule or a sponsor/ad/support heading, and any
 * single line that is clearly promotional (redirect links, 🌸 Ad markers).
 */
const AD_LINE = /pollinations\.ai\/(?:redirect|referral|ads?)\b|🌸\s*\**\s*(?:ad|sponsor)|^\s*\**\s*(?:ad|sponsored?|advertisement|support pollinations(?:\.ai)?)\s*\**\s*[:：]/i
function stripSponsored(text) {
  let out = String(text || '')
  out = out.replace(/\n+\s*(?:-{3,}|\*{3,}|_{3,})\s*\n[\s\S]*?(?:sponsor|advert|\bad\b|support pollinations|pollinations\.ai\/redirect|🌸)[\s\S]*$/i, '')
  out = out.split('\n').filter((line) => !AD_LINE.test(line)).join('\n')
  return out.trim()
}

/** 401/402/403/410 from a keyless endpoint = keyless use is no longer offered there. */
const keylessRevoked = (status) => status === 401 || status === 402 || status === 403 || status === 410

const retryable = (status, message) => status === 429 || status === 503 || status === 502 || /rate.?limit|too many|overload|temporar/i.test(message || '')
const isDeadModel = (status, message) => status === 404 || /model_not_found|model not found|no such model|does not exist|decommission|deprecated model/i.test(message || '')

/**
 * Per-route cooldowns + minimum spacing. `now` injectable for tests.
 * key → { until, reason }
 */
function createCooldowns(now = () => Date.now()) {
  const map = new Map()
  const last = new Map()
  return {
    cooling: (key) => { const c = map.get(key); return Boolean(c && c.until > now()) },
    set: (key, ms, reason) => map.set(key, { until: now() + ms, reason }),
    spacing: (key, minMs) => { const t = last.get(key) || 0; return Math.max(0, t + (minMs || 0) - now()) },
    touch: (key) => last.set(key, now()),
    /** Reserve the next send slot (queues concurrent callers instead of bursting). Returns ms to wait. */
    reserve: (key, minMs) => { const at = Math.max(now(), (last.has(key) ? last.get(key) : -Infinity) + (minMs || 0)); last.set(key, at); return at - now() },
    dump: () => [...map.entries()].map(([key, v]) => ({ key, ...v })),
  }
}

/** One OpenAI-compatible chat call. Low temperature, fixed seed. Throws Error with .status. */
async function chatOnce(route, messages, { json = false, temperature = 0.2, timeoutMs = 30_000, fetchImpl = fetch } = {}) {
  const url = route.chatUrl || `${String(route.baseUrl).replace(/\/+$/, '')}/chat/completions`
  const headers = { 'content-type': 'application/json' }
  if (route.apiKey) headers.authorization = `Bearer ${route.apiKey}`
  const body = { model: route.model, messages, temperature, seed: FIXED_SEED, stream: false, ...(json ? { response_format: { type: 'json_object' } } : {}) }
  let res = await fetchImpl(url, { method: 'POST', headers, body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs) })
  if (!res.ok && json && (res.status === 400 || res.status === 422)) {
    delete body.response_format
    res = await fetchImpl(url, { method: 'POST', headers, body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs) })
  }
  if (!res.ok) {
    const detail = (await res.text().catch(() => '')).slice(0, 300)
    const err = new Error(`${route.label} failed (${res.status}): ${detail}`)
    err.status = res.status
    throw err
  }
  const data = await res.json()
  const content = data?.choices?.[0]?.message?.content ?? data?.choices?.[0]?.text ?? ''
  const text = Array.isArray(content) ? content.map((p) => p?.text || '').join('') : String(content || '')
  const clean = route.kind === 'keyless' ? stripSponsored(text) : text
  if (!clean.trim()) { const err = new Error(`${route.label} returned an empty reply`); err.status = 0; throw err }
  return clean
}

/**
 * Try routes in order: retry 1 s → 4 s on 429/503 (same route), then hop.
 * Dead models (404/model_not_found) are reported via onRetired and skipped.
 * Never throws for expected states — returns { ok:false, notice:'offline brain' }
 * when nothing answered, so callers drop to the deterministic template.
 */
async function completeViaRoutes(routes, messages, opts = {}) {
  const { fetchImpl = fetch, cooldowns = createCooldowns(), health = null, onNotice = () => {}, onRetired = () => {}, onUnhealthy = () => {}, validate, deadlineMs = 45_000, now = () => Date.now(), sleepImpl = sleep } = opts
  const deadline = now() + deadlineMs
  const failures = []
  let noticed = false
  let hopped = false
  for (const route of routes) {
    const key = `${route.chatUrl || route.baseUrl}|${route.model}`
    if (cooldowns.cooling(key)) continue
    if (health?.unhealthy(key)) continue
    for (let attempt = 0; ; attempt += 1) {
      if (deadline - now() < 1500) break
      const wait = cooldowns.reserve(key, route.minIntervalMs)
      if (wait > deadline - now() - 1500) break
      if (wait) await sleepImpl(wait)
      try {
        // F-1: the per-attempt cap comes from the route class, not from one
        // global 30 s. A hung free endpoint costs 20 s at most, never the
        // whole request budget.
        const timeoutMs = Number(route.attemptMs) > 0
          ? Number(route.attemptMs)
          : attemptTimeoutMs(route.kind, Math.min(opts.timeoutMs ?? Infinity, deadline - now()))
        const text = await chatOnce(route, messages, { ...opts, fetchImpl, timeoutMs })
        if (validate) validate(text)
        health?.ok(key, { label: route.label })
        return {
          ok: true,
          text,
          route: route.label,
          kind: route.kind,
          model: route.model,
          // Hop first, explain quietly: one friendly line, never a raw timeout.
          notice: hopped ? switchedNotice(route.label) : noticed ? BUSY_NOTICE : '',
        }
      } catch (err) {
        const status = err?.status ?? 0
        failures.push(`${route.label}: ${err?.message || err}`)
        if (route.kind === 'keyless' && keylessRevoked(status)) { cooldowns.set(key, 24 * 3600_000, 'keyless-revoked'); break }
        if (isDeadModel(status, err?.message)) { onRetired({ baseUrl: route.baseUrl, model: route.model, label: route.label }); cooldowns.set(key, 24 * 3600_000, 'retired'); break }
        // A timeout is never retried on the same route — that is what burned
        // the deadline in production. Cool it down and hop immediately.
        if (isTimeoutError(err)) {
          hopped = true
          cooldowns.set(key, TIMEOUT_COOLDOWN_MS, 'timeout')
          const state = health?.fail(key, { label: route.label, reason: 'timeout' })
          if (state?.unhealthy) onUnhealthy({ key, label: route.label, until: state.until, reason: 'timeout' })
          break
        }
        if (retryable(status, err?.message)) {
          if (route.kind === 'keyless' && !noticed) { noticed = true; onNotice(BUSY_NOTICE) }
          const backoff = BACKOFF_MS[attempt]
          if (backoff !== undefined && deadline - now() > backoff + 2000) { await sleepImpl(backoff); continue }
          cooldowns.set(key, status === 429 ? 60_000 : 20_000, status === 429 ? 'rate-limit' : 'unavailable')
        } else {
          // Every other failure also cools down — a route that just answered
          // with 500/empty must not be re-tried ahead of a healthy one.
          cooldowns.set(key, DEFAULT_COOLDOWN_MS, 'failed')
        }
        hopped = true
        const state = health?.fail(key, { label: route.label, reason: status ? `http-${status}` : 'failed' })
        if (state?.unhealthy) onUnhealthy({ key, label: route.label, until: state.until, reason: state.reason || 'failed' })
        break
      }
    }
  }
  return { ok: false, text: '', notice: OFFLINE_NOTICE, failures }
}

/* ——— JOB 2: free-model aggregator ————————————————————————————————— */

const MODEL_CACHE_TTL_MS = 24 * 3600_000
const WEEK_MS = 7 * 24 * 3600_000
const MODEL_CAP = 300
const AGG_TIMEOUT_MS = 8000

/** Cost badge for one model row. */
function costBadge(m) {
  if (m.kind === 'local') return '$0 local'
  if (m.kind === 'keyless') return 'FREE'
  const id = String(m.id || '')
  if (/:free\b|-free\b|\bfree\b/i.test(id) || m.free === true || (m.pricing && Number(m.pricing.prompt) === 0 && Number(m.pricing.completion) === 0)) return 'FREE'
  if (m.source === 'gemini' || m.source === 'groq') return 'credits'
  return 'paid'
}

/**
 * Fetch every source in parallel (8 s each, isolated failures), dedupe,
 * cap at 300. A source is { id, kind, url, headers?, parse?(json) → [{id,...}] }.
 */
async function aggregateModels(sources, { fetchImpl = fetch, timeoutMs = AGG_TIMEOUT_MS, cap = MODEL_CAP } = {}) {
  const errors = []
  const settled = await Promise.allSettled(sources.map(async (src) => {
    const res = await fetchImpl(src.url, { headers: src.headers || {}, signal: AbortSignal.timeout(timeoutMs) })
    if (!res.ok) throw new Error(`${src.id} ${res.status}`)
    const data = await res.json()
    const raw = src.parse ? src.parse(data) : (Array.isArray(data?.data) ? data.data : Array.isArray(data?.models) ? data.models : Array.isArray(data) ? data : [])
    return raw.map((m) => ({ id: String(m?.id || m?.name || m?.model || '').replace(/^models\//, ''), pricing: m?.pricing, free: m?.free, source: src.id, kind: src.kind })).filter((m) => isChatModel(m.id))
  }))
  const seen = new Set()
  const models = []
  settled.forEach((s, i) => {
    if (s.status !== 'fulfilled') { errors.push({ source: sources[i].id, error: String(s.reason?.message || s.reason) }); return }
    for (const m of s.value) {
      const key = `${m.source}|${m.id}`
      if (seen.has(key)) continue
      seen.add(key)
      models.push({ ...m, badge: costBadge(m) })
    }
  })
  // Free first, then local, then the rest — the default view is right with zero interaction.
  const rank = (m) => (m.badge === '$0 local' ? 0 : m.badge === 'FREE' ? 1 : m.badge === 'credits' ? 2 : 3)
  models.sort((a, b) => rank(a) - rank(b) || modelQuality(b.id) - modelQuality(a.id))
  return { models: models.slice(0, cap), errors, failedSources: errors.map((e) => e.source) }
}

/**
 * Merge a fresh aggregate into the cached catalogue.
 * - unseen IDs → `isNew` (badge) and returned in `added` (one quiet toast);
 * - IDs gone from a source that *did* answer → `retired` (greyed, kept for display);
 * - a source that failed this time keeps its previous rows untouched;
 * - the saved selection is never changed here.
 */
function mergeCatalogue(prev, fresh, { now = Date.now() } = {}) {
  const prevModels = Array.isArray(prev?.models) ? prev.models : []
  const known = new Set(Array.isArray(prev?.knownIds) ? prev.knownIds : prevModels.map((m) => `${m.source}|${m.id}`))
  const failed = new Set(fresh.failedSources || [])
  const freshKeys = new Set(fresh.models.map((m) => `${m.source}|${m.id}`))
  const firstRun = !prevModels.length && !known.size
  const added = []
  const models = fresh.models.map((m) => {
    const key = `${m.source}|${m.id}`
    const isNew = !firstRun && !known.has(key)
    if (isNew) added.push(m)
    const old = prevModels.find((p) => `${p.source}|${p.id}` === key)
    return { ...m, isNew: isNew || Boolean(old?.isNew && !old?.seen), retired: false }
  })
  const retired = []
  for (const p of prevModels) {
    const key = `${p.source}|${p.id}`
    if (freshKeys.has(key)) continue
    if (failed.has(p.source)) { models.push(p); continue } // source down: keep as-is
    if (!p.retired) retired.push(p)
    models.push({ ...p, retired: true, isNew: false })
  }
  const knownIds = [...new Set([...known, ...freshKeys])]
  return { catalogue: { fetchedAt: now, models: models.slice(0, MODEL_CAP + 50), knownIds }, added, retired }
}

/** Mark a model dead (404/model_not_found) in the catalogue. */
function retireModel(catalogue, source, id) {
  const models = (catalogue?.models || []).map((m) => (m.id === id && (!source || m.source === source) ? { ...m, retired: true, isNew: false } : m))
  return { ...catalogue, models }
}

const isStale = (catalogue, now = Date.now(), ttl = MODEL_CACHE_TTL_MS) => !catalogue?.fetchedAt || now - catalogue.fetchedAt >= ttl

/** Best non-retired replacement for a dead selection (same source first, free first). */
function fallbackModel(catalogue, dead) {
  const live = (catalogue?.models || []).filter((m) => !m.retired && m.id !== dead?.id)
  return live.find((m) => m.source === dead?.source && m.badge === 'FREE') || live.find((m) => m.badge === 'FREE' || m.badge === '$0 local') || live[0] || null
}

module.exports = {
  KEYLESS_ENDPOINTS, LOCAL_PROBE_ORDER, BUSY_NOTICE, OFFLINE_NOTICE, FIXED_SEED, BACKOFF_MS,
  probeLocals, modelQuality, keylessRevoked, planRoutes, stripSponsored, createCooldowns, chatOnce, completeViaRoutes,
  MODEL_CACHE_TTL_MS, WEEK_MS, MODEL_CAP, costBadge, aggregateModels, mergeCatalogue, retireModel, isStale, fallbackModel,
  // F-1
  ROUTE_ATTEMPT_MS, HEALTH_WINDOW_MS, HEALTH_QUARANTINE_MS, HEALTH_FAIL_LIMIT, HEALTH_PROBE_MS, TIMEOUT_COOLDOWN_MS,
  attemptTimeoutMs, isTimeoutError, createHealthLedger, switchedNotice, friendlyAiMessage,
}
