import { useId, useState } from "react";
import { AnimatePresence, motion, useAnimate } from "motion/react";
import { useReducedMotion } from "@/lib/use-reduced-motion";
import { cn } from "@/lib/cn";

const BOOKMARK =
  "M6.5 4.75A1.75 1.75 0 0 1 8.25 3h7.5a1.75 1.75 0 0 1 1.75 1.75v15.07a.5.5 0 0 1-.79.41L12 16.75l-4.71 3.48a.5.5 0 0 1-.79-.41Z";

// Swaps ride the same no-bounce spring as the lab's icon swaps.
const SWAP = { type: "spring", duration: 0.3, bounce: 0 } as const;

export function BookmarkButton({
  saved,
  onSavedChange,
  count,
  label = "Save",
  savedLabel = "Saved",
  className,
}: {
  saved: boolean;
  onSavedChange: (saved: boolean) => void;
  /** Shows a running count instead of the Save / Saved label. */
  count?: number;
  label?: string;
  savedLabel?: string;
  className?: string;
}) {
  const reduceMotion = useReducedMotion();
  const [scope, animate] = useAnimate<HTMLSpanElement>();
  // Empty until the first toggle, so nothing is announced on load.
  const [note, setNote] = useState("");
  const countId = useId();

  const toggle = () => {
    const next = !saved;
    onSavedChange(next);
    setNote(next ? "Saved" : "Removed from saved");
    if (reduceMotion) return;
    if (next) {
      // The ribbon lifts and stretches a touch, then lands with a squash as
      // the fill tops out (0.65 x 400ms is about when the fill finishes).
      // Kept within 0.95 to 1.05 so it reads as weight, not rubber.
      animate(
        scope.current,
        {
          y: [0, -2, 1, 0],
          scaleX: [1, 0.97, 1.04, 1],
          scaleY: [1, 1.04, 0.95, 1],
        },
        {
          duration: 0.4,
          times: [0, 0.35, 0.65, 1],
          ease: ["easeOut", "easeIn", "easeOut"],
        },
      );
    } else {
      // Unsaving cancels any bounce still in flight and settles fast.
      animate(
        scope.current,
        { y: 0, scaleX: 1, scaleY: 1 },
        { duration: 0.15, ease: [0.23, 1, 0.32, 1] },
      );
    }
  };

  const hasCount = count !== undefined;

  return (
    <>
      <button
        type="button"
        aria-pressed={saved}
        aria-label={label}
        aria-describedby={hasCount ? countId : undefined}
        onClick={toggle}
        className={cn(
          "inline-flex h-10 touch-manipulation items-center gap-2 rounded-full bg-surface text-sm font-medium text-foreground shadow-raised outline-hidden select-none",
          "transition-[scale,background-color] duration-150 ease-out hover:bg-background active:scale-[0.96] motion-reduce:transition-[background-color]",
          "focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-foreground",
          // 4px less on the icon side: the glyph's own bearings fill it.
          "pr-4 pl-3",
          className,
        )}
      >
        <span
          ref={scope}
          aria-hidden
          // Squashes from its base, like something landing.
          className="grid origin-bottom"
        >
          <svg
            viewBox="0 0 24 24"
            className="col-start-1 row-start-1 size-5"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.75}
            strokeLinejoin="round"
          >
            <path d={BOOKMARK} />
          </svg>
          {/* The shape spans 12.5% to 84% of the 24px box, so the clip runs
              between those edges; the full 0 to 100% would waste the first
              and last parts of every transition on empty space. Fills in
              260ms, empties in 150ms: saving is the moment worth showing. */}
          <svg
            viewBox="0 0 24 24"
            className={cn(
              "col-start-1 row-start-1 size-5 transition-[clip-path]",
              saved
                ? "[clip-path:inset(12%_0_0_0)] duration-[260ms] ease-[cubic-bezier(0.23,1,0.32,1)]"
                : "[clip-path:inset(85%_0_0_0)] duration-150 ease-out",
              "motion-reduce:duration-0",
            )}
            fill="currentColor"
          >
            <path d={BOOKMARK} />
          </svg>
        </span>

        {hasCount ? (
          <Count value={count} reduceMotion={reduceMotion} id={countId} />
        ) : (
          // One grid cell, so the button holds the longer label's width and
          // never jumps when they swap.
          <span aria-hidden className="grid">
            <Label visible={!saved}>{label}</Label>
            <Label visible={saved}>{savedLabel}</Label>
          </span>
        )}
      </button>
      <span className="sr-only" aria-live="polite">
        {note}
      </span>
    </>
  );
}

