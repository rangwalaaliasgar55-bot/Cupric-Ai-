import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/cn";

type Toast = { id: number; title: string; description: string };

const HEIGHT = 64;
const GAP = 8;
// Collapsed, each toast behind sits this much higher and 5% smaller, enough
// to read as a pile without hiding the front one.
const PEEK = 12;
const SHRINK = 0.05;
const VISIBLE = 3;
const DURATION = 4000;
// Long enough for the leave transition below to finish before unmounting.
const LEAVE_MS = 200;
const FLICK_VELOCITY = 0.11;
const DISMISS_DISTANCE = 40;

// The toast's own edge is its timer: a hairline that drains around the
// outline, clockwise from the top left, and stops the moment you hover or
// switch tabs, because the dismiss timers above stop then too. Linear,
// because it is a clock. A keyframe, since it runs once per toast and only
// ever pauses, never retargets.
const CSS = `
@keyframes toast-drain {
  from { stroke-dashoffset: 0; }
  to { stroke-dashoffset: -1; }
}
.toast-drain { animation: toast-drain ${DURATION}ms linear forwards; }
`;

export function ToastStack({
  toasts,
  onDismiss,
}: {
  toasts: Toast[];
  onDismiss: (id: number) => void;
}) {
  const [hovered, setHovered] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [leaving, setLeaving] = useState<Map<number, number>>(new Map());
  const remaining = useRef(new Map<number, number>());

  const dismiss = useCallback(
    (id: number, index: number) => {
      setLeaving((m) => new Map(m).set(id, index));
      setTimeout(() => {
        onDismiss(id);
        setLeaving((m) => {
          const next = new Map(m);
          next.delete(id);
          return next;
        });
        remaining.current.delete(id);
      }, LEAVE_MS);
    },
    [onDismiss],
  );

  useEffect(() => {
    const onChange = () => setHidden(document.hidden);
    document.addEventListener("visibilitychange", onChange);
    return () => document.removeEventListener("visibilitychange", onChange);
  }, []);

  // Newest first. Toasts on their way out keep the slot they left from.
  const live = useMemo(
    () => toasts.filter((t) => !leaving.has(t.id)).reverse(),
    [toasts, leaving],
  );

  // Timers pause while you're reading the stack or looking at another tab,
  // so a toast never disappears unseen.
  useEffect(() => {
    if (hovered || hidden) return;
    const left = remaining.current;
    const started = performance.now();
    const timers = live.map((t, i) =>
      setTimeout(() => dismiss(t.id, i), left.get(t.id) ?? DURATION),
    );
    return () => {
      timers.forEach(clearTimeout);
      const spent = performance.now() - started;
      for (const t of live) {
        left.set(t.id, (left.get(t.id) ?? DURATION) - spent);
      }
    };
  }, [live, hovered, hidden, dismiss]);

  const expandedHeight = live.length * (HEIGHT + GAP) - GAP;

  return (
    <section
      aria-label="Notifications"
      aria-live="polite"
      className="fixed bottom-6 left-1/2 z-50 w-[356px] max-w-[calc(100vw-2rem)] -translate-x-1/2"
    >
      <style href="toast-stack" precedence="default">
        {CSS}
      </style>
      {/* Grows with the fanned-out stack, so moving between toasts never
          leaves the hover area and collapses them. */}
      <ol
        className="relative"
        style={{ height: hovered ? Math.max(expandedHeight, HEIGHT) : HEIGHT }}
        onPointerEnter={(e) => {
          if (e.pointerType !== "touch") setHovered(true);
        }}
        onPointerLeave={() => setHovered(false)}
      >
        {toasts.map((toast) => {
          const leaveIndex = leaving.get(toast.id);
          const index = leaveIndex ?? live.indexOf(toast);
          return (
            <ToastItem
              key={toast.id}
              toast={toast}
              index={index}
              expanded={hovered}
              paused={hovered || hidden}
              leaving={leaveIndex !== undefined}
              onDismiss={() => dismiss(toast.id, index)}
            />
          );
        })}
      </ol>
    </section>
  );
}

