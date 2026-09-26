import { useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import { usePreviewPlay } from "@/lab/preview-play";
import { useDrivenSeconds, useIsDriven } from "@/lib/progress";

export type PixelPattern = "spiral" | "snake" | "pulse" | "checker";

type Frames = number[][];

// Each pattern is a list of frames; a frame is the set of lit cell indexes.
// Frames only say what turns ON. Turning off is a slow fade (see the pixel classes), so
// any moving pattern leaves a short comet trail for free.
function buildPattern(pattern: PixelPattern, n: number): Frames {
  const cells = Array.from({ length: n * n }, (_, i) => i);
  const at = (r: number, c: number) => r * n + c;

  if (pattern === "spiral") {
    const order: number[] = [];
    let top = 0;
    let left = 0;
    let bottom = n - 1;
    let right = n - 1;
    while (top <= bottom && left <= right) {
      for (let c = left; c <= right; c++) order.push(at(top, c));
      for (let r = top + 1; r <= bottom; r++) order.push(at(r, right));
      if (top < bottom) for (let c = right - 1; c >= left; c--) order.push(at(bottom, c));
      if (left < right) for (let r = bottom - 1; r > top; r--) order.push(at(r, left));
      top++;
      left++;
      bottom--;
      right--;
    }
    // Winds in, then winds back out, so the loop never jumps.
    const there = order.map((cell) => [cell]);
    return [...there, ...there.slice(1, -1).reverse()];
  }

  if (pattern === "snake") {
    const order = cells.map((i) => {
      const r = Math.floor(i / n);
      const c = i % n;
      return at(r, r % 2 ? n - 1 - c : c);
    });
    // A two-cell body; the fade adds the tail.
    return order.map((cell, i) => (i ? [order[i - 1], cell] : [cell]));
  }

  if (pattern === "pulse") {
    const mid = (n - 1) / 2;
    const ring = (i: number) =>
      Math.floor(Math.max(Math.abs(Math.floor(i / n) - mid), Math.abs((i % n) - mid)));
    const rings = Math.floor(mid) + 1;
    const frames: Frames = [];
    for (let k = 0; k < rings; k++) frames.push(cells.filter((i) => ring(i) === k));
    // One dark beat so each ripple reads as its own breath.
    return [...frames, []];
  }

  // Checker: the two halves trade places twice.
  const even = cells.filter((i) => (Math.floor(i / n) + (i % n)) % 2 === 0);
  const odd = cells.filter((i) => (Math.floor(i / n) + (i % n)) % 2 === 1);
  return [even, odd, even, odd];
}

// A pixel check: short arm down, long arm up. On 3x3 the long arm has to turn
// upward in the last column, which still reads as a tick at this size.
const CHECKS: Record<number, number[]> = {
  3: [3, 7, 5, 2],
  4: [8, 13, 10, 7],
};

// ~110ms a step: fast enough to feel busy, slow enough that single pixels
// are still followable at 24px.
const STEP = 110;
// Every pattern plays for about the same time before handing over.
const PATTERN_MS = 1800;

export function PixelLoader({
  size = 3,
  patterns = ["spiral", "snake", "pulse", "checker"],
  done = false,
  shape = "square",
  label = "Loading",
  doneLabel = "Done",
  paused = false,
  className,
}: {
  size?: 3 | 4;
  patterns?: PixelPattern[];
  done?: boolean;
  shape?: "square" | "round";
  label?: string;
  doneLabel?: string;
  /** Holds one still frame instead of stepping. For pages that show many
   * loaders that aren't actually waiting on anything. */
  paused?: boolean;
  className?: string;
}) {
  const grid = useRef<HTMLSpanElement>(null);
  const driven = useIsDriven();
  const drivenSeconds = useDrivenSeconds();
  const key = patterns.join();
  const sequence = useMemo(
    () => key.split(",").map((p) => buildPattern(p as PixelPattern, size)),
    [key, size],
  );

  useEffect(() => {
    const el = grid.current;
    if (!el) return;
    const pixels = Array.from(el.children) as HTMLElement[];
    const light = (lit: Set<number>) => {
      pixels.forEach((p, i) => {
        p.dataset.on = String(lit.has(i));
      });
    };

    if (done) {
      const check = CHECKS[size];
      // Clears the grid first, then lays the check pixel by pixel in stroke
      // order through a per-pixel transition delay.
      pixels.forEach((p, i) => {
        const order = check.indexOf(i);
        p.style.transitionDelay = order < 0 ? "0ms" : `${120 + order * 55}ms`;
      });
      light(new Set(check));
      return;
    }

    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    // A diagonal stagger: when one pattern morphs into the next, the change
    // sweeps across the grid instead of every pixel flipping at once.
    pixels.forEach((p, i) => {
      p.style.transitionDelay = `${(Math.floor(i / size) + (i % size)) * 18}ms`;
    });

    let pattern = 0;
    let frame = 0;
    let elapsed = 0;
    let timer: ReturnType<typeof setInterval> | undefined;
    const tick = () => {
      const frames = sequence[pattern];
      light(new Set(frames[frame % frames.length]));
      frame++;
      elapsed += STEP;
      // Hands over only at the end of a loop, so no pattern is cut mid-shape.
      if (elapsed >= PATTERN_MS && frame % frames.length === 0) {
        pattern = (pattern + 1) % sequence.length;
        frame = 0;
        elapsed = 0;
      }
    };
    // Driven by a clock: the frame is computed from it, so a capture at 2.0s
    // always shows the same pixels. No interval, no observers, no drift.
    if (driven) {
      let step = Math.max(0, Math.floor(drivenSeconds * 1000 / STEP))
      for (let p = 0; p < sequence.length; p += 1) {
        const frames = sequence[p]
        const stepsInPattern = Math.max(frames.length, Math.ceil(PATTERN_MS / STEP))
        if (step < stepsInPattern) {
          light(new Set(frames[step % frames.length]))
          return
        }
        step -= stepsInPattern
      }
      light(new Set(sequence[0][0]))
      return
    }

    // A resting frame from the middle of the first pattern, so a paused
    // loader still looks like one mid-thought rather than a dim grid.
    if (paused) {
      frame = Math.floor(sequence[0].length / 3);
      tick();
      return;
    }

    const start = () => {
      if (timer) return;
      tick();
      // Reduced motion keeps the loader alive but slow and without scale.
      timer = setInterval(tick, reduce ? STEP * 4 : STEP);
    };
    const stop = () => {
      clearInterval(timer);
      timer = undefined;
    };

    // Stops stepping whenever it is off screen or the tab is hidden.
    let visible = false;
    const sync = () => (visible && !document.hidden ? start() : stop());
    const io = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      sync();
    });
    io.observe(el);
    document.addEventListener("visibilitychange", sync);
    return () => {
      stop();
      io.disconnect();
      document.removeEventListener("visibilitychange", sync);
    };
  }, [done, sequence, size, paused]);

  const cell = size === 3 ? 6 : 4.5;
  const gap = size === 3 ? 2 : 1.5;

  return (
    <span role="status" className={cn("relative inline-flex", className)}>
      <span
        ref={grid}
        aria-hidden
        className="grid"
        style={{
          gridTemplateColumns: `repeat(${size}, ${cell}px)`,
          gridAutoRows: `${cell}px`,
          gap: `${gap}px`,
        }}
      >
        {Array.from({ length: size * size }, (_, i) => (
          <span
            key={i}
            data-on="false"
            className={cn(
              "bg-foreground",
              shape === "round" ? "rounded-full" : "rounded-[1px]",
              // On is quick (90ms) so each step lands crisply; off fades over
              // 360ms, which is the trail. Longer than UI motion on purpose.
              "opacity-[0.12] scale-[0.8] transition-[opacity,scale] duration-[360ms] ease-out",
              "data-[on=true]:scale-100 data-[on=true]:opacity-100 data-[on=true]:duration-[90ms]",
              "motion-reduce:scale-100",
            )}
          />
        ))}
      </span>
      <span className="sr-only">{done ? doneLabel : label}</span>
    </span>
  );
}

