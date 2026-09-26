import { useCallback, useEffect, useRef, useState } from "react";
import { animate, motion, useMotionValue, useTransform } from "motion/react";
import { useReducedMotion } from "@/lib/use-reduced-motion";
import { cn } from "@/lib/cn";

/* The teachable part: every section gets a band on the spine as tall as the
   section is long, so the spine is a scale drawing of the article. The
   marker covering your section moves like a caterpillar: its leading edge
   springs ahead and the trailing edge catches up, so it stretches while it
   travels and settles to the size of the section it lands on. */

export type SpineItem = { id: string; label: string };

type Band = { top: number; height: number };

// Room between bands so neighbouring sections read as separate pieces.
const GAP = 8;
// A one-paragraph section still gets a band big enough to hover and click,
// and, with labels, tall enough for its heading's line.
const MIN_BAND = 14;
const MIN_BAND_LABELLED = 24;
// Below this width there is no room for headings beside the bands.
const INLINE_MIN = 120;
// The current-section block reaches a little past its band.
const MARK_PAD = 4;
// Where on screen the "reading line" sits: a third of the way down is where
// eyes rest while reading, so a section counts as current once its heading
// passes that line, not only when it hits the very top.
const READ_LINE = 0.3;
// Scroll positions land a few pixels short of the end on some trackpads.
const END_SLACK = 4;
// Space left above a heading after jumping to it, so it isn't flush.
const JUMP_OFFSET = 16;
// Leading edge: quick, so the marker answers the scroll at once.
const LEAD = { type: "spring", visualDuration: 0.24, bounce: 0 } as const;
// Trailing edge: slower on purpose, that lag is the stretch. 0.42s is the
// shortest lag where the stretch still reads on a one-band move.
const TRAIL = { type: "spring", visualDuration: 0.42, bounce: 0 } as const;

type Target = { kind: "element"; el: HTMLElement } | { kind: "window" };

function metrics(target: Target) {
  if (target.kind === "window") {
    return {
      scrollTop: window.scrollY,
      viewport: window.innerHeight,
      height: document.documentElement.scrollHeight,
      offsetOf: (el: HTMLElement) => el.getBoundingClientRect().top + window.scrollY,
    };
  }
  const box = target.el;
  const top = box.getBoundingClientRect().top;
  return {
    scrollTop: box.scrollTop,
    viewport: box.clientHeight,
    height: box.scrollHeight,
    offsetOf: (el: HTMLElement) => el.getBoundingClientRect().top - top + box.scrollTop,
  };
}

