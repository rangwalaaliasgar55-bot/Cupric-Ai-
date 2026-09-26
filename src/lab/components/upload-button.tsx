import { useCallback, useEffect, useRef, useState } from "react";
import { motion, useMotionValueEvent, useSpring, useTransform } from "motion/react";
import { useReducedMotion } from "@/lib/use-reduced-motion";
import { cn } from "@/lib/cn";

export type UploadStatus = "idle" | "uploading" | "done";

// The circle the pill collapses into, matching the pill's h-10.
const SIZE = 40;
// Sits 1px inside the edge so the 2px stroke never touches the shadow ring.
const RADIUS = 18;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
// No bounce: a width that overshoots would read as the button wobbling.
const MORPH = { type: "spring", duration: 0.3, bounce: 0 } as const;
// Progress events arrive every few hundred ms; this glides between them
// without trailing so far behind that the ring feels dishonest.
const FILL = { visualDuration: 0.4, bounce: 0 };
const ICON_SWAP = { type: "spring", duration: 0.3, bounce: 0 } as const;
// Close enough to full that the check never waits on the spring's tail.
const FULL = 0.995;

export function UploadButton({
  status,
  progress,
  onStart,
  onCancel,
  onReset,
  label = "Upload",
  // Long enough to register the check, short enough to be ready again.
  resetAfter = 1500,
  className,
}: {
  status: UploadStatus;
  /** 0 to 1. Only read while uploading. */
  progress: number;
  onStart: () => void;
  onCancel: () => void;
  /** Called `resetAfter` ms after the check appears; set status back to idle. */
  onReset: () => void;
  label?: string;
  resetAfter?: number;
  className?: string;
}) {
  const reduceMotion = useReducedMotion();
  const shown = useSpring(0, FILL);
  const [ringFull, setRingFull] = useState(false);
  const [note, setNote] = useState("");
  const prevStatus = useRef<UploadStatus>(status);

  useEffect(() => {
    const wasActive = prevStatus.current !== "idle";
    prevStatus.current = status;
    // Idle keeps the last value so a cancelled ring fades out where it was.
    if (status === "idle") return;
    // A fresh upload starts empty rather than sweeping back from 100%.
    if (!wasActive) shown.jump(0);
    const target = status === "done" ? 1 : Math.min(Math.max(progress, 0), 1);
    if (reduceMotion) shown.jump(target);
    else shown.set(target);
  }, [status, progress, reduceMotion, shown]);

  useMotionValueEvent(shown, "change", (v) => setRingFull(v >= FULL));

  // The check waits for the ring to visibly close, not just for the status.
  const checked = status === "done" && ringFull;

  useEffect(() => {
    if (!checked) return;
    const timer = setTimeout(onReset, resetAfter);
    return () => clearTimeout(timer);
  }, [checked, onReset, resetAfter]);

  const dashOffset = useTransform(shown, (v) => CIRCUMFERENCE * (1 - v));
  // A round cap at 0% would draw a lone dot at 12 o'clock.
  const arcOpacity = useTransform(shown, [0, 0.02], [0, 1]);
  const percent = useTransform(shown, (v) => Math.round(v * 100));

  const compact = status !== "idle";
  const uploading = status === "uploading";
  const ringVisible = uploading || (status === "done" && !checked);

  const click = () => {
    if (status === "uploading") {
      setNote("Upload cancelled");
      onCancel();
    } else if (status === "idle") {
      setNote("");
      onStart();
    }
  };

  const name =
    status === "uploading"
      ? "Cancel upload"
      : status === "done"
        ? "Upload complete"
        : label;

  return (
    // Press scale lives here (:active also matches ancestors) so the ring,
    // which sits outside the button for ARIA reasons, shrinks with it.
    <span
      className={cn(
        "relative inline-flex transition-[scale] duration-150 ease-out active:scale-[0.96] motion-reduce:transition-none",
        className,
      )}
    >
      <motion.button
        type="button"
        aria-label={name}
        aria-busy={uploading}
        aria-disabled={status === "done" || undefined}
        onClick={click}
        initial={false}
        // Width, not scale, so nothing inside ever stretches; each state's
        // content is its own layer that fades instead.
        animate={{ width: compact ? SIZE : "auto" }}
        transition={reduceMotion ? { duration: 0 } : MORPH}
        className={cn(
          "group relative inline-flex h-10 touch-manipulation items-center justify-center overflow-hidden rounded-full text-sm font-medium shadow-raised outline-hidden select-none",
          "transition-[background-color,color] duration-200 ease-out",
          "focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-foreground",
          checked ? "bg-foreground text-background" : "bg-surface text-foreground",
          status === "done" && "cursor-default",
        )}
      >
        {/* One grid cell: the pill layer sets the auto width, the others
            center on top of it and overflow evenly when compact. */}
        <span className="grid" aria-hidden>
          <Layer
            visible={status === "idle"}
            // Waits for the pill to open most of the way before the label
            // resolves, so text never shows up clipped by a narrow pill.
            enterDelay
            // Icon side gets 2px less: the glyph's own whitespace fills it.
            className="gap-2 pr-4 pl-3.5 whitespace-nowrap"
          >
            <svg
              viewBox="0 0 16 16"
              className="size-4 shrink-0"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.5}
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M8 10.25v-7.5M4.75 6 8 2.75 11.25 6M2.75 10.5v1.25c0 .83.67 1.5 1.5 1.5h7.5c.83 0 1.5-.67 1.5-1.5V10.5" />
            </svg>
            {label}
          </Layer>

          {/* Percent by default; hover or keyboard focus swaps it for a stop
              mark so the cancel action is discoverable. */}
          <Layer
            // Holds through the ring's last stretch so it reads 100 before
            // the check replaces it.
            visible={ringVisible}
            className={cn(
              "text-[11px] tabular-nums",
              uploading &&
                "group-hover:opacity-0 group-hover:blur-[4px] group-focus-visible:opacity-0 group-focus-visible:blur-[4px]",
            )}
          >
            <motion.span>{percent}</motion.span>
          </Layer>
          <Layer
            visible={false}
            className={cn(
              uploading &&
                "group-hover:translate-y-0 group-hover:opacity-100 group-hover:blur-[0px] group-focus-visible:translate-y-0 group-focus-visible:opacity-100 group-focus-visible:blur-[0px]",
            )}
          >
            <svg viewBox="0 0 16 16" className="size-3" fill="currentColor">
              <rect x="3" y="3" width="10" height="10" rx="2" />
            </svg>
          </Layer>

          <span className="col-start-1 row-start-1 flex items-center justify-center">
            <motion.svg
              viewBox="0 0 16 16"
              className="size-4"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
              initial={false}
              animate={
                checked
                  ? { scale: 1, opacity: 1, filter: "blur(0px)" }
                  : reduceMotion
                    ? { scale: 1, opacity: 0, filter: "blur(0px)" }
                    : { scale: 0.25, opacity: 0, filter: "blur(4px)" }
              }
              transition={ICON_SWAP}
            >
              <path d="m3.5 8.5 3 3 6-7" />
            </motion.svg>
          </span>
        </span>
      </motion.button>

      {/* Outside the button: a button's children are presentational, so a
          progressbar nested inside would never reach assistive tech. */}
      <span
        role="progressbar"
        aria-label="Upload progress"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={uploading ? Math.round(progress * 100) : undefined}
        aria-hidden={!uploading}
        className={cn(
          "pointer-events-none absolute top-0 left-1/2 size-10 -translate-x-1/2 transition-[opacity] ease-out",
          ringVisible ? "opacity-100 duration-150" : "opacity-0 duration-200",
        )}
      >
        {/* -90deg moves the stroke's start from 3 o'clock to 12. */}
        <svg
          viewBox={`0 0 ${SIZE} ${SIZE}`}
          className="size-full -rotate-90"
          fill="none"
          strokeWidth={2}
        >
          <circle
            cx={SIZE / 2}
            cy={SIZE / 2}
            r={RADIUS}
            className="stroke-foreground/10"
          />
          <motion.circle
            cx={SIZE / 2}
            cy={SIZE / 2}
            r={RADIUS}
            className="stroke-foreground"
            strokeLinecap="round"
            strokeDasharray={CIRCUMFERENCE}
            style={{ strokeDashoffset: dashOffset, opacity: arcOpacity }}
          />
        </svg>
      </span>

      <span className="sr-only" aria-live="polite">
        {uploading ? "Uploading" : status === "done" ? "Upload complete" : note}
      </span>
    </span>
  );
}

