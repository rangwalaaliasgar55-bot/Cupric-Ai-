import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { animate } from "motion/react";
import { useReducedMotion } from "@/lib/use-reduced-motion";
import { cn } from "@/lib/cn";

export type Time = { hour: number; minute: number; period: "AM" | "PM" };

const ROW = 40;
// Five and a half rows: two full rows either side of the selection plus the
// foreshortened edge of a third, which is what sells the curve.
const HEIGHT = 220;
const PAD = (HEIGHT - ROW) / 2;
// Each row sits this far around the drum, so the fifth row away reaches 90deg
// and turns edge-on right as it leaves the column.
const STEP = 18;
// The drum radius whose arc between neighbours is exactly one row, so rows
// near the centre keep their spacing and only the far ones bunch up.
const RADIUS = ROW / ((STEP * Math.PI) / 180);
// Apple's projection constant, a touch below scroll's 0.998 so a flick
// travels a handful of rows rather than the whole column.
const DECELERATION = 0.995;
// Critically damped: a wheel that overshoots would flash the wrong value.
const GLIDE = { type: "spring", visualDuration: 0.35, bounce: 0 } as const;
// Past this many px a mouse press becomes a drag rather than a click.
const DRAG_SLOP = 4;

const HOURS = Array.from({ length: 12 }, (_, i) => String(i + 1));
const MINUTES = Array.from({ length: 60 }, (_, i) => String(i).padStart(2, "0"));
const PERIODS = ["AM", "PM"];

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);

export function WheelPicker({
  value,
  onChange,
  className,
}: {
  value: Time;
  onChange: (value: Time) => void;
  className?: string;
}) {
  const minute = String(value.minute).padStart(2, "0");
  return (
    <div
      role="group"
      aria-label="Time"
      className={cn(
        "flex w-[min(360px,100%)] flex-col items-center gap-5 rounded-[28px] bg-background px-4 pt-4 pb-6 shadow-raised",
        className,
      )}
    >
      <div className="relative flex w-full justify-center gap-2">
        {/* Behind the columns, which are transparent, so the middle row
            reads as sitting on the band. */}
        <div
          aria-hidden
          className="absolute inset-x-0 top-1/2 h-10 -translate-y-1/2 rounded-[12px] bg-surface"
        />
        <Column
          label="Hour"
          options={HOURS}
          index={value.hour - 1}
          onIndexChange={(i) => onChange({ ...value, hour: i + 1 })}
        />
        <Column
          label="Minute"
          options={MINUTES}
          index={value.minute}
          onIndexChange={(i) => onChange({ ...value, minute: i })}
        />
        <Column
          label="AM or PM"
          options={PERIODS}
          index={PERIODS.indexOf(value.period)}
          onIndexChange={(i) =>
            onChange({ ...value, period: PERIODS[i] as Time["period"] })
          }
        />
      </div>
      <output
        aria-label="Selected time"
        className="text-5xl font-semibold tracking-[-0.03em] text-foreground tabular-nums"
      >
        {value.hour}:{minute}
        <span className="ml-2 text-2xl font-medium tracking-normal text-muted">
          {value.period}
        </span>
      </output>
    </div>
  );
}

type Glide = ReturnType<typeof animate>;

