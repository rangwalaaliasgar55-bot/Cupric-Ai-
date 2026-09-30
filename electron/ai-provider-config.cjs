/**
 * Provider configuration — settings + environment → an `ai-providers` config.
 *
 * Kept apart from main.cjs so the mapping is unit-testable: which key wins,
 * which model a fresh install gets, what the Settings screen is told, and what
 * a provider's `/models` reply looks like once parsed.
 *
 * Deliberately conservative:
 *   - a key is only ever taken from the settings file or an environment
 *     variable the user set. No baked-in keys, no shared keys, no third-party
 *     proxy ("free tier") services.
 *   - nothing here decides to fall back to a different vendor. Deciding that a
 *     call has no provider is `providerConfig()` returning a typed error, which
 *     the callers surface.
 */
const { AI_ERROR, makeError, PROVIDERS } = require('./ai-providers.cjs')

/** Env vars a user might already have set for each provider. */
const ENV_KEYS = Object.freeze({
  openai: ['OPENAI_API_KEY'],
  anthropic: ['ANTHROPIC_API_KEY'],
  gemini: ['GEMINI_API_KEY', 'GOOGLE_API_KEY', 'GOOGLE_GENERATIVE_AI_API_KEY'],
  local: [],
})

const ENV_BASE = Object.freeze({ openai: 'OPENAI_BASE_URL', anthropic: 'ANTHROPIC_BASE_URL', gemini: 'GEMINI_BASE_URL', local: 'CUPRIC_LOCAL_AI_URL' })
const ENV_MODEL = Object.freeze({ openai: 'OPENAI_MODEL', anthropic: 'ANTHROPIC_MODEL', gemini: 'GEMINI_MODEL', local: 'CUPRIC_LOCAL_AI_MODEL' })

const LOCAL_PRESETS = Object.freeze([
  { id: 'ollama', label: 'Ollama', baseUrl: 'http://localhost:11434/v1', docs: 'https://ollama.com/download' },
  { id: 'lmstudio', label: 'LM Studio', baseUrl: 'http://localhost:1234/v1', docs: 'https://lmstudio.ai' },
  { id: 'llamacpp', label: 'llama.cpp server', baseUrl: 'http://localhost:8080/v1', docs: 'https://github.com/ggml-org/llama.cpp' },
  { id: 'opencode', label: 'OpenCode Desktop', baseUrl: 'http://localhost:4096/v1', docs: 'https://opencode.ai' },
])

const DEFAULT_MODELS = Object.freeze({ openai: 'gpt-4o-mini', anthropic: 'claude-sonnet-4-5', gemini: 'gemini-2.5-flash', local: '' })

const SETTING_KEYS = Object.freeze({
  openai: { key: 'openaiApiKey', base: 'openaiBaseUrl', model: 'openaiModel' },
  anthropic: { key: 'anthropicApiKey', base: 'anthropicBaseUrl', model: 'anthropicModel' },
  // The Gemini key has lived under `geminiApiKey` since the first release; that
  // name stays, so existing installs keep working without a migration step.
  gemini: { key: 'geminiApiKey', base: 'geminiBaseUrl', model: 'geminiModel' },
  local: { key: '', base: 'localBaseUrl', model: 'localModel' },
})

const KNOWN_KINDS = Object.freeze(['local', 'openai', 'anthropic', 'gemini'])

const isLocalBase = (baseUrl = '') => /localhost|127\.0\.0\.1|\[::1\]/i.test(String(baseUrl))
const trimUrl = (url = '') => String(url).replace(/\/+$/, '')

/** Where a key came from, so the UI can say "from your environment" honestly. */
function resolveKey(settings = {}, kind, env = process.env) {
  const names = ENV_KEYS[kind] || []
  const savedName = SETTING_KEYS[kind]?.key
  const saved = savedName ? String(settings[savedName] || '').trim() : ''
  if (saved) return { key: saved, source: 'saved' }
  for (const name of names) {
    const value = String(env[name] || '').trim()
    if (value) return { key: value, source: `environment:${name}` }
  }
  return { key: '', source: 'none' }
}

