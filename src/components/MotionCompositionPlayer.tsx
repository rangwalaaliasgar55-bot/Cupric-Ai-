/**
 * MotionCompositionPlayer — a rundown preview with real transport controls.
 *
 * This used to be a thin wrapper around `@remotion/player`: the composition was
 * `AbsoluteFill` + `useCurrentFrame` + `interpolate`/`spring`, and the player
 * supplied playback, scrubbing and looping. Remotion's licence is free only for
 * individuals and organisations of up to three employees — a paid company
 * licence is required above that — so Phase 5 replaced it with this component
 * (`docs/PHASE1_LICENSING.md`).
 *
 * What it does now, with no dependency:
 *   - a wall-clock frame loop (`requestAnimationFrame`), so the preview runs at
 *     the rundown's frame rate regardless of display refresh;
 *   - transport: play/pause, a scrub bar, a time readout, a loop toggle;
 *   - the same composition: scene copy, motion note, spring entrance and the
 *     progress bar, driven by the scene list.
 *
 * It is a *preview*, not the exporter: the real render path is Studio's
 * compositor and the desktop FFmpeg pipeline, and this stage only ever paints
 * DOM — exactly the contract Remotion's player had here.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Pause, Play, Repeat } from 'lucide-react'
import { springValue } from '../core/math'
import type { SceneRundown } from '../types/project'

const clamp01 = (value: number) => (value < 0 ? 0 : value > 1 ? 1 : value)

function activeScene(rundown: SceneRundown, time: number) {
  return rundown.scenes.find((scene) => time >= scene.from && time < scene.to) || rundown.scenes[rundown.scenes.length - 1]
}

/** Linear ramp with the ends held, the shape `interpolate(..., clamp)` has. */
function ramp(value: number, from: number, to: number, outFrom: number, outTo: number) {
  const k = clamp01((value - from) / (to - from || 1))
  return outFrom + (outTo - outFrom) * k
}

/** The scene stage. Pure geometry — no clock of its own; `time` is passed in. */
export function MotionCompositionStage({ rundown, time, width, height }: { rundown: SceneRundown; time: number; width: number; height: number }) {
  const fps = rundown.fps || 30
  const scene = activeScene(rundown, time)
  const sceneStart = scene?.from ?? 0
  const localSeconds = Math.max(0, time - sceneStart)
  // The entrance spring: 0 → 1 with a small overshoot, settling in ~0.5 s.
  const enter = springValue(localSeconds, { stiffness: 140, damping: 18 })
  const progress = clamp01(time / Math.max(0.1, rundown.durationSec))
  const wordOpacity = ramp(localSeconds, 0, 12 / fps, 0, 1)
  const drift = ramp(time, 0, Math.max(0.1, rundown.durationSec), -width * 0.04, width * 0.04)

  return (
    <div
      data-motion-stage
      style={{
        position: 'absolute',
        inset: 0,
        background: 'var(--color-stage)',
        color: 'var(--color-text)',
        fontFamily: 'Inter, Arial, sans-serif',
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          position: 'absolute',
          width: width * 0.5,
          height: width * 0.5,
          borderRadius: '50%',
          left: -width * 0.1 + drift,
          top: -height * 0.18,
          background: 'rgba(200,245,66,.22)',
          filter: 'blur(54px)',
        }}
      />
      <div
        style={{
          position: 'absolute',
          width: width * 0.58,
          height: width * 0.58,
          borderRadius: '50%',
          right: -width * 0.18 - drift,
          bottom: -height * 0.28,
          background: 'rgba(79,182,232,.18)',
          filter: 'blur(62px)',
        }}
      />
      <div style={{ position: 'absolute', left: width * 0.065, top: height * 0.085, color: 'var(--color-accent)', fontSize: width * 0.028, fontWeight: 800, letterSpacing: 5 }}>
        CUPRIC AI
      </div>
      <div style={{ position: 'absolute', left: width * 0.065, right: width * 0.065, top: height * 0.31, transform: `scale(${0.96 + enter * 0.04})`, opacity: wordOpacity }}>
        <div style={{ color: 'var(--color-muted)', fontSize: width * 0.022, fontWeight: 700, letterSpacing: 3, textTransform: 'uppercase', marginBottom: height * 0.026 }}>
          {scene?.type ?? 'scene'} · {Math.max(0, Math.round(time * 10) / 10).toFixed(1)}s
        </div>
        <div style={{ fontSize: width * 0.07, lineHeight: 0.92, fontWeight: 900, letterSpacing: -3, maxWidth: width * 0.78 }}>
          {scene?.copy || rundown.title}
        </div>
        <div style={{ marginTop: height * 0.05, maxWidth: width * 0.72, color: 'var(--color-muted)', fontSize: width * 0.026, lineHeight: 1.32 }}>
          {scene?.motion || rundown.style}
        </div>
      </div>
      <div style={{ position: 'absolute', left: width * 0.065, right: width * 0.065, bottom: height * 0.07, height: Math.max(6, height * 0.012), background: 'rgba(255,255,255,.12)', borderRadius: 999 }}>
        <div style={{ width: `${progress * 100}%`, height: '100%', background: '#C8F542', borderRadius: 999 }} />
      </div>
    </div>
  )
}

