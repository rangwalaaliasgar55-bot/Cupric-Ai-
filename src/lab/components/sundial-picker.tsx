import { useEffect, useId, useRef, useState } from "react";
import { motion, useSpring, useTransform, type MotionValue } from "motion/react";
import { useReducedMotion } from "@/lib/use-reduced-motion";
import { cn } from "@/lib/cn";

const VB_W = 460;
const VB_H = 320;
// The sun's path: a half circle standing on the horizon.
const ARC = { x: 230, y: 196, r: 170 };
// The dial plate, a horizontal circle seen at a low angle.
const DIAL = { x: 230, y: 262, rx: 150, ry: 40 };
const START = 6 * 60;
const END = 20 * 60;
// Solar noon sits halfway along the arc, as it would on a summer day with
// daylight saving: sunrise 6:00, sunset 20:00.
const SOLAR_NOON = (START + END) / 2;
const STEP = 15;
// Latitude of the dial. It bends the hour lines the way a real horizontal
// sundial's are bent: bunched near noon, spread near dawn and dusk.
const SIN_LAT = Math.sin((40 * Math.PI) / 180);
// Shadow length as a share of the dial radius: never shorter than half so
// it always reads as a hand, growing with the cotangent of the sun's height
// until it reaches the rim when the sun is about 30 degrees up.
const SHADOW_MIN = 0.5;
const SHADOW_GROWTH = 0.3;
// Stiff and fully damped: the sun clicks into each 15 minute detent
// without overshooting past the time you chose.
const DETENT = { stiffness: 420, damping: 40 };

// Sky, sun and bronze are natural light and material, so they carry their
// own colours, each with a darker twin for the dark theme via light-dark().
// The sky at the horizon: peach at dawn and dusk, a pale blue by day.
const DUSK_SKY =
  "linear-gradient(180deg, light-dark(oklch(0.88 0.04 290), oklch(0.2 0.04 285)), light-dark(oklch(0.9 0.08 55), oklch(0.33 0.08 40)) 61%)";
const DAY_SKY =
  "linear-gradient(180deg, light-dark(oklch(0.9 0.045 235), oklch(0.25 0.045 245)), light-dark(oklch(0.97 0.015 220), oklch(0.32 0.03 230)) 61%)";
const SUN_LOW = "oklch(0.72 0.17 45)";
const SUN_HIGH = "oklch(0.88 0.15 88)";
const SUN_GLOW = "oklch(0.9 0.14 80)";
// A cast bronze plate: a lit face, a darker rim showing its thickness, and
// engraving cut darker still.
const BRONZE = "oklch(0.7 0.08 72)";
const BRONZE_EDGE = "oklch(0.5 0.07 60)";
const ENGRAVE = "oklch(0.38 0.05 55)";
// Ground under the dial, a stone terrace.
const GROUND = "light-dark(oklch(0.9 0.012 80), oklch(0.22 0.01 70))";

const clamp = (v: number, lo = 0, hi = 1) => Math.min(Math.max(v, lo), hi);
const toT = (minutes: number) => (minutes - START) / (END - START);
// Trig results can differ in the last digit between server and browser,
// which breaks hydration, so drawn coordinates are rounded.
const r2 = (n: number) => Math.round(n * 100) / 100;

// The pointer is read as an angle around a pivot below the horizon rather
// than around the arc's own center. Near the horizon that tracks sideways
// motion, near the top it tracks the curve, and it stays continuous when a
// drag dips below the horizon or starts on the dial.
const PIVOT = { x: ARC.x, y: ARC.y + 110 };
const DETENTS = Array.from({ length: (END - START) / STEP + 1 }, (_, i) => {
  const t = (i * STEP) / (END - START);
  const x = ARC.x - ARC.r * Math.cos(Math.PI * t);
  const y = ARC.y - ARC.r * Math.sin(Math.PI * t);
  return {
    minutes: START + i * STEP,
    angle: Math.atan2(PIVOT.y - y, x - PIVOT.x),
  };
});

function formatTime(minutes: number) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
}

// Direction of the shadow on a horizontal dial, in radians from "toward the
// viewer" (north), positive toward the viewer's right (west).
function shadowAngle(minutes: number) {
  const h = (((minutes - SOLAR_NOON) / 60) * 15 * Math.PI) / 180;
  return Math.atan2(SIN_LAT * -Math.sin(h), Math.cos(h));
}

