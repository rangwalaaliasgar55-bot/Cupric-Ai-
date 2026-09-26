import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/cn";

type Slide = {
  title: string;
  text: string;
  /** A small illustration above the text. Any CSS animation inside it only
   *  runs while its card is the centered one. */
  visual?: React.ReactNode;
};

type Drag = {
  id: number;
  startX: number;
  startScroll: number;
  samples: { t: number; x: number }[];
};

const CARD_WIDTH = 280;
const GAP = 16;
// How long a release coasts at its own speed before picking a card. Scaled
// with the card step (296px now, 212px when this was tuned at 200ms) so the
// same flick still travels the same number of cards.
const COAST = 280;

// The scrollLeft that centers each slide, read from layout so it holds for
// any card size or padding. The scroller is positioned, so offsetLeft is
// measured from its own content edge.
function snapTargets(el: HTMLElement) {
  const max = el.scrollWidth - el.clientWidth;
  return Array.from(el.children as HTMLCollectionOf<HTMLElement>, (c) =>
    Math.min(
      max,
      Math.max(0, c.offsetLeft + c.offsetWidth / 2 - el.clientWidth / 2),
    ),
  );
}

// Cards fade and shrink as they leave the center, driven by their own
// position in the scroller rather than JS. The timeline is 'cover', so 50%
// is the moment a card sits dead center. Browsers without scroll-driven
// animations skip the whole block and show every card at full size, which
// is still perfectly readable. Reduced motion keeps the fade, drops the scale.
const CSS = `
@supports (animation-timeline: view()) {
  .snap-carousel-card {
    animation: snap-carousel-focus linear both;
    animation-timeline: view(inline);
  }
  @keyframes snap-carousel-focus {
    0%, 100% { scale: 0.9; opacity: 0.5; }
    50% { scale: 1; opacity: 1; }
  }
  @media (prefers-reduced-motion: reduce) {
    @keyframes snap-carousel-focus {
      0%, 100% { opacity: 0.5; }
      50% { opacity: 1; }
    }
  }
}
/* Only the centered card plays, and only while the carousel is on screen:
   the neighbours hold whatever frame they reached, so a card picks its loop
   back up the moment it arrives in the middle. */
.snap-carousel-visual * { animation-play-state: paused; }
[data-onscreen] [data-active] .snap-carousel-visual * { animation-play-state: running; }
@media (prefers-reduced-motion: reduce) {
  .snap-carousel-visual * { animation: none !important; }
}
`;

