import { useRef, useState } from "react";
import { motion, useSpring, useTransform, type MotionValue } from "motion/react";
import { useReducedMotion } from "@/lib/use-reduced-motion";
import Image from "@/lab/shims/next-image";
import { cn } from "@/lib/cn";

export type Person = { name: string; avatar?: string };

const SIZE = 44;
// Stacked, each avatar hides a third of the one before it.
const CLOSED_STEP = 30;
// Fanned, a 6px gap: close enough to still read as one group.
const OPEN_STEP = 50;
// A touch of bounce so the fan feels like it springs open, not slides.
const FAN = { visualDuration: 0.3, bounce: 0.15 };

// Opaque tints, since overlapping translucent ones would show each other
// through. Written out in full so Tailwind can see every class.
const TINTS = [
  "bg-[color-mix(in_oklab,var(--color-foreground)_8%,var(--color-background))]",
  "bg-[color-mix(in_oklab,var(--color-foreground)_14%,var(--color-background))]",
  "bg-[color-mix(in_oklab,var(--color-foreground)_20%,var(--color-background))]",
  "bg-[color-mix(in_oklab,var(--color-foreground)_11%,var(--color-background))]",
  "bg-[color-mix(in_oklab,var(--color-foreground)_17%,var(--color-background))]",
];

