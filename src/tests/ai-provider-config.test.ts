/**
 * Provider configuration — settings + environment → an ai-providers config.
 *
 * This is the mapping the Settings screen and every IPC call depend on, so it
 * is tested as data in / data out: which key wins, what a fresh install gets,
 * that a chosen-but-unkeyed provider reports NO_KEY_CONFIGURED (rather than
 * silently using something else), and that parsing a provider's `/models`
 * reply never invents a row.
 */
import { describe, expect, it } from 'vitest'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const config = require('../../electron/ai-provider-config.cjs')
const ai = require('../../electron/ai-providers.cjs')

describe('provider config: keys and sources', () => {
  it('prefers a saved key, falls back to the environment, and names the source', () => {
    expect(config.resolveKey({ openaiApiKey: 'saved' }, 'openai', { OPENAI_API_KEY: 'env' })).toEqual({ key: 'saved', source: 'saved' })
    expect(config.resolveKey({}, 'openai', { OPENAI_API_KEY: 'env' })).toEqual({ key: 'env', source: 'environment:OPENAI_API_KEY' })
    expect(config.resolveKey({}, 'anthropic', { ANTHROPIC_API_KEY: 'a' }).key).toBe('a')
    expect(config.resolveKey({}, 'gemini', { GOOGLE_API_KEY: 'g' }).key).toBe('g')
    expect(config.resolveKey({}, 'openai', {})).toEqual({ key: '', source: 'none' })
  })

  it('a fresh install with nothing configured is the honest "none", not a guess', () => {
    const resolved = config.providerConfig({}, {})
    expect(resolved.kind).toBe('none')
    expect(resolved.error.code).toBe(ai.AI_ERROR.NO_KEY_CONFIGURED)
    expect(resolved.fix).toMatch(/Open Settings/)
  })

  it('a key in the environment is detected, and a local base URL too', () => {
    expect(config.providerConfig({}, { OPENAI_API_KEY: 'k' })).toMatchObject({ provider: 'openai', apiKey: 'k', source: 'detected-key' })
    expect(config.providerConfig({ localBaseUrl: 'http://localhost:11434/v1' }, {})).toMatchObject({ provider: 'local', source: 'detected-local' })
  })

  it('a provider the user chose but never keyed reports NO_KEY_CONFIGURED with the fix, instead of switching provider', () => {
    const resolved = config.providerConfig({ aiKind: 'anthropic' }, { OPENAI_API_KEY: 'a-key-exists-for-another-vendor' })
    expect(resolved.provider).toBe('anthropic')
    expect(resolved.error.code).toBe(ai.AI_ERROR.NO_KEY_CONFIGURED)
    expect(resolved.fix).toMatch(/Anthropic API key/)
  })

  it('a local server with no model chosen asks for the model instead of guessing one', () => {
    const resolved = config.providerConfig({ aiKind: 'local' }, {})
    expect(resolved.provider).toBe('local')
    expect(resolved.error.code).toBe(ai.AI_ERROR.BAD_REQUEST)
    expect(resolved.fix).toMatch(/model name/)
  })

  it('keeps installs that configured an OpenAI-compatible endpoint working', () => {
    const resolved = config.providerConfig({ openCodeBaseUrl: 'https://openrouter.ai/api/v1', openCodeApiKey: 'or-key', openCodeModel: 'x:free' }, {})
    expect(resolved).toMatchObject({ provider: 'openai', baseUrl: 'https://openrouter.ai/api/v1', model: 'x:free', apiKey: 'or-key', keySource: 'legacy-opencode' })
    expect(resolved.error).toBeUndefined()
    expect(resolved.label).toMatch(/OpenAI-compatible/)
  })

  it('defaults are per-vendor and only used when nothing was configured', () => {
    expect(config.providerConfig({ aiKind: 'openai', openaiApiKey: 'k' }, {})).toMatchObject({ baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' })
    expect(config.providerConfig({ aiKind: 'gemini', geminiApiKey: 'k' }, {})).toMatchObject({ baseUrl: 'https://generativelanguage.googleapis.com/v1beta', model: 'gemini-2.5-flash' })
    expect(config.providerConfig({ aiKind: 'openai', openaiApiKey: 'k', openaiModel: 'gpt-5', openaiBaseUrl: 'https://gateway.internal/v1' }, {})).toMatchObject({ model: 'gpt-5', baseUrl: 'https://gateway.internal/v1' })
  })

  it('the summary never carries key material', () => {
    const summary = config.providerSummary({ aiKind: 'openai', openaiApiKey: 'super-secret' }, {})
    expect(JSON.stringify(summary)).not.toMatch(/super-secret/)
    expect(summary.hasKey).toBe(true)
    expect(summary.candidates.find((entry: { kind: string }) => entry.kind === 'openai').keySource).toBe('saved')
  })
})

describe('provider config: model list requests', () => {
  it('builds the right list endpoint per vendor', () => {
    const openai = config.providerConfig({ aiKind: 'openai', openaiApiKey: 'sk' }, {})
    expect(config.listModelsRequest(openai)).toEqual({ url: 'https://api.openai.com/v1/models', init: { headers: { authorization: 'Bearer sk' } } })

    const anthropic = config.providerConfig({ aiKind: 'anthropic', anthropicApiKey: 'sk-ant' }, {})
    expect(config.listModelsRequest(anthropic).url).toBe('https://api.anthropic.com/v1/models?limit=100')
    expect(config.listModelsRequest(anthropic).init.headers['x-api-key']).toBe('sk-ant')

    const gemini = config.providerConfig({ aiKind: 'gemini', geminiApiKey: 'g' }, {})
    expect(config.listModelsRequest(gemini).url).toContain('/models?key=g')

    const local = config.providerConfig({ aiKind: 'local', localBaseUrl: 'http://localhost:11434/v1', localModel: 'llama3.2' }, {})
    expect(config.listModelsRequest(local)).toEqual({ url: 'http://localhost:11434/v1/models', init: { headers: {} } })
  })

  it('no request is built for a provider that has no config', () => {
    expect(config.listModelsRequest(config.providerConfig({}, {}))).toBeNull()
    expect(config.listModelsRequest(null)).toBeNull()
  })
})

describe('provider config: parsing a /models reply', () => {
  it('reads each vendor\u2019s shape and drops rows without an id', () => {
    expect(config.parseModels('openai', { data: [{ id: 'b' }, { id: 'a' }, { nope: true }] })).toEqual([{ id: 'a', label: 'a' }, { id: 'b', label: 'b' }])
    expect(config.parseModels('anthropic', { data: [{ id: 'claude-sonnet-4-5', name: 'Claude Sonnet 4.5' }] })).toEqual([{ id: 'claude-sonnet-4-5', label: 'Claude Sonnet 4.5' }])
    expect(config.parseModels('gemini', { models: [{ name: 'models/gemini-2.5-flash', displayName: 'Gemini 2.5 Flash', supportedGenerationMethods: ['generateContent'] }, { name: 'models/embed-001', supportedGenerationMethods: ['embedContent'] }] })).toEqual([{ id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash' }])
  })

  it('an unknown or empty shape yields nothing rather than fabricated models', () => {
    expect(config.parseModels('openai', null)).toEqual([])
    expect(config.parseModels('openai', { error: 'nope' })).toEqual([])
    expect(config.parseModels('gemini', { models: 'not an array' })).toEqual([])
  })
})
