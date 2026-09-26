import { useEffect, useRef, useState } from "react";
import {
  animate,
  motion,
  useMotionValue,
  useTransform,
  type MotionValue,
} from "motion/react";
import { useReducedMotion } from "@/lib/use-reduced-motion";
import { cn } from "@/lib/cn";

type Item = { title: string; note: string };

const CARD_W = 168;
const CARD_H = 208;
// Space between neighbouring cards along the ring.
const GAP = 24;
const PERSPECTIVE = 1100;
// Dragging this far turns the ring by one card: close to the arc a front card
// travels, so the card under the finger stays under it.
const PX_PER_CARD = 180;
// Apple's scroll deceleration. Projecting the release velocity picks the card
// a flick is heading for, not the one nearest where the finger let go.
const DECELERATION = 0.998;
// Apple ships damping 0.8, response 0.4 for rotation. The small overshoot is
// earned here: the ring only moves after a spin, a throw or a step.
const SPIN = { type: "spring", visualDuration: 0.4, bounce: 0.2 } as const;
// Past this the pointer is dragging, not clicking a card.
const CLICK_SLOP = 6;
// How much a card shrinks and dims by the time it reaches the back.
const BACK_SCALE = 0.9;
const BACK_OPACITY = 0.35;
// Reduced motion lays the ring out flat; neighbours sit at half strength.
const ROW_OPACITY = 0.5;

function project(velocity: number) {
  return ((velocity / 1000) * DECELERATION) / (1 - DECELERATION);
}

// The copy of `index` nearest the current rotation, so clicking a card always
// turns the short way round.
function nearestTurn(index: number, rotation: number, count: number) {
  return index + Math.round((rotation - index) / count) * count;
}

function wrap(value: number, count: number) {
  return ((Math.round(value) % count) + count) % count;
}

export function Carousel3D({
  items,
  label,
  onChange,
  className,
}: {
  items: Item[];
  label: string;
  onChange?: (index: number) => void;
  className?: string;
}) {
  const reduce = useReducedMotion() ?? false;
  const count = items.length;
  // Counted in cards and never wrapped, so a spin can pass any number of
  // turns and the spring still takes the direct path to its target.
  const rotation = useMotionValue(0);
  const target = useRef(0);
  const [active, setActive] = useState(0);
  const drag = useRef<{
    id: number;
    x: number;
    from: number;
    card: number | null;
    moved: boolean;
  } | null>(null);

  const radius = (CARD_W + GAP) / 2 / Math.tan(Math.PI / count);

  const goTo = (next: number, velocity = rotation.getVelocity()) => {
    target.current = next;
    const index = wrap(next, count);
    setActive(index);
    onChange?.(index);
    if (reduce) {
      rotation.jump(next);
      return;
    }
    animate(rotation, next, { ...SPIN, velocity });
  };

  // Presses stack: two quick presses aim two cards ahead instead of
  // restarting from wherever the ring happens to be mid-turn.
  const step = (direction: 1 | -1) => goTo(target.current + direction);

  const settle = () => goTo(Math.round(rotation.get()));

  useEffect(() => () => rotation.stop(), [rotation]);

  return (
    <div
      className={cn(
        "flex w-[min(520px,100%)] flex-col items-center gap-5",
        className,
      )}
    >
      <div
        role="group"
        aria-roledescription="carousel"
        aria-label={label}
        tabIndex={0}
        // pan-y: a vertical swipe still scrolls the page on touch screens.
        className="relative h-[260px] w-full cursor-grab touch-pan-y overflow-hidden rounded-2xl outline-hidden select-none focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-foreground active:cursor-grabbing"
        style={{ perspective: PERSPECTIVE }}
        onKeyDown={(e) => {
          if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
          e.preventDefault();
          step(e.key === "ArrowLeft" ? -1 : 1);
        }}
        onPointerDown={(e) => {
          // A second finger mid-drag would make the ring jump to it.
          if (e.button !== 0 || drag.current) return;
          // Grabbing a spinning ring stops it exactly where it is.
          rotation.stop();
          const card = (e.target as HTMLElement).closest<HTMLElement>(
            "[data-card]",
          );
          drag.current = {
            id: e.pointerId,
            x: e.clientX,
            from: rotation.get(),
            card: card ? Number(card.dataset.card) : null,
            moved: false,
          };
          e.currentTarget.setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (!d || d.id !== e.pointerId) return;
          const dx = e.clientX - d.x;
          if (!d.moved) {
            if (Math.abs(dx) < CLICK_SLOP) return;
            d.moved = true;
            // Start from the finger, not from where the slop ran out.
            d.x = e.clientX;
            return;
          }
          // Dragging right brings the card on the left forward.
          rotation.set(d.from - dx / PX_PER_CARD);
        }}
        onPointerUp={(e) => {
          const d = drag.current;
          if (!d || d.id !== e.pointerId) return;
          drag.current = null;
          if (d.moved) {
            const velocity = rotation.getVelocity();
            // Capped at one full turn, so a wild flick never loses your place.
            const reach = Math.max(-count, Math.min(project(velocity), count));
            goTo(Math.round(rotation.get() + reach), velocity);
          } else if (d.card !== null) {
            goTo(nearestTurn(d.card, rotation.get(), count));
          } else {
            settle();
          }
        }}
        onPointerCancel={(e) => {
          if (drag.current?.id !== e.pointerId) return;
          drag.current = null;
          settle();
        }}
      >
        {/* Pushed back by the radius, so the front card sits on the
            perspective plane and renders at exactly its own size. */}
        <div
          className="absolute top-1/2 left-1/2"
          style={{
            transformStyle: "preserve-3d",
            transform: reduce ? "none" : `translateZ(${-radius}px)`,
          }}
        >
          {items.map((item, i) => (
            <Card
              // Remounts when the preference flips, so every transform
              // switches layout at once.
              key={`${i}-${reduce}`}
              item={item}
              index={i}
              count={count}
              radius={radius}
              rotation={rotation}
              front={i === active}
              reduce={reduce}
            />
          ))}
        </div>
      </div>

      <div className="flex items-center gap-3">
        <RingButton label="Previous card" onClick={() => step(-1)}>
          <path d="M10 3.5 5.5 8l4.5 4.5" />
        </RingButton>
        <p
          className="w-16 text-center font-mono text-sm text-muted tabular-nums"
          aria-live="polite"
          aria-atomic
        >
          <span className="sr-only">{items[active].title}, card </span>
          {String(active + 1).padStart(2, "0")}
          <span aria-hidden> / </span>
          <span className="sr-only"> of </span>
          {String(count).padStart(2, "0")}
        </p>
        <RingButton label="Next card" onClick={() => step(1)}>
          <path d="m6 3.5 4.5 4.5L6 12.5" />
        </RingButton>
      </div>
    </div>
  );
}

