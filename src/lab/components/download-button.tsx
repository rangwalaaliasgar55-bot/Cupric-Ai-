import { useCallback, useEffect, useRef, useState } from "react";
import {
  animate,
  motion,
  useMotionTemplate,
  useMotionValue,
  useMotionValueEvent,
  useTransform,
  type AnimationPlaybackControls,
  type MotionValue,
} from "motion/react";
import { useReducedMotion } from "@/lib/use-reduced-motion";
import { cn } from "@/lib/cn";

export type DownloadStatus = "idle" | "downloading" | "done";

// Progress events land every few hundred ms; this glides between them
// without trailing so far behind that the fill feels dishonest.
const FILL = { type: "spring", visualDuration: 0.4, bounce: 0 } as const;
const EASE_OUT = [0.23, 1, 0.32, 1] as const;
// Cancelling drains the fill back out, fast: the system is responding.
const DRAIN = { duration: 0.2, ease: EASE_OUT } as const;
const ICON_SWAP = { type: "spring", duration: 0.3, bounce: 0 } as const;
// The icon's small sideways glide as the word beside it changes length.
const SHIFT = { type: "spring", duration: 0.3, bounce: 0 } as const;
// Close enough to full that the check never waits on the spring's tail.
const FULL = 0.995;

export function DownloadButton({
  status,
  progress,
  onStart,
  onCancel,
  onReset,
  label = "Download",
  doneLabel = "Done",
  // Long enough to register the check, short enough to be ready again.
  resetAfter = 1800,
  className,
}: {
  status: DownloadStatus;
  /** 0 to 1. Only read while downloading. */
  progress: number;
  onStart: () => void;
  onCancel: () => void;
  /** Called `resetAfter` ms after the check appears; set status to idle. */
  onReset: () => void;
  label?: string;
  doneLabel?: string;
  resetAfter?: number;
  className?: string;
}) {
  const reduceMotion = useReducedMotion();
  const fill = useMotionValue(0);
  const cover = useMotionValue(1);
  const [full, setFull] = useState(false);
  const [note, setNote] = useState("");
  const prevStatus = useRef<DownloadStatus>(status);
  const run = useRef<AnimationPlaybackControls>(undefined);
  const fade = useRef<AnimationPlaybackControls>(undefined);

  useEffect(() => {
    const prev = prevStatus.current;
    prevStatus.current = status;

    if (status === "idle") {
      if (prev === "downloading") {
        run.current?.stop();
        if (reduceMotion) fill.jump(0);
        else run.current = animate(fill, 0, DRAIN);
      } else if (prev === "done") {
        // A finished download fades back to plain rather than draining, so
        // it never looks like the file was taken back.
        fade.current = animate(cover, 0, {
          duration: reduceMotion ? 0 : 0.2,
          ease: EASE_OUT,
          onComplete: () => {
            fill.jump(0);
            cover.jump(1);
          },
        });
      }
      return;
    }

    if (prev === "idle") {
      // A fresh run starts empty, even if the last fade was still going.
      fade.current?.stop();
      run.current?.stop();
      cover.jump(1);
      fill.jump(0);
    }
    const target = status === "done" ? 1 : Math.min(Math.max(progress, 0), 1);
    if (reduceMotion) fill.jump(target);
    else run.current = animate(fill, target, FILL);
  }, [status, progress, reduceMotion, fill, cover]);

  useEffect(
    () => () => {
      run.current?.stop();
      fade.current?.stop();
    },
    [],
  );

  useMotionValueEvent(fill, "change", (v) => setFull(v >= FULL));

  // The check waits for the fill to visibly reach the end, not just the
  // status, so it never appears over a bar that is still moving.
  const checked = status === "done" && (full || !!reduceMotion);

  useEffect(() => {
    if (!checked) return;
    const timer = setTimeout(onReset, resetAfter);
    return () => clearTimeout(timer);
  }, [checked, onReset, resetAfter]);

  const uncovered = useTransform(fill, (v) => (1 - v) * 100);
  const clip = useMotionTemplate`inset(0 ${uncovered}% 0 0)`;
  const percent = useTransform(fill, (v) => `${Math.round(v * 100)}%`);

  const click = () => {
    if (status === "downloading") {
      setNote("Download cancelled");
      onCancel();
    } else if (status === "idle") {
      setNote("Downloading");
      onStart();
    }
  };

  const downloading = status === "downloading";
  const view: View = checked ? "done" : status === "idle" ? "idle" : "busy";

  return (
    <span className={cn("relative inline-flex", className)}>
      <button
        type="button"
        aria-label={downloading ? "Cancel download" : label}
        aria-disabled={status === "done" || undefined}
        onClick={click}
        className={cn(
          // Fixed width: every state fits inside, so nothing around it moves.
          "group relative isolate inline-flex h-11 w-[168px] max-w-full touch-manipulation items-center justify-center overflow-hidden rounded-full bg-surface text-[15px] font-medium text-foreground shadow-raised outline-hidden select-none",
          "transition-[scale] duration-150 ease-out active:scale-[0.96] motion-reduce:transition-none",
          "focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-foreground",
          status === "done" && "cursor-default",
        )}
      >
        <Content
          view={view}
          cancellable={downloading}
          label={label}
          doneLabel={doneLabel}
          percent={percent}
          reduceMotion={reduceMotion}
        />
        {/* The same content again, inverted and clipped to the fill, so the
            text and icon change color exactly where the fill passes them. */}
        <motion.span
          aria-hidden
          className="absolute inset-0 flex items-center justify-center bg-foreground text-background"
          style={{ clipPath: clip, opacity: cover }}
        >
          <Content
            view={view}
            cancellable={downloading}
            label={label}
            doneLabel={doneLabel}
            percent={percent}
            reduceMotion={reduceMotion}
          />
        </motion.span>
      </button>

      {/* Outside the button: a button's children are presentational, so a
          progressbar nested inside would never reach assistive tech. */}
      <span
        role="progressbar"
        aria-label="Download progress"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={downloading ? Math.round(progress * 100) : undefined}
        aria-hidden={!downloading}
        className="sr-only"
      />
      <span className="sr-only" aria-live="polite">
        {checked ? "Download complete" : note}
      </span>
    </span>
  );
}

