import { useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
import { flushSync } from "react-dom";
import { useReducedMotion } from "@/lib/use-reduced-motion";
import { cn } from "@/lib/cn";

// The scene is drawn in a fixed 400 x 360 space, centred and cropped on
// narrow screens, so pointer math never has to scale.
const W = 400;
const H = 360;
const LAMP_X = 200;
// Where the chain leaves the switch in the socket, just beside the bulb.
const ANCHOR_X = 228;
const ANCHOR_Y = 154;
const POINTS = 8;
const SEG = 12;
const CHAIN = SEG * (POINTS - 1);
// How far the switch's plunger can be drawn down, and where it clicks.
// Clicking before the end of travel is what makes a real pull switch feel
// like it gave way under your hand.
const TRAVEL = 18;
const CLICK = 12;
// The plunger must come most of the way home before it can click again.
const REARM = 4;
const GRAVITY = 1800;
// Velocity kept per substep: a hard swing looks settled in about two seconds.
const DRAG = 0.986;
const PLUNGER_K = 900;
const PLUNGER_D = 48;
const SUBSTEP = 1 / 120;
// A tap or key press pulls this far past slack: past CLICK, short of TRAVEL.
const TAP_PULL = CLICK + 4;
const TAP_DOWN = 0.12;
const TAP_HOLD = 0.05;
// Hit area for the knob, centred on it.
const HIT = 44;
// Two sub-100ms flickers before the light holds, like a filament catching.
// The theme waits this long so the room lights only once the bulb has.
export const FLICKER_MS = 200;
const FLICKER: Keyframe[] = [
  { opacity: 0, offset: 0 },
  { opacity: 0.9, offset: 0.08 },
  { opacity: 0.1, offset: 0.3 },
  { opacity: 1, offset: 0.42 },
  { opacity: 0.2, offset: 0.62 },
  { opacity: 1, offset: 0.78 },
  { opacity: 1, offset: 1 },
];

// The lamp is a physical object and keeps its materials in both themes:
// green enamel shade, braided flex, nickel chain, and warm incandescent
// light, which is a colour of light rather than a theme colour.
const ENAMEL = "oklch(0.34 0.06 165)";
const ENAMEL_LIT = "oklch(0.46 0.07 165)";
const FLEX = "oklch(0.35 0.01 60)";
const NICKEL = "oklch(0.64 0.01 80)";
const WARM = "oklch(0.93 0.1 85)";

// Where the bulb sits on screen at the moment of the pull, in viewport px.
export type BulbOrigin = { x: number; y: number; r: number };

type Sim = {
  x: Float64Array;
  y: Float64Array;
  px: Float64Array;
  py: Float64Array;
  plunger: number;
  plungerV: number;
  clicked: boolean;
};

type Hold =
  | {
      kind: "pointer";
      id: number;
      offX: number;
      offY: number;
      tx: number;
      ty: number;
      downX: number;
      downY: number;
      moved: boolean;
      at: number;
    }
  | { kind: "tap"; t: number; fromX: number; fromY: number };

function restSim(): Sim {
  const x = new Float64Array(POINTS).fill(ANCHOR_X);
  const y = Float64Array.from({ length: POINTS }, (_, i) => ANCHOR_Y + i * SEG);
  return { x, y, px: x.slice(), py: y.slice(), plunger: 0, plungerV: 0, clicked: false };
}

function chainPath(s: Sim) {
  let d = `M${s.x[0].toFixed(2)} ${s.y[0].toFixed(2)}`;
  for (let i = 1; i < POINTS; i++) d += `L${s.x[i].toFixed(2)} ${s.y[i].toFixed(2)}`;
  return d;
}

function knobTransform(s: Sim) {
  const i = POINTS - 1;
  const angle = (Math.atan2(s.x[i - 1] - s.x[i], s.y[i] - s.y[i - 1]) * 180) / Math.PI;
  return `translate(${s.x[i] - HIT / 2}px, ${s.y[i] - 4}px) rotate(${angle}deg)`;
}

const INITIAL = restSim();
const INITIAL_PATH = chainPath(INITIAL);
const INITIAL_KNOB = knobTransform(INITIAL);

export function PullCordSwitch({
  checked,
  onCheckedChange,
  label,
  className,
}: {
  checked: boolean;
  onCheckedChange: (checked: boolean, bulb: BulbOrigin) => void;
  label: string;
  className?: string;
}) {
  const id = useId();
  const reduceMotion = useReducedMotion();
  const sceneRef = useRef<HTMLDivElement>(null);
  const chainRef = useRef<SVGPathElement>(null);
  const plungerRef = useRef<SVGLineElement>(null);
  const knobRef = useRef<HTMLButtonElement>(null);
  const glowRef = useRef<SVGGElement>(null);
  const filamentRef = useRef<SVGCircleElement>(null);

  const sim = useRef<Sim>(restSim());
  const hold = useRef<Hold | null>(null);
  const frame = useRef(0);
  const last = useRef(0);
  const carry = useRef(0);

  // The loop outlives renders, so it reads the latest props through refs.
  const checkedRef = useRef(checked);
  const onChangeRef = useRef(onCheckedChange);
  const reduceRef = useRef(reduceMotion);
  useEffect(() => {
    checkedRef.current = checked;
    onChangeRef.current = onCheckedChange;
    reduceRef.current = reduceMotion;
  });

  useEffect(() => () => cancelAnimationFrame(frame.current), []);

  const toggle = () => {
    const next = !checkedRef.current;
    checkedRef.current = next;
    if (next && !reduceRef.current) {
      glowRef.current?.animate(FLICKER, { duration: FLICKER_MS, easing: "linear" });
      filamentRef.current?.animate(FLICKER, { duration: FLICKER_MS, easing: "linear" });
    }
    const box = filamentRef.current!.getBoundingClientRect();
    onChangeRef.current(next, { x: box.x + box.width / 2, y: box.y + box.height / 2, r: box.width / 2 });
  };

  const paint = () => {
    const s = sim.current;
    chainRef.current?.setAttribute("d", chainPath(s));
    plungerRef.current?.setAttribute("y2", String(ANCHOR_Y + s.plunger));
    if (knobRef.current) knobRef.current.style.transform = knobTransform(s);
  };

  const target = (h: Hold, dt: number): [number, number] => {
    if (h.kind === "pointer") return [h.tx, h.ty];
    h.t += dt;
    const k = Math.min(h.t / TAP_DOWN, 1);
    // Ease out, like a hand that yanks and then stops.
    const e = 1 - (1 - k) ** 3;
    const toY = ANCHOR_Y + CHAIN + TAP_PULL;
    return [h.fromX + (ANCHOR_X - h.fromX) * e, h.fromY + (toY - h.fromY) * e];
  };

  const step = (dt: number) => {
    const s = sim.current;
    const h = hold.current;
    let pinned: [number, number] | null = null;

    if (h) {
      let [tx, ty] = target(h, dt);
      const dx = tx - ANCHOR_X;
      const dy = ty - ANCHOR_Y;
      const dist = Math.hypot(dx, dy);
      // The chain can't stretch, so pulling past slack draws the plunger
      // out instead, up to the end of its travel.
      if (dist > CHAIN + TRAVEL) {
        tx = ANCHOR_X + (dx / dist) * (CHAIN + TRAVEL);
        ty = ANCHOR_Y + (dy / dist) * (CHAIN + TRAVEL);
      }
      const pull = Math.max(0, Math.min(dist - CHAIN, TRAVEL));
      if (pull > s.plunger) {
        s.plunger = pull;
        s.plungerV = 0;
      }
      pinned = [tx, ty];
      if (h.kind === "tap" && h.t >= TAP_DOWN + TAP_HOLD) hold.current = null;
    }

    // The plunger's return spring; while held it can still ease back.
    s.plungerV += (-PLUNGER_K * s.plunger - PLUNGER_D * s.plungerV) * dt;
    s.plunger = Math.max(0, s.plunger + s.plungerV * dt);

    if (!s.clicked && s.plunger >= CLICK) {
      s.clicked = true;
      toggle();
    } else if (s.clicked && s.plunger < REARM) {
      s.clicked = false;
    }

    s.x[0] = ANCHOR_X;
    s.y[0] = ANCHOR_Y + s.plunger;
    for (let i = 1; i < POINTS; i++) {
      const vx = (s.x[i] - s.px[i]) * DRAG;
      const vy = (s.y[i] - s.py[i]) * DRAG;
      s.px[i] = s.x[i];
      s.py[i] = s.y[i];
      s.x[i] += vx;
      s.y[i] += vy + GRAVITY * dt * dt;
    }
    const end = POINTS - 1;
    if (pinned) {
      s.x[end] = pinned[0];
      s.y[end] = pinned[1];
    }

    // Rope constraints: links can go slack but never stretch, like ball chain.
    for (let iter = 0; iter < 12; iter++) {
      for (let i = 0; i < end; i++) {
        const dx = s.x[i + 1] - s.x[i];
        const dy = s.y[i + 1] - s.y[i];
        const d = Math.hypot(dx, dy);
        if (d <= SEG || d === 0) continue;
        const wa = i === 0 ? 0 : 1;
        const wb = pinned && i + 1 === end ? 0 : 1;
        if (wa + wb === 0) continue;
        const f = (d - SEG) / d / (wa + wb);
        s.x[i] += dx * f * wa;
        s.y[i] += dy * f * wa;
        s.x[i + 1] -= dx * f * wb;
        s.y[i + 1] -= dy * f * wb;
      }
    }
  };

  const atRest = () => {
    const s = sim.current;
    if (hold.current || s.plunger > 0.05 || Math.abs(s.plungerV) > 0.05) return false;
    // A swing is momentarily still at each extreme, so it must also hang
    // plumb before the loop can sleep.
    if (Math.abs(s.x[POINTS - 1] - ANCHOR_X) > 0.3) return false;
    for (let i = 1; i < POINTS; i++) {
      if (Math.abs(s.x[i] - s.px[i]) > 0.02 || Math.abs(s.y[i] - s.py[i]) > 0.02) return false;
    }
    return true;
  };

  const tick = (now: number) => {
    // Capped so a backgrounded tab doesn't come back to a huge time step.
    const elapsed = Math.min((now - last.current) / 1000, 1 / 20);
    last.current = now;
    carry.current += elapsed;
    while (carry.current >= SUBSTEP) {
      step(SUBSTEP);
      carry.current -= SUBSTEP;
    }
    paint();
    if (atRest()) {
      frame.current = 0;
      return;
    }
    frame.current = requestAnimationFrame(tick);
  };

  // Sleeps at rest; anything that disturbs the chain wakes it.
  const wake = () => {
    if (frame.current) return;
    last.current = performance.now();
    carry.current = 0;
    frame.current = requestAnimationFrame(tick);
  };

  const pullOnce = () => {
    if (reduceRef.current) {
      toggle();
      return;
    }
    const s = sim.current;
    hold.current = { kind: "tap", t: 0, fromX: s.x[POINTS - 1], fromY: s.y[POINTS - 1] };
    wake();
  };

  const local = (e: React.PointerEvent) => {
    const box = sceneRef.current!.getBoundingClientRect();
    return [e.clientX - box.left, e.clientY - box.top] as const;
  };

  const onPointerDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (e.button !== 0 || hold.current?.kind === "pointer") return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const [x, y] = local(e);
    const s = sim.current;
    const end = POINTS - 1;
    hold.current = {
      kind: "pointer",
      id: e.pointerId,
      offX: x - s.x[end],
      offY: y - s.y[end],
      tx: s.x[end],
      ty: s.y[end],
      downX: x,
      downY: y,
      moved: false,
      at: performance.now(),
    };
    wake();
  };

  const onPointerMove = (e: React.PointerEvent<HTMLButtonElement>) => {
    const h = hold.current;
    if (h?.kind !== "pointer" || e.pointerId !== h.id) return;
    const [x, y] = local(e);
    const tx = x - h.offX;
    const ty = y - h.offY;
    // Past a few px it's a drag; below that, a tap that pulls for you.
    if (!h.moved) h.moved = Math.hypot(x - h.downX, y - h.downY) > 4;
    h.tx = tx;
    h.ty = ty;
    wake();
  };

  const onPointerEnd = (e: React.PointerEvent<HTMLButtonElement>) => {
    const h = hold.current;
    if (h?.kind !== "pointer" || e.pointerId !== h.id) return;
    hold.current = null;
    // Letting go leaves the chain its own velocity, so it swings on from
    // wherever the hand left it.
    if (e.type === "pointerup" && !h.moved && performance.now() - h.at < 400) pullOnce();
    else if (reduceRef.current) {
      sim.current = restSim();
      paint();
    } else wake();
  };

  return (
    <div className={cn("flex w-[400px] max-w-full flex-col gap-4", className)}>
      <div
        className="relative h-[360px] w-full overflow-hidden rounded-3xl bg-surface shadow-raised [--glow:var(--background)] [--glow-strength:1] dark:[--glow:var(--foreground)] dark:[--glow-strength:0.14]"
      >
        {/* The room dims with the lamp off. Switching off fades slower, the
            way a filament cools rather than cutting out. */}
        <div
          aria-hidden
          className={cn(
            "absolute inset-0 bg-foreground/[0.07] transition-opacity ease-out dark:bg-background/55",
            checked ? "opacity-0 duration-150" : "opacity-100 duration-[350ms]",
          )}
        />
        <div ref={sceneRef} className="absolute top-0 left-1/2 h-full -translate-x-1/2" style={{ width: W }}>
          <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} className="absolute inset-0" aria-hidden>
            <defs>
              <linearGradient id={`${id}-cone`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" style={{ stopColor: "var(--glow)", stopOpacity: "calc(var(--glow-strength) * 0.9)" }} />
                <stop offset="1" style={{ stopColor: "var(--glow)", stopOpacity: 0 }} />
              </linearGradient>
              <radialGradient id={`${id}-pool`}>
                <stop offset="0" style={{ stopColor: "var(--glow)", stopOpacity: "var(--glow-strength)" }} />
                <stop offset="1" style={{ stopColor: "var(--glow)", stopOpacity: 0 }} />
              </radialGradient>
              <radialGradient id={`${id}-halo`}>
                <stop offset="0.3" stopColor={WARM} stopOpacity={0.85} />
                <stop offset="1" stopColor={WARM} stopOpacity={0} />
              </radialGradient>
              {/* Enamelled steel, lit from above. */}
              <linearGradient id={`${id}-shade`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor={ENAMEL_LIT} />
                <stop offset="1" stopColor={ENAMEL} />
              </linearGradient>
              <linearGradient id={`${id}-brass`} x1="0" y1="0" x2="1" y2="0">
                <stop offset="0" stopColor="oklch(0.62 0.09 75)" />
                <stop offset="0.45" stopColor="oklch(0.86 0.1 85)" />
                <stop offset="1" stopColor="oklch(0.58 0.09 70)" />
              </linearGradient>
            </defs>

            <g
              ref={glowRef}
              className={cn(
                "transition-opacity ease-out",
                checked ? "opacity-100 duration-150" : "opacity-0 duration-[350ms]",
              )}
            >
              <path d={`M132 152L272 152L${W} ${H}L0 ${H}Z`} fill={`url(#${id}-cone)`} />
              <ellipse cx={LAMP_X} cy={H - 14} rx={170} ry={26} fill={`url(#${id}-pool)`} />
              <circle cx={LAMP_X} cy={160} r={46} fill={`url(#${id}-halo)`} />
            </g>

            {/* A ceiling rose, and the braided flex down to a brass cap. */}
            <ellipse cx={LAMP_X} cy={0} rx={20} ry={7} fill={`url(#${id}-shade)`} />
            <line x1={LAMP_X} y1={4} x2={LAMP_X} y2={90} strokeWidth={2} stroke={FLEX} />
            <rect x={LAMP_X - 8} y={84} width={16} height={18} rx={3} fill={`url(#${id}-brass)`} />

            {/* The bulb hangs just below the rim: clear glass when off. */}
            <circle
              cx={LAMP_X}
              cy={160}
              r={15}
              // Unlit glass reads paler than the room: dimmer in the dark.
              style={{ fill: "light-dark(oklch(0.95 0.01 85 / 0.85), oklch(0.62 0.01 85))" }}
              stroke="oklch(0 0 0 / 0.18)"
            />
            {/* The lit filament is its own layer so it can flicker on with the glow. */}
            <circle
              ref={filamentRef}
              cx={LAMP_X}
              cy={160}
              r={15.5}
              fill={WARM}
              className={cn(
                "transition-opacity ease-out",
                checked ? "opacity-100 duration-150" : "opacity-0 duration-[350ms]",
              )}
            />

            <path d="M128 152C128 119 158 98 200 98C242 98 272 119 272 152Z" fill={`url(#${id}-shade)`} />
            {/* A highlight along the crown, and the rolled rim, whose white
                enamel inside glows when the bulb is lit. */}
            <path d="M146 128C156 112 176 104 200 103" fill="none" stroke="oklch(1 0 0 / 0.28)" strokeWidth={2} strokeLinecap="round" />
            <rect x={126} y={149} width={148} height={5} rx={2.5} fill={ENAMEL} />
            <rect
              x={130}
              y={151.5}
              width={140}
              height={2}
              rx={1}
              fill={WARM}
              className={cn(
                "transition-opacity ease-out",
                checked ? "opacity-100 duration-150" : "opacity-0 duration-[350ms]",
              )}
            />

            {/* The plunger rod that the chain draws out of the socket. */}
            <line
              ref={plungerRef}
              x1={ANCHOR_X}
              y1={ANCHOR_Y - 4}
              x2={ANCHOR_X}
              y2={ANCHOR_Y}
              strokeWidth={2.5}
              strokeLinecap="round"
              stroke={NICKEL}
            />
            {/* Zero-length dashes with round caps draw a ball chain. */}
            <path
              ref={chainRef}
              d={INITIAL_PATH}
              fill="none"
              strokeWidth={3.5}
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeDasharray="0 4.5"
              stroke={NICKEL}
            />
          </svg>

          <button
            ref={knobRef}
            type="button"
            role="switch"
            aria-checked={checked}
            aria-label={label}
            className="absolute top-0 left-0 flex cursor-grab touch-none justify-center rounded-full outline-hidden select-none focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-foreground active:cursor-grabbing"
            style={{ width: HIT, height: HIT, transform: INITIAL_KNOB, transformOrigin: `${HIT / 2}px 4px` }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerEnd}
            onPointerCancel={onPointerEnd}
            onClick={(e) => {
              // Pointer taps are handled on pointerup; detail 0 means the
              // click came from Space or Enter.
              if (e.detail === 0) pullOnce();
            }}
          >
            {/* A turned brass pull, heavier at the bottom like a plumb bob. */}
            <span
              className="mt-1 h-[26px] w-4 rounded-t-[6px] rounded-b-full shadow-[0_2px_4px_oklch(0_0_0/0.3),inset_0_-2px_3px_oklch(0_0_0/0.2)]"
              style={{
                background:
                  "linear-gradient(90deg, oklch(0.6 0.09 72), oklch(0.88 0.1 86) 45%, oklch(0.56 0.09 68))",
              }}
            />
          </button>
        </div>
      </div>

      <div className="flex items-center justify-between px-1 text-sm">
        <span className="text-muted">Pull the chain</span>
        <span className="grid font-medium">
          <State visible={checked}>On</State>
          <State visible={!checked}>Off</State>
        </span>
      </div>
    </div>
  );
}

// Both labels share a grid cell so the row never changes width.
function State({ visible, children }: { visible: boolean; children: React.ReactNode }) {
  return (
    <span
      aria-hidden
      className={cn(
        "col-start-1 row-start-1 text-right transition-[opacity,filter] duration-200 ease-out",
        !visible && "opacity-0 blur-[4px]",
      )}
    >
      {children}
    </span>
  );
}

// Site theme: the same key, attribute and "system when nothing is saved"
// rule as the header toggle, duplicated so the two stay independent but in sync.
type Theme = "light" | "dark";
const DARK_QUERY = "(prefers-color-scheme: dark)";
// Strong ease-out: the light arrives fast and settles.
const EASE_OUT = "cubic-bezier(0.23, 1, 0.32, 1)";
// Longer than UI motion on purpose: switching the whole site is a rare,
// deliberate act, and the cone has the entire viewport to sweep.
const POUR_MS = 550;
// Going dark is quicker, the way a room loses light faster than it gains it.
const DRAW_MS = 400;
// Keyframes are evenly spaced in cone angle; the easing is applied over the
// whole run, so more frames only make the polygon's arc smoother.
const CONE_FRAMES = 32;
const CONE_RAYS = 8;
// Starting half-angle of the beam, in radians (about 6 degrees).
const CONE_START = 0.1;

function subscribeTheme(onChange: () => void) {
  const media = matchMedia(DARK_QUERY);
  const observer = new MutationObserver(onChange);
  media.addEventListener("change", onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  return () => {
    media.removeEventListener("change", onChange);
    observer.disconnect();
  };
}

function getTheme(): Theme {
  const stored = document.documentElement.dataset.theme;
  if (stored === "light" || stored === "dark") return stored;
  return matchMedia(DARK_QUERY).matches ? "dark" : "light";
}

function applyTheme(theme: Theme) {
  // Same as the toggle: stop every color transition firing during the swap.
  const pause = document.createElement("style");
  pause.textContent = "*,*::before,*::after{transition:none!important}";
  document.head.append(pause);
  document.documentElement.dataset.theme = theme;
  try {
    localStorage.setItem("theme", theme);
  } catch {}
  void document.body.offsetHeight;
  requestAnimationFrame(() => pause.remove());
}

// A beam from the bulb whose edges swing outward from straight down until
// they meet straight up, so the last frame is a full disc over the viewport.
function coneFrames({ x, y, r }: BulbOrigin) {
  // 25% past the farthest corner so the chords between rays still clear it.
  const reach = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y)) * 1.25;
  const frames: string[] = [];
  for (let f = 0; f <= CONE_FRAMES; f++) {
    const p = f / CONE_FRAMES;
    // Closes a little early so the ease-out tail isn't spent on a sliver
    // of old theme above the lamp.
    const k = Math.min(1, p / 0.9);
    const spread = CONE_START + (Math.PI - CONE_START) * k;
    // The beam reaches the floor in the first third, then only widens.
    const len = reach * Math.min(1, 0.1 + p * 2.7);
    // The beam leaves the bulb's full width but narrows to a point by the
    // end, or the two edges meeting overhead would leave a gap between them.
    const lip = r * (1 - k);
    const pts = [`${x - lip}px ${y}px`, `${x + lip}px ${y}px`];
    for (let i = 0; i <= CONE_RAYS; i++) {
      const a = spread - (2 * spread * i) / CONE_RAYS;
      pts.push(`${(x + len * Math.sin(a)).toFixed(1)}px ${(y + len * Math.cos(a)).toFixed(1)}px`);
    }
    frames.push(`polygon(${pts.join(",")})`);
  }
  return frames;
}

