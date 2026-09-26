import { useEffect, useId, useRef, useState } from "react";
import {
  animate,
  motion,
  useMotionTemplate,
  useMotionValue,
  useSpring,
} from "motion/react";
import { useReducedMotion } from "@/lib/use-reduced-motion";
import { cn } from "@/lib/cn";

// Resting lens, the slightly larger one while hovering, and the big one a
// click toggles. Entering grows 56 to 72 rather than from nothing, so the
// lens arrives like a material, not a point.
const R_ENTER = 56;
const R_HOVER = 72;
const R_BIG = 118;
// Trails the pointer by a hair: enough to feel like a physical lens with
// weight, never enough to feel laggy. Critically damped, it never overshoots
// the thing it is following.
const FOLLOW = { stiffness: 520, damping: 46 };
const GROW = { type: "spring", visualDuration: 0.3, bounce: 0 } as const;
const SHRINK = { type: "spring", visualDuration: 0.2, bounce: 0 } as const;
// Leaves faster than it arrives: the exit should never hold the eye.
const FADE_IN = { duration: 0.18, ease: [0.23, 1, 0.32, 1] } as const;
const FADE_OUT = { duration: 0.12, ease: [0.23, 1, 0.32, 1] } as const;
// Arrow keys move the lens this far; Shift moves it further.
const KEY_STEP = 24;
const KEY_STEP_FAR = 72;

export function LensReveal({
  base,
  hidden,
  label,
  description,
  className,
}: {
  base: React.ReactNode;
  hidden: React.ReactNode;
  label: string;
  // Spoken to screen readers, since the hidden layer can't be seen by them.
  description: string;
  className?: string;
}) {
  const reduce = useReducedMotion() ?? false;
  const hintId = useId();
  const ref = useRef<HTMLDivElement>(null);
  // Where the lens should be; the springs below chase it.
  const aimX = useMotionValue(0);
  const aimY = useMotionValue(0);
  const x = useSpring(aimX, FOLLOW);
  const y = useSpring(aimY, FOLLOW);
  const radius = useMotionValue(R_ENTER);
  const shown = useMotionValue(0);
  const [big, setBig] = useState(false);
  const bigRef = useRef(false);
  const inside = useRef(false);
  const touch = useRef<number | null>(null);
  // Where the press started, so a drag that ends on the surface isn't also
  // read as a click that resizes the lens.
  const press = useRef<[number, number] | null>(null);

  const clip = useMotionTemplate`circle(${radius}px at ${x}px ${y}px)`;

  useEffect(
    () => () => {
      radius.stop();
      shown.stop();
    },
    [radius, shown],
  );

  const restRadius = () => (bigRef.current ? R_BIG : R_HOVER);

  const moveTo = (px: number, py: number, instant: boolean) => {
    aimX.set(px);
    aimY.set(py);
    // Jumping on entry keeps the lens from sweeping in from its last spot.
    if (instant || reduce) {
      x.jump(px);
      y.jump(py);
    }
  };

  const show = () => {
    if (inside.current) return;
    inside.current = true;
    if (reduce) {
      radius.jump(restRadius());
    } else {
      radius.jump(R_ENTER);
      animate(radius, restRadius(), GROW);
    }
    animate(shown, 1, FADE_IN);
  };

  const hide = () => {
    if (!inside.current) return;
    inside.current = false;
    if (!reduce) animate(radius, R_ENTER, SHRINK);
    animate(shown, 0, FADE_OUT);
  };

  const toggleBig = () => {
    bigRef.current = !bigRef.current;
    setBig(bigRef.current);
    if (!inside.current) return;
    if (reduce) radius.jump(restRadius());
    else animate(radius, restRadius(), bigRef.current ? GROW : SHRINK);
  };

  const local = (e: React.PointerEvent) => {
    const box = ref.current!.getBoundingClientRect();
    return [e.clientX - box.left, e.clientY - box.top] as const;
  };

  return (
    <div
      ref={ref}
      role="group"
      aria-roledescription="lens"
      aria-label={label}
      aria-describedby={hintId}
      tabIndex={0}
      className={cn(
        // touch-none: a finger on the surface steers the lens, so the page
        // shouldn't scroll out from under it.
        "relative h-[300px] w-[min(480px,100%)] touch-none overflow-hidden rounded-2xl shadow-raised outline-hidden select-none focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-foreground",
        className,
      )}
      onPointerEnter={(e) => {
        if (e.pointerType === "touch") return;
        const [px, py] = local(e);
        moveTo(px, py, true);
        show();
      }}
      onPointerMove={(e) => {
        if (e.pointerType === "touch" && touch.current !== e.pointerId) return;
        const [px, py] = local(e);
        moveTo(px, py, false);
        show();
      }}
      onPointerLeave={(e) => {
        if (e.pointerType !== "touch") hide();
      }}
      onPointerDown={(e) => {
        press.current = [e.clientX, e.clientY];
        if (e.pointerType !== "touch" || touch.current !== null) return;
        touch.current = e.pointerId;
        e.currentTarget.setPointerCapture(e.pointerId);
        const [px, py] = local(e);
        moveTo(px, py, true);
        show();
      }}
      onPointerUp={(e) => {
        if (touch.current === e.pointerId) touch.current = null;
      }}
      onPointerCancel={(e) => {
        if (touch.current !== e.pointerId) return;
        touch.current = null;
        hide();
      }}
      onClick={(e) => {
        const p = press.current;
        press.current = null;
        // Past 6px the finger was steering the lens, not tapping it.
        if (p && Math.hypot(e.clientX - p[0], e.clientY - p[1]) > 6) return;
        toggleBig();
      }}
      onFocus={(e) => {
        // Keyboard arrival: open the lens in the middle so arrows have
        // something to move. Mouse focus already has one under the pointer.
        if (inside.current || !e.currentTarget.matches(":focus-visible")) return;
        const box = e.currentTarget.getBoundingClientRect();
        moveTo(box.width / 2, box.height / 2, true);
        show();
      }}
      onBlur={() => {
        if (touch.current === null) hide();
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          if (!inside.current) show();
          toggleBig();
          return;
        }
        if (e.key === "Escape") {
          hide();
          return;
        }
        const delta = {
          ArrowLeft: [-1, 0],
          ArrowRight: [1, 0],
          ArrowUp: [0, -1],
          ArrowDown: [0, 1],
        }[e.key];
        if (!delta) return;
        e.preventDefault();
        const box = e.currentTarget.getBoundingClientRect();
        const step = e.shiftKey ? KEY_STEP_FAR : KEY_STEP;
        // Starts from the aim, not the trailing spring, so held keys glide
        // at a steady pace instead of stalling behind the lens.
        const px = Math.min(Math.max(aimX.get() + delta[0] * step, 0), box.width);
        const py = Math.min(Math.max(aimY.get() + delta[1] * step, 0), box.height);
        moveTo(px, py, false);
        show();
      }}
    >
      <div className="absolute inset-0">{base}</div>
      <motion.div
        aria-hidden
        className="absolute inset-0"
        style={{ clipPath: clip, opacity: shown }}
      >
        {hidden}
      </motion.div>
      {/* The rim sells it as glass sitting over the page, not a hole cut in
          it. Drawn in SVG so its stroke stays 1px at every radius. */}
      <motion.svg
        aria-hidden
        className="pointer-events-none absolute inset-0 size-full overflow-visible text-foreground"
        style={{ opacity: shown }}
      >
        <motion.circle
          cx={x}
          cy={y}
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeOpacity={0.18}
          strokeWidth={1}
        />
      </motion.svg>
      <span id={hintId} className="sr-only">
        {description} Arrow keys move the lens, Enter makes it larger.
      </span>
      <span className="sr-only" aria-live="polite">
        {big ? "Large lens" : ""}
      </span>
    </div>
  );
}

