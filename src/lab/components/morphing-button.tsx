import { useEffect, useRef, useState } from "react";
import { motion } from "motion/react";
import { useReducedMotion } from "@/lib/use-reduced-motion";
import { cn } from "@/lib/cn";

type Status = "idle" | "loading" | "success" | "error";

// No bounce: a button that overshoots its own width looks unsure of itself.
const MORPH = { type: "spring", duration: 0.3, bounce: 0 } as const;
const ICON_SWAP = { type: "spring", duration: 0.3, bounce: 0 } as const;
// Matches h-10, so the compact state is a true circle.
const CIRCLE = 40;
// Swings that die away, like a head shaking no.
const SHAKE: Keyframe[] = [
  { translate: "0" },
  { translate: "-6px" },
  { translate: "5px" },
  { translate: "-3px" },
  { translate: "2px" },
  { translate: "0" },
];

const ANNOUNCE: Record<Status, string> = {
  idle: "",
  loading: "Saving",
  success: "Changes saved",
  error: "Couldn't save. Try again.",
};

export function MorphingButton({
  onSave,
  label = "Save changes",
  retryLabel = "Try again",
  // Long enough to register the check, short enough to be ready again soon.
  successFor = 1500,
  className,
}: {
  onSave: () => Promise<void>;
  label?: string;
  retryLabel?: string;
  successFor?: number;
  className?: string;
}) {
  const reduceMotion = useReducedMotion();
  const [status, setStatus] = useState<Status>("idle");
  const buttonRef = useRef<HTMLButtonElement>(null);
  const reset = useRef<ReturnType<typeof setTimeout>>(undefined);
  const shake = useRef<Animation>(undefined);
  const attempt = useRef(0);

  useEffect(
    () => () => {
      attempt.current++;
      clearTimeout(reset.current);
      shake.current?.cancel();
    },
    [],
  );

  const busy = status === "loading" || status === "success";
  const compact = busy;

  const save = async () => {
    if (busy) return;
    const id = ++attempt.current;
    clearTimeout(reset.current);
    shake.current?.cancel();
    setStatus("loading");
    try {
      await onSave();
      if (id !== attempt.current) return;
      setStatus("success");
      reset.current = setTimeout(() => setStatus("idle"), successFor);
    } catch {
      if (id !== attempt.current) return;
      setStatus("error");
      if (reduceMotion) return;
      // 350ms, past the usual cap: a shake needs a few swings to read as
      // "no". Waits 150ms for the width to mostly open so it shakes the
      // settled shape, not one still growing.
      shake.current = buttonRef.current?.animate(SHAKE, {
        duration: 350,
        delay: 150,
        easing: "ease-in-out",
      });
    }
  };

  return (
    <>
      <motion.button
        ref={buttonRef}
        type="button"
        // aria-disabled rather than disabled, so keyboard focus survives the
        // loading state instead of dropping to the page.
        aria-disabled={busy}
        aria-label={
          status === "loading"
            ? "Saving"
            : status === "success"
              ? "Saved"
              : status === "error"
                ? retryLabel
                : label
        }
        onClick={save}
        initial={false}
        animate={{ width: compact ? CIRCLE : "auto" }}
        transition={reduceMotion ? { duration: 0 } : MORPH}
        className={cn(
          "relative flex h-10 touch-manipulation items-center justify-center overflow-hidden rounded-full px-5 text-sm font-medium outline-hidden select-none",
          "transition-[scale,background-color,color] duration-200 ease-out focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-foreground",
          "active:scale-[0.96] aria-disabled:cursor-default aria-disabled:active:scale-100 motion-reduce:transition-[background-color,color]",
          status === "error"
            ? "bg-danger text-white"
            : "bg-foreground text-background",
          className,
        )}
      >
        {/* Every layer shares one grid cell, so the idle width is the widest
            label and text is never squeezed. In the circle the cell overflows
            both sides equally and the button clips it. */}
        <span aria-hidden className="grid shrink-0 place-items-center">
          <Text visible={status === "idle"}>{label}</Text>
          <Text visible={status === "error"}>{retryLabel}</Text>
          <Icon visible={status === "loading"} reduceMotion={reduceMotion}>
            <g className="origin-center animate-[spin_700ms_linear_infinite]">
              <circle cx="8" cy="8" r="6" className="opacity-25" />
              <path d="M8 2a6 6 0 0 1 6 6" />
            </g>
          </Icon>
          <Icon visible={status === "success"} reduceMotion={reduceMotion}>
            <path d="m3.5 8.5 3 3 6-7" />
          </Icon>
        </span>
      </motion.button>
      <span className="sr-only" aria-live="polite">
        {ANNOUNCE[status]}
      </span>
    </>
  );
}

function Text({
  visible,
  children,
}: {
  visible: boolean;
  children: React.ReactNode;
}) {
  return (
    <span
      className={cn(
        "col-start-1 row-start-1 whitespace-nowrap transition-[opacity,filter] ease-out",
        // Leaves in 150ms, before the width has closed on it; arrives in
        // 200ms as the width opens.
        visible ? "duration-200" : "opacity-0 blur-[4px] duration-150",
      )}
    >
      {children}
    </span>
  );
}

function Icon({
  visible,
  reduceMotion,
  children,
}: {
  visible: boolean;
  reduceMotion: boolean | null;
  children: React.ReactNode;
}) {
  const hidden = reduceMotion
    ? { opacity: 0 }
    : { scale: 0.25, opacity: 0, filter: "blur(4px)" };
  return (
    <motion.svg
      viewBox="0 0 16 16"
      className="col-start-1 row-start-1 size-4"
      fill="none"
      stroke="currentColor"
      // Heavier than the lab's usual 1.5: alone in the circle, the icon is
      // the whole message and has no text to lean on.
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      initial={false}
      animate={visible ? { scale: 1, opacity: 1, filter: "blur(0px)" } : hidden}
      transition={ICON_SWAP}
    >
      {children}
    </motion.svg>
  );
}

// Long enough to see the spinner turn, short for a save.
const LATENCY = 1200;

export default function MorphingButtonDemo() {
  const saves = useRef(0);
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>());

  useEffect(() => {
    const pending = timers.current;
    return () => pending.forEach(clearTimeout);
  }, []);

  // Every other save fails, so both endings are one click apart.
  const save = () => {
    const fail = saves.current++ % 2 === 1;
    return new Promise<void>((resolve, reject) => {
      const t = setTimeout(() => {
        timers.current.delete(t);
        if (fail) reject(new Error("Save failed"));
        else resolve();
      }, LATENCY);
      timers.current.add(t);
    });
  };

  return <MorphingButton onSave={save} />;
}
