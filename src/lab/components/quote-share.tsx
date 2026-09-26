import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { AnimatePresence, motion } from "motion/react";
import { useReducedMotion } from "@/lib/use-reduced-motion";
import { cn } from "@/lib/cn";

/* The teachable part: the quote card is built from the reader's own words.
   Every selected word is measured where it sits in the paragraph, then the
   card lays the same words out and plays each one back from its old spot
   (a FLIP per word), so the quote visibly lifts out of the article and the
   gaps it leaves behind show exactly where it came from. */

type Word = { text: string; x: number; y: number; w: number; h: number };
type Quote = { words: Word[]; text: string; top: number; bottom: number };

const EASE_OUT = [0.23, 1, 0.32, 1] as const;
// Longer than a typical UI move on purpose: the words cross most of the
// frame and the reader needs to see where they land. iOS drawer curve, so
// they leave the paragraph at once and settle gently.
const FLIGHT = { duration: 460, easing: "cubic-bezier(0.32, 0.72, 0, 1)" };
// The way home is quicker and plainer: the reader has already seen the trip.
const RETURN = { duration: 300, easing: "cubic-bezier(0.77, 0, 0.175, 1)" };
// Per-word stagger, capped so a long quote never takes longer to arrive.
const STAGGER = 12;
const STAGGER_MAX = 160;
// Past this a quote card stops being a quote.
const MAX_WORDS = 50;
// Space kept between the pill and the selected line.
const PILL_GAP = 10;
const PILL_H = 36;

// Snaps a selection that starts or ends mid-word out to the whole word, so a
// sloppy drag still quotes "reading", not "ading".
function snap(range: Range) {
  const r = range.cloneRange();
  const { startContainer: s, endContainer: e } = r;
  if (s.nodeType === Node.TEXT_NODE) {
    const t = (s as Text).data;
    let i = r.startOffset;
    while (i > 0 && /\S/.test(t[i - 1])) i--;
    r.setStart(s, i);
  }
  if (e.nodeType === Node.TEXT_NODE) {
    const t = (e as Text).data;
    let i = r.endOffset;
    while (i < t.length && /\S/.test(t[i])) i++;
    r.setEnd(e, i);
  }
  return r;
}

function collectWords(range: Range, frame: DOMRect): Word[] {
  const root =
    range.commonAncestorContainer.nodeType === Node.TEXT_NODE
      ? range.commonAncestorContainer.parentNode!
      : range.commonAncestorContainer;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const words: Word[] = [];
  for (let n = walker.currentNode as Text | null; n; n = walker.nextNode() as Text | null) {
    if (n.nodeType !== Node.TEXT_NODE || !range.intersectsNode(n)) continue;
    const start = n === range.startContainer ? range.startOffset : 0;
    const end = n === range.endContainer ? range.endOffset : n.data.length;
    for (const m of n.data.slice(start, end).matchAll(/\S+/g)) {
      const r = document.createRange();
      const from = start + (m.index ?? 0);
      r.setStart(n, from);
      r.setEnd(n, from + m[0].length);
      const box = r.getClientRects()[0];
      if (!box) continue;
      words.push({
        text: m[0],
        x: box.left - frame.left,
        y: box.top - frame.top,
        w: box.width,
        h: box.height,
      });
    }
  }
  return words;
}

// A link that scrolls to and highlights the passage in supporting browsers.
// Long quotes use the start,end form so the URL stays short.
function fragmentFor(words: string[]) {
  const enc = (s: string) =>
    encodeURIComponent(s).replace(/-/g, "%2D");
  if (words.length <= 8) return `#:~:text=${enc(words.join(" "))}`;
  return `#:~:text=${enc(words.slice(0, 4).join(" "))},${enc(words.slice(-4).join(" "))}`;
}

