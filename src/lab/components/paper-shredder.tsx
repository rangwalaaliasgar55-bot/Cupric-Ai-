import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import {
  animate,
  motion,
  useMotionValue,
  useTransform,
  type AnimationPlaybackControls,
  type MotionValue,
} from "motion/react";
import { useReducedMotion } from "@/lib/use-reduced-motion";
import { cn } from "@/lib/cn";

export type ShredderFile = { id: string; name: string; meta: string };

type Fall = { dy: number; rot: number; delay: number };
type Flight = {
  key: number;
  file: ShredderFile;
  index: number;
  top: number;
  x: number;
  velocity: number;
  mode: "shred" | "restore";
  falls: Fall[];
};

const ROW_H = 52;
const ROW_GAP = 6;
const ROWS = 4;
const LIST_H = ROWS * ROW_H + (ROWS - 1) * ROW_GAP;
const HEAD_GAP = 20;
const HEAD_H = 48;
// The paper disappears in the middle of the 4px mouth groove, 6px into the
// head, so it reads as going into the slot rather than behind the body.
const SLOT_Y = LIST_H + HEAD_GAP + 8;
const BIN_TOP = LIST_H + HEAD_GAP + HEAD_H;
const BIN_H = 88;
const STRIPS = 10;
// A motor feeds paper at a constant speed, so the feed is linear on
// purpose: 52px in 360ms.
const FEED = 0.36;
// Each strip falls for 420ms, longer than UI motion because it is gravity,
// and the scatter of start delays (up to 90ms) keeps them from moving as one.
const FALL = 0.42;
const MAX_DELAY = 0.09;
// Drags within this distance of the slot, or thrown down faster than this
// (px/s), get pulled in on release.
const GRAB_DISTANCE = 64;
const GRAB_VELOCITY = 600;
const EASE_IN_OUT = [0.77, 0, 0.175, 1] as const;
const EASE_OUT = [0.23, 1, 0.32, 1] as const;
const RETURN = { type: "spring", stiffness: 420, damping: 34 } as const;
// How long the undo toast waits before leaving on its own.
const TOAST_MS = 6000;

function rollFalls(): Fall[] {
  return Array.from({ length: STRIPS }, () => ({
    dy: 32 + Math.random() * 28,
    rot: (Math.random() - 0.5) * 14,
    delay: Math.random() * MAX_DELAY,
  }));
}

