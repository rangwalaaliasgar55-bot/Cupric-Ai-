import { useEffect, useId, useRef } from "react";
import { animate, type AnimationPlaybackControls } from "motion/react";
import { useReducedMotion } from "@/lib/use-reduced-motion";
import { cn } from "@/lib/cn";

export type CanvasNote = {
  id: string;
  x: number;
  y: number;
  title: string;
  text: string;
  rotate?: number;
  accent?: boolean;
};

type View = { x: number; y: number; s: number };
type Point = { x: number; y: number };

const MIN_SCALE = 0.25;
const MAX_SCALE = 3;
// World units between grid dots at 100%.
const GRID = 24;
// Critically damped and about 300ms: view changes are navigation, and a
// camera that overshoots its target makes people feel seasick.
const VIEW_SPRING = { type: "spring", visualDuration: 0.3, bounce: 0 } as const;
// Velocity kept per millisecond of coasting. 0.995 gives a time constant of
// about 200ms, so a flick glides a short way and settles, like Figma rather
// than a long iOS scroll list.
const FRICTION = 0.995;
// Below this (px per ms) a release is a placement, not a throw.
const MIN_FLICK = 0.05;
// A pause this long before lifting the finger cancels the throw.
const STALE_RELEASE = 50;
// Velocity is averaged over the last 100ms, smoothing jittery final events.
const VELOCITY_WINDOW = 100;
const BUTTON_ZOOM = 1.5;
const KEY_PAN = 80;
const FIT_PADDING = 32;
// Tuned so one trackpad pinch gesture covers roughly the full zoom range and
// one ctrl + mouse wheel notch (about 100px) zooms by ~16%.
const PINCH_SPEED = 0.01;
const WHEEL_SPEED = 0.0015;
// How recently the page must have scrolled for a wheel over the canvas to
// count as the same page scroll: longer than the gap between wheel events.
const PAGE_SCROLL_GRACE = 250;
// Pixels per line when the browser reports wheel deltas in lines.
const LINE_HEIGHT = 33;

const clampScale = (s: number) => Math.min(Math.max(s, MIN_SCALE), MAX_SCALE);

// Keeps `anchor` (a point in the viewport) pinned while the scale changes.
function zoomAround(view: View, s: number, anchor: Point): View {
  const k = s / view.s;
  return {
    s,
    x: anchor.x - (anchor.x - view.x) * k,
    y: anchor.y - (anchor.y - view.y) * k,
  };
}

function centeredOn(
  point: Point,
  s: number,
  width: number,
  height: number,
): View {
  return { s, x: width / 2 - point.x * s, y: height / 2 - point.y * s };
}

// Two dot layers: a minor grid that fades out as its dots crowd together when
// zoomed out, and a major grid every four cells that stays, so there is
// always a sense of scale and movement.
function gridImage(minorAlpha: number) {
  return [
    `radial-gradient(circle, color-mix(in oklch, var(--foreground) ${minorAlpha}%, transparent) 1px, transparent 1.5px)`,
    "radial-gradient(circle, color-mix(in oklch, var(--foreground) 24%, transparent) 1.25px, transparent 1.75px)",
  ].join(", ");
}

function gridState(view: View) {
  const minor = GRID * view.s;
  const major = minor * 4;
  // Fully visible from 18px spacing, gone by 8px.
  const alpha = Math.round(Math.min(Math.max((minor - 8) / 10, 0), 1) * 16);
  return {
    alpha,
    size: `${minor}px ${minor}px, ${major}px ${major}px`,
    // Offset by half a cell so dots land on world grid points, not between.
    position: `${view.x - minor / 2}px ${view.y - minor / 2}px, ${view.x - major / 2}px ${view.y - major / 2}px`,
  };
}

// No will-change here on purpose: a permanently promoted layer keeps the
// notes rasterized at their old scale, so text goes soft after zooming.
function worldTransform(view: View) {
  return `translate(${view.x}px, ${view.y}px) scale(${view.s})`;
}

