import { useEffect, useRef, useState } from 'react'
import { Moon, Sparkles, Sun } from 'lucide-react'
import { Button } from '../components/Button'
import { IconButton } from '../components/IconButton'
import { Kbd } from '../components/Kbd'
import { useActiveProject, useProjectStore } from '../state/useProjectStore'
import { cx } from '../lib/utils'

export function TopBar() {
  const active = useActiveProject()
  const projects = useProjectStore((s) => s.projects)
  const rename = useProjectStore((s) => s.renameProject)
  const theme = useProjectStore((s) => s.theme)
  const toggleTheme = useProjectStore((s) => s.toggleTheme)
  const setAskOpen = useProjectStore((s) => s.setAskOpen)

  // "Saving…" pulse on every write, settling to "All changes saved".
  const [saving, setSaving] = useState(false)
  const first = useRef(true)
  useEffect(() => {
    if (first.current) {
      first.current = false
      return
    }
    setSaving(true)
    const t = window.setTimeout(() => setSaving(false), 700)
    return () => window.clearTimeout(t)
  }, [projects])

  return (
    <header className="flex h-14 shrink-0 items-center gap-4 border-b border-line bg-panel px-4">
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

      <div className="flex items-center gap-1.5 text-xs text-muted" aria-live="polite">
        <span className={cx('h-1.5 w-1.5 rounded-full', saving ? 'bg-accent motion-safe:animate-pulse' : 'bg-muted/50')} />
        {saving ? 'Saving…' : 'All changes saved'}
      </div>

      <div className="ml-auto flex items-center gap-2">
        <IconButton
          label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
          onClick={toggleTheme}
        >
          {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
        </IconButton>
        <Button variant="primary" size="sm" onClick={() => setAskOpen(true)} className="pr-2">
          <Sparkles size={14} />
          Ask Gemini
          <Kbd className="border-accent-ink/15 bg-accent-ink/10 text-accent-ink">⌘K</Kbd>
        </Button>
      </div>
    </header>
  )
}