export function PaperShredder({
  files: initialFiles,
  onShred,
  onRestore,
  className,
}: {
  files: ShredderFile[];
  onShred?: (file: ShredderFile) => void;
  onRestore?: (file: ShredderFile) => void;
  className?: string;
}) {
  const reduceMotion = useReducedMotion();
  const hintId = useId();
  const [files, setFiles] = useState(initialFiles);
  const [flights, setFlights] = useState<Flight[]>([]);
  const [trash, setTrash] = useState<Flight[]>([]);
  const [running, setRunning] = useState(0);
  const [toast, setToast] = useState(false);
  const nextKey = useRef(0);
  const rows = useRef(new Map<string, HTMLLIElement>());
  // Where each restored file's flight ended, so its row can glide home
  // from there instead of appearing in place.
  const arrivals = useRef(new Map<string, number>());
  const toastTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  // The last undo hides the toast and takes its button with it, so focus
  // goes to the restored row instead of being dropped.
  const refocus = useRef<string>(undefined);

  useEffect(() => () => clearTimeout(toastTimer.current), []);

  const showToast = () => {
    setToast(true);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(false), TOAST_MS);
  };

  const focusRow = (id: string | undefined) =>
    requestAnimationFrame(() => {
      if (id) rows.current.get(id)?.focus();
    });

  const shred = (id: string, top: number, x = 0, velocity = 0) => {
    const index = files.findIndex((f) => f.id === id);
    if (index === -1) return;
    const file = files[index];
    const flight: Flight = {
      key: nextKey.current++,
      file,
      index,
      top,
      x,
      velocity,
      mode: "shred",
      falls: rollFalls(),
    };
    setFiles((list) => list.filter((f) => f.id !== id));
    onShred?.(file);
    if (reduceMotion) {
      setTrash((t) => [...t, flight]);
      showToast();
    } else {
      setFlights((f) => [...f, flight]);
    }
    return files[index + 1]?.id ?? files[index - 1]?.id;
  };

  const land = (id: string, top: number, index: number, file: ShredderFile) => {
    arrivals.current.set(id, top);
    setFiles((list) => {
      const next = [...list];
      next.splice(Math.min(index, next.length), 0, file);
      return next;
    });
    onRestore?.(file);
    if (refocus.current === id) {
      refocus.current = undefined;
      focusRow(id);
    }
  };

  const undo = () => {
    const last = trash.at(-1);
    if (!last) return;
    setTrash((t) => t.slice(0, -1));
    if (trash.length === 1) {
      setToast(false);
      refocus.current = last.file.id;
    } else showToast();
    if (reduceMotion) {
      land(last.file.id, 0, last.index, last.file);
      arrivals.current.delete(last.file.id);
      return;
    }
    // Still falling: reverse it from wherever it is. Already gone: bring
    // it back from the bin.
    setFlights((f) =>
      f.some((x) => x.key === last.key)
        ? f.map((x) => (x.key === last.key ? { ...x, mode: "restore" } : x))
        : [...f, { ...last, mode: "restore" }],
    );
  };

  const latest = trash.at(-1);
  // Holds the last name while the toast fades out, so it never empties
  // mid-exit.
  const [toastName, setToastName] = useState("");
  if (latest && latest.file.name !== toastName) setToastName(latest.file.name);

  return (
    <div
      className={cn(
        "w-[min(440px,100%)] rounded-[20px] bg-surface p-4 shadow-raised",
        className,
      )}
    >
      <div className="flex items-baseline justify-between px-3">
        <h2 className="text-base font-medium text-foreground">Documents</h2>
        <span className="text-xs text-muted tabular-nums">
          {files.length} {files.length === 1 ? "file" : "files"}
        </span>
      </div>

      <div className="relative mt-3" style={{ height: BIN_TOP + BIN_H }}>
        <ul
          aria-label="Documents"
          aria-describedby={hintId}
          className="relative mx-3 flex flex-col"
          style={{ height: LIST_H, gap: ROW_GAP }}
        >
          {files.map((file) => (
            <Row
              key={file.id}
              file={file}
              arrivals={arrivals}
              reduceMotion={!!reduceMotion}
              register={(el) => {
                if (el) rows.current.set(file.id, el);
                else rows.current.delete(file.id);
              }}
              onShred={(top, x, velocity, fromKeyboard) => {
                const next = shred(file.id, top, x, velocity);
                if (fromKeyboard) focusRow(next);
              }}
              onMove={(delta) => {
                const i = files.findIndex((f) => f.id === file.id);
                focusRow(files[i + delta]?.id);
              }}
            />
          ))}
          {files.length === 0 && flights.length === 0 && (
            <li className="flex h-full items-center justify-center text-sm text-muted">
              Nothing left to shred.
            </li>
          )}
        </ul>
        <p id={hintId} className="sr-only">
          Press Delete to shred the focused file, or drag it into the shredder.
        </p>

        <Head running={running > 0 && !reduceMotion} />
        <BinBack count={trash.length} />

        {flights.map((flight) => (
          <FlightView
            key={flight.key}
            flight={flight}
            onFeeding={(on) => setRunning((n) => n + (on ? 1 : -1))}
            onShredded={() => {
              setTrash((t) =>
                t.some((x) => x.key === flight.key) ? t : [...t, flight],
              );
              showToast();
            }}
            onGone={() =>
              setFlights((f) => f.filter((x) => x.key !== flight.key))
            }
            onLanded={(top) => {
              setFlights((f) => f.filter((x) => x.key !== flight.key));
              land(flight.file.id, top, flight.index, flight.file);
            }}
          />
        ))}
        <BinFront />
      </div>

      <div className="mt-2 flex h-10 items-center justify-center">
        <div
          inert={!toast}
          className={cn(
            "flex h-10 items-center gap-3 rounded-full bg-foreground pr-1 pl-4 text-sm text-background",
            "transition-[opacity,filter,translate] ease-[cubic-bezier(0.23,1,0.32,1)] motion-reduce:transition-[opacity]",
            toast
              ? "translate-y-0 opacity-100 filter-none duration-300"
              : "translate-y-1 opacity-0 blur-[4px] duration-150 motion-reduce:translate-y-0 motion-reduce:filter-none",
          )}
        >
          <span className="max-w-[220px] truncate">
            Shredded <span className="font-medium">{toastName}</span>
          </span>
          <button
            type="button"
            onClick={undo}
            className="h-8 touch-manipulation rounded-full bg-background/15 px-3 text-sm font-medium text-background outline-hidden transition-[scale,background-color] duration-150 ease-out select-none hover:bg-background/25 focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-foreground active:scale-[0.96]"
          >
            Undo
          </button>
        </div>
      </div>
      <span className="sr-only" aria-live="polite">
        {toast && toastName ? `Shredded ${toastName}` : ""}
      </span>
    </div>
  );
}

