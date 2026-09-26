import { useEffect, useId, useRef, useState } from "react";
import {
  animate,
  motion,
  motionValue,
  useMotionValue,
  useTransform,
  type AnimationPlaybackControlsWithThen,
  type MotionValue,
} from "motion/react";
import { useReducedMotion } from "@/lib/use-reduced-motion";
import { cn } from "@/lib/cn";

// Panel size when the map unfolds sideways: four panels make a 576px sheet.
const PANEL_W = 144;
const PANEL_H = 340;
// Panel height when it unfolds downward on narrow screens.
const ROW_H = 168;
// Not quite flat: folded panels keep a hair of air between them, like real
// paper, which also stops coplanar faces from z-fighting.
const FOLDED = 178;
const EASE_IN_OUT = [0.77, 0, 0.175, 1] as const;
// Unfolding is a staged reveal of large paper panels, so it runs longer than
// UI motion: each panel takes 480ms and starts when the one before it is
// just past halfway, reading as one continuous pull. Folding is the system
// tidying up, so it runs faster and overlaps more.
const UNFOLD = { duration: 0.48, stagger: 0.28 };
const FOLD = { duration: 0.3, stagger: 0.14 };
const ICON_SWAP = { type: "spring", duration: 0.3, bounce: 0 } as const;

// A printed road map is a physical object, so it keeps its own inks in both
// themes. In dark mode the paper is dimmed, like paper under a lamp, rather
// than inverted.
const PAPER = "light-dark(oklch(0.975 0.012 85), oklch(0.84 0.02 80))";
const PAPER_BACK = "light-dark(oklch(0.95 0.014 85), oklch(0.78 0.02 80))";
const INK = "oklch(0.25 0.012 60)";
const INK_SOFT = "oklch(0.47 0.014 60)";
// The publisher's cover colour and the two map inks: sea and highway red.
const COVER = "light-dark(oklch(0.45 0.12 255), oklch(0.4 0.1 255))";
const COVER_INK = "oklch(0.97 0.01 85)";
const SEA = "light-dark(oklch(0.91 0.035 230), oklch(0.77 0.04 230))";
const ROAD = "oklch(0.57 0.19 30)";
// Fine paper grain: static noise, rendered once by the browser.
const GRAIN = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.85' numOctaves='2' stitchTiles='stitch'/%3E%3CfeColorMatrix values='0 0 0 0 0.3 0 0 0 0 0.25 0 0 0 0 0.2 0 0 0 .09 0'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E")`;

type Stop = { time: string; place: string; x: number; y: number };
type Day = { title: string; stops: Stop[] };

// Catmull-Rom through every stop, converted to cubic Beziers, so the road
// bends smoothly through each one.
function routePath(points: { x: number; y: number }[]) {
  let d = `M${points[0].x} ${points[0].y}`;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[Math.max(i - 1, 0)];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[Math.min(i + 2, points.length - 1)];
    d += `C${p1.x + (p2.x - p0.x) / 6} ${p1.y + (p2.y - p0.y) / 6} ${p2.x - (p3.x - p1.x) / 6} ${p2.y - (p3.y - p1.y) / 6} ${p2.x} ${p2.y}`;
  }
  return d;
}

// One continuous sheet of map art, 576 wide. Each panel shows its own
// slice, so contours, coast and road line up across the creases.
const CONTOURS = [
  "M0 96C70 84 120 108 190 98S320 76 390 92 500 112 576 100",
  "M0 206C80 194 130 218 210 206S330 184 410 198 520 220 576 208",
  "M150 60C200 52 240 70 290 62S380 44 430 58",
  "M300 236C340 228 380 244 430 236S520 222 576 232",
];
const COAST =
  "M0 300C40 292 70 308 112 302S176 286 214 296 282 314 330 304 404 288 446 298 520 314 576 306V340H0Z";
