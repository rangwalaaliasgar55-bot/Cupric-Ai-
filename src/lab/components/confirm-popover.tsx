import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { motion } from "motion/react";
import { useReducedMotion } from "@/lib/use-reduced-motion";
import { cn } from "@/lib/cn";

const ICON_SWAP = { type: "spring", duration: 0.3, bounce: 0 } as const;

export function ConfirmPopover({
  title = "Delete this file?",
  description = "This can't be undone.",
  confirmLabel = "Delete",
  doneLabel = "Deleted",
  announcement = "File deleted",
  onConfirm,
  // Long enough to register the check, then the button is usable again.
  resetAfter = 2400,
  className,
}: {
  title?: string;
  description?: string;
  confirmLabel?: string;
  doneLabel?: string;
  announcement?: string;
  onConfirm?: () => void;
  resetAfter?: number;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [done, setDone] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const reset = useRef<ReturnType<typeof setTimeout>>(undefined);
  const id = useId();

  useEffect(() => () => clearTimeout(reset.current), []);

  // The caret and the scale origin both sit over the trigger's center. The
  // trigger keeps one width (both labels share a cell), so measuring once is
  // enough.
  useLayoutEffect(() => {
    const trigger = triggerRef.current;
    const popover = popoverRef.current;
    if (trigger && popover)
      popover.style.setProperty("--anchor", `${trigger.offsetWidth / 2}px`);
  }, []);

  useEffect(() => {
    if (!open) return;
    // Cancel is the safe default: an Enter pressed out of habit keeps the file.
    cancelRef.current?.focus();
    const onPointerDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  const close = () => {
    setOpen(false);
    triggerRef.current?.focus();
  };

  const confirm = () => {
    close();
    setDone(true);
    onConfirm?.();
    clearTimeout(reset.current);
    reset.current = setTimeout(() => setDone(false), resetAfter);
  };

  return (
    <div ref={rootRef} className={cn("relative inline-flex", className)}>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={id}
        aria-disabled={done}
        onClick={() => !done && setOpen((o) => !o)}
        className={cn(
          "h-10 touch-manipulation rounded-full bg-background px-4 text-sm font-medium shadow-raised outline-hidden transition-[scale,color] duration-150 ease-out select-none focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-foreground active:scale-[0.96] motion-reduce:transition-[color]",
          done ? "text-foreground active:scale-100" : "text-danger",
        )}
      >
        {/* Both labels share one cell, so the button keeps the wider width
            and never shifts when it turns into Deleted. */}
        <span className="grid">
          <Variant visible={!done} icon={<TrashIcon />}>
            {confirmLabel}
          </Variant>
          <Variant visible={done} icon={<path d="m3.5 8.5 3 3 6-7" />}>
            {doneLabel}
          </Variant>
        </span>
      </button>

      <div
        ref={popoverRef}
        id={id}
        role="alertdialog"
        aria-labelledby={`${id}-title`}
        aria-describedby={`${id}-desc`}
        inert={!open}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.stopPropagation();
            close();
          }
          // Two buttons, so Tab simply alternates between them while open.
          if (e.key === "Tab") {
            e.preventDefault();
            const next =
              document.activeElement === cancelRef.current ? confirmRef : cancelRef;
            next.current?.focus();
          }
        }}
        // Grows out of the caret's tip, so it reads as coming from the button.
        style={{ transformOrigin: "calc(100% - var(--anchor, 50%)) -6px" }}
        className={cn(
          "absolute top-full right-0 z-10 mt-3 w-[min(272px,calc(100vw-32px))] rounded-[22px] bg-background p-3 text-foreground shadow-raised",
          "transition-[opacity,scale,visibility] ease-[cubic-bezier(0.23,1,0.32,1)]",
          // Opens in 200ms, closes in 150ms: the exit should never hold the eye.
          open
            ? "visible scale-100 opacity-100 duration-200"
            : "invisible scale-[0.96] opacity-0 duration-150 motion-reduce:scale-100",
        )}
      >
        <span
          aria-hidden
          className="absolute -top-[5px] size-2.5 rotate-45 rounded-tl-[2px] bg-background"
          style={{
            right: "calc(var(--anchor, 50%) - 5px)",
            // Draws only the two edges that stick out, matching the ring in
            // shadow-raised so caret and body read as one outline.
            boxShadow:
              "-1px -1px 0 0 color-mix(in oklab, var(--foreground) 8%, transparent)",
          }}
        />
        <div className="px-1.5 pt-1.5 pb-3">
          <p id={`${id}-title`} className="text-[15px] font-medium">
            {title}
          </p>
          <p id={`${id}-desc`} className="mt-1 text-sm text-muted">
            {description}
          </p>
        </div>
        {/* 10px corners inside 12px of padding keep the radii concentric:
            22 = 10 + 12. */}
        <div className="flex gap-2">
          <button
            ref={cancelRef}
            type="button"
            onClick={close}
            className="h-9 flex-1 touch-manipulation rounded-[10px] bg-surface text-sm font-medium outline-hidden transition-[scale,background-color] duration-150 ease-out select-none hover:bg-border focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-foreground active:scale-[0.96] motion-reduce:transition-[background-color]"
          >
            Cancel
          </button>
          <button
            ref={confirmRef}
            type="button"
            onClick={confirm}
            className="h-9 flex-1 touch-manipulation rounded-[10px] bg-danger text-sm font-medium text-white outline-hidden transition-[scale,opacity] duration-150 ease-out select-none hover:opacity-90 focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-foreground active:scale-[0.96] motion-reduce:transition-[opacity]"
          >
            {confirmLabel}
          </button>
        </div>
      </div>

      <span className="sr-only" aria-live="polite">
        {done ? announcement : ""}
      </span>
    </div>
  );
}

