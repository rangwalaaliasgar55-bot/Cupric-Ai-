import { useEffect, useRef, useState } from "react";
import { motion } from "motion/react";
import { useReducedMotion } from "@/lib/use-reduced-motion";
import { cn } from "@/lib/cn";
import { usePreviewPlay } from "@/lab/preview-play";

type Status = "idle" | "copied" | "failed";

// One letter's flip. Each letter starts a beat after its left neighbour,
// so the message reads as a wave running through the address.
const FLIP = { duration: 0.22, ease: [0.23, 1, 0.32, 1] } as const;
const STAGGER = 0.018;
// The box eases to its new width over the same span the wave takes to
// cross it. Width (not scale) on purpose: the neighbours should reflow.
const WIDTH_MS = 320;

export function CopyEmail({
  email,
  copiedText = "Copied to clipboard",
  // Long enough to read the confirmation, short enough to feel returned.
  resetAfter = 1600,
  display,
  className,
}: {
  email: string;
  copiedText?: string;
  resetAfter?: number;
  /** Shows this state instead of the button's own, without copying or
   * announcing anything (a copy confirmed elsewhere, a demo). */
  display?: Status;
  className?: string;
}) {
  const reduceMotion = useReducedMotion();
  const [own, setStatus] = useState<Status>("idle");
  const status = display ?? own;
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const attempt = useRef(0);

  useEffect(() => () => clearTimeout(timer.current), []);

  const show = (next: Exclude<Status, "idle">) => {
    setStatus(next);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setStatus("idle"), resetAfter);
  };

  const copy = async () => {
    const id = ++attempt.current;
    // Confirm on press; the write is near instant and waiting makes the
    // click feel ignored.
    show("copied");
    try {
      if (!navigator.clipboard) throw new Error("Clipboard unavailable");
      await navigator.clipboard.writeText(email);
    } catch {
      if (id === attempt.current) show("failed");
    }
  };

  const shown =
    status === "copied" ? copiedText : status === "failed" ? "Couldn't copy" : email;
  // Every text shares these slots; the extras sit blank at the tail and
  // are clipped by the animating width.
  const slots = Math.max(email.length, copiedText.length, 13);

  return (
    <span className={cn("inline-flex items-center gap-1", className)}>
      <span className="group/copy relative inline-flex">
        <button
          type="button"
          onClick={copy}
          aria-label={`Copy email address ${email}`}
          className="relative flex h-9 touch-manipulation items-center rounded-md px-2 font-mono text-sm text-foreground outline-hidden transition-[scale,background-color] duration-150 ease-out select-none hover:bg-surface focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-solid focus-visible:outline-foreground active:scale-[0.96] motion-reduce:transition-[background-color]"
        >
          <span
            aria-hidden
            className="flex overflow-hidden transition-[width] ease-[cubic-bezier(0.77,0,0.175,1)] motion-reduce:transition-none"
            style={{
              width: `${shown.length}ch`,
              transitionDuration: `${WIDTH_MS}ms`,
              // Room for the flip's perspective to read as depth.
              perspective: 240,
            }}
          >
            {Array.from({ length: slots }, (_, i) => (
              <Letter
                key={i}
                char={shown[i] ?? " "}
                delay={i * STAGGER}
                reduceMotion={reduceMotion}
              />
            ))}
          </span>
        </button>

        {/* A whisper of what the click does. Hidden once the text itself
            is saying something, and never on touch, where hover lies. */}
        <span
          aria-hidden
          className={cn(
            "pointer-events-none absolute bottom-full left-1/2 mb-1 -translate-x-1/2 translate-y-0.5 rounded-full bg-foreground px-2 py-0.5 text-xs font-medium whitespace-nowrap text-background opacity-0",
            "transition-[opacity,translate] duration-100 ease-out [@media(hover:hover)]:group-hover/copy:translate-y-0 [@media(hover:hover)]:group-hover/copy:opacity-100 [@media(hover:hover)]:group-hover/copy:delay-300 [@media(hover:hover)]:group-hover/copy:duration-150",
            status !== "idle" && "invisible",
          )}
        >
          Click to copy
        </span>
      </span>

      <a
        href={`mailto:${email}`}
        aria-label={`Email ${email}`}
        className="relative flex size-7 touch-manipulation items-center justify-center rounded-md text-muted outline-hidden transition-[scale,color,background-color] duration-150 ease-out after:absolute after:-inset-1.5 hover:bg-surface hover:text-foreground focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-foreground active:scale-[0.96]"
      >
        <svg
          aria-hidden
          viewBox="0 0 16 16"
          className="size-3.5"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.5}
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M5 11 11 5M6 5h5v5" />
        </svg>
      </a>

      <span className="sr-only" aria-live="polite">
        {own === "copied" ? "Copied to clipboard" : own === "failed" ? "Couldn't copy" : ""}
      </span>
    </span>
  );
}

