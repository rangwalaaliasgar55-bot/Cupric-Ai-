/**
 * AI providers — one interface, real adapters, typed errors.
 *
 * Phase 0 audit (docs/AUDIT_PHASE0.md §B1) found the app's brain was a stack of
 * OpenCode-compatible calls whose failures were string-matched at the call site
 * (`/429|quota|rate.?limit/`), whose last-resort route was a third-party keyless
 * endpoint whose replies had to be regex-cleaned (`stripSponsored`), and whose
 * errors reached the UI as whatever text `fetch` produced. This module replaces
 * that with:
 *
 *   generate(config, request) -> { ok: true, … } | { ok: false, error: { code, … } }
 *
 * and five codes the UI can act on:
 *   NO_KEY_CONFIGURED, RATE_LIMITED, NETWORK_ERROR, INVALID_RESPONSE, TIMEOUT
 * (plus UNAUTHORIZED, MODEL_NOT_FOUND, BAD_REQUEST, SERVER_ERROR, CANCELLED,
 * which are the same taxonomy with a narrower cause).
 *
 * Rules this module keeps, because the audit demanded them:
 *   - the provider's text is returned EXACTLY as received. No stripping, no
 *     trimming of "sponsored" blocks, no rewriting. If a provider's output
 *     still needs filtering, that is a provider choice, not a patch here.
 *   - a missing key is a typed error before any request is made, not a failure
 *     discovered by trying.
 *   - retries happen only for retryable codes, with a bounded schedule, and the
 *     attempt count is returned so the UI can say what happened.
 *
 * Dependency-free and injectable (`transport`, `sleep`, `now`), so every branch
 * is tested without a network in src/tests/ai-providers.test.ts and end to end
 * against a real HTTP server in scripts/check-ai-providers.mjs.
 */

const AI_ERROR = Object.freeze({
  NO_KEY_CONFIGURED: 'NO_KEY_CONFIGURED',
  UNAUTHORIZED: 'UNAUTHORIZED',
  RATE_LIMITED: 'RATE_LIMITED',
  NETWORK_ERROR: 'NETWORK_ERROR',
  TIMEOUT: 'TIMEOUT',
  INVALID_RESPONSE: 'INVALID_RESPONSE',
  MODEL_NOT_FOUND: 'MODEL_NOT_FOUND',
  BAD_REQUEST: 'BAD_REQUEST',
  SERVER_ERROR: 'SERVER_ERROR',
  CANCELLED: 'CANCELLED',
})

/** Which codes are worth trying again on the same route, and what to tell the user. */
const ERROR_SPEC = Object.freeze({
  [AI_ERROR.NO_KEY_CONFIGURED]: { retryable: false, action: 'Add a key in Settings', why: 'no API key is configured' },
  [AI_ERROR.UNAUTHORIZED]: { retryable: false, action: 'Check the key in Settings', why: 'the provider rejected the key' },
  [AI_ERROR.RATE_LIMITED]: { retryable: true, action: 'Retry in a minute', why: 'the provider is rate-limiting this key' },
  [AI_ERROR.NETWORK_ERROR]: { retryable: true, action: 'Retry', why: 'the provider could not be reached' },
  [AI_ERROR.TIMEOUT]: { retryable: true, action: 'Retry', why: 'the provider did not answer in time' },
  [AI_ERROR.INVALID_RESPONSE]: { retryable: false, action: 'Retry', why: 'the provider sent a reply that could not be read' },
  [AI_ERROR.MODEL_NOT_FOUND]: { retryable: false, action: 'Pick another model in Settings', why: 'the model name was rejected' },
  [AI_ERROR.BAD_REQUEST]: { retryable: false, action: 'Check the model and settings', why: 'the provider rejected the request' },
  [AI_ERROR.SERVER_ERROR]: { retryable: true, action: 'Retry', why: 'the provider had a server error' },
  [AI_ERROR.CANCELLED]: { retryable: false, action: 'Retry', why: 'the request was cancelled' },
})

