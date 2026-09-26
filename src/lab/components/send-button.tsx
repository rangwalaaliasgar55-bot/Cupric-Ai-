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

type Status = "idle" | "sending" | "sent";

// 450ms, past the usual 300ms cap on purpose: the flight is the confirmation
// itself and has to travel ~100px along a curve. Anything shorter reads as
// the plane vanishing rather than leaving.
const FLIGHT = 0.45;
// Dips just below 0 before it goes, so the plane crouches back ~3px first
// (anticipation), then accelerates out: an exit, so it ends fast.
const FLIGHT_EASE = [0.45, -0.25, 0.8, 0.4] as const;
// "Sent" arrives while the plane is still fading out up top, so the button
// never sits empty; the overlap is what makes the hand-off read as one move.
const SENT_AT = 300;
// Long enough to read "Sent", short enough to be ready for the next message.
const RESET_AFTER = 1600;
const SWAP = { type: "spring", duration: 0.3, bounce: 0 } as const;

// Quadratic curve in px, relative to where the plane rests. The first control
// point sits level with the start so the path leaves horizontally and the
// plane never snaps its nose on the first frame.
const P1 = { x: 36, y: 0 };
const P2 = { x: 84, y: -52 };
const along = (t: number) => ({
  x: 2 * (1 - t) * t * P1.x + t * t * P2.x,
  y: 2 * (1 - t) * t * P1.y + t * t * P2.y,
});
// The curve's tangent, so the nose always points where it is heading.
const heading = (t: number) =>
  (Math.atan2(
    2 * (1 - t) * P1.y + 2 * t * (P2.y - P1.y),
    2 * (1 - t) * P1.x + 2 * t * (P2.x - P1.x),
  ) *
    180) /
  Math.PI;