export function SnapCarousel({
  slides,
  label = "Carousel",
  className,
}: {
  slides: Slide[];
  label?: string;
  className?: string;
}) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [atStart, setAtStart] = useState(true);
  const [atEnd, setAtEnd] = useState(false);

  // React skips the render when neither edge flag changes, so scrolling
  // costs a couple of reads per frame, not a re-render.
  const sync = () => {
    const el = scrollerRef.current;
    if (!el) return;
    // 1px of slack absorbs fractional scroll positions on scaled displays.
    setAtStart(el.scrollLeft <= 1);
    setAtEnd(el.scrollLeft >= el.scrollWidth - el.clientWidth - 1);
  };

  const drag = useRef<Drag | null>(null);
  // Set when a drag moved far enough that the click after it is not a click.
  const suppressClick = useRef(false);
  // Undoes the post-drag state (snap off, pending timers, listeners).
  const settle = useRef<(() => void) | null>(null);

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const update = () => {
      setAtStart(el.scrollLeft <= 1);
      setAtEnd(el.scrollLeft >= el.scrollWidth - el.clientWidth - 1);
    };
    const observer = new ResizeObserver(update);
    observer.observe(el);
    // Marks the fully visible (centered) card straight on the DOM, so which
    // card is playing never costs a render.
    const centered = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const slide = entry.target as HTMLElement;
          if (entry.intersectionRatio >= 0.9) slide.dataset.active = "";
          else delete slide.dataset.active;
        }
      },
      { root: el, threshold: [0, 0.9] },
    );
    for (const child of el.children) centered.observe(child);
    const onscreen = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) el.dataset.onscreen = "";
      else delete el.dataset.onscreen;
    });
    onscreen.observe(el);
    return () => {
      observer.disconnect();
      centered.disconnect();
      onscreen.disconnect();
      settle.current?.();
    };
  }, []);

  // Mouse only: touch, pen and trackpads already scroll natively, and
  // handling them here would fight the platform's own momentum.
  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerType !== "mouse" || e.button !== 0) return;
    const el = e.currentTarget;
    settle.current?.();
    el.setPointerCapture(e.pointerId);
    // Snap would yank the content to the nearest card on every scrollLeft
    // write, so it stays off until the release has picked its own card.
    el.style.scrollSnapType = "none";
    el.style.scrollBehavior = "auto";
    el.dataset.dragging = "";
    suppressClick.current = false;
    drag.current = {
      id: e.pointerId,
      startX: e.clientX,
      startScroll: el.scrollLeft,
      samples: [{ t: e.timeStamp, x: e.clientX }],
    };
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    const dx = e.clientX - d.startX;
    // Past 4px it is a drag, not a wobbly click.
    if (Math.abs(dx) > 4) suppressClick.current = true;
    e.currentTarget.scrollLeft = d.startScroll - dx;
    d.samples.push({ t: e.timeStamp, x: e.clientX });
    // Only the last 80ms say how fast the hand was moving at release.
    while (d.samples.length > 2 && e.timeStamp - d.samples[0].t > 80) {
      d.samples.shift();
    }
  };

  const onPointerEnd = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    drag.current = null;
    const el = e.currentTarget;
    delete el.dataset.dragging;

    const first = d.samples[0];
    const last = d.samples[d.samples.length - 1];
    const recent = e.timeStamp - last.t < 80;
    // Pixels per ms of content travel. A hand that stopped before letting
    // go has no momentum left to carry.
    const velocity =
      e.type === "pointerup" && recent && last.t > first.t
        ? -(last.x - first.x) / (last.t - first.t)
        : 0;

    const targets = snapTargets(el);
    const nearest = (pos: number) =>
      targets.reduce(
        (best, t, i) =>
          Math.abs(t - pos) < Math.abs(targets[best] - pos) ? i : best,
        0,
      );
    // Coasts at the release speed for a short decay that turns a long fast
    // drag into a card or two of travel, not a runaway spin.
    let index = nearest(el.scrollLeft + velocity * COAST);
    const from = nearest(d.startScroll);
    // A flick faster than 300px/s always moves at least one card, however
    // short it was.
    if (index === from && Math.abs(velocity) > 0.3) {
      index = Math.min(
        targets.length - 1,
        Math.max(0, from + Math.sign(velocity)),
      );
    }

    const reduce = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    el.scrollTo({
      left: targets[index],
      behavior: reduce ? "instant" : "smooth",
    });

    // Snap comes back only once the smooth scroll has arrived; turning it on
    // mid-flight makes the browser jump straight to the nearest card.
    const restore = () => {
      settle.current = null;
      clearTimeout(fallback);
      el.removeEventListener("scrollend", restore);
      el.style.scrollSnapType = "";
      el.style.scrollBehavior = "";
    };
    // For browsers without scrollend; a smooth scroll is done well within it.
    const fallback = setTimeout(restore, 700);
    el.addEventListener("scrollend", restore);
    settle.current = restore;
  };

  const step = (direction: 1 | -1) => {
    const el = scrollerRef.current;
    if (!el) return;
    const reduce = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    // Mandatory snapping lands this on the neighbouring card's center, even
    // when a previous smooth scroll is still in flight.
    el.scrollBy({
      left: direction * (CARD_WIDTH + GAP),
      behavior: reduce ? "instant" : "smooth",
    });
  };

  return (
    <div
      className={cn(
        "flex w-[min(520px,100%)] flex-col items-center gap-3",
        className,
      )}
    >
      <style href="snap-carousel" precedence="default">
        {CSS}
      </style>
      {/* The focus ring lives on the wrapper so the edge mask below fades
          only the cards, not the outline. */}
      <div className="w-full rounded-3xl has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-solid has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-foreground">
        {/* Native scroll-snap, so touch, trackpad momentum and arrow keys all
            behave like the platform. Inline padding of (container - 280px)
            / 2, 120px at full width, lets the first and last cards reach the
            center at any width; 16px of block padding keeps their shadows
            from being clipped. The 32px mask hints there is more past each
            edge. */}
        <div
          ref={scrollerRef}
          onScroll={sync}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerEnd}
          onPointerCancel={onPointerEnd}
          onClickCapture={(e) => {
            if (!suppressClick.current) return;
            suppressClick.current = false;
            e.preventDefault();
            e.stopPropagation();
          }}
          onDragStart={(e) => e.preventDefault()}
          tabIndex={0}
          role="region"
          aria-roledescription="carousel"
          aria-label={label}
          className="relative flex cursor-grab snap-x snap-mandatory gap-4 data-dragging:cursor-grabbing data-dragging:select-none overflow-x-auto overscroll-x-contain rounded-3xl px-[calc((100%-280px)/2)] py-4 outline-hidden [mask-image:linear-gradient(to_right,transparent,black_32px,black_calc(100%-32px),transparent)] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {slides.map((slide, i) => (
            // Snaps on the outer box and animates the inner one, so the
            // scale never changes what the snap points measure.
            <div
              key={slide.title}
              role="group"
              aria-roledescription="slide"
              aria-label={`${i + 1} of ${slides.length}`}
              className="shrink-0 snap-center"
            >
              <div className="snap-carousel-card flex h-[200px] w-[280px] flex-col justify-end gap-1.5 rounded-3xl bg-surface p-6 shadow-raised">
                {slide.visual && (
                  <div
                    aria-hidden
                    className="snap-carousel-visual relative mb-auto h-[68px] w-full"
                  >
                    {slide.visual}
                  </div>
                )}
                <p className="text-[15px] font-medium text-foreground">
                  {slide.title}
                </p>
                <p className="text-sm leading-5.5 text-pretty text-muted">
                  {slide.text}
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className="flex gap-3">
        <Arrow
          label="Previous card"
          disabled={atStart}
          onClick={() => step(-1)}
          path="M10 3.5 5.5 8l4.5 4.5"
        />
        <Arrow
          label="Next card"
          disabled={atEnd}
          onClick={() => step(1)}
          path="M6 3.5 10.5 8 6 12.5"
        />
      </div>
    </div>
  );
}

