import { useEffect, useId, useRef, useState } from "react";
import { AnimatePresence, LayoutGroup, motion } from "motion/react";
import { useReducedMotion } from "@/lib/use-reduced-motion";
import { cn } from "@/lib/cn";

export type ExpandingCardItem = {
  id: string;
  title: string;
  meta: string;
  summary: string;
  detail: string;
};

// No bounce: a card overshooting its own slot reads as a glitch, not play.
const MORPH = { type: "spring", duration: 0.35, bounce: 0 } as const;
const EASE_OUT = [0.23, 1, 0.32, 1] as const;
// Held until the morph has visibly settled, so the paragraph never shows
// while its box is still being scaled and can't appear to reflow.
const DETAIL_DELAY = 0.25;
// Closing is quicker to read, so the card's summary returns a little sooner.
const RETURN_DELAY = 0.2;
// The radius grows with the surface: 18px suits an 80px card, 24px the
// larger dialog, and Motion animates between them.
const CARD_RADIUS = 18;
const DIALOG_RADIUS = 24;

export function ExpandingCards({
  items,
  className,
}: {
  items: ExpandingCardItem[];
  className?: string;
}) {
  const reduceMotion = !!useReducedMotion();
  const group = useId();
  const [openId, setOpenId] = useState<string | null>(null);
  // The card collapsing back rises above the fading backdrop and its
  // siblings until it lands, then drops to the normal layer.
  const [returningId, setReturningId] = useState<string | null>(null);
  const cardRefs = useRef(new Map<string, HTMLButtonElement>());
  const closeRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const lastOpened = useRef<string | null>(null);

  const open = openId ? items.find((item) => item.id === openId) : undefined;

  const show = (id: string) => {
    lastOpened.current = id;
    setReturningId(null);
    setOpenId(id);
  };

  const close = () => {
    setReturningId(openId);
    setOpenId(null);
  };

  useEffect(() => {
    if (openId) {
      closeRef.current?.focus({ preventScroll: true });
      const onKey = (e: KeyboardEvent) => {
        if (e.key !== "Escape") return;
        e.preventDefault();
        setReturningId(openId);
        setOpenId(null);
      };
      document.addEventListener("keydown", onKey);
      return () => document.removeEventListener("keydown", onKey);
    }
    // The card remounts in the commit that closes the dialog, so its ref is
    // ready by the time this runs.
    const id = lastOpened.current;
    if (id) cardRefs.current.get(id)?.focus({ preventScroll: true });
  }, [openId]);

  // Keeps Tab inside the dialog, as aria-modal promises.
  const trapTab = (e: React.KeyboardEvent) => {
    if (e.key !== "Tab" || !dialogRef.current) return;
    const focusable = Array.from(
      dialogRef.current.querySelectorAll<HTMLElement>(
        "button, [href], input, textarea, select, [tabindex]:not([tabindex='-1'])",
      ),
    );
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  // Without a layoutId there is nothing to morph, which is exactly the
  // reduced motion path: the views simply cross-fade in place.
  const shared = (key: string) => (reduceMotion ? undefined : key);
  const titleId = `${group}-title`;

  return (
    <LayoutGroup id={group}>
      <div className={cn("relative w-[400px] max-w-full", className)}>
        <ul className="flex flex-col gap-3" inert={!!openId}>
          {items.map((item) => (
            <li key={item.id}>
              {item.id === openId ? (
                // Holds the slot at the card's exact size so the list never
                // jumps, and marks where the card will return to.
                <div
                  aria-hidden
                  className="bg-foreground/[0.03] shadow-[inset_0_0_0_1px_var(--border)]"
                  style={{ borderRadius: CARD_RADIUS }}
                >
                  <div className="invisible">
                    <CardFace item={item} />
                  </div>
                </div>
              ) : (
                <motion.button
                  ref={(node) => {
                    if (node) cardRefs.current.set(item.id, node);
                    else cardRefs.current.delete(item.id);
                  }}
                  type="button"
                  aria-haspopup="dialog"
                  layoutId={shared(`card-${item.id}`)}
                  // A crossfade would show the outgoing view squashed
                  // mid-flight; one element morphing reads cleaner.
                  layoutCrossfade={false}
                  transition={MORPH}
                  onClick={() => show(item.id)}
                  onLayoutAnimationComplete={() =>
                    setReturningId((id) => (id === item.id ? null : id))
                  }
                  // Radius lives in style so layout animation can correct it
                  // for the scale instead of letting the corners stretch.
                  style={{ borderRadius: CARD_RADIUS }}
                  className={cn(
                    "relative block w-full touch-manipulation bg-surface text-left shadow-raised outline-hidden transition-[scale] duration-150 ease-out select-none focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-foreground active:scale-[0.96] motion-reduce:transition-none",
                    returningId === item.id && "z-50",
                  )}
                >
                  <CardFace
                    item={item}
                    shared={shared}
                    returning={returningId === item.id && !reduceMotion}
                  />
                </motion.button>
              )}
            </li>
          ))}
        </ul>

        <AnimatePresence>
          {open && (
            <motion.div
              key="backdrop"
              aria-hidden
              className="fixed inset-0 z-40 bg-foreground/15 dark:bg-background/70"
              initial={{ opacity: 0 }}
              animate={{
                opacity: 1,
                transition: { duration: 0.2, ease: EASE_OUT },
              }}
              // Leaves faster than it came so the returning card is the
              // only thing the eye follows.
              exit={{
                opacity: 0,
                transition: { duration: 0.15, ease: EASE_OUT },
              }}
              onClick={close}
            />
          )}
        </AnimatePresence>

        {/* Flex centres the dialog without a transform, which layout
            animation would overwrite. It is wider than the list and
            overflows both sides evenly. */}
        <div className="pointer-events-none absolute inset-0 z-50 flex items-center justify-center">
          <AnimatePresence>
            {open && (
              <motion.div
                key={open.id}
                ref={dialogRef}
                role="dialog"
                aria-modal="true"
                aria-labelledby={titleId}
                layoutId={shared(`card-${open.id}`)}
                layoutCrossfade={false}
                transition={MORPH}
                initial={reduceMotion ? { opacity: 0 } : undefined}
                animate={
                  reduceMotion
                    ? {
                        opacity: 1,
                        transition: { duration: 0.15, ease: EASE_OUT },
                      }
                    : undefined
                }
                exit={
                  reduceMotion
                    ? {
                        opacity: 0,
                        transition: { duration: 0.1, ease: EASE_OUT },
                      }
                    : undefined
                }
                onKeyDown={trapTab}
                style={{ borderRadius: DIALOG_RADIUS }}
                className="pointer-events-auto w-[440px] max-w-[calc(100vw-2rem)] shrink-0 bg-surface p-6 shadow-raised"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex flex-col items-start gap-1">
                    <motion.h2
                      id={titleId}
                      {...sharedText(shared(`title-${open.id}`))}
                      className="text-[15px] font-medium text-foreground"
                    >
                      {open.title}
                    </motion.h2>
                    <motion.p
                      {...sharedText(shared(`meta-${open.id}`))}
                      className="text-[13px] text-muted tabular-nums"
                    >
                      {open.meta}
                    </motion.p>
                  </div>
                  <Delayed reduceMotion={reduceMotion}>
                    <button
                      ref={closeRef}
                      type="button"
                      aria-label="Close"
                      onClick={close}
                      className={cn(
                        "relative -mt-2 -mr-2 flex size-8 touch-manipulation items-center justify-center rounded-full text-muted outline-hidden transition-[scale,color,background-color] duration-150 ease-out hover:bg-background hover:text-foreground focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-foreground active:scale-[0.96] motion-reduce:transition-[color,background-color]",
                        // Grows the hit area to 44px around the 32px circle.
                        "after:absolute after:-inset-1.5 after:rounded-full",
                      )}
                    >
                      <svg
                        viewBox="0 0 16 16"
                        className="size-[18px]"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth={1.5}
                        strokeLinecap="round"
                        aria-hidden
                      >
                        <path d="m4.5 4.5 7 7M11.5 4.5l-7 7" />
                      </svg>
                    </button>
                  </Delayed>
                </div>
                {/* Not shared with the card: there the summary is cut off
                    with an ellipsis, so flying it across would snap the
                    hidden words in. It arrives with the detail instead. */}
                <Delayed reduceMotion={reduceMotion}>
                  <p className="mt-4 text-[15px] text-muted">{open.summary}</p>
                  <p className="mt-2.5 text-[15px] leading-6 text-pretty text-muted">
                    {open.detail}
                  </p>
                </Delayed>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </LayoutGroup>
  );
}

// Text flies to its new spot by position only. Letting it scale with its
// box would squash the glyphs whenever the box changes aspect.
function sharedText(layoutId: string | undefined) {
  return {
    layoutId,
    layoutCrossfade: false,
    layout: "position" as const,
    transition: MORPH,
  };
}

// Content that only exists in the expanded view. It waits out the morph on
// the way in, then comes into focus: the blur bridges nothing to text so it
// reads as arriving rather than blinking on. On the way out the whole dialog
// is swapped for the card at once, so it never needs an exit of its own.
function Delayed({
  reduceMotion,
  children,
}: {
  reduceMotion: boolean;
  children: React.ReactNode;
}) {
  return (
    <motion.div
      initial={
        reduceMotion
          ? { opacity: 0 }
          : { opacity: 0, y: 4, filter: "blur(4px)" }
      }
      animate={{
        opacity: 1,
        y: 0,
        filter: "blur(0px)",
        transition: {
          delay: reduceMotion ? 0 : DETAIL_DELAY,
          duration: 0.25,
          ease: EASE_OUT,
        },
      }}
    >
      {children}
    </motion.div>
  );
}

function CardFace({
  item,
  shared,
  returning = false,
}: {
  item: ExpandingCardItem;
  shared?: (key: string) => string | undefined;
  returning?: boolean;
}) {
  // The invisible slot copy renders without layoutIds, so it can never
  // compete with the real card for a shared element.
  const Text = shared ? motion.span : "span";
  const props = (key: string) =>
    shared ? sharedText(shared(`${key}-${item.id}`)) : {};

  return (
    <span className="flex flex-col items-start gap-1.5 px-4.5 py-4">
      <span className="flex w-full items-baseline justify-between gap-4">
        <Text
          {...props("title")}
          className="truncate text-[15px] font-medium text-foreground"
        >
          {item.title}
        </Text>
        <Text
          {...props("meta")}
          className="shrink-0 text-[13px] text-muted tabular-nums"
        >
          {item.meta}
        </Text>
      </span>
      {shared ? (
        // Layout-aware so Motion corrects it for the card's scale; a plain
        // child would stretch with the card as it shrinks back into its
        // slot. It isn't shared with the dialog, so on the way back it
        // comes into focus once the card has nearly landed.
        <motion.span
          layout="position"
          transition={MORPH}
          initial={returning ? { opacity: 0, filter: "blur(4px)" } : false}
          animate={{
            opacity: 1,
            filter: "blur(0px)",
            transition: { delay: RETURN_DELAY, duration: 0.2, ease: EASE_OUT },
          }}
          className="max-w-full truncate text-sm text-muted"
        >
          {item.summary}
        </motion.span>
      ) : (
        <span className="max-w-full truncate text-sm text-muted">
          {item.summary}
        </span>
      )}
    </span>
  );
}

const notes: ExpandingCardItem[] = [
  {
    id: "layouts",
    title: "Shared layouts",
    meta: "Sep 18",
    summary: "Cards morph into their detail view.",
    detail:
      "Give two elements the same layoutId and Motion animates one into the other, measuring both boxes and bridging them with transforms.",
  },
  {
    id: "springs",
    title: "Spring timing",
    meta: "Aug 30",
    summary: "Springs take a duration and bounce.",
    detail:
      "Describe a spring by how long it should feel and how much it should overshoot, instead of tuning stiffness and damping by hand.",
  },
  {
    id: "motion",
    title: "Reduced motion",
    meta: "Aug 12",
    summary: "Morphs become a plain swap.",
    detail:
      "When the system asks for less motion, the card and its detail view cross-fade in place with nothing flying across the screen.",
  },
];

export default function ExpandingCardDemo() {
  return <ExpandingCards items={notes} />;
}
