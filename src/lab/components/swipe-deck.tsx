import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import {
  animate,
  motion,
  useMotionValue,
  useSpring,
  useTransform,
  type MotionValue,
} from "motion/react";
import { useReducedMotion } from "@/lib/use-reduced-motion";

// Dragged this far, the card is committed and the deck has fully advanced.
const THROW_DISTANCE = 120;
// A release faster than this (px per second) throws however short the drag.
const THROW_VELOCITY = 400;
// Far enough to clear the deck. The card is fully faded well before this,
// so it never needs to reach the edge of the screen.
const OFFSCREEN = 360;
// Each card behind sits this much lower and smaller than the one in front.
const STEP_Y = 12;
const STEP_SCALE = 0.05;
const VISIBLE = 3;
// How cards move up a slot when the deck advances.
const STEP_FORWARD = { stiffness: 320, damping: 30 };
// Both springs start from the finger's release velocity, so a flick keeps
// exactly the speed the hand gave it instead of restarting from rest.
const SNAP_BACK = { type: "spring", stiffness: 400, damping: 28 } as const;
// Slightly overdamped: it carries the throw out without swinging back.
const THROW = { type: "spring", stiffness: 260, damping: 36 } as const;
// The drop and the spin settle more lazily than the throw itself. Three
// springs drifting out of step is what makes it read as a tossed object
// rather than one scripted path.
const DROP = { type: "spring", stiffness: 90, damping: 18 } as const;
const SPIN = { type: "spring", stiffness: 120, damping: 20 } as const;
const SHRINK = { duration: 0.3, ease: [0.23, 1, 0.32, 1] } as const;

type Card = { title: string; note: string };
type Flight = {
  id: number;
  card: number;
  from: number;
  direction: 1 | -1;
  velocity: number;
  // Rolled per throw, so no two cards leave the same way.
  spin: number;
  drop: number;
};

function rollThrow() {
  return {
    spin: 8 + Math.random() * 14,
    // Mostly falls, as if gravity takes it; now and then it lifts a little.
    drop: Math.random() * 110 - 20,
  };
}

// Pivots from below, like a card held at its bottom edge.
function tiltAt(x: number) {
  return Math.max(-1, Math.min(x / 240, 1)) * 18;
}

// Stays solid while you're deciding, then fades on the way out.
function useThrowStyle(x: MotionValue<number>) {
  const rotate = useTransform(x, tiltAt);
  const opacity = useTransform(
    x,
    [-OFFSCREEN * 0.8, -THROW_DISTANCE, THROW_DISTANCE, OFFSCREEN * 0.8],
    [0, 1, 1, 0],
  );
  return { rotate, opacity };
}

