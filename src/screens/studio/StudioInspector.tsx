import { useEffect, useRef, useState } from 'react'
import { VIDEO_FONT_FAMILIES, VIDEO_FONTS, fontInfo } from '../../lib/studio/videoFonts'
import {
  CAMERA_RECIPES,
  EMPHASIS_RECIPES,
  ENTRANCE_RECIPES,
  EXIT_RECIPES,
  MOTION_PRESETS,
  describeMotionSpec,
  motionPatch,
  type MotionSpec,
} from '../../lib/studio/motionDirector'
import { Copy, Link2, Plus, RefreshCw, Scissors, Trash2, Type } from 'lucide-react'
import type {
  StudioAudioClip,
  StudioBackgroundClip,
  StudioClip,
  StudioDoc,
  StudioGlassClip,
  StudioGradeNode,
  StudioKeyframe,
  StudioMask,
  StudioMediaClip,
  StudioCustomBackground,
  StudioOverlayClip,
  StudioStickerClip,
  StudioTextClip,
} from '../../types/project'
import { Button } from '../../components/Button'
import { ClipProFields } from './ClipProFields'
import { KeyframeGraph } from './KeyframeGraph'
import { CurveEditor } from './CurveEditor'
import { FontStudio, useUserFonts } from './FontStudio'
import { FramecnFields, CursorFields, RichTextFields, ShapeFields, ThreeDFields } from './InspectorExtras'
import { LoaderFields } from './LoaderFields'
import { KitFields } from './KitFields'
import { STUDIO_BACKGROUNDS } from '../../lib/studio/backgrounds'
import { TEXT_ANIMATIONS, TRANSITIONS, transitionInfo } from '../../lib/studio/transitions'
import { GLASS_PRESETS } from '../../lib/glass'
import { STICKERS } from '../../lib/studio/lottie'
import { hasMedia, registerFile } from '../../lib/studio/media'

import { clampRecordSec, findComponent, MAX_RECORD_SEC, rememberRecordSec } from '../../lib/studio/components'
import { applyResource } from '../../lib/studio/resourceApply'
import { cx } from '../../lib/utils'
import { CHANNEL_PRESETS, matchingPreset, presetLabel, presetWarnings } from '../../lib/studio/formats'
import { docDuration, sizeForAspect } from '../../lib/studio/doc'
import { applyTrack, sourceFrameMap, trackBox, trackSummary } from '../../lib/studio/maskTrack'
import { sampleLumaFrames } from '../../lib/studio/autoEditAnalysis'

/** Values of the built-in Font options; anything else came from Resources → Fonts. */
const BUNDLED_FONT_VALUES = VIDEO_FONT_FAMILIES

type Props = {
  doc: StudioDoc
  /** Playhead, in document seconds — keyframes are recorded where it stands. */
  time: number
  clip: StudioClip | null
  onPatch: (patch: Partial<StudioClip>) => void
  onDelete: () => void
  onDuplicate: () => void
  onSplit: () => void
  onPatchDoc: (patch: Partial<StudioDoc>) => void
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1.5">
      <span className="text-xs font-medium text-muted">{label}</span>
      {children}
      {hint && <span className="block text-xs text-muted/70">{hint}</span>}
    </label>
  )
}

const inputCx =
  'w-full cu-input px-2.5 py-1.5 text-base text-text placeholder:text-muted/60'


/**
 * A collapsed section.
 *
 * Restraint: grading, masking and mixing are real controls that most clips
 * never need, so they stay folded away until asked for. One primary set of
 * controls is visible; everything else is one click deep.
 */
function Disclosure({
  label,
  summary,
  active,
  children,
  defaultOpen,
}: {
  label: string
  summary?: string
  active?: boolean
  children: React.ReactNode
  defaultOpen?: boolean
}) {
  return (
    <details open={defaultOpen} className="group cu-section">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-3 py-2">
        <span className="flex items-center gap-2 text-xs font-medium text-text">
          {label}
          {active && <span className="h-1.5 w-1.5 rounded-full bg-accent" aria-label="in use" />}
        </span>
        <span className="text-xs text-muted/70">{summary}</span>
      </summary>
      <div className="space-y-3 border-t border-line px-3 py-3">{children}</div>
    </details>
  )
}

function Slider({
  label,
  value,
  min,
  max,
  step,
  suffix,
  onChange,
}: {
  label: string
  value: number
  min: number
  max: number
  step: number
  suffix?: string
  onChange: (v: number) => void
}) {
  return (
    <Field label={label}>
      <div className="flex items-center gap-3">
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          className="h-1 w-full min-w-0 flex-1 accent-[var(--color-accent)]"
        />
        <span className="w-12 shrink-0 text-right font-mono text-xs text-muted tabular-nums">
          {value.toFixed(step < 1 ? 2 : 0)}
          {suffix ?? ''}
        </span>
      </div>
    </Field>
  )
}

