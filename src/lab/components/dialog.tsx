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
import { createPortal } from "react-dom";
import { AnimatePresence, motion, useIsPresent } from "motion/react";
import { useReducedMotion } from "@/lib/use-reduced-motion";
import { cn } from "@/lib/cn";

const EASE_OUT = [0.23, 1, 0.32, 1] as const;
const OPEN = { duration: 0.2, ease: EASE_OUT };
// Leaving is quicker than arriving: once dismissed, it should get out of the way.
const CLOSE = { duration: 0.15, ease: EASE_OUT };

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

// Counted, so a nested dialog closing doesn't unlock the page under its parent.
let scrollLocks = 0;
let savedBody = { overflow: "", paddingRight: "" };

function lockScroll() {
  if (scrollLocks++ > 0) return;
  const body = document.body;
  // Hiding overflow removes the scrollbar; padding by its width keeps the
  // page from sliding sideways under the backdrop.
  const gap = window.innerWidth - document.documentElement.clientWidth;
  const padding = parseFloat(getComputedStyle(body).paddingRight) || 0;
  savedBody = {
    overflow: body.style.overflow,
    paddingRight: body.style.paddingRight,
  };
  body.style.overflow = "hidden";
  if (gap > 0) body.style.paddingRight = `${padding + gap}px`;
}

function unlockScroll() {
  if (--scrollLocks > 0) return;
  document.body.style.overflow = savedBody.overflow;
  document.body.style.paddingRight = savedBody.paddingRight;
}

const subscribeNoop = () => () => {};
// The portal needs document.body, which only exists on the client.
function useIsClient() {
  return useSyncExternalStore(
    subscribeNoop,
    () => true,
    () => false,
  );
}

type Parent = {
  setChildOpen: (open: boolean) => void;
  openRef: React.RefObject<boolean>;
};
const ParentContext = createContext<Parent | null>(null);

export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  role = "dialog",
  className,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: React.ReactNode;
  description?: React.ReactNode;
  /** "alertdialog" for confirmations that interrupt with a question. */
  role?: "dialog" | "alertdialog";
  className?: string;
  children?: React.ReactNode;
}) {
  const isClient = useIsClient();
  const reduceMotion = useReducedMotion();
  const id = useId();
  const parent = useContext(ParentContext);
  const panelRef = useRef<HTMLDivElement>(null);
  const [childOpen, setChildOpenState] = useState(false);
  const childOpenRef = useRef(false);
  const openRef = useRef(open);

  const setChildOpen = useCallback((next: boolean) => {
    childOpenRef.current = next;
    setChildOpenState(next);
  }, []);
  const context = useMemo(() => ({ setChildOpen, openRef }), [setChildOpen]);

  // A layout effect, so it's current before the passive cleanups below read it.
  useLayoutEffect(() => {
    openRef.current = open;
  }, [open]);

  useEffect(() => {
    if (!open || !parent) return;
    parent.setChildOpen(true);
    return () => parent.setChildOpen(false);
  }, [open, parent]);

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const panel = panelRef.current;
    const initial =
      panel?.querySelector<HTMLElement>("[data-autofocus]") ??
      panel?.querySelector<HTMLElement>(FOCUSABLE) ??
      panel;
    initial?.focus({ preventScroll: true });
    lockScroll();

    const onKeyDown = (e: KeyboardEvent) => {
      // A nested dialog on top owns the keyboard until it closes.
      if (childOpenRef.current || e.key !== "Escape") return;
      e.preventDefault();
      onOpenChange(false);
    };
    // Focus that escapes anyway (screen reader navigation, a click that lands
    // on the page behind) is pulled back in.
    const onFocusIn = (e: FocusEvent) => {
      if (childOpenRef.current || !panel) return;
      if (!panel.contains(e.target as Node))
        panel.focus({ preventScroll: true });
    };
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("focusin", onFocusIn);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("focusin", onFocusIn);
      unlockScroll();
      // If the parent closed in the same moment, it hands focus back to its
      // own trigger instead; this one sits inside a panel that's leaving.
      if (parent && !parent.openRef.current) return;
      const restore = () => previous?.focus({ preventScroll: true });
      // The parent is still inert until it re-renders, and inert elements
      // refuse focus, so wait a frame for it to come back.
      if (previous?.closest("[inert]")) requestAnimationFrame(restore);
      else restore();
    };
  }, [open, onOpenChange, parent]);

  if (!isClient) return null;

  return createPortal(
    <AnimatePresence>
      {open && (
        <Layer
          key="layer"
          panelRef={panelRef}
          id={id}
          role={role}
          title={title}
          description={description}
          receded={childOpen}
          reduceMotion={!!reduceMotion}
          onClose={() => onOpenChange(false)}
          className={className}
        >
          <ParentContext.Provider value={context}>
            {children}
          </ParentContext.Provider>
        </Layer>
      )}
    </AnimatePresence>,
    document.body,
  );
}

