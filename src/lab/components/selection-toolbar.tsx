import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { motion, useMotionValue, useSpring } from "motion/react";
import { useReducedMotion } from "@/lib/use-reduced-motion";
import { cn } from "@/lib/cn";

type Format = "bold" | "italic" | "link" | "highlight";

const TAGS: Record<Format, string> = {
  bold: "strong",
  italic: "em",
  link: "a",
  highlight: "mark",
};
const FORMATS = Object.keys(TAGS) as Format[];
const LABELS: Record<Format, string> = {
  bold: "Bold",
  italic: "Italic",
  link: "Link",
  highlight: "Highlight",
};

const EASE_OUT = [0.23, 1, 0.32, 1] as const;
// Critically damped (2 * sqrt(500) is about 45), so the toolbar glides after
// a growing selection without ever swinging past it.
const FOLLOW = { stiffness: 500, damping: 45 };
const ICON_SWAP = { type: "spring", duration: 0.3, bounce: 0 } as const;
// Space between the selection and the toolbar.
const GAP = 8;
// Long enough to read the check, short enough to copy again right away.
const COPIED_FOR = 1400;

// Nearest element with this tag that still sits inside the editor.
function closestIn(node: Node, tag: string, root: HTMLElement) {
  const el = node.nodeType === 1 ? (node as Element) : node.parentElement;
  const found = el?.closest(tag);
  return found && root.contains(found) && found !== root ? found : null;
}

function unwrap(el: Element) {
  const parent = el.parentNode;
  if (!parent) return;
  while (el.firstChild) parent.insertBefore(el.firstChild, el);
  parent.removeChild(el);
}

function sameRange(a: Range | null, b: Range) {
  return (
    !!a &&
    a.startContainer === b.startContainer &&
    a.startOffset === b.startOffset &&
    a.endContainer === b.endContainer &&
    a.endOffset === b.endOffset
  );
}

