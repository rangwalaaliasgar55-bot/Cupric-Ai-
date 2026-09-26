import { useEffect, useRef } from "react";
import { useReducedMotion } from "@/lib/use-reduced-motion";
import { cn } from "@/lib/cn";

// Sampling pitch in CSS px. Sized for about 1,500 particles in "LAB" at this
// canvas size: dense enough to read as letters, light enough for any phone.
const PITCH = 3.6;
const DOT = 1.15;
// Hard cap, so a long word can't balloon the loop.
const MAX_PARTICLES = 2400;
// The cursor pushes particles within this radius, hardest at the centre.
const FIELD = 64;
const PUSH = 6000;
// Home springs. A damping ratio of 0.7 lets letters overshoot a touch as they
// land, which reads as elastic instead of snapping into a grid.
const STIFFNESS = 120;
const DAMPING_RATIO = 0.7;
// Each particle's spring is varied by up to this share, so a reassembling
// word arrives as a swarm instead of one rigid scaling shape.
const JITTER = 0.35;
// Explosion speed range in px/s; a spread keeps the burst from being a ring.
const BURST_MIN = 500;
const BURST_MAX = 1600;
const REST = 0.05;
// Reduced motion: particles near the pointer fade to this instead of moving.
const DIM = 0.3;
const BANDS = 4;

function bandOf(alpha: number) {
  return Math.min(BANDS - 1, Math.floor(((alpha - DIM) / (1 - DIM)) * BANDS));
}