/**
 * Providers we can talk to. `needsKey: false` is only ever true for a local
 * server the user pointed us at (Ollama, LM Studio, llama.cpp, OpenCode
 * Desktop) — those run on the machine and have no key to configure.
 */
const PROVIDERS = Object.freeze({
  openai: { label: 'OpenAI', kind: 'openai', defaultBaseUrl: 'https://api.openai.com/v1', defaultModel: 'gpt-4o-mini', needsKey: true },
  anthropic: { label: 'Anthropic', kind: 'anthropic', defaultBaseUrl: 'https://api.anthropic.com/v1', defaultModel: 'claude-sonnet-4-5', needsKey: true },
  gemini: { label: 'Gemini', kind: 'gemini', defaultBaseUrl: 'https://generativelanguage.googleapis.com/v1beta', defaultModel: 'gemini-2.5-flash', needsKey: true },
  local: { label: 'Local model', kind: 'openai', defaultBaseUrl: 'http://localhost:11434/v1', defaultModel: '', needsKey: false },
})

const RETRY_BACKOFF_MS = [1000, 4000]
const DEFAULT_TIMEOUT_MS = 30_000
const ANTHROPIC_VERSION = '2023-06-01'

const trimBase = (url) => String(url || '').replace(/\/+$/, '')

/** A user-facing sentence for a typed failure. Never a raw stack or "fetch failed". */
function describeError(error, providerLabel = 'The provider') {
  if (!error) return 'The request failed.'
  const spec = ERROR_SPEC[error.code] || { action: 'Retry', why: 'the request failed' }
  const detail = error.detail ? ` (${String(error.detail).slice(0, 200)})` : ''
  return `${providerLabel}: ${spec.why}${detail}. ${spec.action}.`
}

function makeError(code, { detail = '', status = 0, provider = '', model = '', attempts = 1 } = {}) {
  const spec = ERROR_SPEC[code] || ERROR_SPEC[AI_ERROR.NETWORK_ERROR]
  return { code, detail, status, provider, model, attempts, retryable: spec.retryable, action: spec.action, message: describeError({ code, detail }, provider || 'The provider') }
}

/** Resolve a config into everything a request needs, or a typed error. */
function resolveConfig(config = {}) {
  const preset = PROVIDERS[config.provider] || null
  if (!preset) return { error: makeError(AI_ERROR.BAD_REQUEST, { detail: `unknown provider "${config.provider}"`, provider: String(config.provider || '') }) }
  const baseUrl = trimBase(config.baseUrl || preset.defaultBaseUrl)
  const model = String(config.model || preset.defaultModel || '').trim()
  const apiKey = String(config.apiKey || '').trim()
  const label = String(config.label || preset.label)
  if (preset.needsKey && !apiKey) return { error: makeError(AI_ERROR.NO_KEY_CONFIGURED, { provider: label }) }
  if (!baseUrl) return { error: makeError(AI_ERROR.BAD_REQUEST, { detail: 'no base URL', provider: label }) }
  if (!model) return { error: makeError(AI_ERROR.BAD_REQUEST, { detail: 'no model selected', provider: label }) }
  return { provider: config.provider, kind: preset.kind, baseUrl, model, apiKey, label, timeoutMs: Number(config.timeoutMs) || DEFAULT_TIMEOUT_MS }
}

/** HTTP status → code. Kept pure so the mapping itself is unit-tested. */
function classifyStatus(status, body = '') {
  const text = String(body || '')
  if (status === 401 || status === 403) return AI_ERROR.UNAUTHORIZED
  if (status === 404) return /model|deploy|engine/i.test(text) ? AI_ERROR.MODEL_NOT_FOUND : AI_ERROR.BAD_REQUEST
  if (status === 400 || status === 422) {
    if (/model/i.test(text) && /(not found|unknown|invalid|does not exist|decommission|retired)/i.test(text)) return AI_ERROR.MODEL_NOT_FOUND
    return AI_ERROR.BAD_REQUEST
  }
  if (status === 429) return AI_ERROR.RATE_LIMITED
  if (status >= 500) return AI_ERROR.SERVER_ERROR
  return AI_ERROR.BAD_REQUEST
}

