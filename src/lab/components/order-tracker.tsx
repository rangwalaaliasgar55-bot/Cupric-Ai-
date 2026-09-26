import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  animate,
  AnimatePresence,
  motion,
  useMotionValue,
  useTransform,
} from "motion/react";
import { useReducedMotion } from "@/lib/use-reduced-motion";
import { cn } from "@/lib/cn";

export type TrackingStop = {
  label: string;
  // What the latest scan said, shown while this is the current stop.
  detail: string;
  // ISO time the stop was reached. Stops after the current one have none.
  at?: string;
};

type Point = { x: number; y: number };

// The map is drawn 1:1 at the card's full width (540 minus the 8px frame),
// so strokes and icons land on whole pixels on desktop.
const W = 524;
const H = 196;
// Room either side for a centred stop label (88px wide) to stay inside.
const INSET = 48;
// Each stop sits on its own street. Heights alternate so the route reads as
// a drive across town, never a straight progress bar.
const Y = [146, 96, 132, 64, 110];
// Corner radius where the route turns from one street onto the next.
const TURN = 14;
// Samples per turn for the arc-length table: enough that the parcel stays
// within a fraction of a pixel of the drawn curve.
const TURN_SAMPLES = 10;

const EASE_OUT = [0.23, 1, 0.32, 1] as const;
// On-screen travel, so ease-in-out. It is the one thing to watch here, a
// journey between two places, so it runs longer than a UI change.
const TRAVEL = { duration: 1.1, ease: [0.77, 0, 0.175, 1] } as const;
const ROLL = { type: "spring", duration: 0.35, bounce: 0 } as const;
// Stamps lean like they were pressed by hand, each a little differently.
const TILT = [-4, 3, -2, 4, -3];

// Map colours are data, the conventions every street map uses: parks read
// green and water reads blue. Kept faint so the route stays the focus.
const PARK = "light-dark(oklch(0.93 0.05 150), oklch(0.26 0.035 150))";
const WATER = "light-dark(oklch(0.91 0.04 235), oklch(0.26 0.04 240))";

function stopPoints(count: number): Point[] {
  return Array.from({ length: count }, (_, i) => ({
    x: INSET + ((W - INSET * 2) * i) / Math.max(1, count - 1),
    y: Y[i % Y.length],
  }));
}

// Streets meet at right angles, so each leg runs along the stop's street,
// turns onto a cross street halfway, then onto the next stop's street.
function corners(stops: Point[]) {
  const vertices: Point[] = [stops[0]];
  const stopAt = [0];
  for (let i = 1; i < stops.length; i++) {
    const a = stops[i - 1];
    const b = stops[i];
    const mid = (a.x + b.x) / 2;
    if (a.y !== b.y) vertices.push({ x: mid, y: a.y }, { x: mid, y: b.y });
    stopAt.push(vertices.length);
    vertices.push(b);
  }
  return { vertices, stopAt };
}

// Rounds every turn with a quadratic curve. Returns the path for drawing
// and a dense polyline for measuring, both from the same geometry.
function build(stops: Point[]) {
  const { vertices, stopAt } = corners(stops);
  const f = (p: Point) => `${p.x.toFixed(1)} ${p.y.toFixed(1)}`;
  let d = `M${f(vertices[0])}`;
  const points: Point[] = [vertices[0]];
  const stopIndex = [0];
  for (let k = 1; k < vertices.length; k++) {
    const v = vertices[k];
    const prev = vertices[k - 1];
    const next = vertices[k + 1];
    const isStop = stopAt.includes(k);
    if (!next || isStop) {
      d += ` L${f(v)}`;
      points.push(v);
      if (isStop) stopIndex.push(points.length - 1);
      continue;
    }
    const inLen = Math.hypot(v.x - prev.x, v.y - prev.y);
    const outLen = Math.hypot(next.x - v.x, next.y - v.y);
    const r = Math.min(TURN, inLen / 2, outLen / 2);
    const a = { x: v.x - ((v.x - prev.x) / inLen) * r, y: v.y - ((v.y - prev.y) / inLen) * r };
    const b = { x: v.x + ((next.x - v.x) / outLen) * r, y: v.y + ((next.y - v.y) / outLen) * r };
    d += ` L${f(a)} Q${f(v)} ${f(b)}`;
    for (let s = 0; s <= TURN_SAMPLES; s++) {
      const t = s / TURN_SAMPLES;
      const u = 1 - t;
      points.push({
        x: u * u * a.x + 2 * u * t * v.x + t * t * b.x,
        y: u * u * a.y + 2 * u * t * v.y + t * t * b.y,
      });
    }
  }
  return { d, vertices, ...measure(points, stopIndex) };
}

