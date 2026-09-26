import { useState } from "react";
import {
  motion,
  useMotionTemplate,
  useMotionValue,
  useSpring,
  useTransform,
  type MotionValue,
} from "motion/react";
import { useReducedMotion } from "@/lib/use-reduced-motion";
import { cn } from "@/lib/cn";

// Past about 12 degrees the text skews enough to become hard to read.
const MAX_TILT = 12;
// Settles in roughly 300ms with no overshoot, so the card feels heavy
// rather than wobbly.
const FOLLOW = { stiffness: 300, damping: 30 };

const GRAIN = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E")`;

// A glossy surface reflects light as a streak, not a spot: one broad bright
// band with a thin echo beside it, like light on polished glass. The oversized
// background lets it slide fully across as the card tilts.
const STREAK =
  "linear-gradient(115deg, transparent 32%, oklch(1 0 0 / 0.05) 40%, oklch(1 0 0 / 0.3) 47%, oklch(1 0 0 / 0.05) 53%, transparent 56%, transparent 59%, oklch(1 0 0 / 0.14) 61%, transparent 63%)";
const STREAK_SIZE = "250% 250%";

// Paints only the 1px padding ring, so the gradient shows as a lit edge.
const RING_MASK =
  "linear-gradient(#000 0 0) content-box exclude, linear-gradient(#000 0 0)";

export function TiltCard({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  const reduceMotion = useReducedMotion();
  const [lit, setLit] = useState(false);

  // Pointer position across the card, 0 to 1 on each axis.
  const pointerX = useMotionValue(0.5);
  const pointerY = useMotionValue(0.5);
  const x = useSpring(pointerX, FOLLOW);
  const y = useSpring(pointerY, FOLLOW);

  // The edge under the pointer dips away, as if pressed.
  const rotateX = useTransform(y, [0, 1], [MAX_TILT, -MAX_TILT]);
  const rotateY = useTransform(x, [0, 1], [-MAX_TILT, MAX_TILT]);
  const transform = useMotionTemplate`perspective(800px) rotateX(${rotateX}deg) rotateY(${rotateY}deg)`;

  // The light sits above the card, so the shadow slides away from the lifted edge.
  const shadowX = useTransform(x, [0, 1], [10, -10]);
  const shadowY = useTransform(y, [0, 1], [18, 6]);
  const shadow = useMotionTemplate`translate(${shadowX}px, ${shadowY}px)`;

  const px = usePercent(x);
  const py = usePercent(y);
  const edge = useMotionTemplate`radial-gradient(circle at ${px} ${py}, oklch(1 0 0 / 0.7), transparent 50%)`;
  const streakPosition = useMotionTemplate`${px} ${py}`;

  const reset = () => {
    pointerX.set(0.5);
    pointerY.set(0.5);
    setLit(false);
  };

  // Half-lit at rest, so the card still reads as glossy before it's touched.
  const light = cn(
    "pointer-events-none absolute inset-0 rounded-[inherit] opacity-50 transition-[opacity] duration-300 ease-out",
    lit && "opacity-100",
  );

  return (
    <div
      className="relative"
      onPointerMove={(e) => {
        // Touch would fight the page scroll, so tilting is for mouse and pen.
        if (reduceMotion || e.pointerType === "touch") return;
        const rect = e.currentTarget.getBoundingClientRect();
        pointerX.set((e.clientX - rect.left) / rect.width);
        pointerY.set((e.clientY - rect.top) / rect.height);
        setLit(true);
      }}
      onPointerLeave={reset}
    >
      <motion.div
        aria-hidden
        className="absolute inset-x-8 top-10 bottom-0 rounded-[20px] bg-black/40 blur-xl"
        style={{ transform: shadow }}
      />
      <motion.div
        className={cn("relative transform-3d", className)}
        style={{ transform }}
      >
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 rounded-[inherit] opacity-[0.14] mix-blend-overlay"
          style={{ backgroundImage: GRAIN }}
        />
        <motion.div
          aria-hidden
          className={cn(light, "mix-blend-plus-lighter")}
          style={{
            backgroundImage: STREAK,
            backgroundSize: STREAK_SIZE,
            backgroundPosition: streakPosition,
          }}
        />
        <motion.div
          aria-hidden
          className={cn(light, "p-px")}
          style={{ background: edge, mask: RING_MASK }}
        />
        {children}
      </motion.div>
    </div>
  );
}

function usePercent(value: MotionValue<number>) {
  return useTransform(value, (v) => `${v * 100}%`);
}

export default function TiltCardDemo() {
  return (
    <TiltCard className="aspect-[1.586] w-80 rounded-[20px] bg-[linear-gradient(145deg,#1d1d1f,#0b0b0c)] text-white shadow-[inset_0_0_0_1px_oklch(1_0_0/0.08)]">
      {/* Raised off the card's surface, so it drifts against it as it tilts. */}
      <div className="relative flex h-full translate-z-8 flex-col justify-between p-5">
        <div className="flex items-baseline justify-between text-sm">
          <span className="font-medium">ui lab</span>
          <span className="font-mono text-xs text-white/50 tabular-nums">
            004
          </span>
        </div>
        <div className="flex items-baseline justify-between">
          <span className="text-2xl font-medium tracking-tight">xevrion</span>
          <span className="font-mono text-xs text-white/50 tabular-nums">
            2026
          </span>
        </div>
      </div>
    </TiltCard>
  );
}
