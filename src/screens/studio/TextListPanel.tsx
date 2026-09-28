/**
 * Every on-screen line in one list: jump to it, edit it in place, or find &
 * replace across the whole edit. Useful after importing a code-generated film
 * with dozens of text layers. Each change is one undo step.
 */
import { useState } from 'react'
import type { StudioDoc } from '../../types/project'
import { findReplaceText, listTextClips, setClipText } from '../../lib/studio/textList'

type Props = {
  doc: StudioDoc
  selectedId: string | null
  onSelect: (id: string, atSec: number) => void
  onCommit: (doc: StudioDoc, label: string) => void
  onNote: (kind: 'info' | 'success', msg: string) => void
}

export function TextListPanel({ doc, selectedId, onSelect, onCommit, onNote }: Props) {
  const [open, setOpen] = useState(false)
  const [find, setFind] = useState('')
  const [repl, setRepl] = useState('')
  const [whole, setWhole] = useState(false)
  const texts = listTextClips(doc)
  if (!texts.length) return null
  const fmt = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`
  return (
    <div className="border-b border-line px-6 py-1.5 text-xs">
      <button type="button" className="cu-chip px-2 py-1" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        {open ? 'Hide' : 'Edit'} all text ({texts.length})
      </button>
      {open && (
        <div className="mt-2 space-y-2">
          <form className="flex flex-wrap items-center gap-1.5" onSubmit={(e) => {
            e.preventDefault()
            const r = findReplaceText(doc, find, repl, { wholeWord: whole })
            if (!r.hits) { onNote('info', `“${find}” isn't in any unlocked text.`); return }
            onCommit(r.doc, `Replace “${find}”`)
            onNote('success', `Replaced ${r.hits} match${r.hits === 1 ? '' : 'es'} in ${r.clips} clip${r.clips === 1 ? '' : 's'}.`)
          }}>
            <input className="cu-input w-40 px-2 py-1" placeholder="Find" aria-label="Find text" value={find} onChange={(e) => setFind(e.target.value)} />
            <input className="cu-input w-40 px-2 py-1" placeholder="Replace with" aria-label="Replace with" value={repl} onChange={(e) => setRepl(e.target.value)} />
            <label className="flex items-center gap-1 text-muted"><input type="checkbox" checked={whole} onChange={(e) => setWhole(e.target.checked)} /> Whole word</label>
            <button type="submit" className="cu-chip px-2 py-1" disabled={!find}>Replace all</button>
          </form>
          <ol className="max-h-56 space-y-1 overflow-y-auto pr-1">
            {texts.map((t) => (
              <li key={t.id} className={`flex items-start gap-2 rounded-md border px-2 py-1 ${t.id === selectedId ? 'border-accent bg-accent/5' : 'border-line'}`}>
                <button type="button" className="w-14 shrink-0 font-mono text-muted hover:text-text" title="Jump to this line" onClick={() => onSelect(t.id, t.startSec + Math.min(0.5, t.durationSec / 2))}>{fmt(t.startSec)}</button>
                <textarea
                  key={`${t.id}:${t.text}`}
                  className="cu-input min-h-[1.75rem] flex-1 resize-y px-2 py-0.5"
                  rows={Math.min(4, t.text.split('\n').length)}
                  defaultValue={t.text}
                  disabled={t.locked}
                  aria-label={`Text at ${fmt(t.startSec)}`}
                  onBlur={(e) => { if (e.target.value !== t.text) onCommit(setClipText(doc, t.id, e.target.value), 'Edit text') }}
                />
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  )
}
