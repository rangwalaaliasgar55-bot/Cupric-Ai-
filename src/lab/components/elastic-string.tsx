import { useEffect, useRef } from "react";
import { animate, motion, useMotionValue, useTransform } from "motion/react";
import { useReducedMotion } from "@/lib/use-reduced-motion";
import { cn } from "@/lib/cn";

type Tension = { name: string; stiffness: number; damping: number; weight: number };

const WIDTH = 480;
const HEIGHT = 260;
// Room at each end for the pegs.
const INSET = 28;
// The furthest a string's middle can be pulled from rest, in px. Kept under
// half the spacing between strings, so neighbours never cross.
const MAX_PULL = 40;
// Grab band around each string: 56px of target for a 2px line.
const BAND = 56;
// Keeps the bend's peak from sliding right up to a peg, where a quadratic
// would kink instead of curving.
const EDGE = 0.18;
// Space or Enter strikes the string with this speed (px/s): about what a
// quick 24px pull and release produces.
const STRIKE = 900;
// Eases the bend back to centre while it rings. A real string's fundamental
// is symmetric, so the lean toward the grab point fades away.
const RECENTER = { type: "spring", visualDuration: 0.5, bounce: 0 } as const;
// Reduced motion: settle without ringing.
const SETTLE = { type: "spring", visualDuration: 0.3, bounce: 0 } as const;

// Tighter strings ring faster and die sooner, like the high strings on a
// guitar. Damping ratio stays near 0.1, so each rings for about a second and a
// half: far longer than a UI transition, because the ring is the point.
const STRINGS: Tension[] = [
  { name: "High", stiffness: 1600, damping: 8, weight: 1.25 },
  { name: "Middle", stiffness: 1000, damping: 6.5, weight: 1.75 },
  { name: "Low", stiffness: 600, damping: 5, weight: 2.25 },
];

// Gives freely at first, then stiffens so it never passes MAX_PULL.
function resist(pull: number) {
  return MAX_PULL * Math.tanh(pull / (MAX_PULL * 1.6));
}

export function ElasticString({
  y,
  tension,
  label,
}: {
  y: number;
  tension: Tension;
  label: string;
}) {
  const reduce = useReducedMotion() ?? false;
  // Displacement of the bend's peak from rest, and where along the string
  // the bend leans (0 to 1). The path is rebuilt from both.
  const pull = useMotionValue(0);
  const lean = useMotionValue(0.5);
  const grab = useRef<{ id: number; y: number; from: number } | null>(null);

  const d = useTransform(() => {
    const length = WIDTH - INSET * 2;
    const cx = INSET + lean.get() * length;
    // A quadratic peaks at half its control point's offset.
    const cy = y + pull.get() * 2;
    return `M ${INSET} ${y} Q ${cx} ${cy} ${WIDTH - INSET} ${y}`;
  });

  useEffect(
    () => () => {
      pull.stop();
      lean.stop();
    },
    [pull, lean],
  );

  const ring = (velocity: number) => {
    if (reduce) {
      animate(pull, 0, SETTLE);
      animate(lean, 0.5, SETTLE);
      return;
    }
    // Hands the release speed to the spring, so a flick rings harder than
    // a slow let-go from the same height.
    animate(pull, 0, {
      type: "spring",
      stiffness: tension.stiffness,
      damping: tension.damping,
      velocity,
      restDelta: 0.05,
    });
    animate(lean, 0.5, RECENTER);
  };

  const along = (e: React.PointerEvent<SVGElement>) => {
    const box = e.currentTarget.ownerSVGElement!.getBoundingClientRect();
    const sx = WIDTH / box.width;
    const x = (e.clientX - box.left) * sx;
    const t = (x - INSET) / (WIDTH - INSET * 2);
    return { t: Math.min(Math.max(t, EDGE), 1 - EDGE), scale: HEIGHT / box.height };
  };

  return (
    <g
      role="button"
      tabIndex={0}
      aria-label={label}
      aria-roledescription="string"
      className="group cursor-grab touch-none outline-hidden active:cursor-grabbing"
      onPointerDown={(e) => {
        // A second finger would yank the string to a new spot.
        if (e.button !== 0 || grab.current) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        // Catches it mid-ring from wherever it visibly is.
        pull.stop();
        lean.stop();
        const { t, scale } = along(e);
        grab.current = { id: e.pointerId, y: e.clientY * scale, from: pull.get() };
        lean.set(t);
      }}
      onPointerMove={(e) => {
        const g = grab.current;
        if (!g || g.id !== e.pointerId) return;
        const { t, scale } = along(e);
        lean.set(t);
        // Respects where it was grabbed: the string keeps its offset from
        // the pointer rather than snapping its peak under it.
        pull.set(resist(g.from + e.clientY * scale - g.y));
      }}
      onPointerUp={(e) => {
        if (grab.current?.id !== e.pointerId) return;
        grab.current = null;
        ring(pull.getVelocity());
      }}
      onPointerCancel={(e) => {
        if (grab.current?.id !== e.pointerId) return;
        grab.current = null;
        ring(0);
      }}
      onKeyDown={(e) => {
        if (e.key !== " " && e.key !== "Enter") return;
        e.preventDefault();
        if (e.repeat) return;
        if (reduce) {
          // A small nudge that settles, so the press still shows.
          pull.jump(6);
          ring(0);
          return;
        }
        lean.jump(0.5);
        // Strikes from where it is, so repeated plucks add energy.
        ring(pull.getVelocity() - STRIKE);
      }}
    >
      {/* Transparent, but painted, so it takes the pointer across the band. */}
      <rect
        x={INSET}
        y={y - BAND / 2}
        width={WIDTH - INSET * 2}
        height={BAND}
        fill="transparent"
      />
      <rect
        x={INSET - 12}
        y={y - BAND / 2 + 4}
        width={WIDTH - INSET * 2 + 24}
        height={BAND - 8}
        rx={12}
        fill="none"
        strokeWidth={2}
        className="stroke-foreground opacity-0 group-focus-visible:opacity-100"
      />
      <motion.path
        d={d}
        fill="none"
        strokeWidth={tension.weight}
        strokeLinecap="round"
        className="stroke-muted transition-[stroke] duration-150 ease-out group-hover:stroke-foreground group-active:stroke-foreground group-focus-visible:stroke-foreground"
      />
      {[INSET, WIDTH - INSET].map((x) => (
        <circle key={x} cx={x} cy={y} r={3.5} className="fill-foreground" />
      ))}
    </g>
  );
}

export function ElasticStrings({
  strings = STRINGS,
  className,
}: {
  strings?: Tension[];
  className?: string;
}) {
  const gap = HEIGHT / (strings.length + 1);
  return (
    <svg
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      role="group"
      aria-label="Strings. Drag one and let go, or focus it and press Space."
      className={cn(
        "w-[min(480px,100%)] rounded-2xl bg-surface shadow-raised select-none",
        className,
      )}
    >
      {strings.map((tension, i) => (
        <ElasticString
          key={tension.name}
          y={gap * (i + 1)}
          tension={tension}
          label={`Pluck ${tension.name.toLowerCase()} string`}
        />
      ))}
    </svg>
  );
}

export default function ElasticStringDemo() {
  return <ElasticStrings />;
}
