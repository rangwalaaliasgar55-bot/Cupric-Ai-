import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  AnimatePresence,
  motion,
  useMotionValue,
  useSpring,
  useTransform,
  useVelocity,
} from "motion/react";
import { useReducedMotion } from "@/lib/use-reduced-motion";
import { cn } from "@/lib/cn";
import { usePreviewPlay } from "@/lab/preview-play";

const CARD_W = 232;
const GAP = 10;
const GUTTER = 8;
const EASE_OUT = [0.23, 1, 0.32, 1] as const;
// Loose enough that the card visibly trails the cursor, tight enough that
// it never feels like it is swimming.
const FOLLOW = { stiffness: 260, damping: 26, mass: 0.6 } as const;
// A card dragged sideways leans into the motion; 7deg at a brisk flick is
// noticeable without looking like it will fall off.
const MAX_TILT = 7;
const TILT_AT_SPEED = 1400;
// Holds the card up after a touch press ends, so it can actually be read.
const TOUCH_LINGER = 1400;

type Mode = "cursor" | "anchored";

export function HoverPreviewLink({
  href,
  title,
  domain,
  image,
  children,
  simulate,
  className,
}: {
  /** Acts out a pointer without one, for demos: x is where it sits across
   * the link (0 to 1), below puts the card under the text. null: gone. */
  simulate?: { x: number; below?: boolean } | null;
  href: string;
  title: string;
  domain: string;
  image: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const reduceMotion = useReducedMotion();
  const wrap = useRef<HTMLSpanElement>(null);
  const [open, setOpen] = useState<Mode | null>(null);
  const [below, setBelow] = useState(false);
  const linger = useRef<ReturnType<typeof setTimeout>>(undefined);

  // x is the card's left edge relative to the link, raw from the pointer;
  // the spring gives it lag and its velocity drives the lean.
  const targetX = useMotionValue(0);
  const x = useSpring(targetX, FOLLOW);
  const speed = useVelocity(x);
  const tilt = useSpring(
    useTransform(speed, [-TILT_AT_SPEED, TILT_AT_SPEED], [MAX_TILT, -MAX_TILT], {
      clamp: true,
    }),
    { stiffness: 400, damping: 30 },
  );

  useEffect(() => () => clearTimeout(linger.current), []);

  // Screen pixels per layout pixel: not 1 when an ancestor is scaled (a
  // zoomed-out preview), and x is in layout pixels.
  const scaleOf = (el: HTMLElement, r: DOMRect) =>
    el.offsetWidth ? r.width / el.offsetWidth : 1;

  // Keeps the card inside the viewport so it can't widen a phone page.
  const clampLeft = (left: number) => {
    const el = wrap.current;
    if (!el) return left;
    const r = el.getBoundingClientRect();
    const s = scaleOf(el, r);
    const vw = document.documentElement.clientWidth;
    const min = (GUTTER - r.left) / s;
    const max = (vw - GUTTER - r.left) / s - CARD_W;
    return Math.round(Math.min(Math.max(left, min), Math.max(min, max)));
  };

  const place = (mode: Mode, clientX?: number) => {
    const el = wrap.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const centre =
      mode === "cursor" && clientX !== undefined
        ? (clientX - r.left) / scaleOf(el, r)
        : el.offsetWidth / 2;
    return clampLeft(centre - CARD_W / 2);
  };

  const show = (mode: Mode, clientX?: number) => {
    const el = wrap.current;
    const left = place(mode, clientX);
    if (!el || left === undefined) return;
    clearTimeout(linger.current);
    // Flip below when there isn't room above in the viewport.
    setBelow(el.getBoundingClientRect().top < 200);
    if (!open) {
      // Appears where the pointer is, rather than sliding in from the last spot.
      targetX.jump(left);
      x.jump(left);
      tilt.jump(0);
    } else {
      targetX.set(left);
    }
    setOpen(mode);
  };

  const hide = () => {
    clearTimeout(linger.current);
    setOpen(null);
  };

  // A simulated pointer: the card appears where it lands and then trails it
  // through the same spring, so the lean is the real one.
  const simX = simulate?.x;
  const simBelow = simulate?.below ?? false;
  const simOpen = useRef(false);
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    if (simX === undefined) {
      if (simOpen.current) setOpen(null);
      simOpen.current = false;
      return;
    }
    const left = clampLeft(simX * el.offsetWidth - CARD_W / 2);
    if (!simOpen.current) {
      targetX.jump(left);
      x.jump(left);
      tilt.jump(0);
      setBelow(simBelow);
      setOpen("cursor");
      simOpen.current = true;
    } else {
      targetX.set(left);
    }
    // Only a new simulated position should move the card.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [simX, simBelow]);

  return (
    <span ref={wrap} className="relative inline-block">
      <a
        href={href}
        target="_blank"
        rel="noreferrer"
        onPointerEnter={(e) => {
          if (e.pointerType !== "touch") show("cursor", e.clientX);
        }}
        onPointerMove={(e) => {
          if (e.pointerType === "touch" || !open) return;
          if (reduceMotion) return;
          targetX.set(place("cursor", e.clientX) ?? 0);
        }}
        onPointerLeave={(e) => {
          if (e.pointerType !== "touch") hide();
        }}
        onPointerDown={(e) => {
          if (e.pointerType === "touch") show("anchored");
        }}
        onPointerUp={(e) => {
          if (e.pointerType !== "touch") return;
          clearTimeout(linger.current);
          linger.current = setTimeout(hide, TOUCH_LINGER);
        }}
        onPointerCancel={hide}
        onFocus={(e) => {
          if (e.currentTarget.matches(":focus-visible")) show("anchored");
        }}
        onBlur={hide}
        onKeyDown={(e) => {
          if (e.key === "Escape") hide();
        }}
        className={cn(
          "rounded-[2px] font-medium text-foreground underline decoration-border decoration-1 underline-offset-4 outline-hidden transition-[text-decoration-color] duration-150 ease-out hover:decoration-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-solid focus-visible:outline-foreground",
          className,
        )}
      >
        {children}
      </a>

      <AnimatePresence>
        {open ? (
          <motion.span
            aria-hidden
            className={cn(
              "pointer-events-none absolute left-0 z-20 block",
              below ? "top-full" : "bottom-full",
            )}
            style={{
              x,
              rotate: reduceMotion ? 0 : tilt,
              width: CARD_W,
              paddingTop: below ? GAP : 0,
              paddingBottom: below ? 0 : GAP,
              // Pivots at the edge nearest the link, like it is held there.
              transformOrigin: below ? "50% 0%" : "50% 100%",
            }}
          >
            <motion.span
              className="block overflow-hidden rounded-xl bg-background p-1 shadow-raised"
              style={{ transformOrigin: below ? "50% 0%" : "50% 100%" }}
              initial={
                reduceMotion
                  ? { opacity: 0 }
                  : { opacity: 0, scale: 0.88, y: below ? -6 : 6, filter: "blur(4px)" }
              }
              animate={{
                opacity: 1,
                scale: 1,
                y: 0,
                filter: "blur(0px)",
                transition: { duration: 0.18, ease: EASE_OUT },
              }}
              exit={{
                opacity: 0,
                scale: reduceMotion ? 1 : 0.96,
                filter: reduceMotion ? "blur(0px)" : "blur(2px)",
                transition: { duration: 0.12, ease: EASE_OUT },
              }}
            >
              {/* Concentric: 12px card = 8px image + 4px padding. */}
              <span className="block h-[104px] overflow-hidden rounded-lg bg-surface outline outline-1 -outline-offset-1 outline-[light-dark(oklch(0_0_0/0.1),oklch(1_0_0/0.1))]">
                {image}
              </span>
              <span className="block px-2 pt-2 pb-1.5">
                <span className="block truncate text-[13px] font-medium text-foreground">
                  {title}
                </span>
                <span className="block truncate text-xs text-muted">{domain}</span>
              </span>
            </motion.span>
          </motion.span>
        ) : null}
      </AnimatePresence>
    </span>
  );
}

// Thumbnails drawn from tokens so they sit right in both themes.
function ArticleThumb() {
  return (
    <svg viewBox="0 0 224 104" className="size-full" aria-hidden>
      <rect x="20" y="22" width="92" height="9" rx="2" className="fill-foreground/80" />
      <rect x="20" y="38" width="64" height="9" rx="2" className="fill-foreground/80" />
      <rect x="20" y="60" width="104" height="4" rx="2" className="fill-muted/50" />
      <rect x="20" y="70" width="96" height="4" rx="2" className="fill-muted/50" />
      <rect x="20" y="80" width="72" height="4" rx="2" className="fill-muted/50" />
      <circle cx="170" cy="52" r="30" className="fill-background" />
      <path
        d="M146 62c10-2 16-14 26-14s14 10 22 10"
        fill="none"
        strokeWidth="2"
        strokeLinecap="round"
        className="stroke-foreground"
      />
      <circle cx="172" cy="48" r="3" className="fill-foreground" />
    </svg>
  );
}

function RepoThumb() {
  const rows = [
    [20, 40, 30],
    [32, 56, 0],
    [32, 28, 44],
    [44, 64, 0],
    [32, 36, 0],
    [20, 16, 0],
  ];
  return (
    <svg viewBox="0 0 224 104" className="size-full" aria-hidden>
      <rect x="12" y="12" width="200" height="80" rx="6" className="fill-background" />
      <circle cx="24" cy="23" r="2.5" className="fill-border" />
      <circle cx="32" cy="23" r="2.5" className="fill-border" />
      <circle cx="40" cy="23" r="2.5" className="fill-border" />
      {rows.map(([indent, a, b], i) => (
        <g key={i}>
          <rect x={indent} y={36 + i * 9} width={a} height="4" rx="2" className="fill-foreground/70" />
          {b ? (
            <rect
              x={indent + a + 5}
              y={36 + i * 9}
              width={b}
              height="4"
              rx="2"
              className="fill-muted/50"
            />
          ) : null}
        </g>
      ))}
    </svg>
  );
}

// The index card's show: a cursor drifts onto "Motion" from the left,
// crosses it (the card trails and leans), eases back a little, then leaves.
// [ms after the previous step, where the cursor sits across the link].
const SHOW: [wait: number, x: number | null][] = [
  [400, 0.08],
  [140, 0.55],
  [160, 0.95],
  [900, 0.6],
  [1100, null],
];
const SHOW_REST = 1500;

export default function HoverPreviewLinkDemo() {
  const play = usePreviewPlay();
  const [simX, setSimX] = useState<number | null>(null);

  useEffect(() => {
    if (play !== true) return;
    let timer: ReturnType<typeof setTimeout>;
    const step = (i: number) => {
      const [wait, x] = SHOW[i % SHOW.length];
      const rest = i > 0 && i % SHOW.length === 0 ? SHOW_REST : 0;
      timer = setTimeout(() => {
        setSimX(x);
        step(i + 1);
      }, wait + rest);
    };
    step(0);
    // Unhovering takes the pointer away; the card leaves by its own exit.
    return () => {
      clearTimeout(timer);
      setSimX(null);
    };
  }, [play]);

  return (
    <p
      className={cn(
        "text-[15px] leading-7 text-muted",
        // An index card is too short for a card above a two-line paragraph.
        // Narrower there, so "Motion" lands on the last of four lines and
        // its card fits above it inside the preview, with the text still
        // (all but) centred at rest.
        play === null ? "w-[min(400px,100%)]" : "w-[220px] pt-4",
      )}
    >
      Most of my motion thinking comes from{" "}
      <HoverPreviewLink
        href="https://emilkowal.ski/ui/great-animations"
        title="Great animations"
        domain="emilkowal.ski"
        image={<ArticleThumb />}
      >
        this essay
      </HoverPreviewLink>
      , and the springs in this lab are tuned with{" "}
      <HoverPreviewLink
        href="https://github.com/motiondivision/motion"
        title="motiondivision/motion"
        domain="github.com"
        image={<RepoThumb />}
        simulate={simX === null ? null : { x: simX }}
      >
        Motion
      </HoverPreviewLink>
      .
    </p>
  );
}
