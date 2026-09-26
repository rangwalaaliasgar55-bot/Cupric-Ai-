import { useEffect, useId, useRef, useState } from "react";
import {
  AnimatePresence,
  animate,
  motion,
  useMotionValue,
  useTransform,
  type AnimationPlaybackControls,
  type MotionValue,
  type ValueAnimationTransition,
} from "motion/react";
import { useReducedMotion } from "@/lib/use-reduced-motion";
import { cn } from "@/lib/cn";

export type Verdict = "approved" | "rejected";

type Impression = {
  id: number;
  verdict: Verdict;
  rotate: number;
  seed: number;
  x: number;
  y: number;
};

const EASE_OUT = [0.23, 1, 0.32, 1] as const;
// The press accelerates into the paper like a hand pushing down, so the
// moment of contact lands hard instead of drifting in.
const EASE_PRESS = [0.55, 0, 1, 0.45] as const;
// Hand stamps never land square; +-6deg reads as human without looking drunk.
const MAX_TILT = 6;
// Nor dead centre: a few px of drift per press.
const MAX_DRIFT = 4;
// Where the stamp hovers before it comes down, and where it lifts back to.
const HOVER_Y = -36;
const LIFT_Y = -48;

// Small deterministic PRNG, so one seed gives one tilt, drift and ink grain.
function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function rollImpression(id: number, verdict: Verdict): Impression {
  const seed = Math.floor(Math.random() * 10_000);
  const rand = mulberry32(seed);
  return {
    id,
    verdict,
    seed,
    rotate: (rand() * 2 - 1) * MAX_TILT,
    x: (rand() * 2 - 1) * MAX_DRIFT,
    y: (rand() * 2 - 1) * MAX_DRIFT,
  };
}

// Stamp-pad ink is a physical material: the classic blue-violet office pad
// for approvals, and the danger red (which is red ink anyway) for
// rejections. The blue lifts in the dark theme to stay readable.
const INK: Record<Verdict, string> = {
  approved: "light-dark(oklch(0.45 0.16 268), oklch(0.7 0.13 268))",
  rejected: "var(--danger)",
};
// The stamp's wooden handle and mount, and the brass ring between them.
const WOOD_LIGHT = "oklch(0.74 0.085 68)";
const WOOD = "oklch(0.62 0.095 58)";
const WOOD_DARK = "oklch(0.5 0.09 50)";
const BRASS = "oklch(0.8 0.11 85)";

const LABEL: Record<Verdict, string> = {
  approved: "Approved",
  rejected: "Rejected",
};