function Row({
  file,
  arrivals,
  reduceMotion,
  register,
  onShred,
  onMove,
}: {
  file: ShredderFile;
  arrivals: React.RefObject<Map<string, number>>;
  reduceMotion: boolean;
  register: (el: HTMLLIElement | null) => void;
  onShred: (
    top: number,
    x: number,
    velocity: number,
    fromKeyboard: boolean,
  ) => void;
  onMove: (delta: 1 | -1) => void;
}) {
  const ref = useRef<HTMLLIElement>(null);
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const [lifted, setLifted] = useState(false);
  const drag = useRef<{
    id: number;
    startX: number;
    startY: number;
    active: boolean;
    lastY: number;
    lastT: number;
    velocity: number;
  } | null>(null);
  const spring = useRef<AnimationPlaybackControls>(undefined);

  // A restored file glides from where its flight stopped into its slot.
  useLayoutEffect(() => {
    const from = arrivals.current.get(file.id);
    const el = ref.current;
    if (from === undefined || !el) return;
    arrivals.current.delete(file.id);
    y.jump(from - el.offsetTop);
    spring.current = animate(y, 0, RETURN);
  }, [arrivals, file.id, y]);

  useEffect(() => () => spring.current?.stop(), []);

  const top = () => (ref.current?.offsetTop ?? 0) + y.get();

  const end = (commit: boolean) => {
    const d = drag.current;
    drag.current = null;
    setLifted(false);
    if (!d?.active) return;
    if (commit) {
      onShred(top(), x.get(), d.velocity, false);
    } else {
      spring.current = animate(y, 0, { ...RETURN, velocity: d.velocity });
      animate(x, 0, RETURN);
    }
  };

  return (
    <motion.li
      ref={(el) => {
        ref.current = el;
        register(el);
      }}
      layout={reduceMotion ? false : "position"}
      transition={{ layout: { duration: 0.3, ease: EASE_OUT } }}
      tabIndex={0}
      aria-label={`${file.name}, ${file.meta}`}
      style={{ x, y, height: ROW_H }}
      className={cn(
        "relative shrink-0 cursor-grab touch-none rounded-[12px] outline-hidden select-none focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-foreground",
        lifted && "z-20 cursor-grabbing",
      )}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return;
        if (e.key === "Delete" || e.key === "Backspace") {
          e.preventDefault();
          onShred(top(), 0, 0, true);
        }
        if (e.key === "ArrowDown" || e.key === "ArrowUp") {
          e.preventDefault();
          onMove(e.key === "ArrowDown" ? 1 : -1);
        }
      }}
      onPointerDown={(e) => {
        if (e.button !== 0 || drag.current) return;
        if ((e.target as HTMLElement).closest("button")) return;
        spring.current?.stop();
        drag.current = {
          id: e.pointerId,
          startX: e.clientX - x.get(),
          startY: e.clientY - y.get(),
          active: false,
          lastY: e.clientY,
          lastT: e.timeStamp,
          velocity: 0,
        };
        e.currentTarget.setPointerCapture(e.pointerId);
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (!d || d.id !== e.pointerId) return;
        const dx = e.clientX - d.startX;
        const dy = e.clientY - d.startY;
        // 4px of slop, so a press to focus never nudges the row.
        if (!d.active && Math.hypot(dx, dy) < 4) return;
        if (!d.active) {
          d.active = true;
          setLifted(true);
        }
        const dt = Math.max(e.timeStamp - d.lastT, 1);
        // Smoothed so one jittery sample can't decide a throw.
        d.velocity = d.velocity * 0.6 + ((e.clientY - d.lastY) / dt) * 400;
        d.lastY = e.clientY;
        d.lastT = e.timeStamp;
        // Sideways drags give only 15%: the slot only takes paper straight.
        x.set(dx * 0.15);
        y.set(dy);
        const bottom = top() + ROW_H;
        // Touching the slot, the shredder takes it from your hand.
        if (bottom >= SLOT_Y - 2) end(true);
      }}
      onPointerUp={(e) => {
        const d = drag.current;
        if (!d || d.id !== e.pointerId) return;
        const bottom = top() + ROW_H;
        end(bottom > SLOT_Y - GRAB_DISTANCE || d.velocity > GRAB_VELOCITY);
      }}
      onPointerCancel={(e) => {
        if (drag.current?.id === e.pointerId) end(false);
      }}
    >
      <FileFace
        file={file}
        lifted={lifted}
        action={
          <button
            type="button"
            aria-label={`Shred ${file.name}`}
            onClick={() => onShred(top(), x.get(), 0, false)}
            className="flex size-9 shrink-0 touch-manipulation items-center justify-center rounded-full text-muted outline-hidden transition-[scale,color,background-color] duration-150 ease-out hover:bg-surface hover:text-foreground focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-foreground active:scale-[0.96]"
          >
            <TrashIcon />
          </button>
        }
      />
    </motion.li>
  );
}

