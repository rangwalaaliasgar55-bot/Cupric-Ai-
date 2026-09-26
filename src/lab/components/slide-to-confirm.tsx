import { useEffect, useId, useRef, useState } from "react";
import {
  animate,
  motion,
  useMotionTemplate,
  useMotionValue,
  useTransform,
} from "motion/react";
import { useReducedMotion } from "@/lib/use-reduced-motion";
import { cn } from "@/lib/cn";

const KNOB = 56;
const INSET = 4;
// Past this share of the track, a fast enough release finishes the slide
// even though the knob never touched the end.
const FLICK_PROGRESS = 0.7;
const FLICK_VELOCITY = 500;
// How far the knob gives when pulled back past the start, in px. Small, so
// it never pokes far outside the track.
const MAX_STRETCH = 6;
// Carries the release velocity home; the slight bounce is earned by the
// throw, and only ever happens after a drag.
const SNAP_BACK = { type: "spring", visualDuration: 0.4, bounce: 0.15 } as const;
const COMPLETE = { type: "spring", visualDuration: 0.3, bounce: 0 } as const;
// Slower than the snap back: nobody is waiting on the reset, so it can glide.
const RESET = { type: "spring", visualDuration: 0.5, bounce: 0 } as const;
const ICON_SWAP = { type: "spring", duration: 0.3, bounce: 0 } as const;
// Long enough to read "Confirmed", short enough to try again.
const CONFIRMED_FOR = 2000;

// A narrow highlight sweeps across in the first 70% of each loop, then
// rests off the edge, so it reads as an invitation rather than a warning.
const CSS = `
.slide-shimmer {
  background: linear-gradient(90deg, var(--muted) 0%, var(--muted) 45%, var(--foreground) 50%, var(--muted) 55%, var(--muted) 100%);
  background-size: 250% 100%;
  background-position: 100% 0;
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
  animation: slide-shimmer 2.6s cubic-bezier(0.45, 0, 0.55, 1) infinite;
}
[data-done="true"] .slide-shimmer { animation-play-state: paused; }
@keyframes slide-shimmer {
  70%, 100% { background-position: 0 0; }
}
@media (prefers-reduced-motion: reduce) {
  .slide-shimmer { animation: none; background: none; color: var(--muted); }
}
`;

type Anim = ReturnType<typeof animate>;