export function RubberStamp({
  children,
  title,
  onChange,
  className,
}: {
  children: React.ReactNode;
  // Names the document for screen readers, e.g. "Expense request EXP-2041".
  title: string;
  onChange?: (value: Verdict | null) => void;
  className?: string;
}) {
  const reduceMotion = useReducedMotion();
  const [impression, setImpression] = useState<Impression | null>(null);
  const [ink, setInk] = useState<Verdict>("approved");
  const presses = useRef(0);
  const run = useRef(0);
  const running = useRef<AnimationPlaybackControls[]>([]);

  const toolY = useMotionValue(LIFT_Y);
  const toolOpacity = useMotionValue(0);
  const toolRotate = useMotionValue(0);
  const squashX = useMotionValue(1);
  const squashY = useMotionValue(1);
  const pageY = useMotionValue(0);
  // 0 when the stamp is at its highest, 1 on the paper.
  const near = useTransform(
    () => toolOpacity.get() * (1 - Math.min(1, -toolY.get() / -LIFT_Y)),
  );
  const shadowOpacity = useTransform(near, (n) => n * 0.28);
  const shadowScale = useTransform(near, (n) => 1.15 - n * 0.15);

  useEffect(() => {
    const list = running.current;
    return () => list.forEach((c) => c.stop());
  }, []);

  const verdict = impression?.verdict ?? null;

  const go = (
    mv: MotionValue<number>,
    to: number | number[],
    transition: ValueAnimationTransition<number>,
  ) => {
    const c = animate(mv, to, transition);
    running.current.push(c);
    return c;
  };

  const stopAll = () => {
    running.current.forEach((c) => c.stop());
    running.current.length = 0;
  };

  // The whole press runs about 0.6s. It is a staged physical sequence (lift,
  // press, squash, lift) where no single move is over 200ms, and pressing
  // again at any point restarts it from wherever the stamp is.
  const stamp = async (next: Verdict) => {
    const id = ++run.current;
    stopAll();
    const mark = rollImpression(++presses.current, next);

    if (reduceMotion) {
      toolOpacity.jump(0);
      setImpression(mark);
      onChange?.(next);
      return;
    }

    setInk(next);
    toolRotate.jump(mark.rotate);
    squashX.jump(1);
    squashY.jump(1);
    // A press mid-lift carries on from wherever the stamp is.
    if (toolOpacity.get() === 0) toolY.jump(LIFT_Y);

    // Lifted over the page.
    await Promise.all([
      go(toolY, HOVER_Y, { duration: 0.14, ease: EASE_OUT }),
      go(toolOpacity, 1, { duration: 0.1, ease: EASE_OUT }),
    ]);
    if (id !== run.current) return;

    // Down.
    await go(toolY, 0, { duration: 0.09, ease: EASE_PRESS });
    if (id !== run.current) return;

    // Contact: the ink lands, the rubber squashes a touch and the page gives
    // by 1.5px. Kept within 0.95 to 1.03 so it reads as weight, not cartoon.
    setImpression(mark);
    onChange?.(next);
    navigator.vibrate?.(8);
    go(squashY, [1, 0.95, 1], { duration: 0.16, ease: EASE_OUT });
    go(squashX, [1, 1.03, 1], { duration: 0.16, ease: EASE_OUT });
    go(pageY, [0, 1.5, 0], { duration: 0.18, ease: EASE_OUT });

    // Held a beat on the paper, then lifted away. The fade trails the lift
    // so you see it leave rather than vanish in place.
    go(toolY, LIFT_Y, { duration: 0.2, delay: 0.08, ease: EASE_OUT });
    go(toolOpacity, 0, { duration: 0.16, delay: 0.14, ease: EASE_OUT });
  };

  const undo = () => {
    if (!impression) return;
    run.current++;
    stopAll();
    go(toolOpacity, 0, { duration: 0.12, ease: EASE_OUT });
    setImpression(null);
    onChange?.(null);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
    const key = e.key.toLowerCase();
    if (key === "a") stamp("approved");
    else if (key === "r") stamp("rejected");
    else if (key === "u") undo();
    else return;
    e.preventDefault();
  };

  return (
    <div
      className={cn(
        "flex w-[min(440px,100%)] flex-col items-center gap-6",
        className,
      )}
      onKeyDown={onKeyDown}
    >
      <motion.article
        tabIndex={0}
        aria-label={`${title}, ${verdict ? LABEL[verdict].toLowerCase() : "pending"}`}
        aria-description="Press A to approve, R to reject, U to undo."
        aria-keyshortcuts="A R U"
        style={{ y: pageY }}
        className="relative w-full rounded-2xl bg-background p-6 shadow-raised outline-hidden focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-4 focus-visible:outline-foreground"
      >
        {children}

        <div
          aria-hidden
          className="pointer-events-none absolute right-6 bottom-5 h-14 w-[168px]"
        >
          {/* The box a form leaves for the stamp. It stays under the ink,
              the way a printed box does on paper. */}
          <div className="absolute inset-0 flex items-center justify-center rounded-lg border border-dashed border-foreground/15">
            {/* Fades under a fresh impression so the two words never
                compete; the box itself stays, like print on paper. */}
            <span
              className={cn(
                "text-[12px] font-medium tracking-[0.14em] text-muted/70 uppercase transition-[opacity] duration-200 ease-out",
                impression && "opacity-0",
              )}
            >
              Office use
            </span>
          </div>

          <AnimatePresence initial={false}>
            {impression && (
              <Ink
                key={impression.id}
                mark={impression}
                reduce={!!reduceMotion}
              />
            )}
          </AnimatePresence>

          {/* The stamp's shadow on the page, tightening and darkening as it
              comes down: the cue that says "this is about to land". */}
          <motion.span
            className="absolute inset-x-2 -bottom-1 h-5 rounded-[50%] bg-black blur-[6px]"
            style={{ opacity: shadowOpacity, scaleX: shadowScale }}
          />

          <motion.div
            style={{
              y: toolY,
              opacity: toolOpacity,
              rotate: toolRotate,
              scaleX: squashX,
              scaleY: squashY,
            }}
            // Squashes from the rubber face, not the middle of the handle.
            className="absolute bottom-0 -left-1 w-[176px] origin-bottom"
          >
            <StampTool ink={ink} />
          </motion.div>
        </div>
      </motion.article>

      <div className="flex flex-wrap justify-center gap-2">
        <StampButton
          shortcut="A"
          onClick={() => stamp("approved")}
          active={verdict === "approved"}
        >
          Approve
        </StampButton>
        <StampButton
          shortcut="R"
          onClick={() => stamp("rejected")}
          active={verdict === "rejected"}
        >
          Reject
        </StampButton>
        <StampButton shortcut="U" onClick={undo} disabled={!impression}>
          Undo
        </StampButton>
      </div>

      <span className="sr-only" aria-live="polite">
        {verdict ? `${title} ${LABEL[verdict].toLowerCase()}` : ""}
      </span>
    </div>
  );
}

