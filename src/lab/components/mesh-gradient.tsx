import { useDrivenSeconds } from "@/lib/progress";
import { useReducedMotion } from "@/lib/use-reduced-motion";
import { cn } from "@/lib/cn";

/**
 * Drifting mesh gradient: four soft colour blobs orbit on slow, co-prime
 * periods, so the field never visibly loops within a shot. Meant for
 * openers and hero beats — behind a headline, not under busy content.
 * Driven by the recorder's clock, so recordings are deterministic.
 */
const BLOBS = [
  { color: "#c8f542", r: 0.55, ax: 0.18, ay: 0.12, px: 7.3, py: 9.1, ox: 0.25, oy: 0.3 },
  { color: "#4fb6e8", r: 0.6, ax: 0.2, ay: 0.16, px: 11.7, py: 8.3, ox: 0.75, oy: 0.35 },
  { color: "#e24b4a", r: 0.45, ax: 0.14, ay: 0.2, px: 9.7, py: 13.1, ox: 0.6, oy: 0.8 },
  { color: "#7a5cff", r: 0.5, ax: 0.22, ay: 0.1, px: 12.9, py: 10.3, ox: 0.2, oy: 0.75 },
];

export function MeshGradient({ className, children, colors }: { className?: string; children?: React.ReactNode; colors?: string[] }) {
  const sec = useDrivenSeconds();
  const reduce = useReducedMotion();
  const t = reduce ? 0 : sec;
  return (
    <div className={cn("relative isolate h-[300px] w-[520px] max-w-full overflow-hidden rounded-3xl bg-[#0b0b10]", className)}>
      {BLOBS.map((b, i) => {
        const x = b.ox + b.ax * Math.sin((t * Math.PI * 2) / b.px + i);
        const y = b.oy + b.ay * Math.cos((t * Math.PI * 2) / b.py + i * 2);
        return (
          <div
            key={i}
            aria-hidden
            className="absolute rounded-full mix-blend-screen blur-3xl"
            style={{ width: `${b.r * 100}%`, aspectRatio: "1", left: `${x * 100}%`, top: `${y * 100}%`, transform: "translate(-50%, -50%)", background: colors?.[i] ?? b.color, opacity: 0.55 }}
          />
        );
      })}
      <div aria-hidden className="absolute inset-0 bg-[radial-gradient(transparent,rgba(11,11,16,0.55))]" />
      <div className="relative flex h-full items-center justify-center p-8 text-center">{children}</div>
    </div>
  );
}

export default function MeshGradientDemo() {
  return (
    <MeshGradient>
      <div>
        <p className="text-[13px] font-medium uppercase tracking-[0.2em] text-[#c8f542]">Introducing</p>
        <h2 className="mt-2 text-4xl font-bold text-[#f4f1ea]">Your headline</h2>
      </div>
    </MeshGradient>
  );
}
