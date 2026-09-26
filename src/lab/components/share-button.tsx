import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { AnimatePresence, motion } from "motion/react";
import { siX } from "simple-icons";
import { useReducedMotion } from "@/lib/use-reduced-motion";
import { usePreviewPlay } from "@/lab/preview-play";
import { cn } from "@/lib/cn";

const EASE_OUT = [0.23, 1, 0.32, 1] as const;
// The pill reshapes around its contents with no bounce, so its clipped
// edge never swings past the icons it's revealing or tucking away.
const RESHAPE = { type: "spring", duration: 0.4, bounce: 0 } as const;

const noop = () => () => {};
// The Web Share API opens the phone's own sheet; desktops mostly lack it.
const canNativeShare = () => typeof navigator.share === "function";

// One icon family: a 16px grid, 1.4 strokes, round caps. The X mark is the
// brand's own shape, filled, sized so its weight sits with the strokes.
const stroke = {
  viewBox: "0 0 16 16",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.4,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": true,
  className: "size-4",
} as const;

const Icon = {
  share: (
    <svg {...stroke}>
      <path d="M8 9.5V2.5M5.25 5.25 8 2.5l2.75 2.75M3.5 8v4.5a1 1 0 0 0 1 1h7a1 1 0 0 0 1-1V8" />
    </svg>
  ),
  link: (
    <svg {...stroke}>
      <path d="M6.25 9.75l3.5-3.5M7 4.25l1.05-1.05a3.25 3.25 0 0 1 4.6 4.6L11.6 8.85M9 11.75l-1.05 1.05a3.25 3.25 0 0 1-4.6-4.6L4.4 7.15" />
    </svg>
  ),
  check: (
    <svg {...stroke}>
      <path d="M3.5 8.25l3 3 6-6.5" />
    </svg>
  ),
  mail: (
    <svg {...stroke}>
      <rect x="2.25" y="3.75" width="11.5" height="8.5" rx="1.75" />
      <path d="M2.75 5.25 8 9l5.25-3.75" />
    </svg>
  ),
  more: (
    <svg {...stroke}>
      <path d="M3.75 8h.01M8 8h.01M12.25 8h.01" strokeWidth={2.25} />
    </svg>
  ),
  close: (
    <svg {...stroke}>
      <path d="M4.5 4.5l7 7M11.5 4.5l-7 7" />
    </svg>
  ),
  x: (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden className="size-3.5">
      <path d={siX.path} />
    </svg>
  ),
};