function initials(name: string) {
  return name
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function listNames(names: string[]) {
  if (names.length < 2) return names.join("");
  return `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}

export function AvatarStack({
  people,
  max = 5,
  label = "Members",
  className,
}: {
  people: Person[];
  max?: number;
  label?: string;
  className?: string;
}) {
  const reduceMotion = useReducedMotion();
  const shown = people.slice(0, max);
  const hidden = people.slice(max);
  const count = shown.length + (hidden.length > 0 ? 1 : 0);
  const mid = (count - 1) / 2;

  const step = useSpring(CLOSED_STEP, FAN);
  // Refs, not state: fanning is driven by one motion value, so hover and
  // focus never re-render the stack.
  const hovered = useRef(false);
  const focused = useRef(false);
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  // Roving tabindex: the whole stack is one tab stop, arrows move within it.
  const [active, setActive] = useState(0);

  const update = () => {
    const target = hovered.current || focused.current ? OPEN_STEP : CLOSED_STEP;
    if (reduceMotion) step.jump(target);
    else step.set(target);
  };

  const move = (index: number) => {
    setActive(index);
    buttons.current[index]?.focus();
  };

  const items = [
    ...shown.map((person, i) => ({
      key: person.name,
      text: initials(person.name),
      avatar: person.avatar,
      name: person.name,
      tooltip: person.name,
      tint: TINTS[i % TINTS.length],
    })),
    ...(hidden.length > 0
      ? [
          {
            key: "overflow",
            text: `+${hidden.length}`,
            avatar: undefined,
            name: `${hidden.length} more: ${listNames(hidden.map((p) => p.name))}`,
            tooltip: listNames(hidden.map((p) => p.name)),
            tint: "bg-surface text-muted",
          },
        ]
      : []),
  ];

  return (
    <div
      role="toolbar"
      aria-label={label}
      // Sized for the fanned stack up front, and every avatar is placed from
      // the center, so fanning grows both ways and nothing around it moves.
      style={{ width: (count - 1) * OPEN_STEP + SIZE, height: SIZE }}
      className={cn("relative", className)}
      onPointerEnter={(e) => {
        if (e.pointerType === "touch") return;
        hovered.current = true;
        update();
      }}
      onPointerLeave={(e) => {
        if (e.pointerType === "touch") return;
        hovered.current = false;
        update();
      }}
      onFocus={(e) => {
        // A mouse click also focuses; only keyboard focus should hold it open.
        if (!e.target.matches(":focus-visible")) return;
        focused.current = true;
        update();
      }}
      onBlur={(e) => {
        if (e.currentTarget.contains(e.relatedTarget)) return;
        focused.current = false;
        update();
      }}
      onKeyDown={(e) => {
        const last = count - 1;
        const next =
          e.key === "ArrowRight"
            ? Math.min(active + 1, last)
            : e.key === "ArrowLeft"
              ? Math.max(active - 1, 0)
              : e.key === "Home"
                ? 0
                : e.key === "End"
                  ? last
                  : null;
        if (next === null) return;
        e.preventDefault();
        move(next);
      }}
    >
      {items.map((item, i) => (
        <Slot key={item.key} step={step} offset={i - mid}>
          <button
            ref={(el) => {
              buttons.current[i] = el;
            }}
            type="button"
            tabIndex={i === active ? 0 : -1}
            aria-label={item.name}
            onFocus={() => setActive(i)}
            className={cn(
              "group relative flex size-full touch-manipulation items-center justify-center rounded-full text-sm font-medium text-foreground ring-2 ring-background outline-hidden select-none",
              "transition-[translate,scale] duration-200 ease-[cubic-bezier(0.23,1,0.32,1)]",
              "motion-safe:hover:-translate-y-0.5 motion-safe:hover:scale-105 motion-safe:focus-visible:-translate-y-0.5 motion-safe:focus-visible:scale-105",
              "focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-foreground active:scale-[0.96]",
              // Line-drawn faces are black ink, so they sit on a light circle in
              // both themes, like a printed photo; initials keep the theme tints.
              item.avatar ? "bg-[oklch(0.97_0_0)]" : item.tint,
            )}
          >
            {item.avatar ? (
              <Image
                src={item.avatar}
                alt=""
                width={SIZE}
                height={SIZE}
                unoptimized
                draggable={false}
                className="size-full rounded-full"
              />
            ) : (
              <span aria-hidden>{item.text}</span>
            )}
            {/* Enters in 150ms, leaves in 100ms: the exit never holds the eye. */}
            <span
              aria-hidden
              className={cn(
                "pointer-events-none absolute bottom-full left-1/2 mb-2 -translate-x-1/2 origin-bottom rounded-full bg-foreground px-2.5 py-1 text-xs font-medium whitespace-nowrap text-background",
                "invisible translate-y-0.5 scale-[0.97] opacity-0 transition-[opacity,scale,translate,visibility] duration-100 ease-[cubic-bezier(0.23,1,0.32,1)]",
                "group-hover:visible group-hover:translate-y-0 group-hover:scale-100 group-hover:opacity-100 group-hover:duration-150",
                "group-focus-visible:visible group-focus-visible:translate-y-0 group-focus-visible:scale-100 group-focus-visible:opacity-100 group-focus-visible:duration-150",
                "motion-reduce:translate-y-0 motion-reduce:scale-100",
              )}
            >
              {item.tooltip}
            </span>
          </button>
        </Slot>
      ))}
    </div>
  );
}

function Slot({
  step,
  offset,
  children,
}: {
  step: MotionValue<number>;
  offset: number;
  children: React.ReactNode;
}) {
  const x = useTransform(step, (s) => offset * s);
  return (
    <motion.div
      style={{ x, width: SIZE, marginLeft: -SIZE / 2 }}
      // Lifts whichever avatar is in use above its neighbours and their
      // tooltips.
      className="absolute top-0 left-1/2 h-full hover:z-10 focus-within:z-10"
    >
      {children}
    </motion.div>
  );
}

// Faces are "Notionists" by Zoish, CC0 1.0, stored in public/avatars.
const TEAM: Person[] = [
  { name: "Amara Okafor", avatar: "/avatars/ava.svg" },
  { name: "Jonas Weber", avatar: "/avatars/ben.svg" },
  { name: "Mei Tanaka", avatar: "/avatars/cara.svg" },
  { name: "Rafael Costa", avatar: "/avatars/dev.svg" },
  { name: "Sara Lindqvist", avatar: "/avatars/fay.svg" },
  { name: "Dev Patel" },
  { name: "Ines Moreau" },
  { name: "Tom Hughes" },
];

export default function AvatarStackDemo() {
  return <AvatarStack people={TEAM} label="Project members" />;
}