function FileFace({
  file,
  lifted = false,
  action,
}: {
  file: ShredderFile;
  lifted?: boolean;
  action?: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex h-full w-full items-center gap-3 rounded-[12px] bg-background pr-2 pl-3 shadow-raised transition-[box-shadow] duration-150 ease-out",
        lifted &&
          "shadow-[var(--shadow-raised),0_12px_24px_-8px_oklch(0_0_0/0.18)]",
      )}
    >
      <svg
        aria-hidden
        viewBox="0 0 20 20"
        className="size-5 shrink-0 text-muted"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        strokeLinejoin="round"
      >
        <path d="M5 2.75h6.5L15.25 6.5v10a.75.75 0 0 1-.75.75h-9.5a.75.75 0 0 1-.75-.75V3.5a.75.75 0 0 1 .75-.75Z" />
        <path d="M11.25 2.75V6.75h4" />
      </svg>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-foreground">
          {file.name}
        </p>
        <p className="truncate text-xs text-muted">{file.meta}</p>
      </div>
      {action ?? (
        <span className="flex size-9 shrink-0 items-center justify-center text-muted">
          <TrashIcon />
        </span>
      )}
    </div>
  );
}

// One flight draws the paper above the slot and its strips below the
// head from the same motion values, so both halves always agree.
function FlightView({
  flight,
  onFeeding,
  onShredded,
  onGone,
  onLanded,
}: {
  flight: Flight;
  onFeeding: (on: boolean) => void;
  onShredded: () => void;
  onGone: () => void;
  onLanded: (top: number) => void;
}) {
  const shredding = flight.mode === "shred";
  // A flight created for an undo starts fully shredded, in the bin.
  const y = useMotionValue(shredding ? flight.top : SLOT_Y);
  const x = useMotionValue(shredding ? flight.x : 0);
  const t = useMotionValue(shredding ? 0 : 1);
  const depth = useTransform(y, (v) =>
    Math.min(Math.max(v + ROW_H - SLOT_Y, 0), ROW_H),
  );
  const callbacks = useRef({ onFeeding, onShredded, onGone, onLanded });
  useLayoutEffect(() => {
    callbacks.current = { onFeeding, onShredded, onGone, onLanded };
  });

  useEffect(() => {
    let cancelled = false;
    let current: AnimationPlaybackControls | undefined;
    const others: AnimationPlaybackControls[] = [];
    let feeding = false;
    const cb = callbacks.current;
    const step = (c: AnimationPlaybackControls) => {
      current = c;
      return c;
    };
    const feed = (on: boolean) => {
      if (feeding === on) return;
      feeding = on;
      callbacks.current.onFeeding(on);
    };

    const shred = async () => {
      const entry = SLOT_Y - ROW_H;
      if (y.get() < entry - 1) {
        const straighten = animate(x, 0, { duration: 0.3, ease: EASE_IN_OUT });
        others.push(straighten);
        await step(
          flight.velocity
            ? animate(y, entry, {
                type: "spring",
                velocity: flight.velocity,
                stiffness: 300,
                damping: 34,
                restDelta: 0.5,
              })
            : animate(y, entry, { duration: 0.3, ease: EASE_IN_OUT }),
        );
        if (cancelled) return;
      }
      feed(true);
      const remaining = (SLOT_Y - y.get()) / ROW_H;
      await step(
        animate(y, SLOT_Y, { duration: FEED * remaining, ease: "linear" }),
      );
      feed(false);
      if (cancelled) return;
      callbacks.current.onShredded();
      await step(
        animate(t, 1, {
          duration: (FALL + MAX_DELAY) * (1 - t.get()),
          ease: "linear",
        }),
      );
      if (!cancelled) callbacks.current.onGone();
    };

    // Reassembles in about half the time it took to come apart.
    const restore = async () => {
      if (t.get() > 0) {
        await step(animate(t, 0, { duration: 0.2 * t.get(), ease: "linear" }));
        if (cancelled) return;
      }
      feed(true);
      const remaining = (y.get() - (SLOT_Y - ROW_H)) / ROW_H;
      await step(
        animate(y, SLOT_Y - ROW_H, {
          duration: 0.22 * remaining,
          ease: "linear",
        }),
      );
      feed(false);
      if (!cancelled) callbacks.current.onLanded(y.get());
    };

    if (flight.mode === "shred") shred();
    else restore();
    return () => {
      cancelled = true;
      current?.stop();
      others.forEach((c) => c.stop());
      if (feeding) cb.onFeeding(false);
    };
  }, [flight.mode, flight.velocity, x, y, t]);

  return (
    <>
      {/* Paper above the slot: this layer's bottom edge is the slot line. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-3 top-0 z-10 overflow-hidden"
        style={{ height: SLOT_Y }}
      >
        <motion.div
          className="absolute inset-x-0 top-0"
          style={{ height: ROW_H, y, x }}
        >
          <FileFace file={flight.file} lifted />
        </motion.div>
      </div>
      {/* Strips below the head: this layer's top edge is where they exit. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-3 overflow-hidden"
        style={{ top: BIN_TOP, height: BIN_H }}
      >
        {flight.falls.map((fall, i) => (
          <Strip
            key={i}
            index={i}
            fall={fall}
            depth={depth}
            t={t}
            file={flight.file}
          />
        ))}
      </div>
    </>
  );
}

function Strip({
  index,
  fall,
  depth,
  t,
  file,
}: {
  index: number;
  fall: Fall;
  depth: MotionValue<number>;
  t: MotionValue<number>;
  file: ShredderFile;
}) {
  // Each strip's own progress through the shared fall, eased in: gravity.
  const local = useTransform(t, (v) => {
    const p = Math.min(
      Math.max((v * (FALL + MAX_DELAY) - fall.delay) / FALL, 0),
      1,
    );
    return p * p;
  });
  const y = useTransform(() => depth.get() - ROW_H + fall.dy * local.get());
  const rotate = useTransform(local, (p) => fall.rot * p);
  // Strips drift apart a little as they fall, outward from the middle.
  const x = useTransform(local, (p) => (index - (STRIPS - 1) / 2) * 1.2 * p);
  const opacity = useTransform(local, [0, 0.35, 1], [1, 1, 0]);
  return (
    <motion.div
      className="absolute top-0 overflow-hidden"
      style={{
        left: `${(index * 100) / STRIPS}%`,
        width: `${100 / STRIPS}%`,
        height: ROW_H,
        y,
        x,
        rotate,
        opacity,
        originY: 0,
      }}
    >
      <div
        className="absolute top-0 h-full"
        style={{
          left: `${-index * 100}%`,
          width: `${STRIPS * 100}%`,
        }}
      >
        <FileFace file={file} />
      </div>
      {/* The cut between strips. */}
      <div className="absolute inset-y-0 right-0 w-px bg-surface" />
    </motion.div>
  );
}

