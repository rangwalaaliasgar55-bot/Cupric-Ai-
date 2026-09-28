import { StatusCenter } from './StatusCenter'
import { useEffect, useRef, useState } from 'react'
import { Moon, Sparkles, Sun, Volume2, VolumeX } from 'lucide-react'
import { Button } from '../components/Button'
import { IconButton } from '../components/IconButton'
import { Kbd } from '../components/Kbd'
import { useActiveProject, useProjectStore } from '../state/useProjectStore'
import { cx } from '../lib/utils'
import { AutosaveStatus } from '../lab/components/autosave-status'
import { Breadcrumbs } from '../lab/components/breadcrumbs'

const VIEW_LABEL: Record<string, string> = { auto: 'Auto', review: 'Review Room', brief: 'Brief', arena: 'Arena Desk', footage: 'Footage Desk', studio: 'Studio', motion: 'Motion Engine', timeline: 'Timeline', lab: 'UI Lab', render: 'Render', library: 'Library' }

export function TopBar() {
  const active = useActiveProject()
  const projects = useProjectStore((s) => s.projects)
  const rename = useProjectStore((s) => s.renameProject)
  const theme = useProjectStore((s) => s.theme)
  const toggleTheme = useProjectStore((s) => s.toggleTheme)
  const soundCues = useProjectStore((s) => s.soundCues)
  const setSoundCues = useProjectStore((s) => s.setSoundCues)
  const setAskOpen = useProjectStore((s) => s.setAskOpen)
  const view = useProjectStore((s) => s.view)
  const setView = useProjectStore((s) => s.setView)
  const [savedAt, setSavedAt] = useState<number | null>(null)
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => { const t = window.setInterval(() => setNow(Date.now()), 30_000); return () => window.clearInterval(t) }, [])

  // "Saving…" pulse on every write, settling to "All changes saved".
  const [saving, setSaving] = useState(false)
  const first = useRef(true)
  useEffect(() => {
    if (first.current) {
      first.current = false
      return
    }
    setSaving(true)
    const t = window.setTimeout(() => { setSaving(false); setSavedAt(Date.now()); setNow(Date.now()) }, 700)
    return () => window.clearTimeout(t)
  }, [projects])

  return (
    <header className="flex h-14 shrink-0 items-center gap-4 border-b border-line bg-panel/75 px-4 backdrop-blur-xl">
      {active ? (
        <input
          key={active.id}
          value={active.name}
          onChange={(e) => rename(active.id, e.target.value)}
          spellCheck={false}
          aria-label="Project name"
          style={{ width: `${Math.min(30, Math.max(8, active.name.length + 2))}ch` }}
          className="rounded-lg bg-transparent px-2 py-1 text-base font-semibold text-text transition-colors duration-150 hover:bg-panel-alt focus:bg-panel-alt"
        />
      ) : (
        <span className="px-2 text-sm text-muted">No project open</span>
      )}

      <AutosaveStatus state={saving ? 'saving' : 'saved'} savedAt={savedAt} now={now} className="text-xs text-muted" />
      {active && view !== 'home' && (
        <Breadcrumbs
          className="hidden text-xs text-muted lg:flex"
          items={[{ label: 'Projects', href: 'home' }, { label: active.name || 'Untitled', href: 'brief' }, { label: VIEW_LABEL[view] ?? view, href: view }]}
          onNavigate={(item) => setView(item.href as typeof view)}
        />
      )}

      <div className="ml-auto flex items-center gap-2">
        <StatusCenter />
        <IconButton
          label={soundCues ? 'Turn off the two export sounds' : 'Turn on the two export sounds'}
          onClick={() => setSoundCues(!soundCues)}
        >
          {soundCues ? <Volume2 size={16} /> : <VolumeX size={16} />}
        </IconButton>
        <IconButton
          label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
          onClick={toggleTheme}
        >
          {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
        </IconButton>
        <Button variant="primary" size="sm" onClick={() => setAskOpen(true)} className="pr-2">
          <Sparkles size={14} />
          Ask AI
          <Kbd className="border-accent-ink/15 bg-accent-ink/10 text-accent-ink">⌘K</Kbd>
        </Button>
      </div>
    </header>
  )
}
