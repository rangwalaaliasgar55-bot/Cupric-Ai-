import { useId, useRef, useState } from "react";
import { LayoutGroup, motion } from "motion/react";
import { useReducedMotion } from "@/lib/use-reduced-motion";
import { cn } from "@/lib/cn";

export type Billing = "monthly" | "yearly";

export type Plan = {
  name: string;
  blurb: string;
  monthly: number;
  yearly: number;
  features: string[];
  featured?: boolean;
};

const EASE = "ease-[cubic-bezier(0.23,1,0.32,1)]";
const THUMB = { type: "spring", duration: 0.3, bounce: 0 } as const;
// Longer than a usual UI move because a digit can travel up to nine places;
// any faster and the roll reads as a flicker rather than counting.
const ROLL = { type: "spring", duration: 0.5, bounce: 0 } as const;
const OPTIONS: { value: Billing; label: string }[] = [
  { value: "monthly", label: "Monthly" },
  { value: "yearly", label: "Yearly" },
];

export function BillingToggle({
  value,
  onChange,
  saving,
}: {
  value: Billing;
  onChange: (value: Billing) => void;
  saving: string;
}) {
  const reduceMotion = useReducedMotion();
  const group = useId();
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  const yearly = value === "yearly";

  return (
    <div className="relative">
      <LayoutGroup id={group}>
        {/* 4px of padding around 36px pills keeps the radii concentric: 22 = 18 + 4. */}
        <div role="radiogroup" aria-label="Billing period" className="flex h-11 rounded-full bg-surface p-1">
          {OPTIONS.map((option, i) => {
            const checked = option.value === value;
            return (
              <button
                key={option.value}
                ref={(el) => {
                  buttons.current[i] = el;
                }}
                type="button"
                role="radio"
                aria-checked={checked}
                tabIndex={checked ? 0 : -1}
                onClick={() => onChange(option.value)}
                onKeyDown={(e) => {
                  if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)) return;
                  e.preventDefault();
                  const next = (i + 1) % OPTIONS.length;
                  onChange(OPTIONS[next].value);
                  buttons.current[next]?.focus();
                }}
                className={cn(
                  "relative h-9 touch-manipulation rounded-full px-4 text-sm font-medium outline-hidden transition-[scale,color] duration-150 ease-out select-none focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-foreground active:scale-[0.96] motion-reduce:transition-[color]",
                  checked ? "text-foreground" : "text-muted hover:text-foreground",
                )}
              >
                {checked && (
                  <motion.span
                    layoutId="billing-thumb"
                    transition={reduceMotion ? { duration: 0 } : THUMB}
                    className="absolute inset-0 rounded-full bg-background shadow-raised"
                  />
                )}
                <span className="relative">{option.label}</span>
                {option.value === "yearly" && <span className="sr-only">, {saving}</span>}
              </button>
            );
          })}
        </div>
      </LayoutGroup>
      {/* Hangs off the right edge out of flow, so it never nudges the toggle.
          Grows from its left edge, the side touching the option it describes. */}
      <motion.span
        aria-hidden
        initial={false}
        animate={
          yearly
            ? { opacity: 1, scale: 1, filter: "blur(0px)" }
            : reduceMotion
              ? { opacity: 0 }
              : { opacity: 0, scale: 0.9, filter: "blur(4px)" }
        }
        // Leaving is quicker and plain: a tag you just turned off shouldn't linger.
        transition={yearly ? THUMB : { duration: 0.15, ease: [0.23, 1, 0.32, 1] }}
        className="absolute top-1/2 left-full ml-2 flex h-7 origin-left -translate-y-1/2 items-center rounded-full border border-border px-2.5 text-[13px] font-medium whitespace-nowrap text-foreground"
      >
        {saving}
      </motion.span>
    </div>
  );
}

// Rolls each digit to its new value in its own column, like an odometer.
// Columns are keyed by place value, so "9" to "86" keeps the ones column and
// grows a tens column beside it.
export function RollingNumber({ value, className }: { value: number; className?: string }) {
  const digits = String(Math.round(Math.abs(value)));
  // Holds every column this number has ever needed, so a column that is no
  // longer used can still shrink away instead of vanishing.
  const [slots, setSlots] = useState(digits.length);
  if (digits.length > slots) setSlots(digits.length);
  // Columns present on first render just appear; only later ones grow in.
  const [initialSlots] = useState(digits.length);

  return (
    <span aria-hidden className={cn("inline-flex tabular-nums", className)}>
      {Array.from({ length: slots }, (_, i) => {
        const place = slots - 1 - i;
        const index = digits.length - 1 - place;
        return (
          <DigitColumn
            key={place}
            digit={index >= 0 ? Number(digits[index]) : null}
            grow={place >= initialSlots}
          />
        );
      })}
    </span>
  );
}