// The machine is a physical object, the same in both themes: charcoal
// plastic with a lighter moulded edge, a black mouth and a green power
// light.
const BODY = "oklch(0.29 0.006 260)";
const BODY_EDGE = "oklch(0.4 0.006 260)";
const MOUTH = "oklch(0.13 0 0)";
const LED_ON = "oklch(0.8 0.18 145)";
const LED_OFF = "oklch(0.42 0.02 145)";

// Seeded, so the pile of strips is the same on the server and the client.
function seeded(seed: number) {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

// One layer of strips per shredded file, drawn up front and faded in as
// files land, so the basket fills up and empties on undo. Layer 0 is what
// was already in the basket, so it never starts out bare.
const PILE_LAYERS = 6;
const PILE = (() => {
  const next = seeded(7);
  return Array.from({ length: PILE_LAYERS }, (_, layer) =>
    Array.from({ length: 22 }, () => ({
      x: -10 + next() * 390,
      y: 41 - layer * 6 - next() * 4,
      w: 24 + next() * 40,
      rot: (next() - 0.5) * 24,
    })),
  );
})();

function BinBack({ count }: { count: number }) {
  return (
    <div
      aria-hidden
      className="absolute inset-x-2 overflow-hidden rounded-b-[16px] bg-foreground/[0.035] shadow-[inset_0_10px_12px_-8px_oklch(0_0_0/0.3)]"
      style={{ top: BIN_TOP, height: BIN_H }}
    >
      <svg
        viewBox="0 0 400 48"
        preserveAspectRatio="none"
        className="absolute inset-x-0 bottom-0 h-12 w-full"
      >
        {PILE.map((layer, i) => (
          <g
            key={i}
            className={cn(
              "transition-opacity ease-out motion-reduce:delay-0",
              // A new layer appears once its strips have fallen onto it.
              i <= count ? "opacity-100 delay-300 duration-300" : "opacity-0 duration-150",
            )}
          >
            {layer.map((s, j) => (
              <rect
                key={j}
                x={s.x}
                y={s.y}
                width={s.w}
                height={5}
                rx={1}
                transform={`rotate(${s.rot} ${s.x + s.w / 2} ${s.y + 2})`}
                fill="var(--background)"
                stroke="color-mix(in oklab, var(--foreground) 24%, transparent)"
                strokeWidth={0.8}
              />
            ))}
          </g>
        ))}
      </svg>
    </div>
  );
}

// The basket's wire front, drawn over the falling strips so they land
// inside it rather than in front of it.
function BinFront() {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-x-2 rounded-b-[16px] border-x-[1.5px] border-b-[1.5px] border-foreground/15"
      style={{
        top: BIN_TOP,
        height: BIN_H,
        backgroundImage:
          "repeating-linear-gradient(90deg, color-mix(in oklab, var(--foreground) 9%, transparent) 0 1.5px, transparent 1.5px 12px)",
      }}
    />
  );
}

