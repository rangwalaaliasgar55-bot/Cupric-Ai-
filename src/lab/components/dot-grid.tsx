import { useEffect, useRef } from "react";
import { useReducedMotion } from "@/lib/use-reduced-motion";
import { cn } from "@/lib/cn";

const SPACING = 16;
const DOT = 1.5;
// Dots within this radius feel the cursor; falloff is quadratic to the edge.
const FIELD = 88;
// Far enough to read as a push, small enough that neighbours never overlap.
const PUSH = 7;
const GROW = 1.3;
// Slightly underdamped (ratio about 0.7), so dots spring back with a hint of
// give instead of sliding home.
const STIFFNESS = 170;
const DAMPING = 18;
// A click ring crosses the 480px grid in about 0.9s.
const RING_SPEED = 620;
const RING_WIDTH = 22;
const RING_PUSH = 9;
const REST = 0.01;

type Ring = { x: number; y: number; born: number };

export function DotGrid({ className }: { className?: string }) {
  const reduce = useReducedMotion() ?? false;
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!wrap || !canvas || !ctx) return;

    let width = 0;
    let height = 0;
    let count = 0;
    // Flat typed arrays keep the per-frame loop allocation free.
    let baseX = new Float32Array(0);
    let baseY = new Float32Array(0);
    let offX = new Float32Array(0);
    let offY = new Float32Array(0);
    let velX = new Float32Array(0);
    let velY = new Float32Array(0);
    let size = new Float32Array(0);
    let velSize = new Float32Array(0);

    let pointer: { x: number; y: number } | null = null;
    let rings: Ring[] = [];
    let frameId = 0;
    let last = 0;
    let visible = true;
    let dim = "";
    let lit = "";

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

      const cols = Math.floor(width / SPACING);
      const rows = Math.floor(height / SPACING);
      // Centre the lattice so the margins match on every side.
      const startX = (width - (cols - 1) * SPACING) / 2;
      const startY = (height - (rows - 1) * SPACING) / 2;
      count = cols * rows;
      baseX = new Float32Array(count);
      baseY = new Float32Array(count);
      offX = new Float32Array(count);
      offY = new Float32Array(count);
      velX = new Float32Array(count);
      velY = new Float32Array(count);
      size = new Float32Array(count);
      velSize = new Float32Array(count);
      for (let r = 0, i = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++, i++) {
          baseX[i] = startX + c * SPACING;
          baseY[i] = startY + r * SPACING;
        }
      }
    };

    const draw = () => {
      ctx.clearRect(0, 0, width, height);
      ctx.fillStyle = dim;
      // Resting dots sit back as texture; the lit pass supplies the contrast.
      ctx.globalAlpha = 0.5;
      ctx.beginPath();
      for (let i = 0; i < count; i++) {
        const x = baseX[i] + offX[i];
        const y = baseY[i] + offY[i];
        const r = DOT * (1 + (reduce ? 0 : GROW) * size[i]);
        ctx.moveTo(x + r, y);
        ctx.arc(x, y, r, 0, Math.PI * 2);
      }
      ctx.fill();
      // Only the few energised dots get a second, brighter pass.
      ctx.fillStyle = lit;
      for (let i = 0; i < count; i++) {
        const s = size[i];
        if (s < 0.02) continue;
        const x = baseX[i] + offX[i];
        const y = baseY[i] + offY[i];
        const r = DOT * (1 + (reduce ? 0 : GROW) * s);
        ctx.globalAlpha = Math.min(1, s);
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    };

    const step = (now: number) => {
      // Clamped so a dropped frame or a background tab can't explode the spring.
      const dt = Math.min((now - last) / 1000, 1 / 30);
      last = now;
      const t = now / 1000;
      rings = rings.filter(
        (ring) => (t - ring.born) * RING_SPEED < Math.hypot(width, height) + RING_WIDTH,
      );

      let moving = rings.length > 0;
      for (let i = 0; i < count; i++) {
        let targetX = 0;
        let targetY = 0;
        let targetSize = 0;
        if (pointer) {
          const dx = baseX[i] - pointer.x;
          const dy = baseY[i] - pointer.y;
          const d = Math.hypot(dx, dy);
          if (d < FIELD) {
            const f = (1 - d / FIELD) ** 2;
            targetSize = f;
            if (!reduce && d > 0.001) {
              targetX = (dx / d) * PUSH * f;
              targetY = (dy / d) * PUSH * f;
            }
          }
        }
        for (const ring of rings) {
          const dx = baseX[i] - ring.x;
          const dy = baseY[i] - ring.y;
          const d = Math.hypot(dx, dy);
          const radius = (t - ring.born) * RING_SPEED;
          const band = Math.exp(-(((d - radius) / RING_WIDTH) ** 2));
          // The ring weakens as it spreads, like a real shockwave.
          const fade = Math.max(0, 1 - radius / Math.hypot(width, height));
          const f = band * fade;
          if (f < 0.01 || d < 0.001) continue;
          targetX += (dx / d) * RING_PUSH * f;
          targetY += (dy / d) * RING_PUSH * f;
          targetSize = Math.max(targetSize, f);
        }

        velX[i] += (STIFFNESS * (targetX - offX[i]) - DAMPING * velX[i]) * dt;
        velY[i] += (STIFFNESS * (targetY - offY[i]) - DAMPING * velY[i]) * dt;
        velSize[i] += (STIFFNESS * (targetSize - size[i]) - DAMPING * velSize[i]) * dt;
        offX[i] += velX[i] * dt;
        offY[i] += velY[i] * dt;
        size[i] = Math.max(0, size[i] + velSize[i] * dt);

        // Settled means at its target, not at home: a resting cursor costs nothing.
        if (
          Math.abs(targetX - offX[i]) > REST ||
          Math.abs(targetY - offY[i]) > REST ||
          Math.abs(targetSize - size[i]) > REST ||
          Math.abs(velX[i]) > REST ||
          Math.abs(velY[i]) > REST ||
          Math.abs(velSize[i]) > REST
        ) {
          moving = true;
        }
      }
      draw();
      frameId = moving && visible ? requestAnimationFrame(step) : 0;
    };

    // Sleeps when everything settles; any input wakes it.
    const wake = () => {
      if (frameId || !visible) return;
      last = performance.now();
      frameId = requestAnimationFrame(step);
    };

    const local = (e: PointerEvent) => {
      const box = canvas.getBoundingClientRect();
      return { x: e.clientX - box.left, y: e.clientY - box.top };
    };

    const onMove = (e: PointerEvent) => {
      if (e.pointerType === "touch") return;
      pointer = local(e);
      wake();
    };
    const onLeave = () => {
      pointer = null;
      wake();
    };
    const onDown = (e: PointerEvent) => {
      if (reduce || e.button !== 0) return;
      // Three rings at once is already a lot; older ones make way.
      rings = [...rings.slice(-2), { ...local(e), born: performance.now() / 1000 }];
      wake();
    };

    readColors();
    layout();
    draw();

    const resize = new ResizeObserver(() => {
      layout();
      draw();
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

    // Offscreen, the loop pauses entirely.
    const seen = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      if (visible) wake();
      else if (frameId) {
        cancelAnimationFrame(frameId);
        frameId = 0;
      }
    });
    seen.observe(wrap);

    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerleave", onLeave);
    canvas.addEventListener("pointerdown", onDown);

    return () => {
      cancelAnimationFrame(frameId);
      resize.disconnect();
      theme.disconnect();
      seen.disconnect();
      scheme.removeEventListener("change", repaint);
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerleave", onLeave);
      canvas.removeEventListener("pointerdown", onDown);
    };
  }, [reduce]);

  return (
    <div
      ref={wrapRef}
      className={cn(
        "relative aspect-[3/2] w-[min(480px,100%)] overflow-hidden rounded-2xl bg-surface text-foreground shadow-raised",
        className,
      )}
    >
      <canvas
        ref={canvasRef}
        aria-hidden
        className="absolute inset-0 size-full touch-manipulation text-muted"
      />
      <p className="sr-only">
        A decorative grid of dots that swell and move away from the pointer.
        Clicking sends a ring outward through the grid.
      </p>
    </div>
  );
}

export default function DotGridDemo() {
  return <DotGrid />;
}
