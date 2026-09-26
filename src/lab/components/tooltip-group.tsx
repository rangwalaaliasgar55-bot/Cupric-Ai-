import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  animate,
  AnimatePresence,
  motion,
  useMotionValue,
  type Variants,
} from "motion/react";
import { useReducedMotion } from "@/lib/use-reduced-motion";
import { cn } from "@/lib/cn";

/* The teachable part: one shared clock, and one shared bubble, for every
   tooltip in a group. Scanning a toolbar doesn't swap tooltips; the same
   bubble slides to the next button and reshapes around its label. */

type Open = { id: string; instant: boolean } | null;
type Shown = { id: string; content: React.ReactNode; dir: number };
type Anchor = { el: HTMLElement | null; content: React.ReactNode };

type Group = {
  open: Open;
  anchors: React.RefObject<Map<string, Anchor>>;
  request: (id: string, immediate: boolean) => void;
  release: (id: string) => void;
  dismiss: (id: string) => void;
};

const GroupContext = createContext<Group | null>(null);

const EASE_OUT = [0.23, 1, 0.32, 1] as const;
// A touch of give on the slide, so the bubble reads as one object being
// carried over rather than a highlight jumping. Short enough that a fast
// sweep never leaves it trailing more than a button behind.
const GLIDE = { type: "spring", visualDuration: 0.22, bounce: 0.12 } as const;
// The outline itself never overshoots: a pill that briefly outgrows its
// label looks like a measuring bug.
const RESHAPE = { type: "spring", visualDuration: 0.22, bounce: 0 } as const;
// Space between the trigger's top edge and the arrow tip.
const OFFSET = 10;
// Horizontal padding inside the pill, added to the measured label.
const PAD_X = 24;
// A reopen within this window finds the old bubble still fading out, so it
// slides from there instead of popping in somewhere new.
const STILL_VISIBLE = 110;

// The incoming label drifts in from the side the bubble is travelling from,
// the outgoing one leaves the other way, so the text rides with the motion.
const LABEL: Variants = {
  enter: ({ dir, reduce }: { dir: number; reduce: boolean }) => ({
    opacity: 0,
    x: reduce ? 0 : dir * 10,
    filter: reduce ? "blur(0px)" : "blur(4px)",
  }),
  center: {
    opacity: 1,
    x: 0,
    filter: "blur(0px)",
    transition: { duration: 0.2, ease: EASE_OUT },
  },
  // Softer and quicker than the entrance: gone before the new one settles.
  exit: ({ dir, reduce }: { dir: number; reduce: boolean }) => ({
    opacity: 0,
    x: reduce ? 0 : dir * -6,
    filter: reduce ? "blur(0px)" : "blur(2px)",
    transition: { duration: 0.12, ease: EASE_OUT },
  }),
};