const Column = memo(function Column({
  label,
  options,
  index,
  onIndexChange,
}: {
  label: string;
  options: string[];
  index: number;
  onIndexChange: (index: number) => void;
}) {
  const reduceMotion = useReducedMotion();
  const ref = useRef<HTMLDivElement>(null);
  // The row under the band right now, written per frame without rendering.
  const current = useRef(index);
  // Where a glide in flight will land, so repeated key presses stack up.
  const goal = useRef(index);
  const glide = useRef<Glide | null>(null);
  const report = useRef(onIndexChange);
  const drag = useRef<{
    y: number;
    top: number;
    active: boolean;
    samples: { y: number; t: number }[];
  } | null>(null);
  const suppressClick = useRef(false);
  const last = options.length - 1;

  useEffect(() => {
    report.current = onIndexChange;
  });

  // Rows are painted straight to the DOM from scroll position, so wheel,
  // trackpad and touch momentum stay fully native and React never renders
  // per frame. Only rows near the band are touched each frame.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const rows = el.children as HTMLCollectionOf<HTMLElement>;
    el.scrollTop = current.current * ROW;
    let lo = 0;
    let hi = rows.length - 1;
    let frame = 0;

    const paint = () => {
      frame = 0;
      const pos = el.scrollTop / ROW;
      const nextLo = Math.max(0, Math.floor(pos) - 6);
      const nextHi = Math.min(rows.length - 1, Math.ceil(pos) + 6);
      for (let i = Math.min(lo, nextLo); i <= Math.max(hi, nextHi); i++) {
        const style = rows[i].style;
        const offset = i - pos;
        const angle = offset * STEP;
        if (Math.abs(angle) >= 90) {
          style.opacity = "0";
          style.transform = "";
          continue;
        }
        const rad = (angle * Math.PI) / 180;
        // Moves each row from its flat scroll position onto the cylinder.
        const dy = RADIUS * Math.sin(rad) - offset * ROW;
        const dz = RADIUS * (Math.cos(rad) - 1);
        style.transform = `translate3d(0, ${dy}px, ${dz}px) rotateX(${-angle}deg)`;
        style.opacity = String(Math.max(1 - Math.abs(offset) * 0.2, 0));
      }
      lo = nextLo;
      hi = nextHi;
      const centred = clamp(Math.round(pos), 0, rows.length - 1);
      if (centred !== current.current) {
        current.current = centred;
        report.current(centred);
      }
    };

    paint();
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(paint);
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      el.removeEventListener("scroll", onScroll);
      cancelAnimationFrame(frame);
      glide.current?.stop();
    };
  }, [options]);

  const restoreSnap = () => {
    if (ref.current) ref.current.style.scrollSnapType = "";
  };

  const interrupt = () => {
    if (!glide.current) return;
    glide.current.stop();
    glide.current = null;
    restoreSnap();
  };

  // Snapping is switched off while we drive scrollTop ourselves, otherwise
  // the browser would re-snap every frame of the spring.
  const glideTo = (target: number, velocity = 0) => {
    const el = ref.current;
    if (!el) return;
    glide.current?.stop();
    const row = clamp(target, 0, last);
    goal.current = row;
    if (reduceMotion) {
      glide.current = null;
      restoreSnap();
      el.scrollTop = row * ROW;
      return;
    }
    el.style.scrollSnapType = "none";
    glide.current = animate(el.scrollTop, row * ROW, {
      ...GLIDE,
      velocity,
      onUpdate: (v) => {
        el.scrollTop = v;
      },
      onComplete: () => {
        glide.current = null;
        restoreSnap();
      },
    });
  };

  // A parent changing the value from outside glides there too.
  useEffect(() => {
    if (index !== current.current && index !== goal.current) glideTo(index);
  });

  const rows = useMemo(
    () =>
      options.map((option, i) => (
        <div
          key={option}
          data-index={i}
          className="flex h-10 shrink-0 snap-center items-center justify-center text-[22px] font-medium text-foreground tabular-nums opacity-0 backface-hidden"
        >
          {option}
        </div>
      )),
    [options],
  );

  return (
    <div
      ref={ref}
      role="spinbutton"
      tabIndex={0}
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={last}
      aria-valuenow={index}
      aria-valuetext={options[index]}
      style={{ height: HEIGHT, paddingBlock: PAD }}
      className="relative w-[72px] cursor-grab snap-y snap-mandatory overflow-y-auto overscroll-contain rounded-[12px] outline-hidden select-none [perspective:520px] [scrollbar-width:none] focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-foreground active:cursor-grabbing [&::-webkit-scrollbar]:hidden"
      onWheel={interrupt}
      onTouchStart={interrupt}
      onPointerDown={(e) => {
        // Touch and pen already scroll natively; only a mouse needs help.
        if (e.pointerType !== "mouse" || e.button !== 0) return;
        interrupt();
        suppressClick.current = false;
        drag.current = {
          y: e.clientY,
          top: e.currentTarget.scrollTop,
          active: false,
          samples: [{ y: e.clientY, t: e.timeStamp }],
        };
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (!d) return;
        const dy = e.clientY - d.y;
        if (!d.active) {
          if (Math.abs(dy) < DRAG_SLOP) return;
          d.active = true;
          suppressClick.current = true;
          e.currentTarget.setPointerCapture(e.pointerId);
          e.currentTarget.style.scrollSnapType = "none";
        }
        e.currentTarget.scrollTop = d.top - dy;
        d.samples.push({ y: e.clientY, t: e.timeStamp });
        // Only the last 100ms say how fast the hand is moving now.
        while (d.samples.length > 2 && e.timeStamp - d.samples[0].t > 100)
          d.samples.shift();
      }}
      onPointerUp={(e) => {
        const d = drag.current;
        drag.current = null;
        if (!d?.active) return;
        const first = d.samples[0];
        const end = d.samples[d.samples.length - 1];
        const dt = (end.t - first.t) / 1000;
        // Dragging down scrolls up, so the scroll velocity is inverted.
        const velocity = dt > 0 ? -(end.y - first.y) / dt : 0;
        const projected =
          e.currentTarget.scrollTop +
          ((velocity / 1000) * DECELERATION) / (1 - DECELERATION);
        glideTo(Math.round(projected / ROW), velocity);
      }}
      onPointerCancel={() => {
        drag.current = null;
        restoreSnap();
      }}
      onClick={(e) => {
        if (suppressClick.current) {
          suppressClick.current = false;
          return;
        }
        const row = (e.target as HTMLElement).closest<HTMLElement>("[data-index]");
        if (row) glideTo(Number(row.dataset.index));
      }}
      onKeyDown={(e) => {
        const from = glide.current ? goal.current : current.current;
        const next = {
          ArrowUp: from - 1,
          ArrowDown: from + 1,
          PageUp: from - 5,
          PageDown: from + 5,
          Home: 0,
          End: last,
        }[e.key];
        if (next === undefined) return;
        e.preventDefault();
        glideTo(next);
      }}
    >
      {rows}
    </div>
  );
});

export default function WheelPickerDemo() {
  const [time, setTime] = useState<Time>({ hour: 7, minute: 30, period: "AM" });
  return <WheelPicker value={time} onChange={setTime} />;
}
