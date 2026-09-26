import { useEffect, useId, useRef, useState } from "react";
import {
  animate,
  AnimatePresence,
  motion,
  useMotionValue,
  useTransform,
} from "motion/react";
import { useReducedMotion } from "@/lib/use-reduced-motion";
import { cn } from "@/lib/cn";

export type GarmentSize = {
  label: string;
  // Garment measurements in cm: chest is the full circumference, length runs
  // from the high point of the shoulder to the hem.
  chest: number;
  length: number;
  sleeve: number;
  inStock: boolean;
};

type Unit = "cm" | "in";

// The morph is the explanation here: you watch the tee grow over the body,
// so it runs a little longer than a 300ms UI change. A spring keeps its
// velocity when you tap through sizes quickly.
const MORPH = { type: "spring", duration: 0.5, bounce: 0.12 } as const;
const EASE_OUT = [0.23, 1, 0.32, 1] as const;
const ROLL = { type: "spring", duration: 0.35, bounce: 0 } as const;

// Drawing scale: viewBox px per cm of garment.
const K = 1.6;
const CX = 120;
// High point of the shoulder, where the collar sits.
const NECK_Y = 60;
const SHOULDER_Y = 67;
// Sleeves hang out at about 28 degrees from vertical, a little wider than
// the arms, the way a tee sits on a shoulder.
const SLEEVE_DIR = { x: 0.47, y: 0.883 };
// Garment colour, a physical material: the "Bone" colourway.
const BONE = "oklch(0.94 0.018 85)";
const SEAM = "oklch(0.62 0.03 75)";

function teePath(chest: number, length: number, sleeve: number) {
  const ch = (chest / 4) * K;
  const sh = ch + 5;
  const armpitY = SHOULDER_Y + 32;
  const hh = ch + 2;
  const hemY = NECK_Y + length * K;
  const sl = sleeve * K;
  const ox = sh + SLEEVE_DIR.x * sl;
  const oy = SHOULDER_Y + SLEEVE_DIR.y * sl;
  // Wider tees get wider sleeve openings.
  const open = 17 + (chest - 96) * 0.12;
  const ix = ox - SLEEVE_DIR.y * open;
  const iy = oy + SLEEVE_DIR.x * open;
  const p = (x: number, y: number) => `${(CX + x).toFixed(2)} ${y.toFixed(2)}`;
  return [
    `M${p(-12, NECK_Y)}`,
    `Q${p(0, NECK_Y + 15)} ${p(12, NECK_Y)}`,
    `L${p(sh, SHOULDER_Y)}`,
    `L${p(ox, oy)}`,
    `L${p(ix, iy)}`,
    `L${p(ch, armpitY)}`,
    `L${p(hh, hemY)}`,
    `Q${p(0, hemY + 4)} ${p(-hh, hemY)}`,
    `L${p(-ch, armpitY)}`,
    `L${p(-ix, iy)}`,
    `L${p(-ox, oy)}`,
    `L${p(-sh, SHOULDER_Y)}`,
    "Z",
  ].join(" ");
}

// The stitching that makes the outline read as a garment: the rib around
// the collar, the sleeve hems and the bottom hem, each inset a few px from
// the edge it finishes. Same maths as teePath, so it morphs in lockstep.
function teeSeams(chest: number, length: number, sleeve: number) {
  const ch = (chest / 4) * K;
  const sh = ch + 5;
  const hh = ch + 2;
  const hemY = NECK_Y + length * K;
  const sl = sleeve * K;
  const ox = sh + SLEEVE_DIR.x * sl;
  const oy = SHOULDER_Y + SLEEVE_DIR.y * sl;
  const open = 17 + (chest - 96) * 0.12;
  const ix = ox - SLEEVE_DIR.y * open;
  const iy = oy + SLEEVE_DIR.x * open;
  // Sleeve hem sits 4px up the sleeve from its opening.
  const bx = SLEEVE_DIR.x * 4;
  const by = SLEEVE_DIR.y * 4;
  const p = (x: number, y: number) => `${(CX + x).toFixed(2)} ${y.toFixed(2)}`;
  return [
    `M${p(-15, NECK_Y + 0.5)} Q${p(0, NECK_Y + 20)} ${p(15, NECK_Y + 0.5)}`,
    `M${p(ox - bx, oy - by)} L${p(ix - bx, iy - by)}`,
    `M${p(-(ox - bx), oy - by)} L${p(-(ix - bx), iy - by)}`,
    `M${p(-hh + 1, hemY - 5)} Q${p(0, hemY - 1)} ${p(hh - 1, hemY - 5)}`,
  ].join(" ");
}

