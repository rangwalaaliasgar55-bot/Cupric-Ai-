import { useEffect, useRef, useState } from 'react'
import { ArrowUp, ChevronRight, Lock, Video } from 'lucide-react'
import { motion } from 'motion/react'
import { Badge } from '../components/Badge'
import { Button } from '../components/Button'
import { Kbd } from '../components/Kbd'
import { NoProject } from '../components/NoProject'
import type { BriefMessage, SceneRundown } from '../types/project'
import { askGemini } from '../lib/gemini'
import { useActiveProject, useProjectStore } from '../state/useProjectStore'
import { cx, deriveAspect, nowIso } from '../lib/utils'
import { getIpc } from '../lib/bridge'

const SUGGESTIONS = ['12s SaaS launch bumper', '3s logo reveal', 'kinetic-type quote card']

const KEY_ORDER: (keyof SceneRundown)[] = [
  'title',
  'durationSec',
  'fps',
  'size',
  'style',
  'scenes',
  'arenaPrompt',
]

export function Brief() {
  const project = useActiveProject()
  const addBriefMessage = useProjectStore((s) => s.addBriefMessage)
  const patchRundown = useProjectStore((s) => s.patchRundown)
  const lockRundown = useProjectStore((s) => s.lockRundown)
  const startRender = useProjectStore((s) => s.startRender)
  const pushToast = useProjectStore((s) => s.pushToast)
  const setView = useProjectStore((s) => s.setView)

  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [flash, setFlash] = useState<string | null>(null)
  const [aiStatus, setAiStatus] = useState<{ mode?: string; pick?: { label?: string; reason?: string }; statusDots?: { gemini?: string; zen?: string; local?: string }; setupRequired?: boolean }>({})
  const scrollRef = useRef<HTMLDivElement>(null)

  const messages = project?.brief.messages ?? []
  const shown = (project?.brief.lockedRundown ?? project?.brief.draftRundown ?? {}) as Partial<SceneRundown>
  const locked = !!project?.brief.lockedRundown
  const canLock =
    !locked && !!shown.title && !!shown.scenes?.length && !!shown.arenaPrompt

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight })
  }, [messages.length, busy])

  useEffect(() => {
    const ipc = getIpc()
    if (!ipc) return
    let active = true
    void ipc.invoke('settings:get').then((settings) => { if (active) setAiStatus(settings || {}) }).catch(() => undefined)
    const off = typeof ipc.on === 'function' ? ipc.on('ai:discovery', (result) => { if (active) setAiStatus((current) => ({ ...current, pick: result?.pick, setupRequired: result?.setupRequired, statusDots: result?.statusDots || current.statusDots })) }) : undefined
    return () => { active = false; off?.() }
  }, [])

  useEffect(() => {
    const ipc = getIpc()
    if (!ipc || !project) return
    const off = typeof ipc.on === 'function' ? ipc.on('ai:rundownPolished', (payload) => {
      if (payload?.projectId && payload.projectId !== project.id) return
      if (payload?.status === 'retrying') pushToast('info', payload.message || 'AI polish queued; retrying in the background.')
      if (payload?.error) pushToast('info', payload.error)
      if (payload?.rundown) {
        patchRundown(project.id, payload.rundown)
        pushToast('success', 'AI polish landed — your rundown was updated without blocking the timeline.')
      }
    }) : undefined
    return () => off?.()
  }, [project?.id])

  if (!project) return <NoProject />

  async function send(textArg?: string) {
    if (!project) return
    const text = (textArg ?? input).trim()
    if (!text || busy) return
    setInput('')
    addBriefMessage(project.id, { role: 'user', text, at: nowIso() })
    setBusy(true)
    const askCount = messages.filter((m) => m.role === 'user').length
    const res = await askGemini(text, askCount, project.id)
    addBriefMessage(project.id, { role: 'gemini', text: res.text, at: nowIso() })
    if (res.source === 'local' && res.fallbackReason) {
      pushToast('info', `Offline planner used — the live model was unavailable: ${res.fallbackReason}`)
    }
    setBusy(false)

    // Fill the rundown field by field — never dump the whole JSON at once.
    const prev = useProjectStore.getState().projects.find((p) => p.id === project.id)?.brief.draftRundown ?? {}
    const keys = KEY_ORDER.filter(
      (k) =>
        res.rundownPatch[k] !== undefined &&
        JSON.stringify((prev as Record<string, unknown>)[k]) !==
          JSON.stringify((res.rundownPatch as Record<string, unknown>)[k]),
    )
    keys.forEach((k, i) => {
      window.setTimeout(() => {
        patchRundown(project.id, { [k]: res.rundownPatch[k] } as Partial<SceneRundown>)
        setFlash(k)
        window.setTimeout(() => setFlash((cur) => (cur === k ? null : cur)), 700)
      }, 280 * (i + 1))
    })
  }

  function lock() {
    if (!project) return
    lockRundown(project.id)
    pushToast('success', 'Rundown locked — Arena Desk unlocked')
  }

  async function createVideoNow() {
    if (!project || busy) return
    let rundown = (project.brief.lockedRundown ?? shown) as SceneRundown
    if (!rundown?.title || !rundown.scenes?.length || !rundown.size) {
      const text = input.trim() || project.name || 'Cupric AI launch video'
      setBusy(true)
      // Root cause of "the Video tab does not use Gemini": this path called
      // askGeminiLocal() — the offline planner — directly, so the desktop
      // `gemini:ask` IPC was never reached even with a key configured. Chat
      // (send) used askGemini(), which is why only this button felt canned.
      const res = await askGemini(text, messages.filter((m) => m.role === 'user').length, project.id)
      rundown = res.rundownPatch as SceneRundown
      addBriefMessage(project.id, { role: 'user', text, at: nowIso() })
      addBriefMessage(project.id, { role: 'gemini', text: res.text, at: nowIso() })
      if (res.source === 'local' && res.fallbackReason) {
        pushToast('info', `Offline planner used — the live model was unavailable: ${res.fallbackReason}`)
      }
      patchRundown(project.id, rundown)
      setInput('')
      setBusy(false)
    }
    if (!rundown?.title || !rundown.scenes?.length || !rundown.size) return
    lockRundown(project.id)
    startRender(project.id, {
      aspect: deriveAspect(rundown.size),
      fps: rundown.fps === 60 ? 60 : 30,
      quality: 'draft',
      label: rundown.title,
      sources: [{
        id: `${project.id}-generated-rundown`,
        sourceType: 'rundown',
        label: rundown.title,
        durationSec: rundown.durationSec,
        rundown,
      }],
    })
    setView('render')
    pushToast('success', 'Creating a real video file now')
  }

  return (
    <div className="flex h-full">
      {/* Chat — left ~60% */}
      <section className="flex min-w-0 flex-1 flex-col">
        <div className="px-6 pt-5">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-lg font-bold">Brief</h1>
            <div className="flex items-center gap-2 text-[10px] text-muted" aria-label="AI provider status">
              <span className="flex items-center gap-1" title="Built-in Cupric AI engine: rundowns, plans, edits and checks, fully offline"><span className="h-2 w-2 rounded-full bg-accent" />Cupric AI</span>{([['gemini', 'Gemini'], ['zen', 'Zen'], ['local', 'Local model']] as const).map(([key, label]) => <span key={key} className="flex items-center gap-1"><span className={cx('h-2 w-2 rounded-full', aiStatus.statusDots?.[key] === 'ok' ? 'bg-accent' : aiStatus.statusDots?.[key] === 'error' ? 'bg-danger' : 'bg-muted')} />{label}</span>)}
              {aiStatus.mode === 'auto' && <span className="rounded-full border border-line px-1.5 py-0.5">Auto · {aiStatus.pick?.label || 'discovering…'}</span>}
            </div>
          </div>
          <p className="text-sm text-muted">
            Describe the video you want. Cupric AI drafts an instant offline rundown, then polishes it in the background when a model is available.
          </p>
          {aiStatus.setupRequired && <p className="mt-2 text-xs text-muted">No live provider found — offline template is ready. Open AI settings for Zen, Ollama, or the template setup card.</p>}
        </div>

        <div ref={scrollRef} className="min-h-0 flex-1 space-y-4 overflow-y-auto px-6 py-4">
          {messages.length === 0 && !busy && (
            <div className="mx-auto mt-6 max-w-md rounded-xl border border-dashed border-line p-5 text-center">
              <div className="text-sm font-semibold">Start with the raw idea</div>
              <p className="mt-1 text-sm leading-relaxed text-muted">
                “{SUGGESTIONS[0]}”, “{SUGGESTIONS[1]}”, or your own words — duration, mood, palette.
                The rundown fills in on the right.
              </p>
            </div>
          )}
          {messages.map((m, i) => (
            <ChatMessage key={i} msg={m} />
          ))}
          {busy && <TypingIndicator />}
        </div>

        <div className="px-6 pb-5">
          <div className="mb-2 flex flex-wrap gap-1.5">
            {SUGGESTIONS.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => send(s)}
                className="rounded-full border border-line bg-panel px-3 py-1 text-xs text-muted transition-colors duration-150 hover:border-accent/40 hover:text-text"
              >
                {s}
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
              onKeyDown={(e) => {
                if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                  e.preventDefault()
                  send()
                }
              }}
              placeholder="e.g. 12s SaaS launch bumper for Aurora — dark, lime, confident"
              aria-label="Brief idea"
              className="h-10 flex-1 rounded-lg border border-line bg-panel px-3 text-sm placeholder:text-muted/70"
            />
            <Button
              type="submit"
              variant="primary"
              disabled={!input.trim() || busy}
              aria-label="Generate rundown"
              className="h-10 w-10 p-0"
            >
              <ArrowUp size={16} />
            </Button>
          </form>
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
            <div className="text-xs text-muted">
              Press <Kbd>⌘</Kbd> <Kbd>↵</Kbd> to send
            </div>
            <Button size="sm" variant="primary" disabled={busy || (!input.trim() && !locked && !canLock)} onClick={createVideoNow}>
              <Video size={14} />
              Create video file
            </Button>
          </div>
        </div>
      </section>

      {/* Rundown — right ~40% */}
      <aside className="hidden w-[400px] shrink-0 flex-col border-l border-line bg-panel/50 lg:flex">
        <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-3.5">
          <div>
            <div className="text-sm font-semibold">Rundown</div>
            <div className="text-xs text-muted">Fills in as Cupric AI drafts</div>
          </div>
          {locked ? (
            <Badge tone="accent">
              <Lock size={11} />
              Locked
            </Badge>
          ) : (
            <Button size="sm" variant={canLock ? 'primary' : 'outline'} disabled={!canLock} onClick={lock}>
              <Lock size={13} />
              Lock rundown
            </Button>
          )}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {Object.keys(shown).length === 0 ? (
            <div className="rounded-lg border border-dashed border-line p-4 text-xs leading-relaxed text-muted">
              Nothing yet — describe the video and Cupric AI will build a rundown here.
            </div>
          ) : (
            <RundownJson r={shown} flash={flash} />
          )}
          {(locked || canLock) && (
            <Button variant="primary" size="sm" className="mt-4 w-full" onClick={createVideoNow}>
              <Video size={14} />
              Create video file
            </Button>
          )}
          {locked && (
            <Button variant="outline" size="sm" className="mt-2 w-full" onClick={() => setView('arena')}>
              Open Arena Desk
              <ChevronRight size={14} />
            </Button>
          )}
        </div>
      </aside>
    </div>
  )
}

