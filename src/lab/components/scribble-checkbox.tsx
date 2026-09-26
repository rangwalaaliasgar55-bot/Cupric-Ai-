import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { useReducedMotion } from "@/lib/use-reduced-motion";
import { cn } from "@/lib/cn";
import { usePreviewPlay } from "@/lab/preview-play";

// A pen accelerates into a stroke and eases off at the tip.
const PEN = "cubic-bezier(0.65,0,0.35,1)";
const CHECK_MS = 200;
// The strike starts while the check's tail is still drawing, the way a
// hand moves on before the previous mark is quite finished.
const STRIKE_DELAY_MS = 140;
const FADE_MS = 180;

type Line = { x0: number; x1: number; y: number };

// FNV-1a: turns a label into a stable seed, so the server and the client
// draw the same wobble and every item still gets its own hand.
function hash(text: string) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function random(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const r = (n: number) => Math.round(n * 10) / 10;

type Stroke = { d: string; width: number };

// A quick check drawn in a 24 unit box that sits over the 20px checkbox: a
// short dip into the valley, then a long flick past the box's top right
// corner. Every part varies (start, dip, the flick's angle and length, its
// bow, a stray tail, pen weight) but inside ranges that always read as a
// check: the flick stays 48 to 68 degrees up and at least twice the dip.
function checkPath(seed: number): Stroke {
  const rand = random(seed);
  const between = (a: number, b: number) => a + rand() * (b - a);
  const sx = between(3.5, 7);
  const sy = between(10, 14);
  // The valley sits right of and below the start; how far sets the dip.
  const vx = sx + between(3.5, 5.5);
  const vy = between(16.5, 19.5);
  const angle = (between(48, 68) * Math.PI) / 180;
  const length = between(15, 21);
  const ex = vx + Math.cos(angle) * length;
  const ey = vy - Math.sin(angle) * length;
  // Bows each segment sideways a little, the way a wrist arcs.
  const dipBow = between(-1.2, 1.4);
  const flickBow = between(-2.2, 1.6);
  const nx = Math.sin(angle);
  const ny = Math.cos(angle);
  let d =
    `M${r(sx)} ${r(sy)}` +
    `C${r(sx + 1.3 + dipBow)} ${r(sy + 2 - dipBow * 0.5)} ${r(vx - 1.8)} ${r(vy - between(0.2, 1.4))} ${r(vx)} ${r(vy)}` +
    `C${r(vx + (ex - vx) * 0.3 + nx * flickBow)} ${r(vy + (ey - vy) * 0.3 + ny * flickBow)} ${r(vx + (ex - vx) * 0.7 + nx * flickBow)} ${r(vy + (ey - vy) * 0.7 + ny * flickBow)} ${r(ex)} ${r(ey)}`;
  // Sometimes the pen lifts with a small hook instead of a clean stop.
  if (rand() < 0.45) {
    d += `q${r(between(0.6, 1.6))} ${r(between(-0.6, 0.3))} ${r(between(1.2, 2.6))} ${r(between(0.4, 1.4))}`;
  }
  return { d, width: r(between(1.75, 2.3)) };
}

// One wavering line per wrapped line of text, with its own slope, sag and
// ragged ends.
function strikePath(line: Line, seed: number): Stroke {
  const rand = random(seed);
  const between = (a: number, b: number) => a + rand() * (b - a);
  const x0 = line.x0 - between(1, 5);
  const x1 = line.x1 + between(1, 6);
  const w = x1 - x0;
  const { y } = line;
  // Mostly rising left to right, as a right hand's quick line tends to.
  const slope = between(-2, 0.6);
  const d =
    `M${r(x0)} ${r(y - slope / 2 + between(-0.6, 0.6))}` +
    `C${r(x0 + w * between(0.25, 0.4))} ${r(y + between(-1.8, 1.8))} ${r(x0 + w * between(0.6, 0.75))} ${r(y + between(-1.8, 1.8))} ${r(x1)} ${r(y + slope / 2 + between(-0.6, 0.6))}`;
  return { d, width: r(between(1.4, 1.9)) };
}

// Longer lines take longer to draw, but never so long the pen feels slow.
const strikeMs = (line: Line) => Math.round(Math.min(260, Math.max(120, (line.x1 - line.x0) * 0.9)));

function strokeStyle(
  checked: boolean,
  delay: number,
  duration: number,
  reduceMotion: boolean | null,
) {
  if (checked) {
    return {
      strokeDashoffset: 0,
      opacity: 1,
      transition: reduceMotion
        ? `opacity ${FADE_MS}ms ease-out`
        : `stroke-dashoffset ${duration}ms ${PEN} ${delay}ms`,
    };
  }
  // Unchecking never un-draws: the ink fades, and only once it's invisible
  // does the stroke rewind for the next check.
  return {
    // Slightly past 1 (with a gap of 2 in the dash array) so the round cap
    // of an undrawn stroke never leaves a dot at either end while it waits.
    strokeDashoffset: 1.04,
    opacity: 0,
    transition: `opacity ${FADE_MS}ms ease-out, stroke-dashoffset 0ms linear ${FADE_MS}ms`,
  };
}

export function ScribbleCheckbox({
  children,
  checked: checkedProp,
  defaultChecked = false,
  onCheckedChange,
  seed: seedProp,
  name,
  className,
}: {
  children: ReactNode;
  checked?: boolean;
  defaultChecked?: boolean;
  onCheckedChange?: (checked: boolean) => void;
  /** Wobble for the first render (before any click). Defaults to a hash of the label. */
  seed?: number;
  name?: string;
  className?: string;
}) {
  const reduceMotion = useReducedMotion();
  const [inner, setInner] = useState(defaultChecked);
  const checked = checkedProp ?? inner;
  // Starts from a seed the server can reproduce, then rolls a fresh one on
  // every check after mount, so no two checks are ever drawn the same.
  const [seed, setSeed] = useState(
    () => seedProp ?? hash(typeof children === "string" ? children : "item"),
  );
  const check = checkPath(seed);

  const wrapRef = useRef<HTMLSpanElement>(null);
  const textRef = useRef<HTMLSpanElement>(null);
  const [lines, setLines] = useState<Line[]>([]);

  // The strike follows the text's real line boxes, so a label that wraps
  // gets one stroke per line, drawn left to right, top to bottom.
  useLayoutEffect(() => {
    const wrap = wrapRef.current;
    const text = textRef.current;
    if (!wrap || !text) return;
    let alive = true;

    const measure = () => {
      const origin = wrap.getBoundingClientRect();
      // Client rects are in screen pixels, but the strokes are drawn inside
      // any CSS scale an ancestor applies (the index cards shrink demos), so
      // divide it back out or the scale lands twice.
      const k = wrap.offsetWidth ? origin.width / wrap.offsetWidth : 1;
      const s = Number.isFinite(k) && k > 0 ? k : 1;
      const range = document.createRange();
      range.selectNodeContents(text);
      const rows: { top: number; bottom: number; left: number; right: number }[] = [];
      for (const rect of Array.from(range.getClientRects())) {
        if (rect.width < 1) continue;
        const row = rows.find((l) => Math.abs(l.top - rect.top) < rect.height / 2);
        if (row) {
          row.left = Math.min(row.left, rect.left);
          row.right = Math.max(row.right, rect.right);
        } else {
          rows.push({ top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right });
        }
      }
      const next = rows.map((row) => ({
        x0: r((row.left - origin.left) / s),
        x1: r((row.right - origin.left) / s),
        // Just under the middle of the line box lands on the x-height.
        y: r(((row.top + row.bottom) / 2 - origin.top) / s + 0.5),
      }));
      setLines((prev) =>
        prev.length === next.length &&
        prev.every((l, i) => l.x0 === next[i].x0 && l.x1 === next[i].x1 && l.y === next[i].y)
          ? prev
          : next,
      );
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(wrap);
    document.fonts?.ready.then(() => {
      if (alive) measure();
    });
    return () => {
      alive = false;
      observer.disconnect();
    };
  }, []);

  const toggle = (next: boolean) => {
    // Only ever from a user event, never during render, so SSR stays stable.
    if (next) setSeed(Math.floor(Math.random() * 4294967296));
    if (checkedProp === undefined) setInner(next);
    onCheckedChange?.(next);
  };

  return (
    <label
      className={cn(
        "group relative flex cursor-pointer items-start gap-3 py-2 text-[15px] leading-6 select-none",
        className,
      )}
    >
      <input
        type="checkbox"
        name={name}
        checked={checked}
        onChange={(e) => toggle(e.target.checked)}
        className="peer sr-only"
      />
      <span
        aria-hidden
        className={cn(
          "relative mt-0.5 size-5 shrink-0 rounded-[6px] border border-border bg-background transition-[border-color,scale] duration-150 ease-out group-active:scale-[0.96]",
          "group-hover:border-foreground/25 peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-solid peer-focus-visible:outline-foreground",
        )}
      >
        {/* Larger than the box and pulled up and right, so the flick can
            leave it the way a real pen mark would. */}
        <svg
          viewBox="0 0 24 24"
          fill="none"
          className="pointer-events-none absolute -top-2 -left-0.5 size-6 overflow-visible text-foreground"
        >
          <path
            d={check.d}
            pathLength={1}
            stroke="currentColor"
            strokeWidth={check.width}
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeDasharray="1 2"
            style={strokeStyle(checked, 0, CHECK_MS, reduceMotion)}
          />
        </svg>
      </span>
      <span ref={wrapRef} className="relative min-w-0">
        <span
          ref={textRef}
          className={cn(
            "transition-[color] duration-200 ease-out",
            checked ? "text-muted" : "text-foreground",
          )}
        >
          {children}
        </span>
        <svg
          aria-hidden
          fill="none"
          className="pointer-events-none absolute inset-0 size-full overflow-visible text-foreground/70"
        >
          {lines.map((line, i) => {
            const duration = strikeMs(line);
            // Each line waits for the ones above it, so the pen reads the
            // label in order.
            const delay = lines.slice(0, i).reduce((sum, l) => sum + strikeMs(l), STRIKE_DELAY_MS);
            const style = strokeStyle(checked, delay, duration, reduceMotion);
            const strike = strikePath(line, seed + i + 1);
            return (
              <path
                key={i}
                d={strike.d}
                pathLength={1}
                stroke="currentColor"
                strokeWidth={strike.width}
                strokeLinecap="round"
                strokeDasharray="1 2"
                style={style}
              />
            );
          })}
        </svg>
      </span>
    </label>
  );
}

const TODOS = [
  { label: "Reply to Maya about the venue", done: true },
  { label: "Book the Friday train to Jaipur", done: false },
  { label: "Renew passport before March, the form needs a new photo", done: false },
  { label: "Water the plants", done: false },
];

const RESTING = TODOS.map((todo) => todo.done);

export default function ScribbleCheckboxDemo() {
  const play = usePreviewPlay();
  const [shown, setShown] = useState(RESTING);

  // Index preview: someone works down the list, ticking each open item off
  // in turn, looks at the finished list for a moment, then it resets.
  useEffect(() => {
    if (!play) return;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const show = () => {
      let at = 300;
      const next = [...RESTING];
      RESTING.forEach((done, i) => {
        if (done) return;
        timers.push(
          setTimeout(() => {
            next[i] = true;
            setShown([...next]);
          }, at),
        );
        // Longer labels take longer to strike, so the next tick waits.
        at += 520 + TODOS[i].label.length * 6;
      });
      timers.push(setTimeout(() => setShown(RESTING), at + 1400));
      timers.push(setTimeout(show, at + 2300));
    };
    show();
    return () => {
      timers.forEach(clearTimeout);
      setShown(RESTING);
    };
  }, [play]);

  return (
    <fieldset className="w-[min(300px,100%)]">
      <legend className="mb-1 text-xs font-medium text-muted">Today</legend>
      {TODOS.map((todo, i) => (
        <ScribbleCheckbox
          key={todo.label}
          defaultChecked={todo.done}
          // Only an index card drives the boxes; on its own page they're the reader's.
          checked={play === null ? undefined : play ? shown[i] : todo.done}
        >
          {todo.label}
        </ScribbleCheckbox>
      ))}
    </fieldset>
  );
}
