import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "motion/react";
import { useReducedMotion } from "@/lib/use-reduced-motion";
import { cn } from "@/lib/cn";

const EASE_OUT = [0.23, 1, 0.32, 1] as const;
// A power-user surface, opened and closed in quick succession: the panel
// should arrive rather than blink, and never make anyone wait.
const OPEN = { duration: 0.15, ease: EASE_OUT };
const CLOSE = { duration: 0.1, ease: EASE_OUT };
// Long enough to register the row lighting up, short enough to be gone
// before the next press.
const FLASH_MS = 600;

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])';

export type Shortcut = {
  id: string;
  label: string;
  group: string;
  /** "Mod" is ⌘ on Apple platforms and Ctrl elsewhere; the last key is the trigger. */
  keys: string[];
};

const subscribeNoop = () => () => {};
function useIsMac() {
  // Server renders "Ctrl"; the client corrects it without a hydration mismatch.
  return useSyncExternalStore(
    subscribeNoop,
    () => /Mac|iPhone|iPad/.test(navigator.platform),
    () => false,
  );
}

// The portal needs document.body, which only exists on the client.
function useIsClient() {
  return useSyncExternalStore(
    subscribeNoop,
    () => true,
    () => false,
  );
}

const MAC_GLYPHS: Record<string, string> = {
  Mod: "⌘",
  Shift: "⇧",
  Alt: "⌥",
};
const SPOKEN: Record<string, string> = {
  "[": "left bracket",
  "]": "right bracket",
  "=": "equals",
  "-": "minus",
  "?": "question mark",
};

function glyph(key: string, isMac: boolean) {
  if (key === "Mod") return isMac ? "⌘" : "Ctrl";
  return (isMac && MAC_GLYPHS[key]) || key;
}

function spoken(keys: string[], isMac: boolean) {
  return keys
    .map((k) =>
      k === "Mod" ? (isMac ? "Command" : "Control") : (SPOKEN[k] ?? k),
    )
    .join(" ");
}

function matches(e: KeyboardEvent, keys: string[], isMac: boolean) {
  const key = keys[keys.length - 1];
  const mod = isMac ? e.metaKey : e.ctrlKey;
  const other = isMac ? e.ctrlKey : e.metaKey;
  if (other || mod !== keys.includes("Mod") || e.altKey !== keys.includes("Alt"))
    return false;
  // "?" is itself a shifted key, so Shift isn't listed for it.
  if (key === "?") return e.key === "?";
  if (e.shiftKey !== keys.includes("Shift")) return false;
  return e.key.toLowerCase() === key.toLowerCase();
}

function isEditable(target: EventTarget | null) {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable ||
      target.closest("input, textarea, select, [contenteditable]") !== null)
  );
}

let savedOverflow = "";
let savedPadding = "";
function lockScroll() {
  const body = document.body;
  // Padding by the scrollbar's width keeps the page from shifting sideways.
  const gap = window.innerWidth - document.documentElement.clientWidth;
  savedOverflow = body.style.overflow;
  savedPadding = body.style.paddingRight;
  const padding = parseFloat(getComputedStyle(body).paddingRight) || 0;
  body.style.overflow = "hidden";
  if (gap > 0) body.style.paddingRight = `${padding + gap}px`;
}
function unlockScroll() {
  document.body.style.overflow = savedOverflow;
  document.body.style.paddingRight = savedPadding;
}

