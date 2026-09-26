import { useEffect, useRef, useState } from "react";
import {
  animate,
  motion,
  useInView,
  useMotionValue,
  useSpring,
  useTransform,
  type MotionValue,
} from "motion/react";
import { useReducedMotion } from "@/lib/use-reduced-motion";
import { cn } from "@/lib/cn";

export type DonutSlice = { label: string; value: number; color: string };

const SIZE = 200;
const STROKE = 28;
// Leaves room inside the box for a pulled-out segment: 100 - 14 - 7.
const R = SIZE / 2 - STROKE / 2 - 7;
const C = 2 * Math.PI * R;
// A 2px surface gap separates segments; no stroke is drawn around them.
const GAP = 2;
// Far enough to read as lifted, close enough to still sit in the ring.
const PULL = 6;
const EASE_OUT = [0.23, 1, 0.32, 1] as const;
// No bounce: a total that overshoots briefly claims a number that isn't true.
const COUNT = { visualDuration: 0.4, bounce: 0 };

const number = new Intl.NumberFormat("en-US");
const percent = new Intl.NumberFormat("en-US", { style: "percent" });

export function DonutChart({
  data,
  label,
  totalLabel = "Total",
  className,
}: {
  data: DonutSlice[];
  /** Names the chart for screen readers, e.g. "Visits by source". */
  label: string;
  totalLabel?: string;
  className?: string;
}) {
  const reduceMotion = useReducedMotion();
  const ringRef = useRef<SVGSVGElement>(null);
  const inView = useInView(ringRef, { once: true, amount: 0.5 });
  const [hovered, setHovered] = useState<number | null>(null);
  const [pinned, setPinned] = useState<number | null>(null);
  const active = hovered ?? pinned;

  const total = data.reduce((sum, d) => sum + d.value, 0);
  const arcs = data.map((d, i) => {
    const start = (data.slice(0, i).reduce((sum, p) => sum + p.value, 0) / total) * C;
    const length = (d.value / total) * C;
    // Mid-angle in screen space (0 is 3 o'clock), since the ring starts at 12.
    return { start, length, mid: ((start + length / 2) / C) * Math.PI * 2 - Math.PI / 2 };
  });

  const progress = useMotionValue(0);
  const count = useSpring(0, COUNT);
  const shown = useTransform(count, (v) => number.format(Math.round(v)));

  useEffect(() => {
    if (!inView) return;
    if (reduceMotion) {
      progress.jump(1);
      return;
    }
    // A one-time entrance that traces the whole ring. It runs longer than
    // the 300ms UI budget because the sweep itself explains the parts
    // adding up to a whole; nothing waits on it.
    const controls = animate(progress, 1, { duration: 0.8, ease: EASE_OUT });
    return () => controls.stop();
  }, [inView, reduceMotion, progress]);

  const target = active === null ? total : data[active].value;
  useEffect(() => {
    if (!inView) return;
    if (reduceMotion) count.jump(target);
    else count.set(target);
  }, [inView, target, reduceMotion, count]);

  const toggle = (i: number) => setPinned((p) => (p === i ? null : i));
  const centreLabel = active === null ? totalLabel : data[active].label;

  return (
    <div className={cn("flex flex-wrap items-center justify-center gap-x-8 gap-y-6", className)}>
      <div className="relative shrink-0" style={{ width: SIZE, height: SIZE }}>
        <svg
          ref={ringRef}
          aria-hidden
          width={SIZE}
          height={SIZE}
          viewBox={`0 0 ${SIZE} ${SIZE}`}
          className="overflow-visible"
          // Leaving the whole ring resets, not each segment, so sweeping
          // across a gap never flickers the centre back to the total.
          onPointerLeave={(e) => {
            if (e.pointerType !== "touch") setHovered(null);
          }}
        >
          {data.map((d, i) => (
            <Segment
              key={d.label}
              color={d.color}
              start={arcs[i].start}
              length={arcs[i].length}
              mid={arcs[i].mid}
              progress={progress}
              active={active === i}
              dimmed={active !== null && active !== i}
              reduceMotion={!!reduceMotion}
              onPointerEnter={(e) => {
                if (e.pointerType !== "touch") setHovered(i);
              }}
              onClick={() => toggle(i)}
            />
          ))}
        </svg>
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center"
        >
          <motion.span className="text-3xl font-semibold tracking-tight text-foreground tabular-nums">
            {shown}
          </motion.span>
          {/* Remounts on change, so each new name fades in from a soft blur
              instead of snapping. */}
          <span
            key={centreLabel}
            className="max-w-[120px] truncate text-sm text-muted transition-[opacity,filter] duration-200 ease-out starting:opacity-0 starting:blur-[4px]"
          >
            {centreLabel}
          </span>
        </div>
      </div>

      <ul className="flex w-[200px] max-w-full flex-col">
        {data.map((d, i) => (
          <li key={d.label}>
            <button
              type="button"
              aria-pressed={pinned === i}
              onPointerEnter={(e) => {
                if (e.pointerType !== "touch") setHovered(i);
              }}
              onPointerLeave={(e) => {
                if (e.pointerType !== "touch") setHovered(null);
              }}
              // Keyboard focus previews like hover does; a tap's focus shouldn't,
              // or unpinning would leave the segment highlighted.
              onFocus={(e) => {
                if (e.currentTarget.matches(":focus-visible")) setHovered(i);
              }}
              onBlur={() => setHovered(null)}
              onClick={() => toggle(i)}
              className={cn(
                "flex h-9 w-full touch-manipulation items-center gap-2.5 rounded-lg px-2 text-left text-sm transition-[scale,opacity,background-color] duration-150 ease-out select-none focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-foreground active:scale-[0.96] motion-reduce:transition-[opacity,background-color]",
                active !== null && active !== i ? "opacity-40" : "opacity-100",
                pinned === i && "bg-surface",
              )}
            >
              <span aria-hidden className="size-2.5 shrink-0 rounded-[3px]" style={{ background: d.color }} />
              <span className="min-w-0 flex-1 truncate text-foreground">{d.label}</span>
              <span className="text-foreground tabular-nums">{number.format(d.value)}</span>
              <span className="w-9 text-right text-muted tabular-nums">
                {percent.format(d.value / total)}
              </span>
            </button>
          </li>
        ))}
      </ul>

      <table className="sr-only">
        <caption>{label}</caption>
        <thead>
          <tr>
            <th scope="col">Category</th>
            <th scope="col">Value</th>
            <th scope="col">Share</th>
          </tr>
        </thead>
        <tbody>
          {data.map((d) => (
            <tr key={d.label}>
              <th scope="row">{d.label}</th>
              <td>{number.format(d.value)}</td>
              <td>{percent.format(d.value / total)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Segment({
  color,
  start,
  length,
  mid,
  progress,
  active,
  dimmed,
  reduceMotion,
  onPointerEnter,
  onClick,
}: {
  color: string;
  start: number;
  length: number;
  mid: number;
  progress: MotionValue<number>;
  active: boolean;
  dimmed: boolean;
  reduceMotion: boolean;
  onPointerEnter: (e: React.PointerEvent) => void;
  onClick: () => void;
}) {
  // Each segment draws its own share of one sweep, so the ring fills as a
  // single stroke going round rather than every piece growing at once.
  const dash = useTransform(progress, (p) => {
    const drawn = Math.min(Math.max(p * C - start, 0), Math.max(length - GAP, 0));
    return `${drawn} ${C}`;
  });
  const pull = active && !reduceMotion ? PULL : 0;
  const centre = SIZE / 2;

  return (
    <g
      style={{
        transform: `translate(${Math.cos(mid) * pull}px, ${Math.sin(mid) * pull}px)`,
        opacity: dimmed ? 0.3 : 1,
        transition: `transform 200ms cubic-bezier(${EASE_OUT.join(",")}), opacity 150ms ease-out`,
      }}
    >
      {/* A circle's stroke starts at 3 o'clock; turning it starts the ring
          at 12, where people read a pie from. */}
      <g transform={`rotate(-90 ${centre} ${centre})`}>
        <motion.circle
          cx={centre}
          cy={centre}
          r={R}
          fill="none"
          strokeWidth={STROKE}
          strokeDashoffset={-start}
          // Through style, not the attribute: light-dark() and color-mix()
          // are only reliable as CSS values.
          style={{ stroke: color, strokeDasharray: dash }}
          className="cursor-pointer"
          onPointerEnter={onPointerEnter}
          onClick={onClick}
        />
      </g>
    </g>
  );
}

// Validated categorical slots 1 to 4 (adjacent CVD separation >= 8.4 in
// both themes), each stepped for its theme. The tail folds into a neutral
// "Other" rather than a fifth hue.
const SOURCES: DonutSlice[] = [
  { label: "Organic search", value: 4820, color: "light-dark(#2a78d6, #3987e5)" },
  { label: "Direct", value: 3140, color: "light-dark(#eb6834, #d95926)" },
  { label: "Referral", value: 1760, color: "light-dark(#1baf7a, #199e70)" },
  { label: "Social", value: 1190, color: "light-dark(#eda100, #c98500)" },
  { label: "Other", value: 640, color: "color-mix(in oklab, var(--foreground) 22%, transparent)" },
];

export default function DonutChartDemo() {
  return (
    <div className="flex w-[460px] max-w-full flex-col gap-6">
      <div>
        <p className="text-[15px] font-medium text-foreground">Visits by source</p>
        <p className="text-sm text-muted">Last 30 days</p>
      </div>
      <DonutChart data={SOURCES} label="Visits by source, last 30 days" totalLabel="Total visits" />
    </div>
  );
}