function Arrow({
  label,
  disabled,
  onClick,
  path,
}: {
  label: string;
  disabled: boolean;
  onClick: () => void;
  path: string;
}) {
  return (
    // aria-disabled rather than disabled: a truly disabled button throws
    // focus back to the page the moment the last card arrives.
    <button
      type="button"
      aria-label={label}
      aria-disabled={disabled}
      onClick={() => {
        if (!disabled) onClick();
      }}
      className={cn(
        "flex size-10 touch-manipulation items-center justify-center rounded-full bg-surface text-foreground shadow-raised outline-hidden transition-[scale,opacity] duration-150 ease-out select-none focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-foreground motion-reduce:transition-[opacity]",
        disabled ? "cursor-default opacity-40" : "active:scale-[0.96]",
      )}
    >
      <svg
        viewBox="0 0 16 16"
        className="size-5"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        <path d={path} />
      </svg>
    </button>
  );
}

// Each card acts out its own principle. These loops are explanatory, not UI
// feedback, so they run well past the usual 300ms: the eye needs time to
// compare. The track is the card's 232px content box, minus the 10px dot.
const DEMO_CSS = `
.sc-dot { position: absolute; left: 0; top: 50%; margin-top: -5px; width: 10px; height: 10px; border-radius: 999px; }
.sc-track { position: absolute; left: 5px; right: 5px; top: 50%; height: 1px; }

/* Same distance, same 1.3s: only the curve differs. */
.sc-linear { animation: sc-linear 2.6s infinite; }
.sc-eased { animation: sc-eased 2.6s infinite; }
@keyframes sc-linear {
  0% { translate: 0 0; opacity: 0; animation-timing-function: linear; }
  6% { translate: 0 0; opacity: 1; animation-timing-function: linear; }
  56% { translate: 222px 0; opacity: 1; }
  88% { translate: 222px 0; opacity: 1; }
  96%, 100% { translate: 222px 0; opacity: 0; }
}
@keyframes sc-eased {
  0% { translate: 0 0; opacity: 0; }
  6% { translate: 0 0; opacity: 1; animation-timing-function: cubic-bezier(0.23, 1, 0.32, 1); }
  56% { translate: 222px 0; opacity: 1; }
  88% { translate: 222px 0; opacity: 1; }
  96%, 100% { translate: 222px 0; opacity: 0; }
}

/* Sampled from a real spring (stiffness 170, damping 16) heading for the
   right tick, retargeted to the left one 260ms in. It overshoots and swings
   back without a stop, because it kept the speed it already had. */
.sc-spring { animation: sc-spring 2.6s linear infinite; }
@keyframes sc-spring {
  0% { translate: 0 0; opacity: 0; } 5% { opacity: 1; } 7.7% { translate: 0 0; } 9.2% { translate: 24.4px 0; } 10.8% { translate: 72px 0; } 12.3% { translate: 120.2px 0; } 13.8% { translate: 163.9px 0; } 15.4% { translate: 192.8px 0; } 16.9% { translate: 208.9px 0; } 18.5% { translate: 210.4px 0; } 20% { translate: 181.4px 0; } 21.5% { translate: 141.9px 0; } 23.1% { translate: 100.8px 0; } 24.6% { translate: 70.1px 0; } 26.2% { translate: 50.7px 0; } 27.7% { translate: 39.6px 0; } 29.2% { translate: 36.2px 0; } 30.8% { translate: 37px 0; } 32.3% { translate: 40.2px 0; } 33.8% { translate: 43.7px 0; } 35.4% { translate: 46.7px 0; } 36.9% { translate: 49.1px 0; } 38.5% { translate: 50.4px 0; } 40% { translate: 51px 0; } 41.5% { translate: 51.2px 0; } 44.6% { translate: 50.7px 0; } 47.7% { translate: 50.2px 0; } 50.8% { translate: 50px 0; }
  86% { translate: 50px 0; opacity: 1; }
  94%, 100% { translate: 50px 0; opacity: 0; }
}
/* The tick the spring is chasing is the solid one. */
.sc-target-a { animation: sc-target-a 2.6s step-end infinite; }
.sc-target-b { animation: sc-target-b 2.6s step-end infinite; }
@keyframes sc-target-a { 0% { opacity: 1; } 17.7% { opacity: 0.2; } 94% { opacity: 1; } }
@keyframes sc-target-b { 0% { opacity: 0.2; } 17.7% { opacity: 1; } 94% { opacity: 0.2; } }

.sc-bar { animation: sc-bar 2.2s infinite; transform-origin: bottom; }
@keyframes sc-bar {
  0% { opacity: 0; translate: 0 10px; animation-timing-function: cubic-bezier(0.23, 1, 0.32, 1); }
  16% { opacity: 1; translate: 0 0; }
  84% { opacity: 1; translate: 0 0; animation-timing-function: cubic-bezier(0.23, 1, 0.32, 1); }
  94%, 100% { opacity: 0; translate: 0 0; }
}

/* Two crossfades of the same square into the same circle; only the right
   one passes through a 4px blur, and reads as one shape changing. */
.sc-from, .sc-to { animation: 2.4s cubic-bezier(0.77, 0, 0.175, 1) infinite; }
.sc-from { animation-name: sc-from; }
.sc-to { animation-name: sc-to; }
.sc-soft.sc-from { animation-name: sc-from-blur; }
.sc-soft.sc-to { animation-name: sc-to-blur; }
@keyframes sc-from { 0%, 30% { opacity: 1; } 50%, 80% { opacity: 0; } 100% { opacity: 1; } }
@keyframes sc-to { 0%, 30% { opacity: 0; } 50%, 80% { opacity: 1; } 100% { opacity: 0; } }
@keyframes sc-from-blur { 0%, 30% { opacity: 1; filter: blur(0); } 50%, 80% { opacity: 0; filter: blur(4px); } 100% { opacity: 1; filter: blur(0); } }
@keyframes sc-to-blur { 0%, 30% { opacity: 0; filter: blur(4px); } 50%, 80% { opacity: 1; filter: blur(0); } 100% { opacity: 0; filter: blur(4px); } }

/* The trigger dips as if pressed, then the panel grows out of its corner. */
.sc-trigger { animation: sc-trigger 2.4s infinite; }
@keyframes sc-trigger {
  0%, 4% { scale: 1; animation-timing-function: ease-out; }
  8% { scale: 0.96; animation-timing-function: ease-out; }
  14%, 100% { scale: 1; }
}
.sc-panel { animation: sc-panel 2.4s infinite; transform-origin: 0 100%; }
@keyframes sc-panel {
  0%, 8% { opacity: 0; scale: 0.6; animation-timing-function: cubic-bezier(0.23, 1, 0.32, 1); }
  22% { opacity: 1; scale: 1; }
  82% { opacity: 1; scale: 1; animation-timing-function: ease-out; }
  90%, 100% { opacity: 0; scale: 0.96; }
}
`;