function DigitColumn({ digit, grow }: { digit: number | null; grow: boolean }) {
  const reduceMotion = useReducedMotion();
  // A column on its way out keeps showing its last digit while it shrinks.
  const [shown, setShown] = useState(digit ?? 0);
  if (digit !== null && digit !== shown) setShown(digit);
  const present = digit !== null;

  return (
    <span
      className={cn(
        // 1ch is exactly one tabular digit wide, so a present column never
        // needs measuring. Width only moves when a digit is added or removed.
        "relative inline-block h-[1.2em] overflow-hidden transition-[width,opacity,filter] duration-400 motion-reduce:transition-[opacity]",
        EASE,
        present ? "w-[1ch] opacity-100 blur-[0px]" : "w-0 opacity-0 blur-[2px]",
        // A column added after mount starts collapsed and widens, pushing the
        // suffix over smoothly rather than jumping it.
        grow && "starting:w-0 starting:opacity-0 starting:blur-[2px]",
        // Softens the edges so digits roll in and out rather than being cut.
        "[mask-image:linear-gradient(transparent,black_18%,black_82%,transparent)]",
      )}
    >
      <motion.span
        className="absolute inset-x-0 top-0 flex flex-col"
        initial={false}
        animate={{ y: `${-shown * 10}%` }}
        transition={reduceMotion ? { duration: 0 } : ROLL}
      >
        {Array.from({ length: 10 }, (_, n) => (
          <span key={n} className="block h-[1.2em] text-center leading-[1.2em]">
            {n}
          </span>
        ))}
      </motion.span>
    </span>
  );
}

export function PricingTable({
  plans,
  saving = "Save 20%",
  defaultBilling = "monthly",
  className,
}: {
  plans: Plan[];
  saving?: string;
  defaultBilling?: Billing;
  className?: string;
}) {
  const [billing, setBilling] = useState<Billing>(defaultBilling);
  const yearly = billing === "yearly";

  return (
    <div className={cn("flex w-[560px] max-w-full flex-col items-center gap-6", className)}>
      <BillingToggle value={billing} onChange={setBilling} saving={saving} />
      <div className="grid w-full grid-cols-[repeat(auto-fit,minmax(160px,1fr))] gap-3">
        {plans.map((plan) => {
          const price = yearly ? plan.yearly : plan.monthly;
          return (
            <div
              key={plan.name}
              className={cn(
                "flex flex-col rounded-2xl p-4",
                plan.featured ? "bg-background shadow-raised" : "border border-border",
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-[15px] font-medium text-foreground">{plan.name}</h3>
                {plan.featured && <span className="text-xs text-muted">Popular</span>}
              </div>
              <p className="mt-1 text-sm text-pretty text-muted">{plan.blurb}</p>

              {/* Bottom-aligned rather than baseline: the clipped digit columns have
                  no text baseline of their own. */}
              <p className="mt-4 flex items-end text-foreground">
                <span className="sr-only">
                  ${price} per {yearly ? "year" : "month"}
                </span>
                <span aria-hidden className="text-[32px] leading-[1.2] font-semibold">
                  $
                </span>
                <RollingNumber value={price} className="text-[32px] font-semibold" />
                {/* Both suffixes share one grid cell, so swapping them never
                    moves the price. */}
                {/* 5px lifts the small suffix onto the digits' baseline. */}
                <span aria-hidden className="mb-[5px] ml-1 grid text-sm text-muted">
                  {(["/mo", "/yr"] as const).map((suffix) => {
                    const on = (suffix === "/yr") === yearly;
                    return (
                      <span
                        key={suffix}
                        className={cn(
                          "col-start-1 row-start-1 transition-[opacity,filter] ease-out",
                          on ? "opacity-100 blur-[0px] duration-200" : "opacity-0 blur-[4px] duration-150",
                        )}
                      >
                        {suffix}
                      </span>
                    );
                  })}
                </span>
              </p>

              <ul className="mt-4 flex flex-1 flex-col gap-2 text-sm text-muted">
                {plan.features.map((feature) => (
                  <li key={feature} className="flex items-start gap-2">
                    <svg
                      viewBox="0 0 16 16"
                      aria-hidden
                      className="mt-0.5 size-4 shrink-0 text-foreground"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth={1.5}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="m3.5 8.5 3 3 6-7" />
                    </svg>
                    {feature}
                  </li>
                ))}
              </ul>

              <button
                type="button"
                className={cn(
                  "mt-5 h-10 touch-manipulation rounded-lg text-sm font-medium outline-hidden transition-[scale,background-color] duration-150 ease-out select-none focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-foreground active:scale-[0.96] motion-reduce:transition-[background-color]",
                  plan.featured
                    ? "bg-foreground text-background hover:bg-foreground/90"
                    : "bg-surface text-foreground hover:bg-foreground/[0.08]",
                )}
              >
                Choose {plan.name}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

const PLANS: Plan[] = [
  {
    name: "Starter",
    blurb: "For side projects.",
    monthly: 9,
    yearly: 86,
    features: ["3 projects", "Basic analytics", "Email support"],
  },
  {
    name: "Pro",
    blurb: "For growing products.",
    monthly: 24,
    yearly: 230,
    features: ["Unlimited projects", "Full analytics", "Priority support"],
    featured: true,
  },
  {
    name: "Team",
    blurb: "For whole companies.",
    monthly: 59,
    yearly: 566,
    features: ["Everything in Pro", "Shared workspaces", "SSO and audit log"],
  },
];

export default function PricingToggleDemo() {
  return <PricingTable plans={PLANS} />;
}
