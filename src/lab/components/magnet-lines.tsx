import { useEffect, useRef } from "react";
import { useReducedMotion } from "@/lib/use-reduced-motion";
import { cn } from "@/lib/cn";

const COLS = 12;
const ROWS = 9;
// Leaves a clear gap between neighbours even when both point at each other.
const LENGTH = 18;
const WIDTH = 2;
// Lines near the pointer grow a little, as if pulled into the field.
const GROW = 0.35;
// Within this distance a line reads as close: brighter and longer.
const FIELD = 160;
// Slightly underdamped (ratio 0.6), so a line swings past and settles
// instead of snapping straight to its target.
const STIFFNESS = 260;
const DAMPING_RATIO = 0.6;
// The distance at which a line has half its full stiffness. Beyond it,
// lines turn noticeably later, so the pull ripples outward.
const HALF_PULL = 90;
// Even the farthest lines keep this share, so none ever feels stuck.
const FAR_STIFFNESS = 0.18;
// The idle wave: a slow tilt that travels diagonally across the grid.
const WAVE_SPEED = 0.7;
const WAVE_SWING = 0.45;
// Soft, so letting go reads as the field relaxing back into the wave.
const WAVE_STIFFNESS = 40;
const REST = 0.001;
// A page left open shouldn't animate forever: after this long without
// pointer activity the wave freezes, and any pointer wakes it again.
const IDLE_PAUSE = 10_000;

type Point = { x: number; y: number };

// Segments have no head, so a line pointing at the cursor or directly away
// looks the same. Wrapping by half a turn means one never spins 180deg.
function halfTurn(delta: number) {
  return delta - Math.PI * Math.round(delta / Math.PI);
}

