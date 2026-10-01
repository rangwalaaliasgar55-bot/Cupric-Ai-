/**
 * AI provider settings (Phase 1.1).
 *
 * What this replaces: a screen that asked the user to choose between "Gemini"
 * and "OpenCode", stored one key, and reported failures as a joined string of
 * whatever the providers said. What it does now:
 *
 *   - four real choices (OpenAI, Anthropic, Gemini, a local server), each with
 *     its own key field and its own saved model
 *   - a real connection test through the provider layer: the failure code and
 *     the action that fixes it are shown, and a retry button re-runs the test
 *   - a real model list from the provider's own endpoint, never a baked-in list
 *   - an honest empty state when nothing is configured, naming the fix
 *
 * Keys are write-only here: the main process never sends them back, so the
 * field shows whether one is saved and its source (saved / environment).
 */
import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, Check, ExternalLink, Loader2, RefreshCw, Save, Server, Trash2 } from 'lucide-react'
import { cx } from '../lib/utils'
import {
  detectLocalServers,
  listModels,
  providerErrorText,
  providerState,
  saveProvider,
  testProvider,
  type LocalDetection,
  type ProviderKind,
  type ProviderState,
  type ProviderTestResult,
} from '../lib/aiProvider'

type Draft = { key: string; model: string; baseUrl: string }

const KIND_BLURB: Record<ProviderKind, string> = {
  openai: 'OpenAI API key. Model names come from your account, so press Load models after saving the key.',
  anthropic: 'Anthropic API key. Claude picks up images in chat for visual questions.',
  gemini: 'Google AI Studio key. Free tier available, and the app can list your available models.',
  local: 'A model server on this machine (Ollama, LM Studio, llama.cpp, OpenCode Desktop). No key, no cost, nothing leaves the computer.',
}

