import { useEffect, useId, useRef, useState } from "react";
import { cn } from "@/lib/cn";

export type DragSelectItem = { id: string; name: string; meta: string; kind: Kind };
type Kind = "folder" | "doc" | "image" | "sheet" | "code" | "video" | "audio" | "archive";
type Box = { left: number; top: number; right: number; bottom: number };

// Movement below this is a click on empty space, not the start of a marquee.
const DRAG_THRESHOLD = 3;
// Within this distance of the top or bottom edge the list scrolls on its own,
// faster the closer the pointer gets, up to MAX_SCROLL px per frame.
const SCROLL_EDGE = 40;
const MAX_SCROLL = 14;
const EASE_OUT = "cubic-bezier(0.23, 1, 0.32, 1)";

type Drag = {
  pointerId: number;
  // Start point in content coordinates, so it stays pinned while scrolling.
  x: number;
  y: number;
  clientX: number;
  clientY: number;
  // What was selected before the drag, kept when Shift or Cmd is held.
  base: Set<number> | null;
  active: boolean;
  boxes: Box[];
};

export function DragSelect({
  items,
  label,
  className,
}: {
  items: DragSelectItem[];
  label: string;
  className?: string;
}) {
  const [selected, setSelected] = useState<Set<number>>(() => new Set());
  const [focusIndex, setFocusIndex] = useState(0);
  const selectedRef = useRef(selected);
  const anchor = useRef<number | null>(null);
  const lastPointer = useRef("mouse");
  const scrollerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const marqueeRef = useRef<HTMLDivElement>(null);
  const tiles = useRef<(HTMLDivElement | null)[]>([]);
  const drag = useRef<Drag | null>(null);
  const frame = useRef(0);
  const instructions = useId();

  useEffect(() => () => cancelAnimationFrame(frame.current), []);

  const commit = (next: Set<number>) => {
    const prev = selectedRef.current;
    // Marquee moves fire constantly; only re-render when membership changes.
    if (next.size === prev.size && [...next].every((i) => prev.has(i))) return;
    selectedRef.current = next;
    setSelected(next);
  };

  const range = (from: number, to: number) => {
    const set = new Set<number>();
    for (let i = Math.min(from, to); i <= Math.max(from, to); i++) set.add(i);
    return set;
  };

  const focusTile = (index: number) => {
    setFocusIndex(index);
    const tile = tiles.current[index];
    tile?.focus({ preventScroll: true });
    tile?.scrollIntoView({ block: "nearest" });
  };

  // Tiles flow into however many columns fit, so count them from layout.
  const columns = () => {
    const top = tiles.current[0]?.offsetTop;
    return Math.max(1, tiles.current.filter((t) => t?.offsetTop === top).length);
  };

  const paintMarquee = () => {
    const d = drag.current;
    const content = contentRef.current;
    const marquee = marqueeRef.current;
    if (!d || !content || !marquee) return;
    const box = content.getBoundingClientRect();
    // Clamped to the content, so the marquee never widens the scroll area.
    const x = Math.min(Math.max(d.clientX - box.left, 0), content.offsetWidth);
    const y = Math.min(Math.max(d.clientY - box.top, 0), content.offsetHeight);
    const left = Math.min(d.x, x);
    const top = Math.min(d.y, y);
    const right = Math.max(d.x, x);
    const bottom = Math.max(d.y, y);
    marquee.style.transform = `translate(${left}px, ${top}px)`;
    marquee.style.width = `${right - left}px`;
    marquee.style.height = `${bottom - top}px`;

    const next = new Set(d.base);
    d.boxes.forEach((b, i) => {
      if (b.left < right && b.right > left && b.top < bottom && b.bottom > top) {
        next.add(i);
      }
    });
    commit(next);
  };

  const autoscroll = () => {
    const d = drag.current;
    const scroller = scrollerRef.current;
    if (!d?.active || !scroller) return;
    const box = scroller.getBoundingClientRect();
    const fromTop = d.clientY - box.top;
    const fromBottom = box.bottom - d.clientY;
    let speed = 0;
    if (fromTop < SCROLL_EDGE) speed = -MAX_SCROLL * (1 - Math.max(fromTop, 0) / SCROLL_EDGE);
    else if (fromBottom < SCROLL_EDGE)
      speed = MAX_SCROLL * (1 - Math.max(fromBottom, 0) / SCROLL_EDGE);
    if (speed) {
      const before = scroller.scrollTop;
      scroller.scrollTop += speed;
      if (scroller.scrollTop !== before) paintMarquee();
    }
    frame.current = requestAnimationFrame(autoscroll);
  };

  const endDrag = () => {
    const d = drag.current;
    drag.current = null;
    cancelAnimationFrame(frame.current);
    const marquee = marqueeRef.current;
    if (!d?.active || !marquee) return;
    // Fades out quickly; it never holds up the next drag, which resets it.
    marquee.style.transition = `opacity 120ms ${EASE_OUT}`;
    marquee.style.opacity = "0";
  };

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    lastPointer.current = e.pointerType;
    if (e.button !== 0 || drag.current) return;
    // Touch keeps native scrolling; tapping tiles toggles them instead.
    if (e.pointerType === "touch") return;
    if ((e.target as Element).closest("[role=option]")) return;
    const content = e.currentTarget;
    // Stops text selection and keeps focus in the list for shortcuts.
    e.preventDefault();
    tiles.current[focusIndex]?.focus({ preventScroll: true });
    content.setPointerCapture(e.pointerId);
    const box = content.getBoundingClientRect();
    const additive = e.shiftKey || e.metaKey || e.ctrlKey;
    drag.current = {
      pointerId: e.pointerId,
      x: e.clientX - box.left,
      y: e.clientY - box.top,
      clientX: e.clientX,
      clientY: e.clientY,
      base: additive ? new Set(selectedRef.current) : null,
      active: false,
      // Measured once per drag; positions inside the content never change.
      boxes: tiles.current.map((t) =>
        t
          ? {
              left: t.offsetLeft,
              top: t.offsetTop,
              right: t.offsetLeft + t.offsetWidth,
              bottom: t.offsetTop + t.offsetHeight,
            }
          : { left: 0, top: 0, right: 0, bottom: 0 },
      ),
    };
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || e.pointerId !== d.pointerId) return;
    d.clientX = e.clientX;
    d.clientY = e.clientY;
    if (!d.active) {
      const box = e.currentTarget.getBoundingClientRect();
      const moved = Math.hypot(e.clientX - box.left - d.x, e.clientY - box.top - d.y);
      if (moved < DRAG_THRESHOLD) return;
      d.active = true;
      const marquee = marqueeRef.current;
      if (marquee) {
        // Appears instantly: it is drawn by the hand, not by the interface.
        marquee.style.transition = "none";
        marquee.style.opacity = "1";
      }
      frame.current = requestAnimationFrame(autoscroll);
    }
    paintMarquee();
  };

  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || e.pointerId !== d.pointerId) return;
    // A plain click on empty space clears, like the desktop.
    if (!d.active && !d.base) {
      commit(new Set());
      anchor.current = null;
    }
    endDrag();
  };

  const onTileClick = (index: number, e: React.MouseEvent) => {
    const set = new Set(selectedRef.current);
    if (lastPointer.current === "touch") {
      // No modifier keys on touch, so every tap toggles.
      if (set.has(index)) set.delete(index);
      else set.add(index);
      anchor.current = index;
    } else if (e.shiftKey) {
      const from = anchor.current ?? index;
      const span = range(from, index);
      commit(e.metaKey || e.ctrlKey ? new Set([...set, ...span]) : span);
      setFocusIndex(index);
      return;
    } else if (e.metaKey || e.ctrlKey) {
      if (set.has(index)) set.delete(index);
      else set.add(index);
      anchor.current = index;
    } else {
      set.clear();
      set.add(index);
      anchor.current = index;
    }
    commit(set);
    setFocusIndex(index);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    const last = items.length - 1;
    const cols = columns();
    const moves: Record<string, number> = {
      ArrowLeft: focusIndex - 1,
      ArrowRight: focusIndex + 1,
      ArrowUp: focusIndex - cols,
      ArrowDown: focusIndex + cols,
      Home: 0,
      End: last,
    };
    if (e.key in moves) {
      e.preventDefault();
      const next = moves[e.key];
      if (next < 0 || next > last) return;
      if (e.shiftKey) {
        // Shift extends from the anchor, the same as Shift-clicking.
        anchor.current ??= focusIndex;
        commit(range(anchor.current, next));
      }
      focusTile(next);
      return;
    }
    if (e.key === " ") {
      e.preventDefault();
      if (e.shiftKey && anchor.current !== null) {
        commit(new Set([...selectedRef.current, ...range(anchor.current, focusIndex)]));
        return;
      }
      const set = new Set(selectedRef.current);
      if (set.has(focusIndex)) set.delete(focusIndex);
      else set.add(focusIndex);
      anchor.current = focusIndex;
      commit(set);
      return;
    }
    if (e.key.toLowerCase() === "a" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      commit(range(0, last));
      return;
    }
    if (e.key === "Escape" && selectedRef.current.size > 0) {
      e.preventDefault();
      commit(new Set());
      anchor.current = null;
    }
  };

  const count = selected.size;
  const toggleAll = () => {
    commit(count > 0 ? new Set() : range(0, items.length - 1));
    anchor.current = null;
  };

  return (
    <div
      className={cn(
        "flex h-[360px] w-[min(520px,100%)] flex-col overflow-hidden rounded-2xl bg-surface shadow-raised select-none",
        className,
      )}
    >
      <div className="flex h-11 shrink-0 items-center justify-between border-b border-border px-4">
        <p className="text-sm font-medium text-foreground">{label}</p>
        <p className="text-xs text-muted tabular-nums">{items.length} items</p>
      </div>

      <div
        ref={scrollerRef}
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain [scrollbar-width:thin]"
      >
        <div
          ref={contentRef}
          className="relative p-3"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={endDrag}
          onLostPointerCapture={endDrag}
        >
          <div
            role="listbox"
            aria-label={label}
            aria-multiselectable
            aria-describedby={instructions}
            onKeyDown={onKeyDown}
            className="grid grid-cols-[repeat(auto-fill,minmax(104px,1fr))] gap-1"
          >
            {items.map((item, index) => {
              const on = selected.has(index);
              return (
                <div
                  key={item.id}
                  ref={(el) => {
                    tiles.current[index] = el;
                  }}
                  role="option"
                  aria-selected={on}
                  tabIndex={index === focusIndex ? 0 : -1}
                  onPointerDown={(e) => {
                    lastPointer.current = e.pointerType;
                  }}
                  onClick={(e) => onTileClick(index, e)}
                  onFocus={() => setFocusIndex(index)}
                  className="group flex cursor-default flex-col items-center gap-1.5 rounded-xl px-1 pt-2.5 pb-2 outline-hidden transition-[scale] duration-150 ease-out focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-foreground active:scale-[0.96] motion-reduce:transition-none"
                >
                  <span
                    className={cn(
                      "flex size-14 items-center justify-center rounded-[10px] text-foreground transition-[background-color] duration-100 ease-out",
                      on && "bg-foreground/[0.08]",
                    )}
                  >
                    <FileIcon kind={item.kind} />
                  </span>
                  <span
                    className={cn(
                      "max-w-full truncate rounded-md px-1.5 py-0.5 text-sm transition-[background-color,color] duration-100 ease-out",
                      on ? "bg-foreground text-background" : "text-foreground",
                    )}
                  >
                    {item.name}
                  </span>
                  <span className="text-xs text-muted tabular-nums">{item.meta}</span>
                </div>
              );
            })}
          </div>
          <div
            ref={marqueeRef}
            aria-hidden
            className="pointer-events-none absolute top-0 left-0 rounded-[3px] border border-foreground/30 bg-foreground/[0.06] opacity-0"
          />
        </div>
      </div>

      <div className="flex h-11 shrink-0 items-center justify-between border-t border-border pr-1.5 pl-4">
        <p className="text-sm text-muted tabular-nums" aria-live="polite">
          <span className="text-foreground">{count}</span> selected
        </p>
        <button
          type="button"
          onClick={toggleAll}
          className="grid h-8 touch-manipulation items-center rounded-lg px-2.5 text-sm text-muted outline-hidden transition-[scale,color,background-color] duration-150 ease-out hover:bg-foreground/[0.06] hover:text-foreground focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-foreground active:scale-[0.96] motion-reduce:transition-[color,background-color]"
        >
          {/* Both labels share one cell, so the button never changes width. */}
          <Swap visible={count === 0}>Select all</Swap>
          <Swap visible={count > 0}>Clear</Swap>
        </button>
      </div>

      <p id={instructions} className="sr-only">
        Arrow keys move, Space toggles, Shift with arrows extends the selection,
        Control or Command A selects all, Escape clears.
      </p>
    </div>
  );
}

