import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { useReducedMotion } from "@/lib/use-reduced-motion";
import { usePreviewPlay } from "@/lab/preview-play";
import { cn } from "@/lib/cn";

export type SaveState = "saved" | "unsaved" | "saving";

const EASE_OUT = [0.23, 1, 0.32, 1] as const;
const MOVE = { type: "spring", duration: 0.4, bounce: 0.1 } as const;
const PAUSE = 800; // ms of stillness before saving starts
const MINUTE = 60_000;

const CSS = `
@keyframes as-pulse { 0%, 100% { opacity: .25 } 40% { opacity: 1 } }
`;

// Says how long ago, in the words a person would use, and only changes
// when those words would.
function savedLabel(savedAt: number | null, now: number) {
  if (savedAt === null) return "Saved";
  const ago = now - savedAt;
  if (ago < 45_000) return "Saved just now";
  if (ago < 60 * MINUTE)
    return `Saved ${Math.max(1, Math.floor(ago / MINUTE))} min ago`;
  return `Saved at ${new Date(savedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
}

// The icon is one set of three dots throughout: a single dot means there
// are changes, it splits into three that pulse while saving, and the three
// gather back into the middle as the check draws.
export function AutosaveStatus({
  state,
  savedAt = null,
  now = 0,
  className,
}: {
  state: SaveState;
  savedAt?: number | null;
  now?: number;
  className?: string;
}) {
  const reduceMotion = useReducedMotion();
  const label =
    state === "saving"
      ? "Saving"
      : state === "unsaved"
        ? "Unsaved changes"
        : savedLabel(savedAt, now);
  const move = reduceMotion ? { duration: 0 } : MOVE;

  return (
    <div
      className={cn(
        // A fixed width, as wide as the longest thing it says, so the icon
        // never shifts and old and new words cross in the same spot.
        "flex w-[8.75rem] shrink-0 items-center gap-2 text-[13px] whitespace-nowrap text-muted",
        className,
      )}
    >
      <style>{CSS}</style>
      <span aria-hidden className="relative grid size-4 shrink-0 place-items-center">
        {[-5, 0, 5].map((x, i) => {
          const middle = i === 1;
          return (
            <motion.span
              key={i}
              className="absolute size-[4px]"
              initial={false}
              animate={
                state === "saving"
                  ? { x, opacity: 1, scale: 1 }
                  : state === "unsaved"
                    ? { x: 0, opacity: middle ? 1 : 0, scale: middle ? 1.5 : 1 }
                    : { x: 0, opacity: 0, scale: 0.5 }
              }
              transition={move}
            >
              <span
                className="block size-full rounded-full bg-current"
                style={{
                  animation:
                    state === "saving" && !reduceMotion
                      ? `as-pulse 1s ease-in-out ${i * 0.16}s infinite`
                      : "none",
                }}
              />
            </motion.span>
          );
        })}
        <svg viewBox="0 0 16 16" className="absolute size-4 text-foreground" fill="none">
          <motion.path
            d="M3.75 8.25l2.75 2.75 5.75-6"
            stroke="currentColor"
            strokeWidth={1.6}
            strokeLinecap="round"
            strokeLinejoin="round"
            initial={false}
            animate={
              state === "saved"
                ? { pathLength: 1, opacity: 1 }
                : { pathLength: 0, opacity: 0 }
            }
            transition={
              reduceMotion
                ? { duration: 0 }
                : state === "saved"
                  ? { duration: 0.35, delay: 0.12, ease: EASE_OUT }
                  : { duration: 0.12 }
            }
          />
        </svg>
      </span>
      <span className="relative flex min-w-0 flex-1">
        <AnimatePresence initial={false} mode="popLayout">
          <motion.span
            key={label}
            initial={{ opacity: 0, y: 3, filter: "blur(3px)" }}
            animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
            exit={{ opacity: 0, y: -3, filter: "blur(3px)", transition: { duration: 0.12 } }}
            transition={reduceMotion ? { duration: 0 } : { duration: 0.22, ease: EASE_OUT }}
          >
            {label}
          </motion.span>
        </AnimatePresence>
      </span>
      <span className="sr-only" aria-live="polite">
        {state === "saved" && savedAt !== null ? "All changes saved" : ""}
      </span>
    </div>
  );
}

const TITLE = "Trip notes";
const BODY =
  "Pack light this time. Two shirts, the grey jacket, and the charger that actually works.";
const TYPED = " Leave by seven.";

export default function AutosaveStatusDemo() {
  const play = usePreviewPlay();
  const [title, setTitle] = useState(TITLE);
  const [body, setBody] = useState(BODY);
  const [state, setState] = useState<SaveState>("saved");
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [now, setNow] = useState(0);
  const pause = useRef<ReturnType<typeof setTimeout>>(undefined);
  const saving = useRef<ReturnType<typeof setTimeout>>(undefined);

  // Every edit resets the clock; the save starts once typing pauses, and a
  // new keystroke mid-save goes back to waiting.
  const edited = () => {
    clearTimeout(pause.current);
    clearTimeout(saving.current);
    setState("unsaved");
    pause.current = setTimeout(() => {
      setState("saving");
      // Stands in for the request, which never takes the same time twice.
      saving.current = setTimeout(
        () => {
          const t = Date.now();
          setSavedAt(t);
          setNow(t);
          setState("saved");
        },
        650 + Math.random() * 350,
      );
    }, PAUSE);
  };
  const editedRef = useRef(edited);
  useEffect(() => {
    editedRef.current = edited;
  });

  useEffect(
    () => () => {
      clearTimeout(pause.current);
      clearTimeout(saving.current);
    },
    [],
  );

  // "Saved just now" ages on its own, checked twice a minute; idle cards
  // never start the clock.
  useEffect(() => {
    if (state !== "saved" || savedAt === null || play === false) return;
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, [state, savedAt, play]);

  // The card's hover show: someone adds a line, pauses, it saves; then they
  // take it back out, and it saves again.
  useEffect(() => {
    if (play !== true) return;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const at = (ms: number, fn: () => void) => timers.push(setTimeout(fn, ms));
    const run = () => {
      let t = 300;
      for (let i = 1; i <= TYPED.length; i++, t += 55) {
        const next = BODY + TYPED.slice(0, i);
        at(t, () => {
          setBody(next);
          editedRef.current();
        });
      }
      t += 3200;
      for (let i = TYPED.length - 1; i >= 0; i--, t += 28) {
        const next = BODY + TYPED.slice(0, i);
        at(t, () => {
          setBody(next);
          editedRef.current();
        });
      }
      at(t + 3200, run);
    };
    run();
    return () => {
      timers.forEach(clearTimeout);
      clearTimeout(pause.current);
      clearTimeout(saving.current);
      setBody(BODY);
      setState("saved");
      setSavedAt(null);
    };
  }, [play]);

  return (
    <div className="@container w-[min(440px,100%)] rounded-2xl bg-background p-6 shadow-raised">
      {/* Side by side when there's room; on a narrow card the status sits
          above the title so the title keeps its full width. */}
      <div className="flex flex-col-reverse items-start gap-1.5 @min-[360px]:flex-row @min-[360px]:items-center @min-[360px]:justify-between @min-[360px]:gap-4">
        <input
          aria-label="Title"
          value={title}
          onChange={(e) => {
            setTitle(e.target.value);
            edited();
          }}
          placeholder="Untitled"
          className="w-full min-w-0 flex-1 bg-transparent text-[18px] font-semibold tracking-tight text-foreground outline-hidden placeholder:text-muted"
        />
        <AutosaveStatus state={state} savedAt={savedAt} now={now} />
      </div>
      <textarea
        aria-label="Note"
        value={body}
        onChange={(e) => {
          setBody(e.target.value);
          edited();
        }}
        rows={4}
        placeholder="Start writing"
        // 16px on phones: iOS zooms into any smaller field it focuses.
        className="mt-3 block w-full resize-none bg-transparent text-base leading-relaxed text-foreground/80 outline-hidden placeholder:text-muted sm:text-[15px]"
      />
    </div>
  );
}
