import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { cn } from "@/lib/cn";

// Every loop is plain CSS on transform, opacity or clip-path, so it keeps
// moving even while the main thread is busy loading whatever the user is
// waiting for. Each loader also knows how to finish: pass `done` and it
// resolves in its own way instead of just vanishing.
const CSS = `
.loader-spin {
  /* Linear because a spinner has no start or end; any easing would read as
     a stutter once per turn. 700ms a turn is deliberately fast: a quicker
     spinner makes the same wait feel shorter. */
  animation: loader-spin 700ms linear infinite;
}
@keyframes loader-spin { to { rotate: 360deg; } }

/* Leapfrog: the back dot hops over the other two while they shuffle along
   underneath it. One 1.5s cycle is three moves; each dot runs the same loop a
   third of a cycle apart, so there is always exactly one dot in the air. The
   x and y halves live on separate elements, so the hop is a real arc rather
   than a diagonal. */
.loader-hop-x { animation: loader-hop-x 1.5s infinite; }
.loader-hop-y { animation: loader-hop-y 1.5s infinite; }
@keyframes loader-hop-x {
  0% { translate: 0 0; animation-timing-function: cubic-bezier(0.77, 0, 0.175, 1); }
  20%, 33.3% { translate: 14px 0; animation-timing-function: cubic-bezier(0.77, 0, 0.175, 1); }
  53.3%, 66.7% { translate: 28px 0; animation-timing-function: cubic-bezier(0.77, 0, 0.175, 1); }
  86.7%, 100% { translate: 0 0; }
}
@keyframes loader-hop-y {
  0%, 66.7% { translate: 0 0; animation-timing-function: cubic-bezier(0.23, 1, 0.32, 1); }
  76.7% { translate: 0 -9px; animation-timing-function: cubic-bezier(0.55, 0, 1, 0.45); }
  86.7%, 100% { translate: 0 0; }
}

/* Inchworm: the head reaches ahead while the tail holds, then the tail
   catches up and the pair slips off the far end. Clipping a full-width bar
   lets the segment stretch without scaling its round ends. */
.loader-worm { animation: loader-worm 1.4s infinite; }
@keyframes loader-worm {
  0% { clip-path: inset(0 100% 0 0 round 999px); animation-timing-function: cubic-bezier(0.23, 1, 0.32, 1); }
  45% { clip-path: inset(0 30% 0 0 round 999px); animation-timing-function: cubic-bezier(0.77, 0, 0.175, 1); }
  100% { clip-path: inset(0 0 0 100% round 999px); }
}

.loader-bone { position: relative; overflow: hidden; }
.loader-bone::after {
  content: "";
  position: absolute;
  inset: 0;
  background: linear-gradient(90deg, transparent, color-mix(in oklab, var(--foreground) 8%, transparent), transparent);
  translate: -100% 0;
  /* Slow and eased, since a skeleton stands in for content and should sit
     quietly behind it. The sweep ends at 70% and rests for the remaining
     30%, so it reads as a gentle pass rather than a constant blur. */
  animation: loader-shimmer 1.6s cubic-bezier(0.45, 0, 0.55, 1) infinite;
}
@keyframes loader-shimmer { 70%, 100% { translate: 100% 0; } }

/* Reduced motion: nothing travels or turns, but everything still pulses in
   opacity so the tile never looks finished or frozen. */
@keyframes loader-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.4; }
}
@media (prefers-reduced-motion: reduce) {
  .loader-spin { animation: loader-pulse 1.6s ease-in-out infinite; }
  .loader-hop-y { animation: none; }
  .loader-hop-x { animation: loader-pulse 1.6s ease-in-out infinite; }
  .loader-worm { animation: loader-pulse 1.6s ease-in-out infinite; clip-path: none; }
  .loader-bone::after { display: none; }
  .loader-bone { animation: loader-pulse 1.6s ease-in-out infinite; }
}
`;

const EASE_OUT = "cubic-bezier(0.23, 1, 0.32, 1)";
// A finish is the payoff of the wait, so it gets a little longer than a
// press: long enough to see the shape change, still under 300ms.
const FINISH_MS = 260;

function Styles() {
  return (
    <style href="loader-set" precedence="default">
      {CSS}
    </style>
  );
}

type LoaderProps = {
  label?: string;
  /** Replaces `label` once `done` turns true. */
  doneLabel?: string;
  /** Plays the loader's own finish instead of looping. */
  done?: boolean;
  className?: string;
};

function Status({
  label,
  className,
  children,
}: {
  label: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div role="status" aria-label={label} className={className}>
      <Styles />
      <span className="sr-only">{label}</span>
      {children}
    </div>
  );
}

