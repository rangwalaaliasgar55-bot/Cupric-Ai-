import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { AnimatePresence, MotionConfig, motion } from "motion/react";
import { cn } from "@/lib/cn";

export type BellNotification = { id: string; title: string; time: string };

const EASE_OUT = [0.23, 1, 0.32, 1] as const;
const ITEM = { type: "spring", duration: 0.35, bounce: 0 } as const;
// A little bounce is the point here: the badge should feel like it landed.
const BADGE_IN = { type: "spring", duration: 0.3, bounce: 0.35 } as const;
const BADGE_OUT = { duration: 0.15, ease: EASE_OUT } as const;
// Five swings that die away. A ring needs several beats to read as ringing
// rather than a twitch, so this runs 500ms instead of the usual 300ms cap;
// each swing is still under 100ms.
const RING: Keyframe[] = [
  { rotate: "0deg" },
  { rotate: "14deg" },
  { rotate: "-12deg" },
  { rotate: "8deg" },
  { rotate: "-5deg" },
  { rotate: "2deg" },
  { rotate: "0deg" },
];

export function NotificationBell({
  notifications,
  defaultReadId,
  ignoreOutside,
  className,
}: {
  // Newest first.
  notifications: BellNotification[];
  // This one and everything older start out read.
  defaultReadId?: string;
  // Presses inside this element don't count as clicking away.
  ignoreOutside?: React.RefObject<HTMLElement | null>;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  // One marker is all the state needed: everything newer is unread.
  const [readId, setReadId] = useState(defaultReadId);
  const rootRef = useRef<HTMLDivElement>(null);
  const bellRef = useRef<HTMLButtonElement>(null);
  const iconRef = useRef<SVGSVGElement>(null);
  const liveRef = useRef<HTMLSpanElement>(null);
  const newestId = useRef(notifications[0]?.id);
  const panelId = useId();

  const marker = notifications.findIndex((n) => n.id === readId);
  const unreadCount = marker === -1 ? notifications.length : marker;
  // Opening the panel is reading, so the badge leaves at once. The dots stay
  // until it closes, so you can still see which ones were new.
  const badge = open ? 0 : unreadCount;
  const label = badge > 9 ? "9+" : String(badge);

  const close = () => {
    setOpen(false);
    setReadId(newestId.current);
  };

  useEffect(() => {
    const newest = notifications[0];
    if (!newest || newest.id === newestId.current) return;
    newestId.current = newest.id;
    // Written straight to the DOM so announcing costs no render.
    if (liveRef.current)
      liveRef.current.textContent = `New notification: ${newest.title}`;
    const icon = iconRef.current;
    if (!icon || matchMedia("(prefers-reduced-motion: reduce)").matches)
      return;
    const ring = icon.animate(RING, { duration: 500, easing: "ease-in-out" });
    return () => ring.cancel();
  }, [notifications]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (rootRef.current?.contains(target)) return;
      if (ignoreOutside?.current?.contains(target)) return;
      setOpen(false);
      setReadId(newestId.current);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open, ignoreOutside]);

  return (
    <MotionConfig reducedMotion="user">
      <div
        ref={rootRef}
        className={cn("relative inline-flex", className)}
        onKeyDown={(e) => {
          if (e.key !== "Escape" || !open) return;
          close();
          bellRef.current?.focus();
        }}
      >
        <button
          ref={bellRef}
          type="button"
          aria-label={
            badge > 0 ? `Notifications, ${unreadCount} unread` : "Notifications"
          }
          aria-expanded={open}
          aria-controls={panelId}
          onClick={() => (open ? close() : setOpen(true))}
          className="relative flex size-11 touch-manipulation items-center justify-center rounded-full bg-surface text-foreground shadow-raised outline-hidden transition-[scale] duration-150 ease-out select-none focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-foreground active:scale-[0.96] motion-reduce:transition-none"
        >
          <svg
            ref={iconRef}
            viewBox="0 0 16 16"
            // Swings from where a bell hangs, not from its middle.
            className="size-[22px] origin-[50%_12%]"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.5}
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
          >
            <path d="M4 6.75a4 4 0 0 1 8 0c0 3 1.25 4.25 1.25 4.25H2.75S4 9.75 4 6.75Z" />
            <path d="M6.5 13.25a1.5 1.5 0 0 0 3 0" />
          </svg>

          <AnimatePresence initial={false}>
            {badge > 0 && (
              <motion.span
                key="badge"
                aria-hidden
                initial={{ scale: 0.6, opacity: 0 }}
                animate={{ scale: 1, opacity: 1, transition: BADGE_IN }}
                exit={{ scale: 0.6, opacity: 0, transition: BADGE_OUT }}
                // The page-colored ring cuts the badge out of the bell.
                className="absolute -top-1 -right-1 grid h-5 min-w-5 overflow-hidden rounded-full bg-danger px-1.5 text-xs leading-5 font-semibold text-background tabular-nums ring-2 ring-background"
              >
                <AnimatePresence initial={false} mode="popLayout">
                  <motion.span
                    key={label}
                    className="col-start-1 row-start-1 text-center"
                    initial={{ y: "100%", opacity: 0 }}
                    animate={{ y: "0%", opacity: 1 }}
                    exit={{ y: "-100%", opacity: 0 }}
                    transition={{ duration: 0.2, ease: EASE_OUT }}
                  >
                    {label}
                  </motion.span>
                </AnimatePresence>
              </motion.span>
            )}
          </AnimatePresence>
        </button>

        {/* Out of flow and hanging from the bell, so opening it moves nothing
            else. Enters in 150ms and leaves in 100ms. */}
        <div
          id={panelId}
          role="region"
          aria-label="Notifications"
          inert={!open}
          className={cn(
            "absolute top-full left-0 z-10 mt-2.5 w-[340px] max-w-[calc(100vw-2rem)] origin-top-left rounded-[20px] bg-background p-2 shadow-raised",
            "transition-[opacity,scale,translate,visibility] ease-[cubic-bezier(0.23,1,0.32,1)] motion-reduce:transition-[opacity,visibility]",
            open
              ? "visible translate-y-0 scale-100 opacity-100 duration-150"
              : "invisible -translate-y-1 scale-[0.97] opacity-0 duration-100 motion-reduce:translate-y-0 motion-reduce:scale-100",
          )}
        >
          <p className="px-3 pt-2 pb-1.5 text-[13px] font-medium text-muted">
            Notifications
          </p>
          <SmoothHeight>
            <ul>
              <AnimatePresence initial={false} mode="popLayout">
                {notifications.map((n, i) => (
                  <motion.li
                    key={n.id}
                    layout="position"
                    initial={{ opacity: 0, y: -8, filter: "blur(4px)" }}
                    animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                    exit={{
                      opacity: 0,
                      filter: "blur(4px)",
                      transition: { duration: 0.15, ease: EASE_OUT },
                    }}
                    transition={ITEM}
                    // 20px panel radius minus its 8px padding.
                    className="flex items-start gap-3 rounded-xl px-3 py-2.5"
                  >
                    <span
                      aria-hidden
                      className={cn(
                        // 6px centers the 8px dot on the first 20px line.
                        "mt-1.5 size-2 shrink-0 rounded-full bg-danger transition-opacity duration-200 ease-out",
                        i >= unreadCount && "opacity-0",
                      )}
                    />
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="text-sm text-foreground">
                        {i < unreadCount && (
                          <span className="sr-only">Unread: </span>
                        )}
                        {n.title}
                      </span>
                      <span className="mt-0.5 text-[13px] text-muted">{n.time}</span>
                    </span>
                  </motion.li>
                ))}
              </AnimatePresence>
            </ul>
          </SmoothHeight>
        </div>

        <span ref={liveRef} className="sr-only" aria-live="polite" />
      </div>
    </MotionConfig>
  );
}