type View = "idle" | "busy" | "done";

function Content({
  view,
  cancellable,
  label,
  doneLabel,
  percent,
  reduceMotion,
}: {
  view: View;
  cancellable: boolean;
  label: string;
  doneLabel: string;
  percent: MotionValue<string>;
  reduceMotion: boolean | null;
}) {
  const busy = view === "busy";
  // Only the live word takes up space, so the icon and word stay centered
  // as a pair in every state; the icon glides to its new spot instead of
  // jumping, and the words cross-fade in place.
  const glide = reduceMotion ? { duration: 0 } : SHIFT;
  return (
    <span aria-hidden className="flex items-center gap-2">
      <motion.span layout="position" transition={glide} className="grid">
        <motion.svg
          viewBox="0 0 24 24"
          className="col-start-1 row-start-1 size-5"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.75}
          strokeLinecap="round"
          strokeLinejoin="round"
          initial={false}
          animate={view === "done" ? hidden(reduceMotion) : shown}
          transition={ICON_SWAP}
        >
          {/* Drops 3.5px so the tip lands inside the tray and stays there
              while the file comes in. No spring: a bounce would read as the
              arrow hitting a floor. */}
          <g
            className={cn(
              "transition-[translate] ease-[cubic-bezier(0.23,1,0.32,1)] motion-reduce:transition-none",
              busy ? "translate-y-[3.5px] duration-300" : "duration-200",
            )}
          >
            <path d="M12 3.75v10M7.75 9.5 12 13.75l4.25-4.25" />
          </g>
          <path d="M4.25 14.5v3.25c0 1.1.9 2 2 2h11.5c1.1 0 2-.9 2-2V14.5" />
        </motion.svg>
        <motion.svg
          viewBox="0 0 24 24"
          className="col-start-1 row-start-1 size-5"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          initial={false}
          animate={view === "done" ? shown : hidden(reduceMotion)}
          transition={ICON_SWAP}
        >
          <path d="m5 12.5 4.5 4.5L19 7" />
        </motion.svg>
      </motion.span>

      <motion.span layout="position" transition={glide} className="relative">
        <Word visible={view === "idle"}>{label}</Word>
        {/* A slot as wide as "Cancel" holds both the percent and the hover
            swap, so neither the digits nor the swap nudge the icon. */}
        <Word
          visible={busy}
          className={cn(
            "w-14 text-center tabular-nums",
            cancellable &&
              "group-hover:-translate-y-0.5 group-hover:opacity-0 group-hover:blur-[4px] group-focus-visible:-translate-y-0.5 group-focus-visible:opacity-0 group-focus-visible:blur-[4px]",
          )}
        >
          <motion.span>{percent}</motion.span>
        </Word>
        {/* Percent gives way to Cancel on hover or keyboard focus, which is
            how the cancel action becomes discoverable. */}
        <Word
          visible={false}
          className={cn(
            "w-14 text-center",
            cancellable &&
              "group-hover:translate-y-0 group-hover:opacity-100 group-hover:blur-[0px] group-focus-visible:translate-y-0 group-focus-visible:opacity-100 group-focus-visible:blur-[0px]",
          )}
        >
          Cancel
        </Word>
        <Word visible={view === "done"}>{doneLabel}</Word>
      </motion.span>
    </span>
  );
}

