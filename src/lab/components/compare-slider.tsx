import { useEffect, useRef, type ReactNode } from "react";
import { animate, useMotionValue } from "motion/react";
import { useReducedMotion } from "@/lib/use-reduced-motion";
import { cn } from "@/lib/cn";

// A click glides rather than teleports, so you see which way the divider
// went; short enough that it never feels like waiting.
const GLIDE_MS = 200;
const EASE_OUT = [0.23, 1, 0.32, 1] as const;
const STEP = 0.05;
// Horizontal travel before a touch counts as a drag; anything less stays a
// tap, and vertical movement is left to the page via pan-y.
const SLOP = 4;
// Tags sit in the outer ~20% of the frame. They start fading at 35% visible
// and are gone by 20%, before the divider can reach them.
const TAG_FADE_START = 0.35;
const TAG_FADE_END = 0.2;

const clamp = (v: number) => Math.min(Math.max(v, 0), 1);
const tagOpacity = (visible: number) =>
  clamp((visible - TAG_FADE_END) / (TAG_FADE_START - TAG_FADE_END));
const percent = (v: number) => Math.round(v * 100);
const valueText = (v: number) =>
  `${percent(v)}% before, ${100 - percent(v)}% after`;

type Drag = {
  id: number;
  startX: number;
  // Where on the handle it was grabbed, so the handle doesn't jump to
  // center itself under the pointer.
  offset: number;
  rect: DOMRect;
  active: boolean;
};

export function CompareSlider({
  before,
  after,
  initial = 0.5,
  label = "Comparison position",
  className,
}: {
  before: ReactNode;
  after: ReactNode;
  initial?: number;
  label?: string;
  className?: string;
}) {
  const reduceMotion = useReducedMotion();
  const pos = useMotionValue(initial);
  const target = useRef(initial);
  const glideEnd = useRef(0);
  const drag = useRef<Drag | null>(null);

  const rootRef = useRef<HTMLDivElement>(null);
  const afterRef = useRef<HTMLDivElement>(null);
  const dividerRef = useRef<HTMLDivElement>(null);
  const handleRef = useRef<HTMLDivElement>(null);
  const beforeTagRef = useRef<HTMLSpanElement>(null);
  const afterTagRef = useRef<HTMLSpanElement>(null);

  // Writes straight to the DOM so dragging never re-renders React.
  useEffect(
    () =>
      pos.on("change", (v) => {
        afterRef.current?.style.setProperty(
          "clip-path",
          `inset(0 0 0 ${v * 100}%)`,
        );
        dividerRef.current?.style.setProperty(
          "transform",
          `translateX(${v * 100}%)`,
        );
        beforeTagRef.current?.style.setProperty("opacity", `${tagOpacity(v)}`);
        afterTagRef.current?.style.setProperty(
          "opacity",
          `${tagOpacity(1 - v)}`,
        );
        handleRef.current?.setAttribute("aria-valuenow", `${percent(v)}`);
        handleRef.current?.setAttribute("aria-valuetext", valueText(v));
      }),
    [pos],
  );

  const moveTo = (next: number, glide: boolean) => {
    target.current = next;
    if (reduceMotion) return pos.jump(next);
    const now = performance.now();
    if (glide) {
      glideEnd.current = now + GLIDE_MS;
      animate(pos, next, { duration: GLIDE_MS / 1000, ease: EASE_OUT });
      return;
    }
    // Dragging during a glide retargets it to land on the pointer when the
    // glide would have ended, instead of snapping mid-flight. One frame or
    // less left is not worth animating.
    const remaining = glideEnd.current - now;
    if (remaining > 16) {
      animate(pos, next, { duration: remaining / 1000, ease: EASE_OUT });
    } else {
      pos.jump(next);
    }
  };

  const at = (clientX: number, d: Drag) =>
    clamp((clientX - d.offset - d.rect.left) / d.rect.width);

  const start = (d: Drag) => {
    d.active = true;
    rootRef.current?.setAttribute("data-dragging", "");
  };

  const end = () => {
    drag.current = null;
    rootRef.current?.removeAttribute("data-dragging");
  };

  const tag =
    "pointer-events-none absolute top-4 rounded-full bg-background px-3 py-1 text-[13px] font-medium text-muted shadow-raised";

  return (
    <div
      ref={rootRef}
      className={cn(
        "group relative h-[320px] w-[520px] max-w-full cursor-ew-resize touch-pan-y overflow-hidden rounded-3xl bg-surface select-none",
        className,
      )}
      onPointerDown={(e) => {
        // Ignore a second finger while one is already dragging.
        if (e.button !== 0 || drag.current) return;
        // Skips the mouse's default focus handling so the handle can take
        // focus below, and keeps text from being selected.
        e.preventDefault();
        const rect = e.currentTarget.getBoundingClientRect();
        const onHandle = !!handleRef.current?.contains(e.target as Node);
        const d: Drag = {
          id: e.pointerId,
          startX: e.clientX,
          offset: onHandle
            ? e.clientX - (rect.left + pos.get() * rect.width)
            : 0,
          rect,
          active: false,
        };
        drag.current = d;
        e.currentTarget.setPointerCapture(e.pointerId);
        handleRef.current?.focus({ preventScroll: true });
        if (onHandle) {
          start(d);
        } else if (e.pointerType !== "touch") {
          // A mouse press is intent, so glide right away. A touch waits to
          // see whether it is a tap, a drag or a scroll.
          start(d);
          moveTo(at(e.clientX, d), true);
        }
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (!d || e.pointerId !== d.id) return;
        if (!d.active) {
          if (Math.abs(e.clientX - d.startX) < SLOP) return;
          start(d);
          moveTo(at(e.clientX, d), true);
          return;
        }
        moveTo(at(e.clientX, d), false);
      }}
      onPointerUp={(e) => {
        const d = drag.current;
        if (!d || e.pointerId !== d.id) return;
        // A tap that never became a drag.
        if (!d.active) moveTo(at(e.clientX, d), true);
        end();
      }}
      onPointerCancel={(e) => {
        if (drag.current?.id === e.pointerId) end();
      }}
    >
      <div aria-hidden className="absolute inset-0">
        {before}
      </div>
      <div
        ref={afterRef}
        aria-hidden
        className="absolute inset-0"
        style={{ clipPath: `inset(0 0 0 ${initial * 100}%)` }}
      >
        {after}
      </div>

      <span
        ref={beforeTagRef}
        aria-hidden
        className={cn(tag, "left-4")}
        style={{ opacity: tagOpacity(initial) }}
      >
        Before
      </span>
      <span
        ref={afterTagRef}
        aria-hidden
        className={cn(tag, "right-4")}
        style={{ opacity: tagOpacity(1 - initial) }}
      >
        After
      </span>

      {/* Full width so its translateX percentage matches the clip inset. */}
      <div
        ref={dividerRef}
        className="pointer-events-none absolute inset-0"
        style={{ transform: `translateX(${initial * 100}%)` }}
      >
        <div className="absolute inset-y-0 left-0 w-px -translate-x-1/2 bg-foreground" />
        <div
          ref={handleRef}
          role="slider"
          tabIndex={0}
          aria-label={label}
          aria-orientation="horizontal"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent(initial)}
          aria-valuetext={valueText(initial)}
          className="pointer-events-auto absolute top-1/2 left-0 flex size-10 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-background text-foreground shadow-raised outline-hidden transition-[scale] duration-150 ease-out group-data-[dragging]:scale-[0.96] focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-foreground motion-reduce:transition-none"
          onKeyDown={(e) => {
            const next = {
              ArrowLeft: target.current - STEP,
              ArrowDown: target.current - STEP,
              ArrowRight: target.current + STEP,
              ArrowUp: target.current + STEP,
              Home: 0,
              End: 1,
            }[e.key];
            if (next === undefined) return;
            e.preventDefault();
            // Occasional, so it glides exactly like a click.
            moveTo(clamp(next), true);
          }}
        >
          <svg
            viewBox="0 0 16 16"
            className="size-5"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.5}
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
          >
            <path d="M6 5 3 8l3 3M10 5l3 3-3 3" />
          </svg>
        </div>
      </div>
    </div>
  );
}

