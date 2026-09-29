import { agentSlug, animationIntent, describeRejections, forbiddenRequest } from '../lib/studio/agentCode'
import { writeAgentAnimation } from '../lib/studio/agentWriter'
import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from 'react'
import { ThinkingStates } from '../components/loaders/ThinkingStates'
import { MatrixLoader } from '../components/loaders/MatrixLoader'
import { StudioProPanel } from './studio/StudioProPanel'
import { ClipContextMenu } from './studio/ClipContextMenu'
import { applyClipAction, getClipboard, setClipboard, type ClipActionId } from '../lib/studio/clipActions'
import { makeProxy } from '../lib/studio/proxy'
import { emitDiff, emitStudio } from '../lib/studio/studioEvents'
import { createStudioApi } from '../lib/studio/studioApi'
import { unfilledPlaceholders } from '../lib/studio/layouts'
import { reframeForAspect } from '../lib/studio/creativeTools'
import { addMarker, jumpMarker, rippleDelete, rollEdit, slideClip, slipClip, trimEndTo, trimStartTo, type EditResult } from '../lib/studio/timelineOps'
import { takeStudioFocus, visibleMomentOf } from '../lib/studio/focus'
import {
  Boxes,
  ChevronLeft,
  ChevronRight,
  Wand2,
  Component,
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
  Shapes,
  SlidersHorizontal,
  MousePointerClick,
  Loader as LoaderIcon,
  Square,
  Type as TypeIcon,
  Volume2,
  VolumeX,
  ZoomIn,
  ZoomOut,
  LayoutTemplate,
  ShieldCheck,
} from 'lucide-react'
import { ShapePicker } from './studio/ShapePicker'
import { LoaderPicker } from './studio/LoaderPicker'
import { HomeVideoPanel } from './studio/HomeVideoPanel'
import { preloadLottie } from '../lib/studio/lottie'
import { fontChoicesForAgent } from '../lib/studio/fontStyles'
import { userFontFamilies, userFontsReady } from '../lib/studio/userFonts'
import { addCursorTo, addLoader, addShape as addShapeKit } from '../lib/studio/motionKit'
import { Button } from '../components/Button'
import { IconButton } from '../components/IconButton'
import { NoProject } from '../components/NoProject'
import { ProgressBar } from '../components/ProgressBar'
import { EditToolsBar } from './studio/EditToolsBar'
import { TextListPanel } from './studio/TextListPanel'
import { moveWithGroup, toggleInSelection } from '../lib/studio/editTools'
import { StudioInspector } from './studio/StudioInspector'
import { StudioPreview } from './studio/StudioPreview'
import { StudioNotices } from './studio/StudioNotices'
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
  resolveOverlaps,
  studioOf,
  MAX_TRACKS,
} from '../lib/studio/doc'
import { STUDIO_BACKGROUNDS } from '../lib/studio/backgrounds'
import { TRANSITIONS } from '../lib/studio/transitions'
import { isVoiceSupported, parseVoiceCommand, speak, VOICE_PHRASES, VoiceListener, type VoiceCommand } from '../lib/voice'
import { FOCUS_NOW_EVENT, VOICE_RUN_EVENT, publishPlayhead, setStudioMounted, takePendingVoicePhrase, type FocusNowDetail } from '../lib/studio/studioLink'
import { useResourceApply } from './library/useResourceApply'
import { componentCatalogFor, componentPropsSummary, isPendingComponent, placeShelfItem, shelfComponent, withComponent } from '../lib/studio/components'
import { motionPatch } from '../lib/studio/motionDirector'
import { ComponentRecorderHost } from './studio/ComponentRecorderHost'
import { ComponentsPanel } from './studio/ComponentsPanel'
import { hasMedia, registerFile } from '../lib/studio/media'
import { readDragPayload } from '../lib/studio/resourceDrop'
import { canExportMp4, convertToMp4, exportStudio, exportStudioInBackground } from '../lib/studio/export'
import { useActiveProject, useProjectStore } from '../state/useProjectStore'
import { lintStudioDoc } from '../lib/studio/lint'
import { applyAuditFixes, describeAudit, runStudioAudit } from '../lib/studio/gateRunner'
import type { GateReport } from '../lib/studio/gates'
import { cueDone, cueProblem } from '../lib/sound'
import { clamp, cx, fmtClock, slugify, uid } from '../lib/utils'
import { humanError } from '../lib/humanError'
import { getIpc } from '../lib/bridge'
import { rlog } from '../lib/log'
import { patchTransformKeyframe } from '../lib/studio/keyframeEdit'
import { parseGeneratedHtml, piecesToStudioClips } from '../lib/studio/importHtml'
import { readGeneratedPackage } from '../lib/studio/generatedPackage'
import { detectSourceProject, scanSources, sourceProjectToClips, unrecognizedMessage } from '../lib/studio/sourceProject'
import reactBitsCatalog from '../../resources/react-bits/catalog.json'
import skiperCatalog from '../../resources/skiper/catalog.json'
import remotionCatalog from '../../resources/remotion/catalog.json'
import {
  applyStudioEditPlan,
  describeStudioEditOp,
  enrichThinPlan,
  localStudioEditPlan,
  validateStudioEditPlan,
  type StudioEditPlan,
} from '../lib/studio/editOps'
import { blockRow3dError, loadBlockRow3d, needsBlockRow3d } from '../lib/studio/blockRow3d'
import { backgroundPolishEnabled, backgroundPolishOffer, docSignature, POLISH_IDLE_MS, setBackgroundPolishEnabled, type PolishOffer } from '../lib/studio/backgroundPolish'

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
  const settleStudioClip = useProjectStore((s) => s.settleStudioClip)
  const pushToast = useProjectStore((s) => s.pushToast)
  const { apply: applyResourceItem } = useResourceApply()
  const setView = useProjectStore((s) => s.setView)
  const startAutomationJob = useProjectStore((s) => s.startAutomationJob)

  const [time, setTime] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [muted, setMuted] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [multiIds, setMultiIds] = useState<Set<string>>(() => new Set())
  const [shapeOpen, setShapeOpen] = useState(false)
  const [loaderOpen, setLoaderOpen] = useState(false)
  const [homeOpen, setHomeOpen] = useState(false)
  // Stickers render through lottie-web, which is code-split out of first paint.
  useEffect(() => { void preloadLottie() }, [])
  useEffect(() => { void userFontsReady() }, [])
  const [zoom, setZoom] = useState(3)
  const [importing, setImporting] = useState(false)
  const [exportPct, setExportPct] = useState<number | null>(null)
  const [lastExport, setLastExport] = useState<{ url: string; fileName: string } | null>(null)
  const [listening, setListening] = useState(false)
  const [heard, setHeard] = useState<string | null>(null)
  // A spoken brief launches a whole autonomous job, so it waits for a yes
  // (spoken or clicked) — a misheard phrase must never start rendering.
  const [pendingBrief, setPendingBriefState] = useState<string | null>(null)
  const pendingBriefRef = useRef<string | null>(null)
  const setPendingBrief = (b: string | null) => { pendingBriefRef.current = b; setPendingBriefState(b) }
  const confirmBriefRef = useRef<(yes: boolean) => void>(() => {})
  /** True when the utterance answered a pending brief confirmation. */
  const answerPending = (transcript: string): boolean => {
    if (!pendingBriefRef.current) return false
    const t = transcript.trim().toLowerCase()
    if (/^(yes|yeah|yep|start( it)?|go( ahead)?|confirm|do it)\b/.test(t)) { confirmBriefRef.current(true); return true }
    if (/^(no|nope|cancel|stop|never ?mind)\b/.test(t)) { confirmBriefRef.current(false); return true }
    return false
  }
  const [showVoiceHelp, setShowVoiceHelp] = useState(false)
  const [showChecks, setShowChecks] = useState(false)
  // The last delivery audit, with the document it judged — a stale pass is worse
  // than no pass, so the panel says when the edit has moved on since.
  const [audit, setAudit] = useState<{ report: GateReport; doc: StudioDoc } | null>(null)
  const [auditing, setAuditing] = useState(false)
  const [showSafeAreas, setShowSafeAreas] = useState(true)
  const [keyframeRecord, setKeyframeRecord] = useState(false)
  const [showResources, setShowResources] = useState(false)
  const [showPro, setShowPro] = useState(false)
  /** A proposed edit shown on the stage but not yet committed (2.9 preview/accept). */
  const [previewDoc, setPreviewDoc] = useState<{ doc: StudioDoc; label: string } | null>(null)
  useEffect(() => {
    if (!showPro) setPreviewDoc(null)
  }, [showPro])
  const [showComponents, setShowComponents] = useState(false)
  const [agentInstruction, setAgentInstruction] = useState('')
  const [agentRevision, setAgentRevision] = useState('')
  const [agentPlanning, setAgentPlanning] = useState(false)
  const [agentPhase, setAgentPhase] = useState('')
  const [agentPlan, setAgentPlan] = useState<StudioEditPlan | null>(null)
  const [timelineH, setTimelineH] = useState<number | null>(null)
  const [showShortcuts, setShowShortcuts] = useState(false)
  const [clipMenuAt, setClipMenuAt] = useState<{ clipId: string; x: number; y: number } | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const stripRef = useRef<HTMLDivElement>(null)
  const setAskOpen = useProjectStore((st) => st.setAskOpen)
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
  const auditFindings = useMemo(() => audit?.report.findings ?? [], [audit])
  const pid = project?.id ?? null
  const selected = useMemo(() => doc.clips.find((c) => c.id === selectedId) ?? null, [doc.clips, selectedId])
  const runAudit = useCallback(() => {
    if (auditing || duration <= 0) return
    setAuditing(true)
    setShowChecks(true)
    // Yield a frame first, so the button shows its state before rendering blocks.
    requestAnimationFrame(() => {
      try {
        const { report } = runStudioAudit(doc, { hasMedia, fps: 4, maxFrames: 18 })
        setAudit({ report, doc })
        if (report.ok) {
          cueDone()
          pushToast('success', describeAudit(report))
        } else {
          cueProblem()
          pushToast('error', report.summary)
        }
      } catch (err) {
        rlog.warn('studio', 'delivery audit failed', err)
        pushToast('error', humanError(err))
      } finally {
        setAuditing(false)
      }
    })
  }, [auditing, doc, duration, pushToast])

  const applyAudit = useCallback(() => {
    if (!pid || !audit) return
    const { doc: fixed, applied } = applyAuditFixes(doc, audit.report)
    if (!applied) return
    patchStudio(pid, { clips: fixed.clips, trackCount: fixed.trackCount }, 'Fix delivery checks')
    setAudit(null)
    cueDone()
    pushToast('success', `Applied ${applied} measured fix${applied === 1 ? '' : 'es'} — one undo step.`)
  }, [audit, doc, patchStudio, pid, pushToast])

  const runClipAction = useCallback((clipId: string | null, action: ClipActionId) => {
    if (!pid) return
    const r = applyClipAction(doc, clipId, action, { time, clipboard: getClipboard() })
    if (r.clipboard) setClipboard(r.clipboard)
    if (r.doc) patchStudio(pid, { clips: r.doc.clips, trackCount: r.doc.trackCount }, r.label)
    if (r.select !== undefined) setSelectedId(r.select)
    if (r.message) pushToast('info', r.message)
  }, [doc, time, pid, patchStudio, pushToast])

  // A clip handed over from Lab / Arena / Footage: select it and show it.
  useEffect(() => {
    const id = takeStudioFocus()
    if (!id) return
    const clip = doc.clips.find((item) => item.id === id)
    if (!clip) return
    setSelectedId(clip.id)
    setPlaying(false)
    setTime(visibleMomentOf(clip))
    // Runs once on mount; the store update has landed before navigation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Live line to Resources / Lab: they read the playhead and ask to focus
  // what they just added (studioLink.ts).
  useEffect(() => {
    setStudioMounted(true)
    return () => setStudioMounted(false)
  }, [])
  useEffect(() => publishPlayhead(time), [time])
  useEffect(() => {
    const onFocus = (event: Event) => {
      const { clipId, atSec } = (event as CustomEvent<FocusNowDetail>).detail ?? { clipId: null, atSec: 0 }
      setPlaying(false)
      if (clipId) setSelectedId(clipId)
      setTime(Math.max(0, atSec))
    }
    const onVoice = (event: Event) => runVoicePhraseNow(String((event as CustomEvent<string>).detail ?? ''))
    window.addEventListener(FOCUS_NOW_EVENT, onFocus)
    window.addEventListener(VOICE_RUN_EVENT, onVoice)
    // A phrase applied from the Library before the Studio was open.
    const pending = takePendingVoicePhrase()
    if (pending) window.setTimeout(() => runVoicePhraseNow(pending), 250)
    return () => {
      window.removeEventListener(FOCUS_NOW_EVENT, onFocus)
      window.removeEventListener(VOICE_RUN_EVENT, onVoice)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /** A voice-command phrase from Resources runs exactly as if it were spoken. */
  function runVoicePhraseNow(phrase: string) {
    const first = phrase.split(/\s*\/\s*/)[0]?.trim() || phrase
    // "make a video about …" needs your words: listen instead of guessing.
    if (/…|\.\.\./.test(first)) {
      pushToast('info', `Say “${first.replace(/\s*(…|\.\.\.)\s*$/, '')} …” followed by your idea — the microphone is on.`)
      if (!voiceRef.current?.active) toggleVoiceRef.current()
      return
    }
    const command = parseVoiceCommand(first) ?? parseVoiceCommand(phrase)
    if (!command) {
      pushToast('info', `“${first}” is not a command Cupric can run from here.`)
      return
    }
    setHeard(`“${first}”`)
    commandRef.current(command)
  }

  confirmBriefRef.current = (yes: boolean) => {
    const brief = pendingBriefRef.current
    setPendingBrief(null)
    if (!brief) return
    if (!yes) { speak('Cancelled.', { interrupt: true }); pushToast('info', 'Voice brief cancelled — nothing was started.'); return }
    startAutomationJob({
      brief: brief,
      footageFolder: null,
      outputFolder: null,
      aspect: doc.aspect === '4:5' ? '1:1' : doc.aspect, // the pipeline renders 16:9, 9:16 or 1:1
      fps: doc.fps === 60 ? 60 : 30,
      quality: 'draft',
      mode: 'auto-draft',
      votingMode: 'local-scoring',
    })
    speak(`Starting an autonomous job for ${brief}.`, { interrupt: true })
  }

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

      if (e.key === '?') {
        e.preventDefault()
        setShowShortcuts((shown) => !shown)
        return
      }
      if (e.key === 'Escape' && showShortcuts) {
        setShowShortcuts(false)
        return
      }

      if (mod && key === 'z') {
        e.preventDefault()
        if (e.shiftKey) redo()
        else undo()
        return
      }
      // Clip actions (copy/cut/paste/duplicate/lock/hide/mute/arrange): the
      // same pure table as the right-click menu, one undo step each.
      if (mod && !e.altKey && pid) {
        const map: Record<string, ClipActionId> = { c: 'copy', x: 'cut', v: 'paste', d: 'duplicate', l: 'lock', h: 'hide', m: 'mute', ']': 'bring-forward', '[': 'send-backward' }
        const action = map[key]
        if (action) {
          e.preventDefault()
          runClipAction(selectedId, action)
          return
        }
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

      // Alt + arrows nudge the selected layer (Shift for bigger steps).
      if (e.altKey && e.key.startsWith('Arrow') && selectedId && pid) {
        const clip = doc.clips.find((c) => c.id === selectedId)
        if (clip && 'x' in clip && typeof clip.x === 'number' && typeof clip.y === 'number') {
          e.preventDefault()
          const step = e.shiftKey ? 0.05 : 0.005
          const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0
          const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0
          updateStudioClip(pid, selectedId, { x: Math.min(1, Math.max(0, clip.x + dx)), y: Math.min(1, Math.max(0, clip.y + dy)) } as Partial<StudioClip>)
          return
        }
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
      // 2.1 / 2.7 pro timeline keys — each one labelled undo step, and a
      // toast explaining why when it cannot apply (no silent no-ops).
      if (!mod && pid && (key === 'q' || key === 'w' || key === 'm' || key === '[' || key === ']' || key === ';' || key === "'" || ((e.key === 'Delete' || e.key === 'Backspace') && e.shiftKey) || (e.altKey && (e.key === ',' || e.key === '.' || e.code === 'BracketLeft' || e.code === 'BracketRight')))) {
        e.preventDefault()
        const commit = (r: EditResult, label: string) => {
          if (!r.changed) pushToast('info', r.reason ?? 'Nothing to change here.')
          else patchStudio(pid, { clips: r.doc.clips, markers: r.doc.markers, trackCount: r.doc.trackCount }, label)
          return r.changed
        }
        const frame = 1 / doc.fps
        if (key === 'm') { commit(addMarker(doc, time), 'Add marker'); return }
        if (key === ';' || key === "'") {
          const to = jumpMarker(doc, time, key === "'" ? 1 : -1)
          if (to === null) pushToast('info', (doc.markers ?? []).length ? 'No more markers that way.' : 'Press M to drop a marker first.')
          else seek(to)
          return
        }
        if (!selectedId) { pushToast('info', 'Select a clip first.'); return }
        if (doc.clips.find((c) => c.id === selectedId)?.locked) { pushToast('info', 'That clip is locked — unlock it to edit (Ctrl+L).'); return }
        if (key === 'q') commit(trimStartTo(doc, selectedId, time), 'Trim start to playhead')
        else if (key === 'w') commit(trimEndTo(doc, selectedId, time), 'Trim end to playhead')
        else if ((e.code === 'BracketLeft' || e.code === 'BracketRight') && e.altKey) commit(slideClip(doc, selectedId, (e.code === 'BracketRight' ? 1 : -1) * frame * (e.shiftKey ? 10 : 1)), 'Slide clip')
        else if (key === '[' || key === ']') commit(slipClip(doc, selectedId, (key === ']' ? 1 : -1) * frame * (e.shiftKey ? 10 : 1)), 'Slip clip')
        else if (e.key === ',' || e.key === '.') commit(rollEdit(doc, selectedId, (e.key === '.' ? 1 : -1) * frame * (e.shiftKey ? 10 : 1)), 'Roll edit')
        else if (commit(rippleDelete(doc, selectedId), 'Ripple delete')) setSelectedId(null)
        return
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedId && pid) {
        e.preventDefault()
        if (doc.clips.find((c) => c.id === selectedId)?.locked) { pushToast('info', 'That clip is locked — unlock it to delete (Ctrl+L).'); return }
        removeStudioClip(pid, selectedId)
        setSelectedId(null)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [doc, duration, patchStudio, pushToast, pid, playing, redo, removeStudioClip, seek, selectedId, showShortcuts, splitStudioClip, time, undo, updateStudioClip, runClipAction])

  useEffect(() => {
    if (time > duration) setTime(duration)
  }, [duration, time])

  // Event bus: every doc change (UI, agent, undo, voice) → clip/timeline events.
  const prevDocRef = useRef<StudioDoc | null>(null)
  useEffect(() => {
    emitDiff(prevDocRef.current, doc)
    prevDocRef.current = doc
  }, [doc])
  useEffect(() => emitStudio('selection:change', { clipId: selectedId }), [selectedId])
  useEffect(() => emitStudio('time:change', { time }), [time])

  // Scripting API (window.__cupricStudio) — reads live state through refs.
  // NEVER graft it onto window.cupric: that is the read-only contextBridge
  // object, and writing to it is what blanked the Studio in 0.10.0.
  const apiState = useRef({ doc, selectedId, time })
  apiState.current = { doc, selectedId, time }
  useEffect(() => {
    if (!pid) return
    const api = createStudioApi({
      getDoc: () => apiState.current.doc,
      commit: (next, label) => patchStudio(pid, next, label),
      getSelected: () => apiState.current.selectedId,
      select: (id) => setSelectedId(id),
      getTime: () => apiState.current.time,
      seek: (t) => seek(t),
    })
    window.__cupricStudio = api
    return () => {
      if (window.__cupricStudio === api) delete window.__cupricStudio
    }
  }, [pid, patchStudio, seek])

  // Boot log (0.10.1): how long the Studio took from first render to mounted.
  const mountStartRef = useRef(performance.now())
  useEffect(() => {
    const doc0 = apiState.current.doc
    rlog.info('studio', 'studio:mount', {
      projectId: pid,
      ms: Math.round(performance.now() - mountStartRef.current),
      sinceBootMs: Math.round(performance.now()),
      clips: doc0.clips.length,
      trackCount: doc0.trackCount,
      aspect: doc0.aspect,
      backgroundId: doc0.backgroundId,
    })
    // Once per mount / project switch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pid])

  // The listener is created once and torn down on unmount; commands are
  // dispatched through a ref so the handler always sees fresh state.
  useEffect(() => {
    return () => {
      voiceRef.current?.stop()
      voiceRef.current = null
    }
  }, [])

  const toggleVoiceRef = useRef<() => void>(() => {})
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
        if (answerPending(transcript)) return
        commandRef.current(command)
      },
      onUnrecognised: (transcript) => {
        if (answerPending(transcript)) return
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

  // V-2: background polish. After the timeline sits still, plan (never apply)
  // a polish pass; the user previews it in the normal agent diff and accepts it
  // as one undo step. A dismissed or accepted timeline is never re-offered.
  const [polishOn, setPolishOn] = useState(() => backgroundPolishEnabled())
  const [polishOffer, setPolishOffer] = useState<PolishOffer | null>(null)
  const polishSeen = useRef<Set<string>>(new Set())
  const polishSig = project ? docSignature(doc) : ''
  useEffect(() => {
    setPolishOffer((cur) => (cur && cur.signature !== polishSig ? null : cur))
    if (!polishOn || !project || agentPlan || agentPlanning || polishSeen.current.has(polishSig)) return
    let idle = 0
    const timer = window.setTimeout(() => {
      const run = () => {
        const offer = backgroundPolishOffer(doc)
        polishSeen.current.add(polishSig)
        if (offer && offer.signature === polishSig) setPolishOffer(offer)
      }
      if ('requestIdleCallback' in window) idle = window.requestIdleCallback(run, { timeout: 2000 })
      else run()
    }, POLISH_IDLE_MS)
    return () => {
      window.clearTimeout(timer)
      if (idle && 'cancelIdleCallback' in window) window.cancelIdleCallback(idle)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [polishSig, polishOn, agentPlan, agentPlanning])

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
      // JOB 4: explicit forbidden techniques are refused up front, quoting the rule.
      const forbidden = forbiddenRequest(instruction)
      if (forbidden) {
        pushToast('info', describeRejections([forbidden]))
        return
      }
      const intent = animationIntent(instruction)
      if (intent) {
        setAgentPhase('Writing and validating a new animation')
        const written = await writeAgentAnimation(instruction, intent.durationSec)
        if (!written.ok) { pushToast('info', written.message); return }
        const draft = { summary: `New ${written.spec.name} (${written.spec.durationSec}s), written by the agent and validated${written.rounds ? ` after ${written.rounds} repair${written.rounds === 1 ? '' : 's'}` : ''}.`, ops: [{ type: 'addAnimation', ...written.spec, startSec: Math.round(time * 100) / 100 }], source: 'live' as const }
        setAgentPlan(validateStudioEditPlan(draft, doc))
        return
      }
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
          durationSec: Math.round(duration * 100) / 100,
          playheadSec: Math.round(time * 100) / 100,
          selectedId,
          // Names only: the agent uses these attributed libraries as visual
          // vocabulary, then translates the idea into Cupric's safe native
          // operations. Third-party source is never sent, copied or executed.
          motionReferences: {
            reactBits: relevantNames(reactBitsCatalog.items),
            skiperUi: relevantNames(skiperCatalog.items),
            remotionPackages: relevantNames(remotionCatalog.packages ?? []),
          },
          // The UI components the agent may place with addComponent (best
          // matches for this request; slugs are validated on return).
          components: componentCatalogFor(instruction, 18, doc.clips.map((c) => (c.kind === 'text' ? c.text : c.name) ?? '').join(' ').slice(0, 2000)),
          // Fonts the agent may use: bundled + the user's own (e.g. Fontshare
          // downloads). Fontshare families not added yet are only suggested.
          fonts: fontChoicesForAgent(userFontFamilies()),
          clips: doc.clips.map((clip) => ({
            id: clip.id,
            kind: clip.kind,
            ...(clip.kind === 'overlay' && clip.component ? { component: clip.component.slug, ...(clip.component.props ? { componentProps: clip.component.props } : {}), ...(componentPropsSummary(clip.component.slug) ? { settableProps: componentPropsSummary(clip.component.slug) } : {}) } : {}),
            name: clip.name,
            track: clip.track,
            startSec: clip.startSec,
            durationSec: clip.durationSec,
            opacity: clip.opacity,
            rotation: clip.rotation ?? 0,
            ...('x' in clip ? { x: clip.x, y: clip.y } : {}),
            ...(clip.kind === 'text' ? { text: clip.text, color: clip.color, fontSizePct: clip.fontSizePct, fontFamily: clip.fontFamily, weight: clip.weight, align: clip.align, highlightWord: clip.highlightWord, anim: clip.anim } : {}),
            keyframes: clip.keyframes ?? [],
          })),
        }
        try {
          raw = await ipc.invoke('studio:planEdits', { instruction, context })
        } catch (err) {
          // No network, no key, quota spent or a local server that is off: the
          // built-in motion engine still plans a real edit.
          const local = localStudioEditPlan(instruction, doc, selectedId, { time })
          raw = { ...local, warning: `Planned offline with Cupric's motion engine. ${humanError(err, 'AI connection')}` }
        }
      } else {
        raw = localStudioEditPlan(instruction, doc, selectedId, { time })
      }
      let plan: StudioEditPlan
      try {
        plan = validateStudioEditPlan(raw, doc)
      } catch (validationError) {
        // A provider can answer successfully but still omit IDs or invent an
        // unsupported property. Treat malformed output like a provider outage:
        // preserve the user's instruction and return a useful local preview.
        const local = localStudioEditPlan(instruction, doc, selectedId, { time })
        plan = validateStudioEditPlan({
          ...local,
          warning: `The live response was unsafe or incomplete, so Cupric rebuilt it locally with its motion engine (${humanError(validationError, 'invalid edit plan')}).`,
        }, doc)
      }
      setAgentPlan(enrichThinPlan(plan, instruction, doc, selectedId))
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
      let next = applyStudioEditPlan(doc, currentPlan.ops)
      // People who ask their OS for reduced motion get the calm (opacity-only) take by default; one click in the inspector switches it.
      if (currentPlan.ops.some((op) => op.type === 'addAnimation') && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
        next = { ...next, clips: next.clips.map((c) => (c.kind === 'overlay' && c.component?.generated && !doc.clips.some((d) => d.id === c.id) ? { ...c, component: { ...c.component, generated: { ...c.component.generated, calm: true } } } : c)) }
      }
      patchStudio(projectId, next)
      // Accepted agent-written animations are also saved as files (best effort, silent).
      for (const op of currentPlan.ops) {
        if (op.type === 'addAnimation') void getIpc()?.invoke('agent:saveGenerated', { slug: agentSlug(op.name), name: op.name, code: op.code }).catch(() => undefined)
      }
      polishSeen.current.add(docSignature(next))
      setPolishOffer(null)
      setTime(0)
      if (docDuration(next) > 0) window.setTimeout(() => setPlaying(true), 60)
      pushToast('success', `Applied ${currentPlan.ops.length} agent edit${currentPlan.ops.length === 1 ? '' : 's'} as one undo step. Playing the polished result from the start.`)
      setAgentPlan(null)
      setAgentInstruction('')
      setAgentRevision('')
    } catch (err) {
      pushToast('error', humanError(err, 'The timeline changed; preview this edit again'))
      setAgentPlan(null)
    }
  }

  /** The document as it is right now — not as it was when this render began. */
  function liveDoc(): StudioDoc {
    return studioOf(useProjectStore.getState().projects.find((item) => item.id === projectId))
  }

  /** `at` (2.10): a drop on the timeline lands where it was dropped. */
  async function onFiles(files: FileList | null, at?: { sec: number; track: number }) {
    if (!files?.length) return
    setImporting(true)
    let start = nextFreeStart(doc, 0, 0, 0.1)
    try {
      for (const file of Array.from(files)) {
        if (/\.(?:zip|html?)$/i.test(file.name)) {
          const generated = await readGeneratedPackage(file)
          const isZip = /\.zip$/i.test(file.name)
          const arenaShape = /id=["']scene["']|window\.__seek/.test(generated.html)
          // Second first-class shape: a multi-file React/Vite film project.
          const sourceProject = isZip && !arenaShape ? detectSourceProject(generated.sources, generated.html) : null
          if (sourceProject) {
            const current = liveDoc()
            const base = Math.round(current.clips.reduce((m, c) => Math.max(m, c.startSec + c.durationSec), 0) * 100) / 100
            const imp = sourceProjectToClips(sourceProject, current, base, () => uid())
            const trackCount = Math.min(MAX_TRACKS, Math.max(current.trackCount, imp.tracksUsed + 1))
            const media: StudioClip[] = []
            for (const asset of generated.assets) {
              try {
                const handle = await registerFile(asset.file)
                if (handle.kind === 'audio') {
                  media.push(defaultAudioClip(base, trackCount - 1, { id: handle.id, fileName: handle.fileName, localPath: handle.localPath, durationSec: handle.durationSec }))
                } else if (handle.kind === 'video') {
                  media.push({
                    id: uid(), kind: 'video', track: 0, startSec: base, durationSec: Math.max(0.2, Math.min(handle.durationSec, sourceProject.durationSec)),
                    name: handle.fileName.replace(/\.[^.]+$/, '').slice(0, 28), transitionIn: 'fade', transitionOut: 'none', opacity: 1,
                    mediaId: handle.id, fileName: handle.fileName, localPath: handle.localPath, trimInSec: 0, sourceDurationSec: handle.durationSec,
                    speed: 1, volume: 1, fit: 'cover', x: 0.5, y: 0.5, scale: 1, posterDataUrl: handle.posterDataUrl,
                  } as StudioMediaClip)
                } else {
                  imp.notes.push(`${handle.fileName} was added to the media bin.`)
                }
              } catch {
                imp.notes.push(`Skipped ${asset.sourcePath} (unsupported or damaged).`)
              }
            }
            const next = resolveOverlaps({
              ...current, trackCount,
              palette: imp.palette.length ? imp.palette : current.palette,
              markers: [...(current.markers ?? []), ...imp.markers],
              clips: [...current.clips, ...media, ...imp.clips],
            })
            patchStudio(projectId, next)
            const first = imp.clips.find((c) => c.kind === 'overlay') ?? imp.clips[0]
            if (first) { setSelectedId(first.id); setTime(first.startSec + Math.min(0.8, first.durationSec / 2)) }
            const audioCount = media.filter((c) => c.kind === 'audio').length
            pushToast('success', `Imported ${file.name} — ${imp.summary}${audioCount ? `, ${audioCount} audio track${audioCount === 1 ? '' : 's'}` : ''}.${imp.notes.length ? ` ${imp.notes.join(' ')}` : ''}`)
            continue
          }
          // Never refuses: manifest → scene arrays in any script → timed markup
          // → visible text → copy in scripts → <title> → a title card.
          const piece = parseGeneratedHtml(generated.html, { scripts: generated.scripts, name: file.name })!
          // A zip that matched neither shape used to "succeed" as a text-only
          // title card. Say so instead, so the user knows nothing real came in.
          const scan = scanSources(generated.sources, generated.html)
          if (isZip && !arenaShape && (piece.via === 'title' || (piece.via === 'script-copy' && scan.codeFiles >= 2 && (scan.shellHtml || !generated.html)))) {
            pushToast('error', unrecognizedMessage(file.name, generated.sources, generated.html))
            continue
          }
          const current = liveDoc()
          const label = file.name.replace(/\.(?:zip|html?)$/i, '').replace(/\s*\(\d+\)$/, '').slice(0, 28)
          const sceneClips = piecesToStudioClips(piece, current, label)
          const base = sceneClips.length ? Math.min(...sceneClips.map((c) => c.startSec)) : nextFreeStart(current, 0, 0, 1)
          const span = Math.max(piece.durationSec, 3)

          // ZIP media is not left trapped behind HTML. Each asset is registered
          // through the same media store as a normal file import and becomes an
          // independently movable, resizable and replaceable clip underneath
          // the scene text.
          const mediaClips: StudioClip[] = []
          const images = generated.assets.filter((asset) => asset.file.type.startsWith('image/'))
          const imageDuration = Math.max(1.5, span / Math.max(1, images.length))
          let cursor = base
          for (const asset of generated.assets) {
            try {
              const handle = await registerFile(asset.file)
              if (handle.kind === 'audio') {
                mediaClips.push(defaultAudioClip(base, Math.max(0, current.trackCount - 1), { id: handle.id, fileName: handle.fileName, localPath: handle.localPath, durationSec: handle.durationSec }))
                continue
              }
              // A scene that references this file in its own markup owns it:
              // the image sits exactly under that scene's text.
              const baseName = (path: string) => path.split(/[\\/]/).pop()?.toLowerCase() ?? ''
              const owner = piece.scenes.find((scene) => scene.media?.some((src) => baseName(src) === baseName(asset.sourcePath)))
              const anchored = owner && handle.kind === 'image'
              const assetDuration = anchored ? Math.max(0.5, owner.to - owner.from) : handle.kind === 'video' ? Math.max(0.2, handle.durationSec) : imageDuration
              mediaClips.push({
                id: uid(), kind: handle.kind, track: 0, startSec: Math.round((anchored ? base + owner.from : cursor) * 100) / 100, durationSec: assetDuration,
                name: handle.fileName.replace(/\.[^.]+$/, '').slice(0, 28), transitionIn: 'fade', transitionOut: 'none', opacity: 1,
                mediaId: handle.id, fileName: handle.fileName, localPath: handle.localPath, trimInSec: 0,
                sourceDurationSec: handle.kind === 'video' ? handle.durationSec : 0, speed: 1, volume: 1,
                fit: 'cover', x: 0.5, y: 0.5, scale: 1, posterDataUrl: handle.posterDataUrl,
              } as StudioMediaClip)
              if (!anchored) cursor += assetDuration
            } catch {
              generated.notes.push(`Skipped ${asset.sourcePath} (unsupported or damaged).`)
            }
          }

          // One undo step, built from the live document, overlaps resolved.
          const aspect = current.clips.length === 0 && piece.size
            ? (piece.size[0] > piece.size[1] * 1.2 ? '16:9' : piece.size[1] > piece.size[0] * 1.2 ? '9:16' : '1:1')
            : current.aspect
          const next = resolveOverlaps({ ...current, aspect, trackCount: Math.max(current.trackCount, 3), clips: [...current.clips, ...mediaClips, ...sceneClips] })
          patchStudio(projectId, next)
          if (sceneClips[0]) {
            setSelectedId(sceneClips[0].id)
            setTime(sceneClips[0].startSec + Math.min(0.8, sceneClips[0].durationSec / 2))
          }
          const how = {
            manifest: 'from its Cupric manifest',
            'scene-array': 'from its scene list',
            'timed-markup': 'from its timed markup',
            'scene-blocks': 'scene by scene, with each scene’s own timing',
            headings: 'from the text on screen',
            'script-copy': 'from copy in its scripts',
            title: 'as a title card — no scene copy was found, so rename it',
          }[piece.via]
          const titles = piece.scenes.filter((scene) => scene.role !== 'sub').length
          pushToast(
            'success',
            `Imported ${file.name}: ${titles} editable scene${titles === 1 ? '' : 's'}${mediaClips.length ? ` + ${mediaClips.length} media clip${mediaClips.length === 1 ? '' : 's'}` : ''} ${how}.${generated.notes.length ? ` ${generated.notes[0]}` : ''}`,
          )
          continue
        }
        const handle = await registerFile(file)
        if (handle.kind === 'audio') {
          // Music gets its own track (the last one) so it never fights the
          // picture tracks for space when the edit is re-stacked.
          const audioTrack = at ? at.track : Math.max(0, doc.trackCount - 1)
          const clip: StudioAudioClip = defaultAudioClip(
            at ? Math.round(at.sec * 100) / 100 : nextFreeStart(doc, audioTrack, 0, Math.max(0.2, handle.durationSec)),
            audioTrack,
            { id: handle.id, fileName: handle.fileName, localPath: handle.localPath, durationSec: handle.durationSec },
          )
          addStudioClip(projectId, clip)
          setSelectedId(clip.id)
          continue
        }
        const durationSec = handle.kind === 'video' ? Math.max(0.2, handle.durationSec) : 4
        start = at ? Math.round(at.sec * 100) / 100 : nextFreeStart(doc, 0, start, durationSec)
        const clip: StudioMediaClip = {
          id: uid(),
          kind: handle.kind,
          track: at?.track ?? 0,
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
  /** 2.10 — one drop path: files and resource cards land at the pointer on the timeline. */
  function onTimelineDrop(data: DataTransfer, sec: number, track: number) {
    if (data.files?.length) {
      void onFiles(data.files, { sec, track })
      return
    }
    const payload = readDragPayload(data)
    if (!payload) {
      pushToast('info', 'Nothing droppable in that drag — try a file or a card from Resources.')
      return
    }
    void applyResourceItem(payload, { atSec: sec, selectedId })
  }

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
    // Same path as the Apply button: a drop lands at the playhead.
    void applyResourceItem(payload, { atSec: time, selectedId })
  }

  function addText() {
    // Above the media, at the playhead; the store lifts it to a free layer if
    // something is already there.
    const clip = defaultTextClip(Math.round(time * 100) / 100, Math.max(1, Math.min(doc.trackCount - 1, 1)))
    addStudioClip(projectId, clip)
    setSelectedId(clip.id)
    setPlaying(false)
    // Park the playhead where the entrance has finished, so the new words are
    // actually visible on the canvas while you type them.
    setTime(clip.startSec + Math.min(0.8, clip.durationSec / 2))
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

  function addAdjustmentLayer() {
    const clip: StudioClip = {
      id: uid(), kind: 'adjustment', track: Math.max(1, Math.min(MAX_TRACKS - 1, doc.trackCount - 1)),
      startSec: Math.round(time * 100) / 100, durationSec: 4, name: 'Adjustment layer',
      transitionIn: 'none', transitionOut: 'none', opacity: 1,
      grade: [{ id: 'balance', enabled: true, exposure: 0, temperature: 0 }, { id: 'contrast', enabled: true, contrast: 12, fade: 0 }, { id: 'look', enabled: true, saturation: 8, hue: 0 }],
    }
    addStudioClip(projectId, clip)
    setSelectedId(clip.id)
    pushToast('success', 'Adjustment layer added above the timeline. Select it to tune the grade.')
  }

  function addSticker() {
    const track = Math.min(1, doc.trackCount - 1)
    // At the playhead, like text: the store stacks it on the first free
    // track (creating one) instead of pushing it later in time.
    const clip = defaultStickerClip(Math.round(time * 100) / 100, track)
    addStudioClip(projectId, clip)
    setSelectedId(clip.id)
  }

  function addShapeAt(id: string) {
    const r = addShapeKit(doc, id, Math.round(time * 100) / 100)
    setShapeOpen(false)
    if (!r.changed) { pushToast('error', r.reason ?? 'Shape not added'); return }
    patchStudio(projectId, { clips: r.doc.clips, trackCount: r.doc.trackCount }, 'Add shape')
    if (r.clipId) setSelectedId(r.clipId)
  }

  function addLoaderAt(presetId: string) {
    const r = addLoader(doc, presetId, Math.round(time * 100) / 100)
    setLoaderOpen(false)
    if (!r.changed) { pushToast('error', r.reason ?? 'Loader not added'); return }
    patchStudio(projectId, { clips: r.doc.clips, trackCount: r.doc.trackCount }, 'Add loader')
    if (r.clipId) setSelectedId(r.clipId)
  }

  /** Cursor click on the selected clip — refuses with the reason when a pointer would be noise. */
  function addCursorClick(force = false) {
    if (!selectedId) { pushToast('info', 'Select the button, toggle or component the cursor should click.'); return }
    const r = addCursorTo(doc, selectedId, { force })
    if (!r.changed) {
      pushToast('info', `${r.reason ?? 'No cursor added.'}${r.verdict && !r.verdict.needed ? ' Shift-click Cursor to add one anyway.' : ''}`)
      return
    }
    patchStudio(projectId, { clips: r.doc.clips, trackCount: r.doc.trackCount }, 'Add cursor click')
    pushToast('success', r.verdict?.reason ?? 'Cursor added.')
    if (r.clipId) setSelectedId(r.clipId)
  }

  function addGlassClip(shape: 'panel' | 'lens' = 'panel', presetId = 'hero') {
    const clip = defaultGlassClip(Math.round(time * 100) / 100, Math.min(1, doc.trackCount - 1), presetId, shape)
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
        setPendingBrief(command.brief)
        speak(`I heard: ${command.brief}. Say yes to start the job, or cancel.`, { interrupt: true })
        break
      }
      case 'undo':
        pushToast('info', 'Undo is on the keyboard only for now.')
        break
    }
  }

  commandRef.current = runVoiceCommand
  toggleVoiceRef.current = toggleVoice

  /** A UI component at the playhead; the recorder captures its real animation. */
  function addComponentAt(slug: string, opts: { recordSec: number; interact: boolean }) {
    const added = withComponent(doc, slug, { startSec: time, recordSec: opts.recordSec, durationSec: opts.recordSec, interact: opts.interact })
    const withMotion = { ...added.clip, ...motionPatch(added.clip, { entrance: 'rise-in', exit: 'fade-out', intensity: 0.8 }) } as StudioClip
    patchStudio(projectId, { trackCount: added.doc.trackCount, clips: added.doc.clips.map((c) => (c.id === withMotion.id ? withMotion : c)) })
    setSelectedId(withMotion.id)
    setPlaying(false)
    setTime(visibleMomentOf(withMotion))
  }

  /** Record a component without placing it (2.13). Place it later from the shelf. */
  function recordComponentToShelf(slug: string, opts: { recordSec: number; interact: boolean }) {
    const item = shelfComponent(slug, opts)
    patchStudio(projectId, { shelf: [item, ...(doc.shelf ?? [])] }, 'Record component to shelf')
  }

  function placeFromShelf(id: string) {
    const item = (doc.shelf ?? []).find((entry) => entry.id === id)
    if (!item) return
    if (!item.frames?.length && !item.dataUrl) {
      pushToast('info', `“${item.name}” has not finished recording yet.`)
      return
    }
    const placed = placeShelfItem(doc, item, time)
    patchStudio(projectId, { trackCount: placed.doc.trackCount, clips: placed.doc.clips }, 'Place recorded component')
    setSelectedId(placed.clip.id)
    setPlaying(false)
  }

  function removeFromShelf(id: string) {
    patchStudio(projectId, { shelf: (doc.shelf ?? []).filter((entry) => entry.id !== id) }, 'Remove recorded component')
  }

  /**
   * 2.7 — export queue: render the same edit at several aspect ratios one
   * after another (clip geometry is normalised, so it reframes). Stop cancels
   * the current job and the rest of the queue.
   */
  const [exportQueue, setExportQueue] = useState<Array<{ aspect: StudioDoc['aspect']; status: 'queued' | 'running' | 'done' | 'failed' | 'cancelled' }>>([])
  async function runExportQueue(aspects: StudioDoc['aspect'][], asMp4: boolean) {
    if (duration <= 0) return pushToast('error', 'Add a clip before exporting.')
    setExportQueue(aspects.map((aspect) => ({ aspect, status: 'queued' })))
    for (let i = 0; i < aspects.length; i += 1) {
      setExportQueue((q) => q.map((job, j) => (j === i ? { ...job, status: 'running' } : job)))
      const outcome = await runExport(asMp4, aspects[i])
      setExportQueue((q) => q.map((job, j) => (j === i ? { ...job, status: outcome } : job)))
      if (outcome === 'cancelled') {
        // Stop only the active recording/conversion; the remaining aspect jobs
        // stay queued and continue so one cancelled size does not poison the farm.
        continue
      }
    }
  }

  /** Batch export: every saved scene (e.g. variants) rendered one after another. */
  async function runSceneBatch(asMp4: boolean) {
    const scenes = doc.scenes ?? []
    if (!scenes.length) return pushToast('info', 'No saved scenes yet — build variants or save a scene first.')
    for (let i = 0; i < scenes.length; i += 1) {
      pushToast('info', `Rendering scene ${i + 1} of ${scenes.length}: ${scenes[i].name}`)
      const outcome = await runExport(asMp4, undefined, { doc: { ...scenes[i].doc, scenes } as StudioDoc, tag: slugify(scenes[i].name) })
      if (outcome === 'cancelled') continue
    }
  }

  async function runExport(asMp4 = false, aspect?: StudioDoc['aspect'], override?: { doc: StudioDoc; tag: string }): Promise<'done' | 'failed' | 'cancelled'> {
    if (duration <= 0) {
      pushToast('error', 'Add a clip before exporting.')
      return 'failed'
    }
    const unfilled = unfilledPlaceholders(doc)
    if (unfilled.length) {
      pushToast('error', `${unfilled.length} testimonial placeholder${unfilled.length > 1 ? 's are' : ' is'} still empty. Fill in real quotes or delete the cards before exporting.`)
      return 'failed'
    }
    const target = override ? override.doc : aspect ? reframeForAspect(doc, aspect) : doc
    const suffix = (override ? `-${override.tag}` : '') + (aspect ? `-${aspect.replace(':', 'x')}` : '')
    if (doc.clips.some(isPendingComponent)) {
      pushToast('info', 'A component is still recording its animation — export as soon as it lands on the timeline.')
      return 'failed'
    }
    // Real-3D block rows: export waits for Three.js so it draws exactly what the preview shows.
    if (needsBlockRow3d(target.clips as Array<{ kind: string; kit?: string; real3d?: boolean }>) && !(await loadBlockRow3d())) {
      pushToast('info', `Real 3D is unavailable: ${blockRow3dError()}. Exporting the 2.5D block row instead.`)
    }
    setPlaying(false)
    setExportPct(0)
    const signal = { cancelled: false }
    cancelRef.current = signal
    try {
      const fileName = `${slugify(project?.name ?? 'cupric-studio')}-studio${suffix}`
      // In Electron, the main-process farm owns the offscreen compositor and
      // the durable output. The browser path below remains the portable
      // fallback, but the interactive Studio never records its own canvas on
      // desktop anymore.
      if (getIpc()) {
        const farm = await exportStudioInBackground(target, {
          fileName,
          fps: target.fps,
          loudnessTarget: target.loudnessTarget ?? null,
          format: asMp4 ? 'mp4' : 'webm',
          onProgress: setExportPct,
          signal,
        })
        const previewUrl = await getIpc()!.invoke('render:preview', farm.outputPath) as string
        setLastExport({ url: previewUrl, fileName: `${fileName}.${asMp4 ? 'mp4' : 'webm'}` })
        if (!asMp4) await getIpc()!.invoke('render:copyToDownloads', farm.outputPath)
        pushToast('success', `Saved ${farm.outputPath.split(/[\\/]/).pop()} (${Math.round(farm.bytes / 1024)} KB)`)
        cueDone()
        return 'done'
      }
      const result = await exportStudio(target, {
        fileName,
        scale: 1,
        onProgress: setExportPct,
        signal,
        onWarning: (message) => pushToast('error', message, { sticky: true }),
      })
      if (result.cancelled) {
        pushToast('info', 'Export cancelled')
        return 'cancelled'
      } else if (asMp4) {
        pushToast('info', 'Converting to MP4 with FFmpeg\u2026')
        const mp4 = await convertToMp4(result.blob, `${slugify(project?.name ?? 'cupric-studio')}${suffix}`, doc.fps, doc.loudnessTarget ?? null, signal)
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
      return 'done'
    } catch (err) {
      if (signal.cancelled) {
        pushToast('info', 'Export cancelled')
        return 'cancelled'
      }
      pushToast('error', humanError(err, 'Export'))
      cueProblem()
      return 'failed'
    } finally {
      setExportPct(null)
      cancelRef.current = null
    }
  }

  const exporting = exportPct !== null
  const pps = ZOOM_STEPS[zoom]

  return (
    <div className="flex h-full min-h-0 flex-col">
      {showShortcuts && <ShortcutSheet onClose={() => setShowShortcuts(false)} />}
      {/* Toolbar */}
      {/* One row at every width: the add-strip scrolls sideways instead of
          wrapping, so the preview never loses a whole row of height. */}
      <div className="flex shrink-0 flex-wrap items-center gap-x-2 gap-y-2 border-b border-line bg-panel/50 px-6 py-2.5 shadow-[var(--shadow-sheen)] backdrop-blur-xl">
        <h1 className="mr-2 shrink-0 text-md font-semibold">Studio</h1>
        {/* Row 1: panels are always visible (they used to hide past the fade). */}
        <div className="flex shrink-0 items-center gap-1.5" role="group" aria-label="Studio panels">
          <Button
          size="sm"
          variant={showResources ? 'primary' : 'outline'}
          onClick={() => {
            setShowResources((shown) => !shown)
            setShowComponents(false)
            setShowPro(false)
          }}
          disabled={exporting} title={(exporting) ? 'Wait for the export to finish' : undefined}
        >
            <Boxes size={13} /> Resources
          </Button>
          <Button
          size="sm"
          variant={showComponents ? 'primary' : 'outline'}
          onClick={() => {
            setShowComponents((shown) => !shown)
            setShowResources(false)
            setShowPro(false)
          }}
          disabled={exporting}
          title="Every UI component, recorded with its real animation"
        >
            <Component size={13} /> Components
          </Button>
          <Button
          size="sm"
          variant={showPro ? 'primary' : 'outline'}
          onClick={() => {
            setShowPro((shown) => !shown)
            setShowResources(false)
            setShowComponents(false)
          }}
          disabled={exporting}
          title="Suggestions, build-from-assets, layouts, captions, markers, scopes, import from link"
        >
            <Sparkles size={13} /> Pro tools
          </Button>
          <Button size="sm" variant="outline" onClick={() => setAskOpen(true)} title="Ask Cupric AI to edit this timeline: trims, captions, keyframes, transitions">
            <Wand2 size={13} /> Cupric AI
          </Button>
        </div>
        <div className="flex-1" />
        {/* Row 2 (order-last, full width): the add-strip, scrollable with visible arrows. */}
        <div className="order-last flex w-full min-w-0 basis-full items-center gap-1">
        <IconButton label="Scroll tools left" onClick={() => stripRef.current?.scrollBy({ left: -240, behavior: 'smooth' })}><ChevronLeft size={15} /></IconButton>
        <div ref={stripRef} className="flex min-w-0 flex-1 items-center gap-2 overflow-x-auto py-0.5 [scrollbar-width:thin] [&>*]:shrink-0"
          onWheel={(e) => { if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) e.currentTarget.scrollLeft += e.deltaY }}
        >

        <Button size="sm" variant="outline" onClick={() => fileRef.current?.click()} disabled={importing || exporting} title="Import video, images, audio, an HTML page or a generated ZIP package">
          {importing ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />} Import
        </Button>
        <input
          ref={fileRef}
          type="file"
          accept="video/*,image/*,.heic,.heif,audio/*,.zip,.html,.htm"
          multiple
          className="hidden"
          onChange={(e) => void onFiles(e.target.files)}
        />
        <Button size="sm" variant="outline" onClick={() => audioRef.current?.click()} disabled={importing || exporting} title={(importing || exporting) ? 'Wait for the import or export to finish' : undefined}>
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
        <Button size="sm" variant="outline" onClick={addText} disabled={exporting} title={(exporting) ? 'Wait for the export to finish' : undefined}>
          <TypeIcon size={13} /> Text
        </Button>
        <Button size="sm" variant="outline" onClick={addBackgroundClip} disabled={exporting} title={(exporting) ? 'Wait for the export to finish' : undefined}>
          <ImageIcon size={13} /> Background
        </Button>
        <Button size="sm" variant="outline" onClick={addAdjustmentLayer} disabled={exporting} title="Non-destructive colour grade for clips below this layer">
          <SlidersHorizontal size={13} /> Adjustment
        </Button>
        <Button size="sm" variant="outline" onClick={() => addGlassClip('panel')} disabled={exporting} title={(exporting) ? 'Wait for the export to finish' : undefined}>
          <Sparkles size={13} /> Glass
        </Button>
        <Button size="sm" variant="outline" onClick={addSticker} disabled={exporting} title={(exporting) ? 'Wait for the export to finish' : undefined}>
          <Sticker size={13} /> Sticker
        </Button>
        <div className="relative">
          <Button size="sm" variant="outline" onClick={() => setShapeOpen((v) => !v)} disabled={exporting} title={(exporting) ? 'Wait for the export to finish' : undefined} aria-expanded={shapeOpen}>
            <Shapes size={13} /> Shape
          </Button>
          {shapeOpen && <ShapePicker onPick={addShapeAt} onClose={() => setShapeOpen(false)} />}
        </div>
        <div className="relative">
          <Button size="sm" variant="outline" onClick={() => setLoaderOpen((v) => !v)} disabled={exporting} aria-expanded={loaderOpen} title="Thinking states and matrix dot loaders (Transitions.dev), editable and export-exact">
            <LoaderIcon size={13} /> Loader
          </Button>
          {loaderOpen && <LoaderPicker onPick={addLoaderAt} onClose={() => setLoaderOpen(false)} />}
        </div>
        <div className="relative">
          <Button size="sm" variant="outline" onClick={() => setHomeOpen((v) => !v)} disabled={exporting} aria-expanded={homeOpen} title="Six Home_X video styles built from native clips — offline and export-exact">
            <LayoutTemplate size={13} /> Styles
          </Button>
          {homeOpen && (
            <HomeVideoPanel
              doc={doc}
              project={project ?? null}
              onApply={(next, label) => patchStudio(projectId, { clips: next.clips, trackCount: next.trackCount }, label)}
              onClose={() => setHomeOpen(false)}
            />
          )}
        </div>
        <Button size="sm" variant="outline" onClick={(e) => addCursorClick(e.shiftKey)} disabled={exporting} title="Animated cursor that clicks the selected clip — only added where an interaction needs showing">
          <MousePointerClick size={13} /> Cursor
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => selectedId && splitStudioClip(projectId, selectedId, time)}
          disabled={!selectedId || exporting}
          title={selectedId ? 'Split the selected clip at the playhead (S)' : 'Select a clip to split it'}
        >
          <Scissors size={13} /> Split
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

        </div>
        <IconButton label="Scroll tools right" onClick={() => stripRef.current?.scrollBy({ left: 240, behavior: 'smooth' })}><ChevronRight size={15} /></IconButton>
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
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
          <Button size="sm" variant="outline" onClick={() => void runExport(false)} disabled={exporting || duration <= 0} title={(exporting || duration <= 0) ? 'Add clips first — or wait for the export' : undefined}>
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
          <Button
            size="sm"
            variant="outline"
            onClick={() => void runExportQueue(['9:16', '1:1', '16:9'], mp4Supported)}
            disabled={exporting || duration <= 0}
            title="Queue the edit at 9:16, 1:1 and 16:9 — rendered one after another"
          >
            <Download size={13} /> All sizes
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => void runSceneBatch(mp4Supported)}
            disabled={exporting || !(doc.scenes ?? []).length}
            title={(doc.scenes ?? []).length ? `Render all ${(doc.scenes ?? []).length} saved scenes / variants, one after another` : 'Save scenes or build variants first'}
          >
            <Download size={13} /> Export every scene
          </Button>
          {exportQueue.length > 0 && (
            <span className="font-mono text-xs text-muted" role="status" aria-label="Export queue">
              {exportQueue.map((j) => `${j.aspect} ${j.status === 'done' ? '✓' : j.status === 'running' ? '…' : j.status === 'queued' ? '·' : '✕'}`).join('  ')}
            </span>
          )}
        </div>
      </div>
      <EditToolsBar doc={doc} selectedId={selectedId} multiIds={multiIds} onClearMulti={() => setMultiIds(new Set())} onCommit={(next, label) => patchStudio(projectId, { clips: next.clips, trackCount: next.trackCount, markers: next.markers }, label)} onNote={(kind, msg) => pushToast(kind, msg)} />
      <TextListPanel doc={doc} brandKit={project?.brandKit} selectedId={selectedId} onSelect={(id, at) => { setSelectedId(id); setMultiIds(new Set()); setTime(at) }} onCommit={(next, label) => patchStudio(projectId, { clips: resolveOverlaps(next).clips }, label)} onNote={(kind, msg) => pushToast(kind, msg)} />

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
          onClick={() => void planAgentEdit(agentInstruction.trim() || 'Auto edit and polish the complete timeline. Read all clip names, copy, timing and duration. Apply context-appropriate bundled typography, automatic keyword highlighting, purposeful text animation, varied native transitions, safe-area placement, track hierarchy, and purposeful keyframe motion on visual clips. Match the style to the content. Preserve meaning and source media.')}
          title="Analyze the complete timeline and preview an automatic edit"
        >
          Auto polish
        </Button>
        <Button
          size="sm"
          type="button"
          variant="ghost"
          disabled={agentPlanning || exporting || doc.clips.length === 0}
          onClick={() => void planAgentEdit('Create a cohesive automatic effects pass without deleting or rewriting source content. Choose a different suitable native transition at scene boundaries, animate and highlight the strongest existing word in each important caption, and add gentle start/end keyframes to images and videos. Keep effects readable.')}
          title="Automatically choose native effects, then show every change for approval"
        >
          Auto effects
        </Button>
        <Button size="sm" type="submit" disabled={!agentInstruction.trim() || agentPlanning || exporting} title={(!agentInstruction.trim() || agentPlanning || exporting) ? 'Type an instruction first — or wait for the current plan' : undefined}>
          {agentPlanning ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />}
          {agentPlanning ? 'Planning…' : 'Preview edit'}
        </Button>
      </form>
      {agentPlanning && (
        <div className="flex shrink-0 items-center gap-3 border-b border-line bg-accent/5 px-6 py-2 text-xs text-muted" role="status" aria-live="polite">
          <MatrixLoader variant="orbit" tone="lime" label="Planning the edit" />
          <ThinkingStates states={[agentPhase || 'Planning the edit']} baseColor="var(--color-text)" />
          <span>· Live AI has at most 10 seconds, then Cupric instantly switches to its local editor.</span>
        </div>
      )}

      {polishOffer && !agentPlan && (
        <div role="status" className="flex shrink-0 flex-wrap items-center gap-3 border-b border-line bg-accent/5 px-6 py-2 text-xs">
          <Sparkles size={13} className="text-accent-text" />
          <span className="min-w-0 flex-1 text-text">Background polish ready: {polishOffer.plan.ops.length} edit{polishOffer.plan.ops.length === 1 ? '' : 's'} planned locally while you paused. Nothing changes until you accept.</span>
          <Button size="sm" variant="primary" onClick={() => { setAgentPlan(polishOffer.plan); setPolishOffer(null) }}>Preview</Button>
          <Button size="sm" variant="ghost" onClick={() => setPolishOffer(null)}>Dismiss</Button>
          <Button size="sm" variant="ghost" onClick={() => { setBackgroundPolishEnabled(false); setPolishOn(false); setPolishOffer(null) }} title="Stop offering background polish passes (turn back on from the agent bar)">Turn off</Button>
        </div>
      )}
      {!polishOn && (
        <div className="flex shrink-0 justify-end px-6 py-1">
          <Button size="sm" variant="ghost" onClick={() => { setBackgroundPolishEnabled(true); setPolishOn(true) }}>Turn background polish on</Button>
        </div>
      )}

      {agentPlan && (
        <div className="shrink-0 border-b border-line bg-panel px-6 py-3">
          <div className="flex items-start gap-4">
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold">{agentPlan.summary}</div>
              <div className="mt-1 text-xs text-muted">{agentPlan.source === 'live' ? 'Planned by your connected AI model' : 'Planned locally'} · preview only until accepted</div>
              {agentPlan.warning && <div className="mt-1 text-xs text-danger">{agentPlan.warning}</div>}
              <ul className="mt-2 max-h-36 space-y-1 overflow-y-auto pr-2 text-xs text-muted">
                {agentPlan.ops.map((op, index) => <li key={index}>+ {describeStudioEditOp(op, doc)}</li>)}
              </ul>
              <div className="mt-3 rounded-lg border border-line bg-bg/60 p-2.5">
                <p className="text-xs font-medium text-text">Does anything look wrong?</p>
                <p className="mt-0.5 text-[11px] text-muted">Tell me what to change—less motion, another font, different highlights, timing, or layout—and I’ll rebuild the preview before applying it.</p>
                <div className="mt-2 flex gap-2">
                  <input
                    value={agentRevision}
                    onChange={(event) => setAgentRevision(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' && agentRevision.trim()) {
                        event.preventDefault()
                        void planAgentEdit(`Revise this automatic edit. ${agentRevision.trim()}. Keep every other useful choice and return a complete corrected plan.`)
                      }
                    }}
                    placeholder="Example: keep it calmer and use Space Grotesk"
                    className="h-8 min-w-0 flex-1 cu-panel px-2.5 text-xs"
                  />
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={!agentRevision.trim() || agentPlanning} title={(!agentRevision.trim() || agentPlanning) ? 'Type what to change first — or wait for the current plan' : undefined}
                    onClick={() => void planAgentEdit(`Revise this automatic edit. ${agentRevision.trim()}. Keep every other useful choice and return a complete corrected plan.`)}
                  >
                    Revise
                  </Button>
                </div>
              </div>
            </div>
            <div className="flex shrink-0 gap-2">
              <Button size="sm" variant="ghost" onClick={() => setAgentPlan(null)}>Reject</Button>
              <Button size="sm" variant="primary" onClick={acceptAgentPlan}>Accept all</Button>
            </div>
          </div>
        </div>
      )}

      {pendingBrief && (
        <div role="alertdialog" aria-label="Confirm voice brief" className="flex shrink-0 flex-wrap items-center gap-3 border-b border-accent/40 bg-accent/10 px-6 py-2">
          <span className="min-w-0 flex-1 text-xs text-text">Start an autonomous job for <b>“{pendingBrief}”</b>? Say “yes” or “cancel”.</span>
          <Button size="sm" variant="primary" onClick={() => confirmBriefRef.current(true)}>Start job</Button>
          <Button size="sm" variant="outline" onClick={() => confirmBriefRef.current(false)}>Cancel</Button>
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
          {/* Delivery audit: the document's own frames, measured. The list below
              is the cheap structural lint; this is the one that reads pixels. */}
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="outline" onClick={runAudit} disabled={auditing || duration <= 0} title="Render a few frames and measure contrast, safe areas and delivery on them">
              {auditing ? <Loader2 size={13} className="animate-spin" /> : <ShieldCheck size={13} />}
              {auditing ? 'Checking frames…' : 'Run delivery checks'}
            </Button>
            <span className="text-xs text-muted">
              Renders the edit at audit size and measures what the viewer actually sees — contrast where the text sits, platform safe areas, and the delivery numbers when it has them.
            </span>
          </div>
          {audit && (
            <div className="space-y-2 rounded-md border border-line bg-panel-alt px-3 py-2">
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className={cx('h-1.5 w-1.5 rounded-full', audit.report.ok ? 'bg-[rgb(120_200_120)]' : 'bg-[rgb(226_75_74)]')} />
                <span className="text-text">{describeAudit(audit.report)}</span>
                {audit.doc !== doc && <span className="text-muted">· the edit changed since — run it again</span>}
                {auditFindings.some((f) => f.clipId && f.fix) && (
                  <button type="button" className="text-accent-text underline underline-offset-2" onClick={applyAudit}>
                    Fix all ({auditFindings.filter((f) => f.clipId && f.fix).length})
                  </button>
                )}
              </div>
              {auditFindings.map((finding) => (
                <div key={`${finding.gate}:${finding.id}`} className="flex items-start gap-3 text-xs">
                  <span
                    className={cx(
                      'mt-1 h-1.5 w-1.5 shrink-0 rounded-full',
                      finding.severity === 'error' ? 'bg-[rgb(226_75_74)]' : 'bg-[rgb(255_196_92)]',
                    )}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-text">
                      <span className="font-mono text-muted">{finding.gate}</span> · {finding.message}
                    </p>
                    {finding.hint && <p className="text-muted/80">{finding.hint}</p>}
                  </div>
                  {finding.clipId && (
                    <button
                      type="button"
                      className="shrink-0 text-accent-text underline underline-offset-2"
                      onClick={() => setSelectedId(finding.clipId ?? null)}
                    >
                      Show me
                    </button>
                  )}
                  {finding.fix && finding.clipId && (
                    <button
                      type="button"
                      className="shrink-0 text-accent-text underline underline-offset-2"
                      onClick={() => updateStudioClip(pid as string, finding.clipId as string, finding.fix!.patch)}
                    >
                      {finding.fix.label}
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
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
          <MatrixLoader variant="scan" label={`Exporting, ${Math.round(exportPct ?? 0)} percent`} />
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

      <ComponentRecorderHost projectId={projectId} doc={doc} />

      {/* Shared resources + stage + inspector */}
      <div className="flex min-h-0 flex-1">
        {showComponents && (
          <aside className="w-[360px] shrink-0 overflow-y-auto border-r border-line bg-gradient-to-b from-panel/80 to-bg px-4 py-4 shadow-[inset_-1px_0_0_rgb(255_255_255/0.03)]" aria-label="Studio components">
            <ComponentsPanel
              onAdd={addComponentAt}
              onRecordToShelf={recordComponentToShelf}
              shelf={doc.shelf ?? []}
              onPlaceShelf={placeFromShelf}
              onRemoveShelf={removeFromShelf}
            />
          </aside>
        )}
        {showPro && (
          <aside className="w-[380px] shrink-0 overflow-y-auto border-r border-line bg-gradient-to-b from-panel/80 to-bg px-4 py-4 shadow-[inset_-1px_0_0_rgb(255_255_255/0.03)]" aria-label="Studio pro tools">
            <StudioProPanel
              doc={doc}
              time={time}
              selectedId={selectedId}
              onSeek={seek}
              onImportFiles={(files) => void onFiles(files, { sec: time, track: Math.max(0, ...doc.clips.filter((c) => c.kind === 'audio').map((c) => c.track), doc.trackCount) })}
              onPreview={(next, label) => setPreviewDoc(next ? { doc: next, label } : null)}
              onCommit={(next, label) => {
                const { ...patch } = next
                patchStudio(projectId, patch, label)
              }}
            />
          </aside>
        )}
        {showResources && (
          <aside className="w-[420px] shrink-0 overflow-y-auto border-r border-line bg-gradient-to-b from-panel/80 to-bg px-4 py-4 shadow-[inset_-1px_0_0_rgb(255_255_255/0.03)]" aria-label="Studio resources">
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
            {/* Always mount the preview: an empty project still paints its
                background, with the drop hint laid over it (0.10.1). */}
            <div className="relative flex h-full w-full min-w-0 items-center justify-center">
              <StudioNotices doc={previewDoc?.doc ?? doc} />
              {doc.clips.length === 0 && !previewDoc && (
                <div data-studio-empty-hint className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center p-6">
                  <div className="pointer-events-auto max-w-sm rounded-xl border border-dashed border-line bg-panel/80 px-6 py-7 text-center shadow-[0_12px_32px_rgb(0_0_0/0.36)] backdrop-blur">
                    <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-xl border border-line bg-panel-alt text-muted">
                      <Clapperboard size={18} />
                    </div>
                    <h2 className="mt-3 text-base font-semibold">Drop footage, photos or a resource card here</h2>
                    <p className="mt-1.5 text-sm leading-relaxed text-muted">
                      Or import media, then stack text and backgrounds on the tracks below. Nothing leaves the machine — the
                      preview and the export are the same renderer.
                    </p>
                    <div className="mt-4">
                      <Button variant="primary" onClick={() => fileRef.current?.click()}>
                        <Plus size={14} /> Import media
                      </Button>
                    </div>
                  </div>
                </div>
              )}
              <div
                className="contents"
                onContextMenu={(e) => {
                  // Canvas right-click acts on the selected clip (same menu as the timeline).
                  e.preventDefault()
                  if (selected) setClipMenuAt({ clipId: selected.id, x: e.clientX, y: e.clientY })
                  else pushToast('info', doc.clips.length ? 'Select a clip on the canvas or timeline, then right-click for its actions.' : 'The timeline is empty — drop or import media first.')
                }}
              >
              <StudioPreview
                doc={previewDoc?.doc ?? doc}
                selected={selected}
                onPatchSelected={(patch) => {
                  if (!selectedId) return
                  if (selected?.locked) { pushToast('info', 'That clip is locked — unlock it to move it (Ctrl+L).'); return }
                  updateStudioClip(projectId, selectedId, patch)
                }}
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
              </div>
            </div>
          </div>

          {/* Transport */}
          {/* A size container: labels never wrap; on narrow panels the least
              important bits (project info, long labels) step out instead. */}
          <div className="@container flex shrink-0 items-center gap-2 flex-wrap gap-y-1.5 whitespace-nowrap border-t border-line px-4 py-2 [&>*]:shrink-0">
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
            <span className="mr-1 font-mono text-xs text-muted tabular-nums">
              {fmtClock(time)} / {fmtClock(duration)}
            </span>
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
              aria-label="Keyframe record"
              title="When enabled, canvas transforms record a keyframe at the playhead"
              onClick={() => setKeyframeRecord((recording) => !recording)}
              className={cx(
                'rounded-md border px-2 py-1 text-xs transition-colors',
                keyframeRecord ? 'border-danger/60 bg-danger/10 text-danger' : 'border-line text-muted hover:text-text',
              )}
            >
              ● <span className="@max-[36rem]:hidden">Keyframe </span>record
            </button>
            <span className="ml-auto font-mono text-xs text-muted tabular-nums @max-[44rem]:hidden">
              {doc.aspect} · {doc.fps}fps · {doc.clips.length} clip{doc.clips.length === 1 ? '' : 's'}
            </span>
            <button
              type="button"
              onClick={() => setShowShortcuts(true)}
              title="Keyboard shortcuts (?)"
              className="ml-auto rounded-md border border-line px-2 py-1 font-mono text-xs text-muted transition-colors hover:text-text @min-[44rem]:ml-0"
            >
              ?<span className="@max-[40rem]:hidden"> Shortcuts</span>
            </button>
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

          {/* Drag to resize the timeline, like any NLE. */}
          <div
            role="separator"
            aria-orientation="horizontal"
            aria-label="Resize timeline"
            title="Drag to resize the timeline · double-click to fit tracks"
            onDoubleClick={() => setTimelineH(null)}
            onPointerDown={(e) => {
              e.preventDefault()
              const column = (e.currentTarget.parentElement as HTMLElement).getBoundingClientRect()
              const move = (ev: PointerEvent) => setTimelineH(clamp(column.bottom - ev.clientY, 120, column.height - 180))
              const up = () => {
                window.removeEventListener('pointermove', move)
                window.removeEventListener('pointerup', up)
              }
              window.addEventListener('pointermove', move)
              window.addEventListener('pointerup', up)
            }}
            className="group relative h-1.5 shrink-0 cursor-row-resize bg-line/40 transition-colors hover:bg-accent/50"
          >
            <span className="absolute left-1/2 top-1/2 h-0.5 w-10 -translate-x-1/2 -translate-y-1/2 rounded bg-muted/50 group-hover:bg-accent-ink/70" />
          </div>
          <div
            className="min-h-[120px] shrink-0"
            style={{ height: timelineH ?? `min(40%, ${Math.max(150, 44 + doc.trackCount * 62)}px)` }}
          >
            <StudioTimeline
              doc={doc}
              time={time}
              pps={pps}
              duration={duration}
              selectedId={selectedId}
              onSelect={(id) => { setSelectedId(id); setMultiIds(new Set()) }}
              multiIds={multiIds}
              onToggleMulti={(id) => setMultiIds((cur) => toggleInSelection(cur, selectedId, id))}
              onSeek={(t) => {
                setPlaying(false)
                seek(t)
              }}
              onPatchClip={(id, patch) => { const grouped = moveWithGroup(doc, id, patch); if (grouped) patchStudio(projectId, { clips: grouped.clips, trackCount: grouped.trackCount }, 'Move group'); else updateStudioClip(projectId, id, patch) }}
              onReorderTrack={(from, to) => reorderStudioTracks(projectId, from, to)}
              onSettleClip={(id) => settleStudioClip(projectId, id)}
              onDropAt={onTimelineDrop}
              onClipContextMenu={(clipId, x, y) => { setSelectedId(clipId); setClipMenuAt({ clipId, x, y }) }}
            />
            {clipMenuAt && doc.clips.some((c) => c.id === clipMenuAt.clipId) && (
              <ClipContextMenu
                clip={doc.clips.find((c) => c.id === clipMenuAt.clipId)!}
                x={clipMenuAt.x}
                y={clipMenuAt.y}
                time={time}
                hasClipboard={!!getClipboard()}
                extra={(() => {
                  const c = doc.clips.find((x) => x.id === clipMenuAt.clipId)
                  return c?.kind === 'video' ? [{ id: 'proxy', label: 'Make preview proxy', run: () => void makeProxy((c as StudioMediaClip).mediaId).then((st) => st.error && pushToast('info', st.error)) }] : []
                })()}
                onAction={(action) => runClipAction(clipMenuAt.clipId, action)}
                onClose={() => setClipMenuAt(null)}
              />
            )}
          </div>
        </div>

        <aside className={cx('w-80 shrink-0 overflow-y-auto border-l border-line bg-gradient-to-b from-panel-alt/60 to-panel px-5 py-4 shadow-[inset_1px_0_0_rgb(255_255_255/0.04)]')}>
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

const SHORTCUTS: Array<[string, string]> = [
  ['Space', 'Play / pause'],
  ['J · L', 'Back / forward half a second (L plays)'],
  ['← →', 'Step one frame (Shift: one second)'],
  ['K', 'Add a keyframe to the selected clip at the playhead'],
  ['S', 'Split the selected clip at the playhead'],
  ['I · O', 'Trim the selected clip’s in / out point to the playhead'],
  ['Alt + arrows', 'Nudge the selected layer (Shift: bigger steps)'],
  ['Double-click text', 'Edit it right on the canvas (Enter to finish)'],
  ['Drag on canvas', 'Snaps to centre and safe areas (hold Alt to place freely)'],
  ['Delete', 'Remove the selected clip'],
  ['Shift + Delete', 'Ripple delete — remove and close the gap'],
  ['Q · W', 'Trim the selected clip’s start / end to the playhead'],
  ['[ · ]', 'Slip the source under the clip a frame (Shift: 10)'],
  ['Alt + [ · ]', 'Slide the clip between its neighbours (Shift: 10 frames)'],
  ['Alt + , / .', 'Roll the cut after the selected clip'],
  ['M', 'Drop a marker at the playhead'],
  ['; · \'', 'Jump to the previous / next marker'],
  ['Ctrl/⌘ + Z', 'Undo (Shift: redo)'],
  ['Right-click a clip', 'Context menu: split, duplicate, copy, lock, hide, flip, arrange…'],
  ['Ctrl/⌘ + C · X · V', 'Copy · cut · paste at the playhead'],
  ['Ctrl/⌘ + D', 'Duplicate the selected clip'],
  ['Ctrl/⌘ + L · H · M', 'Lock · hide · mute the selected clip'],
  ['Ctrl/⌘ + [ · ]', 'Send backward · bring forward a track'],
  ['?', 'Show or hide this sheet'],
]

function ShortcutSheet({ onClose }: { onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-6 backdrop-blur-sm" onClick={onClose} role="presentation">
      <div
        role="dialog"
        aria-label="Studio keyboard shortcuts"
        className="w-full max-w-lg rounded-2xl border border-line bg-panel p-5 shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold">Studio shortcuts</h2>
          <button type="button" onClick={onClose} className="rounded-md px-2 py-1 text-xs text-muted hover:text-text">Close · Esc</button>
        </div>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
          {SHORTCUTS.map(([keys, what]) => (
            <div key={keys} className="contents">
              <dt><kbd className="cu-input px-1.5 py-0.5 font-mono text-[11px] text-text">{keys}</kbd></dt>
              <dd className="text-muted">{what}</dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  )
}
