import { useId, useMemo, useState, useSyncExternalStore } from "react";
import { AnimatePresence, motion } from "motion/react";
import { useReducedMotion } from "@/lib/use-reduced-motion";
import { cn } from "@/lib/cn";

// "HH:MM" in the store's own time. A close earlier than the open runs past
// midnight into the next day, like a bar open 17:00 to 02:00.
export type Shift = [open: string, close: string];
// Monday first, seven entries. An empty list is a closed day.
export type WeekHours = Shift[][];

const DAY = 1440;
const WEEK = DAY * 7;
const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const LONG_DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
// Closing within the hour turns the pill into a warning, and its ring
// drains over those last 60 minutes.
const SOON = 60;
const EASE_OUT = [0.23, 1, 0.32, 1] as const;

const mod = (n: number, m: number) => ((n % m) + m) % m;
const toMinutes = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
};

// Wall-clock parts of an instant in a zone.
function wall(ms: number, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    hourCycle: "h23",
  }).formatToParts(ms);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  const n = (type: string) => Number(get(type));
  return {
    weekMinute: DAYS.indexOf(get("weekday")) * DAY + n("hour") * 60 + n("minute"),
    // Minutes since the epoch as if this wall clock were UTC, for offsets.
    stamp: Date.UTC(n("year"), n("month") - 1, n("day"), n("hour"), n("minute")) / 60000,
  };
}

// Minutes the visitor's clock is ahead of the store's.
function offsetBetween(ms: number, store: string, visitor: string) {
  return wall(ms, visitor).stamp - wall(ms, store).stamp;
}

type Interval = { start: number; end: number };

function intervals(hours: WeekHours): Interval[] {
  return hours.flatMap((shifts, day) =>
    shifts.map(([open, close]) => {
      const start = day * DAY + toMinutes(open);
      let end = day * DAY + toMinutes(close);
      if (end <= start) end += DAY;
      return { start, end };
    }),
  );
}

type Segment = { from: number; to: number; carried: boolean };

// Splits the week's intervals, shifted into the zone being shown, into
// per-day bars. A shift that runs past midnight leaves a carried-over bar
// at the start of the next day's row.
function rows(list: Interval[], shift: number) {
  const out = DAYS.map(() => ({ segments: [] as Segment[], opens: [] as Interval[] }));
  for (const { start, end } of list) {
    const s = mod(start + shift, WEEK);
    const e = s + (end - start);
    out[Math.floor(s / DAY)].opens.push({ start: s % DAY, end: e - Math.floor(s / DAY) * DAY });
    for (let t = Math.floor(s / DAY) * DAY; t < e; t += DAY) {
      const from = Math.max(s, t);
      const to = Math.min(e, t + DAY);
      out[mod(t / DAY, 7)].segments.push({ from: from - t, to: to - t, carried: from > s });
    }
  }
  return out;
}

function clock(minutes: number, compact = false) {
  const m = mod(minutes, DAY);
  const h = Math.floor(m / 60);
  const min = m % 60;
  const h12 = h % 12 || 12;
  const mm = min ? `:${String(min).padStart(2, "0")}` : "";
  if (compact) return `${h12}${mm}${h < 12 ? "a" : "p"}`;
  return `${h12}${mm} ${h < 12 ? "AM" : "PM"}`;
}

type Status =
  | { kind: "open"; closesAt: number; left: number }
  | { kind: "closed"; opensAt: number; until: number };

function status(list: Interval[], t: number): Status | null {
  for (const { start, end } of list) {
    for (const base of [t, t + WEEK]) {
      if (base >= start && base < end) {
        return { kind: "open", closesAt: end, left: end - base };
      }
    }
  }
  let best: Status | null = null;
  for (const { start } of list) {
    const until = mod(start - t, WEEK);
    if (!best || until < (best as { until: number }).until) {
      best = { kind: "closed", opensAt: start, until };
    }
  }
  return best;
}

