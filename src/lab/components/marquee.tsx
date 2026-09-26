import { useEffect, useRef, useSyncExternalStore } from "react";
import { cn } from "@/lib/cn";

const REDUCE = "(prefers-reduced-motion: reduce)";
const subscribeReduce = (onChange: () => void) => {
  const query = window.matchMedia(REDUCE);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
};

// The markup differs with reduced motion (one copy or two, dimmed or not),
// so hydration renders the server's answer first and switches right after,
// instead of mismatching.
function useReducedMotion() {
  return useSyncExternalStore(
    subscribeReduce,
    () => window.matchMedia(REDUCE).matches,
    () => false,
  );
}

// Braking is a response to the pointer, so it stays inside the 300ms budget.
const STOP_MS = 300;
// Picking back up is ambient, not a response, so it eases in a little slower
// and never feels like the row lurches away from the cursor.
const RESUME_MS = 450;

export function Marquee({
  items,
  // px per second, so a longer list scrolls at the same pace, not faster.
  speed = 40,
  direction = "left",
  label,
  // Dims the row except for a reading window in the middle.
  lens = true,
  className,
}: {
  items: string[];
  speed?: number;
  direction?: "left" | "right";
  label?: string;
  lens?: boolean;
  className?: string;
}) {
  const reduceMotion = useReducedMotion();
  const trackRef = useRef<HTMLDivElement>(null);
  const lensRef = useRef<HTMLDivElement>(null);
  const groupRef = useRef<HTMLUListElement>(null);
  const anims = useRef<Animation[]>([]);
  const raf = useRef(0);
  // A still row has nothing crossing the window, and hand-scrolling it
  // would slide the base copy out from under the lit one.
  const showLens = lens && !reduceMotion;

  useEffect(() => {
    const track = trackRef.current;
    const group = groupRef.current;
    if (!track || !group || reduceMotion) return;

    // Constant motion is the one place linear is right: any easing would make
    // the loop visibly surge and settle at the seam. WAAPI keyframes run on
    // the compositor like CSS ones, with no JS per frame, but also expose
    // playbackRate for the hover brake.
    const run = (el: HTMLElement) =>
      el.animate(
        [{ transform: "translateX(0)" }, { transform: "translateX(-50%)" }],
        {
          duration: (group.offsetWidth / speed) * 1000,
          iterations: Infinity,
          easing: "linear",
          direction: direction === "right" ? "reverse" : "normal",
        },
      );
    // The lit copy runs its own animation, created in the same frame so the
    // two start together; every later change is applied to both.
    const all = [track, lensRef.current]
      .filter((el): el is HTMLDivElement => el !== null)
      .map(run);
    anims.current = all;

    // Width changes (fonts loading, resizes) retime the loop, keeping the
    // current progress so the row never jumps.
    const ro = new ResizeObserver(() => {
      const next = (group.offsetWidth / speed) * 1000;
      const [a] = all;
      const prev = Number(a.effect?.getTiming().duration) || next;
      if (Math.abs(next - prev) < 1) return;
      const at = (((Number(a.currentTime) || 0) % prev) / prev) * next;
      for (const b of all) {
        b.effect?.updateTiming({ duration: next });
        b.currentTime = at;
      }
    });
    ro.observe(group);

    return () => {
      cancelAnimationFrame(raf.current);
      ro.disconnect();
      all.forEach((a) => a.cancel());
      anims.current = [];
    };
  }, [reduceMotion, speed, direction, showLens]);

  // animation-play-state can only snap and playbackRate can't be
  // transitioned, so ease the rate by hand. Starting from the current rate
  // means re-entering mid-resume brakes smoothly from wherever it got to.
  const rampTo = (target: number) => {
    const all = anims.current;
    const a = all[0];
    if (!a) return;
    cancelAnimationFrame(raf.current);
    if (target > 0 && a.playState === "paused") all.forEach((b) => b.play());
    const from = a.playbackRate;
    // A partial ramp takes a proportional share of the time.
    const ms = (target === 0 ? STOP_MS : RESUME_MS) * Math.abs(target - from);
    const start = performance.now();
    const tick = (now: number) => {
      const t = ms > 0 ? Math.min(1, (now - start) / ms) : 1;
      // Braking bites hard then coasts (ease-out cubic); resuming builds up
      // gently (ease-in-out quad) so the speed change reads as momentum.
      const e =
        target === 0
          ? 1 - (1 - t) ** 3
          : t < 0.5
            ? 2 * t * t
            : 1 - (-2 * t + 2) ** 2 / 2;
      for (const b of all) b.playbackRate = from + (target - from) * e;
      if (t < 1) raf.current = requestAnimationFrame(tick);
      // Fully stopped: pause so the compositor stops ticking an idle loop.
      // Both pause on the same frame, so the copies stay locked together.
      else if (target === 0) all.forEach((b) => b.pause());
    };
    raf.current = requestAnimationFrame(tick);
  };

  const group = (hidden: boolean) => (
    <ul
      ref={hidden ? undefined : groupRef}
      // list-style: none drops list semantics in Safari; this restores them.
      role={hidden ? undefined : "list"}
      aria-hidden={hidden || undefined}
      aria-label={hidden ? undefined : label}
      // The trailing separator lives inside each copy, so the seam spacing
      // matches every other gap and -50% lands exactly on the next copy.
      className="flex shrink-0 items-center"
    >
      {items.map((item) => (
        <li key={item} className="flex items-center whitespace-nowrap">
          {item}
          {/* Sized in em so the dot and gap scale with whatever text size
              the row is given. */}
          <span
            aria-hidden
            className="mx-[0.85em] size-[0.28em] shrink-0 rounded-full bg-current opacity-30"
          />
        </li>
      ))}
    </ul>
  );

  return (
    <div
      onPointerEnter={(e) => {
        if (e.pointerType !== "touch") rampTo(0);
      }}
      onPointerLeave={(e) => {
        if (e.pointerType !== "touch") rampTo(1);
      }}
      className={cn(
        "relative overflow-hidden py-2 select-none",
        // Fades 12% of each edge so items drift in and out instead of being
        // cut by a hard wall.
        "[mask-image:linear-gradient(to_right,transparent,black_12%,black_88%,transparent)]",
        // Standing still, clipped items would be unreachable, so the row
        // scrolls by hand instead.
        reduceMotion &&
          "overflow-x-auto [scrollbar-width:none] select-auto [&::-webkit-scrollbar]:hidden",
        className,
      )}
    >
      <div
        ref={trackRef}
        className={cn(
          "flex w-max",
          // Outside the lens the row sits back, so the lit copy is the
          // only thing at full strength.
          showLens && "opacity-40",
        )}
      >
        {group(false)}
        {!reduceMotion && group(true)}
      </div>
      {showLens && (
        // A second copy of the row at full strength, revealed only through a
        // soft window in the middle: words brighten as they cross it, and
        // braking on hover leaves one sitting in the lens, read.
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 py-2 [mask-image:linear-gradient(to_right,transparent_28%,black_40%,black_60%,transparent_72%)]"
        >
          <div ref={lensRef} className="flex w-max">
            {group(true)}
            {group(true)}
          </div>
        </div>
      )}
    </div>
  );
}

export default function MarqueeDemo() {
  return (
    <div className="flex w-[520px] max-w-full flex-col gap-2 font-medium">
      <Marquee
        label="Topics"
        className="text-lg text-foreground"
        items={[
          "Motion",
          "Springs",
          "Easing",
          "Layout",
          "Gestures",
          "Tokens",
          "Focus",
          "Blur",
        ]}
      />
      {/* Slower, quieter and moving the other way, so it reads as a layer
          further back rather than a second copy. */}
      <Marquee
        label="Techniques"
        direction="right"
        speed={24}
        // One lens per stack: the back row stays evenly quiet.
        lens={false}
        className="text-[15px] text-muted"
        items={[
          "Stagger",
          "Clip path",
          "Velocity",
          "Origin",
          "Presence",
          "Drag",
          "Shadows",
          "Radius",
        ]}
      />
    </div>
  );
}