function Legend({ children }: { children: React.ReactNode }) {
  return <span className="font-mono text-xs text-muted">{children}</span>;
}

function EaseVisual() {
  return (
    <div className="flex h-full flex-col justify-center gap-3">
      {[
        { name: "linear", dot: "sc-linear bg-foreground/25" },
        { name: "ease-out", dot: "sc-eased bg-foreground" },
      ].map((row) => (
        <div key={row.name} className="flex flex-col gap-1">
          <Legend>{row.name}</Legend>
          <div className="relative h-2.5">
            <span className="sc-track bg-border" />
            <span className={cn("sc-dot", row.dot)} />
          </div>
        </div>
      ))}
    </div>
  );
}

function SpringVisual() {
  return (
    <div className="relative h-full">
      <span className="sc-track bg-border" />
      {/* Ticks sit under the dot's center at 50px and 200px of travel. */}
      <span className="sc-target-b absolute top-1/2 left-[54.5px] h-4 w-px -translate-y-1/2 bg-foreground" />
      <span className="sc-target-a absolute top-1/2 left-[204.5px] h-4 w-px -translate-y-1/2 bg-foreground" />
      <span className="sc-dot sc-spring bg-foreground" />
    </div>
  );
}

function StaggerVisual() {
  const heights = [26, 42, 34, 52, 38, 46];
  return (
    <div className="flex h-full items-end gap-2">
      {heights.map((h, i) => (
        <span
          key={i}
          className="sc-bar w-6 rounded-md bg-foreground/15 last:bg-foreground"
          style={{ height: h, animationDelay: `${i * 40}ms` }}
        />
      ))}
    </div>
  );
}