// Ticks every 15 seconds; the snapshot only changes when the quarter
// minute does, so React skips the renders in between. On the server it is
// null, so nothing time-dependent renders until hydration is done.
const QUANTUM = 15_000;
function subscribeClock(onChange: () => void) {
  const id = window.setInterval(onChange, QUANTUM);
  document.addEventListener("visibilitychange", onChange);
  return () => {
    window.clearInterval(id);
    document.removeEventListener("visibilitychange", onChange);
  };
}
export function useNow() {
  return useSyncExternalStore(
    subscribeClock,
    () => Math.floor(Date.now() / QUANTUM) * QUANTUM,
    () => null,
  );
}
const noop = () => () => {};
function useVisitorZone() {
  return useSyncExternalStore(
    noop,
    () => Intl.DateTimeFormat().resolvedOptions().timeZone,
    () => null,
  );
}

export function StoreHours({
  name,
  address,
  hours,
  timeZone,
  city,
  now: nowOverride,
  visitorTimeZone,
  className,
}: {
  name: string;
  address: string;
  hours: WeekHours;
  // The store's IANA zone.
  timeZone: string;
  // Short place name for the store's clock, like "Brooklyn".
  city: string;
  // Pins the clock, for previews; live when left out.
  now?: number;
  // Defaults to the browser's zone.
  visitorTimeZone?: string;
  className?: string;
}) {
  const reduceMotion = useReducedMotion();
  const id = useId();
  const live = useNow();
  const detected = useVisitorZone();
  const now = nowOverride ?? live;
  const visitor = visitorTimeZone ?? detected;
  const [mode, setMode] = useState<"store" | "visitor">("store");

  const list = useMemo(() => intervals(hours), [hours]);
  const ready = now !== null && visitor !== null;
  const offset = ready ? offsetBetween(now, timeZone, visitor) : 0;
  const differs = ready && offset !== 0;
  const shift = differs && mode === "visitor" ? offset : 0;
  const week = useMemo(() => rows(list, shift), [list, shift]);

  const storeMinute = ready ? wall(now, timeZone).weekMinute : 0;
  const shownMinute = mod(storeMinute + shift, WEEK);
  const today = ready ? Math.floor(shownMinute / DAY) : -1;
  const nowPct = ((shownMinute % DAY) / DAY) * 100;
  const state = ready ? status(list, storeMinute) : null;

  // Times in the status line follow whichever clock the chart shows.
  const pillText = !state
    ? "Checking hours"
    : state.kind === "open"
      ? state.left <= SOON
        ? `Open, closes in ${state.left} min`
        : `Open until ${clock(state.closesAt + shift)}`
      : state.until <= SOON
        ? `Closed, opens in ${state.until} min`
        : `Closed, opens ${openingDay(storeMinute + shift, state.opensAt + shift)}${clock(state.opensAt + shift)}`;
  const tone = !state
    ? "idle"
    : state.kind === "open"
      ? state.left <= SOON
        ? "soon"
        : "open"
      : "closed";

  const zoneName = (zone: string) =>
    new Intl.DateTimeFormat("en-US", { timeZone: zone, timeZoneName: "short" })
      .formatToParts(now ?? 0)
      .find((p) => p.type === "timeZoneName")?.value ?? zone;

  return (
    <section
      aria-labelledby={`${id}-name`}
      className={cn(
        "w-[min(540px,100%)] rounded-3xl bg-background p-5 shadow-raised",
        className,
      )}
    >
      {/* The clock switch wraps under the name on a phone rather than
          truncating the address. */}
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-3">
        <div className="min-w-[180px] flex-1">
          <h3 id={`${id}-name`} className="text-[15px] font-medium text-foreground">
            {name}
          </h3>
          <p className="truncate text-[13px] text-muted">{address}</p>
        </div>
        {differs && (
          <div
            role="radiogroup"
            aria-label="Show hours in"
            className="flex shrink-0 rounded-full bg-surface p-1"
          >
            {(["store", "visitor"] as const).map((m) => (
              <button
                key={m}
                type="button"
                role="radio"
                aria-checked={mode === m}
                onClick={() => setMode(m)}
                className="relative h-8 touch-manipulation rounded-full px-3 text-[13px] font-medium outline-hidden transition-[scale] duration-150 ease-out select-none focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-foreground active:scale-[0.96]"
              >
                {mode === m && (
                  <motion.span
                    layoutId={`${id}-mode`}
                    transition={reduceMotion ? { duration: 0 } : { type: "spring", duration: 0.3, bounce: 0 }}
                    className="absolute inset-0 rounded-full bg-background shadow-raised"
                  />
                )}
                <span
                  className={cn(
                    "relative transition-[color] duration-150 ease-out",
                    mode === m ? "text-foreground" : "text-muted",
                  )}
                >
                  {m === "store" ? "Store time" : "My time"}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="mt-4 flex h-8 items-center">
        <span
          className={cn(
            "inline-flex h-8 items-center gap-2 rounded-full pr-3.5 pl-2.5 text-sm font-medium transition-[background-color,color] duration-200 ease-out",
            tone === "open" && "bg-foreground text-background",
            tone === "soon" && "bg-danger/12 text-danger",
            (tone === "closed" || tone === "idle") && "bg-surface text-muted",
          )}
        >
          <Signal tone={tone} left={state?.kind === "open" ? state.left : 0} />
          <AnimatePresence initial={false} mode="popLayout">
            <motion.span
              key={pillText.replace(/\d+ min/, "min")}
              initial={reduceMotion ? { opacity: 0 } : { opacity: 0, filter: "blur(4px)" }}
              animate={{ opacity: 1, filter: "blur(0px)" }}
              exit={{ opacity: 0, transition: { duration: 0.1 } }}
              transition={{ duration: 0.2, ease: EASE_OUT }}
              className="tabular-nums"
            >
              {pillText}
            </motion.span>
          </AnimatePresence>
        </span>
        {/* Announces state changes only, not every minute of a countdown. */}
        <span className="sr-only" aria-live="polite">
          {tone === "open" ? "Open now" : tone === "soon" ? "Closing within the hour" : tone === "closed" ? "Closed now" : ""}
        </span>
      </div>

      {/* Two lines on phones, one line from sm up, always: the height
          never depends on how long the times happen to be. */}
      <p className="mt-2 flex h-10 flex-col text-[13px] leading-5 text-muted tabular-nums sm:h-5 sm:flex-row sm:gap-1.5">
        {ready && (
          <>
            <span>
              {clock(storeMinute)} in {city}
            </span>
            {differs && (
              <span>
                <span aria-hidden className="hidden sm:inline">
                  ·{" "}
                </span>
                {clock(storeMinute + offset)} your time ({zoneName(visitor)})
              </span>
            )}
          </>
        )}
      </p>

      <div
        // The times column is a fixed width on phones too: two split shifts
        // wrap onto two lines instead of squeezing the chart to nothing.
        className="mt-3 grid grid-cols-[36px_minmax(0,1fr)_84px] items-center gap-x-3 sm:grid-cols-[40px_minmax(0,1fr)_112px]"
        // Fixed row heights: switching clocks can wrap a row to two lines, and
        // nothing below may move when it does.
        style={{ gridTemplateRows: "20px repeat(7, 44px)" }}
      >
        {/* Axis, with the now marker riding along it. */}
        <div aria-hidden className="relative col-start-2 row-start-1 h-5 text-[12px] text-muted tabular-nums">
          {["12a", "6a", "12p", "6p", "12a"].map((label, i) => (
            <span
              key={i}
              style={{ left: `${i * 25}%` }}
              className={cn(
                "absolute top-0",
                i === 0 ? "" : i === 4 ? "-translate-x-full" : "-translate-x-1/2",
              )}
            >
              {label}
            </span>
          ))}
        </div>

        {/* Today's band sits behind its row, full width. */}
        {today >= 0 && (
          <div
            aria-hidden
            style={{ gridRow: today + 2 }}
            className="col-span-3 col-start-1 -mx-2 h-full rounded-xl bg-surface"
          />
        )}

        {/* Quarter-day guides and the live now line span every row. */}
        <div
          aria-hidden
          className="pointer-events-none relative col-start-2 row-span-7 row-start-2 h-full"
        >
          {[25, 50, 75].map((p) => (
            <span key={p} style={{ left: `${p}%` }} className="absolute inset-y-0 w-px bg-border" />
          ))}
          {ready && (
            // Moves once every 15 seconds at most, so `left` is fine here.
            // It glides when the clock jumps (a new preset, or switching to
            // your zone), so you can follow where "now" went.
            <span
              style={{ left: `${nowPct}%` }}
              className="absolute -top-1 -bottom-1 z-10 w-px -translate-x-1/2 bg-foreground transition-[left] duration-300 ease-[cubic-bezier(0.77,0,0.175,1)] motion-reduce:transition-none"
            >
              <span
                style={{ top: `calc(${((today + 0.5) / 7) * 100}% - 4px)` }}
                className="absolute -left-[3.5px] size-2 rounded-full bg-foreground ring-2 ring-background transition-[top] duration-300 ease-[cubic-bezier(0.77,0,0.175,1)] motion-reduce:transition-none"
              />
            </span>
          )}
        </div>

        {week.map((row, day) => {
          const isToday = day === today;
          const text = row.opens.length
            ? row.opens.map((o) => `${clock(o.start, true)}–${clock(o.end, true)}`).join(", ")
            : row.segments.length
              ? `until ${clock(row.segments[0].to, true)}`
              : "Closed";
          const label = row.opens.length
            ? row.opens.map((o) => `${clock(o.start)} to ${clock(o.end)}`).join(" and ")
            : row.segments.length
              ? `open until ${clock(row.segments[0].to)} from the night before`
              : "closed";
          return (
            <div key={day} className="contents">
              <span
                style={{ gridRow: day + 2 }}
                className={cn(
                  "col-start-1 text-sm transition-[color] duration-200",
                  isToday ? "font-medium text-foreground" : "text-muted",
                )}
              >
                <span aria-hidden>{DAYS[day]}</span>
                <span className="sr-only">
                  {LONG_DAYS[day]}
                  {isToday ? ", today" : ""}: {label}
                </span>
              </span>
              <div aria-hidden style={{ gridRow: day + 2 }} className="relative col-start-2 h-2.5">
                <AnimatePresence initial={false} mode="popLayout">
                  <motion.div
                    key={mode}
                    initial={reduceMotion ? { opacity: 0 } : { opacity: 0, filter: "blur(4px)" }}
                    animate={{ opacity: 1, filter: "blur(0px)" }}
                    exit={{ opacity: 0, transition: { duration: 0.12 } }}
                    transition={{ duration: 0.25, ease: EASE_OUT }}
                    className="absolute inset-0"
                  >
                    {row.segments.length === 0 && (
                      <span className="absolute inset-x-0 top-1/2 h-px bg-border" />
                    )}
                    {row.segments.map((s, i) => (
                      <span
                        key={i}
                        style={{ left: `${(s.from / DAY) * 100}%`, width: `${((s.to - s.from) / DAY) * 100}%` }}
                        className={cn(
                          "absolute inset-y-0 transition-[background-color] duration-200",
                          // A carried-over shift keeps a square left end,
                          // so it reads as the tail of yesterday's bar.
                          s.carried ? "rounded-r-full" : s.to === DAY ? "rounded-l-full" : "rounded-full",
                          isToday ? "bg-foreground" : "bg-foreground/25",
                        )}
                      />
                    ))}
                  </motion.div>
                </AnimatePresence>
              </div>
              <span
                aria-hidden
                style={{ gridRow: day + 2 }}
                className={cn(
                  "col-start-3 text-right text-[12px] leading-4 text-balance tabular-nums transition-[color] duration-200 sm:text-[13px]",
                  isToday ? "font-medium text-foreground" : "text-muted",
                )}
              >
                {text}
              </span>
            </div>
          );
        })}
      </div>
    </section>
  );
}

// "tomorrow ", "Tue " or "" for later today, measured in the shown zone.
function openingDay(from: number, to: number) {
  const a = Math.floor(mod(from, WEEK) / DAY);
  const b = Math.floor(mod(to, WEEK) / DAY);
  if (a === b && mod(to - from, WEEK) < DAY) return "at ";
  if (mod(b - a, 7) === 1) return "tomorrow ";
  return `${DAYS[b]} `;
}

// A dot while open, a ring that drains through the last hour, a hollow
// dot while closed.
function Signal({ tone, left }: { tone: string; left: number }) {
  const r = 5;
  const c = 2 * Math.PI * r;
  return (
    <svg aria-hidden viewBox="0 0 14 14" className="size-3.5 -rotate-90">
      <circle
        cx={7}
        cy={7}
        r={r}
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        className={cn("transition-opacity duration-200", tone === "soon" ? "opacity-25" : "opacity-0")}
      />
      <circle
        cx={7}
        cy={7}
        r={tone === "soon" ? r : 3.5}
        fill={tone === "open" ? "currentColor" : "none"}
        stroke="currentColor"
        strokeWidth={tone === "soon" ? 2 : 1.5}
        strokeLinecap="round"
        strokeDasharray={tone === "soon" ? `${c} ${c}` : undefined}
        strokeDashoffset={tone === "soon" ? c * (1 - Math.max(0, Math.min(1, left / SOON))) : undefined}
        className="transition-[stroke-dashoffset] duration-500 ease-out"
      />
    </svg>
  );
}

const HOURS: WeekHours = [
  [],
  [["07:00", "14:00"], ["17:00", "23:00"]],
  [["07:00", "14:00"], ["17:00", "23:00"]],
  [["07:00", "14:00"], ["17:00", "23:00"]],
  [["07:00", "14:00"], ["17:00", "02:00"]],
  [["08:00", "15:00"], ["17:00", "02:00"]],
  [["08:00", "15:00"]],
];
const ZONE = "America/New_York";

// Preview presets in store time: Friday 1:15 PM, Friday 11:40 PM, Monday
// morning (closed all day), and Sunday 3:30 PM.
const PRESETS = [
  { label: "Fri 1:15 PM", minute: 4 * DAY + 13 * 60 + 15 },
  { label: "Fri 11:40 PM", minute: 4 * DAY + 23 * 60 + 40 },
  { label: "Mon 10 AM", minute: 10 * 60 },
];

export default function StoreHoursDemo() {
  const live = useNow();
  const [preset, setPreset] = useState<number | null>(0);
  // A visitor who is already on New York time would never see the clock
  // switch, which is the point of the demo, so they get London instead.
  const detected = useVisitorZone();
  const visitor =
    detected && live !== null && offsetBetween(live, ZONE, detected) === 0
      ? "Europe/London"
      : undefined;
  // Moves the live instant to the preset's store time within this week.
  const now =
    live === null || preset === null
      ? undefined
      : live + mod(PRESETS[preset].minute - wall(live, ZONE).weekMinute, WEEK) * 60000;
  return (
    <div className="flex w-[min(540px,100%)] flex-col items-center gap-4">
      <StoreHours
        name="Marlow & Pine"
        address="212 Wythe Ave, Brooklyn"
        hours={HOURS}
        timeZone={ZONE}
        city="Brooklyn"
        now={now}
        visitorTimeZone={visitor}
      />
      <div role="radiogroup" aria-label="Preview time" className="flex flex-wrap justify-center gap-1.5">
        {[...PRESETS.map((p) => p.label), "Live"].map((label, i) => {
          const value = i < PRESETS.length ? i : null;
          const on = preset === value;
          return (
            <button
              key={label}
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => setPreset(value)}
              className={cn(
                "h-9 touch-manipulation rounded-full px-3.5 text-[13px] font-medium outline-hidden transition-[scale,background-color,color] duration-150 ease-out select-none focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-foreground active:scale-[0.96]",
                on ? "bg-foreground text-background" : "bg-surface text-foreground",
              )}
            >
              {label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
