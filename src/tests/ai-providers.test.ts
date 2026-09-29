/**
 * AI provider layer — the taxonomy, the request shapes and the retry policy.
 *
 * These run against a scripted `transport` (a fake HTTP boundary), so every
 * branch is exercised without a network. The same code paths are then run for
 * real against a local HTTP server by scripts/check-ai-providers.mjs, and the
 * two together are what makes "the provider layer works" a measured claim
 * instead of a code-reading claim.
 */
import { describe, expect, it, vi } from 'vitest'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const ai = require('../../electron/ai-providers.cjs')

const okBody = (text: string) => ({
  ok: true,
  status: 200,
  json: async () => ({ choices: [{ message: { content: text }, finish_reason: 'stop' }], model: 'test-model', usage: { total_tokens: 3 } }),
})

const failBody = (status: number, body = '') => ({ ok: false, status, text: async () => body })

describe('AIProvider: config resolution', () => {
  it('refuses a missing key before any request is made', () => {
    const result = ai.resolveConfig({ provider: 'openai' })
    expect(result.error.code).toBe(ai.AI_ERROR.NO_KEY_CONFIGURED)
    expect(result.error.retryable).toBe(false)
    expect(result.error.message).toMatch(/Add a key in Settings/)
  })

  it('a local server needs no key', () => {
    const resolved = ai.resolveConfig({ provider: 'local', baseUrl: 'http://localhost:11434/v1', model: 'llama3.2' })
    expect(resolved.error).toBeUndefined()
    expect(resolved.kind).toBe('openai')
    expect(resolved.apiKey).toBe('')
  })

  it('fills provider defaults and rejects nonsense', () => {
    expect(ai.resolveConfig({ provider: 'anthropic', apiKey: 'k' }).baseUrl).toBe('https://api.anthropic.com/v1')
    expect(ai.resolveConfig({ provider: 'openai', apiKey: 'k' }).model).toBe('gpt-4o-mini')
    expect(ai.resolveConfig({ provider: 'local', baseUrl: 'http://x/v1' }).error.code).toBe(ai.AI_ERROR.BAD_REQUEST) // no model
    expect(ai.resolveConfig({ provider: 'nope' }).error.code).toBe(ai.AI_ERROR.BAD_REQUEST)
  })
})

describe('AIProvider: status and transport classification', () => {
  it('maps HTTP status to the taxonomy', () => {
    expect(ai.classifyStatus(401)).toBe(ai.AI_ERROR.UNAUTHORIZED)
    expect(ai.classifyStatus(403)).toBe(ai.AI_ERROR.UNAUTHORIZED)
    expect(ai.classifyStatus(429)).toBe(ai.AI_ERROR.RATE_LIMITED)
    expect(ai.classifyStatus(500)).toBe(ai.AI_ERROR.SERVER_ERROR)
    expect(ai.classifyStatus(503)).toBe(ai.AI_ERROR.SERVER_ERROR)
    expect(ai.classifyStatus(400, 'unknown model "gpt-9"')).toBe(ai.AI_ERROR.MODEL_NOT_FOUND)
    expect(ai.classifyStatus(400, 'bad image size')).toBe(ai.AI_ERROR.BAD_REQUEST)
    expect(ai.classifyStatus(404, 'model not found')).toBe(ai.AI_ERROR.MODEL_NOT_FOUND)
  })

  it('reads Node\u2019s hidden cause codes instead of "fetch failed"', () => {
    const econnrefused = Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } })
    expect(ai.classifyTransportError(econnrefused)).toBe(ai.AI_ERROR.NETWORK_ERROR)
    const dns = Object.assign(new TypeError('fetch failed'), { cause: { code: 'ENOTFOUND' } })
    expect(ai.classifyTransportError(dns)).toBe(ai.AI_ERROR.NETWORK_ERROR)
    expect(ai.classifyTransportError(Object.assign(new Error('x'), { name: 'TimeoutError' }))).toBe(ai.AI_ERROR.TIMEOUT)
    expect(ai.classifyTransportError(new Error('request timed out'))).toBe(ai.AI_ERROR.TIMEOUT)
    expect(ai.classifyTransportError(new Error('x'), { cancelled: true })).toBe(ai.AI_ERROR.CANCELLED)
  })

  it('adopts legacy SDK errors into the same taxonomy', () => {
    expect(ai.classifyError(new Error('[GoogleGenerativeAI Error]: 429 quota exceeded')).code).toBe(ai.AI_ERROR.RATE_LIMITED)
    expect(ai.classifyError(new Error('API key not valid. Please pass a valid API key.')).code).toBe(ai.AI_ERROR.UNAUTHORIZED)
    expect(ai.classifyError(new Error('fetch failed')).code).toBe(ai.AI_ERROR.NETWORK_ERROR)
    expect(ai.classifyError(new Error('model gemini-1.0 is not found')).code).toBe(ai.AI_ERROR.MODEL_NOT_FOUND)
  })
})