export default function PixelLoaderDemo() {
  const [done, setDone] = useState(false);
  const play = usePreviewPlay();
  // In an index card the grids only step while the card is hovered.
  const paused = play === false;

  // Index preview: it loads for a beat, finishes with a check, then goes
  // back to loading, the way the Finish button plays it by hand.
  useEffect(() => {
    if (!play) return;
    let timer: ReturnType<typeof setTimeout>;
    const cycle = (next: boolean) => {
      setDone(next);
      // Holds the check long enough to read, then a calmer loading stretch.
      timer = setTimeout(() => cycle(!next), next ? 1800 : 2200);
    };
    timer = setTimeout(() => cycle(true), 700);
    return () => {
      clearTimeout(timer);
      setDone(false);
    };
  }, [play]);

  return (
    <div className="flex flex-col items-center gap-6">
      <div className="flex items-center gap-8">
        <PixelLoader done={done} paused={paused} />
        <PixelLoader done={done} paused={paused} size={4} patterns={["snake", "pulse", "spiral"]} />
        <PixelLoader done={done} paused={paused} shape="round" patterns={["pulse", "checker", "spiral"]} />
      </div>
      <button
        type="button"
        onClick={() => setDone((d) => !d)}
        className="h-8 rounded-full px-3 text-sm text-muted outline-hidden transition-[scale,color,background-color] duration-150 ease-out hover:bg-surface hover:text-foreground focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-foreground active:scale-[0.96]"
      >
        {done ? "Load again" : "Finish"}
      </button>
    </div>
  );
}
