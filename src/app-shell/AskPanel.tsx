import { EASE_SPRING } from '../lib/motion'
import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { ImagePlus, Send, Sparkles, X, Settings } from 'lucide-react'
import { askGeminiChat, type ChatImage } from '../lib/gemini'
import {
  discoverLocalModels,
  isConfigured as isOpenCodeConfigured,
  listModels as listOpenCodeModelsWeb,
  loadSettings as loadOpenCodeSettings,
  saveSettings as saveOpenCodeSettings,
} from '../lib/opencode'
import { useActiveProject, useProjectStore } from '../state/useProjectStore'
import { cx } from '../lib/utils'
import { getIpc } from '../lib/bridge'
import { humanError } from '../lib/humanError'
import { ProjectSafetyPanel } from './ProjectSafetyPanel'
import { ThinkingOrb } from 'thinking-orbs'
import { ThinkingStates } from '../components/loaders/ThinkingStates'
import { useReducedMotion } from '../lib/use-reduced-motion'

type ChatMsg = { role: 'user' | 'ai'; text: string; images?: ChatImage[] }

/** Keep attachments small enough for any provider's request limit. */
const MAX_IMAGES = 4
const MAX_IMAGE_EDGE = 1600

async function fileToChatImage(file: File): Promise<ChatImage> {
  const url = URL.createObjectURL(file)
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image()
      el.onload = () => resolve(el)
      el.onerror = () => reject(new Error(`${file.name} is not a readable image`))
      el.src = url
    })
    const scale = Math.min(1, MAX_IMAGE_EDGE / Math.max(img.naturalWidth, img.naturalHeight))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(img.naturalWidth * scale))
    canvas.height = Math.max(1, Math.round(img.naturalHeight * scale))
    canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height)
    const dataUrl = canvas.toDataURL('image/jpeg', 0.86)
    return { name: file.name || 'image.jpg', mimeType: 'image/jpeg', dataUrl }
  } finally {
    URL.revokeObjectURL(url)
  }
}