export function ShortcutSheet({
  shortcuts,
  className,
}: {
  shortcuts: Shortcut[];
  className?: string;
}) {
  const isMac = useIsMac();
  const isClient = useIsClient();
  const reduceMotion = useReducedMotion();
  const id = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [flash, setFlash] = useState<string | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const flashTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    const found = shortcuts.filter(
      (s) =>
        !q ||
        s.label.toLowerCase().includes(q) ||
        s.group.toLowerCase().includes(q),
    );
    const groups = [...new Set(found.map((s) => s.group))];
    return {
      count: found.length,
      groups: groups.map((group) => ({
        group,
        items: found.filter((s) => s.group === group),
      })),
    };
  }, [shortcuts, query]);

  // Read inside the key handler without re-binding it on every keystroke.
  const visible = useRef(results);
  useEffect(() => {
    visible.current = results;
  }, [results]);

  const show = useCallback(() => {
    setQuery("");
    setFlash(null);
    setOpen(true);
  }, []);
  const close = useCallback(() => setOpen(false), []);

  useEffect(() => () => clearTimeout(flashTimer.current), []);

  // Closed: "?" anywhere opens it, unless it's being typed into a field.
  useEffect(() => {
    if (open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "?" || e.metaKey || e.ctrlKey || e.altKey || e.repeat)
        return;
      if (isEditable(e.target)) return;
      // Inert copies, like the index preview, stay quiet.
      if (triggerRef.current?.closest("[inert]")) return;
      e.preventDefault();
      show();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, show]);

  // Open: Escape closes, and any listed shortcut lights up its row.
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    lockScroll();

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        close();
        return;
      }
      const typing = isEditable(e.target);
      if (e.key === "?" && !typing && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        close();
        return;
      }
      const hit = visible.current.groups
        .flatMap((g) => g.items)
        .find((s) => matches(e, s.keys, isMac));
      if (!hit) return;
      // Plain keys belong to the search field while it has focus; only
      // modifier shortcuts can be demonstrated from there.
      if (typing && !hit.keys.includes("Mod")) return;
      // Undo and redo inside the field keep working natively.
      const nativeEdit = typing && /^[zZ]$/.test(e.key);
      if (!nativeEdit) e.preventDefault();
      setFlash(hit.id);
      clearTimeout(flashTimer.current);
      flashTimer.current = setTimeout(() => setFlash(null), FLASH_MS);
      document
        .getElementById(`${id}-${hit.id}`)
        ?.scrollIntoView({ block: "nearest" });
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      clearTimeout(flashTimer.current);
      unlockScroll();
      previous?.focus({ preventScroll: true });
    };
  }, [open, close, isMac, id]);

  const onPanelKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "Tab") return;
    const items = [
      ...e.currentTarget.querySelectorAll<HTMLElement>(FOCUSABLE),
    ].filter((el) => el.getClientRects().length > 0);
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-keyshortcuts="?"
        onClick={show}
        className={cn(
          "flex h-10 touch-manipulation items-center gap-2.5 rounded-full bg-surface pr-2 pl-4 text-sm font-medium text-foreground shadow-raised outline-hidden transition-[scale] duration-150 ease-out select-none focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-foreground active:scale-[0.96] motion-reduce:transition-none",
          className,
        )}
      >
        Keyboard shortcuts
        <Kbd>?</Kbd>
      </button>

      {isClient &&
        createPortal(
          <AnimatePresence>
            {open && (
              <motion.div
                key="sheet"
                className="fixed inset-0 z-50 flex items-center justify-center p-4"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1, transition: OPEN }}
                exit={{ opacity: 0, transition: CLOSE }}
              >
                {/* Token-only dim: a grey wash in light, near black in dark. */}
                <div
                  aria-hidden
                  className="absolute inset-0 bg-foreground/10 dark:bg-background/70"
                  onClick={close}
                />
                <motion.div
                  ref={panelRef}
                  role="dialog"
                  aria-modal="true"
                  aria-labelledby={`${id}-title`}
                  onKeyDown={onPanelKeyDown}
                  // Centered like any modal; the barest scale, so it lands
                  // rather than pops.
                  initial={reduceMotion ? false : { scale: 0.98 }}
                  animate={{ scale: 1, transition: OPEN }}
                  // A fixed height, so filtering never resizes the panel and
                  // the search field stays exactly where it is.
                  className="relative flex h-[min(480px,calc(100dvh-32px))] w-[520px] max-w-full flex-col overflow-hidden rounded-[20px] bg-background shadow-raised"
                >
                  <div className="flex h-14 shrink-0 items-center justify-between pr-2.5 pl-5">
                    <h2
                      id={`${id}-title`}
                      className="text-[15px] font-semibold text-foreground"
                    >
                      Keyboard shortcuts
                    </h2>
                    <button
                      type="button"
                      aria-label="Close"
                      onClick={close}
                      className="relative flex size-9 touch-manipulation items-center justify-center rounded-full text-muted outline-hidden transition-[scale,color,background-color] duration-150 ease-out select-none hover:bg-surface hover:text-foreground focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-foreground active:scale-[0.96] motion-reduce:transition-[color,background-color]"
                    >
                      <svg
                        viewBox="0 0 16 16"
                        className="size-4"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth={1.5}
                        strokeLinecap="round"
                        aria-hidden
                      >
                        <path d="m4.5 4.5 7 7M11.5 4.5l-7 7" />
                      </svg>
                    </button>
                  </div>

                  <div className="relative mx-3 shrink-0 text-muted">
                    <svg
                      viewBox="0 0 16 16"
                      className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth={1.5}
                      strokeLinecap="round"
                      aria-hidden
                    >
                      <circle cx="7" cy="7" r="4.25" />
                      <path d="m10.25 10.25 3 3" />
                    </svg>
                    <input
                      autoFocus
                      type="search"
                      aria-label="Search shortcuts"
                      aria-controls={`${id}-list`}
                      placeholder="Search shortcuts"
                      spellCheck={false}
                      autoComplete="off"
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      className="h-10 w-full rounded-lg bg-surface pr-3 pl-9 text-[15px] text-foreground outline-hidden placeholder:text-muted focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-foreground [&::-webkit-search-cancel-button]:hidden"
                    />
                  </div>

                  <p className="sr-only" aria-live="polite">
                    {query
                      ? `${results.count} ${results.count === 1 ? "shortcut" : "shortcuts"}`
                      : ""}
                  </p>

                  {/* 12px inset + 8px row radius = the panel's 20px corners. */}
                  <div
                    id={`${id}-list`}
                    role="region"
                    aria-label="Shortcuts"
                    // Focusable, so the list can be scrolled from the keyboard.
                    tabIndex={0}
                    className="min-h-0 flex-1 overflow-y-auto overscroll-contain rounded-b-[20px] px-3 pb-3 outline-hidden focus-visible:outline-2 focus-visible:outline-solid focus-visible:-outline-offset-2 focus-visible:outline-foreground"
                  >
                    {results.groups.map(({ group, items }) => (
                      <section key={group} aria-labelledby={`${id}-g-${group}`}>
                        <h3
                          id={`${id}-g-${group}`}
                          className="px-2 pt-4 pb-1 text-xs font-medium text-muted"
                        >
                          {group}
                        </h3>
                        <ul>
                          {items.map((s) => {
                            const lit = flash === s.id;
                            return (
                              <li
                                key={s.id}
                                id={`${id}-${s.id}`}
                                className={cn(
                                  "flex h-10 items-center justify-between gap-4 rounded-lg px-2 text-sm text-foreground transition-[background-color] ease-out",
                                  // Lights instantly, then fades like an
                                  // afterglow; the slow fade is what reads
                                  // as "that key worked".
                                  lit ? "bg-surface duration-0" : "duration-500",
                                )}
                              >
                                <span className="truncate">{s.label}</span>
                                <span className="sr-only">
                                  {spoken(s.keys, isMac)}
                                </span>
                                <span aria-hidden className="flex shrink-0 gap-1">
                                  {s.keys.map((k) => (
                                    <Kbd key={k} pressed={lit}>
                                      {glyph(k, isMac)}
                                    </Kbd>
                                  ))}
                                </span>
                              </li>
                            );
                          })}
                        </ul>
                      </section>
                    ))}
                    {!results.count && (
                      <p className="px-2 py-10 text-center text-sm text-muted">
                        No shortcuts match &ldquo;{query.trim()}&rdquo;
                      </p>
                    )}
                  </div>
                </motion.div>
              </motion.div>
            )}
          </AnimatePresence>,
          document.body,
        )}
    </>
  );
}

