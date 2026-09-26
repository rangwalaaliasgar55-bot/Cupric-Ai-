import { useId, useRef, useState } from "react";
import { LayoutGroup, motion } from "motion/react";
import { useReducedMotion } from "@/lib/use-reduced-motion";
import { cn } from "@/lib/cn";

export type Swatch = {
  name: string;
  color: string;
  // Color of the check drawn on the swatch.
  ink: string;
};

const LIGHT_INK = "oklch(0.99 0 0)";
const DARK_INK = "oklch(0.22 0.01 260)";

// The one place raw colors are allowed: these swatches are the data. Muted
// mid-tones (chroma 0.08 to 0.13) so none shouts next to the monochrome UI,
// and all hold their own on either theme's background. Above about L 0.65 a
// white check drops under 3:1, so those swatches take the dark ink instead.
export const THEME_SWATCHES: Swatch[] = [
  { name: "Graphite", color: "oklch(0.42 0.02 260)", ink: LIGHT_INK },
  { name: "Clay", color: "oklch(0.6 0.13 35)", ink: LIGHT_INK },
  { name: "Ochre", color: "oklch(0.78 0.12 80)", ink: DARK_INK },
  { name: "Sage", color: "oklch(0.72 0.08 145)", ink: DARK_INK },
  { name: "Teal", color: "oklch(0.58 0.08 210)", ink: LIGHT_INK },
  { name: "Iris", color: "oklch(0.56 0.13 280)", ink: LIGHT_INK },
  { name: "Rose", color: "oklch(0.7 0.1 0)", ink: DARK_INK },
];

// No bounce: a ring that overshoots would briefly circle the wrong color.
const RING = { type: "spring", duration: 0.3, bounce: 0 } as const;
const ICON_SWAP = { type: "spring", duration: 0.3, bounce: 0 } as const;
const INSTANT = { duration: 0 } as const;

export function ColorSwatches({
  swatches,
  value,
  onChange,
  label,
  className,
}: {
  swatches: Swatch[];
  value: string;
  onChange: (name: string) => void;
  label: string;
  className?: string;
}) {
  const reduceMotion = useReducedMotion();
  // Scopes the ring's layoutId, so two pickers on a page never trade rings.
  const group = useId();
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  const selected = Math.max(
    swatches.findIndex((s) => s.name === value),
    0,
  );

  // Radio pattern: arrows move focus and selection together, wrapping.
  const onKeyDown = (event: React.KeyboardEvent) => {
    const last = swatches.length - 1;
    const forward = selected === last ? 0 : selected + 1;
    const back = selected === 0 ? last : selected - 1;
    const next: Record<string, number> = {
      ArrowRight: forward,
      ArrowDown: forward,
      ArrowLeft: back,
      ArrowUp: back,
      Home: 0,
      End: last,
    };
    const index = next[event.key];
    if (index === undefined) return;
    event.preventDefault();
    onChange(swatches[index].name);
    buttons.current[index]?.focus();
  };

  return (
    <LayoutGroup id={group}>
      <div
        role="radiogroup"
        aria-label={label}
        onKeyDown={onKeyDown}
        className={cn("flex items-center gap-3", className)}
      >
        {swatches.map((swatch, index) => {
          const checked = index === selected;
          return (
            <button
              key={swatch.name}
              ref={(node) => {
                buttons.current[index] = node;
              }}
              type="button"
              role="radio"
              aria-checked={checked}
              aria-label={swatch.name}
              tabIndex={checked ? 0 : -1}
              onClick={() => onChange(swatch.name)}
              style={{ backgroundColor: swatch.color, color: swatch.ink }}
              className={cn(
                "relative flex size-8 touch-manipulation items-center justify-center rounded-full outline-hidden transition-[scale] duration-150 ease-out select-none active:scale-[0.96] motion-reduce:transition-none",
                // The image outline recipe, so a light swatch keeps its edge
                // on a light background and a dark one on a dark background.
                "shadow-[inset_0_0_0_1px_oklch(0_0_0/0.1)] dark:shadow-[inset_0_0_0_1px_oklch(1_0_0/0.1)]",
                // Clears the 4px ring with a 2px gap.
                "focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-[6px] focus-visible:outline-foreground",
                // Grows the hit area to 40px without growing the circle.
                "after:absolute after:-inset-1 after:rounded-full",
              )}
            >
              {checked && (
                <motion.span
                  layoutId="ring"
                  aria-hidden
                  transition={reduceMotion ? INSTANT : RING}
                  // 2px gap, then a 2px ring: a 32px swatch in a 40px ring.
                  className="pointer-events-none absolute -inset-1 rounded-full border-2 border-foreground"
                />
              )}
              <motion.svg
                aria-hidden
                viewBox="0 0 16 16"
                className="size-4"
                fill="none"
                stroke="currentColor"
                // Heavier than the lab's usual 1.5: it sits alone on
                // saturated color, with no text beside it to match.
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
                initial={false}
                animate={
                  checked
                    ? { scale: 1, opacity: 1, filter: "blur(0px)" }
                    : reduceMotion
                      ? { scale: 1, opacity: 0, filter: "blur(0px)" }
                      : { scale: 0.25, opacity: 0, filter: "blur(4px)" }
                }
                transition={ICON_SWAP}
              >
                <path d="m3.5 8.5 3 3 6-7" />
              </motion.svg>
            </button>
          );
        })}
      </div>
    </LayoutGroup>
  );
}

