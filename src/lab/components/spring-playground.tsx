import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  animate,
  motion,
  useMotionValue,
  useTransform,
  type AnimationPlaybackControls,
} from "motion/react";
import { useReducedMotion } from "@/lib/use-reduced-motion";
import { cn } from "@/lib/cn";

type Mode = "physics" | "perceptual";
type Physics = { stiffness: number; damping: number; mass: number };
type Perceptual = { visualDuration: number; bounce: number };

const BALL = 40;
// A release faster than this (px per second) counts as a throw toward that
// side; anything slower settles on whichever end is closer.
const THROW_VELOCITY = 400;
// How far the ball can be pulled past either end before it stops giving.
const MAX_STRETCH = 32;
// Motion ends a spring once it is within 0.5px of the target and moving
// slower than 2px/s (its defaults for anything travelling 5px or more).
// Using the same rule makes the settle time here match the real animation.
const REST_DELTA = 0.5;
const REST_SPEED = 2;
const SIM_STEP = 1 / 1000;
const SIM_LIMIT = 10;
// Waits for a slider to rest before replaying, so dragging one doesn't
// restart the ball on every tick.
const REPLAY_DELAY = 250;
const PLOT_HEIGHT = 136;
const PAD = { top: 12, right: 12, bottom: 26, left: 12 };
// From rest, a spring toward 1 never dips below 0, so the floor is fixed.
const PLOT_FLOOR = -0.1;
const AXIS_STEPS = [0.5, 1, 1.5, 2, 3, 4, 6, 10];
const ICON_SWAP = { type: "spring", duration: 0.3, bounce: 0 } as const;

const PRESETS: { name: string; use: string; physics: Physics }[] = [
  {
    name: "Snappy UI",
    use: "Menus, toggles, anything clicked all day. Fast and never overshoots.",
    physics: { stiffness: 500, damping: 45, mass: 1 },
  },
  {
    name: "Gentle",
    use: "Larger surfaces easing into place, like panels and sheets.",
    physics: { stiffness: 120, damping: 22, mass: 1 },
  },
  {
    name: "Bouncy",
    use: "Playful moments and drag releases. Use sparingly: bounce pulls the eye.",
    physics: { stiffness: 400, damping: 20, mass: 1 },
  },
  {
    name: "Sluggish",
    use: "What to avoid. Overdamped and slow, so the UI seems to lag behind you.",
    physics: { stiffness: 80, damping: 30, mass: 1 },
  },
];

// The exact conversion Motion applies to visualDuration and bounce.
function toPhysics({ visualDuration, bounce }: Perceptual): Physics {
  const root = (2 * Math.PI) / (visualDuration * 1.2);
  const stiffness = root * root;
  const ratio = Math.min(Math.max(1 - bounce, 0.05), 1);
  return { stiffness, damping: 2 * ratio * Math.sqrt(stiffness), mass: 1 };
}

// The inverse. Lossy past critical damping: bounce can't go below zero, so
// an overdamped spring comes back as the critically damped one.
function toPerceptual({ stiffness, damping, mass }: Physics): Perceptual {
  const natural = Math.sqrt(stiffness / mass);
  return {
    visualDuration: clamp(roundTo((2 * Math.PI) / (1.2 * natural), 0.05), 0.1, 1.5),
    bounce: clamp(roundTo(1 - dampingRatio({ stiffness, damping, mass }), 0.05), 0, 0.9),
  };
}