function ChatMessage({ msg }: { msg: BriefMessage }) {
  const gem = msg.role === 'gemini'
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.18 }}
      className={cx('flex gap-2.5', !gem && 'justify-end')}
    >
      {gem && (
        <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-accent font-mono text-xs font-bold text-accent-ink">
          C
        </div>
      )}
      <div
        className={cx(
          'max-w-[85%] rounded-xl px-3.5 py-2.5 text-sm leading-relaxed',
          gem ? 'border border-line bg-panel text-text' : 'bg-panel-alt text-text',
        )}
      >
        {gem && <div className="mb-1 text-xs font-semibold text-accent-text">Cupric AI</div>}
        {msg.text}
      </div>
    </motion.div>
  )
}

function TypingIndicator() {
  return (
    <div className="flex gap-2.5">
      <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-accent font-mono text-xs font-bold text-accent-ink">
        C
      </div>
      <div className="flex items-center gap-1 rounded-xl border border-line bg-panel px-4 py-3.5" aria-label="Cupric AI is drafting">
        <span className="nf-typing flex gap-1">
          <span className="h-1.5 w-1.5 rounded-full bg-muted" />
          <span className="h-1.5 w-1.5 rounded-full bg-muted" />
          <span className="h-1.5 w-1.5 rounded-full bg-muted" />
        </span>
      </div>
    </div>
  )
}

