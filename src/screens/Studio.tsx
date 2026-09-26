import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Clapperboard,
  Download,
  Image as ImageIcon,
  Layers,
  Loader2,
  Pause,
  Play,
  Plus,
  Scissors,
  SkipBack,
  Square,
  Type as TypeIcon,
  Volume2,
  VolumeX,
  ZoomIn,
  ZoomOut,
} from 'lucide-react'
import { Button } from '../components/Button'
import { IconButton } from '../components/IconButton'
import { NoProject } from '../components/NoProject'
import { ProgressBar } from '../components/ProgressBar'
import { StudioInspector } from './studio/StudioInspector'
import { StudioPreview } from './studio/StudioPreview'
import { StudioTimeline } from './studio/StudioTimeline'
import type { StudioClip, StudioDoc, StudioMediaClip } from '../types/project'
import {
  defaultTextClip,
  docDuration,
  nextFreeStart,
  studioOf,
} from '../lib/studio/doc'
import { registerFile } from '../lib/studio/media'
import { exportStudio } from '../lib/studio/export'
import { useActiveProject, useProjectStore } from '../state/useProjectStore'
import { clamp, cx, fmtClock, slugify, uid } from '../lib/utils'

const ZOOM_STEPS = [12, 20, 32, 48, 72, 110, 160]

