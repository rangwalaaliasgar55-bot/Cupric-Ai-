import { Fragment, useCallback, useEffect, useRef } from "react";
import { useReducedMotion } from "@/lib/use-reduced-motion";
import { cn } from "@/lib/cn";

// Short thumbs are hard to grab, so it never shrinks below this.
const MIN_THUMB = 32;

// Each word lights up over this share of the scroll, so several are always
// mid-fade and the edge between read and unread text stays soft.
const WINDOW = 0.14;

// Only where the timeline can run, and only with motion allowed, do words
// start dimmed. Everywhere else the text is simply readable. Linear, because
// the scroll position is already the clock.
const CSS = `
@supports (animation-timeline: scroll()) {
  @media (prefers-reduced-motion: no-preference) {
    .scroll-reveal {
      scroll-timeline: --scroll-reveal y;
    }
    .scroll-reveal-word {
      animation: scroll-reveal-word linear both;
      animation-timeline: --scroll-reveal;
      animation-range: var(--start) var(--end);
    }
  }
}
@keyframes scroll-reveal-word {
  from {
    color: var(--muted);
    opacity: 0.5;
    filter: blur(2px);
  }
  to {
    color: var(--foreground);
    opacity: 1;
    filter: blur(0);
  }
}
`;

export function ScrollReveal({
  text,
  label,
  className,
}: {
  text: string;
  label: string;
  className?: string;
}) {
  const words = text.split(/\s+/).filter(Boolean);
  const last = Math.max(words.length - 1, 1);
  const reduceMotion = useReducedMotion();
  const scrollerRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const thumbRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ startY: number; startScroll: number }>(null);

  // Written straight to the thumb on every scroll, so it tracks without
  // re-rendering React.
  const sync = useCallback(() => {
    const scroller = scrollerRef.current;
    const track = trackRef.current;
    const thumb = thumbRef.current;
    if (!scroller || !track || !thumb) return;
    const height = Math.max(
      (scroller.clientHeight / scroller.scrollHeight) * track.clientHeight,
      MIN_THUMB,
    );
    const max = scroller.scrollHeight - scroller.clientHeight;
    const progress = max > 0 ? scroller.scrollTop / max : 0;
    thumb.style.height = `${height}px`;
    thumb.style.transform = `translateY(${progress * (track.clientHeight - height)}px)`;
  }, []);

  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    sync();
    const observer = new ResizeObserver(sync);
    observer.observe(scroller);
    return () => observer.disconnect();
  }, [sync]);

  // How many px of scroll one px of thumb travel is worth.
  const ratio = () => {
    const scroller = scrollerRef.current!;
    const track = trackRef.current!;
    const thumb = thumbRef.current!;
    return (
      (scroller.scrollHeight - scroller.clientHeight) /
      Math.max(track.clientHeight - thumb.offsetHeight, 1)
    );
  };

  return (
    // The surface and focus ring live on the wrapper so the edge mask below
    // fades only the text, not the box or its outline.
    <div
      className={cn(
        "relative h-[360px] w-[480px] max-w-full rounded-3xl bg-surface shadow-raised has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-solid has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-foreground",
        className,
      )}
    >
      <style href="scroll-reveal" precedence="default">
        {CSS}
      </style>
      {/* 44px fades hint that the text continues past each edge. */}
      <div
        ref={scrollerRef}
        onScroll={sync}
        tabIndex={0}
        role="region"
        aria-label={label}
        className="scroll-reveal h-full overflow-y-auto overscroll-contain rounded-3xl outline-hidden [mask-image:linear-gradient(to_bottom,transparent,black_44px,black_calc(100%-44px),transparent)] [scrollbar-width:none]"
      >
        {/* The padding adds up to the box height (136 + 224 = 360), so the
            reveal edge holds still about 40% down while the text moves
            through it, from the first line to the last. */}
        <p className="px-9 pt-[136px] pb-[224px] text-2xl leading-8 font-medium tracking-tight text-pretty text-foreground">
          {words.map((word, i) => {
            const start = (i / last) * (1 - WINDOW);
            return (
              <Fragment key={i}>
                <span
                  className="scroll-reveal-word"
                  style={
                    {
                      "--start": `${start * 100}%`,
                      "--end": `${(start + WINDOW) * 100}%`,
                    } as React.CSSProperties
                  }
                >
                  {word}
                </span>{" "}
              </Fragment>
            );
          })}
        </p>
      </div>
      {/* Outside the scroller, so the edge mask never fades it. The native
          bar is hidden; this one can be dragged to scrub through the reveal. */}
      <div
        ref={trackRef}
        aria-hidden
        className="group/bar absolute top-5 right-2 bottom-5 flex w-3.5 cursor-pointer touch-none justify-center"
        onPointerDown={(e) => {
          const scroller = scrollerRef.current;
          const thumb = thumbRef.current;
          if (!scroller || !thumb || e.button !== 0) return;
          if (e.target === thumb) {
            drag.current = { startY: e.clientY, startScroll: scroller.scrollTop };
            e.currentTarget.setPointerCapture(e.pointerId);
            return;
          }
          // A click on the rail glides there, centring the thumb on the click.
          const box = e.currentTarget.getBoundingClientRect();
          const offset = e.clientY - box.top - thumb.offsetHeight / 2;
          scroller.scrollTo({
            top: offset * ratio(),
            behavior: reduceMotion ? "auto" : "smooth",
          });
        }}
        onPointerMove={(e) => {
          const scroller = scrollerRef.current;
          if (!drag.current || !scroller) return;
          scroller.scrollTop =
            drag.current.startScroll + (e.clientY - drag.current.startY) * ratio();
        }}
        onPointerUp={() => {
          drag.current = null;
        }}
        onPointerCancel={() => {
          drag.current = null;
        }}
      >
        <div
          ref={thumbRef}
          className="w-1.5 rounded-full bg-foreground/20 transition-[width,background-color] duration-150 ease-out group-hover/bar:w-2 group-hover/bar:bg-foreground/35 group-active/bar:bg-foreground/50"
        />
      </div>
    </div>
  );
}

export default function ScrollRevealDemo() {
  return (
    <ScrollReveal
      label="About motion"
      text="Good motion is felt before it is noticed. It tells you where something came from, what just changed, and what will happen when you let go. When every duration and curve is chosen on purpose, an interface stops feeling like a screen and starts feeling like a material."
    />
  );
}
