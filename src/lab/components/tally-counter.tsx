import { useMemo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { useReducedMotion } from "@/lib/use-reduced-motion";
import { cn } from "@/lib/cn";

// Five groups of five per row, two rows: 50 marks fill the sheet exactly.
const PER_ROW = 5;
const ROWS = 2;
const CAPACITY = PER_ROW * 5 * ROWS;
const GROUP_W = 68;
const ROW_H = 66;
const PAD_X = 18;
const PAD_Y = 12;
const VIEW_W = PAD_X * 2 + GROUP_W * PER_ROW - 16;
const VIEW_H = PAD_Y * 2 + ROW_H * ROWS - 14;

// A pen accelerates off the mark and eases into the end of the line.
const PEN = "cubic-bezier(0.65, 0, 0.35, 1)";

// Tiny deterministic PRNG so every mark keeps its shape across renders and
// the sheet draws the same on the server and the client.
function rng(seed: number) {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

type Stroke = { d: string; width: number; diagonal: boolean };

function strokeFor(index: number, seed: number): Stroke {
  const r = rng(seed * 7919 + index * 104729);
  const j = (n: number) => (r() * 2 - 1) * n;
  const group = Math.floor(index / 5);
  const slot = index % 5;
  const gx = PAD_X + (group % PER_ROW) * GROUP_W;
  const gy = PAD_Y + Math.floor(group / PER_ROW) * ROW_H;

  let x0: number, y0: number, x1: number, y1: number;
  if (slot < 4) {
    x0 = gx + 6 + slot * 11 + j(1.2);
    y0 = gy + 2 + j(1.5);
    // Hands drift: the foot lands a little off from the head.
    x1 = x0 + j(2.2);
    y1 = gy + 46 + j(2);
  } else {
    // The gate stroke starts low-left and crosses all four.
    x0 = gx - 2 + j(1.5);
    y0 = gy + 38 + j(2);
    x1 = gx + 48 + j(2);
    y1 = gy + 8 + j(2);
  }
  // Bow the line sideways a touch, never enough to read as a curve.
  const len = Math.hypot(x1 - x0, y1 - y0);
  const nx = -(y1 - y0) / len;
  const ny = (x1 - x0) / len;
  const bow = j(1.8);
  const cx = (x0 + x1) / 2 + nx * bow;
  const cy = (y0 + y1) / 2 + ny * bow;
  // A small flick where the pen lifts off.
  const fx = slot < 4 ? j(1.2) - 1 : 1.5 + r();
  const fy = slot < 4 ? 1 + r() : -1 - r();
  const n = (v: number) => v.toFixed(1);
  return {
    d: `M${n(x0)} ${n(y0)}Q${n(cx)} ${n(cy)} ${n(x1)} ${n(y1)}l${n(fx)} ${n(fy)}`,
    width: 2.3 + r() * 0.6,
    diagonal: slot === 4,
  };
}

export function TallyCounter({
  value,
  onChange,
  label,
  min = 0,
  max = CAPACITY,
  seed = 1,
  className,
}: {
  value: number;
  onChange: (value: number) => void;
  label: string;
  min?: number;
  /** The sheet holds at most 50 marks. */
  max?: number;
  seed?: number;
  className?: string;
}) {
  const reduceMotion = useReducedMotion();
  const limit = Math.min(max, CAPACITY);
  const strokes = useMemo(
    () => Array.from({ length: limit }, (_, i) => strokeFor(i, seed)),
    [limit, seed],
  );

  // Which way the last change went, so the number rolls the same way.
  const [last, setLast] = useState(value);
  const [direction, setDirection] = useState(1);
  if (last !== value) {
    setLast(value);
    setDirection(value > last ? 1 : -1);
  }

  const set = (next: number) => {
    const clamped = Math.min(Math.max(next, min), limit);
    if (clamped !== value) onChange(clamped);
  };

  return (
    <div className={cn("w-[min(400px,100%)]", className)}>
      <div className="mb-3 flex items-end justify-between gap-4">
        <div>
          <p className="mb-1 text-sm font-medium text-muted">{label}</p>
          <p
            aria-hidden
            className="relative h-12 overflow-hidden text-5xl leading-none font-semibold tracking-tight text-foreground tabular-nums"
          >
            {/* The number steps up or down with the pen: a short roll, so a
                run of fast taps still reads as counting. */}
            <AnimatePresence
              initial={false}
              mode="popLayout"
              custom={direction}
            >
              <motion.span
                key={value}
                custom={direction}
                className="block"
                variants={{
                  enter: (d: number) =>
                    reduceMotion
                      ? { opacity: 0 }
                      : { opacity: 0, y: `${d * 45}%`, filter: "blur(4px)" },
                  center: { opacity: 1, y: "0%", filter: "blur(0px)" },
                  exit: (d: number) =>
                    reduceMotion
                      ? { opacity: 0 }
                      : { opacity: 0, y: `${d * -45}%`, filter: "blur(4px)" },
                }}
                initial="enter"
                animate="center"
                exit="exit"
                transition={{ duration: 0.2, ease: [0.23, 1, 0.32, 1] }}
              >
                {value}
              </motion.span>
            </AnimatePresence>
          </p>
        </div>
        <div className="flex gap-2">
          <StepButton
            label={`Remove one from ${label}`}
            disabled={value <= min}
            onClick={() => set(value - 1)}
          >
            <path d="M4 8h8" />
          </StepButton>
          <StepButton
            label={`Add one to ${label}`}
            disabled={value >= limit}
            onClick={() => set(value + 1)}
          >
            <path d="M8 4v8M4 8h8" />
          </StepButton>
        </div>
      </div>

      <div
        role="spinbutton"
        tabIndex={0}
        aria-label={label}
        aria-valuenow={value}
        aria-valuemin={min}
        aria-valuemax={limit}
        aria-valuetext={`${value} ${value === 1 ? "mark" : "marks"}`}
        onClick={() => set(value + 1)}
        onKeyDown={(e) => {
          const next = {
            ArrowUp: value + 1,
            ArrowRight: value + 1,
            ArrowDown: value - 1,
            ArrowLeft: value - 1,
            PageUp: value + 5,
            PageDown: value - 5,
            Home: min,
            End: limit,
          }[e.key];
          if (next === undefined) return;
          e.preventDefault();
          set(next);
        }}
        className="relative block cursor-pointer touch-manipulation rounded-2xl bg-background px-2 pt-6 pb-2 shadow-raised outline-hidden select-none focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-foreground"
      >
        {/* A pocket notebook's wire binding: a row of punched holes along
            the top of the page, spaced to fit whole holes at any width. */}
        <span
          aria-hidden
          className="absolute inset-x-5 top-2.5 h-2 bg-[radial-gradient(circle,var(--color-surface)_2.5px,color-mix(in_oklab,var(--color-foreground)_14%,transparent)_3px,transparent_3.5px)] bg-[length:16px_8px] [background-repeat:space_no-repeat]"
        />
        <svg
          viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
          className="block h-auto w-full text-foreground"
          fill="none"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          {/* Faint rules under each row, like a pocket notebook. */}
          {Array.from({ length: ROWS }, (_, row) => (
            <line
              key={row}
              x1={8}
              x2={VIEW_W - 8}
              y1={PAD_Y + row * ROW_H + 52}
              y2={PAD_Y + row * ROW_H + 52}
              className="stroke-foreground/10"
              strokeWidth={1}
            />
          ))}
          {strokes.map((s, i) => {
            const drawn = i < value;
            // Drawing snaps the ink on and runs the pen; erasing fades the
            // ink first, then rewinds the dash once it is invisible, so a
            // fast re-add always draws from the start.
            const transition = reduceMotion
              ? "none"
              : drawn
                ? `stroke-dashoffset ${s.diagonal ? 220 : 160}ms ${PEN}, opacity 0s`
                : "opacity 180ms ease-out, stroke-dashoffset 0s 180ms";
            return (
              <path
                key={i}
                d={s.d}
                pathLength={1}
                strokeWidth={s.width}
                // Gap longer than the path so the dash never wraps around.
                strokeDasharray="1 2"
                style={{
                  strokeDashoffset: drawn ? 0 : 1,
                  opacity: drawn ? 1 : 0,
                  transition,
                }}
              />
            );
          })}
        </svg>
      </div>
      <p className="mt-2 text-xs text-muted">
        Tap the sheet or use the arrow keys
      </p>
    </div>
  );
}

function StepButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      // The sheet is the single tab stop, as in the spinbutton pattern.
      tabIndex={-1}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="flex size-11 touch-manipulation items-center justify-center rounded-full bg-surface text-foreground shadow-raised outline-hidden transition-[scale,opacity] duration-150 ease-out select-none active:scale-[0.96] disabled:opacity-40 disabled:active:scale-100"
    >
      <svg
        viewBox="0 0 16 16"
        className="size-4"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.75}
        strokeLinecap="round"
        aria-hidden
      >
        {children}
      </svg>
    </button>
  );
}

export default function TallyCounterDemo() {
  // Opens a row and a bit in: the sheet looks used, with room to go.
  const [count, setCount] = useState(28);
  return <TallyCounter label="Laps" value={count} onChange={setCount} />;
}
