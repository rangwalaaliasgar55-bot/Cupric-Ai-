/**
 * Command palette (⌘⇧P / Ctrl+Shift+P). Every screen and the main app actions
 * in one searchable list. ⌘K stays with Ask AI. It's keyboard-first: arrows,
 * Enter, Esc, and focus comes back to where you were.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { Search } from 'lucide-react'
import { useProjectStore } from '../state/useProjectStore'
import type { View } from '../types/project'
import { rankCommands } from '../lib/commandRank'

export type PaletteCommand = { id: string; label: string; group: string; keywords?: string; run: () => void }

const VIEWS: Array<[View, string, string]> = [
  ['home', 'Home', 'projects start'], ['auto', 'Auto · guided production', 'autonomous agent plan build'], ['brief', 'Brief', 'rundown chat'],
  ['studio', 'Studio', 'editor timeline edit'], ['footage', 'Footage Desk', 'import clips'], ['timeline', 'Timeline', ''], ['motion', 'Motion Engine', 'keyframes'],
  ['review', 'Review Room', 'feedback'], ['arena', 'Arena Desk', 'battle vote'], ['lab', 'UI Lab', 'components'], ['render', 'Render', 'export queue mp4'],
  ['library', 'Library', 'resources packs libraries.dev'],
]

export function CommandPalette() {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const [idx, setIdx] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const restoreRef = useRef<HTMLElement | null>(null)
  const s = useProjectStore

  const commands = useMemo<PaletteCommand[]>(() => {
    const st = () => s.getState()
    return [
      ...VIEWS.map(([v, label, kw]) => ({ id: `go-${v}`, label: `Go to ${label}`, group: 'Navigate', keywords: kw, run: () => st().setView(v) })),
      { id: 'ask', label: 'Ask NewBrand', group: 'NewBrand', keywords: 'assistant chat edit keyframes captions', run: () => st().setAskOpen(true) },
      // Reopening the tour is a plain DOM event rather than store state: the
      // dialog is shell chrome, and putting it in the project store would make
      // it part of every saved project.
      { id: 'tour', label: 'Quick tour of NewBrand', group: 'Help', keywords: 'onboarding welcome help what is this learn', run: () => window.dispatchEvent(new Event('newbrand:onboarding')) },
      { id: 'plan', label: 'Start a guided production', group: 'NewBrand', keywords: 'autonomous plan intake', run: () => st().setView('auto') },
      { id: 'new', label: 'New project', group: 'Project', keywords: 'create', run: () => { st().createProject(); st().setView('studio') } },
      { id: 'undo', label: 'Undo', group: 'Project', keywords: 'revert back', run: () => st().undo() },
      { id: 'redo', label: 'Redo', group: 'Project', run: () => st().redo() },
      { id: 'libs', label: 'Libraries.dev review', group: 'Library', keywords: 'effects orbs beam', run: () => st().setView('library') },
    ]
  }, [s])
  const results = useMemo(() => rankCommands(commands, q), [commands, q])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'p') {
        e.preventDefault()
        setOpen((o) => {
          if (!o) restoreRef.current = document.activeElement as HTMLElement | null
          return !o
        })
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  useEffect(() => { if (open) { setQ(''); setIdx(0); requestAnimationFrame(() => inputRef.current?.focus()) } else restoreRef.current?.focus?.() }, [open])
  useEffect(() => setIdx(0), [q])

  if (!open) return null
  const run = (c?: PaletteCommand) => { if (!c) return; setOpen(false); c.run() }
  return (
    <div className="fixed inset-0 z-[200] flex items-start justify-center bg-black/50 p-4 pt-[12vh] backdrop-blur-[2px]" onMouseDown={() => setOpen(false)}>
      <div role="dialog" aria-modal="true" aria-label="Command palette" onMouseDown={(e) => e.stopPropagation()}
        className="w-[min(560px,94vw)] overflow-hidden rounded-2xl border border-line bg-panel shadow-2xl motion-safe:animate-[fadeIn_120ms_ease-out]">
        <div className="flex items-center gap-2 border-b border-line px-3 py-2.5">
          <Search size={15} className="text-muted" />
          <input ref={inputRef} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Type a command or screen…" aria-label="Search commands"
            role="combobox" aria-expanded="true" aria-controls="palette-list" aria-activedescendant={results[idx] ? `cmd-${results[idx].id}` : undefined}
            className="flex-1 bg-transparent text-sm text-text outline-none placeholder:text-muted"
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') { e.preventDefault(); setIdx((i) => Math.min(results.length - 1, i + 1)) }
              else if (e.key === 'ArrowUp') { e.preventDefault(); setIdx((i) => Math.max(0, i - 1)) }
              else if (e.key === 'Enter') { e.preventDefault(); run(results[idx]) }
              else if (e.key === 'Escape') { e.preventDefault(); setOpen(false) }
            }} />
          <kbd className="rounded border border-line px-1.5 py-0.5 font-mono text-xs text-muted">Esc</kbd>
        </div>
        <ul id="palette-list" role="listbox" className="max-h-[50vh] overflow-y-auto p-1.5">
          {results.length === 0 && <li className="px-3 py-6 text-center text-xs text-muted">No command matches “{q}”.</li>}
          {results.map((c, i) => (
            <li key={c.id} id={`cmd-${c.id}`} role="option" aria-selected={i === idx} onMouseEnter={() => setIdx(i)} onClick={() => run(c)}
              className={`flex cursor-pointer items-center justify-between rounded-lg px-3 py-2 text-sm transition-colors duration-100 ${i === idx ? 'bg-accent/10 text-text' : 'text-muted'}`}>
              <span>{c.label}</span><span className="text-xs text-muted/80">{c.group}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