function Ink({ mark, reduce }: { mark: Impression; reduce: boolean }) {
  const filter = `ink-${useId().replace(/[^a-zA-Z0-9-]/g, "")}`;
  return (
    <motion.svg
      viewBox="0 0 168 56"
      className={cn(
        "absolute inset-0 size-full overflow-visible",
        // Ink soaks into the paper: it darkens what is under it in light mode
        // and brightens it in dark mode, so the printed total shows through.
        "mix-blend-multiply dark:mix-blend-screen",
      )}
      style={{ x: mark.x, rotate: mark.rotate, color: INK[mark.verdict] }}
      initial={reduce ? { opacity: 0, y: mark.y } : { opacity: 0, y: mark.y, scale: 1.02 }}
      animate={{ opacity: 0.9, y: mark.y, scale: 1 }}
      // Lifts off softer and quicker than it went down.
      exit={
        reduce
          ? { opacity: 0, transition: { duration: 0.15 } }
          : {
              opacity: 0,
              y: mark.y - 8,
              scale: 1.02,
              transition: { duration: 0.18, ease: EASE_OUT },
            }
      }
      transition={{ duration: 0.1, ease: EASE_OUT }}
    >
      <defs>
        <filter
          id={filter}
          x="-4%"
          y="-10%"
          width="108%"
          height="120%"
          colorInterpolationFilters="sRGB"
        >
          {/* Fine grain: speckled dropouts where the rubber missed. */}
          <feTurbulence
            type="fractalNoise"
            baseFrequency="0.9"
            numOctaves={2}
            seed={mark.seed}
            result="grain"
          />
          <feColorMatrix
            in="grain"
            type="matrix"
            values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  -5 0 0 0 3.3"
            result="speckle"
          />
          {/* Broad pressure: one side of a hand stamp always inks heavier. */}
          <feTurbulence
            type="fractalNoise"
            baseFrequency="0.02"
            numOctaves={1}
            seed={mark.seed + 1}
            result="pressure"
          />
          <feColorMatrix
            in="pressure"
            type="matrix"
            values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  1.4 0 0 0 0.25"
            result="density"
          />
          <feComposite in="SourceGraphic" in2="speckle" operator="in" result="grained" />
          <feComposite in="grained" in2="density" operator="in" result="inked" />
          {/* Rough edges: rubber and paper fibre wobble the outline. */}
          <feTurbulence
            type="fractalNoise"
            baseFrequency="0.05"
            numOctaves={2}
            seed={mark.seed + 2}
            result="wobble"
          />
          <feDisplacementMap
            in="inked"
            in2="wobble"
            scale={2.5}
            xChannelSelector="R"
            yChannelSelector="G"
          />
        </filter>
      </defs>
      <g filter={`url(#${filter})`} fill="none" stroke="currentColor">
        <rect x="2" y="2" width="164" height="52" rx="7" strokeWidth={3.5} />
        <rect
          x="7.5"
          y="7.5"
          width="153"
          height="41"
          rx="3.5"
          strokeWidth={1.25}
        />
        <text
          x="84"
          y="29"
          textAnchor="middle"
          dominantBaseline="central"
          fill="currentColor"
          stroke="none"
          fontSize="22"
          fontWeight={800}
          letterSpacing="3.5"
        >
          {LABEL[mark.verdict].toUpperCase()}
        </text>
      </g>
    </motion.svg>
  );
}

