/**
 * The Remotion player itself (F-4).
 *
 * `@remotion/player` and the `remotion` runtime are ~300kB that only a locked
 * rundown ever shows, so they sit behind the lazy wrapper in
 * `MotionCompositionPlayer.tsx` rather than inside the Arena desk chunk.
 */
import { Player } from '@remotion/player'
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion'
import type { SceneRundown } from '../types/project'

function activeScene(rundown: SceneRundown, time: number) {
  return rundown.scenes.find((scene) => time >= scene.from && time < scene.to) || rundown.scenes[rundown.scenes.length - 1]
}

function Composition({ rundown }: { rundown: SceneRundown }) {
  const frame = useCurrentFrame()
  const { fps, width, height } = useVideoConfig()
  const time = frame / fps
  const scene = activeScene(rundown, time)
  const sceneStart = scene?.from ?? 0
  const localFrame = Math.max(0, frame - sceneStart * fps)
  const enter = spring({ frame: localFrame, fps, config: { damping: 18, stiffness: 140 } })
  const progress = Math.min(1, time / Math.max(0.1, rundown.durationSec))
  const wordOpacity = interpolate(localFrame, [0, 12], [0, 1], { extrapolateRight: 'clamp' })
  const drift = interpolate(frame, [0, Math.max(1, rundown.durationSec * fps)], [-width * 0.04, width * 0.04])

  return (
    <AbsoluteFill style={{ background: 'var(--color-stage)', color: 'var(--color-text)', fontFamily: 'Inter, Arial, sans-serif', overflow: 'hidden' }}>
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
    </AbsoluteFill>
  )
}

export default function MotionCompositionPlayerImpl({ rundown }: { rundown: SceneRundown }) {
  const width = Math.max(240, Math.round(rundown.size[0] || 1920))
  const height = Math.max(240, Math.round(rundown.size[1] || 1080))
  const durationInFrames = Math.max(1, Math.ceil(rundown.durationSec * rundown.fps))
  return (
    <Player
      component={Composition}
      inputProps={{ rundown }}
      durationInFrames={durationInFrames}
      compositionWidth={width}
      compositionHeight={height}
      fps={rundown.fps}
      controls
      loop
      style={{ width: '100%', aspectRatio: `${width} / ${height}`, borderRadius: 12, overflow: 'hidden', background: '#0B0B10' }}
    />
  )
}