/* ——— syntax-highlighted rundown JSON ——— */

function Str({ v }: { v: string }) {
  return <span className="break-words text-text/90">“{v}”</span>
}
function Num({ v }: { v: number }) {
  return <span className="tabular-nums text-accent-text">{v}</span>
}

function Row({
  k,
  flashKey,
  last,
  children,
}: {
  k: string
  flashKey: string | null
  last: boolean
  children: React.ReactNode
}) {
  return (
    <motion.div
      animate={flashKey === k ? { backgroundColor: 'rgba(200,245,66,0.14)' } : { backgroundColor: 'rgba(200,245,66,0)' }}
      transition={{ duration: 0.5 }}
      className="-mx-1 rounded px-1"
    >
      <span className="text-info">“{k}”</span>
      <span className="text-muted">: </span>
      {children}
      {!last && <span className="text-muted">,</span>}
    </motion.div>
  )
}

function RundownJson({ r, flash }: { r: Partial<SceneRundown>; flash: string | null }) {
  const rows = KEY_ORDER.filter((k) => (r as Record<string, unknown>)[k] !== undefined)
  return (
    <div className="overflow-x-auto rounded-lg border border-line bg-bg/60 p-3 font-mono text-xs leading-relaxed">
      <span className="text-muted">{'{'}</span>
      <div className="pl-4">
        {rows.map((k, i) => {
          const last = i === rows.length - 1
          if (k === 'title') return <Row key={k} k="title" flashKey={flash} last={last}><Str v={r.title!} /></Row>
          if (k === 'durationSec') return <Row key={k} k="durationSec" flashKey={flash} last={last}><Num v={r.durationSec!} /></Row>
          if (k === 'fps') return <Row key={k} k="fps" flashKey={flash} last={last}><Num v={r.fps!} /></Row>
          if (k === 'size')
            return (
              <Row key={k} k="size" flashKey={flash} last={last}>
                <span className="text-muted">[ </span>
                <Num v={r.size![0]} />
                <span className="text-muted">, </span>
                <Num v={r.size![1]} />
                <span className="text-muted"> ]</span>
              </Row>
            )
          if (k === 'style') return <Row key={k} k="style" flashKey={flash} last={last}><Str v={r.style!} /></Row>
          if (k === 'scenes')
            return (
              <Row key={k} k="scenes" flashKey={flash} last={last}>
                <span className="text-muted">[</span>
                <div className="pl-4">
                  {r.scenes!.map((s, si) => (
                    <div key={s.id} className="py-0.5">
                      <span className="text-muted">{'{ '}</span>
                      <span className="text-info">"type"</span>
                      <span className="text-muted">: </span>
                      <Str v={s.type} />
                      <span className="text-muted">, </span>
                      <span className="text-info">"from"</span>
                      <span className="text-muted">: </span>
                      <Num v={s.from} />
                      <span className="text-muted">, </span>
                      <span className="text-info">"to"</span>
                      <span className="text-muted">: </span>
                      <Num v={s.to} />
                      <span className="text-muted">,</span>
                      <br />
                      <span className="inline-block pl-5">
                        <span className="text-info">"copy"</span>
                        <span className="text-muted">: </span>
                        <Str v={s.copy} />
                        <span className="text-muted">, </span>
                        <span className="text-info">"motion"</span>
                        <span className="text-muted">: </span>
                        <Str v={s.motion} />
                      </span>
                      <span className="text-muted">{si === r.scenes!.length - 1 ? ' }' : ' },'}</span>
                    </div>
                  ))}
                </div>
                <span className="text-muted">]</span>
              </Row>
            )
          return <Row key={k} k="arenaPrompt" flashKey={flash} last={last}><Str v={r.arenaPrompt!} /></Row>
        })}
      </div>
      <span className="text-muted">{'}'}</span>
    </div>
  )
}