export function SelectionToolbar({
  html,
  label,
  className,
}: {
  // Initial markup only. After mount the text belongs to the reader, so
  // React never writes to it again.
  html: string;
  label: string;
  className?: string;
}) {
  const reduce = useReducedMotion() ?? false;
  const rootRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<HTMLDivElement>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const buttonRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const rangeRef = useRef<Range | null>(null);
  const openRef = useRef(false);
  const pressing = useRef(false);
  // Set by Escape: stays hidden until the selection actually changes.
  const dismissed = useRef(false);
  const copyTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const [open, setOpen] = useState(false);
  // Typing hides the toolbar at once; every other close fades.
  const [instant, setInstant] = useState(false);
  const [active, setActive] = useState("");
  const [copied, setCopied] = useState(false);
  const [focusIndex, setFocusIndex] = useState(0);
  const [announce, setAnnounce] = useState("");

  const x = useSpring(0, FOLLOW);
  const y = useSpring(0, FOLLOW);
  const origin = useMotionValue("50% 100%");

  const show = (next: boolean, fast = false) => {
    openRef.current = next;
    setInstant(fast);
    setOpen(next);
  };

  // Latest-callback ref, so the listeners bind once but always see the
  // current reduced-motion setting.
  const sync = useRef(() => {});
  const syncNow = () => {
    const root = rootRef.current;
    const editor = editorRef.current;
    const toolbar = toolbarRef.current;
    const sel = window.getSelection();
    if (!root || !editor || !toolbar) return;

    const range = sel && sel.rangeCount > 0 ? sel.getRangeAt(0) : null;
    if (
      !range ||
      range.collapsed ||
      !editor.contains(range.commonAncestorContainer)
    ) {
      // Tabbing into the toolbar can nudge the selection; keep it open.
      if (toolbar.contains(document.activeElement)) return;
      if (openRef.current) show(false);
      return;
    }
    // A drag in progress settles on release, so the toolbar doesn't chase
    // every pixel of it.
    if (pressing.current) return;
    if (dismissed.current) {
      if (sameRange(rangeRef.current, range)) return;
      dismissed.current = false;
    }
    rangeRef.current = range.cloneRange();

    const box = root.getBoundingClientRect();
    const bounds = range.getBoundingClientRect();
    const lines = [...range.getClientRects()].filter((r) => r.width > 0);
    const first = lines[0] ?? bounds;
    const last = lines[lines.length - 1] ?? bounds;
    const w = toolbar.offsetWidth;
    const h = toolbar.offsetHeight;

    // Flips below when there's no room above inside the card or on screen.
    const below =
      first.top - box.top < h + GAP || first.top < h + GAP;
    const center = bounds.left + bounds.width / 2 - box.left;
    const left = Math.min(Math.max(center - w / 2, 0), box.width - w);
    const top = below
      ? last.bottom - box.top + GAP
      : first.top - box.top - h - GAP;

    // Scales out of the selection itself, even when clamped to the edge.
    origin.set(`${center - left}px ${below ? 0 : h}px`);
    if (!openRef.current || reduce) {
      x.jump(left);
      y.jump(top);
    } else {
      x.set(left);
      y.set(top);
    }

    const on = FORMATS.filter((f) => {
      const start = closestIn(range.startContainer, TAGS[f], editor);
      return !!start && start === closestIn(range.endContainer, TAGS[f], editor);
    }).join(",");
    setActive(on);
    if (!openRef.current) {
      setFocusIndex(0);
      show(true);
    }
  };

  useLayoutEffect(() => {
    sync.current = syncNow;
  });

  useEffect(() => {
    const editor = editorRef.current;
    const root = rootRef.current;
    if (!editor || !root) return;
    let frame = 0;
    const run = () => sync.current();
    const release = () => {
      if (!pressing.current) return;
      pressing.current = false;
      // The selection finalises after pointerup, so read it a frame later.
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(run);
    };
    const observer = new ResizeObserver(run);
    observer.observe(root);
    document.addEventListener("selectionchange", run);
    window.addEventListener("pointerup", release);
    window.addEventListener("pointercancel", release);
    editor.addEventListener("scroll", run, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      document.removeEventListener("selectionchange", run);
      window.removeEventListener("pointerup", release);
      window.removeEventListener("pointercancel", release);
      editor.removeEventListener("scroll", run);
    };
  }, []);

  useEffect(() => () => clearTimeout(copyTimer.current), []);

  const liveRange = () => {
    const editor = editorRef.current;
    const range = rangeRef.current;
    if (!editor || !range || range.collapsed) return null;
    return editor.contains(range.commonAncestorContainer) ? range : null;
  };

  const select = (range: Range) => {
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
  };

  const toggle = (format: Format) => {
    const editor = editorRef.current;
    const range = liveRange();
    if (!editor || !range) return;
    const tag = TAGS[format];
    const start = closestIn(range.startContainer, tag, editor);
    const end = closestIn(range.endContainer, tag, editor);
    const next = document.createRange();

    if (start && start === end) {
      const firstChild = start.firstChild;
      const lastChild = start.lastChild;
      unwrap(start);
      if (!firstChild || !lastChild) return;
      next.setStartBefore(firstChild);
      next.setEndAfter(lastChild);
      setAnnounce(`${LABELS[format]} off`);
    } else {
      const content = range.extractContents();
      // Merges any partial marks of the same kind into the new one, so
      // formatting never nests inside itself.
      content.querySelectorAll(tag).forEach(unwrap);
      const el = document.createElement(tag);
      if (format === "link") el.setAttribute("href", "https://lab.xevrion.dev");
      el.appendChild(content);
      range.insertNode(el);
      next.selectNodeContents(el);
      setAnnounce(`${LABELS[format]} on`);
    }
    // Splitting a partly selected mark can leave an empty shell behind.
    editor
      .querySelectorAll(Object.values(TAGS).join(","))
      .forEach((el) => {
        if (!el.textContent) el.remove();
      });
    select(next);
  };

  const copy = async () => {
    const range = liveRange();
    if (!range) return;
    // Confirms on press; waiting for the write makes the click feel ignored.
    setCopied(true);
    setAnnounce("Copied");
    clearTimeout(copyTimer.current);
    copyTimer.current = setTimeout(() => setCopied(false), COPIED_FOR);
    try {
      await navigator.clipboard.writeText(range.toString());
    } catch {
      setCopied(false);
      setAnnounce("Couldn't copy");
    }
  };

  const dismiss = () => {
    dismissed.current = true;
    show(false);
  };

  const actions = [...FORMATS, "copy" as const];

  const focusButton = (index: number) => {
    const i = (index + actions.length) % actions.length;
    setFocusIndex(i);
    buttonRefs.current[i]?.focus();
  };

  const pressed = new Set(active.split(","));

  return (
    <div
      ref={rootRef}
      className={cn("relative", className)}
      onBlur={(e) => {
        // Focus leaving both the text and the toolbar takes the toolbar along.
        if (!rootRef.current?.contains(e.relatedTarget as Node | null)) {
          if (openRef.current) show(false);
        }
      }}
    >
      <div
        ref={editorRef}
        role="textbox"
        aria-multiline
        aria-label={label}
        contentEditable
        suppressContentEditableWarning
        spellCheck={false}
        onPointerDown={(e) => {
          if (e.button === 0) pressing.current = true;
        }}
        onKeyDown={(e) => {
          const mod = e.metaKey || e.ctrlKey;
          if (mod && !e.altKey && (e.key === "b" || e.key === "i")) {
            // Same path as the buttons, so the shortcut animates the toolbar
            // exactly like a click does.
            e.preventDefault();
            if (liveRange()) toggle(e.key === "b" ? "bold" : "italic");
            return;
          }
          if (e.key === "Escape" && openRef.current) {
            e.preventDefault();
            dismiss();
            return;
          }
          const typing =
            !mod &&
            (e.key.length === 1 ||
              e.key === "Backspace" ||
              e.key === "Delete" ||
              e.key === "Enter");
          if (typing && openRef.current) show(false, true);
        }}
        dangerouslySetInnerHTML={{ __html: html }}
        className="h-full overflow-y-auto rounded-lg text-[15px] leading-relaxed text-pretty text-muted caret-foreground outline-hidden selection:bg-foreground/15 selection:text-foreground focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-4 focus-visible:outline-foreground [&_a]:text-foreground [&_a]:underline [&_a]:decoration-foreground/40 [&_a]:underline-offset-4 [&_em]:text-foreground [&_mark]:rounded-sm [&_mark]:bg-foreground/15 [&_mark]:text-foreground [&_p+p]:mt-3 [&_strong]:font-semibold [&_strong]:text-foreground"
      />

      <motion.div
        ref={toolbarRef}
        role="toolbar"
        aria-label="Formatting"
        aria-hidden={!open}
        inert={!open}
        // Keeps the text selected and focused when a button is clicked.
        onMouseDown={(e) => e.preventDefault()}
        onKeyDown={(e) => {
          const step = { ArrowRight: 1, ArrowLeft: -1 }[e.key];
          if (step) {
            e.preventDefault();
            focusButton(focusIndex + step);
          } else if (e.key === "Home" || e.key === "End") {
            e.preventDefault();
            focusButton(e.key === "Home" ? 0 : -1);
          } else if (e.key === "Escape") {
            e.preventDefault();
            dismiss();
            editorRef.current?.focus({ preventScroll: true });
            const range = liveRange();
            if (range) select(range);
          }
        }}
        initial={false}
        animate={
          open
            ? { opacity: 1, scale: 1, filter: "blur(0px)" }
            : {
                opacity: 0,
                scale: reduce ? 1 : 0.96,
                filter: "blur(0px)",
              }
        }
        transition={
          open
            ? { duration: 0.18, ease: EASE_OUT }
            : { duration: instant ? 0 : 0.1, ease: EASE_OUT }
        }
        style={{ x, y, transformOrigin: origin }}
        // 12px radius around 4px padding keeps the 8px buttons concentric.
        className={cn(
          "absolute top-0 left-0 z-10 flex items-center gap-0.5 rounded-xl bg-surface p-1 shadow-raised",
          !open && "pointer-events-none",
        )}
      >
        {actions.map((action, i) => {
          const isCopy = action === "copy";
          const on = !isCopy && pressed.has(action);
          return (
            <span key={action} className="flex items-center">
              {isCopy && (
                <span aria-hidden className="mx-1 h-5 w-px bg-border" />
              )}
              <button
                ref={(el) => {
                  buttonRefs.current[i] = el;
                }}
                type="button"
                tabIndex={i === focusIndex ? 0 : -1}
                aria-label={isCopy ? "Copy" : LABELS[action]}
                aria-pressed={isCopy ? undefined : on}
                onFocus={() => setFocusIndex(i)}
                onClick={() => (isCopy ? copy() : toggle(action))}
                className={cn(
                  "flex size-9 touch-manipulation items-center justify-center rounded-lg text-muted outline-hidden transition-[color,background-color,scale] duration-150 ease-out select-none hover:bg-foreground/[0.06] hover:text-foreground focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-foreground active:scale-[0.96] motion-reduce:transition-[color,background-color]",
                  on && "bg-foreground/[0.08] text-foreground hover:bg-foreground/[0.1]",
                )}
              >
                {isCopy ? (
                  <span className="grid" aria-hidden>
                    <SwapIcon visible={!copied} reduce={reduce}>
                      <rect x="5.25" y="5.25" width="8" height="8" rx="1.75" />
                      <path d="M10.75 5.25V4.5a1.75 1.75 0 0 0-1.75-1.75H4.5A1.75 1.75 0 0 0 2.75 4.5V9a1.75 1.75 0 0 0 1.75 1.75h.75" />
                    </SwapIcon>
                    <SwapIcon visible={copied} reduce={reduce}>
                      <path d="m3.5 8.5 3 3 6-7" />
                    </SwapIcon>
                  </span>
                ) : (
                  <svg
                    viewBox="0 0 16 16"
                    aria-hidden
                    className="size-4"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={1.5}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    {ICONS[action]}
                  </svg>
                )}
              </button>
            </span>
          );
        })}
      </motion.div>

      <span className="sr-only" aria-live="polite">
        {announce}
      </span>
    </div>
  );
}