const shown = { scale: 1, opacity: 1, filter: "blur(0px)" };
const hidden = (reduceMotion: boolean | null) =>
  reduceMotion
    ? { scale: 1, opacity: 0, filter: "blur(0px)" }
    : { scale: 0.25, opacity: 0, filter: "blur(4px)" };

// Enters over 200ms, leaves in 100ms, so two words never read as
// overlapping. Hidden words leave the flow (pinned to the left edge) so only
// the live one sizes the row.
function Word({
  visible,
  className,
  children,
}: {
  visible: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <span
      className={cn(
        "block whitespace-nowrap transition-[opacity,filter,translate] ease-[cubic-bezier(0.23,1,0.32,1)] motion-reduce:transition-[opacity]",
        visible
          ? "relative translate-y-0 opacity-100 blur-[0px] duration-200"
          : "absolute top-0 left-0 translate-y-0.5 opacity-0 blur-[4px] duration-100 motion-reduce:translate-y-0 motion-reduce:blur-[0px]",
        className,
      )}
    >
      {children}
    </span>
  );
}

// Quick start, a long stall around 60% (the server thinking), then a fast
// finish: roughly how a real download looks. [ms from start, progress]
const STEPS: [number, number][] = [
  [150, 0.08],
  [340, 0.19],
  [560, 0.31],
  [800, 0.44],
  [1050, 0.56],
  [1300, 0.61],
  [1900, 0.64],
  [2300, 0.7],
  [2550, 0.81],
  [2780, 0.9],
  [2980, 0.96],
  [3200, 1],
];

export default function DownloadButtonDemo() {
  const [status, setStatus] = useState<DownloadStatus>("idle");
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
    setStatus("downloading");
    for (const [at, value] of STEPS) {
      // Up to 100ms of jitter, less than any gap between steps so order
      // holds, keeps repeat runs from feeling canned.
      const jitter = value === 1 ? 0 : Math.random() * 100;
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
    // 30px outer radius around 8px of padding hugs the 22px button radius.
    <div className="flex w-[min(460px,100%)] items-center gap-4 rounded-[30px] bg-surface p-2 pl-5 shadow-raised">
      <div className="min-w-0 flex-1">
        <p className="truncate text-[15px] font-medium text-foreground">
          brand-assets.zip
        </p>
        <p className="text-[13px] text-muted tabular-nums">24.8 MB</p>
      </div>
      <DownloadButton
        status={status}
        progress={progress}
        onStart={start}
        onCancel={cancel}
        onReset={reset}
        className="shrink-0 [&>button]:bg-background"
      />
    </div>
  );
}