function Head({ running }: { running: boolean }) {
  return (
    <motion.div
      aria-hidden
      className="absolute inset-x-0 z-[5] flex items-end justify-between rounded-t-[10px] rounded-b-[8px] px-4 pb-2.5"
      style={{
        top: LIST_H + HEAD_GAP,
        height: HEAD_H,
        background: BODY,
        boxShadow: `inset 0 1px 0 ${BODY_EDGE}, 0 6px 14px -6px oklch(0 0 0 / 0.45)`,
      }}
      // A sub-pixel buzz: enough to feel the motor, not enough to blur text.
      animate={
        running
          ? { x: [0, -0.7, 0.6, -0.3, 0], y: [0, 0.3, -0.2, 0.3, 0] }
          : { x: 0, y: 0 }
      }
      transition={
        running
          ? { duration: 0.12, repeat: Infinity, ease: "linear" }
          : { duration: 0.1 }
      }
    >
      {/* The mouth: a black slot under a moulded lip, centred on SLOT_Y. */}
      <div
        className="absolute inset-x-2.5 top-[5px] h-1.5 rounded-full"
        style={{
          background: MOUTH,
          boxShadow: `0 1px 0 ${BODY_EDGE}`,
        }}
      />
      <span className="text-xs font-semibold tracking-[0.24em] text-[oklch(1_0_0/0.4)]">
        SHRED
      </span>
      <span className="flex items-center gap-2 text-xs font-medium tracking-wide text-[oklch(1_0_0/0.4)]">
        AUTO
        <span
          className="size-1.5 rounded-full transition-[background-color,box-shadow] duration-150 ease-out"
          style={{
            background: running ? LED_ON : LED_OFF,
            boxShadow: running ? `0 0 6px ${LED_ON}` : "none",
          }}
        />
      </span>
    </motion.div>
  );
}

function TrashIcon() {
  return (
    <svg
      aria-hidden
      viewBox="0 0 16 16"
      className="size-4"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M2.75 4.25h10.5M6.25 4.25v-1.5h3.5v1.5M4 4.25l.6 8.1a1 1 0 0 0 1 .9h4.8a1 1 0 0 0 1-.9l.6-8.1M6.75 7v3.75M9.25 7v3.75" />
    </svg>
  );
}

const DEMO_FILES: ShredderFile[] = [
  { id: "q3", name: "Q3 report.pdf", meta: "PDF, 2.4 MB" },
  { id: "invoice", name: "Invoice 0142.pdf", meta: "PDF, 184 KB" },
  { id: "contract", name: "Contract draft.docx", meta: "Word, 96 KB" },
  { id: "tax", name: "Tax return 2025.pdf", meta: "PDF, 1.1 MB" },
];

export default function PaperShredderDemo() {
  return <PaperShredder files={DEMO_FILES} />;
}
