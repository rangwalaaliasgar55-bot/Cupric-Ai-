import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/cn";

// The iOS drawer curve: fast out of the gate, long gentle settle. Closing is
// quicker than opening because exits should get out of the way.
const EASE = "cubic-bezier(0.32, 0.72, 0, 1)";
const OPEN = `transform 500ms ${EASE}`;
const CLOSE = `transform 300ms ${EASE}, visibility 0s 300ms`;
const FADE_OPEN = `opacity 500ms ${EASE}`;
const FADE_CLOSE = `opacity 300ms ${EASE}`;

// A release faster than this (px per ms) dismisses however short the drag,
// so a quick flick is enough.
const FLICK_VELOCITY = 0.11;
// Otherwise the sheet must be dragged past this share of its height.
const DISMISS_DISTANCE = 0.25;

export function Sheet({
  open,
  onOpenChange,
  label,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  label: string;
  children: React.ReactNode;
}) {
  const sheetRef = useRef<HTMLDivElement>(null);
  const backdropRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ startY: number; startTime: number; dy: number }>(
    null,
  );

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    sheetRef.current?.focus({ preventScroll: true });
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onOpenChange(false);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      previous?.focus({ preventScroll: true });
    };
  }, [open, onOpenChange]);

  // During a drag the styles are written straight to the elements, so moving
  // the pointer never re-renders React. On release they're set to exactly
  // what React renders for the resulting state, and the transition picks up
  // from wherever the finger let go.
  const settle = (close: boolean) => {
    const sheet = sheetRef.current;
    const backdrop = backdropRef.current;
    if (!sheet || !backdrop) return;
    sheet.style.transition = close ? CLOSE : OPEN;
    sheet.style.transform = close ? "translateY(100%)" : "translateY(0)";
    backdrop.style.transition = close ? FADE_CLOSE : FADE_OPEN;
    backdrop.style.opacity = close ? "0" : "1";
    if (close) onOpenChange(false);
  };

  return (
    <>
      <div
        ref={backdropRef}
        aria-hidden
        className={cn(
          "fixed inset-0 z-50 bg-black/40",
          !open && "pointer-events-none",
        )}
        style={{ opacity: open ? 1 : 0, transition: open ? FADE_OPEN : FADE_CLOSE }}
        onClick={() => onOpenChange(false)}
      />
      <div
        ref={sheetRef}
        role="dialog"
        aria-modal
        aria-label={label}
        tabIndex={-1}
        inert={!open}
        className={cn(
          "fixed inset-x-0 bottom-0 z-50 mx-auto w-full max-w-md cursor-grab touch-none rounded-t-[28px] bg-background px-6 pt-3 pb-8 shadow-[0_0_0_1px_var(--border),0_-8px_40px_oklch(0_0_0/0.15)] outline-hidden select-none active:cursor-grabbing motion-reduce:transition-none!",
          // The surface continues below the screen edge, so pulling the sheet
          // up reveals more sheet rather than a gap.
          "after:absolute after:inset-x-0 after:top-full after:h-[50vh] after:bg-background after:shadow-[1px_0_0_var(--border),-1px_0_0_var(--border)]",
          open ? "visible" : "invisible",
        )}
        style={{
          transform: open ? "translateY(0)" : "translateY(100%)",
          transition: open ? OPEN : CLOSE,
        }}
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          if ((e.target as HTMLElement).closest("button, a, input, textarea")) {
            return;
          }
          drag.current = {
            startY: e.clientY,
            startTime: performance.now(),
            dy: 0,
          };
          e.currentTarget.setPointerCapture(e.pointerId);
          e.currentTarget.style.transition = "none";
          if (backdropRef.current) backdropRef.current.style.transition = "none";
        }}
        onPointerMove={(e) => {
          if (!drag.current) return;
          let dy = e.clientY - drag.current.startY;
          // Past the top it still gives, but less the further you pull, like
          // stretching something that wants to snap back.
          if (dy < 0) dy = -Math.pow(-dy, 0.7);
          drag.current.dy = dy;
          e.currentTarget.style.transform = `translateY(${dy}px)`;
          const progress = Math.max(dy, 0) / e.currentTarget.offsetHeight;
          if (backdropRef.current) {
            backdropRef.current.style.opacity = String(1 - progress);
          }
        }}
        onPointerUp={(e) => {
          if (!drag.current) return;
          const { dy, startTime } = drag.current;
          drag.current = null;
          const velocity = dy / (performance.now() - startTime);
          const height = e.currentTarget.offsetHeight;
          settle(dy > height * DISMISS_DISTANCE || velocity > FLICK_VELOCITY);
        }}
        onPointerCancel={() => {
          if (!drag.current) return;
          drag.current = null;
          settle(false);
        }}
      >
        <div className="mx-auto mb-5 h-1.5 w-10 rounded-full bg-border" />
        {children}
      </div>
    </>
  );
}

export default function SheetDemo() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="h-10 rounded-full bg-surface px-4 text-sm font-medium shadow-raised transition-[scale] duration-150 ease-out active:scale-[0.96] motion-reduce:transition-none"
      >
        Open sheet
      </button>
      <Sheet open={open} onOpenChange={setOpen} label="Lab notes">
        <h2 className="text-base font-medium">Lab notes</h2>
        <p className="mt-1.5 text-sm text-pretty text-muted">
          Drag this sheet down to close it. A quick flick works too, and
          dragging it up pushes back.
        </p>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="mt-6 h-11 w-full rounded-full bg-foreground text-sm font-medium text-background transition-[scale] duration-150 ease-out active:scale-[0.96] motion-reduce:transition-none"
        >
          Done
        </button>
      </Sheet>
    </>
  );
}
