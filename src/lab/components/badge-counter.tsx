import { useEffect, useRef, useState } from "react";
import {
  animate,
  AnimatePresence,
  motion,
  type AnimationPlaybackControls,
} from "motion/react";
import { useReducedMotion } from "@/lib/use-reduced-motion";
import { cn } from "@/lib/cn";
import { usePreviewPlay } from "@/lab/preview-play";

const EASE_OUT = [0.23, 1, 0.32, 1] as const;
// Kicked from rest at 1, this spring peaks near 1.15 about 70ms in, dips
// once to ~0.97 and settles. A spring (not keyframes) so a burst of changes
// keeps the bump alive instead of restarting it from zero each time.
const BUMP = { type: "spring", stiffness: 600, damping: 20 } as const;
const BUMP_VELOCITY = 6.5;
// Anything above this shows as "99+", which is all anyone reads anyway.
const CAP = 99;
// A single digit sits in a circle this wide; more digits grow a pill.
const MIN_WIDTH = 20;
const PADDING_X = 12;

type Slot = { key: string; char: string };

// Keyed by place value from the right, so only the digits that change roll
// and the ones digit stays the ones digit when a tens digit arrives. When
// capped, the two nines keep their slots and only the "+" is new.
function slots(count: number): Slot[] {
  if (count > CAP) {
    return [
      { key: "2", char: "9" },
      { key: "1", char: "9" },
      { key: "plus", char: "+" },
    ];
  }
  const digits = String(count).split("");
  return digits.map((char, i) => ({ key: String(digits.length - i), char }));
}

export function BadgeCounter({
  count,
  label = "Inbox",
  noun = "unread",
  onClick,
  icon,
  className,
}: {
  count: number;
  label?: string;
  noun?: string;
  onClick?: () => void;
  /** Replaces the inbox glyph; should be a 20px currentColor icon. */
  icon?: React.ReactNode;
  className?: string;
}) {
  const reduceMotion = useReducedMotion();
  const bumpRef = useRef<HTMLSpanElement>(null);
  const bump = useRef<AnimationPlaybackControls>(undefined);
  const [prev, setPrev] = useState(count);
  const [direction, setDirection] = useState(1);
  if (prev !== count) {
    setDirection(count > prev ? 1 : -1);
    setPrev(count);
  }

  const lastCount = useRef(count);
  useEffect(() => {
    const was = lastCount.current;
    lastCount.current = count;
    // Appearing from zero already has its own entrance, and a capped badge
    // shows the same "99+", so neither gets a bump.
    if (was === count || was === 0 || count === 0) return;
    if (was > CAP && count > CAP) return;
    if (reduceMotion || !bumpRef.current) return;
    bump.current?.stop();
    bump.current = animate(
      bumpRef.current,
      { scale: 1 },
      { ...BUMP, velocity: BUMP_VELOCITY },
    );
  }, [count, reduceMotion]);
  useEffect(() => () => bump.current?.stop(), []);

  const shown = count > CAP ? `${CAP}+` : String(count);
  const summary =
    count > 0 ? `${label}, ${shown} ${noun}` : `${label}, nothing ${noun}`;

  return (
    <span className={cn("relative inline-flex", className)}>
      <button
        type="button"
        aria-label={summary}
        onClick={onClick}
        className="flex size-10 touch-manipulation items-center justify-center rounded-full bg-surface text-foreground shadow-raised outline-hidden transition-[scale,background-color] duration-150 ease-out select-none hover:bg-background focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-foreground active:scale-[0.96] motion-reduce:transition-[background-color]"
      >
        {icon ?? <InboxGlyph />}
      </button>

      {/* Its left edge is pinned just inside the corner, so growing from one
          digit to two widens it outward, away from the icon. */}
      <AnimatePresence initial={false}>
        {count > 0 && (
          <motion.span
            key="badge"
            aria-hidden
            className="pointer-events-none absolute -top-1 left-[calc(100%-18px)] origin-bottom-left"
            initial={{
              scale: reduceMotion ? 1 : 0.5,
              opacity: 0,
              filter: reduceMotion ? "blur(0px)" : "blur(2px)",
            }}
            animate={{
              scale: 1,
              opacity: 1,
              filter: "blur(0px)",
              transition: reduceMotion
                ? { duration: 0.15 }
                : {
                    type: "spring",
                    duration: 0.35,
                    bounce: 0.3,
                    // A spring overshoots, and blur below zero is invalid.
                    filter: { duration: 0.2, ease: EASE_OUT },
                  },
            }}
            // Clearing to zero is a soft shrink, quicker and without bounce.
            exit={{
              scale: reduceMotion ? 1 : 0.6,
              opacity: 0,
              filter: reduceMotion ? "blur(0px)" : "blur(2px)",
              transition: { duration: 0.18, ease: EASE_OUT },
            }}
          >
            <span ref={bumpRef} className="block origin-center">
              <Pill count={count} direction={direction} />
            </span>
          </motion.span>
        )}
      </AnimatePresence>

      <span className="sr-only" aria-live="polite" aria-atomic>
        {summary}
      </span>
    </span>
  );
}