// Freezes each element at the frame its CSS loop has reached, then carries it
// from there to `to`. Cancelling the loop outright would snap it back to its
// resting position first.
function settleFrom(
  elements: (HTMLElement | null)[],
  property: "translate" | "clipPath",
  to: string,
) {
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const running: Animation[] = [];
  for (const el of elements) {
    if (!el) continue;
    const style = getComputedStyle(el);
    const from = property === "translate" ? style.translate : style.clipPath;
    el.style.animation = "none";
    running.push(
      el.animate([{ [property]: from }, { [property]: to }], {
        duration: reduce ? 0 : FINISH_MS,
        easing: EASE_OUT,
        fill: "forwards",
      }),
    );
  }
  return () => {
    for (const a of running) a.cancel();
    for (const el of elements) if (el) el.style.animation = "";
  };
}

/** The arc closes into a full ring, then a check draws itself inside it. */
export function Spinner({
  label = "Loading",
  doneLabel = "Loaded",
  done = false,
  className,
}: LoaderProps) {
  return (
    <Status
      label={done ? doneLabel : label}
      className={cn("grid text-foreground", className)}
    >
      <svg
        viewBox="0 0 24 24"
        className={cn(
          "loader-spin col-start-1 row-start-1 size-7",
          // A full ring looks the same at any angle, so the turn can stop
          // the moment it starts closing.
          done && "[animation-play-state:paused]",
        )}
        fill="none"
        stroke="currentColor"
        strokeWidth={2.5}
        aria-hidden
      >
        <circle cx="12" cy="12" r="9" className="opacity-15" />
        {/* A quarter of the 56.5px circumference, rounded at both ends,
            growing to the whole of it. */}
        <circle
          cx="12"
          cy="12"
          r="9"
          strokeLinecap="round"
          strokeDasharray={done ? "56.5 56.5" : "14 56.5"}
          className="transition-[stroke-dasharray] duration-[260ms] ease-[cubic-bezier(0.23,1,0.32,1)] motion-reduce:transition-none"
        />
      </svg>
      <svg
        viewBox="0 0 24 24"
        className="col-start-1 row-start-1 size-7 text-foreground"
        fill="none"
        stroke="currentColor"
        strokeWidth={2.25}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        {/* Starts drawing as the ring finishes closing, so the two read as
            one gesture rather than two events. */}
        <path
          d="m8.25 12.25 2.5 2.5 5-5.5"
          pathLength={1}
          strokeDasharray="1 1"
          strokeDashoffset={done ? 0 : 1}
          className={cn(
            "transition-[stroke-dashoffset] ease-[cubic-bezier(0.23,1,0.32,1)] motion-reduce:transition-none",
            done ? "delay-150 duration-[240ms]" : "duration-100",
          )}
        />
      </svg>
    </Status>
  );
}

/** Three dots playing leapfrog; finishing pulls them into one full stop. */
export function PulseDots({
  label = "Loading",
  doneLabel = "Loaded",
  done = false,
  className,
}: LoaderProps) {
  const xs = useRef<(HTMLSpanElement | null)[]>([]);
  const ys = useRef<(HTMLSpanElement | null)[]>([]);

  useLayoutEffect(() => {
    if (!done) return;
    // The middle slot, so the merged dot sits where the group was centered.
    const undoX = settleFrom(xs.current, "translate", "14px 0");
    const undoY = settleFrom(ys.current, "translate", "0 0");
    return () => {
      undoX();
      undoY();
    };
  }, [done]);

  return (
    <Status
      label={done ? doneLabel : label}
      // 38px: three 10px dots on a 14px pitch.
      className={cn("relative h-2.5 w-[38px]", className)}
    >
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          aria-hidden
          ref={(el) => {
            xs.current[i] = el;
          }}
          // Each dot is a third of a cycle further along the same loop. The
          // inline translate is its slot, which only shows when the loop is
          // off (reduced motion).
          style={{ animationDelay: `${-0.5 * i}s`, translate: `${14 * i}px 0` }}
          className="loader-hop-x absolute top-0 left-0"
        >
          <span
            ref={(el) => {
              ys.current[i] = el;
            }}
            style={{ animationDelay: `${-0.5 * i}s` }}
            className="loader-hop-y block size-2.5 rounded-full bg-foreground"
          />
        </span>
      ))}
    </Status>
  );
}

/** An inchworm segment; finishing stretches it across the whole track. */
export function IndeterminateBar({
  label = "Loading",
  doneLabel = "Loaded",
  done = false,
  className,
}: LoaderProps) {
  const bar = useRef<HTMLSpanElement>(null);

  useLayoutEffect(() => {
    if (!done) return;
    return settleFrom([bar.current], "clipPath", "inset(0 0 0 0 round 999px)");
  }, [done]);

  return (
    <Status
      label={done ? doneLabel : label}
      className={cn("h-1 w-24 overflow-hidden rounded-full bg-foreground/10", className)}
    >
      <span ref={bar} aria-hidden className="loader-worm block h-full w-full bg-foreground" />
    </Status>
  );
}