export function TooltipGroup({
  // Long enough that sweeping the cursor across the page never flashes a
  // tooltip, short enough that a deliberate pause gets one.
  delay = 500,
  // How long the group stays warm after the last tooltip closes. Covers the
  // gap between two buttons with plenty of room to spare.
  skipDelay = 300,
  className,
  children,
}: {
  delay?: number;
  skipDelay?: number;
  className?: string;
  children: React.ReactNode;
}) {
  const reduceMotion = useReducedMotion() ?? false;
  const [open, setOpenState] = useState<Open>(null);
  const [shown, setShown] = useState<Shown | null>(null);
  // Pointer events can outrun re-renders, so handlers read these refs.
  const openRef = useRef<Open>(null);
  const shownId = useRef<string | null>(null);
  const closedAt = useRef(-Infinity);
  const warm = useRef(false);
  const pending = useRef<string | null>(null);
  const suppressed = useRef<string | null>(null);
  const delayTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const graceTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const anchors = useRef(new Map<string, Anchor>());

  const root = useRef<HTMLDivElement>(null);
  const measure = useRef<HTMLSpanElement>(null);
  // Position of the arrow tip and width of the pill, relative to the group.
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const width = useMotionValue(0);
  const lastOpen = useRef<Open>(null);

  const center = (id: string | null) => {
    const box = id ? anchors.current.get(id)?.el?.getBoundingClientRect() : null;
    return box ? box.left + box.width / 2 : null;
  };

  const setOpen = useCallback((next: Open) => {
    const previous = openRef.current;
    openRef.current = next;
    setOpenState(next);
    if (!next) {
      if (previous) closedAt.current = performance.now();
      return;
    }
    const from = center(shownId.current);
    const to = center(next.id);
    shownId.current = next.id;
    setShown({
      id: next.id,
      content: anchors.current.get(next.id)?.content,
      dir: from === null || to === null ? 0 : Math.sign(to - from),
    });
  }, []);

  // Measures the new label and moves the bubble before paint, so the first
  // frame is already heading to the right place.
  useLayoutEffect(() => {
    const wasOpen = lastOpen.current !== null;
    lastOpen.current = open;
    const el = open ? anchors.current.get(open.id)?.el : null;
    const box = root.current?.getBoundingClientRect();
    if (!open || !el || !box || !measure.current) return;
    const target = el.getBoundingClientRect();
    const tx = target.left + target.width / 2 - box.left;
    const ty = target.top - box.top - OFFSET;
    const tw = measure.current.offsetWidth + PAD_X;
    const onScreen =
      wasOpen ||
      performance.now() - closedAt.current < STILL_VISIBLE;
    if (!onScreen || reduceMotion) {
      x.jump(tx);
      y.jump(ty);
      width.jump(tw);
      return;
    }
    // Not stopped on cleanup: the next animate() on the same value takes
    // over mid-flight and keeps its velocity, so a fast sweep bends the
    // path instead of restarting it.
    animate(x, tx, GLIDE);
    animate(y, ty, GLIDE);
    animate(width, tw, RESHAPE);
  }, [open, shown, reduceMotion, x, y, width]);

  useEffect(
    () => () => {
      x.stop();
      y.stop();
      width.stop();
    },
    [x, y, width],
  );

  useEffect(
    () => () => {
      clearTimeout(delayTimer.current);
      clearTimeout(graceTimer.current);
    },
    [],
  );

  const request = useCallback(
    (id: string, immediate: boolean) => {
      // Pressed or Escaped: stay quiet until the pointer or focus moves on.
      if (suppressed.current === id) return;
      clearTimeout(delayTimer.current);
      clearTimeout(graceTimer.current);
      pending.current = null;
      if (warm.current || openRef.current) {
        // Scanning the toolbar: no delay and no entrance. The bubble that is
        // already up slides over instead.
        setOpen({ id, instant: true });
        return;
      }
      if (immediate) {
        warm.current = true;
        setOpen({ id, instant: false });
        return;
      }
      pending.current = id;
      delayTimer.current = setTimeout(() => {
        pending.current = null;
        warm.current = true;
        setOpen({ id, instant: false });
      }, delay);
    },
    [delay, setOpen],
  );

  const release = useCallback(
    (id: string) => {
      if (suppressed.current === id) suppressed.current = null;
      if (pending.current === id) {
        clearTimeout(delayTimer.current);
        pending.current = null;
      }
      // A late leave or blur from a trigger that is no longer showing must
      // not close or cool down the one that is.
      if (openRef.current && openRef.current.id !== id) return;
      if (openRef.current) setOpen(null);
      if (!warm.current) return;
      clearTimeout(graceTimer.current);
      graceTimer.current = setTimeout(() => {
        warm.current = false;
      }, skipDelay);
    },
    [skipDelay, setOpen],
  );

  const dismiss = useCallback(
    (id: string) => {
      if (pending.current === id) {
        clearTimeout(delayTimer.current);
        pending.current = null;
      }
      suppressed.current = id;
      if (openRef.current?.id === id) setOpen(null);
    },
    [setOpen],
  );

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") dismiss(open.id);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, dismiss]);

  const value = useMemo(
    () => ({ open, anchors, request, release, dismiss }),
    [open, request, release, dismiss],
  );
  const custom = { dir: shown?.dir ?? 0, reduce: reduceMotion };

  return (
    <GroupContext.Provider value={value}>
      <div ref={root} className={cn("relative w-fit max-w-full", className)}>
        {children}
        {/* Every trigger describes itself with its own hidden text, so this
            visual copy stays out of the accessibility tree. */}
        <motion.div
          aria-hidden
          style={{ x, y, width }}
          className={cn(
            // Anchored by its arrow tip: the CSS translate pulls it up and
            // left of the point Motion moves, and it grows out of that point.
            "pointer-events-none absolute top-0 left-0 z-10 h-7 origin-bottom -translate-x-1/2 -translate-y-full",
            "transition-[opacity,scale] ease-[cubic-bezier(0.23,1,0.32,1)] motion-reduce:scale-100",
            // Enters in 150ms and leaves in 100ms: the exit never holds the eye.
            open ? "scale-100 opacity-100 duration-150" : "scale-[0.97] opacity-0 duration-100",
            open?.instant && "duration-0",
          )}
        >
          <div className="relative size-full overflow-hidden rounded-full bg-foreground text-[13px] font-medium text-background">
            <AnimatePresence initial={false} custom={custom}>
              {shown && (
                <motion.span
                  key={shown.id}
                  custom={custom}
                  variants={LABEL}
                  initial="enter"
                  animate="center"
                  exit="exit"
                  className="absolute inset-0 flex items-center justify-center gap-2 whitespace-nowrap"
                >
                  {shown.content}
                </motion.span>
              )}
            </AnimatePresence>
          </div>
          {/* Part of the same object, so it slides with the pill instead of
              being redrawn under each trigger. */}
          <span className="absolute top-full left-1/2 -ml-[5px] block border-x-[5px] border-t-[5px] border-x-transparent border-t-foreground" />
        </motion.div>
        {/* Sizes the pill: the same label, laid out but never painted. */}
        <span
          ref={measure}
          aria-hidden
          className="invisible absolute top-0 left-0 flex gap-2 text-[13px] font-medium whitespace-nowrap"
        >
          {shown?.content}
        </span>
      </div>
    </GroupContext.Provider>
  );
}