export function Studio() {
  const project = useActiveProject()
  const patchStudio = useProjectStore((s) => s.patchStudio)
  const addStudioClip = useProjectStore((s) => s.addStudioClip)
  const updateStudioClip = useProjectStore((s) => s.updateStudioClip)
  const removeStudioClip = useProjectStore((s) => s.removeStudioClip)
  const splitStudioClip = useProjectStore((s) => s.splitStudioClip)
  const duplicateStudioClip = useProjectStore((s) => s.duplicateStudioClip)
  const pushToast = useProjectStore((s) => s.pushToast)

  const [time, setTime] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [muted, setMuted] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [zoom, setZoom] = useState(3)
  const [importing, setImporting] = useState(false)
  const [exportPct, setExportPct] = useState<number | null>(null)
  const [lastExport, setLastExport] = useState<{ url: string; fileName: string } | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const cancelRef = useRef<{ cancelled: boolean } | null>(null)

  const doc: StudioDoc = studioOf(project)
  const duration = docDuration(doc)
  const pid = project?.id ?? null
  const selected = useMemo(() => doc.clips.find((c) => c.id === selectedId) ?? null, [doc.clips, selectedId])

  const seek = useCallback(
    (t: number) => setTime(clamp(t, 0, Math.max(0, duration))),
    [duration],
  )

  // Space toggles playback; ⌘/Ctrl+B splits at the playhead. Ignored while a
  // text field has focus so typing a caption never scrubs the timeline.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return
      if (e.code === 'Space') {
        e.preventDefault()
        if (duration > 0) setPlaying((p) => !p)
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'b' && selectedId && pid) {
        e.preventDefault()
        splitStudioClip(pid, selectedId, time)
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedId && pid) {
        e.preventDefault()
        removeStudioClip(pid, selectedId)
        setSelectedId(null)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [duration, pid, removeStudioClip, selectedId, splitStudioClip, time])

  useEffect(() => {
    if (time > duration) setTime(duration)
  }, [duration, time])

  if (!project || !pid) return <NoProject />

  const projectId: string = pid

  async function onFiles(files: FileList | null) {
    if (!files?.length) return
    setImporting(true)
    let start = nextFreeStart(doc, 0, 0, 0.1)
    try {
      for (const file of Array.from(files)) {
        const handle = await registerFile(file)
        const durationSec = handle.kind === 'video' ? Math.max(0.2, handle.durationSec) : 4
        start = nextFreeStart(doc, 0, start, durationSec)
        const clip: StudioMediaClip = {
          id: uid(),
          kind: handle.kind,
          track: 0,
          startSec: start,
          durationSec,
          name: handle.fileName.replace(/\.[^.]+$/, '').slice(0, 28),
          transitionIn: 'fade',
          transitionOut: 'none',
          opacity: 1,
          mediaId: handle.id,
          fileName: handle.fileName,
          localPath: handle.localPath,
          trimInSec: 0,
          sourceDurationSec: handle.kind === 'video' ? handle.durationSec : 0,
          speed: 1,
          volume: 1,
          fit: 'cover',
          posterDataUrl: handle.posterDataUrl,
        }
        addStudioClip(projectId, clip)
        setSelectedId(clip.id)
        start += durationSec
      }
      pushToast('success', `Imported ${files.length} file${files.length > 1 ? 's' : ''}`)
    } catch (err) {
      pushToast('error', err instanceof Error ? err.message : 'Import failed')
    } finally {
      setImporting(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  function addText() {
    const clip = defaultTextClip(time, Math.min(1, doc.trackCount - 1))
    addStudioClip(projectId, clip)
    setSelectedId(clip.id)
  }

  function addBackgroundClip() {
    const clip: StudioClip = {
      id: uid(),
      kind: 'background',
      track: 0,
      startSec: nextFreeStart(doc, 0, time, 4),
      durationSec: 4,
      name: 'Background',
      transitionIn: 'fade',
      transitionOut: 'fade',
      opacity: 1,
      backgroundId: doc.backgroundId,
    }
    addStudioClip(projectId, clip)
    setSelectedId(clip.id)
  }

  async function runExport() {
    if (duration <= 0) {
      pushToast('error', 'Add a clip before exporting.')
      return
    }
    setPlaying(false)
    setExportPct(0)
    const signal = { cancelled: false }
    cancelRef.current = signal
    try {
      const result = await exportStudio(doc, {
        fileName: `${slugify(project?.name ?? 'cupric-studio')}-studio`,
        scale: 1,
        onProgress: setExportPct,
        signal,
      })
      if (result.cancelled) {
        pushToast('info', 'Export cancelled')
      } else {
        setLastExport({ url: result.url, fileName: result.fileName })
        const a = document.createElement('a')
        a.href = result.url
        a.download = result.fileName
        document.body.appendChild(a)
        a.click()
        a.remove()
        pushToast('success', `Exported ${result.fileName}`)
      }
    } catch (err) {
      pushToast('error', err instanceof Error ? err.message : 'Export failed')
    } finally {
      setExportPct(null)
      cancelRef.current = null
    }
  }

  const exporting = exportPct !== null
  const pps = ZOOM_STEPS[zoom]

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Toolbar */}
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-line px-6 py-3">
        <h1 className="mr-2 text-base font-semibold">Studio</h1>

        <Button size="sm" variant="outline" onClick={() => fileRef.current?.click()} disabled={importing || exporting}>
          {importing ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />} Import media
        </Button>
        <input
          ref={fileRef}
          type="file"
          accept="video/*,image/*"
          multiple
          className="hidden"
          onChange={(e) => void onFiles(e.target.files)}
        />
        <Button size="sm" variant="outline" onClick={addText} disabled={exporting}>
          <TypeIcon size={13} /> Text
        </Button>
        <Button size="sm" variant="outline" onClick={addBackgroundClip} disabled={exporting}>
          <ImageIcon size={13} /> Background
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => selectedId && splitStudioClip(projectId, selectedId, time)}
          disabled={!selectedId || exporting}
        >
          <Scissors size={13} /> Split
        </Button>
        {!selectedId && (
          <span className="text-xs text-muted">Select a clip to split it</span>
        )}

        <div className="ml-auto flex items-center gap-1.5">
          <IconButton label="Zoom out" onClick={() => setZoom((z) => Math.max(0, z - 1))} disabled={zoom === 0}>
            <ZoomOut size={15} />
          </IconButton>
          <IconButton
            label="Zoom in"
            onClick={() => setZoom((z) => Math.min(ZOOM_STEPS.length - 1, z + 1))}
            disabled={zoom === ZOOM_STEPS.length - 1}
          >
            <ZoomIn size={15} />
          </IconButton>
          <Button size="sm" variant="primary" onClick={() => void runExport()} disabled={exporting || duration <= 0}>
            {exporting ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />}
            {exporting ? 'Recording…' : 'Export'}
          </Button>
        </div>
      </div>

      {exporting && (
        <div className="flex shrink-0 items-center gap-3 border-b border-line bg-panel px-6 py-2">
          <ProgressBar pct={exportPct ?? 0} className="flex-1" />
          <span className="font-mono text-xs text-muted tabular-nums">{Math.round(exportPct ?? 0)}%</span>
          <span className="text-xs text-muted">
            Recording in real time so audio and motion stay in sync — {Math.ceil(duration)}s.
          </span>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              if (cancelRef.current) cancelRef.current.cancelled = true
            }}
          >
            <Square size={12} /> Stop
          </Button>
        </div>
      )}

      {/* Stage + inspector */}
      <div className="flex min-h-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex min-h-0 flex-1 items-center justify-center bg-bg p-5">
            {doc.clips.length === 0 ? (
              <div className="max-w-md rounded-xl border border-dashed border-line bg-panel/40 px-8 py-12 text-center">
                <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-xl border border-line bg-panel-alt text-muted">
                  <Clapperboard size={19} />
                </div>
                <h2 className="mt-3 text-base font-semibold">Make a video right here</h2>
                <p className="mt-1.5 text-sm leading-relaxed text-muted">
                  Import footage or photos, stack text and backgrounds on the tracks below, then export. Nothing leaves
                  the machine — the preview and the export are the same renderer.
                </p>
                <div className="mt-4">
                  <Button variant="primary" onClick={() => fileRef.current?.click()}>
                    <Plus size={14} /> Import media
                  </Button>
                </div>
              </div>
            ) : (
              <StudioPreview
                doc={doc}
                time={time}
                playing={playing}
                muted={muted}
                duration={Math.max(duration, 0.1)}
                onTimeChange={setTime}
                onEnded={() => {
                  setPlaying(false)
                  setTime(duration)
                }}
              />
            )}
          </div>

          {/* Transport */}
          <div className="flex shrink-0 items-center gap-2 border-t border-line px-6 py-2">
            <IconButton label="Back to start" onClick={() => seek(0)}>
              <SkipBack size={15} />
            </IconButton>
            <IconButton
              label={playing ? 'Pause' : 'Play'}
              onClick={() => duration > 0 && setPlaying((p) => !p)}
              disabled={duration <= 0}
            >
              {playing ? <Pause size={15} /> : <Play size={15} />}
            </IconButton>
            <IconButton label={muted ? 'Unmute' : 'Mute'} onClick={() => setMuted((m) => !m)}>
              {muted ? <VolumeX size={15} /> : <Volume2 size={15} />}
            </IconButton>
            <span className="font-mono text-xs text-muted tabular-nums">
              {fmtClock(time)} / {fmtClock(duration)}
            </span>
            <span className="ml-auto font-mono text-xs text-muted tabular-nums">
              {doc.aspect} · {doc.fps}fps · {doc.clips.length} clip{doc.clips.length === 1 ? '' : 's'}
            </span>
            {lastExport && (
              <a
                href={lastExport.url}
                download={lastExport.fileName}
                className="text-xs text-accent-text underline underline-offset-2"
              >
                Save {lastExport.fileName} again
              </a>
            )}
          </div>

          <div className="h-[46%] min-h-[190px] shrink-0">
            <StudioTimeline
              doc={doc}
              time={time}
              pps={pps}
              duration={duration}
              selectedId={selectedId}
              onSelect={setSelectedId}
              onSeek={(t) => {
                setPlaying(false)
                seek(t)
              }}
              onPatchClip={(id, patch) => updateStudioClip(projectId, id, patch)}
            />
          </div>
        </div>

        <aside className={cx('w-80 shrink-0 overflow-y-auto border-l border-line bg-panel px-5 py-4')}>
          <StudioInspector
            doc={doc}
            clip={selected}
            onPatch={(patch) => selectedId && updateStudioClip(projectId, selectedId, patch)}
            onPatchDoc={(patch) => patchStudio(projectId, patch)}
            onDelete={() => {
              if (!selectedId) return
              removeStudioClip(projectId, selectedId)
              setSelectedId(null)
            }}
            onDuplicate={() => selectedId && duplicateStudioClip(projectId, selectedId)}
            onSplit={() => selectedId && splitStudioClip(projectId, selectedId, time)}
          />

          <div className="mt-6 border-t border-line pt-4">
            <h3 className="flex items-center gap-1.5 text-xs font-semibold text-muted">
              <Layers size={12} /> Tracks
            </h3>
            <p className="mt-1.5 text-xs leading-relaxed text-muted/80">
              Track 1 is the bottom layer. Drag a clip up or down to restack it, drag its edges to trim,
              and press <span className="font-mono">Space</span> to play.
            </p>
          </div>
        </aside>
      </div>
    </div>
  )
}
