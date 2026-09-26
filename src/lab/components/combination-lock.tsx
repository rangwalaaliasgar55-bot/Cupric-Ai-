import { memo, useEffect, useId, useRef, useState } from "react";
import {
  animate,
  motion,
  useMotionValue,
  useMotionValueEvent,
  useTransform,
} from "motion/react";
import { useReducedMotion } from "@/lib/use-reduced-motion";
import { cn } from "@/lib/cn";

const NUMBERS = 40;
const STEP = 360 / NUMBERS;
const SIZE = 260;
const C = SIZE / 2;
// Right, left, right: each direction change locks in the number before it.
const EXPECT = [1, -1, 1] as const;
const ORDINAL = ["first", "second", "third"];
// Pointer this close to the centre gives a meaningless angle, so it's ignored.
const DEAD_ZONE = 12;
// Snaps a released dial onto the nearest number, carrying the hand's speed.
const SETTLE = { type: "spring", stiffness: 600, damping: 40 } as const;
// A heavy bolt: it swings open with a touch of overshoot, then stops.
const THROW = { type: "spring", stiffness: 260, damping: 22 } as const;
const EASE_OUT = [0.23, 1, 0.32, 1] as const;

type Lock = { slots: (number | null)[]; index: number; progressed: boolean; live: number | null };

const emptyLock = (): Lock => ({ slots: [null, null, null], index: 0, progressed: false, live: null });

function mod(n: number, m: number) {
  return ((n % m) + m) % m;
}

// Rounded to a hundredth: the server and the browser disagree on the last
// float digits of sin and cos, which is a hydration mismatch otherwise.
const round = (v: number) => Math.round(v * 100) / 100;

function polar(radius: number, degrees: number) {
  const a = (degrees * Math.PI) / 180;
  return [
    round(C + radius * Math.sin(a)),
    round(C - radius * Math.cos(a)),
  ] as const;
}

// Numbers are printed clockwise, so turning right brings smaller ones to
// the index, as on a real lock.
const numberAt = (step: number) => mod(-step, NUMBERS);

// Holds the dial in each detent: the cubic stays flat near a number and
// hurries across the gap between two, so a drag clicks from one to the next.
function detented(theta: number) {
  const s = Math.round(theta / STEP);
  const f = theta / STEP - s;
  return (s + 4 * f * f * f) * STEP;
}