// A front view of a desk stamp: a turned wooden knob and neck, a brass
// ferrule, the wooden mount with its index label, the foam cushion and the
// inked rubber die.
function StampTool({ ink }: { ink: Verdict }) {
  const id = useId().replace(/[^a-zA-Z0-9-]/g, "");
  return (
    <svg viewBox="0 0 176 132" className="w-full overflow-visible" aria-hidden>
      <defs>
        {/* Light from the top left, as on the rest of the page. */}
        <radialGradient id={`${id}-knob`} cx="0.36" cy="0.3" r="0.75">
          <stop offset="0" stopColor={WOOD_LIGHT} />
          <stop offset="0.55" stopColor={WOOD} />
          <stop offset="1" stopColor={WOOD_DARK} />
        </radialGradient>
        <linearGradient id={`${id}-turned`} x1="0" x2="1" y1="0" y2="0">
          <stop offset="0" stopColor={WOOD_DARK} />
          <stop offset="0.35" stopColor={WOOD_LIGHT} />
          <stop offset="1" stopColor={WOOD_DARK} />
        </linearGradient>
        <linearGradient id={`${id}-block`} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor={WOOD_LIGHT} />
          <stop offset="1" stopColor={WOOD} />
        </linearGradient>
      </defs>
      {/* Knob and neck. */}
      <path d="M80 36C80 44 82 48 82 58H94C94 48 96 44 96 36Z" fill={`url(#${id}-turned)`} />
      <ellipse cx="88" cy="22" rx="23" ry="19" fill={`url(#${id}-knob)`} />
      <ellipse cx="80" cy="13" rx="8" ry="4" fill="oklch(1 0 0 / 0.35)" />
      {/* Brass ferrule. */}
      <rect x="76" y="56" width="24" height="10" rx="2.5" fill={BRASS} />
      <rect x="76" y="58" width="24" height="2" fill="oklch(1 0 0 / 0.4)" />
      {/* The mount, with a little end grain and a lighter top edge. */}
      <rect x="6" y="66" width="164" height="42" rx="6" fill={`url(#${id}-block)`} />
      <path
        d="M16 76C50 73 70 79 104 76S150 74 160 77M14 98C48 95 80 101 120 97S152 96 162 99"
        fill="none"
        stroke={WOOD_DARK}
        strokeOpacity={0.35}
        strokeWidth={1}
      />
      <rect x="6" y="66" width="164" height="2.5" rx="1.25" fill="oklch(1 0 0 / 0.35)" />
      {/* The index label, printed with what the die says. */}
      <rect x="52" y="78" width="72" height="18" rx="2" fill="oklch(0.97 0.01 90)" />
      <text
        x="88"
        y="87.5"
        textAnchor="middle"
        dominantBaseline="central"
        fontSize="9"
        fontWeight={800}
        letterSpacing="1.5"
        style={{ fill: INK[ink] }}
      >
        {LABEL[ink].toUpperCase()}
      </text>
      {/* Foam cushion and the rubber die, wet with ink. */}
      <rect x="9" y="108" width="158" height="6" fill="oklch(0.3 0.01 60)" />
      <rect x="10" y="114" width="156" height="18" rx="2.5" style={{ fill: INK[ink] }} />
      <rect x="12" y="115" width="152" height="2" rx="1" fill="oklch(1 0 0 / 0.25)" />
    </svg>
  );
}

function StampButton({
  shortcut,
  active,
  disabled,
  onClick,
  children,
}: {
  shortcut: string;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-keyshortcuts={shortcut}
      aria-pressed={disabled ? undefined : !!active}
      className="flex h-10 touch-manipulation items-center gap-2.5 rounded-full bg-surface pr-2.5 pl-4 text-sm font-medium text-foreground shadow-raised outline-hidden transition-[scale,opacity] duration-150 ease-out select-none focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-foreground active:scale-[0.96] disabled:opacity-50 disabled:active:scale-100 motion-reduce:transition-[opacity]"
    >
      {children}
      {/* A 20px chip 10px in from the pill's edge: 10 + 10 = 20 radius, so
          a 5px corner keeps it reading as a key rather than a pill. */}
      <kbd
        className={cn(
          "flex size-5 items-center justify-center rounded-[5px] bg-background font-sans text-xs text-muted shadow-[0_0_0_1px_var(--border)] transition-[color] duration-150 ease-out",
          active && "text-foreground",
        )}
      >
        {shortcut}
      </kbd>
    </button>
  );
}

const ITEMS = [
  { label: "Flights, BOM to GOI", amount: "$486.00" },
  { label: "Hotel, 2 nights", amount: "$412.00" },
  { label: "Team dinner", amount: "$96.40" },
];

export default function RubberStampDemo() {
  const [verdict, setVerdict] = useState<Verdict | null>(null);
  return (
    <RubberStamp title="Expense request EXP-2041" onChange={setVerdict}>
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="font-mono text-xs text-muted">EXP-2041</p>
          <h3 className="mt-1 text-lg font-medium tracking-tight text-foreground">
            Design offsite, Goa
          </h3>
          <p className="mt-0.5 text-sm text-muted">Priya Shah, Product design</p>
        </div>
        <span
          className={cn(
            "shrink-0 rounded-full bg-surface px-2.5 py-1 text-xs font-medium transition-[color] duration-150 ease-out",
            verdict === "rejected"
              ? "text-danger"
              : verdict === "approved"
                ? "text-foreground"
                : "text-muted",
          )}
        >
          {verdict ? LABEL[verdict] : "Pending"}
        </span>
      </div>
      <dl className="mt-5 space-y-2 text-sm">
        {ITEMS.map((item) => (
          <div key={item.label} className="flex justify-between gap-4">
            <dt className="text-muted">{item.label}</dt>
            <dd className="text-foreground tabular-nums">{item.amount}</dd>
          </div>
        ))}
      </dl>
      {/* The bottom padding is the stamp's landing zone, so the impression
          overlaps the total the way a real one would without hiding it. */}
      <div className="mt-4 flex items-baseline justify-between border-t border-border pt-4 pb-14">
        <span className="text-sm text-muted">Total</span>
        <span className="text-xl font-medium tracking-tight text-foreground tabular-nums">
          $994.40
        </span>
      </div>
    </RubberStamp>
  );
}
