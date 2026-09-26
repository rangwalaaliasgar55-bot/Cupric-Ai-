import { useRef, useState } from "react";
import { motion, useInView } from "motion/react";
import { useReducedMotion } from "@/lib/use-reduced-motion";
import { cn } from "@/lib/cn";

type Point = { label: string; value: number };

// The plot's size at full width. On a narrower screen the whole chart
// scales down with its width, so the overlay is positioned in percentages.
const W = 520;
const H = 160;
// Room for the 12px scrub dot and its 2px ring at the extremes.
const PAD_X = 8;
const PAD_Y = 10;
// Long for a UI animation on purpose: the draw is the chart introducing its
// shape once, and a line that races in under 300ms reads as a flicker.
const DRAW = { duration: 0.7, ease: [0.23, 1, 0.32, 1] } as const;

export function Sparkline({
  data,
  title,
  format = (v) => String(v),
  className,
}: {
  data: Point[];
  title: string;
  format?: (value: number) => string;
  className?: string;
}) {
  const reduceMotion = useReducedMotion();
  const plotRef = useRef<HTMLDivElement>(null);
  const inView = useInView(plotRef, { once: true });
  const [index, setIndex] = useState(data.length - 1);
  const [active, setActive] = useState(false);
  const [announcement, setAnnouncement] = useState("");

  const values = data.map((d) => d.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const step = (W - PAD_X * 2) / Math.max(data.length - 1, 1);
  const xAt = (i: number) => PAD_X + i * step;
  const yAt = (v: number) => PAD_Y + (1 - (v - min) / span) * (H - PAD_Y * 2);

  const line = data
    .map((d, i) => `${i ? "L" : "M"}${xAt(i).toFixed(1)} ${yAt(d.value).toFixed(1)}`)
    .join(" ");
  const area = `${line} L${xAt(data.length - 1)} ${H} L${xAt(0)} ${H} Z`;

  const last = data[data.length - 1];
  const delta = last.value - data[0].value;

  const nearest = (clientX: number) => {
    const box = plotRef.current?.getBoundingClientRect();
    if (!box) return index;
    const x = ((clientX - box.left) / box.width) * W;
    return Math.min(Math.max(Math.round((x - PAD_X) / step), 0), data.length - 1);
  };

  const describe = (i: number) => `${data[i].label}: ${format(data[i].value)}`;

  const point = data[index];
  const x = xAt(index);
  const y = yAt(point.value);
  // Keeps the ~130px tooltip inside the chart near either edge.
  const tipX = Math.min(Math.max(x, 72), W - 72);
  const pct = (v: number, of: number) => `${(v / of) * 100}%`;

  return (
    <div className={cn("w-[520px] max-w-full", className)}>
      <div className="flex items-baseline justify-between">
        <div>
          <p className="text-[15px] text-muted">{title}</p>
          <p className="text-3xl font-semibold tracking-tight text-foreground tabular-nums">
            {format(last.value)}
          </p>
        </div>
        <p className="text-[15px] text-muted">
          <span className="font-medium text-foreground tabular-nums">
            {delta > 0 ? "+" : delta < 0 ? "-" : ""}
            {format(Math.abs(delta))}
          </span>{" "}
          vs {data[0].label}
        </p>
      </div>

      <div
        ref={plotRef}
        role="group"
        tabIndex={0}
        aria-roledescription="line chart"
        aria-label={`${title}, ${data.length} points. Use arrow keys to read values.`}
        // pan-y leaves vertical scrolling to the page and hands sideways
        // drags to the scrubber.
        className="relative mt-12 aspect-[520/160] w-full touch-pan-y rounded-sm outline-hidden select-none focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-4 focus-visible:outline-foreground"
        onPointerDown={(e) => {
          if (e.pointerType !== "touch") return;
          setIndex(nearest(e.clientX));
          setActive(true);
        }}
        onPointerMove={(e) => {
          if (e.pointerType === "touch" && !active) return;
          setIndex(nearest(e.clientX));
          setActive(true);
        }}
        onPointerLeave={(e) => {
          if (e.pointerType !== "touch") setActive(false);
        }}
        onPointerUp={(e) => {
          if (e.pointerType === "touch") setActive(false);
        }}
        onPointerCancel={() => setActive(false)}
        onFocus={() => {
          setActive(true);
          setAnnouncement(describe(index));
        }}
        onBlur={() => setActive(false)}
        onKeyDown={(e) => {
          const next = {
            ArrowLeft: index - 1,
            ArrowRight: index + 1,
            Home: 0,
            End: data.length - 1,
          }[e.key];
          if (next === undefined) return;
          e.preventDefault();
          const clamped = Math.min(Math.max(next, 0), data.length - 1);
          setIndex(clamped);
          setActive(true);
          setAnnouncement(describe(clamped));
        }}
      >
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="block h-auto w-full overflow-visible"
          aria-hidden
        >
          <motion.path
            d={area}
            className="fill-foreground/[0.08]"
            initial={{ opacity: 0 }}
            animate={inView ? { opacity: 1 } : undefined}
            transition={DRAW}
          />
          <motion.path
            d={line}
            fill="none"
            className="stroke-foreground"
            strokeWidth={2.5}
            strokeLinecap="round"
            strokeLinejoin="round"
            // Opacity hides the round cap's dot before the draw starts.
            initial={{ pathLength: 0, opacity: 0 }}
            animate={inView ? { pathLength: 1, opacity: 1 } : undefined}
            // Reduced motion skips the draw and keeps only a fade.
            transition={
              reduceMotion
                ? { pathLength: { duration: 0 }, opacity: DRAW }
                : { pathLength: DRAW, opacity: { duration: 0.05 } }
            }
          />
        </svg>

        {/* Everything below moves instantly: scrubbing is constant, and any
            easing would make the readout trail the pointer. Only the
            appearance fades. */}
        <div
          aria-hidden
          className={cn(
            "pointer-events-none absolute inset-0 transition-opacity ease-out",
            active ? "opacity-100 duration-100" : "opacity-0 duration-150",
          )}
        >
          <div
            className="absolute top-0 h-full w-px -translate-x-1/2 bg-muted/40"
            style={{ left: pct(x, W) }}
          />
          <div
            className="absolute size-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-foreground ring-2 ring-background"
            style={{ left: pct(x, W), top: pct(y, H) }}
          />
          <div
            className="absolute bottom-full mb-2.5 flex -translate-x-1/2 items-baseline gap-2 rounded-full bg-foreground px-3 py-1.5 text-sm whitespace-nowrap text-background"
            style={{ left: pct(tipX, W) }}
          >
            <span className="font-semibold tabular-nums">{format(point.value)}</span>
            <span className="opacity-70">{point.label}</span>
          </div>
        </div>
      </div>

      <span className="sr-only" aria-live="polite">
        {announcement}
      </span>
      {/* sr-only on a wrapper: a table ignores the 1px height it sets and
          stays full height, stretching the page below it. */}
      <div className="sr-only">
      <table>
        <caption>{title}</caption>
        <thead>
          <tr>
            <th scope="col">Day</th>
            <th scope="col">Value</th>
          </tr>
        </thead>
        <tbody>
          {data.map((d) => (
            <tr key={d.label}>
              <th scope="row">{d.label}</th>
              <td>{format(d.value)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>
    </div>
  );
}

// Seeded so the server and client render the same walk.
function mulberry32(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const DEMO: Point[] = (() => {
  const random = mulberry32(7);
  const points: Point[] = [];
  let value = 128;
  for (let i = 0; i < 30; i++) {
    // Days 25 to 31 of August, then September.
    const day = 25 + i;
    const label = day <= 31 ? `Aug ${day}` : `Sep ${day - 31}`;
    value = Math.max(80, value + (random() - 0.48) * 18);
    points.push({ label, value: Math.round(value) });
  }
  return points;
})();

export default function SparklineDemo() {
  return <Sparkline data={DEMO} title="Response time" format={(v) => `${v} ms`} />;
}
