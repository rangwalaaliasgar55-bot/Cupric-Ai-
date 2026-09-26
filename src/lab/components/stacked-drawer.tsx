import { useEffect, useId, useRef, useState } from "react";
import {
  animate,
  motion,
  motionValue,
  useMotionValue,
  useTransform,
  type MotionValue,
} from "motion/react";
import { useReducedMotion } from "@/lib/use-reduced-motion";
import { cn } from "@/lib/cn";

const FRAME_H = 560;
// The first sheet stops this far below the frame's top, and each nested one
// a step lower, so every layer behind keeps a sliver showing above the next.
const FIRST_TOP = 40;
const STEP = 18;
// Pushed back: the page drops by one step so its top peeks out above the
// first sheet, the way iOS tucks the presenting screen behind a sheet.
const BASE_DROP = 18;
const PUSH_SCALE = 0.94;
const DIM = 0.2;
// Past the frame's bottom edge, so the sheet's shadow is hidden too.
const OFFSCREEN = 24;
// Upward overdrag tops out here. Sheets extend this far below the frame, so
// rubber-banding up never opens a gap underneath.
const RUBBER = 36;
// Movement below this still counts as a tap on whatever was pressed.
const DRAG_START = 4;
// Released past 30% of its height, or flicked down faster than this (px/s),
// the sheet dismisses; otherwise it settles back.
const DISMISS_DISTANCE = 0.3;
const DISMISS_VELOCITY = 500;

const EASE_DRAWER = [0.32, 0.72, 0, 1] as const;
// Longer than most UI motion because a sheet travels the whole frame; at
// 300ms it reads as a jump. Closing is quicker, since it gets out of the way.
const OPEN = { duration: 0.45, ease: EASE_DRAWER };
const CLOSE = { duration: 0.32, ease: EASE_DRAWER };
// After a drag, a spring picks up the finger's release speed. Near critical
// damping (2 * sqrt(380) is about 39), so it settles without a wobble.
const RELEASE = { type: "spring", stiffness: 380, damping: 38 } as const;
const FADE = { duration: 0.2, ease: [0.23, 1, 0.32, 1] } as const;

type Sheet = {
  title: string;
  description: string;
  // Label for the button that opens the next sheet in the stack.
  next?: string;
};

type Values = { y: MotionValue<number>; opacity: MotionValue<number> };

const topOf = (i: number) => FIRST_TOP + i * STEP;
const heightOf = (i: number) => FRAME_H - topOf(i);
const closedAt = (i: number) => heightOf(i) + OFFSCREEN;

function rubberBand(overdrag: number) {
  // Half the cap is reached after 120px of pull, so resistance builds slowly.
  return RUBBER * (1 - 1 / (1 + overdrag / 120));
}

// How far the layer above has come in, from 0 (gone) to 1 (fully open). Also
// capped by its opacity, which is what moves under reduced motion.
function usePush(above: Values, height: number) {
  return useTransform(() =>
    Math.min(
      Math.max(1 - above.y.get() / height, 0),
      Math.min(above.opacity.get(), 1),
    ),
  );
}