export function QuoteShare({
  author,
  title,
  url,
  children,
  className,
}: {
  author: string;
  title: string;
  // Page URL for Copy link; defaults to the current page.
  url?: string;
  // The article. Scrolls inside this frame; give the frame a height with
  // className, or `h-auto` to let the article run the full page height.
  children: React.ReactNode;
  className?: string;
}) {
  const reduceMotion = useReducedMotion() ?? false;
  const frame = useRef<HTMLDivElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const pillEl = useRef<HTMLDivElement>(null);
  const card = useRef<HTMLDivElement>(null);
  const firstButton = useRef<HTMLButtonElement>(null);
  const wordEls = useRef<(HTMLSpanElement | null)[]>([]);
  const range = useRef<Range | null>(null);
  const pointerDown = useRef(false);
  const settle = useRef<ReturnType<typeof setTimeout>>(undefined);
  const copyTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const [pill, setPill] = useState<{ tooLong: boolean } | null>(null);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [closing, setClosing] = useState(false);
  const [copied, setCopied] = useState<"text" | "link" | null>(null);

  // Puts the pill over the first selected line, or under the last one when
  // there is no room above. Written straight to the element: it runs on
  // every scroll, which must not re-render.
  const positionPill = useCallback(() => {
    const el = pillEl.current;
    const r = range.current;
    const f = frame.current;
    if (!el || !r || !f) return;
    const box = f.getBoundingClientRect();
    const rects = [...r.getClientRects()].filter((b) => b.width > 0);
    if (!rects.length) return;
    const first = rects[0];
    const last = rects[rects.length - 1];
    let y = first.top - box.top - PILL_GAP;
    let below = false;
    if (y - PILL_H < 8) {
      y = last.bottom - box.top + PILL_GAP;
      below = true;
    }
    const half = el.offsetWidth / 2;
    const cx = (first.left + first.right) / 2 - box.left;
    const x = Math.min(Math.max(cx, half + 8), box.width - half - 8);
    el.style.transform = `translate(${x}px, ${y}px) translate(-50%, ${below ? "0" : "-100%"})`;
    el.style.transformOrigin = below ? "center top" : "center bottom";
    // Scrolled out of the frame: hide rather than float over nothing.
    el.style.visibility = y < 0 || y > box.height ? "hidden" : "";
  }, []);

  const readSelection = useCallback(() => {
    const sel = window.getSelection();
    const article = scroller.current;
    if (!sel || !sel.rangeCount || sel.isCollapsed || !article) {
      range.current = null;
      setPill(null);
      return;
    }
    const r = sel.getRangeAt(0);
    if (!article.contains(r.commonAncestorContainer) || !sel.toString().trim()) {
      range.current = null;
      setPill(null);
      return;
    }
    range.current = snap(r);
    const count = range.current.toString().trim().split(/\s+/).length;
    setPill({ tooLong: count > MAX_WORDS });
  }, []);

  useLayoutEffect(() => {
    if (pill) positionPill();
  }, [pill, positionPill]);

  // Mouse selections show the pill on release; keyboard and touch-handle
  // selections have no release, so they show once the selection sits still.
  useEffect(() => {
    const onChange = () => {
      clearTimeout(settle.current);
      if (pointerDown.current) return;
      // Long enough to skip the intermediate states of a Shift+Arrow run.
      settle.current = setTimeout(readSelection, 180);
    };
    const onUp = () => {
      if (!pointerDown.current) return;
      pointerDown.current = false;
      clearTimeout(settle.current);
      // The click that collapses a selection lands after pointerup.
      settle.current = setTimeout(readSelection, 0);
    };
    document.addEventListener("selectionchange", onChange);
    document.addEventListener("pointerup", onUp);
    return () => {
      document.removeEventListener("selectionchange", onChange);
      document.removeEventListener("pointerup", onUp);
      clearTimeout(settle.current);
      clearTimeout(copyTimer.current);
    };
  }, [readSelection]);

  const lift = () => {
    const r = range.current;
    const f = frame.current;
    if (!r || !f || pill?.tooLong) return;
    const box = f.getBoundingClientRect();
    const words = collectWords(r, box);
    if (!words.length) return;
    const top = Math.min(...words.map((w) => w.y));
    const bottom = Math.max(...words.map((w) => w.y + w.h));
    window.getSelection()?.removeAllRanges();
    setPill(null);
    setClosing(false);
    setCopied(null);
    setQuote({ words, text: words.map((w) => w.text).join(" "), top, bottom });
  };

  // Lays the card out, then flies every word in from where it was read.
  // Before paint, so no frame shows the words already in the card.
  useLayoutEffect(() => {
    if (!quote || closing) return;
    const f = frame.current;
    const c = card.current;
    if (!f || !c) return;
    const box = f.getBoundingClientRect();
    // Beside the passage rather than over it, so the gaps the words leave
    // stay in view: below it when there is room, else above, else as far
    // from it as the frame allows.
    const h = c.offsetHeight;
    const room = 16;
    const below = quote.bottom + room;
    const above = quote.top - room - h;
    const top =
      below + h <= box.height - room
        ? below
        : above >= room
          ? above
          : quote.top > box.height / 2
            ? room
            : box.height - h - room;
    c.style.top = `${top}px`;
    firstButton.current?.focus({ preventScroll: true });
    if (reduceMotion) return;
    const anims: Animation[] = [];
    quote.words.forEach((w, i) => {
      const el = wordEls.current[i];
      if (!el) return;
      const t = el.getBoundingClientRect();
      const dx = w.x - (t.left - box.left);
      const dy = w.y - (t.top - box.top);
      const s = w.h / t.height;
      anims.push(
        el.animate(
          [{ transform: `translate(${dx}px, ${dy}px) scale(${s})` }, { transform: "none" }],
          { ...FLIGHT, delay: Math.min(i * STAGGER, STAGGER_MAX), fill: "backwards" },
        ),
      );
    });
    return () => anims.forEach((a) => a.cancel());
  }, [quote, closing, reduceMotion]);

  const finish = useCallback(() => {
    setQuote(null);
    setClosing(false);
    scroller.current?.focus({ preventScroll: true });
  }, []);

  // Sends every word back to its gap, then lets the paragraph have it.
  useLayoutEffect(() => {
    if (!quote || !closing) return;
    const f = frame.current;
    if (!f || reduceMotion) {
      // Matches the card's own fade, so reduced motion still gets a close.
      const t = setTimeout(finish, 150);
      return () => clearTimeout(t);
    }
    const box = f.getBoundingClientRect();
    const anims: Animation[] = [];
    quote.words.forEach((w, i) => {
      const el = wordEls.current[i];
      if (!el) return;
      el.getAnimations().forEach((a) => a.cancel());
      const t = el.getBoundingClientRect();
      anims.push(
        el.animate(
          [
            { transform: "none" },
            {
              transform: `translate(${w.x - (t.left - box.left)}px, ${w.y - (t.top - box.top)}px) scale(${w.h / t.height})`,
            },
          ],
          { ...RETURN, fill: "forwards" },
        ),
      );
    });
    let done = false;
    Promise.all(anims.map((a) => a.finished))
      .then(() => {
        if (!done) finish();
      })
      .catch(() => {});
    return () => {
      done = true;
    };
  }, [quote, closing, reduceMotion, finish]);

  const close = useCallback(() => {
    if (quote && !closing) setClosing(true);
  }, [quote, closing]);

  useEffect(() => {
    if (!quote) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [quote, close]);

  const copy = async (kind: "text" | "link") => {
    if (!quote) return;
    const base = (url ?? window.location.href).split("#")[0];
    const value =
      kind === "text"
        ? `“${quote.text}” (${author}, ${title})`
        : base + fragmentFor(quote.words.map((w) => w.text));
    setCopied(kind);
    clearTimeout(copyTimer.current);
    // Long enough to read the confirmation, short enough to copy again.
    copyTimer.current = setTimeout(() => setCopied(null), 1600);
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      setCopied(null);
    }
  };

  // Keeps Tab inside the open card.
  const trap = (e: React.KeyboardEvent) => {
    if (e.key !== "Tab" || !card.current) return;
    const items = [...card.current.querySelectorAll<HTMLElement>("button")];
    const i = items.indexOf(document.activeElement as HTMLElement);
    const next = e.shiftKey ? (i <= 0 ? items.length - 1 : i - 1) : (i + 1) % items.length;
    e.preventDefault();
    items[next]?.focus();
  };

  const open = quote !== null && !closing;

  return (
    <div
      ref={frame}
      className={cn(
        "relative h-[540px] w-[560px] max-w-full overflow-hidden rounded-2xl bg-background shadow-raised",
        className,
      )}
    >
      <div
        ref={scroller}
        tabIndex={0}
        aria-label={title}
        role="region"
        onPointerDown={() => {
          pointerDown.current = true;
        }}
        onScroll={positionPill}
        // A stable gutter, so locking scroll while the card is up never
        // shifts the text and leaves the gaps misaligned.
        style={{ scrollbarGutter: "stable" }}
        className={cn(
          "h-full px-7 py-7 outline-hidden selection:bg-foreground/15",
          "focus-visible:outline-2 focus-visible:outline-solid focus-visible:-outline-offset-2 focus-visible:outline-foreground",
          quote ? "overflow-y-hidden" : "overflow-y-auto",
          "[scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
        )}
      >
        {children}
      </div>

      {/* The gaps the words leave behind. */}
      {quote && (
        <div aria-hidden className="pointer-events-none absolute inset-0">
          {quote.words.map((w, i) => (
            <span
              key={i}
              className="absolute rounded-[4px] bg-background"
              style={{ left: w.x - 1, top: w.y, width: w.w + 2, height: w.h }}
            >
              <span className="absolute inset-x-0.5 inset-y-[3px] rounded-[3px] bg-foreground/[0.06]" />
            </span>
          ))}
        </div>
      )}

      <AnimatePresence>
        {pill && !quote && (
          <motion.div
            ref={pillEl}
            key="pill"
            className="absolute top-0 left-0 z-20"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1, transition: { duration: 0.16, ease: EASE_OUT } }}
            exit={{ opacity: 0, transition: { duration: 0.1, ease: EASE_OUT } }}
          >
            <motion.button
              type="button"
              // Keeps the selection alive through the click.
              onPointerDown={(e) => e.preventDefault()}
              onClick={lift}
              disabled={pill.tooLong}
              initial={{ scale: reduceMotion ? 1 : 0.94, filter: "blur(4px)", y: reduceMotion ? 0 : 4 }}
              animate={{ scale: 1, filter: "blur(0px)", y: 0, transition: { duration: 0.2, ease: EASE_OUT } }}
              className={cn(
                "flex h-9 items-center gap-2 rounded-full bg-foreground px-3.5 text-sm font-medium whitespace-nowrap text-background shadow-raised outline-hidden",
                "transition-[scale,opacity] duration-150 ease-out active:scale-[0.96] disabled:opacity-60 disabled:active:scale-100",
                "focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-foreground",
              )}
            >
              <svg viewBox="0 0 16 16" className="size-4" fill="currentColor" aria-hidden>
                <path d="M3 8.5c0-2.4 1.2-4.2 3.3-5l.5 1c-1.2.6-1.9 1.5-2 2.6H6.5V12H3zm6.5 0c0-2.4 1.2-4.2 3.3-5l.5 1c-1.2.6-1.9 1.5-2 2.6H13V12H9.5z" />
              </svg>
              {pill.tooLong ? "Too long to quote" : "Share quote"}
            </motion.button>
          </motion.div>
        )}
      </AnimatePresence>

      {quote && (
        <>
          <motion.div
            aria-hidden
            onClick={close}
            className="absolute inset-0 z-30 bg-background/70"
            initial={{ opacity: 0 }}
            animate={{ opacity: open ? 1 : 0 }}
            transition={{ duration: open ? 0.3 : 0.24, ease: EASE_OUT }}
          />
          <div
            ref={card}
            role="dialog"
            aria-modal="true"
            aria-label="Share quote"
            onKeyDown={trap}
            className="absolute left-1/2 z-40 w-[min(440px,calc(100%-32px))] -translate-x-1/2 p-5"
          >
            {/* The card's surface scales on its own layer, so the words on
                top keep exact positions for their flight. */}
            <motion.div
              aria-hidden
              className="absolute inset-0 rounded-2xl bg-surface shadow-raised"
              initial={{ opacity: 0, scale: reduceMotion ? 1 : 0.96 }}
              animate={
                open
                  ? { opacity: 1, scale: 1, transition: { duration: 0.28, ease: EASE_OUT } }
                  : { opacity: 0, scale: reduceMotion ? 1 : 0.98, transition: { duration: 0.2, ease: EASE_OUT } }
              }
            />
            <div className="relative">
              <Reveal open={open} delay={0.22} reduce={reduceMotion}>
                <svg aria-hidden viewBox="0 0 32 24" className="h-4 w-[22px] fill-foreground/20">
                  <path d="M0 24V14.4C0 6.6 4.2 1.8 12.4 0l1.4 3.4C9.4 4.8 7.3 7.6 7 11.2h6.2V24H0Zm18.2 0V14.4C18.2 6.6 22.4 1.8 30.6 0L32 3.4c-4.4 1.4-6.5 4.2-6.8 7.8h6.2V24H18.2Z" />
                </svg>
              </Reveal>
              <motion.p
                className="mt-3 text-[18px]/[1.5] font-medium tracking-[-0.01em] text-foreground"
                initial={reduceMotion ? { opacity: 0 } : false}
                animate={{ opacity: open || !reduceMotion ? 1 : 0 }}
                transition={{ duration: 0.15 }}
              >
                {quote.words.map((w, i) => (
                  <span key={i}>
                    <span
                      ref={(el) => {
                        wordEls.current[i] = el;
                      }}
                      className="inline-block origin-top-left will-change-transform"
                    >
                      {w.text}
                    </span>{" "}
                  </span>
                ))}
              </motion.p>
              {/* Credit and actions share a row, which keeps the card short
                  enough to sit beside the passage instead of over it. */}
              <Reveal open={open} delay={0.3} reduce={reduceMotion}>
                <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-3 border-t border-border pt-4">
                  <p className="flex min-w-[150px] flex-1 flex-col text-[13px]/[1.35]">
                    <span className="font-medium text-foreground">{author}</span>
                    <span className="text-pretty text-muted">{title}</span>
                  </p>
                  <div className="flex gap-2">
                    <CardButton
                      ref={firstButton}
                      onClick={() => copy("text")}
                      done={copied === "text"}
                      label="Copy text"
                    />
                    <CardButton
                      onClick={() => copy("link")}
                      done={copied === "link"}
                      label="Copy link"
                    />
                  </div>
                </div>
              </Reveal>
              <span role="status" className="sr-only">
                {copied === "text" ? "Quote copied" : copied === "link" ? "Link copied" : ""}
              </span>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function Reveal({
  open,
  delay,
  reduce,
  children,
}: {
  open: boolean;
  delay: number;
  reduce: boolean;
  children: React.ReactNode;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, filter: "blur(4px)", y: reduce ? 0 : 4 }}
      animate={
        open
          ? { opacity: 1, filter: "blur(0px)", y: 0, transition: { duration: 0.24, delay: reduce ? 0 : delay, ease: EASE_OUT } }
          : { opacity: 0, filter: "blur(2px)", y: 0, transition: { duration: 0.14, ease: EASE_OUT } }
      }
    >
      {children}
    </motion.div>
  );
}

