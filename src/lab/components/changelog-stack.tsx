import { useCallback, useEffect, useRef, useState } from "react";
import {
  animate,
  motion,
  useMotionValue,
  useSpring,
  useTransform,
  type AnimationPlaybackControls,
  type MotionValue,
  type PanInfo,
} from "motion/react";
import { useReducedMotion } from "@/lib/use-reduced-motion";
import { cn } from "@/lib/cn";

export type ChangeTag = "New" | "Improved" | "Fixed";

export type Release = {
  version: string;
  date: string;
  title: string;
  changes: { tag: ChangeTag; text: string }[];
};

type Direction = { side: 1 | -1 };

// Each card further back sits a little lower and smaller, so the edges of
// the next cards peek out under the top one like a real stack.
const STEP_Y = 11;
const STEP_SCALE = 0.045;
// Only this many cards show; the rest wait, invisible, at the last depth.
const VISIBLE = 3;
const CARD_HEIGHT = 244;
// A flick counts past this distance or speed, so a lazy throw still files
// the card without having to drag it all the way off.
const THROW_DISTANCE = 90;
const THROW_SPEED = 500;
// How far, as a share of the card's width, the filed card travels sideways
// before it tucks back in: enough to clear the stack so it visibly goes
// behind, not through.
const TUCK_X = 0.72;
// Delay between cards when jumping several versions, so a jump reads as a
// quick riffle instead of a teleport.
const RIFFLE_MS = 110;
const EASE_OUT = [0.23, 1, 0.32, 1] as const;
const SETTLE = { type: "spring", duration: 0.45, bounce: 0.12 } as const;

function pose(depth: number) {
  const d = Math.min(depth, VISIBLE);
  return {
    y: d * STEP_Y,
    scale: 1 - d * STEP_SCALE,
    opacity: depth < VISIBLE ? 1 : 0,
  };
}

export function ChangelogStack({
  releases,
  className,
}: {
  // Newest first, the way a changelog reads.
  releases: Release[];
  className?: string;
}) {
  const reduceMotion = useReducedMotion() ?? false;
  const n = releases.length;
  const [index, setIndex] = useState(0);
  // Which side the next filed card leaves by. Read by the cards when their
  // depth changes, so it's a ref rather than state.
  const direction = useRef<Direction>({ side: -1 });
  const queue = useRef<ReturnType<typeof setTimeout>[]>([]);
  const stackRef = useRef<HTMLDivElement>(null);

  const clearQueue = () => {
    queue.current.forEach(clearTimeout);
    queue.current = [];
  };
  useEffect(() => clearQueue, []);

  // Older releases file the top card to the back; newer ones pull the back
  // card out to the top.
  const step = useCallback(
    (by: 1 | -1, side: 1 | -1 = by === 1 ? -1 : 1) => {
      direction.current = { side };
      setIndex((i) => Math.min(Math.max(i + by, 0), n - 1));
    },
    [n],
  );

  const go = (by: 1 | -1, side?: 1 | -1) => {
    clearQueue();
    step(by, side);
  };

  const jump = (target: number) => {
    clearQueue();
    const by = target > index ? 1 : -1;
    const count = Math.abs(target - index);
    for (let k = 0; k < count; k++) {
      queue.current.push(setTimeout(() => step(by), k * RIFFLE_MS));
    }
  };

  const current = releases[index];

  return (
    <section
      aria-roledescription="carousel"
      aria-label="What's new"
      className={cn("flex w-[min(420px,100%)] flex-col gap-5", className)}
    >
      <header className="flex items-end justify-between gap-3 px-1">
        <div className="flex flex-col gap-1">
          <p className="text-[13px] font-medium text-muted">What&apos;s new</p>
          <RollingVersion
            version={current.version}
            versions={releases.map((r) => r.version)}
            reduceMotion={reduceMotion}
          />
        </div>
        <div className="flex gap-2">
          <NavButton
            label="Newer release"
            onClick={() => go(-1)}
            disabled={index === 0}
          >
            <path d="M10 3.5 5.5 8l4.5 4.5" />
          </NavButton>
          <NavButton
            label="Older release"
            onClick={() => go(1)}
            disabled={index === n - 1}
          >
            <path d="M6 3.5 10.5 8 6 12.5" />
          </NavButton>
        </div>
      </header>

      <div
        ref={stackRef}
        tabIndex={0}
        role="group"
        aria-label="Release cards. Arrow keys riffle through versions."
        onKeyDown={(e) => {
          if (e.key === "ArrowRight" || e.key === "ArrowDown") {
            e.preventDefault();
            if (index < n - 1) go(1);
          } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
            e.preventDefault();
            if (index > 0) go(-1);
          } else if (e.key === "Home") {
            e.preventDefault();
            jump(0);
          } else if (e.key === "End") {
            e.preventDefault();
            jump(n - 1);
          }
        }}
        className="relative rounded-[18px] outline-hidden focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-4 focus-visible:outline-foreground"
        // Room below the top card for the peeking edges of the cards behind.
        style={{ height: CARD_HEIGHT + STEP_Y * (VISIBLE - 1) }}
      >
        {releases.map((release, i) => (
          <Card
            key={release.version}
            release={release}
            // Cards already read sit behind the unread ones, in order, so
            // going back pulls the most recently filed card out first.
            depth={(i - index + n) % n}
            total={n}
            direction={direction}
            stackRef={stackRef}
            reduceMotion={reduceMotion}
            canThrow={index < n - 1}
            onThrow={(side) => go(1, side)}
          />
        ))}
      </div>

      <Timeline releases={releases} index={index} onSelect={jump} />

      <p className="sr-only" aria-live="polite">
        {`Version ${current.version}, ${current.date}: ${current.title}. ${current.changes
          .map((c) => `${c.tag}: ${c.text}`)
          .join(". ")}`}
      </p>
    </section>
  );
}

