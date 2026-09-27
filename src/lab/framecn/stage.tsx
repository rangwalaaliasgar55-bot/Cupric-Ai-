/**
 * Hosts one framecn composition (1280×720 by default) scaled to its container,
 * with per-clip props over the component's own defaults, looping by remount so
 * CSS keyframes and shaders restart together.
 */
import { useEffect, useRef, useState, type ComponentType } from 'react'
import type { ComponentConfig } from './customizer-config'
import { StageClock, useElapsedMs } from './editframe-shim'
import { useDemoProps } from '../demo-props'

export function defaultsOf(config: ComponentConfig): Record<string, unknown> {
  return Object.fromEntries(Object.entries(config.controls).map(([k, c]) => [k, c.default]))
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function FramecnStage({ component: C, config }: { component: ComponentType<any>; config: ComponentConfig }) {
  const box = useRef<HTMLDivElement>(null)
  const [scale, setScale] = useState(0.4)
  const [loop, setLoop] = useState(0)
  const props = useDemoProps()
  const W = config.compositionWidth || 1280
  const H = config.compositionHeight || 720
  const durationMs = (config.durationInFrames / (config.fps || 30)) * 1000
  const t = useElapsedMs(true)
  useEffect(() => {
    const el = box.current
    if (!el) return
    const ro = new ResizeObserver(() => setScale(Math.min(el.clientWidth / W, el.clientHeight / H) || 0.4))
    ro.observe(el)
    return () => ro.disconnect()
  }, [W, H])
  // Loop: hold the last frame briefly, then restart everything together.
  const local = t - loop * (durationMs + 600)
  useEffect(() => { if (local > durationMs + 600) setLoop((l) => l + 1) }, [local, durationMs])
  return (
    <div ref={box} style={{ position: 'relative', width: '100%', height: '100%', minHeight: 120, overflow: 'hidden' }}>
      <div style={{ position: 'absolute', left: '50%', top: '50%', width: W, height: H, transform: `translate(-50%, -50%) scale(${scale})`, transformOrigin: 'center', overflow: 'hidden' }}>
        <StageClock.Provider value={Math.max(0, Math.min(local, durationMs))}>
          <C key={loop} {...defaultsOf(config)} {...(props ?? {})} fps={config.fps} durationInFrames={config.durationInFrames} />
        </StageClock.Provider>
      </div>
    </div>
  )
}
