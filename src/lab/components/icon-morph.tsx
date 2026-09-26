import { useState } from "react";
import { motion } from "motion/react";
import { useReducedMotion } from "@/lib/use-reduced-motion";
import { cn } from "@/lib/cn";

// Motion interpolates `d` like any other complex string: it pulls out every
// number, mixes each one with the number in the same position in the target,
// and writes them into the target string's template. That only works when both
// paths have the same commands in the same order with the same count of
// numbers: otherwise numbers pair up with the wrong commands (a garbled
// shape), or Motion finds no pairing at all and snaps to the new path. Every
// pair below is written to that shared shape, with collapsed or duplicated
// points standing in for geometry one state lacks.
export type MorphShape = {
  off: string;
  on: string;
  // Degrees the whole glyph turns on the way to `on`.
  rotate?: number;
  filled?: boolean;
};

export const SHAPES = {
  // The play triangle is cut into two quads at x=13 that each become a bar.
  // The triangle sits right of the box center, because its visual weight is
  // at its wide end.
  playPause: {
    off: "M7.5 5L13 8.5L13 15.5L7.5 19Z M13 8.5L18.5 12L18.5 12L13 15.5Z",
    on: "M6.5 5L10.5 5L10.5 19L6.5 19Z M13.5 5L17.5 5L17.5 19L13.5 19Z",
    filled: true,
  },
  // The middle bar folds onto the second diagonal, so the X keeps three
  // strokes without a stray dot where a collapsed line would sit.
  menuClose: {
    off: "M4.5 7L19.5 7 M4.5 12L19.5 12 M4.5 17L19.5 17",
    on: "M6.5 6.5L17.5 17.5 M6.5 17.5L17.5 6.5 M6.5 17.5L17.5 6.5",
    // A quarter turn lands the X on itself, so the spin reads as the lines
    // swinging into place rather than the icon changing orientation.
    rotate: 90,
  },
  // The vertical bar lies down onto the horizontal one. A half turn keeps
  // the minus horizontal where a quarter turn would stand it upright.
  plusMinus: {
    off: "M5 12L19 12 M12 5L12 19",
    on: "M5 12L19 12 M5 12L19 12",
    rotate: 180,
  },
  // The shaft shrinks into the short leg of the check, which the head also
  // traces, so the two overlap once settled.
  sendSent: {
    off: "M5 12L19 12 M13 6L19 12L13 18",
    on: "M5 12.5L9.5 17 M5 12.5L9.5 17L19 7",
  },
} satisfies Record<string, MorphShape>;

// Critically damped: an icon that overshoots its own outline looks broken.
const MORPH = { type: "spring", visualDuration: 0.3, bounce: 0 } as const;
// The turn gets a little give, which is what makes it feel physical.
const TURN = { type: "spring", visualDuration: 0.35, bounce: 0.2 } as const;
const FADE = { duration: 0.15, ease: [0.23, 1, 0.32, 1] } as const;

export function IconMorphButton({
  shape,
  label,
  captions,
  pressed: controlled,
  defaultPressed = false,
  onPressedChange,
  className,
}: {
  shape: MorphShape;
  // The accessible name stays fixed and aria-pressed carries the state, so a
  // screen reader never hears a name and a state that contradict each other
  // ("Pause, pressed"). Matching the off caption keeps voice control working.
  label: string;
  // Visible text for each state, cross-faded as the icon morphs.
  captions?: [off: string, on: string];
  pressed?: boolean;
  defaultPressed?: boolean;
  onPressedChange?: (pressed: boolean) => void;
  className?: string;
}) {
  const reduceMotion = useReducedMotion();
  const [uncontrolled, setUncontrolled] = useState(defaultPressed);
  const pressed = controlled ?? uncontrolled;

  const toggle = () => {
    const next = !pressed;
    if (controlled === undefined) setUncontrolled(next);
    onPressedChange?.(next);
  };

  return (
    <div className={cn("flex flex-col items-center gap-2", className)}>
      <button
        type="button"
        aria-label={label}
        aria-pressed={pressed}
        onClick={toggle}
        className="flex size-11 touch-manipulation items-center justify-center rounded-full bg-surface text-foreground shadow-raised outline-hidden transition-[scale,background-color] duration-150 ease-out select-none hover:bg-border/60 focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-foreground active:scale-[0.96] motion-reduce:transition-[background-color]"
      >
        <motion.svg
          viewBox="0 0 24 24"
          className="size-[22px]"
          fill={shape.filled ? "currentColor" : "none"}
          stroke="currentColor"
          strokeWidth={1.75}
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
          initial={false}
          animate={{
            rotate: pressed && !reduceMotion ? (shape.rotate ?? 0) : 0,
          }}
          transition={TURN}
        >
          <motion.path
            initial={false}
            animate={{ d: pressed ? shape.on : shape.off }}
            transition={reduceMotion ? FADE : MORPH}
          />
        </motion.svg>
      </button>
      {captions && (
        // Both captions share one grid cell, so the column never changes
        // width as they swap.
        <span aria-hidden className="grid text-[13px] font-medium text-muted">
          {captions.map((caption, i) => {
            const visible = pressed === (i === 1);
            return (
              <span
                key={caption}
                className={cn(
                  "col-start-1 row-start-1 text-center transition-[opacity,filter,translate] ease-[cubic-bezier(0.23,1,0.32,1)] motion-reduce:transition-[opacity]",
                  // Leaves faster than it arrives, so the old word never
                  // lingers over the new one.
                  visible
                    ? "translate-y-0 opacity-100 blur-[0px] duration-200"
                    : "translate-y-0.5 opacity-0 blur-[4px] duration-100 motion-reduce:translate-y-0 motion-reduce:blur-[0px]",
                )}
              >
                {caption}
              </span>
            );
          })}
        </span>
      )}
    </div>
  );
}

const DEMO = [
  { shape: SHAPES.playPause, label: "Play", captions: ["Play", "Pause"] },
  { shape: SHAPES.menuClose, label: "Menu", captions: ["Menu", "Close"] },
  {
    shape: SHAPES.plusMinus,
    label: "Expand",
    captions: ["Expand", "Collapse"],
  },
  { shape: SHAPES.sendSent, label: "Send", captions: ["Send", "Sent"] },
] as const;

export default function IconMorphDemo() {
  return (
    <div className="grid w-[min(360px,100%)] grid-cols-4 gap-2">
      {DEMO.map((item) => (
        <IconMorphButton
          key={item.label}
          shape={item.shape}
          label={item.label}
          captions={[item.captions[0], item.captions[1]]}
        />
      ))}
    </div>
  );
}
