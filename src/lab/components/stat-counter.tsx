import { useEffect, useRef, useState } from "react";
import { animate, motion, useInView, useMotionValue, useTransform } from "motion/react";
import { useReducedMotion } from "@/lib/use-reduced-motion";
import { cn } from "@/lib/cn";

export type Stat = {
  label: string;
  value: number;
  format: Intl.NumberFormat;
  /** Change against the previous period, as a fraction: 0.12 is +12%. */
  trend: number;
  /** Which direction is good news. Latency going up is not. */
  goodWhen?: "up" | "down";
  series: number[];
};

// Long enough to read as counting, which is the point of the component;
// shorter and the number just blinks to its value. No bounce, so a figure
// never overshoots to a value that isn't true.
const COUNT = { type: "spring", visualDuration: 0.7, bounce: 0 } as const;
// Scrubbing the line glides between figures faster, so the number keeps up
// with the finger, but still counts rather than blinking.
const SCRUB = { type: "spring", visualDuration: 0.3, bounce: 0 } as const;
const EASE_OUT = [0.23, 1, 0.32, 1] as const;
const SPARK_W = 120;
const SPARK_H = 32;
// Cards wipe their sparklines in one after another, 50ms apart.
const STAGGER_MS = 50;

const trendFormat = new Intl.NumberFormat("en-US", {
  style: "percent",
  maximumFractionDigits: 1,
  signDisplay: "exceptZero",
});

export function StatCounter({
  stats,
  className,
}: {
  stats: Stat[];
  className?: string;
}) {
  const ref = useRef<HTMLDListElement>(null);
  const inView = useInView(ref, { once: true, amount: 0.5 });

  return (
    // Four across when there's room, two by two on a phone.
    <div className={cn("@container w-[600px] max-w-full", className)}>
      <dl ref={ref} className="grid grid-cols-2 gap-3 @min-[560px]:grid-cols-4">
        {stats.map((stat, i) => (
          <StatCard key={stat.label} stat={stat} started={inView} index={i} />
        ))}
      </dl>
    </div>
  );
}

function StatCard({ stat, started, index }: { stat: Stat; started: boolean; index: number }) {
  const reduceMotion = useReducedMotion();
  const value = useMotionValue(0);
  // Written straight to the DOM each frame; the card never re-renders
  // while counting.
  const text = useTransform(value, (v) => stat.format.format(v));
  // The point being inspected, or null for "now". Counted in whole points,
  // so moving along the line re-renders at most once per point.
  const [scrub, setScrub] = useState<number | null>(null);
  const last = stat.series.length - 1;
  const shown = scrub === null ? stat.value : stat.series[scrub];

  useEffect(() => {
    if (!started) return;
    // Retargets from wherever the number is, so a refresh or a scrub
    // mid-count carries on smoothly from the old figure.
    const controls = animate(
      value,
      shown,
      reduceMotion ? { duration: 0 } : scrub === null ? COUNT : SCRUB,
    );
    return () => controls.stop();
  }, [started, shown, scrub, reduceMotion, value]);

  const up = stat.trend >= 0;
  const good = up === ((stat.goodWhen ?? "up") === "up");
  const trendText = trendFormat.format(stat.trend);
  const when = scrub === null ? null : ago(last - scrub);

  const pick = (e: React.PointerEvent<HTMLDivElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    const t = Math.min(Math.max((e.clientX - box.left) / box.width, 0), 1);
    setScrub(Math.round(t * last));
  };

  return (
    <div className="flex min-w-0 flex-col gap-1 rounded-2xl bg-surface p-4">
      <dt className="text-sm text-muted">{stat.label}</dt>
      <dd className="flex flex-col gap-3">
        <span className="sr-only">
          {stat.format.format(stat.value)}, {trendText}
        </span>
        <motion.span
          aria-hidden
          className={cn(
            "truncate text-2xl font-semibold tracking-tight tabular-nums transition-[color] duration-150 ease-out",
            // Muted while it shows the past, so a glance never mistakes an
            // old figure for today's.
            scrub === null || scrub === last ? "text-foreground" : "text-muted",
          )}
        >
          {text}
        </motion.span>
        {/* Trend and date share one cell and swap through a blur, so the chip
            never jumps in width mid-scrub. */}
        <span aria-hidden className="grid h-6 self-start">
          <span
            className={cn(
              "col-start-1 row-start-1 inline-flex items-center gap-1 self-start rounded-full bg-background px-2 text-xs leading-6 font-medium tabular-nums transition-[opacity,filter] ease-out",
              good ? "text-foreground" : "text-danger",
              when ? "opacity-0 blur-[4px] duration-100" : "duration-200",
            )}
          >
            <svg
              viewBox="0 0 12 12"
              className={cn(
                "size-3 transition-transform duration-200 motion-reduce:transition-none",
                "ease-[cubic-bezier(0.23,1,0.32,1)]",
                !up && "rotate-180",
              )}
              fill="none"
              stroke="currentColor"
              strokeWidth={1.5}
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M6 9.5v-7M3 5.5l3-3 3 3" />
            </svg>
            {/* Remounts when the figure changes, so it fades in from a soft
                blur rather than snapping. */}
            <span
              key={trendText}
              className="transition-[opacity,filter] duration-200 ease-out starting:opacity-0 starting:blur-[4px]"
            >
              {trendText}
            </span>
          </span>
          <span
            className={cn(
              "col-start-1 row-start-1 self-start rounded-full bg-background px-2 text-xs leading-6 font-medium text-muted tabular-nums transition-[opacity,filter] ease-out",
              when ? "duration-200" : "opacity-0 blur-[4px] duration-100",
            )}
          >
            {when ?? ago(0)}
          </span>
        </span>
        <div
          role="slider"
          tabIndex={0}
          aria-label={`${stat.label} history`}
          aria-valuemin={0}
          aria-valuemax={last}
          aria-valuenow={scrub ?? last}
          aria-valuetext={`${stat.format.format(shown)}, ${ago(last - (scrub ?? last))}`}
          onPointerMove={(e) => {
            if (e.pointerType === "mouse" || e.buttons) pick(e);
          }}
          onPointerDown={(e) => {
            // Touch scrubs by dragging along the line.
            e.currentTarget.setPointerCapture(e.pointerId);
            pick(e);
          }}
          onPointerLeave={(e) => {
            if (!e.currentTarget.hasPointerCapture(e.pointerId)) setScrub(null);
          }}
          onPointerUp={(e) => {
            if (e.pointerType !== "mouse") setScrub(null);
          }}
          onPointerCancel={() => setScrub(null)}
          onBlur={() => setScrub(null)}
          onKeyDown={(e) => {
            const current = scrub ?? last;
            const next =
              e.key === "ArrowLeft"
                ? current - 1
                : e.key === "ArrowRight"
                  ? current + 1
                  : e.key === "Home"
                    ? 0
                    : e.key === "End"
                      ? last
                      : e.key === "Escape"
                        ? last
                        : null;
            if (next === null) return;
            e.preventDefault();
            const clamped = Math.min(Math.max(next, 0), last);
            setScrub(clamped === last ? null : clamped);
          }}
          // A few px of padding widens the target without moving the line.
          className="-mx-1 -my-1 cursor-ew-resize touch-pan-y rounded-lg px-1 py-1 outline-hidden focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-foreground"
        >
          <Sparkline
            series={stat.series}
            started={started}
            delay={index * STAGGER_MS}
            scrub={scrub}
          />
        </div>
      </dd>
    </div>
  );
}

