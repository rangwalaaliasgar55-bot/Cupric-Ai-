/**
 * Visible trim tools for the selected clip (slip / slide / roll ±1 frame,
 * Shift = 10 frames, close gaps), grouping, and text-based editing: click
 * words in the transcript to strike them, then cut them all in one step.
 * Every action is one undo step with a readable label.
 */
import { useMemo, useState } from 'react'
import type { StudioDoc, StudioMediaClip, StudioAudioClip } from '../../types/project'
import { closeGaps, rollEdit, slideClip, slipClip, type EditResult } from '../../lib/studio/timelineOps'
import { groupOverlapping, ungroup, wordCuts } from '../../lib/studio/editTools'
import { tightenClip } from '../../lib/studio/autoEdit'
import { uid } from '../../lib/utils'

type Props = {
  doc: StudioDoc
  selectedId: string | null
  onCommit: (doc: StudioDoc, label: string) => void
  onNote: (kind: 'info' | 'success', msg: string) => void
}

export function EditToolsBar({ doc, selectedId, onCommit, onNote }: Props) {
  const clip = doc.clips.find((c) => c.id === selectedId) ?? null
  const [transcript, setTranscript] = useState(false)
  const [struck, setStruck] = useState<Set<number>>(new Set())
  const frame = 1 / (doc.fps || 30)
  if (!clip) return null
  const run = (r: EditResult, label: string) => { if (!r.changed) onNote('info', r.reason ?? 'Nothing to change here.'); else onCommit(r.doc, label) }
  const step = (e: React.MouseEvent) => frame * (e.shiftKey ? 10 : 1)
  const btn = 'cu-chip px-2 py-1 text-xs disabled:opacity-40'
  const words = (clip.kind === 'video' || clip.kind === 'audio') ? (clip as StudioMediaClip | StudioAudioClip).words ?? [] : []
  const locked = Boolean(clip.locked)

  return (
    <div className="flex flex-wrap items-center gap-1.5 border-b border-line bg-panel/40 px-6 py-1.5 text-xs text-muted" role="toolbar" aria-label="Edit tools for the selected clip">
      <span className="mr-1 font-medium text-text">{clip.name}</span>
      <span title="Slip: change which part of the source plays, without moving the clip">Slip</span>
      <button type="button" className={btn} disabled={locked} aria-label="Slip back" onClick={(e) => run(slipClip(doc, clip.id, -step(e)), 'Slip clip')}>◀</button>
      <button type="button" className={btn} disabled={locked} aria-label="Slip forward" onClick={(e) => run(slipClip(doc, clip.id, step(e)), 'Slip clip')}>▶</button>
      <span className="ml-2" title="Slide: move the clip between its neighbours, which shorten or grow to fit">Slide</span>
      <button type="button" className={btn} disabled={locked} aria-label="Slide back" onClick={(e) => run(slideClip(doc, clip.id, -step(e)), 'Slide clip')}>◀</button>
      <button type="button" className={btn} disabled={locked} aria-label="Slide forward" onClick={(e) => run(slideClip(doc, clip.id, step(e)), 'Slide clip')}>▶</button>
      <span className="ml-2" title="Roll: move the cut between this clip and the next one">Roll</span>
      <button type="button" className={btn} disabled={locked} aria-label="Roll cut back" onClick={(e) => run(rollEdit(doc, clip.id, -step(e)), 'Roll edit')}>◀</button>
      <button type="button" className={btn} disabled={locked} aria-label="Roll cut forward" onClick={(e) => run(rollEdit(doc, clip.id, step(e)), 'Roll edit')}>▶</button>
      <button type="button" className={`${btn} ml-2`} onClick={() => run(closeGaps(doc, clip.track), 'Close gaps')} title="Pull later clips on this track left to remove gaps">Close gaps</button>
      {clip.groupId
        ? <button type="button" className={btn} onClick={() => { const r = ungroup(doc, clip.id); onCommit(r.doc, 'Ungroup'); onNote('success', `Ungrouped ${r.count} clips.`) }}>Ungroup</button>
        : <button type="button" className={btn} disabled={locked} title="Tie this clip to every clip on screen with it; dragging one moves them all" onClick={() => { const r = groupOverlapping(doc, clip.id, uid()); if (r.count < 2) onNote('info', 'No other clips overlap this one in time.'); else { onCommit(r.doc, 'Group clips'); onNote('success', `Grouped ${r.count} clips. Drag any of them to move the group.`) } }}>Group with overlapping</button>}
      {(clip.kind === 'video' || clip.kind === 'audio') && (
        <button type="button" className={btn} aria-expanded={transcript} onClick={() => { setTranscript((v) => !v); setStruck(new Set()) }} disabled={!words.length} title={words.length ? 'Edit by deleting words' : 'Run Auto-captions on this clip first to get its words'}>
          {transcript ? 'Hide transcript' : 'Edit by transcript'}
        </button>
      )}
      <span className="ml-auto text-muted/70">Shift-click = 10 frames</span>
      {transcript && words.length > 0 && (
        <TranscriptPanel words={words} struck={struck} setStruck={setStruck} onCut={() => {
          const c = clip as StudioMediaClip | StudioAudioClip
          const speed = c.kind === 'video' && c.speed > 0 ? c.speed : 1
          const cuts = wordCuts(words, struck, [c.trimInSec, c.trimInSec + c.durationSec * speed])
          const r = tightenClip(doc, c.id, { cuts })
          if (!r.cuts) { onNote('info', r.reason ?? 'Nothing to cut.'); return }
          onCommit(r.doc, `Cut ${struck.size} word(s)`)
          onNote('success', `Removed ${r.removedSec}s in ${r.cuts} cut(s). Captions and overlays after it moved with the words.`)
          setStruck(new Set())
        }} />
      )}
    </div>
  )
}

function TranscriptPanel({ words, struck, setStruck, onCut }: { words: Array<{ word: string; start: number; end: number }>; struck: Set<number>; setStruck: (s: Set<number>) => void; onCut: () => void }) {
  const order = useMemo(() => words.map((w, i) => ({ ...w, i })).sort((a, b) => a.start - b.start), [words])
  return (
    <div className="mt-1 w-full rounded-lg border border-line bg-bg/50 p-2">
      <p className="mb-1.5 leading-relaxed text-text">
        {order.map((w) => (
          <button key={w.i} type="button" aria-pressed={struck.has(w.i)} title={`${w.start.toFixed(2)}s`}
            onClick={() => { const n = new Set(struck); if (n.has(w.i)) n.delete(w.i); else n.add(w.i); setStruck(n) }}
            className={`mr-1 rounded px-0.5 transition-colors duration-100 hover:bg-panel-alt ${struck.has(w.i) ? 'text-danger line-through decoration-2' : ''}`}>{w.word}</button>
        ))}
      </p>
      <div className="flex items-center gap-2">
        <button type="button" className="cu-chip px-2 py-1" disabled={!struck.size} onClick={onCut}>Cut {struck.size} word(s)</button>
        {struck.size > 0 && <button type="button" className="cu-chip px-2 py-1" onClick={() => setStruck(new Set())}>Clear</button>}
        <span className="text-muted/70">Click words to strike them out. One cut is one undo step.</span>
      </div>
    </div>
  )
}
