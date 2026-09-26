import { memo, useCallback, useRef, useState } from "react";
import { motion } from "motion/react";
import { useReducedMotion } from "@/lib/use-reduced-motion";
import { cn } from "@/lib/cn";

// Layout in sheet units; everything is placed in percentages of these, so
// the sheet scales down on narrow screens without re-measuring.
const D = 48; // bubble diameter
const PITCH_X = 58;
// Hex packing: rows sit sqrt(3)/2 of the pitch apart, offset by half.
const PITCH_Y = 51;
const PAD = 20;
const EASE_OUT = [0.23, 1, 0.32, 1] as const;
// The squash is quick so a drag across a row reads as a string of pops,
// not a queue of animations.
const POP = { duration: 0.18, times: [0, 0.35, 1], ease: EASE_OUT };
// A little bounce as the air comes back: the one place it belongs.
const INFLATE = { type: "spring", duration: 0.4, bounce: 0.35 } as const;
// Reset ripples diagonally from the top left corner.
const WAVE_STEP = 0.03;

// Clear plastic is a physical material, so the dome is built from light
// rather than a fill colour: a hard specular glint up top left, a softer
// reflection low on the right, a bright rim where the film curves away, and
// a shadow side. White and black at low alpha read as clear plastic on
// either theme's surface.
const DOME = [
  "radial-gradient(ellipse 24% 14% at 36% 25%, light-dark(oklch(1 0 0 / 0.95), oklch(1 0 0 / 0.55)), oklch(1 0 0 / 0) 100%)",
  "radial-gradient(ellipse 30% 9% at 58% 83%, light-dark(oklch(1 0 0 / 0.7), oklch(1 0 0 / 0.14)), oklch(1 0 0 / 0) 100%)",
  "radial-gradient(circle at 40% 35%, light-dark(oklch(1 0 0 / 0.6), oklch(1 0 0 / 0.08)), light-dark(oklch(0 0 0 / 0.05), oklch(1 0 0 / 0.02)) 78%)",
].join(", ");
const DOME_EDGE = [
  "inset 0 0 0 1px light-dark(oklch(0 0 0 / 0.09), oklch(1 0 0 / 0.14))",
  "inset -3px -5px 9px light-dark(oklch(0 0 0 / 0.1), oklch(0 0 0 / 0.55))",
  "inset 2px 3px 5px light-dark(oklch(1 0 0 / 1), oklch(1 0 0 / 0.07))",
  "0 5px 9px -4px light-dark(oklch(0 0 0 / 0.22), oklch(0 0 0 / 0.8))",
].join(", ");

type Cell = { row: number; col: number; x: number; y: number };

function layout(rows: number, cols: number) {
  const cells: Cell[] = [];
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      cells.push({
        row,
        col,
        x: PAD + D / 2 + col * PITCH_X + (row % 2 ? PITCH_X / 2 : 0),
        y: PAD + D / 2 + row * PITCH_Y,
      });
    }
  }
  return {
    cells,
    width: PAD * 2 + D + (cols - 1) * PITCH_X + PITCH_X / 2,
    height: PAD * 2 + D + (rows - 1) * PITCH_Y,
  };
}

