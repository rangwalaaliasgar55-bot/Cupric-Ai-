import {
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  AnimatePresence,
  MotionConfig,
  motion,
  useIsPresent,
  type Variants,
} from "motion/react";
import { useReducedMotion } from "@/lib/use-reduced-motion";
import { cn } from "@/lib/cn";

export type Range = { start: string; end: string };

const EASE_OUT = [0.23, 1, 0.32, 1] as const;
const ICON_SWAP = { type: "spring", duration: 0.3, bounce: 0 } as const;
// Far enough to read as travel, short enough that the fade does most of the
// work and the months never look like they are leaving the card.
const SLIDE = 56;
const PANEL: Variants = {
  enter: (dir: number) => ({ x: dir * SLIDE, opacity: 0, filter: "blur(4px)" }),
  center: {
    x: 0,
    opacity: 1,
    filter: "blur(0px)",
    transition: { duration: 0.25, ease: EASE_OUT },
  },
  // Leaves quicker and travels less than the incoming months arrive, so the
  // eye goes straight to the new ones.
  exit: (dir: number) => ({
    x: dir * -SLIDE * 0.6,
    opacity: 0,
    filter: "blur(2px)",
    transition: { duration: 0.18, ease: EASE_OUT },
  }),
};

const WEEKDAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];
// Six weeks covers every month, so the grids never change height.
const CELLS = 42;
// Below this the card can't fit two 7 x 36px grids side by side.
const TWO_MONTHS_AT = 540;

const pad = (n: number) => String(n).padStart(2, "0");
const toIso = (d: Date) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const fromIso = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
};
// Months as one running number, so comparing two tells the direction.
const monthIndex = (iso: string) => {
  const [y, m] = iso.split("-").map(Number);
  return y * 12 + m - 1;
};
const monthStart = (month: number) =>
  toIso(new Date(Math.floor(month / 12), month % 12, 1));
const monthEnd = (month: number) =>
  toIso(new Date(Math.floor(month / 12), (month % 12) + 1, 0));
const addDays = (iso: string, days: number) => {
  const d = fromIso(iso);
  return toIso(new Date(d.getFullYear(), d.getMonth(), d.getDate() + days));
};
// Keeps the day of month, clamped so Jan 31 plus one month is Feb 28.
const addMonths = (iso: string, months: number) => {
  const d = fromIso(iso);
  const last = new Date(d.getFullYear(), d.getMonth() + months + 1, 0);
  return toIso(
    new Date(last.getFullYear(), last.getMonth(), Math.min(d.getDate(), last.getDate())),
  );
};
const daysBetween = (a: string, b: string) =>
  Math.round((fromIso(b).getTime() - fromIso(a).getTime()) / 86_400_000);
const monthTitle = (month: number) =>
  new Date(Math.floor(month / 12), month % 12, 1).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });
const dayLabel = (iso: string) =>
  fromIso(iso).toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
const short = (iso: string, withYear: boolean) =>
  fromIso(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: withYear ? "numeric" : undefined,
  });

function describe(range: Range) {
  const sameYear = range.start.slice(0, 4) === range.end.slice(0, 4);
  const days = daysBetween(range.start, range.end) + 1;
  const span =
    range.start === range.end
      ? short(range.start, true)
      : `${short(range.start, !sameYear)} to ${short(range.end, true)}`;
  return `${span} · ${days} day${days === 1 ? "" : "s"}`;
}

// The server can't know the viewer's date or time zone, so it renders an
// empty frame of the same size and the client fills it in on hydration.
const noSubscribe = () => () => {};
const useToday = () =>
  useSyncExternalStore(
    noSubscribe,
    () => toIso(new Date()),
    () => null,
  );

function presets(today: string): { label: string; range: Range }[] {
  const month = monthIndex(today);
  return [
    { label: "Last 7 days", range: { start: addDays(today, -6), end: today } },
    { label: "Last 30 days", range: { start: addDays(today, -29), end: today } },
    { label: "This month", range: { start: monthStart(month), end: monthEnd(month) } },
    { label: "Last month", range: { start: monthStart(month - 1), end: monthEnd(month - 1) } },
  ];
}