// Arc length along the polyline, pure math, so the server and the client
// draw the parcel in the same place without measuring the DOM.
function measure(points: Point[], stopIndex: number[]) {
  const lengths = [0];
  for (let i = 1; i < points.length; i++) {
    lengths.push(
      lengths[i - 1] + Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y),
    );
  }
  const total = lengths[lengths.length - 1] || 1;
  const pointAt = (fraction: number): Point => {
    const target = Math.max(0, Math.min(1, fraction)) * total;
    let lo = 0;
    let hi = lengths.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (lengths[mid] < target) lo = mid;
      else hi = mid;
    }
    const span = lengths[hi] - lengths[lo] || 1;
    const t = (target - lengths[lo]) / span;
    return {
      x: points[lo].x + (points[hi].x - points[lo].x) * t,
      y: points[lo].y + (points[hi].y - points[lo].y) * t,
    };
  };
  return { pointAt, stops: stopIndex.map((i) => lengths[i] / total) };
}

const DAY = 86_400_000;

export function OrderTracker({
  orderId,
  stops,
  current,
  eta,
  timeZone = "UTC",
  className,
}: {
  orderId: string;
  stops: TrackingStop[];
  // Index of the latest stop reached.
  current: number;
  // ISO time of the promised delivery.
  eta: string;
  // Dates print in the carrier's zone, so server and client agree.
  timeZone?: string;
  className?: string;
}) {
  const reduceMotion = useReducedMotion();
  const geometry = useMemo(() => {
    const points = stopPoints(stops.length);
    return { points, ...build(points) };
  }, [stops.length]);

  const last = stops.length - 1;
  const delivered = current >= last;

  // Fraction of the route travelled. The parcel and the solid line both
  // read it, so they never drift apart.
  const progress = useMotionValue(geometry.stops[current]);
  useEffect(() => {
    const target = geometry.stops[current];
    if (reduceMotion) {
      progress.jump(target);
      return;
    }
    const run = animate(progress, target, TRAVEL);
    return () => run.stop();
  }, [current, geometry, progress, reduceMotion]);
  const parcelX = useTransform(progress, (p) => geometry.pointAt(p).x);
  const parcelY = useTransform(progress, (p) => geometry.pointAt(p).y);

  const format = (iso: string, options: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat("en-US", { timeZone, ...options }).format(new Date(iso));
  // Calendar day number in the carrier's zone, so "today" flips at their
  // midnight rather than at 24 hours.
  const day = (iso: string) => {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "numeric",
      day: "numeric",
    }).formatToParts(new Date(iso));
    const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
    return Date.UTC(get("year"), get("month") - 1, get("day")) / DAY;
  };

  const reachedAt = stops[current]?.at;
  const daysLeft = reachedAt ? Math.max(0, day(eta) - day(reachedAt)) : 0;
  const etaLabel = format(eta, { weekday: "long", month: "short", day: "numeric" });

  const headline = delivered
    ? "delivered"
    : daysLeft === 0
      ? "today"
      : "days";

  const start = geometry.points[0];
  const end = geometry.points[last];
  const streetsY = [...new Set([...geometry.points.map((p) => p.y), 22, 184])];
  const streetsX = geometry.vertices
    .filter((v, i, all) => i > 0 && all[i - 1].x === v.x)
    .map((v) => v.x);

  return (
    <div
      className={cn(
        // 8px frame so the map's 20px corners sit concentric in the 28px card.
        "w-[min(540px,100%)] rounded-[28px] bg-background p-2 shadow-raised",
        className,
      )}
    >
      <div className="px-3 pt-3 pb-4">
        <div className="flex items-baseline justify-between gap-3">
          <p className="text-[13px] text-muted">Order {orderId}</p>
          <p className="text-[13px] text-muted tabular-nums">
            {delivered && reachedAt
              ? format(reachedAt, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })
              : etaLabel}
          </p>
        </div>

        {/* Fixed height, so the map below never moves as the copy changes. */}
        <div className="relative mt-1 h-8 text-2xl font-medium tracking-tight text-foreground">
          <AnimatePresence initial={false} mode="popLayout">
            <motion.p
              key={headline}
              initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 6, filter: "blur(4px)" }}
              animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
              exit={{ opacity: 0, filter: "blur(2px)", transition: { duration: 0.15, ease: EASE_OUT } }}
              transition={{ duration: 0.25, ease: EASE_OUT }}
              className="absolute inset-x-0 top-0 flex items-baseline gap-[0.25em]"
            >
              {headline === "delivered" ? (
                "Delivered"
              ) : headline === "today" ? (
                "Arriving today"
              ) : (
                <>
                  <span>Arriving in</span>
                  <RollingNumber value={daysLeft} />
                  <span>{daysLeft === 1 ? "day" : "days"}</span>
                </>
              )}
            </motion.p>
          </AnimatePresence>
          <span className="sr-only">
            {delivered ? "Delivered" : daysLeft === 0 ? "Arriving today" : `Arriving in ${daysLeft} ${daysLeft === 1 ? "day" : "days"}, ${etaLabel}`}
          </span>
        </div>

        <div className="relative mt-1 h-5 text-sm text-muted">
          <AnimatePresence initial={false} mode="popLayout">
            <motion.p
              key={current}
              aria-live="polite"
              initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 4, filter: "blur(4px)" }}
              animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
              exit={{ opacity: 0, transition: { duration: 0.12 } }}
              // Waits for the parcel to arrive before the news does.
              transition={{ duration: 0.25, ease: EASE_OUT, delay: reduceMotion ? 0 : TRAVEL.duration * 0.6 }}
              className="absolute inset-x-0 top-0 truncate"
            >
              {stops[current]?.detail}
            </motion.p>
          </AnimatePresence>
        </div>
      </div>

      <div className="overflow-hidden rounded-[20px] bg-surface">
        <svg aria-hidden viewBox={`0 0 ${W} ${H}`} className="block w-full">
          {/* Town: a river, two parks, then the streets on top of them. */}
          <path d="M-20 70 C 30 52 60 20 110 -20" fill="none" strokeWidth={22} style={{ stroke: WATER }} />
          <rect x={180} y={-8} width={96} height={64} rx={10} style={{ fill: PARK }} />
          <rect x={332} y={146} width={120} height={70} rx={10} style={{ fill: PARK }} />
          <g className="stroke-background" strokeLinecap="round">
            {streetsY.map((y) => (
              <line key={`h${y}`} x1={-10} x2={W + 10} y1={y} y2={y} strokeWidth={y === 22 || y === 184 ? 4 : 9} />
            ))}
            {streetsX.map((x) => (
              <line key={`v${x}`} x1={x} x2={x} y1={-10} y2={H + 10} strokeWidth={9} />
            ))}
            {geometry.points.map((p) => (
              <line key={`m${p.x}`} x1={p.x} x2={p.x} y1={-10} y2={H + 10} strokeWidth={4} />
            ))}
          </g>

          {/* The road still to drive, then the part already driven. */}
          <path d={geometry.d} fill="none" strokeWidth={4} strokeLinecap="round" strokeLinejoin="round" className="stroke-foreground/20" />
          <motion.path
            d={geometry.d}
            fill="none"
            strokeWidth={4}
            strokeLinecap="round"
            strokeLinejoin="round"
            className="stroke-foreground"
            style={{ pathLength: progress }}
          />

          {geometry.points.map((p, i) => {
            const reached = i <= current;
            const next = i === current + 1;
            return (
              <g key={i} transform={`translate(${p.x} ${p.y})`}>
                {next && (
                  <circle
                    r={8}
                    className="origin-center animate-ping fill-foreground/25 [transform-box:fill-box] motion-reduce:animate-none"
                  />
                )}
                <circle
                  r={6}
                  strokeWidth={2.5}
                  className={cn(
                    "transition-[fill,stroke] duration-200 ease-out",
                    reached
                      ? "fill-foreground stroke-background"
                      : next
                        ? "fill-background stroke-foreground"
                        : "fill-background stroke-foreground/30",
                  )}
                />
              </g>
            );
          })}

          {/* Warehouse: flat roofline and a roller door, so it never reads
              as a second house. The destination is filled, like a map's
              "you are here". */}
          <Badge x={start.x - 30} y={start.y} label="warehouse">
            <path d="M-7.5 7v-9.5l7.5-4 7.5 4v9.5" />
            <path d="M-4.5 7v-6h9v6M-4.5 3h9" />
          </Badge>
          <Badge x={end.x + 30} y={end.y} label="home" filled>
            <path d="M-7 0l7-6.5 7 6.5v7h-14z" />
            <path d="M-2 7v-4.5h4v4.5" />
          </Badge>

          <motion.g style={{ x: parcelX, y: parcelY }}>
            <Pin />
          </motion.g>
        </svg>
      </div>

      <ol className="relative mt-3 mb-2 h-[78px]">
        {stops.map((stop, i) => {
          const x = geometry.points[i].x / W;
          const reached = i <= current && !!stop.at;
          return (
            <li
              key={stop.label}
              aria-current={i === current ? "step" : undefined}
              style={{ left: `${x * 100}%` }}
              // INSET keeps a centred label inside the card, down to 375px.
              className="absolute top-0 flex w-[clamp(56px,17%,88px)] -translate-x-1/2 flex-col items-center gap-1.5 text-center"
            >
              <span
                className={cn(
                  "text-[12px] leading-tight font-medium text-balance transition-[color] duration-200 ease-out sm:text-[13px]",
                  i <= current ? "text-foreground" : "text-muted",
                )}
              >
                {stop.label}
                <span className="sr-only">
                  {reached && stop.at
                    ? `, ${format(stop.at, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}`
                    : i === current + 1
                      ? ", next"
                      : ", pending"}
                </span>
              </span>
              <AnimatePresence initial={false}>
                {reached && stop.at && (
                  <motion.span
                    key={stop.at}
                    aria-hidden
                    // Pressed on like an ink stamp the moment the parcel
                    // gets there: a touch big, then down onto the paper.
                    initial={reduceMotion ? { opacity: 0 } : { opacity: 0, scale: 1.4 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, transition: { duration: 0.12, ease: EASE_OUT } }}
                    transition={{
                      duration: 0.2,
                      ease: EASE_OUT,
                      delay: reduceMotion || i !== current ? 0 : TRAVEL.duration * 0.9,
                    }}
                    style={{ rotate: TILT[i % TILT.length] }}
                    className="flex flex-col items-center rounded-[5px] border border-foreground/45 px-1.5 py-0.5 font-mono text-[12px] leading-[15px] whitespace-nowrap text-foreground/75 uppercase tabular-nums"
                  >
                    <span>{format(stop.at, { month: "short", day: "numeric" })}</span>
                    <span>{format(stop.at, { hour: "2-digit", minute: "2-digit", hourCycle: "h23" })}</span>
                  </motion.span>
                )}
              </AnimatePresence>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

// A map pin carrying a parcel, its tip on the road, with a soft contact
// shadow so it reads as standing on the map rather than pasted over it.
function Pin() {
  return (
    <g>
      <ellipse rx={6} ry={2.5} className="fill-foreground/25" />
      <path
        d="M0 0C-3 -7 -13 -12 -13 -24A13 13 0 1 1 13 -24C13 -12 3 -7 0 0Z"
        strokeWidth={2}
        className="fill-foreground stroke-background"
      />
      <g className="fill-none stroke-background" strokeWidth={1.5} strokeLinejoin="round">
        <rect x={-6} y={-30} width={12} height={11} rx={1.5} />
        <path d="M-6 -26h12M0 -30v4" />
      </g>
    </g>
  );
}

// Where the trip starts and ends, a landmark on the map like a real app's.
function Badge({
  x,
  y,
  label,
  filled = false,
  children,
}: Point & { label: string; filled?: boolean; children: ReactNode }) {
  return (
    <g transform={`translate(${x} ${y})`} data-landmark={label}>
      <circle
        r={15}
        strokeWidth={filled ? 2 : 1}
        className={filled ? "fill-foreground stroke-background" : "fill-background stroke-foreground/15"}
      />
      <g
        className={cn("fill-none", filled ? "stroke-background" : "stroke-foreground")}
        strokeWidth={1.5}
        strokeLinejoin="round"
        strokeLinecap="round"
      >
        {children}
      </g>
    </g>
  );
}

function RollingNumber({ value }: { value: number }) {
  const [previous, setPrevious] = useState(value);
  const [direction, setDirection] = useState(1);
  if (value !== previous) {
    setPrevious(value);
    setDirection(value > previous ? 1 : -1);
  }
  const chars = [...String(value)];
  return (
    <span aria-hidden className="inline-flex tabular-nums">
      {chars.map((char, i) => (
        <Digit key={chars.length - i} char={char} direction={direction} />
      ))}
    </span>
  );
}

function Digit({ char, direction }: { char: string; direction: number }) {
  const reduceMotion = useReducedMotion();
  // Counting down, so the new day drops in from above.
  const offset = (d: number) => (reduceMotion ? "0%" : `${d * 100}%`);
  return (
    <span className="inline-grid overflow-hidden">
      <AnimatePresence initial={false} custom={direction}>
        <motion.span
          key={char}
          custom={direction}
          variants={{
            enter: (d: number) => ({ y: offset(d), opacity: 0 }),
            center: { y: "0%", opacity: 1 },
            exit: (d: number) => ({ y: offset(-d), opacity: 0 }),
          }}
          initial="enter"
          animate="center"
          exit="exit"
          transition={ROLL}
          className="col-start-1 row-start-1"
        >
          {char}
        </motion.span>
      </AnimatePresence>
    </span>
  );
}

const STOPS: (TrackingStop & { at: string })[] = [
  { label: "Ordered", detail: "Order confirmed, payment received", at: "2026-09-21T09:14:00Z" },
  { label: "Packed", detail: "Packed at our Leeds warehouse", at: "2026-09-21T16:40:00Z" },
  { label: "Shipped", detail: "Handed to Parcelway, tracking PW 4471 2093", at: "2026-09-22T08:05:00Z" },
  { label: "Out for delivery", detail: "On the van, 14 stops before yours", at: "2026-09-24T07:12:00Z" },
  { label: "Delivered", detail: "Left with your neighbour at no. 12", at: "2026-09-24T13:36:00Z" },
];

export default function OrderTrackerDemo() {
  const [current, setCurrent] = useState(1);
  const done = current >= STOPS.length - 1;
  return (
    <div className="flex w-[min(540px,100%)] flex-col items-center gap-4">
      <OrderTracker
        orderId="#48213"
        stops={STOPS.map((s, i) => (i <= current ? s : { ...s, at: undefined }))}
        current={current}
        eta="2026-09-24T20:00:00Z"
      />
      <button
        type="button"
        onClick={() => setCurrent((c) => (done ? 0 : c + 1))}
        className="h-10 touch-manipulation rounded-full bg-surface px-4 text-sm font-medium text-foreground shadow-raised outline-hidden transition-[scale] duration-150 ease-out select-none focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-foreground active:scale-[0.96]"
      >
        {done ? "Start over" : "Simulate next update"}
      </button>
    </div>
  );
}
