import { useEffect, useId, useRef, useState } from "react";
import { animate, motion, useMotionValue, useTransform } from "motion/react";
import { useReducedMotion } from "@/lib/use-reduced-motion";
import { cn } from "@/lib/cn";

// Track is 48x28 with 2px padding, so the knob moves inside 44px.
const INNER = 44;
const KNOB = 24;
// Pressed, the knob leans 7px into the direction it will travel.
const STRETCHED = 31;
// Movement below this is still a tap, so a shaky finger doesn't drag.
const DRAG_SLOP = 3;
// Landing past the end squashes the knob against the wall instead of
// poking out of the track. Capped so a hard flick can't flatten it.
const MAX_SQUASH = 5;
// The playful case: a little bounce sells the knob as a physical thing.
// 0.3s is the visual settle; the overshoot tail runs slightly past it.
const TRAVEL = { type: "spring", visualDuration: 0.3, bounce: 0.25 } as const;
const LEAN = { type: "spring", duration: 0.2, bounce: 0 } as const;
const GLIDE = { duration: 0.2, ease: [0.23, 1, 0.32, 1] } as const;

const clamp01 = (v: number) => Math.min(Math.max(v, 0), 1);

export function ToggleSwitch({
  checked,
  onCheckedChange,
  label,
  className,
}: {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  label: string;
  className?: string;
}) {
  const id = useId();
  const reduceMotion = useReducedMotion();
  // 0 is off, 1 is on. The spring overshoots past either end on landing.
  const progress = useMotionValue(checked ? 1 : 0);
  const width = useMotionValue(KNOB);
  const target = useRef(checked);
  const gesture = useRef<{
    pointerId: number;
    startX: number;
    startProgress: number;
    dragging: boolean;
  } | null>(null);
  // A drag ends in a click event too; that click must not toggle again.
  const swallowClick = useRef(false);

  const squash = useTransform(progress, (p) => {
    const over = p > 1 ? p - 1 : p < 0 ? -p : 0;
    return Math.min(over * (INNER - KNOB), MAX_SQUASH);
  });
  const knobWidth = useTransform([width, squash], ([w, s]: number[]) => w - s);
  // Position is derived from width, so widening while off grows rightward
  // and widening while on grows leftward: always into the coming move.
  const knobX = useTransform(
    [progress, knobWidth],
    ([p, w]: number[]) => clamp01(p) * (INNER - w),
  );
  const fill = useTransform(progress, clamp01);

  const travelTo = (next: boolean) => {
    target.current = next;
    animate(
      progress,
      next ? 1 : 0,
      // Carries the release speed of a drag into the spring.
      reduceMotion ? GLIDE : { ...TRAVEL, velocity: progress.getVelocity() },
    );
  };

  const lean = (on: boolean) => {
    if (reduceMotion) return;
    animate(width, on ? STRETCHED : KNOB, on ? LEAN : TRAVEL);
  };

  // Follows changes made outside this switch; our own already animated.
  useEffect(() => {
    if (target.current !== checked) travelTo(checked);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [checked]);

  const commit = (next: boolean) => {
    travelTo(next);
    if (next !== checked) onCheckedChange(next);
  };

  const endGesture = () => {
    gesture.current = null;
    lean(false);
  };

  return (
    <div
      className={cn("flex items-center justify-between gap-4 py-3", className)}
    >
      <label
        htmlFor={id}
        className="cursor-pointer text-[15px] text-foreground select-none"
      >
        {label}
      </label>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        // The knob's stretch is the press feedback, so the track doesn't
        // also scale: shrinking it would shift the knob under the finger
        // mid-drag. The pseudo-element grows the hit area to 56x44.
        className="relative h-7 w-12 shrink-0 cursor-pointer touch-none rounded-full bg-foreground/15 outline-hidden select-none after:absolute after:-inset-x-1 after:-inset-y-2 focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-foreground dark:bg-foreground/25"
        onPointerDown={(e) => {
          if (e.button !== 0 || gesture.current) return;
          swallowClick.current = false;
          e.currentTarget.setPointerCapture(e.pointerId);
          gesture.current = {
            pointerId: e.pointerId,
            startX: e.clientX,
            startProgress: clamp01(progress.get()),
            dragging: false,
          };
          lean(true);
        }}
        onPointerMove={(e) => {
          const g = gesture.current;
          if (!g || e.pointerId !== g.pointerId) return;
          const dx = e.clientX - g.startX;
          if (!g.dragging && Math.abs(dx) < DRAG_SLOP) return;
          g.dragging = true;
          // Pointer px map to knob px 1:1 at the knob's current width.
          progress.set(clamp01(g.startProgress + dx / (INNER - width.get())));
        }}
        onPointerUp={(e) => {
          const g = gesture.current;
          if (!g || e.pointerId !== g.pointerId) return;
          if (g.dragging) {
            swallowClick.current = true;
            commit(progress.get() > 0.5);
          }
          endGesture();
        }}
        onPointerCancel={(e) => {
          const g = gesture.current;
          if (!g || e.pointerId !== g.pointerId) return;
          if (g.dragging) travelTo(target.current);
          endGesture();
        }}
        onKeyDown={() => {
          swallowClick.current = false;
        }}
        // Taps, label clicks, Space and Enter all land here. Keyboard and
        // label never press the knob, so they travel without the stretch.
        onClick={() => {
          if (swallowClick.current) {
            swallowClick.current = false;
            return;
          }
          commit(!target.current);
        }}
      >
        <motion.span
          aria-hidden
          className="absolute inset-0 rounded-full bg-foreground"
          style={{ opacity: fill }}
        />
        <motion.span
          aria-hidden
          className="absolute top-0.5 left-0.5 h-6 rounded-full bg-background shadow-raised"
          style={{ x: knobX, width: knobWidth }}
        />
      </button>
    </div>
  );
}

const SETTINGS = ["Reduce motion", "Sound effects", "Haptics"] as const;

export default function ToggleSwitchDemo() {
  const [values, setValues] = useState<Record<string, boolean>>({
    "Reduce motion": false,
    "Sound effects": true,
    Haptics: true,
  });

  return (
    <div className="w-[380px] max-w-full divide-y divide-border">
      {SETTINGS.map((name) => (
        <ToggleSwitch
          key={name}
          label={name}
          checked={values[name]}
          onCheckedChange={(next) =>
            setValues((v) => ({ ...v, [name]: next }))
          }
        />
      ))}
    </div>
  );
}
