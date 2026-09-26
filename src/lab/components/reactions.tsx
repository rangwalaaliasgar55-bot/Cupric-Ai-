import { useEffect, useRef, useState } from "react";
import { AnimatePresence, LayoutGroup, motion } from "motion/react";
import { useReducedMotion } from "@/lib/use-reduced-motion";
import { usePreviewPlay } from "@/lab/preview-play";
import { cn } from "@/lib/cn";

export type Reaction = { emoji: string; count: number; mine: boolean };

const EASE_OUT = [0.23, 1, 0.32, 1] as const;
// The picked emoji's flight into its pill: quick, with a small settle.
const FLIGHT = { type: "spring", duration: 0.5, bounce: 0.2 } as const;
const SHIFT = { type: "spring", duration: 0.35, bounce: 0.1 } as const;

const NAMES: Record<string, string> = {
  "👍": "thumbs up",
  "❤️": "heart",
  "😂": "laughing",
  "🎉": "party popper",
  "👀": "eyes",
  "🙏": "thank you",
};
const CHOICES = Object.keys(NAMES);

// State for a reaction row: toggling your own reaction on a pill, and
// picking one from the picker, which flies the emoji into its pill.
export function useReactions(initial: Reaction[]) {
  const [reactions, setReactions] = useState(initial);
  const [open, setOpen] = useState(false);
  const [landing, setLanding] = useState<string | null>(null);
  const landTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(landTimer.current), []);

  const toggle = (emoji: string) =>
    setReactions((rs) => {
      const found = rs.find((r) => r.emoji === emoji);
      if (!found) return [...rs, { emoji, count: 1, mine: true }];
      return rs
        .map((r) =>
          r.emoji === emoji
            ? { ...r, mine: !r.mine, count: r.count + (r.mine ? -1 : 1) }
            : r,
        )
        .filter((r) => r.count > 0);
    });

  const pick = (emoji: string) => {
    setLanding(emoji);
    setOpen(false);
    // Picking one you've already added takes it back, as tapping its pill
    // would; picking a new one adds you.
    toggle(emoji);
    clearTimeout(landTimer.current);
    landTimer.current = setTimeout(() => setLanding(null), 700);
  };

  const reset = () => {
    clearTimeout(landTimer.current);
    setReactions(initial);
    setOpen(false);
    setLanding(null);
  };

  return { reactions, open, setOpen, landing, toggle, pick, reset };
}

export function Reactions({
  reactions,
  open,
  onOpenChange,
  landing,
  onToggle,
  onPick,
  className,
}: {
  reactions: Reaction[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  landing: string | null;
  onToggle: (emoji: string) => void;
  onPick: (emoji: string) => void;
  className?: string;
}) {
  const reduceMotion = useReducedMotion();
  const row = useRef<HTMLDivElement>(null);
  const plus = useRef<HTMLButtonElement>(null);
  const firstChoice = useRef<HTMLButtonElement>(null);
  const usingKeys = useRef(false);
  const [origin, setOrigin] = useState(0);

  const shift = reduceMotion ? { duration: 0 } : SHIFT;

  // Closes on Escape or a press anywhere else.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!row.current?.contains(e.target as Node)) onOpenChange(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      onOpenChange(false);
      plus.current?.focus();
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, onOpenChange]);

  return (
    <LayoutGroup>
      <div
        ref={row}
        onPointerDownCapture={() => (usingKeys.current = false)}
        onKeyDownCapture={() => (usingKeys.current = true)}
        className={cn("relative flex flex-wrap items-center gap-1.5", className)}
      >
        <AnimatePresence initial={false} mode="popLayout">
          {reactions.map((r) => (
            <motion.button
              key={r.emoji}
              layout
              type="button"
              aria-pressed={r.mine}
              aria-label={`${NAMES[r.emoji] ?? r.emoji}, ${r.count} ${r.count === 1 ? "person" : "people"}${r.mine ? ", including you" : ""}`}
              onClick={() => onToggle(r.emoji)}
              // A new pill opens where it lands; an emptied one folds away.
              initial={{ opacity: 0, scale: 0.6, filter: "blur(4px)" }}
              animate={{ opacity: 1, scale: 1, filter: "blur(0px)" }}
              exit={{
                opacity: 0,
                scale: 0.6,
                filter: "blur(4px)",
                transition: { duration: 0.15 },
              }}
              transition={shift}
              style={{ borderRadius: 999 }}
              className={cn(
                "flex h-8 items-center gap-1.5 px-2.5 text-[13px] font-medium tabular-nums outline-hidden transition-[background-color,box-shadow,color,scale] duration-150 ease-out focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-solid focus-visible:outline-foreground active:scale-[0.96]",
                r.mine
                  ? "bg-marker/10 text-foreground shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--marker)_45%,transparent)]"
                  : "bg-surface text-muted shadow-[inset_0_0_0_1px_var(--border)] hover:text-foreground",
              )}
            >
              <motion.span
                layoutId={landing === r.emoji ? `fly-${r.emoji}` : undefined}
                layoutCrossfade={false}
                transition={reduceMotion ? { duration: 0 } : FLIGHT}
                className="text-[15px] leading-none"
              >
                {r.emoji}
              </motion.span>
              <Count n={r.count} />
            </motion.button>
          ))}
        </AnimatePresence>

        <motion.button
          ref={plus}
          layout
          transition={shift}
          type="button"
          aria-label="Add reaction"
          aria-expanded={open}
          onClick={() => {
            const btn = plus.current;
            if (btn) setOrigin(btn.offsetLeft + btn.offsetWidth / 2);
            const next = !open;
            onOpenChange(next);
            if (next && usingKeys.current) {
              requestAnimationFrame(() => firstChoice.current?.focus());
            }
          }}
          style={{ borderRadius: 999 }}
          className={cn(
            "grid h-8 w-9 place-items-center text-muted outline-hidden transition-[background-color,color,scale] duration-150 ease-out hover:bg-surface hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-solid focus-visible:outline-foreground active:scale-[0.96]",
            open && "bg-surface text-foreground",
          )}
        >
          <svg
            viewBox="0 0 16 16"
            className="size-4"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.4}
            strokeLinecap="round"
            aria-hidden
          >
            <circle cx="7.5" cy="8.5" r="5.25" />
            <path d="M5.6 9.9c.5.6 1.2.95 1.9.95s1.4-.35 1.9-.95M5.9 7h.01M9.1 7h.01" strokeWidth={1.5} />
            <path d="M13 1.75v3.5M11.25 3.5h3.5" />
          </svg>
        </motion.button>

        {/* Opens just below the row, in the clear rather than over the
            message, aligned to the row so it never runs off a narrow card,
            and grows from the button that asked for it. */}
        <AnimatePresence>
          {open && (
            <motion.div
              role="group"
              aria-label="Pick a reaction"
              initial={{ opacity: 0, scale: 0.9, y: -4, filter: "blur(4px)" }}
              animate={{ opacity: 1, scale: 1, y: 0, filter: "blur(0px)" }}
              exit={{
                opacity: 0,
                scale: 0.95,
                y: -2,
                filter: "blur(2px)",
                transition: { duration: 0.12 },
              }}
              transition={
                reduceMotion ? { duration: 0 } : { duration: 0.2, ease: EASE_OUT }
              }
              style={{ transformOrigin: `${origin}px 0%` }}
              className="absolute top-full left-0 z-10 mt-2 flex gap-0.5 rounded-full bg-background p-1 shadow-raised"
            >
              {CHOICES.map((emoji, i) => (
                <button
                  key={emoji}
                  ref={i === 0 ? firstChoice : undefined}
                  type="button"
                  aria-label={`React with ${NAMES[emoji]}`}
                  onClick={() => onPick(emoji)}
                  className="grid size-9 place-items-center rounded-full outline-hidden transition-[background-color,scale] duration-150 ease-out hover:bg-surface focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-solid focus-visible:outline-foreground active:scale-[0.9]"
                >
                  <motion.span
                    layoutId={`fly-${emoji}`}
                    className="text-[19px] leading-none"
                  >
                    {emoji}
                  </motion.span>
                </button>
              ))}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </LayoutGroup>
  );
}

