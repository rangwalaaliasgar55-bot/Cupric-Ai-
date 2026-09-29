/**
 * Per-clip pro controls: blend mode + chroma key (2.6), colour wheels + LUT +
 * auto grade (2.3/2.17), device mockup (2.15), product-photo motion (2.16),
 * logo reveals (2.22), before/after (2.21), text presets + AI variants
 * (2.5/2.12) and audio role/ducking/loudness (2.4).
 *
 * Every control calls onPatch/onPatchDoc exactly once → one undo step.
 * Anything that cannot apply says why instead of doing nothing.
 */
import { useEffect, useState } from 'react'
import type {
  StudioAudioClip,
  StudioBlendMode,
  StudioClip,
  StudioDevice,
  StudioDoc,
  StudioGradeNode,
  StudioMask,
  StudioMediaClip,
  StudioTextClip,
} from '../../types/project'
import { Button } from '../../components/Button'
import { autoGrade, computeScopes, neutralWheels, parseCube } from '../../lib/studio/color'
import { LOGO_REVEALS, PRODUCT_PRESETS, logoRevealKeyframes, withProductPreset, type LogoReveal, type ProductPreset } from '../../lib/studio/layouts'
import { TEXT_PRESETS, applyTextPreset } from '../../lib/studio/textTools'
import { requestTextVariants } from '../../lib/studio/aiText'
import { briefForClip } from '../../lib/studio/creativeLog'
import { DEFAULT_DUCKING } from '../../lib/studio/audioMix'
import { getMedia, proxyMode, registerFile, setProxyMode, type ProxyMode } from '../../lib/studio/media'
import { PROXY_EVENT, makeProxy, proxyStatus, removeProxy } from '../../lib/studio/proxy'

type Props = {
  doc: StudioDoc
  clip: StudioClip
  onPatch: (patch: Partial<StudioClip>) => void
  onPatchDoc: (patch: Partial<StudioDoc>) => void
}

const inputCx = 'w-full cu-input px-2.5 py-1.5 text-base text-text'
const chip = 'rounded-md border border-line px-2 py-1 text-xs text-text hover:border-accent/60 hover:bg-accent/10'

function Box({ label, active, children }: { label: string; active?: boolean; children: React.ReactNode }) {
  return (
    <details className="group cu-section">
      <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-xs font-medium text-text">
        {label}
        {active && <span className="h-1.5 w-1.5 rounded-full bg-accent" aria-label="in use" />}
      </summary>
      <div className="space-y-3 border-t border-line px-3 py-3">{children}</div>
    </details>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-xs text-muted">{label}</span>
      {children}
    </label>
  )
}

const BLENDS: StudioBlendMode[] = ['normal', 'multiply', 'screen', 'overlay', 'darken', 'lighten', 'color-dodge', 'soft-light', 'difference', 'add']
const DEVICES: Array<[StudioDevice, string]> = [['none', 'None'], ['phone', 'Phone'], ['laptop', 'Laptop'], ['browser', 'Browser']]

