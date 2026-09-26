import { useEffect, useRef, useState } from "react";
import {
  animate,
  motion,
  useMotionValue,
  useTransform,
  type AnimationPlaybackControls,
} from "motion/react";
import { useReducedMotion } from "@/lib/use-reduced-motion";
import { cn } from "@/lib/cn";

const ICON_SWAP = { type: "spring", duration: 0.3, bounce: 0 } as const;
// One connector fills in 240ms: long enough to read as travel from one step
// to the next, short enough to stay under the 300ms UI budget.
const LINE_MS = 240;
// A jump across several steps runs the connectors as a relay, each starting
// halfway through the previous one, so a full reset still ends in ~480ms.
const STAGGER_MS = 120;
// The step a line is heading for lights up just before the fill reaches it,
// so the circle reads as the line's destination rather than a separate event.
const ARRIVE_MS = 160;
// The "you are here" halo is one capsule that inches along the track: the
// head leaves with the line fill and lands as it does, the tail lets go this
// much later and catches up, so the halo stretches over the connector and
// then pulls itself in around the new step. Longer than the 300ms budget in
// total (up to ~600ms on a full reset) because it is the travel the fill
// already takes, with the tail's short lag on the end.
const TAIL_LAG = 0.12;
const INCH_EASE = [0.77, 0, 0.175, 1] as const;
// 36px circle plus a 4px halo on each side.
const HALO = 22;

type Status = "complete" | "current" | "upcoming";

export function ProgressStepper({
  steps,
  current,
  label = "Progress",
  className,
}: {
  steps: string[];
  current: number;
  label?: string;
  className?: string;
}) {
  const reduceMotion = useReducedMotion();
  // Remembers where the last move started, so delays run in the direction of
  // travel: forward fills left to right, back unfills right to left.
  const [move, setMove] = useState({ from: current, to: current });
  if (move.to !== current) setMove({ from: move.to, to: current });
  const { from } = move;
  const last = steps.length - 1;
  const n = steps.length;

  const olRef = useRef<HTMLOListElement>(null);
  const rtl = useRef(false);
  const head = useMotionValue(current);
  const tail = useMotionValue(current);
  const runs = useRef<AnimationPlaybackControls[]>([]);
  const prev = useRef(current);

  useEffect(() => {
    const start = prev.current;
    prev.current = current;
    if (start === current) return;
    if (olRef.current) rtl.current = getComputedStyle(olRef.current).direction === "rtl";
    runs.current.forEach((r) => r.stop());
    if (reduceMotion) {
      head.jump(current);
      tail.jump(current);
      return;
    }
    // Matches the relay: the last connector finishes filling at this point.
    const travel = ((Math.abs(current - start) - 1) * STAGGER_MS + LINE_MS) / 1000;
    runs.current = [
      animate(head, current, { duration: travel, ease: INCH_EASE }),
      animate(tail, current, { duration: travel, ease: INCH_EASE, delay: TAIL_LAG }),
    ];
  }, [current, reduceMotion, head, tail]);

  useEffect(() => () => runs.current.forEach((r) => r.stop()), []);

  // One strip the width of the list, clipped down to a capsule between the
  // centres of the two ends. clip-path keeps it off layout, and percentages
  // follow the grid's equal columns at any width.
  const clip = useTransform([head, tail], ([h, t]: number[]) => {
    const lo = ((Math.min(h, t) + 0.5) / n) * 100;
    const hi = ((Math.max(h, t) + 0.5) / n) * 100;
    const [l, r] = rtl.current ? [100 - hi, lo] : [lo, 100 - hi];
    return `inset(0 calc(${r}% - ${HALO}px) 0 calc(${l}% - ${HALO}px) round ${HALO}px)`;
  });

  const lineDelay = (k: number) => {
    if (reduceMotion) return 0;
    if (current > from && k >= from && k < current) return (k - from) * STAGGER_MS;
    if (current < from && k >= current && k < from)
      return (from - 1 - k) * STAGGER_MS;
    return 0;
  };

  const stepDelay = (j: number) => {
    if (reduceMotion) return 0;
    if (current > from && j > from && j <= current)
      return (j - 1 - from) * STAGGER_MS + ARRIVE_MS;
    if (current < from && j >= current && j < from)
      return (from - 1 - j) * STAGGER_MS + ARRIVE_MS;
    return 0;
  };

  const statusOf = (j: number): Status =>
    j < current ? "complete" : j === current ? "current" : "upcoming";

  return (
    <div className={cn("w-[min(520px,100%)]", className)}>
      <ol
        ref={olRef}
        aria-label={label}
        className="relative grid"
        style={{ gridTemplateColumns: `repeat(${steps.length}, minmax(0, 1fr))` }}
      >
        <motion.span
          aria-hidden
          style={{ clipPath: clip }}
          // Sits under the circles and the connector, so at rest only a 4px
          // ring shows and in flight the line runs through it like a tube.
          className="pointer-events-none absolute inset-x-0 -top-1 h-11 bg-foreground/10"
        />
        {steps.map((step, j) => {
          const status = statusOf(j);
          // The last step is a destination, not a task: reaching it completes it.
          const checked =
            status === "complete" || (status === "current" && j === last);
          const delay = stepDelay(j);
          return (
            <li
              key={step}
              aria-current={status === "current" ? "step" : undefined}
              className="relative flex flex-col items-center gap-2.5"
            >
              {j < last && (
                // Starts 8px clear of each 36px circle: 18px radius + 8px gap.
                <span
                  aria-hidden
                  className="absolute top-[17px] right-[calc(-50%+26px)] left-[calc(50%+26px)] h-0.5 overflow-hidden rounded-full bg-border"
                >
                  <span
                    className={cn(
                      "absolute inset-0 origin-left rounded-full bg-foreground transition-[scale] ease-[cubic-bezier(0.77,0,0.175,1)] motion-reduce:transition-none rtl:origin-right",
                      j < current ? "scale-x-100" : "scale-x-0",
                    )}
                    style={{
                      transitionDuration: `${LINE_MS}ms`,
                      transitionDelay: `${lineDelay(j)}ms`,
                    }}
                  />
                </span>
              )}
              <span
                aria-hidden
                className={cn(
                  "relative grid size-9 place-items-center rounded-full text-sm font-medium tabular-nums inset-ring transition-[background-color,color,box-shadow] duration-200 ease-[cubic-bezier(0.23,1,0.32,1)]",
                  checked
                    ? "bg-foreground text-background inset-ring-foreground"
                    : status === "current"
                      ? "bg-background text-foreground inset-ring-foreground"
                      : "bg-background text-muted inset-ring-border",
                )}
                style={{ transitionDelay: `${delay}ms` }}
              >
                <Swap visible={!checked} delay={delay} reduceMotion={reduceMotion}>
                  {j + 1}
                </Swap>
                <Swap visible={checked} delay={delay} reduceMotion={reduceMotion}>
                  <svg
                    viewBox="0 0 16 16"
                    className="size-4"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={2}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="m3.5 8.5 3 3 6-7" />
                  </svg>
                </Swap>
              </span>
              <span
                className={cn(
                  "text-center text-sm transition-[color] duration-200 ease-out",
                  status === "upcoming" ? "text-muted" : "text-foreground",
                )}
                style={{ transitionDelay: `${delay}ms` }}
              >
                {step}
                <span className="sr-only">
                  {checked ? ", completed" : status === "upcoming" ? ", not started" : ""}
                </span>
              </span>
            </li>
          );
        })}
      </ol>
      <span className="sr-only" aria-live="polite">
        {current !== from
          ? `Step ${current + 1} of ${steps.length}: ${steps[current]}`
          : ""}
      </span>
    </div>
  );
}