// Rendered before measuring, so the server markup already shows the notes in
// place at the canvas's full size.
const DEFAULT_WIDTH = 560;
const DEFAULT_HEIGHT = 380;

type Api = {
  zoomBy: (factor: number) => void;
  fit: () => void;
  reset: () => void;
};

export function InfiniteCanvas({
  notes,
  home,
  label,
  className,
}: {
  notes: CanvasNote[];
  // The world point shown centered at 100% on load and on reset.
  home: Point;
  label: string;
  className?: string;
}) {
  const reduceMotion = useReducedMotion();
  const reduceRef = useRef(reduceMotion);
  const viewport = useRef<HTMLDivElement>(null);
  const world = useRef<HTMLDivElement>(null);
  const zoomLabel = useRef<HTMLSpanElement>(null);
  const api = useRef<Api>(null);
  const hintId = useId();

  useEffect(() => {
    reduceRef.current = reduceMotion;
  }, [reduceMotion]);

  useEffect(() => {
    const vp = viewport.current;
    const layer = world.current;
    const zoomText = zoomLabel.current;
    if (!vp || !layer || !zoomText) return;

    let width = vp.clientWidth;
    let height = vp.clientHeight;
    let view = centeredOn(home, 1, width, height);
    let gridAlpha = -1;
    let percent = -1;

    const paint = () => {
      layer.style.transform = worldTransform(view);
      const grid = gridState(view);
      // Rebuilding the gradient is the one costly write, so only when the
      // minor dots' opacity actually changes.
      if (grid.alpha !== gridAlpha) {
        vp.style.backgroundImage = gridImage(grid.alpha);
        gridAlpha = grid.alpha;
      }
      vp.style.backgroundSize = grid.size;
      vp.style.backgroundPosition = grid.position;
      const next = Math.round(view.s * 100);
      if (next !== percent) {
        zoomText.textContent = `${next}%`;
        percent = next;
      }
    };

    // Camera animations. Every one starts from the live view, so a new
    // action mid-flight redirects it instead of waiting for it to finish.
    let flight: { controls: AnimationPlaybackControls; target: View } | null =
      null;

    const stopFlight = () => {
      flight?.controls.stop();
      flight = null;
    };

    const flyTo = (target: View, anchor?: Point) => {
      stopMomentum();
      stopFlight();
      if (reduceRef.current) {
        view = target;
        paint();
        return;
      }
      const from = view;
      // Interpolate scale geometrically: 50% to 100% should feel like the
      // same step as 100% to 200%.
      const scaleAt = (p: number) => from.s * (target.s / from.s) ** p;
      const fromCenter = {
        x: (width / 2 - from.x) / from.s,
        y: (height / 2 - from.y) / from.s,
      };
      const toCenter = {
        x: (width / 2 - target.x) / target.s,
        y: (height / 2 - target.y) / target.s,
      };
      const controls = animate(0, 1, {
        ...VIEW_SPRING,
        onUpdate: (p) => {
          const s = scaleAt(p);
          // Zooms keep their anchor pinned the whole way; moves glide the
          // center point across, so the path never swings wide.
          view = anchor
            ? zoomAround(from, s, anchor)
            : centeredOn(
                {
                  x: fromCenter.x + (toCenter.x - fromCenter.x) * p,
                  y: fromCenter.y + (toCenter.y - fromCenter.y) * p,
                },
                s,
                width,
                height,
              );
          paint();
        },
        onComplete: () => {
          view = target;
          paint();
          flight = null;
        },
      });
      flight = { controls, target };
    };

    // Repeated zooms stack on where the camera is heading, so three quick
    // clicks land on three steps even while the first is still animating.
    const zoomTo = (factor: number, anchor: Point) => {
      const base = flight?.target ?? view;
      const s = clampScale(base.s * factor);
      if (s === view.s && !flight) return;
      flyTo(zoomAround(view, s, anchor), anchor);
    };

    const center = () => ({ x: width / 2, y: height / 2 });

    const fit = () => {
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      // Layout offsets ignore the world transform, so these are world units.
      for (const child of layer.children) {
        const el = child as HTMLElement;
        minX = Math.min(minX, el.offsetLeft);
        minY = Math.min(minY, el.offsetTop);
        maxX = Math.max(maxX, el.offsetLeft + el.offsetWidth);
        maxY = Math.max(maxY, el.offsetTop + el.offsetHeight);
      }
      if (minX === Infinity) return;
      // Never zooms in past 100%: fitting two notes shouldn't blow them up.
      const s = clampScale(
        Math.min(
          (width - FIT_PADDING * 2) / (maxX - minX),
          (height - FIT_PADDING * 2) / (maxY - minY),
          1,
        ),
      );
      flyTo(
        centeredOn(
          { x: (minX + maxX) / 2, y: (minY + maxY) / 2 },
          s,
          width,
          height,
        ),
      );
    };

    const reset = () => flyTo(centeredOn(home, 1, width, height));

    const panBy = (dx: number, dy: number) => {
      const base = flight?.target ?? view;
      flyTo({ ...base, x: base.x + dx, y: base.y + dy });
    };

    api.current = {
      zoomBy: (factor) => zoomTo(factor, center()),
      fit,
      reset,
    };

    // Momentum after a throw: exponential decay, the same shape as native
    // scroll deceleration, so it eases out instead of braking at the end.
    let coast = 0;
    const stopMomentum = () => {
      cancelAnimationFrame(coast);
      coast = 0;
    };
    const startMomentum = (vx: number, vy: number) => {
      let last = performance.now();
      const step = (now: number) => {
        const dt = Math.min(now - last, 32);
        last = now;
        view = { ...view, x: view.x + vx * dt, y: view.y + vy * dt };
        paint();
        const decay = FRICTION ** dt;
        vx *= decay;
        vy *= decay;
        coast = Math.hypot(vx, vy) > 0.01 ? requestAnimationFrame(step) : 0;
      };
      coast = requestAnimationFrame(step);
    };

    // Pointer tracking. Two pointers pinch; one pans.
    const pointers = new Map<number, Point>();
    let samples: { t: number; x: number; y: number }[] = [];
    let pinched = false;
    let travel = 0;
    let lastPanEnd = -Infinity;
    let origin: Point = { x: 0, y: 0 };

    const local = (e: { clientX: number; clientY: number }) => ({
      x: e.clientX - origin.x,
      y: e.clientY - origin.y,
    });

    const onPointerDown = (e: PointerEvent) => {
      if (e.pointerType === "mouse" && e.button !== 0) return;
      if ((e.target as Element).closest("[data-canvas-toolbar]")) return;
      // Grabbing the canvas catches it mid-glide, like a hand on a spinning
      // globe.
      stopMomentum();
      stopFlight();
      if (pointers.size === 0) {
        // One layout read per gesture, not per move.
        const rect = vp.getBoundingClientRect();
        origin = { x: rect.left, y: rect.top };
        pinched = false;
        travel = 0;
      }
      vp.setPointerCapture(e.pointerId);
      const p = local(e);
      pointers.set(e.pointerId, p);
      if (pointers.size > 1) pinched = true;
      samples = [{ t: e.timeStamp, ...p }];
      vp.dataset.dragging = "";
    };

    const onPointerMove = (e: PointerEvent) => {
      const prev = pointers.get(e.pointerId);
      if (!prev) return;
      const next = local(e);
      travel += Math.abs(next.x - prev.x) + Math.abs(next.y - prev.y);
      if (pointers.size === 1) {
        view = {
          ...view,
          x: view.x + next.x - prev.x,
          y: view.y + next.y - prev.y,
        };
        samples.push({ t: e.timeStamp, ...next });
        while (
          samples.length > 2 &&
          e.timeStamp - samples[0].t > VELOCITY_WINDOW
        ) {
          samples.shift();
        }
      } else {
        // Pinch against whichever other finger is down; a third is ignored.
        let other = prev;
        for (const [id, p] of pointers) {
          if (id !== e.pointerId) {
            other = p;
            break;
          }
        }
        const before = Math.hypot(prev.x - other.x, prev.y - other.y);
        const after = Math.hypot(next.x - other.x, next.y - other.y);
        const midBefore = {
          x: (prev.x + other.x) / 2,
          y: (prev.y + other.y) / 2,
        };
        const midAfter = {
          x: (next.x + other.x) / 2,
          y: (next.y + other.y) / 2,
        };
        const s = clampScale(view.s * (before > 0 ? after / before : 1));
        // Zoom around the fingers' midpoint, then follow it as it moves.
        const zoomed = zoomAround(view, s, midBefore);
        view = {
          s,
          x: zoomed.x + midAfter.x - midBefore.x,
          y: zoomed.y + midAfter.y - midBefore.y,
        };
      }
      pointers.set(e.pointerId, next);
      paint();
    };

    const onPointerEnd = (e: PointerEvent) => {
      if (!pointers.delete(e.pointerId)) return;
      if (pointers.size > 0) {
        // Lifting one finger of a pinch hands panning to the other without
        // a jump.
        const [remaining] = pointers.values();
        samples = [{ t: e.timeStamp, ...remaining }];
        return;
      }
      delete vp.dataset.dragging;
      // Slop for a trembling click, so only a real drag counts as one.
      if (travel > 4) lastPanEnd = e.timeStamp;
      if (pinched || reduceRef.current || e.type === "pointercancel") return;
      const first = samples[0];
      const last = samples[samples.length - 1];
      if (!first || !last || e.timeStamp - last.t > STALE_RELEASE) return;
      const dt = last.t - first.t;
      if (dt <= 0) return;
      const vx = (last.x - first.x) / dt;
      const vy = (last.y - first.y) / dt;
      if (Math.hypot(vx, vy) > MIN_FLICK) startMomentum(vx, vy);
    };

    // A page scroll that carries the pointer over the canvas keeps scrolling
    // the page, instead of the canvas suddenly swallowing the wheel.
    let pageScrolledAt = -Infinity;
    const onPageScroll = () => {
      pageScrolledAt = performance.now();
    };

    const onWheel = (e: WheelEvent) => {
      const zoom = e.ctrlKey || e.metaKey;
      if (!zoom && performance.now() - pageScrolledAt < PAGE_SCROLL_GRACE) {
        return;
      }
      e.preventDefault();
      stopMomentum();
      const rect = vp.getBoundingClientRect();
      const anchor = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      const unit = e.deltaMode === 1 ? LINE_HEIGHT : 1;
      let dx = e.deltaX * unit;
      let dy = e.deltaY * unit;
      // A mouse wheel moves in whole notches on one axis; a trackpad scrolls
      // in small, often fractional steps on both. Notches are big jumps, so
      // they animate; trackpad deltas apply directly for 1:1 tracking.
      const notch =
        e.deltaMode === 1 ||
        (dx === 0 && Math.abs(dy) >= 40 && Number.isInteger(dy));
      if (zoom) {
        // Browsers report a trackpad pinch as ctrl + wheel, so ctrl or cmd
        // with any wheel always zooms.
        if (notch) {
          zoomTo(Math.exp(-dy * WHEEL_SPEED), anchor);
          return;
        }
        stopFlight();
        view = zoomAround(
          view,
          clampScale(view.s * Math.exp(-dy * PINCH_SPEED)),
          anchor,
        );
        paint();
        return;
      }
      // Shift + wheel pans sideways, as it scrolls sideways on a page.
      if (e.shiftKey && dx === 0) [dx, dy] = [dy, 0];
      if (notch) {
        panBy(-dx, -dy);
        return;
      }
      stopFlight();
      view = { ...view, x: view.x - dx, y: view.y - dy };
      paint();
    };

    const onDoubleClick = (e: MouseEvent) => {
      if ((e.target as Element).closest("[data-canvas-toolbar]")) return;
      // A drag followed by a quick click also fires dblclick; that was
      // panning, not a request to zoom.
      if (e.timeStamp - lastPanEnd < 400) return;
      const rect = vp.getBoundingClientRect();
      zoomTo(e.shiftKey ? 0.5 : 2, {
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
      });
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.target !== vp || e.metaKey || e.ctrlKey || e.altKey) return;
      const pan = e.shiftKey ? KEY_PAN * 3 : KEY_PAN;
      const actions: Record<string, () => void> = {
        ArrowLeft: () => panBy(pan, 0),
        ArrowRight: () => panBy(-pan, 0),
        ArrowUp: () => panBy(0, pan),
        ArrowDown: () => panBy(0, -pan),
        "+": () => zoomTo(BUTTON_ZOOM, center()),
        "=": () => zoomTo(BUTTON_ZOOM, center()),
        "-": () => zoomTo(1 / BUTTON_ZOOM, center()),
        _: () => zoomTo(1 / BUTTON_ZOOM, center()),
        "0": reset,
      };
      const action = actions[e.key];
      if (!action) return;
      e.preventDefault();
      action();
    };

    // Keeps the same world point centered when the canvas resizes.
    const resize = new ResizeObserver(() => {
      const w = vp.clientWidth;
      const h = vp.clientHeight;
      if (w === width && h === height) return;
      view = {
        ...view,
        x: view.x + (w - width) / 2,
        y: view.y + (h - height) / 2,
      };
      width = w;
      height = h;
      paint();
    });

    paint();
    resize.observe(vp);
    vp.addEventListener("pointerdown", onPointerDown);
    vp.addEventListener("pointermove", onPointerMove);
    vp.addEventListener("pointerup", onPointerEnd);
    vp.addEventListener("pointercancel", onPointerEnd);
    vp.addEventListener("wheel", onWheel, { passive: false });
    vp.addEventListener("dblclick", onDoubleClick);
    vp.addEventListener("keydown", onKeyDown);
    window.addEventListener("scroll", onPageScroll, { passive: true, capture: true });
    return () => {
      window.removeEventListener("scroll", onPageScroll, { capture: true });
      resize.disconnect();
      stopMomentum();
      stopFlight();
      api.current = null;
      vp.removeEventListener("pointerdown", onPointerDown);
      vp.removeEventListener("pointermove", onPointerMove);
      vp.removeEventListener("pointerup", onPointerEnd);
      vp.removeEventListener("pointercancel", onPointerEnd);
      vp.removeEventListener("wheel", onWheel);
      vp.removeEventListener("dblclick", onDoubleClick);
      vp.removeEventListener("keydown", onKeyDown);
    };
  }, [home]);

  const initial = centeredOn(home, 1, DEFAULT_WIDTH, DEFAULT_HEIGHT);
  const initialGrid = gridState(initial);

  const toolButton =
    "flex h-9 touch-manipulation items-center justify-center rounded-full text-sm font-medium text-foreground outline-hidden transition-[scale,background-color] duration-150 ease-out select-none hover:bg-surface focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-foreground active:scale-[0.96] motion-reduce:transition-[background-color]";

  return (
    <div
      ref={viewport}
      role="region"
      aria-roledescription="canvas"
      aria-label={label}
      aria-describedby={hintId}
      tabIndex={0}
      className={cn(
        "relative isolate h-[380px] w-[min(560px,100%)] cursor-grab touch-none overflow-clip rounded-3xl bg-surface shadow-wheel outline-hidden select-none focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-foreground data-dragging:cursor-grabbing",
        className,
      )}
      style={{
        backgroundImage: gridImage(initialGrid.alpha),
        backgroundSize: initialGrid.size,
        backgroundPosition: initialGrid.position,
      }}
    >
      <div
        ref={world}
        className="absolute top-0 left-0 origin-top-left"
        style={{ transform: worldTransform(initial) }}
      >
        {notes.map((note) => (
          <div
            key={note.id}
            className={cn(
              "absolute flex w-44 flex-col gap-1.5 rounded-xl p-4 shadow-raised",
              note.accent
                ? "bg-foreground text-background"
                : "bg-background text-foreground",
            )}
            style={{
              left: note.x,
              top: note.y,
              rotate: `${note.rotate ?? 0}deg`,
            }}
          >
            <span className="text-sm font-semibold tracking-tight">
              {note.title}
            </span>
            <p
              className={cn(
                "text-sm leading-snug text-pretty",
                note.accent ? "opacity-70" : "text-muted",
              )}
            >
              {note.text}
            </p>
          </div>
        ))}
      </div>

      {/* Centered on the toolbar's midline: 12px inset + half of 44px, less
          half of the 16px line. */}
      <p
        id={hintId}
        className="pointer-events-none absolute bottom-[26px] left-4 text-xs text-muted max-sm:sr-only"
      >
        Drag or scroll to pan, pinch to zoom
        <span className="sr-only">
          . Ctrl and scroll also zooms. Arrow keys pan, plus and minus zoom, 0 resets.
        </span>
      </p>

      <div
        data-canvas-toolbar
        className="absolute right-3 bottom-3 flex h-11 cursor-default items-center gap-0.5 rounded-full bg-background p-1 shadow-raised"
      >
        <button
          type="button"
          aria-label="Zoom out"
          onClick={() => api.current?.zoomBy(1 / BUTTON_ZOOM)}
          className={cn(toolButton, "w-9")}
        >
          <ToolIcon d="M5 12h14" />
        </button>
        <button
          type="button"
          aria-label="Reset zoom"
          onClick={() => api.current?.reset()}
          className={cn(toolButton, "w-14 tabular-nums")}
        >
          <span ref={zoomLabel}>100%</span>
        </button>
        <button
          type="button"
          aria-label="Zoom in"
          onClick={() => api.current?.zoomBy(BUTTON_ZOOM)}
          className={cn(toolButton, "w-9")}
        >
          <ToolIcon d="M5 12h14M12 5v14" />
        </button>
        <span aria-hidden className="mx-1 h-5 w-px bg-border" />
        <button
          type="button"
          onClick={() => api.current?.fit()}
          className={cn(toolButton, "px-3.5")}
        >
          Fit
        </button>
      </div>
    </div>
  );
}