// Side roads branch off the highway and stay in the map band, clear of
// the headings above and the lists below.
const MINOR_ROADS = [
  "M220 170L236 200",
  "M196 96C206 108 214 116 226 122",
  "M360 118L378 94",
  "M406 160C420 176 424 188 440 198",
  "M504 172L494 200",
];

export function FoldedMap({
  title,
  summary,
  days,
  className,
}: {
  title: string;
  summary: string;
  /** Three days fill the sheet: one panel each beside the cover. */
  days: Day[];
  className?: string;
}) {
  const reduceMotion = useReducedMotion();
  const [open, setOpen] = useState(false);
  // Stays true until the last fold lands, so a narrow layout only gives
  // back its height once the paper is closed.
  const [expanded, setExpanded] = useState(false);
  const [vertical, setVertical] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  // 0 is flat, 1 is folded, one per hinge.
  const [hinges] = useState(() => days.map(() => motionValue(1)));
  const running = useRef<AnimationPlaybackControlsWithThen[]>([]);
  const listId = useId();
  const openRef = useRef(false);
  const sheetW = PANEL_W * (days.length + 1);

  // Keeps the visible paper centred while it unfolds: walk the chain of
  // panels, find the right edge of the paper as seen from the front, and
  // shift the sheet by half the unused width. Folded, the cover sits in the
  // middle; flat, the sheet fills the frame.
  const shift = useTransform(hinges, (ps: number[]) => {
    let angle = 0;
    let x = PANEL_W;
    let right = PANEL_W;
    ps.forEach((p, i) => {
      angle += (i % 2 === 0 ? 1 : -1) * p * FOLDED;
      x += PANEL_W * Math.cos((angle * Math.PI) / 180);
      right = Math.max(right, x);
    });
    return (sheetW - right) / 2;
  });
  const zero = useMotionValue(0);

  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      // Squeezed below the full sheet width by max-w-full: unfold downward.
      setVertical(entry.contentRect.width < sheetW - 1);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [sheetW]);

  useEffect(() => () => running.current.forEach((c) => c.stop()), []);

  const toggle = () => {
    const next = !open;
    openRef.current = next;
    setOpen(next);
    running.current.forEach((c) => c.stop());
    if (next) setExpanded(true);
    if (reduceMotion) {
      hinges.forEach((h) => h.jump(next ? 0 : 1));
      if (!next) setExpanded(false);
      return;
    }
    const n = hinges.length;
    running.current = hinges.map((h, i) =>
      animate(h, next ? 0 : 1, {
        duration: next ? UNFOLD.duration : FOLD.duration,
        ease: EASE_IN_OUT,
        // Out from the cover in order; back in from the far end.
        delay: next ? i * UNFOLD.stagger : (n - 1 - i) * FOLD.stagger,
      }),
    );
    if (!next) {
      running.current[0]?.then(() => {
        if (!openRef.current) setExpanded(false);
      });
    }
  };

  const panelW = vertical ? undefined : PANEL_W;
  const panelH = vertical ? ROW_H : PANEL_H;

  return (
    <div
      ref={root}
      className={cn(
        "relative max-w-full select-none",
        // Panels tipping toward the viewer grow a little in perspective;
        // on a phone-width column that must not widen the page. The margin
        // keeps the paper's edge shadow.
        vertical && "overflow-x-clip [overflow-clip-margin:8px]",
        className,
      )}
      style={{
        width: sheetW,
        perspective: 1400,
        height: vertical
          ? expanded
            ? ROW_H * (days.length + 1)
            : ROW_H
          : PANEL_H,
      }}
    >
      <motion.div
        className="absolute inset-y-0 left-0"
        style={{
          x: vertical ? zero : shift,
          width: vertical ? "100%" : PANEL_W,
          transformStyle: "preserve-3d",
        }}
      >
        {/* The folded panels' edges, stacked behind the cover: the map's
            thickness, and a hint that there is more paper in there. */}
        <FoldedEdges
          count={days.length}
          progress={hinges[0]}
          width={panelW}
          height={panelH}
          vertical={vertical}
        />
        <div
          className="relative"
          style={{
            width: panelW ?? "100%",
            height: panelH,
            transformStyle: "preserve-3d",
          }}
        >
          <Cover
            title={title}
            summary={summary}
            vertical={vertical}
            open={open}
            listId={listId}
            onToggle={toggle}
          />
          {/* Folded panels stay out of the tab order and reading order. */}
          <Hinge
            id={listId}
            inert={!open}
            depth={0}
            days={days}
            hinges={hinges}
            parentWorld={null}
            vertical={vertical}
            height={panelH}
          />
        </div>
      </motion.div>
    </div>
  );
}

