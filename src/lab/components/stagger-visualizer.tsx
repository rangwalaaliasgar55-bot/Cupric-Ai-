import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useReducedMotion } from "@/lib/use-reduced-motion";
import { cn } from "@/lib/cn";

type Direction = "forward" | "reverse" | "center" | "ripple";
type Easing = "ease-out" | "ease-in-out" | "ease-in" | "linear";

// Two wide rows keep the grid short enough to see the whole tool at once.
const COLS = 6;
const ROWS = 2;
const COUNT = COLS * ROWS;
// Each tile's own entrance. The stagger is only the offset between starts.
const ENTER = 300;
const MAX_DELAY = 120;
// Longest possible run: the last of 12 tiles at 120ms, plus its entrance.
// A fixed axis lets you compare settings by eye.
const AXIS = (COUNT - 1) * MAX_DELAY + ENTER;
// Lets a slider come to rest before replaying.
const REPLAY_DELAY = 250;

const EASINGS: Record<Easing, { css: string; short: string; hint: string }> = {
  "ease-out": {
    css: "cubic-bezier(0.23, 1, 0.32, 1)",
    short: "out",
    hint: "Right for entrances: each tile starts moving at once.",
  },
  "ease-in-out": {
    css: "cubic-bezier(0.77, 0, 0.175, 1)",
    short: "in-out",
    hint: "A softer start. The entrance feels a little slower.",
  },
  "ease-in": {
    css: "cubic-bezier(0.55, 0, 1, 0.45)",
    short: "in",
    hint: "Starts slow, so every tile seems to hesitate. Avoid.",
  },
  linear: {
    css: "linear",
    short: "linear",
    hint: "Mechanical. Keep linear for constant motion.",
  },
};

const DIRECTIONS: { id: Direction; label: string; hint: string }[] = [
  { id: "forward", label: "Forward", hint: "Delay = position in the list × delay per item." },
  { id: "reverse", label: "Reverse", hint: "Delay = position from the end × delay per item." },
  { id: "center", label: "Center", hint: "Delay = distance from the center, in tiles, × delay per item." },
  { id: "ripple", label: "Ripple", hint: "Click any tile to ripple out from it, even mid-run." },
];

const TICKS = [0, 500, 1000, 1500];

// Distance-based orders measure in grid cells, so tiles the same distance
// from the origin start together and the entrance spreads out in rings.
function delays(direction: Direction, stagger: number, origin: number) {
  const center = { col: (COLS - 1) / 2, row: (ROWS - 1) / 2 };
  const from =
    direction === "ripple"
      ? { col: origin % COLS, row: Math.floor(origin / COLS) }
      : center;
  return Array.from({ length: COUNT }, (_, i) => {
    if (direction === "forward") return i * stagger;
    if (direction === "reverse") return (COUNT - 1 - i) * stagger;
    const d = Math.hypot(i % COLS - from.col, Math.floor(i / COLS) - from.row);
    return Math.round(d * stagger);
  });
}

function verdict(stagger: number) {
  if (stagger === 0) return "No stagger. Everything lands at once.";
  if (stagger < 30) return "Barely there. It still reads as one block.";
  if (stagger <= 80) return "Natural. Reads as a sequence without waiting.";
  return "Too slow. The last tiles feel late.";
}

