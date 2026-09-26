import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import {
  AnimatePresence,
  LayoutGroup,
  MotionConfig,
  animate,
  motion,
  motionValue,
  useMotionValue,
  useSpring,
  useTransform,
  useVelocity,
  type MotionValue,
  type Variants,
} from "motion/react";
import { useReducedMotion } from "@/lib/use-reduced-motion";
import { cn } from "@/lib/cn";

export type KanbanCard = { id: string; title: string };
export type KanbanColumn = { id: string; title: string; cards: KanbanCard[] };

// Cards make room without overshooting: a slot that bounces reads as the
// wrong drop position for a moment.
const LAYOUT = { type: "spring", duration: 0.3, bounce: 0 } as const;
const LIFT = { type: "spring", duration: 0.25, bounce: 0 } as const;
// Critically damped (damping = 2 * sqrt(stiffness)): a released card glides
// home carrying the hand's velocity and stops dead in its slot.
const HOME = { type: "spring", stiffness: 500, damping: 45 } as const;
// Enough to read as picked up without the card outgrowing its column.
const LIFT_SCALE = 1.03;
// Pointer speed (px/s) that reaches the full tilt, and that tilt in degrees.
const TILT_SPEED = 1000;
const TILT = 2;
// Movement before a press becomes a drag, so a click still just focuses.
const DRAG_SLOP = 4;
// Matches gap-2 between cards.
const GAP = 8;
// Layered and transparent, so it darkens whatever is below. The 1px ring
// keeps the lifted edge visible in dark mode, where shadows barely show.
const LIFTED_SHADOW = [
  "0 0 0 1px light-dark(oklch(0 0 0 / 0.06), oklch(1 0 0 / 0.08))",
  "0 2px 4px light-dark(oklch(0 0 0 / 0.06), oklch(0 0 0 / 0.4))",
  "0 12px 24px -6px light-dark(oklch(0 0 0 / 0.2), oklch(0 0 0 / 0.7))",
].join(", ");

type CardValues = {
  x: MotionValue<number>;
  y: MotionValue<number>;
  lift: MotionValue<number>;
  rotate: MotionValue<number>;
  z: MotionValue<number>;
};
type Held = { id: string; mode: "pointer" | "keyboard"; before: KanbanColumn[] };
type Session = {
  id: string;
  pointerId: number;
  startX: number;
  startY: number;
  // Where on the card it was grabbed, so it stays pinned under the pointer.
  grabX: number;
  grabY: number;
  lastX: number;
  lastY: number;
  started: boolean;
  stop: () => void;
};

const makeValues = (): CardValues => ({
  x: motionValue(0),
  y: motionValue(0),
  lift: motionValue(0),
  rotate: motionValue(0),
  z: motionValue(0),
});

const clamp = (v: number, min: number, max: number) =>
  Math.min(Math.max(v, min), max);

function locate(columns: KanbanColumn[], id: string) {
  const col = columns.findIndex((c) => c.cards.some((card) => card.id === id));
  const index = col < 0 ? -1 : columns[col].cards.findIndex((c) => c.id === id);
  return { col, index };
}

function moveCard(
  columns: KanbanColumn[],
  id: string,
  toCol: number,
  toIndex: number,
) {
  const { col, index } = locate(columns, id);
  const card = columns[col].cards[index];
  const next = columns.map((c) => ({
    ...c,
    cards: c.cards.filter((other) => other.id !== id),
  }));
  next[toCol].cards.splice(toIndex, 0, card);
  return next;
}

/**
 * Drag cards within and between columns, or from the keyboard: Space picks
 * the focused card up, arrows move it, Space drops it and Escape puts it
 * back. Without a card held, the arrows move focus between cards.
 */
