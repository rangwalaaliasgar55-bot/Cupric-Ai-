import { useEffect, useId, useRef, useState } from "react";
import { motion } from "motion/react";
import { useReducedMotion } from "@/lib/use-reduced-motion";
import { cn } from "@/lib/cn";

type Item = { id: string; label: string; description?: string };
type Mark = "checked" | "mixed" | "none";

const EASE_OUT = [0.23, 1, 0.32, 1] as const;
// Drawing is the confirmation, so it gets the time to be seen; undrawing is
// just getting out of the way, so it's twice as quick.
const DRAW = { duration: 0.2, ease: EASE_OUT } as const;
const UNDRAW = { duration: 0.1, ease: EASE_OUT } as const;
// A short spring with a little give, so the fill lands and settles instead
// of just appearing.
const FILL_IN = { type: "spring", duration: 0.25, bounce: 0.3 } as const;
const FILL_OUT = { duration: 0.12, ease: EASE_OUT } as const;
const FADE = { duration: 0.15, ease: EASE_OUT } as const;

export function CheckboxGroup({
  label,
  items,
  value,
  onChange,
  className,
}: {
  label: string;
  items: Item[];
  value: string[];
  onChange: (value: string[]) => void;
  className?: string;
}) {
  const id = useId();
  const reduceMotion = Boolean(useReducedMotion());
  const parentRef = useRef<HTMLInputElement>(null);
  // Where the last plain click landed; a shift-click fills from here.
  const anchor = useRef<number | null>(null);
  const shift = useRef(false);

  const selected = new Set(value);
  const count = items.filter((i) => selected.has(i.id)).length;
  const all = count === items.length;
  const mixed = count > 0 && !all;

  // indeterminate only exists as a DOM property, and it's what makes
  // screen readers announce the parent as mixed.
  useEffect(() => {
    if (parentRef.current) parentRef.current.indeterminate = mixed;
  }, [mixed]);

  const emit = (next: Set<string>) =>
    onChange(items.filter((i) => next.has(i.id)).map((i) => i.id));

  const toggle = (index: number) => {
    const next = new Set(selected);
    const checked = !next.has(items[index].id);
    const from = shift.current && anchor.current !== null ? anchor.current : index;
    shift.current = false;
    // The clicked box decides the direction; everything between follows it.
    const [lo, hi] = from < index ? [from, index] : [index, from];
    for (let i = lo; i <= hi; i++) {
      if (checked) next.add(items[i].id);
      else next.delete(items[i].id);
    }
    anchor.current = index;
    emit(next);
  };

  // A label click forwards a second click to its input, and browsers don't
  // agree on whether that one carries the modifier, so remember it from
  // whichever event saw it.
  const rememberShift = (e: React.MouseEvent) => {
    if (e.shiftKey) shift.current = true;
  };

  return (
    // 20px outer radius around 14px rows with 6px padding: concentric.
    <div
      className={cn(
        "w-[min(360px,100%)] rounded-[20px] bg-background p-1.5 shadow-raised",
        className,
      )}
    >
      <Row
        mark={all ? "checked" : mixed ? "mixed" : "none"}
        reduceMotion={reduceMotion}
        inputRef={parentRef}
        labelId={`${id}-all`}
        label={label}
        aria-controls={items.map((i) => `${id}-${i.id}`).join(" ")}
        trailing={
          <span className="text-[13px] text-muted tabular-nums">
            {count} of {items.length}
          </span>
        }
        onToggle={() => {
          anchor.current = null;
          shift.current = false;
          emit(all ? new Set() : new Set(items.map((i) => i.id)));
        }}
        bold
      />
      <div className="mx-3 my-1 h-px bg-border" />
      <div role="group" aria-labelledby={`${id}-all`}>
        {items.map((item, index) => (
          <Row
            key={item.id}
            inputId={`${id}-${item.id}`}
            mark={selected.has(item.id) ? "checked" : "none"}
            reduceMotion={reduceMotion}
            label={item.label}
            description={item.description}
            onRememberShift={rememberShift}
            onToggle={() => toggle(index)}
          />
        ))}
      </div>
      <p className="px-3 pt-1.5 pb-2 text-xs text-muted select-none">
        <kbd className="rounded-[4px] border border-border px-1 py-px font-sans text-xs">
          Shift
        </kbd>{" "}
        click to select a range
      </p>
    </div>
  );
}