function ToolIcon({ d }: { d: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className="size-[18px]"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      aria-hidden
    >
      <path d={d} />
    </svg>
  );
}

const NOTES: CanvasNote[] = [
  {
    id: "launch",
    x: -240,
    y: -150,
    rotate: -1.5,
    title: "Launch checklist",
    text: "Pricing page, changelog, and the email to the waitlist.",
  },
  {
    id: "question",
    x: -30,
    y: -170,
    rotate: 1,
    title: "Open question",
    text: "Ship dark mode first, or keyboard shortcuts?",
  },
  {
    id: "idea",
    x: 80,
    y: -20,
    rotate: -1,
    title: "Idea",
    text: "Let people pin their favourite components to the top.",
  },
  {
    id: "done",
    x: -210,
    y: 10,
    rotate: 1.5,
    accent: true,
    title: "Done this week",
    text: "Spring presets and the new docs sidebar.",
  },
  {
    id: "far",
    x: 440,
    y: 260,
    rotate: -1,
    title: "You found it",
    text: "Press 0 to head home, or Fit to see everything.",
  },
];

// Centered on the four nearby notes; the fifth waits off to the side.
const HOME = { x: 8, y: -25 };

export default function InfiniteCanvasDemo() {
  return <InfiniteCanvas notes={NOTES} home={HOME} label="Planning board" />;
}
