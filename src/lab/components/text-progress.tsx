import { useEffect, useRef, useState } from "react";
import { motion, useSpring, useTransform } from "motion/react";
import { useReducedMotion } from "@/lib/use-reduced-motion";
import { cn } from "@/lib/cn";
import { usePreviewPlay } from "@/lab/preview-play";

const DIGITS = ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"];
// The tens column starts blank, so 7% never reads as 07%.
const TENS = [" ", "1", "2", "3", "4", "5", "6", "7", "8", "9"];
const EASE_OUT = "ease-[cubic-bezier(0.23,1,0.32,1)]";

function Roll({ strip, index }: { strip: string[]; index: number }) {
  return (
    <span className="relative inline-block h-[1lh] w-[1ch] overflow-hidden">
      <span
        className={cn(
          "absolute inset-x-0 top-0 flex flex-col transition-[translate] duration-300 motion-reduce:transition-none",
          EASE_OUT,
        )}
        style={{ translate: `0 ${-index * 10}%` }}
      >
        {strip.map((d, i) => (
          <span key={i} className="h-[1lh]">
            {d}
          </span>
        ))}
      </span>
    </span>
  );
}

export function TextProgress({
  value,
  label,
  doneLabel = "Done",
  className,
}: {
  /** 0 to 100. */
  value: number;
  label: string;
  doneLabel?: string;
  className?: string;
}) {
  const reduceMotion = useReducedMotion();
  const clamped = Math.min(100, Math.max(0, value));
  const percent = Math.round(clamped);
  const done = percent >= 100;

  // Progress arrives in uneven jumps; a spring turns them into one steady
  // pour of ink and keeps its speed when the next jump lands mid-glide.
  const ink = useSpring(clamped, { stiffness: 90, damping: 20 });
  useEffect(() => {
    if (reduceMotion) ink.jump(clamped);
    else ink.set(clamped);
  }, [clamped, ink, reduceMotion]);
  const clip = useTransform(ink, (v) => `inset(0 ${Math.max(0, 100 - v).toFixed(2)}% 0 0)`);

  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent}
      aria-valuetext={done ? doneLabel : `${percent}%`}
      className={cn(
        // Every part is exactly one 24px line tall, so centring lines them
        // up; baseline alignment breaks on the clipped digit columns.
        "relative inline-flex items-center gap-2.5 text-base leading-6 font-medium",
        className,
      )}
    >
      <span aria-hidden className="grid">
        <span
          className={cn(
            "relative col-start-1 row-start-1 whitespace-nowrap transition-[opacity,filter,translate]",
            EASE_OUT,
            done
              ? "-translate-y-1 opacity-0 blur-[4px] duration-200 motion-reduce:translate-y-0"
              : "opacity-100 duration-300",
          )}
        >
          <span className="text-foreground/20">{label}</span>
          {/* The same words, stacked and clipped: ink fills the letters
              themselves rather than a bar beside them. */}
          <motion.span
            className="absolute inset-0 text-foreground"
            style={{ clipPath: clip }}
          >
            {label}
          </motion.span>
        </span>
        <span
          className={cn(
            "col-start-1 row-start-1 flex items-center gap-1.5 whitespace-nowrap text-foreground transition-[opacity,filter,translate]",
            EASE_OUT,
            done
              ? "translate-y-0 opacity-100 filter-none delay-100 duration-300"
              : "pointer-events-none translate-y-1 opacity-0 blur-[4px] duration-150 motion-reduce:translate-y-0",
          )}
        >
          <svg viewBox="0 0 16 16" fill="none" className="size-4 shrink-0">
            <path
              d="m3.5 8.5 3 3 6-7"
              pathLength={1}
              stroke="currentColor"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeDasharray={1}
              className={cn(
                "transition-[stroke-dashoffset] ease-[cubic-bezier(0.65,0,0.35,1)] motion-reduce:transition-none",
                // Draws once the word has arrived; rewinds only after it's gone.
                done ? "[stroke-dashoffset:0] delay-150 duration-300" : "[stroke-dashoffset:1] delay-150 duration-0",
              )}
            />
          </svg>
          {doneLabel}
        </span>
      </span>

      <span
        aria-hidden
        className={cn(
          "flex text-muted tabular-nums transition-[opacity,filter]",
          EASE_OUT,
          done ? "opacity-0 blur-[4px] duration-200" : "opacity-100 duration-300",
        )}
      >
        <Roll strip={TENS} index={Math.floor((percent % 100) / 10)} />
        <Roll strip={DIGITS} index={percent % 10} />
        <span>%</span>
      </span>

      <span className="sr-only" aria-live="polite">
        {done ? doneLabel : ""}
      </span>
    </div>
  );
}

// An index card at rest holds the upload part-way, so the half-inked label
// shows the idea without anything running.
const PREVIEW_REST = 62;

export default function TextProgressDemo() {
  const play = usePreviewPlay();
  const [value, setValue] = useState(() => (play === null ? 0 : PREVIEW_REST));
  const [run, setRun] = useState(0);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  // A fake upload: uneven chunks at uneven intervals, like a real network.
  useEffect(() => {
    if (play !== null) return;
    let v = 0;
    const tick = () => {
      v = Math.min(100, v + 4 + Math.random() * 14);
      setValue(v);
      if (v < 100) timer.current = setTimeout(tick, 220 + Math.random() * 480);
    };
    timer.current = setTimeout(tick, 600);
    return () => clearTimeout(timer.current);
  }, [run, play]);

  // Index preview: the waiting upload picks up and finishes, holds on
  // "Uploaded" for a beat, then the next one starts from empty. Leaving
  // glides the ink back to where it rested.
  useEffect(() => {
    if (!play) return;
    let v = PREVIEW_REST;
    let t: ReturnType<typeof setTimeout>;
    const tick = () => {
      v = Math.min(100, v + 5 + Math.random() * 12);
      setValue(v);
      if (v < 100) {
        t = setTimeout(tick, 200 + Math.random() * 350);
        return;
      }
      t = setTimeout(() => {
        v = 0;
        setValue(0);
        t = setTimeout(tick, 900);
      }, 1800);
    };
    t = setTimeout(tick, 250);
    return () => {
      clearTimeout(t);
      setValue(PREVIEW_REST);
    };
  }, [play]);

  return (
    <div className="flex flex-col items-center gap-5">
      <TextProgress value={value} label="Uploading 3 files" doneLabel="Uploaded" />
      <button
        type="button"
        onClick={() => {
          setValue(0);
          setRun((r) => r + 1);
        }}
        className="flex h-8 items-center gap-1.5 rounded-full px-3 text-[13px] font-medium text-muted outline-hidden transition-[color,background-color,scale] duration-150 ease-out hover:bg-surface hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-solid focus-visible:outline-foreground active:scale-[0.96]"
      >
        <svg viewBox="0 0 16 16" fill="none" aria-hidden className="size-3.5">
          <path
            d="M2.75 8a5.25 5.25 0 1 0 1.54-3.71M2.75 2.5v2.25H5"
            stroke="currentColor"
            strokeWidth={1.5}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        Restart
      </button>
    </div>
  );
}