// One side of the body outline, mirrored for the other, scaled so the
// torso's half width at chest height is bodyChest / 4 * K.
function bodyPath(chest: number) {
  const w = (chest / 4) * K;
  const side = (s: 1 | -1) => {
    const p = (x: number, y: number) => `${CX + s * x} ${y}`;
    return [
      `M${p(7, 47)} L${p(7, 55)}`,
      `C${p(16, 60)} ${p(w - 2, 59)} ${p(w + 7, 67)}`,
      `C${p(w + 13, 73)} ${p(w + 15, 84)} ${p(w + 18, 98)}`,
      `L${p(w + 36, 178)}`,
      `Q${p(w + 34, 190)} ${p(w + 25, 181)}`,
      `L${p(w + 7, 112)}`,
      `C${p(w + 5, 106)} ${p(w + 2, 104)} ${p(w, 106)}`,
      `C${p(w - 1.5, 130)} ${p(w - 4, 146)} ${p(w - 4, 162)}`,
      `C${p(w - 3.5, 184)} ${p(w + 1.5, 198)} ${p(w + 1.5, 214)}`,
      `L${p(w, 250)}`,
    ].join(" ");
  };
  return `${side(-1)} ${side(1)}`;
}

function fitFor(ease: number) {
  if (ease < 0) return "Too snug, pulls across the chest";
  if (ease < 4) return "Fitted, close to the body";
  if (ease < 11) return "Regular, easy through the chest";
  if (ease < 19) return "Relaxed through the chest";
  return "Oversized, drops past the shoulder";
}

const toUnit = (cm: number, unit: Unit) =>
  unit === "cm" ? Math.round(cm) : Math.round(cm / 2.54);

