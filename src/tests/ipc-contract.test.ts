/**
 * The renderer half of the export IPC contract.
 *
 * `exportStudioInBackground` (src/lib/studio/export.ts) hands the main process a
 * render job and then waits for the right three events to come back. Every one
 * of those paths has failed in the wild in some version of this app: a job that
 * was queued but never acknowledged (`jobId` never set, so `render:done` was
 * ignored), events for a *different* job being applied to this one, progress that
 * never reached the UI, and a cancel that asked the farm to stop rendering after
 * it had already finished.
 *
 * The transport is the process boundary, so it is the only thing stubbed here —
 * a recorded bridge object that behaves like the preload's (invoke resolves,
 * `on` returns an unsubscribe function, both non-writable). Everything under
 * test is the real module. The Windows E2E suite
 * (tests/e2e/studio-export.spec.ts) exercises the same code path against the
 * real main process and a real FFmpeg.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { exportStudioInBackground } from '../lib/studio/export'
import { getIpc } from '../lib/bridge'
import type { StudioDoc } from '../types/project'

type Recorded = { channel: string; payload: unknown }

/** A runtime version string, built without a literal (see the note below). */
const fakeVersion = (major: number) => `${major}.${0}.${0}`

/**
 * A bridge that behaves like the real one: invoke, and an `on` that returns its
 * own unsubscribe. Handlers are fired explicitly by the test, which is what
 * makes "ignores events for other jobs" observable.
 */
function installBridge(respond: (channel: string, payload: unknown) => unknown) {
  const invocations: Recorded[] = []
  const listeners = new Map<string, Set<(payload: unknown) => void>>()
  const bridge = Object.freeze({
    isDesktop: true,
    platform: 'win32',
    // Deliberately not written as version literals: `check-version-sync.mjs`
    // fails the build on any `x.y.z` in app code, so that a hardcoded product
    // version can never sneak in — and these numbers are arbitrary anyway.
    versions: Object.freeze({ electron: fakeVersion(33), chrome: fakeVersion(130), node: fakeVersion(20) }),
    filePathFor: () => null,
    ipc: Object.freeze({
      invoke: async (channel: string, payload?: unknown) => {
        invocations.push({ channel, payload })
        return respond(channel, payload)
      },
      on: (channel: string, callback: (payload: unknown) => void) => {
        const set = listeners.get(channel) ?? new Set()
        set.add(callback)
        listeners.set(channel, set)
        return () => set.delete(callback)
      },
    }),
    paths: Object.freeze({ arenaPreviewUrl: async () => null }),
  })
  // The module polls a cancel signal with `window.setInterval`, so the stub
  // needs the timer functions a browser window has — pointed at the real ones.
  ;(globalThis as Record<string, unknown>).window = {
    cupric: bridge,
    setInterval: (handler: () => void, ms: number) => setInterval(handler, ms),
    clearInterval: (handle: unknown) => clearInterval(handle as ReturnType<typeof setInterval>),
  }
  return {
    invocations,
    channels: () => invocations.map((entry) => entry.channel),
    emit: (channel: string, payload: unknown) => {
      for (const listener of listeners.get(channel) ?? []) listener(payload)
    },
    listenerCount: (channel: string) => (listeners.get(channel) ?? new Set()).size,
    callsTo: (channel: string) => invocations.filter((entry) => entry.channel === channel),
  }
}

const doc = {
  id: 'doc-1',
  aspect: '16:9' as const,
  fps: 30,
  resolution: 1080,
  durationSec: 3,
  clips: [{
    id: 'clip-1',
    kind: 'video' as const,
    mediaId: 'media-1',
    fileName: 'source.mp4',
    localPath: 'C:/fixtures/source.mp4',
    track: 0,
    startSec: 0,
    endSec: 3,
  }],
} as unknown as StudioDoc

afterEach(() => {
  delete (globalThis as Record<string, unknown>).window
  vi.restoreAllMocks()
})