function Letter({
  char,
  delay,
  reduceMotion,
}: {
  char: string;
  delay: number;
  reduceMotion: boolean | null;
}) {
  // Two faces: the letter on show, and the one it is leaving. Keying the
  // pair on the char restarts the flip only for slots that change.
  const [faces, setFaces] = useState({ now: char, was: char });
  if (faces.now !== char) setFaces({ now: char, was: faces.now });

  const changed = faces.now !== faces.was;
  return (
    <span className="relative inline-block w-[1ch] shrink-0 whitespace-pre [transform-style:preserve-3d]">
      <motion.span
        key={`in-${faces.now}-${faces.was}`}
        className="block origin-[50%_50%_-0.5em] backface-hidden"
        initial={
          changed
            ? reduceMotion
              ? { opacity: 0 }
              : { rotateX: -90, opacity: 0 }
            : false
        }
        animate={{ rotateX: 0, opacity: 1 }}
        transition={{ ...FLIP, delay: reduceMotion ? 0 : delay }}
      >
        {faces.now}
      </motion.span>
      {changed ? (
        <motion.span
          key={`out-${faces.now}-${faces.was}`}
          aria-hidden
          className="absolute inset-0 block origin-[50%_50%_-0.5em] backface-hidden"
          initial={{ rotateX: 0, opacity: 1 }}
          animate={reduceMotion ? { opacity: 0 } : { rotateX: 90, opacity: 0 }}
          transition={{ ...FLIP, delay: reduceMotion ? 0 : delay }}
        >
          {faces.was}
        </motion.span>
      ) : null}
    </span>
  );
}

// The index card's show: a click a moment after the cursor arrives, the
// confirmation for as long as a real one lasts, then a calm beat.
const SHOW_CLICK = 500;
const SHOW_HOLD = 1600;
const SHOW_REST = 1800;

export default function CopyEmailDemo() {
  const play = usePreviewPlay();
  const [display, setDisplay] = useState<Status>();

  useEffect(() => {
    if (play !== true) return;
    let timer: ReturnType<typeof setTimeout>;
    const click = (wait: number) => {
      timer = setTimeout(() => {
        // Only the letters change; the real clipboard is never touched.
        setDisplay("copied");
        timer = setTimeout(() => {
          setDisplay("idle");
          click(SHOW_REST);
        }, SHOW_HOLD);
      }, wait);
    };
    click(SHOW_CLICK);
    // Unhovering flips the letters back to the address.
    return () => {
      clearTimeout(timer);
      setDisplay(undefined);
    };
  }, [play]);

  return (
    // Fixed width and left-aligned so the address never moves under the
    // cursor; only the arrow slides as the text grows. In an index card the
    // box is narrowed to halfway between the resting (248px) and copied
    // (290px) widths and kept on one line, so the centred card is off by
    // only ~10px either way.
    <div
      className={cn(
        "flex flex-wrap items-center gap-x-2 text-sm text-muted",
        play === null ? "w-[min(340px,100%)]" : "w-[269px] flex-nowrap whitespace-nowrap",
      )}
    >
      <span>Say hello at</span>
      <CopyEmail
        email="hi@xevrion.dev"
        display={display}
        className={play === null ? undefined : "shrink-0"}
      />
    </div>
  );
}
