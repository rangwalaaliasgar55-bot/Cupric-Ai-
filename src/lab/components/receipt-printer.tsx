import { useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import {
  animate,
  motion,
  useInView,
  useMotionValue,
  useTransform,
  type AnimationPlaybackControls,
  type MotionValue,
} from "motion/react";
import { useReducedMotion } from "@/lib/use-reduced-motion";
import { cn } from "@/lib/cn";

export type ReceiptLine =
  | { kind: "title"; text: string }
  | { kind: "center"; text: string }
  | { kind: "row"; left: string; right: string }
  // Printed double height, the way a thermal head prints emphasis.
  | { kind: "total"; left: string; right: string }
  | { kind: "rule"; char?: string }
  | { kind: "barcode"; code: string };

type Phase = "idle" | "printing" | "printed" | "torn";
type Piece = { key: number; lift: number; twist: number; vx: number; vy: number };

// 80mm paper, scaled down.
const PAPER_WIDTH = 256;
const LINE = 18;
const HEIGHTS: Record<ReceiptLine["kind"], number> = {
  title: LINE,
  center: LINE,
  row: LINE,
  rule: LINE,
  total: LINE * 2,
  barcode: 52,
};
// The serrated edge the cutter left on the roll last time.
const TOOTH = 5;
const TOOTH_WIDTH = 8;
// Blank paper between that old tear and the first line, as a real roll has.
const LEAD = 14;
// Between receipts the roll's serrated edge stands a little out of the
// slot, as on a real printer, so the idle and torn states still show paper.
const STUB = TOOTH + 9;
// After the last line the printer keeps feeding blank paper, so the text
// clears the cutter before you tear.
const TAIL = 36;
// A thermal head burns a whole line at once, then the stepper feeds it out
// at about 360px/s. Slow enough to watch each line arrive, fast enough that
// a full receipt takes under two seconds.
const FEED_SPEED = 360;
const BURN_MS = 34;
// The paper leans back slightly as it rises out of the slot.
const LEAN = 9;
// The slot grips the paper: a twist pivots it on the cutter and a pull only
// gives a little, until either one rips it.
const MAX_TWIST = 9;
const GIVE = 10;
const TWIST_TEAR = 90;
const LIFT_TEAR = 70;
const FLICK = 700;
const SNAP_BACK = { type: "spring", stiffness: 700, damping: 34 } as const;
const EASE_OUT = [0.23, 1, 0.32, 1] as const;

// Thermal paper is a physical material: bright white with near-black ink in
// both themes, the way the avatars keep their light circle.
const PAPER = "oklch(0.985 0.004 95)";
const INK = "oklch(0.26 0 0)";
// A hole into the printer reads dark in either theme.
const SLOT = "oklch(0.16 0 0)";
// From the printer's top edge to the middle of the slot: the paper stands
// on the printer and disappears exactly there.
const SLOT_MIDDLE = 13;

function edge(height: number, tornBottom: boolean) {
  const teeth = Math.ceil(PAPER_WIDTH / TOOTH_WIDTH);
  const top: string[] = [];
  const bottom: string[] = [];
  for (let i = 0; i <= teeth; i++) {
    const x = Math.min(i * TOOTH_WIDTH, PAPER_WIDTH);
    const up = i % 2 === 1;
    top.push(`${x}px ${up ? 0 : TOOTH}px`);
    bottom.unshift(`${x}px ${tornBottom && !up ? height - TOOTH : height}px`);
  }
  return `polygon(${top.join(", ")}, ${bottom.join(", ")})`;
}

export function ReceiptPrinter({
  lines,
  total,
  autoPrint = true,
  onTear,
  className,
}: {
  lines: ReceiptLine[];
  // Read out once printed, e.g. "$23.65".
  total: string;
  // Prints once when it first scrolls into view.
  autoPrint?: boolean;
  onTear?: () => void;
  className?: string;
}) {
  const reduceMotion = useReducedMotion();
  const rootRef = useRef<HTMLDivElement>(null);
  // A small share: in a cropped preview most of it is clipped away, and it
  // should still print.
  const inView = useInView(rootRef, { once: true, amount: 0.15 });
  const [phase, setPhase] = useState<Phase>("idle");
  const [pieces, setPieces] = useState<Piece[]>([]);
  const pieceKey = useRef(0);
  const running = useRef<AnimationPlaybackControls[]>([]);
  const drag = useRef<{ id: number; x: number; y: number } | null>(null);

  const height =
    TOOTH + LEAD + lines.reduce((sum, l) => sum + HEIGHTS[l.kind], 0) + TAIL;

  // How much paper has come out of the slot. Everything still inside the
  // printer sits below the clip, so a line only appears once it's printed
  // and fed out, never before.
  const fed = useMotionValue(STUB);
  const inside = useTransform(fed, (f) => height - f);
  // None at the stub, which is shorter than the shade and would leave it
  // hanging in the air above the slot; full once a receipt has risen.
  const shade = useTransform(fed, [STUB, STUB + 24], [0, 1]);
  const twist = useMotionValue(0);
  const lift = useMotionValue(0);

  const stop = () => {
    running.current.forEach((a) => a.stop());
    running.current = [];
  };
  useEffect(() => stop, []);

  const print = () => {
    stop();
    drag.current = null;
    twist.jump(0);
    lift.jump(0);
    fed.jump(STUB);
    setPhase("printing");
    if (reduceMotion) {
      fed.jump(height);
      setPhase("printed");
      return;
    }
    // One keyframed run: feed out the blank lead, then for every line hold
    // still while the head burns it and feed it out, then run out the tail.
    // A single animation is simple to cancel when Reprint interrupts it.
    const values = [STUB];
    const times = [0];
    let position = STUB;
    let time = 0;
    const feed = (px: number) => {
      position += px;
      time += (px / FEED_SPEED) * 1000;
      values.push(position);
      times.push(time);
    };
    const burn = () => {
      time += BURN_MS;
      values.push(position);
      times.push(time);
    };
    feed(TOOTH + LEAD - STUB);
    for (const line of lines) {
      burn();
      feed(HEIGHTS[line.kind]);
    }
    feed(TAIL);
    const run = animate(fed, values, {
      duration: time / 1000,
      times: times.map((t) => t / time),
      ease: "linear",
    });
    running.current = [run];
    run.then(() => setPhase((p) => (p === "printing" ? "printed" : p)));
  };

  const printRef = useRef(print);
  useEffect(() => {
    printRef.current = print;
  });
  useEffect(() => {
    if (autoPrint && inView) printRef.current();
  }, [autoPrint, inView]);

  const tear = (vx: number, vy: number) => {
    stop();
    drag.current = null;
    const piece: Piece = {
      key: pieceKey.current++,
      lift: lift.get(),
      twist: twist.get(),
      vx,
      vy,
    };
    // The torn piece leaves as its own copy, so Reprint works at once.
    flushSync(() => {
      setPhase("torn");
      if (!reduceMotion) setPieces((list) => [...list, piece]);
    });
    // What stays behind is the next stretch of roll, its fresh serrated
    // edge standing just out of the slot.
    fed.jump(STUB);
    twist.jump(0);
    lift.jump(0);
    navigator.vibrate?.(10);
    onTear?.();
  };

  const release = (e: React.PointerEvent) => {
    if (drag.current?.id !== e.pointerId) return;
    drag.current = null;
    // Twist velocity is in degrees; about 10px of hand travel per degree.
    const vx = twist.getVelocity() * 10;
    const vy = lift.getVelocity();
    if (Math.abs(vx) > FLICK || vy < -FLICK) return tear(vx, vy);
    running.current = [
      animate(twist, 0, SNAP_BACK),
      animate(lift, 0, SNAP_BACK),
    ];
  };

  const printed = phase === "printed";
  const status = {
    // The LED already says ready or busy, so the text says something else.
    idle: "Paper loaded",
    printing: "Printing",
    printed: "Twist or pull to tear it off",
    torn: "Torn off",
  }[phase];

  return (
    <div
      ref={rootRef}
      className={cn("flex w-[min(340px,100%)] flex-col items-center", className)}
    >
      {/* The paper rises into this reserved space, so nothing else moves
          while it prints. */}
      <div
        className="relative z-10 w-full"
        style={{ height: height + 8, marginBottom: -SLOT_MIDDLE }}
      >
        {/* Clipped only below the slot: paper still inside the printer is
            hidden, while a twisted receipt can still swing past the sides. */}
        <div className="absolute inset-0 [clip-path:inset(-100vh_-100vw_0_-100vw)]">
          <Paper
            lines={lines}
            height={height}
            inside={inside}
            twist={twist}
            lift={lift}
            label={printed ? `Receipt, total ${total}` : undefined}
            hidden={phase === "idle" || phase === "torn"}
            interactive={printed}
            onPointerDown={(e) => {
              if (!printed || drag.current || e.button !== 0) return;
              e.currentTarget.setPointerCapture(e.pointerId);
              stop();
              drag.current = { id: e.pointerId, x: e.clientX, y: e.clientY };
            }}
            onPointerMove={(e) => {
              const d = drag.current;
              if (!d || d.id !== e.pointerId) return;
              const dx = e.clientX - d.x;
              const up = d.y - e.clientY;
              twist.set(MAX_TWIST * Math.tanh(dx / 150));
              lift.set(-GIVE * Math.tanh(Math.max(up, 0) / (GIVE * 4)));
              // Rips mid-drag once pulled hard enough, like the real thing,
              // carrying on in the direction of the hand.
              if (Math.abs(dx) > TWIST_TEAR || up > LIFT_TEAR) {
                tear(Math.sign(dx) * 500, up > LIFT_TEAR ? -600 : -200);
              }
            }}
            onPointerUp={release}
            onPointerCancel={release}
          />
          {/* Shade where the paper comes out of the dark of the slot. */}
          <motion.span
            aria-hidden
            style={{ opacity: shade, width: PAPER_WIDTH }}
            className="pointer-events-none absolute bottom-0 left-1/2 h-5 max-w-full -translate-x-1/2 bg-linear-to-t from-black/15 to-transparent"
          />
        </div>
        {/* The slot's front half, drawn over the paper so it goes into the
            slot rather than behind the printer's edge. */}
        <span
          aria-hidden
          style={{ background: SLOT }}
          className="pointer-events-none absolute top-full left-1/2 h-[5px] w-[276px] max-w-[calc(100%-24px)] -translate-x-1/2 rounded-b-full"
        />
        {pieces.map((piece) => (
          <TornPiece
            key={piece.key}
            piece={piece}
            lines={lines}
            height={height}
            onGone={() =>
              setPieces((list) => list.filter((p) => p.key !== piece.key))
            }
          />
        ))}
      </div>

      <Printer busy={phase === "printing"} status={status} />

      <div className="mt-4 flex gap-2">
        <Button onClick={print}>
          {phase === "idle" ? "Print receipt" : "Reprint"}
        </Button>
        <Button onClick={() => tear(-420, -500)} disabled={!printed}>
          Tear off
        </Button>
      </div>
    </div>
  );
}

// 33 teeth on an 8px pitch across the 264px cutter bar.
const CUTTER =
  "M0 0" +
  Array.from({ length: 33 }, (_, i) => `L${i * 8 + 4} 4L${i * 8 + 8} 0`).join("") +
  "Z";

function Printer({ busy, status }: { busy: boolean; status: string }) {
  return (
    <div className="relative h-[92px] w-full rounded-[22px] bg-linear-to-b from-surface to-[color-mix(in_oklch,var(--surface),var(--foreground)_4%)] shadow-[var(--shadow-raised),inset_0_1px_0_oklch(1_0_0/0.6)] dark:shadow-[var(--shadow-raised),inset_0_1px_0_oklch(1_0_0/0.06)]">
      {/* Rubber feet, so the case stands on the page rather than floating. */}
      <span aria-hidden className="absolute -bottom-1 left-7 h-1.5 w-10 rounded-b-md bg-foreground/15" />
      <span aria-hidden className="absolute right-7 -bottom-1 h-1.5 w-10 rounded-b-md bg-foreground/15" />
      {/* The seam of the cover you would lift to load a new roll, with a
          lit lower edge so it reads as a groove in the molding. */}
      <span
        aria-hidden
        className="absolute inset-x-4 top-[34px] h-px bg-foreground/10 shadow-[0_1px_0_oklch(1_0_0/0.7)] dark:shadow-[0_1px_0_oklch(1_0_0/0.05)]"
      />
      {/* The slot the paper leaves through, with the serrated cutter bar
          along its front lip. */}
      <div
        aria-hidden
        style={{ background: SLOT }}
        className="absolute top-2 left-1/2 h-2.5 w-[276px] max-w-[calc(100%-24px)] -translate-x-1/2 rounded-full"
      />
      <svg
        aria-hidden
        viewBox="0 0 264 4"
        preserveAspectRatio="none"
        className="absolute top-[17px] left-1/2 h-1 w-[264px] max-w-[calc(100%-36px)] -translate-x-1/2 text-foreground/35"
      >
        <path fill="currentColor" d={CUTTER} />
      </svg>
      <div className="absolute inset-x-5 bottom-[18px] flex items-center justify-between gap-3">
        <p className="truncate text-sm text-muted" aria-live="polite">
          {status}
        </p>
        {/* A status LED is a physical light, so it gets real LED colors:
            steady green when ready, amber blinking while the motor runs. */}
        <span aria-hidden className="flex shrink-0 items-center gap-2 text-[12px] font-medium tracking-[0.12em] text-muted uppercase">
          {busy ? "Busy" : "Ready"}
          <span
            className={cn(
              "size-2 rounded-full transition-[background-color,box-shadow] duration-150 ease-out",
              busy && "animate-pulse",
            )}
            style={{
              background: busy ? "oklch(0.8 0.16 75)" : "oklch(0.74 0.17 150)",
              boxShadow: busy
                ? "0 0 6px oklch(0.8 0.16 75 / 0.7)"
                : "0 0 6px oklch(0.74 0.17 150 / 0.6)",
            }}
          />
        </span>
      </div>
    </div>
  );
}

function Paper({
  lines,
  height,
  inside,
  twist,
  lift,
  x,
  opacity,
  label,
  hidden,
  interactive,
  torn = false,
  ...handlers
}: {
  lines: ReceiptLine[];
  height: number;
  inside: MotionValue<number>;
  twist: MotionValue<number>;
  lift: MotionValue<number>;
  x?: MotionValue<number>;
  opacity?: MotionValue<number>;
  label?: string;
  hidden?: boolean;
  interactive?: boolean;
  torn?: boolean;
} & Pick<
  React.ComponentProps<"div">,
  "onPointerDown" | "onPointerMove" | "onPointerUp" | "onPointerCancel"
>) {
  const y = useTransform(() => inside.get() + lift.get());
  return (
    <motion.div
      role={label ? "region" : undefined}
      aria-label={label}
      aria-hidden={hidden || !label || undefined}
      style={{
        x,
        y,
        rotate: twist,
        rotateX: LEAN,
        transformPerspective: 900,
        opacity,
        width: PAPER_WIDTH,
        height,
        marginLeft: -PAPER_WIDTH / 2,
      }}
      className={cn(
        // Pivots on the slot, where the cutter holds it.
        "absolute bottom-0 left-1/2 max-w-full origin-bottom select-none",
        // Outside the clip, so the shadow follows the teeth.
        "[filter:drop-shadow(0_0_0.5px_oklch(0_0_0/0.2))_drop-shadow(0_6px_10px_oklch(0_0_0/0.1))]",
        interactive
          ? "cursor-grab touch-none active:cursor-grabbing"
          : "pointer-events-none",
      )}
      {...handlers}
    >
      <div
        style={{
          clipPath: edge(height, torn),
          background: PAPER,
          color: INK,
          paddingTop: TOOTH + LEAD,
        }}
        className="h-full px-4 font-mono text-[13px] leading-[18px] uppercase"
      >
        {lines.map((line, i) => (
          <Line key={i} line={line} />
        ))}
      </div>
    </motion.div>
  );
}

function Line({ line }: { line: ReceiptLine }) {
  switch (line.kind) {
    case "rule":
      return (
        <p aria-hidden className="h-[18px] overflow-hidden whitespace-nowrap opacity-70">
          {(line.char ?? "-").repeat(48)}
        </p>
      );
    case "row":
      return (
        <p className="flex h-[18px] justify-between gap-3 tabular-nums">
          {/* Preserved spaces, so modifier lines keep their indent. */}
          <span className="overflow-hidden text-ellipsis whitespace-pre">
            {line.left}
          </span>
          <span>{line.right}</span>
        </p>
      );
    case "total":
      return (
        // Stretched to twice the height at normal width, as thermal
        // printers do, rather than set in a bigger font.
        <p className="flex h-9 items-start justify-between gap-3 font-bold tabular-nums">
          <span className="inline-block origin-top scale-y-200">{line.left}</span>
          <span className="inline-block origin-top scale-y-200">{line.right}</span>
        </p>
      );
    case "barcode":
      return (
        <div className="flex h-[52px] flex-col items-center justify-center gap-0.5">
          <Barcode code={line.code} />
          <span className="text-xs tracking-[0.3em]">{line.code}</span>
        </div>
      );
    default:
      return (
        <p
          className={cn(
            "h-[18px] truncate text-center",
            line.kind === "title" && "font-bold tracking-[0.2em]",
          )}
        >
          {line.text}
        </p>
      );
  }
}

// Bar widths come from the code, so the same order always prints the same
// barcode.
function Barcode({ code }: { code: string }) {
  let seed = [...code].reduce((s, c) => (s * 31 + c.charCodeAt(0)) >>> 0, 7);
  const next = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const bars: { x: number; w: number }[] = [];
  for (let x = 0; x < 150; ) {
    const w = 1 + Math.floor(next() * 3);
    bars.push({ x, w });
    x += w + 1 + Math.floor(next() * 3);
  }
  return (
    <svg aria-hidden viewBox="0 0 152 28" className="h-7 w-[152px]" fill="currentColor">
      {bars.map((b) => (
        <rect key={b.x} x={b.x} width={b.w} height={28} />
      ))}
    </svg>
  );
}

function TornPiece({
  piece,
  lines,
  height,
  onGone,
}: {
  piece: Piece;
  lines: ReceiptLine[];
  height: number;
  onGone: () => void;
}) {
  const inside = useMotionValue(0);
  const x = useMotionValue(0);
  const lift = useMotionValue(piece.lift);
  const twist = useMotionValue(piece.twist);
  const opacity = useMotionValue(1);
  const gone = useRef(onGone);

  useEffect(() => {
    gone.current = onGone;
  });

  useEffect(() => {
    // Carries on with the hand that tore it, up and away, then fades. An
    // exit nobody waits on, so it can outlast 300ms.
    const direction = Math.sign(piece.vx) || -1;
    const all = [
      animate(x, piece.vx * 0.25, {
        type: "spring",
        stiffness: 90,
        damping: 18,
        velocity: piece.vx,
      }),
      animate(lift, piece.lift - 90, {
        type: "spring",
        stiffness: 90,
        damping: 18,
        velocity: piece.vy,
      }),
      animate(twist, piece.twist + direction * 8, {
        duration: 0.5,
        ease: EASE_OUT,
      }),
      animate(opacity, 0, { duration: 0.26, delay: 0.14, ease: EASE_OUT }),
    ];
    all[3].then(() => gone.current());
    return () => all.forEach((a) => a.stop());
  }, [piece, x, lift, twist, opacity]);

  return (
    <div className="pointer-events-none absolute inset-0">
      <Paper
        lines={lines}
        height={height}
        inside={inside}
        x={x}
        twist={twist}
        lift={lift}
        opacity={opacity}
        hidden
        torn
      />
    </div>
  );
}

function Button({
  onClick,
  disabled,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="h-10 touch-manipulation rounded-full bg-surface px-4 text-sm font-medium text-foreground shadow-raised outline-hidden transition-[scale,opacity] duration-150 ease-out select-none focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-foreground active:scale-[0.96] disabled:opacity-50 disabled:active:scale-100 motion-reduce:transition-[opacity]"
    >
      {children}
    </button>
  );
}

const LINES: ReceiptLine[] = [
  { kind: "title", text: "Kettle & Crumb" },
  { kind: "center", text: "14 Harbour Row" },
  { kind: "rule" },
  { kind: "row", left: "Order #0417", right: "23/09/26 09:41" },
  { kind: "rule" },
  { kind: "row", left: "2 Flat white", right: "9.00" },
  { kind: "row", left: "1 Almond croissant", right: "4.80" },
  { kind: "row", left: "1 Sourdough loaf", right: "7.50" },
  { kind: "row", left: "  + Oat milk", right: "0.60" },
  { kind: "rule" },
  { kind: "row", left: "Subtotal", right: "21.90" },
  { kind: "row", left: "Tax 8%", right: "1.75" },
  { kind: "total", left: "Total", right: "$23.65" },
  { kind: "rule", char: "=" },
  { kind: "row", left: "Visa **** 4821", right: "$23.65" },
  { kind: "barcode", code: "0417230926" },
  { kind: "center", text: "Thank you, come again" },
];

export default function ReceiptPrinterDemo() {
  return <ReceiptPrinter lines={LINES} total="$23.65" />;
}