export function StudioInspector({ doc, time, clip, onPatch, onDelete, onDuplicate, onSplit, onPatchDoc }: Props) {
  const bgFileRef = useRef<HTMLInputElement>(null)
  if (!clip) {
    return (
      <div className="space-y-5">
        <div>
          <h2 className="text-base font-semibold text-text">Composition</h2>
          <p className="mt-1 text-xs text-muted">Select a clip on the timeline to edit it.</p>
        </div>

        <Field label="Aspect">
          <div className="grid grid-cols-4 gap-1.5">
            {(['9:16', '4:5', '1:1', '16:9'] as const).map((aspect) => (
              <button
                key={aspect}
                type="button"
                onClick={() => onPatchDoc({ aspect })}
                className={cx(
                  'rounded-lg border px-2 py-1.5 font-mono text-xs transition-colors duration-150',
                  doc.aspect === aspect
                    ? 'border-accent bg-accent text-accent-ink'
                    : 'border-line bg-panel-alt text-muted hover:text-text',
                )}
              >
                {aspect}
              </button>
            ))}
          </div>
        </Field>

        <Field label="Channel preset">
          <select
            className="w-full cu-input px-2.5 py-1.5 text-sm text-text"
            value={matchingPreset(doc)?.id ?? ''}
            onChange={(e) => {
              const p = CHANNEL_PRESETS.find((x) => x.id === e.target.value)
              if (p) onPatchDoc({ aspect: p.aspect, resolution: p.resolution, fps: p.fps })
            }}
          >
            <option value="">Custom</option>
            {(['Social', 'Video', 'Ultra HD'] as const).map((g) => (
              <optgroup key={g} label={g}>
                {CHANNEL_PRESETS.filter((p) => p.group === g).map((p) => <option key={p.id} value={p.id}>{presetLabel(p)}</option>)}
              </optgroup>
            ))}
          </select>
          {(() => {
            const p = matchingPreset(doc)
            const warn = p ? presetWarnings(p, docDuration(doc)) : []
            return warn.map((w) => <p key={w} className="mt-1 text-xs text-muted">{w}</p>)
          })()}
        </Field>

        <Field label="Resolution">
          <div className="grid grid-cols-4 gap-1.5">
            {(['720p', '1080p', '1440p', '2160p'] as const).map((res) => (
              <button
                key={res}
                type="button"
                title={sizeForAspect(doc.aspect, res).join('×')}
                onClick={() => onPatchDoc({ resolution: res })}
                className={cx(
                  'rounded-lg border px-2 py-1.5 font-mono text-xs transition-colors duration-150',
                  (doc.resolution ?? '1080p') === res ? 'border-accent bg-accent text-accent-ink' : 'border-line bg-panel-alt text-muted hover:text-text',
                )}
              >
                {res === '2160p' ? '4K' : res}
              </button>
            ))}
          </div>
          <p className="mt-1 font-mono text-[11px] text-muted">Exports at {sizeForAspect(doc.aspect, doc.resolution).join('×')}</p>
        </Field>

        <Field label="Frame rate">
          <div className="grid grid-cols-3 gap-1.5">
            {([24, 30, 60] as const).map((fps) => (
              <button
                key={fps}
                type="button"
                onClick={() => onPatchDoc({ fps })}
                className={cx(
                  'rounded-lg border px-2 py-1.5 font-mono text-xs transition-colors duration-150',
                  doc.fps === fps
                    ? 'border-accent bg-accent text-accent-ink'
                    : 'border-line bg-panel-alt text-muted hover:text-text',
                )}
              >
                {fps}
              </button>
            ))}
          </div>
        </Field>

        <Field label="Background mode" hint="Independent of the selected layer.">
          <div className="grid grid-cols-4 gap-1.5">
            {([
              { id: 'preset', label: 'Preset' },
              { id: 'solid', label: 'Solid' },
              { id: 'image', label: 'Image' },
              { id: 'transparent', label: 'None' },
            ] as const).map((mode) => {
              const current = doc.customBackground?.type ?? 'preset'
              return (
                <button
                  key={mode.id}
                  type="button"
                  onClick={() => {
                    if (mode.id === 'preset') return onPatchDoc({ customBackground: null })
                    if (mode.id === 'solid') return onPatchDoc({ customBackground: { type: 'solid', color: '#0B0B10' } })
                    if (mode.id === 'transparent') return onPatchDoc({ customBackground: { type: 'transparent' } })
                    bgFileRef.current?.click()
                  }}
                  className={cx(
                    'rounded-lg border px-2 py-1.5 text-xs transition-colors duration-150',
                    current === mode.id
                      ? 'border-accent bg-accent text-accent-ink'
                      : 'border-line bg-panel-alt text-muted hover:text-text',
                  )}
                >
                  {mode.label}
                </button>
              )
            })}
          </div>
          <input
            ref={bgFileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (!file) return
              const reader = new FileReader()
              reader.onload = () =>
                onPatchDoc({ customBackground: { type: 'image', dataUrl: String(reader.result), fit: 'cover' } })
              reader.readAsDataURL(file)
              e.target.value = ''
            }}
          />
          {doc.customBackground?.type === 'solid' && (
            <input
              type="color"
              aria-label="Background colour"
              value={doc.customBackground.color}
              onChange={(e) => onPatchDoc({ customBackground: { type: 'solid', color: e.target.value } })}
              className="mt-2 h-8 w-full cursor-pointer rounded-lg border border-line bg-panel-alt"
            />
          )}
          {doc.customBackground?.type === 'image' && (
            <div className="mt-2 grid grid-cols-2 gap-1.5">
              {(['cover', 'contain'] as const).map((fit) => (
                <button
                  key={fit}
                  type="button"
                  onClick={() => {
                    const bg = doc.customBackground
                    if (bg?.type === 'image') onPatchDoc({ customBackground: { ...bg, fit } })
                  }}
                  className={cx(
                    'rounded-lg border px-2 py-1.5 text-xs capitalize',
                    (doc.customBackground as Extract<StudioCustomBackground, { type: 'image' }>).fit === fit
                      ? 'border-accent bg-accent text-accent-ink'
                      : 'border-line bg-panel-alt text-muted hover:text-text',
                  )}
                >
                  {fit}
                </button>
              ))}
            </div>
          )}
          {doc.customBackground?.type === 'transparent' && (
            <p className="mt-2 text-xs text-muted">
              Nothing is painted behind the clips. Exported video has no alpha channel, so this reads as black in the
              file.
            </p>
          )}
        </Field>

        <Field label="Background" hint="Painted under every clip — also exported.">
          <div className="grid grid-cols-2 gap-1.5">
            {STUDIO_BACKGROUNDS.map((bg) => (
              <button
                key={bg.id}
                type="button"
                onClick={() => onPatchDoc({ backgroundId: bg.id })}
                className={cx(
                  'h-12 overflow-hidden rounded-lg border text-left',
                  doc.backgroundId === bg.id ? 'border-accent' : 'border-line',
                )}
                style={{ backgroundImage: 'none' }}
                title={bg.name}
              >
                <span
                  className="flex h-full w-full items-end px-2 pb-1 text-xs font-medium text-stage-text [text-shadow:0_1px_2px_rgb(0_0_0/0.8)]"
                  // Preview uses the same CSS the Library copies out.
                  ref={(node) => {
                    if (node) node.setAttribute('style', `${bg.css};display:flex;height:100%;width:100%`)
                  }}
                >
                  {bg.name}
                </span>
              </button>
            ))}
          </div>
        </Field>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="truncate text-base font-semibold text-text">{clip.name}</h2>
          <p className="font-mono text-xs text-muted tabular-nums">
            {clip.startSec.toFixed(2)}s → {(clip.startSec + clip.durationSec).toFixed(2)}s · track {clip.track + 1}
          </p>
        </div>
      </div>

      <div className="flex gap-1.5">
        <Button size="sm" variant="outline" onClick={onSplit}>
          <Scissors size={13} /> Split
        </Button>
        <Button size="sm" variant="outline" onClick={onDuplicate}>
          <Copy size={13} /> Duplicate
        </Button>
        <Button size="sm" variant="danger" onClick={onDelete}>
          <Trash2 size={13} /> Delete
        </Button>
      </div>

      {/* What the clip IS comes first — its words, media or look — then timing,
          motion and finishing. The text box used to sit below the fold. */}
      {clip.kind === 'text' && <TextFields clip={clip as StudioTextClip} onPatch={onPatch} />}
      {clip.kind === 'text' && <RichTextFields clip={clip as StudioTextClip} onPatch={onPatch} />}
      {clip.kind === 'overlay' && (clip as StudioOverlayClip).component?.slug?.startsWith('fc-') && <FramecnFields clip={clip as StudioOverlayClip} onPatch={onPatch} />}
      {clip.kind === 'shape' && <ShapeFields clip={clip} onPatch={onPatch} />}
      {clip.kind === 'cursor' && <CursorFields clip={clip} doc={doc} onPatch={onPatch} />}
      {clip.kind === 'loader' && <LoaderFields clip={clip} onPatch={onPatch} />}
      {clip.kind === 'kit' && <KitFields clip={clip} doc={doc} onPatch={onPatch} />}
      {(clip.kind === 'video' || clip.kind === 'image') && (
        <MediaFields clip={clip as StudioMediaClip} onPatch={onPatch} />
      )}
      {clip.kind === 'background' && <BackgroundFields clip={clip as StudioBackgroundClip} onPatch={onPatch} />}
      {clip.kind === 'overlay' && <OverlayFields clip={clip as StudioOverlayClip} onPatch={onPatch} doc={doc} onPatchDoc={onPatchDoc} />}
      {clip.kind === 'glass' && <GlassFields clip={clip as StudioGlassClip} onPatch={onPatch} />}
      {clip.kind === 'audio' && <AudioFields clip={clip as StudioAudioClip} onPatch={onPatch} />}
      {clip.kind === 'sticker' && <StickerFields clip={clip as StudioStickerClip} onPatch={onPatch} />}

      <ClipProFields doc={doc} clip={clip} onPatch={onPatch} onPatchDoc={onPatchDoc} />

      <MotionPresetFields clip={clip} onPatch={onPatch} />

      <div className="grid grid-cols-2 gap-3">
        <Field label="Start (s)">
          <input
            type="number"
            min={0}
            step={0.1}
            value={Number(clip.startSec.toFixed(2))}
            onChange={(e) => onPatch({ startSec: Math.max(0, Number(e.target.value) || 0) })}
            className={cx(inputCx, 'font-mono tabular-nums')}
          />
        </Field>
        <Field label="Duration (s)">
          <input
            type="number"
            min={0.2}
            step={0.1}
            value={Number(clip.durationSec.toFixed(2))}
            onChange={(e) => onPatch({ durationSec: Math.max(0.2, Number(e.target.value) || 0.2) })}
            className={cx(inputCx, 'font-mono tabular-nums')}
          />
        </Field>
      </div>

      <Slider label="Opacity" value={clip.opacity} min={0} max={1} step={0.05} onChange={(v) => onPatch({ opacity: v })} />
      <Slider
        label="Rotation"
        value={clip.rotation ?? 0}
        min={-180}
        max={180}
        step={1}
        suffix="°"
        onChange={(v) => onPatch({ rotation: v === 0 ? undefined : v })}
      />
      {clip.kind !== 'audio' && <ThreeDFields clip={clip} onPatch={onPatch} />}

      <KeyframeFields clip={clip} time={time} onPatch={onPatch} />
      <GradeFields clip={clip} onPatch={onPatch} />
      <MaskFields clip={clip} onPatch={onPatch} aspect={doc.aspect} />

      <div className="grid grid-cols-2 gap-3">
        <Field label="Transition in">
          <select
            value={clip.transitionIn}
            onChange={(e) => onPatch({ transitionIn: e.target.value as StudioClip['transitionIn'] })}
            className={inputCx}
          >
            {TRANSITIONS.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Transition out">
          <select
            value={clip.transitionOut}
            onChange={(e) => onPatch({ transitionOut: e.target.value as StudioClip['transitionOut'] })}
            className={inputCx}
          >
            {/* Glass transitions are entrances only — they have no reverse. */}
            {TRANSITIONS.filter((t) => t.family !== 'glass').map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <p className="-mt-1 text-xs leading-relaxed text-muted/70">{transitionInfo(clip.transitionIn).description}</p>

    </div>
  )
}



/**
 * Keyframes, recorded at the playhead.
 *
 * No curve editor: pressing Record captures where the clip *is* right now, so
 * the workflow is "move it, record, move the playhead, move it, record" —
 * which is how people actually animate, and it needs no new mental model.
 */
function KeyframeFields({
  clip,
  time,
  onPatch,
}: {
  clip: StudioClip
  time: number
  onPatch: (p: Partial<StudioClip>) => void
}) {
  const keys = clip.keyframes ?? []
  const local = Math.round((time - clip.startSec) * 100) / 100
  const withinClip = local >= 0 && local <= clip.durationSec + 0.001
  const positioned = clip.kind === 'kit' || clip.kind === 'loader' || clip.kind === 'shape' || clip.kind === 'cursor' || clip.kind === 'text' || clip.kind === 'overlay' || clip.kind === 'glass' || clip.kind === 'sticker' || clip.kind === 'video' || clip.kind === 'image'

  const currentScale =
    clip.kind === 'overlay' || clip.kind === 'sticker' ? 1 : clip.kind === 'text' ? 1 : clip.kind === 'glass' ? 1 : 1

  function record() {
    const next: StudioKeyframe = {
      at: Math.max(0, local),
      ease: 'ease-in-out',
      ...(positioned ? { x: (clip as { x: number }).x, y: (clip as { y: number }).y } : {}),
      rotation: clip.rotation ?? 0,
      opacity: 1,
      scale: currentScale,
    }
    // Recording twice at the same instant replaces, rather than stacking two
    // keyframes a hundredth of a second apart.
    const rest = keys.filter((k) => Math.abs(k.at - next.at) > 0.02)
    onPatch({ keyframes: [...rest, next].sort((a, b) => a.at - b.at) })
  }

  return (
    <Disclosure
      label="Keyframes"
      summary={keys.length ? `${keys.length} on this clip` : 'None'}
      active={keys.length > 0}
    >
      <div className="flex items-center gap-2">
        <Button size="sm" variant="outline" onClick={record} disabled={!withinClip} title={(!withinClip) ? 'Move the playhead inside this clip' : undefined}>
          <Plus size={13} /> Record at {Math.max(0, local).toFixed(2)}s
        </Button>
        {keys.length > 0 && (
          <Button size="sm" variant="ghost" onClick={() => onPatch({ keyframes: null })}>
            Clear
          </Button>
        )}
      </div>
      {!withinClip && <p className="text-xs text-muted/80">Move the playhead over this clip to record a keyframe.</p>}
      <KeyframeGraph clip={clip} localTime={local} onPatch={onPatch} />

      {keys.length === 1 && (
        <p className="text-xs text-muted/80">
          One keyframe just pins a value. Add a second somewhere else in the clip to get movement.
        </p>
      )}

      {keys.map((key, index) => (
        <div key={`${key.at}-${index}`} className="space-y-2 border-t border-line pt-2">
          <div className="flex items-center justify-between gap-2">
            <span className="font-mono text-xs text-text tabular-nums">{key.at.toFixed(2)}s</span>
            <div className="flex items-center gap-2">
              <select
                value={key.ease}
                onChange={(e) =>
                  onPatch({
                    keyframes: keys.map((k, i) => (i === index ? { ...k, ease: e.target.value as StudioKeyframe['ease'] } : k)),
                  })
                }
                className="cu-input px-1.5 py-1 text-xs text-text"
              >
                <option value="linear">Linear</option>
                <option value="ease-in">Ease in</option>
                <option value="ease-out">Ease out</option>
                <option value="ease-in-out">Ease in and out</option>
                <option value="expo-out">Expo out — snap, then glide</option>
                <option value="expo-in-out">Expo in and out</option>
                <option value="back-out">Back out — overshoot and settle</option>
                <option value="back-in">Back in — wind up, then leave</option>
                <option value="elastic-out">Elastic — spring</option>
                <option value="hold">Hold — step to next key</option>
                <option value="bezier">Custom curve…</option>
              </select>
              <button
                type="button"
                className="text-xs text-muted underline underline-offset-2"
                onClick={() => onPatch({ keyframes: keys.filter((_, i) => i !== index) })}
              >
                Remove
              </button>
            </div>
          </div>
          {key.ease === 'bezier' && index < keys.length - 1 && (
            <CurveEditor
              value={key.bezier ?? [0.45, 0, 0.55, 1]}
              onChange={(bezier) => onPatch({ keyframes: keys.map((k, i) => (i === index ? { ...k, bezier } : k)) })}
            />
          )}
          <div className="grid grid-cols-2 gap-2">
            <Slider label="Opacity" value={key.opacity ?? 1} min={0} max={1} step={0.05} onChange={(v) => onPatch({ keyframes: keys.map((k, i) => (i === index ? { ...k, opacity: v } : k)) })} />
            <Slider label="Size" value={key.scale ?? 1} min={0.1} max={3} step={0.05} suffix="×" onChange={(v) => onPatch({ keyframes: keys.map((k, i) => (i === index ? { ...k, scale: v } : k)) })} />
            <Slider label="Rotation" value={key.rotation ?? 0} min={-180} max={180} step={1} suffix="°" onChange={(v) => onPatch({ keyframes: keys.map((k, i) => (i === index ? { ...k, rotation: v } : k)) })} />
            <Slider label="Tilt X" value={key.tiltX ?? 0} min={-80} max={80} step={1} suffix="°" onChange={(v) => onPatch({ keyframes: keys.map((k, i) => (i === index ? { ...k, tiltX: v } : k)) })} />
            <Slider label="Turn Y" value={key.turnY ?? 0} min={-80} max={80} step={1} suffix="°" onChange={(v) => onPatch({ keyframes: keys.map((k, i) => (i === index ? { ...k, turnY: v } : k)) })} />
            {positioned && (
              <Slider label="X" value={key.x ?? 0.5} min={0} max={1} step={0.01} onChange={(v) => onPatch({ keyframes: keys.map((k, i) => (i === index ? { ...k, x: v } : k)) })} />
            )}
            {positioned && (
              <Slider label="Y" value={key.y ?? 0.5} min={0} max={1} step={0.01} onChange={(v) => onPatch({ keyframes: keys.map((k, i) => (i === index ? { ...k, y: v } : k)) })} />
            )}
          </div>
        </div>
      ))}
    </Disclosure>
  )
}

const DEFAULT_GRADE: StudioGradeNode[] = [
  { id: 'balance', enabled: true, exposure: 0, temperature: 0 },
  { id: 'contrast', enabled: true, contrast: 0, fade: 0 },
  { id: 'look', enabled: true, saturation: 0, hue: 0 },
]

/** Looks worth having as one click. Each is just a preset grade chain. */
const GRADE_PRESETS: { id: string; name: string; nodes: StudioGradeNode[] }[] = [
  { id: 'none', name: 'None', nodes: DEFAULT_GRADE },
  {
    id: 'warm-film',
    name: 'Warm film',
    nodes: [
      { id: 'balance', enabled: true, exposure: 4, temperature: 32 },
      { id: 'contrast', enabled: true, contrast: 12, fade: 14 },
      { id: 'look', enabled: true, saturation: -8, hue: 0 },
    ],
  },
  {
    id: 'clean-punch',
    name: 'Clean punch',
    nodes: [
      { id: 'balance', enabled: true, exposure: 6, temperature: 0 },
      { id: 'contrast', enabled: true, contrast: 22, fade: 0 },
      { id: 'look', enabled: true, saturation: 14, hue: 0 },
    ],
  },
  {
    id: 'night',
    name: 'Night',
    nodes: [
      { id: 'balance', enabled: true, exposure: -10, temperature: -38 },
      { id: 'contrast', enabled: true, contrast: 16, fade: 8 },
      { id: 'look', enabled: true, saturation: -18, hue: 0 },
    ],
  },
  {
    id: 'mono',
    name: 'Mono',
    nodes: [
      { id: 'balance', enabled: true, exposure: 2, temperature: 0 },
      { id: 'contrast', enabled: true, contrast: 18, fade: 6 },
      { id: 'look', enabled: true, saturation: -100, hue: 0 },
    ],
  },
]

function gradeIsActive(nodes: StudioGradeNode[] | null | undefined) {
  return Boolean(nodes?.some((n) => n.enabled && Object.entries(n).some(([k, v]) => k !== 'id' && k !== 'enabled' && v !== 0)))
}

/**
 * Three nodes, in the order a colourist works: balance, contrast, look.
 *
 * Deliberately not a node graph with wires — the chain is fixed, so there is
 * nothing to connect and nothing to get wrong. Any node can be bypassed.
 */
function GradeFields({ clip, onPatch }: { clip: StudioClip; onPatch: (p: Partial<StudioClip>) => void }) {
  const nodes = clip.grade ?? DEFAULT_GRADE
  const set = (id: StudioGradeNode['id'], patch: Record<string, number | boolean>) =>
    onPatch({ grade: nodes.map((n) => (n.id === id ? ({ ...n, ...patch } as StudioGradeNode) : n)) })
  const balance = nodes.find((n) => n.id === 'balance') as Extract<StudioGradeNode, { id: 'balance' }> | undefined
  const contrast = nodes.find((n) => n.id === 'contrast') as Extract<StudioGradeNode, { id: 'contrast' }> | undefined
  const look = nodes.find((n) => n.id === 'look') as Extract<StudioGradeNode, { id: 'look' }> | undefined
  const active = gradeIsActive(clip.grade)

  return (
    <Disclosure label="Colour grade" summary={active ? 'On' : 'Off'} active={active}>
      <Field label="Look">
        <select
          value=""
          onChange={(e) => {
            const preset = GRADE_PRESETS.find((p) => p.id === e.target.value)
            if (preset) onPatch({ grade: preset.id === 'none' ? null : preset.nodes.map((n) => ({ ...n })) })
          }}
          className={inputCx}
        >
          <option value="">Choose a look…</option>
          {GRADE_PRESETS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </Field>

      {balance && (
        <div className="space-y-2 border-t border-line pt-2">
          <NodeHeader label="1 · Balance" enabled={balance.enabled} onToggle={(v) => set('balance', { enabled: v })} />
          <Slider label="Exposure" value={balance.exposure} min={-100} max={100} step={1} onChange={(v) => set('balance', { exposure: v })} />
          <Slider label="Temperature" value={balance.temperature} min={-100} max={100} step={1} onChange={(v) => set('balance', { temperature: v })} />
        </div>
      )}
      {contrast && (
        <div className="space-y-2 border-t border-line pt-2">
          <NodeHeader label="2 · Contrast" enabled={contrast.enabled} onToggle={(v) => set('contrast', { enabled: v })} />
          <Slider label="Contrast" value={contrast.contrast} min={-100} max={100} step={1} onChange={(v) => set('contrast', { contrast: v })} />
          <Slider label="Fade" value={contrast.fade} min={0} max={100} step={1} onChange={(v) => set('contrast', { fade: v })} />
        </div>
      )}
      {look && (
        <div className="space-y-2 border-t border-line pt-2">
          <NodeHeader label="3 · Look" enabled={look.enabled} onToggle={(v) => set('look', { enabled: v })} />
          <Slider label="Saturation" value={look.saturation} min={-100} max={100} step={1} onChange={(v) => set('look', { saturation: v })} />
          <Slider label="Hue" value={look.hue} min={-100} max={100} step={1} onChange={(v) => set('look', { hue: v })} />
        </div>
      )}
      {active && (
        <Button size="sm" variant="outline" onClick={() => onPatch({ grade: null })}>
          Reset grade
        </Button>
      )}
    </Disclosure>
  )
}

function NodeHeader({ label, enabled, onToggle }: { label: string; enabled: boolean; onToggle: (v: boolean) => void }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-xs font-medium text-text">{label}</span>
      <label className="flex items-center gap-1.5 text-xs text-muted">
        <input type="checkbox" checked={enabled} onChange={(e) => onToggle(e.target.checked)} />
        On
      </label>
    </div>
  )
}

const DEFAULT_MASK: StudioMask = {
  shape: 'ellipse',
  x: 0.15,
  y: 0.15,
  w: 0.7,
  h: 0.7,
  featherPct: 4,
  invert: false,
  threshold: 0.5,
  softness: 0.25,
}

function MaskFields({ clip, onPatch, aspect }: { clip: StudioClip; onPatch: (p: Partial<StudioClip>) => void; aspect: StudioDoc['aspect'] }) {
  const mask = clip.mask ?? null
  // Moving the box by hand after tracking would fight the path: editing the
  // geometry drops the track (the status line says so) so the user re-tracks.
  const set = (patch: Partial<StudioMask>) => onPatch({ mask: { ...(mask ?? DEFAULT_MASK), ...patch, ...(('x' in patch || 'y' in patch || 'w' in patch || 'h' in patch) && mask?.track ? { track: null } : {}) } })
  const [tracking, setTracking] = useState<number | null>(null)
  const [trackMsg, setTrackMsg] = useState<string | null>(null)
  const canTrack = clip.kind === 'video' && mask && (mask.shape === 'rect' || mask.shape === 'ellipse')
  const runTrack = async () => {
    if (!mask || clip.kind !== 'video') return
    setTracking(0)
    setTrackMsg(null)
    try {
      const [fw, fh] = sizeForAspect(aspect)
      const { frames, srcW, srcH } = await sampleLumaFrames(clip, 12, 192, (p) => setTracking(p))
      const map = sourceFrameMap(clip, srcW, srcH, fw, fh)
      const start = map.toSource({ x: mask.x, y: mask.y, w: mask.w, h: mask.h })
      const points = trackBox(frames, start)
      onPatch({ mask: applyTrack(mask, points, map, clip.trimInSec, clip.speed) })
      setTrackMsg(trackSummary(points))
    } catch (err) {
      setTrackMsg(err instanceof Error ? err.message : 'Tracking failed.')
    } finally {
      setTracking(null)
    }
  }

  return (
    <Disclosure label="Mask" summary={mask ? mask.shape : 'Off'} active={Boolean(mask)}>
      <Field label="Shape">
        <select
          value={mask?.shape ?? 'off'}
          onChange={(e) => (e.target.value === 'off' ? onPatch({ mask: null }) : set({ shape: e.target.value as StudioMask['shape'] }))}
          className={inputCx}
        >
          <option value="off">Off</option>
          <option value="rect">Rectangle</option>
          <option value="ellipse">Ellipse</option>
          <option value="luma">Luma key</option>
          <option value="matte">Imported matte</option>
        </select>
      </Field>

      {mask && (mask.shape === 'rect' || mask.shape === 'ellipse') && (
        <div className="space-y-1.5 rounded-lg border border-line bg-panel-alt p-2">
          <p className="text-[11px] font-medium text-text">Object tracking</p>
          {clip.kind !== 'video' ? (
            <p className="text-[11px] text-muted">Tracking follows a subject through moving footage — it needs a video clip.</p>
          ) : (
            <>
              <p className="text-[11px] text-muted">Put the box around the subject at the clip's first frame, then track. The mask follows it through the clip.</p>
              <div className="flex flex-wrap items-center gap-1.5">
                <Button size="sm" variant="outline" disabled={!canTrack || tracking !== null} title={(!canTrack || tracking !== null) ? 'Tracking needs a video clip — or wait for the current track' : undefined} onClick={runTrack}>
                  {tracking !== null ? `Tracking… ${tracking}%` : mask.track?.length ? 'Track again' : 'Track subject'}
                </Button>
                {mask.track?.length ? <Button size="sm" variant="ghost" onClick={() => { onPatch({ mask: { ...mask, track: null } }); setTrackMsg('Tracking removed — the mask is static again.') }}>Clear tracking</Button> : null}
              </div>
              {mask.track?.length ? <p className="text-[11px] text-accent">Following a {mask.track.length}-point path. Moving the box by hand clears it.</p> : null}
              {trackMsg && <p className="text-[11px] text-muted">{trackMsg}</p>}
            </>
          )}
        </div>
      )}
      {mask && (mask.shape === 'rect' || mask.shape === 'ellipse') && (
        <div className="grid grid-cols-2 gap-2">
          <Slider label="X" value={mask.x} min={-0.5} max={1} step={0.01} onChange={(v) => set({ x: v })} />
          <Slider label="Y" value={mask.y} min={-0.5} max={1} step={0.01} onChange={(v) => set({ y: v })} />
          <Slider label="Width" value={mask.w} min={0.02} max={1.5} step={0.01} onChange={(v) => set({ w: v })} />
          <Slider label="Height" value={mask.h} min={0.02} max={1.5} step={0.01} onChange={(v) => set({ h: v })} />
        </div>
      )}

      {mask && mask.shape === 'luma' && (
        <>
          <Slider label="Threshold" value={mask.threshold} min={0} max={1} step={0.01} onChange={(v) => set({ threshold: v })} />
          <Slider label="Softness" value={mask.softness} min={0.01} max={1} step={0.01} onChange={(v) => set({ softness: v })} />
        </>
      )}

      {mask && mask.shape === 'matte' && (
        <Field label="Matte image" hint="A greyscale or alpha PNG the size of the frame. White keeps, black cuts.">
          <input
            type="file"
            accept="image/png,image/webp"
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (!file) return
              const reader = new FileReader()
              reader.onload = () => set({ matteDataUrl: String(reader.result) })
              reader.readAsDataURL(file)
            }}
            className="w-full text-xs text-muted"
          />
        </Field>
      )}

      {mask && (
        <>
          <Slider label="Feather" value={mask.featherPct} min={0} max={25} step={0.5} suffix="%" onChange={(v) => set({ featherPct: v })} />
          <label className="flex items-center gap-2 text-xs text-muted">
            <input type="checkbox" checked={mask.invert} onChange={(e) => set({ invert: e.target.checked })} />
            Invert — keep what the mask would have cut
          </label>
        </>
      )}
    </Disclosure>
  )
}