function dampingRatio({ stiffness, damping, mass }: Physics) {
  return damping / (2 * Math.sqrt(stiffness * mass));
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function roundTo(value: number, step: number) {
  return Number((Math.round(value / step) * step).toFixed(4));
}

function format(value: number, decimals: number) {
  return Number(value.toFixed(decimals)).toString();
}

// Steps the spring equation forward 1ms at a time (semi-implicit Euler),
// independently of Motion, so the curve is a second opinion rather than a
// recording of the animation.
function simulate({ stiffness, damping, mass }: Physics, distance: number) {
  const samples: number[] = [];
  let x = 0;
  let v = 0;
  let peak = 0;
  let settle: number | null = null;
  for (let i = 1; i <= SIM_LIMIT / SIM_STEP; i++) {
    const a = (-stiffness * (x - 1) - damping * v) / mass;
    v += a * SIM_STEP;
    x += v * SIM_STEP;
    peak = Math.max(peak, x);
    samples.push(x);
    if (
      Math.abs(1 - x) * distance <= REST_DELTA &&
      Math.abs(v) * distance <= REST_SPEED
    ) {
      settle = i * SIM_STEP;
      break;
    }
  }
  return { samples, peak, settle };
}

function tickStep(axis: number) {
  if (axis <= 1) return 0.25;
  if (axis <= 2) return 0.5;
  if (axis <= 4) return 1;
  return 2;
}

export function SpringPlayground({ className }: { className?: string }) {
  const reduceMotion = useReducedMotion();
  const [mode, setMode] = useState<Mode>("physics");
  const [physics, setPhysics] = useState<Physics>(PRESETS[0].physics);
  const [perceptual, setPerceptual] = useState<Perceptual>(() =>
    toPerceptual(PRESETS[0].physics),
  );
  const spring = useMemo(
    () => (mode === "physics" ? physics : toPhysics(perceptual)),
    [mode, physics, perceptual],
  );

  const trackRef = useRef<HTMLDivElement>(null);
  const [trackWidth, setTrackWidth] = useState(520);
  const travel = Math.max(trackWidth - BALL, 1);

  const sim = useMemo(() => simulate(spring, travel), [spring, travel]);

  const plot = useMemo(() => {
    const axis =
      AXIS_STEPS.find((s) => s >= (sim.settle ?? SIM_LIMIT) * 1.15) ?? SIM_LIMIT;
    // Headroom above the target grows with the overshoot, capped so a wild
    // spring can't flatten the rest of the curve.
    const top = Math.min(Math.max(1.25, sim.peak + 0.1), 2.2);
    const width = trackWidth;
    const innerH = PLOT_HEIGHT - PAD.top - PAD.bottom;
    const sx = (width - PAD.left - PAD.right) / axis;
    const y = (p: number) =>
      PAD.top + ((top - p) / (top - PLOT_FLOOR)) * innerH;
    let d = `M${PAD.left},${y(0)}`;
    // A point every 4ms is finer than a pixel at any axis length here.
    for (let i = 3; i < sim.samples.length; i += 4) {
      const t = (i + 1) * SIM_STEP;
      if (t > axis) break;
      d += `L${(PAD.left + t * sx).toFixed(1)},${y(sim.samples[i]).toFixed(1)}`;
    }
    // Motion snaps to the target once at rest, so the line goes flat there.
    if (sim.settle !== null) {
      d += `L${(PAD.left + axis * sx).toFixed(1)},${y(1).toFixed(1)}`;
    }
    const step = tickStep(axis);
    const ticks = Array.from(
      { length: Math.floor(axis / step + 1e-6) + 1 },
      (_, i) => i * step,
    );
    return { axis, width, sx, y, d, ticks, top };
  }, [sim, trackWidth]);

  const x = useMotionValue(0);
  const time = useMotionValue(0);
  const headOpacity = useMotionValue(0);
  const side = useRef<0 | 1>(0);
  const controls = useRef<AnimationPlaybackControls[]>([]);
  const dragging = useRef<{ offset: number } | null>(null);
  const [release, setRelease] = useState<number | null>(null);

  // Everything the per-frame callbacks read lives in one ref, refreshed
  // after each render, so following the ball never re-renders React.
  const live = useRef({ spring, settle: sim.settle, plot, travel, from: 0, to: 1 });
  useLayoutEffect(() => {
    Object.assign(live.current, { spring, settle: sim.settle, plot, travel });
  });

  const headX = useTransform(time, (t) => PAD.left + t * live.current.plot.sx);
  const headY = useTransform(x, (v) => {
    const l = live.current;
    return l.plot.y((v - l.from) / (l.to - l.from || 1));
  });

  const stopAll = () => {
    controls.current.forEach((c) => c.stop());
    controls.current = [];
  };

  const run = (target: 0 | 1, velocity?: number) => {
    stopAll();
    const l = live.current;
    const from = x.get();
    const to = target === 1 ? l.travel : 0;
    const atRest = velocity === undefined && Math.abs(x.getVelocity()) < 1;
    side.current = target;
    l.from = from;
    l.to = to;
    // Always physics values, even in perceptual mode: Motion discards the
    // release velocity for visualDuration springs, and carrying it is the
    // whole point of a throw.
    controls.current.push(
      animate(x, to, {
        type: "spring",
        ...l.spring,
        ...(velocity !== undefined && { velocity }),
      }),
    );
    // The playhead only means something for a start from rest, which is
    // what the curve plots.
    if (atRest && Math.abs(to - from) > 1) {
      const settle = l.settle ?? SIM_LIMIT;
      headOpacity.set(1);
      time.set(0);
      controls.current.push(
        animate(time, settle, { duration: settle, ease: "linear" }),
      );
    } else {
      headOpacity.set(0);
    }
  };

  const play = () => {
    setRelease(null);
    run(side.current === 0 ? 1 : 0);
  };

  const playRef = useRef(play);
  useLayoutEffect(() => {
    playRef.current = play;
  });

  // Replays whenever the spring changes, once the control comes to rest.
  // Skipped on mount and under reduced motion, where only Play moves it.
  const key = `${spring.stiffness}|${spring.damping}|${spring.mass}`;
  const lastKey = useRef(key);
  useEffect(() => {
    if (lastKey.current === key || reduceMotion) return;
    lastKey.current = key;
    const id = setTimeout(() => playRef.current(), REPLAY_DELAY);
    return () => clearTimeout(id);
  }, [key, reduceMotion]);

  useEffect(() => {
    const el = trackRef.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      setTrackWidth(Math.round(entry.contentRect.width));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Keeps the ball parked on its end when the stage resizes.
  useEffect(() => {
    if (dragging.current) return;
    controls.current.forEach((c) => c.stop());
    controls.current = [];
    x.jump(side.current === 1 ? travel : 0);
    headOpacity.set(0);
  }, [travel, x, headOpacity]);

  useEffect(() => () => controls.current.forEach((c) => c.stop()), []);

  const resist = (value: number) => {
    const past = value < 0 ? value : value > travel ? value - travel : 0;
    return (
      clamp(value, 0, travel) +
      MAX_STRETCH * Math.tanh(past / (MAX_STRETCH * 3))
    );
  };

  const switchMode = (next: Mode) => {
    if (next === mode) return;
    if (next === "perceptual") setPerceptual(toPerceptual(physics));
    else {
      const p = toPhysics(perceptual);
      setPhysics({
        stiffness: Math.round(p.stiffness),
        damping: roundTo(p.damping, 0.5),
        mass: 1,
      });
    }
    setMode(next);
  };

  const activePreset = PRESETS.findIndex((p) => {
    if (mode === "physics") {
      return (
        p.physics.stiffness === physics.stiffness &&
        p.physics.damping === physics.damping &&
        p.physics.mass === physics.mass
      );
    }
    const q = toPerceptual(p.physics);
    return (
      q.visualDuration === perceptual.visualDuration &&
      q.bounce === perceptual.bounce
    );
  });

  const ratio = dampingRatio(spring);
  const behaviour =
    Math.abs(ratio - 1) < 0.02
      ? "Critically damped"
      : ratio < 1
        ? "Underdamped"
        : "Overdamped";
  const overshoot = Math.max(0, sim.peak - 1) * 100;
  const settleText =
    sim.settle === null ? "Over 10s" : `${format(sim.settle, 2)}s`;
  // Hovering or focusing a preset previews its description in place.
  const [previewPreset, setPreviewPreset] = useState<number | null>(null);
  const described = previewPreset ?? activePreset;
  const presetUseId = useId();

  const code =
    mode === "physics"
      ? `{ type: "spring", stiffness: ${physics.stiffness}, damping: ${physics.damping}${physics.mass !== 1 ? `, mass: ${physics.mass}` : ""} }`
      : `{ type: "spring", visualDuration: ${format(perceptual.visualDuration, 2)}, bounce: ${format(perceptual.bounce, 2)} }`;

  const equivalent = toPerceptual(physics);
  const note =
    mode === "physics"
      ? ratio > 1.02
        ? `Too damped to express as bounce. The nearest perceptual spring is visualDuration ${format(equivalent.visualDuration, 2)}, bounce 0.`
        : `Roughly visualDuration ${format(equivalent.visualDuration, 2)}, bounce ${format(equivalent.bounce, 2)} in perceptual terms.`
      : `Motion runs this as stiffness ${format(spring.stiffness, 0)}, damping ${format(spring.damping, 1)}. It ignores release velocity for duration-based springs, so throws here use those numbers.`;

  const { axis, width, sx, y, d, ticks } = plot;
  const bottom = PLOT_HEIGHT - PAD.bottom;

  return (
    <div
      className={cn(
        // 12px inner panels plus 8px of padding keep the corners concentric.
        "flex w-[min(600px,100%)] flex-col gap-2 rounded-[20px] bg-surface p-2 text-foreground shadow-raised",
        className,
      )}
    >
      <section className="rounded-xl bg-background p-3.5" aria-label="Preview">
        <div className="mb-2 flex items-center justify-between gap-3">
          {/* Two lines reserved on phones, where the release text wraps. */}
          <p className="flex min-h-10 min-w-0 items-center text-[13px] leading-5 text-muted sm:min-h-5">
            {release === null
              ? "Drag the ball and let go, or press Play."
              : `Let go at ${Math.abs(release).toLocaleString("en-US")} px/s. The spring started from that speed.`}
          </p>
          <button
            type="button"
            onClick={play}
            className="flex h-9 shrink-0 items-center gap-1.5 rounded-full bg-foreground pr-4 pl-3 text-sm font-medium text-background outline-hidden transition-[scale] duration-150 ease-out select-none focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-foreground active:scale-[0.96] motion-reduce:transition-none"
          >
            {/* Nudged right: a triangle's visual center sits left of its box. */}
            <svg viewBox="0 0 16 16" className="size-4 translate-x-px" fill="currentColor" aria-hidden>
              <path d="M5 3.6v8.8a.6.6 0 0 0 .9.5l7-4.4a.6.6 0 0 0 0-1l-7-4.4a.6.6 0 0 0-.9.5Z" />
            </svg>
            Play
          </button>
        </div>

        <div className="relative rounded-full bg-surface p-1">
          <div aria-hidden className="pointer-events-none absolute inset-1 flex justify-between">
            <span className="size-10 rounded-full border border-dashed border-muted/50" />
            <span className="size-10 rounded-full border border-dashed border-muted/50" />
          </div>
          <div ref={trackRef} className="relative h-10">
            <motion.div
              aria-hidden
              style={{ x }}
              className="absolute top-0 left-0 size-10 cursor-grab touch-none rounded-full bg-foreground shadow-raised active:cursor-grabbing"
              onPointerDown={(e) => {
                if (e.button !== 0 || dragging.current || !trackRef.current) return;
                stopAll();
                headOpacity.set(0);
                e.currentTarget.setPointerCapture(e.pointerId);
                const box = trackRef.current.getBoundingClientRect();
                dragging.current = { offset: e.clientX - box.left - x.get() };
              }}
              onPointerMove={(e) => {
                if (!dragging.current || !trackRef.current) return;
                const box = trackRef.current.getBoundingClientRect();
                x.set(resist(e.clientX - box.left - dragging.current.offset));
              }}
              onPointerUp={() => {
                if (!dragging.current) return;
                dragging.current = null;
                const velocity = Math.round(x.getVelocity());
                const target: 0 | 1 =
                  velocity > THROW_VELOCITY
                    ? 1
                    : velocity < -THROW_VELOCITY
                      ? 0
                      : x.get() > travel / 2
                        ? 1
                        : 0;
                setRelease(velocity);
                run(target, velocity);
              }}
              onPointerCancel={() => {
                if (!dragging.current) return;
                dragging.current = null;
                run(x.get() > travel / 2 ? 1 : 0, 0);
              }}
            />
          </div>
        </div>

        <figure className="mt-3">
          <svg
            width={width}
            height={PLOT_HEIGHT}
            viewBox={`0 0 ${width} ${PLOT_HEIGHT}`}
            className="block max-w-full overflow-visible"
            role="img"
            aria-label={`Spring curve. ${overshoot < 0.5 ? "No overshoot" : `Overshoots by ${format(overshoot, 0)} percent`}, ${sim.settle === null ? "still moving after 10 seconds" : `settles in ${format(sim.settle, 2)} seconds`}.`}
          >
            {ticks.map((t) => (
              <g key={t}>
                <line x1={PAD.left + t * sx} x2={PAD.left + t * sx} y1={PAD.top} y2={bottom} className="stroke-border" />
                <text
                  x={PAD.left + t * sx}
                  y={PLOT_HEIGHT - 6}
                  textAnchor={t === 0 ? "start" : t >= axis - 1e-6 ? "end" : "middle"}
                  className="fill-muted text-[12px] tabular-nums"
                >
                  {format(t, 2)}s
                </text>
              </g>
            ))}
            <line x1={PAD.left} x2={width - PAD.right} y1={y(0)} y2={y(0)} className="stroke-border" />
            <line x1={PAD.left} x2={width - PAD.right} y1={y(1)} y2={y(1)} className="stroke-muted" strokeDasharray="3 4" />
            <text x={width - PAD.right} y={y(1) - 6} textAnchor="end" className="fill-muted text-[12px]">
              target
            </text>
            {/* Bottom right is always empty: every curve has reached the
                target by then. The halo keeps the settle marker off the text. */}
            <text
              x={width - PAD.right}
              y={y(0) - 6}
              textAnchor="end"
              paintOrder="stroke"
              strokeWidth={4}
              strokeLinejoin="round"
              className="fill-muted stroke-background text-[12px]"
            >
              Position over time, from rest
            </text>
            {sim.settle !== null && (
              <line
                x1={PAD.left + sim.settle * sx}
                x2={PAD.left + sim.settle * sx}
                y1={PAD.top}
                y2={bottom}
                className="stroke-foreground/50"
                strokeDasharray="2 3"
              />
            )}
            <path d={d} fill="none" className="stroke-foreground" strokeWidth={2} strokeLinejoin="round" />
            <motion.circle
              r={5}
              cx={headX}
              cy={headY}
              style={{ opacity: headOpacity }}
              className="fill-foreground stroke-background"
              strokeWidth={2}
            />
          </svg>
          <dl className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="Settles" value={settleText} />
            <Stat label="Overshoot" value={overshoot < 0.5 ? "None" : `${format(overshoot, 0)}%`} />
            <Stat label="Damping ratio" value={format(ratio, 2)} />
            <Stat label="Behaviour" value={behaviour} />
          </dl>
        </figure>
      </section>

      <section className="rounded-xl bg-background p-3.5" aria-label="Spring settings">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div role="group" aria-label="Presets" className="flex flex-wrap gap-1">
            {PRESETS.map((p, i) => (
              <button
                key={p.name}
                type="button"
                aria-pressed={activePreset === i}
                aria-describedby={presetUseId}
                onClick={() =>
                  mode === "physics"
                    ? setPhysics(p.physics)
                    : setPerceptual(toPerceptual(p.physics))
                }
                onPointerEnter={(e) => e.pointerType !== "touch" && setPreviewPreset(i)}
                onPointerLeave={() => setPreviewPreset(null)}
                onFocus={() => setPreviewPreset(i)}
                onBlur={() => setPreviewPreset(null)}
                className={cn(
                  "h-9 rounded-full px-3 text-[13px] font-medium outline-hidden transition-[scale,color,background-color] duration-150 ease-out select-none focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-foreground active:scale-[0.96] motion-reduce:transition-[color,background-color]",
                  activePreset === i
                    ? "bg-surface text-foreground"
                    : "text-muted hover:bg-surface/60 hover:text-foreground",
                )}
              >
                {p.name}
              </button>
            ))}
          </div>
          <ModeToggle mode={mode} onChange={switchMode} />
        </div>
        {/* Two lines reserved on phones so a longer description can't
            push the sliders down. */}
        <p
          id={presetUseId}
          className="mt-2 min-h-10 px-1 text-[13px] leading-5 text-pretty text-muted sm:min-h-5"
        >
          {described === -1
            ? "Custom values. Pick a preset to start from a known spring."
            : PRESETS[described].use}
        </p>
        {/* Phones fit two sliders per row; the fixed height covers the
            three-slider mode so switching modes doesn't change the height. */}
        <div className="mt-3 grid min-h-[180px] grid-cols-2 gap-x-5 gap-y-3 sm:min-h-0 sm:grid-cols-3">
          {mode === "physics" ? (
            <>
              <Range id="stiffness" label="Stiffness" hint="How hard it pulls to the target" min={10} max={1000} step={1} value={physics.stiffness} decimals={0} onChange={(v) => setPhysics((p) => ({ ...p, stiffness: v }))} />
              <Range id="damping" label="Damping" hint="How fast the motion dies out" min={1} max={100} step={0.5} value={physics.damping} decimals={1} onChange={(v) => setPhysics((p) => ({ ...p, damping: v }))} />
              <Range id="mass" label="Mass" hint="Heavier is slower and swings longer" min={0.1} max={5} step={0.1} value={physics.mass} decimals={1} onChange={(v) => setPhysics((p) => ({ ...p, mass: v }))} />
            </>
          ) : (
            <>
              <Range id="visual-duration" label="Visual duration" unit="s" hint="When it looks arrived; any bounce comes after" min={0.1} max={1.5} step={0.05} value={perceptual.visualDuration} decimals={2} onChange={(v) => setPerceptual((p) => ({ ...p, visualDuration: v }))} />
              <Range id="bounce" label="Bounce" hint="0 never overshoots, higher swings more" min={0} max={0.9} step={0.05} value={perceptual.bounce} decimals={2} onChange={(v) => setPerceptual((p) => ({ ...p, bounce: v }))} />
            </>
          )}
        </div>
        {/* Reserved for the longer perceptual note, so switching modes
            keeps the height (four lines on phones). */}
        <p className="mt-3 min-h-20 text-[13px] leading-5 text-pretty text-muted sm:min-h-10">{note}</p>
      </section>

      <div className="flex h-11 items-center gap-2 rounded-xl bg-background pr-1.5 pl-4">
        <code className="min-w-0 flex-1 truncate font-mono text-[13px]">{code}</code>
        <CopyButton value={code} />
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="truncate text-sm tabular-nums">{value}</dd>
    </div>
  );
}

function ModeToggle({
  mode,
  onChange,
}: {
  mode: Mode;
  onChange: (mode: Mode) => void;
}) {
  const options: { id: Mode; label: string }[] = [
    { id: "physics", label: "Physics" },
    { id: "perceptual", label: "Perceptual" },
  ];
  return (
    <div
      role="radiogroup"
      aria-label="Spring parameters"
      className="relative grid h-9 grid-cols-2 rounded-full bg-surface p-1"
      onKeyDown={(e) => {
        if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)) return;
        e.preventDefault();
        const next = mode === "physics" ? "perceptual" : "physics";
        onChange(next);
        e.currentTarget
          .querySelector<HTMLElement>(`[data-mode="${next}"]`)
          ?.focus();
      }}
    >
      <span
        aria-hidden
        className={cn(
          "absolute inset-y-1 left-1 w-[calc(50%-4px)] rounded-full bg-background shadow-raised transition-[translate] duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] motion-reduce:transition-none",
          mode === "perceptual" && "translate-x-full",
        )}
      />
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          role="radio"
          data-mode={o.id}
          aria-checked={mode === o.id}
          tabIndex={mode === o.id ? 0 : -1}
          onClick={() => onChange(o.id)}
          className={cn(
            "relative rounded-full px-3.5 text-[13px] font-medium outline-hidden transition-[color] duration-150 ease-out focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-foreground",
            mode === o.id ? "text-foreground" : "text-muted hover:text-foreground",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Range({
  id,
  label,
  hint,
  unit = "",
  min,
  max,
  step,
  value,
  decimals,
  onChange,
}: {
  id: string;
  label: string;
  hint: string;
  unit?: string;
  min: number;
  max: number;
  step: number;
  value: number;
  decimals: number;
  onChange: (value: number) => void;
}) {
  const uid = `spring-${id}`;
  const fill = ((value - min) / (max - min)) * 100;
  return (
    <div className="flex min-w-0 flex-col">
      <div className="flex items-baseline justify-between gap-2">
        <label htmlFor={uid} className="text-sm font-medium">
          {label}
        </label>
        <output htmlFor={uid} className="text-sm tabular-nums">
          {value.toFixed(decimals)}
          {unit}
        </output>
      </div>
      <input
        id={uid}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        aria-describedby={`${uid}-hint`}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{ "--fill": `${fill}%` } as React.CSSProperties}
        className={cn(
          "h-8 w-full cursor-pointer appearance-none rounded-full bg-transparent outline-hidden focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-foreground",
          // The filled part is a hard color stop at the value, not a blend.
          "[&::-webkit-slider-runnable-track]:h-1 [&::-webkit-slider-runnable-track]:rounded-full [&::-webkit-slider-runnable-track]:bg-[linear-gradient(to_right,var(--foreground)_var(--fill),var(--border)_var(--fill))]",
          "[&::-moz-range-track]:h-1 [&::-moz-range-track]:rounded-full [&::-moz-range-track]:bg-[linear-gradient(to_right,var(--foreground)_var(--fill),var(--border)_var(--fill))]",
          // -6px centers the 16px thumb on the 4px track.
          "[&::-webkit-slider-thumb]:-mt-1.5 [&::-webkit-slider-thumb]:size-4 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-background [&::-webkit-slider-thumb]:shadow-raised",
          "[&::-moz-range-thumb]:size-4 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:bg-background [&::-moz-range-thumb]:shadow-raised",
        )}
      />
      <span id={`${uid}-hint`} className="text-xs leading-4 text-muted">
        {hint}
      </span>
    </div>
  );
}

function CopyButton({ value }: { value: string }) {
  const reduceMotion = useReducedMotion();
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  const copy = async () => {
    setCopied(true);
    clearTimeout(timer.current);
    // Long enough to notice the check, short enough to copy again soon.
    timer.current = setTimeout(() => setCopied(false), 1600);
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      clearTimeout(timer.current);
      setCopied(false);
    }
  };

  const hidden = reduceMotion
    ? { opacity: 0 }
    : { scale: 0.25, opacity: 0, filter: "blur(4px)" };
  const shown = { scale: 1, opacity: 1, filter: "blur(0px)" };

  return (
    <button
      type="button"
      aria-label="Copy config"
      onClick={copy}
      className="relative flex size-8 shrink-0 items-center justify-center rounded-full text-muted outline-hidden transition-[scale,color,background-color] duration-150 ease-out select-none after:absolute after:-inset-1 hover:bg-surface hover:text-foreground focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-foreground active:scale-[0.96]"
    >
      <span className="grid" aria-hidden>
        <motion.svg viewBox="0 0 16 16" className="col-start-1 row-start-1 size-4" {...STROKE} initial={false} animate={copied ? hidden : shown} transition={ICON_SWAP}>
          <rect x="5.25" y="5.25" width="8" height="8" rx="1.75" />
          <path d="M10.75 5.25V4.5a1.75 1.75 0 0 0-1.75-1.75H4.5A1.75 1.75 0 0 0 2.75 4.5V9a1.75 1.75 0 0 0 1.75 1.75h.75" />
        </motion.svg>
        <motion.svg viewBox="0 0 16 16" className="col-start-1 row-start-1 size-4 text-foreground" {...STROKE} initial={false} animate={copied ? shown : hidden} transition={ICON_SWAP}>
          <path d="m3.5 8.5 3 3 6-7" />
        </motion.svg>
      </span>
      <span className="sr-only" aria-live="polite">
        {copied ? "Copied" : ""}
      </span>
    </button>
  );
}

const STROKE = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.5,
  strokeLinecap: "round",
  strokeLinejoin: "round",
} as const;

export default function SpringPlaygroundDemo() {
  return <SpringPlayground />;
}
