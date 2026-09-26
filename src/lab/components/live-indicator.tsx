import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { useReducedMotion } from "@/lib/use-reduced-motion";
import { cn } from "@/lib/cn";
import { usePreviewPlay } from "@/lab/preview-play";

const EASE_OUT = [0.23, 1, 0.32, 1] as const;

// Loops are keyframes by nature (nothing interrupts them), and CSS keeps
// them off the main thread. Slow on purpose: a live dot should breathe,
// not flash. The reconnect blink is a hard-ish pulse so it reads as trying.
const KEYFRAMES = `
@keyframes live-indicator-breathe {
  0%, 100% { opacity: 1; scale: 1; }
  50% { opacity: 0.7; scale: 0.88; }
}
@keyframes live-indicator-sonar {
  0% { opacity: 0.45; scale: 1; }
  70%, 100% { opacity: 0; scale: 2.6; }
}
@keyframes live-indicator-blink {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.25; }
}
`;

// Locale independent, so the server and the browser print the same thing.
function group(n: number) {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

// Real audiences drift: mostly small steps, a slight lean toward growth,
// and now and then a bigger jump when a link gets shared.
function nextCount(n: number) {
  const r = Math.random();
  const size =
    r < 0.08
      ? 8 + Math.floor(Math.random() * 12)
      : 1 + Math.floor(Math.random() * 4);
  const sign = Math.random() < 0.56 ? 1 : -1;
  return Math.max(1, n + sign * size);
}

/** Viewer count that wanders like a real stream's, paused while offscreen. */
export function useViewerCount(start: number, paused: boolean) {
  const [count, setCount] = useState(start);
  const [visible, setVisible] = useState(true);
  const node = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const el = node.current;
    // A paused count has nothing to wake up for, so it doesn't watch.
    if (paused || !el) return;
    const observer = new IntersectionObserver(([entry]) =>
      setVisible(entry.isIntersecting),
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [paused]);

  useEffect(() => {
    if (paused || !visible) return;
    let timer: ReturnType<typeof setTimeout>;
    // Irregular gaps: a count ticking on a metronome looks fake.
    const tick = () => {
      timer = setTimeout(
        () => {
          if (document.visibilityState === "visible") setCount(nextCount);
          tick();
        },
        900 + Math.random() * 1800,
      );
    };
    tick();
    return () => clearTimeout(timer);
  }, [paused, visible]);

  return [count, node] as const;
}

export function LiveIndicator({
  viewers,
  reconnecting = false,
  label = "Live",
  className,
  ref,
}: {
  viewers: number;
  reconnecting?: boolean;
  label?: string;
  className?: string;
  ref?: React.Ref<HTMLSpanElement>;
}) {
  const reduceMotion = useReducedMotion();
  const [prev, setPrev] = useState(viewers);
  const [direction, setDirection] = useState(1);
  if (prev !== viewers) {
    setDirection(viewers > prev ? 1 : -1);
    setPrev(viewers);
  }
  const custom = { direction, reduceMotion };
  const chars = group(viewers).split("");
  const status = reconnecting ? "Reconnecting" : label;

  return (
    <span
      ref={ref}
      className={cn(
        "relative inline-flex h-7 items-center gap-2 rounded-full bg-surface pr-3 pl-2.5 text-[13px] font-medium text-foreground shadow-raised select-none",
        className,
      )}
    >
      <style>{KEYFRAMES}</style>
      {/* The accessible text never includes the ticking number, so screen
          readers hear the state, not a stream of digits. */}
      <span className="sr-only">
        {reconnecting
          ? "Reconnecting"
          : `${label}, about ${group(viewers)} watching`}
      </span>

      <span aria-hidden className="relative grid size-2 place-items-center">
        {/* Sonar: one soft ring every 2.4s, only while actually live. */}
        {!reconnecting && !reduceMotion && (
          <span className="absolute inset-0 rounded-full bg-danger [animation:live-indicator-sonar_2.4s_cubic-bezier(0.23,1,0.32,1)_infinite]" />
        )}
        <span
          className={cn(
            "relative size-2 rounded-full border-[1.5px] transition-[background-color,border-color] duration-200 ease-out",
            reconnecting
              ? "border-muted bg-transparent motion-safe:[animation:live-indicator-blink_1s_ease-in-out_infinite]"
              : "border-danger bg-danger motion-safe:[animation:live-indicator-breathe_2.4s_ease-in-out_infinite]",
          )}
        />
      </span>

      <span aria-hidden className="grid">
        <AnimatePresence initial={false} mode="popLayout">
          <motion.span
            key={status}
            className="col-start-1 row-start-1 whitespace-nowrap"
            initial={{
              opacity: 0,
              filter: reduceMotion ? "blur(0px)" : "blur(4px)",
            }}
            animate={{
              opacity: 1,
              filter: "blur(0px)",
              transition: { duration: 0.22, ease: EASE_OUT },
            }}
            exit={{
              opacity: 0,
              filter: reduceMotion ? "blur(0px)" : "blur(4px)",
              transition: { duration: 0.12, ease: EASE_OUT },
            }}
          >
            {status}
          </motion.span>
        </AnimatePresence>
      </span>

      <span aria-hidden className="h-3 w-px bg-border" />

      <span
        aria-hidden
        className={cn(
          "flex items-center gap-1 text-muted tabular-nums transition-opacity duration-200 ease-out",
          // A frozen count is stale, so it steps back while reconnecting.
          reconnecting && "opacity-50",
        )}
      >
        <svg
          viewBox="0 0 16 16"
          className="size-3.5"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.4}
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M1.5 8S4 3.5 8 3.5 14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8Z" />
          <circle cx="8" cy="8" r="2" />
        </svg>
        <span className="flex">
          {chars.map((char, i) => (
            // Keyed by place from the right, so only the digits that
            // change roll.
            <span
              key={chars.length - i}
              className="inline-grid overflow-hidden"
            >
              <AnimatePresence initial={false} custom={custom}>
                <motion.span
                  key={char}
                  custom={custom}
                  variants={ROLL}
                  initial="enter"
                  animate="center"
                  exit="exit"
                  className="col-start-1 row-start-1"
                >
                  {char}
                </motion.span>
              </AnimatePresence>
            </span>
          ))}
        </span>
      </span>
    </span>
  );
}

