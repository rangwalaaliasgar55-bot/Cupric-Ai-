/**
 * settings.json migration (2.29). Pure: takes the parsed object, returns the
 * migrated one plus whether anything changed. Run once at startup.
 *
 *   v1 (implicit, no field) — anything written before 0.9.1
 *   v2 — `settingsVersion` recorded; legacy key names folded into current
 *        ones; invalid enum values reset to defaults instead of crashing.
 */
const SETTINGS_VERSION = 2

function migrateSettings(input) {
  const src = input && typeof input === 'object' && !Array.isArray(input) ? input : {}
  const out = { ...src }
  const version = Number(src.settingsVersion) || 1

  if (version < 2) {
    // Early builds stored the Gemini key/model and provider under other names.
    if (!out.geminiApiKey && typeof out.apiKey === 'string' && /^AIza/.test(out.apiKey)) out.geminiApiKey = out.apiKey
    if (!out.geminiApiKey && typeof out.geminiKey === 'string') out.geminiApiKey = out.geminiKey
    if (!out.aiProvider && typeof out.provider === 'string') out.aiProvider = out.provider
    if (!out.openCodeBaseUrl && typeof out.baseUrl === 'string') out.openCodeBaseUrl = out.baseUrl
    delete out.geminiKey
    delete out.provider
    delete out.baseUrl
    if (out.apiKey && out.apiKey === out.geminiApiKey) delete out.apiKey
  }

  if (out.aiProvider !== undefined && out.aiProvider !== 'gemini' && out.aiProvider !== 'opencode') delete out.aiProvider
  if (out.hardwareEncoding !== undefined && out.hardwareEncoding !== 'auto' && out.hardwareEncoding !== 'off') out.hardwareEncoding = 'auto'
  if (out.autoLaunch !== undefined) out.autoLaunch = Boolean(out.autoLaunch)
  out.settingsVersion = SETTINGS_VERSION

  const changed = JSON.stringify(out) !== JSON.stringify(src)
  return { settings: out, changed, fromVersion: version }
}

module.exports = { migrateSettings, SETTINGS_VERSION }
