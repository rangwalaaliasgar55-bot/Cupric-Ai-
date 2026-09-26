import { useEffect, useRef, useState } from "react";
import {
  animate,
  AnimatePresence,
  motion,
  type AnimationPlaybackControls,
} from "motion/react";
import { useReducedMotion } from "@/lib/use-reduced-motion";
import { cn } from "@/lib/cn";

// Starting at rest and kicked upward, the spring peaks near 1.15 about 50ms
// in and settles with one faint dip, all inside ~350ms.
const POP = { type: "spring", stiffness: 600, damping: 20 } as const;
const POP_VELOCITY = 6.3;
// The stars behind the clicked one echo it at half strength (about 1.07).
const ECHO_VELOCITY = 3;
const ECHO_STAGGER = 0.03;
const WORDS = ["Not rated", "Poor", "Fair", "Good", "Great", "Excellent"];
// Slow enough to read as the value settling rather than blinking, while
// still well under the time it takes to sweep across the next star.
const FADE = { duration: 0.25, ease: [0.23, 1, 0.32, 1] } as const;
const FADE_OUT = { duration: 0.15, ease: [0.23, 1, 0.32, 1] } as const;

function wordFor(value: number, max: number) {
  // Maps any scale onto the five words, rounding halves up.
  return WORDS[Math.ceil((value / max) * (WORDS.length - 1))];
}

export function StarRating({
  value,
  onChange,
  max = 5,
  label = "Rating",
  className,
}: {
  value: number;
  onChange: (value: number) => void;
  max?: number;
  label?: string;
  className?: string;
}) {
  const reduceMotion = useReducedMotion();
  const [hover, setHover] = useState<number | null>(null);
  const stars = useRef<(HTMLSpanElement | null)[]>([]);
  const pops = useRef<AnimationPlaybackControls[]>([]);

  useEffect(() => () => pops.current.forEach((p) => p.stop()), []);

  const shown = hover ?? value;
  const previewing = hover !== null && hover !== value;
  const number = shown > 0 ? shown.toFixed(1) : "";

  const valueAt = (clientX: number, box: DOMRect) => {
    const raw = ((clientX - box.left) / box.width) * max;
    // Left half of a star is a half point.
    return Math.min(Math.max(Math.ceil(raw * 2) / 2, 0.5), max);
  };

  const pop = (next: number, echo: boolean) => {
    if (reduceMotion || next <= 0) return;
    pops.current.forEach((p) => p.stop());
    const last = Math.ceil(next) - 1;
    const first = echo ? 0 : last;
    pops.current = [];
    for (let i = last; i >= first; i--) {
      const el = stars.current[i];
      if (!el) continue;
      // Targets the resting scale with an initial kick, so a second click
      // mid-pop continues from wherever the star is instead of restarting.
      pops.current.push(
        animate(
          el,
          { scale: 1 },
          {
            ...POP,
            velocity: i === last ? POP_VELOCITY : ECHO_VELOCITY,
            delay: (last - i) * ECHO_STAGGER,
          },
        ),
      );
    }
  };

  const commit = (next: number, echo: boolean) => {
    const clamped = Math.min(Math.max(next, 0), max);
    if (clamped !== value) onChange(clamped);
    pop(clamped, echo);
  };

  return (
    <div className={cn("flex items-center gap-3", className)}>
      <div
        role="slider"
        tabIndex={0}
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={max}
        aria-valuenow={value}
        aria-valuetext={`${value} out of ${max}, ${wordFor(value, max)}`}
        className="flex cursor-pointer touch-manipulation rounded-md outline-hidden focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-foreground"
        onPointerMove={(e) => {
          // Touch has no hover; a tap goes straight to commit.
          if (e.pointerType === "touch") return;
          const box = e.currentTarget.getBoundingClientRect();
          setHover(valueAt(e.clientX, box));
        }}
        onPointerLeave={() => setHover(null)}
        onClick={(e) => {
          const box = e.currentTarget.getBoundingClientRect();
          commit(valueAt(e.clientX, box), true);
        }}
        onKeyDown={(e) => {
          const delta = {
            ArrowRight: 0.5,
            ArrowUp: 0.5,
            ArrowLeft: -0.5,
            ArrowDown: -0.5,
            PageUp: 1,
            PageDown: -1,
            Home: -max,
            End: max,
          }[e.key];
          if (delta === undefined) return;
          e.preventDefault();
          // Keys retarget the hover preview too, so the two never disagree.
          setHover(null);
          // Arrows repeat while held, so only the landing star pops.
          commit(value + delta, false);
        }}
      >
        {Array.from({ length: max }, (_, i) => {
          const fill = Math.min(Math.max(shown - i, 0), 1);
          return (
            // Padding instead of gaps, so there's no dead zone between stars.
            <span key={i} className="p-0.5">
              <span
                ref={(el) => {
                  stars.current[i] = el;
                }}
                className="relative block size-6"
              >
                <Star className="text-foreground/15" />
                {/* A short glide rather than a snap, so sweeping across the
                    stars fills them like a pour. A CSS transition retargets
                    mid-flight, so a fast sweep never lags behind the pointer. */}
                <Star
                  className="absolute inset-0 text-foreground transition-[clip-path] duration-200 ease-out motion-reduce:transition-none"
                  style={{ clipPath: `inset(0 ${(1 - fill) * 100}% 0 0)` }}
                />
              </span>
            </span>
          );
        })}
      </div>

      {/* Fixed width, so the stars never shift as the words change. */}
      <div
        aria-hidden
        className={cn(
          "flex w-28 items-baseline gap-1.5 text-sm transition-[color] duration-250 ease-out",
          previewing ? "text-muted" : "text-foreground",
        )}
      >
        <Crossfade id={number} reduceMotion={reduceMotion}>
          <span className="font-medium tabular-nums">{number}</span>
        </Crossfade>
        <Crossfade id={wordFor(shown, max)} reduceMotion={reduceMotion}>
          <span className={cn(shown === 0 && "text-muted")}>
            {wordFor(shown, max)}
          </span>
        </Crossfade>
      </div>
    </div>
  );
}