function Swap({ visible, children }: { visible: boolean; children: React.ReactNode }) {
  return (
    <span
      aria-hidden={!visible}
      className={cn(
        "col-start-1 row-start-1 text-center transition-[opacity,filter] duration-150 ease-out motion-reduce:transition-[opacity]",
        !visible && "opacity-0 blur-[4px]",
      )}
    >
      {children}
    </span>
  );
}

const ICONS: Record<Kind, React.ReactNode> = {
  folder: <path d="M3.5 7.5a2 2 0 0 1 2-2h3.6l2 2.2h7.4a2 2 0 0 1 2 2v7.8a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2Z" />,
  doc: (
    <>
      <path d="M6.5 3.5h7l4 4v11a2 2 0 0 1-2 2h-9a2 2 0 0 1-2-2v-13a2 2 0 0 1 2-2Z" />
      <path d="M13.5 3.5v4h4M8.5 12.5h7M8.5 16h5" />
    </>
  ),
  image: (
    <>
      <rect x="3.5" y="4.5" width="17" height="15" rx="2" />
      <circle cx="9" cy="9.5" r="1.5" />
      <path d="m4 17.5 4.5-4.5 3.5 3.5 2.5-2.5 5.5 5" />
    </>
  ),
  sheet: (
    <>
      <rect x="3.5" y="4.5" width="17" height="15" rx="2" />
      <path d="M3.5 9.5h17M3.5 14.5h17M9.5 9.5v10" />
    </>
  ),
  code: (
    <>
      <path d="M6.5 3.5h7l4 4v11a2 2 0 0 1-2 2h-9a2 2 0 0 1-2-2v-13a2 2 0 0 1 2-2Z" />
      <path d="m10 11.5-2 2 2 2M14 11.5l2 2-2 2" />
    </>
  ),
  video: (
    <>
      <rect x="3.5" y="5.5" width="17" height="13" rx="2" />
      <path d="m10.5 9.5 4 2.5-4 2.5Z" />
    </>
  ),
  audio: (
    <>
      <path d="M9.5 17.5v-11l9-2v11" />
      <circle cx="7.5" cy="17.5" r="2" />
      <circle cx="16.5" cy="15.5" r="2" />
    </>
  ),
  archive: (
    <>
      <rect x="4.5" y="3.5" width="15" height="17" rx="2" />
      <path d="M12 3.5v2M12 7.5v2M12 11.5v2M10.5 15.5h3v2.5h-3Z" />
    </>
  ),
};