function Card({
  release,
  depth,
  total,
  direction,
  stackRef,
  reduceMotion,
  canThrow,
  onThrow,
}: {
  release: Release;
  depth: number;
  total: number;
  direction: React.RefObject<Direction>;
  stackRef: React.RefObject<HTMLDivElement | null>;
  reduceMotion: boolean;
  canThrow: boolean;
  onThrow: (side: 1 | -1) => void;
}) {
  const start = pose(depth);
  const x = useMotionValue(0);
  const y = useMotionValue(start.y);
  const scale = useMotionValue(start.scale);
  const opacity = useMotionValue(start.opacity);
  const z = useMotionValue(total - depth);
  // The tilt comes from the sideways travel alone, like a card held by its
  // bottom corner, so a drag and a filing tilt the same way.
  const rotate = useTransform(x, [-300, 0, 300], [-7, 0, 7]);
  const previous = useRef(depth);
  const running = useRef<AnimationPlaybackControls[]>([]);

  useEffect(() => {
    const from = previous.current;
    previous.current = depth;
    if (from === depth) return;
    running.current.forEach((a) => a.stop());
    running.current = [];
    const to = pose(depth);
    const run = (a: AnimationPlaybackControls) => {
      running.current.push(a);
      return a;
    };
    const settle = () => {
      z.set(total - depth);
      run(animate(x, 0, SETTLE));
      run(animate(y, to.y, SETTLE));
      run(animate(scale, to.scale, SETTLE));
      run(animate(opacity, to.opacity, { duration: 0.25, ease: EASE_OUT }));
    };

    if (reduceMotion) {
      z.set(total - depth);
      x.jump(0);
      y.jump(to.y);
      scale.jump(to.scale);
      run(animate(opacity, to.opacity, { duration: 0.2 }));
      return;
    }

    const filed = from === 0 && depth === total - 1;
    const pulled = from === total - 1 && depth === 0;
    if (!filed && !pulled) {
      settle();
      return;
    }

    // Out to the side first, lifted as a hand would hold it. Only once it
    // clears the stack does it change layer, then it slides home. The first
    // leg keeps any throw velocity so a flick carries straight through.
    const side = direction.current.side;
    const width = stackRef.current?.offsetWidth ?? 400;
    z.set(filed ? total + 1 : 0);
    const out = { duration: 0.2, ease: EASE_OUT };
    const lead = run(
      animate(x, side * width * TUCK_X, { ...out, velocity: x.getVelocity() }),
    );
    // A small lift: any higher and the tilted corner covers the version
    // number rolling in the header, which is the thing to watch.
    run(animate(y, -6, out));
    run(animate(scale, filed ? 1.02 : 1 - STEP_SCALE, out));
    run(animate(opacity, 1, out));
    lead.finished.then(() => {
      if (previous.current === depth) settle();
    });
  }, [
    depth,
    total,
    direction,
    stackRef,
    reduceMotion,
    x,
    y,
    scale,
    opacity,
    z,
  ]);

  useEffect(() => () => running.current.forEach((a) => a.stop()), []);

  const top = depth === 0;

  const onDragEnd = (_: unknown, info: PanInfo) => {
    const far = Math.abs(info.offset.x) > THROW_DISTANCE;
    const fast = Math.abs(info.velocity.x) > THROW_SPEED;
    if (canThrow && (far || fast)) {
      // Projects the release a little ahead so a flick back against a long
      // drag goes the way the hand was moving at the end.
      onThrow(info.offset.x + info.velocity.x * 0.1 < 0 ? -1 : 1);
    } else {
      animate(x, 0, {
        type: "spring",
        duration: 0.4,
        bounce: 0.2,
        velocity: info.velocity.x,
      });
    }
  };

  return (
    <motion.article
      aria-hidden={!top}
      // Dragging stays on with reduced motion: the card only moves under
      // the hand, and the filing itself is what gets simplified.
      drag={top ? "x" : false}
      dragMomentum={false}
      // The oldest card resists: there's nothing older to file it behind.
      dragElastic={canThrow ? 0.9 : 0.15}
      dragConstraints={{ left: 0, right: 0 }}
      onDragEnd={onDragEnd}
      style={{
        x,
        y,
        scale,
        rotate,
        opacity,
        zIndex: z,
        height: CARD_HEIGHT,
        transformOrigin: "50% 100%",
      }}
      className={cn(
        "absolute inset-x-0 top-0 flex touch-pan-y flex-col overflow-hidden rounded-[18px] bg-background shadow-raised select-none",
        top ? "cursor-grab active:cursor-grabbing" : "pointer-events-none",
      )}
    >
      <CardFace release={release} />
    </motion.article>
  );
}