export function SendButton({
  onSend,
  label = "Send",
  sentLabel = "Sent",
  variant = "solid",
  iconOnly = false,
  className,
}: {
  onSend?: () => void;
  label?: string;
  sentLabel?: string;
  variant?: "solid" | "subtle";
  iconOnly?: boolean;
  className?: string;
}) {
  const reduceMotion = useReducedMotion();
  const [status, setStatus] = useState<Status>("idle");
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const flight = useRef<AnimationPlaybackControls>(undefined);

  const t = useMotionValue(0);
  const x = useTransform(t, (v) => along(v).x);
  const y = useTransform(t, (v) => along(v).y);
  const rotate = useTransform(t, heading);
  // Shrinks a little as it gets further away, and fades over the last 45%.
  const scale = useTransform(t, [0, 1], [1, 0.75]);
  const opacity = useTransform(t, [0.55, 1], [1, 0]);

  useEffect(
    () => () => {
      timers.current.forEach(clearTimeout);
      flight.current?.stop();
    },
    [],
  );

  const send = () => {
    // Ignore repeat clicks until the button is back to Send.
    if (status !== "idle") return;
    onSend?.();
    setStatus("sending");
    if (!reduceMotion) {
      flight.current = animate(t, 1, { duration: FLIGHT, ease: FLIGHT_EASE });
    }
    timers.current = [
      setTimeout(() => setStatus("sent"), reduceMotion ? 0 : SENT_AT),
      setTimeout(() => {
        // Home again, hidden; the plane then grows back in place.
        t.jump(0);
        setStatus("idle");
      }, RESET_AFTER),
    ];
  };

  const planeHome = status !== "sent";

  return (
    <>
      <button
        type="button"
        // A fixed name; the live region below reports "Sent".
        aria-label={label}
        aria-disabled={status !== "idle" || undefined}
        onClick={send}
        className={cn(
          "inline-flex h-11 touch-manipulation items-center justify-center gap-2 rounded-full text-[15px] font-medium outline-hidden select-none",
          "transition-[scale,background-color,opacity] duration-150 ease-out active:scale-[0.96] motion-reduce:transition-[background-color,opacity]",
          "focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-foreground",
          variant === "solid"
            ? "bg-foreground text-background hover:bg-foreground/90"
            : "bg-surface text-foreground shadow-raised hover:bg-background",
          // 4px less on the icon side: the plane's tail is mostly air.
          iconOnly ? "w-11" : "pr-5 pl-4",
          status !== "idle" && "cursor-default",
          className,
        )}
      >
        {/* The plane's mass sits left of its box center, so it gets a 1px
            nudge right to look centered on its own. */}
        <span aria-hidden className={cn("grid", iconOnly && "translate-x-px")}>
          <motion.span
            className="col-start-1 row-start-1 flex"
            initial={false}
            animate={
              planeHome
                ? { scale: 1, opacity: 1, filter: "blur(0px)" }
                : reduceMotion
                  ? { scale: 1, opacity: 0, filter: "blur(0px)" }
                  : { scale: 0.25, opacity: 0, filter: "blur(4px)" }
            }
            // Leaving: wait out the flight's last 150ms, then drop out
            // invisibly (the plane has already faded) so it can regrow here.
            transition={
              planeHome
                ? SWAP
                : reduceMotion
                  ? { duration: 0.15 }
                  : { duration: 0, delay: FLIGHT - SENT_AT / 1000 }
            }
          >
            <motion.svg
              viewBox="0 0 24 24"
              className="size-5"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.75}
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{ x, y, rotate, scale, opacity }}
            >
              <path d="M3.75 4.25 20.25 12 3.75 19.75 6.5 12Z" />
              <path d="M6.5 12h5.25" />
            </motion.svg>
          </motion.span>
          <motion.svg
            viewBox="0 0 24 24"
            className="col-start-1 row-start-1 size-5"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            initial={false}
            // Slides in rightward, the way the plane left, so the check reads
            // as the same motion finishing rather than a new thing popping in.
            animate={
              !planeHome
                ? { x: 0, opacity: 1, filter: "blur(0px)" }
                : reduceMotion
                  ? { x: 0, opacity: 0, filter: "blur(0px)" }
                  : { x: -8, opacity: 0, filter: "blur(4px)" }
            }
            transition={
              !planeHome ? SWAP : { duration: 0.12, ease: [0.23, 1, 0.32, 1] }
            }
          >
            <path d="m5 12.5 4.5 4.5L19 7" />
          </motion.svg>
        </span>

        {!iconOnly && (
          // Shared cell: the button keeps the longer word's width.
          <span aria-hidden className="grid">
            <Word visible={status === "idle"}>{label}</Word>
            <Word visible={status === "sent"}>{sentLabel}</Word>
          </span>
        )}
      </button>
      <span className="sr-only" aria-live="polite">
        {status === "sent" ? sentLabel : ""}
      </span>
    </>
  );
}

// Enters over 200ms, leaves in 100ms, so "Send" is gone the moment the plane
// moves and never overlaps "Sent".
function Word({
  visible,
  children,
}: {
  visible: boolean;
  children: React.ReactNode;
}) {
  return (
    <span
      className={cn(
        "col-start-1 row-start-1 transition-[opacity,filter,translate] ease-[cubic-bezier(0.23,1,0.32,1)] motion-reduce:transition-[opacity]",
        visible
          ? "translate-x-0 opacity-100 blur-[0px] duration-200"
          : "-translate-x-1 opacity-0 blur-[4px] duration-100 motion-reduce:translate-x-0 motion-reduce:blur-[0px]",
      )}
    >
      {children}
    </span>
  );
}

export default function SendButtonDemo() {
  return (
    // Headroom above and to the right: the plane flies ~84px right and
    // ~52px up, and should stay inside the stage while it fades.
    <div className="flex w-[min(420px,100%)] flex-wrap items-center justify-center gap-4 pt-16 pr-12">
      <SendButton />
      <SendButton variant="subtle" />
      <SendButton variant="subtle" iconOnly />
    </div>
  );
}
