import {
  createContext,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { AnimatePresence, motion } from "motion/react";
import { useReducedMotion } from "@/lib/use-reduced-motion";
import { cn } from "@/lib/cn";

export type Profile = {
  id: string;
  name: string;
  handle: string;
  avatar: string;
  bio: string;
  followers: number;
  following: number;
};

// Long enough that sweeping the pointer across a paragraph opens nothing.
const OPEN_DELAY = 500;
// Covers the moment the pointer is between the link and the card, or
// wobbles off an edge.
const CLOSE_GRACE = 150;
// Just after a card closes, hovering another name skips the delay: the
// reader is clearly browsing people, not passing through.
const SKIP_DELAY_FOR = 300;
const CARD_WIDTH = 300;
// Close to the rendered height; only used to decide above or below.
const CARD_HEIGHT = 200;
const GAP = 8;
// Keeps the card this far from the viewport edges.
const EDGE = 12;
const EASE_OUT = [0.23, 1, 0.32, 1] as const;

type Place = { side: "top" | "bottom"; left: number; originX: number };
type Custom = { instant: boolean; reduce: boolean };

// Instant cards skip both the fade and the scale, per the tooltip rule.
// Exits are faster than entrances so a closing card never holds the eye.
const CARD = {
  hidden: ({ instant, reduce }: Custom) => ({
    opacity: instant ? 1 : 0,
    scale: instant || reduce ? 1 : 0.96,
  }),
  shown: ({ instant }: Custom) => ({
    opacity: 1,
    scale: 1,
    transition: instant ? { duration: 0 } : { duration: 0.15, ease: EASE_OUT },
  }),
  exit: ({ instant, reduce }: Custom) => ({
    opacity: 0,
    scale: reduce ? 1 : 0.96,
    transition: { duration: instant ? 0 : 0.1, ease: EASE_OUT },
  }),
};
// `from` is where the previous card sat on screen when this one replaced it:
// the new card starts there and travels to its own name.
type OpenState = {
  id: string;
  place: Place;
  instant: boolean;
  from?: DOMRect;
} | null;

// The trip between two names. 260ms on the iOS drawer curve: long enough to
// follow a card crossing a paragraph, and it decelerates onto the new name
// so the eye lands with it.
const TRAVEL = { duration: 260, easing: "cubic-bezier(0.32, 0.72, 0, 1)" };
// The contents re-develop on arrival instead of swapping in place.
const DEVELOP = { duration: 220, easing: "cubic-bezier(0.23, 1, 0.32, 1)" };

type Group = {
  open: OpenState;
  // Registers the card on screen, so the next one knows where to start.
  setCard: (el: HTMLElement) => void;
  requestOpen: (id: string, measure: () => Place, immediate?: boolean) => void;
  requestClose: (id: string) => void;
  closeNow: () => void;
};

const GroupContext = createContext<Group | null>(null);

function measurePlace(el: HTMLElement): Place {
  const rect = el.getBoundingClientRect();
  const below = window.innerHeight - rect.bottom;
  const side =
    below >= CARD_HEIGHT + GAP + EDGE || below >= rect.top ? "bottom" : "top";
  const width = Math.min(CARD_WIDTH, window.innerWidth - EDGE * 2);
  const centred = rect.left + rect.width / 2 - width / 2;
  const clamped = Math.min(
    Math.max(centred, EDGE),
    window.innerWidth - EDGE - width,
  );
  return {
    side,
    left: clamped - rect.left,
    // Scales out of the link itself, even when the card is pushed sideways.
    originX: rect.left + rect.width / 2 - clamped,
  };
}

// Shares one open card between every mention inside it, which is what lets
// a second name open instantly while a first card is showing.
export function HoverCardGroup({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState<OpenState>(null);
  const openRef = useRef<OpenState>(null);
  const openTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const closeTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const closedAt = useRef(-Infinity);
  const card = useRef<HTMLElement | null>(null);
  // Where the last card was when it closed, for a quick return trip.
  const lastRect = useRef<DOMRect | null>(null);

  useEffect(
    () => () => {
      clearTimeout(openTimer.current);
      clearTimeout(closeTimer.current);
    },
    [],
  );

  const cardRect = () =>
    card.current?.isConnected
      ? card.current.getBoundingClientRect()
      : undefined;

  const commit = (next: OpenState) => {
    if (openRef.current && !next) {
      closedAt.current = performance.now();
      lastRect.current = cardRect() ?? null;
    }
    openRef.current = next;
    setOpen(next);
  };

  const group: Group = {
    open,
    setCard: (el) => {
      card.current = el;
    },
    requestOpen: (id, measure, immediate) => {
      clearTimeout(closeTimer.current);
      const current = openRef.current;
      if (current?.id === id) return;
      clearTimeout(openTimer.current);
      const recent = performance.now() - closedAt.current < SKIP_DELAY_FOR;
      if (current) {
        // Already showing someone: no delay, and the card itself moves over.
        commit({ id, place: measure(), instant: true, from: cardRect() });
      } else if (recent && lastRect.current) {
        // Closed a moment ago on the way here: fly back out from there.
        commit({ id, place: measure(), instant: true, from: lastRect.current });
      } else if (immediate || recent) {
        commit({ id, place: measure(), instant: false });
      } else {
        openTimer.current = setTimeout(
          () => commit({ id, place: measure(), instant: false }),
          OPEN_DELAY,
        );
      }
    },
    requestClose: (id) => {
      clearTimeout(openTimer.current);
      if (openRef.current?.id !== id) return;
      clearTimeout(closeTimer.current);
      closeTimer.current = setTimeout(() => commit(null), CLOSE_GRACE);
    },
    closeNow: () => {
      clearTimeout(openTimer.current);
      clearTimeout(closeTimer.current);
      if (openRef.current) commit(null);
    },
  };

  return <GroupContext value={group}>{children}</GroupContext>;
}

export function Mention({ profile }: { profile: Profile }) {
  const group = useContext(GroupContext);
  if (!group) throw new Error("Mention must be inside a HoverCardGroup");
  const reduceMotion = useReducedMotion();
  const cardId = useId();
  const rootRef = useRef<HTMLSpanElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const lastPointer = useRef("mouse");
  const [following, setFollowing] = useState(false);

  const state = group.open?.id === profile.id ? group.open : null;
  const isOpen = state !== null;
  // Held so the card can still be positioned while it animates out.
  const [lastPlace, setLastPlace] = useState<Place | null>(null);
  if (state && state.place !== lastPlace) setLastPlace(state.place);
  const place = state?.place ?? lastPlace;

  const measure = () => measurePlace(buttonRef.current!);
  const cardRef = useRef<HTMLSpanElement>(null);
  const contentRef = useRef<HTMLSpanElement>(null);
  const from = state?.from;

  // Plays the trip from the previous card's spot. Uses the independent
  // translate property, so it never fights Motion's scale on transform.
  useLayoutEffect(() => {
    const el = cardRef.current;
    if (!from || !el) return;
    const to = el.getBoundingClientRect();
    const dx = from.left - to.left;
    const dy = from.top - to.top;
    const animations: Animation[] = [];
    if (!reduceMotion && (dx || dy)) {
      animations.push(
        el.animate({ translate: [`${dx}px ${dy}px`, "0 0"] }, TRAVEL),
      );
    }
    animations.push(
      contentRef.current!.animate(
        reduceMotion
          ? { opacity: [0, 1] }
          : { opacity: [0, 1], filter: ["blur(4px)", "blur(0px)"] },
        DEVELOP,
      ),
    );
    return () => animations.forEach((a) => a.cancel());
  }, [from, reduceMotion]);

  // Taps have no hover, so a tap opens the card and a tap anywhere else
  // closes it.
  useEffect(() => {
    if (!isOpen) return;
    const onDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) group.closeNow();
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [isOpen, group]);

  const reduce = !!reduceMotion;
  // Exits read this from AnimatePresence, since the exiting card itself is
  // no longer re-rendered: instant when another card is taking its place.
  const exitCustom: Custom = { instant: group.open !== null, reduce };
  const cardCustom: Custom = { instant: state?.instant ?? false, reduce };

  return (
    <span
      ref={rootRef}
      className="relative inline-block"
      onPointerEnter={(e) => {
        if (e.pointerType !== "touch") group.requestOpen(profile.id, measure);
      }}
      onPointerLeave={(e) => {
        if (e.pointerType !== "touch") group.requestClose(profile.id);
      }}
      // Keyboard focus only. A tap also focuses the button, and opening
      // here would let the click that follows close it again.
      onFocus={(e) => {
        if (
          e.target === buttonRef.current &&
          e.target.matches(":focus-visible")
        )
          group.requestOpen(profile.id, measure, true);
      }}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null))
          group.requestClose(profile.id);
      }}
      onKeyDown={(e) => {
        if (e.key !== "Escape" || !isOpen) return;
        e.stopPropagation();
        group.closeNow();
        buttonRef.current?.focus();
      }}
    >
      <button
        ref={buttonRef}
        type="button"
        aria-expanded={isOpen}
        aria-controls={isOpen ? cardId : undefined}
        onPointerDown={(e) => {
          lastPointer.current = e.pointerType;
        }}
        onClick={(e) => {
          // A mouse has already opened it by hovering; taps and keys toggle.
          const toggles = e.detail === 0 || lastPointer.current === "touch";
          if (isOpen && toggles) group.closeNow();
          else group.requestOpen(profile.id, measure, true);
        }}
        className="rounded-[4px] font-medium whitespace-nowrap text-foreground underline decoration-foreground/25 decoration-1 underline-offset-4 outline-hidden transition-[text-decoration-color] duration-150 ease-out hover:decoration-foreground focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-foreground aria-expanded:decoration-foreground"
      >
        {profile.handle}
      </button>

      <AnimatePresence initial={false} custom={exitCustom}>
        {isOpen && place && (
          <motion.span
            key="card"
            ref={(el: HTMLSpanElement | null) => {
              cardRef.current = el;
              if (el) group.setCard(el);
            }}
            id={cardId}
            role="group"
            aria-label={`${profile.name}, ${profile.handle}`}
            custom={cardCustom}
            variants={CARD}
            initial="hidden"
            animate="shown"
            exit="exit"
            style={{
              left: place.left,
              transformOrigin: `${place.originX}px ${place.side === "bottom" ? "0%" : "100%"}`,
            }}
            className={cn(
              "absolute z-50 block w-[300px] max-w-[calc(100vw-24px)] rounded-[20px] bg-background p-4 text-left text-[14px] leading-5 font-normal whitespace-normal text-foreground shadow-raised",
              // An invisible strip across the gap keeps the pointer "inside"
              // while it travels from the link to the card.
              "before:absolute before:inset-x-0 before:h-3 before:content-['']",
              place.side === "bottom"
                ? "top-full mt-2 before:-top-3"
                : "bottom-full mb-2 before:-bottom-3",
            )}
          >
            <span ref={contentRef} className="block">
              <span className="flex items-start justify-between gap-3">
                <span className="size-12 shrink-0 overflow-hidden rounded-full bg-[oklch(0.97_0_0)] outline-1 -outline-offset-1 outline-[oklch(0_0_0/0.1)] dark:outline-[oklch(1_0_0/0.1)]">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={profile.avatar} alt="" className="size-full" />
                </span>
                <FollowButton
                  following={following}
                  onToggle={() => setFollowing((f) => !f)}
                  name={profile.name}
                />
              </span>
              <span className="mt-3 block text-[15px] font-semibold tracking-[-0.01em]">
                {profile.name}
              </span>
              <span className="block text-[13px] text-muted">
                {profile.handle}
              </span>
              <span className="mt-2 block text-pretty">{profile.bio}</span>
              <span className="mt-3 flex gap-4 text-[13px] text-muted">
                <span>
                  <span className="font-semibold text-foreground tabular-nums">
                    {(profile.followers + (following ? 1 : 0)).toLocaleString(
                      "en-US",
                    )}
                  </span>{" "}
                  followers
                </span>
                <span>
                  <span className="font-semibold text-foreground tabular-nums">
                    {profile.following.toLocaleString("en-US")}
                  </span>{" "}
                  following
                </span>
              </span>
            </span>
          </motion.span>
        )}
      </AnimatePresence>
    </span>
  );
}