export function StaggerVisualizer({ className }: { className?: string }) {
  const reduceMotion = useReducedMotion();
  const [stagger, setStagger] = useState(50);
  const [direction, setDirection] = useState<Direction>("forward");
  const [easing, setEasing] = useState<Easing>("ease-out");
  const [origin, setOrigin] = useState(2);
  // The hint line explains whichever control was touched last.
  const [hintFor, setHintFor] = useState<"direction" | "easing">("direction");
  const plan = delays(direction, stagger, origin);
  const last = Math.max(...plan) + ENTER;

  const rootRef = useRef<HTMLDivElement>(null);
  const tiles = useRef<(HTMLButtonElement | null)[]>([]);
  const headRef = useRef<HTMLDivElement>(null);
  const running = useRef<Animation[]>([]);

  const play = (plan: number[]) => {
    running.current.forEach((a) => a.cancel());
    const css = EASINGS[easing].css;
    // Reduced motion keeps the fade and the timing, and drops the movement.
    const from = reduceMotion
      ? { opacity: 0 }
      : { opacity: 0, transform: "translateY(8px) scale(0.96)" };
    const to = reduceMotion ? { opacity: 1 } : { opacity: 1, transform: "none" };
    const next: Animation[] = [];
    tiles.current.forEach((tile, i) => {
      if (!tile) return;
      // fill: backwards holds each tile hidden through its own delay only;
      // nothing is disabled, so a click mid-run simply restarts it.
      next.push(
        tile.animate([from, to], {
          duration: ENTER,
          delay: plan[i],
          easing: css,
          fill: "backwards",
        }),
      );
    });
    const head = headRef.current;
    if (head) {
      const end = Math.max(...plan) + ENTER;
      next.push(
        head.animate(
          [
            { transform: "translateX(0%)", opacity: 1 },
            { transform: `translateX(${(end / AXIS) * 100}%)`, opacity: 1, offset: 0.9 },
            { transform: `translateX(${(end / AXIS) * 100}%)`, opacity: 0 },
          ],
          { duration: end / 0.9, easing: "linear", fill: "forwards" },
        ),
      );
    }
    running.current = next;
  };

  const playRef = useRef(() => play(plan));
  useLayoutEffect(() => {
    playRef.current = () => play(plan);
  });

  // Plays once the first time it scrolls into view.
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        observer.disconnect();
        playRef.current();
      },
      { threshold: 0.4 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Any change replays, once the control is left alone for a moment.
  const key = `${stagger}|${direction}|${easing}`;
  const lastKey = useRef(key);
  useEffect(() => {
    if (lastKey.current === key) return;
    lastKey.current = key;
    const id = setTimeout(() => playRef.current(), REPLAY_DELAY);
    return () => clearTimeout(id);
  }, [key]);

  useEffect(() => () => running.current.forEach((a) => a.cancel()), []);

  const ripple = (i: number) => {
    setOrigin(i);
    setDirection("ripple");
    setHintFor("direction");
    // Plays right away instead of waiting for the debounce: the click is
    // the trigger. Syncing the key stops the effect replaying it again.
    lastKey.current = `${stagger}|ripple|${easing}`;
    play(delays("ripple", stagger, i));
  };

  const hint =
    hintFor === "easing"
      ? `${EASINGS[easing].hint} Each tile fades up over ${ENTER}ms.`
      : DIRECTIONS.find((d) => d.id === direction)!.hint;

  return (
    <div
      ref={rootRef}
      className={cn(
        // 12px panels plus 8px of padding keep the corners concentric.
        "flex w-[min(520px,100%)] flex-col gap-2 rounded-[20px] bg-surface p-2 text-foreground shadow-raised",
        className,
      )}
    >
      <section aria-label="Preview" className="rounded-xl bg-background p-3">
        <div className="mb-3 flex items-center justify-between gap-4">
          <p className="text-sm leading-5 text-pretty text-muted">
            <span className="font-medium text-foreground">30 to 80ms per item feels natural.</span>{" "}
            Longer starts to feel slow.
          </p>
          <button
            type="button"
            onClick={() => play(plan)}
            className="flex h-9 shrink-0 items-center gap-1.5 rounded-full bg-foreground pr-4 pl-3 text-sm font-medium text-background outline-hidden transition-[scale] duration-150 ease-out select-none focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-foreground active:scale-[0.96] motion-reduce:transition-none"
          >
            {/* Nudged right: a triangle's visual center sits left of its box. */}
            <svg viewBox="0 0 16 16" className="size-4 translate-x-px" fill="currentColor" aria-hidden>
              <path d="M5 3.6v8.8a.6.6 0 0 0 .9.5l7-4.4a.6.6 0 0 0 0-1l-7-4.4a.6.6 0 0 0-.9.5Z" />
            </svg>
            Play
          </button>
        </div>

        <div className="grid grid-cols-6 gap-2">
          {plan.map((delay, i) => (
            <button
              key={i}
              ref={(el) => {
                tiles.current[i] = el;
              }}
              type="button"
              aria-label={`Ripple from tile ${i + 1}`}
              onClick={() => ripple(i)}
              className={cn(
                "flex h-12 flex-col justify-between rounded-lg bg-surface p-2 text-left outline-hidden transition-[scale,box-shadow] duration-150 ease-out focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-foreground active:scale-[0.96]",
                direction === "ripple" && origin === i && "shadow-[inset_0_0_0_1.5px_var(--foreground)]",
              )}
            >
              <span aria-hidden className="h-1.5 w-3/5 rounded-full bg-foreground/15" />
              <span aria-hidden className="self-end text-xs leading-none text-muted tabular-nums">
                {delay}
              </span>
            </button>
          ))}
        </div>

        <figure className="mt-3">
          <figcaption className="mb-1.5 flex items-baseline justify-between gap-3 text-[13px] text-muted">
            <span>Each row is a tile, in grid order</span>
            <span>
              Done at <span className="text-foreground tabular-nums">{last}ms</span>
            </span>
          </figcaption>
          <div className="relative">
            <div aria-hidden className="flex flex-col gap-px rounded-md bg-surface p-1.5">
              {plan.map((delay, i) => (
                <div key={i} className="h-[3px] w-full">
                  {/* Width is one entrance on the shared axis; translating by
                      delay / ENTER of its own width puts it at the delay. */}
                  <div
                    className="h-full rounded-full bg-foreground transition-transform duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] motion-reduce:transition-none"
                    style={{
                      width: `${(ENTER / AXIS) * 100}%`,
                      transform: `translateX(${(delay / ENTER) * 100}%)`,
                    }}
                  />
                </div>
              ))}
            </div>
            <div aria-hidden className="pointer-events-none absolute inset-y-0 right-1.5 left-1.5">
              <div ref={headRef} className="h-full w-full opacity-0">
                <div className="h-full w-px -translate-x-1/2 bg-muted" />
              </div>
            </div>
          </div>
          {/* Ticks sit at their true place on the axis, which ends at AXIS, not 1500. */}
          <div aria-hidden className="relative mx-1.5 mt-1 h-4 text-xs text-muted tabular-nums">
            {TICKS.map((t) => (
              <span
                key={t}
                className={cn("absolute top-0", t > 0 && "-translate-x-1/2")}
                style={{ left: `${(t / AXIS) * 100}%` }}
              >
                {t}ms
              </span>
            ))}
          </div>
          <p className="sr-only" aria-live="polite">
            Last tile finishes at {last} milliseconds.
          </p>
        </figure>
      </section>

      <section aria-label="Settings" className="flex flex-col gap-3 rounded-xl bg-background p-3">
        <div className="grid gap-3 sm:grid-cols-2 sm:gap-4">
          <div className="flex flex-col gap-1.5">
            <div className="flex items-baseline justify-between gap-2">
              <label htmlFor="stagger-delay" className="text-sm font-medium">
                Delay per item
              </label>
              <output htmlFor="stagger-delay" className="text-sm tabular-nums">
                {stagger}ms
              </output>
            </div>
            <input
              id="stagger-delay"
              type="range"
              min={0}
              max={MAX_DELAY}
              step={5}
              value={stagger}
              aria-describedby="stagger-verdict"
              onChange={(e) => setStagger(Number(e.target.value))}
              style={{ "--fill": `${(stagger / MAX_DELAY) * 100}%` } as React.CSSProperties}
              className={cn(
                "h-8 w-full cursor-pointer appearance-none rounded-full bg-transparent outline-hidden focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-foreground",
                // The filled part is a hard color stop at the value, not a blend.
                "[&::-webkit-slider-runnable-track]:h-1 [&::-webkit-slider-runnable-track]:rounded-full [&::-webkit-slider-runnable-track]:bg-[linear-gradient(to_right,var(--foreground)_var(--fill),var(--border)_var(--fill))]",
                "[&::-moz-range-track]:h-1 [&::-moz-range-track]:rounded-full [&::-moz-range-track]:bg-[linear-gradient(to_right,var(--foreground)_var(--fill),var(--border)_var(--fill))]",
                // -6px centers the 16px thumb on the 4px track.
                "[&::-webkit-slider-thumb]:-mt-1.5 [&::-webkit-slider-thumb]:size-4 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-background [&::-webkit-slider-thumb]:shadow-raised",
                "[&::-moz-range-thumb]:size-4 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:bg-background [&::-moz-range-thumb]:shadow-raised",
              )}
            />
            {/* The 30 to 80ms band, drawn under the slider's own scale. mx-2
                matches the thumb's travel, which stops 8px short of each end. */}
            <div aria-hidden className="relative mx-2 h-1.5">
              <div
                className="absolute inset-y-0 rounded-full bg-foreground/15"
                style={{ left: `${(30 / MAX_DELAY) * 100}%`, right: `${100 - (80 / MAX_DELAY) * 100}%` }}
              />
            </div>
          </div>

          <Choice
            label="Easing"
            value={easing}
            valueLabel={easing}
            options={(Object.keys(EASINGS) as Easing[]).map((id) => ({ id, label: EASINGS[id].short }))}
            onChange={(e) => {
              setEasing(e);
              setHintFor("easing");
            }}
            mono
          />
        </div>

        <Choice
          label="Direction"
          value={direction}
          options={DIRECTIONS}
          onChange={(d) => {
            setDirection(d);
            setHintFor("direction");
          }}
        />

        {/* Two lines are reserved for each note so a longer message never
            changes the demo's height. */}
        <div className="flex flex-col border-t border-border pt-3 text-[13px] leading-5 text-pretty text-muted">
          <p id="stagger-verdict" className="min-h-10 text-foreground sm:min-h-5">
            {verdict(stagger)}
          </p>
          <p id="stagger-hint" className="min-h-10">
            {hint}
          </p>
        </div>
      </section>
    </div>
  );
}