export function ClipProFields({ doc, clip, onPatch, onPatchDoc }: Props) {
  const [note, setNote] = useState<string | null>(null)
  const [variants, setVariants] = useState<{ list: string[]; note?: string; busy: boolean } | null>(null)
  const isMedia = clip.kind === 'video' || clip.kind === 'image'
  const visual = clip.kind !== 'audio'

  const wheels = clip.grade?.find((n) => n.id === 'wheels') as Extract<StudioGradeNode, { id: 'wheels' }> | undefined
  const setWheels = (patch: Partial<Extract<StudioGradeNode, { id: 'wheels' }>>) => {
    const base = wheels ?? neutralWheels()
    const next = { ...base, ...patch }
    const others = (clip.grade ?? []).filter((n) => n.id !== 'wheels')
    onPatch({ grade: [...others, next] })
  }

  const mask = clip.mask
  const chromaOn = mask?.shape === 'chroma'
  const setChroma = (patch: Partial<StudioMask>) => {
    const base: StudioMask = mask?.shape === 'chroma' ? mask : { shape: 'chroma', x: 0, y: 0, w: 1, h: 1, featherPct: 0, invert: false, threshold: 0.22, softness: 0.18, keyColor: '#00ff00', spill: 0.5 }
    onPatch({ mask: { ...base, ...patch } })
  }

  const runAutoGrade = () => {
    if (!isMedia) return
    const handle = getMedia((clip as StudioMediaClip).mediaId)
    const src = (handle?.preview ?? handle?.element) as CanvasImageSource | undefined
    if (!src || handle?.kind === 'audio') return setNote('Relink the media first — there are no pixels to analyse.')
    const c = document.createElement('canvas')
    c.width = 160
    c.height = 160
    const ctx = c.getContext('2d', { willReadFrequently: true })
    if (!ctx) return setNote('Canvas is unavailable.')
    try {
      ctx.drawImage(src, 0, 0, 160, 160)
      const stats = computeScopes(ctx.getImageData(0, 0, 160, 160).data, 160, 160).stats
      const g = autoGrade(stats)
      const keep = (clip.grade ?? []).filter((n) => n.id === 'wheels')
      onPatch({ grade: [...g.nodes, ...keep] })
      setNote(`Auto grade: ${g.notes.join(' · ')}. Undo reverts it.`)
    } catch {
      setNote('This media cannot be read back (cross-origin). Import the file directly.')
    }
  }

  const loadLut = async (file: File) => {
    try {
      const lut = parseCube(await file.text(), file.name.replace(/\.cube$/i, ''))
      onPatch({ lut })
      setNote(`LUT “${lut.name}” (${lut.size}³) applied.`)
    } catch (err) {
      setNote(err instanceof Error ? err.message : 'That LUT could not be read.')
    }
  }

  const pickBefore = async (file: File) => {
    try {
      const handle = await registerFile(file)
      if (handle.kind === 'audio') return setNote('Pick an image or video for the “before”.')
      onPatch({ compare: { beforeMediaId: handle.id, beforeFileName: handle.fileName, mode: 'sweep', position: 0.5 } } as Partial<StudioClip>)
      setNote('Before/after on. This clip is the “after”.')
    } catch (err) {
      setNote(err instanceof Error ? err.message : 'That file could not be opened.')
    }
  }

  return (
    <div className="space-y-2">
      {clip.kind === 'text' && (
        <Box label="Text presets & variants">
          <div className="flex flex-wrap gap-1.5">
            {TEXT_PRESETS.map((p) => (
              <button key={p.id} type="button" className={chip} onClick={() => onPatch(applyTextPreset(clip as StudioTextClip, p.id))}>
                {p.label}
              </button>
            ))}
          </div>
          <Button
            size="sm"
            variant="outline"
            disabled={variants?.busy} title={(variants?.busy) ? 'Generating variants…' : undefined}
            onClick={async () => {
              setVariants({ list: [], busy: true })
              // The history for the footage this text sits over: a rewrite is asked not to land
              // on the looks already rejected there (creative log, ported from open-edit).
              const r = await requestTextVariants((clip as StudioTextClip).text, briefForClip(doc, clip))
              setVariants({ list: r.variants, note: r.note, busy: false })
            }}
          >
            {variants?.busy ? 'Writing…' : 'Suggest rewrites'}
          </Button>
          {variants && !variants.busy && (
            <div className="space-y-1">
              {variants.note && <p className="text-xs text-muted">{variants.note}</p>}
              {!variants.list.length && <p className="text-xs text-muted">No different rewrites to offer for this text.</p>}
              {variants.list.map((v) => (
                <button key={v} type="button" className="block w-full cu-chip px-2 py-1.5 text-left text-sm" onClick={() => onPatch({ text: v } as Partial<StudioClip>)}>
                  {v}
                </button>
              ))}
            </div>
          )}
        </Box>
      )}

      {clip.kind === 'video' && <ProxyBox mediaId={(clip as StudioMediaClip).mediaId} />}

      {isMedia && (
        <Box label="Motion presets" active={!!(clip as StudioMediaClip).motionPreset}>
          <p className="text-xs text-muted">Parametric camera moves — the same frame in preview and export.</p>
          <div className="flex flex-wrap gap-1.5">
            {PRODUCT_PRESETS.map((p) => (
              <button key={p} type="button" className={chip} onClick={() => onPatch(withProductPreset(clip as StudioMediaClip, p as ProductPreset))}>
                {p}
              </button>
            ))}
          </div>
          <span className="block text-xs text-muted">Logo reveal</span>
          <div className="flex flex-wrap gap-1.5">
            {LOGO_REVEALS.map((p) => (
              <button key={p} type="button" className={chip} onClick={() => onPatch({ keyframes: logoRevealKeyframes(p as LogoReveal, clip.durationSec), motionPreset: `logo:${p}` } as Partial<StudioClip>)}>
                {p}
              </button>
            ))}
          </div>
        </Box>
      )}

      {(isMedia || clip.kind === 'overlay') && (
        <Box label="Device mockup" active={!!(clip as StudioMediaClip).device && (clip as StudioMediaClip).device !== 'none'}>
          <div className="flex flex-wrap gap-1.5">
            {DEVICES.map(([id, label]) => (
              <button key={id} type="button" className={chip} aria-pressed={((clip as StudioMediaClip).device ?? 'none') === id} onClick={() => onPatch({ device: id } as Partial<StudioClip>)}>
                {label}
              </button>
            ))}
          </div>
        </Box>
      )}

      {isMedia && (
        <Box label="Before / after" active={!!(clip as StudioMediaClip).compare}>
          <p className="text-xs text-muted">Use two real photos of the same thing. Nothing is generated.</p>
          <input type="file" accept="image/*,.heic,.heif,video/*" className="text-xs" onChange={(e) => e.target.files?.[0] && pickBefore(e.target.files[0])} aria-label="Pick the before image" />
          {(clip as StudioMediaClip).compare && (
            <>
              <Row label="Divider">
                <select className={inputCx} value={(clip as StudioMediaClip).compare!.mode} onChange={(e) => onPatch({ compare: { ...(clip as StudioMediaClip).compare!, mode: e.target.value as 'sweep' | 'static' } } as Partial<StudioClip>)}>
                  <option value="sweep">Sweep across</option>
                  <option value="static">Fixed split</option>
                </select>
              </Row>
              <Button size="sm" variant="outline" onClick={() => onPatch({ compare: null } as Partial<StudioClip>)}>Remove before/after</Button>
            </>
          )}
        </Box>
      )}

      {visual && (
        <Box label="Blend & key" active={(clip.blendMode && clip.blendMode !== 'normal') || chromaOn}>
          <Row label="Blend mode">
            <select className={inputCx} value={clip.blendMode ?? 'normal'} onChange={(e) => onPatch({ blendMode: e.target.value as StudioBlendMode })}>
              {BLENDS.map((b) => <option key={b} value={b}>{b}</option>)}
            </select>
          </Row>
          {isMedia && (
            <>
              <label className="flex items-center gap-2 text-xs">
                <input type="checkbox" checked={chromaOn} onChange={(e) => (e.target.checked ? setChroma({}) : onPatch({ mask: null }))} /> Chroma key (green/blue screen)
              </label>
              {chromaOn && (
                <div className="grid grid-cols-2 gap-2">
                  <Row label="Key colour"><input type="color" className="h-8 w-full" value={mask?.keyColor ?? '#00ff00'} onChange={(e) => setChroma({ keyColor: e.target.value })} /></Row>
                  <Row label={`Tolerance ${Math.round((mask?.threshold ?? 0) * 100)}`}><input type="range" min={0} max={1} step={0.01} value={mask?.threshold ?? 0.22} onChange={(e) => setChroma({ threshold: Number(e.target.value) })} /></Row>
                  <Row label={`Edge ${Math.round((mask?.softness ?? 0) * 100)}`}><input type="range" min={0} max={1} step={0.01} value={mask?.softness ?? 0.18} onChange={(e) => setChroma({ softness: Number(e.target.value) })} /></Row>
                  <Row label={`Spill ${Math.round((mask?.spill ?? 0) * 100)}`}><input type="range" min={0} max={1} step={0.01} value={mask?.spill ?? 0.5} onChange={(e) => setChroma({ spill: Number(e.target.value) })} /></Row>
                </div>
              )}
            </>
          )}
        </Box>
      )}

      {visual && (
        <Box label="Colour wheels & LUT" active={!!clip.lut || !!wheels}>
          {isMedia && <Button size="sm" variant="outline" onClick={runAutoGrade}>Auto grade photo</Button>}
          {(['lift', 'gamma', 'gain'] as const).map((part) => (
            <div key={part} className="space-y-1">
              <span className="text-xs capitalize text-muted">{part}</span>
              <div className="grid grid-cols-3 gap-1.5">
                {(['R', 'G', 'B'] as const).map((ch, i) => (
                  <input
                    key={ch}
                    type="range"
                    min={-100}
                    max={100}
                    step={1}
                    aria-label={`${part} ${ch}`}
                    title={`${part} ${ch}: ${(wheels ?? neutralWheels())[part][i]}`}
                    value={(wheels ?? neutralWheels())[part][i]}
                    onChange={(e) => {
                      const arr = [...(wheels ?? neutralWheels())[part]] as [number, number, number]
                      arr[i] = Number(e.target.value)
                      setWheels({ [part]: arr })
                    }}
                  />
                ))}
              </div>
            </div>
          ))}
          {wheels && <button type="button" className={chip} onClick={() => onPatch({ grade: (clip.grade ?? []).filter((n) => n.id !== 'wheels') })}>Reset wheels</button>}
          <Row label="3D LUT (.cube)">
            <input type="file" accept=".cube" className="text-xs" onChange={(e) => e.target.files?.[0] && loadLut(e.target.files[0])} />
          </Row>
          {clip.lut && (
            <div className="space-y-1">
              <Row label={`${clip.lut.name} · strength ${Math.round(clip.lut.strength * 100)}%`}>
                <input type="range" min={0} max={1} step={0.01} value={clip.lut.strength} onChange={(e) => onPatch({ lut: { ...clip.lut!, strength: Number(e.target.value) } })} />
              </Row>
              <button type="button" className={chip} onClick={() => onPatch({ lut: null })}>Remove LUT</button>
            </div>
          )}
        </Box>
      )}

      {clip.kind === 'audio' && (
        <Box label="Mix: role, ducking, loudness" active={!!doc.ducking?.enabled || (clip as StudioAudioClip).role === 'voice'}>
          <Row label="This clip is">
            <select className={inputCx} value={(clip as StudioAudioClip).role ?? 'music'} onChange={(e) => onPatch({ role: e.target.value as StudioAudioClip['role'] } as Partial<StudioClip>)}>
              <option value="music">Music (ducks under speech)</option>
              <option value="voice">Voice-over (music ducks under it)</option>
              <option value="sfx">Sound effect (never ducked)</option>
            </select>
          </Row>
          <label className="flex items-center gap-2 text-xs">
            <input type="checkbox" checked={!!doc.ducking?.enabled} onChange={(e) => onPatchDoc({ ducking: e.target.checked ? { ...(doc.ducking ?? DEFAULT_DUCKING), enabled: true } : { ...(doc.ducking ?? DEFAULT_DUCKING), enabled: false } })} /> Auto-duck music under speech
          </label>
          {doc.ducking?.enabled && (
            <Row label={`Duck by ${doc.ducking.amountDb} dB`}>
              <input type="range" min={-30} max={-3} step={1} value={doc.ducking.amountDb} onChange={(e) => onPatchDoc({ ducking: { ...doc.ducking!, amountDb: Number(e.target.value) } })} />
            </Row>
          )}
          <Row label="Export loudness target">
            <select className={inputCx} value={doc.loudnessTarget == null ? 'off' : String(doc.loudnessTarget)} onChange={(e) => onPatchDoc({ loudnessTarget: e.target.value === 'off' ? null : Number(e.target.value) })}>
              <option value="off">Off (as mixed)</option>
              <option value="-14">−14 LUFS (YouTube, Spotify, TikTok)</option>
              <option value="-16">−16 LUFS (Apple, podcasts)</option>
              <option value="-23">−23 LUFS (EBU broadcast)</option>
            </select>
          </Row>
        </Box>
      )}

      {note && <p className="rounded-md border border-line bg-panel-alt/60 px-2 py-1.5 text-xs text-muted" role="status">{note}</p>}
    </div>
  )
}

