import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import {
  animate,
  AnimatePresence,
  motion,
  useMotionValue,
  useTransform,
} from "motion/react";
import { useReducedMotion } from "@/lib/use-reduced-motion";
import { cn } from "@/lib/cn";

/* The teachable part: one label card for every hotspot. The picture sits
   inside a larger stage, and the card is placed wherever it covers the
   least: never another hotspot, never the product's subject if there is
   free stage around it, and otherwise as close to its point as it can be.
   A leader line is recomputed every frame from the point to the nearest
   spot on the card's edge, so when the card travels to the next hotspot
   the line bends with it instead of being redrawn. */

export type Hotspot = {
  // Position on the image, as a fraction of its width and height.
  x: number;
  y: number;
  title: string;
  body: string;
};

// A rectangle on the image, as fractions of its width and height.
export type Region = { x: number; y: number; w: number; h: number };

const EASE_OUT = [0.23, 1, 0.32, 1] as const;
// A little give on the glide so the card reads as carried, not teleported.
const GLIDE = { type: "spring", visualDuration: 0.35, bounce: 0.12 } as const;
// Below this stage width the card spans the stage instead of sitting in a
// gutter beside the product.
const NARROW = 520;
const CARD_W = 188;
// Fixed per layout so the card never resizes mid-glide; each fits a
// counter, a title and the body at that width.
const CARD_H = 136;
const CARD_H_NARROW = 112;
// Distance between a hotspot and the near edge of its card.
const GAP = 48;
// Breathing room kept between the card and the subject.
const SUBJECT_GAP = 12;
// Nothing gets closer than this to the stage edge.
const MARGIN = 12;
// The line starts just outside the hotspot's dot rather than at its center.
const DOT_R = 9;

type Side = "left" | "right" | "top" | "bottom";
type Rect = { x: number; y: number; w: number; h: number };

