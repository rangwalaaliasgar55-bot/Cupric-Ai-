import { useEffect, useId, useRef, useState } from "react";
import {
  animate,
  useMotionValue,
  useMotionValueEvent,
  useSpring,
  useTransform,
  motion,
  type AnimationPlaybackControls,
} from "motion/react";
import { useReducedMotion } from "@/lib/use-reduced-motion";
import { cn } from "@/lib/cn";

// Everything is drawn in a 360 x 280 viewBox that scales with the card.
const W = 360;
const H = 280;
const CX = W / 2;
// The slider's travel. Closed it parks just under the top edge; fully open
// it stops where its 42 tall tab still clears the bottom edge.
const P_MIN = 26;
const P_MAX = H - 44;
// Teeth part at the top of the slider, 10 above its pivot.
const SLIDER_TOP = 10;
// Half the widest gap, and how far above the slider the gap takes to open
// fully. A longer run gives the soft V a real zipper makes.
const MAX_HALF = 110;
const OPEN_RUN = 130;
// The first 48 of travel only loosens the top, so a tiny pull doesn't
// flare the whole pouch open.
const RAMP = 48;
const TOOTH_PITCH = 7;
// The zip ends at the bottom stop, just under the fully open slider.
const ZIP_END = P_MAX + 8;
const TOOTH_COUNT = Math.floor((ZIP_END - 3) / TOOTH_PITCH);
const TAPE = 7;
const STEP = 0.1;
// Copying only makes sense once the button is fully in the gap.
const REVEAL_AT = 0.9;
const SETTLE = { type: "spring", stiffness: 500, damping: 50 } as const;

// Physical materials, the same in both themes the way a real pouch is:
// indigo canvas, a darker lining, brass hardware, cream thread, a
// leather pull and a paper voucher with near-black ink.
const FABRIC = "oklch(0.43 0.075 258)";
const LINING = "oklch(0.24 0.04 258)";
const TAPE_FILL = "oklch(0.27 0.045 258)";
const THREAD = "oklch(0.9 0.045 85)";
const BRASS_LIGHT = "oklch(0.9 0.09 92)";
const BRASS_DARK = "oklch(0.62 0.1 72)";
const LEATHER = "oklch(0.36 0.06 48)";
const CARD = "oklch(0.975 0.012 90)";
const CARD_INK = "oklch(0.24 0.01 260)";

const clamp = (v: number, min: number, max: number) =>
  Math.min(Math.max(v, min), max);

// Half-width of the gap at height y with the slider at p, and its slope.
function gap(y: number, p: number) {
  const d = p - SLIDER_TOP - y;
  if (d <= 0) return { h: 0, slope: 0 };
  const r = clamp((p - P_MIN) / RAMP, 0, 1);
  const t = Math.min(d / OPEN_RUN, 1);
  return {
    h: MAX_HALF * r * (1 - (1 - t) ** 2),
    slope: t < 1 ? (MAX_HALF * r * 2 * (1 - t)) / OPEN_RUN : 0,
  };
}

function edge(p: number) {
  const points: [number, number][] = [];
  const end = p - SLIDER_TOP;
  for (let y = 0; y < end; y += 6) points.push([gap(y, p).h, y]);
  points.push([0, end]);
  return points;
}

function flapPath(p: number, side: 1 | -1) {
  const outer = side === -1 ? 0 : W;
  const pts = edge(p)
    .map(([h, y]) => `L${CX + side * h} ${y}`)
    .join("");
  return `M${outer} 0${pts}L${CX} ${H}L${outer} ${H}Z`;
}

function tapePath(p: number, side: 1 | -1) {
  const pts = edge(p);
  const inner = pts.map(([h, y]) => `${CX + side * h} ${y}`);
  const outer = pts.map(([h, y]) => `${CX + side * (h + TAPE)} ${y}`).reverse();
  return `M${inner.join("L")}L${CX} ${ZIP_END}L${CX + side * TAPE} ${ZIP_END}L${outer.join("L")}Z`;
}