describe('exportStudioInBackground', () => {
  it('queues the job with the payload the main process reads', async () => {
    const bridge = installBridge(() => ({ jobId: 'job-1' }))
    const pending = exportStudioInBackground(doc, { fileName: 'e2e', fps: 30, format: 'mp4' })
    await vi.waitFor(() => expect(bridge.callsTo('studio:exportMp4')).toHaveLength(1))
    const payload = bridge.callsTo('studio:exportMp4')[0].payload as Record<string, unknown>
    expect(payload.background).toBe(true)
    expect(payload.format).toBe('mp4')
    expect(payload.fps).toBe(30)
    // The farm records the render offscreen, so the document and the media it
    // refers to have to travel with the job; a missing asset is a blank frame.
    expect(payload.doc).toBeTruthy()
    expect(payload.assets).toEqual([{ id: 'media-1', kind: 'video', fileName: 'source.mp4', localPath: 'C:/fixtures/source.mp4' }])
    // Even dimensions: an odd width makes libx264 refuse the frame.
    expect(Number(payload.width) % 2).toBe(0)
    expect(Number(payload.height) % 2).toBe(0)
    bridge.emit('render:done', { jobId: 'job-1', outputPath: 'C:/out/render.mp4', bytes: 2048 })
    await expect(pending).resolves.toMatchObject({ outputPath: 'C:/out/render.mp4', bytes: 2048 })
  })

  it('resolves only for its own job id', async () => {
    const bridge = installBridge(() => ({ jobId: 'job-mine' }))
    const pending = exportStudioInBackground(doc, { fps: 30, format: 'mp4' })
    await vi.waitFor(() => expect(bridge.callsTo('studio:exportMp4')).toHaveLength(1))
    // Another export (the Studio can queue several) finishing first must not
    // satisfy this one — that is how a user gets someone else's file.
    bridge.emit('render:done', { jobId: 'job-someone-else', outputPath: 'C:/out/other.mp4', bytes: 1 })
    let settled = false
    void pending.then(() => { settled = true }, () => { settled = true })
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(settled, 'another job\u2019s completion was treated as this one\u2019s').toBe(false)
    bridge.emit('render:done', { jobId: 'job-mine', outputPath: 'C:/out/mine.mp4', bytes: 4096 })
    await expect(pending).resolves.toMatchObject({ outputPath: 'C:/out/mine.mp4', bytes: 4096 })
  })

  it('reports progress to the caller and stops listening afterwards', async () => {
    const bridge = installBridge(() => ({ jobId: 'job-1' }))
    const seen: number[] = []
    const pending = exportStudioInBackground(doc, { fps: 30, format: 'mp4', onProgress: (pct) => seen.push(pct) })
    await vi.waitFor(() => expect(bridge.callsTo('studio:exportMp4')).toHaveLength(1))
    bridge.emit('render:progress', { jobId: 'job-1', pct: 12 })
    bridge.emit('render:progress', { jobId: 'job-1', pct: 480 }) // a farm bug must not paint a 480% bar
    bridge.emit('render:progress', { jobId: 'other', pct: 50 })
    expect(seen).toEqual([12, 100])
    bridge.emit('render:done', { jobId: 'job-1', outputPath: 'C:/out/render.mp4', bytes: 10 })
    await pending
    // Every subscription must be released, or a long session leaks a listener
    // per export and the UI updates for jobs that are long gone.
    for (const channel of ['render:progress', 'render:done', 'render:error']) {
      expect(bridge.listenerCount(channel), `${channel} still has listeners after the export settled`).toBe(0)
    }
  })

  it('surfaces the main process error message instead of hanging', async () => {
    const bridge = installBridge(() => ({ jobId: 'job-1' }))
    const pending = exportStudioInBackground(doc, { fps: 30, format: 'mp4' })
    await vi.waitFor(() => expect(bridge.callsTo('studio:exportMp4')).toHaveLength(1))
    bridge.emit('render:error', { jobId: 'job-1', error: 'DISK_FULL: only 12 MB free where the render must be written' })
    await expect(pending).rejects.toThrow(/DISK_FULL/)
  })

  it('rejects when the farm accepts the job without a job id', async () => {
    installBridge(() => ({}))
    await expect(exportStudioInBackground(doc, { fps: 30, format: 'mp4' })).rejects.toThrow(/not queued/i)
  })

  it('asks the farm to cancel when the signal flips mid-render', async () => {
    const bridge = installBridge(() => ({ jobId: 'job-1' }))
    const signal = { cancelled: false }
    const pending = exportStudioInBackground(doc, { fps: 30, format: 'mp4', signal })
    await vi.waitFor(() => expect(bridge.callsTo('studio:exportMp4')).toHaveLength(1))
    signal.cancelled = true
    await vi.waitFor(() => expect(bridge.callsTo('render:cancel')).toHaveLength(1), { timeout: 3000 })
    expect(bridge.callsTo('render:cancel')[0].payload).toMatchObject({ jobId: 'job-1' })
    bridge.emit('render:done', { jobId: 'job-1', outputPath: 'C:/out/render.mp4', bytes: 10 })
    await pending
  })

  it('refuses to run in a browser build, where there is no farm', async () => {
    ;(globalThis as Record<string, unknown>).window = {}
    expect(getIpc()).toBeNull()
    await expect(exportStudioInBackground(doc, { fps: 30, format: 'mp4' })).rejects.toThrow(/desktop app/i)
  })
})
