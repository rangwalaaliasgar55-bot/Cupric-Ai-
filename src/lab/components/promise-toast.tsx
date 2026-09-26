import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { AnimatePresence, animate, motion, useMotionValue } from "motion/react";
import { useReducedMotion } from "@/lib/use-reduced-motion";
import { cn } from "@/lib/cn";

type Status = "idle" | "loading" | "success" | "error";
type Messages = { loading: string; success: string; error: string };

const EASE_OUT = [0.23, 1, 0.32, 1] as const;
const ICON_SWAP = { type: "spring", duration: 0.3, bounce: 0 } as const;
// The width follows the text with no bounce: a pill that overshoots would
// look like it measured wrong.
const MORPH = { type: "spring", duration: 0.3, bounce: 0 } as const;
const INSTANT = { duration: 0 };

export function PromiseToast({
  action,
  children,
  messages = { loading: "Saving…", success: "Saved", error: "Couldn't save" },
  // Enough to read one word. Errors wait longer because they ask for a
  // decision, and hovering or focusing the toast holds either one open.
  successDuration = 2000,
  errorDuration = 6000,
  className,
}: {
  action: (signal: AbortSignal) => Promise<unknown>;
  children: React.ReactNode;
  messages?: Messages;
  successDuration?: number;
  errorDuration?: number;
  className?: string;
}) {
  const [status, setStatus] = useState<Status>("idle");
  const triggerRef = useRef<HTMLButtonElement>(null);
  const controller = useRef<AbortController>(undefined);
  const dismiss = useRef<ReturnType<typeof setTimeout>>(undefined);
  const held = useRef(false);

  useEffect(
    () => () => {
      controller.current?.abort();
      clearTimeout(dismiss.current);
    },
    [],
  );

  const schedule = (next: Status) => {
    clearTimeout(dismiss.current);
    if (held.current || (next !== "success" && next !== "error")) return;
    dismiss.current = setTimeout(
      () => setStatus("idle"),
      next === "success" ? successDuration : errorDuration,
    );
  };

  // Replace, never stack: every click saves the same thing, so a newer save
  // makes the older result meaningless. The one toast morphs back to loading
  // in place instead of piling up stale outcomes.
  const run = async () => {
    controller.current?.abort();
    const current = new AbortController();
    controller.current = current;
    clearTimeout(dismiss.current);
    setStatus("loading");
    let next: Status;
    try {
      await action(current.signal);
      next = "success";
    } catch {
      next = "error";
    }
    if (current.signal.aborted) return;
    setStatus(next);
    schedule(next);
  };

  const hold = (on: boolean) => {
    held.current = on;
    if (on) clearTimeout(dismiss.current);
    else schedule(status);
  };

  const loading = status === "loading";

  return (
    <div className={cn("flex flex-col items-center gap-4", className)}>
      <button
        ref={triggerRef}
        type="button"
        // aria-disabled keeps focus on the button while a save is in flight;
        // a second press there would only race the first.
        aria-disabled={loading}
        onClick={() => !loading && run()}
        className={cn(
          "h-10 touch-manipulation rounded-full bg-foreground px-4 text-sm font-medium text-background outline-hidden transition-[scale,opacity] duration-150 ease-out select-none focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-foreground active:scale-[0.96] motion-reduce:transition-[opacity]",
          loading && "cursor-progress opacity-60 active:scale-100",
        )}
      >
        {children}
      </button>

      {/* A fixed 44px slot, so the toast coming and going never moves the
          button above it. */}
      <div className="flex h-11 items-start justify-center">
        <AnimatePresence initial={false}>
          {status !== "idle" && (
            <Toast
              status={status}
              messages={messages}
              onRetry={() => {
                // Retry unmounts itself, so hand focus to the trigger first
                // instead of dropping it on the page.
                triggerRef.current?.focus();
                held.current = false;
                run();
              }}
              onHold={hold}
            />
          )}
        </AnimatePresence>
      </div>

      <span className="sr-only" role="status">
        {status === "idle" ? "" : messages[status]}
      </span>
    </div>
  );
}

