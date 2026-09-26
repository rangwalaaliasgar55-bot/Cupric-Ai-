import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Send, Sparkles, X, Settings } from 'lucide-react'
import { askGeminiChat } from '../lib/gemini'
import { useActiveProject, useProjectStore } from '../state/useProjectStore'
import { cx } from '../lib/utils'

type ChatMsg = { role: 'user' | 'ai'; text: string }

type AiProvider = 'gemini' | 'opencode'

const CHIPS = ['Suggest a 12s bumper', 'How does the Arena flow work?', 'Tighten my captions']

type OpenCodePreset = { id: string; label: string; baseUrl: string; model: string; note: string; source?: string }

const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1'

const FREE_OPENCODE_PRESETS: OpenCodePreset[] = [
  { id: 'openrouter-qwen3-235b', label: 'Qwen 3 235B free', baseUrl: OPENROUTER_BASE_URL, model: 'qwen/qwen3-235b-a22b:free', note: 'Large Qwen free-tier model for briefs and chat.' },
  { id: 'openrouter-qwen3-30b', label: 'Qwen 3 30B free', baseUrl: OPENROUTER_BASE_URL, model: 'qwen/qwen3-30b-a3b:free', note: 'Fast Qwen free-tier model.' },
  { id: 'openrouter-qwen-coder', label: 'Qwen coder free', baseUrl: OPENROUTER_BASE_URL, model: 'qwen/qwen-2.5-coder-32b-instruct:free', note: 'Good for HTML/CSS/JS Arena code prompts.' },
  { id: 'openrouter-deepseek-v3', label: 'DeepSeek V3 free', baseUrl: OPENROUTER_BASE_URL, model: 'deepseek/deepseek-chat-v3-0324:free', note: 'Strong default for chat and JSON rundowns.' },
  { id: 'openrouter-deepseek-r1', label: 'DeepSeek R1 free', baseUrl: OPENROUTER_BASE_URL, model: 'deepseek/deepseek-r1:free', note: 'Reasoning-focused free-tier model.' },
  { id: 'openrouter-deepseek-r1-0528', label: 'DeepSeek R1 0528 free', baseUrl: OPENROUTER_BASE_URL, model: 'deepseek/deepseek-r1-0528:free', note: 'Newer R1 free-tier preset when available.' },
  { id: 'openrouter-gemma-27b', label: 'Gemma 3 27B free', baseUrl: OPENROUTER_BASE_URL, model: 'google/gemma-3-27b-it:free', note: 'Lightweight free model for quick chat.' },
  { id: 'openrouter-gemma-12b', label: 'Gemma 3 12B free', baseUrl: OPENROUTER_BASE_URL, model: 'google/gemma-3-12b-it:free', note: 'Smaller Gemma free-tier preset.' },
  { id: 'openrouter-llama-33', label: 'Llama 3.3 70B free', baseUrl: OPENROUTER_BASE_URL, model: 'meta-llama/llama-3.3-70b-instruct:free', note: 'Meta Llama free-tier preset when available.' },
  { id: 'openrouter-llama-32', label: 'Llama 3.2 3B free', baseUrl: OPENROUTER_BASE_URL, model: 'meta-llama/llama-3.2-3b-instruct:free', note: 'Small/fast free-tier preset.' },
  { id: 'openrouter-mistral-small', label: 'Mistral Small free', baseUrl: OPENROUTER_BASE_URL, model: 'mistralai/mistral-small-3.1-24b-instruct:free', note: 'Mistral free-tier preset for concise chat.' },
  { id: 'openrouter-kimi', label: 'Kimi free', baseUrl: OPENROUTER_BASE_URL, model: 'moonshotai/kimi-k2:free', note: 'Kimi free-tier preset when available.' },
  { id: 'openrouter-glm', label: 'GLM free', baseUrl: OPENROUTER_BASE_URL, model: 'z-ai/glm-4.5-air:free', note: 'GLM free-tier preset when available.' },
  { id: 'openrouter-mai', label: 'MAI DS R1 free', baseUrl: OPENROUTER_BASE_URL, model: 'microsoft/mai-ds-r1:free', note: 'Microsoft free-tier reasoning preset when available.' },
  { id: 'local-ollama-qwen-coder', label: 'Local Ollama coder', baseUrl: 'http://localhost:11434/v1', model: 'qwen2.5-coder:7b', note: 'Completely free local model if Ollama is running and the model is installed.' },
  { id: 'local-ollama-llama', label: 'Local Ollama Llama', baseUrl: 'http://localhost:11434/v1', model: 'llama3.2:3b', note: 'Small completely local/free Ollama preset.' },
  { id: 'local-lmstudio', label: 'Local LM Studio', baseUrl: 'http://localhost:1234/v1', model: 'local-model', note: 'Use with LM Studio local server; click Load live list after the server is running.' },
  { id: 'local-atomic-chat', label: 'Local Atomic Chat', baseUrl: 'http://127.0.0.1:1337/v1', model: 'local-model', note: 'OpenCode-compatible local desktop endpoint; click Load live list for exact models.' },
  { id: 'local-llamacpp', label: 'Local llama.cpp', baseUrl: 'http://127.0.0.1:8080/v1', model: 'local-model', note: 'OpenAI-compatible llama.cpp server preset.' },
]