function overlap(a: Rect, b: Rect) {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

function place(
  px: number,
  py: number,
  W: number,
  H: number,
  w: number,
  h: number,
  others: { x: number; y: number }[],
  subject: Rect | null,
) {
  const clampX = (x: number) => Math.min(Math.max(x, MARGIN), W - w - MARGIN);
  const clampY = (y: number) => Math.min(Math.max(y, MARGIN), H - h - MARGIN);
  const s = subject;
  // Each side three ways: tucked in next to the point, pushed just clear
  // of the subject, and pushed all the way to the stage edge.
  const raw: { side: Side; x: number; y: number }[] = [
    { side: "right", x: px + GAP, y: py - h / 2 },
    { side: "right", x: s ? Math.max(px + GAP, s.x + s.w + SUBJECT_GAP) : W, y: py - h / 2 },
    { side: "right", x: W, y: py - h / 2 },
    { side: "left", x: px - GAP - w, y: py - h / 2 },
    { side: "left", x: s ? Math.min(px - GAP - w, s.x - SUBJECT_GAP - w) : 0, y: py - h / 2 },
    { side: "left", x: 0, y: py - h / 2 },
    { side: "bottom", x: px - w / 2, y: py + GAP },
    { side: "bottom", x: px - w / 2, y: s ? Math.max(py + GAP, s.y + s.h + SUBJECT_GAP) : H },
    { side: "bottom", x: px - w / 2, y: H },
    { side: "top", x: px - w / 2, y: py - GAP - h },
    { side: "top", x: px - w / 2, y: s ? Math.min(py - GAP - h, s.y - SUBJECT_GAP - h) : 0 },
    { side: "top", x: px - w / 2, y: 0 },
  ];
  const scored = raw.map((o) => {
    const x = clampX(o.x);
    const y = clampY(o.y);
    const card = { x, y, w, h };
    // Hiding a hotspot, including the one being described, costs more than
    // anything else; covering the subject comes next; then the shortest
    // leader line wins.
    const hidden = [{ x: px, y: py }, ...others].filter(
      (p) => p.x > x - 8 && p.x < x + w + 8 && p.y > y - 8 && p.y < y + h + 8,
    ).length;
    const covered = s ? overlap(card, s) : 0;
    const ex = Math.min(Math.max(px, x), x + w);
    const ey = Math.min(Math.max(py, y), y + h);
    const cost = hidden * 1e7 + covered * 4 + Math.hypot(ex - px, ey - py);
    return { side: o.side, x, y, cost };
  });
  return scored.reduce((a, b) => (b.cost < a.cost ? b : a));
}

const STYLES = `
@keyframes hotspot-breathe {
  0% { scale: 1; opacity: 0.7; }
  70%, 100% { scale: 2.4; opacity: 0; }
}
.hotspot-ring { animation: hotspot-breathe 2.8s cubic-bezier(0.23, 1, 0.32, 1) infinite; }
@media (prefers-reduced-motion: reduce) { .hotspot-ring { animation: none; opacity: 0; } }
`;

export function ImageHotspots({
  hotspots,
  image,
  label,
  aspect = 3 / 4,
  subject,
  defaultActive = null,
  className,
}: {
  hotspots: Hotspot[];
  // The picture itself, fitted into a box of `aspect` (width / height),
  // centered across the stage and pinned to its top.
  image: React.ReactNode;
  label: string;
  aspect?: number;
  // The part of the image the card should keep clear of when it can.
  subject?: Region;
  defaultActive?: number | null;
  // Give the stage its shape here (an aspect ratio or a height).
  className?: string;
}) {
  const reduceMotion = useReducedMotion() ?? false;
  const id = useId();
  const stage = useRef<HTMLDivElement>(null);
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [active, setActive] = useState<number | null>(defaultActive);
  // The last opened hotspot, so the roving tab stop and the card's content
  // survive closing.
  const [focusIndex, setFocusIndex] = useState(defaultActive ?? 0);
  const wasOpen = useRef(false);

  const hx = useMotionValue(0);
  const hy = useMotionValue(0);
  const cx = useMotionValue(0);
  const cy = useMotionValue(0);
  const narrow = size.w > 0 && size.w < NARROW;
  const cardW = narrow ? size.w - MARGIN * 2 : CARD_W;
  const cardH = narrow ? CARD_H_NARROW : CARD_H;
  // Read inside the line's transform, which only follows motion values.
  const cw = useMotionValue(CARD_W);
  const ch = useMotionValue(CARD_H);

  // The line runs from the hotspot to the closest point on the card, so it
  // stays attached whichever side the card has moved to.
  const endX = useTransform(() =>
    Math.min(Math.max(hx.get(), cx.get()), cx.get() + cw.get()),
  );
  const endY = useTransform(() =>
    Math.min(Math.max(hy.get(), cy.get()), cy.get() + ch.get()),
  );
  const line = useTransform(() => {
    const px = hx.get();
    const py = hy.get();
    const ex = endX.get();
    const ey = endY.get();
    const len = Math.hypot(ex - px, ey - py) || 1;
    const sx = px + ((ex - px) / len) * DOT_R;
    const sy = py + ((ey - py) / len) * DOT_R;
    return `M${sx} ${sy}L${ex} ${ey}`;
  });

  useLayoutEffect(() => {
    const el = stage.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setSize({ w: width, h: height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Same geometry the CSS gives the image box: fitted, centered, top.
  const bw = Math.min(size.w, size.h * aspect);
  const bh = bw / aspect;
  const bx = (size.w - bw) / 2;
  const toStage = useCallback(
    (h: { x: number; y: number }) => ({ x: bx + h.x * bw, y: h.y * bh }),
    [bx, bw, bh],
  );
  const subjectRect = subject
    ? { x: bx + subject.x * bw, y: subject.y * bh, w: subject.w * bw, h: subject.h * bh }
    : null;

  const layout = (i: number) => {
    const p = toStage(hotspots[i]);
    const others = hotspots.filter((_, j) => j !== i).map(toStage);
    return place(p.x, p.y, size.w, size.h, cardW, cardH, others, subjectRect);
  };

  // The card grows out of, and closes toward, the edge facing its hotspot.
  // Based on the last opened point, so a closing card keeps its side.
  const target = size.w ? layout(active ?? focusIndex) : null;
  const side: Side = target?.side ?? "right";
  const tx = target?.x ?? 0;
  const ty = target?.y ?? 0;
  const point = size.w ? toStage(hotspots[active ?? focusIndex]) : { x: 0, y: 0 };
  const px = point.x;
  const py = point.y;

  // Moves the point and the card before paint, so the first frame is
  // already right. Opening jumps; switching glides and keeps velocity.
  useLayoutEffect(() => {
    cw.set(cardW);
    ch.set(cardH);
    if (active === null || !size.w) {
      wasOpen.current = false;
      return;
    }
    if (!wasOpen.current || reduceMotion) {
      hx.jump(px);
      hy.jump(py);
      cx.jump(tx);
      cy.jump(ty);
    } else {
      animate(hx, px, GLIDE);
      animate(hy, py, GLIDE);
      animate(cx, tx, GLIDE);
      animate(cy, ty, GLIDE);
    }
    wasOpen.current = true;
  }, [active, size.w, px, py, tx, ty, cardW, cardH, reduceMotion, hx, hy, cx, cy, cw, ch]);

  useEffect(
    () => () => {
      hx.stop();
      hy.stop();
      cx.stop();
      cy.stop();
    },
    [hx, hy, cx, cy],
  );

  const open = useCallback((i: number) => {
    setActive(i);
    setFocusIndex(i);
  }, []);

  const close = useCallback(() => setActive(null), []);

  // Clicking anywhere outside the stage puts the card away.
  useEffect(() => {
    if (active === null) return;
    const onDown = (e: PointerEvent) => {
      if (!stage.current?.contains(e.target as Node)) close();
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [active, close]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    const n = hotspots.length;
    const from = active ?? focusIndex;
    let next: number | null = null;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") next = (from + 1) % n;
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp") next = (from - 1 + n) % n;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = n - 1;
    else if (e.key === "Escape" && active !== null) {
      e.preventDefault();
      close();
      buttons.current[from]?.focus();
      return;
    }
    if (next === null) return;
    e.preventDefault();
    open(next);
    buttons.current[next]?.focus();
  };

  const shown = active ?? focusIndex;
  const isOpen = active !== null && size.w > 0;
  const spot = hotspots[shown];
  const origin = {
    right: "left center",
    left: "right center",
    bottom: "center top",
    top: "center bottom",
  }[side];
  const lineAnimate = isOpen
    ? { pathLength: 1, opacity: 1, transition: { duration: reduceMotion ? 0 : 0.28, ease: EASE_OUT } }
    : { pathLength: reduceMotion ? 1 : 0, opacity: 0, transition: { duration: 0.15, ease: EASE_OUT } };

  return (
    <div
      ref={stage}
      role="group"
      aria-label={label}
      onKeyDown={onKeyDown}
      className={cn(
        "relative aspect-[8/5] w-full overflow-hidden rounded-[20px] bg-surface select-none @container-[size]",
        className,
      )}
    >
      <style>{STYLES}</style>
      {/* Fitted like object-fit: contain, pinned to the top, so on a tall
          narrow stage the free room collects below for the card. */}
      <div
        className="absolute top-0 left-1/2 -translate-x-1/2"
        style={{
          width: `min(100cqw, ${aspect * 100}cqh)`,
          aspectRatio: String(aspect),
        }}
      >
        <div className="absolute inset-0" aria-hidden>
          {image}
        </div>
        {hotspots.map((h, i) => {
          const current = active === i;
          return (
            <button
              key={h.title}
              ref={(el) => {
                buttons.current[i] = el;
              }}
              type="button"
              aria-label={h.title}
              aria-expanded={current}
              aria-controls={`${id}-card`}
              tabIndex={i === focusIndex ? 0 : -1}
              onClick={() => (current ? close() : open(i))}
              onFocus={() => setFocusIndex(i)}
              className={cn(
                "group/spot absolute z-10 flex size-10 -translate-x-1/2 -translate-y-1/2 touch-manipulation items-center justify-center rounded-full outline-hidden",
                "transition-[scale] duration-150 ease-out active:scale-[0.96]",
                "focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-foreground",
              )}
              style={{ left: `${h.x * 100}%`, top: `${h.y * 100}%` }}
            >
              {/* Staggered so the points breathe out of step, like a room
                  of people rather than a metronome. */}
              <span
                className={cn(
                  "hotspot-ring absolute size-3.5 rounded-full bg-background",
                  current && "hidden",
                )}
                style={{ animationDelay: `${i * 0.55}s` }}
              />
              <span
                className={cn(
                  "relative size-3.5 rounded-full border-2 border-background bg-foreground shadow-[0_1px_3px_oklch(0_0_0/0.4)]",
                  "transition-[scale] duration-200 ease-[cubic-bezier(0.23,1,0.32,1)]",
                  current ? "scale-125" : "group-hover/spot:scale-110",
                )}
              />
            </button>
          );
        })}
      </div>

      <svg
        aria-hidden
        className="pointer-events-none absolute inset-0 z-10 size-full overflow-visible"
      >
        {/* A pale halo under the line keeps it readable where it crosses
            dark parts of the picture. */}
        <motion.path
          d={line}
          fill="none"
          stroke="var(--background)"
          strokeOpacity={0.7}
          strokeWidth={3.5}
          strokeLinecap="round"
          initial={false}
          animate={lineAnimate}
        />
        <motion.path
          d={line}
          fill="none"
          stroke="var(--foreground)"
          strokeWidth={1.25}
          strokeLinecap="round"
          initial={false}
          animate={lineAnimate}
        />
        <motion.circle
          cx={endX}
          cy={endY}
          r={2.5}
          fill="var(--foreground)"
          initial={false}
          animate={{
            opacity: isOpen ? 1 : 0,
            transition: { duration: isOpen ? 0.2 : 0.12, delay: isOpen && !reduceMotion ? 0.2 : 0 },
          }}
        />
      </svg>

      <motion.div
        id={`${id}-card`}
        aria-live="polite"
        style={{ x: cx, y: cy, width: cardW, height: cardH, transformOrigin: origin }}
        initial={false}
        animate={
          isOpen
            ? { opacity: 1, scale: 1, filter: "blur(0px)", transition: { duration: 0.22, ease: EASE_OUT } }
            : { opacity: 0, scale: reduceMotion ? 1 : 0.97, filter: "blur(2px)", transition: { duration: 0.14, ease: EASE_OUT } }
        }
        className={cn(
          "absolute top-0 left-0 z-20 overflow-hidden rounded-[14px] bg-background p-3.5 shadow-raised",
          !isOpen && "pointer-events-none",
        )}
      >
        {isOpen && (
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.div
              key={shown}
              initial={{ opacity: 0, filter: "blur(4px)", y: reduceMotion ? 0 : 4 }}
              animate={{ opacity: 1, filter: "blur(0px)", y: 0, transition: { duration: 0.24, ease: EASE_OUT } }}
              exit={{ opacity: 0, filter: "blur(2px)", transition: { duration: 0.12, ease: EASE_OUT } }}
            >
              <p className="text-xs font-medium text-muted tabular-nums">
                {String(shown + 1).padStart(2, "0")} / {String(hotspots.length).padStart(2, "0")}
              </p>
              <p className="mt-1 text-[15px]/5 font-semibold text-foreground">{spot.title}</p>
              <p className="mt-1 text-sm/5 text-pretty text-muted">{spot.body}</p>
            </motion.div>
          </AnimatePresence>
        )}
      </motion.div>
    </div>
  );
}

// Physical materials, the same in both themes as a product photo would be:
// brushed steel, a deep green sunray dial, cream lume, tan leather and an
// orange seconds hand.
const STEEL_HI = "oklch(0.95 0.004 250)";
const STEEL_MID = "oklch(0.74 0.008 250)";
const STEEL_LO = "oklch(0.58 0.01 250)";
const DIAL_IN = "oklch(0.47 0.075 162)";
const DIAL_OUT = "oklch(0.25 0.045 165)";
const LUME = "oklch(0.95 0.03 95)";
const LEATHER = "oklch(0.55 0.1 55)";
const LEATHER_DARK = "oklch(0.42 0.085 50)";
const HOLE = "oklch(0.22 0.04 50)";
const THREAD = "oklch(0.9 0.04 85)";
const SECONDS = "oklch(0.7 0.17 45)";
const GLARE = "oklch(1 0 0 / 0.16)";

// The classic 10:09 shop-window time: the hands frame the logo.
const HOUR_ANGLE = (10 + 9 / 60) * 30;
const MINUTE_ANGLE = 9 * 6;

const WATCH_STYLES = `
@keyframes watch-sweep { to { rotate: 360deg; } }
.watch-seconds { animation: watch-sweep 60s linear infinite; transform-origin: 150px 200px; }
@media (prefers-reduced-motion: reduce) { .watch-seconds { animation: none; } }
`;

/* A field watch lying flat, seen from above, in a 300 x 400 frame. */
function Watch() {
  const uid = `w${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  const steel = `url(#${uid}s)`;
  return (
    <svg viewBox="0 0 300 400" className="size-full overflow-visible">
      <style>{WATCH_STYLES}</style>
      <defs>
        <linearGradient id={`${uid}s`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={STEEL_HI} />
          <stop offset="0.55" stopColor={STEEL_MID} />
          <stop offset="1" stopColor={STEEL_HI} />
        </linearGradient>
        <radialGradient id={`${uid}d`} cx="0.42" cy="0.38" r="0.7">
          <stop offset="0" stopColor={DIAL_IN} />
          <stop offset="1" stopColor={DIAL_OUT} />
        </radialGradient>
        <linearGradient id={`${uid}l`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor={LEATHER_DARK} />
          <stop offset="0.3" stopColor={LEATHER} />
          <stop offset="0.75" stopColor={LEATHER} />
          <stop offset="1" stopColor={LEATHER_DARK} />
        </linearGradient>
      </defs>

      <g className="[filter:drop-shadow(0_12px_14px_oklch(0_0_0/0.28))]">
        {/* Straps: the buckle end above, the holes below. Both run well
            past the frame, so a tall stage never shows where they end. */}
        <rect x="112" y="-200" width="76" height="340" rx="6" fill={`url(#${uid}l)`} />
        <rect x="112" y="262" width="76" height="340" rx="6" fill={`url(#${uid}l)`} />
        {[-200, 262].map((y) => (
          <g key={y} stroke={THREAD} strokeWidth="1" strokeDasharray="4 3" opacity="0.75">
            <line x1="118" x2="118" y1={y + 4} y2={y + 334} />
            <line x1="182" x2="182" y1={y + 4} y2={y + 334} />
          </g>
        ))}
        {[322, 344, 366].map((y) => (
          <circle key={y} cx="150" cy={y} r="3.6" fill={HOLE} />
        ))}
        {/* Keeper loop and a brushed pin buckle. */}
        <rect x="108" y="66" width="84" height="12" rx="3" fill={LEATHER_DARK} />
        <rect x="104" y="18" width="92" height="34" rx="9" fill="none" stroke={steel} strokeWidth="6" />
        <rect x="147" y="14" width="6" height="42" rx="3" fill={steel} />

        {/* Lugs. */}
        {[
          [102, 112],
          [184, 112],
          [102, 258],
          [184, 258],
        ].map(([x, y]) => (
          <rect key={`${x}-${y}`} x={x} y={y} width="14" height="30" rx="5" fill={steel} />
        ))}

        {/* Crown, with its grip. */}
        <rect x="226" y="186" width="20" height="28" rx="4" fill={steel} />
        {[191, 196, 201, 206, 211].map((y) => (
          <line key={y} x1="236" x2="246" y1={y} y2={y} stroke={STEEL_LO} strokeWidth="1" />
        ))}

        {/* Case, polished bezel, then the dial. */}
        <circle cx="150" cy="200" r="80" fill={steel} />
        <circle cx="150" cy="200" r="73" fill="none" stroke={STEEL_LO} strokeWidth="1.5" opacity="0.6" />
        <circle cx="150" cy="200" r="68" fill={`url(#${uid}d)`} />
      </g>

      {/* Minute track and applied hour markers, 3 o'clock giving way to
          the date window. */}
      {Array.from({ length: 60 }, (_, i) => (
        <line
          key={i}
          x1="150"
          x2="150"
          y1="135"
          y2="138.5"
          stroke={LUME}
          strokeOpacity={i % 5 ? 0.35 : 0.7}
          strokeWidth="0.8"
          transform={`rotate(${i * 6} 150 200)`}
        />
      ))}
      {Array.from({ length: 12 }, (_, i) =>
        i === 3 ? null : (
          <rect
            key={i}
            x={i === 0 ? 144 : 148}
            y="142"
            width={i === 0 ? 12 : 4}
            height="12"
            rx="1.2"
            fill={LUME}
            transform={`rotate(${i * 30} 150 200)`}
          />
        ),
      )}
      <rect x="190" y="193" width="18" height="14" rx="2" fill={LUME} />
      <text x="199" y="203.5" textAnchor="middle" fontSize="9" fontWeight="600" fill={DIAL_OUT}>
        23
      </text>
      <text x="150" y="172" textAnchor="middle" fontSize="9" fontWeight="700" letterSpacing="2.4" fill={LUME}>
        AUREL
      </text>
      <text x="150" y="238" textAnchor="middle" fontSize="5.5" letterSpacing="1.6" fill={LUME} opacity="0.7">
        AUTOMATIC
      </text>

      {/* Hands: hour, minute, then the sweeping seconds. */}
      <g transform={`rotate(${HOUR_ANGLE} 150 200)`}>
        <rect x="146.5" y="164" width="7" height="42" rx="3.5" fill={steel} />
        <rect x="148.5" y="168" width="3" height="24" rx="1.5" fill={LUME} />
      </g>
      <g transform={`rotate(${MINUTE_ANGLE} 150 200)`}>
        <rect x="147.5" y="142" width="5" height="64" rx="2.5" fill={steel} />
        <rect x="149" y="146" width="2" height="40" rx="1" fill={LUME} />
      </g>
      <g className="watch-seconds">
        <rect x="149.3" y="138" width="1.4" height="76" rx="0.7" fill={SECONDS} />
        <circle cx="150" cy="210" r="3" fill={SECONDS} />
      </g>
      <circle cx="150" cy="200" r="3.4" fill={steel} />

      {/* Sapphire glare across the upper left of the crystal. */}
      <path d="M92 176A62 62 0 0 1 176 138A72 72 0 0 0 92 176Z" fill={GLARE} />
    </svg>
  );
}

const SPOTS: Hotspot[] = [
  {
    x: 150 / 300,
    y: 35 / 400,
    title: "Pin buckle",
    body: "Brushed steel, sized to the strap so it sits flat on the wrist.",
  },
  {
    x: 112 / 300,
    y: 168 / 400,
    title: "Sapphire crystal",
    body: "Domed, with anti-glare inside, so the dial reads at any angle.",
  },
  {
    x: 238 / 300,
    y: 200 / 400,
    title: "Screw-down crown",
    body: "Seals the case to 100 m. Pull once for the date, twice for time.",
  },
  {
    x: 181 / 300,
    y: 176 / 400,
    title: "Lume-filled hands",
    body: "Charge them in daylight and they glow through the night.",
  },
  {
    x: 150 / 300,
    y: 344 / 400,
    title: "Leather strap",
    body: "Vegetable tanned, so it darkens with wear. Quick-release pins.",
  },
];

// The case, crown and lugs: what the card should never sit on.
const CASE: Region = { x: 100 / 300, y: 112 / 400, w: 148 / 300, h: 176 / 400 };

export default function ImageHotspotsDemo() {
  return (
    <div className="flex w-[640px] max-w-full flex-col gap-4">
      <ImageHotspots
        label="Aurel Field watch, feature points"
        image={<Watch />}
        hotspots={SPOTS}
        subject={CASE}
        defaultActive={1}
        className="aspect-[4/7] sm:aspect-[8/5]"
      />
      <div className="flex items-baseline justify-between gap-4 px-1">
        <div className="min-w-0">
          <p className="text-[15px] font-semibold text-foreground">Aurel Field 38</p>
          <p className="text-sm text-muted">Automatic, 38 mm steel case</p>
        </div>
        <p className="text-[15px] font-medium text-foreground tabular-nums">$495</p>
      </div>
    </div>
  );
}
