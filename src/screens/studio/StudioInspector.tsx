import { useRef } from 'react'
import { Copy, Link2, Plus, Scissors, Trash2 } from 'lucide-react'
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
import { STUDIO_BACKGROUNDS } from '../../lib/studio/backgrounds'
import { TEXT_ANIMATIONS, TRANSITIONS, transitionInfo } from '../../lib/studio/transitions'
import { GLASS_PRESETS } from '../../lib/glass'
import { STICKERS } from '../../lib/studio/lottie'
import { hasMedia, registerFile } from '../../lib/studio/media'
import { cx } from '../../lib/utils'

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
  'w-full rounded-lg border border-line bg-panel-alt px-2.5 py-1.5 text-base text-text placeholder:text-muted/60'


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
}: {
  label: string
  summary?: string
  active?: boolean
  children: React.ReactNode
}) {
  return (
    <details className="group rounded-lg border border-line bg-panel-alt/40 open:bg-panel-alt/70">
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
          className="h-1 flex-1 accent-[var(--color-accent)]"
        />
        <span className="w-14 shrink-0 text-right font-mono text-xs text-muted tabular-nums">
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
          <div className="grid grid-cols-3 gap-1.5">
            {(['9:16', '1:1', '16:9'] as const).map((aspect) => (
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
                  className="flex h-full w-full items-end px-2 pb-1 text-xs text-text/90"
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

      <KeyframeFields clip={clip} time={time} onPatch={onPatch} />
      <GradeFields clip={clip} onPatch={onPatch} />
      <MaskFields clip={clip} onPatch={onPatch} />

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

      {clip.kind === 'text' && <TextFields clip={clip as StudioTextClip} onPatch={onPatch} />}
      {(clip.kind === 'video' || clip.kind === 'image') && (
        <MediaFields clip={clip as StudioMediaClip} onPatch={onPatch} />
      )}
      {clip.kind === 'background' && <BackgroundFields clip={clip as StudioBackgroundClip} onPatch={onPatch} />}
      {clip.kind === 'overlay' && <OverlayFields clip={clip as StudioOverlayClip} onPatch={onPatch} />}
      {clip.kind === 'glass' && <GlassFields clip={clip as StudioGlassClip} onPatch={onPatch} />}
      {clip.kind === 'audio' && <AudioFields clip={clip as StudioAudioClip} onPatch={onPatch} />}
      {clip.kind === 'sticker' && <StickerFields clip={clip as StudioStickerClip} onPatch={onPatch} />}
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
  const positioned = clip.kind === 'text' || clip.kind === 'overlay' || clip.kind === 'glass' || clip.kind === 'sticker'

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
        <Button size="sm" variant="outline" onClick={record} disabled={!withinClip}>
          <Plus size={13} /> Record at {Math.max(0, local).toFixed(2)}s
        </Button>
        {keys.length > 0 && (
          <Button size="sm" variant="ghost" onClick={() => onPatch({ keyframes: null })}>
            Clear
          </Button>
        )}
      </div>
      {!withinClip && <p className="text-xs text-muted/80">Move the playhead over this clip to record a keyframe.</p>}

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
                className="rounded-md border border-line bg-panel-alt px-1.5 py-1 text-xs text-text"
              >
                <option value="linear">Linear</option>
                <option value="ease-in">Ease in</option>
                <option value="ease-out">Ease out</option>
                <option value="ease-in-out">Ease in and out</option>
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
          <div className="grid grid-cols-2 gap-2">
            <Slider label="Opacity" value={key.opacity ?? 1} min={0} max={1} step={0.05} onChange={(v) => onPatch({ keyframes: keys.map((k, i) => (i === index ? { ...k, opacity: v } : k)) })} />
            <Slider label="Size" value={key.scale ?? 1} min={0.1} max={3} step={0.05} suffix="×" onChange={(v) => onPatch({ keyframes: keys.map((k, i) => (i === index ? { ...k, scale: v } : k)) })} />
            <Slider label="Rotation" value={key.rotation ?? 0} min={-180} max={180} step={1} suffix="°" onChange={(v) => onPatch({ keyframes: keys.map((k, i) => (i === index ? { ...k, rotation: v } : k)) })} />
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

function MaskFields({ clip, onPatch }: { clip: StudioClip; onPatch: (p: Partial<StudioClip>) => void }) {
  const mask = clip.mask ?? null
  const set = (patch: Partial<StudioMask>) => onPatch({ mask: { ...(mask ?? DEFAULT_MASK), ...patch } })

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
  return (
    <div className="space-y-4 border-t border-line pt-4">
      <Field label="Text">
        <textarea
          value={clip.text}
          rows={3}
          onChange={(e) => onPatch({ text: e.target.value, name: e.target.value.slice(0, 24) || 'Text' } as Partial<StudioClip>)}
          className={cx(inputCx, 'resize-y')}
        />
      </Field>

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
    const handle = await registerFile(file, clip.mediaId)
    onPatch({
      fileName: handle.fileName,
      localPath: handle.localPath,
      sourceDurationSec: handle.kind === 'video' ? handle.durationSec : 0,
      posterDataUrl: handle.posterDataUrl,
    } as Partial<StudioClip>)
  }

  return (
    <div className="space-y-4 border-t border-line pt-4">
      <p className="truncate font-mono text-xs text-muted" title={clip.localPath ?? clip.fileName}>
        {clip.fileName}
      </p>

      {!linked && (
        <div className="space-y-2 rounded-lg border border-danger/40 bg-danger/5 p-2.5">
          <p className="text-xs leading-relaxed text-muted">
            This clip lost its file handle — browsers cannot keep one across reloads. Pick{' '}
            <span className="font-mono">{clip.fileName}</span> again to restore the picture and sound.
          </p>
          <Button size="sm" variant="outline" onClick={() => relinkRef.current?.click()}>
            <Link2 size={13} /> Relink file
          </Button>
          <input
            ref={relinkRef}
            type="file"
            accept="video/*,image/*"
            className="hidden"
            onChange={(e) => void relink(e.target.files?.[0])}
          />
        </div>
      )}

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

function OverlayFields({ clip, onPatch }: { clip: StudioOverlayClip; onPatch: (p: Partial<StudioClip>) => void }) {
  return (
    <div className="space-y-4 border-t border-line pt-4">
      <p className="truncate text-xs text-muted">From {clip.source}</p>
      <Slider label="Scale" value={clip.scale} min={0.1} max={2} step={0.05} suffix="×" onChange={(v) => onPatch({ scale: v } as Partial<StudioClip>)} />
      <div className="grid grid-cols-2 gap-3">
        <Slider label="X" value={clip.x} min={0} max={1} step={0.01} onChange={(v) => onPatch({ x: v } as Partial<StudioClip>)} />
        <Slider label="Y" value={clip.y} min={0} max={1} step={0.01} onChange={(v) => onPatch({ y: v } as Partial<StudioClip>)} />
      </div>
    </div>
  )
}
