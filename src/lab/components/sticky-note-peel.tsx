import { useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import {
  animate,
  motion,
  useMotionValue,
  useTransform,
  type AnimationPlaybackControls,
  type MotionValue,
} from "motion/react";
import { useReducedMotion } from "@/lib/use-reduced-motion";
import { Caveat } from "@/lab/shims/next-font";
import { cn } from "@/lib/cn";

// A marker hand for what is written on the notes. Only the note text uses
// it; the Done button stays in the interface font because it is chrome.
// Not preloaded: the index bundles every preview, and other pages should
// not fetch a font they never draw. The browser loads it on first use.
const hand = Caveat({
  subsets: ["latin"],
  weight: ["500", "600"],
  preload: false,
});

export type Reminder = {
  id: number;
  title: string;
  detail: string;
  // A short scribble in the top corner, like "Fri" or "9am".
  due?: string;
};

type Pt = { x: number; y: number };
type Flight = {
  key: number;
  note: Reminder;
  index: number;
  dx: number;
  dy: number;
  vx: number;
  vy: number;
  w: number;
  h: number;
};

// A permanent dog-ear on the top note says "this corner lifts".
const REST = 14;
// Hovering the corner lifts it a little further, as if your thumb found it.
const HOVER = 22;
// Released past this share of the diagonal, the note comes away.
const COMMIT = 0.5;
// A flick toward the far corner peels it however short the drag (px/s).
const FLICK = 600;
// How far the corner may be dragged past the note's own edges, as a share of
// its size. Keeps the flap from ever widening the page.
const OVERDRAG = 0.1;
// How far along its path a leaving note keeps peeling while it falls.
const LEAVE_DISTANCE = 1.25;
// Holds the corner to the finger with just enough give to feel like paper.
const SETTLE = { type: "spring", stiffness: 500, damping: 34 } as const;
const PEEL_AWAY = { type: "spring", stiffness: 170, damping: 26 } as const;
const EASE_OUT = [0.23, 1, 0.32, 1] as const;
// Gravity: the drop gathers speed, which is the one place ease-in is right.
const FALL = [0.5, 0, 0.75, 0] as const;
const SHOWN_BEHIND = 3;

// Each note sits slightly askew, like a real pad that has been handled.
const TILTS = [-1.2, 1.4, -0.6, 2, -1.8];
// Sticky-note paper is a physical material, so these are raw colors on
// purpose: the classic canary, then pink, mint, sky and peach pads. The dark
// theme gets the same paper under dimmer light instead of a glaring pastel.
const PAPERS = [
  "light-dark(oklch(0.95 0.105 99), oklch(0.83 0.1 96))",
  "light-dark(oklch(0.91 0.065 8), oklch(0.8 0.065 8))",
  "light-dark(oklch(0.93 0.07 158), oklch(0.81 0.065 158))",
  "light-dark(oklch(0.92 0.05 232), oklch(0.8 0.05 232))",
  "light-dark(oklch(0.93 0.075 62), oklch(0.82 0.075 62))",
];
// Ballpoint ink. The paper is light in both themes, so the ink is too.
const INK = "oklch(0.29 0.045 262)";
const tiltOf = (i: number) => TILTS[i % TILTS.length];

const dot = (a: Pt, b: Pt) => a.x * b.x + a.y * b.y;

// Keeps the part of a convex polygon on one side of the fold line.
function clipSide(poly: Pt[], m: Pt, n: Pt, keepCorner: boolean) {
  const out: Pt[] = [];
  const side = (p: Pt) => dot({ x: p.x - m.x, y: p.y - m.y }, n);
  const inside = (d: number) => (keepCorner ? d > 0 : d <= 0);
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const da = side(a);
    const db = side(b);
    if (inside(da)) out.push(a);
    if (inside(da) !== inside(db)) {
      const t = da / (da - db);
      out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
    }
  }
  return out;
}

const toPolygon = (pts: Pt[]) =>
  pts.length < 3
    ? "polygon(0px 0px, 0px 0px, 0px 0px)"
    : `polygon(${pts.map((p) => `${p.x.toFixed(2)}px ${p.y.toFixed(2)}px`).join(", ")})`;

