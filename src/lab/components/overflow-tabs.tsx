import { useEffect, useId, useRef, useState } from "react";
import {
  AnimatePresence,
  LayoutGroup,
  motion,
  useMotionTemplate,
  useMotionValue,
} from "motion/react";
import { useReducedMotion } from "@/lib/use-reduced-motion";
import { cn } from "@/lib/cn";

type Tab = { id: string; label: string; content: React.ReactNode };

const EASE_OUT = [0.23, 1, 0.32, 1] as const;
const UNDERLINE = { type: "spring", visualDuration: 0.25, bounce: 0 } as const;
const INSTANT = { duration: 0 } as const;
// The fade grows with distance from the edge and tops out here, so it
// appears gradually as you scroll instead of switching on.
const FADE = 48;
// A page leaves one fade's worth of overlap, so the tab that was half hidden
// under the fade lands fully in view instead of scrolling past unseen.
const PAGE_OVERLAP = FADE;
// Time constant of the wheel glide in ms: each notch settles in about 250ms,
// and notches that land mid-glide add to the target instead of restarting.
const GLIDE = 60;
// Mouse wheels send whole notches (around 100px); trackpads send a stream of
// small deltas that are already smooth and must stay 1:1 with the fingers.
const NOTCH = 50;

const panel = {
  enter: (reduce: boolean) => ({
    opacity: 0,
    y: reduce ? 0 : 4,
    filter: reduce ? "blur(0px)" : "blur(4px)",
  }),
  center: {
    opacity: 1,
    y: 0,
    filter: "blur(0px)",
    transition: { duration: 0.22, ease: EASE_OUT },
  },
  // Softer and faster than the entrance, so the old panel is gone before the
  // new one draws the eye.
  exit: {
    opacity: 0,
    y: 0,
    filter: "blur(0px)",
    transition: { duration: 0.12, ease: EASE_OUT },
  },
};