function Paper({
  className,
  back,
  style,
  children,
}: {
  className?: string;
  back?: boolean;
  style?: React.CSSProperties;
  children?: React.ReactNode;
}) {
  return (
    <div
      className={cn("absolute inset-0 overflow-hidden rounded-[2px]", className)}
      style={{
        backgroundColor: back ? PAPER_BACK : PAPER,
        backgroundImage: GRAIN,
        color: INK,
        ...style,
      }}
    >
      {children}
    </div>
  );
}

function Cover({
  title,
  summary,
  vertical,
  open,
  listId,
  onToggle,
}: {
  title: string;
  summary: string;
  vertical: boolean;
  open: boolean;
  listId: string;
  onToggle: () => void;
}) {
  return (
    <Paper className="flex flex-col shadow-raised">
      <div
        className={cn(
          "relative flex px-3.5",
          vertical ? "flex-row items-start gap-3 pt-3 pb-3.5" : "flex-col pt-3.5 pb-4",
        )}
        style={{ backgroundColor: COVER, color: COVER_INK }}
      >
        <div className="min-w-0 flex-1">
          <p className="flex items-center justify-between text-xs font-medium tracking-[0.08em] uppercase opacity-75">
            <span>Road map</span>
            {!vertical && <span className="tabular-nums">No. 03</span>}
          </p>
          <h3 className="mt-2 text-xl leading-[1.1] font-semibold tracking-[-0.01em] text-balance">
            {title}
          </h3>
          <p className="mt-1.5 text-[13px] opacity-80">{summary}</p>
        </div>
        {vertical && <MiniMap className="h-[72px] w-[96px] shrink-0" />}
        {/* The thin printed rule under the band that map covers carry. */}
        <span
          aria-hidden
          className="absolute inset-x-0 bottom-0 h-[3px]"
          style={{ backgroundColor: ROAD }}
        />
      </div>
      {!vertical && (
        <div className="flex flex-1 flex-col px-3.5 pt-3.5">
          <MiniMap className="h-[104px] w-full" />
          <ScaleBar />
        </div>
      )}
      <div className={cn("px-3.5 pb-3.5", vertical && "mt-auto")}>
        <button
          type="button"
          aria-expanded={open}
          aria-controls={listId}
          onClick={onToggle}
          className="relative flex h-10 w-full items-center justify-center gap-1.5 rounded-full text-sm font-medium outline-hidden transition-[scale] duration-150 ease-out focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 active:scale-[0.96] motion-reduce:transition-none"
          style={{
            backgroundColor: INK,
            color: COVER_INK,
            outlineColor: INK,
          }}
        >
          <span className="grid">
            <Label visible={!open}>Unfold</Label>
            <Label visible={open}>Fold</Label>
          </span>
          <span className="relative size-4">
            <SwapIcon visible={!open}>
              <path d={vertical ? "M4 6.5l4 4 4-4" : "M6.5 4l4 4-4 4"} />
            </SwapIcon>
            <SwapIcon visible={open}>
              <path d={vertical ? "M4 9.5l4-4 4 4" : "M9.5 4l-4 4 4 4"} />
            </SwapIcon>
          </span>
        </button>
      </div>
    </Paper>
  );
}

