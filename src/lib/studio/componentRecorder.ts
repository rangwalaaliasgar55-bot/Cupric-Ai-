/**
 * Record a live UI component into video frames — its real animation, at its
 * real speed.
 *
 * The old capture stepped a "frozen" clock that none of the components read,
 * and each screenshot took a different amount of time, so the recorded motion
 * ran at a random speed. Worse, most components only move when someone uses
 * them — a counter rolls when + is clicked, a card tilts under the pointer —
 * so a passive capture came out as one still image.
 *
 * Now:
 *  - shots are timestamped against the wall clock and resampled onto a fixed
 *    frame grid, so a 600 ms spring lasts 600 ms in the video, however long
 *    each shot took;
 *  - an actor performs the component while it records: the pointer enters,
 *    travels a smooth path across it (hover, tilt, magnetic effects), and
 *    presses its controls one after another (buttons, switches, tabs,
 *    checkboxes), the way a person demoing it would.
 */
import { captureElement, type CaptureMethod } from '../capture'
import { trimFrames } from '../trimFrames'

export type RecordOptions = {
  durationSec: number
  /** Output frame rate of the resampled strip. */
  fps?: number
  interact?: boolean
  pixelRatio?: number
  onProgress?: (pct: number) => void
  signal?: AbortSignal
  /**
   * Drives the shared clock: called with each shot's time before it is
   * painted, so clock-driven components render exactly that moment and the
   * shot is stamped with it.
   */
  onClock?: (sec: number) => void
}

export type RecordResult = {
  frames: string[]
  frameFps: number
  animated: boolean
  method: CaptureMethod | ''
  width: number
  height: number
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))
const nextPaint = () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))

/* ——— the actor ——————————————————————————————————————————————————— */

const CONTROL_SELECTOR = 'button, [role="button"], [role="switch"], [role="tab"], [role="checkbox"], [role="radio"], [role="slider"], input[type="checkbox"], input[type="radio"], summary, a[href]'

function fire(target: Element, type: string, x: number, y: number, extra: MouseEventInit = {}) {
  const init: PointerEventInit = { bubbles: true, cancelable: true, composed: true, clientX: x, clientY: y, pointerId: 1, pointerType: 'mouse', isPrimary: true, buttons: 0, ...extra }
  const event = type.startsWith('pointer') && typeof PointerEvent !== 'undefined' ? new PointerEvent(type, init) : new MouseEvent(type, init)
  target.dispatchEvent(event)
}

export type Actor = { step: (elapsedSec: number) => void; stop: () => void }

/** A scripted "person" demoing whatever is inside `root`. */
export function createActor(root: HTMLElement, durationSec: number): Actor {
  const controls = [...root.querySelectorAll<HTMLElement>(CONTROL_SELECTOR)].filter((el) => {
    const r = el.getBoundingClientRect()
    return r.width > 2 && r.height > 2 && !(el as HTMLButtonElement).disabled
  })
  // Press controls through the middle of the recording, leaving the start to
  // show the resting state and the end to show the settled result.
  const presses = controls.length ? Math.max(1, Math.min(5, Math.floor(durationSec / 0.9))) : 0
  const pressAt = Array.from({ length: presses }, (_, i) => 0.5 + ((durationSec - 1.2) * i) / Math.max(1, presses - (presses > 1 ? 1 : 0)))
  let pressed = 0
  let hovered: Element | null = null
  let down: { el: Element; until: number; x: number; y: number } | null = null

  const move = (x: number, y: number) => {
    const target = document.elementFromPoint(x, y)
    if (target && root.contains(target)) {
      if (target !== hovered) {
        if (hovered) {
          fire(hovered, 'pointerout', x, y)
          fire(hovered, 'mouseout', x, y)
          fire(hovered, 'pointerleave', x, y, { bubbles: false })
          fire(hovered, 'mouseleave', x, y, { bubbles: false })
        }
        fire(target, 'pointerover', x, y)
        fire(target, 'mouseover', x, y)
        fire(target, 'pointerenter', x, y, { bubbles: false })
        fire(target, 'mouseenter', x, y, { bubbles: false })
        hovered = target
      }
      fire(target, 'pointermove', x, y)
      fire(target, 'mousemove', x, y)
    }
  }

  return {
    step(elapsed: number) {
      const box = root.getBoundingClientRect()
      if (box.width < 4 || box.height < 4) return
      if (down && elapsed >= down.until) {
        fire(down.el, 'pointerup', down.x, down.y)
        fire(down.el, 'mouseup', down.x, down.y)
        fire(down.el, 'click', down.x, down.y)
        down = null
      }
      if (!down && pressed < pressAt.length && elapsed >= pressAt[pressed]) {
        const el = controls[pressed % controls.length]
        if (el?.isConnected) {
          const r = el.getBoundingClientRect()
          const x = r.left + r.width / 2
          const y = r.top + r.height / 2
          move(x, y)
          fire(el, 'pointerdown', x, y, { buttons: 1 })
          fire(el, 'mousedown', x, y, { buttons: 1 })
          if (el instanceof HTMLElement) el.focus({ preventScroll: true })
          // Hold-to-confirm style controls need a long press; others a tap.
          const hold = /hold|press|long/i.test(`${el.getAttribute('aria-label') ?? ''} ${el.textContent ?? ''}`) ? 1.1 : 0.12
          down = { el, until: elapsed + hold, x, y }
        }
        pressed += 1
        return
      }
      if (down) return
      // Between presses the pointer drifts along a smooth Lissajous path over
      // the component, which drives hover, tilt and magnetic effects.
      const p = elapsed / Math.max(0.5, durationSec)
      const x = box.left + box.width * (0.5 + 0.32 * Math.sin(p * Math.PI * 2))
      const y = box.top + box.height * (0.5 + 0.22 * Math.sin(p * Math.PI * 4))
      move(x, y)
    },
    stop() {
      if (down) {
        fire(down.el, 'pointerup', down.x, down.y)
        fire(down.el, 'mouseup', down.x, down.y)
      }
      if (hovered) {
        fire(hovered, 'pointerleave', 0, 0, { bubbles: false })
        fire(hovered, 'mouseleave', 0, 0, { bubbles: false })
      }
    },
  }
}