export function BubbleWrap({
  rows = 4,
  cols = 6,
  label = "Bubble wrap",
  onPop,
  onComplete,
  className,
}: {
  rows?: number;
  cols?: number;
  label?: string;
  onPop?: (popped: number, total: number) => void;
  onComplete?: () => void;
  className?: string;
}) {
  const reduceMotion = !!useReducedMotion();
  const [{ cells, width, height }] = useState(() => layout(rows, cols));
  const total = cells.length;
  const [popped, setPopped] = useState<boolean[]>(() =>
    Array(total).fill(false),
  );
  const poppedRef = useRef(popped);
  const [active, setActive] = useState(0);
  const sheet = useRef<HTMLDivElement>(null);
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  const drag = useRef<{ id: number; x: number; y: number } | null>(null);

  const count = popped.filter(Boolean).length;

  const register = useCallback((i: number, el: HTMLButtonElement | null) => {
    buttons.current[i] = el;
  }, []);

  const pop = useCallback(
    (i: number) => {
      if (poppedRef.current[i]) return;
      const next = poppedRef.current.slice();
      next[i] = true;
      poppedRef.current = next;
      setPopped(next);
      navigator.vibrate?.(8);
      const n = next.filter(Boolean).length;
      onPop?.(n, next.length);
      if (n === next.length) onComplete?.();
    },
    [onPop, onComplete],
  );

  const reset = () => {
    const next = Array(total).fill(false);
    poppedRef.current = next;
    setPopped(next);
  };

  // Pops every bubble within reach of the segment from a to b, sampled
  // densely enough that a fast swipe can't jump over one.
  const sweep = (ax: number, ay: number, bx: number, by: number) => {
    const steps = Math.max(
      1,
      Math.ceil(Math.hypot(bx - ax, by - ay) / (D / 4)),
    );
    for (let s = 0; s <= steps; s++) {
      const px = ax + ((bx - ax) * s) / steps;
      const py = ay + ((by - ay) * s) / steps;
      cells.forEach((c, i) => {
        // 0.45 of the diameter: gaps between bubbles stay safe to touch.
        if (Math.hypot(c.x - px, c.y - py) < D * 0.45) pop(i);
      });
    }
  };

  const toUnits = (e: React.PointerEvent) => {
    const box = sheet.current!.getBoundingClientRect();
    return {
      x: ((e.clientX - box.left) / box.width) * width,
      y: ((e.clientY - box.top) / box.height) * height,
    };
  };

  const endDrag = (e: React.PointerEvent) => {
    if (drag.current?.id === e.pointerId) drag.current = null;
  };

  const move = useCallback(
    (i: number, key: string) => {
      const c = cells[i];
      const at = (row: number, col: number) =>
        cells.findIndex((x) => x.row === row && x.col === col);
      const next = {
        ArrowLeft: at(c.row, Math.max(c.col - 1, 0)),
        ArrowRight: at(c.row, Math.min(c.col + 1, cols - 1)),
        ArrowUp: at(Math.max(c.row - 1, 0), c.col),
        ArrowDown: at(Math.min(c.row + 1, rows - 1), c.col),
        Home: at(c.row, 0),
        End: at(c.row, cols - 1),
      }[key];
      if (next === undefined) return false;
      setActive(next);
      buttons.current[next]?.focus();
      return true;
    },
    [cells, rows, cols],
  );

  const done = count === total;

  return (
    <div
      className={cn(
        "flex w-[min(440px,100%)] flex-col gap-3 select-none",
        className,
      )}
    >
      <div className="flex h-9 items-center justify-between gap-3 px-1">
        <p className="grid text-[15px]">
          <span
            className={cn(
              "col-start-1 row-start-1 transition-[opacity,filter] duration-200 ease-out",
              done && "opacity-0 blur-[4px]",
            )}
          >
            <span className="font-medium text-foreground tabular-nums">
              {count}
            </span>
            <span className="text-muted tabular-nums"> / {total} popped</span>
          </span>
          <span
            aria-live="polite"
            className={cn(
              "col-start-1 row-start-1 font-medium text-foreground transition-[opacity,filter] duration-200 ease-out",
              !done && "opacity-0 blur-[4px]",
            )}
          >
            {done ? "All clear" : ""}
          </span>
        </p>
        <button
          type="button"
          onClick={reset}
          disabled={count === 0}
          className="h-9 rounded-full bg-surface px-4 text-sm font-medium text-foreground shadow-raised outline-hidden transition-[scale,opacity] duration-150 ease-out focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-foreground active:scale-[0.96] disabled:opacity-50 disabled:active:scale-100"
        >
          Reset
        </button>
      </div>
      <div
        ref={sheet}
        role="group"
        aria-label={`${label}, ${total - count} of ${total} left`}
        className="relative w-full touch-none rounded-[22px] bg-surface inset-ring inset-ring-foreground/5"
        style={{ aspectRatio: `${width} / ${height}` }}
        onPointerDown={(e) => {
          if (e.button !== 0 || drag.current) return;
          e.currentTarget.setPointerCapture(e.pointerId);
          const p = toUnits(e);
          drag.current = { id: e.pointerId, ...p };
          sweep(p.x, p.y, p.x, p.y);
        }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (!d || d.id !== e.pointerId) return;
          const p = toUnits(e);
          sweep(d.x, d.y, p.x, p.y);
          d.x = p.x;
          d.y = p.y;
        }}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        {cells.map((c, i) => (
          <Bubble
            key={i}
            register={register}
            index={i}
            cell={c}
            popped={popped[i]}
            focusable={i === active}
            left={(c.x - D / 2) / width}
            top={(c.y - D / 2) / height}
            size={D / width}
            delay={(c.row + c.col) * WAVE_STEP}
            reduceMotion={reduceMotion}
            onPop={pop}
            onFocusIndex={setActive}
            onMove={move}
          />
        ))}
      </div>
    </div>
  );
}