function FollowButton({
  following,
  onToggle,
  name,
}: {
  following: boolean;
  onToggle: () => void;
  name: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={following}
      aria-label={`Follow ${name}`}
      onClick={onToggle}
      className={cn(
        "grid h-9 rounded-full px-4 text-[14px] font-medium outline-hidden transition-[scale,background-color,color,box-shadow] duration-150 ease-out focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-foreground active:scale-[0.96] motion-reduce:transition-[background-color,color,box-shadow]",
        following
          ? "bg-background text-foreground shadow-raised"
          : "bg-foreground text-background",
      )}
    >
      {/* Both labels share one cell so the button never changes width. */}
      <span
        className={cn(
          "col-start-1 row-start-1 self-center transition-[opacity] duration-150",
          following && "opacity-0",
        )}
      >
        Follow
      </span>
      <span
        aria-hidden
        className={cn(
          "col-start-1 row-start-1 self-center transition-[opacity] duration-150",
          !following && "opacity-0",
        )}
      >
        Following
      </span>
    </button>
  );
}

const PEOPLE: Record<string, Profile> = {
  ava: {
    id: "ava",
    name: "Ava Chen",
    handle: "@ava",
    avatar: "/avatars/ava.svg",
    bio: "Design engineer. Writes about springs, gestures and the details nobody notices.",
    followers: 12840,
    following: 312,
  },
  ben: {
    id: "ben",
    name: "Ben Ortiz",
    handle: "@ben",
    avatar: "/avatars/ben.svg",
    bio: "Builds input systems. Currently teaching trackpads to feel like glass.",
    followers: 4096,
    following: 188,
  },
  cara: {
    id: "cara",
    name: "Cara Nwosu",
    handle: "@cara",
    avatar: "/avatars/cara.svg",
    bio: "Docs and developer experience. If it needs a paragraph, it needs a better API.",
    followers: 2731,
    following: 540,
  },
};

export default function HoverCardDemo() {
  return (
    <HoverCardGroup>
      <p className="w-[440px] max-w-full text-[15px] leading-7 text-pretty text-foreground">
        Last week <Mention profile={PEOPLE.ava} /> shipped the new motion
        guidelines, <Mention profile={PEOPLE.ben} /> rebuilt the gesture system
        on top of them, and <Mention profile={PEOPLE.cara} /> is already writing
        the docs. <span className="text-muted">Hover a name to meet them.</span>
      </p>
    </HoverCardGroup>
  );
}
