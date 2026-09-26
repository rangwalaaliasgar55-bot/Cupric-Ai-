import { useRef } from "react";
import { cn } from "@/lib/cn";

// Paints only the 1px padding ring, so the gradient shows as a lit edge.
const RING_MASK =
  "linear-gradient(#000 0 0) content-box exclude, linear-gradient(#000 0 0)";

// Monochrome on purpose: a faint dark wash in light mode, faint white in dark.
// The fill is wide and soft so it spills across the gaps between cards; the
// edge is tighter so only the border nearest the cursor catches it.
const GLOW =
  "radial-gradient(260px circle at var(--x) var(--y), light-dark(oklch(0 0 0 / 0.035), oklch(1 0 0 / 0.06)), transparent 70%)";
const EDGE =
  "radial-gradient(180px circle at var(--x) var(--y), light-dark(oklch(0 0 0 / 0.28), oklch(1 0 0 / 0.4)), transparent 70%)";

// Card-space point the shadows are cast from: the middle of the icon
// (20px padding + half of the 20px icon).
const SHADOW_ORIGIN = 30;
// Longest shadow in px, when the light sits right beside the icon, and the
// distance at which it has shrunk to nothing.
const SHADOW_MAX = 6;
const SHADOW_FALLOFF = 420;
// Soft and low contrast, like a desk lamp on paper, in both themes.
const SHADOW_COLOR = "light-dark(oklch(0 0 0 / 0.22), oklch(0 0 0 / 0.9))";
// While lit the shadows track the cursor with no lag (they are the light);
// when it leaves they ease back under their objects. Reduced motion keeps
// the glow but drops the moving shadows.
const CAST =
  "transition-[filter] duration-300 ease-[cubic-bezier(0.23,1,0.32,1)] group-data-[lit]/grid:transition-none motion-reduce:[filter:none]";

export type Feature = {
  title: string;
  text: string;
  icon: React.ReactNode;
};

export function SpotlightGrid({
  features,
  className,
}: {
  features: Feature[];
  className?: string;
}) {
  const gridRef = useRef<HTMLDivElement>(null);
  const cards = useRef<(HTMLElement | null)[]>([]);

  // One listener for the whole grid. Each card gets the cursor in its own
  // coordinates, so a card still glows at the edge nearest a cursor that is
  // over its neighbour.
  const track = (e: React.PointerEvent) => {
    if (e.pointerType !== "mouse") return;
    gridRef.current?.setAttribute("data-lit", "");
    for (const card of cards.current) {
      if (!card) continue;
      const box = card.getBoundingClientRect();
      const x = e.clientX - box.left;
      const y = e.clientY - box.top;
      card.style.setProperty("--x", `${x}px`);
      card.style.setProperty("--y", `${y}px`);
      // The cursor is the light: each icon casts a shadow pointing away
      // from it, shortening as the light moves off, so every card in the
      // grid agrees on where the lamp is.
      const dx = SHADOW_ORIGIN - x;
      const dy = SHADOW_ORIGIN - y;
      const dist = Math.hypot(dx, dy) || 1;
      const reach = Math.max(0, 1 - dist / SHADOW_FALLOFF);
      card.style.setProperty("--sx", `${((dx / dist) * SHADOW_MAX * reach).toFixed(2)}px`);
      card.style.setProperty("--sy", `${((dy / dist) * SHADOW_MAX * reach).toFixed(2)}px`);
    }
  };

  return (
    <div
      ref={gridRef}
      className={cn(
        "group/grid grid w-[min(520px,100%)] gap-3 sm:grid-cols-2",
        className,
      )}
      onPointerMove={track}
      onPointerLeave={() => {
        gridRef.current?.removeAttribute("data-lit");
        for (const card of cards.current) {
          card?.style.setProperty("--sx", "0px");
          card?.style.setProperty("--sy", "0px");
        }
      }}
    >
      {features.map((feature, i) => (
        <article
          key={feature.title}
          ref={(el) => {
            cards.current[i] = el;
          }}
          className="relative overflow-hidden rounded-2xl bg-surface p-5 shadow-[inset_0_0_0_1px_var(--border)]"
        >
          {/* Fades rather than snaps, so leaving the grid doesn't flash dark. */}
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 opacity-0 transition-[opacity] duration-300 ease-[cubic-bezier(0.23,1,0.32,1)] group-data-[lit]/grid:opacity-100"
            style={{ background: GLOW }}
          />
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 rounded-[inherit] p-px opacity-0 transition-[opacity] duration-300 ease-[cubic-bezier(0.23,1,0.32,1)] group-data-[lit]/grid:opacity-100"
            style={{ background: EDGE, mask: RING_MASK }}
          />
          {/* Shadows follow the cursor with no transition while lit (they
              are the light), and ease back under the object when it leaves. */}
          <div
            className="relative"
            style={{ "--shadow": SHADOW_COLOR } as React.CSSProperties}
          >
            <span
              className={cn(
                CAST,
                "block w-fit text-muted [filter:drop-shadow(var(--sx,0px)_var(--sy,0px)_2px_var(--shadow))]",
              )}
            >
              {feature.icon}
            </span>
            {/* Text stays flat and crisp: a shadow on it reads as ghosting. */}
            <h3 className="mt-6 text-[15px] font-medium text-foreground">
              {feature.title}
            </h3>
            <p className="mt-1 text-sm text-pretty text-muted">{feature.text}</p>
          </div>
        </article>
      ))}
    </div>
  );
}

function Icon({ children }: { children: React.ReactNode }) {
  return (
    <svg
      viewBox="0 0 20 20"
      className="size-5"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {children}
    </svg>
  );
}

const FEATURES: Feature[] = [
  {
    title: "Instant sync",
    text: "Edits land on every device before you switch tabs.",
    icon: (
      <Icon>
        <path d="M15.5 8a5.5 5.5 0 0 0-10-2.5M4.5 12a5.5 5.5 0 0 0 10 2.5M15.5 3.5V8H11M4.5 16.5V12H9" />
      </Icon>
    ),
  },
  {
    title: "Works offline",
    text: "Keep writing on a plane. Changes merge when you reconnect.",
    icon: (
      <Icon>
        <path d="M3 3l14 14M7.5 16h7a3 3 0 0 0 1.2-5.75M5.1 7.1A4.5 4.5 0 0 0 7.5 16M8.5 4.3A5 5 0 0 1 14.6 8" />
      </Icon>
    ),
  },
  {
    title: "End-to-end encrypted",
    text: "Only you and the people you invite can read your notes.",
    icon: (
      <Icon>
        <rect x="4" y="9" width="12" height="8" rx="2" />
        <path d="M7 9V6.5a3 3 0 0 1 6 0V9" />
      </Icon>
    ),
  },
  {
    title: "Full history",
    text: "Step back to any version, down to the keystroke.",
    icon: (
      <Icon>
        <path d="M3.5 10a6.5 6.5 0 1 0 1.9-4.6M3.5 3.5v2.9h2.9M10 6.5V10l2.5 1.5" />
      </Icon>
    ),
  },
];

export default function SpotlightCardDemo() {
  return <SpotlightGrid features={FEATURES} />;
}