type AiProvider = 'gemini' | 'opencode'
type AiMode = 'auto' | 'gemini' | 'zen' | 'openrouter' | 'ollama' | 'lmstudio' | 'template'
type StatusDot = 'ok' | 'error' | 'unknown' | 'testing'

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
  const pushToast = useProjectStore((s) => s.pushToast)

  const [msgs, setMsgs] = useState<ChatMsg[]>([
    {
      role: 'ai',
      text: "Hey — I'm Cupric AI. Live chat uses Gemini or an OpenCode/OpenAI-compatible model configured in settings. Video creation does not need chat; use Brief → Create video file.",
    },
  ])
  const [input, setInput] = useState('')
  const [pending, setPending] = useState<ChatImage[]>([])
  const [dragOver, setDragOver] = useState(false)
  const [preview, setPreview] = useState<ChatImage | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [pendingSummary, setPendingSummary] = useState(false)
  const theme = useProjectStore((s) => s.theme)
  const reducedMotion = useReducedMotion()
  const [showSettings, setShowSettings] = useState(false)
  const [apiKey, setApiKey] = useState('')
  const [geminiModel, setGeminiModel] = useState('gemini-2.5-flash')
  const [geminiModels, setGeminiModels] = useState<{ id: string; label: string }[]>([])
  const [aiMode, setAiMode] = useState<AiMode>('auto')
  const [autoPick, setAutoPick] = useState<{ label?: string; reason?: string; kind?: string; model?: string } | null>(null)
  const [setupRequired, setSetupRequired] = useState(false)
  const [statusDots, setStatusDots] = useState<{ gemini: StatusDot; zen: StatusDot; local: StatusDot }>({ gemini: 'unknown', zen: 'unknown', local: 'unknown' })
  const [fallbackOrder, setFallbackOrder] = useState<AiMode[]>(['gemini', 'zen', 'ollama', 'lmstudio', 'template'])
  const [openCodeKey, setOpenCodeKey] = useState('')
  const [openCodeBaseUrl, setOpenCodeBaseUrl] = useState('https://openrouter.ai/api/v1')
  const [openCodeModel, setOpenCodeModel] = useState('qwen/qwen3-235b-a22b:free')
  const [aiProvider, setAiProvider] = useState<AiProvider>('opencode')
  const [hasKey, setHasKey] = useState(false)
  const [hasGeminiKey, setHasGeminiKey] = useState(false)
  const [hasOpenCodeKey, setHasOpenCodeKey] = useState(false)
  const [autoLaunch, setAutoLaunch] = useState(false)
  const [updateStatus, setUpdateStatus] = useState('')
  const [updateReady, setUpdateReady] = useState(false)
  const [mediaReady, setMediaReady] = useState<boolean | null>(null)
  const [stockProxyUrl, setStockProxyUrl] = useState('')
  const [pixabayKey, setPixabayKey] = useState('')
  const [pexelsKey, setPexelsKey] = useState('')
  const [stockStatus, setStockStatus] = useState<{ pixabayConfigured: boolean; pexelsConfigured: boolean; proxyUrl: string; quota?: Record<string, string> }>({ pixabayConfigured: false, pexelsConfigured: false, proxyUrl: '' })
  const [stockProxyHealth, setStockProxyHealth] = useState<{ configured: boolean; healthy: boolean; error?: string }>({ configured: false, healthy: false })
  const [freeModels, setFreeModels] = useState<OpenCodePreset[]>(FREE_OPENCODE_PRESETS)
  const [modelSearch, setModelSearch] = useState('')
  const [modelLoadStatus, setModelLoadStatus] = useState('')
  const [providerStatus, setProviderStatus] = useState<Record<AiProvider, { state: 'idle' | 'testing' | 'ok' | 'error'; message: string }>>({
    gemini: { state: 'idle', message: 'Not tested' },
    opencode: { state: 'idle', message: 'Not tested' },
  })

  useEffect(() => {
    const ipc = getIpc()
    if (!ipc) {
      // Web build: settings live in localStorage, not the Electron main process.
      const web = loadOpenCodeSettings()
      setAiProvider('opencode')
      setOpenCodeBaseUrl(web.baseUrl)
      setOpenCodeModel(web.model)
      setHasOpenCodeKey(Boolean(web.apiKey))
      setHasKey(isOpenCodeConfigured(web))
      setMediaReady(false)
      return
    }
    ipc.invoke('settings:get').then((settings: { hasKey?: boolean; hasGeminiKey?: boolean; hasOpenCodeKey?: boolean; aiProvider?: AiProvider; aiMode?: AiMode; autoPick?: typeof autoPick; setupRequired?: boolean; statusDots?: typeof statusDots; fallbackOrder?: AiMode[]; geminiModel?: string; openCodeBaseUrl?: string; openCodeModel?: string; autoLaunch?: boolean; stock?: { pixabayConfigured?: boolean; pexelsConfigured?: boolean; proxyUrl?: string; quota?: Record<string, string> } }) => {
      setHasKey(Boolean(settings?.hasKey))
      setHasGeminiKey(Boolean(settings?.hasGeminiKey))
      setHasOpenCodeKey(Boolean(settings?.hasOpenCodeKey))
      if (settings?.aiProvider) setAiProvider(settings.aiProvider)
      if (settings?.aiMode) setAiMode(settings.aiMode)
      setAutoPick(settings?.autoPick || null)
      setSetupRequired(Boolean(settings?.setupRequired))
      if (settings?.statusDots) setStatusDots({ ...statusDots, ...settings.statusDots })
      if (settings?.fallbackOrder?.length) setFallbackOrder(settings.fallbackOrder)
      if (settings?.geminiModel) setGeminiModel(settings.geminiModel)
      if (settings?.openCodeBaseUrl) setOpenCodeBaseUrl(settings.openCodeBaseUrl)
      if (settings?.openCodeModel) setOpenCodeModel(settings.openCodeModel)
      setAutoLaunch(Boolean(settings?.autoLaunch))
      if (settings?.stock) {
        setStockProxyUrl(settings.stock.proxyUrl || '')
        setStockStatus({ pixabayConfigured: Boolean(settings.stock.pixabayConfigured), pexelsConfigured: Boolean(settings.stock.pexelsConfigured), proxyUrl: settings.stock.proxyUrl || '', quota: settings.stock.quota })
        void ipc.invoke('stock:proxyHealth').then((health: { configured?: boolean; healthy?: boolean; error?: string }) => setStockProxyHealth({ configured: Boolean(health?.configured), healthy: Boolean(health?.healthy), error: health?.error }))
      }
    })
    ipc.invoke('media:status').then((status: { ready?: boolean }) => setMediaReady(Boolean(status?.ready))).catch(() => setMediaReady(false))
    if (typeof ipc.on === 'function') {
      return ipc.on('updater:status', (event: { status?: string; version?: string; message?: string }) => {
        setUpdateStatus(event?.version ? `${event.status} ${event.version}` : event?.message || event?.status || '')
        setUpdateReady(event?.status === 'downloaded')
      })
    }
  }, [])

  useEffect(() => {
    if (!hasGeminiKey || !getIpc()) return
    void testConnection('gemini')
  }, [hasGeminiKey])

  const shownFreeModels = freeModels.filter((preset) => {
    const q = modelSearch.trim().toLowerCase()
    if (!q) return true
    return `${preset.label} ${preset.model} ${preset.note}`.toLowerCase().includes(q)
  })

  async function refreshDiscovery() {
    const ipc = getIpc()
    if (!ipc) return
    try {
      const result = await ipc.invoke('ai:autoDiscover')
      if (result?.pick) {
        setAutoPick(result.pick)
        if (result.pick.kind !== 'template') pushToast('info', `Auto-using ${result.pick.label} — change in Settings`)
      }
      setSetupRequired(Boolean(result?.setupRequired))
      setStatusDots((current) => ({ ...current, local: result?.local?.length ? 'ok' : current.local, zen: result?.pick?.kind === 'zen' ? 'ok' : current.zen }))
      const settings = await ipc.invoke('settings:get')
      setHasKey(Boolean(settings?.hasKey))
      if (settings?.aiMode) setAiMode(settings.aiMode)
      if (settings?.autoPick) setAutoPick(settings.autoPick)
      if (settings?.openCodeBaseUrl) setOpenCodeBaseUrl(settings.openCodeBaseUrl)
      if (settings?.openCodeModel) setOpenCodeModel(settings.openCodeModel)
    } catch (err) {
      setModelLoadStatus(humanError(err, 'Auto-discovery could not finish'))
    }
  }

  function useOpenCodePreset(preset: OpenCodePreset) {
    setAiProvider('opencode')
    setAiMode(/localhost|127\.0\.0\.1/.test(preset.baseUrl) ? (preset.baseUrl.includes('1234') ? 'lmstudio' : 'ollama') : 'openrouter')
    setOpenCodeBaseUrl(preset.baseUrl)
    setOpenCodeModel(preset.model)
  }

  async function openSetup(kind: 'zen' | 'ollama' | 'template') {
    const ipc = getIpc()
    if (!ipc) return
    if (kind === 'zen') {
      setAiMode('zen')
      setAiProvider('opencode')
      setOpenCodeBaseUrl('https://opencode.ai/zen/v1')
      setOpenCodeModel('big-pickle')
      await ipc.invoke('ai:openZenAuth')
    } else if (kind === 'ollama') await ipc.invoke('ai:installOllama')
    else {
      const result = await ipc.invoke('ai:useTemplate')
      setAiMode('template')
      setSetupRequired(false)
      setHasKey(Boolean(result?.hasKey))
      setAutoPick(result?.autoPick || { label: 'Offline template', reason: 'Deterministic offline planner' })
    }
  }

  function moveFallback(index: number, direction: -1 | 1) {
    const next = [...fallbackOrder]
    const target = index + direction
    if (target < 0 || target >= next.length) return
    ;[next[index], next[target]] = [next[target], next[index]]
    setFallbackOrder(next)
  }

  async function loadOpenCodeDesktopModels() {
    setModelLoadStatus('reading OpenCode Desktop config')
    try {
      const ipc = getIpc()
      if (!ipc) {
        // No Electron here — probe the local servers OpenCode usually exposes.
        const local = await discoverLocalModels()
        const merged = [...local, ...freeModels]
        const seen = new Set<string>()
        setFreeModels(
          merged.filter((model) =>
            seen.has(`${model.baseUrl}|${model.model}`) ? false : (seen.add(`${model.baseUrl}|${model.model}`), true),
          ),
        )
        setModelLoadStatus(
          local.length
            ? `${local.length} local model${local.length === 1 ? '' : 's'} found (free)`
            : 'No local model server answered on ports 4096 / 11434 / 1234 / 8080.',
        )
        return
      }
      const models: OpenCodePreset[] = await ipc.invoke('opencode:discoverModels')
      const merged = [...models, ...freeModels]
      const seen = new Set<string>()
      setFreeModels(merged.filter((model) => (seen.has(`${model.baseUrl}|${model.model}`) ? false : (seen.add(`${model.baseUrl}|${model.model}`), true))))
      setModelLoadStatus(models.length ? `${models.length} OpenCode Desktop model${models.length === 1 ? '' : 's'} loaded` : 'No OpenCode Desktop models found yet')
    } catch (err) {
      setModelLoadStatus(humanError(err, 'Could not read OpenCode Desktop models'))
    }
  }

  async function loadFreeOpenCodeModels() {
    setModelLoadStatus('loading')
    try {
      const ipc = getIpc()
      let models: OpenCodePreset[] = []
      if (ipc) {
        models = await ipc.invoke('opencode:listModels', { baseUrl: openCodeBaseUrl, apiKey: openCodeKey })
      } else {
        const discovered = await listOpenCodeModelsWeb(openCodeBaseUrl, openCodeKey)
        // Remote catalogues are huge; keep the free tier unless this is a local server.
        const local = /localhost|127\.0\.0\.1/.test(openCodeBaseUrl)
        models = local ? discovered : discovered.filter((model) => model.model.includes(':free'))
      }
      const merged = [...models, ...FREE_OPENCODE_PRESETS]
      const seen = new Set<string>()
      setFreeModels(merged.filter((model) => {
        const key = `${model.baseUrl}|${model.model}`
        return seen.has(key) ? false : (seen.add(key), true)
      }))
      setModelLoadStatus(`${models.length} free models loaded`)
    } catch (err) {
      setModelLoadStatus(humanError(err, 'Could not load free models'))
    }
  }

  async function refreshGeminiModels() {
    const ipc = getIpc()
    if (!ipc) return
    try {
      const models = await ipc.invoke('gemini:listModels', { apiKey: apiKey.trim() || undefined })
      setGeminiModels(Array.isArray(models) ? models : [])
      if (Array.isArray(models) && models.length && !models.some((model) => model.id === geminiModel)) setGeminiModel(models.some((model) => model.id === 'gemini-2.5-flash') ? 'gemini-2.5-flash' : models[0].id)
    } catch (err) {
      setProviderStatus((current) => ({ ...current, gemini: { state: 'error', message: humanError(err, 'Could not refresh Gemini models') } }))
    }
  }

  async function testConnection(provider: AiProvider) {
    setProviderStatus((current) => ({ ...current, [provider]: { state: 'testing', message: 'Testing…' } }))
    try {
      const ipc = getIpc()
      if (!ipc) {
        if (provider === 'gemini') throw new Error('Gemini connection tests require the desktop app')
        const models = await listOpenCodeModelsWeb(openCodeBaseUrl, openCodeKey)
        setProviderStatus((current) => ({
          ...current,
          opencode: { state: 'ok', message: `Connected · ${models.length} model${models.length === 1 ? '' : 's'} visible` },
        }))
        return
      }
      const result: { ok?: boolean; message?: string; latencyMs?: number } = await ipc.invoke('ai:testConnection', provider === 'gemini'
        ? { provider, apiKey, model: geminiModel }
        : { provider, apiKey: openCodeKey, baseUrl: openCodeBaseUrl, model: openCodeModel })
      setProviderStatus((current) => ({
        ...current,
        [provider]: {
          state: result.ok ? 'ok' : 'error',
          message: `${result.message || (result.ok ? 'Connected' : 'Connection failed')}${result.latencyMs ? ` · ${result.latencyMs}ms` : ''}`,
        },
      }))
      if (provider === 'gemini') setStatusDots((current) => ({ ...current, gemini: result.ok ? 'ok' : 'error' }))
      else setStatusDots((current) => ({ ...current, zen: aiMode === 'zen' && result.ok ? 'ok' : current.zen, local: (aiMode === 'ollama' || aiMode === 'lmstudio') && result.ok ? 'ok' : current.local }))
    } catch (err) {
      setProviderStatus((current) => ({
        ...current,
        [provider]: { state: 'error', message: humanError(err, 'Connection failed') },
      }))
      if (provider === 'gemini') setStatusDots((current) => ({ ...current, gemini: 'error' }))
    }
  }

  async function saveAiSettings() {
    const ipc = getIpc()
    if (!ipc) {
      const saved = saveOpenCodeSettings({
        baseUrl: openCodeBaseUrl,
        // Blank keeps whatever was stored before, matching the desktop behaviour.
        apiKey: openCodeKey.trim() || loadOpenCodeSettings().apiKey,
        model: openCodeModel,
      })
      setHasOpenCodeKey(Boolean(saved.apiKey))
      setHasKey(isOpenCodeConfigured(saved))
      setOpenCodeKey('')
      setModelLoadStatus(
        isOpenCodeConfigured(saved)
          ? `Saved in this browser — chatting with ${saved.model}`
          : 'Set both a base URL and a model to enable live chat.',
      )
      return
    }
    const patch: Record<string, unknown> = {
      aiProvider,
      aiMode,
      geminiModel,
      openCodeBaseUrl,
      openCodeModel,
      fallbackOrder,
      stockProxyUrl: stockProxyUrl.trim(),
    }
    if (apiKey.trim()) patch.geminiApiKey = apiKey.trim()
    if (openCodeKey.trim()) patch.openCodeApiKey = openCodeKey.trim()
    if (pixabayKey.trim()) patch.pixabayApiKey = pixabayKey.trim()
    if (pexelsKey.trim()) patch.pexelsApiKey = pexelsKey.trim()
    const result = await ipc.invoke('settings:set', patch)
    setHasKey(Boolean(result?.hasKey))
    setHasGeminiKey(Boolean(result?.hasGeminiKey))
    setHasOpenCodeKey(Boolean(result?.hasOpenCodeKey))
    setStockProxyUrl(result?.stock?.proxyUrl || stockProxyUrl.trim())
    setStockStatus({ pixabayConfigured: Boolean(result?.stock?.pixabayConfigured), pexelsConfigured: Boolean(result?.stock?.pexelsConfigured), proxyUrl: result?.stock?.proxyUrl || stockProxyUrl.trim(), quota: result?.stock?.quota })
    void ipc.invoke('stock:proxyHealth').then((health: { configured?: boolean; healthy?: boolean; error?: string }) => setStockProxyHealth({ configured: Boolean(health?.configured), healthy: Boolean(health?.healthy), error: health?.error }))
    setApiKey('')
    setOpenCodeKey('')
    setPixabayKey('')
    setPexelsKey('')
  }

  async function toggleAutoLaunch(next: boolean) {
    const ipc = getIpc()
    if (!ipc) return
    const result = await ipc.invoke('settings:set', { autoLaunch: next })
    setAutoLaunch(Boolean(result?.autoLaunch))
  }

  async function checkForUpdates() {
    const ipc = getIpc()
    if (!ipc) return
    setUpdateStatus('checking')
    const result = await ipc.invoke('updater:check')
    setUpdateStatus(result?.message || result?.status || 'checking')
  }

  async function installUpdate() {
    const ipc = getIpc()
    if (!ipc) return
    setUpdateStatus('installing · Cupric AI will restart')
    const result = await ipc.invoke('updater:install')
    if (result?.status !== 'installing') setUpdateStatus(result?.message || result?.status || 'Update could not start')
  }

  // Always show the newest message — the old list never scrolled to it.
  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
  }, [msgs, busy])

  async function attach(files: FileList | File[] | null) {
    const list = Array.from(files ?? []).filter((file) => file.type.startsWith('image/'))
    if (!list.length) return
    const room = Math.max(0, MAX_IMAGES - pending.length)
    const picked = list.slice(0, room)
    try {
      const images = await Promise.all(picked.map(fileToChatImage))
      setPending((current) => [...current, ...images].slice(0, MAX_IMAGES))
    } catch (err) {
      useProjectStore.getState().pushToast('error', humanError(err, 'Could not attach that image'))
    }
    if (list.length > room) useProjectStore.getState().pushToast('info', `Up to ${MAX_IMAGES} images per message.`)
  }

  async function send(textArg?: string) {
    const typed = (textArg ?? input).trim()
    const images = textArg ? [] : pending
    if ((!typed && !images.length) || busy) return
    const text = typed || 'What do you see in this image, and how would you use it in a short video?'
    setInput('')
    setPending([])
    const history = msgs.slice(-8).map((m) => ({ role: m.role, text: m.text }))
    setMsgs((m) => [...m, { role: 'user', text, images }])
    setPendingSummary(images.length > 0)
    setBusy(true)
    try {
      const reply = await askGeminiChat(text, { projectName: active?.name ?? null, view }, { images, history })
      setMsgs((m) => [...m, { role: 'ai', text: reply } satisfies ChatMsg])
    } catch (err) {
      setMsgs((m) => [...m, { role: 'ai', text: humanError(err, 'The assistant') } satisfies ChatMsg])
    } finally {
      setBusy(false)
    }
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
          transition={{ duration: 0.2, ease: EASE_SPRING }}
          className="fixed inset-y-0 right-0 z-40 flex w-[min(420px,100vw)] flex-col overflow-hidden border-l border-line bg-panel shadow-2xl"
        >
          <div className="flex items-center gap-2.5 border-b border-line px-4 py-3">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-accent text-accent-ink">
              <Sparkles size={14} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 text-sm font-semibold">
                Ask Cupric AI
                <span className={cx('h-2 w-2 rounded-full', aiMode === 'auto' ? (autoPick?.kind === 'template' ? 'bg-muted' : 'bg-accent') : providerStatus[aiProvider].state === 'ok' ? 'bg-accent' : providerStatus[aiProvider].state === 'error' ? 'bg-danger' : providerStatus[aiProvider].state === 'testing' ? 'bg-info' : 'bg-muted')} title={aiMode === 'auto' ? autoPick?.reason || 'Auto-discovering available providers' : providerStatus[aiProvider].message} />
                <span className="rounded-full border border-line px-1.5 py-0.5 text-[10px] text-muted">{aiMode === 'template' ? 'OFFLINE' : hasKey ? 'LIVE' : 'SETUP'}</span>
              </div>
              <div className="text-xs text-muted">{aiMode === 'auto' ? `Auto · ${autoPick?.label || 'discovering…'}` : aiMode === 'template' ? 'Offline deterministic template' : aiProvider === 'opencode' ? `${aiMode === 'zen' ? 'Zen Free' : 'OpenCode'} · ${openCodeModel}` : `Gemini · ${geminiModel}`}</div>
            </div>
            <button type="button" aria-label="AI settings" onClick={() => { const next = !showSettings; setShowSettings(next); if (next) void refreshDiscovery() }} className="flex h-8 w-8 items-center justify-center rounded-lg text-muted hover:bg-panel-alt hover:text-text"><Settings size={15}/></button>
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
            <div className="max-h-[62%] shrink-0 space-y-3 overflow-y-auto overscroll-contain border-b border-line bg-panel-alt p-3">
              <form
                className="space-y-2"
                onSubmit={(e) => {
                  e.preventDefault()
                  saveAiSettings()
                }}
              >
                <label className="block text-xs text-muted">
                  AI provider
                  <select
                    value={aiMode}
                    onChange={(e) => {
                      const next = e.target.value as AiMode
                      setAiMode(next)
                      setAiProvider(next === 'gemini' ? 'gemini' : 'opencode')
                    }}
                    className="mt-1 h-8 w-full rounded-lg border border-line bg-bg px-2 text-xs text-text"
                  >
                    <option value="auto">Auto (recommended)</option>
                    <option value="gemini">Gemini</option>
                    <option value="zen">Zen Free</option>
                    <option value="openrouter">OpenRouter</option>
                    <option value="ollama">Ollama</option>
                    <option value="lmstudio">LM Studio</option>
                    <option value="template">Offline template</option>
                  </select>
                </label>
                {aiMode === 'auto' && (
                  <div className="rounded-lg border border-accent/25 bg-accent/5 p-2 text-xs">
                    <div className="flex items-center justify-between gap-2"><span className="font-semibold text-text">Auto-using: {autoPick?.label || 'discovering…'}</span><button type="button" onClick={() => void refreshDiscovery()} className="text-accent-text underline">Change / refresh</button></div>
                    <div className="mt-1 text-muted">Why: {autoPick?.reason || 'Cupric checks OpenCode Desktop, Zen, then local models.'}</div>
                  </div>
                )}
                {setupRequired && aiMode === 'auto' && (
                  <div className="rounded-lg border border-[#f59e0b]/30 bg-[#f59e0b]/10 p-2 text-xs text-text">
                    <div className="font-semibold">No live model found yet</div>
                    <div className="mt-1 text-muted">Your timeline still builds offline. Choose a zero-key setup:</div>
                    <div className="mt-2 grid grid-cols-3 gap-1.5">
                      <button type="button" onClick={() => void openSetup('zen')} className="rounded border border-line bg-panel px-2 py-1.5 text-[10px]">Paste Zen key<br /><span className="text-muted">opencode.ai/auth</span></button>
                      <button type="button" onClick={() => void openSetup('ollama')} className="rounded border border-line bg-panel px-2 py-1.5 text-[10px]">Install Ollama</button>
                      <button type="button" onClick={() => void openSetup('template')} className="rounded border border-line bg-panel px-2 py-1.5 text-[10px]">Use offline template</button>
                    </div>
                  </div>
                )}
                {aiMode === 'gemini' && <label className="block text-xs text-muted">
                  Gemini API key <span className={hasGeminiKey ? 'text-accent-text' : 'text-muted'}>{hasGeminiKey ? 'saved' : 'not saved'}</span>
                  <input
                    type="password"
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    onPaste={() => window.setTimeout(() => void testConnection('gemini'), 0)}
                    placeholder="Paste Gemini key — validates immediately"
                    className="mt-1 h-8 w-full rounded-lg border border-line bg-bg px-2 text-xs"
                  />
                </label>}
                {aiMode === 'gemini' && <label className="block text-xs text-muted">
                  <span className="flex items-center justify-between">Gemini model <button type="button" onClick={() => void refreshGeminiModels()} className="text-accent-text underline">Refresh</button></span>
                  <input list="cupric-gemini-models" value={geminiModel} onChange={(e) => setGeminiModel(e.target.value)} placeholder="gemini-2.5-flash" className="mt-1 h-8 w-full rounded-lg border border-line bg-bg px-2 text-xs" />
                  <datalist id="cupric-gemini-models">{geminiModels.map((model) => <option key={model.id} value={model.id}>{model.label}</option>)}</datalist>
                </label>}
                <div className="flex items-center justify-between gap-2 rounded-lg border border-line bg-bg/40 px-2 py-1.5 text-xs">
                  <span className="flex min-w-0 items-center gap-2 text-muted" title={providerStatus.gemini.message}>
                    <span className={cx('h-2 w-2 shrink-0 rounded-full', providerStatus.gemini.state === 'ok' ? 'bg-accent' : providerStatus.gemini.state === 'error' ? 'bg-danger' : providerStatus.gemini.state === 'testing' ? 'bg-info' : 'bg-muted')} />
                    <span className="truncate">Gemini · {providerStatus.gemini.message}</span>
                  </span>
                  <button type="button" onClick={() => void testConnection('gemini')} disabled={providerStatus.gemini.state === 'testing'} className="shrink-0 rounded-md border border-line px-2 py-1 text-text disabled:opacity-50">Test</button>
                </div>
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
                {aiMode !== 'auto' && aiMode !== 'template' && <label className="block text-xs text-muted">
                  OpenCode base URL
                  <input
                    value={openCodeBaseUrl}
                    onChange={(e) => setOpenCodeBaseUrl(e.target.value)}
                    placeholder="https://openrouter.ai/api/v1 or http://localhost:11434/v1"
                    className="mt-1 h-8 w-full rounded-lg border border-line bg-bg px-2 text-xs"
                  />
                </label>}
                {aiMode !== 'auto' && aiMode !== 'template' && <label className="block text-xs text-muted">
                  OpenCode model
                  <input
                    value={openCodeModel}
                    onChange={(e) => setOpenCodeModel(e.target.value)}
                    placeholder="qwen/qwen3-235b-a22b:free"
                    className="mt-1 h-8 w-full rounded-lg border border-line bg-bg px-2 text-xs"
                  />
                </label>}
                {aiMode === 'zen' || aiMode === 'openrouter' ? <label className="block text-xs text-muted">
                  OpenCode API key <span className={hasOpenCodeKey ? 'text-accent-text' : 'text-muted'}>{hasOpenCodeKey ? 'saved / imported / local model' : 'not saved'}</span>
                  <input
                    type="password"
                    value={openCodeKey}
                    onChange={(e) => setOpenCodeKey(e.target.value)}
                    placeholder="OpenRouter/OpenAI key — blank keeps saved/OpenCode/local"
                    className="mt-1 h-8 w-full rounded-lg border border-line bg-bg px-2 text-xs"
                  />
                </label> : null}
                <div className="flex items-center justify-between gap-2 rounded-lg border border-line bg-bg/40 px-2 py-1.5 text-xs">
                  <span className="flex min-w-0 items-center gap-2 text-muted" title={providerStatus.opencode.message}>
                    <span className={cx('h-2 w-2 shrink-0 rounded-full', providerStatus.opencode.state === 'ok' ? 'bg-accent' : providerStatus.opencode.state === 'error' ? 'bg-danger' : providerStatus.opencode.state === 'testing' ? 'bg-info' : 'bg-muted')} />
                    <span className="truncate">OpenCode · {providerStatus.opencode.message}</span>
                  </span>
                  <button type="button" onClick={() => void testConnection('opencode')} disabled={providerStatus.opencode.state === 'testing'} className="shrink-0 rounded-md border border-line px-2 py-1 text-text disabled:opacity-50">Test</button>
                </div>
                <div className="rounded-lg border border-line bg-bg/40 p-2 text-xs">
                  <div className="mb-1 font-semibold text-muted">Provider status</div>
                  <div className="grid grid-cols-3 gap-1.5 text-[10px]">
                    <span className="flex items-center gap-1 rounded bg-panel px-1.5 py-1" title="Built-in Cupric AI engine, fully offline"><span className="h-2 w-2 rounded-full bg-accent" />Cupric AI · ready</span>{([['gemini', 'Gemini'], ['zen', 'Zen'], ['local', 'Local model']] as const).map(([key, label]) => <span key={key} className="flex items-center gap-1 rounded bg-panel px-1.5 py-1"><span className={cx('h-2 w-2 rounded-full', statusDots[key] === 'ok' ? 'bg-accent' : statusDots[key] === 'error' ? 'bg-danger' : 'bg-muted')} />{label} · {statusDots[key]}</span>)}
                  </div>
                </div>
                <div className="rounded-lg border border-line bg-bg/40 p-2 text-xs">
                  <div className="font-semibold text-muted">Fallback order</div>
                  <div className="mt-1 space-y-1">{fallbackOrder.map((item, index) => <div key={`${item}-${index}`} className="flex items-center justify-between rounded bg-panel px-2 py-1"><span>{index + 1}. {item}</span><span className="flex gap-1"><button type="button" aria-label={`Move ${item} up`} onClick={() => moveFallback(index, -1)} disabled={index === 0}>↑</button><button type="button" aria-label={`Move ${item} down`} onClick={() => moveFallback(index, 1)} disabled={index === fallbackOrder.length - 1}>↓</button></span></div>)}</div>
                </div>
                <button type="submit" className="w-full rounded-lg bg-accent px-3 py-2 text-xs font-semibold text-accent-ink">
                  Save live AI settings
                </button>
              </form>
              <div className="rounded-lg border border-line bg-bg/40 p-3 text-xs">
                <div className="font-semibold text-text">Stock providers</div>
                <p className="mt-1 text-muted">Keys stay in Electron settings and are never exposed to the renderer. Openverse and Picsum work without keys; Pixabay and Pexels also support the owner proxy.</p>
                <div className="mt-2 space-y-1.5">
                  <input type="password" value={pixabayKey} onChange={(e) => setPixabayKey(e.target.value)} placeholder={stockStatus.pixabayConfigured ? 'Pixabay key saved — paste to replace' : 'Pixabay API key (optional)'} className="h-8 w-full rounded-lg border border-line bg-bg px-2 text-xs" />
                  <input type="password" value={pexelsKey} onChange={(e) => setPexelsKey(e.target.value)} placeholder={stockStatus.pexelsConfigured ? 'Pexels key saved — paste to replace' : 'Pexels API key (optional)'} className="h-8 w-full rounded-lg border border-line bg-bg px-2 text-xs" />
                  <input type="url" value={stockProxyUrl} onChange={(e) => setStockProxyUrl(e.target.value)} placeholder="Optional stock proxy URL" className="h-8 w-full rounded-lg border border-line bg-bg px-2 text-xs" />
                  <div className="flex flex-wrap items-center gap-2 text-[10px] text-muted"><span className={stockStatus.pixabayConfigured || stockStatus.proxyUrl ? 'text-accent-text' : ''}>Pixabay {stockStatus.pixabayConfigured || stockStatus.proxyUrl ? 'ready' : 'setup'}</span><span>·</span><span className={stockStatus.pexelsConfigured || stockStatus.proxyUrl ? 'text-accent-text' : ''}>Pexels {stockStatus.pexelsConfigured || stockStatus.proxyUrl ? 'ready' : 'setup'}</span><span>·</span><span className="text-accent-text">Openverse/Picsum keyless</span></div>
                  <div className="text-[10px] text-muted">Proxy: <span className={stockProxyHealth.healthy ? 'text-accent-text' : stockProxyHealth.configured ? 'text-danger' : ''}>{stockProxyHealth.healthy ? 'healthy · fallback enabled' : stockProxyHealth.configured ? `unavailable · ${stockProxyHealth.error || 'personal-key fallback'}` : 'not configured'}</span></div>
                  {stockStatus.quota && <div className="text-[10px] text-muted">Quota: Pixabay {stockStatus.quota.pixabay || 'provider limit'} · Pexels {stockStatus.quota.pexels || 'provider limit'} · Openverse {stockStatus.quota.openverse || 'anonymous limit'}</div>}
                </div>
              </div>
              <div className="rounded-lg border border-line bg-bg/40 px-3 py-2 text-xs text-muted">
                Media engine: <span className={mediaReady ? 'text-accent-text' : 'text-danger'}>{mediaReady === null ? 'checking' : mediaReady ? 'ready' : 'FFmpeg missing'}</span>
              </div>
              <label className="flex items-center justify-between gap-3 rounded-lg border border-line bg-bg/40 px-3 py-2 text-xs text-muted">
                <span>Open Cupric AI on login</span>
                <input type="checkbox" checked={autoLaunch} onChange={(e) => toggleAutoLaunch(e.target.checked)} />
              </label>
              {/*
                * Updates are automatic: the app checks at launch and every
                * four hours, and says so only when one is ready to apply.
                * This stays as a fallback for someone who wants to force the
                * question, which is why it reads as a quiet line of text
                * rather than a button the workflow depends on.
                */}
              <div className="rounded-lg border border-line bg-bg/40 px-3 py-2 text-xs text-muted">
                <div className="flex items-center justify-between gap-3">
                  <span>{updateReady ? 'A new release is ready' : 'Automatic app updates'}</span>
                  {updateReady ? (
                    <button
                      type="button"
                      onClick={() => void installUpdate()}
                      className="shrink-0 rounded-md bg-accent px-2 py-1 font-semibold text-accent-ink"
                    >
                      Update & restart
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => void checkForUpdates()}
                      className="shrink-0 text-muted underline underline-offset-2 hover:text-text"
                    >
                      Check now
                    </button>
                  )}
                </div>
                <div className="mt-1 text-xs text-muted/70">Checks at launch and every four hours. Downloaded releases install on quit, or immediately with the button above.</div>
                {updateStatus && <div className="mt-1 font-mono text-[11px] text-muted/70">{updateStatus}</div>}
              </div>
              <ProjectSafetyPanel />
            </div>
          )}
          <div
            ref={scrollRef}
            className={cx('min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain p-4', dragOver && 'bg-accent/5 outline-2 -outline-offset-4 outline-dashed outline-accent/50')}
            onDragOver={(e) => {
              if (Array.from(e.dataTransfer.items).some((item) => item.type.startsWith('image/'))) {
                e.preventDefault()
                setDragOver(true)
              }
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault()
              setDragOver(false)
              void attach(e.dataTransfer.files)
            }}
          >
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
                  {m.images && m.images.length > 0 && (
                    <div className={cx('mb-2 grid gap-1.5', m.images.length > 1 ? 'grid-cols-2' : 'grid-cols-1')}>
                      {m.images.map((image, index) => (
                        <button
                          key={index}
                          type="button"
                          onClick={() => setPreview(image)}
                          className="overflow-hidden rounded-lg border border-line bg-bg"
                          title={`Open ${image.name}`}
                        >
                          <img src={image.dataUrl} alt={image.name} className="block max-h-48 w-full object-contain" />
                        </button>
                      ))}
                    </div>
                  )}
                  <div className="whitespace-pre-wrap break-words">{m.text}</div>
                </div>
              </motion.div>
            ))}
            {busy && (
              <div className="flex justify-start">
                {/* Libraries.dev apply: Thinking orbs (composing, 20 px inline) beside a
                    Transitions.dev thinking-states label. Both follow the real `busy`
                    flag and stop under reduced motion. */}
                <div className="flex items-center gap-2 rounded-xl border border-line bg-bg/40 px-3.5 py-2.5 text-xs" data-testid="ask-waiting">
                  <ThinkingOrb state="composing" size={20} theme={theme === 'light' ? 'light' : 'dark'} paused={reducedMotion} aria-label="Assistant is writing a reply" />
                  <ThinkingStates states={pendingSummary ? ['Reading your images', 'Waiting for the reply'] : ['Reading your message', 'Waiting for the reply']} holdMs={2400} reducedMotion={reducedMotion ? 'reduce' : 'system'} />
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
            {pending.length > 0 && (
              <div className="mb-2 flex flex-wrap gap-1.5">
                {pending.map((image, index) => (
                  <div key={index} className="group relative h-14 w-14 overflow-hidden rounded-lg border border-line bg-bg">
                    <img src={image.dataUrl} alt={image.name} className="h-full w-full object-cover" />
                    <button
                      type="button"
                      aria-label={`Remove ${image.name}`}
                      onClick={() => setPending((current) => current.filter((_, i) => i !== index))}
                      className="absolute right-0.5 top-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-black/70 text-white"
                    >
                      <X size={11} />
                    </button>
                  </div>
                ))}
              </div>
            )}
            <form
              className="flex items-end gap-2"
              onSubmit={(e) => {
                e.preventDefault()
                send()
              }}
            >
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                multiple
                hidden
                onChange={(e) => {
                  void attach(e.target.files)
                  e.target.value = ''
                }}
              />
              <button
                type="button"
                aria-label="Attach images"
                title="Attach images (or paste / drop them)"
                onClick={() => fileRef.current?.click()}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-line bg-panel-alt text-muted hover:text-text"
              >
                <ImagePlus size={15} />
              </button>
              <textarea
                value={input}
                rows={1}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault()
                    send()
                  }
                }}
                onPaste={(e) => {
                  const files = Array.from(e.clipboardData.files).filter((file) => file.type.startsWith('image/'))
                  if (files.length) {
                    e.preventDefault()
                    void attach(files)
                  }
                }}
                placeholder="Ask anything, or paste an image…"
                aria-label="Ask Cupric AI"
                className="max-h-32 min-h-9 flex-1 resize-none rounded-lg border border-line bg-panel-alt px-3 py-2 text-sm leading-snug placeholder:text-muted/70 [field-sizing:content]"
              />
              <button
                type="submit"
                aria-label="Send"
                disabled={(!input.trim() && !pending.length) || busy}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent text-accent-ink transition-transform duration-150 hover:bg-accent-hover active:scale-[0.96] disabled:pointer-events-none disabled:opacity-40"
              >
                <Send size={15} />
              </button>
            </form>
          </div>
          {preview && (
            <button
              type="button"
              aria-label="Close image preview"
              onClick={() => setPreview(null)}
              className="absolute inset-0 z-10 flex items-center justify-center bg-black/80 p-4"
            >
              <img src={preview.dataUrl} alt={preview.name} className="max-h-full max-w-full rounded-lg object-contain" />
            </button>
          )}
        </motion.aside>
      )}
    </AnimatePresence>
  )
}
