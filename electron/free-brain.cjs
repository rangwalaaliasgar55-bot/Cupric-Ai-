/**
 * Zero-setup brain (JOB 1) + free-model aggregator (JOB 2).
 *
 * The brain answers through, in order (first working wins):
 *   1. a local model server that happens to be running (no key, $0);
 *   2. models from keys the user configured (OpenAI, Anthropic, Gemini, Zen,
 *      OpenRouter, Groq…) — the user supplies their own and owns the terms;
 *   3. the deterministic offline template (callers already have it).
 *
 * PHASE 0 AUDIT (docs/AUDIT_PHASE0.md §A4, §B1): step 2a used to be a built-in
 * KEYLESS third-party endpoint (Pollinations) whose anonymous tier injected
 * sponsor/ad blocks into replies and whose availability and terms were outside
 * our control. Every reply had to be regex-cleaned by `stripSponsored()` before
 * the app could use it, and when it was rate-limited the failure surfaced as an
 * opaque "free brain busy" notice. Both are gone:
 *   - KEYLESS_ENDPOINTS is empty, so no third-party service is used by default;
 *   - a provider's text is never rewritten here — if an answer needs filtering,
 *     that is a provider choice and a content-moderation decision, not a regex.
 * A fresh install with no key and no local model now reports exactly that
 * (AI_ERROR.NO_PROVIDER / NO_KEY_CONFIGURED with the fix named) and keeps
 * working through the deterministic planner.
 *
 * Pure and dependency-free: `fetchImpl` and `now` are injectable, so the Node
 * checks exercise every path with mocked endpoints. Nothing here reads or logs
 * a key; user keys arrive as opaque route objects from main.cjs.
 */
const KEYLESS_ENDPOINTS = []

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
const BUSY_NOTICE = 'free endpoint busy, retrying'
const OFFLINE_NOTICE = 'offline brain'

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
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
 * 401/402/403/410 from a keyless endpoint = keyless use is no longer offered there.
 * (No keyless endpoint ships today; the predicate stays because a caller may
 * still configure one explicitly, and the checks cover it.)
 */
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
  // Phase 0 §A4: this used to run `stripSponsored()` over keyless replies.
  // The provider's text is returned exactly as received; a reply we cannot use
  // is an error the user sees, not something silently rewritten here.
  if (!text.trim()) { const err = new Error(`${route.label} returned an empty reply`); err.status = 0; throw err }
  return text
}

/**
 * Try routes in order: retry 1 s → 4 s on 429/503 (same route), then hop.
 * Dead models (404/model_not_found) are reported via onRetired and skipped.
 * Never throws for expected states — returns { ok:false, notice:'offline brain' }
 * when nothing answered, so callers drop to the deterministic template.
 */
async function completeViaRoutes(routes, messages, opts = {}) {
  const { fetchImpl = fetch, cooldowns = createCooldowns(), onNotice = () => {}, onRetired = () => {}, validate, deadlineMs = 45_000, now = () => Date.now(), sleepImpl = sleep } = opts
  const deadline = now() + deadlineMs
  const failures = []
  let noticed = false
  for (const route of routes) {
    const key = `${route.chatUrl || route.baseUrl}|${route.model}`
    if (cooldowns.cooling(key)) continue
    for (let attempt = 0; ; attempt += 1) {
      if (deadline - now() < 1500) break
      const wait = cooldowns.reserve(key, route.minIntervalMs)
      if (wait > deadline - now() - 1500) break
      if (wait) await sleepImpl(wait)
      try {
        const text = await chatOnce(route, messages, { ...opts, fetchImpl, timeoutMs: Math.max(2000, Math.min(opts.timeoutMs ?? 30_000, deadline - now())) })
        if (validate) validate(text)
        return { ok: true, text, route: route.label, kind: route.kind, model: route.model, notice: noticed ? BUSY_NOTICE : '' }
      } catch (err) {
        const status = err?.status ?? 0
        failures.push(`${route.label}: ${err?.message || err}`)
        if (route.kind === 'keyless' && keylessRevoked(status)) { cooldowns.set(key, 24 * 3600_000, 'keyless-revoked'); break }
        if (isDeadModel(status, err?.message)) { onRetired({ baseUrl: route.baseUrl, model: route.model, label: route.label }); cooldowns.set(key, 24 * 3600_000, 'retired'); break }
        if (retryable(status, err?.message)) {
          if (route.kind === 'keyless' && !noticed) { noticed = true; onNotice(BUSY_NOTICE) }
          const backoff = BACKOFF_MS[attempt]
          if (backoff !== undefined && deadline - now() > backoff + 2000) { await sleepImpl(backoff); continue }
          cooldowns.set(key, status === 429 ? 60_000 : 20_000, status === 429 ? 'rate-limit' : 'unavailable')
        }
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
  probeLocals, modelQuality, keylessRevoked, planRoutes, createCooldowns, chatOnce, completeViaRoutes,
  MODEL_CACHE_TTL_MS, WEEK_MS, MODEL_CAP, costBadge, aggregateModels, mergeCatalogue, retireModel, isStale, fallbackModel,
}