export function SwipeDeck({ cards }: { cards: Card[] }) {
  const reduceMotion = useReducedMotion();
  const [order, setOrder] = useState(() => cards.map((_, i) => i));
  const [flights, setFlights] = useState<Flight[]>([]);
  const nextFlight = useRef(0);

  const x = useMotionValue(0);
  const { rotate, opacity } = useThrowStyle(x);
  // Bound to every card that isn't on top. Motion keeps the last value of a
  // property that stops being passed, so a card that was on top would
  // otherwise keep its old offset when it cycles back to the front.
  const still = useMotionValue(0);
  const opaque = useMotionValue(1);
  const progress = useTransform(x, (v) =>
    Math.min(Math.abs(v) / THROW_DISTANCE, 1),
  );
  // How far the drag had pulled the deck forward when the card was thrown,
  // so each card can carry on from where it visibly was.
  const handoff = useRef(0);

  // The deck advances the moment a card is thrown. The card itself finishes
  // flying out as a separate copy, so the next one can be grabbed at once
  // instead of waiting for the throw's spring to settle.
  const throwCard = (direction: 1 | -1, velocity = 0) => {
    const flight = {
      id: nextFlight.current++,
      card: order[0],
      from: x.get(),
      direction,
      velocity,
      ...rollThrow(),
    };
    handoff.current = progress.get();
    flushSync(() => {
      setOrder((o) => [...o.slice(1), o[0]]);
      if (!reduceMotion) setFlights((f) => [...f, flight]);
    });
    x.jump(0);
  };

  return (
    <div className="flex flex-col items-center gap-8">
      <div
        role="group"
        aria-roledescription="card deck"
        aria-label="Animation principles"
        tabIndex={0}
        className="relative h-80 w-64 rounded-[24px] outline-hidden focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-8 focus-visible:outline-foreground"
        onKeyDown={(e) => {
          if (e.key === "ArrowLeft") throwCard(-1);
          if (e.key === "ArrowRight") throwCard(1);
        }}
      >
        {order.map((cardIndex, index) => (
          <DeckCard
            key={cardIndex}
            card={cards[cardIndex]}
            number={cardIndex + 1}
            index={index}
            x={index === 0 ? x : still}
            rotate={index === 0 ? rotate : still}
            opacity={index === 0 ? opacity : opaque}
            progress={progress}
            handoff={handoff}
            reduceMotion={!!reduceMotion}
            onRelease={(offset, velocity) => {
              if (
                Math.abs(offset) > THROW_DISTANCE ||
                Math.abs(velocity) > THROW_VELOCITY
              ) {
                throwCard(offset < 0 ? -1 : 1, velocity);
              } else {
                animate(x, 0, { ...SNAP_BACK, velocity });
              }
            }}
          />
        ))}
        {flights.map((flight) => (
          <FlyingCard
            key={flight.id}
            flight={flight}
            card={cards[flight.card]}
            onLanded={() =>
              setFlights((f) => f.filter((other) => other.id !== flight.id))
            }
          />
        ))}
      </div>
      <div className="flex gap-3">
        <DeckButton label="Throw left" onClick={() => throwCard(-1)}>
          <path d="M13 8H3M7 4 3 8l4 4" />
        </DeckButton>
        <DeckButton label="Throw right" onClick={() => throwCard(1)}>
          <path d="M3 8h10M9 4l4 4-4 4" />
        </DeckButton>
      </div>
    </div>
  );
}

function DeckCard({
  card,
  number,
  index,
  x,
  rotate,
  opacity,
  progress,
  handoff,
  reduceMotion,
  onRelease,
}: {
  card: Card;
  number: number;
  index: number;
  x: MotionValue<number>;
  rotate: MotionValue<number>;
  opacity: MotionValue<number>;
  progress: MotionValue<number>;
  handoff: React.RefObject<number>;
  reduceMotion: boolean;
  onRelease: (offset: number, velocity: number) => void;
}) {
  const top = index === 0;
  // The slot this card is settling into. Springs when the deck advances
  // instead of snapping, which matters most for button throws with no drag.
  const slot = useSpring(index, STEP_FORWARD);
  const previous = useRef(index);

  // Runs inside the throw's flushSync, before the drag offset resets.
  useLayoutEffect(() => {
    const from = previous.current;
    previous.current = index;
    if (from === index) return;
    if (reduceMotion) {
      slot.jump(index);
      return;
    }
    if (from >= VISIBLE && index < VISIBLE) {
      // Coming into view: start a step further back and rise into place,
      // like the next card being slid onto the deck.
      slot.jump(index + 1);
    } else {
      // Carry on from where the drag had visibly pulled it.
      slot.jump(slot.get() - handoff.current);
    }
    slot.set(index);
  }, [index, reduceMotion, slot, handoff]);

  // Every card behind also moves up as the top card is dragged away, so when
  // it leaves, the next one is already exactly in place.
  const depth = useTransform(() => Math.max(slot.get() - progress.get(), 0));
  const y = useTransform(depth, (d) => d * STEP_Y);
  const scale = useTransform(depth, (d) => 1 - d * STEP_SCALE);

  return (
    <motion.article
      aria-hidden={!top}
      drag={top ? "x" : false}
      // Motion coasts on its own after release by default, which would fight
      // the throw and snap-back springs for the same value.
      dragMomentum={false}
      onDragEnd={(_, info) => onRelease(info.offset.x, info.velocity.x)}
      style={{ x, rotate, y, scale, zIndex: 100 - index }}
      // Fades in when it moves up into view, but leaves instantly: the thrown
      // card lands at the back, and a fade there would peek out below the deck.
      className="absolute inset-0 origin-bottom cursor-grab touch-pan-y transition-[opacity] duration-300 ease-out select-none active:cursor-grabbing data-[hidden=true]:opacity-0 data-[hidden=true]:transition-none"
      data-hidden={index >= VISIBLE}
    >
      <CardFace card={card} number={number} opacity={opacity} />
    </motion.article>
  );
}

