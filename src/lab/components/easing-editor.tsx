import { useEffect, useId, useRef, useState } from "react";
import { motion } from "motion/react";
import { useReducedMotion } from "@/lib/use-reduced-motion";
import { cn } from "@/lib/cn";

type Curve = [number, number, number, number];

// The graph shows a little time either side of 0..1 so the end handles
// never sit on the edge, and progress from -0.5 to 1.5 so curves that
// dip below the start (anticipation) or pass the end (overshoot) fit.
const T_MIN = -0.1;
const T_MAX = 1.1;
const P_MIN = -0.5;
const P_MAX = 1.5;
const SIZE = 280;
// The pause at each end of the loop, so every run starts from stillness
// and you can compare how it arrives.
const HOLD = 700;
const DURATIONS = [300, 600, 1000];
const STEP = 0.01;
const BIG_STEP = 0.1;
const ICON_SWAP = { type: "spring", duration: 0.3, bounce: 0 } as const;

const PRESETS: { name: string; curve: Curve; use: string }[] = [
  {
    name: "ease-out",
    curve: [0.23, 1, 0.32, 1],
    use: "Things entering or answering a click: dropdowns, toasts, modals. The fast start feels instant.",
  },
  {
    name: "ease-in-out",
    curve: [0.77, 0, 0.175, 1],
    use: "Something already on screen moving to a new place. Speeds up, then settles.",
  },
  {
    name: "iOS drawer",
    curve: [0.32, 0.72, 0, 1],
    use: "Sheets and drawers sliding in. An iOS-like curve from the Ionic Framework.",
  },
  {
    name: "ease",
    curve: [0.25, 0.1, 0.25, 1],
    use: "The CSS default. Fine for hover and color changes, too soft for movement.",
  },
  {
    name: "linear",
    curve: [0, 0, 1, 1],
    use: "Constant motion only: progress bars, marquees, spinners. Movement looks mechanical.",
  },
  {
    name: "overshoot",
    curve: [0.34, 1.56, 0.64, 1],
    use: "Passes the target, then eases back. Playful, but a spring usually does it better.",
  },
];

const X = (t: number) => ((t - T_MIN) / (T_MAX - T_MIN)) * SIZE;
const Y = (p: number) => ((P_MAX - p) / (P_MAX - P_MIN)) * SIZE;
const pct = (v: number) => `${(v / SIZE) * 100}%`;

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

// Up to 3 decimals, trailing zeros dropped: 0.175 stays, 1.00 becomes 1.
function num(v: number) {
  return Number(v.toFixed(3)).toString();
}

function toCss(c: Curve) {
  return `cubic-bezier(${c.map(num).join(", ")})`;
}

// Builds one loop: out, hold, back, hold. Offsets come from real times so
// the hold stays the same length whatever the duration.
function timeline(duration: number) {
  const total = duration * 2 + HOLD * 2;
  return {
    total,
    arrive: duration / total,
    leave: (duration + HOLD) / total,
    back: (duration * 2 + HOLD) / total,
  };
}

function travelFrames(curve: string, duration: number, from: string, to: string): Keyframe[] {
  const t = timeline(duration);
  return [
    { transform: from, offset: 0, easing: curve },
    { transform: to, offset: t.arrive },
    { transform: to, offset: t.leave, easing: curve },
    { transform: from, offset: t.back },
    { transform: from, offset: 1 },
  ];
}

// The graph's tracer only draws the outbound run, since the return trip
// isn't the plotted curve. It rewinds while faded out.
function tracerFrames(
  curve: string,
  duration: number,
  axis: "X" | "Y",
): Keyframe[] {
  const t = timeline(duration);
  const end = axis === "X" ? "translateX(100%)" : "translateY(-100%)";
  const start = axis === "X" ? "translateX(0%)" : "translateY(0%)";
  const rewind = (t.back + 1) / 2;
  return [
    { transform: start, offset: 0, easing: axis === "X" ? "linear" : curve },
    { transform: end, offset: t.arrive },
    { transform: end, offset: rewind },
    { transform: start, offset: rewind },
    { transform: start, offset: 1 },
  ];
}

