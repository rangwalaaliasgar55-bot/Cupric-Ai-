import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from 'react'
import {
  Boxes,
  Clapperboard,
  Download,
  Image as ImageIcon,
  Layers,
  Loader2,
  Mic,
  MicOff,
  Music,
  Pause,
  Play,
  Plus,
  Scissors,
  Sparkles,
  SkipBack,
  AlertTriangle,
  CheckCircle2,
  Sticker,
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
import { PackBrowser } from './library/PackBrowser'
import type { StudioAudioClip, StudioClip, StudioDoc, StudioMediaClip } from '../types/project'
import {
  defaultAudioClip,
  defaultGlassClip,
  defaultStickerClip,
  defaultTextClip,
  docDuration,
  MIN_CLIP_SEC,
  nextFreeStart,
  studioOf,
} from '../lib/studio/doc'
import { STUDIO_BACKGROUNDS } from '../lib/studio/backgrounds'
import { TRANSITIONS } from '../lib/studio/transitions'
import { isVoiceSupported, speak, VOICE_PHRASES, VoiceListener, type VoiceCommand } from '../lib/voice'
import { hasMedia, registerFile } from '../lib/studio/media'
import { readDragPayload, resourceToStudio } from '../lib/studio/resourceDrop'
import { canExportMp4, convertToMp4, exportStudio } from '../lib/studio/export'
import { useActiveProject, useProjectStore } from '../state/useProjectStore'
import { lintStudioDoc } from '../lib/studio/lint'
import { cueDone, cueProblem } from '../lib/sound'
import { clamp, cx, fmtClock, slugify, uid } from '../lib/utils'
import { humanError } from '../lib/humanError'
import { getIpc } from '../lib/bridge'
import { patchTransformKeyframe } from '../lib/studio/keyframeEdit'
import { parseGeneratedHtml, piecesToStudioClips } from '../lib/studio/importHtml'
import { readGeneratedPackage } from '../lib/studio/generatedPackage'
import reactBitsCatalog from '../../resources/react-bits/catalog.json'
import skiperCatalog from '../../resources/skiper/catalog.json'
import remotionCatalog from '../../resources/remotion/catalog.json'
import {
  applyStudioEditPlan,
  describeStudioEditOp,
  localStudioEditPlan,
  validateStudioEditPlan,
  type StudioEditPlan,
} from '../lib/studio/editOps'

const ZOOM_STEPS = [12, 20, 32, 48, 72, 110, 160]

export function Studio() {
  const project = useActiveProject()
  const patchStudio = useProjectStore((s) => s.patchStudio)
  const addStudioClip = useProjectStore((s) => s.addStudioClip)
  const updateStudioClip = useProjectStore((s) => s.updateStudioClip)
  const undo = useProjectStore((s) => s.undo)
  const redo = useProjectStore((s) => s.redo)
  const removeStudioClip = useProjectStore((s) => s.removeStudioClip)
  const splitStudioClip = useProjectStore((s) => s.splitStudioClip)
  const duplicateStudioClip = useProjectStore((s) => s.duplicateStudioClip)
  const reorderStudioTracks = useProjectStore((s) => s.reorderStudioTracks)
  const pushToast = useProjectStore((s) => s.pushToast)
  const setView = useProjectStore((s) => s.setView)
  const startAutomationJob = useProjectStore((s) => s.startAutomationJob)

  const [time, setTime] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [muted, setMuted] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [zoom, setZoom] = useState(3)
  const [importing, setImporting] = useState(false)
  const [exportPct, setExportPct] = useState<number | null>(null)
  const [lastExport, setLastExport] = useState<{ url: string; fileName: string } | null>(null)
  const [listening, setListening] = useState(false)
  const [heard, setHeard] = useState<string | null>(null)
  const [showVoiceHelp, setShowVoiceHelp] = useState(false)
  const [showChecks, setShowChecks] = useState(false)
  const [showSafeAreas, setShowSafeAreas] = useState(true)
  const [keyframeRecord, setKeyframeRecord] = useState(false)
  const [showResources, setShowResources] = useState(false)
  const [agentInstruction, setAgentInstruction] = useState('')
  const [agentPlanning, setAgentPlanning] = useState(false)
  const [agentPhase, setAgentPhase] = useState('')
  const [agentPlan, setAgentPlan] = useState<StudioEditPlan | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const audioRef = useRef<HTMLInputElement>(null)
  const [dropActive, setDropActive] = useState(false)
  const cancelRef = useRef<{ cancelled: boolean } | null>(null)
  const voiceRef = useRef<VoiceListener | null>(null)
  const commandRef = useRef<(command: VoiceCommand) => void>(() => {})
  const voiceSupported = useMemo(() => isVoiceSupported(), [])
  const mp4Supported = useMemo(() => canExportMp4(), [])
  const doc: StudioDoc = studioOf(project)
  const duration = docDuration(doc)
  // Recomputed from the document, never stored: a stale warning is worse than
  // no warning.
  const issues = useMemo(() => lintStudioDoc(doc, { hasMedia }), [doc])
  const pid = project?.id ?? null
  const selected = useMemo(() => doc.clips.find((c) => c.id === selectedId) ?? null, [doc.clips, selectedId])

  const seek = useCallback(
    (t: number) => setTime(clamp(t, 0, Math.max(0, duration))),
    [duration],
  )

  /**
   * Editor shortcuts.
   *
   * Direct editing keys: S splits and K records a keyframe, I/O set trim
   * points, J/L shuttle, space plays and ⌘Z undoes. Ignored while a text field
   * has focus so typing a
   * caption never scrubs the timeline.
   */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      if (target && (/^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName) || target.isContentEditable)) return

      const key = e.key.toLowerCase()
      const mod = e.metaKey || e.ctrlKey

      if (mod && key === 'z') {
        e.preventDefault()
        if (e.shiftKey) redo()
        else undo()
        return
      }
      if (mod && key === 'y') {
        e.preventDefault()
        redo()
        return
      }

      if (e.code === 'Space') {
        e.preventDefault()
        if (duration > 0) setPlaying((p) => !p)
        return
      }

      // J/K/L. J and L step the playhead; held down they act as shuttle,
      // because the key repeat does the stepping for us.
      if (!mod && key === 'l') {
        e.preventDefault()
        if (playing) seek(time + 0.5)
        else if (duration > 0) setPlaying(true)
        return
      }
      if (!mod && key === 'k') {
        e.preventDefault()
        if (!selectedId || !pid) {
          pushToast('info', 'Select a clip before adding a keyframe.')
          return
        }
        const clip = doc.clips.find((item) => item.id === selectedId)
        if (!clip || time < clip.startSec || time > clip.startSec + clip.durationSec) {
          pushToast('info', 'Move the playhead over the selected clip first.')
          return
        }
        const patch = patchTransformKeyframe(clip, time, {}, true)
        if (patch) {
          updateStudioClip(pid, selectedId, patch)
          pushToast('success', `Keyframe added at ${(time - clip.startSec).toFixed(2)}s.`)
        }
        return
      }
      if (!mod && key === 'j') {
        e.preventDefault()
        setPlaying(false)
        seek(time - 0.5)
        return
      }

      // I and O trim the selected clip to the playhead — the in and out points.
      if (!mod && (key === 'i' || key === 'o') && selectedId && pid) {
        const clip = doc.clips.find((c) => c.id === selectedId)
        if (!clip) return
        e.preventDefault()
        const end = clip.startSec + clip.durationSec
        if (key === 'i') {
          const startSec = clamp(time, 0, end - MIN_CLIP_SEC)
          updateStudioClip(pid, selectedId, { startSec, durationSec: end - startSec })
        } else {
          const durationSec = Math.max(MIN_CLIP_SEC, time - clip.startSec)
          updateStudioClip(pid, selectedId, { durationSec })
        }
        return
      }

      // Arrows nudge the playhead a frame at a time; Shift makes it a second.
      if (!mod && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
        e.preventDefault()
        const step = e.shiftKey ? 1 : 1 / doc.fps
        seek(time + (e.key === 'ArrowRight' ? step : -step))
        return
      }

      if (!mod && key === 's' && selectedId && pid) {
        e.preventDefault()
        splitStudioClip(pid, selectedId, time)
        return
      }
      // Keep the older command available for existing users.
      if (mod && key === 'b' && selectedId && pid) {
        e.preventDefault()
        splitStudioClip(pid, selectedId, time)
        return
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedId && pid) {
        e.preventDefault()
        removeStudioClip(pid, selectedId)
        setSelectedId(null)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [doc, duration, pid, playing, redo, removeStudioClip, seek, selectedId, splitStudioClip, time, undo, updateStudioClip])

  useEffect(() => {
    if (time > duration) setTime(duration)
  }, [duration, time])

  // The listener is created once and torn down on unmount; commands are
  // dispatched through a ref so the handler always sees fresh state.
  useEffect(() => {
    return () => {
      voiceRef.current?.stop()
      voiceRef.current = null
    }
  }, [])

  const toggleVoice = useCallback(() => {
    if (voiceRef.current?.active) {
      voiceRef.current.stop()
      voiceRef.current = null
      setListening(false)
      setHeard(null)
      return
    }
    const listener = new VoiceListener({
      onTranscript: (text, isFinal) => {
        if (text) setHeard(isFinal ? text : `${text}\u2026`)
      },
      onCommand: (command, transcript) => {
        setHeard(transcript)
        commandRef.current(command)
      },
      onUnrecognised: (transcript) => {
        setHeard(`\u201c${transcript}\u201d \u2014 not a command`)
      },
      onError: (message) => {
        pushToast('error', message)
        setListening(false)
      },
      onEnd: () => setListening(false),
    })
    if (listener.start()) {
      voiceRef.current = listener
      setListening(true)
      setHeard('Listening\u2026')
    } else {
      pushToast('error', 'Voice recognition is unavailable in this Windows/Electron build. Check microphone permission and install the latest Web Speech components; keyboard and typed agent commands remain available.')
    }
  }, [pushToast])

  if (!project || !pid) return <NoProject />

  const projectId: string = pid

  async function planAgentEdit(request?: string) {
    const instruction = (request ?? agentInstruction).trim()
    if (!instruction || agentPlanning) return
    setAgentPlanning(true)
    setAgentPlan(null)
    const phases = ['Reading timeline and selected clips', 'Matching motion, fonts and effects', 'Directing keyframes and track changes', 'Validating a safe edit plan']
    let phaseIndex = 0
    setAgentPhase(phases[0])
    const phaseTimer = window.setInterval(() => {
      phaseIndex = Math.min(phases.length - 1, phaseIndex + 1)
      setAgentPhase(phases[phaseIndex])
    }, 3500)
    try {
      const ipc = getIpc()
      let raw: unknown
      if (ipc) {
        // Hundreds of full catalogue names made small local models crawl and
        // could leave the button spinning for minutes. Send the best matching
        // references plus a compact fallback sample instead.
        const terms = instruction.toLowerCase().split(/[^a-z0-9]+/).filter((term) => term.length > 2)
        const relevantNames = (items: Array<{ name: string }>, limit = 36) => {
          const ranked = items
            .map((item, index) => ({ name: item.name, index, score: terms.reduce((sum, term) => sum + (item.name.toLowerCase().includes(term) ? 1 : 0), 0) }))
            .sort((a, b) => b.score - a.score || a.index - b.index)
          return ranked.slice(0, limit).map((item) => item.name)
        }
        const context = {
          aspect: doc.aspect,
          fps: doc.fps,
          trackCount: doc.trackCount,
          selectedId,
          // Names only: the agent uses these attributed libraries as visual
          // vocabulary, then translates the idea into Cupric's safe native
          // operations. Third-party source is never sent, copied or executed.
          motionReferences: {
            reactBits: relevantNames(reactBitsCatalog.items),
            skiperUi: relevantNames(skiperCatalog.items),
            remotionPackages: relevantNames(remotionCatalog.packages ?? []),
          },
          clips: doc.clips.map((clip) => ({
            id: clip.id,
            kind: clip.kind,
            name: clip.name,
            track: clip.track,
            startSec: clip.startSec,
            durationSec: clip.durationSec,
            opacity: clip.opacity,
            rotation: clip.rotation ?? 0,
            ...('x' in clip ? { x: clip.x, y: clip.y } : {}),
            ...(clip.kind === 'text' ? { text: clip.text, color: clip.color, fontSizePct: clip.fontSizePct, fontFamily: clip.fontFamily, anim: clip.anim } : {}),
            keyframes: clip.keyframes ?? [],
          })),
        }
        try {
          raw = await ipc.invoke('studio:planEdits', { instruction, context })
        } catch (err) {
          const local = localStudioEditPlan(instruction, doc, selectedId)
          raw = { ...local, warning: `Live agent unavailable: ${humanError(err, 'AI connection')}` }
        }
      } else {
        raw = localStudioEditPlan(instruction, doc, selectedId)
      }
      setAgentPlan(validateStudioEditPlan(raw, doc))
    } catch (err) {
      pushToast('error', humanError(err, 'Could not plan that edit'))
    } finally {
      window.clearInterval(phaseTimer)
      setAgentPlanning(false)
      setAgentPhase('')
    }
  }

  function acceptAgentPlan() {
    if (!agentPlan) return
    try {
      // Validate again against the current timeline in case it changed while the plan was visible.
      const currentPlan = validateStudioEditPlan(agentPlan, doc)
      const next = applyStudioEditPlan(doc, currentPlan.ops)
      patchStudio(projectId, next)
      pushToast('success', `Applied ${currentPlan.ops.length} agent edit${currentPlan.ops.length === 1 ? '' : 's'} as one undo step.`)
      setAgentPlan(null)
      setAgentInstruction('')
    } catch (err) {
      pushToast('error', humanError(err, 'The timeline changed; preview this edit again'))
      setAgentPlan(null)
    }
  }

  async function onFiles(files: FileList | null) {
    if (!files?.length) return
    setImporting(true)
    let start = nextFreeStart(doc, 0, 0, 0.1)
    try {
      for (const file of Array.from(files)) {
        if (/\.(?:zip|html?)$/i.test(file.name)) {
          const generated = await readGeneratedPackage(file)
          const piece = parseGeneratedHtml(generated.html)
          if (!piece) throw new Error(`${file.name} has HTML, but no readable scene manifest, scene array, headings or paragraphs`)
          const clips = piecesToStudioClips(piece, doc, generated.name.replace(/\.html?$/i, ''))
          if (!clips.length) throw new Error(`${file.name} did not contain any editable scenes`)
          for (const clip of clips) addStudioClip(projectId, clip)
          setSelectedId(clips[0].id)
          pushToast('success', `Broke ${file.name} into ${clips.length} editable Studio clips (${piece.via}).`)
          continue
        }
        const handle = await registerFile(file)
        if (handle.kind === 'audio') {
          // Music gets its own track (the last one) so it never fights the
          // picture tracks for space when the edit is re-stacked.
          const audioTrack = Math.max(0, doc.trackCount - 1)
          const clip: StudioAudioClip = defaultAudioClip(
            nextFreeStart(doc, audioTrack, 0, Math.max(0.2, handle.durationSec)),
            audioTrack,
            { id: handle.id, fileName: handle.fileName, localPath: handle.localPath, durationSec: handle.durationSec },
          )
          addStudioClip(projectId, clip)
          setSelectedId(clip.id)
          continue
        }
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
          x: 0.5,
          y: 0.5,
          scale: 1,
          posterDataUrl: handle.posterDataUrl,
        }
        addStudioClip(projectId, clip)
        setSelectedId(clip.id)
        start += durationSec
      }
      pushToast('success', `Imported ${files.length} file${files.length > 1 ? 's' : ''}`)
    } catch (err) {
      pushToast('error', humanError(err, 'Import'))
    } finally {
      setImporting(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  /**
   * Resources dropped onto the stage.
   *
   * Both real files and Library items land here. Anything the renderer cannot
   * actually draw is refused out loud instead of being inserted as a dead
   * placeholder — that silent placeholder was the original bug.
   */
  function onStageDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault()
    setDropActive(false)
    if (event.dataTransfer.files?.length) {
      void onFiles(event.dataTransfer.files)
      return
    }
    const payload = readDragPayload(event.dataTransfer)
    if (!payload) {
      pushToast('info', 'Nothing droppable in that drag — try a card from Library → Resource packs.')
      return
    }
    const result = resourceToStudio(doc, payload, time)
    if (!result.ok) {
      pushToast('info', result.reason)
      return
    }
    if ('action' in result) {
      sessionStorage.setItem('cupric:lab-open', result.labSlug)
      setView('lab')
      pushToast('info', result.message)
      return
    }
    if ('clip' in result) {
      addStudioClip(projectId, result.clip)
      setSelectedId(result.clip.id)
    } else {
      patchStudio(projectId, result.docPatch)
    }
    pushToast('success', result.message)
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

  function addSticker() {
    const track = Math.min(1, doc.trackCount - 1)
    const clip = defaultStickerClip(nextFreeStart(doc, track, time, 2), track)
    addStudioClip(projectId, clip)
    setSelectedId(clip.id)
  }

  function addGlassClip(shape: 'panel' | 'lens' = 'panel', presetId = 'hero') {
    const clip = defaultGlassClip(nextFreeStart(doc, Math.min(1, doc.trackCount - 1), time, 3), Math.min(1, doc.trackCount - 1), presetId, shape)
    addStudioClip(projectId, clip)
    setSelectedId(clip.id)
  }

  /**
   * Voice commands run through the same store actions as the buttons — there
   * is no second code path that could drift from the UI.
   */
  function runVoiceCommand(command: VoiceCommand) {
    switch (command.type) {
      case 'play':
        if (duration > 0) setPlaying(true)
        break
      case 'pause':
      case 'stop':
        setPlaying(false)
        break
      case 'seek-start':
        setPlaying(false)
        seek(0)
        break
      case 'seek-end':
        setPlaying(false)
        seek(duration)
        break
      case 'seek-to':
        setPlaying(false)
        seek(command.seconds)
        break
      case 'nudge':
        seek(time + command.seconds)
        break
      case 'split':
        if (selectedId) splitStudioClip(projectId, selectedId, time)
        else pushToast('info', 'Select a clip first.')
        break
      case 'delete':
        if (selectedId) {
          removeStudioClip(projectId, selectedId)
          setSelectedId(null)
        }
        break
      case 'duplicate':
        if (selectedId) duplicateStudioClip(projectId, selectedId)
        break
      case 'add-text': {
        const clip = defaultTextClip(nextFreeStart(doc, Math.min(1, doc.trackCount - 1), time, 3), Math.min(1, doc.trackCount - 1))
        if (command.text) clip.text = command.text
        addStudioClip(projectId, clip)
        setSelectedId(clip.id)
        break
      }
      case 'add-background': {
        const wanted = command.name?.toLowerCase().replace(/\s+/g, '')
        const match = wanted
          ? STUDIO_BACKGROUNDS.find(
              (b) => b.id.replace(/-/g, '') === wanted || b.name.toLowerCase().replace(/\s+/g, '') === wanted,
            )
          : undefined
        const clip: StudioClip = {
          id: uid(),
          kind: 'background',
          track: 0,
          startSec: nextFreeStart(doc, 0, time, 4),
          durationSec: 4,
          name: match?.name ?? 'Background',
          transitionIn: 'fade',
          transitionOut: 'fade',
          opacity: 1,
          backgroundId: match?.id ?? doc.backgroundId,
        }
        addStudioClip(projectId, clip)
        setSelectedId(clip.id)
        if (command.name && !match) pushToast('info', `No background called \u201c${command.name}\u201d \u2014 used the current one.`)
        break
      }
      case 'add-glass': {
        const wanted = (command.preset ?? '').toLowerCase()
        const shape = wanted.includes('lens') ? 'lens' : 'panel'
        const preset = ['hero', 'portfolio', 'plaque', 'liquid', 'frost', 'lens'].find((id) => wanted.includes(id))
        addGlassClip(shape, preset ?? (shape === 'lens' ? 'lens' : 'hero'))
        break
      }
      case 'set-transition': {
        const match = TRANSITIONS.find(
          (t) => t.id === command.transition || t.name.toLowerCase().replace(/\s+/g, '-') === command.transition,
        )
        if (!match) pushToast('info', `No transition called \u201c${command.transition}\u201d.`)
        else if (!selectedId) pushToast('info', 'Select a clip first.')
        else updateStudioClip(projectId, selectedId, { transitionIn: match.id })
        break
      }
      case 'zoom':
        setZoom((z) => clamp(command.direction === 'in' ? z + 1 : z - 1, 0, ZOOM_STEPS.length - 1))
        break
      case 'mute':
        setMuted(command.on)
        break
      case 'export':
        void runExport()
        break
      case 'make-video': {
        // Same store action the Autonomous screen calls — speaking a brief in
        // the Studio hands the whole sentence to the pipeline rather than
        // trying to build it clip by clip.
        startAutomationJob({
          brief: command.brief,
          footageFolder: null,
          outputFolder: null,
          aspect: doc.aspect,
          fps: doc.fps === 60 ? 60 : 30,
          quality: 'draft',
          mode: 'auto-draft',
          votingMode: 'local-scoring',
        })
        speak(`Starting an autonomous job for ${command.brief}.`, { interrupt: true })
        break
      }
      case 'undo':
        pushToast('info', 'Undo is on the keyboard only for now.')
        break
    }
  }

  commandRef.current = runVoiceCommand

  async function runExport(asMp4 = false) {
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
      } else if (asMp4) {
        pushToast('info', 'Converting to MP4 with FFmpeg\u2026')
        const mp4 = await convertToMp4(result.blob, slugify(project?.name ?? 'cupric-studio'), doc.fps)
        setLastExport({ url: result.url, fileName: result.fileName })
        pushToast('success', `Saved ${mp4.outputPath.split(/[\\/]/).pop()} (${Math.round(mp4.bytes / 1024)} KB)`)
        cueDone()
      } else {
        setLastExport({ url: result.url, fileName: result.fileName })
        const a = document.createElement('a')
        a.href = result.url
        a.download = result.fileName
        document.body.appendChild(a)
        a.click()
        a.remove()
        pushToast('success', `Exported ${result.fileName}`)
        cueDone()
      }
    } catch (err) {
      pushToast('error', humanError(err, 'Export'))
      cueProblem()
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
          {importing ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />} Import media / HTML / ZIP
        </Button>
        <input
          ref={fileRef}
          type="file"
          accept="video/*,image/*,audio/*,.zip,.html,.htm"
          multiple
          className="hidden"
          onChange={(e) => void onFiles(e.target.files)}
        />
        <Button size="sm" variant="outline" onClick={() => audioRef.current?.click()} disabled={importing || exporting}>
          <Music size={13} /> Music
        </Button>
        <input
          ref={audioRef}
          type="file"
          accept="audio/*"
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
        <Button size="sm" variant="outline" onClick={() => addGlassClip('panel')} disabled={exporting}>
          <Sparkles size={13} /> Glass
        </Button>
        <Button size="sm" variant="outline" onClick={addSticker} disabled={exporting}>
          <Sticker size={13} /> Sticker
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
        <Button
          size="sm"
          variant={showResources ? 'primary' : 'outline'}
          onClick={() => setShowResources((shown) => !shown)}
          disabled={exporting}
        >
          <Boxes size={13} /> Resources
        </Button>

        <Button
          size="sm"
          variant={listening ? 'primary' : 'outline'}
          onClick={toggleVoice}
          disabled={exporting}
          title={voiceSupported ? 'Voice commands' : 'Voice needs microphone/Web Speech support; click for help'}
        >
          {listening ? <Mic size={13} /> : <MicOff size={13} />} {listening ? 'Listening' : voiceSupported ? 'Voice' : 'Voice setup'}
        </Button>

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
          <Button
            size="sm"
            variant={issues.some((i) => i.severity === 'error') ? 'danger' : 'outline'}
            onClick={() => setShowChecks((v) => !v)}
            disabled={exporting}
            title="Things worth fixing before you export"
          >
            {issues.length === 0 ? <CheckCircle2 size={13} /> : <AlertTriangle size={13} />}
            {issues.length === 0 ? 'Checks' : `${issues.length} check${issues.length === 1 ? '' : 's'}`}
          </Button>
          <Button size="sm" variant="outline" onClick={() => void runExport(false)} disabled={exporting || duration <= 0}>
            {exporting ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />}
            {exporting ? 'Recording…' : 'Export WebM'}
          </Button>
          <Button
            size="sm"
            variant="primary"
            onClick={() => void runExport(true)}
            disabled={!mp4Supported || exporting || duration <= 0}
            title={mp4Supported ? 'Render the complete timeline to MP4 with bundled FFmpeg' : 'MP4 rendering requires the installed desktop app; WebM remains available in the browser preview'}
          >
            <Download size={13} /> {mp4Supported ? 'Render MP4' : 'MP4 needs desktop'}
          </Button>
        </div>
      </div>

      <form
        className="flex shrink-0 items-center gap-2 border-b border-line bg-panel-alt/50 px-6 py-2"
        onSubmit={(event) => {
          event.preventDefault()
          void planAgentEdit()
        }}
      >
        <Sparkles size={14} className="shrink-0 text-accent-text" />
        <input
          value={agentInstruction}
          onChange={(event) => setAgentInstruction(event.target.value)}
          placeholder="How do you want this edit to feel? Describe pacing, font, colors, motion, keyframes, transitions and track layout…"
          aria-label="Editing agent instruction"
          className="h-8 min-w-0 flex-1 rounded-lg border border-line bg-bg px-3 text-sm placeholder:text-muted/70"
        />
        <Button
          size="sm"
          type="button"
          variant="ghost"
          disabled={agentPlanning || exporting || doc.clips.length === 0}
          onClick={() => void planAgentEdit(agentInstruction.trim() || 'Analyze the complete timeline content, pacing, clip names, existing text and duration. Direct a polished automatic edit with context-appropriate bundled typography and colors, purposeful movement, at least two useful keyframes where motion helps, varied native transitions, readable safe-area placement and deliberate multi-track layering. Preserve meaning and do not delete source media unless necessary.')}
          title="Let the connected model direct an edit from the current timeline content"
        >
          Auto edit
        </Button>
        <Button size="sm" type="submit" disabled={!agentInstruction.trim() || agentPlanning || exporting}>
          {agentPlanning ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />}
          {agentPlanning ? 'Planning…' : 'Preview edit'}
        </Button>
      </form>
      {agentPlanning && (
        <div className="flex shrink-0 items-center gap-3 border-b border-line bg-accent/5 px-6 py-2 text-xs text-muted" role="status" aria-live="polite">
          <Loader2 size={13} className="animate-spin text-accent-text" />
          <span className="text-text">{agentPhase}</span>
          <span>· Gemini/OpenCode has at most 20 seconds, then Cupric switches to a local plan.</span>
        </div>
      )}

      {agentPlan && (
        <div className="shrink-0 border-b border-line bg-panel px-6 py-3">
          <div className="flex items-start gap-4">
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold">{agentPlan.summary}</div>
              <div className="mt-1 text-xs text-muted">{agentPlan.source === 'live' ? 'Planned by your connected AI model' : 'Planned locally'} · preview only until accepted</div>
              {agentPlan.warning && <div className="mt-1 text-xs text-danger">{agentPlan.warning}</div>}
              <ul className="mt-2 space-y-1 text-xs text-muted">
                {agentPlan.ops.map((op, index) => <li key={index}>+ {describeStudioEditOp(op, doc)}</li>)}
              </ul>
            </div>
            <div className="flex shrink-0 gap-2">
              <Button size="sm" variant="ghost" onClick={() => setAgentPlan(null)}>Reject</Button>
              <Button size="sm" variant="primary" onClick={acceptAgentPlan}>Accept all</Button>
            </div>
          </div>
        </div>
      )}

      {voiceSupported && (listening || heard) && (
        <div className="flex shrink-0 flex-wrap items-center gap-3 border-b border-line bg-panel px-6 py-2">
          <span className={cx('h-2 w-2 shrink-0 rounded-full', listening ? 'animate-pulse bg-accent' : 'bg-muted')} />
          <span className="min-w-0 flex-1 truncate text-xs text-muted">{heard ?? 'Listening\u2026'}</span>
          <button
            type="button"
            className="text-xs text-accent-text underline underline-offset-2"
            onClick={() => setShowVoiceHelp((v) => !v)}
          >
            {showVoiceHelp ? 'Hide commands' : 'What can I say?'}
          </button>
        </div>
      )}

      {showVoiceHelp && (
        <div className="grid shrink-0 gap-x-6 gap-y-1 border-b border-line bg-panel-alt px-6 py-3 text-xs sm:grid-cols-2 lg:grid-cols-3">
          {VOICE_PHRASES.map((phrase) => (
            <div key={phrase.say} className="flex min-w-0 gap-2">
              <span className="shrink-0 font-mono text-fg">{phrase.say}</span>
              <span className="truncate text-muted">{phrase.does}</span>
            </div>
          ))}
        </div>
      )}

      {showChecks && (
        <div className="shrink-0 space-y-2 border-b border-line bg-panel px-6 py-3">
          {issues.length === 0 ? (
            <p className="text-xs text-muted">
              Nothing to flag. Text is inside the safe area, every clip has its media, and the timeline has no holes.
            </p>
          ) : (
            issues.map((issue) => (
              <div key={issue.id} className="flex items-start gap-3 text-xs">
                <span
                  className={cx(
                    'mt-1 h-1.5 w-1.5 shrink-0 rounded-full',
                    issue.severity === 'error' ? 'bg-[rgb(226_75_74)]' : 'bg-[rgb(255_196_92)]',
                  )}
                />
                <div className="min-w-0 flex-1">
                  <p className="text-text">{issue.message}</p>
                  {issue.hint && <p className="text-muted/80">{issue.hint}</p>}
                </div>
                {issue.clipId && (
                  <button
                    type="button"
                    className="shrink-0 text-accent-text underline underline-offset-2"
                    onClick={() => setSelectedId(issue.clipId ?? null)}
                  >
                    Show me
                  </button>
                )}
                {issue.fix && issue.clipId && (
                  <button
                    type="button"
                    className="shrink-0 text-accent-text underline underline-offset-2"
                    onClick={() => updateStudioClip(projectId, issue.clipId as string, issue.fix!.patch)}
                  >
                    {issue.fix.label}
                  </button>
                )}
              </div>
            ))
          )}
        </div>
      )}

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

      {/* Shared resources + stage + inspector */}
      <div className="flex min-h-0 flex-1">
        {showResources && (
          <aside className="w-[420px] shrink-0 overflow-y-auto border-r border-line bg-bg px-4 py-4" aria-label="Studio resources">
            <div className="mb-3">
              <h2 className="text-sm font-semibold">All Library resources</h2>
              <p className="mt-1 text-xs text-muted">The same 15 bundled packs available in Library. Drag compatible items directly onto the stage.</p>
            </div>
            <PackBrowser />
          </aside>
        )}
        <div className="flex min-w-0 flex-1 flex-col">
          <div
            className={cx(
              'flex min-h-0 flex-1 items-center justify-center bg-bg p-5 transition-colors duration-150',
              dropActive && 'bg-accent/5 ring-2 ring-inset ring-accent/40',
            )}
            onDragOver={(e) => {
              e.preventDefault()
              e.dataTransfer.dropEffect = 'copy'
              if (!dropActive) setDropActive(true)
            }}
            onDragLeave={(e) => {
              if (e.currentTarget.contains(e.relatedTarget as Node | null)) return
              setDropActive(false)
            }}
            onDrop={onStageDrop}
          >
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
                selected={selected}
                onPatchSelected={(patch) => selectedId && updateStudioClip(projectId, selectedId, patch)}
                time={time}
                playing={playing}
                muted={muted}
                showSafeAreas={showSafeAreas}
                keyframeRecord={keyframeRecord}
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
            <button
              type="button"
              aria-pressed={showSafeAreas}
              onClick={() => setShowSafeAreas((shown) => !shown)}
              className={cx(
                'rounded-md border px-2 py-1 text-xs transition-colors',
                showSafeAreas ? 'border-accent/50 bg-accent/10 text-accent-text' : 'border-line text-muted hover:text-text',
              )}
            >
              Safe areas
            </button>
            <button
              type="button"
              aria-pressed={keyframeRecord}
              title="When enabled, canvas transforms record a keyframe at the playhead"
              onClick={() => setKeyframeRecord((recording) => !recording)}
              className={cx(
                'rounded-md border px-2 py-1 text-xs transition-colors',
                keyframeRecord ? 'border-danger/60 bg-danger/10 text-danger' : 'border-line text-muted hover:text-text',
              )}
            >
              ● Keyframe record
            </button>
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
              onReorderTrack={(from, to) => reorderStudioTracks(projectId, from, to)}
            />
          </div>
        </div>

        <aside className={cx('w-80 shrink-0 overflow-y-auto border-l border-line bg-panel px-5 py-4')}>
          <StudioInspector
            doc={doc}
            time={time}
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