// The count rolls the way it moved: up when you add yours, down when you
// take it back.
function Count({ n }: { n: number }) {
  const [seen, setSeen] = useState({ n, dir: 1 });
  if (seen.n !== n) setSeen({ n, dir: n > seen.n ? 1 : -1 });
  const dir = seen.n !== n ? (n > seen.n ? 1 : -1) : seen.dir;

  return (
    <span className="relative inline-flex overflow-hidden">
      <AnimatePresence initial={false} mode="popLayout" custom={dir}>
        <motion.span
          key={n}
          custom={dir}
          variants={{
            enter: (d: number) => ({ y: d * 10, opacity: 0 }),
            center: { y: 0, opacity: 1 },
            exit: (d: number) => ({ y: d * -10, opacity: 0 }),
          }}
          initial="enter"
          animate="center"
          exit="exit"
          transition={{ duration: 0.22, ease: EASE_OUT }}
        >
          {n}
        </motion.span>
      </AnimatePresence>
    </span>
  );
}

const INITIAL: Reaction[] = [
  { emoji: "🎉", count: 5, mine: true },
  { emoji: "👍", count: 12, mine: false },
  { emoji: "👀", count: 2, mine: false },
];

export default function ReactionsDemo() {
  const play = usePreviewPlay();
  const r = useReactions(INITIAL);
  const api = useRef(r);
  useEffect(() => {
    api.current = r;
  });

  // The card's hover show: a thumbs up, a heart from the picker, then both
  // taken back.
  useEffect(() => {
    if (play !== true) return;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const at = (ms: number, fn: () => void) => timers.push(setTimeout(fn, ms));
    const run = () => {
      at(400, () => api.current.toggle("👍"));
      at(1300, () => api.current.setOpen(true));
      at(2100, () => api.current.pick("❤️"));
      at(3700, () => api.current.toggle("❤️"));
      at(4400, () => api.current.toggle("👍"));
      at(5600, run);
    };
    run();
    return () => {
      timers.forEach(clearTimeout);
      api.current.reset();
    };
  }, [play]);

  return (
    <div className="w-[min(420px,100%)] rounded-2xl bg-background p-5 shadow-raised">
      <div className="flex items-center gap-2.5">
        <span
          aria-hidden
          className="grid size-8 place-items-center rounded-full bg-surface text-[12px] font-semibold text-foreground shadow-[inset_0_0_0_1px_var(--border)]"
        >
          MR
        </span>
        <p className="text-[14px] font-medium text-foreground">Maya Ruiz</p>
        <p className="text-[13px] text-muted">2m</p>
      </div>
      <p className="mt-3 text-[15px] leading-relaxed text-pretty text-foreground/85">
        Shipped the new onboarding flow. Thanks everyone for the reviews, it
        feels so much calmer now.
      </p>
      <Reactions
        className="mt-4"
        reactions={r.reactions}
        open={r.open}
        onOpenChange={r.setOpen}
        landing={r.landing}
        onToggle={r.toggle}
        onPick={r.pick}
      />
    </div>
  );
}