describe('AIProvider: request shapes', () => {
  const messages = [{ role: 'user', content: 'hello' }]

  it('openai-compatible: bearer key, /chat/completions, json mode', () => {
    const config = ai.resolveConfig({ provider: 'openai', apiKey: 'sk-test' })
    const { url, init, body } = ai.buildRequest(config, { system: 'SYS', messages, json: true, temperature: 0.2 })
    expect(url).toBe('https://api.openai.com/v1/chat/completions')
    expect(init.headers.authorization).toBe('Bearer sk-test')
    expect(body.messages[0]).toEqual({ role: 'system', content: 'SYS' })
    expect(body.response_format).toEqual({ type: 'json_object' })
    expect(body.temperature).toBe(0.2)
  })

  it('openai-compatible: imports never send an Authorization header', () => {
    const config = ai.resolveConfig({ provider: 'local', baseUrl: 'http://127.0.0.1:1234/v1', model: 'm' })
    const { init } = ai.buildRequest(config, { messages })
    expect(init.headers.authorization).toBeUndefined()
  })

  it('anthropic: x-api-key + version, system as its own field, max_tokens required', () => {
    const config = ai.resolveConfig({ provider: 'anthropic', apiKey: 'sk-ant' })
    const { url, init, body } = ai.buildRequest(config, { system: 'SYS', messages, maxTokens: 512 })
    expect(url).toBe('https://api.anthropic.com/v1/messages')
    expect(init.headers['x-api-key']).toBe('sk-ant')
    expect(init.headers['anthropic-version']).toBe(ai.ANTHROPIC_VERSION)
    expect(body.system).toBe('SYS')
    expect(body.max_tokens).toBe(512)
    expect(body.messages).toEqual([{ role: 'user', content: [{ type: 'text', text: 'hello' }] }])
  })

  it('anthropic: images become base64 blocks inside the user turn', () => {
    const config = ai.resolveConfig({ provider: 'anthropic', apiKey: 'k' })
    const { body } = ai.buildRequest(config, { messages, images: [{ mimeType: 'image/png', data: 'AAA' }] })
    expect(body.messages[0].content[0]).toEqual({ type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAA' } })
  })

  it('gemini: key in the query, systemInstruction, model in the path', () => {
    const config = ai.resolveConfig({ provider: 'gemini', apiKey: 'g-key' })
    const { url, body } = ai.buildRequest(config, { system: 'SYS', messages, json: true })
    expect(url).toContain('/models/gemini-2.5-flash:generateContent')
    expect(url).toContain('key=g-key')
    expect(body.systemInstruction).toEqual({ parts: [{ text: 'SYS' }] })
    expect(body.generationConfig.responseMimeType).toBe('application/json')
  })
})

describe('AIProvider: response parsing', () => {
  it('reads each provider\u2019s own shape', () => {
    const openai = ai.resolveConfig({ provider: 'openai', apiKey: 'k' })
    expect(ai.parseResponse(openai, { choices: [{ message: { content: 'hi' } }] }).text).toBe('hi')
    expect(ai.parseResponse(openai, { choices: [{ message: { content: [{ text: 'a' }, { text: 'b' }] } }] }).text).toBe('ab')

    const anthropic = ai.resolveConfig({ provider: 'anthropic', apiKey: 'k' })
    expect(ai.parseResponse(anthropic, { content: [{ type: 'text', text: 'hello ' }, { type: 'tool_use' }, { type: 'text', text: 'there' }], stop_reason: 'end_turn' }).text).toBe('hello there')

    const gemini = ai.resolveConfig({ provider: 'gemini', apiKey: 'k' })
    expect(ai.parseResponse(gemini, { candidates: [{ content: { parts: [{ text: 'g' }] }, finishReason: 'STOP' }] }).text).toBe('g')
    expect(ai.parseResponse(gemini, { promptFeedback: { blockReason: 'SAFETY' } }).blocked).toBe('SAFETY')
  })
})

describe('AIProvider: generate', () => {
  it('returns the provider text exactly as received (no stripping, no trimming)', async () => {
    const text = '   Keep this exactly.\n\n🌸 **Ad** — support pollinations.ai\nline two  '
    const transport = vi.fn(async () => okBody(text))
    const result = await ai.generate({ provider: 'openai', apiKey: 'k' }, { messages: [{ role: 'user', content: 'x' }] }, { transport, sleep: async () => {} })
    expect(result.ok).toBe(true)
    expect(result.text).toBe(text) // Phase 0 §A4: the old code regex-cleaned this. It must not.
    expect(result.attempts).toBe(1)
    expect(transport).toHaveBeenCalledTimes(1)
  })

  it('retries a rate limit on the documented backoff, then succeeds', async () => {
    const sleeps: number[] = []
    let calls = 0
    const transport = vi.fn(async () => {
      calls += 1
      if (calls < 3) return failBody(429, 'rate limit exceeded')
      return okBody('after retries')
    })
    const result = await ai.generate({ provider: 'openai', apiKey: 'k' }, { messages: [] }, { transport, sleep: async (ms: number) => { sleeps.push(ms) } })
    expect(result.ok).toBe(true)
    expect(result.attempts).toBe(3)
    expect(sleeps).toEqual([1000, 4000])
  })

  it('does not retry an auth failure, and says which action fixes it', async () => {
    const transport = vi.fn(async () => failBody(401, 'invalid api key'))
    const result = await ai.generate({ provider: 'openai', apiKey: 'bad' }, { messages: [] }, { transport, sleep: async () => {} })
    expect(result.ok).toBe(false)
    expect(result.error.code).toBe(ai.AI_ERROR.UNAUTHORIZED)
    expect(result.error.retryable).toBe(false)
    expect(result.error.message).toMatch(/Check the key in Settings/)
    expect(transport).toHaveBeenCalledTimes(1)
  })

  it('a server error is retried and then returned with the attempt count', async () => {
    const transport = vi.fn(async () => failBody(503, 'overloaded'))
    const result = await ai.generate({ provider: 'openai', apiKey: 'k' }, { messages: [] }, { transport, sleep: async () => {} })
    expect(result.error.code).toBe(ai.AI_ERROR.SERVER_ERROR)
    expect(result.error.attempts).toBe(3)
    expect(result.error.retryable).toBe(true)
  })

  it('a timeout is a timeout, not a network error', async () => {
    const transport = vi.fn(async () => { throw Object.assign(new Error('x'), { name: 'TimeoutError' }) })
    const result = await ai.generate({ provider: 'openai', apiKey: 'k' }, { messages: [], timeoutMs: 5000 }, { transport, sleep: async () => {} })
    expect(result.error.code).toBe(ai.AI_ERROR.TIMEOUT)
    expect(result.error.detail).toMatch(/no answer within 5s/)
  })

  it('a refused connection is a network error with the cause read, not "fetch failed"', async () => {
    const transport = vi.fn(async () => { throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } }) })
    const result = await ai.generate({ provider: 'local', baseUrl: 'http://localhost:11434/v1', model: 'm' }, { messages: [] }, { transport, sleep: async () => {} })
    expect(result.error.code).toBe(ai.AI_ERROR.NETWORK_ERROR)
    expect(result.error.message).not.toMatch(/fetch failed/)
  })

  it('an unreadable or empty reply is INVALID_RESPONSE', async () => {
    const notJson = await ai.generate({ provider: 'openai', apiKey: 'k' }, { messages: [] }, { transport: async () => ({ ok: true, status: 200, json: async () => { throw new Error('bad json') } }), sleep: async () => {} })
    expect(notJson.error.code).toBe(ai.AI_ERROR.INVALID_RESPONSE)
    const empty = await ai.generate({ provider: 'openai', apiKey: 'k' }, { messages: [] }, { transport: async () => okBody('   '), sleep: async () => {} })
    expect(empty.error.code).toBe(ai.AI_ERROR.INVALID_RESPONSE)
    expect(empty.error.detail).toMatch(/empty/)
  })

  it('a safety block is reported, never returned as an empty answer', async () => {
    const transport = async () => ({ ok: true, status: 200, json: async () => ({ promptFeedback: { blockReason: 'SAFETY' } }) })
    const result = await ai.generate({ provider: 'gemini', apiKey: 'k' }, { messages: [] }, { transport, sleep: async () => {} })
    expect(result.ok).toBe(false)
    expect(result.error.code).toBe(ai.AI_ERROR.INVALID_RESPONSE)
    expect(result.error.detail).toMatch(/SAFETY/)
  })

  it('makes no request at all when the key is missing', async () => {
    const transport = vi.fn()
    const result = await ai.generate({ provider: 'openai' }, { messages: [] }, { transport })
    expect(result.error.code).toBe(ai.AI_ERROR.NO_KEY_CONFIGURED)
    expect(transport).not.toHaveBeenCalled()
  })

  it('honours cancellation', async () => {
    const controller = new AbortController()
    controller.abort()
    const result = await ai.generate({ provider: 'openai', apiKey: 'k' }, { messages: [] }, { transport: vi.fn(), signal: controller.signal })
    expect(result.error.code).toBe(ai.AI_ERROR.CANCELLED)
  })

  it('calls the real fetch by default (the default transport is not a stub)', () => {
    const source = require('node:fs').readFileSync(require('node:path').join(__dirname, '../../electron/ai-providers.cjs'), 'utf8')
    expect(source).toMatch(/transport = fetch/)
    // Scan code with comments removed: the header documents what was deleted, and
    // naming the deleted helper must not read as "the helper is still here".
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '$1')
    expect(code).not.toMatch(/\bstripSponsored\b|\bAD_LINE\b|\bmediabunny\b/)
    expect(code).not.toMatch(/pollinations\.ai/i)
  })
})

describe('AIProvider: error copy', () => {
  it('every code has a sentence a user can act on', () => {
    for (const code of Object.values(ai.AI_ERROR) as string[]) {
      const spec = ai.ERROR_SPEC[code]
      expect(spec, code).toBeTruthy()
      expect(spec.why.length, code).toBeGreaterThan(4)
      expect(spec.action.length, code).toBeGreaterThan(4)
      const message = ai.describeError({ code, detail: 'x' }, 'OpenAI')
      expect(message).toMatch(/^OpenAI: /)
      expect(message.endsWith('.')).toBe(true)
    }
  })
})