/** Bones that shimmer, then cross-dissolve into the content they held. */
export function SkeletonLines({
  label = "Loading",
  doneLabel = "Loaded",
  done = false,
  title = "Report.pdf",
  detail = "2.4 MB",
  className,
}: LoaderProps & { title?: string; detail?: string }) {
  // Each bone sits on the line box its text will occupy, so the dissolve
  // swaps shapes in place instead of shifting anything.
  const bone = cn(
    "loader-bone col-start-1 row-start-1 self-center rounded-full bg-foreground/10 transition-[opacity,filter] duration-150 ease-out motion-reduce:transition-[opacity]",
    done && "opacity-0 blur-[4px]",
  );
  const text = cn(
    "col-start-1 row-start-1 truncate transition-[opacity,filter,translate] ease-[cubic-bezier(0.23,1,0.32,1)] motion-reduce:transition-[opacity]",
    done
      ? "translate-y-0 opacity-100 blur-[0px] duration-[260ms]"
      : "translate-y-0.5 opacity-0 blur-[4px] duration-150 motion-reduce:translate-y-0 motion-reduce:blur-[0px]",
  );

  return (
    <Status label={done ? doneLabel : label} className={cn("flex w-24 flex-col gap-1", className)}>
      <span className="grid h-5">
        <span aria-hidden className={cn(bone, "h-2.5 w-full")} />
        <span aria-hidden={!done} className={cn(text, "text-sm font-medium text-foreground")}>
          {title}
        </span>
      </span>
      <span className="grid h-4">
        <span aria-hidden className={cn(bone, "h-2.5 w-2/3")} />
        {/* Trails the title by 50ms: the lines resolve top to bottom, the
            order they are read in. */}
        <span
          aria-hidden={!done}
          className={cn(text, "text-xs text-muted", done && "delay-50")}
        >
          {detail}
        </span>
      </span>
    </Status>
  );
}

const TILES = [
  { name: "Spinner", Loader: Spinner },
  { name: "Dots", Loader: PulseDots },
  { name: "Progress", Loader: IndeterminateBar },
  { name: "Skeleton", Loader: SkeletonLines },
];

// Long enough to take the finish in, then the loader starts over.
const REPLAY_AFTER = 1600;

function Tile({ name, Loader }: (typeof TILES)[number]) {
  const [done, setDone] = useState(false);
  // A fresh key remounts the loader, so every replay starts from frame one.
  const [run, setRun] = useState(0);

  useEffect(() => {
    if (!done) return;
    const timer = setTimeout(() => {
      setDone(false);
      setRun((r) => r + 1);
    }, REPLAY_AFTER);
    return () => clearTimeout(timer);
  }, [done]);

  return (
    <li className="relative flex h-36 flex-col items-center rounded-2xl bg-surface transition-[background-color] duration-150 ease-out has-[button:hover]:bg-border/60">
      {/* Blurs in on each replay rather than popping back into its loop. */}
      <div
        key={run}
        className="flex flex-1 items-center justify-center transition-[opacity,filter] duration-200 ease-out starting:opacity-0 starting:blur-[4px]"
      >
        <Loader
          label={`Loading, ${name.toLowerCase()}`}
          doneLabel={`${name} finished`}
          done={done}
        />
      </div>
      <span className="pb-4 text-sm text-muted">{name}</span>
      {/* Laid over the whole tile but outside the status, so the live region
          is never swallowed by a button's presentational children. */}
      <button
        type="button"
        aria-label={`Finish ${name.toLowerCase()}`}
        aria-disabled={done}
        onClick={() => {
          if (!done) setDone(true);
        }}
        className="absolute inset-0 rounded-2xl outline-hidden focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-foreground aria-disabled:cursor-default"
      />
    </li>
  );
}

export function LoaderSet({ className }: { className?: string }) {
  return (
    // Two by two on a phone, one row once there's room for four tiles.
    <div
      className={cn(
        "@container flex w-[min(560px,100%)] flex-col items-center gap-3",
        className,
      )}
    >
      <ul className="grid w-full grid-cols-2 gap-3 @md:grid-cols-4">
        {TILES.map((tile) => (
          <Tile key={tile.name} {...tile} />
        ))}
      </ul>
      <p className="text-[13px] text-muted">Click a tile to see how it finishes</p>
    </div>
  );
}

export default function LoaderSetDemo() {
  return <LoaderSet />;
}
