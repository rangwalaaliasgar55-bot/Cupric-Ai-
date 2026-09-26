import { useEffect, useRef, useState } from "react";
import {
  animate,
  motion,
  useInView,
  useMotionValue,
  useTransform,
  type AnimationPlaybackControls,
  type MotionValue,
} from "motion/react";
import { useReducedMotion } from "@/lib/use-reduced-motion";
import { cn } from "@/lib/cn";

type Datum = { label: string; value: number };

const PLOT_H = 190;
// The 6px rounded cap rides on top of a square body. Scaling one rounded
// rect would squash its corners, so only the body scales.
const CAP = 6;
// Mount: a quick cascade reads as one gesture across the week.
const STAGGER = 0.04;
// No bounce: an overshooting bar briefly claims a value that isn't true.
const GROW = { type: "spring", visualDuration: 0.45, bounce: 0 } as const;
const EASE = "ease-[cubic-bezier(0.23,1,0.32,1)]";

export function BarChart({
  data,
  max,
  ticks,
  unit,
  suffix,
  label,
  className,
}: {
  data: Datum[];
  max: number;
  ticks: number[];
  /** Spoken after each value, e.g. "hours". */
  unit: string;
  /** Shown after each value in the tooltip, e.g. "h". */
  suffix: string;
  label: string;
  className?: string;
}) {
  const plotRef = useRef<HTMLDivElement>(null);
  const barRefs = useRef<(HTMLDivElement | null)[]>([]);
  const inView = useInView(plotRef, { once: true });
  const [active, setActive] = useState<number | null>(null);
  // Roving tabindex: one stop for the whole chart, arrows move within it.
  const [focusIndex, setFocusIndex] = useState(0);

  const move = (i: number) => {
    const next = Math.min(Math.max(i, 0), data.length - 1);
    setFocusIndex(next);
    barRefs.current[next]?.focus();
  };

  return (
    <div className={cn("flex w-[520px] max-w-full", className)}>
      {/* Tick labels sit in their own gutter so gridlines can span the plot. */}
      <div
        aria-hidden
        className="relative mr-3 w-6 shrink-0 text-right text-xs text-muted tabular-nums"
        style={{ height: PLOT_H }}
      >
        {ticks.map((t) => (
          <span
            key={t}
            className="absolute right-0 -translate-y-1/2 leading-none"
            style={{ top: PLOT_H - (t / max) * PLOT_H }}
          >
            {t}
          </span>
        ))}
      </div>

      <div className="flex-1">
        <div
          ref={plotRef}
          role="group"
          aria-label={label}
          className="relative flex"
          style={{ height: PLOT_H }}
          onPointerLeave={(e) => {
            if (e.pointerType !== "touch") setActive(null);
          }}
        >
          {ticks.map((t) => (
            <div
              key={t}
              aria-hidden
              className="absolute inset-x-0 h-px bg-border"
              style={{ top: PLOT_H - (t / max) * PLOT_H }}
            />
          ))}
          {data.map((d, i) => (
            <Bar
              key={d.label}
              ref={(el) => {
                barRefs.current[i] = el;
              }}
              datum={d}
              fraction={d.value / max}
              index={i}
              started={inView}
              unit={unit}
              suffix={suffix}
              active={active === i}
              dimmed={active !== null && active !== i}
              tabIndex={i === focusIndex ? 0 : -1}
              onActivate={() => setActive(i)}
              onFocus={() => {
                setFocusIndex(i);
                setActive(i);
              }}
              onBlur={(e) => {
                if (!plotRef.current?.contains(e.relatedTarget as Node)) setActive(null);
              }}
              onKeyDown={(e) => {
                const next = {
                  ArrowLeft: i - 1,
                  ArrowRight: i + 1,
                  Home: 0,
                  End: data.length - 1,
                }[e.key];
                if (next === undefined) return;
                e.preventDefault();
                move(next);
              }}
            />
          ))}
        </div>
        <div aria-hidden className="mt-3 flex">
          {data.map((d, i) => (
            <span
              key={d.label}
              className={cn(
                "flex-1 text-center text-sm transition-colors duration-150 ease-out",
                active === i ? "text-foreground" : "text-muted",
              )}
            >
              {d.label}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

function Bar({
  ref,
  datum,
  fraction,
  index,
  started,
  unit,
  suffix,
  active,
  dimmed,
  tabIndex,
  onActivate,
  onFocus,
  onBlur,
  onKeyDown,
}: {
  ref: (el: HTMLDivElement | null) => void;
  datum: Datum;
  fraction: number;
  index: number;
  started: boolean;
  unit: string;
  suffix: string;
  active: boolean;
  dimmed: boolean;
  tabIndex: number;
  onActivate: () => void;
  onFocus: () => void;
  onBlur: (e: React.FocusEvent) => void;
  onKeyDown: (e: React.KeyboardEvent) => void;
}) {
  const reduceMotion = useReducedMotion();
  const height = useMotionValue(0);
  const grown = useRef(false);
  const controls = useRef<AnimationPlaybackControls>(undefined);

  useEffect(() => {
    if (!started) return;
    const target = fraction * PLOT_H;
    if (reduceMotion) {
      height.jump(target);
    } else {
      // Only the first growth staggers; a dataset switch moves every bar
      // at once so the comparison lands together. animate() retargets from
      // the current value and velocity, so rapid toggles stay smooth.
      controls.current = animate(height, target, {
        ...GROW,
        delay: grown.current ? 0 : index * STAGGER,
      });
    }
    grown.current = true;
  }, [started, fraction, index, reduceMotion, height]);

  useEffect(() => () => controls.current?.stop(), []);

  return (
    <div
      ref={ref}
      role="img"
      tabIndex={tabIndex}
      aria-label={`${datum.label}, ${datum.value} ${unit}`}
      // The whole column is the hit target, not just the 40px bar.
      className="relative flex-1 rounded-sm outline-hidden focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-foreground"
      onPointerEnter={(e) => {
        if (e.pointerType !== "touch") onActivate();
      }}
      onPointerDown={(e) => {
        if (e.pointerType === "touch") onActivate();
      }}
      onFocus={onFocus}
      onBlur={onBlur}
      onKeyDown={onKeyDown}
    >
      <BarShape height={height} dimmed={dimmed} />
      <Tooltip height={height} visible={active}>
        <span className="font-semibold tabular-nums">{datum.value}</span> {suffix}
      </Tooltip>
    </div>
  );
}

function BarShape({ height, dimmed }: { height: MotionValue<number>; dimmed: boolean }) {
  const body = useTransform(height, (h) => `scaleY(${Math.max(h - CAP, 0) / (PLOT_H - CAP)})`);
  // Overlaps the body by 1px so no hairline seam shows at fractional heights.
  const cap = useTransform(height, (h) => `translateY(${-Math.max(h - CAP - 1, 0)}px)`);
  // Keeps an empty bar from showing a stub before it grows.
  const capOpacity = useTransform(height, (h) => (h < 0.5 ? 0 : 1));

  return (
    <div
      aria-hidden
      className={cn(
        "absolute bottom-0 left-1/2 w-10 -translate-x-1/2 transition-opacity duration-150 ease-out",
        dimmed ? "opacity-40" : "opacity-100",
      )}
      style={{ height: PLOT_H }}
    >
      <motion.div
        className="absolute inset-x-0 bottom-0 origin-bottom bg-foreground"
        style={{ height: PLOT_H - CAP, transform: body }}
      />
      <motion.div
        className="absolute inset-x-0 bottom-0 rounded-t-[6px] bg-foreground"
        style={{ height: CAP + 1, transform: cap, opacity: capOpacity }}
      />
    </div>
  );
}

function Tooltip({
  height,
  visible,
  children,
}: {
  height: MotionValue<number>;
  visible: boolean;
  children: React.ReactNode;
}) {
  // Rides 8px above the bar's top, following it while the bar animates.
  const transform = useTransform(height, (h) => `translate(-50%, ${-h - 8}px)`);

  return (
    <div aria-hidden className="pointer-events-none absolute bottom-0 left-1/2">
      <motion.div style={{ transform }}>
        <div
          className={cn(
            "rounded-full bg-foreground px-3 py-1.5 text-sm whitespace-nowrap text-background transition-[opacity,translate] ease-out motion-reduce:transition-opacity",
            visible
              ? "translate-y-0 opacity-100 duration-100"
              : "translate-y-1 opacity-0 duration-75 motion-reduce:translate-y-0",
          )}
        >
          {children}
        </div>
      </motion.div>
    </div>
  );
}

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const DATASETS = {
  "This week": [6.5, 7.2, 5.1, 8.4, 6, 2.3, 1.2],
  "Last week": [5.2, 6.1, 7.4, 4.8, 5.5, 3.1, 0.8],
};
type Week = keyof typeof DATASETS;
const WEEKS = Object.keys(DATASETS) as Week[];

export default function BarChartDemo() {
  const [week, setWeek] = useState<Week>("This week");
  const values = DATASETS[week];
  const data = DAYS.map((label, i) => ({ label, value: values[i] }));
  const total = values.reduce((a, b) => a + b, 0);

  return (
    <div className="flex w-[520px] max-w-full flex-col gap-6">
      <div className="flex items-end justify-between">
        <div>
          <p className="text-[15px] text-muted">Focus hours</p>
          <p className="text-3xl font-semibold tracking-tight text-foreground tabular-nums">
            {total.toFixed(1)} h
          </p>
        </div>
        <div className="relative flex rounded-full bg-surface p-1">
          {/* One indicator slides between the options instead of two
              backgrounds fading, so the switch reads as a single motion. */}
          <span
            aria-hidden
            className={cn(
              "absolute top-1 bottom-1 left-1 w-[96px] rounded-full bg-background shadow-raised transition-transform duration-200 motion-reduce:transition-none",
              EASE,
              week === WEEKS[1] && "translate-x-full",
            )}
          />
          {WEEKS.map((w) => (
            <button
              key={w}
              type="button"
              aria-pressed={week === w}
              onClick={() => setWeek(w)}
              className={cn(
                "relative h-9 w-[96px] touch-manipulation rounded-full text-sm font-medium outline-hidden transition-[scale,color] duration-150 ease-out select-none focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-foreground active:scale-[0.96] motion-reduce:transition-[color]",
                week === w ? "text-foreground" : "text-muted hover:text-foreground",
              )}
            >
              {w}
            </button>
          ))}
        </div>
      </div>
      <BarChart
        data={data}
        max={10}
        ticks={[0, 5, 10]}
        unit="hours"
        suffix="h"
        label={`Focus hours per day, ${week.toLowerCase()}`}
      />
    </div>
  );
}