// A point on the dial plate at angle psi and a fraction of its radius.
function onDial(psi: number, k: number) {
  return {
    x: r2(DIAL.x + Math.sin(psi) * DIAL.rx * k),
    y: r2(DIAL.y + Math.cos(psi) * DIAL.ry * k),
  };
}

const HOURS = Array.from({ length: 15 }, (_, i) => 6 + i);
const ROMAN = [
  "XII",
  "I",
  "II",
  "III",
  "IV",
  "V",
  "VI",
  "VII",
  "VIII",
  "IX",
  "X",
  "XI",
];
const STARS = [
  [34, 30, 1.2],
  [78, 64, 0.9],
  [22, 118, 1],
  [120, 22, 0.8],
  [426, 36, 1.1],
  [392, 84, 0.8],
  [440, 132, 1],
  [346, 20, 0.9],
] as const;

export function SundialPicker({
  value,
  onChange,
  label = "Time of day",
  className,
}: {
  /** Minutes after midnight, between 6:00 (360) and 20:00 (1200). */
  value: number;
  onChange: (minutes: number) => void;
  label?: string;
  className?: string;
}) {
  const reduceMotion = useReducedMotion();
  const sun = useSpring(toT(value), DETENT);
  const [dragging, setDragging] = useState(false);
  const drag = useRef<number | null>(null);
  const svg = useRef<SVGSVGElement>(null);

  useEffect(() => {
    if (reduceMotion) sun.jump(toT(value));
    else sun.set(toT(value));
  }, [value, reduceMotion, sun]);

  const set = (minutes: number) => {
    const next = Math.round(clamp(minutes, START, END) / STEP) * STEP;
    if (next !== value) onChange(next);
  };

  const track = (e: React.PointerEvent) => {
    const box = svg.current?.getBoundingClientRect();
    if (!box) return;
    const x = ((e.clientX - box.left) / box.width) * VB_W - PIVOT.x;
    const y = PIVOT.y - ((e.clientY - box.top) / box.height) * VB_H;
    // Under the pivot, hold the sun at whichever end is nearer.
    const a = y < 0 ? (x < 0 ? Math.PI : 0) : Math.atan2(y, x);
    let best = DETENTS[0];
    for (const d of DETENTS) {
      if (Math.abs(d.angle - a) < Math.abs(best.angle - a)) best = d;
    }
    set(best.minutes);
  };

  const endDrag = (e: React.PointerEvent) => {
    if (drag.current !== e.pointerId) return;
    drag.current = null;
    setDragging(false);
  };

  return (
    <div className={cn("flex w-[min(460px,100%)] flex-col gap-3", className)}>
      <div
        role="slider"
        tabIndex={0}
        aria-label={label}
        aria-valuemin={START}
        aria-valuemax={END}
        aria-valuenow={value}
        aria-valuetext={formatTime(value)}
        data-dragging={dragging || undefined}
        className="group relative cursor-grab touch-none overflow-hidden rounded-[24px] bg-surface outline-hidden select-none focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-foreground data-dragging:cursor-grabbing"
        style={{ aspectRatio: `${VB_W} / ${VB_H}` }}
        onPointerDown={(e) => {
          if (e.button !== 0 || drag.current !== null) return;
          e.currentTarget.setPointerCapture(e.pointerId);
          drag.current = e.pointerId;
          setDragging(true);
          track(e);
        }}
        onPointerMove={(e) => {
          if (drag.current === e.pointerId) track(e);
        }}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onKeyDown={(e) => {
          const delta = {
            ArrowRight: STEP,
            ArrowUp: STEP,
            ArrowLeft: -STEP,
            ArrowDown: -STEP,
            PageUp: 60,
            PageDown: -60,
            Home: START - END,
            End: END - START,
          }[e.key];
          if (delta === undefined) return;
          e.preventDefault();
          set(value + delta);
        }}
      >
        <Sky sun={sun} />
        <svg
          ref={svg}
          viewBox={`0 0 ${VB_W} ${VB_H}`}
          className="absolute inset-0 size-full"
          aria-hidden
        >
          <Stars sun={sun} />
          <path
            d={`M${ARC.x - ARC.r} ${ARC.y}A${ARC.r} ${ARC.r} 0 0 1 ${ARC.x + ARC.r} ${ARC.y}`}
            fill="none"
            className="stroke-foreground/15"
            strokeDasharray="2 5"
          />
          {HOURS.map((h) => {
            const a = Math.PI * (1 - toT(h * 60));
            const c = Math.cos(a);
            const s = Math.sin(a);
            const at = (r: number) => ({
              x: r2(ARC.x + c * r),
              y: r2(ARC.y - s * r),
            });
            const inner = at(ARC.r - 4);
            const outer = at(ARC.r + 4);
            return (
              <line
                key={h}
                x1={inner.x}
                y1={inner.y}
                x2={outer.x}
                y2={outer.y}
                className="stroke-foreground/25"
              />
            );
          })}
          <Sun sun={sun} />
          {/* Ground. Drawn over the sun so it sets behind the horizon. */}
          <rect
            x={0}
            y={ARC.y}
            width={VB_W}
            height={VB_H - ARC.y}
            style={{ fill: GROUND }}
          />
          <line
            x1={0}
            x2={VB_W}
            y1={ARC.y}
            y2={ARC.y}
            className="stroke-foreground/15"
          />
          <Dial sun={sun} />
        </svg>
        {/* On top of the sky layer, which would cover an inset ring. */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 rounded-[24px] inset-ring inset-ring-foreground/10"
        />
      </div>
      <div className="flex items-baseline justify-between gap-3 px-1">
        <p className="text-2xl font-medium text-foreground tabular-nums">
          {formatTime(value)}
        </p>
        <p className="text-[13px] text-muted">Drag the sun, 6 AM to 8 PM</p>
      </div>
    </div>
  );
}

function Sky({ sun }: { sun: MotionValue<number> }) {
  // Surface at the horizon, background at noon. Scaled up so the sky is
  // fully "day" for most of the middle of the arc.
  const day = useTransform(sun, (t) => clamp(Math.sin(Math.PI * t) * 1.6));
  return (
    <>
      <div aria-hidden className="absolute inset-0" style={{ background: DUSK_SKY }} />
      <motion.div
        aria-hidden
        className="absolute inset-0"
        style={{ background: DAY_SKY, opacity: day }}
      />
    </>
  );
}

function Stars({ sun }: { sun: MotionValue<number> }) {
  // Only within about the first and last 50 minutes of daylight.
  const night = useTransform(
    sun,
    (t) => clamp(1 - Math.sin(Math.PI * t) / 0.2) * 0.7,
  );
  return (
    <motion.g style={{ opacity: night }}>
      {STARS.map(([x, y, r]) => (
        <circle
          key={`${x}-${y}`}
          cx={x}
          cy={y}
          r={r}
          // Starlight is white against the violet dusk in either theme.
          fill="oklch(1 0 0)"
        />
      ))}
    </motion.g>
  );
}

function Sun({ sun }: { sun: MotionValue<number> }) {
  const cx = useTransform(sun, (t) =>
    r2(ARC.x - ARC.r * Math.cos(Math.PI * t)),
  );
  const cy = useTransform(sun, (t) =>
    r2(ARC.y - ARC.r * Math.sin(Math.PI * t)),
  );
  // Low sun burns orange, high sun turns pale gold, as real light does.
  const high = useTransform(sun, (t) => clamp(Math.sin(Math.PI * t) * 2.2));
  const glowId = useId();
  return (
    <>
      <defs>
        <radialGradient id={glowId}>
          <stop offset="0.3" stopColor={SUN_GLOW} stopOpacity={0.55} />
          <stop offset="1" stopColor={SUN_GLOW} stopOpacity={0} />
        </radialGradient>
      </defs>
      <motion.circle cx={cx} cy={cy} r={42} fill={`url(#${glowId})`} />
      {/* A grab ring that shows while the sun is held. */}
      <motion.circle
        cx={cx}
        cy={cy}
        r={22}
        fill="none"
        strokeWidth={1.5}
        className="stroke-foreground/25 opacity-0 transition-opacity duration-150 ease-out group-data-dragging:opacity-100"
      />
      <motion.circle cx={cx} cy={cy} r={14} fill={SUN_LOW} />
      <motion.circle cx={cx} cy={cy} r={14} fill={SUN_HIGH} style={{ opacity: high }} />
    </>
  );
}

function Dial({ sun }: { sun: MotionValue<number> }) {
  const shadow = useTransform(sun, (t) => {
    const minutes = START + t * (END - START);
    const psi = shadowAngle(minutes);
    // Visual sun altitude peaks at 70 degrees, a summer noon at 40 N.
    const alt = Math.max(Math.sin(Math.PI * t) * 70, 4) * (Math.PI / 180);
    const k = Math.min(SHADOW_MIN + SHADOW_GROWTH / Math.tan(alt), 1.02);
    const tip = onDial(psi, k);
    // Tapers from the gnomon's width to a soft point.
    const nx = Math.cos(psi) * 4;
    const ny = -Math.sin(psi) * 4 * (DIAL.ry / DIAL.rx);
    return `M${r2(DIAL.x + nx)} ${r2(DIAL.y + ny)}L${tip.x} ${tip.y}L${r2(DIAL.x - nx)} ${r2(DIAL.y - ny)}Z`;
  });
  // A sun on the horizon casts almost nothing; keep a trace so the dial
  // still reads the time.
  const strength = useTransform(
    sun,
    (t) => 0.3 + 0.7 * clamp(Math.sin(Math.PI * t) * 3),
  );

  return (
    <g>
      {/* Contact shadow on the terrace, then the plate's edge, then its
          face: three ellipses give the bronze real thickness. */}
      <ellipse cx={DIAL.x} cy={DIAL.y + 9} rx={DIAL.rx + 6} ry={DIAL.ry + 3} fill="oklch(0 0 0 / 0.14)" />
      <ellipse cx={DIAL.x} cy={DIAL.y + 5} rx={DIAL.rx} ry={DIAL.ry} fill={BRONZE_EDGE} />
      <ellipse cx={DIAL.x} cy={DIAL.y} rx={DIAL.rx} ry={DIAL.ry} fill={BRONZE} />
      <ellipse
        cx={DIAL.x}
        cy={DIAL.y}
        rx={DIAL.rx * 0.82}
        ry={DIAL.ry * 0.82}
        fill="none"
        stroke={ENGRAVE}
        strokeOpacity={0.45}
      />
      {HOURS.map((h) => {
        const psi = shadowAngle(h * 60);
        const a = onDial(psi, 0.3);
        const b = onDial(psi, 0.82);
        const major = h % 2 === 0;
        const l = onDial(psi, 0.92);
        return (
          <g key={h}>
            <line
              x1={a.x}
              y1={a.y}
              x2={b.x}
              y2={b.y}
              stroke={ENGRAVE}
              strokeOpacity={major ? 0.75 : 0.35}
            />
            {major && (
              <text
                x={l.x}
                y={l.y}
                textAnchor="middle"
                dominantBaseline="central"
                fontSize={12}
                fontWeight={600}
                fill={ENGRAVE}
                className="font-serif"
              >
                {ROMAN[h % 12]}
              </text>
            )}
          </g>
        );
      })}
      <motion.path
        d={shadow}
        // A shadow is dark in either theme.
        fill="oklch(0.22 0.03 55 / 0.6)"
        style={{ opacity: strength }}
      />
      {/* Gnomon: a thin blade with its lit face and a darker side. */}
      <path
        d={`M${DIAL.x - 2} ${DIAL.y + 3}L${DIAL.x} ${DIAL.y - 30}L${DIAL.x + 2} ${DIAL.y + 3}Z`}
        fill={BRONZE_EDGE}
      />
      <path
        d={`M${DIAL.x} ${DIAL.y - 30}L${DIAL.x + 2} ${DIAL.y + 3}L${DIAL.x + 5} ${DIAL.y + 1}Z`}
        fill="oklch(0.82 0.08 80)"
      />
    </g>
  );
}

export default function SundialPickerDemo() {
  const [minutes, setMinutes] = useState(14 * 60 + 15);
  return (
    <SundialPicker label="Pickup time" value={minutes} onChange={setMinutes} />
  );
}