// Follows its content's height with a spring instead of jumping, so the
// panel's bottom edge glides down when a row arrives.
function SmoothHeight({ children }: { children: React.ReactNode }) {
  const inner = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState<number | "auto">("auto");

  useLayoutEffect(() => {
    const el = inner.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) =>
      setHeight(entry.borderBoxSize[0].blockSize),
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <motion.div
      initial={false}
      animate={{ height }}
      transition={ITEM}
      className="overflow-hidden"
    >
      <div ref={inner}>{children}</div>
    </motion.div>
  );
}

const INCOMING = [
  "Maya commented on Roadmap",
  "Deploy to production finished",
  "Leo mentioned you in Design review",
  "Your export is ready",
  "Priya requested your review",
  "Weekly report is available",
];

// Enough to show the list moving without the panel outgrowing the page.
const MAX_ITEMS = 4;

export default function NotificationBellDemo() {
  const [items, setItems] = useState<BellNotification[]>([
    { id: "n3", title: "Sam invited you to Q3 planning", time: "5m" },
    { id: "n2", title: "Backup completed", time: "1h" },
    { id: "n1", title: "Welcome to the workspace", time: "2d" },
  ]);
  const next = useRef(0);
  const simulateRef = useRef<HTMLButtonElement>(null);

  const simulate = () => {
    const n = next.current++;
    setItems((list) =>
      [
        { id: `live-${n}`, title: INCOMING[n % INCOMING.length], time: "now" },
        ...list,
      ].slice(0, MAX_ITEMS),
    );
  };

  return (
    <div className="flex items-center gap-4">
      <NotificationBell
        notifications={items}
        defaultReadId="n2"
        ignoreOutside={simulateRef}
      />
      <button
        ref={simulateRef}
        type="button"
        onClick={simulate}
        className="h-11 touch-manipulation rounded-full bg-surface px-5 text-[15px] font-medium text-foreground shadow-raised outline-hidden transition-[scale] duration-150 ease-out select-none focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-foreground active:scale-[0.96] motion-reduce:transition-none"
      >
        Simulate notification
      </button>
    </div>
  );
}
