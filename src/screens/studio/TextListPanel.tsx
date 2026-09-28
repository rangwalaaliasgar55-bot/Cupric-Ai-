/**
 * Every on-screen line in one list: jump to it, edit it in place, or find &
 * replace across the whole edit. Useful after importing a code-generated film
 * with dozens of text layers. Each change is one undo step.
 */
import { useState } from 'react'
import type { StudioDoc } from '../../types/project'
import { applyBrandKit, findReplaceText, listTextClips, matchStyleFrom, restyleText, roleOf, setClipText, shiftAllText, type TextRole } from '../../lib/studio/textList'
import { VIDEO_FONTS } from '../../lib/studio/videoFonts'

type Props = {
  doc: StudioDoc
  selectedId: string | null
  onSelect: (id: string, atSec: number) => void
  onCommit: (doc: StudioDoc, label: string) => void
  onNote: (kind: 'info' | 'success', msg: string) => void
  brandKit?: { colors: string[]; font: string }
}

export function TextListPanel({ doc, selectedId, onSelect, onCommit, onNote, brandKit }: Props) {
  const [open, setOpen] = useState(false)
  const [find, setFind] = useState('')
  const [repl, setRepl] = useState('')
  const [whole, setWhole] = useState(false)
  const [role, setRole] = useState<TextRole | 'all'>('headline')
  const [font, setFont] = useState('')
  const [color, setColor] = useState('#F4F1EA')
  const [shift, setShift] = useState('0.5')
  const texts = listTextClips(doc)
  if (!texts.length) return null
  const selectedText = texts.find((t) => t.id === selectedId) ?? null
  const apply = (r: { doc: StudioDoc; count: number }, label: string) => {
    if (!r.count) { onNote('info', 'Nothing to change (no matching unlocked text).'); return }
    onCommit(r.doc, label)
    onNote('success', `${label}: ${r.count} text layer${r.count === 1 ? '' : 's'}. One undo reverts it.`)
  }
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
          <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Restyle text">
            <span className="text-muted">Restyle</span>
            <select className="cu-input px-1.5 py-1" aria-label="Which text" value={role} onChange={(e) => setRole(e.target.value as TextRole | 'all')}>
              <option value="headline">Headlines ({texts.filter((t) => roleOf(t) === 'headline').length})</option>
              <option value="body">Lines ({texts.filter((t) => roleOf(t) === 'body').length})</option>
              <option value="label">Labels ({texts.filter((t) => roleOf(t) === 'label').length})</option>
              <option value="all">All ({texts.length})</option>
            </select>
            <select className="cu-input px-1.5 py-1" aria-label="Font" value={font} onChange={(e) => setFont(e.target.value)}>
              <option value="">Keep font</option>
              {VIDEO_FONTS.map((f) => <option key={f.family} value={f.family}>{f.label}</option>)}
            </select>
            <button type="button" className="cu-chip px-2 py-1" disabled={!font} onClick={() => apply(restyleText(doc, { role, fontFamily: font }), 'Change font')}>Apply font</button>
            <input type="color" aria-label="Colour" value={color} onChange={(e) => setColor(e.target.value)} className="h-6 w-8 rounded border border-line bg-transparent" />
            <button type="button" className="cu-chip px-2 py-1" onClick={() => apply(restyleText(doc, { role, color }), 'Change text colour')}>Apply colour</button>
            <button type="button" className="cu-chip px-2 py-1" aria-label="Smaller" onClick={() => apply(restyleText(doc, { role, scale: 0.9 }), 'Text smaller')}>A−</button>
            <button type="button" className="cu-chip px-2 py-1" aria-label="Larger" onClick={() => apply(restyleText(doc, { role, scale: 1.1 }), 'Text larger')}>A+</button>
            <button type="button" className="cu-chip px-2 py-1" disabled={!selectedText} title={selectedText ? `Copy the look of “${selectedText.text.slice(0, 24)}” (not size, words or timing)` : 'Select a text clip first'} onClick={() => selectedText && apply(matchStyleFrom(doc, selectedText.id, role), 'Match selected style')}>Match selected</button>
            <button type="button" className="cu-chip px-2 py-1" disabled={!brandKit || (!brandKit.font && !brandKit.colors.length)} title="Brand font on headlines and lines; brand colours on text" onClick={() => { if (!brandKit) return; const r = applyBrandKit(doc, brandKit); apply(r, `Apply brand kit (${r.used.join(', ')})`) }}>Brand kit</button>
            <span className="ml-3 text-muted">Shift all text</span>
            <input className="cu-input w-14 px-1.5 py-1" inputMode="decimal" aria-label="Seconds to shift" value={shift} onChange={(e) => setShift(e.target.value)} />
            <button type="button" className="cu-chip px-2 py-1" onClick={() => apply(shiftAllText(doc, -Math.abs(Number(shift) || 0)), 'Shift text earlier')}>◀ s</button>
            <button type="button" className="cu-chip px-2 py-1" onClick={() => apply(shiftAllText(doc, Math.abs(Number(shift) || 0)), 'Shift text later')}>s ▶</button>
          </div>
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