// The bottom-right corner C is lifted to P. The fold is the perpendicular
// bisector of CP: what lies past it is flipped over the line and shows its
// back. Reflection across a line is a single affine matrix, so the flap is
// just the same sheet, clipped and mirrored.
function fold(w: number, h: number, dx: number, dy: number) {
  const rect = [
    { x: 0, y: 0 },
    { x: w, y: 0 },
    { x: w, y: h },
    { x: 0, y: h },
  ];
  const len = Math.hypot(dx, dy);
  if (len < 0.5) {
    return {
      flat: toPolygon(rect),
      back: toPolygon([]),
      matrix: "none",
      crease: "none",
    };
  }
  const n = { x: -dx / len, y: -dy / len };
  const m = { x: w + dx / 2, y: h + dy / 2 };
  const k = 2 * dot(m, n);
  const a = 1 - 2 * n.x * n.x;
  const b = -2 * n.x * n.y;
  const d = 1 - 2 * n.y * n.y;
  // Lays a strip along the fold whose local +y points into the flap, so a
  // top-to-bottom gradient shades the paper right where it bends.
  const angle = Math.atan2(-n.x, n.y);
  const span = w + h;
  return {
    flat: toPolygon(clipSide(rect, m, n, false)),
    back: toPolygon(clipSide(rect, m, n, true)),
    matrix: `matrix(${a}, ${b}, ${b}, ${d}, ${k * n.x}, ${k * n.y})`,
    crease: `translate(${m.x}px, ${m.y}px) rotate(${angle}rad) translate(${-span}px, 0px)`,
  };
}

function usePeel(
  dx: MotionValue<number>,
  dy: MotionValue<number>,
  w: MotionValue<number>,
  h: MotionValue<number>,
) {
  const geo = useTransform(() => fold(w.get(), h.get(), dx.get(), dy.get()));
  return {
    flat: useTransform(geo, (g) => g.flat),
    back: useTransform(geo, (g) => g.back),
    matrix: useTransform(geo, (g) => g.matrix),
    crease: useTransform(geo, (g) => g.crease),
  };
}