const ICON = {
  viewBox: "0 0 16 16",
  fill: "none",
  stroke: "currentColor",
  strokeLinecap: "round",
  strokeLinejoin: "round",
} as const;

// The same file card twice. Before: square corners, a border faking depth,
// one flat text style, cramped spacing. After: concentric radii (28px outer
// = 12px inner + 16px padding), a layered shadow instead of a border, a muted
// secondary line with tabular numbers, and room to breathe.
function FileCard({ polished }: { polished: boolean }) {
  return (
    <div className="absolute inset-0 flex items-center justify-center bg-surface">
      <div
        className={cn(
          "flex w-[380px] max-w-[calc(100%-2.5rem)] flex-col bg-background text-foreground",
          polished
            ? "gap-4 rounded-[28px] p-4 shadow-raised"
            : "gap-1.5 border border-foreground/25 p-2",
        )}
      >
        <div className={cn("flex items-center", polished ? "gap-4" : "gap-2")}>
          <div
            className={cn(
              "flex size-14 shrink-0 items-center justify-center",
              polished ? "rounded-xl bg-surface text-muted" : "bg-foreground/15",
            )}
          >
            {polished && (
              <svg className="size-6" strokeWidth={1.5} {...ICON}>
                <path d="M9 2H4.5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h7a1 1 0 0 0 1-1V5.5L9 2ZM9 2v3.5h3.5" />
              </svg>
            )}
          </div>
          <div className="min-w-0">
            <p className={cn("truncate text-[15px]", polished && "font-medium")}>
              Brand guidelines.pdf
            </p>
            <p
              className={cn(
                "truncate",
                polished ? "mt-0.5 text-[13px] text-muted tabular-nums" : "text-[15px]",
              )}
            >
              2.4 MB · Updated 3h ago
            </p>
          </div>
        </div>
        <div
          className={cn(
            "flex h-11 items-center justify-center gap-2 text-[15px]",
            polished
              ? "rounded-xl bg-foreground font-medium text-background"
              : "border border-foreground/40",
          )}
        >
          {polished && (
            // 2px stroke to match the medium-weight label beside it.
            <svg className="size-4" strokeWidth={2} {...ICON}>
              <path d="M8 2.5v8M4.5 7 8 10.5 11.5 7M3 13.5h10" />
            </svg>
          )}
          Download
        </div>
      </div>
    </div>
  );
}

export default function CompareSliderDemo() {
  return (
    <CompareSlider
      before={<FileCard polished={false} />}
      after={<FileCard polished />}
    />
  );
}