function ToastItem({
  toast,
  index,
  expanded,
  paused,
  leaving,
  onDismiss,
}: {
  toast: Toast;
  index: number;
  expanded: boolean;
  paused: boolean;
  leaving: boolean;
  onDismiss: () => void;
}) {
  const drag = useRef<{
    startX: number;
    startY: number;
    startTime: number;
    axis: "x" | "y" | null;
    distance: number;
  }>(null);

  const y = expanded ? -index * (HEIGHT + GAP) : -index * PEEK;
  const scale = expanded ? 1 : 1 - index * SHRINK;
  const opacity = leaving || index >= VISIBLE ? 0 : 1;

  return (
    <li
      className={cn(
        "absolute inset-x-0 bottom-0 flex h-16 touch-none flex-col justify-center rounded-2xl bg-background px-4 shadow-raised select-none",
        // Enters from below. Transitions rather than keyframes, so a toast
        // added mid-animation retargets the stack instead of restarting it.
        "[transform:translateY(var(--y))_scale(var(--scale))] opacity-(--opacity) transition-[transform,opacity,translate,filter] duration-400 ease-[ease] starting:[transform:translateY(100%)] starting:opacity-0",
        // Exits are quicker and softer than entrances, and only the toast
        // that's leaving blurs.
        leaving && "blur-[4px] duration-200 ease-out",
        "motion-reduce:transition-[opacity]",
      )}
      style={
        {
          "--y": `${y + (leaving ? 12 : 0)}px`,
          "--scale": scale,
          "--opacity": opacity,
          zIndex: 100 - index,
        } as React.CSSProperties
      }
      onPointerDown={(e) => {
        if (e.button !== 0 || leaving) return;
        drag.current = {
          startX: e.clientX,
          startY: e.clientY,
          startTime: performance.now(),
          axis: null,
          distance: 0,
        };
        e.currentTarget.setPointerCapture(e.pointerId);
        e.currentTarget.style.transitionProperty = "transform, opacity";
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (!d) return;
        const dx = e.clientX - d.startX;
        const dy = e.clientY - d.startY;
        // Commit to one axis after a few pixels, so a slightly diagonal
        // swipe doesn't wobble between the two.
        if (!d.axis) {
          if (Math.hypot(dx, dy) < 4) return;
          d.axis = Math.abs(dx) > Math.abs(dy) ? "x" : "y";
        }
        if (d.axis === "x") {
          d.distance = dx;
          e.currentTarget.style.translate = `${dx}px 0`;
        } else {
          // Toasts leave downwards; pulling up gives only a little.
          d.distance = dy < 0 ? -Math.pow(-dy, 0.5) : dy;
          e.currentTarget.style.translate = `0 ${d.distance}px`;
        }
      }}
      onPointerUp={(e) => {
        const d = drag.current;
        if (!d) return;
        drag.current = null;
        e.currentTarget.style.transitionProperty = "";
        // Sideways works in both directions; vertically only down dismisses.
        const reach = d.axis === "x" ? Math.abs(d.distance) : d.distance;
        const velocity = reach / (performance.now() - d.startTime);
        if (reach > DISMISS_DISTANCE || velocity > FLICK_VELOCITY) {
          // Thrown sideways, it carries on out the way it was going.
          if (d.axis === "x") {
            e.currentTarget.style.translate = `${Math.sign(d.distance) * 100}% 0`;
          }
          onDismiss();
        } else {
          e.currentTarget.style.translate = "";
        }
      }}
      onPointerCancel={(e) => {
        drag.current = null;
        e.currentTarget.style.transitionProperty = "";
        e.currentTarget.style.translate = "";
      }}
    >
      <svg
        aria-hidden
        className="pointer-events-none absolute inset-0 size-full overflow-visible text-foreground"
      >
        {/* Traces the li's own 16px corners, half a pixel in so the 1px
            stroke sits inside the edge rather than straddling it. */}
        <rect
          x="0.5"
          y="0.5"
          rx="15.5"
          style={{
            width: "calc(100% - 1px)",
            height: "calc(100% - 1px)",
            animationPlayState: paused ? "paused" : "running",
          }}
          pathLength={1}
          strokeDasharray="1 1"
          fill="none"
          stroke="currentColor"
          strokeOpacity={0.35}
          className="toast-drain"
        />
      </svg>
      <p className="text-sm font-medium">{toast.title}</p>
      <p className="truncate text-sm text-muted">{toast.description}</p>
    </li>
  );
}

const MESSAGES = [
  { title: "Saved to drafts", description: "You can pick this up any time." },
  { title: "Link copied", description: "lab.xevrion.dev/toast-stack" },
  { title: "Invite sent", description: "They'll get an email in a moment." },
  { title: "Changes published", description: "Live for everyone now." },
  { title: "File uploaded", description: "notes.md, 12 KB" },
];

export default function ToastStackDemo() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(0);

  const add = () => {
    const id = nextId.current++;
    const message = MESSAGES[id % MESSAGES.length];
    // Anything past the visible three is already transparent, so older
    // toasts can go without an exit.
    setToasts((ts) => [...ts.slice(-(VISIBLE + 1)), { id, ...message }]);
  };

  const remove = useCallback(
    (id: number) => setToasts((ts) => ts.filter((t) => t.id !== id)),
    [],
  );

  return (
    <>
      <button
        type="button"
        onClick={add}
        className="h-10 rounded-full bg-surface px-4 text-sm font-medium shadow-raised transition-[scale] duration-150 ease-out active:scale-[0.96] motion-reduce:transition-none"
      >
        Add toast
      </button>
      <ToastStack toasts={toasts} onDismiss={remove} />
    </>
  );
}