function Layer({
  panelRef,
  id,
  role,
  title,
  description,
  receded,
  reduceMotion,
  onClose,
  className,
  children,
}: {
  panelRef: React.RefObject<HTMLDivElement | null>;
  id: string;
  role: "dialog" | "alertdialog";
  title: React.ReactNode;
  description?: React.ReactNode;
  receded: boolean;
  reduceMotion: boolean;
  onClose: () => void;
  className?: string;
  children: React.ReactNode;
}) {
  // While it animates out, clicks and focus go straight through to the page,
  // so the exit never holds up the next interaction.
  const isPresent = useIsPresent();
  // Only a press that starts on the backdrop closes, so dragging a text
  // selection out of the panel doesn't dismiss it.
  const pressedBackdrop = useRef(false);

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "Tab") return;
    const items = [
      ...e.currentTarget.querySelectorAll<HTMLElement>(FOCUSABLE),
    ].filter((el) => el.getClientRects().length > 0);
    if (!items.length) {
      e.preventDefault();
      return;
    }
    const first = items[0];
    const last = items[items.length - 1];
    const active = document.activeElement;
    if (e.shiftKey && (active === first || active === e.currentTarget)) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && active === last) {
      e.preventDefault();
      first.focus();
    }
  };

  return (
    <div
      className={cn("fixed inset-0 z-50", !isPresent && "pointer-events-none")}
    >
      {/* Token-only dim: a grey wash in light, near black in dark. A nested
          dialog's backdrop stacks on this one, which is what dims the parent. */}
      <motion.div
        aria-hidden
        className="absolute inset-0 bg-foreground/15 dark:bg-background/70"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1, transition: OPEN }}
        exit={{ opacity: 0, transition: CLOSE }}
        onPointerDown={(e) => {
          pressedBackdrop.current = e.target === e.currentTarget;
        }}
        onClick={(e) => {
          if (pressedBackdrop.current && e.target === e.currentTarget)
            onClose();
          pressedBackdrop.current = false;
        }}
      />
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-4">
        <motion.div
          ref={panelRef}
          role={role}
          aria-modal="true"
          aria-labelledby={`${id}-title`}
          aria-describedby={description ? `${id}-description` : undefined}
          tabIndex={-1}
          // Behind a nested dialog it stays visible but unreachable, until
          // it's back in front.
          inert={receded || !isPresent}
          onKeyDown={onKeyDown}
          // Modals scale from the center: they belong to the viewport, not
          // to the button that opened them.
          initial={reduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.96 }}
          // A small step back while a nested dialog is on top, so the new one
          // reads as in front of it.
          animate={{
            opacity: 1,
            scale: receded && !reduceMotion ? 0.97 : 1,
            transition: OPEN,
          }}
          // Softer than the entrance: a smaller shrink, and faster.
          exit={
            reduceMotion
              ? { opacity: 0, transition: CLOSE }
              : { opacity: 0, scale: 0.98, transition: CLOSE }
          }
          className={cn(
            "pointer-events-auto w-[440px] max-w-full rounded-2xl bg-background p-6 shadow-raised outline-hidden",
            className,
          )}
        >
          <h2
            id={`${id}-title`}
            className="text-lg font-semibold tracking-tight text-foreground"
          >
            {title}
          </h2>
          {description && (
            <p
              id={`${id}-description`}
              className="mt-1.5 text-sm text-pretty text-muted"
            >
              {description}
            </p>
          )}
          {children}
        </motion.div>
      </div>
    </div>
  );
}