// The same card drawn twice. The annotated copy only adds absolutely
// positioned marks on top, so both layers line up to the pixel.
function Specimen({ annotated = false }: { annotated?: boolean }) {
  return (
    <div
      className={cn(
        "flex size-full items-center justify-center p-6",
        annotated ? "bg-foreground text-background" : "bg-surface text-foreground",
      )}
    >
      <div
        className={cn(
          "relative w-[min(300px,100%)] rounded-2xl p-5",
          annotated
            ? "outline outline-1 -outline-offset-1 outline-background/40 outline-dashed"
            : "bg-background shadow-raised",
        )}
      >
        {annotated && (
          <>
            <Spec className="-top-5 left-0">radius 16 / padding 20</Spec>
            {/* Padding bands, shaded where the content can't go. */}
            <span className="absolute inset-x-0 top-0 h-5 rounded-t-2xl bg-background/10" />
            <span className="absolute inset-x-0 bottom-0 h-5 rounded-b-2xl bg-background/10" />
            <span className="absolute inset-y-5 left-0 w-5 bg-background/10" />
            <span className="absolute inset-y-5 right-0 w-5 bg-background/10" />
          </>
        )}
        <div className="relative flex items-center gap-3">
          <span
            className={cn(
              "relative size-9 shrink-0 rounded-full",
              annotated
                ? "outline outline-1 -outline-offset-1 outline-background/50 outline-dashed"
                : "bg-foreground/10",
            )}
          >
            {annotated && <Spec className="top-full left-0 mt-1">36</Spec>}
          </span>
          <span className="relative">
            <span className="block text-sm font-medium">Ada Sørensen</span>
            <span
              className={cn(
                "block text-xs",
                annotated ? "text-background/60" : "text-muted",
              )}
            >
              2 min read
            </span>
            {annotated && <Spec className="top-0 left-full ml-3">gap 12</Spec>}
          </span>
        </div>
        <p className="relative mt-4 text-lg leading-snug font-semibold tracking-tight text-balance">
          Springs are behaviour, not a timeline.
          {annotated && <Mark>18 / 1.375 / 600</Mark>}
        </p>
        <p
          className={cn(
            "relative mt-1.5 text-sm leading-normal text-pretty",
            annotated ? "text-background/70" : "text-muted",
          )}
        >
          A target that moves mid-flight bends the path instead of restarting
          it.
          {annotated && <Mark below>14 / 1.5 / 400</Mark>}
        </p>
      </div>
    </div>
  );
}

function Spec({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <span
      className={cn(
        "absolute font-mono text-xs whitespace-nowrap text-background/70",
        className,
      )}
    >
      {children}
    </span>
  );
}

// Outlines the text block and tags its type spec on the edge facing open
// space, so the tag never covers a neighbouring line.
function Mark({
  below = false,
  children,
}: {
  below?: boolean;
  children: React.ReactNode;
}) {
  return (
    <span className="absolute -inset-1 rounded-md outline outline-1 outline-background/40 outline-dashed">
      <span
        className={cn(
          "absolute right-1 bg-foreground px-1 font-mono text-xs leading-4 font-normal tracking-normal text-background/70",
          below ? "top-full -translate-y-1/2" : "top-0 -translate-y-1/2",
        )}
      >
        {children}
      </span>
    </span>
  );
}

export default function LensRevealDemo() {
  return (
    <LensReveal
      label="Card specimen"
      description="Under the lens, the card shows its specs: 16px radius, 20px padding, a 36px avatar, 18px semibold title and 14px body."
      base={<Specimen />}
      hidden={<Specimen annotated />}
    />
  );
}
