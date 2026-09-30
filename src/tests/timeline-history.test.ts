/**
 * The undo boundary, at the level a user experiences it (Phase 1.3).
 *
 * The pure tests next door prove the commands themselves are right. This one
 * proves the thing that made the timeline infuriating to use: that a single drag
 * is a single undo step, however long it took, and that the next drag is always
 * a separate one. Before the merge key, undo boundaries were decided by a 700 ms
 * wall-clock window on the label "Edit clip" — so a slow drag became several
 * steps and one Undo put the clip somewhere the user never put it.
 *
 * The store is the real store: the same one Project Studio uses, with its
 * persistence pointed at an in-memory shim because there is no browser here.
 */
import { beforeAll, describe, expect, it, vi } from 'vitest'
import type { StudioMediaClip, StudioDoc } from '../types/project'

/** Minimal localStorage so the real persist middleware can run under node. */
const memory = new Map<string, string>()
vi.stubGlobal('window', {
  localStorage: {
    getItem: (key: string) => memory.get(key) ?? null,
    setItem: (key: string, value: string) => void memory.set(key, value),
    removeItem: (key: string) => void memory.delete(key),
    clear: () => memory.clear(),
    key: () => null,
    length: 0,
  },
})

type Store = typeof import('../state/useProjectStore')['useProjectStore']
let useProjectStore: Store
let newGesture: typeof import('../lib/studio/commands')['newGesture']

const clip = (id: string, startSec: number, track = 0): StudioMediaClip => ({
  id,
  kind: 'video',
  track,
  startSec,
  durationSec: 2,
  name: id,
  transitionIn: 'none',
  transitionOut: 'none',
  opacity: 1,
  mediaId: `media-${id}`,
  fileName: `${id}.mp4`,
  localPath: null,
  fit: 'cover',
  volume: 1,
  speed: 1,
  trimInSec: 0,
  sourceDurationSec: 30,
})

beforeAll(async () => {
  const store = await import('../state/useProjectStore')
  useProjectStore = store.useProjectStore
  const commands = await import('../lib/studio/commands')
  newGesture = commands.newGesture
})

/** A project with two clips, seeded without touching the undo stack. */
function seed(): { pid: string; doc: () => StudioDoc } {
  const pid = useProjectStore.getState().createProject('Command test')
  const doc: StudioDoc = { ...useProjectStore.getState().projects.find((p) => p.id === pid)!.studio!, fps: 30, trackCount: 3, clips: [clip('a', 0), clip('b', 6)] }
  useProjectStore.setState((s) => ({ projects: s.projects.map((p) => (p.id === pid ? { ...p, studio: doc } : p)), past: [], future: [] }))
  return { pid, doc: () => useProjectStore.getState().projects.find((p) => p.id === pid)!.studio! }
}

const clipAt = (doc: StudioDoc, id: string) => doc.clips.find((c) => c.id === id)!