/**
 * `aiKind` in settings is the user's explicit choice. When it is missing we
 * derive one: a saved/env key wins over a local server, and if neither exists
 * the answer is the honest `none`.
 */
function chosenKind(settings = {}, env = process.env) {
  const explicit = String(settings.aiKind || '').trim()
  if (KNOWN_KINDS.includes(explicit)) {
    const key = resolveKey(settings, explicit, env)
    // A local kind needs no key; a remote kind the user chose but never keyed is
    // reported as chosen-without-key (NO_KEY_CONFIGURED), not silently replaced.
    return { kind: explicit, source: 'user' }
  }
  for (const kind of ['openai', 'anthropic', 'gemini']) {
    if (resolveKey(settings, kind, env).key) return { kind, source: 'detected-key' }
  }
  const localBase = String(settings.localBaseUrl || env[ENV_BASE.local] || '').trim()
  if (localBase) return { kind: 'local', source: 'detected-local' }
  if (settings.aiMode === 'ollama' || settings.aiMode === 'lmstudio') return { kind: 'local', source: 'aiMode' }
  // Installations that configured an OpenAI-compatible endpoint through the
  // OpenCode-style settings (OpenRouter, Zen, a self-hosted gateway) keep
  // working: their key + base + model are adopted as-is rather than discarded.
  const legacyBase = String(settings.openCodeBaseUrl || '').trim()
  const legacyKey = String(settings.openCodeApiKey || env.OPENCODE_API_KEY || env.OPENROUTER_API_KEY || '').trim()
  if (legacyBase && !isLocalBase(legacyBase) && legacyKey) return { kind: 'openai', source: 'legacy-opencode' }
  return { kind: 'none', source: 'none' }
}

/** Everything a request needs, or a typed error. This is the single mapping. */
function providerConfig(settings = {}, env = process.env) {
  const chosen = chosenKind(settings, env)
  if (chosen.kind === 'none') {
    return {
      kind: 'none',
      provider: 'none',
      source: chosen.source,
      error: makeError(AI_ERROR.NO_KEY_CONFIGURED, {
        detail: 'no provider is configured and no local model server is running',
        provider: 'Cupric AI',
      }),
      fix: 'Open Settings → AI and add a key (OpenAI, Anthropic or Gemini) or start a local model server (Ollama / LM Studio).',
    }
  }
  const kind = chosen.kind
  const preset = PROVIDERS[kind]
  const keys = SETTING_KEYS[kind] || {}
  const savedBase = keys.base ? String(settings[keys.base] || '').trim() : ''
  const envBase = String(env[ENV_BASE[kind]] || '').trim()
  const savedModel = keys.model ? String(settings[keys.model] || '').trim() : ''
  const envModel = String(env[ENV_MODEL[kind]] || '').trim()
  let { key: apiKey, source: keySource } = resolveKey(settings, kind, env)

  // Legacy compatibility: the OpenCode-style settings pair feeds whichever kind
  // it describes — a local server or a configured OpenAI-compatible endpoint.
  const legacyLocalBase = !savedBase && !envBase && isLocalBase(settings.openCodeBaseUrl) ? String(settings.openCodeBaseUrl).trim() : ''
  const legacyLocalModel = !savedModel && !envModel && isLocalBase(settings.openCodeBaseUrl) ? String(settings.openCodeModel || '').trim() : ''
  const legacyRemote = chosen.source === 'legacy-opencode'
  const legacyRemoteBase = legacyRemote && !savedBase && !envBase ? String(settings.openCodeBaseUrl).trim() : ''
  const legacyRemoteModel = legacyRemote && !savedModel && !envModel ? String(settings.openCodeModel || '').trim() : ''
  if (legacyRemote && !apiKey) {
    apiKey = String(settings.openCodeApiKey || env.OPENCODE_API_KEY || env.OPENROUTER_API_KEY || '').trim()
    keySource = 'legacy-opencode'
  }

  const baseUrl = trimUrl(savedBase || envBase || legacyLocalBase || legacyRemoteBase || preset.defaultBaseUrl)
  const model = (savedModel || envModel || legacyLocalModel || legacyRemoteModel || DEFAULT_MODELS[kind] || '').trim()
  const label = legacyRemote ? 'OpenAI-compatible endpoint (from your saved settings)' : preset.label

  const config = { provider: kind, baseUrl, model, apiKey, label, keySource, source: chosen.source }
  if (preset.needsKey && !apiKey) {
    return {
      ...config,
      error: makeError(AI_ERROR.NO_KEY_CONFIGURED, { provider: label, model }),
      fix: `Add your ${label} API key in Settings → AI.`,
    }
  }
  if (!model) {
    return {
      ...config,
      error: makeError(AI_ERROR.BAD_REQUEST, { provider: label, detail: 'no model selected' }),
      fix: `Type the model name your local server is serving (Settings → AI), or press Detect to list them.`,
    }
  }
  return config
}