export function ParticleText({
  text = "LAB",
  className,
}: {
  text?: string;
  className?: string;
}) {
  const reduce = useReducedMotion() ?? false;
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!wrap || !canvas || !ctx) return;

    // Flat typed arrays keep the per-frame loop allocation free.
    let count = 0;
    let homeX = new Float32Array(0);
    let homeY = new Float32Array(0);
    let px = new Float32Array(0);
    let py = new Float32Array(0);
    let vx = new Float32Array(0);
    let vy = new Float32Array(0);
    let stiff = new Float32Array(0);
    let alpha = new Float32Array(0);

    let width = 0;
    let height = 0;
    let color = "";
    let pointer: { x: number; y: number } | null = null;
    let frameId = 0;
    let pending = 0;
    let then = 0;
    let inView = true;
    let visible = true;
    let alive = true;

    const readColor = () => {
      // Computed colors resolve light-dark(), which a raw custom property doesn't.
      color = getComputedStyle(canvas).color;
    };

    // Renders the word on an offscreen canvas at the device's pixel density
    // and keeps one particle per filled grid cell.
    const sample = () => {
      const dpr = window.devicePixelRatio || 1;
      const off = document.createElement("canvas");
      off.width = Math.round(width * dpr);
      off.height = Math.round(height * dpr);
      const o = off.getContext("2d", { willReadFrequently: true });
      if (!o || !off.width || !off.height) return;
      const family = getComputedStyle(wrap).fontFamily;
      o.scale(dpr, dpr);
      o.font = `700 100px ${family}`;
      // Fit the word to 86% of the width and 80% of the height.
      const measured = o.measureText(text).width || 1;
      const size = Math.min((width * 0.86 * 100) / measured, height * 0.8);
      o.font = `700 ${size}px ${family}`;
      o.textAlign = "center";
      o.textBaseline = "middle";
      o.letterSpacing = `${-size * 0.02}px`;
      o.fillText(text, width / 2, height / 2 + size * 0.04);
      const data = o.getImageData(0, 0, off.width, off.height).data;

      const xs: number[] = [];
      const ys: number[] = [];
      let pitch = PITCH;
      // Wider pitch until it fits the cap; one pass for short words.
      for (;;) {
        xs.length = 0;
        ys.length = 0;
        for (let y = pitch / 2; y < height; y += pitch) {
          for (let x = pitch / 2; x < width; x += pitch) {
            const i = (Math.round(y * dpr) * off.width + Math.round(x * dpr)) * 4;
            if (data[i + 3] > 128) {
              xs.push(x);
              ys.push(y);
            }
          }
        }
        if (xs.length <= MAX_PARTICLES) break;
        pitch *= 1.15;
      }

      const next = xs.length;
      const keep = Math.min(count, next);
      const nx = new Float32Array(next);
      const ny = new Float32Array(next);
      const nvx = new Float32Array(next);
      const nvy = new Float32Array(next);
      // Existing particles keep their position and fly to their new home;
      // new ones start at home so a first paint is already the word.
      for (let i = 0; i < next; i++) {
        nx[i] = i < keep ? px[i] : xs[i];
        ny[i] = i < keep ? py[i] : ys[i];
        nvx[i] = i < keep ? vx[i] : 0;
        nvy[i] = i < keep ? vy[i] : 0;
      }
      homeX = Float32Array.from(xs);
      homeY = Float32Array.from(ys);
      px = nx;
      py = ny;
      vx = nvx;
      vy = nvy;
      stiff = new Float32Array(next);
      alpha = new Float32Array(next).fill(1);
      for (let i = 0; i < next; i++) {
        stiff[i] = STIFFNESS * (1 - JITTER + Math.random() * JITTER * 2);
      }
      count = next;
    };

    const layout = () => {
      const dpr = window.devicePixelRatio || 1;
      width = wrap.clientWidth;
      height = wrap.clientHeight;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      sample();
    };

    const draw = () => {
      ctx.clearRect(0, 0, width, height);
      ctx.fillStyle = color;
      if (reduce) {
        // Grouped into four alpha bands, so it's still four fills, not 1,500.
        for (let band = 0; band < BANDS; band++) {
          ctx.globalAlpha = DIM + ((1 - DIM) * (band + 1)) / BANDS;
          ctx.beginPath();
          for (let i = 0; i < count; i++) {
            if (bandOf(alpha[i]) !== band) continue;
            ctx.moveTo(px[i] + DOT, py[i]);
            ctx.arc(px[i], py[i], DOT, 0, Math.PI * 2);
          }
          ctx.fill();
        }
        ctx.globalAlpha = 1;
        return;
      }
      // One batched path for the whole word.
      ctx.beginPath();
      for (let i = 0; i < count; i++) {
        ctx.moveTo(px[i] + DOT, py[i]);
        ctx.arc(px[i], py[i], DOT, 0, Math.PI * 2);
      }
      ctx.fill();
    };

    const step = (now: number) => {
      // Clamped so a dropped frame can't kick the springs into orbit.
      const dt = Math.min((now - then) / 1000, 1 / 30);
      then = now;
      let moving = false;
      const p = pointer;
      for (let i = 0; i < count; i++) {
        const k = stiff[i];
        const c = 2 * DAMPING_RATIO * Math.sqrt(k);
        let ax = k * (homeX[i] - px[i]) - c * vx[i];
        let ay = k * (homeY[i] - py[i]) - c * vy[i];
        if (p) {
          const dx = px[i] - p.x;
          const dy = py[i] - p.y;
          const d2 = dx * dx + dy * dy;
          if (d2 < FIELD * FIELD && d2 > 0.01) {
            const d = Math.sqrt(d2);
            // Squared falloff: a soft edge, a firm centre.
            const f = PUSH * (1 - d / FIELD) ** 2;
            ax += (dx / d) * f;
            ay += (dy / d) * f;
          }
        }
        vx[i] += ax * dt;
        vy[i] += ay * dt;
        px[i] += vx[i] * dt;
        py[i] += vy[i] * dt;
        // With a cursor resting inside, pushed particles settle into balance
        // away from home, so only speed counts; without one, they must be home.
        if (
          !moving &&
          (Math.abs(vx[i]) > REST ||
            Math.abs(vy[i]) > REST ||
            (!p &&
              (Math.abs(homeX[i] - px[i]) > REST ||
                Math.abs(homeY[i] - py[i]) > REST)))
        ) {
          moving = true;
        }
      }
      draw();
      // Sleeps once everything is still, and wakes on the next pointer event.
      frameId = moving && visible ? requestAnimationFrame(step) : 0;
    };

    const wake = () => {
      if (frameId || !visible || reduce || !alive) return;
      then = performance.now();
      frameId = requestAnimationFrame(step);
    };

    // Reduced motion: nothing moves; particles near the pointer fade a little.
    const fade = () => {
      for (let i = 0; i < count; i++) {
        let a = 1;
        if (pointer) {
          const d = Math.hypot(px[i] - pointer.x, py[i] - pointer.y);
          a = d < FIELD ? DIM + (1 - DIM) * (d / FIELD) : 1;
        }
        alpha[i] = a;
      }
      draw();
    };
    const fadeSoon = () => {
      if (pending) return;
      // One draw per frame at most; pointermove can fire far faster.
      pending = requestAnimationFrame(() => {
        pending = 0;
        fade();
      });
    };

    const aim = (e: PointerEvent) => {
      const box = canvas.getBoundingClientRect();
      pointer = { x: e.clientX - box.left, y: e.clientY - box.top };
      if (reduce) fadeSoon();
      else wake();
    };
    const release = () => {
      pointer = null;
      if (reduce) fadeSoon();
      else wake();
    };

    const burst = (e: MouseEvent) => {
      if (reduce) return;
      const box = canvas.getBoundingClientRect();
      const cx = e.clientX - box.left;
      const cy = e.clientY - box.top;
      for (let i = 0; i < count; i++) {
        const dx = px[i] - cx;
        const dy = py[i] - cy;
        const d = Math.hypot(dx, dy) || 1;
        // Added to the current velocity, so a second click mid-burst adds
        // energy instead of resetting it.
        const speed = BURST_MIN + Math.random() * (BURST_MAX - BURST_MIN);
        // A little sideways scatter keeps it from looking like a clean ring.
        const spread = (Math.random() - 0.5) * 0.6;
        vx[i] += ((dx / d) * Math.cos(spread) - (dy / d) * Math.sin(spread)) * speed;
        vy[i] += ((dx / d) * Math.sin(spread) + (dy / d) * Math.cos(spread)) * speed;
      }
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
      if (e.pointerType === "touch") {
        canvas.setPointerCapture(e.pointerId);
        aim(e);
      }
    };
    const onUp = (e: PointerEvent) => {
      if (e.pointerType === "touch") release();
    };
    const onLeave = (e: PointerEvent) => {
      if (e.pointerType !== "touch") release();
    };

    readColor();
    layout();
    draw();
    // The word is sampled from the page font; resample once it has loaded,
    // or the first paint would be the fallback face.
    document.fonts.ready.then(() => {
      if (!alive) return;
      layout();
      if (reduce) fade();
      else wake();
      if (!frameId) draw();
    });

    const resize = new ResizeObserver(() => {
      layout();
      if (reduce) fade();
      else wake();
      if (!frameId) draw();
    });
    resize.observe(wrap);

    // Zooming changes the pixel ratio without resizing the box.
    let dprQuery: MediaQueryList | null = null;
    const onDpr = () => {
      layout();
      draw();
      watchDpr();
    };
    const watchDpr = () => {
      dprQuery?.removeEventListener("change", onDpr);
      dprQuery = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
      dprQuery.addEventListener("change", onDpr);
    };
    watchDpr();

    const repaint = () =>
      requestAnimationFrame(() => {
        readColor();
        if (!frameId) draw();
      });
    const theme = new MutationObserver(repaint);
    theme.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
    const scheme = window.matchMedia("(prefers-color-scheme: dark)");
    scheme.addEventListener("change", repaint);

    // Offscreen or in a hidden tab, the loop stops entirely.
    const sync = () => {
      const was = visible;
      visible = inView && !document.hidden;
      if (visible && !was) wake();
      else if (!visible && frameId) {
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
    canvas.addEventListener("click", burst);

    return () => {
      alive = false;
      cancelAnimationFrame(frameId);
      cancelAnimationFrame(pending);
      resize.disconnect();
      theme.disconnect();
      seen.disconnect();
      dprQuery?.removeEventListener("change", onDpr);
      document.removeEventListener("visibilitychange", sync);
      scheme.removeEventListener("change", repaint);
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointerup", onUp);
      canvas.removeEventListener("pointercancel", onUp);
      canvas.removeEventListener("pointerleave", onLeave);
      canvas.removeEventListener("click", burst);
    };
  }, [reduce, text]);

  return (
    <div
      ref={wrapRef}
      className={cn(
        "relative h-[240px] w-[min(520px,100%)] overflow-hidden rounded-2xl bg-surface font-sans shadow-raised",
        className,
      )}
    >
      {/* touch-none: while a finger is down it scatters the word, so the page
          shouldn't scroll out from under it. */}
      <canvas
        ref={canvasRef}
        aria-hidden
        className="absolute inset-0 size-full cursor-pointer touch-none text-foreground"
      />
      <span className="sr-only">{text}</span>
    </div>
  );
}

export default function ParticleTextDemo() {
  return <ParticleText />;
}
