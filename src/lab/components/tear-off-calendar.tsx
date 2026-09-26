import {
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
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
import { cn } from "@/lib/cn";

type Flight = {
  key: number;
  day: number;
  y: number;
  rotate: number;
  opacity: number;
  velocity: number;
  spin: number;
};

// Dragged up this far, the page tears; a flick does it sooner (px/s).
const TEAR_DISTANCE = 80;
const FLICK = 500;
// How far up a previous page waits to be pulled back down: the binding's
// height, so it starts tucked entirely under the binding and slides out.
const REATTACH = 32;
// The top page lifts this much under a hovering mouse: a hint it moves.
const HOVER_LIFT = -4;
// Pulling down this far brings the previous page most of the way back.
const PULL_RANGE = 90;
// A page leans as it is torn, like one ripped from its right-hand corner.
const LEAN = 0.05;
const MAX_LEAN = 8;
const SNAP_BACK = { type: "spring", stiffness: 520, damping: 34 } as const;
const REATTACH_SPRING = {
  type: "spring",
  stiffness: 420,
  damping: 34,
} as const;
const EASE_OUT = [0.23, 1, 0.32, 1] as const;
const MS_PER_DAY = 86_400_000;

// Dates travel as "YYYY-MM-DD", like <input type="date">, and are counted
// in whole UTC days so daylight saving never skips or doubles a page.
const toDay = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number);
  return Date.UTC(y, m - 1, d) / MS_PER_DAY;
};
const toIso = (day: number) =>
  new Date(day * MS_PER_DAY).toISOString().slice(0, 10);

const utc = { timeZone: "UTC" } as const;
const fullDate = new Intl.DateTimeFormat("en-GB", {
  ...utc,
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
});
const weekday = new Intl.DateTimeFormat("en-GB", { ...utc, weekday: "long" });
const monthYear = new Intl.DateTimeFormat("en-GB", {
  ...utc,
  month: "long",
  year: "numeric",
});
const relative = new Intl.RelativeTimeFormat("en-GB", { numeric: "auto" });

function describeDay(day: number) {
  const date = new Date(day * MS_PER_DAY);
  return {
    full: fullDate.format(date),
    weekday: weekday.format(date),
    month: monthYear.format(date),
    number: date.getUTCDate(),
    sunday: date.getUTCDay() === 0,
  };
}

// 5 to 12deg of extra lean as it flies: enough to read as torn by hand.
function rollSpin() {
  return 5 + Math.random() * 7;
}

function relativeTo(day: number, today: number) {
  const text = relative.format(day - today, "day");
  return text[0].toUpperCase() + text.slice(1);
}