/** The `/models` request for a provider — real endpoint per vendor, or null. */
function listModelsRequest(config) {
  if (!config || config.error) return null
  if (config.provider === 'anthropic') {
    return { url: `${trimUrl(config.baseUrl)}/models?limit=100`, init: { headers: { 'x-api-key': config.apiKey, 'anthropic-version': '2023-06-01' } } }
  }
  if (config.provider === 'gemini') {
    return { url: `${trimUrl(config.baseUrl)}/models?key=${encodeURIComponent(config.apiKey)}`, init: { headers: {} } }
  }
  const headers = config.apiKey ? { authorization: `Bearer ${config.apiKey}` } : {}
  return { url: `${trimUrl(config.baseUrl)}/models`, init: { headers } }
}

/** Provider-specific `/models` replies → `[{ id, label }]`. Never invents rows. */
function parseModels(provider, data) {
  if (!data) return []
  const rows = provider === 'gemini' ? data.models : data.data || data.models
  if (!Array.isArray(rows)) return []
  return rows
    .map((row) => {
      const id = String(row?.id || row?.name || '').replace(/^models\//, '').trim()
      if (!id) return null
      if (provider === 'gemini') {
        const methods = row?.supportedGenerationMethods || []
        if (methods.length && !methods.includes('generateContent')) return null
        return { id, label: String(row?.displayName || row?.description || id).slice(0, 80) }
      }
      return { id, label: String(row?.name && row.name !== id ? row.name : id).slice(0, 80) }
    })
    .filter(Boolean)
    .sort((a, b) => a.id.localeCompare(b.id))
}

/** What Settings needs to render the AI section. No key material. */
function providerSummary(settings = {}, env = process.env) {
  const config = providerConfig(settings, env)
  return {
    kind: config.kind,
    label: config.label || (config.kind === 'none' ? 'No AI provider configured' : PROVIDERS[config.kind].label),
    baseUrl: config.baseUrl || '',
    model: config.model || '',
    hasKey: Boolean(config.apiKey),
    keySource: config.keySource || 'none',
    needsKey: Boolean(PROVIDERS[config.kind]?.needsKey),
    isLocal: isLocalBase(config.baseUrl || ''),
    source: config.source || 'none',
    error: config.error ? { code: config.error.code, message: config.error.message, retryable: config.error.retryable } : null,
    fix: config.fix || null,
    candidates: KNOWN_KINDS.map((kind) => {
      const { key, source } = resolveKey(settings, kind, env)
      return { kind, label: PROVIDERS[kind].label, hasKey: Boolean(key), keySource: key ? source : 'none', needsKey: PROVIDERS[kind].needsKey, defaultModel: DEFAULT_MODELS[kind], savedModel: (SETTING_KEYS[kind]?.model ? settings[SETTING_KEYS[kind].model] : '') || '' }
    }),
  }
}

module.exports = {
  ENV_KEYS, ENV_BASE, ENV_MODEL, LOCAL_PRESETS, DEFAULT_MODELS, SETTING_KEYS, KNOWN_KINDS,
  isLocalBase, resolveKey, chosenKind, providerConfig, listModelsRequest, parseModels, providerSummary,
}