export function DateRangePicker({
  value,
  onApply,
  className,
}: {
  value?: Range | null;
  onApply?: (range: Range) => void;
  className?: string;
}) {
  const today = useToday();
  const reduceMotion = useReducedMotion();
  const titleId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const areaRef = useRef<HTMLDivElement>(null);
  const [start, setStart] = useState<string | null>(value?.start ?? null);
  const [end, setEnd] = useState<string | null>(value?.end ?? null);
  // The day under the pointer (or keyboard focus) while picking an end.
  const [hover, setHover] = useState<string | null>(null);
  const [focused, setFocused] = useState<string | null>(null);
  // Null until the user navigates, meaning "the months around the range or
  // today". It is the month shown on the left.
  const [view, setView] = useState<number | null>(null);
  const [direction, setDirection] = useState(1);
  const [single, setSingle] = useState(false);
  const [applied, setApplied] = useState(false);
  const moveFocus = useRef(false);
  const appliedTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => () => clearTimeout(appliedTimer.current), []);

  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) =>
      setSingle(entry.contentRect.width < TWO_MONTHS_AT),
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const count = single ? 1 : 2;
  const anchor = start ?? today;
  // On two months, a range that ends in the anchor's month shows it on the
  // right, so the month before it stays in view.
  const defaultView = anchor
    ? end && !single && monthIndex(end) === monthIndex(anchor)
      ? monthIndex(anchor) - 1
      : monthIndex(anchor)
    : null;
  const shownView = view ?? defaultView;
  const focusedIso = focused ?? anchor;

  // After a keyboard move, focus follows to the day's button, which may be
  // in months that have only just mounted.
  useEffect(() => {
    if (!moveFocus.current || !focusedIso) return;
    moveFocus.current = false;
    areaRef.current
      ?.querySelector<HTMLButtonElement>(
        `[data-view="${shownView}"] [data-date="${focusedIso}"]`,
      )
      ?.focus({ preventScroll: true });
  }, [focusedIso, shownView]);

  const picking = start !== null && end === null;
  const lo = picking && hover ? (hover < start ? hover : start) : start;
  const hi = picking ? (hover ? (hover < start ? start : hover) : start) : end;

  // Always stores the month, even when unchanged, so the default view stops
  // tracking the selection once the user has touched anything.
  const showView = (next: number) => {
    if (shownView === null) return;
    if (next !== shownView) setDirection(next > shownView ? 1 : -1);
    setView(next);
  };

  // Keeps an iso date inside the visible months, shifting by as little
  // as possible.
  const reveal = (iso: string) => {
    if (shownView === null) return;
    const m = monthIndex(iso);
    if (m < shownView) showView(m);
    else if (m > shownView + count - 1) showView(m - count + 1);
    else showView(shownView);
  };

  const select = (iso: string) => {
    setApplied(false);
    setFocused(iso);
    reveal(iso);
    if (!picking) {
      setStart(iso);
      setEnd(null);
      setHover(iso);
    } else if (iso < start) {
      setStart(iso);
      setEnd(start);
      setHover(null);
    } else {
      setEnd(iso);
      setHover(null);
    }
  };

  const setRange = (range: Range | null) => {
    setApplied(false);
    setHover(null);
    setStart(range?.start ?? null);
    setEnd(range?.end ?? null);
    if (shownView === null) return;
    if (!range) return showView(shownView);
    setFocused(range.start);
    // Shows the end month, with the start's month beside it when it fits.
    const endMonth = monthIndex(range.end);
    const visible =
      monthIndex(range.start) >= shownView &&
      endMonth <= shownView + count - 1;
    showView(
      visible
        ? shownView
        : Math.max(monthIndex(range.start), endMonth - count + 1),
    );
  };

  const goTo = (iso: string) => {
    setFocused(iso);
    if (picking) setHover(iso);
    reveal(iso);
    moveFocus.current = true;
  };

  const step = (months: number) => {
    if (shownView === null) return;
    showView(shownView + months);
    if (focusedIso) setFocused(addMonths(focusedIso, months));
  };

  const onGridKeyDown = (e: React.KeyboardEvent) => {
    if (!focusedIso) return;
    const weekday = fromIso(focusedIso).getDay();
    const years = e.shiftKey ? 12 : 1;
    const moves: Record<string, () => string> = {
      ArrowLeft: () => addDays(focusedIso, -1),
      ArrowRight: () => addDays(focusedIso, 1),
      ArrowUp: () => addDays(focusedIso, -7),
      ArrowDown: () => addDays(focusedIso, 7),
      Home: () => addDays(focusedIso, -weekday),
      End: () => addDays(focusedIso, 6 - weekday),
      PageUp: () => addMonths(focusedIso, -years),
      PageDown: () => addMonths(focusedIso, years),
    };
    const move = moves[e.key];
    if (move) {
      e.preventDefault();
      goTo(move());
    } else if (e.key === "Escape" && picking) {
      // Backs out of a half-picked range.
      e.preventDefault();
      setStart(null);
      setHover(null);
    }
  };

  const complete = start !== null && end !== null;
  const summary = complete
    ? describe({ start, end })
    : picking
      ? `From ${short(start, true)}`
      : "No dates selected";
  const hint = complete ? "" : picking ? "Pick an end date" : "Pick a start date";
  const chips = today ? presets(today) : [];

  // The tabbable day: the focused one when it is in view, else the first
  // day on screen, so Tab always lands somewhere visible.
  const tabbable =
    shownView !== null && focusedIso && monthIndex(focusedIso) >= shownView &&
    monthIndex(focusedIso) < shownView + count
      ? focusedIso
      : shownView !== null
        ? monthStart(shownView)
        : null;

  return (
    <MotionConfig reducedMotion="user">
      <div
        ref={rootRef}
        className={cn(
          "w-[600px] max-w-full rounded-[24px] bg-background p-4 shadow-raised",
          className,
        )}
      >
        <div
          role="group"
          aria-label="Presets"
          // Scrolls sideways on narrow screens; the 4px of vertical padding
          // keeps focus outlines from being clipped by that overflow.
          className="-mx-4 -mt-1 mb-2 flex gap-1.5 overflow-x-auto px-4 py-1 [scrollbar-width:none]"
        >
          {chips.map((chip) => {
            const active =
              start === chip.range.start && end === chip.range.end;
            return (
              <button
                key={chip.label}
                type="button"
                aria-pressed={active}
                onClick={() => setRange(chip.range)}
                className={cn(
                  "h-9 shrink-0 rounded-full px-3.5 text-sm whitespace-nowrap outline-hidden select-none",
                  "transition-[scale,color,background-color,box-shadow] duration-150 ease-out focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-foreground active:scale-[0.96] motion-reduce:transition-[color,background-color,box-shadow]",
                  active
                    ? "bg-foreground text-background"
                    : "text-muted shadow-[inset_0_0_0_1px_var(--border)] hover:bg-foreground/[0.04] hover:text-foreground",
                )}
              >
                {chip.label}
              </button>
            );
          })}
          {/* Keeps the row's height on the server, before presets exist. */}
          {!today && <span aria-hidden className="h-9" />}
        </div>

        {/* Header 40 + weekdays 32 + six 40px weeks = 312. The 4px of
            padding buys back room for focus outlines on the outer days. */}
        <div
          ref={areaRef}
          className="relative -m-1 h-[320px] overflow-hidden p-1"
          onKeyDown={onGridKeyDown}
          onPointerLeave={() => {
            if (picking) setHover(null);
          }}
        >
          {shownView !== null && today && (
            <>
              <div className="pointer-events-none absolute inset-x-1 top-1 z-10 flex justify-between">
                <NavButton label="Previous month" onClick={() => step(-1)}>
                  <path d="M10 3.5 5.5 8l4.5 4.5" />
                </NavButton>
                <NavButton label="Next month" onClick={() => step(1)}>
                  <path d="m6 3.5 4.5 4.5L6 12.5" />
                </NavButton>
              </div>
              <span id={titleId} className="sr-only" aria-live="polite">
                {Array.from({ length: count }, (_, i) =>
                  monthTitle(shownView + i),
                ).join(" and ")}
              </span>
              <AnimatePresence mode="popLayout" initial={false} custom={direction}>
                <Months
                  key={shownView}
                  view={shownView}
                  count={count}
                  direction={direction}
                  today={today}
                  lo={lo}
                  hi={hi}
                  start={start}
                  end={end}
                  hover={picking ? hover : null}
                  tabbable={tabbable}
                  onSelect={select}
                  onHover={(iso) => {
                    if (picking) setHover(iso);
                  }}
                />
              </AnimatePresence>
            </>
          )}
        </div>

        <div className="-mx-4 mt-3 flex h-14 items-center gap-2 border-t border-border px-4 pt-3">
          <div className="min-w-0 flex-1">
            <p
              className={cn(
                "truncate text-sm tabular-nums",
                start ? "text-foreground" : "text-muted",
              )}
            >
              {summary}
            </p>
            <p className="h-4 truncate text-xs text-muted">{hint}</p>
          </div>
          <button
            type="button"
            onClick={() => setRange(null)}
            inert={!start}
            className={cn(
              "h-9 rounded-full px-3.5 text-sm text-muted outline-hidden select-none",
              "transition-[scale,color,background-color,opacity] duration-150 ease-out hover:bg-foreground/[0.05] hover:text-foreground focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-foreground active:scale-[0.96] motion-reduce:transition-[color,background-color,opacity]",
              !start && "opacity-40",
            )}
          >
            Clear
          </button>
          <button
            type="button"
            disabled={!complete}
            onClick={() => {
              if (!complete) return;
              onApply?.({ start, end });
              setApplied(true);
              clearTimeout(appliedTimer.current);
              // Long enough to register, then back to a plain Apply.
              appliedTimer.current = setTimeout(() => setApplied(false), 1600);
            }}
            className={cn(
              "flex h-9 items-center gap-1.5 rounded-full bg-foreground px-4 text-sm font-medium text-background outline-hidden select-none",
              "transition-[scale,opacity] duration-150 ease-out focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-foreground enabled:active:scale-[0.96] disabled:opacity-40 motion-reduce:transition-[opacity]",
            )}
          >
            {/* Both labels share a cell, so the button keeps one width. */}
            <span className="grid">
              <span className="col-start-1 row-start-1 flex items-center justify-center gap-1.5">
                <motion.svg
                  aria-hidden
                  {...STROKE}
                  strokeWidth={2}
                  className="size-4"
                  initial={false}
                  animate={
                    applied
                      ? { scale: 1, opacity: 1, filter: "blur(0px)" }
                      : reduceMotion
                        ? { opacity: 0 }
                        : { scale: 0.25, opacity: 0, filter: "blur(4px)" }
                  }
                  transition={ICON_SWAP}
                >
                  <path d="m3.5 8.5 3 3 6-7" />
                </motion.svg>
                <span
                  className={cn(
                    "transition-[opacity,filter] duration-200 ease-out",
                    !applied && "opacity-0 blur-[4px]",
                  )}
                >
                  Applied
                </span>
              </span>
              <span
                className={cn(
                  "col-start-1 row-start-1 flex items-center justify-center transition-[opacity,filter] duration-200 ease-out",
                  applied && "opacity-0 blur-[4px]",
                )}
              >
                Apply
              </span>
            </span>
          </button>
        </div>
        <span className="sr-only" aria-live="polite">
          {applied ? `Applied ${summary}` : ""}
        </span>
      </div>
    </MotionConfig>
  );
}