export function useTooltip(content?: React.ReactNode) {
  const group = useContext(GroupContext);
  if (!group) throw new Error("useTooltip needs a <TooltipGroup> above it");
  const { open, anchors, request, release, dismiss } = group;
  const id = useId();
  const isOpen = open?.id === id;
  const el = useRef<HTMLElement | null>(null);

  // Kept current every render, read only when this tooltip opens.
  useLayoutEffect(() => {
    anchors.current.set(id, { el: el.current, content });
  });
  useEffect(() => {
    const map = anchors.current;
    return () => {
      map.delete(id);
    };
  }, [anchors, id]);

  return {
    isOpen,
    // The bubble points at this element.
    anchorRef: (node: HTMLElement | null) => {
      el.current = node;
    },
    triggerProps: {
      "aria-describedby": id,
      onPointerEnter: (e: React.PointerEvent) => {
        // Touch has no hover; a tap would flash the tooltip under the finger.
        if (e.pointerType !== "touch") request(id, false);
      },
      onPointerLeave: (e: React.PointerEvent) => {
        if (e.pointerType !== "touch") release(id);
      },
      // A press means the user already knows what it does, and the tooltip
      // would otherwise sit on top of whatever the press changed.
      onPointerDown: () => dismiss(id),
      onFocus: (e: React.FocusEvent<HTMLElement>) => {
        // Keyboard users get it at once: there is no hover to wait out.
        if (e.currentTarget.matches(":focus-visible")) request(id, true);
      },
      onBlur: () => release(id),
    },
    // Put on a hidden element holding the text, for aria-describedby.
    tooltipProps: { id, role: "tooltip" as const, hidden: true },
  };
}

/* A text formatting toolbar built on it. */

export type FormatItem = {
  key: string;
  label: string;
  // KeyboardEvent.code, so holding Shift never changes which key matches.
  code: string;
  shift?: boolean;
  icon: React.ReactNode;
};

const isMac = () => /Mac|iPhone|iPad/.test(navigator.platform);
const subscribeNever = () => () => {};

function useIsMac() {
  // The server can't know, so it renders Mac glyphs and the client corrects
  // them right after hydration.
  return useSyncExternalStore(subscribeNever, isMac, () => true);
}

const keyName = (code: string) => code.replace(/^(Key|Digit)/, "");

export function FormatToolbar({
  items,
  pressed,
  onToggle,
  label = "Text formatting",
  className,
}: {
  items: FormatItem[];
  pressed: Record<string, boolean>;
  onToggle: (key: string) => void;
  label?: string;
  className?: string;
}) {
  const mac = useIsMac();
  const [active, setActive] = useState(0);
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (mac ? e.metaKey : e.ctrlKey) {
      const item = items.find(
        (i) => i.code === e.code && Boolean(i.shift) === e.shiftKey,
      );
      if (!item) return;
      e.preventDefault();
      onToggle(item.key);
      return;
    }
    // One tab stop for the whole toolbar; arrows move within it.
    const last = items.length - 1;
    const moves: Record<string, number> = {
      ArrowRight: active === last ? 0 : active + 1,
      ArrowLeft: active === 0 ? last : active - 1,
      Home: 0,
      End: last,
    };
    const next = moves[e.key];
    if (next === undefined) return;
    e.preventDefault();
    setActive(next);
    refs.current[next]?.focus();
  };

  return (
    <TooltipGroup>
      {/* 48px pill with 4px padding around 40px buttons keeps the radii
          concentric: 24 = 20 + 4. */}
      <div
        role="toolbar"
        aria-label={label}
        onKeyDown={onKeyDown}
        className={cn(
          "flex h-12 items-center gap-1 rounded-full bg-surface p-1 shadow-raised",
          className,
        )}
      >
        {items.map((item, i) => (
          <FormatButton
            key={item.key}
            ref={(el) => {
              refs.current[i] = el;
            }}
            item={item}
            mac={mac}
            pressed={Boolean(pressed[item.key])}
            tabIndex={i === active ? 0 : -1}
            onFocus={() => setActive(i)}
            onToggle={() => onToggle(item.key)}
          />
        ))}
      </div>
    </TooltipGroup>
  );
}