function CardFace({ release }: { release: Release }) {
  return (
    <div className="flex h-full flex-col">
      {/* The title goes above the red rule, the way you head a real index
          card; the version rides along in small type for when the card is
          seen on its own, mid-flight or peeking from the stack. */}
      <div className="flex items-end justify-between gap-3 px-5 pt-4 pb-3">
        <div className="min-w-0">
          <p className="font-mono text-[12px] leading-4 text-muted tabular-nums">
            v{release.version}
          </p>
          <h3 className="mt-0.5 truncate text-[17px] leading-6 font-semibold tracking-tight">
            {release.title}
          </h3>
        </div>
        <time className="shrink-0 text-[13px] leading-6 text-muted tabular-nums">
          {release.date}
        </time>
      </div>
      {/* The red header rule a ruled index card has, in marker ink. */}
      <div aria-hidden className="h-[1.5px] bg-marker/70" />
      <div
        className="flex flex-1 flex-col px-5 pt-1"
        // Faint ruled lines, one under each 32px row. The first layer
        // covers the 4px above the first row, where the repeat would
        // otherwise draw a second line hugging the red rule.
        style={{
          backgroundImage:
            "linear-gradient(var(--background), var(--background)), repeating-linear-gradient(to bottom, transparent 0 31px, color-mix(in oklab, var(--border) 80%, transparent) 31px 32px)",
          backgroundSize: "100% 4px, 100% 32px",
          backgroundRepeat: "no-repeat, repeat",
          backgroundPosition: "0 0, 0 4px",
        }}
      >
        <ul className="flex flex-col">
          {release.changes.slice(0, 5).map((change) => (
            <li key={change.text} className="flex h-8 items-center gap-2.5">
              <Tag tag={change.tag} />
              <span className="truncate text-[13px] sm:text-[14px]">
                {change.text}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function Tag({ tag }: { tag: ChangeTag }) {
  return (
    <span
      className={cn(
        "inline-flex h-5 w-[68px] shrink-0 items-center justify-center rounded-full text-[12px] leading-none font-medium",
        tag === "New" && "bg-foreground text-background",
        tag === "Improved" &&
          "bg-background text-foreground shadow-[inset_0_0_0_1px_var(--border)]",
        tag === "Fixed" && "bg-surface text-muted",
      )}
    >
      {tag}
    </span>
  );
}

// Each part of the version rolls on its own strip of every value that part
// ever takes, so 2.4.0 to 2.3.1 turns the minor wheel down and the patch
// wheel up, the way an odometer would.
function RollingVersion({
  version,
  versions,
  reduceMotion,
}: {
  version: string;
  versions: string[];
  reduceMotion: boolean;
}) {
  const parts = version.split(".");
  const columns = parts.map((_, i) =>
    [...new Set(versions.map((v) => Number(v.split(".")[i] ?? 0)))].sort(
      (a, b) => a - b,
    ),
  );
  return (
    <p className="flex items-center text-[28px] leading-none font-semibold tracking-tight tabular-nums">
      <span className="sr-only">{`Version ${version}`}</span>
      <span aria-hidden className="mr-0.5 text-muted">
        v
      </span>
      {parts.map((part, i) => (
        <span key={i} aria-hidden className="flex items-center">
          {i > 0 && <span className="text-muted">.</span>}
          <Strip
            values={columns[i]}
            at={columns[i].indexOf(Number(part))}
            reduceMotion={reduceMotion}
          />
        </span>
      ))}
    </p>
  );
}

function Strip({
  values,
  at,
  reduceMotion,
}: {
  values: number[];
  at: number;
  reduceMotion: boolean;
}) {
  const position = useSpring(at, { visualDuration: 0.4, bounce: 0.15 });
  useEffect(() => {
    if (reduceMotion) position.jump(at);
    else position.set(at);
  }, [at, reduceMotion, position]);
  const widest = Math.max(...values.map((v) => String(v).length));

  return (
    <span
      className="relative inline-block h-[1.2em] overflow-hidden [mask-image:linear-gradient(transparent,black_25%,black_75%,transparent)]"
      // Tabular digits in Geist run about 0.62em wide.
      style={{ width: `${widest * 0.62}em` }}
    >
      {values.map((value, i) => (
        <StripValue key={value} value={value} slot={i} position={position} />
      ))}
    </span>
  );
}

function StripValue({
  value,
  slot,
  position,
}: {
  value: number;
  slot: number;
  position: MotionValue<number>;
}) {
  // Higher values sit below, so moving to a newer release rolls upward.
  const transform = useTransform(
    position,
    (p) => `translateY(${(slot - p) * 100}%)`,
  );
  return (
    <motion.span
      className="absolute inset-0 flex items-center justify-center"
      style={{ transform }}
    >
      {value}
    </motion.span>
  );
}

function Timeline({
  releases,
  index,
  onSelect,
}: {
  releases: Release[];
  index: number;
  onSelect: (i: number) => void;
}) {
  const reduceMotion = useReducedMotion();
  const n = releases.length;
  // Oldest on the left so time runs the way it reads; the list is newest first.
  const order = releases.map((_, i) => n - 1 - i);
  const at = n - 1 - index;
  // Dots sit in the middle of equal columns, so the track runs from the
  // centre of the first column to the centre of the last.
  const inset = `${50 / n}%`;

  return (
    <div className="relative">
      <div
        aria-hidden
        className="absolute top-[17px] h-px bg-border"
        style={{ left: inset, right: inset }}
      />
      <motion.div
        aria-hidden
        className="absolute top-[17px] h-px origin-left bg-foreground"
        style={{ left: inset, right: inset }}
        initial={false}
        animate={{ scaleX: n > 1 ? at / (n - 1) : 0 }}
        transition={
          reduceMotion
            ? { duration: 0 }
            : { type: "spring", duration: 0.45, bounce: 0 }
        }
      />
      <ol
        className="relative grid"
        style={{ gridTemplateColumns: `repeat(${n}, 1fr)` }}
      >
        {order.map((i) => {
          const active = i === index;
          return (
            <li key={releases[i].version} className="flex justify-center">
              <button
                type="button"
                onClick={() => onSelect(i)}
                aria-current={active ? "true" : undefined}
                aria-label={`Version ${releases[i].version}, ${releases[i].date}`}
                className="group flex h-11 min-w-11 touch-manipulation flex-col items-center gap-2 rounded-lg px-1 pt-[13px] outline-hidden transition-[scale] duration-150 ease-out focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-foreground active:scale-[0.96]"
              >
                <span
                  className={cn(
                    "size-2.5 rounded-full shadow-[0_0_0_3px_var(--background)] transition-[background-color,scale] duration-200 ease-out",
                    active
                      ? "scale-125 bg-foreground"
                      : "bg-border group-hover:bg-muted",
                  )}
                />
                <span
                  className={cn(
                    "text-[12px] leading-none tabular-nums transition-colors duration-200 ease-out",
                    active ? "text-foreground" : "text-muted",
                  )}
                >
                  {releases[i].version}
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function NavButton({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
      className="flex size-10 touch-manipulation items-center justify-center rounded-full bg-surface text-foreground shadow-raised outline-hidden transition-[scale,opacity] duration-150 ease-out focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-foreground active:scale-[0.96] disabled:opacity-40 disabled:active:scale-100"
    >
      <svg
        viewBox="0 0 16 16"
        className="size-4"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        {children}
      </svg>
    </button>
  );
}

const RELEASES: Release[] = [
  {
    version: "2.4.0",
    date: "Sep 18, 2026",
    title: "Offline drafts",
    changes: [
      { tag: "New", text: "Drafts save locally and sync on reconnect" },
      { tag: "New", text: "Conflict view for edits from two devices" },
      { tag: "Improved", text: "Large documents open 40% faster" },
      { tag: "Fixed", text: "Pasted tables keep their column widths" },
    ],
  },
  {
    version: "2.3.1",
    date: "Aug 29, 2026",
    title: "Patch release",
    changes: [
      { tag: "Fixed", text: "Mentions no longer drop the last letter" },
      { tag: "Fixed", text: "Code blocks lost their borders in dark mode" },
      { tag: "Improved", text: "Clearer error when an embed fails" },
    ],
  },
  {
    version: "2.3.0",
    date: "Aug 12, 2026",
    title: "Shared templates",
    changes: [
      { tag: "New", text: "Publish a template to your workspace" },
      { tag: "New", text: "Template variables for dates and names" },
      { tag: "Improved", text: "Search ranks recent documents first" },
      { tag: "Fixed", text: "Exported PDFs respect page breaks" },
    ],
  },
  {
    version: "2.2.0",
    date: "Jul 21, 2026",
    title: "Comments, rebuilt",
    changes: [
      { tag: "New", text: "Resolve threads straight from email" },
      { tag: "Improved", text: "Comments follow text when it moves" },
      { tag: "Fixed", text: "Badge counted resolved threads" },
    ],
  },
  {
    version: "2.1.0",
    date: "Jun 30, 2026",
    title: "Keyboard first",
    changes: [
      { tag: "New", text: "Command menu on Cmd K everywhere" },
      { tag: "Improved", text: "Every toolbar action has a shortcut" },
      { tag: "Improved", text: "Focus returns where you left it" },
      { tag: "Fixed", text: "Tab order in the share dialog" },
    ],
  },
];

export default function ChangelogStackDemo() {
  return <ChangelogStack releases={RELEASES} />;
}