function Months({
  ref,
  view,
  count,
  direction,
  ...grid
}: {
  // popLayout measures the outgoing months through this ref.
  ref?: React.Ref<HTMLDivElement>;
  view: number;
  count: number;
  direction: number;
} & Omit<React.ComponentProps<typeof MonthGrid>, "month">) {
  // The outgoing months stay in the DOM while they fade, but are gone as
  // far as focus, pointer and screen readers are concerned.
  const present = useIsPresent();
  return (
    <motion.div
      ref={ref}
      custom={direction}
      variants={PANEL}
      initial="enter"
      animate="center"
      exit="exit"
      data-view={view}
      inert={!present}
      className="flex gap-6"
    >
      {Array.from({ length: count }, (_, i) => (
        <MonthGrid key={i} month={view + i} {...grid} />
      ))}
    </motion.div>
  );
}

function MonthGrid({
  month,
  today,
  lo,
  hi,
  start,
  end,
  hover,
  tabbable,
  onSelect,
  onHover,
}: {
  month: number;
  today: string;
  lo: string | null;
  hi: string | null;
  start: string | null;
  end: string | null;
  hover: string | null;
  tabbable: string | null;
  onSelect: (iso: string) => void;
  onHover: (iso: string) => void;
}) {
  const titleId = useId();
  const first = fromIso(monthStart(month));
  const lead = first.getDay();
  const last = monthEnd(month);
  const days = Array.from({ length: CELLS }, (_, i) => {
    const d = new Date(first.getFullYear(), first.getMonth(), i - lead + 1);
    return monthIndex(toIso(d)) === month ? toIso(d) : null;
  });

  return (
    <div className="min-w-0 flex-1">
      <p
        id={titleId}
        className="flex h-10 items-center justify-center text-[15px] font-medium text-foreground"
      >
        {monthTitle(month)}
      </p>
      <table
        role="grid"
        aria-labelledby={titleId}
        className="w-full table-fixed border-collapse"
      >
        <thead>
          <tr>
            {WEEKDAYS.map((day) => (
              <th
                key={day}
                scope="col"
                abbr={day}
                className="h-8 p-0 text-center text-xs font-medium text-muted"
              >
                {day.slice(0, 2)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: CELLS / 7 }, (_, w) => (
            <tr key={w}>
              {days.slice(w * 7, w * 7 + 7).map((iso, col) => {
                if (!iso) return <td key={col} className="h-10 p-0" />;
                const isEdge = iso === lo || iso === hi;
                const inRange =
                  lo !== null && hi !== null && lo !== hi && iso >= lo && iso <= hi;
                const committed = iso === start || iso === end;
                // The band rounds off wherever a week or the month breaks
                // it, so each row reads as one continuous pill.
                const rowStart = col === 0 || iso.endsWith("-01");
                const rowEnd = col === 6 || iso === last;
                // An endpoint on a row break has nothing beside it to join.
                const band =
                  inRange &&
                  !(iso === lo && rowEnd) &&
                  !(iso === hi && rowStart);
                return (
                  <td
                    key={iso}
                    role="gridcell"
                    aria-selected={inRange || committed}
                    className="relative h-10 p-0"
                  >
                    {band && (
                      <span
                        aria-hidden
                        className={cn(
                          "absolute inset-y-0.5 bg-foreground/[0.07]",
                          // Endpoints only fill toward the rest of the
                          // range; their circle is the rounded end.
                          iso === lo ? "left-1/2" : "left-0",
                          iso === hi ? "right-1/2" : "right-0",
                          rowStart && iso !== lo && "rounded-l-full",
                          rowEnd && iso !== hi && "rounded-r-full",
                        )}
                      />
                    )}
                    <button
                      type="button"
                      data-date={iso}
                      tabIndex={iso === tabbable ? 0 : -1}
                      aria-label={dayLabel(iso)}
                      aria-current={iso === today ? "date" : undefined}
                      onClick={() => onSelect(iso)}
                      onPointerEnter={(e) => {
                        if (e.pointerType !== "touch") onHover(iso);
                      }}
                      className={cn(
                        "relative mx-auto flex size-9 touch-manipulation items-center justify-center rounded-full text-sm tabular-nums outline-hidden select-none",
                        "transition-[scale] duration-150 ease-out active:scale-[0.96] motion-reduce:transition-none",
                        "focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-1 focus-visible:outline-foreground",
                        committed
                          ? "bg-foreground text-background"
                          : isEdge && hover
                            ? // The prospective end: marked, but not yet filled.
                              "bg-foreground/[0.14] text-foreground"
                            : "text-foreground hover:bg-foreground/[0.07]",
                      )}
                    >
                      {Number(iso.slice(8))}
                      {iso === today && (
                        <span
                          aria-hidden
                          className="absolute bottom-1 left-1/2 size-1 -translate-x-1/2 rounded-full bg-current"
                        />
                      )}
                    </button>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function NavButton({
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
      className="pointer-events-auto flex size-10 touch-manipulation items-center justify-center rounded-full text-muted outline-hidden select-none transition-[scale,color,background-color] duration-150 ease-out hover:bg-foreground/[0.06] hover:text-foreground focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-foreground active:scale-[0.96] motion-reduce:transition-[color,background-color]"
    >
      <svg aria-hidden {...STROKE} className="size-4">
        {children}
      </svg>
    </button>
  );
}

const STROKE = {
  viewBox: "0 0 16 16",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.5,
  strokeLinecap: "round",
  strokeLinejoin: "round",
} as const;

export default function DateRangePickerDemo() {
  return <DateRangePicker />;
}