export function TearOffCalendar({
  value,
  onChange,
  today,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  // Also "YYYY-MM-DD"; drives the relative label and the Today button.
  today: string;
  className?: string;
}) {
  const reduceMotion = useReducedMotion();
  const hintId = useId();
  const day = toDay(value);
  const todayDay = toDay(today);
  const [flights, setFlights] = useState<Flight[]>([]);
  const flightKey = useRef(0);
  const running = useRef<AnimationPlaybackControls[]>([]);
  const drag = useRef<{ id: number; y: number } | null>(null);

  // The top page: its lift when torn, and its fade when reattaching.
  const y = useMotionValue(0);
  const attach = useMotionValue(1);
  const rotate = useTransform(y, (v) => Math.max(v * LEAN, -MAX_LEAN));
  // The previous page, pulled down from above: 0 is away, 1 is in place.
  const pull = useMotionValue(0);
  const ghostY = useTransform(pull, (p) => -(1 - p) * REATTACH);
  const ghostRotate = useTransform(pull, (p) => -(1 - p) * 3);
  // Lifted, the top page rides over the binding; at rest it sits under
  // the page being pulled back down.
  const topZ = useTransform(y, (v): number => (v < 0 ? 3 : 0));
  // Paper is opaque: the page turns solid almost as soon as it moves, so
  // the two days never show through each other.
  const ghostOpacity = useTransform(pull, (p) => Math.min(1, p * 6));
  // The raw finger travel, for release velocity.
  const travel = useMotionValue(0);

  useEffect(() => {
    const list = running;
    return () => list.current.forEach((c) => c.stop());
  }, []);

  const stopAll = () => {
    running.current.forEach((c) => c.stop());
    running.current = [];
  };

  const tearTo = (target: number, velocity = 0) => {
    stopAll();
    const flight: Flight = {
      key: flightKey.current++,
      day,
      y: y.get(),
      rotate: rotate.get(),
      opacity: attach.get(),
      velocity,
      // Rolled per tear, so no two pages leave the same way.
      spin: rollSpin(),
    };
    // The next page is shown at once and the torn one flies off as a copy,
    // so the next tear never waits on the last.
    flushSync(() => {
      onChange(toIso(target));
      if (!reduceMotion) setFlights((list) => [...list, flight]);
    });
    y.jump(0);
    attach.jump(1);
    pull.jump(0);
  };

  const reattachTo = (target: number, from = 0) => {
    stopAll();
    flushSync(() => onChange(toIso(target)));
    pull.jump(0);
    if (reduceMotion) {
      y.jump(0);
      attach.jump(0);
      running.current = [animate(attach, 1, { duration: 0.15 })];
      return;
    }
    // Picks up exactly where the pulled-down page was.
    y.jump(-(1 - from) * REATTACH);
    attach.jump(from);
    running.current = [
      animate(y, 0, REATTACH_SPRING),
      animate(attach, 1, { duration: 0.18, ease: EASE_OUT }),
    ];
  };

  const goTo = (target: number) => {
    if (target > day) tearTo(target, -400);
    else if (target < day) reattachTo(target);
  };

  const release = (e: React.PointerEvent) => {
    if (drag.current?.id !== e.pointerId) return;
    drag.current = null;
    const distance = travel.get();
    const velocity = travel.getVelocity();
    if (distance < 0) {
      if (-distance > TEAR_DISTANCE || velocity < -FLICK) {
        tearTo(day + 1, Math.min(velocity, 0));
      } else {
        running.current = [animate(y, 0, { ...SNAP_BACK, velocity })];
      }
    } else if (distance > 0) {
      if (pull.get() > 0.5 || velocity > FLICK) {
        reattachTo(day - 1, pull.get());
      } else {
        running.current = [animate(pull, 0, SNAP_BACK)];
      }
    }
  };

  const shown = describeDay(day);

  return (
    // Clips sideways only: a torn page swinging out must never widen the
    // page, but it may fly up freely.
    <div
      className={cn(
        "flex w-[min(380px,100%)] flex-col items-center gap-5 overflow-x-clip px-5 pt-2 pb-4",
        className,
      )}
    >
      <div className="relative w-full">
        {/* Page thickness under the pad: a year of days still to go. */}
        <span
          aria-hidden
          className="absolute inset-x-[18px] -bottom-[13px] h-8 rounded-b-[14px] bg-background shadow-raised"
        />
        <span
          aria-hidden
          className="absolute inset-x-3 -bottom-[9px] h-8 rounded-b-[16px] bg-background shadow-raised"
        />
        <span
          aria-hidden
          className="absolute inset-x-1.5 -bottom-[5px] h-8 rounded-b-[18px] bg-background shadow-raised"
        />

        <div className="relative rounded-[20px] bg-background shadow-raised">
          {/* The binding. Above the pages, so a page pulled back down
              slides out from under it; torn pages fly over it. */}
          <div className="relative z-[2] flex h-8 items-center justify-center gap-24 rounded-t-[20px] bg-foreground">
            {/* Two brass rivets: the binding's hardware, a physical metal,
                the same in both themes. */}
            <span className="size-2.5 rounded-full bg-[radial-gradient(circle_at_35%_35%,#f3dfae,#b8914a_60%,#7d6130)] shadow-[0_1px_1px_oklch(0_0_0/0.4)]" />
            <span className="size-2.5 rounded-full bg-[radial-gradient(circle_at_35%_35%,#f3dfae,#b8914a_60%,#7d6130)] shadow-[0_1px_1px_oklch(0_0_0/0.4)]" />
          </div>

          <div
            role="spinbutton"
            tabIndex={0}
            aria-label="Date"
            aria-valuenow={day - todayDay}
            aria-valuetext={shown.full}
            aria-describedby={hintId}
            className="relative h-[272px] cursor-grab touch-none rounded-b-[20px] outline-hidden select-none focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-4 focus-visible:outline-foreground active:cursor-grabbing"
            onKeyDown={(e) => {
              const step: Record<string, number> = {
                ArrowUp: 1,
                ArrowRight: 1,
                ArrowDown: -1,
                ArrowLeft: -1,
              };
              if (e.key in step) goTo(day + step[e.key]);
              else if (e.key === "Home") goTo(todayDay);
              else return;
              e.preventDefault();
            }}
            onPointerDown={(e) => {
              if (drag.current || e.button !== 0) return;
              e.currentTarget.setPointerCapture(e.pointerId);
              stopAll();
              drag.current = { id: e.pointerId, y: e.clientY - travelFrom() };
              travel.jump(travelFrom());
            }}
            onPointerMove={(e) => {
              const d = drag.current;
              if (!d || d.id !== e.pointerId) return;
              const distance = e.clientY - d.y;
              travel.set(distance);
              if (distance <= 0) {
                y.set(distance);
                pull.set(0);
              } else {
                y.set(0);
                // Eases in, so the page never quite snaps into place early.
                pull.set(1 - Math.exp(-distance / PULL_RANGE));
              }
            }}
            onPointerUp={release}
            onPointerCancel={release}
            onPointerEnter={(e) => {
              if (e.pointerType !== "mouse" || drag.current || reduceMotion)
                return;
              stopAll();
              running.current = [animate(y, HOVER_LIFT, SNAP_BACK)];
            }}
            onPointerLeave={(e) => {
              if (e.pointerType !== "mouse" || drag.current || y.get() >= 0)
                return;
              stopAll();
              running.current = [animate(y, 0, SNAP_BACK)];
            }}
          >
            {/* Tomorrow, waiting underneath. */}
            <Page day={day + 1} />
            <Page
              day={day}
              y={y}
              rotate={rotate}
              opacity={attach}
              z={topZ}
              raised
            />
            {/* Yesterday, only there while you pull it back down. */}
            <Page
              day={day - 1}
              y={ghostY}
              rotate={ghostRotate}
              opacity={ghostOpacity}
              raised
              className="z-[1]"
            />
            {flights.map((flight) => (
              <FlyingPage
                className="z-[3]"
                key={flight.key}
                flight={flight}
                onGone={() =>
                  setFlights((list) => list.filter((f) => f.key !== flight.key))
                }
              />
            ))}
          </div>
        </div>
      </div>

      <span id={hintId} className="sr-only">
        Arrow keys change the day, Home returns to today. Drag the page up for
        the next day, down for the previous one.
      </span>

      <div className="mt-2 flex flex-col items-center gap-0.5 text-center">
        <p className="text-[15px] font-medium text-foreground tabular-nums">
          {shown.full}
        </p>
        <p className="text-sm text-muted" aria-live="polite">
          {relativeTo(day, todayDay)}
        </p>
      </div>

      <div className="flex gap-2">
        <IconButton label="Previous day" onClick={() => goTo(day - 1)}>
          <path d="m10 3.5-4.5 4.5 4.5 4.5" />
        </IconButton>
        <button
          type="button"
          onClick={() => goTo(todayDay)}
          disabled={day === todayDay}
          className="h-10 touch-manipulation rounded-full bg-surface px-4 text-sm font-medium text-foreground shadow-raised outline-hidden transition-[scale,opacity] duration-150 ease-out select-none focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-foreground active:scale-[0.96] disabled:opacity-50 disabled:active:scale-100 motion-reduce:transition-[opacity]"
        >
          Today
        </button>
        <IconButton label="Next day" onClick={() => goTo(day + 1)}>
          <path d="m6 3.5 4.5 4.5L6 12.5" />
        </IconButton>
      </div>
    </div>
  );

  // A grab while the page is still springing back continues from where it
  // visibly is, instead of jumping under the finger.
  function travelFrom() {
    if (y.get() < 0) return y.get();
    const p = pull.get();
    return p > 0 ? -PULL_RANGE * Math.log(1 - Math.min(p, 0.99)) : 0;
  }
}