function Swap({
  visible,
  delay,
  reduceMotion,
  children,
}: {
  visible: boolean;
  delay: number;
  reduceMotion: boolean | null;
  children: React.ReactNode;
}) {
  // Reduced motion keeps the cross-fade but drops the scale and blur.
  const hidden = reduceMotion
    ? { opacity: 0 }
    : { scale: 0.25, opacity: 0, filter: "blur(4px)" };
  return (
    <motion.span
      className="col-start-1 row-start-1 grid place-items-center"
      initial={false}
      animate={visible ? { scale: 1, opacity: 1, filter: "blur(0px)" } : hidden}
      // Both glyphs wait with the circle's fill, so a circle is never left
      // blank while its color is still catching up.
      transition={{ ...ICON_SWAP, delay: delay / 1000 }}
    >
      {children}
    </motion.span>
  );
}

const button =
  "h-10 touch-manipulation rounded-full px-4 text-sm font-medium outline-hidden transition-[scale,opacity] duration-150 ease-out select-none focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-foreground active:scale-[0.96] motion-reduce:transition-[opacity]";

export default function ProgressStepperDemo() {
  const steps = ["Cart", "Shipping", "Payment", "Done"];
  const [current, setCurrent] = useState(0);
  const last = steps.length - 1;
  const atStart = current === 0;
  const atEnd = current === last;

  return (
    <div className="flex w-[min(520px,100%)] flex-col gap-10">
      <ProgressStepper steps={steps} current={current} label="Checkout progress" />
      <div className="flex items-center justify-between">
        {/* aria-disabled rather than disabled, so a keyboard user who backs up
            to the start keeps focus on the button instead of losing it. */}
        <button
          type="button"
          aria-disabled={atStart}
          onClick={() => !atStart && setCurrent((c) => c - 1)}
          className={cn(
            button,
            "bg-surface text-foreground shadow-raised",
            atStart && "cursor-not-allowed opacity-50 active:scale-100",
          )}
        >
          Back
        </button>
        <button
          type="button"
          onClick={() => setCurrent((c) => (c === last ? 0 : c + 1))}
          className={cn(button, "bg-foreground text-background")}
        >
          {/* Both labels share one cell, so the button keeps one width and
              never shifts under the cursor when it turns into Start over. */}
          <span className="grid">
            <Label visible={!atEnd}>Continue</Label>
            <Label visible={atEnd}>Start over</Label>
          </span>
        </button>
      </div>
    </div>
  );
}

function Label({ visible, children }: { visible: boolean; children: React.ReactNode }) {
  return (
    <span
      aria-hidden={!visible}
      className={cn(
        "col-start-1 row-start-1 transition-[opacity,filter] duration-200 ease-out",
        !visible && "opacity-0 blur-[4px]",
      )}
    >
      {children}
    </span>
  );
}