function BlurVisual() {
  return (
    <div className="flex h-full items-center justify-around">
      {[
        { name: "fade", soft: false },
        { name: "fade + blur", soft: true },
      ].map((pair) => (
        <div key={pair.name} className="flex flex-col items-center gap-2">
          <div className="grid">
            <span
              className={cn(
                "sc-from col-start-1 row-start-1 size-10 rounded-lg bg-foreground",
                pair.soft && "sc-soft",
              )}
            />
            <span
              className={cn(
                "sc-to col-start-1 row-start-1 size-10 rounded-full bg-foreground",
                pair.soft && "sc-soft",
              )}
            />
          </div>
          <Legend>{pair.name}</Legend>
        </div>
      ))}
    </div>
  );
}

function OriginVisual() {
  return (
    <div className="relative h-full">
      <span className="sc-trigger absolute bottom-0 left-0 h-5 w-14 rounded-full bg-foreground" />
      {/* Its corner sits on the trigger, which is where it grows from. */}
      <div className="sc-panel absolute bottom-7 left-1 flex h-11 w-32 flex-col justify-center gap-1.5 rounded-xl bg-background px-3 shadow-raised">
        <span className="h-1.5 w-16 rounded-full bg-foreground/20" />
        <span className="h-1.5 w-10 rounded-full bg-foreground/10" />
      </div>
    </div>
  );
}

function RestraintVisual() {
  // The one card with nothing moving, on purpose.
  return (
    <div className="relative h-full">
      <span className="sc-track bg-border" />
      <span className="sc-dot bg-foreground" style={{ left: "calc(50% - 5px)" }} />
      <span className="absolute top-[calc(50%+12px)] left-1/2 -translate-x-1/2">
        <Legend>0ms</Legend>
      </span>
    </div>
  );
}

const SLIDES: Slide[] = [
  { title: "Ease out", text: "Starts fast, settles gently.", visual: <EaseVisual /> },
  { title: "Spring", text: "Keeps its velocity when interrupted.", visual: <SpringVisual /> },
  { title: "Stagger", text: "Forty milliseconds between each item.", visual: <StaggerVisual /> },
  { title: "Blur", text: "Bridges two states into one motion.", visual: <BlurVisual /> },
  { title: "Origin", text: "Grows from where you pointed.", visual: <OriginVisual /> },
  { title: "Restraint", text: "Often the best animation is none.", visual: <RestraintVisual /> },
];

export default function SnapCarouselDemo() {
  return (
    <>
      <style href="snap-carousel-demo" precedence="default">
        {DEMO_CSS}
      </style>
      <SnapCarousel slides={SLIDES} label="Motion principles" />
    </>
  );
}