const EASE_OUT = [0.23, 1, 0.32, 1] as const;
// Each accent surface floods in 300ms. They start 45ms apart, so the color
// runs through the preview in the order you read it (about 435ms end to
// end); decorative, and nothing waits on it.
const FLOOD_MS = 300;
const FLOOD_STAGGER = 45;

type Layer = { id: number; color: string; origin: number };

// Paints a surface in the chosen color by spreading it as a circle from the
// side the swatch sits on: pick Graphite and it pours in from the left,
// Rose from the right. The old color stays underneath until covered.
function Flood({
  color,
  origin,
  order,
  className,
  children,
}: {
  color: string;
  origin: number;
  order: number;
  className?: string;
  children?: React.ReactNode;
}) {
  const reduceMotion = useReducedMotion();
  const [layers, setLayers] = useState<Layer[]>([{ id: 0, color, origin }]);
  const [shown, setShown] = useState(color);
  if (color !== shown) {
    setShown(color);
    // Three is enough for rapid picks: the newest spreads over the previous
    // one, which may itself still be spreading over the settled color.
    setLayers((l) => [...l.slice(-2), { id: l[l.length - 1].id + 1, color, origin }]);
  }
  const delay = (order * FLOOD_STAGGER) / 1000;

  return (
    <span className={cn("relative isolate overflow-hidden", className)}>
      {layers.map((layer) => {
        const at = `${layer.origin * 100}% 50%`;
        return (
          <motion.span
            key={layer.id}
            aria-hidden
            className="absolute inset-0"
            style={{ backgroundColor: layer.color }}
            initial={
              layer.id === 0
                ? false
                : reduceMotion
                  ? { opacity: 0 }
                  : { clipPath: `circle(0% at ${at})` }
            }
            // 150% of a circle's reference radius clears the far corner of
            // any of these shapes, even from an edge origin.
            animate={
              reduceMotion ? { opacity: 1 } : { clipPath: `circle(150% at ${at})` }
            }
            transition={{ duration: FLOOD_MS / 1000, ease: EASE_OUT, delay }}
          />
        );
      })}
      {children}
    </span>
  );
}

export default function ColorSwatchesDemo() {
  const [value, setValue] = useState("Clay");
  const index = Math.max(
    THEME_SWATCHES.findIndex((s) => s.name === value),
    0,
  );
  const swatch = THEME_SWATCHES[index];
  const origin = index / (THEME_SWATCHES.length - 1);
  const flood = { color: swatch.color, origin };

  return (
    <div className="flex w-[min(380px,100%)] flex-col items-center gap-6">
      <ColorSwatches
        swatches={THEME_SWATCHES}
        value={value}
        onChange={setValue}
        label="Theme color"
      />
      {/* A preview, not a real control: the chosen color applied to a small
          settings card. Screen readers already hear the choice from the
          radio, so the whole card is hidden from them. */}
      <div
        aria-hidden
        className="flex w-full flex-col gap-5 rounded-[20px] bg-background p-5 shadow-raised"
      >
        <div className="flex items-center justify-between">
          <span className="flex h-7 items-center gap-2 rounded-full bg-surface pr-3 pl-2.5 text-[13px] font-medium text-foreground">
            <Flood {...flood} order={0} className="size-2.5 rounded-full" />
            {/* Every name shares one grid cell, so the tag keeps the width of
                the longest and never jumps; the new one blurs in. */}
            <span className="grid">
              {THEME_SWATCHES.map((s) => (
                <span
                  key={s.name}
                  className={cn(
                    "col-start-1 row-start-1 transition-[opacity,filter,translate] ease-[cubic-bezier(0.23,1,0.32,1)] motion-reduce:transition-[opacity]",
                    s.name === value
                      ? "translate-y-0 opacity-100 blur-[0px] duration-200"
                      : "translate-y-0.5 opacity-0 blur-[4px] duration-150 motion-reduce:translate-y-0",
                  )}
                >
                  {s.name}
                </span>
              ))}
            </span>
          </span>
          {/* An "on" switch: 40 by 24 track, 18px knob with a 3px inset. The
              knob is raw white on purpose: it sits on the swatch color, not
              on the page, so it must not flip with the theme. */}
          <Flood {...flood} order={1} className="flex h-6 w-10 items-center rounded-full p-[3px]">
            <span className="relative ml-auto size-[18px] rounded-full bg-[oklch(0.99_0_0)] shadow-[0_1px_2px_oklch(0_0_0/0.2)]" />
          </Flood>
        </div>

        <div className="flex flex-col gap-2">
          <div className="flex justify-between text-[13px]">
            <span className="text-muted">Storage</span>
            <span className="font-medium text-foreground tabular-nums">64%</span>
          </div>
          <span className="h-1.5 w-full overflow-hidden rounded-full bg-surface">
            <Flood {...flood} order={2} className="block h-full w-[64%] rounded-full" />
          </span>
        </div>

        <div className="flex justify-end gap-2">
          <span className="flex h-9 items-center rounded-full px-4 text-sm font-medium text-muted">
            Cancel
          </span>
          <Flood
            {...flood}
            order={3}
            className="flex h-9 items-center rounded-full px-4 text-sm font-medium"
          >
            {/* The ink changes as the flood arrives, not before it. */}
            <span
              style={{
                color: swatch.ink,
                transitionDelay: `${3 * FLOOD_STAGGER + 60}ms`,
              }}
              className="relative transition-[color] duration-200 ease-out motion-reduce:transition-none"
            >
              Save changes
            </span>
          </Flood>
        </div>
      </div>
    </div>
  );
}