export function MotionCompositionPlayer({ rundown }: { rundown: SceneRundown }) {
  const width = Math.max(240, Math.round(rundown.size[0] || 1920))
  const height = Math.max(240, Math.round(rundown.size[1] || 1080))
  const duration = Math.max(0.1, rundown.durationSec)
  const fps = rundown.fps || 30

  const [time, setTime] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [loop, setLoop] = useState(true)
  const timeRef = useRef(0)
  const loopRef = useRef(loop)
  loopRef.current = loop

  // A wall-clock clock: the frame shown is derived from elapsed milliseconds,
  // so a slow paint cannot make the preview drift behind the audio a viewer
  // would hear in the exported file.
  useEffect(() => {
    if (!playing) return
    let raf = 0
    let last = performance.now()
    const step = (now: number) => {
      const delta = (now - last) / 1000
      last = now
      const next = timeRef.current + delta
      if (next >= duration) {
        if (loopRef.current) {
          timeRef.current = 0
          setTime(0)
        } else {
          timeRef.current = duration
          setTime(duration)
          setPlaying(false)
          return
        }
      } else {
        timeRef.current = next
        setTime(next)
      }
      raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [playing, duration])

  const seek = useCallback((value: number) => {
    const next = Math.max(0, Math.min(duration, value))
    timeRef.current = next
    setTime(next)
  }, [duration])

  const scale = useMemo(() => ({ width: 100, height: 100 * (height / width) }), [width, height])
  const frame = Math.round(time * fps)

  return (
    <div className="overflow-hidden rounded-xl border border-line bg-stage" style={{ width: '100%' }}>
      <div style={{ position: 'relative', width: '100%', aspectRatio: `${width} / ${height}` }}>
        <MotionCompositionStage rundown={rundown} time={time} width={width} height={height} />
      </div>
      <div className="flex items-center gap-3 border-t border-line bg-panel px-3 py-2">
        <button
          type="button"
          onClick={() => setPlaying((value) => !value)}
          aria-label={playing ? 'Pause preview' : 'Play preview'}
          className="flex h-7 w-7 items-center justify-center rounded-md border border-line text-text transition-colors duration-150 hover:border-accent/60 hover:text-accent-text active:scale-[0.96]"
        >
          {playing ? <Pause size={13} /> : <Play size={13} className="translate-x-px" />}
        </button>
        <button
          type="button"
          onClick={() => setLoop((value) => !value)}
          aria-pressed={loop}
          aria-label={loop ? 'Loop is on' : 'Loop is off'}
          className={`flex h-7 w-7 items-center justify-center rounded-md border transition-colors duration-150 active:scale-[0.96] ${loop ? 'border-accent/60 text-accent-text' : 'border-line text-muted hover:text-text'}`}
        >
          <Repeat size={13} />
        </button>
        <input
          type="range"
          min={0}
          max={duration}
          step={1 / fps}
          value={time}
          onChange={(event) => seek(Number(event.target.value))}
          aria-label="Scrub the preview"
          className="h-1 flex-1 accent-accent"
        />
        <span className="font-mono text-xs tabular-nums text-muted">
          {time.toFixed(1)}s / {duration.toFixed(1)}s
          <span className="ml-2 text-muted/60">frame {frame}</span>
        </span>
      </div>
    </div>
  )
}
