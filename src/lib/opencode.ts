/**
 * Browser-side OpenCode / OpenAI-compatible client.
 *
 * The desktop build keeps keys in the Electron main process (see
 * electron/main.cjs). The web build has no secure store, so settings live in
 * localStorage and are only ever sent to the endpoint the user configured —
 * typically a local OpenCode, Ollama or LM Studio server that costs nothing.
 *
 * Chat only. Video is never generated through this path.
 */

const SETTINGS_KEY = 'cupric.opencode.settings'

export type OpenCodeSettings = {
  baseUrl: string
  apiKey: string
  model: string
}

export type OpenCodeModel = {
  id: string
  label: string
  baseUrl: string
  model: string
  note: string
  source?: string
}

/** Local, free, zero-config endpoints worth probing before anything remote. */
export const LOCAL_ENDPOINTS: { label: string; baseUrl: string }[] = [
  { label: 'OpenCode server', baseUrl: 'http://localhost:4096/v1' },
  { label: 'Ollama', baseUrl: 'http://localhost:11434/v1' },
  { label: 'LM Studio', baseUrl: 'http://localhost:1234/v1' },
  { label: 'llama.cpp', baseUrl: 'http://127.0.0.1:8080/v1' },
]

export const DEFAULT_SETTINGS: OpenCodeSettings = {
  baseUrl: 'http://localhost:4096/v1',
  apiKey: '',
  model: '',
}

export function loadSettings(): OpenCodeSettings {
  try {
    const raw = window.localStorage.getItem(SETTINGS_KEY)
    if (!raw) return { ...DEFAULT_SETTINGS }
    const parsed = JSON.parse(raw) as Partial<OpenCodeSettings>
    return {
      baseUrl: String(parsed.baseUrl || DEFAULT_SETTINGS.baseUrl),
      apiKey: String(parsed.apiKey || ''),
      model: String(parsed.model || ''),
    }
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

export function saveSettings(settings: OpenCodeSettings): OpenCodeSettings {
  const clean: OpenCodeSettings = {
    baseUrl: settings.baseUrl.trim().replace(/\/$/, ''),
    apiKey: settings.apiKey.trim(),
    model: settings.model.trim(),
  }
  window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(clean))
  return clean
}

export function isConfigured(settings = loadSettings()): boolean {
  return Boolean(settings.baseUrl && settings.model)
}

function headers(settings: OpenCodeSettings): Record<string, string> {
  const out: Record<string, string> = { 'Content-Type': 'application/json' }
  if (settings.apiKey) out.Authorization = `Bearer ${settings.apiKey}`
  if (/openrouter\.ai/i.test(settings.baseUrl)) {
    out['HTTP-Referer'] = 'https://cupric.ai'
    out['X-Title'] = 'Cupric AI'
  }
  return out
}

/** List models from an OpenAI-compatible `/models` endpoint. */
export async function listModels(baseUrl: string, apiKey = ''): Promise<OpenCodeModel[]> {
  const root = baseUrl.trim().replace(/\/$/, '')
  if (!root) throw new Error('Set a base URL first.')
  const response = await fetch(`${root}/models`, { headers: headers({ baseUrl: root, apiKey, model: '' }) })
  if (!response.ok) throw new Error(`${response.status} ${response.statusText || 'request failed'}`)
  const data = await response.json()
  const raw: unknown[] = Array.isArray(data?.data) ? data.data : Array.isArray(data?.models) ? data.models : []
  const mapped: (OpenCodeModel | null)[] = raw.map((entry) => {
      const item = entry as { id?: string; name?: string; description?: string }
      const id = String(item.id || item.name || '')
      if (!id) return null
      return {
        id: `live-${root}-${id}`,
        label: String(item.name || id),
        baseUrl: root,
        model: id,
        note: item.description ? String(item.description).slice(0, 90) : 'Discovered from this endpoint.',
        source: 'live',
      }
  })
  return mapped.filter((m): m is OpenCodeModel => m !== null)
}

/** Probe the usual local servers and return every model they expose. */
export async function discoverLocalModels(): Promise<OpenCodeModel[]> {
  const results = await Promise.allSettled(
    LOCAL_ENDPOINTS.map(async (endpoint) => {
      const models = await listModels(endpoint.baseUrl)
      return models.map((model) => ({ ...model, note: `${endpoint.label} · local and free`, source: endpoint.label }))
    }),
  )
  return results.flatMap((result) => (result.status === 'fulfilled' ? result.value : []))
}

export type ChatContentPart = { type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }
export type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string | ChatContentPart[] }

/** One non-streaming completion. Throws with a readable message on failure. */
export async function chat(messages: ChatMessage[], settings = loadSettings()): Promise<string> {
  if (!isConfigured(settings)) throw new Error('No model configured.')
  const response = await fetch(`${settings.baseUrl.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: headers(settings),
    body: JSON.stringify({ model: settings.model, messages, temperature: 0.7, stream: false }),
  })
  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    throw new Error(`${response.status} ${response.statusText}${detail ? ` — ${detail.slice(0, 160)}` : ''}`)
  }
  const data = await response.json()
  const text =
    data?.choices?.[0]?.message?.content ??
    data?.choices?.[0]?.text ??
    data?.message?.content ??
    ''
  const flat = Array.isArray(text) ? text.map((part: { text?: string }) => part?.text ?? '').join('') : String(text)
  if (!flat.trim()) throw new Error('The model returned an empty reply.')
  return flat.trim()
}