export function SlideToConfirm({
  label = "Slide to confirm",
  confirmedLabel = "Confirmed",
  onConfirm,
  className,
}: {
  label?: string;
  confirmedLabel?: string;
  onConfirm?: () => void;
  className?: string;
}) {
  const reduceMotion = useReducedMotion();
  const hintId = useId();
  const trackRef = useRef<HTMLDivElement>(null);
  const [done, setDone] = useState(false);
  const x = useMotionValue(0);
  const anim = useRef<Anim | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const drag = useRef<{
    id: number;
    offset: number;
    max: number;
    samples: { x: number; t: number }[];
  } | null>(null);

  useEffect(
    () => () => {
      clearTimeout(timer.current);
      anim.current?.stop();
    },
    [],
  );

  const maxX = () =>
    Math.max((trackRef.current?.clientWidth ?? 0) - KNOB - INSET * 2, 1);

  // The label is gone by 60% of the way, so it never sits under the knob.
  const labelOpacity = useTransform(x, (v) =>
    Math.min(Math.max(1 - v / (maxX() * 0.6), 0), 1),
  );
  // A track-wide pill whose right end rides just behind the knob. Moving it
  // is a transform, where growing a width would relayout every frame.
  const fill = useMotionTemplate`translateX(calc(${x}px - 100% + ${KNOB}px))`;

  const moveTo = (target: number, transition: object) => {
    anim.current?.stop();
    if (reduceMotion) {
      anim.current = null;
      x.jump(target);
    } else {
      anim.current = animate(x, target, transition);
    }
  };

  const confirm = (velocity = 0) => {
    drag.current = null;
    setDone(true);
    moveTo(maxX(), { ...COMPLETE, velocity });
    onConfirm?.();
    navigator.vibrate?.(10);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      setDone(false);
      moveTo(0, RESET);
    }, CONFIRMED_FOR);
  };

  const release = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d || e.pointerId !== d.id) return;
    drag.current = null;
    const first = d.samples[0];
    const end = d.samples[d.samples.length - 1];
    const dt = (end.t - first.t) / 1000;
    const velocity = dt > 0 ? (end.x - first.x) / dt : 0;
    if (x.get() / d.max >= FLICK_PROGRESS && velocity > FLICK_VELOCITY) {
      confirm(velocity);
    } else {
      moveTo(0, { ...SNAP_BACK, velocity });
    }
  };

  return (
    <div
      ref={trackRef}
      data-done={done}
      className={cn(
        "relative h-16 w-[min(360px,100%)] rounded-full bg-surface shadow-wheel select-none",
        className,
      )}
    >
      <style href="slide-to-confirm" precedence="default">
        {CSS}
      </style>

      <div aria-hidden className="absolute inset-1 overflow-hidden rounded-full">
        <motion.div
          style={{ transform: fill }}
          className={cn(
            "h-full w-full rounded-full bg-foreground transition-[opacity] duration-200 ease-[cubic-bezier(0.23,1,0.32,1)]",
            done ? "opacity-100" : "opacity-[0.08]",
          )}
        />
      </div>

      <motion.span
        aria-hidden
        style={{ opacity: labelOpacity }}
        className="absolute inset-y-0 right-0 left-16 flex items-center justify-center pr-4 text-[15px] font-medium"
      >
        <span className="slide-shimmer">{label}</span>
      </motion.span>

      {/* Enters in 200ms, leaves in 150ms: the exit should never hold the eye. */}
      <span
        aria-hidden
        className={cn(
          "absolute inset-y-0 right-16 left-0 flex items-center justify-center gap-2 pl-4 text-[15px] font-medium text-background",
          "transition-[opacity,filter] ease-[cubic-bezier(0.23,1,0.32,1)]",
          done ? "duration-200" : "opacity-0 blur-[4px] duration-150",
        )}
      >
        <motion.svg
          viewBox="0 0 16 16"
          className="size-4 shrink-0"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          initial={false}
          animate={
            done
              ? { scale: 1, opacity: 1, filter: "blur(0px)" }
              : reduceMotion
                ? { scale: 1, opacity: 0, filter: "blur(0px)" }
                : { scale: 0.25, opacity: 0, filter: "blur(4px)" }
          }
          transition={ICON_SWAP}
        >
          <path d="m3.5 8.5 3 3 6-7" />
        </motion.svg>
        {confirmedLabel}
      </span>

      <motion.button
        type="button"
        aria-label={label}
        aria-describedby={hintId}
        aria-disabled={done}
        style={{ x }}
        className={cn(
          "absolute top-1 left-1 flex size-14 touch-none items-center justify-center rounded-full bg-background text-foreground shadow-raised outline-hidden",
          "transition-[scale] duration-150 ease-out focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-foreground motion-reduce:transition-none",
          done ? "cursor-default" : "cursor-grab active:scale-[0.96] active:cursor-grabbing",
        )}
        onPointerDown={(e) => {
          if (done || (e.pointerType === "mouse" && e.button !== 0)) return;
          // Only the first finger drives; a second one mid-drag is ignored.
          if (drag.current) return;
          anim.current?.stop();
          e.currentTarget.setPointerCapture(e.pointerId);
          drag.current = {
            id: e.pointerId,
            // Keeps the knob under the exact point it was grabbed, even if
            // caught mid-spring.
            offset: e.clientX - x.get(),
            max: maxX(),
            samples: [{ x: e.clientX, t: e.timeStamp }],
          };
        }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (!d || e.pointerId !== d.id) return;
          d.samples.push({ x: e.clientX, t: e.timeStamp });
          // Only the last 100ms say how fast the hand is moving now.
          while (d.samples.length > 2 && e.timeStamp - d.samples[0].t > 100)
            d.samples.shift();
          const raw = e.clientX - d.offset;
          if (raw >= d.max) {
            const first = d.samples[0];
            const dt = (e.timeStamp - first.t) / 1000;
            confirm(dt > 0 ? (e.clientX - first.x) / dt : 0);
            return;
          }
          // Gives a little past the start, then stiffens.
          x.set(raw < 0 ? MAX_STRETCH * Math.tanh(raw / (MAX_STRETCH * 4)) : raw);
        }}
        onPointerUp={release}
        onPointerCancel={release}
        // Enter and Space, and screen reader activation, arrive as clicks
        // with no pointer detail. They slide exactly as a drag would.
        onClick={(e) => {
          if (e.detail === 0 && !done) confirm();
        }}
        onKeyDown={(e) => {
          if ((e.key === "ArrowRight" || e.key === "End") && !done) {
            e.preventDefault();
            confirm();
          }
        }}
      >
        <svg
          viewBox="0 0 16 16"
          className="size-5 translate-x-px"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <path d="m6 3.5 4.5 4.5L6 12.5" />
        </svg>
      </motion.button>

      <span id={hintId} className="sr-only">
        Drag to the end, or press Enter
      </span>
      <span className="sr-only" aria-live="polite">
        {done ? confirmedLabel : ""}
      </span>
    </div>
  );
}

export default function SlideToConfirmDemo() {
  return <SlideToConfirm />;
}