export function StickyNotePeel({
  notes: initial,
  onDone,
  className,
}: {
  notes: Reminder[];
  onDone?: (note: Reminder) => void;
  className?: string;
}) {
  const reduceMotion = useReducedMotion();
  const [notes, setNotes] = useState(initial);
  const [flights, setFlights] = useState<Flight[]>([]);
  const flightKey = useRef(0);
  const root = useRef<HTMLDivElement>(null);
  const moveFocus = useRef(false);

  // The top note's lifted corner, as an offset from its bottom-right.
  const dx = useMotionValue(-REST);
  const dy = useMotionValue(-REST);
  // Every other note gets these, never nothing: Motion would keep the old
  // curl on a note that stopped receiving values.
  const flat = useMotionValue(0);
  // Measured, so the fold stays exact at any width.
  const w = useMotionValue(300);
  const h = useMotionValue(300);
  const spring = useRef<AnimationPlaybackControls[]>([]);

  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      w.set(entry.contentRect.width);
      h.set(entry.contentRect.height);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [w, h]);

  useEffect(() => {
    const list = spring.current;
    return () => list.forEach((c) => c.stop());
  }, []);

  // After a note leaves, keyboard focus follows to the next one.
  useEffect(() => {
    if (!moveFocus.current) return;
    moveFocus.current = false;
    root.current?.parentElement
      ?.querySelector<HTMLElement>("[data-next-focus]")
      ?.focus();
  }, [notes]);

  const settle = (x: number, y: number, vx = 0, vy = 0) => {
    spring.current.forEach((c) => c.stop());
    if (reduceMotion) {
      dx.jump(x);
      dy.jump(y);
      return;
    }
    spring.current = [
      animate(dx, x, { ...SETTLE, velocity: vx }),
      animate(dy, y, { ...SETTLE, velocity: vy }),
    ];
  };

  const peelOff = (vx = 0, vy = 0) => {
    const [top] = notes;
    if (!top) return;
    const flight: Flight = {
      key: flightKey.current++,
      note: top,
      index: initial.indexOf(top),
      dx: dx.get(),
      dy: dy.get(),
      vx,
      vy,
      w: w.get(),
      h: h.get(),
    };
    spring.current.forEach((c) => c.stop());
    // The stack advances at once; the peeled copy finishes leaving on its
    // own, so the next note can be grabbed straight away.
    flushSync(() => {
      setNotes((list) => list.slice(1));
      setFlights((list) => [...list, flight]);
    });
    // The next note starts flat and lifts its own dog-ear.
    dx.jump(0);
    dy.jump(0);
    settle(-REST, -REST);
    onDone?.(top);
  };

  const top = notes[0];

  const release = (vx: number, vy: number) => {
    const x = dx.get();
    const y = dy.get();
    const len = Math.hypot(x, y);
    const diag = Math.hypot(w.get(), h.get());
    // Speed toward the far corner counts, not speed in any direction.
    const toward = (vx * x + vy * y) / (len || 1);
    // 24px: a tap-sized wobble on the corner never counts as a flick.
    if (len > diag * COMMIT || (len > 24 && toward > FLICK)) {
      peelOff(vx, vy);
    } else {
      settle(-REST, -REST, vx, vy);
    }
  };

  return (
    <div className={cn("flex w-[min(320px,100%)] flex-col gap-5", className)}>
      <div ref={root} className="relative aspect-square w-full">
        {notes.length === 0 && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 rounded-[4px] border-2 border-dashed border-foreground/10 text-center transition-[opacity,filter] duration-300 ease-out starting:opacity-0 starting:blur-[4px]">
            <p className={cn(hand.className, "text-[28px] leading-none font-semibold text-muted")}>
              All caught up
            </p>
            <button
              type="button"
              data-next-focus
              onClick={() => setNotes(initial)}
              className="h-9 touch-manipulation rounded-full bg-surface px-4 text-sm font-medium text-foreground shadow-raised outline-hidden transition-[scale] duration-150 ease-out select-none focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-foreground active:scale-[0.96] motion-reduce:transition-none"
            >
              Restore notes
            </button>
          </div>
        )}

        {notes
          .slice(0, SHOWN_BEHIND + 1)
          .reverse()
          .map((note) => {
            const index = initial.indexOf(note);
            // One list with stable keys, so a note moving up to the top keeps
            // its element instead of remounting.
            if (note !== top) {
              return (
                <Sheet
                  key={note.id}
                  note={note}
                  index={index}
                  dx={flat}
                  dy={flat}
                  w={w}
                  h={h}
                  buried
                />
              );
            }
            return (
              <Sheet
                key={note.id}
                note={note}
                index={index}
                dx={dx}
                dy={dy}
                w={w}
                h={h}
                onDone={() => {
                  moveFocus.current = true;
                  peelOff();
                }}
                corner={
                  <Corner
                    tilt={tiltOf(index)}
                    dx={dx}
                    dy={dy}
                    w={w}
                    h={h}
                    settle={settle}
                    stop={() => spring.current.forEach((c) => c.stop())}
                    onRelease={release}
                  />
                }
              />
            );
          })}

        {flights.map((flight) => (
          <Leaving
            key={flight.key}
            flight={flight}
            reduce={!!reduceMotion}
            onGone={() =>
              setFlights((list) => list.filter((f) => f.key !== flight.key))
            }
          />
        ))}
      </div>

      <p className="text-center text-sm text-muted tabular-nums" aria-live="polite">
        {notes.length === 0
          ? "No reminders left"
          : `${notes.length} reminder${notes.length === 1 ? "" : "s"} left`}
      </p>
    </div>
  );
}

