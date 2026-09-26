import { useId, useState } from "react";
import { AnimatePresence, motion, type Variants } from "motion/react";
import { useReducedMotion } from "@/lib/use-reduced-motion";
import { cn } from "@/lib/cn";

const EASE_OUT = [0.23, 1, 0.32, 1] as const;
const ROLL = { type: "spring", duration: 0.35, bounce: 0 } as const;

// Wrapping paper and ribbon are physical materials, so they keep their own
// colours in both themes: brown kraft paper with a printed dot, and a red
// satin ribbon with a darker underside where it folds.
const KRAFT = "oklch(0.74 0.075 70)";
const KRAFT_FOLD = "oklch(0.64 0.075 65)";
const KRAFT_DOT = "oklch(0.97 0.02 80 / 0.75)";
const RIBBON = "oklch(0.55 0.19 25)";
const RIBBON_DARK = "oklch(0.44 0.17 25)";
// Satin catches light down its middle.
const RIBBON_SHEEN = "oklch(0.66 0.17 28)";
const SATIN = (angle: number) =>
  `linear-gradient(${angle}deg, ${RIBBON_DARK}, ${RIBBON} 25%, ${RIBBON_SHEEN} 50%, ${RIBBON} 75%, ${RIBBON_DARK})`;
// Paper pulled over a box: light on the top edge, shade toward the bottom.
const PILLOW =
  "linear-gradient(180deg, oklch(1 0 0 / 0.16), transparent 35%, transparent 65%, oklch(0 0 0 / 0.12))";
// A plain card tag, like the paper ones tied to a real gift.
const TAG = "oklch(0.97 0.012 85)";
const TAG_INK = "oklch(0.3 0.02 60)";

// Wrapping is a rare, one-off moment, so the whole sequence (paper, ribbon,
// bow, tag) takes about 0.8s; each step on its own stays under 300ms.
// Unwrapping runs the same steps backwards in about half the time, since
// the user is undoing rather than watching.
const flap = (side: 1 | -1, delay: number): Variants => ({
  // Hovering the gift option lifts the paper in from both edges, a promise
  // of what the switch does before it is pressed.
  peek: {
    // 87deg shows about 14px of paper (perspective widens it): inside the
    // row's padding, so the price and photo stay readable while it teases.
    rotateY: side * 87,
    opacity: 1,
    transition: {
      rotateY: { type: "spring", duration: 0.35, bounce: 0 },
      opacity: { duration: 0.06 },
    },
  },
  open: {
    rotateY: side * 92,
    opacity: 0,
    transition: {
      rotateY: { duration: 0.16, ease: EASE_OUT, delay: 0.12 },
      opacity: { duration: 0.06, delay: 0.22 },
    },
  },
  wrapped: {
    rotateY: 0,
    opacity: 1,
    transition: {
      rotateY: { duration: 0.3, ease: EASE_OUT, delay },
      opacity: { duration: 0.06, delay },
    },
  },
});

const ribbon = (axis: "scaleX" | "scaleY", delay: number): Variants => ({
  open: {
    ...(axis === "scaleX" ? { scaleX: 0 } : { scaleY: 0 }),
    transition: { duration: 0.1, ease: EASE_OUT, delay: 0.06 },
  },
  wrapped: {
    ...(axis === "scaleX" ? { scaleX: 1 } : { scaleY: 1 }),
    transition: { duration: 0.18, ease: EASE_OUT, delay },
  },
});

const BOW: Variants = {
  open: {
    scale: 0.4,
    opacity: 0,
    transition: { duration: 0.08, ease: EASE_OUT },
  },
  // The one bouncy thing here: a bow pulled tight springs a little.
  wrapped: {
    scale: 1,
    opacity: 1,
    transition: {
      scale: { type: "spring", duration: 0.4, bounce: 0.45, delay: 0.56 },
      opacity: { duration: 0.08, delay: 0.56 },
    },
  },
};

const TAG_SWING: Variants = {
  open: { opacity: 0, rotate: -2, y: -4, transition: { duration: 0.08 } },
  wrapped: {
    opacity: 1,
    rotate: -9,
    y: 0,
    transition: {
      default: { type: "spring", duration: 0.5, bounce: 0.35, delay: 0.66 },
      opacity: { duration: 0.12, delay: 0.66 },
    },
  },
};