export function CombinationLock({
  code,
  onOpen,
  className,
}: {
  code: [number, number, number];
  onOpen?: () => void;
  className?: string;
}) {
  const id = useId();
  const reduceMotion = useReducedMotion();
  const theta = useMotionValue(0);
  const shown = useTransform(theta, detented);
  const handle = useMotionValue(0);

  const [lock, setLock] = useState<Lock>(emptyLock);
  const [current, setCurrent] = useState(0);
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("");

  const lockRef = useRef<Lock>(lock);
  const openRef = useRef(false);
  const lastStep = useRef(0);
  const keyTarget = useRef(0);
  const keyAnim = useRef(false);
  const dialAnim = useRef<ReturnType<typeof animate> | null>(null);
  const handleAnim = useRef<ReturnType<typeof animate> | null>(null);
  const grab = useRef<{ id: number; last: number } | null>(null);
  const indexRef = useRef<SVGPathElement>(null);
  const slotsRef = useRef<HTMLDivElement>(null);

  useEffect(
    () => () => {
      dialAnim.current?.stop();
      handleAnim.current?.stop();
    },
    [],
  );

  const publish = (next: Lock) => {
    lockRef.current = next;
    setLock(next);
  };

  const click = () => {
    if (reduceMotion) return;
    indexRef.current?.animate(
      [{ transform: "translateY(0)" }, { transform: "translateY(1.5px)" }, { transform: "translateY(0)" }],
      { duration: 90, easing: "cubic-bezier(0.23, 1, 0.32, 1)" },
    );
  };

  const onStep = (dir: number, step: number) => {
    click();
    if (openRef.current) return;
    const L = lockRef.current;
    if (L.index > 2) return;
    const number = numberAt(step);
    if (dir === EXPECT[L.index]) {
      publish({ ...L, progressed: true, live: number });
    } else if (L.progressed) {
      const slots = L.slots.slice();
      slots[L.index] = numberAt(step - dir);
      const index = L.index + 1;
      setMessage(`${ORDINAL[L.index]} number ${slots[L.index]} set`);
      publish(
        index > 2
          ? { slots, index, progressed: false, live: null }
          : { slots, index, progressed: true, live: number },
      );
    }
  };

  useMotionValueEvent(theta, "change", (t) => {
    const s = Math.round(t / STEP);
    if (s === lastStep.current) return;
    while (lastStep.current !== s) {
      const dir = Math.sign(s - lastStep.current);
      lastStep.current += dir;
      onStep(dir, lastStep.current);
    }
    setCurrent(numberAt(s));
  });

  const commitCurrent = () => {
    const L = lockRef.current;
    if (L.index > 2) return;
    const slots = L.slots.slice();
    slots[L.index] = numberAt(lastStep.current);
    setMessage(`${ORDINAL[L.index]} number ${slots[L.index]} set`);
    publish({ slots, index: L.index + 1, progressed: false, live: null });
  };

  const reset = () => {
    publish(emptyLock());
  };

  const turnHandle = (to: number, transition: object) => {
    handleAnim.current?.stop();
    if (reduceMotion) {
      handle.jump(to);
      return;
    }
    handleAnim.current = animate(handle, to, transition);
  };

  const jiggle = () => {
    handleAnim.current?.stop();
    if (reduceMotion) return;
    // The bolt catches almost at once: a short shove, then it springs back.
    handleAnim.current = animate(handle, [handle.get(), 12, 0], {
      duration: 0.32,
      times: [0, 0.3, 1],
      ease: [EASE_OUT, [0.34, 1.4, 0.64, 1]],
    });
  };

  const tryOpen = () => {
    if (openRef.current) {
      openRef.current = false;
      setOpen(false);
      setMessage("Locked");
      turnHandle(0, THROW);
      reset();
      return;
    }
    let L = lockRef.current;
    // Turning the handle on the third number counts as entering it.
    if (L.index === 2 && L.progressed && L.live !== null) {
      const slots = L.slots.slice();
      slots[2] = L.live;
      L = { slots, index: 3, progressed: false, live: null };
      publish(L);
    }
    if (L.index < 3) {
      jiggle();
      return;
    }
    if (L.slots.every((n, i) => n === code[i])) {
      openRef.current = true;
      setOpen(true);
      setMessage("Open");
      turnHandle(90, THROW);
      onOpen?.();
      return;
    }
    jiggle();
    setMessage("Wrong combination, start again");
    if (!reduceMotion) {
      slotsRef.current?.animate(
        [
          { transform: "translateX(0)" },
          { transform: "translateX(-6px)" },
          { transform: "translateX(5px)" },
          { transform: "translateX(-3px)" },
          { transform: "translateX(0)" },
        ],
        { duration: 320, easing: "ease-out" },
      );
    }
    reset();
  };

  const local = (e: React.PointerEvent<HTMLElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    const scale = SIZE / box.width;
    const x = (e.clientX - box.left) * scale - C;
    const y = (e.clientY - box.top) * scale - C;
    return { angle: (Math.atan2(x, -y) * 180) / Math.PI, r: Math.hypot(x, y) };
  };

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || grab.current) return;
    const { angle, r } = local(e);
    if (r > C) return;
    dialAnim.current?.stop();
    keyAnim.current = false;
    e.currentTarget.setPointerCapture(e.pointerId);
    grab.current = { id: e.pointerId, last: angle };
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const g = grab.current;
    if (!g || e.pointerId !== g.id) return;
    const { angle, r } = local(e);
    if (r < DEAD_ZONE) return;
    let delta = angle - g.last;
    if (delta > 180) delta -= 360;
    if (delta < -180) delta += 360;
    g.last = angle;
    theta.set(theta.get() + delta);
  };

  const onPointerEnd = (e: React.PointerEvent<HTMLDivElement>) => {
    const g = grab.current;
    if (!g || e.pointerId !== g.id) return;
    grab.current = null;
    const velocity = theta.getVelocity();
    const snap = (v: number) => Math.round(v / STEP) * STEP;
    if (reduceMotion) {
      theta.jump(snap(theta.get()));
      return;
    }
    // A flick spins on and settles into a number; a slow release just drops
    // into the nearest detent.
    dialAnim.current =
      Math.abs(velocity) > 90
        ? animate(theta, theta.get(), {
            type: "inertia",
            velocity,
            power: 0.3,
            timeConstant: 200,
            modifyTarget: snap,
          })
        : animate(theta, snap(theta.get()), { ...SETTLE, velocity });
  };

  const turn = (steps: number) => {
    const running = keyAnim.current && dialAnim.current?.state === "running";
    // Rapid presses stack onto where the last one was heading.
    const base = running ? keyTarget.current : Math.round(theta.get() / STEP) * STEP;
    keyTarget.current = base + steps * STEP;
    dialAnim.current?.stop();
    if (reduceMotion) theta.jump(keyTarget.current);
    else {
      dialAnim.current = animate(theta, keyTarget.current, SETTLE);
      keyAnim.current = true;
    }
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const steps = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1, PageDown: 5, PageUp: -5 }[e.key];
    if (steps !== undefined) {
      e.preventDefault();
      turn(steps);
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (lockRef.current.index > 2 || openRef.current) tryOpen();
      else commitCurrent();
    } else if (e.key === "Escape") {
      reset();
    }
  };

  const status = open
    ? "Open. Turn the handle to lock."
    : lock.index > 2
      ? "Turn the handle"
      : `Turn ${EXPECT[lock.index] === 1 ? "right" : "left"} to the ${ORDINAL[lock.index]} number`;

  return (
    <div className={cn("flex w-[452px] max-w-full flex-col items-center gap-6", className)}>
      {/* The safe door. The wrapper leaves 12px on the right for the bolts
          that stick out of its edge while it is locked. */}
      <div className="relative w-full pr-3">
        {/* Steel bolts are a physical material, so they are raw colors in
            both themes. They sit under the door and slide back into it
            when the right combination turns the handle. */}
        {[0.24, 0.5, 0.76].map((at, i) => (
          <span
            key={at}
            aria-hidden
            className="absolute right-0 h-4 w-8 -translate-y-1/2 rounded-r-[4px] shadow-[0_1px_2px_oklch(0_0_0/0.3)] transition-transform duration-300 ease-[cubic-bezier(0.77,0,0.175,1)] motion-reduce:transition-none"
            style={{
              top: `${at * 100}%`,
              background:
                "linear-gradient(to bottom, oklch(0.9 0.005 250), oklch(0.68 0.01 250) 55%, oklch(0.6 0.01 250))",
              // 18px pulls the whole visible stub back under the door.
              transform: open ? "translate(-18px, -50%)" : "translate(0, -50%)",
              transitionDelay: `${i * 40}ms`,
            }}
          />
        ))}
        <div className="relative flex flex-col items-center gap-6 rounded-[28px] bg-surface px-5 py-6 shadow-raised sm:px-7">
          {/* Rivets in the door's corners. */}
          {["top-3.5 left-3.5", "top-3.5 right-3.5", "bottom-3.5 left-3.5", "bottom-3.5 right-3.5"].map((at) => (
            <span
              key={at}
              aria-hidden
              className={cn(
                "absolute size-2.5 rounded-full bg-foreground/10 shadow-[inset_0_-1px_1px_oklch(1_0_0/0.35),0_1px_1px_oklch(0_0_0/0.15)] dark:shadow-[inset_0_-1px_1px_oklch(1_0_0/0.08),0_1px_1px_oklch(0_0_0/0.6)]",
                at,
              )}
            />
          ))}

          <div ref={slotsRef} className="flex gap-3">
            {lock.slots.map((n, i) => {
              const active = !open && lock.index === i;
              const live = active && lock.progressed ? lock.live : null;
              return (
                <div key={i} className="flex flex-col items-center gap-1.5">
                  <div
                    className={cn(
                      "flex h-14 w-16 items-center justify-center rounded-xl bg-background text-2xl font-medium tabular-nums shadow-wheel transition-[box-shadow] duration-150 ease-out",
                      active && "shadow-[inset_0_0_0_1.5px_var(--foreground)]",
                    )}
                  >
                    {n !== null ? (
                      <motion.span
                        key={`set-${n}`}
                        initial={{ opacity: 0, filter: "blur(4px)", y: reduceMotion ? 0 : 4 }}
                        animate={{ opacity: 1, filter: "blur(0px)", y: 0 }}
                        transition={{ duration: 0.2, ease: EASE_OUT }}
                      >
                        {n}
                      </motion.span>
                    ) : live !== null ? (
                      <span className="text-muted">{live}</span>
                    ) : (
                      <span className="h-0.5 w-4 rounded-full bg-border" />
                    )}
                  </div>
                  <span className={cn("flex items-center gap-1 text-xs", active ? "text-foreground" : "text-muted")}>
                    <svg
                      viewBox="0 0 16 16"
                      className={cn("size-3", EXPECT[i] === -1 && "-scale-x-100")}
                      fill="none"
                      stroke="currentColor"
                      strokeWidth={1.5}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden
                    >
                      <path d="M13 8a5 5 0 1 1-1.5-3.5M13 2v3h-3" />
                    </svg>
                    {EXPECT[i] === 1 ? "Right" : "Left"}
                  </span>
                </div>
              );
            })}
          </div>

          <div className="flex w-full items-center justify-center gap-4 sm:gap-8">
            <div
              role="slider"
              tabIndex={0}
              aria-label="Combination dial"
              aria-valuemin={0}
              aria-valuemax={NUMBERS - 1}
              aria-valuenow={current}
              aria-valuetext={`${current}`}
              aria-describedby={`${id}-keys`}
              className="relative aspect-square w-[260px] max-w-[calc(100%-92px)] min-w-0 cursor-grab touch-none rounded-full outline-hidden select-none focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-4 focus-visible:outline-foreground active:cursor-grabbing"
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerEnd}
              onPointerCancel={onPointerEnd}
              onKeyDown={onKeyDown}
            >
              {/* The recessed collar the dial turns in. */}
              <svg viewBox={`0 0 ${SIZE} ${SIZE}`} className="absolute inset-0 size-full" aria-hidden>
                <circle cx={C} cy={C} r={C - 1} strokeWidth={1} className="fill-background stroke-border" />
              </svg>
              <motion.div className="absolute inset-0" style={{ rotate: shown }}>
                <DialFace id={id} />
              </motion.div>
              <svg viewBox={`0 0 ${SIZE} ${SIZE}`} className="pointer-events-none absolute inset-0 size-full" aria-hidden>
                {/* The index the numbers are read against. */}
                <path ref={indexRef} d={`M${C - 6} 1L${C + 6} 1L${C} 10Z`} className="fill-danger" />
              </svg>
            </div>

            <button
              type="button"
              aria-label={open ? "Turn handle to lock" : "Turn handle to open"}
              aria-pressed={open}
              onClick={tryOpen}
              className="relative flex h-32 w-[76px] shrink-0 items-start justify-center rounded-2xl outline-hidden transition-[scale] duration-150 ease-out focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-foreground active:scale-[0.96] sm:w-[88px]"
            >
              {/* The spindle plate the handle turns on. */}
              <span aria-hidden className="absolute top-3 left-1/2 size-[72px] -translate-x-1/2 rounded-full bg-background shadow-wheel" />
              <motion.span
                aria-hidden
                className="absolute top-6 left-1/2 -ml-6 size-12"
                style={{ rotate: handle, transformOrigin: "24px 24px" }}
              >
                {/* The lever and its grip. Short enough that, swung open
                    toward the dial, it clears it. */}
                <span className="absolute top-6 left-[17px] h-[62px] w-3.5 rounded-full bg-foreground shadow-raised" />
                <span className="absolute top-[74px] left-3.5 size-5 rounded-full bg-foreground shadow-raised" />
                {/* The hub, with a turned ring and a cap catching light. */}
                <span className="absolute inset-0 rounded-full bg-foreground shadow-raised" />
                <span className="absolute inset-[6px] rounded-full border border-background/20" />
                <span className="absolute inset-[17px] rounded-full bg-background/25" />
              </motion.span>
            </button>
          </div>
        </div>
      </div>

      <div className="flex flex-col items-center gap-1 text-center">
        <p className="text-sm font-medium" aria-hidden>
          {status}
        </p>
        <p id={`${id}-keys`} className="text-sm text-muted">
          Try 12, 30, 7. Arrows turn, Enter sets a number.
        </p>
        <span className="sr-only" aria-live="polite">
          {message}
        </span>
      </div>
    </div>
  );
}

