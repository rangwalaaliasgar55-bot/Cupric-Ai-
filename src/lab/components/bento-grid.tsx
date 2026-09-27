import { useDrivenSeconds } from "@/lib/progress";
import { useReducedMotion } from "@/lib/use-reduced-motion";
import { cn } from "@/lib/cn";

/**
 * Bento grid: feature tiles of mixed sizes build in one after another
 * (rise + fade, 90ms stagger), then each tile's accent glow drifts slowly
 * so the finished grid still breathes. Time comes from the recorder when
 * driven, so a recording is deterministic.
 */
export type BentoTile = { title: string; body: string; span?: "wide" | "tall" | "big"; accent?: string };

const STAGGER = 0.09;
const IN = 0.5;
const easeOut = (x: number) => 1 - Math.pow(1 - Math.min(1, Math.max(0, x)), 3);

export function BentoGrid({ tiles, className }: { tiles: BentoTile[]; className?: string }) {
  const sec = useDrivenSeconds();
  const reduce = useReducedMotion();
  return (
    <div className={cn("grid w-[560px] max-w-full auto-rows-[92px] grid-cols-4 gap-2.5", className)}>
      {tiles.map((tile, i) => {
        const p = reduce ? 1 : easeOut((sec - 0.15 - i * STAGGER) / IN);
        const drift = reduce ? 0 : Math.sin(sec * 0.9 + i * 1.7);
        return (
          <article
            key={tile.title}
            className={cn(
              "relative overflow-hidden rounded-2xl border border-white/10 bg-[#15151b] p-4",
              tile.span === "wide" && "col-span-2",
              tile.span === "tall" && "row-span-2",
              tile.span === "big" && "col-span-2 row-span-2",
            )}
            style={{ opacity: p, transform: `translateY(${(1 - p) * 18}px) scale(${0.96 + 0.04 * p})` }}
          >
            <div
              aria-hidden
              className="pointer-events-none absolute -right-10 -top-10 h-40 w-40 rounded-full blur-2xl"
              style={{ background: tile.accent ?? "#c8f542", opacity: 0.18 + 0.08 * drift, transform: `translate(${drift * 10}px, ${-drift * 6}px)` }}
            />
            <h3 className="relative text-[15px] font-semibold text-[#f4f1ea]">{tile.title}</h3>
            <p className="relative mt-1 text-[12px] leading-snug text-[#9a9aa5]">{tile.body}</p>
          </article>
        );
      })}
    </div>
  );
}

export default function BentoGridDemo() {
  return (
    <BentoGrid
      tiles={[
        { title: "Auto-edit", body: "Cuts land on the beat.", span: "big", accent: "#c8f542" },
        { title: "Captions", body: "Word-timed, styled.", accent: "#4fb6e8" },
        { title: "Color", body: "Scopes + wheels.", accent: "#e24b4a" },
        { title: "Reframe", body: "One edit, every aspect ratio.", span: "wide", accent: "#4fb6e8" },
        { title: "Export queue", body: "Batch renders in the background.", span: "wide", accent: "#c8f542" },
      ]}
    />
  );
}
