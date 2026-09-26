import { useEffect, useRef, useState } from "react";
import { motion } from "motion/react";
import { useReducedMotion } from "@/lib/use-reduced-motion";
import { cn } from "@/lib/cn";

type Status = "idle" | "copied" | "failed";

const ICON_SWAP = { type: "spring", duration: 0.3, bounce: 0 } as const;

export function CopyButton({
  value,
  label = "Copy to clipboard",
  // Long enough to read the tooltip, short enough that a second copy
  // rarely lands while the first is still confirming.
  resetAfter = 1600,
  onCopy,
  className,
}: {
  value: string;
  label?: string;
  resetAfter?: number;
  onCopy?: (value: string) => void;
  className?: string;
}) {
  const reduceMotion = useReducedMotion();
  const [status, setStatus] = useState<Status>("idle");
  // Holds the last message while the tooltip fades out, so it never
  // empties mid-exit.
  const [message, setMessage] = useState("Copied");
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const attempt = useRef(0);

  useEffect(() => () => clearTimeout(timer.current), []);

  const show = (next: Exclude<Status, "idle">) => {
    setStatus(next);
    setMessage(next === "copied" ? "Copied" : "Couldn't copy");
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setStatus("idle"), resetAfter);
  };

  const copy = async () => {
    const id = ++attempt.current;
    // Confirm on press rather than after the write resolves; the write is
    // near instant, and waiting for it makes the click feel ignored.
    show("copied");
    try {
      if (!navigator.clipboard) throw new Error("Clipboard unavailable");
      await navigator.clipboard.writeText(value);
      if (id === attempt.current) onCopy?.(value);
    } catch {
      // Ignore failures from a click that a newer one has superseded.
      if (id === attempt.current) show("failed");
    }
  };

  const visible = status !== "idle";

  return (
    <span className={cn("relative inline-flex", className)}>
      <button
        type="button"
        aria-label={label}
        onClick={copy}
        className={cn(
          "relative flex size-8 touch-manipulation items-center justify-center rounded-full text-muted outline-hidden transition-[scale,color,background-color] duration-150 ease-out select-none hover:bg-background hover:text-foreground focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-foreground active:scale-[0.96] motion-reduce:transition-[color,background-color]",
          // Grows the hit area to 40px without growing the visible circle.
          "after:absolute after:-inset-1 after:rounded-full",
          visible && "text-foreground",
        )}
      >
        {/* Both icons share one grid cell so the swap never shifts layout. */}
        <span className="grid" aria-hidden>
          <CopyGlyph copied={status === "copied"} reduceMotion={reduceMotion} />
          <CheckGlyph copied={status === "copied"} reduceMotion={reduceMotion} />
        </span>
      </button>

      {/* Out of flow, so appearing never nudges the row. Enters in 150ms,
          leaves in 100ms: the exit should never hold the eye. */}
      <span
        aria-hidden
        className={cn(
          "pointer-events-none absolute bottom-full left-1/2 mb-2 -translate-x-1/2 origin-bottom rounded-full bg-foreground px-2 py-1 text-xs font-medium whitespace-nowrap text-background",
          "transition-[opacity,translate,scale] ease-[cubic-bezier(0.23,1,0.32,1)] motion-reduce:transition-[opacity]",
          visible
            ? "translate-y-0 scale-100 opacity-100 duration-150"
            : "translate-y-1 scale-[0.97] opacity-0 duration-100 motion-reduce:translate-y-0 motion-reduce:scale-100",
        )}
      >
        {message}
      </span>

      <span className="sr-only" aria-live="polite">
        {visible ? message : ""}
      </span>
    </span>
  );
}

const GLYPH = {
  viewBox: "0 0 16 16",
  className: "col-start-1 row-start-1 size-4",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.5,
  strokeLinecap: "round",
  strokeLinejoin: "round",
} as const;

// The front sheet is offset from the back one by 2.5 units each way, so
// sliding it back by exactly that lays it over the rear outline.
const SHEET_OFFSET = 2.5;
const MERGE = { duration: 0.12, ease: [0.77, 0, 0.175, 1] } as const;

// The copy icon acts the copy out: the front sheet slides onto the back one
// until the two pages are one, and only then does that page give way to a
// check that draws itself in. Returning, the page splits back into two.
function CopyGlyph({
  copied,
  reduceMotion,
}: {
  copied: boolean;
  reduceMotion: boolean | null;
}) {
  const shown = { scale: 1, opacity: 1, filter: "blur(0px)" };
  return (
    <motion.svg
      {...GLYPH}
      initial={false}
      animate={
        copied
          ? reduceMotion
            ? { opacity: 0 }
            : {
                scale: 0.25,
                opacity: 0,
                filter: "blur(4px)",
                // Waits for the sheets to merge before it leaves.
                transition: { ...ICON_SWAP, delay: MERGE.duration },
              }
          : { ...shown, transition: ICON_SWAP }
      }
    >
      <path d="M10.75 5.25V4.5a1.75 1.75 0 0 0-1.75-1.75H4.5A1.75 1.75 0 0 0 2.75 4.5V9a1.75 1.75 0 0 0 1.75 1.75h.75" />
      <motion.rect
        x="5.25"
        y="5.25"
        width="8"
        height="8"
        rx="1.75"
        initial={false}
        animate={
          copied && !reduceMotion
            ? { x: -SHEET_OFFSET, y: -SHEET_OFFSET, transition: MERGE }
            : // Splits a beat after the page has faded back in.
              { x: 0, y: 0, transition: { ...MERGE, delay: 0.1 } }
        }
      />
    </motion.svg>
  );
}

function CheckGlyph({
  copied,
  reduceMotion,
}: {
  copied: boolean;
  reduceMotion: boolean | null;
}) {
  return (
    <motion.svg
      {...GLYPH}
      initial={false}
      animate={
        copied
          ? { opacity: 1, transition: { duration: 0.1, delay: MERGE.duration } }
          : // Softer than the entrance: fades rather than un-draws.
            { opacity: 0, transition: { duration: 0.12 } }
      }
    >
      <motion.path
        d="m3.5 8.5 3 3 6-7"
        initial={false}
        animate={
          copied || reduceMotion
            ? {
                pathLength: 1,
                transition: reduceMotion
                  ? { duration: 0 }
                  : // A pen stroke: fast off the mark, easing into the tip.
                    { duration: 0.22, delay: MERGE.duration, ease: [0.65, 0, 0.35, 1] },
              }
            : // Rewinds only once invisible, ready for the next copy.
              { pathLength: 0, transition: { duration: 0, delay: 0.12 } }
        }
      />
    </motion.svg>
  );
}

export default function CopyButtonDemo() {
  const command = "bun add motion";
  return (
    // A 44px pill with 6px padding around the 32px button keeps the radii
    // concentric: 22 = 16 + 6.
    <div className="flex h-11 items-center gap-3 rounded-full bg-surface pr-1.5 pl-4 shadow-raised">
      <code className="font-mono text-sm text-foreground">
        <span className="text-muted select-none">$ </span>
        {command}
      </code>
      <CopyButton value={command} label="Copy command" />
    </div>
  );
}