export function ProviderSettings({ onChanged }: { onChanged?: () => void }) {
  const [state, setState] = useState<ProviderState | null>(null)
  const [kind, setKind] = useState<ProviderKind>('openai')
  const [draft, setDraft] = useState<Draft>({ key: '', model: '', baseUrl: '' })
  const [testing, setTesting] = useState(false)
  const [test, setTest] = useState<ProviderTestResult | null>(null)
  const [models, setModels] = useState<{ id: string; label: string }[]>([])
  const [loadingModels, setLoadingModels] = useState(false)
  const [modelError, setModelError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [locals, setLocals] = useState<LocalDetection | null>(null)
  const [detecting, setDetecting] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      const next = await providerState()
      if (!next) {
        // Browser preview: there is no main process and no secure store, so the
        // app says that instead of showing a spinner that never resolves.
        setState(null)
        setLoadError('Provider settings live in the desktop app: the browser preview has no secure place to keep a key.')
        return null
      }
      setState(next)
      setLoadError(null)
      if (next.kind !== 'none') setKind(next.kind as ProviderKind)
      return next
    } catch (error) {
      // Unreadable state is surfaced, never rendered as "not configured".
      setLoadError(error instanceof Error ? error.message : String(error))
      return null
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const candidate = state?.candidates.find((entry) => entry.kind === kind)
  const savedKey = Boolean(candidate?.hasKey)
  const savedModel = draft.model || candidate?.savedModel || (state?.kind === kind ? state.model : '') || candidate?.defaultModel || ''
  const savedBase = draft.baseUrl || (state?.kind === kind && state.isLocal ? state.baseUrl : '') || (kind === 'local' ? state?.localPresets[0]?.baseUrl || 'http://localhost:11434/v1' : '')

  async function save() {
    setNotice(null)
    setTest(null)
    try {
      const next = await saveProvider({
        kind,
        apiKey: draft.key || undefined,
        model: draft.model || undefined,
        ...(kind === 'local' ? { baseUrl: savedBase } : {}),
      })
      setState(next)
      setDraft((current) => ({ ...current, key: '' }))
      setNotice('Saved. Press Test connection to check it for real.')
      onChanged?.()
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error))
    }
  }

  async function runTest() {
    setTesting(true)
    setTest(null)
    try {
      const result = await testProvider({ kind, apiKey: draft.key || undefined, baseUrl: kind === 'local' ? savedBase : undefined, model: draft.model || undefined })
      setTest(result)
      if (result.ok) onChanged?.()
    } catch (error) {
      setTest({ ok: false, code: 'NETWORK_ERROR', message: error instanceof Error ? error.message : String(error) })
    } finally {
      setTesting(false)
    }
  }

  async function loadModels() {
    setLoadingModels(true)
    setModelError(null)
    try {
      const result = await listModels({ kind, apiKey: draft.key || undefined, baseUrl: kind === 'local' ? savedBase : undefined })
      if (result.ok) {
        setModels(result.models)
        if (!result.models.length) setModelError(`${result.label} returned no models for this key.`)
      } else {
        setModels([])
        setModelError(providerErrorText(result))
      }
    } catch (error) {
      setModels([])
      setModelError(error instanceof Error ? error.message : String(error))
    } finally {
      setLoadingModels(false)
    }
  }

  async function detect() {
    setDetecting(true)
    try {
      const result = await detectLocalServers()
      setLocals(result)
      if (result.servers.length) {
        setKind('local')
        setDraft((current) => ({ ...current, baseUrl: result.servers[0].baseUrl, model: result.servers[0].models[0] || current.model }))
      }
    } catch (error) {
      setLocals({ ok: false, servers: [], presets: [], message: error instanceof Error ? error.message : String(error) })
    } finally {
      setDetecting(false)
    }
  }

  if (loadError) {
    return (
      <div className="space-y-2 rounded-lg border border-danger/40 bg-danger/10 p-3 text-xs">
        <div className="flex items-center gap-1.5 font-medium text-danger"><AlertTriangle size={13} /> Provider settings could not be read</div>
        <p className="text-muted">{loadError}</p>
        <button type="button" onClick={() => void refresh()} className="rounded-md border border-line px-2 py-1 text-xs hover:bg-panel-alt">Try again</button>
      </div>
    )
  }

  if (!state) {
    return <div className="flex items-center gap-2 p-3 text-xs text-muted"><Loader2 size={13} className="animate-spin" /> Reading provider settings…</div>
  }

  return (
    <div className="space-y-3" aria-label="AI provider">
      {/* Current state: honest, with the fix when there is nothing configured. */}
      <div className={cx('rounded-lg border p-2.5 text-xs', state.kind === 'none' ? 'border-warn/40 bg-warn/10' : 'border-line bg-bg')}>
        <div className="flex items-center justify-between gap-2">
          <span className="font-medium">{state.label}</span>
          <span className="text-muted">{state.keySource === 'none' ? 'no key' : state.keySource.startsWith('environment') ? `key from ${state.keySource.split(':')[1]}` : 'key saved'}</span>
        </div>
        {state.kind !== 'none' ? (
          <div className="mt-1 break-all text-muted">
            {state.model || 'no model selected'}
            {state.baseUrl ? ` · ${state.baseUrl}` : ''}
          </div>
        ) : null}
        {state.error ? <p className="mt-1 text-warn">{providerErrorText({ ...state.error, fix: state.fix })}</p> : null}
      </div>

      {/* Provider choice */}
      <div className="grid grid-cols-4 gap-1" role="radiogroup" aria-label="Provider">
        {state.candidates.map((entry) => (
          <button
            key={entry.kind}
            type="button"
            role="radio"
            aria-checked={kind === entry.kind}
            onClick={() => { setKind(entry.kind); setDraft({ key: '', model: '', baseUrl: kind === entry.kind ? draft.baseUrl : '' }); setTest(null); setModels([]); setModelError(null) }}
            className={cx(
              'relative rounded-lg border px-2 py-1.5 text-xs transition-colors duration-150',
              kind === entry.kind ? 'border-accent bg-accent/10 text-text' : 'border-line bg-bg text-muted hover:bg-panel-alt',
            )}
          >
            {entry.kind === 'local' ? <Server size={12} className="mx-auto mb-0.5" /> : null}
            {entry.label}
            {entry.hasKey ? <Check size={11} className="absolute right-1 top-1 text-accent" /> : null}
          </button>
        ))}
      </div>
      <p className="text-xs text-muted">{KIND_BLURB[kind]}</p>

      {/* Local server detection */}
      {kind === 'local' ? (
        <div className="space-y-2 rounded-lg border border-line bg-bg p-2.5 text-xs">
          <div className="flex items-center justify-between gap-2">
            <span className="font-medium">Local servers</span>
            <button type="button" onClick={() => void detect()} disabled={detecting} title={detecting ? 'Looking for local model servers…' : 'Look for Ollama, LM Studio, llama.cpp and OpenCode Desktop on this machine'} className="inline-flex items-center gap-1 rounded-md border border-line px-2 py-1 hover:bg-panel-alt disabled:opacity-60">
              {detecting ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />} Detect
            </button>
          </div>
          <p className="text-muted">{locals ? locals.message : 'Detect looks for Ollama (11434), LM Studio (1234), llama.cpp (8080) and OpenCode Desktop (4096) on this machine.'}</p>
          {locals?.servers.map((server) => (
            <button
              key={server.baseUrl}
              type="button"
              onClick={() => setDraft((current) => ({ ...current, baseUrl: server.baseUrl, model: server.models[0] || current.model }))}
              className="flex w-full items-center justify-between rounded-md border border-line px-2 py-1 text-left hover:bg-panel-alt"
            >
              <span>{server.label} · {server.models[0] || 'no models'}</span>
              <span className="text-muted">{server.baseUrl}</span>
            </button>
          ))}
          <label className="block text-muted">
            Model server URL
            <input
              value={savedBase}
              onChange={(event) => setDraft((current) => ({ ...current, baseUrl: event.target.value }))}
              placeholder="http://localhost:11434/v1"
              className="mt-1 h-8 w-full rounded-lg border border-line bg-bg px-2 text-xs text-text"
            />
          </label>
        </div>
      ) : (
        <label className="block text-xs text-muted">
          {candidate?.label} API key
          <input
            type="password"
            value={draft.key}
            onChange={(event) => setDraft((current) => ({ ...current, key: event.target.value }))}
            placeholder={savedKey ? 'A key is saved — type a new one to replace it' : 'Paste your key'}
            autoComplete="off"
            spellCheck={false}
            className="mt-1 h-8 w-full rounded-lg border border-line bg-bg px-2 text-xs text-text"
          />
        </label>
      )}

      {/* Model */}
      <div className="space-y-1">
        <div className="flex items-end gap-1.5">
          <label className="block flex-1 text-xs text-muted">
            Model
            <input
              value={draft.model || savedModel}
              onChange={(event) => setDraft((current) => ({ ...current, model: event.target.value }))}
              placeholder={candidate?.defaultModel || 'model name'}
              spellCheck={false}
              className="mt-1 h-8 w-full rounded-lg border border-line bg-bg px-2 text-xs text-text"
            />
          </label>
          <button type="button" onClick={() => void loadModels()} disabled={loadingModels} title={loadingModels ? 'Asking the provider for its model list…' : 'Ask the provider for the models this key can use'} className="inline-flex h-8 items-center gap-1 rounded-lg border border-line px-2 text-xs hover:bg-panel-alt disabled:opacity-60">
            {loadingModels ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />} Load models
          </button>
        </div>
        {modelError ? <p className="text-xs text-danger">{modelError}</p> : null}
        {models.length ? (
          <div className="max-h-32 overflow-y-auto overscroll-contain rounded-lg border border-line">
            {models.map((model) => (
              <button
                key={model.id}
                type="button"
                onClick={() => setDraft((current) => ({ ...current, model: model.id }))}
                className={cx('block w-full truncate px-2 py-1 text-left text-xs hover:bg-panel-alt', (draft.model || savedModel) === model.id ? 'bg-accent/10' : '')}
                title={model.label}
              >
                {model.id}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      {/* Actions */}
      <div className="flex flex-wrap items-center gap-1.5">
        <button type="button" onClick={() => void save()} className="inline-flex items-center gap-1 rounded-lg bg-accent px-2.5 py-1.5 text-xs font-medium text-accent-ink hover:opacity-90">
          <Save size={12} /> Save
        </button>
        <button type="button" onClick={() => void runTest()} disabled={testing} title={testing ? 'Waiting for the provider to answer…' : 'Send one real request to the provider to confirm the key and model work'} className="inline-flex items-center gap-1 rounded-lg border border-line px-2.5 py-1.5 text-xs hover:bg-panel-alt disabled:opacity-60">
          {testing ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />} Test connection
        </button>
        {state.kind !== 'none' ? (
          <button
            type="button"
            onClick={() => void saveProvider({ kind: '' }).then(() => { void refresh(); onChanged?.() })}
            className="inline-flex items-center gap-1 rounded-lg border border-line px-2.5 py-1.5 text-xs text-muted hover:bg-panel-alt"
            title="Stop using this provider and go back to automatic detection"
          >
            <Trash2 size={12} /> Clear choice
          </button>
        ) : null}
        {draft.key && state.keySource.startsWith('environment') ? (
          <span className="text-xs text-muted">Your environment already has a key for this provider; saving here stores one in NewBrand.</span>
        ) : null}
      </div>

      {notice ? <p className="text-xs text-muted">{notice}</p> : null}

      {/* Test result: success, or the typed failure and its retry */}
      {test ? (
        test.ok ? (
          <div className="rounded-lg border border-accent/40 bg-accent/10 p-2.5 text-xs">
            <div className="flex items-center gap-1.5 font-medium"><Check size={13} /> {test.label} answered in {test.tookMs} ms</div>
            <p className="mt-1 text-muted">Model {test.model} replied “{test.text}”.{test.attempts > 1 ? ` Took ${test.attempts} attempts.` : ''}</p>
          </div>
        ) : (
          <div className="space-y-2 rounded-lg border border-danger/40 bg-danger/10 p-2.5 text-xs">
            <div className="flex items-center gap-1.5 font-medium text-danger"><AlertTriangle size={13} /> {test.code}</div>
            <p className="text-muted">{providerErrorText(test)}</p>
            <button type="button" onClick={() => void runTest()} className="rounded-md border border-line px-2 py-1 hover:bg-panel-alt">Retry test</button>
          </div>
        )
      ) : null}

      {/* Where to get a key / a local server — real links, opened by the OS */}
      <div className="flex flex-wrap gap-2 text-xs text-muted">
        {kind === 'openai' ? <a href="https://platform.openai.com/api-keys" target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 underline">OpenAI keys <ExternalLink size={11} /></a> : null}
        {kind === 'anthropic' ? <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 underline">Anthropic keys <ExternalLink size={11} /></a> : null}
        {kind === 'gemini' ? <a href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 underline">Google AI Studio key <ExternalLink size={11} /></a> : null}
        {kind === 'local' ? (
          <>
            <a href="https://ollama.com/download" target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 underline">Get Ollama <ExternalLink size={11} /></a>
            <a href="https://lmstudio.ai" target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 underline">Get LM Studio <ExternalLink size={11} /></a>
          </>
        ) : null}
      </div>
    </div>
  )
}

export default ProviderSettings