function FormatButton({
  item,
  mac,
  pressed,
  tabIndex,
  onFocus,
  onToggle,
  ref,
}: {
  item: FormatItem;
  mac: boolean;
  pressed: boolean;
  tabIndex: number;
  onFocus: () => void;
  onToggle: () => void;
  ref: (el: HTMLButtonElement | null) => void;
}) {
  const key = keyName(item.code);
  const glyphs = mac
    ? `⌘${item.shift ? "⇧" : ""}${key}`
    : `Ctrl+${item.shift ? "Shift+" : ""}${key}`;
  const shortcut = `${mac ? "Meta" : "Control"}+${item.shift ? "Shift+" : ""}${key}`;
  const { anchorRef, triggerProps, tooltipProps } = useTooltip(
    <>
      {item.label}
      <kbd className="font-sans text-background/55">{glyphs}</kbd>
    </>,
  );

  return (
    <>
      <button
        ref={(el) => {
          anchorRef(el);
          ref(el);
        }}
        type="button"
        aria-label={item.label}
        aria-pressed={pressed}
        aria-keyshortcuts={shortcut}
        tabIndex={tabIndex}
        onClick={onToggle}
        {...triggerProps}
        onFocus={(e) => {
          onFocus();
          triggerProps.onFocus(e);
        }}
        className={cn(
          "flex size-10 touch-manipulation items-center justify-center rounded-full text-muted outline-hidden select-none hover:text-foreground",
          "transition-[scale,color,background-color,box-shadow] duration-150 ease-out motion-reduce:transition-[color,background-color,box-shadow]",
          "focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-foreground active:scale-[0.96]",
          pressed && "bg-background text-foreground shadow-raised",
        )}
      >
        <svg
          viewBox="0 0 16 16"
          className="size-5"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.5}
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          {item.icon}
        </svg>
      </button>
      <span {...tooltipProps}>
        {item.label}, {glyphs}
      </span>
    </>
  );
}

const ITEMS: FormatItem[] = [
  {
    key: "bold",
    label: "Bold",
    code: "KeyB",
    icon: (
      <path d="M4.75 3.25h4a2.5 2.5 0 0 1 0 5h-4zM4.75 8.25h4.75a2.25 2.25 0 0 1 0 4.5H4.75z" />
    ),
  },
  {
    key: "italic",
    label: "Italic",
    code: "KeyI",
    icon: <path d="M6.75 3.25h5M4.25 12.75h5M9.75 3.25l-3.5 9.5" />,
  },
  {
    key: "underline",
    label: "Underline",
    code: "KeyU",
    icon: <path d="M4.5 2.75v4.5a3.5 3.5 0 0 0 7 0v-4.5M3.5 13.25h9" />,
  },
  {
    key: "strike",
    label: "Strikethrough",
    code: "KeyX",
    shift: true,
    icon: (
      <path d="M2.75 8h10.5M11 4.5c-.4-1.1-1.5-1.75-3-1.75-1.8 0-3 .9-3 2.25 0 .8.4 1.4 1.2 1.8M5 11.25c.4 1.2 1.6 2 3.1 2 1.9 0 3.15-.95 3.15-2.4 0-.5-.15-.95-.45-1.35" />
    ),
  },
  {
    key: "code",
    label: "Code",
    code: "KeyE",
    icon: <path d="M5.5 4.5 2 8l3.5 3.5M10.5 4.5 14 8l-3.5 3.5" />,
  },
  {
    key: "quote",
    label: "Quote",
    code: "Digit9",
    shift: true,
    icon: <path d="M3.25 3.75v8.5M6.5 5.25h6.25M6.5 8h6.25M6.5 10.75h4" />,
  },
];

export default function TooltipGroupDemo() {
  const [pressed, setPressed] = useState<Record<string, boolean>>({
    bold: true,
  });
  const toggle = (key: string) =>
    setPressed((p) => ({ ...p, [key]: !p[key] }));

  // Two separate utilities would both set text-decoration-line and clash.
  const decoration =
    [pressed.underline && "underline", pressed.strike && "line-through"]
      .filter(Boolean)
      .join(" ") || "none";

  return (
    <div className="flex flex-col items-center gap-6">
      <FormatToolbar items={ITEMS} pressed={pressed} onToggle={toggle} />
      {/* Fixed height and an always present border, so toggling a style
          never nudges the toolbar above it. */}
      <p
        className={cn(
          "h-7 border-l-2 border-transparent pl-3.5 text-[15px]/7 whitespace-nowrap text-foreground transition-[color,border-color] duration-150 ease-out",
          pressed.bold && "font-semibold",
          pressed.italic && "italic",
          pressed.code && "font-mono",
          pressed.quote && "border-foreground/20 text-muted",
        )}
        style={{ textDecorationLine: decoration }}
      >
        Scan the toolbar, not the docs.
      </p>
    </div>
  );
}
