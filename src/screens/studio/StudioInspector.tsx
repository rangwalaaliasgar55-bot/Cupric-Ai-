import { useRef } from 'react'
import { Copy, Link2, Scissors, Trash2 } from 'lucide-react'
import type {
  StudioBackgroundClip,
  StudioClip,
  StudioDoc,
  StudioGlassClip,
  StudioMediaClip,
  StudioOverlayClip,
  StudioTextClip,
} from '../../types/project'
import { Button } from '../../components/Button'
import { STUDIO_BACKGROUNDS } from '../../lib/studio/backgrounds'
import { TEXT_ANIMATIONS, TRANSITIONS, transitionInfo } from '../../lib/studio/transitions'
import { GLASS_PRESETS } from '../../lib/glass'
import { hasMedia, registerFile } from '../../lib/studio/media'
import { cx } from '../../lib/utils'

type Props = {
  doc: StudioDoc
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

export function StudioInspector({ doc, clip, onPatch, onDelete, onDuplicate, onSplit, onPatchDoc }: Props) {
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