function Page({
  day,
  y,
  rotate,
  opacity,
  raised,
  torn,
  className,
  z,
}: {
  z?: MotionValue<number>;
  day: number;
  y?: MotionValue<number>;
  rotate?: MotionValue<number>;
  opacity?: MotionValue<number>;
  raised?: boolean;
  torn?: boolean;
  className?: string;
}) {
  const d = describeDay(day);
  return (
    <motion.div
      aria-hidden
      style={{ y, rotate, opacity, zIndex: z }}
      className={cn(
        "pointer-events-none absolute inset-0 origin-top-left",
        className,
        // Shadow as a filter outside the mask, so it follows the torn edge
        // instead of being masked away with it.
        torn &&
          "[filter:drop-shadow(0_0_0.5px_oklch(0_0_0/0.2))_drop-shadow(0_8px_16px_oklch(0_0_0/0.12))] dark:[filter:drop-shadow(0_0_0.75px_oklch(1_0_0/0.25))_drop-shadow(0_8px_16px_oklch(0_0_0/0.5))]",
      )}
    >
      <div
        className={cn(
          "relative flex size-full flex-col items-center justify-center rounded-b-[20px] bg-background",
          raised &&
            "shadow-[0_1px_0_0_var(--border),0_1px_3px_oklch(0_0_0/0.06)]",
          // A torn page keeps half of each perforation hole along its top.
          torn &&
            "[mask:radial-gradient(circle_at_5px_0,transparent_2px,black_2.5px)_0_0/10px_100%_repeat-x]",
        )}
      >
        {/* The perforation it tears along, just under the binding. */}
        {!torn && (
          <span className="absolute inset-x-3 top-1.5 h-1.5 bg-[radial-gradient(circle,color-mix(in_oklch,var(--foreground)_22%,transparent)_1.25px,transparent_1.75px)] bg-[length:10px_6px] bg-repeat-x" />
        )}
        <span className="text-[13px] font-medium tracking-[0.14em] text-muted uppercase">
          {d.month}
        </span>
        <span
          className={cn(
            "mt-1 text-[112px] leading-none font-semibold tracking-tighter tabular-nums",
            d.sunday ? "text-danger" : "text-foreground",
          )}
        >
          {d.number}
        </span>
        <span className="mt-3 text-lg text-foreground">{d.weekday}</span>
      </div>
    </motion.div>
  );
}