export function KanbanBoard({
  columns,
  onChange,
  label,
  className,
}: {
  columns: KanbanColumn[];
  onChange: (columns: KanbanColumn[]) => void;
  label: string;
  className?: string;
}) {
  const reduceMotion = !!useReducedMotion();
  const boardRef = useRef<HTMLDivElement>(null);
  const slots = useRef(new Map<string, HTMLLIElement>());
  const buttons = useRef(new Map<string, HTMLButtonElement>());
  const lists = useRef<(HTMLUListElement | null)[]>([]);
  const session = useRef<Session | null>(null);
  const [held, setHeld] = useState<Held | null>(null);
  const [focusId, setFocusId] = useState(columns[0]?.cards[0]?.id ?? "");
  const [announcement, setAnnouncement] = useState("");
  const instructions = useId();
  // Scopes layoutIds, so two boards on a page never trade cards.
  const group = useId();

  // One set per card that outlives remounts, since a card moving between
  // columns is a new element in a new list.
  const [values] = useState(
    () =>
      new Map(
        columns.flatMap((c) => c.cards).map((card) => [card.id, makeValues()]),
      ),
  );
  const valuesFor = (id: string) => {
    let v = values.get(id);
    if (!v) values.set(id, (v = makeValues()));
    return v;
  };

  // Tilt follows the pointer's horizontal speed, smoothed so a jittery hand
  // doesn't wobble the card.
  const pointerX = useMotionValue(0);
  const tiltTarget = useTransform(
    useVelocity(pointerX),
    [-TILT_SPEED, TILT_SPEED],
    [-TILT, TILT],
  );
  const tilt = useSpring(tiltTarget, { stiffness: 400, damping: 30 });
  // Only for the release velocity.
  const pointerY = useMotionValue(0);
  const release = useRef<{
    id: string;
    left: number;
    top: number;
    velocity: { x: number; y: number };
  } | null>(null);

  // For window listeners and callbacks that outlive the render that made them.
  const latest = useRef({ columns, held, onChange });
  useLayoutEffect(() => {
    latest.current = { columns, held, onChange };
  });

  const title = (id: string, list = columns) =>
    list.flatMap((c) => c.cards).find((c) => c.id === id)?.title ?? "";
  const where = (id: string, list = columns) => {
    const { col, index } = locate(list, id);
    return `${list[col].title}, position ${index + 1} of ${list[col].cards.length}`;
  };

  const lift = (id: string) => {
    const v = valuesFor(id);
    v.z.set(10);
    if (reduceMotion) v.lift.jump(1);
    else animate(v.lift, 1, LIFT);
  };

  // Sets the card down from wherever it is, keeping the release velocity.
  const settle = (id: string, velocity = { x: 0, y: 0 }) => {
    const v = valuesFor(id);
    const done = () => {
      if (latest.current.held?.id !== id && session.current?.id !== id) {
        v.z.set(0);
      }
    };
    if (reduceMotion) {
      [v.x, v.y, v.rotate, v.lift].forEach((mv) => mv.jump(0));
      done();
      return;
    }
    animate(v.x, 0, { ...HOME, velocity: velocity.x });
    animate(v.y, 0, { ...HOME, velocity: velocity.y }).then(done);
    animate(v.rotate, 0, HOME);
    animate(v.lift, 0, LIFT);
  };

  // Keeps the dragged card under the pointer, inside the board, and moves
  // its slot to wherever its centre now sits.
  const follow = () => {
    const s = session.current;
    const board = boardRef.current;
    const slot = s && slots.current.get(s.id);
    if (!s?.started || !board || !slot) return;
    const box = board.getBoundingClientRect();
    // Offsets ignore transforms, so this is the slot's resting position even
    // while its neighbours are mid-animation.
    const homeLeft = box.left + slot.offsetLeft;
    const homeTop = box.top + slot.offsetTop;
    const w = slot.offsetWidth;
    const h = slot.offsetHeight;
    // 3px in from the edge leaves room for the lifted scale (1.5% of a
    // ~180px card per side), so the card never pokes past the board and
    // widens a narrow page.
    const left = clamp(s.lastX - s.grabX, box.left + 3, box.right - w - 3);
    const top = clamp(s.lastY - s.grabY, box.top + 3, box.bottom - h - 3);
    const v = valuesFor(s.id);
    v.x.jump(left - homeLeft);
    v.y.jump(top - homeTop);

    const { columns: current } = latest.current;
    const centreX = left + w / 2;
    const centreY = top + h / 2;
    let toCol = 0;
    let best = Infinity;
    lists.current.forEach((list, i) => {
      if (!list) return;
      const r = list.getBoundingClientRect();
      const d = Math.abs(centreX - (r.left + r.width / 2));
      if (d < best) [best, toCol] = [d, i];
    });
    const list = lists.current[toCol];
    if (!list) return;
    const others = current[toCol].cards.filter((c) => c.id !== s.id).length;
    // Rounding switches slots once the card is halfway into the next one.
    const toIndex = clamp(
      Math.round(
        (centreY - list.getBoundingClientRect().top - h / 2) / (h + GAP),
      ),
      0,
      others,
    );
    const from = locate(current, s.id);
    if (from.col === toCol && from.index === toIndex) return;
    latest.current.onChange(moveCard(current, s.id, toCol, toIndex));
  };

  // After the slot moves, re-pin the card to the pointer before paint.
  useLayoutEffect(() => {
    if (session.current?.started) follow();
    // A released card glides home from exactly where it was let go, even
    // when a cancel has just moved its slot back to where it started.
    const r = release.current;
    const board = boardRef.current;
    const slot = r && slots.current.get(r.id);
    if (r && board && slot) {
      release.current = null;
      const box = board.getBoundingClientRect();
      const v = valuesFor(r.id);
      v.x.jump(r.left - (box.left + slot.offsetLeft));
      v.y.jump(r.top - (box.top + slot.offsetTop));
      settle(r.id, r.velocity);
    }
    // Focus rides along when a card moves to another list and remounts.
    if (held) {
      const button = buttons.current.get(held.id);
      if (button && document.activeElement !== button) {
        button.focus({ preventScroll: true });
      }
    }
  });

  useEffect(() => () => session.current?.stop(), []);

  const endDrag = (cancelled: boolean) => {
    const s = session.current;
    if (!s) return;
    s.stop();
    session.current = null;
    if (!s.started) return;
    const { columns: current, held: h } = latest.current;
    const slot = slots.current.get(s.id);
    const board = boardRef.current;
    if (slot && board) {
      const box = board.getBoundingClientRect();
      const v = valuesFor(s.id);
      release.current = {
        id: s.id,
        left: box.left + slot.offsetLeft + v.x.get(),
        top: box.top + slot.offsetTop + v.y.get(),
        velocity: { x: pointerX.getVelocity(), y: pointerY.getVelocity() },
      };
    }
    if (cancelled && h) latest.current.onChange(h.before);
    setHeld(null);
    const list = cancelled && h ? h.before : current;
    setAnnouncement(
      `${cancelled ? "Cancelled. Returned" : "Dropped"} ${title(s.id, list)} to ${where(s.id, list)}.`,
    );
  };

  const onPointerDown = (id: string, event: React.PointerEvent) => {
    if (event.button !== 0 || session.current) return;
    if (held) drop();
    const onMove = (e: PointerEvent) => {
      const s = session.current;
      // Ignores a second finger, so switching fingers can't yank the card.
      if (!s || e.pointerId !== s.pointerId) return;
      s.lastX = e.clientX;
      s.lastY = e.clientY;
      if (!s.started) {
        if (Math.hypot(e.clientX - s.startX, e.clientY - s.startY) < DRAG_SLOP)
          return;
        const slot = slots.current.get(id);
        const board = boardRef.current;
        if (!slot || !board) return;
        const v = valuesFor(id);
        // Grabbing a card that is still settling picks it up from where it
        // visibly is, not from its slot.
        v.x.stop();
        v.y.stop();
        const box = board.getBoundingClientRect();
        s.grabX = s.startX - (box.left + slot.offsetLeft + v.x.get());
        s.grabY = s.startY - (box.top + slot.offsetTop + v.y.get());
        s.started = true;
        pointerX.jump(e.clientX);
        pointerY.jump(e.clientY);
        if (!reduceMotion) {
          const unsubscribe = tilt.on("change", (r) => v.rotate.set(r));
          const stop = s.stop;
          s.stop = () => {
            stop();
            unsubscribe();
          };
        }
        setHeld({ id, mode: "pointer", before: latest.current.columns });
        lift(id);
        setAnnouncement(`Picked up ${title(id)}.`);
      }
      pointerX.set(e.clientX);
      pointerY.set(e.clientY);
      follow();
    };
    const onUp = (e: PointerEvent) => {
      if (e.pointerId === session.current?.pointerId) endDrag(false);
    };
    const onCancel = (e: PointerEvent) => {
      if (e.pointerId === session.current?.pointerId) endDrag(true);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && session.current?.started) {
        e.preventDefault();
        endDrag(true);
      }
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
    window.addEventListener("keydown", onKey);
    session.current = {
      id,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      grabX: 0,
      grabY: 0,
      lastX: event.clientX,
      lastY: event.clientY,
      started: false,
      stop: () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onCancel);
        window.removeEventListener("keydown", onKey);
      },
    };
  };

  const pickUp = (id: string) => {
    setHeld({ id, mode: "keyboard", before: columns });
    lift(id);
    setAnnouncement(`Picked up ${title(id)}, ${where(id)}.`);
  };

  const drop = () => {
    const h = latest.current.held;
    if (!h) return;
    setHeld(null);
    settle(h.id);
    setAnnouncement(`Dropped ${title(h.id)} in ${where(h.id)}.`);
  };

  const cancel = () => {
    if (!held) return;
    onChange(held.before);
    setHeld(null);
    settle(held.id);
    setAnnouncement(
      `Cancelled. ${title(held.id)} returned to ${where(held.id, held.before)}.`,
    );
  };

  const onKeyDown = (id: string, event: React.KeyboardEvent) => {
    if (session.current?.started) return;
    const { col, index } = locate(columns, id);
    const isHeld = held?.id === id;
    // Moves focus to the nearest card in the next column that has any.
    const focusAcross = (step: number) => {
      for (let c = col + step; c >= 0 && c < columns.length; c += step) {
        const cards = columns[c].cards;
        if (!cards.length) continue;
        buttons.current.get(cards[Math.min(index, cards.length - 1)].id)?.focus();
        return;
      }
    };
    const focusWithin = (step: number) => {
      const target = columns[col].cards[index + step];
      if (target) buttons.current.get(target.id)?.focus();
    };
    const move = (toCol: number, toIndex: number) => {
      if (toCol < 0 || toCol >= columns.length) return;
      const others = columns[toCol].cards.filter((c) => c.id !== id).length;
      const target = clamp(toIndex, 0, others);
      if (toCol === col && target === index) return;
      const next = moveCard(columns, id, toCol, target);
      onChange(next);
      setAnnouncement(`Moved to ${where(id, next)}.`);
    };
    const keys: Record<string, (() => void) | undefined> = {
      " ": () => (isHeld ? drop() : pickUp(id)),
      Enter: () => (isHeld ? drop() : pickUp(id)),
      Escape: isHeld ? cancel : undefined,
      ArrowUp: () => (isHeld ? move(col, index - 1) : focusWithin(-1)),
      ArrowDown: () => (isHeld ? move(col, index + 1) : focusWithin(1)),
      ArrowLeft: () => (isHeld ? move(col - 1, index) : focusAcross(-1)),
      ArrowRight: () => (isHeld ? move(col + 1, index) : focusAcross(1)),
    };
    const run = keys[event.key];
    if (!run) return;
    event.preventDefault();
    run();
  };

  // Tabbing or clicking away sets a keyboard-held card down where it is.
  // Checked a frame later, because a move between columns remounts the card
  // and blurs it until the layout effect refocuses it.
  const blurFrame = useRef(0);
  useEffect(() => () => cancelAnimationFrame(blurFrame.current), []);
  const onBlur = (id: string) => {
    cancelAnimationFrame(blurFrame.current);
    blurFrame.current = requestAnimationFrame(() => {
      const h = latest.current.held;
      if (h?.id !== id || h.mode !== "keyboard") return;
      if (document.activeElement === buttons.current.get(id)) return;
      drop();
    });
  };

  const pointerDragging = held?.mode === "pointer";
  const tabStop = columns.some((c) => c.cards.some((card) => card.id === focusId))
    ? focusId
    : columns.flatMap((c) => c.cards)[0]?.id;

  return (
    <MotionConfig reducedMotion="user">
      <LayoutGroup id={group}>
        <div
          ref={boardRef}
          role="group"
          aria-label={label}
          className={cn(
            "relative grid h-[380px] w-[600px] max-w-full grid-cols-3 gap-3",
            pointerDragging && "cursor-grabbing select-none [&_*]:cursor-grabbing",
            className,
          )}
        >
          {columns.map((column, c) => (
            <div
              key={column.id}
              // Concentric with the cards: 18 = 10 radius + 8 padding.
              className="flex min-w-0 flex-col rounded-[18px] bg-surface p-2"
            >
              <div
                aria-hidden
                className="flex h-9 shrink-0 items-center justify-between px-2 text-sm font-medium text-muted"
              >
                <span>{column.title}</span>
                <Count value={column.cards.length} />
              </div>
              <ul
                ref={(node) => {
                  lists.current[c] = node;
                }}
                aria-label={column.title}
                className="flex flex-1 flex-col gap-2"
              >
                {column.cards.map((card) => (
                  <Card
                    key={card.id}
                    card={card}
                    values={valuesFor(card.id)}
                    held={held?.id === card.id ? held.mode : null}
                    tabbable={card.id === tabStop}
                    describedBy={instructions}
                    slotRef={(node) => {
                      if (node) slots.current.set(card.id, node);
                      else slots.current.delete(card.id);
                    }}
                    buttonRef={(node) => {
                      if (node) buttons.current.set(card.id, node);
                      else buttons.current.delete(card.id);
                    }}
                    onPointerDown={(e) => onPointerDown(card.id, e)}
                    onKeyDown={(e) => onKeyDown(card.id, e)}
                    onFocus={() => setFocusId(card.id)}
                    onBlur={() => onBlur(card.id)}
                  />
                ))}
              </ul>
            </div>
          ))}
          <p id={instructions} className="sr-only">
            Press Space to pick up. While holding, use the arrow keys to move
            within or between columns, Space to drop, or Escape to cancel.
          </p>
          <p className="sr-only" aria-live="assertive" aria-atomic>
            {announcement}
          </p>
        </div>
      </LayoutGroup>
    </MotionConfig>
  );
}