describe('one drag, one undo step', () => {
  it('collapses every command of a gesture into a single history entry, pause or no pause', async () => {
    const { pid, doc } = seed()
    const gesture = newGesture('drag')
    const before = useProjectStore.getState().past.length
    // 180 pointer events one frame apart: two seconds of dragging, a genuinely
    // long gesture, with a pause in the middle to make the point that no timer
    // decides where the undo step ends.
    for (let i = 0; i < 180; i += 1) {
      useProjectStore.getState().runTimelineCommand(pid, { kind: 'move', clipId: 'b', startSec: 1 + i / 30, track: 1, gesture })
      if (i === 90) await new Promise((resolve) => setTimeout(resolve, 750))
    }
    expect(useProjectStore.getState().past.length - before).toBe(1)
    expect(clipAt(doc(), 'b').startSec).toBeCloseTo(1 + 179 / 30, 6)

    // One Undo returns the clip to where the drag started.
    useProjectStore.getState().undo()
    expect(clipAt(doc(), 'b').startSec).toBe(6)
    expect(clipAt(doc(), 'b').track).toBe(0)
  })

  it('keeps two gestures apart even when they are identical and back to back', () => {
    const { pid } = seed()
    const before = useProjectStore.getState().past.length
    const first = newGesture('drag')
    const second = newGesture('drag')
    useProjectStore.getState().runTimelineCommand(pid, { kind: 'move', clipId: 'b', startSec: 3, gesture: first })
    useProjectStore.getState().runTimelineCommand(pid, { kind: 'move', clipId: 'b', startSec: 3.5, gesture: first })
    useProjectStore.getState().runTimelineCommand(pid, { kind: 'move', clipId: 'b', startSec: 8, gesture: second })
    expect(useProjectStore.getState().past.length - before).toBe(2)

    useProjectStore.getState().undo()
    expect(clipAt(useProjectStore.getState().projects.find((p) => p.id === pid)!.studio!, 'b').startSec).toBeCloseTo(3.5, 2)
    useProjectStore.getState().undo()
    expect(clipAt(useProjectStore.getState().projects.find((p) => p.id === pid)!.studio!, 'b').startSec).toBe(6)
  })

  it('gives a gesture that does nothing no history entry at all', () => {
    const { pid } = seed()
    const before = useProjectStore.getState().past.length
    const gesture = newGesture('drag')
    useProjectStore.getState().runTimelineCommand(pid, { kind: 'move', clipId: 'b', startSec: 6, gesture })
    useProjectStore.getState().runTimelineCommand(pid, { kind: 'move', clipId: 'b', startSec: 6, gesture })
    expect(useProjectStore.getState().past.length - before).toBe(0)
  })

  it('gives each non-gesture command its own step, however fast they come', () => {
    const { pid, doc } = seed()
    const before = useProjectStore.getState().past.length
    useProjectStore.getState().runTimelineCommand(pid, { kind: 'delete', clipId: 'a' })
    useProjectStore.getState().runTimelineCommand(pid, { kind: 'trim', clipId: 'b', edge: 'end', atSec: 7.5 })
    useProjectStore.getState().runTimelineCommand(pid, { kind: 'split', clipId: 'b', atSec: 6.6 })
    expect(useProjectStore.getState().past.length - before).toBe(3)
    // 'a' was deleted, and 'b' was trimmed (6 → 7.5 s) and then split into two:
    // the left half keeps the clip's id, the right half is a new clip.
    expect(doc().clips).toHaveLength(2)
    expect(doc().clips.filter((c) => c.id === 'b')).toHaveLength(1)
    expect(doc().clips.map((c) => c.startSec).sort((x, y) => x - y)).toEqual([6, 6.6])
  })

  it('redoes a whole gesture in one step', () => {
    const { pid } = seed()
    const gesture = newGesture('drag')
    for (let i = 0; i < 40; i += 1) useProjectStore.getState().runTimelineCommand(pid, { kind: 'move', clipId: 'b', startSec: 2 + i / 30, track: 2, gesture })
    useProjectStore.getState().undo()
    const studio = () => useProjectStore.getState().projects.find((p) => p.id === pid)!.studio!
    expect(clipAt(studio(), 'b').startSec).toBe(6)
    useProjectStore.getState().redo()
    expect(clipAt(studio(), 'b').startSec).toBeCloseTo(2 + 39 / 30, 6)
    expect(clipAt(studio(), 'b').track).toBe(2)
  })

  it('tells the person why a command did nothing instead of failing silently', () => {
    const { pid } = seed()
    const before = useProjectStore.getState().toasts.length
    // The playhead is at 0, which is the very start of clip 'a' — there is
    // nothing to split there, and the split says so.
    useProjectStore.getState().runTimelineCommand(pid, { kind: 'split', clipId: 'a', atSec: 0 })
    const toasts = useProjectStore.getState().toasts
    expect(toasts.length).toBeGreaterThan(before)
    expect(toasts[toasts.length - 1].text).toMatch(/inside the clip/i)
  })
})