// The whole trip in miniature on the cover, with a north arrow.
function MiniMap({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden
      viewBox="150 40 420 300"
      preserveAspectRatio="xMidYMid slice"
      className={cn("rounded-[2px]", className)}
      fill="none"
      style={{
        backgroundColor: PAPER,
        boxShadow: "0 0 0 1px oklch(0 0 0 / 0.12)",
      }}
    >
      <path d={COAST} style={{ fill: SEA }} />
      {CONTOURS.map((d) => (
        <path key={d} d={d} stroke={INK} strokeOpacity={0.14} strokeWidth={3} />
      ))}
      <path d={ROUTE} stroke={ROAD} strokeWidth={9} strokeLinecap="round" />
      {[DAYS[0].stops[0], DAYS[2].stops[2]].map((s) => (
        <circle
          key={s.place}
          cx={s.x}
          cy={s.y}
          r={12}
          style={{ fill: PAPER }}
          stroke={INK}
          strokeWidth={6}
        />
      ))}
      <path
        d="M540 216L550 250L540 243L530 250Z"
        fill={INK}
        stroke={INK}
        strokeWidth={4}
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ScaleBar() {
  return (
    <div
      aria-hidden
      className="mt-3 flex items-center gap-2 text-xs"
      style={{ color: INK_SOFT }}
    >
      <span
        className="flex h-1.5 w-12 overflow-hidden rounded-[1px]"
        style={{ boxShadow: `0 0 0 1px ${INK}` }}
      >
        <span className="flex-1" style={{ backgroundColor: INK }} />
        <span className="flex-1" />
        <span className="flex-1" style={{ backgroundColor: INK }} />
      </span>
      <span className="tabular-nums">50 km</span>
    </div>
  );
}

function FoldedEdges({
  count,
  progress,
  width,
  height,
  vertical,
}: {
  count: number;
  progress: MotionValue<number>;
  width?: number;
  height: number;
  vertical: boolean;
}) {
  // Gone by the time the first panel has swung a sixth of the way.
  const opacity = useTransform(progress, [0.82, 0.97], [0, 1]);
  return (
    <>
      {Array.from({ length: count }, (_, i) => {
        // Each folded panel sits a hair further back and out.
        const offset = (count - i) * 2;
        return (
          <motion.div
            key={i}
            aria-hidden
            className="absolute top-0 left-0 rounded-[2px]"
            style={{
              width: width ?? "100%",
              height,
              opacity,
              x: vertical ? 0 : offset,
              y: vertical ? offset : offset / 2,
              backgroundColor: PAPER_BACK,
              boxShadow:
                "0 0 0 1px oklch(0 0 0 / 0.1), 0 2px 6px -2px oklch(0 0 0 / 0.2)",
            }}
          />
        );
      })}
    </>
  );
}

function Hinge({
  id,
  inert,
  depth,
  days,
  hinges,
  parentWorld,
  vertical,
  height,
}: {
  id?: string;
  inert?: boolean;
  depth: number;
  days: Day[];
  hinges: MotionValue<number>[];
  parentWorld: MotionValue<number> | null;
  vertical: boolean;
  height: number;
}) {
  const progress = hinges[depth];
  const zero = useMotionValue(0);
  // Accordion folds alternate direction. The first panel tucks behind the
  // cover, so the cover and its button stay on top when folded.
  const sign = depth % 2 === 0 ? 1 : -1;
  const aroundY = useTransform(progress, (p) => p * FOLDED * sign);
  const aroundX = useTransform(progress, (p) => -p * FOLDED * sign);
  // Only |cos| of this is used, so the horizontal angles serve both layouts.
  const world = useTransform(
    [parentWorld ?? zero, aroundY],
    ([a, b]: number[]) => a + b,
  );
  // Lit from the front: a panel turned edge-on catches the least light.
  const shade = useTransform(
    world,
    (a) => (1 - Math.abs(Math.cos((a * Math.PI) / 180))) * 0.4,
  );
  const day = days[depth];
  const last = depth === days.length - 1;
  // Accordion creases alternate valley and mountain, so the light falls on
  // opposite sides of neighbouring creases even once the map lies flat.
  const angle = vertical ? "180deg" : "90deg";
  const crease =
    depth % 2 === 0
      ? `linear-gradient(${angle}, oklch(0 0 0 / 0.09), transparent 14px)`
      : `linear-gradient(${angle}, oklch(1 0 0 / 0.45), transparent 10px)`;

  return (
    <motion.div
      id={id}
      inert={inert}
      role="group"
      aria-label={`Day ${depth + 1}, ${day.title}`}
      className={cn(
        "absolute",
        vertical ? "top-full left-0 w-full" : "top-0 left-full",
      )}
      style={{
        width: vertical ? undefined : PANEL_W,
        height,
        transformStyle: "preserve-3d",
        transformOrigin: vertical ? "50% 0" : "0 50%",
        rotateY: vertical ? zero : aroundY,
        rotateX: vertical ? aroundX : zero,
      }}
    >
      <Paper className="shadow-raised" style={{ backfaceVisibility: "hidden" }}>
        <MapSlice index={depth + 1} vertical={vertical} />
        <DayContent index={depth} day={day} vertical={vertical} />
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{ backgroundImage: crease }}
        />
        <motion.div
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{ opacity: shade, backgroundColor: INK }}
        />
      </Paper>
      {/* The blank back of the paper, seen while a panel is past edge-on. */}
      <Paper
        back
        style={{
          backfaceVisibility: "hidden",
          transform: vertical ? "rotateX(180deg)" : "rotateY(180deg)",
        }}
      >
        <motion.div
          className="absolute inset-0"
          style={{ opacity: shade, backgroundColor: INK }}
        />
      </Paper>
      {!last && (
        <Hinge
          depth={depth + 1}
          days={days}
          hinges={hinges}
          parentWorld={world}
          vertical={vertical}
          height={height}
        />
      )}
    </motion.div>
  );
}