/** A thrown transport error → code. Node hides ECONNREFUSED in `cause`. */
function classifyTransportError(err, { cancelled = false } = {}) {
  if (cancelled) return AI_ERROR.CANCELLED
  const name = err?.name || ''
  if (name === 'TimeoutError' || name === 'AbortError') return AI_ERROR.TIMEOUT
  const code = err?.cause?.code || err?.code || ''
  if (code === 'ECONNREFUSED' || code === 'ENOTFOUND' || code === 'EAI_AGAIN' || code === 'ECONNRESET' || code === 'EPIPE') return AI_ERROR.NETWORK_ERROR
  if (/timed? ?out/i.test(err?.message || '')) return AI_ERROR.TIMEOUT
  return AI_ERROR.NETWORK_ERROR
}

/** The messages array a provider expects, with the system prompt placed the way it wants. */
function threadMessages(messages = [], system = '') {
  const out = messages
    .filter((message) => message && message.content != null && message.content !== '')
    .map((message) => ({ role: message.role === 'assistant' || message.role === 'ai' ? 'assistant' : 'user', content: message.content }))
  if (system) out.unshift({ role: 'system', content: system })
  return out
}

/**
 * The request for one provider. Pure: given the same inputs it returns the same
 * URL/headers/body, which is what makes the contracts testable without a server.
 */
function buildRequest(config, { system = '', messages = [], json = false, temperature = 0.4, maxTokens = 2048, images = [] } = {}) {
  const thread = threadMessages(messages, system)
  const headers = { 'content-type': 'application/json' }

  if (config.kind === 'anthropic') {
    // Anthropic takes the system prompt as its own field and image blocks inside
    // the user turn; `max_tokens` is required, not optional.
    headers['x-api-key'] = config.apiKey
    headers['anthropic-version'] = ANTHROPIC_VERSION
    const anthropicMessages = thread
      .filter((message) => message.role !== 'system')
      .map((message) => ({ role: message.role, content: [{ type: 'text', text: String(message.content) }] }))
    const imageBlocks = images.map((image) => ({ type: 'image', source: { type: 'base64', media_type: image.mimeType || 'image/jpeg', data: image.data } }))
    if (imageBlocks.length && anthropicMessages.length) {
      const last = anthropicMessages[anthropicMessages.length - 1]
      if (Array.isArray(last.content)) last.content.unshift(...imageBlocks)
    }
    const body = { model: config.model, max_tokens: maxTokens, messages: anthropicMessages }
    const systemPrompt = thread.find((message) => message.role === 'system')?.content
    if (systemPrompt) body.system = String(systemPrompt)
    if (temperature != null) body.temperature = Math.min(1, Math.max(0, temperature))
    return { url: `${config.baseUrl}/messages`, init: { method: 'POST', headers, body: JSON.stringify(body) }, body }
  }

  if (config.kind === 'gemini') {
    // Google's REST shape: one `contents` list, a separate systemInstruction.
    const contents = thread
      .filter((message) => message.role !== 'system')
      .map((message) => ({
        role: message.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: String(message.content) }, ...(message.role === 'user' ? images.map((image) => ({ inlineData: { mimeType: image.mimeType || 'image/jpeg', data: image.data } })) : [])],
      }))
    const body = {
      contents,
      generationConfig: { temperature, maxOutputTokens: maxTokens, ...(json ? { responseMimeType: 'application/json' } : {}) },
    }
    const systemPrompt = thread.find((message) => message.role === 'system')?.content
    if (systemPrompt) body.systemInstruction = { parts: [{ text: String(systemPrompt) }] }
    return { url: `${config.baseUrl}/models/${encodeURIComponent(config.model)}:generateContent?key=${encodeURIComponent(config.apiKey)}`, init: { method: 'POST', headers, body: JSON.stringify(body) }, body }
  }

  // openai-compatible: OpenAI itself, and every local server (Ollama, LM Studio,
  // llama.cpp, OpenCode Desktop) which all speak this shape.
  if (config.apiKey) headers.authorization = `Bearer ${config.apiKey}`
  if (/openrouter\.ai/i.test(config.baseUrl)) {
    headers['HTTP-Referer'] = 'https://newbrand.ai'
    headers['X-Title'] = 'NewBrand'
  }
  const openaiMessages = thread.map((message) => {
    if (message.role !== 'user' || !images.length) return message
    return {
      role: 'user',
      content: [{ type: 'text', text: String(message.content) }, ...images.map((image) => ({ type: 'image_url', image_url: { url: `data:${image.mimeType || 'image/jpeg'};base64,${image.data}` } }))],
    }
  })
  const body = { model: config.model, messages: openaiMessages, temperature, stream: false, ...(json ? { response_format: { type: 'json_object' } } : {}) }
  return { url: `${config.baseUrl}/chat/completions`, init: { method: 'POST', headers, body: JSON.stringify(body) }, body }
}

