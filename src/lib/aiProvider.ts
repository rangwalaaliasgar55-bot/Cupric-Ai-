/**
 * The renderer's view of the AI provider layer (Phase 1.1).
 *
 * Every call here is a thin wrapper over a real IPC handler in
 * electron/main.cjs, and every failure arrives as the typed taxonomy
 * (NO_KEY_CONFIGURED / RATE_LIMITED / NETWORK_ERROR / INVALID_RESPONSE /
 * TIMEOUT …) rather than a string the UI has to pattern-match. Nothing in this
 * file invents a provider, a model list or a success: if the main process says
 * `ok: false`, callers render `message`/`fix`.
 */
import { getIpc } from './bridge'

export type ProviderKind = 'openai' | 'anthropic' | 'gemini' | 'local'
export type ProviderErrorCode =
  | 'NO_KEY_CONFIGURED'
  | 'UNAUTHORIZED'
  | 'RATE_LIMITED'
  | 'NETWORK_ERROR'
  | 'TIMEOUT'
  | 'INVALID_RESPONSE'
  | 'MODEL_NOT_FOUND'
  | 'BAD_REQUEST'
  | 'SERVER_ERROR'
  | 'CANCELLED'

export type ProviderCandidate = {
  kind: ProviderKind
  label: string
  hasKey: boolean
  keySource: string
  needsKey: boolean
  defaultModel: string
  savedModel: string
}

export type ProviderState = {
  kind: ProviderKind | 'none'
  label: string
  baseUrl: string
  model: string
  hasKey: boolean
  keySource: string
  needsKey: boolean
  isLocal: boolean
  source: string
  error: { code: ProviderErrorCode; message: string; retryable: boolean } | null
  fix: string | null
  candidates: ProviderCandidate[]
  localPresets: { id: string; label: string; baseUrl: string; docs: string }[]
}

export type ProviderTestResult =
  | { ok: true; label: string; model: string; text: string; tookMs: number; attempts: number }
  | { ok: false; code: ProviderErrorCode; message: string; fix?: string | null; label?: string; tookMs?: number; attempts?: number }

export type ModelListResult =
  | { ok: true; provider: string; label: string; models: { id: string; label: string }[]; current: string }
  | { ok: false; code: ProviderErrorCode; message: string; fix?: string | null; models: [] }

export type LocalDetection = {
  ok: boolean
  servers: { kind: string; label: string; baseUrl: string; models: string[] }[]
  presets: ProviderState['localPresets']
  message: string
}

function requireIpc(): NonNullable<ReturnType<typeof getIpc>> {
  const ipc = getIpc()
  if (!ipc) throw new Error('Provider settings are managed by the desktop app. This build has no secure key store.')
  return ipc
}

export async function providerState(): Promise<ProviderState | null> {
  const ipc = getIpc()
  if (!ipc) return null
  return (await ipc.invoke('ai:providerState')) as ProviderState
}

export async function testProvider(input: { kind?: ProviderKind; apiKey?: string; baseUrl?: string; model?: string } = {}): Promise<ProviderTestResult> {
  return (await requireIpc().invoke('ai:testProvider', input)) as ProviderTestResult
}

export async function listModels(input: { kind?: ProviderKind; apiKey?: string; baseUrl?: string } = {}): Promise<ModelListResult> {
  return (await requireIpc().invoke('ai:listModels', input)) as ModelListResult
}

export async function detectLocalServers(): Promise<LocalDetection> {
  return (await requireIpc().invoke('ai:detectLocal')) as LocalDetection
}

/** Save the user's provider choice. Keys go to the main process, never to storage here. */
export async function saveProvider(input: { kind: ProviderKind | ''; apiKey?: string; model?: string; baseUrl?: string }): Promise<ProviderState | null> {
  const ipc = requireIpc()
  const patch: Record<string, string> = { aiKind: input.kind || '' }
  if (input.apiKey !== undefined) {
    const keyName = input.kind === 'gemini' ? 'geminiApiKey' : input.kind === 'openai' ? 'openaiApiKey' : input.kind === 'anthropic' ? 'anthropicApiKey' : ''
    if (keyName) patch[keyName] = input.apiKey
  }
  if (input.model !== undefined) {
    const modelName = input.kind === 'local' ? 'localModel' : input.kind ? `${input.kind}Model` : ''
    if (modelName) patch[modelName] = input.model
  }
  if (input.baseUrl !== undefined) {
    const baseName = input.kind === 'local' ? 'localBaseUrl' : input.kind ? `${input.kind}BaseUrl` : ''
    if (baseName) patch[baseName] = input.baseUrl
  }
  await ipc.invoke('settings:set', patch)
  return providerState()
}

/** One sentence for a failure: the provider's message plus, when we have it, the fix. */
export function providerErrorText(error: { message?: string; fix?: string | null; code?: string } | null | undefined): string {
  if (!error) return 'Something went wrong.'
  const message = error.message || `The request failed (${error.code || 'unknown'}).`
  return error.fix && !message.includes(error.fix) ? `${message} ${error.fix}` : message
}