const DialFace = memo(function DialFace({ id }: { id: string }) {
  const knurl = Array.from({ length: 96 }, (_, i) => {
    const [x1, y1] = polar(118, i * 3.75);
    const [x2, y2] = polar(124, i * 3.75);
    return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} />;
  });
  const ticks = Array.from({ length: NUMBERS }, (_, n) => {
    const long = n % 5 === 0;
    const [x1, y1] = polar(long ? 92 : 98, n * STEP);
    const [x2, y2] = polar(108, n * STEP);
    return <line key={n} x1={x1} y1={y1} x2={x2} y2={y2} strokeWidth={long ? 1.75 : 1} />;
  });
  const labels = Array.from({ length: NUMBERS / 5 }, (_, i) => {
    const n = i * 5;
    const [x, y] = polar(78, n * STEP);
    return (
      <text
        key={n}
        x={x}
        y={y}
        dy="0.35em"
        textAnchor="middle"
        transform={`rotate(${n * STEP} ${x} ${y})`}
        className="fill-background text-sm font-medium tabular-nums"
      >
        {n}
      </text>
    );
  });
  return (
    <svg viewBox={`0 0 ${SIZE} ${SIZE}`} className="size-full" aria-hidden>
      <defs>
        {/* Models light falling on turned metal, from the top left. */}
        <radialGradient id={`${id}-sheen`} cx="0.35" cy="0.3" r="0.8">
          <stop offset="0" style={{ stopColor: "var(--background)", stopOpacity: 0.14 }} />
          <stop offset="1" style={{ stopColor: "var(--background)", stopOpacity: 0 }} />
        </radialGradient>
      </defs>
      <circle cx={C} cy={C} r={124} className="fill-foreground" />
      <circle cx={C} cy={C} r={124} fill={`url(#${id}-sheen)`} />
      <g strokeWidth={1.25} className="stroke-background/30">
        {knurl}
      </g>
      <circle cx={C} cy={C} r={114} fill="none" className="stroke-background/15" />
      <g className="stroke-background/70">{ticks}</g>
      {labels}
      {/* The centre knob, with a grip bar that shows the dial turning. */}
      <circle cx={C} cy={C} r={48} className="fill-foreground stroke-background/20" />
      <rect x={C - 7} y={C - 40} width={14} height={80} rx={7} className="fill-background/10" />
    </svg>
  );
});

export default function CombinationLockDemo() {
  return <CombinationLock code={[12, 30, 7]} />;
}