const Bubble = memo(function Bubble({
  register,
  index,
  cell,
  popped,
  focusable,
  left,
  top,
  size,
  delay,
  reduceMotion,
  onPop,
  onFocusIndex,
  onMove,
}: {
  register: (i: number, el: HTMLButtonElement | null) => void;
  index: number;
  cell: Cell;
  popped: boolean;
  focusable: boolean;
  left: number;
  top: number;
  size: number;
  delay: number;
  reduceMotion: boolean;
  onPop: (i: number) => void;
  onFocusIndex: (i: number) => void;
  onMove: (i: number, key: string) => boolean;
}) {
  const squash = reduceMotion
    ? { duration: 0 }
    : popped
      ? POP
      : { ...INFLATE, delay };
  // Each bubble's creases sit at a different angle so the popped sheet
  // doesn't look stamped.
  const twist = (index * 47) % 360;

  return (
    <button
      ref={(el) => {
        register(index, el);
      }}
      type="button"
      tabIndex={focusable ? 0 : -1}
      aria-pressed={popped}
      aria-label={`Bubble, row ${cell.row + 1}, column ${cell.col + 1}`}
      onClick={() => onPop(index)}
      onFocus={() => onFocusIndex(index)}
      onKeyDown={(e) => {
        if (onMove(index, e.key)) e.preventDefault();
      }}
      className="absolute cursor-pointer rounded-full outline-hidden focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-foreground"
      style={{
        left: `${left * 100}%`,
        top: `${top * 100}%`,
        width: `${size * 100}%`,
        aspectRatio: "1",
      }}
    >
      {/* The flat plastic footprint, always there under the dome. */}
      <span className="absolute inset-0 rounded-full bg-foreground/[0.03] inset-ring inset-ring-foreground/10" />
      <motion.span
        aria-hidden
        className="absolute inset-0"
        initial={false}
        animate={
          popped
            ? { scaleX: [1, 1.1, 0.92], scaleY: [1, 0.84, 0.92] }
            : { scaleX: 1, scaleY: 1 }
        }
        transition={squash}
      >
        <motion.span
          className="absolute inset-0 rounded-full"
          style={{ background: DOME, boxShadow: DOME_EDGE }}
          initial={false}
          animate={{ opacity: popped ? 0 : 1 }}
          // Air leaves fast; the dome refills over the same wave as the scale.
          transition={
            popped
              ? { duration: reduceMotion ? 0.1 : 0.14, ease: EASE_OUT }
              : {
                  duration: 0.2,
                  ease: EASE_OUT,
                  delay: reduceMotion ? 0 : delay,
                }
          }
        />
        <motion.svg
          viewBox="0 0 48 48"
          className="absolute inset-0 size-full"
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
          initial={false}
          animate={{ opacity: popped ? 1 : 0 }}
          transition={{ duration: popped ? 0.2 : 0.1, ease: EASE_OUT }}
          style={{ rotate: twist }}
        >
          <path
            d="M13 20l6 3 3-5 5 6 7-2M16 30l5-2 4 4 5-3 4 2M22 12l2 4"
            className="stroke-foreground/25"
            strokeWidth={1}
          />
        </motion.svg>
      </motion.span>
      {/* A faint ring flicks outward at the moment of the pop. */}
      {!reduceMotion && (
        <motion.span
          aria-hidden
          className="pointer-events-none absolute inset-0 rounded-full inset-ring-[1.5px] inset-ring-foreground/40"
          initial={false}
          animate={
            popped
              ? { scale: [1, 1.3], opacity: [0.8, 0] }
              : { scale: 1, opacity: 0 }
          }
          transition={{ duration: 0.25, ease: EASE_OUT }}
        />
      )}
    </button>
  );
});

export default function BubbleWrapDemo() {
  return <BubbleWrap label="Unread notifications" />;
}
