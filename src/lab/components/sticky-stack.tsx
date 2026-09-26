import { useEffect, useRef } from "react";
import { useReducedMotion } from "@/lib/use-reduced-motion";
import { cn } from "@/lib/cn";

export type StackItem = { title: string; text: string };

// Layout is fixed in px so every scroll position can be computed instead of
// measured: sticky elements report their stuck position, not their natural
// one, so measuring them mid-scroll would be wrong anyway.
const VIEWPORT = 480;
const HEADER = 112;
const CARD = 280;
// Scroll distance between one card settling and the next one arriving.
const GAP = 80;
const FIRST_TOP = 20;
// Each stuck card sits this much lower, leaving a strip of every card
// beneath it visible.
const STEP = 14;
// Per card resting on top. Four cards deep this reaches 0.84, still wide
// enough that the stack reads as cards rather than a fan.
const SCALE_PER_CARD = 0.04;
const DIM_PER_CARD = 0.12;
const MAX_DIM = 0.4;

const top = (i: number) => FIRST_TOP + i * STEP;
const natural = (i: number) => HEADER + i * (CARD + GAP);

export function StickyStack({
  items,
  label,
  heading,
  className,
}: {
  items: StackItem[];
  label: string;
  heading?: React.ReactNode;
  className?: string;
}) {
  const reduceMotion = useReducedMotion();
  const scroller = useRef<HTMLDivElement>(null);
  const cards = useRef<(HTMLElement | null)[]>([]);
  const shades = useRef<(HTMLElement | null)[]>([]);
  const fills = useRef<(HTMLElement | null)[]>([]);
  const dots = useRef<(HTMLElement | null)[]>([]);

  const last = items.length - 1;
  // Just enough room below the last card for it to reach its stuck spot, so
  // the scroll ends exactly as the stack completes.
  const bottomPad = VIEWPORT - CARD - top(last);

  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    let frame = 0;
    let current = -1;

    // One read (scrollTop) and a batch of transform and opacity writes per
    // frame, nothing that triggers layout.
    const update = () => {
      frame = 0;
      const s = el.scrollTop;
      // How far card i + 1 has slid over card i, 0 to 1: from its top edge
      // meeting card i's bottom edge until it sticks.
      const covered = items.map((_, i) => {
        if (i === last) return 0;
        const start = natural(i + 1) - top(i) - CARD;
        const end = natural(i + 1) - top(i + 1);
        return Math.min(Math.max((s - start) / (end - start), 0), 1);
      });

      let depth = 0;
      for (let i = last; i >= 0; i--) {
        depth += covered[i];
        const card = cards.current[i];
        const shade = shades.current[i];
        if (card) {
          card.style.transform = reduceMotion
            ? ""
            : `scale(${1 - depth * SCALE_PER_CARD})`;
        }
        if (shade) {
          shade.style.opacity = reduceMotion
            ? "0"
            : String(Math.min(depth * DIM_PER_CARD, MAX_DIM));
        }
        const fill = fills.current[i];
        if (fill) {
          const arrived = i === 0 ? 1 : covered[i - 1];
          fill.style.transform = `scaleY(${arrived})`;
        }
      }

      const front = covered.filter((c) => c >= 0.5).length;
      if (front !== current) {
        dots.current[current]?.removeAttribute("aria-current");
        dots.current[front]?.setAttribute("aria-current", "step");
        current = front;
      }
    };

    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };

    update();
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      el.removeEventListener("scroll", onScroll);
      cancelAnimationFrame(frame);
    };
  }, [items, last, reduceMotion]);

  const goTo = (i: number) => {
    scroller.current?.scrollTo({
      top: i === 0 ? 0 : natural(i) - top(i),
      behavior: reduceMotion ? "auto" : "smooth",
    });
  };

  return (
    <div className={cn("flex w-[min(480px,100%)] gap-2", className)}>
      <div
        ref={scroller}
        role="region"
        aria-label={label}
        tabIndex={0}
        className="min-w-0 flex-1 overflow-y-auto overscroll-contain rounded-3xl bg-surface px-4 outline-hidden [scrollbar-width:none] focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-foreground [&::-webkit-scrollbar]:hidden"
        style={{ height: VIEWPORT }}
      >
        <div style={{ paddingBottom: bottomPad }}>
          <div
            className="flex flex-col justify-center gap-1 px-2"
            style={{ height: HEADER }}
          >
            {heading}
          </div>
          {items.map((item, i) => (
            <article
              key={item.title}
              ref={(node) => {
                cards.current[i] = node;
              }}
              className="sticky flex origin-top flex-col justify-between rounded-2xl bg-background p-6 shadow-raised will-change-transform"
              style={{
                top: top(i),
                height: CARD,
                marginTop: i === 0 ? 0 : GAP,
              }}
            >
              <span className="font-mono text-sm text-muted tabular-nums">
                {String(i + 1).padStart(2, "0")}
              </span>
              <div className="flex flex-col gap-2">
                <h3 className="text-2xl font-semibold tracking-tight text-balance">
                  {item.title}
                </h3>
                <p className="text-[15px] leading-relaxed text-pretty text-muted">
                  {item.text}
                </p>
              </div>
              <div
                ref={(node) => {
                  shades.current[i] = node;
                }}
                aria-hidden
                className="pointer-events-none absolute inset-0 rounded-[inherit] bg-black opacity-0"
              />
            </article>
          ))}
        </div>
      </div>
      <nav aria-label="Jump to card" className="flex flex-col justify-center">
        {items.map((item, i) => (
          <button
            key={item.title}
            ref={(node) => {
              dots.current[i] = node;
            }}
            type="button"
            aria-label={`${i + 1}. ${item.title}`}
            onClick={() => goTo(i)}
            className="group flex h-10 w-6 touch-manipulation items-center justify-center rounded-full outline-hidden transition-[scale] duration-150 ease-out focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-foreground active:scale-[0.96] motion-reduce:transition-none"
          >
            <span className="h-7 w-[3px] overflow-hidden rounded-full bg-border transition-[scale] duration-150 ease-out group-hover:scale-x-150 motion-reduce:transition-none">
              <span
                ref={(node) => {
                  fills.current[i] = node;
                }}
                className="block size-full origin-top bg-foreground"
                // Matches scroll position 0 before the effect first runs.
                style={{ transform: `scaleY(${i === 0 ? 1 : 0})` }}
              />
            </span>
          </button>
        ))}
      </nav>
    </div>
  );
}

const PRINCIPLES: StackItem[] = [
  {
    title: "Respond on press",
    text: "Feedback starts the moment a finger lands, not when it lifts.",
  },
  {
    title: "Stay interruptible",
    text: "Anything in motion can be grabbed mid flight and sent somewhere else.",
  },
  {
    title: "Keep the velocity",
    text: "A release carries on at exactly the speed the hand gave it.",
  },
  {
    title: "Leave the way you came",
    text: "What slides in from the right goes back out to the right.",
  },
  {
    title: "Show restraint",
    text: "Motion people see a hundred times a day should barely be there.",
  },
];

export default function StickyStackDemo() {
  return (
    <StickyStack
      items={PRINCIPLES}
      label="Five principles of motion"
      heading={
        <>
          <h2 className="text-xl font-semibold tracking-tight">
            Five principles of motion
          </h2>
          <p className="text-sm text-muted">Scroll to stack them up.</p>
        </>
      }
    />
  );
}
