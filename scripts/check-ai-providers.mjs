#!/usr/bin/env node
/**
 * check:ai-providers — the provider layer over a REAL HTTP socket.
 *
 * src/tests/ai-providers.test.ts scripts the transport, which proves the
 * taxonomy and the request shapes but not that node's `fetch` sends what we
 * built. This file stands up two real servers on 127.0.0.1 — one speaking the
 * OpenAI-compatible shape (what OpenAI, Ollama, LM Studio, llama.cpp and
 * OpenCode Desktop all speak) and one speaking Anthropic's shape — and runs the
 * provider layer against them with its default transport.
 *
 * What it proves, end to end:
 *   - headers arrive as built (Bearer for OpenAI, x-api-key + version for
 *     Anthropic), and the body parses as the JSON we intended
 *   - a 429 is retried on the documented schedule and then succeeds
 *   - a 401, a 404-model, an unreadable reply, an empty reply and a stalled
 *     server each produce their own typed code
 *   - a missing key makes ZERO requests (counted by the server)
 *   - the provider's text is returned byte-for-byte, including an ad-looking
 *     line, because the old `stripSponsored()` regex cleanup is gone
 */
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const ai = require('../electron/ai-providers.cjs')
const providerConfig = require('../electron/ai-provider-config.cjs')

let checks = 0
const ok = (condition, label) => { assert.ok(condition, `FAIL: ${label}`); checks += 1 }

/** Read a request body and JSON-parse it, whatever the client sent. */
function readJson(request) {
  return new Promise((resolve) => {
    let raw = ''
    request.on('data', (chunk) => { raw += chunk })
    request.on('end', () => {
      let parsed = null
      try { parsed = raw ? JSON.parse(raw) : null } catch { parsed = null }
      resolve({ raw, json: parsed })
    })
  })
}

const send = (response, status, payload, contentType = 'application/json') => {
  const body = typeof payload === 'string' ? payload : JSON.stringify(payload)
  response.writeHead(status, { 'content-type': contentType, 'content-length': Buffer.byteLength(body) })
  response.end(body)
}

const seen = { chatCalls: 0, rateCalls: 0, authHeaders: [], anthropicCalls: [], anthropicHeaders: [] }

/* ——— server 1: the OpenAI-compatible shape ——— */
const openaiServer = createServer(async (request, response) => {
  const { json } = await readJson(request)
  if (request.method === 'GET' && request.url.startsWith('/v1/models')) {
    return send(response, 200, { data: [{ id: 'ok-model' }, { id: 'other-model' }] })
  }
  if (request.method !== 'POST' || !request.url.startsWith('/v1/chat/completions')) return send(response, 404, { error: 'no route' })
  seen.chatCalls += 1
  seen.authHeaders.push(request.headers.authorization || '')

  const model = json?.model
  if (model === 'auth-model') return send(response, 401, { error: { message: 'Incorrect API key provided' } })
  if (model === 'dead-model') return send(response, 404, { error: { message: 'The model `dead-model` does not exist' } })
  if (model === 'junk-model') return send(response, 200, 'this is not json at all', 'text/plain')
  if (model === 'empty-model') return send(response, 200, { choices: [{ message: { content: '' }, finish_reason: 'stop' }] })
  if (model === 'rate-model') {
    seen.rateCalls += 1
    if (seen.rateCalls < 3) return send(response, 429, { error: { message: 'Rate limit reached' } })
    return send(response, 200, { choices: [{ message: { content: 'answered after two rate limits' }, finish_reason: 'stop' }], model })
  }
  if (model === 'slow-model') {
    await new Promise((resolve) => setTimeout(resolve, 2500))
    return send(response, 200, { choices: [{ message: { content: 'too late' } }] })
  }
  // Echo the user's text back, wrapped in an ad-looking block, so the caller can
  // prove nothing is being stripped from a provider's reply.
  const userText = json?.messages?.at(-1)?.content
  const text = typeof userText === 'string' ? userText : JSON.stringify(userText)
  return send(response, 200, {
    choices: [{ message: { content: text }, finish_reason: 'stop' }],
    model,
    usage: { prompt_tokens: 11, completion_tokens: 22, total_tokens: 33 },
  })
})

/* ——— server 2: Anthropic's shape ——— */
const anthropicServer = createServer(async (request, response) => {
  const { json } = await readJson(request)
  if (request.method !== 'POST' || !request.url.startsWith('/v1/messages')) return send(response, 404, { error: 'no route' })
  seen.anthropicCalls.push(json)
  seen.anthropicHeaders.push({ key: request.headers['x-api-key'] || '', version: request.headers['anthropic-version'] || '' })
  if (!request.headers['x-api-key'] || !request.headers['anthropic-version'] || !json?.max_tokens) {
    return send(response, 400, { type: 'error', error: { type: 'invalid_request_error', message: 'missing required field' } })
  }
  return send(response, 200, {
    id: 'msg_1',
    model: json.model,
    stop_reason: 'end_turn',
    content: [{ type: 'text', text: `anthropic saw: ${json.messages?.[0]?.content?.[0]?.text ?? ''}` }],
    usage: { input_tokens: 5, output_tokens: 7 },
  })
})