/** Live model slide-over — Gemini or OpenCode/OpenAI-compatible, never fake chat. */
export function AskPanel() {
  const open = useProjectStore((s) => s.askOpen)
  const setAskOpen = useProjectStore((s) => s.setAskOpen)
  const view = useProjectStore((s) => s.view)
  const active = useActiveProject()

  const [msgs, setMsgs] = useState<ChatMsg[]>([
    {
      role: 'ai',
      text: "Hey — I'm Cupric AI. Live chat uses Gemini or an OpenCode/OpenAI-compatible model configured in settings. Video creation does not need chat; use Brief → Create video file.",
    },
  ])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [apiKey, setApiKey] = useState('')
  const [geminiModel, setGeminiModel] = useState('gemini-3.8-flash')
  const [openCodeKey, setOpenCodeKey] = useState('')
  const [openCodeBaseUrl, setOpenCodeBaseUrl] = useState('https://openrouter.ai/api/v1')
  const [openCodeModel, setOpenCodeModel] = useState('qwen/qwen3-235b-a22b:free')
  const [aiProvider, setAiProvider] = useState<AiProvider>('opencode')
  const [hasKey, setHasKey] = useState(false)
  const [hasGeminiKey, setHasGeminiKey] = useState(false)
  const [hasOpenCodeKey, setHasOpenCodeKey] = useState(false)
  const [autoLaunch, setAutoLaunch] = useState(false)
  const [updateStatus, setUpdateStatus] = useState('')
  const [mediaReady, setMediaReady] = useState<boolean | null>(null)
  const [freeModels, setFreeModels] = useState<OpenCodePreset[]>(FREE_OPENCODE_PRESETS)
  const [modelSearch, setModelSearch] = useState('')
  const [modelLoadStatus, setModelLoadStatus] = useState('')

  useEffect(() => {
    const ipc = (window as any).cupric?.ipc || (window as any).northframe?.ipc
    if (!ipc) return
    ipc.invoke('settings:get').then((settings: { hasKey?: boolean; hasGeminiKey?: boolean; hasOpenCodeKey?: boolean; aiProvider?: AiProvider; geminiModel?: string; openCodeBaseUrl?: string; openCodeModel?: string; autoLaunch?: boolean }) => {
      setHasKey(Boolean(settings?.hasKey))
      setHasGeminiKey(Boolean(settings?.hasGeminiKey))
      setHasOpenCodeKey(Boolean(settings?.hasOpenCodeKey))
      if (settings?.aiProvider) setAiProvider(settings.aiProvider)
      if (settings?.geminiModel) setGeminiModel(settings.geminiModel)
      if (settings?.openCodeBaseUrl) setOpenCodeBaseUrl(settings.openCodeBaseUrl)
      if (settings?.openCodeModel) setOpenCodeModel(settings.openCodeModel)
      setAutoLaunch(Boolean(settings?.autoLaunch))
    })
    ipc.invoke('media:status').then((status: { ready?: boolean }) => setMediaReady(Boolean(status?.ready))).catch(() => setMediaReady(false))
    if (typeof ipc.on === 'function') {
      return ipc.on('updater:status', (event: { status?: string; version?: string; message?: string }) => {
        setUpdateStatus(event?.version ? `${event.status} ${event.version}` : event?.message || event?.status || '')
      })
    }
  }, [])

  const shownFreeModels = freeModels.filter((preset) => {
    const q = modelSearch.trim().toLowerCase()
    if (!q) return true
    return `${preset.label} ${preset.model} ${preset.note}`.toLowerCase().includes(q)
  })

  function useOpenCodePreset(preset: OpenCodePreset) {
    setAiProvider('opencode')
    setOpenCodeBaseUrl(preset.baseUrl)
    setOpenCodeModel(preset.model)
  }

  async function loadOpenCodeDesktopModels() {
    setModelLoadStatus('reading OpenCode Desktop config')
    try {
      const ipc = (window as any).cupric?.ipc || (window as any).northframe?.ipc
      if (!ipc) throw new Error('OpenCode Desktop import is available in the desktop app')
      const models: OpenCodePreset[] = await ipc.invoke('opencode:discoverModels')
      const merged = [...models, ...freeModels]
      const seen = new Set<string>()
      setFreeModels(merged.filter((model) => (seen.has(`${model.baseUrl}|${model.model}`) ? false : (seen.add(`${model.baseUrl}|${model.model}`), true))))
      setModelLoadStatus(models.length ? `${models.length} OpenCode Desktop model${models.length === 1 ? '' : 's'} loaded` : 'No OpenCode Desktop models found yet')
    } catch (err) {
      setModelLoadStatus(err instanceof Error ? err.message : 'Could not read OpenCode Desktop models')
    }
  }

  async function loadFreeOpenCodeModels() {
    setModelLoadStatus('loading')
    try {
      const ipc = (window as any).cupric?.ipc || (window as any).northframe?.ipc
      let models: OpenCodePreset[] = []
      if (ipc) {
        models = await ipc.invoke('opencode:listModels', { baseUrl: openCodeBaseUrl, apiKey: openCodeKey })
      } else {
        const res = await fetch(`${openCodeBaseUrl.replace(/\/$/, '')}/models`)
        const data = await res.json()
        models = (data?.data ?? [])
          .filter((model: any) => String(model?.id || '').includes(':free'))
          .map((model: any) => ({ id: `live-${model.id}`, label: String(model.name || model.id).replace(/\s*\(free\)/i, ''), baseUrl: openCodeBaseUrl, model: model.id, note: 'Live free model discovered from the configured model endpoint.' }))
      }
      const merged = [...models, ...FREE_OPENCODE_PRESETS]
      const seen = new Set<string>()
      setFreeModels(merged.filter((model) => {
        const key = `${model.baseUrl}|${model.model}`
        return seen.has(key) ? false : (seen.add(key), true)
      }))
      setModelLoadStatus(`${models.length} free models loaded`)
    } catch (err) {
      setModelLoadStatus(err instanceof Error ? err.message : 'Could not load free models')
    }
  }

  async function saveAiSettings() {
    const ipc = (window as any).cupric?.ipc || (window as any).northframe?.ipc
    if (!ipc) return
    const patch: Record<string, string> = {
      aiProvider,
      geminiModel,
      openCodeBaseUrl,
      openCodeModel,
    }
    if (apiKey.trim()) patch.geminiApiKey = apiKey.trim()
    if (openCodeKey.trim()) patch.openCodeApiKey = openCodeKey.trim()
    const result = await ipc.invoke('settings:set', patch)
    setHasKey(Boolean(result?.hasKey))
    setHasGeminiKey(Boolean(result?.hasGeminiKey))
    setHasOpenCodeKey(Boolean(result?.hasOpenCodeKey))
    setApiKey('')
    setOpenCodeKey('')
  }

  async function toggleAutoLaunch(next: boolean) {
    const ipc = (window as any).cupric?.ipc || (window as any).northframe?.ipc
    if (!ipc) return
    const result = await ipc.invoke('settings:set', { autoLaunch: next })
    setAutoLaunch(Boolean(result?.autoLaunch))
  }

  async function checkForUpdates() {
    const ipc = (window as any).cupric?.ipc || (window as any).northframe?.ipc
    if (!ipc) return
    setUpdateStatus('checking')
    const result = await ipc.invoke('updater:check')
    setUpdateStatus(result?.message || result?.status || 'checking')
  }

  async function send(textArg?: string) {
    const text = (textArg ?? input).trim()
    if (!text || busy) return
    setInput('')
    setMsgs((m) => [...m, { role: 'user', text }])
    setBusy(true)
    const reply = await askGeminiChat(text, { projectName: active?.name ?? null, view })
    setMsgs((m) => [...m, { role: 'ai', text: reply }])
    setBusy(false)
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.aside
          key="ask-panel"
          aria-label="Ask Cupric AI"
          initial={{ x: 48, opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          exit={{ x: 48, opacity: 0 }}
          transition={{ type: 'spring', stiffness: 400, damping: 36 }}
          className="fixed inset-y-0 right-0 z-40 flex w-[360px] flex-col border-l border-line bg-panel"
        >
          <div className="flex items-center gap-2.5 border-b border-line px-4 py-3">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-accent text-accent-ink">
              <Sparkles size={14} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 text-sm font-semibold">Ask Cupric AI <span className="rounded-full border border-line px-1.5 py-0.5 text-[10px] text-muted">{hasKey ? 'LIVE' : 'SETUP'}</span></div>
              <div className="text-xs text-muted">{hasKey ? (aiProvider === 'opencode' ? `OpenCode · ${openCodeModel}` : `Gemini · ${geminiModel}`) : 'Connect Gemini or OpenCode model'}</div>
            </div>
            <button type="button" aria-label="AI settings" onClick={() => setShowSettings((v) => !v)} className="flex h-8 w-8 items-center justify-center rounded-lg text-muted hover:bg-panel-alt hover:text-text"><Settings size={15}/></button>
            <button
              type="button"
              aria-label="Close panel"
              onClick={() => setAskOpen(false)}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-muted transition-colors duration-150 hover:bg-panel-alt hover:text-text active:scale-[0.96]"
            >
              <X size={16} />
            </button>
          </div>

          {showSettings && (
            <div className="space-y-3 border-b border-line bg-panel-alt p-3">
              <form
                className="space-y-2"
                onSubmit={(e) => {
                  e.preventDefault()
                  saveAiSettings()
                }}
              >
                <label className="block text-xs text-muted">
                  Live AI provider
                  <select
                    value={aiProvider}
                    onChange={(e) => setAiProvider(e.target.value as AiProvider)}
                    className="mt-1 h-8 w-full rounded-lg border border-line bg-bg px-2 text-xs text-text"
                  >
                    <option value="gemini">Gemini</option>
                    <option value="opencode">OpenCode / OpenAI compatible</option>
                  </select>
                </label>
                <label className="block text-xs text-muted">
                  Gemini API key <span className={hasGeminiKey ? 'text-accent-text' : 'text-muted'}>{hasGeminiKey ? 'saved' : 'not saved'}</span>
                  <input
                    type="password"
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    placeholder="Paste Gemini key — blank keeps saved key"
                    className="mt-1 h-8 w-full rounded-lg border border-line bg-bg px-2 text-xs"
                  />
                </label>
                <label className="block text-xs text-muted">
                  Gemini model
                  <input
                    value={geminiModel}
                    onChange={(e) => setGeminiModel(e.target.value)}
                    placeholder="gemini-3.8-flash"
                    className="mt-1 h-8 w-full rounded-lg border border-line bg-bg px-2 text-xs"
                  />
                </label>
                <div className="rounded-lg border border-line bg-bg/40 p-2">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <div className="text-xs font-semibold text-muted">OpenCode models</div>
                    <div className="flex gap-1">
                      <button type="button" onClick={loadOpenCodeDesktopModels} className="rounded-md border border-line bg-panel px-2 py-1 text-xs text-muted hover:text-text">
                        Load OpenCode
                      </button>
                      <button type="button" onClick={loadFreeOpenCodeModels} className="rounded-md border border-line bg-panel px-2 py-1 text-xs text-muted hover:text-text">
                        Load live list
                      </button>
                    </div>
                  </div>
                  <input
                    value={modelSearch}
                    onChange={(e) => setModelSearch(e.target.value)}
                    placeholder="Search free models…"
                    className="mb-2 h-8 w-full rounded-lg border border-line bg-panel px-2 text-xs"
                  />
                  <div className="max-h-52 overflow-y-auto pr-1">
                    <div className="grid grid-cols-2 gap-1.5">
                      {shownFreeModels.map((preset) => (
                        <button
                          key={`${preset.id}-${preset.model}`}
                          type="button"
                          onClick={() => useOpenCodePreset(preset)}
                          className={cx(
                            'rounded-lg border px-2 py-1.5 text-left text-xs transition-colors duration-150 hover:border-accent/50 hover:text-text',
                            aiProvider === 'opencode' && openCodeModel === preset.model
                              ? 'border-accent/60 bg-accent/10 text-accent-text'
                              : 'border-line bg-panel text-muted',
                          )}
                          title={preset.note}
                        >
                          <span className="block font-medium">{preset.label}</span>
                          <span className="block truncate font-mono text-[10px] text-muted">{preset.model}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                  <p className="mt-2 text-xs leading-relaxed text-muted">
                    {modelLoadStatus || `${freeModels.length} presets included. Load OpenCode reads your desktop OpenCode providers without exposing keys to the UI; OpenRouter “:free” models still need a free key.`}
                  </p>
                </div>
                <label className="block text-xs text-muted">
                  OpenCode base URL
                  <input
                    value={openCodeBaseUrl}
                    onChange={(e) => setOpenCodeBaseUrl(e.target.value)}
                    placeholder="https://openrouter.ai/api/v1 or http://localhost:11434/v1"
                    className="mt-1 h-8 w-full rounded-lg border border-line bg-bg px-2 text-xs"
                  />
                </label>
                <label className="block text-xs text-muted">
                  OpenCode model
                  <input
                    value={openCodeModel}
                    onChange={(e) => setOpenCodeModel(e.target.value)}
                    placeholder="qwen/qwen3-235b-a22b:free"
                    className="mt-1 h-8 w-full rounded-lg border border-line bg-bg px-2 text-xs"
                  />
                </label>
                <label className="block text-xs text-muted">
                  OpenCode API key <span className={hasOpenCodeKey ? 'text-accent-text' : 'text-muted'}>{hasOpenCodeKey ? 'saved / imported / local model' : 'not saved'}</span>
                  <input
                    type="password"
                    value={openCodeKey}
                    onChange={(e) => setOpenCodeKey(e.target.value)}
                    placeholder="OpenRouter/OpenAI key — blank keeps saved/OpenCode/local"
                    className="mt-1 h-8 w-full rounded-lg border border-line bg-bg px-2 text-xs"
                  />
                </label>
                <button type="submit" className="w-full rounded-lg bg-accent px-3 py-2 text-xs font-semibold text-accent-ink">
                  Save live AI settings
                </button>
              </form>
              <div className="rounded-lg border border-line bg-bg/40 px-3 py-2 text-xs text-muted">
                Media engine: <span className={mediaReady ? 'text-accent-text' : 'text-danger'}>{mediaReady === null ? 'checking' : mediaReady ? 'ready' : 'FFmpeg missing'}</span>
              </div>
              <label className="flex items-center justify-between gap-3 rounded-lg border border-line bg-bg/40 px-3 py-2 text-xs text-muted">
                <span>Open Cupric AI on login</span>
                <input type="checkbox" checked={autoLaunch} onChange={(e) => toggleAutoLaunch(e.target.checked)} />
              </label>
              <button
                type="button"
                onClick={checkForUpdates}
                className="w-full rounded-lg border border-line bg-bg/40 px-3 py-2 text-left text-xs text-muted hover:text-text"
              >
                Check for updates{updateStatus ? ` — ${updateStatus}` : ''}
              </button>
            </div>
          )}
          <div className="flex-1 space-y-3 overflow-y-auto p-4">
            {msgs.map((m, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.18 }}
                className={cx('flex', m.role === 'user' ? 'justify-end' : 'justify-start')}
              >
                <div
                  className={cx(
                    'max-w-[88%] rounded-xl px-3.5 py-2.5 text-sm leading-relaxed',
                    m.role === 'user' ? 'bg-panel-alt text-text' : 'border border-line bg-bg/40 text-text',
                  )}
                >
                  {m.text}
                </div>
              </motion.div>
            ))}
            {busy && (
              <div className="flex justify-start">
                <div className="nf-typing flex items-center gap-1 rounded-xl border border-line bg-bg/40 px-3.5 py-3">
                  <span className="h-1.5 w-1.5 rounded-full bg-muted" />
                  <span className="h-1.5 w-1.5 rounded-full bg-muted" />
                  <span className="h-1.5 w-1.5 rounded-full bg-muted" />
                </div>
              </div>
            )}
          </div>

          <div className="border-t border-line p-4">
            <div className="mb-2 flex flex-wrap gap-1.5">
              {CHIPS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => send(c)}
                  className="rounded-full border border-line bg-panel-alt px-2.5 py-1 text-xs text-muted transition-colors duration-150 hover:border-accent/40 hover:text-text"
                >
                  {c}
                </button>
              ))}
            </div>
            <form
              className="flex items-center gap-2"
              onSubmit={(e) => {
                e.preventDefault()
                send()
              }}
            >
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Ask anything…"
                aria-label="Ask Cupric AI"
                className="h-9 flex-1 rounded-lg border border-line bg-panel-alt px-3 text-sm placeholder:text-muted/70"
              />
              <button
                type="submit"
                aria-label="Send"
                disabled={!input.trim() || busy}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent text-accent-ink transition-transform duration-150 hover:bg-accent-hover active:scale-[0.96] disabled:pointer-events-none disabled:opacity-40"
              >
                <Send size={15} />
              </button>
            </form>
          </div>
        </motion.aside>
      )}
    </AnimatePresence>
  )
}