function FileIcon({ kind }: { kind: Kind }) {
  return (
    <svg
      viewBox="0 0 24 24"
      // Drawn at 36px, so a 1.25 stroke lands near 2px, matching the weight
      // of the 14px label below it.
      className="size-9"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.25}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {ICONS[kind]}
    </svg>
  );
}

const FILES: DragSelectItem[] = [
  { id: "1", name: "Projects", meta: "12 items", kind: "folder" },
  { id: "2", name: "Invoices", meta: "48 items", kind: "folder" },
  { id: "3", name: "Brief.pdf", meta: "240 KB", kind: "doc" },
  { id: "4", name: "Roadmap.md", meta: "8 KB", kind: "doc" },
  { id: "5", name: "Cover.png", meta: "2.1 MB", kind: "image" },
  { id: "6", name: "Budget.csv", meta: "36 KB", kind: "sheet" },
  { id: "7", name: "index.ts", meta: "4 KB", kind: "code" },
  { id: "8", name: "Intro.mp4", meta: "84 MB", kind: "video" },
  { id: "9", name: "Theme.wav", meta: "9.6 MB", kind: "audio" },
  { id: "10", name: "Backup.zip", meta: "1.2 GB", kind: "archive" },
  { id: "11", name: "Sketch.png", meta: "860 KB", kind: "image" },
  { id: "12", name: "Notes.txt", meta: "2 KB", kind: "doc" },
  { id: "13", name: "Metrics.csv", meta: "120 KB", kind: "sheet" },
  { id: "14", name: "server.go", meta: "11 KB", kind: "code" },
  { id: "15", name: "Demo.mov", meta: "210 MB", kind: "video" },
  { id: "16", name: "Assets", meta: "96 items", kind: "folder" },
];

export default function DragSelectDemo() {
  return <DragSelect items={FILES} label="Documents" />;
}