// Enters over 200ms, leaves in 100ms: the outgoing state should be gone
// before the width morph gets far enough to clip it.
function Layer({
  visible,
  enterDelay,
  className,
  children,
}: {
  visible: boolean;
  enterDelay?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <span
      className={cn(
        "col-start-1 row-start-1 flex items-center justify-center transition-[opacity,filter,translate] ease-[cubic-bezier(0.23,1,0.32,1)] motion-reduce:transition-[opacity]",
        visible
          ? cn(
              "translate-y-0 opacity-100 blur-[0px] duration-200",
              enterDelay && "delay-100",
            )
          : "translate-y-0.5 opacity-0 blur-[4px] duration-100 motion-reduce:translate-y-0 motion-reduce:blur-[0px]",
        className,
      )}
    >
      {children}
    </span>
  );
}

// Fast start, a stall near the middle, then a quick finish: roughly how a
// real upload looks. [ms from start, progress]
const STEPS: [number, number][] = [
  [120, 0.12],
  [260, 0.27],
  [420, 0.41],
  [580, 0.5],
  [1200, 0.54],
  [1500, 0.61],
  [1720, 0.74],
  [1900, 0.83],
  [2120, 0.92],
  [2450, 1],
];

export default function UploadButtonDemo() {
  const [status, setStatus] = useState<UploadStatus>("idle");
  const [progress, setProgress] = useState(0);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  const clear = () => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
  };

  useEffect(() => clear, []);

  const start = () => {
    clear();
    setProgress(0);
    setStatus("uploading");
    for (const [at, value] of STEPS) {
      // Up to 80ms of jitter (less than any gap between steps, so order
      // holds) keeps repeat runs from feeling canned.
      const jitter = value === 1 ? 0 : Math.random() * 80;
      timers.current.push(
        setTimeout(() => {
          setProgress(value);
          if (value === 1) setStatus("done");
        }, at + jitter),
      );
    }
  };

  const cancel = () => {
    clear();
    setStatus("idle");
  };

  const reset = useCallback(() => setStatus("idle"), []);

  return (
    <UploadButton
      status={status}
      progress={progress}
      onStart={start}
      onCancel={cancel}
      onReset={reset}
    />
  );
}