/** 2.7 — preview proxy status and controls for one video clip. */
function ProxyBox({ mediaId }: { mediaId: string }) {
  const [, force] = useState(0)
  const [mode, setMode] = useState<ProxyMode>(proxyMode())
  useEffect(() => {
    const on = (e: Event) => {
      if ((e as CustomEvent).detail?.mediaId === mediaId) force((n) => n + 1)
    }
    window.addEventListener(PROXY_EVENT, on)
    return () => window.removeEventListener(PROXY_EVENT, on)
  }, [mediaId])
  const s = proxyStatus(mediaId)
  const h = getMedia(mediaId)
  const label =
    s.state === 'ready' ? `Proxy ready${s.cached ? ' (cached)' : ''} — preview plays 540p, export uses the original` :
    s.state === 'making' ? `Making proxy… ${Math.round(s.pct * 100)}%` :
    s.state === 'failed' ? `Proxy failed: ${s.error}` :
    s.state === 'unavailable' ? s.error ?? 'Proxies are unavailable here.' :
    h ? `No proxy — preview plays the original (${h.width}×${h.height})` : 'Relink the file first.'
  return (
    <Box label="Preview proxy" active={s.state === 'ready'}>
      <p className="text-xs text-muted" role="status">{label}</p>
      {s.state === 'making' && (
        <div className="h-1.5 overflow-hidden rounded bg-panel-alt"><div className="h-full bg-accent transition-[width]" style={{ width: `${Math.round(s.pct * 100)}%` }} /></div>
      )}
      <div className="flex gap-1.5">
        {s.state !== 'ready' && s.state !== 'making' && <Button size="sm" variant="outline" disabled={!h} title={(!h) ? 'Source file not available on disk' : undefined} onClick={() => void makeProxy(mediaId)}>Make proxy</Button>}
        {s.state === 'ready' && <Button size="sm" variant="outline" onClick={() => void removeProxy(mediaId)}>Remove proxy</Button>}
      </div>
      <Row label="For new imports">
        <select className={inputCx} value={mode} onChange={(e) => { const m = e.target.value as ProxyMode; setProxyMode(m); setMode(m); force((n) => n + 1) }}>
          <option value="auto">Auto — above 1080p or large 1080p files</option>
          <option value="always">Always make proxies</option>
          <option value="off">Off — always preview the original</option>
        </select>
      </Row>
    </Box>
  )
}