const FADE_ONLY: Variants = {
  open: { opacity: 0, transition: { duration: 0.12 } },
  wrapped: { opacity: 1, transition: { duration: 0.2 } },
};

const money = (cents: number, currency: string) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency }).format(cents / 100);

export type GiftItem = {
  name: string;
  variant: string;
  // In cents, so totals never pick up float error.
  price: number;
  image: React.ReactNode;
};

export function GiftWrap({
  item,
  wrapFee,
  currency = "USD",
  maxMessage = 150,
  defaultGift = false,
  onChange,
  className,
}: {
  item: GiftItem;
  // In cents.
  wrapFee: number;
  currency?: string;
  maxMessage?: number;
  defaultGift?: boolean;
  onChange?: (gift: { on: boolean; to: string; message: string }) => void;
  className?: string;
}) {
  const reduceMotion = useReducedMotion();
  const id = useId();
  const [gift, setGift] = useState(defaultGift);
  const [to, setTo] = useState("");
  const [message, setMessage] = useState("");
  const [peek, setPeek] = useState(false);

  const update = (next: Partial<{ on: boolean; to: string; message: string }>) => {
    const state = { on: gift, to, message, ...next };
    onChange?.(state);
  };

  const fee = gift ? wrapFee : 0;
  const total = item.price + fee;
  const v = (variants: Variants) => (reduceMotion ? FADE_ONLY : variants);

  return (
    <div
      className={cn(
        "w-[min(440px,100%)] rounded-3xl bg-background p-5 shadow-raised",
        className,
      )}
    >
      <div className="flex items-baseline justify-between">
        <h3 className="text-[15px] font-medium text-foreground">Your bag</h3>
        <p className="text-[13px] text-muted">1 item</p>
      </div>

      {/* The product row. The paper folds shut over it from both edges, so
          it needs perspective and a clip at the rounded corners. */}
      <motion.div
        initial={false}
        animate={gift ? "wrapped" : peek && !reduceMotion ? "peek" : "open"}
        className="relative mt-3 h-[104px] overflow-hidden rounded-2xl bg-surface [perspective:700px]"
      >
        <div className="flex h-full items-center gap-4 p-4">
          {/* A product photo keeps its light studio backdrop in both themes,
              the way the site's avatars keep their light circle. */}
          <div className="grid size-[72px] shrink-0 place-items-center overflow-hidden rounded-xl bg-[oklch(0.97_0_0)] outline outline-1 -outline-offset-1 outline-black/5">
            {item.image}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[15px] font-medium text-foreground">{item.name}</p>
            <p className="truncate text-sm text-muted">{item.variant}</p>
            <p className="mt-1 text-sm text-muted">Qty 1</p>
          </div>
          <p className="self-start text-[15px] text-foreground tabular-nums">
            {money(item.price, currency)}
          </p>
        </div>

        <div aria-hidden className="pointer-events-none absolute inset-0">
          <Flap side={-1} variants={v(flap(-1, 0))} pattern={`${id}-l`} />
          <Flap side={1} variants={v(flap(1, 0.08))} pattern={`${id}-r`} />
          <motion.span
            variants={v(ribbon("scaleY", 0.3))}
            style={{ background: SATIN(90), originY: 0 }}
            className="absolute inset-y-0 left-[68%] z-20 w-3.5"
          />
          <motion.span
            variants={v(ribbon("scaleX", 0.4))}
            style={{ background: SATIN(180), originX: 0 }}
            className="absolute inset-x-0 top-[calc(50%-7px)] z-20 h-3.5"
          />
          <motion.div
            variants={v(BOW)}
            className="absolute top-[calc(50%-17px)] left-[calc(68%-19px)] z-30 h-[34px] w-[52px]"
          >
            <Bow />
          </motion.div>
          <motion.div
            variants={v(TAG_SWING)}
            style={{ background: TAG, color: TAG_INK, originX: 0, originY: 0.5 }}
            className="absolute top-[calc(50%+14px)] left-[calc(68%+22px)] z-20 flex h-7 max-w-[30%] items-center gap-1.5 rounded-[4px] pr-2 pl-3 text-[12px] font-medium shadow-[0_1px_2px_oklch(0_0_0/0.2)] [clip-path:polygon(8px_0,100%_0,100%_100%,8px_100%,0_50%)]"
          >
            <span className="size-1 shrink-0 rounded-full bg-current opacity-40" />
            <span className="truncate">For {to.trim() || "you"}</span>
          </motion.div>
        </div>
      </motion.div>

      <button
        type="button"
        role="switch"
        aria-checked={gift}
        onClick={() => {
          setGift(!gift);
          update({ on: !gift });
        }}
        onPointerEnter={(e) => e.pointerType !== "touch" && setPeek(true)}
        onPointerLeave={() => setPeek(false)}
        onFocus={(e) => e.currentTarget.matches(":focus-visible") && setPeek(true)}
        onBlur={() => setPeek(false)}
        className="group mt-3 flex min-h-11 w-full touch-manipulation items-center gap-3 rounded-2xl p-1 text-left outline-hidden select-none focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-foreground"
      >
        <Swatch />
        <span className="min-w-0 flex-1">
          <span className="block text-[15px] font-medium text-foreground">This is a gift</span>
          <span className="block text-[13px] text-muted">
            Kraft paper, satin bow and a note, +{money(wrapFee, currency)}
          </span>
        </span>
        <span
          aria-hidden
          className={cn(
            "relative h-[26px] w-11 shrink-0 rounded-full transition-[background-color,scale] duration-200 ease-out group-active:scale-[0.96]",
            gift ? "bg-foreground" : "bg-foreground/15",
          )}
        >
          <span
            className={cn(
              "absolute top-[3px] left-[3px] size-5 rounded-full bg-background shadow-raised transition-transform duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] motion-reduce:transition-none",
              gift && "translate-x-[18px]",
            )}
          />
        </span>
      </button>

      {/* Unfolds downward like a card opening; the toggle above never moves. */}
      <AnimatePresence initial={false}>
        {gift && (
          <motion.div
            key="note"
            initial={{ height: 0, opacity: 0 }}
            animate={{
              height: "auto",
              opacity: 1,
              transition: {
                height: { duration: reduceMotion ? 0 : 0.28, ease: EASE_OUT },
                opacity: { duration: 0.2 },
              },
            }}
            exit={{
              height: 0,
              opacity: 0,
              transition: {
                height: { duration: reduceMotion ? 0 : 0.18, ease: EASE_OUT },
                opacity: { duration: 0.1 },
              },
            }}
            className="overflow-hidden [perspective:600px]"
          >
            <motion.div
              initial={reduceMotion ? false : { rotateX: -70, filter: "blur(4px)" }}
              animate={{ rotateX: 0, filter: "blur(0px)" }}
              exit={reduceMotion ? undefined : { rotateX: -40, transition: { duration: 0.16, ease: EASE_OUT } }}
              transition={{ duration: 0.32, ease: EASE_OUT }}
              style={{ originY: 0 }}
              className="flex flex-col gap-2 pt-2 pb-1"
            >
              <label className="flex h-11 items-center gap-2 rounded-xl bg-surface px-3 focus-within:outline-2 focus-within:outline-solid focus-within:-outline-offset-2 focus-within:outline-foreground">
                <span className="text-sm text-muted">To</span>
                <input
                  value={to}
                  maxLength={24}
                  onChange={(e) => {
                    setTo(e.target.value);
                    update({ to: e.target.value });
                  }}
                  placeholder="Their name"
                  className="h-full min-w-0 flex-1 bg-transparent text-[15px] text-foreground outline-hidden placeholder:text-muted/70"
                />
              </label>
              <div className="relative rounded-xl bg-surface focus-within:outline-2 focus-within:outline-solid focus-within:-outline-offset-2 focus-within:outline-foreground">
                <label htmlFor={`${id}-msg`} className="sr-only">
                  Gift message
                </label>
                <textarea
                  id={`${id}-msg`}
                  value={message}
                  maxLength={maxMessage}
                  rows={3}
                  onChange={(e) => {
                    setMessage(e.target.value);
                    update({ message: e.target.value });
                  }}
                  placeholder="Write a note, we'll print it on a card"
                  aria-describedby={`${id}-count`}
                  className="block w-full resize-none bg-transparent px-3 pt-2.5 pb-6 text-[15px] leading-snug text-foreground outline-hidden placeholder:text-muted/70"
                />
                <span
                  id={`${id}-count`}
                  className={cn(
                    "pointer-events-none absolute right-3 bottom-2 text-[12px] tabular-nums transition-[color] duration-150",
                    maxMessage - message.length <= 10 ? "text-danger" : "text-muted",
                  )}
                >
                  {maxMessage - message.length} left
                </span>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <dl className="mt-3 flex flex-col gap-1.5 border-t border-border pt-3 text-sm">
        <div className="flex justify-between">
          <dt className="text-muted">Subtotal</dt>
          <dd className="text-foreground tabular-nums">{money(item.price, currency)}</dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-muted">Gift wrap</dt>
          <dd className={cn("transition-[color] duration-200", gift ? "text-foreground" : "text-muted")}>
            <RollingNumber text={money(fee, currency)} value={fee} />
          </dd>
        </div>
        <div className="mt-1 flex items-baseline justify-between text-[15px] font-medium">
          <dt className="text-foreground">Total</dt>
          <dd className="text-foreground">
            <RollingNumber text={money(total, currency)} value={total} />
          </dd>
        </div>
      </dl>
    </div>
  );
}

function Flap({
  side,
  variants,
  pattern,
}: {
  side: 1 | -1;
  variants: Variants;
  pattern: string;
}) {
  const left = side === -1;
  return (
    <motion.div
      variants={variants}
      style={{ originX: left ? 0 : 1, background: KRAFT }}
      className={cn(
        // Each half overlaps the middle by 6px, so the paper meets with a
        // lap instead of a gap. The right flap folds over the left.
        "absolute inset-y-0 w-[calc(50%+6px)] backface-hidden",
        left ? "left-0" : "right-0 z-10 shadow-[-2px_0_4px_oklch(0_0_0/0.18)]",
      )}
    >
      <svg className="absolute inset-0 size-full">
        <defs>
          <pattern id={pattern} width="14" height="14" patternUnits="userSpaceOnUse">
            <circle cx="3.5" cy="3.5" r="1.4" fill={KRAFT_DOT} />
            <circle cx="10.5" cy="10.5" r="1.4" fill={KRAFT_DOT} />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill={`url(#${pattern})`} />
      </svg>
      <span style={{ background: PILLOW }} className="absolute inset-0" />
      {/* The folded-under edge, a strip of the paper's back showing. */}
      {!left && (
        <span
          style={{ background: KRAFT_FOLD }}
          className="absolute inset-y-0 left-0 w-[5px]"
        />
      )}
    </motion.div>
  );
}

// A cut sample of the paper and ribbon, so the option shows what you get
// before the switch is ever pressed.
function Swatch() {
  return (
    <svg aria-hidden viewBox="0 0 44 44" className="size-11 shrink-0 overflow-visible rounded-xl">
      <defs>
        <pattern id="gift-swatch-dots" width="7" height="7" patternUnits="userSpaceOnUse">
          <circle cx="1.75" cy="1.75" r="0.8" fill={KRAFT_DOT} />
          <circle cx="5.25" cy="5.25" r="0.8" fill={KRAFT_DOT} />
        </pattern>
      </defs>
      <rect width="44" height="44" rx="12" fill={KRAFT} />
      <rect width="44" height="44" rx="12" fill="url(#gift-swatch-dots)" />
      <rect x="26" width="5" height="44" fill={RIBBON} />
      <rect y="19.5" width="44" height="5" fill={RIBBON} />
      <path d="M28.5 22 C24 15, 17 15, 18 20 C19 24, 25 23.5, 28.5 22Z" fill={RIBBON} stroke={RIBBON_DARK} strokeWidth="0.8" />
      <path d="M28.5 22 C33 15, 40 15, 39 20 C38 24, 32 23.5, 28.5 22Z" fill={RIBBON} stroke={RIBBON_DARK} strokeWidth="0.8" />
      <rect x="26.5" y="19.5" width="4" height="5" rx="1.5" fill={RIBBON_DARK} />
      <rect width="44" height="44" rx="12" fill="none" stroke="oklch(0 0 0 / 0.08)" />
    </svg>
  );
}

function Bow() {
  return (
    <svg viewBox="0 0 52 34" className="size-full overflow-visible drop-shadow-[0_1px_1.5px_oklch(0_0_0/0.3)]">
      {/* Tails, then loops, then the knot on top. */}
      <path d="M24 19 L15 33 L19 32 L21 35 L26 21Z" fill={RIBBON_DARK} />
      <path d="M28 19 L37 33 L33 32 L31 35 L26 21Z" fill={RIBBON_DARK} />
      <path d="M26 17 C18 4, 4 2, 3 11 C2 20, 16 22, 26 17Z" fill={RIBBON} />
      <path d="M26 17 C34 4, 48 2, 49 11 C50 20, 36 22, 26 17Z" fill={RIBBON} />
      <path d="M26 17 C20 10, 10 8, 8 12" stroke={RIBBON_DARK} strokeWidth="1.2" fill="none" strokeLinecap="round" />
      <path d="M26 17 C32 10, 42 8, 44 12" stroke={RIBBON_DARK} strokeWidth="1.2" fill="none" strokeLinecap="round" />
      <rect x="21.5" y="12.5" width="9" height="9" rx="3" fill={RIBBON_DARK} />
    </svg>
  );
}

function RollingNumber({ text, value }: { text: string; value: number }) {
  const [previous, setPrevious] = useState(value);
  const [direction, setDirection] = useState(1);
  if (value !== previous) {
    setPrevious(value);
    setDirection(value > previous ? 1 : -1);
  }
  const chars = [...text];
  return (
    <span className="relative inline-flex tabular-nums">
      <span className="sr-only">{text}</span>
      <span aria-hidden className="inline-flex">
        {chars.map((char, i) => {
          // Keyed by place from the right, so $9.50 to $10.00 keeps the
          // cents columns and only adds a tens column.
          const place = chars.length - i;
          return /\d/.test(char) ? (
            <Digit key={`d${place}`} char={char} direction={direction} />
          ) : (
            <span key={`s${place}${char}`}>{char}</span>
          );
        })}
      </span>
    </span>
  );
}

function Digit({ char, direction }: { char: string; direction: number }) {
  const reduceMotion = useReducedMotion();
  // Adding the fee rolls digits up; removing it rolls them back down.
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

// A stand-in product photo: an amber glass candle jar with a paper label.
// Raw colours because it is the product itself, not interface.
function CandleJar() {
  return (
    <svg viewBox="0 0 72 72" className="size-[72px]" aria-hidden>
      <defs>
        <linearGradient id="gift-jar-glass" x1="0" x2="1">
          <stop offset="0" stopColor="oklch(0.42 0.09 55)" />
          <stop offset="0.35" stopColor="oklch(0.58 0.11 62)" />
          <stop offset="1" stopColor="oklch(0.4 0.08 55)" />
        </linearGradient>
        <linearGradient id="gift-jar-lid" x1="0" x2="1">
          <stop offset="0" stopColor="oklch(0.3 0.01 60)" />
          <stop offset="0.4" stopColor="oklch(0.5 0.01 60)" />
          <stop offset="1" stopColor="oklch(0.28 0.01 60)" />
        </linearGradient>
      </defs>
      {/* Contact shadow on the table. */}
      <ellipse cx="36" cy="60" rx="17" ry="2.5" fill="oklch(0 0 0 / 0.12)" />
      <rect x="20" y="21" width="32" height="39" rx="7" fill="url(#gift-jar-glass)" />
      <rect x="21" y="14" width="30" height="8" rx="2" fill="url(#gift-jar-lid)" />
      <rect x="23.5" y="25" width="3" height="30" rx="1.5" fill="oklch(1 0 0 / 0.28)" />
      <rect x="26" y="33" width="20" height="17" rx="1.5" fill="oklch(0.96 0.012 85)" />
      <rect x="30" y="38" width="12" height="1.6" rx="0.8" fill="oklch(0.35 0.02 60)" />
      <rect x="32" y="42.5" width="8" height="1.2" rx="0.6" fill="oklch(0.6 0.02 60)" />
    </svg>
  );
}

export default function GiftWrapDemo() {
  return (
    <GiftWrap
      item={{
        name: "Hinoki Candle",
        variant: "Hinoki and cedar, 220 g",
        price: 3800,
        image: <CandleJar />,
      }}
      wrapFee={450}
    />
  );
}