function CardButton({
  label,
  done,
  onClick,
  ref,
}: {
  label: string;
  done: boolean;
  onClick: () => void;
  ref?: React.Ref<HTMLButtonElement>;
}) {
  return (
    <button
      ref={ref}
      type="button"
      onClick={onClick}
      className={cn(
        "flex h-9 items-center gap-2 rounded-full bg-background px-3.5 text-sm font-medium text-foreground shadow-raised outline-hidden",
        "transition-[scale] duration-150 ease-out active:scale-[0.96]",
        "focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-foreground",
      )}
    >
      <span className="relative size-4">
        <AnimatePresence initial={false} mode="popLayout">
          <motion.svg
            key={done ? "done" : "idle"}
            viewBox="0 0 16 16"
            className="absolute inset-0 size-4"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.5}
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
            initial={{ opacity: 0, scale: 0.25, filter: "blur(4px)" }}
            animate={{ opacity: 1, scale: 1, filter: "blur(0px)" }}
            exit={{ opacity: 0, scale: 0.25, filter: "blur(4px)" }}
            transition={{ type: "spring", duration: 0.3, bounce: 0 }}
          >
            {done ? (
              <path d="M3.5 8.5 6.5 11.5 12.5 4.5" />
            ) : label === "Copy link" ? (
              <path d="M6.75 9.25a2.75 2.75 0 0 0 3.9 0l2-2a2.75 2.75 0 0 0-3.9-3.9l-.6.6M9.25 6.75a2.75 2.75 0 0 0-3.9 0l-2 2a2.75 2.75 0 0 0 3.9 3.9l.6-.6" />
            ) : (
              <>
                <rect x="5.25" y="5.25" width="8" height="8" rx="1.75" />
                <path d="M10.75 5.25V4a1.25 1.25 0 0 0-1.25-1.25H4A1.25 1.25 0 0 0 2.75 4v5.5A1.25 1.25 0 0 0 4 10.75h1.25" />
              </>
            )}
          </motion.svg>
        </AnimatePresence>
      </span>
      {done ? "Copied" : label}
    </button>
  );
}

