import { useLayoutEffect, useRef, useState } from "react";
import { animate, motion, useMotionTemplate, useMotionValue } from "motion/react";
import { useReducedMotion } from "@/lib/use-reduced-motion";
import { cn } from "@/lib/cn";

// The pill travels like an inchworm: the edge facing the move leaves first
// and lands first, the trailing edge follows on a softer spring and settles
// with a touch of give. Both springs keep their velocity, so a second click
// mid-move bends the pill toward the new target instead of restarting it.
// The trailing edge settles by ~360ms; the leading edge has already landed
// at ~180ms, which is the moment the label turns and the eye reads "done".
const LEAD = { type: "spring", visualDuration: 0.18, bounce: 0 } as const;
const TRAIL = { type: "spring", visualDuration: 0.36, bounce: 0.15 } as const;
// Arrow keys fire in quick runs: both edges move together, briefly.
const KEYS = { type: "spring", visualDuration: 0.15, bounce: 0 } as const;

export function SegmentedControl({
  options,
  value,
  onChange,
  label,
  className,
}: {
  options: readonly string[];
  value: string;
  onChange: (value: string) => void;
  label: string;
  className?: string;
}) {
  const reduceMotion = useReducedMotion();
  const listRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const tabRefs = useRef(new Map<string, HTMLButtonElement>());
  // Clip insets as motion values: the pill is drawn by clip-path alone, and
  // no frame of the move re-renders React.
  const top = useMotionValue(0);
  const right = useMotionValue(0);
  const bottom = useMotionValue(0);
  const left = useMotionValue(0);
  const clipPath = useMotionTemplate`inset(${top}px ${right}px ${bottom}px ${left}px round 9999px)`;
  // Starts "place" so the pill is set without sliding in on page load.
  const mode = useRef<"place" | "click" | "key">("place");

  useLayoutEffect(() => {
    const list = listRef.current;
    const overlay = overlayRef.current;
    const tab = tabRefs.current.get(value);
    if (!list || !overlay || !tab) return;

    const measure = (resize: boolean) => {
      const nextLeft = tab.offsetLeft;
      const nextRight = list.clientWidth - nextLeft - tab.offsetWidth;
      top.jump(tab.offsetTop);
      bottom.jump(list.clientHeight - tab.offsetTop - tab.offsetHeight);
      const how = resize || reduceMotion ? "place" : mode.current;
      if (how === "place") {
        left.jump(nextLeft);
        right.jump(nextRight);
      } else if (how === "key") {
        animate(left, nextLeft, KEYS);
        animate(right, nextRight, KEYS);
      } else {
        // Moving right, the right edge leads; moving left, the left does.
        const toRight = nextLeft > left.get();
        animate(left, nextLeft, toRight ? TRAIL : LEAD);
        animate(right, nextRight, toRight ? LEAD : TRAIL);
      }
      overlay.style.visibility = "visible";
    };

    measure(false);
    let first = true;
    const observer = new ResizeObserver(() => {
      // The observer fires once on subscribe; that is not a resize.
      if (first) first = false;
      else measure(true);
    });
    observer.observe(list);
    return () => observer.disconnect();
  }, [value, reduceMotion, top, right, bottom, left]);

  const select = (next: string, fromKeyboard: boolean) => {
    mode.current = fromKeyboard ? "key" : "click";
    onChange(next);
  };

  return (
    <div
      ref={listRef}
      role="radiogroup"
      aria-label={label}
      className={cn(
        "relative inline-flex rounded-full bg-surface p-1 shadow-raised has-focus-visible:outline-2 has-focus-visible:outline-solid has-focus-visible:outline-offset-2 has-focus-visible:outline-foreground",
        className,
      )}
      onKeyDown={(e) => {
        const index = options.indexOf(value);
        const target = {
          ArrowRight: index + 1,
          ArrowDown: index + 1,
          ArrowLeft: index - 1,
          ArrowUp: index - 1,
          Home: 0,
          End: options.length - 1,
        }[e.key];
        if (target === undefined) return;
        e.preventDefault();
        const next = options[(target + options.length) % options.length];
        select(next, true);
        tabRefs.current.get(next)?.focus();
      }}
    >
      {options.map((option) => (
        <button
          key={option}
          ref={(el) => {
            if (el) tabRefs.current.set(option, el);
            else tabRefs.current.delete(option);
          }}
          type="button"
          role="radio"
          aria-checked={option === value}
          tabIndex={option === value ? 0 : -1}
          onClick={() => select(option, false)}
          className="flex h-8 items-center rounded-full px-4 text-sm font-medium text-muted transition-[color] duration-150 ease-out outline-hidden hover:text-foreground"
        >
          {option}
        </button>
      ))}

      {/* An inverted copy of the row, clipped to the selected option. Moving
          the clip recolors each label exactly as the pill's edge crosses it. */}
      <motion.div
        ref={overlayRef}
        aria-hidden
        style={{ clipPath }}
        className="pointer-events-none invisible absolute inset-0 flex rounded-full bg-foreground p-1 text-background"
      >
        {options.map((option) => (
          <span
            key={option}
            className="flex h-8 items-center px-4 text-sm font-medium"
          >
            {option}
          </span>
        ))}
      </motion.div>
    </div>
  );
}

const RANGES = ["Day", "Week", "Month", "Year"] as const;

export default function SegmentedControlDemo() {
  const [range, setRange] = useState<string>("Week");

  return (
    <SegmentedControl
      label="Range"
      options={RANGES}
      value={range}
      onChange={setRange}
    />
  );
}
