import { useId, useState } from "react";
import { LayoutGroup, motion } from "motion/react";
import { useReducedMotion } from "@/lib/use-reduced-motion";
import { cn } from "@/lib/cn";

type Option = {
  value: string;
  title: string;
  description: string;
  price: string;
  period?: string;
  badge?: string;
};

const RING = { type: "spring", duration: 0.3, bounce: 0 } as const;
const ICON_SWAP = { type: "spring", duration: 0.3, bounce: 0 } as const;
// The one bounce in the component: the dot filling is the confirmation, and
// a small overshoot makes it land rather than just appear.
const DOT_IN = { type: "spring", duration: 0.35, bounce: 0.35 } as const;
const DOT_OUT = { duration: 0.15, ease: [0.23, 1, 0.32, 1] } as const;
const INSTANT = { duration: 0 } as const;

export function RadioCards({
  options,
  value,
  onChange,
  label,
  name,
  className,
}: {
  options: Option[];
  value: string;
  onChange: (value: string) => void;
  label: string;
  name?: string;
  className?: string;
}) {
  const reduceMotion = useReducedMotion();
  // Scopes the ring's layoutId and the radio name, so two groups on one
  // page never trade rings or selections.
  const id = useId();

  return (
    <LayoutGroup id={id}>
      <fieldset className={cn("w-[min(480px,100%)] min-w-0", className)}>
        <legend className="mb-3 text-[15px] font-medium text-foreground">
          {label}
        </legend>
        {/* Equal rows keep every card the same size, so the ring only ever
            translates between them and its 2px border never stretches. */}
        <div className="grid auto-rows-fr gap-3">
          {options.map((option) => {
            const selected = option.value === value;
            return (
              <label
                key={option.value}
                className={cn(
                  "group relative flex cursor-pointer touch-manipulation items-center gap-4 rounded-2xl bg-background p-4 shadow-raised select-none",
                  // 0.98 rather than the usual 0.96: on a card this wide, 4%
                  // moves its edges nearly 10px and reads as a lurch.
                  "transition-[scale,background-color] duration-150 ease-out hover:bg-surface active:scale-[0.98] motion-reduce:transition-[background-color]",
                  "has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-solid has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-foreground",
                  // The ring lives in the selected card, so lifting that card
                  // keeps the ring above its neighbours as it slides across
                  // them, even while the press scale traps it in this card.
                  selected && "z-10",
                )}
              >
                <input
                  type="radio"
                  name={name ?? id}
                  value={option.value}
                  checked={selected}
                  onChange={() => onChange(option.value)}
                  className="sr-only"
                />
                {selected && (
                  <motion.span
                    layoutId="ring"
                    aria-hidden
                    transition={reduceMotion ? INSTANT : RING}
                    className="pointer-events-none absolute inset-0 rounded-2xl border-2 border-foreground"
                  />
                )}
                <Dot selected={selected} reduceMotion={Boolean(reduceMotion)} />
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="flex items-center gap-2">
                    <span className="text-[15px] font-semibold text-foreground">
                      {option.title}
                    </span>
                    {option.badge && (
                      <span className="rounded-full bg-surface px-2 py-0.5 text-xs font-medium text-muted transition-[background-color] duration-150 ease-out group-hover:bg-background">
                        {option.badge}
                      </span>
                    )}
                  </span>
                  <span className="text-sm text-pretty text-muted">
                    {option.description}
                  </span>
                </span>
                <span className="flex shrink-0 items-baseline gap-0.5">
                  <span className="text-lg font-semibold text-foreground tabular-nums">
                    {option.price}
                  </span>
                  {option.period && (
                    <span className="text-[13px] text-muted">
                      {option.period}
                    </span>
                  )}
                </span>
              </label>
            );
          })}
        </div>
      </fieldset>
    </LayoutGroup>
  );
}

function Dot({
  selected,
  reduceMotion,
}: {
  selected: boolean;
  reduceMotion: boolean;
}) {
  return (
    <span
      aria-hidden
      className={cn(
        "relative grid size-5 shrink-0 place-items-center rounded-full border-[1.5px] transition-[border-color] duration-150 ease-out",
        selected
          ? "border-foreground"
          : "border-foreground/25 group-hover:border-foreground/45",
      )}
    >
      {/* Covers the border too, so the filled dot is exactly 20px. Starts at
          half size, never zero: it grows out of the ring's own center. */}
      <motion.span
        className="absolute -inset-[1.5px] rounded-full bg-foreground"
        initial={false}
        animate={
          selected
            ? { scale: 1, opacity: 1 }
            : { scale: reduceMotion ? 1 : 0.5, opacity: 0 }
        }
        transition={reduceMotion ? DOT_OUT : selected ? DOT_IN : DOT_OUT}
      />
      <motion.svg
        viewBox="0 0 16 16"
        className="relative size-3 text-background"
        fill="none"
        stroke="currentColor"
        // Heavier than the lab's usual 1.5: at 12px a thinner check turns
        // to a hairline against the filled dot.
        strokeWidth={2.25}
        strokeLinecap="round"
        strokeLinejoin="round"
        initial={false}
        animate={
          selected
            ? { scale: 1, opacity: 1, filter: "blur(0px)" }
            : reduceMotion
              ? { scale: 1, opacity: 0, filter: "blur(0px)" }
              : { scale: 0.25, opacity: 0, filter: "blur(4px)" }
        }
        transition={ICON_SWAP}
      >
        <path d="m3.5 8.5 3 3 6-7" />
      </motion.svg>
    </span>
  );
}

const PLANS: Option[] = [
  {
    value: "hobby",
    title: "Hobby",
    description: "For side projects and trying things out.",
    price: "$0",
    period: "/mo",
  },
  {
    value: "pro",
    title: "Pro",
    description: "Unlimited projects and custom domains.",
    price: "$12",
    period: "/mo",
    badge: "Popular",
  },
  {
    value: "team",
    title: "Team",
    description: "Shared workspaces, roles and priority support.",
    price: "$32",
    period: "/mo",
  },
];

export default function RadioCardsDemo() {
  const [plan, setPlan] = useState("pro");
  return (
    <RadioCards
      label="Choose a plan"
      options={PLANS}
      value={plan}
      onChange={setPlan}
    />
  );
}
