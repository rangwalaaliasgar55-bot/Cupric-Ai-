import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { AnimatePresence, LayoutGroup, motion } from "motion/react";
import { useReducedMotion } from "@/lib/use-reduced-motion";
import { cn } from "@/lib/cn";
import { usePreviewPlay } from "@/lab/preview-play";

type Mode = "follow" | "following" | "unfollow";

const EASE_OUT = [0.23, 1, 0.32, 1] as const;
// The glyph is two strokes that trade places: a plus, a check, or a cross.
// Each shape is written with the same commands so the paths can morph.
const STROKES: Record<Mode, [string, string]> = {
  follow: ["M12 5 L12 19", "M5 12 L19 12"],
  following: ["M5.5 12.5 L10 17", "M10 17 L18.5 7.5"],
  unfollow: ["M7 7 L17 17", "M17 7 L7 17"],
};
// A quarter turn: the plus looks identical after it, so it reads as the plus
// turning into the check rather than a swap.
const TURN: Record<Mode, number> = { follow: -90, following: 0, unfollow: 0 };
const MORPH = { type: "spring", duration: 0.35, bounce: 0.15 } as const;
// Long enough that sweeping past a Following button never flashes red,
// short enough that someone aiming for it isn't kept waiting.
const UNFOLLOW_DELAY = 450;
const LABELS: Record<Mode, string> = {
  follow: "Follow",
  following: "Following",
  unfollow: "Unfollow",
};

export function FollowButton({
  following,
  onFollowingChange,
  name,
  className,
}: {
  following: boolean;
  onFollowingChange: (following: boolean) => void;
  /** Who is being followed, for the accessible name and announcements. */
  name: string;
  className?: string;
}) {
  const reduceMotion = useReducedMotion();
  const [armed, setArmed] = useState(false);
  const [warning, setWarning] = useState(false);
  const [note, setNote] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const widths = useRef<Record<Mode, HTMLSpanElement | null>>({
    follow: null,
    following: null,
    unfollow: null,
  });
  const [measured, setMeasured] = useState<Record<Mode, number> | null>(null);

  useEffect(() => () => clearTimeout(timer.current), []);

  // Every label is rendered once, invisibly, so the button can glide to the
  // next width before the new word has even faded in.
  useLayoutEffect(() => {
    const measure = () => {
      const w = widths.current;
      if (!w.follow || !w.following || !w.unfollow) return;
      setMeasured({
        follow: w.follow.offsetWidth,
        following: w.following.offsetWidth,
        unfollow: w.unfollow.offsetWidth,
      });
    };
    measure();
    // Web fonts can land after the first measure and change every width.
    let live = true;
    document.fonts?.ready.then(() => live && measure());
    return () => {
      live = false;
    };
  }, []);

  const mode: Mode = !following ? "follow" : warning ? "unfollow" : "following";

  const cancelWarning = () => {
    clearTimeout(timer.current);
    setWarning(false);
  };

  const toggle = () => {
    const next = !following;
    cancelWarning();
    // The pointer is still over the button right after following, so it has
    // to leave and come back before Unfollow can show; otherwise the red
    // state would appear under a cursor that only just clicked.
    setArmed(false);
    onFollowingChange(next);
    setNote(next ? `Following ${name}` : `Unfollowed ${name}`);
  };

  return (
    <span className="relative inline-flex">
      <button
        type="button"
        aria-pressed={following}
        aria-label={`Follow ${name}`}
        onClick={toggle}
        onPointerEnter={(e) => {
          if (e.pointerType === "touch" || !following || !armed) return;
          clearTimeout(timer.current);
          timer.current = setTimeout(() => setWarning(true), UNFOLLOW_DELAY);
        }}
        onPointerLeave={(e) => {
          if (e.pointerType === "touch") return;
          setArmed(true);
          cancelWarning();
        }}
        className={cn(
          "inline-flex h-9 touch-manipulation items-center gap-1.5 rounded-full pr-4 pl-3 text-sm font-medium outline-hidden select-none",
          // Text color is left out on purpose: it flips with the label swap,
          // which the blur already covers, so the word never fades through
          // the mid-grey the fill passes on its way from ink to surface.
          "transition-[scale,background-color,box-shadow] duration-100 ease-out active:scale-[0.96] motion-reduce:transition-[background-color]",
          "focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-foreground",
          mode === "follow" &&
            "bg-foreground text-background hover:bg-foreground/85",
          mode === "following" && "bg-surface text-foreground shadow-raised",
          // The tint is faint on purpose: a warning, not an alarm.
          mode === "unfollow" &&
            "bg-danger/10 text-danger shadow-[0_0_0_1px_color-mix(in_oklab,var(--danger)_25%,transparent)]",
          className,
        )}
      >
        <motion.svg
          viewBox="0 0 24 24"
          className="size-4 shrink-0"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
          initial={false}
          animate={{ rotate: reduceMotion ? 0 : TURN[mode] }}
          transition={MORPH}
        >
          {STROKES[mode].map((d, i) => (
            <motion.path
              key={i}
              initial={false}
              animate={{ d }}
              transition={reduceMotion ? { duration: 0 } : MORPH}
            />
          ))}
        </motion.svg>

        {/* Width is animated (not scale) so the words never stretch; it is a
            single inline element, so the reflow is cheap. */}
        <span
          aria-hidden
          className="relative grid h-5 overflow-hidden transition-[width] duration-[250ms] ease-[cubic-bezier(0.23,1,0.32,1)] motion-reduce:transition-none"
          style={measured ? { width: measured[mode] } : undefined}
        >
          <AnimatePresence initial={false} mode="popLayout">
            <motion.span
              key={mode}
              className="col-start-1 row-start-1 whitespace-nowrap leading-5"
              initial={{
                opacity: 0,
                y: reduceMotion ? 0 : 4,
                filter: reduceMotion ? "blur(0px)" : "blur(4px)",
              }}
              animate={{
                opacity: 1,
                y: 0,
                filter: "blur(0px)",
                transition: { duration: 0.22, ease: EASE_OUT },
              }}
              // Leaves in half the time, so the old word is gone before the
              // new one is legible and they never read as overlapping.
              exit={{
                opacity: 0,
                y: reduceMotion ? 0 : -2,
                filter: reduceMotion ? "blur(0px)" : "blur(4px)",
                transition: { duration: 0.11, ease: EASE_OUT },
              }}
            >
              {LABELS[mode]}
            </motion.span>
          </AnimatePresence>
          {/* The rulers: out of flow and invisible, measured once. */}
          {(Object.keys(LABELS) as Mode[]).map((m) => (
            <span
              key={m}
              ref={(el) => {
                widths.current[m] = el;
              }}
              className="invisible absolute top-0 left-0 whitespace-nowrap"
            >
              {LABELS[m]}
            </span>
          ))}
        </span>
      </button>
      <span className="sr-only" aria-live="polite">
        {note}
      </span>
    </span>
  );
}