export function ScrollSpine({
  items,
  scrollRef,
  height = 320,
  label = "On this page",
  className,
}: {
  items: SpineItem[];
  /* The element that scrolls. Leave it out to follow the window, which is
     what a real article page wants. Headings are found by id either way. */
  scrollRef?: React.RefObject<HTMLElement | null>;
  height?: number;
  label?: string;
  className?: string;
}) {
  const reduceMotion = useReducedMotion() ?? false;
  const [bands, setBands] = useState<Band[]>([]);
  const [current, setCurrent] = useState(0);
  const [preview, setPreview] = useState<number | null>(null);
  // Wide enough for words: every band carries its heading. Narrow: bands
  // only, and the heading shows on hover or focus.
  const [inline, setInline] = useState(true);
  const markTop = useMotionValue(0);
  const markBottom = useMotionValue(0);
  const markHeight = useTransform([markTop, markBottom], ([t, b]: number[]) =>
    Math.max(0, b - t),
  );
  const nav = useRef<HTMLElement>(null);
  const notch = useRef<HTMLDivElement>(null);
  const fills = useRef<(HTMLSpanElement | null)[]>([]);
  // Scroll events read these, so they never wait on a render.
  const offsets = useRef<number[]>([]);
  const docEnd = useRef(0);
  const bandsRef = useRef<Band[]>([]);
  const currentRef = useRef(0);
  const placed = useRef(false);

  const target = useCallback((): Target | null => {
    if (!scrollRef) return { kind: "window" };
    return scrollRef.current ? { kind: "element", el: scrollRef.current } : null;
  }, [scrollRef]);

  useEffect(() => {
    const el = nav.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) =>
      setInline(entry.contentRect.width >= INLINE_MIN),
    );
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Measure section lengths and lay the bands out in proportion.
  useEffect(() => {
    const t = target();
    if (!t) return;
    const minBand = inline ? MIN_BAND_LABELLED : MIN_BAND;
    const measure = () => {
      const m = metrics(t);
      const tops = items.map((item) => {
        const el = document.getElementById(item.id);
        return el ? m.offsetOf(el) : 0;
      });
      offsets.current = tops;
      docEnd.current = m.height;
      const lens = tops.map((top, i) => Math.max(1, (tops[i + 1] ?? m.height) - top));
      const total = lens.reduce((a, b) => a + b, 0);
      const free = height - GAP * (items.length - 1) - minBand * items.length;
      let y = 0;
      const next = lens.map((len) => {
        const band = { top: y, height: minBand + (free * len) / total };
        y += band.height + GAP;
        return band;
      });
      bandsRef.current = next;
      setBands(next);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(t.kind === "window" ? document.body : (t.el.firstElementChild ?? t.el));
    return () => ro.disconnect();
  }, [items, height, target, inline]);

  // Follow the scroll: the reading dot and the read part of each band are
  // written straight to the DOM every frame; React only hears about it when
  // the current section changes.
  useEffect(() => {
    const t = target();
    if (!t || bands.length === 0) return;
    const scroller: HTMLElement | Window = t.kind === "window" ? window : t.el;
    let frame = 0;
    const update = () => {
      frame = 0;
      const m = metrics(t);
      const tops = offsets.current;
      const atEnd = m.scrollTop >= m.height - m.viewport - END_SLACK;
      const line = m.scrollTop + m.viewport * READ_LINE;
      let i = 0;
      while (i < tops.length - 1 && tops[i + 1] <= line) i++;
      if (atEnd) i = tops.length - 1;
      const start = tops[i];
      const end = tops[i + 1] ?? docEnd.current;
      const within = atEnd ? 1 : Math.min(1, Math.max(0, (line - start) / (end - start)));
      const band = bandsRef.current[i];
      if (band && notch.current) {
        notch.current.style.transform = `translateY(${band.top + within * band.height}px)`;
      }
      fills.current.forEach((f, k) => {
        if (f) f.style.transform = `scaleY(${k < i ? 1 : k === i ? within : 0})`;
      });
      if (i !== currentRef.current) {
        currentRef.current = i;
        setCurrent(i);
      }
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    update();
    scroller.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      scroller.removeEventListener("scroll", onScroll);
      cancelAnimationFrame(frame);
    };
  }, [bands, target]);

  // Move the marker. The edge in the direction of travel leads.
  useEffect(() => {
    const band = bands[current];
    if (!band) return;
    const top = band.top - MARK_PAD;
    const bottom = band.top + band.height + MARK_PAD;
    if (!placed.current || reduceMotion) {
      placed.current = true;
      markTop.jump(top);
      markBottom.jump(bottom);
      return;
    }
    const down = top >= markTop.get();
    // Not stopped between moves: a new animate() takes over mid-flight and
    // keeps the edge's velocity, so fast scrolling bends instead of restarts.
    animate(markTop, top, down ? TRAIL : LEAD);
    animate(markBottom, bottom, down ? LEAD : TRAIL);
  }, [bands, current, reduceMotion, markTop, markBottom]);

  useEffect(
    () => () => {
      markTop.stop();
      markBottom.stop();
    },
    [markTop, markBottom],
  );

  const jump = (i: number) => {
    const t = target();
    if (!t) return;
    const top = Math.max(0, offsets.current[i] - JUMP_OFFSET);
    const behavior = reduceMotion ? "auto" : "smooth";
    if (t.kind === "window") window.scrollTo({ top, behavior });
    else t.el.scrollTo({ top, behavior });
  };

  return (
    <nav
      ref={nav}
      aria-label={label}
      className={cn("relative w-[180px] shrink-0 select-none", className)}
      style={{ height }}
    >
      {/* The current section, as a soft block that stretches from band to
          band like a caterpillar. */}
      <motion.div
        aria-hidden
        style={{ top: markTop, height: markHeight }}
        className={cn(
          "absolute rounded-lg bg-foreground/[0.06]",
          inline ? "-left-2 right-0" : "left-1/2 w-5 -translate-x-1/2",
        )}
      />
      <ol className="absolute inset-0">
        {bands.map((band, i) => {
          const active = i === current;
          const shown = preview === i && !inline;
          return (
            <li
              key={items[i].id}
              className="absolute right-0 left-0"
              style={{ top: band.top, height: band.height }}
            >
              {/* The band: as tall as the section is long, filling in as
                  you read through it. */}
              <span
                aria-hidden
                className={cn(
                  "absolute inset-y-0 w-[3px] overflow-hidden rounded-full bg-foreground/[0.12]",
                  inline ? "left-0" : "left-1/2 -translate-x-1/2",
                )}
              >
                <span
                  ref={(el) => {
                    fills.current[i] = el;
                  }}
                  // Written by the scroll handler; starts empty. Not the
                  // Tailwind scale utility, which would multiply with it.
                  style={{ transform: "scaleY(0)" }}
                  className="absolute inset-0 origin-top rounded-full bg-foreground"
                />
              </span>
              <button
                type="button"
                aria-current={active ? "location" : undefined}
                onClick={() => jump(i)}
                onPointerEnter={(e) => {
                  if (e.pointerType !== "touch") setPreview(i);
                }}
                onPointerLeave={() => setPreview((p) => (p === i ? null : p))}
                onFocus={(e) => {
                  if (e.currentTarget.matches(":focus-visible")) setPreview(i);
                }}
                onBlur={() => setPreview((p) => (p === i ? null : p))}
                className={cn(
                  "group/band absolute touch-manipulation rounded-md text-left outline-hidden transition-[scale] duration-150 ease-out focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-foreground active:scale-[0.96] motion-reduce:transition-none",
                  inline ? "inset-y-0 -left-2 right-0 pl-5" : "inset-0",
                )}
              >
                {inline ? (
                  <span
                    className={cn(
                      "block truncate text-[13px] leading-4 transition-[color] duration-150 ease-out",
                      active
                        ? "font-medium text-foreground"
                        : "text-muted group-hover/band:text-foreground",
                    )}
                  >
                    {items[i].label}
                  </span>
                ) : (
                  <span className="sr-only">{items[i].label}</span>
                )}
              </button>
              {!inline && (
                // Preview label, hung off the left of the band.
                <span
                  aria-hidden
                  className={cn(
                    "pointer-events-none absolute top-0 right-full z-10 mr-1 rounded-full bg-foreground px-3 py-1.5 text-[13px] font-medium whitespace-nowrap text-background",
                    "transition-[opacity,translate,filter] ease-[cubic-bezier(0.23,1,0.32,1)] motion-reduce:translate-x-0",
                    shown
                      ? "translate-x-0 opacity-100 blur-none duration-200"
                      : "translate-x-1.5 opacity-0 blur-[2px] duration-100",
                  )}
                >
                  {items[i].label}
                </span>
              )}
            </li>
          );
        })}
      </ol>
      {/* Exactly where the reading line is, riding the bands. */}
      <div
        ref={notch}
        aria-hidden
        className={cn(
          "pointer-events-none absolute top-0 -mt-[4.5px] size-[9px] rounded-full bg-foreground ring-[3px] ring-surface",
          inline ? "-left-[3px]" : "left-1/2 -ml-[4.5px]",
          bands.length === 0 && "opacity-0",
        )}
      />
    </nav>
  );
}

/* An article page mock with its own scroll container. */

type Section = { id: string; heading: string; body: string[] };

const SECTIONS: Section[] = [
  {
    id: "spine-why",
    heading: "Why cold starts matter",
    body: [
      "Our checkout function woke up in 2.1 seconds on a cold start. On a warm path it answered in 40ms, so every idle stretch of five minutes was quietly costing us the first customer back.",
      "The fix was not one change but four, and the order we made them in mattered more than any single one.",
    ],
  },
  {
    id: "spine-measure",
    heading: "Measuring the right thing",
    body: [
      "We started with averages and learned nothing. The p50 cold start looked fine because most requests were warm. What we needed was the p99 of requests that followed ten minutes of silence.",
      "A tiny scheduled probe did the job: it waited, fired one request, recorded the timing, and went back to sleep. Two weeks of that gave us a curve worth arguing about.",
      "The curve had two humps. One was module loading, the other was the database handshake, and they were almost exactly the same size.",
      "That second hump surprised everyone, because the connection pool was supposed to hide it.",
    ],
  },
  {
    id: "spine-bundle",
    heading: "Shrinking the bundle",
    body: [
      "The function shipped 14 MB of JavaScript, most of it an SDK we called twice. Replacing it with two fetch calls took an afternoon and removed 11 MB.",
      "Tree shaking did the rest once we stopped importing from barrel files.",
    ],
  },
  {
    id: "spine-pool",
    heading: "The connection pool lie",
    body: [
      "A pool only helps if something is in it. After an idle period the platform froze the process, the sockets went stale, and the first query paid for a full TLS handshake plus a retry.",
      "We moved to an HTTP based driver that needs no socket at all. The handshake hump disappeared from the curve overnight.",
      "It cost us transactions across multiple statements, which we replaced with a single stored procedure for the one place that needed them.",
    ],
  },
  {
    id: "spine-result",
    heading: "Where we landed",
    body: [
      "Cold starts now sit at 380ms at the p99. Nobody notices them any more, which is the whole point.",
    ],
  },
  {
    id: "spine-next",
    heading: "What we would do next",
    body: [
      "Keep the probe. It has already caught one regression, a logging library that grew by 3 MB in a minor release.",
      "And measure before you tune. Every one of our first guesses was wrong.",
    ],
  },
];

const ITEMS: SpineItem[] = SECTIONS.map((s) => ({ id: s.id, label: s.heading }));

export default function ScrollSpineDemo() {
  const scroller = useRef<HTMLDivElement>(null);
  return (
    <div className="@container flex h-[440px] w-[620px] max-w-full overflow-hidden rounded-2xl bg-surface shadow-raised">
      <div
        ref={scroller}
        tabIndex={0}
        aria-label="Article"
        // The bottom fade says there is more below.
        className="min-w-0 flex-1 overflow-y-auto overscroll-contain [scrollbar-width:none] outline-hidden [&::-webkit-scrollbar]:hidden [mask-image:linear-gradient(to_bottom,black_calc(100%-48px),transparent)] focus-visible:outline-2 focus-visible:outline-solid focus-visible:-outline-offset-2 focus-visible:outline-foreground"
      >
        <article className="px-6 pt-6 pb-40 text-[15px] leading-relaxed text-pretty text-muted">
          <p className="text-[13px]">Engineering · 6 min read</p>
          <h2 className="mt-1 text-xl font-semibold text-balance text-foreground">
            How we cut cold starts from 2.1s to 380ms
          </h2>
          {SECTIONS.map((s) => (
            <section key={s.id}>
              <h3 id={s.id} className="mt-7 scroll-mt-4 text-base font-medium text-foreground">
                {s.heading}
              </h3>
              {s.body.map((p) => (
                <p key={p.slice(0, 24)} className="mt-3">
                  {p}
                </p>
              ))}
            </section>
          ))}
        </article>
      </div>
      {/* Headings beside the bands when there is room; bands alone on a
          phone, where the heading shows on hover or focus. */}
      <div className="flex w-12 shrink-0 flex-col items-center border-l border-border pt-6 @min-[520px]:w-[212px] @min-[520px]:items-stretch @min-[520px]:pr-5 @min-[520px]:pl-6">
        <p className="mb-4 hidden text-xs font-medium tracking-[0.06em] text-muted uppercase @min-[520px]:block">
          On this page
        </p>
        <ScrollSpine
          items={ITEMS}
          scrollRef={scroller}
          height={340}
          className="w-5 @min-[520px]:w-full"
        />
      </div>
    </div>
  );
}