function Kbd({
  pressed = false,
  children,
}: {
  pressed?: boolean;
  children: React.ReactNode;
}) {
  return (
    <kbd
      className={cn(
        // The inset bottom edge gives the keycap its depth; pressing drops
        // the cap by that edge.
        "flex h-6 min-w-6 items-center justify-center rounded-md px-1.5 font-sans text-xs leading-none transition-[background-color,color,translate,box-shadow] ease-out motion-reduce:transition-[background-color,color]",
        pressed
          ? "translate-y-px bg-foreground text-background shadow-none duration-0"
          : "bg-background text-muted shadow-[0_0_0_1px_var(--border),inset_0_-1px_0_var(--border)] duration-300",
      )}
    >
      {children}
    </kbd>
  );
}

const SHORTCUTS: Shortcut[] = [
  { id: "search", label: "Search", group: "Navigation", keys: ["Mod", "K"] },
  { id: "back", label: "Go back", group: "Navigation", keys: ["Mod", "["] },
  { id: "forward", label: "Go forward", group: "Navigation", keys: ["Mod", "]"] },
  { id: "next", label: "Next item", group: "Navigation", keys: ["J"] },
  { id: "prev", label: "Previous item", group: "Navigation", keys: ["K"] },
  { id: "undo", label: "Undo", group: "Editing", keys: ["Mod", "Z"] },
  { id: "redo", label: "Redo", group: "Editing", keys: ["Mod", "Shift", "Z"] },
  { id: "duplicate", label: "Duplicate", group: "Editing", keys: ["Mod", "D"] },
  { id: "save", label: "Save", group: "Editing", keys: ["Mod", "S"] },
  { id: "rename", label: "Rename", group: "Editing", keys: ["F2"] },
  { id: "sidebar", label: "Toggle sidebar", group: "View", keys: ["Mod", "B"] },
  { id: "zoom-in", label: "Zoom in", group: "View", keys: ["Mod", "="] },
  { id: "zoom-out", label: "Zoom out", group: "View", keys: ["Mod", "-"] },
  { id: "theme", label: "Toggle theme", group: "View", keys: ["Mod", "Shift", "L"] },
  { id: "help", label: "Show shortcuts", group: "View", keys: ["?"] },
];

export default function ShortcutSheetDemo() {
  return <ShortcutSheet shortcuts={SHORTCUTS} />;
}
