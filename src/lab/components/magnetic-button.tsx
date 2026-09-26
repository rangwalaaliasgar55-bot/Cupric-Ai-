import { useRef } from "react";
import { motion, useMotionValue, useSpring, useTransform } from "motion/react";
import { useReducedMotion } from "@/lib/use-reduced-motion";
import { cn } from "@/lib/cn";

// How far past its edges the button starts to feel the cursor, in px.
const FIELD = 96;
// Share of the cursor's offset the button follows at full strength.
const STRENGTH = 0.5;
// Light and a little loose, so it follows like it's on a short elastic.
const FOLLOW = { stiffness: 180, damping: 14, mass: 0.2 };
// The label travels further than the button, so it reads as a layer above it.
const LABEL_DEPTH = 0.5;
// The body stretches toward the pull like something soft on a magnet: 1% per
// 1.2px of pull, capped at 12% so the pill never turns into a blob. It thins
// by half as much across, which roughly keeps its area.
const STRETCH_PER_PX = 1 / 120;
const MAX_STRETCH = 0.12;
// Much looser than the follow (damping ratio about 0.4), so when the cursor
// lets go the pill jiggles through a squash or two before it settles.
const WOBBLE = { stiffness: 320, damping: 10, mass: 0.5 };

export function MagneticButton({
  children,
  className,
  ...props
}: React.ComponentProps<"button">) {
  const reduceMotion = useReducedMotion();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const pullX = useMotionValue(0);
  const pullY = useMotionValue(0);
  const x = useSpring(pullX, FOLLOW);
  const y = useSpring(pullY, FOLLOW);
  const stretchTarget = useTransform(() =>
    Math.min(Math.hypot(x.get(), y.get()) * STRETCH_PER_PX, MAX_STRETCH),
  );
  const stretch = useSpring(stretchTarget, WOBBLE);
  // The pull's direction, held once the pull fades out: a spring settling
  // around zero has no direction of its own, and the jiggle should stay on
  // the axis the pill was stretched along.
  const heading = useRef(0);
  const angle = useTransform(() => {
    const dx = x.get();
    const dy = y.get();
    if (Math.hypot(dx, dy) > 1) heading.current = Math.atan2(dy, dx);
    return heading.current;
  });
  // Stretch along the pull: turn to its axis, scale, turn back.
  const transform = useTransform(() => {
    const s = stretch.get();
    const a = angle.get();
    return `translate(${x.get()}px, ${y.get()}px) rotate(${a}rad) scale(${1 + s}, ${1 - s / 2}) rotate(${-a}rad)`;
  });
  // The exact inverse of the stretch, so the label never distorts, plus its
  // own parallax.
  const labelTransform = useTransform(() => {
    const s = stretch.get();
    const a = angle.get();
    return `translate(${x.get() * LABEL_DEPTH}px, ${y.get() * LABEL_DEPTH}px) rotate(${a}rad) scale(${1 / (1 + s)}, ${1 / (1 - s / 2)}) rotate(${-a}rad)`;
  });

  const release = () => {
    pullX.set(0);
    pullY.set(0);
  };

  return (
    // The padding is the magnetic field: it catches the cursor before it
    // reaches the button. The matching negative margin keeps it out of the
    // layout, so the page only makes room for the button itself.
    <div
      style={{ padding: FIELD, margin: -FIELD }}
      onPointerMove={(e) => {
        if (reduceMotion || e.pointerType === "touch") return;
        const box = buttonRef.current?.getBoundingClientRect();
        if (!box) return;
        const dx = e.clientX - (box.left + box.width / 2);
        const dy = e.clientY - (box.top + box.height / 2);
        const reach = Math.max(box.width, box.height) / 2 + FIELD;
        const t = Math.min(Math.hypot(dx, dy) / reach, 1);
        // Weakens with distance like a real magnet, reaching zero at the edge
        // of the field so entering or leaving it never jolts the button.
        const strength = STRENGTH * (1 - t) ** 2;
        pullX.set(dx * strength);
        pullY.set(dy * strength);
      }}
      onPointerLeave={release}
    >
      <motion.div style={{ transform }}>
        <button
          ref={buttonRef}
          className={cn(
            "h-12 rounded-full bg-foreground px-6 text-sm font-medium whitespace-nowrap text-background transition-[scale] duration-150 ease-out active:scale-[0.96] motion-reduce:transition-none",
            className,
          )}
          {...props}
        >
          <motion.span
            className="flex items-center gap-2"
            style={{ transform: labelTransform }}
          >
            {children}
          </motion.span>
        </button>
      </motion.div>
    </div>
  );
}

export default function MagneticButtonDemo() {
  return (
    <MagneticButton type="button">
      Get in touch
      <svg
        viewBox="0 0 16 16"
        className="size-4"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        <path d="M3 8h10M9 4l4 4-4 4" />
      </svg>
    </MagneticButton>
  );
}