function Card({
  card,
  values,
  held,
  tabbable,
  describedBy,
  slotRef,
  buttonRef,
  onPointerDown,
  onKeyDown,
  onFocus,
  onBlur,
}: {
  card: KanbanCard;
  values: CardValues;
  held: Held["mode"] | null;
  tabbable: boolean;
  describedBy: string;
  slotRef: (node: HTMLLIElement | null) => void;
  buttonRef: (node: HTMLButtonElement | null) => void;
  onPointerDown: (e: React.PointerEvent) => void;
  onKeyDown: (e: React.KeyboardEvent) => void;
  onFocus: () => void;
  onBlur: () => void;
}) {
  const scale = useTransform(values.lift, [0, 1], [1, LIFT_SCALE]);
  // The pointer-dragged card is placed by hand every frame, so its slot must
  // not also animate or the card would drift off the pointer. A card held
  // from the keyboard keeps its layoutId, so it glides between columns.
  const byPointer = held === "pointer";

  return (
    <motion.li
      ref={slotRef}
      layout={byPointer ? false : "position"}
      layoutId={byPointer ? undefined : card.id}
      transition={LAYOUT}
      className={cn(
        "h-11 shrink-0 rounded-[10px]",
        // The drop placeholder: the slot shows through once the card leaves it.
        held &&
          "bg-foreground/[0.03] outline-1 -outline-offset-1 outline-foreground/20 outline-dashed",
      )}
    >
      <motion.button
        ref={buttonRef}
        type="button"
        tabIndex={tabbable ? 0 : -1}
        aria-describedby={describedBy}
        aria-pressed={held ? true : undefined}
        style={{
          x: values.x,
          y: values.y,
          scale,
          rotate: values.rotate,
          zIndex: values.z,
        }}
        onPointerDown={onPointerDown}
        onKeyDown={onKeyDown}
        onFocus={onFocus}
        onBlur={onBlur}
        className={cn(
          "relative flex size-full cursor-grab touch-none items-center rounded-[10px] bg-background px-3 text-left text-sm text-foreground shadow-raised outline-hidden select-none",
          "transition-[scale] duration-150 ease-out active:scale-[0.96] motion-reduce:transition-none",
          "focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-1 focus-visible:outline-foreground",
          // Lifted already reads as pressed; don't shrink under the lift.
          held && "active:scale-100",
        )}
      >
        <motion.span
          aria-hidden
          style={{ opacity: values.lift, boxShadow: LIFTED_SHADOW }}
          className="pointer-events-none absolute inset-0 rounded-[inherit]"
        />
        <span className="relative truncate">{card.title}</span>
      </motion.button>
    </motion.li>
  );
}