function Crossfade({
  id,
  reduceMotion,
  children,
}: {
  id: string;
  reduceMotion: boolean | null;
  children: React.ReactNode;
}) {
  // The new value rises into place as the old one drifts up and out, like a
  // counter rolling over.
  const enter = reduceMotion
    ? { opacity: 0 }
    : { opacity: 0, y: 4, filter: "blur(4px)" };
  const leave = reduceMotion
    ? { opacity: 0 }
    : { opacity: 0, y: -4, filter: "blur(4px)" };
  return (
    // Both versions share one grid cell while they cross.
    <span className="grid">
      <AnimatePresence initial={false}>
        <motion.span
          key={id}
          className="col-start-1 row-start-1 whitespace-nowrap"
          initial={enter}
          animate={{ opacity: 1, y: 0, filter: "blur(0px)", transition: FADE }}
          exit={{ ...leave, transition: FADE_OUT }}
        >
          {children}
        </motion.span>
      </AnimatePresence>
    </span>
  );
}

function Star({
  className,
  style,
}: {
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={cn("size-6", className)}
      style={style}
      fill="currentColor"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M12 3.2l2.7 5.47 6.03.88-4.36 4.25 1.03 6-5.4-2.84-5.4 2.84 1.03-6-4.36-4.25 6.03-.88L12 3.2z" />
    </svg>
  );
}

export default function StarRatingDemo() {
  const [rating, setRating] = useState(3.5);
  return (
    <div className="flex flex-col items-start gap-2">
      <p className="text-sm text-muted">How was your stay?</p>
      <StarRating value={rating} onChange={setRating} label="Stay rating" />
    </div>
  );
}