function FlyingPage({
  flight,
  onGone,
  className,
}: {
  flight: Flight;
  onGone: () => void;
  className?: string;
}) {
  const y = useMotionValue(flight.y);
  const rotate = useMotionValue(flight.rotate);
  const opacity = useMotionValue(flight.opacity);
  const gone = useRef(onGone);

  useEffect(() => {
    gone.current = onGone;
  });

  useEffect(() => {
    // Keeps the speed the hand tore it at, leans on as it goes, and is
    // faded well before it clears the pad. An exit nothing waits on.
    const all = [
      animate(y, flight.y - 200, {
        type: "spring",
        stiffness: 220,
        damping: 30,
        velocity: flight.velocity,
      }),
      animate(rotate, flight.rotate - flight.spin, {
        duration: 0.4,
        ease: EASE_OUT,
      }),
      animate(opacity, 0, { duration: 0.22, delay: 0.08, ease: EASE_OUT }),
    ];
    all[2].then(() => gone.current());
    return () => all.forEach((c) => c.stop());
  }, [flight, y, rotate, opacity]);

  return (
    <Page
      day={flight.day}
      y={y}
      rotate={rotate}
      opacity={opacity}
      torn
      className={className}
    />
  );
}

function IconButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className="flex size-10 touch-manipulation items-center justify-center rounded-full bg-surface text-foreground shadow-raised outline-hidden transition-[scale] duration-150 ease-out select-none focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-foreground active:scale-[0.96] motion-reduce:transition-none"
    >
      <svg
        viewBox="0 0 16 16"
        className="size-4"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        {children}
      </svg>
    </button>
  );
}

// Server and first client render agree on a fixed date; the real local day
// takes over right after hydration, so the markup never mismatches.
const FALLBACK = "2026-09-23";
const noSubscribe = () => () => {};
function localToday() {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export default function TearOffCalendarDemo() {
  const today = useSyncExternalStore(noSubscribe, localToday, () => FALLBACK);
  // Stored as days from today, so the page follows once the real date loads.
  const [offset, setOffset] = useState(0);
  const value = toIso(toDay(today) + offset);
  return (
    <TearOffCalendar
      value={value}
      today={today}
      onChange={(next) => setOffset(toDay(next) - toDay(today))}
    />
  );
}