function StickerFields({ clip, onPatch }: { clip: StudioStickerClip; onPatch: (p: Partial<StudioClip>) => void }) {
  return (
    <div className="space-y-3 border-t border-line pt-4">
      <Field label="Sticker">
        <select
          value={clip.stickerId}
          onChange={(e) => onPatch({ stickerId: e.target.value, json: null } as Partial<StudioClip>)}
          className={inputCx}
        >
          {STICKERS.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
          {clip.stickerId === 'custom' && <option value="custom">Imported file</option>}
        </select>
      </Field>

      <Field label="Import a Lottie" hint="A .json exported from After Effects (Bodymovin) or LottieFiles. Images and expressions are not supported.">
        <input
          type="file"
          accept="application/json,.json"
          onChange={(e) => {
            const file = e.target.files?.[0]
            if (!file) return
            const reader = new FileReader()
            reader.onload = () =>
              onPatch({ stickerId: 'custom', json: String(reader.result), name: file.name.replace(/\.json$/i, '') } as Partial<StudioClip>)
            reader.readAsText(file)
          }}
          className="w-full text-xs text-muted"
        />
      </Field>

      <div className="grid grid-cols-2 gap-2">
        <Slider label="X" value={clip.x} min={0} max={1} step={0.01} onChange={(v) => onPatch({ x: v } as Partial<StudioClip>)} />
        <Slider label="Y" value={clip.y} min={0} max={1} step={0.01} onChange={(v) => onPatch({ y: v } as Partial<StudioClip>)} />
      </div>
      <Slider label="Size" value={clip.scale} min={0.2} max={4} step={0.05} onChange={(v) => onPatch({ scale: v } as Partial<StudioClip>)} />
      <Slider label="Speed" value={clip.speed} min={0.25} max={3} step={0.05} suffix="×" onChange={(v) => onPatch({ speed: v } as Partial<StudioClip>)} />
      <label className="flex items-center gap-2 text-xs text-muted">
        <input type="checkbox" checked={clip.loop} onChange={(e) => onPatch({ loop: e.target.checked } as Partial<StudioClip>)} />
        Loop — otherwise it holds its last frame
      </label>
    </div>
  )
}

function TextFields({ clip, onPatch }: { clip: StudioTextClip; onPatch: (p: Partial<StudioClip>) => void }) {
  const userFonts = useUserFonts()
  const textRef = useRef<HTMLTextAreaElement>(null)
  // A freshly added text clip is ready to type into straight away.
  useEffect(() => {
    if (clip.text === 'Your headline' && textRef.current) {
      textRef.current.focus()
      textRef.current.select()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clip.id])
  return (
    <div className="space-y-4">
      <Field label="Text" hint="Type here and the canvas updates as you write.">
        <textarea
          ref={textRef}
          value={clip.text}
          rows={3}
          placeholder="Write your headline, caption or call to action"
          onChange={(e) => onPatch({ text: e.target.value, name: e.target.value.slice(0, 24) || 'Text' } as Partial<StudioClip>)}
          className={cx(inputCx, 'resize-y')}
        />
      </Field>

      <Field label="Font" hint={fontInfo(clip.fontFamily ?? 'Inter Variable') ? `${fontInfo(clip.fontFamily ?? 'Inter Variable')!.bestFor}. Tip: ${fontInfo(clip.fontFamily ?? 'Inter Variable')!.customize}` : 'Downloaded from Resources → Fonts; embedded in exports.'}>
        <select
          value={clip.fontFamily ?? 'Inter Variable'}
          onChange={(e) => onPatch({ fontFamily: e.target.value } as Partial<StudioClip>)}
          className={inputCx}
        >
          {(['caption', 'headline', 'display', 'emphasis', 'body', 'mono'] as const).map((role) => (
            <optgroup key={role} label={{ caption: 'Captions', headline: 'Headlines', display: 'Impact / display', emphasis: 'Serif & emphasis', body: 'Body & lower thirds', mono: 'Numbers & code' }[role]}>
              {VIDEO_FONTS.filter((f) => f.role === role).map((f) => <option key={f.family} value={f.family}>{f.label} — {f.bestFor.split(',')[0]}</option>)}
            </optgroup>
          ))}
          {userFonts.length > 0 && (
            <optgroup label="Your fonts">
              {userFonts.map((f) => <option key={f} value={f}>{f}</option>)}
            </optgroup>
          )}
          {clip.fontFamily && !BUNDLED_FONT_VALUES.has(clip.fontFamily) && !userFonts.includes(clip.fontFamily) && (
            <option value={clip.fontFamily}>{clip.fontFamily} — from Resources</option>
          )}
        </select>
      </Field>
      <FontStudio clip={clip} onPatch={onPatch} />

      <div className="grid grid-cols-2 gap-3">
        <Field label="Animation">
          <select
            value={clip.anim}
            onChange={(e) => onPatch({ anim: e.target.value as StudioTextClip['anim'] } as Partial<StudioClip>)}
            className={inputCx}
          >
            {TEXT_ANIMATIONS.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Caption style">
          <select
            value={clip.captionStyle ?? ''}
            onChange={(e) =>
              onPatch({ captionStyle: (e.target.value || null) as StudioTextClip['captionStyle'] } as Partial<StudioClip>)
            }
            className={inputCx}
          >
            <option value="">Plain</option>
            <option value="hormozi">Hormozi</option>
            <option value="standard">Standard</option>
            <option value="minimal">Minimal</option>
          </select>
        </Field>
      </div>

      <Slider
        label="Size"
        value={clip.fontSizePct}
        min={2}
        max={22}
        step={0.5}
        suffix="%"
        onChange={(v) => onPatch({ fontSizePct: v } as Partial<StudioClip>)}
      />

      <div className="grid grid-cols-2 gap-3">
        <Slider label="X" value={clip.x} min={0} max={1} step={0.01} onChange={(v) => onPatch({ x: v } as Partial<StudioClip>)} />
        <Slider label="Y" value={clip.y} min={0} max={1} step={0.01} onChange={(v) => onPatch({ y: v } as Partial<StudioClip>)} />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Colour">
          <input
            type="color"
            value={clip.color}
            onChange={(e) => onPatch({ color: e.target.value } as Partial<StudioClip>)}
            className="h-9 w-full cursor-pointer rounded-lg border border-line bg-panel-alt"
          />
        </Field>
        <Field label="Weight">
          <select
            value={clip.weight}
            onChange={(e) => onPatch({ weight: Number(e.target.value) as StudioTextClip['weight'] } as Partial<StudioClip>)}
            className={inputCx}
          >
            <option value={400}>Regular</option>
            <option value={600}>Semibold</option>
            <option value={800}>Black</option>
          </select>
        </Field>
      </div>

      <Field label="Highlight word" hint="Painted lime, Hormozi-style. Leave empty for none.">
        <input
          value={clip.highlightWord ?? ''}
          onChange={(e) => onPatch({ highlightWord: e.target.value || null } as Partial<StudioClip>)}
          placeholder="e.g. free"
          className={inputCx}
        />
      </Field>

      <Field label="Text legibility" hint="Auto adds a soft backing only when the picture behind the text is too dark, too light or too busy to read.">
        <select
          value={clip.legibility ?? 'auto'}
          onChange={(e) => onPatch({ legibility: e.target.value as StudioTextClip['legibility'] } as Partial<StudioClip>)}
          className={inputCx}
          aria-label="Text legibility"
        >
          <option value="auto">Auto</option>
          <option value="on">Always back the text</option>
          <option value="off">Off</option>
        </select>
      </Field>
      {(clip.legibility ?? 'auto') !== 'off' && (
        <Slider label="Backing strength" value={clip.scrimStrength ?? 0.55} min={0} max={1} step={0.05} onChange={(v) => onPatch({ scrimStrength: v } as Partial<StudioClip>)} />
      )}

      <Field label="Align">
        <div className="grid grid-cols-3 gap-1.5">
          {(['left', 'center', 'right'] as const).map((align) => (
            <button
              key={align}
              type="button"
              onClick={() => onPatch({ align } as Partial<StudioClip>)}
              className={cx(
                'rounded-lg border px-2 py-1.5 text-xs capitalize transition-colors duration-150',
                clip.align === align
                  ? 'border-accent bg-accent text-accent-ink'
                  : 'border-line bg-panel-alt text-muted hover:text-text',
              )}
            >
              {align}
            </button>
          ))}
        </div>
      </Field>
    </div>
  )
}

function MediaFields({ clip, onPatch }: { clip: StudioMediaClip; onPatch: (p: Partial<StudioClip>) => void }) {
  const relinkRef = useRef<HTMLInputElement>(null)
  // Object URLs die with the session, so a reloaded project needs the file back.
  const linked = hasMedia(clip.mediaId)

  async function relink(file: File | undefined) {
    if (!file) return
    const handle = await registerFile(file, clip.mediaId || undefined)
    onPatch({
      // An empty slot gets its first media id; a video fills an image slot as video.
      ...(!clip.mediaId ? { mediaId: handle.id, ...(handle.kind === 'video' || handle.kind === 'image' ? { kind: handle.kind } : {}) } : {}),
      fileName: handle.fileName,
      localPath: handle.localPath,
      sourceDurationSec: handle.kind === 'video' ? handle.durationSec : 0,
      posterDataUrl: handle.posterDataUrl,
    } as Partial<StudioClip>)
  }

  return (
    <div className="space-y-4 border-t border-line pt-4">
      {clip.mediaId ? (
        <p className="truncate font-mono text-xs text-muted" title={clip.localPath ?? clip.fileName}>
          {clip.fileName}
        </p>
      ) : (
        <div className="space-y-2 rounded-lg border border-accent/40 bg-accent/5 p-2.5">
          <p className="text-xs leading-relaxed text-muted">Empty media slot — {clip.fileName.toLowerCase()}. Everything else on this layer (frame, fold, position, scale, motion) is already editable.</p>
          <Button size="sm" variant="outline" onClick={() => relinkRef.current?.click()}>
            <Link2 size={13} /> Add media
          </Button>
        </div>
      )}

      {!linked && !!clip.mediaId && (
        <div className="space-y-2 rounded-lg border border-danger/40 bg-danger/5 p-2.5">
          <p className="text-xs leading-relaxed text-muted">
            This clip lost its file handle — browsers cannot keep one across reloads. Pick{' '}
            <span className="font-mono">{clip.fileName}</span> again to restore the picture and sound.
          </p>
          <Button size="sm" variant="outline" onClick={() => relinkRef.current?.click()}>
            <Link2 size={13} /> Relink file
          </Button>
        </div>
      )}
      <input ref={relinkRef} type="file" accept="video/*,image/*,.heic,.heif" className="hidden" onChange={(e) => void relink(e.target.files?.[0])} />

      {clip.kind === 'video' && (
        <>
          <Slider
            label="Trim in (s)"
            value={clip.trimInSec}
            min={0}
            max={Math.max(0.1, clip.sourceDurationSec - 0.1)}
            step={0.1}
            onChange={(v) => onPatch({ trimInSec: v } as Partial<StudioClip>)}
          />
          <Slider label="Speed" value={clip.speed} min={0.25} max={3} step={0.05} suffix="×" onChange={(v) => onPatch({ speed: v } as Partial<StudioClip>)} />
          <Slider label="Volume" value={clip.volume} min={0} max={1} step={0.05} onChange={(v) => onPatch({ volume: v } as Partial<StudioClip>)} />
        </>
      )}

      <div className="grid grid-cols-2 gap-3">
        <Slider label="Horizontal" value={clip.x ?? 0.5} min={0} max={1} step={0.01} onChange={(v) => onPatch({ x: v } as Partial<StudioClip>)} />
        <Slider label="Vertical" value={clip.y ?? 0.5} min={0} max={1} step={0.01} onChange={(v) => onPatch({ y: v } as Partial<StudioClip>)} />
      </div>
      <Slider label="Scale" value={clip.scale ?? 1} min={0.05} max={4} step={0.05} suffix="×" onChange={(v) => onPatch({ scale: v } as Partial<StudioClip>)} />

      <Field label="Fit">
        <div className="grid grid-cols-2 gap-1.5">
          {(['cover', 'contain'] as const).map((fit) => (
            <button
              key={fit}
              type="button"
              onClick={() => onPatch({ fit } as Partial<StudioClip>)}
              className={cx(
                'rounded-lg border px-2 py-1.5 text-xs capitalize transition-colors duration-150',
                clip.fit === fit
                  ? 'border-accent bg-accent text-accent-ink'
                  : 'border-line bg-panel-alt text-muted hover:text-text',
              )}
            >
              {fit}
            </button>
          ))}
        </div>
      </Field>
    </div>
  )
}

function AudioFields({ clip, onPatch }: { clip: StudioAudioClip; onPatch: (p: Partial<StudioClip>) => void }) {
  const linked = hasMedia(clip.mediaId)
  // Fades cannot overlap, or the clip would never reach full level; the caps
  // keep each one inside its own half of the clip.
  const maxFade = Math.max(0.1, clip.durationSec / 2)
  return (
    <div className="space-y-3 border-t border-line pt-4">
      <div className="flex items-center justify-between gap-2">
        <span className="truncate font-mono text-xs text-muted">{clip.fileName}</span>
        {!linked && <span className="shrink-0 text-xs text-danger">Needs relink</span>}
      </div>
      {!linked && (
        <p className="text-xs leading-relaxed text-muted">
          Audio handles cannot survive a reload — re-import this track to hear it again.
        </p>
      )}
      <Slider
        label="Trim in (s)"
        value={clip.trimInSec}
        min={0}
        max={Math.max(0.1, clip.sourceDurationSec - 0.1)}
        step={0.1}
        onChange={(v) => onPatch({ trimInSec: v } as Partial<StudioClip>)}
      />
      <Slider label="Volume" value={clip.volume} min={0} max={1} step={0.05} onChange={(v) => onPatch({ volume: v } as Partial<StudioClip>)} />
      <Slider
        label="Fade in (s)"
        value={Math.min(clip.fadeInSec, maxFade)}
        min={0}
        max={maxFade}
        step={0.1}
        onChange={(v) => onPatch({ fadeInSec: v } as Partial<StudioClip>)}
      />
      <Slider
        label="Fade out (s)"
        value={Math.min(clip.fadeOutSec, maxFade)}
        min={0}
        max={maxFade}
        step={0.1}
        onChange={(v) => onPatch({ fadeOutSec: v } as Partial<StudioClip>)}
      />
      <p className="text-xs leading-relaxed text-muted">
        Drag the clip's left edge on the timeline to slide into the track instead of cutting the song's start.
      </p>
    </div>
  )
}

function BackgroundFields({ clip, onPatch }: { clip: StudioBackgroundClip; onPatch: (p: Partial<StudioClip>) => void }) {
  return (
    <div className="space-y-3 border-t border-line pt-4">
      <Field label="Background">
        <select
          value={clip.backgroundId}
          onChange={(e) => onPatch({ backgroundId: e.target.value, name: e.target.value } as Partial<StudioClip>)}
          className={inputCx}
        >
          {STUDIO_BACKGROUNDS.map((bg) => (
            <option key={bg.id} value={bg.id}>
              {bg.name}
            </option>
          ))}
        </select>
      </Field>
    </div>
  )
}

function GlassFields({ clip, onPatch }: { clip: StudioGlassClip; onPatch: (p: Partial<StudioClip>) => void }) {
  const preset = GLASS_PRESETS.find((p) => p.id === clip.presetId) ?? GLASS_PRESETS[0]
  return (
    <div className="space-y-4 border-t border-line pt-4">
      <div className="grid grid-cols-2 gap-3">
        <Field label="Material">
          <select
            value={clip.presetId}
            onChange={(e) => onPatch({ presetId: e.target.value } as Partial<StudioClip>)}
            className={inputCx}
          >
            {GLASS_PRESETS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Shape">
          <select
            value={clip.shape}
            onChange={(e) => onPatch({ shape: e.target.value as StudioGlassClip['shape'] } as Partial<StudioClip>)}
            className={inputCx}
          >
            <option value="panel">Panel</option>
            <option value="lens">Lens</option>
          </select>
        </Field>
      </div>
      <p className="-mt-1 text-xs leading-relaxed text-muted/70">{preset.description}</p>

      <Field label="Motion">
        <select
          value={clip.motion}
          onChange={(e) => onPatch({ motion: e.target.value as StudioGlassClip['motion'] } as Partial<StudioClip>)}
          className={inputCx}
        >
          <option value="static">Static</option>
          <option value="sweep">Sweep across</option>
          <option value="drift">Drift</option>
          <option value="pop">Pop in</option>
        </select>
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Slider label="X" value={clip.x} min={0} max={1} step={0.01} onChange={(v) => onPatch({ x: v } as Partial<StudioClip>)} />
        <Slider label="Y" value={clip.y} min={0} max={1} step={0.01} onChange={(v) => onPatch({ y: v } as Partial<StudioClip>)} />
        <Slider label="Width" value={clip.w} min={0.05} max={1} step={0.01} onChange={(v) => onPatch({ w: v } as Partial<StudioClip>)} />
        <Slider label="Height" value={clip.h} min={0.05} max={1} step={0.01} onChange={(v) => onPatch({ h: v } as Partial<StudioClip>)} />
      </div>
      <Slider
        label="Corner radius"
        value={clip.radiusPct}
        min={0}
        max={50}
        step={1}
        suffix="%"
        onChange={(v) => onPatch({ radiusPct: v } as Partial<StudioClip>)}
      />

      <Field label="Label" hint="Optional text drawn on the glass.">
        <input
          value={clip.label}
          onChange={(e) => onPatch({ label: e.target.value } as Partial<StudioClip>)}
          className={inputCx}
          placeholder="e.g. Cupric AI"
        />
      </Field>
    </div>
  )
}

function OverlayFields({ clip, onPatch, doc, onPatchDoc }: { clip: StudioOverlayClip; onPatch: (p: Partial<StudioClip>) => void; doc: StudioDoc; onPatchDoc: (patch: Partial<StudioDoc>) => void }) {
  const meta = clip.component
  const entry = findComponent(meta?.slug)
  const busy = meta?.status === 'pending' || meta?.status === 'recording'
  const rerecord = (patch: Partial<NonNullable<StudioOverlayClip['component']>>) => {
    if (!meta) return
    // A clip still at its old recording length follows the new one; a clip the
    // user trimmed/extended keeps its length (the loop toggle covers longer).
    const follows = patch.recordSec !== undefined && Math.abs(clip.durationSec - meta.recordSec) < 0.01
    onPatch({ ...(follows ? { durationSec: patch.recordSec } : {}), component: { ...meta, ...patch, status: 'pending', error: undefined } } as Partial<StudioClip>)
  }
  /** Swap the recording for native layers you can type into (text, glass). */
  const rebuild = () => {
    if (!entry) return
    const without = { ...doc, clips: doc.clips.filter((c) => c.id !== clip.id) }
    const result = applyResource(without, { kind: 'block', id: entry.slug, name: entry.name, description: entry.description, data: { category: entry.category } }, { atSec: clip.startSec })
    if (result.ok && result.type === 'doc') onPatchDoc({ clips: result.doc.clips, trackCount: result.doc.trackCount })
  }
  return (
    <div className="space-y-4 border-t border-line pt-4">
      {meta && entry ? (
        <div className="space-y-3 rounded-lg border border-line bg-panel-alt p-3">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="text-xs font-semibold text-text">UI component · {entry.name}</p>
              <p className="mt-0.5 text-[11px] text-muted">
                {busy
                  ? 'Recording its real animation…'
                  : meta.status === 'failed'
                    ? `Not recorded: ${meta.error ?? 'unknown error'}`
                    : clip.frames?.length
                      ? `${clip.frames.length} frames of real motion · loops while the clip runs`
                      : 'A still — this component has no motion on its own. Turn on “Act it out” and record again.'}
              </p>
            </div>
            <span className={cx('shrink-0 rounded-full border px-1.5 text-[10px]', meta.status === 'failed' ? 'border-danger/50 text-danger' : busy ? 'border-info/50 text-info' : 'border-accent/50 text-accent-text')}>
              {busy ? 'recording' : meta.status}
            </span>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Record length">
              <input
                key={`${clip.id}:${meta.recordSec}`}
                type="number"
                min={0.5}
                max={MAX_RECORD_SEC}
                step={0.5}
                defaultValue={meta.recordSec}
                onBlur={(e) => {
                  const next = clampRecordSec(e.target.value, meta.recordSec)
                  if (next !== meta.recordSec) {
                    rememberRecordSec(next)
                    rerecord({ recordSec: next })
                  }
                  else e.target.value = String(meta.recordSec)
                }}
                onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
                className={inputCx}
                disabled={busy}
                aria-label="Record length in seconds"
                title={`Type any length from 0.5 to ${MAX_RECORD_SEC} seconds, then press Enter to record again`}
              />
            </Field>
            <Field label="Performance">
              <select value={meta.interact ? 'act' : 'watch'} onChange={(e) => rerecord({ interact: e.target.value === 'act' })} className={inputCx} disabled={busy} aria-label="Performance">
                <option value="act">Act it out</option>
                <option value="watch">Just watch</option>
              </select>
            </Field>
          </div>
          <label className="flex items-center gap-2 text-xs text-muted">
            <input type="checkbox" checked={clip.loop !== false} onChange={(e) => onPatch({ loop: e.target.checked } as Partial<StudioClip>)} />
            Loop the animation when the clip is longer
          </label>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={() => rerecord({})} disabled={busy} title={(busy) ? 'Recording…' : undefined}>
              <RefreshCw size={12} /> Record again
            </Button>
            <Button size="sm" variant="ghost" onClick={rebuild} disabled={busy} title="Replace the recording with native text and glass layers you can type into">
              <Type size={12} /> Rebuild as editable layers
            </Button>
          </div>
        </div>
      ) : (
        <p className="truncate text-xs text-muted">From {clip.source}</p>
      )}
      {clip.frames?.length ? (
        <Slider label="Motion speed" value={clip.playbackRate ?? 1} min={0.25} max={3} step={0.25} suffix="×" onChange={(v) => onPatch({ playbackRate: v } as Partial<StudioClip>)} />
      ) : null}
      <Slider label="Scale" value={clip.scale} min={0.1} max={2} step={0.05} suffix="×" onChange={(v) => onPatch({ scale: v } as Partial<StudioClip>)} />
      <div className="grid grid-cols-2 gap-3">
        <Slider label="X" value={clip.x} min={0} max={1} step={0.01} onChange={(v) => onPatch({ x: v } as Partial<StudioClip>)} />
        <Slider label="Y" value={clip.y} min={0} max={1} step={0.01} onChange={(v) => onPatch({ y: v } as Partial<StudioClip>)} />
      </div>
    </div>
  )
}

/**
 * Motion presets — the same choreography engine the agent uses, one click
 * away. Each choice rewrites the clip's keyframes with correct timing for
 * its length; the keyframes stay fully editable afterwards.
 */
function MotionPresetFields({ clip, onPatch }: { clip: StudioClip; onPatch: (p: Partial<StudioClip>) => void }) {
  const [spec, setSpec] = useState<MotionSpec>({ intensity: 1 })
  if (clip.kind === 'audio') return null
  const apply = (next: MotionSpec) => {
    setSpec(next)
    onPatch(motionPatch(clip, next))
  }
  const keyCount = clip.keyframes?.length ?? 0
  const media = clip.kind === 'video' || clip.kind === 'image'
  return (
    <Disclosure label="Motion" summary={keyCount ? `${keyCount} keys` : 'None'} active={keyCount > 0} defaultOpen>
      <div className="space-y-3">
        <div className="grid grid-cols-3 gap-1.5">
          {MOTION_PRESETS.filter((preset) => media || !preset.spec.camera).map((preset) => (
            <button
              key={preset.id}
              type="button"
              title={preset.hint}
              onClick={() => apply({ ...preset.spec })}
              className="cu-chip px-2 py-1.5 text-left text-xs leading-tight text-text"
            >
              <span className="block font-medium">{preset.label}</span>
              <span className="block truncate text-[10px] text-muted">{preset.hint}</span>
            </button>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Entrance">
            <select value={spec.entrance ?? 'none'} onChange={(e) => apply({ ...spec, entrance: e.target.value as MotionSpec['entrance'] })} className={inputCx}>
              <option value="none">None</option>
              {ENTRANCE_RECIPES.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
            </select>
          </Field>
          <Field label="Exit">
            <select value={spec.exit ?? 'none'} onChange={(e) => apply({ ...spec, exit: e.target.value as MotionSpec['exit'] })} className={inputCx}>
              <option value="none">None</option>
              {EXIT_RECIPES.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
            </select>
          </Field>
          <Field label="While on screen">
            <select value={spec.emphasis ?? 'none'} onChange={(e) => apply({ ...spec, emphasis: e.target.value as MotionSpec['emphasis'] })} className={inputCx}>
              <option value="none">Hold still</option>
              {EMPHASIS_RECIPES.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
            </select>
          </Field>
          <Field label="Camera">
            <select value={spec.camera ?? 'none'} onChange={(e) => apply({ ...spec, camera: e.target.value as MotionSpec['camera'] })} className={inputCx}>
              <option value="none">None</option>
              {CAMERA_RECIPES.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
            </select>
          </Field>
        </div>
        <Slider label="Intensity" value={spec.intensity ?? 1} min={0.3} max={2} step={0.1} onChange={(v) => apply({ ...spec, intensity: v })} />
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs text-muted">{describeMotionSpec(spec)}</p>
          {keyCount > 0 && (
            <button type="button" onClick={() => { setSpec({ intensity: 1 }); onPatch({ keyframes: [] }) }} className="text-xs text-muted underline-offset-2 hover:text-text hover:underline">
              Clear motion
            </button>
          )}
        </div>
      </div>
    </Disclosure>
  )
}