type Roll = { direction: number; reduceMotion: boolean | null };

// Slower than a click's roll: nobody caused this change, so it should
// drift past rather than snap.
const ROLL = {
  enter: ({ direction, reduceMotion }: Roll) => ({
    y: reduceMotion ? "0%" : `${direction * 100}%`,
    opacity: 0,
  }),
  center: {
    y: "0%",
    opacity: 1,
    transition: { duration: 0.3, ease: EASE_OUT },
  },
  exit: ({ direction, reduceMotion }: Roll) => ({
    y: reduceMotion ? "0%" : `${direction * -100}%`,
    opacity: 0,
    transition: { duration: 0.22, ease: EASE_OUT },
  }),
};

// The index card's hover show: the count drifts for a moment, the stream
// drops, tries to reconnect, and comes back. Waits in ms.
const SHOW_DROP = 3200;
const SHOW_RESTORE = 2200;

export default function LiveIndicatorDemo() {
  const [reconnecting, setReconnecting] = useState(false);
  const play = usePreviewPlay();
  // A resting index card keeps its CSS breath (off the main thread) but
  // stops the count's JS timer until someone hovers.
  const still = play === false;
  const [viewers, ref] = useViewerCount(1284, reconnecting || still);

  useEffect(() => {
    if (play !== true) return;
    let timer: ReturnType<typeof setTimeout>;
    const cycle = () => {
      timer = setTimeout(() => {
        setReconnecting(true);
        timer = setTimeout(() => {
          setReconnecting(false);
          cycle();
        }, SHOW_RESTORE);
      }, SHOW_DROP);
    };
    cycle();
    return () => {
      clearTimeout(timer);
      setReconnecting(false);
    };
  }, [play]);

  return (
    <div className="relative flex flex-col items-center gap-5">
      <LiveIndicator ref={ref} viewers={viewers} reconnecting={reconnecting} />
      <span aria-live="polite" className="sr-only">
        {reconnecting ? "Connection lost, reconnecting" : ""}
      </span>
      <button
        type="button"
        aria-pressed={reconnecting}
        onClick={() => setReconnecting((r) => !r)}
        className="h-8 touch-manipulation rounded-full px-3 text-[13px] text-muted outline-hidden transition-[scale,color,background-color] duration-150 ease-out select-none hover:bg-surface hover:text-foreground focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-foreground active:scale-[0.96] motion-reduce:transition-[color,background-color]"
      >
        {/* Both labels share a cell so the button never changes width. */}
        <span className="grid">
          <span
            className={cn(
              "col-start-1 row-start-1",
              reconnecting && "invisible",
            )}
          >
            Drop connection
          </span>
          <span
            className={cn(
              "col-start-1 row-start-1",
              !reconnecting && "invisible",
            )}
          >
            Restore connection
          </span>
        </span>
      </button>
    </div>
  );
}