function DayContent({
  index,
  day,
  vertical,
}: {
  index: number;
  day: Day;
  vertical: boolean;
}) {
  return (
    <div
      className={cn(
        "relative flex h-full p-3.5",
        vertical ? "flex-row gap-3 pr-[92px]" : "flex-col",
      )}
    >
      <div className={cn(vertical && "w-[42%] shrink-0")}>
        <p
          className="text-xs font-semibold tracking-[0.08em] uppercase"
          style={{ color: ROAD }}
        >
          Day {index + 1}
        </p>
        <h4 className="mt-1 text-[15px] leading-snug font-semibold text-balance">
          {day.title}
        </h4>
      </div>
      <ul
        className={cn(
          "flex flex-col gap-2",
          vertical ? "justify-center" : "mt-auto",
        )}
      >
        {day.stops.map((s) => (
          <li key={s.place} className="flex h-9 flex-col justify-center">
            <span
              className="font-mono text-xs tabular-nums"
              style={{ color: INK_SOFT }}
            >
              {s.time}
            </span>
            <span className="text-sm leading-tight font-medium">
              {s.place}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// The shared sheet art, cropped to one panel. Sideways the sheet is 576
// wide; downward it becomes a strip down the right edge of every row, with
// each stop level with its line in the list.
function MapSlice({ index, vertical }: { index: number; vertical: boolean }) {
  if (vertical) {
    return (
      <svg
        aria-hidden
        viewBox={`0 ${index * ROW_H} 80 ${ROW_H}`}
        className="pointer-events-none absolute top-0 right-3 h-full w-20"
        fill="none"
      >
        <path d={ROUTE_V} style={{ stroke: PAPER }} strokeWidth={6} strokeLinecap="round" />
        <path d={ROUTE_V} stroke={ROAD} strokeWidth={2.5} strokeLinecap="round" />
        {STOPS_V.map((s) => (
          <circle
            key={s.place}
            cx={s.x}
            cy={s.y}
            r={4}
            strokeWidth={2}
            style={{ fill: PAPER }}
            stroke={INK}
          />
        ))}
      </svg>
    );
  }
  return (
    <svg
      aria-hidden
      viewBox={`${index * PANEL_W} 0 ${PANEL_W} ${PANEL_H}`}
      className="pointer-events-none absolute inset-0 size-full"
      fill="none"
    >
      <path d={COAST} style={{ fill: SEA }} />
      {/* The printed grid every map sheet carries. */}
      {[48, 96, 144, 192, 240, 288].map((y) => (
        <line key={y} x1={0} x2={576} y1={y} y2={y} stroke={INK} strokeOpacity={0.05} />
      ))}
      {CONTOURS.map((d) => (
        <path key={d} d={d} stroke={INK} strokeOpacity={0.1} />
      ))}
      {MINOR_ROADS.map((d) => (
        <path key={d} d={d} stroke={INK} strokeOpacity={0.22} />
      ))}
      {/* A cased highway: a paper-coloured casing under the red road. */}
      <path d={ROUTE} style={{ stroke: PAPER }} strokeWidth={6} strokeLinecap="round" />
      <path d={ROUTE} stroke={ROAD} strokeWidth={2.5} strokeLinecap="round" />
      {DAYS.flatMap((d) => d.stops).map((s) => (
        <circle
          key={s.place}
          cx={s.x}
          cy={s.y}
          r={4}
          strokeWidth={2}
          style={{ fill: PAPER }}
          stroke={INK}
        />
      ))}
    </svg>
  );
}

function Label({
  visible,
  children,
}: {
  visible: boolean;
  children: React.ReactNode;
}) {
  return (
    <span
      aria-hidden={!visible}
      className={cn(
        "col-start-1 row-start-1 text-center transition-[opacity,filter] duration-200 ease-out",
        !visible && "opacity-0 blur-[4px]",
      )}
    >
      {children}
    </span>
  );
}

function SwapIcon({
  visible,
  children,
}: {
  visible: boolean;
  children: React.ReactNode;
}) {
  return (
    <motion.svg
      viewBox="0 0 16 16"
      className="absolute inset-0 size-4"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      initial={false}
      animate={
        visible
          ? { scale: 1, opacity: 1, filter: "blur(0px)" }
          : { scale: 0.25, opacity: 0, filter: "blur(4px)" }
      }
      transition={ICON_SWAP}
    >
      {children}
    </motion.svg>
  );
}

// Stops sit in the band between each panel's heading and its list.
const DAYS: Day[] = [
  {
    title: "Porto to Costa Nova",
    stops: [
      { time: "09:00", place: "Ribeira", x: 172, y: 122 },
      { time: "13:30", place: "Aveiro", x: 220, y: 170 },
      { time: "18:00", place: "Costa Nova", x: 264, y: 132 },
    ],
  },
  {
    title: "Coimbra and the coast",
    stops: [
      { time: "10:00", place: "Coimbra", x: 312, y: 174 },
      { time: "15:00", place: "Nazaré", x: 360, y: 118 },
      { time: "19:30", place: "Óbidos", x: 406, y: 160 },
    ],
  },
  {
    title: "Sintra to Lisbon",
    stops: [
      { time: "09:30", place: "Sintra", x: 458, y: 124 },
      { time: "14:00", place: "Cascais", x: 504, y: 172 },
      { time: "18:30", place: "Lisbon", x: 548, y: 140 },
    ],
  },
];

const ROUTE = routePath(DAYS.flatMap((d) => d.stops));
// The downward strip: each stop level with its line in the row's list
// (three 36px lines, 8px apart, centred in a 168px row: 40, 84, 128), and
// wandering sideways as the sideways route wanders up and down.
const STOPS_V = DAYS.flatMap((d, di) =>
  d.stops.map((s, k) => ({
    place: s.place,
    x: 18 + ((s.y - 118) / 56) * 44,
    y: ROW_H * (di + 1) + 40 + k * 44,
  })),
);
const ROUTE_V = routePath(STOPS_V);

export default function FoldedMapDemo() {
  return (
    <FoldedMap title="Porto to Lisbon" summary="3 days, 412 km" days={DAYS} />
  );
}