export function ShareButton({
  url,
  title,
  demo,
  className,
}: {
  url: string;
  title: string;
  // Drives the pill from outside (the card preview) with no side effects.
  demo?: { open: boolean; copied: boolean } | null;
  className?: string;
}) {
  const reduceMotion = useReducedMotion();
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const native = useSyncExternalStore(noop, canNativeShare, () => false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const first = useRef<HTMLButtonElement>(null);
  const usingKeys = useRef(false);
  const copyTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const isOpen = demo ? demo.open : open;
  const isCopied = demo ? demo.copied : copied;

  // Focus follows the pill only for keyboard users, so a click never
  // leaves a ring behind.
  const toggle = (next: boolean) => {
    setOpen(next);
    setCopied(false);
    clearTimeout(copyTimer.current);
    if (!usingKeys.current) return;
    requestAnimationFrame(() =>
      (next ? first.current : trigger.current)?.focus(),
    );
  };
  const toggleRef = useRef(toggle);
  useEffect(() => {
    toggleRef.current = toggle;
  });

  // Closes on Escape or a press anywhere else.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) toggleRef.current(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        usingKeys.current = true;
        toggleRef.current(false);
      }
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  useEffect(() => () => clearTimeout(copyTimer.current), []);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      return;
    }
    setCopied(true);
    clearTimeout(copyTimer.current);
    copyTimer.current = setTimeout(() => setCopied(false), 1800);
  };

  const t = reduceMotion ? { duration: 0 } : RESHAPE;
  const fade = reduceMotion ? { duration: 0 } : { duration: 0.2, ease: EASE_OUT };
  const text = encodeURIComponent(title);
  const link = encodeURIComponent(url);

  return (
    <motion.div
      ref={root}
      layout
      transition={t}
      onPointerDownCapture={() => (usingKeys.current = false)}
      onKeyDownCapture={() => (usingKeys.current = true)}
      // Radius set here so the reshaping keeps a true pill; the pill clips,
      // so contents arriving or leaving never show outside it.
      style={{ borderRadius: 999 }}
      className={cn(
        "relative flex h-11 items-center overflow-hidden bg-background shadow-raised",
        className,
      )}
    >
      {/* Both faces sit in normal flow and swap in place, so the pill
          measures one or the other and never both at once. */}
      <AnimatePresence initial={false} mode="popLayout">
        {!isOpen ? (
          <motion.button
            key="share"
            ref={trigger}
            layout="position"
            type="button"
            aria-expanded={false}
            onClick={() => toggle(true)}
            initial={{ opacity: 0, filter: "blur(4px)" }}
            animate={{ opacity: 1, filter: "blur(0px)", transition: { ...fade, delay: 0.08 } }}
            exit={{ opacity: 0, filter: "blur(4px)", transition: { duration: 0.1 } }}
            className="flex h-11 shrink-0 items-center gap-2 rounded-full px-5 text-[14px] font-medium text-foreground outline-hidden transition-[scale] duration-150 ease-out focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-solid focus-visible:outline-foreground active:scale-[0.96]"
          >
            {Icon.share}
            Share
          </motion.button>
        ) : (
          <motion.div
            key="targets"
            layout="position"
            role="group"
            aria-label={`Share ${title}`}
            className="flex shrink-0 items-center gap-0.5 p-1"
            initial={{ opacity: 0, filter: "blur(4px)" }}
            animate={{ opacity: 1, filter: "blur(0px)", transition: { ...fade, delay: 0.06 } }}
            exit={{ opacity: 0, filter: "blur(4px)", transition: { duration: 0.1 } }}
          >
            {/* Copy grows a word when it's done, inside the pill. */}
            <motion.button
              ref={first}
              layout="position"
              type="button"
              aria-label={isCopied ? "Link copied" : "Copy link"}
              onClick={() => (demo ? undefined : void copy())}
              className={cn(target, "w-auto gap-1.5 px-2.5")}
            >
              <span className="relative grid size-4 place-items-center">
                <AnimatePresence initial={false} mode="popLayout">
                  <motion.span
                    key={isCopied ? "check" : "link"}
                    initial={{ opacity: 0, scale: 0.25, filter: "blur(4px)" }}
                    animate={{ opacity: 1, scale: 1, filter: "blur(0px)" }}
                    exit={{ opacity: 0, scale: 0.25, filter: "blur(4px)" }}
                    transition={fade}
                    className="grid place-items-center"
                  >
                    {isCopied ? Icon.check : Icon.link}
                  </motion.span>
                </AnimatePresence>
              </span>
              <AnimatePresence initial={false}>
                {isCopied && (
                  <motion.span
                    initial={{ opacity: 0, width: 0, filter: "blur(4px)" }}
                    animate={{ opacity: 1, width: "auto", filter: "blur(0px)" }}
                    exit={{ opacity: 0, width: 0, filter: "blur(4px)" }}
                    transition={reduceMotion ? { duration: 0 } : RESHAPE}
                    className="overflow-hidden text-[13px] font-medium whitespace-nowrap"
                  >
                    Copied
                  </motion.span>
                )}
              </AnimatePresence>
            </motion.button>
            <a
              href={`https://x.com/intent/post?text=${text}&url=${link}`}
              target="_blank"
              rel="noreferrer"
              aria-label="Post on X"
              className={target}
            >
              {Icon.x}
            </a>
            <a
              href={`mailto:?subject=${text}&body=${link}`}
              aria-label="Email"
              className={target}
            >
              {Icon.mail}
            </a>
            {native && (
              <button
                type="button"
                aria-label="More ways to share"
                onClick={() =>
                  void navigator.share({ title, url }).catch(() => {})
                }
                className={target}
              >
                {Icon.more}
              </button>
            )}
            <span aria-hidden className="mx-1 h-5 w-px bg-border" />
            <button
              type="button"
              aria-label="Close"
              onClick={() => toggle(false)}
              className={cn(target, "text-muted hover:text-foreground")}
            >
              {Icon.close}
            </button>
          </motion.div>
        )}
      </AnimatePresence>
      <span className="sr-only" aria-live="polite">
        {isCopied ? "Link copied" : ""}
      </span>
    </motion.div>
  );
}

const target =
  "inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-foreground outline-hidden transition-[background-color,color,scale] duration-150 ease-out hover:bg-surface focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-solid focus-visible:outline-foreground active:scale-[0.96]";

export default function ShareButtonDemo() {
  const play = usePreviewPlay();
  const [demo, setDemo] = useState<{ open: boolean; copied: boolean } | null>(
    null,
  );

  // The card's hover show: open, copy the link, close again. Nothing is
  // written to the clipboard.
  useEffect(() => {
    if (play !== true) return;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const at = (ms: number, fn: () => void) => timers.push(setTimeout(fn, ms));
    const run = () => {
      at(400, () => setDemo({ open: true, copied: false }));
      at(1300, () => setDemo({ open: true, copied: true }));
      at(3000, () => setDemo({ open: false, copied: false }));
      at(4400, run);
    };
    run();
    return () => {
      timers.forEach(clearTimeout);
      setDemo(null);
    };
  }, [play]);

  return (
    <ShareButton
      url="https://lab.xevrion.dev/lab/share-button"
      title="Share button, from ui lab"
      demo={play === true ? demo : null}
    />
  );
}