const FADE = { duration: 0.25, ease: EASE_OUT } as const;
const SLIDE = { type: "spring", duration: 0.35, bounce: 0.25 } as const;

const PEOPLE = [
  { name: "Ava", src: "/avatars/ava.svg" },
  { name: "Ben", src: "/avatars/ben.svg" },
  { name: "Cara", src: "/avatars/cara.svg" },
];
const YOU = { name: "You", src: "/avatars/dev.svg" };

function AvatarStack({ withYou, fit }: { withYou: boolean; fit: boolean }) {
  const reduceMotion = useReducedMotion();
  const people = withYou ? [...PEOPLE, YOU] : PEOPLE;
  return (
    // Right aligned in a slot sized for four, so your face grows the stack
    // leftward into empty space and nothing next to it shifts. `fit` drops
    // the slot so a centred preview has no empty gap on one side.
    <ul
      className={cn("flex justify-end", !fit && "w-[82px]")}
      aria-label="Followers you know"
    >
      <AnimatePresence initial={false}>
        {people.map((p) => (
          <motion.li
            key={p.name}
            layout={reduceMotion ? false : "position"}
            className="-ml-2 first:ml-0"
            initial={{
              opacity: 0,
              scale: 0.6,
              filter: reduceMotion ? "blur(0px)" : "blur(4px)",
            }}
            animate={{
              opacity: 1,
              scale: 1,
              filter: "blur(0px)",
            }}
            exit={{
              opacity: 0,
              scale: 0.8,
              filter: reduceMotion ? "blur(0px)" : "blur(2px)",
              transition: { duration: 0.15, ease: EASE_OUT },
            }}
            // A spring overshoots, and blur below zero is invalid, so the
            // blur and fade get a plain ease.
            transition={{ ...SLIDE, filter: FADE, opacity: FADE }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- tiny local SVGs, nothing for next/image to optimize */}
            <img
              src={p.src}
              alt={p.name}
              width={28}
              height={28}
              draggable={false}
              className="block size-7 rounded-full bg-[oklch(0.97_0_0)] ring-2 ring-background"
            />
          </motion.li>
        ))}
      </AnimatePresence>
    </ul>
  );
}

// The index card's hover show: follow, let your face join the stack and the
// check settle, then unfollow. Waits in ms.
const SHOW_FOLLOW = 350;
const SHOW_UNFOLLOW = 2600;
const SHOW_REST = 1500;

export default function FollowButtonDemo() {
  const [following, setFollowing] = useState(false);
  const play = usePreviewPlay();
  const preview = play !== null;
  const reduceMotion = useReducedMotion();

  useEffect(() => {
    if (play !== true) return;
    let timer: ReturnType<typeof setTimeout>;
    const cycle = (wait: number) => {
      timer = setTimeout(() => {
        setFollowing(true);
        timer = setTimeout(() => {
          setFollowing(false);
          cycle(SHOW_REST);
        }, SHOW_UNFOLLOW);
      }, wait);
    };
    cycle(SHOW_FOLLOW);
    return () => {
      clearTimeout(timer);
      setFollowing(false);
    };
  }, [play]);

  return (
    // On its own page the button's left edge is fixed and it grows
    // rightward, so the thing you click never slides out from under the
    // cursor. Nobody clicks the index card's copy, so there the pair sits
    // centred with no reserved gaps and grows evenly both ways.
    <div
      className={cn(
        "flex max-w-full items-center gap-3",
        preview ? "justify-center" : "w-[260px]",
      )}
    >
      {/* Centred, a face joining the stack would shove the button sideways
          in one frame; the group lets the button glide over with the
          avatars instead. */}
      <LayoutGroup>
        <AvatarStack withYou={following} fit={preview} />
        <motion.span
          layout={preview && !reduceMotion ? "position" : false}
          transition={SLIDE}
          className="inline-flex"
        >
          <FollowButton
            name="Mira Okafor"
            following={following}
            onFollowingChange={setFollowing}
          />
        </motion.span>
      </LayoutGroup>
    </div>
  );
}