/** Provider JSON → `{ text, model, usage, finishReason, blocked }`. Pure. */
function parseResponse(config, data) {
  if (config.kind === 'anthropic') {
    const blocks = Array.isArray(data?.content) ? data.content : []
    const text = blocks.filter((block) => block?.type === 'text').map((block) => block.text || '').join('')
    return { text, model: data?.model || config.model, usage: data?.usage || null, finishReason: data?.stop_reason || null }
  }
  if (config.kind === 'gemini') {
    const blocked = data?.promptFeedback?.blockReason || null
    const candidate = Array.isArray(data?.candidates) ? data.candidates[0] : null
    const parts = candidate?.content?.parts
    const text = Array.isArray(parts) ? parts.map((part) => (typeof part?.text === 'string' ? part.text : '')).join('') : ''
    return { text, model: data?.modelVersion || config.model, usage: data?.usageMetadata || null, finishReason: candidate?.finishReason || null, blocked }
  }
  const choice = Array.isArray(data?.choices) ? data.choices[0] : null
  const content = choice?.message?.content ?? choice?.text ?? data?.message?.content ?? ''
  const text = Array.isArray(content) ? content.map((part) => (typeof part === 'string' ? part : part?.text || '')).join('') : String(content ?? '')
  return { text, model: data?.model || config.model, usage: data?.usage || null, finishReason: choice?.finish_reason || null }
}

/** Read a failed response body without ever throwing from the error path. */
async function readFailureDetail(response) {
  try {
    const text = await response.text()
    return String(text || '').replace(/\s+/g, ' ').slice(0, 300)
  } catch {
    return ''
  }
}

/**
 * One completion.
 *
 * `transport` and `sleep` are injectable so the unit tests can script every
 * branch; the real defaults are `fetch` and a real timer.
 */