export function MagnetLines({ className }: { className?: string }) {
  const reduce = useReducedMotion() ?? false;
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!wrap || !canvas || !ctx) return;

    const count = COLS * ROWS;
    // Flat typed arrays keep the per-frame loop allocation free.
    const baseX = new Float32Array(count);
    const baseY = new Float32Array(count);
    const angle = new Float32Array(count);
    const spin = new Float32Array(count);
    // 0 far away, 1 under the pointer; eased so brightness never pops.
    const near = new Float32Array(count);

    let width = 0;
    let height = 0;
    let pointer: Point | null = null;
    let last: Point | null = null;
    let frameId = 0;
    let pending = 0;
    let then = 0;
    let inView = true;
    let visible = true;
    let activeAt = performance.now();
    let waveT = performance.now() / 1000;
    let dim = "";
    let lit = "";

    const wave = (i: number, t: number) => {
      const c = i % COLS;
      const r = (i / COLS) | 0;
      return (
        Math.PI / 4 + WAVE_SWING * Math.sin(t * WAVE_SPEED - c * 0.45 - r * 0.35)
      );
    };

    const readColors = () => {
      // Computed colors resolve light-dark(), which a raw custom property doesn't.
      dim = getComputedStyle(canvas).color;
      lit = getComputedStyle(wrap).color;
    };

    const layout = () => {
      const dpr = window.devicePixelRatio || 1;
      width = wrap.clientWidth;
      height = wrap.clientHeight;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      // Each line sits in the middle of an equal cell, so margins match.
      const cellX = width / COLS;
      const cellY = height / ROWS;
      for (let i = 0; i < count; i++) {
        baseX[i] = (i % COLS) * cellX + cellX / 2;
        baseY[i] = ((i / COLS) | 0) * cellY + cellY / 2;
      }
    };

    const segment = (i: number) => {
      const half = (LENGTH * (1 + GROW * near[i])) / 2;
      const dx = Math.cos(angle[i]) * half;
      const dy = Math.sin(angle[i]) * half;
      ctx.moveTo(baseX[i] - dx, baseY[i] - dy);
      ctx.lineTo(baseX[i] + dx, baseY[i] + dy);
    };

    const draw = () => {
      ctx.clearRect(0, 0, width, height);
      ctx.lineWidth = WIDTH;
      ctx.lineCap = "round";
      // One batched path for the whole field; only the energised lines get
      // a second, brighter pass on top.
      ctx.strokeStyle = dim;
      ctx.beginPath();
      for (let i = 0; i < count; i++) segment(i);
      ctx.stroke();
      ctx.strokeStyle = lit;
      for (let i = 0; i < count; i++) {
        if (near[i] < 0.02) continue;
        ctx.globalAlpha = Math.min(1, near[i]);
        ctx.beginPath();
        segment(i);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    };

    const nearness = (i: number, p: Point) => {
      const d = Math.hypot(baseX[i] - p.x, baseY[i] - p.y);
      return Math.max(0, 1 - d / FIELD) ** 2;
    };

    // Reduced motion: every line turns to the pointer in one step, no swing.
    const orientOnce = (p: Point) => {
      for (let i = 0; i < count; i++) {
        angle[i] = Math.atan2(p.y - baseY[i], p.x - baseX[i]);
        near[i] = nearness(i, p);
      }
      draw();
    };

    const step = (now: number) => {
      // Clamped so a dropped frame can't kick the springs into orbit.
      const dt = Math.min((now - then) / 1000, 1 / 30);
      then = now;
      // The wave's own clock stops once idle, so its targets hold still, the
      // springs settle and the loop sleeps. Resuming picks up where it froze.
      const waving = !pointer && now - activeAt < IDLE_PAUSE;
      if (waving) waveT += dt;
      const t = waveT;
      let moving = waving;

      for (let i = 0; i < count; i++) {
        let target: number;
        let k: number;
        let n = 0;
        if (pointer) {
          target = Math.atan2(pointer.y - baseY[i], pointer.x - baseX[i]);
          const d = Math.hypot(baseX[i] - pointer.x, baseY[i] - pointer.y);
          k = STIFFNESS * (FAR_STIFFNESS + (1 - FAR_STIFFNESS) / (1 + d / HALF_PULL));
          n = nearness(i, pointer);
        } else {
          target = wave(i, t);
          k = WAVE_STIFFNESS;
        }
        const damping = 2 * DAMPING_RATIO * Math.sqrt(k);
        const delta = halfTurn(target - angle[i]);
        spin[i] += (k * delta - damping * spin[i]) * dt;
        angle[i] += spin[i] * dt;
        // A plain ease is enough for brightness; it only has to avoid popping.
        near[i] += (n - near[i]) * Math.min(1, dt * 12);

        if (
          Math.abs(delta) > REST ||
          Math.abs(spin[i]) > REST ||
          Math.abs(n - near[i]) > REST
        ) {
          moving = true;
        }
      }
      draw();
      // With the pointer resting, everything settles and the loop sleeps.
      // Without one, the idle wave runs for a while, but only on screen.
      frameId = moving && visible ? requestAnimationFrame(step) : 0;
    };

    const wake = () => {
      if (frameId || !visible || reduce) return;
      then = performance.now();
      frameId = requestAnimationFrame(step);
    };

    const aim = (e: PointerEvent) => {
      activeAt = performance.now();
      const box = canvas.getBoundingClientRect();
      const p = { x: e.clientX - box.left, y: e.clientY - box.top };
      last = p;
      if (reduce) {
        // One draw per frame at most; pointermove can fire far faster.
        if (!pending) {
          pending = requestAnimationFrame(() => {
            pending = 0;
            if (last) orientOnce(last);
          });
        }
        return;
      }
      pointer = p;
      wake();
    };

    const release = () => {
      // Reduced motion keeps the last orientation instead of drifting back.
      if (reduce) return;
      activeAt = performance.now();
      pointer = null;
      wake();
    };

    const onMove = (e: PointerEvent) => {
      // A finger only steers while pressed, which onDown captures.
      if (e.pointerType === "touch" && !canvas.hasPointerCapture(e.pointerId)) {
        return;
      }
      aim(e);
    };
    const onDown = (e: PointerEvent) => {
      if (e.pointerType !== "touch") return;
      canvas.setPointerCapture(e.pointerId);
      aim(e);
    };
    const onUp = (e: PointerEvent) => {
      if (e.pointerType === "touch") release();
    };
    const onLeave = (e: PointerEvent) => {
      if (e.pointerType !== "touch") release();
    };

    readColors();
    layout();
    if (reduce) waveT = 0;
    for (let i = 0; i < count; i++) angle[i] = wave(i, waveT);
    draw();
    wake();

    const resize = new ResizeObserver(() => {
      layout();
      if (reduce && last) orientOnce(last);
      else draw();
    });
    resize.observe(wrap);

    const repaint = () =>
      requestAnimationFrame(() => {
        readColors();
        if (!frameId) draw();
      });
    const theme = new MutationObserver(repaint);
    theme.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
    const scheme = window.matchMedia("(prefers-color-scheme: dark)");
    scheme.addEventListener("change", repaint);

    // Offscreen or in a hidden tab, the loop stops entirely, wave included.
    // Coming back counts as activity, so the wave plays again for a while.
    const sync = () => {
      const was = visible;
      visible = inView && !document.hidden;
      if (visible && !was) {
        activeAt = performance.now();
        wake();
      } else if (!visible && frameId) {
        cancelAnimationFrame(frameId);
        frameId = 0;
      }
    };
    const seen = new IntersectionObserver(([entry]) => {
      inView = entry.isIntersecting;
      sync();
    });
    seen.observe(wrap);
    document.addEventListener("visibilitychange", sync);

    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerdown", onDown);
    canvas.addEventListener("pointerup", onUp);
    canvas.addEventListener("pointercancel", onUp);
    canvas.addEventListener("pointerleave", onLeave);

    return () => {
      cancelAnimationFrame(frameId);
      cancelAnimationFrame(pending);
      resize.disconnect();
      theme.disconnect();
      seen.disconnect();
      document.removeEventListener("visibilitychange", sync);
      scheme.removeEventListener("change", repaint);
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointerup", onUp);
      canvas.removeEventListener("pointercancel", onUp);
      canvas.removeEventListener("pointerleave", onLeave);
    };
  }, [reduce]);

  return (
    <div
      ref={wrapRef}
      className={cn(
        "relative aspect-[4/3] w-[min(480px,100%)] overflow-hidden rounded-2xl bg-surface text-foreground shadow-raised",
        className,
      )}
    >
      {/* touch-none: while a finger is down it steers the field, so the page
          shouldn't scroll out from under it. */}
      <canvas
        ref={canvasRef}
        aria-hidden
        className="absolute inset-0 size-full touch-none text-muted"
      />
      <p className="sr-only">
        A decorative grid of short lines that turn to point at the pointer,
        like iron filings around a magnet, and drift in a slow wave when left
        alone.
      </p>
    </div>
  );
}

export default function MagnetLinesDemo() {
  return <MagnetLines />;
}