const button =
  "flex h-10 touch-manipulation items-center justify-center rounded-full px-4 text-sm font-medium outline-hidden transition-[scale,background-color] duration-150 ease-out select-none focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-foreground active:scale-[0.96] motion-reduce:transition-[background-color]";
const secondary = cn(button, "bg-surface text-foreground hover:bg-border");
const primary = cn(
  button,
  "bg-foreground text-background hover:bg-foreground/85",
);

export default function DialogDemo() {
  const inputId = useId();
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [name, setName] = useState("northwind-web");
  const [draft, setDraft] = useState(name);
  const [deleted, setDeleted] = useState(false);

  return (
    // 12px padding + the 20px button radius = 32px, so the corners nest.
    <div className="flex w-[min(400px,100%)] items-center gap-3 rounded-[32px] bg-background py-3 pr-3 pl-6 shadow-raised">
      <div className="min-w-0 flex-1">
        <p className="truncate text-[15px] font-medium text-foreground">
          {name}
        </p>
        <p className="mt-0.5 text-sm text-muted">
          {deleted ? "Scheduled for deletion" : "Deployed 2 hours ago"}
        </p>
      </div>
      <button
        type="button"
        aria-haspopup="dialog"
        onClick={() => {
          setDraft(name);
          setOpen(true);
        }}
        className={secondary}
      >
        Settings
      </button>

      <Dialog
        open={open}
        onOpenChange={setOpen}
        title="Project settings"
        description="Changes apply to every environment of this project."
      >
        <form
          className="mt-5"
          onSubmit={(e) => {
            e.preventDefault();
            if (draft.trim()) setName(draft.trim());
            setOpen(false);
          }}
        >
          <label
            htmlFor={inputId}
            className="text-sm font-medium text-foreground"
          >
            Project name
          </label>
          <input
            id={inputId}
            data-autofocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            spellCheck={false}
            autoComplete="off"
            className="mt-1.5 h-10 w-full rounded-lg bg-surface px-3 text-[15px] text-foreground outline-hidden focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-foreground"
          />

          {/* 10px padding + the 18px button radius = 28px. */}
          <div className="mt-5 flex items-center gap-3 rounded-[28px] border border-border py-2.5 pr-2.5 pl-5">
            <p className="min-w-0 flex-1 text-sm text-pretty text-muted">
              Delete this project and all of its deployments.
            </p>
            <button
              type="button"
              aria-haspopup="dialog"
              onClick={() => setConfirming(true)}
              className={cn(
                button,
                "h-9 shrink-0 bg-danger/10 px-3.5 text-danger hover:bg-danger/15",
              )}
            >
              Delete project
            </button>
          </div>

          <div className="mt-6 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setOpen(false)}
              className={secondary}
            >
              Cancel
            </button>
            <button type="submit" className={primary}>
              Save
            </button>
          </div>
        </form>

        <Dialog
          open={confirming}
          onOpenChange={setConfirming}
          role="alertdialog"
          title={`Delete ${name}?`}
          description="Its 24 deployments go with it. This can't be undone."
          className="w-[360px]"
        >
          <div className="mt-6 flex justify-end gap-2">
            {/* The safe choice takes focus, so a stray Enter can't delete. */}
            <button
              type="button"
              data-autofocus
              onClick={() => setConfirming(false)}
              className={secondary}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => {
                setDeleted(true);
                setConfirming(false);
                setOpen(false);
              }}
              className={cn(button, "bg-danger text-white hover:bg-danger/90")}
            >
              Delete
            </button>
          </div>
        </Dialog>
      </Dialog>
    </div>
  );
}