function fadeFrames(duration: number): Keyframe[] {
  const t = timeline(duration);
  const rewind = (t.back + 1) / 2;
  return [
    { opacity: 1, offset: 0 },
    { opacity: 1, offset: t.leave },
    { opacity: 0, offset: Math.min(t.leave + 0.05, rewind) },
    { opacity: 0, offset: rewind },
    { opacity: 1, offset: 1 },
  ];
}

export function EasingEditor({
  initial = PRESETS[0].curve,
  className,
}: {
  initial?: Curve;
  className?: string;
}) {
  const reduceMotion = useReducedMotion();
  const [curve, setCurve] = useState<Curve>(initial);
  const [duration, setDuration] = useState(DURATIONS[1]);
  const css = toCss(curve);

  const rootRef = useRef<HTMLDivElement>(null);
  const graphRef = useRef<HTMLDivElement>(null);
  const dotRef = useRef<HTMLDivElement>(null);
  const squareRef = useRef<HTMLDivElement>(null);
  const tracerXRef = useRef<HTMLDivElement>(null);
  const tracerYRef = useRef<HTMLDivElement>(null);
  const tracerDotRef = useRef<HTMLDivElement>(null);
  const anims = useRef<{ eased: Animation[]; all: Animation[] }>({ eased: [], all: [] });
  const visible = useRef(true);
  const cssRef = useRef(css);
  const dragging = useRef<0 | 1 | null>(null);
  const hintId = useId();

  // WAAPI rather than Motion: it runs off the main thread and takes the
  // cubic-bezier string exactly as CSS would, overshoot included.
  useEffect(() => {
    const els = [dotRef, squareRef, tracerXRef, tracerYRef, tracerDotRef].map((r) => r.current);
    if (els.some((el) => !el)) return;
    const [dot, square, tx, ty, tdot] = els as HTMLElement[];
    const { total } = timeline(duration);
    const timing = { duration: total, iterations: Infinity };
    const c = cssRef.current;
    const eased = [
      dot.animate(travelFrames(c, duration, "translateX(0%)", "translateX(100%)"), timing),
      square.animate(travelFrames(c, duration, "scale(0.5)", "scale(1)"), timing),
      ty.animate(tracerFrames(c, duration, "Y"), timing),
    ];
    const all = [
      ...eased,
      tx.animate(tracerFrames(c, duration, "X"), timing),
      tdot.animate(fadeFrames(duration), timing),
    ];
    anims.current = { eased, all };
    return () => all.forEach((a) => a.cancel());
  }, [duration]);

  // A new curve swaps the keyframes in place, so the loop keeps its time
  // instead of restarting on every drag frame.
  useEffect(() => {
    cssRef.current = css;
    const [dot, square, ty] = anims.current.eased;
    if (!dot) return;
    (dot.effect as KeyframeEffect).setKeyframes(
      travelFrames(css, duration, "translateX(0%)", "translateX(100%)"),
    );
    (square.effect as KeyframeEffect).setKeyframes(
      travelFrames(css, duration, "scale(0.5)", "scale(1)"),
    );
    (ty.effect as KeyframeEffect).setKeyframes(tracerFrames(css, duration, "Y"));
  }, [css, duration]);

  // Reduced motion starts paused; Play is still one press away.
  const [override, setOverride] = useState<boolean | null>(null);
  const isPaused = override ?? !!reduceMotion;

  useEffect(() => {
    const sync = () => {
      anims.current.all.forEach((a) =>
        isPaused || !visible.current ? a.pause() : a.play(),
      );
    };
    sync();
    // Nothing loops while scrolled out of view.
    const el = rootRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(([entry]) => {
      visible.current = entry.isIntersecting;
      sync();
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [isPaused, duration]);

  const moveTo = (index: 0 | 1, clientX: number, clientY: number) => {
    const box = graphRef.current?.getBoundingClientRect();
    if (!box) return;
    const t = T_MIN + ((clientX - box.left) / box.width) * (T_MAX - T_MIN);
    const p = P_MAX - ((clientY - box.top) / box.height) * (P_MAX - P_MIN);
    set(index, t, p);
  };

  const set = (index: 0 | 1, t: number, p: number) => {
    // CSS rejects x outside 0..1, so time is clamped; progress may overshoot.
    const nx = Math.round(clamp(t, 0, 1) / STEP) * STEP;
    const ny = Math.round(clamp(p, P_MIN, P_MAX) / STEP) * STEP;
    setCurve((c) => {
      const next = [...c] as Curve;
      next[index * 2] = Number(nx.toFixed(3));
      next[index * 2 + 1] = Number(ny.toFixed(3));
      return next;
    });
  };

  const active = PRESETS.find((p) => p.curve.every((v, i) => v === curve[i]));
  const points: [number, number][] = [
    [curve[0], curve[1]],
    [curve[2], curve[3]],
  ];

  return (
    <div
      ref={rootRef}
      className={cn(
        // 12px panels plus 8px of padding keep the corners concentric.
        "flex w-[min(560px,100%)] flex-col gap-2 rounded-[20px] bg-surface p-2 text-foreground shadow-raised",
        className,
      )}
    >
      <section
        aria-label="Curve editor"
        className="flex flex-wrap items-start gap-5 rounded-xl bg-background p-3.5"
      >
        <div className="flex w-[min(280px,100%)] flex-col gap-2">
          <div ref={graphRef} className="relative aspect-square w-full select-none">
            <svg viewBox={`0 0 ${SIZE} ${SIZE}`} className="absolute inset-0 size-full overflow-visible" aria-hidden>
              <rect x={X(0)} y={Y(1)} width={X(1) - X(0)} height={Y(0) - Y(1)} className="fill-surface" rx={4} />
              {[0.25, 0.5, 0.75].map((v) => (
                <g key={v} className="stroke-border">
                  <line x1={X(v)} x2={X(v)} y1={Y(1)} y2={Y(0)} />
                  <line x1={X(0)} x2={X(1)} y1={Y(v)} y2={Y(v)} />
                </g>
              ))}
              <text x={X(0)} y={Y(1) - 6} className="fill-muted text-[12px]">
                progress
              </text>
              <text x={X(1)} y={Y(0) + 16} textAnchor="end" className="fill-muted text-[12px]">
                time
              </text>
              <text x={X(1)} y={Y(1.5) + 14} textAnchor="end" className="fill-muted text-[12px]">
                overshoot
              </text>
              <text x={X(1)} y={Y(-0.5) - 6} textAnchor="end" className="fill-muted text-[12px]">
                anticipation
              </text>
              {/* Linear, for reference: anything above it is ahead of schedule. */}
              <line x1={X(0)} y1={Y(0)} x2={X(1)} y2={Y(1)} className="stroke-muted/60" strokeDasharray="3 4" />
              <line x1={X(0)} y1={Y(0)} x2={X(curve[0])} y2={Y(curve[1])} className="stroke-muted" strokeWidth={1.5} />
              <line x1={X(1)} y1={Y(1)} x2={X(curve[2])} y2={Y(curve[3])} className="stroke-muted" strokeWidth={1.5} />
              <path
                d={`M${X(0)},${Y(0)} C${X(curve[0])},${Y(curve[1])} ${X(curve[2])},${Y(curve[3])} ${X(1)},${Y(1)}`}
                fill="none"
                className="stroke-foreground"
                strokeWidth={2.5}
                strokeLinecap="round"
              />
              <circle cx={X(0)} cy={Y(0)} r={3} className="fill-foreground" />
              <circle cx={X(1)} cy={Y(1)} r={3} className="fill-foreground" />
            </svg>

            {/* A dot that rides the curve: it moves across at a steady rate
                (time) while rising with the easing (progress). */}
            <div
              aria-hidden
              className="pointer-events-none absolute"
              style={{ left: pct(X(0)), top: pct(Y(1)), width: pct(X(1) - X(0)), height: pct(Y(0) - Y(1)) }}
            >
              <div ref={tracerXRef} className="absolute inset-0">
                <div ref={tracerYRef} className="absolute top-0 left-0 h-full w-0">
                  <div
                    ref={tracerDotRef}
                    className="absolute bottom-0 left-0 size-2.5 -translate-x-1/2 translate-y-1/2 rounded-full bg-foreground ring-2 ring-background"
                  />
                </div>
              </div>
            </div>

            {points.map(([t, p], i) => (
              <button
                key={i}
                type="button"
                aria-label={`Control point ${i + 1}: time ${num(t)}, progress ${num(p)}`}
                aria-describedby={hintId}
                className="absolute size-4 -translate-x-1/2 -translate-y-1/2 cursor-grab touch-none rounded-full border-2 border-foreground bg-background outline-hidden transition-[scale] duration-150 ease-out after:absolute after:-inset-3 after:rounded-full focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-foreground active:scale-[1.1] active:cursor-grabbing motion-reduce:transition-none"
                style={{ left: pct(X(t)), top: pct(Y(p)) }}
                onPointerDown={(e) => {
                  if (e.button !== 0 || dragging.current !== null) return;
                  e.currentTarget.setPointerCapture(e.pointerId);
                  dragging.current = i as 0 | 1;
                }}
                onPointerMove={(e) => {
                  if (dragging.current === i) moveTo(i as 0 | 1, e.clientX, e.clientY);
                }}
                onPointerUp={() => {
                  dragging.current = null;
                }}
                onPointerCancel={() => {
                  dragging.current = null;
                }}
                onKeyDown={(e) => {
                  const step = e.shiftKey ? BIG_STEP : STEP;
                  const delta = {
                    ArrowLeft: [-step, 0],
                    ArrowRight: [step, 0],
                    ArrowUp: [0, step],
                    ArrowDown: [0, -step],
                  }[e.key];
                  if (!delta) return;
                  e.preventDefault();
                  set(i as 0 | 1, t + delta[0], p + delta[1]);
                }}
              />
            ))}
          </div>
          <p id={hintId} className="text-xs leading-4 text-muted">
            Drag a handle. Arrow keys nudge, Shift more.
          </p>
        </div>

        <div className="flex min-w-[200px] flex-1 flex-col gap-4">
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-medium">Preview</span>
            <button
              type="button"
              aria-label={isPaused ? "Play preview" : "Pause preview"}
              onClick={() => setOverride(!isPaused)}
              className="relative flex size-8 items-center justify-center rounded-full text-muted outline-hidden transition-[scale,color,background-color] duration-150 ease-out after:absolute after:-inset-1 hover:bg-surface hover:text-foreground focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-foreground active:scale-[0.96]"
            >
              <span className="grid" aria-hidden>
                <SwapIcon visible={isPaused} reduceMotion={reduceMotion}>
                  {/* Shifted right: a triangle's visual center sits left of its box. */}
                  <path d="M5.5 3.6v8.8a.6.6 0 0 0 .9.5l7-4.4a.6.6 0 0 0 0-1l-7-4.4a.6.6 0 0 0-.9.5Z" fill="currentColor" stroke="none" />
                </SwapIcon>
                <SwapIcon visible={!isPaused} reduceMotion={reduceMotion}>
                  <path d="M5.5 3.5v9M10.5 3.5v9" strokeWidth={2} />
                </SwapIcon>
              </span>
            </button>
          </div>

          <div className="rounded-full bg-surface p-1">
            <div className="relative h-8">
              {/* Travel is the track minus the dot, so translateX(100%) of
                  this box lands the dot exactly on the far end. */}
              <div ref={dotRef} className="absolute inset-y-0 left-0 w-[calc(100%-32px)] will-change-transform">
                <div className="size-8 rounded-full bg-foreground" />
              </div>
            </div>
          </div>

          <div className="flex h-28 items-center justify-center rounded-xl bg-surface">
            <div className="relative grid size-16 place-items-center">
              <div aria-hidden className="absolute inset-0 rounded-[14px] border border-dashed border-muted/50" />
              <div ref={squareRef} className="size-16 rounded-[14px] bg-foreground will-change-transform" />
            </div>
          </div>

          <div
            role="radiogroup"
            aria-label="Preview duration"
            className="grid grid-cols-3 gap-1 rounded-full bg-surface p-1"
            onKeyDown={(e) => {
              const dir = { ArrowLeft: -1, ArrowUp: -1, ArrowRight: 1, ArrowDown: 1 }[e.key];
              if (!dir) return;
              e.preventDefault();
              const i = DURATIONS.indexOf(duration);
              const next = DURATIONS[(i + dir + DURATIONS.length) % DURATIONS.length];
              setDuration(next);
              e.currentTarget.querySelector<HTMLElement>(`[data-duration="${next}"]`)?.focus();
            }}
          >
            {DURATIONS.map((d) => (
              <button
                key={d}
                type="button"
                role="radio"
                data-duration={d}
                aria-checked={duration === d}
                tabIndex={duration === d ? 0 : -1}
                onClick={() => setDuration(d)}
                className={cn(
                  "h-8 rounded-full text-[13px] font-medium tabular-nums outline-hidden transition-[color,background-color,scale] duration-150 ease-out focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-foreground active:scale-[0.96]",
                  duration === d ? "bg-background text-foreground shadow-raised" : "text-muted hover:text-foreground",
                )}
              >
                {d}ms
              </button>
            ))}
          </div>
        </div>
      </section>

      <section aria-label="Presets" className="rounded-xl bg-background p-3.5">
        <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
          {PRESETS.map((p) => (
            <button
              key={p.name}
              type="button"
              aria-pressed={active === p}
              onClick={() => setCurve(p.curve)}
              className={cn(
                "h-9 rounded-lg px-3 font-mono text-[13px] outline-hidden transition-[color,background-color,scale] duration-150 ease-out focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-foreground active:scale-[0.96]",
                active === p ? "bg-foreground text-background" : "bg-surface text-muted hover:text-foreground",
              )}
            >
              {p.name}
            </button>
          ))}
        </div>
        {/* Reserves two lines so switching presets never shifts the page. */}
        <p className="mt-3 min-h-10 text-sm leading-5 text-pretty text-muted" aria-live="polite">
          {active ? active.use : "Custom curve. Steeper at the start means it answers faster; a handle above the square overshoots."}
        </p>
      </section>

      <div className="flex h-11 items-center gap-2 rounded-xl bg-background pr-1.5 pl-4">
        <code className="min-w-0 flex-1 truncate font-mono text-[13px]">{css}</code>
        <CopyButton value={css} />
      </div>
    </div>
  );
}

function SwapIcon({
  visible,
  reduceMotion,
  children,
}: {
  visible: boolean;
  reduceMotion: boolean | null;
  children: React.ReactNode;
}) {
  const hidden = reduceMotion
    ? { opacity: 0 }
    : { scale: 0.25, opacity: 0, filter: "blur(4px)" };
  return (
    <motion.svg
      viewBox="0 0 16 16"
      className="col-start-1 row-start-1 size-4"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      initial={false}
      animate={visible ? { scale: 1, opacity: 1, filter: "blur(0px)" } : hidden}
      transition={ICON_SWAP}
    >
      {children}
    </motion.svg>
  );
}

function CopyButton({ value }: { value: string }) {
  const reduceMotion = useReducedMotion();
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  const copy = async () => {
    setCopied(true);
    clearTimeout(timer.current);
    // Long enough to notice the check, short enough to copy again soon.
    timer.current = setTimeout(() => setCopied(false), 1600);
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      clearTimeout(timer.current);
      setCopied(false);
    }
  };

  return (
    <button
      type="button"
      aria-label="Copy easing"
      onClick={copy}
      className="relative flex size-8 shrink-0 items-center justify-center rounded-full text-muted outline-hidden transition-[scale,color,background-color] duration-150 ease-out select-none after:absolute after:-inset-1 hover:bg-surface hover:text-foreground focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-foreground active:scale-[0.96]"
    >
      <span className="grid" aria-hidden>
        <SwapIcon visible={!copied} reduceMotion={reduceMotion}>
          <rect x="5.25" y="5.25" width="8" height="8" rx="1.75" />
          <path d="M10.75 5.25V4.5a1.75 1.75 0 0 0-1.75-1.75H4.5A1.75 1.75 0 0 0 2.75 4.5V9a1.75 1.75 0 0 0 1.75 1.75h.75" />
        </SwapIcon>
        <SwapIcon visible={copied} reduceMotion={reduceMotion}>
          <path d="m3.5 8.5 3 3 6-7" />
        </SwapIcon>
      </span>
      <span className="sr-only" aria-live="polite">
        {copied ? "Copied" : ""}
      </span>
    </button>
  );
}

export default function EasingEditorDemo() {
  return <EasingEditor />;
}