// The passage other readers quoted most, marked the way reading apps mark a
// popular highlight. One tap selects it, so the idea is a click away before
// anyone thinks to drag across text.
function TopHighlight({ children }: { children: React.ReactNode }) {
  const select = (el: HTMLElement) => {
    const sel = window.getSelection();
    if (!sel || !sel.isCollapsed) return;
    const r = document.createRange();
    r.selectNodeContents(el);
    sel.removeAllRanges();
    sel.addRange(r);
  };
  return (
    <span
      role="button"
      tabIndex={0}
      aria-label="Select the top highlight"
      onClick={(e) => select(e.currentTarget)}
      onKeyDown={(e) => {
        if (e.key !== "Enter" && e.key !== " ") return;
        e.preventDefault();
        select(e.currentTarget);
      }}
      className="cursor-pointer rounded-[3px] underline decoration-foreground/30 decoration-dashed decoration-1 underline-offset-[5px] outline-hidden transition-[text-decoration-color] duration-150 ease-out hover:decoration-foreground/70 focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-foreground"
    >
      {children}
    </span>
  );
}

export default function QuoteShareDemo() {
  return (
    <QuoteShare author="Ines Hartmann" title="The case for slower software">
      <article className="text-[15px]/[1.7] text-foreground/85">
        <p className="text-sm text-muted">Essay, 6 min read</p>
        <h2 className="mt-2 text-2xl font-semibold tracking-tight text-foreground">
          The case for slower software
        </h2>
        <p className="mt-5">
          Every product review I sit in eventually arrives at the same verdict:
          make it faster. Faster to load, faster to finish, faster to forget.
          Speed is the one metric nobody argues with.
        </p>
        <p className="mt-4">
          But the tools I keep coming back to are not the fastest ones. They
          are the ones that give me a moment to notice what I am doing.{" "}
          <TopHighlight>
            A good interface does not rush you through a decision; it holds
            the door open just long enough for you to walk through on purpose.
          </TopHighlight>
        </p>
        <p className="mt-4">
          Try selecting any sentence in this essay, or tap the underlined
          one above. The pill that appears is
          the whole feature: no share sheet, no modal full of networks, just
          the words you chose and two ways to pass them on.
        </p>
        <p className="mt-4">
          Slowness, used carefully, is a form of respect. It tells the person
          on the other side that their attention is worth more than a
          completion rate, and that the software will wait for them instead of
          the other way around.
        </p>
        <p className="mt-4">
          None of this means adding delays. It means choosing where the pauses
          go, the way a good editor chooses where the paragraphs break.
        </p>
      </article>
    </QuoteShare>
  );
}