// Enters over 200ms, leaves in 100ms: the old word is gone before the new
// one is legible, so the two never read as overlapping text.
function Label({
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
          ? "translate-y-0 opacity-100 blur-[0px] duration-200"
          : "translate-y-0.5 opacity-0 blur-[4px] duration-100 motion-reduce:translate-y-0 motion-reduce:blur-[0px]",
      )}
    >
      {children}
    </span>
  );
}

function Count({
  value,
  reduceMotion,
  id,
}: {
  value: number;
  reduceMotion: boolean | null;
  id: string;
}) {
  // Holds the last value between renders to tell up from down.
  const [prev, setPrev] = useState(value);
  const [dir, setDir] = useState(1);
  if (prev !== value) {
    setDir(value > prev ? 1 : -1);
    setPrev(value);
  }
  // Up comes in from below and leaves upward, like a counter rolling.
  const shift = reduceMotion ? 0 : 6;

  return (
    <span className="relative inline-flex justify-end tabular-nums">
      <span id={id} className="sr-only">
        {value} saves
      </span>
      <AnimatePresence mode="popLayout" initial={false} custom={dir}>
        <motion.span
          key={value}
          aria-hidden
          custom={dir}
          variants={{
            enter: (d: number) => ({
              y: d * shift,
              opacity: 0,
              filter: reduceMotion ? "blur(0px)" : "blur(4px)",
            }),
            center: { y: 0, opacity: 1, filter: "blur(0px)" },
            // Exits travel half as far and finish sooner than entries.
            exit: (d: number) => ({
              y: (-d * shift) / 2,
              opacity: 0,
              filter: reduceMotion ? "blur(0px)" : "blur(4px)",
              transition: { duration: 0.12, ease: [0.23, 1, 0.32, 1] },
            }),
          }}
          initial="enter"
          animate="center"
          exit="exit"
          transition={SWAP}
        >
          {value}
        </motion.span>
      </AnimatePresence>
    </span>
  );
}

export default function BookmarkButtonDemo() {
  const [articleSaved, setArticleSaved] = useState(false);
  const [labelSaved, setLabelSaved] = useState(false);
  // Someone else's saves; yours adds one on top.
  const base = 127;

  return (
    <div className="flex w-[min(440px,100%)] flex-col items-center gap-6">
      <article className="w-full rounded-2xl bg-surface p-5 shadow-raised">
        <p className="text-xs text-muted">Essay</p>
        <h3 className="mt-1 text-base font-medium text-balance text-foreground">
          Notes on interruptible motion
        </h3>
        <p className="mt-1.5 text-sm text-pretty text-muted">
          Why a transition that can change its mind halfway feels faster than
          one that always runs to the end.
        </p>
        <div className="mt-4 flex items-center justify-between gap-4">
          <span className="text-sm text-muted">6 min read</span>
          <BookmarkButton
            saved={articleSaved}
            onSavedChange={setArticleSaved}
            count={base + (articleSaved ? 1 : 0)}
            className="bg-background hover:bg-background/60"
          />
        </div>
      </article>
      <BookmarkButton saved={labelSaved} onSavedChange={setLabelSaved} />
    </div>
  );
}
