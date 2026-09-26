import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion, useIsPresent } from "motion/react";
import { useReducedMotion } from "@/lib/use-reduced-motion";
import { cn } from "@/lib/cn";

export type MenuItem = {
  label: string;
  icon: React.ReactNode;
  // Shown inside the surface once the item is chosen.
  done?: string;
  disabled?: boolean;
  destructive?: boolean;
  // Draws a divider above the item.
  separated?: boolean;
};

type Open = { id: number; x: number; y: number };

// Long enough that a resting thumb or a scroll that starts slowly never
// opens it, the same threshold the platforms use.
const LONG_PRESS = 500;
// A finger drifting further than this is scrolling, not pressing.
const LONG_PRESS_SLOP = 10;
// Keeps the menu off the very edge of the viewport.
const EDGE = 8;
const EASE_OUT = [0.23, 1, 0.32, 1] as const;

export function ContextMenuArea({
  items,
  onSelect,
  label = "Canvas",
  className,
  children,
}: {
  items: MenuItem[];
  onSelect?: (item: MenuItem) => void;
  label?: string;
  className?: string;
  children?: React.ReactNode;
}) {
  const surfaceRef = useRef<HTMLDivElement>(null);
  const hintId = useId();
  const [menu, setMenu] = useState<Open | null>(null);
  const nextId = useRef(0);
  const press = useRef<{
    id: number;
    x: number;
    y: number;
    timer: ReturnType<typeof setTimeout>;
  } | null>(null);
  // The keyboard and a long-press both fire their own contextmenu event
  // right after we have already opened; this swallows that echo.
  const openedAt = useRef(-Infinity);

  useEffect(() => () => clearTimeout(press.current?.timer), []);

  const open = (x: number, y: number) => {
    openedAt.current = performance.now();
    setMenu({ id: ++nextId.current, x, y });
  };

  const openAtCenter = () => {
    const rect = surfaceRef.current?.getBoundingClientRect();
    if (rect) open(rect.left + rect.width / 2, rect.top + rect.height / 2);
  };

  const cancelPress = () => {
    clearTimeout(press.current?.timer);
    press.current = null;
  };

  const close = (returnFocus: boolean) => {
    setMenu(null);
    if (returnFocus) surfaceRef.current?.focus({ preventScroll: true });
  };

  return (
    <div
      ref={surfaceRef}
      tabIndex={0}
      role="group"
      aria-label={label}
      aria-describedby={hintId}
      // React bubbles events from the portalled menu up to here; only the
      // surface's own DOM should open a menu.
      onContextMenu={(e) => {
        e.preventDefault();
        if (!e.currentTarget.contains(e.target as Node)) return;
        cancelPress();
        if (performance.now() - openedAt.current < 500) return;
        // A menu key press with no pointer position reports 0,0.
        if (e.clientX === 0 && e.clientY === 0) openAtCenter();
        else open(e.clientX, e.clientY);
      }}
      onKeyDown={(e) => {
        if (!e.currentTarget.contains(e.target as Node)) return;
        if ((e.key === "F10" && e.shiftKey) || e.key === "ContextMenu") {
          e.preventDefault();
          openAtCenter();
        }
      }}
      // Mouse and pen get the native contextmenu event; touch needs a hold.
      onPointerDown={(e) => {
        if (e.pointerType !== "touch" || !e.isPrimary) return;
        if (!e.currentTarget.contains(e.target as Node)) return;
        cancelPress();
        const { clientX: x, clientY: y, pointerId: id } = e;
        press.current = {
          id,
          x,
          y,
          timer: setTimeout(() => {
            press.current = null;
            navigator.vibrate?.(10);
            open(x, y);
          }, LONG_PRESS),
        };
      }}
      onPointerMove={(e) => {
        const p = press.current;
        if (!p || p.id !== e.pointerId) return;
        if (Math.hypot(e.clientX - p.x, e.clientY - p.y) > LONG_PRESS_SLOP) {
          cancelPress();
        }
      }}
      onPointerUp={cancelPress}
      onPointerCancel={cancelPress}
      className={cn(
        "relative flex h-[320px] w-[min(520px,100%)] touch-manipulation flex-col items-center justify-center gap-1.5 rounded-3xl px-6 text-center border border-dashed border-border outline-hidden select-none [-webkit-touch-callout:none] focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-foreground",
        className,
      )}
    >
      <span id={hintId} className="sr-only">
        Press Shift F10 for actions
      </span>
      {children}
      <AnimatePresence>
        {menu && (
          <Menu
            key={menu.id}
            x={menu.x}
            y={menu.y}
            items={items}
            onClose={close}
            onSelect={(item) => {
              close(true);
              onSelect?.(item);
            }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

function Menu({
  x,
  y,
  items,
  onClose,
  onSelect,
}: {
  x: number;
  y: number;
  items: MenuItem[];
  onClose: (returnFocus: boolean) => void;
  onSelect: (item: MenuItem) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const isPresent = useIsPresent();
  const reduceMotion = useReducedMotion();

  // Measures the real menu before the first paint, then flips it to the
  // other side of the pointer when it would overflow and shifts it inward
  // if even that does not fit. Written straight to the node, so placement
  // costs no extra render.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    // offsetWidth ignores the entering scale, so this is the settled size.
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const vw = document.documentElement.clientWidth;
    const vh = document.documentElement.clientHeight;
    const place = (at: number, size: number, max: number) => {
      const flipped = at + size > max - EDGE ? at - size : at;
      return Math.min(Math.max(flipped, EDGE), max - size - EDGE);
    };
    const left = place(x, w, vw);
    const top = place(y, h, vh);
    el.style.left = `${left}px`;
    el.style.top = `${top}px`;
    // Grows out of the pointer itself: the corner nearest it after a flip,
    // or the exact point when the menu had to shift.
    const ox = Math.min(Math.max(x - left, 0), w);
    const oy = Math.min(Math.max(y - top, 0), h);
    el.style.transformOrigin = `${ox}px ${oy}px`;
    el.querySelector<HTMLElement>('[role="menuitem"]')?.focus({
      preventScroll: true,
    });
  }, [x, y]);

  useEffect(() => {
    if (!isPresent) return;
    const outside = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose(false);
    };
    const dismiss = () => onClose(false);
    document.addEventListener("pointerdown", outside, true);
    // Capture catches scrolling in any container, not just the page.
    window.addEventListener("scroll", dismiss, true);
    window.addEventListener("resize", dismiss);
    window.addEventListener("blur", dismiss);
    return () => {
      document.removeEventListener("pointerdown", outside, true);
      window.removeEventListener("scroll", dismiss, true);
      window.removeEventListener("resize", dismiss);
      window.removeEventListener("blur", dismiss);
    };
  }, [isPresent, onClose]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    const list = Array.from(
      ref.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [],
    );
    const at = list.indexOf(document.activeElement as HTMLElement);
    const go = (i: number) =>
      list[(i + list.length) % list.length]?.focus({ preventScroll: true });
    if (e.key === "ArrowDown") go(at + 1);
    else if (e.key === "ArrowUp") go(at < 0 ? -1 : at - 1);
    else if (e.key === "Home") go(0);
    else if (e.key === "End") go(-1);
    else if (e.key === "Escape" || e.key === "Tab") onClose(true);
    else return;
    e.preventDefault();
    e.stopPropagation();
  };

  return createPortal(
    <motion.div
      ref={ref}
      role="menu"
      tabIndex={-1}
      aria-label="Actions"
      onKeyDown={onKeyDown}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
      // Leaving the menu clears the highlight, like a native menu.
      onPointerLeave={(e) => {
        if (e.pointerType === "mouse")
          ref.current?.focus({ preventScroll: true });
      }}
      // Opens in 150ms from the pointer, leaves in 100ms on opacity alone:
      // the exit should never hold the eye.
      initial={{ opacity: 0, scale: reduceMotion ? 1 : 0.95 }}
      animate={{
        opacity: 1,
        scale: 1,
        transition: { duration: 0.15, ease: EASE_OUT },
      }}
      exit={{ opacity: 0, transition: { duration: 0.1, ease: "easeOut" } }}
      className={cn(
        "fixed top-0 left-0 z-50 w-55 rounded-[14px] bg-background p-1.5 shadow-raised outline-hidden",
        !isPresent && "pointer-events-none",
      )}
    >
      {items.map((item) => (
        <div key={item.label}>
          {item.separated && (
            <div role="separator" className="mx-2.5 my-1.5 h-px bg-border" />
          )}
          <button
            type="button"
            role="menuitem"
            tabIndex={-1}
            aria-disabled={item.disabled || undefined}
            onClick={() => {
              if (!item.disabled) onSelect(item);
            }}
            // Hover and keyboard share one highlight, so there is never a
            // second "current" item to reconcile.
            onPointerMove={(e) => {
              if (
                e.pointerType !== "touch" &&
                document.activeElement !== e.currentTarget
              ) {
                e.currentTarget.focus({ preventScroll: true });
              }
            }}
            // 8px items inside 6px padding keep the corners concentric with
            // the menu's 14px.
            className={cn(
              "flex h-9 w-full items-center gap-2.5 rounded-lg px-2.5 text-left text-sm outline-hidden select-none",
              item.disabled
                ? "cursor-default text-muted opacity-60 focus:bg-foreground/[0.04]"
                : item.destructive
                  ? "text-danger focus:bg-danger/10"
                  : "text-foreground focus:bg-foreground/[0.06]",
            )}
          >
            <span aria-hidden className="size-4 shrink-0">
              {item.icon}
            </span>
            {item.label}
          </button>
        </div>
      ))}
    </motion.div>,
    document.body,
  );
}

function Icon({ d }: { d: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      className="size-4"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={d} />
    </svg>
  );
}

const ITEMS: MenuItem[] = [
  {
    label: "Open",
    done: "Opened",
    icon: (
      <Icon d="M6.5 3.25H4.25a1 1 0 0 0-1 1v7.5a1 1 0 0 0 1 1h7.5a1 1 0 0 0 1-1V9.5M9.25 2.75h4v4M13 3 7.75 8.25" />
    ),
  },
  {
    label: "Rename",
    done: "Renamed",
    icon: <Icon d="m10.5 3.25 2.25 2.25L6 12.25H3.75V10z" />,
  },
  {
    label: "Duplicate",
    done: "Duplicated",
    icon: (
      <Icon d="M5.25 7a1.75 1.75 0 0 1 1.75-1.75h4.5A1.75 1.75 0 0 1 13.25 7v4.5a1.75 1.75 0 0 1-1.75 1.75H7a1.75 1.75 0 0 1-1.75-1.75zM10.75 5.25V4.5A1.75 1.75 0 0 0 9 2.75H4.5A1.75 1.75 0 0 0 2.75 4.5V9a1.75 1.75 0 0 0 1.75 1.75h.75" />
    ),
  },
  {
    label: "Share link",
    disabled: true,
    icon: (
      <Icon d="M7 9a2.5 2.5 0 0 0 3.54 0l2-2A2.5 2.5 0 0 0 9 3.46l-.75.75M9 7a2.5 2.5 0 0 0-3.54 0l-2 2A2.5 2.5 0 0 0 7 12.54l.75-.75" />
    ),
  },
  {
    label: "Delete",
    done: "Deleted",
    destructive: true,
    separated: true,
    icon: (
      <Icon d="M2.75 4.25h10.5M6.25 4.25v-1.5h3.5v1.5M4 4.25l.6 8.1a1 1 0 0 0 1 .9h4.8a1 1 0 0 0 1-.9l.6-8.1M6.75 7v3.75M9.25 7v3.75" />
    ),
  },
];

export default function ContextMenuDemo() {
  const [chosen, setChosen] = useState<{ n: number; text: string } | null>(
    null,
  );

  return (
    <ContextMenuArea
      items={ITEMS}
      label="Canvas"
      onSelect={(item) =>
        setChosen((c) => ({
          n: (c?.n ?? 0) + 1,
          text: item.done ?? item.label,
        }))
      }
    >
      <p className="text-base font-medium text-foreground">
        Right-click anywhere
      </p>
      <p className="text-sm text-pretty text-muted">
        Long-press on touch, Shift F10 from the keyboard
      </p>
      {/* A reserved line, so the hint above never moves when a result
          appears. Keyed per choice so each one fades in fresh. */}
      <p aria-live="polite" className="mt-3 h-6 text-sm leading-6 text-muted">
        {chosen && (
          <span
            key={chosen.n}
            className="inline-block transition-[opacity,filter,translate] duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] starting:opacity-0 motion-safe:starting:translate-y-0.5 motion-safe:starting:blur-[4px]"
          >
            {chosen.text}
          </span>
        )}
      </p>
    </ContextMenuArea>
  );
}