function Pill({ count, direction }: { count: number; direction: number }) {
  const reduceMotion = useReducedMotion();
  const text = useRef<HTMLSpanElement>(null);
  const [width, setWidth] = useState(MIN_WIDTH);
  // New places that arrive after mount (9 to 10) roll in; the first render
  // does not.
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const frame = requestAnimationFrame(() => setReady(true));
    const node = text.current;
    if (!node) return () => cancelAnimationFrame(frame);
    // Width is animated (not scale) because the pill must grow around its
    // digits without stretching them; it is a 20px element, so the layout
    // cost is negligible. Measured, so any font size just works.
    const observer = new ResizeObserver(() => {
      setWidth(Math.max(MIN_WIDTH, Math.ceil(node.offsetWidth) + PADDING_X));
    });
    observer.observe(node);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, []);

  const custom = { direction, reduceMotion };

  return (
    <span
      style={{ width }}
      className={cn(
        // text-background on danger clears 4.5:1 in both themes (5.2 light,
        // 5.3 dark), and the ring cuts it cleanly off the button.
        "flex h-5 items-center justify-center overflow-hidden rounded-full bg-danger text-[12px] leading-5 font-semibold text-background tabular-nums ring-2 ring-background",
        "transition-[width] duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] motion-reduce:transition-none",
      )}
    >
      <span ref={text} className="flex">
        {slots(count).map((slot) => (
          <span key={slot.key} className="inline-grid overflow-hidden">
            <AnimatePresence initial={ready} custom={custom}>
              <motion.span
                key={slot.char}
                custom={custom}
                variants={ROLL}
                initial="enter"
                animate="center"
                exit="exit"
                className="col-start-1 row-start-1"
              >
                {slot.char}
              </motion.span>
            </AnimatePresence>
          </span>
        ))}
      </span>
    </span>
  );
}

type Roll = { direction: number; reduceMotion: boolean | null };

// Counting up brings the new digit in from below and sends the old one up,
// like an odometer; counting down runs the other way.
const ROLL = {
  enter: ({ direction, reduceMotion }: Roll) => ({
    y: reduceMotion ? "0%" : `${direction * 100}%`,
    opacity: 0,
  }),
  center: {
    y: "0%",
    opacity: 1,
    transition: { duration: 0.24, ease: EASE_OUT },
  },
  // Leaves sooner than the new digit arrives, so the two never tangle.
  exit: ({ direction, reduceMotion }: Roll) => ({
    y: reduceMotion ? "0%" : `${direction * -100}%`,
    opacity: 0,
    transition: { duration: 0.18, ease: EASE_OUT },
  }),
};

function InboxGlyph() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="size-5"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M22 12h-6l-2 3h-4l-2-3H2" />
      <path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11Z" />
    </svg>
  );
}

// Holding a stepper repeats: a pause first so a click stays a single step,
// then quick enough that reaching "99+" takes a few seconds.
const HOLD_DELAY = 380;
const HOLD_EVERY = 70;

function Stepper({
  label,
  onStep,
  disabled,
  children,
}: {
  label: string;
  onStep: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const repeat = useRef<ReturnType<typeof setInterval>>(undefined);
  const fromPointer = useRef(false);
  const step = useRef(onStep);
  useEffect(() => {
    step.current = onStep;
  });

  const stop = () => {
    clearTimeout(timer.current);
    clearInterval(repeat.current);
  };
  useEffect(() => stop, []);
  useEffect(() => {
    if (disabled) stop();
  }, [disabled]);

  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        fromPointer.current = true;
        step.current();
        stop();
        timer.current = setTimeout(() => {
          repeat.current = setInterval(() => step.current(), HOLD_EVERY);
        }, HOLD_DELAY);
      }}
      onPointerUp={stop}
      onPointerLeave={stop}
      onPointerCancel={stop}
      onClick={() => {
        // Pointer presses already stepped on pointerdown; this path is the
        // keyboard's (Enter and Space).
        if (fromPointer.current) {
          fromPointer.current = false;
          return;
        }
        onStep();
      }}
      className="flex size-7 touch-manipulation items-center justify-center rounded-full text-muted outline-hidden transition-[scale,color,background-color,opacity] duration-150 ease-out select-none hover:bg-surface hover:text-foreground focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-foreground active:scale-[0.96] disabled:pointer-events-none disabled:opacity-40 motion-reduce:transition-[color,background-color,opacity]"
    >
      <svg
        viewBox="0 0 16 16"
        className="size-3.5"
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

// The index card's hover show: a few messages land (the pill widens at 10),
// the inbox gets opened and clears, then mail starts arriving again. Each
// entry is [wait before it in ms, count]; the waits leave room for the roll
// and the bump to finish before the next change.
const SHOW: [number, number][] = [
  [350, 9],
  [420, 10],
  [420, 11],
  [420, 12],
  [1500, 0],
  [1100, 8],
];
// A calm beat before the show starts over, so it never feels like a loop.
const SHOW_REST = 1400;
const REST_COUNT = 8;

export default function BadgeCounterDemo() {
  const [count, setCount] = useState(REST_COUNT);
  const play = usePreviewPlay();

  useEffect(() => {
    if (play !== true) return;
    let timer: ReturnType<typeof setTimeout>;
    const step = (i: number) => {
      const [wait, value] = SHOW[i % SHOW.length];
      const rest = i > 0 && i % SHOW.length === 0 ? SHOW_REST : 0;
      timer = setTimeout(() => {
        setCount(value);
        step(i + 1);
      }, wait + rest);
    };
    step(0);
    // Unhovering rolls (or pops) back to the resting count.
    return () => {
      clearTimeout(timer);
      setCount(REST_COUNT);
    };
  }, [play]);

  return (
    <div className="flex flex-col items-center gap-5">
      {/* Opening the inbox reads everything, which is how you see the badge
          shrink away. */}
      <BadgeCounter count={count} onClick={() => setCount(0)} />
      <div className="flex items-center gap-1">
        <Stepper
          label="One fewer message"
          disabled={count === 0}
          onStep={() => setCount((c) => Math.max(0, c - 1))}
        >
          <path d="M3.5 8h9" />
        </Stepper>
        <Stepper
          label="One more message"
          disabled={count >= 150}
          onStep={() => setCount((c) => Math.min(150, c + 1))}
        >
          <path d="M8 3.5v9M3.5 8h9" />
        </Stepper>
      </div>
    </div>
  );
}