function Toast({
  status,
  messages,
  onRetry,
  onHold,
}: {
  status: Exclude<Status, "idle">;
  messages: Messages;
  onRetry: () => void;
  onHold: (on: boolean) => void;
}) {
  const reduceMotion = useReducedMotion();
  const contentRef = useRef<HTMLDivElement>(null);
  const width = useMotionValue<number | "auto">("auto");

  // The pill animates its real width to whatever the incoming content
  // measures, rather than scaling, so the text inside never stretches.
  useLayoutEffect(() => {
    const el = contentRef.current;
    if (!el) return;
    let first = true;
    const observer = new ResizeObserver(() => {
      const next = el.offsetWidth;
      if (first || reduceMotion) width.jump(next);
      else animate(width, next, MORPH);
      first = false;
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [width, reduceMotion]);

  return (
    <motion.div
      // Drops out of the button above it and returns there on the way out.
      initial={{ opacity: 0, y: reduceMotion ? 0 : -6, scale: reduceMotion ? 1 : 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{
        opacity: 0,
        y: reduceMotion ? 0 : -4,
        scale: reduceMotion ? 1 : 0.98,
        transition: { duration: 0.15, ease: EASE_OUT },
      }}
      transition={{ duration: 0.25, ease: EASE_OUT }}
      style={{ width }}
      className="relative h-11 origin-top overflow-hidden rounded-full bg-background text-sm text-foreground shadow-raised"
      onPointerEnter={(e) => e.pointerType !== "touch" && onHold(true)}
      onPointerLeave={(e) => e.pointerType !== "touch" && onHold(false)}
      onFocus={() => onHold(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) onHold(false);
      }}
    >
      {/* w-max lets this report the incoming content's natural width; the
          outgoing copy is popped out of flow so it never counts. */}
      <div ref={contentRef} className="relative flex h-full w-max">
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.div
            key={status}
            initial={{ opacity: 0, filter: "blur(4px)", y: reduceMotion ? 0 : 4 }}
            animate={{ opacity: 1, filter: "blur(0px)", y: 0 }}
            exit={{
              opacity: 0,
              filter: "blur(4px)",
              y: reduceMotion ? 0 : -4,
              transition: { duration: 0.12, ease: EASE_OUT },
            }}
            transition={{ duration: 0.25, ease: EASE_OUT }}
            className={cn(
              "flex h-full items-center gap-2 pl-3.5 whitespace-nowrap",
              // 6px around the 32px Retry keeps the radii concentric: 22 = 16 + 6.
              status === "error" ? "pr-1.5" : "pr-4",
            )}
          >
            <motion.span
              aria-hidden
              className={cn("grid size-4 place-items-center", status === "error" && "text-danger")}
              initial={reduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.25, filter: "blur(4px)" }}
              animate={{ opacity: 1, scale: 1, filter: "blur(0px)" }}
              transition={reduceMotion ? INSTANT : ICON_SWAP}
            >
              <StatusIcon status={status} />
            </motion.span>
            <span aria-hidden className="font-medium">
              {messages[status]}
            </span>
            {status === "error" && (
              <button
                type="button"
                onClick={onRetry}
                className="ml-2 h-8 touch-manipulation rounded-full bg-surface px-3 text-sm font-medium text-foreground outline-hidden transition-[scale,background-color] duration-150 ease-out select-none hover:bg-border focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-foreground active:scale-[0.96] motion-reduce:transition-[background-color]"
              >
                Retry
              </button>
            )}
          </motion.div>
        </AnimatePresence>
      </div>
    </motion.div>
  );
}

function StatusIcon({ status }: { status: Exclude<Status, "idle"> }) {
  const props = {
    viewBox: "0 0 16 16",
    className: "size-4",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.5,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };
  if (status === "loading")
    return (
      // Spins fast on purpose: a quicker spinner makes the same wait feel
      // shorter. Reduced motion slows it rather than freezing the only
      // sign that work is happening.
      <svg
        {...props}
        className="size-4 animate-[spin_700ms_linear_infinite] motion-reduce:animate-[spin_1.6s_linear_infinite]"
      >
        <circle cx="8" cy="8" r="6" opacity={0.2} />
        <path d="M8 2a6 6 0 0 1 6 6" />
      </svg>
    );
  if (status === "success")
    return (
      <svg {...props}>
        <path d="m3.5 8.5 3 3 6-7" />
      </svg>
    );
  return (
    <svg {...props}>
      <circle cx="8" cy="8" r="6.25" />
      <path d="M8 5v3.25" />
      <path d="M8 10.75h.01" strokeWidth={2} />
    </svg>
  );
}

// How long the fake request takes: long enough to see the loading state
// settle, short enough not to feel broken.
const FAKE_LATENCY = 1400;

export default function PromiseToastDemo() {
  const attempt = useRef(0);

  // Alternates so both outcomes show up, success first. A Retry after a
  // failure is the next attempt, so it succeeds.
  const save = (signal: AbortSignal) =>
    new Promise<void>((resolve, reject) => {
      const fail = attempt.current++ % 2 === 1;
      const timer = setTimeout(() => (fail ? reject() : resolve()), FAKE_LATENCY);
      signal.addEventListener("abort", () => clearTimeout(timer), { once: true });
    });

  return <PromiseToast action={save}>Save changes</PromiseToast>;
}