// Rolls up when a column gains a card and down when it loses one.
const ROLL: Variants = {
  enter: (dir: number) => ({ y: dir * 8, opacity: 0, filter: "blur(2px)" }),
  center: {
    y: 0,
    opacity: 1,
    filter: "blur(0px)",
    transition: { duration: 0.2, ease: [0.23, 1, 0.32, 1] },
  },
  exit: (dir: number) => ({
    y: dir * -8,
    opacity: 0,
    filter: "blur(2px)",
    transition: { duration: 0.15, ease: [0.23, 1, 0.32, 1] },
  }),
};

function Count({ value }: { value: number }) {
  const [shown, setShown] = useState({ value, dir: 1 });
  // Direction is decided during render, so the new number enters from the
  // right side on the very render it appears.
  if (shown.value !== value) {
    setShown({ value, dir: value > shown.value ? 1 : -1 });
  }
  return (
    <span className="relative inline-flex h-4 min-w-2 justify-end overflow-hidden text-xs tabular-nums">
      <AnimatePresence mode="popLayout" initial={false} custom={shown.dir}>
        <motion.span
          key={value}
          custom={shown.dir}
          variants={ROLL}
          initial="enter"
          animate="center"
          exit="exit"
          className="leading-4"
        >
          {value}
        </motion.span>
      </AnimatePresence>
    </span>
  );
}

const INITIAL: KanbanColumn[] = [
  {
    id: "todo",
    title: "Todo",
    cards: [
      { id: "spec", title: "Draft spec" },
      { id: "icons", title: "Icon set" },
      { id: "copy", title: "Empty states" },
    ],
  },
  {
    id: "doing",
    title: "Doing",
    cards: [
      { id: "login", title: "Login flow" },
      { id: "review", title: "Review PR" },
    ],
  },
  {
    id: "done",
    title: "Done",
    cards: [{ id: "tokens", title: "Color tokens" }],
  },
];

export default function KanbanBoardDemo() {
  const [columns, setColumns] = useState(INITIAL);
  return (
    <KanbanBoard columns={columns} onChange={setColumns} label="Project board" />
  );
}