export function OverflowTabs({
  tabs,
  value,
  onChange,
  label,
  className,
}: {
  tabs: readonly Tab[];
  value: string;
  onChange: (id: string) => void;
  label: string;
  className?: string;
}) {
  const reduce = useReducedMotion() ?? false;
  const base = useId();
  const scrollerRef = useRef<HTMLDivElement>(null);
  const tabRefs = useRef(new Map<string, HTMLButtonElement>());
  const [edges, setEdges] = useState({ start: false, end: false });
  const [hovering, setHovering] = useState(false);
  // Lets the arrows and keyboard take over from a wheel glide mid-flight.
  const stopGlide = useRef(() => {});

  // Fade widths live in motion values, so scrolling never re-renders.
  const fadeStart = useMotionValue(0);
  const fadeEnd = useMotionValue(0);
  const mask = useMotionTemplate`linear-gradient(to right, transparent, #000 ${fadeStart}px, #000 calc(100% - ${fadeEnd}px), transparent)`;

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;

    const update = () => {
      const max = el.scrollWidth - el.clientWidth;
      // Clamped at both ends: overscroll on touch can report past the range.
      const before = Math.min(Math.max(el.scrollLeft, 0), max);
      const after = max - before;
      fadeStart.set(Math.min(before, FADE));
      fadeEnd.set(Math.min(after, FADE));
      // One pixel of slack, since zoomed layouts rarely land exactly on 0.
      const start = before > 1;
      const end = after > 1;
      setEdges((e) => (e.start === start && e.end === end ? e : { start, end }));
    };

    // Tracked separately from scrollLeft, which some browsers round to whole
    // pixels and would stall the last few frames of the glide.
    let target = 0;
    let position = 0;
    let frame = 0;
    let last = 0;

    const glide = (now: number) => {
      const t = 1 - Math.exp(-(now - last) / GLIDE);
      last = now;
      position += (target - position) * t;
      if (Math.abs(target - position) < 0.5) position = target;
      el.scrollLeft = position;
      frame = position === target ? 0 : requestAnimationFrame(glide);
    };
    const stop = () => {
      cancelAnimationFrame(frame);
      frame = 0;
    };
    stopGlide.current = stop;

    // Shift + wheel and a plain vertical wheel both scroll the strip
    // sideways. A vertical wheel only does so while there's room, so the page
    // takes over again at either end.
    const wheel = (e: WheelEvent) => {
      if (e.ctrlKey) return;
      const vertical = !e.shiftKey && Math.abs(e.deltaY) > Math.abs(e.deltaX);
      const delta =
        Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
      const precise = e.deltaMode === 0 && Math.abs(delta) < NOTCH;
      // A trackpad swiping sideways is already smooth; leave it native.
      if (precise && !vertical) return;

      const max = el.scrollWidth - el.clientWidth;
      // Picks up from wherever the strip is when nothing is gliding, so a
      // tab click or scrollbar drag in between is respected.
      if (!frame) target = position = el.scrollLeft;
      if ((delta < 0 && target <= 0) || (delta > 0 && target >= max - 1)) {
        return;
      }
      e.preventDefault();
      const px = e.deltaMode === 1 ? delta * 16 : delta;
      target = Math.min(Math.max(target + px, 0), max);

      if (precise || reduce) {
        stop();
        el.scrollLeft = position = target;
        return;
      }
      if (!frame) {
        last = performance.now();
        frame = requestAnimationFrame(glide);
      }
    };

    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    if (el.firstElementChild) observer.observe(el.firstElementChild);
    el.addEventListener("scroll", update, { passive: true });
    el.addEventListener("wheel", wheel, { passive: false });
    return () => {
      stop();
      observer.disconnect();
      el.removeEventListener("scroll", update);
      el.removeEventListener("wheel", wheel);
    };
  }, [fadeStart, fadeEnd, reduce]);

  const index = Math.max(
    tabs.findIndex((t) => t.id === value),
    0,
  );
  const active = tabs[index];

  const page = (direction: 1 | -1) => {
    const el = scrollerRef.current;
    if (!el) return;
    stopGlide.current();
    el.scrollBy({
      left: direction * (el.clientWidth - PAGE_OVERLAP),
      behavior: reduce ? "auto" : "smooth",
    });
  };

  const tabId = (id: string) => `${base}-tab-${id}`;
  const panelId = (id: string) => `${base}-panel-${id}`;

  return (
    <LayoutGroup id={base}>
      <div className={cn("flex min-w-0 flex-col", className)}>
        <div
          className="relative"
          onPointerEnter={(e) => {
            if (e.pointerType !== "touch") setHovering(true);
          }}
          onPointerLeave={() => setHovering(false)}
        >
          {/* Outside the scroller, so the baseline spans the full width and
              never scrolls or fades with the tabs. */}
          <div aria-hidden className="absolute inset-x-0 bottom-0 h-px bg-border" />
          <motion.div
            ref={scrollerRef}
            layoutScroll
            style={{ maskImage: mask, WebkitMaskImage: mask }}
            // scroll-padding keeps keyboard-selected tabs clear of the fades.
            className="scroll-px-12 overflow-x-auto overscroll-x-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          >
            <div
              role="tablist"
              aria-label={label}
              className="flex w-max gap-0.5 px-0.5"
              onKeyDown={(e) => {
                const target = {
                  ArrowRight: index + 1,
                  ArrowLeft: index - 1,
                  Home: 0,
                  End: tabs.length - 1,
                }[e.key];
                if (target === undefined) return;
                e.preventDefault();
                // Automatic activation: arrows select as well as focus.
                const next = tabs[(target + tabs.length) % tabs.length].id;
                onChange(next);
                const el = tabRefs.current.get(next);
                if (!el) return;
                // Native focus scrolling jumps; this glides the tab in, and
                // "nearest" leaves it alone when it's already visible.
                el.focus({ preventScroll: true });
                stopGlide.current();
                el.scrollIntoView({
                  block: "nearest",
                  inline: "nearest",
                  behavior: reduce ? "auto" : "smooth",
                });
              }}
            >
              {tabs.map((tab) => {
                const selected = tab.id === active.id;
                return (
                  <button
                    key={tab.id}
                    ref={(el) => {
                      if (el) tabRefs.current.set(tab.id, el);
                      else tabRefs.current.delete(tab.id);
                    }}
                    type="button"
                    role="tab"
                    id={tabId(tab.id)}
                    aria-selected={selected}
                    aria-controls={selected ? panelId(tab.id) : undefined}
                    tabIndex={selected ? 0 : -1}
                    onClick={() => onChange(tab.id)}
                    className={cn(
                      "group relative flex h-11 shrink-0 touch-manipulation items-center rounded-lg px-3 text-sm font-medium whitespace-nowrap text-muted outline-hidden transition-[color] duration-150 ease-out select-none hover:text-foreground focus-visible:outline-2 focus-visible:outline-solid focus-visible:-outline-offset-4 focus-visible:outline-foreground",
                      selected && "text-foreground",
                    )}
                  >
                    {/* Only the label presses in. Scaling the whole button
                        would skew the box Motion measures for the underline. */}
                    <span className="relative transition-[scale] duration-150 ease-out group-active:scale-[0.96] motion-reduce:transition-none">
                      {tab.label}
                    </span>
                    {selected && (
                      <motion.span
                        layoutId="underline"
                        aria-hidden
                        // Sits on the baseline so the two read as one line.
                        className="absolute inset-x-1.5 bottom-0 h-0.5 rounded-full bg-foreground"
                        transition={reduce ? INSTANT : UNDERLINE}
                      />
                    )}
                  </button>
                );
              })}
            </div>
          </motion.div>

          <Arrow
            direction={-1}
            visible={hovering && edges.start}
            onPress={() => page(-1)}
          />
          <Arrow
            direction={1}
            visible={hovering && edges.end}
            onPress={() => page(1)}
          />
        </div>

        {/* Both panels share one grid cell while they cross, so the old one
            never pushes the new one down. */}
        <div className="grid">
          <AnimatePresence initial={false} custom={reduce}>
            <motion.div
              key={active.id}
              role="tabpanel"
              id={panelId(active.id)}
              aria-labelledby={tabId(active.id)}
              tabIndex={0}
              custom={reduce}
              variants={panel}
              initial="enter"
              animate="center"
              exit="exit"
              className="col-start-1 row-start-1 rounded-lg px-3 pt-5 pb-1 text-[15px] leading-relaxed text-pretty text-muted outline-hidden focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-foreground"
            >
              {active.content}
            </motion.div>
          </AnimatePresence>
        </div>
      </div>
    </LayoutGroup>
  );
}

