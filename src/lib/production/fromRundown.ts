/**
 * Auto pipeline → editable Studio timeline. The pipeline's MP4 is a flat
 * render. This turns its rundown (scenes with copy and timing) into real
 * Studio text clips with NewBrand keyframe motion. They go after your
 * current timeline, and the caller commits them as one undo step. Pure and
 * deterministic. It never invents copy: empty scenes become labelled
 * placeholders.
 */
import type { SceneRundown, StudioClip, StudioDoc, StudioTextClip } from '../../types/project'
import { suggestFont } from '../studio/videoFonts'
import { buildBrief, directProduction, emptyIntake } from './engine'

export function rundownToDoc(doc: StudioDoc, rundown: SceneRundown, makeId: (n: number) => string): { doc: StudioDoc; clipIds: string[]; placeholders: number } {
  const offset = Math.round(doc.clips.reduce((m, c) => Math.max(m, c.startSec + c.durationSec), 0) * 100) / 100
  const track = Math.min(23, doc.clips.reduce((m, c) => Math.max(m, c.track + 1), 0))
  const scenes = [...(rundown.scenes ?? [])].filter((s) => Number.isFinite(s.from) && Number.isFinite(s.to) && s.to > s.from).sort((a, b) => a.from - b.from)
  let placeholders = 0
  const clips: StudioClip[] = scenes.map((s, i) => {
    const text = s.copy?.trim() || (placeholders++, `[${s.type || 'scene'} line]`)
    const clip: StudioTextClip = {
      id: makeId(i), kind: 'text', track, startSec: Math.round((offset + s.from) * 100) / 100, durationSec: Math.round((s.to - s.from) * 100) / 100,
      name: `Auto · ${s.type || 'scene'} ${i + 1}`, transitionIn: 'none', transitionOut: 'none', opacity: 1,
      text, fontSizePct: i === 0 ? 9 : text.length > 40 ? 5.5 : 7, fontFamily: suggestFont(text),
      color: text.startsWith('[') ? '#9A9AA5' : '#F4F1EA', weight: 800, align: 'center', x: 0.5, y: i === 0 ? 0.45 : 0.55, anim: 'none', captionStyle: null, highlightWord: null,
    }
    return clip
  })
  const style = `${rundown.style ?? ''} ${scenes.map((s) => s.motion).join(' ')}`
  const brief = buildBrief({ ...emptyIntake(), making: rundown.title || 'Auto video', referenceStyle: style })
  const next: StudioDoc = { ...doc, clips: [...doc.clips, ...clips], trackCount: Math.max(doc.trackCount, track + 1) }
  const clipIds = clips.map((c) => c.id)
  return { doc: directProduction(next, clipIds, brief), clipIds, placeholders }
}