export function StackedDrawer({
  sheets,
  trigger,
  children,
  className,
}: {
  sheets: Sheet[];
  trigger: string;
  children?: React.ReactNode;
  className?: string;
}) {
  const reduce = !!useReducedMotion();
  const [depth, setDepth] = useState(0);
  const depthRef = useRef(0);
  const frameRef = useRef<HTMLDivElement>(null);
  const sheetRefs = useRef<(HTMLDivElement | null)[]>([]);
  // triggers[i] opened sheet i, and gets focus back when it closes.
  const triggers = useRef<(HTMLButtonElement | null)[]>([]);
  const [values] = useState<Values[]>(() =>
    sheets.map((_, i) => ({
      y: motionValue(closedAt(i)),
      opacity: motionValue(1),
    })),
  );
  // Stands in above the top sheet, which nothing ever covers.
  const [nothing] = useState<Values>(() => ({
    y: motionValue(FRAME_H),
    opacity: motionValue(0),
  }));

  const setStack = (next: number) => {
    depthRef.current = next;
    setDepth(next);
  };

  const open = (i: number) => {
    setStack(i + 1);
    const { y, opacity } = values[i];
    if (reduce) {
      y.jump(0);
      opacity.jump(0);
      animate(opacity, 1, FADE);
    } else {
      opacity.jump(1);
      animate(y, 0, OPEN);
    }
  };

  // Closing hands control back at once: the layer behind is live again while
  // the sheet is still on its way out.
  const close = (i: number, velocity?: number) => {
    setStack(i);
    const { y, opacity } = values[i];
    if (velocity !== undefined) {
      animate(y, closedAt(i), { ...RELEASE, velocity });
    } else if (reduce) {
      animate(opacity, 0, {
        ...FADE,
        // Parked offscreen once invisible, unless it was reopened meanwhile.
        onComplete: () => {
          if (depthRef.current <= i) y.jump(closedAt(i));
        },
      });
    } else {
      animate(y, closedAt(i), CLOSE);
    }
  };

  const settle = (i: number, velocity: number) =>
    animate(values[i].y, 0, { ...RELEASE, velocity });

  // Focus follows the stack: into a sheet as it opens, back to whatever
  // opened it as it closes. Only reclaimed if focus was in the demo, or was
  // dropped to the body when the sheet went inert.
  const shown = useRef(0);
  useEffect(() => {
    const before = shown.current;
    shown.current = depth;
    if (depth > before) {
      sheetRefs.current[depth - 1]?.focus({ preventScroll: true });
    } else if (depth < before) {
      const active = document.activeElement;
      if (
        !active ||
        active === document.body ||
        frameRef.current?.contains(active)
      ) {
        triggers.current[depth]?.focus({ preventScroll: true });
      }
    }
  }, [depth]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (depthRef.current === 0) return;
    if (e.key === "Escape") {
      e.preventDefault();
      close(depthRef.current - 1);
      return;
    }
    if (e.key !== "Tab") return;
    // Keeps Tab inside the open sheet, as a modal should.
    const sheet = sheetRefs.current[depthRef.current - 1];
    const focusable = sheet?.querySelectorAll<HTMLElement>("button");
    if (!sheet || !focusable?.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (
      e.shiftKey &&
      (document.activeElement === first || document.activeElement === sheet)
    ) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  const one = useMotionValue(1);
  const zero = useMotionValue(0);
  const basePush = usePush(values[0] ?? nothing, heightOf(0));
  const baseScale = useTransform(basePush, [0, 1], [1, PUSH_SCALE]);
  const baseY = useTransform(basePush, [0, 1], [0, BASE_DROP]);
  const baseDim = useTransform(basePush, [0, 1], [0, DIM]);

  return (
    <div
      ref={frameRef}
      onKeyDown={onKeyDown}
      style={{ height: FRAME_H }}
      // The backdrop only shows once the page is pushed back: darker than
      // the page in both themes, like the black behind an iOS sheet.
      className={cn(
        "relative w-[320px] max-w-full overflow-hidden rounded-[40px] bg-border shadow-raised dark:bg-background",
        className,
      )}
    >
      <motion.div
        inert={depth > 0}
        style={{
          y: reduce ? zero : baseY,
          scale: reduce ? one : baseScale,
        }}
        className="absolute inset-0 flex origin-top flex-col rounded-[40px] bg-surface p-7"
      >
        {children}
        <button
          ref={(el) => {
            triggers.current[0] = el;
          }}
          type="button"
          onClick={() => open(0)}
          className="mt-auto h-11 touch-manipulation rounded-full bg-foreground text-[15px] font-medium text-background outline-hidden transition-[scale] duration-150 ease-out select-none focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-foreground active:scale-[0.96] motion-reduce:transition-none"
        >
          {trigger}
        </button>
        <Scrim opacity={baseDim} className="rounded-[40px]" />
      </motion.div>

      {sheets.map((sheet, i) => (
        <SheetLayer
          key={i}
          index={i}
          sheet={sheet}
          values={values[i]}
          above={values[i + 1] ?? nothing}
          isTop={i === depth - 1}
          reduce={reduce}
          one={one}
          setRef={(el) => {
            sheetRefs.current[i] = el;
          }}
          setNextRef={(el) => {
            triggers.current[i + 1] = el;
          }}
          hasNext={i + 1 < sheets.length}
          onNext={() => open(i + 1)}
          onClose={(velocity) => close(i, velocity)}
          onSettle={(velocity) => settle(i, velocity)}
        />
      ))}
    </div>
  );
}

function SheetLayer({
  index,
  sheet,
  values,
  above,
  isTop,
  reduce,
  one,
  setRef,
  setNextRef,
  hasNext,
  onNext,
  onClose,
  onSettle,
}: {
  index: number;
  sheet: Sheet;
  values: Values;
  above: Values;
  isTop: boolean;
  reduce: boolean;
  one: MotionValue<number>;
  setRef: (el: HTMLDivElement | null) => void;
  setNextRef: (el: HTMLButtonElement | null) => void;
  hasNext: boolean;
  onNext: () => void;
  onClose: (velocity?: number) => void;
  onSettle: (velocity: number) => void;
}) {
  const titleId = useId();
  const push = usePush(above, heightOf(index + 1));
  const scale = useTransform(push, [0, 1], [1, PUSH_SCALE]);
  const dim = useTransform(push, [0, 1], [0, DIM]);
  const drag = useRef<{
    pointer: number;
    startY: number;
    from: number;
    active: boolean;
  } | null>(null);
  const dragged = useRef(false);

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    // One finger at a time; a second touch mid-drag is ignored.
    if (!isTop || drag.current || (e.pointerType === "mouse" && e.button !== 0))
      return;
    dragged.current = false;
    values.y.stop();
    drag.current = {
      pointer: e.pointerId,
      startY: e.clientY,
      from: values.y.get(),
      active: false,
    };
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || e.pointerId !== d.pointer) return;
    const delta = e.clientY - d.startY;
    if (!d.active) {
      if (Math.abs(delta) < DRAG_START) return;
      d.active = true;
      dragged.current = true;
      e.currentTarget.setPointerCapture(e.pointerId);
    }
    const raw = d.from + delta;
    values.y.set(raw < 0 ? -rubberBand(-raw) : raw);
  };

  const onPointerEnd = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || e.pointerId !== d.pointer) return;
    drag.current = null;
    if (!d.active) return;
    const velocity = values.y.getVelocity();
    const offset = values.y.get();
    if (
      offset > heightOf(index) * DISMISS_DISTANCE ||
      velocity > DISMISS_VELOCITY
    ) {
      onClose(velocity);
    } else {
      onSettle(velocity);
    }
  };

  return (
    <motion.div
      ref={setRef}
      role="dialog"
      aria-modal
      aria-labelledby={titleId}
      tabIndex={-1}
      inert={!isTop}
      style={{
        top: topOf(index),
        bottom: -RUBBER,
        paddingBottom: RUBBER,
        y: values.y,
        opacity: values.opacity,
        scale: reduce ? one : scale,
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerEnd}
      onPointerCancel={onPointerEnd}
      // A drag that began on a button shouldn't also press it.
      onClickCapture={(e) => {
        if (!dragged.current) return;
        dragged.current = false;
        e.preventDefault();
        e.stopPropagation();
      }}
      className={cn(
        "absolute inset-x-0 flex origin-top touch-none flex-col rounded-t-[28px] bg-background shadow-raised outline-hidden select-none",
        isTop && "cursor-grab active:cursor-grabbing",
      )}
    >
      <div
        aria-hidden
        className="mx-auto mt-2.5 h-1.5 w-11 shrink-0 rounded-full bg-border"
      />
      <div className="flex flex-1 flex-col px-6 pt-5 pb-6">
        <h2 id={titleId} className="text-xl font-medium tracking-tight">
          {sheet.title}
        </h2>
        <p className="mt-1.5 text-[15px] text-pretty text-muted">
          {sheet.description}
        </p>
        <div className="mt-auto flex flex-col gap-2.5">
          {hasNext && sheet.next && (
            <button
              ref={setNextRef}
              type="button"
              onClick={onNext}
              className="h-11 touch-manipulation rounded-full bg-foreground text-[15px] font-medium text-background outline-hidden transition-[scale] duration-150 ease-out select-none focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-foreground active:scale-[0.96] motion-reduce:transition-none"
            >
              {sheet.next}
            </button>
          )}
          <button
            type="button"
            onClick={() => onClose()}
            className="h-11 touch-manipulation rounded-full bg-surface text-[15px] font-medium text-foreground shadow-raised outline-hidden transition-[scale] duration-150 ease-out select-none focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-foreground active:scale-[0.96] motion-reduce:transition-none"
          >
            Done
          </button>
        </div>
      </div>
      <Scrim opacity={dim} className="rounded-t-[28px]" />
    </motion.div>
  );
}

// Scales and rounds with its layer. Pure black dims both themes the same way,
// where a foreground tint would lighten the dark one.
function Scrim({
  opacity,
  className,
}: {
  opacity: MotionValue<number>;
  className?: string;
}) {
  return (
    <motion.div
      aria-hidden
      style={{ opacity }}
      className={cn(
        "pointer-events-none absolute inset-0 bg-[oklch(0_0_0)]",
        className,
      )}
    />
  );
}

const SHEETS: Sheet[] = [
  {
    title: "Share draft",
    description:
      "Anyone with the link can view. Invite people to let them edit.",
    next: "Invite people",
  },
  {
    title: "Invite people",
    description: "They'll get an email and can edit right away.",
  },
];

export default function StackedDrawerDemo() {
  return (
    <StackedDrawer sheets={SHEETS} trigger="Share">
      <p className="text-[13px] text-muted">Drafts</p>
      <p className="mt-1.5 text-2xl font-medium tracking-tight">Launch notes</p>
      <p className="mt-4 text-[15px] text-pretty text-muted">
        Three fixes, one new component, and a faster index. Ship Thursday after
        review.
      </p>
    </StackedDrawer>
  );
}