// Each tooth stays square to its tape, so as the tape leans away from the
// seam the teeth tilt apart with it.
function toothTransform(i: number, side: 1 | -1, p: number) {
  const y = 3 + i * TOOTH_PITCH + (side === 1 ? TOOTH_PITCH / 2 : 0);
  const { h, slope } = gap(y, p);
  const angle = (Math.atan(slope) * 180) / Math.PI;
  return `translate(${CX + side * h} ${y}) rotate(${side * angle})`;
}

function openness(p: number) {
  return (p - P_MIN) / (P_MAX - P_MIN);
}

function describe(p: number) {
  const pct = Math.round(openness(p) * 100);
  return pct === 0 ? "Zipped" : pct === 100 ? "Open" : `Open ${pct}%`;
}

export function ZipperReveal({
  label = "Voucher",
  secret = "LAB-7Q2X",
  note = "20% off",
  className,
}: {
  label?: string;
  secret?: string;
  note?: string;
  className?: string;
}) {
  const reduceMotion = useReducedMotion();
  // SVG ids must be plain: React's ids carry colons or guillemets.
  const uid = `zip${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  const p = useMotionValue(P_MIN);
  const [revealed, setRevealed] = useState(false);
  const [copied, setCopied] = useState(false);
  const copyTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const glide = useRef<AnimationPlaybackControls>(undefined);
  const boxRef = useRef<HTMLDivElement>(null);
  const handleRef = useRef<HTMLDivElement>(null);
  const columnRef = useRef<HTMLDivElement>(null);
  const readoutRef = useRef<HTMLSpanElement>(null);
  const flapL = useRef<SVGPathElement>(null);
  const flapR = useRef<SVGPathElement>(null);
  const tapeL = useRef<SVGPathElement>(null);
  const tapeR = useRef<SVGPathElement>(null);
  const teeth = useRef<(SVGRectElement | null)[]>([]);
  const slider = useRef<SVGGElement>(null);
  const tab = useRef<SVGGElement>(null);
  const drag = useRef<{
    id: number;
    startY: number;
    startP: number;
    lastY: number;
    lastT: number;
    v: number;
  } | null>(null);

  // The tab points at your finger while you pull, then swings back to
  // hanging straight: a spring with a little bounce, like a pendulum.
  const lean = useMotionValue(0);
  const swing = useSpring(lean, { stiffness: 260, damping: 12 });
  useMotionValueEvent(swing, "change", (a) =>
    tab.current?.setAttribute("transform", `rotate(${a})`),
  );

  // The content comes into focus as the gap opens: sharp by 60%.
  const blur = useTransform(p, (v) => {
    const b = 4 * clamp(1 - openness(v) / 0.6, 0, 1);
    return b > 0.01 ? `blur(${b}px)` : "none";
  });

  useEffect(
    () => () => {
      clearTimeout(copyTimer.current);
      glide.current?.stop();
    },
    [],
  );

  useMotionValueEvent(p, "change", (v) => {
    flapL.current?.setAttribute("d", flapPath(v, -1));
    flapR.current?.setAttribute("d", flapPath(v, 1));
    tapeL.current?.setAttribute("d", tapePath(v, -1));
    tapeR.current?.setAttribute("d", tapePath(v, 1));
    for (let i = 0; i < TOOTH_COUNT; i++) {
      teeth.current[i * 2]?.setAttribute("transform", toothTransform(i, -1, v));
      teeth.current[i * 2 + 1]?.setAttribute(
        "transform",
        toothTransform(i, 1, v),
      );
    }
    slider.current?.setAttribute("transform", `translate(${CX} ${v})`);
    const text = describe(v);
    if (readoutRef.current) readoutRef.current.textContent = text;
    if (columnRef.current)
      columnRef.current.style.transform = `translateY(${(v / H) * 100}%)`;
    const handle = handleRef.current;
    if (handle) {
      handle.setAttribute(
        "aria-valuenow",
        String(Math.round(openness(v) * 100)),
      );
      handle.setAttribute("aria-valuetext", text);
    }
    const open = openness(v) >= REVEAL_AT;
    if (open !== revealed) setRevealed(open);
  });

  const moveTo = (target: number) => {
    glide.current?.stop();
    const to = clamp(target, P_MIN, P_MAX);
    if (reduceMotion) p.set(to);
    else glide.current = animate(p, to, SETTLE);
  };

  const scale = () => W / (boxRef.current?.offsetWidth || W);

  const copy = async () => {
    try {
      await navigator.clipboard?.writeText(secret);
      setCopied(true);
      clearTimeout(copyTimer.current);
      copyTimer.current = setTimeout(() => setCopied(false), 1600);
    } catch {
      // Nothing to undo: the code stays on screen to copy by hand.
    }
  };

  return (
    <div className={cn("w-[min(440px,100%)]", className)}>
      <div
        ref={boxRef}
        className="relative w-full overflow-hidden rounded-[22px] shadow-raised"
        style={{ aspectRatio: `${W} / ${H}`, background: LINING }}
      >
        {/* Underneath: the lining, shadowed under the flaps, with a
            voucher tucked into the pouch. */}
        <motion.div
          className="absolute inset-0 flex justify-center pt-[6%] shadow-[inset_0_10px_24px_oklch(0_0_0/0.45)]"
          style={{ filter: blur }}
          inert={!revealed}
        >
          <div
            className={cn(
              "h-fit w-[min(212px,56%)] rounded-[14px] px-3.5 pt-3 pb-3.5 transition-[translate,rotate,box-shadow] duration-500 ease-[cubic-bezier(0.23,1,0.32,1)] motion-reduce:transition-none",
              revealed
                ? "-translate-y-1 rotate-0 shadow-[0_10px_24px_-6px_oklch(0_0_0/0.55)]"
                : "translate-y-1 -rotate-2 shadow-[0_2px_6px_oklch(0_0_0/0.4)]",
            )}
            style={{ background: CARD, color: CARD_INK }}
          >
            <div className="flex items-baseline justify-between gap-2 text-xs font-medium whitespace-nowrap">
              <span className="truncate tracking-wide uppercase opacity-60">
                {label}
              </span>
              <span className="font-semibold">{note}</span>
            </div>
            <div className="mt-1 font-mono text-[22px] leading-8 font-semibold tracking-wider">
              {secret}
            </div>
            {/* Perforation, with the two notches a ticket punch leaves. */}
            <div className="relative -mx-3.5 my-2.5 border-t border-dashed border-current/25">
              <span
                className="absolute -top-1.5 -left-1.5 size-3 rounded-full"
                style={{ background: LINING }}
              />
              <span
                className="absolute -top-1.5 -right-1.5 size-3 rounded-full"
                style={{ background: LINING }}
              />
            </div>
            <button
              type="button"
              onClick={copy}
              className="h-9 w-full touch-manipulation rounded-[8px] text-sm font-medium outline-hidden transition-[scale] duration-150 ease-out select-none focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-current active:scale-[0.96]"
              style={{ background: CARD_INK, color: CARD }}
            >
              <span className="grid">
                <span
                  className={cn(
                    "col-start-1 row-start-1 transition-[opacity,filter] duration-200 ease-out",
                    copied && "opacity-0 blur-[4px]",
                  )}
                >
                  Copy code
                </span>
                <span
                  className={cn(
                    "col-start-1 row-start-1 transition-[opacity,filter] duration-200 ease-out",
                    !copied && "opacity-0 blur-[4px]",
                  )}
                >
                  Copied
                </span>
              </span>
            </button>
          </div>
        </motion.div>

        <svg
          aria-hidden
          viewBox={`0 0 ${W} ${H}`}
          className="pointer-events-none absolute inset-0 size-full"
        >
          <defs>
            {/* A plain canvas weave: faint light warp, faint dark weft. */}
            <pattern
              id={`${uid}w`}
              width={3}
              height={3}
              patternUnits="userSpaceOnUse"
            >
              <rect width={3} height={1} fill="oklch(1 0 0 / 0.07)" />
              <rect width={1} height={3} fill="oklch(0 0 0 / 0.12)" />
            </pattern>
            <linearGradient id={`${uid}b`} x1="0" x2="1" y1="0" y2="0">
              <stop offset="0" stopColor={BRASS_LIGHT} />
              <stop offset="1" stopColor={BRASS_DARK} />
            </linearGradient>
            <path id={`${uid}l`} ref={flapL} d={flapPath(P_MIN, -1)} />
            <path id={`${uid}r`} ref={flapR} d={flapPath(P_MIN, 1)} />
          </defs>
          {/* The flaps, shading the lining where they lift off it. */}
          <g className="[filter:drop-shadow(0_2px_4px_oklch(0_0_0/0.45))]">
            <use href={`#${uid}l`} fill={FABRIC} />
            <use href={`#${uid}r`} fill={FABRIC} />
          </g>
          <use href={`#${uid}l`} fill={`url(#${uid}w)`} />
          <use href={`#${uid}r`} fill={`url(#${uid}w)`} />
          {/* Light falls from above: a soft sheen across the top. */}
          <rect
            width={W}
            height={H}
            fill="none"
            stroke="oklch(1 0 0 / 0.12)"
            strokeWidth={2}
            rx={20}
          />
          {/* Stitching around the three closed sides, in cream thread. */}
          <path
            d={`M14 30 V${H - 30} Q14 ${H - 14} 30 ${H - 14} H${W - 30} Q${W - 14} ${H - 14} ${W - 14} ${H - 30} V30`}
            fill="none"
            stroke={THREAD}
            strokeWidth={1.2}
            strokeDasharray="5 3.5"
            strokeLinecap="round"
          />
          {/* A woven maker's label sewn into the seam. */}
          <g transform={`translate(34 ${H - 44})`}>
            <rect width={46} height={16} rx={2} fill={THREAD} />
            <text
              x={23}
              y={11}
              textAnchor="middle"
              fontSize={8}
              fontWeight={700}
              letterSpacing={1.6}
              fill={FABRIC}
            >
              UI LAB
            </text>
          </g>
          <path ref={tapeL} d={tapePath(P_MIN, -1)} fill={TAPE_FILL} />
          <path ref={tapeR} d={tapePath(P_MIN, 1)} fill={TAPE_FILL} />
          {Array.from({ length: TOOTH_COUNT }, (_, i) =>
            ([-1, 1] as const).map((side) => (
              <rect
                key={`${i}${side}`}
                ref={(el) => {
                  teeth.current[i * 2 + (side === 1 ? 1 : 0)] = el;
                }}
                // Each tooth reaches 1.5 past the seam, into the gap
                // between two teeth on the other side: that overlap is
                // what locks a zip.
                x={side === -1 ? -6.5 : -1.5}
                y={-2}
                width={8}
                height={4}
                rx={1.2}
                transform={toothTransform(i, side, P_MIN)}
                fill={`url(#${uid}b)`}
              />
            )),
          )}
          {/* The zip ends here. */}
          <rect
            x={CX - 4.5}
            y={P_MAX + 2}
            width={9}
            height={7}
            rx={1.5}
            fill={BRASS_DARK}
          />

          <g ref={slider} transform={`translate(${CX} ${P_MIN})`}>
            <g ref={tab}>
              {/* A leather pull, riveted to the slider's bail. */}
              <rect
                x={-8}
                y={2}
                width={16}
                height={42}
                rx={5}
                fill={LEATHER}
              />
              <rect
                x={-5.5}
                y={5}
                width={11}
                height={36}
                rx={3.5}
                fill="none"
                stroke={THREAD}
                strokeWidth={0.8}
                strokeDasharray="2 1.6"
                opacity={0.7}
              />
              <circle cy={34} r={2.6} fill={`url(#${uid}b)`} />
            </g>
            <path
              d={`M-11 ${-SLIDER_TOP} H11 L8 8 Q0 11 -8 8 Z`}
              strokeLinejoin="round"
              fill={`url(#${uid}b)`}
              stroke={BRASS_DARK}
              strokeWidth={0.8}
            />
            <circle r={2.6} fill={BRASS_DARK} />
          </g>
        </svg>

        {/* A full-height column, so translating it by a percentage of its
            own height moves the handle in the card's units without
            measuring anything. */}
        <div
          ref={columnRef}
          className="pointer-events-none absolute inset-0 z-10"
          style={{ transform: `translateY(${(P_MIN / H) * 100}%)` }}
        >
          {/* The hit target and keyboard handle, over the slider and tab. */}
          <div
            ref={handleRef}
            role="slider"
            tabIndex={0}
            aria-label="Zipper"
            aria-orientation="vertical"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={0}
            aria-valuetext="Zipped"
            className="pointer-events-auto absolute left-1/2 w-12 -translate-x-1/2 cursor-grab touch-none rounded-full outline-hidden focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-foreground active:cursor-grabbing"
            // From the slider's top edge to just past the tab's end.
            style={{ top: `${(-12 / H) * 100}%`, height: `${(58 / H) * 100}%` }}
            onPointerDown={(e) => {
              if (e.button !== 0 || drag.current) return;
              glide.current?.stop();
              drag.current = {
                id: e.pointerId,
                startY: e.clientY,
                startP: p.get(),
                lastY: e.clientY,
                lastT: e.timeStamp,
                v: 0,
              };
              e.currentTarget.setPointerCapture(e.pointerId);
            }}
            onPointerMove={(e) => {
              const d = drag.current;
              if (!d || d.id !== e.pointerId) return;
              const k = scale();
              const dt = Math.max(e.timeStamp - d.lastT, 1) / 1000;
              // Smoothed, so one uneven sample can't decide the glide.
              d.v = d.v * 0.5 + (((e.clientY - d.lastY) * k) / dt) * 0.5;
              d.lastY = e.clientY;
              d.lastT = e.timeStamp;
              // The zip's end stops are hard, like the metal ones.
              p.set(clamp(d.startP + (e.clientY - d.startY) * k, P_MIN, P_MAX));
              if (reduceMotion) return;
              const box = boxRef.current!.getBoundingClientRect();
              const px = (e.clientX - box.left) * k - CX;
              const py = (e.clientY - box.top) * k - p.get();
              lean.set(
                clamp(
                  (-Math.atan2(px, Math.max(py, 20)) * 180) / Math.PI,
                  -35,
                  35,
                ),
              );
            }}
            onPointerUp={(e) => {
              const d = drag.current;
              if (!d || d.id !== e.pointerId) return;
              drag.current = null;
              lean.set(0);
              if (reduceMotion) return;
              // A zip has friction: a flick carries it on only a little,
              // and near either end it runs home.
              let target = clamp(p.get() + d.v * 0.06, P_MIN, P_MAX);
              if (target < P_MIN + 12) target = P_MIN;
              if (target > P_MAX - 12) target = P_MAX;
              glide.current = animate(p, target, { ...SETTLE, velocity: d.v });
            }}
            onPointerCancel={(e) => {
              if (drag.current?.id !== e.pointerId) return;
              drag.current = null;
              lean.set(0);
            }}
            onKeyDown={(e) => {
              const range = P_MAX - P_MIN;
              const current = p.get();
              const target = {
                ArrowDown: current + range * STEP,
                ArrowRight: current + range * STEP,
                ArrowUp: current - range * STEP,
                ArrowLeft: current - range * STEP,
                PageDown: current + range * STEP * 2.5,
                PageUp: current - range * STEP * 2.5,
                Home: P_MIN,
                End: P_MAX,
              }[e.key];
              if (target === undefined) return;
              e.preventDefault();
              moveTo(target);
            }}
          />
        </div>
      </div>

      <div className="mt-3 flex items-center justify-between px-1 text-sm">
        <span
          ref={readoutRef}
          aria-hidden
          className="font-medium text-foreground tabular-nums"
        >
          Zipped
        </span>
        <span className="text-muted">Drag the pull down</span>
      </div>
    </div>
  );
}

export default function ZipperRevealDemo() {
  return <ZipperReveal />;
}