export function SizePicker({
  name,
  price,
  sizes,
  bodyChest,
  defaultSize,
  onAdd,
  className,
}: {
  name: string;
  price: string;
  sizes: GarmentSize[];
  // The shopper's chest circumference in cm; the outline is drawn for it.
  bodyChest: number;
  defaultSize?: string;
  onAdd?: (size: string) => void;
  className?: string;
}) {
  const reduceMotion = useReducedMotion();
  const labelId = useId();
  // The first size with 4 to 11cm of room (a regular fit) is our pick.
  const suggested =
    sizes.find((s) => s.chest - bodyChest >= 4 && s.chest - bodyChest < 11)
      ?.label ?? sizes[0].label;
  const [selected, setSelected] = useState(defaultSize ?? suggested);
  const [unit, setUnit] = useState<Unit>("cm");
  const [notified, setNotified] = useState<string[]>([]);
  const [added, setAdded] = useState<string | null>(null);
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);

  const index = Math.max(
    0,
    sizes.findIndex((s) => s.label === selected),
  );
  const size = sizes[index];
  const ease = size.chest - bodyChest;
  const fit = fitFor(ease);
  const tight = ease < 0;

  // One fractional size index drives the whole silhouette, so an interrupted
  // morph carries on from wherever it is.
  const at = useMotionValue(index);
  useEffect(() => {
    if (reduceMotion) {
      at.jump(index);
      return;
    }
    const run = animate(at, index, MORPH);
    return () => run.stop();
  }, [at, index, reduceMotion]);

  const measure = (v: number) => {
    // The spring overshoots a little past the ends; clamp so it never
    // reads outside the size table.
    const i = Math.max(0, Math.min(sizes.length - 1, v));
    const a = sizes[Math.floor(i)];
    const b = sizes[Math.ceil(i)];
    const t = i - Math.floor(i);
    const mix = (k: "chest" | "length" | "sleeve") => a[k] + (b[k] - a[k]) * t;
    return [mix("chest"), mix("length"), mix("sleeve")] as const;
  };
  const d = useTransform(at, (v) => teePath(...measure(v)));
  const seams = useTransform(at, (v) => teeSeams(...measure(v)));

  const choose = (i: number) => {
    setSelected(sizes[i].label);
    setAdded(null);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    const keys: Record<string, number> = {
      ArrowRight: index + 1,
      ArrowDown: index + 1,
      ArrowLeft: index - 1,
      ArrowUp: index - 1,
      Home: 0,
      End: sizes.length - 1,
    };
    if (!(e.key in keys)) return;
    e.preventDefault();
    const next = (keys[e.key] + sizes.length) % sizes.length;
    choose(next);
    buttons.current[next]?.focus();
  };

  const isNotified = notified.includes(size.label);
  const done = size.inStock ? added === size.label : isNotified;
  const cta = size.inStock
    ? done
      ? `Added ${size.label} to bag`
      : `Add ${size.label} to bag`
    : done
      ? `We'll email you when ${size.label} is back`
      : `Notify me when ${size.label} is back`;

  return (
    <div
      className={cn(
        "w-[min(460px,100%)] rounded-3xl bg-background p-5 shadow-raised",
        className,
      )}
    >
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-[15px] font-medium text-foreground">{name}</h3>
        <p className="text-[15px] text-muted tabular-nums">{price}</p>
      </div>

      <div className="mt-3 grid grid-cols-[minmax(0,132px)_minmax(0,1fr)] gap-4 sm:grid-cols-[minmax(0,196px)_minmax(0,1fr)]">
        <svg
          // Cropped to the figure: hands reach x 42 to 198, the head tops out at 18.
          viewBox="30 10 180 240"
          className="aspect-[180/240] w-full rounded-2xl bg-surface"
          role="img"
          aria-label={`Size ${size.label} tee drawn over a ${bodyChest} cm chest: ${fit.toLowerCase()}`}
        >
          {/* The tee is the product, so it wears its real colour in both
              themes: bone cotton with a slightly darker edge and seams. */}
          <motion.path
            d={d}
            strokeLinejoin="round"
            strokeWidth={1.5}
            style={{ fill: BONE }}
            className={cn(
              "transition-[stroke] duration-200 ease-out",
              tight ? "stroke-danger" : "stroke-[oklch(0.5_0.03_70)]",
            )}
          />
          <motion.path
            d={seams}
            fill="none"
            strokeWidth={0.9}
            strokeDasharray="2 1.6"
            strokeLinecap="round"
            style={{ stroke: SEAM }}
          />
          {/* The body sits over the tee, dashed, so the gap between the two
              lines is the room you get. Where the tee is too small, the body
              pokes out past it. */}
          <g
            className="fill-none stroke-muted"
            strokeWidth={1.25}
            strokeDasharray="3 3"
            strokeLinecap="round"
          >
            <circle cx={CX} cy={32} r={14} />
            <path d={bodyPath(bodyChest)} />
          </g>
        </svg>

        <div className="flex min-w-0 flex-col">
          <p className="text-[13px] text-muted">Fits like</p>
          {/* Tall enough for the longest note (three lines on a phone, two
              from sm up), so nothing below shifts with the copy. */}
          <div className="relative mt-0.5 h-[60px] sm:h-[42px]">
            <AnimatePresence initial={false} mode="popLayout">
              <motion.p
                key={fit}
                initial={
                  reduceMotion
                    ? { opacity: 0 }
                    : { opacity: 0, y: 6, filter: "blur(4px)" }
                }
                animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                exit={
                  reduceMotion
                    ? { opacity: 0, transition: { duration: 0.12 } }
                    : {
                        opacity: 0,
                        y: -4,
                        filter: "blur(2px)",
                        transition: { duration: 0.15, ease: EASE_OUT },
                      }
                }
                transition={{ duration: 0.25, ease: EASE_OUT }}
                className={cn(
                  "absolute inset-x-0 top-0 text-[14px] leading-5 sm:text-[15px] sm:leading-[21px] font-medium text-balance",
                  tight ? "text-danger" : "text-foreground",
                )}
              >
                {fit}
              </motion.p>
            </AnimatePresence>
          </div>

          <dl className="mt-2 flex flex-col divide-y divide-border border-y border-border text-sm">
            <Row label="Chest" value={toUnit(size.chest, unit)} unit={unit} />
            <Row label="Length" value={toUnit(size.length, unit)} unit={unit} />
            <Row
              label="Room"
              value={toUnit(Math.abs(ease), unit)}
              unit={unit}
              sign={tight ? "-" : "+"}
              danger={tight}
            />
          </dl>

          <div className="mt-auto flex items-center justify-between gap-2 pt-2">
            <p className="text-[13px] text-muted">
              You: {toUnit(bodyChest, unit)} {unit}
            </p>
            <div
              role="group"
              aria-label="Units"
              className="flex h-8 shrink-0 rounded-full bg-surface p-0.5"
            >
              {(["cm", "in"] as const).map((u) => (
                <button
                  key={u}
                  type="button"
                  aria-pressed={unit === u}
                  aria-label={u === "cm" ? "Centimetres" : "Inches"}
                  onClick={() => setUnit(u)}
                  className={cn(
                    "relative h-7 w-9 touch-manipulation rounded-full text-[13px] font-medium outline-hidden transition-[scale,color] duration-150 ease-out select-none focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-foreground active:scale-[0.96]",
                    unit === u ? "text-foreground" : "text-muted",
                  )}
                >
                  {unit === u && (
                    <motion.span
                      layoutId={`${labelId}-unit`}
                      transition={
                        reduceMotion
                          ? { duration: 0 }
                          : { type: "spring", duration: 0.3, bounce: 0 }
                      }
                      className="absolute inset-0 rounded-full bg-background shadow-raised"
                    />
                  )}
                  <span className="relative">{u}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      <p id={labelId} className="mt-4 text-[13px] text-muted">
        Size <span className="text-foreground">{size.label}</span>
        {size.label === suggested ? ", our pick for you" : null}
        {!size.inStock ? ", sold out" : null}
      </p>
      <div
        role="radiogroup"
        aria-labelledby={labelId}
        onKeyDown={onKeyDown}
        className="mt-2 grid grid-cols-6 gap-1.5"
      >
        {sizes.map((s, i) => {
          const on = i === index;
          return (
            <button
              key={s.label}
              ref={(el) => {
                buttons.current[i] = el;
              }}
              type="button"
              role="radio"
              aria-checked={on}
              aria-label={`${s.label}${s.inStock ? "" : ", sold out"}${s.label === suggested ? ", recommended" : ""}`}
              tabIndex={on ? 0 : -1}
              onClick={() => choose(i)}
              className="relative h-11 touch-manipulation rounded-xl bg-surface text-sm font-medium outline-hidden transition-[scale] duration-150 ease-out select-none focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-foreground active:scale-[0.96]"
            >
              {on && (
                <motion.span
                  layoutId={`${labelId}-size`}
                  transition={
                    reduceMotion
                      ? { duration: 0 }
                      : { type: "spring", duration: 0.3, bounce: 0 }
                  }
                  className="absolute inset-0 rounded-xl bg-foreground"
                />
              )}
              <span
                className={cn(
                  "relative transition-[color] duration-150 ease-out",
                  on
                    ? "text-background"
                    : s.inStock
                      ? "text-foreground"
                      : "text-muted",
                  !s.inStock && "line-through",
                )}
              >
                {s.label}
              </span>
              {s.label === suggested && (
                <span
                  aria-hidden
                  className={cn(
                    "absolute bottom-1.5 left-1/2 size-1 -translate-x-1/2 rounded-full transition-[background-color] duration-150 ease-out",
                    on ? "bg-background" : "bg-foreground",
                  )}
                />
              )}
            </button>
          );
        })}
      </div>

      <button
        type="button"
        onClick={() => {
          if (size.inStock) {
            setAdded(size.label);
            onAdd?.(size.label);
          } else {
            setNotified((n) => [...n, size.label]);
          }
        }}
        aria-disabled={done || undefined}
        className={cn(
          "mt-3 flex h-11 w-full touch-manipulation items-center justify-center overflow-hidden rounded-xl text-sm font-medium outline-hidden transition-[scale,background-color,color,box-shadow] duration-150 ease-out select-none focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-foreground active:scale-[0.96] aria-disabled:pointer-events-none",
          size.inStock
            ? "bg-foreground text-background"
            : "bg-background text-foreground shadow-raised",
        )}
      >
        <AnimatePresence initial={false} mode="popLayout">
          <motion.span
            key={cta}
            initial={{ opacity: 0, filter: "blur(4px)" }}
            animate={{ opacity: 1, filter: "blur(0px)" }}
            exit={{
              opacity: 0,
              filter: "blur(2px)",
              transition: { duration: 0.12, ease: EASE_OUT },
            }}
            transition={{ duration: 0.2, ease: EASE_OUT }}
            className="flex items-center gap-2"
          >
            {done && <Check />}
            {cta}
          </motion.span>
        </AnimatePresence>
      </button>

      <p className="sr-only" aria-live="polite">
        {`Size ${size.label}: ${fit}. Chest ${toUnit(size.chest, unit)} ${unit}, length ${toUnit(size.length, unit)} ${unit}.${size.inStock ? "" : " Sold out."}`}
      </p>
    </div>
  );
}

function Check() {
  return (
    <svg
      aria-hidden
      viewBox="0 0 16 16"
      className="size-4"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M3.5 8.5l3 3 6-7" />
    </svg>
  );
}

function Row({
  label,
  value,
  unit,
  sign,
  danger,
}: {
  label: string;
  value: number;
  unit: Unit;
  sign?: "+" | "-";
  danger?: boolean;
}) {
  return (
    <div className="flex h-10 items-center justify-between gap-2">
      <dt className="text-muted">{label}</dt>
      <dd
        className={cn(
          "flex items-baseline gap-1 tabular-nums transition-[color] duration-200 ease-out",
          danger ? "text-danger" : "text-foreground",
        )}
      >
        <span className="sr-only">{`${sign === "-" ? "minus " : ""}${value} ${unit}`}</span>
        <span aria-hidden className="inline-flex">
          {sign && <span>{sign === "-" ? "−" : "+"}</span>}
          <RollingNumber value={value} />
        </span>
        <span aria-hidden className="text-[13px] text-muted">
          {unit}
        </span>
      </dd>
    </div>
  );
}

function RollingNumber({ value }: { value: number }) {
  const [previous, setPrevious] = useState(value);
  const [direction, setDirection] = useState(1);
  if (value !== previous) {
    setPrevious(value);
    setDirection(value > previous ? 1 : -1);
  }
  const chars = [...String(value)];
  return (
    <span aria-hidden className="inline-flex">
      {chars.map((char, i) => (
        // Keyed by place from the right, so 99 to 104 keeps the ones column.
        <Digit key={chars.length - i} char={char} direction={direction} />
      ))}
    </span>
  );
}

function Digit({ char, direction }: { char: string; direction: number }) {
  const reduceMotion = useReducedMotion();
  // Bigger numbers roll up from below, smaller ones drop in from above.
  const offset = (d: number) => (reduceMotion ? "0%" : `${d * 100}%`);
  return (
    <span className="inline-grid overflow-hidden">
      <AnimatePresence initial={false} custom={direction}>
        <motion.span
          key={char}
          custom={direction}
          variants={{
            enter: (d: number) => ({ y: offset(d), opacity: 0 }),
            center: { y: "0%", opacity: 1 },
            exit: (d: number) => ({ y: offset(-d), opacity: 0 }),
          }}
          initial="enter"
          animate="center"
          exit="exit"
          transition={ROLL}
          className="col-start-1 row-start-1"
        >
          {char}
        </motion.span>
      </AnimatePresence>
    </span>
  );
}

const SIZES: GarmentSize[] = [
  { label: "XS", chest: 90, length: 66, sleeve: 18, inStock: false },
  { label: "S", chest: 97, length: 69, sleeve: 19, inStock: true },
  { label: "M", chest: 104, length: 71, sleeve: 20, inStock: true },
  { label: "L", chest: 111, length: 73, sleeve: 21, inStock: true },
  { label: "XL", chest: 118, length: 75, sleeve: 22, inStock: true },
  { label: "XXL", chest: 126, length: 77, sleeve: 23, inStock: false },
];

export default function SizePickerDemo() {
  return (
    <SizePicker
      name="Heavyweight Tee, Bone"
      price="$48"
      sizes={SIZES}
      bodyChest={96}
      defaultSize="L"
    />
  );
}