function Card({
  item,
  index,
  count,
  radius,
  rotation,
  front,
  reduce,
}: {
  item: Item;
  index: number;
  count: number;
  radius: number;
  rotation: MotionValue<number>;
  front: boolean;
  reduce: boolean;
}) {
  // Signed distance from the front in cards, wrapped the short way round.
  const offset = useTransform(rotation, (r) => {
    const d = (((index - r) % count) + count) % count;
    return d > count / 2 ? d - count : d;
  });
  // 1 facing you, -1 facing away. Every depth cue reads from this one number.
  const facing = useTransform(offset, (o) =>
    Math.cos((o / count) * Math.PI * 2),
  );
  const transform = useTransform(offset, (o) => {
    if (reduce) return `translateX(${o * (CARD_W + GAP)}px)`;
    const f = Math.cos((o / count) * Math.PI * 2);
    const scale = BACK_SCALE + ((1 - BACK_SCALE) * (f + 1)) / 2;
    return `rotateY(${(o / count) * 360}deg) translateZ(${radius}px) scale(${scale})`;
  });
  const opacity = useTransform(offset, (o) => {
    if (reduce) return Math.abs(o) < 0.5 ? 1 : ROW_OPACITY;
    const f = Math.cos((o / count) * Math.PI * 2);
    return BACK_OPACITY + ((1 - BACK_OPACITY) * (f + 1)) / 2;
  });
  // Text is gone before a card turns side-on, so nobody reads a card mirrored
  // through the ring; the back half shows blank faces.
  const text = useTransform(facing, (f) =>
    reduce ? 1 : Math.min(Math.max((f - 0.1) / 0.5, 0), 1),
  );

  return (
    <motion.div
      data-card={index}
      aria-hidden={!front}
      className={cn(
        "absolute flex flex-col justify-between rounded-[20px] bg-background p-5 shadow-raised",
        // Reduced motion: the row cross-fades which card is lit instead.
        reduce && "transition-[opacity] duration-200 ease-out",
      )}
      style={{
        width: CARD_W,
        height: CARD_H,
        left: -CARD_W / 2,
        top: -CARD_H / 2,
        transform,
        opacity,
      }}
    >
      <motion.span
        style={{ opacity: text }}
        className="font-mono text-xs text-muted tabular-nums"
      >
        {String(index + 1).padStart(2, "0")}
      </motion.span>
      <motion.p
        style={{ opacity: text }}
        className="text-lg leading-snug font-medium tracking-tight text-balance text-foreground"
      >
        {item.title}
        <span className="mt-1.5 block text-sm leading-normal font-normal tracking-normal text-pretty text-muted">
          {item.note}
        </span>
      </motion.p>
    </motion.div>
  );
}

function RingButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className="flex size-11 items-center justify-center rounded-full bg-surface text-foreground shadow-raised outline-hidden transition-[scale] duration-150 ease-out focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-foreground active:scale-[0.96] motion-reduce:transition-none"
    >
      <svg
        viewBox="0 0 16 16"
        className="size-4"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        {children}
      </svg>
    </button>
  );
}

const ITEMS: Item[] = [
  { title: "Response", note: "Feedback lands on press." },
  { title: "Tracking", note: "Content stays under the finger." },
  { title: "Interruption", note: "Grab it mid-flight." },
  { title: "Momentum", note: "Land where the flick was heading." },
  { title: "Resistance", note: "Soft edges, never walls." },
  { title: "Springs", note: "Behaviour, not a timeline." },
  { title: "Restraint", note: "Bounce only after a throw." },
  { title: "Consistency", note: "Leave the way you came." },
];

export default function Carousel3dDemo() {
  return <Carousel3D items={ITEMS} label="Motion principles" />;
}