await new Promise((resolve) => openaiServer.listen(0, '127.0.0.1', resolve))
await new Promise((resolve) => anthropicServer.listen(0, '127.0.0.1', resolve))
const openaiBase = `http://127.0.0.1:${openaiServer.address().port}/v1`
const anthropicBase = `http://127.0.0.1:${anthropicServer.address().port}/v1`

const ask = (config, request = {}, options = {}) => ai.generate({ baseUrl: openaiBase, ...config }, { messages: [{ role: 'user', content: 'hello from the check' }], ...request }, options)

try {
  /* 1. happy path, real fetch, and the reply is untouched */
  const first = await ask({ provider: 'openai', apiKey: 'sk-live-test', model: 'ok-model' })
  ok(first.ok === true, 'real HTTP round trip succeeds')
  ok(first.text === 'hello from the check', `provider text returned verbatim (got ${JSON.stringify(first.text)})`)
  ok(first.usage?.total_tokens === 33, 'usage is passed through')
  ok(first.attempts === 1, 'one attempt on success')
  ok(seen.authHeaders.at(-1) === 'Bearer sk-live-test', `real request carried the bearer key (got ${JSON.stringify(seen.authHeaders.at(-1))})`)

  const adText = 'Answer.\n🌸 **Ad** — support pollinations.ai/redirect'
  const untouched = await ask({ provider: 'openai', apiKey: 'k', model: 'ok-model' }, { messages: [{ role: 'user', content: adText }] })
  ok(untouched.text === adText, 'an ad-looking reply is NOT regex-stripped (Phase 0 §A4)')

  /* 2. a local server needs no key and sends no Authorization header */
  const local = await ask({ provider: 'local', model: 'ok-model' })
  ok(local.ok === true, 'local (keyless) server works with no key configured')
  ok(seen.authHeaders.at(-1) === '', 'keyless request sends no Authorization header')

  /* 3. retry on the real socket */
  const started = Date.now()
  const retried = await ask({ provider: 'openai', apiKey: 'k', model: 'rate-model' })
  ok(retried.ok === true && retried.attempts === 3, `429 retried to success in ${retried.attempts} attempts`)
  ok(Date.now() - started >= 5000, `backoff really waited (${Date.now() - started}ms for 1s + 4s)`)
  ok(seen.rateCalls === 3, 'the server saw exactly three attempts')

  /* 4. every other typed failure, over the wire */
  const auth = await ask({ provider: 'openai', apiKey: 'bad', model: 'auth-model' })
  ok(auth.error.code === ai.AI_ERROR.UNAUTHORIZED && auth.error.status === 401, 'a 401 is UNAUTHORIZED')
  ok(/Check the key in Settings/.test(auth.error.message), 'the 401 message names the fix')

  const dead = await ask({ provider: 'openai', apiKey: 'k', model: 'dead-model' })
  ok(dead.error.code === ai.AI_ERROR.MODEL_NOT_FOUND, 'a 404 naming a model is MODEL_NOT_FOUND')

  const junk = await ask({ provider: 'openai', apiKey: 'k', model: 'junk-model' })
  ok(junk.error.code === ai.AI_ERROR.INVALID_RESPONSE, 'a non-JSON body is INVALID_RESPONSE')

  const empty = await ask({ provider: 'openai', apiKey: 'k', model: 'empty-model' })
  ok(empty.error.code === ai.AI_ERROR.INVALID_RESPONSE, 'an empty completion is INVALID_RESPONSE')

  const timeoutStarted = Date.now()
  const slow = await ask({ provider: 'openai', apiKey: 'k', model: 'slow-model' }, { timeoutMs: 700 }, { backoffMs: [] })
  ok(slow.error.code === ai.AI_ERROR.TIMEOUT, 'a stalled server is TIMEOUT')
  ok(Date.now() - timeoutStarted < 2000, `the single attempt ended on its own deadline (${Date.now() - timeoutStarted}ms, not after the 2500ms reply)`)
  ok(slow.error.attempts === 1, 'with no backoff schedule it tried exactly once')

  // The default policy treats a timeout as transient: bounded retries, bounded
  // total time, and the attempt count reported.
  const retriedTimeoutStarted = Date.now()
  const retriedTimeout = await ask({ provider: 'openai', apiKey: 'k', model: 'slow-model' }, { timeoutMs: 700 })
  ok(retriedTimeout.error.code === ai.AI_ERROR.TIMEOUT && retriedTimeout.error.attempts === 3, 'the default policy retries a timeout on the documented schedule')
  ok(Date.now() - retriedTimeoutStarted < 12_000, `and the whole call stays bounded (${Date.now() - retriedTimeoutStarted}ms)`)

  /* 5. a missing key must not reach the network at all */
  const before = seen.chatCalls
  const noKey = await ai.generate({ provider: 'openai', model: 'ok-model' }, { messages: [{ role: 'user', content: 'x' }] })
  ok(noKey.error.code === ai.AI_ERROR.NO_KEY_CONFIGURED, 'no key is NO_KEY_CONFIGURED')
  ok(seen.chatCalls === before, 'and makes zero HTTP requests')

  /* 6. Anthropic over the real socket: headers, system field and max_tokens */
  const anthropic = await ai.generate(
    { provider: 'anthropic', apiKey: 'sk-ant-test', baseUrl: anthropicBase, model: 'claude-sonnet-4-5' },
    { system: 'You are Cupric.', messages: [{ role: 'user', content: 'hello anthropic' }], maxTokens: 256 },
  )
  ok(anthropic.ok === true, `anthropic round trip succeeds (${anthropic.ok ? '' : anthropic.error?.code})`)
  ok(anthropic.text === 'anthropic saw: hello anthropic', 'anthropic content blocks are joined')
  ok(seen.anthropicHeaders.at(-1).key === 'sk-ant-test' && seen.anthropicHeaders.at(-1).version === ai.ANTHROPIC_VERSION, 'anthropic received x-api-key and anthropic-version')
  ok(seen.anthropicCalls.at(-1).system === 'You are Cupric.', 'the system prompt travelled as its own field')
  ok(seen.anthropicCalls.at(-1).max_tokens === 256, 'max_tokens was sent (Anthropic rejects the request without it)')

  /* 7. Anthropic without a key: typed, and no request */
  const anthropicCallsBefore = seen.anthropicCalls.length
  const anthropicNoKey = await ai.generate({ provider: 'anthropic', baseUrl: anthropicBase, model: 'claude-sonnet-4-5' }, { messages: [{ role: 'user', content: 'x' }] })
  ok(anthropicNoKey.error.code === ai.AI_ERROR.NO_KEY_CONFIGURED, 'anthropic without a key is NO_KEY_CONFIGURED')
  ok(seen.anthropicCalls.length === anthropicCallsBefore, 'and no request was made to the anthropic server')

  /* 8. a genuinely unreachable host is a network error, not a crash */
  const refused = await ai.generate(
    { provider: 'local', baseUrl: 'http://127.0.0.1:9/v1', model: 'nobody-home' },
    { messages: [{ role: 'user', content: 'x' }] },
    { sleep: async () => {}, backoffMs: [] },
  )
  ok(refused.error.code === ai.AI_ERROR.NETWORK_ERROR, 'a closed port is NETWORK_ERROR')
  ok(!/fetch failed/.test(refused.error.message), 'and the message is a sentence, not "fetch failed"')

  /* 9. The real composition every IPC call uses: settings → providerConfig →
     aiProviders.generate → the socket. This is the path ai:testProvider runs. */
  const settings = { aiKind: 'openai', openaiApiKey: 'sk-composed', openaiBaseUrl: openaiBase, openaiModel: 'ok-model' }
  const composed = providerConfig.providerConfig(settings, {})
  ok(composed.error === undefined, `settings produced a usable provider config (${composed.error?.code || 'none'})`)
  const composedResult = await ai.generate(composed, { messages: [{ role: 'user', content: 'composed path' }] })
  ok(composedResult.ok === true && composedResult.text === 'composed path', 'the composed path reaches the real server')
  ok(seen.authHeaders.at(-1) === 'Bearer sk-composed', 'with the key from settings')
  const composedModels = providerConfig.parseModels('openai', await (await fetch(providerConfig.listModelsRequest(composed).url, { headers: providerConfig.listModelsRequest(composed).init.headers })).json())
  ok(composedModels.length === 2 && composedModels[0].id === 'ok-model', `the model list comes from the same endpoint (${composedModels.map((m) => m.id).join(', ')})`)
  const noKeySettings = providerConfig.providerConfig({ aiKind: 'openai' }, {})
  ok(noKeySettings.error.code === ai.AI_ERROR.NO_KEY_CONFIGURED, 'and a keyless settings object fails before any request')

  console.log(`ai providers check passed — ${checks} assertions against two real HTTP servers (OpenAI-compatible and Anthropic). Total provider requests observed by the servers: ${seen.chatCalls} chat + ${seen.anthropicCalls.length} anthropic.`)
} finally {
  openaiServer.close()
  anthropicServer.close()
}