function ago(days: number) {
  return days === 0 ? "Today" : days === 1 ? "Yesterday" : `${days} days ago`;
}

function points(series: number[]) {
  const min = Math.min(...series);
  const max = Math.max(...series);
  const span = max - min || 1;
  // 2px inset so the 1.5px line is never clipped at the extremes.
  return series.map((v, i) => ({
    x: (i / (series.length - 1)) * SPARK_W,
    y: 2 + (1 - (v - min) / span) * (SPARK_H - 4),
  }));
}

function pathFor(series: number[]) {
  return points(series)
    .map((p, i) => `${i ? "L" : "M"}${p.x.toFixed(1)} ${p.y.toFixed(1)}`)
    .join(" ");
}

function Sparkline({
  series,
  started,
  delay,
  scrub,
}: {
  series: number[];
  started: boolean;
  delay: number;
  scrub: number | null;
}) {
  const reduceMotion = useReducedMotion();
  const d = pathFor(series);
  const pts = points(series);
  const at = scrub === null ? null : pts[scrub];
  // Past the inspected point the line is the future, so it fades back.
  const cut = scrub === null ? 0 : (1 - scrub / (series.length - 1)) * 100;
  const line = (
    <motion.path
      initial={false}
      animate={{ d }}
      transition={reduceMotion ? { duration: 0 } : { duration: 0.5, ease: EASE_OUT }}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      vectorEffect="non-scaling-stroke"
    />
  );
  return (
    <div
      aria-hidden
      className={cn(
        "relative h-8 w-full",
        // Wipes in left to right, the direction time runs along the line.
        // 500ms because it plays once, on arrival, alongside the count.
        "transition-[clip-path] duration-500 ease-[cubic-bezier(0.23,1,0.32,1)] motion-reduce:transition-none",
        started ? "[clip-path:inset(-4px)]" : "[clip-path:inset(-4px_100%_-4px_-4px)]",
      )}
      style={{ transitionDelay: `${delay}ms` }}
    >
      <svg
        viewBox={`0 0 ${SPARK_W} ${SPARK_H}`}
        preserveAspectRatio="none"
        className={cn(
          "absolute inset-0 size-full overflow-visible text-foreground/60 transition-[opacity] duration-150 ease-out",
          scrub !== null && "opacity-30",
        )}
      >
        {line}
      </svg>
      {/* The same line again, clipped at the inspected point, so everything
          up to it stays at full strength. Clip-path rather than a second
          shorter path, so the two can never disagree about the shape. */}
      <svg
        viewBox={`0 0 ${SPARK_W} ${SPARK_H}`}
        preserveAspectRatio="none"
        className={cn(
          "absolute inset-0 size-full overflow-visible text-foreground/60 transition-[clip-path,opacity] duration-150 ease-out",
          scrub === null && "opacity-0",
        )}
        style={{ clipPath: `inset(-4px ${cut}% -4px -4px)` }}
      >
        {line}
      </svg>
      {/* Left and top in percent, since the line stretches with the card and
          only percentages track it; a 150ms glide between neighbouring
          points on an element this small costs nothing noticeable. */}
      <span
        className={cn(
          "pointer-events-none absolute inset-y-0 w-px bg-foreground/20 transition-[left,opacity] duration-150 ease-out",
          at ? "opacity-100" : "opacity-0",
        )}
        style={{ left: `${((at?.x ?? SPARK_W) / SPARK_W) * 100}%` }}
      />
      <span
        className={cn(
          "pointer-events-none absolute -mt-[3.5px] -ml-[3.5px] size-[7px] rounded-full bg-foreground ring-2 ring-surface transition-[left,top,opacity,scale] duration-150 ease-out",
          at ? "scale-100 opacity-100" : "scale-50 opacity-0",
        )}
        style={{
          left: `${((at?.x ?? SPARK_W) / SPARK_W) * 100}%`,
          top: `${((at?.y ?? SPARK_H / 2) / SPARK_H) * 100}%`,
        }}
      />
    </div>
  );
}

