import { useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Send, Sparkles, X, Settings } from 'lucide-react'
import { fakeGeminiChat } from '../lib/gemini'
import { useActiveProject, useProjectStore } from '../state/useProjectStore'
import { cx } from '../lib/utils'

type ChatMsg = { role: 'user' | 'gemini'; text: string }

const CHIPS = ['Suggest a 12s bumper', 'How does the Arena flow work?', 'Tighten my captions']

/** Ask Gemini slide-over — shell per Prompt 0, wired to the mocked chat lib. */
export function AskPanel() {
  const open = useProjectStore((s) => s.askOpen)
  const setAskOpen = useProjectStore((s) => s.setAskOpen)
  const view = useProjectStore((s) => s.view)
  const active = useActiveProject()

  const [msgs, setMsgs] = useState<ChatMsg[]>([
    {
      role: 'gemini',
      text: "Hey — I'm the Gemini co-pilot. Ask me for rundown ideas, tighter copy, or how the Arena flow works. (Prototype: my replies are mocked.)",
    },
  ])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [apiKey, setApiKey] = useState('')
  const [hasKey, setHasKey] = useState(false)

  async function saveKey() {
    const ipc = (window as any).northframe?.ipc
    if (!ipc) return
    const result = await ipc.invoke('settings:set', { geminiApiKey: apiKey })
    setHasKey(Boolean(result?.hasKey)); setApiKey(''); setShowSettings(false)
  }

  async function send(textArg?: string) {
    const text = (textArg ?? input).trim()
    if (!text || busy) return
    setInput('')
    setMsgs((m) => [...m, { role: 'user', text }])
    setBusy(true)
    const reply = await fakeGeminiChat(text, { projectName: active?.name ?? null, view })
    setMsgs((m) => [...m, { role: 'gemini', text: reply }])
    setBusy(false)
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.aside
          key="ask-panel"
          aria-label="Ask Gemini"
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
              <div className="flex items-center gap-2 text-sm font-semibold">Ask Gemini <span className="rounded-full border border-line px-1.5 py-0.5 text-[10px] text-muted">{hasKey ? 'LIVE' : 'MOCK'}</span></div>
              <div className="text-xs text-muted">{hasKey ? 'Gemini 2.0 Flash' : 'Local fallback — add an API key'}</div>
            </div>
            <button type="button" aria-label="Gemini settings" onClick={() => setShowSettings((v) => !v)} className="flex h-8 w-8 items-center justify-center rounded-lg text-muted hover:bg-panel-alt hover:text-text"><Settings size={15}/></button>
            <button
              type="button"
              aria-label="Close panel"
              onClick={() => setAskOpen(false)}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-muted transition-colors duration-150 hover:bg-panel-alt hover:text-text active:scale-[0.96]"
            >
              <X size={16} />
            </button>
          </div>

          {showSettings && <form onSubmit={(e) => { e.preventDefault(); saveKey() }} className="border-b border-line bg-panel-alt p-3"><label className="mb-1 block text-xs text-muted">Gemini API key</label><div className="flex gap-2"><input type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="Paste key — stored locally" className="h-8 min-w-0 flex-1 rounded-lg border border-line bg-bg px-2 text-xs"/><button type="submit" className="rounded-lg bg-accent px-3 text-xs font-semibold text-accent-ink">Save</button></div></form>}
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
                aria-label="Ask Gemini"
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