function Choice<T extends string>({
  label,
  options,
  value,
  valueLabel,
  onChange,
  mono,
}: {
  label: string;
  options: { id: T; label: string }[];
  value: T;
  valueLabel?: string;
  onChange: (value: T) => void;
  mono?: boolean;
}) {
  const id = `stagger-${label.toLowerCase()}`;
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <span id={id} className="text-sm font-medium">
          {label}
        </span>
        {valueLabel && <span className="font-mono text-[13px] text-muted">{valueLabel}</span>}
      </div>
      <div
        role="radiogroup"
        aria-labelledby={id}
        aria-describedby="stagger-hint"
        className="grid grid-cols-4 gap-1 rounded-[12px] bg-surface p-1"
        onKeyDown={(e) => {
          const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
          if (!step) return;
          e.preventDefault();
          const index = options.findIndex((o) => o.id === value);
          const next = options[(index + step + options.length) % options.length];
          onChange(next.id);
          e.currentTarget.querySelector<HTMLElement>(`[data-id="${next.id}"]`)?.focus();
        }}
      >
        {options.map((o) => (
          <button
            key={o.id}
            type="button"
            role="radio"
            data-id={o.id}
            aria-checked={value === o.id}
            // Short easing labels ("in") mean little read aloud on their own.
            aria-label={mono ? o.id : undefined}
            tabIndex={value === o.id ? 0 : -1}
            onClick={() => onChange(o.id)}
            className={cn(
              // 8px radius + 4px padding = the 12px group.
              "h-8 min-w-0 truncate rounded-[8px] px-1 text-[13px] font-medium outline-hidden transition-[color,background-color,scale] duration-150 ease-out focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-foreground active:scale-[0.96]",
              mono && "font-mono font-normal",
              value === o.id ? "bg-background text-foreground shadow-raised" : "text-muted hover:text-foreground",
            )}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export default function StaggerVisualizerDemo() {
  return <StaggerVisualizer />;
}
