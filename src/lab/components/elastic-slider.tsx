import { useEffect, useRef, useState } from "react";
import {
  animate,
  motion,
  useMotionTemplate,
  useMotionValue,
  useSpring,
  useTransform,
} from "motion/react";
import { useReducedMotion } from "@/lib/use-reduced-motion";

// The furthest the track can stretch past either end, in px.
const MAX_STRETCH = 24;
// A little bounce on release sells the rubber; this is the one place in the
// lab where overshoot is the point.
const SNAP_BACK = { type: "spring", visualDuration: 0.5, bounce: 0.4 } as const;
// Stiff enough that dragging still feels attached to the finger, soft enough
// that a click glides across instead of jumping. No bounce: a fill that
// overshoots would read as the wrong volume.
const FILL = { stiffness: 400, damping: 40 };
const ICON_SWAP = { type: "spring", duration: 0.3, bounce: 0 } as const;
const STEP = 0.05;

// Gives freely at first, then stiffens so it never passes MAX_STRETCH.
function resist(overflow: number) {
  return MAX_STRETCH * Math.tanh(overflow / (MAX_STRETCH * 4));
}

export function ElasticSlider({
  value,
  onChange,
  muted,
  onMutedChange,
  label,
}: {
  value: number;
  onChange: (value: number) => void;
  muted: boolean;
  onMutedChange: (muted: boolean) => void;
  label: string;
}) {
  const reduceMotion = useReducedMotion();
  const trackRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const overflow = useMotionValue(0);

  const shown = muted ? 0 : value;
  const fill = useSpring(shown, FILL);
  const fillTransform = useMotionTemplate`scaleX(${fill})`;

  useEffect(() => {
    if (reduceMotion) fill.jump(shown);
    else fill.set(shown);
  }, [shown, reduceMotion, fill]);

  const width = () => trackRef.current?.offsetWidth ?? 1;
  const stretch = useTransform(overflow, (o) => 1 + Math.abs(o) / width());
  // Stretching thins the track slightly, like pulling a rubber band.
  const thin = useTransform(overflow, (o) => 1 - Math.abs(o) / (MAX_STRETCH * 6));
  const transform = useMotionTemplate`scale(${stretch}, ${thin})`;
  // Stretch away from the end being pulled, so the far end stays put.
  const origin = useTransform(overflow, (o) => (o < 0 ? "right" : "left"));
  const lowIconX = useTransform(overflow, (o) => Math.min(o, 0));
  const highIconX = useTransform(overflow, (o) => Math.max(o, 0));

  const release = () => animate(overflow, 0, SNAP_BACK);

  // Reaching for the slider means you want sound, so any change unmutes.
  // Unmute first, so the new value lands after anything unmuting restores.
  const set = (next: number) => {
    if (muted) onMutedChange(false);
    onChange(next);
  };

  const track = (clientX: number) => {
    const box = trackRef.current?.getBoundingClientRect();
    if (!box) return;
    const raw = (clientX - box.left) / box.width;
    set(Math.min(Math.max(raw, 0), 1));
    if (reduceMotion) return;
    const past =
      clientX < box.left
        ? clientX - box.left
        : clientX > box.right
          ? clientX - box.right
          : 0;
    overflow.set(resist(past));
  };

  // Keys can't pull, so pressing past an end gives a small nudge instead.
  const bump = (direction: 1 | -1) => {
    if (reduceMotion) return;
    overflow.set(direction * 6);
    release();
  };

  const silent = shown === 0;

  return (
    <div className="flex w-80 items-center gap-2 text-muted">
      <motion.button
        type="button"
        aria-label={muted ? "Unmute" : "Mute"}
        aria-pressed={muted}
        onClick={() => onMutedChange(!muted)}
        style={{ x: lowIconX }}
        className="relative flex size-8 shrink-0 items-center justify-center rounded-full outline-hidden transition-[scale,color] duration-150 ease-out hover:text-foreground focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-foreground active:scale-[0.96]"
      >
        <SwapIcon visible={!silent}>
          <path d="M3 9.5v5h3.5L11 18V6L6.5 9.5Z" />
        </SwapIcon>
        <SwapIcon visible={silent}>
          <path d="M3 9.5v5h3.5L11 18V6L6.5 9.5Z" />
          <path d="m15 10 4 4M19 10l-4 4" />
        </SwapIcon>
      </motion.button>
      <div
        ref={trackRef}
        role="slider"
        tabIndex={0}
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(shown * 100)}
        className="group flex h-8 flex-1 cursor-pointer touch-none items-center rounded-full outline-hidden focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-4 focus-visible:outline-foreground"
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          dragging.current = true;
          e.currentTarget.setPointerCapture(e.pointerId);
          track(e.clientX);
        }}
        onPointerMove={(e) => {
          if (dragging.current) track(e.clientX);
        }}
        onPointerUp={() => {
          dragging.current = false;
          release();
        }}
        onPointerCancel={() => {
          dragging.current = false;
          release();
        }}
        onKeyDown={(e) => {
          const delta = {
            ArrowRight: STEP,
            ArrowUp: STEP,
            ArrowLeft: -STEP,
            ArrowDown: -STEP,
            PageUp: STEP * 2,
            PageDown: -STEP * 2,
            Home: -1,
            End: 1,
          }[e.key];
          if (delta === undefined) return;
          e.preventDefault();
          const next = Math.min(Math.max(shown + delta, 0), 1);
          if (next === shown) bump(delta > 0 ? 1 : -1);
          set(next);
        }}
      >
        <motion.div
          className="h-1.5 w-full overflow-hidden rounded-full bg-border transition-[height] duration-150 ease-out group-hover:h-2.5 group-active:h-2.5"
          style={{ transform, transformOrigin: origin }}
        >
          <motion.div
            className="h-full origin-left bg-foreground"
            style={{ transform: fillTransform }}
          />
        </motion.div>
      </div>
      <motion.svg
        style={{ x: highIconX }}
        className="mx-1.5 size-5 shrink-0"
        {...STROKE}
        aria-hidden
      >
        <path d="M3 9.5v5h3.5L11 18V6L6.5 9.5Z" />
        <path d="M15 9a4 4 0 0 1 0 6M17.5 6.5a7.5 7.5 0 0 1 0 11" />
      </motion.svg>
    </div>
  );
}

function SwapIcon({
  visible,
  children,
}: {
  visible: boolean;
  children: React.ReactNode;
}) {
  return (
    <motion.svg
      className="absolute size-5"
      {...STROKE}
      aria-hidden
      initial={false}
      animate={
        visible
          ? { scale: 1, opacity: 1, filter: "blur(0px)" }
          : { scale: 0.25, opacity: 0, filter: "blur(4px)" }
      }
      transition={ICON_SWAP}
    >
      {children}
    </motion.svg>
  );
}

const STROKE = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.5,
  strokeLinecap: "round",
  strokeLinejoin: "round",
} as const;

export default function ElasticSliderDemo() {
  const [volume, setVolume] = useState(0.6);
  const [muted, setMuted] = useState(false);

  return (
    <ElasticSlider
      label="Volume"
      value={volume}
      onChange={setVolume}
      muted={muted}
      onMutedChange={(next) => {
        // Unmuting at zero would stay silent, so bring back a usable level.
        if (!next && volume === 0) setVolume(0.5);
        setMuted(next);
      }}
    />
  );
}
