import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { useReducedMotion } from "@/lib/use-reduced-motion";
import { usePreviewPlay } from "@/lab/preview-play";
import { cn } from "@/lib/cn";

type Step = "ask" | "why" | "done";

const EASE_OUT = [0.23, 1, 0.32, 1] as const;
// The pill reshapes around each step; a touch of bounce so it settles
// rather than stops.
const RESHAPE = { type: "spring", duration: 0.45, bounce: 0.12 } as const;
const SWAP = { duration: 0.22, ease: EASE_OUT } as const;

export function HelpfulPrompt({
  question = "Was this helpful?",
  onAnswer,
  demo,
  className,
}: {
  question?: string;
  // Fires with the answer and, for a "no", what was missing (may be empty).
  onAnswer?: (helpful: boolean, note?: string) => void;
  // Drives the steps from outside (the card preview) without touching focus.
  demo?: { step: Step; note: string; helpful: boolean } | null;
  className?: string;
}) {
  const reduceMotion = useReducedMotion();
  const [step, setStep] = useState<Step>("ask");
  const [helpful, setHelpful] = useState(true);
  const [note, setNote] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const undo = useRef<HTMLButtonElement>(null);
  const yes = useRef<HTMLButtonElement>(null);
  // Focus follows the step, but only after a person acted, never on load.
  const moveFocus = useRef<Step | null>(null);
  const usingKeys = useRef(false);

  const shown = demo ?? { step, note, helpful };

  useEffect(() => {
    const target = moveFocus.current;
    moveFocus.current = null;
    if (target === "why") input.current?.focus();
    else if (target === "done") undo.current?.focus();
    else if (target === "ask") yes.current?.focus();
  }, [step]);

  const go = (next: Step) => {
    // Saying no always drops you into the field, ready to type. Other steps
    // take focus only for keyboard users (typing counts), so a mouse click
    // never leaves a ring behind.
    if (next === "why" || usingKeys.current) {
      moveFocus.current = next;
    }
    setStep(next);
  };

  const answerYes = () => {
    setHelpful(true);
    go("done");
    onAnswer?.(true);
  };

  const send = (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!note.trim()) return;
    setHelpful(false);
    go("done");
    onAnswer?.(false, note.trim());
  };

  const t = reduceMotion ? { duration: 0 } : RESHAPE;
  const swap = reduceMotion ? { duration: 0 } : SWAP;
  const enter = {
    initial: { opacity: 0, filter: "blur(4px)", scale: 0.98 },
    animate: { opacity: 1, filter: "blur(0px)", scale: 1 },
    exit: {
      opacity: 0,
      filter: "blur(4px)",
      scale: 0.98,
      transition: { duration: 0.12 },
    },
    transition: swap,
  };

  return (
    <motion.div
      layout
      transition={t}
      role="group"
      aria-label="Page feedback"
      onPointerDownCapture={() => (usingKeys.current = false)}
      onKeyDownCapture={() => (usingKeys.current = true)}
      // Radius set here so the reshaping keeps a true pill, never an oval.
      style={{ borderRadius: 999 }}
      className={cn(
        "relative flex h-12 items-center overflow-hidden bg-background shadow-raised",
        className,
      )}
    >
      <AnimatePresence mode="popLayout" initial={false}>
        {shown.step === "ask" && (
          <motion.div
            key="ask"
            {...enter}
            className="flex items-center gap-1 pr-1.5 pl-5"
          >
            <span className="mr-2 text-[14px] whitespace-nowrap text-foreground">
              {question}
            </span>
            <Choice ref={yes} onClick={answerYes}>
              Yes
            </Choice>
            <Choice onClick={() => go("why")}>No</Choice>
          </motion.div>
        )}

        {shown.step === "why" && (
          <motion.form
            key="why"
            {...enter}
            onSubmit={send}
            className="flex items-center gap-1 pr-1.5 pl-5"
          >
            <label htmlFor="helpful-note" className="sr-only">
              What was missing?
            </label>
            <input
              ref={input}
              id="helpful-note"
              value={shown.note}
              onChange={(e) => setNote(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") go("ask");
              }}
              placeholder="What was missing?"
              autoComplete="off"
              maxLength={200}
              // 16px on phones: iOS zooms into any smaller input it focuses.
              className="h-9 w-[min(14rem,48vw)] bg-transparent text-base text-foreground outline-hidden placeholder:text-muted sm:text-[14px]"
            />
            <button
              type="button"
              aria-label="Cancel"
              onClick={() => go("ask")}
              className="grid size-9 shrink-0 place-items-center rounded-full text-muted outline-hidden transition-[color,background-color,scale] duration-150 ease-out hover:bg-surface hover:text-foreground focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-solid focus-visible:outline-foreground active:scale-[0.96]"
            >
              <svg
                viewBox="0 0 16 16"
                className="size-3.5"
                fill="none"
                stroke="currentColor"
                strokeWidth={1.7}
                strokeLinecap="round"
                aria-hidden
              >
                <path d="M4.5 4.5l7 7M11.5 4.5l-7 7" />
              </svg>
            </button>
            <button
              type="submit"
              aria-label="Send feedback"
              disabled={!shown.note.trim()}
              className="grid size-9 shrink-0 place-items-center rounded-full bg-foreground text-background outline-hidden transition-[scale,opacity] duration-150 ease-out focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-solid focus-visible:outline-foreground active:scale-[0.96] disabled:opacity-25"
            >
              <svg
                viewBox="0 0 16 16"
                className="size-4"
                fill="none"
                stroke="currentColor"
                strokeWidth={1.7}
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden
              >
                <path d="M8 12.5v-9M4 7l4-4 4 4" />
              </svg>
            </button>
          </motion.form>
        )}

        {shown.step === "done" && (
          <motion.div
            key="done"
            {...enter}
            className="flex items-center gap-2 pr-1.5 pl-4"
          >
            <svg
              viewBox="0 0 16 16"
              className="size-4 shrink-0 text-foreground"
              fill="none"
              aria-hidden
            >
              <motion.path
                d="M3.5 8.5 6.5 11.5 12.5 4.5"
                stroke="currentColor"
                strokeWidth={1.8}
                strokeLinecap="round"
                strokeLinejoin="round"
                initial={{ pathLength: reduceMotion ? 1 : 0 }}
                animate={{ pathLength: 1 }}
                transition={{ duration: 0.35, delay: 0.1, ease: EASE_OUT }}
              />
            </svg>
            <span className="text-[14px] whitespace-nowrap text-foreground">
              {shown.helpful ? "Thanks, glad it helped" : "Thanks, noted"}
            </span>
            <button
              ref={undo}
              type="button"
              onClick={() => {
                setNote("");
                go("ask");
              }}
              className="ml-1 h-9 rounded-full px-3 text-[13px] text-muted outline-hidden transition-[color,background-color,scale] duration-150 ease-out hover:bg-surface hover:text-foreground focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-solid focus-visible:outline-foreground active:scale-[0.96]"
            >
              Undo
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      <span className="sr-only" aria-live="polite">
        {shown.step === "done" ? "Thanks for your feedback" : ""}
      </span>
    </motion.div>
  );
}

function Choice({
  ref,
  onClick,
  children,
}: {
  ref?: React.Ref<HTMLButtonElement>;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      ref={ref}
      type="button"
      onClick={onClick}
      className="h-9 rounded-full bg-surface px-4 text-[14px] font-medium text-foreground outline-hidden transition-[background-color,scale] duration-150 ease-out hover:bg-foreground/10 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-solid focus-visible:outline-foreground active:scale-[0.96]"
    >
      {children}
    </button>
  );
}

// The card's hover show: a reader says no, types what was missing, sends,
// then another says yes.
const NOTE = "An example with forms";

export default function HelpfulPromptDemo() {
  const play = usePreviewPlay();
  const [demo, setDemo] = useState<{
    step: Step;
    note: string;
    helpful: boolean;
  } | null>(null);

  useEffect(() => {
    if (play !== true) return;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const at = (ms: number, fn: () => void) => timers.push(setTimeout(fn, ms));
    const run = () => {
      at(500, () => setDemo({ step: "why", note: "", helpful: false }));
      for (let i = 1; i <= NOTE.length; i++) {
        at(1000 + i * 45, () =>
          setDemo({ step: "why", note: NOTE.slice(0, i), helpful: false }),
        );
      }
      const sent = 1000 + NOTE.length * 45 + 450;
      at(sent, () => setDemo({ step: "done", note: NOTE, helpful: false }));
      at(sent + 1700, () => setDemo({ step: "ask", note: "", helpful: true }));
      at(sent + 2500, () => setDemo({ step: "done", note: "", helpful: true }));
      at(sent + 4300, () => {
        setDemo({ step: "ask", note: "", helpful: true });
        run();
      });
    };
    run();
    return () => {
      timers.forEach(clearTimeout);
      setDemo(null);
    };
  }, [play]);

  return <HelpfulPrompt demo={play === true ? demo : null} />;
}