function FlyingCard({
  flight,
  card,
  onLanded,
}: {
  flight: Flight;
  card: Card;
  onLanded: () => void;
}) {
  const x = useMotionValue(flight.from);
  const y = useMotionValue(0);
  // Starts from exactly the tilt it had when released, then spins on.
  const rotate = useMotionValue(tiltAt(flight.from));
  const scale = useMotionValue(1);
  const { opacity } = useThrowStyle(x);
  const landed = useRef(onLanded);

  useEffect(() => {
    landed.current = onLanded;
  });

  useEffect(() => {
    const out = animate(x, flight.direction * OFFSCREEN, {
      ...THROW,
      velocity: flight.velocity,
    });
    const rest = [
      animate(y, flight.drop, DROP),
      animate(rotate, rotate.get() + flight.direction * flight.spin, SPIN),
      animate(scale, 0.94, SHRINK),
    ];
    // Gone once it has faded out sideways; the lazier springs needn't finish.
    out.then(() => landed.current());
    return () => [out, ...rest].forEach((c) => c.stop());
  }, [x, y, rotate, scale, flight]);

  return (
    <motion.div
      aria-hidden
      style={{ x, y, rotate, scale, zIndex: 200 }}
      className="pointer-events-none absolute inset-0 origin-bottom"
    >
      <CardFace card={card} number={flight.card + 1} opacity={opacity} />
    </motion.div>
  );
}

function CardFace({
  card,
  number,
  opacity,
}: {
  card: Card;
  number: number;
  opacity: MotionValue<number>;
}) {
  return (
    <motion.div
      style={{ opacity }}
      className="flex h-full flex-col justify-between rounded-[24px] bg-background p-6 shadow-raised"
    >
      <span className="font-mono text-xs text-muted tabular-nums">
        {String(number).padStart(2, "0")}
      </span>
      <div>
        <p className="text-xl font-medium tracking-tight text-balance">
          {card.title}
        </p>
        <p className="mt-2 text-sm text-pretty text-muted">{card.note}</p>
      </div>
    </motion.div>
  );
}

function DeckButton({
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
      className="flex size-11 items-center justify-center rounded-full bg-surface text-foreground shadow-raised transition-[scale] duration-150 ease-out active:scale-[0.96] motion-reduce:transition-none"
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

const CARDS: Card[] = [
  {
    title: "Exits are quicker than entrances.",
    note: "Arrive with care, leave out of the way.",
  },
  {
    title: "Animate transform and opacity.",
    note: "Layout properties make the browser redo work every frame.",
  },
  {
    title: "Skip what people do a hundred times a day.",
    note: "Frequent actions should feel instant, not animated.",
  },
  {
    title: "A quick flick should be enough.",
    note: "Judge a gesture by its speed, not only its distance.",
  },
  {
    title: "Nothing appears from scale(0).",
    note: "Start near full size and fade in instead.",
  },
];

export default function SwipeDeckDemo() {
  return <SwipeDeck cards={CARDS} />;
}
