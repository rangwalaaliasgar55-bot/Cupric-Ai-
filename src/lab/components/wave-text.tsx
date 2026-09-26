import { useEffect, useRef } from "react";
import {
  animate,
  motion,
  useMotionValue,
  useSpring,
  useTransform,
  type MotionValue,
} from "motion/react";
import { useReducedMotion } from "@/lib/use-reduced-motion";
import { cn } from "@/lib/cn";

// Enough lift to read as a wave at 44px without letters touching the line above.
const LIFT = 8;
const GROW = 0.08;
// About two letters either side of the cursor get pulled along.
const SPREAD = 44;
// Soft enough that the crest trails the cursor slightly; no overshoot, so
// letters never dip below the baseline.
const FOLLOW = { stiffness: 220, damping: 26 };
const SETTLE = { stiffness: 180, damping: 24 };
// A tap ripple has to cross the whole word, so it runs longer than UI motion.
const RIPPLE_S = 0.9;
// How far letters away from the cursor fade toward muted in reduced motion.
const DIM = 45;

function bell(distance: number) {
  return Math.exp(-((distance / SPREAD) ** 2));
}

type Field = {
  pointer: MotionValue<number>;
  hover: MotionValue<number>;
  ripple: MotionValue<number>;
  // [tap origin x, heading width], written on tap, read by every letter.
  tap: React.RefObject<[number, number]>;
  reduce: boolean;
};

export function WaveText({
  text,
  className,
}: {
  text: string;
  className?: string;
}) {
  const reduce = useReducedMotion() ?? false;
  const headingRef = useRef<HTMLHeadingElement>(null);

  const rawPointer = useMotionValue(0);
  const pointer = useSpring(rawPointer, FOLLOW);
  const rawHover = useMotionValue(0);
  const hover = useSpring(rawHover, SETTLE);
  // 0 to 1 as a tap ripple travels outward; 1 means spent.
  const ripple = useMotionValue(1);
  const tap = useRef<[number, number]>([0, 1]);

  const field: Field = { pointer, hover, ripple, tap, reduce };

  const localX = (e: React.PointerEvent) =>
    e.clientX - (headingRef.current?.getBoundingClientRect().left ?? 0);

  const words = text.split(" ");
  const starts = words.map((_, i) =>
    words.slice(0, i).reduce((sum, word) => sum + word.length, 0),
  );

  return (
    <h2
      ref={headingRef}
      aria-label={text}
      className={cn(
        "relative cursor-default text-[44px] leading-tight font-medium tracking-tight text-foreground select-none",
        className,
      )}
      onPointerEnter={(e) => {
        if (e.pointerType === "touch") return;
        // Start the crest under the cursor instead of sweeping in from the edge.
        const x = localX(e);
        rawPointer.jump(x);
        pointer.jump(x);
      }}
      onPointerMove={(e) => {
        if (e.pointerType === "touch") return;
        rawPointer.set(localX(e));
        rawHover.set(1);
      }}
      onPointerLeave={() => rawHover.set(0)}
      onPointerDown={(e) => {
        if (e.pointerType !== "touch") return;
        tap.current = [localX(e), headingRef.current?.offsetWidth ?? 1];
        animate(ripple, [0, 1], { duration: RIPPLE_S, ease: [0.23, 1, 0.32, 1] });
      }}
    >
      {words.map((word, w) => (
        <span key={w} aria-hidden>
          {/* Keeps a word's letters together, so lines only break between words. */}
          <span className="inline-block whitespace-nowrap">
            {Array.from(word).map((char, c) => (
              <Letter
                key={c}
                char={char}
                heading={headingRef}
                field={field}
                order={starts[w] + c}
              />
            ))}
          </span>
          {w < words.length - 1 && " "}
        </span>
      ))}
    </h2>
  );
}

function Letter({
  char,
  heading,
  field,
  order,
}: {
  char: string;
  heading: React.RefObject<HTMLHeadingElement | null>;
  field: Field;
  order: number;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  // Measured on mount and resize, never per frame.
  const center = useRef(0);

  useEffect(() => {
    const el = ref.current;
    const parent = heading.current;
    if (!el || !parent) return;
    const measure = () => {
      // The heading is the offsetParent, and offsetLeft ignores transforms,
      // so a lifted letter still measures its resting position.
      center.current = el.offsetLeft + el.offsetWidth / 2;
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(parent);
    return () => observer.disconnect();
  }, [heading, order]);

  const { pointer, hover, ripple, tap, reduce } = field;

  const strength = useTransform([pointer, hover, ripple], ([p, h, r]) => {
    const near = bell((p as number) - center.current) * (h as number);
    const progress = r as number;
    if (progress >= 1) return near;
    // The ring's radius grows with progress while its height fades out.
    const [from, width] = tap.current;
    const wave =
      bell(Math.abs(center.current - from) - progress * width) * (1 - progress);
    return Math.max(near, wave);
  });

  // Both styles stay bound in either mode; only what they output changes.
  const transform = useTransform(strength, (s) =>
    reduce ? "none" : `translateY(${-LIFT * s}px) scale(${1 + GROW * s})`,
  );
  const color = useTransform([strength, hover], ([s, h]) =>
    reduce
      ? `color-mix(in oklab, var(--foreground), var(--muted) ${Math.round(
          DIM * Math.max(0, (h as number) - (s as number)),
        )}%)`
      : "var(--foreground)",
  );

  return (
    <motion.span
      ref={ref}
      className="inline-block origin-bottom"
      style={{ transform, color }}
    >
      {char}
    </motion.span>
  );
}

export default function WaveTextDemo() {
  return (
    <div className="flex max-w-full flex-col items-center gap-3 text-center">
      <WaveText text="Ride the wave" />
      <p className="text-sm text-muted">Move across the letters, or tap them.</p>
    </div>
  );
}
