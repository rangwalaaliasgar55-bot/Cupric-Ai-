import { useEffect, useRef, useState } from "react";
import {
  animate,
  motion,
  useInView,
  useMotionValue,
  useMotionValueEvent,
  useSpring,
  useTransform,
  type AnimationPlaybackControls,
} from "motion/react";
import { useReducedMotion } from "@/lib/use-reduced-motion";
import { cn } from "@/lib/cn";

// No bounce: an arc that overshoots would briefly show a value that isn't
// true. Longer than a UI transition because the eye has to follow a change
// in magnitude, not just notice one.
const FILL = { visualDuration: 0.6, bounce: 0 };

// Instrument geometry in viewBox units: a half circle of ticks centred on
// (CX, CY), read left to right as 0 to 100.
const CX = 100;
const CY = 100;
const R = 84;
// 41 ticks is one every 2.5%, about 6.6 units apart on the arc: dense
// enough to read as a sweep, sparse enough that each tick is its own mark.
const TICKS = 41;
const TICK_IN = R - 8;
const TICK_OUT = R + 8;
// The peak marker reaches past the ticks on both sides so it stays legible
// on top of a lit run.
const PEAK_IN = R - 13;
const PEAK_OUT = R + 13;
// Peak hold, as on an audio meter: after a drop the marker waits where the
// value was, long enough to be seen (the fill settles in ~600ms), then falls.
const PEAK_HOLD = 900;
// An ease-in on purpose: the marker is let go and drops under its own
// weight, so it starts slow and lands fast.
const PEAK_FALL = { duration: 0.45, ease: [0.55, 0, 1, 0.45] } as const;

function pointAt(percent: number, radius: number) {
  const angle = Math.PI * (1 - percent / 100);
  // Rounded because the server's and the browser's trig can differ in the
  // last float digits, which would fail hydration on every tick.
  const round = (n: number) => Math.round(n * 1000) / 1000;
  return [round(CX + radius * Math.cos(angle)), round(CY - radius * Math.sin(angle))];
}

const TICK_PERCENTS = Array.from({ length: TICKS }, (_, i) => (i / (TICKS - 1)) * 100);