async function generate(config, request = {}, options = {}) {
  const {
    transport = fetch,
    sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    backoffMs = RETRY_BACKOFF_MS,
    signal = null,
  } = options

  const resolved = resolveConfig(config)
  if (resolved.error) return { ok: false, error: resolved.error }
  const { timeoutMs } = resolved

  let attempts = 0
  let lastError = null
  for (;;) {
    attempts += 1
    const { url, init } = buildRequest(resolved, request)
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(new Error('timeout')), Math.max(1000, Number(request.timeoutMs) || timeoutMs))
    const onAbort = () => controller.abort(new Error('cancelled'))
    if (signal) {
      if (signal.aborted) { clearTimeout(timer); return { ok: false, error: makeError(AI_ERROR.CANCELLED, { provider: resolved.label, model: resolved.model, attempts }) } }
      signal.addEventListener('abort', onAbort, { once: true })
    }
    try {
      const response = await transport(url, { ...init, signal: controller.signal })
      if (!response.ok) {
        const detail = await readFailureDetail(response)
        const code = classifyStatus(response.status, detail)
        lastError = makeError(code, { detail, status: response.status, provider: resolved.label, model: resolved.model, attempts })
      } else {
        let data = null
        try {
          data = await response.json()
        } catch {
          lastError = makeError(AI_ERROR.INVALID_RESPONSE, { detail: 'the reply was not JSON', provider: resolved.label, model: resolved.model, attempts })
        }
        if (data) {
          const parsed = parseResponse(resolved, data)
          if (parsed.blocked) {
            lastError = makeError(AI_ERROR.INVALID_RESPONSE, { detail: `the provider refused the prompt (${parsed.blocked})`, provider: resolved.label, model: resolved.model, attempts })
          } else if (!parsed.text || !parsed.text.trim()) {
            lastError = makeError(AI_ERROR.INVALID_RESPONSE, { detail: 'the reply was empty', provider: resolved.label, model: resolved.model, attempts })
          } else {
            clearTimeout(timer)
            if (signal) signal.removeEventListener('abort', onAbort)
            // The provider's text, untouched. Callers parse it; nobody rewrites it.
            return {
              ok: true,
              text: parsed.text,
              model: parsed.model,
              provider: resolved.provider,
              label: resolved.label,
              usage: parsed.usage,
              finishReason: parsed.finishReason,
              attempts,
            }
          }
        }
      }
    } catch (err) {
      const code = classifyTransportError(err, { cancelled: Boolean(signal?.aborted) })
      lastError = makeError(code, { detail: code === AI_ERROR.TIMEOUT ? `no answer within ${Math.round((Number(request.timeoutMs) || timeoutMs) / 1000)}s` : '', provider: resolved.label, model: resolved.model, attempts })
      if (code === AI_ERROR.CANCELLED) {
        clearTimeout(timer)
        if (signal) signal.removeEventListener('abort', onAbort)
        return { ok: false, error: lastError }
      }
    } finally {
      clearTimeout(timer)
      if (signal) signal.removeEventListener('abort', onAbort)
    }
    const backoff = backoffMs[attempts - 1]
    if (!lastError.retryable || backoff === undefined) break
    await sleep(backoff)
  }
  return { ok: false, error: lastError }
}

/**
 * Adopt an error thrown by older code (an SDK exception, a `fetch failed`) into
 * the taxonomy, so anything that still throws can be reported the same way.
 */
function classifyError(err) {
  if (err?.code && ERROR_SPEC[err.code]) return makeError(err.code, { detail: err.detail || '', status: err.status || 0 })
  const message = String(err?.message || err || '')
  if (/permission|api key|unauthor|not authorized|401|403|invalid key|API_KEY_INVALID/i.test(message)) return makeError(AI_ERROR.UNAUTHORIZED, { detail: message })
  if (/\b429\b|quota|rate.?limit|resource_exhausted|too many requests/i.test(message)) return makeError(AI_ERROR.RATE_LIMITED, { detail: message })
  if (/model.*(not found|unknown|invalid|does not exist)|404.*model|not available|decommission/i.test(message)) return makeError(AI_ERROR.MODEL_NOT_FOUND, { detail: message })
  if (/timed? ?out|timeout/i.test(message)) return makeError(AI_ERROR.TIMEOUT, { detail: message })
  if (/network|fetch failed|ENOTFOUND|ECONNREFUSED|EAI_AGAIN|connection refused|offline/i.test(message)) return makeError(AI_ERROR.NETWORK_ERROR, { detail: message })
  if (/\b5\d\d\b|overload|unavailable|high demand/i.test(message)) return makeError(AI_ERROR.SERVER_ERROR, { detail: message })
  if (/empty|unreadable|not json|parse/i.test(message)) return makeError(AI_ERROR.INVALID_RESPONSE, { detail: message })
  return makeError(AI_ERROR.NETWORK_ERROR, { detail: message })
}

module.exports = {
  AI_ERROR,
  ERROR_SPEC,
  PROVIDERS,
  RETRY_BACKOFF_MS,
  DEFAULT_TIMEOUT_MS,
  ANTHROPIC_VERSION,
  describeError,
  makeError,
  resolveConfig,
  classifyStatus,
  classifyTransportError,
  classifyError,
  threadMessages,
  buildRequest,
  parseResponse,
  generate,
}
