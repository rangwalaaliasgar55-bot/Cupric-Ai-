import { useCallback, useEffect, useRef, useState } from "react";
import {
  motion,
  useSpring,
  useTransform,
  useVelocity,
  type MotionValue,
} from "motion/react";
import { useReducedMotion } from "@/lib/use-reduced-motion";
import { cn } from "@/lib/cn";

const GLYPHS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];

export function Odometer({
  value,
  digits = 3,
  className,
}: {
  value: number;
  digits?: number;
  className?: string;
}) {
  const modulo = 10 ** digits;
  const shown = ((value % modulo) + modulo) % modulo;

  return (
    <div
      className={cn(
        "inline-flex gap-1 rounded-[22px] bg-surface p-1.5 text-[64px] font-medium tracking-tight shadow-raised",
        className,
      )}
    >
      <output className="sr-only" aria-live="polite">
        {shown}
      </output>
      {Array.from({ length: digits }, (_, i) => {
        const place = 10 ** (digits - 1 - i);
        return <Wheel key={place} turns={Math.floor(value / place)} />;
      })}
    </div>
  );
}

// `turns` never wraps, so a wheel going 9 to 10 keeps rolling forward onto 0
// instead of spinning back through every digit.
function Wheel({ turns }: { turns: number }) {
  const reduceMotion = useReducedMotion();
  const position = useSpring(turns, { visualDuration: 0.35, bounce: 0.15 });
  const velocity = useVelocity(position);
  const filter = useTransform(velocity, (v) => {
    const blur = Math.min(Math.max((Math.abs(v) - 4) / 16, 0), 1) * 1.5;
    return blur > 0 ? `blur(${blur}px)` : "none";
  });

  useEffect(() => {
    if (reduceMotion) position.jump(turns);
    else position.set(turns);
  }, [turns, reduceMotion, position]);

  return (
    <div
      aria-hidden
      className="relative h-[1.4em] w-[0.8em] overflow-hidden rounded-2xl bg-background shadow-wheel"
    >
      <motion.div
        className="absolute inset-0 [mask-image:linear-gradient(transparent,black_20%,black_80%,transparent)]"
        style={{ filter: reduceMotion ? "none" : filter }}
      >
        {GLYPHS.map((digit) => (
          <Glyph key={digit} digit={digit} position={position} />
        ))}
      </motion.div>
    </div>
  );
}

function Glyph({
  digit,
  position,
}: {
  digit: number;
  position: MotionValue<number>;
}) {
  // Every glyph sits within five slots of the current position, so the wheel
  // loops forever with only ten nodes. The jump from +5 to -5 happens off view.
  const transform = useTransform(position, (p) => {
    const offset = ((((digit - p) % 10) + 15) % 10) - 5;
    return `translateY(${offset * 100}%)`;
  });

  return (
    <motion.span
      className="absolute inset-0 flex items-center justify-center tabular-nums"
      style={{ transform }}
    >
      {digit}
    </motion.span>
  );
}

function useHoldToRepeat(step: () => void) {
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const stop = useCallback(() => clearTimeout(timer.current), []);

  const start = useCallback(() => {
    stop();
    step();
    let delay = 120;
    const tick = () => {
      step();
      delay = Math.max(25, delay * 0.9);
      timer.current = setTimeout(tick, delay);
    };
    timer.current = setTimeout(tick, 400);
  }, [step, stop]);

  useEffect(() => stop, [stop]);

  return { start, stop };
}

function StepButton({
  label,
  step,
  children,
}: {
  label: string;
  step: () => void;
  children: React.ReactNode;
}) {
  const { start, stop } = useHoldToRepeat(step);

  return (
    <button
      type="button"
      aria-label={label}
      className="flex size-11 touch-manipulation items-center justify-center rounded-full bg-surface text-foreground shadow-raised transition-[scale] duration-150 ease-out select-none active:scale-[0.96] motion-reduce:transition-none"
      onPointerDown={(e) => {
        if (e.button === 0) start();
      }}
      onPointerUp={stop}
      onPointerLeave={stop}
      onPointerCancel={stop}
      onContextMenu={(e) => e.preventDefault()}
      // Pointer presses are handled above; this only catches Enter and Space.
      onClick={(e) => {
        if (e.detail === 0) step();
      }}
    >
      <svg
        viewBox="0 0 16 16"
        className="size-4"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        strokeLinecap="round"
      >
        {children}
      </svg>
    </button>
  );
}

export default function OdometerDemo() {
  const [count, setCount] = useState(0);
  const increment = useCallback(() => setCount((c) => c + 1), []);
  const decrement = useCallback(() => setCount((c) => c - 1), []);

  return (
    <div className="flex flex-col items-center gap-6">
      <Odometer value={count} />
      <div className="flex gap-3">
        <StepButton label="Decrease" step={decrement}>
          <path d="M3.5 8h9" />
        </StepButton>
        <StepButton label="Increase" step={increment}>
          <path d="M3.5 8h9M8 3.5v9" />
        </StepButton>
      </div>
    </div>
  );
}