export function Gauge({
  value,
  label,
  threshold = 85,
  className,
}: {
  value: number;
  label: string;
  threshold?: number;
  className?: string;
}) {
  const reduceMotion = useReducedMotion();
  const rootRef = useRef<HTMLDivElement>(null);
  const tickRefs = useRef<(SVGLineElement | null)[]>([]);
  const lit = useRef(0);
  // Fills in when first seen, so a gauge below the fold still gets its
  // entrance instead of finishing offscreen.
  const inView = useInView(rootRef, { once: true });
  const clamped = Math.round(Math.min(Math.max(value, 0), 100));
  const high = clamped > threshold;

  // One spring drives the ticks, the number and the peak so they never
  // drift apart.
  const progress = useSpring(0, FILL);
  const shown = useTransform(progress, (v) => Math.round(v));
  const peak = useMotionValue(0);
  const fall = useRef<AnimationPlaybackControls>(undefined);

  useEffect(() => {
    if (!inView) return;
    if (reduceMotion) progress.jump(clamped);
    else progress.set(clamped);
    if (clamped >= peak.get()) return;
    const timer = setTimeout(() => {
      fall.current?.stop();
      if (reduceMotion) peak.jump(clamped);
      else fall.current = animate(peak, clamped, PEAK_FALL);
    }, PEAK_HOLD);
    return () => clearTimeout(timer);
  }, [clamped, inView, reduceMotion, progress, peak]);

  useEffect(() => () => fall.current?.stop(), []);

  // Lights ticks as the fill passes them, writing only the ticks that
  // changed straight to the DOM, so a frame costs a handful of attribute
  // writes and never a React render. The peak rides the fill upward.
  useMotionValueEvent(progress, "change", (v) => {
    if (v > peak.get()) {
      fall.current?.stop();
      peak.set(v);
    }
    // Half a percent of slack so a spring settling at 50 still lights 50.
    const count = v < 0.5 ? 0 : TICK_PERCENTS.filter((p) => p <= v + 0.5).length;
    const before = lit.current;
    if (count === before) return;
    for (let i = Math.min(count, before); i < Math.max(count, before); i++) {
      const tick = tickRefs.current[i];
      if (tick) tick.dataset.lit = String(i < count);
    }
    lit.current = count;
  });

  // The marker only shows once it has come apart from the fill, fading in
  // over the first few percent of separation instead of popping.
  const peakOpacity = useTransform([peak, progress], ([p, v]: number[]) =>
    Math.min(Math.max((p - v - 1) / 3, 0), 1),
  );
  const px1 = useTransform(peak, (p) => pointAt(p, PEAK_IN)[0]);
  const py1 = useTransform(peak, (p) => pointAt(p, PEAK_IN)[1]);
  const px2 = useTransform(peak, (p) => pointAt(p, PEAK_OUT)[0]);
  const py2 = useTransform(peak, (p) => pointAt(p, PEAK_OUT)[1]);

  return (
    <div
      ref={rootRef}
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={clamped}
      aria-valuetext={`${clamped}%${high ? ", high" : ""}`}
      className={cn("flex w-[320px] max-w-full flex-col items-center", className)}
    >
      <div className="relative w-full">
        <svg
          viewBox="0 0 200 110"
          className="block w-full overflow-visible"
          fill="none"
          aria-hidden
        >
          {TICK_PERCENTS.map((p, i) => {
            const [x1, y1] = pointAt(p, TICK_IN);
            const [x2, y2] = pointAt(p, TICK_OUT);
            const danger = p > threshold;
            return (
              <line
                key={i}
                ref={(el) => {
                  tickRefs.current[i] = el;
                }}
                x1={x1}
                y1={y1}
                x2={x2}
                y2={y2}
                data-lit="false"
                strokeWidth={2.5}
                strokeLinecap="round"
                // A short fade per tick turns the spring's sweep into a
                // smooth wave instead of ticks snapping on one by one. The
                // danger zone is faintly tinted even when unlit, so the
                // limit is visible before the value gets there.
                className={cn(
                  "transition-[stroke] duration-150 ease-out motion-reduce:transition-none",
                  danger
                    ? "stroke-danger/25 data-[lit=true]:stroke-danger"
                    : "stroke-border data-[lit=true]:stroke-foreground",
                )}
              />
            );
          })}
          <motion.line
            x1={px1}
            y1={py1}
            x2={px2}
            y2={py2}
            style={{ opacity: peakOpacity }}
            strokeWidth={2}
            strokeLinecap="round"
            className="stroke-foreground"
          />
        </svg>

        {/* Tabular so the width holds steady while the number counts. */}
        <span
          aria-hidden
          className="absolute inset-x-0 bottom-0 flex items-baseline justify-center text-6xl leading-none font-semibold tracking-tight text-foreground tabular-nums"
        >
          <motion.span>{shown}</motion.span>
          <span className="ml-1 text-2xl font-medium text-muted">%</span>
        </span>
      </div>

      <div aria-hidden className="relative mt-3 flex h-6 items-center text-[15px]">
        <span className="text-muted">{label}</span>
        {/* Status never rides on colour alone, so high usage also gets a word.
            Out of flow so the label stays centred whether or not it shows. */}
        <span
          className={cn(
            "absolute left-full ml-2 flex items-center whitespace-nowrap gap-1.5 font-medium text-foreground transition-[opacity,filter,translate] ease-[cubic-bezier(0.23,1,0.32,1)] motion-reduce:transition-[opacity]",
            high
              ? "translate-y-0 opacity-100 blur-[0px] duration-200"
              : "translate-y-0.5 opacity-0 blur-[4px] duration-150 motion-reduce:translate-y-0",
          )}
        >
          <span className="size-2 rounded-full bg-danger" />
          High
        </span>
      </div>
    </div>
  );
}

const PRESETS = [
  { label: "CPU", value: 34 },
  { label: "Memory", value: 72 },
  { label: "Disk", value: 91 },
];

export default function GaugeDemo() {
  const [active, setActive] = useState(0);
  const preset = PRESETS[active];

  return (
    <div className="flex max-w-full flex-col items-center gap-6">
      <Gauge value={preset.value} label={preset.label} />
      <div className="flex gap-1 rounded-full bg-surface p-1">
        {PRESETS.map((p, i) => (
          <button
            key={p.label}
            type="button"
            aria-pressed={i === active}
            onClick={() => setActive(i)}
            className={cn(
              "h-10 touch-manipulation rounded-full px-4 text-sm font-medium outline-hidden transition-[scale,color,background-color,box-shadow] duration-150 ease-out select-none focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-foreground active:scale-[0.96] motion-reduce:transition-[color,background-color,box-shadow]",
              i === active
                ? "bg-background text-foreground shadow-raised"
                : "text-muted hover:text-foreground",
            )}
          >
            {p.label} <span className="tabular-nums">{p.value}%</span>
          </button>
        ))}
      </div>
    </div>
  );
}