const currency = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});
const count = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const rate = new Intl.NumberFormat("en-US", {
  style: "percent",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const ms = new Intl.NumberFormat("en-US", {
  style: "unit",
  unit: "millisecond",
  unitDisplay: "short",
  maximumFractionDigits: 0,
});

// Seeded, so the server and the browser agree on the first render.
function mulberry32(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const METRICS = [
  { label: "Revenue", format: currency, base: 48210, swing: 0.08, goodWhen: "up" },
  { label: "Users", format: count, base: 12480, swing: 0.06, goodWhen: "up" },
  { label: "Conversion", format: rate, base: 0.0342, swing: 0.07, goodWhen: "up" },
  { label: "Latency", format: ms, base: 184, swing: 0.1, goodWhen: "down" },
] as const;
const POINTS = 12;

// A random walk per metric. Each refresh drops the oldest point and adds a
// new one, so the line reads as time moving on rather than a new chart.
function initialSeries() {
  const random = mulberry32(7);
  return METRICS.map((m) => {
    const out: number[] = [m.base];
    for (let i = 1; i < POINTS; i++) out.unshift(out[0] * (1 + (random() - 0.5) * m.swing));
    return out;
  });
}

function toStats(series: number[][]): Stat[] {
  return METRICS.map((m, i) => {
    const s = series[i];
    const value = s[s.length - 1];
    return {
      label: m.label,
      value,
      format: m.format,
      trend: value / s[s.length - 2] - 1,
      goodWhen: m.goodWhen,
      series: s,
    };
  });
}

export default function StatCounterDemo() {
  const [series, setSeries] = useState(initialSeries);
  const [turns, setTurns] = useState(0);
  const random = useRef(mulberry32(99));

  const refresh = () => {
    setTurns((t) => t + 1);
    setSeries((all) =>
      all.map((s, i) => {
        const last = s[s.length - 1];
        return [...s.slice(1), last * (1 + (random.current() - 0.45) * METRICS[i].swing * 2)];
      }),
    );
  };

  return (
    <div className="flex w-[600px] max-w-full flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-[15px] font-medium text-foreground">Overview</p>
          <p className="text-sm text-muted">Compared with the previous day</p>
        </div>
        <button
          type="button"
          onClick={refresh}
          className="flex h-9 touch-manipulation items-center gap-2 rounded-full bg-background px-4 text-sm font-medium text-foreground shadow-raised transition-[scale] duration-150 ease-out select-none focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-foreground active:scale-[0.96] motion-reduce:transition-none"
        >
          {/* Half a turn per press, so repeated presses keep spinning the
              same way instead of snapping back. */}
          <svg
            aria-hidden
            viewBox="0 0 16 16"
            className="size-4 transition-transform duration-300 ease-[cubic-bezier(0.23,1,0.32,1)] motion-reduce:transition-none"
            style={{ transform: `rotate(${turns * 180}deg)` }}
            fill="none"
            stroke="currentColor"
            strokeWidth={1.5}
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M13.25 8a5.25 5.25 0 0 1-9.4 3.2M2.75 8a5.25 5.25 0 0 1 9.4-3.2" />
            <path d="M12.5 1.75v3h-3M3.5 14.25v-3h3" />
          </svg>
          Refresh
        </button>
      </div>
      <StatCounter stats={toStats(series)} />
      <p className="sr-only" aria-live="polite">
        {turns > 0 ? `Updated ${turns} ${turns === 1 ? "time" : "times"}` : ""}
      </p>
    </div>
  );
}