// Mouse-only shortcuts: keyboard users already page with the arrow keys, so
// these stay out of the tab order and away from screen readers.
function Arrow({
  direction,
  visible,
  onPress,
}: {
  direction: 1 | -1;
  visible: boolean;
  onPress: () => void;
}) {
  return (
    <button
      type="button"
      tabIndex={-1}
      aria-hidden
      // Leaves focus on the active tab, so arrow keys keep working after a
      // click here.
      onMouseDown={(e) => e.preventDefault()}
      onClick={onPress}
      className={cn(
        "absolute top-1/2 flex size-8 -translate-y-1/2 items-center justify-center rounded-full bg-background text-foreground shadow-raised transition-[opacity,scale] ease-[cubic-bezier(0.23,1,0.32,1)] select-none active:scale-[0.96] motion-reduce:transition-[opacity]",
        direction < 0 ? "left-1" : "right-1",
        // Arrives in 150ms, leaves in 100ms, and stops catching clicks the
        // moment it starts to go.
        visible
          ? "scale-100 opacity-100 duration-150"
          : "pointer-events-none scale-[0.96] opacity-0 duration-100 motion-reduce:scale-100",
      )}
    >
      <svg
        viewBox="0 0 16 16"
        className={cn("size-4", direction < 0 && "-scale-x-100")}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {/* Nudged 0.5px toward the point: a chevron's visual mass sits
            behind its tip. */}
        <path d="m6.5 4 4 4-4 4" transform="translate(0.5 0)" />
      </svg>
    </button>
  );
}

const line = (strong: string, rest: string) => (
  <>
    <span className="text-foreground">{strong}</span> {rest}
  </>
);

const TABS: Tab[] = [
  { id: "overview", label: "Overview", content: line("3 projects", "are live. Build times are down 12% since last week.") },
  { id: "deployments", label: "Deployments", content: line("Mira", "deployed main 4 minutes ago. Two previews are still building.") },
  { id: "analytics", label: "Analytics", content: line("18.2k visitors", "this week, most of them landing on the docs.") },
  { id: "logs", label: "Logs", content: line("No errors", "in the last 24 hours. Warnings are down to 3.") },
  { id: "storage", label: "Storage", content: line("2.4 GB", "of 10 GB used across two buckets and one database.") },
  { id: "domains", label: "Domains", content: line("lab.xevrion.dev", "is verified. Certificates renew in 41 days.") },
  { id: "integrations", label: "Integrations", content: line("GitHub and Slack", "are connected. Linear is waiting on approval.") },
  { id: "environment", label: "Environment", content: line("12 variables", "set for production, 9 shared with previews.") },
  { id: "security", label: "Security", content: line("Two-factor", "is on for every member. One key expires soon.") },
  { id: "usage", label: "Usage", content: line("64%", "of this month's build minutes used, resetting on the 1st.") },
  { id: "settings", label: "Settings", content: line("Deploys", "run on every push to main. Previews expire after 30 days.") },
];

export default function OverflowTabsDemo() {
  const [tab, setTab] = useState("overview");
  return (
    // A fixed height keeps the card still when panels of different lengths
    // swap in. 20px radius = the tabs' 8px plus the 12px padding.
    <div className="h-44 w-[min(480px,100%)] rounded-[20px] bg-background p-3 shadow-raised">
      <OverflowTabs label="Project" tabs={TABS} value={tab} onChange={setTab} />
    </div>
  );
}