const ICONS: Record<Format, React.ReactNode> = {
  bold: (
    <path
      d="M4.75 3.25h3.9a2.4 2.4 0 0 1 0 4.8h-3.9Zm0 4.8h4.6a2.35 2.35 0 0 1 0 4.7h-4.6Z"
      strokeWidth={1.75}
    />
  ),
  italic: <path d="M7 3.25h5M4 12.75h5M9.5 3.25l-3 9.5" />,
  link: (
    <path d="M7 9a2.5 2.5 0 0 0 3.54 0l2-2A2.5 2.5 0 0 0 9 3.46l-.5.5M9 7a2.5 2.5 0 0 0-3.54 0l-2 2A2.5 2.5 0 0 0 7 12.54l.5-.5" />
  ),
  highlight: (
    <>
      <path d="m9.75 2.75 3.5 3.5-5.5 5.5h-3.5v-3.5Z" />
      <path d="M2.75 14.25h10.5" />
    </>
  ),
};

function SwapIcon({
  visible,
  reduce,
  children,
}: {
  visible: boolean;
  reduce: boolean;
  children: React.ReactNode;
}) {
  // Reduced motion keeps the cross-fade but drops the scale and blur.
  const hidden = reduce
    ? { opacity: 0 }
    : { scale: 0.25, opacity: 0, filter: "blur(4px)" };
  return (
    <motion.svg
      viewBox="0 0 16 16"
      className="col-start-1 row-start-1 size-4"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      initial={false}
      animate={visible ? { scale: 1, opacity: 1, filter: "blur(0px)" } : hidden}
      transition={ICON_SWAP}
    >
      {children}
    </motion.svg>
  );
}

const TEXT =
  "<p>Good interfaces are made of details nobody notices. The press that " +
  "gives a little under your finger, the menu that grows out of the button " +
  "you clicked, the toolbar that appears right where your attention " +
  "already is.</p><p>Select any part of this note to format it. Try a " +
  "word on the first line too: with no room above, the toolbar flips " +
  "below the text.</p>";

export default function SelectionToolbarDemo() {
  return (
    // Fixed height, so typing into the note scrolls inside the card instead
    // of growing the demo.
    <div className="h-64 w-[min(480px,100%)] rounded-2xl bg-background p-6 shadow-raised">
      <SelectionToolbar label="Note" html={TEXT} className="h-full" />
    </div>
  );
}