function pourTheme(theme: Theme, bulb: BulbOrigin, update: () => void) {
  const on = theme === "light";
  // Going dark, the old light page is the one being drawn in, so it must
  // sit above the new one for the length of the transition.
  let order: HTMLStyleElement | null = null;
  if (!on) {
    order = document.createElement("style");
    order.textContent =
      "::view-transition-old(root){z-index:1}::view-transition-new(root){z-index:0}";
    document.head.append(order);
  }
  const transition = document.startViewTransition(() => {
    applyTheme(theme);
    update();
  });
  transition.ready
    .then(() => {
      const frames = coneFrames(bulb);
      document.documentElement.animate(
        { clipPath: on ? frames : frames.reverse() },
        {
          duration: on ? POUR_MS : DRAW_MS,
          easing: EASE_OUT,
          fill: "forwards",
          pseudoElement: on ? "::view-transition-new(root)" : "::view-transition-old(root)",
        },
      );
    })
    .catch(() => {});
  return transition.finished.finally(() => order?.remove());
}

export default function PullCordSwitchDemo() {
  // Reading only: nothing here writes the theme until someone pulls.
  const theme = useSyncExternalStore(subscribeTheme, getTheme, (): Theme => "light");
  // The lamp runs ahead of the theme while the bulb flickers and the cone pours.
  const [lamp, setLamp] = useState<boolean | null>(null);
  const timer = useRef(0);
  const run = useRef(0);
  useEffect(() => () => clearTimeout(timer.current), []);

  const pull = (on: boolean, bulb: BulbOrigin) => {
    clearTimeout(timer.current);
    const id = ++run.current;
    const target: Theme = on ? "light" : "dark";
    if (!document.startViewTransition || matchMedia("(prefers-reduced-motion: reduce)").matches) {
      applyTheme(target);
      setLamp(null);
      return;
    }
    // Pulled back off during the flicker, before the theme ever changed.
    if (getTheme() === target) {
      setLamp(null);
      return;
    }
    setLamp(on);
    const go = () =>
      pourTheme(target, bulb, () => flushSync(() => setLamp(on))).then(() => {
        if (run.current === id) setLamp(null);
      });
    if (on) timer.current = window.setTimeout(go, FLICKER_MS);
    else go();
  };

  return <PullCordSwitch label="Lights" checked={lamp ?? theme === "light"} onCheckedChange={pull} />;
}