function Sheet({
  note,
  index,
  dx,
  dy,
  w,
  h,
  buried,
  onDone,
  corner,
  style,
}: {
  note: Reminder;
  index: number;
  dx: MotionValue<number>;
  dy: MotionValue<number>;
  w: MotionValue<number>;
  h: MotionValue<number>;
  buried?: boolean;
  onDone?: () => void;
  corner?: React.ReactNode;
  style?: React.ComponentProps<typeof motion.div>["style"];
}) {
  const { flat, back, matrix, crease } = usePeel(dx, dy, w, h);
  const paper = PAPERS[index % PAPERS.length];

  return (
    <motion.div
      role={buried ? undefined : "group"}
      aria-label={buried ? undefined : note.title}
      aria-hidden={buried || undefined}
      inert={buried || undefined}
      style={{ rotate: tiltOf(index), ...style }}
      className="absolute inset-0"
    >
      {/* Shadow as a filter on a wrapper, so it follows the clipped shape
          instead of being cut away with it. Only the adhesive strip is
          stuck down, so the free bottom edge lifts and throws a longer
          shadow than the top. */}
      <div className="absolute inset-0 [filter:drop-shadow(0_1px_1px_oklch(0_0_0/0.1))_drop-shadow(0_10px_10px_oklch(0_0_0/0.09))] dark:[filter:drop-shadow(0_1px_1px_oklch(0_0_0/0.5))_drop-shadow(0_10px_14px_oklch(0_0_0/0.55))]">
        <motion.div
          style={{ clipPath: flat, backgroundColor: paper, color: INK }}
          className="absolute inset-0 flex flex-col p-6 pt-9"
        >
          {/* The adhesive strip reads as a slightly glossier band, and the
              lifted bottom edge catches a little less light. */}
          <span
            aria-hidden
            className="absolute inset-x-0 top-0 h-8 bg-linear-to-b from-black/[0.045] to-black/[0.015]"
          />
          <span
            aria-hidden
            className="absolute inset-x-0 bottom-0 h-16 bg-linear-to-t from-black/[0.05] to-transparent"
          />
          {note.due && (
            <span
              className={cn(
                hand.className,
                "absolute top-9 right-5 grid h-11 min-w-16 place-items-center px-2 text-[22px] leading-none font-semibold",
              )}
            >
              {/* Circled in red marker, the way you flag the one that is
                  due. Red marker is a physical ink, so it is a raw color. */}
              <svg
                aria-hidden
                viewBox="0 0 64 44"
                preserveAspectRatio="none"
                className="absolute inset-0 size-full overflow-visible"
                fill="none"
                stroke="oklch(0.56 0.19 27)"
                strokeWidth={1.8}
                strokeLinecap="round"
              >
                <path d="M40 5C22 2 5 9 4 22c-1 12 16 19 32 17 15-2 25-9 24-19C59 10 47 4 30 6" />
              </svg>
              <span className="sr-only">Due </span>
              {note.due}
            </span>
          )}
          <p
            className={cn(
              hand.className,
              "relative text-[30px] leading-[1.05] font-semibold text-balance",
              note.due && "pr-16",
            )}
          >
            {note.title}
          </p>
          <p
            className={cn(
              hand.className,
              "relative mt-2.5 text-[22px] leading-[1.15] font-medium text-pretty opacity-75",
            )}
          >
            {note.detail}
          </p>
          {!buried && (
            <button
              type="button"
              data-next-focus
              onClick={onDone}
              className="relative mt-auto flex h-9 w-fit touch-manipulation items-center gap-2 rounded-full bg-black/[0.07] pr-4 pl-3 text-sm font-medium outline-hidden transition-[scale,background-color] duration-150 ease-out select-none hover:bg-black/[0.11] focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-current active:scale-[0.96] motion-reduce:transition-none"
            >
              <svg
                viewBox="0 0 16 16"
                className="size-4"
                fill="none"
                stroke="currentColor"
                strokeWidth={1.75}
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden
              >
                <path d="m3.5 8.5 3 3 6-7" />
              </svg>
              Done
            </button>
          )}
        </motion.div>
      </div>

      {/* The flap: the same sheet mirrored across the fold, back side up. The
          back of sticky paper is the same color, only matte and in its own
          shade. It lifts off the page, so it casts its own tighter shadow. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 [filter:drop-shadow(-1px_2px_2px_oklch(0_0_0/0.18))] dark:[filter:drop-shadow(-1px_2px_3px_oklch(0_0_0/0.6))]"
      >
        <motion.div
          style={{
            clipPath: back,
            transform: matrix,
            backgroundColor: `color-mix(in oklch, ${paper} 90%, oklch(0.4 0.02 80))`,
          }}
          className="absolute inset-0 origin-top-left overflow-hidden"
        >
          <motion.span
            style={{ transform: crease }}
            className="absolute top-0 left-0 h-10 w-[1200px] origin-top-left bg-linear-to-b from-black/[0.14] to-transparent"
          />
          <span className="absolute inset-0 bg-linear-to-br from-white/25 to-transparent" />
        </motion.div>
      </div>

      {corner}
    </motion.div>
  );
}

function Corner({
  tilt,
  dx,
  dy,
  w,
  h,
  settle,
  stop,
  onRelease,
}: {
  tilt: number;
  dx: MotionValue<number>;
  dy: MotionValue<number>;
  w: MotionValue<number>;
  h: MotionValue<number>;
  settle: (x: number, y: number) => void;
  stop: () => void;
  onRelease: (vx: number, vy: number) => void;
}) {
  const drag = useRef<{ id: number; x: number; y: number; dx: number; dy: number } | null>(null);
  // The sheet is tilted, so screen movement is turned into the sheet's own
  // axes before it moves the corner.
  const theta = (-tilt * Math.PI) / 180;
  const local = (x: number, y: number) => ({
    x: x * Math.cos(theta) - y * Math.sin(theta),
    y: x * Math.sin(theta) + y * Math.cos(theta),
  });

  const end = (e: React.PointerEvent) => {
    if (drag.current?.id !== e.pointerId) return;
    drag.current = null;
    // Already in the sheet's own axes, since that is what was set.
    onRelease(dx.getVelocity(), dy.getVelocity());
  };

  return (
    <div
      aria-hidden
      // 56px: a comfortable thumb target that stays inside the corner.
      className="absolute right-0 bottom-0 size-14 cursor-grab touch-none active:cursor-grabbing"
      onPointerEnter={(e) => {
        if (e.pointerType !== "touch" && !drag.current) settle(-HOVER, -HOVER);
      }}
      onPointerLeave={(e) => {
        if (e.pointerType !== "touch" && !drag.current) settle(-REST, -REST);
      }}
      onPointerDown={(e) => {
        if (drag.current || e.button !== 0) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        stop();
        drag.current = {
          id: e.pointerId,
          x: e.clientX,
          y: e.clientY,
          dx: dx.get(),
          dy: dy.get(),
        };
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (!d || d.id !== e.pointerId) return;
        const move = local(e.clientX - d.x, e.clientY - d.y);
        const width = w.get();
        const height = h.get();
        dx.set(Math.min(0, Math.max(-width * (1 + OVERDRAG), d.dx + move.x)));
        dy.set(Math.min(0, Math.max(-height * (1 + OVERDRAG), d.dy + move.y)));
      }}
      onPointerUp={end}
      onPointerCancel={end}
    />
  );
}

function Leaving({
  flight,
  reduce,
  onGone,
}: {
  flight: Flight;
  reduce: boolean;
  onGone: () => void;
}) {
  const dx = useMotionValue(flight.dx);
  const dy = useMotionValue(flight.dy);
  const w = useMotionValue(flight.w);
  const h = useMotionValue(flight.h);
  const y = useMotionValue(0);
  const rotate = useMotionValue(tiltOf(flight.index));
  const opacity = useMotionValue(1);
  const gone = useRef(onGone);

  useEffect(() => {
    gone.current = onGone;
  });

  useEffect(() => {
    if (reduce) {
      const c = animate(opacity, 0, { duration: 0.15 });
      c.then(() => gone.current());
      return () => c.stop();
    }
    // Keep peeling the way the hand was going, or up and to the left when
    // the Done button started it from a flat corner.
    const len = Math.hypot(flight.dx, flight.dy);
    const dir =
      len > 16
        ? { x: flight.dx / len, y: flight.dy / len }
        : { x: -0.6, y: -0.8 };
    const reach = Math.hypot(flight.w, flight.h) * LEAVE_DISTANCE;
    // An exit you are not waiting on, so it can take its time: the curl and
    // the fall read as paper, and nothing is blocked while it plays.
    const all = [
      animate(dx, dir.x * reach, { ...PEEL_AWAY, velocity: flight.vx }),
      animate(dy, dir.y * reach, { ...PEEL_AWAY, velocity: flight.vy }),
      animate(y, 90, { duration: 0.5, ease: FALL }),
      animate(rotate, rotate.get() - 9, { duration: 0.5, ease: EASE_OUT }),
      // Paper is opaque: it only fades once it is mostly clear of the pad,
      // so it never reads as a ghost over the next note.
      animate(opacity, 0, { duration: 0.2, delay: 0.3, ease: EASE_OUT }),
    ];
    all[4].then(() => gone.current());
    return () => all.forEach((c) => c.stop());
  }, [flight, reduce, dx, dy, y, rotate, opacity]);

  return (
    <motion.div
      aria-hidden
      inert
      style={{ y, opacity }}
      className="pointer-events-none absolute inset-0 z-10"
    >
      <Sheet
        note={flight.note}
        index={flight.index}
        dx={dx}
        dy={dy}
        w={w}
        h={h}
        buried
        style={{ rotate }}
      />
    </motion.div>
  );
}

const NOTES: Reminder[] = [
  { id: 1, title: "Call the landlord", detail: "Ask about the radiator before it gets cold.", due: "Fri" },
  { id: 2, title: "Renew passport", detail: "The photos are in the top drawer." },
  { id: 3, title: "Water the fern", detail: "Twice a week, not every day.", due: "Sun" },
  { id: 4, title: "Send invoice 118", detail: "Net 30. Attach the timesheet.", due: "Mon" },
  { id: 5, title: "Book the dentist", detail: "A morning slot, any day next week." },
];

export default function StickyNotePeelDemo() {
  return <StickyNotePeel notes={NOTES} />;
}