function TrashIcon() {
  return (
    <path d="M2.75 4.25h10.5M6.25 4.25v-1.5h3.5v1.5M4 4.25l.6 8.1a1 1 0 0 0 1 .9h4.8a1 1 0 0 0 1-.9l.6-8.1M6.75 7v3.75M9.25 7v3.75" />
  );
}

function Variant({
  visible,
  icon,
  children,
}: {
  visible: boolean;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  const reduceMotion = useReducedMotion();
  // Reduced motion keeps the cross-fade but drops the scale and blur.
  const hidden = reduceMotion
    ? { opacity: 0 }
    : { scale: 0.25, opacity: 0, filter: "blur(4px)" };
  return (
    <span
      aria-hidden={!visible}
      className="col-start-1 row-start-1 flex items-center justify-center gap-2"
    >
      <motion.svg
        viewBox="0 0 16 16"
        className="size-4 shrink-0"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        initial={false}
        animate={visible ? { scale: 1, opacity: 1, filter: "blur(0px)" } : hidden}
        transition={ICON_SWAP}
      >
        {icon}
      </motion.svg>
      <span
        className={cn(
          "transition-[opacity,filter] duration-200 ease-out",
          !visible && "opacity-0 blur-[4px] motion-reduce:blur-none",
        )}
      >
        {children}
      </span>
    </span>
  );
}

export default function ConfirmPopoverDemo() {
  const [deleted, setDeleted] = useState(false);
  const restore = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => () => clearTimeout(restore.current), []);

  return (
    // Leaves room below for the popover, so opening it never changes the
    // demo's height.
    <div className="w-[min(440px,100%)] pb-[150px]">
      {/* 8px around the 40px button: 28 = 20 + 8 keeps the radii concentric. */}
      <div className="flex items-center gap-3 rounded-[28px] bg-surface py-2 pr-2 pl-5">
        <div className="min-w-0 flex-1">
          <p
            className={cn(
              "truncate text-[15px] font-medium transition-[color] duration-200 ease-out",
              deleted ? "text-muted" : "text-foreground",
            )}
          >
            q3-report.pdf
          </p>
          <p className="text-[13px] text-muted">2.4 MB, edited 3h ago</p>
        </div>
        <ConfirmPopover
          onConfirm={() => {
            setDeleted(true);
            clearTimeout(restore.current);
            // Brings the file back with the button, so the demo can be rerun.
            restore.current = setTimeout(() => setDeleted(false), 2400);
          }}
        />
      </div>
    </div>
  );
}