function Row({
  mark,
  reduceMotion,
  label,
  description,
  trailing,
  bold,
  inputId,
  inputRef,
  labelId,
  onToggle,
  onRememberShift,
  "aria-controls": controls,
}: {
  mark: Mark;
  reduceMotion: boolean;
  label: string;
  description?: string;
  trailing?: React.ReactNode;
  bold?: boolean;
  inputId?: string;
  inputRef?: React.Ref<HTMLInputElement>;
  labelId?: string;
  onToggle: () => void;
  onRememberShift?: (e: React.MouseEvent) => void;
  "aria-controls"?: string;
}) {
  return (
    <label
      onClick={(e) => {
        if (!(e.target instanceof HTMLInputElement)) onRememberShift?.(e);
      }}
      className={cn(
        "group relative flex min-h-11 cursor-pointer touch-manipulation gap-3 rounded-[14px] px-3 py-2.5 select-none",
        description ? "items-start" : "items-center",
        "transition-[background-color] duration-150 ease-out hover:bg-surface",
        "has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-solid has-[:focus-visible]:-outline-offset-2 has-[:focus-visible]:outline-foreground",
      )}
    >
      <input
        ref={inputRef}
        id={inputId}
        type="checkbox"
        checked={mark === "checked"}
        aria-controls={controls}
        onClick={onRememberShift}
        onChange={onToggle}
        className="sr-only"
      />
      <Box mark={mark} reduceMotion={reduceMotion} offset={Boolean(description)} />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span
          id={labelId}
          className={cn(
            "text-[15px] text-foreground",
            bold ? "font-semibold" : "font-medium",
          )}
        >
          {label}
        </span>
        {description && (
          <span className="text-sm text-muted">{description}</span>
        )}
      </span>
      {trailing}
    </label>
  );
}

function Box({
  mark,
  reduceMotion,
  offset,
}: {
  mark: Mark;
  reduceMotion: boolean;
  offset: boolean;
}) {
  const filled = mark !== "none";
  return (
    <span
      aria-hidden
      className={cn(
        "relative grid size-5 shrink-0 place-items-center rounded-md border-[1.5px] transition-[border-color,scale] duration-150 ease-out group-active:scale-[0.96] motion-reduce:transition-[border-color]",
        // Centers the box on the first line of 15px text (22px line box).
        offset && "mt-px",
        filled
          ? "border-foreground"
          : "border-foreground/25 group-hover:border-foreground/45",
      )}
    >
      {/* Covers the border too, so a filled box is exactly 20px. */}
      <motion.span
        className="absolute -inset-[1.5px] rounded-md bg-foreground"
        initial={false}
        animate={
          filled
            ? { scale: 1, opacity: 1 }
            : { scale: reduceMotion ? 1 : 0.8, opacity: 0 }
        }
        transition={filled && !reduceMotion ? FILL_IN : FILL_OUT}
      />
      <svg
        viewBox="0 0 16 16"
        className="relative size-3.5 text-background"
        fill="none"
        stroke="currentColor"
        // Heavier than the lab's 1.5: at 14px on a solid fill, a thinner
        // mark reads as a hairline.
        strokeWidth={2.25}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <Stroke d="m3.25 8.5 3 3 6.5-7" shown={mark === "checked"} reduceMotion={reduceMotion} />
        <Stroke d="M4 8h8" shown={mark === "mixed"} reduceMotion={reduceMotion} />
      </svg>
    </span>
  );
}

function Stroke({
  d,
  shown,
  reduceMotion,
}: {
  d: string;
  shown: boolean;
  reduceMotion: boolean;
}) {
  if (reduceMotion)
    return (
      <motion.path
        d={d}
        initial={false}
        animate={{ opacity: shown ? 1 : 0 }}
        transition={FADE}
      />
    );
  return (
    <motion.path
      d={d}
      initial={false}
      // Opacity rides along because a round cap at pathLength 0 still
      // leaves a dot behind. It snaps on at the start of a draw and off at
      // the end of an undraw.
      animate={
        shown ? { pathLength: 1, opacity: 1 } : { pathLength: 0, opacity: 0 }
      }
      transition={
        shown
          ? { pathLength: DRAW, opacity: { duration: 0 } }
          : { pathLength: UNDRAW, opacity: { duration: 0, delay: UNDRAW.duration } }
      }
    />
  );
}

const NOTIFICATIONS: Item[] = [
  { id: "comments", label: "Comments", description: "Replies to your posts and threads" },
  { id: "mentions", label: "Mentions", description: "When someone mentions you by name" },
  { id: "followers", label: "New followers", description: "When someone starts following you" },
  { id: "updates", label: "Product updates", description: "New features, about once a month" },
  { id: "digest", label: "Weekly digest", description: "A short summary of what you missed" },
];

export default function CheckboxGroupDemo() {
  const [value, setValue] = useState(["comments", "mentions"]);
  return (
    <CheckboxGroup
      label="All notifications"
      items={NOTIFICATIONS}
      value={value}
      onChange={setValue}
    />
  );
}