/* ——— the recorder ———————————————————————————————————————————————— */

/** Pick, for every output frame time, the latest shot taken at or before it. */
export function resampleShots(shots: { t: number; url: string }[], durationSec: number, fps: number): string[] {
  if (!shots.length) return []
  const count = Math.max(1, Math.round(durationSec * fps))
  const out: string[] = []
  let j = 0
  for (let i = 0; i < count; i += 1) {
    const at = i / fps
    while (j + 1 < shots.length && shots[j + 1].t <= at + 1e-3) j += 1
    out.push(shots[j].url)
  }
  return out
}

export async function recordComponent(stage: HTMLElement, opts: RecordOptions): Promise<RecordResult> {
  const durationSec = Math.min(120, Math.max(0.5, opts.durationSec))
  const fps = Math.max(6, Math.min(24, opts.fps ?? 12))
  const pixelRatio = opts.pixelRatio ?? Math.min(2, Math.max(1.5, window.devicePixelRatio || 1))
  const capture = { type: 'image/webp' as const, quality: 0.86, pixelRatio }

  await document.fonts?.ready.catch(() => undefined)
  await nextPaint()

  const actor = opts.interact === false ? null : createActor(stage, durationSec)
  const shots: { t: number; url: string }[] = []
  let method: CaptureMethod | '' = ''
  const started = performance.now()
  try {
    for (;;) {
      if (opts.signal?.aborted) throw new DOMException('Cancelled', 'AbortError')
      const elapsed = (performance.now() - started) / 1000
      if (elapsed > durationSec) break
      actor?.step(elapsed)
      opts.onClock?.(elapsed)
      await nextPaint()
      const t = opts.onClock ? elapsed : (performance.now() - started) / 1000
      const shot = await captureElement(stage, capture, method || undefined)
      method = shot.method
      shots.push({ t: Math.min(durationSec, t), url: shot.dataUrl })
      opts.onProgress?.(Math.min(90, Math.round((t / durationSec) * 90)))
      // A fast capture path would otherwise take shots far above the frame
      // rate; spacing them saves memory without losing any motion.
      const spent = (performance.now() - started) / 1000 - t
      if (spent < 1 / fps) await sleep((1 / fps - spent) * 1000)
    }
  } finally {
    actor?.stop()
  }

  const animated = new Set(shots.map((s) => s.url)).size > 1
  let frames = animated ? resampleShots(shots, durationSec, fps) : shots.slice(0, 1).map((s) => s.url)
  const trimmed = await trimFrames(frames)
  frames = trimmed.frames
  opts.onProgress?.(100)
  const size = await new Promise<{ w: number; h: number }>((resolve) => {
    const img = new Image()
    img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight })
    img.onerror = () => resolve({ w: 0, h: 0 })
    img.src = frames[0] ?? ''
  })
  return { frames, frameFps: fps, animated, method, width: size.w, height: size.h }
}
